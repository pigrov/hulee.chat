import type { Permission } from "@hulee/core";
import type { I18nMessageKey } from "@hulee/i18n";

import { canTenantPermission, type WebAccessSession } from "./access";

export type TenantAdminSectionId =
  | "overview"
  | "employees"
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

export function getVisibleTenantAdminSections(
  access: WebAccessSession
): readonly TenantAdminSection[] {
  return tenantAdminSections.filter((section) =>
    canAccessTenantAdminSection(access, section)
  );
}

export function canAccessTenantAdminSection(
  access: WebAccessSession,
  section: TenantAdminSection
): boolean {
  if (section.permissionMode === "any") {
    return section.requiredPermissions.some((permission) =>
      canTenantPermission(access, permission)
    );
  }

  return section.requiredPermissions.every((permission) =>
    canTenantPermission(access, permission)
  );
}
