import {
  inboxV2ProviderRosterMaterializationCommitSchema,
  inboxV2TenantIdSchema,
  type InboxV2ProviderRosterMaterializationCommit,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2ProviderParticipantMembershipRepository } from "./sql-inbox-v2-provider-participant-membership-repository";
import { createSqlInboxV2ProviderRosterEvidenceRepository } from "./sql-inbox-v2-provider-roster-evidence-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const baseAt = "2026-07-14T08:00:00.000Z";
const observedAt = "2026-07-14T08:01:00.000Z";
const materializedAt = "2026-07-14T08:02:00.000Z";
const adapterContract = {
  contractId: "module:synthetic-source:direct-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:group-surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: baseAt
} as const;

describePostgres(
  "SQL Inbox V2 provider roster evidence repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{
        roster: string | null;
        members: string | null;
        root_guard: string | null;
        member_guard: string | null;
        member_set_guard: string | null;
        membership_ordering_heads: string | null;
        membership_ordering_head_guard: string | null;
      }>(sql`
        select
          to_regclass('public.inbox_v2_provider_roster_evidence')::text as roster,
          to_regclass(
            'public.inbox_v2_provider_roster_member_evidence'
          )::text as members,
          to_regprocedure(
            'public.inbox_v2_provider_roster_guard_insert()'
          )::text as root_guard,
          to_regprocedure(
            'public.inbox_v2_provider_roster_member_guard_insert()'
          )::text as member_guard,
          to_regprocedure(
            'public.inbox_v2_assert_provider_roster_member_set(text,text)'
          )::text as member_set_guard,
          to_regclass(
            'public.inbox_v2_provider_membership_ordering_heads'
          )::text as membership_ordering_heads,
          to_regprocedure(
            'public.inbox_v2_provider_membership_ordering_head_guard()'
          )::text as membership_ordering_head_guard
      `);
      expect(readiness.rows[0]).toEqual({
        roster: "inbox_v2_provider_roster_evidence",
        members: "inbox_v2_provider_roster_member_evidence",
        root_guard: "inbox_v2_provider_roster_guard_insert()",
        member_guard: "inbox_v2_provider_roster_member_guard_insert()",
        member_set_guard:
          "inbox_v2_assert_provider_roster_member_set(text,text)",
        membership_ordering_heads:
          "inbox_v2_provider_membership_ordering_heads",
        membership_ordering_head_guard:
          "inbox_v2_provider_membership_ordering_head_guard()"
      });

      const seal = await db.execute<{
        trigger_name: string;
        deferrable: boolean;
        initially_deferred: boolean;
      }>(sql`
        select
          trigger_row.tgname as trigger_name,
          trigger_row.tgdeferrable as deferrable,
          trigger_row.tginitdeferred as initially_deferred
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid =
              'public.inbox_v2_provider_roster_evidence'::regclass
          and not trigger_row.tgisinternal
          and trigger_row.tgconstraint <> 0
        order by trigger_row.tgname
      `);
      expect(seal.rows).toEqual([
        {
          trigger_name: "inbox_v2_provider_roster_member_set_constraint",
          deferrable: true,
          initially_deferred: true
        }
      ]);
    });

    afterAll(async () => {
      if (db) await closeHuleeDatabase(db);
    });

    it.each(["raw", "normalized"] as const)(
      "materializes a canonical complete %s roster and persists its exact digest",
      async (observationKind) => {
        const fixture = makeFixture(`happy-${observationKind}`);
        await seedFixture(db, fixture);
        const commit = makeCommit(fixture, {
          observationKind,
          evidenceSuffix: `happy-${observationKind}`,
          identityKinds: [
            "connection",
            "account",
            observationKind === "raw" ? "ephemeralRaw" : "ephemeralNormalized"
          ]
        });

        const result =
          await createSqlInboxV2ProviderRosterEvidenceRepository(
            db
          ).materialize(commit);
        expect(result.kind).toBe("materialized");

        const stored = await persistedRoster(db, fixture.tenantId, commit);
        expect(stored.root).toMatchObject({
          observation_kind:
            observationKind === "raw"
              ? "raw_inbound_event"
              : "normalized_inbound_event",
          member_count: 3,
          completeness: "complete",
          authority: "authoritative",
          omission_policy: "close_missing"
        });
        expect(stored.root?.ordered_member_digest_sha256).toMatch(
          /^[0-9a-f]{64}$/u
        );
        expect(stored.members.map((member) => member.ordinal)).toEqual([
          0, 1, 2
        ]);
        expect(
          stored.members.map((member) => member.source_external_identity_id)
        ).toEqual(
          [...stored.members]
            .map((member) => member.source_external_identity_id)
            .sort(compareUtf8)
        );
        expect(stored.database_digest).toBe(
          stored.root?.ordered_member_digest_sha256
        );

        const sideEffects = await db.execute<{
          episodes: string;
          transitions: string;
        }>(sql`
          select
            (
              select count(*)::text
              from inbox_v2_participant_membership_episodes
              where tenant_id = ${fixture.tenantId}
            ) as episodes,
            (
              select count(*)::text
              from inbox_v2_participant_membership_transitions
              where tenant_id = ${fixture.tenantId}
            ) as transitions
        `);
        expect(sideEffects.rows[0]).toEqual({
          episodes: "0",
          transitions: "0"
        });
      }
    );

    it("returns exact aggregate and member ID conflicts without partial writes", async () => {
      const fixture = makeFixture("idempotency");
      await seedFixture(db, fixture);
      const repository = createSqlInboxV2ProviderRosterEvidenceRepository(db);
      const commit = makeCommit(fixture, {
        evidenceSuffix: "idempotency",
        identityKinds: ["account", "connection"]
      });

      await expect(repository.materialize(commit)).resolves.toMatchObject({
        kind: "materialized"
      });
      await expect(repository.materialize(commit)).resolves.toEqual({
        kind: "already_materialized",
        evidence: commit.evidence,
        members: [...commit.members].sort((left, right) =>
          compareUtf8(
            String(left.sourceExternalIdentity.id),
            String(right.sourceExternalIdentity.id)
          )
        )
      });

      const changed = makeCommit(fixture, {
        evidenceId: commit.evidence.id,
        evidenceSuffix: "idempotency",
        identityKinds: ["account", "connection"],
        watermark: "changed-watermark"
      });
      await expect(repository.materialize(changed)).resolves.toEqual({
        kind: "roster_evidence_id_conflict",
        evidenceId: commit.evidence.id
      });

      const memberConflict = makeCommit(fixture, {
        evidenceSuffix: "member-id-conflict",
        identityKinds: ["account"],
        memberIds: [commit.members[0]?.id as string]
      });
      await expect(repository.materialize(memberConflict)).resolves.toEqual({
        kind: "roster_member_evidence_id_conflict",
        memberEvidenceId: commit.members[0]?.id
      });

      const counts = await db.execute<{ roots: string; members: string }>(sql`
        select
          count(*)::text as roots,
          (
            select count(*)::text
            from inbox_v2_provider_roster_member_evidence member_row
            where member_row.tenant_id = ${fixture.tenantId}
          ) as members
        from inbox_v2_provider_roster_evidence root_row
        where root_row.tenant_id = ${fixture.tenantId}
      `);
      expect(counts.rows[0]).toEqual({ roots: "1", members: "2" });
    });

    it("serializes concurrent identical and conflicting commands to one typed aggregate", async () => {
      const identicalFixture = makeFixture("concurrent-identical");
      await seedFixture(db, identicalFixture);
      const identical = makeCommit(identicalFixture, {
        evidenceSuffix: "concurrent-identical",
        identityKinds: ["account"]
      });
      const identicalRepository =
        createSqlInboxV2ProviderRosterEvidenceRepository(db);

      const identicalResults = await Promise.all([
        identicalRepository.materialize(identical),
        identicalRepository.materialize(identical)
      ]);
      expect(identicalResults.map((result) => result.kind).sort()).toEqual([
        "already_materialized",
        "materialized"
      ]);
      expect(await rosterCount(db, identicalFixture.tenantId)).toBe("1");

      const conflictFixture = makeFixture("concurrent-conflict");
      await seedFixture(db, conflictFixture);
      const sharedId = rosterId("concurrent-conflict-shared");
      const first = makeCommit(conflictFixture, {
        evidenceSuffix: "concurrent-conflict-first",
        evidenceId: sharedId,
        identityKinds: ["account"],
        watermark: "watermark:first"
      });
      const second = makeCommit(conflictFixture, {
        evidenceSuffix: "concurrent-conflict-second",
        evidenceId: sharedId,
        identityKinds: ["connection"],
        watermark: "watermark:second"
      });
      const conflictRepository =
        createSqlInboxV2ProviderRosterEvidenceRepository(db);
      const conflictResults = await Promise.all([
        conflictRepository.materialize(first),
        conflictRepository.materialize(second)
      ]);

      expect(conflictResults.map((result) => result.kind).sort()).toEqual([
        "materialized",
        "roster_evidence_id_conflict"
      ]);
      expect(await rosterCount(db, conflictFixture.tenantId)).toBe("1");
      const persistedMembers = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_provider_roster_member_evidence
        where tenant_id = ${conflictFixture.tenantId}
          and roster_evidence_id = ${sharedId}
      `);
      expect(persistedMembers.rows[0]?.count).toBe("1");
    });

    it.each([
      ["providerMismatch", "member_identity_provider_scope_unproven"],
      ["wrongAccount", "member_identity_scope_conflict"],
      ["wrongEphemeral", "member_identity_scope_conflict"]
    ] as const)(
      "fails closed for %s identity evidence",
      async (identityKind, expectedKind) => {
        const fixture = makeFixture(`negative-${identityKind}`);
        await seedFixture(db, fixture);
        const commit = makeCommit(fixture, {
          evidenceSuffix: `negative-${identityKind}`,
          identityKinds: [identityKind]
        });

        await expect(
          createSqlInboxV2ProviderRosterEvidenceRepository(db).materialize(
            commit
          )
        ).resolves.toMatchObject({ kind: expectedKind });
        expect(await rosterCount(db, fixture.tenantId)).toBe("0");
      }
    );

    it("materializes provider-scoped identity evidence on the exact binding adapter surface", async () => {
      const fixture = makeFixture("provider-compatible");
      await seedFixture(db, fixture);
      const commit = makeCommit(fixture, {
        evidenceSuffix: "provider-compatible",
        identityKinds: ["provider"]
      });

      await expect(
        createSqlInboxV2ProviderRosterEvidenceRepository(db).materialize(commit)
      ).resolves.toMatchObject({ kind: "materialized" });
    });

    it("rejects observation/account scope mismatch before any roster write", async () => {
      const fixture = makeFixture("wrong-observation-scope");
      await seedFixture(db, fixture);
      const commit = makeCommit(fixture, {
        evidenceSuffix: "wrong-observation-scope",
        identityKinds: ["account"],
        rawEventId: fixture.alternateRawId
      });

      await expect(
        createSqlInboxV2ProviderRosterEvidenceRepository(db).materialize(commit)
      ).resolves.toEqual({
        kind: "observation_scope_conflict",
        observationKind: "raw_inbound_event"
      });
      expect(await rosterCount(db, fixture.tenantId)).toBe("0");
    });

    it("seals missing and wrong-digest sets, rejects late ordinals, and is immutable", async () => {
      const fixture = makeFixture("seal");
      await seedFixture(db, fixture);
      const commit = makeCommit(fixture, {
        evidenceSuffix: "seal",
        identityKinds: ["account", "connection"]
      });
      const repository = createSqlInboxV2ProviderRosterEvidenceRepository(db);
      expect((await repository.materialize(commit)).kind).toBe("materialized");

      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          await cloneRosterRoot(transaction, fixture.tenantId, {
            sourceId: commit.evidence.id,
            targetId: rosterId("seal-missing"),
            orderingPosition: 10_001n
          });
          await transaction.execute(sql`set constraints all immediate`);
        }),
        /inbox_v2\.provider_roster_member_set_invalid/u
      );

      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          const targetId = rosterId("seal-digest");
          await cloneRosterRoot(transaction, fixture.tenantId, {
            sourceId: commit.evidence.id,
            targetId,
            digest: "f".repeat(64),
            orderingPosition: 10_002n
          });
          await cloneRosterMembers(transaction, fixture.tenantId, {
            sourceId: commit.evidence.id,
            targetId,
            idSuffix: "seal-digest"
          });
          await transaction.execute(sql`set constraints all immediate`);
        }),
        /inbox_v2\.provider_roster_member_set_invalid/u
      );

      await expectDatabaseFailure(
        db.execute(sql`
          insert into inbox_v2_provider_roster_member_evidence (
            tenant_id, id, roster_evidence_id, source_thread_binding_id,
            external_thread_id, source_connection_id, source_account_id,
            ordinal, source_external_identity_id,
            source_external_identity_revision, state, normalized_role,
            provider_state_code, provider_role_code, observed_at,
            roster_recorded_at, revision, created_at, updated_at
          )
          select
            member_row.tenant_id,
            ${memberId("seal-late")},
            member_row.roster_evidence_id,
            member_row.source_thread_binding_id,
            member_row.external_thread_id,
            member_row.source_connection_id,
            member_row.source_account_id,
            root_row.member_count,
            member_row.source_external_identity_id,
            member_row.source_external_identity_revision,
            member_row.state,
            member_row.normalized_role,
            member_row.provider_state_code,
            member_row.provider_role_code,
            member_row.observed_at,
            member_row.roster_recorded_at,
            member_row.revision,
            member_row.created_at,
            member_row.updated_at
          from inbox_v2_provider_roster_member_evidence member_row
          join inbox_v2_provider_roster_evidence root_row
            on root_row.tenant_id = member_row.tenant_id
           and root_row.id = member_row.roster_evidence_id
          where member_row.tenant_id = ${fixture.tenantId}
            and member_row.roster_evidence_id = ${commit.evidence.id}
          order by member_row.ordinal
          limit 1
        `),
        /inbox_v2\.provider_roster_member_ordinal_out_of_range/u
      );

      await expectDatabaseFailure(
        db.execute(sql`
          update inbox_v2_provider_roster_evidence
          set watermark = 'forged'
          where tenant_id = ${fixture.tenantId}
            and id = ${commit.evidence.id}
        `),
        /inbox_v2\.provider_roster_immutable/u
      );
      expect(await rosterCount(db, fixture.tenantId)).toBe("1");
    });

    it("projects authoritative provider membership by strict roster ordering and keeps no-op evidence side-effect free", async () => {
      const fixture = makeFixture("provider-membership");
      await seedFixture(db, fixture);
      const membership = await seedProviderMembershipConversationGraph(
        db,
        fixture,
        "account"
      );
      const rosterRepository =
        createSqlInboxV2ProviderRosterEvidenceRepository(db);
      const membershipRepository =
        createSqlInboxV2ProviderParticipantMembershipRepository(db);

      const initial = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-initial",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "1"
      });
      expect((await rosterRepository.materialize(initial)).kind).toBe(
        "materialized"
      );
      await expect(
        membershipRepository.startProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          participantId: membership.participantId as never,
          episodeId: membership.membershipEpisodeId as never,
          transitionId: membershipTransitionId("initial") as never,
          rosterEvidenceId: initial.evidence.id,
          memberEvidenceId: initial.members[0]?.id as never,
          sourceThreadBindingId: fixture.bindingId as never,
          sourceExternalIdentityId: fixture.identityIds.account as never,
          role: "admin",
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "0" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({ kind: "created" });
      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "1",
        episodes: "1",
        head: "1",
        orderingHead: "1",
        state: "active",
        transitions: "1"
      });

      const advisory = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-advisory",
        identityKinds: ["account"],
        completeness: "partial",
        authority: "advisory",
        omissionPolicy: "retain_missing",
        orderingPosition: "4",
        normalizedRole: "member"
      });
      expect((await rosterRepository.materialize(advisory)).kind).toBe(
        "materialized"
      );
      await expect(
        membershipRepository.transitionProviderEpisode(
          providerMemberTransitionInput(fixture, membership, advisory, {
            positionLabel: "advisory",
            expectedMembershipRevision: "1",
            expectedEpisodeRevision: "1"
          })
        )
      ).resolves.toEqual({ kind: "evidence_not_authoritative" });

      await expect(
        membershipRepository.transitionProviderEpisode(
          providerMemberTransitionInput(fixture, membership, initial, {
            positionLabel: "equal",
            expectedMembershipRevision: "1",
            expectedEpisodeRevision: "1"
          })
        )
      ).resolves.toEqual({ kind: "evidence_stale" });

      const incomparable = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-incomparable",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "999",
        orderingComparatorId: "module:synthetic-source:other-sequence",
        normalizedRole: "member"
      });
      expect((await rosterRepository.materialize(incomparable)).kind).toBe(
        "materialized"
      );
      await expect(
        membershipRepository.transitionProviderEpisode(
          providerMemberTransitionInput(fixture, membership, incomparable, {
            positionLabel: "incomparable",
            expectedMembershipRevision: "1",
            expectedEpisodeRevision: "1"
          })
        )
      ).resolves.toEqual({ kind: "evidence_scope_conflict" });

      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "1",
        episodes: "1",
        head: "1",
        orderingHead: "1",
        state: "active",
        transitions: "1"
      });

      const explicitRole = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-role",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "2",
        normalizedRole: "member"
      });
      expect((await rosterRepository.materialize(explicitRole)).kind).toBe(
        "materialized"
      );
      await expect(
        membershipRepository.transitionProviderEpisode(
          providerMemberTransitionInput(fixture, membership, explicitRole, {
            positionLabel: "role",
            expectedMembershipRevision: "1",
            expectedEpisodeRevision: "1"
          })
        )
      ).resolves.toMatchObject({
        kind: "updated",
        record: { episode: { role: "member", revision: "2" } }
      });

      const omission = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-omission",
        identityKinds: [],
        completeness: "complete",
        authority: "authoritative",
        omissionPolicy: "close_missing",
        orderingPosition: "3"
      });
      expect((await rosterRepository.materialize(omission)).kind).toBe(
        "materialized"
      );
      await expect(
        membershipRepository.transitionProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          episodeId: membership.membershipEpisodeId as never,
          transitionId: membershipTransitionId("omission") as never,
          evidence: {
            kind: "roster_omission",
            rosterEvidenceId: omission.evidence.id,
            sourceThreadBindingId: fixture.bindingId as never,
            sourceExternalIdentityId: fixture.identityIds.account as never
          },
          intent: "leave",
          nextRole: null,
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "2" as never,
          expectedEpisodeRevision: "2" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({
        kind: "updated",
        record: { episode: { state: "left", revision: "3" } }
      });
      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "3",
        episodes: "1",
        head: "3",
        orderingHead: "3",
        state: "left",
        transitions: "3"
      });

      const sideEffects = await db.execute<{
        clientLinks: string;
        directGrants: string;
        workItems: string | null;
      }>(sql`
        select
          (
            select count(*)::text
            from inbox_v2_conversation_client_links
            where tenant_id = ${fixture.tenantId}
          ) as "clientLinks",
          (
            select count(*)::text
            from direct_permission_grants
            where tenant_id = ${fixture.tenantId}
          ) as "directGrants",
          case
            when to_regclass('public.work_items') is null then null
            else 'unexpected-table-present'
          end as "workItems"
      `);
      expect(sideEffects.rows[0]).toEqual({
        clientLinks: "0",
        directGrants: "0",
        workItems: null
      });
    });

    it("keeps one provider identity independent across two source-thread bindings", async () => {
      const fixture = makeFixture("provider-membership-dual-binding");
      await seedFixture(db, fixture);
      const membership = await seedProviderMembershipConversationGraph(
        db,
        fixture,
        "provider"
      );
      const secondBinding = makeSecondBindingFixture(fixture);
      await seedAdditionalBindingProjection(db, secondBinding);
      const rosterRepository =
        createSqlInboxV2ProviderRosterEvidenceRepository(db);
      const membershipRepository =
        createSqlInboxV2ProviderParticipantMembershipRepository(db);

      const firstOrigin = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-dual-first",
        identityKinds: ["provider"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "1"
      });
      const secondOrigin = makeCommit(secondBinding, {
        evidenceSuffix: "provider-membership-dual-second",
        identityKinds: ["provider"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "1"
      });
      await expect(
        rosterRepository.materialize(firstOrigin)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expect(
        rosterRepository.materialize(secondOrigin)
      ).resolves.toMatchObject({ kind: "materialized" });

      await expect(
        membershipRepository.startProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          participantId: membership.participantId as never,
          episodeId: membership.membershipEpisodeId as never,
          transitionId: membershipTransitionId("dual-first-origin") as never,
          rosterEvidenceId: firstOrigin.evidence.id,
          memberEvidenceId: firstOrigin.members[0]?.id as never,
          sourceThreadBindingId: fixture.bindingId as never,
          sourceExternalIdentityId: fixture.identityIds.provider as never,
          role: "admin",
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "0" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({ kind: "created" });
      const secondEpisodeId = `participant_membership_episode:db002-membership-${secondBinding.label}-${runId}`;
      await expect(
        membershipRepository.startProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          participantId: membership.participantId as never,
          episodeId: secondEpisodeId as never,
          transitionId: membershipTransitionId("dual-second-origin") as never,
          rosterEvidenceId: secondOrigin.evidence.id,
          memberEvidenceId: secondOrigin.members[0]?.id as never,
          sourceThreadBindingId: secondBinding.bindingId as never,
          sourceExternalIdentityId: fixture.identityIds.provider as never,
          role: "admin",
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "1" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({ kind: "created" });

      const firstAdvance = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-dual-first-advance",
        identityKinds: ["provider"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "2",
        normalizedRole: "member"
      });
      await expect(
        rosterRepository.materialize(firstAdvance)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expect(
        membershipRepository.transitionProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          episodeId: membership.membershipEpisodeId as never,
          transitionId: membershipTransitionId("dual-first-advance") as never,
          evidence: {
            kind: "member",
            rosterEvidenceId: firstAdvance.evidence.id,
            memberEvidenceId: firstAdvance.members[0]?.id as never,
            sourceThreadBindingId: fixture.bindingId as never,
            sourceExternalIdentityId: fixture.identityIds.provider as never
          },
          intent: "change_role",
          nextRole: "member",
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "2" as never,
          expectedEpisodeRevision: "1" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({ kind: "updated" });

      const episodes = await db.execute<{
        binding_id: string;
        ordering_position: string;
        role: string;
      }>(sql`
        select
          origin_source_thread_binding_id as binding_id,
          provider_ordering_head_position::text as ordering_position,
          role::text as role
        from inbox_v2_participant_membership_episodes
        where tenant_id = ${fixture.tenantId}
        order by origin_source_thread_binding_id
      `);
      expect(
        Object.fromEntries(
          episodes.rows.map((row) => [
            row.binding_id,
            { position: row.ordering_position, role: row.role }
          ])
        )
      ).toEqual({
        [fixture.bindingId]: { position: "2", role: "member" },
        [secondBinding.bindingId]: { position: "1", role: "admin" }
      });
      const aggregate = await db.execute<{
        commits: string;
        head: string;
        transitions: string;
      }>(sql`
        select
          (
            select count(*)::text
            from inbox_v2_conversation_membership_commits
            where tenant_id = ${fixture.tenantId}
          ) as commits,
          membership_revision::text as head,
          (
            select count(*)::text
            from inbox_v2_participant_membership_transitions
            where tenant_id = ${fixture.tenantId}
          ) as transitions
        from inbox_v2_conversation_membership_heads
        where tenant_id = ${fixture.tenantId}
          and conversation_id = ${membership.conversationId}
      `);
      expect(aggregate.rows[0]).toEqual({
        commits: "3",
        head: "3",
        transitions: "3"
      });
    });

    it("serializes concurrent reuse of one member evidence to exactly one membership winner", async () => {
      const fixture = makeFixture("provider-membership-evidence-race");
      await seedFixture(db, fixture);
      const membership = await seedProviderMembershipConversationGraph(
        db,
        fixture,
        "account"
      );
      const rosterRepository =
        createSqlInboxV2ProviderRosterEvidenceRepository(db);
      const membershipRepository =
        createSqlInboxV2ProviderParticipantMembershipRepository(db);
      const origin = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-evidence-race-origin",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "1"
      });
      await expect(rosterRepository.materialize(origin)).resolves.toMatchObject(
        {
          kind: "materialized"
        }
      );

      const starts = ["a", "b"].map((label) => ({
        tenantId: fixture.tenantId,
        conversationId: membership.conversationId as never,
        participantId: membership.participantId as never,
        episodeId:
          `participant_membership_episode:db002-membership-race-${label}-${runId}` as never,
        transitionId: membershipTransitionId(`race-${label}`) as never,
        rosterEvidenceId: origin.evidence.id,
        memberEvidenceId: origin.members[0]?.id as never,
        sourceThreadBindingId: fixture.bindingId as never,
        sourceExternalIdentityId: fixture.identityIds.account as never,
        role: "admin" as const,
        reasonCodeId: "core:provider-roster-observed" as never,
        expectedMembershipRevision: "0" as never,
        occurredAt: observedAt
      }));
      const results = await Promise.all(
        starts.map((start) => membershipRepository.startProviderEpisode(start))
      );
      expect(results.map((result) => result.kind).sort()).toEqual([
        "created",
        "membership_revision_conflict"
      ]);
      const winnerIndex = results.findIndex(
        (result) => result.kind === "created"
      );
      const winningStart = starts[winnerIndex];
      expect(winningStart).toBeDefined();
      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "1",
        episodes: "1",
        head: "1",
        orderingHead: "1",
        state: "active",
        transitions: "1"
      });

      const terminal = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-evidence-race-terminal",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "2",
        memberState: "left",
        normalizedRole: "admin"
      });
      await expect(
        rosterRepository.materialize(terminal)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expect(
        membershipRepository.transitionProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          episodeId: winningStart?.episodeId as never,
          transitionId: membershipTransitionId("race-terminal") as never,
          evidence: {
            kind: "member",
            rosterEvidenceId: terminal.evidence.id,
            memberEvidenceId: terminal.members[0]?.id as never,
            sourceThreadBindingId: fixture.bindingId as never,
            sourceExternalIdentityId: fixture.identityIds.account as never
          },
          intent: "leave",
          nextRole: null,
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "1" as never,
          expectedEpisodeRevision: "1" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({ kind: "updated" });
      await expect(
        membershipRepository.startProviderEpisode({
          ...starts[0],
          episodeId:
            `participant_membership_episode:db002-membership-race-reuse-${runId}` as never,
          transitionId: membershipTransitionId("race-reuse") as never,
          expectedMembershipRevision: "2" as never
        })
      ).resolves.toEqual({ kind: "evidence_reused" });
      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "2",
        episodes: "1",
        head: "2",
        orderingHead: "2",
        state: "left",
        transitions: "2"
      });
    });

    it("fences stale cross-episode evidence and serializes concurrent provider rejoins", async () => {
      const fixture = makeFixture("provider-membership-rejoin-ordering");
      await seedFixture(db, fixture);
      const membership = await seedProviderMembershipConversationGraph(
        db,
        fixture,
        "account"
      );
      const rosterRepository =
        createSqlInboxV2ProviderRosterEvidenceRepository(db);
      const membershipRepository =
        createSqlInboxV2ProviderParticipantMembershipRepository(db);

      const origin = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-rejoin-origin",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "1"
      });
      await expect(rosterRepository.materialize(origin)).resolves.toMatchObject(
        { kind: "materialized" }
      );
      await expect(
        membershipRepository.startProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          participantId: membership.participantId as never,
          episodeId: membership.membershipEpisodeId as never,
          transitionId: membershipTransitionId("rejoin-origin") as never,
          rosterEvidenceId: origin.evidence.id,
          memberEvidenceId: origin.members[0]?.id as never,
          sourceThreadBindingId: fixture.bindingId as never,
          sourceExternalIdentityId: fixture.identityIds.account as never,
          role: "admin",
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "0" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({ kind: "created" });

      const terminalAtTen = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-rejoin-terminal-10",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "10",
        memberState: "left",
        normalizedRole: "admin"
      });
      await expect(
        rosterRepository.materialize(terminalAtTen)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expect(
        membershipRepository.transitionProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          episodeId: membership.membershipEpisodeId as never,
          transitionId: membershipTransitionId("rejoin-terminal-10") as never,
          evidence: {
            kind: "member",
            rosterEvidenceId: terminalAtTen.evidence.id,
            memberEvidenceId: terminalAtTen.members[0]?.id as never,
            sourceThreadBindingId: fixture.bindingId as never,
            sourceExternalIdentityId: fixture.identityIds.account as never
          },
          intent: "leave",
          nextRole: null,
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "1" as never,
          expectedEpisodeRevision: "1" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({ kind: "updated" });

      const deferredSealAtSixteen = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-rejoin-deferred-seal-16",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "16"
      });
      await expect(
        rosterRepository.materialize(deferredSealAtSixteen)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expectDatabaseFailure(
        insertDirectProviderMembershipRejoin(db, {
          fixture,
          conversationId: membership.conversationId,
          participantId: membership.participantId,
          episodeId: `participant_membership_episode:db002-rejoin-unsealed-${runId}`,
          transitionId: membershipTransitionId("rejoin-unsealed"),
          origin: deferredSealAtSixteen,
          sourceExternalIdentityId: fixture.identityIds.account,
          expectedMembershipRevision: "2",
          resultingMembershipRevision: "3"
        }),
        /inbox_v2\.participant_membership_episode_projection_invalid/u
      );
      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "2",
        episodes: "1",
        head: "2",
        orderingHead: "10",
        state: "left",
        transitions: "2"
      });

      const timestampPoisonAtSeventeen = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-rejoin-timestamp-poison-17",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "17"
      });
      await expect(
        rosterRepository.materialize(timestampPoisonAtSeventeen)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expectDatabaseFailure(
        insertDirectProviderMembershipRejoin(db, {
          fixture,
          conversationId: membership.conversationId,
          participantId: membership.participantId,
          episodeId: `participant_membership_episode:db002-rejoin-timestamp-poison-${runId}`,
          transitionId: membershipTransitionId("rejoin-timestamp-poison"),
          origin: timestampPoisonAtSeventeen,
          sourceExternalIdentityId: fixture.identityIds.account,
          expectedMembershipRevision: "2",
          resultingMembershipRevision: "3",
          orderingHeadUpdatedAt: "2026-07-14T09:00:00.000Z"
        }),
        /inbox_v2\.provider_membership_ordering_head_target_invalid/u
      );
      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "2",
        episodes: "1",
        head: "2",
        orderingHead: "10",
        state: "left",
        transitions: "2"
      });

      const clockRegressed = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-rejoin-clock-regressed",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "15",
        observedAt: baseAt
      });
      await expect(
        rosterRepository.materialize(clockRegressed)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expect(
        membershipRepository.startProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          participantId: membership.participantId as never,
          episodeId:
            `participant_membership_episode:db002-rejoin-clock-regressed-${runId}` as never,
          transitionId: membershipTransitionId(
            "rejoin-clock-regressed"
          ) as never,
          rosterEvidenceId: clockRegressed.evidence.id,
          memberEvidenceId: clockRegressed.members[0]?.id as never,
          sourceThreadBindingId: fixture.bindingId as never,
          sourceExternalIdentityId: fixture.identityIds.account as never,
          role: "admin",
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "2" as never,
          occurredAt: baseAt
        })
      ).resolves.toEqual({ kind: "evidence_semantic_conflict" });

      const incomparable = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-rejoin-incomparable",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "999",
        orderingComparatorId: "module:synthetic-source:other-sequence"
      });
      await expect(
        rosterRepository.materialize(incomparable)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expect(
        membershipRepository.startProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          participantId: membership.participantId as never,
          episodeId:
            `participant_membership_episode:db002-rejoin-incomparable-${runId}` as never,
          transitionId: membershipTransitionId("rejoin-incomparable") as never,
          rosterEvidenceId: incomparable.evidence.id,
          memberEvidenceId: incomparable.members[0]?.id as never,
          sourceThreadBindingId: fixture.bindingId as never,
          sourceExternalIdentityId: fixture.identityIds.account as never,
          role: "admin",
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "2" as never,
          occurredAt: observedAt
        })
      ).resolves.toEqual({ kind: "evidence_scope_conflict" });

      const staleAtFive = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-rejoin-stale-5",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "5"
      });
      await expect(
        rosterRepository.materialize(staleAtFive)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expectDatabaseFailure(
        insertDirectProviderMembershipEpisode(db, {
          fixture,
          conversationId: membership.conversationId,
          participantId: membership.participantId,
          episodeId: `participant_membership_episode:db002-rejoin-stale-direct-${runId}`,
          origin: staleAtFive,
          sourceExternalIdentityId: fixture.identityIds.account
        }),
        /inbox_v2\.provider_membership_ordering_stale/u
      );
      await expect(
        membershipRepository.startProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          participantId: membership.participantId as never,
          episodeId:
            `participant_membership_episode:db002-rejoin-stale-${runId}` as never,
          transitionId: membershipTransitionId("rejoin-stale") as never,
          rosterEvidenceId: staleAtFive.evidence.id,
          memberEvidenceId: staleAtFive.members[0]?.id as never,
          sourceThreadBindingId: fixture.bindingId as never,
          sourceExternalIdentityId: fixture.identityIds.account as never,
          role: "admin",
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "2" as never,
          occurredAt: observedAt
        })
      ).resolves.toEqual({ kind: "evidence_stale" });
      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "2",
        episodes: "1",
        head: "2",
        orderingHead: "10",
        state: "left",
        transitions: "2"
      });

      const newerAtEleven = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-rejoin-newer-11",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "11"
      });
      await expect(
        rosterRepository.materialize(newerAtEleven)
      ).resolves.toMatchObject({ kind: "materialized" });
      const secondEpisodeId =
        `participant_membership_episode:db002-rejoin-newer-11-${runId}` as never;
      await expect(
        membershipRepository.startProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          participantId: membership.participantId as never,
          episodeId: secondEpisodeId,
          transitionId: membershipTransitionId("rejoin-newer-11") as never,
          rosterEvidenceId: newerAtEleven.evidence.id,
          memberEvidenceId: newerAtEleven.members[0]?.id as never,
          sourceThreadBindingId: fixture.bindingId as never,
          sourceExternalIdentityId: fixture.identityIds.account as never,
          role: "admin",
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "2" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({ kind: "created" });
      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "3",
        episodes: "2",
        head: "3",
        orderingHead: "11",
        state: "active",
        transitions: "3"
      });
      await expect(
        db.execute(sql`
          select public.inbox_v2_assert_participant_membership_episode(
            ${fixture.tenantId},
            ${membership.membershipEpisodeId}
          )
        `)
      ).resolves.toBeDefined();

      const terminalAtTwelve = makeCommit(fixture, {
        evidenceSuffix: "provider-membership-rejoin-terminal-12",
        identityKinds: ["account"],
        completeness: "partial",
        omissionPolicy: "retain_missing",
        orderingPosition: "12",
        memberState: "left",
        normalizedRole: "admin"
      });
      await expect(
        rosterRepository.materialize(terminalAtTwelve)
      ).resolves.toMatchObject({ kind: "materialized" });
      await expect(
        membershipRepository.transitionProviderEpisode({
          tenantId: fixture.tenantId,
          conversationId: membership.conversationId as never,
          episodeId: secondEpisodeId,
          transitionId: membershipTransitionId("rejoin-terminal-12") as never,
          evidence: {
            kind: "member",
            rosterEvidenceId: terminalAtTwelve.evidence.id,
            memberEvidenceId: terminalAtTwelve.members[0]?.id as never,
            sourceThreadBindingId: fixture.bindingId as never,
            sourceExternalIdentityId: fixture.identityIds.account as never
          },
          intent: "leave",
          nextRole: null,
          reasonCodeId: "core:provider-roster-observed" as never,
          expectedMembershipRevision: "3" as never,
          expectedEpisodeRevision: "1" as never,
          occurredAt: observedAt
        })
      ).resolves.toMatchObject({ kind: "updated" });

      const concurrentRejoins = ["13", "14"].map((position) =>
        makeCommit(fixture, {
          evidenceSuffix: `provider-membership-rejoin-concurrent-${position}`,
          identityKinds: ["account"],
          completeness: "partial",
          omissionPolicy: "retain_missing",
          orderingPosition: position
        })
      );
      await Promise.all(
        concurrentRejoins.map((commit) => rosterRepository.materialize(commit))
      );
      const concurrentStarts = concurrentRejoins.map((commit, index) => ({
        tenantId: fixture.tenantId,
        conversationId: membership.conversationId as never,
        participantId: membership.participantId as never,
        episodeId:
          `participant_membership_episode:db002-rejoin-concurrent-${index}-${runId}` as never,
        transitionId: membershipTransitionId(
          `rejoin-concurrent-${index}`
        ) as never,
        rosterEvidenceId: commit.evidence.id,
        memberEvidenceId: commit.members[0]?.id as never,
        sourceThreadBindingId: fixture.bindingId as never,
        sourceExternalIdentityId: fixture.identityIds.account as never,
        role: "admin" as const,
        reasonCodeId: "core:provider-roster-observed" as never,
        expectedMembershipRevision: "4" as never,
        occurredAt: observedAt
      }));
      const concurrentResults = await Promise.all(
        concurrentStarts.map((start) =>
          membershipRepository.startProviderEpisode(start)
        )
      );
      expect(concurrentResults.map((result) => result.kind).sort()).toEqual([
        "created",
        "membership_revision_conflict"
      ]);
      const concurrentWinnerIndex = concurrentResults.findIndex(
        (result) => result.kind === "created"
      );
      expect(concurrentWinnerIndex).toBeGreaterThanOrEqual(0);
      const winningStart = concurrentStarts[concurrentWinnerIndex];
      const winningPosition =
        concurrentRejoins[concurrentWinnerIndex]?.evidence.ordering.position;
      expect(winningStart).toBeDefined();
      expect(winningPosition).toMatch(/^(?:13|14)$/u);
      expect(await providerMembershipSnapshot(db, fixture.tenantId)).toEqual({
        commits: "5",
        episodes: "3",
        head: "5",
        orderingHead: winningPosition,
        state: "active",
        transitions: "5"
      });

      const durableHead = await db.execute<{
        episodeId: string;
        orderingPosition: string;
        revision: string;
      }>(sql`
        select
          episode_id as "episodeId",
          ordering_position::text as "orderingPosition",
          revision::text as revision
        from inbox_v2_provider_membership_ordering_heads
        where tenant_id = ${fixture.tenantId}
          and participant_id = ${membership.participantId}
          and source_thread_binding_id = ${fixture.bindingId}
      `);
      expect(durableHead.rows).toEqual([
        {
          episodeId: winningStart?.episodeId,
          orderingPosition: winningPosition,
          revision: "5"
        }
      ]);
    });

    it.each(["trusted-service", "source-account-scope"] as const)(
      "rejects forged provider membership %s through direct DML",
      async (forgeryKind) => {
        const fixture = makeFixture(
          `provider-membership-forged-${forgeryKind}`
        );
        await seedFixture(db, fixture);
        const identityKind =
          forgeryKind === "trusted-service" ? "provider" : "account";
        const membership = await seedProviderMembershipConversationGraph(
          db,
          fixture,
          identityKind
        );
        const rosterRepository =
          createSqlInboxV2ProviderRosterEvidenceRepository(db);
        const origin = makeCommit(fixture, {
          evidenceSuffix: `provider-membership-forged-${forgeryKind}`,
          identityKinds: [identityKind],
          completeness: "partial",
          omissionPolicy: "retain_missing",
          orderingPosition: "1"
        });
        await expect(
          rosterRepository.materialize(origin)
        ).resolves.toMatchObject({ kind: "materialized" });

        await db.transaction(async (transaction) => {
          await transaction.execute(
            sql`set local session_replication_role = replica`
          );
          if (forgeryKind === "trusted-service") {
            await transaction.execute(sql`
              update inbox_v2_source_external_identities
              set
                identity_declaration = jsonb_set(
                  identity_declaration,
                  '{adapterContract,loadedByTrustedServiceId}',
                  to_jsonb('core:forged-runtime'::text),
                  false
                ),
                declaration_loaded_by_trusted_service_id =
                  'core:forged-runtime',
                materialized_by_trusted_service_id = 'core:forged-runtime'
              where tenant_id = ${fixture.tenantId}
                and id = ${fixture.identityIds.provider}
            `);
          } else {
            await transaction.execute(sql`
              update inbox_v2_source_external_identities
              set scope_source_account_id = ${fixture.alternateAccountId}
              where tenant_id = ${fixture.tenantId}
                and id = ${fixture.identityIds.account}
            `);
          }
          await transaction.execute(
            sql`set local session_replication_role = origin`
          );
        });

        await expectDatabaseFailure(
          insertDirectProviderMembershipEpisode(db, {
            fixture,
            conversationId: membership.conversationId,
            participantId: membership.participantId,
            episodeId: membership.membershipEpisodeId,
            origin,
            sourceExternalIdentityId: fixture.identityIds[identityKind]
          }),
          /inbox_v2\.provider_membership_origin_invalid/u
        );
        const persisted = await db.execute<{
          commits: string;
          episodes: string;
          head: string;
          transitions: string;
        }>(sql`
          select
            (
              select count(*)::text
              from inbox_v2_conversation_membership_commits
              where tenant_id = ${fixture.tenantId}
            ) as commits,
            (
              select count(*)::text
              from inbox_v2_participant_membership_episodes
              where tenant_id = ${fixture.tenantId}
            ) as episodes,
            membership_revision::text as head,
            (
              select count(*)::text
              from inbox_v2_participant_membership_transitions
              where tenant_id = ${fixture.tenantId}
            ) as transitions
          from inbox_v2_conversation_membership_heads
          where tenant_id = ${fixture.tenantId}
            and conversation_id = ${membership.conversationId}
        `);
        expect(persisted.rows[0]).toEqual({
          commits: "0",
          episodes: "0",
          head: "0",
          transitions: "0"
        });
      }
    );
  }
);

type IdentityKind =
  | "account"
  | "connection"
  | "ephemeralRaw"
  | "ephemeralNormalized"
  | "provider"
  | "providerMismatch"
  | "wrongAccount"
  | "wrongEphemeral";

type Fixture = Readonly<{
  tenantId: InboxV2TenantId;
  label: string;
  connectionId: string;
  accountId: string;
  alternateAccountId: string;
  externalThreadId: string;
  bindingId: string;
  episodeId: string;
  rawId: string;
  normalizedId: string;
  alternateRawId: string;
  identityIds: Readonly<Record<IdentityKind, string>>;
}>;

type CommitOptions = Readonly<{
  evidenceSuffix: string;
  evidenceId?: string;
  observationKind?: "raw" | "normalized";
  rawEventId?: string;
  identityKinds: readonly IdentityKind[];
  memberIds?: readonly string[];
  watermark?: string;
  completeness?: "unknown" | "partial" | "complete";
  authority?: "advisory" | "authoritative";
  omissionPolicy?: "retain_missing" | "close_missing";
  orderingPosition?: string;
  orderingComparatorId?: string;
  observedAt?: string;
  memberState?: "present" | "left" | "removed" | "unknown";
  normalizedRole?:
    | "owner"
    | "admin"
    | "member"
    | "guest"
    | "observer"
    | "unknown";
}>;

function makeFixture(label: string): Fixture {
  const suffix = `${label}-${runId}`;
  return {
    tenantId: inboxV2TenantIdSchema.parse(`tenant:db002-roster-${suffix}`),
    label,
    connectionId: `source_connection:db002-roster-${suffix}`,
    accountId: `source_account:db002-roster-${suffix}`,
    alternateAccountId: `source_account:db002-roster-alt-${suffix}`,
    externalThreadId: `external_thread:db002-roster-${suffix}`,
    bindingId: `source_thread_binding:db002-roster-${suffix}`,
    episodeId: `source_thread_binding_remote_access_episode:db002-roster-${suffix}`,
    rawId: `raw_inbound_event:db002-roster-${suffix}`,
    normalizedId: `normalized_inbound_event:db002-roster-${suffix}`,
    alternateRawId: `raw_inbound_event:db002-roster-alt-${suffix}`,
    identityIds: {
      account: `source_external_identity:db002-roster-account-${suffix}`,
      connection: `source_external_identity:db002-roster-connection-${suffix}`,
      ephemeralRaw: `source_external_identity:db002-roster-eph-raw-${suffix}`,
      ephemeralNormalized: `source_external_identity:db002-roster-eph-normalized-${suffix}`,
      provider: `source_external_identity:db002-roster-provider-${suffix}`,
      providerMismatch: `source_external_identity:db002-roster-provider-mismatch-${suffix}`,
      wrongAccount: `source_external_identity:db002-roster-wrong-account-${suffix}`,
      wrongEphemeral: `source_external_identity:db002-roster-wrong-eph-${suffix}`
    }
  };
}

function makeSecondBindingFixture(fixture: Fixture): Fixture {
  const label = `${fixture.label}-second-binding`;
  return {
    ...fixture,
    label,
    accountId: fixture.alternateAccountId,
    alternateAccountId: fixture.accountId,
    bindingId: `source_thread_binding:db002-roster-${label}-${runId}`,
    episodeId: `source_thread_binding_remote_access_episode:db002-roster-${label}-${runId}`,
    rawId: fixture.alternateRawId,
    alternateRawId: fixture.rawId
  };
}

function rosterId(suffix: string): string {
  return `provider_roster_evidence:db002-${suffix}-${runId}`;
}

function memberId(suffix: string): string {
  return `provider_roster_member_evidence:db002-${suffix}-${runId}`;
}

function membershipTransitionId(suffix: string): string {
  return `participant_membership_transition:db002-${suffix}-${runId}`;
}

async function seedProviderMembershipConversationGraph(
  db: HuleeDatabase,
  fixture: Fixture,
  identityKind: IdentityKind
): Promise<{
  conversationId: string;
  participantId: string;
  membershipEpisodeId: string;
}> {
  const conversationId = `conversation:db002-membership-${fixture.label}-${runId}`;
  const participantId = `conversation_participant:db002-membership-${fixture.label}-${runId}`;
  const membershipEpisodeId = `participant_membership_episode:db002-membership-${fixture.label}-${runId}`;
  const declaration = {
    adapterContract: {
      contractId: "module:synthetic-source:thread-contract",
      contractVersion: "v1",
      declarationRevision: "1",
      surfaceId: "module:synthetic-source:group-surface",
      loadedByTrustedServiceId: "core:routing-resolver",
      loadedAt: baseAt
    },
    identityKind: "external_thread",
    realmId: "module:synthetic-source:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:group-room",
    scopeKind: "provider",
    decisionStrength: "authoritative"
  };

  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into inbox_v2_conversations (
        tenant_id, id, topology, transport, purpose_id, lifecycle,
        revision, last_changed_stream_position, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${conversationId}, 'group', 'external',
        'core:chat', 'active', 1, 1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_heads (
        tenant_id, conversation_id, latest_timeline_sequence,
        latest_activity_item_id, latest_activity_timeline_sequence,
        latest_activity_at, revision, last_changed_stream_position,
        created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${conversationId}, 0, null, null, null,
        1, 1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_membership_heads (
        tenant_id, conversation_id, membership_revision, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${conversationId}, 0, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_external_threads (
        tenant_id, id, key_registry_id, key_registry_entry_kind,
        realm_id, realm_version, canonicalization_version,
        scope_kind, scope_source_connection_id, scope_source_account_id,
        scope_owner_key, object_kind_id, canonical_external_subject,
        identity_declaration, conversation_id, conversation_transport,
        conversation_topology, revision, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${fixture.externalThreadId},
        ${`external_thread_key_registry:db002-${fixture.label}-${runId}`},
        'canonical', 'module:synthetic-source:thread-realm', 'v1', 'v1',
        'provider', null, null, 'provider',
        'module:synthetic-source:group-room',
        ${`ProviderGroup:${fixture.label}`}, ${declaration},
        ${conversationId}, 'external', 'group', 1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_participants (
        tenant_id, id, conversation_id, subject_kind,
        subject_employee_id, subject_source_external_identity_id,
        subject_client_contact_id, subject_bot_identity_id,
        subject_system_actor_id, subject_legacy_provenance_id,
        revision, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${participantId}, ${conversationId},
        'source_external_identity', null, ${fixture.identityIds[identityKind]},
        null, null, null, null, 1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });

  return { conversationId, participantId, membershipEpisodeId };
}

async function seedAdditionalBindingProjection(
  db: HuleeDatabase,
  fixture: Fixture
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_bindings (
        tenant_id, id, external_thread_id, source_connection_id,
        source_account_id, created_at
      ) values (
        ${fixture.tenantId}, ${fixture.bindingId}, ${fixture.externalThreadId},
        ${fixture.connectionId}, ${fixture.accountId}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_binding_heads (
        tenant_id, binding_id, external_thread_id, source_connection_id,
        source_account_id, account_identity_revision, account_generation,
        account_identity_state, account_canonical_key_digest_sha256,
        account_identity_trusted_service_id, account_verified_at,
        account_verification_evidence_set_id, binding_generation,
        current_remote_access_episode_id, current_remote_access_episode_revision,
        remote_access_state, remote_access_evidence_authority,
        remote_access_revision, remote_access_since, remote_access_evidence_set_id,
        administrative_state, administrative_revision,
        administrative_changed_at, runtime_health_state,
        runtime_health_revision, runtime_health_checked_at,
        history_sync_state, history_sync_revision, history_updated_at,
        provider_access_revision, provider_role_count,
        provider_roles_digest_sha256, provider_access_evidence_set_id,
        provider_access_observed_at, capability_contract_id,
        capability_contract_version, capability_declaration_revision,
        capability_surface_id, capability_loaded_by_trusted_service_id,
        capability_loaded_at, capability_revision, capability_entry_count,
        capability_semantic_digest_sha256, capability_captured_at,
        route_contract_id, route_contract_version, route_declaration_revision,
        route_surface_id, route_loaded_by_trusted_service_id, route_loaded_at,
        route_descriptor_schema_id, route_descriptor_version,
        route_descriptor_revision, route_destination_kind_id,
        route_destination_subject, route_descriptor_digest_sha256,
        route_attribute_count, route_attributes_digest_sha256,
        revision, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${fixture.bindingId}, ${fixture.externalThreadId},
        ${fixture.connectionId}, ${fixture.accountId}, 1, 1, 'verified',
        ${"4".repeat(64)}, 'core:source-runtime', ${baseAt},
        ${`source_thread_binding_evidence_set:account-${fixture.label}-${runId}`},
        1, ${fixture.episodeId}, 1, 'active', 'direct_observation', 1,
        ${baseAt},
        ${`source_thread_binding_evidence_set:remote-${fixture.label}-${runId}`},
        'enabled', 1, ${baseAt}, 'ready', 1, ${baseAt},
        'unsupported', 1, ${baseAt}, 1, 0, ${"0".repeat(64)},
        ${`source_thread_binding_evidence_set:provider-${fixture.label}-${runId}`},
        ${baseAt}, ${adapterContract.contractId},
        ${adapterContract.contractVersion}, 1, ${adapterContract.surfaceId},
        ${adapterContract.loadedByTrustedServiceId}, ${baseAt}, 1, 0,
        ${"1".repeat(64)}, ${baseAt}, ${adapterContract.contractId},
        ${adapterContract.contractVersion}, 1, ${adapterContract.surfaceId},
        ${adapterContract.loadedByTrustedServiceId}, ${baseAt},
        'module:synthetic-source:group-route', 'v1', 1,
        'module:synthetic-source:group-peer',
        ${`ProviderGroup:${fixture.label}`}, ${"2".repeat(64)}, 0,
        ${"3".repeat(64)}, 1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_binding_snapshots
      select (jsonb_populate_record(
        null::inbox_v2_source_thread_binding_snapshots,
        to_jsonb(head_row) || jsonb_build_object(
          'transition_id', null,
          'expected_binding_revision', null
        )
      )).*
      from inbox_v2_source_thread_binding_heads head_row
      where head_row.tenant_id = ${fixture.tenantId}
        and head_row.binding_id = ${fixture.bindingId}
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

async function insertDirectProviderMembershipEpisode(
  db: HuleeDatabase,
  input: Readonly<{
    fixture: Fixture;
    conversationId: string;
    participantId: string;
    episodeId: string;
    origin: InboxV2ProviderRosterMaterializationCommit;
    sourceExternalIdentityId: string;
  }>
): Promise<unknown> {
  return db.execute(sql`
    insert into inbox_v2_participant_membership_episodes (
      tenant_id, id, participant_id, conversation_id, origin_kind,
      origin_provider_roster_member_evidence_id,
      origin_provider_roster_evidence_id,
      origin_source_thread_binding_id,
      origin_source_external_identity_id,
      origin_ordering_kind, origin_ordering_scope_token,
      origin_ordering_comparator_id, origin_ordering_comparator_revision,
      origin_ordering_position, provider_ordering_head_position,
      origin_migration_provenance_id, origin_system_policy_id,
      state, role, evidence_classification, valid_from, valid_to, revision
    ) values (
      ${input.fixture.tenantId}, ${input.episodeId}, ${input.participantId},
      ${input.conversationId}, 'provider_roster',
      ${input.origin.members[0]?.id}, ${input.origin.evidence.id},
      ${input.fixture.bindingId}, ${input.sourceExternalIdentityId},
      ${input.origin.evidence.ordering.kind},
      ${input.origin.evidence.ordering.scopeToken},
      ${input.origin.evidence.ordering.comparatorId},
      ${input.origin.evidence.ordering.comparatorRevision},
      ${input.origin.evidence.ordering.position},
      ${input.origin.evidence.ordering.position},
      null, null, 'active', 'admin', 'confirmed', ${observedAt}, null, 1
    )
  `);
}

async function insertDirectProviderMembershipRejoin(
  db: HuleeDatabase,
  input: Readonly<{
    fixture: Fixture;
    conversationId: string;
    participantId: string;
    episodeId: string;
    transitionId: string;
    origin: InboxV2ProviderRosterMaterializationCommit;
    sourceExternalIdentityId: string;
    expectedMembershipRevision: string;
    resultingMembershipRevision: string;
    orderingHeadUpdatedAt?: string;
  }>
): Promise<unknown> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into inbox_v2_conversation_membership_commits (
        tenant_id, conversation_id, expected_membership_revision,
        resulting_membership_revision, occurred_at
      ) values (
        ${input.fixture.tenantId}, ${input.conversationId},
        ${input.expectedMembershipRevision},
        ${input.resultingMembershipRevision}, ${input.origin.evidence.observedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_participant_membership_episodes (
        tenant_id, id, participant_id, conversation_id, origin_kind,
        origin_provider_roster_member_evidence_id,
        origin_provider_roster_evidence_id,
        origin_source_thread_binding_id,
        origin_source_external_identity_id,
        origin_ordering_kind, origin_ordering_scope_token,
        origin_ordering_comparator_id, origin_ordering_comparator_revision,
        origin_ordering_position, provider_ordering_head_position,
        origin_migration_provenance_id, origin_system_policy_id,
        state, role, evidence_classification, valid_from, valid_to, revision
      ) values (
        ${input.fixture.tenantId}, ${input.episodeId}, ${input.participantId},
        ${input.conversationId}, 'provider_roster',
        ${input.origin.members[0]?.id}, ${input.origin.evidence.id},
        ${input.fixture.bindingId}, ${input.sourceExternalIdentityId},
        ${input.origin.evidence.ordering.kind},
        ${input.origin.evidence.ordering.scopeToken},
        ${input.origin.evidence.ordering.comparatorId},
        ${input.origin.evidence.ordering.comparatorRevision},
        ${input.origin.evidence.ordering.position},
        ${input.origin.evidence.ordering.position},
        null, null, 'active', 'admin', 'confirmed',
        ${input.origin.evidence.observedAt}, null, 1
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_participant_membership_transitions (
        tenant_id, id, episode_id, participant_id, conversation_id,
        membership_revision, intent, from_state, to_state, from_role, to_role,
        cause_kind, cause_provider_evidence_kind,
        cause_provider_roster_member_evidence_id,
        cause_provider_roster_evidence_id,
        cause_source_thread_binding_id,
        cause_source_external_identity_id,
        cause_ordering_kind, cause_ordering_scope_token,
        cause_ordering_comparator_id, cause_ordering_comparator_revision,
        cause_ordering_position,
        cause_actor_employee_id, cause_trusted_service_id,
        cause_migration_provenance_id, cause_system_policy_id,
        reason_code_id, expected_revision, current_revision,
        resulting_revision, occurred_at
      ) values (
        ${input.fixture.tenantId}, ${input.transitionId}, ${input.episodeId},
        ${input.participantId}, ${input.conversationId},
        ${input.resultingMembershipRevision}, 'initial_active', null, 'active',
        null, 'admin', 'provider_roster', 'member',
        ${input.origin.members[0]?.id}, ${input.origin.evidence.id},
        ${input.fixture.bindingId}, ${input.sourceExternalIdentityId},
        ${input.origin.evidence.ordering.kind},
        ${input.origin.evidence.ordering.scopeToken},
        ${input.origin.evidence.ordering.comparatorId},
        ${input.origin.evidence.ordering.comparatorRevision},
        ${input.origin.evidence.ordering.position},
        null, null, null, null, 'core:provider-roster-observed',
        null, null, 1, ${input.origin.evidence.observedAt}
      )
    `);
    if (input.orderingHeadUpdatedAt !== undefined) {
      await transaction.execute(sql`
        update inbox_v2_provider_membership_ordering_heads
        set ordering_position = ${input.origin.evidence.ordering.position},
            episode_id = ${input.episodeId},
            transition_id = ${input.transitionId},
            membership_revision = ${input.resultingMembershipRevision},
            revision = revision + 1,
            updated_at = ${input.orderingHeadUpdatedAt}
        where tenant_id = ${input.fixture.tenantId}
          and participant_id = ${input.participantId}
          and source_thread_binding_id = ${input.fixture.bindingId}
      `);
    }
    await transaction.execute(sql`
      update inbox_v2_conversation_membership_heads
      set membership_revision = ${input.resultingMembershipRevision},
          updated_at = ${input.origin.evidence.observedAt}
      where tenant_id = ${input.fixture.tenantId}
        and conversation_id = ${input.conversationId}
        and membership_revision = ${input.expectedMembershipRevision}
    `);
  });
}

function providerMemberTransitionInput(
  fixture: Fixture,
  membership: Readonly<{
    conversationId: string;
    participantId: string;
    membershipEpisodeId: string;
  }>,
  commit: InboxV2ProviderRosterMaterializationCommit,
  input: Readonly<{
    positionLabel: string;
    expectedMembershipRevision: string;
    expectedEpisodeRevision: string;
  }>
) {
  return {
    tenantId: fixture.tenantId,
    conversationId: membership.conversationId as never,
    episodeId: membership.membershipEpisodeId as never,
    transitionId: membershipTransitionId(input.positionLabel) as never,
    evidence: {
      kind: "member" as const,
      rosterEvidenceId: commit.evidence.id,
      memberEvidenceId: commit.members[0]?.id as never,
      sourceThreadBindingId: fixture.bindingId as never,
      sourceExternalIdentityId: fixture.identityIds.account as never
    },
    intent: "change_role" as const,
    nextRole: "member" as const,
    reasonCodeId: "core:provider-roster-observed" as never,
    expectedMembershipRevision: input.expectedMembershipRevision as never,
    expectedEpisodeRevision: input.expectedEpisodeRevision as never,
    occurredAt: observedAt
  };
}

async function providerMembershipSnapshot(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId
): Promise<{
  commits: string;
  episodes: string;
  head: string;
  orderingHead: string;
  state: string;
  transitions: string;
}> {
  const result = await db.execute<{
    commits: string;
    episodes: string;
    head: string;
    orderingHead: string;
    state: string;
    transitions: string;
  }>(sql`
    select
      (
        select count(*)::text
        from inbox_v2_conversation_membership_commits
        where tenant_id = ${tenantId}
      ) as commits,
      count(*)::text as episodes,
      max(membership_head.membership_revision)::text as head,
      (
        select max(ordering_head.ordering_position)::text
        from inbox_v2_provider_membership_ordering_heads ordering_head
        where ordering_head.tenant_id = ${tenantId}
      ) as "orderingHead",
      (
        select max(current_episode.state::text)
        from inbox_v2_provider_membership_ordering_heads ordering_head
        join inbox_v2_participant_membership_episodes current_episode
          on current_episode.tenant_id = ordering_head.tenant_id
         and current_episode.id = ordering_head.episode_id
        where ordering_head.tenant_id = ${tenantId}
      ) as state,
      (
        select count(*)::text
        from inbox_v2_participant_membership_transitions
        where tenant_id = ${tenantId}
      ) as transitions
    from inbox_v2_participant_membership_episodes episode_row
    join inbox_v2_conversation_membership_heads membership_head
      on membership_head.tenant_id = episode_row.tenant_id
     and membership_head.conversation_id = episode_row.conversation_id
    where episode_row.tenant_id = ${tenantId}
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Provider membership snapshot row is missing.");
  return row;
}

function reference(tenantId: InboxV2TenantId, kind: string, id: string) {
  return { tenantId, kind, id };
}

function makeCommit(
  fixture: Fixture,
  options: CommitOptions
): InboxV2ProviderRosterMaterializationCommit {
  const tenantId = fixture.tenantId;
  const commitObservedAt = options.observedAt ?? observedAt;
  const sourceConnection = reference(
    tenantId,
    "source_connection",
    fixture.connectionId
  );
  const sourceAccount = reference(
    tenantId,
    "source_account",
    fixture.accountId
  );
  const externalThread = reference(
    tenantId,
    "external_thread",
    fixture.externalThreadId
  );
  const sourceThreadBinding = reference(
    tenantId,
    "source_thread_binding",
    fixture.bindingId
  );
  const rawEvent = reference(
    tenantId,
    "raw_inbound_event",
    options.rawEventId ?? fixture.rawId
  );
  const normalizedEvent = reference(
    tenantId,
    "normalized_inbound_event",
    fixture.normalizedId
  );
  const observation =
    options.observationKind === "normalized" ? normalizedEvent : rawEvent;
  const accountDeclaration = {
    adapterContract,
    identityKind: "source_account",
    realmId: "module:synthetic-source:account-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:user-account",
    scopeKind: "source_connection",
    decisionStrength: "authoritative"
  } as const;
  const binding = {
    tenantId,
    id: fixture.bindingId,
    externalThread,
    sourceConnection,
    sourceAccount,
    accountIdentitySnapshot: {
      status: "verified" as const,
      sourceConnection,
      sourceAccount,
      declaration: accountDeclaration,
      realmId: accountDeclaration.realmId,
      canonicalExternalSubject: `ProviderAccount:${fixture.label}`,
      accountGeneration: "1",
      verificationEvidence: [rawEvent],
      verifiedAt: baseAt
    },
    bindingGeneration: "1",
    remoteAccess: {
      state: "active" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: "1",
      since: baseAt,
      evidence: [rawEvent]
    },
    administrative: {
      state: "enabled" as const,
      revision: "1",
      changedAt: baseAt
    },
    runtimeHealth: {
      state: "ready" as const,
      revision: "1",
      checkedAt: baseAt,
      diagnostic: null
    },
    historySync: {
      state: "unsupported" as const,
      revision: "1",
      receiveCursor: null,
      historyCursor: null,
      providerWatermark: null,
      lastDurableRawEvent: null,
      updatedAt: baseAt,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: [],
      evidence: [rawEvent],
      observedAt: baseAt
    },
    capabilities: {
      adapterContract,
      revision: "1",
      capturedAt: baseAt,
      entries: []
    },
    routeDescriptor: {
      adapterContract,
      descriptorSchemaId: "module:synthetic-source:group-route",
      descriptorVersion: "v1",
      descriptorRevision: "1",
      destinationKindId: "module:synthetic-source:group-peer",
      destinationSubject: `ProviderGroup:${fixture.label}`,
      attributes: [],
      descriptorDigestSha256: "a".repeat(64)
    },
    revision: "1",
    createdAt: baseAt,
    updatedAt: baseAt
  };
  const evidenceId = options.evidenceId ?? rosterId(options.evidenceSuffix);
  const evidence = {
    tenantId,
    id: evidenceId,
    sourceThreadBinding,
    observation,
    adapterContractVersion: "v1",
    completeness: options.completeness ?? ("complete" as const),
    authority: options.authority ?? ("authoritative" as const),
    omissionPolicy: options.omissionPolicy ?? ("close_missing" as const),
    ordering: {
      kind: "adapter_monotonic" as const,
      scopeToken: `roster-scope:${fixture.bindingId}`,
      comparatorId:
        options.orderingComparatorId ??
        "module:synthetic-source:roster-sequence",
      comparatorRevision: "1",
      position: options.orderingPosition ?? "1"
    },
    observedAt: commitObservedAt,
    watermark: options.watermark ?? `watermark:${options.evidenceSuffix}`,
    revision: "1"
  };
  const members = options.identityKinds.map((identityKind, index) => ({
    tenantId,
    id:
      options.memberIds?.[index] ??
      memberId(`${options.evidenceSuffix}-${identityKind}-${index}`),
    rosterEvidence: reference(tenantId, "provider_roster_evidence", evidenceId),
    sourceExternalIdentity: reference(
      tenantId,
      "source_external_identity",
      fixture.identityIds[identityKind]
    ),
    state: options.memberState ?? ("present" as const),
    normalizedRole:
      options.normalizedRole ??
      (index === 0 ? ("admin" as const) : ("member" as const)),
    providerStateCode: "present",
    providerRoleCode: index === 0 ? "administrator" : "participant",
    observedAt: commitObservedAt,
    revision: "1"
  }));

  return inboxV2ProviderRosterMaterializationCommitSchema.parse({
    tenantId,
    evidence,
    members,
    currentBindingProjection: {
      binding,
      currentRemoteAccessEpisode: {
        tenantId,
        id: fixture.episodeId,
        binding: sourceThreadBinding,
        state: "active",
        startedAt: baseAt,
        endedAt: null,
        startEvidence: [rawEvent],
        endEvidence: [],
        revision: "1",
        createdAt: baseAt,
        updatedAt: baseAt
      }
    },
    authority: {
      kind: "trusted_service",
      trustedServiceId: "core:source-runtime",
      authorizationToken: `authorization:${options.evidenceSuffix}`,
      authorizedAt: materializedAt
    },
    materializedAt
  });
}

async function seedFixture(db: HuleeDatabase, fixture: Fixture): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${fixture.tenantId},
        ${`db002-roster-${fixture.label}-${runId}`},
        ${`DB002 roster ${fixture.label}`},
        'saas_shared'
      )
    `);
    await transaction.execute(sql`
      insert into source_connections (
        id, tenant_id, source_type, source_name, display_name
      ) values (
        ${fixture.connectionId}, ${fixture.tenantId},
        'messenger', 'synthetic', ${`Connection ${fixture.label}`}
      )
    `);
    await transaction.execute(sql`
      insert into source_accounts (
        id, tenant_id, source_connection_id, account_type, display_name
      ) values
        (
          ${fixture.accountId}, ${fixture.tenantId}, ${fixture.connectionId},
          'direct_number', ${`Account ${fixture.label}`}
        ),
        (
          ${fixture.alternateAccountId}, ${fixture.tenantId},
          ${fixture.connectionId}, 'direct_number',
          ${`Alternate account ${fixture.label}`}
        )
    `);
    await seedRawEvent(transaction, fixture, {
      id: fixture.rawId,
      accountId: fixture.accountId,
      suffix: "main"
    });
    await seedRawEvent(transaction, fixture, {
      id: fixture.alternateRawId,
      accountId: fixture.alternateAccountId,
      suffix: "alternate"
    });
    await transaction.execute(sql`
      insert into normalized_inbound_events (
        id, tenant_id, raw_event_id, source_connection_id, source_account_id,
        source_type, source_name, event_type, direction, visibility,
        payload_version, normalized_payload, reply_capability,
        idempotency_key, processing_status, created_at, updated_at
      ) values (
        ${fixture.normalizedId}, ${fixture.tenantId}, ${fixture.rawId},
        ${fixture.connectionId}, ${fixture.accountId}, 'messenger', 'synthetic',
        'message', 'inbound', 'private', 'v1', '{}'::jsonb, '{}'::jsonb,
        ${`normalized:${fixture.label}:${runId}`}, 'processed',
        ${observedAt}, ${observedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_bindings (
        tenant_id, id, external_thread_id, source_connection_id,
        source_account_id, created_at
      ) values (
        ${fixture.tenantId}, ${fixture.bindingId}, ${fixture.externalThreadId},
        ${fixture.connectionId}, ${fixture.accountId}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_binding_heads (
        tenant_id, binding_id, external_thread_id, source_connection_id,
        source_account_id, account_identity_revision, account_generation,
        account_identity_state, account_canonical_key_digest_sha256,
        account_identity_trusted_service_id, account_verified_at,
        account_verification_evidence_set_id, binding_generation,
        current_remote_access_episode_id, current_remote_access_episode_revision,
        remote_access_state, remote_access_evidence_authority,
        remote_access_revision, remote_access_since, remote_access_evidence_set_id,
        administrative_state, administrative_revision,
        administrative_changed_at, runtime_health_state,
        runtime_health_revision, runtime_health_checked_at,
        history_sync_state, history_sync_revision, history_updated_at,
        provider_access_revision, provider_role_count,
        provider_roles_digest_sha256, provider_access_evidence_set_id,
        provider_access_observed_at, capability_contract_id,
        capability_contract_version, capability_declaration_revision,
        capability_surface_id, capability_loaded_by_trusted_service_id,
        capability_loaded_at, capability_revision, capability_entry_count,
        capability_semantic_digest_sha256, capability_captured_at,
        route_contract_id, route_contract_version, route_declaration_revision,
        route_surface_id, route_loaded_by_trusted_service_id, route_loaded_at,
        route_descriptor_schema_id, route_descriptor_version,
        route_descriptor_revision, route_destination_kind_id,
        route_destination_subject, route_descriptor_digest_sha256,
        route_attribute_count, route_attributes_digest_sha256,
        revision, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${fixture.bindingId}, ${fixture.externalThreadId},
        ${fixture.connectionId}, ${fixture.accountId}, 1, 1, 'verified',
        ${"4".repeat(64)}, 'core:source-runtime', ${baseAt},
        ${`source_thread_binding_evidence_set:account-${fixture.label}-${runId}`},
        1, ${fixture.episodeId}, 1, 'active', 'direct_observation', 1,
        ${baseAt},
        ${`source_thread_binding_evidence_set:remote-${fixture.label}-${runId}`},
        'enabled', 1, ${baseAt}, 'ready', 1, ${baseAt},
        'unsupported', 1, ${baseAt}, 1, 0, ${"0".repeat(64)},
        ${`source_thread_binding_evidence_set:provider-${fixture.label}-${runId}`},
        ${baseAt}, ${adapterContract.contractId},
        ${adapterContract.contractVersion}, 1, ${adapterContract.surfaceId},
        ${adapterContract.loadedByTrustedServiceId}, ${baseAt}, 1, 0,
        ${"1".repeat(64)}, ${baseAt}, ${adapterContract.contractId},
        ${adapterContract.contractVersion}, 1, ${adapterContract.surfaceId},
        ${adapterContract.loadedByTrustedServiceId}, ${baseAt},
        'module:synthetic-source:group-route', 'v1', 1,
        'module:synthetic-source:group-peer',
        ${`ProviderGroup:${fixture.label}`}, ${"2".repeat(64)}, 0,
        ${"3".repeat(64)}, 1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_binding_snapshots
      select (jsonb_populate_record(
        null::inbox_v2_source_thread_binding_snapshots,
        to_jsonb(head_row) || jsonb_build_object(
          'transition_id', null,
          'expected_binding_revision', null
        )
      )).*
      from inbox_v2_source_thread_binding_heads head_row
      where head_row.tenant_id = ${fixture.tenantId}
        and head_row.binding_id = ${fixture.bindingId}
    `);
    await seedIdentities(transaction, fixture);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

async function seedRawEvent(
  executor: { execute(query: SQL): Promise<unknown> },
  fixture: Fixture,
  input: Readonly<{ id: string; accountId: string; suffix: string }>
): Promise<void> {
  await executor.execute(sql`
    insert into raw_inbound_events (
      id, tenant_id, source_connection_id, source_account_id,
      idempotency_key, received_at, payload, headers,
      processing_status, created_at, updated_at
    ) values (
      ${input.id}, ${fixture.tenantId}, ${fixture.connectionId},
      ${input.accountId}, ${`raw:${fixture.label}:${input.suffix}:${runId}`},
      ${observedAt}, '{}'::jsonb, '{}'::jsonb, 'processed',
      ${observedAt}, ${observedAt}
    )
  `);
}

async function seedIdentities(
  executor: { execute(query: SQL): Promise<unknown> },
  fixture: Fixture
): Promise<void> {
  const identities: Array<
    Readonly<{
      kind: IdentityKind;
      scopeKind: "provider" | "source_connection" | "source_account";
      connectionId: string | null;
      accountId: string | null;
      stabilityKind: "stable" | "observation_ephemeral";
      rawId: string | null;
      normalizedId: string | null;
      observationKey: string | null;
    }>
  > = [
    {
      kind: "account",
      scopeKind: "source_account",
      connectionId: null,
      accountId: fixture.accountId,
      stabilityKind: "stable",
      rawId: null,
      normalizedId: null,
      observationKey: null
    },
    {
      kind: "connection",
      scopeKind: "source_connection",
      connectionId: fixture.connectionId,
      accountId: null,
      stabilityKind: "stable",
      rawId: null,
      normalizedId: null,
      observationKey: null
    },
    {
      kind: "ephemeralRaw",
      scopeKind: "source_account",
      connectionId: null,
      accountId: fixture.accountId,
      stabilityKind: "observation_ephemeral",
      rawId: fixture.rawId,
      normalizedId: null,
      observationKey: `raw:${fixture.rawId}`
    },
    {
      kind: "ephemeralNormalized",
      scopeKind: "source_account",
      connectionId: null,
      accountId: fixture.accountId,
      stabilityKind: "observation_ephemeral",
      rawId: null,
      normalizedId: fixture.normalizedId,
      observationKey: `normalized:${fixture.normalizedId}`
    },
    {
      kind: "provider",
      scopeKind: "provider",
      connectionId: null,
      accountId: null,
      stabilityKind: "stable",
      rawId: null,
      normalizedId: null,
      observationKey: null
    },
    {
      kind: "providerMismatch",
      scopeKind: "provider",
      connectionId: null,
      accountId: null,
      stabilityKind: "stable",
      rawId: null,
      normalizedId: null,
      observationKey: null
    },
    {
      kind: "wrongAccount",
      scopeKind: "source_account",
      connectionId: null,
      accountId: fixture.alternateAccountId,
      stabilityKind: "stable",
      rawId: null,
      normalizedId: null,
      observationKey: null
    },
    {
      kind: "wrongEphemeral",
      scopeKind: "source_account",
      connectionId: null,
      accountId: fixture.accountId,
      stabilityKind: "observation_ephemeral",
      rawId: fixture.alternateRawId,
      normalizedId: null,
      observationKey: `raw:${fixture.alternateRawId}`
    }
  ];

  for (const identity of identities) {
    const identityAdapterContract =
      identity.kind === "providerMismatch"
        ? {
            ...adapterContract,
            contractId: "module:synthetic-source:other-contract"
          }
        : adapterContract;
    const identityDeclaration = {
      adapterContract: identityAdapterContract,
      identityKind: "source_external_identity",
      realmId: "module:synthetic-source:actor-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1",
      objectKindId: "module:synthetic-source:provider-user",
      scopeKind: identity.scopeKind,
      decisionStrength:
        identity.scopeKind === "source_account"
          ? "safe_default"
          : "authoritative"
    } as const;
    await executor.execute(sql`
      insert into inbox_v2_source_external_identities (
        tenant_id, id, realm_id, realm_version, canonicalization_version,
        object_kind_id, scope_kind, scope_source_connection_id,
        scope_source_account_id, identity_declaration,
        declaration_contract_id, declaration_contract_version,
        declaration_revision, declaration_surface_id,
        declaration_loaded_by_trusted_service_id, declaration_loaded_at,
        materialized_by_trusted_service_id,
        materialization_authorization_token, materialized_at,
        canonical_external_subject, stability_kind,
        ephemeral_raw_inbound_event_id,
        ephemeral_normalized_inbound_event_id, ephemeral_observation_key,
        revision, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${fixture.identityIds[identity.kind]},
        'module:synthetic-source:actor-realm', 'v1', 'v1',
        'module:synthetic-source:provider-user',
        ${identity.scopeKind}, ${identity.connectionId}, ${identity.accountId},
        ${identityDeclaration}, ${identityAdapterContract.contractId},
        ${identityAdapterContract.contractVersion},
        ${identityAdapterContract.declarationRevision},
        ${identityAdapterContract.surfaceId},
        ${identityAdapterContract.loadedByTrustedServiceId},
        ${identityAdapterContract.loadedAt},
        ${identityAdapterContract.loadedByTrustedServiceId},
        ${`identity-materialize:${fixture.label}:${identity.kind}:${runId}`},
        ${baseAt},
        ${`ProviderActor:${fixture.label}:${identity.kind}`},
        ${identity.stabilityKind}, ${identity.rawId}, ${identity.normalizedId},
        ${identity.observationKey}, 1, ${baseAt}, ${baseAt}
      )
    `);
  }
}

async function persistedRoster(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId,
  commit: InboxV2ProviderRosterMaterializationCommit
): Promise<{
  root:
    | {
        observation_kind: string;
        member_count: number;
        ordered_member_digest_sha256: string;
        completeness: string;
        authority: string;
        omission_policy: string;
      }
    | undefined;
  members: Array<{
    ordinal: number;
    id: string;
    source_external_identity_id: string;
  }>;
  database_digest: string | undefined;
}> {
  const [root, members, digest] = await Promise.all([
    db.execute<{
      observation_kind: string;
      member_count: number;
      ordered_member_digest_sha256: string;
      completeness: string;
      authority: string;
      omission_policy: string;
    }>(sql`
      select
        observation_kind,
        member_count,
        ordered_member_digest_sha256,
        completeness,
        authority,
        omission_policy
      from inbox_v2_provider_roster_evidence
      where tenant_id = ${tenantId}
        and id = ${commit.evidence.id}
    `),
    db.execute<{
      ordinal: number;
      id: string;
      source_external_identity_id: string;
    }>(sql`
      select ordinal, id, source_external_identity_id
      from inbox_v2_provider_roster_member_evidence
      where tenant_id = ${tenantId}
        and roster_evidence_id = ${commit.evidence.id}
      order by ordinal
    `),
    db.execute<{ database_digest: string }>(sql`
      select encode(
        sha256(
          convert_to(
            'inbox-v2-provider-roster-members:v1|' ||
            coalesce(
              string_agg(
                member_row.ordinal::text || '|' ||
                octet_length(member_row.id)::text || ':' || member_row.id ||
                octet_length(member_row.source_external_identity_id)::text ||
                  ':' || member_row.source_external_identity_id ||
                member_row.source_external_identity_revision::text || '|' ||
                octet_length(member_row.state::text)::text || ':' ||
                  member_row.state::text ||
                octet_length(member_row.normalized_role::text)::text || ':' ||
                  member_row.normalized_role::text ||
                octet_length(member_row.provider_state_code)::text || ':' ||
                  member_row.provider_state_code ||
                case
                  when member_row.provider_role_code is null then '-1:'
                  else octet_length(member_row.provider_role_code)::text ||
                    ':' || member_row.provider_role_code
                end ||
                trunc(
                  extract(epoch from member_row.observed_at) * 1000
                )::bigint::text || ';',
                '' order by member_row.ordinal
              ),
              ''
            ),
            'UTF8'
          )
        ),
        'hex'
      ) as database_digest
      from inbox_v2_provider_roster_member_evidence member_row
      where member_row.tenant_id = ${tenantId}
        and member_row.roster_evidence_id = ${commit.evidence.id}
    `)
  ]);
  return {
    root: root.rows[0],
    members: members.rows.map((member) => ({
      ordinal: Number(member.ordinal),
      id: member.id,
      source_external_identity_id: member.source_external_identity_id
    })),
    database_digest: digest.rows[0]?.database_digest
  };
}

async function rosterCount(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId
): Promise<string> {
  const count = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
    from inbox_v2_provider_roster_evidence
    where tenant_id = ${tenantId}
  `);
  return count.rows[0]?.count ?? "missing";
}

async function cloneRosterRoot(
  executor: { execute(query: SQL): Promise<unknown> },
  tenantId: InboxV2TenantId,
  input: Readonly<{
    sourceId: string;
    targetId: string;
    digest?: string;
    orderingPosition?: bigint;
  }>
): Promise<void> {
  await executor.execute(sql`
    insert into inbox_v2_provider_roster_evidence (
      tenant_id, id, source_thread_binding_id, external_thread_id,
      source_connection_id, source_account_id, binding_revision,
      binding_generation, adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      capability_revision, observation_kind, raw_inbound_event_id,
      normalized_inbound_event_id, completeness, authority, omission_policy,
      ordering_kind, ordering_scope_token, ordering_comparator_id,
      ordering_comparator_revision, ordering_position,
      watermark, member_count, ordered_member_digest_sha256,
      materialized_by_trusted_service_id,
      materialization_authorization_token, observed_at, recorded_at,
      revision, created_at, updated_at
    )
    select
      source_row.tenant_id,
      ${input.targetId},
      source_row.source_thread_binding_id,
      source_row.external_thread_id,
      source_row.source_connection_id,
      source_row.source_account_id,
      source_row.binding_revision,
      source_row.binding_generation,
      source_row.adapter_contract_id,
      source_row.adapter_contract_version,
      source_row.adapter_declaration_revision,
      source_row.adapter_surface_id,
      source_row.adapter_loaded_by_trusted_service_id,
      source_row.adapter_loaded_at,
      source_row.capability_revision,
      source_row.observation_kind,
      source_row.raw_inbound_event_id,
      source_row.normalized_inbound_event_id,
      source_row.completeness,
      source_row.authority,
      source_row.omission_policy,
      source_row.ordering_kind,
      source_row.ordering_scope_token,
      source_row.ordering_comparator_id,
      source_row.ordering_comparator_revision,
      ${input.orderingPosition ?? sql`source_row.ordering_position`},
      source_row.watermark,
      source_row.member_count,
      ${input.digest ?? "e".repeat(64)},
      source_row.materialized_by_trusted_service_id,
      source_row.materialization_authorization_token,
      source_row.observed_at,
      source_row.recorded_at,
      source_row.revision,
      source_row.created_at,
      source_row.updated_at
    from inbox_v2_provider_roster_evidence source_row
    where source_row.tenant_id = ${tenantId}
      and source_row.id = ${input.sourceId}
  `);
}

async function cloneRosterMembers(
  executor: { execute(query: SQL): Promise<unknown> },
  tenantId: InboxV2TenantId,
  input: Readonly<{
    sourceId: string;
    targetId: string;
    idSuffix: string;
  }>
): Promise<void> {
  await executor.execute(sql`
    insert into inbox_v2_provider_roster_member_evidence (
      tenant_id, id, roster_evidence_id, source_thread_binding_id,
      external_thread_id, source_connection_id, source_account_id,
      ordinal, source_external_identity_id, source_external_identity_revision,
      state, normalized_role, provider_state_code, provider_role_code,
      observed_at, roster_recorded_at, revision, created_at, updated_at
    )
    select
      source_row.tenant_id,
      source_row.id || ${`-${input.idSuffix}`},
      ${input.targetId},
      source_row.source_thread_binding_id,
      source_row.external_thread_id,
      source_row.source_connection_id,
      source_row.source_account_id,
      source_row.ordinal,
      source_row.source_external_identity_id,
      source_row.source_external_identity_revision,
      source_row.state,
      source_row.normalized_role,
      source_row.provider_state_code,
      source_row.provider_role_code,
      source_row.observed_at,
      source_row.roster_recorded_at,
      source_row.revision,
      source_row.created_at,
      source_row.updated_at
    from inbox_v2_provider_roster_member_evidence source_row
    where source_row.tenant_id = ${tenantId}
      and source_row.roster_evidence_id = ${input.sourceId}
    order by source_row.ordinal
  `);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
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
    current = "cause" in current ? current.cause : null;
  }
  return messages.join("\n");
}
