// @ts-nocheck
import { eq } from "drizzle-orm";
import { db } from "../db";
import { subAccounts, pipelineStages, workflows } from "@shared/schema";
import {
  DEFAULT_AI_PROMPT_CONFIG,
  getEffectiveOnboardingDefaults,
} from "./defaults";

function structuredLog(event: string, data: Record<string, any>) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...data }));
}

export interface OnboardingResult {
  subAccountId: number;
  stagesSeeded: number;
  workflowsSeeded: number;
  aiPromptSeeded: boolean;
  welcomeSmsStatus: "sent" | "skipped_no_phone" | "failed" | "not_attempted";
}

export interface OnboardingOptions {
  skipWelcomeSms?: boolean;
}

export interface BackfillResult {
  totalAccounts: number;
  processed: number;
  failed: number;
  totalStagesSeeded: number;
  totalWorkflowsSeeded: number;
  totalAiPromptsSeeded: number;
  perAccount: Array<OnboardingResult | { subAccountId: number; error: string }>;
}

async function seedDefaults(subAccountId: number) {
  let stagesSeeded = 0;
  let workflowsSeeded = 0;
  let aiPromptSeeded = false;

  const effective = await getEffectiveOnboardingDefaults();

  await db.transaction(async (tx) => {
    // Race-safe seeding (Task #143): we still pre-filter against the
    // current rows for an accurate "stagesSeeded" count, but the real
    // protection against duplicates is the unique index on
    // (sub_account_id, name). The .onConflictDoNothing() clause means
    // a parallel onboarding caller racing on the same row is silently
    // dropped instead of producing a duplicate or throwing. Note:
    // case-insensitive dedup is enforced at the application layer
    // (lowercase comparison above) since the DB index is case-sensitive.
    const existingStages = await tx
      .select({ name: pipelineStages.name })
      .from(pipelineStages)
      .where(eq(pipelineStages.subAccountId, subAccountId));
    const existingStageNames = new Set(existingStages.map((s) => s.name.toLowerCase()));
    const stagesToInsert = effective.pipelineStages
      .filter((s) => !existingStageNames.has(s.name.toLowerCase()))
      .map((s) => ({ subAccountId, name: s.name, position: s.position }));
    if (stagesToInsert.length > 0) {
      const inserted = await tx
        .insert(pipelineStages)
        .values(stagesToInsert)
        .onConflictDoNothing()
        .returning({ id: pipelineStages.id });
      stagesSeeded = inserted.length;
    }

    const existingWorkflows = await tx
      .select({ name: workflows.name })
      .from(workflows)
      .where(eq(workflows.subAccountId, subAccountId));
    const existingWorkflowNames = new Set(existingWorkflows.map((w) => w.name.toLowerCase()));
    const workflowsToInsert = effective.workflows
      .filter((w) => !existingWorkflowNames.has(w.name.toLowerCase()))
      .map((w) => ({
        subAccountId,
        name: w.name,
        trigger: w.trigger,
        enabled: w.enabled,
        steps: w.steps,
      }));
    if (workflowsToInsert.length > 0) {
      const inserted = await tx
        .insert(workflows)
        .values(workflowsToInsert)
        .onConflictDoNothing()
        .returning({ id: workflows.id });
      workflowsSeeded = inserted.length;
    }

    const [acct] = await tx
      .select({ aiPromptConfig: subAccounts.aiPromptConfig })
      .from(subAccounts)
      .where(eq(subAccounts.id, subAccountId));
    const existingCfg = (acct?.aiPromptConfig as any) || {};
    if (!existingCfg.systemPrompt) {
      const merged = { ...DEFAULT_AI_PROMPT_CONFIG, ...existingCfg, systemPrompt: effective.brandVoiceSystemPrompt };
      await tx
        .update(subAccounts)
        .set({ aiPromptConfig: merged })
        .where(eq(subAccounts.id, subAccountId));
      aiPromptSeeded = true;
    }
  });

  return { stagesSeeded, workflowsSeeded, aiPromptSeeded };
}

async function sendWelcomeSms(subAccountId: number): Promise<OnboardingResult["welcomeSmsStatus"]> {
  const [acct] = await db
    .select({ ownerPhone: subAccounts.ownerPhone })
    .from(subAccounts)
    .where(eq(subAccounts.id, subAccountId));
  const phone = acct?.ownerPhone?.trim();
  if (!phone) return "skipped_no_phone";

  try {
    const effective = await getEffectiveOnboardingDefaults();
    const { sendSms } = await import("../messaging/sendSms");
    const result = await sendSms({
      subAccountId,
      to: phone,
      body: effective.welcomeSmsBody,
      source: "onboarding_welcome",
      path: "onboarding.welcome_sms",
    });
    if (result.ok) return "sent";
    structuredLog("onboarding_welcome_sms_failed", {
      sub_account_id: subAccountId,
      reason: result.reason,
      error: result.errorMessage,
    });
    return "failed";
  } catch (err: any) {
    structuredLog("onboarding_welcome_sms_failed", {
      sub_account_id: subAccountId,
      error: err?.message || String(err),
    });
    return "failed";
  }
}

export async function onboardNewSubAccount(
  subAccountId: number,
  options: OnboardingOptions = {},
): Promise<OnboardingResult> {
  let seedResult: { stagesSeeded: number; workflowsSeeded: number; aiPromptSeeded: boolean };
  try {
    seedResult = await seedDefaults(subAccountId);
  } catch (err: any) {
    structuredLog("onboarding_seed_failed", {
      sub_account_id: subAccountId,
      error: err?.message || String(err),
    });
    throw err;
  }

  const welcomeSmsStatus: OnboardingResult["welcomeSmsStatus"] = options.skipWelcomeSms
    ? "not_attempted"
    : await sendWelcomeSms(subAccountId);

  const result: OnboardingResult = {
    subAccountId,
    stagesSeeded: seedResult.stagesSeeded,
    workflowsSeeded: seedResult.workflowsSeeded,
    aiPromptSeeded: seedResult.aiPromptSeeded,
    welcomeSmsStatus,
  };

  structuredLog("onboarding_completed", {
    sub_account_id: subAccountId,
    stages_seeded: result.stagesSeeded,
    workflows_seeded: result.workflowsSeeded,
    ai_prompt_seeded: result.aiPromptSeeded,
    welcome_sms_status: result.welcomeSmsStatus,
  });

  return result;
}

export async function backfillExistingSubAccounts(): Promise<BackfillResult> {
  const { storage } = await import("../storage");
  const allAccounts = await storage.getSubAccounts();
  const targets = allAccounts.filter((a: any) => a.ownerUserId !== "_archived");

  structuredLog("onboarding_backfill_started", {
    total_accounts: targets.length,
  });

  const result: BackfillResult = {
    totalAccounts: targets.length,
    processed: 0,
    failed: 0,
    totalStagesSeeded: 0,
    totalWorkflowsSeeded: 0,
    totalAiPromptsSeeded: 0,
    perAccount: [],
  };

  for (const acct of targets) {
    try {
      const r = await onboardNewSubAccount(acct.id, { skipWelcomeSms: true });
      result.processed++;
      result.totalStagesSeeded += r.stagesSeeded;
      result.totalWorkflowsSeeded += r.workflowsSeeded;
      if (r.aiPromptSeeded) result.totalAiPromptsSeeded++;
      result.perAccount.push(r);
    } catch (err: any) {
      result.failed++;
      const errMsg = err?.message || String(err);
      result.perAccount.push({ subAccountId: acct.id, error: errMsg });
      structuredLog("onboarding_backfill_account_failed", {
        sub_account_id: acct.id,
        error: errMsg,
      });
    }
  }

  structuredLog("onboarding_backfill_completed", {
    total_accounts: result.totalAccounts,
    processed: result.processed,
    failed: result.failed,
    total_stages_seeded: result.totalStagesSeeded,
    total_workflows_seeded: result.totalWorkflowsSeeded,
    total_ai_prompts_seeded: result.totalAiPromptsSeeded,
  });

  return result;
}
