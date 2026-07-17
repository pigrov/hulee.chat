import {
  canonicalizeInboxV2Json,
  inboxV2DeferredMessageSourceActionSchema,
  inboxV2DeferredMessageSourceActionIdSchema,
  inboxV2ExternalMessageReferenceIdSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageTransportOccurrenceLinkIdSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SourceMessageReconciliationPlanSchema,
  inboxV2SourceMessageReconciliationRequestSchema,
  inboxV2SourceOccurrenceSchema,
  inboxV2SourceOccurrenceIdSchema,
  inboxV2TimelineItemIdSchema,
  inboxV2TimestampSchema,
  type InboxV2ExternalMessageKey,
  type InboxV2SourceMessageReconciliationPlan,
  type InboxV2SourceMessageReconciliationRequest,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";

const MATERIALIZER_OPTION_KEYS = new Set([
  "trustedServiceId",
  "namespaceDeriver",
  "clock"
]);
const trustedMaterializers = new WeakSet<object>();

export type InboxV2SourceMessageNamespacePurpose =
  | "source_occurrence_id"
  | "external_message_reference_id"
  | "timeline_item_id"
  | "message_id"
  | "message_transport_occurrence_link_id"
  | "deferred_message_source_action_id"
  | "pending_diagnostic"
  | "materialization_authorization";

export type InboxV2SourceMessageNamespaceDeriver = Readonly<{
  namespaceGeneration: string;
  deriveNamespaceHmacSha256(input: {
    tenantId: string;
    trustedServiceId: string;
    namespaceGeneration: string;
    purpose: InboxV2SourceMessageNamespacePurpose;
    canonicalPreimage: string;
  }): string;
}>;

export type InboxV2SourceMessageReconciliationClock = Readonly<{
  now(): string;
}>;

export type InboxV2TrustedSourceMessageReconciliationMaterializer = Readonly<{
  materialize(
    request: InboxV2SourceMessageReconciliationRequest
  ): InboxV2SourceMessageReconciliationPlan;
}>;

export type InboxV2SourceMessageReconciliationAuthorizationInput = Readonly<
  Omit<InboxV2SourceMessageReconciliationPlan, "materializationToken">
>;

export type InboxV2SourceMessageReconciliationMaterializerErrorCode =
  | "source.message_reconciliation.request_invalid"
  | "source.message_reconciliation.materializer_service_mismatch"
  | "source.message_reconciliation.namespace_derivation_invalid"
  | "source.message_reconciliation.materialization_clock_invalid"
  | "source.message_reconciliation.plan_invalid";

export class InboxV2SourceMessageReconciliationMaterializerError extends Error {
  readonly code: InboxV2SourceMessageReconciliationMaterializerErrorCode;
  readonly retryable = false;

  constructor(
    code: InboxV2SourceMessageReconciliationMaterializerErrorCode,
    options: { cause?: unknown } = {}
  ) {
    super(
      code,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "InboxV2SourceMessageReconciliationMaterializerError";
    this.code = code;
  }
}

/**
 * Creates a pure trusted planner. It performs no provider I/O and no database
 * access; the SQL coordinator remains responsible for exact-key locking,
 * collision comparison and atomic publication.
 */
export function createInboxV2TrustedSourceMessageReconciliationMaterializer(input: {
  trustedServiceId: string;
  namespaceDeriver: InboxV2SourceMessageNamespaceDeriver;
  clock: InboxV2SourceMessageReconciliationClock;
}): InboxV2TrustedSourceMessageReconciliationMaterializer {
  assertExactOptions(input);
  const trustedServiceId = inboxV2RoutingTrustedServiceIdSchema.parse(
    input.trustedServiceId
  );
  const namespaceGeneration = inboxV2RoutingTokenSchema.parse(
    input.namespaceDeriver.namespaceGeneration
  );
  if (
    typeof input.namespaceDeriver.deriveNamespaceHmacSha256 !== "function" ||
    typeof input.clock.now !== "function"
  ) {
    throw new TypeError(
      "Source-message reconciliation requires a namespace deriver and clock."
    );
  }

  const materializer: InboxV2TrustedSourceMessageReconciliationMaterializer =
    Object.freeze({
      materialize(untrustedRequest) {
        const request = parseRequest(untrustedRequest);
        const source = request.context.plan.source;
        if (
          String(source.adapterContract.loadedByTrustedServiceId) !==
          String(trustedServiceId)
        ) {
          throw materializerError(
            "source.message_reconciliation.materializer_service_mismatch"
          );
        }

        const messageKey = buildExactMessageKey(request);
        const occurrence = buildSourceOccurrence({
          request,
          messageKey,
          trustedServiceId,
          namespaceGeneration,
          namespaceDeriver: input.namespaceDeriver
        });
        const candidateExternalMessageReferenceId =
          inboxV2ExternalMessageReferenceIdSchema.parse(
            `external_message_reference:${deriveCandidateDigest(
              input.namespaceDeriver,
              trustedServiceId,
              namespaceGeneration,
              source.tenantId,
              "external_message_reference_id",
              "core:inbox-v2.external-message-reference-candidate",
              { messageKey }
            )}`
          );
        const intent = buildPlanIntent({
          request,
          messageKey,
          occurrence,
          candidateExternalMessageReferenceId,
          trustedServiceId,
          namespaceGeneration,
          namespaceDeriver: input.namespaceDeriver
        });
        const materializedAt = readMaterializationTime(input.clock);
        if (
          Date.parse(materializedAt) < Date.parse(request.context.resolvedAt)
        ) {
          throw materializerError(
            "source.message_reconciliation.materialization_clock_invalid"
          );
        }

        const unsignedPlan = {
          context: request.context,
          messageKey,
          sourceOccurrence: occurrence,
          candidateExternalMessageReferenceId,
          intent,
          weakCorrelationEvidence: request.descriptor.weakCorrelationEvidence,
          namespaceGeneration,
          materializedByTrustedServiceId: trustedServiceId,
          materializedAt
        } satisfies InboxV2SourceMessageReconciliationAuthorizationInput;
        const authorizationDigest =
          deriveInboxV2SourceMessageReconciliationAuthorizationDigest(
            input.namespaceDeriver,
            unsignedPlan
          );

        try {
          return deepFreeze(
            inboxV2SourceMessageReconciliationPlanSchema.parse({
              ...unsignedPlan,
              materializationToken: `source-message-reconciliation:v1:${authorizationDigest}`
            })
          );
        } catch (cause) {
          throw materializerError(
            "source.message_reconciliation.plan_invalid",
            cause
          );
        }
      }
    });

  trustedMaterializers.add(materializer);
  return materializer;
}

export function isInboxV2TrustedSourceMessageReconciliationMaterializer(
  value: unknown
): value is InboxV2TrustedSourceMessageReconciliationMaterializer {
  return (
    typeof value === "object" &&
    value !== null &&
    trustedMaterializers.has(value)
  );
}

function buildExactMessageKey(
  request: InboxV2SourceMessageReconciliationRequest
): InboxV2ExternalMessageKey {
  const declaration = request.descriptor.messageIdentityDeclaration;
  const source = request.context.plan.source;
  const binding = request.context.sourceThreadBinding.binding;
  const externalThread = {
    tenantId: source.tenantId,
    kind: "external_thread" as const,
    id: request.context.externalThreadMapping.thread.id
  };
  const scope =
    declaration.scopeKind === "provider_thread"
      ? ({ kind: "provider_thread" } as const)
      : declaration.scopeKind === "source_account"
        ? ({ kind: "source_account", owner: source.sourceAccount } as const)
        : ({
            kind: "source_thread_binding",
            owner: {
              tenantId: source.tenantId,
              kind: "source_thread_binding" as const,
              id: binding.id
            }
          } as const);

  return {
    realm: {
      realmId: declaration.realmId,
      realmVersion: declaration.realmVersion,
      canonicalizationVersion: declaration.canonicalizationVersion
    },
    scope,
    objectKindId: declaration.objectKindId,
    externalThread,
    canonicalExternalSubject: request.descriptor.canonicalExternalSubject
  };
}

function buildSourceOccurrence(input: {
  request: InboxV2SourceMessageReconciliationRequest;
  messageKey: InboxV2ExternalMessageKey;
  trustedServiceId: string;
  namespaceGeneration: string;
  namespaceDeriver: InboxV2SourceMessageNamespaceDeriver;
}): InboxV2SourceOccurrence {
  const { request, messageKey } = input;
  const source = request.context.plan.source;
  const binding = request.context.sourceThreadBinding.binding;
  const descriptor = request.descriptor;
  const origin = {
    kind: descriptor.occurrence.origin.kind,
    sourceAccount: source.sourceAccount,
    rawInboundEvent: source.rawInboundEvent,
    normalizedInboundEvent: source.normalizedInboundEvent
  };
  const occurrenceIdentity = {
    messageKey,
    sourceAccount: source.sourceAccount,
    sourceThreadBinding: {
      tenantId: source.tenantId,
      kind: "source_thread_binding" as const,
      id: binding.id
    },
    origin
  };
  const occurrenceDigest = deriveCandidateDigest(
    input.namespaceDeriver,
    input.trustedServiceId,
    input.namespaceGeneration,
    source.tenantId,
    "source_occurrence_id",
    "core:inbox-v2.source-occurrence-candidate",
    occurrenceIdentity
  );
  const diagnosticDigest = deriveCandidateDigest(
    input.namespaceDeriver,
    input.trustedServiceId,
    input.namespaceGeneration,
    source.tenantId,
    "pending_diagnostic",
    "core:inbox-v2.source-message-pending-diagnostic",
    { occurrenceIdentity, intentKind: descriptor.intent.kind }
  );

  return inboxV2SourceOccurrenceSchema.parse({
    tenantId: source.tenantId,
    id: inboxV2SourceOccurrenceIdSchema.parse(
      `source_occurrence:${occurrenceDigest}`
    ),
    messageKey,
    messageIdentityDeclaration: descriptor.messageIdentityDeclaration,
    bindingContext: {
      externalThread: messageKey.externalThread,
      sourceAccount: source.sourceAccount,
      sourceThreadBinding: occurrenceIdentity.sourceThreadBinding,
      bindingGeneration: binding.bindingGeneration
    },
    origin,
    descriptor: descriptor.occurrence.descriptor,
    providerActor: descriptor.occurrence.providerActor,
    direction: descriptor.occurrence.direction,
    providerTimestamps: descriptor.occurrence.providerTimestamps,
    referencePortability: descriptor.occurrence.referencePortability,
    resolution: {
      state: "pending",
      diagnostic: {
        codeId: "core:source-message-exact-target-pending",
        retryable: true,
        correlationToken: `source-message-pending:${diagnosticDigest}`,
        safeOperatorHintId: null
      }
    },
    observedAt: descriptor.occurrence.observedAt,
    recordedAt: source.recordedAt,
    revision: "1",
    createdAt: source.recordedAt,
    updatedAt: source.recordedAt
  });
}

function buildPlanIntent(input: {
  request: InboxV2SourceMessageReconciliationRequest;
  messageKey: InboxV2ExternalMessageKey;
  occurrence: InboxV2SourceOccurrence;
  candidateExternalMessageReferenceId: string;
  trustedServiceId: string;
  namespaceGeneration: string;
  namespaceDeriver: InboxV2SourceMessageNamespaceDeriver;
}): InboxV2SourceMessageReconciliationPlan["intent"] {
  const source = input.request.context.plan.source;
  const descriptorIntent = input.request.descriptor.intent;
  const derive = (
    purpose: InboxV2SourceMessageNamespacePurpose,
    domain: string,
    identity: unknown
  ) =>
    deriveCandidateDigest(
      input.namespaceDeriver,
      input.trustedServiceId,
      input.namespaceGeneration,
      source.tenantId,
      purpose,
      domain,
      identity
    );

  if (descriptorIntent.kind === "message_create") {
    const candidateTimelineItemId = inboxV2TimelineItemIdSchema.parse(
      `timeline_item:${derive(
        "timeline_item_id",
        "core:inbox-v2.source-message-timeline-item-candidate",
        { messageKey: input.messageKey }
      )}`
    );
    const candidateMessageId = inboxV2MessageIdSchema.parse(
      `message:${derive(
        "message_id",
        "core:inbox-v2.source-message-candidate",
        { messageKey: input.messageKey }
      )}`
    );
    return {
      kind: "message_create",
      transportRole: descriptorIntent.transportRole,
      candidateTimelineItemId,
      candidateMessageId,
      candidateTransportLinkId:
        inboxV2MessageTransportOccurrenceLinkIdSchema.parse(
          `message_transport_occurrence_link:${derive(
            "message_transport_occurrence_link_id",
            "core:inbox-v2.source-message-transport-link-candidate",
            {
              sourceOccurrenceId: input.occurrence.id,
              candidateExternalMessageReferenceId:
                input.candidateExternalMessageReferenceId,
              transportRole: descriptorIntent.transportRole
            }
          )}`
        )
    };
  }

  if (descriptorIntent.kind === "echo_handoff") {
    return {
      kind: "echo_handoff",
      transportRole: descriptorIntent.transportRole,
      candidateTransportLinkId:
        inboxV2MessageTransportOccurrenceLinkIdSchema.parse(
          `message_transport_occurrence_link:${derive(
            "message_transport_occurrence_link_id",
            "core:inbox-v2.source-message-transport-link-candidate",
            {
              sourceOccurrenceId: input.occurrence.id,
              candidateExternalMessageReferenceId:
                input.candidateExternalMessageReferenceId,
              transportRole: descriptorIntent.transportRole
            }
          )}`
        )
    };
  }

  const idempotencyKey = {
    normalizedInboundEvent: descriptorIntent.action.normalizedEvent,
    sourceOccurrence: {
      tenantId: source.tenantId,
      kind: "source_occurrence" as const,
      id: input.occurrence.id
    },
    semanticId: descriptorIntent.semanticProof.semanticId,
    eventFingerprintSha256: descriptorIntent.eventFingerprintSha256
  };
  const candidateDeferredActionId =
    inboxV2DeferredMessageSourceActionIdSchema.parse(
      `deferred_message_source_action:${derive(
        "deferred_message_source_action_id",
        "core:inbox-v2.deferred-message-source-action-candidate",
        { messageKey: input.messageKey, idempotencyKey }
      )}`
    );
  const deferredAction = inboxV2DeferredMessageSourceActionSchema.parse({
    tenantId: source.tenantId,
    id: candidateDeferredActionId,
    externalMessageKey: input.messageKey,
    sourceOccurrence: input.occurrence,
    action: descriptorIntent.action,
    semanticProof: descriptorIntent.semanticProof,
    idempotencyKey,
    state: { state: "pending" as const },
    revision: "1",
    observedAt: input.occurrence.observedAt,
    recordedAt: input.occurrence.recordedAt,
    createdAt: input.occurrence.recordedAt,
    updatedAt: input.occurrence.recordedAt
  });

  return {
    kind: "source_action",
    candidateDeferredActionId,
    deferredAction
  };
}

/** Shared complete authorization projection used by materializer and verifier. */
export function buildInboxV2SourceMessageReconciliationAuthorizationPreimage(
  input: InboxV2SourceMessageReconciliationAuthorizationInput
): string {
  return canonicalizeInboxV2Json({
    domain: "core:inbox-v2.source-message-reconciliation-authorization",
    version: "v1",
    tenantId: input.context.plan.source.tenantId,
    trustedServiceId: input.materializedByTrustedServiceId,
    namespaceGeneration: input.namespaceGeneration,
    context: input.context,
    messageKey: input.messageKey,
    sourceOccurrence: input.sourceOccurrence,
    candidateExternalMessageReferenceId:
      input.candidateExternalMessageReferenceId,
    intent: input.intent,
    weakCorrelationEvidence: input.weakCorrelationEvidence,
    materializedAt: input.materializedAt
  });
}

export function deriveInboxV2SourceMessageReconciliationAuthorizationDigest(
  deriver: InboxV2SourceMessageNamespaceDeriver,
  input: InboxV2SourceMessageReconciliationAuthorizationInput
): string {
  return deriveTenantDigest(deriver, {
    tenantId: input.context.plan.source.tenantId,
    trustedServiceId: input.materializedByTrustedServiceId,
    namespaceGeneration: input.namespaceGeneration,
    purpose: "materialization_authorization",
    canonicalPreimage:
      buildInboxV2SourceMessageReconciliationAuthorizationPreimage(input)
  });
}

function deriveCandidateDigest(
  deriver: InboxV2SourceMessageNamespaceDeriver,
  trustedServiceId: string,
  namespaceGeneration: string,
  tenantId: string,
  purpose: InboxV2SourceMessageNamespacePurpose,
  domain: string,
  identity: unknown
): string {
  return deriveTenantDigest(deriver, {
    tenantId,
    trustedServiceId,
    namespaceGeneration,
    purpose,
    canonicalPreimage: canonicalizeInboxV2Json({
      domain,
      version: "v1",
      tenantId,
      trustedServiceId,
      namespaceGeneration,
      identity
    })
  });
}

function deriveTenantDigest(
  deriver: InboxV2SourceMessageNamespaceDeriver,
  input: Parameters<
    InboxV2SourceMessageNamespaceDeriver["deriveNamespaceHmacSha256"]
  >[0]
): string {
  let digest: string;
  try {
    digest = deriver.deriveNamespaceHmacSha256(input);
  } catch (cause) {
    throw materializerError(
      "source.message_reconciliation.namespace_derivation_invalid",
      cause
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw materializerError(
      "source.message_reconciliation.namespace_derivation_invalid"
    );
  }
  return digest;
}

function parseRequest(
  request: InboxV2SourceMessageReconciliationRequest
): InboxV2SourceMessageReconciliationRequest {
  try {
    return inboxV2SourceMessageReconciliationRequestSchema.parse(request);
  } catch (cause) {
    throw materializerError(
      "source.message_reconciliation.request_invalid",
      cause
    );
  }
}

function readMaterializationTime(
  clock: InboxV2SourceMessageReconciliationClock
): string {
  try {
    return inboxV2TimestampSchema.parse(clock.now());
  } catch (cause) {
    throw materializerError(
      "source.message_reconciliation.materialization_clock_invalid",
      cause
    );
  }
}

function assertExactOptions(input: object): void {
  const keys = Object.keys(input);
  if (
    keys.length !== MATERIALIZER_OPTION_KEYS.size ||
    keys.some((key) => !MATERIALIZER_OPTION_KEYS.has(key))
  ) {
    throw new TypeError(
      "Source-message materializer accepts only trustedServiceId, namespaceDeriver and clock."
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function materializerError(
  code: InboxV2SourceMessageReconciliationMaterializerErrorCode,
  cause?: unknown
): InboxV2SourceMessageReconciliationMaterializerError {
  return new InboxV2SourceMessageReconciliationMaterializerError(code, {
    cause
  });
}
