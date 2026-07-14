import { z } from "zod";

import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2SourceAccountIdentityAliasIdSchema,
  inboxV2SourceAccountIdentityTransitionIdSchema,
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
  inboxV2AdapterContractSnapshotSchema,
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourceAccountRealmIdSchema
} from "./source-routing-primitives";

export const INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_ID =
  "core:inbox-v2.source-account-identity" as const;
export const INBOX_V2_SOURCE_ACCOUNT_IDENTITY_ALIAS_SCHEMA_ID =
  "core:inbox-v2.source-account-identity-alias" as const;
export const INBOX_V2_SOURCE_ACCOUNT_IDENTITY_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.source-account-identity-transition" as const;
export const INBOX_V2_SOURCE_ACCOUNT_IDENTITY_TRANSITION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.source-account-identity-transition-commit" as const;
export const INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_SOURCE_ACCOUNT_IDENTITY_POLICY_CATALOG =
  "source-account-identity-policy" as const;
export const INBOX_V2_SOURCE_ACCOUNT_IDENTITY_REASON_CATALOG =
  "source-account-identity-reason" as const;
export const INBOX_V2_SOURCE_ACCOUNT_IDENTITY_CONFLICT_CANDIDATE_MAX = 16;

export type InboxV2SourceAccountIdentityPolicyId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_ACCOUNT_IDENTITY_POLICY_CATALOG
>;
export type InboxV2SourceAccountIdentityReasonId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_ACCOUNT_IDENTITY_REASON_CATALOG
>;

export const inboxV2SourceAccountIdentityPolicyIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2SourceAccountIdentityPolicyId
  );
export const inboxV2SourceAccountIdentityReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2SourceAccountIdentityReasonId
  );

/**
 * Account identity is promoted only by trusted application code after an exact
 * provider verification. The token references bounded server-side evidence; it
 * is not a provider credential or a caller assertion.
 */
export const inboxV2SourceAccountIdentityDecisionSchema = z
  .object({
    actor: z
      .object({
        kind: z.literal("trusted_service"),
        trustedServiceId: inboxV2RoutingTrustedServiceIdSchema
      })
      .strict(),
    policyId: inboxV2SourceAccountIdentityPolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    reasonCodeId: inboxV2SourceAccountIdentityReasonIdSchema,
    verificationEvidenceToken: inboxV2RoutingTokenSchema,
    decidedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SourceAccountIdentityRealmSchema = z
  .object({
    realmId: inboxV2SourceAccountRealmIdSchema,
    realmVersion: inboxV2SchemaVersionTokenSchema,
    canonicalizationVersion: inboxV2SchemaVersionTokenSchema,
    objectKindId: inboxV2CatalogIdSchema
  })
  .strict();

export const inboxV2SourceAccountIdentityScopeSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("provider") }).strict(),
    z
      .object({
        kind: z.literal("source_connection"),
        owner: inboxV2SourceConnectionReferenceSchema
      })
      .strict()
  ]
);

export const inboxV2CanonicalSourceAccountIdentityKeySchema = z
  .object({
    realm: inboxV2SourceAccountIdentityRealmSchema,
    scope: inboxV2SourceAccountIdentityScopeSchema,
    canonicalExternalSubject: inboxV2OpaqueProviderSubjectSchema
  })
  .strict();

/**
 * Connector/session identity is intentionally a different type from a
 * canonical provider account key. It can only become an immutable alias after
 * a verified promotion or reauthentication decision.
 */
export const inboxV2ProvisionalSourceAccountIdentitySchema = z
  .object({
    kind: z.literal("connector_session"),
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    connectorSessionSubject: inboxV2OpaqueProviderSubjectSchema,
    observedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((identity, context) => {
    if (
      !isInboxV2TimestampOrderValid(
        identity.adapterContract.loadedAt,
        identity.observedAt
      )
    ) {
      addIssue(
        context,
        ["observedAt"],
        "Connector/session observation cannot precede its pinned adapter declaration."
      );
    }
  });

const sourceAccountIdentityCommonShape = {
  tenantId: inboxV2TenantIdSchema,
  sourceAccount: inboxV2SourceAccountReferenceSchema,
  sourceConnection: inboxV2SourceConnectionReferenceSchema,
  identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
  accountGeneration: inboxV2EntityRevisionSchema,
  revision: inboxV2EntityRevisionSchema,
  createdAt: inboxV2TimestampSchema,
  updatedAt: inboxV2TimestampSchema
};

const inboxV2ProvisionalSourceAccountIdentityStateSchema = z
  .object({
    ...sourceAccountIdentityCommonShape,
    state: z.literal("provisional"),
    expectedCanonicalScope: inboxV2SourceAccountIdentityScopeSchema,
    provisionalIdentity: inboxV2ProvisionalSourceAccountIdentitySchema,
    canonicalIdentity: z.null(),
    verifiedBy: z.null(),
    conflict: z.null()
  })
  .strict();

const inboxV2VerifiedSourceAccountIdentityStateSchema = z
  .object({
    ...sourceAccountIdentityCommonShape,
    state: z.literal("verified"),
    expectedCanonicalScope: z.null(),
    provisionalIdentity: z.null(),
    canonicalIdentity: inboxV2CanonicalSourceAccountIdentityKeySchema,
    verifiedBy: inboxV2SourceAccountIdentityDecisionSchema,
    conflict: z.null()
  })
  .strict();

export const inboxV2SourceAccountIdentityConflictSchema = z
  .object({
    provisionalIdentity: inboxV2ProvisionalSourceAccountIdentitySchema,
    expectedCanonicalScope: inboxV2SourceAccountIdentityScopeSchema,
    attemptedCanonicalIdentities: z
      .array(inboxV2CanonicalSourceAccountIdentityKeySchema)
      .min(1)
      .max(INBOX_V2_SOURCE_ACCOUNT_IDENTITY_CONFLICT_CANDIDATE_MAX),
    diagnostic: inboxV2SafeSourceDiagnosticSchema,
    decision: inboxV2SourceAccountIdentityDecisionSchema,
    detectedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((conflict, context) => {
    const fingerprints = new Set<string>();
    for (const [
      index,
      candidate
    ] of conflict.attemptedCanonicalIdentities.entries()) {
      const fingerprint = sourceAccountIdentityKeyFingerprint(candidate);
      if (fingerprints.has(fingerprint)) {
        addIssue(
          context,
          ["attemptedCanonicalIdentities", index],
          "Conflicting canonical account candidates must be unique."
        );
      }
      fingerprints.add(fingerprint);
    }

    if (conflict.decision.decidedAt !== conflict.detectedAt) {
      addIssue(
        context,
        ["detectedAt"],
        "Conflict detection time must equal the trusted decision time."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        conflict.provisionalIdentity.observedAt,
        conflict.detectedAt
      )
    ) {
      addIssue(
        context,
        ["detectedAt"],
        "Conflict detection cannot precede its connector/session observation."
      );
    }
  });

const inboxV2ConflictedSourceAccountIdentityStateSchema = z
  .object({
    ...sourceAccountIdentityCommonShape,
    state: z.literal("conflicted"),
    expectedCanonicalScope: inboxV2SourceAccountIdentityScopeSchema,
    provisionalIdentity: inboxV2ProvisionalSourceAccountIdentitySchema,
    canonicalIdentity: z.null(),
    verifiedBy: z.null(),
    conflict: inboxV2SourceAccountIdentityConflictSchema
  })
  .strict();

export const inboxV2SourceAccountIdentitySchema = z
  .discriminatedUnion("state", [
    inboxV2ProvisionalSourceAccountIdentityStateSchema,
    inboxV2VerifiedSourceAccountIdentityStateSchema,
    inboxV2ConflictedSourceAccountIdentityStateSchema
  ])
  .superRefine((identity, context) => {
    addTenantReferenceIssue(
      context,
      identity.tenantId,
      identity.sourceAccount,
      ["sourceAccount"]
    );
    addTenantReferenceIssue(
      context,
      identity.tenantId,
      identity.sourceConnection,
      ["sourceConnection"]
    );

    if (!isInboxV2TimestampOrderValid(identity.createdAt, identity.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "Source account identity updatedAt cannot precede createdAt."
      );
    }

    if (identity.identityDeclaration.identityKind !== "source_account") {
      addIssue(
        context,
        ["identityDeclaration", "identityKind"],
        "Source account identity requires a source_account adapter declaration."
      );
    }

    if (identity.identityDeclaration.decisionStrength !== "authoritative") {
      addIssue(
        context,
        ["identityDeclaration", "decisionStrength"],
        "Canonical source account identity requires authoritative verification."
      );
    }

    if (identity.state === "verified") {
      addCanonicalIdentityIssues(
        context,
        identity.tenantId,
        identity.sourceConnection,
        identity.identityDeclaration,
        identity.canonicalIdentity,
        ["canonicalIdentity"]
      );
      addPinnedDecisionActorIssue(
        context,
        identity.verifiedBy,
        identity.identityDeclaration,
        ["verifiedBy", "actor", "trustedServiceId"]
      );
      if (identity.verifiedBy.decidedAt !== identity.updatedAt) {
        addIssue(
          context,
          ["verifiedBy", "decidedAt"],
          "Verified decision time must equal identity updatedAt."
        );
      }
      return;
    }

    addProvisionalIdentityIssues(
      context,
      identity.tenantId,
      identity.sourceConnection,
      identity.identityDeclaration,
      identity.expectedCanonicalScope,
      identity.provisionalIdentity,
      ["provisionalIdentity"]
    );
    if (
      !isInboxV2TimestampOrderValid(
        identity.provisionalIdentity.observedAt,
        identity.updatedAt
      )
    ) {
      addIssue(
        context,
        ["provisionalIdentity", "observedAt"],
        "Connector/session observation cannot follow the current identity state."
      );
    }

    if (identity.state === "conflicted") {
      addPinnedDecisionActorIssue(
        context,
        identity.conflict.decision,
        identity.identityDeclaration,
        ["conflict", "decision", "actor", "trustedServiceId"]
      );
      if (
        !sameProvisionalIdentity(
          identity.provisionalIdentity,
          identity.conflict.provisionalIdentity
        )
      ) {
        addIssue(
          context,
          ["conflict", "provisionalIdentity"],
          "Conflict must preserve the exact provisional connector/session identity."
        );
      }
      if (
        !sameAccountIdentityScope(
          identity.expectedCanonicalScope,
          identity.conflict.expectedCanonicalScope
        )
      ) {
        addIssue(
          context,
          ["conflict", "expectedCanonicalScope"],
          "Conflict must preserve the exact expected canonical scope."
        );
      }
      for (const [
        index,
        candidate
      ] of identity.conflict.attemptedCanonicalIdentities.entries()) {
        addCanonicalIdentityIssues(
          context,
          identity.tenantId,
          identity.sourceConnection,
          identity.identityDeclaration,
          candidate,
          ["conflict", "attemptedCanonicalIdentities", index]
        );
      }
      if (identity.conflict.detectedAt !== identity.updatedAt) {
        addIssue(
          context,
          ["conflict", "detectedAt"],
          "Conflict detection time must equal identity updatedAt."
        );
      }
    }
  });

/** Immutable direct alias from one connector/session observation to an account. */
export const inboxV2SourceAccountIdentityAliasSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SourceAccountIdentityAliasIdSchema,
    provisionalIdentity: inboxV2ProvisionalSourceAccountIdentitySchema,
    canonicalSourceAccount: inboxV2SourceAccountReferenceSchema,
    canonicalIdentitySnapshot: inboxV2CanonicalSourceAccountIdentityKeySchema,
    identityDeclaration: inboxV2AdapterIdentityDeclarationSchema,
    expectedAccountIdentityRevision: inboxV2EntityRevisionSchema,
    expectedAccountGeneration: inboxV2EntityRevisionSchema,
    decision: inboxV2SourceAccountIdentityDecisionSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((alias, context) => {
    addTenantReferenceIssue(
      context,
      alias.tenantId,
      alias.canonicalSourceAccount,
      ["canonicalSourceAccount"]
    );
    addTenantReferenceIssue(
      context,
      alias.tenantId,
      alias.provisionalIdentity.sourceConnection,
      ["provisionalIdentity", "sourceConnection"]
    );
    if (alias.revision !== "1") {
      addIssue(
        context,
        ["revision"],
        "Account identity aliases are immutable revision 1 rows."
      );
    }
    if (alias.decision.decidedAt !== alias.createdAt) {
      addIssue(
        context,
        ["createdAt"],
        "Account identity alias time must equal the trusted decision time."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        alias.provisionalIdentity.observedAt,
        alias.createdAt
      )
    ) {
      addIssue(
        context,
        ["provisionalIdentity", "observedAt"],
        "Account identity alias cannot precede its connector/session observation."
      );
    }
    addPinnedDecisionActorIssue(
      context,
      alias.decision,
      alias.identityDeclaration,
      ["decision", "actor", "trustedServiceId"]
    );
    addCanonicalIdentityIssues(
      context,
      alias.tenantId,
      alias.provisionalIdentity.sourceConnection,
      alias.identityDeclaration,
      alias.canonicalIdentitySnapshot,
      ["canonicalIdentitySnapshot"]
    );
    if (
      !sameAdapterContract(
        alias.provisionalIdentity.adapterContract,
        alias.identityDeclaration.adapterContract
      )
    ) {
      addIssue(
        context,
        ["identityDeclaration", "adapterContract"],
        "Alias evidence and identity declaration must use the same pinned adapter contract."
      );
    }
  });

export const inboxV2SourceAccountIdentityTransitionSchema = z
  .discriminatedUnion("intent", [
    z
      .object({
        tenantId: inboxV2TenantIdSchema,
        id: inboxV2SourceAccountIdentityTransitionIdSchema,
        sourceAccount: inboxV2SourceAccountReferenceSchema,
        intent: z.literal("create_provisional"),
        fromState: z.null(),
        toState: z.literal("provisional"),
        expectedRevision: z.null(),
        currentRevision: z.null(),
        resultingRevision: inboxV2EntityRevisionSchema,
        expectedAccountGeneration: z.null(),
        currentAccountGeneration: z.null(),
        resultingAccountGeneration: inboxV2EntityRevisionSchema,
        decision: inboxV2SourceAccountIdentityDecisionSchema,
        occurredAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        tenantId: inboxV2TenantIdSchema,
        id: inboxV2SourceAccountIdentityTransitionIdSchema,
        sourceAccount: inboxV2SourceAccountReferenceSchema,
        intent: z.literal("reauthenticate_verified"),
        fromState: z.literal("verified"),
        toState: z.literal("verified"),
        expectedRevision: inboxV2EntityRevisionSchema,
        currentRevision: inboxV2EntityRevisionSchema,
        resultingRevision: inboxV2EntityRevisionSchema,
        expectedAccountGeneration: inboxV2EntityRevisionSchema,
        currentAccountGeneration: inboxV2EntityRevisionSchema,
        resultingAccountGeneration: inboxV2EntityRevisionSchema,
        reauthenticationIdentity: inboxV2ProvisionalSourceAccountIdentitySchema,
        decision: inboxV2SourceAccountIdentityDecisionSchema,
        occurredAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        tenantId: inboxV2TenantIdSchema,
        id: inboxV2SourceAccountIdentityTransitionIdSchema,
        sourceAccount: inboxV2SourceAccountReferenceSchema,
        intent: z.literal("promote_verified"),
        fromState: z.literal("provisional"),
        toState: z.literal("verified"),
        expectedRevision: inboxV2EntityRevisionSchema,
        currentRevision: inboxV2EntityRevisionSchema,
        resultingRevision: inboxV2EntityRevisionSchema,
        expectedAccountGeneration: inboxV2EntityRevisionSchema,
        currentAccountGeneration: inboxV2EntityRevisionSchema,
        resultingAccountGeneration: inboxV2EntityRevisionSchema,
        decision: inboxV2SourceAccountIdentityDecisionSchema,
        occurredAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        tenantId: inboxV2TenantIdSchema,
        id: inboxV2SourceAccountIdentityTransitionIdSchema,
        sourceAccount: inboxV2SourceAccountReferenceSchema,
        intent: z.literal("mark_conflicted"),
        fromState: z.literal("provisional"),
        toState: z.literal("conflicted"),
        expectedRevision: inboxV2EntityRevisionSchema,
        currentRevision: inboxV2EntityRevisionSchema,
        resultingRevision: inboxV2EntityRevisionSchema,
        expectedAccountGeneration: inboxV2EntityRevisionSchema,
        currentAccountGeneration: inboxV2EntityRevisionSchema,
        resultingAccountGeneration: inboxV2EntityRevisionSchema,
        decision: inboxV2SourceAccountIdentityDecisionSchema,
        occurredAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        tenantId: inboxV2TenantIdSchema,
        id: inboxV2SourceAccountIdentityTransitionIdSchema,
        sourceAccount: inboxV2SourceAccountReferenceSchema,
        intent: z.literal("resolve_conflict"),
        fromState: z.literal("conflicted"),
        toState: z.literal("verified"),
        expectedRevision: inboxV2EntityRevisionSchema,
        currentRevision: inboxV2EntityRevisionSchema,
        resultingRevision: inboxV2EntityRevisionSchema,
        expectedAccountGeneration: inboxV2EntityRevisionSchema,
        currentAccountGeneration: inboxV2EntityRevisionSchema,
        resultingAccountGeneration: inboxV2EntityRevisionSchema,
        decision: inboxV2SourceAccountIdentityDecisionSchema,
        occurredAt: inboxV2TimestampSchema
      })
      .strict()
  ])
  .superRefine((transition, context) => {
    addTenantReferenceIssue(
      context,
      transition.tenantId,
      transition.sourceAccount,
      ["sourceAccount"]
    );
    if (transition.decision.decidedAt !== transition.occurredAt) {
      addIssue(
        context,
        ["occurredAt"],
        "Account identity transition time must equal the trusted decision time."
      );
    }

    if (transition.intent === "reauthenticate_verified") {
      addTenantReferenceIssue(
        context,
        transition.tenantId,
        transition.reauthenticationIdentity.sourceConnection,
        ["reauthenticationIdentity", "sourceConnection"]
      );
      if (
        !isInboxV2TimestampOrderValid(
          transition.reauthenticationIdentity.observedAt,
          transition.occurredAt
        )
      ) {
        addIssue(
          context,
          ["reauthenticationIdentity", "observedAt"],
          "Reauthentication cannot precede its connector/session observation."
        );
      }
    }

    if (transition.intent === "create_provisional") {
      if (
        transition.resultingRevision !== "1" ||
        transition.resultingAccountGeneration !== "1"
      ) {
        addIssue(
          context,
          ["resultingRevision"],
          "A provisional account identity starts at revision and generation 1."
        );
      }
      return;
    }

    addCasAdvanceIssues(
      context,
      transition.expectedRevision,
      transition.currentRevision,
      transition.resultingRevision,
      ["resultingRevision"],
      "Account identity revision"
    );
    addCasAdvanceIssues(
      context,
      transition.expectedAccountGeneration,
      transition.currentAccountGeneration,
      transition.resultingAccountGeneration,
      ["resultingAccountGeneration"],
      "Account generation"
    );
  });

/**
 * A bounded transaction contract binds one current identity transition and the
 * aliases materialized by that transition. It is not a tenant/lifetime graph.
 */
export const inboxV2SourceAccountIdentityTransitionCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    previousIdentity: inboxV2SourceAccountIdentitySchema.nullable(),
    resultingIdentity: inboxV2SourceAccountIdentitySchema,
    transition: inboxV2SourceAccountIdentityTransitionSchema,
    aliases: z.array(inboxV2SourceAccountIdentityAliasSchema).max(1),
    committedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addIdentityTransitionCommitIssues(commit, context);
  });

export const inboxV2SourceAccountIdentityEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_ID,
    INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_VERSION,
    inboxV2SourceAccountIdentitySchema
  );
export const inboxV2SourceAccountIdentityAliasEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_ACCOUNT_IDENTITY_ALIAS_SCHEMA_ID,
    INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_VERSION,
    inboxV2SourceAccountIdentityAliasSchema
  );
export const inboxV2SourceAccountIdentityTransitionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_ACCOUNT_IDENTITY_TRANSITION_SCHEMA_ID,
    INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_VERSION,
    inboxV2SourceAccountIdentityTransitionSchema
  );
export const inboxV2SourceAccountIdentityTransitionCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_ACCOUNT_IDENTITY_TRANSITION_COMMIT_SCHEMA_ID,
    INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_VERSION,
    inboxV2SourceAccountIdentityTransitionCommitSchema
  );
export type InboxV2SourceAccountIdentityDecision = z.infer<
  typeof inboxV2SourceAccountIdentityDecisionSchema
>;
export type InboxV2SourceAccountIdentityScope = z.infer<
  typeof inboxV2SourceAccountIdentityScopeSchema
>;
export type InboxV2CanonicalSourceAccountIdentityKey = z.infer<
  typeof inboxV2CanonicalSourceAccountIdentityKeySchema
>;
export type InboxV2ProvisionalSourceAccountIdentity = z.infer<
  typeof inboxV2ProvisionalSourceAccountIdentitySchema
>;
export type InboxV2SourceAccountIdentity = z.infer<
  typeof inboxV2SourceAccountIdentitySchema
>;
export type InboxV2SourceAccountIdentityAlias = z.infer<
  typeof inboxV2SourceAccountIdentityAliasSchema
>;
export type InboxV2SourceAccountIdentityTransition = z.infer<
  typeof inboxV2SourceAccountIdentityTransitionSchema
>;
export type InboxV2SourceAccountIdentityTransitionCommit = z.infer<
  typeof inboxV2SourceAccountIdentityTransitionCommitSchema
>;
function addIdentityTransitionCommitIssues(
  commit: z.infer<typeof inboxV2SourceAccountIdentityTransitionCommitSchema>,
  context: z.RefinementCtx
): void {
  const { previousIdentity, resultingIdentity, transition } = commit;
  if (
    commit.tenantId !== resultingIdentity.tenantId ||
    commit.tenantId !== transition.tenantId
  ) {
    addIssue(context, ["tenantId"], "Account identity commit tenant mismatch.");
  }
  if (
    transition.sourceAccount.id !== resultingIdentity.sourceAccount.id ||
    transition.sourceAccount.tenantId !==
      resultingIdentity.sourceAccount.tenantId
  ) {
    addIssue(
      context,
      ["transition", "sourceAccount"],
      "Transition must target the resulting account identity."
    );
  }
  if (
    transition.toState !== resultingIdentity.state ||
    transition.resultingRevision !== resultingIdentity.revision ||
    transition.resultingAccountGeneration !==
      resultingIdentity.accountGeneration
  ) {
    addIssue(
      context,
      ["resultingIdentity"],
      "Resulting identity must match transition state, revision and generation."
    );
  }
  addPinnedDecisionActorIssue(
    context,
    transition.decision,
    resultingIdentity.identityDeclaration,
    ["transition", "decision", "actor", "trustedServiceId"]
  );
  if (
    transition.occurredAt !== commit.committedAt ||
    resultingIdentity.updatedAt !== commit.committedAt
  ) {
    addIssue(
      context,
      ["committedAt"],
      "Transition, resulting identity and commit timestamps must agree."
    );
  }

  if (transition.intent === "create_provisional") {
    if (previousIdentity !== null || commit.aliases.length !== 0) {
      addIssue(
        context,
        ["previousIdentity"],
        "Creating a provisional identity has no prior identity or aliases."
      );
    }
    if (
      resultingIdentity.createdAt !== commit.committedAt ||
      resultingIdentity.state !== "provisional"
    ) {
      addIssue(
        context,
        ["resultingIdentity"],
        "Initial provisional identity must be created at the commit time."
      );
    }
    return;
  }

  if (previousIdentity === null) {
    addIssue(
      context,
      ["previousIdentity"],
      "Non-create transition requires prior identity."
    );
    return;
  }
  if (
    previousIdentity.tenantId !== commit.tenantId ||
    previousIdentity.sourceAccount.id !== resultingIdentity.sourceAccount.id ||
    previousIdentity.sourceConnection.id !==
      resultingIdentity.sourceConnection.id ||
    previousIdentity.createdAt !== resultingIdentity.createdAt ||
    previousIdentity.state !== transition.fromState ||
    previousIdentity.revision !== transition.currentRevision ||
    previousIdentity.accountGeneration !== transition.currentAccountGeneration
  ) {
    addIssue(
      context,
      ["previousIdentity"],
      "Previous identity must match the transition CAS snapshot and stable account edges."
    );
  }
  if (
    !sameAdapterIdentityDeclaration(
      previousIdentity.identityDeclaration,
      resultingIdentity.identityDeclaration
    )
  ) {
    addIssue(
      context,
      ["resultingIdentity", "identityDeclaration"],
      "Account identity transition must preserve the exact pinned adapter declaration; realm or scope reinterpretation requires a separate migration."
    );
  }

  if (transition.intent === "reauthenticate_verified") {
    if (
      previousIdentity.state !== "verified" ||
      resultingIdentity.state !== "verified" ||
      !sameCanonicalIdentityKey(
        previousIdentity.canonicalIdentity,
        resultingIdentity.canonicalIdentity
      )
    ) {
      addIssue(
        context,
        ["resultingIdentity", "canonicalIdentity"],
        "Reauthentication must preserve the exact verified canonical account key."
      );
    }

    if (resultingIdentity.state === "verified") {
      addProvisionalIdentityIssues(
        context,
        commit.tenantId,
        resultingIdentity.sourceConnection,
        resultingIdentity.identityDeclaration,
        resultingIdentity.canonicalIdentity.scope,
        transition.reauthenticationIdentity,
        ["transition", "reauthenticationIdentity"]
      );
    }
  }
  if (
    !isInboxV2TimestampOrderValid(
      previousIdentity.updatedAt,
      commit.committedAt
    )
  ) {
    addIssue(
      context,
      ["committedAt"],
      "Commit cannot precede the previous identity state."
    );
  }

  if (transition.intent === "mark_conflicted") {
    if (
      commit.aliases.length !== 0 ||
      resultingIdentity.state !== "conflicted"
    ) {
      addIssue(
        context,
        ["aliases"],
        "A conflicted promotion creates no canonical aliases."
      );
    }
    if (
      resultingIdentity.state === "conflicted" &&
      !sameDecision(resultingIdentity.conflict.decision, transition.decision)
    ) {
      addIssue(
        context,
        ["resultingIdentity", "conflict", "decision"],
        "Conflict state must retain the transition decision."
      );
    }
    if (
      previousIdentity.state !== "provisional" ||
      resultingIdentity.state !== "conflicted" ||
      !sameProvisionalIdentity(
        previousIdentity.provisionalIdentity,
        resultingIdentity.provisionalIdentity
      ) ||
      !sameAccountIdentityScope(
        previousIdentity.expectedCanonicalScope,
        resultingIdentity.expectedCanonicalScope
      )
    ) {
      addIssue(
        context,
        ["resultingIdentity", "provisionalIdentity"],
        "Conflict transition must preserve the exact provisional identity and expected scope."
      );
    }
    return;
  }

  if (resultingIdentity.state !== "verified") {
    addIssue(
      context,
      ["resultingIdentity", "state"],
      "Promotion must produce verified state."
    );
    return;
  }
  const previousExpectedScope =
    previousIdentity.state === "provisional" ||
    previousIdentity.state === "conflicted"
      ? previousIdentity.expectedCanonicalScope
      : null;
  if (
    previousExpectedScope !== null &&
    !sameAccountIdentityScope(
      previousExpectedScope,
      resultingIdentity.canonicalIdentity.scope
    )
  ) {
    addIssue(
      context,
      ["resultingIdentity", "canonicalIdentity", "scope"],
      "Verified promotion must preserve the exact expected scope kind and owner."
    );
  }
  if (!sameDecision(resultingIdentity.verifiedBy, transition.decision)) {
    addIssue(
      context,
      ["resultingIdentity", "verifiedBy"],
      "Verified identity must retain the promotion decision."
    );
  }
  if (commit.aliases.length === 0) {
    addIssue(
      context,
      ["aliases"],
      "Promotion must preserve its connector/session as an alias."
    );
  }
  addAliasSetIssues(
    context,
    commit.aliases,
    resultingIdentity,
    commit.committedAt,
    ["aliases"]
  );
  for (const [index, alias] of commit.aliases.entries()) {
    if (!sameDecision(alias.decision, transition.decision)) {
      addIssue(
        context,
        ["aliases", index, "decision"],
        "Promotion alias must retain the exact account identity transition decision."
      );
    }
  }

  const previousProvisional =
    previousIdentity.state === "provisional"
      ? previousIdentity.provisionalIdentity
      : previousIdentity.state === "conflicted"
        ? previousIdentity.provisionalIdentity
        : null;
  if (
    previousProvisional &&
    !commit.aliases.some((alias) =>
      sameProvisionalIdentity(alias.provisionalIdentity, previousProvisional)
    )
  ) {
    addIssue(
      context,
      ["aliases"],
      "Promotion aliases must include the exact prior connector/session identity."
    );
  }

  if (
    transition.intent === "reauthenticate_verified" &&
    !commit.aliases.some((alias) =>
      sameProvisionalIdentity(
        alias.provisionalIdentity,
        transition.reauthenticationIdentity
      )
    )
  ) {
    addIssue(
      context,
      ["aliases"],
      "Reauthentication aliases must include the exact newly verified connector/session identity."
    );
  }
}

function addAliasSetIssues(
  context: z.RefinementCtx,
  aliases: readonly z.infer<typeof inboxV2SourceAccountIdentityAliasSchema>[],
  canonicalIdentity: z.infer<
    typeof inboxV2VerifiedSourceAccountIdentityStateSchema
  >,
  committedAt: string,
  path: (string | number)[]
): void {
  const aliasIds = new Set<string>();
  const provisionalKeys = new Set<string>();
  for (const [index, alias] of aliases.entries()) {
    if (aliasIds.has(alias.id)) {
      addIssue(
        context,
        [...path, index, "id"],
        "Alias IDs must be unique in one commit."
      );
    }
    aliasIds.add(alias.id);

    const provisionalFingerprint = provisionalIdentityFingerprint(
      alias.provisionalIdentity
    );
    if (provisionalKeys.has(provisionalFingerprint)) {
      addIssue(
        context,
        [...path, index, "provisionalIdentity"],
        "One commit cannot map the same connector/session identity twice."
      );
    }
    provisionalKeys.add(provisionalFingerprint);

    if (
      alias.tenantId !== canonicalIdentity.tenantId ||
      alias.canonicalSourceAccount.id !== canonicalIdentity.sourceAccount.id ||
      alias.expectedAccountIdentityRevision !== canonicalIdentity.revision ||
      alias.expectedAccountGeneration !== canonicalIdentity.accountGeneration ||
      !sameCanonicalIdentityKey(
        alias.canonicalIdentitySnapshot,
        canonicalIdentity.canonicalIdentity
      )
    ) {
      addIssue(
        context,
        [...path, index],
        "Alias must target the exact fenced canonical account identity snapshot."
      );
    }
    if (alias.createdAt !== committedAt) {
      addIssue(
        context,
        [...path, index, "createdAt"],
        "Alias timestamp must equal its bounded commit time."
      );
    }
  }
}

function addProvisionalIdentityIssues(
  context: z.RefinementCtx,
  tenantId: string,
  sourceConnection: { tenantId: string; id: string },
  declaration: z.infer<typeof inboxV2AdapterIdentityDeclarationSchema>,
  expectedScope: z.infer<typeof inboxV2SourceAccountIdentityScopeSchema>,
  provisional: z.infer<typeof inboxV2ProvisionalSourceAccountIdentitySchema>,
  path: (string | number)[]
): void {
  addTenantReferenceIssue(context, tenantId, provisional.sourceConnection, [
    ...path,
    "sourceConnection"
  ]);
  if (
    provisional.sourceConnection.id !== sourceConnection.id ||
    provisional.sourceConnection.tenantId !== sourceConnection.tenantId
  ) {
    addIssue(
      context,
      [...path, "sourceConnection"],
      "Provisional identity must belong to the account SourceConnection."
    );
  }
  if (
    !sameAdapterContract(
      provisional.adapterContract,
      declaration.adapterContract
    )
  ) {
    addIssue(
      context,
      [...path, "adapterContract"],
      "Provisional identity must use the exact pinned account declaration."
    );
  }
  addDeclarationKeyIssues(context, declaration, expectedScope, null, [
    "identityDeclaration"
  ]);
  if (expectedScope.kind === "source_connection") {
    addTenantReferenceIssue(context, tenantId, expectedScope.owner, [
      "expectedCanonicalScope",
      "owner"
    ]);
    if (
      expectedScope.owner.id !== sourceConnection.id ||
      expectedScope.owner.tenantId !== sourceConnection.tenantId
    ) {
      addIssue(
        context,
        ["expectedCanonicalScope", "owner"],
        "Connection-scoped account identity must use its owning SourceConnection."
      );
    }
  }
}

function addCanonicalIdentityIssues(
  context: z.RefinementCtx,
  tenantId: string,
  sourceConnection: { tenantId: string; id: string },
  declaration: z.infer<typeof inboxV2AdapterIdentityDeclarationSchema>,
  canonicalIdentity: z.infer<
    typeof inboxV2CanonicalSourceAccountIdentityKeySchema
  >,
  path: (string | number)[]
): void {
  if (canonicalIdentity.scope.kind === "source_connection") {
    addTenantReferenceIssue(context, tenantId, canonicalIdentity.scope.owner, [
      ...path,
      "scope",
      "owner"
    ]);
    if (
      canonicalIdentity.scope.owner.id !== sourceConnection.id ||
      canonicalIdentity.scope.owner.tenantId !== sourceConnection.tenantId
    ) {
      addIssue(
        context,
        [...path, "scope", "owner"],
        "Connection-scoped account identity must use its owning SourceConnection."
      );
    }
  }
  addDeclarationKeyIssues(
    context,
    declaration,
    canonicalIdentity.scope,
    canonicalIdentity.realm,
    ["identityDeclaration"]
  );
}

function addDeclarationKeyIssues(
  context: z.RefinementCtx,
  declaration: z.infer<typeof inboxV2AdapterIdentityDeclarationSchema>,
  scope: z.infer<typeof inboxV2SourceAccountIdentityScopeSchema>,
  realm: z.infer<typeof inboxV2SourceAccountIdentityRealmSchema> | null,
  path: (string | number)[]
): void {
  if (declaration.identityKind !== "source_account") {
    addIssue(
      context,
      [...path, "identityKind"],
      "Canonical account key requires a source_account adapter declaration."
    );
  }
  if (declaration.decisionStrength !== "authoritative") {
    addIssue(
      context,
      [...path, "decisionStrength"],
      "Canonical account key requires authoritative adapter evidence."
    );
  }
  if (declaration.scopeKind !== scope.kind) {
    addIssue(
      context,
      [...path, "scopeKind"],
      "Account declaration scope must match the key scope."
    );
  }
  if (
    realm &&
    (declaration.realmId !== realm.realmId ||
      declaration.realmVersion !== realm.realmVersion ||
      declaration.canonicalizationVersion !== realm.canonicalizationVersion ||
      declaration.objectKindId !== realm.objectKindId)
  ) {
    addIssue(
      context,
      path,
      "Account declaration must exactly match realm, object kind and canonicalization."
    );
  }
}

function addCasAdvanceIssues(
  context: z.RefinementCtx,
  expected: string,
  current: string,
  resulting: string,
  path: (string | number)[],
  label: string
): void {
  if (expected !== current) {
    addIssue(context, path, `${label} expected/current CAS values must match.`);
  }
  if (BigInt(resulting) !== BigInt(current) + 1n) {
    addIssue(context, path, `${label} must advance exactly once.`);
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

function sameAdapterContract(
  left: z.infer<typeof inboxV2AdapterContractSnapshotSchema>,
  right: z.infer<typeof inboxV2AdapterContractSnapshotSchema>
): boolean {
  return (
    left.contractId === right.contractId &&
    left.contractVersion === right.contractVersion &&
    left.declarationRevision === right.declarationRevision &&
    left.surfaceId === right.surfaceId &&
    left.loadedByTrustedServiceId === right.loadedByTrustedServiceId &&
    left.loadedAt === right.loadedAt
  );
}

function sameAdapterIdentityDeclaration(
  left: z.infer<typeof inboxV2AdapterIdentityDeclarationSchema>,
  right: z.infer<typeof inboxV2AdapterIdentityDeclarationSchema>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addPinnedDecisionActorIssue(
  context: z.RefinementCtx,
  decision: z.infer<typeof inboxV2SourceAccountIdentityDecisionSchema>,
  declaration: z.infer<typeof inboxV2AdapterIdentityDeclarationSchema>,
  path: (string | number)[]
): void {
  if (
    decision.actor.trustedServiceId !==
    declaration.adapterContract.loadedByTrustedServiceId
  ) {
    addIssue(
      context,
      path,
      "Identity decision must use the trusted service pinned by the exact adapter declaration."
    );
  }
}

function sameAccountIdentityScope(
  left: z.infer<typeof inboxV2SourceAccountIdentityScopeSchema>,
  right: z.infer<typeof inboxV2SourceAccountIdentityScopeSchema>
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "provider" ||
      (right.kind === "source_connection" &&
        left.owner.tenantId === right.owner.tenantId &&
        left.owner.id === right.owner.id))
  );
}

function sameCanonicalIdentityKey(
  left: z.infer<typeof inboxV2CanonicalSourceAccountIdentityKeySchema>,
  right: z.infer<typeof inboxV2CanonicalSourceAccountIdentityKeySchema>
): boolean {
  return (
    sourceAccountIdentityKeyFingerprint(left) ===
    sourceAccountIdentityKeyFingerprint(right)
  );
}

function sourceAccountIdentityKeyFingerprint(
  key: z.infer<typeof inboxV2CanonicalSourceAccountIdentityKeySchema>
): string {
  return JSON.stringify([
    key.realm.realmId,
    key.realm.realmVersion,
    key.realm.canonicalizationVersion,
    key.realm.objectKindId,
    key.scope.kind,
    key.scope.kind === "source_connection" ? key.scope.owner.tenantId : null,
    key.scope.kind === "source_connection" ? key.scope.owner.id : null,
    key.canonicalExternalSubject
  ]);
}

function sameProvisionalIdentity(
  left: z.infer<typeof inboxV2ProvisionalSourceAccountIdentitySchema>,
  right: z.infer<typeof inboxV2ProvisionalSourceAccountIdentitySchema>
): boolean {
  return (
    left.kind === right.kind &&
    left.sourceConnection.tenantId === right.sourceConnection.tenantId &&
    left.sourceConnection.id === right.sourceConnection.id &&
    sameAdapterContract(left.adapterContract, right.adapterContract) &&
    left.connectorSessionSubject === right.connectorSessionSubject &&
    left.observedAt === right.observedAt
  );
}

function provisionalIdentityFingerprint(
  identity: z.infer<typeof inboxV2ProvisionalSourceAccountIdentitySchema>
): string {
  return JSON.stringify([
    identity.sourceConnection.tenantId,
    identity.sourceConnection.id,
    identity.adapterContract.contractId,
    identity.adapterContract.contractVersion,
    identity.adapterContract.surfaceId,
    identity.connectorSessionSubject
  ]);
}

function sameDecision(
  left: z.infer<typeof inboxV2SourceAccountIdentityDecisionSchema>,
  right: z.infer<typeof inboxV2SourceAccountIdentityDecisionSchema>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
