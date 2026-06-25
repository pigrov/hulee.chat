import type { EmployeeId, TenantId } from "@hulee/contracts";

import { CoreError } from "./errors";

export type SystemRoleTemplateId = "tenant_admin" | "supervisor" | "agent";

export const permissionScopeTypes = [
  "tenant",
  "org_unit",
  "team",
  "queue",
  "assigned",
  "own",
  "client",
  "conversation"
] as const;

export type PermissionScopeType = (typeof permissionScopeTypes)[number];

type PermissionScopeTypeWithoutReference = "tenant" | "assigned" | "own";
type PermissionScopeTypeWithReference = Exclude<
  PermissionScopeType,
  PermissionScopeTypeWithoutReference
>;

export type PermissionScope =
  | {
      readonly type: PermissionScopeTypeWithoutReference;
    }
  | {
      readonly type: PermissionScopeTypeWithReference;
      readonly id: string;
    };

export type PermissionDomain =
  | "tenant"
  | "employees"
  | "roles"
  | "integrations"
  | "branding"
  | "inbox"
  | "messages"
  | "conversations"
  | "clients"
  | "leads"
  | "files"
  | "reports"
  | "audit"
  | "api";

type PermissionCatalogEntry = {
  readonly id: string;
  readonly domain: PermissionDomain;
  readonly allowedScopes: readonly PermissionScopeType[];
};

export const permissionCatalog = [
  {
    id: "tenant.manage",
    domain: "tenant",
    allowedScopes: ["tenant"]
  },
  {
    id: "employees.manage",
    domain: "employees",
    allowedScopes: ["tenant", "org_unit", "team"]
  },
  {
    id: "roles.manage",
    domain: "roles",
    allowedScopes: ["tenant", "org_unit", "team", "queue"]
  },
  {
    id: "modules.manage",
    domain: "integrations",
    allowedScopes: ["tenant"]
  },
  {
    id: "integrations.manage",
    domain: "integrations",
    allowedScopes: ["tenant"]
  },
  {
    id: "branding.manage",
    domain: "branding",
    allowedScopes: ["tenant"]
  },
  {
    id: "inbox.read",
    domain: "inbox",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "own",
      "client",
      "conversation"
    ]
  },
  {
    id: "message.reply",
    domain: "messages",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "client",
      "conversation"
    ]
  },
  {
    id: "client.view",
    domain: "clients",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "own",
      "client"
    ]
  },
  {
    id: "client.edit",
    domain: "clients",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "own",
      "client"
    ]
  },
  {
    id: "client.contacts.view",
    domain: "clients",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "own",
      "client"
    ]
  },
  {
    id: "client.contacts.edit",
    domain: "clients",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "own",
      "client"
    ]
  },
  {
    id: "conversation.read",
    domain: "conversations",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "own",
      "client",
      "conversation"
    ]
  },
  {
    id: "conversation.assign",
    domain: "conversations",
    allowedScopes: ["tenant", "org_unit", "team", "queue"]
  },
  {
    id: "conversation.close",
    domain: "conversations",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "conversation"
    ]
  },
  {
    id: "conversation.reopen",
    domain: "conversations",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "conversation"
    ]
  },
  {
    id: "lead.classify",
    domain: "leads",
    allowedScopes: ["tenant", "org_unit", "team", "queue", "assigned"]
  },
  {
    id: "lead.qualify",
    domain: "leads",
    allowedScopes: ["tenant", "org_unit", "team", "queue", "assigned"]
  },
  {
    id: "lead.assign",
    domain: "leads",
    allowedScopes: ["tenant", "org_unit", "team", "queue"]
  },
  {
    id: "files.view",
    domain: "files",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "client",
      "conversation"
    ]
  },
  {
    id: "files.upload",
    domain: "files",
    allowedScopes: [
      "tenant",
      "org_unit",
      "team",
      "queue",
      "assigned",
      "client",
      "conversation"
    ]
  },
  {
    id: "reports.view",
    domain: "reports",
    allowedScopes: ["tenant", "org_unit", "team", "queue"]
  },
  {
    id: "audit.view",
    domain: "audit",
    allowedScopes: ["tenant", "org_unit", "team", "queue"]
  },
  {
    id: "api_keys.manage",
    domain: "api",
    allowedScopes: ["tenant"]
  },
  {
    id: "webhooks.manage",
    domain: "api",
    allowedScopes: ["tenant"]
  }
] as const satisfies readonly PermissionCatalogEntry[];

export type Permission = (typeof permissionCatalog)[number]["id"];

export type PermissionDefinition = (typeof permissionCatalog)[number];

const systemRoleTemplateIds = ["tenant_admin", "supervisor", "agent"] as const;
const permissions = permissionCatalog.map(
  ({ id }) => id
) as readonly Permission[];
const permissionById = new Map<Permission, PermissionDefinition>(
  permissionCatalog.map((definition) => [definition.id, definition])
);
const scopeTypesWithoutReference = [
  "tenant",
  "assigned",
  "own"
] as const satisfies readonly PermissionScopeType[];

const systemRoleTemplatePermissions: Record<
  SystemRoleTemplateId,
  readonly Permission[]
> = {
  tenant_admin: permissions,
  supervisor: [
    "inbox.read",
    "conversation.read",
    "message.reply",
    "conversation.assign",
    "conversation.close",
    "conversation.reopen",
    "lead.classify",
    "lead.qualify",
    "lead.assign",
    "client.view",
    "client.edit",
    "client.contacts.view",
    "files.view",
    "files.upload",
    "reports.view"
  ],
  agent: [
    "inbox.read",
    "conversation.read",
    "message.reply",
    "conversation.close",
    "lead.classify",
    "lead.qualify",
    "client.view",
    "client.edit",
    "client.contacts.view",
    "files.view",
    "files.upload"
  ]
};

export type Employee = {
  id: EmployeeId;
  tenantId: TenantId;
  email: string;
  displayName: string;
  systemRoleTemplateIds: readonly SystemRoleTemplateId[];
  createdAt: string;
  deactivatedAt?: string;
};

export function isSystemRoleTemplateId(
  value: string
): value is SystemRoleTemplateId {
  return systemRoleTemplateIds.includes(value as SystemRoleTemplateId);
}

export function isPermission(value: string): value is Permission {
  return permissionById.has(value as Permission);
}

export function isPermissionScopeType(
  value: string
): value is PermissionScopeType {
  return permissionScopeTypes.includes(value as PermissionScopeType);
}

export function isPermissionScope(value: unknown): value is PermissionScope {
  if (!isRecord(value)) {
    return false;
  }

  const type = value.type;
  if (typeof type !== "string" || !isPermissionScopeType(type)) {
    return false;
  }

  if (isScopeTypeWithoutReference(type)) {
    return typeof value.id === "undefined";
  }

  return typeof value.id === "string" && value.id.trim().length > 0;
}

export function getPermissionDefinition(
  permission: Permission
): PermissionDefinition {
  const definition = permissionById.get(permission);
  if (!definition) {
    throw new CoreError("validation.failed");
  }

  return definition;
}

export function allowedScopesForPermission(
  permission: Permission
): readonly PermissionScopeType[] {
  return getPermissionDefinition(permission).allowedScopes;
}

export function allowedScopeTypesForPermissions(
  permissions: readonly Permission[]
): readonly PermissionScopeType[] {
  if (permissions.length === 0) {
    return [];
  }

  return permissionScopeTypes.filter((scopeType) =>
    permissions.every((permission) =>
      isPermissionScopeAllowed(permission, scopeType)
    )
  );
}

export function isPermissionScopeAllowed(
  permission: Permission,
  scopeType: PermissionScopeType
): boolean {
  return allowedScopesForPermission(permission).includes(scopeType);
}

export function arePermissionsAllowedForScope(
  permissions: readonly Permission[],
  scopeType: PermissionScopeType
): boolean {
  return permissions.every((permission) =>
    isPermissionScopeAllowed(permission, scopeType)
  );
}

export function assertPermissionScopeAllowed(
  permission: Permission,
  scopeType: PermissionScopeType
): void {
  if (!isPermissionScopeAllowed(permission, scopeType)) {
    throw new CoreError("validation.failed");
  }
}

export function assertPermissionsAllowedForScope(
  permissions: readonly Permission[],
  scopeType: PermissionScopeType
): void {
  if (
    permissions.length === 0 ||
    !arePermissionsAllowedForScope(permissions, scopeType)
  ) {
    throw new CoreError("validation.failed");
  }
}

export function permissionScopeRequiresReference(
  scopeType: PermissionScopeType
): boolean {
  return !isScopeTypeWithoutReference(scopeType);
}

export function normalizePermissionScope(input: {
  readonly type: string;
  readonly id?: string | null;
}): PermissionScope {
  if (!isPermissionScopeType(input.type)) {
    throw new CoreError("validation.failed");
  }

  const normalizedId = input.id?.trim() ?? "";

  if (isScopeTypeWithoutReference(input.type)) {
    if (normalizedId.length > 0) {
      throw new CoreError("validation.failed");
    }

    return {
      type: input.type
    };
  }

  if (normalizedId.length === 0) {
    throw new CoreError("validation.failed");
  }

  return {
    type: input.type,
    id: normalizedId
  };
}

export function permissionsForSystemRoleTemplates(
  templateIds: readonly SystemRoleTemplateId[]
): readonly Permission[] {
  const result = new Set<Permission>();

  for (const templateId of templateIds) {
    for (const permission of systemRoleTemplatePermissions[templateId]) {
      result.add(permission);
    }
  }

  return [...result];
}

export function hasPermission(
  employee: Employee,
  permission: Permission
): boolean {
  return employee.systemRoleTemplateIds.some((templateId) =>
    systemRoleTemplatePermissions[templateId].includes(permission)
  );
}

export function assertEmployeeCan(
  employee: Employee,
  permission: Permission
): void {
  if (!hasPermission(employee, permission)) {
    throw new CoreError("permission.denied");
  }
}

function isScopeTypeWithoutReference(
  value: PermissionScopeType
): value is PermissionScopeTypeWithoutReference {
  return scopeTypesWithoutReference.includes(
    value as PermissionScopeTypeWithoutReference
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
