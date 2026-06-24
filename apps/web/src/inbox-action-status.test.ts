import { CoreError } from "@hulee/core";
import { describe, expect, it } from "vitest";

import { inboxRoutingActionFailureStatus } from "./inbox-action-status";

describe("inbox action status", () => {
  it("maps routing permission denials to a dedicated status", () => {
    expect(
      inboxRoutingActionFailureStatus(new CoreError("permission.denied"))
    ).toBe("permission_denied");
  });

  it("keeps validation and unknown routing failures generic", () => {
    expect(
      inboxRoutingActionFailureStatus(new CoreError("validation.failed"))
    ).toBe("invalid");
    expect(inboxRoutingActionFailureStatus(new Error("network failed"))).toBe(
      "invalid"
    );
  });
});
