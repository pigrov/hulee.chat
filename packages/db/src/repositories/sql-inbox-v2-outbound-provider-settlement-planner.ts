import {
  calculateInboxV2CanonicalSha256,
  calculateInboxV2OutboundProviderObservationDetailDigest,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2MessageTransportAssociationCommitSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchArtifactReferenceLinkSchema,
  inboxV2OutboundDispatchArtifactResolutionSchema,
  inboxV2OutboundDispatchReconciliationDecisionSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundProviderSettlementCommitSchema,
  type InboxV2ExternalMessageReference,
  type InboxV2ExternalThreadMapping,
  type InboxV2MessageTransportLinkHead,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchArtifactReferenceLink,
  type InboxV2OutboundDispatchArtifactResolution,
  type InboxV2OutboundDispatchAttempt,
  type InboxV2OutboundProviderObservation,
  type InboxV2OutboundProviderSettlementCommit,
  type InboxV2SourceAccountIdentity,
  type InboxV2SourceOccurrence,
  type InboxV2SourceThreadBindingCurrentProjection
} from "@hulee/contracts";
import { sql } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import { readInboxV2ExternalThreadMappingByIdInTransaction } from "./sql-inbox-v2-external-thread-repository";
import { loadInboxV2OutboundDispatchContentPlan } from "./sql-inbox-v2-file-object-repository";
import {
  readInboxV2OutboundProviderCurrentTransportStateInTransaction,
  type InboxV2OutboundProviderCurrentTransportState
} from "./sql-inbox-v2-outbound-provider-echo-repository";
import { readInboxV2OutboundProviderObservationInTransaction } from "./sql-inbox-v2-outbound-provider-observation-repository";
import {
  lockInboxV2OutboundProviderSettlementWorkLeaseInTransaction,
  type InboxV2OutboundProviderSettlementWorkClaim
} from "./sql-inbox-v2-outbound-provider-settlement-work-repository";
import {
  computeInboxV2ExternalMessageKeyDigest,
  findInboxV2ExternalMessageReferenceCandidatesInTransaction
} from "./sql-inbox-v2-outbound-transport-repository";
import { readInboxV2SourceAccountIdentityVerifiedSnapshotInTransaction } from "./sql-inbox-v2-source-conversation-resolution-repository";
import {
  readInboxV2SourceOccurrenceHistoricalMaterializationFenceInTransaction,
  readInboxV2SourceOccurrenceInTransaction
} from "./sql-inbox-v2-source-occurrence-repository";
import { readInboxV2SourceThreadBindingMaterializationSnapshotAtRevisionInTransaction } from "./sql-inbox-v2-source-thread-binding-repository";
import {
  loadInboxV2TimelineMessageAggregateInTransaction,
  readInboxV2MessageTransportLinkHeadInTransaction,
  type InboxV2LoadedTimelineMessageAggregate
} from "./sql-inbox-v2-timeline-message-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type InboxV2OutboundProviderSettlementPlanningDeferral =
  | Readonly<{ kind: "retry"; availableAt: string; errorCode: string }>
  | Readonly<{ kind: "dead"; errorCode: string }>;

export type InboxV2OutboundProviderSettlementPlanResult =
  | Readonly<{
      kind: "planned";
      commit: InboxV2OutboundProviderSettlementCommit;
    }>
  | Readonly<{ kind: "already_settled" }>
  | Readonly<{ kind: "lease_conflict" }>
  | InboxV2OutboundProviderSettlementPlanningDeferral;

export type InboxV2OutboundProviderSettlementPlanner = Readonly<{
  loadAndPlanExactCommit(input: {
    claim: InboxV2OutboundProviderSettlementWorkClaim;
  }): Promise<InboxV2OutboundProviderSettlementPlanResult>;
}>;

type SettlementPlannerTransactionExecutor = Readonly<{
  transaction<T>(
    callback: (transaction: RawSqlExecutor) => Promise<T>
  ): Promise<T>;
}>;

type VerifiedSourceAccountIdentity = Extract<
  InboxV2SourceAccountIdentity,
  { state: "verified" }
>;

export type InboxV2OutboundProviderSettlementLoadedState = Readonly<{
  claim: InboxV2OutboundProviderSettlementWorkClaim;
  observation: InboxV2OutboundProviderObservation;
  currentTransport: InboxV2OutboundProviderCurrentTransportState;
  contentPlan: Awaited<
    ReturnType<typeof loadInboxV2OutboundDispatchContentPlan>
  > & {};
  existingResolutions: readonly InboxV2OutboundDispatchArtifactResolution[];
  existingArtifactLink: InboxV2OutboundDispatchArtifactReferenceLink | null;
  persistedOccurrence: InboxV2SourceOccurrence | null;
  externalMessageReference: InboxV2ExternalMessageReference;
  externalThreadMapping: InboxV2ExternalThreadMapping;
  occurrenceBinding: InboxV2SourceThreadBindingCurrentProjection;
  sourceAccountIdentity: VerifiedSourceAccountIdentity | null;
  messageAggregate: InboxV2LoadedTimelineMessageAggregate;
  linkHeadBefore: InboxV2MessageTransportLinkHead | null;
  plannedAt: string;
}>;

type ArtifactResolutionRow = Record<string, unknown> & {
  observation_detail: unknown;
  observation_detail_digest_sha256: unknown;
};

type ArtifactLinkRow = Record<string, unknown>;

export function createSqlInboxV2OutboundProviderSettlementPlanner(
  executor: SettlementPlannerTransactionExecutor | HuleeDatabase
): InboxV2OutboundProviderSettlementPlanner {
  if (
    executor === null ||
    typeof executor !== "object" ||
    typeof executor.transaction !== "function"
  ) {
    throw new TypeError(
      "Provider settlement planner requires a database transaction executor."
    );
  }
  return Object.freeze({
    loadAndPlanExactCommit(input) {
      return (executor as SettlementPlannerTransactionExecutor).transaction(
        async (transaction) =>
          loadAndPlanInTransaction(transaction, input.claim)
      );
    }
  });
}

async function loadAndPlanInTransaction(
  transaction: RawSqlExecutor,
  claim: InboxV2OutboundProviderSettlementWorkClaim
): Promise<InboxV2OutboundProviderSettlementPlanResult> {
  const leaseIsLive =
    await lockInboxV2OutboundProviderSettlementWorkLeaseInTransaction(
      transaction,
      claim
    );
  if (!leaseIsLive) return { kind: "lease_conflict" };
  if (await hasSettlement(transaction, claim)) {
    return { kind: "already_settled" };
  }

  const observation = await readInboxV2OutboundProviderObservationInTransaction(
    transaction,
    {
      tenantId: claim.tenantId,
      observationId: claim.observationId
    }
  );
  if (observation === null)
    return dead("core:provider-settlement-observation-missing");
  if (observation.observedByTrustedServiceId !== claim.trustedServiceId) {
    return dead("core:provider-settlement-service-mismatch");
  }
  const currentTransport =
    await readInboxV2OutboundProviderCurrentTransportStateInTransaction(
      transaction,
      {
        tenantId: claim.tenantId,
        dispatchId: observation.dispatch.id,
        attemptId: observation.attempt.id
      }
    );
  const contentPlan = await loadInboxV2OutboundDispatchContentPlan(
    transaction,
    {
      tenantId: observation.tenantId,
      dispatchId: observation.dispatch.id
    }
  );
  if (currentTransport === null || contentPlan === null) {
    return dead("core:provider-settlement-transport-missing");
  }

  const existingResolutions = await loadArtifactResolutions(
    transaction,
    observation
  );
  const existingArtifactLink = await loadArtifactLink(transaction, observation);
  const persistedOccurrence = await readInboxV2SourceOccurrenceInTransaction(
    transaction,
    {
      tenantId: observation.tenantId,
      occurrenceId: observation.sourceOccurrence.id
    }
  );
  const messageAggregate =
    await loadInboxV2TimelineMessageAggregateInTransaction(transaction, {
      tenantId: observation.tenantId,
      messageId: observation.dispatch.message.id
    });
  if (messageAggregate === null) {
    return dead("core:provider-settlement-message-missing");
  }
  const externalMessageReference = await loadExternalMessageReference(
    transaction,
    claim,
    observation,
    messageAggregate
  );
  if (externalMessageReference === null) {
    return dead("core:provider-settlement-reference-conflict");
  }
  const externalThreadMapping =
    await readInboxV2ExternalThreadMappingByIdInTransaction(transaction, {
      tenantId: observation.tenantId,
      threadId: observation.sourceOccurrence.bindingContext.externalThread.id
    });
  if (externalThreadMapping === null) {
    return dead("core:provider-settlement-thread-missing");
  }

  const materialization = await loadOccurrenceMaterializationState(
    transaction,
    observation,
    contentPlan.bindingRevision,
    persistedOccurrence
  );
  if (materialization === null) {
    return dead("core:provider-settlement-binding-snapshot-missing");
  }
  const headRead = await readInboxV2MessageTransportLinkHeadInTransaction(
    transaction,
    {
      tenantId: observation.tenantId,
      messageId: observation.dispatch.message.id
    }
  );
  const clock = await transaction.execute<{ planned_at: unknown }>(sql`
    select clock_timestamp() as planned_at
  `);
  const plannedAt = timestamp(
    clock.rows[0]?.planned_at,
    "provider settlement planner database clock"
  );

  try {
    return {
      kind: "planned",
      commit: buildInboxV2OutboundProviderSettlementCommit({
        claim,
        observation,
        currentTransport,
        contentPlan,
        existingResolutions,
        existingArtifactLink,
        persistedOccurrence,
        externalMessageReference,
        externalThreadMapping,
        occurrenceBinding: materialization.binding,
        sourceAccountIdentity: materialization.identity,
        messageAggregate,
        linkHeadBefore: headRead?.head ?? null,
        plannedAt
      })
    };
  } catch (error) {
    if (error instanceof InboxV2SettlementPlanConflict) {
      return dead(error.code);
    }
    throw error;
  }
}

async function hasSettlement(
  transaction: RawSqlExecutor,
  claim: InboxV2OutboundProviderSettlementWorkClaim
): Promise<boolean> {
  const result = await transaction.execute<{ observation_id: unknown }>(sql`
    select observation_id
      from inbox_v2_outbound_provider_observation_settlements
     where tenant_id = ${claim.tenantId}
       and observation_id = ${claim.observationId}
     for share
  `);
  if (result.rows.length > 1) {
    throw invariantError("Provider observation has multiple settlements.");
  }
  return result.rows.length === 1;
}

async function loadArtifactResolutions(
  transaction: RawSqlExecutor,
  observation: InboxV2OutboundProviderObservation
): Promise<readonly InboxV2OutboundDispatchArtifactResolution[]> {
  const result = await transaction.execute<ArtifactResolutionRow>(sql`
    select resolution_row.*,
           observation_row.observation_detail,
           observation_row.observation_detail_digest_sha256
      from inbox_v2_outbound_dispatch_artifact_resolutions resolution_row
      join inbox_v2_outbound_provider_observations observation_row
        on observation_row.tenant_id = resolution_row.tenant_id
       and observation_row.id = resolution_row.observation_id
     where resolution_row.tenant_id = ${observation.tenantId}
       and resolution_row.dispatch_id = ${observation.dispatch.id}
       and resolution_row.attempt_id = ${observation.attempt.id}
     order by resolution_row.artifact_ordinal, resolution_row.id
     for share of resolution_row, observation_row
  `);
  if (result.rows.length > 64) {
    throw invariantError("Provider artifact resolution coverage is unbounded.");
  }
  const resolutions = result.rows.map(mapArtifactResolution);
  if (
    new Set(resolutions.map((resolution) => resolution.artifactOrdinal))
      .size !== resolutions.length ||
    new Set(resolutions.map((resolution) => resolution.effectiveArtifact.id))
      .size !== resolutions.length
  ) {
    throw invariantError("Provider artifact resolution coverage is ambiguous.");
  }
  return resolutions;
}

function mapArtifactResolution(
  row: ArtifactResolutionRow
): InboxV2OutboundDispatchArtifactResolution {
  const observation = parseObservationSnapshot(
    row.observation_detail,
    row.observation_detail_digest_sha256
  );
  return inboxV2OutboundDispatchArtifactResolutionSchema.parse({
    tenantId: row.tenant_id,
    id: row.id,
    observation,
    artifactOrdinal: Number(row.artifact_ordinal),
    fromState: row.from_state,
    effectiveState: row.effective_state,
    effectiveArtifact: {
      ...observation.artifact,
      state: row.effective_state,
      diagnostic: null
    },
    resolvedByTrustedServiceId: row.resolved_by_trusted_service_id,
    resolvedAt: timestamp(row.resolved_at, "artifact resolution resolved_at"),
    revision: String(row.revision)
  });
}

async function loadArtifactLink(
  transaction: RawSqlExecutor,
  observation: InboxV2OutboundProviderObservation
): Promise<InboxV2OutboundDispatchArtifactReferenceLink | null> {
  const result = await transaction.execute<ArtifactLinkRow>(sql`
    select id, artifact_id, dispatch_id, route_id, attempt_id,
           external_thread_id, external_message_reference_id,
           source_occurrence_id, evidence_kind, provider_reference_kind_id,
           correlation_token, linked_by_trusted_service_id, linked_at, revision
      from inbox_v2_outbound_dispatch_artifact_reference_links
     where tenant_id = ${observation.tenantId}
       and artifact_id = ${observation.artifact.id}
     for share
  `);
  if (result.rows.length > 1) {
    throw invariantError("Provider artifact has multiple canonical links.");
  }
  const row = result.rows[0];
  if (row === undefined) return null;
  const ref = referenceFactory(observation.tenantId);
  const evidence =
    String(row.evidence_kind) === "provider_response_attempt"
      ? { kind: "provider_response_attempt" as const }
      : {
          kind: "provider_echo_correlation" as const,
          providerReferenceKindId: String(row.provider_reference_kind_id),
          correlationToken: String(row.correlation_token)
        };
  return inboxV2OutboundDispatchArtifactReferenceLinkSchema.parse({
    tenantId: observation.tenantId,
    id: row.id,
    artifact: ref("outbound_dispatch_artifact", row.artifact_id),
    dispatch: ref("outbound_dispatch", row.dispatch_id),
    route: ref("outbound_route", row.route_id),
    attempt: ref("outbound_dispatch_attempt", row.attempt_id),
    externalThread: ref("external_thread", row.external_thread_id),
    externalMessageReference: ref(
      "external_message_reference",
      row.external_message_reference_id
    ),
    sourceOccurrence: ref("source_occurrence", row.source_occurrence_id),
    associationEvidence: evidence,
    linkedByTrustedServiceId: row.linked_by_trusted_service_id,
    linkedAt: timestamp(row.linked_at, "artifact link linked_at"),
    revision: String(row.revision)
  });
}

async function loadExternalMessageReference(
  transaction: RawSqlExecutor,
  claim: InboxV2OutboundProviderSettlementWorkClaim,
  observation: InboxV2OutboundProviderObservation,
  messageAggregate: InboxV2LoadedTimelineMessageAggregate
): Promise<InboxV2ExternalMessageReference | null> {
  const candidates =
    await findInboxV2ExternalMessageReferenceCandidatesInTransaction(
      transaction,
      {
        tenantId: observation.tenantId,
        referenceId: inboxV2ExternalMessageReferenceSchema.shape.id.parse(
          claim.candidateExternalMessageReferenceId
        ),
        keyDigest: computeInboxV2ExternalMessageKeyDigest(
          observation.sourceOccurrence.messageKey
        )
      }
    );
  if (candidates.length === 0) {
    const ref = referenceFactory(observation.tenantId);
    return inboxV2ExternalMessageReferenceSchema.parse({
      tenantId: observation.tenantId,
      id: claim.candidateExternalMessageReferenceId,
      key: observation.sourceOccurrence.messageKey,
      identityDeclaration:
        observation.sourceOccurrence.messageIdentityDeclaration,
      externalThread:
        observation.sourceOccurrence.bindingContext.externalThread,
      timelineItem: ref("timeline_item", messageAggregate.timelineItem.id),
      message: ref("message", messageAggregate.message.id),
      revision: "1",
      createdAt: observation.sourceOccurrence.recordedAt
    });
  }
  const exact = candidates.filter(
    (candidate) =>
      candidate.id === claim.candidateExternalMessageReferenceId &&
      sameValue(candidate.key, observation.sourceOccurrence.messageKey) &&
      sameValue(
        candidate.identityDeclaration,
        observation.sourceOccurrence.messageIdentityDeclaration
      ) &&
      candidate.message.id === observation.dispatch.message.id
  );
  return candidates.length === 1 && exact.length === 1 ? exact[0]! : null;
}

async function loadOccurrenceMaterializationState(
  transaction: RawSqlExecutor,
  observation: InboxV2OutboundProviderObservation,
  bindingRevision: string,
  persistedOccurrence: InboxV2SourceOccurrence | null
): Promise<Readonly<{
  binding: InboxV2SourceThreadBindingCurrentProjection;
  identity: VerifiedSourceAccountIdentity | null;
}> | null> {
  const occurrence = observation.sourceOccurrence;
  if (observation.evidence.kind === "provider_response_attempt") {
    const historicalBinding =
      await readInboxV2SourceThreadBindingMaterializationSnapshotAtRevisionInTransaction(
        transaction,
        {
          tenantId: observation.tenantId,
          bindingId: observation.route.sourceThreadBinding.id,
          revision: bindingRevision
        }
      );
    if (historicalBinding === null) return null;
    const identity =
      await readInboxV2SourceAccountIdentityVerifiedSnapshotInTransaction(
        transaction,
        {
          tenantId: observation.tenantId,
          sourceAccountId: observation.route.sourceAccount.id,
          revision: historicalBinding.accountIdentityRevision
        }
      );
    return identity === null ||
      !routeTimeBindingMatches(
        historicalBinding.projection,
        identity,
        observation,
        bindingRevision
      )
      ? null
      : { binding: historicalBinding.projection, identity };
  }

  if (
    persistedOccurrence === null ||
    !sameValue(persistedOccurrence, occurrence)
  ) {
    return null;
  }
  const fence =
    await readInboxV2SourceOccurrenceHistoricalMaterializationFenceInTransaction(
      transaction,
      { occurrence: persistedOccurrence }
    );
  if (fence === null) return null;
  const historicalBinding =
    await readInboxV2SourceThreadBindingMaterializationSnapshotAtRevisionInTransaction(
      transaction,
      {
        tenantId: observation.tenantId,
        bindingId: occurrence.bindingContext.sourceThreadBinding.id,
        revision: fence.bindingRevision
      }
    );
  if (
    historicalBinding === null ||
    historicalBinding.accountIdentityRevision !== fence.accountIdentityRevision
  ) {
    return null;
  }
  const identity =
    await readInboxV2SourceAccountIdentityVerifiedSnapshotInTransaction(
      transaction,
      {
        tenantId: observation.tenantId,
        sourceAccountId: occurrence.bindingContext.sourceAccount.id,
        revision: fence.accountIdentityRevision
      }
    );
  return identity !== null &&
    occurrenceTimeBindingMatches(
      historicalBinding.projection,
      identity,
      occurrence,
      fence.bindingRevision
    )
    ? { binding: historicalBinding.projection, identity: null }
    : null;
}

function occurrenceTimeBindingMatches(
  projection: InboxV2SourceThreadBindingCurrentProjection,
  identity: VerifiedSourceAccountIdentity,
  occurrence: InboxV2SourceOccurrence,
  bindingRevision: string
): boolean {
  const binding = projection.binding;
  return (
    binding.id === occurrence.bindingContext.sourceThreadBinding.id &&
    binding.revision === bindingRevision &&
    binding.externalThread.id === occurrence.bindingContext.externalThread.id &&
    binding.sourceAccount.id === occurrence.bindingContext.sourceAccount.id &&
    binding.bindingGeneration === occurrence.bindingContext.bindingGeneration &&
    binding.capabilities.revision ===
      occurrence.descriptor.capabilityRevision &&
    sameValue(
      binding.capabilities.adapterContract,
      occurrence.descriptor.adapterContract
    ) &&
    identity.sourceAccount.id === occurrence.bindingContext.sourceAccount.id &&
    identity.sourceConnection.id === binding.sourceConnection.id &&
    identity.accountGeneration ===
      binding.accountIdentitySnapshot.accountGeneration
  );
}

/** Direct-module regression seam; intentionally absent from @hulee/db. */
export function occurrenceTimeBindingMatchesForTest(
  projection: InboxV2SourceThreadBindingCurrentProjection,
  identity: VerifiedSourceAccountIdentity,
  occurrence: InboxV2SourceOccurrence,
  bindingRevision: string
): boolean {
  return occurrenceTimeBindingMatches(
    projection,
    identity,
    occurrence,
    bindingRevision
  );
}

function routeTimeBindingMatches(
  projection: InboxV2SourceThreadBindingCurrentProjection,
  identity: VerifiedSourceAccountIdentity,
  observation: InboxV2OutboundProviderObservation,
  bindingRevision: string
): boolean {
  const binding = projection.binding;
  const route = observation.route;
  return (
    binding.id === route.sourceThreadBinding.id &&
    binding.revision === bindingRevision &&
    binding.externalThread.id === route.externalThread.id &&
    binding.sourceConnection.id === route.sourceConnection.id &&
    binding.sourceAccount.id === route.sourceAccount.id &&
    binding.bindingGeneration === route.bindingFence.bindingGeneration &&
    binding.accountIdentitySnapshot.accountGeneration ===
      route.bindingFence.accountGeneration &&
    binding.capabilities.revision === route.bindingFence.capabilityRevision &&
    sameValue(binding.capabilities.adapterContract, route.adapterContract) &&
    identity.sourceAccount.id === route.sourceAccount.id &&
    identity.sourceConnection.id === route.sourceConnection.id &&
    identity.accountGeneration === route.bindingFence.accountGeneration
  );
}

export function buildInboxV2OutboundProviderSettlementCommit(
  state: InboxV2OutboundProviderSettlementLoadedState
): InboxV2OutboundProviderSettlementCommit {
  assertLoadedState(state);
  const { observation, claim } = state;
  const existingResolution = state.existingResolutions.find(
    (resolution) => resolution.effectiveArtifact.id === observation.artifact.id
  );
  const settledAt = settlementTimestamp(state);
  const createdResolution =
    existingResolution === undefined
      ? buildArtifactResolution(observation, settledAt)
      : null;
  const selectedResolution = existingResolution ?? createdResolution!;
  const coverage = [
    ...state.existingResolutions.filter(
      (resolution) =>
        resolution.effectiveArtifact.id !== observation.artifact.id
    ),
    selectedResolution
  ].sort((left, right) => left.artifactOrdinal - right.artifactOrdinal);
  const completeCoverage =
    coverage.length === state.contentPlan.artifacts.length &&
    state.contentPlan.artifacts.every((artifact) =>
      coverage.some(
        (resolution) => resolution.artifactOrdinal === artifact.ordinal
      )
    );
  const transition = buildTransition(
    observation,
    state.currentTransport,
    completeCoverage,
    settledAt
  );
  const finalTransport = transitionTransport(transition);
  const externalReference = state.externalMessageReference;
  const occurrenceResolution = buildOccurrenceResolution(
    observation,
    externalReference,
    settledAt
  );
  const artifactAssociation =
    state.existingArtifactLink === null
      ? {
          kind: "create" as const,
          commit: {
            artifact: selectedResolution.effectiveArtifact,
            dispatch: finalTransport.dispatch,
            attempt: finalTransport.attempt,
            route: observation.route,
            occurrenceResolution,
            link: buildArtifactLink(
              observation,
              selectedResolution,
              externalReference,
              settledAt
            )
          }
        }
      : {
          kind: "reuse_existing" as const,
          existingLink: state.existingArtifactLink
        };
  const role =
    observation.evidence.kind === "provider_response_attempt"
      ? ("provider_response" as const)
      : ("provider_echo" as const);
  const ref = referenceFactory(observation.tenantId);
  const beforeHead = state.linkHeadBefore;
  const nextHeadRevision = String(BigInt(beforeHead?.revision ?? "0") + 1n);
  const messageTransportAssociation: InboxV2OutboundProviderSettlementCommit["messageTransportAssociation"] =
    inboxV2MessageTransportAssociationCommitSchema.parse({
      tenantId: observation.tenantId,
      message: state.messageAggregate.message,
      timelineItem: state.messageAggregate.timelineItem,
      linkHeadBefore: beforeHead,
      sourceOccurrence: occurrenceResolution.after,
      externalMessageReference: externalReference,
      externalThreadMapping: state.externalThreadMapping,
      occurrenceBinding: state.occurrenceBinding.binding,
      messageOriginProof: {
        kind: "hulee_outbound" as const,
        outboundRoute: observation.route
      },
      link: {
        tenantId: observation.tenantId,
        id: claim.candidateTransportLinkId,
        message: ref("message", observation.dispatch.message.id),
        sourceOccurrence: ref(
          "source_occurrence",
          occurrenceResolution.after.id
        ),
        externalMessageReference: ref(
          "external_message_reference",
          externalReference.id
        ),
        role,
        revision: "1" as const,
        linkedAt: settledAt
      },
      linkHeadAfter: {
        tenantId: observation.tenantId,
        message: ref("message", observation.dispatch.message.id),
        linkCount: nextHeadRevision,
        latestLink: ref(
          "message_transport_occurrence_link",
          claim.candidateTransportLinkId
        ),
        revision: nextHeadRevision,
        updatedAt: settledAt
      },
      committedAt: settledAt
    });
  const providerResponseProofTransport =
    selectProviderResponseOccurrenceProofTransport(observation, transition);
  const occurrenceMaterialization =
    observation.evidence.kind === "provider_response_attempt"
      ? {
          kind: "provider_response" as const,
          commit: {
            tenantId: observation.tenantId,
            occurrence: observation.sourceOccurrence,
            bindingMaterialization: {
              kind: "existing" as const,
              currentProjection: state.occurrenceBinding,
              creationAuthority: null
            },
            externalThreadMapping: state.externalThreadMapping,
            sourceAccountIdentity: requireResponseIdentity(state),
            outboundDispatchAttempt: providerResponseProofTransport.attempt,
            outboundDispatch: providerResponseProofTransport.dispatch,
            outboundRoute: observation.route,
            authority: {
              kind: "trusted_service" as const,
              trustedServiceId: observation.observedByTrustedServiceId,
              authorizationToken: deterministicToken(
                "authorization:provider-settlement",
                "core:inbox-v2.provider-response-materialization-authority",
                { occurrenceId: observation.sourceOccurrence.id }
              ),
              authorizedAt: observation.sourceOccurrence.recordedAt
            },
            materializedAt: observation.sourceOccurrence.recordedAt
          }
        }
      : {
          kind: "provider_echo" as const,
          persistedSourceOccurrence: requireEchoOccurrence(state),
          verifiedByTrustedServiceId: observation.observedByTrustedServiceId,
          verifiedAt: settledAt
        };

  try {
    return inboxV2OutboundProviderSettlementCommitSchema.parse({
      tenantId: observation.tenantId,
      observation,
      artifactResolution:
        createdResolution === null
          ? {
              kind: "reuse_existing",
              existingResolution: selectedResolution
            }
          : { kind: "create", resolution: createdResolution },
      artifactCoverage: {
        contentPlan: state.contentPlan,
        resolutions: coverage
      },
      occurrenceMaterialization,
      occurrenceResolution,
      externalMessageReference: externalReference,
      artifactAssociation,
      messageTransportAssociation,
      transition,
      settledByTrustedServiceId: observation.observedByTrustedServiceId,
      settledAt
    });
  } catch (cause) {
    throw planConflict("core:provider-settlement-plan-invalid", cause);
  }
}

function selectProviderResponseOccurrenceProofTransport(
  observation: InboxV2OutboundProviderObservation,
  transition: InboxV2OutboundProviderSettlementCommit["transition"]
): Readonly<{
  dispatch: InboxV2OutboundDispatch;
  attempt: InboxV2OutboundDispatchAttempt;
}> {
  if (
    transition.kind === "already_accepted" ||
    transition.kind === "retain_dispatch_state"
  ) {
    return { dispatch: transition.dispatch, attempt: transition.attempt };
  }
  if (transition.kind === "reconcile_outcome_unknown") {
    return {
      dispatch: transition.reconciliationCommit.dispatchBefore,
      attempt: transition.reconciliationCommit.decision.unknownAttempt
    };
  }
  return { dispatch: observation.dispatch, attempt: observation.attempt };
}

/** Direct-module regression seam; intentionally absent from @hulee/db. */
export function selectProviderResponseOccurrenceProofTransportForTest(
  observation: InboxV2OutboundProviderObservation,
  transition: InboxV2OutboundProviderSettlementCommit["transition"]
): Readonly<{
  dispatch: InboxV2OutboundDispatch;
  attempt: InboxV2OutboundDispatchAttempt;
}> {
  return selectProviderResponseOccurrenceProofTransport(
    observation,
    transition
  );
}

function buildArtifactResolution(
  observation: InboxV2OutboundProviderObservation,
  settledAt: string
): InboxV2OutboundDispatchArtifactResolution {
  return inboxV2OutboundDispatchArtifactResolutionSchema.parse({
    tenantId: observation.tenantId,
    id: deterministicId(
      "outbound_dispatch_artifact_resolution",
      "core:inbox-v2.outbound-provider-artifact-resolution",
      { tenantId: observation.tenantId, artifactId: observation.artifact.id }
    ),
    observation,
    artifactOrdinal: observation.artifact.ordinal,
    fromState: observation.artifact.state,
    effectiveState: "accepted",
    effectiveArtifact: {
      ...observation.artifact,
      state: "accepted",
      diagnostic: null
    },
    resolvedByTrustedServiceId: observation.observedByTrustedServiceId,
    resolvedAt: settledAt,
    revision: "1"
  });
}

function buildOccurrenceResolution(
  observation: InboxV2OutboundProviderObservation,
  externalReference: InboxV2ExternalMessageReference,
  settledAt: string
) {
  const ref = referenceFactory(observation.tenantId);
  const before = observation.sourceOccurrence;
  const after = {
    ...before,
    resolution: {
      state: "resolved" as const,
      externalMessageReference: ref(
        "external_message_reference",
        externalReference.id
      )
    },
    revision: String(BigInt(before.revision) + 1n),
    updatedAt: settledAt
  };
  return {
    tenantId: observation.tenantId,
    expectedRevision: before.revision,
    resultingRevision: after.revision,
    changedAt: settledAt,
    resolver: {
      kind: "trusted_service" as const,
      trustedServiceId: observation.observedByTrustedServiceId,
      resolutionToken: deterministicToken(
        "resolution:provider-settlement",
        "core:inbox-v2.outbound-provider-occurrence-resolution",
        {
          occurrenceId: before.id,
          externalMessageReferenceId: externalReference.id
        }
      )
    },
    before,
    after,
    resolvedReference: externalReference
  };
}

function buildArtifactLink(
  observation: InboxV2OutboundProviderObservation,
  resolution: InboxV2OutboundDispatchArtifactResolution,
  externalReference: InboxV2ExternalMessageReference,
  settledAt: string
): InboxV2OutboundDispatchArtifactReferenceLink {
  const ref = referenceFactory(observation.tenantId);
  const evidence =
    observation.evidence.kind === "provider_response_attempt"
      ? { kind: "provider_response_attempt" as const }
      : {
          kind: "provider_echo_correlation" as const,
          providerReferenceKindId: observation.evidence.providerReferenceKindId,
          correlationToken: observation.evidence.correlationToken
        };
  return inboxV2OutboundDispatchArtifactReferenceLinkSchema.parse({
    tenantId: observation.tenantId,
    id: deterministicId(
      "outbound_dispatch_artifact_reference_link",
      "core:inbox-v2.outbound-provider-artifact-reference-link",
      {
        tenantId: observation.tenantId,
        artifactId: resolution.effectiveArtifact.id
      }
    ),
    artifact: ref(
      "outbound_dispatch_artifact",
      resolution.effectiveArtifact.id
    ),
    dispatch: ref("outbound_dispatch", observation.dispatch.id),
    route: ref("outbound_route", observation.route.id),
    attempt: ref("outbound_dispatch_attempt", observation.attempt.id),
    externalThread: observation.route.externalThread,
    externalMessageReference: ref(
      "external_message_reference",
      externalReference.id
    ),
    sourceOccurrence: ref("source_occurrence", observation.sourceOccurrence.id),
    associationEvidence: evidence,
    linkedByTrustedServiceId: observation.observedByTrustedServiceId,
    linkedAt: settledAt,
    revision: "1"
  });
}

function buildTransition(
  observation: InboxV2OutboundProviderObservation,
  current: InboxV2OutboundProviderCurrentTransportState,
  completeCoverage: boolean,
  settledAt: string
): InboxV2OutboundProviderSettlementCommit["transition"] {
  const currentMatchesIdentity =
    sameDispatchIdentity(current.dispatch, observation.dispatch) &&
    sameAttemptIdentity(current.attempt, observation.attempt);
  if (!currentMatchesIdentity) {
    throw planConflict("core:provider-settlement-transport-drift");
  }
  if (
    current.dispatch.state === "accepted" &&
    currentAcceptedTransportIsMonotonicDescendant(observation, current)
  ) {
    return {
      kind: "already_accepted",
      dispatch: current.dispatch,
      attempt: current.attempt
    };
  }
  if (!completeCoverage) {
    const exactCurrent =
      sameValue(current.dispatch, observation.dispatch) &&
      sameValue(current.attempt, observation.attempt);
    if (
      (!exactCurrent &&
        !pendingObservationToOutcomeUnknownCurrent(observation, current)) ||
      (current.attempt.outcome.kind !== "pending" &&
        current.attempt.outcome.kind !== "outcome_unknown" &&
        !(
          current.attempt.outcome.kind === "accepted" &&
          current.dispatch.state === "accepted"
        ))
    ) {
      throw planConflict("core:provider-settlement-partial-state-conflict");
    }
    return {
      kind: "retain_dispatch_state",
      dispatch: current.dispatch,
      attempt: current.attempt
    };
  }
  if (
    observation.attempt.outcome.kind === "pending" &&
    sameValue(current.dispatch, observation.dispatch) &&
    sameValue(current.attempt, observation.attempt)
  ) {
    const attemptAfter = inboxV2OutboundDispatchAttemptSchema.parse({
      ...observation.attempt,
      outcome: {
        kind: "accepted",
        completedAt: settledAt,
        providerAcknowledgementToken: null
      },
      completionSource: "provider_observation",
      revision: "2"
    });
    const dispatchAfter = inboxV2OutboundDispatchSchema.parse({
      ...observation.dispatch,
      state: "accepted",
      activeAttempt: null,
      lastAttempt: referenceFactory(observation.tenantId)(
        "outbound_dispatch_attempt",
        observation.attempt.id
      ),
      retryAuthorization: null,
      revision: String(BigInt(observation.dispatch.revision) + 1n),
      updatedAt: settledAt
    });
    return {
      kind: "complete_pending_attempt",
      attemptCommit: {
        kind: "complete_attempt",
        tenantId: observation.tenantId,
        dispatchBefore: observation.dispatch,
        attemptBefore: observation.attempt,
        attemptAfter,
        completionSource: "provider_observation",
        completedByTrustedServiceId: observation.observedByTrustedServiceId,
        dispatchAfter
      }
    };
  }
  const currentUnknownIsObservation =
    observation.attempt.outcome.kind === "outcome_unknown" &&
    sameValue(current.dispatch, observation.dispatch) &&
    sameValue(current.attempt, observation.attempt);
  if (
    current.dispatch.state === "outcome_unknown" &&
    current.attempt.outcome.kind === "outcome_unknown" &&
    (currentUnknownIsObservation ||
      pendingObservationToOutcomeUnknownCurrent(observation, current))
  ) {
    const decisionId = deterministicId(
      "outbound_dispatch_reconciliation_decision",
      "core:inbox-v2.outbound-provider-accepted-reconciliation",
      {
        tenantId: observation.tenantId,
        attemptId: observation.attempt.id
      }
    );
    const decision = inboxV2OutboundDispatchReconciliationDecisionSchema.parse({
      tenantId: observation.tenantId,
      id: decisionId,
      dispatch: referenceFactory(observation.tenantId)(
        "outbound_dispatch",
        observation.dispatch.id
      ),
      route: referenceFactory(observation.tenantId)(
        "outbound_route",
        observation.route.id
      ),
      routeSnapshot: observation.route,
      unknownAttempt: current.attempt,
      decidedBy: {
        kind: "trusted_service" as const,
        trustedServiceId: observation.observedByTrustedServiceId
      },
      authorizationEpoch: null,
      result: {
        state: "accepted" as const,
        providerAcknowledgementToken: null,
        evidenceToken: deterministicToken(
          "evidence:provider-settlement",
          "core:inbox-v2.outbound-provider-accepted-evidence",
          { observationId: observation.id }
        )
      },
      decidedAt: settledAt,
      revision: "1"
    });
    return {
      kind: "reconcile_outcome_unknown",
      reconciliationCommit: {
        tenantId: observation.tenantId,
        dispatchBefore: current.dispatch,
        decision,
        dispatchAfter: inboxV2OutboundDispatchSchema.parse({
          ...current.dispatch,
          state: "accepted",
          activeAttempt: null,
          retryAuthorization: null,
          revision: String(BigInt(current.dispatch.revision) + 1n),
          updatedAt: settledAt
        })
      }
    };
  }
  throw planConflict("core:provider-settlement-transition-conflict");
}

function currentAcceptedTransportIsMonotonicDescendant(
  observation: InboxV2OutboundProviderObservation,
  current: InboxV2OutboundProviderCurrentTransportState
): boolean {
  const beforeAttempt = observation.attempt;
  const afterAttempt = current.attempt;
  const beforeDispatch = observation.dispatch;
  const afterDispatch = current.dispatch;
  const dispatchRevisionDelta =
    BigInt(afterDispatch.revision) - BigInt(beforeDispatch.revision);
  const attemptRevisionDelta =
    BigInt(afterAttempt.revision) - BigInt(beforeAttempt.revision);
  const pendingToUnknownAcceptedDescendant =
    beforeAttempt.outcome.kind === "pending" &&
    afterAttempt.outcome.kind === "outcome_unknown" &&
    (afterAttempt.completionSource === "provider_result" ||
      afterAttempt.completionSource === "lease_expired") &&
    attemptRevisionDelta === 1n &&
    dispatchRevisionDelta === 2n;
  const dispatchCoherent =
    afterDispatch.attemptCount === afterAttempt.attemptNumber &&
    afterDispatch.activeAttempt === null &&
    afterDispatch.lastAttempt?.id === afterAttempt.id &&
    (beforeDispatch.state === "accepted"
      ? dispatchRevisionDelta === 0n
      : dispatchRevisionDelta === 1n || pendingToUnknownAcceptedDescendant);
  if (!dispatchCoherent) return false;
  if (beforeAttempt.outcome.kind === "accepted") {
    return (
      afterAttempt.outcome.kind === "accepted" && attemptRevisionDelta === 0n
    );
  }
  if (beforeAttempt.outcome.kind === "outcome_unknown") {
    return sameValue(beforeAttempt, afterAttempt);
  }
  if (pendingToUnknownAcceptedDescendant) return true;
  return (
    afterAttempt.outcome.kind === "accepted" &&
    (afterAttempt.completionSource === "provider_result" ||
      afterAttempt.completionSource === "provider_observation") &&
    attemptRevisionDelta === 1n
  );
}

function pendingObservationToOutcomeUnknownCurrent(
  observation: InboxV2OutboundProviderObservation,
  current: InboxV2OutboundProviderCurrentTransportState
): boolean {
  const beforeDispatch = observation.dispatch;
  const beforeAttempt = observation.attempt;
  const afterDispatch = current.dispatch;
  const afterAttempt = current.attempt;
  return (
    beforeDispatch.state === "attempting" &&
    beforeAttempt.outcome.kind === "pending" &&
    sameDispatchIdentity(beforeDispatch, afterDispatch) &&
    sameAttemptIdentity(beforeAttempt, afterAttempt) &&
    afterDispatch.state === "outcome_unknown" &&
    afterAttempt.outcome.kind === "outcome_unknown" &&
    (afterAttempt.completionSource === "provider_result" ||
      afterAttempt.completionSource === "lease_expired") &&
    afterDispatch.attemptCount === beforeDispatch.attemptCount &&
    afterDispatch.activeAttempt === null &&
    afterDispatch.lastAttempt?.id === afterAttempt.id &&
    BigInt(afterDispatch.revision) === BigInt(beforeDispatch.revision) + 1n &&
    BigInt(afterAttempt.revision) === BigInt(beforeAttempt.revision) + 1n
  );
}

/** Direct-module test seam; intentionally not exported from @hulee/db. */
export function buildInboxV2OutboundProviderSettlementTransitionForTest(
  observation: InboxV2OutboundProviderObservation,
  current: InboxV2OutboundProviderCurrentTransportState,
  completeCoverage: boolean,
  settledAt: string
): InboxV2OutboundProviderSettlementCommit["transition"] {
  return buildTransition(observation, current, completeCoverage, settledAt);
}

function transitionTransport(
  transition: InboxV2OutboundProviderSettlementCommit["transition"]
): Readonly<{
  dispatch: InboxV2OutboundDispatch;
  attempt: InboxV2OutboundDispatchAttempt;
}> {
  switch (transition.kind) {
    case "retain_dispatch_state":
      return { dispatch: transition.dispatch, attempt: transition.attempt };
    case "complete_pending_attempt":
      if (transition.attemptCommit.kind !== "complete_attempt") {
        throw planConflict("core:provider-settlement-transition-conflict");
      }
      return {
        dispatch: transition.attemptCommit.dispatchAfter,
        attempt: transition.attemptCommit.attemptAfter
      };
    case "reconcile_outcome_unknown":
      return {
        dispatch: transition.reconciliationCommit.dispatchAfter,
        attempt: transition.reconciliationCommit.decision.unknownAttempt
      };
    case "already_accepted":
      return { dispatch: transition.dispatch, attempt: transition.attempt };
  }
}

function settlementTimestamp(
  state: InboxV2OutboundProviderSettlementLoadedState
): string {
  const values = [
    state.observation.recordedAt,
    state.observation.sourceOccurrence.recordedAt,
    state.currentTransport.dispatch.updatedAt,
    state.currentTransport.attempt.openedAt,
    state.messageAggregate.message.updatedAt,
    state.messageAggregate.timelineItem.updatedAt,
    state.occurrenceBinding.binding.updatedAt,
    state.externalThreadMapping.thread.updatedAt,
    state.externalMessageReference.createdAt,
    state.linkHeadBefore?.updatedAt,
    state.sourceAccountIdentity?.updatedAt,
    ...state.existingResolutions.map((resolution) => resolution.resolvedAt)
  ].filter((value): value is string => value !== undefined);
  return selectSettlementTimestamp(values, state.plannedAt);
}

/** Direct-module regression seam; intentionally absent from @hulee/db. */
export function selectInboxV2OutboundProviderSettlementTimestampForTest(
  historicalTimestamps: readonly string[],
  plannedAt: string
): string {
  return selectSettlementTimestamp(historicalTimestamps, plannedAt);
}

function selectSettlementTimestamp(
  historicalTimestamps: readonly string[],
  plannedAt: string
): string {
  let maximum = Date.parse(plannedAt);
  if (!Number.isFinite(maximum)) {
    throw planConflict("core:provider-settlement-timestamp-invalid");
  }
  for (const value of historicalTimestamps) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw planConflict("core:provider-settlement-timestamp-invalid");
    }
    maximum = Math.max(maximum, parsed);
  }
  return new Date(maximum).toISOString();
}

function assertLoadedState(
  state: InboxV2OutboundProviderSettlementLoadedState
): void {
  const { claim, observation, currentTransport } = state;
  const message = state.messageAggregate.message;
  const timelineItem = state.messageAggregate.timelineItem;
  if (
    claim.tenantId !== observation.tenantId ||
    claim.observationId !== observation.id ||
    claim.trustedServiceId !== observation.observedByTrustedServiceId ||
    claim.candidateExternalMessageReferenceId !==
      state.externalMessageReference.id ||
    currentTransport.dispatch.id !== observation.dispatch.id ||
    currentTransport.attempt.id !== observation.attempt.id ||
    message.id !== observation.dispatch.message.id ||
    timelineItem.id !== message.timelineItem.id ||
    state.externalMessageReference.timelineItem.id !== timelineItem.id ||
    state.externalMessageReference.message.id !== message.id ||
    state.externalThreadMapping.thread.id !==
      observation.sourceOccurrence.bindingContext.externalThread.id ||
    state.occurrenceBinding.binding.id !==
      observation.sourceOccurrence.bindingContext.sourceThreadBinding.id
  ) {
    throw planConflict("core:provider-settlement-loaded-state-conflict");
  }
  const selectedExisting = state.existingResolutions.filter(
    (resolution) => resolution.effectiveArtifact.id === observation.artifact.id
  );
  if (selectedExisting.length > 1) {
    throw planConflict("core:provider-settlement-resolution-conflict");
  }
  if (
    state.existingArtifactLink !== null &&
    (state.existingArtifactLink.artifact.id !== observation.artifact.id ||
      state.existingArtifactLink.externalMessageReference.id !==
        state.externalMessageReference.id)
  ) {
    throw planConflict("core:provider-settlement-artifact-link-conflict");
  }
}

function requireResponseIdentity(
  state: InboxV2OutboundProviderSettlementLoadedState
): VerifiedSourceAccountIdentity {
  if (state.sourceAccountIdentity === null) {
    throw planConflict("core:provider-settlement-account-snapshot-missing");
  }
  return state.sourceAccountIdentity;
}

function requireEchoOccurrence(
  state: InboxV2OutboundProviderSettlementLoadedState
): InboxV2SourceOccurrence {
  if (
    state.persistedOccurrence === null ||
    !sameValue(state.persistedOccurrence, state.observation.sourceOccurrence)
  ) {
    throw planConflict("core:provider-settlement-echo-occurrence-missing");
  }
  return state.persistedOccurrence;
}

function parseObservationSnapshot(
  detail: unknown,
  digest: unknown
): InboxV2OutboundProviderObservation {
  const observation = detail as InboxV2OutboundProviderObservation;
  const expected =
    calculateInboxV2OutboundProviderObservationDetailDigest(observation);
  if (String(digest) !== expected) {
    throw invariantError("Artifact resolution observation digest mismatch.");
  }
  return observation;
}

function deterministicId(
  kind: string,
  domain: string,
  identity: unknown
): string {
  const digest = calculateInboxV2CanonicalSha256({
    domain,
    hashVersion: "v1",
    identity
  }).slice("sha256:".length);
  return `${kind}:${digest}`;
}

function deterministicToken(
  prefix: string,
  domain: string,
  identity: unknown
): string {
  const digest = calculateInboxV2CanonicalSha256({
    domain,
    hashVersion: "v1",
    identity
  }).slice("sha256:".length);
  return `${prefix}:${digest}`;
}

function referenceFactory(tenantId: string) {
  return <const TKind extends string>(kind: TKind, id: unknown) => ({
    tenantId,
    kind,
    id: String(id)
  });
}

function sameDispatchIdentity(
  left: InboxV2OutboundDispatch,
  right: InboxV2OutboundDispatch
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    left.message.id === right.message.id &&
    left.route.id === right.route.id &&
    left.createdAt === right.createdAt
  );
}

function sameAttemptIdentity(
  left: InboxV2OutboundDispatchAttempt,
  right: InboxV2OutboundDispatchAttempt
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    left.dispatch.id === right.dispatch.id &&
    left.route.id === right.route.id &&
    left.attemptNumber === right.attemptNumber &&
    left.claimToken === right.claimToken &&
    sameValue(left.retrySafety, right.retrySafety) &&
    left.leaseExpiresAt === right.leaseExpiresAt &&
    left.openedAt === right.openedAt
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw invariantError(`${field} is invalid.`);
  }
  return parsed.toISOString();
}

function dead(errorCode: string): InboxV2OutboundProviderSettlementPlanResult {
  return { kind: "dead", errorCode };
}

class InboxV2SettlementPlanConflict extends Error {
  constructor(
    readonly code: string,
    options: { cause?: unknown } = {}
  ) {
    super(
      code,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "InboxV2SettlementPlanConflict";
  }
}

function planConflict(
  code: string,
  cause?: unknown
): InboxV2SettlementPlanConflict {
  return new InboxV2SettlementPlanConflict(code, { cause });
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
