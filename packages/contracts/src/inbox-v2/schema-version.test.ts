import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInboxV2SchemaEnvelope,
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "../index";

const testEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
  "core:inbox-v2.contract-test",
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  z.object({ value: z.string().min(1) }).strict()
);

describe("Inbox V2 schema-version envelopes", () => {
  it("binds an exact schema ID, supported version and strict payload", () => {
    const envelope = {
      schemaId: "core:inbox-v2.contract-test",
      schemaVersion: "v1",
      payload: { value: "ok" }
    } as const;

    expect(testEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(createInboxV2SchemaEnvelope(testEnvelopeSchema, envelope)).toEqual(
      envelope
    );
  });

  it.each([
    {
      schemaId: "core:inbox-v2.contract-test",
      payload: { value: "ok" }
    },
    {
      schemaId: "core:inbox-v2.contract-test",
      schemaVersion: "v2",
      payload: { value: "ok" }
    },
    {
      schemaId: "core:inbox-v2.contract-test",
      schemaVersion: "v3",
      payload: { value: "ok" }
    },
    {
      schemaId: "core:inbox-v2.contract-test",
      schemaVersion: 1,
      payload: { value: "ok" }
    },
    {
      schemaId: "core:inbox-v2.other-contract",
      schemaVersion: "v1",
      payload: { value: "ok" }
    },
    {
      schemaId: "core:inbox-v2.contract-test",
      schemaVersion: "v1",
      payload: { value: "ok" },
      futureField: true
    },
    {
      schemaId: "core:inbox-v2.contract-test",
      schemaVersion: "v1",
      payload: { value: "ok", futureField: true }
    }
  ])("rejects missing, invalid or unknown envelope variants", (input) => {
    expect(testEnvelopeSchema.safeParse(input).success).toBe(false);
  });

  it("distinguishes syntactically valid tokens from versions a schema supports", () => {
    expect(inboxV2SchemaVersionTokenSchema.safeParse("v27").success).toBe(true);
    expect(
      testEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.contract-test",
        schemaVersion: "v27",
        payload: { value: "ok" }
      }).success
    ).toBe(false);
    expect(inboxV2SchemaVersionTokenSchema.safeParse("version-1").success).toBe(
      false
    );
  });

  it("rejects invalid schema declarations before they can parse data", () => {
    expect(() =>
      createInboxV2SchemaEnvelopeSchema(
        "inbox-v2.contract-test",
        "v1",
        z.unknown()
      )
    ).toThrow();
    expect(() =>
      createInboxV2SchemaEnvelopeSchema(
        "core:inbox-v2.contract-test",
        "1",
        z.unknown()
      )
    ).toThrow();
  });
});
