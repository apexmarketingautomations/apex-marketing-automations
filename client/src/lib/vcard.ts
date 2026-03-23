interface VCardInput {
  name?: string;
  preferredName?: string;
  title?: string;
  company?: string;
  phone?: string;
  email?: string;
  website?: string;
  bookingUrl?: string;
  calendarUrl?: string;
  location?: string;
  bio?: string;
  tagline?: string;
  photoUrl?: string;
  logoImageUrl?: string;
  socialLinks?: { label?: string; url?: string }[];
  slug?: string;
}

function sanitize(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

function sanitizeUrl(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

function isValidUrl(value: string): boolean {
  return /^https?:\/\/.+/i.test(value);
}

function ensureHttps(value: string): string {
  const clean = sanitizeUrl(value);
  return clean.startsWith("http") ? clean : `https://${clean}`;
}

function splitName(fullName: string): { last: string; first: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { last: parts[0], first: "" };
  const last = parts.pop() || "";
  return { last, first: parts.join(" ") };
}

export function generateVCard(card: VCardInput): string {
  const displayName = (card.preferredName || card.name || "Contact").trim();
  const fullName = (card.name || displayName).trim();
  const { last, first } = splitName(fullName);

  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${sanitize(displayName)}`,
    `N:${sanitize(last)};${sanitize(first)};;;`,
  ];

  if (card.title) lines.push(`TITLE:${sanitize(card.title)}`);
  if (card.company) lines.push(`ORG:${sanitize(card.company)}`);
  if (card.phone) lines.push(`TEL;TYPE=CELL:${card.phone.replace(/[^\d+()-\s]/g, "")}`);
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${sanitizeUrl(card.email)}`);

  if (card.website) {
    lines.push(`URL:${ensureHttps(card.website)}`);
  }

  if (card.bookingUrl) {
    lines.push(`URL:${ensureHttps(card.bookingUrl)}`);
  }

  if (card.location) {
    lines.push(`ADR;TYPE=WORK:;;${sanitize(card.location)};;;;`);
  }

  if (card.photoUrl && isValidUrl(card.photoUrl)) {
    lines.push(`PHOTO;VALUE=URI:${sanitizeUrl(card.photoUrl)}`);
  }

  if (card.logoImageUrl && isValidUrl(card.logoImageUrl)) {
    lines.push(`LOGO;VALUE=URI:${sanitizeUrl(card.logoImageUrl)}`);
  }

  const noteLines: string[] = [];
  if (card.bio) noteLines.push(sanitize(card.bio));
  else if (card.tagline) noteLines.push(sanitize(card.tagline));

  const socials = (card.socialLinks || []).filter(
    (s): s is { label: string; url: string } =>
      !!s && typeof s.url === "string" && s.url.length > 0
  );
  if (socials.length > 0) {
    noteLines.push("");
    noteLines.push("Social:");
    socials.forEach(s => {
      const label = sanitize(String(s.label || "Link"));
      const url = sanitizeUrl(s.url);
      noteLines.push(`${label}: ${url}`);
    });
  }

  if (noteLines.length > 0) {
    lines.push(`NOTE:${noteLines.join("\\n")}`);
  }

  if (card.slug) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    lines.push(`URL:${origin}/card/${sanitizeUrl(card.slug)}`);
  }

  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function downloadVCard(card: VCardInput): void {
  const vcardString = generateVCard(card);
  const blob = new Blob([vcardString], { type: "text/vcard;charset=utf-8" });
  const slug = (card.slug || card.name || "contact").replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  const filename = `${slug}.vcf`;

  if (typeof navigator !== "undefined" && navigator.share && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    const file = new File([blob], filename, { type: "text/vcard" });
    navigator.share({ files: [file] }).catch(() => {
      triggerDownload(blob, filename);
    });
    return;
  }

  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
