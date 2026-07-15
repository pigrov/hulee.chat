import { createHash } from "node:crypto";

import {
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
  INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
  INBOX_V2_TENANT_STREAM_SCHEMA_VERSION,
  decideInboxV2CommandIdempotency,
  inboxV2AtomicMutationCommitSchema,
  inboxV2AudienceImpactIdSchema,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2CatalogIdSchema,
  inboxV2CommandIdSchema,
  inboxV2CorrelationIdSchema,
  inboxV2DomainEventSchema,
  inboxV2EntityKeySchema,
  inboxV2EntityRevisionSchema,
  inboxV2EventIdSchema,
  inboxV2OutboxIntentSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2SchemaVersionTokenSchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2TenantStreamChangeIdSchema,
  inboxV2TenantStreamChangeSchema,
  inboxV2TenantStreamCommitIdSchema,
  inboxV2TenantStreamCommitPositionSchema,
  inboxV2TenantStreamCommitReferenceSchema,
  inboxV2TenantIdSchema,
  type InboxV2AtomicMutationCommit,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2CommandIdempotencyRecord,
  type InboxV2DomainEvent,
  type InboxV2EntityKey,
  type InboxV2OutboxIntent,
  type InboxV2PayloadReference,
  type InboxV2TenantId
} from "@hulee/contracts";
import {
  evaluateInboxV2AuthorizationPlan,
  type InboxV2AuthorizationDecision,
  type InboxV2AuthorizationPlanInput
} from "@hulee/core";
import type { ZodType } from "zod";

/*
 * Test-only composition harness for contract and authorization scenarios.
 * It does not define production command semantics or prove database/provider
 * guarantees: every scenario supplies its server-owned transition explicitly.
 */
const SCENARIO_COMMAND_TYPE_ID = "module:hulee-testing:scenario-step" as const;
const SCENARIO_PAYLOAD_SCHEMA_ID =
  "module:hulee-testing:scenario-payload" as const;
const SCENARIO_DOMAIN_COMMIT_SCHEMA_ID =
  "module:hulee-testing:scenario-domain-commit" as const;

class InboxV2ScenarioConflict extends Error {
  constructor(readonly errorCode: string) {
    super(errorCode);
  }
}

type InboxV2ScenarioRecordMetadata = Readonly<{
  entity: InboxV2EntityKey;
  revision: string;
  schemaId: string;
  schemaVersion: string;
}>;

export type InboxV2ScenarioRecord = InboxV2ScenarioRecordMetadata &
  (
    | Readonly<{ state: "upsert"; value: unknown }>
    | Readonly<{ state: "tombstone"; value: null }>
  );

export type InboxV2ScenarioWorld = Readonly<{
  tenantId: InboxV2TenantId;
  streamEpoch: string;
  streamPosition: string;
  records: readonly InboxV2ScenarioRecord[];
  commandRecords: readonly InboxV2CommandIdempotencyRecord[];
  commits: readonly InboxV2AtomicMutationCommit[];
  events: readonly InboxV2DomainEvent[];
  outboxIntents: readonly InboxV2OutboxIntent[];
}>;

export type InboxV2ScenarioSeedRecord<T = unknown> = Readonly<{
  entity: InboxV2EntityKey;
  revision: string;
  schemaId: string;
  schemaVersion?: string;
  schema: ZodType<T>;
  value: T;
}>;

type InboxV2ScenarioChangeBase = Readonly<{
  entity: InboxV2EntityKey;
  expectedRevision: string | null;
  resultingRevision: string;
  schemaId: string;
  schemaVersion?: string;
  audience:
    | "conversation_external"
    | "internal_participants"
    | "staff_only"
    | "workforce_metadata"
    | "policy_filtered";
  timeline?: Readonly<{
    conversation: Readonly<{
      tenantId: string;
      kind: "conversation";
      id: string;
    }>;
    timelineSequence: string;
  }> | null;
}>;

export type InboxV2ScenarioUpsertChange<T = unknown> =
  InboxV2ScenarioChangeBase &
    Readonly<{
      kind: "upsert";
      schema: ZodType<T>;
      value: T;
      reasonId?: never;
    }>;

type InboxV2ScenarioLegacyUpsertChange<T = unknown> =
  InboxV2ScenarioChangeBase &
    Readonly<{
      /** Compatibility shape for the scenario fixtures written before tombstones. */
      kind?: undefined;
      schema: ZodType<T>;
      value: T;
      reasonId?: never;
    }>;

export type InboxV2ScenarioTombstoneChange = InboxV2ScenarioChangeBase &
  Readonly<{
    kind: "tombstone";
    reasonId: string;
    schema?: never;
    value: null;
  }>;

export type InboxV2ScenarioChange<T = unknown> =
  | InboxV2ScenarioUpsertChange<T>
  | InboxV2ScenarioTombstoneChange
  | InboxV2ScenarioLegacyUpsertChange<T>;

export type InboxV2ScenarioOutboxEffect = Readonly<{
  typeId:
    | "core:projection.update"
    | "core:notification.evaluate"
    | "core:provider.dispatch"
    | "core:search.index"
    | "core:workflow.evaluate";
  handlerId: string;
  effectClass:
    | "projection"
    | "notification"
    | "provider_io"
    | "search"
    | "workflow";
  changeEntities?: readonly InboxV2EntityKey[];
  payloadFromEntity?: InboxV2EntityKey | null;
}>;

export type InboxV2ScenarioTransition =
  | Readonly<{
      kind: "commit";
      changes: readonly InboxV2ScenarioChange[];
      outboxEffects?: readonly InboxV2ScenarioOutboxEffect[];
      resultEntity?: InboxV2EntityKey | null;
    }>
  | Readonly<{
      kind: "reject";
      errorCode: string;
    }>;

export type InboxV2ScenarioTransitionContext = Readonly<{
  world: InboxV2ScenarioWorld;
  getRecord: (entity: InboxV2EntityKey) => InboxV2ScenarioRecord | null;
  requireRecord: (entity: InboxV2EntityKey) => InboxV2ScenarioRecord;
}>;

export type InboxV2ScenarioStep = Readonly<{
  id: string;
  commandId: string;
  requestId: string;
  clientMutationId: string;
  requestHash: string;
  correlationId?: string;
  committedAt: string;
  authorization: InboxV2AuthorizationPlanInput;
  transition: (
    context: InboxV2ScenarioTransitionContext
  ) => InboxV2ScenarioTransition;
}>;

export type InboxV2ScenarioStepResult =
  | Readonly<{
      outcome: "committed";
      world: InboxV2ScenarioWorld;
      authorization: Extract<
        InboxV2AuthorizationDecision,
        { outcome: "allowed" }
      >;
      commit: InboxV2AtomicMutationCommit;
    }>
  | Readonly<{
      outcome: "replayed";
      world: InboxV2ScenarioWorld;
      result: Extract<
        InboxV2CommandIdempotencyRecord["state"],
        { kind: "completed" }
      >["result"];
    }>
  | Readonly<{
      outcome: "rejected";
      world: InboxV2ScenarioWorld;
      authorization: Extract<
        InboxV2AuthorizationDecision,
        { outcome: "denied" }
      >;
    }>
  | Readonly<{
      outcome: "conflict";
      world: InboxV2ScenarioWorld;
      errorCode: string;
    }>;

export function createInboxV2ScenarioWorld(input: {
  tenantId: string;
  streamEpoch?: string;
  records?: readonly InboxV2ScenarioSeedRecord[];
}): InboxV2ScenarioWorld {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const records = (input.records ?? []).map((record) => {
    const entity = inboxV2EntityKeySchema.parse(record.entity);
    assertSameTenant(tenantId, entity.tenantId, "seed record");
    const revision = inboxV2EntityRevisionSchema.parse(record.revision);
    const schemaVersion = inboxV2SchemaVersionTokenSchema.parse(
      record.schemaVersion ?? "v1"
    );
    const value = record.schema.parse(structuredClone(record.value));
    assertCanonicalRecordValue(entity, revision, value);

    return {
      entity,
      revision,
      schemaId: record.schemaId,
      schemaVersion,
      state: "upsert" as const,
      value
    };
  });
  assertUniqueEntities(records);
  assertScenarioProjectionConsistency(records);

  return immutable({
    tenantId,
    streamEpoch: inboxV2StreamEpochSchema.parse(
      input.streamEpoch ?? "scenario-stream-epoch-1"
    ),
    streamPosition: "0",
    records: sortRecords(records),
    commandRecords: [],
    commits: [],
    events: [],
    outboxIntents: []
  });
}

export function executeInboxV2ScenarioStep(
  world: InboxV2ScenarioWorld,
  step: InboxV2ScenarioStep
): InboxV2ScenarioStepResult {
  assertSameTenant(
    world.tenantId,
    step.authorization.tenantId,
    "authorization"
  );
  if (step.authorization.principal.kind === "unauthenticated") {
    throw new Error("Scenario commands require an authenticated principal.");
  }

  const principal =
    step.authorization.principal.kind === "employee"
      ? {
          kind: "employee" as const,
          employee: step.authorization.principal.employee
        }
      : {
          kind: "trusted_service" as const,
          trustedServiceId: step.authorization.principal.trustedServiceId
        };
  const scope = {
    tenantId: world.tenantId,
    principal,
    commandTypeId: SCENARIO_COMMAND_TYPE_ID,
    clientMutationId: step.clientMutationId
  };
  const commandId = inboxV2CommandIdSchema.parse(step.commandId);
  const commandRecordWithSameId = world.commandRecords.find(
    (record) => record.commandId === commandId
  );
  if (
    commandRecordWithSameId !== undefined &&
    !sameValue(commandRecordWithSameId.scope, scope)
  ) {
    return immutable({
      outcome: "conflict" as const,
      world,
      errorCode: "command.idempotency_conflict"
    });
  }
  const existing =
    world.commandRecords.find((record) => sameValue(record.scope, scope)) ??
    null;
  const idempotency = decideInboxV2CommandIdempotency({
    scope,
    requestHash: step.requestHash,
    existing
  });

  if (idempotency.kind === "conflict") {
    return immutable({
      outcome: "conflict" as const,
      world,
      errorCode: idempotency.errorCode
    });
  }
  if (idempotency.kind === "await_existing") {
    return immutable({
      outcome: "conflict" as const,
      world,
      errorCode: "command.already_executing"
    });
  }
  if (idempotency.kind === "replay") {
    if (existing?.state.kind !== "completed") {
      throw new Error("Replay requires a completed scenario command record.");
    }
    const currentResultAuthorization = evaluateInboxV2AuthorizationPlan(
      step.authorization
    );
    if (currentResultAuthorization.outcome === "denied") {
      return immutable({
        outcome: "rejected" as const,
        world,
        authorization: currentResultAuthorization
      });
    }
    return immutable({
      outcome: "replayed" as const,
      world,
      result: existing.state.result
    });
  }

  const authorization = evaluateInboxV2AuthorizationPlan(step.authorization);
  if (authorization.outcome === "denied") {
    return immutable({
      outcome: "rejected" as const,
      world,
      authorization
    });
  }

  const transition = step.transition({
    world,
    getRecord: (entity) => getInboxV2ScenarioRecord(world, entity),
    requireRecord: (entity) => {
      const record = getInboxV2ScenarioRecord(world, entity);
      if (record === null) {
        throw new Error(`Missing scenario record ${entityKey(entity)}.`);
      }
      return record;
    }
  });
  if (transition.kind === "reject") {
    return immutable({
      outcome: "conflict" as const,
      world,
      errorCode: transition.errorCode
    });
  }
  if (transition.changes.length === 0) {
    throw new Error(
      "A committed scenario transition requires a canonical change."
    );
  }

  let preparedChanges: ReturnType<typeof prepareChanges>;
  try {
    preparedChanges = prepareChanges(world, transition.changes);
  } catch (error) {
    if (error instanceof InboxV2ScenarioConflict) {
      return immutable({
        outcome: "conflict" as const,
        world,
        errorCode: error.errorCode
      });
    }
    throw error;
  }
  const nextPosition = inboxV2TenantStreamCommitPositionSchema.parse(
    (BigInt(world.streamPosition) + 1n).toString()
  );
  const ordinal = world.commits.length + 1;
  const commitId = inboxV2TenantStreamCommitIdSchema.parse(
    `scenario-commit:${ordinal}`
  );
  const decisionRefs = authorizationDecisionReferences(
    step,
    authorization,
    ordinal
  );
  const commitReference = inboxV2TenantStreamCommitReferenceSchema.parse({
    tenantId: world.tenantId,
    streamEpoch: world.streamEpoch,
    commitId,
    streamPosition: nextPosition
  });
  const domainCommitReference = payloadReference({
    tenantId: world.tenantId,
    recordId: `scenario-domain-commit:${ordinal}`,
    schemaId: SCENARIO_DOMAIN_COMMIT_SCHEMA_ID,
    schemaVersion: "v1",
    value: preparedChanges.map((change) => ({
      entity: change.entity,
      revision: change.resultingRevision,
      state:
        change.kind === "tombstone"
          ? { kind: change.kind, reasonId: change.reasonId }
          : { kind: change.kind }
    }))
  });
  const streamChanges = preparedChanges.map((change, index) => {
    const changeId = inboxV2TenantStreamChangeIdSchema.parse(
      `scenario-change:${ordinal}:${index + 1}`
    );
    const state =
      change.kind === "tombstone"
        ? {
            kind: "tombstone" as const,
            reasonId: change.reasonId,
            stateHash: digest({
              kind: change.kind,
              entity: change.entity,
              resultingRevision: change.resultingRevision,
              reasonId: change.reasonId
            }),
            domainCommitReference
          }
        : {
            kind: "upsert" as const,
            stateSchemaId: change.schemaId,
            stateSchemaVersion: change.schemaVersion,
            stateHash: digest(change.value),
            payloadReference: payloadReference({
              tenantId: world.tenantId,
              recordId: `scenario-state:${ordinal}:${index + 1}`,
              schemaId: change.schemaId,
              schemaVersion: change.schemaVersion,
              value: change.value
            }),
            domainCommitReference
          };
    return inboxV2TenantStreamChangeSchema.parse({
      reference: {
        tenantId: world.tenantId,
        commitId,
        streamPosition: nextPosition,
        changeId,
        ordinal: String(index + 1)
      },
      entity: change.entity,
      resultingRevision: change.resultingRevision,
      timeline: change.timeline ?? null,
      audience: change.audience,
      state
    });
  });
  const correlationId = inboxV2CorrelationIdSchema.parse(
    step.correlationId ?? `scenario-correlation:${ordinal}`
  );
  const eventMetadata = inferScenarioEventMetadata(
    world,
    preparedChanges,
    ordinal
  );
  const eventId = inboxV2EventIdSchema.parse(`event:scenario-${ordinal}`);
  const eventWithoutHash = {
    tenantId: world.tenantId,
    id: eventId,
    typeId: eventMetadata.typeId,
    payloadSchemaId: SCENARIO_PAYLOAD_SCHEMA_ID,
    payloadSchemaVersion: "v1" as const,
    commit: commitReference,
    ordinal: "1",
    changeIds: streamChanges.map((change) => change.reference.changeId),
    subjects: streamChanges.map((change) => change.entity),
    payloadReference: null,
    correlationId,
    commandIds: [commandId],
    clientMutationIds: [step.clientMutationId],
    authorizationDecisionRefs: decisionRefs,
    accessEffect: eventMetadata.accessEffect,
    occurredAt: step.committedAt,
    recordedAt: step.committedAt
  };
  const event = inboxV2DomainEventSchema.parse({
    ...eventWithoutHash,
    eventHash: digest(eventWithoutHash)
  });
  const outboxIntents = buildOutboxIntents({
    effects: transition.outboxEffects ?? [],
    tenantId: world.tenantId,
    ordinal,
    commitReference,
    correlationId,
    event,
    changes: streamChanges,
    preparedChanges,
    availableAt: step.committedAt
  });
  const resultChange = transition.resultEntity
    ? streamChanges.find((change) =>
        sameValue(change.entity, transition.resultEntity)
      )
    : undefined;
  const resultReference =
    resultChange?.state.kind === "upsert"
      ? resultChange.state.payloadReference
      : null;
  const commandResult = {
    tenantId: world.tenantId,
    commandId,
    principal,
    clientMutationId: step.clientMutationId,
    requestHash: step.requestHash,
    authorizationEpoch:
      step.authorization.currentAuthorization.authorizationEpoch,
    recordedAt: step.committedAt,
    kind: "committed" as const,
    commit: commitReference,
    resultReference
  };
  const commandRecord = {
    scope,
    commandId,
    firstRequestId: step.requestId,
    requestHash: step.requestHash,
    state: {
      kind: "completed" as const,
      result: commandResult,
      authorizationDecisionRefs: decisionRefs,
      authorizedAt: step.authorization.evaluatedAt,
      authorizationNotAfter: authorization.notAfter
    }
  };
  const commitWithoutHash = {
    tenantId: world.tenantId,
    streamEpoch: world.streamEpoch,
    id: commitId,
    position: nextPosition,
    schemaVersion: INBOX_V2_TENANT_STREAM_SCHEMA_VERSION,
    correlationId,
    commandIds: [commandId],
    clientMutationIds: [step.clientMutationId],
    authorizationDecisionRefs: decisionRefs,
    changeIds: streamChanges.map((change) => change.reference.changeId),
    eventIds: [eventId],
    outboxIntentIds: outboxIntents.map((intent) => intent.id),
    audienceImpact: eventMetadata.audienceImpact,
    committedAt: step.committedAt
  };
  const commit = {
    ...commitWithoutHash,
    commitHash: digest(commitWithoutHash)
  };
  const bundle = inboxV2AtomicMutationCommitSchema.parse({
    headBefore: {
      tenantId: world.tenantId,
      streamEpoch: world.streamEpoch,
      lastPosition: world.streamPosition,
      minRetainedPosition: "0"
    },
    commit,
    changes: streamChanges,
    events: [event],
    outboxIntents,
    commandRecords: [commandRecord],
    headAfter: {
      tenantId: world.tenantId,
      streamEpoch: world.streamEpoch,
      lastPosition: nextPosition,
      minRetainedPosition: "0"
    }
  });
  const nextRecords = applyPreparedChanges(world.records, preparedChanges);
  assertScenarioProjectionConsistency(nextRecords);
  const nextWorld = immutable({
    tenantId: world.tenantId,
    streamEpoch: world.streamEpoch,
    streamPosition: nextPosition,
    records: nextRecords,
    commandRecords: [...world.commandRecords, ...bundle.commandRecords],
    commits: [...world.commits, bundle],
    events: [...world.events, ...bundle.events],
    outboxIntents: [...world.outboxIntents, ...bundle.outboxIntents]
  });

  return immutable({
    outcome: "committed" as const,
    world: nextWorld,
    authorization,
    commit: bundle
  });
}

export function getInboxV2ScenarioRecord(
  world: InboxV2ScenarioWorld,
  entity: InboxV2EntityKey
): InboxV2ScenarioRecord | null {
  return (
    world.records.find(
      (record) => entityKey(record.entity) === entityKey(entity)
    ) ?? null
  );
}

export function snapshotInboxV2ScenarioWorld(
  world: InboxV2ScenarioWorld
): InboxV2ScenarioWorld {
  return immutable(structuredClone(world));
}

function prepareChanges(
  world: InboxV2ScenarioWorld,
  changes: readonly InboxV2ScenarioChange[]
) {
  assertUniqueEntities(changes);
  return changes.map((change) => {
    const entity = inboxV2EntityKeySchema.parse(change.entity);
    assertSameTenant(world.tenantId, entity.tenantId, "scenario change");
    const existing = getInboxV2ScenarioRecord(world, entity);
    const expectedRevision =
      change.expectedRevision === null
        ? null
        : inboxV2EntityRevisionSchema.parse(change.expectedRevision);
    const resultingRevision = inboxV2EntityRevisionSchema.parse(
      change.resultingRevision
    );
    if (
      (existing === null && expectedRevision !== null) ||
      (existing !== null && existing.revision !== expectedRevision)
    ) {
      throw new InboxV2ScenarioConflict("revision.conflict");
    }
    if (existing?.state === "tombstone") {
      throw new InboxV2ScenarioConflict("revision.conflict");
    }
    const expectedResult =
      expectedRevision === null ? 1n : BigInt(expectedRevision) + 1n;
    if (BigInt(resultingRevision) !== expectedResult) {
      throw new InboxV2ScenarioConflict("revision.non_contiguous");
    }
    const schemaVersion = inboxV2SchemaVersionTokenSchema.parse(
      change.schemaVersion ?? "v1"
    );
    if (change.kind === "tombstone") {
      const reasonId = inboxV2CatalogIdSchema.parse(change.reasonId);
      if (change.value !== null) {
        throw new Error("Scenario tombstone changes require a null value.");
      }
      return {
        ...change,
        kind: "tombstone" as const,
        entity,
        expectedRevision,
        resultingRevision,
        schemaVersion,
        reasonId,
        value: null
      };
    }
    const value = change.schema.parse(structuredClone(change.value));
    assertCanonicalRecordValue(entity, resultingRevision, value);
    assertScenarioImmutableHeadTransition({
      entity,
      existing,
      nextValue: value
    });
    return {
      ...change,
      kind: "upsert" as const,
      entity,
      expectedRevision,
      resultingRevision,
      schemaVersion,
      value
    };
  });
}

function applyPreparedChanges(
  records: readonly InboxV2ScenarioRecord[],
  changes: readonly ReturnType<typeof prepareChanges>[number][]
) {
  const byKey = new Map(
    records.map((record) => [entityKey(record.entity), record])
  );
  for (const change of changes) {
    const record: InboxV2ScenarioRecord =
      change.kind === "tombstone"
        ? {
            entity: change.entity,
            revision: change.resultingRevision,
            schemaId: change.schemaId,
            schemaVersion: change.schemaVersion,
            state: "tombstone",
            value: null
          }
        : {
            entity: change.entity,
            revision: change.resultingRevision,
            schemaId: change.schemaId,
            schemaVersion: change.schemaVersion,
            state: "upsert",
            value: change.value
          };
    byKey.set(entityKey(change.entity), record);
  }
  return sortRecords([...byKey.values()]);
}

function inferScenarioEventMetadata(
  world: InboxV2ScenarioWorld,
  changes: readonly ReturnType<typeof prepareChanges>[number][],
  ordinal: number
): Readonly<{
  typeId: InboxV2DomainEvent["typeId"];
  accessEffect: InboxV2DomainEvent["accessEffect"];
  audienceImpact: InboxV2AtomicMutationCommit["commit"]["audienceImpact"];
}> {
  type AccessCause = Extract<
    InboxV2DomainEvent["accessEffect"],
    { kind: "may_change_access" }
  >["causes"][number];
  const entityTypes = new Set(
    changes.map((change) => String(change.entity.entityTypeId))
  );
  const causes = new Set<AccessCause>();
  if (entityTypes.has("core:work-item")) {
    causes.add("work_item_relation_or_state");
  }
  if (
    [...entityTypes].some(
      (entityType) =>
        entityType.includes("participant") ||
        entityType.includes("internal-membership")
    )
  ) {
    causes.add("participant_membership");
  }
  if (entityTypes.has("core:conversation-client-link")) {
    causes.add("conversation_relation");
  }
  if (entityTypes.has("core:source-thread-binding")) {
    causes.add("source_binding");
  }

  const typeId: InboxV2DomainEvent["typeId"] = entityTypes.has("core:work-item")
    ? "core:work-item.changed"
    : [...entityTypes].some(
          (entityType) =>
            entityType.includes("participant") ||
            entityType.includes("internal-membership")
        )
      ? "core:participant.changed"
      : entityTypes.has("core:source-thread-binding")
        ? "core:source-binding.changed"
        : entityTypes.has("core:staff-note")
          ? "core:staff-note.changed"
          : entityTypes.has("core:message")
            ? "core:message.changed"
            : entityTypes.has("core:conversation") ||
                entityTypes.has("core:conversation-client-link")
              ? "core:conversation.changed"
              : "core:command.committed";

  if (causes.size === 0) {
    return {
      typeId,
      accessEffect: { kind: "none" },
      audienceImpact: { kind: "none" }
    };
  }
  const previousImpact = [...world.commits]
    .reverse()
    .map((bundle) => bundle.commit.audienceImpact)
    .find((impact) => impact.kind === "structural");
  const previousSharedAccessRevision =
    previousImpact?.kind === "structural"
      ? previousImpact.resultingSharedAccessRevision
      : inboxV2EntityRevisionSchema.parse("1");
  return {
    typeId,
    accessEffect: {
      kind: "may_change_access",
      causes: [...causes]
    },
    audienceImpact: {
      kind: "structural",
      impactId: inboxV2AudienceImpactIdSchema.parse(
        `audience-impact:scenario-${ordinal}`
      ),
      deliveryFence: "invalidate_before_payload",
      previousSharedAccessRevision,
      resultingSharedAccessRevision: inboxV2EntityRevisionSchema.parse(
        (BigInt(previousSharedAccessRevision) + 1n).toString()
      ),
      invalidations: changes.map((change) => ({
        kind: "entity" as const,
        entity: change.entity
      })),
      indexedFanoutPlanId: inboxV2AudienceImpactIdSchema.parse(
        `audience-impact:scenario-fanout-${ordinal}`
      )
    }
  };
}

function authorizationDecisionReferences(
  step: InboxV2ScenarioStep,
  decision: Extract<InboxV2AuthorizationDecision, { outcome: "allowed" }>,
  ordinal: number
): readonly InboxV2AuthorizationDecisionReference[] {
  const principal =
    step.authorization.principal.kind === "employee"
      ? {
          kind: "employee" as const,
          employee: step.authorization.principal.employee
        }
      : step.authorization.principal.kind === "trusted_service"
        ? {
            kind: "trusted_service" as const,
            trustedServiceId: step.authorization.principal.trustedServiceId
          }
        : null;
  if (principal === null) {
    throw new Error(
      "Allowed scenario decision requires an authenticated principal."
    );
  }
  return decision.requirements.map((allowed, index) => {
    const requirement = step.authorization.requirements.find(
      (candidate) => candidate.id === allowed.requirementId
    );
    if (requirement === undefined) {
      throw new Error(`Missing requirement ${allowed.requirementId}.`);
    }
    const referenceWithoutHash = {
      tenantId: step.authorization.tenantId,
      id: `scenario-authorization:${ordinal}:${index + 1}`,
      authorizationEpoch:
        step.authorization.currentAuthorization.authorizationEpoch,
      principal,
      permissionId: allowed.permissionId,
      resourceScopeId: requirement.resource.entityTypeId,
      resource: requirement.resource,
      resourceAccessRevision: requirement.resourceAccessRevision,
      decisionRevision: "1",
      outcome: "allowed",
      decidedAt: step.authorization.evaluatedAt,
      notAfter: allowed.notAfter
    } as const;
    return inboxV2AuthorizationDecisionReferenceSchema.parse({
      ...referenceWithoutHash,
      decisionHash: digest(referenceWithoutHash)
    });
  });
}

function buildOutboxIntents(input: {
  effects: readonly InboxV2ScenarioOutboxEffect[];
  tenantId: InboxV2TenantId;
  ordinal: number;
  commitReference: Readonly<{
    tenantId: InboxV2TenantId;
    streamEpoch: InboxV2AtomicMutationCommit["commit"]["streamEpoch"];
    commitId: InboxV2AtomicMutationCommit["commit"]["id"];
    streamPosition: InboxV2AtomicMutationCommit["commit"]["position"];
  }>;
  correlationId: string;
  event: InboxV2DomainEvent;
  changes: readonly InboxV2AtomicMutationCommit["changes"][number][];
  preparedChanges: readonly ReturnType<typeof prepareChanges>[number][];
  availableAt: string;
}): InboxV2OutboxIntent[] {
  const providerDispatchKeys = input.effects
    .filter((effect) => effect.effectClass === "provider_io")
    .map((effect) => {
      if (
        effect.payloadFromEntity === undefined ||
        effect.payloadFromEntity === null
      ) {
        throw new Error(
          "Provider scenario effect requires an exact dispatch payload entity."
        );
      }
      return entityKey(effect.payloadFromEntity);
    });
  if (new Set(providerDispatchKeys).size !== providerDispatchKeys.length) {
    throw new Error(
      "A scenario commit cannot enqueue duplicate provider effects for one OutboundDispatch."
    );
  }
  return input.effects.map((effect, index) => {
    const selectedChanges =
      effect.changeEntities === undefined
        ? input.changes
        : effect.changeEntities.map((entity) => {
            const change = input.changes.find((candidate) =>
              sameValue(candidate.entity, entity)
            );
            if (change === undefined) {
              throw new Error(
                `Outbox references unknown change ${entityKey(entity)}.`
              );
            }
            return change;
          });
    const payloadChange = effect.payloadFromEntity
      ? selectedChanges.find((change) =>
          sameValue(change.entity, effect.payloadFromEntity)
        )
      : undefined;
    const payloadReference =
      payloadChange?.state.kind === "upsert"
        ? payloadChange.state.payloadReference
        : null;
    const selectedChangeKeys = selectedChanges.map((change) =>
      entityKey(change.entity)
    );
    if (new Set(selectedChangeKeys).size !== selectedChangeKeys.length) {
      throw new Error("Outbox change references must be unique.");
    }
    const selectedPreparedChanges = selectedChanges.map((change) => {
      const prepared = input.preparedChanges.find((candidate) =>
        sameValue(candidate.entity, change.entity)
      );
      if (prepared === undefined) {
        throw new Error(
          `Outbox has no prepared change for ${entityKey(change.entity)}.`
        );
      }
      return prepared;
    });
    const outboundDispatchChanges = selectedChanges.filter(
      (change) =>
        change.entity.entityTypeId === "core:outbound-dispatch" &&
        change.state.kind === "upsert" &&
        change.state.payloadReference.schemaId ===
          INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID &&
        change.state.payloadReference.schemaVersion ===
          INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION
    );
    const outboundRouteChanges = selectedChanges.filter(
      (change) =>
        change.entity.entityTypeId === "core:outbound-route" &&
        change.state.kind === "upsert" &&
        change.state.payloadReference.schemaId ===
          INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID &&
        change.state.payloadReference.schemaVersion ===
          INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION
    );
    const outboundMessageChanges = selectedChanges.filter(
      (change) =>
        change.entity.entityTypeId === "core:message" &&
        change.state.kind === "upsert" &&
        change.state.payloadReference.schemaId === INBOX_V2_MESSAGE_SCHEMA_ID &&
        change.state.payloadReference.schemaVersion ===
          INBOX_V2_MESSAGE_SCHEMA_VERSION
    );
    if (
      effect.effectClass === "provider_io" &&
      (effect.typeId !== "core:provider.dispatch" ||
        outboundDispatchChanges.length !== 1 ||
        outboundRouteChanges.length !== 1 ||
        outboundMessageChanges.length !== 1 ||
        payloadReference === null ||
        payloadReference.schemaId !== INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID ||
        payloadReference.schemaVersion !==
          INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION)
    ) {
      throw new Error(
        "Provider scenario effect requires one exact Message, OutboundRoute and OutboundDispatch change."
      );
    }
    if (effect.effectClass === "provider_io") {
      const dispatch = selectedPreparedChanges.find(
        (change) =>
          change.entity.entityTypeId === "core:outbound-dispatch" &&
          change.kind === "upsert" &&
          change.schemaId === INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID
      );
      const route = selectedPreparedChanges.find(
        (change) =>
          change.entity.entityTypeId === "core:outbound-route" &&
          change.kind === "upsert" &&
          change.schemaId === INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID
      );
      const message = selectedPreparedChanges.find(
        (change) =>
          change.entity.entityTypeId === "core:message" &&
          change.kind === "upsert" &&
          change.schemaId === INBOX_V2_MESSAGE_SCHEMA_ID
      );
      if (
        dispatch?.kind !== "upsert" ||
        route?.kind !== "upsert" ||
        message?.kind !== "upsert"
      ) {
        throw new Error(
          "Provider scenario effect requires upserted Message, OutboundRoute and OutboundDispatch records."
        );
      }
      const dispatchValue = dispatch.value as Record<string, unknown>;
      const messageValue = message.value as Record<string, unknown>;
      const messageOrigin = messageValue.origin as
        | Record<string, unknown>
        | undefined;
      if (
        referenceId(dispatchValue.message) !== message.entity.entityId ||
        referenceId(dispatchValue.route) !== route.entity.entityId ||
        messageOrigin?.kind !== "hulee_external" ||
        referenceId(messageOrigin.outboundRoute) !== route.entity.entityId
      ) {
        throw new Error(
          "Provider scenario effect selected decoy Message or OutboundRoute changes."
        );
      }
    }
    const intentWithoutHash = {
      tenantId: input.tenantId,
      id: `scenario-outbox:${input.ordinal}:${index + 1}`,
      typeId: effect.typeId,
      handlerId: effect.handlerId,
      effectClass: effect.effectClass,
      commit: input.commitReference,
      eventId: input.event.id,
      changeIds: selectedChanges.map((change) => change.reference.changeId),
      payloadReference,
      consumerDedupeKey: digest({
        handler: effect.handlerId,
        ordinal: input.ordinal,
        index
      }),
      correlationId: input.correlationId,
      availableAt: input.availableAt
    };
    return inboxV2OutboxIntentSchema.parse({
      ...intentWithoutHash,
      intentHash: digest(intentWithoutHash)
    });
  });
}

function payloadReference(input: {
  tenantId: InboxV2TenantId;
  recordId: string;
  schemaId: string;
  schemaVersion: string;
  value: unknown;
}): InboxV2PayloadReference {
  return inboxV2PayloadReferenceSchema.parse({
    tenantId: input.tenantId,
    recordId: input.recordId,
    schemaId: input.schemaId,
    schemaVersion: input.schemaVersion,
    digest: digest(input.value)
  });
}

function digest(value: unknown) {
  return inboxV2Sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
}

function entityKey(entity: InboxV2EntityKey): string {
  return `${entity.tenantId}\u0000${entity.entityTypeId}\u0000${entity.entityId}`;
}

function assertUniqueEntities(
  records: readonly Readonly<{ entity: InboxV2EntityKey }>[]
): void {
  const keys = records.map((record) => entityKey(record.entity));
  if (new Set(keys).size !== keys.length) {
    throw new Error("Scenario records must use unique tenant/entity keys.");
  }
}

function sortRecords<T extends Readonly<{ entity: InboxV2EntityKey }>>(
  records: readonly T[]
): T[] {
  return [...records].sort((left, right) =>
    entityKey(left.entity).localeCompare(entityKey(right.entity))
  );
}

function assertSameTenant(
  expected: string,
  actual: string,
  boundary: string
): void {
  if (expected !== actual) {
    throw new Error(
      `Inbox V2 scenario ${boundary} crossed the tenant boundary.`
    );
  }
}

function assertCanonicalRecordValue(
  entity: InboxV2EntityKey,
  revision: string,
  value: unknown
): void {
  assertPayloadTenantBoundary(value, entity.tenantId, "payload");
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const root = value as Record<string, unknown>;
  if (typeof root.id === "string" && root.id !== entity.entityId) {
    throw new Error(
      `Scenario payload id ${root.id} does not match ${entity.entityId}.`
    );
  }
  if (typeof root.revision === "string" && root.revision !== revision) {
    throw new Error(
      `Scenario payload revision ${root.revision} does not match ${revision}.`
    );
  }
}

function assertScenarioImmutableHeadTransition(input: {
  readonly entity: InboxV2EntityKey;
  readonly existing: InboxV2ScenarioRecord | null;
  readonly nextValue: unknown;
}): void {
  if (input.existing?.state !== "upsert") {
    return;
  }

  const immutableFieldsByEntityType: Readonly<
    Record<string, readonly string[] | undefined>
  > = {
    "core:message": [
      "tenantId",
      "id",
      "conversation",
      "timelineItem",
      "authorParticipant",
      "origin",
      "appActor",
      "automationCausation",
      "referenceContext",
      "createdAt"
    ],
    "core:staff-note": [
      "tenantId",
      "id",
      "conversation",
      "timelineItem",
      "authorParticipant",
      "appActor",
      "automationCausation",
      "createdAt"
    ],
    "core:work-item": [
      "tenantId",
      "id",
      "conversation",
      "ordinal",
      "createdBy",
      "creationReasonId",
      "createdAt"
    ]
  };
  const immutableFields =
    immutableFieldsByEntityType[input.entity.entityTypeId];

  if (immutableFields === undefined) {
    return;
  }

  const previous = objectRecordValue(
    input.existing.value,
    input.entity.entityTypeId
  );
  const next = objectRecordValue(input.nextValue, input.entity.entityTypeId);

  for (const field of immutableFields) {
    if (!sameValue(previous[field], next[field])) {
      throw new Error(
        `Scenario ${input.entity.entityTypeId} immutable field ${field} changed.`
      );
    }
  }
}

function objectRecordValue(
  value: unknown,
  boundary: string
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Scenario ${boundary} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertScenarioProjectionConsistency(
  records: readonly InboxV2ScenarioRecord[]
): void {
  const activeRecords = records.filter((record) => record.state === "upsert");
  assertScenarioSourceIdentityKeyUniqueness(activeRecords);
  assertScenarioIdentityClaimConsistency(activeRecords);
  assertScenarioCanonicalGraphConsistency(activeRecords);
  assertScenarioRouteGraphConsistency(activeRecords);
  const projections = activeRecords.filter(
    (record) =>
      record.entity.entityTypeId === "module:hulee-testing:scenario-state"
  );
  for (const projection of projections) {
    if (
      projection.value === null ||
      typeof projection.value !== "object" ||
      Array.isArray(projection.value)
    ) {
      throw new Error("Scenario invariant projection must be an object.");
    }
    const state = projection.value as Record<string, unknown>;
    const conversationId = state.conversationId;
    if (typeof conversationId !== "string") continue;

    const participantIds = activeRecords
      .flatMap((record) => (Array.isArray(record.value) ? record.value : []))
      .filter(
        (value): value is Record<string, unknown> =>
          value !== null && typeof value === "object" && !Array.isArray(value)
      )
      .filter((value) => referenceHasId(value.conversation, conversationId))
      .map((value) => value.id)
      .filter((id): id is string => typeof id === "string");
    assertSameStringSet(state.participantIds, participantIds, "participantIds");

    const clientIds = activeRecords
      .filter(
        (record) =>
          record.entity.entityTypeId === "core:conversation-client-link"
      )
      .map((record) => record.value)
      .filter(
        (value): value is Record<string, unknown> =>
          value !== null && typeof value === "object" && !Array.isArray(value)
      )
      .filter((value) => referenceHasId(value.conversation, conversationId))
      .map((value) => referenceId(value.client))
      .filter((id): id is string => id !== null);
    assertSameStringSet(state.clientIds, clientIds, "clientIds");

    const messages = activeRecords
      .filter((record) => record.entity.entityTypeId === "core:message")
      .filter(
        (record) =>
          record.value !== null &&
          typeof record.value === "object" &&
          !Array.isArray(record.value) &&
          referenceHasId(
            (record.value as Record<string, unknown>).conversation,
            conversationId
          )
      );
    assertSameStringSet(
      state.physicalMessageIds,
      messages.map((record) => String(record.entity.entityId)),
      "physicalMessageIds"
    );

    const workItems = activeRecords.filter(
      (record) =>
        record.entity.entityTypeId === "core:work-item" &&
        record.value !== null &&
        typeof record.value === "object" &&
        !Array.isArray(record.value) &&
        referenceHasId(
          (record.value as Record<string, unknown>).conversation,
          conversationId
        )
    );
    const projectedWorkItemId = state.workItemId;
    if (
      projectedWorkItemId === null
        ? workItems.length !== 0
        : typeof projectedWorkItemId !== "string" ||
          workItems.length !== 1 ||
          workItems[0]!.entity.entityId !== projectedWorkItemId
    ) {
      throw new Error(
        "Scenario workItemId diverges from canonical WorkItem records."
      );
    }
    if (workItems.length === 1) {
      const work = workItems[0]!.value as Record<string, unknown>;
      const operationalState = work.operationalState as
        | Record<string, unknown>
        | undefined;
      const assignment = operationalState?.primaryAssignment as
        | Record<string, unknown>
        | null
        | undefined;
      const responsibleId = referenceId(assignment?.employee);
      if ((state.primaryResponsibleEmployeeId ?? null) !== responsibleId) {
        throw new Error(
          "Scenario responsibility diverges from the canonical WorkItem assignment."
        );
      }
    }

    if (state.kind === "internal_direct" || state.kind === "internal_group") {
      const internalFacts = scenarioInternalConversationFacts(
        activeRecords,
        conversationId
      );
      assertSameStringSet(
        state.employeeAnchorIds,
        internalFacts.employeeAnchorIds,
        "employeeAnchorIds"
      );
      assertSameStringSet(
        state.ownerEmployeeIds,
        internalFacts.activeOwnerEmployeeIds,
        "ownerEmployeeIds"
      );
    }
  }
}

function assertScenarioIdentityClaimConsistency(
  records: readonly InboxV2ScenarioRecord[]
): void {
  const identities = new Map<string, Record<string, unknown>>();
  const claims = new Map<string, Record<string, unknown>>();
  const activeClaimByIdentity = new Map<string, Record<string, unknown>>();

  for (const identityRecord of records.filter(
    (record) => record.entity.entityTypeId === "core:source-external-identity"
  )) {
    identities.set(
      identityRecord.entity.entityId,
      objectRecordValue(identityRecord.value, "SourceExternalIdentity")
    );
  }

  for (const claimRecord of records.filter(
    (record) => record.entity.entityTypeId === "core:source-identity-claim"
  )) {
    const claim = objectRecordValue(claimRecord.value, "SourceIdentityClaim");
    const identityId = referenceId(claim.sourceExternalIdentity);
    const identity =
      identityId === null ? undefined : identities.get(identityId);

    if (identity === undefined) {
      throw new Error(
        "Scenario SourceIdentityClaim SourceExternalIdentity record is missing."
      );
    }
    claims.set(claimRecord.entity.entityId, claim);

    if (claim.status !== "active") {
      continue;
    }
    if (activeClaimByIdentity.has(identityId!)) {
      throw new Error(
        "Scenario SourceExternalIdentity cannot have multiple active claims."
      );
    }
    activeClaimByIdentity.set(identityId!, claim);
  }

  for (const [identityId, identity] of identities) {
    const resolution = objectRecordValue(
      identity.resolution,
      "SourceExternalIdentity resolution"
    );
    const activeClaim = activeClaimByIdentity.get(identityId);

    if (resolution.status !== "claimed") {
      if (activeClaim !== undefined) {
        throw new Error(
          "Scenario active SourceIdentityClaim requires a claimed identity head."
        );
      }
      continue;
    }

    const activeClaimId = referenceId(resolution.activeClaim);
    const claimedRecord =
      activeClaimId === null ? undefined : claims.get(activeClaimId);
    if (
      claimedRecord === undefined ||
      claimedRecord.status !== "active" ||
      referenceId(claimedRecord.sourceExternalIdentity) !== identityId ||
      activeClaim !== claimedRecord ||
      identity.latestClaimVersion !== claimedRecord.claimVersion
    ) {
      throw new Error(
        "Scenario SourceExternalIdentity claim head diverges from its active claim."
      );
    }
  }
}

function assertScenarioCanonicalGraphConsistency(
  records: readonly InboxV2ScenarioRecord[]
): void {
  const recordByEntity = new Map(
    records.map((record) => [
      `${record.entity.entityTypeId}:${record.entity.entityId}`,
      record
    ])
  );
  const requireRecord = (
    entityTypeId: string,
    id: string | null,
    boundary: string
  ): InboxV2ScenarioRecord => {
    const record =
      id === null ? undefined : recordByEntity.get(`${entityTypeId}:${id}`);

    if (record === undefined) {
      throw new Error(`Scenario ${boundary} record is missing.`);
    }

    return record;
  };
  const requireConversation = (
    value: Record<string, unknown>,
    boundary: string
  ): string => {
    const conversationId = referenceId(value.conversation);
    requireRecord(
      "core:conversation",
      conversationId,
      `${boundary} Conversation`
    );
    return conversationId!;
  };
  const participants = new Map<string, Record<string, unknown>>();
  const participantsByConversation = new Map<
    string,
    Record<string, unknown>[]
  >();

  for (const participantSet of records.filter(
    (record) =>
      record.entity.entityTypeId === "core:conversation-participant-set"
  )) {
    if (!Array.isArray(participantSet.value)) {
      throw new Error("Scenario ConversationParticipantSet must be an array.");
    }

    const setConversationIds = new Set<string>();
    for (const rawParticipant of participantSet.value) {
      const participant = objectRecordValue(
        rawParticipant,
        "ConversationParticipant"
      );
      const participantId =
        typeof participant.id === "string" ? participant.id : null;
      const conversationId = requireConversation(
        participant,
        "ConversationParticipant"
      );

      if (participantId === null || participants.has(participantId)) {
        throw new Error(
          "Scenario ConversationParticipant ids must be present and unique."
        );
      }

      participants.set(participantId, participant);
      setConversationIds.add(conversationId);
      const conversationParticipants =
        participantsByConversation.get(conversationId) ?? [];
      conversationParticipants.push(participant);
      participantsByConversation.set(conversationId, conversationParticipants);
    }

    if (setConversationIds.size > 1) {
      throw new Error(
        "Scenario ConversationParticipantSet cannot mix Conversations."
      );
    }
  }

  for (const record of records) {
    const entityTypeId = record.entity.entityTypeId;

    if (
      entityTypeId !== "core:work-item" &&
      entityTypeId !== "core:external-thread" &&
      entityTypeId !== "core:conversation-client-link" &&
      entityTypeId !== "core:message" &&
      entityTypeId !== "core:staff-note"
    ) {
      continue;
    }

    const value = objectRecordValue(record.value, entityTypeId);
    const conversationId = requireConversation(value, entityTypeId);

    if (entityTypeId !== "core:message" && entityTypeId !== "core:staff-note") {
      continue;
    }

    const authorParticipantId = referenceId(value.authorParticipant);
    const authorParticipant =
      authorParticipantId === null
        ? undefined
        : participants.get(authorParticipantId);

    if (
      authorParticipant === undefined ||
      referenceId(authorParticipant.conversation) !== conversationId
    ) {
      throw new Error(
        `Scenario ${entityTypeId} author must exist in the same Conversation.`
      );
    }
  }

  const nonTerminalWorkItemsByConversation = new Map<string, number>();
  for (const workItemRecord of records.filter(
    (record) => record.entity.entityTypeId === "core:work-item"
  )) {
    const workItem = objectRecordValue(workItemRecord.value, "WorkItem");
    const operationalState = objectRecordValue(
      workItem.operationalState,
      "WorkItem operationalState"
    );
    if (
      operationalState.state === "resolved" ||
      operationalState.state === "dismissed"
    ) {
      continue;
    }
    const conversationId = referenceId(workItem.conversation)!;
    nonTerminalWorkItemsByConversation.set(
      conversationId,
      (nonTerminalWorkItemsByConversation.get(conversationId) ?? 0) + 1
    );
  }
  if (
    [...nonTerminalWorkItemsByConversation.values()].some((count) => count > 1)
  ) {
    throw new Error(
      "Scenario Conversation cannot have multiple non-terminal WorkItems."
    );
  }

  for (const conversationRecord of records.filter(
    (record) => record.entity.entityTypeId === "core:conversation"
  )) {
    const conversation = objectRecordValue(
      conversationRecord.value,
      "Conversation"
    );
    if (
      conversation.transport !== "internal" ||
      conversation.lifecycle !== "active" ||
      (conversation.topology !== "direct" && conversation.topology !== "group")
    ) {
      continue;
    }

    const conversationId = conversationRecord.entity.entityId;
    const internalFacts = scenarioInternalConversationFacts(
      records,
      conversationId
    );
    if (
      conversation.topology === "direct" &&
      internalFacts.employeeAnchorIds.length !== 2
    ) {
      throw new Error(
        "Scenario active internal direct Conversation requires exactly two Employee anchors."
      );
    }
    if (
      conversation.topology === "group" &&
      (internalFacts.activeEmployeeIds.length < 2 ||
        internalFacts.activeOwnerEmployeeIds.length < 1)
    ) {
      throw new Error(
        "Scenario active internal group Conversation requires two active Employees and one owner."
      );
    }
  }
}

function scenarioInternalConversationFacts(
  records: readonly InboxV2ScenarioRecord[],
  conversationId: string
): Readonly<{
  employeeAnchorIds: readonly string[];
  activeEmployeeIds: readonly string[];
  activeOwnerEmployeeIds: readonly string[];
}> {
  const employeeByParticipantId = new Map<string, string>();

  for (const participantSet of records.filter(
    (record) =>
      record.entity.entityTypeId === "core:conversation-participant-set" &&
      Array.isArray(record.value)
  )) {
    for (const rawParticipant of participantSet.value as readonly unknown[]) {
      const participant = objectRecordValue(
        rawParticipant,
        "ConversationParticipant"
      );
      if (!referenceHasId(participant.conversation, conversationId)) {
        continue;
      }
      const subject = objectRecordValue(
        participant.subject,
        "ConversationParticipant subject"
      );
      const participantId =
        typeof participant.id === "string" ? participant.id : null;
      const employeeId =
        subject.kind === "employee" ? referenceId(subject.employee) : null;
      if (participantId !== null && employeeId !== null) {
        employeeByParticipantId.set(participantId, employeeId);
      }
    }
  }

  const activeEmployeeIds = new Set<string>();
  const activeOwnerEmployeeIds = new Set<string>();
  const activeEpisodeParticipantIds = new Set<string>();
  for (const episodeRecord of records.filter(
    (record) =>
      record.entity.entityTypeId === "core:participant-membership-episode"
  )) {
    const episode = objectRecordValue(
      episodeRecord.value,
      "ParticipantMembershipEpisode"
    );
    const origin = objectRecordValue(
      episode.origin,
      "ParticipantMembershipEpisode origin"
    );
    const participantId = referenceId(episode.participant);
    const employeeId =
      participantId === null
        ? undefined
        : employeeByParticipantId.get(participantId);

    if (
      employeeId === undefined ||
      episode.state !== "active" ||
      origin.kind !== "hulee_internal_command" ||
      episode.evidenceClassification !== "confirmed"
    ) {
      continue;
    }
    if (activeEpisodeParticipantIds.has(participantId!)) {
      throw new Error(
        "Scenario Employee participant cannot have multiple active internal membership episodes."
      );
    }
    activeEpisodeParticipantIds.add(participantId!);
    activeEmployeeIds.add(employeeId);
    if (episode.role === "owner") {
      activeOwnerEmployeeIds.add(employeeId);
    }
  }

  return {
    employeeAnchorIds: [...new Set(employeeByParticipantId.values())].sort(),
    activeEmployeeIds: [...activeEmployeeIds].sort(),
    activeOwnerEmployeeIds: [...activeOwnerEmployeeIds].sort()
  };
}

function assertScenarioSourceIdentityKeyUniqueness(
  records: readonly InboxV2ScenarioRecord[]
): void {
  const keys = records
    .filter(
      (record) => record.entity.entityTypeId === "core:source-external-identity"
    )
    .map((record) => {
      if (
        record.value === null ||
        typeof record.value !== "object" ||
        Array.isArray(record.value)
      ) {
        throw new Error("Scenario SourceExternalIdentity must be an object.");
      }
      const identity = record.value as Record<string, unknown>;
      return stableJson({
        tenantId: identity.tenantId,
        realm: identity.realm,
        scope: identity.scope,
        canonicalExternalSubject: identity.canonicalExternalSubject
      });
    });
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      "Scenario SourceExternalIdentity scoped identity keys must be unique."
    );
  }
}

function assertScenarioRouteGraphConsistency(
  records: readonly InboxV2ScenarioRecord[]
): void {
  const findRecord = (entityTypeId: string, id: string | null) =>
    id === null
      ? null
      : (records.find(
          (record) =>
            record.entity.entityTypeId === entityTypeId &&
            record.entity.entityId === id
        ) ?? null);
  const objectValue = (
    record: InboxV2ScenarioRecord | null,
    boundary: string
  ): Record<string, unknown> => {
    if (
      record === null ||
      record.value === null ||
      typeof record.value !== "object" ||
      Array.isArray(record.value)
    ) {
      throw new Error(`Scenario ${boundary} record is missing.`);
    }
    return record.value as Record<string, unknown>;
  };

  for (const routeRecord of records.filter(
    (record) => record.entity.entityTypeId === "core:outbound-route"
  )) {
    const route = objectValue(routeRecord, "OutboundRoute");
    const binding = objectValue(
      findRecord(
        "core:source-thread-binding",
        referenceId(route.sourceThreadBinding)
      ),
      "OutboundRoute SourceThreadBinding"
    );
    const externalThread = objectValue(
      findRecord("core:external-thread", referenceId(route.externalThread)),
      "OutboundRoute ExternalThread"
    );
    objectValue(
      findRecord("core:conversation", referenceId(route.conversation)),
      "OutboundRoute Conversation"
    );
    if (
      referenceId(binding.externalThread) !==
        referenceId(route.externalThread) ||
      referenceId(binding.sourceAccount) !== referenceId(route.sourceAccount) ||
      referenceId(binding.sourceConnection) !==
        referenceId(route.sourceConnection) ||
      referenceId(externalThread.conversation) !==
        referenceId(route.conversation)
    ) {
      throw new Error(
        "Scenario OutboundRoute diverges from its canonical thread/binding graph."
      );
    }
  }

  for (const messageRecord of records.filter(
    (record) => record.entity.entityTypeId === "core:message"
  )) {
    const message = objectValue(messageRecord, "Message");
    const origin =
      message.origin !== null &&
      typeof message.origin === "object" &&
      !Array.isArray(message.origin)
        ? (message.origin as Record<string, unknown>)
        : null;
    if (origin?.kind !== "hulee_external") continue;
    const route = objectValue(
      findRecord("core:outbound-route", referenceId(origin.outboundRoute)),
      "Message OutboundRoute"
    );
    if (referenceId(route.conversation) !== referenceId(message.conversation)) {
      throw new Error(
        "Scenario Message and OutboundRoute must target one Conversation."
      );
    }
    const appActor =
      message.appActor !== null &&
      typeof message.appActor === "object" &&
      !Array.isArray(message.appActor)
        ? (message.appActor as Record<string, unknown>)
        : null;
    const routePrincipal =
      route.principal !== null &&
      typeof route.principal === "object" &&
      !Array.isArray(route.principal)
        ? (route.principal as Record<string, unknown>)
        : null;
    if (
      appActor?.kind === "employee" &&
      (routePrincipal?.kind !== "employee" ||
        referenceId(appActor.employee) !==
          referenceId(routePrincipal.employee) ||
        appActor.authorizationEpoch !== route.authorizationEpoch)
    ) {
      throw new Error(
        "Scenario Message app actor diverges from the immutable OutboundRoute principal."
      );
    }
  }

  for (const dispatchRecord of records.filter(
    (record) => record.entity.entityTypeId === "core:outbound-dispatch"
  )) {
    const dispatch = objectValue(dispatchRecord, "OutboundDispatch");
    const message = objectValue(
      findRecord("core:message", referenceId(dispatch.message)),
      "OutboundDispatch Message"
    );
    const route = objectValue(
      findRecord("core:outbound-route", referenceId(dispatch.route)),
      "OutboundDispatch OutboundRoute"
    );
    const origin =
      message.origin !== null &&
      typeof message.origin === "object" &&
      !Array.isArray(message.origin)
        ? (message.origin as Record<string, unknown>)
        : null;
    if (
      origin?.kind !== "hulee_external" ||
      referenceId(origin.outboundRoute) !== referenceId(dispatch.route) ||
      referenceId(message.conversation) !== referenceId(route.conversation)
    ) {
      throw new Error(
        "Scenario OutboundDispatch diverges from its Message and OutboundRoute."
      );
    }
  }
}

function assertSameStringSet(
  projected: unknown,
  canonical: readonly string[],
  field: string
): void {
  if (
    !Array.isArray(projected) ||
    projected.some((value) => typeof value !== "string") ||
    [...projected].sort().join("\u0000") !==
      [...canonical].sort().join("\u0000")
  ) {
    throw new Error(
      `Scenario ${field} diverges from canonical Inbox V2 records.`
    );
  }
}

function referenceHasId(value: unknown, expectedId: string): boolean {
  return referenceId(value) === expectedId;
}

function referenceId(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

function assertPayloadTenantBoundary(
  value: unknown,
  tenantId: string,
  path: string
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertPayloadTenantBoundary(child, tenantId, `${path}[${index}]`)
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (typeof object.tenantId === "string" && object.tenantId !== tenantId) {
    throw new Error(`Inbox V2 scenario ${path} crossed the tenant boundary.`);
  }
  for (const [key, child] of Object.entries(object)) {
    assertPayloadTenantBoundary(child, tenantId, `${path}.${key}`);
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function immutable<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    immutable(child);
  }
  return Object.freeze(value);
}
