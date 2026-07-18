import { InboxV2SourceNormalizationError } from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import type { InboxV2SourceNormalizationProcessor } from "./source-normalization-processor";
import { createInboxV2SourceNormalizationRuntimeHandler } from "./source-normalization-runtime-handler";
import type { InboxV2SourceProcessingRuntimeClaim } from "./source-processing-runtime-coordinator";

describe("Inbox V2 source-normalization runtime handler", () => {
  it("maps an atomic SRC-003 completion to processed", async () => {
    const processor = processorReturning({
      outcome: "completed",
      completion: { outcome: "normalized" }
    });
    const handler = createInboxV2SourceNormalizationRuntimeHandler(processor);

    await expect(handler.process(runtimeClaim())).resolves.toEqual({
      kind: "processed"
    });
  });

  it("keeps an ignored normalization terminal and diagnosable", async () => {
    const handler = createInboxV2SourceNormalizationRuntimeHandler(
      processorReturning({
        outcome: "already_completed",
        completion: { outcome: "ignored" }
      })
    );

    await expect(handler.process(runtimeClaim())).resolves.toMatchObject({
      kind: "ignored",
      diagnostic: {
        codeId: "core:source-normalization-ignored",
        retryable: false,
        correlationToken: "attempt-normalization"
      }
    });
  });

  it("converts a typed normalizer failure without persisting its exception", async () => {
    const process = vi.fn(async () => {
      throw new InboxV2SourceNormalizationError(
        "source.normalizer_failed",
        true
      );
    });
    const handler = createInboxV2SourceNormalizationRuntimeHandler({
      process
    });

    const result = await handler.process(runtimeClaim());

    expect(result).toMatchObject({
      kind: "failed",
      diagnostic: {
        codeId: "core:source-normalizer-failed",
        retryable: true,
        correlationToken: "attempt-normalization"
      }
    });
    expect(JSON.stringify(result)).not.toContain(
      "InboxV2SourceNormalizationError"
    );
  });

  it("refuses a normalization call without the shared raw-ingress lease", async () => {
    const processor = processorReturning({ outcome: "not_found" });
    const handler = createInboxV2SourceNormalizationRuntimeHandler(processor);

    const result = await handler.process({
      ...runtimeClaim(),
      rawIngressClaim: null
    });

    expect(result).toMatchObject({
      kind: "failed",
      diagnostic: {
        codeId: "core:source-normalization-scope-invalid",
        retryable: false
      }
    });
    expect(processor.process).not.toHaveBeenCalled();
  });
});

function processorReturning(
  result: unknown
): InboxV2SourceNormalizationProcessor {
  return {
    process: vi.fn(async () => result) as never
  };
}

function runtimeClaim(): InboxV2SourceProcessingRuntimeClaim {
  return {
    attempt: {
      attemptId: "attempt-normalization",
      workId: "work-normalization",
      scope: {
        tenantId: "tenant:alpha",
        sourceConnectionId: "source_connection:alpha",
        sourceAccountId: "source_account:alpha",
        rawEventId: "raw_inbound_event:normalization",
        normalizedEventId: null,
        stage: "normalization"
      },
      origin: "initial",
      replayRequestId: null,
      attemptNumber: 1,
      maxAttempts: 3,
      workRevision: "2",
      workerId: "core:source-processing-worker",
      leaseTokenHash: `sha256:${"a".repeat(64)}`,
      leaseRevision: "2",
      leaseClaimedAt: "2026-07-17T10:00:00.000Z",
      startedAt: "2026-07-17T10:00:00.000Z",
      leaseExpiresAt: "2026-07-17T10:01:00.000Z"
    } as never,
    leaseToken: `runtime-lease-${"x".repeat(32)}`,
    rawIngressClaim: {
      claimKind: "pending",
      work: {} as never,
      leaseToken: `runtime-lease-${"x".repeat(32)}`,
      expiredLease: null
    }
  };
}
