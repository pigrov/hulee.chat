import type {
  MvpTenantWorkspace,
  PersistConversationReplyInput,
  TenantWorkspaceRepository
} from "@hulee/core";

import {
  accounts,
  clients,
  conversationParticipants,
  conversations,
  employees,
  eventStore,
  messages,
  outbox,
  tenantRoleBindings,
  tenantRolePermissions,
  tenantRoles,
  tenantBrandProfiles,
  tenantEntitlements,
  tenantModules,
  tenantSettings,
  tenants
} from "../schema/tables";
import type { PersistenceExecutor } from "./persistence-executor";
import { tableRef } from "./persistence-executor";
import { createTenantRegistrationRepository } from "./drizzle-tenant-registration-repository";
import {
  mapReplyToPersistenceRows,
  mapWorkspaceToPersistenceRows
} from "./vertical-slice-mapper";

const tableRefs = {
  tenants: tableRef("tenants", tenants),
  tenantSettings: tableRef("tenant_settings", tenantSettings),
  tenantBrandProfiles: tableRef("tenant_brand_profiles", tenantBrandProfiles),
  tenantModules: tableRef("tenant_modules", tenantModules),
  tenantEntitlements: tableRef("tenant_entitlements", tenantEntitlements),
  accounts: tableRef("accounts", accounts),
  employees: tableRef("employees", employees),
  tenantRoles: tableRef("tenant_roles", tenantRoles),
  tenantRolePermissions: tableRef(
    "tenant_role_permissions",
    tenantRolePermissions
  ),
  tenantRoleBindings: tableRef("tenant_role_bindings", tenantRoleBindings),
  clients: tableRef("clients", clients),
  conversations: tableRef("conversations", conversations),
  conversationParticipants: tableRef(
    "conversation_participants",
    conversationParticipants
  ),
  messages: tableRef("messages", messages),
  eventStore: tableRef("event_store", eventStore),
  outbox: tableRef("outbox", outbox)
};

export function createTenantWorkspaceRepository(
  executor: PersistenceExecutor
): TenantWorkspaceRepository {
  const registrationRepository = createTenantRegistrationRepository(executor);

  return {
    registerTenant: registrationRepository.registerTenant,

    async saveWorkspace(workspace: MvpTenantWorkspace): Promise<void> {
      const rows = mapWorkspaceToPersistenceRows(workspace);

      await executor.transaction(async (transaction) => {
        await transaction.insertRows(tableRefs.tenants, rows.tenants);
        await transaction.insertRows(
          tableRefs.tenantSettings,
          rows.tenantSettings
        );
        await transaction.insertRows(
          tableRefs.tenantBrandProfiles,
          rows.tenantBrandProfiles
        );
        await transaction.insertRows(
          tableRefs.tenantModules,
          rows.tenantModules
        );
        await transaction.insertRows(
          tableRefs.tenantEntitlements,
          rows.tenantEntitlements
        );
        await transaction.insertRows(tableRefs.accounts, rows.accounts);
        await transaction.insertRows(tableRefs.employees, rows.employees);
        await transaction.insertRows(tableRefs.tenantRoles, rows.tenantRoles);
        await transaction.insertRows(
          tableRefs.tenantRolePermissions,
          rows.tenantRolePermissions
        );
        await transaction.insertRows(
          tableRefs.tenantRoleBindings,
          rows.tenantRoleBindings
        );
        await transaction.insertRows(tableRefs.clients, rows.clients);
        await transaction.insertRows(
          tableRefs.conversations,
          rows.conversations
        );
        await transaction.insertRows(
          tableRefs.conversationParticipants,
          rows.conversationParticipants
        );
        await transaction.insertRows(tableRefs.messages, rows.messages);
        await transaction.insertRows(tableRefs.eventStore, rows.eventStore);
        await transaction.insertRows(tableRefs.outbox, rows.outbox);
      });
    },

    async saveReply(input: PersistConversationReplyInput): Promise<void> {
      const rows = mapReplyToPersistenceRows(input);

      await executor.transaction(async (transaction) => {
        await transaction.insertRows(tableRefs.messages, rows.messages);
        await transaction.insertRows(tableRefs.eventStore, rows.eventStore);
        await transaction.insertRows(tableRefs.outbox, rows.outbox);
      });
    }
  };
}
