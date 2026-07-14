import {
  inboxV2SourceThreadBindingCreationCommitSchema,
  inboxV2SourceThreadBindingCurrentProjectionSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2SourceThreadBindingTransitionCommitSchema,
  inboxV2TenantIdSchema,
  type InboxV2SourceThreadBindingCreationCommit,
  type InboxV2SourceThreadBindingCurrentProjection,
  type InboxV2SourceThreadBindingId,
  type InboxV2SourceThreadBindingTransitionCommit,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import { computeInboxV2SourceAccountCanonicalKeyDigest } from "./sql-inbox-v2-source-occurrence-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const BINDING_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const BINDING_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const SUPPORTED_EVIDENCE_KINDS = new Set([
  "raw_inbound_event",
  "normalized_inbound_event",
  "source_account_identity_transition",
  "source_account_identity_alias",
  "provider_roster_evidence",
  "provider_roster_member_evidence"
]);

export type FindCurrentInboxV2SourceThreadBindingInput = Readonly<{
  tenantId: InboxV2TenantId;
  bindingId: InboxV2SourceThreadBindingId | string;
}>;

export type ResolveOrCreateInboxV2SourceThreadBindingResult =
  | Readonly<{
      kind: "created" | "already_exists";
      projection: InboxV2SourceThreadBindingCurrentProjection;
    }>
  | Readonly<{
      kind: "external_thread_not_found" | "external_thread_mapping_conflict";
    }>
  | Readonly<{
      kind:
        | "source_account_identity_not_found"
        | "source_account_identity_conflict";
    }>
  | Readonly<{
      kind: "binding_id_conflict" | "binding_target_conflict";
      existingProjection: InboxV2SourceThreadBindingCurrentProjection;
    }>;

export type ApplyInboxV2SourceThreadBindingTransitionResult =
  | Readonly<{
      kind: "committed" | "already_committed";
      projection: InboxV2SourceThreadBindingCurrentProjection;
    }>
  | Readonly<{ kind: "binding_not_found" }>
  | Readonly<{
      kind: "binding_revision_conflict";
      currentProjection: InboxV2SourceThreadBindingCurrentProjection;
    }>
  | Readonly<{ kind: "transition_id_conflict" }>
  | Readonly<{
      kind:
        | "source_account_identity_not_found"
        | "source_account_identity_conflict";
    }>;

export type InboxV2SourceThreadBindingTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2SourceThreadBindingRepository = Readonly<{
  findCurrent(
    input: FindCurrentInboxV2SourceThreadBindingInput
  ): Promise<InboxV2SourceThreadBindingCurrentProjection | null>;
  resolveOrCreate(
    commit: InboxV2SourceThreadBindingCreationCommit
  ): Promise<ResolveOrCreateInboxV2SourceThreadBindingResult>;
  applyTransition(
    commit: InboxV2SourceThreadBindingTransitionCommit
  ): Promise<ApplyInboxV2SourceThreadBindingTransitionResult>;
}>;

type ProjectionRow = {
  projection: unknown;
  persistence: unknown;
};

type LockedIdentityRow = {
  source_account_id: unknown;
  source_connection_id: unknown;
  state: unknown;
  revision: unknown;
  account_generation: unknown;
  identity_declaration: unknown;
  canonical_key_digest_sha256: unknown;
  canonical_realm_id: unknown;
  canonical_realm_version: unknown;
  canonicalization_version: unknown;
  canonical_object_kind_id: unknown;
  canonical_scope_kind: unknown;
  canonical_scope_source_connection_id: unknown;
  canonical_external_subject: unknown;
  updated_at: unknown;
};

type LockedThreadRow = {
  id: unknown;
  conversation_id: unknown;
  conversation_transport: unknown;
  conversation_topology: unknown;
  realm_id: unknown;
  realm_version: unknown;
  canonicalization_version: unknown;
  scope_kind: unknown;
  scope_source_connection_id: unknown;
  scope_source_account_id: unknown;
  object_kind_id: unknown;
  canonical_external_subject: unknown;
  identity_declaration: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type ExistingTransitionRow = {
  transition: unknown;
  matched_permission_ids: unknown;
  evidence: unknown;
};

type ProjectionPersistence = Readonly<{
  accountIdentityRevision: string;
  accountVerificationEvidenceSetId: string;
  remoteAccessEvidenceSetId: string;
  providerAccessEvidenceSetId: string;
  capabilityEvidenceSetIds: readonly string[];
  transitionId: string | null;
  expectedBindingRevision: string | null;
}>;

type EvidenceReference =
  InboxV2SourceThreadBindingCurrentProjection["binding"]["remoteAccess"]["evidence"][number];

type EvidenceMaterialization = Readonly<{
  id: string;
  references: readonly EvidenceReference[];
  createdAt: string;
}>;

type ProjectionMaterialization = Readonly<{
  accountIdentityRevision: string;
  accountCanonicalKeyDigestSha256: string;
  accountEvidenceSetId: string;
  remoteEvidenceSetId: string;
  providerEvidenceSetId: string;
  capabilityEvidenceSetIds: readonly string[];
  transitionEvidenceSetId: string | null;
}>;

type BindingHeadRecord = ReturnType<typeof toBindingHeadRecord>;
type TransitionRecord = ReturnType<typeof toTransitionRecord>;

export function createSqlInboxV2SourceThreadBindingRepository(
  executor: InboxV2SourceThreadBindingTransactionExecutor | HuleeDatabase
): InboxV2SourceThreadBindingRepository {
  const transactionExecutor =
    executor as unknown as InboxV2SourceThreadBindingTransactionExecutor;

  return {
    async findCurrent(input) {
      const normalized = normalizeFindInput(input);
      const loaded = await loadProjection(transactionExecutor, normalized);
      return loaded?.projection ?? null;
    },

    async resolveOrCreate(input) {
      const commit =
        inboxV2SourceThreadBindingCreationCommitSchema.parse(input);
      assertPersistableProjectionEvidence(commit.initialProjection);
      assertRouteDescriptorDigest(
        commit.initialProjection.binding.routeDescriptor
      );

      return runBindingTransaction(transactionExecutor, async (transaction) => {
        const binding = commit.initialProjection.binding;
        await transaction.execute(buildAcquireBindingTargetLockSql(commit));

        const existingTarget = await loadProjectionByTarget(transaction, {
          tenantId: commit.tenantId,
          externalThreadId: binding.externalThread.id,
          sourceAccountId: binding.sourceAccount.id,
          lock: true
        });
        if (existingTarget !== null) {
          return sameValue(existingTarget.projection, commit.initialProjection)
            ? {
                kind: "already_exists" as const,
                projection: existingTarget.projection
              }
            : {
                kind: "binding_target_conflict" as const,
                existingProjection: existingTarget.projection
              };
        }

        const existingId = await loadProjection(transaction, {
          tenantId: commit.tenantId,
          bindingId: binding.id,
          lock: true
        });
        if (existingId !== null) {
          return {
            kind: "binding_id_conflict" as const,
            existingProjection: existingId.projection
          };
        }

        const identity = await lockSourceAccountIdentity(transaction, {
          tenantId: commit.tenantId,
          sourceAccountId: binding.sourceAccount.id
        });
        if (identity === null) {
          return { kind: "source_account_identity_not_found" as const };
        }
        if (!identityMatchesCreationCommit(identity, commit)) {
          return { kind: "source_account_identity_conflict" as const };
        }

        const thread = await lockExternalThread(transaction, {
          tenantId: commit.tenantId,
          externalThreadId: binding.externalThread.id
        });
        if (thread === null) {
          return { kind: "external_thread_not_found" as const };
        }
        if (!threadMatchesCreationCommit(thread, commit)) {
          return { kind: "external_thread_mapping_conflict" as const };
        }

        const materialization = creationMaterialization(commit);
        const inserted = await transaction.execute<{ id: unknown }>(
          buildInsertBindingAnchorSql(commit)
        );
        if (inserted.rows.length !== 1) {
          const raced = await loadProjectionByTarget(transaction, {
            tenantId: commit.tenantId,
            externalThreadId: binding.externalThread.id,
            sourceAccountId: binding.sourceAccount.id,
            lock: true
          });
          if (raced === null) {
            const racedId = await loadProjection(transaction, {
              tenantId: commit.tenantId,
              bindingId: binding.id,
              lock: true
            });
            if (racedId !== null) {
              return {
                kind: "binding_id_conflict" as const,
                existingProjection: racedId.projection
              };
            }
            throw invariantError(
              "SourceThreadBinding insert conflicted without a durable target or id."
            );
          }
          return sameValue(raced.projection, commit.initialProjection)
            ? { kind: "already_exists" as const, projection: raced.projection }
            : {
                kind: "binding_target_conflict" as const,
                existingProjection: raced.projection
              };
        }

        await insertCreationAggregate(transaction, commit, materialization);
        const created = await loadProjection(transaction, {
          tenantId: commit.tenantId,
          bindingId: binding.id,
          lock: false
        });
        if (
          created === null ||
          !sameValue(created.projection, commit.initialProjection)
        ) {
          throw invariantError(
            "SourceThreadBinding creation did not round-trip its contract projection."
          );
        }
        return { kind: "created" as const, projection: created.projection };
      });
    },

    async applyTransition(input) {
      const commit =
        inboxV2SourceThreadBindingTransitionCommitSchema.parse(input);
      assertPersistableProjectionEvidence(commit.after);
      assertPersistableTransitionEvidence(commit);
      assertRouteDescriptorDigest(commit.after.binding.routeDescriptor);

      return runBindingTransaction(transactionExecutor, async (transaction) => {
        const transition = commit.transition;
        await transaction.execute(buildAcquireBindingTransitionLockSql(commit));
        const existingTransition = await loadExistingTransition(
          transaction,
          commit
        );
        if (existingTransition !== null) {
          const storedProjection = await loadProjectionAtRevision(transaction, {
            tenantId: transition.tenantId,
            bindingId: transition.binding.id,
            revision: transition.resultingBindingRevision
          });
          if (
            storedProjection !== null &&
            transitionRecordMatches(
              existingTransition,
              expectedTransitionRecordForIdempotency(commit),
              commit
            ) &&
            sameValue(storedProjection.projection, commit.after)
          ) {
            return {
              kind: "already_committed" as const,
              projection: storedProjection.projection
            };
          }
          return { kind: "transition_id_conflict" as const };
        }

        // Canonical order shared with SourceOccurrence: binding head -> account
        // identity -> ExternalThread. The head lock is the aggregate CAS.
        const current = await loadProjection(transaction, {
          tenantId: transition.tenantId,
          bindingId: transition.binding.id,
          lock: true
        });
        if (current === null) return { kind: "binding_not_found" as const };

        // A concurrent exact retry can commit while this transaction waits on
        // the head lock. Re-read the immutable transition under READ COMMITTED
        // before classifying the now-advanced head as a revision conflict.
        const racedTransition = await loadExistingTransition(
          transaction,
          commit
        );
        if (racedTransition !== null) {
          const storedProjection = await loadProjectionAtRevision(transaction, {
            tenantId: transition.tenantId,
            bindingId: transition.binding.id,
            revision: transition.resultingBindingRevision
          });
          if (
            storedProjection !== null &&
            transitionRecordMatches(
              racedTransition,
              expectedTransitionRecordForIdempotency(commit),
              commit
            ) &&
            sameValue(storedProjection.projection, commit.after)
          ) {
            return {
              kind: "already_committed" as const,
              projection: storedProjection.projection
            };
          }
          return { kind: "transition_id_conflict" as const };
        }
        if (!sameValue(current.projection, commit.before)) {
          return {
            kind: "binding_revision_conflict" as const,
            currentProjection: current.projection
          };
        }

        const identity = await lockSourceAccountIdentity(transaction, {
          tenantId: transition.tenantId,
          sourceAccountId: commit.before.binding.sourceAccount.id
        });
        if (identity === null) {
          return { kind: "source_account_identity_not_found" as const };
        }
        if (
          !identityMatchesTransition(
            identity,
            commit,
            current.persistence.accountIdentityRevision
          )
        ) {
          return { kind: "source_account_identity_conflict" as const };
        }

        const thread = await lockExternalThread(transaction, {
          tenantId: transition.tenantId,
          externalThreadId: commit.before.binding.externalThread.id
        });
        if (thread === null) {
          throw invariantError(
            "Locked SourceThreadBinding references a missing ExternalThread."
          );
        }

        const materialization = transitionMaterialization(
          commit,
          current.persistence,
          identity
        );
        await insertTransitionAggregate(transaction, commit, materialization);

        const updated = await loadProjection(transaction, {
          tenantId: transition.tenantId,
          bindingId: transition.binding.id,
          lock: false
        });
        if (updated === null || !sameValue(updated.projection, commit.after)) {
          throw invariantError(
            "SourceThreadBinding transition did not round-trip its after projection."
          );
        }
        return { kind: "committed" as const, projection: updated.projection };
      });
    }
  };
}

function normalizeFindInput(
  input: FindCurrentInboxV2SourceThreadBindingInput
): FindCurrentInboxV2SourceThreadBindingInput {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.keys(input).some((key) => key !== "tenantId" && key !== "bindingId")
  ) {
    throw new CoreError(
      "validation.failed",
      "SourceThreadBinding lookup accepts only tenantId and bindingId."
    );
  }

  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    bindingId: inboxV2SourceThreadBindingIdSchema.parse(input.bindingId)
  };
}

async function runBindingTransaction<TResult>(
  executor: InboxV2SourceThreadBindingTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= BINDING_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await executor.transaction(work, BINDING_TRANSACTION_CONFIG);
    } catch (error) {
      lastError = error;
      if (
        attempt === BINDING_TRANSACTION_ATTEMPTS ||
        !RETRYABLE_SQLSTATES.has(databaseErrorCode(error) ?? "")
      ) {
        throw error;
      }
    }
  }

  throw lastError;
}

function databaseErrorCode(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      typeof (current as { code?: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    if (typeof current !== "object" || !("cause" in current)) break;
    const cause = (current as { cause?: unknown }).cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return null;
}

export function buildAcquireBindingTargetLockSql(
  commit: InboxV2SourceThreadBindingCreationCommit
): SQL {
  const binding = commit.initialProjection.binding;
  const key = JSON.stringify([
    commit.tenantId,
    binding.externalThread.id,
    binding.sourceAccount.id
  ]);

  return sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`inbox-v2:source-thread-binding:${key}`}, 0)
    )
  `;
}

export function buildAcquireBindingTransitionLockSql(
  commit: InboxV2SourceThreadBindingTransitionCommit
): SQL {
  const transition = commit.transition;
  const key = JSON.stringify([transition.tenantId, transition.id]);
  return sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`inbox-v2:source-thread-binding-transition:${key}`}, 0)
    )
  `;
}

export function buildLockInboxV2SourceThreadBindingIdentitySql(input: {
  tenantId: InboxV2TenantId | string;
  sourceAccountId: string;
}): SQL {
  return sql`
    select
      source_account_id,
      source_connection_id,
      state,
      revision,
      account_generation,
      identity_declaration,
      canonical_key_digest_sha256,
      canonical_realm_id,
      canonical_realm_version,
      canonicalization_version,
      canonical_object_kind_id,
      canonical_scope_kind,
      canonical_scope_source_connection_id,
      canonical_external_subject,
      updated_at
    from inbox_v2_source_account_identities
    where tenant_id = ${input.tenantId}
      and source_account_id = ${input.sourceAccountId}
    for share
  `;
}

export function buildLockInboxV2SourceThreadBindingThreadSql(input: {
  tenantId: InboxV2TenantId | string;
  externalThreadId: string;
}): SQL {
  return sql`
    select
      id,
      conversation_id,
      conversation_transport,
      conversation_topology,
      realm_id,
      realm_version,
      canonicalization_version,
      scope_kind,
      scope_source_connection_id,
      scope_source_account_id,
      object_kind_id,
      canonical_external_subject,
      identity_declaration,
      revision,
      created_at,
      updated_at
    from inbox_v2_external_threads
    where tenant_id = ${input.tenantId}
      and id = ${input.externalThreadId}
    for share
  `;
}

async function lockSourceAccountIdentity(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId | string; sourceAccountId: string }
): Promise<LockedIdentityRow | null> {
  const result = await executor.execute<LockedIdentityRow>(
    buildLockInboxV2SourceThreadBindingIdentitySql(input)
  );
  requireAtMostOneRow(result, "SourceAccountIdentity lock");
  return result.rows[0] ?? null;
}

async function lockExternalThread(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId | string; externalThreadId: string }
): Promise<LockedThreadRow | null> {
  const result = await executor.execute<LockedThreadRow>(
    buildLockInboxV2SourceThreadBindingThreadSql(input)
  );
  requireAtMostOneRow(result, "ExternalThread lock");
  return result.rows[0] ?? null;
}

function identityMatchesCreationCommit(
  row: LockedIdentityRow,
  commit: InboxV2SourceThreadBindingCreationCommit
): boolean {
  const identity = commit.sourceAccountIdentity;
  if (identity.state !== "verified") return false;
  const canonical = identity.canonicalIdentity;

  return (
    String(row.source_account_id) === String(identity.sourceAccount.id) &&
    String(row.source_connection_id) === String(identity.sourceConnection.id) &&
    String(row.state) === "verified" &&
    String(row.revision) === String(identity.revision) &&
    String(row.account_generation) === String(identity.accountGeneration) &&
    sameValue(
      parseJsonValue(row.identity_declaration),
      identity.identityDeclaration
    ) &&
    String(row.canonical_key_digest_sha256) ===
      computeInboxV2SourceAccountCanonicalKeyDigest(canonical) &&
    String(row.canonical_realm_id) === String(canonical.realm.realmId) &&
    String(row.canonical_realm_version) === canonical.realm.realmVersion &&
    String(row.canonicalization_version) ===
      canonical.realm.canonicalizationVersion &&
    String(row.canonical_object_kind_id) ===
      String(canonical.realm.objectKindId) &&
    String(row.canonical_scope_kind) === canonical.scope.kind &&
    nullableString(row.canonical_scope_source_connection_id) ===
      (canonical.scope.kind === "source_connection"
        ? String(canonical.scope.owner.id)
        : null) &&
    String(row.canonical_external_subject) ===
      canonical.canonicalExternalSubject &&
    sameTimestamp(row.updated_at, identity.updatedAt)
  );
}

function identityMatchesTransition(
  row: LockedIdentityRow,
  commit: InboxV2SourceThreadBindingTransitionCommit,
  currentIdentityRevision: string
): boolean {
  const transition = commit.transition;
  const expected =
    transition.kind === "account_generation"
      ? transition.resultingAccountIdentitySnapshot
      : commit.before.binding.accountIdentitySnapshot;
  const declaration = expected.declaration;
  const canonicalDigest = computeInboxV2SourceAccountCanonicalKeyDigest({
    realm: {
      realmId: expected.realmId,
      realmVersion: declaration.realmVersion,
      canonicalizationVersion: declaration.canonicalizationVersion,
      objectKindId: declaration.objectKindId
    },
    scope:
      declaration.scopeKind === "provider"
        ? { kind: "provider" as const }
        : {
            kind: "source_connection" as const,
            owner: expected.sourceConnection
          },
    canonicalExternalSubject: expected.canonicalExternalSubject
  });

  return (
    String(row.source_account_id) === String(expected.sourceAccount.id) &&
    String(row.source_connection_id) === String(expected.sourceConnection.id) &&
    String(row.state) === "verified" &&
    String(row.account_generation) === String(expected.accountGeneration) &&
    (transition.kind !== "account_generation" ||
      String(row.revision) === String(expected.accountGeneration)) &&
    (transition.kind === "account_generation" ||
      String(row.revision) === currentIdentityRevision) &&
    sameValue(parseJsonValue(row.identity_declaration), expected.declaration) &&
    String(row.canonical_key_digest_sha256) === canonicalDigest &&
    String(row.canonical_realm_id) === String(expected.realmId) &&
    String(row.canonical_realm_version) === declaration.realmVersion &&
    String(row.canonicalization_version) ===
      declaration.canonicalizationVersion &&
    String(row.canonical_object_kind_id) === String(declaration.objectKindId) &&
    String(row.canonical_scope_kind) === declaration.scopeKind &&
    nullableString(row.canonical_scope_source_connection_id) ===
      (declaration.scopeKind === "source_connection"
        ? String(expected.sourceConnection.id)
        : null) &&
    String(row.canonical_external_subject) ===
      expected.canonicalExternalSubject &&
    sameTimestamp(row.updated_at, expected.verifiedAt)
  );
}

function threadMatchesCreationCommit(
  row: LockedThreadRow,
  commit: InboxV2SourceThreadBindingCreationCommit
): boolean {
  const thread = commit.externalThreadMapping.thread;
  const key = thread.key;
  const scopeConnection =
    key.scope.kind === "source_connection" ? String(key.scope.owner.id) : null;
  const scopeAccount =
    key.scope.kind === "source_account" ? String(key.scope.owner.id) : null;

  return (
    String(row.id) === String(thread.id) &&
    String(row.conversation_id) === String(thread.conversation.id) &&
    String(row.conversation_transport) === "external" &&
    String(row.conversation_topology) === thread.conversationTopology &&
    String(row.realm_id) === String(key.realm.realmId) &&
    String(row.realm_version) === key.realm.realmVersion &&
    String(row.canonicalization_version) ===
      key.realm.canonicalizationVersion &&
    String(row.scope_kind) === key.scope.kind &&
    nullableString(row.scope_source_connection_id) === scopeConnection &&
    nullableString(row.scope_source_account_id) === scopeAccount &&
    String(row.object_kind_id) === String(key.objectKindId) &&
    String(row.canonical_external_subject) === key.canonicalExternalSubject &&
    sameValue(
      parseJsonValue(row.identity_declaration),
      thread.identityDeclaration
    ) &&
    String(row.revision) === String(thread.revision) &&
    sameTimestamp(row.created_at, thread.createdAt) &&
    sameTimestamp(row.updated_at, thread.updatedAt)
  );
}

function assertPersistableProjectionEvidence(
  projection: InboxV2SourceThreadBindingCurrentProjection
): void {
  const binding = projection.binding;
  const lists = [
    binding.accountIdentitySnapshot.verificationEvidence,
    binding.remoteAccess.evidence,
    binding.providerAccess.evidence,
    ...binding.capabilities.entries.map((entry) => entry.evidence)
  ];
  for (const references of lists) assertPersistableEvidence(references);
}

function assertPersistableTransitionEvidence(
  commit: InboxV2SourceThreadBindingTransitionCommit
): void {
  const transition = commit.transition;
  if (
    transition.kind === "remote_access" ||
    transition.kind === "capabilities" ||
    transition.kind === "route_descriptor" ||
    transition.kind === "account_generation" ||
    transition.kind === "provider_access"
  ) {
    assertPersistableEvidence(transition.evidence);
  }
  if (transition.kind === "account_generation") {
    assertSameEvidence(
      transition.evidence,
      transition.resultingAccountIdentitySnapshot.verificationEvidence,
      "Account-generation transition evidence must equal the resulting verification evidence."
    );
  }
  if (transition.kind === "provider_access") {
    assertSameEvidence(
      transition.evidence,
      transition.resultingProviderAccess.evidence,
      "Provider-access transition evidence must equal the resulting provider evidence."
    );
  }
}

function assertPersistableEvidence(
  references: readonly EvidenceReference[]
): void {
  const unsupported = references.find(
    (reference) => !SUPPORTED_EVIDENCE_KINDS.has(reference.kind)
  );
  if (unsupported) {
    throw new CoreError(
      "validation.failed",
      `SourceThreadBinding evidence kind ${unsupported.kind} is not available in the current DB003 schema.`
    );
  }
}

export function buildFindCurrentInboxV2SourceThreadBindingSql(input: {
  tenantId: InboxV2TenantId | string;
  bindingId: InboxV2SourceThreadBindingId | string;
  lock?: boolean;
}): SQL {
  const selected = input.lock
    ? sql`
        with locked_head as materialized (
          select binding_id, revision
          from inbox_v2_source_thread_binding_heads
          where tenant_id = ${input.tenantId}
            and binding_id = ${input.bindingId}
          for update
        ), selected as materialized (
          select snapshot.*
          from inbox_v2_source_thread_binding_snapshots snapshot
          inner join locked_head
            on locked_head.binding_id = snapshot.binding_id
           and locked_head.revision = snapshot.revision
          where snapshot.tenant_id = ${input.tenantId}
        )
      `
    : sql`
        with selected as materialized (
          select snapshot.*
          from inbox_v2_source_thread_binding_heads head
          inner join inbox_v2_source_thread_binding_snapshots snapshot
            on snapshot.tenant_id = head.tenant_id
           and snapshot.binding_id = head.binding_id
           and snapshot.revision = head.revision
          where head.tenant_id = ${input.tenantId}
            and head.binding_id = ${input.bindingId}
        )
      `;

  return buildProjectionSql(selected);
}

export function buildFindInboxV2SourceThreadBindingByTargetSql(input: {
  tenantId: InboxV2TenantId | string;
  externalThreadId: string;
  sourceAccountId: string;
  lock?: boolean;
}): SQL {
  const selected = input.lock
    ? sql`
        with locked_head as materialized (
          select binding_id, revision
          from inbox_v2_source_thread_binding_heads
          where tenant_id = ${input.tenantId}
            and external_thread_id = ${input.externalThreadId}
            and source_account_id = ${input.sourceAccountId}
          for update
        ), selected as materialized (
          select snapshot.*
          from inbox_v2_source_thread_binding_snapshots snapshot
          inner join locked_head
            on locked_head.binding_id = snapshot.binding_id
           and locked_head.revision = snapshot.revision
          where snapshot.tenant_id = ${input.tenantId}
        )
      `
    : sql`
        with selected as materialized (
          select snapshot.*
          from inbox_v2_source_thread_binding_heads head
          inner join inbox_v2_source_thread_binding_snapshots snapshot
            on snapshot.tenant_id = head.tenant_id
           and snapshot.binding_id = head.binding_id
           and snapshot.revision = head.revision
          where head.tenant_id = ${input.tenantId}
            and head.external_thread_id = ${input.externalThreadId}
            and head.source_account_id = ${input.sourceAccountId}
        )
      `;

  return buildProjectionSql(selected);
}

export function buildFindInboxV2SourceThreadBindingRevisionSql(input: {
  tenantId: InboxV2TenantId | string;
  bindingId: InboxV2SourceThreadBindingId | string;
  revision: string;
}): SQL {
  return buildProjectionSql(sql`
    with selected as materialized (
      select snapshot.*
      from inbox_v2_source_thread_binding_snapshots snapshot
      where snapshot.tenant_id = ${input.tenantId}
        and snapshot.binding_id = ${input.bindingId}
        and snapshot.revision = ${input.revision}::bigint
    )
  `);
}

function buildProjectionSql(selectedCte: SQL): SQL {
  return sql`
    ${selectedCte}
    select
      jsonb_build_object(
        'binding', jsonb_build_object(
          'tenantId', head.tenant_id,
          'id', head.binding_id,
          'externalThread', jsonb_build_object(
            'tenantId', head.tenant_id,
            'kind', 'external_thread',
            'id', head.external_thread_id
          ),
          'sourceConnection', jsonb_build_object(
            'tenantId', head.tenant_id,
            'kind', 'source_connection',
            'id', head.source_connection_id
          ),
          'sourceAccount', jsonb_build_object(
            'tenantId', head.tenant_id,
            'kind', 'source_account',
            'id', head.source_account_id
          ),
          'accountIdentitySnapshot', jsonb_build_object(
            'status', 'verified',
            'sourceConnection', jsonb_build_object(
              'tenantId', head.tenant_id,
              'kind', 'source_connection',
              'id', head.source_connection_id
            ),
            'sourceAccount', jsonb_build_object(
              'tenantId', head.tenant_id,
              'kind', 'source_account',
              'id', head.source_account_id
            ),
            'declaration', identity.identity_declaration,
            'realmId', identity.canonical_realm_id,
            'canonicalExternalSubject', identity.canonical_external_subject,
            'accountGeneration', head.account_generation::text,
            'verificationEvidence', account_evidence.items,
            'verifiedAt', to_char(
              head.account_verified_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          ),
          'bindingGeneration', head.binding_generation::text,
          'remoteAccess', jsonb_build_object(
            'state', head.remote_access_state,
            'evidenceAuthority', head.remote_access_evidence_authority,
            'revision', head.remote_access_revision::text,
            'since', to_char(
              head.remote_access_since at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'evidence', remote_evidence.items
          ),
          'administrative', jsonb_build_object(
            'state', head.administrative_state,
            'revision', head.administrative_revision::text,
            'changedAt', to_char(
              head.administrative_changed_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          ),
          'runtimeHealth', jsonb_build_object(
            'state', head.runtime_health_state,
            'revision', head.runtime_health_revision::text,
            'checkedAt', to_char(
              head.runtime_health_checked_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'diagnostic', case
              when head.runtime_diagnostic_code_id is null then null
              else jsonb_build_object(
                'codeId', head.runtime_diagnostic_code_id,
                'retryable', head.runtime_diagnostic_retryable,
                'correlationToken', head.runtime_diagnostic_correlation_token,
                'safeOperatorHintId',
                  head.runtime_diagnostic_safe_operator_hint_id
              )
            end
          ),
          'historySync', jsonb_build_object(
            'state', head.history_sync_state,
            'revision', head.history_sync_revision::text,
            'receiveCursor', head.history_receive_cursor,
            'historyCursor', head.history_cursor,
            'providerWatermark', head.history_provider_watermark,
            'lastDurableRawEvent', case
              when head.history_last_durable_raw_event_id is null then null
              else jsonb_build_object(
                'tenantId', head.tenant_id,
                'kind', 'raw_inbound_event',
                'id', head.history_last_durable_raw_event_id
              )
            end,
            'updatedAt', to_char(
              head.history_updated_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'diagnostic', case
              when head.history_diagnostic_code_id is null then null
              else jsonb_build_object(
                'codeId', head.history_diagnostic_code_id,
                'retryable', head.history_diagnostic_retryable,
                'correlationToken', head.history_diagnostic_correlation_token,
                'safeOperatorHintId',
                  head.history_diagnostic_safe_operator_hint_id
              )
            end
          ),
          'providerAccess', jsonb_build_object(
            'revision', head.provider_access_revision::text,
            'roleIds', provider_roles.items,
            'evidence', provider_evidence.items,
            'observedAt', to_char(
              head.provider_access_observed_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          ),
          'capabilities', jsonb_build_object(
            'adapterContract', jsonb_build_object(
              'contractId', head.capability_contract_id,
              'contractVersion', head.capability_contract_version,
              'declarationRevision',
                head.capability_declaration_revision::text,
              'surfaceId', head.capability_surface_id,
              'loadedByTrustedServiceId',
                head.capability_loaded_by_trusted_service_id,
              'loadedAt', to_char(
                head.capability_loaded_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              )
            ),
            'revision', head.capability_revision::text,
            'capturedAt', to_char(
              head.capability_captured_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'entries', capabilities.items
          ),
          'routeDescriptor', jsonb_build_object(
            'adapterContract', jsonb_build_object(
              'contractId', head.route_contract_id,
              'contractVersion', head.route_contract_version,
              'declarationRevision', head.route_declaration_revision::text,
              'surfaceId', head.route_surface_id,
              'loadedByTrustedServiceId',
                head.route_loaded_by_trusted_service_id,
              'loadedAt', to_char(
                head.route_loaded_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              )
            ),
            'descriptorSchemaId', head.route_descriptor_schema_id,
            'descriptorVersion', head.route_descriptor_version,
            'descriptorRevision', head.route_descriptor_revision::text,
            'destinationKindId', head.route_destination_kind_id,
            'destinationSubject', head.route_destination_subject,
            'attributes', route_attributes.items,
            'descriptorDigestSha256', head.route_descriptor_digest_sha256
          ),
          'revision', head.revision::text,
          'createdAt', to_char(
            head.created_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'updatedAt', to_char(
            head.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        'currentRemoteAccessEpisode', jsonb_build_object(
          'tenantId', head.tenant_id,
          'id', episode.id,
          'binding', jsonb_build_object(
            'tenantId', head.tenant_id,
            'kind', 'source_thread_binding',
            'id', head.binding_id
          ),
          'state', episode.state,
          'startedAt', to_char(
            episode.started_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'endedAt', null,
          'startEvidence', remote_evidence.items,
          'endEvidence', jsonb_build_array(),
          'revision', '1',
          'createdAt', to_char(
            episode.started_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'updatedAt', to_char(
            episode.started_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        )
      ) as projection,
      jsonb_build_object(
        'accountIdentityRevision', head.account_identity_revision::text,
        'accountVerificationEvidenceSetId',
          head.account_verification_evidence_set_id,
        'remoteAccessEvidenceSetId', head.remote_access_evidence_set_id,
        'providerAccessEvidenceSetId', head.provider_access_evidence_set_id,
        'capabilityEvidenceSetIds', capabilities.evidence_set_ids,
        'transitionId', head.transition_id,
        'expectedBindingRevision', head.expected_binding_revision::text
      ) as persistence
    from selected head
    inner join inbox_v2_source_account_identity_verified_snapshots identity
      on identity.tenant_id = head.tenant_id
     and identity.source_account_id = head.source_account_id
     and identity.identity_revision = head.account_identity_revision
     and identity.account_generation = head.account_generation
     and identity.state = 'verified'
    inner join inbox_v2_source_thread_binding_remote_access_episodes episode
      on episode.tenant_id = head.tenant_id
     and episode.binding_id = head.binding_id
     and episode.id = head.current_remote_access_episode_id
    left join lateral (
      ${evidenceItemsSelectSql("account_verification_evidence_set_id")}
    ) account_evidence on true
    left join lateral (
      ${evidenceItemsSelectSql("remote_access_evidence_set_id")}
    ) remote_evidence on true
    left join lateral (
      ${evidenceItemsSelectSql("provider_access_evidence_set_id")}
    ) provider_evidence on true
    left join lateral (
      select coalesce(
        jsonb_agg(role.provider_role_id order by role.ordinal),
        jsonb_build_array()
      ) as items
      from inbox_v2_source_thread_binding_provider_roles role
      where role.tenant_id = head.tenant_id
        and role.binding_id = head.binding_id
        and role.provider_access_revision = head.provider_access_revision
    ) provider_roles on true
    left join lateral (
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'capabilityId', entry.capability_id,
              'operationId', entry.operation_id,
              'contentKindId', entry.content_kind_id,
              'state', entry.state,
              'referencePortability', entry.reference_portability,
              'requiredProviderRoleIds', required_roles.items,
              'validUntil', case
                when entry.valid_until is null then null
                else to_char(
                  entry.valid_until at time zone 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                )
              end,
              'diagnostic', case
                when entry.diagnostic_code_id is null then null
                else jsonb_build_object(
                  'codeId', entry.diagnostic_code_id,
                  'retryable', entry.diagnostic_retryable,
                  'correlationToken', entry.diagnostic_correlation_token,
                  'safeOperatorHintId',
                    entry.diagnostic_safe_operator_hint_id
                )
              end,
              'evidence', capability_evidence.items
            ) order by entry.ordinal
          ),
          jsonb_build_array()
        ) as items,
        coalesce(
          jsonb_agg(entry.evidence_set_id order by entry.ordinal),
          jsonb_build_array()
        ) as evidence_set_ids
      from inbox_v2_source_thread_binding_capability_entries entry
      left join lateral (
        select coalesce(
          jsonb_agg(required_role.provider_role_id order by required_role.ordinal),
          jsonb_build_array()
        ) as items
        from inbox_v2_source_thread_binding_capability_required_roles required_role
        where required_role.tenant_id = entry.tenant_id
          and required_role.binding_id = entry.binding_id
          and required_role.capability_revision = entry.capability_revision
          and required_role.capability_ordinal = entry.ordinal
      ) required_roles on true
      left join lateral (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'tenantId', reference.tenant_id,
              'kind', reference.kind,
              'id', coalesce(
                reference.raw_inbound_event_id,
                reference.normalized_inbound_event_id,
                reference.source_account_identity_transition_id,
                reference.source_account_identity_alias_id,
                reference.provider_roster_evidence_id,
                reference.provider_roster_member_evidence_id
              )
            ) order by reference.ordinal
          ),
          jsonb_build_array()
        ) as items
        from inbox_v2_source_thread_binding_evidence_references reference
        where reference.tenant_id = entry.tenant_id
          and reference.evidence_set_id = entry.evidence_set_id
      ) capability_evidence on true
      where entry.tenant_id = head.tenant_id
        and entry.binding_id = head.binding_id
        and entry.capability_revision = head.capability_revision
    ) capabilities on true
    left join lateral (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'attributeId', attribute.attribute_id,
            'value', attribute.value
          ) order by attribute.ordinal
        ),
        jsonb_build_array()
      ) as items
      from inbox_v2_source_thread_binding_route_attributes attribute
      where attribute.tenant_id = head.tenant_id
        and attribute.binding_id = head.binding_id
        and attribute.route_descriptor_revision =
          head.route_descriptor_revision
    ) route_attributes on true
  `;
}

function evidenceItemsSelectSql(headEvidenceColumn: string): SQL {
  return sql.raw(`
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'tenantId', reference.tenant_id,
          'kind', reference.kind,
          'id', coalesce(
            reference.raw_inbound_event_id,
            reference.normalized_inbound_event_id,
            reference.source_account_identity_transition_id,
            reference.source_account_identity_alias_id,
            reference.provider_roster_evidence_id,
            reference.provider_roster_member_evidence_id
          )
        ) order by reference.ordinal
      ),
      jsonb_build_array()
    ) as items
    from inbox_v2_source_thread_binding_evidence_references reference
    where reference.tenant_id = head.tenant_id
      and reference.evidence_set_id = head.${headEvidenceColumn}
  `);
}

async function loadProjection(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId | string;
    bindingId: InboxV2SourceThreadBindingId | string;
    lock?: boolean;
  }
): Promise<{
  projection: InboxV2SourceThreadBindingCurrentProjection;
  persistence: ProjectionPersistence;
} | null> {
  return loadProjectionQuery(
    executor,
    buildFindCurrentInboxV2SourceThreadBindingSql(input)
  );
}

async function loadProjectionByTarget(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId | string;
    externalThreadId: string;
    sourceAccountId: string;
    lock?: boolean;
  }
): Promise<{
  projection: InboxV2SourceThreadBindingCurrentProjection;
  persistence: ProjectionPersistence;
} | null> {
  return loadProjectionQuery(
    executor,
    buildFindInboxV2SourceThreadBindingByTargetSql(input)
  );
}

async function loadProjectionAtRevision(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId | string;
    bindingId: InboxV2SourceThreadBindingId | string;
    revision: string;
  }
): Promise<{
  projection: InboxV2SourceThreadBindingCurrentProjection;
  persistence: ProjectionPersistence;
} | null> {
  return loadProjectionQuery(
    executor,
    buildFindInboxV2SourceThreadBindingRevisionSql(input)
  );
}

async function loadProjectionQuery(
  executor: RawSqlExecutor,
  query: SQL
): Promise<{
  projection: InboxV2SourceThreadBindingCurrentProjection;
  persistence: ProjectionPersistence;
} | null> {
  const result = await executor.execute<ProjectionRow>(query);
  requireAtMostOneRow(result, "SourceThreadBinding projection");
  const row = result.rows[0];
  if (!row) return null;

  try {
    const projection = inboxV2SourceThreadBindingCurrentProjectionSchema.parse(
      parseJsonValue(row.projection)
    );
    const persistence = parseProjectionPersistence(row.persistence);
    return { projection, persistence };
  } catch (error) {
    if (error instanceof InboxV2PersistenceInvariantError) throw error;
    throw invariantError(
      "SourceThreadBinding persisted projection violates its contract."
    );
  }
}

function parseProjectionPersistence(value: unknown): ProjectionPersistence {
  const parsed = parseJsonValue(value);
  if (typeof parsed !== "object" || parsed === null) {
    throw invariantError(
      "SourceThreadBinding persistence metadata is invalid."
    );
  }
  const record = parsed as Record<string, unknown>;
  const capabilityIds = record.capabilityEvidenceSetIds;
  if (!Array.isArray(capabilityIds)) {
    throw invariantError(
      "SourceThreadBinding capability evidence metadata is invalid."
    );
  }
  const capabilityEvidenceSetIds = capabilityIds.map((evidenceSetId) =>
    requiredPersistenceString(evidenceSetId, "capability evidence set")
  );
  const transitionId = optionalPersistenceString(
    record.transitionId,
    "transition id"
  );
  const expectedBindingRevision = optionalPersistenceString(
    record.expectedBindingRevision,
    "expected binding revision"
  );
  return {
    accountIdentityRevision: requiredPersistenceString(
      record.accountIdentityRevision,
      "account identity revision"
    ),
    accountVerificationEvidenceSetId: requiredPersistenceString(
      record.accountVerificationEvidenceSetId,
      "account verification evidence set"
    ),
    remoteAccessEvidenceSetId: requiredPersistenceString(
      record.remoteAccessEvidenceSetId,
      "remote-access evidence set"
    ),
    providerAccessEvidenceSetId: requiredPersistenceString(
      record.providerAccessEvidenceSetId,
      "provider-access evidence set"
    ),
    capabilityEvidenceSetIds,
    transitionId,
    expectedBindingRevision
  };
}

function requiredPersistenceString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariantError(`SourceThreadBinding ${label} metadata is invalid.`);
  }
  return value;
}

function optionalPersistenceString(
  value: unknown,
  label: string
): string | null {
  if (value === null) return null;
  return requiredPersistenceString(value, label);
}

function creationMaterialization(
  commit: InboxV2SourceThreadBindingCreationCommit
): ProjectionMaterialization {
  const binding = commit.initialProjection.binding;
  assertRouteDescriptorDigest(binding.routeDescriptor);
  const canonicalIdentity = commit.sourceAccountIdentity.canonicalIdentity;
  if (
    commit.sourceAccountIdentity.state !== "verified" ||
    canonicalIdentity === null
  ) {
    throw invariantError(
      "SourceThreadBinding creation requires a verified canonical SourceAccount identity."
    );
  }

  return {
    accountIdentityRevision: String(commit.sourceAccountIdentity.revision),
    accountCanonicalKeyDigestSha256:
      computeInboxV2SourceAccountCanonicalKeyDigest(canonicalIdentity),
    accountEvidenceSetId: evidenceSetId(
      binding.id,
      binding.revision,
      "account",
      binding.accountIdentitySnapshot.verificationEvidence
    ),
    remoteEvidenceSetId: evidenceSetId(
      binding.id,
      binding.revision,
      "remote",
      binding.remoteAccess.evidence
    ),
    providerEvidenceSetId: evidenceSetId(
      binding.id,
      binding.revision,
      "provider",
      binding.providerAccess.evidence
    ),
    capabilityEvidenceSetIds: binding.capabilities.entries.map((entry, index) =>
      evidenceSetId(
        binding.id,
        binding.revision,
        `capability-${index}`,
        entry.evidence
      )
    ),
    transitionEvidenceSetId: null
  };
}

function transitionMaterialization(
  commit: InboxV2SourceThreadBindingTransitionCommit,
  current: ProjectionPersistence,
  identity: LockedIdentityRow
): ProjectionMaterialization {
  const transition = commit.transition;
  const after = commit.after.binding;
  assertRouteDescriptorDigest(after.routeDescriptor);

  let accountEvidenceSetId = current.accountVerificationEvidenceSetId;
  let remoteEvidenceSetId = current.remoteAccessEvidenceSetId;
  let providerEvidenceSetId = current.providerAccessEvidenceSetId;
  let capabilityEvidenceSetIds = current.capabilityEvidenceSetIds;
  let transitionEvidenceSetId: string | null = null;

  if (transition.kind === "remote_access") {
    remoteEvidenceSetId = evidenceSetId(
      after.id,
      after.revision,
      "remote-transition",
      transition.evidence
    );
    transitionEvidenceSetId = remoteEvidenceSetId;
  } else if (transition.kind === "account_generation") {
    assertSameEvidence(
      transition.evidence,
      transition.resultingAccountIdentitySnapshot.verificationEvidence,
      "Account-generation transition evidence must equal the resulting verification evidence."
    );
    accountEvidenceSetId = evidenceSetId(
      after.id,
      after.revision,
      "account-transition",
      transition.evidence
    );
    transitionEvidenceSetId = accountEvidenceSetId;
  } else if (transition.kind === "provider_access") {
    assertSameEvidence(
      transition.evidence,
      transition.resultingProviderAccess.evidence,
      "Provider-access transition evidence must equal the resulting provider evidence."
    );
    providerEvidenceSetId = evidenceSetId(
      after.id,
      after.revision,
      "provider-transition",
      transition.evidence
    );
    transitionEvidenceSetId = providerEvidenceSetId;
  } else if (transition.kind === "capabilities") {
    capabilityEvidenceSetIds = transition.resultingCapabilities.entries.map(
      (entry, index) =>
        evidenceSetId(
          after.id,
          after.revision,
          `capability-${index}`,
          entry.evidence
        )
    );
    transitionEvidenceSetId = evidenceSetId(
      after.id,
      after.revision,
      "capability-transition",
      transition.evidence
    );
  } else if (transition.kind === "route_descriptor") {
    transitionEvidenceSetId = evidenceSetId(
      after.id,
      after.revision,
      "route-transition",
      transition.evidence
    );
  }

  return {
    accountIdentityRevision:
      transition.kind === "account_generation"
        ? String(identity.revision)
        : current.accountIdentityRevision,
    accountCanonicalKeyDigestSha256: String(
      identity.canonical_key_digest_sha256
    ),
    accountEvidenceSetId,
    remoteEvidenceSetId,
    providerEvidenceSetId,
    capabilityEvidenceSetIds,
    transitionEvidenceSetId
  };
}

function assertSameEvidence(
  left: readonly EvidenceReference[],
  right: readonly EvidenceReference[],
  message: string
): void {
  if (!sameValue(left, right)) {
    throw new CoreError("validation.failed", message);
  }
}

function evidenceSetId(
  bindingId: string,
  bindingRevision: string,
  purpose: string,
  references: readonly EvidenceReference[]
): string {
  const digest = evidenceDigest(references);
  const suffix = sha256(
    `${bindingId}|${bindingRevision}|${purpose}|${digest}`
  ).slice(0, 48);
  return `source_thread_binding_evidence_set:${suffix}`;
}

function evidenceDigest(references: readonly EvidenceReference[]): string {
  return sha256(
    references
      .map(
        (reference, ordinal) =>
          `${ordinal}|${reference.kind}|${utf8Length(String(reference.id))}:${String(reference.id)}`
      )
      .join("")
  );
}

function providerRolesDigest(roleIds: readonly string[]): string {
  return sha256(
    [...roleIds]
      .sort(compareText)
      .map((roleId) => `${utf8Length(roleId)}:${roleId}`)
      .join("")
  );
}

function routeAttributesDigest(
  attributes: readonly Readonly<{ attributeId: string; value: string }>[]
): string {
  return sha256(
    attributes
      .map(
        (attribute, ordinal) =>
          `${ordinal}|${attribute.attributeId}|${utf8Length(attribute.value)}:${attribute.value}`
      )
      .join("")
  );
}

function routeDescriptorDigest(
  descriptor: InboxV2SourceThreadBindingCurrentProjection["binding"]["routeDescriptor"]
): string {
  const adapter = descriptor.adapterContract;
  const parts = [
    lengthPrefixed(adapter.contractId),
    lengthPrefixed(adapter.contractVersion),
    lengthPrefixed(String(adapter.declarationRevision)),
    lengthPrefixed(adapter.surfaceId),
    lengthPrefixed(adapter.loadedByTrustedServiceId),
    lengthPrefixed(descriptor.descriptorSchemaId),
    lengthPrefixed(descriptor.descriptorVersion),
    lengthPrefixed(String(descriptor.descriptorRevision)),
    lengthPrefixed(descriptor.destinationKindId),
    lengthPrefixed(descriptor.destinationSubject),
    ...[...descriptor.attributes]
      .sort((left, right) => compareText(left.attributeId, right.attributeId))
      .flatMap((attribute) => [
        lengthPrefixed(attribute.attributeId),
        lengthPrefixed(attribute.value)
      ])
  ];
  return sha256(parts.join(""));
}

function assertRouteDescriptorDigest(
  descriptor: InboxV2SourceThreadBindingCurrentProjection["binding"]["routeDescriptor"]
): void {
  const calculated = routeDescriptorDigest(descriptor);
  if (calculated !== descriptor.descriptorDigestSha256) {
    throw new CoreError(
      "validation.failed",
      "SourceThreadBinding route descriptor digest does not match its canonical fields."
    );
  }
}

function capabilitySemanticDigest(
  snapshot: InboxV2SourceThreadBindingCurrentProjection["binding"]["capabilities"]
): string {
  const adapter = snapshot.adapterContract;
  const prefix =
    lengthPrefixed(adapter.contractId) +
    lengthPrefixed(adapter.contractVersion) +
    `${adapter.declarationRevision}|` +
    lengthPrefixed(adapter.surfaceId) +
    lengthPrefixed(adapter.loadedByTrustedServiceId);
  const entries = [...snapshot.entries]
    .sort(
      (left, right) =>
        compareText(left.capabilityId, right.capabilityId) ||
        compareText(left.operationId, right.operationId) ||
        compareText(
          contentKindKey(left.contentKindId),
          contentKindKey(right.contentKindId)
        )
    )
    .map((entry) => {
      const diagnostic = entry.diagnostic;
      const roles = [...entry.requiredProviderRoleIds]
        .sort(compareText)
        .map(lengthPrefixed)
        .join("");
      return [
        entry.capabilityId,
        entry.operationId,
        contentKindKey(entry.contentKindId),
        entry.state,
        entry.referencePortability,
        entry.validUntil === null ? "-" : String(Date.parse(entry.validUntil)),
        diagnostic?.codeId ?? "-",
        diagnostic === null ? "-" : String(diagnostic.retryable),
        diagnostic?.correlationToken ?? "-",
        diagnostic?.safeOperatorHintId ?? "-",
        roles
      ].join("|");
    })
    .join("");
  return sha256(prefix + entries);
}

function contentKindKey(value: string | null): string {
  return value === null ? "0:" : `1:${utf8Length(value)}:${value}`;
}

function lengthPrefixed(value: string): string {
  return `${utf8Length(value)}:${value}`;
}

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toBindingHeadRecord(
  projection: InboxV2SourceThreadBindingCurrentProjection,
  materialization: ProjectionMaterialization
) {
  const binding = projection.binding;
  const identity = binding.accountIdentitySnapshot;
  const runtimeDiagnostic = binding.runtimeHealth.diagnostic;
  const historyDiagnostic = binding.historySync.diagnostic;
  const capabilities = binding.capabilities;
  const capabilityAdapter = capabilities.adapterContract;
  const route = binding.routeDescriptor;
  const routeAdapter = route.adapterContract;

  return {
    tenant_id: binding.tenantId,
    binding_id: binding.id,
    external_thread_id: binding.externalThread.id,
    source_connection_id: binding.sourceConnection.id,
    source_account_id: binding.sourceAccount.id,
    account_identity_revision: materialization.accountIdentityRevision,
    account_generation: identity.accountGeneration,
    account_identity_state: "verified",
    account_canonical_key_digest_sha256:
      materialization.accountCanonicalKeyDigestSha256,
    account_identity_trusted_service_id:
      identity.declaration.adapterContract.loadedByTrustedServiceId,
    account_verified_at: identity.verifiedAt,
    account_verification_evidence_set_id: materialization.accountEvidenceSetId,
    binding_generation: binding.bindingGeneration,
    current_remote_access_episode_id: projection.currentRemoteAccessEpisode.id,
    current_remote_access_episode_revision: "1",
    remote_access_state: binding.remoteAccess.state,
    remote_access_evidence_authority: binding.remoteAccess.evidenceAuthority,
    remote_access_revision: binding.remoteAccess.revision,
    remote_access_since: binding.remoteAccess.since,
    remote_access_evidence_set_id: materialization.remoteEvidenceSetId,
    administrative_state: binding.administrative.state,
    administrative_revision: binding.administrative.revision,
    administrative_changed_at: binding.administrative.changedAt,
    runtime_health_state: binding.runtimeHealth.state,
    runtime_health_revision: binding.runtimeHealth.revision,
    runtime_health_checked_at: binding.runtimeHealth.checkedAt,
    runtime_diagnostic_code_id: runtimeDiagnostic?.codeId ?? null,
    runtime_diagnostic_retryable: runtimeDiagnostic?.retryable ?? null,
    runtime_diagnostic_correlation_token:
      runtimeDiagnostic?.correlationToken ?? null,
    runtime_diagnostic_safe_operator_hint_id:
      runtimeDiagnostic?.safeOperatorHintId ?? null,
    history_sync_state: binding.historySync.state,
    history_sync_revision: binding.historySync.revision,
    history_receive_cursor: binding.historySync.receiveCursor,
    history_cursor: binding.historySync.historyCursor,
    history_provider_watermark: binding.historySync.providerWatermark,
    history_last_durable_raw_event_id:
      binding.historySync.lastDurableRawEvent?.id ?? null,
    history_updated_at: binding.historySync.updatedAt,
    history_diagnostic_code_id: historyDiagnostic?.codeId ?? null,
    history_diagnostic_retryable: historyDiagnostic?.retryable ?? null,
    history_diagnostic_correlation_token:
      historyDiagnostic?.correlationToken ?? null,
    history_diagnostic_safe_operator_hint_id:
      historyDiagnostic?.safeOperatorHintId ?? null,
    provider_access_revision: binding.providerAccess.revision,
    provider_role_count: binding.providerAccess.roleIds.length,
    provider_roles_digest_sha256: providerRolesDigest(
      binding.providerAccess.roleIds
    ),
    provider_access_evidence_set_id: materialization.providerEvidenceSetId,
    provider_access_observed_at: binding.providerAccess.observedAt,
    capability_contract_id: capabilityAdapter.contractId,
    capability_contract_version: capabilityAdapter.contractVersion,
    capability_declaration_revision: capabilityAdapter.declarationRevision,
    capability_surface_id: capabilityAdapter.surfaceId,
    capability_loaded_by_trusted_service_id:
      capabilityAdapter.loadedByTrustedServiceId,
    capability_loaded_at: capabilityAdapter.loadedAt,
    capability_revision: capabilities.revision,
    capability_entry_count: capabilities.entries.length,
    capability_semantic_digest_sha256: capabilitySemanticDigest(capabilities),
    capability_captured_at: capabilities.capturedAt,
    route_contract_id: routeAdapter.contractId,
    route_contract_version: routeAdapter.contractVersion,
    route_declaration_revision: routeAdapter.declarationRevision,
    route_surface_id: routeAdapter.surfaceId,
    route_loaded_by_trusted_service_id: routeAdapter.loadedByTrustedServiceId,
    route_loaded_at: routeAdapter.loadedAt,
    route_descriptor_schema_id: route.descriptorSchemaId,
    route_descriptor_version: route.descriptorVersion,
    route_descriptor_revision: route.descriptorRevision,
    route_destination_kind_id: route.destinationKindId,
    route_destination_subject: route.destinationSubject,
    route_descriptor_digest_sha256: route.descriptorDigestSha256,
    route_attribute_count: route.attributes.length,
    route_attributes_digest_sha256: routeAttributesDigest(route.attributes),
    revision: binding.revision,
    created_at: binding.createdAt,
    updated_at: binding.updatedAt
  };
}

export function buildInsertBindingAnchorSql(
  commit: InboxV2SourceThreadBindingCreationCommit
): SQL {
  const binding = commit.initialProjection.binding;
  return sql`
    insert into inbox_v2_source_thread_bindings (
      tenant_id, id, external_thread_id, source_connection_id,
      source_account_id, created_at
    ) values (
      ${binding.tenantId}, ${binding.id}, ${binding.externalThread.id},
      ${binding.sourceConnection.id}, ${binding.sourceAccount.id},
      ${binding.createdAt}::timestamptz
    )
    on conflict do nothing
    returning id
  `;
}

function buildInsertBindingHeadSql(record: BindingHeadRecord): SQL {
  return sql`
    insert into inbox_v2_source_thread_binding_heads
    select populated.*
    from jsonb_populate_record(
      null::inbox_v2_source_thread_binding_heads,
      ${JSON.stringify(record)}::jsonb
    ) populated
  `;
}

const MUTABLE_BINDING_HEAD_COLUMNS = [
  "account_identity_revision",
  "account_generation",
  "account_identity_state",
  "account_canonical_key_digest_sha256",
  "account_identity_trusted_service_id",
  "account_verified_at",
  "account_verification_evidence_set_id",
  "binding_generation",
  "current_remote_access_episode_id",
  "current_remote_access_episode_revision",
  "remote_access_state",
  "remote_access_evidence_authority",
  "remote_access_revision",
  "remote_access_since",
  "remote_access_evidence_set_id",
  "administrative_state",
  "administrative_revision",
  "administrative_changed_at",
  "runtime_health_state",
  "runtime_health_revision",
  "runtime_health_checked_at",
  "runtime_diagnostic_code_id",
  "runtime_diagnostic_retryable",
  "runtime_diagnostic_correlation_token",
  "runtime_diagnostic_safe_operator_hint_id",
  "history_sync_state",
  "history_sync_revision",
  "history_receive_cursor",
  "history_cursor",
  "history_provider_watermark",
  "history_last_durable_raw_event_id",
  "history_updated_at",
  "history_diagnostic_code_id",
  "history_diagnostic_retryable",
  "history_diagnostic_correlation_token",
  "history_diagnostic_safe_operator_hint_id",
  "provider_access_revision",
  "provider_role_count",
  "provider_roles_digest_sha256",
  "provider_access_evidence_set_id",
  "provider_access_observed_at",
  "capability_contract_id",
  "capability_contract_version",
  "capability_declaration_revision",
  "capability_surface_id",
  "capability_loaded_by_trusted_service_id",
  "capability_loaded_at",
  "capability_revision",
  "capability_entry_count",
  "capability_semantic_digest_sha256",
  "capability_captured_at",
  "route_contract_id",
  "route_contract_version",
  "route_declaration_revision",
  "route_surface_id",
  "route_loaded_by_trusted_service_id",
  "route_loaded_at",
  "route_descriptor_schema_id",
  "route_descriptor_version",
  "route_descriptor_revision",
  "route_destination_kind_id",
  "route_destination_subject",
  "route_descriptor_digest_sha256",
  "route_attribute_count",
  "route_attributes_digest_sha256",
  "revision",
  "updated_at"
] as const;

export function buildUpdateBindingHeadCasSql(input: {
  record: BindingHeadRecord;
  expectedRevision: string;
}): SQL {
  const assignments = MUTABLE_BINDING_HEAD_COLUMNS.map(
    (column) => `${column} = desired.${column}`
  ).join(",\n      ");
  return sql`
    with desired as materialized (
      select populated.*
      from jsonb_populate_record(
        null::inbox_v2_source_thread_binding_heads,
        ${JSON.stringify(input.record)}::jsonb
      ) populated
    )
    update inbox_v2_source_thread_binding_heads head
    set ${sql.raw(assignments)}
    from desired
    where head.tenant_id = desired.tenant_id
      and head.binding_id = desired.binding_id
      and head.revision = ${input.expectedRevision}::bigint
    returning head.revision
  `;
}

function buildInsertBindingSnapshotSql(input: {
  record: BindingHeadRecord;
  transitionId: string | null;
  expectedRevision: string | null;
}): SQL {
  const snapshot = {
    ...input.record,
    transition_id: input.transitionId,
    expected_binding_revision: input.expectedRevision
  };
  return sql`
    insert into inbox_v2_source_thread_binding_snapshots
    select populated.*
    from jsonb_populate_record(
      null::inbox_v2_source_thread_binding_snapshots,
      ${JSON.stringify(snapshot)}::jsonb
    ) populated
  `;
}

async function insertEvidenceSet(
  executor: RawSqlExecutor,
  input: {
    projection: InboxV2SourceThreadBindingCurrentProjection;
    evidenceSetId: string;
    references: readonly EvidenceReference[];
    createdAt: string;
  }
): Promise<void> {
  const binding = input.projection.binding;
  await executor.execute(sql`
    insert into inbox_v2_source_thread_binding_evidence_sets (
      tenant_id, id, binding_id, external_thread_id,
      source_connection_id, source_account_id, reference_count,
      ordered_reference_digest_sha256, created_at
    ) values (
      ${binding.tenantId}, ${input.evidenceSetId}, ${binding.id},
      ${binding.externalThread.id}, ${binding.sourceConnection.id},
      ${binding.sourceAccount.id}, ${input.references.length},
      ${evidenceDigest(input.references)}, ${input.createdAt}::timestamptz
    )
  `);

  for (const [ordinal, reference] of input.references.entries()) {
    const result = await executor.execute<{ ordinal: unknown }>(
      buildInsertEvidenceReferenceSql({
        tenantId: binding.tenantId,
        evidenceSetId: input.evidenceSetId,
        bindingId: String(binding.id),
        sourceConnectionId: String(binding.sourceConnection.id),
        sourceAccountId: String(binding.sourceAccount.id),
        ordinal,
        reference
      })
    );
    if (result.rows.length !== 1) {
      throw invariantError(
        `SourceThreadBinding evidence reference ${reference.kind}:${String(reference.id)} is missing its typed authority.`
      );
    }
  }
}

export function buildInsertEvidenceReferenceSql(input: {
  tenantId: string;
  evidenceSetId: string;
  bindingId: string;
  sourceConnectionId: string;
  sourceAccountId: string;
  ordinal: number;
  reference: EvidenceReference;
}): SQL {
  const columns = sql.raw(`
    tenant_id, evidence_set_id, binding_id, source_connection_id,
    source_account_id,
    ordinal, kind, raw_inbound_event_id, normalized_inbound_event_id,
    source_account_identity_transition_id,
    source_account_identity_transition_resulting_revision,
    source_account_identity_transition_resulting_generation,
    source_account_identity_alias_id,
    source_account_identity_alias_expected_revision,
    source_account_identity_alias_expected_generation,
    source_account_identity_alias_target_state,
    source_account_identity_alias_canonical_key_digest_sha256,
    provider_roster_evidence_id, provider_roster_member_evidence_id
  `);
  const common = [
    input.tenantId,
    input.evidenceSetId,
    input.sourceConnectionId,
    input.sourceAccountId,
    input.ordinal,
    input.reference.kind
  ] as const;

  if (input.reference.kind === "source_account_identity_transition") {
    return sql`
      insert into inbox_v2_source_thread_binding_evidence_references (
        ${columns}
      )
      select
        ${common[0]}, ${common[1]}, ${input.bindingId}, ${common[2]}, ${common[3]},
        ${common[4]}, ${common[5]}, null, null, authority.id,
        authority.resulting_revision, authority.resulting_account_generation,
        null, null, null, null, null, null, null
      from inbox_v2_source_account_identity_transitions authority
      where authority.tenant_id = ${input.tenantId}
        and authority.id = ${input.reference.id}
        and authority.source_account_id = ${input.sourceAccountId}
      returning ordinal
    `;
  }

  if (input.reference.kind === "source_account_identity_alias") {
    return sql`
      insert into inbox_v2_source_thread_binding_evidence_references (
        ${columns}
      )
      select
        ${common[0]}, ${common[1]}, ${input.bindingId}, ${common[2]}, ${common[3]},
        ${common[4]}, ${common[5]}, null, null, null, null, null,
        authority.id, authority.expected_account_identity_revision,
        authority.expected_account_generation, authority.target_identity_state,
        authority.canonical_key_digest_sha256, null, null
      from inbox_v2_source_account_identity_aliases authority
      where authority.tenant_id = ${input.tenantId}
        and authority.id = ${input.reference.id}
        and authority.canonical_source_account_id = ${input.sourceAccountId}
      returning ordinal
    `;
  }

  if (input.reference.kind === "provider_roster_evidence") {
    return sql`
      insert into inbox_v2_source_thread_binding_evidence_references (
        ${columns}
      )
      select
        ${common[0]}, ${common[1]}, ${input.bindingId}, ${common[2]}, ${common[3]},
        ${common[4]}, ${common[5]}, null, null, null, null, null,
        null, null, null, null, null, authority.id, null
      from inbox_v2_provider_roster_evidence authority
      where authority.tenant_id = ${input.tenantId}
        and authority.id = ${input.reference.id}
        and authority.source_thread_binding_id = ${input.bindingId}
        and authority.source_connection_id = ${input.sourceConnectionId}
        and authority.source_account_id = ${input.sourceAccountId}
      returning ordinal
    `;
  }

  if (input.reference.kind === "provider_roster_member_evidence") {
    return sql`
      insert into inbox_v2_source_thread_binding_evidence_references (
        ${columns}
      )
      select
        ${common[0]}, ${common[1]}, ${input.bindingId}, ${common[2]}, ${common[3]},
        ${common[4]}, ${common[5]}, null, null, null, null, null,
        null, null, null, null, null, null, authority.id
      from inbox_v2_provider_roster_member_evidence authority
      where authority.tenant_id = ${input.tenantId}
        and authority.id = ${input.reference.id}
        and authority.source_thread_binding_id = ${input.bindingId}
        and authority.source_connection_id = ${input.sourceConnectionId}
        and authority.source_account_id = ${input.sourceAccountId}
      returning ordinal
    `;
  }

  const rawId =
    input.reference.kind === "raw_inbound_event" ? input.reference.id : null;
  const normalizedId =
    input.reference.kind === "normalized_inbound_event"
      ? input.reference.id
      : null;
  return sql`
    insert into inbox_v2_source_thread_binding_evidence_references (
      ${columns}
    ) values (
      ${common[0]}, ${common[1]}, ${input.bindingId}, ${common[2]}, ${common[3]},
      ${common[4]}, ${common[5]}, ${rawId}, ${normalizedId},
      null, null, null, null, null, null, null, null, null, null
    )
    returning ordinal
  `;
}

async function insertProviderRoles(
  executor: RawSqlExecutor,
  projection: InboxV2SourceThreadBindingCurrentProjection
): Promise<void> {
  const binding = projection.binding;
  const roles = binding.providerAccess.roleIds;
  if (roles.length === 0) return;
  const values = roles.map(
    (roleId, ordinal) => sql`(
      ${binding.tenantId}, ${binding.id}, ${binding.providerAccess.revision}::bigint,
      ${binding.revision}::bigint, ${ordinal}, ${roleId}
    )`
  );
  await executor.execute(sql`
    insert into inbox_v2_source_thread_binding_provider_roles (
      tenant_id, binding_id, provider_access_revision,
      materialized_by_binding_revision, ordinal, provider_role_id
    ) values ${sql.join(values, sql`, `)}
  `);
}

async function insertCapabilities(
  executor: RawSqlExecutor,
  projection: InboxV2SourceThreadBindingCurrentProjection,
  evidenceSetIds: readonly string[]
): Promise<void> {
  const binding = projection.binding;
  const snapshot = binding.capabilities;
  if (snapshot.entries.length !== evidenceSetIds.length) {
    throw invariantError(
      "SourceThreadBinding capability evidence materialization is incomplete."
    );
  }
  if (snapshot.entries.length === 0) return;

  const entryValues = snapshot.entries.map((entry, ordinal) => {
    const diagnostic = entry.diagnostic;
    return sql`(
      ${binding.tenantId}, ${binding.id}, ${snapshot.revision}::bigint,
      ${binding.revision}::bigint, ${ordinal}, ${entry.capabilityId},
      ${entry.operationId}, ${entry.contentKindId}, ${entry.state},
      ${entry.referencePortability}, ${entry.validUntil}::timestamptz,
      ${diagnostic?.codeId ?? null}, ${diagnostic?.retryable ?? null},
      ${diagnostic?.correlationToken ?? null},
      ${diagnostic?.safeOperatorHintId ?? null},
      ${entry.requiredProviderRoleIds.length}, ${evidenceSetIds[ordinal]}
    )`;
  });
  await executor.execute(sql`
    insert into inbox_v2_source_thread_binding_capability_entries (
      tenant_id, binding_id, capability_revision,
      materialized_by_binding_revision, ordinal, capability_id,
      operation_id, content_kind_id, state, reference_portability,
      valid_until, diagnostic_code_id, diagnostic_retryable,
      diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
      required_provider_role_count, evidence_set_id
    ) values ${sql.join(entryValues, sql`, `)}
  `);

  const roleValues = snapshot.entries.flatMap((entry, capabilityOrdinal) =>
    entry.requiredProviderRoleIds.map(
      (roleId, ordinal) => sql`(
      ${binding.tenantId}, ${binding.id}, ${snapshot.revision}::bigint,
      ${binding.revision}::bigint, ${capabilityOrdinal}, ${entry.capabilityId},
      ${entry.operationId}, ${contentKindKey(entry.contentKindId)},
      ${ordinal}, ${roleId}
    )`
    )
  );
  if (roleValues.length === 0) return;
  await executor.execute(sql`
    insert into inbox_v2_source_thread_binding_capability_required_roles (
      tenant_id, binding_id, capability_revision,
      materialized_by_binding_revision, capability_ordinal, capability_id,
      operation_id, content_kind_key, ordinal, provider_role_id
    ) values ${sql.join(roleValues, sql`, `)}
  `);
}

async function insertRouteAttributes(
  executor: RawSqlExecutor,
  projection: InboxV2SourceThreadBindingCurrentProjection
): Promise<void> {
  const binding = projection.binding;
  const descriptor = binding.routeDescriptor;
  if (descriptor.attributes.length === 0) return;
  const values = descriptor.attributes.map(
    (attribute, ordinal) => sql`(
    ${binding.tenantId}, ${binding.id},
    ${descriptor.descriptorRevision}::bigint, ${binding.revision}::bigint,
    ${ordinal}, ${attribute.attributeId}, ${attribute.value}
  )`
  );
  await executor.execute(sql`
    insert into inbox_v2_source_thread_binding_route_attributes (
      tenant_id, binding_id, route_descriptor_revision,
      materialized_by_binding_revision, ordinal, attribute_id, value
    ) values ${sql.join(values, sql`, `)}
  `);
}

function toTransitionRecord(
  commit: InboxV2SourceThreadBindingTransitionCommit,
  resultingAccountIdentityRevision: string | null,
  evidenceSetId: string | null = null,
  resultingAccountCanonicalKeyDigestSha256: string | null = null
) {
  const transition = commit.transition;
  const actor = transition.actor;
  const record: Record<string, unknown> = {
    tenant_id: transition.tenantId,
    id: transition.id,
    binding_id: transition.binding.id,
    kind: transition.kind,
    actor_kind: actor.kind,
    actor_employee_id: actor.kind === "employee" ? actor.employee.id : null,
    actor_authorization_epoch:
      actor.kind === "employee" ? actor.authorizationEpoch : null,
    actor_trusted_service_id:
      actor.kind === "trusted_service" ? actor.trustedServiceId : null,
    reason_id: transition.reasonId,
    expected_binding_revision: transition.expectedBindingRevision,
    resulting_binding_revision: transition.resultingBindingRevision,
    evidence_set_id: evidenceSetId,
    remote_from_state: null,
    remote_to_state: null,
    expected_remote_access_revision: null,
    resulting_remote_access_revision: null,
    resulting_remote_evidence_authority: null,
    closed_remote_access_episode_id: null,
    opened_remote_access_episode_id: null,
    administrative_from_state: null,
    administrative_to_state: null,
    expected_administrative_revision: null,
    resulting_administrative_revision: null,
    administrative_authorization_effect: null,
    administrative_required_permission_id: null,
    administrative_matched_permission_count: null,
    administrative_decision_revision: null,
    administrative_decision_token: null,
    administrative_loaded_by_trusted_service_id: null,
    administrative_decided_at: null,
    administrative_not_after: null,
    administrative_target_binding_id: null,
    administrative_target_external_thread_id: null,
    administrative_target_source_connection_id: null,
    administrative_target_source_account_id: null,
    runtime_health_from_state: null,
    runtime_health_to_state: null,
    expected_runtime_health_revision: null,
    resulting_runtime_health_revision: null,
    resulting_runtime_diagnostic_code_id: null,
    resulting_runtime_diagnostic_retryable: null,
    resulting_runtime_diagnostic_correlation_token: null,
    resulting_runtime_diagnostic_safe_operator_hint_id: null,
    history_sync_from_state: null,
    history_sync_to_state: null,
    expected_history_sync_revision: null,
    resulting_history_sync_revision: null,
    resulting_history_receive_cursor: null,
    resulting_history_cursor: null,
    resulting_history_provider_watermark: null,
    resulting_history_last_durable_raw_event_id: null,
    resulting_history_diagnostic_code_id: null,
    resulting_history_diagnostic_retryable: null,
    resulting_history_diagnostic_correlation_token: null,
    resulting_history_diagnostic_safe_operator_hint_id: null,
    expected_capability_revision: null,
    resulting_capability_revision: null,
    resulting_capability_semantic_digest_sha256: null,
    expected_binding_generation: null,
    resulting_binding_generation: null,
    expected_route_descriptor_revision: null,
    resulting_route_descriptor_revision: null,
    resulting_route_descriptor_digest_sha256: null,
    resulting_route_attributes_digest_sha256: null,
    expected_account_generation: null,
    resulting_account_generation: null,
    resulting_account_identity_revision: null,
    resulting_account_identity_state: null,
    resulting_account_canonical_key_digest_sha256: null,
    expected_provider_access_revision: null,
    resulting_provider_access_revision: null,
    resulting_provider_roles_digest_sha256: null,
    occurred_at: transition.occurredAt
  };

  switch (transition.kind) {
    case "remote_access":
      Object.assign(record, {
        remote_from_state: transition.fromState,
        remote_to_state: transition.toState,
        expected_remote_access_revision:
          transition.expectedRemoteAccessRevision,
        resulting_remote_access_revision:
          transition.resultingRemoteAccess.revision,
        resulting_remote_evidence_authority:
          transition.resultingRemoteAccess.evidenceAuthority,
        closed_remote_access_episode_id: transition.closedEpisode.id,
        opened_remote_access_episode_id: transition.openedEpisode.id
      });
      break;
    case "administrative": {
      const decision = transition.authorizationDecision;
      Object.assign(record, {
        administrative_from_state: transition.fromState,
        administrative_to_state: transition.toState,
        expected_administrative_revision:
          transition.expectedAdministrativeRevision,
        resulting_administrative_revision:
          transition.resultingAdministrative.revision,
        administrative_authorization_effect: decision.effect,
        administrative_required_permission_id: decision.requiredPermissionId,
        administrative_matched_permission_count:
          decision.matchedPermissionIds.length,
        administrative_decision_revision: decision.decisionRevision,
        administrative_decision_token: decision.decisionToken,
        administrative_loaded_by_trusted_service_id:
          decision.loadedByTrustedServiceId,
        administrative_decided_at: decision.decidedAt,
        administrative_not_after: decision.notAfter,
        administrative_target_binding_id: decision.target.binding.id,
        administrative_target_external_thread_id:
          decision.target.externalThread.id,
        administrative_target_source_connection_id:
          decision.target.sourceConnection.id,
        administrative_target_source_account_id:
          decision.target.sourceAccount.id
      });
      break;
    }
    case "runtime_health": {
      const diagnostic = transition.resultingRuntimeHealth.diagnostic;
      Object.assign(record, {
        runtime_health_from_state: transition.fromState,
        runtime_health_to_state: transition.toState,
        expected_runtime_health_revision:
          transition.expectedRuntimeHealthRevision,
        resulting_runtime_health_revision:
          transition.resultingRuntimeHealth.revision,
        resulting_runtime_diagnostic_code_id: diagnostic?.codeId ?? null,
        resulting_runtime_diagnostic_retryable: diagnostic?.retryable ?? null,
        resulting_runtime_diagnostic_correlation_token:
          diagnostic?.correlationToken ?? null,
        resulting_runtime_diagnostic_safe_operator_hint_id:
          diagnostic?.safeOperatorHintId ?? null
      });
      break;
    }
    case "history_sync": {
      const snapshot = transition.resultingHistorySync;
      const diagnostic = snapshot.diagnostic;
      Object.assign(record, {
        history_sync_from_state: transition.fromState,
        history_sync_to_state: transition.toState,
        expected_history_sync_revision: transition.expectedHistorySyncRevision,
        resulting_history_sync_revision: snapshot.revision,
        resulting_history_receive_cursor: snapshot.receiveCursor,
        resulting_history_cursor: snapshot.historyCursor,
        resulting_history_provider_watermark: snapshot.providerWatermark,
        resulting_history_last_durable_raw_event_id:
          snapshot.lastDurableRawEvent?.id ?? null,
        resulting_history_diagnostic_code_id: diagnostic?.codeId ?? null,
        resulting_history_diagnostic_retryable: diagnostic?.retryable ?? null,
        resulting_history_diagnostic_correlation_token:
          diagnostic?.correlationToken ?? null,
        resulting_history_diagnostic_safe_operator_hint_id:
          diagnostic?.safeOperatorHintId ?? null
      });
      break;
    }
    case "capabilities":
      Object.assign(record, {
        expected_capability_revision: transition.expectedCapabilityRevision,
        resulting_capability_revision:
          transition.resultingCapabilities.revision,
        resulting_capability_semantic_digest_sha256: capabilitySemanticDigest(
          transition.resultingCapabilities
        )
      });
      break;
    case "route_descriptor":
      Object.assign(record, {
        expected_binding_generation: transition.expectedBindingGeneration,
        resulting_binding_generation: transition.resultingBindingGeneration,
        expected_route_descriptor_revision:
          transition.expectedRouteDescriptorRevision,
        resulting_route_descriptor_revision:
          transition.resultingRouteDescriptor.descriptorRevision,
        resulting_route_descriptor_digest_sha256:
          transition.resultingRouteDescriptor.descriptorDigestSha256,
        resulting_route_attributes_digest_sha256: routeAttributesDigest(
          transition.resultingRouteDescriptor.attributes
        )
      });
      break;
    case "account_generation":
      Object.assign(record, {
        expected_account_generation: transition.expectedAccountGeneration,
        resulting_account_generation:
          transition.resultingAccountIdentitySnapshot.accountGeneration,
        resulting_account_identity_revision: resultingAccountIdentityRevision,
        resulting_account_identity_state: "verified",
        resulting_account_canonical_key_digest_sha256:
          resultingAccountCanonicalKeyDigestSha256
      });
      break;
    case "provider_access":
      Object.assign(record, {
        expected_binding_generation: transition.expectedBindingGeneration,
        resulting_binding_generation: transition.resultingBindingGeneration,
        expected_provider_access_revision:
          transition.expectedProviderAccessRevision,
        resulting_provider_access_revision:
          transition.resultingProviderAccess.revision,
        resulting_provider_roles_digest_sha256: providerRolesDigest(
          transition.resultingProviderAccess.roleIds
        )
      });
      break;
  }

  return record;
}

function buildInsertTransitionSql(record: TransitionRecord): SQL {
  return sql`
    insert into inbox_v2_source_thread_binding_transitions
    select populated.*
    from jsonb_populate_record(
      null::inbox_v2_source_thread_binding_transitions,
      ${JSON.stringify(record)}::jsonb
    ) populated
  `;
}

async function insertAdministrativePermissions(
  executor: RawSqlExecutor,
  commit: InboxV2SourceThreadBindingTransitionCommit
): Promise<void> {
  const transition = commit.transition;
  if (transition.kind !== "administrative") return;
  const decision = transition.authorizationDecision;
  if (decision.matchedPermissionIds.length === 0) return;
  const values = decision.matchedPermissionIds.map(
    (permissionId, ordinal) =>
      sql`(
      ${transition.tenantId}, ${transition.id}, 'administrative',
      ${decision.requiredPermissionId}, ${decision.matchedPermissionIds.length},
      ${ordinal}, ${permissionId}
    )`
  );
  await executor.execute(sql`
    insert into inbox_v2_source_thread_binding_transition_matched_permissions (
      tenant_id, transition_id, transition_kind, required_permission_id,
      expected_permission_count, ordinal, permission_id
    ) values ${sql.join(values, sql`, `)}
  `);
}

function creationEvidenceMaterializations(
  commit: InboxV2SourceThreadBindingCreationCommit,
  materialization: ProjectionMaterialization
): readonly EvidenceMaterialization[] {
  const binding = commit.initialProjection.binding;
  return [
    {
      id: materialization.accountEvidenceSetId,
      references: binding.accountIdentitySnapshot.verificationEvidence,
      createdAt: binding.accountIdentitySnapshot.verifiedAt
    },
    {
      id: materialization.remoteEvidenceSetId,
      references: binding.remoteAccess.evidence,
      createdAt: binding.remoteAccess.since
    },
    {
      id: materialization.providerEvidenceSetId,
      references: binding.providerAccess.evidence,
      createdAt: binding.providerAccess.observedAt
    },
    ...binding.capabilities.entries.map((entry, index) => ({
      id: materialization.capabilityEvidenceSetIds[index]!,
      references: entry.evidence,
      createdAt: binding.capabilities.capturedAt
    }))
  ];
}

function transitionEvidenceMaterializations(
  commit: InboxV2SourceThreadBindingTransitionCommit,
  materialization: ProjectionMaterialization
): readonly EvidenceMaterialization[] {
  const transition = commit.transition;
  if (
    transition.kind === "remote_access" ||
    transition.kind === "account_generation" ||
    transition.kind === "provider_access" ||
    transition.kind === "route_descriptor"
  ) {
    if (materialization.transitionEvidenceSetId === null) {
      throw invariantError("Typed binding transition lost its evidence set.");
    }
    return [
      {
        id: materialization.transitionEvidenceSetId,
        references: transition.evidence,
        createdAt: transition.occurredAt
      }
    ];
  }
  if (transition.kind === "capabilities") {
    if (materialization.transitionEvidenceSetId === null) {
      throw invariantError("Capability transition lost its evidence set.");
    }
    return [
      ...transition.resultingCapabilities.entries.map((entry, index) => ({
        id: materialization.capabilityEvidenceSetIds[index]!,
        references: entry.evidence,
        createdAt: transition.resultingCapabilities.capturedAt
      })),
      {
        id: materialization.transitionEvidenceSetId,
        references: transition.evidence,
        createdAt: transition.occurredAt
      }
    ];
  }
  return [];
}

async function insertOpenRemoteAccessEpisode(
  executor: RawSqlExecutor,
  projection: InboxV2SourceThreadBindingCurrentProjection,
  evidenceSetId: string
): Promise<void> {
  const episode = projection.currentRemoteAccessEpisode;
  await executor.execute(sql`
    insert into inbox_v2_source_thread_binding_remote_access_episodes (
      tenant_id, id, binding_id, state, started_at, ended_at,
      start_evidence_set_id, end_evidence_set_id, revision, updated_at
    ) values (
      ${episode.tenantId}, ${episode.id}, ${episode.binding.id},
      ${episode.state}, ${episode.startedAt}::timestamptz, null,
      ${evidenceSetId}, null, 1, ${episode.updatedAt}::timestamptz
    )
  `);
}

async function closeRemoteAccessEpisode(
  executor: RawSqlExecutor,
  commit: InboxV2SourceThreadBindingTransitionCommit,
  evidenceSetId: string
): Promise<void> {
  const transition = commit.transition;
  if (transition.kind !== "remote_access") return;
  const result = await executor.execute<{ id: unknown }>(sql`
    update inbox_v2_source_thread_binding_remote_access_episodes
    set ended_at = ${transition.occurredAt}::timestamptz,
        end_evidence_set_id = ${evidenceSetId},
        revision = 2,
        updated_at = ${transition.occurredAt}::timestamptz
    where tenant_id = ${transition.tenantId}
      and binding_id = ${transition.binding.id}
      and id = ${transition.closedEpisode.id}
      and revision = 1
      and ended_at is null
    returning id
  `);
  if (result.rows.length !== 1) {
    throw invariantError(
      "SourceThreadBinding remote transition could not close its current episode."
    );
  }
}

async function insertCreationAggregate(
  executor: RawSqlExecutor,
  commit: InboxV2SourceThreadBindingCreationCommit,
  materialization: ProjectionMaterialization
): Promise<void> {
  const projection = commit.initialProjection;
  for (const evidence of creationEvidenceMaterializations(
    commit,
    materialization
  )) {
    await insertEvidenceSet(executor, {
      projection,
      evidenceSetId: evidence.id,
      references: evidence.references,
      createdAt: evidence.createdAt
    });
  }

  await insertOpenRemoteAccessEpisode(
    executor,
    projection,
    materialization.remoteEvidenceSetId
  );
  const record = toBindingHeadRecord(projection, materialization);
  await executor.execute(buildInsertBindingHeadSql(record));
  await insertProviderRoles(executor, projection);
  await insertCapabilities(
    executor,
    projection,
    materialization.capabilityEvidenceSetIds
  );
  await insertRouteAttributes(executor, projection);
  await executor.execute(
    buildInsertBindingSnapshotSql({
      record,
      transitionId: null,
      expectedRevision: null
    })
  );
}

async function insertTransitionAggregate(
  executor: RawSqlExecutor,
  commit: InboxV2SourceThreadBindingTransitionCommit,
  materialization: ProjectionMaterialization
): Promise<void> {
  const transition = commit.transition;
  for (const evidence of transitionEvidenceMaterializations(
    commit,
    materialization
  )) {
    await insertEvidenceSet(executor, {
      projection: commit.after,
      evidenceSetId: evidence.id,
      references: evidence.references,
      createdAt: evidence.createdAt
    });
  }

  const transitionRecord = toTransitionRecord(
    commit,
    materialization.accountIdentityRevision,
    materialization.transitionEvidenceSetId,
    materialization.accountCanonicalKeyDigestSha256
  );
  if (transition.kind === "remote_access") {
    if (materialization.transitionEvidenceSetId === null) {
      throw invariantError("Remote transition lost its evidence set.");
    }
    await closeRemoteAccessEpisode(
      executor,
      commit,
      materialization.transitionEvidenceSetId
    );
    await insertOpenRemoteAccessEpisode(
      executor,
      commit.after,
      materialization.transitionEvidenceSetId
    );
  }

  // Remote episode FKs on the transition are immediate: close/open first.
  // Their edge-integrity triggers are deferred and observe the transition and
  // new head at commit. The typed transition must still precede the head CAS.
  await executor.execute(buildInsertTransitionSql(transitionRecord));
  await insertAdministrativePermissions(executor, commit);

  if (transition.kind === "provider_access") {
    await insertProviderRoles(executor, commit.after);
  } else if (transition.kind === "capabilities") {
    await insertCapabilities(
      executor,
      commit.after,
      materialization.capabilityEvidenceSetIds
    );
  } else if (transition.kind === "route_descriptor") {
    await insertRouteAttributes(executor, commit.after);
  }

  const record = toBindingHeadRecord(commit.after, materialization);
  const updated = await executor.execute<{ revision: unknown }>(
    buildUpdateBindingHeadCasSql({
      record,
      expectedRevision: String(transition.expectedBindingRevision)
    })
  );
  if (updated.rows.length !== 1) {
    throw invariantError(
      "SourceThreadBinding head CAS changed after its transaction lock."
    );
  }
  await executor.execute(
    buildInsertBindingSnapshotSql({
      record,
      transitionId: String(transition.id),
      expectedRevision: String(transition.expectedBindingRevision)
    })
  );
}

export function buildFindExistingBindingTransitionSql(input: {
  tenantId: string;
  transitionId: string;
}): SQL {
  return sql`
    select
      to_jsonb(transition_row) || jsonb_build_object(
        'expected_binding_revision',
          transition_row.expected_binding_revision::text,
        'resulting_binding_revision',
          transition_row.resulting_binding_revision::text,
        'expected_remote_access_revision',
          transition_row.expected_remote_access_revision::text,
        'resulting_remote_access_revision',
          transition_row.resulting_remote_access_revision::text,
        'expected_administrative_revision',
          transition_row.expected_administrative_revision::text,
        'resulting_administrative_revision',
          transition_row.resulting_administrative_revision::text,
        'administrative_matched_permission_count',
          transition_row.administrative_matched_permission_count::text,
        'administrative_decision_revision',
          transition_row.administrative_decision_revision::text,
        'expected_runtime_health_revision',
          transition_row.expected_runtime_health_revision::text,
        'resulting_runtime_health_revision',
          transition_row.resulting_runtime_health_revision::text,
        'expected_history_sync_revision',
          transition_row.expected_history_sync_revision::text,
        'resulting_history_sync_revision',
          transition_row.resulting_history_sync_revision::text,
        'expected_capability_revision',
          transition_row.expected_capability_revision::text,
        'resulting_capability_revision',
          transition_row.resulting_capability_revision::text,
        'expected_binding_generation',
          transition_row.expected_binding_generation::text,
        'resulting_binding_generation',
          transition_row.resulting_binding_generation::text,
        'expected_route_descriptor_revision',
          transition_row.expected_route_descriptor_revision::text,
        'resulting_route_descriptor_revision',
          transition_row.resulting_route_descriptor_revision::text,
        'expected_account_generation',
          transition_row.expected_account_generation::text,
        'resulting_account_generation',
          transition_row.resulting_account_generation::text,
        'resulting_account_identity_revision',
          transition_row.resulting_account_identity_revision::text,
        'expected_provider_access_revision',
          transition_row.expected_provider_access_revision::text,
        'resulting_provider_access_revision',
          transition_row.resulting_provider_access_revision::text
      ) as transition,
      coalesce(permissions.items, jsonb_build_array()) as matched_permission_ids,
      coalesce(evidence.items, jsonb_build_array()) as evidence
    from inbox_v2_source_thread_binding_transitions transition_row
    left join lateral (
      select jsonb_agg(permission.permission_id order by permission.ordinal) as items
      from inbox_v2_source_thread_binding_transition_matched_permissions permission
      where permission.tenant_id = transition_row.tenant_id
        and permission.transition_id = transition_row.id
    ) permissions on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'tenantId', reference.tenant_id,
          'kind', reference.kind,
          'id', coalesce(
            reference.raw_inbound_event_id,
            reference.normalized_inbound_event_id,
            reference.source_account_identity_transition_id,
            reference.source_account_identity_alias_id,
            reference.provider_roster_evidence_id,
            reference.provider_roster_member_evidence_id
          )
        ) order by reference.ordinal
      ) as items
      from inbox_v2_source_thread_binding_evidence_references reference
      where reference.tenant_id = transition_row.tenant_id
        and reference.evidence_set_id = transition_row.evidence_set_id
    ) evidence on true
    where transition_row.tenant_id = ${input.tenantId}
      and transition_row.id = ${input.transitionId}
  `;
}

async function loadExistingTransition(
  executor: RawSqlExecutor,
  commit: InboxV2SourceThreadBindingTransitionCommit
): Promise<ExistingTransitionRow | null> {
  const transition = commit.transition;
  const result = await executor.execute<ExistingTransitionRow>(
    buildFindExistingBindingTransitionSql({
      tenantId: transition.tenantId,
      transitionId: String(transition.id)
    })
  );
  requireAtMostOneRow(result, "SourceThreadBinding transition lookup");
  return result.rows[0] ?? null;
}

function transitionRecordMatches(
  stored: ExistingTransitionRow,
  expected: TransitionRecord,
  commit?: InboxV2SourceThreadBindingTransitionCommit
): boolean {
  const storedRecord = parseJsonValue(stored.transition);
  if (
    typeof storedRecord !== "object" ||
    storedRecord === null ||
    Array.isArray(storedRecord)
  ) {
    return false;
  }

  const normalizedStored = normalizeTransitionRecord(
    storedRecord as Record<string, unknown>
  );
  const normalizedExpected = normalizeTransitionRecord(expected);
  if (normalizedExpected.resulting_account_identity_revision === null) {
    delete normalizedStored.resulting_account_identity_revision;
    delete normalizedExpected.resulting_account_identity_revision;
  }
  if (
    normalizedExpected.resulting_account_canonical_key_digest_sha256 === null
  ) {
    delete normalizedStored.resulting_account_canonical_key_digest_sha256;
    delete normalizedExpected.resulting_account_canonical_key_digest_sha256;
  }

  const expectedPermissions =
    commit?.transition.kind === "administrative"
      ? commit.transition.authorizationDecision.matchedPermissionIds
      : [];
  const expectedEvidence =
    commit && "evidence" in commit.transition ? commit.transition.evidence : [];

  return (
    sameValue(normalizedStored, normalizedExpected) &&
    sameValue(
      parseJsonValue(stored.matched_permission_ids),
      expectedPermissions
    ) &&
    sameValue(parseJsonValue(stored.evidence), expectedEvidence)
  );
}

function expectedTransitionRecordForIdempotency(
  commit: InboxV2SourceThreadBindingTransitionCommit
): TransitionRecord {
  const transition = commit.transition;
  let purpose: string | null = null;
  if (transition.kind === "remote_access") purpose = "remote-transition";
  else if (transition.kind === "account_generation") {
    purpose = "account-transition";
  } else if (transition.kind === "provider_access") {
    purpose = "provider-transition";
  } else if (transition.kind === "capabilities") {
    purpose = "capability-transition";
  } else if (transition.kind === "route_descriptor") {
    purpose = "route-transition";
  }
  const evidenceSet =
    purpose !== null && "evidence" in transition
      ? evidenceSetId(
          String(transition.binding.id),
          String(transition.resultingBindingRevision),
          purpose,
          transition.evidence
        )
      : null;
  return toTransitionRecord(commit, null, evidenceSet, null);
}

const TRANSITION_NUMERIC_COLUMNS = new Set([
  "expected_binding_revision",
  "resulting_binding_revision",
  "expected_remote_access_revision",
  "resulting_remote_access_revision",
  "expected_administrative_revision",
  "resulting_administrative_revision",
  "administrative_matched_permission_count",
  "administrative_decision_revision",
  "expected_runtime_health_revision",
  "resulting_runtime_health_revision",
  "expected_history_sync_revision",
  "resulting_history_sync_revision",
  "expected_capability_revision",
  "resulting_capability_revision",
  "expected_binding_generation",
  "resulting_binding_generation",
  "expected_route_descriptor_revision",
  "resulting_route_descriptor_revision",
  "expected_account_generation",
  "resulting_account_generation",
  "resulting_account_identity_revision",
  "expected_provider_access_revision",
  "resulting_provider_access_revision"
]);

const TRANSITION_TIMESTAMP_COLUMNS = new Set([
  "administrative_decided_at",
  "administrative_not_after",
  "occurred_at"
]);

function normalizeTransitionRecord(
  record: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) {
      normalized[key] = null;
    } else if (TRANSITION_NUMERIC_COLUMNS.has(key)) {
      normalized[key] = String(value);
    } else if (TRANSITION_TIMESTAMP_COLUMNS.has(key)) {
      normalized[key] = normalizeTimestamp(value);
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(",")}}`;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function sameTimestamp(left: unknown, right: string): boolean {
  return normalizeTimestamp(left) === normalizeTimestamp(right);
}

function normalizeTimestamp(value: unknown): string {
  const millis =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(millis)
    ? new Date(millis).toISOString()
    : String(value);
}

function requireAtMostOneRow<Row extends Record<string, unknown>>(
  result: RawSqlQueryResult<Row>,
  label: string
): void {
  if (result.rows.length > 1) {
    throw invariantError(`${label} returned more than one row.`);
  }
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
