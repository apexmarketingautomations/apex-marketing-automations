import type { AutonomyPolicyRule, AutonomySafetyClass } from "@shared/schema";

export interface SafetyContext {
  accountId: number;
  actionType: string;
  confidenceScore: number;
  targetModule?: string;
  targetEntityType?: string;
  targetEntityId?: string;
  hasExternalAuth?: boolean;
  hasExternalAuthSatisfied?: boolean;
  hasPaymentIntent?: boolean;
  isDestructiveOverride?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SafetyEvaluation {
  safetyClass: AutonomySafetyClass;
  recommendedStatus: string;
  reasons: string[];
  blocked: boolean;
  escalated: boolean;
  pendingAuth: boolean;
  ruleApplied: string | null;
}

const BLOCKED_ACTION_PATTERNS = [
  "delete_account",
  "revoke_all_tokens",
  "purge_all_data",
  "reset_billing",
  "transfer_ownership",
];

const EXTERNAL_AUTH_ACTIONS = [
  "oauth_connect",
  "oauth_disconnect",
  "oauth_refresh",
  "stripe_connect",
  "meta_connect",
  "google_connect",
  "twilio_connect",
  "external_api_auth",
];

const PAYMENT_ACTIONS = [
  "create_subscription",
  "upgrade_plan",
  "downgrade_plan",
  "purchase_credits",
  "purchase_domain",
  "charge_customer",
  "refund_payment",
  "create_invoice",
];

const DESTRUCTIVE_IRREVERSIBLE_ACTIONS = [
  "delete_contact",
  "delete_deal",
  "delete_site",
  "delete_domain",
  "delete_campaign",
  "delete_workflow",
  "purge_messages",
  "purge_incidents",
  "delete_webhook",
  "delete_automation",
];

const REGULATED_CONSENT_ACTIONS = [
  "send_bulk_sms",
  "send_bulk_email",
  "deploy_ad_campaign",
  "share_contact_data",
  "export_pii",
];

export function evaluateSafetyPolicy(
  context: SafetyContext,
  policyRule: AutonomyPolicyRule | null,
): SafetyEvaluation {
  const reasons: string[] = [];
  let safetyClass: AutonomySafetyClass = "auto_execute";
  let recommendedStatus = "proposed";
  let blocked = false;
  let escalated = false;
  let pendingAuth = false;
  let ruleApplied: string | null = null;

  if (isBlockedAction(context.actionType)) {
    return {
      safetyClass: "blocked",
      recommendedStatus: "blocked",
      reasons: [`Action type "${context.actionType}" is permanently blocked by safety policy`],
      blocked: true,
      escalated: false,
      pendingAuth: false,
      ruleApplied: "hard_block",
    };
  }

  const needsAuth = requiresExternalAuth(context.actionType) || context.hasExternalAuth;
  if (needsAuth && !context.hasExternalAuthSatisfied) {
    safetyClass = "require_review";
    recommendedStatus = "pending_auth";
    reasons.push("Action requires external authentication — pending auth completion");
    pendingAuth = true;
    ruleApplied = "external_auth_boundary";
    return { safetyClass, recommendedStatus, reasons, blocked, escalated, pendingAuth, ruleApplied };
  }

  if (needsAuth && context.hasExternalAuthSatisfied) {
    reasons.push("External auth requirement satisfied — proceeding with evaluation");
  }

  if (hasLowConfidenceEntityMapping(context)) {
    safetyClass = escalateClass(safetyClass, "require_review");
    reasons.push("Low-confidence entity mapping — target entity type/ID missing or ambiguous");
    escalated = true;
    ruleApplied = "low_confidence_entity_mapping";
  }

  if (requiresPayment(context.actionType) || context.hasPaymentIntent) {
    safetyClass = escalateClass(safetyClass, "require_review");
    reasons.push("Action involves payment commitment — requires human review");
    escalated = true;
    ruleApplied = ruleApplied ?? "payment_boundary";
  }

  if (isDestructiveIrreversible(context.actionType) || context.isDestructiveOverride) {
    safetyClass = escalateClass(safetyClass, "require_review");
    reasons.push("Action is destructive and irreversible — requires human review");
    escalated = true;
    ruleApplied = ruleApplied ?? "destructive_action";
  }

  if (isRegulatedConsent(context.actionType)) {
    safetyClass = escalateClass(safetyClass, "require_review");
    reasons.push("Action crosses regulated consent boundary — requires human review");
    escalated = true;
    ruleApplied = ruleApplied ?? "consent_boundary";
  }

  if (context.confidenceScore < 0.3) {
    safetyClass = escalateClass(safetyClass, "require_review");
    reasons.push(`Low confidence score (${context.confidenceScore}) — below 0.3 threshold`);
    escalated = true;
    ruleApplied = ruleApplied ?? "low_confidence";
  }

  if (policyRule && policyRule.active) {
    ruleApplied = ruleApplied ?? policyRule.actionType;

    if (policyRule.requiresExternalAuth && !context.hasExternalAuthSatisfied) {
      safetyClass = "require_review";
      recommendedStatus = "pending_auth";
      reasons.push(`Policy rule "${policyRule.actionType}": requires external auth — pending`);
      pendingAuth = true;
      return { safetyClass, recommendedStatus, reasons, blocked, escalated, pendingAuth, ruleApplied };
    }

    if (policyRule.requiresPayment && !escalated) {
      safetyClass = escalateClass(safetyClass, "require_review");
      reasons.push(`Policy rule "${policyRule.actionType}": involves payment`);
      escalated = true;
    }

    if (policyRule.isDestructive && !policyRule.isReversible && !escalated) {
      safetyClass = escalateClass(safetyClass, "require_review");
      reasons.push(`Policy rule "${policyRule.actionType}": destructive + irreversible`);
      escalated = true;
    }

    if (!blocked && !escalated) {
      if (context.confidenceScore >= policyRule.maxConfidenceForAutoExec) {
        safetyClass = policyRule.defaultSafetyClass as AutonomySafetyClass;
        reasons.push(`Policy rule "${policyRule.actionType}": confidence ${context.confidenceScore} >= threshold ${policyRule.maxConfidenceForAutoExec}`);
      } else if (context.confidenceScore >= 0.5) {
        safetyClass = escalateClass(policyRule.defaultSafetyClass as AutonomySafetyClass, "auto_prepare");
        reasons.push(`Policy rule "${policyRule.actionType}": confidence ${context.confidenceScore} below auto-exec threshold, escalating to auto_prepare`);
      } else {
        safetyClass = escalateClass(policyRule.defaultSafetyClass as AutonomySafetyClass, "require_review");
        reasons.push(`Policy rule "${policyRule.actionType}": confidence ${context.confidenceScore} below 0.5, escalating to require_review`);
        escalated = true;
      }
    }
  } else if (policyRule && !policyRule.active) {
    reasons.push(`Policy rule "${policyRule.actionType}" exists but is inactive — using defaults`);
    ruleApplied = "inactive_rule_fallback";
    if (!escalated) {
      safetyClass = "require_review";
      reasons.push("Inactive rule — defaulting to require_review for safety");
      escalated = true;
    }
  } else if (!blocked && !escalated) {
    if (context.confidenceScore >= 0.85) {
      safetyClass = "auto_prepare";
      reasons.push("No policy rule found — defaulting to auto_prepare with high confidence");
    } else {
      safetyClass = "require_review";
      reasons.push("No policy rule found — defaulting to require_review");
      escalated = true;
    }
    ruleApplied = "default_fallback";
  }

  recommendedStatus = deriveStatus(safetyClass, blocked, pendingAuth);

  return { safetyClass, recommendedStatus, reasons, blocked, escalated, pendingAuth, ruleApplied };
}

function hasLowConfidenceEntityMapping(context: SafetyContext): boolean {
  if (!context.targetEntityType && !context.targetEntityId) return false;
  if (context.targetEntityType && !context.targetEntityId) return true;
  if (!context.targetEntityType && context.targetEntityId) return true;
  if (context.confidenceScore < 0.4 && context.targetEntityId) return true;
  return false;
}

function deriveStatus(safetyClass: AutonomySafetyClass, blocked: boolean, pendingAuth: boolean): string {
  if (blocked) return "blocked";
  if (pendingAuth) return "pending_auth";
  if (safetyClass === "auto_execute") return "approved";
  if (safetyClass === "auto_prepare") return "approved";
  return "proposed";
}

function isBlockedAction(actionType: string): boolean {
  return BLOCKED_ACTION_PATTERNS.some(p => actionType === p || actionType.startsWith(p + ":"));
}

function requiresExternalAuth(actionType: string): boolean {
  return EXTERNAL_AUTH_ACTIONS.includes(actionType);
}

function requiresPayment(actionType: string): boolean {
  return PAYMENT_ACTIONS.includes(actionType);
}

function isDestructiveIrreversible(actionType: string): boolean {
  return DESTRUCTIVE_IRREVERSIBLE_ACTIONS.includes(actionType);
}

function isRegulatedConsent(actionType: string): boolean {
  return REGULATED_CONSENT_ACTIONS.includes(actionType);
}

const SAFETY_CLASS_ORDER: AutonomySafetyClass[] = ["auto_execute", "auto_prepare", "require_review", "blocked"];

function escalateClass(current: AutonomySafetyClass, target: AutonomySafetyClass): AutonomySafetyClass {
  const currentIdx = SAFETY_CLASS_ORDER.indexOf(current);
  const targetIdx = SAFETY_CLASS_ORDER.indexOf(target);
  return targetIdx > currentIdx ? target : current;
}
