import type { PermissionScope } from "@hulee/core";
import type { TenantRoleRecord } from "@hulee/db";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";

import { permissionScopeTypeKey } from "./rbac-permission-display";
import type { ScopePickerMessages } from "./rbac-scope-picker";

type Translator = ReturnType<typeof createTranslator>["t"];

export function roleName(role: TenantRoleRecord, t: Translator): string {
  const roleLabelKey = role.isSystem ? fixedRoleLabelKey(role.id) : undefined;

  return roleLabelKey ? t(roleLabelKey) : role.name;
}

export function roleNameById(
  roleId: string,
  roles: readonly TenantRoleRecord[],
  t: Translator
): string {
  const role = roles.find((candidate) => candidate.id === roleId);

  return role === undefined ? roleId : roleName(role, t);
}

export function scopeValue(scope: PermissionScope, t: Translator): string {
  if (scope.type === "tenant") {
    return t("admin.roles.scope.tenant");
  }

  return "id" in scope
    ? `${t(permissionScopeTypeKey(scope.type))}:${scope.id}`
    : t(permissionScopeTypeKey(scope.type));
}

export function permissionScopeKey(scope: PermissionScope): string {
  return "id" in scope ? `${scope.type}:${scope.id}` : scope.type;
}

export function scopePickerMessages(t: Translator): ScopePickerMessages {
  return {
    employee: t("admin.roles.employee"),
    expiresAt: t("admin.roles.directGrantExpiresAtInput"),
    permission: t("admin.roles.permission"),
    reason: t("admin.roles.directGrantReasonInput"),
    reasonPlaceholder: t("admin.roles.directGrantReason.placeholder"),
    role: t("admin.roles.role"),
    subjectReference: t("admin.roles.subjectReference"),
    subjectType: t("admin.roles.subjectType"),
    scopeType: t("admin.roles.scopeType"),
    scopeReference: t("admin.roles.scopeReference"),
    scopeReferenceDescription: t("admin.roles.scopeReference.description"),
    scopeReferenceManualDescription: t(
      "admin.roles.scopeReference.manualDescription"
    ),
    scopeReferenceNotRequired: t("admin.roles.scopeReference.notRequired"),
    scopeReferencePlaceholder: t("admin.roles.scopeReference.placeholder"),
    scopeUnavailable: t("admin.roles.scopeUnavailable"),
    selectEmployee: t("admin.roles.selectEmployee"),
    selectPermission: t("admin.roles.selectPermission"),
    selectRole: t("admin.roles.selectRole"),
    selectSubject: t("admin.roles.selectSubject"),
    subjectLabels: {
      employee: t("admin.roles.subject.employee"),
      org_unit: t("admin.roles.subject.orgUnit"),
      team: t("admin.roles.subject.team"),
      queue: t("admin.roles.subject.queue")
    },
    scopeLabels: {
      tenant: t("admin.roles.scope.tenant"),
      org_unit: t("admin.roles.scope.orgUnit"),
      team: t("admin.roles.scope.team"),
      queue: t("admin.roles.scope.queue"),
      assigned: t("admin.roles.scope.assigned"),
      own: t("admin.roles.scope.own"),
      client: t("admin.roles.scope.client"),
      conversation: t("admin.roles.scope.conversation")
    }
  };
}

function fixedRoleLabelKey(roleId: string): I18nMessageKey | undefined {
  const segments = roleId.split(":");
  const role = segments[segments.length - 1];

  switch (role) {
    case "tenant_admin":
      return "admin.employees.role.tenantAdmin";
    case "supervisor":
      return "admin.employees.role.supervisor";
    case "agent":
      return "admin.employees.role.agent";
    default:
      return undefined;
  }
}
