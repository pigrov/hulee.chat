import { inboxV2SourceProcessingStageSchema } from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2SourceNormalizationDurabilityCapability,
  createInboxV2SourceProcessingCompositeDurabilityCapabilitySet,
  createInboxV2SourceProcessingProductionActivation,
  createInboxV2TrustedSourceProcessingCompositeTransaction,
  inboxV2SourceProcessingCompositeStages,
  resolveInboxV2SourceProcessingProductionHandlers,
  type InboxV2SourceProcessingCompositeDurableStage,
  type InboxV2SourceProcessingCompositeTransactionLocalPort,
  type InboxV2TrustedSourceProcessingCompositeDurabilityCapabilitySet,
  type InboxV2TrustedSourceProcessingCompositeTransaction
} from "./source-processing-production-activation";
import type { InboxV2SourceProcessingRuntimeClaim } from "./source-processing-runtime-coordinator";

describe("Inbox V2 source-processing production activation", () => {
  it("activates the exact full stage set from one process-local composite", async () => {
    const normalizationProcess = vi.fn(async () => ({
      outcome: "completed" as const,
      completion: { outcome: "normalized" as const }
    }));
    const processTransactionLocally = vi.fn(
      async (
        _stage: InboxV2SourceProcessingCompositeDurableStage,
        _claim: InboxV2SourceProcessingRuntimeClaim
      ) => ({ kind: "processed" as const })
    );
    const activation = createActivation({
      normalizationProcess,
      processTransactionLocally
    });

    expect(activation.stageCount).toBe(
      inboxV2SourceProcessingStageSchema.options.length
    );
    const handlers =
      resolveInboxV2SourceProcessingProductionHandlers(activation);
    expect([...handlers.keys()]).toEqual(
      inboxV2SourceProcessingStageSchema.options
    );

    for (const stage of inboxV2SourceProcessingCompositeStages()) {
      const claim = runtimeClaim(stage);
      await expect(handlers.get(stage)!.process(claim)).resolves.toEqual({
        kind: "processed"
      });
      expect(processTransactionLocally).toHaveBeenLastCalledWith(stage, claim);
    }

    await expect(
      handlers.get("normalization")!.process(runtimeClaim("normalization"))
    ).resolves.toEqual({ kind: "processed" });
    expect(normalizationProcess).toHaveBeenCalledOnce();
    expect(processTransactionLocally).toHaveBeenCalledTimes(5);

    expect(
      await Promise.resolve(
        handlers.get("raw_ingest")!.process(runtimeClaim("raw_ingest"))
      )
    ).toMatchObject({
      kind: "failed",
      diagnostic: { codeId: "core:source-raw-ingress-runtime-claim-invalid" }
    });
    expect(processTransactionLocally).toHaveBeenCalledTimes(5);
  });

  it("rejects structural, partial and mixed composite capability sets", () => {
    const normalization = createNormalizationCapability();
    const port = compositePort();

    expect(() =>
      createInboxV2SourceProcessingCompositeDurabilityCapabilitySet(
        port as unknown as InboxV2TrustedSourceProcessingCompositeTransaction
      )
    ).toThrow(/untrusted transaction-local composite/u);

    const first = createCompositeCapabilitySet(port);
    const second = createCompositeCapabilitySet(compositePort());
    const partial = Object.freeze({ stageCount: 4 });
    const mixedCopy = Object.freeze({ ...first, ...second });

    for (const forged of [partial, mixedCopy]) {
      expect(() =>
        createInboxV2SourceProcessingProductionActivation({
          normalizationCapability: normalization,
          compositeCapabilitySet:
            forged as InboxV2TrustedSourceProcessingCompositeDurabilityCapabilitySet
        })
      ).toThrow(/untrusted downstream capability set/u);
    }
  });

  it("consumes transaction issuance and activation capability sets exactly once", () => {
    const transaction =
      createInboxV2TrustedSourceProcessingCompositeTransaction(compositePort());
    const compositeCapabilitySet =
      createInboxV2SourceProcessingCompositeDurabilityCapabilitySet(
        transaction
      );

    expect(() =>
      createInboxV2SourceProcessingCompositeDurabilityCapabilitySet(transaction)
    ).toThrow(/already issued/u);

    createInboxV2SourceProcessingProductionActivation({
      normalizationCapability: createNormalizationCapability(),
      compositeCapabilitySet
    });
    expect(() =>
      createInboxV2SourceProcessingProductionActivation({
        normalizationCapability: createNormalizationCapability(),
        compositeCapabilitySet
      })
    ).toThrow(/already consumed/u);
  });

  it("pins every handler to its issued stage and captures the original local callable", async () => {
    const original = vi.fn(
      async (
        _stage: InboxV2SourceProcessingCompositeDurableStage,
        _claim: InboxV2SourceProcessingRuntimeClaim
      ) => ({ kind: "processed" as const })
    );
    const replacement = vi.fn(async () => ({ kind: "duplicate" as const }));
    const port: InboxV2SourceProcessingCompositeTransactionLocalPort = {
      processTransactionLocally: original
    };
    const transaction =
      createInboxV2TrustedSourceProcessingCompositeTransaction(port);
    port.processTransactionLocally = replacement as never;
    const activation = createInboxV2SourceProcessingProductionActivation({
      normalizationCapability: createNormalizationCapability(),
      compositeCapabilitySet:
        createInboxV2SourceProcessingCompositeDurabilityCapabilitySet(
          transaction
        )
    });
    const handlers =
      resolveInboxV2SourceProcessingProductionHandlers(activation);
    const routingHandler = handlers.get("routing")!;
    const routingClaim = runtimeClaim("routing");

    await expect(routingHandler.process(routingClaim)).resolves.toEqual({
      kind: "processed"
    });
    expect(original).toHaveBeenCalledWith("routing", routingClaim);
    expect(replacement).not.toHaveBeenCalled();

    expect(
      await Promise.resolve(
        routingHandler.process(runtimeClaim("conversation_resolution"))
      )
    ).toMatchObject({
      kind: "failed",
      diagnostic: { codeId: "core:source-composite-stage-scope-invalid" }
    });
    expect(original).toHaveBeenCalledOnce();
  });

  it("does not treat arbitrary handler maps or activation clones as trusted", () => {
    const handlers = new Map(
      inboxV2SourceProcessingStageSchema.options.map((stage) => [
        stage,
        { process: vi.fn() }
      ])
    );
    const activation = createActivation();

    expect(() =>
      resolveInboxV2SourceProcessingProductionHandlers({ handlers })
    ).toThrow(/trusted durable activation capability/u);
    expect(() =>
      resolveInboxV2SourceProcessingProductionHandlers({ ...activation })
    ).toThrow(/trusted durable activation capability/u);
  });

  it("publishes the exact downstream hand-off stages without raw or normalization", () => {
    expect(inboxV2SourceProcessingCompositeStages()).toEqual([
      "identity_resolution",
      "conversation_resolution",
      "routing",
      "message_reconciliation",
      "materialization"
    ]);
  });
});

function createActivation(input?: {
  normalizationProcess?: ReturnType<typeof vi.fn>;
  processTransactionLocally?: ReturnType<typeof vi.fn>;
}) {
  const normalizationCapability =
    createInboxV2SourceNormalizationDurabilityCapability({
      process: (input?.normalizationProcess ??
        vi.fn(async () => ({
          outcome: "completed",
          completion: { outcome: "normalized" }
        }))) as never
    });
  const compositeCapabilitySet = createCompositeCapabilitySet({
    processTransactionLocally: (input?.processTransactionLocally ??
      vi.fn(async () => ({ kind: "processed" as const }))) as never
  });
  return createInboxV2SourceProcessingProductionActivation({
    normalizationCapability,
    compositeCapabilitySet
  });
}

function createNormalizationCapability() {
  return createInboxV2SourceNormalizationDurabilityCapability({
    process: vi.fn(async () => ({
      outcome: "completed",
      completion: { outcome: "normalized" }
    })) as never
  });
}

function createCompositeCapabilitySet(
  port: InboxV2SourceProcessingCompositeTransactionLocalPort
) {
  return createInboxV2SourceProcessingCompositeDurabilityCapabilitySet(
    createInboxV2TrustedSourceProcessingCompositeTransaction(port)
  );
}

function compositePort(): InboxV2SourceProcessingCompositeTransactionLocalPort {
  return {
    processTransactionLocally: vi.fn(async () => ({
      kind: "processed" as const
    }))
  };
}

function runtimeClaim(
  stage:
    | "raw_ingest"
    | "normalization"
    | InboxV2SourceProcessingCompositeDurableStage
): InboxV2SourceProcessingRuntimeClaim {
  return {
    attempt: {
      attemptId: `attempt-${stage}`,
      scope: {
        stage,
        normalizedEventId:
          stage === "raw_ingest" || stage === "normalization"
            ? null
            : "normalized_inbound_event:test"
      }
    },
    rawIngressClaim:
      stage === "normalization"
        ? {
            claimKind: "pending",
            work: {},
            leaseToken: `normalization-${"x".repeat(32)}`,
            expiredLease: null
          }
        : null
  } as unknown as InboxV2SourceProcessingRuntimeClaim;
}
