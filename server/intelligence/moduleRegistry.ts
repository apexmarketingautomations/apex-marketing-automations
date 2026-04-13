export const MODULE_GROUP_EVENT_MAP: Record<string, string[]> = {
  crm: [
    "lead.created", "lead.updated",
    "contact.created", "contact.updated", "contact.deleted",
    "deal.created", "deal.stage.changed", "deal.won", "deal.lost", "deal.updated",
    "pipeline.stage.created", "pipeline.stage.updated",
  ],
  forms: [
    "form.submitted", "form.started", "form.abandoned",
    "form.created", "form.updated",
    "funnel.lead.captured", "funnel.lead.converted",
  ],
  messaging: [
    "message.received", "message.sent", "message.failed", "message.read",
    "call.completed", "call.missed", "call.started",
    "dm.keyword.triggered",
    "instagram.message.received", "instagram.comment.received",
    "meta.lead.received",
  ],
  calendar: [
    "appointment.booked", "appointment.cancelled",
    "appointment.rescheduled", "appointment.reminder.sent",
    "calendar.synced",
  ],
  sites: [
    "site.generated", "site.published", "site.updated",
    "site.created", "site.version.created", "site.collaborator.added",
  ],
  domains: [
    "domain.registered", "domain.verified", "domain.attached",
    "domain.dns.configured", "domain.ssl.activated", "domain.searched",
  ],
  cards: [
    "card.created", "card.updated", "card.scanned",
    "card.opened", "card.shared", "card.contact.saved",
  ],
  campaigns: [
    "campaign.created", "campaign.sent", "campaign.completed",
    "campaign.failed", "campaign.opened", "campaign.clicked",
    "campaign.unsubscribed",
    "ad.campaign.launched", "ad.campaign.completed", "ad.campaign.updated",
  ],
  workflows: [
    "workflow.started", "workflow.completed", "workflow.failed",
    "workflow.step.executed", "workflow.optimized",
    "automation.triggered", "automation.completed",
  ],
  integrations: [
    "integration.connected", "integration.disconnected", "integration.error",
    "integration.health.updated", "webhook.received", "webhook.sent",
    "oauth.token.refreshed", "shopify.event.received",
  ],
  reputation: [
    "review.received", "review.replied", "review.flagged",
    "reputation.score.updated",
  ],
  sentinel: [
    "crash.detected", "sentinel.alert",
    "sentinel.incident.created", "sentinel.incident.resolved",
    "sentinel.health.check",
  ],
  analytics: [
    "page.view", "cta.clicked", "button.clicked",
    "ab.experiment.started", "ab.experiment.converted",
    "rollup.computed", "score.updated", "recommendation.generated",
  ],
  billing: [
    "payment.completed", "payment.failed", "subscription.changed",
    "credit.purchased", "credit.consumed", "message.billed",
  ],
  ai: [
    "ai.chat.completed", "ai.training.completed",
    "ai.response.generated", "ai.tool.executed",
  ],
};

const _reverseMap: Map<string, string> = new Map();
for (const [group, events] of Object.entries(MODULE_GROUP_EVENT_MAP)) {
  for (const evt of events) {
    _reverseMap.set(evt, group);
  }
}

export function getModuleGroupForEvent(eventType: string): string | undefined {
  return _reverseMap.get(eventType);
}
