import { describe, it, expect, afterAll } from "vitest";
import { db } from "../db";
import { subAccounts, featureFlags, systemLogs } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { isProtectedAccountId, isMutating, ensureNotProtectedAccount } from "../middleware/protectedAccount";
import { isFeatureEnabled, requireFeatureFlag } from "../middleware/featureGate";
import { verifyNotProtectedAccount } from "../operator/toolHandlers/tenantGuard";

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
  it("returns true for protected IDs (22, 13)", async () => {
    expect(await isProtectedAccountId(22)).toBe(true);
    expect(await isProtectedAccountId(13)).toBe(true);
  });

  it("returns false for non-protected IDs", async () => {
    expect(await isProtectedAccountId(1)).toBe(false);
    expect(await isProtectedAccountId(999999)).toBe(false);
  });
});

describe("ensureNotProtectedAccount middleware", () => {
  const extractId = (req: any) => {
    const raw = req.params?.subAccountId;
    return raw ? parseInt(raw, 10) : null;
  };
  const middleware = ensureNotProtectedAccount(extractId);

  it("returns 403 with correct body on mutating request to protected account", async () => {
    const req = mockReq({ method: "POST", params: { subAccountId: "22" } });
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error_code).toBe("sub_account_protected");
    expect(res.body.ticketId).toBeDefined();
    expect(typeof res.body.ticketId).toBe("string");
    expect(res.body.ticketId.length).toBeGreaterThan(0);
  });

  it("logs security-level entry with standardized schema on write attempt", async () => {
    const req = mockReq({ method: "DELETE", params: { subAccountId: "22" }, url: "/api/test-delete" });
    const res = mockRes();
    await middleware(req, res, () => {});

    const logs = await db.select().from(systemLogs)
      .where(and(eq(systemLogs.severity, "security"), eq(systemLogs.module, "protected-account-guard")))
      .orderBy(desc(systemLogs.timestamp))
      .limit(1);

    expect(logs.length).toBe(1);
    const meta = logs[0].metadata as any;
    expect(meta.level).toBe("security");
    expect(meta.traceId).toBeDefined();
    expect(meta.userId).toBe("test-user");
    expect(meta.subAccountId).toBe(22);
    expect(meta.action).toBe("protected_account_write_attempt");
    expect(meta.meta.ip).toBeDefined();
    expect(meta.meta.reason).toContain("Blocked");
  });

  it("allows read requests to protected accounts (info audit)", async () => {
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
  it("blocks tool calls targeting protected account 22 with abort", async () => {
    const result = await verifyNotProtectedAccount(22, "test-agent");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("ABORT");
    expect(result!.error).toContain("protected account");
  });

  it("blocks tool calls targeting protected account 13", async () => {
    const result = await verifyNotProtectedAccount(13, "test-agent");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("ABORT");
  });

  it("allows tool calls to non-protected accounts", async () => {
    const result = await verifyNotProtectedAccount(1, "test-agent");
    expect(result).toBeNull();
  });

  it("creates security log entry with standardized schema on blocked attempt", async () => {
    const beforeLogs = await db.select({ id: systemLogs.id }).from(systemLogs)
      .where(and(eq(systemLogs.severity, "security"), eq(systemLogs.module, "agent-tenant-guard")));

    await verifyNotProtectedAccount(22, "simulation-agent");

    const afterLogs = await db.select().from(systemLogs)
      .where(and(eq(systemLogs.severity, "security"), eq(systemLogs.module, "agent-tenant-guard")))
      .orderBy(desc(systemLogs.timestamp));

    expect(afterLogs.length).toBeGreaterThan(beforeLogs.length);
    const latest = afterLogs[0];
    expect(latest.message).toContain("protected account 22");

    const meta = latest.metadata as any;
    expect(meta.level).toBe("security");
    expect(meta.traceId).toBeDefined();
    expect(meta.userId).toBe("simulation-agent");
    expect(meta.subAccountId).toBe(22);
    expect(meta.action).toBe("agent_protected_account_blocked");
    expect(meta.meta.agentId).toBe("simulation-agent");
    expect(meta.meta.reason).toContain("Protected account");
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

  it("flag ON + protected account POST returns 403 through full chain", async () => {
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
    expect(guardNextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error_code).toBe("sub_account_protected");
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

  it("flag ON + protected account GET (read) passes through full chain", async () => {
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
  it("verifyNotProtectedAccount returns blocking result for protected account in tool context", async () => {
    const result = await verifyNotProtectedAccount(22, "agent-runner-123");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("ABORT");
    expect(result!.error).toContain("protected account");
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
