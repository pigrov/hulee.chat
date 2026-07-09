import { describe, expect, it } from "vitest";

import type { SourceAccountId, SourceConnectionId } from "./index";
import {
  createNormalizedSourceIdempotencyKey,
  createRawSourceIdempotencyKey,
  createSourceIdempotencyKey,
  sourceIdempotencyKeySchema
} from "./source-idempotency";

const sourceConnectionId =
  "source_connection:telegram_bot:tenant_1" as SourceConnectionId;
const sourceAccountId = "source_account:bot_1" as SourceAccountId;

describe("source idempotency keys", () => {
  it("creates raw webhook keys from provider external event ids", () => {
    expect(
      createRawSourceIdempotencyKey({
        transport: "webhook",
        sourceConnectionId,
        sourceAccountId,
        externalEventId: "update:123"
      })
    ).toBe(
      "source:v1:raw:webhook:source_connection%3Atelegram_bot%3Atenant_1:source_account%3Abot_1:_:external_event:update%3A123"
    );
  });

  it("creates polling keys from external provider update ids", () => {
    expect(
      createRawSourceIdempotencyKey({
        transport: "polling",
        sourceConnectionId,
        externalEventId: "telegram-update-100"
      })
    ).toBe(
      "source:v1:raw:polling:source_connection%3Atelegram_bot%3Atenant_1:_:_:external_event:telegram-update-100"
    );
  });

  it("creates email keys from message signatures when provider ids are absent", () => {
    expect(
      createRawSourceIdempotencyKey({
        transport: "email",
        sourceConnectionId,
        eventSignature: "message-id:<abc@example.test>"
      })
    ).toBe(
      "source:v1:raw:email:source_connection%3Atelegram_bot%3Atenant_1:_:_:event_signature:message-id%3A%3Cabc%40example.test%3E"
    );
  });

  it("prioritizes API client keys over provider ids", () => {
    expect(
      createRawSourceIdempotencyKey({
        transport: "api",
        sourceConnectionId,
        clientKey: "client-key-1",
        externalEventId: "provider-event-1"
      })
    ).toBe(
      "source:v1:raw:api:source_connection%3Atelegram_bot%3Atenant_1:_:_:client_key:client-key-1"
    );
  });

  it("keeps normalized keys separate from raw keys by phase and source event type", () => {
    expect(
      createNormalizedSourceIdempotencyKey({
        transport: "webhook",
        sourceConnectionId,
        sourceAccountId,
        sourceEventType: "message",
        externalEventId: "update:123"
      })
    ).toBe(
      "source:v1:normalized:webhook:source_connection%3Atelegram_bot%3Atenant_1:source_account%3Abot_1:message:external_event:update%3A123"
    );
  });

  it("uses fingerprints as the final fallback", () => {
    expect(
      createSourceIdempotencyKey({
        phase: "raw",
        transport: "webhook",
        sourceConnectionId,
        fingerprint: "sha256:payload"
      })
    ).toBe(
      "source:v1:raw:webhook:source_connection%3Atelegram_bot%3Atenant_1:_:_:fingerprint:sha256%3Apayload"
    );
  });

  it("rejects empty identity inputs", () => {
    expect(() =>
      createRawSourceIdempotencyKey({
        transport: "webhook",
        sourceConnectionId,
        externalEventId: " "
      })
    ).toThrow(
      "Source idempotency key requires clientKey, externalEventId, eventSignature or fingerprint."
    );
  });

  it("validates source idempotency key format", () => {
    expect(
      sourceIdempotencyKeySchema.parse(
        "source:v1:raw:api:source_connection%3Atelegram_bot%3Atenant_1:_:_:client_key:client-key-1"
      )
    ).toBe(
      "source:v1:raw:api:source_connection%3Atelegram_bot%3Atenant_1:_:_:client_key:client-key-1"
    );
    expect(() => sourceIdempotencyKeySchema.parse("message:1")).toThrow();
  });
});
