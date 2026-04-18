// Runtime guard for Layla outputs.
// Imports identity rules + safety strings from laylaCore so the prompt
// (what we tell the LLM) and the runtime guard (what we actually enforce)
// can NEVER drift. If you change a rule, change it in laylaCore.ts only.
import {
  LAYLA_PROHIBITED_WORDS_REGEX,
  LAYLA_HANDOVER_FALLBACK,
} from "./laylaCore";

export interface PostProcessResult {
  action: "send" | "handover" | "modified";
  reply: string;
  reason?: string;
  modified?: boolean;
}

export interface LaylaOperatorConfig {
  telegram?: {
    link: string;
    allowed: boolean;
  };
  handover?: {
    fallback_message: string;
    escalate_keywords: string[];
  };
  prohibited_words?: string[];
}

const TOKEN_LIKE_REGEX = /[A-Za-z0-9\-_]{20,}/g;
const SSN_REGEX = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const CC_REGEX = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_REGEX = /\b(\+?1?\s?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/g;

const ALLOWED_LINK = "t.me/LaylasLifeee";

export function postProcessAndGuard(
  text: string,
  operatorConfig: LaylaOperatorConfig
): PostProcessResult {
  if (LAYLA_PROHIBITED_WORDS_REGEX.test(text)) {
    console.log(`[LAYLA-PP] Forbidden word detected in output, triggering handover`);
    return {
      action: "handover",
      reply: operatorConfig.handover?.fallback_message || LAYLA_HANDOVER_FALLBACK,
      reason: "forbidden_word_detected",
    };
  }

  let processed = text;
  let modified = false;

  if (processed.includes(ALLOWED_LINK)) {
    if (!operatorConfig.telegram?.allowed) {
      console.log(`[LAYLA-PP] Unauthorized telegram link attempt`);
      return {
        action: "handover",
        reply: operatorConfig.handover?.fallback_message || HANDOVER_FALLBACK,
        reason: "unauthorized_link_attempt",
      };
    }
    const linkPlaceholder = "%%TELEGRAM_LINK%%";
    processed = processed.replace(ALLOWED_LINK, linkPlaceholder);

    processed = processed.replace(TOKEN_LIKE_REGEX, "[redacted]");

    processed = processed.replace(linkPlaceholder, ALLOWED_LINK);
  } else {
    processed = processed.replace(TOKEN_LIKE_REGEX, "[redacted]");
  }

  if (processed !== text) modified = true;

  processed = processed.replace(SSN_REGEX, "[redacted-PII]");
  processed = processed.replace(CC_REGEX, "[redacted-PII]");

  const paragraphs = processed.split(/\n\n+/);
  if (paragraphs.length > 3) {
    processed = paragraphs.slice(0, 3).join("\n\n");
    modified = true;
  }

  processed = processed.trim();

  return {
    action: modified ? "modified" : "send",
    reply: processed,
    modified,
  };
}

export function checkEscalationKeywords(
  message: string,
  keywords: string[]
): boolean {
  const lower = message.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export function maskPiiForLogs(text: string): string {
  return text
    .replace(SSN_REGEX, "[SSN]")
    .replace(CC_REGEX, "[CC]")
    .replace(EMAIL_REGEX, "[EMAIL]")
    .replace(PHONE_REGEX, "[PHONE]");
}
