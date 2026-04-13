import { storage } from "../storage";

export async function linkEntities(
  accountId: number,
  entityType: string,
  entityId: string,
  linkedEntityType: string,
  linkedEntityId: string,
  confidence: number = 1.0,
  matchReason: string = "direct"
): Promise<void> {
  const existing = await storage.getEntityLinks(accountId, entityType, entityId);
  const alreadyLinked = existing.find(
    l => l.linkedEntityType === linkedEntityType && l.linkedEntityId === linkedEntityId
  );
  if (alreadyLinked) {
    return;
  }
  await storage.createEntityIdentityLink({
    accountId,
    entityType,
    entityId,
    linkedEntityType,
    linkedEntityId,
    confidenceScore: confidence,
    matchReason,
  });
}

export async function resolveIdentityChain(
  accountId: number,
  entityType: string,
  entityId: string,
  maxDepth: number = 3
): Promise<{ entityType: string; entityId: string; confidence: number; path: string[] }[]> {
  const results: { entityType: string; entityId: string; confidence: number; path: string[] }[] = [];
  const visited = new Set<string>();
  const queue: { type: string; id: string; confidence: number; path: string[] }[] = [
    { type: entityType, id: entityId, confidence: 1.0, path: [`${entityType}:${entityId}`] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.type}:${current.id}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (current.path.length > 1) {
      results.push({
        entityType: current.type,
        entityId: current.id,
        confidence: current.confidence,
        path: current.path,
      });
    }

    if (current.path.length > maxDepth) continue;

    const forwardLinks = await storage.getEntityLinks(accountId, current.type, current.id);
    for (const link of forwardLinks) {
      const linkKey = `${link.linkedEntityType}:${link.linkedEntityId}`;
      if (!visited.has(linkKey)) {
        queue.push({
          type: link.linkedEntityType,
          id: link.linkedEntityId,
          confidence: current.confidence * (link.confidenceScore ?? 1),
          path: [...current.path, linkKey],
        });
      }
    }

    const reverseLinks = await storage.getLinkedEntities(accountId, current.type, current.id);
    for (const link of reverseLinks) {
      const linkKey = `${link.entityType}:${link.entityId}`;
      if (!visited.has(linkKey)) {
        queue.push({
          type: link.entityType,
          id: link.entityId,
          confidence: current.confidence * (link.confidenceScore ?? 1),
          path: [...current.path, linkKey],
        });
      }
    }
  }

  return results;
}

export async function linkSessionToContact(
  accountId: number,
  sessionId: string,
  contactId: number
): Promise<void> {
  await linkEntities(accountId, "session", sessionId, "contact", String(contactId), 0.9, "form_submission");
}

export async function linkCardScanToContact(
  accountId: number,
  cardId: number,
  contactId: number,
  scanSessionId?: string
): Promise<void> {
  await linkEntities(accountId, "card", String(cardId), "contact", String(contactId), 0.85, "card_scan");
  if (scanSessionId) {
    await linkEntities(accountId, "session", scanSessionId, "card", String(cardId), 0.9, "card_scan_session");
  }
}

export async function linkUserToSession(
  accountId: number,
  userId: string,
  sessionId: string
): Promise<void> {
  await linkEntities(accountId, "user", userId, "session", sessionId, 1.0, "login");
}

export async function linkLeadToContact(
  accountId: number,
  leadId: number,
  contactId: number
): Promise<void> {
  await linkEntities(accountId, "lead", String(leadId), "contact", String(contactId), 0.95, "lead_conversion");
}
