import { db } from "../../db";
import { sql } from "drizzle-orm";
import { exportTrainingPairs, type TrainingPair } from "./dataExporter";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSION = 1536;
const BATCH_SIZE = 20;

async function getOpenAIClient() {
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey: process.env.OPENAI_APEX_INT_KEY || process.env.OPENAI_API_KEY });
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = await getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.substring(0, 8000),
  });
  return response.data[0].embedding;
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const client = await getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map(t => t.substring(0, 8000)),
  });
  return response.data.map(d => d.embedding);
}

export async function indexTrainingPairs(subAccountId: number): Promise<{ indexed: number; skipped: number; errors: number }> {
  const pairs = await exportTrainingPairs(subAccountId);
  if (pairs.length === 0) {
    return { indexed: 0, skipped: 0, errors: 0 };
  }

  const existingIds = await db.execute(sql`
    SELECT message_id FROM style_embeddings WHERE sub_account_id = ${subAccountId}
  `) as any;
  const existingSet = new Set((existingIds.rows || existingIds).map((r: any) => Number(r.message_id)));

  const newPairs = pairs.filter(p => !existingSet.has(p.messageId));
  if (newPairs.length === 0) {
    console.log(`[STYLE-TRAINING] All ${pairs.length} pairs already indexed for account ${subAccountId}`);
    return { indexed: 0, skipped: pairs.length, errors: 0 };
  }

  let indexed = 0;
  let errors = 0;

  for (let i = 0; i < newPairs.length; i += BATCH_SIZE) {
    const batch = newPairs.slice(i, i + BATCH_SIZE);
    const texts = batch.map(p => `Comment: ${p.context}\nReply: ${p.reply}`);

    try {
      const embeddings = await generateEmbeddingsBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        const pair = batch[j];
        const embeddingStr = `[${embeddings[j].join(",")}]`;

        await db.execute(sql`
          INSERT INTO style_embeddings (sub_account_id, message_id, context_text, reply_text, embedding, metadata)
          VALUES (
            ${subAccountId},
            ${pair.messageId},
            ${pair.context},
            ${pair.reply},
            ${embeddingStr}::vector,
            ${JSON.stringify({ channel: pair.channel, threadId: pair.threadId, source: "training_export" })}::jsonb
          )
          ON CONFLICT DO NOTHING
        `);
        indexed++;
      }

      console.log(`[STYLE-TRAINING] Indexed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newPairs.length / BATCH_SIZE)} (${indexed} total)`);
    } catch (err: any) {
      console.error(`[STYLE-TRAINING] Batch error at offset ${i}: ${err.message}`);
      errors += batch.length;
    }
  }

  console.log(`[STYLE-TRAINING] Indexing complete for account ${subAccountId}: ${indexed} indexed, ${existingSet.size} skipped, ${errors} errors`);
  return { indexed, skipped: existingSet.size, errors };
}

export async function searchSimilarReplies(
  subAccountId: number,
  queryText: string,
  topK: number = 6,
): Promise<Array<{ context: string; reply: string; similarity: number }>> {
  const queryEmbedding = await generateEmbedding(queryText);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const result = await db.execute(sql`
    SELECT
      context_text AS context,
      reply_text AS reply,
      1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM style_embeddings
    WHERE sub_account_id = ${subAccountId}
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${topK}
  `) as any;

  return (result.rows || result).map((r: any) => ({
    context: r.context,
    reply: r.reply,
    similarity: Number(r.similarity),
  }));
}

export async function getEmbeddingCount(subAccountId: number): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM style_embeddings WHERE sub_account_id = ${subAccountId}
  `) as any;
  return Number((result.rows || result)[0]?.cnt || 0);
}
