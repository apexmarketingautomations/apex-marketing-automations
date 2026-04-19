import crypto from "crypto";
import { eq, and, or, ne, sql, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  trackingVisits,
  trackingEvents,
  contacts,
  type TrackingVisit,
} from "@shared/schema";
import { emitUniversalEvent } from "../intelligence/eventEmitter";

// ---------------------------------------------------------------------------
// Identity stitching for the tracking pipeline.
//
// Visits start out anonymous (just a session_id + IP hash). When a visitor
// hands over an email, phone, or maps to a CRM contact, `upgradeVisit` is
// called to:
//   1. hash the identity values (SHA-256 + signing secret, no raw PII stored)
//   2. attach contact_id / email_hash / phone_hash to the visit
//   3. boost attribution_confidence (anonymous → identified)
//   4. stitch sibling visits sharing the same hash to the same contact —
//      ALWAYS scoped by the visit's subAccountId so cross-tenant data never
//      leaks across the boundary
//   5. mark this visit (and any prior ones for the same identity) as repeat
//
// All writes happen inside a single DB transaction with row locking on the
// target visit so concurrent identifies cannot produce inconsistent
// stitching state.
// ---------------------------------------------------------------------------

const SIGNING_SECRET =
  process.env.TRACKING_SIGNING_SECRET ||
  process.env.SESSION_SECRET ||
  "apex-tracking-dev-secret-change-me";

function sha(value: string): string {
  return crypto.createHash("sha256").update(value + SIGNING_SECRET).digest("hex").slice(0, 32);
}

export function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const norm = email.trim().toLowerCase();
  if (!norm || !norm.includes("@")) return null;
  return sha(`email:${norm}`);
}

export function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 7) return null;
  return sha(`phone:${digits}`);
}

export type UpgradeInput = {
  visitId?: string;
  sessionId?: string;
  email?: string | null;
  phone?: string | null;
  contactId?: number | null;
};

export type UpgradeResult = {
  upgraded: boolean;
  visit?: TrackingVisit;
  stitchedVisitCount: number;
  isRepeat: boolean;
  reason?: string;
};

export async function upgradeVisit(input: UpgradeInput): Promise<UpgradeResult> {
  return db.transaction(async (tx) => {
    // Locate + lock the visit. visitId wins over sessionId.
    let visit: TrackingVisit | undefined;
    if (input.visitId) {
      const rows = await tx
        .select()
        .from(trackingVisits)
        .where(eq(trackingVisits.visitId, input.visitId))
        .for("update")
        .limit(1);
      visit = rows[0];
    } else if (input.sessionId) {
      const rows = await tx
        .select()
        .from(trackingVisits)
        .where(eq(trackingVisits.sessionId, input.sessionId))
        .orderBy(sql`created_at DESC`)
        .for("update")
        .limit(1);
      visit = rows[0];
    }
    if (!visit) {
      return { upgraded: false, stitchedVisitCount: 0, isRepeat: false, reason: "visit_not_found" };
    }

    const tenantId = visit.subAccountId; // may be null for unbound links
    const emailHash = hashEmail(input.email);
    const phoneHash = hashPhone(input.phone);
    let contactId: number | null = input.contactId ?? visit.contactId ?? null;

    // Tenant-ownership validation for contactId. A contact must belong to the
    // visit's subAccount, otherwise we refuse to attach (prevents trusted
    // callers from stamping foreign contacts onto a visit).
    if (input.contactId != null) {
      const [c] = await tx
        .select({ id: contacts.id, subAccountId: contacts.subAccountId })
        .from(contacts)
        .where(eq(contacts.id, input.contactId))
        .limit(1);
      if (!c) {
        return { upgraded: false, visit, stitchedVisitCount: 0, isRepeat: visit.isRepeat, reason: "contact_not_found" };
      }
      // Strict tenant ownership: visit and contact MUST share the same
      // subAccountId, including the null/null case. We refuse to attach a
      // tenant-bound contact to a tenant-less visit (and vice versa) so
      // identity data cannot leak across customer boundaries.
      if (c.subAccountId !== tenantId) {
        return { upgraded: false, visit, stitchedVisitCount: 0, isRepeat: visit.isRepeat, reason: "contact_tenant_mismatch" };
      }
      contactId = c.id;
    }

    // Nothing to stitch on — caller didn't actually identify the visitor.
    if (!emailHash && !phoneHash && contactId == null) {
      return { upgraded: false, visit, stitchedVisitCount: 0, isRepeat: visit.isRepeat, reason: "no_identifiers" };
    }

    // ---- find sibling visits, scoped by tenant ----
    const matchers = [];
    if (emailHash) matchers.push(eq(trackingVisits.emailHash, emailHash));
    if (phoneHash) matchers.push(eq(trackingVisits.phoneHash, phoneHash));
    if (contactId != null) matchers.push(eq(trackingVisits.contactId, contactId));

    let siblings: TrackingVisit[] = [];
    if (matchers.length > 0) {
      // CRITICAL: scope by tenant so we never merge visits across customers.
      // If the visit has no tenant (unbound link) only match other tenant-
      // less visits, which is the most conservative behavior.
      const tenantPredicate = tenantId == null
        ? isNull(trackingVisits.subAccountId)
        : eq(trackingVisits.subAccountId, tenantId);
      siblings = await tx
        .select()
        .from(trackingVisits)
        .where(and(
          tenantPredicate,
          ne(trackingVisits.visitId, visit.visitId),
          or(...matchers)!,
        ));
    }
    const isRepeat = siblings.length > 0;

    // Confidence boost: anonymous visits start at 0.5–1.0; identified visits
    // jump to at least 0.95 because we now have a verified identity anchor.
    const newConfidence = Math.max(visit.attributionConfidence ?? 0, 0.95);

    const [updated] = await tx
      .update(trackingVisits)
      .set({
        contactId: contactId ?? visit.contactId,
        emailHash: emailHash ?? visit.emailHash,
        phoneHash: phoneHash ?? visit.phoneHash,
        identifiedAt: visit.identifiedAt ?? new Date(),
        isRepeat: visit.isRepeat || isRepeat,
        attributionConfidence: newConfidence,
      })
      .where(eq(trackingVisits.visitId, visit.visitId))
      .returning();

    // Stitching — same-tenant siblings only (we already filtered above).
    if (siblings.length > 0) {
      const siblingIds = siblings.map((s) => s.visitId);
      await tx
        .update(trackingVisits)
        .set({
          contactId: contactId ?? sql`${trackingVisits.contactId}`,
          emailHash: emailHash ?? sql`${trackingVisits.emailHash}`,
          phoneHash: phoneHash ?? sql`${trackingVisits.phoneHash}`,
          isRepeat: true,
        })
        .where(or(...siblingIds.map((vid) => eq(trackingVisits.visitId, vid)))!);

      if (contactId != null) {
        // Tenant scope is implicit because events are joined to siblings via
        // visit_id, and siblings are already tenant-filtered. Still, guard
        // explicitly with subAccountId for defense in depth.
        const eventTenantPredicate = tenantId == null
          ? isNull(trackingEvents.subAccountId)
          : eq(trackingEvents.subAccountId, tenantId);
        await tx
          .update(trackingEvents)
          .set({ contactId })
          .where(and(
            eventTenantPredicate,
            isNull(trackingEvents.contactId),
            or(...siblingIds.map((vid) => eq(trackingEvents.visitId, vid)))!,
          ));
      }
    }

    if (contactId != null) {
      const eventTenantPredicate = tenantId == null
        ? isNull(trackingEvents.subAccountId)
        : eq(trackingEvents.subAccountId, tenantId);
      await tx
        .update(trackingEvents)
        .set({ contactId })
        .where(and(
          eventTenantPredicate,
          eq(trackingEvents.visitId, visit.visitId),
          isNull(trackingEvents.contactId),
        ));
    }

    // Mirror to Apex Intelligence (test traffic excluded).
    if (!visit.isTest) {
      emitUniversalEvent({
        eventType: "tracking.visit_identified",
        sourceModule: "tracking",
        moduleSource: "tracking",
        entityType: "tracking_visit",
        entityId: visit.visitId,
        sourceTable: "tracking_visits",
        sourceRecordId: visit.visitId,
        subAccountId: visit.subAccountId ?? undefined,
        contactId: contactId ?? undefined,
        cardId: visit.cardId ?? undefined,
        anonymousSessionId: visit.sessionId ?? undefined,
        metadata: {
          visitId: visit.visitId,
          stitchedSiblingCount: siblings.length,
          isRepeat,
          previousConfidence: visit.attributionConfidence,
          newConfidence,
          hadEmailHash: Boolean(emailHash),
          hadPhoneHash: Boolean(phoneHash),
          hadContactId: contactId != null,
        },
      });
    }

    return {
      upgraded: true,
      visit: updated,
      stitchedVisitCount: siblings.length,
      isRepeat,
    };
  });
}
