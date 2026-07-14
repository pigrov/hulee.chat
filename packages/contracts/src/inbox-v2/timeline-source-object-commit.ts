import { z } from "zod";

import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2SourceIdentityClaimReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  inboxV2ConversationParticipantSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceIdentityClaimSchema,
  inboxV2SourceIdentityClaimTargetSchema
} from "./participant-identity";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SourceCapabilityIdSchema
} from "./source-routing-primitives";
import {
  inboxV2SourceObjectDescriptorSchema,
  inboxV2TimelineItemKindIdSchema
} from "./timeline";
import { inboxV2TimelineSequenceAllocationSchema } from "./timeline-sequence-allocation";

export const INBOX_V2_SOURCE_OBJECT_INDUCTION_PROOF_SCHEMA_ID =
  "core:inbox-v2.source-object-induction-proof" as const;
export const INBOX_V2_SOURCE_OBJECT_TIMELINE_CREATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.source-object-timeline-creation-commit" as const;
export const INBOX_V2_TIMELINE_SOURCE_OBJECT_COMMIT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2SourceObjectTimelineSemanticSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("call") }).strict(),
    z.object({ kind: z.literal("review") }).strict(),
    z
      .object({
        kind: z.literal("module_event"),
        itemKindId: inboxV2TimelineItemKindIdSchema
      })
      .strict()
  ]
);

export const inboxV2SourceIdentityResolutionAtOccurrenceSchema =
  z.discriminatedUnion("state", [
    z.object({ state: z.literal("unresolved") }).strict(),
    z.object({ state: z.literal("conflicted") }).strict(),
    z
      .object({
        state: z.literal("claimed"),
        claim: inboxV2SourceIdentityClaimReferenceSchema,
        claimVersion: inboxV2EntityRevisionSchema,
        target: inboxV2SourceIdentityClaimTargetSchema
      })
      .strict()
  ]);

/**
 * Trusted source-adapter induction for one non-chat source object. Raw payload
 * remains in the source intake store; this proof pins the exact normalized
 * event, adapter declaration, source scope, canonical object version and
 * event-time actor resolution used by the Timeline materializer.
 */
export const inboxV2SourceObjectInductionProofSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    sourceObject: inboxV2SourceObjectDescriptorSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema.nullable(),
    sourceIdentitySnapshot: inboxV2SourceExternalIdentitySchema.nullable(),
    identityResolutionAtOccurrence:
      inboxV2SourceIdentityResolutionAtOccurrenceSchema.nullable(),
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    capabilityId: inboxV2SourceCapabilityIdSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    semantic: inboxV2SourceObjectTimelineSemanticSchema,
    declaredByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    proofToken: inboxV2RoutingTokenSchema,
    occurredAt: inboxV2TimestampSchema,
    receivedAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    revision: z.literal("1")
  })
  .strict()
  .superRefine((proof, context) => {
    addTenantReferenceIssue(
      context,
      proof.tenantId,
      proof.sourceObject.sourceObject,
      ["sourceObject", "sourceObject"]
    );
    addTenantReferenceIssue(context, proof.tenantId, proof.sourceConnection, [
      "sourceConnection"
    ]);
    if (proof.sourceAccount !== null) {
      addTenantReferenceIssue(context, proof.tenantId, proof.sourceAccount, [
        "sourceAccount"
      ]);
    }
    if (proof.sourceObject.normalizedSourceEvent === null) {
      addIssue(
        context,
        ["sourceObject", "normalizedSourceEvent"],
        "A live source-object induction requires one exact normalized source event."
      );
    } else {
      addTenantReferenceIssue(
        context,
        proof.tenantId,
        proof.sourceObject.normalizedSourceEvent,
        ["sourceObject", "normalizedSourceEvent"]
      );
    }
    if (
      proof.declaredByTrustedServiceId !==
        proof.adapterContract.loadedByTrustedServiceId ||
      Date.parse(proof.adapterContract.loadedAt) > Date.parse(proof.recordedAt)
    ) {
      addIssue(
        context,
        ["declaredByTrustedServiceId"],
        "Source-object induction must be stamped by the pinned adapter runtime."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(proof.occurredAt, proof.receivedAt) ||
      !isInboxV2TimestampOrderValid(proof.receivedAt, proof.recordedAt)
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "Source-object event time, receipt time and commit time must be monotonic."
      );
    }
    addSourceIdentitySnapshotIssues(context, proof);
  });

/**
 * Owning creation boundary for call, review and module-event TimelineItems.
 * The generic sequence allocator stays internal; a source adapter can allocate
 * a row only through this exact participant/source induction proof.
 */
export const inboxV2SourceObjectTimelineCreationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    timelineAllocation: inboxV2TimelineSequenceAllocationSchema,
    inductionProof: inboxV2SourceObjectInductionProofSchema,
    actorParticipantSnapshot: inboxV2ConversationParticipantSchema.nullable(),
    claimAtOccurrenceSnapshot: inboxV2SourceIdentityClaimSchema.nullable()
  })
  .strict()
  .superRefine((commit, context) => {
    const { timelineAllocation, inductionProof: proof } = commit;
    const item = timelineAllocation.items[0];
    if (
      commit.tenantId !== timelineAllocation.tenantId ||
      commit.tenantId !== proof.tenantId ||
      timelineAllocation.items.length !== 1 ||
      item === undefined ||
      (item.subject.kind !== "call" &&
        item.subject.kind !== "review" &&
        item.subject.kind !== "module_event") ||
      item.tenantId !== commit.tenantId ||
      item.conversation.id !== timelineAllocation.conversationAfter.id ||
      !sameValue(item.subject.source, proof.sourceObject) ||
      !sameSemantic(item.subject, proof.semantic) ||
      item.visibility !== "source_item_policy" ||
      item.activity.kind !== "eligible" ||
      item.revision !== "1" ||
      item.occurredAt !== proof.occurredAt ||
      item.receivedAt !== proof.receivedAt ||
      item.createdAt !== proof.recordedAt ||
      item.updatedAt !== proof.recordedAt ||
      timelineAllocation.committedAt !== proof.recordedAt
    ) {
      addIssue(
        context,
        ["timelineAllocation"],
        "Source-object creation binds one exact typed TimelineItem, source proof and sequence allocation."
      );
      return;
    }
    addSourceActorIssues(context, commit, item);
    addClaimAtOccurrenceIssues(context, commit);
  });

export const inboxV2SourceObjectInductionProofEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_OBJECT_INDUCTION_PROOF_SCHEMA_ID,
    INBOX_V2_TIMELINE_SOURCE_OBJECT_COMMIT_SCHEMA_VERSION,
    inboxV2SourceObjectInductionProofSchema
  );

export const inboxV2SourceObjectTimelineCreationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_OBJECT_TIMELINE_CREATION_COMMIT_SCHEMA_ID,
    INBOX_V2_TIMELINE_SOURCE_OBJECT_COMMIT_SCHEMA_VERSION,
    inboxV2SourceObjectTimelineCreationCommitSchema
  );

export type InboxV2SourceObjectTimelineSemantic = z.infer<
  typeof inboxV2SourceObjectTimelineSemanticSchema
>;
export type InboxV2SourceIdentityResolutionAtOccurrence = z.infer<
  typeof inboxV2SourceIdentityResolutionAtOccurrenceSchema
>;
export type InboxV2SourceObjectInductionProof = z.infer<
  typeof inboxV2SourceObjectInductionProofSchema
>;
export type InboxV2SourceObjectTimelineCreationCommit = z.infer<
  typeof inboxV2SourceObjectTimelineCreationCommitSchema
>;

type SourceObjectCommit = z.infer<
  typeof inboxV2SourceObjectTimelineCreationCommitSchema
>;
type SourceObjectProof = z.infer<
  typeof inboxV2SourceObjectInductionProofSchema
>;

function addSourceIdentitySnapshotIssues(
  context: z.RefinementCtx,
  proof: SourceObjectProof
): void {
  const identity = proof.sourceIdentitySnapshot;
  const resolution = proof.identityResolutionAtOccurrence;
  if ((identity === null) !== (resolution === null)) {
    addIssue(
      context,
      ["identityResolutionAtOccurrence"],
      "A source actor snapshot and its event-time resolution are supplied together."
    );
    return;
  }
  if (identity === null || resolution === null) {
    return;
  }
  if (
    identity.tenantId !== proof.tenantId ||
    Date.parse(identity.createdAt) > Date.parse(proof.occurredAt)
  ) {
    addIssue(
      context,
      ["sourceIdentitySnapshot"],
      "Source actor must be a same-tenant identity that existed at event time."
    );
  }
  if (
    identity.scope.kind === "source_connection" &&
    identity.scope.owner.id !== proof.sourceConnection.id
  ) {
    addIssue(
      context,
      ["sourceIdentitySnapshot", "scope"],
      "Connection-scoped source identity must belong to the inducing connection."
    );
  }
  if (
    identity.scope.kind === "source_account" &&
    (proof.sourceAccount === null ||
      identity.scope.owner.id !== proof.sourceAccount.id)
  ) {
    addIssue(
      context,
      ["sourceIdentitySnapshot", "scope"],
      "Account-scoped source identity requires the exact inducing SourceAccount."
    );
  }
  if (
    identity.stability.kind === "observation_ephemeral" &&
    (identity.stability.observation.kind !== "normalized_inbound_event" ||
      identity.stability.observation.id !==
        proof.sourceObject.normalizedSourceEvent?.id)
  ) {
    addIssue(
      context,
      ["sourceIdentitySnapshot", "stability"],
      "Ephemeral source identity must be induced by the exact normalized event."
    );
  }
}

function addSourceActorIssues(
  context: z.RefinementCtx,
  commit: SourceObjectCommit,
  item: SourceObjectCommit["timelineAllocation"]["items"][number]
): void {
  if (
    item.subject.kind !== "call" &&
    item.subject.kind !== "review" &&
    item.subject.kind !== "module_event"
  ) {
    return;
  }
  const actorReference =
    item.subject.kind === "review"
      ? item.subject.authorParticipant
      : item.subject.actorParticipant;
  const participant = commit.actorParticipantSnapshot;
  const identity = commit.inductionProof.sourceIdentitySnapshot;
  if (
    (actorReference === null) !== (participant === null) ||
    (participant === null) !== (identity === null)
  ) {
    addIssue(
      context,
      ["actorParticipantSnapshot"],
      "A typed source actor requires one exact participant and source-identity snapshot."
    );
    return;
  }
  if (actorReference === null || participant === null || identity === null) {
    return;
  }
  if (
    participant.tenantId !== commit.tenantId ||
    participant.id !== actorReference.id ||
    participant.conversation.id !== item.conversation.id ||
    participant.subject.kind !== "source_external_identity" ||
    participant.subject.sourceExternalIdentity.id !== identity.id
  ) {
    addIssue(
      context,
      ["actorParticipantSnapshot"],
      "Timeline source actor must be the exact immutable Conversation participant for the proven source identity."
    );
  }
}

function addClaimAtOccurrenceIssues(
  context: z.RefinementCtx,
  commit: SourceObjectCommit
): void {
  const resolution = commit.inductionProof.identityResolutionAtOccurrence;
  const claim = commit.claimAtOccurrenceSnapshot;
  if ((resolution?.state === "claimed") !== (claim !== null)) {
    addIssue(
      context,
      ["claimAtOccurrenceSnapshot"],
      "Claimed event-time resolution requires one full immutable claim snapshot."
    );
    return;
  }
  if (resolution?.state !== "claimed" || claim === null) {
    return;
  }
  const identity = commit.inductionProof.sourceIdentitySnapshot;
  const targetReference =
    resolution.target.kind === "employee"
      ? resolution.target.employee
      : resolution.target.clientContact;
  addTenantReferenceIssue(context, commit.tenantId, resolution.claim, [
    "inductionProof",
    "identityResolutionAtOccurrence",
    "claim"
  ]);
  addTenantReferenceIssue(context, commit.tenantId, targetReference, [
    "inductionProof",
    "identityResolutionAtOccurrence",
    "target"
  ]);
  const effectiveAtOccurrence =
    Date.parse(claim.createdAt) <=
      Date.parse(commit.inductionProof.occurredAt) &&
    (claim.revocation === null ||
      Date.parse(claim.revocation.revokedAt) >
        Date.parse(commit.inductionProof.occurredAt));
  if (
    identity === null ||
    claim.tenantId !== commit.tenantId ||
    claim.id !== resolution.claim.id ||
    String(claim.claimVersion) !== String(resolution.claimVersion) ||
    claim.sourceExternalIdentity.id !== identity.id ||
    !sameValue(claim.target, resolution.target) ||
    !effectiveAtOccurrence
  ) {
    addIssue(
      context,
      ["claimAtOccurrenceSnapshot"],
      "Claim snapshot must prove the exact source identity, target and version effective at source-object event time."
    );
  }
}

function sameSemantic(
  subject: SourceObjectCommit["timelineAllocation"]["items"][number]["subject"],
  semantic: SourceObjectProof["semantic"]
): boolean {
  if (
    subject.kind !== "call" &&
    subject.kind !== "review" &&
    subject.kind !== "module_event"
  ) {
    return false;
  }
  if (subject.kind !== semantic.kind) {
    return false;
  }
  return (
    subject.kind !== "module_event" ||
    (semantic.kind === "module_event" &&
      subject.itemKindId === semantic.itemKindId)
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
      "Referenced entity must belong to the same tenant."
    );
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
