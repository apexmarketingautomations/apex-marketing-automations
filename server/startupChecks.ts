import { getAIProviderStatus, isAIConfigured, logProviderStartup } from "./aiGateway";
import { emitVendorStartupWarnings } from "./vendorConfig";

export function runStartupChecks() {
  const results: { service: string; status: "ok" | "warning" | "missing"; detail?: string }[] = [];

  const check = (name: string, envVars: string[], required: boolean) => {
    const found = envVars.some((v) => !!process.env[v]);
    if (found) {
      results.push({ service: name, status: "ok" });
    } else if (required) {
      results.push({
        service: name,
        status: "warning",
        detail: `Missing: ${envVars.join(" or ")}`,
      });
    } else {
      results.push({
        service: name,
        status: "missing",
        detail: `Optional, not configured: ${envVars.join(" or ")}`,
      });
    }
  };

  check("Database", ["DATABASE_URL"], true);
  check("Stripe API", ["STRIPE_API_SECRET", "STRIPE_SECRET_KEY"], true);
  check("Stripe Webhook", ["STRIPE_WEBHOOK_SECRET"], true);
  check("Twilio", ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], true);
  check("Anthropic AI", ["ANTHROPIC_API_KEY", "AI_INTEGRATIONS_ANTHROPIC_API_KEY"], true);
  check("Apify Scraper", ["APIFY_API_KEY"], false);
  check("BatchData Skip Trace", ["BATCHDATA_API_KEY", "BATCHDATA_KEY", "BATCH_DATA"], false);
  check("ScrapingBee (FLHSMV)", ["SCRAPINGBEE_API_KEY"], false);
  check("DOL Safety Intelligence (OSHA/MSHA)", ["DOL_API_KEY"], false);
  check("Nimble Pipeline API", ["NIMBLE_API_USERNAME"], false);
  check("Google API", ["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY"], false);
  check("CourtListener (bankruptcy leads)", ["COURTLISTENER_API_TOKEN"], false);
  // VAPI_API_KEY is obsolete — system uses VAPI_PRIVATE_KEY_APEX, VAPI_PUBLIC_KEY, VAPI_ORG_ID
  // check("Vapi", ["VAPI_API_KEY"], false); // removed to avoid false warning
  check("Meta", ["META_APP_ID"], false);
  check("Mailchimp", ["MAILCHIMP_API_KEY"], false);

  const aiStatus = getAIProviderStatus();
  results.push({
    service: "AI Provider",
    status: isAIConfigured() ? "ok" : "missing",
    detail: `Primary=${aiStatus.primary} (configured=${aiStatus.openaiConfigured}), Fallback=${aiStatus.fallback} (configured=${aiStatus.geminiConfigured}), Active=${aiStatus.activeProvider}`,
  });

  logProviderStartup();
  emitVendorStartupWarnings();

  console.log("\n=== STARTUP HEALTH CHECK ===");
  for (const r of results) {
    const icon = r.status === "ok" ? "✓" : r.status === "warning" ? "⚠" : "○";
    const line = `  ${icon} ${r.service}: ${r.status}${r.detail ? ` — ${r.detail}` : ""}`;
    if (r.status === "warning") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
  console.log("============================\n");

  return results;
}
