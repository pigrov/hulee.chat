import { CoreError } from "@hulee/core";
import { describe, expect, it } from "vitest";

import { coreErrorFromInternalApiErrorBody } from "./internal-api-errors";

describe("internal API errors", () => {
  it("maps versioned internal API errors to CoreError", () => {
    expect(
      coreErrorFromInternalApiErrorBody({
        error: {
          code: "permission.denied",
          messageKey: "errors.permission.denied",
          retryability: "not_retryable",
          requestId: "request-1"
        }
      })
    ).toEqual(new CoreError("permission.denied"));
  });

  it("ignores non-versioned error payloads", () => {
    expect(coreErrorFromInternalApiErrorBody({ error: "forbidden" })).toBe(
      undefined
    );
  });
});
