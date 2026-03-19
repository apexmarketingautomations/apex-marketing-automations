import { getAIProviderStatus, isAIConfigured, logProviderStartup } from "./aiGateway";

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
  check("Google API", ["GOOGLE_API_KEY"], false);
  check("Vapi", ["VAPI_API_KEY"], false);
  check("Meta", ["META_APP_ID"], false);
  check("Mailchimp", ["MAILCHIMP_API_KEY"], false);

  const aiStatus = getAIProviderStatus();
  results.push({
    service: "AI Provider",
    status: isAIConfigured() ? "ok" : "missing",
    detail: `Primary=${aiStatus.primary} (configured=${aiStatus.openaiConfigured}), Fallback=${aiStatus.fallback} (configured=${aiStatus.geminiConfigured}), Active=${aiStatus.activeProvider}`,
  });

  logProviderStartup();

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
