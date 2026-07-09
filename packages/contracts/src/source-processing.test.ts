import { describe, expect, it } from "vitest";

import type {
  NormalizedInboundEventId,
  RawInboundEventId,
  SourceAccountId,
  SourceConnectionId,
  TenantId
} from "./index";
import {
  decideSourceProcessing,
  sanitizeSourceDiagnosticDetails,
  sourceReplayRequestSchema
} from "./source-processing";

const tenantId = "tenant_source" as TenantId;
const sourceConnectionId = "source_connection:telegram:1" as SourceConnectionId;
const sourceAccountId = "source_account:telegram:bot" as SourceAccountId;
const rawEventId = "raw_evt_1" as RawInboundEventId;
const normalizedEventId = "norm_evt_1" as NormalizedInboundEventId;

describe("source processing policy", () => {
  it("schedules retry for retryable source failures before max attempts", () => {
    expect(
      decideSourceProcessing({
        tenantId,
        sourceConnectionId,
        sourceAccountId,
        rawEventId,
        stage: "normalization",
        checkedAt: new Date("2026-07-09T10:00:00.000Z"),
        attempt: 2,
        maxAttempts: 5,
        errorCode: "provider.temporary_failure",
        retryAfterSeconds: 90,
        operatorHint: "Provider returned a temporary error.",
        safeDetails: {
          providerStatus: 502,
          token: "secret-token"
        }
      })
    ).toEqual({
      action: "retry",
      processingStatus: "failed",
      retryability: "retryable",
      replayable: true,
      nextAttemptAt: "2026-07-09T10:01:30.000Z",
      diagnostics: {
        tenantId,
        sourceConnectionId,
        sourceAccountId,
        rawEventId,
        stage: "normalization",
        outcome: "failed",
        attempt: 2,
        maxAttempts: 5,
        checkedAt: "2026-07-09T10:00:00.000Z",
        errorCode: "provider.temporary_failure",
        retryability: "retryable",
        nextAttemptAt: "2026-07-09T10:01:30.000Z",
        replayable: true,
        operatorHint: "Provider returned a temporary error.",
        safeDetails: {
          providerStatus: 502,
          token: "[redacted]"
        }
      }
    });
  });

  it("moves events to DLQ after attempts are exhausted", () => {
    expect(
      decideSourceProcessing({
        tenantId,
        sourceConnectionId,
        normalizedEventId,
        stage: "conversation_resolution",
        checkedAt: "2026-07-09T10:00:00.000Z",
        attempt: 5,
        maxAttempts: 5,
        errorCode: "provider.temporary_failure"
      })
    ).toMatchObject({
      action: "send_to_dlq",
      processingStatus: "failed",
      retryability: "retryable",
      replayable: true,
      dlqReason: "Attempts exhausted (5/5).",
      diagnostics: {
        tenantId,
        sourceConnectionId,
        normalizedEventId,
        stage: "conversation_resolution",
        outcome: "failed",
        attempt: 5,
        maxAttempts: 5,
        checkedAt: "2026-07-09T10:00:00.000Z",
        errorCode: "provider.temporary_failure",
        retryability: "retryable",
        dlqAt: "2026-07-09T10:00:00.000Z",
        replayable: true
      }
    });
  });

  it("routes not retryable validation failures directly to DLQ", () => {
    expect(
      decideSourceProcessing({
        tenantId,
        sourceConnectionId,
        rawEventId,
        stage: "raw_ingest",
        checkedAt: "2026-07-09T10:00:00.000Z",
        attempt: 1,
        maxAttempts: 5,
        errorCode: "validation.failed"
      })
    ).toMatchObject({
      action: "send_to_dlq",
      retryability: "not_retryable",
      dlqReason: "Not retryable: validation.failed.",
      diagnostics: {
        errorCode: "validation.failed",
        dlqAt: "2026-07-09T10:00:00.000Z"
      }
    });
  });

  it("handles ignored and duplicate source events without replay", () => {
    expect(
      decideSourceProcessing({
        tenantId,
        sourceConnectionId,
        rawEventId,
        stage: "raw_ingest",
        checkedAt: "2026-07-09T10:00:00.000Z",
        processingStatus: "duplicate"
      })
    ).toMatchObject({
      action: "mark_duplicate",
      processingStatus: "duplicate",
      retryability: "not_retryable",
      replayable: false,
      diagnostics: {
        outcome: "duplicate",
        replayable: false
      }
    });

    expect(
      decideSourceProcessing({
        tenantId,
        sourceConnectionId,
        rawEventId,
        stage: "normalization",
        checkedAt: "2026-07-09T10:00:00.000Z",
        outcome: "ignored"
      })
    ).toMatchObject({
      action: "ignore",
      processingStatus: "ignored",
      replayable: false,
      diagnostics: {
        outcome: "ignored"
      }
    });
  });

  it("validates replay requests and requires an event id", () => {
    expect(
      sourceReplayRequestSchema.parse({
        tenantId,
        sourceConnectionId,
        rawEventId,
        mode: "from_dlq",
        reason: "adapter_fixed",
        requestedAt: "2026-07-09T10:00:00.000Z",
        idempotencyKey: "source-replay:raw_evt_1"
      })
    ).toMatchObject({
      tenantId,
      sourceConnectionId,
      rawEventId,
      mode: "from_dlq",
      forceReprocess: false
    });

    expect(() =>
      sourceReplayRequestSchema.parse({
        tenantId,
        sourceConnectionId,
        mode: "from_dlq",
        reason: "adapter_fixed",
        requestedAt: "2026-07-09T10:00:00.000Z",
        idempotencyKey: "source-replay:missing-event"
      })
    ).toThrow();
  });

  it("redacts sensitive diagnostic fields recursively", () => {
    expect(
      sanitizeSourceDiagnosticDetails({
        payload: { text: "raw" },
        nested: {
          authorization: "Bearer secret",
          visible: "safe"
        },
        message: "x".repeat(520)
      })
    ).toEqual({
      payload: "[redacted]",
      nested: {
        authorization: "[redacted]",
        visible: "safe"
      },
      message: `${"x".repeat(500)}...`
    });
  });
});
