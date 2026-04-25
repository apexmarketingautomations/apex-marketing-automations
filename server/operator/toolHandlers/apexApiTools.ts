import type { OperatorTool, ValidationResult } from "../types";

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

const PORT = process.env.PORT || "5000";
const BASE_URL = `http://localhost:${PORT}`;

const FORBIDDEN_PATH_PATTERNS: RegExp[] = [
  /^\/api\/admin(\/|$)/i,
  /^\/api\/auth\/login/i,
  /^\/api\/auth\/logout/i,
  /^\/api\/bot\/chat\/agent-stream/i,
];

function isForbidden(path: string): boolean {
  return FORBIDDEN_PATH_PATTERNS.some(rx => rx.test(path));
}

function substituteSubAccountId(path: string, subAccountId: number): string {
  // Many legacy routes carry :subAccountId in the URL — auto-fill from context.
  return path.replace(/:subAccountId\b/g, String(subAccountId));
}

function buildUrl(path: string, query?: Record<string, any>): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (!query || Object.keys(query).length === 0) return `${BASE_URL}${cleanPath}`;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return `${BASE_URL}${cleanPath}${qs ? `?${qs}` : ""}`;
}

const APEX_API_DIRECTORY = {
  contentPlanner: {
    description: "Schedule, draft, edit, publish, and manage social posts across FB/IG/X/TikTok",
    endpoints: [
      { method: "GET", path: "/api/content-planner/posts", purpose: "List posts. Query: status (draft|scheduled|published|failed|retrying|cancelled), platform, from, to" },
      { method: "GET", path: "/api/content-planner/posts/:id", purpose: "Get a specific post with media" },
      { method: "POST", path: "/api/content-planner/posts", purpose: "Create a post. Body: { caption, platforms[], scheduledAt?, mediaIds[]? }. Auto-becomes 'scheduled' if scheduledAt is in the future, else 'draft'." },
      { method: "PUT", path: "/api/content-planner/posts/:id", purpose: "Edit a post (caption, scheduledAt, platforms, mediaIds)" },
      { method: "DELETE", path: "/api/content-planner/posts/:id", purpose: "Delete a post" },
      { method: "GET", path: "/api/content-planner/calendar", purpose: "Posts grouped by date for calendar view. Query: month (YYYY-MM)" },
      { method: "GET", path: "/api/content-planner/connections", purpose: "List connected social accounts (FB, IG, X, TikTok)" },
      { method: "POST", path: "/api/content-planner/connections", purpose: "Add a social account connection" },
      { method: "PUT", path: "/api/content-planner/connections/:id", purpose: "Update a social connection" },
      { method: "DELETE", path: "/api/content-planner/connections/:id", purpose: "Remove a social connection" },
      { method: "GET", path: "/api/content-planner/media", purpose: "List uploaded media library items" },
      { method: "DELETE", path: "/api/content-planner/media/:id", purpose: "Delete a media item" },
      { method: "GET", path: "/api/content-planner/approvals", purpose: "List posts awaiting approval" },
      { method: "POST", path: "/api/content-planner/approvals", purpose: "Approve or reject a pending post. Body: { postId, decision, note? }" },
    ],
  },
  digitalCards: {
    description: "Digital business cards (vCard, QR, lead capture, analytics)",
    endpoints: [
      { method: "GET", path: "/api/digital-card/:subAccountId", purpose: "Get the current digital card for this account" },
      { method: "POST", path: "/api/digital-card/:subAccountId", purpose: "Create or update digital card. Body: { name, title, bio, phone, email, theme, photoUrl, ... }" },
      { method: "GET", path: "/api/digital-card/:subAccountId/analytics", purpose: "Get scan/view/save analytics for the card" },
      { method: "GET", path: "/api/check-slug/:slug", purpose: "Check if a custom slug is available" },
    ],
  },
  sites: {
    description: "AI-generated landing pages and marketing sites",
    endpoints: [
      { method: "GET", path: "/api/sites", purpose: "List saved sites" },
      { method: "POST", path: "/api/sites", purpose: "Create a saved site" },
      { method: "PATCH", path: "/api/sites/:id", purpose: "Edit site sections, theme, or metadata" },
      { method: "DELETE", path: "/api/sites/:id", purpose: "Delete a saved site" },
      { method: "POST", path: "/api/sites/:id/publish", purpose: "Publish a site" },
      { method: "GET", path: "/api/sites/:id/versions", purpose: "List version history for a site" },
      { method: "POST", path: "/api/sites/:id/versions", purpose: "Snapshot a new version" },
      { method: "POST", path: "/api/generate-site", purpose: "Generate a new AI site. Body: { businessName, industry, tone, ... }" },
    ],
  },
  sentinel: {
    description: "Sentinel lead detection — incident scraping, geofence ad deployment, lead flagging",
    endpoints: [
      { method: "GET", path: "/api/sentinel/config/:subAccountId", purpose: "Get sentinel scrape config (keywords, intervals, regions)" },
      { method: "PUT", path: "/api/sentinel/config", purpose: "Update sentinel config. Body: { subAccountId, keywords[], intervalMinutes, regions[], ... }" },
      { method: "GET", path: "/api/sentinel/incidents/:subAccountId", purpose: "List detected incidents/leads" },
      { method: "POST", path: "/api/sentinel/scan", purpose: "Trigger a manual scan now. Body: { subAccountId }" },
      { method: "POST", path: "/api/sentinel/incidents", purpose: "Manually create an incident" },
      { method: "POST", path: "/api/sentinel/incidents/:id/deploy-geofence", purpose: "Deploy a geofenced ad for an incident" },
      { method: "POST", path: "/api/sentinel/incidents/:id/send-sms", purpose: "Send an SMS to leads associated with the incident" },
      { method: "POST", path: "/api/sentinel/incidents/:id/acknowledge", purpose: "Mark incident as acknowledged" },
      { method: "POST", path: "/api/sentinel/incidents/:id/flag-lead", purpose: "Convert an incident into a flagged lead" },
      { method: "GET", path: "/api/sentinel/live", purpose: "Live feed of latest incidents" },
    ],
  },
  inbox: {
    description: "Unified inbox — query messages, threads, sync history",
    endpoints: [
      { method: "GET", path: "/api/messages/:subAccountId", purpose: "List messages. Query: channel, limit" },
      { method: "GET", path: "/api/conversations/:subAccountId", purpose: "List conversation threads" },
      { method: "GET", path: "/api/conversations/:subAccountId/messages", purpose: "Get messages for a thread. Query: contactId or threadId" },
      { method: "POST", path: "/api/sync-dms/:subAccountId", purpose: "Sync historical DMs from connected providers (Meta, etc)" },
      { method: "POST", path: "/api/messages/send", purpose: "Send a message. Body: { contactId, channel, body }" },
    ],
  },
  reviews: {
    description: "Reputation management — review feed, response, public visibility, review-link config",
    endpoints: [
      { method: "GET", path: "/api/reviews/:subAccountId", purpose: "List reviews. Query: rating, platform, public" },
      { method: "POST", path: "/api/reviews", purpose: "Create a review record" },
      { method: "PATCH", path: "/api/reviews/:id", purpose: "Update review fields (e.g. { public: true } to feature it)" },
      { method: "GET", path: "/api/review-config/:subAccountId", purpose: "Get review-platform link config (Google/Yelp/etc URLs)" },
      { method: "PATCH", path: "/api/review-config/:subAccountId", purpose: "Update review-platform link config" },
      { method: "POST", path: "/api/alert-owner", purpose: "Notify the owner of a flagged review" },
    ],
  },
  account: {
    description: "Sub-account profile, plan, language, AI/DM config",
    endpoints: [
      { method: "GET", path: "/api/accounts", purpose: "List sub-accounts (admin scope)" },
      { method: "PATCH", path: "/api/accounts/:id/plan", purpose: "Change plan tier. Body: { tier }" },
      { method: "PATCH", path: "/api/accounts/:id/language", purpose: "Change account language. Body: { language }" },
      { method: "GET", path: "/api/accounts/:id/dm-config", purpose: "Get DM auto-reply / persona config" },
      { method: "PUT", path: "/api/accounts/:id/dm-config", purpose: "Update DM auto-reply / persona / autoReplyEnabled / bookingLink / etc." },
      { method: "GET", path: "/api/plan-tiers", purpose: "List available plan tiers" },
      { method: "GET", path: "/api/languages", purpose: "List supported languages" },
    ],
  },
  workflows: {
    description: "Automation workflows (full CRUD beyond the dedicated workflow tools)",
    endpoints: [
      { method: "GET", path: "/api/workflows", purpose: "List all workflows" },
      { method: "GET", path: "/api/workflows/:id", purpose: "Get a workflow's full definition" },
      { method: "POST", path: "/api/workflows", purpose: "Create a workflow from manifest" },
      { method: "PATCH", path: "/api/workflows/:id", purpose: "Edit a workflow" },
      { method: "DELETE", path: "/api/workflows/:id", purpose: "Delete a workflow" },
      { method: "GET", path: "/api/workflows/:id/analytics", purpose: "Performance analytics" },
      { method: "POST", path: "/api/workflows/:id/auto-optimize", purpose: "Auto-optimize step timing" },
    ],
  },
  billing: {
    description: "Usage logs, wallet, plan",
    endpoints: [
      { method: "GET", path: "/api/usage/:subAccountId", purpose: "Get usage logs (AI credits, message costs, calls)" },
      { method: "POST", path: "/api/usage/log", purpose: "Log a usage event (rare — most usage is auto-logged)" },
      { method: "GET", path: "/api/wallet/:subAccountId", purpose: "Get wallet balance and credit info" },
    ],
  },
  integrations: {
    description: "Third-party integrations (Google Calendar, Meta, Stripe, Twilio, etc). OAuth-gated providers REQUIRE the user to click through a consent screen — you cannot complete the connection yourself. For those, navigate the user to /integrations and tell them which button to click.",
    endpoints: [
      { method: "GET", path: "/api/integrations/:subAccountId", purpose: "Get connection status of all integrations (which are connected, which are not)" },
      { method: "POST", path: "/api/integrations/:subAccountId/disconnect", purpose: "Disconnect an integration. Body: { provider }" },
      { method: "GET", path: "/api/oauth/google/authorize/:subAccountId", purpose: "OAuth INITIATION URL for Google (Calendar, Gmail, Business). User-only — do NOT call this from a tool; instead navigate the user to /integrations so they can click the Connect button." },
    ],
  },
  crm: {
    description: "Contacts, deals, pipeline, appointments — full CRUD",
    endpoints: [
      { method: "GET", path: "/api/contacts/:subAccountId", purpose: "List contacts. Query: search, tag, limit" },
      { method: "POST", path: "/api/contacts", purpose: "Create a contact. Body: { subAccountId, firstName, lastName?, email?, phone?, company?, tags?: string[], notes? }. NOTE: use firstName + lastName, NOT a single 'name' field." },
      { method: "PATCH", path: "/api/contacts/:id", purpose: "Update a contact" },
      { method: "DELETE", path: "/api/contacts/:id", purpose: "Delete a contact" },
      { method: "GET", path: "/api/appointments/:subAccountId", purpose: "List appointments. Query: from, to, status" },
      { method: "POST", path: "/api/appointments", purpose: "Create an appointment. Body: { subAccountId, contactId, startsAt, endsAt, title, notes? }" },
      { method: "PATCH", path: "/api/appointments/:id", purpose: "Reschedule or update an appointment" },
      { method: "DELETE", path: "/api/appointments/:id", purpose: "Cancel an appointment" },
    ],
  },
};

export const apexApiTools: OperatorTool[] = [
  {
    name: "apexApiDirectory",
    description:
      "List every Apex platform endpoint you can call. Returns a catalog of API paths grouped by feature area (content planner, digital cards, sites, sentinel, inbox, reviews, account, workflows, billing). Call this FIRST when you need to do something not covered by the dedicated tools.",
    category: "system" as any,
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [],
    validate: noopValidate,
    execute: async () => {
      return {
        success: true,
        data: {
          note: "Use apexApi with method+path from this catalog. Any :subAccountId in a path is auto-filled from the user's session — leave it as :subAccountId in the path you pass.",
          features: APEX_API_DIRECTORY,
        },
      };
    },
  },
  {
    name: "apexApi",
    description:
      "Call ANY internal Apex API endpoint on behalf of the current user. Use this for anything the dashboard can do but no dedicated tool covers (publishing posts, editing cards, managing sites, sentinel config, inbox queries, review settings, billing info, full CRUD on workflows/contacts/posts, etc.). The user's tenant is automatically scoped — :subAccountId placeholders in the path are auto-filled. Call apexApiDirectory first if you don't know the path.",
    category: "system" as any,
    autonomyRequired: "execute",
    requiresApproval: false,
    parameters: [
      { name: "method", type: "string", required: true, description: "HTTP method: GET, POST, PATCH, PUT, or DELETE" },
      { name: "path", type: "string", required: true, description: "API path starting with /api/. May contain :subAccountId which will be auto-filled." },
      { name: "body", type: "object", required: false, description: "JSON body for POST/PATCH/PUT requests" },
      { name: "query", type: "object", required: false, description: "Query string parameters as a flat key/value object" },
    ],
    validate: (params) => {
      const errors: string[] = [];
      const method = String(params.method || "").toUpperCase();
      if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
        errors.push("method must be one of GET, POST, PATCH, PUT, DELETE");
      }
      const path = String(params.path || "");
      if (!path.startsWith("/api/")) errors.push("path must start with /api/");
      if (path && isForbidden(path)) errors.push(`path ${path} is not allowed from the chatbot`);
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    execute: async (params, ctx) => {
      const method = String(params.method).toUpperCase();
      let path = String(params.path);
      const body = params.body;
      const query = params.query as Record<string, any> | undefined;

      const adminSecret = process.env.STANDALONE_ADMIN_SECRET;
      if (!adminSecret) {
        return { success: false, error: "Internal API access not configured (missing admin secret)." };
      }

      path = substituteSubAccountId(path, ctx.subAccountId);
      const url = buildUrl(path, query);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-sub-account-id": String(ctx.subAccountId),
        "x-admin-secret": adminSecret,
        "x-internal-source": "apex-intelligence-bot",
      };

      const init: RequestInit = { method, headers };
      if (body !== undefined && method !== "GET" && method !== "DELETE") {
        // Auto-inject subAccountId for endpoints that expect it in the body
        const finalBody =
          body && typeof body === "object" && !Array.isArray(body) && body.subAccountId === undefined
            ? { ...body, subAccountId: ctx.subAccountId }
            : body;
        init.body = JSON.stringify(finalBody);
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        init.signal = controller.signal;

        const res = await fetch(url, init);
        clearTimeout(timeout);

        const text = await res.text();
        let data: any = text;
        try { data = text ? JSON.parse(text) : null; } catch (err) { console.warn("[APEXAPITOOLS] caught:", err instanceof Error ? err.message : err); }

        if (!res.ok) {
          return {
            success: false,
            error: `API ${method} ${path} returned ${res.status}: ${typeof data === "string" ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400)}`,
            data: { status: res.status, body: data },
          };
        }

        const serialized = JSON.stringify(data);
        const tooBig = serialized.length > 8000;
        let safeData: any = data;
        if (tooBig) {
          if (Array.isArray(data)) {
            // Return a digestible slice. Start with 10 and shrink until we fit
            // under the budget so even fat-row endpoints (messages, contacts)
            // produce a usable answer instead of "response too large".
            const BUDGET = 6000;
            let take = 10;
            let sample = data.slice(0, take);
            while (take > 1 && JSON.stringify(sample).length > BUDGET) {
              take = Math.max(1, Math.floor(take / 2));
              sample = data.slice(0, take);
            }
            safeData = {
              totalCount: data.length,
              returnedCount: sample.length,
              items: sample,
              note: `Showing the first ${sample.length} of ${data.length} items — this is enough to answer most questions. Use this data; do NOT re-call expecting more unless the user asked for a specific item beyond index ${sample.length - 1}.`,
            };
          } else {
            safeData = {
              note: `Response was large (${serialized.length} bytes) and has been truncated. Re-call with narrower filters or pagination to see the rest.`,
              preview: serialized.slice(0, 6000),
            };
          }
        }
        // Honesty check: even on HTTP 200, some endpoints return
        // { success: false, error: "…" } in the body. Don't lie.
        const bodyClaimsFailure =
          safeData && typeof safeData === "object" && !Array.isArray(safeData) &&
          (safeData.success === false || safeData.ok === false ||
           (typeof safeData.error === "string" && safeData.error.length > 0));

        if (bodyClaimsFailure) {
          const reason = safeData.error || safeData.message || "Endpoint returned success=false in the body";
          return {
            success: false,
            error: `API ${method} ${path} returned HTTP ${status} but the response body indicates failure: ${String(reason).slice(0, 240)}`,
            data: safeData,
          };
        }

        return {
          success: true,
          data: safeData,
          sideEffects: [`${method} ${path}`],
        };
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return { success: false, error: `API ${method} ${path} timed out after 25s` };
        }
        return { success: false, error: `API ${method} ${path} failed: ${err?.message || String(err)}` };
      }
    },
    summarizeForAudit: (params, result) =>
      `${result.success ? "Called" : "Attempted"} ${params.method} ${params.path}`,
  },
];
