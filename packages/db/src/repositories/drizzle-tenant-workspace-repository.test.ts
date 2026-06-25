import {
  createMvpTenantWorkspace,
  createSequentialIdFactory,
  permissionCatalog,
  registerTenant,
  sendConversationReply
} from "@hulee/core";
import { describe, expect, it } from "vitest";

import { createTenantWorkspaceRepository } from "./drizzle-tenant-workspace-repository";
import { RecordingPersistenceExecutor } from "./recording-persistence-executor.test-helper";

const now = "2026-06-22T10:00:00.000Z";

describe("tenant workspace repository", () => {
  it("persists tenant registration rows in strict conflict mode", async () => {
    const registration = registerTenant({
      now,
      tenantSlug: "repo-register",
      tenantDisplayName: "Repo Register",
      productName: "Register Desk",
      adminEmail: "admin@example.com",
      idFactory: createSequentialIdFactory("repo-register")
    });
    const executor = new RecordingPersistenceExecutor();
    const repository = createTenantWorkspaceRepository(executor);

    await repository.registerTenant({
      registration,
      adminPasswordHash: "scrypt:v1:test"
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

  it("persists workspace rows in foreign-key-safe order", async () => {
    const workspace = createMvpTenantWorkspace({
      now,
      tenantSlug: "repo-slice",
      tenantDisplayName: "Repo Slice",
      productName: "Repo Desk",
      adminEmail: "admin@example.com",
      clientDisplayName: "Client One",
      inboundText: "Hello",
      idFactory: createSequentialIdFactory("repo-slice")
    });
    const executor = new RecordingPersistenceExecutor();
    const repository = createTenantWorkspaceRepository(executor);

    await repository.saveWorkspace(workspace);

    expect(executor.transactionCount).toBe(1);
    expect(executor.operations.map((operation) => operation.tableName)).toEqual(
      [
        "tenants",
        "tenant_settings",
        "tenant_brand_profiles",
        "tenant_modules",
        "tenant_entitlements",
        "accounts",
        "employees",
        "tenant_roles",
        "tenant_role_permissions",
        "tenant_role_bindings",
        "clients",
        "conversations",
        "conversation_participants",
        "messages",
        "event_store",
        "outbox"
      ]
    );
    expect(
      executor.operations.every(
        (operation) => operation.onConflict === "do_nothing"
      )
    ).toBe(true);
    expect(
      executor.operations.find((operation) => operation.tableName === "outbox")
        ?.rowCount
    ).toBe(workspace.events.length);
  });

  it("persists replies idempotently with event_store and outbox rows", async () => {
    const ids = createSequentialIdFactory("repo-reply");
    const workspace = createMvpTenantWorkspace({
      now,
      tenantSlug: "repo-reply",
      tenantDisplayName: "Repo Reply",
      productName: "Reply Desk",
      adminEmail: "admin@example.com",
      clientDisplayName: "Client One",
      inboundText: "Hello",
      idFactory: ids
    });
    const reply = sendConversationReply({
      now: "2026-06-22T10:01:00.000Z",
      idFactory: ids,
      license: workspace.license,
      actor: workspace.admin,
      conversation: workspace.conversation,
      text: "Hi"
    });
    const executor = new RecordingPersistenceExecutor();
    const repository = createTenantWorkspaceRepository(executor);

    await repository.saveReply(reply);

    expect(executor.transactionCount).toBe(1);
    expect(executor.operations).toEqual([
      {
        kind: "insert",
        tableName: "messages",
        rowCount: 1,
        onConflict: "do_nothing"
      },
      {
        kind: "insert",
        tableName: "event_store",
        rowCount: 1,
        onConflict: "do_nothing"
      },
      {
        kind: "insert",
        tableName: "outbox",
        rowCount: 1,
        onConflict: "do_nothing"
      }
    ]);
  });
});
