import { describe, expect, it } from "vitest";

import type {
  RawInboundEventId,
  SourceAccountId,
  SourceConnectionId,
  TenantId
} from "./index";
import { assertSourceNormalizerContract } from "./source-normalizer-contract";
import {
  createMegapbxRawInboundEvent,
  normalizeMegapbxWebhookRawEvent,
  parseMegapbxTimestamp,
  parseMegapbxWebhook
} from "./source-megapbx";

const tenantId = "tenant_megapbx_contract" as TenantId;
const sourceConnectionId =
  "source_connection:phone:megapbx" as SourceConnectionId;
const sourceAccountId = "source_account:phone:main" as SourceAccountId;

describe("MegaPBX source normalizer", () => {
  it("parses form webhook payloads from MegaPBX history callbacks", () => {
    const parsed = parseMegapbxWebhook({
      body: new URLSearchParams(historyInPayload()).toString(),
      contentType: "application/x-www-form-urlencoded"
    });

    expect(parsed).toMatchObject({
      cmd: "history",
      eventType: "history.in",
      eventId: "call-fixture-history-in:in",
      token: "redacted-token"
    });
    expect(parsed.payload).toMatchObject({
      callid: "call-fixture-history-in",
      status: "Success"
    });
  });

  it("uses provider token headers when payload token is absent", () => {
    const parsed = parseMegapbxWebhook({
      body: {
        cmd: "event",
        type: "INCOMING",
        callid: "call-fixture-event-incoming"
      },
      headers: {
        "X-Webhook-Token": "header-token"
      }
    });

    expect(parsed).toMatchObject({
      cmd: "event",
      eventType: "event.INCOMING",
      eventId: "call-fixture-event-incoming:INCOMING",
      token: "header-token"
    });
  });

  it("parses compact MegaPBX UTC timestamps", () => {
    expect(parseMegapbxTimestamp("20260709T093729Z")).toBe(
      "2026-07-09T09:37:29.000Z"
    );
  });

  it("creates raw source events with webhook idempotency keys", () => {
    const { rawEvent } = createMegapbxRawInboundEvent({
      id: "raw_evt_megapbx_history_in" as RawInboundEventId,
      tenantId,
      sourceConnectionId,
      sourceAccountId,
      body: historyInPayload(),
      receivedAt: "2026-07-09T10:00:00.000Z"
    });

    expect(rawEvent).toMatchObject({
      externalEventId: "call-fixture-history-in:in",
      providerTimestamp: "2026-07-09T09:37:29.000Z",
      processingStatus: "new"
    });
    expect(rawEvent.idempotencyKey).toBe(
      "source:v1:raw:webhook:source_connection%3Aphone%3Amegapbx:source_account%3Aphone%3Amain:_:external_event:call-fixture-history-in%3Ain"
    );
  });

  it("normalizes inbound call history into resolver handoff inputs", () => {
    const { rawEvent, parsedWebhook } = createMegapbxRawInboundEvent({
      id: "raw_evt_megapbx_history_in" as RawInboundEventId,
      tenantId,
      sourceConnectionId,
      sourceAccountId,
      body: historyInPayload(),
      receivedAt: "2026-07-09T10:00:00.000Z"
    });
    const result = normalizeMegapbxWebhookRawEvent({
      rawEvent,
      parsedWebhook,
      normalizedEventId: "norm_evt_megapbx_history_in",
      now: "2026-07-09T10:01:00.000Z"
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.normalizedEvent).toMatchObject({
      sourceType: "phone",
      sourceName: "megapbx",
      eventType: "call",
      direction: "inbound",
      visibility: "private",
      externalThreadId: "call-fixture-history-in",
      externalUserId: "+79990000000",
      normalizedPayload: {
        callId: "call-fixture-history-in",
        callType: "in",
        durationSeconds: 74,
        waitSeconds: 5,
        recordingUrl: "https://example.test/recordings/call-fixture.mp3"
      }
    });
    expect(
      result.events[0]?.identityResolverInput?.candidates[0]
    ).toMatchObject({
      kind: "phone",
      value: "+79990000000",
      confidence: "verified"
    });
    expect(
      result.events[0]?.conversationResolverInput?.keyCandidates
    ).toContainEqual({
      kind: "call",
      value: "call-fixture-history-in",
      strength: "exact",
      sourceField: "callid"
    });

    expect(
      assertSourceNormalizerContract({
        name: "MegaPBX inbound history",
        adapter: {
          sourceType: "phone",
          sourceName: "megapbx"
        },
        rawEvent,
        events: result.events
      })
    ).toEqual({
      name: "MegaPBX inbound history",
      eventCount: 1,
      sourceType: "phone",
      sourceName: "megapbx"
    });
  });

  it("normalizes lifecycle events as call status facts", () => {
    const { rawEvent, parsedWebhook } = createMegapbxRawInboundEvent({
      id: "raw_evt_megapbx_event_completed" as RawInboundEventId,
      tenantId,
      sourceConnectionId,
      sourceAccountId,
      body: eventCompletedPayload(),
      receivedAt: "2026-07-09T10:05:00.000Z"
    });
    const result = normalizeMegapbxWebhookRawEvent({
      rawEvent,
      parsedWebhook,
      normalizedEventId: "norm_evt_megapbx_event_completed",
      now: "2026-07-09T10:05:01.000Z"
    });

    expect(result.events[0]?.normalizedEvent).toMatchObject({
      eventType: "call",
      direction: "inbound",
      externalMessageId: "call-fixture-event-completed:COMPLETED",
      normalizedPayload: {
        providerEventType: "event.COMPLETED",
        status: "completed",
        clientPhone: "+79990000000"
      }
    });

    expect(() =>
      assertSourceNormalizerContract({
        name: "MegaPBX completed event",
        adapter: {
          sourceType: "phone",
          sourceName: "megapbx"
        },
        rawEvent,
        events: result.events
      })
    ).not.toThrow();
  });

  it("keeps contact callbacks as status updates", () => {
    const { rawEvent, parsedWebhook } = createMegapbxRawInboundEvent({
      id: "raw_evt_megapbx_contact" as RawInboundEventId,
      tenantId,
      sourceConnectionId,
      sourceAccountId,
      body: contactPayload(),
      receivedAt: "2026-07-09T10:10:00.000Z"
    });
    const result = normalizeMegapbxWebhookRawEvent({
      rawEvent,
      parsedWebhook,
      normalizedEventId: "norm_evt_megapbx_contact"
    });

    expect(result.events[0]?.normalizedEvent).toMatchObject({
      eventType: "status_update",
      direction: "system",
      normalizedPayload: {
        command: "contact",
        callId: "call-fixture-contact"
      }
    });
    expect(() =>
      assertSourceNormalizerContract({
        name: "MegaPBX contact callback",
        adapter: {
          sourceType: "phone",
          sourceName: "megapbx"
        },
        rawEvent,
        events: result.events
      })
    ).not.toThrow();
  });
});

function historyInPayload(): Record<string, string> {
  return {
    cmd: "history",
    type: "in",
    callid: "call-fixture-history-in",
    phone: "+79990000000",
    client: "+79990000000",
    telnum: "+74950000000",
    diversion: "+74950000001",
    ext: "101",
    user: "operator@example.test",
    user_name: "Operator Example",
    start: "20260709T093729Z",
    duration: "74",
    wait: "5",
    status: "Success",
    link: "https://example.test/recordings/call-fixture.mp3",
    record: "https://example.test/recordings/call-fixture.mp3",
    crm_token: "redacted-token"
  };
}

function eventCompletedPayload(): Record<string, string> {
  return {
    cmd: "event",
    type: "COMPLETED",
    direction: "INCOMING",
    callid: "call-fixture-event-completed",
    phone: "+79990000000",
    client: "+79990000000",
    telnum: "+74950000000",
    diversion: "+74950000002",
    ext: "101",
    user: "operator@example.test",
    user_name: "Operator Example",
    record: "https://example.test/recordings/call-fixture-completed.mp3",
    crm_token: "redacted-token"
  };
}

function contactPayload(): Record<string, string> {
  return {
    cmd: "contact",
    callid: "call-fixture-contact",
    phone: "+79990000000",
    client: "+79990000000",
    telnum: "+74950000000",
    diversion: "+74950000003",
    user: "operator@example.test",
    user_name: "Operator Example",
    crm_token: "redacted-token"
  };
}
