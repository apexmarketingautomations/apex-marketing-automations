import { db } from "./db";
import { subAccounts, messages, workflows, blueprints, owners } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export async function seed() {
  const existingOwners = await db.select().from(owners);
  if (existingOwners.length === 0) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.pbkdf2Sync("admin123", salt, 1000, 64, "sha512").toString("hex");
    await db.insert(owners).values({
      email: "admin@apex.com",
      passwordHash: `${salt}:${hash}`,
      name: "Apex Admin",
    });
    console.log("Default owner seeded: admin@apex.com / admin123");
  }

  await seedBlueprints();

  const existingAccounts = await db.select().from(subAccounts);
  if (existingAccounts.length > 0) return;

  const [acc1, acc2] = await db.insert(subAccounts).values([
    { name: "Sales Team A", twilioNumber: "+15550101" },
    { name: "Support Team", twilioNumber: "+15550102" },
  ]).returning();

  await db.insert(messages).values([
    {
      subAccountId: acc1.id,
      direction: "inbound",
      body: "Hey, I am interested in the enterprise plan.",
      status: "received",
      contactPhone: "+15559999",
      channel: "sms",
    },
    {
      subAccountId: acc1.id,
      direction: "outbound",
      body: "Hi there! I would be happy to help you with that. When are you free for a call?",
      status: "delivered",
      contactPhone: "+15559999",
      channel: "sms",
    },
  ]);

  await db.insert(workflows).values([
    {
      name: "Lead Follow-up",
      trigger: "facebook_form_submit",
      steps: [
        { action_type: "WAIT", params: { duration_minutes: 5 } },
        { action_type: "SMS", params: { body: "Hey" } },
        { action_type: "CONDITION", params: { check: "has_replied" } },
        { action_type: "ALERT", params: { user_id: "admin" } },
      ],
      subAccountId: acc1.id,
    },
  ]);

  console.log("Database seeded successfully");
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
