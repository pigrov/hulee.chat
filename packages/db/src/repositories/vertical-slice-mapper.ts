import type { PlatformEvent, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  Message,
  MvpTenantWorkspace,
  PersistConversationReplyInput,
  RegisteredTenant
} from "@hulee/core";

import {
  accounts as accountsTable,
  clients as clientsTable,
  conversationParticipants as conversationParticipantsTable,
  conversations as conversationsTable,
  employees as employeesTable,
  employeeRoles as employeeRolesTable,
  eventStore as eventStoreTable,
  messages as messagesTable,
  outbox as outboxTable,
  tenantBrandProfiles as tenantBrandProfilesTable,
  tenantEntitlements as tenantEntitlementsTable,
  tenantModules as tenantModulesTable,
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
type EmployeeRoleInsert = typeof employeeRolesTable.$inferInsert;
type ClientInsert = typeof clientsTable.$inferInsert;
type ConversationInsert = typeof conversationsTable.$inferInsert;
type ConversationParticipantInsert =
  typeof conversationParticipantsTable.$inferInsert;
type MessageInsert = typeof messagesTable.$inferInsert;
type EventStoreInsert = typeof eventStoreTable.$inferInsert;
type OutboxInsert = typeof outboxTable.$inferInsert;

export type WorkspacePersistenceRows = {
  tenants: TenantInsert[];
  tenantSettings: TenantSettingsInsert[];
  tenantBrandProfiles: TenantBrandProfileInsert[];
  tenantModules: TenantModuleInsert[];
  tenantEntitlements: TenantEntitlementInsert[];
  accounts: AccountInsert[];
  employees: EmployeeInsert[];
  employeeRoles: EmployeeRoleInsert[];
  clients: ClientInsert[];
  conversations: ConversationInsert[];
  conversationParticipants: ConversationParticipantInsert[];
  messages: MessageInsert[];
  eventStore: EventStoreInsert[];
  outbox: OutboxInsert[];
};

export type TenantRegistrationPersistenceRows = {
  tenants: TenantInsert[];
  tenantSettings: TenantSettingsInsert[];
  tenantBrandProfiles: TenantBrandProfileInsert[];
  tenantModules: TenantModuleInsert[];
  tenantEntitlements: TenantEntitlementInsert[];
  accounts: AccountInsert[];
  employees: EmployeeInsert[];
  employeeRoles: EmployeeRoleInsert[];
  eventStore: EventStoreInsert[];
  outbox: OutboxInsert[];
};

export type ReplyPersistenceRows = {
  messages: MessageInsert[];
  eventStore: EventStoreInsert[];
  outbox: OutboxInsert[];
};

export function mapWorkspaceToPersistenceRows(
  workspace: MvpTenantWorkspace
): WorkspacePersistenceRows {
  const createdAt = parseTimestamp(workspace.tenant.createdAt);
  const adminAccountId = `account:${workspace.admin.id}`;
  const rows: WorkspacePersistenceRows = {
    tenants: [
      {
        id: workspace.tenant.id,
        slug: workspace.tenant.slug,
        displayName: workspace.tenant.displayName,
        deploymentType: "saas_shared",
        createdAt,
        updatedAt: createdAt
      }
    ],
    tenantSettings: [
      {
        tenantId: workspace.tenant.id,
        locale: workspace.tenant.locale,
        timezone: workspace.tenant.timezone,
        settings: {
          licenseId: workspace.license.licenseId,
          deploymentId: workspace.license.deploymentId,
          issuer: workspace.license.issuer,
          validFrom: workspace.license.validFrom,
          validUntil: workspace.license.validUntil,
          offlineGraceUntil: workspace.license.offlineGraceUntil
        }
      }
    ],
    tenantBrandProfiles: [
      {
        id: workspace.brandProfile.id,
        tenantId: workspace.tenant.id,
        productName: workspace.brandProfile.productName,
        shortProductName: workspace.brandProfile.shortProductName,
        assets: workspace.brandProfile.assets,
        themeTokens: workspace.brandProfile.themeTokens,
        links: workspace.brandProfile.links ?? {},
        createdAt,
        updatedAt: createdAt
      }
    ],
    tenantModules: workspace.tenant.enabledModules.map((moduleId) => {
      return {
        tenantId: workspace.tenant.id,
        moduleId,
        enabled: true,
        config: workspace.tenant.moduleConfigs?.[moduleId] ?? {},
        diagnostics: {},
        createdAt,
        updatedAt: createdAt
      };
    }),
    tenantEntitlements: workspace.license.entitlements.map((entitlement) => {
      return {
        tenantId: workspace.tenant.id,
        key: entitlement.key,
        value: entitlement.value,
        enabled: entitlement.enabled,
        source: "license",
        createdAt,
        updatedAt: createdAt
      };
    }),
    accounts: [
      {
        id: adminAccountId,
        tenantId: workspace.tenant.id,
        email: workspace.admin.email,
        createdAt,
        updatedAt: createdAt
      }
    ],
    employees: [
      {
        id: workspace.admin.id,
        tenantId: workspace.tenant.id,
        accountId: adminAccountId,
        email: workspace.admin.email,
        displayName: workspace.admin.displayName,
        createdAt,
        updatedAt: createdAt
      }
    ],
    employeeRoles: workspace.admin.roles.map((role) => {
      return {
        tenantId: workspace.tenant.id,
        employeeId: workspace.admin.id,
        role,
        createdAt,
        updatedAt: createdAt
      };
    }),
    clients: [
      {
        id: workspace.client.id,
        tenantId: workspace.client.tenantId,
        displayName: workspace.client.displayName,
        source: workspace.client.source,
        responsibleEmployeeId: workspace.admin.id,
        createdAt: parseTimestamp(workspace.client.createdAt),
        updatedAt: parseTimestamp(workspace.client.createdAt)
      }
    ],
    conversations: [
      {
        id: workspace.conversation.id,
        tenantId: workspace.conversation.tenantId,
        type: workspace.conversation.type,
        clientId: workspace.conversation.clientId,
        status: "open",
        createdAt: parseTimestamp(workspace.conversation.createdAt),
        updatedAt: parseTimestamp(workspace.conversation.createdAt)
      }
    ],
    conversationParticipants: workspace.conversation.participantEmployeeIds.map(
      (employeeId) => {
        return {
          tenantId: workspace.conversation.tenantId,
          conversationId: workspace.conversation.id,
          employeeId,
          createdAt: parseTimestamp(workspace.conversation.createdAt),
          updatedAt: parseTimestamp(workspace.conversation.createdAt)
        };
      }
    ),
    messages: [mapMessage(workspace.inboundMessage)],
    eventStore: workspace.events.map(mapEventStoreRow),
    outbox: workspace.events.map(mapOutboxRow)
  };

  assertTenantScopedRows(
    workspace.tenant.id,
    collectWorkspaceTenantScopedRows(rows)
  );

  return rows;
}

export function mapTenantRegistrationToPersistenceRows(input: {
  registration: RegisteredTenant;
  adminPasswordHash: string;
}): TenantRegistrationPersistenceRows {
  const createdAt = parseTimestamp(input.registration.tenant.createdAt);
  const adminAccountId = `account:${input.registration.admin.id}`;
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
    tenantModules: input.registration.tenant.enabledModules.map((moduleId) => {
      return {
        tenantId: input.registration.tenant.id,
        moduleId,
        enabled: true,
        config: input.registration.tenant.moduleConfigs?.[moduleId] ?? {},
        diagnostics: {},
        createdAt,
        updatedAt: createdAt
      };
    }),
    tenantEntitlements: input.registration.license.entitlements.map(
      (entitlement) => {
        return {
          tenantId: input.registration.tenant.id,
          key: entitlement.key,
          value: entitlement.value,
          enabled: entitlement.enabled,
          source: "license",
          createdAt,
          updatedAt: createdAt
        };
      }
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
    employeeRoles: input.registration.admin.roles.map((role) => {
      return {
        tenantId: input.registration.tenant.id,
        employeeId: input.registration.admin.id,
        role,
        createdAt,
        updatedAt: createdAt
      };
    }),
    eventStore: input.registration.events.map(mapEventStoreRow),
    outbox: input.registration.events.map(mapOutboxRow)
  };

  assertTenantScopedRows(
    input.registration.tenant.id,
    collectTenantRegistrationTenantScopedRows(rows)
  );

  return rows;
}

export function mapReplyToPersistenceRows(
  input: PersistConversationReplyInput
): ReplyPersistenceRows {
  const rows: ReplyPersistenceRows = {
    messages: [mapMessage(input.message)],
    eventStore: input.events.map(mapEventStoreRow),
    outbox: input.events.map(mapOutboxRow)
  };

  assertTenantScopedRows(
    input.message.tenantId,
    collectReplyTenantScopedRows(rows)
  );

  return rows;
}

export function collectWorkspaceTenantScopedRows(
  rows: WorkspacePersistenceRows
): TenantScopedRow[] {
  return [
    ...rows.tenantSettings.map(requireTenantScope),
    ...rows.tenantBrandProfiles.map(requireTenantScope),
    ...rows.tenantModules.map(requireTenantScope),
    ...rows.tenantEntitlements.map(requireTenantScope),
    ...rows.accounts.map(requireTenantScope),
    ...rows.employees.map(requireTenantScope),
    ...rows.employeeRoles.map(requireTenantScope),
    ...rows.clients.map(requireTenantScope),
    ...rows.conversations.map(requireTenantScope),
    ...rows.conversationParticipants.map(requireTenantScope),
    ...rows.messages.map(requireTenantScope),
    ...rows.eventStore.map(requireTenantScope),
    ...rows.outbox.map(requireTenantScope)
  ];
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
    ...rows.employeeRoles.map(requireTenantScope),
    ...rows.eventStore.map(requireTenantScope),
    ...rows.outbox.map(requireTenantScope)
  ];
}

export function collectReplyTenantScopedRows(
  rows: ReplyPersistenceRows
): TenantScopedRow[] {
  return [
    ...rows.messages.map(requireTenantScope),
    ...rows.eventStore.map(requireTenantScope),
    ...rows.outbox.map(requireTenantScope)
  ];
}

function mapMessage(message: Message): MessageInsert {
  const createdAt = parseTimestamp(message.createdAt);

  return {
    id: message.id,
    tenantId: message.tenantId,
    conversationId: message.conversationId,
    direction: message.direction,
    text: message.text ?? null,
    status: message.status,
    idempotencyKey: message.idempotencyKey,
    createdAt,
    updatedAt: createdAt
  };
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
