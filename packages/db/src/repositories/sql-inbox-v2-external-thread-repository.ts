import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationSchema,
  inboxV2ExternalThreadAliasCommitSchema,
  inboxV2ExternalThreadAliasSchema,
  inboxV2ExternalThreadIdSchema,
  inboxV2ExternalThreadKeySchema,
  inboxV2ExternalThreadMappingSchema,
  inboxV2TenantIdSchema,
  type InboxV2BigintCounter,
  type InboxV2Conversation,
  type InboxV2ConversationId,
  type InboxV2ExternalThreadAlias,
  type InboxV2ExternalThreadAliasCommit,
  type InboxV2ExternalThreadAliasId,
  type InboxV2ExternalThreadId,
  type InboxV2ExternalThreadKey,
  type InboxV2ExternalThreadMapping,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";

import type { HuleeDatabase } from "../client";
import {
  buildInsertInboxV2ConversationMembershipHeadSql,
  InboxV2PersistenceInvariantError
} from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const RESOLVE_INPUT_KEYS = new Set(["mapping", "streamPosition"]);
const FIND_BY_KEY_INPUT_KEYS = new Set(["tenantId", "key"]);
const FIND_BY_ID_INPUT_KEYS = new Set(["tenantId", "threadId"]);
const KEY_REGISTRY_ID_PREFIX = "external_thread_key:";

export type ResolveOrCreateInboxV2ExternalThreadInput = Readonly<{
  /** Full contract snapshot for both the immutable thread and its candidate Conversation. */
  mapping: InboxV2ExternalThreadMapping;
  /** Durable tenant-stream position used when the candidate Conversation is first created. */
  streamPosition: InboxV2BigintCounter;
}>;

export type ResolveOrCreateInboxV2ExternalThreadResult =
  | Readonly<{
      kind: "created" | "already_exists";
      mapping: InboxV2ExternalThreadMapping;
    }>
  | Readonly<{
      kind:
        | "exact_key_conflict"
        | "key_reserved_as_alias"
        | "thread_id_conflict";
      existingMapping: InboxV2ExternalThreadMapping;
    }>
  | Readonly<{
      kind: "conversation_conflict";
      existingThreadId: InboxV2ExternalThreadId;
      conversationId: InboxV2ConversationId;
    }>
  | Readonly<{
      kind: "conversation_identity_conflict";
      existingConversation: InboxV2Conversation;
    }>
  | Readonly<{ kind: "digest_collision" }>;

export type FindInboxV2ExternalThreadByExactKeyResult =
  | Readonly<{ kind: "not_found" | "digest_collision" }>
  | Readonly<{
      kind: "found";
      reservationKind: "canonical" | "alias";
      mapping: InboxV2ExternalThreadMapping;
      matchedAlias: InboxV2ExternalThreadAlias | null;
    }>;

export type AppendInboxV2ExternalThreadAliasesResult =
  | Readonly<{
      kind: "committed" | "already_exists";
      aliases: readonly InboxV2ExternalThreadAlias[];
    }>
  | Readonly<{ kind: "canonical_not_found" | "canonical_conflict" }>
  | Readonly<{
      kind: "digest_collision";
      aliasId: InboxV2ExternalThreadAliasId;
    }>
  | Readonly<{
      kind: "key_conflict";
      aliasId: InboxV2ExternalThreadAliasId;
      reservationKind: "canonical" | "alias";
      existingThreadId: InboxV2ExternalThreadId;
    }>
  | Readonly<{
      kind: "alias_id_conflict";
      aliasId: InboxV2ExternalThreadAliasId;
    }>;

export type InboxV2ExternalThreadTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult>;
};

export type InboxV2ExternalThreadRepository = Readonly<{
  resolveOrCreateExactMapping(
    input: ResolveOrCreateInboxV2ExternalThreadInput
  ): Promise<ResolveOrCreateInboxV2ExternalThreadResult>;
  appendAliases(
    commit: InboxV2ExternalThreadAliasCommit
  ): Promise<AppendInboxV2ExternalThreadAliasesResult>;
  findByExactKey(input: {
    tenantId: InboxV2TenantId;
    key: InboxV2ExternalThreadKey;
  }): Promise<FindInboxV2ExternalThreadByExactKeyResult>;
  findById(input: {
    tenantId: InboxV2TenantId;
    threadId: InboxV2ExternalThreadId;
  }): Promise<InboxV2ExternalThreadMapping | null>;
}>;

type KeyRegistryRow = {
  registry_tenant_id: unknown;
  registry_id: unknown;
  entry_kind: unknown;
  realm_id: unknown;
  realm_version: unknown;
  canonicalization_version: unknown;
  scope_kind: unknown;
  scope_source_connection_id: unknown;
  scope_source_account_id: unknown;
  scope_owner_key: unknown;
  object_kind_id: unknown;
  canonical_external_subject: unknown;
  key_digest: unknown;
  canonical_thread_id: unknown;
  canonical_conversation_id: unknown;
  registry_revision: unknown;
  registry_created_at: unknown;
  registry_updated_at: unknown;
};

export type InboxV2ExternalThreadExactKeyReservation = Readonly<{
  tenantId: InboxV2TenantId;
  id: string;
  entryKind: "canonical" | "alias";
  key: InboxV2ExternalThreadKey;
  keyDigest: string;
  canonicalThreadId: InboxV2ExternalThreadId;
  canonicalConversationId: InboxV2ConversationId;
}>;

export type ReserveInboxV2ExternalThreadExactKeyResult =
  | Readonly<{ kind: "not_found" | "digest_collision" }>
  | Readonly<{
      kind: "reserved";
      reservation: InboxV2ExternalThreadExactKeyReservation;
    }>;

type KeyReservation = InboxV2ExternalThreadExactKeyReservation;

type MappingRow = KeyRegistryRow & {
  thread_tenant_id: unknown;
  thread_id: unknown;
  thread_key_registry_id: unknown;
  thread_realm_id: unknown;
  thread_realm_version: unknown;
  thread_canonicalization_version: unknown;
  thread_scope_kind: unknown;
  thread_scope_source_connection_id: unknown;
  thread_scope_source_account_id: unknown;
  thread_scope_owner_key: unknown;
  thread_object_kind_id: unknown;
  thread_canonical_external_subject: unknown;
  thread_key_digest: unknown;
  identity_declaration: unknown;
  thread_conversation_id: unknown;
  conversation_topology_snapshot: unknown;
  thread_revision: unknown;
  thread_created_at: unknown;
  thread_updated_at: unknown;
  conversation_tenant_id: unknown;
  conversation_id: unknown;
  conversation_topology: unknown;
  conversation_transport: unknown;
  purpose_id: unknown;
  lifecycle: unknown;
  conversation_revision: unknown;
  conversation_created_at: unknown;
  conversation_updated_at: unknown;
  head_conversation_id: unknown;
  latest_timeline_sequence: unknown;
  latest_activity_item_id: unknown;
  latest_activity_timeline_sequence: unknown;
  latest_activity_at: unknown;
  head_revision: unknown;
  head_created_at: unknown;
  head_updated_at: unknown;
};

type ConversationRow = {
  conversation_tenant_id: unknown;
  conversation_id: unknown;
  conversation_topology: unknown;
  conversation_transport: unknown;
  purpose_id: unknown;
  lifecycle: unknown;
  conversation_revision: unknown;
  conversation_created_at: unknown;
  conversation_updated_at: unknown;
  head_conversation_id: unknown;
  latest_timeline_sequence: unknown;
  latest_activity_item_id: unknown;
  latest_activity_timeline_sequence: unknown;
  latest_activity_at: unknown;
  head_revision: unknown;
  head_created_at: unknown;
  head_updated_at: unknown;
};

type AliasRow = {
  alias_tenant_id: unknown;
  alias_id: unknown;
  alias_key_registry_id: unknown;
  alias_realm_id: unknown;
  alias_realm_version: unknown;
  alias_canonicalization_version: unknown;
  alias_scope_kind: unknown;
  alias_scope_source_connection_id: unknown;
  alias_scope_source_account_id: unknown;
  alias_scope_owner_key: unknown;
  alias_object_kind_id: unknown;
  alias_canonical_external_subject: unknown;
  alias_key_digest: unknown;
  alias_identity_declaration: unknown;
  canonical_thread_id: unknown;
  canonical_conversation_id: unknown;
  canonical_key_registry_id: unknown;
  canonical_realm_id: unknown;
  canonical_realm_version: unknown;
  canonical_canonicalization_version: unknown;
  canonical_scope_kind: unknown;
  canonical_scope_source_connection_id: unknown;
  canonical_scope_source_account_id: unknown;
  canonical_scope_owner_key: unknown;
  canonical_object_kind_id: unknown;
  canonical_external_subject: unknown;
  canonical_key_digest: unknown;
  expected_canonical_thread_revision: unknown;
  decision_trusted_service_id: unknown;
  decision_policy_id: unknown;
  decision_policy_version: unknown;
  decision_reason_code_id: unknown;
  decision_authoritative_evidence_token: unknown;
  decision_decided_at: unknown;
  alias_revision: unknown;
  alias_created_at: unknown;
};

type IdRow = { id: unknown };
type ThreadTargetRow = { id: unknown; conversation_id: unknown };

export function createSqlInboxV2ExternalThreadRepository(
  executor: InboxV2ExternalThreadTransactionExecutor | HuleeDatabase
): InboxV2ExternalThreadRepository {
  const transactionExecutor =
    executor as unknown as InboxV2ExternalThreadTransactionExecutor;

  return {
    async resolveOrCreateExactMapping(input) {
      const normalized = normalizeResolveInput(input);
      return transactionExecutor.transaction((transaction) =>
        resolveOrCreateInboxV2ExternalThreadExactMappingInTransaction(
          transaction,
          normalized
        )
      );
    },

    async appendAliases(commit) {
      const normalized = inboxV2ExternalThreadAliasCommitSchema.parse(commit);
      const tenantId = normalized.tenantId;
      const canonicalKey = normalized.canonicalThreadSnapshot.key;
      const canonicalDigest =
        computeInboxV2ExternalThreadKeyDigest(canonicalKey);
      const digestEntries = [
        { digest: canonicalDigest, alias: null },
        ...normalized.aliases.map((alias) => ({
          digest: computeInboxV2ExternalThreadKeyDigest(alias.aliasKey),
          alias
        }))
      ].sort((left, right) => left.digest.localeCompare(right.digest));

      return transactionExecutor.transaction(async (transaction) => {
        for (const entry of digestEntries) {
          await acquireAdvisoryLock(transaction, "key", tenantId, entry.digest);
        }

        const canonicalReservation = await loadKeyReservation(transaction, {
          tenantId,
          keyDigest: canonicalDigest,
          lock: true
        });
        if (canonicalReservation === null) {
          return { kind: "canonical_not_found" };
        }
        if (
          canonicalReservation.entryKind !== "canonical" ||
          canonicalReservation.canonicalThreadId !==
            normalized.canonicalThreadSnapshot.id ||
          canonicalReservation.canonicalConversationId !==
            normalized.canonicalThreadSnapshot.conversation.id ||
          !sameExternalThreadKey(canonicalReservation.key, canonicalKey)
        ) {
          return { kind: "canonical_conflict" };
        }

        const existingByAliasId = new Map<
          InboxV2ExternalThreadAliasId,
          InboxV2ExternalThreadAlias
        >();
        for (const aliasId of [...normalized.aliases]
          .map((alias) => alias.id)
          .sort()) {
          await acquireAdvisoryLock(transaction, "alias", tenantId, aliasId);
          const existing = await loadAliasById(transaction, {
            tenantId,
            aliasId,
            lock: true
          });
          if (existing !== null) {
            existingByAliasId.set(aliasId, existing);
          }
        }

        const existingByKey = new Map<
          InboxV2ExternalThreadAliasId,
          InboxV2ExternalThreadAlias
        >();
        for (const alias of normalized.aliases) {
          const digest = computeInboxV2ExternalThreadKeyDigest(alias.aliasKey);
          const reservation = await loadKeyReservation(transaction, {
            tenantId,
            keyDigest: digest,
            lock: true
          });
          if (reservation === null) {
            continue;
          }
          if (!sameExternalThreadKey(reservation.key, alias.aliasKey)) {
            return { kind: "digest_collision", aliasId: alias.id };
          }
          if (
            reservation.entryKind !== "alias" ||
            reservation.canonicalThreadId !== alias.canonicalThread.id ||
            reservation.canonicalConversationId !==
              alias.canonicalConversation.id
          ) {
            return {
              kind: "key_conflict",
              aliasId: alias.id,
              reservationKind: reservation.entryKind,
              existingThreadId: reservation.canonicalThreadId
            };
          }

          const existingAlias = await loadAliasByRegistryId(transaction, {
            tenantId,
            registryId: reservation.id
          });
          if (existingAlias === null) {
            throw invariantError(
              "Alias registry reservation is missing its immutable alias row."
            );
          }
          assertAliasReservationCoherence(reservation, existingAlias);
          if (!sameAlias(existingAlias, alias)) {
            return {
              kind: "key_conflict",
              aliasId: alias.id,
              reservationKind: "alias",
              existingThreadId: reservation.canonicalThreadId
            };
          }
          existingByKey.set(alias.id, existingAlias);
        }

        for (const alias of normalized.aliases) {
          const existing = existingByAliasId.get(alias.id);
          if (existing !== undefined && !sameAlias(existing, alias)) {
            return { kind: "alias_id_conflict", aliasId: alias.id };
          }
          if (
            existing !== undefined &&
            existingByKey.get(alias.id) === undefined
          ) {
            throw invariantError(
              "ExternalThreadAlias exists without its exact registry reservation."
            );
          }
        }

        await acquireAdvisoryLock(
          transaction,
          "thread",
          tenantId,
          canonicalReservation.canonicalThreadId
        );
        const canonicalMapping = await requireMappingByReservation(
          transaction,
          canonicalReservation
        );
        if (
          !sameThread(
            canonicalMapping.thread,
            normalized.canonicalThreadSnapshot
          )
        ) {
          return { kind: "canonical_conflict" };
        }

        let insertedCount = 0;
        for (const alias of normalized.aliases) {
          if (existingByKey.has(alias.id)) {
            continue;
          }

          const digest = computeInboxV2ExternalThreadKeyDigest(alias.aliasKey);
          const registryId = externalThreadKeyRegistryId(digest);
          const insertedRegistry = await transaction.execute<IdRow>(
            buildInsertInboxV2ExternalThreadKeyRegistrySql({
              tenantId,
              registryId,
              entryKind: "alias",
              key: alias.aliasKey,
              canonicalThreadId: alias.canonicalThread.id,
              canonicalConversationId: alias.canonicalConversation.id,
              createdAt: alias.createdAt
            })
          );
          requireSingleInsertedRow(
            insertedRegistry,
            "Alias key reservation lost an uncoordinated canonical/alias race."
          );
          const insertedAlias = await transaction.execute<IdRow>(
            buildInsertInboxV2ExternalThreadAliasSql(
              alias,
              registryId,
              canonicalReservation.id
            )
          );
          requireSingleInsertedRow(
            insertedAlias,
            "ExternalThreadAlias insert lost an uncoordinated ID race."
          );
          insertedCount += 1;
        }

        const aliases: InboxV2ExternalThreadAlias[] = [];
        for (const requested of normalized.aliases) {
          const persisted = await loadAliasById(transaction, {
            tenantId,
            aliasId: requested.id,
            lock: false
          });
          if (persisted === null || !sameAlias(persisted, requested)) {
            throw invariantError(
              "Alias commit did not produce its exact bounded alias set."
            );
          }
          aliases.push(persisted);
        }

        return {
          kind: insertedCount === 0 ? "already_exists" : "committed",
          aliases
        };
      });
    },

    async findByExactKey(input) {
      assertStrictObject(input, FIND_BY_KEY_INPUT_KEYS, "findByExactKey input");
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const key = inboxV2ExternalThreadKeySchema.parse(input.key);
      if (
        key.scope.kind !== "provider" &&
        key.scope.owner.tenantId !== tenantId
      ) {
        throw new CoreError("tenant.boundary_violation");
      }
      return transactionExecutor.transaction((transaction) =>
        findInboxV2ExternalThreadByExactKeyInTransaction(transaction, {
          tenantId,
          key
        })
      );
    },

    async findById(input) {
      assertStrictObject(input, FIND_BY_ID_INPUT_KEYS, "findById input");
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const threadId = inboxV2ExternalThreadIdSchema.parse(input.threadId);
      return loadMappingById(transactionExecutor, {
        tenantId,
        threadId,
        lock: false
      });
    }
  };
}

export async function findInboxV2ExternalThreadByExactKeyInTransaction(
  transaction: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId | string;
    key: InboxV2ExternalThreadKey;
  }
): Promise<FindInboxV2ExternalThreadByExactKeyResult> {
  const reserved = await reserveInboxV2ExternalThreadExactKeyInTransaction(
    transaction,
    input
  );
  if (reserved.kind !== "reserved") return reserved;
  const reservation = reserved.reservation;
  const tenantId = reservation.tenantId;

  const mapping = await requireMappingByReservation(transaction, reservation);
  const matchedAlias =
    reservation.entryKind === "alias"
      ? await loadAliasByRegistryId(transaction, {
          tenantId,
          registryId: reservation.id
        })
      : null;
  if (reservation.entryKind === "alias" && matchedAlias === null) {
    throw invariantError(
      "Alias key resolution found no immutable alias record."
    );
  }

  return {
    kind: "found",
    reservationKind: reservation.entryKind,
    mapping,
    matchedAlias
  };
}

/**
 * Reserves an exact key without locking its ExternalThread, Conversation or
 * ConversationHead. Composite materializers use the immutable target IDs to
 * acquire BindingHead and account-identity locks first, preserving the global
 * BindingHead -> SourceAccountIdentity -> ExternalThread lock order.
 */
export async function reserveInboxV2ExternalThreadExactKeyInTransaction(
  transaction: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId | string;
    key: InboxV2ExternalThreadKey;
  }
): Promise<ReserveInboxV2ExternalThreadExactKeyResult> {
  assertStrictObject(input, FIND_BY_KEY_INPUT_KEYS, "findByExactKey input");
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const key = inboxV2ExternalThreadKeySchema.parse(input.key);
  if (key.scope.kind !== "provider" && key.scope.owner.tenantId !== tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
  const keyDigest = computeInboxV2ExternalThreadKeyDigest(key);

  await acquireAdvisoryLock(transaction, "key", tenantId, keyDigest);
  const reservation = await loadKeyReservation(transaction, {
    tenantId,
    keyDigest,
    // The key advisory lock serializes every canonical/alias registry writer.
    // Registry rows are immutable routing reservations, so a row lock here
    // would add no safety and would precede the canonical binding lock order.
    lock: false
  });
  if (reservation === null) return { kind: "not_found" };
  if (!sameExternalThreadKey(reservation.key, key)) {
    return { kind: "digest_collision" };
  }
  return { kind: "reserved", reservation };
}

/**
 * Transaction-local exact mapping resolver. The caller owns the surrounding
 * transaction and any retry policy so thread, Conversation and later binding
 * materialization can share one all-or-nothing boundary.
 */
export async function resolveOrCreateInboxV2ExternalThreadExactMappingInTransaction(
  transaction: RawSqlExecutor,
  input: ResolveOrCreateInboxV2ExternalThreadInput
): Promise<ResolveOrCreateInboxV2ExternalThreadResult> {
  const normalized = normalizeResolveInput(input);
  const { mapping } = normalized;
  const tenantId = mapping.tenantId;
  const keyDigest = computeInboxV2ExternalThreadKeyDigest(mapping.thread.key);

  // The registry has an immediate FK to Conversation, so an advisory
  // tenant+digest reservation is the first race boundary. The durable
  // registry row is inserted after the candidate Conversation exists.
  await acquireAdvisoryLock(transaction, "key", tenantId, keyDigest);

  const reservation = await loadKeyReservation(transaction, {
    tenantId,
    keyDigest,
    lock: true
  });
  if (reservation !== null) {
    if (!sameExternalThreadKey(reservation.key, mapping.thread.key)) {
      return { kind: "digest_collision" };
    }

    const existingMapping = await requireMappingByReservation(
      transaction,
      reservation
    );
    if (reservation.entryKind === "alias") {
      return { kind: "key_reserved_as_alias", existingMapping };
    }

    return sameMapping(existingMapping, mapping)
      ? { kind: "already_exists", mapping: existingMapping }
      : { kind: "exact_key_conflict", existingMapping };
  }

  await acquireAdvisoryLock(transaction, "thread", tenantId, mapping.thread.id);
  const existingByThreadId = await loadMappingById(transaction, {
    tenantId,
    threadId: mapping.thread.id,
    lock: true
  });
  if (existingByThreadId !== null) {
    return {
      kind: "thread_id_conflict",
      existingMapping: existingByThreadId
    };
  }

  await acquireAdvisoryLock(
    transaction,
    "conversation",
    tenantId,
    mapping.conversation.id
  );
  const conversationLock = await lockConversation(transaction, {
    tenantId,
    conversationId: mapping.conversation.id
  });
  const conversationOwner = await findThreadByConversation(transaction, {
    tenantId,
    conversationId: mapping.conversation.id
  });
  if (conversationOwner !== null) {
    return {
      kind: "conversation_conflict",
      existingThreadId: conversationOwner,
      conversationId: mapping.conversation.id
    };
  }

  if (conversationLock === null) {
    const insertedConversation = await transaction.execute<IdRow>(
      buildInsertInboxV2ExternalThreadConversationSql(normalized)
    );
    requireSingleInsertedRow(
      insertedConversation,
      "Candidate Conversation insert lost an uncoordinated unique race."
    );
    const insertedHead = await transaction.execute<IdRow>(
      buildInsertInboxV2ExternalThreadConversationHeadSql(normalized)
    );
    requireSingleInsertedRow(
      insertedHead,
      "Candidate ConversationHead insert did not produce exactly one row."
    );
    const insertedMembershipHead = await transaction.execute<IdRow>(
      buildInsertInboxV2ConversationMembershipHeadSql({
        tenantId,
        conversationId: mapping.conversation.id,
        createdAt: mapping.conversation.createdAt
      })
    );
    requireSingleInsertedRow(
      insertedMembershipHead,
      "Candidate Conversation membership head insert did not produce exactly one row."
    );
  } else {
    const existingConversation = await loadConversationById(transaction, {
      tenantId,
      conversationId: mapping.conversation.id
    });
    if (existingConversation === null) {
      throw invariantError(
        "Locked Conversation is missing its mandatory ConversationHead."
      );
    }
    // Creation owns the Conversation + Head atomically. A pre-existing,
    // currently unowned Conversation is therefore not an idempotent
    // continuation: accepting it would let a caller attach an arbitrary
    // aggregate by choosing its ID.
    return {
      kind: "conversation_identity_conflict",
      existingConversation
    };
  }

  const registryId = externalThreadKeyRegistryId(keyDigest);
  const insertedRegistry = await transaction.execute<IdRow>(
    buildInsertInboxV2ExternalThreadKeyRegistrySql({
      tenantId,
      registryId,
      entryKind: "canonical",
      key: mapping.thread.key,
      canonicalThreadId: mapping.thread.id,
      canonicalConversationId: mapping.conversation.id,
      createdAt: mapping.thread.createdAt
    })
  );
  requireSingleInsertedRow(
    insertedRegistry,
    "Canonical key reservation lost an uncoordinated unique race."
  );

  const insertedThread = await transaction.execute<IdRow>(
    buildInsertInboxV2ExternalThreadSql(mapping, registryId)
  );
  requireSingleInsertedRow(
    insertedThread,
    "ExternalThread insert lost an uncoordinated ID/Conversation race."
  );

  const created = await loadMappingById(transaction, {
    tenantId,
    threadId: mapping.thread.id,
    lock: false
  });
  if (created === null) {
    throw invariantError(
      "ExternalThread create did not produce a complete mapping."
    );
  }

  return { kind: "created", mapping: created };
}

export function computeInboxV2ExternalThreadKeyDigest(
  keyInput: InboxV2ExternalThreadKey
): string {
  const key = inboxV2ExternalThreadKeySchema.parse(keyInput);
  const connectionId =
    key.scope.kind === "source_connection" ? key.scope.owner.id : null;
  const accountId =
    key.scope.kind === "source_account" ? key.scope.owner.id : null;
  const scopeKind =
    key.scope.kind === "provider"
      ? "8:provider"
      : key.scope.kind === "source_connection"
        ? "17:source_connection"
        : "14:source_account";
  const serialized =
    "external-thread-key:v1|" +
    lengthPrefixed(key.realm.realmId) +
    lengthPrefixed(key.realm.realmVersion) +
    lengthPrefixed(key.realm.canonicalizationVersion) +
    scopeKind +
    lengthPrefixedNullable(connectionId) +
    lengthPrefixedNullable(accountId) +
    lengthPrefixed(key.objectKindId) +
    lengthPrefixed(key.canonicalExternalSubject);

  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

export function buildAcquireInboxV2ExternalThreadAdvisoryLockSql(input: {
  namespace: "key" | "thread" | "conversation" | "alias";
  tenantId: InboxV2TenantId;
  value: string;
}): SQL {
  return sql`
    select pg_advisory_xact_lock(
      hashtextextended(
        ${`inbox-v2:external-thread:${input.namespace}:${input.tenantId}:${input.value}`},
        0
      )
    ) as locked
  `;
}

export function buildFindInboxV2ExternalThreadKeyRegistrySql(input: {
  tenantId: InboxV2TenantId;
  keyDigest: string;
  lock?: boolean;
}): SQL {
  const lockClause = input.lock ? sql`for update` : sql``;
  return sql`
    select
      r.tenant_id as registry_tenant_id,
      r.id as registry_id,
      r.entry_kind,
      r.realm_id,
      r.realm_version,
      r.canonicalization_version,
      r.scope_kind,
      r.scope_source_connection_id,
      r.scope_source_account_id,
      r.scope_owner_key,
      r.object_kind_id,
      r.canonical_external_subject,
      r.key_digest,
      r.canonical_thread_id,
      r.canonical_conversation_id,
      r.revision as registry_revision,
      r.created_at as registry_created_at,
      r.updated_at as registry_updated_at
    from inbox_v2_external_thread_key_registry r
    where r.tenant_id = ${input.tenantId}
      and r.key_digest = ${input.keyDigest}
    ${lockClause}
  `;
}

export function buildInsertInboxV2ExternalThreadKeyRegistrySql(input: {
  tenantId: InboxV2TenantId;
  registryId: string;
  entryKind: "canonical" | "alias";
  key: InboxV2ExternalThreadKey;
  canonicalThreadId: InboxV2ExternalThreadId;
  canonicalConversationId: InboxV2ConversationId;
  createdAt: string;
}): SQL {
  const scope = toScopeColumns(input.key);
  return sql`
    insert into inbox_v2_external_thread_key_registry (
      tenant_id,
      id,
      entry_kind,
      realm_id,
      realm_version,
      canonicalization_version,
      scope_kind,
      scope_source_connection_id,
      scope_source_account_id,
      scope_owner_key,
      object_kind_id,
      canonical_external_subject,
      canonical_thread_id,
      canonical_conversation_id,
      revision,
      created_at,
      updated_at
    ) values (
      ${input.tenantId},
      ${input.registryId},
      ${input.entryKind},
      ${input.key.realm.realmId},
      ${input.key.realm.realmVersion},
      ${input.key.realm.canonicalizationVersion},
      ${input.key.scope.kind},
      ${scope.sourceConnectionId},
      ${scope.sourceAccountId},
      ${scope.ownerKey},
      ${input.key.objectKindId},
      ${input.key.canonicalExternalSubject},
      ${input.canonicalThreadId},
      ${input.canonicalConversationId},
      1,
      ${input.createdAt},
      ${input.createdAt}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildInsertInboxV2ExternalThreadConversationSql(
  input: ResolveOrCreateInboxV2ExternalThreadInput
): SQL {
  const conversation = input.mapping.conversation;
  return sql`
    insert into inbox_v2_conversations (
      tenant_id,
      id,
      topology,
      transport,
      purpose_id,
      lifecycle,
      revision,
      last_changed_stream_position,
      created_at,
      updated_at
    ) values (
      ${conversation.tenantId},
      ${conversation.id},
      ${conversation.topology},
      ${conversation.transport},
      ${conversation.purposeId},
      ${conversation.lifecycle},
      ${conversation.revision},
      ${input.streamPosition},
      ${conversation.createdAt},
      ${conversation.updatedAt}
    )
    on conflict (tenant_id, id) do nothing
    returning id
  `;
}

export function buildInsertInboxV2ExternalThreadConversationHeadSql(
  input: ResolveOrCreateInboxV2ExternalThreadInput
): SQL {
  const conversation = input.mapping.conversation;
  const head = conversation.head;
  return sql`
    insert into inbox_v2_conversation_heads (
      tenant_id,
      conversation_id,
      latest_timeline_sequence,
      latest_activity_item_id,
      latest_activity_timeline_sequence,
      latest_activity_at,
      revision,
      last_changed_stream_position,
      created_at,
      updated_at
    ) values (
      ${conversation.tenantId},
      ${conversation.id},
      ${head.latestTimelineSequence},
      ${head.latestActivityItemId},
      ${head.latestActivityTimelineSequence},
      ${head.latestActivityAt},
      ${head.revision},
      ${input.streamPosition},
      ${head.createdAt},
      ${head.updatedAt}
    )
    returning conversation_id as id
  `;
}

export function buildInsertInboxV2ExternalThreadSql(
  mapping: InboxV2ExternalThreadMapping,
  registryId: string
): SQL {
  const thread = mapping.thread;
  const scope = toScopeColumns(thread.key);
  return sql`
    insert into inbox_v2_external_threads (
      tenant_id,
      id,
      key_registry_id,
      key_registry_entry_kind,
      realm_id,
      realm_version,
      canonicalization_version,
      scope_kind,
      scope_source_connection_id,
      scope_source_account_id,
      scope_owner_key,
      object_kind_id,
      canonical_external_subject,
      identity_declaration,
      conversation_id,
      conversation_transport,
      conversation_topology,
      revision,
      created_at,
      updated_at
    ) values (
      ${thread.tenantId},
      ${thread.id},
      ${registryId},
      'canonical',
      ${thread.key.realm.realmId},
      ${thread.key.realm.realmVersion},
      ${thread.key.realm.canonicalizationVersion},
      ${thread.key.scope.kind},
      ${scope.sourceConnectionId},
      ${scope.sourceAccountId},
      ${scope.ownerKey},
      ${thread.key.objectKindId},
      ${thread.key.canonicalExternalSubject},
      ${thread.identityDeclaration},
      ${thread.conversation.id},
      'external',
      ${thread.conversationTopology},
      ${thread.revision},
      ${thread.createdAt},
      ${thread.updatedAt}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildInsertInboxV2ExternalThreadAliasSql(
  alias: InboxV2ExternalThreadAlias,
  aliasRegistryId: string,
  canonicalRegistryId: string
): SQL {
  const aliasScope = toScopeColumns(alias.aliasKey);
  const canonicalScope = toScopeColumns(alias.canonicalKeySnapshot);
  return sql`
    insert into inbox_v2_external_thread_aliases (
      tenant_id,
      id,
      alias_key_registry_id,
      alias_key_registry_entry_kind,
      alias_realm_id,
      alias_realm_version,
      alias_canonicalization_version,
      alias_scope_kind,
      alias_scope_source_connection_id,
      alias_scope_source_account_id,
      alias_scope_owner_key,
      alias_object_kind_id,
      alias_canonical_external_subject,
      alias_identity_declaration,
      canonical_thread_id,
      canonical_conversation_id,
      canonical_key_registry_id,
      canonical_key_registry_entry_kind,
      canonical_realm_id,
      canonical_realm_version,
      canonical_canonicalization_version,
      canonical_scope_kind,
      canonical_scope_source_connection_id,
      canonical_scope_source_account_id,
      canonical_scope_owner_key,
      canonical_object_kind_id,
      canonical_external_subject,
      expected_canonical_thread_revision,
      decision_trusted_service_id,
      decision_policy_id,
      decision_policy_version,
      decision_reason_code_id,
      decision_authoritative_evidence_token,
      decision_decided_at,
      revision,
      created_at
    ) values (
      ${alias.tenantId},
      ${alias.id},
      ${aliasRegistryId},
      'alias',
      ${alias.aliasKey.realm.realmId},
      ${alias.aliasKey.realm.realmVersion},
      ${alias.aliasKey.realm.canonicalizationVersion},
      ${alias.aliasKey.scope.kind},
      ${aliasScope.sourceConnectionId},
      ${aliasScope.sourceAccountId},
      ${aliasScope.ownerKey},
      ${alias.aliasKey.objectKindId},
      ${alias.aliasKey.canonicalExternalSubject},
      ${alias.aliasIdentityDeclaration},
      ${alias.canonicalThread.id},
      ${alias.canonicalConversation.id},
      ${canonicalRegistryId},
      'canonical',
      ${alias.canonicalKeySnapshot.realm.realmId},
      ${alias.canonicalKeySnapshot.realm.realmVersion},
      ${alias.canonicalKeySnapshot.realm.canonicalizationVersion},
      ${alias.canonicalKeySnapshot.scope.kind},
      ${canonicalScope.sourceConnectionId},
      ${canonicalScope.sourceAccountId},
      ${canonicalScope.ownerKey},
      ${alias.canonicalKeySnapshot.objectKindId},
      ${alias.canonicalKeySnapshot.canonicalExternalSubject},
      ${alias.expectedCanonicalThreadRevision},
      ${alias.decision.actor.trustedServiceId},
      ${alias.decision.policyId},
      ${alias.decision.policyVersion},
      ${alias.decision.reasonCodeId},
      ${alias.decision.authoritativeEvidenceToken},
      ${alias.decision.decidedAt},
      ${alias.revision},
      ${alias.createdAt}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildFindInboxV2ExternalThreadMappingByIdSql(input: {
  tenantId: InboxV2TenantId;
  threadId: InboxV2ExternalThreadId;
}): SQL {
  return sql`
    select
      r.tenant_id as registry_tenant_id,
      r.id as registry_id,
      r.entry_kind,
      r.realm_id,
      r.realm_version,
      r.canonicalization_version,
      r.scope_kind,
      r.scope_source_connection_id,
      r.scope_source_account_id,
      r.scope_owner_key,
      r.object_kind_id,
      r.canonical_external_subject,
      r.key_digest,
      r.canonical_thread_id,
      r.canonical_conversation_id,
      r.revision as registry_revision,
      r.created_at as registry_created_at,
      r.updated_at as registry_updated_at,
      t.tenant_id as thread_tenant_id,
      t.id as thread_id,
      t.key_registry_id as thread_key_registry_id,
      t.realm_id as thread_realm_id,
      t.realm_version as thread_realm_version,
      t.canonicalization_version as thread_canonicalization_version,
      t.scope_kind as thread_scope_kind,
      t.scope_source_connection_id as thread_scope_source_connection_id,
      t.scope_source_account_id as thread_scope_source_account_id,
      t.scope_owner_key as thread_scope_owner_key,
      t.object_kind_id as thread_object_kind_id,
      t.canonical_external_subject as thread_canonical_external_subject,
      t.key_digest as thread_key_digest,
      t.identity_declaration,
      t.conversation_id as thread_conversation_id,
      t.conversation_topology as conversation_topology_snapshot,
      t.revision as thread_revision,
      t.created_at as thread_created_at,
      t.updated_at as thread_updated_at,
      c.tenant_id as conversation_tenant_id,
      c.id as conversation_id,
      c.topology as conversation_topology,
      c.transport as conversation_transport,
      c.purpose_id,
      c.lifecycle,
      c.revision as conversation_revision,
      c.created_at as conversation_created_at,
      c.updated_at as conversation_updated_at,
      h.conversation_id as head_conversation_id,
      h.latest_timeline_sequence,
      h.latest_activity_item_id,
      h.latest_activity_timeline_sequence,
      h.latest_activity_at,
      h.revision as head_revision,
      h.created_at as head_created_at,
      h.updated_at as head_updated_at
    from inbox_v2_external_threads t
    left join inbox_v2_external_thread_key_registry r
      on r.tenant_id = t.tenant_id
     and r.id = t.key_registry_id
    left join inbox_v2_conversations c
      on c.tenant_id = t.tenant_id
     and c.id = t.conversation_id
    left join inbox_v2_conversation_heads h
      on h.tenant_id = c.tenant_id
     and h.conversation_id = c.id
    where t.tenant_id = ${input.tenantId}
      and t.id = ${input.threadId}
  `;
}

export function buildFindInboxV2ExternalThreadAliasByIdSql(
  input: {
    tenantId: InboxV2TenantId;
    lock?: boolean;
  } & (
    | {
        aliasId: InboxV2ExternalThreadAliasId;
        registryId?: never;
      }
    | {
        aliasId?: never;
        registryId: string;
      }
  )
): SQL {
  if (
    (input.aliasId === undefined) === (input.registryId === undefined) ||
    (input.registryId !== undefined &&
      !/^external_thread_key:[a-f0-9]{64}$/u.test(input.registryId))
  ) {
    throw new CoreError(
      "validation.failed",
      "ExternalThreadAlias lookup requires exactly one valid alias or registry ID."
    );
  }
  const predicate =
    input.aliasId === undefined
      ? sql`a.alias_key_registry_id = ${input.registryId}`
      : sql`a.id = ${input.aliasId}`;
  const lockClause = input.lock ? sql`for update` : sql``;
  return sql`
    select
      a.tenant_id as alias_tenant_id,
      a.id as alias_id,
      a.alias_key_registry_id,
      a.alias_realm_id,
      a.alias_realm_version,
      a.alias_canonicalization_version,
      a.alias_scope_kind,
      a.alias_scope_source_connection_id,
      a.alias_scope_source_account_id,
      a.alias_scope_owner_key,
      a.alias_object_kind_id,
      a.alias_canonical_external_subject,
      a.alias_key_digest,
      a.alias_identity_declaration,
      a.canonical_thread_id,
      a.canonical_conversation_id,
      a.canonical_key_registry_id,
      a.canonical_realm_id,
      a.canonical_realm_version,
      a.canonical_canonicalization_version,
      a.canonical_scope_kind,
      a.canonical_scope_source_connection_id,
      a.canonical_scope_source_account_id,
      a.canonical_scope_owner_key,
      a.canonical_object_kind_id,
      a.canonical_external_subject,
      a.canonical_key_digest,
      a.expected_canonical_thread_revision,
      a.decision_trusted_service_id,
      a.decision_policy_id,
      a.decision_policy_version,
      a.decision_reason_code_id,
      a.decision_authoritative_evidence_token,
      a.decision_decided_at,
      a.revision as alias_revision,
      a.created_at as alias_created_at
    from inbox_v2_external_thread_aliases a
    where a.tenant_id = ${input.tenantId}
      and ${predicate}
    ${lockClause}
  `;
}

function buildLockExternalThreadSql(input: {
  tenantId: InboxV2TenantId;
  threadId: InboxV2ExternalThreadId;
}): SQL {
  return sql`
    select t.id, t.conversation_id
    from inbox_v2_external_threads t
    where t.tenant_id = ${input.tenantId}
      and t.id = ${input.threadId}
    for update
  `;
}

function buildLockConversationSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select c.id
    from inbox_v2_conversations c
    where c.tenant_id = ${input.tenantId}
      and c.id = ${input.conversationId}
    for update
  `;
}

function buildLockConversationHeadSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select h.conversation_id as id
    from inbox_v2_conversation_heads h
    where h.tenant_id = ${input.tenantId}
      and h.conversation_id = ${input.conversationId}
    for update
  `;
}

function buildFindThreadByConversationSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select t.id
    from inbox_v2_external_threads t
    where t.tenant_id = ${input.tenantId}
      and t.conversation_id = ${input.conversationId}
  `;
}

function buildFindConversationByIdSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select
      c.tenant_id as conversation_tenant_id,
      c.id as conversation_id,
      c.topology as conversation_topology,
      c.transport as conversation_transport,
      c.purpose_id,
      c.lifecycle,
      c.revision as conversation_revision,
      c.created_at as conversation_created_at,
      c.updated_at as conversation_updated_at,
      h.conversation_id as head_conversation_id,
      h.latest_timeline_sequence,
      h.latest_activity_item_id,
      h.latest_activity_timeline_sequence,
      h.latest_activity_at,
      h.revision as head_revision,
      h.created_at as head_created_at,
      h.updated_at as head_updated_at
    from inbox_v2_conversations c
    left join inbox_v2_conversation_heads h
      on h.tenant_id = c.tenant_id
     and h.conversation_id = c.id
    where c.tenant_id = ${input.tenantId}
      and c.id = ${input.conversationId}
  `;
}

async function acquireAdvisoryLock(
  executor: RawSqlExecutor,
  namespace: "key" | "thread" | "conversation" | "alias",
  tenantId: InboxV2TenantId,
  value: string
): Promise<void> {
  await executor.execute(
    buildAcquireInboxV2ExternalThreadAdvisoryLockSql({
      namespace,
      tenantId,
      value
    })
  );
}

async function loadKeyReservation(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    keyDigest: string;
    lock: boolean;
  }
): Promise<KeyReservation | null> {
  const result = await executor.execute<KeyRegistryRow>(
    buildFindInboxV2ExternalThreadKeyRegistrySql(input)
  );
  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length !== 1) {
    throw invariantError(
      "Tenant-scoped ExternalThread key digest resolved to multiple reservations."
    );
  }
  return mapKeyReservation(result.rows[0], input.tenantId);
}

async function requireMappingByReservation(
  executor: RawSqlExecutor,
  reservation: KeyReservation
): Promise<InboxV2ExternalThreadMapping> {
  await acquireAdvisoryLock(
    executor,
    "thread",
    reservation.tenantId,
    reservation.canonicalThreadId
  );
  const mapping = await loadMappingById(executor, {
    tenantId: reservation.tenantId,
    threadId: reservation.canonicalThreadId,
    lock: true
  });
  if (
    mapping === null ||
    mapping.conversation.id !== reservation.canonicalConversationId
  ) {
    throw invariantError(
      "Key registry reservation does not resolve to one complete canonical mapping."
    );
  }
  if (reservation.entryKind === "canonical") {
    if (!sameExternalThreadKey(reservation.key, mapping.thread.key)) {
      throw invariantError(
        "Canonical key registry raw key differs from its ExternalThread key."
      );
    }
  } else {
    const alias = await loadAliasByRegistryId(executor, {
      tenantId: reservation.tenantId,
      registryId: reservation.id
    });
    if (alias === null) {
      throw invariantError(
        "Alias key registry reservation has no immutable alias row."
      );
    }
    assertAliasReservationCoherence(reservation, alias, mapping);
  }
  return mapping;
}

function assertAliasReservationCoherence(
  reservation: KeyReservation,
  alias: InboxV2ExternalThreadAlias,
  mapping?: InboxV2ExternalThreadMapping
): void {
  if (
    reservation.entryKind !== "alias" ||
    alias.tenantId !== reservation.tenantId ||
    !sameExternalThreadKey(alias.aliasKey, reservation.key) ||
    alias.canonicalThread.id !== reservation.canonicalThreadId ||
    alias.canonicalConversation.id !== reservation.canonicalConversationId ||
    (mapping !== undefined &&
      (!sameExternalThreadKey(alias.canonicalKeySnapshot, mapping.thread.key) ||
        alias.expectedCanonicalThreadRevision !== mapping.thread.revision))
  ) {
    throw invariantError(
      "Alias registry, alias row and canonical mapping snapshots disagree."
    );
  }
}

async function loadMappingById(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    threadId: InboxV2ExternalThreadId;
    lock: boolean;
  }
): Promise<InboxV2ExternalThreadMapping | null> {
  if (input.lock) {
    const threadLock = await executor.execute<ThreadTargetRow>(
      buildLockExternalThreadSql(input)
    );
    if (threadLock.rows.length === 0) {
      return null;
    }
    if (threadLock.rows.length !== 1) {
      throw invariantError(
        "Tenant-scoped ExternalThread lock returned multiple rows."
      );
    }
    const conversationId = inboxV2ConversationIdSchema.safeParse(
      threadLock.rows[0]?.conversation_id
    );
    if (!conversationId.success) {
      throw invariantError(
        "Locked ExternalThread contains an invalid Conversation ID."
      );
    }
    const conversationLock = await lockConversation(executor, {
      tenantId: input.tenantId,
      conversationId: conversationId.data
    });
    if (conversationLock === null) {
      throw invariantError(
        "ExternalThread exists without its canonical Conversation."
      );
    }
    const headLock = await executor.execute<IdRow>(
      buildLockConversationHeadSql({
        tenantId: input.tenantId,
        conversationId: conversationId.data
      })
    );
    if (headLock.rows.length !== 1) {
      throw invariantError(
        "ExternalThread Conversation is missing its mandatory head."
      );
    }
  }

  const result = await executor.execute<MappingRow>(
    buildFindInboxV2ExternalThreadMappingByIdSql(input)
  );
  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length !== 1) {
    throw invariantError(
      "Tenant-scoped ExternalThread ID resolved to multiple mappings."
    );
  }
  return mapMappingRow(result.rows[0], input.tenantId);
}

async function lockConversation(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
  }
): Promise<InboxV2ConversationId | null> {
  const result = await executor.execute<IdRow>(buildLockConversationSql(input));
  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length !== 1) {
    throw invariantError(
      "Tenant-scoped Conversation lock returned multiple rows."
    );
  }
  const parsed = inboxV2ConversationIdSchema.safeParse(result.rows[0]?.id);
  if (!parsed.success) {
    throw invariantError("Conversation lock returned an invalid ID.");
  }
  return parsed.data;
}

async function findThreadByConversation(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
  }
): Promise<InboxV2ExternalThreadId | null> {
  const result = await executor.execute<IdRow>(
    buildFindThreadByConversationSql(input)
  );
  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length !== 1) {
    throw invariantError("Conversation is mapped by multiple ExternalThreads.");
  }
  const parsed = inboxV2ExternalThreadIdSchema.safeParse(result.rows[0]?.id);
  if (!parsed.success) {
    throw invariantError("Conversation mapping returned an invalid thread ID.");
  }
  return parsed.data;
}

async function loadConversationById(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
  }
): Promise<InboxV2Conversation | null> {
  const result = await executor.execute<ConversationRow>(
    buildFindConversationByIdSql(input)
  );
  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length !== 1) {
    throw invariantError("Conversation lookup returned multiple aggregates.");
  }
  return mapConversationRow(result.rows[0], input.tenantId);
}

async function loadAliasById(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    aliasId: InboxV2ExternalThreadAliasId;
    lock: boolean;
  }
): Promise<InboxV2ExternalThreadAlias | null> {
  const result = await executor.execute<AliasRow>(
    buildFindInboxV2ExternalThreadAliasByIdSql(input)
  );
  return mapSingleAliasResult(result, input.tenantId);
}

async function loadAliasByRegistryId(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId; registryId: string }
): Promise<InboxV2ExternalThreadAlias | null> {
  const result = await executor.execute<AliasRow>(
    buildFindInboxV2ExternalThreadAliasByIdSql(input)
  );
  return mapSingleAliasResult(result, input.tenantId);
}

function mapSingleAliasResult(
  result: RawSqlQueryResult<AliasRow>,
  tenantId: InboxV2TenantId
): InboxV2ExternalThreadAlias | null {
  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length !== 1) {
    throw invariantError("ExternalThreadAlias lookup returned multiple rows.");
  }
  return mapAliasRow(result.rows[0], tenantId);
}

function mapKeyReservation(
  row: KeyRegistryRow,
  expectedTenantId: InboxV2TenantId
): KeyReservation {
  const tenantId = parseTenant(row.registry_tenant_id, expectedTenantId);
  if (
    typeof row.registry_id !== "string" ||
    !/^external_thread_key:[a-f0-9]{64}$/u.test(row.registry_id)
  ) {
    throw invariantError("ExternalThread key registry contains an invalid ID.");
  }
  if (row.entry_kind !== "canonical" && row.entry_kind !== "alias") {
    throw invariantError(
      "ExternalThread key registry has an invalid entry kind."
    );
  }
  const key = mapExternalThreadKey(row, "", tenantId);
  const digest = parseDigest(row.key_digest, "key registry digest");
  const expectedId = externalThreadKeyRegistryId(digest);
  if (row.registry_id !== expectedId) {
    throw invariantError(
      "ExternalThread key registry ID/digest parity failed."
    );
  }
  const revision = parseDatabaseBigint(
    row.registry_revision,
    "registry revision"
  );
  const createdAt = parseDatabaseTimestamp(
    row.registry_created_at,
    "registry createdAt"
  );
  const updatedAt = parseDatabaseTimestamp(
    row.registry_updated_at,
    "registry updatedAt"
  );
  if (revision !== "1" || createdAt !== updatedAt) {
    throw invariantError(
      "ExternalThread key registry is not immutable revision 1."
    );
  }

  return {
    tenantId,
    id: row.registry_id,
    entryKind: row.entry_kind,
    key,
    keyDigest: digest,
    canonicalThreadId: inboxV2ExternalThreadIdSchema.parse(
      row.canonical_thread_id
    ),
    canonicalConversationId: inboxV2ConversationIdSchema.parse(
      row.canonical_conversation_id
    )
  };
}

function mapMappingRow(
  row: MappingRow,
  expectedTenantId: InboxV2TenantId
): InboxV2ExternalThreadMapping {
  const tenantId = parseTenant(row.thread_tenant_id, expectedTenantId);
  const registry = mapKeyReservation(row, expectedTenantId);
  if (
    registry.entryKind !== "canonical" ||
    registry.id !== row.thread_key_registry_id ||
    registry.canonicalThreadId !== row.thread_id ||
    registry.canonicalConversationId !== row.thread_conversation_id
  ) {
    throw invariantError(
      "ExternalThread does not match its canonical key registry reservation."
    );
  }

  const threadKey = mapExternalThreadKey(row, "thread_", tenantId);
  if (!sameExternalThreadKey(registry.key, threadKey)) {
    throw invariantError(
      "ExternalThread raw key differs from its registry key."
    );
  }
  const registryDigest = parseDigest(registry.keyDigest, "registry digest");
  const threadDigest = parseDigest(row.thread_key_digest, "thread key digest");
  if (
    registryDigest !== threadDigest ||
    computeInboxV2ExternalThreadKeyDigest(threadKey) !== threadDigest
  ) {
    throw invariantError("ExternalThread key digest/raw key parity failed.");
  }

  const conversation = mapConversationRow(row, expectedTenantId);
  try {
    return inboxV2ExternalThreadMappingSchema.parse({
      tenantId,
      thread: {
        tenantId,
        id: row.thread_id,
        key: threadKey,
        identityDeclaration: row.identity_declaration,
        conversation: {
          tenantId,
          kind: "conversation",
          id: row.thread_conversation_id
        },
        conversationTopology: row.conversation_topology_snapshot,
        revision: parseDatabaseBigint(row.thread_revision, "thread revision"),
        createdAt: parseDatabaseTimestamp(
          row.thread_created_at,
          "thread createdAt"
        ),
        updatedAt: parseDatabaseTimestamp(
          row.thread_updated_at,
          "thread updatedAt"
        )
      },
      conversation
    });
  } catch {
    throw invariantError(
      "ExternalThread persistence row does not satisfy the canonical mapping contract."
    );
  }
}

function mapConversationRow(
  row: ConversationRow,
  expectedTenantId: InboxV2TenantId
): InboxV2Conversation {
  const tenantId = parseTenant(row.conversation_tenant_id, expectedTenantId);
  if (row.head_conversation_id === null) {
    throw invariantError("Conversation is missing its mandatory head.");
  }
  try {
    return inboxV2ConversationSchema.parse({
      tenantId,
      id: row.conversation_id,
      topology: row.conversation_topology,
      transport: row.conversation_transport,
      purposeId: row.purpose_id,
      lifecycle: row.lifecycle,
      revision: parseDatabaseBigint(
        row.conversation_revision,
        "Conversation revision"
      ),
      createdAt: parseDatabaseTimestamp(
        row.conversation_created_at,
        "Conversation createdAt"
      ),
      updatedAt: parseDatabaseTimestamp(
        row.conversation_updated_at,
        "Conversation updatedAt"
      ),
      head: {
        latestTimelineSequence: parseDatabaseBigint(
          row.latest_timeline_sequence,
          "latest timeline sequence"
        ),
        latestActivityItemId: row.latest_activity_item_id,
        latestActivityTimelineSequence:
          row.latest_activity_timeline_sequence === null
            ? null
            : parseDatabaseBigint(
                row.latest_activity_timeline_sequence,
                "latest activity timeline sequence"
              ),
        latestActivityAt:
          row.latest_activity_at === null
            ? null
            : parseDatabaseTimestamp(
                row.latest_activity_at,
                "latest activity at"
              ),
        revision: parseDatabaseBigint(row.head_revision, "head revision"),
        createdAt: parseDatabaseTimestamp(
          row.head_created_at,
          "head createdAt"
        ),
        updatedAt: parseDatabaseTimestamp(row.head_updated_at, "head updatedAt")
      }
    });
  } catch (error) {
    if (error instanceof InboxV2PersistenceInvariantError) {
      throw error;
    }
    throw invariantError(
      "Conversation persistence row does not satisfy its canonical contract."
    );
  }
}

function mapAliasRow(
  row: AliasRow,
  expectedTenantId: InboxV2TenantId
): InboxV2ExternalThreadAlias {
  const tenantId = parseTenant(row.alias_tenant_id, expectedTenantId);
  const aliasKey = mapExternalThreadKey(row, "alias_", tenantId);
  const canonicalKey = mapExternalThreadKey(row, "canonical_", tenantId);
  const aliasDigest = parseDigest(row.alias_key_digest, "alias key digest");
  const canonicalDigest = parseDigest(
    row.canonical_key_digest,
    "canonical key digest"
  );
  if (
    aliasDigest !== computeInboxV2ExternalThreadKeyDigest(aliasKey) ||
    canonicalDigest !== computeInboxV2ExternalThreadKeyDigest(canonicalKey) ||
    row.alias_key_registry_id !== externalThreadKeyRegistryId(aliasDigest) ||
    row.canonical_key_registry_id !==
      externalThreadKeyRegistryId(canonicalDigest)
  ) {
    throw invariantError(
      "ExternalThreadAlias key snapshot/digest parity failed."
    );
  }

  try {
    return inboxV2ExternalThreadAliasSchema.parse({
      tenantId,
      id: row.alias_id,
      aliasKey,
      aliasIdentityDeclaration: row.alias_identity_declaration,
      canonicalThread: {
        tenantId,
        kind: "external_thread",
        id: row.canonical_thread_id
      },
      canonicalConversation: {
        tenantId,
        kind: "conversation",
        id: row.canonical_conversation_id
      },
      canonicalKeySnapshot: canonicalKey,
      expectedCanonicalThreadRevision: parseDatabaseBigint(
        row.expected_canonical_thread_revision,
        "expected canonical thread revision"
      ),
      decision: {
        actor: {
          kind: "trusted_service",
          trustedServiceId: row.decision_trusted_service_id
        },
        policyId: row.decision_policy_id,
        policyVersion: row.decision_policy_version,
        reasonCodeId: row.decision_reason_code_id,
        authoritativeEvidenceToken: row.decision_authoritative_evidence_token,
        decidedAt: parseDatabaseTimestamp(
          row.decision_decided_at,
          "alias decision decidedAt"
        )
      },
      revision: parseDatabaseBigint(row.alias_revision, "alias revision"),
      createdAt: parseDatabaseTimestamp(row.alias_created_at, "alias createdAt")
    });
  } catch (error) {
    if (error instanceof InboxV2PersistenceInvariantError) {
      throw error;
    }
    throw invariantError(
      "ExternalThreadAlias persistence row does not satisfy the canonical contract."
    );
  }
}

function mapExternalThreadKey(
  row: Record<string, unknown>,
  prefix: string,
  tenantId: InboxV2TenantId
): InboxV2ExternalThreadKey {
  const subjectColumn =
    prefix === "canonical_"
      ? "canonical_external_subject"
      : `${prefix}canonical_external_subject`;
  const scopeKind = row[`${prefix}scope_kind`];
  const connectionId = row[`${prefix}scope_source_connection_id`];
  const accountId = row[`${prefix}scope_source_account_id`];
  const ownerKey = row[`${prefix}scope_owner_key`];
  let scope: unknown;
  if (
    scopeKind === "provider" &&
    connectionId === null &&
    accountId === null &&
    ownerKey === "provider"
  ) {
    scope = { kind: "provider" };
  } else if (
    scopeKind === "source_connection" &&
    typeof connectionId === "string" &&
    accountId === null &&
    ownerKey === connectionId
  ) {
    scope = {
      kind: "source_connection",
      owner: { tenantId, kind: "source_connection", id: connectionId }
    };
  } else if (
    scopeKind === "source_account" &&
    connectionId === null &&
    typeof accountId === "string" &&
    ownerKey === accountId
  ) {
    scope = {
      kind: "source_account",
      owner: { tenantId, kind: "source_account", id: accountId }
    };
  } else {
    throw invariantError(
      "ExternalThread key has an invalid scope owner tuple."
    );
  }

  const parsed = inboxV2ExternalThreadKeySchema.safeParse({
    realm: {
      realmId: row[`${prefix}realm_id`],
      realmVersion: row[`${prefix}realm_version`],
      canonicalizationVersion: row[`${prefix}canonicalization_version`]
    },
    scope,
    objectKindId: row[`${prefix}object_kind_id`],
    canonicalExternalSubject: row[subjectColumn]
  });
  if (!parsed.success) {
    const paths = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    const subjectValue = row[subjectColumn];
    const subjectShape =
      typeof subjectValue === "string"
        ? `string:${subjectValue.length}`
        : typeof subjectValue;
    throw invariantError(
      `ExternalThread key row does not satisfy its canonical contract (${paths}; subject=${subjectShape}).`
    );
  }
  return parsed.data;
}

function normalizeResolveInput(
  input: ResolveOrCreateInboxV2ExternalThreadInput
): ResolveOrCreateInboxV2ExternalThreadInput {
  assertStrictObject(input, RESOLVE_INPUT_KEYS, "resolve input");
  const mapping = inboxV2ExternalThreadMappingSchema.parse(input.mapping);
  const streamPosition = inboxV2BigintCounterSchema.parse(input.streamPosition);
  if (streamPosition === "0") {
    throw new CoreError(
      "validation.failed",
      "ExternalThread candidate Conversation requires a positive stream position."
    );
  }
  return { mapping, streamPosition };
}

function toScopeColumns(key: InboxV2ExternalThreadKey): {
  sourceConnectionId: string | null;
  sourceAccountId: string | null;
  ownerKey: string;
} {
  return {
    sourceConnectionId:
      key.scope.kind === "source_connection" ? key.scope.owner.id : null,
    sourceAccountId:
      key.scope.kind === "source_account" ? key.scope.owner.id : null,
    ownerKey: key.scope.kind === "provider" ? "provider" : key.scope.owner.id
  };
}

function externalThreadKeyRegistryId(digest: string): string {
  return `${KEY_REGISTRY_ID_PREFIX}${digest}`;
}

function lengthPrefixed(value: string): string {
  return `${new TextEncoder().encode(value).byteLength}:${value}`;
}

function lengthPrefixedNullable(value: string | null): string {
  return value === null ? "-1:" : lengthPrefixed(value);
}

function sameExternalThreadKey(
  left: InboxV2ExternalThreadKey,
  right: InboxV2ExternalThreadKey
): boolean {
  return keyFingerprint(left) === keyFingerprint(right);
}

function keyFingerprint(key: InboxV2ExternalThreadKey): string {
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

function sameMapping(
  left: InboxV2ExternalThreadMapping,
  right: InboxV2ExternalThreadMapping
): boolean {
  return (
    sameThread(left.thread, right.thread) &&
    sameConversationIdentity(left.conversation, right.conversation)
  );
}

function sameThread(
  left: InboxV2ExternalThreadMapping["thread"],
  right: InboxV2ExternalThreadMapping["thread"]
): boolean {
  return (
    JSON.stringify({
      ...left,
      createdAt: null,
      updatedAt: null
    }) ===
      JSON.stringify({
        ...right,
        createdAt: null,
        updatedAt: null
      }) &&
    sameTimestamp(left.createdAt, right.createdAt) &&
    sameTimestamp(left.updatedAt, right.updatedAt)
  );
}

function sameConversationIdentity(
  left: InboxV2Conversation,
  right: InboxV2Conversation
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.id === right.id &&
    left.topology === right.topology &&
    left.transport === right.transport &&
    left.purposeId === right.purposeId
  );
}

function sameAlias(
  left: InboxV2ExternalThreadAlias,
  right: InboxV2ExternalThreadAlias
): boolean {
  return (
    JSON.stringify({
      ...left,
      decision: { ...left.decision, decidedAt: null },
      createdAt: null
    }) ===
      JSON.stringify({
        ...right,
        decision: { ...right.decision, decidedAt: null },
        createdAt: null
      }) &&
    sameTimestamp(left.decision.decidedAt, right.decision.decidedAt) &&
    sameTimestamp(left.createdAt, right.createdAt)
  );
}

function sameTimestamp(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}

function requireSingleInsertedRow(
  result: RawSqlQueryResult<IdRow>,
  message: string
): void {
  if (result.rows.length !== 1) {
    throw invariantError(message);
  }
}

function parseTenant(
  value: unknown,
  expectedTenantId: InboxV2TenantId
): InboxV2TenantId {
  const parsed = inboxV2TenantIdSchema.safeParse(value);
  if (!parsed.success) {
    throw invariantError("Persistence row contains an invalid tenant ID.");
  }
  if (parsed.data !== expectedTenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
  return parsed.data;
}

function parseDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw invariantError(`${field} is not a SHA-256 hex digest.`);
  }
  return value;
}

function parseDatabaseBigint(value: unknown, field: string): string {
  if (typeof value === "number") {
    throw invariantError(
      `${field} was decoded as a JavaScript number and may have lost precision.`
    );
  }
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw invariantError(`${field} is not a PostgreSQL bigint value.`);
  }
  return String(value);
}

function parseDatabaseTimestamp(value: unknown, field: string): string {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (parsed === null || Number.isNaN(parsed.getTime())) {
    throw invariantError(`${field} is not a PostgreSQL timestamp.`);
  }
  return parsed.toISOString();
}

function assertStrictObject(
  input: unknown,
  keys: ReadonlySet<string>,
  name: string
): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CoreError("validation.failed", `${name} must be an object.`);
  }
  const unexpected = Object.keys(input).filter((key) => !keys.has(key));
  if (unexpected.length > 0) {
    throw new CoreError(
      "validation.failed",
      `${name} contains unsupported fields: ${unexpected.join(", ")}.`
    );
  }
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
