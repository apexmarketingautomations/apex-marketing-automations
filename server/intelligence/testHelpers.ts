import { emitUniversalEvent, emitUniversalEventSync, emitWithEntityLinkage, emitWithTimeline, type UniversalEventInput, EVENT_TYPES } from "./eventEmitter";
import { publishEvent, publishEventAsync, EVENT_TYPES as BUS_EVENT_TYPES } from "../eventBus";
import { getModuleGroupForEvent } from "./moduleRegistry";
import { storage } from "../storage";

export type EmitTestEventOptions = {
  accountId: number;
  eventType: string;
  sourceModule: string;
  moduleSource?: string;
  entityType?: string;
  entityId?: string;
  contactId?: number;
  siteId?: number;
  domainId?: number;
  cardId?: number;
  campaignId?: number;
  workflowId?: number;
  userId?: string;
  anonymousSessionId?: string;
  metadata?: Record<string, unknown>;
  sync?: boolean;
};

export async function emitTestEvent(opts: EmitTestEventOptions): Promise<void> {
  const input: UniversalEventInput = {
    eventType: opts.eventType,
    sourceModule: opts.sourceModule,
    moduleSource: opts.moduleSource ?? getModuleGroupForEvent(opts.eventType) ?? opts.sourceModule,
    entityType: opts.entityType,
    entityId: opts.entityId,
    accountId: opts.accountId,
    subAccountId: opts.accountId,
    contactId: opts.contactId,
    siteId: opts.siteId,
    domainId: opts.domainId,
    cardId: opts.cardId,
    campaignId: opts.campaignId,
    workflowId: opts.workflowId,
    userId: opts.userId,
    anonymousSessionId: opts.anonymousSessionId,
    metadata: opts.metadata,
    occurredAt: new Date(),
  };

  if (opts.sync) {
    await emitUniversalEventSync(input);
  } else {
    emitUniversalEvent(input);
  }
}

export async function emitTestEventBatch(events: EmitTestEventOptions[]): Promise<void> {
  await Promise.all(events.map(e => emitTestEvent(e)));
}

export async function emitContactEvent(accountId: number, contactId: number, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: getModuleGroupForEvent(eventType) ?? "crm",
    entityType: "contact",
    entityId: String(contactId),
    contactId,
    metadata,
    sync: true,
  });
}

export async function emitSiteEvent(accountId: number, siteId: number, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "sites",
    entityType: "site",
    entityId: String(siteId),
    siteId,
    metadata,
    sync: true,
  });
}

export async function emitDomainEvent(accountId: number, domainId: number, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "domains",
    entityType: "domain",
    entityId: String(domainId),
    domainId,
    metadata,
    sync: true,
  });
}

export async function emitWorkflowEvent(accountId: number, workflowId: number, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "workflows",
    entityType: "workflow",
    entityId: String(workflowId),
    workflowId,
    metadata,
    sync: true,
  });
}

export async function emitCalendarEvent(accountId: number, appointmentId: number, eventType: string, contactId?: number, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "calendar",
    entityType: "appointment",
    entityId: String(appointmentId),
    contactId,
    metadata,
    sync: true,
  });
}

export async function emitCardEvent(accountId: number, cardId: number, eventType: string, contactId?: number, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "cards",
    entityType: "card",
    entityId: String(cardId),
    cardId,
    contactId,
    metadata,
    sync: true,
  });
}

export async function emitCampaignEvent(accountId: number, campaignId: number, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "campaigns",
    entityType: "campaign",
    entityId: String(campaignId),
    campaignId,
    metadata,
    sync: true,
  });
}

export async function emitIntegrationEvent(accountId: number, provider: string, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "integrations",
    entityType: "integration",
    entityId: provider,
    metadata: { provider, ...metadata },
    sync: true,
  });
}

export async function emitMessagingEvent(accountId: number, eventType: string, contactId?: number, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "messaging",
    entityType: "message",
    contactId,
    metadata,
    sync: true,
  });
}

export async function emitReputationEvent(accountId: number, reviewId: number, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "reputation",
    entityType: "review",
    entityId: String(reviewId),
    metadata,
    sync: true,
  });
}

export async function emitSentinelEvent(accountId: number, incidentId: number | string, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "sentinel",
    entityType: "incident",
    entityId: String(incidentId),
    metadata,
    sync: true,
  });
}

export async function emitFormEvent(accountId: number, formId: string, eventType: string, contactId?: number, anonymousSessionId?: string, metadata?: Record<string, unknown>): Promise<void> {
  return emitTestEvent({
    accountId,
    eventType,
    sourceModule: "forms",
    entityType: "form",
    entityId: formId,
    contactId,
    anonymousSessionId,
    metadata,
    sync: true,
  });
}

export async function publishBusEvent(
  eventType: string,
  payload: Record<string, any>,
  sourceModule: string
): Promise<string> {
  return publishEvent(eventType, payload, sourceModule);
}

export function publishBusEventAsync(
  eventType: string,
  payload: Record<string, any>,
  sourceModule: string
): void {
  publishEventAsync(eventType, payload, sourceModule);
}

export async function getModuleCoverageSummary(accountId: number): Promise<{
  moduleGroup: string;
  eventCount: number;
  observedEventTypes: number;
  totalEventTypes: number;
  coverageScore: number;
  lastEventAt: Date | null;
}[]> {
  const rows = await storage.getModuleCoverage(accountId);
  return rows.map(r => ({
    moduleGroup: r.moduleGroup,
    eventCount: r.eventCount,
    observedEventTypes: r.observedEventTypes,
    totalEventTypes: r.totalEventTypes,
    coverageScore: r.coverageScore,
    lastEventAt: r.lastEventAt ?? null,
  }));
}

export { EVENT_TYPES, BUS_EVENT_TYPES, getModuleGroupForEvent };
