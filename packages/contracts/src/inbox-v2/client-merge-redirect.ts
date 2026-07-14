import { z } from "zod";

import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ClientMergeRedirectIdSchema,
  inboxV2ClientMergeRedirectReferenceSchema,
  inboxV2ClientReferenceSchema,
  inboxV2ConversationClientLinkReferenceSchema,
  inboxV2TenantIdSchema,
  type InboxV2ClientReference
} from "./ids";
import {
  INBOX_V2_CONVERSATION_CLIENT_CURRENT_LINK_PAGE_MAX,
  inboxV2ConversationClientCurrentLinkPageSchema,
  inboxV2ConversationClientLinkActorSchema
} from "./conversation-client-link";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";

export const INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_ID =
  "core:inbox-v2.client-merge-redirect" as const;
export const INBOX_V2_CLIENT_MERGE_GRAPH_HEAD_SCHEMA_ID =
  "core:inbox-v2.client-merge-graph-head" as const;
export const INBOX_V2_CLIENT_MERGE_NODE_STATE_SCHEMA_ID =
  "core:inbox-v2.client-merge-node-state" as const;
export const INBOX_V2_CLIENT_MERGE_COMMIT_SCHEMA_ID =
  "core:inbox-v2.client-merge-commit" as const;
export const INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_CLIENT_MERGE_POLICY_CATALOG =
  "client-merge-policy" as const;
export const INBOX_V2_CLIENT_MERGE_REASON_CATALOG =
  "client-merge-reason" as const;
export const INBOX_V2_CLIENT_MERGE_TRUSTED_SERVICE_CATALOG =
  "trusted-service" as const;
export const INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH = 64;
export const INBOX_V2_CLIENT_MERGE_MAX_RESOLUTION_NODES =
  INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH + 1;
export const INBOX_V2_CLIENT_MERGE_RESOLUTION_BATCH_MAX = 256;

export type InboxV2ClientMergePolicyId = InboxV2CatalogId<
  typeof INBOX_V2_CLIENT_MERGE_POLICY_CATALOG
>;
export type InboxV2ClientMergeReasonId = InboxV2CatalogId<
  typeof INBOX_V2_CLIENT_MERGE_REASON_CATALOG
>;
export type InboxV2ClientMergeTrustedServiceId = InboxV2CatalogId<
  typeof INBOX_V2_CLIENT_MERGE_TRUSTED_SERVICE_CATALOG
>;

export const inboxV2ClientMergePolicyIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ClientMergePolicyId
  );
export const inboxV2ClientMergeReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ClientMergeReasonId
  );
export const inboxV2ClientMergeTrustedServiceIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ClientMergeTrustedServiceId
  );

export const inboxV2ClientMergeDecisionSchema = z
  .object({
    actor: inboxV2ConversationClientLinkActorSchema,
    policyId: inboxV2ClientMergePolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    reasonCodeId: inboxV2ClientMergeReasonIdSchema
  })
  .strict();

export const inboxV2ClientMergeGraphHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    revision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2ClientMergeResolutionStampSchema = z
  .object({
    kind: z.literal("trusted_service"),
    trustedServiceId: inboxV2ClientMergeTrustedServiceIdSchema,
    resolvedAt: inboxV2TimestampSchema
  })
  .strict();

const inboxV2ClientMergeMaximumInboundDepthSchema = z
  .number()
  .int()
  .min(0)
  .max(INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH);

const clientMergeNodeStateCommonShape = {
  tenantId: inboxV2TenantIdSchema,
  client: inboxV2ClientReferenceSchema,
  maximumInboundDepth: inboxV2ClientMergeMaximumInboundDepthSchema,
  revision: inboxV2EntityRevisionSchema,
  updatedAt: inboxV2TimestampSchema
};

const inboxV2CanonicalClientMergeNodeStateSchema = z
  .object({
    ...clientMergeNodeStateCommonShape,
    state: z.literal("canonical_root"),
    nextClient: z.null(),
    redirect: z.null(),
    lastGraphRevision: inboxV2EntityRevisionSchema.nullable()
  })
  .strict();

const inboxV2RedirectedClientMergeNodeStateSchema = z
  .object({
    ...clientMergeNodeStateCommonShape,
    state: z.literal("redirected"),
    nextClient: inboxV2ClientReferenceSchema,
    redirect: inboxV2ClientMergeRedirectReferenceSchema,
    lastGraphRevision: inboxV2EntityRevisionSchema
  })
  .strict();

/**
 * One authoritative current row per Client. Missing state is corruption, not a
 * proof that the Client is canonical. maximumInboundDepth is maintained only
 * by the same transaction that commits a redirect and advances the tenant head.
 */
export const inboxV2ClientMergeNodeStateSchema = z
  .discriminatedUnion("state", [
    inboxV2CanonicalClientMergeNodeStateSchema,
    inboxV2RedirectedClientMergeNodeStateSchema
  ])
  .superRefine((node, context) => {
    addTenantReferenceIssue(context, node.tenantId, node.client, ["client"]);

    if (node.lastGraphRevision === null) {
      if (
        node.state !== "canonical_root" ||
        node.maximumInboundDepth !== 0 ||
        node.revision !== "1"
      ) {
        addIssue(
          context,
          ["lastGraphRevision"],
          "A never-merged Client node must be an initial depth-0 canonical root at revision 1."
        );
      }
    } else if (
      node.revision === "1" ||
      (node.state === "canonical_root" && node.maximumInboundDepth === 0)
    ) {
      addIssue(
        context,
        ["revision"],
        "A merge-mutated Client node must be revision 2 or later with a positive root depth."
      );
    }

    if (node.state === "redirected") {
      addTenantReferenceIssue(context, node.tenantId, node.nextClient, [
        "nextClient"
      ]);
      addTenantReferenceIssue(context, node.tenantId, node.redirect, [
        "redirect"
      ]);
      if (sameClientReference(node.client, node.nextClient)) {
        addIssue(
          context,
          ["nextClient"],
          "Redirected Client node cannot point to itself."
        );
      }
      if (
        node.maximumInboundDepth === INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH
      ) {
        addIssue(
          context,
          ["maximumInboundDepth"],
          "A depth-64 root cannot become a redirected source."
        );
      }
    }
  });

/**
 * Bounded authoritative lookup proof produced by a trusted repository read.
 * It is never accepted from an external caller as authorization or identity.
 */
export const inboxV2ClientMergeResolutionPathSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    graphHead: inboxV2ClientMergeGraphHeadSchema.nullable(),
    requestedClient: inboxV2ClientReferenceSchema,
    nodes: z
      .array(inboxV2ClientMergeNodeStateSchema)
      .min(1)
      .max(INBOX_V2_CLIENT_MERGE_MAX_RESOLUTION_NODES),
    canonicalClient: inboxV2ClientReferenceSchema,
    resolutionStamp: inboxV2ClientMergeResolutionStampSchema
  })
  .strict()
  .superRefine((resolution, context) => {
    addResolutionPathIssues(resolution, context);
  });

/** A request bound, never a tenant/client lifetime bound. */
export const inboxV2ClientMergeResolutionBatchSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    graphHead: inboxV2ClientMergeGraphHeadSchema.nullable(),
    resolutionStamp: inboxV2ClientMergeResolutionStampSchema,
    resolutions: z
      .array(inboxV2ClientMergeResolutionPathSchema)
      .max(INBOX_V2_CLIENT_MERGE_RESOLUTION_BATCH_MAX)
  })
  .strict()
  .superRefine((batch, context) => {
    if (
      batch.graphHead !== null &&
      batch.graphHead.tenantId !== batch.tenantId
    ) {
      addIssue(
        context,
        ["graphHead", "tenantId"],
        "Client merge resolution batch head must use the batch tenant."
      );
    }
    if (
      batch.graphHead !== null &&
      !isInboxV2TimestampOrderValid(
        batch.graphHead.updatedAt,
        batch.resolutionStamp.resolvedAt
      )
    ) {
      addIssue(
        context,
        ["resolutionStamp", "resolvedAt"],
        "Client merge resolution batch cannot predate its graph-head snapshot."
      );
    }

    const requestedClientIds = new Set<string>();

    for (const [index, resolution] of batch.resolutions.entries()) {
      if (resolution.tenantId !== batch.tenantId) {
        addIssue(
          context,
          ["resolutions", index, "tenantId"],
          "Client merge resolution batch must contain one tenant."
        );
      }
      if (!sameGraphHead(resolution.graphHead, batch.graphHead)) {
        addIssue(
          context,
          ["resolutions", index, "graphHead"],
          "Client merge resolution batch must use one exact graph-head snapshot."
        );
      }
      if (
        !sameResolutionStamp(resolution.resolutionStamp, batch.resolutionStamp)
      ) {
        addIssue(
          context,
          ["resolutions", index, "resolutionStamp"],
          "Client merge resolution batch must use one trusted-service stamp."
        );
      }

      const clientId = String(resolution.requestedClient.id);
      if (requestedClientIds.has(clientId)) {
        addIssue(
          context,
          ["resolutions", index, "requestedClient"],
          "Client merge resolution batch cannot repeat a requested Client."
        );
      }
      requestedClientIds.add(clientId);
    }
  });

/**
 * Immutable committed merge fact. Runtime resolution reads bounded NodeState
 * paths; redirect history is paged for audit and is never loaded as one graph.
 * sourceRoot and targetRoot are the exact requested current roots. A stale or
 * already-redirected request fails as a conflict; the service never silently
 * resolves an alias and changes the user's merge intent.
 */
export const inboxV2ClientMergeRedirectSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ClientMergeRedirectIdSchema,
    sourceRoot: inboxV2ClientReferenceSchema,
    targetRoot: inboxV2ClientReferenceSchema,
    sourceRootVerification: inboxV2ClientMergeResolutionPathSchema,
    targetRootVerification: inboxV2ClientMergeResolutionPathSchema,
    sourceMaximumInboundDepth: inboxV2ClientMergeMaximumInboundDepthSchema,
    targetMaximumInboundDepth: inboxV2ClientMergeMaximumInboundDepthSchema,
    resultingMaximumInboundDepth: inboxV2ClientMergeMaximumInboundDepthSchema,
    decision: inboxV2ClientMergeDecisionSchema,
    expectedGraphRevision: inboxV2EntityRevisionSchema.nullable(),
    currentGraphRevision: inboxV2EntityRevisionSchema.nullable(),
    resultingGraphRevision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((redirect, context) => {
    addTenantReferenceIssue(context, redirect.tenantId, redirect.sourceRoot, [
      "sourceRoot"
    ]);
    addTenantReferenceIssue(context, redirect.tenantId, redirect.targetRoot, [
      "targetRoot"
    ]);
    addDecisionTenantIssues(context, redirect.tenantId, redirect.decision, [
      "decision"
    ]);

    if (sameClientReference(redirect.sourceRoot, redirect.targetRoot)) {
      addIssue(
        context,
        ["targetRoot"],
        "Client merge must attach two different current roots."
      );
    }

    addExactRootVerificationIssues(
      context,
      redirect.tenantId,
      redirect.sourceRoot,
      redirect.sourceRootVerification,
      redirect.sourceMaximumInboundDepth,
      ["sourceRootVerification"]
    );
    addExactRootVerificationIssues(
      context,
      redirect.tenantId,
      redirect.targetRoot,
      redirect.targetRootVerification,
      redirect.targetMaximumInboundDepth,
      ["targetRootVerification"]
    );

    if (
      !sameGraphHead(
        redirect.sourceRootVerification.graphHead,
        redirect.targetRootVerification.graphHead
      )
    ) {
      addIssue(
        context,
        ["targetRootVerification", "graphHead"],
        "Source and target roots must be verified at one exact graph head."
      );
    }
    if (
      !sameResolutionStamp(
        redirect.sourceRootVerification.resolutionStamp,
        redirect.targetRootVerification.resolutionStamp
      )
    ) {
      addIssue(
        context,
        ["targetRootVerification", "resolutionStamp"],
        "Source and target roots must use one trusted-service lookup stamp."
      );
    }

    if (
      redirect.decision.actor.kind !== "employee" &&
      redirect.decision.actor.trustedServiceId !==
        redirect.sourceRootVerification.resolutionStamp.trustedServiceId
    ) {
      addIssue(
        context,
        ["decision", "actor", "trustedServiceId"],
        "Automated Client merge actor must match the authoritative root resolver."
      );
    }

    const verifiedGraphRevision =
      redirect.sourceRootVerification.graphHead?.revision ?? null;
    if (
      redirect.expectedGraphRevision !== redirect.currentGraphRevision ||
      redirect.currentGraphRevision !== verifiedGraphRevision ||
      (redirect.currentGraphRevision === null
        ? redirect.resultingGraphRevision !== "1"
        : BigInt(redirect.resultingGraphRevision) !==
          BigInt(redirect.currentGraphRevision) + 1n)
    ) {
      addIssue(
        context,
        ["resultingGraphRevision"],
        "Client merge requires exact verified-head null-to-1 or n-to-n+1 CAS."
      );
    }

    const expectedMaximumInboundDepth = Math.max(
      redirect.targetMaximumInboundDepth,
      redirect.sourceMaximumInboundDepth + 1
    );
    if (
      expectedMaximumInboundDepth > INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH ||
      redirect.resultingMaximumInboundDepth !== expectedMaximumInboundDepth
    ) {
      addIssue(
        context,
        ["resultingMaximumInboundDepth"],
        "Client merge must preserve the exact bounded component depth."
      );
    }

    for (const [field, resolvedAt] of [
      [
        "sourceRootVerification",
        redirect.sourceRootVerification.resolutionStamp.resolvedAt
      ],
      [
        "targetRootVerification",
        redirect.targetRootVerification.resolutionStamp.resolvedAt
      ]
    ] as const) {
      if (!isInboxV2TimestampOrderValid(resolvedAt, redirect.createdAt)) {
        addIssue(
          context,
          [field, "resolutionStamp", "resolvedAt"],
          "Client merge cannot predate its authoritative root verification."
        );
      }
    }

    if (redirect.revision !== "1") {
      addIssue(
        context,
        ["revision"],
        "Immutable Client merge redirect starts and remains at revision 1."
      );
    }
  });

/**
 * Bounded atomic write contract. Persistence compares the exact before rows,
 * writes the exact derived after rows plus redirect, and CASes the tenant head
 * in one transaction. Individually valid NodeState rows are not a merge proof.
 */
export const inboxV2ClientMergeCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    graphHeadBefore: inboxV2ClientMergeGraphHeadSchema.nullable(),
    sourceNodeBefore: inboxV2CanonicalClientMergeNodeStateSchema,
    targetNodeBefore: inboxV2CanonicalClientMergeNodeStateSchema,
    redirect: inboxV2ClientMergeRedirectSchema,
    graphHeadAfter: inboxV2ClientMergeGraphHeadSchema,
    sourceNodeAfter: inboxV2RedirectedClientMergeNodeStateSchema,
    targetNodeAfter: inboxV2CanonicalClientMergeNodeStateSchema
  })
  .strict()
  .superRefine((commit, context) => {
    if (commit.redirect.tenantId !== commit.tenantId) {
      addIssue(
        context,
        ["redirect", "tenantId"],
        "Client merge commit and redirect must use one tenant."
      );
    }

    const verifiedSource =
      commit.redirect.sourceRootVerification.nodes[0] ?? null;
    const verifiedTarget =
      commit.redirect.targetRootVerification.nodes[0] ?? null;

    if (
      !sameGraphHead(
        commit.graphHeadBefore,
        commit.redirect.sourceRootVerification.graphHead
      )
    ) {
      addIssue(
        context,
        ["graphHeadBefore"],
        "Client merge commit must use the exact verified head before state."
      );
    }
    if (
      !verifiedSource ||
      !sameClientMergeNodeState(commit.sourceNodeBefore, verifiedSource)
    ) {
      addIssue(
        context,
        ["sourceNodeBefore"],
        "Client merge commit source before state must match its root verification."
      );
    }
    if (
      !verifiedTarget ||
      !sameClientMergeNodeState(commit.targetNodeBefore, verifiedTarget)
    ) {
      addIssue(
        context,
        ["targetNodeBefore"],
        "Client merge commit target before state must match its root verification."
      );
    }

    const expected = deriveClientMergeAfterState(
      commit.tenantId,
      commit.redirect,
      commit.sourceNodeBefore,
      commit.targetNodeBefore
    );

    if (!sameGraphHead(commit.graphHeadAfter, expected.graphHeadAfter)) {
      addIssue(
        context,
        ["graphHeadAfter"],
        "Client merge commit must advance the exact resulting tenant head."
      );
    }
    if (
      !sameClientMergeNodeState(
        commit.sourceNodeAfter,
        expected.sourceNodeAfter
      )
    ) {
      addIssue(
        context,
        ["sourceNodeAfter"],
        "Client merge commit must persist the exact redirected source state."
      );
    }
    if (
      !sameClientMergeNodeState(
        commit.targetNodeAfter,
        expected.targetNodeAfter
      )
    ) {
      addIssue(
        context,
        ["targetNodeAfter"],
        "Client merge commit must persist the exact resulting target-root depth."
      );
    }
  });

export const inboxV2CanonicalConversationClientLinkGroupSchema = z
  .object({
    canonicalClient: inboxV2ClientReferenceSchema,
    contributingLinks: z
      .array(inboxV2ConversationClientLinkReferenceSchema)
      .min(1)
      .max(INBOX_V2_CONVERSATION_CLIENT_CURRENT_LINK_PAGE_MAX),
    primaryLink: inboxV2ConversationClientLinkReferenceSchema.nullable()
  })
  .strict()
  .superRefine((group, context) => {
    const contributingLinkKeys = new Set<string>();

    for (const [index, link] of group.contributingLinks.entries()) {
      if (link.tenantId !== group.canonicalClient.tenantId) {
        addIssue(
          context,
          ["contributingLinks", index],
          "Canonical Client group must use one tenant."
        );
      }

      const key = `${link.tenantId}\u0000${link.id}`;
      if (contributingLinkKeys.has(key)) {
        addIssue(
          context,
          ["contributingLinks", index],
          "Canonical Client group contributing links must be unique."
        );
      }
      contributingLinkKeys.add(key);
    }
    if (
      group.primaryLink !== null &&
      (group.primaryLink.tenantId !== group.canonicalClient.tenantId ||
        !group.contributingLinks.some(
          (link) =>
            link.tenantId === group.primaryLink?.tenantId &&
            link.id === group.primaryLink.id
        ))
    ) {
      addIssue(
        context,
        ["primaryLink"],
        "Canonical Client group primary must be one contributing link."
      );
    }
  });

export const inboxV2CanonicalConversationClientLinkPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    conversation:
      inboxV2ConversationClientCurrentLinkPageSchema.shape.conversation,
    linkSetRevision: inboxV2EntityRevisionSchema.nullable(),
    mergeGraphRevision: inboxV2EntityRevisionSchema.nullable(),
    linkSetPrimaryLink: inboxV2ConversationClientLinkReferenceSchema.nullable(),
    primaryLinkIncluded: z.boolean(),
    resolutionStamp: inboxV2ClientMergeResolutionStampSchema,
    groups: z
      .array(inboxV2CanonicalConversationClientLinkGroupSchema)
      .max(INBOX_V2_CONVERSATION_CLIENT_CURRENT_LINK_PAGE_MAX)
  })
  .strict()
  .superRefine((page, context) => {
    addTenantReferenceIssue(context, page.tenantId, page.conversation, [
      "conversation"
    ]);
    if (page.linkSetPrimaryLink !== null) {
      addTenantReferenceIssue(context, page.tenantId, page.linkSetPrimaryLink, [
        "linkSetPrimaryLink"
      ]);
    }

    const canonicalClientIds = new Set<string>();
    const contributingLinkKeys = new Set<string>();
    let groupPrimaryLinkKey: string | null = null;

    for (const [index, group] of page.groups.entries()) {
      addTenantReferenceIssue(context, page.tenantId, group.canonicalClient, [
        "groups",
        index,
        "canonicalClient"
      ]);
      const clientId = String(group.canonicalClient.id);
      if (canonicalClientIds.has(clientId)) {
        addIssue(
          context,
          ["groups", index, "canonicalClient"],
          "Canonical Client page cannot repeat a resolved Client group."
        );
      }
      canonicalClientIds.add(clientId);

      for (const link of group.contributingLinks) {
        const linkKey = `${link.tenantId}\u0000${link.id}`;
        if (contributingLinkKeys.has(linkKey)) {
          addIssue(
            context,
            ["groups", index, "contributingLinks"],
            "Canonical Client page cannot place one link in multiple groups."
          );
        }
        contributingLinkKeys.add(linkKey);
      }

      if (group.primaryLink !== null) {
        const primaryKey = `${group.primaryLink.tenantId}\u0000${group.primaryLink.id}`;
        if (groupPrimaryLinkKey !== null) {
          addIssue(
            context,
            ["groups", index, "primaryLink"],
            "Canonical Client page can contain at most one page-local primary."
          );
        }
        groupPrimaryLinkKey = primaryKey;
      }
    }

    const pagePrimaryLinkKey =
      page.linkSetPrimaryLink === null
        ? null
        : `${page.linkSetPrimaryLink.tenantId}\u0000${page.linkSetPrimaryLink.id}`;
    const pageContainsPrimary =
      pagePrimaryLinkKey !== null &&
      contributingLinkKeys.has(pagePrimaryLinkKey);

    if (page.primaryLinkIncluded !== pageContainsPrimary) {
      addIssue(
        context,
        ["primaryLinkIncluded"],
        "Canonical Client page must state exactly whether its global primary link is included in this page."
      );
    }
    if (
      (groupPrimaryLinkKey !== null &&
        groupPrimaryLinkKey !== pagePrimaryLinkKey) ||
      (pageContainsPrimary && groupPrimaryLinkKey !== pagePrimaryLinkKey)
    ) {
      addIssue(
        context,
        ["groups"],
        "Page-local primary must exactly match the link-set primary when that link is present in the page."
      );
    }
    if (
      page.linkSetRevision === null &&
      (page.linkSetPrimaryLink !== null ||
        page.primaryLinkIncluded ||
        page.groups.length !== 0)
    ) {
      addIssue(
        context,
        ["linkSetRevision"],
        "An untouched Client-link set cannot produce canonical groups or a primary."
      );
    }
  });

export const inboxV2ClientMergeRedirectEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_ID,
    INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_VERSION,
    inboxV2ClientMergeRedirectSchema
  );
export const inboxV2ClientMergeGraphHeadEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CLIENT_MERGE_GRAPH_HEAD_SCHEMA_ID,
    INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_VERSION,
    inboxV2ClientMergeGraphHeadSchema
  );
export const inboxV2ClientMergeNodeStateEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CLIENT_MERGE_NODE_STATE_SCHEMA_ID,
    INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_VERSION,
    inboxV2ClientMergeNodeStateSchema
  );
export const inboxV2ClientMergeCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CLIENT_MERGE_COMMIT_SCHEMA_ID,
    INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_VERSION,
    inboxV2ClientMergeCommitSchema
  );

export type InboxV2ClientMergeDecision = z.infer<
  typeof inboxV2ClientMergeDecisionSchema
>;
export type InboxV2ClientMergeGraphHead = z.infer<
  typeof inboxV2ClientMergeGraphHeadSchema
>;
export type InboxV2ClientMergeResolutionStamp = z.infer<
  typeof inboxV2ClientMergeResolutionStampSchema
>;
export type InboxV2ClientMergeNodeState = z.infer<
  typeof inboxV2ClientMergeNodeStateSchema
>;
export type InboxV2ClientMergeResolutionPath = z.infer<
  typeof inboxV2ClientMergeResolutionPathSchema
>;
export type InboxV2ClientMergeResolutionBatch = z.infer<
  typeof inboxV2ClientMergeResolutionBatchSchema
>;
export type InboxV2ClientMergeRedirect = z.infer<
  typeof inboxV2ClientMergeRedirectSchema
>;
export type InboxV2ClientMergeCommit = z.infer<
  typeof inboxV2ClientMergeCommitSchema
>;
export type InboxV2CanonicalConversationClientLinkGroup = z.infer<
  typeof inboxV2CanonicalConversationClientLinkGroupSchema
>;
export type InboxV2CanonicalConversationClientLinkPage = z.infer<
  typeof inboxV2CanonicalConversationClientLinkPageSchema
>;

/** Deterministically derives the only legal atomic after-state for a redirect. */
export function deriveInboxV2ClientMergeCommit(input: {
  redirect: z.input<typeof inboxV2ClientMergeRedirectSchema>;
}): InboxV2ClientMergeCommit {
  const redirect = inboxV2ClientMergeRedirectSchema.parse(input.redirect);
  const sourceNodeBefore = inboxV2CanonicalClientMergeNodeStateSchema.parse(
    redirect.sourceRootVerification.nodes[0]
  );
  const targetNodeBefore = inboxV2CanonicalClientMergeNodeStateSchema.parse(
    redirect.targetRootVerification.nodes[0]
  );
  const after = deriveClientMergeAfterState(
    redirect.tenantId,
    redirect,
    sourceNodeBefore,
    targetNodeBefore
  );

  return inboxV2ClientMergeCommitSchema.parse({
    tenantId: redirect.tenantId,
    graphHeadBefore: redirect.sourceRootVerification.graphHead,
    sourceNodeBefore,
    targetNodeBefore,
    redirect,
    ...after
  });
}

/** Resolution changes current CRM display/targeting only; it grants nothing. */
export function resolveInboxV2CanonicalClientReference(input: {
  resolution: z.input<typeof inboxV2ClientMergeResolutionPathSchema>;
}): InboxV2ClientReference {
  return inboxV2ClientMergeResolutionPathSchema.parse(input.resolution)
    .canonicalClient;
}

/**
 * Coalesces one bounded active-link page at exact link-set and merge-graph
 * fences. Larger reads combine pages only while both revisions remain stable.
 */
export function resolveInboxV2CanonicalConversationClientLinkGroups(input: {
  linkPage: z.input<typeof inboxV2ConversationClientCurrentLinkPageSchema>;
  resolutionBatch: z.input<typeof inboxV2ClientMergeResolutionBatchSchema>;
}): InboxV2CanonicalConversationClientLinkPage {
  const linkPage = inboxV2ConversationClientCurrentLinkPageSchema.parse(
    input.linkPage
  );
  const resolutionBatch = inboxV2ClientMergeResolutionBatchSchema.parse(
    input.resolutionBatch
  );

  if (linkPage.conversation.tenantId !== resolutionBatch.tenantId) {
    throw new Error("Canonical Client grouping requires one tenant.");
  }

  const linkClientIds = new Set(
    linkPage.links.map((link) => String(link.client.id))
  );
  const resolutions = new Map(
    resolutionBatch.resolutions.map((resolution) => [
      String(resolution.requestedClient.id),
      resolution
    ])
  );

  if (
    resolutions.size !== linkClientIds.size ||
    [...resolutions.keys()].some((clientId) => !linkClientIds.has(clientId)) ||
    [...linkClientIds].some((clientId) => !resolutions.has(clientId))
  ) {
    throw new Error(
      "Canonical Client grouping requires exactly one resolution for every linked Client and no extras."
    );
  }

  const groups = new Map<string, InboxV2CanonicalConversationClientLinkGroup>();
  const primaryLinkId = linkPage.linkSetHead?.primaryLink?.id ?? null;

  for (const link of linkPage.links) {
    const resolution = resolutions.get(String(link.client.id));
    if (!resolution) {
      throw new Error("Linked Client resolution is missing.");
    }

    const canonicalClient = resolution.canonicalClient;
    const linkReference = inboxV2ConversationClientLinkReferenceSchema.parse({
      tenantId: link.tenantId,
      kind: "conversation_client_link",
      id: link.id
    });
    const key = String(canonicalClient.id);
    const existing = groups.get(key);

    if (existing) {
      existing.contributingLinks.push(linkReference);
      if (link.id === primaryLinkId) {
        existing.primaryLink = linkReference;
      }
    } else {
      groups.set(key, {
        canonicalClient,
        contributingLinks: [linkReference],
        primaryLink: link.id === primaryLinkId ? linkReference : null
      });
    }
  }

  const canonicalGroups = [...groups.values()]
    .map((group) => ({
      ...group,
      contributingLinks: [...group.contributingLinks].sort((left, right) =>
        String(left.id).localeCompare(String(right.id))
      )
    }))
    .sort((left, right) =>
      String(left.canonicalClient.id).localeCompare(
        String(right.canonicalClient.id)
      )
    );

  return inboxV2CanonicalConversationClientLinkPageSchema.parse({
    tenantId: linkPage.conversation.tenantId,
    conversation: linkPage.conversation,
    linkSetRevision: linkPage.linkSetRevision,
    mergeGraphRevision: resolutionBatch.graphHead?.revision ?? null,
    linkSetPrimaryLink: linkPage.linkSetHead?.primaryLink ?? null,
    primaryLinkIncluded:
      primaryLinkId !== null &&
      linkPage.links.some((link) => link.id === primaryLinkId),
    resolutionStamp: resolutionBatch.resolutionStamp,
    groups: canonicalGroups
  });
}

function deriveClientMergeAfterState(
  tenantId: string,
  redirect: InboxV2ClientMergeRedirect,
  sourceNodeBefore: z.infer<typeof inboxV2CanonicalClientMergeNodeStateSchema>,
  targetNodeBefore: z.infer<typeof inboxV2CanonicalClientMergeNodeStateSchema>
) {
  const graphHeadAfter = inboxV2ClientMergeGraphHeadSchema.parse({
    tenantId,
    revision: redirect.resultingGraphRevision,
    updatedAt: redirect.createdAt
  });
  const sourceNodeAfter = inboxV2RedirectedClientMergeNodeStateSchema.parse({
    tenantId,
    client: redirect.sourceRoot,
    state: "redirected",
    nextClient: redirect.targetRoot,
    redirect: {
      tenantId,
      kind: "client_merge_redirect",
      id: redirect.id
    },
    maximumInboundDepth: redirect.sourceMaximumInboundDepth,
    revision: incrementEntityRevision(sourceNodeBefore.revision),
    lastGraphRevision: redirect.resultingGraphRevision,
    updatedAt: redirect.createdAt
  });
  const targetNodeAfter = inboxV2CanonicalClientMergeNodeStateSchema.parse({
    tenantId,
    client: redirect.targetRoot,
    state: "canonical_root",
    nextClient: null,
    redirect: null,
    maximumInboundDepth: redirect.resultingMaximumInboundDepth,
    revision: incrementEntityRevision(targetNodeBefore.revision),
    lastGraphRevision: redirect.resultingGraphRevision,
    updatedAt: redirect.createdAt
  });

  return { graphHeadAfter, sourceNodeAfter, targetNodeAfter };
}

function addResolutionPathIssues(
  resolution: InboxV2ClientMergeResolutionPath,
  context: z.RefinementCtx
): void {
  addTenantReferenceIssue(
    context,
    resolution.tenantId,
    resolution.requestedClient,
    ["requestedClient"]
  );
  addTenantReferenceIssue(
    context,
    resolution.tenantId,
    resolution.canonicalClient,
    ["canonicalClient"]
  );
  if (
    resolution.graphHead !== null &&
    resolution.graphHead.tenantId !== resolution.tenantId
  ) {
    addIssue(
      context,
      ["graphHead", "tenantId"],
      "Client merge resolution head must use the resolution tenant."
    );
  }
  if (
    resolution.graphHead !== null &&
    !isInboxV2TimestampOrderValid(
      resolution.graphHead.updatedAt,
      resolution.resolutionStamp.resolvedAt
    )
  ) {
    addIssue(
      context,
      ["resolutionStamp", "resolvedAt"],
      "Client merge resolution cannot predate its graph-head snapshot."
    );
  }
  if (
    resolution.graphHead !== null &&
    BigInt(resolution.graphHead.revision) < BigInt(resolution.nodes.length - 1)
  ) {
    addIssue(
      context,
      ["graphHead", "revision"],
      "Client merge head revision cannot contain fewer commits than the observed path edges."
    );
  }

  const seenClients = new Set<string>();
  for (const [index, node] of resolution.nodes.entries()) {
    if (node.tenantId !== resolution.tenantId) {
      addIssue(
        context,
        ["nodes", index, "tenantId"],
        "Client merge resolution path must contain one tenant."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        node.updatedAt,
        resolution.resolutionStamp.resolvedAt
      )
    ) {
      addIssue(
        context,
        ["nodes", index, "updatedAt"],
        "Client merge resolution cannot predate a node-state snapshot."
      );
    }

    const clientId = String(node.client.id);
    if (seenClients.has(clientId)) {
      addIssue(
        context,
        ["nodes", index, "client"],
        "Client merge resolution path cannot repeat a Client."
      );
    }
    seenClients.add(clientId);

    if (resolution.graphHead === null) {
      if (node.lastGraphRevision !== null) {
        addIssue(
          context,
          ["nodes", index, "lastGraphRevision"],
          "An untouched merge graph cannot contain a graph-mutated node."
        );
      }
    } else if (
      node.lastGraphRevision !== null &&
      BigInt(node.lastGraphRevision) > BigInt(resolution.graphHead.revision)
    ) {
      addIssue(
        context,
        ["nodes", index, "lastGraphRevision"],
        "Client merge node cannot be newer than the resolution graph head."
      );
    } else if (
      node.lastGraphRevision !== null &&
      !isInboxV2TimestampOrderValid(
        node.updatedAt,
        resolution.graphHead.updatedAt
      )
    ) {
      addIssue(
        context,
        ["nodes", index, "updatedAt"],
        "A merge-mutated node cannot postdate its resolution graph head."
      );
    }

    if (node.maximumInboundDepth < index) {
      addIssue(
        context,
        ["nodes", index, "maximumInboundDepth"],
        "Client merge node depth must cover the observed inbound path distance."
      );
    }
    const previousNode = resolution.nodes[index - 1];
    if (
      previousNode?.lastGraphRevision !== null &&
      previousNode?.lastGraphRevision !== undefined &&
      node.lastGraphRevision !== null &&
      (node.state === "redirected"
        ? BigInt(node.lastGraphRevision) <=
          BigInt(previousNode.lastGraphRevision)
        : BigInt(node.lastGraphRevision) <
          BigInt(previousNode.lastGraphRevision))
    ) {
      addIssue(
        context,
        ["nodes", index, "lastGraphRevision"],
        "Redirect commits must increase strictly along a path; only the terminal root may share the final edge revision."
      );
    }

    const nextNode = resolution.nodes[index + 1];
    if (nextNode) {
      if (
        node.state !== "redirected" ||
        !sameClientReference(node.nextClient, nextNode.client)
      ) {
        addIssue(
          context,
          ["nodes", index],
          "Every non-terminal resolution node must point to the next Client."
        );
      }
    } else if (node.state !== "canonical_root") {
      addIssue(
        context,
        ["nodes", index, "state"],
        "Authoritative resolution must terminate at an explicit canonical root."
      );
    }
  }

  const firstNode = resolution.nodes[0];
  const finalNode = resolution.nodes.at(-1);
  if (
    !firstNode ||
    !sameClientReference(firstNode.client, resolution.requestedClient)
  ) {
    addIssue(
      context,
      ["nodes", 0, "client"],
      "Resolution path must start at the exact requested Client."
    );
  }
  if (
    !finalNode ||
    !sameClientReference(finalNode.client, resolution.canonicalClient)
  ) {
    addIssue(
      context,
      ["canonicalClient"],
      "Resolution canonical Client must be the explicit terminal root."
    );
  }
}

function addExactRootVerificationIssues(
  context: z.RefinementCtx,
  tenantId: string,
  root: InboxV2ClientReference,
  verification: InboxV2ClientMergeResolutionPath,
  maximumInboundDepth: number,
  path: PropertyKey[]
): void {
  const node = verification.nodes[0];
  if (
    verification.tenantId !== tenantId ||
    verification.nodes.length !== 1 ||
    !sameClientReference(verification.requestedClient, root) ||
    !sameClientReference(verification.canonicalClient, root) ||
    !node ||
    node.state !== "canonical_root" ||
    !sameClientReference(node.client, root)
  ) {
    addIssue(
      context,
      path,
      "Client merge event requires an exact one-node canonical-root verification."
    );
    return;
  }
  if (node.maximumInboundDepth !== maximumInboundDepth) {
    addIssue(
      context,
      [...path, "nodes", 0, "maximumInboundDepth"],
      "Client merge depth must match the authoritative root state."
    );
  }
}

function addDecisionTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  decision: InboxV2ClientMergeDecision,
  path: PropertyKey[]
): void {
  if (
    decision.actor.kind === "employee" &&
    decision.actor.employee.tenantId !== tenantId
  ) {
    addIssue(
      context,
      [...path, "actor", "employee"],
      "Client merge Employee actor must use the entity tenant."
    );
  }
}

function sameClientReference(
  left: InboxV2ClientReference,
  right: InboxV2ClientReference
): boolean {
  return left.tenantId === right.tenantId && left.id === right.id;
}

function sameGraphHead(
  left: InboxV2ClientMergeGraphHead | null,
  right: InboxV2ClientMergeGraphHead | null
): boolean {
  return left === null || right === null
    ? left === right
    : left.tenantId === right.tenantId &&
        left.revision === right.revision &&
        left.updatedAt === right.updatedAt;
}

function sameResolutionStamp(
  left: InboxV2ClientMergeResolutionStamp,
  right: InboxV2ClientMergeResolutionStamp
): boolean {
  return (
    left.kind === right.kind &&
    left.trustedServiceId === right.trustedServiceId &&
    left.resolvedAt === right.resolvedAt
  );
}

function sameClientMergeNodeState(
  left: InboxV2ClientMergeNodeState,
  right: InboxV2ClientMergeNodeState
): boolean {
  if (
    left.tenantId !== right.tenantId ||
    !sameClientReference(left.client, right.client) ||
    left.state !== right.state ||
    left.maximumInboundDepth !== right.maximumInboundDepth ||
    left.revision !== right.revision ||
    left.lastGraphRevision !== right.lastGraphRevision ||
    left.updatedAt !== right.updatedAt
  ) {
    return false;
  }

  if (left.state === "canonical_root") {
    return right.state === "canonical_root";
  }

  return (
    right.state === "redirected" &&
    sameClientReference(left.nextClient, right.nextClient) &&
    left.redirect.tenantId === right.redirect.tenantId &&
    left.redirect.id === right.redirect.id
  );
}

function incrementEntityRevision(revision: string): string {
  return inboxV2EntityRevisionSchema.parse((BigInt(revision) + 1n).toString());
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

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
