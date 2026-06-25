import type { Permission } from "@hulee/core";
import type { I18nMessageKey } from "@hulee/i18n";

import {
  hasSessionPermissionCapability,
  navigationAccessFromSession,
  type WebAccessSession
} from "./access";
import {
  hasEffectivePermission,
  type WebEffectiveAccessSnapshot
} from "./rbac-effective-access";

export type TenantAdminSectionId =
  | "overview"
  | "employees"
  | "orgStructure"
  | "roles"
  | "audit"
  | "integrations"
  | "branding";

export type TenantAdminSection = {
  id: TenantAdminSectionId;
  href: string;
  titleKey: I18nMessageKey;
  descriptionKey: I18nMessageKey;
  requiredPermissions: readonly Permission[];
  permissionMode: "any" | "all";
};

export type TenantAdminAccessContext = {
  readonly session: WebAccessSession;
  readonly effectiveAccess?: WebEffectiveAccessSnapshot | undefined;
};

export type TenantAdminAccessInput =
  | WebAccessSession
  | TenantAdminAccessContext;

export const tenantAdminSections: readonly TenantAdminSection[] = [
  {
    id: "overview",
    href: "/admin",
    titleKey: "admin.overview",
    descriptionKey: "admin.overview.description",
    requiredPermissions: [
      "tenant.manage",
      "employees.manage",
      "modules.manage"
    ],
    permissionMode: "any"
  },
  {
    id: "employees",
    href: "/admin/employees",
    titleKey: "admin.employees",
    descriptionKey: "admin.employees.description",
    requiredPermissions: ["employees.manage"],
    permissionMode: "all"
  },
  {
    id: "orgStructure",
    href: "/admin/org-structure",
    titleKey: "admin.orgStructure",
    descriptionKey: "admin.orgStructure.description",
    requiredPermissions: ["employees.manage"],
    permissionMode: "all"
  },
  {
    id: "roles",
    href: "/admin/roles",
    titleKey: "admin.roles",
    descriptionKey: "admin.roles.description",
    requiredPermissions: ["roles.manage"],
    permissionMode: "all"
  },
  {
    id: "audit",
    href: "/admin/audit",
    titleKey: "admin.audit",
    descriptionKey: "admin.audit.description",
    requiredPermissions: ["audit.view"],
    permissionMode: "all"
  },
  {
    id: "integrations",
    href: "/admin/integrations",
    titleKey: "admin.integrations",
    descriptionKey: "admin.integrations.description",
    requiredPermissions: ["modules.manage"],
    permissionMode: "all"
  },
  {
    id: "branding",
    href: "/admin/branding",
    titleKey: "admin.branding",
    descriptionKey: "admin.branding.description",
    requiredPermissions: ["tenant.manage"],
    permissionMode: "all"
  }
];

const tenantAdminNavigationSections = tenantAdminSections.filter(
  (section) => section.id !== "overview"
);

export function getVisibleTenantAdminSections(
  access: TenantAdminAccessInput
): readonly TenantAdminSection[] {
  return tenantAdminNavigationSections.filter((section) =>
    canAccessTenantAdminSection(access, section)
  );
}

export function canAccessTenantAdminSection(
  access: TenantAdminAccessInput,
  section: TenantAdminSection
): boolean {
  if (section.permissionMode === "any") {
    return section.requiredPermissions.some((permission) =>
      hasTenantAdminPermission(access, permission)
    );
  }

  return section.requiredPermissions.every((permission) =>
    hasTenantAdminPermission(access, permission)
  );
}

export function navigationAccessFromTenantAdminAccess(
  access: TenantAdminAccessInput
): ReturnType<typeof navigationAccessFromSession> {
  const context = normalizeTenantAdminAccess(access);

  return {
    ...navigationAccessFromSession(context.session),
    tenantAdmin: getVisibleTenantAdminSections(access).length > 0
  };
}

function hasTenantAdminPermission(
  access: TenantAdminAccessInput,
  permission: Permission
): boolean {
  const context = normalizeTenantAdminAccess(access);

  if ("effectiveAccess" in context) {
    return hasEffectivePermission(context.effectiveAccess, permission);
  }

  return hasSessionPermissionCapability(context.session, permission);
}

function normalizeTenantAdminAccess(
  access: TenantAdminAccessInput
): TenantAdminAccessContext {
  if ("session" in access) {
    return access;
  }

  return {
    session: access
  };
}
