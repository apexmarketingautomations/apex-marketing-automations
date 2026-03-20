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
  const adminUserId = process.env.ADMIN_USER_ID;
  if (!adminUserId) return;

  const existing = await db
    .select({ id: subAccounts.id, name: subAccounts.name, ownerUserId: subAccounts.ownerUserId })
    .from(subAccounts);

  const hasApex = existing.some((a) => a.name === "APEX MARKETING Account");
  const hasCrashConnect = existing.some((a) => a.name?.includes("Crash Connect") && a.name?.includes("Giovanni"));

  const isRealAccount = (name: string | null) =>
    name === "APEX MARKETING Account" ||
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

  const orphaned = existing.filter((a) => !a.ownerUserId);
  if (orphaned.length > 0) {
    for (const o of orphaned) {
      await db
        .update(subAccounts)
        .set({ ownerUserId: "_archived" })
        .where(eq(subAccounts.id, o.id));
    }
    console.log(`[SYNC] Archived ${orphaned.length} orphaned account(s)`);
  }

  if (hasApex && hasCrashConnect) {
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
      name: "Eddy",
      company: "Seed and Bean Market",
      theme: "midnight",
      links: [],
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
