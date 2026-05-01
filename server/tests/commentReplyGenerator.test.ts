import { describe, it, expect } from "vitest";
import {
  extractReplyAndSentiment,
  looksLikeJsonOrCodeFence,
  sanitizePostCaption,
} from "../services/commentBot/commentReplyGenerator";

describe("extractReplyAndSentiment", () => {
  it("parses well-formed JSON", () => {
    const out = extractReplyAndSentiment(
      `{"reply":"Aww thanks love!","sentiment":"positive"}`,
    );
    expect(out.reply).toBe("Aww thanks love!");
    expect(out.sentiment).toBe("positive");
  });

  it("strips ```json code fences before parsing", () => {
    const out = extractReplyAndSentiment(
      "```json\n{\"reply\":\"hey love\",\"sentiment\":\"neutral\"}\n```",
    );
    expect(out.reply).toBe("hey love");
    expect(out.sentiment).toBe("neutral");
  });

  it("strips bare ``` code fences", () => {
    const out = extractReplyAndSentiment(
      "```\n{\"reply\":\"hi\",\"sentiment\":\"positive\"}\n```",
    );
    expect(out.reply).toBe("hi");
  });

  it("RECOVERS reply text from truncated JSON (no closing brace) — the prod bug", () => {
    const out = extractReplyAndSentiment(
      `{"reply":"Aww thanks love! 😉 What makes u say that`,
    );
    expect(out.reply).toBe("Aww thanks love! 😉 What makes u say that");
    expect(out.reply).not.toMatch(/^\{/);
    expect(out.reply).not.toContain('"reply"');
  });

  it("RECOVERS reply from truncated ```json fenced JSON — the prod bug", () => {
    const out = extractReplyAndSentiment(
      "```json\n{\"reply\":\"Ngl, I'm kinda obsessed with this pic too love! What about it",
    );
    expect(out.reply).toBe("Ngl, I'm kinda obsessed with this pic too love! What about it");
    expect(out.reply).not.toContain('"reply"');
    expect(out.reply).not.toContain("```");
  });

  it("handles escaped quotes inside truncated reply value", () => {
    const out = extractReplyAndSentiment(
      `{"reply":"He said \\"hi\\" love and then`,
    );
    expect(out.reply).toBe(`He said "hi" love and then`);
  });

  it("falls back to raw text when there is no JSON wrapper", () => {
    const out = extractReplyAndSentiment("hey love what's up 😉");
    expect(out.reply).toBe("hey love what's up 😉");
    expect(out.sentiment).toBe("neutral");
  });

  it("returns empty reply when the model returns nothing", () => {
    const out = extractReplyAndSentiment("");
    expect(out.reply).toBe("");
  });
});

describe("looksLikeJsonOrCodeFence", () => {
  it("flags raw JSON object", () => {
    expect(looksLikeJsonOrCodeFence(`{"reply":"hi"}`)).toBe(true);
  });

  it("flags truncated JSON (the prod bug)", () => {
    expect(looksLikeJsonOrCodeFence(`{"reply":"Aww thanks love! 😉`)).toBe(true);
  });

  it("flags code fence wrapper", () => {
    expect(looksLikeJsonOrCodeFence("```json\nstuff")).toBe(true);
  });

  it("flags raw \"reply\": key in the middle", () => {
    expect(looksLikeJsonOrCodeFence(`Some text "reply": "more"`)).toBe(true);
  });

  it("does NOT flag clean human-style replies", () => {
    expect(looksLikeJsonOrCodeFence("hey love what's good")).toBe(false);
    expect(looksLikeJsonOrCodeFence("Aww thanks love! 😉")).toBe(false);
  });

  it("does NOT flag empty / whitespace", () => {
    expect(looksLikeJsonOrCodeFence("")).toBe(false);
    expect(looksLikeJsonOrCodeFence("   ")).toBe(false);
  });
});

describe("sanitizePostCaption", () => {
  it("strips 'comment X to win' giveaway CTAs", () => {
    const out = sanitizePostCaption(
      "Beautiful sunset today. Comment Jason below to win a prize!",
    );
    expect(out.toLowerCase()).not.toContain("jason");
  });

  it("strips 'reply X in the comments' CTAs", () => {
    const out = sanitizePostCaption(
      "Loving the vibes. Reply Jason in the comments to enter the giveaway!",
    );
    expect(out.toLowerCase()).not.toContain("reply jason");
  });

  it("collapses giveaway sentences into [giveaway post]", () => {
    const out = sanitizePostCaption("Big giveaway today! Don't miss out.");
    expect(out).toContain("[giveaway post]");
  });

  it("leaves normal captions alone", () => {
    const cap = "Just dropped a new pic for u all 💕";
    expect(sanitizePostCaption(cap)).toBe(cap);
  });

  it("strips lowercase 'comment jason to win' (the prod variant)", () => {
    const out = sanitizePostCaption("hey loves! comment jason to win a free vid 😘");
    expect(out.toLowerCase()).not.toContain("jason");
    expect(out.toLowerCase()).not.toContain("comment jason");
  });

  it("strips quoted name CTAs", () => {
    const out = sanitizePostCaption(`type "Jason" in the comments to win!`);
    expect(out.toLowerCase()).not.toContain("jason");
  });
});

describe("Layla path uses sanitized caption (regression for Bug 3)", () => {
  it("sanitizePostCaption strips the exact prod CTA before any prompt is built", () => {
    const giveawayCaption = "BIG GIVEAWAY today loves 💕 reply Jason in the comments to win a free 1-on-1 video!";
    const safe = sanitizePostCaption(giveawayCaption);
    expect(safe.toLowerCase()).not.toContain("reply jason");
    expect(safe.toLowerCase()).not.toContain("jason");
    expect(safe).toContain("[giveaway post]");
  });
});
