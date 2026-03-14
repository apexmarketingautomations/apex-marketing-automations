export type MemoryType = "session" | "workspace" | "behavior" | "performance" | "pattern";

export interface MemoryEntry {
  id?: number;
  subAccountId: number;
  memoryType: MemoryType;
  key: string;
  value: any;
  confidence: number;
  source: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
}

export interface WorkspaceProfile {
  industry: string;
  businessName: string;
  location?: string;
  targetMarket?: string;
  services?: string[];
  leadSources?: string[];
  pricingModel?: string;
  phoneConfigured: boolean;
  integrationCount: number;
  automationCount: number;
  contactCount: number;
  siteCount: number;
}

export interface UserBehaviorProfile {
  recommendationAcceptRate: number;
  avgResponseTimeMs: number;
  preferredStyle: "analytical" | "action" | "skeptical" | "balanced";
  complexityTolerance: "low" | "medium" | "high";
  ignoreCount: number;
  acceptCount: number;
  lastInteraction: string;
  nudgesShown: number;
  nudgesDismissed: number;
}

export interface PerformanceSnapshot {
  subAccountId: number;
  contactCount: number;
  messageCount: number;
  inboundMessages: number;
  outboundMessages: number;
  failedMessages: number;
  automationCount: number;
  activeAutomations: number;
  avgResponseTimeSec?: number;
  leadConversionRate?: number;
  timestamp: string;
}

export interface PatternInsight {
  pattern: string;
  confidence: number;
  dataPoints: number;
  firstSeen: string;
  lastSeen: string;
  category: "conversion" | "timing" | "channel" | "engagement" | "system";
}

export interface AdvisoryInsight {
  id: string;
  subAccountId: number;
  category: "opportunity" | "warning" | "optimization" | "milestone";
  title: string;
  message: string;
  dataBacking: Record<string, any>;
  confidence: number;
  priority: number;
  actionable: boolean;
  suggestedTool?: string;
  suggestedParams?: Record<string, any>;
  expiresAt?: string;
}

export interface NudgeConfig {
  maxPerDay: number;
  minIntervalMs: number;
  respectDismissals: boolean;
  maxConsecutiveIgnores: number;
}

export interface ContextPacket {
  workspace: WorkspaceProfile;
  behavior: UserBehaviorProfile;
  performance: PerformanceSnapshot;
  patterns: PatternInsight[];
  recentEvents: Array<{ type: string; at: string; payload: any }>;
  activeNudges: number;
  diagnosticsSummary: string;
  industryKnowledge?: IndustryKnowledge;
}

export interface IndustryKnowledge {
  industry: string;
  leadStrategies: string[];
  conversionBenchmarks: Record<string, number>;
  bestChannels: string[];
  seasonalTrends?: string[];
  commonWorkflows: string[];
  avgResponseTimeBenchmark: number;
  tips: string[];
}
