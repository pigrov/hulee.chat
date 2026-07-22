import { describe, expect, it } from "vitest";

import {
  canonicalInternalApiSignaturePayload,
  createInternalApiSignature,
  verifyInternalApiSignature
} from "./internal-api-signing";

const input = {
  method: "post",
  path: "/internal/v1/tenant/brand",
  body: {
    idempotencyKey: "reply-1",
    text: "Hello"
  },
  tenantId: "tenant-1",
  employeeId: "employee-1",
  permissions: ["tenant.manage"],
  timestamp: "2026-06-23T10:00:00.000Z"
};

describe("internal API signing", () => {
  it("creates deterministic signatures independent of body key order", () => {
    const signature = createInternalApiSignature("secret", input);
    const reorderedSignature = createInternalApiSignature("secret", {
      ...input,
      body: {
        text: "Hello",
        idempotencyKey: "reply-1"
      }
    });

    expect(signature).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(reorderedSignature).toBe(signature);
  });

  it("includes request scope in the canonical payload", () => {
    expect(canonicalInternalApiSignaturePayload(input)).toContain(
      "/internal/v1/tenant/brand"
    );
    expect(canonicalInternalApiSignaturePayload(input)).toContain("tenant-1");
    expect(canonicalInternalApiSignaturePayload(input)).toContain("employee-1");
  });

  it("canonicalizes JSON body values the same way as request serialization", () => {
    const withUndefinedField = createInternalApiSignature("secret", {
      ...input,
      body: {
        channelType: "telegram_bot",
        displayName: undefined
      }
    });
    const withoutUndefinedField = createInternalApiSignature("secret", {
      ...input,
      body: {
        channelType: "telegram_bot"
      }
    });
    const withUndefinedArrayItem = canonicalInternalApiSignaturePayload({
      ...input,
      body: [undefined, "value"]
    });

    expect(withUndefinedField).toBe(withoutUndefinedField);
    expect(withUndefinedArrayItem).toBe(
      canonicalInternalApiSignaturePayload({
        ...input,
        body: [null, "value"]
      })
    );
  });

  it("verifies fresh signatures and rejects tampering", () => {
    const signature = createInternalApiSignature("secret", input);

    expect(
      verifyInternalApiSignature({
        ...input,
        secret: "secret",
        signature,
        now: new Date("2026-06-23T10:00:01.000Z")
      })
    ).toBe(true);
    expect(
      verifyInternalApiSignature({
        ...input,
        tenantId: "tenant-2",
        secret: "secret",
        signature,
        now: new Date("2026-06-23T10:00:01.000Z")
      })
    ).toBe(false);
  });

  it("rejects missing, malformed and stale signatures", () => {
    const signature = createInternalApiSignature("secret", input);

    expect(
      verifyInternalApiSignature({
        ...input,
        secret: undefined,
        signature,
        now: new Date("2026-06-23T10:00:01.000Z")
      })
    ).toBe(false);
    expect(
      verifyInternalApiSignature({
        ...input,
        secret: "secret",
        signature: "bad",
        now: new Date("2026-06-23T10:00:01.000Z")
      })
    ).toBe(false);
    expect(
      verifyInternalApiSignature({
        ...input,
        secret: "secret",
        signature,
        now: new Date("2026-06-23T10:10:01.000Z")
      })
    ).toBe(false);
  });
});
