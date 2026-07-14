import {
  inboxV2ClientContactIdSchema,
  inboxV2ClientIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2ActivateTenantPolicyVersionCommandSchema,
  inboxV2ApproveTenantPolicyVersionCommandSchema,
  inboxV2IdentityClaimPolicyIdSchema,
  inboxV2IdentityClaimReasonIdSchema,
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2SchemaVersionTokenSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityClaimTransitionIdSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2SourceIdentityRealmIdSchema,
  inboxV2SourceOccurrenceIdSchema,
  inboxV2TenantIdSchema,
  inboxV2RevokeTenantPolicyVersionCommandSchema,
  type InboxV2SourceExternalIdentity,
  type InboxV2SourceIdentityClaim
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2SourceExternalIdentityRepository,
  type FindOrCreateInboxV2SourceExternalIdentityInput
} from "./sql-inbox-v2-source-external-identity-repository";
import {
  createSqlInboxV2SourceIdentityClaimRepository,
  type ApplyInboxV2SourceIdentityClaimTransitionInput,
  type InboxV2SourceIdentityClaimTransactionExecutor
} from "./sql-inbox-v2-source-identity-claim-repository";
import {
  createSqlInboxV2TenantPolicyAuthorityRepository,
  type InboxV2TenantPolicyAuthorityTransactionExecutor,
  type InboxV2TenantPolicyAuthorityUseTransaction
} from "./sql-inbox-v2-tenant-policy-authority-repository";
import type { RawSqlQueryResult } from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const tenantA = inboxV2TenantIdSchema.parse(`tenant:db002-claim-a-${runId}`);
const tenantB = inboxV2TenantIdSchema.parse(`tenant:db002-claim-b-${runId}`);
const connectionA = inboxV2SourceConnectionIdSchema.parse(
  `source_connection:db002-claim-a-${runId}`
);
const connectionA2 = inboxV2SourceConnectionIdSchema.parse(
  `source_connection:db002-claim-a2-${runId}`
);
const connectionB = inboxV2SourceConnectionIdSchema.parse(
  `source_connection:db002-claim-b-${runId}`
);
const accountA = inboxV2SourceAccountIdSchema.parse(
  `source_account:db002-claim-a-${runId}`
);
const accountA2 = inboxV2SourceAccountIdSchema.parse(
  `source_account:db002-claim-a2-${runId}`
);
const accountB = inboxV2SourceAccountIdSchema.parse(
  `source_account:db002-claim-b-${runId}`
);
const rawA = inboxV2RawInboundEventIdSchema.parse(
  `raw_inbound_event:db002-claim-a-${runId}`
);
const rawA2 = inboxV2RawInboundEventIdSchema.parse(
  `raw_inbound_event:db002-claim-a2-${runId}`
);
const rawB = inboxV2RawInboundEventIdSchema.parse(
  `raw_inbound_event:db002-claim-b-${runId}`
);
const normalizedA = inboxV2NormalizedInboundEventIdSchema.parse(
  `normalized_inbound_event:db002-claim-a-${runId}`
);
const normalizedA2 = inboxV2NormalizedInboundEventIdSchema.parse(
  `normalized_inbound_event:db002-claim-a2-${runId}`
);
const normalizedB = inboxV2NormalizedInboundEventIdSchema.parse(
  `normalized_inbound_event:db002-claim-b-${runId}`
);
const actorA = inboxV2EmployeeIdSchema.parse(
  `employee:db002-claim-actor-a-${runId}`
);
const employeeA = inboxV2EmployeeIdSchema.parse(
  `employee:db002-claim-target-a-${runId}`
);
const inactiveEmployeeA = inboxV2EmployeeIdSchema.parse(
  `employee:db002-claim-inactive-a-${runId}`
);
const employeeB = inboxV2EmployeeIdSchema.parse(
  `employee:db002-claim-target-b-${runId}`
);
const clientA = inboxV2ClientIdSchema.parse(`client:db002-claim-a-${runId}`);
const clientB = inboxV2ClientIdSchema.parse(`client:db002-claim-b-${runId}`);
const contactA = inboxV2ClientContactIdSchema.parse(
  `client_contact:db002-claim-a-${runId}`
);
const contactB = inboxV2ClientContactIdSchema.parse(
  `client_contact:db002-claim-b-${runId}`
);
const missingEmployee = inboxV2EmployeeIdSchema.parse(
  `employee:db002-claim-missing-${runId}`
);
const policyId = inboxV2IdentityClaimPolicyIdSchema.parse(
  "core:manual-identity-claim"
);
const reasonCodeId = inboxV2IdentityClaimReasonIdSchema.parse(
  "core:verified-source-evidence"
);
const policyDigest = "a".repeat(64);
const t0 = "2026-07-14T02:00:00.000Z";
const t1 = "2026-07-14T02:01:00.000Z";
const t2 = "2026-07-14T02:02:00.000Z";
const t3 = "2026-07-14T02:03:00.000Z";
const authAccountId = `account:db002-claim-auth-${runId}`;
const authLinkId = `auth_external_identity_link:db002-claim-${runId}`;
const realm = {
  realmId: inboxV2SourceIdentityRealmIdSchema.parse(
    "module:telegram-user-session:mtproto-user"
  ),
  version: inboxV2SchemaVersionTokenSchema.parse("v1"),
  canonicalizationVersion: inboxV2SchemaVersionTokenSchema.parse("v1")
};

type ClaimEvidence = InboxV2SourceIdentityClaim["evidenceReferences"][number];
type AutomaticClaimDecision = Extract<
  ApplyInboxV2SourceIdentityClaimTransitionInput["decision"],
  { kind: "automatic_policy" }
>;
type SqlExecutor = { execute(query: SQL): Promise<unknown> };
type AuthSentinel = {
  id: string;
  tenant_id: string;
  account_id: string;
  provider_id: string;
  external_subject: string;
  display_name: string | null;
};

describePostgres(
  "SQL Inbox V2 SourceIdentityClaim repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    let initialAuthSentinel: AuthSentinel[];

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{
        claims: string | null;
        evidence: string | null;
        transitions: string | null;
        heads: string | null;
        deferred_triggers: string;
      }>(sql`
      select
        to_regclass('public.inbox_v2_source_identity_claims')::text as claims,
        to_regclass(
          'public.inbox_v2_source_identity_claim_evidence_references'
        )::text as evidence,
        to_regclass(
          'public.inbox_v2_source_identity_claim_transitions'
        )::text as transitions,
        to_regclass(
          'public.inbox_v2_source_identity_claim_heads'
        )::text as heads,
        (
          select count(*)::text
          from pg_trigger
          where tgname like 'inbox_v2_source_identity_claim_%_constraint'
            and tgdeferrable
            and tginitdeferred
        ) as deferred_triggers
    `);
      const ready = readiness.rows[0];
      if (
        ready === undefined ||
        ready.claims === null ||
        ready.evidence === null ||
        ready.transitions === null ||
        ready.heads === null ||
        Number(ready.deferred_triggers) < 5
      ) {
        throw new Error(
          "Inbox V2 SourceIdentityClaim PostgreSQL tables/invariants are not migrated."
        );
      }

      await db.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values
        (${tenantA}, ${`db002-claim-a-${runId}`}, 'DB002 claim tenant A', 'saas_shared'),
        (${tenantB}, ${`db002-claim-b-${runId}`}, 'DB002 claim tenant B', 'saas_shared')
    `);
      await db.execute(sql`
      insert into source_connections (
        id, tenant_id, source_type, source_name, display_name
      ) values
        (${connectionA}, ${tenantA}, 'messenger', 'telegram', 'Claim connection A'),
        (${connectionA2}, ${tenantA}, 'messenger', 'telegram', 'Claim connection A2'),
        (${connectionB}, ${tenantB}, 'messenger', 'telegram', 'Claim connection B')
    `);
      await db.execute(sql`
      insert into source_accounts (
        id, tenant_id, source_connection_id, account_type, display_name
      ) values
        (${accountA}, ${tenantA}, ${connectionA}, 'direct_number', 'Claim account A'),
        (${accountA2}, ${tenantA}, ${connectionA2}, 'direct_number', 'Claim account A2'),
        (${accountB}, ${tenantB}, ${connectionB}, 'direct_number', 'Claim account B')
    `);
      await db.execute(sql`
      insert into raw_inbound_events (
        id, tenant_id, source_connection_id, source_account_id,
        idempotency_key, payload
      ) values
        (${rawA}, ${tenantA}, ${connectionA}, ${accountA}, ${`claim-raw-a-${runId}`}, '{}'::jsonb),
        (${rawA2}, ${tenantA}, ${connectionA2}, ${accountA2}, ${`claim-raw-a2-${runId}`}, '{}'::jsonb),
        (${rawB}, ${tenantB}, ${connectionB}, ${accountB}, ${`claim-raw-b-${runId}`}, '{}'::jsonb)
    `);
      await db.execute(sql`
      insert into normalized_inbound_events (
        id, tenant_id, raw_event_id, source_connection_id,
        source_account_id, source_type, source_name, event_type,
        direction, idempotency_key
      ) values
        (${normalizedA}, ${tenantA}, ${rawA}, ${connectionA}, ${accountA}, 'messenger', 'telegram', 'message', 'inbound', ${`claim-normalized-a-${runId}`}),
        (${normalizedA2}, ${tenantA}, ${rawA2}, ${connectionA2}, ${accountA2}, 'messenger', 'telegram', 'message', 'inbound', ${`claim-normalized-a2-${runId}`}),
        (${normalizedB}, ${tenantB}, ${rawB}, ${connectionB}, ${accountB}, 'messenger', 'telegram', 'message', 'inbound', ${`claim-normalized-b-${runId}`})
    `);
      await db.execute(sql`
      insert into employees (
        id, tenant_id, email, display_name, profile,
        deactivated_at, created_at, updated_at
      ) values
        (${actorA}, ${tenantA}, ${`claim-actor-${runId}@example.test`}, 'Claim actor A', '{}'::jsonb, null, ${t0}, ${t0}),
        (${employeeA}, ${tenantA}, ${`claim-target-${runId}@example.test`}, 'Claim target A', '{}'::jsonb, null, ${t0}, ${t0}),
        (${inactiveEmployeeA}, ${tenantA}, ${`claim-inactive-${runId}@example.test`}, 'Inactive claim target A', '{}'::jsonb, ${t0}, ${t0}, ${t0}),
        (${employeeB}, ${tenantB}, ${`claim-target-b-${runId}@example.test`}, 'Claim target B', '{}'::jsonb, null, ${t0}, ${t0})
    `);
      await db.execute(sql`
      insert into clients (
        id, tenant_id, display_name, source, created_at, updated_at
      ) values
        (${clientA}, ${tenantA}, 'Claim client A', 'claim-test', ${t0}, ${t0}),
        (${clientB}, ${tenantB}, 'Claim client B', 'claim-test', ${t0}, ${t0})
    `);
      await db.execute(sql`
      insert into client_contacts (
        id, tenant_id, client_id, type, value, created_at, updated_at
      ) values
        (${contactA}, ${tenantA}, ${clientA}, 'telegram', ${`claim-contact-a-${runId}`}, ${t0}, ${t0}),
        (${contactB}, ${tenantB}, ${clientB}, 'telegram', ${`claim-contact-b-${runId}`}, ${t0}, ${t0})
    `);
      await db.execute(sql`
      insert into accounts (id, tenant_id, email)
      values (${authAccountId}, ${tenantA}, ${`claim-auth-${runId}@example.test`})
    `);
      await db.execute(sql`
      insert into external_identity_links (
        id, tenant_id, account_id, provider_id,
        external_subject, display_name
      ) values (
        ${authLinkId}, ${tenantA}, ${authAccountId}, 'telegram',
        ${`auth-subject-${runId}`}, 'Auth namespace sentinel'
      )
    `);
      initialAuthSentinel = (await loadAuthSentinel(db)).rows;
    }, 30_000);

    afterAll(async () => {
      if (!db) return;
      try {
        await db.transaction(async (transaction) => {
          await transaction.execute(
            sql`set local session_replication_role = replica`
          );
          await transaction.execute(sql`
            delete from inbox_v2_provider_roster_member_evidence
            where tenant_id in (${tenantA}, ${tenantB})
          `);
          await transaction.execute(sql`
            delete from inbox_v2_provider_roster_evidence
            where tenant_id in (${tenantA}, ${tenantB})
          `);
          await transaction.execute(sql`
            delete from inbox_v2_source_occurrences
            where tenant_id in (${tenantA}, ${tenantB})
          `);
          await transaction.execute(
            sql`set local session_replication_role = origin`
          );
          // The mandatory head and immutable claim history are deleted only by
          // the SourceExternalIdentity parent cascade on this disposable fixture.
          await transaction.execute(sql`
          delete from inbox_v2_source_external_identities
          where tenant_id in (${tenantA}, ${tenantB})
        `);
          // Policy authority history is intentionally immutable while its tenant
          // exists. This suite owns both randomized tenants, so remove its exact
          // authority graph only after the claims that reference it have cascaded.
          await transaction.execute(
            sql`set local session_replication_role = replica`
          );
          await transaction.execute(sql`
            delete from inbox_v2_tenant_policy_activation_heads
            where tenant_id in (${tenantA}, ${tenantB})
          `);
          await transaction.execute(sql`
            delete from inbox_v2_tenant_policy_activation_transitions
            where tenant_id in (${tenantA}, ${tenantB})
          `);
          await transaction.execute(sql`
            delete from inbox_v2_tenant_policy_versions
            where tenant_id in (${tenantA}, ${tenantB})
          `);
          await transaction.execute(
            sql`set local session_replication_role = origin`
          );
          await transaction.execute(sql`
          delete from external_identity_links where id = ${authLinkId}
        `);
          await transaction.execute(sql`
          delete from normalized_inbound_events
          where id in (${normalizedA}, ${normalizedA2}, ${normalizedB})
        `);
          await transaction.execute(sql`
          delete from raw_inbound_events where id in (${rawA}, ${rawA2}, ${rawB})
        `);
          await transaction.execute(sql`
          delete from source_accounts
          where id in (${accountA}, ${accountA2}, ${accountB})
        `);
          await transaction.execute(sql`
          delete from source_connections
          where id in (${connectionA}, ${connectionA2}, ${connectionB})
        `);
          await transaction.execute(sql`
          delete from client_contacts where id in (${contactA}, ${contactB})
        `);
          await transaction.execute(sql`
          delete from clients where id in (${clientA}, ${clientB})
        `);
          await transaction.execute(sql`
          delete from employees
          where id in (${actorA}, ${employeeA}, ${inactiveEmployeeA}, ${employeeB})
        `);
          await transaction.execute(sql`
          delete from accounts where id = ${authAccountId}
        `);
          await transaction.execute(sql`
          delete from tenants where id in (${tenantA}, ${tenantB})
        `);
        });
      } finally {
        await closeHuleeDatabase(db);
      }
    }, 30_000);

    it("creates the first Employee claim and advances the claimed identity projection", async () => {
      const identityId = await seedIdentity(db, "employee-first", "account_a");
      const claimRepository = createSqlInboxV2SourceIdentityClaimRepository(db);
      const claimId = claim("employee-first");
      const result = await claimRepository.applyTransition(
        employeeClaimInput({
          identityId,
          label: "employee-first",
          claimId,
          evidence: [rawEvidence(rawA)]
        })
      );

      expect(result).toMatchObject({
        kind: "applied",
        transition: {
          expectedVersion: null,
          currentVersion: null,
          resultingVersion: "1",
          operation: { kind: "claim_employee" }
        }
      });
      const stored = await claimRepository.findClaimById({
        tenantId: tenantA,
        claimId
      });
      expect(stored).toMatchObject({
        id: claimId,
        previousClaimVersion: null,
        claimVersion: "1",
        status: "active",
        target: { kind: "employee", employee: { id: employeeA } },
        evidenceReferences: [{ kind: "raw_inbound_event" }],
        revision: "1"
      });

      const identity = await createSqlInboxV2SourceExternalIdentityRepository(
        db
      ).findById({ tenantId: tenantA, id: identityId });
      expect(identity).toMatchObject({
        resolution: {
          status: "claimed",
          activeClaim: { id: claimId }
        },
        latestClaimVersion: "1",
        revision: "2",
        updatedAt: t1
      });
      expect((await loadAuthSentinel(db)).rows).toEqual(initialAuthSentinel);
    });

    it("creates the first ClientContact claim with normalized evidence", async () => {
      const identityId = await seedIdentity(db, "contact-first", "account_a");
      const claimRepository = createSqlInboxV2SourceIdentityClaimRepository(db);
      const claimId = claim("contact-first");
      const result = await claimRepository.applyTransition(
        contactClaimInput({
          identityId,
          label: "contact-first",
          claimId,
          evidence: [normalizedEvidence(normalizedA)]
        })
      );

      expect(result).toMatchObject({
        kind: "applied",
        transition: {
          resultingVersion: "1",
          operation: { kind: "claim_client_contact" }
        }
      });
      expect(
        await claimRepository.findClaimById({ tenantId: tenantA, claimId })
      ).toMatchObject({
        target: {
          kind: "client_contact",
          clientContact: { id: contactA }
        },
        evidenceReferences: [{ kind: "normalized_inbound_event" }]
      });
    });

    it("reassigns, revokes, and pages immutable claim history while ending unresolved", async () => {
      const identityId = await seedIdentity(db, "history", "account_a");
      const repository = createSqlInboxV2SourceIdentityClaimRepository(db);
      const firstClaimId = claim("history-employee");
      const secondClaimId = claim("history-contact");

      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId,
            label: "history-employee",
            claimId: firstClaimId,
            evidence: [rawEvidence(rawA)]
          })
        )
      ).toMatchObject({ kind: "applied" });
      expect(
        await repository.applyTransition(
          contactClaimInput({
            identityId,
            label: "history-contact",
            claimId: secondClaimId,
            expectedVersion: version("1"),
            occurredAt: t2,
            evidence: [normalizedEvidence(normalizedA)]
          })
        )
      ).toMatchObject({
        kind: "applied",
        transition: {
          resultingVersion: "2",
          operation: {
            kind: "claim_client_contact",
            previousClaim: { claim: { id: firstClaimId } }
          }
        }
      });

      const afterReassignment = await repository.listHistory({
        tenantId: tenantA,
        sourceExternalIdentityId: identityId,
        afterVersion: null,
        limit: 10
      });
      expect(afterReassignment).toMatchObject([
        {
          id: firstClaimId,
          status: "revoked",
          revocation: { revokedAt: t2 },
          revision: "2"
        },
        {
          id: secondClaimId,
          status: "active",
          previousClaimVersion: "1",
          claimVersion: "2"
        }
      ]);
      expect(
        await repository.listHistory({
          tenantId: tenantA,
          sourceExternalIdentityId: identityId,
          afterVersion: version("1"),
          limit: 1
        })
      ).toMatchObject([{ id: secondClaimId, claimVersion: "2" }]);

      expect(
        await repository.applyTransition(
          revokeInput(identityId, "history-revoke", version("2"), t3)
        )
      ).toMatchObject({
        kind: "applied",
        transition: {
          resultingVersion: "3",
          operation: { kind: "revoke", activeClaim: { id: secondClaimId } }
        }
      });
      expect(
        await repository.findClaimById({
          tenantId: tenantA,
          claimId: secondClaimId
        })
      ).toMatchObject({
        status: "revoked",
        revocation: { revokedAt: t3 },
        revision: "2"
      });

      const identity = await createSqlInboxV2SourceExternalIdentityRepository(
        db
      ).findById({ tenantId: tenantA, id: identityId });
      expect(identity).toMatchObject({
        resolution: { status: "unresolved" },
        latestClaimVersion: "3",
        revision: "4",
        updatedAt: t3
      });
      expect(await loadClaimSnapshot(db, identityId)).toEqual({
        active_claim_id: null,
        active_claims: "0",
        claims: "2",
        evidence: "2",
        identity_revision: "4",
        latest_claim_version: "3",
        resolution_status: "unresolved",
        transitions: "3"
      });
    });

    it("serializes concurrent null-version claims to one winner", async () => {
      const identityId = await seedIdentity(db, "race", "account_a");
      const repository = createSqlInboxV2SourceIdentityClaimRepository(db);
      const employeeClaimId = claim("race-employee");
      const contactClaimId = claim("race-contact");
      const results = await Promise.all([
        repository.applyTransition(
          employeeClaimInput({
            identityId,
            label: "race-employee",
            claimId: employeeClaimId,
            evidence: [rawEvidence(rawA)]
          })
        ),
        repository.applyTransition(
          contactClaimInput({
            identityId,
            label: "race-contact",
            claimId: contactClaimId,
            evidence: [normalizedEvidence(normalizedA)]
          })
        )
      ]);

      expect(results.map((result) => result.kind).sort()).toEqual([
        "applied",
        "version_conflict"
      ]);
      const snapshot = await loadClaimSnapshot(db, identityId);
      expect(snapshot).toMatchObject({
        active_claims: "1",
        claims: "1",
        evidence: "1",
        identity_revision: "2",
        latest_claim_version: "1",
        resolution_status: "claimed",
        transitions: "1"
      });
      expect([employeeClaimId, contactClaimId]).toContain(
        snapshot.active_claim_id
      );
    });

    it("returns typed ID conflicts when different identities race after absent prechecks", async () => {
      const claimIdentityA = await seedIdentity(
        db,
        "claim-id-race-a",
        "account_a"
      );
      const claimIdentityB = await seedIdentity(
        db,
        "claim-id-race-b",
        "account_a"
      );
      const sharedClaimId = claim("claim-id-race-shared");
      const claimRaceRepository = createSqlInboxV2SourceIdentityClaimRepository(
        new IdPrecheckBarrierExecutor(db, "inbox_v2_source_identity_claims", 2)
      );
      const [claimResultA, claimResultB] = await Promise.all([
        claimRaceRepository.applyTransition(
          employeeClaimInput({
            identityId: claimIdentityA,
            label: "claim-id-race-a",
            claimId: sharedClaimId,
            evidence: [rawEvidence(rawA)]
          })
        ),
        claimRaceRepository.applyTransition(
          contactClaimInput({
            identityId: claimIdentityB,
            label: "claim-id-race-b",
            claimId: sharedClaimId,
            evidence: [normalizedEvidence(normalizedA)]
          })
        )
      ]);
      const claimOutcomes = [
        { identityId: claimIdentityA, result: claimResultA },
        { identityId: claimIdentityB, result: claimResultB }
      ];
      const claimWinner = claimOutcomes.find(
        ({ result }) => result.kind === "applied"
      );
      const claimLoser = claimOutcomes.find(
        ({ result }) => result.kind === "claim_id_conflict"
      );

      expect(claimOutcomes.map(({ result }) => result.kind).sort()).toEqual([
        "applied",
        "claim_id_conflict"
      ]);
      expect(claimWinner).toBeDefined();
      expect(claimLoser?.result).toEqual({
        kind: "claim_id_conflict",
        claimId: sharedClaimId
      });
      if (claimWinner === undefined || claimLoser === undefined) {
        throw new Error("Expected one shared-claim winner and one loser.");
      }
      expect(await loadClaimSnapshot(db, claimWinner.identityId)).toMatchObject(
        {
          active_claim_id: sharedClaimId,
          active_claims: "1",
          claims: "1",
          evidence: "1",
          identity_revision: "2",
          latest_claim_version: "1",
          resolution_status: "claimed",
          transitions: "1"
        }
      );
      expect(await loadClaimSnapshot(db, claimLoser.identityId)).toEqual({
        active_claim_id: null,
        active_claims: "0",
        claims: "0",
        evidence: "0",
        identity_revision: "1",
        latest_claim_version: null,
        resolution_status: "unresolved",
        transitions: "0"
      });
      expect(
        await createSqlInboxV2SourceIdentityClaimRepository(db).findClaimById({
          tenantId: tenantA,
          claimId: sharedClaimId
        })
      ).toMatchObject({
        sourceExternalIdentity: { id: claimWinner.identityId }
      });

      const transitionIdentityA = await seedIdentity(
        db,
        "transition-id-race-a",
        "account_a"
      );
      const transitionIdentityB = await seedIdentity(
        db,
        "transition-id-race-b",
        "account_a"
      );
      const sharedTransitionId = transition("transition-id-race-shared");
      const transitionClaimA = claim("transition-id-race-a");
      const transitionClaimB = claim("transition-id-race-b");
      const transitionRaceRepository =
        createSqlInboxV2SourceIdentityClaimRepository(
          new IdPrecheckBarrierExecutor(
            db,
            "inbox_v2_source_identity_claim_transitions",
            2
          )
        );
      const transitionInputA = employeeClaimInput({
        identityId: transitionIdentityA,
        label: "transition-id-race-a",
        claimId: transitionClaimA,
        evidence: [rawEvidence(rawA)]
      });
      const transitionInputB = contactClaimInput({
        identityId: transitionIdentityB,
        label: "transition-id-race-b",
        claimId: transitionClaimB,
        evidence: [normalizedEvidence(normalizedA)]
      });
      const [transitionResultA, transitionResultB] = await Promise.all([
        transitionRaceRepository.applyTransition({
          ...transitionInputA,
          transitionId: sharedTransitionId
        }),
        transitionRaceRepository.applyTransition({
          ...transitionInputB,
          transitionId: sharedTransitionId
        })
      ]);
      const transitionOutcomes = [
        {
          claimId: transitionClaimA,
          identityId: transitionIdentityA,
          result: transitionResultA
        },
        {
          claimId: transitionClaimB,
          identityId: transitionIdentityB,
          result: transitionResultB
        }
      ];
      const transitionWinner = transitionOutcomes.find(
        ({ result }) => result.kind === "applied"
      );
      const transitionLoser = transitionOutcomes.find(
        ({ result }) => result.kind === "transition_id_conflict"
      );

      expect(
        transitionOutcomes.map(({ result }) => result.kind).sort()
      ).toEqual(["applied", "transition_id_conflict"]);
      expect(transitionWinner).toBeDefined();
      expect(transitionLoser?.result).toEqual({
        kind: "transition_id_conflict",
        transitionId: sharedTransitionId
      });
      if (transitionWinner === undefined || transitionLoser === undefined) {
        throw new Error("Expected one shared-transition winner and one loser.");
      }
      expect(
        await loadClaimSnapshot(db, transitionWinner.identityId)
      ).toMatchObject({
        active_claim_id: transitionWinner.claimId,
        active_claims: "1",
        claims: "1",
        evidence: "1",
        identity_revision: "2",
        latest_claim_version: "1",
        resolution_status: "claimed",
        transitions: "1"
      });
      expect(await loadClaimSnapshot(db, transitionLoser.identityId)).toEqual({
        active_claim_id: null,
        active_claims: "0",
        claims: "0",
        evidence: "0",
        identity_revision: "1",
        latest_claim_version: null,
        resolution_status: "unresolved",
        transitions: "0"
      });
      expect(
        await createSqlInboxV2SourceIdentityClaimRepository(db).findClaimById({
          tenantId: tenantA,
          claimId: transitionLoser.claimId
        })
      ).toBeNull();
    });

    it("accepts only exact active automatic-policy authority without partial writes", async () => {
      const repository = createSqlInboxV2SourceIdentityClaimRepository(db);
      const successAuthority = await seedPolicyAuthority(db, "auto-success");
      const successIdentity = await seedIdentity(
        db,
        "auto-success",
        "account_a"
      );
      const successClaimId = claim("auto-success");

      await expect(
        repository.applyTransition(
          employeeClaimInput({
            identityId: successIdentity,
            label: "auto-success",
            claimId: successClaimId,
            evidence: [rawEvidence(rawA)],
            decision: successAuthority.decision,
            policyId: successAuthority.policyId
          })
        )
      ).resolves.toMatchObject({
        kind: "applied",
        transition: { decision: successAuthority.decision }
      });
      await expect(
        repository.findClaimById({
          tenantId: tenantA,
          claimId: successClaimId
        })
      ).resolves.toMatchObject({ decision: successAuthority.decision });

      const staleAuthority = await seedPolicyAuthority(db, "auto-stale");
      const staleIdentity = await seedIdentity(db, "auto-stale", "account_a");
      await expect(
        repository.applyTransition(
          employeeClaimInput({
            identityId: staleIdentity,
            label: "auto-stale",
            evidence: [rawEvidence(rawA)],
            decision: {
              ...staleAuthority.decision,
              policyAuthority: {
                ...staleAuthority.decision.policyAuthority,
                activationHeadRevision: "2" as never
              }
            },
            policyId: staleAuthority.policyId
          })
        )
      ).resolves.toEqual({
        kind: "head_revision_conflict",
        currentHeadRevision: "1"
      });
      expect(await loadClaimSnapshot(db, staleIdentity)).toMatchObject({
        claims: "0",
        transitions: "0",
        identity_revision: "1"
      });

      const wrongDigestAuthority = await seedPolicyAuthority(
        db,
        "auto-wrong-digest"
      );
      const wrongDigestIdentity = await seedIdentity(
        db,
        "auto-wrong-digest",
        "account_a"
      );
      await expect(
        repository.applyTransition(
          employeeClaimInput({
            identityId: wrongDigestIdentity,
            label: "auto-wrong-digest",
            evidence: [rawEvidence(rawA)],
            decision: {
              ...wrongDigestAuthority.decision,
              policyAuthority: {
                ...wrongDigestAuthority.decision.policyAuthority,
                definitionDigestSha256: "b".repeat(64)
              }
            },
            policyId: wrongDigestAuthority.policyId
          })
        )
      ).resolves.toEqual({
        kind: "definition_digest_conflict",
        currentDefinitionDigestSha256: policyDigest,
        currentHeadRevision: "1"
      });
      expect(await loadClaimSnapshot(db, wrongDigestIdentity)).toMatchObject({
        claims: "0",
        transitions: "0",
        identity_revision: "1"
      });

      const revokedAuthority = await seedPolicyAuthority(db, "auto-revoked");
      await expect(
        createSqlInboxV2TenantPolicyAuthorityRepository(db).revokeVersion(
          inboxV2RevokeTenantPolicyVersionCommandSchema.parse({
            tenantId: tenantA,
            family: "source_identity_claim",
            policyId: revokedAuthority.policyId,
            policyVersion: "v1",
            expectedHeadRevision: "1",
            revokedBy: {
              tenantId: tenantA,
              kind: "employee",
              id: actorA
            },
            revokedAt: t1
          })
        )
      ).resolves.toMatchObject({ kind: "revoked" });
      const revokedIdentity = await seedIdentity(
        db,
        "auto-revoked",
        "account_a"
      );
      await expect(
        repository.applyTransition(
          employeeClaimInput({
            identityId: revokedIdentity,
            label: "auto-revoked",
            occurredAt: t2,
            evidence: [rawEvidence(rawA)],
            decision: revokedAuthority.decision,
            policyId: revokedAuthority.policyId
          })
        )
      ).resolves.toEqual({
        kind: "policy_inactive",
        currentHeadRevision: "2"
      });
      expect(await loadClaimSnapshot(db, revokedIdentity)).toMatchObject({
        claims: "0",
        transitions: "0",
        identity_revision: "1"
      });
    });

    it("holds the exact policy-use fence until claim commit before revocation wins", async () => {
      const authority = await seedPolicyAuthority(db, "auto-revoke-race");
      const identityId = await seedIdentity(
        db,
        "auto-revoke-race",
        "account_a"
      );
      const claimExecutor = new PolicyUseGateExecutor(db);
      const claimPromise = createSqlInboxV2SourceIdentityClaimRepository(
        claimExecutor
      ).applyTransition(
        employeeClaimInput({
          identityId,
          label: "auto-revoke-race",
          evidence: [rawEvidence(rawA)],
          decision: authority.decision,
          policyId: authority.policyId
        })
      );

      await claimExecutor.waitUntilPolicyLocked();
      const revokeExecutor = new PolicyRevokeAttemptExecutor(db);
      const revokePromise = createSqlInboxV2TenantPolicyAuthorityRepository(
        revokeExecutor
      ).revokeVersion(
        inboxV2RevokeTenantPolicyVersionCommandSchema.parse({
          tenantId: tenantA,
          family: "source_identity_claim",
          policyId: authority.policyId,
          policyVersion: "v1",
          expectedHeadRevision: "1",
          revokedBy: {
            tenantId: tenantA,
            kind: "employee",
            id: actorA
          },
          revokedAt: t2
        })
      );
      await revokeExecutor.waitUntilHeadLockAttempted();
      claimExecutor.releasePolicyFence();

      await expect(claimPromise).resolves.toMatchObject({ kind: "applied" });
      await expect(revokePromise).resolves.toMatchObject({
        kind: "revoked",
        activation: { revision: "2", state: "revoked" }
      });
      expect(await loadClaimSnapshot(db, identityId)).toMatchObject({
        claims: "1",
        active_claims: "1",
        transitions: "1",
        identity_revision: "2"
      });
    });

    it("rejects missing, inactive, and manual-self Employee targets without advancing heads", async () => {
      const repository = createSqlInboxV2SourceIdentityClaimRepository(db);
      const missingIdentity = await seedIdentity(
        db,
        "missing-target",
        "provider"
      );
      const inactiveIdentity = await seedIdentity(
        db,
        "inactive-target",
        "provider"
      );
      const selfIdentity = await seedIdentity(db, "self-target", "provider");

      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId: missingIdentity,
            label: "missing-target",
            targetEmployeeId: missingEmployee,
            evidence: [rawEvidence(rawA)]
          })
        )
      ).toEqual({
        kind: "target_not_found",
        targetKind: "employee",
        targetId: missingEmployee
      });
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId: inactiveIdentity,
            label: "inactive-target",
            targetEmployeeId: inactiveEmployeeA,
            evidence: [rawEvidence(rawA)]
          })
        )
      ).toEqual({ kind: "target_inactive", employeeId: inactiveEmployeeA });
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId: selfIdentity,
            label: "self-target",
            targetEmployeeId: actorA,
            evidence: [rawEvidence(rawA)]
          })
        )
      ).toEqual({ kind: "manual_self_claim_forbidden" });

      for (const identityId of [
        missingIdentity,
        inactiveIdentity,
        selfIdentity
      ]) {
        expect(await loadClaimSnapshot(db, identityId)).toMatchObject({
          active_claim_id: null,
          claims: "0",
          evidence: "0",
          identity_revision: "1",
          latest_claim_version: null,
          resolution_status: "unresolved",
          transitions: "0"
        });
      }
    });

    it("validates owner evidence and exact provider occurrence/roster actor proof", async () => {
      const identityId = await seedIdentity(db, "evidence", "account_a");
      const repository = createSqlInboxV2SourceIdentityClaimRepository(db);
      const missingRaw = inboxV2RawInboundEventIdSchema.parse(
        `raw_inbound_event:db002-claim-missing-${runId}`
      );

      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId,
            label: "evidence-missing",
            evidence: [rawEvidence(missingRaw)]
          })
        )
      ).toMatchObject({ kind: "evidence_not_found" });
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId,
            label: "evidence-raw-scope",
            evidence: [rawEvidence(rawA2)]
          })
        )
      ).toMatchObject({ kind: "evidence_scope_conflict" });
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId,
            label: "evidence-normalized-scope",
            evidence: [normalizedEvidence(normalizedA2)]
          })
        )
      ).toMatchObject({ kind: "evidence_scope_conflict" });

      const providerIdentity = await seedIdentity(
        db,
        "evidence-provider-unproven",
        "provider"
      );
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId: providerIdentity,
            label: "evidence-provider-unproven",
            evidence: [rawEvidence(rawA)]
          })
        )
      ).toMatchObject({ kind: "evidence_scope_conflict" });
      expect(await loadClaimSnapshot(db, providerIdentity)).toMatchObject({
        active_claim_id: null,
        claims: "0",
        evidence: "0",
        identity_revision: "1",
        latest_claim_version: null,
        resolution_status: "unresolved",
        transitions: "0"
      });

      const occurrenceIdentity = await seedIdentity(
        db,
        "evidence-provider-occurrence",
        "provider"
      );
      const occurrenceEvidence = await seedExactProviderEvidenceRows(
        db,
        "evidence-provider-occurrence",
        occurrenceIdentity
      );
      const occurrenceClaimId = claim("evidence-provider-occurrence");
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId: occurrenceIdentity,
            label: "evidence-provider-occurrence",
            claimId: occurrenceClaimId,
            evidence: [
              sourceOccurrenceEvidence(occurrenceEvidence.occurrenceId),
              rawEvidence(rawA)
            ]
          })
        )
      ).toMatchObject({ kind: "applied" });
      await expect(
        repository.findClaimById({
          tenantId: tenantA,
          claimId: occurrenceClaimId
        })
      ).resolves.toMatchObject({
        evidenceReferences: [
          { kind: "source_occurrence" },
          { kind: "raw_inbound_event" }
        ]
      });

      const rosterIdentity = await seedIdentity(
        db,
        "evidence-provider-roster",
        "provider"
      );
      const rosterEvidence = await seedExactProviderEvidenceRows(
        db,
        "evidence-provider-roster",
        rosterIdentity
      );
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId: rosterIdentity,
            label: "evidence-provider-roster",
            evidence: [providerRosterEvidence(rosterEvidence.rosterId)]
          })
        )
      ).toMatchObject({ kind: "applied" });

      const wrongActorIdentity = await seedIdentity(
        db,
        "evidence-provider-wrong-actor",
        "provider"
      );
      const anotherIdentity = await seedIdentity(
        db,
        "evidence-provider-other-actor",
        "provider"
      );
      const wrongActorEvidence = await seedExactProviderEvidenceRows(
        db,
        "evidence-provider-wrong-actor",
        anotherIdentity
      );
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId: wrongActorIdentity,
            label: "evidence-provider-wrong-actor",
            evidence: [
              sourceOccurrenceEvidence(wrongActorEvidence.occurrenceId)
            ]
          })
        )
      ).toMatchObject({ kind: "evidence_scope_conflict" });
      expect(await loadClaimSnapshot(db, wrongActorIdentity)).toMatchObject({
        claims: "0",
        evidence: "0",
        transitions: "0"
      });

      const unpairedIdentity = await seedIdentity(
        db,
        "evidence-provider-unpaired",
        "provider"
      );
      const unpairedEvidence = await seedExactProviderEvidenceRows(
        db,
        "evidence-provider-unpaired",
        unpairedIdentity
      );
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId: unpairedIdentity,
            label: "evidence-provider-unpaired",
            evidence: [
              sourceOccurrenceEvidence(unpairedEvidence.occurrenceId),
              rawEvidence(rawA2)
            ]
          })
        )
      ).toMatchObject({
        kind: "evidence_scope_conflict",
        evidence: rawEvidence(rawA2)
      });
      expect(await loadClaimSnapshot(db, unpairedIdentity)).toMatchObject({
        claims: "0",
        evidence: "0",
        transitions: "0"
      });

      const validClaimId = claim("evidence-valid");
      expect(
        await repository.applyTransition(
          employeeClaimInput({
            identityId,
            label: "evidence-valid",
            claimId: validClaimId,
            evidence: [rawEvidence(rawA), normalizedEvidence(normalizedA)]
          })
        )
      ).toMatchObject({ kind: "applied" });
      expect(
        await repository.findClaimById({
          tenantId: tenantA,
          claimId: validClaimId
        })
      ).toMatchObject({
        evidenceReferences: [
          { kind: "raw_inbound_event" },
          { kind: "normalized_inbound_event" }
        ]
      });
    });

    it("rejects a direct cross-tenant Employee target at the composite FK", async () => {
      const identityId = await seedIdentity(
        db,
        "direct-cross-target",
        "provider"
      );
      const claimId = claim("direct-cross-target");

      await expectDatabaseFailure(
        () =>
          db.transaction(async (transaction) => {
            await insertDirectClaim(transaction, {
              identityId,
              claimId,
              targetEmployeeId: employeeB
            });
            await transaction.execute(sql`set constraints all immediate`);
          }),
        /inbox_v2_identity_claims_employee_fk/
      );
      expect(await loadClaimSnapshot(db, identityId)).toMatchObject({
        claims: "0",
        identity_revision: "1",
        latest_claim_version: null,
        transitions: "0"
      });
    });

    it("rejects direct cross-tenant evidence at the typed event FK", async () => {
      const identityId = await seedIdentity(
        db,
        "direct-cross-evidence",
        "provider"
      );
      const claimId = claim("direct-cross-evidence");

      await expectDatabaseFailure(
        () =>
          db.transaction(async (transaction) => {
            await insertDirectClaim(transaction, {
              identityId,
              claimId,
              targetEmployeeId: employeeA
            });
            await transaction.execute(sql`
          insert into inbox_v2_source_identity_claim_evidence_references (
            tenant_id, claim_id, source_external_identity_id, claim_version,
            ordinal, evidence_kind, raw_inbound_event_id,
            normalized_inbound_event_id
          ) values (
            ${tenantA}, ${claimId}, ${identityId}, 1,
            0, 'raw_inbound_event', ${rawB}, null
          )
        `);
            await transaction.execute(sql`set constraints all immediate`);
          }),
        /inbox_v2_identity_claim_evidence_raw_event_fk/
      );
      expect(await loadClaimSnapshot(db, identityId)).toMatchObject({
        claims: "0",
        evidence: "0",
        latest_claim_version: null
      });
    });

    it("fails direct orphan history, head forgery, and mandatory-head deletion", async () => {
      const orphanIdentity = await seedIdentity(
        db,
        "direct-orphan",
        "account_a"
      );
      const forgedHeadIdentity = await seedIdentity(
        db,
        "direct-forged-head",
        "provider"
      );
      const deletedHeadIdentity = await seedIdentity(
        db,
        "direct-delete-head",
        "provider"
      );
      const providerEvidenceIdentity = await seedIdentity(
        db,
        "direct-provider-evidence",
        "provider"
      );
      const automaticClaimIdentity = await seedIdentity(
        db,
        "direct-automatic-claim",
        "account_a"
      );

      await expectDatabaseFailure(
        () =>
          db.transaction(async (transaction) => {
            await insertDirectClaim(transaction, {
              identityId: orphanIdentity,
              claimId: claim("direct-orphan"),
              targetEmployeeId: employeeA
            });
            await transaction.execute(sql`set constraints all immediate`);
          }),
        /source_identity_claim_evidence_cardinality_invalid/
      );

      await expectDatabaseFailure(
        () =>
          db.transaction(async (transaction) => {
            await transaction.execute(sql`
          update inbox_v2_source_identity_claim_heads
          set resolution_status = 'unresolved',
              active_claim_id = null,
              latest_claim_version = 1
          where tenant_id = ${tenantA}
            and source_external_identity_id = ${forgedHeadIdentity}
        `);
            await transaction.execute(sql`set constraints all immediate`);
          }),
        /source_identity_claim_head_clock_invalid/
      );

      await expectDatabaseFailure(
        () =>
          db.transaction(async (transaction) => {
            await transaction.execute(sql`
          delete from inbox_v2_source_identity_claim_heads
          where tenant_id = ${tenantA}
            and source_external_identity_id = ${deletedHeadIdentity}
        `);
          }),
        /source_identity_claim_head_delete_forbidden/
      );

      await expectDatabaseFailure(
        () =>
          db.transaction(async (transaction) => {
            await insertDirectClaimBundle(transaction, {
              identityId: providerEvidenceIdentity,
              claimId: claim("direct-provider-evidence"),
              transitionId: transition("direct-provider-evidence"),
              targetEmployeeId: employeeA,
              rawEventId: rawA
            });
            await transaction.execute(sql`set constraints all immediate`);
          }),
        /source_identity_claim_evidence_scope_invalid/
      );

      await expectDatabaseFailure(
        () =>
          insertDirectClaim(db, {
            identityId: automaticClaimIdentity,
            claimId: claim("direct-automatic-claim"),
            targetEmployeeId: employeeA,
            decisionKind: "automatic_policy"
          }),
        /inbox_v2_identity_claims_policy_authority_fk/
      );

      for (const identityId of [
        orphanIdentity,
        forgedHeadIdentity,
        deletedHeadIdentity,
        providerEvidenceIdentity,
        automaticClaimIdentity
      ]) {
        expect(await loadClaimSnapshot(db, identityId)).toMatchObject({
          claims: "0",
          identity_revision: "1",
          latest_claim_version: null,
          resolution_status: "unresolved",
          transitions: "0"
        });
      }
      expect((await loadAuthSentinel(db)).rows).toEqual(initialAuthSentinel);
    });
  }
);

async function seedIdentity(
  db: HuleeDatabase,
  label: string,
  scopeKind: "provider" | "account_a"
) {
  const id = identity(label);
  const scope: InboxV2SourceExternalIdentity["scope"] =
    scopeKind === "provider"
      ? { kind: "provider" }
      : {
          kind: "source_account",
          owner: {
            tenantId: tenantA,
            kind: "source_account",
            id: accountA
          }
        };
  const input: FindOrCreateInboxV2SourceExternalIdentityInput = {
    tenantId: tenantA,
    id,
    realm,
    objectKindId: "module:telegram-user-session:provider-user" as never,
    scope,
    identityDeclaration: {
      adapterContract: {
        contractId: "module:telegram-user-session:identity-contract",
        contractVersion: "v1",
        declarationRevision: "1",
        surfaceId: "module:telegram-user-session:mtproto",
        loadedByTrustedServiceId: "core:inbox-worker",
        loadedAt: t0
      },
      identityKind: "source_external_identity",
      realmId: realm.realmId,
      realmVersion: realm.version,
      canonicalizationVersion: realm.canonicalizationVersion,
      objectKindId: "module:telegram-user-session:provider-user",
      scopeKind: scope.kind,
      decisionStrength:
        scope.kind === "source_account" ? "safe_default" : "authoritative"
    } as never,
    materializationAuthority: {
      kind: "trusted_service",
      tenantId: tenantA,
      trustedServiceId: "core:inbox-worker",
      authorizationToken: `identity-${label}-${runId}`,
      authorizedAt: t0
    } as never,
    materializedAt: t0,
    canonicalExternalSubject: `subject:${label}:${runId}`,
    stability: { kind: "stable" },
    createdAt: t0
  };
  const result =
    await createSqlInboxV2SourceExternalIdentityRepository(db).findOrCreate(
      input
    );
  expect(result.kind).toBe("created");
  return id;
}

async function seedExactProviderEvidenceRows(
  db: HuleeDatabase,
  label: string,
  providerActorIdentityId: ReturnType<typeof identity>
) {
  const occurrenceId = inboxV2SourceOccurrenceIdSchema.parse(
    `source_occurrence:db002-claim-${label}-${runId}`
  );
  const rosterId = `provider_roster_evidence:db002-claim-${label}-${runId}`;
  const memberId = `provider_roster_member_evidence:db002-claim-${label}-${runId}`;
  const externalThreadId = `external_thread:db002-claim-${label}-${runId}`;
  const bindingId = `source_thread_binding:db002-claim-${label}-${runId}`;
  const conversationId = `conversation:db002-claim-${label}-${runId}`;

  await db.transaction(async (transaction) => {
    // These rows are narrow evidence fixtures. Their own repository suites
    // validate the full external-thread/binding materialization graph; this
    // suite exercises the claim-side exact actor/member foreign keys and
    // deferred scope guard with all normal claim triggers enabled.
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into inbox_v2_source_occurrences (
        tenant_id, id, conversation_id, external_thread_id,
        external_thread_revision, source_connection_id, source_account_id,
        source_thread_binding_id, binding_revision, binding_generation,
        account_identity_revision, account_generation,
        account_canonical_key_digest_sha256,
        message_realm_id, message_realm_version,
        message_canonicalization_version, message_scope_kind,
        message_scope_source_account_id,
        message_scope_source_thread_binding_id,
        message_object_kind_id, canonical_external_subject,
        adapter_contract_id, adapter_contract_version,
        adapter_declaration_revision, adapter_surface_id,
        adapter_loaded_by_trusted_service_id, adapter_loaded_at,
        message_decision_strength, origin_kind, raw_inbound_event_id,
        normalized_inbound_event_id, provider_actor_kind,
        provider_actor_source_external_identity_id,
        provider_system_actor_kind_id, provider_system_actor_subject,
        direction, descriptor_schema_id, descriptor_version,
        capability_revision, provider_reference_count,
        descriptor_digest_sha256, provider_timestamp_count,
        reference_portability_kind,
        reference_portability_decision_strength, resolution_state,
        resolution_diagnostic_code_id, resolution_diagnostic_retryable,
        resolution_diagnostic_correlation_token,
        resolution_diagnostic_safe_operator_hint_id,
        materialized_by_trusted_service_id,
        materialization_authorization_token, observed_at, recorded_at,
        revision, created_at, updated_at
      ) values (
        ${tenantA}, ${occurrenceId}, ${conversationId}, ${externalThreadId},
        1, ${connectionA}, ${accountA}, ${bindingId}, 1, 1, 1, 1,
        ${"1".repeat(64)}, 'module:synthetic-source:message-realm', 'v1',
        'v1', 'provider_thread', null, null,
        'module:synthetic-source:message', ${`message:${label}:${runId}`},
        'module:synthetic-source:contract', 'v1', 1,
        'module:synthetic-source:surface', 'core:inbox-worker', ${t0},
        'authoritative', 'webhook', ${rawA}, ${normalizedA},
        'source_external_identity', ${providerActorIdentityId}, null, null,
        'inbound', 'module:synthetic-source:descriptor', 'v1', 1, 1,
        ${"2".repeat(64)}, 0, 'binding_only', 'safe_default', 'pending',
        'core:pending', true, ${`claim-evidence-${label}-${runId}`}, null,
        'core:inbox-worker', ${`materialize-${label}-${runId}`},
        ${t1}, ${t1}, 1, ${t1}, ${t1}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_provider_roster_evidence (
        tenant_id, id, source_thread_binding_id, external_thread_id,
        source_connection_id, source_account_id, binding_revision,
        binding_generation, adapter_contract_id, adapter_contract_version,
        adapter_declaration_revision, adapter_surface_id,
        adapter_loaded_by_trusted_service_id, adapter_loaded_at,
        capability_revision, observation_kind, raw_inbound_event_id,
        normalized_inbound_event_id, completeness, authority,
        omission_policy, ordering_kind, ordering_scope_token,
        ordering_comparator_id, ordering_comparator_revision,
        ordering_position, watermark, member_count,
        ordered_member_digest_sha256, materialized_by_trusted_service_id,
        materialization_authorization_token, observed_at, recorded_at,
        revision, created_at, updated_at
      ) values (
        ${tenantA}, ${rosterId}, ${bindingId}, ${externalThreadId},
        ${connectionA}, ${accountA}, 1, 1,
        'module:synthetic-source:contract', 'v1', 1,
        'module:synthetic-source:surface', 'core:inbox-worker', ${t0}, 1,
        'raw_inbound_event', ${rawA}, null, 'partial', 'authoritative',
        'retain_missing', 'adapter_monotonic',
        ${`roster-scope:${label}:${runId}`},
        'module:synthetic-source:roster-sequence', 1, 1,
        ${`watermark:${label}:${runId}`}, 1, ${"3".repeat(64)},
        'core:inbox-worker', ${`roster-${label}-${runId}`},
        ${t1}, ${t1}, 1, ${t1}, ${t1}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_provider_roster_member_evidence (
        tenant_id, id, roster_evidence_id, source_thread_binding_id,
        external_thread_id, source_connection_id, source_account_id,
        ordinal, source_external_identity_id,
        source_external_identity_revision, state, normalized_role,
        provider_state_code, provider_role_code, observed_at,
        roster_recorded_at, revision, created_at, updated_at
      ) values (
        ${tenantA}, ${memberId}, ${rosterId}, ${bindingId},
        ${externalThreadId}, ${connectionA}, ${accountA}, 0,
        ${providerActorIdentityId}, 1, 'present', 'member',
        'present', 'participant', ${t1}, ${t1}, 1, ${t1}, ${t1}
      )
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });

  return { occurrenceId, rosterId };
}

function employeeClaimInput(input: {
  identityId: ReturnType<typeof identity>;
  label: string;
  claimId?: ReturnType<typeof claim>;
  targetEmployeeId?: typeof employeeA;
  expectedVersion?: ReturnType<typeof version> | null;
  occurredAt?: string;
  evidence: readonly ClaimEvidence[];
  decision?: ApplyInboxV2SourceIdentityClaimTransitionInput["decision"];
  policyId?: ApplyInboxV2SourceIdentityClaimTransitionInput["policyId"];
}): ApplyInboxV2SourceIdentityClaimTransitionInput {
  return {
    tenantId: tenantA,
    sourceExternalIdentityId: input.identityId,
    transitionId: transition(input.label),
    expectedVersion: input.expectedVersion ?? null,
    operation: {
      kind: "claim_employee",
      claimId: input.claimId ?? claim(input.label),
      employeeId: input.targetEmployeeId ?? employeeA,
      confidence: "verified",
      evidenceReferences: input.evidence
    },
    decision: input.decision ?? manualDecision(),
    policyId: input.policyId ?? policyId,
    policyVersion: "v1",
    reasonCodeId,
    occurredAt: input.occurredAt ?? t1
  };
}

function contactClaimInput(input: {
  identityId: ReturnType<typeof identity>;
  label: string;
  claimId?: ReturnType<typeof claim>;
  expectedVersion?: ReturnType<typeof version> | null;
  occurredAt?: string;
  evidence: readonly ClaimEvidence[];
}): ApplyInboxV2SourceIdentityClaimTransitionInput {
  return {
    tenantId: tenantA,
    sourceExternalIdentityId: input.identityId,
    transitionId: transition(input.label),
    expectedVersion: input.expectedVersion ?? null,
    operation: {
      kind: "claim_client_contact",
      claimId: input.claimId ?? claim(input.label),
      clientContactId: contactA,
      confidence: "verified",
      evidenceReferences: input.evidence
    },
    decision: manualDecision(),
    policyId,
    policyVersion: "v1",
    reasonCodeId,
    occurredAt: input.occurredAt ?? t1
  };
}

function revokeInput(
  identityId: ReturnType<typeof identity>,
  label: string,
  expectedVersion: ReturnType<typeof version>,
  occurredAt: string
): ApplyInboxV2SourceIdentityClaimTransitionInput {
  return {
    tenantId: tenantA,
    sourceExternalIdentityId: identityId,
    transitionId: transition(label),
    expectedVersion,
    operation: { kind: "revoke" },
    decision: manualDecision(),
    policyId,
    policyVersion: "v1",
    reasonCodeId,
    occurredAt
  };
}

function manualDecision() {
  return {
    kind: "manual" as const,
    actorEmployee: {
      tenantId: tenantA,
      kind: "employee" as const,
      id: actorA
    },
    reviewState: "approved" as const
  };
}

async function seedPolicyAuthority(db: HuleeDatabase, label: string) {
  const exactPolicyId = inboxV2IdentityClaimPolicyIdSchema.parse(
    `core:db002-claim-${label}-${runId}`
  );
  const trustedServiceId = "core:identity-claim-service";
  const repository = createSqlInboxV2TenantPolicyAuthorityRepository(db);
  await expect(
    repository.approveVersion(
      inboxV2ApproveTenantPolicyVersionCommandSchema.parse({
        tenantId: tenantA,
        family: "source_identity_claim",
        policyId: exactPolicyId,
        policyVersion: "v1",
        definitionContractVersion: "v1",
        definitionDigestSha256: policyDigest,
        approvedTrustedServiceId: trustedServiceId,
        approvedBy: {
          tenantId: tenantA,
          kind: "employee",
          id: actorA
        },
        approvedAt: t0
      })
    )
  ).resolves.toMatchObject({ kind: "approved" });
  await expect(
    repository.activateVersion(
      inboxV2ActivateTenantPolicyVersionCommandSchema.parse({
        tenantId: tenantA,
        family: "source_identity_claim",
        policyId: exactPolicyId,
        policyVersion: "v1",
        expectedHeadRevision: null,
        activatedBy: {
          tenantId: tenantA,
          kind: "employee",
          id: actorA
        },
        activatedAt: t0
      })
    )
  ).resolves.toMatchObject({ kind: "activated" });
  const decision: AutomaticClaimDecision = {
    kind: "automatic_policy",
    trustedServiceId: trustedServiceId as never,
    reviewState: "not_required",
    policyAuthority: {
      family: "source_identity_claim",
      definitionContractVersion: "v1" as never,
      definitionDigestSha256: policyDigest,
      activationHeadRevision: "1" as never
    }
  };
  return { policyId: exactPolicyId, decision };
}

function rawEvidence(id: typeof rawA): ClaimEvidence {
  return {
    kind: "raw_inbound_event",
    reference: { tenantId: tenantA, kind: "raw_inbound_event", id }
  };
}

function normalizedEvidence(id: typeof normalizedA): ClaimEvidence {
  return {
    kind: "normalized_inbound_event",
    reference: { tenantId: tenantA, kind: "normalized_inbound_event", id }
  };
}

function sourceOccurrenceEvidence(
  id: ReturnType<typeof inboxV2SourceOccurrenceIdSchema.parse>
): ClaimEvidence {
  return {
    kind: "source_occurrence",
    reference: { tenantId: tenantA, kind: "source_occurrence", id }
  };
}

function providerRosterEvidence(id: string): ClaimEvidence {
  return {
    kind: "provider_roster_evidence",
    reference: {
      tenantId: tenantA,
      kind: "provider_roster_evidence",
      id: id as never
    }
  };
}

function identity(label: string) {
  return inboxV2SourceExternalIdentityIdSchema.parse(
    `source_external_identity:db002-claim-${label}-${runId}`
  );
}

function claim(label: string) {
  return inboxV2SourceIdentityClaimIdSchema.parse(
    `source_identity_claim:db002-claim-${label}-${runId}`
  );
}

function transition(label: string) {
  return inboxV2SourceIdentityClaimTransitionIdSchema.parse(
    `source_identity_claim_transition:db002-claim-${label}-${runId}`
  );
}

function version(value: string) {
  return inboxV2SourceIdentityClaimVersionSchema.parse(value);
}

async function insertDirectClaim(
  executor: SqlExecutor,
  input: {
    identityId: ReturnType<typeof identity>;
    claimId: ReturnType<typeof claim>;
    targetEmployeeId: typeof employeeA | typeof employeeB;
    decisionKind?: "manual" | "automatic_policy";
  }
) {
  const decisionKind = input.decisionKind ?? "manual";
  const decisionActorEmployeeId = decisionKind === "manual" ? actorA : null;
  const decisionTrustedServiceId =
    decisionKind === "automatic_policy" ? "core:identity-claim-service" : null;
  const policyFamily =
    decisionKind === "automatic_policy" ? "source_identity_claim" : null;
  const policyDefinitionContractVersion =
    decisionKind === "automatic_policy" ? "v1" : null;
  const policyDefinitionDigestSha256 =
    decisionKind === "automatic_policy" ? "f".repeat(64) : null;
  const policyActivationHeadRevision =
    decisionKind === "automatic_policy" ? 999 : null;
  await executor.execute(sql`
    insert into inbox_v2_source_identity_claims (
      tenant_id, id, source_external_identity_id,
      previous_claim_version, claim_version,
      target_kind, target_employee_id, target_client_contact_id,
      status, confidence, policy_id, policy_version, reason_code_id,
      decision_kind, decision_actor_employee_id,
      decision_trusted_service_id, policy_family,
      policy_definition_contract_version,
      policy_definition_digest_sha256, policy_activation_head_revision,
      created_at, revoked_at, revision
    ) values (
      ${tenantA}, ${input.claimId}, ${input.identityId},
      null, 1,
      'employee', ${input.targetEmployeeId}, null,
      'active', 'verified', ${policyId}, 'v1', ${reasonCodeId},
      ${decisionKind}, ${decisionActorEmployeeId},
      ${decisionTrustedServiceId}, ${policyFamily},
      ${policyDefinitionContractVersion}, ${policyDefinitionDigestSha256},
      ${policyActivationHeadRevision}, ${t1}, null, 1
    )
  `);
}

async function insertDirectClaimBundle(
  executor: SqlExecutor,
  input: {
    identityId: ReturnType<typeof identity>;
    claimId: ReturnType<typeof claim>;
    transitionId: ReturnType<typeof transition>;
    targetEmployeeId: typeof employeeA;
    rawEventId: typeof rawA;
  }
) {
  await insertDirectClaim(executor, input);
  await executor.execute(sql`
    insert into inbox_v2_source_identity_claim_evidence_references (
      tenant_id, claim_id, source_external_identity_id,
      claim_version, ordinal, evidence_kind,
      raw_inbound_event_id, normalized_inbound_event_id
    ) values (
      ${tenantA}, ${input.claimId}, ${input.identityId},
      1, 0, 'raw_inbound_event', ${input.rawEventId}, null
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_identity_claim_transitions (
      tenant_id, id, source_external_identity_id,
      operation_kind, target_kind, target_employee_id,
      target_client_contact_id, previous_claim_id, previous_target_kind,
      previous_target_employee_id, previous_target_client_contact_id,
      resulting_claim_id, active_claim_id,
      decision_kind, decision_actor_employee_id,
      decision_trusted_service_id, policy_id, policy_version,
      reason_code_id, expected_version, current_version,
      resulting_version, occurred_at
    ) values (
      ${tenantA}, ${input.transitionId}, ${input.identityId},
      'claim_employee', 'employee', ${input.targetEmployeeId},
      null, null, null,
      null, null,
      ${input.claimId}, null,
      'manual', ${actorA},
      null, ${policyId}, 'v1',
      ${reasonCodeId}, null, null,
      1, ${t1}
    )
  `);
  await executor.execute(sql`
    update inbox_v2_source_external_identities
    set revision = 2, updated_at = ${t1}
    where tenant_id = ${tenantA}
      and id = ${input.identityId}
  `);
  await executor.execute(sql`
    update inbox_v2_source_identity_claim_heads
    set resolution_status = 'claimed',
        active_claim_id = ${input.claimId},
        latest_claim_version = 1
    where tenant_id = ${tenantA}
      and source_external_identity_id = ${input.identityId}
  `);
}

async function loadClaimSnapshot(
  db: HuleeDatabase,
  identityId: ReturnType<typeof identity>
) {
  const result = await db.execute<{
    identity_revision: string;
    resolution_status: string;
    active_claim_id: string | null;
    latest_claim_version: string | null;
    claims: string;
    active_claims: string;
    evidence: string;
    transitions: string;
  }>(sql`
    select
      identity_row.revision::text as identity_revision,
      head_row.resolution_status,
      head_row.active_claim_id,
      head_row.latest_claim_version::text,
      (
        select count(*)::text
        from inbox_v2_source_identity_claims claim_row
        where claim_row.tenant_id = identity_row.tenant_id
          and claim_row.source_external_identity_id = identity_row.id
      ) as claims,
      (
        select count(*)::text
        from inbox_v2_source_identity_claims claim_row
        where claim_row.tenant_id = identity_row.tenant_id
          and claim_row.source_external_identity_id = identity_row.id
          and claim_row.status = 'active'
      ) as active_claims,
      (
        select count(*)::text
        from inbox_v2_source_identity_claim_evidence_references evidence_row
        where evidence_row.tenant_id = identity_row.tenant_id
          and evidence_row.source_external_identity_id = identity_row.id
      ) as evidence,
      (
        select count(*)::text
        from inbox_v2_source_identity_claim_transitions transition_row
        where transition_row.tenant_id = identity_row.tenant_id
          and transition_row.source_external_identity_id = identity_row.id
      ) as transitions
    from inbox_v2_source_external_identities identity_row
    join inbox_v2_source_identity_claim_heads head_row
      on head_row.tenant_id = identity_row.tenant_id
     and head_row.source_external_identity_id = identity_row.id
    where identity_row.tenant_id = ${tenantA}
      and identity_row.id = ${identityId}
  `);
  const row = result.rows[0];
  if (row === undefined || result.rows.length !== 1) {
    throw new Error("Expected one SourceIdentityClaim aggregate snapshot.");
  }
  return row;
}

function loadAuthSentinel(db: HuleeDatabase) {
  return db.execute<AuthSentinel>(sql`
    select id, tenant_id, account_id, provider_id,
           external_subject, display_name
    from external_identity_links
    where id = ${authLinkId}
  `);
}

async function expectDatabaseFailure(
  operation: () => Promise<unknown>,
  expected: RegExp
) {
  let thrown: unknown;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeDefined();
  expect(formatDatabaseErrorChain(thrown)).toMatch(expected);
}

function formatDatabaseErrorChain(error: unknown) {
  const diagnostics: string[] = [];
  const visited = new Set<unknown>();
  let current = error;

  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    const record = current as Record<string, unknown>;
    for (const key of [
      "name",
      "message",
      "code",
      "constraint",
      "constraint_name",
      "detail"
    ]) {
      const value = record[key];
      if (typeof value === "string") {
        diagnostics.push(`${key}: ${value}`);
      }
    }
    current = record.cause;
  }

  return diagnostics.join("\n");
}

class PolicyUseGateExecutor implements InboxV2SourceIdentityClaimTransactionExecutor {
  private readonly locked = new AsyncLatch();
  private readonly release = new AsyncLatch();

  constructor(private readonly db: HuleeDatabase) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const result = await this.db.execute<Row>(query);
    return { rows: result.rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (
      transaction: InboxV2TenantPolicyAuthorityUseTransaction
    ) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    return this.db.transaction(async (transactionExecutor) => {
      const scopedTransaction = {
        execute: async <Row extends Record<string, unknown>>(
          query: SQL
        ): Promise<RawSqlQueryResult<Row>> => {
          const result = await transactionExecutor.execute<Row>(query);
          if (isExactPolicyUseLock(query)) {
            this.locked.open();
            await this.release.wait();
          }
          return { rows: result.rows as readonly Row[] };
        }
      } as unknown as InboxV2TenantPolicyAuthorityUseTransaction;
      return work(scopedTransaction);
    }, config);
  }

  waitUntilPolicyLocked(): Promise<void> {
    return this.locked.wait();
  }

  releasePolicyFence(): void {
    this.release.open();
  }
}

class PolicyRevokeAttemptExecutor implements InboxV2TenantPolicyAuthorityTransactionExecutor {
  private readonly attempted = new AsyncLatch();

  constructor(private readonly db: HuleeDatabase) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const result = await this.db.execute<Row>(query);
    return { rows: result.rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (
      transaction: InboxV2TenantPolicyAuthorityUseTransaction
    ) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    return this.db.transaction(async (transactionExecutor) => {
      const scopedTransaction = {
        execute: async <Row extends Record<string, unknown>>(
          query: SQL
        ): Promise<RawSqlQueryResult<Row>> => {
          const pending = transactionExecutor.execute<Row>(query);
          if (isPolicyHeadUpdateLock(query)) this.attempted.open();
          const result = await pending;
          return { rows: result.rows as readonly Row[] };
        }
      } as unknown as InboxV2TenantPolicyAuthorityUseTransaction;
      return work(scopedTransaction);
    }, config);
  }

  waitUntilHeadLockAttempted(): Promise<void> {
    return this.attempted.wait();
  }
}

function isExactPolicyUseLock(query: SQL): boolean {
  const statement = normalizedQuerySql(query);
  return (
    statement.includes(
      "from inbox_v2_tenant_policy_activation_heads head_row"
    ) && statement.includes("for share of head_row, version_row")
  );
}

function isPolicyHeadUpdateLock(query: SQL): boolean {
  const statement = normalizedQuerySql(query);
  return (
    statement.includes("from inbox_v2_tenant_policy_activation_heads") &&
    statement.includes("for update")
  );
}

class AsyncLatch {
  private opened = false;
  private readonly promise: Promise<void>;
  private resolve = (): void => undefined;

  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.resolve = resolve;
    });
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.resolve();
  }

  async wait(): Promise<void> {
    await Promise.race([
      this.promise,
      new Promise<never>((_, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for asynchronous latch.")),
          10_000
        );
        this.promise
          .finally(() => clearTimeout(timeout))
          .catch(() => undefined);
      })
    ]);
  }
}

class IdPrecheckBarrierExecutor implements InboxV2SourceIdentityClaimTransactionExecutor {
  private readonly barrier: AsyncBarrier;

  constructor(
    private readonly db: HuleeDatabase,
    private readonly table:
      | "inbox_v2_source_identity_claims"
      | "inbox_v2_source_identity_claim_transitions",
    parties: number
  ) {
    this.barrier = new AsyncBarrier(parties, table);
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const result = await this.db.execute<Row>(query);
    return { rows: result.rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (
      transaction: InboxV2TenantPolicyAuthorityUseTransaction
    ) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    return this.db.transaction(async (transactionExecutor) => {
      const scopedTransaction = {
        execute: async <Row extends Record<string, unknown>>(
          query: SQL
        ): Promise<RawSqlQueryResult<Row>> => {
          const result = await transactionExecutor.execute<Row>(query);
          if (
            result.rows.length === 0 &&
            isIdAbsencePrecheck(query, this.table)
          ) {
            await this.barrier.arrive();
          }
          return { rows: result.rows as readonly Row[] };
        }
      } as unknown as InboxV2TenantPolicyAuthorityUseTransaction;
      return work(scopedTransaction);
    }, config);
  }
}

class AsyncBarrier {
  private arrived = 0;
  private readonly opened: Promise<void>;
  private open = (): void => undefined;

  constructor(
    private readonly parties: number,
    private readonly label: string
  ) {
    this.opened = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  async arrive(): Promise<void> {
    this.arrived += 1;
    if (this.arrived === this.parties) this.open();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out waiting for ${this.label} barrier.`)),
        10_000
      );
      this.opened.then(
        () => {
          clearTimeout(timeout);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }
}

function isIdAbsencePrecheck(
  query: SQL,
  table:
    | "inbox_v2_source_identity_claims"
    | "inbox_v2_source_identity_claim_transitions"
) {
  const rendered = normalizedQuerySql(query);
  return rendered.includes(
    `select id from ${table} where tenant_id = $1 and id = $2`
  );
}

function normalizedQuerySql(query: SQL): string {
  return new PgDialect()
    .sqlToQuery(query)
    .sql.trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
