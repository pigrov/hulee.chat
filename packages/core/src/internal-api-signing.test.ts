import { describe, expect, it } from "vitest";

import {
  canonicalInternalApiSignaturePayload,
  createInternalApiSignature,
  verifyInternalApiSignature
} from "./internal-api-signing";

const input = {
  method: "post",
  path: "/internal/v1/inbox/conversations/c1/replies",
  body: {
    idempotencyKey: "reply-1",
    text: "Hello"
  },
  tenantId: "tenant-1",
  employeeId: "employee-1",
  permissions: ["message.reply", "inbox.read"],
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
      "/internal/v1/inbox/conversations/c1/replies"
    );
    expect(canonicalInternalApiSignaturePayload(input)).toContain("tenant-1");
    expect(canonicalInternalApiSignaturePayload(input)).toContain("employee-1");
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
