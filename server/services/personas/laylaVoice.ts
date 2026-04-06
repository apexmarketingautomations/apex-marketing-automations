import { textToSpeech } from "../../replit_integrations/audio/client";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const LAYLA_VOICE: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "nova";
const OUTPUT_FORMAT: "wav" | "mp3" | "flac" | "opus" | "pcm16" = "mp3";

const MAX_VOICE_WORDS = 25;
const MAX_VOICE_CHARS = 140;

export interface VoiceMessageResult {
  audioBuffer: Buffer;
  format: "mp3" | "wav";
  durationEstimateMs: number;
  textUsed: string;
}

export function condenseForVoice(fullReply: string): string | null {
  let text = fullReply
    .replace(/💕|😉|😏|👍|🍷|✨|🔥|😍|❤️|😘|🥵|💦|👀|🙂|😂|🤣|😭|💀|🫶|🤷‍♀️|💅|👏|🎉|❤️‍🔥/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\n+/g, " ")
    .trim();

  if (!text || text.length < 5) return null;

  const sentences = text.split(/(?<=[.!?])\s+/);
  let memo = sentences[0] || text;

  if (memo.split(/\s+/).length > MAX_VOICE_WORDS) {
    memo = memo.split(/\s+/).slice(0, MAX_VOICE_WORDS).join(" ");
    if (!/[.!?]$/.test(memo)) memo += ".";
  }

  if (memo.length > MAX_VOICE_CHARS) {
    memo = memo.substring(0, MAX_VOICE_CHARS).replace(/\s+\S*$/, "");
    if (!/[.!?]$/.test(memo)) memo += ".";
  }

  if (memo.length < 5) return null;

  return memo;
}

export async function generateLaylaVoiceMessage(
  text: string
): Promise<VoiceMessageResult> {
  const memo = condenseForVoice(text);
  if (!memo) {
    throw new Error("Text too short or empty after condensing for voice");
  }

  console.log(`[LAYLA-VOICE] Generating short memo (${memo.length} chars, ${memo.split(/\s+/).length} words): "${memo}"`);

  const audioBuffer = await textToSpeech(memo, LAYLA_VOICE, OUTPUT_FORMAT);

  const wordCount = memo.split(/\s+/).length;
  const durationEstimateMs = Math.max(wordCount * 400, 1500);

  console.log(`[LAYLA-VOICE] Generated ${audioBuffer.length} bytes, ~${Math.round(durationEstimateMs / 1000)}s`);

  return {
    audioBuffer,
    format: "mp3",
    durationEstimateMs,
    textUsed: memo,
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
  } catch {}
}

export function shouldSendVoiceMessage(
  messageCount: number,
  voicesSentThisThread: number
): boolean {
  if (voicesSentThisThread >= 2) return false;

  if (messageCount < 3) return false;

  const roll = Math.random();
  return roll < 0.12;
}

export function getLaylaVoiceConfig() {
  return {
    voice: LAYLA_VOICE,
    format: OUTPUT_FORMAT,
    voiceChance: 0.12,
    maxPerThread: 2,
    maxWords: MAX_VOICE_WORDS,
  };
}
