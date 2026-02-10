import { db } from "./db";
import { subAccounts, messages, workflows, blueprints } from "@shared/schema";

export async function seed() {
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

  await db.insert(blueprints).values([
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
  ]);

  console.log("Database seeded successfully");
}
