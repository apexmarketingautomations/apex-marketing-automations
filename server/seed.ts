import { db } from "./db";
import {
  blueprints,
  subAccounts,
  pipelineStages,
  sentinelConfig,
  creditWallets,
  digitalCards,
  integrationConnections,
  workflows,
  liveAutomations,
  contacts,
} from "@shared/schema";
import { eq, isNull, sql, and, like } from "drizzle-orm";

export async function seed() {
  await seedBlueprints();
  await syncAdminAccounts();
  await fixOrphanedWorkflows();
  await fixOrphanedAutomations();
  await normalizeContactPhones();

  console.log("Database seeded successfully");
}

async function fixOrphanedWorkflows() {
  try {
    const apexAccount = await db.select({ id: subAccounts.id, twilioNumber: subAccounts.twilioNumber }).from(subAccounts)
      .where(eq(subAccounts.name, "APEX MARKETING Account")).limit(1);
    if (apexAccount.length === 0) return;

    const apexId = apexAccount[0].id;

    if (apexAccount[0].twilioNumber !== "+12396030102") {
      await db.update(subAccounts)
        .set({ twilioNumber: "+12396030102" })
        .where(eq(subAccounts.id, apexId));
      console.log(`[SEED] Fixed APEX twilio_number: "${apexAccount[0].twilioNumber}" -> "+12396030102"`);
    }

    const result = await db.update(workflows)
      .set({ subAccountId: apexId })
      .where(isNull(workflows.subAccountId))
      .returning({ id: workflows.id });

    if (result.length > 0) {
      console.log(`[SEED] Fixed ${result.length} orphaned workflow(s) — assigned to APEX account #${apexId}`);
    }
  } catch (e: any) {
    console.warn("[SEED] fixOrphanedWorkflows failed (non-fatal):", e.message);
  }
}

async function fixOrphanedAutomations() {
  try {
    const apexAccount = await db.select({ id: subAccounts.id }).from(subAccounts)
      .where(eq(subAccounts.name, "APEX MARKETING Account")).limit(1);
    if (apexAccount.length === 0) return;
    const apexId = apexAccount[0].id;

    const result = await db.update(liveAutomations)
      .set({ subAccountId: apexId })
      .where(isNull(liveAutomations.subAccountId))
      .returning({ id: liveAutomations.id });

    if (result.length > 0) {
      console.log(`[SEED] Fixed ${result.length} orphaned live_automation(s) — assigned to APEX account #${apexId}: ids=${result.map(r => r.id).join(",")}`);
    }
  } catch (e: any) {
    console.warn("[SEED] fixOrphanedAutomations failed (non-fatal):", e.message);
  }
}

async function normalizeContactPhones() {
  try {
    const rawContacts = await db.select({ id: contacts.id, phone: contacts.phone, subAccountId: contacts.subAccountId })
      .from(contacts)
      .where(sql`phone IS NOT NULL AND phone != ''`);

    let normalized = 0;
    for (const c of rawContacts) {
      if (!c.phone) continue;
      const digits = c.phone.replace(/\D/g, "");
      let e164 = c.phone;
      if (digits.length === 10) e164 = `+1${digits}`;
      else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
      else if (c.phone.startsWith("+")) e164 = c.phone.replace(/[^\d+]/g, "");
      else e164 = `+${digits}`;

      if (e164 !== c.phone) {
        try {
          await db.update(contacts).set({ phone: e164 }).where(eq(contacts.id, c.id));
          normalized++;
        } catch {}
      }
    }
    if (normalized > 0) {
      console.log(`[SEED] Normalized ${normalized} contact phone(s) to E.164 format`);
    }
  } catch (e: any) {
    console.warn("[SEED] normalizeContactPhones failed (non-fatal):", e.message);
  }
}

async function syncAdminAccounts() {
  try {
  const adminUserId = process.env.ADMIN_USER_ID || "53528927";
  console.log(`[SYNC] Admin user ID: ${adminUserId} (source: ${process.env.ADMIN_USER_ID ? 'env' : 'fallback'})`);
  if (!adminUserId) return;

  const existing = await db
    .select({ id: subAccounts.id, name: subAccounts.name, ownerUserId: subAccounts.ownerUserId, parentAccountId: subAccounts.parentAccountId })
    .from(subAccounts);

  const hasApex = existing.some((a) => a.name === "APEX MARKETING Account");
  const hasCrashConnect = existing.some((a) => a.name?.includes("Crash Connect") && a.name?.includes("Giovanni"));

  const isRealAccount = (name: string | null, id?: number) =>
    name === "APEX MARKETING Account" ||
    name === "Officer Layla" ||
    (name?.includes("Crash Connect") && name?.includes("Giovanni"));

  const junkAccounts = existing.filter(
    (a) => a.ownerUserId === adminUserId && !isRealAccount(a.name),
  );
  if (junkAccounts.length > 0) {
    for (const junk of junkAccounts) {
      await db
        .update(subAccounts)
        .set({ ownerUserId: "_archived" })
        .where(eq(subAccounts.id, junk.id));
    }
    console.log(
      `[SYNC] Archived ${junkAccounts.length} legacy account(s): ${junkAccounts.map((a) => `#${a.id} "${a.name}"`).join(", ")}`,
    );
  }

  const orphaned = existing.filter((a) => !a.ownerUserId && !a.parentAccountId && !isRealAccount(a.name));
  if (orphaned.length > 0) {
    for (const o of orphaned) {
      await db
        .update(subAccounts)
        .set({ ownerUserId: "_archived" })
        .where(eq(subAccounts.id, o.id));
    }
    console.log(`[SYNC] Archived ${orphaned.length} orphaned account(s)`);
  }

  if (hasApex) {
    const apexAccount = existing.find((a) => a.name === "APEX MARKETING Account");
    if (apexAccount) {
      const [existingCard] = await db.select({ id: digitalCards.id, slug: digitalCards.slug })
        .from(digitalCards).where(eq(digitalCards.subAccountId, apexAccount.id)).limit(1);
      if (existingCard && !existingCard.slug) {
        await db.update(digitalCards).set({
          name: "Dante S.",
          preferredName: "Dante",
          title: "Founder & CEO",
          company: "Apex Marketing Automations",
          phone: "(239) 492-2698",
          email: "Dante@apexmarketingautomations.com",
          website: "apexmarketingautomations.com",
          slug: "dantes",
          brandColor: "#6366f1",
          accentColor: "#8b5cf6",
          theme: "executive-dark",
          location: "Fort Myers, FL",
          tagline: "Full-stack creative and technologist building AI-powered platforms that help businesses scale on autopilot.",
          bio: "Full-stack creative and technologist. I design, build, and market AI-powered platforms that help businesses scale on autopilot. From pixel-perfect graphics to production-grade software, multi-channel marketing campaigns to autonomous voice agents — I turn ideas into systems that work around the clock.",
          services: [
            { label: "Graphic Design", description: "Brand identities, landing pages, and visual systems for 17+ industries", icon: "palette", color: "from-pink-500 to-rose-500" },
            { label: "Software Engineering", description: "Full SaaS platform built from scratch — auth, billing, APIs, and real-time data", icon: "code", color: "from-indigo-500 to-blue-500" },
            { label: "Web Development", description: "AI-powered site builder that generates complete websites from a single prompt", icon: "globe", color: "from-cyan-500 to-teal-500" },
            { label: "Digital Marketing", description: "Meta Ads launcher with geofence targeting, audience builder, and ROI tracking", icon: "megaphone", color: "from-orange-500 to-amber-500" },
            { label: "AI & Automation", description: "Train AI chatbots on any website — RAG pipeline with tool-calling and memory", icon: "bot", color: "from-purple-500 to-violet-500" },
            { label: "Voice AI Agents", description: "Deploy AI receptionists that answer calls, book appointments, and qualify leads 24/7", icon: "mic", color: "from-emerald-500 to-green-500" },
          ],
          testimonial: {
            quote: "I don't just build software — I build revenue machines. Every feature is designed to generate leads, close deals, and save time. If it doesn't make money, it doesn't ship.",
            author: "Dante S.",
            role: "Founder, Apex Marketing Automations",
          },
          socialLinks: [],
          links: [],
          status: "published",
          isActive: true,
          isPublic: true,
          updatedAt: new Date(),
        }).where(eq(digitalCards.id, existingCard.id));
        console.log(`[SYNC] Updated digital card #${existingCard.id} with slug "dantes"`);
      } else if (!existingCard) {
        await db.insert(digitalCards).values({
          subAccountId: apexAccount.id,
          name: "Dante S.",
          preferredName: "Dante",
          title: "Founder & CEO",
          company: "Apex Marketing Automations",
          phone: "(239) 492-2698",
          email: "Dante@apexmarketingautomations.com",
          website: "apexmarketingautomations.com",
          slug: "dantes",
          brandColor: "#6366f1",
          accentColor: "#8b5cf6",
          theme: "executive-dark",
          location: "Fort Myers, FL",
          tagline: "Full-stack creative and technologist building AI-powered platforms that help businesses scale on autopilot.",
          bio: "Full-stack creative and technologist. I design, build, and market AI-powered platforms that help businesses scale on autopilot. From pixel-perfect graphics to production-grade software, multi-channel marketing campaigns to autonomous voice agents — I turn ideas into systems that work around the clock.",
          services: [
            { label: "Graphic Design", description: "Brand identities, landing pages, and visual systems for 17+ industries", icon: "palette", color: "from-pink-500 to-rose-500" },
            { label: "Software Engineering", description: "Full SaaS platform built from scratch — auth, billing, APIs, and real-time data", icon: "code", color: "from-indigo-500 to-blue-500" },
            { label: "Web Development", description: "AI-powered site builder that generates complete websites from a single prompt", icon: "globe", color: "from-cyan-500 to-teal-500" },
            { label: "Digital Marketing", description: "Meta Ads launcher with geofence targeting, audience builder, and ROI tracking", icon: "megaphone", color: "from-orange-500 to-amber-500" },
            { label: "AI & Automation", description: "Train AI chatbots on any website — RAG pipeline with tool-calling and memory", icon: "bot", color: "from-purple-500 to-violet-500" },
            { label: "Voice AI Agents", description: "Deploy AI receptionists that answer calls, book appointments, and qualify leads 24/7", icon: "mic", color: "from-emerald-500 to-green-500" },
          ],
          testimonial: {
            quote: "I don't just build software — I build revenue machines. Every feature is designed to generate leads, close deals, and save time. If it doesn't make money, it doesn't ship.",
            author: "Dante S.",
            role: "Founder, Apex Marketing Automations",
          },
          socialLinks: [],
          links: [],
          status: "published",
          isActive: true,
          isPublic: true,
        });
        console.log(`[SYNC] Created digital card for APEX account #${apexAccount.id}`);
      }
    }
  }

  await ensureLaylaAccount(adminUserId, existing);
  await ensureRoof2RootsAccount(existing);

  if (hasApex && hasCrashConnect) {
    console.log("[SYNC] Admin account sync complete");
    return;
  }

  console.log("[SYNC] Admin accounts missing — creating real accounts...");

  if (!hasApex) {
    const [apexAcct] = await db
      .insert(subAccounts)
      .values({
        name: "APEX MARKETING Account",
        twilioNumber: "+18777030325",
        googleReviewLink: "https://g.page/r/CY4EJ5F_Kli-EAI/review",
        ownerPhone: "+12394922698",
        industry: "marketing-agency",
        vibeTheme: "sunset-warm",
        ownerUserId: adminUserId,
        language: "en",
        plan: "enterprise",
      })
      .returning();

    const apexId = apexAcct.id;
    console.log(`[SYNC] Created APEX MARKETING Account #${apexId}`);

    await db.insert(pipelineStages).values([
      { subAccountId: apexId, name: "New Lead" },
      { subAccountId: apexId, name: "Contacted" },
      { subAccountId: apexId, name: "Qualified" },
      { subAccountId: apexId, name: "Proposal Sent" },
      { subAccountId: apexId, name: "Negotiation" },
      { subAccountId: apexId, name: "Closed Won" },
      { subAccountId: apexId, name: "Closed Lost" },
    ]);

    await db.insert(sentinelConfig).values({
      subAccountId: apexId,
      keywords: ["MVA", "EXTRICATION", "ROLLOVER", "INJURIES", "SIGNAL 4", "ENTRAPMENT", "FATALITY"],
      scanInterval: 24,
      enabled: true,
      smsAlertEnabled: true,
      geofenceEnabled: true,
      geofenceRadiusMiles: 5,
      smsAlertPhone: "+12394922698",
    });

    await db.insert(creditWallets).values({
      subAccountId: apexId,
      balance: 25,
      lifetimeTopUp: 0,
      lifetimeSpend: 0,
      autoTopUp: false,
      autoTopUpAmount: 25,
      lowBalanceThreshold: 5,
    });

    await db.insert(digitalCards).values({
      subAccountId: apexId,
      name: "Dante S.",
      preferredName: "Dante",
      title: "Founder & CEO",
      company: "Apex Marketing Automations",
      phone: "(239) 492-2698",
      email: "Dante@apexmarketingautomations.com",
      website: "apexmarketingautomations.com",
      slug: "dantes",
      brandColor: "#6366f1",
      accentColor: "#8b5cf6",
      theme: "executive-dark",
      location: "Fort Myers, FL",
      tagline: "Full-stack creative and technologist building AI-powered platforms that help businesses scale on autopilot.",
      bio: "Full-stack creative and technologist. I design, build, and market AI-powered platforms that help businesses scale on autopilot. From pixel-perfect graphics to production-grade software, multi-channel marketing campaigns to autonomous voice agents — I turn ideas into systems that work around the clock.",
      services: [
        { label: "Graphic Design", description: "Brand identities, landing pages, and visual systems for 17+ industries", icon: "palette", color: "from-pink-500 to-rose-500" },
        { label: "Software Engineering", description: "Full SaaS platform built from scratch — auth, billing, APIs, and real-time data", icon: "code", color: "from-indigo-500 to-blue-500" },
        { label: "Web Development", description: "AI-powered site builder that generates complete websites from a single prompt", icon: "globe", color: "from-cyan-500 to-teal-500" },
        { label: "Digital Marketing", description: "Meta Ads launcher with geofence targeting, audience builder, and ROI tracking", icon: "megaphone", color: "from-orange-500 to-amber-500" },
        { label: "AI & Automation", description: "Train AI chatbots on any website — RAG pipeline with tool-calling and memory", icon: "bot", color: "from-purple-500 to-violet-500" },
        { label: "Voice AI Agents", description: "Deploy AI receptionists that answer calls, book appointments, and qualify leads 24/7", icon: "mic", color: "from-emerald-500 to-green-500" },
      ],
      testimonial: {
        quote: "I don't just build software — I build revenue machines. Every feature is designed to generate leads, close deals, and save time. If it doesn't make money, it doesn't ship.",
        author: "Dante S.",
        role: "Founder, Apex Marketing Automations",
      },
      socialLinks: [],
      links: [],
      status: "published",
      isActive: true,
      isPublic: true,
    });

    const integrations = [
      { provider: "google-calendar", config: { clientId: "configured", clientSecret: "configured" }, status: "connected" },
      { provider: "twilio", config: { accountSid: "configured", authToken: "configured" }, status: "connected" },
      { provider: "facebook", config: { pageAccessToken: "configured", pageId: "configured" }, status: "connected" },
      { provider: "mailchimp", config: { apiKey: "configured" }, status: "connected" },
      { provider: "google-analytics", config: { measurementId: "configured", apiSecret: "configured" }, status: "connected" },
      { provider: "meta-ads", config: { accessToken: "configured", adAccountId: "configured" }, status: "connected" },
      { provider: "stripe", config: { publishableKey: "configured", secretKey: "configured" }, status: "connected" },
    ];

    for (const integ of integrations) {
      await db.insert(integrationConnections).values({
        subAccountId: apexId,
        provider: integ.provider,
        config: integ.config,
        status: integ.status,
      });
    }

    console.log(`[SYNC] APEX MARKETING Account #${apexId} fully configured`);
  }

  if (!hasCrashConnect) {
    const [ccAcct] = await db
      .insert(subAccounts)
      .values({
        name: "Crash Connect \u2014 Giovanni",
        twilioNumber: "+12396773236",
        ownerPhone: "+14074808167",
        industry: "personal-injury",
        vibeTheme: "cyber-glass",
        ownerUserId: "apex_giovanni_1771975559683",
        language: "en",
        plan: "enterprise",
        webhookToken: "cc_9d2f4c609e35569db8ce1fcd6187f02e833852adc97b7a2d",
      })
      .returning();

    const ccId = ccAcct.id;
    console.log(`[SYNC] Created Crash Connect Account #${ccId}`);

    await db.insert(creditWallets).values({
      subAccountId: ccId,
      balance: 5,
      lifetimeTopUp: 5,
      lifetimeSpend: 0,
      autoTopUp: false,
      autoTopUpAmount: 25,
      lowBalanceThreshold: 5,
    });

    console.log(`[SYNC] Crash Connect Account #${ccId} fully configured`);
  }

  console.log("[SYNC] Admin account sync complete");
  } catch (error) {
    console.warn("[SYNC] syncAdminAccounts failed (non-fatal):", error);
  }
}

async function ensureLaylaAccount(
  adminUserId: string,
  existing: Array<{ id: number; name: string; ownerUserId: string | null; parentAccountId: number | null }>
) {
  try {
    let laylaAccount = existing.find((a) => a.name === "Officer Layla");
    const apexAccount = existing.find((a) => a.name === "APEX MARKETING Account");
    const apexId = apexAccount?.id || 13;

    if (!laylaAccount) {
      console.log("[SYNC] Officer Layla account not found — creating...");
      const [created] = await db.insert(subAccounts).values({
        name: "Officer Layla",
        twilioNumber: "",
        ownerUserId: adminUserId,
        parentAccountId: apexId,
        isInternal: true,
        plan: "enterprise",
        billingExempt: true,
        isDeletable: false,
        isProtected: false,
        protectedReason: null,
        industry: "AI Persona / Marketing Automation",
        metaPageId: "736112766259045",
        metaAccessToken: process.env.META_ACCESS_TOKEN_LAYLA || "",
        config: {
          commentBot: {
            enabled: true,
            replyStyle: "layla",
            skipRepliesOnReplies: true,
            maxRepliesPerHour: 30,
          },
          reengage: {
            enabled: true,
            daysThreshold: 60,
            batchLimit: 20,
          },
        },
      }).returning({ id: subAccounts.id, name: subAccounts.name, ownerUserId: subAccounts.ownerUserId, parentAccountId: subAccounts.parentAccountId });
      laylaAccount = created;
      console.log(`[SYNC] Created Officer Layla account #${created.id}`);
    }

    const laylaId = laylaAccount.id;

    if (laylaAccount.ownerUserId === "_archived" || !laylaAccount.ownerUserId) {
      await db.update(subAccounts)
        .set({
          ownerUserId: adminUserId,
          parentAccountId: apexId,
          isInternal: true,
          plan: "enterprise",
          billingExempt: true,
          isDeletable: false,
        })
        .where(eq(subAccounts.id, laylaId));
      console.log(`[SYNC] Restored Officer Layla account #${laylaId} — ownerUserId=${adminUserId}, parentAccountId=${apexId}`);
    }

    if (!laylaAccount.parentAccountId) {
      await db.update(subAccounts)
        .set({ parentAccountId: apexId })
        .where(eq(subAccounts.id, laylaId));
      console.log(`[SYNC] Set Officer Layla parentAccountId=${apexId}`);
    }

    const [currentMeta] = await db.select({ metaPageId: subAccounts.metaPageId, metaAccessToken: subAccounts.metaAccessToken })
      .from(subAccounts).where(eq(subAccounts.id, laylaId));
    if (!currentMeta?.metaAccessToken || !currentMeta?.metaPageId) {
      await db.update(subAccounts)
        .set({
          metaPageId: "736112766259045",
          metaAccessToken: process.env.META_ACCESS_TOKEN_LAYLA || "",
        })
        .where(eq(subAccounts.id, laylaId));
      console.log(`[SYNC] Set Meta credentials for Officer Layla #${laylaId}`);
    }

    const existingWallet = await db.select({ id: creditWallets.id })
      .from(creditWallets).where(eq(creditWallets.subAccountId, laylaId)).limit(1);
    if (existingWallet.length === 0) {
      await db.insert(creditWallets).values({
        subAccountId: laylaId,
        balance: 25,
        lifetimeTopUp: 0,
        lifetimeSpend: 0,
        autoTopUp: false,
        autoTopUpAmount: 25,
        lowBalanceThreshold: 5,
      });
      console.log(`[SYNC] Created credit wallet for Officer Layla #${laylaId}`);
    }

    const existingConnections = await db.select({ id: integrationConnections.id })
      .from(integrationConnections).where(eq(integrationConnections.subAccountId, laylaId)).limit(1);
    if (existingConnections.length === 0) {
      const laylaIntegrations = [
        { provider: "facebook", config: { pageAccessToken: "configured", pageId: "configured" }, status: "connected" },
        { provider: "meta-ads", config: { accessToken: "configured", adAccountId: "configured" }, status: "connected" },
      ];
      for (const integ of laylaIntegrations) {
        await db.insert(integrationConnections).values({
          subAccountId: laylaId,
          provider: integ.provider,
          config: integ.config,
          status: integ.status,
        });
      }
      console.log(`[SYNC] Created ${laylaIntegrations.length} integration connections for Officer Layla #${laylaId}`);
    }

    const [currentConfig] = await db.select({ config: subAccounts.config })
      .from(subAccounts).where(eq(subAccounts.id, laylaId));
    if (!currentConfig?.config) {
      await db.update(subAccounts)
        .set({
          config: {
            commentBot: {
              enabled: true,
              replyStyle: "layla",
              skipRepliesOnReplies: true,
              maxRepliesPerHour: 30,
            },
            reengage: {
              enabled: true,
              daysThreshold: 60,
              batchLimit: 20,
            },
          },
        })
        .where(eq(subAccounts.id, laylaId));
      console.log(`[SYNC] Set default config for Officer Layla #${laylaId}`);
    }

    console.log(`[SYNC] Officer Layla account #${laylaId} fully configured`);
  } catch (e: any) {
    console.warn("[SYNC] ensureLaylaAccount failed (non-fatal):", e.message);
  }
}

async function ensureRoof2RootsAccount(
  existing: Array<{ id: number; name: string; ownerUserId: string | null; parentAccountId: number | null }>
) {
  try {
    let r2r = existing.find((a) => a.name === "Roof 2 Roots");
    const apexAccount = existing.find((a) => a.name === "APEX MARKETING Account");
    const apexId = apexAccount?.id || 13;

    if (!r2r) {
      console.log("[SYNC] Roof 2 Roots account not found — creating...");
      const [created] = await db.insert(subAccounts).values({
        name: "Roof 2 Roots",
        twilioNumber: "",
        ownerUserId: `apex_roof2roots_${Date.now()}`,
        parentAccountId: apexId,
        isInternal: false,
        plan: "god_mode",
        billingExempt: true,
        isDeletable: false,
        isProtected: false,
        protectedReason: null,
        industry: "roofing",
      }).returning({ id: subAccounts.id, name: subAccounts.name, ownerUserId: subAccounts.ownerUserId, parentAccountId: subAccounts.parentAccountId });
      r2r = created;
      console.log(`[SYNC] Created Roof 2 Roots account #${created.id}`);
    }

    const r2rId = r2r.id;

    if (r2r.ownerUserId === "_archived" || !r2r.ownerUserId) {
      await db.update(subAccounts)
        .set({
          ownerUserId: `apex_roof2roots_${Date.now()}`,
          parentAccountId: apexId,
          plan: "god_mode",
          billingExempt: true,
          isDeletable: false,
        })
        .where(eq(subAccounts.id, r2rId));
      console.log(`[SYNC] Restored Roof 2 Roots account #${r2rId}`);
    }

    if (!r2r.parentAccountId) {
      await db.update(subAccounts)
        .set({ parentAccountId: apexId })
        .where(eq(subAccounts.id, r2rId));
      console.log(`[SYNC] Set Roof 2 Roots parentAccountId=${apexId}`);
    }

    const existingSentinel = await db.select({ id: sentinelConfig.id })
      .from(sentinelConfig).where(eq(sentinelConfig.subAccountId, r2rId)).limit(1);
    if (existingSentinel.length === 0) {
      await db.insert(sentinelConfig).values({
        subAccountId: r2rId,
        feedUrl: "",
        keywords: [],
        scanInterval: 15,
        enabled: true,
        smsAlertEnabled: false,
        geofenceEnabled: false,
        geofenceRadiusMiles: 0,
        targetCities: [],
        targetStates: ["FL", "TX", "GA", "NC", "SC", "LA"],
        niche: "home_services",
      });
      console.log(`[SYNC] Created sentinel_config for Roof 2 Roots #${r2rId} (home_services niche)`);
    }

    const existingWallet = await db.select({ id: creditWallets.id })
      .from(creditWallets).where(eq(creditWallets.subAccountId, r2rId)).limit(1);
    if (existingWallet.length === 0) {
      await db.insert(creditWallets).values({
        subAccountId: r2rId,
        balance: 50,
        lifetimeTopUp: 0,
        lifetimeSpend: 0,
        autoTopUp: false,
        autoTopUpAmount: 50,
        lowBalanceThreshold: 10,
      });
      console.log(`[SYNC] Created credit wallet for Roof 2 Roots #${r2rId}`);
    }

    console.log(`[SYNC] Roof 2 Roots account #${r2rId} fully configured`);
  } catch (e: any) {
    console.warn("[SYNC] ensureRoof2RootsAccount failed (non-fatal):", e.message);
  }
}

async function seedBlueprints() {
  const allBlueprints = [
    {
      industryId: "gym",
      title: "Fitness Center",
      stages: ["New Lead", "Trial Booked", "Trial Completed", "Member Signed", "Churned"],
      fields: ["Fitness Goal", "Preferred Time", "Injury History"],
      templates: ["Trial Confirmation SMS", "Missed Workout Follow-up"],
    },
    {
      industryId: "real_estate",
      title: "Real Estate Agency",
      stages: ["Inquiry", "Viewing Scheduled", "Offer Made", "Under Contract", "Sold"],
      fields: ["Budget Range", "Property Type", "Mortgage Status"],
      templates: ["New Listing Alert", "Open House Invite"],
    },
    {
      industryId: "dental",
      title: "Dental Practice",
      stages: ["New Patient", "Consultation", "Treatment Plan", "Procedure Scheduled", "Follow-up"],
      fields: ["Insurance Provider", "Last Visit Date", "Pain Level"],
      templates: ["Appointment Reminder", "6-Month Checkup Recall"],
    },
    {
      industryId: "contractor",
      title: "Home Services",
      stages: ["Lead", "Estimate Sent", "Job Scheduled", "In Progress", "Completed"],
      fields: ["Property Address", "Service Type", "Urgency Level"],
      templates: ["Estimate Follow-up", "Job Complete Review Request"],
    },
    {
      industryId: "law_firm",
      title: "Law Firm",
      stages: ["New Inquiry", "Consultation Scheduled", "Case Evaluation", "Retainer Signed", "Active Case", "Case Closed"],
      fields: ["Case Type", "Injury Type", "Accident Date", "Insurance Carrier", "Statute Deadline"],
      templates: ["Free Consultation SMS", "Case Update Notification", "Document Request Email"],
    },
    {
      industryId: "auto_dealer",
      title: "Auto Dealership",
      stages: ["Website Lead", "Showroom Visit", "Test Drive", "Finance Application", "Sold", "Service Follow-up"],
      fields: ["Vehicle Interest", "Trade-In Value", "Credit Range", "Down Payment Budget"],
      templates: ["New Arrival Alert", "Test Drive Confirmation", "Finance Approval SMS"],
    },
    {
      industryId: "salon",
      title: "Salon & Spa",
      stages: ["New Client", "Consultation", "Appointment Booked", "Service Completed", "Loyalty Member"],
      fields: ["Service Preference", "Allergies", "Stylist Preference", "Membership Tier"],
      templates: ["Appointment Reminder", "Birthday Discount", "Rebooking Nudge"],
    },
    {
      industryId: "education",
      title: "Education & Coaching",
      stages: ["Prospect", "Discovery Call", "Enrolled", "Active Student", "Graduated", "Alumni"],
      fields: ["Program Interest", "Schedule Preference", "Learning Goals", "Budget"],
      templates: ["Enrollment Confirmation", "Class Reminder", "Progress Update"],
    },
    {
      industryId: "restaurant",
      title: "Restaurant & Bar",
      stages: ["New Subscriber", "First Visit", "Regular", "VIP", "Lapsed"],
      fields: ["Dietary Preferences", "Favorite Items", "Party Size", "Special Dates"],
      templates: ["Reservation Confirmation", "Happy Hour Promo", "Birthday Offer"],
    },
    {
      industryId: "insurance",
      title: "Insurance Agency",
      stages: ["Lead", "Quote Requested", "Quote Sent", "Application", "Policy Bound", "Renewal"],
      fields: ["Coverage Type", "Current Carrier", "Policy Expiry", "Household Size"],
      templates: ["Quote Follow-up", "Policy Renewal Reminder", "Claims Support SMS"],
    },
    {
      industryId: "medspa",
      title: "Med Spa & Aesthetics",
      stages: ["Inquiry", "Consultation Booked", "Treatment Plan", "Procedure Scheduled", "Post-Care", "Maintenance"],
      fields: ["Treatment Interest", "Skin Type", "Medical History", "Budget Range"],
      templates: ["Consultation Confirmation", "Pre-Treatment Instructions", "Post-Care Follow-up"],
    },
    {
      industryId: "property_mgmt",
      title: "Property Management",
      stages: ["Inquiry", "Application", "Screening", "Lease Signed", "Active Tenant", "Move-Out"],
      fields: ["Unit Interest", "Move-In Date", "Pet Info", "Income Verification"],
      templates: ["Application Received", "Lease Renewal Reminder", "Maintenance Request Update"],
    },
    {
      industryId: "logistics",
      title: "Logistics & Moving",
      stages: ["Quote Request", "Estimate Sent", "Booking Confirmed", "In Transit", "Delivered", "Review"],
      fields: ["Origin Address", "Destination", "Move Date", "Inventory Size"],
      templates: ["Quote Confirmation", "Moving Day Checklist", "Delivery Confirmation"],
    },
    {
      industryId: "veterinary",
      title: "Veterinary Clinic",
      stages: ["New Pet", "Appointment Booked", "Exam Complete", "Treatment Plan", "Follow-Up", "Wellness Check"],
      fields: ["Pet Name", "Species/Breed", "Age", "Vaccination Status", "Insurance"],
      templates: ["Appointment Reminder", "Vaccination Due Notice", "Post-Visit Summary"],
    },
    {
      industryId: "photography",
      title: "Photography & Video",
      stages: ["Inquiry", "Discovery Call", "Proposal Sent", "Booked", "Shoot Complete", "Delivered"],
      fields: ["Event Type", "Date", "Location", "Package Interest", "Guest Count"],
      templates: ["Booking Confirmation", "Pre-Shoot Prep Email", "Gallery Ready Notification"],
    },
    {
      industryId: "nonprofit",
      title: "Nonprofit & Charity",
      stages: ["New Donor", "First Gift", "Recurring Donor", "Major Donor", "Lapsed", "Re-engaged"],
      fields: ["Giving History", "Cause Interest", "Volunteer Status", "Communication Preference"],
      templates: ["Thank You SMS", "Impact Report Email", "Year-End Campaign Appeal"],
    },
    {
      industryId: "auto_repair",
      title: "Auto Repair Shop",
      stages: ["New Customer", "Estimate Requested", "Approved", "In Shop", "Ready for Pickup", "Follow-Up"],
      fields: ["Vehicle Make/Model", "Year", "Mileage", "Service History"],
      templates: ["Estimate Ready SMS", "Vehicle Ready Notification", "Service Reminder"],
    },
    {
      industryId: "travel",
      title: "Travel & Hospitality",
      stages: ["Inquiry", "Itinerary Sent", "Booked", "Pre-Trip", "Traveling", "Post-Trip Review"],
      fields: ["Destination Interest", "Travel Dates", "Budget", "Group Size", "Preferences"],
      templates: ["Itinerary Confirmation", "Pre-Trip Checklist", "Post-Trip Review Request"],
    },
    {
      industryId: "financial",
      title: "Financial Services",
      stages: ["Prospect", "Discovery Meeting", "Plan Presented", "Engaged Client", "Annual Review", "Referral"],
      fields: ["Net Worth Range", "Investment Goals", "Risk Tolerance", "Account Types"],
      templates: ["Meeting Confirmation", "Market Update", "Annual Review Reminder"],
    },
  ];

  let seeded = 0;
  for (const bp of allBlueprints) {
    const existing = await db.select().from(blueprints).where(eq(blueprints.industryId, bp.industryId));
    if (existing.length === 0) {
      await db.insert(blueprints).values(bp);
      seeded++;
    }
  }
  if (seeded > 0) {
    console.log(`Seeded ${seeded} new industry blueprints`);
  }
}
