import { textToSpeech } from "../../replit_integrations/audio/client";
import { writeFile, unlink, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const LAYLA_VOICE: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "nova";
const OUTPUT_FORMAT: "wav" | "mp3" | "flac" | "opus" | "pcm16" = "mp3";

const VOICE_SYSTEM_PROMPT = `You are Layla Woods reading a DM response aloud. 
Speak naturally like a young confident woman texting — casual, warm, slightly flirty. 
Use natural pauses, don't sound robotic. Keep the energy relaxed but engaging.
Read the text exactly as written, preserving tone and intent.`;

export interface VoiceMessageResult {
  audioBuffer: Buffer;
  format: "mp3" | "wav";
  durationEstimateMs: number;
  textUsed: string;
}

export async function generateLaylaVoiceMessage(
  text: string
): Promise<VoiceMessageResult> {
  const cleanText = text
    .replace(/💕|😉|😏|👍|🍷|✨|🔥|😍|❤️|😘|🥵|💦|👀|🙂/g, "")
    .trim();

  if (!cleanText || cleanText.length < 2) {
    throw new Error("Text too short for voice generation");
  }

  console.log(`[LAYLA-VOICE] Generating voice message (${cleanText.length} chars)`);

  const audioBuffer = await textToSpeech(cleanText, LAYLA_VOICE, OUTPUT_FORMAT);

  const wordCount = cleanText.split(/\s+/).length;
  const durationEstimateMs = Math.max(wordCount * 400, 2000);

  console.log(`[LAYLA-VOICE] Generated ${audioBuffer.length} bytes, ~${Math.round(durationEstimateMs / 1000)}s`);

  return {
    audioBuffer,
    format: "mp3",
    durationEstimateMs,
    textUsed: cleanText,
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

export function shouldSendVoiceMessage(): boolean {
  const roll = Math.random();
  return roll < 0.15;
}

export function getLaylaVoiceConfig() {
  return {
    voice: LAYLA_VOICE,
    format: OUTPUT_FORMAT,
    voiceChance: 0.15,
  };
}
