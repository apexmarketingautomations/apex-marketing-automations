import { storage } from "./storage";
import type { AbExperiment } from "@shared/schema";

export function calculateStatisticalSignificance(
  impressionsA: number,
  conversionsA: number,
  impressionsB: number,
  conversionsB: number
): { confidence: number; significant: boolean; winner: "A" | "B" | null } {
  if (impressionsA < 10 || impressionsB < 10) {
    return { confidence: 0, significant: false, winner: null };
  }

  const rateA = conversionsA / impressionsA;
  const rateB = conversionsB / impressionsB;

  const seA = Math.sqrt((rateA * (1 - rateA)) / impressionsA);
  const seB = Math.sqrt((rateB * (1 - rateB)) / impressionsB);
  const seDiff = Math.sqrt(seA * seA + seB * seB);

  if (seDiff === 0) {
    return { confidence: 0, significant: false, winner: null };
  }

  const zScore = Math.abs(rateA - rateB) / seDiff;

  let confidence = 0;
  if (zScore >= 2.576) confidence = 99;
  else if (zScore >= 1.96) confidence = 95;
  else if (zScore >= 1.645) confidence = 90;
  else if (zScore >= 1.282) confidence = 80;
  else if (zScore >= 1.0) confidence = 68;
  else confidence = Math.round(zScore * 50);

  const significant = confidence >= 95;
  const winner = significant ? (rateA > rateB ? "A" : "B") : null;

  return { confidence, significant, winner };
}

export function allocateVariant(trafficSplit: number, visitorId?: string): "A" | "B" {
  if (visitorId) {
    let hash = 0;
    for (let i = 0; i < visitorId.length; i++) {
      const char = visitorId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return (Math.abs(hash) % 100) < trafficSplit ? "A" : "B";
  }
  return Math.random() * 100 < trafficSplit ? "A" : "B";
}

export async function recordImpression(
  experimentId: number,
  variant: "A" | "B",
  visitorId?: string
): Promise<AbExperiment | undefined> {
  const experiment = await storage.getAbExperiment(experimentId);
  if (!experiment || experiment.status !== "running") return experiment;

  await storage.createAbEvent({
    experimentId,
    variant,
    eventType: "impression",
    visitorId: visitorId || null,
    metadata: null,
  });

  const update: any = {};
  if (variant === "A") {
    update.impressionsA = (experiment.impressionsA || 0) + 1;
  } else {
    update.impressionsB = (experiment.impressionsB || 0) + 1;
  }

  return storage.updateAbExperiment(experimentId, update);
}

export async function recordConversion(
  experimentId: number,
  variant: "A" | "B",
  visitorId?: string,
  metadata?: Record<string, any>
): Promise<AbExperiment | undefined> {
  const experiment = await storage.getAbExperiment(experimentId);
  if (!experiment || experiment.status !== "running") return experiment;

  await storage.createAbEvent({
    experimentId,
    variant,
    eventType: "conversion",
    visitorId: visitorId || null,
    metadata: metadata || null,
  });

  const update: any = {};
  if (variant === "A") {
    update.conversionsA = (experiment.conversionsA || 0) + 1;
  } else {
    update.conversionsB = (experiment.conversionsB || 0) + 1;
  }

  const updated = await storage.updateAbExperiment(experimentId, update);
  if (!updated) return undefined;

  const totalImpressions = (updated.impressionsA || 0) + (updated.impressionsB || 0);
  if (totalImpressions >= (updated.minSampleSize || 100)) {
    await checkAndPromoteWinner(updated);
  }

  return updated;
}

export async function checkAndPromoteWinner(experiment: AbExperiment): Promise<AbExperiment | undefined> {
  if (experiment.status !== "running") return experiment;

  const result = calculateStatisticalSignificance(
    experiment.impressionsA || 0,
    experiment.conversionsA || 0,
    experiment.impressionsB || 0,
    experiment.conversionsB || 0
  );

  const update: any = {
    confidenceLevel: result.confidence,
  };

  if (result.significant && result.winner) {
    update.winnerVariant = result.winner;

    if (experiment.autoPromote) {
      update.status = "completed";
      update.completedAt = new Date();
    }
  }

  return storage.updateAbExperiment(experiment.id, update);
}

export async function evaluateAllExperiments(): Promise<number> {
  const running = await storage.getRunningAbExperiments();
  let promoted = 0;

  for (const experiment of running) {
    const result = await checkAndPromoteWinner(experiment);
    if (result && result.status === "completed") {
      promoted++;
    }
  }

  return promoted;
}

export function getExperimentStats(experiment: AbExperiment) {
  const rateA = (experiment.impressionsA || 0) > 0
    ? ((experiment.conversionsA || 0) / (experiment.impressionsA || 1)) * 100
    : 0;
  const rateB = (experiment.impressionsB || 0) > 0
    ? ((experiment.conversionsB || 0) / (experiment.impressionsB || 1)) * 100
    : 0;

  const result = calculateStatisticalSignificance(
    experiment.impressionsA || 0,
    experiment.conversionsA || 0,
    experiment.impressionsB || 0,
    experiment.conversionsB || 0
  );

  const improvement = rateA > 0 ? ((rateB - rateA) / rateA) * 100 : 0;

  return {
    rateA: Math.round(rateA * 100) / 100,
    rateB: Math.round(rateB * 100) / 100,
    improvement: Math.round(improvement * 100) / 100,
    ...result,
  };
}
