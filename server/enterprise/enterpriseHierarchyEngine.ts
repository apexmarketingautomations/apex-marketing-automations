/**
 * Enterprise Hierarchy Engine — Phase 11
 *
 * Manages the 6-level tenant tree:
 *   platform → enterprise → org → office → team → user
 *
 * Features:
 *  - getHierarchyPath()  — full ancestor chain for a node
 *  - getChildNodes()     — immediate children
 *  - getSubtreeAccounts()— all sub_account IDs under a node (for admin scoping)
 *  - upsertNode()        — create or update a hierarchy node
 *  - linkSubAccount()    — attach a sub_account to a leaf node
 */

import { db } from "../db";
import { enterpriseHierarchyNodes, subAccounts } from "@shared/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import type { EnterpriseHierarchyNode } from "@shared/schema";

export type NodeType = "platform" | "enterprise" | "org" | "office" | "team" | "user";

export const NODE_TYPE_ORDER: NodeType[] = ["platform", "enterprise", "org", "office", "team", "user"];

export interface HierarchyNode {
  id:           number;
  nodeType:     NodeType;
  name:         string;
  parentId:     number | null;
  subAccountId: number | null;
  ownerId:      string | null;
  metadata:     Record<string, unknown> | null;
  createdAt:    Date;
  updatedAt:    Date;
}

/** Get or create the platform root node. */
export async function getPlatformRoot(): Promise<HierarchyNode> {
  const [existing] = await db
    .select()
    .from(enterpriseHierarchyNodes)
    .where(and(
      eq(enterpriseHierarchyNodes.nodeType, "platform"),
      isNull(enterpriseHierarchyNodes.parentId),
    ))
    .limit(1);

  if (existing) return existing as HierarchyNode;

  const [created] = await db
    .insert(enterpriseHierarchyNodes)
    .values({ nodeType: "platform", name: "Apex Platform", parentId: null })
    .returning();

  return created as HierarchyNode;
}

/** Upsert a hierarchy node. Returns the node. */
export async function upsertNode(params: {
  id?:          number;
  nodeType:     NodeType;
  name:         string;
  parentId?:    number | null;
  subAccountId?: number | null;
  ownerId?:     string | null;
  metadata?:    Record<string, unknown>;
}): Promise<HierarchyNode> {
  if (params.id) {
    const [updated] = await db
      .update(enterpriseHierarchyNodes)
      .set({
        name:         params.name,
        parentId:     params.parentId ?? null,
        subAccountId: params.subAccountId ?? null,
        ownerId:      params.ownerId ?? null,
        metadata:     params.metadata || null,
        updatedAt:    new Date(),
      })
      .where(eq(enterpriseHierarchyNodes.id, params.id))
      .returning();
    return updated as HierarchyNode;
  }

  const [created] = await db
    .insert(enterpriseHierarchyNodes)
    .values({
      nodeType:     params.nodeType,
      name:         params.name,
      parentId:     params.parentId ?? null,
      subAccountId: params.subAccountId ?? null,
      ownerId:      params.ownerId ?? null,
      metadata:     params.metadata || null,
    })
    .returning();

  return created as HierarchyNode;
}

/** Get immediate children of a node. */
export async function getChildNodes(parentId: number): Promise<HierarchyNode[]> {
  return db
    .select()
    .from(enterpriseHierarchyNodes)
    .where(eq(enterpriseHierarchyNodes.parentId, parentId)) as Promise<HierarchyNode[]>;
}

/** Get full ancestor path from root to a node (inclusive). */
export async function getHierarchyPath(nodeId: number): Promise<HierarchyNode[]> {
  const path: HierarchyNode[] = [];
  let current: HierarchyNode | null = await getNodeById(nodeId);

  while (current) {
    path.unshift(current);
    if (!current.parentId) break;
    current = await getNodeById(current.parentId);
  }

  return path;
}

/** Get a single node by ID. */
export async function getNodeById(nodeId: number): Promise<HierarchyNode | null> {
  const [node] = await db
    .select()
    .from(enterpriseHierarchyNodes)
    .where(eq(enterpriseHierarchyNodes.id, nodeId))
    .limit(1);
  return (node as HierarchyNode) || null;
}

/** Collect all sub_account IDs under a node (recursive via JS, not DB recursive CTE). */
export async function getSubtreeAccountIds(rootNodeId: number): Promise<number[]> {
  const allNodes = await db.select().from(enterpriseHierarchyNodes);
  const nodeMap  = new Map(allNodes.map(n => [n.id, n]));

  const result: number[] = [];
  const queue  = [rootNodeId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (!node) continue;

    if (node.subAccountId) result.push(node.subAccountId);

    for (const n of allNodes) {
      if (n.parentId === id) queue.push(n.id);
    }
  }

  return Array.from(new Set(result));
}

/** Link a sub_account to an existing hierarchy node. */
export async function linkSubAccount(nodeId: number, subAccountId: number): Promise<void> {
  await db
    .update(enterpriseHierarchyNodes)
    .set({ subAccountId, updatedAt: new Date() })
    .where(eq(enterpriseHierarchyNodes.id, nodeId));
}

/** Get the full hierarchy tree as a nested structure. */
export async function getFullHierarchyTree(): Promise<HierarchyNode & { children: any[] }> {
  const allNodes = await db.select().from(enterpriseHierarchyNodes) as HierarchyNode[];
  const root = await getPlatformRoot();

  function buildTree(parentId: number | null): any[] {
    return allNodes
      .filter(n => n.parentId === parentId && n.id !== root.id)
      .map(n => ({ ...n, children: buildTree(n.id) }));
  }

  return { ...root, children: buildTree(root.id) };
}

/** Get all nodes for a given type. */
export async function getNodesByType(nodeType: NodeType): Promise<HierarchyNode[]> {
  return db
    .select()
    .from(enterpriseHierarchyNodes)
    .where(eq(enterpriseHierarchyNodes.nodeType, nodeType)) as Promise<HierarchyNode[]>;
}

/** Auto-provision hierarchy nodes for a new sub-account (org-level default). */
export async function autoProvisionSubAccount(
  subAccountId: number,
  orgName: string,
  ownerId?: string,
): Promise<HierarchyNode> {
  const root = await getPlatformRoot();

  const orgNode = await upsertNode({
    nodeType:     "org",
    name:         orgName,
    parentId:     root.id,
    subAccountId,
    ownerId:      ownerId || null,
  });

  return orgNode;
}
