/**
 * server/communications/types.ts
 *
 * Canonical types for the Apex Communications Engine (Phase 10).
 * Every communications module imports from here — no circular deps.
 *
 * Design axioms:
 *   - Every communication has a communicationId (SHA256-derived)
 *   - Every communication is tenant-scoped
 *   - Every state change writes to the immutable timeline
 *   - Safety check → Approval check → Execution (always in this order)
 *   - No communication can skip the safety gate
 */

// ── Channel ────────────────────────────────────────────────────────────────────

export type CommunicationChannel =
  | "sms"
  | "voice"
  | "email"
  | "imessage"
  | "voicemail_drop";

// ── Status lifecycle ──────────────────────────────────────────────────────────

export type CommunicationStatus =
  | "draft"             // created, not yet submitted
  | "pending_approval"  // waiting for human approval
  | "approved"          // approved, ready to execute
  | "rejected"          // rejected by approver
  | "sending"           // in-flight to channel
  | "sent"              // accepted by channel provider
  | "delivered"         // confirmed delivery
  | "failed"            // provider rejected or error
  | "opted_out"         // contact has opted out
  | "throttled"         // held by quiet-hours or rate limit
  | "duplicate"         // suppressed — duplicate within dedup window
  | "expired"           // pending approval timed out
  | "cancelled";        // explicitly cancelled

// ── Approval states ───────────────────────────────────────────────────────────

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "escalated";

// ── Communication priority ────────────────────────────────────────────────────

export type CommunicationPriority = "low" | "normal" | "high" | "urgent";

// ── Workflow type — covers all verticals ──────────────────────────────────────

export type CommWorkflowType =
  | "lead_followup"
  | "missed_call_recovery"
  | "appointment_reminder"
  | "appointment_confirmation"
  | "estimate_followup"
  | "review_request"
  | "reactivation"
  | "insurance_outreach"
  | "contractor_outreach"
  | "legal_intake"
  | "retention_campaign"
  | "loyalty_notification"
  | "vip_outreach"
  | "inbound_response"
  | "escalation_alert"
  | "voicemail_followup"
  | "imessage_draft"
  | "custom";

// ── Vertical scope ────────────────────────────────────────────────────────────

export type CommVertical =
  | "insurance"
  | "contractor"
  | "legal"
  | "service_business"
  | "enterprise"
  | "generic";

// ── Voice AI persona ──────────────────────────────────────────────────────────

export type VoicePersona =
  | "receptionist"
  | "qualifier"
  | "intake"
  | "estimator"
  | "appointment_coordinator"
  | "insurance_intake"
  | "attorney_intake"
  | "contractor_intake";

// ── Timeline event type ───────────────────────────────────────────────────────

export type TimelineEventType =
  | "created"
  | "safety_passed"
  | "safety_blocked"
  | "approval_requested"
  | "approved"
  | "rejected"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "opted_out"
  | "throttled"
  | "duplicate_suppressed"
  | "inbound_received"
  | "voicemail_detected"
  | "ai_reply_drafted"
  | "ai_summary_generated"
  | "appointment_booked"
  | "escalation_triggered"
  | "human_takeover"
  | "follow_up_scheduled"
  | "expired"
  | "cancelled"
  | "retried";

// ── Safety block reason ───────────────────────────────────────────────────────

export type SafetyBlockReason =
  | "opt_out"
  | "quiet_hours"
  | "no_consent"
  | "duplicate"
  | "abuse_detected"
  | "rate_limit"
  | "cross_tenant"
  | "policy_violation"
  | "invalid_contact";

// ── Intelligence signals ──────────────────────────────────────────────────────

export type ConversationSentiment = "positive" | "neutral" | "negative" | "mixed";
export type ConversationUrgency   = "low" | "medium" | "high" | "critical";
export type ConversionLikelihood  = "unlikely" | "possible" | "likely" | "very_likely";

// ── Core record types ─────────────────────────────────────────────────────────

export interface CommunicationRecord {
  communicationId:  string;      // SHA256(tenantId|contactId|channel|workflowType|ts)[0:24]
  tenantId:         string;      // business_id or sub_account_id
  contactId?:       string;      // customer_id or lead_id
  contactPhone?:    string;
  contactEmail?:    string;
  contactName?:     string;

  channel:          CommunicationChannel;
  direction:        "outbound" | "inbound";
  workflowType:     CommWorkflowType;
  vertical:         CommVertical;
  priority:         CommunicationPriority;

  status:           CommunicationStatus;
  approvalStatus?:  ApprovalStatus;
  approvedBy?:      string;
  approvedAt?:      string;

  content?:         string;      // draft or sent message body
  aiGenerated:      boolean;
  aiModel?:         string;

  scheduledAt?:     string;
  sentAt?:          string;
  deliveredAt?:     string;
  failedAt?:        string;

  providerMessageId?: string;    // Twilio SID, VAPI call ID, etc.
  retryCount:       number;
  maxRetries:       number;

  safetyChecked:    boolean;
  safetyBlockReason?: SafetyBlockReason;

  metadata?:        Record<string, unknown>;
  createdAt?:       string;
  updatedAt?:       string;
}

export interface TimelineEvent {
  eventId:         string;
  communicationId: string;
  tenantId:        string;
  eventType:       TimelineEventType;
  actor:           "system" | "ai" | "human" | "provider";
  actorId?:        string;     // userId or 'system'
  description:     string;
  metadata?:       Record<string, unknown>;
  createdAt:       string;
}

export interface TenantCommPolicy {
  tenantId:         string;
  quietHoursStart:  string;   // "21:00" local
  quietHoursEnd:    string;   // "08:00" local
  timezone:         string;   // "America/New_York"
  maxSmsPerDay:     number;   // per contact
  maxCallsPerDay:   number;
  requireApproval:  CommWorkflowType[];  // workflow types needing approval
  blockedChannels:  CommunicationChannel[];
  consentRequired:  boolean;
  updatedAt?:       string;
}

export interface ConversationIntelligence {
  communicationId:     string;
  tenantId:            string;
  sentiment:           ConversationSentiment;
  urgency:             ConversationUrgency;
  conversionLikelihood: ConversionLikelihood;
  appointmentLikelihood: number;   // 0-100
  escalationIndicators: string[];
  aiSummary?:          string;
  nextStepRecommendation?: string;
  followUpAt?:         string;
  createdAt?:          string;
}

export interface VoiceSession {
  sessionId:        string;
  communicationId:  string;
  tenantId:         string;
  contactPhone:     string;
  direction:        "inbound" | "outbound";
  persona:          VoicePersona;
  provider:         "vapi" | "twilio" | "elevenlabs";
  providerCallId?:  string;

  status:           "initiated" | "ringing" | "in_progress" | "completed" | "failed" | "escalated";
  durationSeconds?: number;
  recordingUrl?:    string;
  transcript?:      string;
  summary?:         string;

  humanTakeoverAt?: string;
  escalationReason?: string;
  appointmentBooked: boolean;

  startedAt:        string;
  endedAt?:         string;
}

export interface ApprovalRecord {
  approvalId:       string;
  communicationId:  string;
  tenantId:         string;
  workflowType:     CommWorkflowType;
  requestedBy:      string;
  requestedAt:      string;
  status:           ApprovalStatus;
  approvedBy?:      string;
  approvedAt?:      string;
  rejectedBy?:      string;
  rejectedAt?:      string;
  rejectionReason?: string;
  expiresAt:        string;
  escalatedAt?:     string;
  notes?:           string;
}

export interface IMessageDraft {
  draftId:          string;
  tenantId:         string;
  contactPhone?:    string;
  contactName?:     string;
  aiGeneratedText:  string;
  contextSummary?:  string;
  responseOptions:  string[];   // up to 3 AI-suggested reply variants
  status:           "pending" | "sent_by_human" | "dismissed";
  approvedBy?:      string;
  createdAt?:       string;
}
