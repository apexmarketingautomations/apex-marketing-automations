import Stripe from "stripe";

let connectionSettings: any;
let _stripeConnectionVerified = false;

export function isStripeConnectionVerified(): boolean {
  return _stripeConnectionVerified;
}

export function invalidateStripeConnectionStatus(): void {
  _stripeConnectionVerified = false;
}

function isStripeAuthError(error: any): boolean {
  if (error?.type === "StripeAuthenticationError") return true;
  if (error?.statusCode === 401) return true;
  if (error?.code === "authentication_error") return true;
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("invalid api key") || msg.includes("authentication"))
    return true;
  return false;
}

function getEnvStripePublishableKey() {
  return (
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY_TEST ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY ||
    process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY_DEVELOPMENT ||
    process.env.STRIPE_PUBLISHABLE_KEY_PRODUCTION
  );
}

function getEnvStripeSecretKey() {
  return (
    process.env.STRIPE_API_SECRET ||
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET_KEY_TEST ||
    process.env.STRIPE_SECRET_KEY_DEVELOPMENT ||
    process.env.STRIPE_SECRET_KEY_PRODUCTION
  );
}

async function getCredentials() {
  const publishableKey = getEnvStripePublishableKey();
  const secretKey = getEnvStripeSecretKey();

  if (secretKey) {
    _stripeConnectionVerified = true;
    return { publishableKey, secretKey };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (hostname && xReplitToken) {
    const connectorName = "stripe";
    const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
    const targetEnvironment = isProduction ? "production" : "development";

    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set("include_secrets", "true");
    url.searchParams.set("connector_names", connectorName);
    url.searchParams.set("environment", targetEnvironment);

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: xReplitToken,
      },
    });

    const data = await response.json();
    connectionSettings = data.items?.[0];

    if (
      connectionSettings?.settings?.publishable &&
      connectionSettings?.settings?.secret
    ) {
      _stripeConnectionVerified = true;
      return {
        publishableKey: connectionSettings.settings.publishable,
        secretKey: connectionSettings.settings.secret,
      };
    }
  }

  throw new Error(
    "Stripe secret key not configured. Add STRIPE_API_SECRET (or connect Stripe in Replit Connections).",
  );
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, {
    apiVersion: "2025-08-27.basil" as any,
  });
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();

  if (!publishableKey) {
    throw new Error(
      "Stripe publishable key not configured. Add STRIPE_PUBLISHABLE_KEY (or connect Stripe in Replit Connections).",
    );
  }

  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

export function getStripeWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET;
}

export function handleStripeError(error: any): void {
  if (isStripeAuthError(error)) {
    _stripeConnectionVerified = false;
  }
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import("stripe-replit-sync");
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }

  return stripeSync;
}
