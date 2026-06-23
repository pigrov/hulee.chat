import { describe, expect, it } from "vitest";

import {
  validateSameOriginRequest,
  type HeaderReader
} from "./action-security";

describe("web action security", () => {
  it("allows same-origin requests from the configured public base URL", () => {
    expect(
      validateSameOriginRequest({
        headers: headers({
          origin: "https://chat.example.test",
          host: "chat.example.test"
        }),
        publicBaseUrl: "https://chat.example.test",
        nodeEnv: "production"
      })
    ).toMatchObject({
      allowed: true,
      origin: "https://chat.example.test"
    });
  });

  it("allows explicitly configured additional origins", () => {
    expect(
      validateSameOriginRequest({
        headers: headers({
          origin: "https://legacy.example.test"
        }),
        publicBaseUrl: "https://chat.example.test",
        allowedOrigins: ["https://legacy.example.test/path"],
        nodeEnv: "production"
      })
    ).toMatchObject({
      allowed: true,
      origin: "https://legacy.example.test"
    });
  });

  it("allows proxied host origins outside production", () => {
    expect(
      validateSameOriginRequest({
        headers: headers({
          origin: "https://chat.example.test",
          "x-forwarded-host": "chat.example.test",
          "x-forwarded-proto": "https"
        }),
        nodeEnv: "development"
      })
    ).toMatchObject({
      allowed: true,
      origin: "https://chat.example.test"
    });
  });

  it("does not trust the request host as an origin source in production", () => {
    expect(
      validateSameOriginRequest({
        headers: headers({
          origin: "https://chat.example.test",
          "x-forwarded-host": "chat.example.test",
          "x-forwarded-proto": "https"
        }),
        nodeEnv: "production"
      })
    ).toEqual({
      allowed: false,
      reason: "origin_mismatch",
      origin: "https://chat.example.test"
    });
  });

  it("rejects cross-site origins", () => {
    expect(
      validateSameOriginRequest({
        headers: headers({
          origin: "https://evil.example.test",
          host: "chat.example.test"
        }),
        publicBaseUrl: "https://chat.example.test",
        nodeEnv: "production"
      })
    ).toEqual({
      allowed: false,
      reason: "origin_mismatch",
      origin: "https://evil.example.test"
    });
  });

  it("rejects missing origin in production but allows it in development", () => {
    expect(
      validateSameOriginRequest({
        headers: headers({}),
        publicBaseUrl: "https://chat.example.test",
        nodeEnv: "production"
      })
    ).toEqual({
      allowed: false,
      reason: "missing_origin"
    });

    expect(
      validateSameOriginRequest({
        headers: headers({}),
        nodeEnv: "development"
      })
    ).toMatchObject({
      allowed: true
    });
  });

  it("falls back to referer when origin is absent", () => {
    expect(
      validateSameOriginRequest({
        headers: headers({
          referer: "https://chat.example.test/admin",
          host: "chat.example.test"
        }),
        publicBaseUrl: "https://chat.example.test",
        nodeEnv: "production"
      })
    ).toMatchObject({
      allowed: true,
      origin: "https://chat.example.test"
    });
  });

  it("rejects invalid origin schemes", () => {
    expect(
      validateSameOriginRequest({
        headers: headers({
          origin: "file:///tmp/hulee",
          referer: "https://chat.example.test/admin"
        }),
        publicBaseUrl: "https://chat.example.test",
        nodeEnv: "production"
      })
    ).toEqual({
      allowed: false,
      reason: "missing_origin"
    });
  });
});

function headers(values: Record<string, string>): HeaderReader {
  return {
    get(name) {
      return values[name.toLowerCase()] ?? null;
    }
  };
}
