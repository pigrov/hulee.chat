import {
  inboxV2SchemaVersionTokenSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceIdentityRealmIdSchema,
  inboxV2TenantIdSchema,
  type InboxV2SourceExternalIdentity
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2SourceExternalIdentityRepository,
  type FindOrCreateInboxV2SourceExternalIdentityInput,
  type InboxV2SourceExternalIdentityTransactionExecutor
} from "./sql-inbox-v2-source-external-identity-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantA = inboxV2TenantIdSchema.parse(`tenant:db002a-a-${runId}`);
const tenantB = inboxV2TenantIdSchema.parse(`tenant:db002a-b-${runId}`);
const connectionA = inboxV2SourceConnectionIdSchema.parse(
  `source_connection:db002a-a-${runId}`
);
const connectionB = inboxV2SourceConnectionIdSchema.parse(
  `source_connection:db002a-b-${runId}`
);
const connectionA2 = inboxV2SourceConnectionIdSchema.parse(
  `source_connection:db002a-a2-${runId}`
);
const accountA = inboxV2SourceAccountIdSchema.parse(
  `source_account:db002a-a-${runId}`
);
const accountB = inboxV2SourceAccountIdSchema.parse(
  `source_account:db002a-b-${runId}`
);
const accountA2 = inboxV2SourceAccountIdSchema.parse(
  `source_account:db002a-a2-${runId}`
);
const rawEventA = `raw_inbound_event:db002a-a-${runId}`;
const rawEventA2 = `raw_inbound_event:db002a-a2-${runId}`;
const normalizedEventA = `normalized_inbound_event:db002a-a-${runId}`;
const authAccountId = `account:db002a-${runId}`;
const authExternalIdentityLinkId = `auth_external_identity_link:db002a-${runId}`;
const t0 = "2026-07-13T10:00:00.000Z";
const realm = {
  realmId: inboxV2SourceIdentityRealmIdSchema.parse(
    "module:telegram-user-session:mtproto-user"
  ),
  version: inboxV2SchemaVersionTokenSchema.parse("v1"),
  canonicalizationVersion: inboxV2SchemaVersionTokenSchema.parse("v1")
};
const objectKindId = "module:telegram-user-session:provider-user" as const;
const adapterContract = {
  contractId: "module:telegram-user-session:identity-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:telegram-user-session:mtproto",
  loadedByTrustedServiceId: "core:inbox-worker",
  loadedAt: t0
} as const;

describePostgres(
  "SQL Inbox V2 SourceExternalIdentity repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      db = createHuleeDatabase();
      await db.execute(sql`
        insert into tenants (id, slug, display_name, deployment_type)
        values
          (${tenantA}, ${`db002a-a-${runId}`}, 'DB002-A tenant A', 'saas_shared'),
          (${tenantB}, ${`db002a-b-${runId}`}, 'DB002-A tenant B', 'saas_shared')
      `);
      await db.execute(sql`
        insert into source_connections (
          id,
          tenant_id,
          source_type,
          source_name,
          display_name
        )
        values
          (${connectionA}, ${tenantA}, 'messenger', 'telegram', 'DB002-A connection A'),
          (${connectionA2}, ${tenantA}, 'messenger', 'telegram', 'DB002-A connection A2'),
          (${connectionB}, ${tenantB}, 'messenger', 'telegram', 'DB002-A connection B')
      `);
      await db.execute(sql`
        insert into source_accounts (
          id,
          tenant_id,
          source_connection_id,
          account_type,
          display_name
        )
        values
          (${accountA}, ${tenantA}, ${connectionA}, 'direct_number', 'DB002-A account A'),
          (${accountA2}, ${tenantA}, ${connectionA2}, 'direct_number', 'DB002-A account A2'),
          (${accountB}, ${tenantB}, ${connectionB}, 'direct_number', 'DB002-A account B')
      `);
      await db.execute(sql`
        insert into raw_inbound_events (
          id,
          tenant_id,
          source_connection_id,
          source_account_id,
          idempotency_key,
          payload
        )
        values
          (${rawEventA}, ${tenantA}, ${connectionA}, ${accountA}, ${`db002a-raw-a-${runId}`}, '{}'::jsonb),
          (${rawEventA2}, ${tenantA}, ${connectionA2}, ${accountA2}, ${`db002a-raw-a2-${runId}`}, '{}'::jsonb)
      `);
      await db.execute(sql`
        insert into normalized_inbound_events (
          id,
          tenant_id,
          raw_event_id,
          source_connection_id,
          source_account_id,
          source_type,
          source_name,
          event_type,
          direction,
          idempotency_key
        )
        values (
          ${normalizedEventA},
          ${tenantA},
          ${rawEventA},
          ${connectionA},
          ${accountA},
          'messenger',
          'telegram',
          'message',
          'inbound',
          ${`db002a-normalized-a-${runId}`}
        )
      `);
      await db.execute(sql`
        insert into accounts (id, tenant_id, email)
        values (${authAccountId}, ${tenantA}, ${`db002a-${runId}@example.test`})
      `);
      await db.execute(sql`
        insert into external_identity_links (
          id,
          tenant_id,
          account_id,
          provider_id,
          external_subject,
          display_name
        )
        values (
          ${authExternalIdentityLinkId},
          ${tenantA},
          ${authAccountId},
          'telegram',
          'AuthProviderUserABC',
          'Auth identity sentinel'
        )
      `);
    });

    afterAll(async () => {
      if (!db) {
        return;
      }

      await db.execute(sql`
        delete from inbox_v2_source_external_identities
        where tenant_id in (${tenantA}, ${tenantB})
      `);
      await db.execute(sql`
        delete from external_identity_links
        where id = ${authExternalIdentityLinkId}
      `);
      await db.execute(sql`
        delete from normalized_inbound_events
        where id = ${normalizedEventA}
      `);
      await db.execute(sql`
        delete from raw_inbound_events
        where id in (${rawEventA}, ${rawEventA2})
      `);
      await db.execute(sql`
        delete from source_accounts
        where id in (${accountA}, ${accountA2}, ${accountB})
      `);
      await db.execute(sql`
        delete from source_connections
        where id in (${connectionA}, ${connectionA2}, ${connectionB})
      `);
      await db.execute(sql`
        delete from accounts
        where id = ${authAccountId}
      `);
      await db.execute(sql`
        delete from tenants
        where id in (${tenantA}, ${tenantB})
      `);
      await closeHuleeDatabase(db);
    });

    it("keeps the same opaque identity ID tenant-scoped", async () => {
      const repository = createSqlInboxV2SourceExternalIdentityRepository(db);
      const id = identity("same-opaque-id");

      const [createdA, createdB] = await Promise.all([
        repository.findOrCreate(
          createInput(tenantA, id, "tenant-shared-subject")
        ),
        repository.findOrCreate(
          createInput(tenantB, id, "tenant-shared-subject")
        )
      ]);

      expect(createdA.kind).toBe("created");
      expect(createdB.kind).toBe("created");
      expect(
        (await repository.findById({ tenantId: tenantA, id }))?.tenantId
      ).toBe(tenantA);
      expect(
        (await repository.findById({ tenantId: tenantB, id }))?.tenantId
      ).toBe(tenantB);
    });

    it("keeps retry authority one-shot while rejecting immutable adapter declaration drift", async () => {
      const repository = createSqlInboxV2SourceExternalIdentityRepository(db);
      const id = identity("declaration-coherence");
      const initialInput = createInput(
        tenantA,
        id,
        "declaration-coherence-subject"
      );
      const retryAt = "2026-07-13T10:01:00.000Z";

      const created = await repository.findOrCreate(initialInput);
      const retry = await repository.findOrCreate({
        ...initialInput,
        materializationAuthority: {
          ...initialInput.materializationAuthority,
          authorizationToken: `materialize-retry-${runId}`,
          authorizedAt: retryAt
        },
        materializedAt: retryAt,
        createdAt: retryAt
      });
      const declarationConflict = await repository.findOrCreate({
        ...initialInput,
        identityDeclaration: {
          ...initialInput.identityDeclaration,
          adapterContract: {
            ...initialInput.identityDeclaration.adapterContract,
            declarationRevision: "2" as never
          }
        }
      });
      const persisted = await db.execute<{
        identity_declaration: Record<string, unknown>;
        declaration_contract_id: string;
        declaration_contract_version: string;
        declaration_revision: string;
        declaration_surface_id: string;
        declaration_loaded_by_trusted_service_id: string;
        declaration_loaded_at: unknown;
        materialized_by_trusted_service_id: string;
        materialization_authorization_token: string;
        materialized_at: unknown;
      }>(sql`
        select
          identity_declaration,
          declaration_contract_id,
          declaration_contract_version,
          declaration_revision::text as declaration_revision,
          declaration_surface_id,
          declaration_loaded_by_trusted_service_id,
          declaration_loaded_at,
          materialized_by_trusted_service_id,
          materialization_authorization_token,
          materialized_at
        from inbox_v2_source_external_identities
        where tenant_id = ${tenantA} and id = ${id}
      `);

      expect(created.kind).toBe("created");
      expect(retry).toMatchObject({
        kind: "already_exists",
        record: { id, createdAt: t0 }
      });
      expect(declarationConflict).toMatchObject({
        kind: "declaration_conflict",
        record: { id }
      });
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]).toMatchObject({
        identity_declaration: initialInput.identityDeclaration,
        declaration_contract_id: adapterContract.contractId,
        declaration_contract_version: adapterContract.contractVersion,
        declaration_revision: adapterContract.declarationRevision,
        declaration_surface_id: adapterContract.surfaceId,
        declaration_loaded_by_trusted_service_id:
          adapterContract.loadedByTrustedServiceId,
        materialized_by_trusted_service_id:
          adapterContract.loadedByTrustedServiceId,
        materialization_authorization_token:
          initialInput.materializationAuthority.authorizationToken
      });
      expect(databaseTimestamp(persisted.rows[0]?.declaration_loaded_at)).toBe(
        t0
      );
      expect(databaseTimestamp(persisted.rows[0]?.materialized_at)).toBe(t0);
    });

    it("rejects incoherent same-tenant account, connection, and raw-event graphs", async () => {
      await expect(
        db.execute(sql`
          insert into raw_inbound_events (
            id,
            tenant_id,
            source_connection_id,
            source_account_id,
            idempotency_key,
            payload
          )
          values (
            ${`raw_inbound_event:incoherent-${runId}`},
            ${tenantA},
            ${connectionA2},
            ${accountA},
            ${`db002a-incoherent-raw-${runId}`},
            '{}'::jsonb
          )
        `)
      ).rejects.toThrow();

      await expect(
        db.execute(sql`
          insert into normalized_inbound_events (
            id,
            tenant_id,
            raw_event_id,
            source_connection_id,
            source_account_id,
            source_type,
            source_name,
            event_type,
            direction,
            idempotency_key
          )
          values (
            ${`normalized_inbound_event:incoherent-${runId}`},
            ${tenantA},
            ${rawEventA},
            ${connectionA2},
            ${accountA2},
            'messenger',
            'telegram',
            'message',
            'inbound',
            ${`db002a-incoherent-normalized-${runId}`}
          )
        `)
      ).rejects.toThrow();

      await expect(
        db.execute(sql`
          insert into normalized_inbound_events (
            id,
            tenant_id,
            raw_event_id,
            source_connection_id,
            source_account_id,
            source_type,
            source_name,
            event_type,
            direction,
            idempotency_key
          )
          values (
            ${`normalized_inbound_event:lost-account-${runId}`},
            ${tenantA},
            ${rawEventA},
            ${connectionA},
            null,
            'messenger',
            'telegram',
            'message',
            'inbound',
            ${`db002a-lost-account-normalized-${runId}`}
          )
        `)
      ).rejects.toThrow();
    });

    it("does not alias or mutate authentication external identity links", async () => {
      const repository = createSqlInboxV2SourceExternalIdentityRepository(db);
      const before = await loadAuthIdentitySentinel(db);

      const result = await repository.findOrCreate(
        createInput(tenantA, identity("auth-boundary"), "AuthProviderUserABC")
      );
      const after = await loadAuthIdentitySentinel(db);
      const sourceCount = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_source_external_identities
        where tenant_id = ${tenantA}
          and canonical_external_subject = 'AuthProviderUserABC'
      `);

      expect(result.kind).toBe("created");
      expect(before.rows).toEqual([
        {
          id: authExternalIdentityLinkId,
          tenant_id: tenantA,
          account_id: authAccountId,
          provider_id: "telegram",
          external_subject: "AuthProviderUserABC",
          display_name: "Auth identity sentinel"
        }
      ]);
      expect(after.rows).toEqual(before.rows);
      expect(sourceCount.rows).toEqual([{ count: "1" }]);
    });

    it("preserves provider subject case and separates provider, connection, and account scopes", async () => {
      const repository = createSqlInboxV2SourceExternalIdentityRepository(db);
      const upper = await repository.findOrCreate(
        createInput(tenantA, identity("case-upper"), "ProviderUserABC")
      );
      const lower = await repository.findOrCreate(
        createInput(tenantA, identity("case-lower"), "provideruserabc")
      );
      const scopedSubject = "same-subject-different-scopes";
      const providerScoped = await repository.findOrCreate(
        createInput(tenantA, identity("scope-provider"), scopedSubject)
      );
      const connectionScoped = await repository.findOrCreate(
        createInput(
          tenantA,
          identity("scope-connection"),
          scopedSubject,
          connectionScope(tenantA, connectionA)
        )
      );
      const accountScoped = await repository.findOrCreate(
        createInput(
          tenantA,
          identity("scope-account"),
          scopedSubject,
          accountScope(tenantA, accountA)
        )
      );

      expect([upper.kind, lower.kind]).toEqual(["created", "created"]);
      expect(upper.record.canonicalExternalSubject).toBe("ProviderUserABC");
      expect(lower.record.canonicalExternalSubject).toBe("provideruserabc");
      expect([
        providerScoped.kind,
        connectionScoped.kind,
        accountScoped.kind
      ]).toEqual(["created", "created", "created"]);
      expect(connectionScoped.record.scope).toEqual(
        connectionScope(tenantA, connectionA)
      );
      expect(accountScoped.record.scope).toEqual(
        accountScope(tenantA, accountA)
      );
    });

    it("persists contract-valid wide exact keys through the bounded digest authority", async () => {
      const repository = createSqlInboxV2SourceExternalIdentityRepository(db);
      const subject = `${"Я".repeat(500)}\\x41`;
      const wideRealm = {
        ...realm,
        version: inboxV2SchemaVersionTokenSchema.parse(`v${"9".repeat(4_000)}`)
      };
      const wideInput = createInput(tenantA, identity("wide-key"), subject);
      const wideConflictInput = createInput(
        tenantA,
        identity("wide-key-conflict"),
        subject
      );
      const result = await repository.findOrCreate({
        ...wideInput,
        realm: wideRealm,
        identityDeclaration: {
          ...wideInput.identityDeclaration,
          realmVersion: wideRealm.version
        }
      });
      const exactConflict = await repository.findOrCreate({
        ...wideConflictInput,
        realm: wideRealm,
        identityDeclaration: {
          ...wideConflictInput.identityDeclaration,
          realmVersion: wideRealm.version
        }
      });

      expect(result.kind).toBe("created");
      expect(result.record.realm.version).toHaveLength(4_001);
      expect(exactConflict).toMatchObject({
        kind: "scoped_key_conflict",
        record: { id: result.record.id }
      });
    });

    it("isolates ephemeral identities by exact observation and enforces evidence scope coherence", async () => {
      const repository = createSqlInboxV2SourceExternalIdentityRepository(db);
      const ephemeral = (
        id: ReturnType<typeof identity>,
        observationId: string,
        observationKey: string,
        scope: InboxV2SourceExternalIdentity["scope"]
      ): FindOrCreateInboxV2SourceExternalIdentityInput => ({
        ...createInput(tenantA, id, "WeakRosterLabel", scope),
        stability: {
          kind: "observation_ephemeral",
          observation: {
            tenantId: tenantA,
            kind: "raw_inbound_event",
            id: observationId as never
          },
          observationKey
        }
      });

      const first = await repository.findOrCreate(
        ephemeral(identity("ephemeral-a"), rawEventA, "member:1", {
          kind: "provider"
        })
      );
      const otherObservation = await repository.findOrCreate(
        ephemeral(identity("ephemeral-b"), rawEventA2, "member:1", {
          kind: "provider"
        })
      );
      const otherMember = await repository.findOrCreate(
        ephemeral(identity("ephemeral-c"), rawEventA, "member:2", {
          kind: "provider"
        })
      );
      const normalized = await repository.findOrCreate({
        ...createInput(
          tenantA,
          identity("ephemeral-normalized"),
          "WeakRosterLabel",
          accountScope(tenantA, accountA)
        ),
        stability: {
          kind: "observation_ephemeral",
          observation: {
            tenantId: tenantA,
            kind: "normalized_inbound_event",
            id: normalizedEventA as never
          },
          observationKey: "member:normalized:1"
        }
      });
      const exactConflict = await repository.findOrCreate(
        ephemeral(identity("ephemeral-d"), rawEventA, "member:1", {
          kind: "provider"
        })
      );

      expect([
        first.kind,
        otherObservation.kind,
        otherMember.kind,
        normalized.kind
      ]).toEqual(["created", "created", "created", "created"]);
      expect(exactConflict).toMatchObject({
        kind: "scoped_key_conflict",
        record: { id: first.record.id }
      });

      await expect(
        repository.findOrCreate(
          ephemeral(
            identity("wrong-account-evidence"),
            rawEventA2,
            "member:3",
            accountScope(tenantA, accountA)
          )
        )
      ).rejects.toThrow();
      await expect(
        repository.findOrCreate(
          ephemeral(
            identity("wrong-connection-evidence"),
            rawEventA2,
            "member:4",
            connectionScope(tenantA, connectionA)
          )
        )
      ).rejects.toThrow();
    });

    it("rejects cross-tenant connection and account scope owners at the composite foreign keys", async () => {
      await expect(
        db.execute(
          buildDirectIdentityInsert({
            tenantId: tenantA,
            id: identity("cross-tenant-connection"),
            scopeKind: "source_connection",
            sourceConnectionId: connectionB,
            subject: "cross-tenant-connection"
          })
        )
      ).rejects.toThrow();

      await expect(
        db.execute(
          buildDirectIdentityInsert({
            tenantId: tenantA,
            id: identity("cross-tenant-account"),
            scopeKind: "source_account",
            sourceAccountId: accountB,
            subject: "cross-tenant-account"
          })
        )
      ).rejects.toThrow();
    });

    it("enforces ID, scope, stability, opaque-subject, and finite-clock DDL checks", async () => {
      const invalidInserts = [
        buildDirectIdentityInsert({
          tenantId: tenantA,
          id: `invalid-source-identity-${runId}`,
          subject: "invalid-id"
        }),
        buildDirectIdentityInsert({
          tenantId: tenantA,
          id: identity("invalid-scope"),
          scopeKind: "provider",
          sourceConnectionId: connectionA,
          subject: "invalid-scope"
        }),
        buildDirectIdentityInsert({
          tenantId: tenantA,
          id: identity("invalid-stability"),
          subject: "invalid-stability",
          stabilityKind: "stable",
          observationKey: "unexpected-observation"
        }),
        buildDirectIdentityInsert({
          tenantId: tenantA,
          id: identity("invalid-control"),
          subject: "subject\nwith-control"
        }),
        buildDirectIdentityInsert({
          tenantId: tenantA,
          id: identity("invalid-infinity"),
          subject: "invalid-infinity",
          createdAt: "infinity",
          updatedAt: "infinity"
        })
      ];

      for (const query of invalidInserts) {
        await expect(db.execute(query)).rejects.toThrow();
      }
    });

    it("rejects forged declaration/materialization DML and immutable proof mutation", async () => {
      const invalidInserts = [
        buildDirectIdentityInsert({
          tenantId: tenantA,
          id: identity("provider-safe-default"),
          subject: "provider-safe-default",
          declarationDecisionStrength: "safe_default"
        }),
        buildDirectIdentityInsert({
          tenantId: tenantA,
          id: identity("declaration-surface-mismatch"),
          subject: "declaration-surface-mismatch",
          declarationSurfaceId: "module:telegram-user-session:other-surface"
        }),
        buildDirectIdentityInsert({
          tenantId: tenantA,
          id: identity("materializer-service-mismatch"),
          subject: "materializer-service-mismatch",
          materializedByTrustedServiceId: "core:other-inbox-worker"
        }),
        buildDirectIdentityInsert({
          tenantId: tenantA,
          id: identity("materialization-time-mismatch"),
          subject: "materialization-time-mismatch",
          materializedAt: "2026-07-13T10:01:00.000Z"
        })
      ];

      for (const query of invalidInserts) {
        await expect(db.execute(query)).rejects.toThrow();
      }

      const repository = createSqlInboxV2SourceExternalIdentityRepository(db);
      const id = identity("immutable-declaration-proof");
      expect(
        (
          await repository.findOrCreate(
            createInput(tenantA, id, "immutable-declaration-proof")
          )
        ).kind
      ).toBe("created");

      await expect(
        db.execute(sql`
          update inbox_v2_source_external_identities
          set
            identity_declaration = jsonb_set(
              identity_declaration,
              '{adapterContract,declarationRevision}',
              '"2"'::jsonb
            ),
            declaration_revision = 2,
            revision = revision + 1,
            updated_at = updated_at + interval '1 second'
          where tenant_id = ${tenantA} and id = ${id}
        `)
      ).rejects.toThrow();

      const unchanged = await repository.findById({ tenantId: tenantA, id });
      expect(unchanged).toMatchObject({
        id,
        revision: "1",
        identityDeclaration: {
          adapterContract: { declarationRevision: "1" }
        }
      });
    });

    it("returns exactly one created winner and one scoped-key conflict under concurrency", async () => {
      const repository = createSqlInboxV2SourceExternalIdentityRepository(db);
      const subject = `concurrent-subject-${runId}`;
      const results = await Promise.all([
        repository.findOrCreate(
          createInput(tenantA, identity("concurrent-a"), subject)
        ),
        repository.findOrCreate(
          createInput(tenantA, identity("concurrent-b"), subject)
        )
      ]);
      const winner = results.find((result) => result.kind === "created");
      const conflict = results.find(
        (result) => result.kind === "scoped_key_conflict"
      );
      const identityCount = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_source_external_identities
        where tenant_id = ${tenantA}
          and realm_id = ${realm.realmId}
          and realm_version = ${realm.version}
          and canonicalization_version = ${realm.canonicalizationVersion}
          and scope_kind = 'provider'
          and canonical_external_subject = ${subject}
      `);
      const headCount = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_source_identity_claim_heads h
        join inbox_v2_source_external_identities i
          on i.tenant_id = h.tenant_id
         and i.id = h.source_external_identity_id
        where i.tenant_id = ${tenantA}
          and i.canonical_external_subject = ${subject}
      `);

      expect(winner?.kind).toBe("created");
      expect(conflict?.kind).toBe("scoped_key_conflict");
      if (winner?.kind !== "created" || conflict === undefined) {
        throw new Error(
          "Expected one created winner and one scoped-key loser."
        );
      }
      expect(conflict.record.id).toBe(winner.record.id);
      expect(identityCount.rows).toEqual([{ count: "1" }]);
      expect(headCount.rows).toEqual([{ count: "1" }]);
    });

    it("rolls the identity insert back if mandatory head creation fails", async () => {
      const id = identity("head-rollback");
      const failingRepository =
        createSqlInboxV2SourceExternalIdentityRepository(
          failSecondStatementInEachTransaction(db)
        );

      await expect(
        failingRepository.findOrCreate(
          createInput(tenantA, id, "head-rollback-subject")
        )
      ).rejects.toThrow("forced identity-head insert failure");

      const repository = createSqlInboxV2SourceExternalIdentityRepository(db);
      expect(await repository.findById({ tenantId: tenantA, id })).toBeNull();

      const counts = await db.execute<{
        identities: string;
        heads: string;
      }>(sql`
        select
          (
            select count(*)::text
            from inbox_v2_source_external_identities
            where tenant_id = ${tenantA} and id = ${id}
          ) as identities,
          (
            select count(*)::text
            from inbox_v2_source_identity_claim_heads
            where tenant_id = ${tenantA}
              and source_external_identity_id = ${id}
          ) as heads
      `);
      expect(counts.rows).toEqual([{ identities: "0", heads: "0" }]);

      const retry = await repository.findOrCreate(
        createInput(tenantA, id, "head-rollback-subject")
      );
      expect(retry.kind).toBe("created");
    });
  }
);

function createInput(
  tenantId: typeof tenantA,
  id: ReturnType<typeof identity>,
  canonicalExternalSubject: string,
  scope: InboxV2SourceExternalIdentity["scope"] = { kind: "provider" }
): FindOrCreateInboxV2SourceExternalIdentityInput {
  return {
    tenantId,
    id,
    realm,
    objectKindId: objectKindId as never,
    scope,
    identityDeclaration: {
      adapterContract,
      identityKind: "source_external_identity",
      realmId: realm.realmId,
      realmVersion: realm.version,
      canonicalizationVersion: realm.canonicalizationVersion,
      objectKindId,
      scopeKind: scope.kind,
      decisionStrength:
        scope.kind === "source_account" ? "safe_default" : "authoritative"
    } as never,
    materializationAuthority: {
      kind: "trusted_service",
      tenantId,
      trustedServiceId: adapterContract.loadedByTrustedServiceId,
      authorizationToken: `materialize-${String(id).slice(-12)}`,
      authorizedAt: t0
    } as never,
    materializedAt: t0,
    canonicalExternalSubject,
    stability: { kind: "stable" },
    createdAt: t0
  };
}

function identity(label: string) {
  return inboxV2SourceExternalIdentityIdSchema.parse(
    `source_external_identity:db002a-${label}-${runId}`
  );
}

function connectionScope(
  tenantId: typeof tenantA,
  id: typeof connectionA
): InboxV2SourceExternalIdentity["scope"] {
  return {
    kind: "source_connection",
    owner: { tenantId, kind: "source_connection", id }
  };
}

function accountScope(
  tenantId: typeof tenantA,
  id: typeof accountA
): InboxV2SourceExternalIdentity["scope"] {
  return {
    kind: "source_account",
    owner: { tenantId, kind: "source_account", id }
  };
}

type DirectIdentityInsert = Readonly<{
  tenantId: string;
  id: string;
  subject: string;
  scopeKind?: "provider" | "source_connection" | "source_account";
  sourceConnectionId?: string | null;
  sourceAccountId?: string | null;
  stabilityKind?: "stable" | "observation_ephemeral";
  observationKey?: string | null;
  declarationDecisionStrength?: "authoritative" | "safe_default";
  declarationSurfaceId?: string;
  materializedByTrustedServiceId?: string;
  materializedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}>;

function buildDirectIdentityInsert(input: DirectIdentityInsert): SQL {
  const scopeKind = input.scopeKind ?? "provider";
  const identityDeclaration = {
    adapterContract: {
      ...adapterContract,
      surfaceId: input.declarationSurfaceId ?? adapterContract.surfaceId
    },
    identityKind: "source_external_identity",
    realmId: realm.realmId,
    realmVersion: realm.version,
    canonicalizationVersion: realm.canonicalizationVersion,
    objectKindId,
    scopeKind,
    decisionStrength:
      input.declarationDecisionStrength ??
      (scopeKind === "source_account" ? "safe_default" : "authoritative")
  } as const;
  const materializedAt = input.materializedAt ?? input.createdAt ?? t0;
  return sql`
    insert into inbox_v2_source_external_identities (
      tenant_id,
      id,
      realm_id,
      realm_version,
      canonicalization_version,
      object_kind_id,
      scope_kind,
      scope_source_connection_id,
      scope_source_account_id,
      identity_declaration,
      declaration_contract_id,
      declaration_contract_version,
      declaration_revision,
      declaration_surface_id,
      declaration_loaded_by_trusted_service_id,
      declaration_loaded_at,
      materialized_by_trusted_service_id,
      materialization_authorization_token,
      materialized_at,
      canonical_external_subject,
      stability_kind,
      ephemeral_observation_key,
      revision,
      created_at,
      updated_at
    )
    values (
      ${input.tenantId},
      ${input.id},
      ${realm.realmId},
      ${realm.version},
      ${realm.canonicalizationVersion},
      ${objectKindId},
      ${scopeKind},
      ${input.sourceConnectionId ?? null},
      ${input.sourceAccountId ?? null},
      ${identityDeclaration},
      ${adapterContract.contractId},
      ${adapterContract.contractVersion},
      ${adapterContract.declarationRevision},
      ${adapterContract.surfaceId},
      ${
        input.materializedByTrustedServiceId ??
        adapterContract.loadedByTrustedServiceId
      },
      ${adapterContract.loadedAt},
      ${adapterContract.loadedByTrustedServiceId},
      ${`direct-${String(input.id).slice(-12)}`},
      ${materializedAt},
      ${input.subject},
      ${input.stabilityKind ?? "stable"},
      ${input.observationKey ?? null},
      1,
      ${input.createdAt ?? t0},
      ${input.updatedAt ?? t0}
    )
  `;
}

function databaseTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return new Date(value).toISOString();
  }

  throw new Error("Expected a PostgreSQL timestamp value.");
}

function loadAuthIdentitySentinel(db: HuleeDatabase) {
  return db.execute<{
    id: string;
    tenant_id: string;
    account_id: string;
    provider_id: string;
    external_subject: string;
    display_name: string | null;
  }>(sql`
    select
      id,
      tenant_id,
      account_id,
      provider_id,
      external_subject,
      display_name
    from external_identity_links
    where id = ${authExternalIdentityLinkId}
  `);
}

function failSecondStatementInEachTransaction(
  db: HuleeDatabase
): InboxV2SourceExternalIdentityTransactionExecutor {
  return {
    execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      return db.execute(query) as unknown as Promise<RawSqlQueryResult<Row>>;
    },
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>
    ): Promise<TResult> {
      return db.transaction(async (transaction) => {
        let statementNumber = 0;
        const rawTransaction: RawSqlExecutor = {
          execute<Row extends Record<string, unknown>>(
            query: SQL
          ): Promise<RawSqlQueryResult<Row>> {
            statementNumber += 1;
            if (statementNumber === 2) {
              throw new Error("forced identity-head insert failure");
            }

            return transaction.execute(query) as unknown as Promise<
              RawSqlQueryResult<Row>
            >;
          }
        };

        return work(rawTransaction);
      });
    }
  };
}
