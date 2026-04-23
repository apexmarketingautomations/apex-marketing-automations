import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const APEX_BASE_URL = process.env.APEX_BASE_URL || "https://apexmarketingautomations.com";
const APEX_ADMIN_SECRET = process.env.STANDALONE_ADMIN_SECRET || "201120062017";
const DEFAULT_SUB_ACCOUNT_ID = 13;

async function apexFetch(path, { method = "GET", body, subAccountId, query } = {}) {
  let url = path.startsWith("http") ? path : `${APEX_BASE_URL}${path}`;
  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
    ).toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  const headers = {
    "x-admin-secret": APEX_ADMIN_SECRET,
    "x-sub-account-id": String(subAccountId ?? DEFAULT_SUB_ACCOUNT_ID),
    "Content-Type": "application/json",
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { ok: res.ok, status: res.status, body: parsed };
}

const SUB = { type: "number", description: "Sub-account ID (default 13)" };

const tools = [
  // ════════ CONTACTS ════════
  {
    name: "list_contacts",
    description: "List all contacts for a sub-account.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch(`/api/contacts/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}`),
  },
  {
    name: "get_contact",
    description: "Get full detail for a specific contact by ID.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: { id: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId }) =>
      apexFetch(`/api/contacts/detail/${id}`, { subAccountId }),
  },
  {
    name: "create_contact",
    description: "Create a new contact.",
    inputSchema: {
      type: "object", required: ["firstName"],
      properties: {
        subAccountId: SUB,
        firstName: { type: "string" }, lastName: { type: "string" },
        email: { type: "string" }, phone: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        source: { type: "string" }, notes: { type: "string" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/contacts", { method: "POST", body, subAccountId }),
  },
  {
    name: "update_contact",
    description: "Update a contact (any field including tags array).",
    inputSchema: {
      type: "object", required: ["id"],
      properties: {
        id: { type: "number" }, subAccountId: SUB,
        firstName: { type: "string" }, lastName: { type: "string" },
        email: { type: "string" }, phone: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        notes: { type: "string" }, status: { type: "string" },
      },
    },
    handler: ({ id, subAccountId, ...body }) =>
      apexFetch(`/api/contacts/${id}`, { method: "PATCH", body, subAccountId }),
  },
  {
    name: "delete_contact",
    description: "Delete a contact by ID.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: { id: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId }) =>
      apexFetch(`/api/contacts/${id}`, { method: "DELETE", subAccountId }),
  },
  {
    name: "tag_contact",
    description: "Add or replace tags on a contact (convenience wrapper around update_contact).",
    inputSchema: {
      type: "object", required: ["id", "tags"],
      properties: {
        id: { type: "number" }, subAccountId: SUB,
        tags: { type: "array", items: { type: "string" } },
      },
    },
    handler: ({ id, subAccountId, tags }) =>
      apexFetch(`/api/contacts/${id}`, { method: "PATCH", body: { tags }, subAccountId }),
  },
  {
    name: "skip_trace_save_contact",
    description: "Save a skip-traced lead as a CRM contact.",
    inputSchema: {
      type: "object",
      properties: {
        subAccountId: SUB,
        firstName: { type: "string" }, lastName: { type: "string" },
        email: { type: "string" }, phone: { type: "string" },
        address: { type: "string" }, source: { type: "string" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/skip-trace/save-contact", { method: "POST", body, subAccountId }),
  },
  {
    name: "skip_trace_bulk",
    description: "Bulk skip-trace search for contact information across many records.",
    inputSchema: {
      type: "object", required: ["records"],
      properties: {
        subAccountId: SUB,
        records: { type: "array", description: "Array of input records to skip-trace" },
      },
    },
    handler: ({ subAccountId, records }) =>
      apexFetch("/api/skip-trace/bulk", { method: "POST", body: { records }, subAccountId }),
  },

  // ════════ CONTENT PLANNER ════════
  {
    name: "list_content_posts",
    description: "List content planner posts. Filter by status: draft, scheduled, published, etc.",
    inputSchema: {
      type: "object",
      properties: { subAccountId: SUB, status: { type: "string" } },
    },
    handler: ({ subAccountId, status }) =>
      apexFetch("/api/content-planner/posts", { subAccountId, query: { status } }),
  },
  {
    name: "create_content_post",
    description: "Create or schedule a new content planner post.",
    inputSchema: {
      type: "object",
      properties: {
        subAccountId: SUB,
        title: { type: "string" }, caption: { type: "string" },
        hashtags: { type: "string" }, callToAction: { type: "string" },
        firstComment: { type: "string" }, contentType: { type: "string" },
        scheduledAt: { type: "string", description: "ISO datetime" },
        status: { type: "string" },
        platforms: { type: "array" },
        mediaIds: { type: "array", items: { type: "number" } },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/content-planner/posts", { method: "POST", body, subAccountId }),
  },
  {
    name: "update_content_post",
    description: "Update a content post — also used for rescheduling (set scheduledAt).",
    inputSchema: {
      type: "object", required: ["id"],
      properties: {
        id: { type: "number" }, subAccountId: SUB,
        title: { type: "string" }, caption: { type: "string" },
        hashtags: { type: "string" }, scheduledAt: { type: "string" },
        status: { type: "string" },
      },
    },
    handler: ({ id, subAccountId, ...body }) =>
      apexFetch(`/api/content-planner/posts/${id}`, { method: "PUT", body, subAccountId }),
  },
  {
    name: "publish_content_post",
    description: "Publish a content post immediately by setting status=published.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: { id: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId }) =>
      apexFetch(`/api/content-planner/posts/${id}`, {
        method: "PUT", body: { status: "published", scheduledAt: new Date().toISOString() }, subAccountId,
      }),
  },
  {
    name: "reschedule_content_post",
    description: "Reschedule a content post to a new datetime.",
    inputSchema: {
      type: "object", required: ["id", "scheduledAt"],
      properties: {
        id: { type: "number" }, subAccountId: SUB,
        scheduledAt: { type: "string", description: "ISO datetime" },
      },
    },
    handler: ({ id, subAccountId, scheduledAt }) =>
      apexFetch(`/api/content-planner/posts/${id}`, {
        method: "PUT", body: { scheduledAt, status: "scheduled" }, subAccountId,
      }),
  },
  {
    name: "delete_content_post",
    description: "Delete a content planner post.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: { id: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId }) =>
      apexFetch(`/api/content-planner/posts/${id}`, { method: "DELETE", subAccountId }),
  },
  {
    name: "get_content_calendar",
    description: "Get content posts formatted for calendar view.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch("/api/content-planner/calendar", { subAccountId }),
  },
  {
    name: "get_social_connections",
    description: "List connected social accounts (Facebook, Instagram, X, TikTok).",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch("/api/content-planner/connections", { subAccountId }),
  },
  {
    name: "get_content_library",
    description: "List items in the content library (media assets).",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch("/api/content-planner/library", { subAccountId }),
  },
  {
    name: "request_content_approval",
    description: "Request approval for a content post.",
    inputSchema: {
      type: "object", required: ["postId"],
      properties: {
        postId: { type: "number" }, subAccountId: SUB,
        approverEmail: { type: "string" }, message: { type: "string" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/content-planner/approvals", { method: "POST", body, subAccountId }),
  },
  {
    name: "decide_content_approval",
    description: "Approve or reject a content post.",
    inputSchema: {
      type: "object", required: ["id", "decision"],
      properties: {
        id: { type: "number" }, subAccountId: SUB,
        decision: { type: "string", enum: ["approved", "rejected"] },
        reason: { type: "string" },
      },
    },
    handler: ({ id, subAccountId, ...body }) =>
      apexFetch(`/api/content-planner/approvals/${id}`, { method: "PUT", body, subAccountId }),
  },

  // ════════ AUTOMATIONS / WORKFLOWS ════════
  {
    name: "list_workflows",
    description: "List all automations / workflows.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) => apexFetch("/api/workflows", { subAccountId }),
  },
  {
    name: "create_workflow",
    description: "Create a new workflow with trigger + steps.",
    inputSchema: {
      type: "object", required: ["name"],
      properties: {
        subAccountId: SUB,
        name: { type: "string" }, triggerType: { type: "string" },
        steps: { type: "array" }, active: { type: "boolean" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/workflows", { method: "POST", body, subAccountId }),
  },
  {
    name: "update_workflow",
    description: "Update workflow steps, triggers, or active state.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: {
        id: { type: "number" }, subAccountId: SUB,
        name: { type: "string" }, triggerType: { type: "string" },
        steps: { type: "array" }, active: { type: "boolean" },
      },
    },
    handler: ({ id, subAccountId, ...body }) =>
      apexFetch(`/api/workflows/${id}`, { method: "PATCH", body, subAccountId }),
  },
  {
    name: "toggle_workflow",
    description: "Turn a workflow on or off.",
    inputSchema: {
      type: "object", required: ["id", "active"],
      properties: { id: { type: "number" }, active: { type: "boolean" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId, active }) =>
      apexFetch(`/api/workflows/${id}`, { method: "PATCH", body: { active }, subAccountId }),
  },
  {
    name: "generate_workflow",
    description: "AI-generate a workflow from a natural language description.",
    inputSchema: {
      type: "object", required: ["prompt"],
      properties: {
        subAccountId: SUB,
        prompt: { type: "string" }, name: { type: "string" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/workflows/generate", { method: "POST", body, subAccountId }),
  },
  {
    name: "get_workflow_analytics",
    description: "Get performance/funnel analytics for a workflow.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: { id: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId }) =>
      apexFetch(`/api/workflows/${id}/analytics`, { subAccountId }),
  },
  {
    name: "get_workflow_optimization_log",
    description: "View auto-optimization history for a workflow.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: { id: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId }) =>
      apexFetch(`/api/workflows/${id}/optimization-log`, { subAccountId }),
  },

  // ════════ META ADS ════════
  {
    name: "list_ad_campaigns",
    description: "List Meta ad campaigns for a sub-account.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch(`/api/meta/campaigns/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}`),
  },
  {
    name: "create_ad_campaign",
    description: "Create a Meta ad campaign record (use publish_ad_campaign to push live).",
    inputSchema: {
      type: "object", required: ["name"],
      properties: {
        subAccountId: SUB,
        name: { type: "string" }, objective: { type: "string" },
        dailyBudget: { type: "number" }, lifetimeBudget: { type: "number" },
        status: { type: "string" }, adSets: { type: "array" }, ads: { type: "array" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/meta/campaigns", { method: "POST", body, subAccountId }),
  },
  {
    name: "publish_ad_campaign",
    description: "Push a campaign live to the Meta Ads API.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: { id: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId }) =>
      apexFetch(`/api/meta/campaigns/${id}/publish`, { method: "POST", subAccountId }),
  },
  {
    name: "sync_ad_campaign_insights",
    description: "Fetch latest spend, impressions, clicks, leads, ROAS for a campaign from Meta.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: { id: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId }) =>
      apexFetch(`/api/meta/campaigns/${id}/sync`, { method: "POST", subAccountId }),
  },
  {
    name: "list_meta_leads",
    description: "List leads captured via Meta Lead Forms.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch(`/api/meta/leads/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}`),
  },
  {
    name: "sync_meta_leads",
    description: "Manually pull latest Meta Lead Forms leads.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch(`/api/meta/leads/sync/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}`, { method: "POST" }),
  },
  {
    name: "convert_meta_lead_to_contact",
    description: "Convert a Meta lead into a CRM contact.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: { id: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, subAccountId }) =>
      apexFetch(`/api/meta/leads/${id}/to-crm`, { method: "POST", subAccountId }),
  },

  // ════════ MESSAGING ════════
  {
    name: "send_message",
    description: "Send an outbound SMS or email to a contact.",
    inputSchema: {
      type: "object", required: ["channel"],
      properties: {
        subAccountId: SUB,
        channel: { type: "string", enum: ["sms", "email"] },
        contactId: { type: "number" }, to: { type: "string" },
        subject: { type: "string" }, body: { type: "string" },
        from: { type: "string" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/messages/send", { method: "POST", body, subAccountId }),
  },
  {
    name: "list_conversations",
    description: "List active inbox conversations.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch(`/api/conversations/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}`),
  },
  {
    name: "get_conversation_messages",
    description: "Get message history for a conversation.",
    inputSchema: {
      type: "object",
      properties: {
        subAccountId: SUB,
        conversationId: { type: "number" }, contactId: { type: "number" },
      },
    },
    handler: ({ subAccountId, conversationId, contactId }) =>
      apexFetch(`/api/conversations/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}/messages`, {
        query: { conversationId, contactId },
      }),
  },
  {
    name: "list_instagram_dms",
    description: "List Instagram direct message conversations.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch(`/api/meta/instagram/conversations/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}`),
  },
  {
    name: "send_instagram_dm",
    description: "Send an Instagram DM reply.",
    inputSchema: {
      type: "object", required: ["recipientId", "message"],
      properties: {
        subAccountId: SUB,
        recipientId: { type: "string" }, message: { type: "string" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/meta/instagram/send", { method: "POST", body, subAccountId }),
  },

  // ════════ PAYMENTS / SUBSCRIPTIONS ════════
  {
    name: "get_subscription",
    description: "Get current subscription status, plan, and revenue details.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) => apexFetch("/api/subscription", { subAccountId }),
  },
  {
    name: "create_checkout_session",
    description: "Create a Stripe checkout session to upgrade a sub-account plan.",
    inputSchema: {
      type: "object", required: ["plan"],
      properties: {
        subAccountId: SUB,
        plan: { type: "string", enum: ["starter", "pro", "enterprise"] },
        successUrl: { type: "string" }, cancelUrl: { type: "string" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/subscription/checkout", { method: "POST", body, subAccountId }),
  },
  {
    name: "create_roomos_checkout",
    description: "Create a Stripe checkout for the RoomOS product.",
    inputSchema: {
      type: "object",
      properties: {
        subAccountId: SUB,
        successUrl: { type: "string" }, cancelUrl: { type: "string" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/subscription/roomos-checkout", { method: "POST", body, subAccountId }),
  },

  // ════════ SUB-ACCOUNTS / USERS ════════
  {
    name: "list_accounts",
    description: "List all sub-accounts accessible to the admin.",
    inputSchema: { type: "object", properties: {} },
    handler: () => apexFetch("/api/accounts"),
  },
  {
    name: "create_account",
    description: "Create a new sub-account.",
    inputSchema: {
      type: "object", required: ["name"],
      properties: {
        name: { type: "string" }, industry: { type: "string" },
        plan: { type: "string" }, ownerEmail: { type: "string" },
      },
    },
    handler: (body) => apexFetch("/api/accounts", { method: "POST", body }),
  },
  {
    name: "change_account_plan",
    description: "Change the subscription tier of a sub-account.",
    inputSchema: {
      type: "object", required: ["id", "plan"],
      properties: {
        id: { type: "number" },
        plan: { type: "string", enum: ["free", "starter", "pro", "enterprise"] },
      },
    },
    handler: ({ id, plan }) =>
      apexFetch(`/api/accounts/${id}/plan`, { method: "PATCH", body: { plan } }),
  },
  {
    name: "configure_account_dm",
    description: "Configure AI agent settings (brand voice, booking links) for a sub-account.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: {
        id: { type: "number" },
        brandVoice: { type: "string" }, bookingLink: { type: "string" },
        autoReply: { type: "boolean" }, instructions: { type: "string" },
      },
    },
    handler: ({ id, ...body }) =>
      apexFetch(`/api/accounts/${id}/dm-config`, { method: "PUT", body }),
  },

  // ════════ HOME-SERVICE PIPELINE ════════
  {
    name: "get_pipeline_stats",
    description: "High-level home-service pipeline metrics (Total / Available / Sold leads).",
    inputSchema: { type: "object", properties: {} },
    handler: () => apexFetch("/api/home-service/stats"),
  },
  {
    name: "get_pipeline_leads",
    description: "List home-service leads matched to a contractor's service area/category.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch(`/api/home-service/leads/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}`),
  },
  {
    name: "claim_pipeline_lead",
    description: "Claim a home-service lead by its claim token.",
    inputSchema: {
      type: "object", required: ["token"],
      properties: { token: { type: "string" }, subAccountId: SUB },
    },
    handler: ({ token, subAccountId }) =>
      apexFetch(`/api/home-service/claim/${token}`, { method: "POST", subAccountId }),
  },
  {
    name: "start_home_service_pipeline",
    description: "Start the home-service signal pipeline.",
    inputSchema: { type: "object", properties: {} },
    handler: () => apexFetch("/api/home-service/pipeline/start", { method: "POST" }),
  },
  {
    name: "stop_home_service_pipeline",
    description: "Stop the home-service signal pipeline.",
    inputSchema: { type: "object", properties: {} },
    handler: () => apexFetch("/api/home-service/pipeline/stop", { method: "POST" }),
  },
  {
    name: "get_pipeline_stages",
    description: "Get custom CRM pipeline stages.",
    inputSchema: { type: "object", properties: { subAccountId: SUB } },
    handler: ({ subAccountId }) =>
      apexFetch(`/api/pipeline/stages/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}`),
  },
  {
    name: "create_deal",
    description: "Create a new deal/lead in the CRM pipeline.",
    inputSchema: {
      type: "object", required: ["title"],
      properties: {
        subAccountId: SUB,
        title: { type: "string" }, contactId: { type: "number" },
        stageId: { type: "number" }, value: { type: "number" },
        status: { type: "string" }, notes: { type: "string" },
      },
    },
    handler: ({ subAccountId, ...body }) =>
      apexFetch("/api/deals", { method: "POST", body, subAccountId }),
  },
  {
    name: "update_deal",
    description: "Update a deal — including moving it between pipeline stages.",
    inputSchema: {
      type: "object", required: ["id"],
      properties: {
        id: { type: "number" }, subAccountId: SUB,
        stageId: { type: "number" }, status: { type: "string" },
        value: { type: "number" }, title: { type: "string" }, notes: { type: "string" },
      },
    },
    handler: ({ id, subAccountId, ...body }) =>
      apexFetch(`/api/deals/${id}`, { method: "PATCH", body, subAccountId }),
  },
  {
    name: "move_deal_stage",
    description: "Convenience: move a deal to a specific pipeline stage.",
    inputSchema: {
      type: "object", required: ["id", "stageId"],
      properties: { id: { type: "number" }, stageId: { type: "number" }, subAccountId: SUB },
    },
    handler: ({ id, stageId, subAccountId }) =>
      apexFetch(`/api/deals/${id}`, { method: "PATCH", body: { stageId }, subAccountId }),
  },

  // ════════ UNIVERSAL ESCAPE HATCH ════════
  {
    name: "raw_api_call",
    description:
      "Call ANY endpoint on the platform. Admin secret + sub-account headers are auto-attached. Use this for anything not covered by the dedicated tools — nothing is ever blocked.",
    inputSchema: {
      type: "object", required: ["path"],
      properties: {
        path: { type: "string", description: "API path starting with /api/ or full URL" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], default: "GET" },
        body: { type: "object", description: "JSON body for POST/PUT/PATCH" },
        query: { type: "object", description: "Query string parameters" },
        subAccountId: SUB,
      },
    },
    handler: ({ path, method = "GET", body, query, subAccountId }) =>
      apexFetch(path, { method, body, query, subAccountId }),
  },
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

function buildMcpServer() {
  const server = new Server(
    { name: "apex-marketing-automations", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = toolMap.get(req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const result = await tool.handler(req.params.arguments || {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool error: ${err.message}` }],
      };
    }
  });

  return server;
}

const sessions = new Map();

export function mountApexMcp(app, { ssePath = "/mcp/sse", messagesPath = "/mcp/messages" } = {}) {
  app.get(ssePath, async (_req, res) => {
    const transport = new SSEServerTransport(messagesPath, res);
    sessions.set(transport.sessionId, transport);
    res.on("close", () => sessions.delete(transport.sessionId));
    const server = buildMcpServer();
    await server.connect(transport);
  });

  app.post(messagesPath, async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = sessions.get(sessionId);
    if (!transport) {
      return res.status(404).json({ error: "Unknown sessionId" });
    }
    await transport.handlePostMessage(req, res);
  });

  const publicHost =
    process.env.REPLIT_DEPLOYMENT_DOMAIN ||
    (process.env.REPLIT_DOMAINS?.split(",")[0]) ||
    "apexmarketingautomations.com";
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`[APEX-MCP] MCP server mounted (SSE) — v2.0 FULL ACCESS`);
  console.log(`[APEX-MCP]   Public SSE URL:  https://${publicHost}${ssePath}`);
  console.log(`[APEX-MCP]   Messages URL:    https://${publicHost}${messagesPath}`);
  console.log(`[APEX-MCP]   Tools exposed:   ${tools.length}`);
  console.log("════════════════════════════════════════════════════════════════");
}
