type EventName =
  | "landing_page_view"
  | "referral_captured"
  | "checkout_started"
  | "order_bump_viewed"
  | "order_bump_selected"
  | "order_bump_removed"
  | "purchase_completed"
  | "upsell_viewed"
  | "upsell_accepted"
  | "upsell_declined";

type EventPayload = Record<string, string | number | boolean | undefined>;

const providers: Array<(name: EventName, payload?: EventPayload) => void> = [];

export function registerAnalyticsProvider(
  fn: (name: EventName, payload?: EventPayload) => void,
) {
  providers.push(fn);
}

export function trackEvent(name: EventName, payload?: EventPayload) {
  const ts = new Date().toISOString();

  if (providers.length === 0) {
    console.log(`[analytics] ${ts} ${name}`, payload ?? "");
  } else {
    for (const fn of providers) {
      try {
        fn(name, payload);
      } catch (e) {
        console.error(`[analytics] provider error for ${name}:`, e);
      }
    }
  }

  if (typeof window !== "undefined" && (window as any).fbq) {
    (window as any).fbq("trackCustom", name, payload);
  }
}
