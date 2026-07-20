import type {
  PersistTenantRegistrationInput,
  TenantRegistrationRepository
} from "@hulee/core";

import {
  accounts,
  employees,
  eventStore,
  outbox,
  tenantBrandProfiles,
  tenantEntitlements,
  tenantModules,
  tenantRoleBindings,
  tenantRolePermissions,
  tenantRoles,
  tenantSettings,
  tenants
} from "../schema/tables";
import type { PersistenceExecutor } from "./persistence-executor";
import { tableRef } from "./persistence-executor";
import { mapTenantRegistrationToPersistenceRows } from "./tenant-registration-mapper";

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
  eventStore: tableRef("event_store", eventStore),
  outbox: tableRef("outbox", outbox)
};

export function createTenantRegistrationRepository(
  executor: PersistenceExecutor
): TenantRegistrationRepository {
  return {
    async registerTenant(input: PersistTenantRegistrationInput): Promise<void> {
      const rows = mapTenantRegistrationToPersistenceRows(input);

      await executor.transaction(async (transaction) => {
        await transaction.insertRows(tableRefs.tenants, rows.tenants, {
          onConflict: "fail"
        });
        await transaction.insertRows(
          tableRefs.tenantSettings,
          rows.tenantSettings,
          { onConflict: "fail" }
        );
        await transaction.insertRows(
          tableRefs.tenantBrandProfiles,
          rows.tenantBrandProfiles,
          { onConflict: "fail" }
        );
        await transaction.insertRows(
          tableRefs.tenantModules,
          rows.tenantModules,
          { onConflict: "fail" }
        );
        await transaction.insertRows(
          tableRefs.tenantEntitlements,
          rows.tenantEntitlements,
          { onConflict: "fail" }
        );
        await transaction.insertRows(tableRefs.accounts, rows.accounts, {
          onConflict: "fail"
        });
        await transaction.insertRows(tableRefs.employees, rows.employees, {
          onConflict: "fail"
        });
        await transaction.insertRows(tableRefs.tenantRoles, rows.tenantRoles, {
          onConflict: "fail"
        });
        await transaction.insertRows(
          tableRefs.tenantRolePermissions,
          rows.tenantRolePermissions,
          { onConflict: "fail" }
        );
        await transaction.insertRows(
          tableRefs.tenantRoleBindings,
          rows.tenantRoleBindings,
          { onConflict: "fail" }
        );
        await transaction.insertRows(tableRefs.eventStore, rows.eventStore, {
          onConflict: "fail"
        });
        await transaction.insertRows(tableRefs.outbox, rows.outbox, {
          onConflict: "fail"
        });
      });
    }
  };
}
