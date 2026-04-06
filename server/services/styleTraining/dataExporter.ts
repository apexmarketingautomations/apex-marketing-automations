import { db } from "../../db";
import { sql } from "drizzle-orm";

const PII_PATTERNS = [
  { regex: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE]" },
  { regex: /\b\d{10,15}\b/g, replacement: "[PHONE]" },
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: "[EMAIL]" },
  { regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, replacement: "[SSN]" },
  { regex: /\b\d{1,5}\s+[\w\s]+(?:st|street|ave|avenue|blvd|boulevard|dr|drive|ln|lane|rd|road|ct|court|way|pl|place)\b/gi, replacement: "[ADDRESS]" },
];

export function redactPii(text: string): string {
  let result = text;
  for (const { regex, replacement } of PII_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

export interface TrainingPair {
  messageId: number;
  threadId: string | null;
  channel: string;
  context: string;
  reply: string;
  createdAt: Date;
}

export async function exportTrainingPairs(subAccountId: number): Promise<TrainingPair[]> {
  const result = await db.execute(sql`
    SELECT
      m1.id AS message_id,
      m1.thread_id,
      m1.channel,
      m1.body AS inbound_body,
      m1.created_at AS inbound_time,
      (
        SELECT m2.body
        FROM messages m2
        WHERE m2.sub_account_id = ${subAccountId}
          AND m2.thread_id = m1.thread_id
          AND m2.direction = 'outbound'
          AND m2.status = 'delivered'
          AND m2.created_at > m1.created_at
          AND m2.body NOT LIKE 'https://%'
          AND m2.body NOT LIKE '[voice memo]%'
          AND LENGTH(m2.body) > 3
        ORDER BY m2.created_at ASC
        LIMIT 1
      ) AS reply_body,
      (
        SELECT m2.created_at
        FROM messages m2
        WHERE m2.sub_account_id = ${subAccountId}
          AND m2.thread_id = m1.thread_id
          AND m2.direction = 'outbound'
          AND m2.status = 'delivered'
          AND m2.created_at > m1.created_at
          AND m2.body NOT LIKE 'https://%'
          AND m2.body NOT LIKE '[voice memo]%'
          AND LENGTH(m2.body) > 3
        ORDER BY m2.created_at ASC
        LIMIT 1
      ) AS reply_time
    FROM messages m1
    WHERE m1.sub_account_id = ${subAccountId}
      AND m1.direction = 'inbound'
      AND m1.channel IN ('facebook', 'instagram')
      AND LENGTH(m1.body) > 2
    ORDER BY m1.created_at DESC
  `) as any;

  const rows = result.rows || result;
  const pairs: TrainingPair[] = [];

  for (const row of rows) {
    if (!row.reply_body) continue;

    const context = redactPii(row.inbound_body.trim());
    const reply = redactPii(row.reply_body.trim());

    if (context.length < 3 || reply.length < 5) continue;

    pairs.push({
      messageId: Number(row.message_id),
      threadId: row.thread_id || null,
      channel: row.channel,
      context,
      reply,
      createdAt: new Date(row.inbound_time),
    });
  }

  console.log(`[STYLE-TRAINING] Exported ${pairs.length} clean context-reply pairs for account ${subAccountId}`);
  return pairs;
}
