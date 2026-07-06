import {
  getPermissionDefinition,
  permissionCatalog,
  type Permission,
  type PermissionDomain,
  type PermissionScopeType
} from "@hulee/core";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";

type Translator = ReturnType<typeof createTranslator>["t"];

export type PermissionDomainSummary = {
  readonly domain: PermissionDomain;
  readonly permissions: readonly Permission[];
};

const permissionDomainOrder = [
  "tenant",
  "employees",
  "roles",
  "integrations",
  "branding",
  "inbox",
  "messages",
  "conversations",
  "clients",
  "leads",
  "files",
  "reports",
  "audit",
  "api"
] as const satisfies readonly PermissionDomain[];

export function summarizePermissionCatalogDomains(): readonly PermissionDomainSummary[] {
  return summarizePermissionDomains(permissionCatalog.map(({ id }) => id));
}

export function summarizePermissionDomains(
  permissions: readonly Permission[]
): readonly PermissionDomainSummary[] {
  const permissionsByDomain = new Map<PermissionDomain, Permission[]>();

  for (const permission of permissions) {
    const definition = getPermissionDefinition(permission);
    const domainPermissions = permissionsByDomain.get(definition.domain) ?? [];

    permissionsByDomain.set(definition.domain, [
      ...domainPermissions,
      permission
    ]);
  }

  return permissionDomainOrder.flatMap((domain) => {
    const domainPermissions = permissionsByDomain.get(domain);

    return domainPermissions
      ? [
          {
            domain,
            permissions: domainPermissions
          }
        ]
      : [];
  });
}

export function allowedPermissionScopesText(
  permission: Permission,
  t: Translator
): string {
  return getPermissionDefinition(permission)
    .allowedScopes.map((scopeType) => t(permissionScopeTypeKey(scopeType)))
    .join(", ");
}

export function permissionDescriptionKey(
  permission: Permission
): I18nMessageKey {
  switch (permission) {
    case "tenant.manage":
      return "permission.description.tenant.manage";
    case "employees.manage":
      return "permission.description.employees.manage";
    case "roles.manage":
      return "permission.description.roles.manage";
    case "modules.manage":
      return "permission.description.modules.manage";
    case "integrations.manage":
      return "permission.description.integrations.manage";
    case "branding.manage":
      return "permission.description.branding.manage";
    case "inbox.read":
      return "permission.description.inbox.read";
    case "message.reply":
      return "permission.description.message.reply";
    case "client.view":
      return "permission.description.client.view";
    case "client.edit":
      return "permission.description.client.edit";
    case "client.contacts.view":
      return "permission.description.client.contacts.view";
    case "client.contacts.edit":
      return "permission.description.client.contacts.edit";
    case "conversation.read":
      return "permission.description.conversation.read";
    case "conversation.assign":
      return "permission.description.conversation.assign";
    case "conversation.close":
      return "permission.description.conversation.close";
    case "conversation.reopen":
      return "permission.description.conversation.reopen";
    case "lead.classify":
      return "permission.description.lead.classify";
    case "lead.qualify":
      return "permission.description.lead.qualify";
    case "lead.assign":
      return "permission.description.lead.assign";
    case "files.view":
      return "permission.description.files.view";
    case "files.upload":
      return "permission.description.files.upload";
    case "reports.view":
      return "permission.description.reports.view";
    case "audit.view":
      return "permission.description.audit.view";
    case "api_keys.manage":
      return "permission.description.api_keys.manage";
    case "webhooks.manage":
      return "permission.description.webhooks.manage";
  }
}

export function permissionScopeTypeKey(
  scopeType: PermissionScopeType
): I18nMessageKey {
  switch (scopeType) {
    case "tenant":
      return "admin.roles.scope.tenant";
    case "org_unit":
      return "admin.roles.scope.orgUnit";
    case "team":
      return "admin.roles.scope.team";
    case "queue":
      return "admin.roles.scope.queue";
    case "assigned":
      return "admin.roles.scope.assigned";
    case "own":
      return "admin.roles.scope.own";
    case "client":
      return "admin.roles.scope.client";
    case "conversation":
      return "admin.roles.scope.conversation";
  }
}

export function permissionDomainKey(domain: PermissionDomain): I18nMessageKey {
  switch (domain) {
    case "tenant":
      return "permission.domain.tenant";
    case "employees":
      return "permission.domain.employees";
    case "roles":
      return "permission.domain.roles";
    case "integrations":
      return "permission.domain.integrations";
    case "branding":
      return "permission.domain.branding";
    case "inbox":
      return "permission.domain.inbox";
    case "messages":
      return "permission.domain.messages";
    case "conversations":
      return "permission.domain.conversations";
    case "clients":
      return "permission.domain.clients";
    case "leads":
      return "permission.domain.leads";
    case "files":
      return "permission.domain.files";
    case "reports":
      return "permission.domain.reports";
    case "audit":
      return "permission.domain.audit";
    case "api":
      return "permission.domain.api";
  }
}
