import {
  executeInboxV2SourceNormalizer,
  InboxV2SourceNormalizationError,
  inboxV2RawIngressClaimSchema,
  type InboxV2ClaimRawIngressResult,
  type InboxV2CompleteSourceNormalizationResult,
  type InboxV2LoadClaimedSourceNormalizationResult,
  type InboxV2SourceNormalizationRepositoryPort
} from "@hulee/contracts";
import type { SourceAdapterRegistry } from "@hulee/modules";

export type InboxV2SourceNormalizationClaim = Extract<
  InboxV2ClaimRawIngressResult,
  { outcome: "claimed" }
>["claims"][number];

export type InboxV2SourceNormalizationProcessResult =
  | InboxV2CompleteSourceNormalizationResult
  | Exclude<InboxV2LoadClaimedSourceNormalizationResult, { outcome: "loaded" }>;

export type InboxV2SourceNormalizationProcessor = Readonly<{
  process(
    claim: InboxV2SourceNormalizationClaim
  ): Promise<InboxV2SourceNormalizationProcessResult>;
}>;

export type InboxV2SourceNormalizationProcessorOptions = Readonly<{
  repository: InboxV2SourceNormalizationRepositoryPort;
  sourceAdapterRegistry: SourceAdapterRegistry;
}>;

/**
 * Runs one already-leased SRC-002 work item through the adapter-declared
 * normalizer. The worker never accepts raw provider data from its caller: it
 * loads the exact persisted evidence through the fenced repository port and
 * carries the same lease fence into atomic completion.
 */
export function createInboxV2SourceNormalizationProcessor(
  options: InboxV2SourceNormalizationProcessorOptions
): InboxV2SourceNormalizationProcessor {
  return Object.freeze({
    async process(claimInput) {
      const claim = inboxV2RawIngressClaimSchema.parse(claimInput);
      const lease = claim.work.lease;
      if (lease === null) {
        // The claim schema already rejects this state. Keep the explicit guard
        // so the fence is never assembled through a non-null assertion.
        throw new TypeError(
          "Source normalization requires an actively leased raw-ingress claim."
        );
      }

      const leaseFence = {
        tenantId: claim.work.tenantId,
        rawEventId: claim.work.rawEventId,
        workerId: lease.workerId,
        leaseToken: claim.leaseToken,
        expectedLeaseRevision: lease.leaseRevision
      } as const;
      const loaded = await options.repository.loadClaimedInput(leaseFence);
      if (loaded.outcome !== "loaded") return loaded;

      const registration = options.sourceAdapterRegistry.getRegistration(
        loaded.sourceName
      );
      const normalizer = options.sourceAdapterRegistry.getSourceNormalizer(
        loaded.sourceName
      );
      if (registration === null || normalizer === null) {
        throw normalizationError("source.normalizer_missing");
      }

      const declaration = registration.declaration.payload;
      if (
        declaration.sourceName !== loaded.sourceName ||
        declaration.sourceTypeId !== loaded.sourceTypeId ||
        declaration.normalization.mode !== "supported" ||
        registration.sourceNormalizer !== normalizer
      ) {
        throw normalizationError("source.normalizer_mismatch");
      }

      const candidate = await executeInboxV2SourceNormalizer({
        normalizer,
        raw: loaded.raw
      });

      return options.repository.complete({
        candidate,
        ...leaseFence
      });
    }
  });
}

function normalizationError(
  code: "source.normalizer_missing" | "source.normalizer_mismatch"
): InboxV2SourceNormalizationError {
  return new InboxV2SourceNormalizationError(code, false);
}
