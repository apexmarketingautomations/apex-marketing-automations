/**
 * server/ai/aiStructuredOutput.ts
 *
 * Schema-safe, JSON-validated, confidence-scored structured output parsing
 * for the Apex AI Orchestration Layer.
 *
 * Features:
 *  - Strips markdown fences, leading prose, trailing comments
 *  - Zod-style validator support (pass any (data: unknown) => data is T function)
 *  - Auto-retry with schema reminder if parse or validation fails
 *  - Confidence scoring via optional model-returned field
 *  - Never throws — always returns StructuredOutputResult<T>
 *
 * Usage:
 *   const result = await parseStructuredOutput<MyType>(rawText, isMyType, retryFn);
 *   if (result.valid) { use(result.data!) }
 *   else              { fallback or log result.parseError }
 */

import type { StructuredOutputResult } from "./types";

// ── JSON extraction ───────────────────────────────────────────────────────────

/**
 * Strip common LLM response wrappers and extract raw JSON.
 * Handles:
 *  - ```json ... ``` fences
 *  - ``` ... ``` fences (no lang tag)
 *  - Leading prose before first `{` or `[`
 *  - Trailing text after last `}` or `]`
 *  - BOM characters
 */
export function extractJSON(raw: string): string {
  // Remove BOM
  let text = raw.replace(/^﻿/, "").trim();

  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Find first `{` or `[`
  const jsonStart = text.search(/[{[]/);
  if (jsonStart === -1) return text; // no JSON found — return as-is for error handling

  // Find last `}` or `]` (match opening char)
  const firstChar = text[jsonStart];
  const closeChar = firstChar === "{" ? "}" : "]";
  const jsonEnd   = text.lastIndexOf(closeChar);

  if (jsonEnd === -1 || jsonEnd < jsonStart) return text;

  return text.slice(jsonStart, jsonEnd + 1);
}

// ── Confidence extraction ─────────────────────────────────────────────────────

/**
 * If the parsed object has a `confidence` or `_confidence` field (0–1 or 0–100),
 * extract and normalize it.
 */
function extractConfidence(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const d = data as Record<string, unknown>;
  const raw = d["confidence"] ?? d["_confidence"] ?? d["score"] ?? d["_score"];
  if (typeof raw !== "number") return undefined;
  // Normalize to 0–1
  return raw > 1 ? raw / 100 : raw;
}

// ── Schema reminder builder ───────────────────────────────────────────────────

/**
 * Build a schema reminder message to prepend on retry.
 * Shows the shape of the expected output.
 */
function buildSchemaReminder(schemaHint?: string): string {
  const base = "Your previous response was not valid JSON or did not match the required schema.";
  if (schemaHint) {
    return `${base}\n\nExpected JSON schema:\n${schemaHint}\n\nRespond with ONLY valid JSON. No prose, no markdown fences.`;
  }
  return `${base}\n\nRespond with ONLY valid JSON. No markdown, no explanation.`;
}

// ── Core parser ───────────────────────────────────────────────────────────────

export type Validator<T> = (data: unknown) => data is T;

/**
 * Parse structured output from a model response, with optional retries.
 *
 * @param rawText   - The model's raw text response
 * @param validate  - Type guard that returns true if data matches T
 * @param retryFn   - Optional: called with a schema reminder prompt to get a corrected response.
 *                   Receives the error text; returns the new raw response string.
 * @param maxRetries - How many retries to attempt (default: 1)
 * @param schemaHint - Human-readable schema description for the retry prompt
 */
export async function parseStructuredOutput<T>(
  rawText: string,
  validate: Validator<T>,
  retryFn?: (errorPrompt: string) => Promise<string>,
  maxRetries = 1,
  schemaHint?: string,
): Promise<StructuredOutputResult<T>> {
  let attempts = 0;
  let currentText = rawText;

  while (attempts <= maxRetries) {
    attempts++;

    // Extract and parse
    const extracted = extractJSON(currentText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted);
    } catch (err: any) {
      const parseError = `JSON parse failed (attempt ${attempts}): ${err?.message}`;
      if (retryFn && attempts <= maxRetries) {
        currentText = await retry(retryFn, currentText, parseError, schemaHint);
        continue;
      }
      return {
        data:       null,
        valid:      false,
        rawText:    rawText,
        attempts,
        parseError: `${parseError} | raw: ${extracted.slice(0, 200)}`,
      };
    }

    // Validate
    if (validate(parsed)) {
      return {
        data:       parsed,
        valid:      true,
        rawText,
        attempts,
        confidence: extractConfidence(parsed),
      };
    }

    const validateError = `Schema validation failed (attempt ${attempts})`;
    if (retryFn && attempts <= maxRetries) {
      currentText = await retry(retryFn, currentText, validateError, schemaHint);
      continue;
    }

    return {
      data:       null,
      valid:      false,
      rawText,
      attempts,
      parseError: validateError,
    };
  }

  // Should not be reached
  return { data: null, valid: false, rawText, attempts, parseError: "Max retries exceeded" };
}

async function retry(
  retryFn: (prompt: string) => Promise<string>,
  previousText: string,
  errorMessage: string,
  schemaHint?: string,
): Promise<string> {
  try {
    const reminder = buildSchemaReminder(schemaHint);
    const prompt = `${reminder}\n\nYour previous response:\n${previousText.slice(0, 500)}\n\nError: ${errorMessage}`;
    return await retryFn(prompt);
  } catch { // allow-silent-catch: retry fetch failed — return original so outer loop gives up
    return previousText;
  }
}

// ── Common validators ─────────────────────────────────────────────────────────

/** Validate that data is a non-null object (loose structural check). */
export function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

/** Validate that data is a non-empty array. */
export function isNonEmptyArray(data: unknown): data is unknown[] {
  return Array.isArray(data) && data.length > 0;
}

/** Validate that data is an array (may be empty). */
export function isArray(data: unknown): data is unknown[] {
  return Array.isArray(data);
}

/** Build a validator that checks for required keys on an object. */
export function requiresKeys<T extends Record<string, unknown>>(
  keys: (keyof T)[],
): Validator<T> {
  return (data: unknown): data is T => {
    if (!isObject(data)) return false;
    return keys.every(k => k in data);
  };
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Synchronous parse (no retry). Returns null on failure.
 * Use when you have a raw model response and just need the JSON.
 */
export function parseJSON<T = unknown>(rawText: string): T | null {
  try {
    return JSON.parse(extractJSON(rawText)) as T;
  } catch { // allow-silent-catch: invalid JSON from model — caller handles null return
    return null;
  }
}

/**
 * Parse an array of typed objects from model output.
 * Returns empty array on failure rather than throwing.
 */
export function parseJSONArray<T>(
  rawText: string,
  itemValidator: Validator<T>,
): T[] {
  const parsed = parseJSON<unknown[]>(rawText);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(item => itemValidator(item)) as T[];
}
