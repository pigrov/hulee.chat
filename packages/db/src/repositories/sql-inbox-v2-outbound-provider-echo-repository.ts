import {
  INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
  deriveInboxV2OutboundDispatchArtifactId,
  deriveInboxV2OutboundProviderObservationId,
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundProviderObservationSchema,
  inboxV2OutboundRouteSchema,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchArtifact,
  type InboxV2OutboundDispatchAttempt,
  type InboxV2OutboundDispatchContentPlan,
  type InboxV2OutboundProviderObservation,
  type InboxV2OutboundRoute,
  type InboxV2SourceMessageExactOutboundCorrelation,
  type InboxV2SourceMessageReconciliationPlan,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import { loadInboxV2OutboundDispatchContentPlan } from "./sql-inbox-v2-file-object-repository";
import { persistInboxV2OutboundProviderObservationInTransaction } from "./sql-inbox-v2-outbound-provider-observation-repository";
import { enqueueInboxV2OutboundProviderSettlementWorkInTransaction } from "./sql-inbox-v2-outbound-provider-settlement-work-repository";
import {
  buildInsertInboxV2OutboundDispatchArtifactSql,
  lockAndValidateInboxV2OutboundDispatchAttemptInTransaction
} from "./sql-inbox-v2-outbound-transport-repository";
import type { InboxV2SourceMessageReconciliationCallbacks } from "./sql-inbox-v2-source-message-reconciliation-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

type EchoPlan = InboxV2SourceMessageReconciliationPlan &
  Readonly<{
    intent: Extract<
      InboxV2SourceMessageReconciliationPlan["intent"],
      { kind: "echo_handoff" }
    >;
  }>;

type ProviderEchoCallback = NonNullable<
  InboxV2SourceMessageReconciliationCallbacks["resolveProviderEcho"]
>;

export type InboxV2OutboundProviderEchoTarget = Readonly<{
  dispatch: InboxV2OutboundDispatch;
  route: InboxV2OutboundRoute;
  attempt: InboxV2OutboundDispatchAttempt;
  artifact: InboxV2OutboundDispatchArtifact | null;
  contentPlan: InboxV2OutboundDispatchContentPlan;
}>;

export type InboxV2OutboundProviderEchoObservationMaterializer = Readonly<{
  materializeProviderEcho(
    input: Readonly<{
      dispatch: InboxV2OutboundDispatch;
      route: InboxV2OutboundRoute;
      attempt: InboxV2OutboundDispatchAttempt;
      artifact: InboxV2OutboundDispatchArtifact;
      sourceOccurrence: InboxV2SourceOccurrence;
      exactCorrelation: InboxV2SourceMessageExactOutboundCorrelation;
      recordedAt: string;
    }>
  ): InboxV2OutboundProviderObservation;
}>;

type EnsureArtifactResult = Readonly<{
  kind: "committed" | "already_exists" | "conflict";
}>;

type PersistObservationResult = Readonly<{
  kind: "committed" | "already_exists" | "conflict";
}>;

type EnqueueSettlementWorkResult = Readonly<{
  kind: "committed" | "already_exists" | "conflict";
}>;

export type InboxV2OutboundProviderEchoDependencies = Readonly<{
  loadExactCorrelationTarget(
    transaction: RawSqlExecutor,
    input: Readonly<{
      plan: EchoPlan;
      exactCorrelation: InboxV2SourceMessageExactOutboundCorrelation;
    }>
  ): Promise<InboxV2OutboundProviderEchoTarget | null>;
  ensureArtifact(
    transaction: RawSqlExecutor,
    artifact: InboxV2OutboundDispatchArtifact
  ): Promise<EnsureArtifactResult>;
  persistObservation(
    transaction: RawSqlExecutor,
    input: Readonly<{
      observation: InboxV2OutboundProviderObservation;
      contentPlan: InboxV2OutboundDispatchContentPlan;
    }>
  ): Promise<PersistObservationResult>;
  enqueueSettlementWork(
    transaction: RawSqlExecutor,
    input: Readonly<{
      observation: InboxV2OutboundProviderObservation;
      candidateExternalMessageReferenceId: string;
      candidateTransportLinkId: string;
    }>
  ): Promise<EnqueueSettlementWorkResult>;
}>;

export type CreateSqlInboxV2OutboundProviderEchoCallbacksOptions = Readonly<{
  observationMaterializer: InboxV2OutboundProviderEchoObservationMaterializer;
}>;

const CALLBACK_CONFLICT =
  "source.message_reconciliation.callback_conflict" as const;

const defaultDependencies: InboxV2OutboundProviderEchoDependencies = {
  loadExactCorrelationTarget: loadExactCorrelationTargetInTransaction,
  ensureArtifact: ensureArtifactInTransaction,
  persistObservation(
    transaction: RawSqlExecutor,
    input: Readonly<{
      observation: InboxV2OutboundProviderObservation;
      contentPlan: InboxV2OutboundDispatchContentPlan;
    }>
  ) {
    return persistInboxV2OutboundProviderObservationInTransaction(
      transaction,
      input
    );
  },
  enqueueSettlementWork(
    transaction: RawSqlExecutor,
    input: Readonly<{
      observation: InboxV2OutboundProviderObservation;
      candidateExternalMessageReferenceId: string;
      candidateTransportLinkId: string;
    }>
  ) {
    return enqueueInboxV2OutboundProviderSettlementWorkInTransaction(
      transaction,
      input
    );
  }
};

/**
 * Production SRC-006 exact-echo bridge. It performs no provider I/O and never
 * selects a Message from body/sender/time similarity. A durable pre-I/O
 * correlation anchor may append one immutable provider observation, after
 * which the occurrence deliberately remains pending for the separately
 * authorized atomic settlement/stream-head closure.
 */
export function createSqlInboxV2OutboundProviderEchoCallbacks(
  options: CreateSqlInboxV2OutboundProviderEchoCallbacksOptions
): Pick<InboxV2SourceMessageReconciliationCallbacks, "resolveProviderEcho"> {
  return createCallbacks(options, defaultDependencies);
}

/** Direct-module test seam; intentionally absent from the @hulee/db root. */
export function createTestOnlySqlInboxV2OutboundProviderEchoCallbacks(
  options: CreateSqlInboxV2OutboundProviderEchoCallbacksOptions &
    Readonly<{ dependencies: InboxV2OutboundProviderEchoDependencies }>
): Pick<InboxV2SourceMessageReconciliationCallbacks, "resolveProviderEcho"> {
  return createCallbacks(options, options.dependencies);
}

function createCallbacks(
  options: CreateSqlInboxV2OutboundProviderEchoCallbacksOptions,
  dependencies: InboxV2OutboundProviderEchoDependencies
): Pick<InboxV2SourceMessageReconciliationCallbacks, "resolveProviderEcho"> {
  if (
    options.observationMaterializer === null ||
    typeof options.observationMaterializer !== "object" ||
    typeof options.observationMaterializer.materializeProviderEcho !==
      "function"
  ) {
    throw new TypeError(
      "Provider echo callbacks require a trusted observation materializer."
    );
  }
  const resolveProviderEcho: ProviderEchoCallback = async (
    transaction,
    input
  ) => {
    const plan = input.plan;
    const exactCorrelation = plan.intent.exactOutboundCorrelation;
    if (
      exactCorrelation === null ||
      !sourceOccurrenceCarriesExactCorrelation(
        plan.sourceOccurrence,
        exactCorrelation
      )
    ) {
      return { kind: "pending" };
    }

    const target = await dependencies.loadExactCorrelationTarget(transaction, {
      plan,
      exactCorrelation
    });
    const normalized = normalizeExactTarget(plan, exactCorrelation, target);
    if (normalized === null) return { kind: "pending" };

    let observation: InboxV2OutboundProviderObservation;
    try {
      observation = inboxV2OutboundProviderObservationSchema.parse(
        options.observationMaterializer.materializeProviderEcho({
          dispatch: normalized.dispatch,
          route: normalized.route,
          attempt: normalized.attempt,
          artifact: normalized.artifact,
          sourceOccurrence: plan.sourceOccurrence,
          exactCorrelation,
          recordedAt: plan.sourceOccurrence.recordedAt
        })
      );
    } catch {
      return { kind: "conflict", code: CALLBACK_CONFLICT };
    }
    if (
      !observationMatchesExactTarget(
        observation,
        normalized,
        plan.sourceOccurrence,
        exactCorrelation
      )
    ) {
      return { kind: "conflict", code: CALLBACK_CONFLICT };
    }

    const artifactResult = await dependencies.ensureArtifact(
      transaction,
      normalized.artifact
    );
    if (artifactResult.kind === "conflict") {
      return { kind: "conflict", code: CALLBACK_CONFLICT };
    }
    const observationResult = await dependencies.persistObservation(
      transaction,
      { observation, contentPlan: normalized.contentPlan }
    );
    if (observationResult.kind === "conflict") {
      if (artifactResult.kind === "committed") {
        throw invariantError(
          "Provider echo observation conflicted after its artifact was inserted; the ambient reconciliation transaction must roll back."
        );
      }
      return { kind: "conflict", code: CALLBACK_CONFLICT };
    }

    const settlementWorkResult = await dependencies.enqueueSettlementWork(
      transaction,
      {
        observation,
        candidateExternalMessageReferenceId:
          plan.candidateExternalMessageReferenceId,
        candidateTransportLinkId: plan.intent.candidateTransportLinkId
      }
    );
    if (settlementWorkResult.kind === "conflict") {
      if (
        artifactResult.kind === "committed" ||
        observationResult.kind === "committed"
      ) {
        throw invariantError(
          "Provider echo settlement work conflicted after durable writes; the ambient reconciliation transaction must roll back."
        );
      }
      return { kind: "conflict", code: CALLBACK_CONFLICT };
    }

    return { kind: "pending" };
  };

  return Object.freeze({ resolveProviderEcho });
}

export type FindInboxV2OutboundProviderEchoTargetSqlInput = Readonly<{
  tenantId: string;
  adapterContract: InboxV2OutboundRoute["adapterContract"];
  externalThreadId: string;
  correlationToken: string;
  artifactOrdinal: number;
}>;

/** Exact anchor lookup only; content, timestamps and display sender are absent. */
export function buildFindInboxV2OutboundProviderEchoTargetSql(
  input: FindInboxV2OutboundProviderEchoTargetSqlInput
): SQL {
  const adapter = input.adapterContract;
  return sql`
    select to_jsonb(anchor_row) as anchor_detail,
           to_jsonb(route_row) as route_detail,
           to_jsonb(dispatch_row) as dispatch_detail,
           to_jsonb(attempt_row) as attempt_detail,
           case when artifact_row.id is null then null
             else to_jsonb(artifact_row) end as artifact_detail
      from inbox_v2_outbound_provider_correlation_anchors anchor_row
      join inbox_v2_outbound_routes route_row
        on route_row.tenant_id = anchor_row.tenant_id
       and route_row.id = anchor_row.route_id
      join inbox_v2_outbound_dispatches dispatch_row
        on dispatch_row.tenant_id = anchor_row.tenant_id
       and dispatch_row.id = anchor_row.dispatch_id
       and dispatch_row.route_id = anchor_row.route_id
       and dispatch_row.message_id = anchor_row.message_id
      join inbox_v2_outbound_dispatch_attempts attempt_row
        on attempt_row.tenant_id = dispatch_row.tenant_id
       and attempt_row.id = case
         when dispatch_row.state = 'attempting'
           then dispatch_row.active_attempt_id
         else dispatch_row.last_attempt_id
       end
       and attempt_row.dispatch_id = dispatch_row.id
       and attempt_row.route_id = dispatch_row.route_id
       and attempt_row.message_id = dispatch_row.message_id
      left join inbox_v2_outbound_dispatch_artifacts artifact_row
        on artifact_row.tenant_id = attempt_row.tenant_id
       and artifact_row.dispatch_id = attempt_row.dispatch_id
       and artifact_row.attempt_id = attempt_row.id
       and artifact_row.ordinal = ${input.artifactOrdinal}
     where anchor_row.tenant_id = ${input.tenantId}
       and anchor_row.adapter_contract_id = ${adapter.contractId}
       and anchor_row.adapter_contract_version = ${adapter.contractVersion}
       and anchor_row.adapter_declaration_revision =
         ${BigInt(adapter.declarationRevision)}
       and anchor_row.adapter_surface_id = ${adapter.surfaceId}
       and anchor_row.correlation_token = ${input.correlationToken}
       and anchor_row.external_thread_id = ${input.externalThreadId}
       and attempt_row.provider_correlation_token = ${input.correlationToken}
       and dispatch_row.state in ('attempting', 'accepted', 'outcome_unknown')
       and attempt_row.outcome_kind in ('pending', 'accepted', 'outcome_unknown')
     limit 1
  `;
}

type ProviderEchoTargetRow = Readonly<{
  anchor_detail: unknown;
  route_detail: unknown;
  dispatch_detail: unknown;
  attempt_detail: unknown;
  artifact_detail: unknown;
}>;

type CurrentProviderSettlementTransportRow = Readonly<{
  dispatch_detail: unknown;
  attempt_detail: unknown;
}>;

export type InboxV2OutboundProviderCurrentTransportState = Readonly<{
  dispatch: InboxV2OutboundDispatch;
  attempt: InboxV2OutboundDispatchAttempt;
}>;

export function buildReadInboxV2OutboundProviderCurrentTransportStateSql(input: {
  tenantId: string;
  dispatchId: string;
  attemptId: string;
}): SQL {
  return sql`
    select to_jsonb(dispatch_row) as dispatch_detail,
           to_jsonb(attempt_row) as attempt_detail
      from inbox_v2_outbound_dispatches dispatch_row
      join inbox_v2_outbound_dispatch_attempts attempt_row
        on attempt_row.tenant_id = dispatch_row.tenant_id
       and attempt_row.dispatch_id = dispatch_row.id
       and attempt_row.route_id = dispatch_row.route_id
       and attempt_row.message_id = dispatch_row.message_id
       and attempt_row.id = ${input.attemptId}
     where dispatch_row.tenant_id = ${input.tenantId}
       and dispatch_row.id = ${input.dispatchId}
     for share of dispatch_row, attempt_row
  `;
}

export async function readInboxV2OutboundProviderCurrentTransportStateInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    tenantId: string;
    dispatchId: string;
    attemptId: string;
  }>
): Promise<InboxV2OutboundProviderCurrentTransportState | null> {
  const result =
    await transaction.execute<CurrentProviderSettlementTransportRow>(
      buildReadInboxV2OutboundProviderCurrentTransportStateSql(input)
    );
  if (result.rows.length > 1) {
    throw invariantError(
      "Provider settlement transport-state lookup returned multiple rows."
    );
  }
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        dispatch: mapDispatch(
          jsonRecord(row.dispatch_detail, "provider settlement dispatch")
        ),
        attempt: mapAttempt(
          jsonRecord(row.attempt_detail, "provider settlement attempt")
        )
      };
}

async function loadExactCorrelationTargetInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    plan: EchoPlan;
    exactCorrelation: InboxV2SourceMessageExactOutboundCorrelation;
  }>
): Promise<InboxV2OutboundProviderEchoTarget | null> {
  for (let readOrdinal = 0; readOrdinal < 2; readOrdinal += 1) {
    const target = await readAndLockExactCorrelationTargetSnapshot(
      transaction,
      input
    );
    if (target.kind === "matched") return target.target;
    if (target.kind === "missing" || readOrdinal === 1) return null;
    // A provider response may have committed after the unlocked exact-anchor
    // snapshot but before the canonical dispatch lock. The first helper call
    // now owns dispatch U, so one bounded re-read observes a stable current
    // head and cannot spin on transport drift.
  }
  return null;
}

type ExactCorrelationTargetSnapshotResult =
  | Readonly<{
      kind: "matched";
      target: InboxV2OutboundProviderEchoTarget;
    }>
  | Readonly<{ kind: "retry" | "missing" }>;

async function readAndLockExactCorrelationTargetSnapshot(
  transaction: RawSqlExecutor,
  input: Readonly<{
    plan: EchoPlan;
    exactCorrelation: InboxV2SourceMessageExactOutboundCorrelation;
  }>
): Promise<ExactCorrelationTargetSnapshotResult> {
  const occurrence = input.plan.sourceOccurrence;
  const adapter = occurrence.messageIdentityDeclaration.adapterContract;
  const result = await transaction.execute<ProviderEchoTargetRow>(
    buildFindInboxV2OutboundProviderEchoTargetSql({
      tenantId: occurrence.tenantId,
      adapterContract: adapter,
      externalThreadId: occurrence.messageKey.externalThread.id,
      correlationToken: input.exactCorrelation.correlationToken,
      artifactOrdinal: input.exactCorrelation.artifactOrdinal
    })
  );
  if (result.rows.length > 1) {
    throw invariantError("Provider echo anchor lookup returned multiple rows.");
  }
  const row = result.rows[0];
  if (row === undefined) return { kind: "missing" };
  const anchor = jsonRecord(row.anchor_detail, "provider echo anchor");
  const route = mapRoute(jsonRecord(row.route_detail, "provider echo route"));
  const dispatch = mapDispatch(
    jsonRecord(row.dispatch_detail, "provider echo dispatch")
  );
  const attempt = mapAttempt(
    jsonRecord(row.attempt_detail, "provider echo attempt")
  );
  const transportLock =
    await lockAndValidateInboxV2OutboundDispatchAttemptInTransaction(
      transaction,
      { dispatch, attempt }
    );
  if (transportLock.kind === "dispatch_not_found") {
    return { kind: "missing" };
  }
  if (transportLock.kind !== "matched") return { kind: "retry" };
  const artifact =
    row.artifact_detail === null || row.artifact_detail === undefined
      ? null
      : mapArtifact(jsonRecord(row.artifact_detail, "provider echo artifact"));
  if (!anchorMatchesTarget(anchor, route, dispatch, attempt, input)) {
    return { kind: "missing" };
  }
  const contentPlan = await loadInboxV2OutboundDispatchContentPlan(
    transaction,
    { tenantId: dispatch.tenantId, dispatchId: dispatch.id }
  );
  return contentPlan === null
    ? { kind: "missing" }
    : {
        kind: "matched",
        target: { dispatch, route, attempt, artifact, contentPlan }
      };
}

function normalizeExactTarget(
  plan: EchoPlan,
  exactCorrelation: InboxV2SourceMessageExactOutboundCorrelation,
  input: InboxV2OutboundProviderEchoTarget | null
):
  | (InboxV2OutboundProviderEchoTarget &
      Readonly<{ artifact: InboxV2OutboundDispatchArtifact }>)
  | null {
  if (input === null) return null;
  let dispatch: InboxV2OutboundDispatch;
  let route: InboxV2OutboundRoute;
  let attempt: InboxV2OutboundDispatchAttempt;
  let contentPlan: InboxV2OutboundDispatchContentPlan;
  let persistedArtifact: InboxV2OutboundDispatchArtifact | null;
  try {
    dispatch = inboxV2OutboundDispatchSchema.parse(input.dispatch);
    route = inboxV2OutboundRouteSchema.parse(input.route);
    attempt = inboxV2OutboundDispatchAttemptSchema.parse(input.attempt);
    contentPlan = inboxV2OutboundDispatchContentPlanSchema.parse(
      input.contentPlan
    );
    persistedArtifact =
      input.artifact === null
        ? null
        : inboxV2OutboundDispatchArtifactSchema.parse(input.artifact);
  } catch {
    return null;
  }
  const occurrence = plan.sourceOccurrence;
  const expectedArtifactId = deriveInboxV2OutboundDispatchArtifactId({
    tenantId: dispatch.tenantId,
    dispatch: reference(dispatch, "outbound_dispatch"),
    route: reference(route, "outbound_route"),
    attempt: reference(attempt, "outbound_dispatch_attempt"),
    ordinal: exactCorrelation.artifactOrdinal
  });
  const sameAccountFence =
    sameReference(
      occurrence.bindingContext.sourceAccount,
      route.sourceAccount
    ) &&
    sameReference(
      occurrence.bindingContext.sourceThreadBinding,
      route.sourceThreadBinding
    ) &&
    occurrence.bindingContext.bindingGeneration ===
      route.bindingFence.bindingGeneration;
  const providerWideCrossAccount =
    occurrence.messageKey.scope.kind === "provider_thread" &&
    occurrence.messageIdentityDeclaration.scopeKind === "provider_thread" &&
    occurrence.messageIdentityDeclaration.decisionStrength ===
      "authoritative" &&
    occurrence.referencePortability.kind === "external_thread" &&
    occurrence.referencePortability.decisionStrength === "authoritative";
  const attemptReference = reference(attempt, "outbound_dispatch_attempt");
  const expectedHead =
    dispatch.state === "attempting"
      ? dispatch.activeAttempt
      : dispatch.lastAttempt;
  const plannedArtifact = contentPlan.artifacts.find(
    (artifact) => artifact.ordinal === exactCorrelation.artifactOrdinal
  );
  if (
    occurrence.tenantId !== route.tenantId ||
    occurrence.origin.kind !== "provider_echo" ||
    occurrence.direction !== "outbound" ||
    occurrence.providerActor !== null ||
    occurrence.resolution.state !== "pending" ||
    !sameReference(
      occurrence.messageKey.externalThread,
      route.externalThread
    ) ||
    !sameReference(
      occurrence.bindingContext.externalThread,
      route.externalThread
    ) ||
    (!sameAccountFence && !providerWideCrossAccount) ||
    !sameValue(
      occurrence.messageIdentityDeclaration.adapterContract,
      route.adapterContract
    ) ||
    !sameValue(occurrence.descriptor.adapterContract, route.adapterContract) ||
    !sameValue(attempt.retrySafety.adapterContract, route.adapterContract) ||
    attempt.retrySafety.mechanism === "unsafe_or_unknown" ||
    attempt.retrySafety.providerCorrelationToken !==
      exactCorrelation.correlationToken ||
    dispatch.tenantId !== route.tenantId ||
    attempt.tenantId !== route.tenantId ||
    !sameReference(dispatch.route, reference(route, "outbound_route")) ||
    !sameReference(
      attempt.dispatch,
      reference(dispatch, "outbound_dispatch")
    ) ||
    !sameReference(attempt.route, reference(route, "outbound_route")) ||
    !sameReference(expectedHead, attemptReference) ||
    dispatch.attemptCount !== attempt.attemptNumber ||
    plannedArtifact === undefined ||
    contentPlan.tenantId !== dispatch.tenantId ||
    !sameReference(
      contentPlan.dispatch,
      reference(dispatch, "outbound_dispatch")
    ) ||
    !sameReference(contentPlan.message, dispatch.message) ||
    !sameReference(contentPlan.route, reference(route, "outbound_route")) ||
    !sameReference(contentPlan.binding, route.sourceThreadBinding) ||
    !sameValue(contentPlan.adapterContract, route.adapterContract)
  ) {
    return null;
  }

  const artifact =
    persistedArtifact ??
    inboxV2OutboundDispatchArtifactSchema.parse({
      tenantId: dispatch.tenantId,
      id: expectedArtifactId,
      dispatch: reference(dispatch, "outbound_dispatch"),
      route: reference(route, "outbound_route"),
      attempt: attemptReference,
      ordinal: exactCorrelation.artifactOrdinal,
      state: "accepted",
      diagnostic: null,
      createdAt: attempt.openedAt,
      revision: "1"
    });
  if (
    artifact.id !== expectedArtifactId ||
    artifact.ordinal !== exactCorrelation.artifactOrdinal ||
    (artifact.state !== "accepted" && artifact.state !== "outcome_unknown") ||
    artifact.createdAt !== attempt.openedAt ||
    !sameReference(
      artifact.dispatch,
      reference(dispatch, "outbound_dispatch")
    ) ||
    !sameReference(artifact.route, reference(route, "outbound_route")) ||
    !sameReference(artifact.attempt, attemptReference)
  ) {
    return null;
  }
  return { dispatch, route, attempt, artifact, contentPlan };
}

function sourceOccurrenceCarriesExactCorrelation(
  occurrence: InboxV2SourceOccurrence,
  correlation: InboxV2SourceMessageExactOutboundCorrelation
): boolean {
  return (
    occurrence.origin.kind === "provider_echo" &&
    occurrence.direction === "outbound" &&
    occurrence.providerActor === null &&
    occurrence.descriptor.providerReferences.some(
      (providerReference) =>
        providerReference.kindId === correlation.providerReferenceKindId &&
        providerReference.subject === correlation.correlationToken
    )
  );
}

function observationMatchesExactTarget(
  observation: InboxV2OutboundProviderObservation,
  target: InboxV2OutboundProviderEchoTarget &
    Readonly<{ artifact: InboxV2OutboundDispatchArtifact }>,
  sourceOccurrence: InboxV2SourceOccurrence,
  exactCorrelation: InboxV2SourceMessageExactOutboundCorrelation
): boolean {
  const expectedId = deriveInboxV2OutboundProviderObservationId({
    tenantId: target.dispatch.tenantId,
    attempt: reference(target.attempt, "outbound_dispatch_attempt"),
    artifactOrdinal: target.artifact.ordinal,
    sourceOccurrence: reference(sourceOccurrence, "source_occurrence"),
    evidenceKind: "provider_echo_correlation"
  });
  return (
    observation.id === expectedId &&
    sameValue(observation.dispatch, target.dispatch) &&
    sameValue(observation.route, target.route) &&
    sameValue(observation.attempt, target.attempt) &&
    sameValue(observation.artifact, target.artifact) &&
    sameValue(observation.sourceOccurrence, sourceOccurrence) &&
    observation.evidence.kind === "provider_echo_correlation" &&
    observation.evidence.artifactOrdinal === exactCorrelation.artifactOrdinal &&
    observation.evidence.providerReferenceKindId ===
      exactCorrelation.providerReferenceKindId &&
    observation.evidence.correlationToken ===
      exactCorrelation.correlationToken &&
    sameValue(
      observation.effectDisposition,
      INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION
    ) &&
    observation.recordedAt === sourceOccurrence.recordedAt
  );
}

async function ensureArtifactInTransaction(
  transaction: RawSqlExecutor,
  input: InboxV2OutboundDispatchArtifact
): Promise<EnsureArtifactResult> {
  const artifact = inboxV2OutboundDispatchArtifactSchema.parse(input);
  const inserted = await transaction.execute<{ id: unknown }>(
    buildInsertInboxV2OutboundDispatchArtifactSql(artifact)
  );
  if (inserted.rows.length > 1) {
    throw invariantError(
      "Provider echo artifact insert returned multiple rows."
    );
  }
  if (inserted.rows.length === 1) return { kind: "committed" };
  const replay = await transaction.execute<ArtifactReplayRow>(sql`
    select id, dispatch_id, route_id, attempt_id, ordinal, state,
           diagnostic_code_id, diagnostic_retryable,
           diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
           created_at, revision
      from inbox_v2_outbound_dispatch_artifacts
     where tenant_id = ${artifact.tenantId}
       and (
         id = ${artifact.id}
         or (dispatch_id = ${artifact.dispatch.id}
           and attempt_id = ${artifact.attempt.id}
           and ordinal = ${artifact.ordinal})
       )
     order by case when id = ${artifact.id} then 0 else 1 end
     limit 2
     for share
  `);
  if (replay.rows.length > 1) return { kind: "conflict" };
  const row = replay.rows[0];
  return row !== undefined && artifactReplayMatches(row, artifact)
    ? { kind: "already_exists" }
    : { kind: "conflict" };
}

type ArtifactReplayRow = Readonly<{
  id: unknown;
  dispatch_id: unknown;
  route_id: unknown;
  attempt_id: unknown;
  ordinal: unknown;
  state: unknown;
  diagnostic_code_id: unknown;
  diagnostic_retryable: unknown;
  diagnostic_correlation_token: unknown;
  diagnostic_safe_operator_hint_id: unknown;
  created_at: unknown;
  revision: unknown;
}>;

function artifactReplayMatches(
  row: ArtifactReplayRow,
  artifact: InboxV2OutboundDispatchArtifact
): boolean {
  return (
    String(row.id) === artifact.id &&
    String(row.dispatch_id) === artifact.dispatch.id &&
    String(row.route_id) === artifact.route.id &&
    String(row.attempt_id) === artifact.attempt.id &&
    Number(row.ordinal) === artifact.ordinal &&
    String(row.state) === artifact.state &&
    nullableString(row.diagnostic_code_id) ===
      (artifact.diagnostic?.codeId ?? null) &&
    nullableBoolean(row.diagnostic_retryable) ===
      (artifact.diagnostic?.retryable ?? null) &&
    nullableString(row.diagnostic_correlation_token) ===
      (artifact.diagnostic?.correlationToken ?? null) &&
    nullableString(row.diagnostic_safe_operator_hint_id) ===
      (artifact.diagnostic?.safeOperatorHintId ?? null) &&
    timestamp(row.created_at, "artifact created_at") === artifact.createdAt &&
    String(row.revision) === artifact.revision
  );
}

function anchorMatchesTarget(
  anchor: Record<string, unknown>,
  route: InboxV2OutboundRoute,
  dispatch: InboxV2OutboundDispatch,
  attempt: InboxV2OutboundDispatchAttempt,
  input: Readonly<{
    plan: EchoPlan;
    exactCorrelation: InboxV2SourceMessageExactOutboundCorrelation;
  }>
): boolean {
  const adapter = route.adapterContract;
  return (
    String(anchor.tenant_id) === route.tenantId &&
    String(anchor.adapter_contract_id) === adapter.contractId &&
    String(anchor.adapter_contract_version) === adapter.contractVersion &&
    String(anchor.adapter_declaration_revision) ===
      adapter.declarationRevision &&
    String(anchor.adapter_surface_id) === adapter.surfaceId &&
    String(anchor.correlation_token) ===
      input.exactCorrelation.correlationToken &&
    String(anchor.dispatch_id) === dispatch.id &&
    String(anchor.route_id) === route.id &&
    String(anchor.message_id) === dispatch.message.id &&
    String(anchor.external_thread_id) === route.externalThread.id &&
    String(anchor.source_connection_id) === route.sourceConnection.id &&
    String(anchor.source_account_id) === route.sourceAccount.id &&
    String(anchor.source_thread_binding_id) === route.sourceThreadBinding.id &&
    String(anchor.binding_generation) ===
      route.bindingFence.bindingGeneration &&
    String(anchor.retry_safety_mechanism) === attempt.retrySafety.mechanism &&
    String(anchor.declared_by_trusted_service_id) ===
      attempt.retrySafety.declaredByTrustedServiceId &&
    String(anchor.revision) === "1" &&
    sameValue(
      input.plan.sourceOccurrence.messageIdentityDeclaration.adapterContract,
      adapter
    )
  );
}

function mapRoute(row: Record<string, unknown>): InboxV2OutboundRoute {
  const tenantId = String(row.tenant_id);
  const ref = referenceFactory(tenantId);
  return inboxV2OutboundRouteSchema.parse({
    tenantId,
    id: String(row.id),
    principal:
      String(row.principal_kind) === "employee"
        ? {
            kind: "employee",
            employee: ref("employee", row.principal_employee_id)
          }
        : {
            kind: "trusted_service",
            trustedServiceId: String(row.principal_trusted_service_id)
          },
    conversation: ref("conversation", row.conversation_id),
    externalThread: ref("external_thread", row.external_thread_id),
    sourceThreadBinding: ref(
      "source_thread_binding",
      row.source_thread_binding_id
    ),
    sourceAccount: ref("source_account", row.source_account_id),
    sourceConnection: ref("source_connection", row.source_connection_id),
    operationId: String(row.operation_id),
    contentKindId:
      row.content_kind_id === null || row.content_kind_id === undefined
        ? null
        : String(row.content_kind_id),
    authorizationEpoch: String(row.authorization_epoch),
    requiredConversationPermissionId: String(
      row.required_conversation_permission_id
    ),
    bindingFence: {
      accountGeneration: String(row.account_generation),
      bindingGeneration: String(row.binding_generation),
      remoteAccessRevision: String(row.remote_access_revision),
      administrativeRevision: String(row.administrative_revision),
      capabilityRevision: String(row.capability_revision),
      routeDescriptorRevision: String(row.route_descriptor_revision)
    },
    adapterContract: row.adapter_contract_snapshot,
    routeDescriptor: row.route_descriptor_snapshot,
    routePolicy: ref("thread_route_policy", row.route_policy_id),
    routePolicyRevision: String(row.route_policy_revision),
    conversationAuthorization: row.conversation_authorization_snapshot,
    sourceAccountAuthorization: row.source_account_authorization_snapshot,
    referenceContext: row.reference_context_snapshot,
    runtimeObservationAtResolution: row.runtime_observation_snapshot,
    selection: {
      intent: row.selection_intent_snapshot,
      reason: String(row.selection_reason),
      candidateSnapshotToken: String(row.candidate_snapshot_token),
      candidateSnapshotNotAfter: timestamp(
        row.candidate_snapshot_not_after,
        "route candidate_snapshot_not_after"
      ),
      fallbackPolicyOrdinal:
        row.fallback_policy_ordinal === null ||
        row.fallback_policy_ordinal === undefined
          ? null
          : Number(row.fallback_policy_ordinal),
      selectedAt: timestamp(row.selected_at, "route selected_at")
    },
    mutationToken: String(row.mutation_token),
    idempotencyToken: String(row.idempotency_token),
    correlationToken: String(row.correlation_token),
    revision: String(row.revision),
    createdAt: timestamp(row.created_at, "route created_at")
  });
}

function mapDispatch(row: Record<string, unknown>): InboxV2OutboundDispatch {
  const tenantId = String(row.tenant_id);
  const ref = referenceFactory(tenantId);
  return inboxV2OutboundDispatchSchema.parse({
    tenantId,
    id: String(row.id),
    message: ref("message", row.message_id),
    route: ref("outbound_route", row.route_id),
    multiSendOperation:
      row.multi_send_operation_id === null ||
      row.multi_send_operation_id === undefined
        ? null
        : ref("outbound_multi_send_operation", row.multi_send_operation_id),
    state: String(row.state),
    attemptCount: Number(row.attempt_count),
    activeAttempt:
      row.active_attempt_id === null || row.active_attempt_id === undefined
        ? null
        : ref("outbound_dispatch_attempt", row.active_attempt_id),
    lastAttempt:
      row.last_attempt_id === null || row.last_attempt_id === undefined
        ? null
        : ref("outbound_dispatch_attempt", row.last_attempt_id),
    retryAuthorization:
      row.retry_authorization_decision_id === null ||
      row.retry_authorization_decision_id === undefined
        ? null
        : ref(
            "outbound_dispatch_reconciliation_decision",
            row.retry_authorization_decision_id
          ),
    revision: String(row.revision),
    createdAt: timestamp(row.created_at, "dispatch created_at"),
    updatedAt: timestamp(row.updated_at, "dispatch updated_at")
  });
}

function mapAttempt(
  row: Record<string, unknown>
): InboxV2OutboundDispatchAttempt {
  const tenantId = String(row.tenant_id);
  const ref = referenceFactory(tenantId);
  const outcomeKind = String(row.outcome_kind);
  const diagnostic =
    outcomeKind === "retryable_failure" ||
    outcomeKind === "terminal_failure" ||
    outcomeKind === "outcome_unknown"
      ? {
          codeId: String(row.diagnostic_code_id),
          retryable: Boolean(row.diagnostic_retryable),
          correlationToken: String(row.diagnostic_correlation_token),
          safeOperatorHintId:
            row.diagnostic_safe_operator_hint_id === null ||
            row.diagnostic_safe_operator_hint_id === undefined
              ? null
              : String(row.diagnostic_safe_operator_hint_id)
        }
      : null;
  const outcome =
    outcomeKind === "pending"
      ? { kind: "pending" }
      : outcomeKind === "accepted"
        ? {
            kind: "accepted",
            completedAt: timestamp(row.completed_at, "attempt completed_at"),
            providerAcknowledgementToken:
              row.provider_acknowledgement_token === null ||
              row.provider_acknowledgement_token === undefined
                ? null
                : String(row.provider_acknowledgement_token)
          }
        : outcomeKind === "retryable_failure"
          ? {
              kind: "retryable_failure",
              completedAt: timestamp(row.completed_at, "attempt completed_at"),
              retryAt: timestamp(row.retry_at, "attempt retry_at"),
              diagnostic
            }
          : outcomeKind === "terminal_failure"
            ? {
                kind: "terminal_failure",
                completedAt: timestamp(
                  row.completed_at,
                  "attempt completed_at"
                ),
                diagnostic
              }
            : {
                kind: "outcome_unknown",
                completedAt: timestamp(
                  row.completed_at,
                  "attempt completed_at"
                ),
                diagnostic,
                requiredAction: String(row.unknown_required_action)
              };
  return inboxV2OutboundDispatchAttemptSchema.parse({
    tenantId,
    id: String(row.id),
    dispatch: ref("outbound_dispatch", row.dispatch_id),
    route: ref("outbound_route", row.route_id),
    attemptNumber: Number(row.attempt_number),
    claimToken: String(row.claim_token),
    retrySafety: {
      adapterContract: row.retry_safety_adapter_contract_snapshot,
      declaredByTrustedServiceId: String(
        row.retry_safety_declared_by_trusted_service_id
      ),
      declarationToken: String(row.retry_safety_declaration_token),
      declaredAt: timestamp(
        row.retry_safety_declared_at,
        "attempt retry_safety_declared_at"
      ),
      mechanism: String(row.retry_safety_mechanism),
      providerCorrelationToken:
        row.provider_correlation_token === null ||
        row.provider_correlation_token === undefined
          ? null
          : String(row.provider_correlation_token),
      automaticRetryAllowed: Boolean(row.automatic_retry_allowed)
    },
    leaseExpiresAt: timestamp(row.lease_expires_at, "attempt lease_expires_at"),
    openedAt: timestamp(row.opened_at, "attempt opened_at"),
    outcome,
    completionSource:
      row.completion_source === null || row.completion_source === undefined
        ? null
        : String(row.completion_source),
    revision: String(row.revision)
  });
}

function mapArtifact(
  row: Record<string, unknown>
): InboxV2OutboundDispatchArtifact {
  const tenantId = String(row.tenant_id);
  const ref = referenceFactory(tenantId);
  const state = String(row.state);
  return inboxV2OutboundDispatchArtifactSchema.parse({
    tenantId,
    id: String(row.id),
    dispatch: ref("outbound_dispatch", row.dispatch_id),
    route: ref("outbound_route", row.route_id),
    attempt: ref("outbound_dispatch_attempt", row.attempt_id),
    ordinal: Number(row.ordinal),
    state,
    diagnostic:
      state === "accepted"
        ? null
        : {
            codeId: String(row.diagnostic_code_id),
            retryable: Boolean(row.diagnostic_retryable),
            correlationToken: String(row.diagnostic_correlation_token),
            safeOperatorHintId:
              row.diagnostic_safe_operator_hint_id === null ||
              row.diagnostic_safe_operator_hint_id === undefined
                ? null
                : String(row.diagnostic_safe_operator_hint_id)
          },
    createdAt: timestamp(row.created_at, "artifact created_at"),
    revision: String(row.revision)
  });
}

function reference<
  const TKind extends
    | "outbound_dispatch"
    | "outbound_route"
    | "outbound_dispatch_attempt"
    | "source_occurrence"
>(entity: Readonly<{ tenantId: string; id: string }>, kind: TKind) {
  return { tenantId: entity.tenantId, kind, id: entity.id } as const;
}

function referenceFactory(tenantId: string) {
  return <const TKind extends string>(kind: TKind, id: unknown) => ({
    tenantId,
    kind,
    id: String(id)
  });
}

function sameReference(
  left: Readonly<{ tenantId: string; kind: string; id: string }> | null,
  right: Readonly<{ tenantId: string; kind: string; id: string }> | null
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.tenantId === right.tenantId &&
    left.kind === right.kind &&
    left.id === right.id
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function jsonRecord(value: unknown, field: string): Record<string, unknown> {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invariantError(`${field} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw invariantError(`${field} is not a finite timestamp.`);
  }
  return parsed.toISOString();
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableBoolean(value: unknown): boolean | null {
  return value === null || value === undefined ? null : Boolean(value);
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
