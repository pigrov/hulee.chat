import {
  createSequentialIdFactory,
  permissionCatalog,
  registerTenant
} from "@hulee/core";
import { describe, expect, it } from "vitest";

import { createTenantRegistrationRepository } from "./drizzle-tenant-registration-repository";
import { RecordingPersistenceExecutor } from "./recording-persistence-executor.test-helper";

const now = "2026-06-22T10:00:00.000Z";

describe("tenant registration repository", () => {
  it("persists only retained foundation tables in one strict transaction", async () => {
    const registration = registerTenant({
      now,
      tenantSlug: "repo-clean-foundation",
      tenantDisplayName: "Repo Clean Foundation",
      productName: "Repo Clean Desk",
      adminEmail: "admin@example.com",
      idFactory: createSequentialIdFactory("repo-clean-foundation")
    });
    const executor = new RecordingPersistenceExecutor();
    const repository = createTenantRegistrationRepository(executor);

    await repository.registerTenant({
      registration,
      adminPasswordHash: null
    });

    expect(executor.transactionCount).toBe(1);
    expect(executor.operations).toEqual([
      {
        kind: "insert",
        tableName: "tenants",
        rowCount: 1,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "tenant_settings",
        rowCount: 1,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "tenant_brand_profiles",
        rowCount: 1,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "tenant_modules",
        rowCount: 5,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "tenant_entitlements",
        rowCount: 5,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "accounts",
        rowCount: 1,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "employees",
        rowCount: 1,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "tenant_roles",
        rowCount: 1,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "tenant_role_permissions",
        rowCount: permissionCatalog.length,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "tenant_role_bindings",
        rowCount: 1,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "event_store",
        rowCount: 2,
        onConflict: "fail"
      },
      {
        kind: "insert",
        tableName: "outbox",
        rowCount: 2,
        onConflict: "fail"
      }
    ]);
  });
});
