import {
  INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS,
  inboxV2ActivateTenantPolicyVersionCommandSchema,
  inboxV2ApproveTenantPolicyVersionCommandSchema,
  inboxV2BigintCounterSchema,
  inboxV2ClientContactIdSchema,
  inboxV2ClientIdSchema,
  inboxV2ConversationClientLinkDecisionSchema,
  inboxV2ConversationClientLinkIdSchema,
  inboxV2ConversationClientLinkSchema,
  inboxV2ConversationClientLinkTransitionIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationParticipantIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2IdentityClaimPolicyIdSchema,
  inboxV2IdentityClaimReasonIdSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2RevokeTenantPolicyVersionCommandSchema,
  inboxV2SchemaVersionTokenSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityClaimTransitionIdSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2SourceIdentityRealmIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TrustedServiceIdSchema,
  type InboxV2ClientContactId,
  type InboxV2ClientId,
  type InboxV2ConversationClientLink,
  type InboxV2ConversationClientLinkDecision,
  type InboxV2ConversationClientLinkId,
  type InboxV2ConversationId,
  type InboxV2ConversationParticipantId,
  type InboxV2EmployeeId,
  type InboxV2EntityRevision,
  type InboxV2RawInboundEventId,
  type InboxV2SourceAccountId,
  type InboxV2SourceExternalIdentity,
  type InboxV2SourceExternalIdentityId,
  type InboxV2SourceIdentityClaimId,
  type InboxV2SourceIdentityClaimVersion,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InboxV2TenantPolicyAuthorityUseTransaction } from "./sql-inbox-v2-tenant-policy-authority-repository";
import { createSqlInboxV2TenantPolicyAuthorityRepository } from "./sql-inbox-v2-tenant-policy-authority-repository";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2ConversationClientLinkRepository,
  type InboxV2ConversationClientLinkTransactionExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-conversation-client-link-repository";
import { createSqlInboxV2ConversationRepository } from "./sql-inbox-v2-conversation-repository";
import { createSqlInboxV2ParticipantMembershipRepository } from "./sql-inbox-v2-participant-membership-repository";
import {
  createSqlInboxV2SourceExternalIdentityRepository,
  type FindOrCreateInboxV2SourceExternalIdentityInput
} from "./sql-inbox-v2-source-external-identity-repository";
import {
  createSqlInboxV2SourceIdentityClaimRepository,
  type ApplyInboxV2SourceIdentityClaimTransitionInput
} from "./sql-inbox-v2-source-identity-claim-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantA = tenant("a");
const tenantB = tenant("b");
const connectionA = inboxV2SourceConnectionIdSchema.parse(
  `source_connection:db002-link-claim-a-${runId}`
);
const connectionB = inboxV2SourceConnectionIdSchema.parse(
  `source_connection:db002-link-claim-b-${runId}`
);
const accountA = inboxV2SourceAccountIdSchema.parse(
  `source_account:db002-link-claim-a-${runId}`
);
const accountB = inboxV2SourceAccountIdSchema.parse(
  `source_account:db002-link-claim-b-${runId}`
);
const rawA = inboxV2RawInboundEventIdSchema.parse(
  `raw_inbound_event:db002-link-claim-a-${runId}`
);
const rawB = inboxV2RawInboundEventIdSchema.parse(
  `raw_inbound_event:db002-link-claim-b-${runId}`
);
const actorA = employee("actor-a");
const actorB = employee("actor-b");
const targetEmployeeA = employee("target-a");
const clientA = client("client-a");
const clientA2 = client("client-a2");
const clientB = client("client-b");
const contactA = contact("contact-a");
const contactA2 = contact("contact-a2");
const contactB = contact("contact-b");
const claimPolicyId = inboxV2IdentityClaimPolicyIdSchema.parse(
  "core:manual-identity-claim"
);
const claimReasonCodeId = inboxV2IdentityClaimReasonIdSchema.parse(
  "core:verified-source-evidence"
);
const verificationServiceId = inboxV2TrustedServiceIdSchema.parse(
  "core:client-link-resolver"
);
const clientLinkPolicyId = "core:identity-claim-client-link" as const;
const clientLinkPolicyDigest = "a".repeat(64);
const t0 = "2026-07-14T04:00:00.000Z";
const t1 = "2026-07-14T04:01:00.000Z";
const t2 = "2026-07-14T04:02:00.000Z";
const t3 = "2026-07-14T04:03:00.000Z";
const t4 = "2026-07-14T04:04:00.000Z";
const realm = {
  realmId: inboxV2SourceIdentityRealmIdSchema.parse(
    "module:telegram-user-session:mtproto-user"
  ),
  version: inboxV2SchemaVersionTokenSchema.parse("v1"),
  canonicalizationVersion: inboxV2SchemaVersionTokenSchema.parse("v1")
};

describePostgres(
  "SQL Inbox V2 claim-backed ConversationClientLink (PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{
        claims: string | null;
        claimHeads: string | null;
        participants: string | null;
        links: string | null;
        claimColumns: string;
      }>(sql`
        select
          to_regclass(
            'public.inbox_v2_source_identity_claims'
          )::text as claims,
          to_regclass(
            'public.inbox_v2_source_identity_claim_heads'
          )::text as "claimHeads",
          to_regclass(
            'public.inbox_v2_conversation_participants'
          )::text as participants,
          to_regclass(
            'public.inbox_v2_conversation_client_links'
          )::text as links,
          (
            select count(*)::text
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'inbox_v2_conversation_client_links'
              and column_name in (
                'provenance_claim_id',
                'provenance_claim_version',
                'provenance_claim_target_client_contact_id',
                'provenance_verification_service_id',
                'provenance_verification_verified_at'
              )
          ) as "claimColumns"
      `);
      const ready = readiness.rows[0];
      if (
        ready === undefined ||
        ready.claims === null ||
        ready.claimHeads === null ||
        ready.participants === null ||
        ready.links === null ||
        ready.claimColumns !== "5"
      ) {
        throw new Error(
          "Inbox V2 claim-backed Client-link PostgreSQL invariants are not migrated."
        );
      }

      await db.execute(sql`
        insert into tenants (
          id, slug, display_name, deployment_type, created_at, updated_at
        ) values
          (
            ${tenantA}, ${`db002-link-claim-a-${runId}`},
            'DB002 link claim tenant A', 'saas_shared', ${t0}, ${t0}
          ),
          (
            ${tenantB}, ${`db002-link-claim-b-${runId}`},
            'DB002 link claim tenant B', 'saas_shared', ${t0}, ${t0}
          )
      `);
      await db.execute(sql`
        insert into source_connections (
          id, tenant_id, source_type, source_name, display_name
        ) values
          (
            ${connectionA}, ${tenantA}, 'messenger', 'telegram',
            'DB002 link claim connection A'
          ),
          (
            ${connectionB}, ${tenantB}, 'messenger', 'telegram',
            'DB002 link claim connection B'
          )
      `);
      await db.execute(sql`
        insert into source_accounts (
          id, tenant_id, source_connection_id, account_type, display_name
        ) values
          (
            ${accountA}, ${tenantA}, ${connectionA}, 'direct_number',
            'DB002 link claim account A'
          ),
          (
            ${accountB}, ${tenantB}, ${connectionB}, 'direct_number',
            'DB002 link claim account B'
          )
      `);
      await db.execute(sql`
        insert into raw_inbound_events (
          id, tenant_id, source_connection_id, source_account_id,
          idempotency_key, payload
        ) values
          (
            ${rawA}, ${tenantA}, ${connectionA}, ${accountA},
            ${`db002-link-claim-raw-a-${runId}`}, '{}'::jsonb
          ),
          (
            ${rawB}, ${tenantB}, ${connectionB}, ${accountB},
            ${`db002-link-claim-raw-b-${runId}`}, '{}'::jsonb
          )
      `);
      await db.execute(sql`
        insert into employees (
          id, tenant_id, email, display_name, profile,
          created_at, updated_at
        ) values
          (
            ${actorA}, ${tenantA}, ${`db002-link-claim-actor-a-${runId}@example.test`},
            'DB002 link claim actor A', '{}'::jsonb, ${t0}, ${t0}
          ),
          (
            ${actorB}, ${tenantB}, ${`db002-link-claim-actor-b-${runId}@example.test`},
            'DB002 link claim actor B', '{}'::jsonb, ${t0}, ${t0}
          ),
          (
            ${targetEmployeeA}, ${tenantA},
            ${`db002-link-claim-target-a-${runId}@example.test`},
            'DB002 link claim Employee target', '{}'::jsonb, ${t0}, ${t0}
          )
      `);
      await db.execute(sql`
        insert into clients (
          id, tenant_id, display_name, source, created_at, updated_at
        ) values
          (
            ${clientA}, ${tenantA}, 'DB002 link claim Client A',
            'db002-integration', ${t0}, ${t0}
          ),
          (
            ${clientA2}, ${tenantA}, 'DB002 link claim Client A2',
            'db002-integration', ${t0}, ${t0}
          ),
          (
            ${clientB}, ${tenantB}, 'DB002 link claim Client B',
            'db002-integration', ${t0}, ${t0}
          )
      `);
      await db.execute(sql`
        insert into client_contacts (
          id, tenant_id, client_id, type, value, created_at, updated_at
        ) values
          (
            ${contactA}, ${tenantA}, ${clientA}, 'telegram',
            ${`db002-link-claim-contact-a-${runId}`}, ${t0}, ${t0}
          ),
          (
            ${contactA2}, ${tenantA}, ${clientA2}, 'telegram',
            ${`db002-link-claim-contact-a2-${runId}`}, ${t0}, ${t0}
          ),
          (
            ${contactB}, ${tenantB}, ${clientB}, 'telegram',
            ${`db002-link-claim-contact-b-${runId}`}, ${t0}, ${t0}
          )
      `);
      const policyRepository =
        createSqlInboxV2TenantPolicyAuthorityRepository(db);
      const approved = await policyRepository.approveVersion(
        inboxV2ApproveTenantPolicyVersionCommandSchema.parse({
          tenantId: tenantA,
          family: "conversation_client_link",
          policyId: clientLinkPolicyId,
          policyVersion: "v1",
          definitionContractVersion: "v1",
          definitionDigestSha256: clientLinkPolicyDigest,
          approvedTrustedServiceId: verificationServiceId,
          approvedBy: { tenantId: tenantA, kind: "employee", id: actorA },
          approvedAt: t0
        })
      );
      if (approved.kind !== "approved") {
        throw new Error(
          `Expected Client-link policy approval, got ${approved.kind}.`
        );
      }
      const activated = await policyRepository.activateVersion(
        inboxV2ActivateTenantPolicyVersionCommandSchema.parse({
          tenantId: tenantA,
          family: "conversation_client_link",
          policyId: clientLinkPolicyId,
          policyVersion: "v1",
          expectedHeadRevision: null,
          activatedBy: { tenantId: tenantA, kind: "employee", id: actorA },
          activatedAt: t1
        })
      );
      if (activated.kind !== "activated") {
        throw new Error(
          `Expected Client-link policy activation, got ${activated.kind}.`
        );
      }
    }, 30_000);

    afterAll(async () => {
      if (db) await closeHuleeDatabase(db);
    }, 30_000);

    it("commits an Employee-reviewed confirmed link with exact persisted claim anchors", async () => {
      const identityId = await seedIdentity(db, tenantA, accountA, "happy");
      const claimId = await createContactClaim(db, {
        tenantId: tenantA,
        identityId,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "happy",
        occurredAt: t1
      });
      const conversationId = await seedConversation(db, tenantA, "happy");
      await seedParticipant(db, tenantA, conversationId, identityId, "happy");
      const linkId = link("happy");
      const result = await createClaimBackedLink(db, {
        tenantId: tenantA,
        conversationId,
        clientId: clientA,
        claimId,
        actorEmployeeId: actorA,
        linkId,
        label: "happy",
        verifiedAt: t2,
        occurredAt: t2
      });

      expect(result).toMatchObject({
        kind: "applied",
        transition: {
          expectedRevision: null,
          currentRevision: null,
          resultingRevision: "1",
          resultingPrimaryLink: { id: linkId }
        }
      });
      const stored = await db.execute<{
        provenance_kind: string;
        provenance_claim_id: string;
        provenance_claim_version: string;
        provenance_claim_target_client_contact_id: string;
        provenance_verification_service_id: string;
        provenance_verification_verified_at: unknown;
        linked_actor_employee_id: string;
      }>(sql`
        select
          provenance_kind,
          provenance_claim_id,
          provenance_claim_version::text,
          provenance_claim_target_client_contact_id,
          provenance_verification_service_id,
          provenance_verification_verified_at,
          linked_actor_employee_id
        from inbox_v2_conversation_client_links
        where tenant_id = ${tenantA}
          and id = ${linkId}
      `);
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]).toMatchObject({
        provenance_kind: "source_identity_claim",
        provenance_claim_id: claimId,
        provenance_claim_version: "1",
        provenance_claim_target_client_contact_id: contactA,
        provenance_verification_service_id: verificationServiceId,
        linked_actor_employee_id: actorA
      });
      expect(
        databaseTimestamp(stored.rows[0]?.provenance_verification_verified_at)
      ).toBe(t2);
    });

    it("rejects a claim-backed link without the exact Conversation participant and rolls back", async () => {
      const identityId = await seedIdentity(
        db,
        tenantA,
        accountA,
        "missing-participant"
      );
      const claimId = await createContactClaim(db, {
        tenantId: tenantA,
        identityId,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "missing-participant",
        occurredAt: t1
      });
      const conversationId = await seedConversation(
        db,
        tenantA,
        "missing-participant"
      );

      expect(
        await createClaimBackedLink(db, {
          tenantId: tenantA,
          conversationId,
          clientId: clientA,
          claimId,
          actorEmployeeId: actorA,
          linkId: link("missing-participant"),
          label: "missing-participant",
          verifiedAt: t2,
          occurredAt: t2
        })
      ).toEqual({
        kind: "evidence_not_found",
        linkId: link("missing-participant"),
        purpose: "verification",
        ordinal: 1
      });
      expect(await loadLinkSnapshot(db, tenantA, conversationId)).toEqual({
        head_revision: null,
        links: "0",
        transitions: "0",
        operations: "0"
      });
    });

    it("rejects a claim whose contact belongs to another Client and an Employee-target claim", async () => {
      const wrongClientIdentity = await seedIdentity(
        db,
        tenantA,
        accountA,
        "wrong-client"
      );
      const wrongClientClaim = await createContactClaim(db, {
        tenantId: tenantA,
        identityId: wrongClientIdentity,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "wrong-client",
        occurredAt: t1
      });
      const wrongClientConversation = await seedConversation(
        db,
        tenantA,
        "wrong-client"
      );
      await seedParticipant(
        db,
        tenantA,
        wrongClientConversation,
        wrongClientIdentity,
        "wrong-client"
      );
      expect(
        await createClaimBackedLink(db, {
          tenantId: tenantA,
          conversationId: wrongClientConversation,
          clientId: clientA2,
          claimId: wrongClientClaim,
          actorEmployeeId: actorA,
          linkId: link("wrong-client"),
          label: "wrong-client",
          verifiedAt: t2,
          occurredAt: t2
        })
      ).toEqual({ kind: "claim_target_conflict", claimId: wrongClientClaim });

      const employeeIdentity = await seedIdentity(
        db,
        tenantA,
        accountA,
        "employee-target"
      );
      const employeeClaim = await createEmployeeClaim(db, {
        identityId: employeeIdentity,
        label: "employee-target",
        occurredAt: t1
      });
      const employeeConversation = await seedConversation(
        db,
        tenantA,
        "employee-target"
      );
      await seedParticipant(
        db,
        tenantA,
        employeeConversation,
        employeeIdentity,
        "employee-target"
      );
      expect(
        await createClaimBackedLink(db, {
          tenantId: tenantA,
          conversationId: employeeConversation,
          clientId: clientA,
          claimId: employeeClaim,
          actorEmployeeId: actorA,
          linkId: link("employee-target"),
          label: "employee-target",
          verifiedAt: t2,
          occurredAt: t2
        })
      ).toEqual({ kind: "claim_target_conflict", claimId: employeeClaim });
    });

    it("rejects claim episodes whose revocation predates the link", async () => {
      const revokedIdentity = await seedIdentity(
        db,
        tenantA,
        accountA,
        "revoked"
      );
      const revokedClaim = await createContactClaim(db, {
        tenantId: tenantA,
        identityId: revokedIdentity,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "revoked",
        occurredAt: t1
      });
      expect(
        await revokeClaim(
          db,
          revokedIdentity,
          "revoked-operation",
          version("1"),
          t2
        )
      ).toMatchObject({ kind: "applied" });
      const revokedConversation = await seedConversation(
        db,
        tenantA,
        "revoked"
      );
      await seedParticipant(
        db,
        tenantA,
        revokedConversation,
        revokedIdentity,
        "revoked"
      );
      expect(
        await createClaimBackedLink(db, {
          tenantId: tenantA,
          conversationId: revokedConversation,
          clientId: clientA,
          claimId: revokedClaim,
          actorEmployeeId: actorA,
          linkId: link("revoked"),
          label: "revoked",
          verifiedAt: t3,
          occurredAt: t3
        })
      ).toEqual({ kind: "claim_time_conflict", claimId: revokedClaim });

      const supersededIdentity = await seedIdentity(
        db,
        tenantA,
        accountA,
        "superseded"
      );
      const supersededClaim = await createContactClaim(db, {
        tenantId: tenantA,
        identityId: supersededIdentity,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "superseded-first",
        occurredAt: t1
      });
      await createContactClaim(db, {
        tenantId: tenantA,
        identityId: supersededIdentity,
        actorEmployeeId: actorA,
        targetContactId: contactA2,
        rawEventId: rawA,
        label: "superseded-second",
        expectedVersion: version("1"),
        occurredAt: t2
      });
      const supersededConversation = await seedConversation(
        db,
        tenantA,
        "superseded"
      );
      await seedParticipant(
        db,
        tenantA,
        supersededConversation,
        supersededIdentity,
        "superseded"
      );
      expect(
        await createClaimBackedLink(db, {
          tenantId: tenantA,
          conversationId: supersededConversation,
          clientId: clientA,
          claimId: supersededClaim,
          actorEmployeeId: actorA,
          linkId: link("superseded"),
          label: "superseded",
          verifiedAt: t3,
          occurredAt: t3
        })
      ).toEqual({ kind: "claim_time_conflict", claimId: supersededClaim });
    });

    it("rejects verification stamped before the claim was created", async () => {
      const identityId = await seedIdentity(
        db,
        tenantA,
        accountA,
        "time-conflict"
      );
      const claimId = await createContactClaim(db, {
        tenantId: tenantA,
        identityId,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "time-conflict",
        occurredAt: t2
      });
      const conversationId = await seedConversation(
        db,
        tenantA,
        "time-conflict"
      );
      await seedParticipant(
        db,
        tenantA,
        conversationId,
        identityId,
        "time-conflict"
      );

      expect(
        await createClaimBackedLink(db, {
          tenantId: tenantA,
          conversationId,
          clientId: clientA,
          claimId,
          actorEmployeeId: actorA,
          linkId: link("time-conflict"),
          label: "time-conflict",
          verifiedAt: t1,
          occurredAt: t3
        })
      ).toEqual({ kind: "claim_time_conflict", claimId });
      expect(await loadLinkSnapshot(db, tenantA, conversationId)).toMatchObject(
        {
          head_revision: null,
          links: "0",
          transitions: "0"
        }
      );
    });

    it("keeps claim provenance historical when the claim is later revoked and the link ended", async () => {
      const identityId = await seedIdentity(
        db,
        tenantA,
        accountA,
        "later-revoke"
      );
      const claimId = await createContactClaim(db, {
        tenantId: tenantA,
        identityId,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "later-revoke",
        occurredAt: t1
      });
      const conversationId = await seedConversation(
        db,
        tenantA,
        "later-revoke"
      );
      await seedParticipant(
        db,
        tenantA,
        conversationId,
        identityId,
        "later-revoke"
      );
      const linkId = link("later-revoke");
      expect(
        await createClaimBackedLink(db, {
          tenantId: tenantA,
          conversationId,
          clientId: clientA,
          claimId,
          actorEmployeeId: actorA,
          linkId,
          label: "later-revoke-create",
          participantLabel: "later-revoke",
          verifiedAt: t2,
          occurredAt: t2
        })
      ).toMatchObject({ kind: "applied" });
      expect(
        await revokeClaim(
          db,
          identityId,
          "later-revoke-claim",
          version("1"),
          t3
        )
      ).toMatchObject({ kind: "applied" });

      const decision = linkDecision(tenantA, actorA);
      const ended = await createSqlInboxV2ConversationClientLinkRepository(
        db
      ).applyTransition({
        tenantId: tenantA,
        conversationId,
        transitionId: linkTransition("later-revoke-end"),
        expectedRevision: revision("1"),
        decision,
        operations: [{ kind: "end_link", linkId }],
        resultingPrimaryLinkId: null,
        occurredAt: t4
      });
      expect(ended).toMatchObject({
        kind: "applied",
        transition: {
          expectedRevision: "1",
          currentRevision: "1",
          resultingRevision: "2",
          resultingPrimaryLink: null
        }
      });
      const stored = await db.execute<{
        state: string;
        revision: string;
        provenance_claim_id: string;
        ended_at: unknown;
      }>(sql`
        select state, revision::text, provenance_claim_id, ended_at
        from inbox_v2_conversation_client_links
        where tenant_id = ${tenantA}
          and id = ${linkId}
      `);
      expect(stored.rows[0]).toMatchObject({
        state: "ended",
        revision: "2",
        provenance_claim_id: claimId
      });
      expect(databaseTimestamp(stored.rows[0]?.ended_at)).toBe(t4);
    });

    it("serializes link creation before a concurrent later claim revocation", async () => {
      const identityId = await seedIdentity(
        db,
        tenantA,
        accountA,
        "concurrent-revoke"
      );
      const claimId = await createContactClaim(db, {
        tenantId: tenantA,
        identityId,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "concurrent-revoke",
        occurredAt: t1
      });
      const conversationId = await seedConversation(
        db,
        tenantA,
        "concurrent-revoke"
      );
      await seedParticipant(
        db,
        tenantA,
        conversationId,
        identityId,
        "concurrent-revoke"
      );
      const linkId = link("concurrent-revoke");
      const decision = linkDecision(tenantA, actorA);
      const candidate = claimBackedLink({
        tenantId: tenantA,
        conversationId,
        clientId: clientA,
        claimId,
        actorEmployeeId: actorA,
        linkId,
        participantId: participant("concurrent-revoke"),
        decision,
        verifiedAt: t2,
        occurredAt: t2
      });
      const gate = new ClaimShareLockGateExecutor(db);
      const linkPromise = createSqlInboxV2ConversationClientLinkRepository(
        gate
      ).applyTransition({
        tenantId: tenantA,
        conversationId,
        transitionId: linkTransition("concurrent-revoke-link"),
        expectedRevision: null,
        decision,
        operations: [{ kind: "create_link", link: candidate }],
        resultingPrimaryLinkId: linkId,
        occurredAt: t2
      });
      const holderPid = await gate.waitUntilClaimLocked();
      const revokePromise = revokeClaim(
        db,
        identityId,
        "concurrent-revoke-claim",
        version("1"),
        t4
      );

      try {
        await waitForTransactionBlockedBy(db, holderPid);
      } finally {
        gate.release();
      }

      const [linkResult, revokeResult] = await Promise.all([
        linkPromise,
        revokePromise
      ]);
      expect(linkResult).toMatchObject({ kind: "applied" });
      expect(revokeResult).toMatchObject({ kind: "applied" });
      const stored = await db.execute<{
        link_state: string;
        claim_status: string;
        revoked_at: unknown;
      }>(sql`
          select
            link_row.state as link_state,
            claim_row.status as claim_status,
            claim_row.revoked_at
          from inbox_v2_conversation_client_links link_row
          join inbox_v2_source_identity_claims claim_row
            on claim_row.tenant_id = link_row.tenant_id
           and claim_row.id = link_row.provenance_claim_id
           and claim_row.claim_version = link_row.provenance_claim_version
          where link_row.tenant_id = ${tenantA}
            and link_row.id = ${linkId}
        `);
      expect(stored.rows[0]).toMatchObject({
        link_state: "active",
        claim_status: "revoked"
      });
      expect(databaseTimestamp(stored.rows[0]?.revoked_at)).toBe(t4);
    }, 20_000);

    it("rejects a direct forged claim-backed row before it can bypass participant scope", async () => {
      const identityId = await seedIdentity(
        db,
        tenantA,
        accountA,
        "direct-forgery"
      );
      const claimId = await createContactClaim(db, {
        tenantId: tenantA,
        identityId,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "direct-forgery",
        occurredAt: t1
      });
      const conversationId = await seedConversation(
        db,
        tenantA,
        "direct-forgery"
      );

      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          await transaction.execute(sql`
            insert into inbox_v2_conversation_client_links (
              tenant_id,
              id,
              conversation_id,
              client_id,
              association_confidence,
              provenance_kind,
              provenance_claim_id,
              provenance_claim_version,
              provenance_claim_target_client_contact_id,
              provenance_verification_service_id,
              provenance_verification_policy_id,
              provenance_verification_policy_version,
              provenance_verification_verified_at,
              linked_actor_kind,
              linked_actor_employee_id,
              linked_policy_id,
              linked_policy_version,
              linked_reason_code_id,
              valid_from,
              valid_from_basis,
              state,
              revision
            ) values (
              ${tenantA},
              ${link("direct-forgery")},
              ${conversationId},
              ${clientA},
              'confirmed',
              'source_identity_claim',
              ${claimId},
              1,
              ${contactA},
              ${verificationServiceId},
              'core:identity-claim-client-link',
              'v1',
              ${t2},
              'employee',
              ${actorA},
              'core:identity-claim-client-link',
              'v1',
              'core:verified-identity-claim',
              ${t2},
              'known_effective',
              'active',
              1
            )
          `);
        }),
        /inbox_v2\.conversation_client_link_evidence_cardinality_invalid/u
      );
      expect(await loadLinkSnapshot(db, tenantA, conversationId)).toMatchObject(
        {
          head_revision: null,
          links: "0",
          transitions: "0"
        }
      );
    });

    it("does not resolve a same-ID request across a tenant boundary", async () => {
      const identityId = await seedIdentity(
        db,
        tenantB,
        accountB,
        "cross-tenant"
      );
      const claimId = await createContactClaim(db, {
        tenantId: tenantB,
        identityId,
        actorEmployeeId: actorB,
        targetContactId: contactB,
        rawEventId: rawB,
        label: "cross-tenant",
        occurredAt: t1
      });
      const conversationId = await seedConversation(
        db,
        tenantA,
        "cross-tenant"
      );

      expect(
        await createClaimBackedLink(db, {
          tenantId: tenantA,
          conversationId,
          clientId: clientA,
          claimId,
          actorEmployeeId: actorA,
          linkId: link("cross-tenant"),
          label: "cross-tenant",
          verifiedAt: t2,
          occurredAt: t2
        })
      ).toEqual({ kind: "claim_not_found", claimId });
      expect(await loadLinkSnapshot(db, tenantA, conversationId)).toMatchObject(
        {
          head_revision: null,
          links: "0",
          transitions: "0"
        }
      );
    });

    it("rejects a backdated claim revocation that would invalidate an existing link proof", async () => {
      const identityId = await seedIdentity(
        db,
        tenantA,
        accountA,
        "backdated-revoke"
      );
      const claimId = await createContactClaim(db, {
        tenantId: tenantA,
        identityId,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "backdated-revoke",
        occurredAt: t1
      });
      const conversationId = await seedConversation(
        db,
        tenantA,
        "backdated-revoke"
      );
      await seedParticipant(
        db,
        tenantA,
        conversationId,
        identityId,
        "backdated-revoke"
      );
      const linkId = link("backdated-revoke");
      expect(
        await createClaimBackedLink(db, {
          tenantId: tenantA,
          conversationId,
          clientId: clientA,
          claimId,
          actorEmployeeId: actorA,
          linkId,
          label: "backdated-revoke-link",
          participantLabel: "backdated-revoke",
          verifiedAt: t3,
          occurredAt: t3
        })
      ).toMatchObject({ kind: "applied" });

      await expectDatabaseFailure(
        revokeClaim(db, identityId, "backdated-revoke-claim", version("1"), t2),
        /inbox_v2\.conversation_client_link_claim_revocation_precedes_link/u
      );
      const claimState = await db.execute<{
        status: string;
        revoked_at: unknown;
        active_claim_id: string | null;
      }>(sql`
        select
          claim_row.status,
          claim_row.revoked_at,
          head_row.active_claim_id
        from inbox_v2_source_identity_claims claim_row
        join inbox_v2_source_identity_claim_heads head_row
          on head_row.tenant_id = claim_row.tenant_id
         and head_row.source_external_identity_id =
           claim_row.source_external_identity_id
        where claim_row.tenant_id = ${tenantA}
          and claim_row.id = ${claimId}
      `);
      expect(claimState.rows).toEqual([
        { status: "active", revoked_at: null, active_claim_id: claimId }
      ]);
      expect(await loadLinkSnapshot(db, tenantA, conversationId)).toMatchObject(
        {
          head_revision: "1",
          links: "1",
          transitions: "1"
        }
      );
    });

    it("persists exact trusted-policy authority and independent ordered evidence", async () => {
      const conversationId = await seedConversation(
        db,
        tenantA,
        "trusted-policy"
      );
      const participantId = await seedContactParticipant(
        db,
        tenantA,
        conversationId,
        contactA,
        "trusted-policy"
      );
      const decision = trustedLinkDecision();
      const linkId = link("trusted-policy");
      const result = await createSqlInboxV2ConversationClientLinkRepository(
        db
      ).applyTransition({
        tenantId: tenantA,
        conversationId,
        transitionId: linkTransition("trusted-policy"),
        expectedRevision: null,
        decision,
        operations: [
          {
            kind: "create_link",
            link: trustedPolicyLink({
              conversationId,
              participantId,
              linkId,
              decision,
              clientId: clientA,
              contactId: contactA,
              occurredAt: t2
            })
          }
        ],
        resultingPrimaryLinkId: linkId,
        occurredAt: t2
      });
      expect(result).toMatchObject({ kind: "applied" });

      const evidence = await db.execute<{
        purpose: string;
        ordinal: number;
        evidence_kind: string;
      }>(sql`
        select purpose, ordinal, evidence_kind
        from inbox_v2_conversation_client_link_evidence_references
        where tenant_id = ${tenantA}
          and link_id = ${linkId}
        order by purpose, ordinal
      `);
      expect(evidence.rows).toEqual([
        {
          purpose: "verification",
          ordinal: 0,
          evidence_kind: "client_contact"
        },
        {
          purpose: "verification",
          ordinal: 1,
          evidence_kind: "conversation_participant"
        },
        {
          purpose: "audit",
          ordinal: 0,
          evidence_kind: "conversation_participant"
        },
        { purpose: "audit", ordinal: 1, evidence_kind: "client_contact" }
      ]);
      const authority = await db.execute<{
        linked_policy_family: string;
        linked_policy_definition_digest_sha256: string;
        linked_policy_activation_head_revision: string;
        provenance_verification_policy_family: string;
      }>(sql`
        select
          linked_policy_family,
          linked_policy_definition_digest_sha256,
          linked_policy_activation_head_revision::text,
          provenance_verification_policy_family
        from inbox_v2_conversation_client_links
        where tenant_id = ${tenantA}
          and id = ${linkId}
      `);
      expect(authority.rows).toEqual([
        {
          linked_policy_family: "conversation_client_link",
          linked_policy_definition_digest_sha256: clientLinkPolicyDigest,
          linked_policy_activation_head_revision: "1",
          provenance_verification_policy_family: "conversation_client_link"
        }
      ]);

      await expectDatabaseFailure(
        db.execute(sql`
          update inbox_v2_conversation_client_link_evidence_references
          set ordinal = 2
          where tenant_id = ${tenantA}
            and link_id = ${linkId}
            and purpose = 'audit'
            and ordinal = 1
        `),
        /inbox_v2\.conversation_client_link_immutable/u
      );
    });

    it("accepts a trusted service only with an exact temporal claim bridge", async () => {
      const identityId = await seedIdentity(
        db,
        tenantA,
        accountA,
        "trusted-claim"
      );
      const claimId = await createContactClaim(db, {
        tenantId: tenantA,
        identityId,
        actorEmployeeId: actorA,
        targetContactId: contactA,
        rawEventId: rawA,
        label: "trusted-claim",
        occurredAt: t1
      });
      const conversationId = await seedConversation(
        db,
        tenantA,
        "trusted-claim"
      );
      const participantId = await seedParticipant(
        db,
        tenantA,
        conversationId,
        identityId,
        "trusted-claim"
      );
      const decision = trustedLinkDecision();
      const linkId = link("trusted-claim");
      const result = await createSqlInboxV2ConversationClientLinkRepository(
        db
      ).applyTransition({
        tenantId: tenantA,
        conversationId,
        transitionId: linkTransition("trusted-claim"),
        expectedRevision: null,
        decision,
        operations: [
          {
            kind: "create_link",
            link: claimBackedLink({
              tenantId: tenantA,
              conversationId,
              clientId: clientA,
              claimId,
              actorEmployeeId: actorA,
              linkId,
              participantId,
              decision,
              verifiedAt: t2,
              occurredAt: t2
            })
          }
        ],
        resultingPrimaryLinkId: linkId,
        occurredAt: t2
      });
      expect(result).toMatchObject({ kind: "applied" });
      const stored = await db.execute<{
        linked_actor_kind: string;
        linked_actor_service_id: string;
        provenance_claim_id: string;
      }>(sql`
        select linked_actor_kind, linked_actor_service_id, provenance_claim_id
        from inbox_v2_conversation_client_links
        where tenant_id = ${tenantA}
          and id = ${linkId}
      `);
      expect(stored.rows).toEqual([
        {
          linked_actor_kind: "trusted_service",
          linked_actor_service_id: verificationServiceId,
          provenance_claim_id: claimId
        }
      ]);
    });

    it("fences wrong or revoked trusted authority and preserves Employee recovery", async () => {
      const trustedPolicyConversation = await seedConversation(
        db,
        tenantA,
        "trusted-policy-revoke-gate"
      );
      const trustedPolicyParticipant = await seedContactParticipant(
        db,
        tenantA,
        trustedPolicyConversation,
        contactA,
        "trusted-policy-revoke-gate"
      );
      const trustedPolicyLinkId = link("trusted-policy-revoke-gate");
      const trustedDecision = trustedLinkDecision();
      expect(
        await createSqlInboxV2ConversationClientLinkRepository(
          db
        ).applyTransition({
          tenantId: tenantA,
          conversationId: trustedPolicyConversation,
          transitionId: linkTransition("trusted-policy-revoke-gate"),
          expectedRevision: null,
          decision: trustedDecision,
          operations: [
            {
              kind: "create_link",
              link: trustedPolicyLink({
                conversationId: trustedPolicyConversation,
                participantId: trustedPolicyParticipant,
                linkId: trustedPolicyLinkId,
                decision: trustedDecision,
                clientId: clientA,
                contactId: contactA,
                occurredAt: t2
              })
            }
          ],
          resultingPrimaryLinkId: trustedPolicyLinkId,
          occurredAt: t2
        })
      ).toMatchObject({ kind: "applied" });

      const wrongConversation = await seedConversation(
        db,
        tenantA,
        "trusted-wrong-policy"
      );
      const wrongParticipant = await seedContactParticipant(
        db,
        tenantA,
        wrongConversation,
        contactA,
        "trusted-wrong-policy"
      );
      const wrongDecision = trustedLinkDecision("b".repeat(64));
      const wrongLinkId = link("trusted-wrong-policy");
      expect(
        await createSqlInboxV2ConversationClientLinkRepository(
          db
        ).applyTransition({
          tenantId: tenantA,
          conversationId: wrongConversation,
          transitionId: linkTransition("trusted-wrong-policy"),
          expectedRevision: null,
          decision: wrongDecision,
          operations: [
            {
              kind: "create_link",
              link: trustedPolicyLink({
                conversationId: wrongConversation,
                participantId: wrongParticipant,
                linkId: wrongLinkId,
                decision: wrongDecision,
                clientId: clientA,
                contactId: contactA,
                occurredAt: t2
              })
            }
          ],
          resultingPrimaryLinkId: wrongLinkId,
          occurredAt: t2
        })
      ).toEqual({
        kind: "definition_digest_conflict",
        currentDefinitionDigestSha256: clientLinkPolicyDigest,
        currentHeadRevision: "1"
      });
      expect(
        await loadLinkSnapshot(db, tenantA, wrongConversation)
      ).toMatchObject({ head_revision: null, links: "0", transitions: "0" });

      const revoked = await createSqlInboxV2TenantPolicyAuthorityRepository(
        db
      ).revokeVersion(
        inboxV2RevokeTenantPolicyVersionCommandSchema.parse({
          tenantId: tenantA,
          family: "conversation_client_link",
          policyId: clientLinkPolicyId,
          policyVersion: "v1",
          expectedHeadRevision: "1",
          revokedBy: { tenantId: tenantA, kind: "employee", id: actorA },
          revokedAt: t3
        })
      );
      expect(revoked).toMatchObject({
        kind: "revoked",
        activation: { state: "revoked", revision: "2" }
      });

      expect(
        await createSqlInboxV2ConversationClientLinkRepository(
          db
        ).applyTransition({
          tenantId: tenantA,
          conversationId: trustedPolicyConversation,
          transitionId: linkTransition("trusted-policy-revoked-end"),
          expectedRevision: revision("1"),
          decision: trustedLinkDecision(),
          operations: [{ kind: "end_link", linkId: trustedPolicyLinkId }],
          resultingPrimaryLinkId: null,
          occurredAt: t4
        })
      ).toEqual({ kind: "policy_inactive", currentHeadRevision: "2" });
      expect(
        await loadLinkSnapshot(db, tenantA, trustedPolicyConversation)
      ).toMatchObject({ head_revision: "1", links: "1", transitions: "1" });

      expect(
        await createSqlInboxV2ConversationClientLinkRepository(
          db
        ).applyTransition({
          tenantId: tenantA,
          conversationId: trustedPolicyConversation,
          transitionId: linkTransition("trusted-policy-employee-end"),
          expectedRevision: revision("1"),
          decision: linkDecision(tenantA, actorA),
          operations: [{ kind: "end_link", linkId: trustedPolicyLinkId }],
          resultingPrimaryLinkId: null,
          occurredAt: t4
        })
      ).toMatchObject({ kind: "applied" });

      const directConversation = await seedConversation(
        db,
        tenantA,
        "trusted-direct-revoked"
      );
      await expectDatabaseFailure(
        insertDirectTrustedPolicyLink(db, directConversation),
        /inbox_v2\.conversation_client_link_policy_not_current/u
      );

      const futureEmployee = employee("future-actor");
      await db.execute(sql`
        insert into employees (
          id, tenant_id, email, display_name, profile, created_at, updated_at
        ) values (
          ${futureEmployee}, ${tenantA},
          ${`db002-link-claim-future-${runId}@example.test`},
          'DB002 future actor', '{}'::jsonb, ${t4}, ${t4}
        )
      `);
      const employeeConversation = await seedConversation(
        db,
        tenantA,
        "employee-direct-before-created"
      );
      await expectDatabaseFailure(
        insertDirectManualLink(db, employeeConversation, futureEmployee, t3),
        /inbox_v2\.conversation_client_link_employee_inactive/u
      );
    });
  }
);

async function seedIdentity(
  db: HuleeDatabase,
  checkedTenantId: InboxV2TenantId,
  sourceAccountId: InboxV2SourceAccountId,
  label: string
): Promise<InboxV2SourceExternalIdentityId> {
  const id = identity(label);
  const scope: InboxV2SourceExternalIdentity["scope"] = {
    kind: "source_account",
    owner: {
      tenantId: checkedTenantId,
      kind: "source_account",
      id: sourceAccountId
    }
  };
  const input: FindOrCreateInboxV2SourceExternalIdentityInput = {
    tenantId: checkedTenantId,
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
      scopeKind: "source_account",
      decisionStrength: "safe_default"
    } as never,
    materializationAuthority: {
      kind: "trusted_service",
      tenantId: checkedTenantId,
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
  if (result.kind !== "created") {
    throw new Error(
      `Expected seeded SourceExternalIdentity, got ${result.kind}.`
    );
  }
  return id;
}

async function createContactClaim(
  db: HuleeDatabase,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    identityId: InboxV2SourceExternalIdentityId;
    actorEmployeeId: InboxV2EmployeeId;
    targetContactId: InboxV2ClientContactId;
    rawEventId: InboxV2RawInboundEventId;
    label: string;
    expectedVersion?: InboxV2SourceIdentityClaimVersion | null;
    occurredAt: string;
  }>
): Promise<InboxV2SourceIdentityClaimId> {
  const claimId = claim(input.label);
  const result = await createSqlInboxV2SourceIdentityClaimRepository(
    db
  ).applyTransition({
    tenantId: input.tenantId,
    sourceExternalIdentityId: input.identityId,
    transitionId: claimTransition(input.label),
    expectedVersion: input.expectedVersion ?? null,
    operation: {
      kind: "claim_client_contact",
      claimId,
      clientContactId: input.targetContactId,
      confidence: "verified",
      evidenceReferences: [
        {
          kind: "raw_inbound_event",
          reference: {
            tenantId: input.tenantId,
            kind: "raw_inbound_event",
            id: input.rawEventId
          }
        }
      ]
    },
    decision: {
      kind: "manual",
      actorEmployee: {
        tenantId: input.tenantId,
        kind: "employee",
        id: input.actorEmployeeId
      },
      reviewState: "approved"
    },
    policyId: claimPolicyId,
    policyVersion: "v1",
    reasonCodeId: claimReasonCodeId,
    occurredAt: input.occurredAt
  });
  if (result.kind !== "applied") {
    throw new Error(`Expected seeded ClientContact claim, got ${result.kind}.`);
  }
  return claimId;
}

async function createEmployeeClaim(
  db: HuleeDatabase,
  input: Readonly<{
    identityId: InboxV2SourceExternalIdentityId;
    label: string;
    occurredAt: string;
  }>
): Promise<InboxV2SourceIdentityClaimId> {
  const claimId = claim(input.label);
  const result = await createSqlInboxV2SourceIdentityClaimRepository(
    db
  ).applyTransition({
    tenantId: tenantA,
    sourceExternalIdentityId: input.identityId,
    transitionId: claimTransition(input.label),
    expectedVersion: null,
    operation: {
      kind: "claim_employee",
      claimId,
      employeeId: targetEmployeeA,
      confidence: "verified",
      evidenceReferences: [
        {
          kind: "raw_inbound_event",
          reference: {
            tenantId: tenantA,
            kind: "raw_inbound_event",
            id: rawA
          }
        }
      ]
    },
    decision: {
      kind: "manual",
      actorEmployee: {
        tenantId: tenantA,
        kind: "employee",
        id: actorA
      },
      reviewState: "approved"
    },
    policyId: claimPolicyId,
    policyVersion: "v1",
    reasonCodeId: claimReasonCodeId,
    occurredAt: input.occurredAt
  });
  if (result.kind !== "applied") {
    throw new Error(`Expected seeded Employee claim, got ${result.kind}.`);
  }
  return claimId;
}

function revokeClaim(
  db: HuleeDatabase,
  identityId: InboxV2SourceExternalIdentityId,
  label: string,
  expectedVersion: InboxV2SourceIdentityClaimVersion,
  occurredAt: string
) {
  const input: ApplyInboxV2SourceIdentityClaimTransitionInput = {
    tenantId: tenantA,
    sourceExternalIdentityId: identityId,
    transitionId: claimTransition(label),
    expectedVersion,
    operation: { kind: "revoke" },
    decision: {
      kind: "manual",
      actorEmployee: {
        tenantId: tenantA,
        kind: "employee",
        id: actorA
      },
      reviewState: "approved"
    },
    policyId: claimPolicyId,
    policyVersion: "v1",
    reasonCodeId: claimReasonCodeId,
    occurredAt
  };
  return createSqlInboxV2SourceIdentityClaimRepository(db).applyTransition(
    input
  );
}

async function seedConversation(
  db: HuleeDatabase,
  checkedTenantId: InboxV2TenantId,
  label: string
): Promise<InboxV2ConversationId> {
  const conversationId = conversation(label);
  const result = await createSqlInboxV2ConversationRepository(db).create({
    tenantId: checkedTenantId,
    conversationId,
    topology: "group",
    transport: "external",
    purposeId: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
    lifecycle: "active",
    streamPosition: inboxV2BigintCounterSchema.parse("1"),
    createdAt: t0
  });
  if (result.kind !== "created") {
    throw new Error(`Expected seeded Conversation, got ${result.kind}.`);
  }
  return conversationId;
}

async function seedParticipant(
  db: HuleeDatabase,
  checkedTenantId: InboxV2TenantId,
  conversationId: InboxV2ConversationId,
  identityId: InboxV2SourceExternalIdentityId,
  label: string
): Promise<InboxV2ConversationParticipantId> {
  const participantId = participant(label);
  const result = await createSqlInboxV2ParticipantMembershipRepository(
    db
  ).createParticipant({
    tenantId: checkedTenantId,
    id: participantId,
    conversationId,
    subject: {
      kind: "source_external_identity",
      sourceExternalIdentity: {
        tenantId: checkedTenantId,
        kind: "source_external_identity",
        id: identityId
      }
    },
    createdAt: t0
  });
  if (result.kind !== "created") {
    throw new Error(`Expected seeded participant, got ${result.kind}.`);
  }
  return participantId;
}

async function seedContactParticipant(
  db: HuleeDatabase,
  checkedTenantId: InboxV2TenantId,
  conversationId: InboxV2ConversationId,
  contactId: InboxV2ClientContactId,
  label: string
): Promise<InboxV2ConversationParticipantId> {
  const participantId = participant(label);
  const result = await createSqlInboxV2ParticipantMembershipRepository(
    db
  ).createParticipant({
    tenantId: checkedTenantId,
    id: participantId,
    conversationId,
    subject: {
      kind: "client_contact",
      clientContact: {
        tenantId: checkedTenantId,
        kind: "client_contact",
        id: contactId
      }
    },
    createdAt: t0
  });
  if (result.kind !== "created") {
    throw new Error(
      `Expected seeded ClientContact participant, got ${result.kind}.`
    );
  }
  return participantId;
}

async function createClaimBackedLink(
  db: HuleeDatabase,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    clientId: InboxV2ClientId;
    claimId: InboxV2SourceIdentityClaimId;
    actorEmployeeId: InboxV2EmployeeId;
    linkId: InboxV2ConversationClientLinkId;
    label: string;
    participantLabel?: string;
    verifiedAt: string;
    occurredAt: string;
  }>
) {
  const decision = linkDecision(input.tenantId, input.actorEmployeeId);
  const candidate = claimBackedLink({
    ...input,
    participantId: participant(input.participantLabel ?? input.label),
    decision
  });
  return createSqlInboxV2ConversationClientLinkRepository(db).applyTransition({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    transitionId: linkTransition(input.label),
    expectedRevision: null,
    decision,
    operations: [{ kind: "create_link", link: candidate }],
    resultingPrimaryLinkId: input.linkId,
    occurredAt: input.occurredAt
  });
}

function claimBackedLink(
  input: Readonly<{
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    clientId: InboxV2ClientId;
    claimId: InboxV2SourceIdentityClaimId;
    actorEmployeeId: InboxV2EmployeeId;
    linkId: InboxV2ConversationClientLinkId;
    participantId: InboxV2ConversationParticipantId;
    decision: InboxV2ConversationClientLinkDecision;
    verifiedAt: string;
    occurredAt: string;
  }>
): InboxV2ConversationClientLink {
  const claimReference = {
    tenantId: input.tenantId,
    kind: "source_identity_claim" as const,
    id: input.claimId
  };
  return inboxV2ConversationClientLinkSchema.parse({
    tenantId: input.tenantId,
    id: input.linkId,
    conversation: {
      tenantId: input.tenantId,
      kind: "conversation",
      id: input.conversationId
    },
    client: {
      tenantId: input.tenantId,
      kind: "client",
      id: input.clientId
    },
    roleIds: [INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.subject],
    associationConfidence: "confirmed",
    provenance: {
      kind: "source_identity_claim",
      claim: claimReference,
      verification: {
        tenantId: input.tenantId,
        conversation: {
          tenantId: input.tenantId,
          kind: "conversation",
          id: input.conversationId
        },
        client: {
          tenantId: input.tenantId,
          kind: "client",
          id: input.clientId
        },
        policyId: input.decision.policyId,
        policyVersion: input.decision.policyVersion,
        verifiedByTrustedServiceId: verificationServiceId,
        verifiedAt: input.verifiedAt,
        policyAuthority: input.decision.policyAuthority,
        evidenceReferences: [
          { kind: "source_identity_claim", reference: claimReference },
          {
            kind: "conversation_participant",
            reference: {
              tenantId: input.tenantId,
              kind: "conversation_participant",
              id: input.participantId
            }
          }
        ]
      }
    },
    auditEvidenceReferences: [],
    linkedBy: input.decision,
    validFrom: input.occurredAt,
    validFromBasis: "known_effective",
    state: "active",
    termination: null,
    revision: "1"
  });
}

function linkDecision(
  checkedTenantId: InboxV2TenantId,
  actorEmployeeId: InboxV2EmployeeId
): InboxV2ConversationClientLinkDecision {
  return inboxV2ConversationClientLinkDecisionSchema.parse({
    actor: {
      kind: "employee",
      employee: {
        tenantId: checkedTenantId,
        kind: "employee",
        id: actorEmployeeId
      }
    },
    policyId: "core:identity-claim-client-link",
    policyVersion: "v1",
    reasonCodeId: "core:verified-identity-claim",
    policyAuthority: null
  });
}

function trustedLinkDecision(
  digest = clientLinkPolicyDigest
): InboxV2ConversationClientLinkDecision {
  return inboxV2ConversationClientLinkDecisionSchema.parse({
    actor: {
      kind: "trusted_service",
      trustedServiceId: verificationServiceId
    },
    policyId: clientLinkPolicyId,
    policyVersion: "v1",
    reasonCodeId: "core:verified-source-evidence",
    policyAuthority: {
      family: "conversation_client_link",
      definitionContractVersion: "v1",
      definitionDigestSha256: digest,
      activationHeadRevision: "1"
    }
  });
}

function trustedPolicyLink(
  input: Readonly<{
    conversationId: InboxV2ConversationId;
    participantId: InboxV2ConversationParticipantId;
    linkId: InboxV2ConversationClientLinkId;
    decision: InboxV2ConversationClientLinkDecision;
    clientId: InboxV2ClientId;
    contactId: InboxV2ClientContactId;
    occurredAt: string;
  }>
): InboxV2ConversationClientLink {
  if (
    input.decision.actor.kind !== "trusted_service" ||
    input.decision.policyAuthority === null
  ) {
    throw new Error("Trusted-policy fixture requires exact service authority.");
  }
  const contactEvidence = {
    kind: "client_contact" as const,
    reference: {
      tenantId: tenantA,
      kind: "client_contact" as const,
      id: input.contactId
    }
  };
  const participantEvidence = {
    kind: "conversation_participant" as const,
    reference: {
      tenantId: tenantA,
      kind: "conversation_participant" as const,
      id: input.participantId
    }
  };
  return inboxV2ConversationClientLinkSchema.parse({
    tenantId: tenantA,
    id: input.linkId,
    conversation: {
      tenantId: tenantA,
      kind: "conversation",
      id: input.conversationId
    },
    client: { tenantId: tenantA, kind: "client", id: input.clientId },
    roleIds: [INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.subject],
    associationConfidence: "confirmed",
    provenance: {
      kind: "trusted_policy",
      verification: {
        tenantId: tenantA,
        conversation: {
          tenantId: tenantA,
          kind: "conversation",
          id: input.conversationId
        },
        client: { tenantId: tenantA, kind: "client", id: input.clientId },
        policyId: input.decision.policyId,
        policyVersion: input.decision.policyVersion,
        verifiedByTrustedServiceId: input.decision.actor.trustedServiceId,
        verifiedAt: input.occurredAt,
        policyAuthority: input.decision.policyAuthority,
        evidenceReferences: [contactEvidence, participantEvidence]
      }
    },
    auditEvidenceReferences: [participantEvidence, contactEvidence],
    linkedBy: input.decision,
    validFrom: input.occurredAt,
    validFromBasis: "known_effective",
    state: "active",
    termination: null,
    revision: "1"
  });
}

async function loadLinkSnapshot(
  db: HuleeDatabase,
  checkedTenantId: InboxV2TenantId,
  conversationId: InboxV2ConversationId
) {
  const result = await db.execute<{
    head_revision: string | null;
    links: string;
    transitions: string;
    operations: string;
  }>(sql`
    select
      (
        select revision::text
        from inbox_v2_conversation_client_link_heads
        where tenant_id = ${checkedTenantId}
          and conversation_id = ${conversationId}
      ) as head_revision,
      (
        select count(*)::text
        from inbox_v2_conversation_client_links
        where tenant_id = ${checkedTenantId}
          and conversation_id = ${conversationId}
      ) as links,
      (
        select count(*)::text
        from inbox_v2_conversation_client_link_transitions
        where tenant_id = ${checkedTenantId}
          and conversation_id = ${conversationId}
      ) as transitions,
      (
        select count(*)::text
        from inbox_v2_conversation_client_link_transition_operations
        where tenant_id = ${checkedTenantId}
          and conversation_id = ${conversationId}
      ) as operations
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected Client-link snapshot row.");
  return row;
}

function insertDirectTrustedPolicyLink(
  db: HuleeDatabase,
  conversationId: InboxV2ConversationId
): Promise<unknown> {
  return db.execute(sql`
    insert into inbox_v2_conversation_client_links (
      tenant_id, id, conversation_id, client_id, association_confidence,
      provenance_kind, provenance_verification_service_id,
      provenance_verification_policy_id,
      provenance_verification_policy_version,
      provenance_verification_policy_family,
      provenance_verification_definition_contract_version,
      provenance_verification_definition_digest_sha256,
      provenance_verification_activation_head_revision,
      provenance_verification_verified_at,
      linked_actor_kind, linked_actor_service_id, linked_policy_id,
      linked_policy_version, linked_reason_code_id, linked_policy_family,
      linked_policy_definition_contract_version,
      linked_policy_definition_digest_sha256,
      linked_policy_activation_head_revision,
      valid_from, valid_from_basis, state, revision
    ) values (
      ${tenantA}, ${link("trusted-direct-revoked")}, ${conversationId},
      ${clientA}, 'confirmed', 'trusted_policy', ${verificationServiceId},
      ${clientLinkPolicyId}, 'v1', 'conversation_client_link', 'v1',
      ${clientLinkPolicyDigest}, 1, ${t4}, 'trusted_service',
      ${verificationServiceId}, ${clientLinkPolicyId}, 'v1',
      'core:verified-source-evidence', 'conversation_client_link', 'v1',
      ${clientLinkPolicyDigest}, 1, ${t4}, 'known_effective', 'active', 1
    )
  `);
}

function insertDirectManualLink(
  db: HuleeDatabase,
  conversationId: InboxV2ConversationId,
  actorEmployeeId: InboxV2EmployeeId,
  occurredAt: string
): Promise<unknown> {
  return db.execute(sql`
    insert into inbox_v2_conversation_client_links (
      tenant_id, id, conversation_id, client_id, association_confidence,
      provenance_kind, linked_actor_kind, linked_actor_employee_id,
      linked_policy_id, linked_policy_version, linked_reason_code_id,
      valid_from, valid_from_basis, state, revision
    ) values (
      ${tenantA}, ${link("employee-direct-before-created")}, ${conversationId},
      ${clientA}, 'confirmed', 'manual', 'employee', ${actorEmployeeId},
      'core:manual-client-link', 'v1', 'core:operator-linked-client',
      ${occurredAt}, 'known_effective', 'active', 1
    )
  `);
}

class ClaimShareLockGateExecutor implements InboxV2ConversationClientLinkTransactionExecutor {
  private holderPid: number | null = null;
  private readonly claimLocked: Promise<void>;
  private markClaimLocked = (): void => undefined;
  private readonly released: Promise<void>;
  private markReleased = (): void => undefined;

  constructor(private readonly db: HuleeDatabase) {
    this.claimLocked = new Promise<void>((resolve) => {
      this.markClaimLocked = resolve;
    });
    this.released = new Promise<void>((resolve) => {
      this.markReleased = resolve;
    });
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
      return work({
        execute: async <Row extends Record<string, unknown>>(
          query: SQL
        ): Promise<RawSqlQueryResult<Row>> => {
          const result = await transactionExecutor.execute<Row>(query);
          if (isClaimShareLock(query)) {
            const pidResult = await transactionExecutor.execute<{
              pid: number;
            }>(sql`select pg_backend_pid() as pid`);
            const pid = Number(pidResult.rows[0]?.pid);
            if (!Number.isSafeInteger(pid) || pid <= 0) {
              throw new Error(
                "Expected the claim-locking PostgreSQL backend PID."
              );
            }
            this.holderPid = pid;
            this.markClaimLocked();
            await this.released;
          }
          return { rows: result.rows as readonly Row[] };
        }
      } as InboxV2TenantPolicyAuthorityUseTransaction);
    }, config);
  }

  async waitUntilClaimLocked(): Promise<number> {
    await Promise.race([
      this.claimLocked,
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(new Error("Timed out waiting for the claim SHARE lock.")),
          5_000
        );
      })
    ]);
    if (this.holderPid === null) {
      throw new Error("Claim lock opened without its PostgreSQL backend PID.");
    }
    return this.holderPid;
  }

  release(): void {
    this.markReleased();
  }
}

function isClaimShareLock(query: SQL): boolean {
  const rendered = new PgDialect()
    .sqlToQuery(query)
    .sql.replaceAll('"', "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  return (
    rendered.includes("from inbox_v2_source_identity_claims claim_row") &&
    rendered.includes("for share of claim_row")
  );
}

async function waitForTransactionBlockedBy(
  db: HuleeDatabase,
  holderPid: number
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await db.execute<{ waiting: boolean }>(sql`
      select exists (
        select 1
        from pg_catalog.pg_locks holder_lock
        join pg_catalog.pg_locks waiter_lock
          on waiter_lock.locktype = 'transactionid'
         and waiter_lock.transactionid = holder_lock.transactionid
         and not waiter_lock.granted
        where holder_lock.pid = ${holderPid}
          and holder_lock.locktype = 'transactionid'
          and holder_lock.granted
      ) as waiting
    `);
    if (result.rows[0]?.waiting === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    "Timed out waiting for claim revocation to block on the link fence."
  );
}

async function expectDatabaseFailure(
  operation: Promise<unknown>,
  expected: RegExp
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(errorChainMessages(error)).toMatch(expected);
    return;
  }
  throw new Error(`Expected PostgreSQL operation to fail with ${expected}.`);
}

function errorChainMessages(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) break;
    visited.add(current);
    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return messages.join("\n");
}

function databaseTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const timestamp = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Expected a PostgreSQL timestamp value.");
  }
  return timestamp.toISOString();
}

function tenant(label: string): InboxV2TenantId {
  return inboxV2TenantIdSchema.parse(
    `tenant:db002-link-claim-${label}-${runId}`
  );
}

function employee(label: string): InboxV2EmployeeId {
  return inboxV2EmployeeIdSchema.parse(
    `employee:db002-link-claim-${label}-${runId}`
  );
}

function client(label: string): InboxV2ClientId {
  return inboxV2ClientIdSchema.parse(
    `client:db002-link-claim-${label}-${runId}`
  );
}

function contact(label: string): InboxV2ClientContactId {
  return inboxV2ClientContactIdSchema.parse(
    `client_contact:db002-link-claim-${label}-${runId}`
  );
}

function conversation(label: string): InboxV2ConversationId {
  return inboxV2ConversationIdSchema.parse(
    `conversation:db002-link-claim-${label}-${runId}`
  );
}

function participant(label: string): InboxV2ConversationParticipantId {
  return inboxV2ConversationParticipantIdSchema.parse(
    `conversation_participant:db002-link-claim-${label}-${runId}`
  );
}

function identity(label: string): InboxV2SourceExternalIdentityId {
  return inboxV2SourceExternalIdentityIdSchema.parse(
    `source_external_identity:db002-link-claim-${label}-${runId}`
  );
}

function claim(label: string): InboxV2SourceIdentityClaimId {
  return inboxV2SourceIdentityClaimIdSchema.parse(
    `source_identity_claim:db002-link-claim-${label}-${runId}`
  );
}

function claimTransition(label: string) {
  return inboxV2SourceIdentityClaimTransitionIdSchema.parse(
    `source_identity_claim_transition:db002-link-claim-${label}-${runId}`
  );
}

function link(label: string): InboxV2ConversationClientLinkId {
  return inboxV2ConversationClientLinkIdSchema.parse(
    `conversation_client_link:db002-link-claim-${label}-${runId}`
  );
}

function linkTransition(label: string) {
  return inboxV2ConversationClientLinkTransitionIdSchema.parse(
    `conversation_client_link_transition:db002-link-claim-${label}-${runId}`
  );
}

function version(value: string): InboxV2SourceIdentityClaimVersion {
  return inboxV2SourceIdentityClaimVersionSchema.parse(value);
}

function revision(value: string): InboxV2EntityRevision {
  return inboxV2EntityRevisionSchema.parse(value);
}
