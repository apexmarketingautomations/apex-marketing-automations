import { storage } from "./storage";

export interface WebhookDispatchResult {
  success: boolean;
  statusCode: number | null;
  latencyMs: number;
  responseBody: string | null;
  errorMessage: string | null;
}

export async function dispatchWebhook(
  webhookId: number,
  subAccountId: number,
  targetUrl: string,
  eventType: string,
  payload: Record<string, any>,
  secret?: string | null
): Promise<WebhookDispatchResult> {
  const startTime = Date.now();

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) headers["X-Webhook-Secret"] = secret;

    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const latencyMs = Date.now() - startTime;
    let responseBody = "";
    try { responseBody = (await response.text()).substring(0, 500); } catch {}

    const isSuccess = response.status >= 200 && response.status < 300;

    await storage.createWebhookDeliveryLog({
      webhookId,
      subAccountId,
      targetUrl,
      eventType,
      statusCode: response.status,
      responseBody,
      latencyMs,
      success: isSuccess,
    });

    if (isSuccess) {
      await storage.updateWebhook(webhookId, { lastTriggeredAt: new Date() });
    } else {
      const webhook = await storage.getWebhookById(webhookId);
      if (webhook) {
        await storage.updateWebhook(webhookId, { failCount: (webhook.failCount || 0) + 1 });
      }
    }

    return { success: isSuccess, statusCode: response.status, latencyMs, responseBody, errorMessage: null };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;

    await storage.createWebhookDeliveryLog({
      webhookId,
      subAccountId,
      targetUrl,
      eventType,
      statusCode: null,
      responseBody: null,
      latencyMs,
      success: false,
      errorMessage: err.message,
    });

    const webhook = await storage.getWebhookById(webhookId);
    if (webhook) {
      await storage.updateWebhook(webhookId, { failCount: (webhook.failCount || 0) + 1 });
    }

    return { success: false, statusCode: null, latencyMs, responseBody: null, errorMessage: err.message };
  }
}

export async function dispatchToAllWebhooks(
  subAccountId: number,
  eventType: string,
  payload: Record<string, any>
): Promise<WebhookDispatchResult[]> {
  const webhooks = await storage.getWebhooks(subAccountId);
  const activeWebhooks = webhooks.filter(wh => wh.active && (!wh.events || wh.events.length === 0 || wh.events.includes(eventType)));

  const results = await Promise.allSettled(
    activeWebhooks.map(wh =>
      dispatchWebhook(wh.id, subAccountId, wh.url, eventType, { ...payload, event: eventType, timestamp: new Date().toISOString(), webhookId: wh.id }, wh.secret)
    )
  );

  return results.map(r => r.status === "fulfilled" ? r.value : { success: false, statusCode: null, latencyMs: 0, responseBody: null, errorMessage: "Dispatch error" });
}
