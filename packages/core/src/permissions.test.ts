import { describe, expect, it } from "vitest";

import { CoreError } from "./errors";
import {
  allowedScopeTypesForPermissions,
  allowedScopesForPermission,
  assertPermissionsAllowedForScope,
  assertEmployeeCan,
  assertPermissionScopeAllowed,
  getPermissionDefinition,
  hasPermission,
  isPermission,
  isPermissionScope,
  isPermissionScopeAllowed,
  isPermissionScopeType,
  isSystemRoleTemplateId,
  normalizePermissionScope,
  permissionCatalog,
  permissionScopeRequiresReference,
  permissionsForSystemRoleTemplates,
  type Employee
} from "./permissions";

const employee: Employee = {
  id: "employee-1" as never,
  tenantId: "tenant-1" as never,
  email: "agent@example.test",
  displayName: "Agent",
  systemRoleTemplateIds: ["agent"],
  createdAt: "2026-06-22T10:00:00.000Z"
};

describe("permissions", () => {
  it("maps tenant admin templates to tenant management permissions", () => {
    expect(permissionsForSystemRoleTemplates(["tenant_admin"])).toEqual(
      permissionCatalog.map(({ id }) => id)
    );
  });

  it("deduplicates permissions from multiple templates", () => {
    expect(
      permissionsForSystemRoleTemplates(["tenant_admin", "agent"])
    ).toEqual(permissionCatalog.map(({ id }) => id));
  });

  it("checks employee permissions through system templates", () => {
    expect(hasPermission(employee, "inbox.read")).toBe(true);
    expect(hasPermission(employee, "modules.manage")).toBe(false);
    expect(() => assertEmployeeCan(employee, "modules.manage")).toThrow(
      new CoreError("permission.denied")
    );
  });

  it("validates known system template and permission values", () => {
    expect(isSystemRoleTemplateId("tenant_admin")).toBe(true);
    expect(isSystemRoleTemplateId("platform_admin")).toBe(false);
    expect(isPermission("modules.manage")).toBe(true);
    expect(isPermission("roles.manage")).toBe(true);
    expect(isPermission("platform.admin")).toBe(false);
  });

  it("keeps permission catalog ids unique", () => {
    const ids = permissionCatalog.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("describes allowed permission scopes", () => {
    expect(getPermissionDefinition("message.reply")).toMatchObject({
      domain: "messages"
    });
    expect(allowedScopesForPermission("message.reply")).toContain("assigned");
    expect(isPermissionScopeAllowed("message.reply", "conversation")).toBe(
      true
    );
    expect(isPermissionScopeAllowed("roles.manage", "queue")).toBe(true);
    expect(isPermissionScopeAllowed("roles.manage", "assigned")).toBe(false);
    expect(() =>
      assertPermissionScopeAllowed("roles.manage", "assigned")
    ).toThrow(new CoreError("validation.failed"));
    expect(
      allowedScopeTypesForPermissions(["message.reply", "client.view"])
    ).toEqual(["tenant", "org_unit", "team", "queue", "assigned", "client"]);
    expect(allowedScopeTypesForPermissions(["roles.manage"])).toEqual([
      "tenant",
      "org_unit",
      "team",
      "queue"
    ]);
    expect(() =>
      assertPermissionsAllowedForScope(["roles.manage"], "assigned")
    ).toThrow(new CoreError("validation.failed"));
  });

  it("validates permission scope references", () => {
    expect(isPermissionScopeType("queue")).toBe(true);
    expect(isPermissionScopeType("provider")).toBe(false);
    expect(isPermissionScope({ type: "tenant" })).toBe(true);
    expect(isPermissionScope({ type: "tenant", id: "tenant-1" })).toBe(false);
    expect(isPermissionScope({ type: "queue", id: "queue-1" })).toBe(true);
    expect(isPermissionScope({ type: "queue" })).toBe(false);
    expect(isPermissionScope({ type: "queue", id: "   " })).toBe(false);
    expect(permissionScopeRequiresReference("queue")).toBe(true);
    expect(permissionScopeRequiresReference("assigned")).toBe(false);
    expect(
      normalizePermissionScope({ type: "queue", id: " queue-1 " })
    ).toEqual({
      type: "queue",
      id: "queue-1"
    });
    expect(normalizePermissionScope({ type: "assigned" })).toEqual({
      type: "assigned"
    });
    expect(() =>
      normalizePermissionScope({ type: "assigned", id: "employee-1" })
    ).toThrow(new CoreError("validation.failed"));
    expect(() => normalizePermissionScope({ type: "queue" })).toThrow(
      new CoreError("validation.failed")
    );
  });
});
