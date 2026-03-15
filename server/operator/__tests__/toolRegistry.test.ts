import { describe, it, expect, beforeAll } from "vitest";

let registryModule: typeof import("../toolRegistry");

beforeAll(async () => {
  registryModule = await import("../toolRegistry");
});

describe("Tool Registry", () => {
  it("registers at least 63 tools", () => {
    const tools = registryModule.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(63);
  });

  it("getToolManifest returns all tools with required fields", () => {
    const manifest = registryModule.getToolManifest();
    expect(manifest.length).toBeGreaterThanOrEqual(63);
    for (const tool of manifest) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("category");
      expect(tool).toHaveProperty("requiresApproval");
      expect(tool).toHaveProperty("autonomyRequired");
      expect(tool).toHaveProperty("parameters");
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.requiresApproval).toBe("boolean");
    }
  });

  it("getToolCategories covers exactly the 8 target categories", () => {
    const categories = registryModule.getToolCategories();
    const categoryNames = categories.map(c => c.category);
    const targetCategories = ["crm", "messaging", "workflow", "appointment", "campaign", "creative", "review", "intelligence"];
    for (const cat of targetCategories) {
      expect(categoryNames).toContain(cat);
    }
    expect(categoryNames).not.toContain("integration");
  });

  it("getTool returns a valid tool for each known tool name", () => {
    const knownTools = [
      "createContact", "sendTestSMS", "diagnoseWorkflow",
      "createAppointmentDraft", "launchCampaignDraft",
      "generateLandingPage", "respondToReviewDraft",
      "detectMissingSetup", "connectIntegration",
    ];
    for (const name of knownTools) {
      const tool = registryModule.getTool(name);
      expect(tool).toBeDefined();
      expect(tool!.name).toBe(name);
      expect(typeof tool!.execute).toBe("function");
    }
  });

  it("getTool returns undefined for unknown tools", () => {
    expect(registryModule.getTool("nonExistentTool")).toBeUndefined();
  });

  it("listToolsForPlanner returns planner metadata for all tools", () => {
    const plannerTools = registryModule.listToolsForPlanner();
    expect(plannerTools.length).toBeGreaterThanOrEqual(63);
    for (const t of plannerTools) {
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("category");
      expect(t).toHaveProperty("autonomyLevel");
      expect(t).toHaveProperty("requiresApproval");
      expect(t).toHaveProperty("parameterNames");
      expect(Array.isArray(t.parameterNames)).toBe(true);
    }
  });

  it("listToolsByCategory returns only tools of that category", () => {
    const crmTools = registryModule.listToolsByCategory("crm");
    expect(crmTools.length).toBeGreaterThanOrEqual(10);
    for (const tool of crmTools) {
      expect(tool.category).toBe("crm");
    }
  });

  it("listToolsByAutonomy returns tools filtered by autonomy level", () => {
    const observeTools = registryModule.listToolsByAutonomy("observe");
    expect(observeTools.length).toBeGreaterThan(0);
    for (const tool of observeTools) {
      expect(tool.autonomyRequired).toBe("observe");
    }
  });

  it("getToolRegistry returns a wrapped Map for planExecutor compatibility", () => {
    const registry = registryModule.getToolRegistry();
    expect(registry instanceof Map).toBe(true);
    expect(registry.size).toBeGreaterThanOrEqual(63);

    const tool = registry.get("createContact");
    expect(tool).toBeDefined();
    expect(typeof tool!.execute).toBe("function");
  });

  it("executeTool rejects unknown tools", async () => {
    const result = await registryModule.executeTool("unknownTool", {}, {
      subAccountId: 1,
      autonomyLevel: "execute",
      sessionId: "test",
      correlationId: "test-1",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  it("executeTool validates required parameters", async () => {
    const result = await registryModule.executeTool("createContact", {}, {
      subAccountId: 1,
      autonomyLevel: "execute",
      sessionId: "approved",
      correlationId: "test-2",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("validation");
  });

  it("executeTool blocks observe-only mode for draft/execute tools", async () => {
    const result = await registryModule.executeTool("createContact", { firstName: "Test" }, {
      subAccountId: 1,
      autonomyLevel: "observe",
      sessionId: "test",
      correlationId: "test-3",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("observe-only");
  });

  it("executeTool enforces approval for draft autonomy without approved session", async () => {
    const result = await registryModule.executeTool("sendTestSMS", { to: "+15551234567" }, {
      subAccountId: 1,
      autonomyLevel: "draft",
      sessionId: "agent-123",
      correlationId: "test-4",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires approval");
  });

  it("executeTool allows approval-gated tools at execute autonomy level", async () => {
    const result = await registryModule.executeTool("sendLiveSMSDraft", { to: "+15551234567", body: "test" }, {
      subAccountId: 1,
      autonomyLevel: "execute",
      sessionId: "some-session",
      correlationId: "test-4b",
    });
    expect(result.success).toBe(true);
  });

  it("executeToolWithAudit returns structured result", async () => {
    const result = await registryModule.executeToolWithAudit("unknownTool", {}, {
      subAccountId: 1,
      autonomyLevel: "execute",
      sessionId: "test",
      correlationId: "test-5",
    });
    expect(result).toHaveProperty("toolName", "unknownTool");
    expect(result).toHaveProperty("status", "failure");
    expect(result).toHaveProperty("auditLog");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("timestamp");
  });

  it("tools with requiresApproval=true include draft-producing tools", () => {
    const approvalTools = registryModule.listTools().filter(t => t.requiresApproval);
    expect(approvalTools.length).toBeGreaterThan(0);
    const draftToolNames = approvalTools.map(t => t.name);
    expect(draftToolNames).toContain("sendTestSMS");
    expect(draftToolNames).toContain("createAppointmentDraft");
    expect(draftToolNames).toContain("launchCampaignDraft");
  });

  it("observe tools do not require approval", () => {
    const observeTools = registryModule.listToolsByAutonomy("observe");
    for (const tool of observeTools) {
      expect(tool.requiresApproval).toBe(false);
    }
  });

  it("all tools have unique names", () => {
    const tools = registryModule.listTools();
    const names = tools.map(t => t.name);
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  it("idempotent tools have idempotencyKey functions", () => {
    const idempotentTools = ["createTask", "createWorkflow", "createEmailCampaignDraft", "createNurtureSequenceDraft", "launchCampaignDraft"];
    for (const name of idempotentTools) {
      const tool = registryModule.getTool(name);
      expect(tool).toBeDefined();
      expect(typeof tool!.idempotencyKey).toBe("function");
    }
  });

  it("summarizeForAudit produces string output", () => {
    const tool = registryModule.getTool("createContact");
    expect(tool).toBeDefined();
    expect(tool!.summarizeForAudit).toBeDefined();
    const summary = tool!.summarizeForAudit!({ firstName: "Jane", lastName: "Doe" }, { success: true });
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });

  describe("planExecutor path (getToolRegistry wrapper)", () => {
    it("routes (accountId, payload) through executeTool with validation", async () => {
      const registry = registryModule.getToolRegistry();
      const tool = registry.get("createContact");
      expect(tool).toBeDefined();

      const result = await tool!.execute(1, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("validation");
    });

    it("allows approved tools through planExecutor path", async () => {
      const registry = registryModule.getToolRegistry();
      const tool = registry.get("sendLiveSMSDraft");
      expect(tool).toBeDefined();

      const result = await tool!.execute(1, { to: "+15551234567", body: "test" });
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("draft");
    });

    it("validates Zod schemas through planExecutor path", async () => {
      const registry = registryModule.getToolRegistry();
      const tool = registry.get("connectIntegration");
      expect(tool).toBeDefined();

      const resultBad = await tool!.execute(1, {});
      expect(resultBad.success).toBe(false);
      expect(resultBad.error).toContain("validation");

      const resultGood = await tool!.execute(1, { provider: "twilio" });
      expect(resultGood.success).toBe(true);
    });
  });

  it("connectIntegration has a Zod schema", () => {
    const tool = registryModule.getTool("connectIntegration");
    expect(tool).toBeDefined();
    const result = registryModule.executeTool("connectIntegration", {}, {
      subAccountId: 1,
      autonomyLevel: "execute",
      sessionId: "approved",
      correlationId: "test-schema",
    });
    return result.then(r => {
      expect(r.success).toBe(false);
      expect(r.error).toContain("validation");
    });
  });

  describe("representative tool executions", () => {
    const approvedCtx = {
      subAccountId: 1,
      autonomyLevel: "execute" as const,
      sessionId: "approved",
      correlationId: "rep-test",
    };

    it("respondToReviewDraft validates review ownership", async () => {
      const result = await registryModule.executeTool("respondToReviewDraft", {
        reviewId: 999,
        responseText: "Thank you for your feedback!",
      }, approvedCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("compareToIndustryBenchmark returns benchmark data", async () => {
      const result = await registryModule.executeTool("compareToIndustryBenchmark", {
        industry: "restaurant",
      }, { ...approvedCtx, autonomyLevel: "observe" });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("industry");
    });

    it("adjustAdBudgetDraft validates campaign ownership", async () => {
      const result = await registryModule.executeTool("adjustAdBudgetDraft", {
        campaignId: 99999,
        newBudget: 50,
      }, approvedCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("detectMissingSetup validates schema (no required params)", async () => {
      const tool = registryModule.getTool("detectMissingSetup");
      expect(tool).toBeDefined();
      expect(tool!.autonomyRequired).toBe("observe");
      expect(tool!.requiresApproval).toBe(false);
    });

    it("createAppointmentDraft validates required parameters", async () => {
      const result = await registryModule.executeTool("createAppointmentDraft", {
        contactId: 1,
      }, approvedCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("validation");
    });

    it("generateLandingPage validates required parameters", async () => {
      const result = await registryModule.executeTool("generateLandingPage", {}, approvedCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("validation");
    });

    it("connectIntegration success path returns instructions", async () => {
      const result = await registryModule.executeTool("connectIntegration", {
        provider: "google",
      }, { ...approvedCtx, autonomyLevel: "observe" });
      expect(result.success).toBe(true);
      expect(result.data?.type).toBe("oauth");
      expect(result.data?.provider).toBe("google");
    });
  });
});
