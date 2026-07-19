import { z } from "zod";

import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import {
  inboxV2ConversationParticipantReferenceSchema,
  inboxV2ConversationReferenceSchema,
  inboxV2ConversationWorkItemSlotReferenceSchema,
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2FileReferenceSchema,
  inboxV2FileVersionReferenceSchema,
  inboxV2MessageAttachmentReferenceSchema,
  inboxV2MessageReactionReferenceSchema,
  inboxV2MessageReferenceSchema,
  inboxV2OutboundRouteReferenceSchema,
  inboxV2ObjectVersionReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2StaffNoteReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemCollaboratorEpisodeReferenceSchema,
  inboxV2WorkItemPrimaryAssignmentReferenceSchema,
  inboxV2WorkItemReferenceSchema
} from "./ids";
import {
  inboxV2MessageReferenceContextSchema,
  type InboxV2MessageReferenceContext
} from "./message";
import {
  inboxV2ContentBlockKeySchema,
  inboxV2TimelineContentDraftSchema
} from "./message-content";
import { inboxV2ReactionValueSchema } from "./message-reaction";
import { inboxV2SourceThreadBindingFenceSchema } from "./source-thread-binding";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2AppActorSchema,
  inboxV2AutomationCausationSchema,
  inboxV2EmployeeAppActorSchema
} from "./timeline";

export const INBOX_V2_TIMELINE_COMMAND_INTENT_SCHEMA_ID =
  "core:inbox-v2.timeline-command-intent" as const;
export const INBOX_V2_TIMELINE_COMMAND_INTENT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

const authoredFields = {
  tenantId: inboxV2TenantIdSchema,
  conversation: inboxV2ConversationReferenceSchema,
  authorParticipant: inboxV2ConversationParticipantReferenceSchema,
  appActor: inboxV2AppActorSchema,
  automationCausation: inboxV2AutomationCausationSchema.nullable(),
  occurredAt: inboxV2TimestampSchema
} as const;

/** Exact canonical route/account/binding fence loaded by the trusted resolver. */
export const inboxV2TimelineRouteAuthorizationProofSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    outboundRoute: inboxV2OutboundRouteReferenceSchema,
    routeRevision: inboxV2EntityRevisionSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    bindingFence: inboxV2SourceThreadBindingFenceSchema
  })
  .strict();

export const inboxV2TimelineFileSourceParentSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("upload_staging"),
        appActor: inboxV2AppActorSchema,
        uploadRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("message"),
        conversation: inboxV2ConversationReferenceSchema,
        message: inboxV2MessageReferenceSchema,
        expectedMessageRevision: inboxV2EntityRevisionSchema,
        visibilityBoundary: z.enum(["external_work", "internal"])
      })
      .strict(),
    z
      .object({
        kind: z.literal("staff_note"),
        conversation: inboxV2ConversationReferenceSchema,
        staffNote: inboxV2StaffNoteReferenceSchema,
        expectedStaffNoteRevision: inboxV2EntityRevisionSchema,
        parentConversationVisibility: z.enum(["external_work", "internal"]),
        visibilityBoundary: z.literal("staff_note")
      })
      .strict()
  ]
);

const fileReadProofBase = {
  blockKey: inboxV2ContentBlockKeySchema,
  file: inboxV2FileReferenceSchema,
  expectedFileRevision: inboxV2EntityRevisionSchema,
  fileVersion: inboxV2FileVersionReferenceSchema,
  objectVersion: inboxV2ObjectVersionReferenceSchema,
  parentConversation: inboxV2ConversationReferenceSchema,
  visibilityBoundary: z.enum(["external_work", "internal", "staff_note"]),
  sourceParent: inboxV2TimelineFileSourceParentSchema
} as const;

/** Existing ready file authority is conjunctive with source and destination visibility. */
export const inboxV2TimelineFileReadProofSchema = z.discriminatedUnion(
  "purpose",
  [
    z
      .object({
        ...fileReadProofBase,
        purpose: z.literal("attachment"),
        attachment: inboxV2MessageAttachmentReferenceSchema
      })
      .strict(),
    z
      .object({
        ...fileReadProofBase,
        purpose: z.literal("extension_payload")
      })
      .strict()
  ]
);

const fileReadProofFields = {
  fileReadProofs: z
    .array(inboxV2TimelineFileReadProofSchema)
    .min(1)
    .max(64)
    .optional()
} as const;

export const inboxV2ExternalReplyAuthoritySchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("active_primary_responsible"),
        appActor: inboxV2EmployeeAppActorSchema,
        conversation: inboxV2ConversationReferenceSchema,
        workItem: inboxV2WorkItemReferenceSchema,
        expectedWorkItemRevision: inboxV2EntityRevisionSchema,
        primaryAssignment: inboxV2WorkItemPrimaryAssignmentReferenceSchema,
        expectedAssignmentRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("active_allowed_collaborator"),
        appActor: inboxV2EmployeeAppActorSchema,
        conversation: inboxV2ConversationReferenceSchema,
        workItem: inboxV2WorkItemReferenceSchema,
        expectedWorkItemRevision: inboxV2EntityRevisionSchema,
        collaboratorEpisode: inboxV2WorkItemCollaboratorEpisodeReferenceSchema,
        expectedCollaboratorRevision: inboxV2EntityRevisionSchema,
        queueReplyPolicyRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("no_work_item"),
        appActor: inboxV2AppActorSchema,
        conversation: inboxV2ConversationReferenceSchema,
        workItemSlot: inboxV2ConversationWorkItemSlotReferenceSchema,
        expectedSlotRevision: inboxV2EntityRevisionSchema,
        intakeDecisionRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("supervisor_override"),
        appActor: inboxV2EmployeeAppActorSchema,
        conversation: inboxV2ConversationReferenceSchema,
        workItem: inboxV2WorkItemReferenceSchema,
        expectedWorkItemRevision: inboxV2EntityRevisionSchema,
        reasonId: z.string().trim().min(1).max(256)
      })
      .strict()
  ]
);

export const inboxV2ProviderNativeForwardSourceReadProofSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceThreadBinding: inboxV2SourceThreadBindingReferenceSchema,
    bindingFence: inboxV2SourceThreadBindingFenceSchema,
    expectedSourceOccurrenceRevision: inboxV2EntityRevisionSchema,
    visibilityBoundary: z.literal("external_work")
  })
  .strict();

export const inboxV2MessageMutationAuthoritySchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("own"),
        appActor: inboxV2AppActorSchema,
        conversation: inboxV2ConversationReferenceSchema,
        message: inboxV2MessageReferenceSchema,
        authorParticipant: inboxV2ConversationParticipantReferenceSchema,
        expectedAuthorshipRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("moderate_external"),
        appActor: inboxV2EmployeeAppActorSchema,
        conversation: inboxV2ConversationReferenceSchema,
        message: inboxV2MessageReferenceSchema,
        reasonId: z.string().trim().min(1).max(256)
      })
      .strict(),
    z
      .object({
        kind: z.literal("moderate_internal"),
        appActor: inboxV2EmployeeAppActorSchema,
        conversation: inboxV2ConversationReferenceSchema,
        message: inboxV2MessageReferenceSchema,
        reasonId: z.string().trim().min(1).max(256)
      })
      .strict()
  ]
);

export const inboxV2StaffNoteReadProofSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    staffNote: inboxV2StaffNoteReferenceSchema,
    expectedStaffNoteRevision: inboxV2EntityRevisionSchema,
    parentConversationVisibility: z.enum(["external_work", "internal"])
  })
  .strict();

export const inboxV2ReactionTargetProofSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    reaction: inboxV2MessageReactionReferenceSchema,
    message: inboxV2MessageReferenceSchema,
    expectedMessageRevision: inboxV2EntityRevisionSchema,
    ownerParticipant: inboxV2ConversationParticipantReferenceSchema
  })
  .strict();

const externalReferenceFields = {
  externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
  sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
  outboundRoute: inboxV2OutboundRouteReferenceSchema,
  routeAuthorization: inboxV2TimelineRouteAuthorizationProofSchema.optional()
} as const;

const externalSendSchema = z
  .object({
    kind: z.literal("send_external"),
    ...authoredFields,
    content: inboxV2TimelineContentDraftSchema,
    outboundRoute: inboxV2OutboundRouteReferenceSchema,
    routeAuthorization: inboxV2TimelineRouteAuthorizationProofSchema.optional(),
    replyAuthority: inboxV2ExternalReplyAuthoritySchema.optional(),
    ...fileReadProofFields,
    referenceContext: inboxV2MessageReferenceContextSchema
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.referenceContext.kind !== "none") {
      addIssue(
        context,
        ["referenceContext"],
        "Generic external send has no reply/forward semantics; dedicated intents carry that authority."
      );
    }
    addRouteAuthorizationProofIssues(
      context,
      intent.conversation,
      intent.outboundRoute,
      intent.routeAuthorization,
      ["routeAuthorization"]
    );
    addReplyAuthorityIssues(context, intent);
    addContentFileReadProofIssues(
      context,
      intent.content,
      intent.fileReadProofs,
      intent.conversation,
      intent.appActor,
      "external_work"
    );
    addOutboundDraftIssues(context, intent.content);
  });

const externalReplySchema = z
  .object({
    kind: z.literal("reply_external"),
    ...authoredFields,
    content: inboxV2TimelineContentDraftSchema,
    ...externalReferenceFields,
    replyAuthority: inboxV2ExternalReplyAuthoritySchema.optional(),
    ...fileReadProofFields,
    referenceContext: inboxV2MessageReferenceContextSchema
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      intent.referenceContext.kind !== "reply" ||
      intent.referenceContext.target.state !== "resolved_external" ||
      intent.referenceContext.target.external.externalMessageReference.id !==
        intent.externalMessageReference.id ||
      intent.referenceContext.target.external.sourceOccurrence.id !==
        intent.sourceOccurrence.id
    ) {
      addIssue(
        context,
        ["referenceContext"],
        "External reply pins one exact resolved occurrence/reference."
      );
    }
    addRouteAuthorizationProofIssues(
      context,
      intent.conversation,
      intent.outboundRoute,
      intent.routeAuthorization,
      ["routeAuthorization"]
    );
    addReplyAuthorityIssues(context, intent);
    addContentFileReadProofIssues(
      context,
      intent.content,
      intent.fileReadProofs,
      intent.conversation,
      intent.appActor,
      "external_work"
    );
    addOutboundDraftIssues(context, intent.content);
  });

const internalSendSchema = z
  .object({
    kind: z.literal("send_internal"),
    ...authoredFields,
    content: inboxV2TimelineContentDraftSchema,
    ...fileReadProofFields,
    referenceContext: inboxV2MessageReferenceContextSchema
  })
  .strict()
  .superRefine((intent, context) => {
    if (!isInternalReferenceContext(intent.referenceContext)) {
      addIssue(
        context,
        ["referenceContext"],
        "Internal send cannot contain provider reply/forward authority."
      );
    }
    addContentFileReadProofIssues(
      context,
      intent.content,
      intent.fileReadProofs,
      intent.conversation,
      intent.appActor,
      "internal"
    );
    addOutboundDraftIssues(context, intent.content, false);
  });

const createStaffNoteSchema = z
  .object({
    kind: z.literal("create_staff_note"),
    ...authoredFields,
    content: inboxV2TimelineContentDraftSchema,
    parentConversationVisibility: z
      .enum(["external_work", "internal"])
      .optional(),
    ...fileReadProofFields
  })
  .strict()
  .superRefine((intent, context) => {
    addContentFileReadProofIssues(
      context,
      intent.content,
      intent.fileReadProofs,
      intent.conversation,
      intent.appActor,
      "staff_note"
    );
    addOutboundDraftIssues(context, intent.content, false);
  });

const readStaffNoteSchema = z
  .object({
    kind: z.literal("read_staff_note"),
    tenantId: inboxV2TenantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    staffNote: inboxV2StaffNoteReferenceSchema,
    readProof: inboxV2StaffNoteReadProofSchema.optional(),
    reader: inboxV2EmployeeAppActorSchema,
    readAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      intent.readProof !== undefined &&
      (intent.readProof.conversation.tenantId !==
        intent.conversation.tenantId ||
        intent.readProof.conversation.id !== intent.conversation.id ||
        intent.readProof.staffNote.tenantId !== intent.staffNote.tenantId ||
        intent.readProof.staffNote.id !== intent.staffNote.id)
    ) {
      addIssue(
        context,
        ["readProof"],
        "Staff-note read proof must pin the exact Note-to-Conversation relation and revision."
      );
    }
  });

const editMessageSchema = z
  .object({
    kind: z.literal("edit_message"),
    ...authoredFields,
    message: inboxV2MessageReferenceSchema,
    expectedMessageRevision: inboxV2EntityRevisionSchema,
    mutationAuthority: inboxV2MessageMutationAuthoritySchema.optional(),
    content: inboxV2TimelineContentDraftSchema,
    ...fileReadProofFields,
    transport: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("internal") }).strict(),
      z
        .object({ kind: z.literal("external"), ...externalReferenceFields })
        .strict()
    ])
  })
  .strict()
  .superRefine((intent, context) => {
    addMessageMutationAuthorityIssues(
      context,
      intent,
      intent.transport.kind === "external" ? "external" : "internal"
    );
    if (intent.transport.kind === "external") {
      addRouteAuthorizationProofIssues(
        context,
        intent.conversation,
        intent.transport.outboundRoute,
        intent.transport.routeAuthorization,
        ["transport", "routeAuthorization"]
      );
    }
    addContentFileReadProofIssues(
      context,
      intent.content,
      intent.fileReadProofs,
      intent.conversation,
      intent.appActor,
      intent.transport.kind === "external" ? "external_work" : "internal"
    );
    addOutboundDraftIssues(
      context,
      intent.content,
      intent.transport.kind === "external"
    );
  });

const localDeleteSchema = z
  .object({
    kind: z.literal("delete_message_local"),
    tenantId: inboxV2TenantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    message: inboxV2MessageReferenceSchema,
    expectedMessageRevision: inboxV2EntityRevisionSchema,
    visibilityBoundary: z.enum(["external_work", "internal"]).optional(),
    mutationAuthority: inboxV2MessageMutationAuthoritySchema.optional(),
    appActor: inboxV2AppActorSchema,
    reasonId: z.string().min(1).max(256),
    occurredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((intent, context) => {
    addMessageMutationAuthorityIssues(
      context,
      intent,
      intent.visibilityBoundary === "internal" ? "internal" : "external"
    );
  });

const providerDeleteSchema = z
  .object({
    kind: z.literal("delete_message_provider"),
    tenantId: inboxV2TenantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    message: inboxV2MessageReferenceSchema,
    expectedMessageRevision: inboxV2EntityRevisionSchema,
    mutationAuthority: inboxV2MessageMutationAuthoritySchema.optional(),
    appActor: inboxV2AppActorSchema,
    ...externalReferenceFields,
    occurredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((intent, context) => {
    addMessageMutationAuthorityIssues(context, intent, "external");
    addRouteAuthorizationProofIssues(
      context,
      intent.conversation,
      intent.outboundRoute,
      intent.routeAuthorization,
      ["routeAuthorization"]
    );
  });

const forwardSourceReadProofSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    message: inboxV2MessageReferenceSchema,
    expectedMessageRevision: inboxV2EntityRevisionSchema,
    visibilityBoundary: z.enum(["external_work", "internal"])
  })
  .strict();

const forwardContentCopySchema = z
  .object({
    kind: z.literal("forward_content_copy"),
    ...authoredFields,
    content: inboxV2TimelineContentDraftSchema,
    ...fileReadProofFields,
    replyAuthority: inboxV2ExternalReplyAuthoritySchema.optional(),
    referenceContext: inboxV2MessageReferenceContextSchema,
    sourceReadProofs: z
      .array(forwardSourceReadProofSchema)
      .min(1)
      .max(32)
      .optional(),
    destination: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("internal") }).strict(),
      z
        .object({
          kind: z.literal("external"),
          outboundRoute: inboxV2OutboundRouteReferenceSchema,
          routeAuthorization:
            inboxV2TimelineRouteAuthorizationProofSchema.optional()
        })
        .strict()
    ])
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.referenceContext.kind !== "forward_content_copy") {
      addIssue(
        context,
        ["referenceContext"],
        "Content-copy forward is explicitly send-as-new."
      );
    } else if (intent.sourceReadProofs !== undefined) {
      const sourceKeys = intent.referenceContext.sources.map(
        (source) =>
          `${source.message.tenantId}\u0000${source.message.id}\u0000${source.messageRevision}`
      );
      const proofKeys = intent.sourceReadProofs.map(
        (proof) =>
          `${proof.message.tenantId}\u0000${proof.message.id}\u0000${proof.expectedMessageRevision}`
      );
      if (
        new Set(sourceKeys).size !== sourceKeys.length ||
        new Set(proofKeys).size !== proofKeys.length ||
        sourceKeys.length !== proofKeys.length ||
        sourceKeys.some((key) => !proofKeys.includes(key))
      ) {
        addIssue(
          context,
          ["sourceReadProofs"],
          "Every canonical forward source requires one exact server-stamped source Conversation visibility proof."
        );
      }
    }
    if (intent.destination.kind === "external") {
      addRouteAuthorizationProofIssues(
        context,
        intent.conversation,
        intent.destination.outboundRoute,
        intent.destination.routeAuthorization,
        ["destination", "routeAuthorization"]
      );
      addReplyAuthorityIssues(context, intent);
    } else if (intent.replyAuthority !== undefined) {
      addIssue(
        context,
        ["replyAuthority"],
        "Internal content-copy forward cannot carry external WorkItem reply authority."
      );
    }
    addContentFileReadProofIssues(
      context,
      intent.content,
      intent.fileReadProofs,
      intent.conversation,
      intent.appActor,
      intent.destination.kind === "external" ? "external_work" : "internal"
    );
    addOutboundDraftIssues(
      context,
      intent.content,
      intent.destination.kind === "external"
    );
  });

const forwardProviderNativeSchema = z
  .object({
    kind: z.literal("forward_provider_native"),
    ...authoredFields,
    outboundRoute: inboxV2OutboundRouteReferenceSchema,
    routeAuthorization: inboxV2TimelineRouteAuthorizationProofSchema.optional(),
    replyAuthority: inboxV2ExternalReplyAuthoritySchema.optional(),
    sourceReadProofs: z
      .array(inboxV2ProviderNativeForwardSourceReadProofSchema)
      .min(1)
      .max(32)
      .optional(),
    referenceContext: inboxV2MessageReferenceContextSchema
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.referenceContext.kind !== "forward_provider_native") {
      addIssue(
        context,
        ["referenceContext"],
        "Provider-native forward is never inferred from copied content."
      );
    } else if (intent.sourceReadProofs !== undefined) {
      const sourceKeys = intent.referenceContext.sources.map(
        (source) =>
          `${source.externalMessageReference.tenantId}\u0000${source.externalMessageReference.id}\u0000${source.sourceOccurrence.id}`
      );
      const proofKeys = intent.sourceReadProofs.map(
        (proof) =>
          `${proof.externalMessageReference.tenantId}\u0000${proof.externalMessageReference.id}\u0000${proof.sourceOccurrence.id}`
      );
      if (
        new Set(sourceKeys).size !== sourceKeys.length ||
        new Set(proofKeys).size !== proofKeys.length ||
        sourceKeys.length !== proofKeys.length ||
        sourceKeys.some((key) => !proofKeys.includes(key))
      ) {
        addIssue(
          context,
          ["sourceReadProofs"],
          "Every provider-native source requires one exact server-stamped source Conversation/occurrence proof."
        );
      }
      if (
        intent.sourceReadProofs.some(
          (proof) =>
            proof.sourceAccount.tenantId !== intent.tenantId ||
            proof.sourceThreadBinding.tenantId !== intent.tenantId
        )
      ) {
        addIssue(
          context,
          ["sourceReadProofs"],
          "Provider-native source account and binding proofs cannot cross the command tenant."
        );
      }
    }
    addRouteAuthorizationProofIssues(
      context,
      intent.conversation,
      intent.outboundRoute,
      intent.routeAuthorization,
      ["routeAuthorization"]
    );
    addReplyAuthorityIssues(context, intent);
  });

const reactionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("internal") }).strict(),
  z.object({ kind: z.literal("external"), ...externalReferenceFields }).strict()
]);

const reactionSetSchema = z
  .object({
    kind: z.literal("reaction_set"),
    tenantId: inboxV2TenantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    message: inboxV2MessageReferenceSchema,
    expectedMessageRevision: inboxV2EntityRevisionSchema.optional(),
    actionParticipant: inboxV2ConversationParticipantReferenceSchema,
    appActor: inboxV2AppActorSchema,
    value: inboxV2ReactionValueSchema,
    target: reactionTargetSchema,
    occurredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.target.kind === "external") {
      addRouteAuthorizationProofIssues(
        context,
        intent.conversation,
        intent.target.outboundRoute,
        intent.target.routeAuthorization,
        ["target", "routeAuthorization"]
      );
    }
  });

function reactionMutationSchema<
  const TKind extends "reaction_replace" | "reaction_clear"
>(kind: TKind) {
  return z
    .object({
      kind: z.literal(kind),
      tenantId: inboxV2TenantIdSchema,
      conversation: inboxV2ConversationReferenceSchema,
      reaction: inboxV2MessageReactionReferenceSchema,
      expectedReactionRevision: inboxV2EntityRevisionSchema,
      targetProof: inboxV2ReactionTargetProofSchema.optional(),
      actionParticipant: inboxV2ConversationParticipantReferenceSchema,
      appActor: inboxV2AppActorSchema,
      value:
        kind === "reaction_replace" ? inboxV2ReactionValueSchema : z.null(),
      target: reactionTargetSchema,
      occurredAt: inboxV2TimestampSchema
    })
    .strict()
    .superRefine((intent, context) => {
      if (
        intent.targetProof !== undefined &&
        (intent.targetProof.conversation.tenantId !==
          intent.conversation.tenantId ||
          intent.targetProof.conversation.id !== intent.conversation.id ||
          intent.targetProof.reaction.tenantId !== intent.reaction.tenantId ||
          intent.targetProof.reaction.id !== intent.reaction.id ||
          intent.targetProof.ownerParticipant.tenantId !==
            intent.actionParticipant.tenantId ||
          intent.targetProof.ownerParticipant.id !==
            intent.actionParticipant.id)
      ) {
        addIssue(
          context,
          ["targetProof"],
          "Reaction mutation proof must pin its exact Conversation, Message and owning participant."
        );
      }
      if (intent.target.kind === "external") {
        addRouteAuthorizationProofIssues(
          context,
          intent.conversation,
          intent.target.outboundRoute,
          intent.target.routeAuthorization,
          ["target", "routeAuthorization"]
        );
      }
    });
}

export const inboxV2TimelineCommandIntentSchema = z
  .discriminatedUnion("kind", [
    externalSendSchema,
    externalReplySchema,
    internalSendSchema,
    createStaffNoteSchema,
    readStaffNoteSchema,
    editMessageSchema,
    localDeleteSchema,
    providerDeleteSchema,
    forwardContentCopySchema,
    forwardProviderNativeSchema,
    reactionSetSchema,
    reactionMutationSchema("reaction_replace"),
    reactionMutationSchema("reaction_clear")
  ])
  .superRefine((intent, context) => {
    addIntentTenantIssues(context, intent);
  });

export const inboxV2TimelineCommandIntentEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_TIMELINE_COMMAND_INTENT_SCHEMA_ID,
    INBOX_V2_TIMELINE_COMMAND_INTENT_SCHEMA_VERSION,
    inboxV2TimelineCommandIntentSchema
  );

export type InboxV2TimelineCommandIntent = z.infer<
  typeof inboxV2TimelineCommandIntentSchema
>;

function isInternalReferenceContext(
  reference: InboxV2MessageReferenceContext
): boolean {
  return (
    reference.kind === "none" ||
    (reference.kind === "reply" &&
      reference.target.state === "resolved_internal")
  );
}

function addRouteAuthorizationProofIssues(
  context: z.RefinementCtx,
  conversation: z.infer<typeof inboxV2ConversationReferenceSchema>,
  outboundRoute: z.infer<typeof inboxV2OutboundRouteReferenceSchema>,
  proof:
    | z.infer<typeof inboxV2TimelineRouteAuthorizationProofSchema>
    | undefined,
  path: PropertyKey[]
): void {
  if (proof === undefined) {
    return;
  }
  if (
    proof.outboundRoute.id !== outboundRoute.id ||
    proof.outboundRoute.tenantId !== outboundRoute.tenantId ||
    proof.outboundRoute.tenantId !== conversation.tenantId ||
    proof.conversation.tenantId !== conversation.tenantId ||
    proof.conversation.id !== conversation.id ||
    proof.sourceAccount.tenantId !== conversation.tenantId ||
    proof.sourceThreadBinding.tenantId !== conversation.tenantId
  ) {
    addIssue(
      context,
      path,
      "Route authorization proof must pin the selected route, SourceAccount and binding in the destination tenant."
    );
  }
}

function addReplyAuthorityIssues(
  context: z.RefinementCtx,
  intent: Readonly<{
    conversation: z.infer<typeof inboxV2ConversationReferenceSchema>;
    appActor: z.infer<typeof inboxV2AppActorSchema>;
    replyAuthority?: z.infer<typeof inboxV2ExternalReplyAuthoritySchema>;
  }>
): void {
  const authority = intent.replyAuthority;
  if (authority === undefined) {
    return;
  }
  const references =
    authority.kind === "no_work_item"
      ? [authority.workItemSlot]
      : authority.kind === "active_primary_responsible"
        ? [authority.workItem, authority.primaryAssignment]
        : authority.kind === "active_allowed_collaborator"
          ? [authority.workItem, authority.collaboratorEpisode]
          : [authority.workItem];
  if (
    authority.conversation.tenantId !== intent.conversation.tenantId ||
    authority.conversation.id !== intent.conversation.id ||
    !sameAppActor(authority.appActor, intent.appActor) ||
    references.some(
      (reference) => reference.tenantId !== intent.conversation.tenantId
    )
  ) {
    addIssue(
      context,
      ["replyAuthority"],
      "Reply authority must be server-loaded for the destination Conversation tenant."
    );
  }
}

function addMessageMutationAuthorityIssues(
  context: z.RefinementCtx,
  intent: Readonly<{
    conversation: z.infer<typeof inboxV2ConversationReferenceSchema>;
    message: z.infer<typeof inboxV2MessageReferenceSchema>;
    appActor: z.infer<typeof inboxV2AppActorSchema>;
    mutationAuthority?: z.infer<typeof inboxV2MessageMutationAuthoritySchema>;
  }>,
  boundary: "external" | "internal"
): void {
  const authority = intent.mutationAuthority;
  if (authority === undefined) {
    return;
  }
  if (
    authority.conversation.tenantId !== intent.conversation.tenantId ||
    authority.conversation.id !== intent.conversation.id ||
    authority.message.tenantId !== intent.message.tenantId ||
    authority.message.id !== intent.message.id ||
    !sameAppActor(authority.appActor, intent.appActor) ||
    (authority.kind === "moderate_external" && boundary !== "external") ||
    (authority.kind === "moderate_internal" && boundary !== "internal")
  ) {
    addIssue(
      context,
      ["mutationAuthority"],
      "Message mutation authority must pin the exact target and matching internal/external moderation boundary."
    );
  }
}

function sameAppActor(
  left: z.infer<typeof inboxV2AppActorSchema>,
  right: z.infer<typeof inboxV2AppActorSchema>
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  return left.kind === "employee" && right.kind === "employee"
    ? left.employee.tenantId === right.employee.tenantId &&
        left.employee.id === right.employee.id &&
        left.authorizationEpoch === right.authorizationEpoch
    : left.kind === "trusted_service" && right.kind === "trusted_service"
      ? left.trustedServiceId === right.trustedServiceId
      : false;
}

function addContentFileReadProofIssues(
  context: z.RefinementCtx,
  draft: z.infer<typeof inboxV2TimelineContentDraftSchema>,
  proofs:
    | readonly z.infer<typeof inboxV2TimelineFileReadProofSchema>[]
    | undefined,
  conversation: z.infer<typeof inboxV2ConversationReferenceSchema>,
  appActor: z.infer<typeof inboxV2AppActorSchema>,
  visibilityBoundary: z.infer<
    typeof inboxV2TimelineFileReadProofSchema
  >["visibilityBoundary"]
): void {
  if (proofs === undefined) {
    return;
  }
  const uses: {
    blockKey: z.infer<typeof inboxV2ContentBlockKeySchema>;
    purpose: "attachment" | "extension_payload";
    file: z.infer<typeof inboxV2FileReferenceSchema>;
    fileRevision: z.infer<typeof inboxV2EntityRevisionSchema>;
    fileVersion: z.infer<typeof inboxV2FileVersionReferenceSchema>;
    objectVersion: z.infer<typeof inboxV2ObjectVersionReferenceSchema>;
    attachment: z.infer<typeof inboxV2MessageAttachmentReferenceSchema> | null;
  }[] = [];
  for (const block of draft.blocks) {
    if ("attachment" in block && block.attachment.state === "ready") {
      uses.push({
        blockKey: block.blockKey,
        purpose: "attachment",
        file: block.attachment.file,
        fileRevision: block.attachment.fileRevision,
        fileVersion: block.attachment.fileVersion,
        objectVersion: block.attachment.objectVersion,
        attachment: block.attachment.attachment
      });
      continue;
    }
    if (block.kind === "extension" && block.payloadPin.state === "exact") {
      uses.push({
        blockKey: block.blockKey,
        purpose: "extension_payload",
        file: block.payloadFile,
        fileRevision: block.payloadPin.fileRevision,
        fileVersion: block.payloadPin.fileVersion,
        objectVersion: block.payloadPin.objectVersion,
        attachment: null
      });
    }
  }
  const useKeys = uses.map(
    (use) =>
      `${use.blockKey}\u0000${use.purpose}\u0000${use.file.tenantId}\u0000${use.file.id}\u0000${use.fileRevision}\u0000${use.fileVersion.id}\u0000${use.objectVersion.id}\u0000${use.attachment?.id ?? "-"}`
  );
  const proofKeys = proofs.map(
    (proof) =>
      `${proof.blockKey}\u0000${proof.purpose}\u0000${proof.file.tenantId}\u0000${proof.file.id}\u0000${proof.expectedFileRevision}\u0000${proof.fileVersion.id}\u0000${proof.objectVersion.id}\u0000${proof.purpose === "attachment" ? proof.attachment.id : "-"}`
  );
  if (
    new Set(useKeys).size !== useKeys.length ||
    new Set(proofKeys).size !== proofKeys.length ||
    useKeys.length !== proofKeys.length ||
    useKeys.some((key) => !proofKeys.includes(key)) ||
    proofs.some(
      (proof) =>
        proof.parentConversation.tenantId !== conversation.tenantId ||
        proof.parentConversation.id !== conversation.id ||
        proof.visibilityBoundary !== visibilityBoundary ||
        (proof.sourceParent.kind === "upload_staging"
          ? !sameAppActor(proof.sourceParent.appActor, appActor)
          : proof.sourceParent.conversation.tenantId !== conversation.tenantId)
    )
  ) {
    addIssue(
      context,
      ["fileReadProofs"],
      "Every ready attachment/extension file requires exact materialization, source-parent and destination visibility proofs."
    );
  }
}

function addOutboundDraftIssues(
  context: z.RefinementCtx,
  draft: z.infer<typeof inboxV2TimelineContentDraftSchema>,
  requireReadyAttachments = true
): void {
  if (
    draft.blocks.some((block) => block.kind === "unsupported_source_content")
  ) {
    addIssue(
      context,
      ["content", "blocks"],
      "Unsupported source fallback is inbound evidence, never an outbound draft."
    );
  }
  if (
    draft.blocks.some(
      (block) =>
        ("attachment" in block &&
          block.attachment.state === "legacy_unpinned") ||
        (block.kind === "extension" &&
          block.payloadPin.state === "legacy_unpinned")
    )
  ) {
    addIssue(
      context,
      ["content", "blocks"],
      "Legacy unpinned file state is N-1 read compatibility and cannot enter a new outbound command."
    );
  }
  if (
    requireReadyAttachments &&
    draft.blocks.some(
      (block) =>
        (block.kind === "image" ||
          block.kind === "audio" ||
          block.kind === "video" ||
          block.kind === "file" ||
          block.kind === "sticker") &&
        block.attachment.state !== "ready"
    )
  ) {
    addIssue(
      context,
      ["content", "blocks"],
      "A send/create command may commit only ready attachments; pending/failed/quarantined materialization remains outside the timeline until resolved."
    );
  }
}

function addIntentTenantIssues(
  context: z.RefinementCtx,
  intent: InboxV2TimelineCommandIntent
): void {
  visitTenantScopedValue(context, intent.tenantId, intent, []);
}

function visitTenantScopedValue(
  context: z.RefinementCtx,
  tenantId: string,
  value: unknown,
  path: PropertyKey[]
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitTenantScopedValue(context, tenantId, item, [...path, index])
    );
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.tenantId === "string" && record.tenantId !== tenantId) {
    addIssue(context, path, "Command intent references must share one tenant.");
  }
  for (const [key, nested] of Object.entries(record)) {
    visitTenantScopedValue(context, tenantId, nested, [...path, key]);
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
