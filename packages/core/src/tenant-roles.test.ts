import { describe, expect, it } from "vitest";

import { CoreError } from "./errors";
import { prepareCustomTenantRole } from "./tenant-roles";

describe("tenant role management", () => {
  it("normalizes custom role drafts", () => {
    expect(
      prepareCustomTenantRole({
        name: "  Sales operator  ",
        description: "  Handles assigned sales conversations  ",
        permissions: ["message.reply", "client.view", "message.reply"]
      })
    ).toEqual({
      name: "Sales operator",
      description: "Handles assigned sales conversations",
      permissions: ["message.reply", "client.view"]
    });
  });

  it("requires a name and at least one known permission", () => {
    expect(() =>
      prepareCustomTenantRole({
        name: "",
        permissions: ["message.reply"]
      })
    ).toThrow(new CoreError("validation.failed"));

    expect(() =>
      prepareCustomTenantRole({
        name: "Sales",
        permissions: []
      })
    ).toThrow(new CoreError("validation.failed"));

    expect(() =>
      prepareCustomTenantRole({
        name: "Sales",
        permissions: ["unknown.permission"]
      })
    ).toThrow(new CoreError("validation.failed"));
  });
});
