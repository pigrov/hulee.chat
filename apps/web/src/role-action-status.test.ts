import { CoreError } from "@hulee/core";
import { describe, expect, it } from "vitest";

import { roleActionFailureStatus } from "./role-action-status";

describe("role action status", () => {
  it("maps permission denials to a dedicated admin-visible status", () => {
    expect(roleActionFailureStatus(new CoreError("permission.denied"))).toBe(
      "permission_denied"
    );
  });

  it("keeps validation and unknown errors generic", () => {
    expect(roleActionFailureStatus(new CoreError("validation.failed"))).toBe(
      "invalid"
    );
    expect(roleActionFailureStatus(new Error("invalid form"))).toBe("invalid");
  });
});
