/**
 * server/communications/voiceAIExecutionEngine.ts
 *
 * Voice AI Execution Engine
 *
 * Manages AI voice calls via VAPI (primary) / Twilio TTS (fallback).
 * Supports both inbound qualification and outbound AI voice campaigns.
 *
 * Personas:
 *   - receptionist          — general inbound handling
 *   - qualifier             — lead qualification
 *   - intake                — intake capture (name, need, contact)
 *   - estimator             — estimate intake for contractors
 *   - appointment_coordinator — scheduling and reminders
 *   - insurance_intake      — insurance-specific intake
 *   - attorney_intake       — legal-specific intake
 *   - contractor_intake     — contractor-specific intake
 *
 * Safety:
 *   - All calls route through safety check first
 *   - Human takeover available at any point ("transfer", "speak to someone")
 *   - All sessions are fully logged with transcript + summary
 *   - No auto-booking — voice AI books intent, human or booking link closes
 *   - Recording and transcript stored per tenant
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num, bool } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type { VoiceSession, VoicePersona, CommWorkflowType } from "./types";
import { runSafetyCheck } from "./communicationSafetyEngine";
import { appendTimelineEvent } from "./communicationTimelineService";
import { buildCommunicationId } from "./smsWorkflowCoordinator";

// ── VAPI config ───────────────────────────────────────────────────────────────

const VAPI_API_URL = "https://api.vapi.ai";

// ── Persona scripts ───────────────────────────────────────────────────────────

export const VOICE_PERSONA_PROMPTS: Record<VoicePersona, string> = {
  receptionist: `You are a professional virtual receptionist for {{businessName}}.
    Your job is to greet callers warmly, understand their needs, and either answer
    common questions or schedule a callback with the team.
    Always be polite, concise, and helpful.
    If the caller asks to speak with a person, immediately say: "Of course, let me transfer you now."
    Never make promises about pricing, availability, or outcomes.
    DO NOT book appointments directly — provide the booking link instead.`,

  qualifier: `You are a lead qualification specialist for {{businessName}}.
    Your goal is to quickly understand: 1) What the caller needs, 2) Their timeline,
    3) Their contact information. Ask focused questions. Be conversational, not scripted.
    If they're a good fit, let them know someone will follow up within [timeframe].
    Transfer to human if they ask or if the conversation becomes complex.`,

  intake: `You are an intake coordinator for {{businessName}}.
    Collect: full name, best callback number, reason for calling, preferred time to connect.
    Be warm and professional. Confirm each detail back to the caller.
    End with: "Great, someone from our team will be in touch shortly."
    Never discuss pricing, legal matters, or make commitments on behalf of the business.`,

  estimator: `You are an estimate intake specialist for {{businessName}}, a contractor.
    Collect: type of project, property address, scope of work, timeline, best contact.
    Ask clarifying questions about the project. Confirm that a team member will follow up.
    DO NOT provide price estimates over the phone.`,

  appointment_coordinator: `You are an appointment coordinator for {{businessName}}.
    Help callers check, reschedule, or confirm appointments.
    For new bookings, provide the online booking link: {{bookingLink}}.
    Confirm appointment details clearly. Transfer to human for complex changes.`,

  insurance_intake: `You are an insurance intake specialist representing {{businessName}}.
    Collect: caller's name, policy type of interest, current coverage situation, best callback.
    Be professional and compliant. Do NOT provide specific coverage recommendations.
    Let callers know a licensed agent will follow up personally.`,

  attorney_intake: `You are a client intake coordinator for {{firmName}}.
    Collect: caller's name, brief description of their legal matter (no specifics needed),
    best callback number and time. Be empathetic and professional.
    Let them know an attorney will review their matter and be in touch.
    Do NOT provide legal advice under any circumstances.`,

  contractor_intake: `You are a project intake coordinator for {{businessName}}.
    Understand what type of work the caller needs, their location, and timeline.
    Collect contact information and preferred callback time.
    A project coordinator will follow up to schedule an on-site estimate.`,
};

// ── ID builder ────────────────────────────────────────────────────────────────

function buildSessionId(communicationId: string): string {
  const raw = `voice|${communicationId}|${Date.now()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _comm_voice_sessions (
        id                  SERIAL PRIMARY KEY,
        session_id          TEXT        NOT NULL UNIQUE,
        communication_id    TEXT        NOT NULL,
        tenant_id           TEXT        NOT NULL,
        contact_phone       TEXT        NOT NULL,
        direction           TEXT        NOT NULL DEFAULT 'outbound',
        persona             TEXT        NOT NULL DEFAULT 'receptionist',
        provider            TEXT        NOT NULL DEFAULT 'vapi',
        provider_call_id    TEXT,
        status              TEXT        NOT NULL DEFAULT 'initiated',
        duration_seconds    INTEGER,
        recording_url       TEXT,
        transcript          TEXT,
        summary             TEXT,
        human_takeover_at   TIMESTAMPTZ,
        escalation_reason   TEXT,
        appointment_booked  BOOLEAN     NOT NULL DEFAULT FALSE,
        started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at            TIMESTAMPTZ,
        metadata            JSONB
      );
      CREATE INDEX IF NOT EXISTS comm_voice_tenant_idx ON _comm_voice_sessions (tenant_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS comm_voice_phone_idx  ON _comm_voice_sessions (contact_phone, tenant_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS comm_voice_status_idx ON _comm_voice_sessions (tenant_id, status) WHERE status != 'completed';
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[COMM-VOICE] Failed to ensure table:", err?.message);
  }
}

// ── Initiate outbound AI voice call ──────────────────────────────────────────

export async function initiateVoiceCall(opts: {
  tenantId:     string;
  contactPhone: string;
  persona:      VoicePersona;
  workflowType: CommWorkflowType;
  businessName: string;
  templateVars?: Record<string, string>;
  vapiAssistantId?: string;
  fromPhone?:   string;
}): Promise<{
  sessionId:       string;
  communicationId: string;
  ok:              boolean;
  providerCallId?: string;
  error?:          string;
  blocked?:        boolean;
}> {
  await ensureTable();

  const { tenantId, contactPhone, persona, workflowType, businessName } = opts;
  const communicationId = buildCommunicationId(tenantId, contactPhone, `voice_${workflowType}`);
  const sessionId       = buildSessionId(communicationId);

  // ── Safety check ─────────────────────────────────────────────────────────
  const safety = await runSafetyCheck({ tenantId, contactPhone, channel: "voice", workflowType });
  if (!safety.passed) {
    await appendTimelineEvent({
      communicationId, tenantId,
      eventType:   "safety_blocked",
      actor:       "system",
      description: `Voice call blocked: ${safety.blockReason}`,
    });
    return { sessionId, communicationId, ok: false, blocked: true, error: safety.detail };
  }

  // ── Create session record ─────────────────────────────────────────────────
  await db.execute(sql.raw(`
    INSERT INTO _comm_voice_sessions
      (session_id, communication_id, tenant_id, contact_phone, direction,
       persona, provider, status, metadata)
    VALUES
      (${esc(sessionId)}, ${esc(communicationId)}, ${esc(tenantId)},
       ${esc(contactPhone)}, 'outbound', ${esc(persona)}, 'vapi', 'initiated',
       ${esc(JSON.stringify({ workflowType, businessName, ...opts.templateVars }))})
    ON CONFLICT (session_id) DO NOTHING
  `));

  await appendTimelineEvent({
    communicationId, tenantId,
    eventType:   "created",
    actor:       "system",
    description: `Outbound voice call initiated: ${persona} → ${contactPhone}`,
    metadata:    { persona, workflowType },
  });

  // ── VAPI API call ─────────────────────────────────────────────────────────
  const vapiKey = process.env.VAPI_API_KEY;
  if (!vapiKey) {
    // No VAPI key — fallback to Twilio TTS
    console.warn("[COMM-VOICE] VAPI_API_KEY not set — falling back to Twilio TTS voicemail drop");
    return await fallbackTwilioVoice({ sessionId, communicationId, tenantId, contactPhone, persona, businessName, opts });
  }

  try {
    const systemPrompt = buildPersonaPrompt(persona, { businessName, ...opts.templateVars });

    const vapiPayload = {
      assistant: opts.vapiAssistantId ? undefined : {
        model: {
          provider: "openai",
          model:    "gpt-4o-mini",
          systemPrompt,
        },
        voice: {
          provider: "11labs",
          voiceId:  "rachel",
        },
        firstMessage: buildFirstMessage(persona, businessName),
        endCallMessage: "Thank you for your time. Have a great day!",
        endCallPhrases: ["goodbye", "bye", "have a good one", "thanks bye"],
        transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
      },
      assistantId:    opts.vapiAssistantId,
      customer:       { number: contactPhone },
      phoneNumberId:  process.env.VAPI_PHONE_NUMBER_ID,
    };

    const resp = await fetch(`${VAPI_API_URL}/call`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${vapiKey}`,
      },
      body: JSON.stringify(vapiPayload),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`VAPI error ${resp.status}: ${errBody}`);
    }

    const vapiCall = await resp.json() as { id: string };
    const providerCallId = vapiCall.id;

    await db.execute(sql.raw(`
      UPDATE _comm_voice_sessions
      SET status = 'ringing', provider_call_id = ${esc(providerCallId)}
      WHERE session_id = ${esc(sessionId)}
    `));

    await appendTimelineEvent({
      communicationId, tenantId,
      eventType:   "sending",
      actor:       "provider",
      description: `VAPI call initiated: ${providerCallId}`,
      metadata:    { providerCallId },
    });

    console.log(`[COMM-VOICE] VAPI call started: ${providerCallId} → ${contactPhone}`);
    return { sessionId, communicationId, ok: true, providerCallId };

  } catch (err: any) {
    await db.execute(sql.raw(`
      UPDATE _comm_voice_sessions SET status='failed', ended_at=NOW() WHERE session_id=${esc(sessionId)}
    `));
    await appendTimelineEvent({
      communicationId, tenantId, eventType: "failed", actor: "system",
      description: `Voice call failed: ${err?.message}`,
    });
    return { sessionId, communicationId, ok: false, error: err?.message };
  }
}

// ── Twilio TTS fallback (voicemail drop) ──────────────────────────────────────

async function fallbackTwilioVoice(opts: {
  sessionId:       string;
  communicationId: string;
  tenantId:        string;
  contactPhone:    string;
  persona:         VoicePersona;
  businessName:    string;
  opts:            any;
}): Promise<{ sessionId: string; communicationId: string; ok: boolean; error?: string }> {
  try {
    const { getTwilioClientForAccount } = await import("../twilioClient");
    const twilio = await getTwilioClientForAccount(opts.tenantId);
    if (!twilio.client || !twilio.phoneNumber) throw new Error("Twilio not provisioned for tenant");

    const message = buildFirstMessage(opts.persona, opts.businessName);
    await twilio.client.calls.create({
      to:   opts.contactPhone,
      from: twilio.phoneNumber,
      twiml: `<Response><Say voice="Polly.Joanna">${message}</Say></Response>`,
    });

    await db.execute(sql.raw(`
      UPDATE _comm_voice_sessions
      SET status='completed', provider='twilio', ended_at=NOW()
      WHERE session_id=${esc(opts.sessionId)}
    `));

    await appendTimelineEvent({
      communicationId: opts.communicationId,
      tenantId: opts.tenantId,
      eventType: "sent",
      actor: "provider",
      description: `Twilio TTS voicemail drop sent to ${opts.contactPhone}`,
    });

    return { sessionId: opts.sessionId, communicationId: opts.communicationId, ok: true };
  } catch (err: any) {
    return { sessionId: opts.sessionId, communicationId: opts.communicationId, ok: false, error: err?.message };
  }
}

// ── Handle inbound call webhook ───────────────────────────────────────────────

export async function handleInboundCall(opts: {
  tenantId:       string;
  contactPhone:   string;
  providerCallId: string;
  persona:        VoicePersona;
  businessName:   string;
}): Promise<{ sessionId: string; communicationId: string; twiml?: string }> {
  await ensureTable();

  const communicationId = buildCommunicationId(opts.tenantId, opts.contactPhone, `inbound_voice`);
  const sessionId       = buildSessionId(communicationId);

  await db.execute(sql.raw(`
    INSERT INTO _comm_voice_sessions
      (session_id, communication_id, tenant_id, contact_phone, direction,
       persona, provider, status, provider_call_id)
    VALUES
      (${esc(sessionId)}, ${esc(communicationId)}, ${esc(opts.tenantId)},
       ${esc(opts.contactPhone)}, 'inbound', ${esc(opts.persona)}, 'twilio',
       'in_progress', ${esc(opts.providerCallId)})
    ON CONFLICT (session_id) DO NOTHING
  `));

  await appendTimelineEvent({
    communicationId, tenantId: opts.tenantId,
    eventType:   "created",
    actor:       "provider",
    description: `Inbound call received from ${opts.contactPhone}`,
    metadata:    { persona: opts.persona, providerCallId: opts.providerCallId },
  });

  // Return TwiML for Twilio to speak
  const greeting = buildFirstMessage(opts.persona, opts.businessName);
  const twiml = `<Response><Say voice="Polly.Joanna">${greeting}</Say></Response>`;

  return { sessionId, communicationId, twiml };
}

// ── Complete voice session ────────────────────────────────────────────────────

export async function completeVoiceSession(opts: {
  sessionId:        string;
  tenantId:         string;
  durationSeconds?: number;
  transcript?:      string;
  summary?:         string;
  recordingUrl?:    string;
  appointmentBooked?: boolean;
}): Promise<void> {
  await ensureTable();
  await db.execute(sql.raw(`
    UPDATE _comm_voice_sessions
    SET status = 'completed',
        ended_at = NOW(),
        duration_seconds = ${num(opts.durationSeconds)},
        transcript = ${esc(opts.transcript ?? "")},
        summary = ${esc(opts.summary ?? "")},
        recording_url = ${esc(opts.recordingUrl ?? "")},
        appointment_booked = ${bool(opts.appointmentBooked ?? false)}
    WHERE session_id = ${esc(opts.sessionId)} AND tenant_id = ${esc(opts.tenantId)}
  `));
}

// ── Transfer to human ─────────────────────────────────────────────────────────

export async function transferToHuman(opts: {
  sessionId:        string;
  communicationId:  string;
  tenantId:         string;
  reason:           string;
}): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE _comm_voice_sessions
    SET status = 'escalated', human_takeover_at = NOW(), escalation_reason = ${esc(opts.reason)}
    WHERE session_id = ${esc(opts.sessionId)} AND tenant_id = ${esc(opts.tenantId)}
  `));
  await appendTimelineEvent({
    communicationId: opts.communicationId,
    tenantId:        opts.tenantId,
    eventType:       "human_takeover",
    actor:           "system",
    description:     `Transferred to human: ${opts.reason}`,
  });
}

// ── Voice stats ───────────────────────────────────────────────────────────────

export async function getVoiceStats(tenantId: string): Promise<{
  totalCalls:     number;
  completed:      number;
  escalated:      number;
  avgDuration:    number;
  appointmentsBooked: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status='completed' THEN 1 END) AS completed,
        COUNT(CASE WHEN status='escalated' THEN 1 END) AS escalated,
        AVG(duration_seconds) AS avg_duration,
        COUNT(CASE WHEN appointment_booked=TRUE THEN 1 END) AS appointments
      FROM _comm_voice_sessions
      WHERE tenant_id = ${esc(tenantId)}
        AND started_at >= NOW() - INTERVAL '30 days'
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    return {
      totalCalls:         Number(r?.total ?? 0),
      completed:          Number(r?.completed ?? 0),
      escalated:          Number(r?.escalated ?? 0),
      avgDuration:        Number(r?.avg_duration ?? 0),
      appointmentsBooked: Number(r?.appointments ?? 0),
    };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { totalCalls: 0, completed: 0, escalated: 0, avgDuration: 0, appointmentsBooked: 0 };
  }
}

// ── Get active sessions ───────────────────────────────────────────────────────

export async function getActiveVoiceSessions(tenantId: string): Promise<VoiceSession[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _comm_voice_sessions
      WHERE tenant_id = ${esc(tenantId)}
        AND status IN ('initiated','ringing','in_progress')
      ORDER BY started_at DESC
      LIMIT 20
    `));
    return ((result as any).rows ?? result ?? []).map(mapSessionRow);
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPersonaPrompt(persona: VoicePersona, vars: Record<string, string | undefined>): string {
  const template = VOICE_PERSONA_PROMPTS[persona] ?? VOICE_PERSONA_PROMPTS.receptionist;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `[${k}]`);
}

function buildFirstMessage(persona: VoicePersona, businessName: string): string {
  const messages: Record<VoicePersona, string> = {
    receptionist:            `Hello! Thank you for calling ${businessName}. How can I help you today?`,
    qualifier:               `Hi there! I'm reaching out from ${businessName}. I have just a couple quick questions to make sure we can best help you. Is now a good time?`,
    intake:                  `Hello, this is ${businessName}. I'm calling to follow up on your inquiry. I just need a moment to get a few details — is now a good time?`,
    estimator:               `Hi, this is ${businessName} calling about your estimate request. I'd love to get a few details about your project. Do you have a moment?`,
    appointment_coordinator: `Hello! This is ${businessName} calling about your appointment. I just want to confirm a few details — is now a good time?`,
    insurance_intake:        `Hello, this is ${businessName}. I'm reaching out regarding your insurance inquiry. Is this a good time to speak for just a moment?`,
    attorney_intake:         `Hello, this is the intake coordinator for ${businessName}. I'm calling regarding your legal matter. Is now a convenient time to speak?`,
    contractor_intake:       `Hi there, this is ${businessName} calling about your project inquiry. I'd love to learn a bit more — do you have a few minutes?`,
  };
  return messages[persona] ?? `Hello, thank you for connecting with ${businessName}. How can I help you today?`;
}

function mapSessionRow(r: any): VoiceSession {
  return {
    sessionId:        r.session_id,
    communicationId:  r.communication_id,
    tenantId:         r.tenant_id,
    contactPhone:     r.contact_phone,
    direction:        r.direction as "inbound" | "outbound",
    persona:          r.persona as VoicePersona,
    provider:         r.provider as "vapi" | "twilio" | "elevenlabs",
    providerCallId:   r.provider_call_id || undefined,
    status:           r.status,
    durationSeconds:  r.duration_seconds ? Number(r.duration_seconds) : undefined,
    recordingUrl:     r.recording_url || undefined,
    transcript:       r.transcript || undefined,
    summary:          r.summary || undefined,
    humanTakeoverAt:  r.human_takeover_at?.toISOString?.() ?? undefined,
    escalationReason: r.escalation_reason || undefined,
    appointmentBooked: Boolean(r.appointment_booked),
    startedAt:        r.started_at?.toISOString?.() ?? new Date().toISOString(),
    endedAt:          r.ended_at?.toISOString?.() ?? undefined,
  };
}
