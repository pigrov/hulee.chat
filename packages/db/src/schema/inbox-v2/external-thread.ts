import type { InboxV2AdapterIdentityDeclaration } from "@hulee/contracts";
import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn
} from "drizzle-orm/pg-core";

import {
  inboxV2Conversations,
  inboxV2ConversationTopology,
  inboxV2ConversationTransport,
  sourceAccounts,
  sourceConnections,
  tenants
} from "../tables";

export const inboxV2ExternalThreadKeyKind = pgEnum(
  "inbox_v2_external_thread_key_kind",
  ["canonical", "alias"]
);

export const inboxV2ExternalThreadScopeKind = pgEnum(
  "inbox_v2_external_thread_scope_kind",
  ["provider", "source_connection", "source_account"]
);

type ExternalThreadKeyColumnNames = Readonly<{
  realmId: string;
  realmVersion: string;
  canonicalizationVersion: string;
  scopeKind: string;
  scopeSourceConnectionId: string;
  scopeSourceAccountId: string;
  objectKindId: string;
  canonicalExternalSubject: string;
}>;

/**
 * Builds an unambiguous byte representation: every value is UTF-8 byte-length
 * prefixed, while null has its own marker. Delimiters and backslashes inside an
 * opaque provider value therefore cannot change tuple boundaries.
 *
 * SHA-256 is computed by PostgreSQL core, not trusted from an adapter caller.
 * Backslashes are doubled before the text-to-bytea cast so the bytea input
 * parser preserves the exact UTF-8 byte sequence.
 */
function externalThreadKeyDigestSql(columns: ExternalThreadKeyColumnNames) {
  const realmId = lengthPrefixedColumn(columns.realmId);
  const realmVersion = lengthPrefixedColumn(columns.realmVersion);
  const canonicalizationVersion = lengthPrefixedColumn(
    columns.canonicalizationVersion
  );
  const scopeKind = externalThreadScopeKindColumn(columns.scopeKind);
  const scopeSourceConnectionId = lengthPrefixedColumn(
    columns.scopeSourceConnectionId,
    true
  );
  const scopeSourceAccountId = lengthPrefixedColumn(
    columns.scopeSourceAccountId,
    true
  );
  const objectKindId = lengthPrefixedColumn(columns.objectKindId);
  const canonicalExternalSubject = lengthPrefixedColumn(
    columns.canonicalExternalSubject
  );

  return sql`encode(
    sha256(
      replace(
        'external-thread-key:v1|' ||
        ${realmId} ||
        ${realmVersion} ||
        ${canonicalizationVersion} ||
        ${scopeKind} ||
        ${scopeSourceConnectionId} ||
        ${scopeSourceAccountId} ||
        ${objectKindId} ||
        ${canonicalExternalSubject},
        chr(92),
        chr(92) || chr(92)
      )::bytea
    ),
    'hex'
  )`;
}

function externalThreadScopeKindColumn(columnName: string) {
  const column = sql.identifier(columnName);

  return sql`case ${column}
    when 'provider' then '8:provider'
    when 'source_connection' then '17:source_connection'
    when 'source_account' then '14:source_account'
  end`;
}

function lengthPrefixedColumn(columnName: string, nullable = false) {
  const column = sql.identifier(columnName);

  if (nullable) {
    return sql`case
      when ${column} is null then '-1:'
      else octet_length(${column})::text || ':' || ${column}
    end`;
  }

  return sql`octet_length(${column})::text || ':' || ${column}`;
}

function scopeOwnerParitySql(input: {
  scopeKind: AnyPgColumn;
  sourceConnectionId: AnyPgColumn;
  sourceAccountId: AnyPgColumn;
  scopeOwnerKey: AnyPgColumn;
}) {
  return sql`(
    (
      ${input.scopeKind} = 'provider'
      and ${input.sourceConnectionId} is null
      and ${input.sourceAccountId} is null
      and ${input.scopeOwnerKey} = 'provider'
    ) or (
      ${input.scopeKind} = 'source_connection'
      and ${input.sourceConnectionId} is not null
      and ${input.sourceAccountId} is null
      and ${input.scopeOwnerKey} = ${input.sourceConnectionId}
    ) or (
      ${input.scopeKind} = 'source_account'
      and ${input.sourceConnectionId} is null
      and ${input.sourceAccountId} is not null
      and ${input.scopeOwnerKey} = ${input.sourceAccountId}
    )
  ) is true`;
}

function externalThreadDeclarationSql(input: {
  declaration: AnyPgColumn;
  realmId: AnyPgColumn;
  realmVersion: AnyPgColumn;
  canonicalizationVersion: AnyPgColumn;
  scopeKind: AnyPgColumn;
  objectKindId: AnyPgColumn;
  createdAt: AnyPgColumn;
  requireAuthoritative?: boolean;
  decisionTrustedServiceId?: AnyPgColumn;
}) {
  const authoritativeClause = input.requireAuthoritative
    ? sql`and ${input.declaration} ->> 'decisionStrength' = 'authoritative'`
    : sql``;
  const trustedServiceClause = input.decisionTrustedServiceId
    ? sql`and ${input.declaration} #>> '{adapterContract,loadedByTrustedServiceId}' = ${input.decisionTrustedServiceId}`
    : sql``;

  return sql`(
    jsonb_typeof(${input.declaration}) = 'object'
    and ${input.declaration} ?& array[
      'adapterContract',
      'identityKind',
      'realmId',
      'realmVersion',
      'canonicalizationVersion',
      'objectKindId',
      'scopeKind',
      'decisionStrength'
    ]
    and jsonb_typeof(${input.declaration} -> 'adapterContract') = 'object'
    and (${input.declaration} -> 'adapterContract') ?& array[
      'contractId',
      'contractVersion',
      'declarationRevision',
      'surfaceId',
      'loadedByTrustedServiceId',
      'loadedAt'
    ]
    and ${input.declaration} ->> 'identityKind' = 'external_thread'
    and ${input.declaration} ->> 'realmId' = ${input.realmId}
    and ${input.declaration} ->> 'realmVersion' = ${input.realmVersion}
    and ${input.declaration} ->> 'canonicalizationVersion' = ${input.canonicalizationVersion}
    and ${input.declaration} ->> 'objectKindId' = ${input.objectKindId}
    and ${input.declaration} ->> 'scopeKind' = ${input.scopeKind}::text
    and ${input.declaration} ->> 'decisionStrength' in (
      'authoritative',
      'safe_default'
    )
    and (
      ${input.declaration} ->> 'decisionStrength' = 'authoritative'
      or (
        ${input.declaration} ->> 'decisionStrength' = 'safe_default'
        and ${input.scopeKind} = 'source_account'
      )
    )
    and (
      ${input.scopeKind} <> 'provider'
      or ${input.declaration} ->> 'decisionStrength' = 'authoritative'
    )
    ${authoritativeClause}
    and ${input.declaration} #>> '{adapterContract,contractVersion}' ~ '^v[1-9][0-9]*$'
    and ${input.declaration} #>> '{adapterContract,declarationRevision}' ~ '^[1-9][0-9]*$'
    and ${catalogIdParitySql(
      sql`${input.declaration} #>> '{adapterContract,contractId}'`
    )}
    and ${catalogIdParitySql(
      sql`${input.declaration} #>> '{adapterContract,surfaceId}'`
    )}
    and ${catalogIdParitySql(
      sql`${input.declaration} #>> '{adapterContract,loadedByTrustedServiceId}'`
    )}
    and isfinite(
      (${input.declaration} #>> '{adapterContract,loadedAt}')::timestamptz
    )
    and (${input.declaration} #>> '{adapterContract,loadedAt}')::timestamptz <= ${input.createdAt}
    ${trustedServiceClause}
  ) is true`;
}

function catalogIdParitySql(value: SQLWrapper) {
  return sql`char_length(${value}) <= 256 and (
    (
      ${value} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${value}, ':', 2)) <= 160
    ) or (
      ${value} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${value}, ':', 2)) <= 80
      and char_length(split_part(${value}, ':', 3)) <= 160
      and split_part(${value}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )`;
}

/**
 * One race-safe namespace for both canonical and alias keys. A digest keeps the
 * tenant uniqueness index bounded; callers must still load and compare every
 * raw key field before treating a digest hit as an exact match.
 */
export const inboxV2ExternalThreadKeyRegistry = pgTable(
  "inbox_v2_external_thread_key_registry",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    entryKind: inboxV2ExternalThreadKeyKind("entry_kind").notNull(),
    realmId: text("realm_id").notNull(),
    realmVersion: text("realm_version").notNull(),
    canonicalizationVersion: text("canonicalization_version").notNull(),
    scopeKind: inboxV2ExternalThreadScopeKind("scope_kind").notNull(),
    scopeSourceConnectionId: text("scope_source_connection_id"),
    scopeSourceAccountId: text("scope_source_account_id"),
    scopeOwnerKey: text("scope_owner_key").notNull(),
    objectKindId: text("object_kind_id").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    keyDigest: text("key_digest")
      .generatedAlwaysAs(() =>
        externalThreadKeyDigestSql({
          realmId: "realm_id",
          realmVersion: "realm_version",
          canonicalizationVersion: "canonicalization_version",
          scopeKind: "scope_kind",
          scopeSourceConnectionId: "scope_source_connection_id",
          scopeSourceAccountId: "scope_source_account_id",
          objectKindId: "object_kind_id",
          canonicalExternalSubject: "canonical_external_subject"
        })
      )
      .notNull(),
    canonicalThreadId: text("canonical_thread_id").notNull(),
    canonicalConversationId: text("canonical_conversation_id").notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_ext_thread_key_registry_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_key_connection_fk",
      columns: [table.tenantId, table.scopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_key_account_fk",
      columns: [table.tenantId, table.scopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_key_conversation_fk",
      columns: [table.tenantId, table.canonicalConversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    unique("inbox_v2_ext_thread_key_digest_unique").on(
      table.tenantId,
      table.keyDigest
    ),
    unique("inbox_v2_ext_thread_key_owner_unique").on(
      table.tenantId,
      table.id,
      table.entryKind,
      table.canonicalThreadId,
      table.canonicalConversationId,
      table.keyDigest
    ),
    check(
      "inbox_v2_ext_thread_key_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^external_thread_key:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_ext_thread_key_target_id_check",
      sql`char_length(${table.canonicalThreadId}) <= 256
        and ${table.canonicalThreadId} ~ '^external_thread:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_ext_thread_key_realm_check",
      sql`char_length(${table.realmId}) <= 256 and (
        (
          ${table.realmId} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
          and char_length(split_part(${table.realmId}, ':', 2)) <= 160
        ) or (
          ${table.realmId} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
          and char_length(split_part(${table.realmId}, ':', 2)) <= 80
          and char_length(split_part(${table.realmId}, ':', 3)) <= 160
          and split_part(${table.realmId}, ':', 2) not in (
            'core', 'hulee', 'module', 'platform', 'system'
          )
        )
      )`
    ),
    check(
      "inbox_v2_ext_thread_key_versions_check",
      sql`${table.realmVersion} ~ '^v[1-9][0-9]*$'
        and ${table.canonicalizationVersion} ~ '^v[1-9][0-9]*$'`
    ),
    check(
      "inbox_v2_ext_thread_key_scope_check",
      scopeOwnerParitySql({
        scopeKind: table.scopeKind,
        sourceConnectionId: table.scopeSourceConnectionId,
        sourceAccountId: table.scopeSourceAccountId,
        scopeOwnerKey: table.scopeOwnerKey
      })
    ),
    check(
      "inbox_v2_ext_thread_key_object_kind_check",
      catalogIdParitySql(table.objectKindId)
    ),
    check(
      "inbox_v2_ext_thread_key_subject_check",
      sql`char_length(${table.canonicalExternalSubject}) between 1 and 1024
        and ${table.canonicalExternalSubject} !~ '^[[:space:]]*$'
        and ${table.canonicalExternalSubject} !~ '[\\x00-\\x1F\\x7F]'`
    ),
    check(
      "inbox_v2_ext_thread_key_digest_check",
      sql`${table.keyDigest} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "inbox_v2_ext_thread_key_immutable_check",
      sql`${table.revision} = 1
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} = ${table.createdAt}`
    ),
    uniqueIndex("inbox_v2_ext_thread_key_canonical_target_unique")
      .on(table.tenantId, table.canonicalThreadId)
      .where(sql`${table.entryKind} = 'canonical'`),
    index("inbox_v2_ext_thread_key_tenant_target_idx").on(
      table.tenantId,
      table.canonicalThreadId,
      table.entryKind,
      table.id
    ),
    index("inbox_v2_ext_thread_key_tenant_conversation_idx").on(
      table.tenantId,
      table.canonicalConversationId,
      table.entryKind,
      table.id
    )
  ]
);

/** Canonical provider thread and immutable one-to-one Conversation mapping. */
export const inboxV2ExternalThreads = pgTable(
  "inbox_v2_external_threads",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    keyRegistryId: text("key_registry_id").notNull(),
    keyRegistryEntryKind: inboxV2ExternalThreadKeyKind(
      "key_registry_entry_kind"
    )
      .notNull()
      .default("canonical"),
    realmId: text("realm_id").notNull(),
    realmVersion: text("realm_version").notNull(),
    canonicalizationVersion: text("canonicalization_version").notNull(),
    scopeKind: inboxV2ExternalThreadScopeKind("scope_kind").notNull(),
    scopeSourceConnectionId: text("scope_source_connection_id"),
    scopeSourceAccountId: text("scope_source_account_id"),
    scopeOwnerKey: text("scope_owner_key").notNull(),
    objectKindId: text("object_kind_id").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    keyDigest: text("key_digest")
      .generatedAlwaysAs(() =>
        externalThreadKeyDigestSql({
          realmId: "realm_id",
          realmVersion: "realm_version",
          canonicalizationVersion: "canonicalization_version",
          scopeKind: "scope_kind",
          scopeSourceConnectionId: "scope_source_connection_id",
          scopeSourceAccountId: "scope_source_account_id",
          objectKindId: "object_kind_id",
          canonicalExternalSubject: "canonical_external_subject"
        })
      )
      .notNull(),
    identityDeclaration: jsonb("identity_declaration")
      .$type<InboxV2AdapterIdentityDeclaration>()
      .notNull(),
    conversationId: text("conversation_id").notNull(),
    conversationTransport: inboxV2ConversationTransport(
      "conversation_transport"
    )
      .notNull()
      .default("external"),
    conversationTopology: inboxV2ConversationTopology(
      "conversation_topology"
    ).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_external_threads_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_external_threads_conversation_fk",
      columns: [
        table.tenantId,
        table.conversationId,
        table.conversationTransport,
        table.conversationTopology
      ],
      foreignColumns: [
        inboxV2Conversations.tenantId,
        inboxV2Conversations.id,
        inboxV2Conversations.transport,
        inboxV2Conversations.topology
      ]
    }),
    foreignKey({
      name: "inbox_v2_external_threads_connection_fk",
      columns: [table.tenantId, table.scopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_external_threads_account_fk",
      columns: [table.tenantId, table.scopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_external_threads_registry_fk",
      columns: [
        table.tenantId,
        table.keyRegistryId,
        table.keyRegistryEntryKind,
        table.id,
        table.conversationId,
        table.keyDigest
      ],
      foreignColumns: [
        inboxV2ExternalThreadKeyRegistry.tenantId,
        inboxV2ExternalThreadKeyRegistry.id,
        inboxV2ExternalThreadKeyRegistry.entryKind,
        inboxV2ExternalThreadKeyRegistry.canonicalThreadId,
        inboxV2ExternalThreadKeyRegistry.canonicalConversationId,
        inboxV2ExternalThreadKeyRegistry.keyDigest
      ]
    }),
    unique("inbox_v2_external_threads_conversation_unique").on(
      table.tenantId,
      table.conversationId
    ),
    unique("inbox_v2_external_threads_registry_unique").on(
      table.tenantId,
      table.keyRegistryId
    ),
    unique("inbox_v2_external_threads_target_revision_unique").on(
      table.tenantId,
      table.id,
      table.conversationId,
      table.revision
    ),
    check(
      "inbox_v2_external_threads_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^external_thread:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_external_threads_registry_kind_check",
      sql`${table.keyRegistryEntryKind} = 'canonical'
        and ${table.conversationTransport} = 'external'`
    ),
    check(
      "inbox_v2_external_threads_scope_check",
      scopeOwnerParitySql({
        scopeKind: table.scopeKind,
        sourceConnectionId: table.scopeSourceConnectionId,
        sourceAccountId: table.scopeSourceAccountId,
        scopeOwnerKey: table.scopeOwnerKey
      })
    ),
    check(
      "inbox_v2_external_threads_declaration_check",
      externalThreadDeclarationSql({
        declaration: table.identityDeclaration,
        realmId: table.realmId,
        realmVersion: table.realmVersion,
        canonicalizationVersion: table.canonicalizationVersion,
        scopeKind: table.scopeKind,
        objectKindId: table.objectKindId,
        createdAt: table.createdAt
      })
    ),
    check(
      "inbox_v2_external_threads_immutable_check",
      sql`${table.revision} = 1
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} = ${table.createdAt}`
    ),
    index("inbox_v2_external_threads_tenant_scope_idx").on(
      table.tenantId,
      table.scopeKind,
      table.scopeOwnerKey,
      table.id
    )
  ]
);

/**
 * Immutable authoritative migration from one exact historical key directly
 * to a canonical thread. Both registry references are fenced to the same
 * Thread/Conversation target, so an alias cannot target another alias.
 */
export const inboxV2ExternalThreadAliases = pgTable(
  "inbox_v2_external_thread_aliases",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),

    aliasKeyRegistryId: text("alias_key_registry_id").notNull(),
    aliasKeyRegistryEntryKind: inboxV2ExternalThreadKeyKind(
      "alias_key_registry_entry_kind"
    )
      .notNull()
      .default("alias"),
    aliasRealmId: text("alias_realm_id").notNull(),
    aliasRealmVersion: text("alias_realm_version").notNull(),
    aliasCanonicalizationVersion: text(
      "alias_canonicalization_version"
    ).notNull(),
    aliasScopeKind:
      inboxV2ExternalThreadScopeKind("alias_scope_kind").notNull(),
    aliasScopeSourceConnectionId: text("alias_scope_source_connection_id"),
    aliasScopeSourceAccountId: text("alias_scope_source_account_id"),
    aliasScopeOwnerKey: text("alias_scope_owner_key").notNull(),
    aliasObjectKindId: text("alias_object_kind_id").notNull(),
    aliasCanonicalExternalSubject: text(
      "alias_canonical_external_subject"
    ).notNull(),
    aliasKeyDigest: text("alias_key_digest")
      .generatedAlwaysAs(() =>
        externalThreadKeyDigestSql({
          realmId: "alias_realm_id",
          realmVersion: "alias_realm_version",
          canonicalizationVersion: "alias_canonicalization_version",
          scopeKind: "alias_scope_kind",
          scopeSourceConnectionId: "alias_scope_source_connection_id",
          scopeSourceAccountId: "alias_scope_source_account_id",
          objectKindId: "alias_object_kind_id",
          canonicalExternalSubject: "alias_canonical_external_subject"
        })
      )
      .notNull(),
    aliasIdentityDeclaration: jsonb("alias_identity_declaration")
      .$type<InboxV2AdapterIdentityDeclaration>()
      .notNull(),

    canonicalThreadId: text("canonical_thread_id").notNull(),
    canonicalConversationId: text("canonical_conversation_id").notNull(),
    canonicalKeyRegistryId: text("canonical_key_registry_id").notNull(),
    canonicalKeyRegistryEntryKind: inboxV2ExternalThreadKeyKind(
      "canonical_key_registry_entry_kind"
    )
      .notNull()
      .default("canonical"),
    canonicalRealmId: text("canonical_realm_id").notNull(),
    canonicalRealmVersion: text("canonical_realm_version").notNull(),
    canonicalCanonicalizationVersion: text(
      "canonical_canonicalization_version"
    ).notNull(),
    canonicalScopeKind: inboxV2ExternalThreadScopeKind(
      "canonical_scope_kind"
    ).notNull(),
    canonicalScopeSourceConnectionId: text(
      "canonical_scope_source_connection_id"
    ),
    canonicalScopeSourceAccountId: text("canonical_scope_source_account_id"),
    canonicalScopeOwnerKey: text("canonical_scope_owner_key").notNull(),
    canonicalObjectKindId: text("canonical_object_kind_id").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    canonicalKeyDigest: text("canonical_key_digest")
      .generatedAlwaysAs(() =>
        externalThreadKeyDigestSql({
          realmId: "canonical_realm_id",
          realmVersion: "canonical_realm_version",
          canonicalizationVersion: "canonical_canonicalization_version",
          scopeKind: "canonical_scope_kind",
          scopeSourceConnectionId: "canonical_scope_source_connection_id",
          scopeSourceAccountId: "canonical_scope_source_account_id",
          objectKindId: "canonical_object_kind_id",
          canonicalExternalSubject: "canonical_external_subject"
        })
      )
      .notNull(),
    expectedCanonicalThreadRevision: bigint(
      "expected_canonical_thread_revision",
      { mode: "bigint" }
    ).notNull(),

    decisionTrustedServiceId: text("decision_trusted_service_id").notNull(),
    decisionPolicyId: text("decision_policy_id").notNull(),
    decisionPolicyVersion: text("decision_policy_version").notNull(),
    decisionReasonCodeId: text("decision_reason_code_id").notNull(),
    decisionAuthoritativeEvidenceToken: text(
      "decision_authoritative_evidence_token"
    ).notNull(),
    decisionDecidedAt: timestamp("decision_decided_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_external_thread_aliases_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_alias_alias_connection_fk",
      columns: [table.tenantId, table.aliasScopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_alias_alias_account_fk",
      columns: [table.tenantId, table.aliasScopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_alias_canonical_connection_fk",
      columns: [table.tenantId, table.canonicalScopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_alias_canonical_account_fk",
      columns: [table.tenantId, table.canonicalScopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_alias_alias_registry_fk",
      columns: [
        table.tenantId,
        table.aliasKeyRegistryId,
        table.aliasKeyRegistryEntryKind,
        table.canonicalThreadId,
        table.canonicalConversationId,
        table.aliasKeyDigest
      ],
      foreignColumns: [
        inboxV2ExternalThreadKeyRegistry.tenantId,
        inboxV2ExternalThreadKeyRegistry.id,
        inboxV2ExternalThreadKeyRegistry.entryKind,
        inboxV2ExternalThreadKeyRegistry.canonicalThreadId,
        inboxV2ExternalThreadKeyRegistry.canonicalConversationId,
        inboxV2ExternalThreadKeyRegistry.keyDigest
      ]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_alias_canonical_registry_fk",
      columns: [
        table.tenantId,
        table.canonicalKeyRegistryId,
        table.canonicalKeyRegistryEntryKind,
        table.canonicalThreadId,
        table.canonicalConversationId,
        table.canonicalKeyDigest
      ],
      foreignColumns: [
        inboxV2ExternalThreadKeyRegistry.tenantId,
        inboxV2ExternalThreadKeyRegistry.id,
        inboxV2ExternalThreadKeyRegistry.entryKind,
        inboxV2ExternalThreadKeyRegistry.canonicalThreadId,
        inboxV2ExternalThreadKeyRegistry.canonicalConversationId,
        inboxV2ExternalThreadKeyRegistry.keyDigest
      ]
    }),
    foreignKey({
      name: "inbox_v2_ext_thread_alias_direct_target_fk",
      columns: [
        table.tenantId,
        table.canonicalThreadId,
        table.canonicalConversationId,
        table.expectedCanonicalThreadRevision
      ],
      foreignColumns: [
        inboxV2ExternalThreads.tenantId,
        inboxV2ExternalThreads.id,
        inboxV2ExternalThreads.conversationId,
        inboxV2ExternalThreads.revision
      ]
    }),
    unique("inbox_v2_external_thread_aliases_registry_unique").on(
      table.tenantId,
      table.aliasKeyRegistryId
    ),
    check(
      "inbox_v2_external_thread_aliases_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^external_thread_alias:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_external_thread_aliases_kind_check",
      sql`${table.aliasKeyRegistryEntryKind} = 'alias'
        and ${table.canonicalKeyRegistryEntryKind} = 'canonical'`
    ),
    check(
      "inbox_v2_external_thread_aliases_alias_scope_check",
      scopeOwnerParitySql({
        scopeKind: table.aliasScopeKind,
        sourceConnectionId: table.aliasScopeSourceConnectionId,
        sourceAccountId: table.aliasScopeSourceAccountId,
        scopeOwnerKey: table.aliasScopeOwnerKey
      })
    ),
    check(
      "inbox_v2_external_thread_aliases_canonical_scope_check",
      scopeOwnerParitySql({
        scopeKind: table.canonicalScopeKind,
        sourceConnectionId: table.canonicalScopeSourceConnectionId,
        sourceAccountId: table.canonicalScopeSourceAccountId,
        scopeOwnerKey: table.canonicalScopeOwnerKey
      })
    ),
    check(
      "inbox_v2_external_thread_aliases_distinct_key_check",
      sql`row(
          ${table.aliasRealmId},
          ${table.aliasRealmVersion},
          ${table.aliasCanonicalizationVersion},
          ${table.aliasScopeKind},
          ${table.aliasScopeOwnerKey},
          ${table.aliasObjectKindId},
          ${table.aliasCanonicalExternalSubject}
        ) is distinct from row(
          ${table.canonicalRealmId},
          ${table.canonicalRealmVersion},
          ${table.canonicalCanonicalizationVersion},
          ${table.canonicalScopeKind},
          ${table.canonicalScopeOwnerKey},
          ${table.canonicalObjectKindId},
          ${table.canonicalExternalSubject}
        )`
    ),
    check(
      "inbox_v2_external_thread_aliases_declaration_check",
      externalThreadDeclarationSql({
        declaration: table.aliasIdentityDeclaration,
        realmId: table.aliasRealmId,
        realmVersion: table.aliasRealmVersion,
        canonicalizationVersion: table.aliasCanonicalizationVersion,
        scopeKind: table.aliasScopeKind,
        objectKindId: table.aliasObjectKindId,
        createdAt: table.createdAt,
        requireAuthoritative: true,
        decisionTrustedServiceId: table.decisionTrustedServiceId
      })
    ),
    check(
      "inbox_v2_external_thread_aliases_decision_check",
      sql`(
        ${catalogIdParitySql(table.decisionTrustedServiceId)}
        and ${catalogIdParitySql(table.decisionPolicyId)}
        and ${catalogIdParitySql(table.decisionReasonCodeId)}
        and ${table.decisionPolicyVersion} ~ '^v[1-9][0-9]*$'
        and char_length(${table.decisionAuthoritativeEvidenceToken}) between 8 and 256
        and ${table.decisionAuthoritativeEvidenceToken} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and isfinite(${table.decisionDecidedAt})
        and ${table.decisionDecidedAt} = ${table.createdAt}
      ) is true`
    ),
    check(
      "inbox_v2_external_thread_aliases_immutable_check",
      sql`${table.expectedCanonicalThreadRevision} = 1
        and ${table.revision} = 1
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_external_thread_aliases_tenant_target_idx").on(
      table.tenantId,
      table.canonicalThreadId,
      table.createdAt.desc(),
      table.id
    ),
    index("inbox_v2_external_thread_aliases_tenant_decision_idx").on(
      table.tenantId,
      table.decisionPolicyId,
      table.createdAt.desc(),
      table.id
    )
  ]
);
