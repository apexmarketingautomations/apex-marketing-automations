# APEX MCP TOOL LAYER
**Phase 8 of 11 — Model Context Protocol Tool Design**
Generated: 2026-05-14
Status: DESIGN DOCUMENT — No MCP files created

---

## Overview

The MCP tool layer exposes Apex's core capabilities as Claude-callable tools. This enables:
- AI agents (Claude, Vapi voice) to query contacts, cases, signals, and workflows directly
- The Apex Intelligence Brain to take autonomous actions through structured tool calls
- External integrations to access Apex data without building custom REST API clients
- Claude Code itself to inspect and operate the Apex platform during development

---

## MCP Server Design

**Protocol:** `@modelcontextprotocol/sdk` (already in package.json)
**Transport:** HTTP (for remote access) + stdio (for local dev)
**Auth:** API key from `api_keys` table (to be created in Stage 2 migrations)
**Server location:** `server/mcp/apex-mcp-server.ts`

---

## Tool Registry

### Domain: Contacts & CRM

**`apex_contact_search`**
```typescript
{
  name: "apex_contact_search",
  description: "Search contacts by name, phone, email, or county. Returns matching contacts with their current status and scores.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name, phone, or email to search" },
      county: { type: "string", description: "Filter by county (e.g. 'Hillsborough')" },
      lead_vertical: { type: "string", enum: ["legal", "home_service", "general"] },
      limit: { type: "number", default: 10, maximum: 50 }
    },
    required: ["query"]
  }
}
```

**`apex_contact_get`**
```typescript
{
  name: "apex_contact_get",
  description: "Get full contact record including enrichment status, activity history, and AI profile.",
  inputSchema: {
    type: "object",
    properties: {
      contact_id: { type: "number" }
    },
    required: ["contact_id"]
  }
}
```

**`apex_contact_update_status`**
```typescript
{
  name: "apex_contact_update_status",
  description: "Update a contact's pipeline stage, identity status, or skip trace status.",
  inputSchema: {
    type: "object",
    properties: {
      contact_id: { type: "number" },
      field: { type: "string", enum: ["identity_status", "skip_trace_status", "pipeline_stage"] },
      value: { type: "string" }
    },
    required: ["contact_id", "field", "value"]
  }
}
```

---

### Domain: Legal Cases & Signals

**`apex_legal_case_search`**
```typescript
{
  name: "apex_legal_case_search",
  description: "Search legal cases by case number, plaintiff/defendant name, or case type. Returns cases with their AI summary scores.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      case_type: { type: "string", description: "e.g. 'personal_injury', 'criminal', 'civil'" },
      county: { type: "string" },
      date_from: { type: "string", format: "date" },
      limit: { type: "number", default: 10 }
    },
    required: ["query"]
  }
}
```

**`apex_legal_lead_status`**
```typescript
{
  name: "apex_legal_lead_status",
  description: "Get the delivery status of a legal lead — whether it has been routed to an attorney and what the outcome was.",
  inputSchema: {
    type: "object",
    properties: {
      lead_id: { type: "number" }
    },
    required: ["lead_id"]
  }
}
```

---

### Domain: Sentinel

**`apex_sentinel_list_incidents`**
```typescript
{
  name: "apex_sentinel_list_incidents",
  description: "List recent Sentinel incidents filtered by status, type, or severity.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "active", "resolved", "dismissed"] },
      severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      limit: { type: "number", default: 20 }
    }
  }
}
```

**`apex_sentinel_resolve_incident`**
```typescript
{
  name: "apex_sentinel_resolve_incident",
  description: "Mark a Sentinel incident as resolved with a resolution note.",
  inputSchema: {
    type: "object",
    properties: {
      incident_id: { type: "number" },
      resolution: { type: "string" },
      action_taken: { type: "string" }
    },
    required: ["incident_id", "resolution"]
  }
}
```

---

### Domain: Intelligence Brain

**`apex_brain_query`**
```typescript
{
  name: "apex_brain_query",
  description: "Ask the Apex Intelligence Brain a question about an account's contacts, signals, or performance. Returns an AI-synthesized answer with citations.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      context_type: { type: "string", enum: ["contacts", "signals", "performance", "general"] },
      account_id: { type: "number" }
    },
    required: ["question"]
  }
}
```

**`apex_brain_get_recommendations`**
```typescript
{
  name: "apex_brain_get_recommendations",
  description: "Get the latest AI recommendations for an account — actions, optimizations, and alerts.",
  inputSchema: {
    type: "object",
    properties: {
      account_id: { type: "number" },
      category: { type: "string", enum: ["contacts", "workflows", "campaigns", "all"] },
      limit: { type: "number", default: 10 }
    },
    required: ["account_id"]
  }
}
```

**`apex_brain_log_feedback`**
```typescript
{
  name: "apex_brain_log_feedback",
  description: "Submit human feedback on a Brain recommendation to improve future accuracy.",
  inputSchema: {
    type: "object",
    properties: {
      recommendation_id: { type: "number" },
      feedback_type: { type: "string", enum: ["correct", "incorrect", "partial"] },
      correction_notes: { type: "string" }
    },
    required: ["recommendation_id", "feedback_type"]
  }
}
```

---

### Domain: Messaging & Inbox

**`apex_send_sms`**
```typescript
{
  name: "apex_send_sms",
  description: "Send an SMS message to a contact. Uses the account's configured Twilio number.",
  inputSchema: {
    type: "object",
    properties: {
      contact_id: { type: "number" },
      message: { type: "string", maxLength: 1600 },
      schedule_at: { type: "string", format: "datetime", description: "Optional: ISO 8601 send time" }
    },
    required: ["contact_id", "message"]
  }
}
```

**`apex_get_conversation`**
```typescript
{
  name: "apex_get_conversation",
  description: "Retrieve the full conversation history with a contact, including all channels.",
  inputSchema: {
    type: "object",
    properties: {
      contact_id: { type: "number" },
      limit: { type: "number", default: 50 }
    },
    required: ["contact_id"]
  }
}
```

---

### Domain: Workflows & Automations

**`apex_workflow_trigger`**
```typescript
{
  name: "apex_workflow_trigger",
  description: "Manually trigger a workflow for a specific contact or set of contacts.",
  inputSchema: {
    type: "object",
    properties: {
      workflow_id: { type: "number" },
      contact_ids: { type: "array", items: { type: "number" } },
      trigger_data: { type: "object", description: "Additional context passed to the workflow" }
    },
    required: ["workflow_id", "contact_ids"]
  }
}
```

---

### Domain: Platform Admin

**`apex_admin_account_list`**
```typescript
{
  name: "apex_admin_account_list",
  description: "List all sub-accounts with their plan tier, contact count, and status. Admin-only.",
  inputSchema: {
    type: "object",
    properties: {
      include_stats: { type: "boolean", default: true }
    }
  }
}
```

**`apex_admin_feature_flag_set`**
```typescript
{
  name: "apex_admin_feature_flag_set",
  description: "Enable or disable a feature flag for an account or globally. Admin-only.",
  inputSchema: {
    type: "object",
    properties: {
      flag_name: { type: "string" },
      account_id: { type: "number", description: "Omit for global flag" },
      enabled: { type: "boolean" }
    },
    required: ["flag_name", "enabled"]
  }
}
```

**`apex_admin_pipeline_status`**
```typescript
{
  name: "apex_admin_pipeline_status",
  description: "Get real-time status of all data pipelines — ingest rates, error counts, and stuck records.",
  inputSchema: {
    type: "object",
    properties: {}
  }
}
```

---

## MCP Server Implementation Skeleton

**File: `server/mcp/apex-mcp-server.ts`**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { db } from '../db.js';
import { contacts, legalCases, sentinelIncidents } from '../../shared/schema.js';

const server = new Server(
  { name: 'apex-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS  // array of all tools above
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  // Auth check: all tools require a valid API key in context
  // The MCP client must pass the key in transport metadata
  
  switch (name) {
    case 'apex_contact_search':
      return handleContactSearch(args);
    case 'apex_legal_case_search':
      return handleLegalCaseSearch(args);
    // ... etc
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Security Model

1. **Every tool call requires a valid API key** from the `api_keys` table
2. **Account isolation is enforced at the tool handler level** — a key scoped to account 3 cannot read account 4 data
3. **Admin tools require `role = admin or owner`** — API key must belong to an admin user
4. **Write tools are logged** to `admin_audit_log` with the API key ID and tool name
5. **Rate limiting** applies to MCP tool calls at the same rate limits as the REST API

---

## MCP Registration in Claude Code

Add to `.claude/settings.json` or via `claude mcp add`:

```json
{
  "mcpServers": {
    "apex": {
      "command": "tsx",
      "args": ["server/mcp/apex-mcp-server.ts"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}",
        "APEX_MCP_API_KEY": "${APEX_MCP_API_KEY}"
      }
    }
  }
}
```

---

*Document complete. Next: `docs/APEX_ADMIN_ACCESS_AUDIT.md` (Phase 9)*
