import {
  inboxV2OutboundProviderSettlementCommitSchema,
  type InboxV2OutboundDispatchArtifactReferenceLink,
  type InboxV2OutboundDispatchArtifactResolution,
  type InboxV2OutboundProviderSettlementCommit
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { requireInboxV2AtomicSealExecutor } from "./sql-inbox-v2-atomic-materialization-internal";
import {
  assertInboxV2AuthorizedAtomicMaterializationContext,
  assertInboxV2AuthorizedCommandMutationContext,
  createSqlInboxV2AuthorizedCommandCoordinator,
  type InboxV2AuthorizedAtomicMaterializationContext,
  type InboxV2AuthorizedCommandMutationContext,
  type InboxV2AuthorizedCommandMutationResult,
  type InboxV2AuthorizationTransactionExecutor,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import { readInboxV2OutboundProviderObservationInTransaction } from "./sql-inbox-v2-outbound-provider-observation-repository";
import {
  lockInboxV2OutboundProviderSettlementWorkLeaseInTransaction,
  type InboxV2OutboundProviderSettlementWorkLeaseFence
} from "./sql-inbox-v2-outbound-provider-settlement-work-repository";
import {
  applyInboxV2OutboundProviderSettlementTransitionInTransaction,
  buildInsertInboxV2OutboundDispatchArtifactReferenceLinkSql,
  lockAndValidateInboxV2OutboundDispatchAttemptInTransaction,
  resolveInboxV2SourceOccurrenceInTransaction
} from "./sql-inbox-v2-outbound-transport-repository";
import {
  materializeInboxV2SourceOccurrenceInTransaction,
  readInboxV2SourceOccurrenceInTransaction
} from "./sql-inbox-v2-source-occurrence-repository";
import {
  prepareInboxV2MessageTransportAssociation,
  sealInboxV2PreparedMessageTransportAssociation,
  type InboxV2PreparedMessageTransportAssociationCapability
} from "./sql-inbox-v2-timeline-message-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export const INBOX_V2_OUTBOUND_PROVIDER_SETTLEMENT_COMMAND_TYPE_ID =
  "core:outbound-provider-observation.settle" as const;

export type InboxV2OutboundProviderSettlementApplied = Readonly<{
  observationId: string;
  artifactResolutionId: string;
  canonicalArtifactReferenceLinkId: string;
  messageTransportLinkId: string;
}>;

export type InboxV2OutboundProviderSettlementConflictReason =
  | "work_lease_conflict"
  | "observation_conflict"
  | "observation_already_settled"
  | "source_occurrence_conflict"
  | "artifact_resolution_conflict"
  | "artifact_association_conflict"
  | "dispatch_transition_conflict"
  | "message_transport_conflict";

export type InboxV2OutboundProviderSettlementCommandResult =
  | InboxV2AuthorizedCommandMutationResult<InboxV2OutboundProviderSettlementApplied>
  | Readonly<{
      kind: "settlement_conflict";
      reason: InboxV2OutboundProviderSettlementConflictReason;
      detail: string;
    }>;

export type InboxV2OutboundProviderSettlementService = Readonly<{
  settle(
    input: Readonly<{
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      workLease: InboxV2OutboundProviderSettlementWorkLeaseFence;
      commit: InboxV2OutboundProviderSettlementCommit;
    }>
  ): Promise<InboxV2OutboundProviderSettlementCommandResult>;
}>;

const inboxV2PreparedOutboundProviderSettlementCapabilityBrand: unique symbol =
  Symbol("inbox-v2-prepared-outbound-provider-settlement-capability");

export type InboxV2PreparedOutboundProviderSettlementCapability = Readonly<{
  [inboxV2PreparedOutboundProviderSettlementCapabilityBrand]: true;
}>;

type PreparedSettlementState = {
  readonly atomicMaterializationToken: object;
  readonly sealExecutor: RawSqlExecutor;
  readonly commit: InboxV2OutboundProviderSettlementCommit;
  readonly transport: InboxV2PreparedMessageTransportAssociationCapability;
  consumed: boolean;
};

const preparedSettlements = new WeakMap<
  InboxV2PreparedOutboundProviderSettlementCapability,
  PreparedSettlementState
>();

type ArtifactResolutionRow = Readonly<{
  id: unknown;
  artifact_id: unknown;
  dispatch_id: unknown;
  route_id: unknown;
  attempt_id: unknown;
  message_id: unknown;
  artifact_ordinal: unknown;
  from_state: unknown;
  effective_state: unknown;
  observation_id: unknown;
  observation_source_occurrence_id: unknown;
  resolved_by_trusted_service_id: unknown;
  resolved_at: unknown;
  revision: unknown;
}>;

type ArtifactReferenceLinkRow = Readonly<{
  id: unknown;
  artifact_id: unknown;
  dispatch_id: unknown;
  route_id: unknown;
  attempt_id: unknown;
  message_id: unknown;
  external_thread_id: unknown;
  external_message_reference_id: unknown;
  source_occurrence_id: unknown;
  evidence_kind: unknown;
  provider_reference_kind_id: unknown;
  correlation_token: unknown;
  linked_by_trusted_service_id: unknown;
  linked_at: unknown;
  revision: unknown;
}>;

export function createSqlInboxV2OutboundProviderSettlementService(
  executor: InboxV2AuthorizationTransactionExecutor | HuleeDatabase
): InboxV2OutboundProviderSettlementService {
  const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(executor);
  return Object.freeze({
    async settle(input) {
      const commit = inboxV2OutboundProviderSettlementCommitSchema.parse(
        input.commit
      );
      try {
        return await coordinator.withAuthorizedAtomicMaterialization(
          input.authorizedMutation,
          (context) =>
            prepareInboxV2OutboundProviderSettlement(context, {
              workLease: input.workLease,
              commit
            }),
          async (context, capability) =>
            sealInboxV2PreparedOutboundProviderSettlement(context, {
              capability
            })
        );
      } catch (error) {
        if (error instanceof InboxV2OutboundProviderSettlementRollback) {
          return {
            kind: "settlement_conflict",
            reason: error.reason,
            detail: error.detail
          };
        }
        throw error;
      }
    }
  });
}

export async function prepareInboxV2OutboundProviderSettlement(
  context: InboxV2AuthorizedCommandMutationContext,
  input: Readonly<{
    workLease: InboxV2OutboundProviderSettlementWorkLeaseFence;
    commit: InboxV2OutboundProviderSettlementCommit;
  }>
): Promise<InboxV2PreparedOutboundProviderSettlementCapability> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  const commit = inboxV2OutboundProviderSettlementCommitSchema.parse(
    input.commit
  );
  assertSettlementAuthority(context, commit);
  assertSettlementWorkIdentity(input.workLease, commit);
  if (commit.occurrenceMaterialization.kind === "provider_response") {
    // Provider-response proof validation reads attempt/dispatch rows. Take
    // their canonical UPDATE locks first so its later SHARE rowmarks are
    // re-entrant and cannot invert against synchronous provider-result writes.
    await lockObservedDispatchAndAttempt(context.executor, commit);
    await materializeObservedOccurrence(context.executor, commit);
  } else {
    // The provider-echo SourceOccurrence already exists and is the first
    // mutable aggregate in this path.
    await materializeObservedOccurrence(context.executor, commit);
    await lockObservedDispatchAndAttempt(context.executor, commit);
  }
  await lockObservedArtifact(context.executor, commit);
  await lockObservationAndRejectExistingSettlement(context.executor, commit);
  const leaseIsLive =
    await lockInboxV2OutboundProviderSettlementWorkLeaseInTransaction(
      context.executor,
      input.workLease
    );
  if (!leaseIsLive) {
    rollback(
      "work_lease_conflict",
      "Provider settlement requires the exact live durable work lease."
    );
  }
  await persistArtifactResolution(context.executor, commit);
  await persistOccurrenceAndArtifactAssociation(context.executor, commit);

  const transition =
    await applyInboxV2OutboundProviderSettlementTransitionInTransaction(
      context.executor,
      commit
    );
  if (
    transition.kind !== "committed" &&
    transition.kind !== "already_applied"
  ) {
    rollback(
      "dispatch_transition_conflict",
      `Provider settlement transition was rejected: ${transition.kind}.`
    );
  }

  const transport = await prepareInboxV2MessageTransportAssociation(context, {
    commit: commit.messageTransportAssociation
  });
  if (transport.kind !== "ready") {
    rollback(
      "message_transport_conflict",
      `Message transport preparation was rejected: ${transport.kind}.`
    );
  }

  const capability = Object.freeze({
    [inboxV2PreparedOutboundProviderSettlementCapabilityBrand]: true as const
  });
  preparedSettlements.set(capability, {
    atomicMaterializationToken: requireAtomicToken(context),
    sealExecutor: requireInboxV2AtomicSealExecutor(context),
    commit,
    transport: transport.capability,
    consumed: false
  });
  return capability;
}

export async function sealInboxV2PreparedOutboundProviderSettlement(
  context: InboxV2AuthorizedAtomicMaterializationContext,
  input: Readonly<{
    capability: InboxV2PreparedOutboundProviderSettlementCapability;
  }>
) {
  assertInboxV2AuthorizedAtomicMaterializationContext(context);
  const prepared = preparedSettlements.get(input.capability);
  if (prepared === undefined || prepared.consumed) {
    throw invariantError(
      "Outbound provider settlement capability is unknown or already consumed."
    );
  }
  if (
    prepared.atomicMaterializationToken !==
      context.atomicMaterializationToken ||
    prepared.commit.tenantId !== context.tenantId
  ) {
    throw invariantError(
      "Outbound provider settlement capability belongs to another atomic mutation."
    );
  }
  assertSettlementAuthority(context, prepared.commit);
  prepared.consumed = true;

  const transport = await sealInboxV2PreparedMessageTransportAssociation(
    context,
    { capability: prepared.transport }
  );
  const settlement = await prepared.sealExecutor.execute<{ id: unknown }>(
    buildInsertInboxV2OutboundProviderObservationSettlementSql(prepared.commit)
  );
  if (settlement.rows.length !== 1) {
    throw invariantError(
      "Provider observation settlement insert did not append exactly one row."
    );
  }
  return {
    result: settlementAppliedResult(prepared.commit),
    receipt: transport.receipt
  };
}

async function lockObservationAndRejectExistingSettlement(
  executor: RawSqlExecutor,
  commit: InboxV2OutboundProviderSettlementCommit
): Promise<void> {
  const observation = await readInboxV2OutboundProviderObservationInTransaction(
    executor,
    {
      tenantId: commit.tenantId,
      observationId: commit.observation.id
    },
    { lock: true }
  );
  if (observation === null || !sameValue(observation, commit.observation)) {
    rollback(
      "observation_conflict",
      "Provider settlement requires the exact immutable persisted observation."
    );
  }
  const existing = await executor.execute<{ observation_id: unknown }>(sql`
    select observation_id
      from inbox_v2_outbound_provider_observation_settlements
     where tenant_id = ${commit.tenantId}
       and observation_id = ${commit.observation.id}
     for share
  `);
  if (existing.rows.length > 1) {
    throw invariantError("Provider observation has multiple settlements.");
  }
  if (existing.rows.length === 1) {
    rollback(
      "observation_already_settled",
      "Provider observation was settled by another command."
    );
  }
}

async function materializeObservedOccurrence(
  executor: RawSqlExecutor,
  commit: InboxV2OutboundProviderSettlementCommit
): Promise<void> {
  if (commit.occurrenceMaterialization.kind === "provider_response") {
    const result = await materializeInboxV2SourceOccurrenceInTransaction(
      executor,
      commit.occurrenceMaterialization.commit
    );
    if (
      (result.kind !== "materialized" &&
        result.kind !== "already_materialized") ||
      !sameValue(result.occurrence, commit.observation.sourceOccurrence)
    ) {
      rollback(
        "source_occurrence_conflict",
        `Provider-response occurrence materialization was rejected: ${result.kind}.`
      );
    }
  }

  const persisted = await readInboxV2SourceOccurrenceInTransaction(
    executor,
    {
      tenantId: commit.tenantId,
      occurrenceId: commit.observation.sourceOccurrence.id
    },
    { lock: true }
  );
  if (
    persisted === null ||
    !sameValue(persisted, commit.observation.sourceOccurrence)
  ) {
    rollback(
      "source_occurrence_conflict",
      "Provider settlement requires the exact locked pending SourceOccurrence."
    );
  }
}

async function lockObservedDispatchAndAttempt(
  executor: RawSqlExecutor,
  commit: InboxV2OutboundProviderSettlementCommit
): Promise<void> {
  const head = settlementTransitionLockHead(commit);
  const result =
    await lockAndValidateInboxV2OutboundDispatchAttemptInTransaction(executor, {
      dispatch: head.dispatch,
      attempt: head.attempt
    });
  if (result.kind !== "matched") {
    rollback(
      "dispatch_transition_conflict",
      `Provider settlement dispatch/attempt fence was rejected: ${result.kind}.`
    );
  }
}

function settlementTransitionLockHead(
  commit: InboxV2OutboundProviderSettlementCommit
): Readonly<{
  dispatch: InboxV2OutboundProviderSettlementCommit["observation"]["dispatch"];
  attempt: InboxV2OutboundProviderSettlementCommit["observation"]["attempt"];
}> {
  const transition = commit.transition;
  if (transition.kind === "complete_pending_attempt") {
    if (transition.attemptCommit.kind !== "complete_attempt") {
      throw invariantError(
        "Provider settlement completion requires a complete-attempt transition."
      );
    }
    return {
      dispatch: transition.attemptCommit.dispatchBefore,
      attempt: transition.attemptCommit.attemptBefore
    };
  }
  if (transition.kind === "reconcile_outcome_unknown") {
    return {
      dispatch: transition.reconciliationCommit.dispatchBefore,
      attempt: transition.reconciliationCommit.decision.unknownAttempt
    };
  }
  if (transition.kind === "already_accepted") {
    return { dispatch: transition.dispatch, attempt: transition.attempt };
  }
  if (transition.kind === "retain_dispatch_state") {
    return { dispatch: transition.dispatch, attempt: transition.attempt };
  }
  return {
    dispatch: commit.observation.dispatch,
    attempt: commit.observation.attempt
  };
}

async function lockObservedArtifact(
  executor: RawSqlExecutor,
  commit: InboxV2OutboundProviderSettlementCommit
): Promise<void> {
  const artifact = commit.observation.artifact;
  const rows = await executor.execute<Record<string, unknown>>(sql`
    select id, dispatch_id, route_id, attempt_id, message_id, ordinal, state,
           created_at, revision
      from inbox_v2_outbound_dispatch_artifacts
     where tenant_id = ${artifact.tenantId}
       and id = ${artifact.id}
     for update
  `);
  const row = rows.rows[0];
  if (
    rows.rows.length !== 1 ||
    row === undefined ||
    String(row.id) !== String(artifact.id) ||
    String(row.dispatch_id) !== String(artifact.dispatch.id) ||
    String(row.route_id) !== String(artifact.route.id) ||
    String(row.attempt_id) !== String(artifact.attempt.id) ||
    String(row.message_id) !== String(commit.observation.dispatch.message.id) ||
    Number(row.ordinal) !== artifact.ordinal ||
    String(row.state) !== artifact.state ||
    !sameTimestamp(row.created_at, artifact.createdAt) ||
    BigInt(String(row.revision)) !== BigInt(artifact.revision)
  ) {
    rollback(
      "artifact_resolution_conflict",
      "Provider observation artifact no longer matches its immutable database fact."
    );
  }
}

async function persistArtifactResolution(
  executor: RawSqlExecutor,
  commit: InboxV2OutboundProviderSettlementCommit
): Promise<void> {
  const resolution = selectedArtifactResolution(commit);
  if (commit.artifactResolution.kind === "create") {
    const inserted = await executor.execute<{ id: unknown }>(
      buildInsertInboxV2OutboundDispatchArtifactResolutionSql(resolution)
    );
    if (inserted.rows.length > 1) {
      throw invariantError(
        "Artifact resolution insert returned multiple rows."
      );
    }
    if (inserted.rows.length === 1) return;
  }
  const existing = await executor.execute<ArtifactResolutionRow>(
    buildFindInboxV2OutboundDispatchArtifactResolutionSql(resolution)
  );
  if (
    existing.rows.length !== 1 ||
    existing.rows[0] === undefined ||
    !artifactResolutionRowMatches(existing.rows[0], resolution)
  ) {
    rollback(
      "artifact_resolution_conflict",
      "Effective artifact resolution is missing or differs from the settlement proof."
    );
  }
}

async function persistOccurrenceAndArtifactAssociation(
  executor: RawSqlExecutor,
  commit: InboxV2OutboundProviderSettlementCommit
): Promise<void> {
  const resolution = await resolveInboxV2SourceOccurrenceInTransaction(
    executor,
    commit.occurrenceResolution
  );
  if (resolution.kind !== "committed" && resolution.kind !== "already_exists") {
    rollback(
      "source_occurrence_conflict",
      `SourceOccurrence resolution was rejected: ${resolution.kind}.`
    );
  }

  const association = commit.artifactAssociation;
  const link =
    association.kind === "create"
      ? association.commit.link
      : association.existingLink;
  if (association.kind === "create") {
    const inserted = await executor.execute<{ id: unknown }>(
      buildInsertInboxV2OutboundDispatchArtifactReferenceLinkSql(
        association.commit
      )
    );
    if (inserted.rows.length > 1) {
      throw invariantError(
        "Artifact reference link insert returned multiple rows."
      );
    }
    if (inserted.rows.length === 1) return;
  }
  const existing = await loadArtifactReferenceLink(executor, link);
  if (
    existing === null ||
    !artifactReferenceLinkRowMatches(
      existing,
      link,
      commit.observation.dispatch.message.id
    )
  ) {
    rollback(
      "artifact_association_conflict",
      "Canonical artifact reference link is missing or differs from the settlement proof."
    );
  }
}

async function loadArtifactReferenceLink(
  executor: RawSqlExecutor,
  link: InboxV2OutboundDispatchArtifactReferenceLink
): Promise<ArtifactReferenceLinkRow | null> {
  const result = await executor.execute<ArtifactReferenceLinkRow>(sql`
    select id, artifact_id, dispatch_id, route_id, attempt_id, message_id,
           external_thread_id, external_message_reference_id,
           source_occurrence_id, evidence_kind, provider_reference_kind_id,
           correlation_token, linked_by_trusted_service_id, linked_at, revision
      from inbox_v2_outbound_dispatch_artifact_reference_links
     where tenant_id = ${link.tenantId}
       and (id = ${link.id} or artifact_id = ${link.artifact.id})
     order by case when id = ${link.id} then 0 else 1 end
     limit 2
     for share
  `);
  return result.rows.length === 1 ? (result.rows[0] ?? null) : null;
}

export function buildInsertInboxV2OutboundDispatchArtifactResolutionSql(
  resolution: InboxV2OutboundDispatchArtifactResolution
): SQL {
  return sql`
    insert into inbox_v2_outbound_dispatch_artifact_resolutions (
      tenant_id, id, artifact_id, dispatch_id, route_id, attempt_id,
      message_id, artifact_ordinal, from_state, effective_state,
      observation_id, observation_source_occurrence_id,
      resolved_by_trusted_service_id, resolved_at, revision
    ) values (
      ${resolution.tenantId}, ${resolution.id},
      ${resolution.effectiveArtifact.id}, ${resolution.observation.dispatch.id},
      ${resolution.observation.route.id}, ${resolution.observation.attempt.id},
      ${resolution.observation.dispatch.message.id},
      ${resolution.artifactOrdinal}, ${resolution.fromState},
      ${resolution.effectiveState}, ${resolution.observation.id},
      ${resolution.observation.sourceOccurrence.id},
      ${resolution.resolvedByTrustedServiceId},
      ${toDate(resolution.resolvedAt)}, ${BigInt(resolution.revision)}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildFindInboxV2OutboundDispatchArtifactResolutionSql(
  resolution: InboxV2OutboundDispatchArtifactResolution
): SQL {
  return sql`
    select id, artifact_id, dispatch_id, route_id, attempt_id, message_id,
           artifact_ordinal, from_state, effective_state, observation_id,
           observation_source_occurrence_id, resolved_by_trusted_service_id,
           resolved_at, revision
      from inbox_v2_outbound_dispatch_artifact_resolutions
     where tenant_id = ${resolution.tenantId}
       and (id = ${resolution.id}
         or artifact_id = ${resolution.effectiveArtifact.id})
     order by case when id = ${resolution.id} then 0 else 1 end
     limit 2
     for share
  `;
}

export function buildInsertInboxV2OutboundProviderObservationSettlementSql(
  commit: InboxV2OutboundProviderSettlementCommit
): SQL {
  const resolution = selectedArtifactResolution(commit);
  const artifactLink =
    commit.artifactAssociation.kind === "create"
      ? commit.artifactAssociation.commit.link
      : commit.artifactAssociation.existingLink;
  const reconciliation =
    commit.transition.kind === "reconcile_outcome_unknown"
      ? commit.transition.reconciliationCommit.decision
      : null;
  return sql`
    insert into inbox_v2_outbound_provider_observation_settlements (
      tenant_id, observation_id, artifact_resolution_id, artifact_id,
      dispatch_id, route_id, attempt_id, message_id, artifact_ordinal,
      effective_state, source_occurrence_id, source_occurrence_revision,
      source_occurrence_resolution_state, external_thread_id,
      external_message_reference_id, canonical_artifact_reference_link_id,
      message_transport_link_id, transition_kind,
      reconciliation_decision_id, reconciliation_result_state,
      settled_by_trusted_service_id, settled_at, revision
    ) values (
      ${commit.tenantId}, ${commit.observation.id}, ${resolution.id},
      ${commit.observation.artifact.id}, ${commit.observation.dispatch.id},
      ${commit.observation.route.id}, ${commit.observation.attempt.id},
      ${commit.observation.dispatch.message.id},
      ${commit.observation.artifact.ordinal}, 'accepted',
      ${commit.occurrenceResolution.after.id},
      ${BigInt(commit.occurrenceResolution.after.revision)}, 'resolved',
      ${commit.externalMessageReference.key.externalThread.id},
      ${commit.externalMessageReference.id}, ${artifactLink.id},
      ${commit.messageTransportAssociation.link.id}, ${commit.transition.kind},
      ${reconciliation?.id ?? null}, ${reconciliation?.result.state ?? null},
      ${commit.settledByTrustedServiceId}, ${toDate(commit.settledAt)}, 1
    )
    on conflict do nothing
    returning observation_id as id
  `;
}

function selectedArtifactResolution(
  commit: InboxV2OutboundProviderSettlementCommit
): InboxV2OutboundDispatchArtifactResolution {
  return commit.artifactResolution.kind === "create"
    ? commit.artifactResolution.resolution
    : commit.artifactResolution.existingResolution;
}

function artifactResolutionRowMatches(
  row: ArtifactResolutionRow,
  resolution: InboxV2OutboundDispatchArtifactResolution
): boolean {
  return (
    String(row.id) === String(resolution.id) &&
    String(row.artifact_id) === String(resolution.effectiveArtifact.id) &&
    String(row.dispatch_id) === String(resolution.observation.dispatch.id) &&
    String(row.route_id) === String(resolution.observation.route.id) &&
    String(row.attempt_id) === String(resolution.observation.attempt.id) &&
    String(row.message_id) ===
      String(resolution.observation.dispatch.message.id) &&
    Number(row.artifact_ordinal) === resolution.artifactOrdinal &&
    String(row.from_state) === resolution.fromState &&
    String(row.effective_state) === resolution.effectiveState &&
    String(row.observation_id) === String(resolution.observation.id) &&
    String(row.observation_source_occurrence_id) ===
      String(resolution.observation.sourceOccurrence.id) &&
    String(row.resolved_by_trusted_service_id) ===
      String(resolution.resolvedByTrustedServiceId) &&
    sameTimestamp(row.resolved_at, resolution.resolvedAt) &&
    BigInt(String(row.revision)) === BigInt(resolution.revision)
  );
}

function artifactReferenceLinkRowMatches(
  row: ArtifactReferenceLinkRow,
  link: InboxV2OutboundDispatchArtifactReferenceLink,
  expectedMessageId: string
): boolean {
  const evidence = link.associationEvidence;
  return (
    String(row.id) === String(link.id) &&
    String(row.artifact_id) === String(link.artifact.id) &&
    String(row.dispatch_id) === String(link.dispatch.id) &&
    String(row.route_id) === String(link.route.id) &&
    String(row.attempt_id) === String(link.attempt.id) &&
    String(row.message_id) === String(expectedMessageId) &&
    String(row.external_thread_id) === String(link.externalThread.id) &&
    String(row.external_message_reference_id) ===
      String(link.externalMessageReference.id) &&
    String(row.source_occurrence_id) === String(link.sourceOccurrence.id) &&
    String(row.evidence_kind) === evidence.kind &&
    nullableString(row.provider_reference_kind_id) ===
      (evidence.kind === "provider_echo_correlation"
        ? String(evidence.providerReferenceKindId)
        : null) &&
    nullableString(row.correlation_token) ===
      (evidence.kind === "provider_echo_correlation"
        ? String(evidence.correlationToken)
        : null) &&
    String(row.linked_by_trusted_service_id) ===
      String(link.linkedByTrustedServiceId) &&
    sameTimestamp(row.linked_at, link.linkedAt) &&
    BigInt(String(row.revision)) === BigInt(link.revision)
  );
}

function settlementAppliedResult(
  commit: InboxV2OutboundProviderSettlementCommit
): InboxV2OutboundProviderSettlementApplied {
  const resolution = selectedArtifactResolution(commit);
  const artifactLink =
    commit.artifactAssociation.kind === "create"
      ? commit.artifactAssociation.commit.link
      : commit.artifactAssociation.existingLink;
  return {
    observationId: commit.observation.id,
    artifactResolutionId: resolution.id,
    canonicalArtifactReferenceLinkId: artifactLink.id,
    messageTransportLinkId: commit.messageTransportAssociation.link.id
  };
}

function assertSettlementAuthority(
  context: Pick<
    InboxV2AuthorizedCommandMutationContext,
    "tenantId" | "commandTypeId" | "actor" | "occurredAt"
  >,
  commit: InboxV2OutboundProviderSettlementCommit
): void {
  if (
    context.tenantId !== commit.tenantId ||
    context.commandTypeId !==
      INBOX_V2_OUTBOUND_PROVIDER_SETTLEMENT_COMMAND_TYPE_ID ||
    context.actor.kind !== "trusted_service" ||
    context.actor.trustedServiceId !== commit.settledByTrustedServiceId ||
    context.occurredAt !== commit.settledAt
  ) {
    throw invariantError(
      "Outbound provider settlement does not match its authorized trusted-service command."
    );
  }
}

function assertSettlementWorkIdentity(
  workLease: InboxV2OutboundProviderSettlementWorkLeaseFence,
  commit: InboxV2OutboundProviderSettlementCommit
): void {
  if (
    workLease.tenantId !== commit.tenantId ||
    workLease.observationId !== commit.observation.id ||
    workLease.candidateExternalMessageReferenceId !==
      commit.externalMessageReference.id ||
    workLease.candidateTransportLinkId !==
      commit.messageTransportAssociation.link.id ||
    workLease.trustedServiceId !== commit.settledByTrustedServiceId
  ) {
    throw invariantError(
      "Outbound provider settlement commit does not match its durable work identity."
    );
  }
}

function requireAtomicToken(
  context: InboxV2AuthorizedCommandMutationContext
): object {
  const token = context.atomicMaterializationToken;
  if (token === undefined) {
    throw invariantError(
      "Outbound provider settlement requires an atomic materialization token."
    );
  }
  return token;
}

function rollback(
  reason: InboxV2OutboundProviderSettlementConflictReason,
  detail: string
): never {
  throw new InboxV2OutboundProviderSettlementRollback(reason, detail);
}

class InboxV2OutboundProviderSettlementRollback extends Error {
  constructor(
    readonly reason: InboxV2OutboundProviderSettlementConflictReason,
    readonly detail: string
  ) {
    super(detail);
    this.name = "InboxV2OutboundProviderSettlementRollback";
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameTimestamp(value: unknown, expected: string): boolean {
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === expected;
}

function toDate(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError("Outbound provider settlement timestamp is invalid.");
  }
  return parsed;
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
