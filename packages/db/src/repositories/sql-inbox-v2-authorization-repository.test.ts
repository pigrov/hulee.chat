import {
  inboxV2CatalogIdSchema,
  inboxV2Sha256DigestSchema
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  buildInsertInboxV2OutboxIntentsSql,
  buildInsertInboxV2TenantStreamChangesSql,
  buildInsertInboxV2TenantStreamCommitSql,
  buildLockInboxV2AuthorizationResourceHeadsSql,
  buildLockInboxV2AuthorizationWorkItemResourceHeadsSql,
  buildReadInboxV2CurrentRoleBindingsSql,
  computeInboxV2AuthorizationMutationManifestDigest,
  computeInboxV2LeafHashDigest,
  computeInboxV2TenantStreamManifestDigest,
  assertInboxV2AuthorizedCommandMutationContext,
  createSqlInboxV2AuthorizedCommandCoordinator,
  createSqlInboxV2AuthorizationRepository,
  type InboxV2AuthorizationTransactionExecutor,
  type InboxV2AuthorizedCommandMutationContext,
  type WithPrivilegedAuthorizationMutationInput
} from "./sql-inbox-v2-authorization-repository";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const employeeId = "employee:employee-1";
const occurredAt = "2026-07-15T09:00:00.000Z";
const expiresAt = "2027-07-15T09:00:00.000Z";
const hashA = inboxV2Sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
const hashB = inboxV2Sha256DigestSchema.parse(`sha256:${"b".repeat(64)}`);
const internalRoleId = `internal-ref:${"1".repeat(32)}`;
const internalTenantId = `internal-ref:${"2".repeat(32)}`;

describe("SQL Inbox V2 authorization mutation repository", () => {
  it("claims idempotency first, takes the tenant stream lock last and persists FK-safe closure", async () => {
    const executor = new RoutingAuthorizationExecutor();
    const repository = createSqlInboxV2AuthorizationRepository(executor);

    const result = await repository.withPrivilegedAuthorizationMutation(
      roleMutationInput(),
      async (context) => {
        executor.timeline.push("relation_callback");
        expect(context.profile).toBe("authorization_relation");
        return {
          result: { roleId: "role:role-1" },
          relationWrites: [relationWrite("role:role-1")]
        };
      }
    );

    expect(result).toMatchObject({
      kind: "applied",
      result: { roleId: "role:role-1" },
      status: {
        commandId: "command:command-1",
        streamEpoch: "stream:epoch-1",
        streamPosition: "1"
      }
    });
    expect(executor.commitCount).toBe(1);
    expect(executor.rollbackCount).toBe(0);
    expect(executor.timeline[0]).toBe("claim_command");
    expect(executor.timeline.indexOf("decision_time_fence")).toBeLessThan(
      executor.timeline.indexOf("relation_callback")
    );
    expect(executor.timeline.indexOf("relation_callback")).toBeLessThan(
      executor.timeline.indexOf("lock_stream_head")
    );
    expect(executor.timeline.indexOf("lock_stream_head")).toBeLessThan(
      executor.timeline.indexOf("insert_stream_commit")
    );
    expect(
      executor.timeline.filter((kind) => kind.startsWith("lock_"))
    ).toEqual(["lock_tenant_head", "lock_employee_heads", "lock_stream_head"]);
    expectInOrder(executor.timeline, [
      "insert_stream_commit",
      "insert_stream_changes",
      "insert_domain_events",
      "insert_outbox_intents",
      "complete_command",
      "insert_audit",
      "insert_audit_facets",
      "insert_mutation_commit",
      "insert_revision_effects",
      "insert_relation_writes",
      "advance_stream_head"
    ]);
  });

  it("rejects a role definition that conflicts with active and scheduled bindings even when the callback omits planning", async () => {
    expect(
      normalizeSql(
        renderQuery(
          buildReadInboxV2CurrentRoleBindingsSql(tenantId, ["role:role-1"])
        ).sql
      )
    ).toContain("version_row.state = 'active'");
    const executor = new RoutingAuthorizationExecutor({
      persistedRolePermissionRows: [
        rolePermissionRow("core:employee.profile.manage", 1, 2),
        rolePermissionRow("core:queue.manage", 2, 2)
      ],
      currentRoleBindingRows: [
        roleBindingRow({
          bindingId: "role-binding:active",
          scopeKind: "team",
          scopeId: "team:team-1"
        }),
        roleBindingRow({
          bindingId: "role-binding:scheduled",
          scopeKind: "queue",
          scopeId: "queue:queue-1",
          validFrom: "2026-08-01T00:00:00.000Z"
        })
      ]
    });
    let callbackCount = 0;

    const result = await createSqlInboxV2AuthorizationRepository(
      executor
    ).withPrivilegedAuthorizationMutation(roleMutationInput(), async () => {
      callbackCount += 1;
      return {
        result: null,
        relationWrites: [relationWrite("role:role-1")]
      };
    });

    expect(result).toEqual({
      kind: "role_legality_conflict",
      code: "authorization.role_legality_conflict",
      relationKind: "role",
      relationId: "role:role-1",
      reason: "incompatible_binding_scope",
      conflicts: [
        {
          bindingId: "role-binding:active",
          permissionId: "core:queue.manage",
          scopeType: "team",
          reason: "illegal_scope"
        },
        {
          bindingId: "role-binding:scheduled",
          permissionId: "core:employee.profile.manage",
          scopeType: "queue",
          reason: "illegal_scope"
        }
      ]
    });
    expect(callbackCount).toBe(1);
    expect(executor.rollbackCount).toBe(1);
    expect(executor.commitCount).toBe(0);
    expect(executor.timeline).toContain("read_current_role_bindings");
    expect(executor.timeline).not.toContain("lock_stream_head");
  });

  it("rejects a persisted role binding against the current role permissions without trusting the callback", async () => {
    const executor = new RoutingAuthorizationExecutor({
      persistedRoleBindingRows: [
        roleBindingRow({
          bindingId: "role-binding:binding-1",
          scopeKind: "team",
          scopeId: "team:team-1"
        })
      ],
      currentRolePermissionRows: [currentRolePermissionRow("core:queue.manage")]
    });

    const result = await createSqlInboxV2AuthorizationRepository(
      executor
    ).withPrivilegedAuthorizationMutation(
      roleBindingMutationInput(),
      async () => ({
        result: null,
        relationWrites: [relationWrite("role-binding:binding-1")]
      })
    );

    expect(result).toEqual({
      kind: "role_legality_conflict",
      code: "authorization.role_legality_conflict",
      relationKind: "role_binding",
      relationId: "role-binding:binding-1",
      reason: "incompatible_binding_scope",
      conflicts: [
        {
          bindingId: "role-binding:binding-1",
          permissionId: "core:queue.manage",
          scopeType: "team",
          reason: "illegal_scope"
        }
      ]
    });
    expect(executor.rollbackCount).toBe(1);
    expect(executor.commitCount).toBe(0);
    expectInOrder(executor.timeline, [
      "lock_tenant_head",
      "read_persisted_role_bindings",
      "read_current_role_permissions"
    ]);
    expect(executor.timeline).not.toContain("lock_stream_head");
  });

  it("returns status-only replay and rejects a different request hash before domain locks", async () => {
    const replay = new RoutingAuthorizationExecutor({
      replayRequestHash: hashA
    });
    let callbackCount = 0;
    const replayed = await createSqlInboxV2AuthorizationRepository(
      replay
    ).withPrivilegedAuthorizationMutation(roleMutationInput(), async () => {
      callbackCount += 1;
      throw new Error("must not run");
    });

    expect(replayed.kind).toBe("already_applied");
    if (replayed.kind === "already_applied") {
      expect(replayed.status.resultReference).toBeNull();
      expect(Object.hasOwn(replayed.status, "sensitiveResultReference")).toBe(
        false
      );
    }
    expect(callbackCount).toBe(0);
    expect(replay.timeline).toEqual(["claim_command", "replay_by_scope"]);

    const conflict = new RoutingAuthorizationExecutor({
      replayRequestHash: hashA
    });
    const conflictInput = roleMutationInput({
      command: { ...roleMutationInput().command, requestHash: hashB }
    });
    await expect(
      createSqlInboxV2AuthorizationRepository(
        conflict
      ).withPrivilegedAuthorizationMutation(conflictInput, async () => {
        throw new Error("must not run");
      })
    ).resolves.toEqual({
      kind: "idempotency_conflict",
      code: "command.idempotency_conflict"
    });
    expect(conflict.timeline).toEqual(["claim_command", "replay_by_scope"]);
  });

  it("exposes an authorized DB-only replay loader through the generic coordinator", async () => {
    const executor = new RoutingAuthorizationExecutor({
      replayRequestHash: hashA
    });
    const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(executor);
    let callbackCount = 0;
    let loaderCount = 0;
    let capturedContext: InboxV2AuthorizedCommandMutationContext | undefined;

    const result = await coordinator.withAuthorizedCommandMutation(
      roleMutationInput(),
      async () => {
        callbackCount += 1;
        throw new Error("domain callback must not run on replay");
      },
      async (context, status) => {
        loaderCount += 1;
        capturedContext = context;
        assertInboxV2AuthorizedCommandMutationContext(context);
        expect(context).toMatchObject({
          tenantId,
          commandId: "command:command-1",
          clientMutationId: "mutation:mutation-1",
          commandTypeId: "core:authorization.role_definition",
          mutationId: "authorization-mutation:mutation-1",
          profile: "authorization_relation"
        });
        expect(status.resultReference).toBeNull();
        executor.timeline.push("replay_loader");
        return { roleId: "role:role-1" };
      }
    );

    expect(result.kind).toBe("already_applied");
    if (result.kind === "already_applied") {
      expect(result.status).toMatchObject({
        commandId: "command:command-1",
        mutationId: "authorization-mutation:mutation-1",
        publicResultCode: "core:authorization.applied",
        resultReference: null,
        streamCommitId: "commit:commit-1",
        streamEpoch: "stream:epoch-1",
        streamPosition: "1"
      });
      expect(Object.hasOwn(result.status, "sensitiveResultReference")).toBe(
        false
      );
      expect(result.result).toEqual({ roleId: "role:role-1" });
    }
    expect(callbackCount).toBe(0);
    expect(loaderCount).toBe(1);
    expect(executor.timeline).toEqual([
      "claim_command",
      "replay_by_scope",
      "ensure_tenant_head",
      "lock_tenant_head",
      "ensure_employee_heads",
      "lock_employee_heads",
      "decision_time_fence",
      "replay_loader"
    ]);
    expect(() =>
      assertInboxV2AuthorizedCommandMutationContext(capturedContext!)
    ).toThrow("requires a live authorized-command context");

    const stale = new RoutingAuthorizationExecutor({
      replayRequestHash: hashA,
      tenantRbacRevision: "8"
    });
    let staleLoaderCount = 0;
    await expect(
      createSqlInboxV2AuthorizedCommandCoordinator(
        stale
      ).withAuthorizedCommandMutation(
        roleMutationInput(),
        async () => {
          throw new Error("must not run");
        },
        async () => {
          staleLoaderCount += 1;
          throw new Error("stale loader must not run");
        }
      )
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      conflicts: [{ kind: "tenant_rbac", currentRevision: "8" }]
    });
    expect(staleLoaderCount).toBe(0);
    expect(stale.timeline).toContain("lock_tenant_head");
    expect(stale.timeline).not.toContain("decision_time_fence");

    const expired = new RoutingAuthorizationExecutor({
      replayRequestHash: hashA,
      databaseNow: "2026-07-15T10:00:00.000Z"
    });
    let expiredLoaderCount = 0;
    await expect(
      createSqlInboxV2AuthorizedCommandCoordinator(
        expired
      ).withAuthorizedCommandMutation(
        roleMutationInput(),
        async () => {
          throw new Error("must not run");
        },
        async () => {
          expiredLoaderCount += 1;
          throw new Error("expired loader must not run");
        }
      )
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      conflicts: [{ kind: "authorization_decision_time" }]
    });
    expect(expiredLoaderCount).toBe(0);
    expect(expired.timeline.at(-1)).toBe("decision_time_fence");
  });

  it("rejects forged authorized-command callback contexts", () => {
    const fakeContext = {
      executor: new RoutingAuthorizationExecutor(),
      tenantId,
      commandId: "command:forged",
      clientMutationId: "mutation:forged",
      commandTypeId: "core:source-connection.create",
      mutationId: "authorization-mutation:forged",
      profile: "domain",
      revisionEffects: []
    } as unknown as InboxV2AuthorizedCommandMutationContext;

    expect(() =>
      assertInboxV2AuthorizedCommandMutationContext(fakeContext)
    ).toThrow("requires a live authorized-command context");
  });

  it("accepts opaque UUID and 512-character transport IDs but rejects overflow and invalid characters", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const maximumOpaqueId = "a".repeat(512);

    for (const opaqueId of [uuid, maximumOpaqueId]) {
      const executor = new RoutingAuthorizationExecutor();
      await expect(
        createSqlInboxV2AuthorizationRepository(
          executor
        ).withPrivilegedAuthorizationMutation(
          withCommandTransportIds(roleMutationInput(), {
            requestId: opaqueId,
            clientMutationId: opaqueId
          }),
          async () => ({
            result: null,
            relationWrites: [relationWrite("role:role-1")]
          })
        )
      ).resolves.toMatchObject({ kind: "applied" });
      expect(executor.commitCount).toBe(1);
    }

    await expectInvalidBeforeTransaction(
      withCommandTransportIds(roleMutationInput(), {
        requestId: "a".repeat(513)
      })
    );
    await expectInvalidBeforeTransaction(
      withCommandTransportIds(roleMutationInput(), {
        clientMutationId: "a".repeat(513)
      })
    );
    await expectInvalidBeforeTransaction(
      withCommandTransportIds(roleMutationInput(), {
        requestId: "invalid/request"
      })
    );
    await expectInvalidBeforeTransaction(
      withCommandTransportIds(roleMutationInput(), {
        clientMutationId: "invalid mutation"
      })
    );
  });

  it("applies a provider-neutral domain command with zero authorization effects and relation writes", async () => {
    const executor = new RoutingAuthorizationExecutor();
    const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(executor);
    let callbackCount = 0;

    const result = await coordinator.withAuthorizedCommandMutation(
      domainMutationInput(),
      async (context) => {
        callbackCount += 1;
        executor.timeline.push("domain_callback");
        expect(context.profile).toBe("domain");
        expect(context.revisionEffects).toEqual([]);
        return { result: { sourceConnectionId: "source_connection:source-1" } };
      }
    );

    expect(result).toMatchObject({
      kind: "applied",
      result: { sourceConnectionId: "source_connection:source-1" },
      revisionEffects: []
    });
    expect(callbackCount).toBe(1);
    expect(executor.timeline.indexOf("decision_time_fence")).toBeLessThan(
      executor.timeline.indexOf("domain_callback")
    );
    expect(executor.timeline).not.toContain("read_relation_write_targets");
    expect(executor.timeline).not.toContain("read_persisted_role_permissions");
    const revisionEffectInsert = executor.queries.find(
      (query) =>
        statementKind(normalizeSql(renderQuery(query).sql)) ===
        "insert_revision_effects"
    );
    const relationWriteInsert = executor.queries.find(
      (query) =>
        statementKind(normalizeSql(renderQuery(query).sql)) ===
        "insert_relation_writes"
    );
    expect(revisionEffectInsert).toBeDefined();
    expect(relationWriteInsert).toBeDefined();
    expect(jsonRecordsetRowCount(revisionEffectInsert!)).toBe(0);
    expect(jsonRecordsetRowCount(relationWriteInsert!)).toBe(0);
  });

  it("rolls back callback, audit and stale stream failures without a partial commit", async () => {
    const callbackFailure = new RoutingAuthorizationExecutor();
    await expect(
      createSqlInboxV2AuthorizationRepository(
        callbackFailure
      ).withPrivilegedAuthorizationMutation(roleMutationInput(), async () => {
        throw new Error("relation write failed");
      })
    ).rejects.toThrow("relation write failed");
    expect(callbackFailure.rollbackCount).toBe(1);
    expect(callbackFailure.timeline).not.toContain("lock_stream_head");

    const auditFailure = new RoutingAuthorizationExecutor({
      failKind: "insert_audit"
    });
    await expect(
      createSqlInboxV2AuthorizationRepository(
        auditFailure
      ).withPrivilegedAuthorizationMutation(roleMutationInput(), async () => ({
        result: null,
        relationWrites: [relationWrite("role:role-1")]
      }))
    ).rejects.toThrow("injected insert_audit failure");
    expect(auditFailure.commitCount).toBe(0);
    expect(auditFailure.rollbackCount).toBe(1);
    expect(auditFailure.timeline).toContain("complete_command");
    expect(auditFailure.timeline).not.toContain("insert_mutation_commit");

    const staleEpoch = new RoutingAuthorizationExecutor({
      streamEpoch: "stream:epoch-new"
    });
    await expect(
      createSqlInboxV2AuthorizationRepository(
        staleEpoch
      ).withPrivilegedAuthorizationMutation(roleMutationInput(), async () => ({
        result: null,
        relationWrites: [relationWrite("role:role-1")]
      }))
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      conflicts: [{ kind: "tenant_stream_epoch" }]
    });
    expect(staleEpoch.rollbackCount).toBe(1);
    expect(staleEpoch.timeline).not.toContain("insert_stream_commit");

    const expiredDecision = new RoutingAuthorizationExecutor({
      databaseNow: "2026-07-15T10:00:00.000Z"
    });
    let expiredCallbackCount = 0;
    await expect(
      createSqlInboxV2AuthorizationRepository(
        expiredDecision
      ).withPrivilegedAuthorizationMutation(roleMutationInput(), async () => {
        expiredCallbackCount += 1;
        return {
          result: null,
          relationWrites: [relationWrite("role:role-1")]
        };
      })
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      conflicts: [{ kind: "authorization_decision_time" }]
    });
    expect(expiredCallbackCount).toBe(0);
    expect(expiredDecision.timeline).toContain("decision_time_fence");
    expect(expiredDecision.timeline).not.toContain("insert_stream_commit");
  });

  it.each([
    ["direct serialization failure", "40001", false],
    ["nested deadlock", "40P01", true]
  ] as const)(
    "retries one %s after callback persistence and commits artifacts only once",
    async (_label, code, nested) => {
      const executor = new RoutingAuthorizationExecutor({
        sqlStateFailure: {
          kind: "read_persisted_role_permissions",
          attempts: 1,
          code,
          nested
        }
      });
      let callbackCount = 0;

      const result = await createSqlInboxV2AuthorizationRepository(
        executor
      ).withPrivilegedAuthorizationMutation(roleMutationInput(), async () => {
        callbackCount += 1;
        return {
          result: null,
          relationWrites: [relationWrite("role:role-1")]
        };
      });

      expect(result).toMatchObject({ kind: "applied" });
      expect(executor.transactionCount).toBe(2);
      expect(executor.rollbackCount).toBe(1);
      expect(executor.commitCount).toBe(1);
      expect(callbackCount).toBe(2);
      expect(
        executor.timeline.filter((kind) => kind === "claim_command")
      ).toHaveLength(2);
      expect(
        executor.timeline.filter((kind) => kind === "insert_mutation_commit")
      ).toHaveLength(1);
      expect(
        executor.timeline.filter((kind) => kind === "advance_tenant_head")
      ).toHaveLength(1);
    }
  );

  it("exhausts retryable failures after exactly three rolled-back transaction attempts", async () => {
    const executor = new RoutingAuthorizationExecutor({
      sqlStateFailure: {
        kind: "read_persisted_role_permissions",
        attempts: 3,
        code: "40001",
        nested: true
      }
    });
    let callbackCount = 0;

    await expect(
      createSqlInboxV2AuthorizationRepository(
        executor
      ).withPrivilegedAuthorizationMutation(roleMutationInput(), async () => {
        callbackCount += 1;
        return {
          result: null,
          relationWrites: [relationWrite("role:role-1")]
        };
      })
    ).rejects.toMatchObject({ cause: { code: "40001" } });
    expect(executor.transactionCount).toBe(3);
    expect(executor.rollbackCount).toBe(3);
    expect(executor.commitCount).toBe(0);
    expect(callbackCount).toBe(3);
    expect(executor.timeline).not.toContain("insert_mutation_commit");
  });

  it("does not retry a non-retryable SQLSTATE", async () => {
    const executor = new RoutingAuthorizationExecutor({
      sqlStateFailure: {
        kind: "read_persisted_role_permissions",
        attempts: 1,
        code: "23514",
        nested: false
      }
    });
    let callbackCount = 0;

    await expect(
      createSqlInboxV2AuthorizationRepository(
        executor
      ).withPrivilegedAuthorizationMutation(roleMutationInput(), async () => {
        callbackCount += 1;
        return {
          result: null,
          relationWrites: [relationWrite("role:role-1")]
        };
      })
    ).rejects.toMatchObject({ code: "23514" });
    expect(executor.transactionCount).toBe(1);
    expect(executor.rollbackCount).toBe(1);
    expect(executor.commitCount).toBe(0);
    expect(callbackCount).toBe(1);
    expect(executor.timeline).not.toContain("insert_mutation_commit");
  });

  it("locks exact structural head IDs and exact WorkItem reopen cycles", async () => {
    const input = structuralMutationInput();
    const structuralSql = normalizeSql(
      renderQuery(
        buildLockInboxV2AuthorizationResourceHeadsSql(
          tenantId,
          input.revisions.resources
        )
      ).sql
    );
    expect(structuralSql).toContain("head.id = requested.head_id");

    const mismatch = new RoutingAuthorizationExecutor({ resourceRows: [] });
    let callbackCount = 0;
    await expect(
      createSqlInboxV2AuthorizationRepository(
        mismatch
      ).withPrivilegedAuthorizationMutation(input, async () => {
        callbackCount += 1;
        throw new Error("must not run");
      })
    ).resolves.toEqual({ kind: "resource_not_found" });
    expect(callbackCount).toBe(0);
    expect(mismatch.rollbackCount).toBe(1);

    const structuralSuccess = new RoutingAuthorizationExecutor();
    await expect(
      createSqlInboxV2AuthorizationRepository(
        structuralSuccess
      ).withPrivilegedAuthorizationMutation(input, async () => ({
        result: null,
        relationWrites: [relationWrite("structural-access:binding-1")]
      }))
    ).resolves.toMatchObject({ kind: "applied" });
    const resourceAdvance = structuralSuccess.queries.find(
      (query) =>
        statementKind(normalizeSql(renderQuery(query).sql)) ===
        "advance_resource_heads"
    );
    expect(resourceAdvance).toBeDefined();
    expect(normalizeSql(renderQuery(resourceAdvance!).sql)).toContain(
      "structural_relation_revision = requested.resulting_structural_relation_revision"
    );

    const workItemInput = directRelationMutationInput({
      resources: [
        {
          resourceKind: "work_item",
          resourceId: "work_item:work-1",
          workItemCycle: "9007199254740993",
          expectedWorkItemRevision: "9",
          expectedResourceAccessRevision: "4",
          expectedCollaboratorSetRevision: "3",
          advanceCollaboratorSet: "callback",
          advance: "none"
        }
      ]
    });
    const workItemSql = normalizeSql(
      renderQuery(
        buildLockInboxV2AuthorizationWorkItemResourceHeadsSql(
          tenantId,
          workItemInput.revisions.resources
        )
      ).sql
    );
    expect(workItemSql).toContain(
      "work_item.reopen_cycle = requested.work_item_cycle"
    );
    expect(
      renderQuery(
        buildLockInboxV2AuthorizationWorkItemResourceHeadsSql(
          tenantId,
          workItemInput.revisions.resources
        )
      ).params.map(String)
    ).toContain(
      JSON.stringify([
        {
          work_item_id: "work_item:work-1",
          work_item_cycle: "9007199254740993"
        }
      ])
    );
    const collaboratorSuccess = new RoutingAuthorizationExecutor();
    const collaboratorResult = await createSqlInboxV2AuthorizationRepository(
      collaboratorSuccess
    ).withPrivilegedAuthorizationMutation(
      directRelationMutationInput(),
      async () => ({
        result: null,
        relationWrites: [relationWrite("collaborator:collaborator-1")]
      })
    );
    expect(collaboratorResult).toMatchObject({
      kind: "applied",
      revisionEffects: [
        { kind: "employee_inbox_relation" },
        {
          kind: "collaborator_set",
          resourceKind: "conversation",
          resourceId: "conversation:conversation-1",
          resourceHeadId: "authorization-resource:conversation-1",
          workItemCycle: null,
          expectedWorkItemRevision: null,
          resultingWorkItemRevision: null,
          previousRevision: "3",
          resultingRevision: "4"
        }
      ]
    });
    const collaboratorAdvance = collaboratorSuccess.queries.find(
      (query) =>
        statementKind(normalizeSql(renderQuery(query).sql)) ===
        "advance_resource_heads"
    );
    expect(collaboratorAdvance).toBeDefined();
    expect(normalizeSql(renderQuery(collaboratorAdvance!).sql)).toContain(
      "collaborator_set_revision = requested.resulting_collaborator_set_revision"
    );

    const workItemRows = [
      {
        head_id: null,
        resource_kind: "work_item",
        resource_id: "work_item:work-1",
        work_item_cycle: "9007199254740993",
        resource_access_revision: "4",
        structural_relation_revision: null,
        collaborator_set_revision: "3",
        revision: "9"
      },
      {
        head_id: null,
        resource_kind: "work_item",
        resource_id: "work_item:work-1",
        work_item_cycle: "9007199254740993",
        resource_access_revision: "4",
        structural_relation_revision: null,
        collaborator_set_revision: "4",
        revision: "10"
      }
    ] as const;
    const workItemRelationTarget = {
      ordinal: "1",
      relation_id: "collaborator:collaborator-1",
      target_employee_id: employeeId,
      resource_kind: "work_item",
      resource_id: "work_item:work-1",
      resource_head_id: null,
      work_item_cycle: "9007199254740993"
    } as const;
    const workItemSuccess = new RoutingAuthorizationExecutor({
      workItemResourceRows: workItemRows.map((row) => [row]),
      relationTargetRows: [workItemRelationTarget]
    });
    const workItemResult = await createSqlInboxV2AuthorizationRepository(
      workItemSuccess
    ).withPrivilegedAuthorizationMutation(workItemInput, async (context) => {
      expect(context.revisionEffects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "collaborator_set",
            resourceKind: "work_item",
            resourceId: "work_item:work-1",
            resourceHeadId: null,
            workItemCycle: "9007199254740993",
            expectedWorkItemRevision: "9",
            resultingWorkItemRevision: "10",
            previousRevision: "3",
            resultingRevision: "4"
          })
        ])
      );
      return {
        result: null,
        relationWrites: [relationWrite("collaborator:collaborator-1")]
      };
    });
    expect(workItemResult).toMatchObject({ kind: "applied" });
    const effectInsert = workItemSuccess.queries.find(
      (query) =>
        statementKind(normalizeSql(renderQuery(query).sql)) ===
        "insert_revision_effects"
    );
    expect(effectInsert).toBeDefined();
    expect(renderQuery(effectInsert!).params.map(String)).toContainEqual(
      expect.stringContaining('"expected_work_item_revision":"9"')
    );

    const staleWorkItem = new RoutingAuthorizationExecutor({
      workItemResourceRows: [[{ ...workItemRows[0], revision: "8" }]]
    });
    await expect(
      createSqlInboxV2AuthorizationRepository(
        staleWorkItem
      ).withPrivilegedAuthorizationMutation(workItemInput, async () => {
        throw new Error("must not run");
      })
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      conflicts: [
        {
          kind: "work_item_revision",
          expectedRevision: "9",
          currentRevision: "8"
        }
      ]
    });

    for (const [after, message] of [
      [
        { ...workItemRows[1], revision: "11" },
        "did not advance the exact WorkItem revision"
      ],
      [
        { ...workItemRows[1], work_item_cycle: "9007199254740994" },
        "moved the WorkItem to a different reopen cycle"
      ]
    ] as const) {
      const invalidCallback = new RoutingAuthorizationExecutor({
        workItemResourceRows: [[workItemRows[0]], [after]],
        relationTargetRows: [workItemRelationTarget]
      });
      await expect(
        createSqlInboxV2AuthorizationRepository(
          invalidCallback
        ).withPrivilegedAuthorizationMutation(workItemInput, async () => ({
          result: null,
          relationWrites: [relationWrite("collaborator:collaborator-1")]
        }))
      ).rejects.toThrow(message);
      expect(invalidCallback.rollbackCount).toBe(1);
      expect(invalidCallback.timeline).not.toContain("lock_stream_head");
    }
    await expectInvalidBeforeTransaction(
      directRelationMutationInput({
        resources: [
          {
            resourceKind: "work_item",
            resourceId: "work_item:work-1",
            expectedWorkItemRevision: "9",
            expectedResourceAccessRevision: "4",
            expectedCollaboratorSetRevision: "3",
            advanceCollaboratorSet: "callback",
            advance: "none"
          }
        ] as never
      })
    );
  });

  it("persists the full reference-only stream manifest, timeline and outbox correlation", () => {
    const input = roleMutationInput();
    const commit = renderQuery(
      buildInsertInboxV2TenantStreamCommitSql({
        input,
        streamEpoch: input.records.expectedStreamEpoch,
        streamPosition: "1",
        previousPosition: "0"
      })
    );
    const commitSql = normalizeSql(commit.sql);
    for (const column of [
      "schema_version",
      "correlation_id",
      "command_ids",
      "client_mutation_ids",
      "authorization_decision_refs",
      "change_ids",
      "event_ids",
      "outbox_intent_ids",
      "audience_impact_manifest",
      "commit_hash"
    ]) {
      expect(commitSql).toContain(column);
    }
    expect(commit.params.map(String)).toContain(
      JSON.stringify(input.records.audienceImpact)
    );

    expect(
      normalizeSql(
        renderQuery(
          buildInsertInboxV2TenantStreamChangesSql({
            input,
            streamPosition: "1"
          })
        ).sql
      )
    ).toContain("timeline");
    const outboxSql = normalizeSql(
      renderQuery(
        buildInsertInboxV2OutboxIntentsSql({ input, streamPosition: "1" })
      ).sql
    );
    expect(outboxSql).toContain("consumer_dedupe_key");
    expect(outboxSql).toContain("correlation_id");
  });

  it("uses the frozen LF-delimited digest byte vectors", () => {
    const leafDigest = computeInboxV2LeafHashDigest([hashA, hashB]);
    expect(leafDigest).toBe(
      "sha256:4ab61be5d46a66e7f659b66144d4bead5b761c247b565fa202161590dcd9e45d"
    );
    expect(
      computeInboxV2TenantStreamManifestDigest(roleMutationInput().records)
    ).toBe(
      "sha256:d6ab4d4dfc6e88e2f72aa3d42420b443fb781cc3d04877a7e2b08adba0227417"
    );
    expect(
      computeInboxV2AuthorizationMutationManifestDigest({
        revisionEffectDigest: leafDigest,
        relationWriteDigest: leafDigest,
        streamCommitHash: hashA,
        auditHash: hashB
      })
    ).toBe(
      "sha256:9154d64a99edcfd6284502d00432ddfad4e05de16b0cc1e71eb13c2e7ba615d4"
    );
  });

  it("rejects unsupported metadata, raw sensitive refs and cross-tenant nested references", async () => {
    const base = roleMutationInput();
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        audit: { ...base.records.audit, metadata: { phone: "+79990000000" } }
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      command: { ...base.command, sensitiveResultReference: "+79990000000" }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        audienceImpact: {
          ...tenantRbacAudience(),
          invalidations: [
            {
              kind: "entity",
              entity: {
                tenantId: otherTenantId,
                entityTypeId: "core:role",
                entityId: "role:role-1"
              }
            }
          ]
        }
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        changes: [
          {
            ...base.records.changes[0]!,
            state: {
              ...base.records.changes[0]!.state,
              rawPayload: { phone: "+79990000000" }
            }
          }
        ]
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        events: [
          {
            ...base.records.events[0]!,
            recordedAt: "2026-07-15T08:59:59.000Z"
          }
        ]
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        audit: {
          ...base.records.audit,
          grantSourceIds: ["telegram:+79990000000"],
          authorizationScopeIds: ["operator@example.com"]
        }
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        audit: {
          ...base.records.audit,
          policyVersion: "operator@example.com"
        }
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      command: {
        ...base.command,
        actor: { kind: "root", trustedServiceId: "core:root-service" }
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        audit: {
          ...base.records.audit,
          facets: [
            {
              ...base.records.audit.facets[0]!,
              relation: "owner"
            }
          ]
        }
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        audit: {
          ...base.records.audit,
          policyVersion: `v${"1".repeat(128)}`
        }
      }
    } as never);
  });

  it("rejects gaps, overflow and missing event/outbox change closure before SQL", async () => {
    const base = roleMutationInput();
    const oversizedResource = structuralMutationInput();
    await expectInvalidBeforeTransaction({
      ...oversizedResource,
      revisions: {
        ...oversizedResource.revisions,
        resources: oversizedResource.revisions.resources.map((resource) => ({
          ...resource,
          resourceId: `conversation:${"a".repeat(300)}`
        }))
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...oversizedResource,
      revisions: {
        ...oversizedResource.revisions,
        resources: [
          {
            ...oversizedResource.revisions.resources[0]!,
            resourceKind: "message"
          }
        ]
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...oversizedResource,
      revisions: {
        ...oversizedResource.revisions,
        resources: [
          {
            ...oversizedResource.revisions.resources[0]!,
            advance: "async"
          }
        ]
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      revisions: {
        ...base.revisions,
        expectedTenantRbacRevision: "07"
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      revisions: {
        ...base.revisions,
        expectedSharedAccessRevision: "9223372036854775808"
      }
    } as never);
    await expectInvalidBeforeTransaction(
      directRelationMutationInput({
        resources: [
          {
            resourceKind: "work_item",
            resourceId: "work_item:work-1",
            workItemCycle: "01",
            expectedWorkItemRevision: "9",
            expectedResourceAccessRevision: "4",
            expectedCollaboratorSetRevision: "3",
            advanceCollaboratorSet: "callback",
            advance: "none"
          }
        ]
      })
    );
    await expectInvalidBeforeTransaction(
      directRelationMutationInput({
        resources: [
          {
            resourceKind: "work_item",
            resourceId: "work_item:work-1",
            workItemCycle: "9223372036854775808",
            expectedWorkItemRevision: "9",
            expectedResourceAccessRevision: "4",
            expectedCollaboratorSetRevision: "3",
            advanceCollaboratorSet: "callback",
            advance: "none"
          }
        ]
      })
    );
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        changes: [{ ...base.records.changes[0]!, ordinal: 2 }]
      }
    } as never);

    await expectInvalidBeforeTransaction(
      directGrantMutationInput(65),
      "exceeds 64"
    );
    await expectInvalidBeforeTransaction(
      directRelationMutationInput({ employeeCount: 1_001 }),
      "unbounded"
    );
    await expectInvalidBeforeTransaction(
      structuralMutationInput({ resourceCount: 257 }),
      "unbounded"
    );
    await expectInvalidBeforeTransaction(
      directRelationMutationInput({
        resources: [
          {
            resourceKind: "conversation",
            resourceId: "conversation:conversation-1",
            resourceHeadId: "authorization-resource:conversation-1",
            expectedResourceAccessRevision: "4",
            expectedCollaboratorSetRevision: "3",
            advanceCollaboratorSet: "repository",
            advance: "none"
          },
          {
            resourceKind: "conversation",
            resourceId: "conversation:conversation-2",
            resourceHeadId: "authorization-resource:conversation-2",
            expectedResourceAccessRevision: "4",
            expectedCollaboratorSetRevision: "3",
            advanceCollaboratorSet: "repository",
            advance: "none"
          }
        ]
      }),
      "exactly one collaborator-set aggregate"
    );

    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        events: [{ ...base.records.events[0]!, changeIds: ["change:missing"] }]
      }
    } as never);
    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        outboxIntents: [
          {
            ...base.records.outboxIntents[0]!,
            changeIds: ["change:missing"]
          }
        ]
      }
    } as never);
  });

  it("allows bounded actor/resource fences but rejects forbidden revision fanout", async () => {
    const roleWithFence = roleMutationInput();
    expect(roleWithFence.revisions.employees).toEqual([
      expect.objectContaining({
        employeeId,
        advanceEmployeeAccess: false,
        advanceEmployeeInboxRelation: false
      })
    ]);
    await expectInvalidBeforeTransaction({
      ...roleWithFence,
      revisions: { ...roleWithFence.revisions, employees: [] }
    } as never);

    const resourceDecision = {
      ...authorizationDecision(),
      resource: {
        tenantId,
        entityTypeId: "core:conversation",
        entityId: "conversation:conversation-1"
      },
      resourceAccessRevision: "4"
    };
    await expectInvalidBeforeTransaction({
      ...roleWithFence,
      records: {
        ...roleWithFence.records,
        events: [
          authorizationEvent(
            resourceDecision,
            roleWithFence.records.changes[0]!.id
          )
        ],
        audit: authorizationAudit(resourceDecision)
      }
    } as never);

    const revokedActor = new RoutingAuthorizationExecutor({
      employeeAccessRevision: "6"
    });
    let callbackCount = 0;
    await expect(
      createSqlInboxV2AuthorizationRepository(
        revokedActor
      ).withPrivilegedAuthorizationMutation(roleWithFence, async () => {
        callbackCount += 1;
        throw new Error("must not run");
      })
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      conflicts: [{ kind: "employee_access", currentRevision: "6" }]
    });
    expect(callbackCount).toBe(0);
    expect(revokedActor.timeline).not.toContain("lock_stream_head");

    const staleActorRelation = new RoutingAuthorizationExecutor({
      employeeInboxRelationRevision: "7"
    });
    await expect(
      createSqlInboxV2AuthorizationRepository(
        staleActorRelation
      ).withPrivilegedAuthorizationMutation(roleWithFence, async () => {
        throw new Error("must not run");
      })
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      conflicts: [{ kind: "employee_inbox_relation", currentRevision: "7" }]
    });

    const staleSharedDependency = new RoutingAuthorizationExecutor({
      sharedAccessRevision: "3"
    });
    await expect(
      createSqlInboxV2AuthorizationRepository(
        staleSharedDependency
      ).withPrivilegedAuthorizationMutation(roleWithFence, async () => {
        throw new Error("must not run");
      })
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      conflicts: [{ kind: "shared_access", currentRevision: "3" }]
    });

    const staleTenantDependency = new RoutingAuthorizationExecutor({
      tenantRbacRevision: "8"
    });
    await expect(
      createSqlInboxV2AuthorizationRepository(
        staleTenantDependency
      ).withPrivilegedAuthorizationMutation(roleWithFence, async () => {
        throw new Error("must not run");
      })
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      conflicts: [{ kind: "tenant_rbac", currentRevision: "8" }]
    });

    await expectInvalidBeforeTransaction({
      ...roleWithFence,
      revisions: {
        ...roleWithFence.revisions,
        employees: [
          {
            ...roleWithFence.revisions.employees[0]!,
            advanceEmployeeAccess: true
          }
        ]
      }
    } as never);

    const relation = directRelationMutationInput();
    await expectInvalidBeforeTransaction({
      ...relation,
      revisions: {
        ...relation.revisions,
        resources: relation.revisions.resources.map((resource) => ({
          ...resource,
          advance: "repository" as const
        }))
      }
    } as never);

    const structural = structuralMutationInput();
    await expectInvalidBeforeTransaction({
      ...structural,
      revisions: {
        ...structural.revisions,
        employees: [
          {
            ...structural.revisions.employees[0]!,
            advanceEmployeeAccess: true
          }
        ]
      }
    } as never);
  });

  it("rejects relation-derived direct and structural targets outside the fenced sets", async () => {
    const wrongDirectTarget = new RoutingAuthorizationExecutor({
      relationTargetRows: [
        {
          ordinal: "1",
          relation_id: "collaborator:collaborator-1",
          target_employee_id: "employee:employee-b",
          resource_kind: "conversation",
          resource_id: "conversation:conversation-1",
          resource_head_id: null,
          work_item_cycle: null
        }
      ]
    });
    await expect(
      createSqlInboxV2AuthorizationRepository(
        wrongDirectTarget
      ).withPrivilegedAuthorizationMutation(
        directRelationMutationInput(),
        async () => ({
          result: null,
          relationWrites: [relationWrite("collaborator:collaborator-1")]
        })
      )
    ).rejects.toThrow("target Employees do not match");
    expect(wrongDirectTarget.rollbackCount).toBe(1);
    expect(wrongDirectTarget.timeline).not.toContain("lock_stream_head");

    const wrongStructuralTarget = new RoutingAuthorizationExecutor({
      relationTargetRows: [
        {
          ordinal: "1",
          relation_id: "structural-access:binding-1",
          target_employee_id: null,
          resource_kind: "conversation",
          resource_id: "conversation:conversation-b",
          resource_head_id: "authorization-resource:conversation-b",
          work_item_cycle: null
        }
      ]
    });
    await expect(
      createSqlInboxV2AuthorizationRepository(
        wrongStructuralTarget
      ).withPrivilegedAuthorizationMutation(
        structuralMutationInput(),
        async () => ({
          result: null,
          relationWrites: [relationWrite("structural-access:binding-1")]
        })
      )
    ).rejects.toThrow("resources do not match");
    expect(wrongStructuralTarget.rollbackCount).toBe(1);
    expect(wrongStructuralTarget.timeline).not.toContain("lock_stream_head");
  });

  it("rejects direct audience decisions for the wrong principal or epoch", async () => {
    const base = directRelationMutationInput();
    const audience = base.records.audienceImpact;
    if (audience.kind !== "direct") throw new Error("invalid fixture");
    const recipient = audience.affectedRecipients[0]!;
    const decision = recipient.authorizationDecisionRefs[0]!;

    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        audienceImpact: {
          ...audience,
          affectedRecipients: [
            {
              ...recipient,
              authorizationDecisionRefs: [
                {
                  ...decision,
                  principal: {
                    kind: "employee",
                    employee: {
                      tenantId,
                      kind: "employee",
                      id: "employee:employee-b"
                    }
                  }
                }
              ]
            }
          ]
        }
      }
    } as never);

    await expectInvalidBeforeTransaction({
      ...base,
      records: {
        ...base.records,
        audienceImpact: {
          ...audience,
          affectedRecipients: [
            {
              ...recipient,
              resultingAuthorizationEpoch: "authorization:epoch-b"
            }
          ]
        }
      }
    } as never);
  });
});

class RoutingAuthorizationExecutor implements InboxV2AuthorizationTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly timeline: string[] = [];
  transactionCount = 0;
  commitCount = 0;
  rollbackCount = 0;

  constructor(
    private readonly options: Readonly<{
      replayRequestHash?: string;
      streamEpoch?: string;
      failKind?: string;
      resourceRows?: readonly Record<string, unknown>[];
      workItemResourceRows?: readonly (readonly Record<string, unknown>[])[];
      relationTargetRows?: readonly Record<string, unknown>[];
      tenantRbacRevision?: string;
      sharedAccessRevision?: string;
      employeeAccessRevision?: string;
      employeeInboxRelationRevision?: string;
      databaseNow?: string;
      persistedRolePermissionRows?: readonly Record<string, unknown>[];
      currentRoleBindingRows?: readonly Record<string, unknown>[];
      persistedRoleBindingRows?: readonly Record<string, unknown>[];
      currentRolePermissionRows?: readonly Record<string, unknown>[];
      sqlStateFailure?: Readonly<{
        kind: string;
        attempts: number;
        code: string;
        nested: boolean;
      }>;
    }> = {}
  ) {}

  private workItemResourceRead = 0;
  private sqlStateFailureCount = 0;

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const statement = normalizeSql(renderQuery(query).sql);
    const kind = statementKind(statement);
    this.timeline.push(kind);
    const sqlStateFailure = this.options.sqlStateFailure;
    if (
      sqlStateFailure !== undefined &&
      sqlStateFailure.kind === kind &&
      this.sqlStateFailureCount < sqlStateFailure.attempts
    ) {
      this.sqlStateFailureCount += 1;
      throw sqlStateError(sqlStateFailure.code, sqlStateFailure.nested);
    }
    if (this.options.failKind === kind) {
      throw new Error(`injected ${kind} failure`);
    }
    return { rows: this.rowsFor(kind, query) as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    expect(config).toEqual({ isolationLevel: "read committed" });
    this.transactionCount += 1;
    try {
      const result = await work(this);
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.rollbackCount += 1;
      throw error;
    }
  }

  private rowsFor(
    kind: string,
    query: SQL
  ): readonly Record<string, unknown>[] {
    if (kind === "claim_command") {
      return this.options.replayRequestHash === undefined
        ? [{ id: "command:command-1" }]
        : [];
    }
    if (kind === "replay_by_scope") {
      return [
        {
          id: "command:command-1",
          request_hash: this.options.replayRequestHash,
          mutation_id: "authorization-mutation:mutation-1",
          public_result_code: "core:authorization.applied",
          result_reference: null,
          stream_commit_id: "commit:commit-1",
          stream_epoch: "stream:epoch-1",
          stream_position: "1",
          committed_at: occurredAt
        }
      ];
    }
    if (kind === "lock_tenant_head") {
      return [
        {
          tenant_rbac_revision: this.options.tenantRbacRevision ?? "7",
          shared_access_revision: this.options.sharedAccessRevision ?? "2",
          revision: "4"
        }
      ];
    }
    if (kind === "lock_employee_heads") {
      return [
        {
          employee_id: employeeId,
          employee_access_revision: this.options.employeeAccessRevision ?? "5",
          employee_inbox_relation_revision:
            this.options.employeeInboxRelationRevision ?? "6",
          revision: "3"
        }
      ];
    }
    if (kind === "lock_resource_heads") {
      return this.options.resourceRows ?? [structuralResourceRow()];
    }
    if (kind === "lock_work_item_heads") {
      const rows =
        this.options.workItemResourceRows?.[this.workItemResourceRead];
      this.workItemResourceRead += 1;
      return rows ?? [];
    }
    if (kind === "read_relation_write_targets") {
      if (this.options.relationTargetRows !== undefined) {
        return this.options.relationTargetRows;
      }
      const statement = normalizeSql(renderQuery(query).sql);
      if (statement.includes("structural_access_versions")) {
        return [
          {
            ordinal: "1",
            relation_id: "structural-access:binding-1",
            target_employee_id: null,
            resource_kind: "conversation",
            resource_id: "conversation:conversation-1",
            resource_head_id: "authorization-resource:conversation-1",
            work_item_cycle: null
          }
        ];
      }
      return [
        {
          ordinal: "1",
          relation_id: "collaborator:collaborator-1",
          target_employee_id: employeeId,
          resource_kind: "conversation",
          resource_id: "conversation:conversation-1",
          resource_head_id: null,
          work_item_cycle: null
        }
      ];
    }
    if (kind === "read_persisted_role_permissions") {
      return this.options.persistedRolePermissionRows ?? [rolePermissionRow()];
    }
    if (kind === "read_current_role_bindings") {
      return this.options.currentRoleBindingRows ?? [];
    }
    if (kind === "read_persisted_role_bindings") {
      return this.options.persistedRoleBindingRows ?? [roleBindingRow()];
    }
    if (kind === "read_current_role_permissions") {
      return (
        this.options.currentRolePermissionRows ?? [
          currentRolePermissionRow("core:roles.define")
        ]
      );
    }
    if (kind === "lock_stream_head") {
      return [
        {
          stream_epoch: this.options.streamEpoch ?? "stream:epoch-1",
          last_position: "0",
          min_retained_position: "0",
          revision: "1"
        }
      ];
    }
    if (kind === "decision_time_fence") {
      return [{ database_now: this.options.databaseNow ?? occurredAt }];
    }
    if (
      kind.startsWith("insert_") ||
      kind.startsWith("advance_") ||
      kind === "complete_command"
    ) {
      const recordsetKinds = new Set([
        "insert_stream_changes",
        "insert_domain_events",
        "insert_outbox_intents",
        "insert_audit_facets",
        "insert_revision_effects",
        "insert_relation_writes"
      ]);
      const count = recordsetKinds.has(kind) ? jsonRecordsetRowCount(query) : 1;
      return Array.from({ length: count }, (_, index) => ({
        id: `ok:${index + 1}`
      }));
    }
    return [];
  }
}

function jsonRecordsetRowCount(query: SQL): number {
  for (const parameter of renderQuery(query).params) {
    if (typeof parameter !== "string" || !parameter.startsWith("[")) continue;
    try {
      const parsed: unknown = JSON.parse(parameter);
      if (Array.isArray(parsed)) return parsed.length;
    } catch {
      // Other string parameters are not the jsonb_to_recordset payload.
    }
  }
  return 1;
}

function roleMutationInput(
  overrides: Partial<WithPrivilegedAuthorizationMutationInput> = {}
): WithPrivilegedAuthorizationMutationInput {
  const decision = authorizationDecision();
  const change = streamChange();
  return {
    tenantId,
    command: {
      id: "command:command-1",
      requestId: "request:request-1",
      clientMutationId: "mutation:mutation-1",
      commandTypeId: "core:authorization.role_definition",
      requestHash: hashA,
      actor: { kind: "employee", employeeId },
      authorizationDecisionId: decision.id,
      authorizationEpoch: decision.authorizationEpoch,
      authorizedAt: occurredAt,
      publicResultCode: "core:authorization.applied",
      resultReference: null,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: "7",
      expectedSharedAccessRevision: "2",
      advanceTenantRbac: true,
      advanceSharedAccess: false,
      employees: [actorFence()],
      resources: []
    },
    records: {
      mutationId: "authorization-mutation:mutation-1",
      relationKind: "role",
      streamCommitId: "commit:commit-1",
      expectedStreamEpoch: "stream:epoch-1",
      audienceImpact: tenantRbacAudience(),
      commitHash: hashA,
      correlationId: "correlation:correlation-1",
      changes: [change],
      events: [authorizationEvent(decision, change.id)],
      outboxIntents: [projectionIntent(change.id)],
      audit: authorizationAudit(decision)
    },
    occurredAt,
    ...overrides
  } as never;
}

function withCommandTransportIds(
  input: WithPrivilegedAuthorizationMutationInput,
  identifiers: Readonly<{
    requestId?: string;
    clientMutationId?: string;
  }>
): WithPrivilegedAuthorizationMutationInput {
  const clientMutationId =
    identifiers.clientMutationId ?? input.command.clientMutationId;
  return {
    ...input,
    command: {
      ...input.command,
      requestId: identifiers.requestId ?? input.command.requestId,
      clientMutationId
    },
    records: {
      ...input.records,
      events: input.records.events.map((event) => ({
        ...event,
        clientMutationIds: [clientMutationId]
      }))
    }
  } as never;
}

function domainMutationInput(): WithPrivilegedAuthorizationMutationInput {
  const base = roleMutationInput();
  const sourceConnectionId = "source_connection:source-1";
  const commandTypeId = inboxV2CatalogIdSchema.parse(
    "core:source-connection.create"
  );
  const decision = {
    ...authorizationDecision(),
    permissionId: "core:source-connections.manage",
    resourceScopeId: "core:permission-scope.tenant",
    resource: {
      tenantId,
      entityTypeId: "core:source-connection",
      entityId: sourceConnectionId
    }
  };
  const sourceStateReference = {
    ...payloadReference("source-connection-state:source-1"),
    schemaId: "core:inbox-v2.source-connection-registry-state"
  };
  const sourceTransitionReference = {
    ...payloadReference("source-connection-transition:source-1"),
    schemaId: "core:inbox-v2.source-registry-transition"
  };
  const change = {
    ...streamChange(),
    entity: {
      tenantId,
      entityTypeId: "core:source-connection",
      entityId: sourceConnectionId
    },
    resultingRevision: "1",
    audience: "staff_only" as const,
    state: {
      kind: "upsert" as const,
      stateSchemaId: "core:inbox-v2.source-connection-registry-state",
      stateSchemaVersion: "v1",
      stateHash: hashA,
      payloadReference: sourceStateReference,
      domainCommitReference: sourceTransitionReference
    }
  };
  const event = {
    ...authorizationEvent(decision, change.id),
    typeId: "core:source-connection.changed" as const,
    payloadSchemaId: "core:inbox-v2.source-connection-change",
    subjects: [change.entity],
    accessEffect: { kind: "none" as const }
  };
  return {
    ...base,
    command: {
      ...base.command,
      commandTypeId,
      authorizationDecisionId: decision.id,
      authorizationEpoch: decision.authorizationEpoch,
      resultReference: sourceTransitionReference
    },
    revisions: {
      ...base.revisions,
      advanceTenantRbac: false,
      advanceSharedAccess: false
    },
    records: {
      ...base.records,
      relationKind: null,
      audienceImpact: { kind: "none" },
      changes: [change],
      events: [event],
      outboxIntents: [
        {
          ...projectionIntent(change.id),
          handlerId: "core:source-connection-projection"
        }
      ],
      audit: {
        ...authorizationAudit(decision),
        actionId: commandTypeId,
        target: {
          tenantId,
          entityTypeId: "core:source-connection",
          entityId: `internal-ref:${"4".repeat(32)}`
        },
        reasonCodeId: "core:source-connection-created",
        matchedPermissionIds: [decision.permissionId]
      }
    }
  } as never;
}

function roleBindingMutationInput(): WithPrivilegedAuthorizationMutationInput {
  const base = roleMutationInput();
  return {
    ...base,
    command: {
      ...base.command,
      commandTypeId: inboxV2CatalogIdSchema.parse(
        "core:authorization.role_binding"
      )
    },
    records: {
      ...base.records,
      relationKind: "role_binding",
      audit: {
        ...base.records.audit,
        actionId: "core:authorization.role_binding"
      }
    }
  };
}

function directGrantMutationInput(
  employeeCount: number
): WithPrivilegedAuthorizationMutationInput {
  const base = roleMutationInput();
  const employeeIds = Array.from(
    { length: employeeCount },
    (_, index) => `employee:target-${String(index + 1).padStart(4, "0")}`
  );
  const actorIncluded = employeeIds.includes(employeeId);
  return {
    ...base,
    revisions: {
      ...base.revisions,
      advanceTenantRbac: false,
      employees: [
        ...employeeIds.map((id) => ({
          employeeId: id,
          expectedEmployeeAccessRevision: "5",
          expectedEmployeeInboxRelationRevision: "6",
          advanceEmployeeAccess: true,
          advanceEmployeeInboxRelation: false
        })),
        ...(actorIncluded ? [] : [actorFence()])
      ]
    },
    records: {
      ...base.records,
      relationKind: "direct_grant",
      audienceImpact: directAudience(employeeIds)
    }
  } as never;
}

function directRelationMutationInput(
  options: Readonly<{
    employeeCount?: number;
    resources?: WithPrivilegedAuthorizationMutationInput["revisions"]["resources"];
  }> = {}
): WithPrivilegedAuthorizationMutationInput {
  const base = roleMutationInput();
  const count = options.employeeCount ?? 1;
  const employeeIds = Array.from({ length: count }, (_, index) =>
    index === 0
      ? employeeId
      : `employee:relation-${String(index + 1).padStart(4, "0")}`
  );
  return {
    ...base,
    revisions: {
      ...base.revisions,
      advanceTenantRbac: false,
      employees: employeeIds.map((id) => ({
        employeeId: id,
        expectedEmployeeAccessRevision: "5",
        expectedEmployeeInboxRelationRevision: "6",
        advanceEmployeeAccess: false,
        advanceEmployeeInboxRelation: true
      })),
      resources: options.resources ?? [
        {
          resourceKind: "conversation",
          resourceId: "conversation:conversation-1",
          resourceHeadId: "authorization-resource:conversation-1",
          expectedResourceAccessRevision: "4",
          expectedCollaboratorSetRevision: "3",
          advanceCollaboratorSet: "repository",
          advance: "none"
        }
      ]
    },
    records: {
      ...base.records,
      relationKind:
        options.resources?.[0]?.resourceKind === "work_item"
          ? "work_item_collaborator"
          : "conversation_collaborator",
      audienceImpact: directAudience(employeeIds)
    }
  } as never;
}

function structuralMutationInput(
  options: Readonly<{ resourceCount?: number }> = {}
): WithPrivilegedAuthorizationMutationInput {
  const base = roleMutationInput();
  const resourceCount = options.resourceCount ?? 1;
  return {
    ...base,
    revisions: {
      ...base.revisions,
      advanceTenantRbac: false,
      advanceSharedAccess: true,
      resources: Array.from({ length: resourceCount }, (_, index) => ({
        resourceKind: "conversation" as const,
        resourceId: `conversation:conversation-${index + 1}`,
        resourceHeadId: `authorization-resource:conversation-${index + 1}`,
        expectedResourceAccessRevision: "4",
        expectedStructuralRelationRevision: "1",
        advanceStructuralRelation: "repository" as const,
        advance: "repository" as const
      }))
    },
    records: {
      ...base.records,
      relationKind: "structural_access",
      audienceImpact: structuralAudience()
    }
  } as never;
}

function actorFence() {
  return {
    employeeId,
    expectedEmployeeAccessRevision: "5",
    expectedEmployeeInboxRelationRevision: "6",
    advanceEmployeeAccess: false,
    advanceEmployeeInboxRelation: false
  };
}

function authorizationDecision() {
  return {
    tenantId,
    id: "authorization-decision:decision-1",
    authorizationEpoch: "authorization:epoch-1",
    principal: {
      kind: "employee" as const,
      employee: { tenantId, kind: "employee" as const, id: employeeId }
    },
    permissionId: "core:roles.define",
    resourceScopeId: "core:permission-scope.tenant",
    resource: {
      tenantId,
      entityTypeId: "core:role",
      entityId: "role:role-1"
    },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: hashA,
    outcome: "allowed" as const,
    decidedAt: occurredAt,
    notAfter: "2026-07-15T10:00:00.000Z"
  };
}

function payloadReference(recordId: string) {
  return {
    tenantId,
    recordId,
    schemaId: "core:inbox-v2.role-head",
    schemaVersion: "v1",
    digest: hashA
  };
}

function streamChange() {
  return {
    id: "change:change-1",
    ordinal: 1,
    entity: { tenantId, entityTypeId: "core:role", entityId: "role:role-1" },
    resultingRevision: "2",
    timeline: null,
    audience: "workforce_metadata" as const,
    state: {
      kind: "upsert" as const,
      stateSchemaId: "core:inbox-v2.role-head",
      stateSchemaVersion: "v1",
      stateHash: hashA,
      payloadReference: payloadReference("role-head:role-1"),
      domainCommitReference: payloadReference("domain-commit:role-1")
    }
  };
}

function authorizationEvent(
  decision: ReturnType<typeof authorizationDecision>,
  changeId: string
) {
  return {
    id: "event:event-1",
    typeId: "core:authorization.changed" as const,
    payloadSchemaId: "core:inbox-v2.authorization-change",
    payloadSchemaVersion: "v1",
    ordinal: "1",
    changeIds: [changeId],
    subjects: [
      { tenantId, entityTypeId: "core:role", entityId: "role:role-1" }
    ],
    payloadReference: null,
    correlationId: "correlation:correlation-1",
    commandIds: ["command:command-1"],
    clientMutationIds: ["mutation:mutation-1"],
    authorizationDecisionRefs: [decision],
    accessEffect: {
      kind: "may_change_access" as const,
      causes: ["rbac_or_direct_grant" as const]
    },
    occurredAt,
    recordedAt: occurredAt,
    eventHash: hashA
  };
}

function projectionIntent(changeId: string) {
  return {
    id: "outbox-intent:projection-1",
    ordinal: 1,
    typeId: "core:projection.update" as const,
    handlerId: "core:authorization-projection",
    effectClass: "projection" as const,
    eventId: "event:event-1",
    changeIds: [changeId],
    payloadReference: null,
    consumerDedupeKey: hashB,
    correlationId: "correlation:correlation-1",
    availableAt: occurredAt,
    intentHash: hashB
  };
}

function authorizationAudit(
  decision: ReturnType<typeof authorizationDecision>
) {
  return {
    id: "authorization-audit:audit-1",
    actionId: "core:authorization.role_definition",
    target: { tenantId, entityTypeId: "core:role", entityId: internalRoleId },
    reasonCodeId: "core:role-definition-changed",
    matchedPermissionIds: ["core:roles.define"],
    grantSourceIds: [`internal-ref:${"3".repeat(32)}`],
    authorizationScopeIds: ["core:permission-scope.tenant"],
    overrideReasonCodeId: null,
    policyVersion: "v1",
    evidenceReference: payloadReference("authorization-evidence:evidence-1"),
    authorizationDecisionRefs: [decision],
    correlationId: "correlation:correlation-1",
    outcome: "succeeded" as const,
    revisionDeltaHash: hashA,
    previousAuditHash: null,
    auditHash: hashB,
    occurredAt,
    recordedAt: occurredAt,
    expiresAt,
    facets: [
      {
        ordinal: 1,
        dimension: "tenant" as const,
        reference: {
          tenantId,
          entityTypeId: "core:tenant",
          entityId: internalTenantId
        },
        relation: "affected" as const,
        facetHash: hashA
      }
    ]
  };
}

function tenantRbacAudience() {
  return {
    kind: "tenant_rbac" as const,
    impactId: "audience-impact:tenant-rbac-1",
    deliveryFence: "invalidate_before_payload" as const,
    previousTenantRbacRevision: "7",
    resultingTenantRbacRevision: "8",
    invalidations: [
      { kind: "projection" as const, projectionId: "core:authorization" }
    ],
    indexedFanoutPlanId: "audience-impact:tenant-rbac-plan-1"
  };
}

function structuralAudience() {
  return {
    kind: "structural" as const,
    impactId: "audience-impact:structural-1",
    deliveryFence: "invalidate_before_payload" as const,
    previousSharedAccessRevision: "2",
    resultingSharedAccessRevision: "3",
    invalidations: [
      { kind: "projection" as const, projectionId: "core:authorization" }
    ],
    indexedFanoutPlanId: "audience-impact:structural-plan-1"
  };
}

function directAudience(employeeIds: readonly string[]) {
  return {
    kind: "direct" as const,
    impactId: "audience-impact:direct-1",
    deliveryFence: "invalidate_before_payload" as const,
    affectedRecipients: employeeIds.map((id) => ({
      employee: { tenantId, kind: "employee" as const, id },
      relation: "resulting" as const,
      previousAuthorizationEpoch: "authorization:epoch-0",
      resultingAuthorizationEpoch: "authorization:epoch-1",
      invalidations: [{ kind: "recipient_scope" as const }],
      authorizationDecisionRefs: [authorizationDecision()]
    }))
  };
}

function relationWrite(relationId: string) {
  return {
    id: "authorization-relation-write:write-1",
    ordinal: 1,
    relationId,
    previousRevision: null,
    resultingRevision: "1"
  };
}

function structuralResourceRow(): Record<string, unknown> {
  return {
    head_id: "authorization-resource:conversation-1",
    resource_kind: "conversation",
    resource_id: "conversation:conversation-1",
    work_item_cycle: null,
    resource_access_revision: "4",
    structural_relation_revision: "1",
    collaborator_set_revision: "3",
    revision: "2"
  };
}

function rolePermissionRow(
  permissionId = "core:roles.define",
  permissionOrdinal = 1,
  permissionCount = 1
): Record<string, unknown> {
  return {
    ordinal: "1",
    role_id: "role:role-1",
    role_revision: "1",
    permission_count: String(permissionCount),
    permission_ordinal: String(permissionOrdinal),
    permission_id: permissionId
  };
}

function currentRolePermissionRow(
  permissionId: string,
  permissionOrdinal = 1,
  permissionCount = 1
): Record<string, unknown> {
  return {
    role_id: "role:role-1",
    role_revision: "1",
    permission_count: String(permissionCount),
    permission_ordinal: String(permissionOrdinal),
    permission_id: permissionId
  };
}

function roleBindingRow(
  options: Readonly<{
    bindingId?: string;
    roleId?: string;
    state?: "active" | "revoked" | "archived";
    scopeKind?:
      | "tenant"
      | "org_unit"
      | "team"
      | "queue"
      | "client"
      | "conversation"
      | "work_item"
      | "source_account"
      | "responsible"
      | "collaborator"
      | "internal_participant"
      | "client_owner";
    scopeId?: string;
    validFrom?: string;
    validUntil?: string | null;
    revokedAt?: string | null;
  }> = {}
): Record<string, unknown> {
  const scopeKind = options.scopeKind ?? "tenant";
  const scopeId = options.scopeId ?? null;
  return {
    ordinal: "1",
    binding_id: options.bindingId ?? "role-binding:binding-1",
    binding_revision: "1",
    role_id: options.roleId ?? "role:role-1",
    state: options.state ?? "active",
    valid_from: options.validFrom ?? occurredAt,
    valid_until: options.validUntil ?? null,
    revoked_at: options.revokedAt ?? null,
    scope_kind: scopeKind,
    scope_org_unit_mode: scopeKind === "org_unit" ? "exact" : null,
    scope_org_unit_id: scopeKind === "org_unit" ? scopeId : null,
    scope_team_id: scopeKind === "team" ? scopeId : null,
    scope_work_queue_id: scopeKind === "queue" ? scopeId : null,
    scope_client_id: scopeKind === "client" ? scopeId : null,
    scope_conversation_id: scopeKind === "conversation" ? scopeId : null,
    scope_work_item_id: scopeKind === "work_item" ? scopeId : null,
    scope_source_account_id: scopeKind === "source_account" ? scopeId : null
  };
}

async function expectInvalidBeforeTransaction(
  input: WithPrivilegedAuthorizationMutationInput,
  message?: string
): Promise<void> {
  const executor = new RoutingAuthorizationExecutor();
  const promise = createSqlInboxV2AuthorizationRepository(
    executor
  ).withPrivilegedAuthorizationMutation(input, async () => {
    throw new Error("must not run");
  });
  if (message === undefined) {
    await expect(promise).rejects.toBeDefined();
  } else {
    await expect(promise).rejects.toThrow(message);
  }
  expect(executor.transactionCount).toBe(0);
  expect(executor.queries).toEqual([]);
}

function statementKind(statement: string): string {
  if (statement.startsWith("insert into inbox_v2_auth_command_records"))
    return "claim_command";
  if (
    statement.includes("from inbox_v2_auth_command_records command") &&
    statement.includes("command.command_type_id")
  )
    return "replay_by_scope";
  if (statement.includes("from inbox_v2_auth_command_records command"))
    return "replay_by_id";
  if (
    statement.includes("from inbox_v2_auth_tenant_heads") &&
    statement.includes("for update")
  )
    return "lock_tenant_head";
  if (
    statement.includes("inbox_v2_auth_employee_heads head") &&
    statement.includes("for update")
  )
    return "lock_employee_heads";
  if (
    statement.includes("inner join inbox_v2_work_items work_item") &&
    statement.includes("work_item.collaborator_set_revision")
  )
    return "lock_work_item_heads";
  if (
    statement.includes("inbox_v2_auth_resource_heads head") &&
    statement.includes("for update")
  )
    return "lock_resource_heads";
  if (
    statement.includes(
      "inbox_v2_auth_role_version_permissions permission_row"
    ) &&
    statement.includes("version_row.mutation_id")
  )
    return "read_persisted_role_permissions";
  if (
    statement.includes("inbox_v2_auth_role_binding_heads head_row") &&
    !statement.includes("version_row.mutation_id")
  )
    return "read_current_role_bindings";
  if (
    statement.includes("inbox_v2_auth_role_binding_versions version_row") &&
    statement.includes("version_row.mutation_id")
  )
    return "read_persisted_role_bindings";
  if (
    statement.includes(
      "inbox_v2_auth_role_version_permissions permission_row"
    ) &&
    !statement.includes("version_row.mutation_id")
  )
    return "read_current_role_permissions";
  if (
    statement.includes("from requested") &&
    statement.includes("version_row.mutation_id") &&
    statement.includes("as target_employee_id")
  )
    return "read_relation_write_targets";
  if (
    statement.includes("from inbox_v2_tenant_stream_heads") &&
    statement.includes("for update")
  )
    return "lock_stream_head";
  if (statement === "select clock_timestamp() as database_now")
    return "decision_time_fence";
  if (statement.startsWith("insert into inbox_v2_tenant_stream_commits"))
    return "insert_stream_commit";
  if (statement.includes("insert into inbox_v2_tenant_stream_changes"))
    return "insert_stream_changes";
  if (statement.includes("insert into inbox_v2_domain_events"))
    return "insert_domain_events";
  if (statement.includes("insert into inbox_v2_outbox_intents"))
    return "insert_outbox_intents";
  if (statement.startsWith("update inbox_v2_auth_command_records command"))
    return "complete_command";
  if (statement.startsWith("insert into inbox_v2_auth_audit_events"))
    return "insert_audit";
  if (statement.includes("insert into inbox_v2_auth_audit_facets"))
    return "insert_audit_facets";
  if (statement.startsWith("insert into inbox_v2_auth_mutation_commits"))
    return "insert_mutation_commit";
  if (statement.includes("insert into inbox_v2_auth_revision_effects"))
    return "insert_revision_effects";
  if (statement.includes("insert into inbox_v2_auth_relation_writes"))
    return "insert_relation_writes";
  if (statement.startsWith("update inbox_v2_tenant_stream_heads"))
    return "advance_stream_head";
  if (statement.startsWith("update inbox_v2_auth_tenant_heads"))
    return "advance_tenant_head";
  if (statement.includes("update inbox_v2_auth_employee_heads"))
    return "advance_employee_heads";
  if (statement.includes("update inbox_v2_auth_resource_heads"))
    return "advance_resource_heads";
  if (statement.startsWith("insert into inbox_v2_auth_tenant_heads"))
    return "ensure_tenant_head";
  if (statement.includes("insert into inbox_v2_auth_employee_heads"))
    return "ensure_employee_heads";
  if (statement.includes("insert into inbox_v2_auth_resource_heads"))
    return "ensure_resource_heads";
  if (statement.startsWith("insert into inbox_v2_tenant_stream_heads"))
    return "ensure_stream_head";
  return "other";
}

function expectInOrder(actual: readonly string[], expected: readonly string[]) {
  let previous = -1;
  for (const item of expected) {
    const index = actual.indexOf(item);
    expect(index, `${item} missing from ${actual.join(", ")}`).toBeGreaterThan(
      previous
    );
    previous = index;
  }
}

function sqlStateError(code: string, nested: boolean): Error {
  const databaseError = Object.assign(new Error(`SQLSTATE ${code}`), { code });
  return nested
    ? Object.assign(new Error("database operation failed"), {
        cause: databaseError
      })
    : databaseError;
}

function renderQuery(query: SQL) {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
