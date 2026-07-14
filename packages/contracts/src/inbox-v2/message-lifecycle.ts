import { z } from "zod";

import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import {
  inboxV2ConversationParticipantReferenceSchema,
  inboxV2MessageReferenceSchema,
  inboxV2MessageProviderLifecycleOperationReferenceSchema,
  inboxV2MessageRevisionIdSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemReferenceSchema
} from "./ids";
import { inboxV2MessageReasonIdSchema, inboxV2MessageSchema } from "./message";
import {
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentHeadSchema,
  inboxV2TimelineContentTransitionCommitSchema
} from "./message-content";
import {
  inboxV2MessageProviderLifecycleOperationCreationCommitSchema,
  inboxV2MessageProviderLifecycleOperationSchema
} from "./message-provider-lifecycle";
import { inboxV2ConversationParticipantSchema } from "./participant-identity";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2AppActorSchema,
  inboxV2AutomationCausationSchema,
  inboxV2TimelineItemSchema
} from "./timeline";

export const INBOX_V2_MESSAGE_REVISION_SCHEMA_ID =
  "core:inbox-v2.message-revision" as const;
export const INBOX_V2_MESSAGE_MUTATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.message-mutation-commit" as const;
export const INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2MessageActionAttributionSchema = z
  .object({
    actionParticipant: inboxV2ConversationParticipantReferenceSchema.nullable(),
    appActor: inboxV2AppActorSchema.nullable(),
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema.nullable(),
    automationCausation: inboxV2AutomationCausationSchema.nullable()
  })
  .strict()
  .superRefine((attribution, context) => {
    if (
      attribution.appActor === null &&
      attribution.sourceOccurrence === null
    ) {
      addIssue(
        context,
        ["appActor"],
        "Message action requires Hulee or source occurrence attribution."
      );
    }
    if (
      attribution.appActor !== null &&
      attribution.sourceOccurrence !== null
    ) {
      addIssue(
        context,
        ["sourceOccurrence"],
        "One Message action is either app-authored or provider-observed, never both."
      );
    }
    if (
      attribution.appActor?.kind === "employee" &&
      (attribution.actionParticipant === null ||
        attribution.automationCausation !== null)
    ) {
      addIssue(
        context,
        ["actionParticipant"],
        "Employee action requires its exact participant and no automation causation."
      );
    }
    if (
      attribution.appActor?.kind === "trusted_service" &&
      attribution.automationCausation === null
    ) {
      addIssue(
        context,
        ["automationCausation"],
        "Trusted-service action requires immutable automation causation; any represented participant must be a bot."
      );
    }
    if (
      attribution.sourceOccurrence !== null &&
      attribution.automationCausation !== null
    ) {
      addIssue(
        context,
        ["automationCausation"],
        "Provider-observed action cannot claim Hulee automation causation."
      );
    }
  });

export const inboxV2MessageRevisionChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("created"),
      content: inboxV2TimelineContentHeadSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("edited"),
      beforeContent: inboxV2TimelineContentHeadSchema,
      afterContent: inboxV2TimelineContentHeadSchema,
      providerOperation:
        inboxV2MessageProviderLifecycleOperationReferenceSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal("attachment_materialized"),
      beforeContent: inboxV2TimelineContentHeadSchema,
      afterContent: inboxV2TimelineContentHeadSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("local_delete_tombstone"),
      reasonId: inboxV2MessageReasonIdSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_delete_policy_tombstone"),
      providerOperation:
        inboxV2MessageProviderLifecycleOperationReferenceSchema,
      policyReasonId: inboxV2MessageReasonIdSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("privacy_erasure_tombstone"),
      beforeContent: inboxV2TimelineContentHeadSchema,
      afterContent: inboxV2TimelineContentHeadSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("retention_purge_tombstone"),
      beforeContent: inboxV2TimelineContentHeadSchema,
      afterContent: inboxV2TimelineContentHeadSchema
    })
    .strict()
]);

export const inboxV2MessageRevisionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2MessageRevisionIdSchema,
    message: inboxV2MessageReferenceSchema,
    timelineItem: inboxV2TimelineItemReferenceSchema,
    expectedPreviousRevision: inboxV2EntityRevisionSchema.nullable(),
    messageRevision: inboxV2EntityRevisionSchema,
    change: inboxV2MessageRevisionChangeSchema,
    actionAttribution: inboxV2MessageActionAttributionSchema,
    occurredAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    recordRevision: z.literal("1"),
    createdAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((revision, context) => {
    for (const [field, reference] of [
      ["message", revision.message],
      ["timelineItem", revision.timelineItem]
    ] as const) {
      addTenantReferenceIssue(context, revision.tenantId, reference, [field]);
    }
    addActionAttributionTenantIssues(context, revision.tenantId, revision);
    addChangeTenantIssues(context, revision.tenantId, revision.change);
    if (
      revision.change.kind === "created" &&
      (revision.expectedPreviousRevision !== null ||
        revision.messageRevision !== "1")
    ) {
      addIssue(
        context,
        ["messageRevision"],
        "Created MessageRevision is the first revision without a predecessor."
      );
    }
    if (
      revision.change.kind !== "created" &&
      (revision.expectedPreviousRevision === null ||
        BigInt(revision.messageRevision) !==
          BigInt(revision.expectedPreviousRevision) + 1n)
    ) {
      addIssue(
        context,
        ["messageRevision"],
        "MessageRevision history is append-only and contiguous."
      );
    }
    if (
      Date.parse(revision.recordedAt) < Date.parse(revision.occurredAt) ||
      revision.createdAt !== revision.recordedAt ||
      (revision.actionAttribution.automationCausation !== null &&
        Date.parse(revision.actionAttribution.automationCausation.causedAt) >
          Date.parse(revision.occurredAt))
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Message action is recorded no earlier than it occurred."
      );
    }
  });

export const inboxV2MessageMutationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    beforeMessage: inboxV2MessageSchema,
    beforeTimelineItem: inboxV2TimelineItemSchema,
    contentTransition: inboxV2TimelineContentTransitionCommitSchema.nullable(),
    providerOperation:
      inboxV2MessageProviderLifecycleOperationSchema.nullable(),
    providerOperationCreationCommit:
      inboxV2MessageProviderLifecycleOperationCreationCommitSchema.nullable(),
    actionParticipantSnapshot: inboxV2ConversationParticipantSchema.nullable(),
    revision: inboxV2MessageRevisionSchema,
    afterMessage: inboxV2MessageSchema,
    afterTimelineItem: inboxV2TimelineItemSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const { beforeMessage: before, afterMessage: after, revision } = commit;
    if (
      commit.tenantId !== before.tenantId ||
      commit.tenantId !== after.tenantId ||
      commit.tenantId !== revision.tenantId ||
      before.id !== after.id ||
      before.id !== revision.message.id ||
      before.timelineItem.id !== revision.timelineItem.id ||
      revision.expectedPreviousRevision !== before.revision ||
      revision.messageRevision !== after.revision ||
      BigInt(after.revision) !== BigInt(before.revision) + 1n ||
      after.updatedAt !== revision.recordedAt ||
      Date.parse(revision.recordedAt) < Date.parse(before.updatedAt) ||
      !sameValue(messageImmutableFacts(before), messageImmutableFacts(after))
    ) {
      addIssue(
        context,
        ["afterMessage"],
        "Message mutation advances one exact head while preserving immutable attribution."
      );
    }
    addActionParticipantSnapshotIssues(context, commit);
    addProviderOperationCreationIssues(context, commit);
    addTimelineMutationIssues(context, commit);
    addMessageChangeIssues(context, commit);
  });

export const inboxV2MessageRevisionPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    message: inboxV2MessageReferenceSchema,
    revisions: z.array(inboxV2MessageRevisionSchema).max(200),
    nextCursor: z.string().min(1).max(2_048).nullable()
  })
  .strict()
  .superRefine((page, context) => {
    addTenantReferenceIssue(context, page.tenantId, page.message, ["message"]);
    const ids = new Set<string>();
    let previousRevision = 0n;
    for (const [index, revision] of page.revisions.entries()) {
      const currentRevision = BigInt(revision.messageRevision);
      if (
        revision.tenantId !== page.tenantId ||
        revision.message.id !== page.message.id ||
        ids.has(revision.id) ||
        (index > 0 && currentRevision <= previousRevision)
      ) {
        addIssue(
          context,
          ["revisions", index],
          "Message revision page is bounded, unique and strictly ordered for one exact Message."
        );
      }
      ids.add(revision.id);
      previousRevision = currentRevision;
    }
  });

export const inboxV2MessageRevisionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
    INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
    inboxV2MessageRevisionSchema
  );
export const inboxV2MessageMutationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MESSAGE_MUTATION_COMMIT_SCHEMA_ID,
    INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
    inboxV2MessageMutationCommitSchema
  );

export type InboxV2MessageRevision = z.infer<
  typeof inboxV2MessageRevisionSchema
>;

function addActionParticipantSnapshotIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageMutationCommitSchema>
): void {
  const reference = commit.revision.actionAttribution.actionParticipant;
  const participant = commit.actionParticipantSnapshot;
  if ((reference === null) !== (participant === null)) {
    addIssue(
      context,
      ["actionParticipantSnapshot"],
      "Known Message action participant requires one exact bounded snapshot."
    );
    return;
  }
  if (reference === null || participant === null) {
    return;
  }
  if (
    participant.tenantId !== commit.tenantId ||
    participant.id !== reference.id ||
    participant.conversation.id !== commit.beforeMessage.conversation.id
  ) {
    addIssue(
      context,
      ["actionParticipantSnapshot"],
      "Message action participant must belong to the exact target Conversation."
    );
  }
  const actor = commit.revision.actionAttribution.appActor;
  if (
    actor?.kind === "employee" &&
    (participant.subject.kind !== "employee" ||
      participant.subject.employee.id !== actor.employee.id)
  ) {
    addIssue(
      context,
      ["actionParticipantSnapshot", "subject"],
      "Employee app actor and Message action participant must identify the same Employee."
    );
  }
  if (actor?.kind === "trusted_service" && participant.subject.kind !== "bot") {
    addIssue(
      context,
      ["actionParticipantSnapshot", "subject"],
      "Trusted-service Message action must use an explicit bot participant."
    );
  }
}

function addProviderOperationCreationIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageMutationCommitSchema>
): void {
  const operation = commit.providerOperation;
  const proof = commit.providerOperationCreationCommit;
  if ((operation === null) !== (proof === null)) {
    addIssue(
      context,
      ["providerOperationCreationCommit"],
      "Every consumed provider operation requires its full bounded creation proof."
    );
    return;
  }
  if (operation === null || proof === null) {
    return;
  }
  if (
    proof.tenantId !== commit.tenantId ||
    proof.message.id !== commit.beforeMessage.id ||
    proof.timelineItem.id !== commit.beforeTimelineItem.id ||
    proof.operation.id !== operation.id ||
    !sameValue(
      providerOperationStableIdentity(proof.operation),
      providerOperationStableIdentity(operation)
    )
  ) {
    addIssue(
      context,
      ["providerOperationCreationCommit"],
      "Consumed provider operation must retain the exact identity induced by its creation proof."
    );
    return;
  }

  if (operation.origin !== "provider_observed") {
    return;
  }
  const actor = proof.sourceOccurrence.providerActor;
  const participant = commit.actionParticipantSnapshot;
  if (actor === null && participant !== null) {
    addIssue(
      context,
      ["actionParticipantSnapshot"],
      "Actorless provider evidence cannot be attributed to a Conversation participant."
    );
  }
  if (
    actor?.kind === "source_external_identity" &&
    (participant === null ||
      participant.subject.kind !== "source_external_identity" ||
      participant.subject.sourceExternalIdentity.id !==
        actor.sourceExternalIdentity.id)
  ) {
    addIssue(
      context,
      ["actionParticipantSnapshot"],
      "Known provider actor requires the exact source-identity action participant."
    );
  }
  if (
    actor?.kind === "provider_system" &&
    participant !== null &&
    participant.subject.kind !== "system"
  ) {
    addIssue(
      context,
      ["actionParticipantSnapshot", "subject"],
      "Provider-system action may use only an explicit system participant."
    );
  }
}

function addTimelineMutationIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageMutationCommitSchema>
): void {
  const {
    beforeTimelineItem: before,
    afterTimelineItem: after,
    revision
  } = commit;
  if (
    before.tenantId !== commit.tenantId ||
    after.tenantId !== commit.tenantId ||
    before.id !== after.id ||
    before.id !== commit.beforeMessage.timelineItem.id ||
    after.id !== commit.afterMessage.timelineItem.id ||
    before.conversation.id !== commit.beforeMessage.conversation.id ||
    after.conversation.id !== commit.afterMessage.conversation.id ||
    before.id !== revision.timelineItem.id ||
    before.subject.kind !== "message" ||
    after.subject.kind !== "message" ||
    before.subject.message.id !== commit.beforeMessage.id ||
    after.subject.message.id !== commit.afterMessage.id ||
    before.subject.messageRevision !== commit.beforeMessage.revision ||
    after.subject.messageRevision !== commit.afterMessage.revision ||
    BigInt(after.revision) !== BigInt(before.revision) + 1n ||
    after.updatedAt !== revision.recordedAt ||
    !sameValue(timelineImmutableFacts(before), timelineImmutableFacts(after))
  ) {
    addIssue(
      context,
      ["afterTimelineItem"],
      "Message mutation keeps sequence and advances the same normalized TimelineItem head."
    );
  }
}

function addMessageChangeIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2MessageMutationCommitSchema>
): void {
  const { beforeMessage: before, afterMessage: after, revision } = commit;
  const change = revision.change;
  if (change.kind === "created") {
    addIssue(
      context,
      ["revision", "change"],
      "Created revision belongs to Message creation, not mutation."
    );
    return;
  }
  if (change.kind === "edited") {
    const external =
      before.origin.kind === "source_originated" ||
      before.origin.kind === "hulee_external";
    const operation = commit.providerOperation;
    if (
      before.lifecycle.kind !== "active" ||
      after.lifecycle.kind !== "active" ||
      commit.contentTransition?.transition.kind !== "edit" ||
      !sameValue(change.beforeContent, before.content) ||
      !sameValue(change.afterContent, after.content) ||
      !contentTransitionMatchesHeads(commit) ||
      external !== (operation !== null) ||
      external !== (change.providerOperation !== null) ||
      (operation !== null &&
        (operation.id !== change.providerOperation?.id ||
          operation.message.id !== before.id ||
          operation.action !== "edit" ||
          !providerOperationMatchesAction(operation, revision)))
    ) {
      addIssue(
        context,
        ["revision", "change"],
        "Edit advances exact available content; external edits also pin one provider lifecycle operation."
      );
    }
    return;
  }
  if (change.kind === "attachment_materialized") {
    if (
      before.lifecycle.kind !== "active" ||
      after.lifecycle.kind !== "active" ||
      commit.contentTransition?.transition.kind !==
        "attachment_materialization" ||
      !sameValue(change.beforeContent, before.content) ||
      !sameValue(change.afterContent, after.content) ||
      !contentTransitionMatchesHeads(commit) ||
      commit.providerOperation !== null ||
      commit.providerOperationCreationCommit !== null ||
      revision.actionAttribution.appActor?.kind !== "trusted_service"
    ) {
      addIssue(
        context,
        ["revision", "change"],
        "Attachment materialization is a trusted local content-head transition, never a provider edit."
      );
    }
    return;
  }
  if (change.kind === "local_delete_tombstone") {
    if (
      before.lifecycle.kind !== "active" ||
      after.lifecycle.kind !== "local_delete_tombstone" ||
      after.lifecycle.revision.id !== revision.id ||
      after.lifecycle.reasonId !== change.reasonId ||
      after.lifecycle.deletedAt !== revision.recordedAt ||
      revision.actionAttribution.appActor === null ||
      commit.contentTransition !== null ||
      commit.providerOperation !== null ||
      !sameValue(before.content, after.content)
    ) {
      addIssue(
        context,
        ["afterMessage", "lifecycle"],
        "Local delete creates its own app-authored tombstone without purging content."
      );
    }
    return;
  }
  if (change.kind === "provider_delete_policy_tombstone") {
    const operation = commit.providerOperation;
    if (
      before.lifecycle.kind !== "active" ||
      after.lifecycle.kind !== "provider_delete_tombstone" ||
      after.lifecycle.revision.id !== revision.id ||
      operation === null ||
      operation.id !== change.providerOperation.id ||
      operation.id !== after.lifecycle.providerOperation.id ||
      after.lifecycle.policyReasonId !== change.policyReasonId ||
      operation.message.id !== before.id ||
      operation.action !== "delete" ||
      !providerOperationMatchesAction(operation, revision) ||
      operation.deleteLocalPolicy?.effect !== "tombstone_local" ||
      Date.parse(operation.deleteLocalPolicy.decidedAt) >
        Date.parse(revision.recordedAt) ||
      after.lifecycle.appliedAt !== revision.recordedAt ||
      commit.contentTransition !== null ||
      !sameValue(before.content, after.content)
    ) {
      addIssue(
        context,
        ["afterMessage", "lifecycle"],
        "Provider delete changes local visibility only through an explicit policy tombstone."
      );
    }
    return;
  }
  const expectedTransition =
    change.kind === "privacy_erasure_tombstone"
      ? "privacy_erasure"
      : "retention_purge";
  if (
    commit.providerOperation !== null ||
    commit.contentTransition?.transition.kind !== expectedTransition ||
    !sameValue(change.beforeContent, before.content) ||
    !sameValue(change.afterContent, after.content) ||
    !sameValue(before.lifecycle, after.lifecycle) ||
    !contentTransitionMatchesHeads(commit) ||
    revision.actionAttribution.appActor?.kind !== "trusted_service"
  ) {
    addIssue(
      context,
      ["revision", "change"],
      "Privacy erasure and retention purge are distinct trusted content tombstones."
    );
  }
}

function contentTransitionMatchesHeads(
  commit: z.infer<typeof inboxV2MessageMutationCommitSchema>
): boolean {
  const transition = commit.contentTransition;
  return (
    transition !== null &&
    sameValue(
      commit.beforeMessage.content,
      inboxV2TimelineContentHeadOf(transition.before)
    ) &&
    sameValue(
      commit.afterMessage.content,
      inboxV2TimelineContentHeadOf(transition.after)
    )
  );
}

function providerOperationMatchesAction(
  operation: z.infer<typeof inboxV2MessageProviderLifecycleOperationSchema>,
  revision: z.infer<typeof inboxV2MessageRevisionSchema>
): boolean {
  if (operation.origin === "provider_observed") {
    return (
      revision.actionAttribution.appActor === null &&
      revision.actionAttribution.sourceOccurrence?.id ===
        operation.sourceOccurrence.id &&
      revision.actionAttribution.automationCausation === null
    );
  }
  return sameValue(revision.actionAttribution, {
    actionParticipant: operation.actionParticipant,
    appActor: operation.appActor,
    sourceOccurrence: null,
    automationCausation: operation.automationCausation
  });
}

function messageImmutableFacts(
  message: z.infer<typeof inboxV2MessageSchema>
): unknown {
  const {
    content: _content,
    lifecycle: _lifecycle,
    revision: _revision,
    updatedAt: _updatedAt,
    ...facts
  } = message;
  return facts;
}

function timelineImmutableFacts(
  item: z.infer<typeof inboxV2TimelineItemSchema>
): unknown {
  const {
    subject: _subject,
    revision: _revision,
    updatedAt: _updatedAt,
    ...facts
  } = item;
  return facts;
}

function addActionAttributionTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  revision: z.infer<typeof inboxV2MessageRevisionSchema>
): void {
  const attribution = revision.actionAttribution;
  if (attribution.actionParticipant !== null) {
    addTenantReferenceIssue(context, tenantId, attribution.actionParticipant, [
      "actionAttribution",
      "actionParticipant"
    ]);
  }
  if (attribution.appActor?.kind === "employee") {
    addTenantReferenceIssue(context, tenantId, attribution.appActor.employee, [
      "actionAttribution",
      "appActor",
      "employee"
    ]);
  }
  if (attribution.sourceOccurrence !== null) {
    addTenantReferenceIssue(context, tenantId, attribution.sourceOccurrence, [
      "actionAttribution",
      "sourceOccurrence"
    ]);
  }
  const causation = attribution.automationCausation;
  if (causation !== null) {
    addTenantReferenceIssue(context, tenantId, causation.causeEvent, [
      "actionAttribution",
      "automationCausation",
      "causeEvent"
    ]);
    if (causation.kind === "employee_command") {
      addTenantReferenceIssue(
        context,
        tenantId,
        causation.initiatingActor.employee,
        [
          "actionAttribution",
          "automationCausation",
          "initiatingActor",
          "employee"
        ]
      );
    }
  }
}

function providerOperationStableIdentity(
  operation: z.infer<typeof inboxV2MessageProviderLifecycleOperationSchema>
): unknown {
  const {
    outcome: _outcome,
    deleteLocalPolicy: _deleteLocalPolicy,
    revision: _revision,
    updatedAt: _updatedAt,
    ...identity
  } = operation;
  return identity;
}

function addChangeTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  change: z.infer<typeof inboxV2MessageRevisionChangeSchema>
): void {
  if ("content" in change) {
    addTenantReferenceIssue(context, tenantId, change.content.content, [
      "change",
      "content"
    ]);
  }
  if ("beforeContent" in change) {
    addTenantReferenceIssue(context, tenantId, change.beforeContent.content, [
      "change",
      "beforeContent"
    ]);
    addTenantReferenceIssue(context, tenantId, change.afterContent.content, [
      "change",
      "afterContent"
    ]);
  }
  if (change.kind === "edited" && change.providerOperation !== null) {
    addTenantReferenceIssue(context, tenantId, change.providerOperation, [
      "change",
      "providerOperation"
    ]);
  }
  if (change.kind === "provider_delete_policy_tombstone") {
    addTenantReferenceIssue(context, tenantId, change.providerOperation, [
      "change",
      "providerOperation"
    ]);
  }
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "Message lifecycle references must share one tenant."
    );
  }
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
