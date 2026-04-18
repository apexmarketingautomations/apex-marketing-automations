/**
 * LAYLA POLICY — Single typed source of truth.
 *
 * Historically the Layla operator config has been read as `any` JSON from the
 * `sub_accounts.config` and `sub_accounts.operator_config` JSONB columns,
 * with each consumer (laylaPipeline, laylaPostProcessor, commentHandler,
 * reengageJob) defining its own loose interface. This file consolidates the
 * shape into a Zod schema with safe defaults so:
 *
 *   1. All consumers import the SAME type — drift is impossible.
 *   2. Bad/partial data from production never crashes the pipeline; the
 *      parser fills in conservative defaults instead.
 *   3. The schema documents what production actually looks like.
 *
 * Usage:
 *   import { parseLaylaPolicy } from "@shared/laylaPolicy";
 *   const policy = parseLaylaPolicy(account.operatorConfig);
 *   if (policy.telegram.allowed) { ... }
 */
import { z } from "zod";

export const laylaTelegramSafetySchema = z.object({
  block_on_payment_requests: z.boolean().default(true),
  block_on_explicit_for_pay: z.boolean().default(true),
  escalate_on_underage: z.boolean().default(true),
});

export const laylaTelegramThresholdSchema = z.object({
  interest_score_needed: z.number().int().nonnegative().default(3),
  score_rules: z.record(z.string(), z.number()).default({}),
});

export const laylaTelegramTemplatesSchema = z.object({
  telegram_send: z.string().default(""),
  clarify_ambiguous: z.string().default(""),
});

export const laylaTelegramSchema = z.object({
  link: z.string().default(""),
  allowed: z.boolean().default(false),
  explicit_ask_phrases: z.array(z.string()).default([]),
  threshold_rules: laylaTelegramThresholdSchema.default({} as any),
  templates: laylaTelegramTemplatesSchema.default({} as any),
  safety: laylaTelegramSafetySchema.default({} as any),
});

export const laylaHandoverSchema = z.object({
  escalate_keywords: z.array(z.string()).default([]),
  fallback_message: z.string().default(""),
  bot_denial: z.string().default(""),
  refuse_personal: z.string().default(""),
});

export const laylaPolicySchema = z.object({
  telegram: laylaTelegramSchema.default({} as any),
  handover: laylaHandoverSchema.default({} as any),
  prohibited_words: z.array(z.string()).default([]),
});

export type LaylaPolicy = z.infer<typeof laylaPolicySchema>;
export type LaylaTelegramPolicy = z.infer<typeof laylaTelegramSchema>;
export type LaylaHandoverPolicy = z.infer<typeof laylaHandoverSchema>;

/**
 * Parse an unknown blob (typically `sub_accounts.operator_config` from the DB)
 * into a fully-typed LaylaPolicy. NEVER throws — falls back to safe defaults
 * on bad input. Logs the parse failure so we know data is corrupt.
 */
export function parseLaylaPolicy(raw: unknown): LaylaPolicy {
  if (raw == null) {
    return laylaPolicySchema.parse({});
  }
  const result = laylaPolicySchema.safeParse(raw);
  if (result.success) return result.data;
  // eslint-disable-next-line no-console
  console.warn(
    `[LAYLA-POLICY] Failed to parse policy, using defaults — issues:`,
    result.error.issues.slice(0, 5),
  );
  return laylaPolicySchema.parse({});
}

/**
 * Build a minimal policy for non-Layla business accounts (used by the
 * comment bot and reengage job when they need a policy shape but the account
 * is a generic business with no telegram pitch). Caller supplies the
 * fallback message + escalate keywords; everything else is a safe default.
 */
export function buildBusinessFallbackPolicy(opts: {
  fallback_message: string;
  escalate_keywords?: string[];
}): LaylaPolicy {
  return parseLaylaPolicy({
    telegram: { link: "", allowed: false },
    handover: {
      fallback_message: opts.fallback_message,
      escalate_keywords: opts.escalate_keywords || [],
    },
  });
}
