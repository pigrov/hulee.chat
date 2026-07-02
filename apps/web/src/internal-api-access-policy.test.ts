import { CoreError } from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  assertInternalApiEffectivePermissionOverride,
  resolveRequiredInternalApiEffectivePermissionOverride
} from "./internal-api-access-policy";

describe("web internal API access policy", () => {
  it("does not require a signed override for service-authorized inbox routes", () => {
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "GET",
        path: "/internal/v1/inbox?assigned=me"
      })
    ).toBeUndefined();
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "POST",
        path: "/internal/v1/inbox/conversations/conversation-1/replies"
      })
    ).toBeUndefined();
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "PATCH",
        path: "/internal/v1/inbox/conversations/conversation-1/routing"
      })
    ).toBeUndefined();
  });

  it("maps admin route families to required narrow overrides", () => {
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "GET",
        path: "/internal/v1/tenant/brand"
      })
    ).toBe("tenant.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "PUT",
        path: "/internal/v1/org-structure/org-units"
      })
    ).toBe("employees.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "POST",
        path: "/internal/v1/access/decision"
      })
    ).toBe("roles.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "PATCH",
        path: "/internal/v1/rbac/roles/role-sales"
      })
    ).toBe("roles.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "DELETE",
        path: "/internal/v1/rbac/role-bindings/binding-sales"
      })
    ).toBe("roles.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "POST",
        path: "/internal/v1/rbac/direct-grants"
      })
    ).toBe("roles.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "DELETE",
        path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram/webhook"
      })
    ).toBe("modules.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "GET",
        path: "/internal/v1/channels/catalog"
      })
    ).toBe("modules.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "GET",
        path: "/internal/v1/channels/connectors"
      })
    ).toBe("modules.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "GET",
        path: "/internal/v1/egress/status"
      })
    ).toBe("modules.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "POST",
        path: "/internal/v1/channels/connectors"
      })
    ).toBe("modules.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "POST",
        path: "/internal/v1/channels/telegram-bot/token/validate"
      })
    ).toBe("modules.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "POST",
        path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/disable"
      })
    ).toBe("modules.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "DELETE",
        path: "/internal/v1/channels/connectors/telegram_bot%3Asecond"
      })
    ).toBe("modules.manage");
  });

  it("rejects missing or mismatched overrides for admin routes", () => {
    expect(() =>
      assertInternalApiEffectivePermissionOverride({
        method: "GET",
        path: "/internal/v1/channels/catalog"
      })
    ).toThrow(new CoreError("permission.denied"));
    expect(() =>
      assertInternalApiEffectivePermissionOverride({
        method: "GET",
        path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram",
        effectivePermissionOverride: "tenant.manage"
      })
    ).toThrow(new CoreError("permission.denied"));
    expect(
      assertInternalApiEffectivePermissionOverride({
        method: "GET",
        path: "/internal/v1/channels/connectors/telegram_bot%3Asecond/telegram",
        effectivePermissionOverride: "modules.manage"
      })
    ).toBe("modules.manage");
    expect(
      resolveRequiredInternalApiEffectivePermissionOverride({
        method: "GET",
        path: "/internal/v1/integrations/telegram"
      })
    ).toBeUndefined();
  });
});
