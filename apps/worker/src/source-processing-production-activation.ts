import {
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourceProcessingStageSchema,
  type InboxV2SourceProcessingStage
} from "@hulee/contracts";

import type { InboxV2SourceNormalizationProcessor } from "./source-normalization-processor";
import { createInboxV2SourceNormalizationRuntimeHandler } from "./source-normalization-runtime-handler";
import {
  isInboxV2TrustedSourceAttachmentMaterializationHandler,
  type InboxV2TrustedSourceAttachmentMaterializationHandler
} from "./source-attachment-materialization-handler";
import type {
  InboxV2SourceProcessingRuntimeClaim,
  InboxV2SourceProcessingStageHandler
} from "./source-processing-runtime-coordinator";

const NON_RAW_SOURCE_PROCESSING_STAGES =
  inboxV2SourceProcessingStageSchema.options.filter(
    (stage): stage is InboxV2SourceProcessingDurableStage =>
      stage !== "raw_ingest"
  );

const COMPOSITE_SOURCE_PROCESSING_STAGES =
  NON_RAW_SOURCE_PROCESSING_STAGES.filter(
    (stage): stage is InboxV2SourceProcessingCompositeDurableStage =>
      stage !== "normalization" && stage !== "materialization"
  );

declare const sourceProcessingStageDurabilityBrand: unique symbol;
declare const sourceProcessingCompositeTransactionBrand: unique symbol;
declare const sourceProcessingCompositeCapabilitySetBrand: unique symbol;
declare const sourceAttachmentMaterializationCapabilityBrand: unique symbol;
declare const sourceProcessingProductionActivationBrand: unique symbol;

export type InboxV2SourceProcessingDurableStage = Exclude<
  InboxV2SourceProcessingStage,
  "raw_ingest"
>;

export type InboxV2SourceProcessingCompositeDurableStage = Exclude<
  InboxV2SourceProcessingDurableStage,
  "normalization" | "materialization"
>;

/**
 * Opaque proof that a stage handler closes its success inside the reviewed
 * durable boundary. A structurally similar handler is deliberately not this
 * capability: production activation also verifies process-local provenance.
 */
export type InboxV2TrustedSourceProcessingStageDurabilityCapability = Readonly<{
  stage: InboxV2SourceProcessingDurableStage;
  handler: InboxV2SourceProcessingStageHandler;
  boundary: "src003_atomic_normalization" | "src004_007_composite_transaction";
  readonly [sourceProcessingStageDurabilityBrand]: true;
}>;

/**
 * Local hand-off supplied by the SRC-004..007 composition root. The interface
 * is intentionally insufficient to activate production by itself; the reviewed
 * factory below must first grant a process-authentic opaque transaction token.
 */
export interface InboxV2SourceProcessingCompositeTransactionLocalPort {
  processTransactionLocally(
    stage: InboxV2SourceProcessingCompositeDurableStage,
    claim: InboxV2SourceProcessingRuntimeClaim
  ): ReturnType<InboxV2SourceProcessingStageHandler["process"]>;
}

/**
 * Process-authentic reference to the reviewed SRC-004..007 transaction-local
 * composite. Structural local ports cannot be passed to production activation:
 * this token is registered in a module-private capability registry first.
 */
export type InboxV2TrustedSourceProcessingCompositeTransaction = Readonly<{
  stageCount: number;
  readonly [sourceProcessingCompositeTransactionBrand]: true;
}>;

/**
 * Atomic, all-stage hand-off from one trusted transaction-local composite.
 * Individual downstream handlers are deliberately not exposed, so production
 * composition cannot splice partial or differently issued stage sets.
 */
export type InboxV2TrustedSourceProcessingCompositeDurabilityCapabilitySet =
  Readonly<{
    stageCount: number;
    readonly [sourceProcessingCompositeCapabilitySetBrand]: true;
  }>;

/**
 * Process-authentic proof that the materialization stage is the reviewed
 * current-head attachment reservation handler, not a generic composite
 * callback that could acknowledge work without durable reservation closure.
 */
export type InboxV2TrustedSourceAttachmentMaterializationDurabilityCapability =
  Readonly<{
    stage: "materialization";
    boundary: "msg003_source_attachment_reservation";
    readonly [sourceAttachmentMaterializationCapabilityBrand]: true;
  }>;

export type InboxV2SourceProcessingProductionActivation = Readonly<{
  stageCount: number;
  readonly [sourceProcessingProductionActivationBrand]: true;
}>;

type TrustedCompositeTransactionRegistration = Readonly<{
  issuer: object;
  processTransactionLocally: InboxV2SourceProcessingCompositeTransactionLocalPort["processTransactionLocally"];
}>;

type TrustedCompositeCapabilitySetRegistration = Readonly<{
  issuer: object;
  handlers: ReadonlyMap<
    InboxV2SourceProcessingCompositeDurableStage,
    InboxV2SourceProcessingStageHandler
  >;
}>;

const trustedNormalizationCapabilities = new WeakMap<
  object,
  InboxV2SourceProcessingStageHandler
>();
const consumedNormalizationCapabilities = new WeakSet<object>();
const trustedCompositeTransactions = new WeakMap<
  object,
  TrustedCompositeTransactionRegistration
>();
const issuedCompositeTransactions = new WeakSet<object>();
const trustedCompositeCapabilitySets = new WeakMap<
  object,
  TrustedCompositeCapabilitySetRegistration
>();
const consumedCompositeCapabilitySets = new WeakSet<object>();
const trustedMaterializationCapabilities = new WeakMap<
  object,
  InboxV2SourceProcessingStageHandler
>();
const consumedMaterializationCapabilities = new WeakSet<object>();
const trustedProductionActivations = new WeakMap<
  object,
  ReadonlyMap<InboxV2SourceProcessingStage, InboxV2SourceProcessingStageHandler>
>();

/**
 * SRC-003 exposes its own atomic durable completion boundary. Downstream stages
 * are issued separately and only as the all-or-nothing composite set below.
 */
export function createInboxV2SourceNormalizationDurabilityCapability(
  processor: InboxV2SourceNormalizationProcessor
): InboxV2TrustedSourceProcessingStageDurabilityCapability {
  const capability = Object.freeze({
    stage: "normalization" as const,
    handler: createInboxV2SourceNormalizationRuntimeHandler(processor),
    boundary: "src003_atomic_normalization" as const
  }) as InboxV2TrustedSourceProcessingStageDurabilityCapability;
  trustedNormalizationCapabilities.set(capability, capability.handler);
  return capability;
}

/**
 * Issues the only materialization capability accepted by production
 * activation. Structural handlers and copied capability objects have no
 * process-local registry authority.
 */
export function createInboxV2SourceAttachmentMaterializationDurabilityCapability(
  handler: InboxV2TrustedSourceAttachmentMaterializationHandler
): InboxV2TrustedSourceAttachmentMaterializationDurabilityCapability {
  if (!isInboxV2TrustedSourceAttachmentMaterializationHandler(handler)) {
    throw new TypeError(
      "Source attachment materialization durability requires the trusted current-head reservation handler."
    );
  }
  const capability = Object.freeze({
    stage: "materialization" as const,
    boundary: "msg003_source_attachment_reservation" as const
  }) as InboxV2TrustedSourceAttachmentMaterializationDurabilityCapability;
  trustedMaterializationCapabilities.set(capability, handler);
  return capability;
}

/**
 * Registers the one reviewed, provider-neutral transaction-local composite in
 * this worker process. The callable is captured at issuance time, preventing a
 * later mutable structural port from substituting another implementation.
 */
export function createInboxV2TrustedSourceProcessingCompositeTransaction(
  port: InboxV2SourceProcessingCompositeTransactionLocalPort
): InboxV2TrustedSourceProcessingCompositeTransaction {
  if (
    port === null ||
    typeof port !== "object" ||
    typeof port.processTransactionLocally !== "function"
  ) {
    throw new TypeError(
      "Source-processing composite transaction requires a transaction-local processor."
    );
  }

  const issuer = Object.freeze({});
  const processTransactionLocally = port.processTransactionLocally.bind(port);
  const transaction = Object.freeze({
    stageCount: COMPOSITE_SOURCE_PROCESSING_STAGES.length
  }) as InboxV2TrustedSourceProcessingCompositeTransaction;
  trustedCompositeTransactions.set(
    transaction,
    Object.freeze({ issuer, processTransactionLocally })
  );
  return transaction;
}

/**
 * Issues all downstream stage capabilities atomically from one process-local
 * provenance. The transaction can issue exactly one set; a copied, partial,
 * mixed or replayed set has no registry authority.
 */
export function createInboxV2SourceProcessingCompositeDurabilityCapabilitySet(
  transaction: InboxV2TrustedSourceProcessingCompositeTransaction
): InboxV2TrustedSourceProcessingCompositeDurabilityCapabilitySet {
  if (transaction === null || typeof transaction !== "object") {
    throw new TypeError(
      "Source-processing composite capability set requires a trusted transaction-local composite."
    );
  }
  const registration = trustedCompositeTransactions.get(transaction);
  if (registration === undefined) {
    throw new TypeError(
      "Source-processing composite capability set received an untrusted transaction-local composite."
    );
  }
  if (issuedCompositeTransactions.has(transaction)) {
    throw new TypeError(
      "Source-processing composite transaction capability set was already issued."
    );
  }

  const handlers = new Map<
    InboxV2SourceProcessingCompositeDurableStage,
    InboxV2SourceProcessingStageHandler
  >();
  for (const stage of COMPOSITE_SOURCE_PROCESSING_STAGES) {
    handlers.set(
      stage,
      createCompositeTransactionStageHandler(
        stage,
        registration.processTransactionLocally
      )
    );
  }
  const capabilitySet = Object.freeze({
    stageCount: handlers.size
  }) as InboxV2TrustedSourceProcessingCompositeDurabilityCapabilitySet;
  trustedCompositeCapabilitySets.set(
    capabilitySet,
    Object.freeze({
      issuer: registration.issuer,
      handlers: new Map(handlers)
    })
  );
  issuedCompositeTransactions.add(transaction);
  return capabilitySet;
}

/**
 * Build the only token accepted by the production worker factory. Normalization
 * and the atomic SRC-004..007 capability set are consumed together only after
 * their process-local provenance and exact stage coverage have been verified.
 */
export function createInboxV2SourceProcessingProductionActivation(input: {
  normalizationCapability: InboxV2TrustedSourceProcessingStageDurabilityCapability;
  compositeCapabilitySet: InboxV2TrustedSourceProcessingCompositeDurabilityCapabilitySet;
  materializationCapability: InboxV2TrustedSourceAttachmentMaterializationDurabilityCapability;
}): InboxV2SourceProcessingProductionActivation {
  if (input === null || typeof input !== "object") {
    throw new TypeError(
      "Source-processing production activation requires trusted durable stage capabilities."
    );
  }

  const normalizationCapability = input.normalizationCapability;
  if (
    normalizationCapability === null ||
    typeof normalizationCapability !== "object" ||
    normalizationCapability.stage !== "normalization" ||
    normalizationCapability.boundary !== "src003_atomic_normalization" ||
    trustedNormalizationCapabilities.get(normalizationCapability) !==
      normalizationCapability.handler
  ) {
    throw new TypeError(
      "Source-processing production activation received an untrusted normalization capability."
    );
  }
  if (consumedNormalizationCapabilities.has(normalizationCapability)) {
    throw new TypeError(
      "Source-processing normalization capability was already consumed."
    );
  }

  const compositeCapabilitySet = input.compositeCapabilitySet;
  if (
    compositeCapabilitySet === null ||
    typeof compositeCapabilitySet !== "object"
  ) {
    throw new TypeError(
      "Source-processing production activation requires one atomic downstream capability set."
    );
  }
  const compositeRegistration = trustedCompositeCapabilitySets.get(
    compositeCapabilitySet
  );
  if (
    compositeRegistration === undefined ||
    compositeCapabilitySet.stageCount !==
      COMPOSITE_SOURCE_PROCESSING_STAGES.length
  ) {
    throw new TypeError(
      "Source-processing production activation received an untrusted downstream capability set."
    );
  }
  if (consumedCompositeCapabilitySets.has(compositeCapabilitySet)) {
    throw new TypeError(
      "Source-processing downstream capability set was already consumed."
    );
  }

  const materializationCapability = input.materializationCapability;
  const materializationHandler =
    typeof materializationCapability === "object" &&
    materializationCapability !== null
      ? trustedMaterializationCapabilities.get(materializationCapability)
      : undefined;
  if (
    materializationHandler === undefined ||
    materializationCapability.stage !== "materialization" ||
    materializationCapability.boundary !==
      "msg003_source_attachment_reservation"
  ) {
    throw new TypeError(
      "Source-processing production activation received an untrusted attachment materialization capability."
    );
  }
  if (consumedMaterializationCapabilities.has(materializationCapability)) {
    throw new TypeError(
      "Source attachment materialization capability was already consumed."
    );
  }

  const handlers = new Map<
    InboxV2SourceProcessingStage,
    InboxV2SourceProcessingStageHandler
  >();
  handlers.set("raw_ingest", rejectedRawIngressHandler);
  handlers.set("normalization", normalizationCapability.handler);
  for (const stage of COMPOSITE_SOURCE_PROCESSING_STAGES) {
    const handler = compositeRegistration.handlers.get(stage);
    if (handler === undefined) {
      throw new TypeError(
        `Source-processing downstream capability set is incomplete at stage: ${stage}.`
      );
    }
    handlers.set(stage, handler);
  }
  handlers.set("materialization", materializationHandler);

  const missingStages = NON_RAW_SOURCE_PROCESSING_STAGES.filter(
    (stage) => !handlers.has(stage)
  );
  if (missingStages.length > 0) {
    throw new TypeError(
      `Source-processing production activation is blocked until trusted durable stage capabilities exist: ${missingStages.join(
        ", "
      )}.`
    );
  }

  consumedNormalizationCapabilities.add(normalizationCapability);
  consumedCompositeCapabilitySets.add(compositeCapabilitySet);
  consumedMaterializationCapabilities.add(materializationCapability);
  const activation = Object.freeze({
    stageCount: handlers.size
  }) as InboxV2SourceProcessingProductionActivation;
  trustedProductionActivations.set(
    activation,
    new Map(handlers) as ReadonlyMap<
      InboxV2SourceProcessingStage,
      InboxV2SourceProcessingStageHandler
    >
  );
  return activation;
}

export function resolveInboxV2SourceProcessingProductionHandlers(
  activation: unknown
): ReadonlyMap<
  InboxV2SourceProcessingStage,
  InboxV2SourceProcessingStageHandler
> {
  if (
    activation === null ||
    typeof activation !== "object" ||
    !trustedProductionActivations.has(activation)
  ) {
    throw new TypeError(
      "Source-processing production runtime requires a trusted durable activation capability."
    );
  }
  return new Map(trustedProductionActivations.get(activation)!);
}

export function inboxV2SourceProcessingCompositeStages(): readonly InboxV2SourceProcessingCompositeDurableStage[] {
  return Object.freeze([...COMPOSITE_SOURCE_PROCESSING_STAGES]);
}

function createCompositeTransactionStageHandler(
  stage: InboxV2SourceProcessingCompositeDurableStage,
  processTransactionLocally: InboxV2SourceProcessingCompositeTransactionLocalPort["processTransactionLocally"]
): InboxV2SourceProcessingStageHandler {
  return Object.freeze({
    process(claim) {
      if (
        claim.attempt.scope.stage !== stage ||
        claim.attempt.scope.normalizedEventId === null ||
        claim.rawIngressClaim !== null
      ) {
        return Object.freeze({
          kind: "failed" as const,
          diagnostic: inboxV2SafeSourceDiagnosticSchema.parse({
            codeId: "core:source-composite-stage-scope-invalid",
            retryable: false,
            correlationToken: claim.attempt.attemptId,
            safeOperatorHintId: "core:inspect-source-runtime"
          })
        });
      }
      return processTransactionLocally(stage, claim);
    }
  });
}

const rejectedRawIngressHandler: InboxV2SourceProcessingStageHandler =
  Object.freeze({
    process(claim) {
      return Object.freeze({
        kind: "failed" as const,
        diagnostic: inboxV2SafeSourceDiagnosticSchema.parse({
          codeId: "core:source-raw-ingress-runtime-claim-invalid",
          retryable: false,
          correlationToken: claim.attempt.attemptId,
          safeOperatorHintId: "core:inspect-source-runtime"
        })
      });
    }
  });
