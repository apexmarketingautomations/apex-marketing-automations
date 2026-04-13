import { storage } from "../storage";

export async function trackIntegrationSuccess(
  accountId: number,
  integrationType: string,
  integrationKey: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await storage.upsertIntegrationHealth({
    accountId,
    integrationType,
    integrationKey,
    status: "healthy",
    lastSuccessAt: new Date(),
    healthScore: 100,
    metadata: metadata || {},
  });
}

export async function trackIntegrationFailure(
  accountId: number,
  integrationType: string,
  integrationKey: string,
  failureReason: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const existing = await storage.getIntegrationHealthByType(accountId, integrationType, integrationKey);
  const currentScore = existing?.healthScore ?? 100;
  const newScore = Math.max(0, (currentScore ?? 100) - 25);

  await storage.upsertIntegrationHealth({
    accountId,
    integrationType,
    integrationKey,
    status: newScore <= 25 ? "error" : "degraded",
    lastFailureAt: new Date(),
    failureReason,
    healthScore: newScore,
    metadata: metadata || {},
  });
}

export async function trackIntegrationDisconnected(
  accountId: number,
  integrationType: string,
  integrationKey: string,
  reason?: string
): Promise<void> {
  await storage.upsertIntegrationHealth({
    accountId,
    integrationType,
    integrationKey,
    status: "disconnected",
    lastFailureAt: new Date(),
    failureReason: reason || "Integration disconnected",
    healthScore: 0,
  });
}

export async function runHealthCheckForAccount(accountId: number): Promise<void> {
  console.log(`[APEX-INTEL] Running integration health check for account ${accountId}`);
}
