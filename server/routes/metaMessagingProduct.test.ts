import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE = "/api/meta-messaging/product";

function mockRequest(path: string, options: any = {}) {
  const url = `http://localhost:5000${path}`;
  return fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
}

describe("Meta Messaging Product Routes", () => {
  describe("POST /create-subaccount", () => {
    it("should reject unauthenticated requests", async () => {
      const res = await mockRequest(`${BASE}/create-subaccount`, {
        method: "POST",
        body: JSON.stringify({ name: "Test Account" }),
      });
      expect(res.status).toBe(401);
    });

    it("should reject invalid name", async () => {
      const res = await mockRequest(`${BASE}/create-subaccount`, {
        method: "POST",
        body: JSON.stringify({ name: "" }),
      });
      expect([400, 401]).toContain(res.status);
    });
  });

  describe("POST /meta/oauth/start", () => {
    it("should reject without subAccountId", async () => {
      const res = await mockRequest(`${BASE}/meta/oauth/start`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect([400, 401]).toContain(res.status);
    });
  });

  describe("POST /test-webhook", () => {
    it("should reject without subAccountId", async () => {
      const res = await mockRequest(`${BASE}/test-webhook`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect([400, 401]).toContain(res.status);
    });
  });

  describe("GET /inbox/:subAccountId", () => {
    it("should reject unauthenticated", async () => {
      const res = await mockRequest(`${BASE}/inbox/1`);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /approve-send/:subAccountId", () => {
    it("should require Idempotency-Key header", async () => {
      const res = await mockRequest(`${BASE}/approve-send/1`, {
        method: "POST",
        body: JSON.stringify({ finalText: "Hello" }),
      });
      expect([400, 401]).toContain(res.status);
    });

    it("should reject without finalText", async () => {
      const res = await mockRequest(`${BASE}/approve-send/1`, {
        method: "POST",
        headers: { "Idempotency-Key": "test-key-123" },
        body: JSON.stringify({}),
      });
      expect([400, 401]).toContain(res.status);
    });
  });

  describe("GET /demo-inbox", () => {
    it("should return demo inbox data", async () => {
      const res = await mockRequest(`${BASE}/demo-inbox`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.mode).toBe("demo");
    });

    it("should include AI suggestions in demo data", async () => {
      const res = await mockRequest(`${BASE}/demo-inbox`);
      const data = await res.json();
      const withSuggestion = data.items.find((i: any) => i.aiSuggestion);
      expect(withSuggestion).toBeDefined();
      expect(withSuggestion.aiSuggestion.modelVersion).toBeDefined();
      expect(withSuggestion.aiSuggestion.confidence).toBeDefined();
      expect(withSuggestion.aiSuggestion.text).toBeDefined();
    });

    it("should include all four channel types in demo data", async () => {
      const res = await mockRequest(`${BASE}/demo-inbox`);
      const data = await res.json();
      const channels = new Set(data.items.map((i: any) => i.channel));
      expect(channels.has("fb_dm")).toBe(true);
      expect(channels.has("ig_dm")).toBe(true);
      expect(channels.has("fb_comment")).toBe(true);
      expect(channels.has("ig_comment")).toBe(true);
    });
  });

  describe("POST /workflows/generate", () => {
    it("should reject without subAccountId", async () => {
      const res = await mockRequest(`${BASE}/workflows/generate`, {
        method: "POST",
        body: JSON.stringify({ industry: "coaching" }),
      });
      expect([400, 401]).toContain(res.status);
    });
  });
});
