import type { TenantId } from "@hulee/contracts";
import {
  CoreError,
  createMvpTenantWorkspace,
  createSequentialIdFactory,
  sendConversationReply
} from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  assertTenantScopedRows,
  collectTenantBoundaryViolations,
  collectWorkspaceTenantScopedRows,
  mapReplyToPersistenceRows,
  mapWorkspaceToPersistenceRows
} from "./index";

const now = "2026-06-22T10:00:00.000Z";

describe("vertical slice persistence mapper", () => {
  it("maps MVP workspace into tenant-scoped Drizzle insert rows", () => {
    const workspace = createMvpTenantWorkspace({
      now,
      tenantSlug: "db-slice",
      tenantDisplayName: "DB Slice",
      productName: "DB Desk",
      adminEmail: "admin@example.com",
      clientDisplayName: "Client One",
      inboundText: "Hello",
      idFactory: createSequentialIdFactory("db-slice")
    });

    const rows = mapWorkspaceToPersistenceRows(workspace);
    const scopedRows = collectWorkspaceTenantScopedRows(rows);

    expect(rows.tenants).toHaveLength(1);
    expect(rows.tenants[0]).toMatchObject({
      id: workspace.tenant.id,
      slug: "db-slice",
      displayName: "DB Slice",
      deploymentType: "saas_shared",
      createdAt: new Date(now)
    });
    expect(rows.tenantModules.map((row) => row.moduleId)).toEqual([
      "auth-local",
      "channel-public-api",
      "channel-telegram",
      "storage-s3",
      "license-basic"
    ]);
    expect(rows.tenantEntitlements).toContainEqual(
      expect.objectContaining({
        tenantId: workspace.tenant.id,
        key: "module.enabled",
        value: "channel-public-api",
        enabled: true
      })
    );
    expect(rows.tenantBrandProfiles[0]).toMatchObject({
      tenantId: workspace.tenant.id,
      productName: "DB Desk"
    });
    expect(rows.accounts[0]).toMatchObject({
      tenantId: workspace.tenant.id,
      email: "admin@example.com"
    });
    expect(rows.messages[0]).toMatchObject({
      tenantId: workspace.tenant.id,
      conversationId: workspace.conversation.id,
      direction: "inbound",
      status: "received"
    });
    expect(rows.eventStore.map((row) => row.id)).toEqual(
      workspace.events.map((event) => event.id)
    );
    expect(rows.outbox.map((row) => row.eventId)).toEqual(
      workspace.events.map((event) => event.id)
    );
    expect(
      collectTenantBoundaryViolations(workspace.tenant.id, scopedRows)
    ).toEqual([]);
  });

  it("maps tenant module config into tenant-scoped module rows", () => {
    const workspace = createMvpTenantWorkspace({
      now,
      tenantSlug: "db-module-config",
      tenantDisplayName: "DB Module Config",
      productName: "Config Desk",
      adminEmail: "admin@example.com",
      clientDisplayName: "Client One",
      inboundText: "Hello",
      moduleConfigs: {
        "channel-telegram": {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          outboundEnabled: true
        }
      },
      idFactory: createSequentialIdFactory("db-module-config")
    });

    const rows = mapWorkspaceToPersistenceRows(workspace);

    expect(
      rows.tenantModules.find((row) => row.moduleId === "channel-telegram")
    ).toMatchObject({
      tenantId: workspace.tenant.id,
      config: {
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        outboundEnabled: true
      }
    });
  });

  it("maps queued reply message and events into event_store and outbox rows", () => {
    const ids = createSequentialIdFactory("db-reply");
    const workspace = createMvpTenantWorkspace({
      now,
      tenantSlug: "db-reply",
      tenantDisplayName: "DB Reply",
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

    const rows = mapReplyToPersistenceRows(reply);

    expect(rows.messages).toHaveLength(1);
    expect(rows.messages[0]).toMatchObject({
      tenantId: workspace.tenant.id,
      conversationId: workspace.conversation.id,
      direction: "outbound",
      status: "queued",
      text: "Hi"
    });
    expect(rows.eventStore).toHaveLength(1);
    expect(rows.eventStore[0]).toMatchObject({
      tenantId: workspace.tenant.id,
      type: "message.sent",
      payload: {
        messageId: reply.message.id
      }
    });
    expect(rows.outbox[0]).toMatchObject({
      tenantId: workspace.tenant.id,
      eventId: reply.events[0].id,
      status: "pending",
      attempts: 0
    });
  });

  it("rejects cross-tenant rows before repository persistence", () => {
    const ids = createSequentialIdFactory("db-boundary");
    const workspace = createMvpTenantWorkspace({
      now,
      tenantSlug: "db-boundary",
      tenantDisplayName: "DB Boundary",
      productName: "Boundary Desk",
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
    const crossTenantEvent = {
      ...reply.events[0],
      tenantId: "tenant_other" as TenantId
    };

    expect(() => {
      mapReplyToPersistenceRows({
        message: reply.message,
        events: [crossTenantEvent]
      });
    }).toThrow(new CoreError("tenant.boundary_violation"));

    expect(() => {
      assertTenantScopedRows(workspace.tenant.id, [
        { tenantId: workspace.tenant.id },
        { tenantId: "tenant_other" }
      ]);
    }).toThrow(new CoreError("tenant.boundary_violation"));
  });
});
