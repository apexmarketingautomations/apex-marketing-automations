import { condenseForVoice, shouldSendVoiceMessage, generateLaylaVoiceMessage } from "./server/services/personas/laylaVoice";
import { writeFile, mkdir } from "fs/promises";

async function run() {
  console.log("=== CONDENSE FOR VOICE TESTS ===\n");

  const testReplies = [
    { label: "Normal biz question", text: "That's so cool that you own a trucking company! How long have you been in business?" },
    { label: "Long multi-sentence", text: "Oh I love that for you! Running a salon is no joke, especially when you're doing everything yourself. Have you thought about getting more clients online?" },
    { label: "Has Telegram link", text: "You should definitely check me out on Telegram! https://t.me/LaylasLifeee" },
    { label: "Emoji-heavy", text: "Aww you're so sweet 💕😘 I appreciate that fr! What kind of business do you have though? 🤔" },
    { label: "Short casual", text: "Haha thanks babe! You're too sweet honestly" },
    { label: "Secret reveal", text: "Ok so most people don't know this about me but I actually run the sales team at a marketing agency. We build websites, run ads, handle social media." },
    { label: "Too short", text: "Hi!" },
    { label: "Has phone number", text: "Perfect! Just text me at 5551234567 and we can set up a time to chat." },
  ];

  for (const { label, text } of testReplies) {
    const condensed = condenseForVoice(text);
    console.log(`[${label}]`);
    console.log(`  IN:  "${text.substring(0, 90)}${text.length > 90 ? '...' : ''}"`);
    console.log(`  OUT: ${condensed ? `"${condensed}" (${condensed.split(/\s+/).length} words)` : "null (too short/empty)"}`);
    console.log();
  }

  console.log("=== SHOULD SEND VOICE — PROBABILITY TESTS (1000 trials) ===\n");

  const scenarios = [
    { msgs: 2, voices: 0, text: "That's awesome!", desc: "Too early (2 msgs)" },
    { msgs: 4, voices: 0, text: "That's awesome!", desc: "Eligible (4 msgs, 0 voice)" },
    { msgs: 6, voices: 2, text: "That's awesome!", desc: "Max voices hit (2 sent)" },
    { msgs: 5, voices: 0, text: "Check out https://t.me/Layla", desc: "Reply has link" },
    { msgs: 5, voices: 0, text: "Text me at 5551234567", desc: "Reply has phone #" },
    { msgs: 6, voices: 0, text: "What kind of business do you have?", desc: "Question @ 6 msgs" },
    { msgs: 8, voices: 1, text: "Tell me more about your salon!", desc: "Deep convo, 1 voice sent" },
  ];

  for (const s of scenarios) {
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      if (shouldSendVoiceMessage(s.msgs, s.voices, s.text)) hits++;
    }
    const pct = (hits / 10).toFixed(1);
    const blocked = hits === 0;
    console.log(`  ${s.desc.padEnd(35)} → ${blocked ? "BLOCKED ✓" : `~${pct}% (${hits}/1000)`}`);
  }

  console.log("\n=== VOICE GENERATION TEST (actual TTS) ===\n");

  await mkdir("/home/runner/workspace/.canvas/assets", { recursive: true });

  const voiceTests = [
    "That's so cool that you own a trucking company! How long have you been in business?",
    "I love that honestly, running your own thing takes guts. What's been the hardest part for you?",
    "Ok so most people don't know this about me but I actually run the sales team at a marketing agency.",
  ];

  const generatedFiles: string[] = [];

  for (let i = 0; i < voiceTests.length; i++) {
    const text = voiceTests[i];
    console.log(`\nGenerating voice ${i + 1}/${voiceTests.length}...`);
    console.log(`  Full text: "${text}"`);
    try {
      const result = await generateLaylaVoiceMessage(text);
      console.log(`  Spoken as: "${result.textUsed}"`);
      console.log(`  Audio: ${result.audioBuffer.length} bytes, ~${Math.round(result.durationEstimateMs / 1000)}s`);

      const filename = `layla-test-voice-${i + 1}.mp3`;
      const filepath = `/home/runner/workspace/.canvas/assets/${filename}`;
      await writeFile(filepath, result.audioBuffer);
      generatedFiles.push(filepath);
      console.log(`  Saved: ${filepath}`);
    } catch (err: any) {
      console.error(`  FAILED: ${err.message}`);
    }
  }

  console.log(`\n=== DONE — ${generatedFiles.length} voice files generated ===`);
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
