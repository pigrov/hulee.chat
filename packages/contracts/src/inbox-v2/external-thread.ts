import { z } from "zod";

import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2ConversationSchema,
  inboxV2ConversationTopologySchema
} from "./conversation";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ConversationReferenceSchema,
  inboxV2ExternalThreadAliasIdSchema,
  inboxV2ExternalThreadIdSchema,
  inboxV2ExternalThreadReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2ExternalThreadObjectKindIdSchema,
  inboxV2ExternalThreadRealmIdSchema,
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  type InboxV2AdapterIdentityDeclaration
} from "./source-routing-primitives";

export const INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID =
  "core:inbox-v2.external-thread" as const;
export const INBOX_V2_EXTERNAL_THREAD_MAPPING_SCHEMA_ID =
  "core:inbox-v2.external-thread-mapping" as const;
export const INBOX_V2_EXTERNAL_THREAD_ALIAS_SCHEMA_ID =
  "core:inbox-v2.external-thread-alias" as const;
export const INBOX_V2_EXTERNAL_THREAD_ALIAS_COMMIT_SCHEMA_ID =
  "core:inbox-v2.external-thread-alias-commit" as const;
export const INBOX_V2_EXTERNAL_THREAD_RESOLUTION_SCHEMA_ID =
  "core:inbox-v2.external-thread-resolution" as const;
export const INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_EXTERNAL_THREAD_ALIAS_POLICY_CATALOG =
  "external-thread-alias-policy" as const;
export const INBOX_V2_EXTERNAL_THREAD_ALIAS_REASON_CATALOG =
  "external-thread-alias-reason" as const;
export const INBOX_V2_EXTERNAL_THREAD_ALIAS_COMMIT_MAX = 16;

export type InboxV2ExternalThreadAliasPolicyId = InboxV2CatalogId<
  typeof INBOX_V2_EXTERNAL_THREAD_ALIAS_POLICY_CATALOG
>;
export type InboxV2ExternalThreadAliasReasonId = InboxV2CatalogId<
  typeof INBOX_V2_EXTERNAL_THREAD_ALIAS_REASON_CATALOG
>;

export const inboxV2ExternalThreadAliasPolicyIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ExternalThreadAliasPolicyId
  );
export const inboxV2ExternalThreadAliasReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ExternalThreadAliasReasonId
  );

export const inboxV2ExternalThreadRealmSchema = z
  .object({
    realmId: inboxV2ExternalThreadRealmIdSchema,
    realmVersion: inboxV2SchemaVersionTokenSchema,
    canonicalizationVersion: inboxV2SchemaVersionTokenSchema
  })
  .strict();

export const inboxV2ExternalThreadScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("provider") }).strict(),
  z
    .object({
      kind: z.literal("source_connection"),
      owner: inboxV2SourceConnectionReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("source_account"),
      owner: inboxV2SourceAccountReferenceSchema
    })
    .strict()
]);

/**
 * Stable identity fields only. The pinned declaration proves that a trusted
 * adapter may emit this key, but its load timestamp/revision is not part of the
 * database uniqueness key and cannot split a thread after adapter upgrade.
 */
export const inboxV2ExternalThreadKeySchema = z
  .object({
    realm: inboxV2ExternalThreadRealmSchema,
    scope: inboxV2ExternalThreadScopeSchema,
    objectKindId: inboxV2ExternalThreadObjectKindIdSchema,
    canonicalExternalSubject: inboxV2OpaqueProviderSubjectSchema
  })
  .strict();

export const inboxV2ExternalThreadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ExternalThreadIdSchema,
    key: inboxV2ExternalThreadKeySchema,
    identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    conversation: inboxV2ConversationReferenceSchema,
    conversationTopology: inboxV2ConversationTopologySchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((thread, context) => {
    addTenantReferenceIssue(context, thread.tenantId, thread.conversation, [
      "conversation"
    ]);
    addThreadKeyTenantIssues(context, thread.tenantId, thread.key, ["key"]);
    addThreadDeclarationIssues(
      context,
      thread.identityDeclaration,
      thread.key,
      ["identityDeclaration"]
    );

    if (thread.revision !== "1" || thread.createdAt !== thread.updatedAt) {
      addIssue(
        context,
        ["revision"],
        "ExternalThread identity and Conversation mapping are immutable revision 1 facts."
      );
    }
  });

/**
 * Bounded cross-aggregate proof for the exact one-way mapping. Database
 * uniqueness later enforces one thread per Conversation and one Conversation
 * per exact key without exposing a tenant-wide graph contract.
 */
export const inboxV2ExternalThreadMappingSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    thread: inboxV2ExternalThreadSchema,
    conversation: inboxV2ConversationSchema
  })
  .strict()
  .superRefine((mapping, context) => {
    if (
      mapping.thread.tenantId !== mapping.tenantId ||
      mapping.conversation.tenantId !== mapping.tenantId
    ) {
      addIssue(
        context,
        ["tenantId"],
        "External thread mapping tenant mismatch."
      );
    }
    if (
      mapping.thread.conversation.id !== mapping.conversation.id ||
      mapping.thread.conversation.tenantId !== mapping.conversation.tenantId
    ) {
      addIssue(
        context,
        ["thread", "conversation"],
        "ExternalThread must reference the exact mapped Conversation."
      );
    }
    if (mapping.conversation.transport !== "external") {
      addIssue(
        context,
        ["conversation", "transport"],
        "An internal Conversation cannot have an ExternalThread."
      );
    }
    if (mapping.thread.conversationTopology !== mapping.conversation.topology) {
      addIssue(
        context,
        ["thread", "conversationTopology"],
        "ExternalThread topology must match its canonical Conversation."
      );
    }
  });

export const inboxV2ExternalThreadAliasDecisionSchema = z
  .object({
    actor: z
      .object({
        kind: z.literal("trusted_service"),
        trustedServiceId: inboxV2RoutingTrustedServiceIdSchema
      })
      .strict(),
    policyId: inboxV2ExternalThreadAliasPolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    reasonCodeId: inboxV2ExternalThreadAliasReasonIdSchema,
    authoritativeEvidenceToken: inboxV2RoutingTokenSchema,
    decidedAt: inboxV2TimestampSchema
  })
  .strict();

/**
 * Alias always targets an ExternalThread anchor directly. It cannot target
 * another alias, so ordinary resolution cannot form chains or cycles.
 */
export const inboxV2ExternalThreadAliasSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ExternalThreadAliasIdSchema,
    aliasKey: inboxV2ExternalThreadKeySchema,
    aliasIdentityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    canonicalThread: inboxV2ExternalThreadReferenceSchema,
    canonicalConversation: inboxV2ConversationReferenceSchema,
    canonicalKeySnapshot: inboxV2ExternalThreadKeySchema,
    expectedCanonicalThreadRevision: inboxV2EntityRevisionSchema,
    decision: inboxV2ExternalThreadAliasDecisionSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((alias, context) => {
    addTenantReferenceIssue(context, alias.tenantId, alias.canonicalThread, [
      "canonicalThread"
    ]);
    addTenantReferenceIssue(
      context,
      alias.tenantId,
      alias.canonicalConversation,
      ["canonicalConversation"]
    );
    addThreadKeyTenantIssues(context, alias.tenantId, alias.aliasKey, [
      "aliasKey"
    ]);
    addThreadKeyTenantIssues(
      context,
      alias.tenantId,
      alias.canonicalKeySnapshot,
      ["canonicalKeySnapshot"]
    );
    addThreadDeclarationIssues(
      context,
      alias.aliasIdentityDeclaration,
      alias.aliasKey,
      ["aliasIdentityDeclaration"]
    );

    if (alias.aliasIdentityDeclaration.decisionStrength !== "authoritative") {
      addIssue(
        context,
        ["aliasIdentityDeclaration", "decisionStrength"],
        "Thread alias creation requires authoritative adapter evidence."
      );
    }
    if (sameExternalThreadKey(alias.aliasKey, alias.canonicalKeySnapshot)) {
      addIssue(
        context,
        ["aliasKey"],
        "Thread alias key must differ from its canonical key snapshot."
      );
    }
    if (alias.revision !== "1") {
      addIssue(
        context,
        ["revision"],
        "External thread aliases are immutable revision 1 rows."
      );
    }
    if (alias.decision.decidedAt !== alias.createdAt) {
      addIssue(
        context,
        ["createdAt"],
        "Thread alias time must equal its authoritative decision time."
      );
    }
    if (
      alias.decision.actor.trustedServiceId !==
      alias.aliasIdentityDeclaration.adapterContract.loadedByTrustedServiceId
    ) {
      addIssue(
        context,
        ["decision", "actor", "trustedServiceId"],
        "Thread alias decision must use the trusted service pinned by the exact alias declaration."
      );
    }
  });

/** Bounded alias insertion transaction; never a tenant/lifetime alias graph. */
export const inboxV2ExternalThreadAliasCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    canonicalThreadSnapshot: inboxV2ExternalThreadSchema,
    expectedCanonicalThreadRevision: inboxV2EntityRevisionSchema,
    currentCanonicalThreadRevision: inboxV2EntityRevisionSchema,
    aliases: z
      .array(inboxV2ExternalThreadAliasSchema)
      .min(1)
      .max(INBOX_V2_EXTERNAL_THREAD_ALIAS_COMMIT_MAX),
    committedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const thread = commit.canonicalThreadSnapshot;
    if (thread.tenantId !== commit.tenantId) {
      addIssue(
        context,
        ["canonicalThreadSnapshot", "tenantId"],
        "Alias commit tenant mismatch."
      );
    }
    if (
      commit.expectedCanonicalThreadRevision !==
        commit.currentCanonicalThreadRevision ||
      commit.currentCanonicalThreadRevision !== thread.revision
    ) {
      addIssue(
        context,
        ["currentCanonicalThreadRevision"],
        "Alias commit must fence the exact canonical thread revision."
      );
    }
    if (!isInboxV2TimestampOrderValid(thread.createdAt, commit.committedAt)) {
      addIssue(
        context,
        ["committedAt"],
        "Alias commit cannot precede the canonical thread."
      );
    }

    const aliasIds = new Set<string>();
    const aliasKeys = new Set<string>();
    for (const [index, alias] of commit.aliases.entries()) {
      if (aliasIds.has(alias.id)) {
        addIssue(
          context,
          ["aliases", index, "id"],
          "Alias IDs must be unique in one commit."
        );
      }
      aliasIds.add(alias.id);

      const aliasFingerprint = externalThreadKeyFingerprint(alias.aliasKey);
      if (aliasKeys.has(aliasFingerprint)) {
        addIssue(
          context,
          ["aliases", index, "aliasKey"],
          "One commit cannot map the same exact alias key twice."
        );
      }
      aliasKeys.add(aliasFingerprint);

      if (
        alias.tenantId !== thread.tenantId ||
        alias.canonicalThread.id !== thread.id ||
        alias.canonicalConversation.id !== thread.conversation.id ||
        alias.expectedCanonicalThreadRevision !== thread.revision ||
        !sameExternalThreadKey(alias.canonicalKeySnapshot, thread.key)
      ) {
        addIssue(
          context,
          ["aliases", index],
          "Alias must target the exact fenced canonical thread/key/Conversation snapshot."
        );
      }
      if (alias.createdAt !== commit.committedAt) {
        addIssue(
          context,
          ["aliases", index, "createdAt"],
          "Alias timestamp must equal its bounded commit time."
        );
      }
    }
  });

const externalThreadResolutionCommonShape = {
  tenantId: inboxV2TenantIdSchema,
  requestedKey: inboxV2ExternalThreadKeySchema,
  requestIdentityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
  mapping: inboxV2ExternalThreadMappingSchema,
  resolvedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
  resolutionToken: inboxV2RoutingTokenSchema,
  resolvedAt: inboxV2TimestampSchema
};

/**
 * One bounded resolution result. Caller-provided Client, sender, title, phone,
 * current Conversation or first/latest account fields are absent by design.
 */
export const inboxV2ExternalThreadResolutionSchema = z
  .discriminatedUnion("resolution", [
    z
      .object({
        ...externalThreadResolutionCommonShape,
        resolution: z.literal("created"),
        matchedAlias: z.null()
      })
      .strict(),
    z
      .object({
        ...externalThreadResolutionCommonShape,
        resolution: z.literal("matched_canonical"),
        matchedAlias: z.null()
      })
      .strict(),
    z
      .object({
        ...externalThreadResolutionCommonShape,
        resolution: z.literal("matched_alias"),
        matchedAlias: inboxV2ExternalThreadAliasSchema
      })
      .strict()
  ])
  .superRefine((resolution, context) => {
    if (
      resolution.tenantId !== resolution.mapping.tenantId ||
      resolution.mapping.thread.tenantId !== resolution.tenantId
    ) {
      addIssue(context, ["tenantId"], "Thread resolution tenant mismatch.");
    }
    addThreadKeyTenantIssues(
      context,
      resolution.tenantId,
      resolution.requestedKey,
      ["requestedKey"]
    );
    addThreadDeclarationIssues(
      context,
      resolution.requestIdentityDeclaration,
      resolution.requestedKey,
      ["requestIdentityDeclaration"]
    );
    if (
      resolution.resolvedByTrustedServiceId !==
      resolution.requestIdentityDeclaration.adapterContract
        .loadedByTrustedServiceId
    ) {
      addIssue(
        context,
        ["resolvedByTrustedServiceId"],
        "Thread resolution must use the trusted service pinned by the exact request declaration."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        resolution.mapping.thread.createdAt,
        resolution.resolvedAt
      )
    ) {
      addIssue(
        context,
        ["resolvedAt"],
        "Thread resolution cannot precede the canonical thread."
      );
    }

    if (resolution.resolution === "matched_alias") {
      const alias = resolution.matchedAlias;
      if (
        alias.tenantId !== resolution.tenantId ||
        !sameExternalThreadKey(alias.aliasKey, resolution.requestedKey) ||
        alias.canonicalThread.id !== resolution.mapping.thread.id ||
        alias.canonicalConversation.id !== resolution.mapping.conversation.id ||
        !sameExternalThreadKey(
          alias.canonicalKeySnapshot,
          resolution.mapping.thread.key
        )
      ) {
        addIssue(
          context,
          ["matchedAlias"],
          "Alias resolution must directly target the exact canonical mapping."
        );
      }
      if (
        !isInboxV2TimestampOrderValid(alias.createdAt, resolution.resolvedAt)
      ) {
        addIssue(
          context,
          ["resolvedAt"],
          "Alias resolution cannot precede alias creation."
        );
      }
      return;
    }

    if (
      !sameExternalThreadKey(
        resolution.requestedKey,
        resolution.mapping.thread.key
      )
    ) {
      addIssue(
        context,
        ["requestedKey"],
        "Created/canonical match requires the exact case-preserving thread key."
      );
    }
    if (
      resolution.resolution === "created" &&
      !sameAdapterDeclaration(
        resolution.requestIdentityDeclaration,
        resolution.mapping.thread.identityDeclaration
      )
    ) {
      addIssue(
        context,
        ["requestIdentityDeclaration"],
        "Created thread must retain the exact pinned request declaration."
      );
    }
  });

export const inboxV2ExternalThreadEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
    INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
    inboxV2ExternalThreadSchema
  );
export const inboxV2ExternalThreadMappingEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_EXTERNAL_THREAD_MAPPING_SCHEMA_ID,
    INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
    inboxV2ExternalThreadMappingSchema
  );
export const inboxV2ExternalThreadAliasEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_EXTERNAL_THREAD_ALIAS_SCHEMA_ID,
    INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
    inboxV2ExternalThreadAliasSchema
  );
export const inboxV2ExternalThreadAliasCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_EXTERNAL_THREAD_ALIAS_COMMIT_SCHEMA_ID,
    INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
    inboxV2ExternalThreadAliasCommitSchema
  );
export const inboxV2ExternalThreadResolutionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_EXTERNAL_THREAD_RESOLUTION_SCHEMA_ID,
    INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
    inboxV2ExternalThreadResolutionSchema
  );

export type InboxV2ExternalThreadRealm = z.infer<
  typeof inboxV2ExternalThreadRealmSchema
>;
export type InboxV2ExternalThreadScope = z.infer<
  typeof inboxV2ExternalThreadScopeSchema
>;
export type InboxV2ExternalThreadKey = z.infer<
  typeof inboxV2ExternalThreadKeySchema
>;
export type InboxV2ExternalThread = z.infer<typeof inboxV2ExternalThreadSchema>;
export type InboxV2ExternalThreadMapping = z.infer<
  typeof inboxV2ExternalThreadMappingSchema
>;
export type InboxV2ExternalThreadAliasDecision = z.infer<
  typeof inboxV2ExternalThreadAliasDecisionSchema
>;
export type InboxV2ExternalThreadAlias = z.infer<
  typeof inboxV2ExternalThreadAliasSchema
>;
export type InboxV2ExternalThreadAliasCommit = z.infer<
  typeof inboxV2ExternalThreadAliasCommitSchema
>;
export type InboxV2ExternalThreadResolution = z.infer<
  typeof inboxV2ExternalThreadResolutionSchema
>;

function addThreadDeclarationIssues(
  context: z.RefinementCtx,
  declaration: InboxV2AdapterIdentityDeclaration,
  key: z.infer<typeof inboxV2ExternalThreadKeySchema>,
  path: (string | number)[]
): void {
  if (declaration.identityKind !== "external_thread") {
    addIssue(
      context,
      [...path, "identityKind"],
      "External thread key requires an external_thread adapter declaration."
    );
  }
  if (
    declaration.realmId !== key.realm.realmId ||
    declaration.realmVersion !== key.realm.realmVersion ||
    declaration.canonicalizationVersion !== key.realm.canonicalizationVersion ||
    declaration.objectKindId !== key.objectKindId ||
    declaration.scopeKind !== key.scope.kind
  ) {
    addIssue(
      context,
      path,
      "Adapter declaration must exactly match thread realm, object kind, canonicalization and scope."
    );
  }
  if (
    key.scope.kind === "provider" &&
    declaration.decisionStrength !== "authoritative"
  ) {
    addIssue(
      context,
      [...path, "decisionStrength"],
      "Provider-wide thread scope requires authoritative pinned evidence."
    );
  }
  if (
    declaration.decisionStrength === "safe_default" &&
    key.scope.kind !== "source_account"
  ) {
    addIssue(
      context,
      [...path, "decisionStrength"],
      "Unknown thread scope may only use the safe source_account default."
    );
  }
}

function addThreadKeyTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  key: z.infer<typeof inboxV2ExternalThreadKeySchema>,
  path: (string | number)[]
): void {
  if (key.scope.kind !== "provider") {
    addTenantReferenceIssue(context, tenantId, key.scope.owner, [
      ...path,
      "scope",
      "owner"
    ]);
  }
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: (string | number)[]
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
  path: (string | number)[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function sameExternalThreadKey(
  left: z.infer<typeof inboxV2ExternalThreadKeySchema>,
  right: z.infer<typeof inboxV2ExternalThreadKeySchema>
): boolean {
  return (
    externalThreadKeyFingerprint(left) === externalThreadKeyFingerprint(right)
  );
}

function externalThreadKeyFingerprint(
  key: z.infer<typeof inboxV2ExternalThreadKeySchema>
): string {
  return JSON.stringify([
    key.realm.realmId,
    key.realm.realmVersion,
    key.realm.canonicalizationVersion,
    key.scope.kind,
    key.scope.kind === "provider" ? null : key.scope.owner.tenantId,
    key.scope.kind === "provider" ? null : key.scope.owner.id,
    key.objectKindId,
    key.canonicalExternalSubject
  ]);
}

function sameAdapterDeclaration(
  left: InboxV2AdapterIdentityDeclaration,
  right: InboxV2AdapterIdentityDeclaration
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
