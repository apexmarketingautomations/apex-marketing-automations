import type { PatternInsight, PerformanceSnapshot } from "./cognitiveTypes";
import { recallMemory, recordPattern, storeMemory } from "./memoryEngine";

export async function detectTrends(subAccountId: number, currentSnapshot: PerformanceSnapshot): Promise<PatternInsight[]> {
  const detected: PatternInsight[] = [];
  const now = new Date().toISOString();

  const previousSnapshots = await recallMemory(subAccountId, "performance", "snapshot_history");
  const history: PerformanceSnapshot[] = previousSnapshots.length > 0 ? (previousSnapshots[0].value || []) : [];

  history.push(currentSnapshot);
  if (history.length > 30) history.splice(0, history.length - 30);

  await storeMemory({
    subAccountId, memoryType: "performance", key: "snapshot_history",
    value: history, confidence: 1.0, source: "trend-detection", version: 1,
  });

  if (history.length < 3) return detected;

  const recent = history.slice(-3);
  const contactGrowth = recent.map((s, i) => i > 0 ? s.contactCount - recent[i - 1].contactCount : 0);
  const avgGrowth = contactGrowth.reduce((a, b) => a + b, 0) / contactGrowth.length;

  if (avgGrowth > 5) {
    detected.push({
      pattern: "Contact growth is accelerating — new leads are coming in faster",
      confidence: Math.min(0.9, 0.5 + (avgGrowth / 20)),
      dataPoints: recent.length,
      firstSeen: recent[0].timestamp,
      lastSeen: now,
      category: "engagement",
    });
  } else if (avgGrowth < -2 && history.length >= 5) {
    detected.push({
      pattern: "Lead volume is declining — fewer new contacts are being added",
      confidence: Math.min(0.85, 0.5 + Math.abs(avgGrowth) / 20),
      dataPoints: recent.length,
      firstSeen: recent[0].timestamp,
      lastSeen: now,
      category: "engagement",
    });
  }

  if (currentSnapshot.messageCount > 20) {
    const failRate = currentSnapshot.failedMessages / currentSnapshot.messageCount;
    if (failRate > 0.15) {
      detected.push({
        pattern: `Message failure rate is ${Math.round(failRate * 100)}% — significantly above normal`,
        confidence: 0.9,
        dataPoints: currentSnapshot.messageCount,
        firstSeen: now,
        lastSeen: now,
        category: "system",
      });
    }
  }

  if (currentSnapshot.outboundMessages > 0 && currentSnapshot.inboundMessages > 0) {
    const ratio = currentSnapshot.outboundMessages / currentSnapshot.inboundMessages;
    if (ratio < 0.3) {
      detected.push({
        pattern: "Outbound messages are much lower than inbound — leads may not be getting timely responses",
        confidence: 0.8,
        dataPoints: currentSnapshot.messageCount,
        firstSeen: now,
        lastSeen: now,
        category: "conversion",
      });
    }
  }

  if (currentSnapshot.automationCount > 0 && currentSnapshot.activeAutomations === 0) {
    detected.push({
      pattern: "Automations exist but none are active — workflows are not running",
      confidence: 0.95,
      dataPoints: currentSnapshot.automationCount,
      firstSeen: now,
      lastSeen: now,
      category: "system",
    });
  }

  if (history.length >= 5) {
    const oldAvg = history.slice(0, Math.floor(history.length / 2))
      .reduce((sum, s) => sum + s.contactCount, 0) / Math.floor(history.length / 2);
    const newAvg = history.slice(Math.floor(history.length / 2))
      .reduce((sum, s) => sum + s.contactCount, 0) / (history.length - Math.floor(history.length / 2));

    if (newAvg > oldAvg * 1.5 && oldAvg > 0) {
      detected.push({
        pattern: `Lead volume has increased ${Math.round((newAvg / oldAvg - 1) * 100)}% compared to earlier periods`,
        confidence: 0.75,
        dataPoints: history.length,
        firstSeen: history[0].timestamp,
        lastSeen: now,
        category: "conversion",
      });
    }
  }

  for (const p of detected) {
    await recordPattern(subAccountId, p);
  }

  return detected;
}
