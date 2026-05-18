import { describe, it, expect, vi } from "vitest";

// accountConsolidation imports ../db (and so does contactUpsertService).
// The pure functions under test never touch the DB — stub it so the import
// chain does not require DATABASE_URL.
vi.mock("../../db", () => ({ db: {} }));

import {
  contactRichness,
  pickWinner,
  buildWinnerPatch,
  isRealContactRow,
  dedupKey,
  groupRealContacts,
  PRIMARY_ACCOUNT_ID,
  ACCOUNTS_TO_FOLD,
} from "../accountConsolidation";

// ── Fixture helper ────────────────────────────────────────────────────────────

let _id = 0;
function contact(overrides: Record<string, any> = {}): any {
  _id += 1;
  return {
    id: _id,
    subAccountId: 4,
    firstName: "Unidentified Crash Incident",
    lastName: null,
    email: null,
    phone: null,
    company: null,
    source: "sentinel_crash",
    tags: [],
    notes: null,
    address: null,
    city: null, state: null, zip: null, lat: null, lng: null,
    identityStatus: "placeholder",
    isPlaceholder: true,
    viewClass: "placeholder",
    normalizedPhone: null,
    normalizedEmail: null,
    phoneConfidence: null,
    addressConfidence: null,
    enrichmentConfidence: null,
    verifiedResidence: null, registrationAddress: null, probableResidence: null,
    mailingAddress: null, incidentLocation: null,
    sourceExternalId: null, incidentFingerprint: null,
    leadVertical: null, leadSubtype: null, county: null,
    exportEligible: false,
    originalSubAccountId: null,
    ...overrides,
  };
}

function realContact(overrides: Record<string, any> = {}): any {
  return contact({
    firstName: "Jane",
    lastName: "Doe",
    identityStatus: "verified",
    isPlaceholder: false,
    viewClass: "enriched_contact",
    ...overrides,
  });
}

// ── Config sanity ─────────────────────────────────────────────────────────────

describe("consolidation config", () => {
  it("primary account is 3 and never in the fold list", () => {
    expect(PRIMARY_ACCOUNT_ID).toBe(3);
    expect(ACCOUNTS_TO_FOLD).not.toContain(3);
  });
});

// ── isRealContactRow ──────────────────────────────────────────────────────────

describe("isRealContactRow", () => {
  it("treats placeholder shells as not real", () => {
    expect(isRealContactRow(contact())).toBe(false);
    expect(isRealContactRow(contact({ isPlaceholder: false, identityStatus: "placeholder" }))).toBe(false);
    expect(isRealContactRow(contact({ isPlaceholder: false, identityStatus: "unidentified" }))).toBe(false);
  });
  it("treats verified non-placeholder contacts as real", () => {
    expect(isRealContactRow(realContact())).toBe(true);
  });
});

// ── dedupKey ──────────────────────────────────────────────────────────────────

describe("dedupKey", () => {
  it("prefers phone over email", () => {
    expect(dedupKey(realContact({ phone: "(239) 492-2698", email: "j@x.com" }))).toBe("phone:2394922698");
  });
  it("falls back to email when no phone", () => {
    expect(dedupKey(realContact({ phone: null, email: "Jane@X.com" }))).toBe("email:jane@x.com");
  });
  it("returns null when neither phone nor email", () => {
    expect(dedupKey(realContact({ phone: null, email: null }))).toBeNull();
  });
});

// ── contactRichness ───────────────────────────────────────────────────────────

describe("contactRichness", () => {
  it("scores a verified, contactable record above a bare placeholder", () => {
    const rich = realContact({ phone: "2394922698", email: "j@x.com", address: "1 Main St", exportEligible: true });
    expect(contactRichness(rich)).toBeGreaterThan(contactRichness(contact()));
  });
  it("rewards higher phone confidence", () => {
    const lo = realContact({ phone: "2394922698", phoneConfidence: 0.30 });
    const hi = realContact({ phone: "2394922698", phoneConfidence: 0.95 });
    expect(contactRichness(hi)).toBeGreaterThan(contactRichness(lo));
  });
});

// ── pickWinner ────────────────────────────────────────────────────────────────

describe("pickWinner", () => {
  it("selects the richest record in the group", () => {
    const sparse = realContact({ phone: "2394922698" });
    const rich = realContact({ phone: "2394922698", email: "j@x.com", address: "1 Main St", verifiedResidence: "1 Main St", phoneConfidence: 0.95 });
    expect(pickWinner([sparse, rich]).id).toBe(rich.id);
  });
  it("breaks ties by oldest (lowest) id", () => {
    const a = realContact({ id: 10, phone: "2394922698" });
    const b = realContact({ id: 99, phone: "2394922698" });
    expect(pickWinner([b, a]).id).toBe(10);
  });
  it("prefers a record already in the primary account on a tie", () => {
    const inPrimary = realContact({ id: 50, phone: "2394922698", subAccountId: PRIMARY_ACCOUNT_ID });
    const inOther   = realContact({ id: 20, phone: "2394922698", subAccountId: 4 });
    // inPrimary gets a +0.5 tie-break, outweighing the lower-id rule.
    expect(pickWinner([inOther, inPrimary]).id).toBe(50);
  });
});

// ── groupRealContacts ─────────────────────────────────────────────────────────

describe("groupRealContacts", () => {
  it("groups the same phone across different accounts together", () => {
    const rows = [
      realContact({ phone: "239-492-2698", subAccountId: 3 }),
      realContact({ phone: "(239) 4922698", subAccountId: 4 }),
      realContact({ phone: "2394922698", subAccountId: 1 }),
    ];
    const groups = groupRealContacts(rows);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]).toHaveLength(3);
  });
  it("keeps distinct people in separate groups and ignores keyless rows", () => {
    const rows = [
      realContact({ phone: "2394922698" }),
      realContact({ phone: "8135551234" }),
      realContact({ phone: null, email: null }), // keyless — excluded
    ];
    const groups = groupRealContacts(rows);
    expect(groups.size).toBe(2);
  });
});

// ── buildWinnerPatch ──────────────────────────────────────────────────────────

describe("buildWinnerPatch", () => {
  it("absorbs fields the winner is missing from its duplicates", () => {
    const winner = realContact({ phone: "2394922698", email: null, address: null });
    const dupe   = realContact({ phone: "2394922698", email: "found@x.com", address: "1 Main St" });
    const patch = buildWinnerPatch(winner, [dupe]);
    expect(patch.email).toBe("found@x.com");
    expect(patch.address).toBe("1 Main St");
  });
  it("never overwrites a value the winner already holds", () => {
    const winner = realContact({ email: "winner@x.com" });
    const dupe   = realContact({ email: "dupe@x.com" });
    const patch = buildWinnerPatch(winner, [dupe]);
    expect(patch.email).toBeUndefined();
  });
  it("unions tags across the whole group", () => {
    const winner = realContact({ tags: ["crash", "fl"] });
    const dupe   = realContact({ tags: ["crash", "skip-traced"] });
    const patch = buildWinnerPatch(winner, [dupe]) as any;
    expect(new Set(patch.tags)).toEqual(new Set(["crash", "fl", "skip-traced"]));
  });
  it("takes the highest-confidence phone in the group", () => {
    const winner = realContact({ phone: "2394922698", phoneConfidence: 0.30 });
    const dupe   = realContact({ phone: "8135551234", phoneConfidence: 0.95, normalizedPhone: "8135551234" });
    const patch = buildWinnerPatch(winner, [dupe]) as any;
    expect(patch.phone).toBe("8135551234");
    expect(patch.phoneConfidence).toBe(0.95);
  });
  it("promotes a real name over the winner's placeholder name", () => {
    const winner = realContact({ firstName: "Unidentified Crash Incident", lastName: null });
    const dupe   = realContact({ firstName: "Jane", lastName: "Doe" });
    const patch = buildWinnerPatch(winner, [dupe]) as any;
    expect(patch.firstName).toBe("Jane");
    expect(patch.lastName).toBe("Doe");
  });
});
