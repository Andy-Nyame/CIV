import type { MembershipRole } from "@/generated/prisma/enums";

export const CAPABILITIES = {
  VIEW_WORKSPACE: "VIEW_WORKSPACE",
  MANAGE_WORKSPACE_SETTINGS: "MANAGE_WORKSPACE_SETTINGS",
  VIEW_TEAM: "VIEW_TEAM",
  MANAGE_TEAM: "MANAGE_TEAM",
  CREATE_DOCUMENT: "CREATE_DOCUMENT",
  ISSUE_DOCUMENT: "ISSUE_DOCUMENT",
  VIEW_OWN_DOCUMENTS: "VIEW_OWN_DOCUMENTS",
  VIEW_ALL_DOCUMENTS: "VIEW_ALL_DOCUMENTS",
  UPDATE_DRAFT_DOCUMENT: "UPDATE_DRAFT_DOCUMENT",
  VOID_DOCUMENT: "VOID_DOCUMENT",
  VIEW_CUSTOMERS: "VIEW_CUSTOMERS",
  MANAGE_CUSTOMERS: "MANAGE_CUSTOMERS",
  VIEW_ITEMS: "VIEW_ITEMS",
  MANAGE_ITEMS: "MANAGE_ITEMS",
  VIEW_RATES: "VIEW_RATES",
  MANAGE_RATES: "MANAGE_RATES",
  VIEW_VAULT: "VIEW_VAULT",
  VIEW_AUDIT_LOG: "VIEW_AUDIT_LOG",
  VIEW_SUBSCRIPTION: "VIEW_SUBSCRIPTION",
  MANAGE_SUBSCRIPTION: "MANAGE_SUBSCRIPTION",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const ALL_CAPABILITIES = Object.freeze(
  Object.values(CAPABILITIES),
) as readonly Capability[];

const roleCapabilities = {
  OWNER: ALL_CAPABILITIES,
  ADMIN: ALL_CAPABILITIES.filter(
    (capability) => capability !== CAPABILITIES.MANAGE_SUBSCRIPTION,
  ),
  MANAGER: [
    CAPABILITIES.VIEW_WORKSPACE,
    CAPABILITIES.VIEW_TEAM,
    CAPABILITIES.CREATE_DOCUMENT,
    CAPABILITIES.ISSUE_DOCUMENT,
    CAPABILITIES.VIEW_OWN_DOCUMENTS,
    CAPABILITIES.VIEW_ALL_DOCUMENTS,
    CAPABILITIES.UPDATE_DRAFT_DOCUMENT,
    CAPABILITIES.VIEW_CUSTOMERS,
    CAPABILITIES.MANAGE_CUSTOMERS,
    CAPABILITIES.VIEW_ITEMS,
    CAPABILITIES.MANAGE_ITEMS,
    CAPABILITIES.VIEW_RATES,
    CAPABILITIES.VIEW_VAULT,
  ],
  STAFF: [
    CAPABILITIES.VIEW_WORKSPACE,
    CAPABILITIES.CREATE_DOCUMENT,
    CAPABILITIES.VIEW_OWN_DOCUMENTS,
    CAPABILITIES.UPDATE_DRAFT_DOCUMENT,
    CAPABILITIES.VIEW_CUSTOMERS,
    CAPABILITIES.VIEW_ITEMS,
    CAPABILITIES.VIEW_RATES,
  ],
} as const satisfies Record<MembershipRole, readonly Capability[]>;

type MembershipWithRole = {
  role: MembershipRole;
};

export function getCapabilitiesForRole(
  role: MembershipRole,
): readonly Capability[] {
  return roleCapabilities[role];
}

export function hasCapability(
  membership: MembershipWithRole,
  capability: Capability,
) {
  return getCapabilitiesForRole(membership.role).includes(capability);
}

export type DocumentVisibility = "ALL" | "OWN" | "NONE";

export function getDocumentVisibility(
  membership: MembershipWithRole,
): DocumentVisibility {
  if (hasCapability(membership, CAPABILITIES.VIEW_ALL_DOCUMENTS)) {
    return "ALL";
  }

  if (hasCapability(membership, CAPABILITIES.VIEW_OWN_DOCUMENTS)) {
    return "OWN";
  }

  return "NONE";
}

type DocumentAccessContext = MembershipWithRole & {
  userId: string;
  workspaceId: string;
};

export function getDocumentAccessFilter(context: DocumentAccessContext) {
  const visibility = getDocumentVisibility(context);

  if (visibility === "ALL") {
    return { workspaceId: context.workspaceId };
  }

  if (visibility === "OWN") {
    return {
      workspaceId: context.workspaceId,
      createdByUserId: context.userId,
    };
  }

  return null;
}
