import {
  inboxV2CanonicalSourceAccountIdentityKeySchema,
  inboxV2ProvisionalSourceAccountIdentitySchema,
  inboxV2SourceAccountIdentityDecisionSchema,
  inboxV2SourceAccountIdentitySchema,
  inboxV2SourceAccountIdentityScopeSchema,
  inboxV2SourceAccountIdentityTransitionSchema,
  type InboxV2CanonicalSourceAccountIdentityKey,
  type InboxV2SourceAccountIdentity,
  type InboxV2SourceAccountIdentityDecision,
  type InboxV2SourceAccountIdentityScope,
  type InboxV2SourceAccountIdentityTransition
} from "./source-account-identity";

const tenantId = "tenant:type-fixture";
const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: "source_connection:type-fixture"
};
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:type-fixture"
};
const adapterContract = {
  contractId: "module:synthetic:type-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic:type-surface",
  loadedByTrustedServiceId: "core:routing-resolver",
  loadedAt: "2026-07-11T08:00:00.000Z"
};
const declaration = {
  adapterContract,
  identityKind: "source_account" as const,
  realmId: "module:synthetic:type-account-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic:type-account",
  scopeKind: "provider" as const,
  decisionStrength: "authoritative" as const
};

const providerScope = inboxV2SourceAccountIdentityScopeSchema.parse({
  kind: "provider"
}) satisfies InboxV2SourceAccountIdentityScope;
const decision = inboxV2SourceAccountIdentityDecisionSchema.parse({
  actor: {
    kind: "trusted_service",
    trustedServiceId: "core:routing-resolver"
  },
  policyId: "core:verified-account",
  policyVersion: "v1",
  reasonCodeId: "core:verified",
  verificationEvidenceToken: "evidence.type-fixture",
  decidedAt: "2026-07-11T08:05:00.000Z"
}) satisfies InboxV2SourceAccountIdentityDecision;
const canonicalKey = inboxV2CanonicalSourceAccountIdentityKeySchema.parse({
  realm: {
    realmId: "module:synthetic:type-account-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:type-account"
  },
  scope: providerScope,
  canonicalExternalSubject: "Provider:Type-Account"
}) satisfies InboxV2CanonicalSourceAccountIdentityKey;
const provisional = inboxV2ProvisionalSourceAccountIdentitySchema.parse({
  kind: "connector_session",
  sourceConnection,
  adapterContract,
  connectorSessionSubject: "session:type-only",
  observedAt: "2026-07-11T08:00:00.000Z"
});
const verified = inboxV2SourceAccountIdentitySchema.parse({
  tenantId,
  sourceAccount,
  sourceConnection,
  identityDeclaration: declaration,
  accountGeneration: "2",
  revision: "2",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:05:00.000Z",
  state: "verified",
  expectedCanonicalScope: null,
  provisionalIdentity: null,
  canonicalIdentity: canonicalKey,
  verifiedBy: decision,
  conflict: null
}) satisfies InboxV2SourceAccountIdentity;
const transition = inboxV2SourceAccountIdentityTransitionSchema.parse({
  tenantId,
  id: "source_account_identity_transition:type-fixture",
  sourceAccount,
  intent: "promote_verified",
  fromState: "provisional",
  toState: "verified",
  expectedRevision: "1",
  currentRevision: "1",
  resultingRevision: "2",
  expectedAccountGeneration: "1",
  currentAccountGeneration: "1",
  resultingAccountGeneration: "2",
  decision,
  occurredAt: "2026-07-11T08:05:00.000Z"
}) satisfies InboxV2SourceAccountIdentityTransition;

const invalidScope: InboxV2SourceAccountIdentityScope = {
  // @ts-expect-error Account identity cannot be recursively source-account scoped.
  kind: "source_account"
};
// @ts-expect-error A connector/session observation is not a canonical account key.
const invalidCanonicalKey: InboxV2CanonicalSourceAccountIdentityKey =
  provisional;
const invalidDecision: InboxV2SourceAccountIdentityDecision = {
  ...decision,
  // @ts-expect-error Trusted account decisions cannot be stamped by an Employee payload.
  actor: { kind: "employee", employeeId: "employee:caller" }
};
type SourceAccountTransitionIntent =
  InboxV2SourceAccountIdentityTransition["intent"];
// @ts-expect-error Verified account identity is immutable; replacement creates a new SourceAccount.
const invalidIntent: SourceAccountTransitionIntent = "replace_verified";

void verified;
void transition;
void invalidScope;
void invalidCanonicalKey;
void invalidDecision;
void invalidIntent;
