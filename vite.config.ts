import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

function readJsonBody(req: import("node:http").IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function devClientAuthPlugin() {
  const sessionCookie = "apex_dev_auth=1";
  const devAccount = {
    id: 3,
    name: "Apex Marketing Automations",
    twilioNumber: "",
    googleReviewLink: null,
    trustpilotLink: null,
    ownerPhone: "+12395550100",
    industry: "marketing",
    config: null,
    vibeTheme: "cyber-glass",
    ownerUserId: "dev-local-user",
    parentSnapshotId: null,
    isFork: false,
    language: "en",
    aiPromptConfig: null,
    plan: "enterprise",
    planFeatures: null,
    webhookToken: null,
    address: "Fort Myers, FL",
    formattedAddress: "Fort Myers, FL, USA",
    city: "Fort Myers",
    state: "FL",
    zip: "33901",
    lat: 26.6406,
    lng: -81.8723,
    isInternal: true,
    billingExempt: true,
    isDeletable: false,
    role: "admin",
    parentAccountId: null,
    operatorConfig: null,
    isProtected: false,
  };
  const devIncidents = [
    {
      id: 101,
      subAccountId: 3,
      title: "Multi-vehicle crash detected",
      description: "High-priority crash signal near Colonial Blvd and I-75 with injury keywords.",
      location: "Colonial Blvd & I-75, Fort Myers, FL",
      severity: "high",
      actionStatus: "pending",
      detectedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
      geofenceDeployed: false,
      smsSent: false,
      lat: 26.5968,
      lng: -81.8092,
      rawPayload: {
        source: "fhp",
        operatorPriority: "urgent",
        priorityScore: 92,
        distanceMiles: 0.8,
      },
      cadSource: "FHP",
      cadExternalId: "DEV-FHP-101",
      cadLastUpdatedAt: new Date().toISOString(),
      dispatchedAs: "MVA with injuries",
      callNotes: "Local dev sample incident for Sentinel access testing.",
      unitsAssigned: [],
      responseTimeline: [],
    },
    {
      id: 102,
      subAccountId: 3,
      title: "Rollover crash report",
      description: "Rollover and lane blockage detected from public crash feed.",
      location: "US-41, Cape Coral, FL",
      severity: "critical",
      actionStatus: "acknowledged",
      detectedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      geofenceDeployed: true,
      smsSent: true,
      lat: 26.5629,
      lng: -81.9495,
      rawPayload: {
        source: "fhp",
        operatorPriority: "urgent",
        priorityScore: 88,
      },
      cadSource: "CAD",
      cadExternalId: "DEV-CAD-102",
      cadLastUpdatedAt: new Date().toISOString(),
      dispatchedAs: "Rollover",
      callNotes: "Local dev sample actioned incident.",
      unitsAssigned: [],
      responseTimeline: [],
    },
  ];
  const devLegalSignals = [
    {
      id: 201,
      signalType: "dui_arrest",
      legalVertical: "criminal",
      county: "Lee",
      address: "Fort Myers, FL",
      ownerName: "Sample Defendant",
      ownerPhone: "+12395550123",
      subjectName: "Sample Defendant",
      subjectAddress: "Fort Myers, FL",
      chargeDescription: "DUI with property damage, sample public-record signal.",
      caseNumber: "DEV-2026-CR-001",
      description: "DUI arrest booked in Lee County with high-value criminal defense intent.",
      urgency: "high",
      serviceCategories: ["criminal", "traffic"],
      detectedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
      status: "new",
      score: 91,
      smsSent: false,
      actionStatus: "pending",
    },
    {
      id: 202,
      signalType: "divorce_filing",
      legalVertical: "family",
      county: "Collier",
      ownerName: "Sample Petitioner",
      caseNumber: "DEV-2026-DR-044",
      description: "New dissolution filing with custody-related docket activity.",
      urgency: "medium",
      serviceCategories: ["family"],
      detectedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
      status: "new",
      score: 76,
      smsSent: true,
      actionStatus: "contacted",
    },
    {
      id: 203,
      signalType: "osha_incident",
      legalVertical: "workers_comp",
      county: "Hillsborough",
      ownerName: "Sample Injured Worker",
      ownerPhone: "+18135550123",
      description: "OSHA workplace injury signal with workers comp and PI potential.",
      urgency: "critical",
      serviceCategories: ["workers_comp", "personal_injury"],
      detectedAt: new Date(Date.now() - 7 * 60 * 60_000).toISOString(),
      status: "new",
      score: 94,
      smsSent: false,
      actionStatus: "pending",
    },
  ];
  const devHomeLeads = [
    {
      id: 301,
      signalType: "permit_filing",
      county: "Lee",
      address: "Fort Myers, FL",
      ownerName: "Sample Property Owner",
      ownerPhone: "+12395550900",
      ownerEmail: "owner@example.test",
      serviceCategories: ["roofing", "hvac"],
      urgency: "high",
      description: "Roof replacement permit filed after recent storm activity.",
      status: "new",
      score: 87,
      scoreBreakdown: "Strong local service intent and timely outreach window.",
      estimatedJobMin: 8500,
      estimatedJobMax: 24000,
      lat: 26.6406,
      lng: -81.8723,
      createdAt: new Date(Date.now() - 95 * 60_000).toISOString(),
    },
  ];
  const devUser = {
    id: "dev-local-user",
    email: "local@apex.test",
    firstName: "Local",
    lastName: "Developer",
    profileImageUrl: null,
    authProvider: "dev-client",
    isAdmin: "true",
    activeSubAccountId: 3,
    subAccountId: 3,
    accounts: [devAccount],
    role: "DEV_ADMIN",
    isPaid: true,
    radius: 999999,
    permissions: ["all"],
  };

  function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(JSON.stringify(payload));
  }

  return {
    name: "apex-dev-client-auth",
    apply: "serve" as const,
    configureServer(server: any) {
      server.middlewares.use(async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => {
        const url = req.url?.split("?")[0];
        if (url === "/api/accounts" && req.method === "GET") {
          sendJson(res, 200, [devAccount]);
          return;
        }

        if (url === "/api/accounts/3" && req.method === "GET") {
          sendJson(res, 200, devAccount);
          return;
        }

        if (url?.startsWith("/api/sentinel/config/") && req.method === "GET") {
          sendJson(res, 200, {
            subAccountId: 3,
            keywords: ["MVA", "EXTRICATION", "ROLLOVER", "INJURIES", "SIGNAL 4"],
            scanInterval: 60,
            enabled: true,
            smsAlertEnabled: true,
            smsAlertPhone: "+12395550100",
            geofenceEnabled: true,
            geofenceRadiusMiles: 1,
            targetCities: ["Fort Myers", "Cape Coral", "Naples"],
            targetStates: ["FL"],
            niche: "accident",
            homeSvcConfig: null,
          });
          return;
        }

        if (url === "/api/sentinel/config" && req.method === "PUT") {
          sendJson(res, 200, { success: true });
          return;
        }

        if (url?.startsWith("/api/sentinel/incidents/") && req.method === "GET") {
          sendJson(res, 200, { incidents: devIncidents, total: devIncidents.length, totalPages: 1 });
          return;
        }

        if (url === "/api/sentinel/pipeline-status" && req.method === "GET") {
          sendJson(res, 200, {
            pipelines: {
              fhp: { active: true, intervalMin: 60, description: "FHP Crash Feed" },
              cad: { active: true, intervalMin: 5, description: "CAD Ingest" },
              legal: { active: true, intervalMin: 30, description: "Legal Signals" },
              homeService: { active: true, intervalMin: 60, description: "Home Service Signals" },
            },
            last24h: { incidents: devIncidents.length, legal_signals: devLegalSignals.length, home_leads: devHomeLeads.length },
          });
          return;
        }

        if (url === "/api/sentinel/legal-signals" && req.method === "GET") {
          const requestUrl = new URL(req.url || "", "http://localhost");
          const category = requestUrl.searchParams.get("category") || "all";
          const page = Number(requestUrl.searchParams.get("page") || "1");
          const pageSize = Number(requestUrl.searchParams.get("pageSize") || "50");
          const byCategory = category === "all"
            ? devLegalSignals
            : devLegalSignals.filter((signal) => signal.serviceCategories.includes(category));
          const start = (page - 1) * pageSize;
          const signals = byCategory.slice(start, start + pageSize);
          sendJson(res, 200, { signals, total: byCategory.length, totalPages: Math.max(1, Math.ceil(byCategory.length / pageSize)) });
          return;
        }

        if (url === "/api/sentinel/scan" && req.method === "POST") {
          sendJson(res, 200, { found: devIncidents.length, source: "local-dev-sentinel" });
          return;
        }

        if (url?.startsWith("/api/sentinel/incidents/") && req.method === "POST") {
          sendJson(res, 200, { success: true, message: "Local dev Sentinel action recorded" });
          return;
        }

        if (url?.startsWith("/api/home-service/leads/") && req.method === "GET") {
          sendJson(res, 200, { leads: devHomeLeads, scope: "local-dev", contractorCount: 1 });
          return;
        }

        if (url?.startsWith("/api/home-service/leads/") && req.method === "PATCH") {
          sendJson(res, 200, { success: true });
          return;
        }

        if (url === "/api/sentinel/distribution-rules" && req.method === "GET") {
          sendJson(res, 200, {
            rules: [
              {
                id: 401,
                name: "Local Attorney Lead Route",
                signalTypes: ["dui_arrest", "arrest_record", "divorce_filing", "osha_incident"],
                targetAccountId: 3,
                targetAccountName: "Apex Marketing Automations",
                targetPhone: "+12395550100",
                active: true,
                leadsDelivered: 12,
              },
            ],
          });
          return;
        }

        if (url?.startsWith("/api/sentinel/distribution-rules") && (req.method === "POST" || req.method === "PATCH")) {
          sendJson(res, 200, { success: true });
          return;
        }

        if (!url?.startsWith("/api/auth/") && url !== "/api/login") {
          next();
          return;
        }

        if (url === "/api/auth/user" && req.method === "GET") {
          const hasSession = req.headers.cookie?.includes(sessionCookie) ?? false;
          if (!hasSession) {
            sendJson(res, 401, { message: "Unauthorized" });
            return;
          }
          sendJson(res, 200, devUser);
          return;
        }

        if ((url === "/api/auth/email-login" || url === "/api/auth/register" || url === "/api/auth/firebase-login") && req.method === "POST") {
          try {
            const body = await readJsonBody(req);
            const email = typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : devUser.email;
            sendJson(
              res,
              200,
              { success: true, user: { ...devUser, email } },
              { "Set-Cookie": `${sessionCookie}; Path=/; SameSite=Lax` },
            );
          } catch (error: any) {
            sendJson(res, 400, { message: error?.message || "Invalid request" });
          }
          return;
        }

        if ((url === "/api/auth/apex-logout" || url === "/api/logout") && (req.method === "POST" || req.method === "GET")) {
          sendJson(res, 200, { success: true }, { "Set-Cookie": "apex_dev_auth=; Path=/; Max-Age=0; SameSite=Lax" });
          return;
        }

        if (url === "/api/login" && req.method === "GET") {
          res.writeHead(302, { Location: "/", "Set-Cookie": `${sessionCookie}; Path=/; SameSite=Lax` });
          res.end();
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_FIREBASE_API_KEY": JSON.stringify(process.env.GOOGLE_API_KEY_FIREBASE || ""),
  },
  plugins: [
    devClientAuthPlugin(),
    react(),
    runtimeErrorOverlay(),
    tailwindcss(),
    metaImagesPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
