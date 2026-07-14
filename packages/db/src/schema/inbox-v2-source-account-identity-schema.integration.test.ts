import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const occurredAt = "2026-07-13T18:00:00.000Z";
const identityDeclaration = JSON.stringify({
  adapterContract: {
    contractId: "core:contract",
    contractVersion: "v1",
    declarationRevision: "1",
    surfaceId: "core:surface",
    loadedByTrustedServiceId: "core:trusted",
    loadedAt: occurredAt
  },
  identityKind: "source_account",
  realmId: "core:realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "core:account",
  scopeKind: "provider",
  decisionStrength: "authoritative"
});

type SqlExecutor = {
  execute(query: SQL): Promise<unknown>;
};

type Fixture = Readonly<{
  tenantId: string;
  connectionId: string;
  accountId: string;
  subject: string;
}>;

describePostgres(
  "Inbox V2 SourceAccount identity PostgreSQL invariants",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const triggers = await db.execute<{ trigger_count: string }>(sql`
      select count(*)::text as trigger_count
        from pg_trigger
       where tgname like 'inbox_v2_account_identity%trigger'
          or tgname = 'inbox_v2_account_provisional_keys_immutable_trigger'
          or tgname = 'inbox_v2_account_provisional_key_induction_trigger'
    `);
      expect(Number(triggers.rows[0]?.trigger_count)).toBeGreaterThanOrEqual(
        14
      );
    });

    afterAll(async () => {
      await closeHuleeDatabase(db);
    });

    it("accepts one exact provisional identity and inducing transition", async () => {
      await expect(
        db.transaction(async (transaction) => {
          await insertProvisionalFixture(transaction, `valid-${runId}`);
          await transaction.execute(sql`set constraints all immediate`);
          throw new Error("rollback-valid-source-account-fixture");
        })
      ).rejects.toThrow("rollback-valid-source-account-fixture");
    });

    it("blocks committing an orphan provisional fingerprint reservation", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const suffix = `orphan-registry-${runId}`;
          const tenantId = `tenant:${suffix}`;
          const connectionId = `source_connection:${suffix}`;
          const accountId = `source_account:${suffix}`;

          await transaction.execute(sql`
          insert into tenants (id, slug, display_name)
          values (${tenantId}, ${suffix}, 'Orphan registry audit')
        `);
          await transaction.execute(sql`
          insert into source_connections (
            id, tenant_id, source_type, source_name, display_name
          ) values (
            ${connectionId}, ${tenantId}, 'messenger', 'audit',
            'Orphan registry audit'
          )
        `);
          await transaction.execute(sql`
          insert into source_accounts (
            id, tenant_id, source_connection_id, account_type, display_name
          ) values (
            ${accountId}, ${tenantId}, ${connectionId}, 'direct_number',
            'Orphan registry audit'
          )
        `);
          await transaction.execute(sql`
          create temp table inbox_v2_source_account_identity_transitions (
            tenant_id text not null,
            source_account_id text not null,
            provisional_key_digest_sha256 text not null,
            provisional_observed_at timestamptz not null,
            intent text not null,
            occurred_at timestamptz not null
          ) on commit drop
        `);
          await transaction.execute(
            sql`set local search_path = pg_temp, public`
          );
          await transaction.execute(sql`
          insert into public.inbox_v2_source_account_provisional_keys (
            tenant_id, source_account_id, source_connection_id,
            declaration_contract_id, declaration_contract_version,
            declaration_surface_id, connector_session_subject,
            provisional_observed_at, created_at
          ) values (
            ${tenantId}, ${accountId}, ${connectionId},
            'core:contract', 'v1', 'core:surface', 'session:orphan',
            ${occurredAt}, ${occurredAt}
          )
        `);
          await transaction.execute(sql`
          insert into pg_temp.inbox_v2_source_account_identity_transitions (
            tenant_id, source_account_id, provisional_key_digest_sha256,
            provisional_observed_at, intent, occurred_at
          )
          select tenant_id, source_account_id, provisional_key_digest_sha256,
                 provisional_observed_at, 'create_provisional', created_at
            from public.inbox_v2_source_account_provisional_keys
           where tenant_id = ${tenantId}
             and source_account_id = ${accountId}
        `);
        }),
        "provisional account identity key has no exact inducing transition"
      );
    });

    it("ignores a temporary shadow of the provisional registry authority", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          await transaction.execute(sql`
          create temp table inbox_v2_source_account_provisional_keys (
            tenant_id text not null,
            provisional_key_digest_sha256 text not null,
            source_account_id text not null,
            source_connection_id text not null,
            declaration_contract_id text not null,
            declaration_contract_version text not null,
            declaration_surface_id text not null,
            connector_session_subject text not null,
            provisional_observed_at timestamptz not null
          ) on commit drop
        `);
          await transaction.execute(
            sql`set local search_path = pg_temp, public`
          );
          await transaction.execute(sql`
          insert into pg_temp.inbox_v2_source_account_provisional_keys values (
            'tenant:temp-shadow', repeat('a', 64),
            'source_account:temp-shadow', 'source_connection:temp-shadow',
            'core:contract', 'v1', 'core:surface', 'session:temp-shadow',
            ${occurredAt}
          )
        `);
          await transaction.execute(sql`
          select public.inbox_v2_assert_account_provisional_key(
            'tenant:temp-shadow', repeat('a', 64),
            'source_account:temp-shadow', 'source_connection:temp-shadow',
            'core:contract', 'v1', 'core:surface', 'session:temp-shadow',
            ${occurredAt}
          )
        `);
        }),
        "provisional key registry does not match the exact raw fingerprint"
      );
    });

    it("blocks rewriting a current provisional observation without a new transition", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `rewrite-observation-${runId}`,
            {
              provisionalObservedAt: "2026-07-13T18:10:00.000Z",
              transitionOccurredAt: "2026-07-13T18:30:00.000Z"
            }
          );
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`
          update inbox_v2_source_account_identities
             set provisional_observed_at = '2026-07-13T18:20:00.000Z'
           where tenant_id = ${fixture.tenantId}
             and source_account_id = ${fixture.accountId}
        `);
        }),
        "inbox_v2_source_account_identities_provisional_key_fk"
      );
    });

    it("blocks one provisional fingerprint from being owned by another account", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `key-${runId}`
          );
          const otherAccountId = `${fixture.accountId}-other`;
          await transaction.execute(sql`
          insert into source_accounts (
            id,
            tenant_id,
            source_connection_id,
            account_type,
            display_name
          ) values (
            ${otherAccountId},
            ${fixture.tenantId},
            ${fixture.connectionId},
            'direct_number',
            'Other audit account'
          )
        `);
          await transaction.execute(sql`
          insert into inbox_v2_source_account_provisional_keys (
            tenant_id,
            source_account_id,
            source_connection_id,
            declaration_contract_id,
            declaration_contract_version,
            declaration_surface_id,
            connector_session_subject,
            provisional_observed_at,
            created_at
          ) values (
            ${fixture.tenantId},
            ${otherAccountId},
            ${fixture.connectionId},
            'core:contract',
            'v1',
            'core:surface',
            ${fixture.subject},
            ${occurredAt},
            ${occurredAt}
          )
        `);
        }),
        "duplicate key value violates unique constraint"
      );
    });

    it("blocks a row-local CAS transition without its exact predecessor/current result", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `gap-${runId}`
          );
          await transaction.execute(sql`
          insert into inbox_v2_source_account_identity_transitions (
            tenant_id,
            id,
            source_account_id,
            provisional_key_digest_sha256,
            provisional_observed_at,
            intent,
            from_state,
            to_state,
            expected_revision,
            current_revision,
            resulting_revision,
            expected_account_generation,
            current_account_generation,
            resulting_account_generation,
            pinned_declaration_trusted_service_id,
            decision_actor_trusted_service_id,
            decision_policy_id,
            decision_policy_version,
            decision_reason_code_id,
            decision_verification_evidence_token,
            decision_decided_at,
            occurred_at
          )
          select
            ${fixture.tenantId},
            ${`source_account_identity_transition:${runId}-gap`},
            ${fixture.accountId},
            provisional_key_digest_sha256,
            provisional_observed_at,
            'promote_verified',
            'provisional',
            'verified',
            99,
            99,
            100,
            99,
            99,
            100,
            'core:trusted',
            'core:trusted',
            'core:policy',
            'v1',
            'core:promote',
            'evidence-gap',
            '2026-07-13T18:01:00.000Z',
            '2026-07-13T18:01:00.000Z'
          from inbox_v2_source_account_provisional_keys
          where tenant_id = ${fixture.tenantId}
            and source_account_id = ${fixture.accountId}
        `);
        }),
        "identity transition has no exact current result"
      );
    });

    it("blocks non-contiguous or declaration-incompatible conflict candidates", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `conflict-${runId}`
          );
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`set constraints all deferred`);
          await insertConflictAttempt(transaction, fixture, {
            candidateCount: 2,
            candidateOrdinal: 2,
            candidateRealmId: "core:other-realm",
            conflictTime: "2026-07-13T18:05:00.000Z",
            resultTime: "2026-07-13T18:05:00.000Z"
          });
        }),
        "source account identity conflict candidates are not exact and contiguous"
      );
    });

    it("blocks orphan conflict evidence from reserving the next identity revision", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `orphan-conflict-${runId}`
          );
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`set constraints all deferred`);
          await insertConflictAttempt(transaction, fixture, {
            candidateCount: 1,
            candidateOrdinal: 1,
            candidateRealmId: "core:realm",
            conflictTime: "2026-07-13T18:05:00.000Z",
            resultTime: "2026-07-13T18:05:00.000Z",
            evidenceOnly: true
          });
        }),
        "source account identity conflict evidence has no exact current result"
      );
    });

    it("blocks a conflict snapshot that differs from its current result", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `snapshot-${runId}`
          );
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`set constraints all deferred`);
          await insertConflictAttempt(transaction, fixture, {
            candidateCount: 1,
            candidateOrdinal: 1,
            candidateRealmId: "core:realm",
            conflictTime: "2026-07-13T18:05:00.000Z",
            resultTime: "2026-07-13T18:06:00.000Z"
          });
        }),
        "conflicted identity does not induce its exact evidence snapshot"
      );
    });

    it("blocks mutation or deletion of append-only transition evidence", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `immutable-${runId}`
          );
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`
          delete from inbox_v2_source_account_identity_transitions
           where tenant_id = ${fixture.tenantId}
             and source_account_id = ${fixture.accountId}
        `);
        }),
        "source account identity evidence is immutable"
      );
    });

    it("advances verified generation and preserves every prior alias and snapshot", async () => {
      await expect(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `reauth-${runId}`
          );
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`set constraints all deferred`);

          await promoteVerifiedFixture(transaction, fixture);
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`set constraints all deferred`);

          await reauthenticateVerifiedFixture(transaction, fixture);
          await transaction.execute(sql`set constraints all immediate`);

          const result = await transaction.execute<{
            revision: string;
            account_generation: string;
            snapshot_count: string;
            alias_count: string;
          }>(sql`
          select identity.revision::text,
                 identity.account_generation::text,
                 (
                   select count(*)::text
                     from inbox_v2_source_account_identity_verified_snapshots snapshot
                    where snapshot.tenant_id = identity.tenant_id
                      and snapshot.source_account_id = identity.source_account_id
                 ) as snapshot_count,
                 (
                   select count(*)::text
                     from inbox_v2_source_account_identity_aliases alias_row
                    where alias_row.tenant_id = identity.tenant_id
                      and alias_row.canonical_source_account_id = identity.source_account_id
                 ) as alias_count
            from inbox_v2_source_account_identities identity
           where identity.tenant_id = ${fixture.tenantId}
             and identity.source_account_id = ${fixture.accountId}
        `);

          expect(result.rows[0]).toEqual({
            revision: "3",
            account_generation: "3",
            snapshot_count: "2",
            alias_count: "2"
          });
          throw new Error("rollback-valid-source-account-reauth");
        })
      ).rejects.toThrow("rollback-valid-source-account-reauth");
    });

    it("blocks canonical replacement and verified-history mutation after promotion", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `replace-${runId}`
          );
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`set constraints all deferred`);
          await promoteVerifiedFixture(transaction, fixture);
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`
          update inbox_v2_source_account_identities
             set canonical_external_subject = 'provider:replacement',
                 revision = 3,
                 account_generation = 3,
                 updated_at = '2026-07-13T18:10:00.000Z'
           where tenant_id = ${fixture.tenantId}
             and source_account_id = ${fixture.accountId}
        `);
        }),
        "source account identity stable edge or declaration changed"
      );

      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `history-${runId}`
          );
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`set constraints all deferred`);
          await promoteVerifiedFixture(transaction, fixture);
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`
          delete from inbox_v2_source_account_identity_verified_snapshots
           where tenant_id = ${fixture.tenantId}
             and source_account_id = ${fixture.accountId}
        `);
        }),
        "source account identity evidence is immutable"
      );
    });

    it("blocks an auxiliary alias without its own verified transition", async () => {
      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const fixture = await insertProvisionalFixture(
            transaction,
            `auxiliary-alias-${runId}`
          );
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`set constraints all deferred`);
          await promoteVerifiedFixture(transaction, fixture);
          await transaction.execute(sql`set constraints all immediate`);
          await transaction.execute(sql`set constraints all deferred`);

          const auxiliaryAliasAt = "2026-07-13T18:09:00.000Z";
          const auxiliarySubject = `${fixture.subject}:auxiliary-alias`;
          await transaction.execute(sql`
          insert into inbox_v2_source_account_provisional_keys (
            tenant_id, source_account_id, source_connection_id,
            declaration_contract_id, declaration_contract_version,
            declaration_surface_id, connector_session_subject,
            provisional_observed_at, created_at
          ) values (
            ${fixture.tenantId}, ${fixture.accountId}, ${fixture.connectionId},
            'core:contract', 'v1', 'core:surface', ${auxiliarySubject},
            ${auxiliaryAliasAt},
            ${auxiliaryAliasAt}
          )
        `);
          await insertVerifiedAlias(transaction, fixture, {
            aliasId: `source_account_identity_alias:${runId}-auxiliary-${fixture.subject.slice(-12)}`,
            subject: auxiliarySubject,
            observedAt: auxiliaryAliasAt,
            revision: 2,
            reason: "core:auxiliary-alias",
            evidence: "evidence-auxiliary-alias",
            createdAt: auxiliaryAliasAt
          });
          await transaction.execute(sql`set constraints all immediate`);
        }),
        "provisional account identity key has no exact inducing transition"
      );
    });
  }
);

async function expectDatabaseFailure(
  operation: Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeDefined();
  expect(databaseErrorMessages(caught)).toContain(expectedMessage);
}

function databaseErrorMessages(error: unknown): string {
  const messages: string[] = [];
  let current = error;

  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
    } else {
      messages.push(String(current));
    }

    if (typeof current !== "object" || !("cause" in current)) {
      break;
    }
    const cause = (current as { cause?: unknown }).cause;
    if (!cause || cause === current) {
      break;
    }
    current = cause;
  }

  return messages.join("\n");
}

async function insertProvisionalFixture(
  executor: SqlExecutor,
  suffix: string,
  input: Readonly<{
    provisionalObservedAt: string;
    transitionOccurredAt: string;
  }> = {
    provisionalObservedAt: occurredAt,
    transitionOccurredAt: occurredAt
  }
): Promise<Fixture> {
  const tenantId = `tenant:${suffix}`;
  const connectionId = `source_connection:${suffix}`;
  const accountId = `source_account:${suffix}`;
  const subject = `session:${suffix}`;

  await executor.execute(sql`
    insert into tenants (id, slug, display_name)
    values (${tenantId}, ${suffix}, 'SourceAccount invariant audit')
  `);
  await executor.execute(sql`
    insert into source_connections (
      id,
      tenant_id,
      source_type,
      source_name,
      display_name
    ) values (
      ${connectionId},
      ${tenantId},
      'messenger',
      'audit',
      'SourceAccount invariant audit'
    )
  `);
  await executor.execute(sql`
    insert into source_accounts (
      id,
      tenant_id,
      source_connection_id,
      account_type,
      display_name
    ) values (
      ${accountId},
      ${tenantId},
      ${connectionId},
      'direct_number',
      'SourceAccount invariant audit'
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_account_provisional_keys (
      tenant_id,
      source_account_id,
      source_connection_id,
      declaration_contract_id,
      declaration_contract_version,
      declaration_surface_id,
      connector_session_subject,
      provisional_observed_at,
      created_at
    ) values (
      ${tenantId},
      ${accountId},
      ${connectionId},
      'core:contract',
      'v1',
      'core:surface',
      ${subject},
      ${input.provisionalObservedAt},
      ${input.transitionOccurredAt}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_account_identities (
      tenant_id,
      source_account_id,
      source_connection_id,
      state,
      identity_declaration,
      declaration_contract_id,
      declaration_contract_version,
      declaration_revision,
      declaration_surface_id,
      declaration_loaded_by_trusted_service_id,
      declaration_loaded_at,
      declaration_realm_id,
      declaration_realm_version,
      declaration_canonicalization_version,
      declaration_object_kind_id,
      declaration_scope_kind,
      expected_scope_kind,
      expected_scope_owner_key,
      provisional_connector_session_subject,
      provisional_observed_at,
      account_generation,
      revision,
      created_at,
      updated_at
    ) values (
      ${tenantId},
      ${accountId},
      ${connectionId},
      'provisional',
      ${identityDeclaration}::jsonb,
      'core:contract',
      'v1',
      1,
      'core:surface',
      'core:trusted',
      ${occurredAt},
      'core:realm',
      'v1',
      'v1',
      'core:account',
      'provider',
      'provider',
      'provider',
      ${subject},
      ${input.provisionalObservedAt},
      1,
      1,
      ${input.transitionOccurredAt},
      ${input.transitionOccurredAt}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_account_identity_transitions (
      tenant_id,
      id,
      source_account_id,
      provisional_key_digest_sha256,
      provisional_observed_at,
      intent,
      from_state,
      to_state,
      expected_revision,
      current_revision,
      resulting_revision,
      expected_account_generation,
      current_account_generation,
      resulting_account_generation,
      pinned_declaration_trusted_service_id,
      decision_actor_trusted_service_id,
      decision_policy_id,
      decision_policy_version,
      decision_reason_code_id,
      decision_verification_evidence_token,
      decision_decided_at,
      occurred_at
    )
    select
      ${tenantId},
      ${`source_account_identity_transition:${suffix}-create`},
      ${accountId},
      provisional_key_digest_sha256,
      provisional_observed_at,
      'create_provisional',
      null,
      'provisional',
      null,
      null,
      1,
      null,
      null,
      1,
      'core:trusted',
      'core:trusted',
      'core:policy',
      'v1',
      'core:create',
      'evidence-create',
      ${input.transitionOccurredAt},
      ${input.transitionOccurredAt}
    from inbox_v2_source_account_provisional_keys
    where tenant_id = ${tenantId}
      and source_account_id = ${accountId}
  `);

  return { tenantId, connectionId, accountId, subject };
}

async function insertConflictAttempt(
  executor: SqlExecutor,
  fixture: Fixture,
  input: Readonly<{
    candidateCount: number;
    candidateOrdinal: number;
    candidateRealmId: string;
    conflictTime: string;
    resultTime: string;
    evidenceOnly?: boolean;
  }>
): Promise<void> {
  await executor.execute(sql`
    insert into inbox_v2_source_account_identity_conflicts (
      tenant_id,
      source_account_id,
      identity_revision,
      source_connection_id,
      expected_scope_kind,
      expected_scope_owner_key,
      provisional_connector_session_subject,
      provisional_observed_at,
      declaration_contract_id,
      declaration_contract_version,
      declaration_revision,
      declaration_surface_id,
      declaration_loaded_by_trusted_service_id,
      declaration_loaded_at,
      declaration_realm_id,
      declaration_realm_version,
      declaration_canonicalization_version,
      declaration_object_kind_id,
      declaration_scope_kind,
      candidate_count,
      diagnostic_code_id,
      diagnostic_retryable,
      diagnostic_correlation_token,
      decision_actor_trusted_service_id,
      decision_policy_id,
      decision_policy_version,
      decision_reason_code_id,
      decision_verification_evidence_token,
      decision_decided_at,
      detected_at
    ) values (
      ${fixture.tenantId},
      ${fixture.accountId},
      2,
      ${fixture.connectionId},
      'provider',
      'provider',
      ${fixture.subject},
      ${occurredAt},
      'core:contract',
      'v1',
      1,
      'core:surface',
      'core:trusted',
      ${occurredAt},
      'core:realm',
      'v1',
      'v1',
      'core:account',
      'provider',
      ${input.candidateCount},
      'core:diag',
      false,
      'correlation-conflict',
      'core:trusted',
      'core:policy',
      'v1',
      'core:conflict',
      'evidence-conflict',
      ${input.conflictTime},
      ${input.conflictTime}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_account_identity_conflict_candidates (
      tenant_id,
      source_account_id,
      identity_revision,
      source_connection_id,
      ordinal,
      realm_id,
      realm_version,
      canonicalization_version,
      object_kind_id,
      scope_kind,
      scope_owner_key,
      canonical_external_subject
    ) values (
      ${fixture.tenantId},
      ${fixture.accountId},
      2,
      ${fixture.connectionId},
      ${input.candidateOrdinal},
      ${input.candidateRealmId},
      'v1',
      'v1',
      ${
        input.candidateRealmId === "core:realm"
          ? "core:account"
          : "core:other-object"
      },
      'provider',
      'provider',
      'candidate:one'
    )
  `);
  if (input.evidenceOnly) {
    return;
  }
  await executor.execute(sql`
    update inbox_v2_source_account_identities
       set state = 'conflicted',
           active_conflict_revision = 2,
           account_generation = 2,
           revision = 2,
           updated_at = ${input.resultTime}
     where tenant_id = ${fixture.tenantId}
       and source_account_id = ${fixture.accountId}
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_account_identity_transitions (
      tenant_id,
      id,
      source_account_id,
      provisional_key_digest_sha256,
      provisional_observed_at,
      intent,
      from_state,
      to_state,
      expected_revision,
      current_revision,
      resulting_revision,
      expected_account_generation,
      current_account_generation,
      resulting_account_generation,
      pinned_declaration_trusted_service_id,
      decision_actor_trusted_service_id,
      decision_policy_id,
      decision_policy_version,
      decision_reason_code_id,
      decision_verification_evidence_token,
      decision_decided_at,
      occurred_at
    )
    select
      ${fixture.tenantId},
      ${`source_account_identity_transition:${runId}-conflict-${input.candidateCount}-${input.resultTime.slice(14, 16)}`},
      ${fixture.accountId},
      provisional_key_digest_sha256,
      provisional_observed_at,
      'mark_conflicted',
      'provisional',
      'conflicted',
      1,
      1,
      2,
      1,
      1,
      2,
      'core:trusted',
      'core:trusted',
      'core:policy',
      'v1',
      'core:conflict',
      'evidence-conflict',
      ${input.resultTime},
      ${input.resultTime}
    from inbox_v2_source_account_provisional_keys
    where tenant_id = ${fixture.tenantId}
      and source_account_id = ${fixture.accountId}
  `);
}

async function promoteVerifiedFixture(
  executor: SqlExecutor,
  fixture: Fixture
): Promise<void> {
  const promotedAt = "2026-07-13T18:05:00.000Z";
  const transitionId = `source_account_identity_transition:${runId}-promote-${fixture.subject.slice(-12)}`;

  await executor.execute(sql`
    insert into inbox_v2_source_account_identity_transitions (
      tenant_id, id, source_account_id, provisional_key_digest_sha256,
      provisional_observed_at,
      intent, from_state, to_state,
      expected_revision, current_revision, resulting_revision,
      expected_account_generation, current_account_generation,
      resulting_account_generation, pinned_declaration_trusted_service_id,
      decision_actor_trusted_service_id, decision_policy_id,
      decision_policy_version, decision_reason_code_id,
      decision_verification_evidence_token, decision_decided_at, occurred_at
    )
    select ${fixture.tenantId}, ${transitionId}, ${fixture.accountId},
           provisional_key_digest_sha256, provisional_observed_at,
           'promote_verified',
           'provisional', 'verified', 1, 1, 2, 1, 1, 2,
           'core:trusted', 'core:trusted', 'core:policy', 'v1',
           'core:promote', 'evidence-promote', ${promotedAt}, ${promotedAt}
      from inbox_v2_source_account_provisional_keys
     where tenant_id = ${fixture.tenantId}
       and source_account_id = ${fixture.accountId}
       and connector_session_subject = ${fixture.subject}
  `);
  await insertVerifiedSnapshot(executor, fixture, {
    transitionId,
    revision: 2,
    reason: "core:promote",
    evidence: "evidence-promote",
    verifiedAt: promotedAt
  });
  await insertVerifiedAlias(executor, fixture, {
    aliasId: `source_account_identity_alias:${runId}-promote-${fixture.subject.slice(-12)}`,
    subject: fixture.subject,
    observedAt: occurredAt,
    revision: 2,
    reason: "core:promote",
    evidence: "evidence-promote",
    createdAt: promotedAt
  });
  await executor.execute(sql`
    update inbox_v2_source_account_identities
       set state = 'verified',
           expected_scope_kind = null,
           expected_scope_source_connection_id = null,
           expected_scope_owner_key = null,
           provisional_connector_session_subject = null,
           provisional_observed_at = null,
           canonical_realm_id = 'core:realm',
           canonical_realm_version = 'v1',
           canonicalization_version = 'v1',
           canonical_object_kind_id = 'core:account',
           canonical_scope_kind = 'provider',
           canonical_scope_source_connection_id = null,
           canonical_scope_owner_key = 'provider',
           canonical_external_subject = 'provider:account-42',
           verified_decision_actor_trusted_service_id = 'core:trusted',
           verified_decision_policy_id = 'core:policy',
           verified_decision_policy_version = 'v1',
           verified_decision_reason_code_id = 'core:promote',
           verified_decision_verification_evidence_token = 'evidence-promote',
           verified_decision_decided_at = ${promotedAt},
           account_generation = 2,
           revision = 2,
           updated_at = ${promotedAt}
     where tenant_id = ${fixture.tenantId}
       and source_account_id = ${fixture.accountId}
  `);
}

async function reauthenticateVerifiedFixture(
  executor: SqlExecutor,
  fixture: Fixture
): Promise<void> {
  const reauthenticatedAt = "2026-07-13T18:08:00.000Z";
  const subject = `${fixture.subject}:reauth`;
  const transitionId = `source_account_identity_transition:${runId}-reauth-${fixture.subject.slice(-12)}`;

  await executor.execute(sql`
    insert into inbox_v2_source_account_provisional_keys (
      tenant_id, source_account_id, source_connection_id,
      declaration_contract_id, declaration_contract_version,
      declaration_surface_id, connector_session_subject,
      provisional_observed_at, created_at
    ) values (
      ${fixture.tenantId}, ${fixture.accountId}, ${fixture.connectionId},
      'core:contract', 'v1', 'core:surface', ${subject},
      ${reauthenticatedAt}, ${reauthenticatedAt}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_account_identity_transitions (
      tenant_id, id, source_account_id, provisional_key_digest_sha256,
      provisional_observed_at,
      intent, from_state, to_state,
      expected_revision, current_revision, resulting_revision,
      expected_account_generation, current_account_generation,
      resulting_account_generation, pinned_declaration_trusted_service_id,
      decision_actor_trusted_service_id, decision_policy_id,
      decision_policy_version, decision_reason_code_id,
      decision_verification_evidence_token, decision_decided_at, occurred_at
    )
    select ${fixture.tenantId}, ${transitionId}, ${fixture.accountId},
           provisional_key_digest_sha256, provisional_observed_at,
           'reauthenticate_verified',
           'verified', 'verified', 2, 2, 3, 2, 2, 3,
           'core:trusted', 'core:trusted', 'core:policy', 'v1',
           'core:reauth', 'evidence-reauth', ${reauthenticatedAt},
           ${reauthenticatedAt}
      from inbox_v2_source_account_provisional_keys
     where tenant_id = ${fixture.tenantId}
       and source_account_id = ${fixture.accountId}
       and connector_session_subject = ${subject}
  `);
  await insertVerifiedSnapshot(executor, fixture, {
    transitionId,
    revision: 3,
    reason: "core:reauth",
    evidence: "evidence-reauth",
    verifiedAt: reauthenticatedAt
  });
  await insertVerifiedAlias(executor, fixture, {
    aliasId: `source_account_identity_alias:${runId}-reauth-${fixture.subject.slice(-12)}`,
    subject,
    observedAt: reauthenticatedAt,
    revision: 3,
    reason: "core:reauth",
    evidence: "evidence-reauth",
    createdAt: reauthenticatedAt
  });
  await executor.execute(sql`
    update inbox_v2_source_account_identities
       set verified_decision_reason_code_id = 'core:reauth',
           verified_decision_verification_evidence_token = 'evidence-reauth',
           verified_decision_decided_at = ${reauthenticatedAt},
           account_generation = 3,
           revision = 3,
           updated_at = ${reauthenticatedAt}
     where tenant_id = ${fixture.tenantId}
       and source_account_id = ${fixture.accountId}
  `);
}

async function insertVerifiedSnapshot(
  executor: SqlExecutor,
  fixture: Fixture,
  input: Readonly<{
    transitionId: string;
    revision: number;
    reason: string;
    evidence: string;
    verifiedAt: string;
  }>
): Promise<void> {
  await executor.execute(sql`
    insert into inbox_v2_source_account_identity_verified_snapshots (
      tenant_id, source_account_id, source_connection_id, transition_id,
      identity_revision, account_generation, state,
      identity_declaration, declaration_contract_id,
      declaration_contract_version, declaration_revision,
      declaration_surface_id, declaration_loaded_by_trusted_service_id,
      declaration_loaded_at, declaration_realm_id,
      declaration_realm_version, declaration_canonicalization_version,
      declaration_object_kind_id, declaration_scope_kind,
      canonical_realm_id, canonical_realm_version, canonicalization_version,
      canonical_object_kind_id, canonical_scope_kind,
      canonical_scope_owner_key, canonical_external_subject,
      verified_decision_actor_trusted_service_id,
      verified_decision_policy_id, verified_decision_policy_version,
      verified_decision_reason_code_id,
      verified_decision_verification_evidence_token,
      verified_decision_decided_at, identity_created_at, verified_at
    ) values (
      ${fixture.tenantId}, ${fixture.accountId}, ${fixture.connectionId},
      ${input.transitionId}, ${input.revision}, ${input.revision}, 'verified',
      ${identityDeclaration}::jsonb, 'core:contract', 'v1', 1,
      'core:surface', 'core:trusted', ${occurredAt}, 'core:realm', 'v1',
      'v1', 'core:account', 'provider', 'core:realm', 'v1', 'v1',
      'core:account', 'provider', 'provider', 'provider:account-42',
      'core:trusted', 'core:policy', 'v1', ${input.reason}, ${input.evidence},
      ${input.verifiedAt}, ${occurredAt}, ${input.verifiedAt}
    )
  `);
}

async function insertVerifiedAlias(
  executor: SqlExecutor,
  fixture: Fixture,
  input: Readonly<{
    aliasId: string;
    subject: string;
    observedAt: string;
    revision: number;
    reason: string;
    evidence: string;
    createdAt: string;
  }>
): Promise<void> {
  await executor.execute(sql`
    insert into inbox_v2_source_account_identity_aliases (
      tenant_id, id, provisional_source_connection_id,
      provisional_connector_session_subject, provisional_observed_at,
      canonical_source_account_id, canonical_realm_id,
      canonical_realm_version, canonicalization_version,
      canonical_object_kind_id, canonical_scope_kind,
      canonical_scope_owner_key, canonical_external_subject,
      identity_declaration, declaration_contract_id,
      declaration_contract_version, declaration_revision,
      declaration_surface_id, declaration_loaded_by_trusted_service_id,
      declaration_loaded_at, declaration_realm_id,
      declaration_realm_version, declaration_canonicalization_version,
      declaration_object_kind_id, declaration_scope_kind,
      expected_account_identity_revision, expected_account_generation,
      target_identity_state, decision_actor_trusted_service_id,
      decision_policy_id, decision_policy_version, decision_reason_code_id,
      decision_verification_evidence_token, decision_decided_at,
      revision, created_at
    ) values (
      ${fixture.tenantId}, ${input.aliasId}, ${fixture.connectionId},
      ${input.subject}, ${input.observedAt}, ${fixture.accountId},
      'core:realm', 'v1', 'v1', 'core:account', 'provider', 'provider',
      'provider:account-42', ${identityDeclaration}::jsonb, 'core:contract',
      'v1', 1, 'core:surface', 'core:trusted', ${occurredAt}, 'core:realm',
      'v1', 'v1', 'core:account', 'provider', ${input.revision},
      ${input.revision}, 'verified', 'core:trusted', 'core:policy', 'v1',
      ${input.reason}, ${input.evidence}, ${input.createdAt}, 1,
      ${input.createdAt}
    )
  `);
}
