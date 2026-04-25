import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import OpenAI from "openai";

const LAYLA_VOICE: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "nova";
const OUTPUT_FORMAT = "mp3";

const MAX_VOICE_WORDS = 20;

const VOICE_PERSONA = `You are recording a quick casual voice memo as a confident young woman in her late 20s. 
You speak naturally — relaxed, warm, a little playful. You're NOT reading text aloud. 
You're talking into your phone like you're sending a quick voice note to someone you've been chatting with.
Use natural speech patterns: slight pauses, casual phrasing, the way someone actually talks not writes.
Keep it under 15 words ideally. Sound like a real person, not a voice assistant.
Never say "um" or "uh" — you're confident, not hesitant. But keep it loose and natural.`;

const VOICE_NOTE_STARTERS = [
  "hey",
  "ok so",
  "honestly",
  "real talk",
  "so basically",
  "listen",
  "ok wait",
  "yo",
  "alright so",
];

export interface VoiceMessageResult {
  audioBuffer: Buffer;
  format: "mp3" | "wav";
  durationEstimateMs: number;
  textUsed: string;
}

export function condenseForVoice(fullReply: string): string | null {
  let text = fullReply
    .replace(/💕|😉|😏|👍|🍷|✨|🔥|😍|❤️|😘|🥵|💦|👀|🙂|😂|🤣|😭|💀|🫶|🤷‍♀️|💅|👏|🎉|❤️‍🔥|💜|🤍|💗|🖤/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/t\.me\/\S+/gi, "")
    .replace(/\n+/g, " ")
    .trim();

  if (!text || text.length < 8) return null;

  const sentences = text.split(/(?<=[.!?])\s+/);
  let core = sentences[0] || text;

  if (core.split(/\s+/).length > MAX_VOICE_WORDS) {
    core = core.split(/\s+/).slice(0, MAX_VOICE_WORDS).join(" ");
  }

  core = core.replace(/\.$/, "").trim();

  if (core.length < 8 || core.split(/\s+/).length < 3) return null;

  return core;
}

function makeSpokenVersion(writtenText: string): string {
  let spoken = writtenText;

  spoken = spoken
    .replace(/\bI am\b/gi, "I'm")
    .replace(/\bdo not\b/gi, "don't")
    .replace(/\bcannot\b/gi, "can't")
    .replace(/\bwill not\b/gi, "won't")
    .replace(/\bit is\b/gi, "it's")
    .replace(/\bthat is\b/gi, "that's")
    .replace(/\bwhat is\b/gi, "what's")
    .replace(/\byou are\b/gi, "you're")
    .replace(/\bthey are\b/gi, "they're")
    .replace(/\bwe are\b/gi, "we're")
    .replace(/\blet us\b/gi, "let's")
    .replace(/\bgoing to\b/gi, "gonna")
    .replace(/\bwant to\b/gi, "wanna")
    .replace(/\bgot to\b/gi, "gotta")
    .replace(/\bkind of\b/gi, "kinda")
    .replace(/\bsort of\b/gi, "sorta");

  const lower = spoken.toLowerCase();
  const hasStarter = VOICE_NOTE_STARTERS.some(s => lower.startsWith(s));
  if (!hasStarter) {
    const starter = VOICE_NOTE_STARTERS[Math.floor(Math.random() * VOICE_NOTE_STARTERS.length)];
    spoken = `${starter}, ${spoken.charAt(0).toLowerCase()}${spoken.slice(1)}`;
  }

  spoken = spoken.replace(/[.]+$/, "");

  return spoken;
}

export async function generateLaylaVoiceMessage(
  text: string
): Promise<VoiceMessageResult> {
  const core = condenseForVoice(text);
  if (!core) {
    throw new Error("Text too short or empty after condensing for voice");
  }

  const spoken = makeSpokenVersion(core);

  console.log(`[LAYLA-VOICE] Generating natural memo: "${spoken}" (from: "${core}")`);

  const openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice: LAYLA_VOICE, format: OUTPUT_FORMAT },
    messages: [
      { role: "system", content: VOICE_PERSONA },
      { role: "user", content: `Record this as a quick voice memo to someone you're chatting with in DMs. Say it naturally like you're talking, not reading: "${spoken}"` },
    ],
  });

  const audioData = (response.choices[0]?.message as any)?.audio?.data ?? "";
  if (!audioData) {
    throw new Error("No audio data returned from TTS");
  }
  const audioBuffer = Buffer.from(audioData, "base64");

  const wordCount = spoken.split(/\s+/).length;
  const durationEstimateMs = Math.max(wordCount * 380, 1500);

  console.log(`[LAYLA-VOICE] Generated ${audioBuffer.length} bytes, ~${Math.round(durationEstimateMs / 1000)}s, words=${wordCount}`);

  return {
    audioBuffer,
    format: "mp3",
    durationEstimateMs,
    textUsed: spoken,
  };
}

export async function saveVoiceMessageToTemp(
  result: VoiceMessageResult
): Promise<string> {
  const filename = `layla-voice-${randomUUID()}.${result.format}`;
  const filepath = join(tmpdir(), filename);
  await writeFile(filepath, result.audioBuffer);
  console.log(`[LAYLA-VOICE] Saved to ${filepath}`);
  return filepath;
}

export async function cleanupVoiceFile(filepath: string): Promise<void> {
  try {
    await unlink(filepath);
  } catch (err) { console.warn("[LAYLAVOICE] caught:", err instanceof Error ? err.message : err); }
}

export function shouldSendVoiceMessage(
  messageCount: number,
  voicesSentThisThread: number,
  lastMessageText?: string
): boolean {
  return false;
}

export function getLaylaVoiceConfig() {
  return {
    voice: LAYLA_VOICE,
    format: OUTPUT_FORMAT,
    voiceChance: "10% base, 18% on questions after 5+ msgs",
    maxPerThread: 2,
    maxWords: MAX_VOICE_WORDS,
    minMessages: 4,
    blockedContent: ["links", "phone numbers", "telegram links"],
  };
}
