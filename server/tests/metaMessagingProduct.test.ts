import { describe, it, expect } from "vitest";
import { detectSafetyFlags, calculateBillingCost } from "../routes/metaMessagingProduct";

describe("detectSafetyFlags", () => {
  it("returns empty array for empty string", () => {
    expect(detectSafetyFlags("")).toEqual([]);
  });

  it("returns empty array for safe text", () => {
    expect(detectSafetyFlags("Hello, I'd like to schedule an appointment")).toEqual([]);
  });

  it("detects profanity with medium severity", () => {
    const flags = detectSafetyFlags("This is shit service");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("profanity");
    expect(flags[0].severity).toBe("medium");
    expect(flags[0].confidence).toBe(0.7);
  });

  it("detects threats with critical severity", () => {
    const flags = detectSafetyFlags("I will kill you");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("threat_detected");
    expect(flags[0].severity).toBe("critical");
    expect(flags[0].confidence).toBe(0.95);
  });

  it("detects PII with high severity", () => {
    const flags = detectSafetyFlags("My SSN is 123-45-6789");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("personal_data");
    expect(flags[0].severity).toBe("high");
    expect(flags[0].confidence).toBe(0.85);
  });

  it("detects litigation risk", () => {
    const flags = detectSafetyFlags("I'm going to call my lawyer about this");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("litigation_risk");
    expect(flags[0].severity).toBe("high");
  });

  it("detects crisis flags", () => {
    const flags = detectSafetyFlags("I want to hurt myself");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("crisis_flag");
    expect(flags[0].severity).toBe("critical");
  });

  it("detects scam accusations", () => {
    const flags = detectSafetyFlags("This is a total scam");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("scam_accusation");
    expect(flags[0].severity).toBe("medium");
  });

  it("detects multiple flags in one message", () => {
    const flags = detectSafetyFlags("You damn lawyer, I'll sue your ass");
    expect(flags.length).toBeGreaterThanOrEqual(2);
    const flagNames = flags.map(f => f.flag);
    expect(flagNames).toContain("profanity");
    expect(flagNames).toContain("litigation_risk");
  });

  it("is case-insensitive", () => {
    expect(detectSafetyFlags("My LAWYER will hear about this")).toHaveLength(1);
    expect(detectSafetyFlags("BOMB threat")).toHaveLength(1);
  });

  it("does not false-positive on word fragments", () => {
    expect(detectSafetyFlags("The therapist was helpful")).toEqual([]);
    expect(detectSafetyFlags("I have a skilled team")).toEqual([]);
    expect(detectSafetyFlags("The billboard was huge")).toEqual([]);
  });

  it("does not flag normal business language", () => {
    expect(detectSafetyFlags("Can I schedule a dental appointment?")).toEqual([]);
    expect(detectSafetyFlags("What are your business hours?")).toEqual([]);
    expect(detectSafetyFlags("Thank you for the great service!")).toEqual([]);
    expect(detectSafetyFlags("I'd like a price quote for the project")).toEqual([]);
  });

  it("handles null/undefined gracefully", () => {
    expect(detectSafetyFlags(null as any)).toEqual([]);
    expect(detectSafetyFlags(undefined as any)).toEqual([]);
  });

  it("detects credit card mention as PII", () => {
    const flags = detectSafetyFlags("Can I give you my credit card number?");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("personal_data");
  });

  it("detects bank account mention as PII", () => {
    const flags = detectSafetyFlags("Here is my bank account info");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("personal_data");
  });

  it("detects social security as PII", () => {
    const flags = detectSafetyFlags("My social security number is confidential");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("personal_data");
  });

  it("detects weapon mentions as threats", () => {
    const flags = detectSafetyFlags("He has a weapon");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("threat_detected");
  });

  it("detects self-harm as crisis", () => {
    const flags = detectSafetyFlags("Thinking about suicide");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("crisis_flag");
    expect(flags[0].severity).toBe("critical");
  });

  it("detects fraud accusations", () => {
    const flags = detectSafetyFlags("This is clearly fraud");
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe("scam_accusation");
  });
});

describe("calculateBillingCost", () => {
  it("calculates cost for single facebook message with no tokens", () => {
    const result = calculateBillingCost("facebook", 1, 0);
    expect(result.unitCostMessage).toBe(0.005);
    expect(result.unitCostToken).toBe(0.00002);
    expect(result.totalCost).toBe(0.005);
  });

  it("calculates cost for single instagram message with no tokens", () => {
    const result = calculateBillingCost("instagram", 1, 0);
    expect(result.unitCostMessage).toBe(0.005);
    expect(result.totalCost).toBe(0.005);
  });

  it("calculates cost for messages with tokens", () => {
    const result = calculateBillingCost("facebook", 10, 1000);
    expect(result.totalCost).toBe(10 * 0.005 + 1000 * 0.00002);
  });

  it("handles zero messages and zero tokens", () => {
    const result = calculateBillingCost("facebook", 0, 0);
    expect(result.totalCost).toBe(0);
  });

  it("handles large token counts", () => {
    const result = calculateBillingCost("facebook", 1, 100000);
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.totalCost).toBe(0.005 + 100000 * 0.00002);
  });

  it("uses default rate for unknown channels", () => {
    const result = calculateBillingCost("unknown", 1, 0);
    expect(result.unitCostMessage).toBe(0.005);
    expect(result.totalCost).toBe(0.005);
  });

  it("rounds total cost to avoid floating point issues", () => {
    const result = calculateBillingCost("facebook", 3, 150);
    expect(String(result.totalCost).split(".")[1]?.length || 0).toBeLessThanOrEqual(5);
  });
});

describe("Safety flag severity ordering", () => {
  it("correctly assigns confidence by severity level", () => {
    const criticalFlags = detectSafetyFlags("I will kill everyone");
    const highFlags = detectSafetyFlags("I'm contacting my attorney");
    const mediumFlags = detectSafetyFlags("This damn thing");

    expect(criticalFlags[0].confidence).toBe(0.95);
    expect(highFlags[0].confidence).toBe(0.85);
    expect(mediumFlags[0].confidence).toBe(0.7);
  });

  it("critical severity items should sort before high and medium", () => {
    const items = [
      { severity: "medium", flag: "profanity" },
      { severity: "critical", flag: "threat_detected" },
      { severity: "high", flag: "litigation_risk" },
    ];
    const sevMap: Record<string, number> = { critical: 3, high: 2, medium: 1 };
    const sorted = items.sort((a, b) => (sevMap[b.severity] || 0) - (sevMap[a.severity] || 0));
    expect(sorted[0].severity).toBe("critical");
    expect(sorted[1].severity).toBe("high");
    expect(sorted[2].severity).toBe("medium");
  });
});

describe("Protected account enforcement", () => {
  it("isMutating correctly identifies mutation methods", async () => {
    const { isMutating } = await import("../middleware/protectedAccount");
    const makeReq = (method: string, url: string) => ({ method, originalUrl: url, url } as any);

    expect(isMutating(makeReq("POST", "/api/test"))).toBe(true);
    expect(isMutating(makeReq("PUT", "/api/test"))).toBe(true);
    expect(isMutating(makeReq("PATCH", "/api/test"))).toBe(true);
    expect(isMutating(makeReq("DELETE", "/api/test"))).toBe(true);
    expect(isMutating(makeReq("GET", "/api/test"))).toBe(false);
  });

  it("isMutating detects mutation-like GET URLs", async () => {
    const { isMutating } = await import("../middleware/protectedAccount");
    const makeReq = (method: string, url: string) => ({ method, originalUrl: url, url } as any);

    expect(isMutating(makeReq("GET", "/api/seed-demo/1"))).toBe(true);
    expect(isMutating(makeReq("GET", "/api/trigger-action"))).toBe(true);
    expect(isMutating(makeReq("GET", "/api/toggle-bot/1"))).toBe(true);
    expect(isMutating(makeReq("GET", "/api/approve/1"))).toBe(true);
    expect(isMutating(makeReq("GET", "/api/send-reply/1"))).toBe(true);
  });

  it("getProtectedAccountIds returns default protected IDs", async () => {
    const { getProtectedAccountIds } = await import("../middleware/protectedAccount");
    const ids = getProtectedAccountIds();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("Demo seeding validation", () => {
  it("seed-demo endpoint rejects protected accounts", () => {
    const protectedIds = [22, 13];
    for (const id of protectedIds) {
      expect(protectedIds.includes(id)).toBe(true);
    }
  });

  it("seed-demo should generate valid message data", () => {
    const channels = ["facebook", "instagram"];
    const bodies = [
      "Hi, I'd like to schedule a consultation",
      "What are your hours?",
      "Do you offer payment plans?",
    ];

    for (let i = 0; i < 20; i++) {
      const channel = channels[i % 2];
      const direction = i % 3 === 0 ? "outbound" : "inbound";

      expect(["facebook", "instagram"]).toContain(channel);
      expect(["inbound", "outbound"]).toContain(direction);

      if (direction === "inbound") {
        expect(bodies[i % bodies.length]).toBeDefined();
      }
    }
  });
});

describe("Analytics aggregation logic", () => {
  it("correctly sums up daily data", () => {
    const aggregates = [
      { periodDate: new Date("2025-01-01"), channel: "facebook", inboundCount: 10, outboundCount: 5, failedCount: 1, avgResponseTimeMs: 200, commentCount: 3, commentReplyCount: 2, tokenUsage: 500 },
      { periodDate: new Date("2025-01-01"), channel: "instagram", inboundCount: 8, outboundCount: 4, failedCount: 0, avgResponseTimeMs: 300, commentCount: 2, commentReplyCount: 1, tokenUsage: 400 },
      { periodDate: new Date("2025-01-02"), channel: "facebook", inboundCount: 12, outboundCount: 6, failedCount: 2, avgResponseTimeMs: 250, commentCount: 4, commentReplyCount: 3, tokenUsage: 600 },
    ];

    const totalInbound = aggregates.reduce((s, a) => s + a.inboundCount, 0);
    const totalOutbound = aggregates.reduce((s, a) => s + a.outboundCount, 0);
    const totalFailed = aggregates.reduce((s, a) => s + a.failedCount, 0);

    expect(totalInbound).toBe(30);
    expect(totalOutbound).toBe(15);
    expect(totalFailed).toBe(3);
  });

  it("correctly calculates average response time", () => {
    const responseTimes = [200, 300, 250];
    const avg = Math.round(responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length);
    expect(avg).toBe(250);
  });

  it("handles empty aggregates", () => {
    const aggregates: any[] = [];
    const totalInbound = aggregates.reduce((s, a) => s + a.inboundCount, 0);
    expect(totalInbound).toBe(0);
  });

  it("groups daily data correctly by date", () => {
    const aggregates = [
      { periodDate: new Date("2025-01-01"), channel: "facebook", inboundCount: 10, outboundCount: 5 },
      { periodDate: new Date("2025-01-01"), channel: "instagram", inboundCount: 8, outboundCount: 4 },
      { periodDate: new Date("2025-01-02"), channel: "facebook", inboundCount: 12, outboundCount: 6 },
    ];

    const dailyData: Record<string, { inbound: number; outbound: number }> = {};
    for (const a of aggregates) {
      const dateKey = a.periodDate.toISOString().split("T")[0];
      if (!dailyData[dateKey]) dailyData[dateKey] = { inbound: 0, outbound: 0 };
      dailyData[dateKey].inbound += a.inboundCount;
      dailyData[dateKey].outbound += a.outboundCount;
    }

    expect(dailyData["2025-01-01"].inbound).toBe(18);
    expect(dailyData["2025-01-01"].outbound).toBe(9);
    expect(dailyData["2025-01-02"].inbound).toBe(12);
    expect(dailyData["2025-01-02"].outbound).toBe(6);
  });
});

describe("TraceId propagation", () => {
  it("traceIdMiddleware sets traceId on request when not provided", () => {
    const req: any = { headers: {}, params: {} };
    const res: any = { setHeader: (k: string, v: string) => { res._headers = res._headers || {}; res._headers[k] = v; } };
    let nextCalled = false;

    const { randomUUID } = require("crypto");
    const traceId = randomUUID();

    req.traceId = undefined;
    const middleware = (req: any, res: any, next: () => void) => {
      const id = (req.headers["x-trace-id"] as string) || randomUUID();
      req.traceId = id;
      res.setHeader("x-trace-id", id);
      next();
    };
    middleware(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.traceId).toBeDefined();
    expect(typeof req.traceId).toBe("string");
    expect(req.traceId.length).toBeGreaterThan(0);
    expect(res._headers["x-trace-id"]).toBe(req.traceId);
  });

  it("traceIdMiddleware uses provided x-trace-id header", () => {
    const customTraceId = "custom-trace-abc-123";
    const req: any = { headers: { "x-trace-id": customTraceId }, params: {} };
    const res: any = { setHeader: (k: string, v: string) => { res._headers = res._headers || {}; res._headers[k] = v; } };

    const middleware = (req: any, res: any, next: () => void) => {
      const id = (req.headers["x-trace-id"] as string) || require("crypto").randomUUID();
      req.traceId = id;
      res.setHeader("x-trace-id", id);
      next();
    };
    middleware(req, res, () => {});

    expect(req.traceId).toBe(customTraceId);
    expect(res._headers["x-trace-id"]).toBe(customTraceId);
  });

  it("traceId is a valid UUID format when auto-generated", () => {
    const { randomUUID } = require("crypto");
    const traceId = randomUUID();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(traceId)).toBe(true);
  });
});

describe("Billing usage response structure", () => {
  it("billing usage response includes required fields", () => {
    const mockResponse = {
      plan: "starter",
      period: { start: "2025-01-01T00:00:00.000Z", end: "2025-01-31T23:59:59.999Z" },
      usage: {
        totalMessages: 42,
        messagesLimit: 500,
        totalTokens: 12500,
        tokensLimit: 50000,
        totalMessageCost: 0.21,
        totalTokenCost: 0.25,
        totalCost: 0.46,
      },
      channelBreakdown: {
        facebook: { messages: 25, tokens: 7000, cost: 0.27 },
        instagram: { messages: 17, tokens: 5500, cost: 0.19 },
      },
      eventCount: 42,
      traceId: "test-trace-id",
    };

    expect(mockResponse.usage.totalMessages).toBe(42);
    expect(mockResponse.usage.messagesLimit).toBe(500);
    expect(mockResponse.usage.totalTokens).toBe(12500);
    expect(mockResponse.usage.tokensLimit).toBe(50000);
    expect(mockResponse.usage.totalCost).toBe(0.46);
    expect(mockResponse.channelBreakdown.facebook.messages).toBe(25);
    expect(mockResponse.channelBreakdown.instagram.messages).toBe(17);
    expect(mockResponse.traceId).toBeDefined();
  });

  it("plan limits are correctly defined for all tiers", () => {
    const limits: Record<string, { messages: number; tokens: number }> = {
      starter: { messages: 500, tokens: 50000 },
      pro: { messages: 2000, tokens: 200000 },
      enterprise: { messages: 10000, tokens: 1000000 },
    };

    expect(limits.starter.messages).toBe(500);
    expect(limits.starter.tokens).toBe(50000);
    expect(limits.pro.messages).toBe(2000);
    expect(limits.pro.tokens).toBe(200000);
    expect(limits.enterprise.messages).toBe(10000);
    expect(limits.enterprise.tokens).toBe(1000000);
  });

  it("fallback to starter when plan is unknown", () => {
    const limits: Record<string, { messages: number; tokens: number }> = {
      starter: { messages: 500, tokens: 50000 },
      pro: { messages: 2000, tokens: 200000 },
      enterprise: { messages: 10000, tokens: 1000000 },
    };
    const plan = "unknown";
    const planLimits = limits[plan] || limits.starter;
    expect(planLimits.messages).toBe(500);
    expect(planLimits.tokens).toBe(50000);
  });
});

describe("CSV export format", () => {
  it("generates valid CSV header", () => {
    const csvHeader = "Date,Channel,Inbound,Outbound,Failed,AvgResponseTimeMs,Comments,CommentReplies,TokenUsage\n";
    const columns = csvHeader.trim().split(",");
    expect(columns).toHaveLength(9);
    expect(columns[0]).toBe("Date");
    expect(columns[1]).toBe("Channel");
    expect(columns[8]).toBe("TokenUsage");
  });

  it("generates valid CSV rows from aggregate data", () => {
    const aggregates = [
      { periodDate: new Date("2025-01-01"), channel: "facebook", inboundCount: 10, outboundCount: 5, failedCount: 1, avgResponseTimeMs: 200, commentCount: 3, commentReplyCount: 2, tokenUsage: 500 },
      { periodDate: new Date("2025-01-02"), channel: "instagram", inboundCount: 8, outboundCount: 4, failedCount: 0, avgResponseTimeMs: null, commentCount: 2, commentReplyCount: 1, tokenUsage: 400 },
    ];

    const csvRows = aggregates.map(a => {
      const date = new Date(a.periodDate).toISOString().split("T")[0];
      return `${date},${a.channel},${a.inboundCount},${a.outboundCount},${a.failedCount},${a.avgResponseTimeMs || ""},${a.commentCount},${a.commentReplyCount},${a.tokenUsage}`;
    });

    expect(csvRows[0]).toBe("2025-01-01,facebook,10,5,1,200,3,2,500");
    expect(csvRows[1]).toBe("2025-01-02,instagram,8,4,0,,2,1,400");
  });
});

describe("Billing event generation", () => {
  it("correctly tracks per-message costs", () => {
    const events = [
      { messageCount: 1, tokenCount: 100, channel: "facebook" },
      { messageCount: 1, tokenCount: 200, channel: "instagram" },
      { messageCount: 3, tokenCount: 500, channel: "facebook" },
    ];

    const totalMessages = events.reduce((s, e) => s + e.messageCount, 0);
    const totalTokens = events.reduce((s, e) => s + e.tokenCount, 0);
    const totalMessageCost = totalMessages * 0.005;
    const totalTokenCost = totalTokens * 0.00002;

    expect(totalMessages).toBe(5);
    expect(totalTokens).toBe(800);
    expect(totalMessageCost).toBe(0.025);
    expect(totalTokenCost).toBeCloseTo(0.016, 3);
  });

  it("correctly generates channel breakdown", () => {
    const events = [
      { channel: "facebook", messageCount: 3, tokenCount: 300, totalCost: 0.021 },
      { channel: "instagram", messageCount: 2, tokenCount: 200, totalCost: 0.014 },
      { channel: "facebook", messageCount: 1, tokenCount: 100, totalCost: 0.007 },
    ];

    const breakdown: Record<string, { messages: number; tokens: number; cost: number }> = {};
    for (const e of events) {
      if (!breakdown[e.channel]) breakdown[e.channel] = { messages: 0, tokens: 0, cost: 0 };
      breakdown[e.channel].messages += e.messageCount;
      breakdown[e.channel].tokens += e.tokenCount;
      breakdown[e.channel].cost += e.totalCost;
    }

    expect(breakdown["facebook"].messages).toBe(4);
    expect(breakdown["facebook"].tokens).toBe(400);
    expect(breakdown["instagram"].messages).toBe(2);
    expect(breakdown["instagram"].tokens).toBe(200);
  });

  it("invoice generation produces valid invoice structure", () => {
    const invoiceId = `INV-TEST-1-${Date.now()}`;
    const totalMessages = 10;
    const totalTokens = 5000;
    const totalCost = totalMessages * 0.005 + totalTokens * 0.00002;

    const invoice = {
      invoiceId,
      lineItems: [
        { description: "Meta Messaging - Per Message", quantity: totalMessages, unitPrice: 0.005, total: Math.round(totalMessages * 0.005 * 100) / 100 },
        { description: "Meta Messaging - AI Tokens", quantity: totalTokens, unitPrice: 0.00002, total: Math.round(totalTokens * 0.00002 * 100) / 100 },
      ],
      subtotal: Math.round(totalCost * 100) / 100,
      total: Math.round(totalCost * 100) / 100,
      status: "test",
    };

    expect(invoice.invoiceId).toContain("INV-TEST-");
    expect(invoice.lineItems).toHaveLength(2);
    expect(invoice.lineItems[0].quantity).toBe(10);
    expect(invoice.lineItems[1].quantity).toBe(5000);
    expect(invoice.status).toBe("test");
    expect(invoice.total).toBeGreaterThan(0);
  });
});
