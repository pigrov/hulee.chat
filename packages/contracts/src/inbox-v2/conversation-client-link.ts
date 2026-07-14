import { z } from "zod";

import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ClientContactReferenceSchema,
  inboxV2ClientReferenceSchema,
  inboxV2ConversationClientLinkIdSchema,
  inboxV2ConversationClientLinkReferenceSchema,
  inboxV2ConversationClientLinkTransitionIdSchema,
  inboxV2ConversationParticipantReferenceSchema,
  inboxV2ConversationReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2RawInboundEventReferenceSchema,
  inboxV2SourceIdentityClaimReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";

export const INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID =
  "core:inbox-v2.conversation-client-link" as const;
export const INBOX_V2_CONVERSATION_CLIENT_LINK_SET_HEAD_SCHEMA_ID =
  "core:inbox-v2.conversation-client-link-set-head" as const;
export const INBOX_V2_CONVERSATION_CLIENT_LINK_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.conversation-client-link-transition" as const;
export const INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_CONVERSATION_CLIENT_CURRENT_LINK_PAGE_MAX = 256;

export const INBOX_V2_CONVERSATION_CLIENT_ROLE_CATALOG =
  "conversation-client-role" as const;
export const INBOX_V2_CONVERSATION_CLIENT_LINK_POLICY_CATALOG =
  "conversation-client-link-policy" as const;
export const INBOX_V2_CONVERSATION_CLIENT_LINK_REASON_CATALOG =
  "conversation-client-link-reason" as const;
export const INBOX_V2_CONVERSATION_CLIENT_LINK_MIGRATION_PROVENANCE_CATALOG =
  "conversation-client-link-migration-provenance" as const;
const _INBOX_V2_TRUSTED_SERVICE_CATALOG = "trusted-service" as const;

export type InboxV2ConversationClientRoleId = InboxV2CatalogId<
  typeof INBOX_V2_CONVERSATION_CLIENT_ROLE_CATALOG
>;
export type InboxV2ConversationClientLinkPolicyId = InboxV2CatalogId<
  typeof INBOX_V2_CONVERSATION_CLIENT_LINK_POLICY_CATALOG
>;
export type InboxV2ConversationClientLinkReasonId = InboxV2CatalogId<
  typeof INBOX_V2_CONVERSATION_CLIENT_LINK_REASON_CATALOG
>;
export type InboxV2ConversationClientLinkMigrationProvenanceId =
  InboxV2CatalogId<
    typeof INBOX_V2_CONVERSATION_CLIENT_LINK_MIGRATION_PROVENANCE_CATALOG
  >;
type InboxV2TrustedServiceId = InboxV2CatalogId<
  typeof _INBOX_V2_TRUSTED_SERVICE_CATALOG
>;

export const inboxV2ConversationClientRoleIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ConversationClientRoleId
  );
export const inboxV2ConversationClientLinkPolicyIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ConversationClientLinkPolicyId
  );
export const inboxV2ConversationClientLinkReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ConversationClientLinkReasonId
  );
export const inboxV2ConversationClientLinkMigrationProvenanceIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ConversationClientLinkMigrationProvenanceId
  );
const inboxV2TrustedServiceIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2TrustedServiceId
);

export const INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS = Object.freeze({
  subject: inboxV2ConversationClientRoleIdSchema.parse("core:subject"),
  related: inboxV2ConversationClientRoleIdSchema.parse("core:related"),
  legacyUnspecified: inboxV2ConversationClientRoleIdSchema.parse(
    "core:legacy-unspecified"
  )
});
export const INBOX_V2_LEGACY_V1_CLIENT_LINK_PROVENANCE_ID =
  inboxV2ConversationClientLinkMigrationProvenanceIdSchema.parse(
    "core:legacy-v1"
  );

export const INBOX_V2_CONVERSATION_CLIENT_LINK_PERMISSION_REQUIREMENTS =
  Object.freeze({
    conversation: "conversation.clients.manage",
    client: "client.link.manage"
  } as const);

export const inboxV2ConversationClientAssociationConfidenceSchema = z.enum([
  "confirmed",
  "supported",
  "tentative"
]);

export const inboxV2ConversationClientLinkActorSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("employee"),
        employee: inboxV2EmployeeReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("trusted_service"),
        trustedServiceId: inboxV2TrustedServiceIdSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("migration_service"),
        trustedServiceId: inboxV2TrustedServiceIdSchema
      })
      .strict()
  ]
);

/**
 * Immutable descriptor of the exact historical tenant-policy activation that
 * authorized a trusted-service decision. Policy ID/version and the approved
 * service stay on the decision so the full tuple cannot silently diverge.
 *
 * This schema intentionally lives in this leaf contract instead of importing
 * tenant-policy-authority, whose family union depends on this module.
 */
export const inboxV2ConversationClientLinkPolicyAuthoritySchema = z
  .object({
    family: z.literal("conversation_client_link"),
    definitionContractVersion: inboxV2SchemaVersionTokenSchema,
    definitionDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    activationHeadRevision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2ConversationClientLinkDecisionSchema = z
  .object({
    actor: inboxV2ConversationClientLinkActorSchema,
    policyId: inboxV2ConversationClientLinkPolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    reasonCodeId: inboxV2ConversationClientLinkReasonIdSchema,
    policyAuthority:
      inboxV2ConversationClientLinkPolicyAuthoritySchema.nullable()
  })
  .strict()
  .superRefine((decision, context) => {
    const requiresAuthority = decision.actor.kind === "trusted_service";
    if (requiresAuthority !== (decision.policyAuthority !== null)) {
      addIssue(
        context,
        ["policyAuthority"],
        requiresAuthority
          ? "Trusted-service Client-link decisions require exact tenant-policy authority."
          : "Employee and migration Client-link decisions cannot carry tenant-policy authority."
      );
    }
  });

export const inboxV2ConversationClientLinkEvidenceReferenceSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("source_identity_claim"),
        reference: inboxV2SourceIdentityClaimReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("client_contact"),
        reference: inboxV2ClientContactReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("conversation_participant"),
        reference: inboxV2ConversationParticipantReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("raw_inbound_event"),
        reference: inboxV2RawInboundEventReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("normalized_inbound_event"),
        reference: inboxV2NormalizedInboundEventReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("source_occurrence"),
        reference: inboxV2SourceOccurrenceReferenceSchema
      })
      .strict()
  ]);

/**
 * Trusted services stamp this exact pair-scoped verification only after loading
 * and checking the referenced evidence graph. Nested references remain audit
 * pointers; their mere presence never proves scope correctness.
 */
export const inboxV2ConversationClientVerifiedEvidenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    client: inboxV2ClientReferenceSchema,
    policyId: inboxV2ConversationClientLinkPolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    verifiedByTrustedServiceId: inboxV2TrustedServiceIdSchema,
    verifiedAt: inboxV2TimestampSchema,
    policyAuthority:
      inboxV2ConversationClientLinkPolicyAuthoritySchema.nullable(),
    evidenceReferences: z
      .array(inboxV2ConversationClientLinkEvidenceReferenceSchema)
      .min(1)
      .max(50)
  })
  .strict()
  .superRefine((evidence, context) => {
    addTenantReferenceIssue(context, evidence.tenantId, evidence.conversation, [
      "conversation"
    ]);
    addTenantReferenceIssue(context, evidence.tenantId, evidence.client, [
      "client"
    ]);
    for (const [index, reference] of evidence.evidenceReferences.entries()) {
      addTenantReferenceIssue(context, evidence.tenantId, reference.reference, [
        "evidenceReferences",
        index,
        "reference"
      ]);
    }
  });

export const inboxV2ConversationClientLinkProvenanceSchema =
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("manual") }).strict(),
    z
      .object({
        kind: z.literal("source_identity_claim"),
        claim: inboxV2SourceIdentityClaimReferenceSchema,
        verification: inboxV2ConversationClientVerifiedEvidenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("trusted_policy"),
        verification: inboxV2ConversationClientVerifiedEvidenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("migration"),
        provenanceId: inboxV2ConversationClientLinkMigrationProvenanceIdSchema,
        contractVersion: inboxV2SchemaVersionTokenSchema
      })
      .strict()
  ]);

export const inboxV2ConversationClientLinkStartBasisSchema = z.enum([
  "known_effective",
  "migration_observed"
]);

export const inboxV2ConversationClientLinkTerminationSchema = z
  .object({
    endedAt: inboxV2TimestampSchema,
    decision: inboxV2ConversationClientLinkDecisionSchema
  })
  .strict();

/**
 * One immutable-attribution interval. Role/confidence/provenance changes close
 * this episode and create a new ID; primary selection lives on the set head.
 */
export const inboxV2ConversationClientLinkSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ConversationClientLinkIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    client: inboxV2ClientReferenceSchema,
    roleIds: z.array(inboxV2ConversationClientRoleIdSchema).min(1).max(16),
    associationConfidence: inboxV2ConversationClientAssociationConfidenceSchema,
    provenance: inboxV2ConversationClientLinkProvenanceSchema,
    auditEvidenceReferences: z
      .array(inboxV2ConversationClientLinkEvidenceReferenceSchema)
      .max(50),
    linkedBy: inboxV2ConversationClientLinkDecisionSchema,
    validFrom: inboxV2TimestampSchema,
    validFromBasis: inboxV2ConversationClientLinkStartBasisSchema,
    state: z.enum(["active", "ended"]),
    termination: inboxV2ConversationClientLinkTerminationSchema.nullable(),
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((link, context) => {
    addTenantReferenceIssue(context, link.tenantId, link.conversation, [
      "conversation"
    ]);
    addTenantReferenceIssue(context, link.tenantId, link.client, ["client"]);
    addDecisionTenantIssues(context, link.tenantId, link.linkedBy, [
      "linkedBy"
    ]);
    addProvenanceTenantIssues(context, link.tenantId, link.provenance, [
      "provenance"
    ]);

    for (const [index, evidence] of link.auditEvidenceReferences.entries()) {
      addTenantReferenceIssue(context, link.tenantId, evidence.reference, [
        "auditEvidenceReferences",
        index,
        "reference"
      ]);
    }

    if (new Set(link.roleIds).size !== link.roleIds.length) {
      addIssue(context, ["roleIds"], "Client-link roles must be unique.");
    }
    if (
      link.roleIds.includes(
        INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.legacyUnspecified
      ) &&
      link.roleIds.length !== 1
    ) {
      addIssue(
        context,
        ["roleIds"],
        "legacy-unspecified cannot coexist with a specific Client-link role."
      );
    }

    if (!isProvenanceActorCompatible(link.provenance, link.linkedBy.actor)) {
      addIssue(
        context,
        ["linkedBy", "actor"],
        "Client-link provenance does not match its server-stamped actor."
      );
    }
    if (
      link.provenance.kind === "trusted_policy" &&
      (link.provenance.verification.policyId !== link.linkedBy.policyId ||
        link.provenance.verification.policyVersion !==
          link.linkedBy.policyVersion)
    ) {
      addIssue(
        context,
        ["provenance"],
        "Trusted-policy provenance must match the server-stamped link decision."
      );
    }
    if (
      (link.provenance.kind === "source_identity_claim" ||
        link.provenance.kind === "trusted_policy") &&
      !isVerifiedEvidenceBoundToLink(link)
    ) {
      addIssue(
        context,
        ["provenance", "verification"],
        "Verified evidence must match the exact Conversation, Client, policy, service and link time."
      );
    }
    if (link.provenance.kind === "source_identity_claim") {
      const claimId = link.provenance.claim.id;

      if (
        !link.provenance.verification.evidenceReferences.some(
          (evidence) =>
            evidence.kind === "source_identity_claim" &&
            evidence.reference.id === claimId
        )
      ) {
        addIssue(
          context,
          ["provenance", "verification", "evidenceReferences"],
          "Claim provenance verification must include the exact claim reference."
        );
      }
    }
    if (
      link.validFromBasis === "migration_observed" &&
      link.provenance.kind !== "migration"
    ) {
      addIssue(
        context,
        ["validFromBasis"],
        "Only migration may use an observed rather than known effective start."
      );
    }
    if (
      link.provenance.kind === "migration" &&
      link.provenance.provenanceId ===
        INBOX_V2_LEGACY_V1_CLIENT_LINK_PROVENANCE_ID &&
      (link.roleIds.length !== 1 ||
        link.roleIds[0] !==
          INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.legacyUnspecified ||
        link.associationConfidence !== "confirmed" ||
        link.validFromBasis !== "migration_observed")
    ) {
      addIssue(
        context,
        ["provenance"],
        "V1 scalar migration keeps only a confirmed legacy-unspecified relation observed at migration."
      );
    }
    if (
      link.linkedBy.actor.kind === "trusted_service" &&
      link.associationConfidence !== "confirmed"
    ) {
      addIssue(
        context,
        ["associationConfidence"],
        "Automatic Client linking requires confirmed scope-correct evidence."
      );
    }

    const expectedRevision = link.state === "active" ? "1" : "2";

    if (link.revision !== expectedRevision) {
      addIssue(
        context,
        ["revision"],
        "Client-link episode starts at revision 1 and its sole end advances to revision 2."
      );
    }
    if (link.state === "active" && link.termination !== null) {
      addIssue(
        context,
        ["termination"],
        "Active Client-link episode cannot have termination metadata."
      );
    }
    if (link.state === "ended" && link.termination === null) {
      addIssue(
        context,
        ["termination"],
        "Ended Client-link episode requires audited termination metadata."
      );
    }
    if (link.termination !== null) {
      addDecisionTenantIssues(
        context,
        link.tenantId,
        link.termination.decision,
        ["termination", "decision"]
      );
      if (
        !isInboxV2TimestampOrderValid(
          link.validFrom,
          link.termination.endedAt
        ) ||
        Date.parse(link.termination.endedAt) === Date.parse(link.validFrom)
      ) {
        addIssue(
          context,
          ["termination", "endedAt"],
          "Client-link episode must have a positive interval."
        );
      }
    }
  });

export const inboxV2ConversationClientLinkSetHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    primaryLink: inboxV2ConversationClientLinkReferenceSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    addTenantReferenceIssue(context, head.tenantId, head.conversation, [
      "conversation"
    ]);
    if (head.primaryLink !== null) {
      addTenantReferenceIssue(context, head.tenantId, head.primaryLink, [
        "primaryLink"
      ]);
    }
  });

export const inboxV2ConversationClientLinkOperationSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("create_link"),
        link: inboxV2ConversationClientLinkReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("end_link"),
        link: inboxV2ConversationClientLinkReferenceSchema
      })
      .strict()
  ]);

/** One append-only, CAS-fenced atomic mutation of the whole link set. */
export const inboxV2ConversationClientLinkTransitionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ConversationClientLinkTransitionIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    operations: z.array(inboxV2ConversationClientLinkOperationSchema).max(100),
    previousPrimaryLink:
      inboxV2ConversationClientLinkReferenceSchema.nullable(),
    resultingPrimaryLink:
      inboxV2ConversationClientLinkReferenceSchema.nullable(),
    decision: inboxV2ConversationClientLinkDecisionSchema,
    expectedRevision: inboxV2EntityRevisionSchema.nullable(),
    currentRevision: inboxV2EntityRevisionSchema.nullable(),
    resultingRevision: inboxV2EntityRevisionSchema,
    occurredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((transition, context) => {
    addTenantReferenceIssue(
      context,
      transition.tenantId,
      transition.conversation,
      ["conversation"]
    );
    addDecisionTenantIssues(context, transition.tenantId, transition.decision, [
      "decision"
    ]);

    for (const [index, operation] of transition.operations.entries()) {
      addTenantReferenceIssue(context, transition.tenantId, operation.link, [
        "operations",
        index,
        "link"
      ]);
    }
    for (const [field, reference] of [
      ["previousPrimaryLink", transition.previousPrimaryLink],
      ["resultingPrimaryLink", transition.resultingPrimaryLink]
    ] as const) {
      if (reference !== null) {
        addTenantReferenceIssue(context, transition.tenantId, reference, [
          field
        ]);
      }
    }

    const operationKeys = transition.operations.map(
      (operation) => `${operation.kind}\u0000${operation.link.id}`
    );
    if (new Set(operationKeys).size !== operationKeys.length) {
      addIssue(
        context,
        ["operations"],
        "One link-set transition cannot repeat an operation."
      );
    }
    const linkIds = new Set(transition.operations.map((item) => item.link.id));
    if (linkIds.size !== transition.operations.length) {
      addIssue(
        context,
        ["operations"],
        "One link-set transition cannot create and end the same link."
      );
    }
    if (
      transition.operations.length === 0 &&
      sameNullableReference(
        transition.previousPrimaryLink,
        transition.resultingPrimaryLink
      )
    ) {
      addIssue(
        context,
        ["operations"],
        "Client-link transition must change links or explicit primary selection."
      );
    }

    addMonotonicRevisionIssue(
      context,
      transition.expectedRevision,
      transition.currentRevision,
      transition.resultingRevision,
      ["resultingRevision"]
    );
  });

/**
 * Bounded current-state read used by runtime Client resolution. The full graph
 * below is an integrity/rebuild fixture and must not be a runtime dependency.
 */
export const inboxV2ConversationClientCurrentLinkPageSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    linkSetHead: inboxV2ConversationClientLinkSetHeadSchema.nullable(),
    linkSetRevision: inboxV2EntityRevisionSchema.nullable(),
    links: z
      .array(inboxV2ConversationClientLinkSchema)
      .max(INBOX_V2_CONVERSATION_CLIENT_CURRENT_LINK_PAGE_MAX)
  })
  .strict()
  .superRefine((page, context) => {
    const tenantId = page.conversation.tenantId;

    if (page.linkSetHead === null) {
      if (page.linkSetRevision !== null || page.links.length !== 0) {
        addIssue(
          context,
          ["linkSetHead"],
          "An untouched Client-link set has no revision or current links."
        );
      }
    } else {
      addTenantReferenceIssue(
        context,
        tenantId,
        page.linkSetHead.conversation,
        ["linkSetHead", "conversation"]
      );
      if (
        page.linkSetHead.conversation.id !== page.conversation.id ||
        page.linkSetRevision !== page.linkSetHead.revision
      ) {
        addIssue(
          context,
          ["linkSetRevision"],
          "Current Client-link page must use its exact link-set head snapshot."
        );
      }
    }

    const linkIds = new Set<string>();
    const clientIds = new Set<string>();

    for (const [index, link] of page.links.entries()) {
      if (
        link.tenantId !== tenantId ||
        link.conversation.tenantId !== tenantId ||
        link.conversation.id !== page.conversation.id
      ) {
        addIssue(
          context,
          ["links", index],
          "Current Client-link page must contain one tenant and Conversation."
        );
      }
      if (link.state !== "active") {
        addIssue(
          context,
          ["links", index, "state"],
          "Current Client-link page can contain only active links."
        );
      }

      const linkId = String(link.id);
      const clientId = String(link.client.id);

      if (linkIds.has(linkId)) {
        addIssue(
          context,
          ["links", index, "id"],
          "Current Client-link page cannot repeat a link."
        );
      }
      if (clientIds.has(clientId)) {
        addIssue(
          context,
          ["links", index, "client"],
          "Current Client-link page cannot contain two active links for one Client."
        );
      }
      linkIds.add(linkId);
      clientIds.add(clientId);
    }
  });

/** Full-history integrity/rebuild fixture; never load it for runtime reads. */
export const inboxV2ConversationClientLinkHistoryFixtureSchema = z
  .object({
    conversation: inboxV2ConversationReferenceSchema,
    head: inboxV2ConversationClientLinkSetHeadSchema.nullable(),
    links: z.array(inboxV2ConversationClientLinkSchema).max(10_000),
    transitions: z
      .array(inboxV2ConversationClientLinkTransitionSchema)
      .max(50_000)
  })
  .strict()
  .superRefine((fixture, context) => {
    addConversationClientLinkHistoryFixtureIssues(fixture, context);
  });

export const inboxV2ConversationClientLinkEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
    INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
    inboxV2ConversationClientLinkSchema
  );
export const inboxV2ConversationClientLinkSetHeadEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CONVERSATION_CLIENT_LINK_SET_HEAD_SCHEMA_ID,
    INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
    inboxV2ConversationClientLinkSetHeadSchema
  );
export const inboxV2ConversationClientLinkTransitionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CONVERSATION_CLIENT_LINK_TRANSITION_SCHEMA_ID,
    INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
    inboxV2ConversationClientLinkTransitionSchema
  );

export type InboxV2ConversationClientAssociationConfidence = z.infer<
  typeof inboxV2ConversationClientAssociationConfidenceSchema
>;
export type InboxV2ConversationClientLinkActor = z.infer<
  typeof inboxV2ConversationClientLinkActorSchema
>;
export type InboxV2ConversationClientLinkDecision = z.infer<
  typeof inboxV2ConversationClientLinkDecisionSchema
>;
export type InboxV2ConversationClientLinkPolicyAuthority = z.infer<
  typeof inboxV2ConversationClientLinkPolicyAuthoritySchema
>;
export type InboxV2ConversationClientLinkProvenance = z.infer<
  typeof inboxV2ConversationClientLinkProvenanceSchema
>;
export type InboxV2ConversationClientLink = z.infer<
  typeof inboxV2ConversationClientLinkSchema
>;
export type InboxV2ConversationClientLinkSetHead = z.infer<
  typeof inboxV2ConversationClientLinkSetHeadSchema
>;
export type InboxV2ConversationClientLinkTransition = z.infer<
  typeof inboxV2ConversationClientLinkTransitionSchema
>;
export type InboxV2ConversationClientCurrentLinkPage = z.infer<
  typeof inboxV2ConversationClientCurrentLinkPageSchema
>;
export type InboxV2ConversationClientLinkHistoryFixture = z.infer<
  typeof inboxV2ConversationClientLinkHistoryFixtureSchema
>;

type InboxV2ConversationClientLinkHistoryFixtureValue = {
  conversation: z.infer<typeof inboxV2ConversationReferenceSchema>;
  head: InboxV2ConversationClientLinkSetHead | null;
  links: InboxV2ConversationClientLink[];
  transitions: InboxV2ConversationClientLinkTransition[];
};

function addConversationClientLinkHistoryFixtureIssues(
  graph: InboxV2ConversationClientLinkHistoryFixtureValue,
  context: z.RefinementCtx
): void {
  const tenantId = graph.conversation.tenantId;
  const links = indexUniqueEntities(graph.links, context, ["links"], "link");
  indexUniqueEntities(
    graph.transitions,
    context,
    ["transitions"],
    "link transition"
  );

  if (
    graph.head &&
    (graph.head.tenantId !== tenantId ||
      graph.head.conversation.id !== graph.conversation.id)
  ) {
    addIssue(
      context,
      ["head", "conversation"],
      "Client-link head must belong to the graph Conversation."
    );
  }

  const linksByClient = new Map<string, InboxV2ConversationClientLink[]>();

  for (const [index, link] of graph.links.entries()) {
    if (
      link.tenantId !== tenantId ||
      link.conversation.id !== graph.conversation.id
    ) {
      addIssue(
        context,
        ["links", index, "conversation"],
        "Every Client link must belong to the graph Conversation."
      );
    }
    appendIndex(linksByClient, String(link.client.id), link);
  }

  for (const episodes of linksByClient.values()) {
    const ordered = [...episodes].sort((left, right) => {
      const startDifference =
        Date.parse(left.validFrom) - Date.parse(right.validFrom);

      if (startDifference !== 0) {
        return startDifference;
      }

      const leftEnd = left.termination?.endedAt;
      const rightEnd = right.termination?.endedAt;

      if (leftEnd !== rightEnd) {
        if (leftEnd === undefined) {
          return 1;
        }
        if (rightEnd === undefined) {
          return -1;
        }

        const endDifference = Date.parse(leftEnd) - Date.parse(rightEnd);
        if (endDifference !== 0) {
          return endDifference;
        }
      }

      return String(left.id).localeCompare(String(right.id));
    });

    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousEnd = previous?.termination?.endedAt ?? null;

      if (
        !previous ||
        !current ||
        previousEnd === null ||
        Date.parse(previousEnd) > Date.parse(current.validFrom)
      ) {
        addIssue(
          context,
          ["links"],
          "Conversation cannot contain overlapping link episodes for one Client."
        );
        break;
      }
    }
  }

  const orderedTransitions = [...graph.transitions].sort((left, right) =>
    comparePositiveDecimal(left.resultingRevision, right.resultingRevision)
  );
  const activeLinkIds = new Set<string>();
  const activeClientCounts = new Map<string, number>();
  const createTransitions = new Map<
    string,
    InboxV2ConversationClientLinkTransition[]
  >();
  const endTransitions = new Map<
    string,
    InboxV2ConversationClientLinkTransition[]
  >();
  let currentPrimaryLinkId: string | null = null;

  for (const [index, transition] of orderedTransitions.entries()) {
    const expectedRevision = index === 0 ? null : String(index);
    const resultingRevision = String(index + 1);

    if (
      transition.tenantId !== tenantId ||
      transition.conversation.id !== graph.conversation.id
    ) {
      addIssue(
        context,
        ["transitions", index, "conversation"],
        "Client-link transition must belong to the graph Conversation."
      );
    }
    if (
      transition.expectedRevision !== expectedRevision ||
      transition.currentRevision !== expectedRevision ||
      transition.resultingRevision !== resultingRevision
    ) {
      addIssue(
        context,
        ["transitions", index, "resultingRevision"],
        "Client-link transition history must be contiguous from revision 1."
      );
    }
    if ((transition.previousPrimaryLink?.id ?? null) !== currentPrimaryLinkId) {
      addIssue(
        context,
        ["transitions", index, "previousPrimaryLink"],
        "Primary Client history must be continuous."
      );
    }
    if (
      currentPrimaryLinkId !== null &&
      !activeLinkIds.has(currentPrimaryLinkId)
    ) {
      addIssue(
        context,
        ["transitions", index, "previousPrimaryLink"],
        "Previous primary must have been active before the transition."
      );
    }

    const endingActiveLinkIds: string[] = [];
    const creatingInactiveLinkIds: string[] = [];

    for (const operation of transition.operations) {
      const linkId = String(operation.link.id);
      const link = links.get(linkId);

      if (!link) {
        addIssue(
          context,
          ["transitions", index, "operations"],
          "Client-link operation must reference a link in the graph."
        );
        continue;
      }

      if (operation.kind === "create_link") {
        appendIndex(createTransitions, linkId, transition);
        if (activeLinkIds.has(linkId)) {
          addIssue(
            context,
            ["transitions", index, "operations"],
            "Client-link episode cannot be created twice."
          );
        } else {
          creatingInactiveLinkIds.push(linkId);
        }
        if (
          link.validFrom !== transition.occurredAt ||
          !sameDecision(link.linkedBy, transition.decision)
        ) {
          addIssue(
            context,
            ["transitions", index, "operations"],
            "Create operation must match link time and decision."
          );
        }
      } else {
        appendIndex(endTransitions, linkId, transition);
        if (!activeLinkIds.has(linkId)) {
          addIssue(
            context,
            ["transitions", index, "operations"],
            "Only an active Client-link episode can end."
          );
        } else {
          endingActiveLinkIds.push(linkId);
        }
        if (
          link.termination?.endedAt !== transition.occurredAt ||
          !link.termination ||
          !sameDecision(link.termination.decision, transition.decision)
        ) {
          addIssue(
            context,
            ["transitions", index, "operations"],
            "End operation must match link termination time and decision."
          );
        }
      }
    }

    const affectedClientIds = new Set<string>();

    for (const linkId of endingActiveLinkIds) {
      activeLinkIds.delete(linkId);
      const link = links.get(linkId);

      if (link) {
        const clientId = String(link.client.id);
        activeClientCounts.set(
          clientId,
          (activeClientCounts.get(clientId) ?? 0) - 1
        );
        affectedClientIds.add(clientId);
      }
    }
    for (const linkId of creatingInactiveLinkIds) {
      activeLinkIds.add(linkId);
      const link = links.get(linkId);

      if (link) {
        const clientId = String(link.client.id);
        activeClientCounts.set(
          clientId,
          (activeClientCounts.get(clientId) ?? 0) + 1
        );
        affectedClientIds.add(clientId);
      }
    }

    for (const clientId of affectedClientIds) {
      if ((activeClientCounts.get(clientId) ?? 0) > 1) {
        addIssue(
          context,
          ["transitions", index, "operations"],
          "A transition cannot leave two active link episodes for one Client."
        );
        break;
      }
    }

    const nextPrimaryId = transition.resultingPrimaryLink?.id ?? null;

    if (nextPrimaryId !== null) {
      const primaryLink = links.get(String(nextPrimaryId));

      if (
        !primaryLink ||
        !activeLinkIds.has(String(nextPrimaryId)) ||
        primaryLink.associationConfidence !== "confirmed" ||
        primaryLink.provenance.kind === "migration" ||
        primaryLink.roleIds.includes(
          INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.legacyUnspecified
        )
      ) {
        addIssue(
          context,
          ["transitions", index, "resultingPrimaryLink"],
          "Primary must be an active confirmed non-legacy Client link."
        );
      }
    }

    const previousTransition = orderedTransitions[index - 1];
    if (
      previousTransition &&
      !isInboxV2TimestampOrderValid(
        previousTransition.occurredAt,
        transition.occurredAt
      )
    ) {
      addIssue(
        context,
        ["transitions", index, "occurredAt"],
        "Client-link transition time cannot move backwards."
      );
    }

    currentPrimaryLinkId =
      nextPrimaryId === null ? null : String(nextPrimaryId);
  }

  for (const [index, link] of graph.links.entries()) {
    const creates = createTransitions.get(String(link.id)) ?? [];
    const ends = endTransitions.get(String(link.id)) ?? [];

    if (creates.length !== 1) {
      addIssue(
        context,
        ["links", index],
        "Each Client-link episode requires exactly one create transition."
      );
    }
    if (
      (link.state === "active" && ends.length !== 0) ||
      (link.state === "ended" && ends.length !== 1)
    ) {
      addIssue(
        context,
        ["links", index, "state"],
        "Client-link state must match exactly one optional end transition."
      );
    }
    if ((link.state === "active") !== activeLinkIds.has(String(link.id))) {
      addIssue(
        context,
        ["links", index, "state"],
        "Client-link current projection must match transition history."
      );
    }
  }

  if (orderedTransitions.length === 0) {
    if (graph.head !== null || graph.links.length !== 0) {
      addIssue(
        context,
        ["head"],
        "An untouched Conversation has neither Client-link head nor link rows."
      );
    }
    return;
  }

  const latest = orderedTransitions.at(-1);

  if (
    !graph.head ||
    !latest ||
    graph.head.revision !== latest.resultingRevision ||
    graph.head.updatedAt !== latest.occurredAt ||
    (graph.head.primaryLink?.id ?? null) !== currentPrimaryLinkId
  ) {
    addIssue(
      context,
      ["head"],
      "Client-link set head must match its latest transition."
    );
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
      "Inbox V2 nested reference must use the entity tenant."
    );
  }
}

function addDecisionTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  decision: InboxV2ConversationClientLinkDecision,
  path: PropertyKey[]
): void {
  if (decision.actor.kind === "employee") {
    addTenantReferenceIssue(context, tenantId, decision.actor.employee, [
      ...path,
      "actor",
      "employee"
    ]);
  }
}

function addProvenanceTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  provenance: InboxV2ConversationClientLinkProvenance,
  path: PropertyKey[]
): void {
  if (provenance.kind === "source_identity_claim") {
    addTenantReferenceIssue(context, tenantId, provenance.claim, [
      ...path,
      "claim"
    ]);
  }
}

function isProvenanceActorCompatible(
  provenance: InboxV2ConversationClientLinkProvenance,
  actor: InboxV2ConversationClientLinkActor
): boolean {
  switch (provenance.kind) {
    case "manual":
      return actor.kind === "employee";
    case "source_identity_claim":
      return actor.kind === "employee" || actor.kind === "trusted_service";
    case "trusted_policy":
      return actor.kind === "trusted_service";
    case "migration":
      return actor.kind === "migration_service";
  }
}

function isVerifiedEvidenceBoundToLink(
  link: InboxV2ConversationClientLink
): boolean {
  if (
    link.provenance.kind !== "source_identity_claim" &&
    link.provenance.kind !== "trusted_policy"
  ) {
    return true;
  }

  const verification = link.provenance.verification;
  const decisionAuthority = link.linkedBy.policyAuthority;
  const verificationAuthority = verification.policyAuthority;

  return (
    verification.tenantId === link.tenantId &&
    verification.conversation.id === link.conversation.id &&
    verification.client.id === link.client.id &&
    verification.policyId === link.linkedBy.policyId &&
    verification.policyVersion === link.linkedBy.policyVersion &&
    isInboxV2TimestampOrderValid(verification.verifiedAt, link.validFrom) &&
    (link.linkedBy.actor.kind === "trusted_service"
      ? verification.verifiedByTrustedServiceId ===
          link.linkedBy.actor.trustedServiceId &&
        decisionAuthority !== null &&
        verificationAuthority !== null &&
        samePolicyAuthority(decisionAuthority, verificationAuthority)
      : verificationAuthority === null)
  );
}

function addMonotonicRevisionIssue(
  context: z.RefinementCtx,
  expected: string | null,
  current: string | null,
  resulting: string,
  path: PropertyKey[]
): void {
  if (
    expected !== current ||
    (current === null
      ? resulting !== "1"
      : BigInt(resulting) !== BigInt(current) + 1n)
  ) {
    addIssue(
      context,
      path,
      "Client-link transition requires exact null-to-1 or n-to-n+1 CAS."
    );
  }
}

function sameNullableReference(
  left: { tenantId: string; id: string } | null,
  right: { tenantId: string; id: string } | null
): boolean {
  return left === null || right === null
    ? left === right
    : left.tenantId === right.tenantId && left.id === right.id;
}

function sameDecision(
  left: InboxV2ConversationClientLinkDecision,
  right: InboxV2ConversationClientLinkDecision
): boolean {
  if (
    left.policyId !== right.policyId ||
    left.policyVersion !== right.policyVersion ||
    left.reasonCodeId !== right.reasonCodeId ||
    left.actor.kind !== right.actor.kind ||
    !sameNullablePolicyAuthority(left.policyAuthority, right.policyAuthority)
  ) {
    return false;
  }

  if (left.actor.kind === "employee" && right.actor.kind === "employee") {
    return (
      left.actor.employee.tenantId === right.actor.employee.tenantId &&
      left.actor.employee.id === right.actor.employee.id
    );
  }
  if (left.actor.kind !== "employee" && right.actor.kind !== "employee") {
    return left.actor.trustedServiceId === right.actor.trustedServiceId;
  }
  return false;
}

function sameNullablePolicyAuthority(
  left: z.infer<
    typeof inboxV2ConversationClientLinkPolicyAuthoritySchema
  > | null,
  right: z.infer<
    typeof inboxV2ConversationClientLinkPolicyAuthoritySchema
  > | null
): boolean {
  return left === null || right === null
    ? left === right
    : samePolicyAuthority(left, right);
}

function samePolicyAuthority(
  left: z.infer<typeof inboxV2ConversationClientLinkPolicyAuthoritySchema>,
  right: z.infer<typeof inboxV2ConversationClientLinkPolicyAuthoritySchema>
): boolean {
  return (
    left.family === right.family &&
    left.definitionContractVersion === right.definitionContractVersion &&
    left.definitionDigestSha256 === right.definitionDigestSha256 &&
    left.activationHeadRevision === right.activationHeadRevision
  );
}

function indexUniqueEntities<TItem extends { id: string }>(
  items: readonly TItem[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string
): Map<string, TItem> {
  const result = new Map<string, TItem>();

  for (const [index, item] of items.entries()) {
    const id = String(item.id);
    if (result.has(id)) {
      addIssue(context, [...path, index, "id"], `Duplicate ${label} ID.`);
    }
    result.set(id, item);
  }
  return result;
}

function appendIndex<TItem>(
  index: Map<string, TItem[]>,
  key: string,
  item: TItem
): void {
  const items = index.get(key) ?? [];
  items.push(item);
  index.set(key, items);
}

function comparePositiveDecimal(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
