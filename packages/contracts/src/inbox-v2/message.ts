import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2ExternalMessageKeySchema } from "./external-message-reference";
import {
  inboxV2ConversationParticipantReferenceSchema,
  inboxV2ConversationReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2ExternalMessageReferenceRefSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageProviderLifecycleOperationReferenceSchema,
  inboxV2MessageReferenceSchema,
  inboxV2MessageRevisionReferenceSchema,
  inboxV2OutboundRouteReferenceSchema,
  inboxV2SourceIdentityClaimReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemReferenceSchema
} from "./ids";
import { inboxV2TimelineContentHeadSchema } from "./message-content";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import { inboxV2AdapterContractSnapshotSchema } from "./source-routing-primitives";
import {
  inboxV2AppActorSchema,
  inboxV2AutomationCausationSchema
} from "./timeline";

export const INBOX_V2_MESSAGE_SCHEMA_ID = "core:inbox-v2.message" as const;
export const INBOX_V2_MESSAGE_SCHEMA_VERSION = INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_MESSAGE_REASON_CATALOG = "message-reason" as const;
export const INBOX_V2_MESSAGE_MIGRATION_PROVENANCE_CATALOG =
  "message-migration-provenance" as const;
export const INBOX_V2_MESSAGE_CAPABILITY_CATALOG =
  "message-capability" as const;

export const inboxV2MessageReasonIdSchema = inboxV2CatalogIdSchema;
export const inboxV2MessageMigrationProvenanceIdSchema = inboxV2CatalogIdSchema;
export const inboxV2MessageCapabilityIdSchema = inboxV2CatalogIdSchema;

export const inboxV2MessageClaimAtOccurrenceSchema = z
  .object({
    claim: inboxV2SourceIdentityClaimReferenceSchema,
    claimVersion: inboxV2EntityRevisionSchema,
    resolvedEmployee: inboxV2EmployeeReferenceSchema
  })
  .strict();

export const inboxV2MessageOriginSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("source_originated"),
      originOccurrence: inboxV2SourceOccurrenceReferenceSchema,
      direction: z.enum(["inbound", "outbound"]),
      claimAtOccurrence: inboxV2MessageClaimAtOccurrenceSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal("hulee_external"),
      outboundRoute: inboxV2OutboundRouteReferenceSchema
    })
    .strict(),
  z.object({ kind: z.literal("internal") }).strict(),
  z
    .object({
      kind: z.literal("migration"),
      provenanceId: inboxV2MessageMigrationProvenanceIdSchema
    })
    .strict()
]);

const canonicalTargetSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    message: inboxV2MessageReferenceSchema,
    timelineItem: inboxV2TimelineItemReferenceSchema,
    messageRevision: inboxV2EntityRevisionSchema
  })
  .strict();

const exactExternalTargetSchema = z
  .object({
    externalMessageReference: inboxV2ExternalMessageReferenceRefSchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema
  })
  .strict();

const unresolvedSourceTargetSchema = z
  .object({
    externalMessageKey: inboxV2ExternalMessageKeySchema,
    sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
    resolution: z.discriminatedUnion("state", [
      z.object({ state: z.literal("pending") }).strict(),
      z
        .object({
          state: z.literal("conflicted"),
          candidates: z
            .array(inboxV2ExternalMessageReferenceRefSchema)
            .min(2)
            .max(100)
        })
        .strict()
    ])
  })
  .strict();

const providerNativeForwardCapabilitySchema = z
  .object({
    capabilityId: inboxV2MessageCapabilityIdSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    decision: z.literal("supported")
  })
  .strict();

export const inboxV2ProviderForwardProvenanceCompletenessSchema = z.enum([
  "exact",
  "partial",
  "opaque"
]);

export const inboxV2MessageReferenceContextSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }).strict(),
    z
      .object({
        kind: z.literal("reply"),
        target: z.discriminatedUnion("state", [
          z
            .object({
              state: z.literal("resolved_internal"),
              canonical: canonicalTargetSchema
            })
            .strict(),
          z
            .object({
              state: z.literal("resolved_external"),
              canonical: canonicalTargetSchema,
              external: exactExternalTargetSchema
            })
            .strict(),
          z
            .object({
              state: z.literal("unresolved_source"),
              source: unresolvedSourceTargetSchema
            })
            .strict()
        ])
      })
      .strict(),
    z
      .object({
        kind: z.literal("forward_content_copy"),
        sources: z.array(canonicalTargetSchema).min(1).max(32)
      })
      .strict(),
    z
      .object({
        kind: z.literal("forward_provider_native"),
        sources: z.array(exactExternalTargetSchema).length(1),
        capability: providerNativeForwardCapabilitySchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("forward_provider_observed"),
        originOccurrence: inboxV2SourceOccurrenceReferenceSchema,
        provenanceCompleteness:
          inboxV2ProviderForwardProvenanceCompletenessSchema,
        sourceReferences: z.array(exactExternalTargetSchema).max(32)
      })
      .strict()
      .superRefine((context, refinement) => {
        if (
          context.provenanceCompleteness === "exact" &&
          context.sourceReferences.length === 0
        ) {
          addIssue(
            refinement,
            ["sourceReferences"],
            "Exact provider-forward provenance requires an exact source reference."
          );
        }
      })
  ])
  .superRefine((reference, context) => {
    let keys: string[] = [];
    if (reference.kind === "reply") {
      if (
        reference.target.state === "unresolved_source" &&
        reference.target.source.resolution.state === "conflicted"
      ) {
        keys = reference.target.source.resolution.candidates.map(
          (candidate) => candidate.id
        );
      }
    } else if (reference.kind === "forward_content_copy") {
      keys = reference.sources.map(
        (source) => `${source.message.id}:${source.timelineItem.id}`
      );
    } else if (reference.kind === "forward_provider_native") {
      keys = reference.sources.map(
        (source) =>
          `${source.externalMessageReference.id}:${source.sourceOccurrence.id}`
      );
    } else if (reference.kind === "forward_provider_observed") {
      keys = reference.sourceReferences.map(
        (source) =>
          `${source.externalMessageReference.id}:${source.sourceOccurrence.id}`
      );
    }
    if (new Set(keys).size !== keys.length) {
      addIssue(
        context,
        [reference.kind === "reply" ? "target" : "sources"],
        "Message reference targets must be distinct."
      );
    }
  });

export const inboxV2MessageLifecycleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("active") }).strict(),
  z
    .object({
      kind: z.literal("local_delete_tombstone"),
      revision: inboxV2MessageRevisionReferenceSchema,
      reasonId: inboxV2MessageReasonIdSchema,
      deletedAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_delete_tombstone"),
      revision: inboxV2MessageRevisionReferenceSchema,
      providerOperation:
        inboxV2MessageProviderLifecycleOperationReferenceSchema,
      policyReasonId: inboxV2MessageReasonIdSchema,
      appliedAt: inboxV2TimestampSchema
    })
    .strict()
]);

/** Compact current Message head; histories and transport facts remain separate. */
export const inboxV2MessageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2MessageIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    timelineItem: inboxV2TimelineItemReferenceSchema,
    authorParticipant: inboxV2ConversationParticipantReferenceSchema,
    origin: inboxV2MessageOriginSchema,
    appActor: inboxV2AppActorSchema.nullable(),
    automationCausation: inboxV2AutomationCausationSchema.nullable(),
    content: inboxV2TimelineContentHeadSchema,
    referenceContext: inboxV2MessageReferenceContextSchema,
    lifecycle: inboxV2MessageLifecycleSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((message, context) => {
    for (const [field, reference] of [
      ["conversation", message.conversation],
      ["timelineItem", message.timelineItem],
      ["authorParticipant", message.authorParticipant],
      ["content", message.content.content]
    ] as const) {
      addTenantReferenceIssue(context, message.tenantId, reference, [field]);
    }
    addOriginTenantIssues(context, message);
    addReferenceContextTenantIssues(context, message);
    addActorTenantIssues(context, message);

    if (message.origin.kind === "source_originated") {
      if (message.appActor !== null || message.automationCausation !== null) {
        addIssue(
          context,
          ["appActor"],
          "Source-originated Messages cannot claim a Hulee app actor or automation causation."
        );
      }
    } else if (message.appActor === null) {
      addIssue(
        context,
        ["appActor"],
        "Hulee/internal/migration Messages require a server-stamped app actor."
      );
    }
    if (
      message.origin.kind === "migration" &&
      message.appActor?.kind !== "trusted_service"
    ) {
      addIssue(
        context,
        ["appActor"],
        "Migration Messages require trusted-service attribution."
      );
    }
    if (
      message.appActor?.kind === "employee" &&
      message.automationCausation !== null
    ) {
      addIssue(
        context,
        ["automationCausation"],
        "A directly Employee-authored app Message is not an automation response."
      );
    }
    if (message.content.stateKind !== "available" && message.revision === "1") {
      addIssue(
        context,
        ["content", "stateKind"],
        "A new Message starts with available content."
      );
    }
    if (message.revision === "1") {
      if (
        message.lifecycle.kind !== "active" ||
        message.createdAt !== message.updatedAt
      ) {
        addIssue(
          context,
          ["revision"],
          "Message revision 1 has active lifecycle and matching creation timestamps."
        );
      }
    }
    if (!isInboxV2TimestampOrderValid(message.createdAt, message.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "Message update cannot precede creation."
      );
    }
    if (
      message.lifecycle.kind === "local_delete_tombstone" &&
      message.lifecycle.deletedAt !== message.updatedAt
    ) {
      addIssue(
        context,
        ["lifecycle", "deletedAt"],
        "Local delete tombstone time is the Message revision time."
      );
    }
    if (
      message.lifecycle.kind === "provider_delete_tombstone" &&
      message.lifecycle.appliedAt !== message.updatedAt
    ) {
      addIssue(
        context,
        ["lifecycle", "appliedAt"],
        "Provider-delete policy tombstone time is the Message revision time."
      );
    }
  });

export const inboxV2MessageEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  inboxV2MessageSchema
);

export type InboxV2Message = z.infer<typeof inboxV2MessageSchema>;
export type InboxV2MessageOrigin = z.infer<typeof inboxV2MessageOriginSchema>;
export type InboxV2MessageReferenceContext = z.infer<
  typeof inboxV2MessageReferenceContextSchema
>;

export function inboxV2MessageReferenceOf(message: InboxV2Message) {
  return inboxV2MessageReferenceSchema.parse({
    tenantId: message.tenantId,
    kind: "message",
    id: message.id
  });
}

function addOriginTenantIssues(
  context: z.RefinementCtx,
  message: InboxV2Message
): void {
  const { origin } = message;
  if (origin.kind === "source_originated") {
    addTenantReferenceIssue(
      context,
      message.tenantId,
      origin.originOccurrence,
      ["origin", "originOccurrence"]
    );
    if (origin.claimAtOccurrence !== null) {
      addTenantReferenceIssue(
        context,
        message.tenantId,
        origin.claimAtOccurrence.claim,
        ["origin", "claimAtOccurrence", "claim"]
      );
      addTenantReferenceIssue(
        context,
        message.tenantId,
        origin.claimAtOccurrence.resolvedEmployee,
        ["origin", "claimAtOccurrence", "resolvedEmployee"]
      );
    }
  } else if (origin.kind === "hulee_external") {
    addTenantReferenceIssue(context, message.tenantId, origin.outboundRoute, [
      "origin",
      "outboundRoute"
    ]);
  }
}

function addReferenceContextTenantIssues(
  context: z.RefinementCtx,
  message: InboxV2Message
): void {
  const reference = message.referenceContext;
  if (reference.kind === "none") {
    return;
  }
  if (reference.kind === "reply") {
    if (reference.target.state === "unresolved_source") {
      addTenantReferenceIssue(
        context,
        message.tenantId,
        reference.target.source.externalMessageKey.externalThread,
        ["referenceContext", "target", "source", "externalMessageKey"]
      );
      addTenantReferenceIssue(
        context,
        message.tenantId,
        reference.target.source.sourceOccurrence,
        ["referenceContext", "target", "source", "sourceOccurrence"]
      );
      if (reference.target.source.resolution.state === "conflicted") {
        for (const [
          index,
          candidate
        ] of reference.target.source.resolution.candidates.entries()) {
          addTenantReferenceIssue(context, message.tenantId, candidate, [
            "referenceContext",
            "target",
            "source",
            "resolution",
            "candidates",
            index
          ]);
        }
      }
      return;
    }
    addCanonicalTargetTenantIssues(
      context,
      message.tenantId,
      reference.target.canonical,
      ["referenceContext", "target", "canonical"]
    );
    if (reference.target.state === "resolved_external") {
      addExactExternalTargetTenantIssues(
        context,
        message.tenantId,
        reference.target.external,
        ["referenceContext", "target", "external"]
      );
    }
    return;
  }
  if (reference.kind === "forward_content_copy") {
    for (const [index, source] of reference.sources.entries()) {
      addCanonicalTargetTenantIssues(context, message.tenantId, source, [
        "referenceContext",
        "sources",
        index
      ]);
    }
    return;
  }
  if (reference.kind === "forward_provider_native") {
    for (const [index, source] of reference.sources.entries()) {
      addExactExternalTargetTenantIssues(context, message.tenantId, source, [
        "referenceContext",
        "sources",
        index
      ]);
    }
    return;
  }
  addTenantReferenceIssue(
    context,
    message.tenantId,
    reference.originOccurrence,
    ["referenceContext", "originOccurrence"]
  );
  for (const [index, source] of reference.sourceReferences.entries()) {
    addExactExternalTargetTenantIssues(context, message.tenantId, source, [
      "referenceContext",
      "sourceReferences",
      index
    ]);
  }
}

function addActorTenantIssues(
  context: z.RefinementCtx,
  message: InboxV2Message
): void {
  if (message.appActor?.kind === "employee") {
    addTenantReferenceIssue(
      context,
      message.tenantId,
      message.appActor.employee,
      ["appActor", "employee"]
    );
  }
  if (message.automationCausation !== null) {
    addTenantReferenceIssue(
      context,
      message.tenantId,
      message.automationCausation.causeEvent,
      ["automationCausation", "causeEvent"]
    );
    if (message.automationCausation.kind === "employee_command") {
      addTenantReferenceIssue(
        context,
        message.tenantId,
        message.automationCausation.initiatingActor.employee,
        ["automationCausation", "initiatingActor", "employee"]
      );
    }
  }
  if (message.lifecycle.kind === "local_delete_tombstone") {
    addTenantReferenceIssue(
      context,
      message.tenantId,
      message.lifecycle.revision,
      ["lifecycle", "revision"]
    );
  } else if (message.lifecycle.kind === "provider_delete_tombstone") {
    addTenantReferenceIssue(
      context,
      message.tenantId,
      message.lifecycle.revision,
      ["lifecycle", "revision"]
    );
    addTenantReferenceIssue(
      context,
      message.tenantId,
      message.lifecycle.providerOperation,
      ["lifecycle", "providerOperation"]
    );
  }
}

function addCanonicalTargetTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  target: z.infer<typeof canonicalTargetSchema>,
  path: PropertyKey[]
): void {
  addTenantReferenceIssue(context, tenantId, target.conversation, [
    ...path,
    "conversation"
  ]);
  addTenantReferenceIssue(context, tenantId, target.message, [
    ...path,
    "message"
  ]);
  addTenantReferenceIssue(context, tenantId, target.timelineItem, [
    ...path,
    "timelineItem"
  ]);
}

function addExactExternalTargetTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  target: z.infer<typeof exactExternalTargetSchema>,
  path: PropertyKey[]
): void {
  addTenantReferenceIssue(context, tenantId, target.externalMessageReference, [
    ...path,
    "externalMessageReference"
  ]);
  addTenantReferenceIssue(context, tenantId, target.sourceOccurrence, [
    ...path,
    "sourceOccurrence"
  ]);
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "Message references must share one tenant.");
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
