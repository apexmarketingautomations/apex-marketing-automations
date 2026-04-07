import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { db } from "../db";
import { subAccounts, featureFlags, systemLogs } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { isProtectedAccountId, isMutating, ensureNotProtectedAccount } from "../middleware/protectedAccount";
import { isFeatureEnabled, requireFeatureFlag } from "../middleware/featureGate";
import { verifyNotProtectedAccount } from "../operator/toolHandlers/tenantGuard";
import { clearLaylaCache } from "../services/laylaAccountResolver";

function mockReq(overrides: any = {}) {
  return {
    method: overrides.method || "GET",
    originalUrl: overrides.url || "/api/test",
    url: overrides.url || "/api/test",
    params: overrides.params || {},
    body: overrides.body || {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    headers: overrides.headers || {},
    user: overrides.user || { id: "test-user", claims: { sub: "test-user" } },
    ...overrides,
  } as any;
}

function mockRes() {
  let statusCode = 200;
  let body: any = null;
  const res: any = {
    status(code: number) { statusCode = code; return res; },
    json(data: any) { body = data; return res; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
  return res;
}

describe("isMutating helper", () => {
  it("identifies mutating HTTP methods", () => {
    expect(isMutating(mockReq({ method: "POST" }))).toBe(true);
    expect(isMutating(mockReq({ method: "PUT" }))).toBe(true);
    expect(isMutating(mockReq({ method: "PATCH" }))).toBe(true);
    expect(isMutating(mockReq({ method: "DELETE" }))).toBe(true);
  });

  it("identifies non-mutating GET requests", () => {
    expect(isMutating(mockReq({ method: "GET", url: "/api/inbox/22" }))).toBe(false);
    expect(isMutating(mockReq({ method: "GET", url: "/api/analytics/22" }))).toBe(false);
  });

  it("identifies GET requests with side-effect URLs as mutating", () => {
    expect(isMutating(mockReq({ method: "GET", url: "/api/seed-demo/22" }))).toBe(true);
    expect(isMutating(mockReq({ method: "GET", url: "/api/toggle-bot/22" }))).toBe(true);
    expect(isMutating(mockReq({ method: "GET", url: "/api/approve-send/22" }))).toBe(true);
    expect(isMutating(mockReq({ method: "GET", url: "/api/trigger-workflow/1" }))).toBe(true);
  });
});

describe("isProtectedAccountId", () => {
  beforeEach(() => {
    clearLaylaCache();
  });

  it("returns false for formerly-protected IDs (22, 13) after protection removal", async () => {
    expect(await isProtectedAccountId(22)).toBe(false);
    expect(await isProtectedAccountId(13)).toBe(false);
  });

  it("returns false for non-protected IDs", async () => {
    expect(await isProtectedAccountId(1)).toBe(false);
    expect(await isProtectedAccountId(999999)).toBe(false);
  });
});

describe("protection infrastructure still works for explicitly-protected accounts", () => {
  beforeEach(() => {
    clearLaylaCache();
  });

  afterAll(async () => {
    await db.update(subAccounts).set({ isProtected: false, protectedReason: null }).where(eq(subAccounts.id, 13));
    clearLaylaCache();
  });

  it("blocks writes when an account is explicitly marked is_protected=true in DB", async () => {
    await db.update(subAccounts).set({ isProtected: true, protectedReason: "test" }).where(eq(subAccounts.id, 13));
    clearLaylaCache();

    expect(await isProtectedAccountId(13)).toBe(true);

    const extractId = (req: any) => req.params?.subAccountId ? parseInt(req.params.subAccountId, 10) : null;
    const middleware = ensureNotProtectedAccount(extractId);
    const req = mockReq({ method: "POST", params: { subAccountId: "13" } });
    const res = mockRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error_code).toBe("sub_account_protected");
    expect(res.body.ticketId).toBeDefined();
  });

  it("agent tenant guard blocks when account is explicitly protected", async () => {
    await db.update(subAccounts).set({ isProtected: true, protectedReason: "test" }).where(eq(subAccounts.id, 13));
    clearLaylaCache();

    const result = await verifyNotProtectedAccount(13, "test-agent");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("protected account");
  });

  it("unblocks after removing protection flag from DB", async () => {
    await db.update(subAccounts).set({ isProtected: false, protectedReason: null }).where(eq(subAccounts.id, 13));
    clearLaylaCache();

    expect(await isProtectedAccountId(13)).toBe(false);

    const result = await verifyNotProtectedAccount(13, "test-agent");
    expect(result).toBeNull();
  });
});

describe("ensureNotProtectedAccount middleware", () => {
  const extractId = (req: any) => {
    const raw = req.params?.subAccountId;
    return raw ? parseInt(raw, 10) : null;
  };
  const middleware = ensureNotProtectedAccount(extractId);

  it("allows mutating requests to formerly-protected account 22 (protection removed)", async () => {
    const req = mockReq({ method: "POST", params: { subAccountId: "22" } });
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it("allows read requests to formerly-protected account 22", async () => {
    const req = mockReq({ method: "GET", params: { subAccountId: "22" }, url: "/api/inbox/22" });
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it("allows all requests to non-protected accounts", async () => {
    const req = mockReq({ method: "POST", params: { subAccountId: "1" } });
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it("passes through when no subAccountId is extractable", async () => {
    const req = mockReq({ method: "POST", params: {} });
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});

describe("Feature Flag Gate", () => {
  it("meta_messaging_2027 flag exists and is disabled by default", async () => {
    const enabled = await isFeatureEnabled("meta_messaging_2027");
    expect(enabled).toBe(false);
  });

  it("non-existent flag returns false (fail-safe OFF)", async () => {
    const enabled = await isFeatureEnabled("non_existent_flag_xyz");
    expect(enabled).toBe(false);
  });

  it("toggling flag changes behavior", async () => {
    await db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.featureName, "meta_messaging_2027"));
    expect(await isFeatureEnabled("meta_messaging_2027")).toBe(true);

    await db.update(featureFlags).set({ enabled: false }).where(eq(featureFlags.featureName, "meta_messaging_2027"));
    expect(await isFeatureEnabled("meta_messaging_2027")).toBe(false);
  });
});

describe("Agent Tenant Guard - Protected Account", () => {
  it("allows tool calls targeting formerly-protected account 22 (protection removed)", async () => {
    const result = await verifyNotProtectedAccount(22, "test-agent");
    expect(result).toBeNull();
  });

  it("allows tool calls targeting formerly-protected account 13 (protection removed)", async () => {
    const result = await verifyNotProtectedAccount(13, "test-agent");
    expect(result).toBeNull();
  });

  it("allows tool calls to non-protected accounts", async () => {
    const result = await verifyNotProtectedAccount(1, "test-agent");
    expect(result).toBeNull();
  });
});

describe("Product Route Feature Gate Integration", () => {
  const featureGate = requireFeatureFlag("meta_messaging_2027");

  afterAll(async () => {
    await db.update(featureFlags).set({ enabled: false }).where(eq(featureFlags.featureName, "meta_messaging_2027"));
  });

  it("returns 404 when meta_messaging_2027 flag is OFF", async () => {
    await db.update(featureFlags).set({ enabled: false }).where(eq(featureFlags.featureName, "meta_messaging_2027"));

    const req = mockReq({ method: "POST", url: "/api/meta-messaging/product/create-subaccount" });
    const res = mockRes();
    let nextCalled = false;

    await featureGate(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("Not found");
  });

  it("passes through (next) when meta_messaging_2027 flag is ON", async () => {
    await db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.featureName, "meta_messaging_2027"));

    const req = mockReq({ method: "POST", url: "/api/meta-messaging/product/create-subaccount" });
    const res = mockRes();
    let nextCalled = false;

    await featureGate(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it("flag ON + formerly-protected account 22 POST passes through full chain (protection removed)", async () => {
    await db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.featureName, "meta_messaging_2027"));

    const extractId = (req: any) => req.params?.subAccountId ? parseInt(req.params.subAccountId, 10) : null;
    const protectedGuard = ensureNotProtectedAccount(extractId);

    const req = mockReq({ method: "POST", params: { subAccountId: "22" }, url: "/api/meta-messaging/product/test-webhook/22" });
    const res = mockRes();

    let gateNextCalled = false;
    await featureGate(req, res, () => { gateNextCalled = true; });
    expect(gateNextCalled).toBe(true);

    let guardNextCalled = false;
    await protectedGuard(req, res, () => { guardNextCalled = true; });
    expect(guardNextCalled).toBe(true);
  });

  it("flag ON + non-protected account POST passes through full chain", async () => {
    await db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.featureName, "meta_messaging_2027"));

    const extractId = (req: any) => req.params?.subAccountId ? parseInt(req.params.subAccountId, 10) : null;
    const protectedGuard = ensureNotProtectedAccount(extractId);

    const req = mockReq({ method: "POST", params: { subAccountId: "1" }, url: "/api/meta-messaging/product/test-webhook/1" });
    const res = mockRes();

    let gateNextCalled = false;
    await featureGate(req, res, () => { gateNextCalled = true; });
    expect(gateNextCalled).toBe(true);

    let guardNextCalled = false;
    await protectedGuard(req, res, () => { guardNextCalled = true; });
    expect(guardNextCalled).toBe(true);
  });

  it("flag ON + formerly-protected account 22 GET (read) passes through full chain", async () => {
    await db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.featureName, "meta_messaging_2027"));

    const extractId = (req: any) => req.params?.subAccountId ? parseInt(req.params.subAccountId, 10) : null;
    const protectedGuard = ensureNotProtectedAccount(extractId);

    const req = mockReq({ method: "GET", params: { subAccountId: "22" }, url: "/api/meta-messaging/product/inbox/22" });
    const res = mockRes();

    let gateNextCalled = false;
    await featureGate(req, res, () => { gateNextCalled = true; });
    expect(gateNextCalled).toBe(true);

    let guardNextCalled = false;
    await protectedGuard(req, res, () => { guardNextCalled = true; });
    expect(guardNextCalled).toBe(true);
  });
});

describe("Agent Execution Central Guard - executeTool level", () => {
  it("verifyNotProtectedAccount allows formerly-protected account 22 in tool context", async () => {
    const result = await verifyNotProtectedAccount(22, "agent-runner-123");
    expect(result).toBeNull();
  });

  it("verifyNotProtectedAccount returns null (allow) for non-protected in tool context", async () => {
    const result = await verifyNotProtectedAccount(5, "agent-runner-123");
    expect(result).toBeNull();
  });

  it("verifyNotProtectedAccount handles undefined subAccountId gracefully", async () => {
    const result = await verifyNotProtectedAccount(undefined as any, "agent-runner-123");
    expect(result).toBeNull();
  });
});
