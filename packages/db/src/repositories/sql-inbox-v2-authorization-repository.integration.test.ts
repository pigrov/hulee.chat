import { createHash } from "node:crypto";

import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationParticipantIdSchema,
  inboxV2ConversationWorkItemSlotSchema,
  inboxV2EmployeeIdSchema,
  inboxV2ParticipantMembershipEpisodeIdSchema,
  inboxV2ParticipantMembershipReasonIdSchema,
  inboxV2ParticipantMembershipTransitionIdSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemCreationCommitSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkItemServicingTeamCommitSchema,
  inboxV2WorkItemServicingTeamEpisodeSchema,
  inboxV2WorkItemSchema,
  inboxV2WorkQueueSchema,
  type InboxV2WorkItem
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  computeInboxV2LeafHashDigest,
  createSqlInboxV2AuthorizationRepository,
  type InboxV2AuthorizationRelationRevisionEffect,
  type InboxV2AuthorizationRevisionPlan,
  type InboxV2AuthorizationTransactionExecutor,
  type InboxV2PrivilegedAuthorizationMutationContext,
  type WithPrivilegedAuthorizationMutationInput
} from "./sql-inbox-v2-authorization-repository";
import { createSqlInboxV2ConversationRepository } from "./sql-inbox-v2-conversation-repository";
import {
  createSqlInboxV2ParticipantMembershipRepository,
  type InboxV2ParticipantMembershipTransactionExecutor,
  type StartInboxV2ParticipantMembershipEpisodeInput
} from "./sql-inbox-v2-participant-membership-repository";
import {
  createSqlInboxV2WorkItemRepository,
  type InboxV2WorkItemTransactionExecutor
} from "./sql-inbox-v2-work-item-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const BIG_WORK_ITEM_CYCLE = "9007199254740993";
const hashA = `sha256:${"a".repeat(64)}`;

type IntegrationFixture = Readonly<{
  suffix: string;
  tenantId: string;
  actorId: string;
  otherEmployeeId: string;
  orgUnitId: string;
  queueId: string;
  teamId: string;
  conversationA: string;
  conversationB: string;
  resourceHeadA: string;
  resourceHeadB: string;
  workItemId: string;
}>;

type ArtifactCounts = Readonly<{
  commands: number;
  mutationCommits: number;
  audits: number;
  auditFacets: number;
  streamCommits: number;
  changes: number;
  events: number;
  outboxIntents: number;
  revisionEffects: number;
  relationWrites: number;
}>;

describe("SQL Inbox V2 authorization live-fixture contracts", () => {
  it("keeps every live mutation shape production-normalizable", async () => {
    const fixture: IntegrationFixture = {
      suffix: "shape",
      tenantId: "tenant:rbac003-shape",
      actorId: "employee:rbac003-shape-a",
      otherEmployeeId: "employee:rbac003-shape-b",
      orgUnitId: "org_unit:rbac003-shape",
      queueId: "work_queue:rbac003-shape",
      teamId: "team:rbac003-shape",
      conversationA: "conversation:rbac003-shape-a",
      conversationB: "conversation:rbac003-shape-b",
      resourceHeadA: "authorization-resource:rbac003-shape-a",
      resourceHeadB: "authorization-resource:rbac003-shape-b",
      workItemId: "work_item:rbac003-shape"
    };
    const occurredAt = new Date().toISOString();
    const sentinel = "rbac003 fixture normalized";
    const executor: InboxV2AuthorizationTransactionExecutor = {
      async execute<Row extends Record<string, unknown>>() {
        return { rows: [] as readonly Row[] };
      },
      async transaction<_TResult>() {
        throw new Error(sentinel);
      }
    };
    const inputs = [
      roleMutationInput(fixture, "shape-role", { occurredAt }),
      roleBindingMutationInput(fixture, "shape-role-binding", {
        bindingId: roleBindingId(fixture, "shape-role-binding"),
        occurredAt
      }),
      directGrantMutationInput(fixture, "shape-direct", {
        grantId: directGrantId(fixture, "shape-direct"),
        expectedEmployeeAccessRevision: "1",
        occurredAt
      }),
      workforceMembershipMutationInput(fixture, "shape-workforce", {
        expectedEmployeeAccessRevision: "1",
        occurredAt
      }),
      structuralMutationInput(fixture, "shape-structural", { occurredAt }),
      conversationCollaboratorMutationInput(
        fixture,
        "shape-conversation-collaborator",
        { occurredAt }
      ),
      workItemCollaboratorMutationInput(
        fixture,
        "shape-work-item-collaborator",
        { occurredAt, workItemCycle: "0", expectedWorkItemRevision: "1" }
      ),
      servicingTeamMutationInput(fixture, "shape-servicing-team", {
        occurredAt
      }),
      internalMembershipMutationInput(fixture, "shape-internal-membership", {
        conversationId: fixture.conversationA,
        employeeId: fixture.actorId,
        resourceHeadId: fixture.resourceHeadA,
        occurredAt
      })
    ];

    for (const input of inputs) {
      await expect(
        createSqlInboxV2AuthorizationRepository(
          executor
        ).withPrivilegedAuthorizationMutation(input, async () => {
          throw new Error("fixture callback must not run");
        })
      ).rejects.toThrow(sentinel);
    }
  });
});

describePostgres(
  "SQL Inbox V2 authorization repository (live PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    const fixtures: IntegrationFixture[] = [];

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<Record<string, string | null>>(sql`
        select
          to_regclass('public.inbox_v2_auth_command_records')::text as commands,
          to_regclass('public.inbox_v2_auth_mutation_commits')::text as mutations,
          to_regclass('public.inbox_v2_auth_relation_writes')::text as relation_writes,
          to_regclass('public.inbox_v2_tenant_stream_commits')::text as stream_commits
      `);
      const row = readiness.rows[0];
      if (
        row === undefined ||
        Object.values(row).some((value) => value === null)
      ) {
        throw new Error(
          "Inbox V2 authorization migration 0034 is not applied."
        );
      }
    }, 30_000);

    afterAll(async () => {
      if (!db) return;
      for (const fixture of fixtures.reverse()) {
        await deleteFixture(db, fixture);
      }
      await closeHuleeDatabase(db);
    }, 60_000);

    async function fixture(suffix: string): Promise<IntegrationFixture> {
      const created = await createFixture(db, suffix);
      fixtures.push(created);
      return created;
    }

    it("commits one atomic role mutation, replays status-only and keeps Employee fanout at zero", async () => {
      const current = await fixture("role-replay");
      const input = roleMutationInput(current, "role-replay", {
        sensitiveResultReference: internalRef("sensitive-role-replay")
      });
      let callbackCount = 0;
      const repository = createSqlInboxV2AuthorizationRepository(db);

      const applied = await repository.withPrivilegedAuthorizationMutation(
        input,
        async (context) => {
          callbackCount += 1;
          return persistRole(context, input, roleId(current, "role-replay"));
        }
      );

      expect(applied).toMatchObject({
        kind: "applied",
        status: {
          streamEpoch: input.records.expectedStreamEpoch,
          streamPosition: "1",
          sensitiveResultReference: input.command.sensitiveResultReference
        }
      });
      const replay = await repository.withPrivilegedAuthorizationMutation(
        input,
        async () => {
          callbackCount += 1;
          throw new Error("replay callback must not run");
        }
      );
      expect(replay.kind).toBe("already_applied");
      if (replay.kind === "already_applied") {
        expect(Object.hasOwn(replay.status, "sensitiveResultReference")).toBe(
          false
        );
      }
      expect(callbackCount).toBe(1);

      const differentHash =
        await repository.withPrivilegedAuthorizationMutation(
          {
            ...input,
            command: {
              ...input.command,
              requestHash: digest("different-request")
            }
          },
          async () => {
            throw new Error("conflict callback must not run");
          }
        );
      expect(differentHash).toEqual({
        kind: "idempotency_conflict",
        code: "command.idempotency_conflict"
      });

      expect(await artifactCounts(db, current.tenantId)).toEqual({
        commands: 1,
        mutationCommits: 1,
        audits: 1,
        auditFacets: 1,
        streamCommits: 1,
        changes: 1,
        events: 1,
        outboxIntents: 1,
        revisionEffects: 1,
        relationWrites: 1
      });
      const heads = await db.execute<{
        tenant_rbac_revision: string;
        shared_access_revision: string;
        employee_access_revision: string;
        employee_inbox_relation_revision: string;
      }>(sql`
        select tenant_head.tenant_rbac_revision::text,
               tenant_head.shared_access_revision::text,
               employee_head.employee_access_revision::text,
               employee_head.employee_inbox_relation_revision::text
        from inbox_v2_auth_tenant_heads tenant_head
        join inbox_v2_auth_employee_heads employee_head
          on employee_head.tenant_id = tenant_head.tenant_id
         and employee_head.employee_id = ${current.actorId}
        where tenant_head.tenant_id = ${current.tenantId}
      `);
      expect(heads.rows).toEqual([
        {
          tenant_rbac_revision: "2",
          shared_access_revision: "1",
          employee_access_revision: "1",
          employee_inbox_relation_revision: "1"
        }
      ]);
      const effectKinds = await db.execute<{ effect_kind: string }>(sql`
        select effect_kind::text
        from inbox_v2_auth_revision_effects
        where tenant_id = ${current.tenantId}
        order by ordinal
      `);
      expect(effectKinds.rows).toEqual([{ effect_kind: "tenant_rbac" }]);
    }, 30_000);

    it("rejects every late child artifact after an authorization mutation is sealed", async () => {
      const current = await fixture("sealed-mutation-children");
      const repository = createSqlInboxV2AuthorizationRepository(db);
      const firstRoleInput = roleMutationInput(current, "sealed-role-first");
      const secondRoleInput = roleMutationInput(current, "sealed-role-second", {
        expectedTenantRbacRevision: "2"
      });
      const firstRoleId = roleId(current, "sealed-role-first");
      const secondRoleId = roleId(current, "sealed-role-second");

      expect(
        (
          await repository.withPrivilegedAuthorizationMutation(
            firstRoleInput,
            (context) => persistRole(context, firstRoleInput, firstRoleId)
          )
        ).kind
      ).toBe("applied");
      expect(
        (
          await repository.withPrivilegedAuthorizationMutation(
            secondRoleInput,
            (context) => persistRole(context, secondRoleInput, secondRoleId)
          )
        ).kind
      ).toBe("applied");

      const baseline = {
        commands: 2,
        mutationCommits: 2,
        audits: 2,
        auditFacets: 2,
        streamCommits: 2,
        changes: 2,
        events: 2,
        outboxIntents: 2,
        revisionEffects: 2,
        relationWrites: 2
      } satisfies ArtifactCounts;
      expect(await artifactCounts(db, current.tenantId)).toEqual(baseline);

      const expectedMessage =
        "inbox_v2.authorization_mutation_sealed_manifest_changed";
      await expectDatabaseFailure(
        db.execute(sql`
          insert into inbox_v2_tenant_stream_changes (
            tenant_id, id, mutation_id, stream_commit_id, stream_position,
            ordinal, entity_type_id, entity_id, resulting_revision,
            timeline, audience, state_kind, state_schema_id,
            state_schema_version, state_hash, payload_reference,
            domain_commit_reference, created_at
          )
          select tenant_id,
                 ${internalId("tenant-stream-change", current, "late-child")},
                 mutation_id, stream_commit_id, stream_position, 2,
                 entity_type_id, entity_id, resulting_revision, timeline,
                 audience, state_kind, state_schema_id, state_schema_version,
                 ${digest(`${current.tenantId}:late-change`)},
                 payload_reference, domain_commit_reference, created_at
          from inbox_v2_tenant_stream_changes
          where tenant_id = ${current.tenantId}
            and mutation_id = ${firstRoleInput.records.mutationId}
        `),
        "23514",
        expectedMessage
      );
      await expectDatabaseFailure(
        db.execute(sql`
          insert into inbox_v2_domain_events (
            tenant_id, id, mutation_id, stream_commit_id, stream_position,
            ordinal, type_id, payload_schema_id, payload_schema_version,
            change_ids, subjects, payload_reference, correlation_id,
            command_ids, client_mutation_ids, authorization_decision_refs,
            access_effect, access_effect_causes, event_hash, occurred_at,
            recorded_at
          )
          select tenant_id,
                 ${internalId("domain-event", current, "late-child")},
                 mutation_id, stream_commit_id, stream_position, 2, type_id,
                 payload_schema_id, payload_schema_version, change_ids,
                 subjects, payload_reference, correlation_id, command_ids,
                 client_mutation_ids, authorization_decision_refs,
                 access_effect, access_effect_causes,
                 ${digest(`${current.tenantId}:late-event`)},
                 occurred_at, recorded_at
          from inbox_v2_domain_events
          where tenant_id = ${current.tenantId}
            and mutation_id = ${firstRoleInput.records.mutationId}
        `),
        "23514",
        expectedMessage
      );
      await expectDatabaseFailure(
        db.execute(sql`
          insert into inbox_v2_outbox_intents (
            tenant_id, id, mutation_id, stream_commit_id, stream_position,
            ordinal, type_id, handler_id, effect_class, event_id,
            consumer_dedupe_key, change_ids, payload_reference,
            correlation_id, intent_hash, available_at, created_at
          )
          select tenant_id,
                 ${internalId("outbox-intent", current, "late-child")},
                 mutation_id, stream_commit_id, stream_position, 2, type_id,
                 handler_id, effect_class, event_id,
                 ${digest(`${current.tenantId}:late-consumer-dedupe`)},
                 change_ids, payload_reference, correlation_id,
                 ${digest(`${current.tenantId}:late-intent`)},
                 available_at, created_at
          from inbox_v2_outbox_intents
          where tenant_id = ${current.tenantId}
            and mutation_id = ${firstRoleInput.records.mutationId}
        `),
        "23514",
        expectedMessage
      );
      await expectDatabaseFailure(
        db.execute(sql`
          insert into inbox_v2_auth_audit_facets (
            tenant_id, audit_event_id, ordinal, dimension, facet_kind,
            entity_type_id, internal_entity_ref, facet_hash, created_at
          )
          select tenant_id, audit_event_id, 2, dimension, facet_kind,
                 entity_type_id,
                 ${internalRef(`${current.tenantId}:late-facet`)},
                 ${digest(`${current.tenantId}:late-facet`)}, created_at
          from inbox_v2_auth_audit_facets
          where tenant_id = ${current.tenantId}
            and audit_event_id = ${firstRoleInput.records.audit.id}
        `),
        "23514",
        expectedMessage
      );
      await expectDatabaseFailure(
        db.execute(sql`
          insert into inbox_v2_auth_revision_effects (
            tenant_id, id, mutation_id, ordinal, effect_kind,
            before_revision, after_revision, employee_id, resource_head_id,
            work_item_id, work_item_cycle, expected_work_item_revision,
            resulting_work_item_revision, effect_hash, created_at
          ) values (
            ${current.tenantId},
            ${internalId("authorization-revision-effect", current, "late-child")},
            ${firstRoleInput.records.mutationId}, 2, 'tenant_rbac', 3, 4,
            null, null, null, null, null, null,
            ${digest(`${current.tenantId}:late-effect`)},
            ${firstRoleInput.occurredAt}
          )
        `),
        "23514",
        expectedMessage
      );
      await expectDatabaseFailure(
        db.execute(sql`
          insert into inbox_v2_auth_relation_writes (
            tenant_id, id, mutation_id, ordinal, relation_kind, relation_id,
            previous_revision, resulting_revision, role_id, role_binding_id,
            direct_grant_id, workforce_membership_id,
            structural_access_binding_id, collaborator_id,
            internal_membership_transition_id,
            primary_responsibility_transition_id,
            servicing_team_transition_id, write_hash, created_at
          ) values (
            ${current.tenantId},
            ${internalId("authorization-relation-write", current, "late-child")},
            ${firstRoleInput.records.mutationId}, 2, 'role', ${secondRoleId},
            null, 1, ${secondRoleId}, null, null, null, null, null, null,
            null, null, ${digest(`${current.tenantId}:late-relation`)},
            ${firstRoleInput.occurredAt}
          )
        `),
        "23514",
        expectedMessage
      );

      expect(await artifactCounts(db, current.tenantId)).toEqual(baseline);
    }, 30_000);

    it("rejects a raw role update incompatible with both active and future-scheduled bindings", async () => {
      const current = await fixture("role-legality-bindings");
      const repository = createSqlInboxV2AuthorizationRepository(db);
      const persistedRoleId = roleId(current, "legality");
      const createRoleInput = roleMutationInput(
        current,
        "role-legality-create"
      );
      expect(
        (
          await repository.withPrivilegedAuthorizationMutation(
            createRoleInput,
            (context) =>
              persistRole(context, createRoleInput, {
                roleId: persistedRoleId,
                permissionIds: ["core:roles.bind"]
              })
          )
        ).kind
      ).toBe("applied");

      const activeBindingId = roleBindingId(current, "active-team");
      const activeBindingInput = roleBindingMutationInput(
        current,
        "role-legality-active-team",
        {
          bindingId: activeBindingId,
          expectedTenantRbacRevision: "2"
        }
      );
      expect(
        (
          await repository.withPrivilegedAuthorizationMutation(
            activeBindingInput,
            (context) =>
              persistRoleBinding(context, activeBindingInput, {
                bindingId: activeBindingId,
                roleId: persistedRoleId,
                roleRevisionObserved: "1",
                scopeKind: "team",
                scopeId: current.teamId
              })
          )
        ).kind
      ).toBe("applied");

      const scheduledBindingId = roleBindingId(current, "scheduled-queue");
      const scheduledBindingInput = roleBindingMutationInput(
        current,
        "role-legality-scheduled-queue",
        {
          bindingId: scheduledBindingId,
          expectedTenantRbacRevision: "3"
        }
      );
      expect(
        (
          await repository.withPrivilegedAuthorizationMutation(
            scheduledBindingInput,
            (context) =>
              persistRoleBinding(context, scheduledBindingInput, {
                bindingId: scheduledBindingId,
                roleId: persistedRoleId,
                roleRevisionObserved: "1",
                scopeKind: "queue",
                scopeId: current.queueId,
                validFrom: new Date(
                  Date.parse(scheduledBindingInput.occurredAt) + 86_400_000
                ).toISOString()
              })
          )
        ).kind
      ).toBe("applied");

      const incompatibleUpdateInput = roleMutationInput(
        current,
        "role-legality-incompatible-update",
        { expectedTenantRbacRevision: "4" }
      );
      let incompatibleCallbackCount = 0;
      const incompatible = await repository.withPrivilegedAuthorizationMutation(
        incompatibleUpdateInput,
        async (context) => {
          incompatibleCallbackCount += 1;
          return persistRole(context, incompatibleUpdateInput, {
            roleId: persistedRoleId,
            revision: "2",
            previousRevision: "1",
            permissionIds: ["core:queue.manage", "core:team.manage"]
          });
        }
      );
      expect(incompatibleCallbackCount).toBe(1);
      expect(incompatible).toMatchObject({
        kind: "role_legality_conflict",
        code: "authorization.role_legality_conflict",
        relationKind: "role",
        relationId: persistedRoleId,
        reason: "incompatible_binding_scope",
        conflicts: expect.arrayContaining([
          {
            bindingId: activeBindingId,
            permissionId: "core:queue.manage",
            reason: "illegal_scope",
            scopeType: "team"
          },
          {
            bindingId: scheduledBindingId,
            permissionId: "core:team.manage",
            reason: "illegal_scope",
            scopeType: "queue"
          }
        ])
      });
      expect(
        await db.execute(sql`
          select head.current_revision::text,
                 count(version.*)::integer as version_count
          from inbox_v2_auth_role_heads head
          join inbox_v2_auth_role_versions version
            on version.tenant_id = head.tenant_id
           and version.role_id = head.role_id
          where head.tenant_id = ${current.tenantId}
            and head.role_id = ${persistedRoleId}
          group by head.current_revision
        `)
      ).toMatchObject({
        rows: [{ current_revision: "1", version_count: 1 }]
      });
      expect(await artifactCounts(db, current.tenantId)).toEqual({
        commands: 3,
        mutationCommits: 3,
        audits: 3,
        auditFacets: 3,
        streamCommits: 3,
        changes: 3,
        events: 3,
        outboxIntents: 3,
        revisionEffects: 3,
        relationWrites: 3
      });
    }, 30_000);

    it("serializes role update ahead of role-binding creation through one tenant RBAC CAS", async () => {
      const current = await fixture("role-binding-race");
      const repository = createSqlInboxV2AuthorizationRepository(db);
      const persistedRoleId = roleId(current, "race");
      const createRoleInput = roleMutationInput(current, "role-race-create");
      expect(
        (
          await repository.withPrivilegedAuthorizationMutation(
            createRoleInput,
            (context) =>
              persistRole(context, createRoleInput, {
                roleId: persistedRoleId,
                permissionIds: ["core:roles.bind"]
              })
          )
        ).kind
      ).toBe("applied");

      const callbackEntered = deferred<void>();
      const releaseCallback = deferred<void>();
      const roleUpdateInput = roleMutationInput(current, "role-race-update", {
        expectedTenantRbacRevision: "2"
      });
      const roleUpdate = repository.withPrivilegedAuthorizationMutation(
        roleUpdateInput,
        async (context) => {
          const persisted = await persistRole(context, roleUpdateInput, {
            roleId: persistedRoleId,
            revision: "2",
            previousRevision: "1",
            permissionIds: ["core:team.manage"]
          });
          callbackEntered.resolve();
          await releaseCallback.promise;
          return persisted;
        }
      );
      await callbackEntered.promise;

      const bindingId = roleBindingId(current, "race");
      const bindingInput = roleBindingMutationInput(
        current,
        "role-binding-race-create",
        { bindingId, expectedTenantRbacRevision: "2" }
      );
      const bindingPid = deferred<number>();
      let bindingCallbackCount = 0;
      const bindingCreate = createSqlInboxV2AuthorizationRepository(
        captureBackendExecutor(db, bindingPid)
      ).withPrivilegedAuthorizationMutation(bindingInput, (context) => {
        bindingCallbackCount += 1;
        return persistRoleBinding(context, bindingInput, {
          bindingId,
          roleId: persistedRoleId,
          roleRevisionObserved: "1",
          scopeKind: "team",
          scopeId: current.teamId
        });
      });
      const pid = await bindingPid.promise;
      await waitForBackendLock(db, pid);
      releaseCallback.resolve();

      expect((await roleUpdate).kind).toBe("applied");
      expect(await bindingCreate).toMatchObject({
        kind: "revision_conflict",
        conflicts: [
          {
            kind: "tenant_rbac",
            expectedRevision: "2",
            currentRevision: "3"
          }
        ]
      });
      expect(bindingCallbackCount).toBe(0);
      expect(
        await scalarCount(
          db,
          sql`select count(*)::integer as count
              from inbox_v2_auth_role_binding_versions
              where tenant_id = ${current.tenantId}`
        )
      ).toBe(0);
      expect(await artifactCounts(db, current.tenantId)).toEqual({
        commands: 2,
        mutationCommits: 2,
        audits: 2,
        auditFacets: 2,
        streamCommits: 2,
        changes: 2,
        events: 2,
        outboxIntents: 2,
        revisionEffects: 2,
        relationWrites: 2
      });
    }, 30_000);

    it("persists DirectGrant null-to-1, revokes N-to-N+1 and forbids morph or resurrection", async () => {
      const current = await fixture("direct-lifecycle");
      const grant = directGrantId(current, "lifecycle");
      const repository = createSqlInboxV2AuthorizationRepository(db);
      const createdAt = new Date(Date.now() - 10_000).toISOString();
      const createInput = directGrantMutationInput(current, "direct-create", {
        grantId: grant,
        expectedEmployeeAccessRevision: "1",
        occurredAt: createdAt,
        authorizedAt: createdAt,
        notAfter: new Date(Date.now() + 60 * 60 * 1_000).toISOString()
      });

      const created = await repository.withPrivilegedAuthorizationMutation(
        createInput,
        (context) =>
          persistDirectGrant(context, createInput, {
            grantId: grant,
            employeeId: current.actorId,
            revision: "1",
            previousRevision: null,
            state: "active",
            validFrom: createInput.occurredAt
          })
      );
      expect(created.kind).toBe("applied");
      expect(await directGrantState(db, current.tenantId, grant)).toEqual({
        currentRevision: "1",
        versions: [
          { revision: "1", employeeId: current.actorId, state: "active" }
        ]
      });

      await expectDatabaseFailure(
        insertStandaloneDirectGrantRevision(db, createInput, {
          grantId: grant,
          employeeId: current.actorId,
          revision: "2",
          state: "archived",
          validFrom: createInput.occurredAt,
          validUntil: new Date(
            Date.parse(createInput.occurredAt) + 5_000
          ).toISOString()
        }),
        "23514",
        "inbox_v2.authorization_relation_interval_morph"
      );

      const revokeInput = directGrantMutationInput(current, "direct-revoke", {
        grantId: grant,
        expectedEmployeeAccessRevision: "2"
      });
      const revoked = await repository.withPrivilegedAuthorizationMutation(
        revokeInput,
        (context) =>
          persistDirectGrant(context, revokeInput, {
            grantId: grant,
            employeeId: current.actorId,
            revision: "2",
            previousRevision: "1",
            state: "revoked",
            validFrom: createInput.occurredAt
          })
      );
      expect(revoked.kind).toBe("applied");
      expect(await directGrantState(db, current.tenantId, grant)).toEqual({
        currentRevision: "2",
        versions: [
          { revision: "1", employeeId: current.actorId, state: "active" },
          { revision: "2", employeeId: current.actorId, state: "revoked" }
        ]
      });

      await expectDatabaseFailure(
        insertStandaloneDirectGrantRevision(db, revokeInput, {
          grantId: grant,
          employeeId: current.otherEmployeeId,
          revision: "3",
          state: "revoked",
          validFrom: createInput.occurredAt
        }),
        "23514",
        "inbox_v2.authorization_relation_identity_morph"
      );
      await expectDatabaseFailure(
        insertStandaloneDirectGrantRevision(db, revokeInput, {
          grantId: grant,
          employeeId: current.actorId,
          revision: "3",
          state: "active",
          validFrom: createInput.occurredAt
        }),
        "23514",
        "inbox_v2.authorization_relation_state_transition_invalid"
      );
      expect(await directGrantState(db, current.tenantId, grant)).toMatchObject(
        {
          currentRevision: "2",
          versions: [{ revision: "1" }, { revision: "2" }]
        }
      );
    }, 30_000);

    it("replaces terminal workforce, structural and collaborator relations without losing history or allowing resurrection", async () => {
      const workforce = await fixture("active-replace-workforce");
      const workforceRepository = createSqlInboxV2AuthorizationRepository(db);
      const workforceA = workforceMembershipId(workforce, "a");
      const workforceB = workforceMembershipId(workforce, "b");
      const workforceCreateA = workforceMembershipMutationInput(
        workforce,
        "active-replace-workforce-a-create",
        { expectedEmployeeAccessRevision: "1" }
      );
      expect(
        (
          await workforceRepository.withPrivilegedAuthorizationMutation(
            workforceCreateA,
            (context) =>
              persistWorkforceMembership(context, workforceCreateA, {
                membershipId: workforceA,
                employeeId: workforce.actorId,
                teamId: workforce.teamId
              })
          )
        ).kind
      ).toBe("applied");
      const workforceRevokeA = workforceMembershipMutationInput(
        workforce,
        "active-replace-workforce-a-revoke",
        { expectedEmployeeAccessRevision: "2" }
      );
      expect(
        (
          await workforceRepository.withPrivilegedAuthorizationMutation(
            workforceRevokeA,
            (context) =>
              persistWorkforceMembership(context, workforceRevokeA, {
                membershipId: workforceA,
                employeeId: workforce.actorId,
                teamId: workforce.teamId,
                revision: "2",
                previousRevision: "1",
                state: "revoked",
                validFrom: workforceCreateA.occurredAt
              })
          )
        ).kind
      ).toBe("applied");
      const workforceCreateB = workforceMembershipMutationInput(
        workforce,
        "active-replace-workforce-b-create",
        { expectedEmployeeAccessRevision: "3" }
      );
      expect(
        (
          await workforceRepository.withPrivilegedAuthorizationMutation(
            workforceCreateB,
            (context) =>
              persistWorkforceMembership(context, workforceCreateB, {
                membershipId: workforceB,
                employeeId: workforce.actorId,
                teamId: workforce.teamId
              })
          )
        ).kind
      ).toBe("applied");
      const workforceResurrectA = workforceMembershipMutationInput(
        workforce,
        "active-replace-workforce-a-resurrect",
        { expectedEmployeeAccessRevision: "4" }
      );
      await expectDatabaseFailure(
        workforceRepository.withPrivilegedAuthorizationMutation(
          workforceResurrectA,
          (context) =>
            persistWorkforceMembership(context, workforceResurrectA, {
              membershipId: workforceA,
              employeeId: workforce.actorId,
              teamId: workforce.teamId,
              revision: "3",
              previousRevision: "2",
              state: "active",
              validFrom: workforceCreateA.occurredAt
            })
        ),
        "23514",
        "inbox_v2.authorization_relation_state_transition_invalid"
      );
      const workforceState = await db.execute<{
        relation_id: string;
        current_state: string;
        current_revision: string;
        version_revision: string;
        version_state: string;
      }>(sql`
        select head.membership_id as relation_id,
               head.current_state::text,
               head.current_revision::text,
               version.revision::text as version_revision,
               version.state::text as version_state
        from inbox_v2_auth_workforce_membership_heads head
        join inbox_v2_auth_workforce_membership_versions version
          on version.tenant_id = head.tenant_id
         and version.membership_id = head.membership_id
        where head.tenant_id = ${workforce.tenantId}
        order by head.membership_id collate "C", version.revision
      `);
      expect(workforceState.rows).toHaveLength(3);
      expect(workforceState.rows).toEqual(
        expect.arrayContaining([
          {
            relation_id: workforceA,
            current_state: "revoked",
            current_revision: "2",
            version_revision: "1",
            version_state: "active"
          },
          {
            relation_id: workforceA,
            current_state: "revoked",
            current_revision: "2",
            version_revision: "2",
            version_state: "revoked"
          },
          {
            relation_id: workforceB,
            current_state: "active",
            current_revision: "1",
            version_revision: "1",
            version_state: "active"
          }
        ])
      );

      const structural = await fixture("active-replace-structural");
      const structuralRepository = createSqlInboxV2AuthorizationRepository(db);
      const structuralA = structuralBindingId(structural, "a");
      const structuralB = structuralBindingId(structural, "b");
      const structuralCreateA = structuralMutationInput(
        structural,
        "active-replace-structural-a-create"
      );
      expect(
        (
          await structuralRepository.withPrivilegedAuthorizationMutation(
            structuralCreateA,
            (context) =>
              persistStructuralAccess(context, structuralCreateA, {
                bindingId: structuralA,
                conversationId: structural.conversationA,
                resourceHeadId: structural.resourceHeadA,
                targetOrgUnitId: structural.orgUnitId
              })
          )
        ).kind
      ).toBe("applied");
      const structuralRevokeA = structuralMutationInput(
        structural,
        "active-replace-structural-a-revoke",
        {
          expectedSharedAccessRevision: "2",
          expectedResourceAccessRevision: "2",
          expectedStructuralRelationRevision: "2"
        }
      );
      expect(
        (
          await structuralRepository.withPrivilegedAuthorizationMutation(
            structuralRevokeA,
            (context) =>
              persistStructuralAccess(context, structuralRevokeA, {
                bindingId: structuralA,
                conversationId: structural.conversationA,
                resourceHeadId: structural.resourceHeadA,
                targetOrgUnitId: structural.orgUnitId,
                revision: "2",
                previousRevision: "1",
                state: "revoked",
                validFrom: structuralCreateA.occurredAt
              })
          )
        ).kind
      ).toBe("applied");
      const structuralCreateB = structuralMutationInput(
        structural,
        "active-replace-structural-b-create",
        {
          expectedSharedAccessRevision: "3",
          expectedResourceAccessRevision: "3",
          expectedStructuralRelationRevision: "3"
        }
      );
      expect(
        (
          await structuralRepository.withPrivilegedAuthorizationMutation(
            structuralCreateB,
            (context) =>
              persistStructuralAccess(context, structuralCreateB, {
                bindingId: structuralB,
                conversationId: structural.conversationA,
                resourceHeadId: structural.resourceHeadA,
                targetOrgUnitId: structural.orgUnitId
              })
          )
        ).kind
      ).toBe("applied");
      const structuralResurrectA = structuralMutationInput(
        structural,
        "active-replace-structural-a-resurrect",
        {
          expectedSharedAccessRevision: "4",
          expectedResourceAccessRevision: "4",
          expectedStructuralRelationRevision: "4"
        }
      );
      await expectDatabaseFailure(
        structuralRepository.withPrivilegedAuthorizationMutation(
          structuralResurrectA,
          (context) =>
            persistStructuralAccess(context, structuralResurrectA, {
              bindingId: structuralA,
              conversationId: structural.conversationA,
              resourceHeadId: structural.resourceHeadA,
              targetOrgUnitId: structural.orgUnitId,
              revision: "3",
              previousRevision: "2",
              state: "active",
              validFrom: structuralCreateA.occurredAt
            })
        ),
        "23514",
        "inbox_v2.authorization_relation_state_transition_invalid"
      );
      const structuralState = await db.execute<{
        relation_id: string;
        current_state: string;
        current_revision: string;
        version_revision: string;
        version_state: string;
      }>(sql`
        select head.binding_id as relation_id,
               head.current_state::text,
               head.current_revision::text,
               version.revision::text as version_revision,
               version.state::text as version_state
        from inbox_v2_auth_structural_access_heads head
        join inbox_v2_auth_structural_access_versions version
          on version.tenant_id = head.tenant_id
         and version.binding_id = head.binding_id
        where head.tenant_id = ${structural.tenantId}
        order by head.binding_id collate "C", version.revision
      `);
      expect(structuralState.rows).toHaveLength(3);
      expect(structuralState.rows).toEqual(
        expect.arrayContaining([
          {
            relation_id: structuralA,
            current_state: "revoked",
            current_revision: "2",
            version_revision: "1",
            version_state: "active"
          },
          {
            relation_id: structuralA,
            current_state: "revoked",
            current_revision: "2",
            version_revision: "2",
            version_state: "revoked"
          },
          {
            relation_id: structuralB,
            current_state: "active",
            current_revision: "1",
            version_revision: "1",
            version_state: "active"
          }
        ])
      );

      const collaboratorFixture = await fixture("active-replace-collaborator");
      const collaboratorRepository =
        createSqlInboxV2AuthorizationRepository(db);
      const collaboratorA = collaborator(collaboratorFixture, "a");
      const collaboratorB = collaborator(collaboratorFixture, "b");
      const collaboratorCreateA = conversationCollaboratorMutationInput(
        collaboratorFixture,
        "active-replace-collaborator-a-create"
      );
      expect(
        (
          await collaboratorRepository.withPrivilegedAuthorizationMutation(
            collaboratorCreateA,
            (context) =>
              persistCollaborator(context, collaboratorCreateA, {
                collaboratorId: collaboratorA,
                resourceKind: "conversation",
                conversationId: collaboratorFixture.conversationA,
                workItemId: null,
                workItemCycle: null
              })
          )
        ).kind
      ).toBe("applied");
      const collaboratorRevokeA = conversationCollaboratorMutationInput(
        collaboratorFixture,
        "active-replace-collaborator-a-revoke",
        {
          expectedEmployeeInboxRelationRevision: "2",
          expectedCollaboratorSetRevision: "2"
        }
      );
      expect(
        (
          await collaboratorRepository.withPrivilegedAuthorizationMutation(
            collaboratorRevokeA,
            (context) =>
              persistCollaborator(context, collaboratorRevokeA, {
                collaboratorId: collaboratorA,
                resourceKind: "conversation",
                conversationId: collaboratorFixture.conversationA,
                workItemId: null,
                workItemCycle: null,
                revision: "2",
                previousRevision: "1",
                state: "revoked",
                validFrom: collaboratorCreateA.occurredAt
              })
          )
        ).kind
      ).toBe("applied");
      const collaboratorCreateB = conversationCollaboratorMutationInput(
        collaboratorFixture,
        "active-replace-collaborator-b-create",
        {
          expectedEmployeeInboxRelationRevision: "3",
          expectedCollaboratorSetRevision: "3"
        }
      );
      expect(
        (
          await collaboratorRepository.withPrivilegedAuthorizationMutation(
            collaboratorCreateB,
            (context) =>
              persistCollaborator(context, collaboratorCreateB, {
                collaboratorId: collaboratorB,
                resourceKind: "conversation",
                conversationId: collaboratorFixture.conversationA,
                workItemId: null,
                workItemCycle: null
              })
          )
        ).kind
      ).toBe("applied");
      const collaboratorResurrectA = conversationCollaboratorMutationInput(
        collaboratorFixture,
        "active-replace-collaborator-a-resurrect",
        {
          expectedEmployeeInboxRelationRevision: "4",
          expectedCollaboratorSetRevision: "4"
        }
      );
      await expectDatabaseFailure(
        collaboratorRepository.withPrivilegedAuthorizationMutation(
          collaboratorResurrectA,
          (context) =>
            persistCollaborator(context, collaboratorResurrectA, {
              collaboratorId: collaboratorA,
              resourceKind: "conversation",
              conversationId: collaboratorFixture.conversationA,
              workItemId: null,
              workItemCycle: null,
              revision: "3",
              previousRevision: "2",
              state: "active",
              validFrom: collaboratorCreateA.occurredAt
            })
        ),
        "23514",
        "inbox_v2.authorization_relation_state_transition_invalid"
      );
      const collaboratorState = await db.execute<{
        relation_id: string;
        current_state: string;
        current_revision: string;
        version_revision: string;
        version_state: string;
      }>(sql`
        select head.collaborator_id as relation_id,
               head.current_state::text,
               head.current_revision::text,
               version.revision::text as version_revision,
               version.state::text as version_state
        from inbox_v2_auth_collaborator_heads head
        join inbox_v2_auth_collaborator_versions version
          on version.tenant_id = head.tenant_id
         and version.collaborator_id = head.collaborator_id
        where head.tenant_id = ${collaboratorFixture.tenantId}
        order by head.collaborator_id collate "C", version.revision
      `);
      expect(collaboratorState.rows).toHaveLength(3);
      expect(collaboratorState.rows).toEqual(
        expect.arrayContaining([
          {
            relation_id: collaboratorA,
            current_state: "revoked",
            current_revision: "2",
            version_revision: "1",
            version_state: "active"
          },
          {
            relation_id: collaboratorA,
            current_state: "revoked",
            current_revision: "2",
            version_revision: "2",
            version_state: "revoked"
          },
          {
            relation_id: collaboratorB,
            current_state: "active",
            current_revision: "1",
            version_revision: "1",
            version_state: "active"
          }
        ])
      );
    }, 60_000);

    it("rolls back the first retryable WorkforceMembership re-add callback before committing the second attempt", async () => {
      const current = await fixture("workforce-readd-retry");
      const repository = createSqlInboxV2AuthorizationRepository(db);
      const membershipA = workforceMembershipId(current, "a");
      const membershipB = workforceMembershipId(current, "b");
      const createA = workforceMembershipMutationInput(
        current,
        "workforce-readd-retry-a-create",
        { expectedEmployeeAccessRevision: "1" }
      );
      expect(
        (
          await repository.withPrivilegedAuthorizationMutation(
            createA,
            (context) =>
              persistWorkforceMembership(context, createA, {
                membershipId: membershipA,
                employeeId: current.actorId,
                teamId: current.teamId
              })
          )
        ).kind
      ).toBe("applied");
      const revokeA = workforceMembershipMutationInput(
        current,
        "workforce-readd-retry-a-revoke",
        { expectedEmployeeAccessRevision: "2" }
      );
      expect(
        (
          await repository.withPrivilegedAuthorizationMutation(
            revokeA,
            (context) =>
              persistWorkforceMembership(context, revokeA, {
                membershipId: membershipA,
                employeeId: current.actorId,
                teamId: current.teamId,
                revision: "2",
                previousRevision: "1",
                state: "revoked",
                validFrom: createA.occurredAt
              })
          )
        ).kind
      ).toBe("applied");

      const readdB = workforceMembershipMutationInput(
        current,
        "workforce-readd-retry-b-create",
        { expectedEmployeeAccessRevision: "3" }
      );
      let callbackCount = 0;
      const readded = await repository.withPrivilegedAuthorizationMutation(
        readdB,
        async (context) => {
          callbackCount += 1;
          const persisted = await persistWorkforceMembership(context, readdB, {
            membershipId: membershipB,
            employeeId: current.actorId,
            teamId: current.teamId
          });
          if (callbackCount === 1) {
            throw Object.assign(
              new Error("injected retryable WorkforceMembership write"),
              { code: "40001" }
            );
          }
          return persisted;
        }
      );
      expect(readded.kind).toBe("applied");
      expect(callbackCount).toBe(2);
      expect(
        await db.execute(sql`
          select
            (select count(*)::integer
               from inbox_v2_auth_workforce_membership_versions
              where tenant_id = ${current.tenantId}
                and membership_id = ${membershipB}) as version_count,
            (select count(*)::integer
               from inbox_v2_auth_workforce_membership_heads
              where tenant_id = ${current.tenantId}
                and membership_id = ${membershipB}
                and current_state = 'active'
                and current_revision = 1) as head_count
        `)
      ).toMatchObject({ rows: [{ version_count: 1, head_count: 1 }] });
      expect(await artifactCounts(db, current.tenantId)).toEqual({
        commands: 3,
        mutationCommits: 3,
        audits: 3,
        auditFacets: 3,
        streamCommits: 3,
        changes: 3,
        events: 3,
        outboxIntents: 3,
        revisionEffects: 3,
        relationWrites: 3
      });
    }, 30_000);

    it("allows only one concurrent active WorkforceMembership for one logical team edge", async () => {
      const current = await fixture("active-unique-race-workforce");
      const repository = createSqlInboxV2AuthorizationRepository(db);
      const candidates = ["left", "right"].map((suffix) => {
        const input = workforceMembershipMutationInput(
          current,
          `active-unique-race-workforce-${suffix}`,
          { expectedEmployeeAccessRevision: "1" }
        );
        const membershipId = workforceMembershipId(current, suffix);
        return repository.withPrivilegedAuthorizationMutation(
          input,
          (context) =>
            persistWorkforceMembership(context, input, {
              membershipId,
              employeeId: current.actorId,
              teamId: current.teamId
            })
        );
      });
      const results = await Promise.all(candidates);
      expect(
        results.filter((result) => result.kind === "applied")
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.kind === "revision_conflict")
      ).toHaveLength(1);
      expect(
        await scalarCount(
          db,
          sql`select count(*)::integer as count
              from inbox_v2_auth_workforce_membership_heads
              where tenant_id = ${current.tenantId}
                and employee_id = ${current.actorId}
                and membership_kind = 'team'
                and team_id = ${current.teamId}
                and current_state = 'active'`
        )
      ).toBe(1);
    }, 30_000);

    it("rolls back callback failures and stale stream epochs without orphan artifacts", async () => {
      const callbackFixture = await fixture("callback-rollback");
      const callbackInput = roleMutationInput(
        callbackFixture,
        "callback-rollback"
      );
      await expect(
        createSqlInboxV2AuthorizationRepository(
          db
        ).withPrivilegedAuthorizationMutation(
          callbackInput,
          async (context) => {
            await persistRole(
              context,
              callbackInput,
              roleId(callbackFixture, "callback-rollback")
            );
            throw new Error("injected live callback failure");
          }
        )
      ).rejects.toThrow("injected live callback failure");
      expect(await artifactCounts(db, callbackFixture.tenantId)).toEqual(
        zeroArtifactCounts()
      );
      expect(
        await scalarCount(
          db,
          sql`select count(*)::integer as count
              from inbox_v2_auth_role_versions
              where tenant_id = ${callbackFixture.tenantId}`
        )
      ).toBe(0);

      const epochFixture = await fixture("epoch-rollback");
      const epochInput = roleMutationInput(epochFixture, "epoch-rollback");
      await db.execute(sql`
        insert into inbox_v2_tenant_stream_heads (
          tenant_id, stream_epoch, last_position, min_retained_position,
          revision, created_at, updated_at
        ) values (
          ${epochFixture.tenantId}, ${streamEpoch(epochFixture, "other")},
          0, 0, 1, ${epochInput.occurredAt}, ${epochInput.occurredAt}
        )
      `);
      let epochCallbackCount = 0;
      const epochResult = await createSqlInboxV2AuthorizationRepository(
        db
      ).withPrivilegedAuthorizationMutation(epochInput, async (context) => {
        epochCallbackCount += 1;
        return persistRole(
          context,
          epochInput,
          roleId(epochFixture, "epoch-rollback")
        );
      });
      expect(epochResult).toMatchObject({
        kind: "revision_conflict",
        conflicts: [{ kind: "tenant_stream_epoch" }]
      });
      expect(epochCallbackCount).toBe(1);
      expect(await artifactCounts(db, epochFixture.tenantId)).toEqual(
        zeroArtifactCounts()
      );
    }, 30_000);

    it("rejects cross-tenant resources, wrong head IDs and wrong WorkItem cycles before callbacks", async () => {
      const current = await fixture("resource-negatives");
      const foreign = await fixture("resource-foreign");
      await insertAuthorizationResourceHead(db, current, "a");
      await seedWorkItem(db, current, BIG_WORK_ITEM_CYCLE);
      const repository = createSqlInboxV2AuthorizationRepository(db);

      const cases = [
        structuralMutationInput(current, "cross-tenant", {
          conversationId: foreign.conversationA,
          resourceHeadId: authorizationResourceHeadId(current, "cross-tenant")
        }),
        structuralMutationInput(current, "wrong-head", {
          conversationId: current.conversationA,
          resourceHeadId: authorizationResourceHeadId(current, "wrong")
        }),
        workItemCollaboratorMutationInput(current, "wrong-cycle", {
          workItemCycle: (BigInt(BIG_WORK_ITEM_CYCLE) + 1n).toString()
        })
      ];
      for (const input of cases) {
        let callbackCount = 0;
        const result = await repository.withPrivilegedAuthorizationMutation(
          input,
          async () => {
            callbackCount += 1;
            throw new Error("negative callback must not run");
          }
        );
        expect(result).toEqual({ kind: "resource_not_found" });
        expect(callbackCount).toBe(0);
      }
      let staleWorkItemCallbackCount = 0;
      const staleWorkItem =
        await repository.withPrivilegedAuthorizationMutation(
          workItemCollaboratorMutationInput(
            current,
            "wrong-work-item-revision",
            {
              workItemCycle: BIG_WORK_ITEM_CYCLE,
              expectedWorkItemRevision: "2"
            }
          ),
          async () => {
            staleWorkItemCallbackCount += 1;
            throw new Error("stale WorkItem callback must not run");
          }
        );
      expect(staleWorkItem).toMatchObject({
        kind: "revision_conflict",
        conflicts: [
          {
            kind: "work_item_revision",
            expectedRevision: "2",
            currentRevision: "1"
          }
        ]
      });
      expect(staleWorkItemCallbackCount).toBe(0);
      expect(await artifactCounts(db, current.tenantId)).toEqual(
        zeroArtifactCounts()
      );
    }, 30_000);

    it("rejects relation-derived direct and structural targets that differ from revision plans", async () => {
      const directFixture = await fixture("wrong-direct-target");
      const directInput = directGrantMutationInput(
        directFixture,
        "wrong-direct-target",
        {
          grantId: directGrantId(directFixture, "wrong-target"),
          expectedEmployeeAccessRevision: "1"
        }
      );
      await expect(
        createSqlInboxV2AuthorizationRepository(
          db
        ).withPrivilegedAuthorizationMutation(directInput, (context) =>
          persistDirectGrant(context, directInput, {
            grantId: directGrantId(directFixture, "wrong-target"),
            employeeId: directFixture.otherEmployeeId,
            revision: "1",
            previousRevision: null,
            state: "active",
            validFrom: directInput.occurredAt
          })
        )
      ).rejects.toThrow("target Employees do not match");
      expect(await artifactCounts(db, directFixture.tenantId)).toEqual(
        zeroArtifactCounts()
      );

      const structuralFixture = await fixture("wrong-structural-target");
      await insertAuthorizationResourceHead(db, structuralFixture, "a");
      await insertAuthorizationResourceHead(db, structuralFixture, "b");
      const structuralInput = structuralMutationInput(
        structuralFixture,
        "wrong-structural-target"
      );
      await expect(
        createSqlInboxV2AuthorizationRepository(
          db
        ).withPrivilegedAuthorizationMutation(structuralInput, (context) =>
          persistStructuralAccess(context, structuralInput, {
            bindingId: structuralBindingId(structuralFixture, "wrong-target"),
            conversationId: structuralFixture.conversationB,
            resourceHeadId: structuralFixture.resourceHeadB
          })
        )
      ).rejects.toThrow("resources do not match");
      expect(await artifactCounts(db, structuralFixture.tenantId)).toEqual(
        zeroArtifactCounts()
      );
    }, 30_000);

    it("rejects relation history attributed to a different actor than the command", async () => {
      const current = await fixture("actor-attribution-tamper");
      const grantId = directGrantId(current, "actor-attribution-tamper");
      const input = directGrantMutationInput(
        current,
        "actor-attribution-tamper",
        { grantId, expectedEmployeeAccessRevision: "1" }
      );
      const operation = createSqlInboxV2AuthorizationRepository(
        db
      ).withPrivilegedAuthorizationMutation(input, (context) =>
        persistDirectGrant(context, input, {
          grantId,
          employeeId: current.actorId,
          actorEmployeeId: current.otherEmployeeId,
          revision: "1",
          previousRevision: null,
          state: "active",
          validFrom: input.occurredAt
        })
      );

      await expectDatabaseFailure(
        operation,
        "23514",
        "inbox_v2.authorization_relation_actor_mismatch"
      );
      expect(await artifactCounts(db, current.tenantId)).toEqual(
        zeroArtifactCounts()
      );
      expect(
        await scalarCount(
          db,
          sql`select count(*)::integer as count
              from inbox_v2_auth_direct_grant_versions
              where tenant_id = ${current.tenantId}`
        )
      ).toBe(0);
    }, 30_000);

    it("advances exact Conversation collaborator and recipient aggregates", async () => {
      const current = await fixture("conversation-collaborator");
      const input = conversationCollaboratorMutationInput(
        current,
        "conversation-collaborator"
      );
      const collaboratorId = collaborator(current, "conversation");
      const result = await createSqlInboxV2AuthorizationRepository(
        db
      ).withPrivilegedAuthorizationMutation(input, (context) =>
        persistCollaborator(context, input, {
          collaboratorId,
          resourceKind: "conversation",
          conversationId: current.conversationA,
          workItemId: null,
          workItemCycle: null
        })
      );
      expect(result.kind).toBe("applied");

      const heads = await db.execute<{
        employee_inbox_relation_revision: string;
        collaborator_set_revision: string;
        resource_access_revision: string;
        collaborator_revision: string;
      }>(sql`
        select employee_head.employee_inbox_relation_revision::text,
               resource_head.collaborator_set_revision::text,
               resource_head.resource_access_revision::text,
               collaborator_head.current_revision::text as collaborator_revision
        from inbox_v2_auth_employee_heads employee_head
        join inbox_v2_auth_resource_heads resource_head
          on resource_head.tenant_id = employee_head.tenant_id
         and resource_head.conversation_id = ${current.conversationA}
        join inbox_v2_auth_collaborator_heads collaborator_head
          on collaborator_head.tenant_id = employee_head.tenant_id
         and collaborator_head.collaborator_id = ${collaboratorId}
        where employee_head.tenant_id = ${current.tenantId}
          and employee_head.employee_id = ${current.actorId}
      `);
      expect(heads.rows).toEqual([
        {
          employee_inbox_relation_revision: "2",
          collaborator_set_revision: "2",
          resource_access_revision: "1",
          collaborator_revision: "1"
        }
      ]);
    }, 30_000);

    it("composes one internal-membership DB002 start with its authorization mutation", async () => {
      const current = await fixture("internal-membership");
      const membership = await seedInternalEmployeeParticipant(
        db,
        current,
        "internal-membership"
      );
      const input = internalMembershipMutationInput(
        current,
        "internal-membership",
        {
          conversationId: membership.conversationId,
          employeeId: current.actorId,
          resourceHeadId: membership.resourceHeadId
        }
      );
      const startInput = internalMembershipStartInput(
        current,
        membership,
        input.occurredAt
      );

      const result = await createSqlInboxV2AuthorizationRepository(
        db
      ).withPrivilegedAuthorizationMutation(input, async (context) => {
        const started = await createSqlInboxV2ParticipantMembershipRepository(
          reuseParticipantMembershipTransaction(context.executor)
        ).withStartEpisode(startInput, async () => undefined);
        if (started.kind !== "created") {
          throw new Error(
            `RBAC003 DB002 internal-membership fixture returned ${started.kind}.`
          );
        }
        return {
          result: { membershipResult: started.kind },
          relationWrites: [
            relationWrite(input, started.record.transition.id, null, "1")
          ]
        };
      });

      expect(result).toMatchObject({
        kind: "applied",
        result: { membershipResult: "created" }
      });
      const state = await db.execute<{
        membership_revision: string;
        employee_inbox_relation_revision: string;
        transition_actor_employee_id: string | null;
      }>(sql`
        select membership_head.membership_revision::text,
               employee_head.employee_inbox_relation_revision::text,
               transition_row.cause_actor_employee_id as transition_actor_employee_id
        from inbox_v2_conversation_membership_heads membership_head
        join inbox_v2_auth_employee_heads employee_head
          on employee_head.tenant_id = membership_head.tenant_id
         and employee_head.employee_id = ${current.actorId}
        join inbox_v2_participant_membership_transitions transition_row
          on transition_row.tenant_id = membership_head.tenant_id
         and transition_row.conversation_id = membership_head.conversation_id
        where membership_head.tenant_id = ${current.tenantId}
          and membership_head.conversation_id = ${membership.conversationId}
      `);
      expect(state.rows).toEqual([
        {
          membership_revision: "1",
          employee_inbox_relation_revision: "2",
          transition_actor_employee_id: current.actorId
        }
      ]);
      expect(await artifactCounts(db, current.tenantId)).toMatchObject({
        commands: 1,
        mutationCommits: 1,
        revisionEffects: 1,
        relationWrites: 1
      });
    }, 30_000);

    it("serializes DirectGrant revoke ahead of a stale actor command", async () => {
      const current = await fixture("revoke-race");
      const grant = directGrantId(current, "race");
      const repository = createSqlInboxV2AuthorizationRepository(db);
      const createInput = directGrantMutationInput(current, "race-create", {
        grantId: grant,
        expectedEmployeeAccessRevision: "1"
      });
      expect(
        (
          await repository.withPrivilegedAuthorizationMutation(
            createInput,
            (context) =>
              persistDirectGrant(context, createInput, {
                grantId: grant,
                employeeId: current.actorId,
                revision: "1",
                previousRevision: null,
                state: "active",
                validFrom: createInput.occurredAt
              })
          )
        ).kind
      ).toBe("applied");

      const callbackEntered = deferred<void>();
      const releaseCallback = deferred<void>();
      const revokeInput = directGrantMutationInput(current, "race-revoke", {
        grantId: grant,
        expectedEmployeeAccessRevision: "2"
      });
      const revokeOperation = repository.withPrivilegedAuthorizationMutation(
        revokeInput,
        async (context) => {
          const persisted = await persistDirectGrant(context, revokeInput, {
            grantId: grant,
            employeeId: current.actorId,
            revision: "2",
            previousRevision: "1",
            state: "revoked",
            validFrom: createInput.occurredAt
          });
          callbackEntered.resolve();
          await releaseCallback.promise;
          return persisted;
        }
      );
      await callbackEntered.promise;

      const commandPid = deferred<number>();
      const staleCommandInput = roleMutationInput(current, "race-command", {
        expectedEmployeeAccessRevision: "2"
      });
      let staleCallbackCount = 0;
      const staleOperation = createSqlInboxV2AuthorizationRepository(
        captureBackendExecutor(db, commandPid)
      ).withPrivilegedAuthorizationMutation(staleCommandInput, async () => {
        staleCallbackCount += 1;
        throw new Error("stale actor callback must not run");
      });
      const pid = await commandPid.promise;
      await waitForBackendLock(db, pid);
      releaseCallback.resolve();

      expect((await revokeOperation).kind).toBe("applied");
      expect(await staleOperation).toMatchObject({
        kind: "revision_conflict",
        conflicts: [{ kind: "employee_access", currentRevision: "3" }]
      });
      expect(staleCallbackCount).toBe(0);
    }, 30_000);

    it("checks decision expiry after waiting for the tenant stream lock", async () => {
      const current = await fixture("temporal-lock");
      const timing = await databaseTiming(db, 750);
      const input = roleMutationInput(current, "temporal-lock", {
        occurredAt: timing.authorizedAt,
        authorizedAt: timing.authorizedAt,
        notAfter: timing.notAfter
      });
      await db.execute(sql`
        insert into inbox_v2_tenant_stream_heads (
          tenant_id, stream_epoch, last_position, min_retained_position,
          revision, created_at, updated_at
        ) values (
          ${current.tenantId}, ${input.records.expectedStreamEpoch},
          0, 0, 1, ${input.occurredAt}, ${input.occurredAt}
        )
      `);

      const blockerLocked = deferred<void>();
      const releaseBlocker = deferred<void>();
      const blocker = db.transaction(async (transaction) => {
        await transaction.execute(sql`
          select tenant_id
          from inbox_v2_tenant_stream_heads
          where tenant_id = ${current.tenantId}
          for update
        `);
        blockerLocked.resolve();
        await releaseBlocker.promise;
      });
      await blockerLocked.promise;

      const commandPid = deferred<number>();
      const operation = createSqlInboxV2AuthorizationRepository(
        captureBackendExecutor(db, commandPid)
      ).withPrivilegedAuthorizationMutation(input, (context) =>
        persistRole(context, input, roleId(current, "temporal-lock"))
      );
      const pid = await commandPid.promise;
      await waitForBackendLock(db, pid);
      await waitForDatabaseTime(
        db,
        input.records.audit.authorizationDecisionRefs[0]!.notAfter
      );
      releaseBlocker.resolve();

      expect(await operation).toMatchObject({
        kind: "revision_conflict",
        conflicts: [{ kind: "authorization_decision_time" }]
      });
      await blocker;
      expect(await artifactCounts(db, current.tenantId)).toEqual(
        zeroArtifactCounts()
      );
    }, 30_000);

    it("commits a WorkItem collaborator write on the legal current reopen cycle", async () => {
      const current = await fixture("work-item-collaborator");
      await seedWorkItem(db, current, "0");
      const input = workItemCollaboratorMutationInput(
        current,
        "work-item-collaborator",
        { workItemCycle: "0" }
      );
      const collaboratorId = collaborator(current, "work-item");
      const result = await createSqlInboxV2AuthorizationRepository(
        db
      ).withPrivilegedAuthorizationMutation(input, async (context) => {
        const persisted = await persistCollaborator(context, input, {
          collaboratorId,
          resourceKind: "work_item",
          conversationId: null,
          workItemId: current.workItemId,
          workItemCycle: "0"
        });
        await context.executor.execute(sql`
          update inbox_v2_work_items
          set collaborator_set_revision = collaborator_set_revision + 1,
              revision = revision + 1,
              updated_at = ${input.occurredAt}
          where tenant_id = ${current.tenantId}
            and id = ${current.workItemId}
            and reopen_cycle = 0
            and collaborator_set_revision = 1
        `);
        return persisted;
      });
      expect(result.kind).toBe("applied");
    }, 30_000);

    it("composes one servicing-team DB004 transition with its authorization mutation", async () => {
      const current = await fixture("servicing-team");
      await seedWorkItem(db, current, "0");
      const before = await createSqlInboxV2WorkItemRepository(
        db
      ).findWorkItemById({
        tenantId: inboxV2TenantIdSchema.parse(current.tenantId),
        workItemId: inboxV2WorkItemIdSchema.parse(current.workItemId)
      });
      if (before === null)
        throw new Error("Expected a legal WorkItem fixture.");
      const input = servicingTeamMutationInput(current, "servicing-team");
      const commit = servicingTeamAddCommit(current, before, input, {
        authorizationEpoch: input.command.authorizationEpoch
      });

      const result = await createSqlInboxV2AuthorizationRepository(
        db
      ).withPrivilegedAuthorizationMutation(input, async (context) => {
        const persisted = await createSqlInboxV2WorkItemRepository(
          reuseWorkItemTransaction(context.executor)
        ).withServicingTeamCommit(commit, async () => undefined);
        if (persisted.kind !== "applied") {
          throw new Error(
            `RBAC003 DB004 servicing-team fixture returned ${persisted.kind}.`
          );
        }
        return {
          result: { workItemResult: persisted.kind },
          relationWrites: [
            relationWrite(
              input,
              commit.transition.id,
              commit.transition.expectedRelationRevision,
              commit.transition.resultingRelationRevision
            )
          ]
        };
      });

      expect(result).toMatchObject({
        kind: "applied",
        result: { workItemResult: "applied" }
      });
      const state = await db.execute<{
        work_item_revision: string;
        servicing_team_relation_revision: string;
        resource_access_revision: string;
        current_servicing_team_id: string | null;
        shared_access_revision: string;
      }>(sql`
        select work_item.revision::text as work_item_revision,
               work_item.servicing_team_relation_revision::text,
               work_item.resource_access_revision::text,
               work_item.current_servicing_team_id,
               tenant_head.shared_access_revision::text
        from inbox_v2_work_items work_item
        join inbox_v2_auth_tenant_heads tenant_head
          on tenant_head.tenant_id = work_item.tenant_id
        where work_item.tenant_id = ${current.tenantId}
          and work_item.id = ${current.workItemId}
      `);
      expect(state.rows).toEqual([
        {
          work_item_revision: "2",
          servicing_team_relation_revision: "2",
          resource_access_revision: "2",
          current_servicing_team_id: current.teamId,
          shared_access_revision: "2"
        }
      ]);
      expect(await artifactCounts(db, current.tenantId)).toMatchObject({
        commands: 1,
        mutationCommits: 1,
        revisionEffects: 2,
        relationWrites: 1
      });
    }, 30_000);

    it("rolls a reused servicing-team transition back when its actor epoch is tampered", async () => {
      const current = await fixture("servicing-team-epoch-tamper");
      await seedWorkItem(db, current, "0");
      const before = await createSqlInboxV2WorkItemRepository(
        db
      ).findWorkItemById({
        tenantId: inboxV2TenantIdSchema.parse(current.tenantId),
        workItemId: inboxV2WorkItemIdSchema.parse(current.workItemId)
      });
      if (before === null)
        throw new Error("Expected a legal WorkItem fixture.");
      const input = servicingTeamMutationInput(
        current,
        "servicing-team-epoch-tamper"
      );
      const commit = servicingTeamAddCommit(current, before, input, {
        authorizationEpoch: internalId(
          "authorization",
          current,
          "tampered-work-item-epoch"
        )
      });
      const operation = createSqlInboxV2AuthorizationRepository(
        db
      ).withPrivilegedAuthorizationMutation(input, async (context) => {
        const persisted = await createSqlInboxV2WorkItemRepository(
          reuseWorkItemTransaction(context.executor)
        ).withServicingTeamCommit(commit, async () => undefined);
        if (persisted.kind !== "applied") {
          throw new Error(
            `RBAC003 DB004 tamper fixture returned ${persisted.kind}.`
          );
        }
        return {
          result: { workItemResult: persisted.kind },
          relationWrites: [
            relationWrite(
              input,
              commit.transition.id,
              commit.transition.expectedRelationRevision,
              commit.transition.resultingRelationRevision
            )
          ]
        };
      });

      await expectDatabaseFailure(
        operation,
        "23514",
        "inbox_v2.authorization_relation_write_invalid"
      );
      expect(await artifactCounts(db, current.tenantId)).toEqual(
        zeroArtifactCounts()
      );
      const rolledBack = await db.execute<{
        work_item_revision: string;
        servicing_team_relation_revision: string;
        resource_access_revision: string;
        current_servicing_team_id: string | null;
        transition_count: number;
      }>(sql`
        select work_item.revision::text as work_item_revision,
               work_item.servicing_team_relation_revision::text,
               work_item.resource_access_revision::text,
               work_item.current_servicing_team_id,
               (select count(*)::integer
                  from inbox_v2_work_item_relation_transitions transition_row
                 where transition_row.tenant_id = work_item.tenant_id
                   and transition_row.work_item_id = work_item.id) as transition_count
        from inbox_v2_work_items work_item
        where work_item.tenant_id = ${current.tenantId}
          and work_item.id = ${current.workItemId}
      `);
      expect(rolledBack.rows).toEqual([
        {
          work_item_revision: "1",
          servicing_team_relation_revision: "1",
          resource_access_revision: "1",
          current_servicing_team_id: null,
          transition_count: 0
        }
      ]);
    }, 30_000);

    it("rolls back missing, duplicate and unrelated WorkItem collaborator callback effects", async () => {
      const cases = [
        {
          suffix: "work-item-missing-effect",
          expectedMessage: "did not advance the exact WorkItem revision",
          update: null
        },
        {
          suffix: "work-item-duplicate-effect",
          expectedMessage:
            /did not advance the collaborator set aggregate|WorkItem update requires immutable identity and \+1 CAS/,
          update: "duplicate" as const
        },
        {
          suffix: "work-item-unrelated-field",
          expectedMessage:
            "Collaborator-set proof does not bind the exact OLD and NEW WorkItem heads",
          update: "unrelated" as const
        }
      ];

      for (const currentCase of cases) {
        const current = await fixture(currentCase.suffix);
        await seedWorkItem(db, current, "0");
        const input = workItemCollaboratorMutationInput(
          current,
          currentCase.suffix,
          { workItemCycle: "0" }
        );
        const collaboratorId = collaborator(current, currentCase.suffix);
        const operation = createSqlInboxV2AuthorizationRepository(
          db
        ).withPrivilegedAuthorizationMutation(input, async (context) => {
          const persisted = await persistCollaborator(context, input, {
            collaboratorId,
            resourceKind: "work_item",
            conversationId: null,
            workItemId: current.workItemId,
            workItemCycle: "0"
          });
          if (currentCase.update === "duplicate") {
            await context.executor.execute(sql`
              update inbox_v2_work_items
              set collaborator_set_revision = collaborator_set_revision + 2,
                  revision = revision + 1,
                  updated_at = ${input.occurredAt}
              where tenant_id = ${current.tenantId}
                and id = ${current.workItemId}
                and reopen_cycle = 0
                and collaborator_set_revision = 1
                and revision = 1
            `);
          } else if (currentCase.update === "unrelated") {
            await context.executor.execute(sql`
              update inbox_v2_work_items
              set collaborator_set_revision = collaborator_set_revision + 1,
                  priority_id = 'core:urgent',
                  revision = revision + 1,
                  updated_at = ${input.occurredAt}
              where tenant_id = ${current.tenantId}
                and id = ${current.workItemId}
                and reopen_cycle = 0
                and collaborator_set_revision = 1
                and revision = 1
            `);
          }
          return persisted;
        });

        if (currentCase.update === "unrelated") {
          await expectDatabaseFailure(
            operation,
            "23514",
            String(currentCase.expectedMessage)
          );
        } else {
          await expect(operation).rejects.toThrow(currentCase.expectedMessage);
        }
        expect(await artifactCounts(db, current.tenantId)).toEqual(
          zeroArtifactCounts()
        );
        expect(
          await scalarCount(
            db,
            sql`select count(*)::integer as count
                from inbox_v2_auth_collaborator_versions
                where tenant_id = ${current.tenantId}`
          )
        ).toBe(0);
      }
    }, 30_000);

    it("rejects missing, duplicate, wrong-cycle and wrong-revision WorkItem proof tampering", async () => {
      const current = await fixture("work-item-proof-tamper");
      await seedWorkItem(db, current, "0");
      const input = workItemCollaboratorMutationInput(
        current,
        "work-item-proof-tamper",
        { workItemCycle: "0", expectedWorkItemRevision: "1" }
      );
      const collaboratorId = collaborator(current, "proof-tamper");
      const applied = await createSqlInboxV2AuthorizationRepository(
        db
      ).withPrivilegedAuthorizationMutation(input, async (context) => {
        const persisted = await persistCollaborator(context, input, {
          collaboratorId,
          resourceKind: "work_item",
          conversationId: null,
          workItemId: current.workItemId,
          workItemCycle: "0"
        });
        await context.executor.execute(sql`
          update inbox_v2_work_items
          set collaborator_set_revision = collaborator_set_revision + 1,
              revision = revision + 1,
              updated_at = ${input.occurredAt}
          where tenant_id = ${current.tenantId}
            and id = ${current.workItemId}
            and reopen_cycle = 0
            and collaborator_set_revision = 1
            and revision = 1
        `);
        return persisted;
      });
      expect(applied.kind).toBe("applied");

      await expectSqlState(
        db.execute(sql`
          delete from inbox_v2_auth_revision_effects
          where tenant_id = ${current.tenantId}
            and mutation_id = ${input.records.mutationId}
            and effect_kind = 'collaborator_set'
        `),
        "23514"
      );
      await expectSqlState(
        db.execute(sql`
          insert into inbox_v2_auth_revision_effects (
            tenant_id, id, mutation_id, ordinal, effect_kind,
            before_revision, after_revision, employee_id, resource_head_id,
            work_item_id, work_item_cycle, expected_work_item_revision,
            resulting_work_item_revision, effect_hash, created_at
          )
          select tenant_id,
                 ${internalId("authorization-revision-effect", current, "duplicate")},
                 mutation_id, 3, effect_kind, before_revision, after_revision,
                 employee_id, resource_head_id, work_item_id, work_item_cycle,
                 expected_work_item_revision, resulting_work_item_revision,
                 ${digest(`${current.tenantId}:duplicate-effect`)}, created_at
          from inbox_v2_auth_revision_effects
          where tenant_id = ${current.tenantId}
            and mutation_id = ${input.records.mutationId}
            and effect_kind = 'collaborator_set'
        `),
        "23505"
      );
      await expectSqlState(
        db.execute(sql`
          insert into inbox_v2_auth_revision_effects (
            tenant_id, id, mutation_id, ordinal, effect_kind,
            before_revision, after_revision, employee_id, resource_head_id,
            work_item_id, work_item_cycle, expected_work_item_revision,
            resulting_work_item_revision, effect_hash, created_at
          ) values (
            ${current.tenantId},
            ${internalId("authorization-revision-effect", current, "wrong-cycle")},
            ${input.records.mutationId}, 3, 'collaborator_set', 2, 3,
            null, null, ${current.workItemId}, 1, 2, 3,
            ${digest(`${current.tenantId}:wrong-cycle-effect`)},
            ${input.occurredAt}
          )
        `),
        "23514"
      );
      await expectSqlState(
        db.execute(sql`
          insert into inbox_v2_auth_revision_effects (
            tenant_id, id, mutation_id, ordinal, effect_kind,
            before_revision, after_revision, employee_id, resource_head_id,
            work_item_id, work_item_cycle, expected_work_item_revision,
            resulting_work_item_revision, effect_hash, created_at
          ) values (
            ${current.tenantId},
            ${internalId("authorization-revision-effect", current, "wrong-revision")},
            ${input.records.mutationId}, 3, 'collaborator_set', 2, 3,
            null, null, ${current.workItemId}, 0, 2, 4,
            ${digest(`${current.tenantId}:wrong-revision-effect`)},
            ${input.occurredAt}
          )
        `),
        "23514"
      );

      expect(
        await scalarCount(
          db,
          sql`select count(*)::integer as count
              from inbox_v2_auth_revision_effects
              where tenant_id = ${current.tenantId}
                and mutation_id = ${input.records.mutationId}`
        )
      ).toBe(2);
    }, 30_000);

    it("locks a >MAX_SAFE WorkItem cycle without JavaScript precision loss and rolls it back", async () => {
      const current = await fixture("work-item-bigint-boundary");
      await seedWorkItem(db, current, BIG_WORK_ITEM_CYCLE);
      const input = workItemCollaboratorMutationInput(
        current,
        "work-item-bigint-boundary"
      );
      let callbackCount = 0;

      await expect(
        createSqlInboxV2AuthorizationRepository(
          db
        ).withPrivilegedAuthorizationMutation(input, async (context) => {
          callbackCount += 1;
          const locked = await context.executor.execute<{
            reopen_cycle: string;
          }>(sql`
            select reopen_cycle::text
            from inbox_v2_work_items
            where tenant_id = ${current.tenantId}
              and id = ${current.workItemId}
              and reopen_cycle = ${BIG_WORK_ITEM_CYCLE}::bigint
            for update
          `);
          expect(locked.rows).toEqual([{ reopen_cycle: BIG_WORK_ITEM_CYCLE }]);
          throw new Error("intentional bigint boundary rollback");
        })
      ).rejects.toThrow("intentional bigint boundary rollback");
      expect(callbackCount).toBe(1);
      expect(await artifactCounts(db, current.tenantId)).toEqual(
        zeroArtifactCounts()
      );
    }, 30_000);
  }
);

type MutationOptions = Readonly<{
  occurredAt?: string;
  authorizedAt?: string;
  notAfter?: string;
  sensitiveResultReference?: string | null;
  expectedTenantRbacRevision?: string;
  expectedEmployeeAccessRevision?: string;
}>;

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}>;

function roleMutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions = {}
): WithPrivilegedAuthorizationMutationInput {
  const expectedTenantRbacRevision = options.expectedTenantRbacRevision ?? "1";
  return mutationInput(fixture, label, {
    ...options,
    relationKind: "role",
    permissionId: "core:roles.define",
    resourceEntityTypeId: "core:role",
    resourceEntityId: roleId(fixture, label),
    revisions: {
      expectedTenantRbacRevision,
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: true,
      advanceSharedAccess: false,
      employees: [
        actorFence(fixture, {
          expectedEmployeeAccessRevision:
            options.expectedEmployeeAccessRevision ?? "1"
        })
      ],
      resources: []
    },
    audienceImpact: tenantRbacAudience(
      fixture,
      label,
      expectedTenantRbacRevision
    )
  });
}

function roleBindingMutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions & Readonly<{ bindingId: string }>
): WithPrivilegedAuthorizationMutationInput {
  const expectedTenantRbacRevision = options.expectedTenantRbacRevision ?? "1";
  return mutationInput(fixture, label, {
    ...options,
    relationKind: "role_binding",
    permissionId: "core:roles.bind",
    resourceEntityTypeId: "core:role-binding",
    resourceEntityId: options.bindingId,
    revisions: {
      expectedTenantRbacRevision,
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: true,
      advanceSharedAccess: false,
      employees: [actorFence(fixture)],
      resources: []
    },
    audienceImpact: tenantRbacAudience(
      fixture,
      label,
      expectedTenantRbacRevision
    )
  });
}

function directGrantMutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions &
    Readonly<{
      grantId: string;
      expectedEmployeeAccessRevision: string;
    }>
): WithPrivilegedAuthorizationMutationInput {
  return mutationInput(fixture, label, {
    ...options,
    relationKind: "direct_grant",
    permissionId: "core:role-bindings.manage",
    resourceEntityTypeId: "core:employee",
    resourceEntityId: fixture.actorId,
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [
        actorFence(fixture, {
          expectedEmployeeAccessRevision:
            options.expectedEmployeeAccessRevision,
          advanceEmployeeAccess: true
        })
      ],
      resources: []
    },
    audienceImpact: directAudience(
      fixture,
      label,
      [fixture.actorId],
      options.authorizedAt ?? options.occurredAt
    )
  });
}

function workforceMembershipMutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions &
    Readonly<{ expectedEmployeeAccessRevision: string }>
): WithPrivilegedAuthorizationMutationInput {
  return mutationInput(fixture, label, {
    ...options,
    relationKind: "workforce_membership",
    permissionId: "core:role-bindings.manage",
    resourceEntityTypeId: "core:employee",
    resourceEntityId: fixture.actorId,
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [
        actorFence(fixture, {
          expectedEmployeeAccessRevision:
            options.expectedEmployeeAccessRevision,
          advanceEmployeeAccess: true
        })
      ],
      resources: []
    },
    audienceImpact: directAudience(
      fixture,
      label,
      [fixture.actorId],
      options.authorizedAt ?? options.occurredAt
    )
  });
}

function structuralMutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions &
    Readonly<{
      conversationId?: string;
      resourceHeadId?: string;
      expectedSharedAccessRevision?: string;
      expectedResourceAccessRevision?: string;
      expectedStructuralRelationRevision?: string;
    }> = {}
): WithPrivilegedAuthorizationMutationInput {
  const conversationId = options.conversationId ?? fixture.conversationA;
  return mutationInput(fixture, label, {
    ...options,
    relationKind: "structural_access",
    permissionId: "core:conversation.access_binding.manage",
    resourceEntityTypeId: "core:conversation",
    resourceEntityId: conversationId,
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: options.expectedSharedAccessRevision ?? "1",
      advanceTenantRbac: false,
      advanceSharedAccess: true,
      employees: [actorFence(fixture)],
      resources: [
        resourceExpectation({
          resourceKind: "conversation",
          resourceId: conversationId,
          resourceHeadId: options.resourceHeadId ?? fixture.resourceHeadA,
          expectedWorkItemRevision: undefined,
          expectedResourceAccessRevision:
            options.expectedResourceAccessRevision ?? "1",
          expectedStructuralRelationRevision:
            options.expectedStructuralRelationRevision ?? "1",
          advanceStructuralRelation: "repository",
          expectedCollaboratorSetRevision: undefined,
          advanceCollaboratorSet: undefined,
          advance: "repository"
        })
      ]
    },
    audienceImpact: structuralAudience(
      fixture,
      label,
      options.expectedSharedAccessRevision ?? "1"
    )
  });
}

function conversationCollaboratorMutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions &
    Readonly<{
      expectedEmployeeInboxRelationRevision?: string;
      expectedCollaboratorSetRevision?: string;
    }> = {}
): WithPrivilegedAuthorizationMutationInput {
  return mutationInput(fixture, label, {
    ...options,
    relationKind: "conversation_collaborator",
    permissionId: "core:conversation.collaborator.manage",
    resourceEntityTypeId: "core:conversation",
    resourceEntityId: fixture.conversationA,
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [
        actorFence(fixture, {
          expectedEmployeeInboxRelationRevision:
            options.expectedEmployeeInboxRelationRevision ?? "1",
          advanceEmployeeInboxRelation: true
        })
      ],
      resources: [
        resourceExpectation({
          resourceKind: "conversation",
          resourceId: fixture.conversationA,
          resourceHeadId: fixture.resourceHeadA,
          expectedWorkItemRevision: undefined,
          expectedResourceAccessRevision: "1",
          expectedStructuralRelationRevision: undefined,
          advanceStructuralRelation: undefined,
          expectedCollaboratorSetRevision:
            options.expectedCollaboratorSetRevision ?? "1",
          advanceCollaboratorSet: "repository",
          advance: "none"
        })
      ]
    },
    audienceImpact: directAudience(
      fixture,
      label,
      [fixture.actorId],
      options.authorizedAt ?? options.occurredAt
    )
  });
}

function workItemCollaboratorMutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions &
    Readonly<{
      workItemCycle?: string;
      expectedWorkItemRevision?: string;
    }> = {}
): WithPrivilegedAuthorizationMutationInput {
  return mutationInput(fixture, label, {
    ...options,
    relationKind: "work_item_collaborator",
    permissionId: "core:work.collaborator.manage",
    resourceEntityTypeId: "core:work-item",
    resourceEntityId: fixture.workItemId,
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [actorFence(fixture, { advanceEmployeeInboxRelation: true })],
      resources: [
        resourceExpectation({
          resourceKind: "work_item",
          resourceId: fixture.workItemId,
          workItemCycle: options.workItemCycle ?? BIG_WORK_ITEM_CYCLE,
          expectedWorkItemRevision: options.expectedWorkItemRevision ?? "1",
          expectedResourceAccessRevision: "1",
          expectedStructuralRelationRevision: undefined,
          advanceStructuralRelation: undefined,
          expectedCollaboratorSetRevision: "1",
          advanceCollaboratorSet: "callback",
          advance: "none"
        })
      ]
    },
    audienceImpact: directAudience(
      fixture,
      label,
      [fixture.actorId],
      options.authorizedAt ?? options.occurredAt
    )
  });
}

function servicingTeamMutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions = {}
): WithPrivilegedAuthorizationMutationInput {
  return mutationInput(fixture, label, {
    ...options,
    relationKind: "servicing_team",
    permissionId: "core:work.servicing_team.manage",
    resourceEntityTypeId: "core:work-item",
    resourceEntityId: fixture.workItemId,
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: true,
      employees: [actorFence(fixture)],
      resources: [
        resourceExpectation({
          resourceKind: "work_item",
          resourceId: fixture.workItemId,
          workItemCycle: "0",
          expectedWorkItemRevision: "1",
          expectedResourceAccessRevision: "1",
          expectedStructuralRelationRevision: undefined,
          advanceStructuralRelation: undefined,
          expectedCollaboratorSetRevision: undefined,
          advanceCollaboratorSet: undefined,
          advance: "callback"
        })
      ]
    },
    audienceImpact: structuralAudience(fixture, label, "1")
  });
}

function internalMembershipMutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions &
    Readonly<{
      conversationId: string;
      employeeId: string;
      resourceHeadId: string;
    }>
): WithPrivilegedAuthorizationMutationInput {
  return mutationInput(fixture, label, {
    ...options,
    relationKind: "internal_membership",
    permissionId: "core:conversation.internal.members.manage",
    resourceEntityTypeId: "core:conversation",
    resourceEntityId: options.conversationId,
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [actorFence(fixture, { advanceEmployeeInboxRelation: true })],
      resources: [
        resourceExpectation({
          resourceKind: "conversation",
          resourceId: options.conversationId,
          resourceHeadId: options.resourceHeadId,
          workItemCycle: undefined,
          expectedWorkItemRevision: undefined,
          expectedResourceAccessRevision: "1",
          expectedStructuralRelationRevision: undefined,
          advanceStructuralRelation: undefined,
          expectedCollaboratorSetRevision: undefined,
          advanceCollaboratorSet: undefined,
          advance: "none"
        })
      ]
    },
    audienceImpact: directAudience(
      fixture,
      label,
      [options.employeeId],
      options.authorizedAt ?? options.occurredAt
    )
  });
}

function mutationInput(
  fixture: IntegrationFixture,
  label: string,
  options: MutationOptions &
    Readonly<{
      relationKind:
        | "role"
        | "role_binding"
        | "direct_grant"
        | "workforce_membership"
        | "structural_access"
        | "conversation_collaborator"
        | "work_item_collaborator"
        | "servicing_team"
        | "internal_membership";
      permissionId: string;
      resourceEntityTypeId: string;
      resourceEntityId: string;
      revisions: InboxV2AuthorizationRevisionPlan;
      audienceImpact: unknown;
    }>
): WithPrivilegedAuthorizationMutationInput {
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const authorizedAt = options.authorizedAt ?? occurredAt;
  const notAfter =
    options.notAfter ??
    new Date(Date.parse(authorizedAt) + 60 * 60 * 1_000).toISOString();
  const expiresAt = new Date(Date.parse(occurredAt) + 86_400_000).toISOString();
  const decision = authorizationDecision(fixture, label, {
    permissionId: options.permissionId,
    resourceEntityTypeId: options.resourceEntityTypeId,
    resourceEntityId: options.resourceEntityId,
    resourceAccessRevision:
      options.revisions.resources[0]?.expectedResourceAccessRevision ?? "1",
    authorizedAt,
    notAfter
  });
  const changeId = internalId("change", fixture, label);
  const eventId = internalId("event", fixture, label);
  const mutationId = internalId("authorization-mutation", fixture, label);
  const streamCommitId = internalId("commit", fixture, label);
  const correlationId = internalId("correlation", fixture, label);
  const commandId = internalId("command", fixture, label);
  const clientMutationId = internalId("mutation", fixture, label);
  const payload = payloadReference(fixture, label, "state");
  const change = {
    id: changeId,
    ordinal: 1,
    entity: {
      tenantId: fixture.tenantId,
      entityTypeId: options.resourceEntityTypeId,
      entityId: options.resourceEntityId
    },
    resultingRevision: "2",
    timeline: null,
    audience: "workforce_metadata" as const,
    state: {
      kind: "upsert" as const,
      stateSchemaId: "core:inbox-v2.authorization-head",
      stateSchemaVersion: "v1",
      stateHash: digest(`${fixture.tenantId}:${label}:state`),
      payloadReference: payload,
      domainCommitReference: payloadReference(fixture, label, "domain-commit")
    }
  };
  const event = {
    id: eventId,
    typeId: "core:authorization.changed" as const,
    payloadSchemaId: "core:inbox-v2.authorization-change",
    payloadSchemaVersion: "v1",
    ordinal: "1",
    changeIds: [changeId],
    subjects: [
      {
        tenantId: fixture.tenantId,
        entityTypeId: options.resourceEntityTypeId,
        entityId: options.resourceEntityId
      }
    ],
    payloadReference: null,
    correlationId,
    commandIds: [commandId],
    clientMutationIds: [clientMutationId],
    authorizationDecisionRefs: [decision],
    accessEffect: {
      kind: "may_change_access" as const,
      causes: ["rbac_or_direct_grant" as const]
    },
    occurredAt,
    recordedAt: occurredAt,
    eventHash: digest(`${fixture.tenantId}:${label}:event`)
  };
  const outbox = {
    id: internalId("outbox-intent", fixture, label),
    ordinal: 1,
    typeId: "core:projection.update" as const,
    handlerId: "core:authorization-projection",
    effectClass: "projection" as const,
    eventId,
    changeIds: [changeId],
    payloadReference: null,
    consumerDedupeKey: digest(`${fixture.tenantId}:${label}:dedupe`),
    correlationId,
    availableAt: occurredAt,
    intentHash: digest(`${fixture.tenantId}:${label}:intent`)
  };
  const provisional = {
    tenantId: fixture.tenantId,
    command: {
      id: commandId,
      requestId: internalId("request", fixture, label),
      clientMutationId,
      commandTypeId: `core:authorization.${options.relationKind}`,
      requestHash: digest(`${fixture.tenantId}:${label}:request`),
      actor: { kind: "employee" as const, employeeId: fixture.actorId },
      authorizationDecisionId: decision.id,
      authorizationEpoch: decision.authorizationEpoch,
      authorizedAt,
      publicResultCode: "core:authorization.applied",
      sensitiveResultReference: options.sensitiveResultReference ?? null
    },
    revisions: options.revisions,
    records: {
      mutationId,
      relationKind: options.relationKind,
      streamCommitId,
      expectedStreamEpoch: streamEpoch(fixture, "primary"),
      audienceImpact: options.audienceImpact,
      commitHash: digest(`${fixture.tenantId}:${label}:commit`),
      correlationId,
      changes: [change],
      events: [event],
      outboxIntents: [outbox],
      audit: {
        id: internalId("authorization-audit", fixture, label),
        actionId: `core:authorization.${options.relationKind}`,
        target: {
          tenantId: fixture.tenantId,
          entityTypeId: options.resourceEntityTypeId,
          entityId: internalRef(`${fixture.tenantId}:${label}:audit-target`)
        },
        reasonCodeId: "core:authorization-relation-changed",
        matchedPermissionIds: [options.permissionId],
        grantSourceIds: [
          internalRef(`${fixture.tenantId}:${label}:grant-source`)
        ],
        authorizationScopeIds: ["core:permission-scope.tenant"],
        overrideReasonCodeId: null,
        policyVersion: "v1",
        evidenceReference: payloadReference(fixture, label, "evidence"),
        authorizationDecisionRefs: [decision],
        correlationId,
        outcome: "succeeded" as const,
        revisionDeltaHash: hashA,
        previousAuditHash: null,
        auditHash: digest(`${fixture.tenantId}:${label}:audit`),
        occurredAt,
        recordedAt: occurredAt,
        expiresAt,
        facets: [
          {
            ordinal: 1,
            dimension: "tenant" as const,
            reference: {
              tenantId: fixture.tenantId,
              entityTypeId: "core:tenant",
              entityId: internalRef(`${fixture.tenantId}:${label}:audit-facet`)
            },
            relation: "affected" as const,
            facetHash: digest(`${fixture.tenantId}:${label}:facet`)
          }
        ]
      }
    },
    occurredAt
  } as unknown as WithPrivilegedAuthorizationMutationInput;
  return {
    ...provisional,
    records: {
      ...provisional.records,
      audit: {
        ...provisional.records.audit,
        revisionDeltaHash: revisionEffectDigest(provisional)
      }
    }
  } as never;
}

function actorFence(
  fixture: IntegrationFixture,
  options: Readonly<{
    expectedEmployeeAccessRevision?: string;
    expectedEmployeeInboxRelationRevision?: string;
    advanceEmployeeAccess?: boolean;
    advanceEmployeeInboxRelation?: boolean;
  }> = {}
) {
  return {
    employeeId: fixture.actorId,
    expectedEmployeeAccessRevision:
      options.expectedEmployeeAccessRevision ?? "1",
    expectedEmployeeInboxRelationRevision:
      options.expectedEmployeeInboxRelationRevision ?? "1",
    advanceEmployeeAccess: options.advanceEmployeeAccess ?? false,
    advanceEmployeeInboxRelation: options.advanceEmployeeInboxRelation ?? false
  };
}

function resourceExpectation(input: Readonly<Record<string, unknown>>) {
  return {
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    resourceHeadId: input.resourceHeadId,
    workItemCycle: input.workItemCycle,
    expectedWorkItemRevision: input.expectedWorkItemRevision,
    expectedResourceAccessRevision: input.expectedResourceAccessRevision,
    expectedStructuralRelationRevision:
      input.expectedStructuralRelationRevision,
    advanceStructuralRelation: input.advanceStructuralRelation,
    expectedCollaboratorSetRevision: input.expectedCollaboratorSetRevision,
    advanceCollaboratorSet: input.advanceCollaboratorSet,
    advance: input.advance
  } as never;
}

function authorizationDecision(
  fixture: IntegrationFixture,
  label: string,
  options: Readonly<{
    permissionId: string;
    resourceEntityTypeId: string;
    resourceEntityId: string;
    resourceAccessRevision: string;
    authorizedAt: string;
    notAfter: string;
  }>
) {
  return {
    tenantId: fixture.tenantId,
    id: internalId("authorization-decision", fixture, label),
    authorizationEpoch: internalId("authorization", fixture, label),
    principal: {
      kind: "employee" as const,
      employee: {
        tenantId: fixture.tenantId,
        kind: "employee" as const,
        id: fixture.actorId
      }
    },
    permissionId: options.permissionId,
    resourceScopeId: "core:permission-scope.tenant",
    resource: {
      tenantId: fixture.tenantId,
      entityTypeId: options.resourceEntityTypeId,
      entityId: options.resourceEntityId
    },
    resourceAccessRevision: options.resourceAccessRevision,
    decisionRevision: "1",
    decisionHash: digest(`${fixture.tenantId}:${label}:decision`),
    outcome: "allowed" as const,
    decidedAt: options.authorizedAt,
    notAfter: options.notAfter
  };
}

function tenantRbacAudience(
  fixture: IntegrationFixture,
  label: string,
  previousRevision: string
) {
  return {
    kind: "tenant_rbac" as const,
    impactId: internalId("audience-impact", fixture, `${label}-tenant`),
    deliveryFence: "invalidate_before_payload" as const,
    previousTenantRbacRevision: previousRevision,
    resultingTenantRbacRevision: plusOne(previousRevision),
    invalidations: [
      { kind: "projection" as const, projectionId: "core:authorization" }
    ],
    indexedFanoutPlanId: internalId(
      "audience-impact",
      fixture,
      `${label}-tenant-plan`
    )
  };
}

function structuralAudience(
  fixture: IntegrationFixture,
  label: string,
  previousRevision: string
) {
  return {
    kind: "structural" as const,
    impactId: internalId("audience-impact", fixture, `${label}-structural`),
    deliveryFence: "invalidate_before_payload" as const,
    previousSharedAccessRevision: previousRevision,
    resultingSharedAccessRevision: plusOne(previousRevision),
    invalidations: [
      { kind: "projection" as const, projectionId: "core:authorization" }
    ],
    indexedFanoutPlanId: internalId(
      "audience-impact",
      fixture,
      `${label}-structural-plan`
    )
  };
}

function directAudience(
  fixture: IntegrationFixture,
  label: string,
  employeeIds: readonly string[],
  authorizedAtOverride?: string
) {
  const authorizedAt = authorizedAtOverride ?? new Date().toISOString();
  const notAfter = new Date(
    Date.parse(authorizedAt) + 60 * 60 * 1_000
  ).toISOString();
  return {
    kind: "direct" as const,
    impactId: internalId("audience-impact", fixture, `${label}-direct`),
    deliveryFence: "invalidate_before_payload" as const,
    affectedRecipients: employeeIds.map((employeeId) => ({
      employee: {
        tenantId: fixture.tenantId,
        kind: "employee" as const,
        id: employeeId
      },
      relation: "resulting" as const,
      previousAuthorizationEpoch: internalId(
        "authorization",
        fixture,
        `${label}-previous`
      ),
      resultingAuthorizationEpoch: internalId("authorization", fixture, label),
      invalidations: [{ kind: "recipient_scope" as const }],
      authorizationDecisionRefs: [
        authorizationDecision(fixture, label, {
          permissionId: "core:roles.define",
          resourceEntityTypeId: "core:employee",
          resourceEntityId: employeeId,
          resourceAccessRevision: "1",
          authorizedAt,
          notAfter
        })
      ]
    }))
  };
}

function payloadReference(
  fixture: IntegrationFixture,
  label: string,
  suffix: string
) {
  return {
    tenantId: fixture.tenantId,
    recordId: internalId("authorization-record", fixture, `${label}-${suffix}`),
    schemaId: "core:inbox-v2.authorization-head",
    schemaVersion: "v1",
    digest: digest(`${fixture.tenantId}:${label}:${suffix}:payload`)
  };
}

function revisionEffectDigest(
  input: WithPrivilegedAuthorizationMutationInput
): string {
  const effects: Array<
    Readonly<{
      id: string;
      kind: string;
      employeeId: string | null;
      resourceKind: string | null;
      resourceId: string | null;
      resourceHeadId: string | null;
      workItemCycle: string | null;
      expectedWorkItemRevision: string | null;
      resultingWorkItemRevision: string | null;
      previousRevision: string;
      resultingRevision: string;
    }>
  > = [];
  const pushEffect = (
    kind: string,
    previousRevision: string,
    suffix: string,
    target: Readonly<{
      employeeId?: string;
      resourceKind?: string;
      resourceId?: string;
      resourceHeadId?: string;
      workItemCycle?: string;
      expectedWorkItemRevision?: string;
      resultingWorkItemRevision?: string;
    }> = {}
  ) => {
    effects.push({
      id: `${input.records.mutationId}:revision:${suffix}`,
      previousRevision,
      resultingRevision: plusOne(previousRevision),
      kind,
      employeeId: target.employeeId ?? null,
      resourceKind: target.resourceKind ?? null,
      resourceId: target.resourceId ?? null,
      resourceHeadId: target.resourceHeadId ?? null,
      workItemCycle: target.workItemCycle ?? null,
      expectedWorkItemRevision: target.expectedWorkItemRevision ?? null,
      resultingWorkItemRevision: target.resultingWorkItemRevision ?? null
    });
  };
  if (input.revisions.advanceTenantRbac) {
    pushEffect(
      "tenant_rbac",
      input.revisions.expectedTenantRbacRevision,
      "tenant-rbac"
    );
  }
  if (input.revisions.advanceSharedAccess) {
    pushEffect(
      "shared_access",
      input.revisions.expectedSharedAccessRevision,
      "shared-access"
    );
  }
  for (const employee of input.revisions.employees) {
    if (employee.advanceEmployeeAccess) {
      pushEffect(
        "employee_access",
        employee.expectedEmployeeAccessRevision,
        `employee-access:${employee.employeeId}`,
        { employeeId: employee.employeeId }
      );
    }
    if (employee.advanceEmployeeInboxRelation) {
      pushEffect(
        "employee_inbox_relation",
        employee.expectedEmployeeInboxRelationRevision,
        `employee-inbox-relation:${employee.employeeId}`,
        { employeeId: employee.employeeId }
      );
    }
  }
  for (const resource of input.revisions.resources) {
    if (resource.advance !== "none") {
      pushEffect(
        "resource_access",
        resource.expectedResourceAccessRevision,
        `resource-access:${resource.resourceKind}:${resource.resourceId}`,
        {
          resourceKind: resource.resourceKind,
          resourceId: resource.resourceId,
          resourceHeadId:
            resource.resourceKind === "work_item"
              ? undefined
              : resource.resourceHeadId
        }
      );
    }
    if (
      resource.advanceCollaboratorSet !== undefined &&
      resource.advanceCollaboratorSet !== "none"
    ) {
      const workItem = resource.resourceKind === "work_item";
      pushEffect(
        "collaborator_set",
        resource.expectedCollaboratorSetRevision ?? "0",
        `collaborator-set:${resource.resourceKind}:${resource.resourceId}`,
        {
          resourceKind: resource.resourceKind,
          resourceId: resource.resourceId,
          resourceHeadId: workItem ? undefined : resource.resourceHeadId,
          workItemCycle: workItem ? resource.workItemCycle : undefined,
          expectedWorkItemRevision: workItem
            ? resource.expectedWorkItemRevision
            : undefined,
          resultingWorkItemRevision: workItem
            ? plusOne(resource.expectedWorkItemRevision ?? "0")
            : undefined
        }
      );
    }
  }
  return computeInboxV2LeafHashDigest(
    effects.map((effect, index) => {
      const base = {
        id: effect.id,
        ordinal: index + 1,
        effect_kind: effect.kind,
        before_revision: effect.previousRevision,
        after_revision: effect.resultingRevision,
        employee_id: effect.employeeId,
        resource_head_id:
          (effect.kind === "resource_access" ||
            effect.kind === "collaborator_set") &&
          effect.resourceKind !== "work_item"
            ? effect.resourceHeadId
            : null,
        work_item_id:
          (effect.kind === "resource_access" ||
            effect.kind === "collaborator_set") &&
          effect.resourceKind === "work_item"
            ? effect.resourceId
            : null,
        work_item_cycle:
          effect.kind === "collaborator_set" ? effect.workItemCycle : null,
        expected_work_item_revision:
          effect.kind === "collaborator_set"
            ? effect.expectedWorkItemRevision
            : null,
        resulting_work_item_revision:
          effect.kind === "collaborator_set"
            ? effect.resultingWorkItemRevision
            : null
      };
      return sha256Canonical({
        tenantId: input.tenantId,
        mutationId: input.records.mutationId,
        ...base
      });
    })
  );
}

function sha256Canonical(value: unknown): string {
  return digest(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate !== null && typeof candidate === "object") {
      const record = candidate as Readonly<Record<string, unknown>>;
      return Object.fromEntries(
        Object.keys(record)
          .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
          .map((key) => [key, normalize(record[key])])
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function internalRef(value: string): string {
  return `internal-ref:${createHash("sha256")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, 40)}`;
}

function internalId(
  prefix: string,
  fixture: IntegrationFixture,
  label: string
): string {
  return `${prefix}:${createHash("sha256")
    .update(`${fixture.tenantId}\u001f${label}`, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function roleId(fixture: IntegrationFixture, label: string): string {
  return internalId("role", fixture, label);
}

function roleBindingId(fixture: IntegrationFixture, label: string): string {
  return internalId("role-binding", fixture, label);
}

function directGrantId(fixture: IntegrationFixture, label: string): string {
  return internalId("direct-grant", fixture, label);
}

function workforceMembershipId(
  fixture: IntegrationFixture,
  label: string
): string {
  return internalId("workforce-membership", fixture, label);
}

function structuralBindingId(
  fixture: IntegrationFixture,
  label: string
): string {
  return internalId("structural-binding", fixture, label);
}

function collaborator(fixture: IntegrationFixture, label: string): string {
  return internalId("collaborator", fixture, label);
}

function authorizationResourceHeadId(
  fixture: IntegrationFixture,
  label: string
): string {
  return internalId("authorization-resource", fixture, label);
}

function streamEpoch(fixture: IntegrationFixture, label: string): string {
  return internalId("stream-epoch", fixture, label);
}

function plusOne(value: string): string {
  return (BigInt(value) + 1n).toString();
}

async function createFixture(
  db: HuleeDatabase,
  suffix: string
): Promise<IntegrationFixture> {
  const token = createHash("sha256")
    .update(`${runId}\u001f${suffix}`, "utf8")
    .digest("hex")
    .slice(0, 20);
  const tenantId = inboxV2TenantIdSchema.parse(`tenant:rbac003-${token}`);
  const actorId = inboxV2EmployeeIdSchema.parse(`employee:rbac003-a-${token}`);
  const otherEmployeeId = inboxV2EmployeeIdSchema.parse(
    `employee:rbac003-b-${token}`
  );
  const fixture: IntegrationFixture = {
    suffix,
    tenantId,
    actorId,
    otherEmployeeId,
    orgUnitId: `org_unit:rbac003-${token}`,
    queueId: `work_queue:rbac003-${token}`,
    teamId: `team:rbac003-${token}`,
    conversationA: inboxV2ConversationIdSchema.parse(
      `conversation:rbac003-a-${token}`
    ),
    conversationB: inboxV2ConversationIdSchema.parse(
      `conversation:rbac003-b-${token}`
    ),
    resourceHeadA: `authorization-resource:rbac003-a-${token}`,
    resourceHeadB: `authorization-resource:rbac003-b-${token}`,
    workItemId: inboxV2WorkItemIdSchema.parse(`work_item:rbac003-${token}`)
  };
  const now = new Date().toISOString();
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${fixture.tenantId}, ${`rbac003-${token}`},
        ${`RBAC003 ${suffix}`}, 'saas_shared'
      )
    `);
    await transaction.execute(sql`
      insert into org_units (
        id, tenant_id, name, kind, status, created_at, updated_at
      ) values (
        ${fixture.orgUnitId}, ${fixture.tenantId}, 'RBAC003 org unit',
        'department', 'active', ${now}, ${now}
      )
    `);
    await transaction.execute(sql`
      insert into work_queues (
        id, tenant_id, name, kind, owning_org_unit_id, status,
        routing_config, created_at, updated_at
      ) values (
        ${fixture.queueId}, ${fixture.tenantId}, 'RBAC003 queue', 'support',
        ${fixture.orgUnitId}, 'active', '{}'::jsonb, ${now}, ${now}
      )
    `);
    await transaction.execute(sql`
      insert into teams (id, tenant_id, name, created_at, updated_at)
      values (
        ${fixture.teamId}, ${fixture.tenantId}, 'RBAC003 team', ${now}, ${now}
      )
    `);
    for (const [index, employeeId] of [
      fixture.actorId,
      fixture.otherEmployeeId
    ].entries()) {
      await transaction.execute(sql`
        insert into employees (
          id, tenant_id, email, display_name, profile, created_at, updated_at
        ) values (
          ${employeeId}, ${fixture.tenantId},
          ${`rbac003-${index}-${token}@example.test`},
          ${`RBAC003 Employee ${index + 1}`}, '{}'::jsonb, ${now}, ${now}
        )
      `);
    }
  });
  const conversations = createSqlInboxV2ConversationRepository(db);
  for (const [index, conversationId] of [
    fixture.conversationA,
    fixture.conversationB
  ].entries()) {
    const result = await conversations.create({
      tenantId: fixture.tenantId,
      conversationId,
      topology: "direct",
      transport: "external",
      purposeId: "core:chat",
      lifecycle: "active",
      streamPosition: String(index + 1),
      createdAt: now
    } as never);
    if (result.kind !== "created") {
      throw new Error(
        `RBAC003 fixture Conversation create returned ${result.kind}.`
      );
    }
  }
  return fixture;
}

async function deleteFixture(
  db: HuleeDatabase,
  fixture: IntegrationFixture
): Promise<void> {
  const tables = await db.execute<{ table_name: string }>(sql`
    select distinct columns.table_name
    from information_schema.columns columns
    join information_schema.tables tables
      on tables.table_schema = columns.table_schema
     and tables.table_name = columns.table_name
     and tables.table_type = 'BASE TABLE'
    where columns.table_schema = 'public'
      and columns.column_name = 'tenant_id'
    order by columns.table_name
  `);
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    for (const { table_name: tableName } of tables.rows) {
      if (!/^[a-z][a-z0-9_]*$/.test(tableName)) {
        throw new Error(`Unsafe integration cleanup table: ${tableName}`);
      }
      const tenantLiteral = fixture.tenantId.replaceAll("'", "''");
      await transaction.execute(
        sql.raw(
          `delete from public.${tableName} where tenant_id = '${tenantLiteral}'`
        )
      );
    }
    await transaction.execute(
      sql`delete from tenants where id = ${fixture.tenantId}`
    );
  });
}

async function persistRole(
  context: InboxV2PrivilegedAuthorizationMutationContext,
  input: WithPrivilegedAuthorizationMutationInput,
  role:
    | string
    | Readonly<{
        roleId: string;
        revision?: string;
        previousRevision?: string | null;
        permissionIds?: readonly string[];
      }>
) {
  const options: Readonly<{
    roleId: string;
    revision?: string;
    previousRevision?: string | null;
    permissionIds?: readonly string[];
  }> = typeof role === "string" ? { roleId: role } : role;
  const persistedRoleId = options.roleId;
  const revision = options.revision ?? "1";
  const previousRevision = options.previousRevision ?? null;
  const permissionIds = [
    ...new Set(options.permissionIds ?? ["core:roles.define"])
  ].sort();
  const permissionDigest = digest(
    permissionIds
      .map(
        (permissionId, index) =>
          `${index + 1}:${Buffer.byteLength(permissionId, "utf8")}:${permissionId}`
      )
      .join("\n")
  );
  await context.executor.execute(sql`
    insert into inbox_v2_auth_role_versions (
      tenant_id, role_id, revision, state, name, description,
      permission_count, permission_set_digest_sha256, catalog_digest_sha256,
      snapshot_hash, actor_kind, actor_employee_id,
      actor_trusted_service_id, reason_id, mutation_id, occurred_at, created_at
    ) values (
      ${input.tenantId}, ${persistedRoleId}, ${revision}::bigint, 'active',
      'RBAC003 role', null, ${permissionIds.length}, ${permissionDigest},
      ${digest("rbac003:permission-catalog")},
      ${digest(`${input.tenantId}:${persistedRoleId}:${revision}:snapshot`)},
      'employee', ${input.command.actor.kind === "employee" ? input.command.actor.employeeId : null},
      null, 'core:authorization-relation-changed', ${context.mutationId},
      ${input.occurredAt}, ${input.occurredAt}
    )
  `);
  for (const [index, permissionId] of permissionIds.entries()) {
    await context.executor.execute(sql`
      insert into inbox_v2_auth_role_version_permissions (
        tenant_id, role_id, role_revision, ordinal, permission_id,
        catalog_schema_id, catalog_version
      ) values (
        ${input.tenantId}, ${persistedRoleId}, ${revision}::bigint,
        ${index + 1}, ${permissionId},
        'core:inbox-v2.permission-scope-catalog', 'v1'
      )
    `);
  }
  if (previousRevision === null) {
    await context.executor.execute(sql`
      insert into inbox_v2_auth_role_heads (
        tenant_id, role_id, current_revision, created_at, updated_at
      ) values (
        ${input.tenantId}, ${persistedRoleId}, ${revision}::bigint,
        ${input.occurredAt}, ${input.occurredAt}
      )
    `);
  } else {
    await context.executor.execute(sql`
      update inbox_v2_auth_role_heads
      set current_revision = ${revision}::bigint,
          updated_at = ${input.occurredAt}
      where tenant_id = ${input.tenantId}
        and role_id = ${persistedRoleId}
        and current_revision = ${previousRevision}::bigint
    `);
  }
  return {
    result: { roleId: persistedRoleId },
    relationWrites: [
      relationWrite(input, persistedRoleId, previousRevision, revision)
    ]
  };
}

async function persistRoleBinding(
  context: InboxV2PrivilegedAuthorizationMutationContext,
  input: WithPrivilegedAuthorizationMutationInput,
  options: Readonly<{
    bindingId: string;
    roleId: string;
    roleRevisionObserved: string;
    scopeKind: "team" | "queue";
    scopeId: string;
    validFrom?: string;
  }>
) {
  const scopeTeamId = options.scopeKind === "team" ? options.scopeId : null;
  const scopeWorkQueueId =
    options.scopeKind === "queue" ? options.scopeId : null;
  const validFrom = options.validFrom ?? input.occurredAt;
  await context.executor.execute(sql`
    insert into inbox_v2_auth_role_binding_versions (
      tenant_id, binding_id, revision, role_id, role_revision_observed,
      subject_kind, subject_employee_id, subject_team_id,
      subject_org_unit_id, subject_work_queue_id, scope_kind,
      scope_org_unit_mode, scope_org_unit_id, scope_team_id,
      scope_work_queue_id, scope_client_id, scope_conversation_id,
      scope_work_item_id, scope_source_account_id, state, valid_from,
      valid_until, revoked_at, actor_kind, actor_employee_id,
      actor_trusted_service_id, reason_id, mutation_id, record_hash,
      occurred_at, created_at
    ) values (
      ${input.tenantId}, ${options.bindingId}, 1, ${options.roleId},
      ${options.roleRevisionObserved}::bigint, 'employee',
      ${input.command.actor.kind === "employee" ? input.command.actor.employeeId : null},
      null, null, null, ${options.scopeKind}, null, null, ${scopeTeamId},
      ${scopeWorkQueueId}, null, null, null, null, 'active', ${validFrom},
      null, null, 'employee',
      ${input.command.actor.kind === "employee" ? input.command.actor.employeeId : null},
      null, 'core:authorization-relation-changed', ${context.mutationId},
      ${digest(`${input.tenantId}:${options.bindingId}:1:active`)},
      ${input.occurredAt}, ${input.occurredAt}
    )
  `);
  await context.executor.execute(sql`
    insert into inbox_v2_auth_role_binding_heads (
      tenant_id, binding_id, current_revision, created_at, updated_at
    ) values (
      ${input.tenantId}, ${options.bindingId}, 1,
      ${input.occurredAt}, ${input.occurredAt}
    )
  `);
  return {
    result: { bindingId: options.bindingId },
    relationWrites: [relationWrite(input, options.bindingId, null, "1")]
  };
}

async function persistDirectGrant(
  context: InboxV2PrivilegedAuthorizationMutationContext,
  input: WithPrivilegedAuthorizationMutationInput,
  options: Readonly<{
    grantId: string;
    employeeId: string;
    actorEmployeeId?: string;
    revision: string;
    previousRevision: string | null;
    state: "active" | "revoked";
    validFrom: string;
  }>
) {
  const validUntil = null;
  const revokedAt = options.state === "revoked" ? input.occurredAt : null;
  await context.executor.execute(sql`
    insert into inbox_v2_auth_direct_grant_versions (
      tenant_id, grant_id, revision, employee_id, permission_id,
      catalog_schema_id, catalog_version, catalog_digest_sha256,
      scope_kind, scope_org_unit_mode, scope_org_unit_id, scope_team_id,
      scope_work_queue_id, scope_client_id, scope_conversation_id,
      scope_work_item_id, scope_source_account_id, state, valid_from,
      valid_until, revoked_at, actor_kind, actor_employee_id,
      actor_trusted_service_id, reason_id, mutation_id, record_hash,
      occurred_at, created_at
    ) values (
      ${input.tenantId}, ${options.grantId}, ${options.revision}::bigint,
      ${options.employeeId}, 'core:roles.define',
      'core:inbox-v2.permission-scope-catalog', 'v1',
      ${digest("rbac003:permission-catalog")}, 'tenant', null, null, null,
      null, null, null, null, null, ${options.state}, ${options.validFrom},
      ${validUntil}, ${revokedAt}, 'employee',
      ${options.actorEmployeeId ?? (input.command.actor.kind === "employee" ? input.command.actor.employeeId : null)},
      null, 'core:authorization-relation-changed', ${context.mutationId},
      ${digest(`${input.tenantId}:${options.grantId}:${options.revision}`)},
      ${input.occurredAt}, ${input.occurredAt}
    )
  `);
  if (options.previousRevision === null) {
    await context.executor.execute(sql`
      insert into inbox_v2_auth_direct_grant_heads (
        tenant_id, grant_id, current_revision, created_at, updated_at
      ) values (
        ${input.tenantId}, ${options.grantId}, ${options.revision}::bigint,
        ${input.occurredAt}, ${input.occurredAt}
      )
    `);
  } else {
    await context.executor.execute(sql`
      update inbox_v2_auth_direct_grant_heads
      set current_revision = ${options.revision}::bigint,
          updated_at = ${input.occurredAt}
      where tenant_id = ${input.tenantId}
        and grant_id = ${options.grantId}
        and current_revision = ${options.previousRevision}::bigint
    `);
  }
  return {
    result: { grantId: options.grantId },
    relationWrites: [
      relationWrite(
        input,
        options.grantId,
        options.previousRevision,
        options.revision
      )
    ]
  };
}

async function persistStructuralAccess(
  context: InboxV2PrivilegedAuthorizationMutationContext,
  input: WithPrivilegedAuthorizationMutationInput,
  options: Readonly<{
    bindingId: string;
    conversationId: string;
    resourceHeadId: string;
    targetOrgUnitId?: string;
    revision?: string;
    previousRevision?: string | null;
    state?: "active" | "revoked";
    validFrom?: string;
  }>
) {
  const revision = options.revision ?? "1";
  const previousRevision = options.previousRevision ?? null;
  const state = options.state ?? "active";
  const validFrom = options.validFrom ?? input.occurredAt;
  const revokedAt = state === "revoked" ? input.occurredAt : null;
  const targetOrgUnitId =
    options.targetOrgUnitId ??
    (
      await context.executor.execute<{ id: string }>(sql`
        select id
        from org_units
        where tenant_id = ${input.tenantId}
        order by id collate "C"
        limit 1
      `)
    ).rows[0]?.id;
  if (targetOrgUnitId === undefined) {
    throw new Error("RBAC003 structural fixture has no org unit.");
  }
  await context.executor.execute(sql`
    insert into inbox_v2_auth_structural_access_versions (
      tenant_id, binding_id, revision, resource_head_id, resource_kind,
      conversation_id, client_id, source_account_id, target_kind,
      target_org_unit_id, target_team_id, policy_id, policy_revision,
      state, valid_from, valid_until, revoked_at, actor_kind,
      actor_employee_id, actor_trusted_service_id, reason_id, mutation_id,
      record_hash, occurred_at, created_at
    ) values (
      ${input.tenantId}, ${options.bindingId}, ${revision}::bigint,
      ${options.resourceHeadId},
      'conversation', ${options.conversationId}, null, null, 'org_unit',
      ${targetOrgUnitId}, null, null, null, ${state}, ${validFrom},
      null, ${revokedAt}, 'employee',
      ${input.command.actor.kind === "employee" ? input.command.actor.employeeId : null},
      null, 'core:authorization-relation-changed', ${context.mutationId},
      ${digest(`${input.tenantId}:${options.bindingId}:${revision}:${state}`)},
      ${input.occurredAt}, ${input.occurredAt}
    )
  `);
  if (previousRevision === null) {
    await context.executor.execute(sql`
      insert into inbox_v2_auth_structural_access_heads (
        tenant_id, binding_id, resource_head_id, resource_kind,
        conversation_id, client_id, source_account_id, target_kind,
        target_org_unit_id, target_team_id, current_state, current_revision,
        created_at, updated_at
      ) values (
        ${input.tenantId}, ${options.bindingId}, ${options.resourceHeadId},
        'conversation', ${options.conversationId}, null, null, 'org_unit',
        ${targetOrgUnitId}, null, ${state}, ${revision}::bigint,
        ${input.occurredAt}, ${input.occurredAt}
      )
    `);
  } else {
    await context.executor.execute(sql`
      update inbox_v2_auth_structural_access_heads
      set current_state = ${state},
          current_revision = ${revision}::bigint,
          updated_at = ${input.occurredAt}
      where tenant_id = ${input.tenantId}
        and binding_id = ${options.bindingId}
        and current_revision = ${previousRevision}::bigint
    `);
  }
  return {
    result: { bindingId: options.bindingId },
    relationWrites: [
      relationWrite(input, options.bindingId, previousRevision, revision)
    ]
  };
}

async function persistWorkforceMembership(
  context: InboxV2PrivilegedAuthorizationMutationContext,
  input: WithPrivilegedAuthorizationMutationInput,
  options: Readonly<{
    membershipId: string;
    employeeId: string;
    teamId: string;
    revision?: string;
    previousRevision?: string | null;
    state?: "active" | "revoked";
    validFrom?: string;
  }>
) {
  const revision = options.revision ?? "1";
  const previousRevision = options.previousRevision ?? null;
  const state = options.state ?? "active";
  const validFrom = options.validFrom ?? input.occurredAt;
  const revokedAt = state === "revoked" ? input.occurredAt : null;
  await context.executor.execute(sql`
    insert into inbox_v2_auth_workforce_membership_versions (
      tenant_id, membership_id, revision, employee_id, membership_kind,
      org_unit_id, team_id, work_queue_id, state, valid_from, valid_until,
      revoked_at, actor_kind, actor_employee_id, actor_trusted_service_id,
      reason_id, mutation_id, record_hash, occurred_at, created_at
    ) values (
      ${input.tenantId}, ${options.membershipId}, ${revision}::bigint,
      ${options.employeeId}, 'team', null, ${options.teamId}, null, ${state},
      ${validFrom}, null, ${revokedAt}, 'employee',
      ${input.command.actor.kind === "employee" ? input.command.actor.employeeId : null},
      null, 'core:authorization-relation-changed', ${context.mutationId},
      ${digest(`${input.tenantId}:${options.membershipId}:${revision}:${state}`)},
      ${input.occurredAt}, ${input.occurredAt}
    )
  `);
  if (previousRevision === null) {
    await context.executor.execute(sql`
      insert into inbox_v2_auth_workforce_membership_heads (
        tenant_id, membership_id, employee_id, membership_kind,
        org_unit_id, team_id, work_queue_id, current_state,
        current_revision, created_at, updated_at
      ) values (
        ${input.tenantId}, ${options.membershipId}, ${options.employeeId},
        'team', null, ${options.teamId}, null, ${state},
        ${revision}::bigint, ${input.occurredAt}, ${input.occurredAt}
      )
    `);
  } else {
    await context.executor.execute(sql`
      update inbox_v2_auth_workforce_membership_heads
      set current_state = ${state},
          current_revision = ${revision}::bigint,
          updated_at = ${input.occurredAt}
      where tenant_id = ${input.tenantId}
        and membership_id = ${options.membershipId}
        and current_revision = ${previousRevision}::bigint
    `);
  }
  return {
    result: { membershipId: options.membershipId },
    relationWrites: [
      relationWrite(input, options.membershipId, previousRevision, revision)
    ]
  };
}

async function persistCollaborator(
  context: InboxV2PrivilegedAuthorizationMutationContext,
  input: WithPrivilegedAuthorizationMutationInput,
  options: Readonly<{
    collaboratorId: string;
    resourceKind: "conversation" | "work_item";
    conversationId: string | null;
    workItemId: string | null;
    workItemCycle: string | null;
    revision?: string;
    previousRevision?: string | null;
    state?: "active" | "revoked";
    validFrom?: string;
  }>
) {
  const revision = options.revision ?? "1";
  const previousRevision = options.previousRevision ?? null;
  const state = options.state ?? "active";
  const validFrom = options.validFrom ?? input.occurredAt;
  const revokedAt = state === "revoked" ? input.occurredAt : null;
  await context.executor.execute(sql`
    insert into inbox_v2_auth_collaborator_versions (
      tenant_id, collaborator_id, revision, resource_kind,
      conversation_id, work_item_id, work_item_cycle, employee_id,
      state, valid_from, valid_until, revoked_at, actor_kind,
      actor_employee_id, actor_trusted_service_id, reason_id, mutation_id,
      record_hash, occurred_at, created_at
    ) values (
      ${input.tenantId}, ${options.collaboratorId}, ${revision}::bigint,
      ${options.resourceKind}, ${options.conversationId}, ${options.workItemId},
      ${options.workItemCycle}::bigint, ${input.command.actor.kind === "employee" ? input.command.actor.employeeId : null},
      ${state}, ${validFrom}, null, ${revokedAt}, 'employee',
      ${input.command.actor.kind === "employee" ? input.command.actor.employeeId : null},
      null, 'core:authorization-relation-changed', ${context.mutationId},
      ${digest(`${input.tenantId}:${options.collaboratorId}:${revision}:${state}`)},
      ${input.occurredAt}, ${input.occurredAt}
    )
  `);
  if (previousRevision === null) {
    await context.executor.execute(sql`
      insert into inbox_v2_auth_collaborator_heads (
        tenant_id, collaborator_id, resource_kind, conversation_id,
        work_item_id, work_item_cycle, employee_id, current_state,
        current_revision, created_at, updated_at
      ) values (
        ${input.tenantId}, ${options.collaboratorId}, ${options.resourceKind},
        ${options.conversationId}, ${options.workItemId},
        ${options.workItemCycle}::bigint,
        ${input.command.actor.kind === "employee" ? input.command.actor.employeeId : null},
        ${state}, ${revision}::bigint,
        ${input.occurredAt}, ${input.occurredAt}
      )
    `);
  } else {
    await context.executor.execute(sql`
      update inbox_v2_auth_collaborator_heads
      set current_state = ${state},
          current_revision = ${revision}::bigint,
          updated_at = ${input.occurredAt}
      where tenant_id = ${input.tenantId}
        and collaborator_id = ${options.collaboratorId}
        and current_revision = ${previousRevision}::bigint
    `);
  }
  return {
    result: { collaboratorId: options.collaboratorId },
    relationWrites: [
      relationWrite(input, options.collaboratorId, previousRevision, revision)
    ]
  };
}

function relationWrite(
  input: WithPrivilegedAuthorizationMutationInput,
  relationId: string,
  previousRevision: string | null,
  resultingRevision: string
): InboxV2AuthorizationRelationRevisionEffect {
  return {
    id: `authorization-relation-write:${createHash("sha256")
      .update(
        `${input.records.mutationId}\u001f${relationId}\u001f${resultingRevision}`,
        "utf8"
      )
      .digest("hex")
      .slice(0, 32)}`,
    ordinal: 1,
    relationId,
    previousRevision,
    resultingRevision
  };
}

async function insertAuthorizationResourceHead(
  db: HuleeDatabase,
  fixture: IntegrationFixture,
  which: "a" | "b"
): Promise<void> {
  const conversationId =
    which === "a" ? fixture.conversationA : fixture.conversationB;
  const resourceHeadId =
    which === "a" ? fixture.resourceHeadA : fixture.resourceHeadB;
  const now = new Date().toISOString();
  await db.execute(sql`
    insert into inbox_v2_auth_resource_heads (
      tenant_id, id, resource_kind, conversation_id, client_id,
      source_account_id, resource_access_revision,
      structural_relation_revision, collaborator_set_revision, revision,
      created_at, updated_at
    ) values (
      ${fixture.tenantId}, ${resourceHeadId}, 'conversation',
      ${conversationId}, null, null, 1, 1, 1, 1, ${now}, ${now}
    )
    on conflict (tenant_id, id) do nothing
  `);
}

async function seedInternalEmployeeParticipant(
  db: HuleeDatabase,
  fixture: IntegrationFixture,
  label: string
) {
  const token = createHash("sha256")
    .update(
      `${fixture.tenantId}\u001f${label}\u001finternal-membership`,
      "utf8"
    )
    .digest("hex");
  const conversationId = inboxV2ConversationIdSchema.parse(
    `conversation:rbac003-internal-${token.slice(0, 32)}`
  );
  const participantId = inboxV2ConversationParticipantIdSchema.parse(
    `conversation_participant:rbac003-${token.slice(0, 32)}`
  );
  const episodeId = inboxV2ParticipantMembershipEpisodeIdSchema.parse(
    `participant_membership_episode:rbac003-${token.slice(0, 32)}`
  );
  const transitionId = inboxV2ParticipantMembershipTransitionIdSchema.parse(
    `participant_membership_transition:rbac003-${token.slice(0, 32)}`
  );
  const resourceHeadId = authorizationResourceHeadId(fixture, label);
  const createdAt = new Date().toISOString();
  const conversation = await createSqlInboxV2ConversationRepository(db).create({
    tenantId: inboxV2TenantIdSchema.parse(fixture.tenantId),
    conversationId,
    topology: "group",
    transport: "internal",
    purposeId: "core:chat",
    lifecycle: "active",
    streamPosition: "3",
    createdAt
  } as never);
  if (conversation.kind !== "created") {
    throw new Error(
      `RBAC003 internal Conversation fixture returned ${conversation.kind}.`
    );
  }
  await db.execute(sql`
    insert into inbox_v2_auth_resource_heads (
      tenant_id, id, resource_kind, conversation_id, client_id,
      source_account_id, resource_access_revision,
      structural_relation_revision, collaborator_set_revision, revision,
      created_at, updated_at
    ) values (
      ${fixture.tenantId}, ${resourceHeadId}, 'conversation',
      ${conversationId}, null, null, 1, 1, 1, 1, ${createdAt}, ${createdAt}
    )
  `);
  const participant = await createSqlInboxV2ParticipantMembershipRepository(
    db
  ).createParticipant({
    tenantId: inboxV2TenantIdSchema.parse(fixture.tenantId),
    id: participantId,
    conversationId,
    subject: {
      kind: "employee",
      employee: {
        tenantId: inboxV2TenantIdSchema.parse(fixture.tenantId),
        kind: "employee",
        id: inboxV2EmployeeIdSchema.parse(fixture.actorId)
      }
    },
    createdAt
  });
  if (participant.kind !== "created") {
    throw new Error(
      `RBAC003 internal participant fixture returned ${participant.kind}.`
    );
  }
  return {
    conversationId,
    participantId,
    episodeId,
    transitionId,
    resourceHeadId
  };
}

function internalMembershipStartInput(
  fixture: IntegrationFixture,
  membership: Awaited<ReturnType<typeof seedInternalEmployeeParticipant>>,
  occurredAt: string
): StartInboxV2ParticipantMembershipEpisodeInput {
  return {
    tenantId: inboxV2TenantIdSchema.parse(fixture.tenantId),
    conversationId: membership.conversationId,
    participantId: membership.participantId,
    episodeId: membership.episodeId,
    transitionId: membership.transitionId,
    origin: { kind: "hulee_internal_command" },
    initialState: "active",
    role: "member",
    evidenceClassification: "confirmed",
    cause: {
      kind: "hulee_internal_command",
      actorEmployee: {
        tenantId: inboxV2TenantIdSchema.parse(fixture.tenantId),
        kind: "employee",
        id: inboxV2EmployeeIdSchema.parse(fixture.actorId)
      }
    },
    reasonCodeId: inboxV2ParticipantMembershipReasonIdSchema.parse(
      "core:conversation-created"
    ),
    expectedMembershipRevision: inboxV2BigintCounterSchema.parse("0"),
    occurredAt
  };
}

async function seedWorkItem(
  db: HuleeDatabase,
  fixture: IntegrationFixture,
  reopenCycle: string
): Promise<void> {
  if (reopenCycle === "0") {
    await seedLegalWorkItem(db, fixture);
    return;
  }
  const now = new Date().toISOString();
  const lastReopenSnapshot = JSON.stringify({ fixture: "rbac003" });
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    await transaction.execute(sql`
      insert into inbox_v2_work_items (
        tenant_id, id, conversation_id, ordinal, state, queue_id,
        queue_revision, priority_id, sla_cycle, sla_snapshot_revision,
        current_primary_assignment_id, last_primary_assignment_id,
        current_servicing_team_episode_id, current_servicing_team_id,
        last_servicing_team_episode_id, servicing_team_relation_revision,
        collaborator_set_revision, resource_access_revision, reopen_cycle,
        last_reopen_snapshot, terminal_snapshot, created_actor_kind,
        created_actor_employee_id, created_actor_authorization_epoch,
        created_actor_trusted_service_id, creation_reason_id, revision,
        created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${fixture.workItemId}, ${fixture.conversationA},
        1, 'new', ${fixture.queueId}, 1, 'core:normal', 1, 1,
        null, null, null, null, null, 1, 1, 1, ${reopenCycle}::bigint,
        ${lastReopenSnapshot}::jsonb, null, 'trusted_service', null, null,
        'core:integration-fixture', 'core:integration-fixture', 1,
        ${now}, ${now}
      )
    `);
  });
}

async function seedLegalWorkItem(
  db: HuleeDatabase,
  fixture: IntegrationFixture
): Promise<void> {
  const occurredAt = new Date().toISOString();
  const conversation = {
    tenantId: fixture.tenantId,
    kind: "conversation" as const,
    id: fixture.conversationA
  };
  const workItem = {
    tenantId: fixture.tenantId,
    kind: "work_item" as const,
    id: fixture.workItemId
  };
  const queue = {
    tenantId: fixture.tenantId,
    kind: "work_queue" as const,
    id: fixture.queueId
  };
  const queueHead = { queue, queueRevision: "1" };
  const queueSnapshot = inboxV2WorkQueueSchema.parse({
    tenantId: fixture.tenantId,
    id: fixture.queueId,
    ownerOrgUnit: {
      tenantId: fixture.tenantId,
      kind: "org_unit",
      id: fixture.orgUnitId
    },
    lifecycle: "active",
    eligibilityPolicy: {
      policyId: "core:active-queue-member",
      policyVersion: "v1",
      policyRevision: "1"
    },
    externalReplyPolicy: {
      mode: "responsible_only",
      policyVersion: "v1",
      policyRevision: "1"
    },
    defaultPriorityId: "core:normal",
    defaultSlaPolicy: { kind: "not_applied" },
    resourceAccessRevision: "1",
    revision: "1",
    createdAt: occurredAt,
    updatedAt: occurredAt
  });
  const repository = createSqlInboxV2WorkItemRepository(db);
  const slotBefore = await repository.findSlotByConversation({
    tenantId: inboxV2TenantIdSchema.parse(fixture.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(fixture.conversationA)
  });
  if (slotBefore === null) {
    throw new Error("RBAC003 legal WorkItem fixture has no Conversation slot.");
  }
  const createdWorkItem = inboxV2WorkItemSchema.parse({
    tenantId: fixture.tenantId,
    id: fixture.workItemId,
    conversation,
    ordinal: "1",
    operationalState: {
      state: "new",
      activeQueue: queueHead,
      primaryAssignment: null,
      terminal: null
    },
    priorityId: "core:normal",
    sla: { kind: "not_applied", reasonId: "core:no-sla-policy" },
    currentServicingTeam: null,
    servicingTeamRelationRevision: "1",
    collaboratorSetRevision: "1",
    resourceAccessRevision: "1",
    reopenCycle: "0",
    lastReopen: null,
    createdBy: {
      kind: "trusted_service",
      trustedServiceId: "core:work-intake"
    },
    creationReasonId: "core:external-actionable-input",
    revision: "1",
    createdAt: occurredAt,
    updatedAt: occurredAt
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...slotBefore,
    latestOrdinal: "1",
    latestWorkItem: {
      workItem,
      ordinal: "1",
      lifecycleClass: "non_terminal",
      lifecycleFenceRevision: "1"
    },
    currentNonTerminalWorkItem: { workItem, ordinal: "1" },
    revision: "2",
    updatedAt: occurredAt
  });
  const commit = inboxV2WorkItemCreationCommitSchema.parse({
    tenantId: fixture.tenantId,
    intakeDecision: {
      tenantId: fixture.tenantId,
      conversation,
      transport: "external",
      policyId: "core:default-actionability",
      policyVersion: "v1",
      policyRevision: "1",
      decisionRevision: "1",
      decidedByTrustedServiceId: "core:work-intake",
      decidedAt: occurredAt,
      outcome: "create_work_item",
      queue,
      latestTerminalHandling: "no_latest_work_item",
      reasonId: "core:external-actionable-input"
    },
    queueSnapshot,
    slotBefore,
    previousLatestWorkItem: null,
    createdWorkItem,
    slotAfter,
    occurredAt
  });
  const result = await repository.createWorkItem(commit);
  if (result.kind !== "created") {
    throw new Error(
      `RBAC003 legal WorkItem create returned ${JSON.stringify(result)}.`
    );
  }
}

function servicingTeamAddCommit(
  fixture: IntegrationFixture,
  before: InboxV2WorkItem,
  input: WithPrivilegedAuthorizationMutationInput,
  options: Readonly<{ authorizationEpoch: string }>
) {
  const workItem = {
    tenantId: fixture.tenantId,
    kind: "work_item" as const,
    id: fixture.workItemId
  };
  const actor = {
    kind: "employee" as const,
    employee: {
      tenantId: fixture.tenantId,
      kind: "employee" as const,
      id: fixture.actorId
    },
    authorizationEpoch: options.authorizationEpoch
  };
  const episode = inboxV2WorkItemServicingTeamEpisodeSchema.parse({
    tenantId: fixture.tenantId,
    id: `work_item_servicing_team_episode:${createHash("sha256")
      .update(`${input.records.mutationId}\u001fepisode`, "utf8")
      .digest("hex")}`,
    workItem,
    workItemCycle: before.reopenCycle,
    team: {
      tenantId: fixture.tenantId,
      kind: "team",
      id: fixture.teamId
    },
    startedAt: input.occurredAt,
    startedBy: actor,
    startReasonId: "core:routed-to-team",
    state: "active",
    termination: null,
    revision: "1",
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt
  });
  const transition = {
    tenantId: fixture.tenantId,
    id: `work_item_relation_transition:${createHash("sha256")
      .update(`${input.records.mutationId}\u001ftransition`, "utf8")
      .digest("hex")}`,
    workItem,
    kind: "servicing_team_add" as const,
    actor,
    reasonId: "core:routed-to-team",
    expectedWorkItemRevision: before.revision,
    resultingWorkItemRevision: plusOne(before.revision),
    expectedRelationRevision: before.servicingTeamRelationRevision,
    resultingRelationRevision: plusOne(before.servicingTeamRelationRevision),
    occurredAt: input.occurredAt
  };
  const beforeHead = workItemRelationHead(before);
  return inboxV2WorkItemServicingTeamCommitSchema.parse({
    tenantId: fixture.tenantId,
    before: beforeHead,
    transition,
    after: {
      ...beforeHead,
      currentServicingTeam: {
        workItem,
        episode: {
          tenantId: fixture.tenantId,
          kind: "work_item_servicing_team_episode",
          id: episode.id
        },
        team: episode.team,
        workItemCycle: episode.workItemCycle,
        startedAt: episode.startedAt,
        episodeRevision: episode.revision
      },
      servicingTeamRelationRevision: transition.resultingRelationRevision,
      resourceAccessRevision: plusOne(before.resourceAccessRevision),
      workItemRevision: transition.resultingWorkItemRevision,
      updatedAt: input.occurredAt
    },
    closed: null,
    opened: episode
  });
}

function workItemRelationHead(workItem: InboxV2WorkItem) {
  return {
    tenantId: workItem.tenantId,
    workItem: {
      tenantId: workItem.tenantId,
      kind: "work_item" as const,
      id: workItem.id
    },
    state: workItem.operationalState.state,
    workItemCycle: workItem.reopenCycle,
    currentServicingTeam: workItem.currentServicingTeam,
    servicingTeamRelationRevision: workItem.servicingTeamRelationRevision,
    collaboratorSetRevision: workItem.collaboratorSetRevision,
    resourceAccessRevision: workItem.resourceAccessRevision,
    workItemRevision: workItem.revision,
    updatedAt: workItem.updatedAt
  };
}

function reuseWorkItemTransaction(
  executor: RawSqlExecutor
): InboxV2WorkItemTransactionExecutor {
  return {
    execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      return executor.execute<Row>(query);
    },
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>
    ): Promise<TResult> {
      return work(executor);
    }
  };
}

function reuseParticipantMembershipTransaction(
  executor: RawSqlExecutor
): InboxV2ParticipantMembershipTransactionExecutor {
  return {
    execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      return executor.execute<Row>(query);
    },
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>
    ): Promise<TResult> {
      return work(executor);
    }
  };
}

async function directGrantState(
  db: HuleeDatabase,
  tenantId: string,
  grantId: string
) {
  const head = await db.execute<{ current_revision: string }>(sql`
    select current_revision::text
    from inbox_v2_auth_direct_grant_heads
    where tenant_id = ${tenantId} and grant_id = ${grantId}
  `);
  const versions = await db.execute<{
    revision: string;
    employee_id: string;
    state: string;
  }>(sql`
    select revision::text, employee_id, state::text
    from inbox_v2_auth_direct_grant_versions
    where tenant_id = ${tenantId} and grant_id = ${grantId}
    order by revision
  `);
  return {
    currentRevision: head.rows[0]?.current_revision,
    versions: versions.rows.map((row) => ({
      revision: row.revision,
      employeeId: row.employee_id,
      state: row.state
    }))
  };
}

async function insertStandaloneDirectGrantRevision(
  db: HuleeDatabase,
  input: WithPrivilegedAuthorizationMutationInput,
  options: Readonly<{
    grantId: string;
    employeeId: string;
    revision: string;
    state: "active" | "revoked" | "archived";
    validFrom: string;
    validUntil?: string;
  }>
): Promise<unknown> {
  const occurredAt = new Date().toISOString();
  const validUntil =
    options.state === "active" ? null : (options.validUntil ?? occurredAt);
  const revokedAt = options.state === "revoked" ? occurredAt : null;
  return db.execute(sql`
    insert into inbox_v2_auth_direct_grant_versions (
      tenant_id, grant_id, revision, employee_id, permission_id,
      catalog_schema_id, catalog_version, catalog_digest_sha256,
      scope_kind, scope_org_unit_mode, scope_org_unit_id, scope_team_id,
      scope_work_queue_id, scope_client_id, scope_conversation_id,
      scope_work_item_id, scope_source_account_id, state, valid_from,
      valid_until, revoked_at, actor_kind, actor_employee_id,
      actor_trusted_service_id, reason_id, mutation_id, record_hash,
      occurred_at, created_at
    ) values (
      ${input.tenantId}, ${options.grantId}, ${options.revision}::bigint,
      ${options.employeeId}, 'core:roles.define',
      'core:inbox-v2.permission-scope-catalog', 'v1',
      ${digest("rbac003:permission-catalog")}, 'tenant', null, null, null,
      null, null, null, null, null, ${options.state}, ${options.validFrom},
      ${validUntil}, ${revokedAt}, 'employee',
      ${input.command.actor.kind === "employee" ? input.command.actor.employeeId : null},
      null, 'core:authorization-relation-changed',
      ${internalId(
        "authorization-mutation",
        {
          tenantId: input.tenantId
        } as IntegrationFixture,
        `standalone-${options.revision}-${options.state}`
      )},
      ${digest(`${input.tenantId}:${options.grantId}:${options.revision}:${options.state}`)},
      ${occurredAt}, ${occurredAt}
    )
  `);
}

async function expectSqlState(
  operation: Promise<unknown>,
  expectedState: string
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(findSqlState(error)).toBe(expectedState);
    return;
  }
  throw new Error(`Expected PostgreSQL SQLSTATE ${expectedState}.`);
}

async function expectDatabaseFailure(
  operation: Promise<unknown>,
  expectedState: string,
  expectedMessage: string
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(findSqlState(error)).toBe(expectedState);
    expect(databaseErrorMessages(error)).toContain(expectedMessage);
    return;
  }
  throw new Error(`Expected PostgreSQL ${expectedState}: ${expectedMessage}.`);
}

function findSqlState(error: unknown): string | null {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    const record = current as Readonly<Record<string, unknown>>;
    if (typeof record.code === "string" && /^\d{5}$/.test(record.code)) {
      return record.code;
    }
    current = record.cause;
  }
  return null;
}

function databaseErrorMessages(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    const record = current as Readonly<Record<string, unknown>>;
    if (typeof record.message === "string") messages.push(record.message);
    current = record.cause;
  }
  return messages.join("\n");
}

async function scalarCount(db: HuleeDatabase, query: SQL): Promise<number> {
  const result = await db.execute<{ count: number }>(query);
  return result.rows[0]?.count ?? 0;
}

async function artifactCounts(
  db: HuleeDatabase,
  tenantId: string
): Promise<ArtifactCounts> {
  const result = await db.execute<Record<keyof ArtifactCounts, number>>(sql`
    select
      (select count(*)::integer from inbox_v2_auth_command_records
        where tenant_id = ${tenantId}) as commands,
      (select count(*)::integer from inbox_v2_auth_mutation_commits
        where tenant_id = ${tenantId}) as "mutationCommits",
      (select count(*)::integer from inbox_v2_auth_audit_events
        where tenant_id = ${tenantId}) as audits,
      (select count(*)::integer from inbox_v2_auth_audit_facets
        where tenant_id = ${tenantId}) as "auditFacets",
      (select count(*)::integer from inbox_v2_tenant_stream_commits
        where tenant_id = ${tenantId}) as "streamCommits",
      (select count(*)::integer from inbox_v2_tenant_stream_changes
        where tenant_id = ${tenantId}) as changes,
      (select count(*)::integer from inbox_v2_domain_events
        where tenant_id = ${tenantId}) as events,
      (select count(*)::integer from inbox_v2_outbox_intents
        where tenant_id = ${tenantId}) as "outboxIntents",
      (select count(*)::integer from inbox_v2_auth_revision_effects
        where tenant_id = ${tenantId}) as "revisionEffects",
      (select count(*)::integer from inbox_v2_auth_relation_writes
        where tenant_id = ${tenantId}) as "relationWrites"
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("RBAC003 artifact count missing.");
  return row;
}

function zeroArtifactCounts(): ArtifactCounts {
  return {
    commands: 0,
    mutationCommits: 0,
    audits: 0,
    auditFacets: 0,
    streamCommits: 0,
    changes: 0,
    events: 0,
    outboxIntents: 0,
    revisionEffects: 0,
    relationWrites: 0
  };
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

function captureBackendExecutor(
  db: HuleeDatabase,
  backendPid: Deferred<number>
): InboxV2AuthorizationTransactionExecutor {
  return {
    async execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      const result = await db.execute(query);
      return { rows: result.rows as unknown as readonly Row[] };
    },
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>,
      config: Readonly<{ isolationLevel: "read committed" }>
    ): Promise<TResult> {
      return db.transaction(async (transaction) => {
        const pid = await transaction.execute<{ pid: number }>(
          sql`select pg_backend_pid()::integer as pid`
        );
        const value = pid.rows[0]?.pid;
        if (value === undefined) {
          backendPid.reject(new Error("PostgreSQL backend PID is missing."));
          throw new Error("PostgreSQL backend PID is missing.");
        }
        backendPid.resolve(value);
        return work(transaction as unknown as RawSqlExecutor);
      }, config);
    }
  };
}

async function waitForBackendLock(
  db: HuleeDatabase,
  backendPid: number
): Promise<void> {
  await pollUntil(async () => {
    const result = await db.execute<{ waiting: boolean }>(sql`
      select exists (
        select 1
        from pg_stat_activity
        where pid = ${backendPid}
          and wait_event_type = 'Lock'
      ) as waiting
    `);
    return result.rows[0]?.waiting === true;
  }, `backend ${backendPid} to wait for a PostgreSQL lock`);
}

async function databaseTiming(
  db: HuleeDatabase,
  ttlMilliseconds: number
): Promise<Readonly<{ authorizedAt: string; notAfter: string }>> {
  const result = await db.execute<{
    authorized_at: unknown;
    not_after: unknown;
  }>(sql`
    select clock_timestamp() as authorized_at,
           clock_timestamp() + (${ttlMilliseconds}::double precision
             * interval '1 millisecond') as not_after
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("PostgreSQL clock row is missing.");
  return {
    authorizedAt: timestampText(row.authorized_at),
    notAfter: timestampText(row.not_after)
  };
}

async function waitForDatabaseTime(
  db: HuleeDatabase,
  target: string
): Promise<void> {
  await pollUntil(async () => {
    const result = await db.execute<{ reached: boolean }>(sql`
      select clock_timestamp() >= ${target}::timestamptz as reached
    `);
    return result.rows[0]?.reached === true;
  }, `database clock to reach ${target}`);
}

async function pollUntil(
  predicate: () => Promise<boolean>,
  description: string,
  timeoutMilliseconds = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function timestampText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const timestamp = new Date(value);
    if (!Number.isNaN(timestamp.getTime())) return timestamp.toISOString();
  }
  throw new Error("PostgreSQL returned a non-timestamp clock value.");
}
