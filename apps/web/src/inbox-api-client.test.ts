import { CoreError } from "@hulee/core";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({
  buildInternalApiHeaders: vi.fn(async () => ({
    "x-hulee-tenant-id": "tenant-1",
    "x-hulee-employee-id": "employee-1"
  }))
}));

vi.mock("./web-config", () => ({
  resolveWebConfig: () => ({
    internalApiBaseUrl: "https://api.example.test"
  })
}));

import { loadInboxViewModel } from "./inbox-api-client";

describe("inbox API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("maps versioned inbox access errors to CoreError", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "permission.denied",
            messageKey: "errors.permission.denied",
            retryability: "not_retryable",
            requestId: "request-1"
          }
        }),
        {
          status: 403,
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(loadInboxViewModel()).rejects.toEqual(
      new CoreError("permission.denied")
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/internal/v1/inbox"
    );
  });
});
