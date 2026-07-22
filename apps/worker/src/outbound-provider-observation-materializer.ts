import {
  INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
  calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest,
  canonicalizeInboxV2Json,
  deriveInboxV2OutboundProviderObservationId,
  inboxV2ExternalMessageKeySchema,
  inboxV2ExternalMessageReferenceIdSchema,
  inboxV2MessageTransportOccurrenceLinkIdSchema,
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundProviderObservationSchema,
  inboxV2OutboundProviderResponseObservationDescriptorSchema,
  inboxV2OutboundRouteSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SourceMessageExactOutboundCorrelationSchema,
  inboxV2SourceOccurrenceIdSchema,
  inboxV2SourceOccurrenceSchema,
  inboxV2TimestampSchema,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchArtifact,
  type InboxV2OutboundDispatchAttempt,
  type InboxV2OutboundProviderObservation,
  type InboxV2OutboundProviderResponseObservationDescriptor,
  type InboxV2OutboundRoute,
  type InboxV2SourceMessageExactOutboundCorrelation,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";

import type { InboxV2SourceMessageNamespaceDeriver } from "./source-message-reconciliation-materializer";

const MATERIALIZER_OPTION_KEYS = new Set([
  "trustedServiceId",
  "namespaceDeriver"
]);
const trustedMaterializers = new WeakSet<object>();

export type InboxV2OutboundProviderObservationMaterializationInput = Readonly<{
  dispatch: InboxV2OutboundDispatch;
  route: InboxV2OutboundRoute;
  attempt: InboxV2OutboundDispatchAttempt;
  artifact: InboxV2OutboundDispatchArtifact;
  descriptor: InboxV2OutboundProviderResponseObservationDescriptor;
  recordedAt: string;
}>;

export type InboxV2OutboundProviderEchoObservationMaterializationInput =
  Readonly<{
    dispatch: InboxV2OutboundDispatch;
    route: InboxV2OutboundRoute;
    attempt: InboxV2OutboundDispatchAttempt;
    artifact: InboxV2OutboundDispatchArtifact;
    sourceOccurrence: InboxV2SourceOccurrence;
    exactCorrelation: InboxV2SourceMessageExactOutboundCorrelation;
    recordedAt: string;
  }>;

export type InboxV2TrustedOutboundProviderObservationMaterializer = Readonly<{
  materializeProviderResponse(
    input: InboxV2OutboundProviderObservationMaterializationInput
  ): InboxV2OutboundProviderObservation;
  materializeProviderEcho(
    input: InboxV2OutboundProviderEchoObservationMaterializationInput
  ): InboxV2OutboundProviderObservation;
  materializeSettlementWork(
    observation: InboxV2OutboundProviderObservation
  ): InboxV2OutboundProviderSettlementWorkMaterialization;
}>;

export type InboxV2OutboundProviderSettlementWorkMaterialization = Readonly<{
  observation: InboxV2OutboundProviderObservation;
  candidateExternalMessageReferenceId: string;
  candidateTransportLinkId: string;
}>;

export type InboxV2OutboundProviderObservationMaterializerErrorCode =
  | "outbound_provider_observation.input_invalid"
  | "outbound_provider_observation.service_mismatch"
  | "outbound_provider_observation.namespace_derivation_invalid"
  | "outbound_provider_observation.materialization_invalid";

export class InboxV2OutboundProviderObservationMaterializerError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: InboxV2OutboundProviderObservationMaterializerErrorCode,
    options: { cause?: unknown } = {}
  ) {
    super(
      code,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "InboxV2OutboundProviderObservationMaterializerError";
  }
}

/**
 * Trusted core bridge for adapter-owned provider response facts. The adapter
 * supplies no tenant, canonical occurrence/reference or Message IDs; those are
 * derived from the exact route/attempt fence that was persisted before I/O.
 */
export function createInboxV2TrustedOutboundProviderObservationMaterializer(input: {
  trustedServiceId: string;
  namespaceDeriver: InboxV2SourceMessageNamespaceDeriver;
}): InboxV2TrustedOutboundProviderObservationMaterializer {
  assertExactOptions(input);
  const trustedServiceId = inboxV2RoutingTrustedServiceIdSchema.parse(
    input.trustedServiceId
  );
  if (typeof input.namespaceDeriver.deriveNamespaceHmacSha256 !== "function") {
    throw new TypeError(
      "Outbound provider observation materialization requires a namespace deriver."
    );
  }

  const materializer: InboxV2TrustedOutboundProviderObservationMaterializer =
    Object.freeze({
      materializeProviderResponse(untrustedInput) {
        try {
          const dispatch = inboxV2OutboundDispatchSchema.parse(
            untrustedInput.dispatch
          );
          const route = inboxV2OutboundRouteSchema.parse(untrustedInput.route);
          const attempt = inboxV2OutboundDispatchAttemptSchema.parse(
            untrustedInput.attempt
          );
          const artifact = inboxV2OutboundDispatchArtifactSchema.parse(
            untrustedInput.artifact
          );
          const descriptor =
            inboxV2OutboundProviderResponseObservationDescriptorSchema.parse(
              untrustedInput.descriptor
            );
          const recordedAt = inboxV2TimestampSchema.parse(
            untrustedInput.recordedAt
          );
          if (
            descriptor.artifactOrdinal !== artifact.ordinal ||
            route.adapterContract.loadedByTrustedServiceId !== trustedServiceId
          ) {
            throw materializerError(
              "outbound_provider_observation.service_mismatch"
            );
          }

          const messageKey = inboxV2ExternalMessageKeySchema.parse({
            realm: {
              realmId: descriptor.messageIdentityDeclaration.realmId,
              realmVersion: descriptor.messageIdentityDeclaration.realmVersion,
              canonicalizationVersion:
                descriptor.messageIdentityDeclaration.canonicalizationVersion
            },
            scope: providerMessageScope(
              descriptor.messageIdentityDeclaration.scopeKind,
              route
            ),
            objectKindId: descriptor.messageIdentityDeclaration.objectKindId,
            externalThread: route.externalThread,
            canonicalExternalSubject: descriptor.canonicalExternalSubject
          });
          const occurrenceIdentity = {
            attempt: {
              tenantId: attempt.tenantId,
              kind: "outbound_dispatch_attempt" as const,
              id: attempt.id
            },
            artifactOrdinal: artifact.ordinal,
            messageKey,
            origin: "provider_response" as const
          };
          const occurrenceDigest = deriveCandidateDigest(
            input.namespaceDeriver,
            trustedServiceId,
            dispatch.tenantId,
            "source_occurrence_id",
            "core:inbox-v2.outbound-provider-response-occurrence",
            occurrenceIdentity
          );
          const diagnosticDigest = deriveCandidateDigest(
            input.namespaceDeriver,
            trustedServiceId,
            dispatch.tenantId,
            "pending_diagnostic",
            "core:inbox-v2.outbound-provider-response-pending",
            occurrenceIdentity
          );
          const sourceOccurrence = inboxV2SourceOccurrenceSchema.parse({
            tenantId: dispatch.tenantId,
            id: inboxV2SourceOccurrenceIdSchema.parse(
              `source_occurrence:${occurrenceDigest}`
            ),
            messageKey,
            messageIdentityDeclaration: descriptor.messageIdentityDeclaration,
            bindingContext: {
              externalThread: route.externalThread,
              sourceAccount: route.sourceAccount,
              sourceThreadBinding: route.sourceThreadBinding,
              bindingGeneration: route.bindingFence.bindingGeneration
            },
            origin: {
              kind: "provider_response",
              sourceAccount: route.sourceAccount,
              outboundDispatchAttempt: {
                tenantId: attempt.tenantId,
                kind: "outbound_dispatch_attempt",
                id: attempt.id
              }
            },
            descriptor: descriptor.occurrenceDescriptor,
            providerActor: null,
            direction: "outbound",
            providerTimestamps: descriptor.providerTimestamps,
            referencePortability: descriptor.referencePortability,
            resolution: {
              state: "pending",
              diagnostic: {
                codeId: "core:outbound-provider-observation-pending",
                retryable: true,
                correlationToken: `outbound-provider-observation:${diagnosticDigest}`,
                safeOperatorHintId: null
              }
            },
            observedAt: descriptor.observedAt,
            recordedAt,
            revision: "1",
            createdAt: recordedAt,
            updatedAt: recordedAt
          });
          const observation = inboxV2OutboundProviderObservationSchema.parse({
            tenantId: dispatch.tenantId,
            id: deriveInboxV2OutboundProviderObservationId({
              tenantId: dispatch.tenantId,
              attempt: {
                tenantId: attempt.tenantId,
                kind: "outbound_dispatch_attempt",
                id: attempt.id
              },
              artifactOrdinal: artifact.ordinal,
              sourceOccurrence: {
                tenantId: sourceOccurrence.tenantId,
                kind: "source_occurrence",
                id: sourceOccurrence.id
              },
              evidenceKind: "provider_response_attempt"
            }),
            artifact,
            dispatch,
            route,
            attempt,
            sourceOccurrence,
            sourceOccurrenceDetailDigestSha256:
              calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest(
                sourceOccurrence
              ),
            evidence: {
              kind: "provider_response_attempt",
              artifactOrdinal: artifact.ordinal,
              outboundDispatchAttempt: {
                tenantId: attempt.tenantId,
                kind: "outbound_dispatch_attempt",
                id: attempt.id
              }
            },
            effectDisposition:
              INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
            observedByTrustedServiceId: trustedServiceId,
            recordedAt,
            revision: "1"
          });
          return deepFreeze(observation);
        } catch (cause) {
          if (
            cause instanceof InboxV2OutboundProviderObservationMaterializerError
          ) {
            throw cause;
          }
          throw materializerError(
            "outbound_provider_observation.materialization_invalid",
            cause
          );
        }
      },
      materializeProviderEcho(untrustedInput) {
        try {
          const dispatch = inboxV2OutboundDispatchSchema.parse(
            untrustedInput.dispatch
          );
          const route = inboxV2OutboundRouteSchema.parse(untrustedInput.route);
          const attempt = inboxV2OutboundDispatchAttemptSchema.parse(
            untrustedInput.attempt
          );
          const artifact = inboxV2OutboundDispatchArtifactSchema.parse(
            untrustedInput.artifact
          );
          const sourceOccurrence = inboxV2SourceOccurrenceSchema.parse(
            untrustedInput.sourceOccurrence
          );
          const exactCorrelation =
            inboxV2SourceMessageExactOutboundCorrelationSchema.parse(
              untrustedInput.exactCorrelation
            );
          const recordedAt = inboxV2TimestampSchema.parse(
            untrustedInput.recordedAt
          );
          const hasExactReference =
            sourceOccurrence.descriptor.providerReferences.some(
              (reference) =>
                reference.kindId === exactCorrelation.providerReferenceKindId &&
                reference.subject === exactCorrelation.correlationToken
            );
          if (
            route.adapterContract.loadedByTrustedServiceId !==
              trustedServiceId ||
            sourceOccurrence.origin.kind !== "provider_echo" ||
            sourceOccurrence.direction !== "outbound" ||
            sourceOccurrence.providerActor !== null ||
            sourceOccurrence.recordedAt !== recordedAt ||
            sourceOccurrence.createdAt !== recordedAt ||
            sourceOccurrence.updatedAt !== recordedAt ||
            exactCorrelation.artifactOrdinal !== artifact.ordinal ||
            attempt.retrySafety.providerCorrelationToken !==
              exactCorrelation.correlationToken ||
            !hasExactReference
          ) {
            throw materializerError(
              "outbound_provider_observation.service_mismatch"
            );
          }
          const observation = inboxV2OutboundProviderObservationSchema.parse({
            tenantId: dispatch.tenantId,
            id: deriveInboxV2OutboundProviderObservationId({
              tenantId: dispatch.tenantId,
              attempt: {
                tenantId: attempt.tenantId,
                kind: "outbound_dispatch_attempt",
                id: attempt.id
              },
              artifactOrdinal: artifact.ordinal,
              sourceOccurrence: {
                tenantId: sourceOccurrence.tenantId,
                kind: "source_occurrence",
                id: sourceOccurrence.id
              },
              evidenceKind: "provider_echo_correlation"
            }),
            artifact,
            dispatch,
            route,
            attempt,
            sourceOccurrence,
            sourceOccurrenceDetailDigestSha256:
              calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest(
                sourceOccurrence
              ),
            evidence: {
              kind: "provider_echo_correlation",
              artifactOrdinal: artifact.ordinal,
              providerReferenceKindId: exactCorrelation.providerReferenceKindId,
              correlationToken: exactCorrelation.correlationToken
            },
            effectDisposition:
              INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
            observedByTrustedServiceId: trustedServiceId,
            recordedAt,
            revision: "1"
          });
          return deepFreeze(observation);
        } catch (cause) {
          if (
            cause instanceof InboxV2OutboundProviderObservationMaterializerError
          ) {
            throw cause;
          }
          throw materializerError(
            "outbound_provider_observation.materialization_invalid",
            cause
          );
        }
      },
      materializeSettlementWork(untrustedObservation) {
        try {
          const observation =
            inboxV2OutboundProviderObservationSchema.parse(
              untrustedObservation
            );
          if (
            observation.observedByTrustedServiceId !== trustedServiceId ||
            observation.sourceOccurrence.direction !== "outbound" ||
            observation.sourceOccurrence.providerActor !== null ||
            observation.sourceOccurrence.resolution.state !== "pending"
          ) {
            throw materializerError(
              "outbound_provider_observation.service_mismatch"
            );
          }
          const transportRole =
            observation.evidence.kind === "provider_response_attempt"
              ? "provider_response"
              : "provider_echo";
          const candidateExternalMessageReferenceId =
            inboxV2ExternalMessageReferenceIdSchema.parse(
              `external_message_reference:${deriveCandidateDigest(
                input.namespaceDeriver,
                trustedServiceId,
                observation.tenantId,
                "external_message_reference_id",
                "core:inbox-v2.external-message-reference-candidate",
                { messageKey: observation.sourceOccurrence.messageKey }
              )}`
            );
          const candidateTransportLinkId =
            inboxV2MessageTransportOccurrenceLinkIdSchema.parse(
              `message_transport_occurrence_link:${deriveCandidateDigest(
                input.namespaceDeriver,
                trustedServiceId,
                observation.tenantId,
                "message_transport_occurrence_link_id",
                "core:inbox-v2.source-message-transport-link-candidate",
                {
                  sourceOccurrenceId: observation.sourceOccurrence.id,
                  candidateExternalMessageReferenceId,
                  transportRole
                }
              )}`
            );
          return deepFreeze({
            observation,
            candidateExternalMessageReferenceId,
            candidateTransportLinkId
          });
        } catch (cause) {
          if (
            cause instanceof InboxV2OutboundProviderObservationMaterializerError
          ) {
            throw cause;
          }
          throw materializerError(
            "outbound_provider_observation.materialization_invalid",
            cause
          );
        }
      }
    });

  trustedMaterializers.add(materializer);
  return materializer;
}

export function isInboxV2TrustedOutboundProviderObservationMaterializer(
  value: unknown
): value is InboxV2TrustedOutboundProviderObservationMaterializer {
  return (
    typeof value === "object" &&
    value !== null &&
    trustedMaterializers.has(value)
  );
}

function providerMessageScope(
  scopeKind: InboxV2OutboundProviderResponseObservationDescriptor["messageIdentityDeclaration"]["scopeKind"],
  route: InboxV2OutboundRoute
) {
  if (scopeKind === "provider_thread") {
    return { kind: "provider_thread" as const };
  }
  if (scopeKind === "source_account") {
    return { kind: "source_account" as const, owner: route.sourceAccount };
  }
  return {
    kind: "source_thread_binding" as const,
    owner: route.sourceThreadBinding
  };
}

function deriveCandidateDigest(
  deriver: InboxV2SourceMessageNamespaceDeriver,
  trustedServiceId: string,
  tenantId: string,
  purpose:
    | "source_occurrence_id"
    | "pending_diagnostic"
    | "external_message_reference_id"
    | "message_transport_occurrence_link_id",
  domain: string,
  identity: unknown
): string {
  let digest: string;
  try {
    digest = deriver.deriveNamespaceHmacSha256({
      tenantId,
      trustedServiceId,
      namespaceGeneration: deriver.namespaceGeneration,
      purpose,
      canonicalPreimage: canonicalizeInboxV2Json({
        domain,
        version: "v1",
        tenantId,
        trustedServiceId,
        namespaceGeneration: deriver.namespaceGeneration,
        identity
      })
    });
  } catch (cause) {
    throw materializerError(
      "outbound_provider_observation.namespace_derivation_invalid",
      cause
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw materializerError(
      "outbound_provider_observation.namespace_derivation_invalid"
    );
  }
  return digest;
}

function assertExactOptions(input: object): void {
  const keys = Object.keys(input);
  if (
    keys.length !== MATERIALIZER_OPTION_KEYS.size ||
    keys.some((key) => !MATERIALIZER_OPTION_KEYS.has(key))
  ) {
    throw new TypeError(
      "Outbound provider observation materializer accepts only trustedServiceId and namespaceDeriver."
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
  code: InboxV2OutboundProviderObservationMaterializerErrorCode,
  cause?: unknown
): InboxV2OutboundProviderObservationMaterializerError {
  return new InboxV2OutboundProviderObservationMaterializerError(code, {
    cause
  });
}
