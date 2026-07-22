import {
  calculateInboxV2OutboundProviderObservationDetailDigest,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundProviderObservationSchema,
  type InboxV2OutboundDispatchContentPlan,
  type InboxV2OutboundDispatchAttemptCommit,
  type InboxV2OutboundProviderObservation
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type PersistInboxV2OutboundProviderObservationResult =
  | Readonly<{ kind: "committed" | "already_exists" }>
  | Readonly<{ kind: "conflict" }>;

type OpenAttemptCommit = Extract<
  InboxV2OutboundDispatchAttemptCommit,
  { kind: "open_attempt" }
>;

export type PersistInboxV2OutboundProviderCorrelationAnchorResult =
  | Readonly<{ kind: "committed" | "already_exists" | "not_required" }>
  | Readonly<{ kind: "conflict" }>;

type CorrelationAnchorRow = Readonly<{
  adapter_contract_id: unknown;
  adapter_contract_version: unknown;
  adapter_declaration_revision: unknown;
  adapter_surface_id: unknown;
  correlation_token: unknown;
  dispatch_id: unknown;
  route_id: unknown;
  message_id: unknown;
  first_attempt_id: unknown;
  external_thread_id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  source_thread_binding_id: unknown;
  binding_generation: unknown;
  retry_safety_mechanism: unknown;
  declared_by_trusted_service_id: unknown;
  created_at: unknown;
  revision: unknown;
}>;

type ObservationReplayRow = Readonly<{
  id: unknown;
  artifact_id: unknown;
  dispatch_id: unknown;
  route_id: unknown;
  attempt_id: unknown;
  message_id: unknown;
  artifact_ordinal: unknown;
  artifact_state: unknown;
  effective_state: unknown;
  content_plan_id: unknown;
  content_plan_digest_sha256: unknown;
  source_occurrence_id: unknown;
  source_occurrence_detail_digest_sha256: unknown;
  observation_detail_digest_sha256: unknown;
  evidence_kind: unknown;
  provider_reference_kind_id: unknown;
  correlation_token: unknown;
  observed_by_trusted_service_id: unknown;
  recorded_at: unknown;
  revision: unknown;
}>;

type ObservationDetailRow = Readonly<{
  observation_detail: unknown;
  observation_detail_digest_sha256: unknown;
}>;

/** Must run after the attempt insert and before any provider I/O. */
export async function persistInboxV2OutboundProviderCorrelationAnchorInTransaction(
  transaction: RawSqlExecutor,
  input: OpenAttemptCommit
): Promise<PersistInboxV2OutboundProviderCorrelationAnchorResult> {
  const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse(input);
  if (commit.kind !== "open_attempt") {
    throw new TypeError(
      "Provider correlation anchor requires an open attempt."
    );
  }
  const retrySafety = commit.attempt.retrySafety;
  if (
    retrySafety.mechanism === "unsafe_or_unknown" ||
    retrySafety.providerCorrelationToken === null
  ) {
    return { kind: "not_required" };
  }
  const inserted = await transaction.execute<{ id: unknown }>(
    buildInsertInboxV2OutboundProviderCorrelationAnchorSql(commit)
  );
  if (inserted.rows.length > 1) {
    throw invariantError("Correlation anchor insert returned multiple rows.");
  }
  if (inserted.rows.length === 1) return { kind: "committed" };
  const existing = await transaction.execute<CorrelationAnchorRow>(
    buildFindInboxV2OutboundProviderCorrelationAnchorSql(commit)
  );
  if (existing.rows.length > 1) {
    throw invariantError("Correlation anchor lookup returned multiple rows.");
  }
  const row = existing.rows[0];
  return row !== undefined && correlationAnchorMatches(row, commit)
    ? { kind: "already_exists" }
    : { kind: "conflict" };
}

export function buildInsertInboxV2OutboundProviderCorrelationAnchorSql(
  commit: OpenAttemptCommit
): SQL {
  const route = commit.routeSnapshot;
  const retrySafety = commit.attempt.retrySafety;
  const adapter = route.adapterContract;
  return sql`
    insert into inbox_v2_outbound_provider_correlation_anchors (
      tenant_id, adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id, correlation_token,
      dispatch_id, route_id, message_id, first_attempt_id,
      external_thread_id, source_connection_id, source_account_id,
      source_thread_binding_id, binding_generation, retry_safety_mechanism,
      declared_by_trusted_service_id, created_at, revision
    ) values (
      ${commit.tenantId}, ${adapter.contractId}, ${adapter.contractVersion},
      ${BigInt(adapter.declarationRevision)}, ${adapter.surfaceId},
      ${retrySafety.providerCorrelationToken}, ${commit.dispatchBefore.id},
      ${route.id}, ${commit.dispatchBefore.message.id}, ${commit.attempt.id},
      ${route.externalThread.id}, ${route.sourceConnection.id},
      ${route.sourceAccount.id}, ${route.sourceThreadBinding.id},
      ${BigInt(route.bindingFence.bindingGeneration)},
      ${retrySafety.mechanism}, ${retrySafety.declaredByTrustedServiceId},
      ${toDate(commit.attempt.openedAt)}, 1
    )
    on conflict do nothing
    returning first_attempt_id as id
  `;
}

export function buildFindInboxV2OutboundProviderCorrelationAnchorSql(
  commit: OpenAttemptCommit
): SQL {
  const adapter = commit.routeSnapshot.adapterContract;
  return sql`
    select adapter_contract_id, adapter_contract_version,
           adapter_declaration_revision, adapter_surface_id,
           correlation_token, dispatch_id, route_id, message_id,
           first_attempt_id, external_thread_id, source_connection_id,
           source_account_id, source_thread_binding_id, binding_generation,
           retry_safety_mechanism, declared_by_trusted_service_id,
           created_at, revision
      from inbox_v2_outbound_provider_correlation_anchors
     where tenant_id = ${commit.tenantId}
       and (
         dispatch_id = ${commit.dispatchBefore.id}
         or (
           adapter_contract_id = ${adapter.contractId}
           and adapter_contract_version = ${adapter.contractVersion}
           and adapter_declaration_revision =
             ${BigInt(adapter.declarationRevision)}
           and adapter_surface_id = ${adapter.surfaceId}
           and correlation_token =
             ${commit.attempt.retrySafety.providerCorrelationToken}
         )
       )
     order by case when dispatch_id = ${commit.dispatchBefore.id} then 0 else 1 end
     limit 2
     for share
  `;
}

/**
 * Persists one normalized provider fact inside the caller-owned transaction.
 * A provider response deliberately does not require a SourceOccurrence FK yet:
 * settlement materializes that row after the network-result transaction has
 * committed. Echo observations resolve the immutable correlation anchor here.
 */
export async function persistInboxV2OutboundProviderObservationInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    observation: InboxV2OutboundProviderObservation;
    contentPlan: InboxV2OutboundDispatchContentPlan;
  }>
): Promise<PersistInboxV2OutboundProviderObservationResult> {
  const observation = inboxV2OutboundProviderObservationSchema.parse(
    input.observation
  );
  const contentPlan = inboxV2OutboundDispatchContentPlanSchema.parse(
    input.contentPlan
  );
  assertObservationContentPlan(observation, contentPlan);

  const inserted = await transaction.execute<{ id: unknown }>(
    buildInsertInboxV2OutboundProviderObservationSql({
      observation,
      contentPlan
    })
  );
  if (inserted.rows.length > 1) {
    throw invariantError(
      "Provider observation insert returned more than one row."
    );
  }
  if (inserted.rows.length === 1) return { kind: "committed" };

  const replay = await transaction.execute<ObservationReplayRow>(
    buildFindInboxV2OutboundProviderObservationReplaySql(observation)
  );
  if (replay.rows.length > 1) {
    throw invariantError(
      "Provider observation replay lookup returned multiple candidates."
    );
  }
  const row = replay.rows[0];
  return row !== undefined &&
    observationReplayMatches(row, observation, contentPlan)
    ? { kind: "already_exists" }
    : { kind: "conflict" };
}

export async function persistInboxV2OutboundProviderObservationSetInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    observations: readonly InboxV2OutboundProviderObservation[];
    contentPlan: InboxV2OutboundDispatchContentPlan;
  }>
): Promise<PersistInboxV2OutboundProviderObservationResult> {
  const observations = input.observations.map((observation) =>
    inboxV2OutboundProviderObservationSchema.parse(observation)
  );
  if (
    new Set(observations.map((observation) => observation.id)).size !==
    observations.length
  ) {
    return { kind: "conflict" };
  }
  let inserted = false;
  for (const observation of observations) {
    const result = await persistInboxV2OutboundProviderObservationInTransaction(
      transaction,
      { observation, contentPlan: input.contentPlan }
    );
    if (result.kind === "conflict") return result;
    inserted ||= result.kind === "committed";
  }
  return { kind: inserted ? "committed" : "already_exists" };
}

export function buildInsertInboxV2OutboundProviderObservationSql(input: {
  observation: InboxV2OutboundProviderObservation;
  contentPlan: InboxV2OutboundDispatchContentPlan;
}): SQL {
  const { observation, contentPlan } = input;
  const occurrence = observation.sourceOccurrence;
  const adapter = observation.route.adapterContract;
  const evidence = observation.evidence;
  const providerReferenceKindId =
    evidence.kind === "provider_echo_correlation"
      ? evidence.providerReferenceKindId
      : null;
  const correlationToken =
    evidence.kind === "provider_echo_correlation"
      ? evidence.correlationToken
      : null;
  return sql`
    insert into inbox_v2_outbound_provider_observations (
      tenant_id, id, artifact_id, dispatch_id, route_id, attempt_id,
      message_id, artifact_ordinal, artifact_state, effective_state,
      content_plan_id, content_plan_digest_sha256, planned_artifact_count,
      artifact_plan_id, artifact_plan_hash_sha256, external_thread_id,
      route_source_connection_id, route_source_account_id,
      route_source_thread_binding_id, route_binding_generation,
      source_connection_id, source_account_id, source_thread_binding_id,
      source_binding_generation, source_message_scope_kind,
      source_message_decision_strength, adapter_contract_id,
      adapter_contract_version, adapter_declaration_revision,
      adapter_surface_id, correlation_anchor_first_attempt_id,
      source_occurrence_id, source_occurrence_detail,
      source_occurrence_detail_digest_sha256, observation_detail,
      observation_detail_digest_sha256, evidence_kind,
      provider_reference_kind_id, correlation_token,
      counts_as_customer_inbound, creates_unread, creates_work_item,
      requires_provider_io, creates_outbound_dispatch, notification_eligible,
      observed_by_trusted_service_id, recorded_at, revision
    )
    select
      ${observation.tenantId}, ${observation.id}, ${observation.artifact.id},
      ${observation.dispatch.id}, ${observation.route.id},
      ${observation.attempt.id}, ${observation.dispatch.message.id},
      ${observation.artifact.ordinal}, ${observation.artifact.state},
      'accepted', plan_row.id, plan_row.plan_digest_sha256,
      plan_row.artifact_count, artifact_plan.id,
      artifact_plan.artifact_plan_hash_sha256,
      ${observation.route.externalThread.id},
      ${observation.route.sourceConnection.id},
      ${observation.route.sourceAccount.id},
      ${observation.route.sourceThreadBinding.id},
      ${BigInt(observation.route.bindingFence.bindingGeneration)},
      source_binding.source_connection_id,
      ${occurrence.bindingContext.sourceAccount.id},
      ${occurrence.bindingContext.sourceThreadBinding.id},
      ${BigInt(occurrence.bindingContext.bindingGeneration)},
      ${occurrence.messageIdentityDeclaration.scopeKind},
      ${occurrence.messageIdentityDeclaration.decisionStrength},
      ${adapter.contractId}, ${adapter.contractVersion},
      ${BigInt(adapter.declarationRevision)}, ${adapter.surfaceId},
      anchor.first_attempt_id, ${occurrence.id},
      ${JSON.stringify(occurrence)}::jsonb,
      ${observation.sourceOccurrenceDetailDigestSha256},
      ${JSON.stringify(observation)}::jsonb,
      ${calculateInboxV2OutboundProviderObservationDetailDigest(observation)},
      ${evidence.kind}, ${providerReferenceKindId}, ${correlationToken},
      ${observation.effectDisposition.countsAsCustomerInbound},
      ${observation.effectDisposition.createsUnread},
      ${observation.effectDisposition.createsWorkItem},
      ${observation.effectDisposition.requiresProviderIo},
      ${observation.effectDisposition.createsOutboundDispatch},
      ${observation.effectDisposition.notificationEligible},
      ${observation.observedByTrustedServiceId},
      ${toDate(observation.recordedAt)}, ${BigInt(observation.revision)}
      from inbox_v2_file_outbound_dispatch_plans plan_row
      join inbox_v2_file_outbound_artifact_plans artifact_plan
        on artifact_plan.tenant_id = plan_row.tenant_id
       and artifact_plan.content_plan_id = plan_row.id
       and artifact_plan.dispatch_id = plan_row.dispatch_id
       and artifact_plan.ordinal = ${observation.artifact.ordinal}
      join inbox_v2_source_thread_bindings source_binding
        on source_binding.tenant_id = ${observation.tenantId}
       and source_binding.id = ${occurrence.bindingContext.sourceThreadBinding.id}
       and source_binding.external_thread_id = ${occurrence.bindingContext.externalThread.id}
       and source_binding.source_account_id = ${occurrence.bindingContext.sourceAccount.id}
      left join inbox_v2_outbound_provider_correlation_anchors anchor
        on anchor.tenant_id = ${observation.tenantId}
       and anchor.adapter_contract_id = ${adapter.contractId}
       and anchor.adapter_contract_version = ${adapter.contractVersion}
       and anchor.adapter_declaration_revision =
         ${BigInt(adapter.declarationRevision)}
       and anchor.adapter_surface_id = ${adapter.surfaceId}
       and anchor.correlation_token = ${correlationToken}
       and anchor.dispatch_id = ${observation.dispatch.id}
       and anchor.route_id = ${observation.route.id}
       and anchor.message_id = ${observation.dispatch.message.id}
     where plan_row.tenant_id = ${observation.tenantId}
       and plan_row.id = ${contentPlan.id}
       and plan_row.dispatch_id = ${observation.dispatch.id}
       and plan_row.route_id = ${observation.route.id}
       and plan_row.message_id = ${observation.dispatch.message.id}
       and plan_row.plan_digest_sha256 = ${contentPlan.planDigestSha256}
       and (
         (${evidence.kind} = 'provider_response_attempt'
           and anchor.first_attempt_id is null)
         or (${evidence.kind} = 'provider_echo_correlation'
           and anchor.first_attempt_id is not null)
       )
    on conflict do nothing
    returning id
  `;
}

export function buildFindInboxV2OutboundProviderObservationReplaySql(
  observation: InboxV2OutboundProviderObservation
): SQL {
  return sql`
    select id, artifact_id, dispatch_id, route_id, attempt_id, message_id,
           artifact_ordinal, artifact_state, effective_state, content_plan_id,
           content_plan_digest_sha256, source_occurrence_id,
           source_occurrence_detail_digest_sha256,
           observation_detail_digest_sha256, evidence_kind,
           provider_reference_kind_id, correlation_token,
           observed_by_trusted_service_id, recorded_at, revision
      from inbox_v2_outbound_provider_observations
     where tenant_id = ${observation.tenantId}
       and (
         id = ${observation.id}
         or (
           artifact_id = ${observation.artifact.id}
           and source_occurrence_id = ${observation.sourceOccurrence.id}
           and evidence_kind = ${observation.evidence.kind}
           and source_occurrence_detail_digest_sha256 =
             ${observation.sourceOccurrenceDetailDigestSha256}
         )
       )
     order by case when id = ${observation.id} then 0 else 1 end
     limit 2
     for share
  `;
}

export function buildReadInboxV2OutboundProviderObservationSql(input: {
  tenantId: string;
  observationId: string;
  lock: boolean;
}): SQL {
  const lockClause = input.lock ? sql`for update` : sql`for share`;
  return sql`
    select observation_detail, observation_detail_digest_sha256
      from inbox_v2_outbound_provider_observations
     where tenant_id = ${input.tenantId}
       and id = ${input.observationId}
     ${lockClause}
  `;
}

/** Exact immutable snapshot read for the deferred settlement planner. */
export async function readInboxV2OutboundProviderObservationInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{ tenantId: string; observationId: string }>,
  options: Readonly<{ lock?: boolean }> = {}
): Promise<InboxV2OutboundProviderObservation | null> {
  const result = await transaction.execute<ObservationDetailRow>(
    buildReadInboxV2OutboundProviderObservationSql({
      tenantId: input.tenantId,
      observationId: input.observationId,
      lock: options.lock ?? false
    })
  );
  if (result.rows.length > 1) {
    throw invariantError(
      "Provider observation snapshot lookup returned multiple rows."
    );
  }
  const row = result.rows[0];
  if (row === undefined) return null;
  const observation = inboxV2OutboundProviderObservationSchema.parse(
    row.observation_detail
  );
  const expectedDigest =
    calculateInboxV2OutboundProviderObservationDetailDigest(observation);
  if (
    observation.tenantId !== input.tenantId ||
    observation.id !== input.observationId ||
    String(row.observation_detail_digest_sha256) !== expectedDigest
  ) {
    throw invariantError("Provider observation snapshot digest mismatch.");
  }
  return observation;
}

function assertObservationContentPlan(
  observation: InboxV2OutboundProviderObservation,
  contentPlan: InboxV2OutboundDispatchContentPlan
): void {
  if (
    observation.tenantId !== contentPlan.tenantId ||
    observation.dispatch.id !== contentPlan.dispatch.id ||
    observation.dispatch.message.id !== contentPlan.message.id ||
    observation.route.id !== contentPlan.route.id ||
    observation.route.sourceThreadBinding.id !== contentPlan.binding.id ||
    observation.route.adapterContract.contractId !==
      contentPlan.adapterContract.contractId ||
    observation.route.adapterContract.contractVersion !==
      contentPlan.adapterContract.contractVersion ||
    observation.route.adapterContract.declarationRevision !==
      contentPlan.adapterContract.declarationRevision ||
    observation.route.adapterContract.surfaceId !==
      contentPlan.adapterContract.surfaceId ||
    !contentPlan.artifacts.some(
      (artifact) => artifact.ordinal === observation.artifact.ordinal
    )
  ) {
    throw new TypeError(
      "Provider observation must belong to the exact immutable outbound content plan."
    );
  }
}

function observationReplayMatches(
  row: ObservationReplayRow,
  observation: InboxV2OutboundProviderObservation,
  contentPlan: InboxV2OutboundDispatchContentPlan
): boolean {
  const evidence = observation.evidence;
  return (
    String(row.id) === String(observation.id) &&
    String(row.artifact_id) === String(observation.artifact.id) &&
    String(row.dispatch_id) === String(observation.dispatch.id) &&
    String(row.route_id) === String(observation.route.id) &&
    String(row.attempt_id) === String(observation.attempt.id) &&
    String(row.message_id) === String(observation.dispatch.message.id) &&
    Number(row.artifact_ordinal) === observation.artifact.ordinal &&
    String(row.artifact_state) === observation.artifact.state &&
    String(row.effective_state) === "accepted" &&
    String(row.content_plan_id) === String(contentPlan.id) &&
    String(row.content_plan_digest_sha256) ===
      String(contentPlan.planDigestSha256) &&
    String(row.source_occurrence_id) ===
      String(observation.sourceOccurrence.id) &&
    String(row.source_occurrence_detail_digest_sha256) ===
      String(observation.sourceOccurrenceDetailDigestSha256) &&
    String(row.observation_detail_digest_sha256) ===
      calculateInboxV2OutboundProviderObservationDetailDigest(observation) &&
    String(row.evidence_kind) === evidence.kind &&
    nullableString(row.provider_reference_kind_id) ===
      (evidence.kind === "provider_echo_correlation"
        ? String(evidence.providerReferenceKindId)
        : null) &&
    nullableString(row.correlation_token) ===
      (evidence.kind === "provider_echo_correlation"
        ? String(evidence.correlationToken)
        : null) &&
    String(row.observed_by_trusted_service_id) ===
      String(observation.observedByTrustedServiceId) &&
    sameTimestamp(row.recorded_at, observation.recordedAt) &&
    BigInt(String(row.revision)) === BigInt(observation.revision)
  );
}

function correlationAnchorMatches(
  row: CorrelationAnchorRow,
  commit: OpenAttemptCommit
): boolean {
  const route = commit.routeSnapshot;
  const adapter = route.adapterContract;
  const retrySafety = commit.attempt.retrySafety;
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at
      : new Date(String(row.created_at));
  return (
    String(row.adapter_contract_id) === String(adapter.contractId) &&
    String(row.adapter_contract_version) === String(adapter.contractVersion) &&
    BigInt(String(row.adapter_declaration_revision)) ===
      BigInt(adapter.declarationRevision) &&
    String(row.adapter_surface_id) === String(adapter.surfaceId) &&
    String(row.correlation_token) ===
      String(retrySafety.providerCorrelationToken) &&
    String(row.dispatch_id) === String(commit.dispatchBefore.id) &&
    String(row.route_id) === String(route.id) &&
    String(row.message_id) === String(commit.dispatchBefore.message.id) &&
    String(row.external_thread_id) === String(route.externalThread.id) &&
    String(row.source_connection_id) === String(route.sourceConnection.id) &&
    String(row.source_account_id) === String(route.sourceAccount.id) &&
    String(row.source_thread_binding_id) ===
      String(route.sourceThreadBinding.id) &&
    BigInt(String(row.binding_generation)) ===
      BigInt(route.bindingFence.bindingGeneration) &&
    String(row.retry_safety_mechanism) === retrySafety.mechanism &&
    String(row.declared_by_trusted_service_id) ===
      String(retrySafety.declaredByTrustedServiceId) &&
    Number.isFinite(createdAt.getTime()) &&
    createdAt.getTime() <= Date.parse(commit.attempt.openedAt) &&
    BigInt(String(row.revision)) === 1n &&
    (commit.attempt.attemptNumber > 1 ||
      String(row.first_attempt_id) === String(commit.attempt.id))
  );
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function sameTimestamp(value: unknown, expected: string): boolean {
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === expected;
}

function toDate(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError("Provider observation timestamp is invalid.");
  }
  return parsed;
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
