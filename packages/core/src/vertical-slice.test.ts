import { describe, expect, it } from "vitest";

import {
  CoreError,
  createMvpTenantWorkspace,
  createSequentialIdFactory,
  sendConversationReply,
  type Employee
} from "./index";

const now = "2026-06-22T10:00:00.000Z";

describe("MVP in-memory vertical slice", () => {
  it("creates tenant, brand profile, license, admin, client, conversation, message and events", () => {
    const workspace = createMvpTenantWorkspace({
      now,
      tenantSlug: "acme",
      tenantDisplayName: "Acme",
      productName: "Acme Desk",
      adminEmail: "admin@example.com",
      clientDisplayName: "Client One",
      inboundText: "Hello",
      idFactory: createSequentialIdFactory("slice")
    });

    expect(workspace.tenant).toMatchObject({
      slug: "acme",
      displayName: "Acme",
      locale: "ru",
      timezone: "Europe/Moscow"
    });
    expect(workspace.brandProfile).toMatchObject({
      scope: "tenant",
      tenantId: workspace.tenant.id,
      productName: "Acme Desk"
    });
    expect(workspace.license.entitlements).toContainEqual({
      key: "module.enabled",
      value: "channel-public-api",
      enabled: true
    });
    expect(workspace.license.entitlements).toContainEqual({
      key: "module.enabled",
      value: "channel-telegram",
      enabled: true
    });
    expect(workspace.admin.systemRoleTemplateIds).toEqual(["tenant_admin"]);
    expect(workspace.client.tenantId).toBe(workspace.tenant.id);
    expect(workspace.conversation.tenantId).toBe(workspace.tenant.id);
    expect(workspace.inboundMessage).toMatchObject({
      tenantId: workspace.tenant.id,
      conversationId: workspace.conversation.id,
      direction: "inbound",
      status: "received"
    });
    expect(workspace.events.map((event) => event.type)).toEqual([
      "tenant.created",
      "employee.created",
      "client.created",
      "conversation.created",
      "message.received"
    ]);
    expect(
      workspace.events.every(
        (event) =>
          event.tenantId === workspace.tenant.id && event.version === "v1"
      )
    ).toBe(true);
  });

  it("queues an outbound reply and emits message.sent", () => {
    const ids = createSequentialIdFactory("reply");
    const workspace = createMvpTenantWorkspace({
      now,
      tenantSlug: "reply",
      tenantDisplayName: "Reply",
      productName: "Reply Desk",
      adminEmail: "admin@example.com",
      clientDisplayName: "Client One",
      inboundText: "Hello",
      idFactory: ids
    });

    const result = sendConversationReply({
      now: "2026-06-22T10:01:00.000Z",
      idFactory: ids,
      license: workspace.license,
      actor: workspace.admin,
      conversation: workspace.conversation,
      text: "Hi"
    });

    expect(result.message).toMatchObject({
      tenantId: workspace.tenant.id,
      conversationId: workspace.conversation.id,
      direction: "outbound",
      status: "queued",
      text: "Hi"
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "message.sent",
      tenantId: workspace.tenant.id,
      payload: {
        messageId: result.message.id
      }
    });
  });

  it("blocks the vertical slice when public API channel entitlement is missing", () => {
    expect(() => {
      createMvpTenantWorkspace({
        now,
        tenantSlug: "blocked",
        tenantDisplayName: "Blocked",
        productName: "Blocked Desk",
        adminEmail: "admin@example.com",
        clientDisplayName: "Client One",
        inboundText: "Hello",
        enabledModules: ["auth-local", "storage-s3", "license-basic"],
        idFactory: createSequentialIdFactory("blocked")
      });
    }).toThrow(new CoreError("module.disabled"));
  });

  it("blocks cross-tenant replies before emitting events", () => {
    const workspaceA = createMvpTenantWorkspace({
      now,
      tenantSlug: "a",
      tenantDisplayName: "A",
      productName: "A Desk",
      adminEmail: "admin-a@example.com",
      clientDisplayName: "Client A",
      inboundText: "Hello",
      idFactory: createSequentialIdFactory("a")
    });
    const workspaceB = createMvpTenantWorkspace({
      now,
      tenantSlug: "b",
      tenantDisplayName: "B",
      productName: "B Desk",
      adminEmail: "admin-b@example.com",
      clientDisplayName: "Client B",
      inboundText: "Hello",
      idFactory: createSequentialIdFactory("b")
    });

    expect(() => {
      sendConversationReply({
        now,
        idFactory: createSequentialIdFactory("cross"),
        license: workspaceA.license,
        actor: workspaceA.admin,
        conversation: workspaceB.conversation,
        text: "Should fail"
      });
    }).toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("requires message.reply permission for outbound replies", () => {
    const workspace = createMvpTenantWorkspace({
      now,
      tenantSlug: "permission",
      tenantDisplayName: "Permission",
      productName: "Permission Desk",
      adminEmail: "admin@example.com",
      clientDisplayName: "Client One",
      inboundText: "Hello",
      idFactory: createSequentialIdFactory("permission")
    });
    const employeeWithoutRoles: Employee = {
      ...workspace.admin,
      id: "employee_without_roles" as never,
      systemRoleTemplateIds: []
    };

    expect(() => {
      sendConversationReply({
        now,
        idFactory: createSequentialIdFactory("permission-reply"),
        license: workspace.license,
        actor: employeeWithoutRoles,
        conversation: workspace.conversation,
        text: "Should fail"
      });
    }).toThrow(new CoreError("permission.denied"));
  });
});
