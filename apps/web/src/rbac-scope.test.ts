import { describe, expect, it } from "vitest";

import { allowedRoleBindingScopeTypesForPermissions } from "./rbac-scope";

describe("RBAC scope helpers", () => {
  it("limits role binding scopes to the scopes shared by role permissions", () => {
    expect(
      allowedRoleBindingScopeTypesForPermissions(["roles.manage"])
    ).toEqual(["tenant"]);
    expect(
      allowedRoleBindingScopeTypesForPermissions([
        "message.reply",
        "client.view"
      ])
    ).toEqual(["tenant", "org_unit", "team", "queue", "assigned"]);
  });
});
