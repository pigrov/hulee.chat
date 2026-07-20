import type { PlatformEvent, TenantId } from "@hulee/contracts";
import {
  CoreError,
  permissionsForSystemRoleTemplates,
  type PersistTenantRegistrationInput,
  type SystemRoleTemplateId
} from "@hulee/core";

import {
  accounts as accountsTable,
  employees as employeesTable,
  eventStore as eventStoreTable,
  outbox as outboxTable,
  tenantBrandProfiles as tenantBrandProfilesTable,
  tenantEntitlements as tenantEntitlementsTable,
  tenantModules as tenantModulesTable,
  tenantRoleBindings as tenantRoleBindingsTable,
  tenantRolePermissions as tenantRolePermissionsTable,
  tenantRoles as tenantRolesTable,
  tenantSettings as tenantSettingsTable,
  tenants as tenantsTable
} from "../schema/tables";
import { assertTenantScopedRows, type TenantScopedRow } from "./tenant-scope";

type TenantInsert = typeof tenantsTable.$inferInsert;
type TenantSettingsInsert = typeof tenantSettingsTable.$inferInsert;
type TenantBrandProfileInsert = typeof tenantBrandProfilesTable.$inferInsert;
type TenantModuleInsert = typeof tenantModulesTable.$inferInsert;
type TenantEntitlementInsert = typeof tenantEntitlementsTable.$inferInsert;
type AccountInsert = typeof accountsTable.$inferInsert;
type EmployeeInsert = typeof employeesTable.$inferInsert;
type TenantRoleInsert = typeof tenantRolesTable.$inferInsert;
type TenantRolePermissionInsert =
  typeof tenantRolePermissionsTable.$inferInsert;
type TenantRoleBindingInsert = typeof tenantRoleBindingsTable.$inferInsert;
type EventStoreInsert = typeof eventStoreTable.$inferInsert;
type OutboxInsert = typeof outboxTable.$inferInsert;

export type TenantRegistrationPersistenceRows = {
  tenants: TenantInsert[];
  tenantSettings: TenantSettingsInsert[];
  tenantBrandProfiles: TenantBrandProfileInsert[];
  tenantModules: TenantModuleInsert[];
  tenantEntitlements: TenantEntitlementInsert[];
  accounts: AccountInsert[];
  employees: EmployeeInsert[];
  tenantRoles: TenantRoleInsert[];
  tenantRolePermissions: TenantRolePermissionInsert[];
  tenantRoleBindings: TenantRoleBindingInsert[];
  eventStore: EventStoreInsert[];
  outbox: OutboxInsert[];
};

export function mapTenantRegistrationToPersistenceRows(
  input: PersistTenantRegistrationInput
): TenantRegistrationPersistenceRows {
  const createdAt = parseTimestamp(input.registration.tenant.createdAt);
  const adminAccountId = `account:${input.registration.admin.id}`;
  const tenantRbacRows = mapSystemRoleTemplatesToTenantRbacRows({
    tenantId: input.registration.tenant.id,
    employeeId: input.registration.admin.id,
    templateIds: input.registration.admin.systemRoleTemplateIds,
    createdAt
  });
  const rows: TenantRegistrationPersistenceRows = {
    tenants: [
      {
        id: input.registration.tenant.id,
        slug: input.registration.tenant.slug,
        displayName: input.registration.tenant.displayName,
        deploymentType: "saas_shared",
        createdAt,
        updatedAt: createdAt
      }
    ],
    tenantSettings: [
      {
        tenantId: input.registration.tenant.id,
        locale: input.registration.tenant.locale,
        timezone: input.registration.tenant.timezone,
        settings: {
          licenseId: input.registration.license.licenseId,
          deploymentId: input.registration.license.deploymentId,
          issuer: input.registration.license.issuer,
          validFrom: input.registration.license.validFrom,
          validUntil: input.registration.license.validUntil,
          offlineGraceUntil: input.registration.license.offlineGraceUntil
        }
      }
    ],
    tenantBrandProfiles: [
      {
        id: input.registration.brandProfile.id,
        tenantId: input.registration.tenant.id,
        productName: input.registration.brandProfile.productName,
        shortProductName: input.registration.brandProfile.shortProductName,
        assets: input.registration.brandProfile.assets,
        themeTokens: input.registration.brandProfile.themeTokens,
        links: input.registration.brandProfile.links ?? {},
        createdAt,
        updatedAt: createdAt
      }
    ],
    tenantModules: input.registration.tenant.enabledModules.map((moduleId) => ({
      tenantId: input.registration.tenant.id,
      moduleId,
      enabled: true,
      config: input.registration.tenant.moduleConfigs?.[moduleId] ?? {},
      diagnostics: {},
      createdAt,
      updatedAt: createdAt
    })),
    tenantEntitlements: input.registration.license.entitlements.map(
      (entitlement) => ({
        tenantId: input.registration.tenant.id,
        key: entitlement.key,
        value: entitlement.value,
        enabled: entitlement.enabled,
        source: "license",
        createdAt,
        updatedAt: createdAt
      })
    ),
    accounts: [
      {
        id: adminAccountId,
        tenantId: input.registration.tenant.id,
        email: input.registration.admin.email,
        passwordHash: input.adminPasswordHash,
        emailVerifiedAt: null,
        createdAt,
        updatedAt: createdAt
      }
    ],
    employees: [
      {
        id: input.registration.admin.id,
        tenantId: input.registration.tenant.id,
        accountId: adminAccountId,
        email: input.registration.admin.email,
        displayName: input.registration.admin.displayName,
        createdAt,
        updatedAt: createdAt
      }
    ],
    tenantRoles: tenantRbacRows.tenantRoles,
    tenantRolePermissions: tenantRbacRows.tenantRolePermissions,
    tenantRoleBindings: tenantRbacRows.tenantRoleBindings,
    eventStore: input.registration.events.map(mapEventStoreRow),
    outbox: input.registration.events.map(mapOutboxRow)
  };

  assertTenantScopedRows(
    input.registration.tenant.id,
    collectTenantRegistrationTenantScopedRows(rows)
  );

  return rows;
}

export function collectTenantRegistrationTenantScopedRows(
  rows: TenantRegistrationPersistenceRows
): TenantScopedRow[] {
  return [
    ...rows.tenantSettings.map(requireTenantScope),
    ...rows.tenantBrandProfiles.map(requireTenantScope),
    ...rows.tenantModules.map(requireTenantScope),
    ...rows.tenantEntitlements.map(requireTenantScope),
    ...rows.accounts.map(requireTenantScope),
    ...rows.employees.map(requireTenantScope),
    ...rows.tenantRoles.map(requireTenantScope),
    ...rows.tenantRolePermissions.map(requireTenantScope),
    ...rows.tenantRoleBindings.map(requireTenantScope),
    ...rows.eventStore.map(requireTenantScope),
    ...rows.outbox.map(requireTenantScope)
  ];
}

function mapEventStoreRow(event: PlatformEvent): EventStoreInsert {
  const occurredAt = parseTimestamp(event.occurredAt);

  return {
    id: event.id,
    tenantId: event.tenantId,
    type: event.type,
    version: event.version,
    occurredAt,
    idempotencyKey: event.idempotencyKey,
    payload: event.payload,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
}

function mapOutboxRow(event: PlatformEvent): OutboxInsert {
  const occurredAt = parseTimestamp(event.occurredAt);

  return {
    id: `outbox:${event.id}`,
    tenantId: event.tenantId,
    eventId: event.id,
    status: "pending",
    attempts: 0,
    payload: event,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
}

function mapSystemRoleTemplatesToTenantRbacRows(input: {
  tenantId: TenantId;
  employeeId: string;
  templateIds: readonly SystemRoleTemplateId[];
  createdAt: Date;
}): {
  tenantRoles: TenantRoleInsert[];
  tenantRolePermissions: TenantRolePermissionInsert[];
  tenantRoleBindings: TenantRoleBindingInsert[];
} {
  const templateIds = [...new Set(input.templateIds)];

  return {
    tenantRoles: templateIds.map((templateId) => ({
      id: tenantRoleId(input.tenantId, templateId),
      tenantId: input.tenantId,
      name: tenantRoleName(templateId),
      description: `System compatibility role for ${templateId}.`,
      status: "active",
      isSystem: true,
      createdByEmployeeId: null,
      archivedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    })),
    tenantRolePermissions: templateIds.flatMap((templateId) =>
      permissionsForSystemRoleTemplates([templateId]).map((permission) => ({
        tenantId: input.tenantId,
        roleId: tenantRoleId(input.tenantId, templateId),
        permission,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      }))
    ),
    tenantRoleBindings: templateIds.map((templateId) => ({
      id: `role_binding:${input.tenantId}:${input.employeeId}:${templateId}:tenant`,
      tenantId: input.tenantId,
      roleId: tenantRoleId(input.tenantId, templateId),
      subjectType: "employee",
      subjectId: input.employeeId,
      scopeType: "tenant",
      scopeId: null,
      createdByEmployeeId: null,
      startsAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    }))
  };
}

function tenantRoleId(
  tenantId: TenantId,
  templateId: SystemRoleTemplateId
): string {
  return `role:${tenantId}:${templateId}`;
}

function tenantRoleName(templateId: SystemRoleTemplateId): string {
  switch (templateId) {
    case "tenant_admin":
      return "Tenant admin";
    case "supervisor":
      return "Supervisor";
    case "agent":
      return "Agent";
  }
}

function requireTenantScope(row: {
  tenantId?: TenantId | string | null;
}): TenantScopedRow {
  if (!row.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  return { tenantId: row.tenantId };
}

function parseTimestamp(value: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new CoreError("validation.failed", `Invalid timestamp: ${value}`);
  }

  return parsed;
}
