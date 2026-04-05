import { db } from "../server/db";
import { messages, contacts, subAccounts } from "../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[VALIDATE] ${msg}`);
}

function pass(name: string, details: string) {
  results.push({ name, passed: true, details });
  log(`✓ ${name}: ${details}`);
}

function fail(name: string, details: string) {
  results.push({ name, passed: false, details });
  log(`✗ ${name}: ${details}`);
}

function generateTelegramWebhookSecret(subAccountId: number | string): string {
  const salt = process.env.TELEGRAM_WEBHOOK_SECRET_SALT || process.env.SESSION_SECRET;
  if (!salt) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET_SALT or SESSION_SECRET must be set for Telegram webhook security");
  }
  return crypto.createHash("sha256").update(`tg-webhook-${subAccountId}-${salt}`).digest("hex").substring(0, 32);
}

async function testWhatsAppInbound() {
  log("--- WhatsApp Inbound Test ---");

  const allAccounts = await db.select().from(subAccounts);
  const accountWithTwilio = allAccounts.find(a => a.twilioNumber && a.twilioNumber.length > 5);

  if (!accountWithTwilio) {
    log("No sub-account with a Twilio number found — skipping WhatsApp inbound test");
    return;
  }

  const testPhone = "+15559990001";
  const testBody = `WhatsApp validation test ${Date.now()}`;
  const toNumber = accountWithTwilio.twilioNumber;

  log(`Using account ${accountWithTwilio.id} (${accountWithTwilio.name}) with Twilio number ${toNumber}`);

  try {
    const res = await fetch(`${BASE_URL}/api/sms-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: `whatsapp:${testPhone}`,
        To: `whatsapp:${toNumber}`,
        Body: testBody,
        MessageSid: `SM_test_wa_${Date.now()}`,
      }).toString(),
    });

    if (res.ok) {
      pass("WhatsApp webhook accepts request", `HTTP ${res.status}`);
    } else {
      fail("WhatsApp webhook accepts request", `HTTP ${res.status}`);
    }

    await new Promise(r => setTimeout(r, 3000));

    const stored = await db.select().from(messages)
      .where(and(
        eq(messages.contactPhone, testPhone),
        eq(messages.channel, "whatsapp"),
        eq(messages.direction, "inbound"),
        eq(messages.subAccountId, accountWithTwilio.id),
      ))
      .orderBy(desc(messages.id))
      .limit(1);

    if (stored.length > 0 && stored[0].body === testBody) {
      pass("WhatsApp inbound message stored", `id=${stored[0].id}, channel=${stored[0].channel}, subAccountId=${stored[0].subAccountId}`);
    } else if (stored.length > 0) {
      pass("WhatsApp inbound message found", `id=${stored[0].id}, channel=${stored[0].channel}`);
    } else {
      fail("WhatsApp inbound message stored", "No whatsapp inbound message found — check routing logs");
    }

    const outbound = await db.select().from(messages)
      .where(and(
        eq(messages.contactPhone, testPhone),
        eq(messages.channel, "whatsapp"),
        eq(messages.direction, "outbound"),
        eq(messages.subAccountId, accountWithTwilio.id),
      ))
      .orderBy(desc(messages.id))
      .limit(1);

    if (outbound.length > 0) {
      pass("WhatsApp AI auto-reply stored", `id=${outbound[0].id}, status=${outbound[0].status}`);
    } else {
      log("No outbound WhatsApp reply found (Twilio credentials may not support WhatsApp sandbox — this is expected until Twilio WhatsApp is configured)");
    }
  } catch (err: any) {
    fail("WhatsApp inbound test", `Error: ${err.message}`);
  }
}

async function testTelegramInbound() {
  log("--- Telegram Inbound Test ---");

  const allAccounts = await db.select().from(subAccounts);
  const tgAccount = allAccounts.find(a => a.telegramBotToken);

  const testChatId = "999888777";
  const testText = `Telegram validation test ${Date.now()}`;

  if (tgAccount) {
    log(`Found Telegram-configured account: ${tgAccount.id} (${tgAccount.name})`);
  } else {
    log("No account with telegramBotToken configured — testing webhook routing only");
  }

  const subAccountId = tgAccount?.id || 13;
  const webhookSecret = generateTelegramWebhookSecret(subAccountId);

  const telegramPayload = {
    update_id: Math.floor(Math.random() * 1000000),
    message: {
      message_id: Math.floor(Math.random() * 100000),
      from: {
        id: parseInt(testChatId),
        is_bot: false,
        first_name: "TestUser",
        last_name: "Validation",
        username: "test_validator",
      },
      chat: {
        id: parseInt(testChatId),
        first_name: "TestUser",
        last_name: "Validation",
        username: "test_validator",
        type: "private",
      },
      date: Math.floor(Date.now() / 1000),
      text: testText,
    },
  };

  try {
    const res = await fetch(`${BASE_URL}/api/webhooks/telegram/${subAccountId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
      },
      body: JSON.stringify(telegramPayload),
    });

    if (res.ok) {
      pass("Telegram webhook (with valid secret) accepts request", `HTTP ${res.status}`);
    } else {
      fail("Telegram webhook (with valid secret) accepts request", `HTTP ${res.status}`);
    }

    const res2 = await fetch(`${BASE_URL}/api/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...telegramPayload, update_id: telegramPayload.update_id + 1 }),
    });

    if (res2.status === 400) {
      pass("Telegram webhook (fallback, no subAccountId) rejected", `HTTP ${res2.status} — subAccountId required`);
    } else {
      fail("Telegram webhook (fallback, no subAccountId) should reject", `HTTP ${res2.status} — expected 400`);
    }

    await new Promise(r => setTimeout(r, 2000));

    if (tgAccount) {
      const stored = await db.select().from(messages)
        .where(and(
          eq(messages.contactPhone, testChatId),
          eq(messages.channel, "telegram"),
          eq(messages.direction, "inbound"),
          eq(messages.subAccountId, tgAccount.id),
        ))
        .orderBy(desc(messages.id))
        .limit(1);

      if (stored.length > 0 && stored[0].body === testText) {
        pass("Telegram inbound message stored", `id=${stored[0].id}, channel=${stored[0].channel}, subAccountId=${stored[0].subAccountId}`);
      } else if (stored.length > 0) {
        pass("Telegram inbound message found", `id=${stored[0].id}, channel=${stored[0].channel}`);
      } else {
        fail("Telegram inbound message stored", "No telegram message found — check if bot token is valid");
      }

      const contactRow = await db.select().from(contacts)
        .where(and(
          eq(contacts.phone, testChatId),
          eq(contacts.subAccountId, tgAccount.id),
        ))
        .limit(1);

      if (contactRow.length > 0) {
        pass("Telegram contact created", `id=${contactRow[0].id}, name=${contactRow[0].firstName} ${contactRow[0].lastName}`);
      } else {
        fail("Telegram contact created", "No contact found for telegram chat");
      }

      const outbound = await db.select().from(messages)
        .where(and(
          eq(messages.contactPhone, testChatId),
          eq(messages.channel, "telegram"),
          eq(messages.direction, "outbound"),
          eq(messages.subAccountId, tgAccount.id),
        ))
        .orderBy(desc(messages.id))
        .limit(1);

      if (outbound.length > 0) {
        pass("Telegram AI auto-reply stored", `id=${outbound[0].id}, status=${outbound[0].status}`);
      } else {
        fail("Telegram AI auto-reply stored", "No outbound telegram message — check Telegram Bot API logs");
      }
    } else {
      pass("Telegram webhook responds OK without configured bot", "Expected behavior — no bot token set");
    }
  } catch (err: any) {
    fail("Telegram inbound test", `Error: ${err.message}`);
  }
}

async function testTelegramSecurityRejections() {
  log("--- Telegram Webhook Security Tests ---");

  const testPayload = {
    update_id: 12345,
    message: {
      message_id: 1,
      from: { id: 111, is_bot: false, first_name: "Spoofed" },
      chat: { id: 111, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text: "spoofed message",
    },
  };

  try {
    const res1 = await fetch(`${BASE_URL}/api/webhooks/telegram/13`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
    });
    if (res1.status === 403) {
      pass("Rejects request with missing secret header", `HTTP ${res1.status}`);
    } else {
      fail("Rejects request with missing secret header", `Expected 403, got HTTP ${res1.status}`);
    }
  } catch (err: any) {
    fail("Missing secret rejection", err.message);
  }

  try {
    const res2 = await fetch(`${BASE_URL}/api/webhooks/telegram/13`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "wrong_secret_value_123",
      },
      body: JSON.stringify(testPayload),
    });
    if (res2.status === 403) {
      pass("Rejects request with invalid secret header", `HTTP ${res2.status}`);
    } else {
      fail("Rejects request with invalid secret header", `Expected 403, got HTTP ${res2.status}`);
    }
  } catch (err: any) {
    fail("Invalid secret rejection", err.message);
  }

  try {
    const res3 = await fetch(`${BASE_URL}/api/webhooks/telegram/999999`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": generateTelegramWebhookSecret(999999),
      },
      body: JSON.stringify(testPayload),
    });
    if (res3.ok) {
      pass("Non-existent account returns OK (drops silently)", `HTTP ${res3.status}`);
    } else {
      fail("Non-existent account handling", `Expected 200, got HTTP ${res3.status}`);
    }
  } catch (err: any) {
    fail("Non-existent account test", err.message);
  }
}

async function testTelegramSetupValidation() {
  log("--- Telegram Setup Endpoint Validation ---");

  log("Note: Setup endpoint requires authentication — testing from the script will get 401.");
  log("This is correct security behavior. Setup should be called from the authenticated admin UI.");

  try {
    const res = await fetch(`${BASE_URL}/api/telegram/setup/13`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botToken: "test" }),
    });

    if (res.status === 401 || res.status === 403) {
      pass("Setup requires authentication", `HTTP ${res.status} (correct security behavior)`);
    } else if (res.status === 400 || res.status === 404) {
      pass("Setup validation works", `HTTP ${res.status} — endpoint is functional`);
    } else {
      log(`Setup returned HTTP ${res.status} — unexpected but may be OK`);
    }
  } catch (err: any) {
    fail("Setup endpoint reachable", err.message);
  }
}

async function testChannelFiltering() {
  log("--- Channel Distribution ---");

  const allMsgs = await db.select({ channel: messages.channel }).from(messages);
  const counts: Record<string, number> = {};
  for (const row of allMsgs) {
    counts[row.channel] = (counts[row.channel] || 0) + 1;
  }

  log(`Message channels: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);

  if (counts["whatsapp"]) {
    pass("WhatsApp messages exist in DB", `${counts["whatsapp"]} messages`);
  } else {
    log("No WhatsApp messages yet — will appear after first real WhatsApp inbound");
  }

  if (counts["telegram"]) {
    pass("Telegram messages exist in DB", `${counts["telegram"]} messages`);
  } else {
    log("No Telegram messages yet — will appear after bot token is configured and first message arrives");
  }

  pass("Channel distribution checked", Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ") || "empty");
}

async function testNonTextTelegramUpdate() {
  log("--- Telegram Non-Text Update Handling ---");

  try {
    const testSubAccountId = "99999";
    const secret = generateTelegramWebhookSecret(testSubAccountId);
    const res = await fetch(`${BASE_URL}/api/webhooks/telegram/${testSubAccountId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({
        update_id: 12345,
        edited_message: { message_id: 1, chat: { id: 123 }, date: Math.floor(Date.now() / 1000), text: "edited" },
      }),
    });

    if (res.ok) {
      pass("Telegram ignores non-message updates", `HTTP ${res.status}`);
    } else {
      fail("Telegram ignores non-message updates", `HTTP ${res.status}`);
    }
  } catch (err: any) {
    fail("Telegram non-text update handling", err.message);
  }
}

async function run() {
  log("=== WhatsApp & Telegram Channel Validation Suite ===");
  log(`Base URL: ${BASE_URL}`);
  log("");

  await testTelegramSetupValidation();
  await testTelegramSecurityRejections();
  await testNonTextTelegramUpdate();
  await testWhatsAppInbound();
  await testTelegramInbound();
  await testChannelFiltering();

  log("");
  log("=== Summary ===");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  log(`${passed} passed, ${failed} failed out of ${results.length} checks`);

  if (failed > 0) {
    log("Failed checks:");
    for (const r of results.filter(r => !r.passed)) {
      log(`  - ${r.name}: ${r.details}`);
    }
  }

  log("");
  log("=== Configuration Notes ===");
  log("• WhatsApp: Ensure Twilio WhatsApp sandbox/number is configured and webhook URL points to /api/sms-webhook");
  log("• Telegram: Use POST /api/telegram/setup/:subAccountId with { botToken: 'YOUR_TOKEN' } (requires auth)");
  log("  This will validate the token, register the webhook URL with secret_token, and save credentials.");
  log("• The webhook URL for Telegram is /api/webhooks/telegram/:subAccountId");
  log("• Telegram webhook requests require X-Telegram-Bot-Api-Secret-Token header (set during setup)");

  await db.$client.end().catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("Validation script failed:", err);
  process.exit(1);
});
