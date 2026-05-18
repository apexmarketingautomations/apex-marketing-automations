/**
 * RBAC Permission System — Phase 11
 *
 * Eight built-in roles with granular resource/action permissions.
 * Role assignments are scoped to a hierarchy node (or platform-wide).
 *
 * Roles (highest → lowest):
 *  super_admin       — full platform control
 *  platform_admin    — manage all enterprises, billing, config
 *  enterprise_admin  — manage all orgs under their enterprise
 *  org_admin         — manage users, settings within their org
 *  office_manager    — manage one office's workflows and contacts
 *  agent             — full CRM access, no billing/admin
 *  read_only         — view only
 *  receptionist      — inbox + contact creation only
 */

import { db } from "../db";
import { enterpriseRoles, enterpriseRoleAssignments, enterpriseRolePermissions } from "@shared/schema";
import { eq, and, or } from "drizzle-orm";
import { logEnterpriseAudit } from "./operationalAuditService";

export type RoleName =
  | "super_admin"
  | "platform_admin"
  | "enterprise_admin"
  | "org_admin"
  | "office_manager"
  | "agent"
  | "read_only"
  | "receptionist";

export type PermissionResource =
  | "contacts"
  | "workflows"
  | "billing"
  | "ai_config"
  | "reports"
  | "admin"
  | "inbox"
  | "deals"
  | "appointments"
  | "settings"
  | "enrichment"
  | "integrations"
  | "users"
  | "white_label";

export type PermissionAction = "read" | "write" | "delete" | "configure" | "approve";

// Static permission matrix — source of truth for built-in roles
const ROLE_PERMISSIONS: Record<RoleName, { resource: PermissionResource; action: PermissionAction }[]> = {
  super_admin: [
    { resource: "contacts", action: "read" }, { resource: "contacts", action: "write" }, { resource: "contacts", action: "delete" },
    { resource: "workflows", action: "read" }, { resource: "workflows", action: "write" }, { resource: "workflows", action: "delete" },
    { resource: "billing", action: "read" }, { resource: "billing", action: "write" }, { resource: "billing", action: "configure" },
    { resource: "ai_config", action: "read" }, { resource: "ai_config", action: "write" }, { resource: "ai_config", action: "configure" },
    { resource: "reports", action: "read" },
    { resource: "admin", action: "read" }, { resource: "admin", action: "write" }, { resource: "admin", action: "configure" }, { resource: "admin", action: "approve" },
    { resource: "inbox", action: "read" }, { resource: "inbox", action: "write" },
    { resource: "deals", action: "read" }, { resource: "deals", action: "write" }, { resource: "deals", action: "delete" },
    { resource: "appointments", action: "read" }, { resource: "appointments", action: "write" }, { resource: "appointments", action: "delete" },
    { resource: "settings", action: "read" }, { resource: "settings", action: "write" }, { resource: "settings", action: "configure" },
    { resource: "enrichment", action: "read" }, { resource: "enrichment", action: "write" }, { resource: "enrichment", action: "configure" },
    { resource: "integrations", action: "read" }, { resource: "integrations", action: "write" }, { resource: "integrations", action: "configure" },
    { resource: "users", action: "read" }, { resource: "users", action: "write" }, { resource: "users", action: "delete" }, { resource: "users", action: "configure" },
    { resource: "white_label", action: "read" }, { resource: "white_label", action: "write" }, { resource: "white_label", action: "configure" },
  ],

  platform_admin: [
    { resource: "contacts", action: "read" }, { resource: "contacts", action: "write" },
    { resource: "workflows", action: "read" }, { resource: "workflows", action: "write" },
    { resource: "billing", action: "read" }, { resource: "billing", action: "write" }, { resource: "billing", action: "configure" },
    { resource: "ai_config", action: "read" }, { resource: "ai_config", action: "write" },
    { resource: "reports", action: "read" },
    { resource: "admin", action: "read" }, { resource: "admin", action: "write" }, { resource: "admin", action: "approve" },
    { resource: "inbox", action: "read" }, { resource: "inbox", action: "write" },
    { resource: "deals", action: "read" }, { resource: "deals", action: "write" },
    { resource: "settings", action: "read" }, { resource: "settings", action: "write" },
    { resource: "users", action: "read" }, { resource: "users", action: "write" }, { resource: "users", action: "delete" },
    { resource: "white_label", action: "read" }, { resource: "white_label", action: "write" },
    { resource: "enrichment", action: "read" }, { resource: "enrichment", action: "write" },
    { resource: "integrations", action: "read" }, { resource: "integrations", action: "write" },
  ],

  enterprise_admin: [
    { resource: "contacts", action: "read" }, { resource: "contacts", action: "write" },
    { resource: "workflows", action: "read" }, { resource: "workflows", action: "write" },
    { resource: "billing", action: "read" },
    { resource: "ai_config", action: "read" }, { resource: "ai_config", action: "write" },
    { resource: "reports", action: "read" },
    { resource: "admin", action: "read" }, { resource: "admin", action: "write" },
    { resource: "inbox", action: "read" }, { resource: "inbox", action: "write" },
    { resource: "deals", action: "read" }, { resource: "deals", action: "write" },
    { resource: "settings", action: "read" }, { resource: "settings", action: "write" },
    { resource: "users", action: "read" }, { resource: "users", action: "write" },
    { resource: "enrichment", action: "read" },
  ],

  org_admin: [
    { resource: "contacts", action: "read" }, { resource: "contacts", action: "write" },
    { resource: "workflows", action: "read" }, { resource: "workflows", action: "write" },
    { resource: "billing", action: "read" },
    { resource: "reports", action: "read" },
    { resource: "admin", action: "read" },
    { resource: "inbox", action: "read" }, { resource: "inbox", action: "write" },
    { resource: "deals", action: "read" }, { resource: "deals", action: "write" },
    { resource: "settings", action: "read" }, { resource: "settings", action: "write" },
    { resource: "users", action: "read" }, { resource: "users", action: "write" },
  ],

  office_manager: [
    { resource: "contacts", action: "read" }, { resource: "contacts", action: "write" },
    { resource: "workflows", action: "read" }, { resource: "workflows", action: "write" },
    { resource: "reports", action: "read" },
    { resource: "inbox", action: "read" }, { resource: "inbox", action: "write" },
    { resource: "deals", action: "read" }, { resource: "deals", action: "write" },
    { resource: "appointments", action: "read" }, { resource: "appointments", action: "write" },
    { resource: "settings", action: "read" },
  ],

  agent: [
    { resource: "contacts", action: "read" }, { resource: "contacts", action: "write" },
    { resource: "inbox", action: "read" }, { resource: "inbox", action: "write" },
    { resource: "deals", action: "read" }, { resource: "deals", action: "write" },
    { resource: "appointments", action: "read" }, { resource: "appointments", action: "write" },
    { resource: "reports", action: "read" },
  ],

  read_only: [
    { resource: "contacts", action: "read" },
    { resource: "inbox", action: "read" },
    { resource: "deals", action: "read" },
    { resource: "appointments", action: "read" },
    { resource: "reports", action: "read" },
    { resource: "workflows", action: "read" },
  ],

  receptionist: [
    { resource: "contacts", action: "read" }, { resource: "contacts", action: "write" },
    { resource: "inbox", action: "read" }, { resource: "inbox", action: "write" },
    { resource: "appointments", action: "read" }, { resource: "appointments", action: "write" },
  ],
};

// Role hierarchy for inheritance checks (higher index = higher power)
const ROLE_POWER: Record<RoleName, number> = {
  super_admin:      100,
  platform_admin:   90,
  enterprise_admin: 70,
  org_admin:        60,
  office_manager:   50,
  agent:            40,
  read_only:        20,
  receptionist:     10,
};

/** Seed built-in system roles into DB (idempotent, run on startup). */
export async function seedSystemRoles(): Promise<void> {
  const roleNames = Object.keys(ROLE_PERMISSIONS) as RoleName[];

  for (const name of roleNames) {
    // Insert role if missing
    await db
      .insert(enterpriseRoles)
      .values({ name, displayName: _displayName(name), isSystem: true })
      .onConflictDoNothing();
  }

  console.log("[RBAC] System roles seeded");
}

/** Assign a role to a user within a scope (node or platform-wide). */
export async function assignRole(params: {
  userId:       string;
  roleName:     RoleName;
  scopeNodeId?: number;
  subAccountId?: number;
  grantedBy?:   string;
  expiresAt?:   Date;
}): Promise<void> {
  const [role] = await db
    .select()
    .from(enterpriseRoles)
    .where(eq(enterpriseRoles.name, params.roleName))
    .limit(1);

  if (!role) throw new Error(`[RBAC] Unknown role: ${params.roleName}`);

  await db
    .insert(enterpriseRoleAssignments)
    .values({
      userId:       params.userId,
      roleId:       role.id,
      scopeNodeId:  params.scopeNodeId || null,
      subAccountId: params.subAccountId || null,
      grantedBy:    params.grantedBy || "system",
      expiresAt:    params.expiresAt || null,
    })
    .onConflictDoNothing();

  await logEnterpriseAudit({
    eventType:    "rbac.role_assigned",
    actor:        params.grantedBy || "system",
    subAccountId: params.subAccountId,
    resource:     `user:${params.userId}`,
    payload:      { roleName: params.roleName, scopeNodeId: params.scopeNodeId },
  }).catch(() => {}); // allow-silent-catch: fire-and-forget
}

/** Check if a user has a specific permission (checks all assigned roles). */
export async function hasPermission(
  userId: string,
  resource: PermissionResource,
  action:   PermissionAction,
  subAccountId?: number,
): Promise<boolean> {
  const assignments = await db
    .select({ roleId: enterpriseRoleAssignments.roleId, expiresAt: enterpriseRoleAssignments.expiresAt })
    .from(enterpriseRoleAssignments)
    .where(eq(enterpriseRoleAssignments.userId, userId));

  for (const assignment of assignments) {
    // Skip expired assignments
    if (assignment.expiresAt && new Date(assignment.expiresAt) < new Date()) continue;

    const [role] = await db
      .select({ name: enterpriseRoles.name })
      .from(enterpriseRoles)
      .where(eq(enterpriseRoles.id, assignment.roleId))
      .limit(1);

    if (!role) continue;

    const perms = ROLE_PERMISSIONS[role.name as RoleName] || [];
    if (perms.some(p => p.resource === resource && p.action === action)) return true;
  }

  return false;
}

/** Get effective role for a user (highest-power role). */
export async function getEffectiveRole(userId: string, subAccountId?: number): Promise<RoleName | null> {
  const assignments = await db
    .select({ roleId: enterpriseRoleAssignments.roleId })
    .from(enterpriseRoleAssignments)
    .where(eq(enterpriseRoleAssignments.userId, userId));

  let highestPower = -1;
  let highestRole: RoleName | null = null;

  for (const assignment of assignments) {
    const [role] = await db
      .select({ name: enterpriseRoles.name })
      .from(enterpriseRoles)
      .where(eq(enterpriseRoles.id, assignment.roleId))
      .limit(1);

    if (!role) continue;
    const power = ROLE_POWER[role.name as RoleName] ?? 0;
    if (power > highestPower) {
      highestPower = power;
      highestRole  = role.name as RoleName;
    }
  }

  return highestRole;
}

/** List all roles (for admin UI). */
export async function listRoles() {
  return db.select().from(enterpriseRoles);
}

/** List permissions for a role name (static matrix, no DB needed). */
export function getRolePermissions(roleName: RoleName) {
  return ROLE_PERMISSIONS[roleName] || [];
}

/** Express middleware: require a permission to proceed. */
export function requirePermission(resource: PermissionResource, action: PermissionAction) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id || req.body?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });

    const allowed = await hasPermission(userId, resource, action, req.body?.subAccountId);
    if (!allowed) return res.status(403).json({ error: "Insufficient permissions", resource, action });

    next();
  };
}

function _displayName(name: RoleName): string {
  const map: Record<RoleName, string> = {
    super_admin:      "Super Admin",
    platform_admin:   "Platform Admin",
    enterprise_admin: "Enterprise Admin",
    org_admin:        "Org Admin",
    office_manager:   "Office Manager",
    agent:            "Agent",
    read_only:        "Read Only",
    receptionist:     "Receptionist",
  };
  return map[name] || name;
}
