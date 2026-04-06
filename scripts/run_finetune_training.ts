import { z } from "zod";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const payloadSchema = z.object({
  sub_account_id: z.number().int().positive(),
  model: z.enum(["gpt-4o-mini", "together-llama-3"]).default("gpt-4o-mini"),
  epochs: z.number().int().min(1).max(10).default(3),
  suffix: z.string().default("layla-style-v1"),
});

const OPENAI_KEY = process.env.OPENAI_APEX_INT_KEY;
const TOGETHER_KEY = process.env.TOGETHER_API_KEY;

function redactPii(text: string): string {
  return text
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "[PHONE]")
    .replace(/\b\d{10,16}\b/g, "[PHONE]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[EMAIL]")
    .replace(/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[SSN]")
    .replace(/https?:\/\/\S+/g, "[URL]");
}

function moderateContent(text: string): boolean {
  const lowerText = text.toLowerCase();
  const hardBlockPatterns = [
    /\bchild\b.*\b(sex|nude|naked)\b/,
    /\b(sex|nude|naked)\b.*\bchild\b/,
    /\bminor\b.*\b(sex|nude|naked)\b/,
    /\bunder\s?age\b/,
  ];
  for (const pat of hardBlockPatterns) {
    if (pat.test(lowerText)) return false;
  }
  return true;
}

function sanitizePair(context: string, reply: string): { context: string; reply: string } | null {
  const c = redactPii(context.trim());
  const r = redactPii(reply.trim());
  if (c.length < 3 || r.length < 5) return null;
  if (!moderateContent(c) || !moderateContent(r)) return null;
  return { context: c, reply: r };
}

async function uploadToOpenAI(filePath: string): Promise<string> {
  if (!OPENAI_KEY) throw new Error("OPENAI_APEX_INT_KEY not set");

  const fileBuffer = fs.readFileSync(filePath);
  const boundary = "----FormBoundary" + Date.now();

  let body = "";
  body += "--" + boundary + "\r\n";
  body += 'Content-Disposition: form-data; name="purpose"\r\n\r\n';
  body += "fine-tune\r\n";
  body += "--" + boundary + "\r\n";
  body += 'Content-Disposition: form-data; name="file"; filename="training.jsonl"\r\n';
  body += "Content-Type: application/jsonl\r\n\r\n";

  const prefix = Buffer.from(body, "utf8");
  const suffix = Buffer.from("\r\n--" + boundary + "--\r\n", "utf8");
  const fullBody = Buffer.concat([prefix, fileBuffer, suffix]);

  const resp = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPENAI_KEY,
      "Content-Type": "multipart/form-data; boundary=" + boundary,
    },
    body: fullBody,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("File upload failed: " + resp.status + " " + errText);
  }

  const result = (await resp.json()) as { id: string; bytes: number };
  console.log("[TRAIN] File uploaded:", result.id, "(" + result.bytes + " bytes)");
  return result.id;
}

async function createOpenAIFineTune(fileId: string, model: string, suffix: string, epochs: number): Promise<{ jobId: string; status: string }> {
  if (!OPENAI_KEY) throw new Error("OPENAI_APEX_INT_KEY not set");

  const resp = await fetch("https://api.openai.com/v1/fine_tuning/jobs", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPENAI_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      training_file: fileId,
      model: model + "-2024-07-18",
      suffix,
      hyperparameters: { n_epochs: epochs },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Fine-tune creation failed: " + resp.status + " " + errText);
  }

  const result = (await resp.json()) as { id: string; status: string; model: string };
  return { jobId: result.id, status: result.status };
}

async function main() {
  const rawPayload = process.env.AGENT_JOB_PAYLOAD;
  if (!rawPayload) throw new Error("AGENT_JOB_PAYLOAD not set");

  const payload = payloadSchema.parse(JSON.parse(rawPayload));
  const ticketId = "FT-" + payload.sub_account_id + "-" + Date.now();

  console.log("[TRAIN] Starting fine-tune pipeline");
  console.log("[TRAIN] Ticket:", ticketId);
  console.log("[TRAIN] Sub-account:", payload.sub_account_id);
  console.log("[TRAIN] Model:", payload.model);
  console.log("[TRAIN] Epochs:", payload.epochs);

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const pairsRes = await pool.query(`
    SELECT m1.id AS message_id, m1.thread_id, m1.channel, m1.body AS inbound,
      (SELECT m2.body FROM messages m2 WHERE m2.sub_account_id = $1 AND m2.thread_id = m1.thread_id AND m2.direction = 'outbound' AND m2.status = 'delivered' AND m2.created_at > m1.created_at AND m2.body NOT LIKE 'https://%' AND m2.body NOT LIKE '[voice memo]%' AND LENGTH(m2.body) > 3 ORDER BY m2.created_at ASC LIMIT 1) AS reply
    FROM messages m1
    WHERE m1.sub_account_id = $1 AND m1.direction = 'inbound' AND m1.channel IN ('facebook', 'instagram') AND LENGTH(m1.body) > 2
    ORDER BY m1.created_at DESC
  `, [payload.sub_account_id]);

  const jsonlLines: string[] = [];
  let filtered = 0;

  for (const row of pairsRes.rows) {
    if (!row.reply) continue;
    const sanitized = sanitizePair(row.inbound, row.reply);
    if (!sanitized) {
      filtered++;
      continue;
    }
    jsonlLines.push(JSON.stringify({
      messages: [
        { role: "user", content: sanitized.context },
        { role: "assistant", content: sanitized.reply },
      ],
    }));
  }

  console.log("[TRAIN] Pairs extracted:", jsonlLines.length);
  console.log("[TRAIN] Pairs filtered by moderation:", filtered);

  if (jsonlLines.length < 10) {
    throw new Error("Insufficient training pairs after filtering: " + jsonlLines.length);
  }

  const trainPath = `/tmp/finetune_${ticketId}.jsonl`;
  fs.writeFileSync(trainPath, jsonlLines.join("\n"));
  console.log("[TRAIN] Training file:", trainPath);

  if (payload.model === "gpt-4o-mini") {
    if (!OPENAI_KEY) throw new Error("OPENAI_APEX_INT_KEY not set — cannot fine-tune on OpenAI");

    const fileId = await uploadToOpenAI(trainPath);
    const { jobId, status } = await createOpenAIFineTune(fileId, "gpt-4o-mini", payload.suffix, payload.epochs);

    console.log("[TRAIN] Fine-tune job created:", jobId);
    console.log("[TRAIN] Status:", status);

    await pool.query(
      "INSERT INTO system_logs (severity, module, message, metadata) VALUES ($1, $2, $3, $4)",
      [
        "info",
        "fine_tuning",
        "Fine-tune job submitted via agent worker: " + jobId,
        JSON.stringify({ ticketId, jobId, model: payload.model, pairs: jsonlLines.length, filtered, suffix: payload.suffix, epochs: payload.epochs }),
      ]
    );

    const resultPath = `/tmp/finetune_result_${ticketId}.json`;
    fs.writeFileSync(resultPath, JSON.stringify({ ticketId, jobId, status, model: payload.model, pairs: jsonlLines.length, filtered, trainPath, fileId }, null, 2));
    console.log("[TRAIN] Result saved:", resultPath);

  } else if (payload.model === "together-llama-3") {
    if (!TOGETHER_KEY) throw new Error("TOGETHER_API_KEY not set — cannot fine-tune on Together.ai");
    console.log("[TRAIN] Together.ai fine-tuning not yet implemented — data exported to:", trainPath);
  }

  await pool.end();
  console.log("[TRAIN] Pipeline complete");
}

main().catch((e) => {
  console.error("[TRAIN] FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
