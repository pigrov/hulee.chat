import { describe, expect, it } from "vitest";

import { isSafeRequestId, resolveRequestId } from "./request-id";

describe("request id security", () => {
  it("accepts short trace-safe request ids", () => {
    expect(isSafeRequestId("req_01HZ.alpha-1:edge")).toBe(true);
    expect(
      resolveRequestId({
        headers: {
          "x-request-id": "req_01HZ.alpha-1:edge"
        },
        requestIdFactory: () => "generated"
      })
    ).toBe("req_01HZ.alpha-1:edge");
  });

  it("ignores missing, oversized or unsafe request ids", () => {
    expect(isSafeRequestId("")).toBe(false);
    expect(isSafeRequestId("a".repeat(129))).toBe(false);
    expect(isSafeRequestId("request\ninjected")).toBe(false);
    expect(isSafeRequestId("request with spaces")).toBe(false);

    expect(
      resolveRequestId({
        headers: {
          "x-request-id": "request\ninjected"
        },
        requestIdFactory: () => "generated"
      })
    ).toBe("generated");
  });
});
