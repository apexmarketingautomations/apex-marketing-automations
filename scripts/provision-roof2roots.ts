import { db } from "../server/db";
import { subAccounts, pipelineStages, creditWallets } from "../shared/schema";
import { users } from "../shared/models/auth";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function provision() {
  console.log("[PROVISION] Starting Roof 2 Roots account provisioning...");

  const existingAcct = await db.select({ id: subAccounts.id }).from(subAccounts)
    .where(eq(subAccounts.name, "Roof 2 Roots")).limit(1);
  if (existingAcct.length > 0) {
    console.log(`[PROVISION] Roof 2 Roots already exists as account #${existingAcct[0].id} — aborting`);
    process.exit(0);
  }

  const userId = `apex_roof2roots_${Date.now()}`;
  const tempPassword = crypto.randomBytes(16).toString("hex");
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const webhookToken = `r2r_${crypto.randomBytes(24).toString("hex")}`;

  console.log("[PROVISION] Creating user record...");
  await db.insert(users).values({
    id: userId,
    email: null,
    firstName: "Roof 2 Roots",
    lastName: "Admin",
    profileImageUrl: null,
    passwordHash,
    authProvider: "email",
    isAdmin: "false",
  });
  console.log(`[PROVISION] User created: ${userId}`);

  console.log("[PROVISION] Creating sub-account...");
  const [account] = await db.insert(subAccounts).values({
    name: "Roof 2 Roots",
    twilioNumber: "",
    industry: "home-services",
    vibeTheme: "cyber-glass",
    ownerUserId: userId,
    language: "en",
    plan: "god_mode",
    planFeatures: ["ai_coaching", "whale_tracker", "voice_agent", "ad_launcher", "site_builder", "meta_ads", "email_campaigns", "crm", "pipeline", "automations", "reports", "analytics", "integrations", "white_label"],
    webhookToken,
    isInternal: false,
    billingExempt: false,
    isDeletable: true,
    isProtected: false,
    role: "customer",
  }).returning();

  const acctId = account.id;
  console.log(`[PROVISION] Sub-account created: #${acctId}`);

  console.log("[PROVISION] Creating pipeline stages...");
  await db.insert(pipelineStages).values([
    { subAccountId: acctId, name: "New Lead" },
    { subAccountId: acctId, name: "Contacted" },
    { subAccountId: acctId, name: "Qualified" },
    { subAccountId: acctId, name: "Proposal Sent" },
    { subAccountId: acctId, name: "Negotiation" },
    { subAccountId: acctId, name: "Closed Won" },
    { subAccountId: acctId, name: "Closed Lost" },
  ]);
  console.log("[PROVISION] Pipeline stages created");

  console.log("[PROVISION] Creating credit wallet...");
  await db.insert(creditWallets).values({
    subAccountId: acctId,
    balance: 0,
    lifetimeTopUp: 0,
    lifetimeSpend: 0,
    autoTopUp: false,
    autoTopUpAmount: 25,
    lowBalanceThreshold: 5,
  });
  console.log("[PROVISION] Credit wallet created (balance: 0 — top-ups billed separately)");

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  ROOF 2 ROOTS — PROVISIONING COMPLETE");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  Account ID:     #${acctId}`);
  console.log(`  Account Name:   Roof 2 Roots`);
  console.log(`  User ID:        ${userId}`);
  console.log(`  Plan:           God Mode`);
  console.log(`  Billing:        12 months paid — top-ups billed separately`);
  console.log(`  Role:           customer (non-admin)`);
  console.log(`  isAdmin:        false`);
  console.log(`  isInternal:     false`);
  console.log(`  Isolation:      Full tenant isolation (ownerUserId scoping)`);
  console.log(`  Auth Provider:  email (separate credentials)`);
  console.log(`  Temp Password:  ${tempPassword}`);
  console.log(`  Webhook Token:  ${webhookToken}`);
  console.log(`  Integrations:   NONE — customer must configure their own`);
  console.log("══════════════════════════════════════════════════════");
  console.log("\nNEXT STEPS:");
  console.log("1. Set Roof 2 Roots' email on the user record");
  console.log("2. Share temp password with customer (or have them reset)");
  console.log("3. Customer logs in and sets up their own integrations");
  console.log("══════════════════════════════════════════════════════\n");

  process.exit(0);
}

provision().catch((err) => {
  console.error("[PROVISION] FATAL:", err);
  process.exit(1);
});
