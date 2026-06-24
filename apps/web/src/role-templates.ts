import {
  allowedScopesForPermission,
  permissionCatalog,
  type Permission,
  type PermissionScopeType
} from "@hulee/core";
import type { I18nMessageKey } from "@hulee/i18n";

export const roleTemplateIds = [
  "tenant_admin",
  "supervisor",
  "lead_intake",
  "sales_representative",
  "sales_supervisor",
  "claims_agent",
  "measurement_specialist",
  "support_agent"
] as const;

export type RoleTemplateId = (typeof roleTemplateIds)[number];

export type RoleTemplateDefinition = {
  readonly id: RoleTemplateId;
  readonly nameKey: I18nMessageKey;
  readonly descriptionKey: I18nMessageKey;
  readonly permissions: readonly Permission[];
  readonly recommendedScopeType: PermissionScopeType;
};

export const roleTemplateCatalog = [
  {
    id: "tenant_admin",
    nameKey: "admin.roles.template.tenantAdmin.name",
    descriptionKey: "admin.roles.template.tenantAdmin.description",
    permissions: permissionCatalog.map((permission) => permission.id),
    recommendedScopeType: "tenant"
  },
  {
    id: "supervisor",
    nameKey: "admin.roles.template.supervisor.name",
    descriptionKey: "admin.roles.template.supervisor.description",
    permissions: [
      "employees.manage",
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
      "client.contacts.edit",
      "files.view",
      "files.upload",
      "reports.view",
      "audit.view"
    ],
    recommendedScopeType: "org_unit"
  },
  {
    id: "lead_intake",
    nameKey: "admin.roles.template.leadIntake.name",
    descriptionKey: "admin.roles.template.leadIntake.description",
    permissions: [
      "inbox.read",
      "conversation.read",
      "conversation.assign",
      "lead.classify",
      "lead.qualify",
      "lead.assign",
      "client.view",
      "client.edit",
      "client.contacts.view"
    ],
    recommendedScopeType: "queue"
  },
  {
    id: "sales_representative",
    nameKey: "admin.roles.template.salesRepresentative.name",
    descriptionKey: "admin.roles.template.salesRepresentative.description",
    permissions: [
      "inbox.read",
      "conversation.read",
      "message.reply",
      "conversation.close",
      "lead.qualify",
      "client.view",
      "client.edit",
      "client.contacts.view",
      "client.contacts.edit",
      "files.view",
      "files.upload"
    ],
    recommendedScopeType: "assigned"
  },
  {
    id: "sales_supervisor",
    nameKey: "admin.roles.template.salesSupervisor.name",
    descriptionKey: "admin.roles.template.salesSupervisor.description",
    permissions: [
      "inbox.read",
      "conversation.read",
      "message.reply",
      "conversation.assign",
      "conversation.close",
      "conversation.reopen",
      "lead.qualify",
      "lead.assign",
      "client.view",
      "client.edit",
      "client.contacts.view",
      "client.contacts.edit",
      "files.view",
      "files.upload",
      "reports.view"
    ],
    recommendedScopeType: "org_unit"
  },
  {
    id: "claims_agent",
    nameKey: "admin.roles.template.claimsAgent.name",
    descriptionKey: "admin.roles.template.claimsAgent.description",
    permissions: [
      "inbox.read",
      "conversation.read",
      "message.reply",
      "conversation.close",
      "conversation.reopen",
      "client.view",
      "client.contacts.view",
      "files.view",
      "files.upload"
    ],
    recommendedScopeType: "queue"
  },
  {
    id: "measurement_specialist",
    nameKey: "admin.roles.template.measurementSpecialist.name",
    descriptionKey: "admin.roles.template.measurementSpecialist.description",
    permissions: [
      "inbox.read",
      "conversation.read",
      "message.reply",
      "client.view",
      "client.edit",
      "client.contacts.view",
      "files.view",
      "files.upload"
    ],
    recommendedScopeType: "assigned"
  },
  {
    id: "support_agent",
    nameKey: "admin.roles.template.supportAgent.name",
    descriptionKey: "admin.roles.template.supportAgent.description",
    permissions: [
      "inbox.read",
      "conversation.read",
      "message.reply",
      "conversation.close",
      "conversation.reopen",
      "client.view",
      "client.contacts.view",
      "files.view",
      "files.upload"
    ],
    recommendedScopeType: "queue"
  }
] as const satisfies readonly RoleTemplateDefinition[];

export function findRoleTemplate(
  templateId: string
): RoleTemplateDefinition | undefined {
  return roleTemplateCatalog.find((template) => template.id === templateId);
}

export function roleTemplatePermissionsFitRecommendedScope(
  template: RoleTemplateDefinition
): boolean {
  return template.permissions.every((permission) =>
    allowedScopesForPermission(permission).includes(
      template.recommendedScopeType
    )
  );
}

export function uniqueRoleTemplateName(
  existingNames: readonly string[],
  baseName: string
): string {
  const normalizedNames = new Set(
    existingNames.map((name) => name.trim().toLocaleLowerCase())
  );
  const normalizedBaseName = baseName.trim();

  if (!normalizedNames.has(normalizedBaseName.toLocaleLowerCase())) {
    return normalizedBaseName;
  }

  for (let index = 2; index <= 99; index += 1) {
    const suffix = ` (${index})`;
    const candidate = `${normalizedBaseName.slice(0, 80 - suffix.length).trimEnd()}${suffix}`;

    if (!normalizedNames.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }

  throw new Error("No available role template name.");
}
