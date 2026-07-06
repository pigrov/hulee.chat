import type { TenantRoleRecord } from "@hulee/db";
import { createTranslator } from "@hulee/i18n";
import { describe, expect, it } from "vitest";

import {
  permissionScopeKey,
  roleName,
  roleNameById,
  scopePickerMessages,
  scopeValue
} from "./rbac-role-display";

const { t } = createTranslator("en");

describe("rbac role display", () => {
  it("uses localized labels for system roles", () => {
    const role = {
      id: "role:tenant:tenant_admin",
      isSystem: true,
      name: "Tenant admin"
    } as TenantRoleRecord;

    expect(roleName(role, t)).toBe("Admin");
  });

  it("falls back to custom role names and ids", () => {
    const role = {
      id: "custom",
      isSystem: false,
      name: "Sales"
    } as TenantRoleRecord;

    expect(roleName(role, t)).toBe("Sales");
    expect(roleNameById("missing", [role], t)).toBe("missing");
  });

  it("formats permission scopes consistently", () => {
    expect(scopeValue({ type: "tenant" }, t)).toBe("Company-wide");
    expect(scopeValue({ type: "queue", id: "queue-1" }, t)).toBe(
      "Queue:queue-1"
    );
    expect(permissionScopeKey({ type: "queue", id: "queue-1" })).toBe(
      "queue:queue-1"
    );
  });

  it("builds scope picker messages from i18n labels", () => {
    expect(scopePickerMessages(t).scopeLabels.queue).toBe("Queue");
  });
});
