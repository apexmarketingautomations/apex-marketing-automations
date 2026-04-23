import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const APEX_BASE_URL = process.env.APEX_BASE_URL || "https://apexmarketingautomations.com";
const APEX_ADMIN_SECRET = process.env.STANDALONE_ADMIN_SECRET || "201120062017";
const DEFAULT_SUB_ACCOUNT_ID = 13;

async function apexFetch(path, { method = "GET", body, subAccountId } = {}) {
  const url = path.startsWith("http") ? path : `${APEX_BASE_URL}${path}`;
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

const tools = [
  {
    name: "get_all_contacts",
    description: "List all contacts in a sub-account.",
    inputSchema: {
      type: "object",
      properties: { subAccountId: { type: "number", description: "Sub-account ID (default 13)" } },
    },
    handler: async ({ subAccountId }) => apexFetch("/api/contacts", { subAccountId }),
  },
  {
    name: "create_contact",
    description: "Create a new contact.",
    inputSchema: {
      type: "object",
      required: ["firstName"],
      properties: {
        subAccountId: { type: "number" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        source: { type: "string" },
      },
    },
    handler: async ({ subAccountId, ...body }) =>
      apexFetch("/api/contacts", { method: "POST", body, subAccountId }),
  },
  {
    name: "update_contact",
    description: "Update an existing contact by ID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number" },
        subAccountId: { type: "number" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
    handler: async ({ id, subAccountId, ...body }) =>
      apexFetch(`/api/contacts/${id}`, { method: "PUT", body, subAccountId }),
  },
  {
    name: "delete_contact",
    description: "Delete a contact by ID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "number" }, subAccountId: { type: "number" } },
    },
    handler: async ({ id, subAccountId }) =>
      apexFetch(`/api/contacts/${id}`, { method: "DELETE", subAccountId }),
  },
  {
    name: "get_content_planner_posts",
    description: "List content planner posts.",
    inputSchema: {
      type: "object",
      properties: { subAccountId: { type: "number" } },
    },
    handler: async ({ subAccountId }) =>
      apexFetch("/api/content-planner/posts", { subAccountId }),
  },
  {
    name: "create_content_planner_post",
    description: "Create a new content planner post.",
    inputSchema: {
      type: "object",
      properties: {
        subAccountId: { type: "number" },
        title: { type: "string" },
        caption: { type: "string" },
        hashtags: { type: "string" },
        callToAction: { type: "string" },
        firstComment: { type: "string" },
        contentType: { type: "string" },
        scheduledAt: { type: "string" },
        platforms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              platform: { type: "string" },
              socialAccountId: { type: "number" },
            },
          },
        },
        mediaIds: { type: "array", items: { type: "number" } },
      },
    },
    handler: async ({ subAccountId, ...body }) =>
      apexFetch("/api/content-planner/posts", { method: "POST", body, subAccountId }),
  },
  {
    name: "update_content_planner_post",
    description: "Update a content planner post by ID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number" },
        subAccountId: { type: "number" },
        title: { type: "string" },
        caption: { type: "string" },
        hashtags: { type: "string" },
        scheduledAt: { type: "string" },
        status: { type: "string" },
      },
    },
    handler: async ({ id, subAccountId, ...body }) =>
      apexFetch(`/api/content-planner/posts/${id}`, { method: "PUT", body, subAccountId }),
  },
  {
    name: "delete_content_planner_post",
    description: "Delete a content planner post by ID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "number" }, subAccountId: { type: "number" } },
    },
    handler: async ({ id, subAccountId }) =>
      apexFetch(`/api/content-planner/posts/${id}`, { method: "DELETE", subAccountId }),
  },
  {
    name: "get_automations",
    description: "List automations / workflows for a sub-account.",
    inputSchema: {
      type: "object",
      properties: { subAccountId: { type: "number" } },
    },
    handler: async ({ subAccountId }) => apexFetch("/api/workflows", { subAccountId }),
  },
  {
    name: "create_automation",
    description: "Create a new automation / workflow.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        subAccountId: { type: "number" },
        name: { type: "string" },
        triggerType: { type: "string" },
        steps: { type: "array" },
        active: { type: "boolean" },
      },
    },
    handler: async ({ subAccountId, ...body }) =>
      apexFetch("/api/workflows", { method: "POST", body, subAccountId }),
  },
  {
    name: "toggle_automation",
    description: "Toggle an automation on or off by ID.",
    inputSchema: {
      type: "object",
      required: ["id", "active"],
      properties: {
        id: { type: "number" },
        active: { type: "boolean" },
        subAccountId: { type: "number" },
      },
    },
    handler: async ({ id, active, subAccountId }) =>
      apexFetch(`/api/workflows/${id}`, { method: "PUT", body: { active }, subAccountId }),
  },
  {
    name: "get_sites",
    description: "List sites for a sub-account.",
    inputSchema: {
      type: "object",
      properties: { subAccountId: { type: "number" } },
    },
    handler: async ({ subAccountId }) => apexFetch("/api/sites", { subAccountId }),
  },
  {
    name: "create_site",
    description: "Create a new site.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        subAccountId: { type: "number" },
        name: { type: "string" },
        slug: { type: "string" },
        industry: { type: "string" },
        config: { type: "object" },
      },
    },
    handler: async ({ subAccountId, ...body }) =>
      apexFetch("/api/sites", { method: "POST", body, subAccountId }),
  },
  {
    name: "get_pipeline_stats",
    description: "Get home-service lead pipeline stats.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => apexFetch("/api/home-service/stats"),
  },
  {
    name: "get_pipeline_leads",
    description: "Get home-service leads for a sub-account.",
    inputSchema: {
      type: "object",
      properties: { subAccountId: { type: "number" } },
    },
    handler: async ({ subAccountId }) =>
      apexFetch(`/api/home-service/leads/${subAccountId ?? DEFAULT_SUB_ACCOUNT_ID}`),
  },
  {
    name: "get_audit_log",
    description: "Get the audit log / universal events feed.",
    inputSchema: {
      type: "object",
      properties: {
        subAccountId: { type: "number" },
        limit: { type: "number", description: "Max entries to return" },
      },
    },
    handler: async ({ subAccountId, limit }) =>
      apexFetch(`/api/audit-log${limit ? `?limit=${limit}` : ""}`, { subAccountId }),
  },
  {
    name: "get_dashboard",
    description: "Get the main dashboard data for a sub-account.",
    inputSchema: {
      type: "object",
      properties: { subAccountId: { type: "number" } },
    },
    handler: async ({ subAccountId }) => apexFetch("/api/dashboard", { subAccountId }),
  },
  {
    name: "raw_api_call",
    description:
      "Raw HTTP call to ANY Apex endpoint. Admin secret + sub-account headers are added automatically. Use for any endpoint not covered by the dedicated tools.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "API path starting with /api/ (or full URL)" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          default: "GET",
        },
        body: { type: "object", description: "JSON body for POST/PUT/PATCH" },
        subAccountId: { type: "number", description: "Sub-account context (default 13)" },
      },
    },
    handler: async ({ path, method = "GET", body, subAccountId }) =>
      apexFetch(path, { method, body, subAccountId }),
  },
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

function buildMcpServer() {
  const server = new Server(
    { name: "apex-marketing-automations", version: "1.0.0" },
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
  console.log(`[APEX-MCP] MCP server mounted (SSE)`);
  console.log(`[APEX-MCP]   Public SSE URL:  https://${publicHost}${ssePath}`);
  console.log(`[APEX-MCP]   Messages URL:    https://${publicHost}${messagesPath}`);
  console.log(`[APEX-MCP]   Tools exposed:   ${tools.length}`);
  console.log("════════════════════════════════════════════════════════════════");
}
