// @ts-nocheck
export function isRepetitiveOpener(text?: string): boolean {
  if (!text || typeof text !== "string") return false;
  const s = text.trim();
  if (s.length === 0) return false;

  const patterns = [
    /^\s*(hey|hi|hello|yo|sup|hola|heyy+|hii+)[\s!,.\u2026]*$/i,
    /^\s*(babe|baby|boo|hun|love|gorgeous|sexy|cutie|hottie|sweetie|mama|papi|daddy)[\s!,.\u2026]*$/i,
    /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{So}\s]+$/u,
    /^(.)\1{3,}$/,
    /^(ha|lol|lmao|haha|hehe)+[!.\s]*$/i,
  ];

  const words = s.split(/\s+/);
  if (words.length <= 3) {
    const first = words[0]?.toLowerCase();
    if (words.every(w => w.toLowerCase() === first)) return true;
  }

  return patterns.some(re => re.test(s));
}

export function stripOpener(text: string): { stripped: string; hadOpener: boolean } {
  if (!text) return { stripped: text, hadOpener: false };

  const openerPatterns = [
    /^(hey+|hi+|hello|yo|sup)\s*[,!.\u2026]?\s*/i,
    /^(babe|baby|boo|gorgeous|sexy|love)\s*[,!.\u2026]?\s*/i,
  ];

  let result = text;
  let hadOpener = false;

  for (const pattern of openerPatterns) {
    if (pattern.test(result)) {
      const remainder = result.replace(pattern, "").trim();
      if (remainder.length > 10) {
        result = remainder;
        hadOpener = true;
        break;
      }
    }
  }

  return { stripped: result, hadOpener };
}
