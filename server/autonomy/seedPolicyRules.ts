import { storage } from "../storage";
import type { InsertAutonomyPolicyRule } from "@shared/schema";

const DEFAULT_POLICY_RULES: InsertAutonomyPolicyRule[] = [
  { actionType: "send_sms", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 0.7, description: "Send a single SMS message to a contact" },
  { actionType: "send_email", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 0.7, description: "Send a single email to a contact" },
  { actionType: "create_contact", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.6, description: "Create a new contact in CRM" },
  { actionType: "update_contact", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.7, description: "Update an existing contact record" },
  { actionType: "delete_contact", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete a contact — destructive and irreversible" },
  { actionType: "create_deal", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.6, description: "Create a new deal in the pipeline" },
  { actionType: "update_deal", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.7, description: "Update an existing deal" },
  { actionType: "delete_deal", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete a deal — destructive and irreversible" },
  { actionType: "create_appointment", defaultSafetyClass: "auto_prepare", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.8, description: "Schedule a new appointment" },
  { actionType: "update_appointment", defaultSafetyClass: "auto_prepare", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.8, description: "Update an existing appointment" },
  { actionType: "delete_appointment", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete an appointment" },
  { actionType: "create_workflow", defaultSafetyClass: "auto_prepare", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.85, description: "Create a new automation workflow" },
  { actionType: "update_workflow", defaultSafetyClass: "auto_prepare", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.85, description: "Update an existing automation workflow" },
  { actionType: "delete_workflow", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete a workflow" },
  { actionType: "create_site", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.6, description: "Create a new website" },
  { actionType: "update_site", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.7, description: "Update website content" },
  { actionType: "publish_site", defaultSafetyClass: "auto_prepare", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.8, description: "Publish a website live" },
  { actionType: "delete_site", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete a website" },
  { actionType: "send_bulk_sms", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Send bulk SMS — regulated consent boundary" },
  { actionType: "send_bulk_email", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Send bulk email — regulated consent boundary" },
  { actionType: "deploy_ad_campaign", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: true, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Deploy an ad campaign — involves budget commitment" },
  { actionType: "share_contact_data", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Share contact data externally — consent boundary" },
  { actionType: "export_pii", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Export personally identifiable information" },
  { actionType: "create_subscription", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: true, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Create a paid subscription" },
  { actionType: "upgrade_plan", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: true, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Upgrade billing plan" },
  { actionType: "downgrade_plan", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: true, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Downgrade billing plan" },
  { actionType: "purchase_credits", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: true, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Purchase platform credits" },
  { actionType: "purchase_domain", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: true, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Purchase a domain name" },
  { actionType: "charge_customer", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: true, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Charge a customer" },
  { actionType: "refund_payment", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: true, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Issue a payment refund" },
  { actionType: "create_invoice", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: true, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Create a financial invoice" },
  { actionType: "oauth_connect", defaultSafetyClass: "require_review", requiresExternalAuth: true, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Connect OAuth integration — requires external auth" },
  { actionType: "oauth_disconnect", defaultSafetyClass: "require_review", requiresExternalAuth: true, requiresPayment: false, isDestructive: true, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Disconnect OAuth integration" },
  { actionType: "stripe_connect", defaultSafetyClass: "require_review", requiresExternalAuth: true, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Connect Stripe — requires external auth" },
  { actionType: "meta_connect", defaultSafetyClass: "require_review", requiresExternalAuth: true, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Connect Meta/Facebook — requires external auth" },
  { actionType: "google_connect", defaultSafetyClass: "require_review", requiresExternalAuth: true, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 1.0, description: "Connect Google — requires external auth" },
  { actionType: "delete_account", defaultSafetyClass: "blocked", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete entire account — permanently blocked" },
  { actionType: "transfer_ownership", defaultSafetyClass: "blocked", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Transfer account ownership — permanently blocked" },
  { actionType: "purge_all_data", defaultSafetyClass: "blocked", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Purge all data — permanently blocked" },
  { actionType: "update_review_response", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.7, description: "Generate/update AI review response" },
  { actionType: "tag_contact", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.5, description: "Add a tag to a contact" },
  { actionType: "move_deal_stage", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.65, description: "Move a deal to a different pipeline stage" },
  { actionType: "trigger_workflow", defaultSafetyClass: "auto_prepare", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: false, maxConfidenceForAutoExec: 0.8, description: "Trigger an automation workflow" },
  { actionType: "create_notification", defaultSafetyClass: "auto_execute", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.5, description: "Create an in-app notification" },
  { actionType: "update_automation", defaultSafetyClass: "auto_prepare", requiresExternalAuth: false, requiresPayment: false, isDestructive: false, isReversible: true, maxConfidenceForAutoExec: 0.85, description: "Update an existing automation rule" },
  { actionType: "delete_automation", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete an automation rule" },
  { actionType: "delete_campaign", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete an email campaign" },
  { actionType: "delete_domain", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete a domain" },
  { actionType: "delete_webhook", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Delete a webhook" },
  { actionType: "purge_messages", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Purge message history" },
  { actionType: "purge_incidents", defaultSafetyClass: "require_review", requiresExternalAuth: false, requiresPayment: false, isDestructive: true, isReversible: false, maxConfidenceForAutoExec: 1.0, description: "Purge sentinel incidents" },
];

let seeded = false;

export async function seedDefaultPolicyRules(): Promise<number> {
  if (seeded) return 0;
  let count = 0;

  for (const rule of DEFAULT_POLICY_RULES) {
    try {
      await storage.upsertAutonomyPolicyRule(rule);
      count++;
    } catch (err) {
      console.error(`[autonomy] Failed to seed policy rule "${rule.actionType}":`, err);
    }
  }

  seeded = true;
  console.log(`[autonomy] Seeded ${count} default policy rules`);
  return count;
}
