import {
  InboxV2SourceNormalizationError,
  inboxV2SafeSourceDiagnosticSchema
} from "@hulee/contracts";

import type { InboxV2SourceNormalizationProcessor } from "./source-normalization-processor";
import type {
  InboxV2SourceProcessingHandlerResult,
  InboxV2SourceProcessingRuntimeClaim,
  InboxV2SourceProcessingStageHandler
} from "./source-processing-runtime-coordinator";

/**
 * Adapts the existing SRC-003 normalizer to the shared SRC-008 lifecycle. The
 * runtime and raw-ingress claims are already cross-fenced by the repository;
 * this adapter never receives provider bytes outside the restricted
 * normalization repository.
 */
export function createInboxV2SourceNormalizationRuntimeHandler(
  processor: InboxV2SourceNormalizationProcessor
): InboxV2SourceProcessingStageHandler {
  if (processor === null || typeof processor?.process !== "function") {
    throw new TypeError(
      "Source normalization runtime requires the SRC-003 processor capability."
    );
  }

  return Object.freeze({
    async process(
      claim: InboxV2SourceProcessingRuntimeClaim
    ): Promise<InboxV2SourceProcessingHandlerResult> {
      if (
        claim.attempt.scope.stage !== "normalization" ||
        claim.rawIngressClaim === null
      ) {
        return failed(claim, "core:source-normalization-scope-invalid", false);
      }

      try {
        const result = await processor.process(claim.rawIngressClaim);
        if (
          result.outcome === "completed" ||
          result.outcome === "already_completed"
        ) {
          if (result.completion.outcome === "ignored") {
            return {
              kind: "ignored",
              diagnostic: diagnostic(
                claim,
                "core:source-normalization-ignored",
                false
              )
            };
          }
          return { kind: "processed" };
        }
        if (result.outcome === "quarantined") {
          return failed(claim, "core:source-idempotency-collision", false);
        }
        if (result.outcome === "evidence_unavailable") {
          return failed(claim, "core:source-evidence-unavailable", false);
        }
        return failed(
          claim,
          leaseFailureCode(result.outcome),
          result.outcome === "lease_expired" ||
            result.outcome === "lease_revision_conflict"
        );
      } catch (error) {
        if (error instanceof InboxV2SourceNormalizationError) {
          return failed(claim, normalizationCode(error.code), error.retryable);
        }
        return failed(claim, "core:source-normalizer-failed", true);
      }
    }
  });
}

function failed(
  claim: InboxV2SourceProcessingRuntimeClaim,
  codeId: string,
  retryable: boolean
): InboxV2SourceProcessingHandlerResult {
  return {
    kind: "failed",
    diagnostic: diagnostic(claim, codeId, retryable)
  };
}

function diagnostic(
  claim: InboxV2SourceProcessingRuntimeClaim,
  codeId: string,
  retryable: boolean
) {
  return inboxV2SafeSourceDiagnosticSchema.parse({
    codeId,
    retryable,
    correlationToken: claim.attempt.attemptId,
    safeOperatorHintId: retryable
      ? "core:retry-source-processing"
      : "core:inspect-source-dlq"
  });
}

function normalizationCode(code: string): string {
  const suffix = code
    .replace(/^source\./u, "")
    .replaceAll("_", "-")
    .replaceAll(".", "-");
  return `core:source-${suffix}`;
}

function leaseFailureCode(outcome: string): string {
  return `core:source-raw-${outcome.replaceAll("_", "-")}`;
}
