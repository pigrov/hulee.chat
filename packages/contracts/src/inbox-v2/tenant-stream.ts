import { z } from "zod";

import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import { inboxV2CatalogIdSchema } from "./catalog";
import { inboxV2CommandIdempotencyRecordSchema } from "./command-protocol";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2EmployeeReferenceSchema,
  inboxV2EventIdSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION
} from "./outbound-dispatch";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema,
  parseInboxV2VersionedEnvelope
} from "./schema-version";
import {
  inboxV2AudienceImpactIdSchema,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2CommandIdSchema,
  inboxV2CorrelationIdSchema,
  inboxV2EntityKeySchema,
  inboxV2InvalidationScopeSchema,
  inboxV2OutboxIntentIdSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2TenantStreamChangeIdSchema,
  inboxV2TenantStreamCommitIdSchema,
  inboxV2TenantStreamCommitPositionSchema,
  inboxV2TenantStreamPositionSchema,
  inboxV2TimelinePositionContextSchema
} from "./sync-primitives";

export const INBOX_V2_ATOMIC_MUTATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.atomic-mutation-commit" as const;
export const INBOX_V2_TENANT_STREAM_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_CORE_DOMAIN_EVENT_TYPE_IDS = [
  "core:command.committed",
  "core:conversation.changed",
  "core:participant.changed",
  "core:work-item.changed",
  "core:timeline.changed",
  "core:message.changed",
  "core:source-occurrence.changed",
  "core:staff-note.changed",
  "core:source-connection.changed",
  "core:source-binding.changed",
  "core:authorization.changed",
  "core:content.invalidated"
] as const;

export const INBOX_V2_CORE_OUTBOX_INTENT_TYPE_IDS = [
  "core:projection.update",
  "core:notification.evaluate",
  "core:provider.dispatch",
  "core:search.index",
  "core:workflow.evaluate"
] as const;

const moduleNamespacedIdSchema = inboxV2NamespacedIdSchema.refine(
  (value) => value.startsWith("module:"),
  { message: "Extension type IDs must use a module:<module-id>:* namespace." }
);

export const inboxV2DomainEventTypeIdSchema = z.union([
  z.enum(INBOX_V2_CORE_DOMAIN_EVENT_TYPE_IDS),
  moduleNamespacedIdSchema
]);

export const inboxV2DomainEventAccessEffectSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("none") }).strict(),
    z
      .object({
        kind: z.literal("may_change_access"),
        causes: z
          .array(
            z.enum([
              "rbac_or_direct_grant",
              "participant_membership",
              "conversation_relation",
              "work_item_relation_or_state",
              "source_binding",
              "temporal_boundary"
            ])
          )
          .min(1)
          .max(8)
      })
      .strict()
  ]
);

export const inboxV2OutboxIntentTypeIdSchema = z.union([
  z.enum(INBOX_V2_CORE_OUTBOX_INTENT_TYPE_IDS),
  moduleNamespacedIdSchema
]);

export const inboxV2TenantStreamCommitReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    commitId: inboxV2TenantStreamCommitIdSchema,
    streamPosition: inboxV2TenantStreamCommitPositionSchema
  })
  .strict();

export const inboxV2TenantStreamChangeReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    commitId: inboxV2TenantStreamCommitIdSchema,
    streamPosition: inboxV2TenantStreamCommitPositionSchema,
    changeId: inboxV2TenantStreamChangeIdSchema,
    ordinal: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2TenantStreamHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    lastPosition: inboxV2TenantStreamPositionSchema,
    minRetainedPosition: inboxV2TenantStreamPositionSchema
  })
  .strict()
  .superRefine((head, context) => {
    if (BigInt(head.minRetainedPosition) > BigInt(head.lastPosition)) {
      context.addIssue({
        code: "custom",
        path: ["minRetainedPosition"],
        message: "Minimum retained position cannot exceed the stream head."
      });
    }
  });

export const inboxV2CanonicalChangeStateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("upsert"),
      stateSchemaId: inboxV2NamespacedIdSchema,
      stateSchemaVersion: inboxV2SchemaVersionTokenSchema,
      stateHash: inboxV2Sha256DigestSchema,
      payloadReference: inboxV2PayloadReferenceSchema,
      domainCommitReference: inboxV2PayloadReferenceSchema
    })
    .strict()
    .superRefine((state, context) => {
      if (
        String(state.payloadReference.schemaId) !==
          String(state.stateSchemaId) ||
        String(state.payloadReference.schemaVersion) !==
          String(state.stateSchemaVersion)
      ) {
        context.addIssue({
          code: "custom",
          path: ["payloadReference"],
          message:
            "Canonical state metadata must identify the exact referenced payload parser."
        });
      }
    }),
  z
    .object({
      kind: z.literal("tombstone"),
      reasonId: inboxV2CatalogIdSchema,
      stateHash: inboxV2Sha256DigestSchema,
      domainCommitReference: inboxV2PayloadReferenceSchema
    })
    .strict()
]);

export const inboxV2TenantStreamChangeSchema = z
  .object({
    reference: inboxV2TenantStreamChangeReferenceSchema,
    entity: inboxV2EntityKeySchema,
    resultingRevision: inboxV2EntityRevisionSchema,
    timeline: inboxV2TimelinePositionContextSchema.nullable(),
    audience: z.enum([
      "conversation_external",
      "internal_participants",
      "staff_only",
      "workforce_metadata",
      "policy_filtered"
    ]),
    state: inboxV2CanonicalChangeStateSchema
  })
  .strict()
  .superRefine((change, context) => {
    if (
      change.reference.tenantId !== change.entity.tenantId ||
      change.state.domainCommitReference.tenantId !== change.entity.tenantId ||
      (change.state.kind === "upsert" &&
        change.state.payloadReference.tenantId !== change.entity.tenantId)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Canonical change references and payloads must share the entity tenant."
      });
    }
  });

export const inboxV2DirectAudienceImpactSchema = z
  .object({
    kind: z.literal("direct"),
    impactId: inboxV2AudienceImpactIdSchema,
    deliveryFence: z.literal("invalidate_before_payload"),
    affectedRecipients: z
      .array(
        z
          .object({
            employee: inboxV2EmployeeReferenceSchema,
            relation: z.enum(["previous", "resulting", "both"]),
            previousAuthorizationEpoch: inboxV2AuthorizationEpochSchema,
            resultingAuthorizationEpoch: inboxV2AuthorizationEpochSchema,
            invalidations: z
              .array(inboxV2InvalidationScopeSchema)
              .min(1)
              .max(64),
            authorizationDecisionRefs: z
              .array(inboxV2AuthorizationDecisionReferenceSchema)
              .min(1)
              .max(64)
          })
          .strict()
      )
      .min(1)
      .max(1_000)
  })
  .strict();

export const inboxV2StructuralAudienceImpactSchema = z
  .object({
    kind: z.literal("structural"),
    impactId: inboxV2AudienceImpactIdSchema,
    deliveryFence: z.literal("invalidate_before_payload"),
    previousSharedAccessRevision: inboxV2EntityRevisionSchema,
    resultingSharedAccessRevision: inboxV2EntityRevisionSchema,
    invalidations: z.array(inboxV2InvalidationScopeSchema).min(1).max(1_000),
    indexedFanoutPlanId: inboxV2AudienceImpactIdSchema
  })
  .strict()
  .superRefine((impact, context) => {
    if (
      BigInt(impact.resultingSharedAccessRevision) !==
      BigInt(impact.previousSharedAccessRevision) + 1n
    ) {
      context.addIssue({
        code: "custom",
        path: ["resultingSharedAccessRevision"],
        message:
          "Structural access impact must advance the shared revision once."
      });
    }
  });

/**
 * Tenant-wide RBAC invalidation advances only tenantRbacRevision. It remains a
 * structural/indexed fan-out plan and never enumerates every affected Employee.
 */
export const inboxV2TenantRbacAudienceImpactSchema = z
  .object({
    kind: z.literal("tenant_rbac"),
    impactId: inboxV2AudienceImpactIdSchema,
    deliveryFence: z.literal("invalidate_before_payload"),
    previousTenantRbacRevision: inboxV2EntityRevisionSchema,
    resultingTenantRbacRevision: inboxV2EntityRevisionSchema,
    invalidations: z.array(inboxV2InvalidationScopeSchema).min(1).max(1_000),
    indexedFanoutPlanId: inboxV2AudienceImpactIdSchema
  })
  .strict()
  .superRefine((impact, context) => {
    if (
      BigInt(impact.resultingTenantRbacRevision) !==
      BigInt(impact.previousTenantRbacRevision) + 1n
    ) {
      context.addIssue({
        code: "custom",
        path: ["resultingTenantRbacRevision"],
        message: "Tenant RBAC impact must advance tenantRbacRevision once."
      });
    }
  });

export const inboxV2AudienceImpactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  inboxV2DirectAudienceImpactSchema,
  inboxV2StructuralAudienceImpactSchema,
  inboxV2TenantRbacAudienceImpactSchema
]);

export const inboxV2TenantStreamCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    id: inboxV2TenantStreamCommitIdSchema,
    position: inboxV2TenantStreamCommitPositionSchema,
    schemaVersion: z.literal(INBOX_V2_TENANT_STREAM_SCHEMA_VERSION),
    correlationId: inboxV2CorrelationIdSchema,
    commandIds: z.array(inboxV2CommandIdSchema).max(64),
    clientMutationIds: z.array(inboxV2ClientMutationIdSchema).max(64),
    authorizationDecisionRefs: z
      .array(inboxV2AuthorizationDecisionReferenceSchema)
      .max(64)
      .optional(),
    changeIds: z.array(inboxV2TenantStreamChangeIdSchema).min(1).max(1_000),
    eventIds: z.array(inboxV2EventIdSchema).min(1).max(1_000),
    outboxIntentIds: z.array(inboxV2OutboxIntentIdSchema).max(1_000),
    audienceImpact: inboxV2AudienceImpactSchema,
    committedAt: inboxV2TimestampSchema,
    commitHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((commit, context) => {
    for (const [path, values] of [
      ["commandIds", commit.commandIds],
      ["clientMutationIds", commit.clientMutationIds],
      ["changeIds", commit.changeIds],
      ["eventIds", commit.eventIds],
      ["outboxIntentIds", commit.outboxIntentIds]
    ] as const) {
      if (new Set(values.map(String)).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "Tenant stream commit references must be unique."
        });
      }
    }
    const decisions = commit.authorizationDecisionRefs ?? [];
    if (
      new Set(decisions.map((decision) => decision.id)).size !==
        decisions.length ||
      decisions.some(
        (decision) =>
          decision.tenantId !== commit.tenantId ||
          decision.outcome !== "allowed"
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["authorizationDecisionRefs"],
        message:
          "Command authorization manifest must contain unique allowed decisions from the commit tenant."
      });
    }
  });

export const inboxV2DomainEventSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2EventIdSchema,
    typeId: inboxV2DomainEventTypeIdSchema,
    payloadSchemaId: inboxV2NamespacedIdSchema,
    payloadSchemaVersion: inboxV2SchemaVersionTokenSchema,
    commit: inboxV2TenantStreamCommitReferenceSchema,
    ordinal: inboxV2EntityRevisionSchema,
    changeIds: z.array(inboxV2TenantStreamChangeIdSchema).min(1).max(1_000),
    subjects: z.array(inboxV2EntityKeySchema).min(1).max(1_000),
    payloadReference: inboxV2PayloadReferenceSchema.nullable(),
    correlationId: inboxV2CorrelationIdSchema,
    commandIds: z.array(inboxV2CommandIdSchema).max(64),
    clientMutationIds: z.array(inboxV2ClientMutationIdSchema).max(64),
    authorizationDecisionRefs: z
      .array(inboxV2AuthorizationDecisionReferenceSchema)
      .max(64),
    accessEffect: inboxV2DomainEventAccessEffectSchema,
    occurredAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    eventHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((event, context) => {
    if (
      [
        "core:participant.changed",
        "core:work-item.changed",
        "core:authorization.changed"
      ].includes(event.typeId) &&
      event.accessEffect.kind !== "may_change_access"
    ) {
      context.addIssue({
        code: "custom",
        path: ["accessEffect"],
        message:
          "Participant, WorkItem and authorization events must declare their access-impact fence."
      });
    }
    if (!isInboxV2TimestampOrderValid(event.occurredAt, event.recordedAt)) {
      context.addIssue({
        code: "custom",
        path: ["recordedAt"],
        message: "Domain event cannot be recorded before it occurred."
      });
    }
    if (
      event.payloadReference !== null &&
      (event.payloadReference.tenantId !== event.tenantId ||
        String(event.payloadReference.schemaId) !==
          String(event.payloadSchemaId) ||
        String(event.payloadReference.schemaVersion) !==
          String(event.payloadSchemaVersion))
    ) {
      context.addIssue({
        code: "custom",
        path: ["payloadReference"],
        message:
          "Domain event metadata must identify the exact referenced payload parser."
      });
    }
  });

export const inboxV2OutboxIntentSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2OutboxIntentIdSchema,
    typeId: inboxV2OutboxIntentTypeIdSchema,
    handlerId: inboxV2NamespacedIdSchema,
    effectClass: z.enum([
      "projection",
      "notification",
      "provider_io",
      "search",
      "workflow"
    ]),
    commit: inboxV2TenantStreamCommitReferenceSchema,
    eventId: inboxV2EventIdSchema,
    changeIds: z.array(inboxV2TenantStreamChangeIdSchema).max(1_000),
    payloadReference: inboxV2PayloadReferenceSchema.nullable(),
    consumerDedupeKey: inboxV2Sha256DigestSchema,
    correlationId: inboxV2CorrelationIdSchema,
    availableAt: inboxV2TimestampSchema,
    intentHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      intent.payloadReference !== null &&
      intent.payloadReference.tenantId !== intent.tenantId
    ) {
      context.addIssue({
        code: "custom",
        path: ["payloadReference"],
        message: "Outbox payload reference must belong to the intent tenant."
      });
    }
    if (
      intent.effectClass === "provider_io" &&
      (intent.typeId !== "core:provider.dispatch" ||
        intent.payloadReference === null ||
        String(intent.payloadReference.schemaId) !==
          INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID ||
        intent.payloadReference.schemaVersion !==
          INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION ||
        intent.changeIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Provider I/O requires an explicit dispatch intent, payload reference and owning changes."
      });
    }
  });

export const inboxV2AtomicMutationCommitSchema = z
  .object({
    headBefore: inboxV2TenantStreamHeadSchema,
    commit: inboxV2TenantStreamCommitSchema,
    changes: z.array(inboxV2TenantStreamChangeSchema).min(1).max(1_000),
    events: z.array(inboxV2DomainEventSchema).min(1).max(1_000),
    outboxIntents: z.array(inboxV2OutboxIntentSchema).max(1_000),
    commandRecords: z.array(inboxV2CommandIdempotencyRecordSchema).max(64),
    headAfter: inboxV2TenantStreamHeadSchema
  })
  .strict()
  .superRefine((bundle, context) => {
    const { headBefore, headAfter, commit } = bundle;
    const expectedPosition = BigInt(headBefore.lastPosition) + 1n;
    if (
      headBefore.tenantId !== commit.tenantId ||
      headAfter.tenantId !== commit.tenantId ||
      headBefore.streamEpoch !== commit.streamEpoch ||
      headAfter.streamEpoch !== commit.streamEpoch ||
      BigInt(commit.position) !== expectedPosition ||
      headAfter.lastPosition !== commit.position ||
      headAfter.minRetainedPosition !== headBefore.minRetainedPosition
    ) {
      addIssue(
        context,
        ["commit", "position"],
        "Atomic mutation must append exactly one position under one tenant stream head."
      );
    }

    validateChanges(context, bundle);
    validateCommandRecords(context, bundle);
    validateEvents(context, bundle);
    validateOutboxIntents(context, bundle);
    validateAudienceImpact(context, bundle);
  });

export const inboxV2AtomicMutationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_ATOMIC_MUTATION_COMMIT_SCHEMA_ID,
    INBOX_V2_TENANT_STREAM_SCHEMA_VERSION,
    inboxV2AtomicMutationCommitSchema
  );

export function parseInboxV2AtomicMutationCommitEnvelope(input: unknown) {
  return parseInboxV2VersionedEnvelope({
    value: input,
    schemaId: INBOX_V2_ATOMIC_MUTATION_COMMIT_SCHEMA_ID,
    supportedSchemas: {
      [INBOX_V2_TENANT_STREAM_SCHEMA_VERSION]:
        inboxV2AtomicMutationCommitEnvelopeSchema
    },
    invalidErrorCode: "stream.envelope_invalid",
    unsupportedErrorCode: "stream.schema_unsupported"
  });
}

export const inboxV2ImmutableRecordIdentitySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    recordTypeId: inboxV2NamespacedIdSchema,
    recordId: z.string().min(1).max(512),
    schemaVersion: inboxV2SchemaVersionTokenSchema,
    recordHash: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2ImmutableRecordWriteDecisionSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("insert") }).strict(),
    z.object({ kind: z.literal("duplicate") }).strict(),
    z
      .object({
        kind: z.literal("conflict"),
        errorCode: z.literal("stream.immutable_record_conflict")
      })
      .strict()
  ]
);

export function decideInboxV2ImmutableRecordWrite(input: {
  incoming: z.input<typeof inboxV2ImmutableRecordIdentitySchema>;
  existing: z.input<typeof inboxV2ImmutableRecordIdentitySchema> | null;
}): z.infer<typeof inboxV2ImmutableRecordWriteDecisionSchema> {
  const incoming = inboxV2ImmutableRecordIdentitySchema.parse(input.incoming);
  if (input.existing === null) {
    return { kind: "insert" };
  }
  const existing = inboxV2ImmutableRecordIdentitySchema.parse(input.existing);
  if (
    incoming.tenantId !== existing.tenantId ||
    incoming.recordTypeId !== existing.recordTypeId ||
    incoming.recordId !== existing.recordId
  ) {
    return { kind: "insert" };
  }
  return incoming.schemaVersion === existing.schemaVersion &&
    incoming.recordHash === existing.recordHash
    ? { kind: "duplicate" }
    : {
        kind: "conflict",
        errorCode: "stream.immutable_record_conflict"
      };
}

function validateChanges(
  context: z.RefinementCtx,
  bundle: z.infer<typeof inboxV2AtomicMutationCommitSchema>
): void {
  if (
    !sameValue(
      bundle.commit.changeIds,
      bundle.changes.map((change) => change.reference.changeId)
    )
  ) {
    addIssue(
      context,
      ["changes"],
      "Change rows must exactly match the commit's ordered change manifest."
    );
  }

  for (const [index, change] of bundle.changes.entries()) {
    if (
      change.reference.tenantId !== bundle.commit.tenantId ||
      change.reference.commitId !== bundle.commit.id ||
      change.reference.streamPosition !== bundle.commit.position ||
      BigInt(change.reference.ordinal) !== BigInt(index + 1) ||
      change.entity.tenantId !== bundle.commit.tenantId ||
      change.state.domainCommitReference.tenantId !== bundle.commit.tenantId ||
      (change.state.kind === "upsert" &&
        change.state.payloadReference.tenantId !== bundle.commit.tenantId) ||
      (change.timeline !== null &&
        change.timeline.conversation.tenantId !== bundle.commit.tenantId)
    ) {
      addIssue(
        context,
        ["changes", index],
        "Change must bind the exact tenant, commit, position and contiguous ordinal."
      );
    }
  }
}

function validateEvents(
  context: z.RefinementCtx,
  bundle: z.infer<typeof inboxV2AtomicMutationCommitSchema>
): void {
  if (
    !sameValue(
      bundle.commit.eventIds,
      bundle.events.map((event) => event.id)
    )
  ) {
    addIssue(
      context,
      ["events"],
      "Domain events must exactly match the commit's ordered event manifest."
    );
  }
  const changeIds = new Set(bundle.commit.changeIds);
  const commandEpochs = new Set(
    bundle.commandRecords.flatMap((record) =>
      record.state.kind === "completed"
        ? [record.state.result.authorizationEpoch]
        : []
    )
  );
  const commandPrincipals = new Set(
    bundle.commandRecords.map((record) =>
      JSON.stringify(record.scope.principal)
    )
  );
  const committedAuthorizationDecisions =
    bundle.commit.authorizationDecisionRefs ?? [];
  const coveredChangeIds = new Set<string>();
  for (const [index, event] of bundle.events.entries()) {
    event.changeIds.forEach((changeId) => coveredChangeIds.add(changeId));
    if (
      !sameCommit(event.commit, bundle.commit) ||
      event.tenantId !== bundle.commit.tenantId ||
      BigInt(event.ordinal) !== BigInt(index + 1) ||
      event.changeIds.some((id) => !changeIds.has(id)) ||
      event.subjects.some(
        (subject) => subject.tenantId !== bundle.commit.tenantId
      ) ||
      (event.payloadReference !== null &&
        event.payloadReference.tenantId !== bundle.commit.tenantId) ||
      !sameValue(event.commandIds, bundle.commit.commandIds) ||
      !sameValue(event.clientMutationIds, bundle.commit.clientMutationIds) ||
      event.correlationId !== bundle.commit.correlationId ||
      event.authorizationDecisionRefs.some(
        (decision) =>
          decision.tenantId !== bundle.commit.tenantId ||
          Date.parse(decision.decidedAt) >
            Date.parse(bundle.commit.committedAt) ||
          Date.parse(bundle.commit.committedAt) >=
            Date.parse(decision.notAfter) ||
          (bundle.commit.commandIds.length > 0 &&
            (decision.outcome !== "allowed" ||
              !commandEpochs.has(decision.authorizationEpoch) ||
              !commandPrincipals.has(JSON.stringify(decision.principal))))
      ) ||
      (bundle.commit.commandIds.length > 0 &&
        !sameValue(
          event.authorizationDecisionRefs,
          committedAuthorizationDecisions
        )) ||
      (bundle.commit.commandIds.length > 0 &&
        event.authorizationDecisionRefs.length === 0) ||
      event.recordedAt !== bundle.commit.committedAt
    ) {
      addIssue(
        context,
        ["events", index],
        "Domain event must reference only facts in its exact immutable tenant commit."
      );
    }
  }
  if (
    bundle.commit.changeIds.some((changeId) => !coveredChangeIds.has(changeId))
  ) {
    addIssue(
      context,
      ["events"],
      "Domain events must cover every canonical change in the tenant commit."
    );
  }
}

function validateCommandRecords(
  context: z.RefinementCtx,
  bundle: z.infer<typeof inboxV2AtomicMutationCommitSchema>
): void {
  if (
    !sameValue(
      bundle.commit.commandIds,
      bundle.commandRecords.map((record) => record.commandId)
    ) ||
    bundle.commit.clientMutationIds.length !== bundle.commandRecords.length
  ) {
    addIssue(
      context,
      ["commandRecords"],
      "Every committed command must atomically persist one idempotent result record."
    );
    return;
  }

  const resultMutations: string[] = [];
  const sourceAuthorizationDecisions: z.infer<
    typeof inboxV2AuthorizationDecisionReferenceSchema
  >[] = [];
  for (const [index, record] of bundle.commandRecords.entries()) {
    const state = record.state;
    if (
      record.scope.tenantId !== bundle.commit.tenantId ||
      state.kind !== "completed" ||
      state.result.kind !== "committed" ||
      state.result.tenantId !== bundle.commit.tenantId ||
      state.result.commit.tenantId !== bundle.commit.tenantId ||
      state.result.commit.streamEpoch !== bundle.commit.streamEpoch ||
      state.result.commit.commitId !== bundle.commit.id ||
      state.result.commit.streamPosition !== bundle.commit.position ||
      state.result.recordedAt !== bundle.commit.committedAt ||
      state.authorizationDecisionRefs === undefined ||
      state.authorizedAt === undefined ||
      state.authorizationNotAfter === undefined ||
      Date.parse(state.authorizedAt) > Date.parse(bundle.commit.committedAt) ||
      Date.parse(bundle.commit.committedAt) >=
        Date.parse(state.authorizationNotAfter)
    ) {
      addIssue(
        context,
        ["commandRecords", index],
        "Command record must contain the exact immutable result of this tenant stream commit."
      );
      continue;
    }
    resultMutations.push(state.result.clientMutationId);
    sourceAuthorizationDecisions.push(...state.authorizationDecisionRefs);
  }
  if (!sameValue(resultMutations, bundle.commit.clientMutationIds)) {
    addIssue(
      context,
      ["commandRecords"],
      "Command result mutations must exactly match the commit correlation manifest."
    );
  }
  const uniqueSourceDecisions = [
    ...new Map(
      sourceAuthorizationDecisions.map((decision) => [decision.id, decision])
    ).values()
  ];
  const conflictingSourceDecisionId = sourceAuthorizationDecisions.some(
    (decision, index) =>
      sourceAuthorizationDecisions.some(
        (candidate, candidateIndex) =>
          candidateIndex < index &&
          candidate.id === decision.id &&
          !sameValue(candidate, decision)
      )
  );
  if (
    conflictingSourceDecisionId ||
    !sameValue(
      uniqueSourceDecisions,
      bundle.commit.authorizationDecisionRefs ?? []
    )
  ) {
    addIssue(
      context,
      ["commit", "authorizationDecisionRefs"],
      "Commit authorization manifest must exactly match the authorized command evidence persisted in the same transaction."
    );
  }
}

function validateOutboxIntents(
  context: z.RefinementCtx,
  bundle: z.infer<typeof inboxV2AtomicMutationCommitSchema>
): void {
  if (
    !sameValue(
      bundle.commit.outboxIntentIds,
      bundle.outboxIntents.map((intent) => intent.id)
    )
  ) {
    addIssue(
      context,
      ["outboxIntents"],
      "Outbox intents must exactly match the commit manifest."
    );
  }
  const events = new Set(bundle.events.map((event) => event.id));
  const eventById = new Map(bundle.events.map((event) => [event.id, event]));
  const changes = new Map(
    bundle.changes.map((change) => [change.reference.changeId, change])
  );
  const dedupeKeys = bundle.outboxIntents.map(
    (intent) => `${intent.handlerId}\u0000${intent.consumerDedupeKey}`
  );
  if (new Set(dedupeKeys).size !== dedupeKeys.length) {
    addIssue(
      context,
      ["outboxIntents"],
      "Outbox consumer dedupe keys must be unique per handler in one commit."
    );
  }
  for (const [index, intent] of bundle.outboxIntents.entries()) {
    const referencedChanges = intent.changeIds.map((id) => changes.get(id));
    const owningEvent = eventById.get(intent.eventId);
    const expectedCoreEffectClass = coreOutboxEffectClass(intent.typeId);
    const leaksStaffOnly =
      intent.effectClass === "provider_io" &&
      referencedChanges.some(
        (change) =>
          change === undefined ||
          change.audience === "staff_only" ||
          String(change.entity.entityTypeId) === "core:staff-note"
      );
    const hasPinnedOutboundDispatch =
      intent.effectClass !== "provider_io" ||
      (intent.payloadReference !== null &&
        referencedChanges.some(
          (change) =>
            change !== undefined &&
            String(change.entity.entityTypeId) === "core:outbound-dispatch" &&
            change.state.kind === "upsert" &&
            String(change.state.stateSchemaId) ===
              INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID &&
            sameValue(change.state.payloadReference, intent.payloadReference)
        ));
    if (
      !sameCommit(intent.commit, bundle.commit) ||
      intent.tenantId !== bundle.commit.tenantId ||
      !events.has(intent.eventId) ||
      (expectedCoreEffectClass !== null &&
        intent.effectClass !== expectedCoreEffectClass) ||
      (intent.payloadReference !== null &&
        intent.payloadReference.tenantId !== bundle.commit.tenantId) ||
      intent.correlationId !== bundle.commit.correlationId ||
      owningEvent?.correlationId !== intent.correlationId ||
      intent.changeIds.some(
        (id) => owningEvent === undefined || !owningEvent.changeIds.includes(id)
      ) ||
      intent.changeIds.some((id) => !changes.has(id)) ||
      !isInboxV2TimestampOrderValid(
        bundle.commit.committedAt,
        intent.availableAt
      ) ||
      leaksStaffOnly ||
      !hasPinnedOutboundDispatch
    ) {
      addIssue(
        context,
        ["outboxIntents", index],
        "Outbox intent must be post-commit, fact-bound and cannot dispatch staff-only data."
      );
    }
  }
}

function validateAudienceImpact(
  context: z.RefinementCtx,
  bundle: z.infer<typeof inboxV2AtomicMutationCommitSchema>
): void {
  const impact = bundle.commit.audienceImpact;
  const changesAuthorization = bundle.events.some(
    (event) => event.accessEffect.kind === "may_change_access"
  );
  if (changesAuthorization && impact.kind === "none") {
    addIssue(
      context,
      ["commit", "audienceImpact"],
      "Authorization changes require an atomic old/new audience impact fence."
    );
    return;
  }
  if (impact.kind === "none") {
    return;
  }
  if (impact.kind === "structural" || impact.kind === "tenant_rbac") {
    if (
      impact.invalidations.some(
        (scope) =>
          !invalidationScopeBelongsToTenant(scope, bundle.commit.tenantId)
      )
    ) {
      addIssue(
        context,
        ["commit", "audienceImpact", "invalidations"],
        "Structural audience impact cannot invalidate another tenant."
      );
    }
    return;
  }

  const employeeIds = impact.affectedRecipients.map(
    (recipient) => recipient.employee.id
  );
  if (new Set(employeeIds).size !== employeeIds.length) {
    addIssue(
      context,
      ["commit", "audienceImpact", "affectedRecipients"],
      "Direct audience impact recipients must be unique."
    );
  }
  for (const [index, recipient] of impact.affectedRecipients.entries()) {
    const hasAllowed = recipient.authorizationDecisionRefs.some(
      (decision) => decision.outcome === "allowed"
    );
    const hasDenied = recipient.authorizationDecisionRefs.some(
      (decision) => decision.outcome === "denied"
    );
    const hasRecipientScopePurge = recipient.invalidations.some(
      (scope) => scope.kind === "recipient_scope"
    );
    const invalidRelationEvidence =
      recipient.relation === "previous"
        ? !hasDenied || hasAllowed
        : recipient.relation === "resulting"
          ? !hasAllowed || hasDenied
          : !hasAllowed;
    if (
      recipient.employee.tenantId !== bundle.commit.tenantId ||
      recipient.previousAuthorizationEpoch ===
        recipient.resultingAuthorizationEpoch ||
      recipient.invalidations.some(
        (scope) =>
          !invalidationScopeBelongsToTenant(scope, bundle.commit.tenantId)
      ) ||
      (hasDenied && !hasRecipientScopePurge) ||
      invalidRelationEvidence ||
      recipient.authorizationDecisionRefs.some(
        (decision) =>
          decision.tenantId !== bundle.commit.tenantId ||
          decision.authorizationEpoch !==
            recipient.resultingAuthorizationEpoch ||
          decision.principal.kind !== "employee" ||
          decision.principal.employee.id !== recipient.employee.id ||
          Date.parse(decision.decidedAt) >
            Date.parse(bundle.commit.committedAt) ||
          Date.parse(bundle.commit.committedAt) >= Date.parse(decision.notAfter)
      )
    ) {
      addIssue(
        context,
        ["commit", "audienceImpact", "affectedRecipients", index],
        "Direct audience impact must name bounded tenant recipients and a real epoch transition."
      );
    }
  }
}

function coreOutboxEffectClass(
  typeId: z.infer<typeof inboxV2OutboxIntentTypeIdSchema>
): z.infer<typeof inboxV2OutboxIntentSchema>["effectClass"] | null {
  switch (typeId) {
    case "core:projection.update":
      return "projection";
    case "core:notification.evaluate":
      return "notification";
    case "core:provider.dispatch":
      return "provider_io";
    case "core:search.index":
      return "search";
    case "core:workflow.evaluate":
      return "workflow";
    default:
      return null;
  }
}

function invalidationScopeBelongsToTenant(
  scope: z.infer<typeof inboxV2InvalidationScopeSchema>,
  tenantId: string
): boolean {
  return scope.kind === "conversation"
    ? scope.conversation.tenantId === tenantId
    : scope.kind === "entity"
      ? scope.entity.tenantId === tenantId
      : true;
}

function sameCommit(
  reference: z.infer<typeof inboxV2TenantStreamCommitReferenceSchema>,
  commit: z.infer<typeof inboxV2TenantStreamCommitSchema>
): boolean {
  return (
    reference.tenantId === commit.tenantId &&
    reference.streamEpoch === commit.streamEpoch &&
    reference.commitId === commit.id &&
    reference.streamPosition === commit.position
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

export type InboxV2TenantStreamHead = z.infer<
  typeof inboxV2TenantStreamHeadSchema
>;
export type InboxV2TenantStreamCommit = z.infer<
  typeof inboxV2TenantStreamCommitSchema
>;
export type InboxV2TenantStreamChange = z.infer<
  typeof inboxV2TenantStreamChangeSchema
>;
export type InboxV2DomainEvent = z.infer<typeof inboxV2DomainEventSchema>;
export type InboxV2OutboxIntent = z.infer<typeof inboxV2OutboxIntentSchema>;
export type InboxV2AtomicMutationCommit = z.infer<
  typeof inboxV2AtomicMutationCommitSchema
>;
