import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  calculateInboxV2OutboundDispatchContentPlanDigest,
  calculateInboxV2OutboxLeaseTokenHash,
  createInboxV2MixedProviderArtifactOutcomeDiagnostic,
  deriveInboxV2OutboundDispatchArtifactId,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2EntityRevisionSchema,
  inboxV2OutboxIntentSchema,
  inboxV2OutboxLeaseTokenSchema,
  inboxV2OutboxWorkerIdSchema,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchRerouteCommitSchema,
  inboxV2OutboundDispatchRouteFailureCommitSchema,
  inboxV2OutboundDispatchSchema,
  materializeInboxV2OutboundRouteResolutionCommit,
  resolveInboxV2OutboundRoute,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2OutboundRouteResolutionCommit
} from "@hulee/contracts";

import {
  buildCompareAndSwapInboxV2OutboundDispatchAttemptSql,
  buildCompareAndSwapInboxV2OutboundDispatchSql,
  buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql,
  buildCheckInboxV2ArtifactRetrySafetySql,
  buildFindInboxV2ExternalMessageReferenceSql,
  buildFindInboxV2OutboundDispatchSql,
  buildInsertInboxV2ExternalMessageReferenceSql,
  buildInsertInboxV2OutboundDispatchArtifactReferenceLinkSql,
  buildInsertInboxV2OutboundDispatchArtifactSql,
  buildInsertInboxV2OutboundDispatchAttemptSql,
  buildInsertInboxV2OutboundDispatchReconciliationDecisionSql,
  buildInsertInboxV2OutboundDispatchSql,
  buildInsertInboxV2OutboundMultiSendOperationSql,
  buildInsertInboxV2OutboundRouteSql,
  buildInsertInboxV2SourceOccurrenceResolutionTransitionSql,
  buildInsertInboxV2ThreadRoutePolicyVersionSql,
  buildListInboxV2MessageDispatchesSql,
  buildValidateInboxV2ProviderOpenContentPlanSql,
  computeInboxV2ExternalMessageKeyDigest,
  createSqlInboxV2OutboundTransportRepository,
  persistInboxV2ExplicitRerouteResolutionInTransaction,
  persistInboxV2RouteResolutionInTransaction,
  type InboxV2OutboundTransportTransactionExecutor
} from "./sql-inbox-v2-outbound-transport-repository";
import {
  createSqlInboxV2AuthorizedCommandCoordinator,
  type InboxV2AuthorizationTransactionExecutor,
  type InboxV2AuthorizedCommandMutationContext,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import {
  createOutboundTransportContractFixture,
  OUTBOUND_TEST_TIMES
} from "./sql-inbox-v2-outbound-transport-repository.test-support";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const fixture = createOutboundTransportContractFixture();
const authorizedRouteFixture = createOutboundTransportContractFixture({
  suffix: "authorized-route",
  operationId: "core:message.send",
  requiredPermissionId: "core:message.reply_external"
});
const wrongOperationRouteFixture = createOutboundTransportContractFixture({
  suffix: "wrong-operation-route",
  operationId: "core:reply",
  requiredPermissionId: "core:message.reply_external"
});
const wrongPermissionRouteFixture = createOutboundTransportContractFixture({
  suffix: "wrong-permission-route",
  operationId: "core:message.send",
  requiredPermissionId: "core:message.read"
});

function safeRetryOpenAttempt() {
  const attemptReference = {
    tenantId: fixture.tenantId,
    kind: "outbound_dispatch_attempt" as const,
    id: "outbound_dispatch_attempt:db-transport-retry"
  };
  const attempt = inboxV2OutboundDispatchAttemptSchema.parse({
    ...fixture.pendingAttempt,
    id: attemptReference.id,
    attemptNumber: 2,
    claimToken: "claim:db-transport-retry",
    leaseExpiresAt: "2026-07-14T08:20:00.000Z",
    openedAt: OUTBOUND_TEST_TIMES.retryAt,
    retrySafety: fixture.pendingAttempt.retrySafety
  });
  const dispatchAfter = inboxV2OutboundDispatchSchema.parse({
    ...fixture.reconciledDispatch,
    state: "attempting",
    attemptCount: 2,
    activeAttempt: attemptReference,
    lastAttempt: attemptReference,
    retryAuthorization: null,
    revision: "5",
    updatedAt: OUTBOUND_TEST_TIMES.retryAt
  });
  const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
    kind: "open_attempt",
    tenantId: fixture.tenantId,
    routeSnapshot: fixture.route,
    bindingHeadSnapshot: fixture.bindingHeadSnapshot,
    dispatchBefore: fixture.reconciledDispatch,
    priorAttempt: fixture.unknownAttempt,
    retryAuthorizationDecision: fixture.reconciliationDecision,
    attempt,
    dispatchAfter
  });
  if (commit.kind !== "open_attempt") throw new Error("Expected open attempt");
  return commit;
}

describe("SQL Inbox V2 outbound transport repository", () => {
  it("matches the PostgreSQL external-message digest for opaque backslashes", () => {
    const reference =
      fixture.echoAssociation.occurrenceResolution.resolvedReference;
    if (reference === null) {
      throw new Error("Echo association fixture must contain a reference.");
    }

    expect(
      computeInboxV2ExternalMessageKeyDigest({
        ...reference.key,
        canonicalExternalSubject: "Message\\ABC"
      })
    ).toBe("b26ca1ee19679278baca409649fdcc45d38a88e9e9baf983cf430675d280375c");
  });

  it("persists a versioned route policy and a fully immutable route snapshot", async () => {
    const preferredAnchor = {
      binding_id: fixture.references.binding.id,
      external_thread_id: fixture.references.externalThread.id,
      source_connection_id: fixture.references.sourceConnection.id,
      source_account_id: fixture.references.sourceAccount.id
    };
    const policyQuery = renderQuery(
      buildInsertInboxV2ThreadRoutePolicyVersionSql({
        policy: fixture.routePolicyWithFallback,
        preferredAnchor,
        fallbackDigest: "f".repeat(64)
      })
    );
    const routeQuery = renderQuery(
      buildInsertInboxV2OutboundRouteSql(
        fixture.route,
        bindingFenceRow(fixture)
      )
    );

    expect(normalizeSql(policyQuery.sql)).toContain(
      "insert into inbox_v2_thread_route_policy_versions"
    );
    expect(policyQuery.params).toEqual(
      expect.arrayContaining([
        fixture.tenantId,
        fixture.routePolicyWithFallback.id,
        fixture.references.binding.id,
        "f".repeat(64)
      ])
    );
    expect(normalizeSql(policyQuery.sql)).toContain(
      "on conflict (tenant_id, policy_id, revision) do nothing"
    );

    expect(normalizeSql(routeQuery.sql)).toContain(
      "insert into inbox_v2_outbound_routes"
    );
    expect(normalizeSql(routeQuery.sql)).toContain("selection_intent_snapshot");
    expect(routeQuery.params).toEqual(
      expect.arrayContaining([
        fixture.route.id,
        fixture.route.selection.intent.kind,
        JSON.stringify(fixture.route.selection.intent),
        fixture.route.mutationToken,
        fixture.route.idempotencyToken
      ])
    );
    expect(normalizeSql(routeQuery.sql)).toContain("on conflict do nothing");
    expect(normalizeSql(routeQuery.sql)).not.toContain("on conflict do update");

    const executor = new QueueOutboundExecutor([
      [],
      [],
      [{ id: fixture.routePolicy.id }],
      [{ id: fixture.routePolicy.id }],
      [bindingFenceRow(fixture)],
      [{ id: fixture.route.id }]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).persistRouteResolution(fixture.routeCommit)
    ).resolves.toEqual({ kind: "committed", route: fixture.route });
    expect(executor.statementKinds()).toEqual([
      "lock_policy_advisory",
      "preflight_policy_head",
      "insert_policy",
      "advance_policy_head",
      "lock_binding_fence",
      "insert_route"
    ]);
    const bindingFenceQuery = executor.queries.find(
      ({ sql }) => classifyStatement(sql) === "lock_binding_fence"
    );
    expect(normalizeSql(bindingFenceQuery?.sql ?? "")).toContain(
      "head.revision as binding_revision"
    );
    expect(normalizeSql(bindingFenceQuery?.sql ?? "")).not.toContain(
      "head.binding_revision"
    );
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "read committed" }
    ]);
  });

  it("keeps temporary runtime health outside immutable route persistence", async () => {
    const unavailableFence = {
      ...bindingFenceRow(fixture),
      runtime_health_state: "unavailable",
      runtime_health_revision: "2"
    };
    const executor = new QueueOutboundExecutor([
      [],
      [],
      [{ id: fixture.routePolicy.id }],
      [{ id: fixture.routePolicy.id }],
      [unavailableFence],
      [{ id: fixture.route.id }]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).persistRouteResolution(fixture.routeCommit)
    ).resolves.toEqual({ kind: "committed", route: fixture.route });
    expect(executor.statementKinds()).toContain("insert_route");
  });

  it("requires a live authorized context for caller-owned route materialization", async () => {
    const executor = new QueueOutboundExecutor([
      [],
      [],
      [{ id: fixture.routePolicy.id }],
      [{ id: fixture.routePolicy.id }],
      [bindingFenceRow(fixture)],
      [{ id: fixture.route.id }]
    ]);

    await expect(
      persistInboxV2RouteResolutionInTransaction(
        executor as never,
        fixture.routeCommit
      )
    ).rejects.toThrow(/live authorized-command context/iu);
    expect(executor.queries).toHaveLength(0);

    const conflictExecutor = new QueueOutboundExecutor([
      [],
      [],
      [{ id: fixture.routePolicy.id }],
      [{ id: fixture.routePolicy.id }],
      []
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(
        conflictExecutor
      ).persistRouteResolution(fixture.routeCommit)
    ).resolves.toEqual({ kind: "binding_not_found" });
    expect(conflictExecutor.transactionConfigs).toEqual([
      { isolationLevel: "read committed" }
    ]);
  });

  it.each([
    ["cross-tenant", { tenantId: "tenant:outbound-other" }],
    ["wrong actor", { employeeId: "employee:outbound-other" }],
    [
      "wrong authorization epoch",
      { authorizationEpoch: "authorization:outbound-other" }
    ],
    [
      "wrong command occurrence time",
      { occurredAt: "2026-07-14T08:01:01.000Z" }
    ],
    ["wrong command", { commandTypeId: "core:message.edit" }],
    [
      "reroute command on a normal send",
      { commandTypeId: "core:source.dispatch.reroute" }
    ],
    [
      "wrong Conversation resource",
      { conversationId: "conversation:outbound-other" }
    ],
    ["wrong permission", { permissionId: "core:message.read" }],
    [
      "wrong Conversation resource scope",
      { conversationResourceScopeId: "core:permission-scope.tenant" }
    ],
    ["missing source-account decision", { sourceAccountDecision: "missing" }],
    [
      "wrong source-account permission",
      { sourceAccountDecision: "wrong_permission" }
    ],
    [
      "wrong SourceAccount resource",
      { sourceAccountDecision: "wrong_resource" }
    ]
  ] as const)(
    "rejects a live route context with %s before the public seam issues SQL",
    async (_case, overrides) => {
      const input = authorizedRouteContextInput(overrides);
      await expectRouteContextRejectedBeforeSql(
        input,
        authorizedRouteFixture.routeCommit,
        "atomic"
      );
    }
  );

  it("rejects a source-account decision without its revision fence before any SQL", async () => {
    const input = authorizedRouteContextInput({
      omitSourceAccountResourceFence: true
    });
    const executor = new RouteAuthorizationContextExecutor(input);
    const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(executor);

    await expect(
      coordinator.withAuthorizedAtomicMaterialization(
        input,
        async () => ({ kind: "prepared" as const }),
        async () => {
          throw new Error("route authorization unexpectedly reached seal");
        }
      )
    ).rejects.toThrow(
      "Privileged command must fence every authorization-decision resource revision."
    );
    expect(executor.queries).toEqual([]);
  });

  it.each(["conversation", "source_account"] as const)(
    "rejects a caller-forged %s authorization snapshot before route SQL",
    async (authorizationKind) => {
      await expectRouteContextRejectedBeforeSql(
        authorizedRouteContextInput(),
        withAdditionalRouteAuthorizationPermission(
          authorizedRouteFixture.routeCommit,
          authorizationKind
        ),
        "atomic"
      );
    }
  );

  it("rejects a reroute command whose primary decision is still Conversation reply", async () => {
    const reroute = explicitRerouteFixture({
      authorizationFailure: "wrong_primary"
    });

    await expect(probeAuthorizedReroute(reroute)).rejects.toThrow(
      /authorized message-send context/iu
    );
    expect(reroute.executor.routeStatementKinds()).toEqual([]);
  });

  it.each([
    ["conversation", "decision_revision"],
    ["conversation", "decided_at"],
    ["conversation", "not_after"],
    ["source_account", "decision_revision"],
    ["source_account", "decided_at"],
    ["source_account", "not_after"]
  ] as const)(
    "rejects a %s decision with a snapshot-mismatched %s before route SQL",
    async (decisionKind, mismatch) => {
      await expectRouteContextRejectedBeforeSql(
        authorizedRouteContextInput(
          decisionKind === "conversation"
            ? { conversationDecisionMismatch: mismatch }
            : { sourceAccountDecisionMismatch: mismatch }
        ),
        authorizedRouteFixture.routeCommit,
        "atomic"
      );
    }
  );

  it("rejects an ordinary authorized-command context before route SQL", async () => {
    await expectRouteContextRejectedBeforeSql(
      authorizedRouteContextInput(),
      authorizedRouteFixture.routeCommit,
      "ordinary"
    );
  });

  it.each(["wrong operation", "caller-selected permission"] as const)(
    "rejects a route commit with %s even when its authorization proof agrees",
    async (kind) => {
      const callerSelectedPermission = kind === "caller-selected permission";
      await expectRouteContextRejectedBeforeSql(
        authorizedRouteContextInput(
          callerSelectedPermission
            ? { permissionId: "core:message.read" }
            : undefined
        ),
        callerSelectedPermission
          ? wrongPermissionRouteFixture.routeCommit
          : wrongOperationRouteFixture.routeCommit,
        "atomic"
      );
    }
  );

  it("rejects explicit reroute through the non-authorized repository seam", async () => {
    const reroute = explicitRerouteFixture();
    const executor = new QueueOutboundExecutor([]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).persistRouteResolution(reroute.commit)
    ).rejects.toThrow(
      /explicit reroute.*authorized context and cancellation commit/iu
    );
    expect(executor.queries).toEqual([]);
  });

  it.each([false, true] as const)(
    "locks the original dispatch and only the replacement binding for same-account=%s",
    async (sameSourceAccount) => {
      const reroute = explicitRerouteFixture({ sameSourceAccount });
      const probe = await probeAuthorizedReroute(reroute);

      expect(probe.result).toEqual({
        kind: "committed",
        route: reroute.commit.route
      });
      expect(probe.executor.routeStatementKinds()).toEqual([
        "preflight_policy_head",
        "lock_policy_version",
        "lock_dispatch",
        "lock_reroute_attempts",
        "lock_reroute_provider_intent",
        "lock_reroute_original_route",
        "lock_binding_fence",
        "insert_route",
        "cas_dispatch"
      ]);
      const bindingLock = probe.executor.queries.find(
        ({ sql }) => classifyStatement(sql) === "lock_binding_fence"
      );
      expect(normalizeSql(bindingLock?.sql ?? "")).toContain(
        "head.binding_id ="
      );
      expect(bindingLock?.params).toContain(
        reroute.commit.route!.sourceThreadBinding.id
      );
      expect(bindingLock?.params).not.toContain(
        reroute.originalRoute.binding_id
      );
    }
  );

  it.each([
    ["missing old-account use", "missing_original_use"],
    ["duplicate new-account use", "duplicate_selected_use"]
  ] as const)(
    "rejects explicit reroute authorization with %s before binding locks",
    async (_label, authorizationFailure) => {
      const reroute = explicitRerouteFixture({ authorizationFailure });
      const probe = probeAuthorizedReroute(reroute);

      await expect(probe).rejects.toThrow(
        /authorized explicit-reroute context/iu
      );
      const executor = reroute.executor;
      expect(executor.routeStatementKinds()).toEqual([
        "preflight_policy_head",
        "lock_policy_version",
        "lock_dispatch",
        "lock_reroute_attempts",
        "lock_reroute_provider_intent",
        "lock_reroute_original_route"
      ]);
    }
  );

  it("rejects an explicit reroute without its primary reroute decision before SQL", async () => {
    const reroute = explicitRerouteFixture({
      authorizationFailure: "missing_reroute"
    });

    await expect(probeAuthorizedReroute(reroute)).rejects.toThrow(
      /authorized message-send context/iu
    );
    expect(reroute.executor.routeStatementKinds()).toEqual([]);
  });

  it.each([
    ["provider open wins", "original_fence", "original_dispatch_conflict"],
    ["replacement admin disable", "selected_admin", "binding_fence_conflict"]
  ] as const)(
    "fails closed on %s without inserting a reroute",
    async (_label, drift, expectedKind) => {
      const reroute = explicitRerouteFixture({ drift });
      const probe = await probeAuthorizedReroute(reroute);

      expect(probe.result).toEqual({ kind: expectedKind });
      expect(probe.executor.routeStatementKinds()).not.toContain(
        "insert_route"
      );
      expect(probe.executor.routeStatementKinds()).not.toContain(
        "cas_dispatch"
      );
    }
  );

  it("allows reroute when only the original binding is now disabled", async () => {
    const reroute = explicitRerouteFixture({ drift: "original_admin" });

    await expect(probeAuthorizedReroute(reroute)).resolves.toMatchObject({
      result: { kind: "committed" }
    });
  });

  it("creates one queued dispatch only after locking its message and route", async () => {
    const query = renderQuery(
      buildInsertInboxV2OutboundDispatchSql({
        dispatch: fixture.queuedDispatch,
        conversationId: fixture.references.conversation.id,
        timelineItemId: fixture.references.timelineItem.id
      })
    );
    expect(normalizeSql(query.sql)).toContain(
      "insert into inbox_v2_outbound_dispatches"
    );
    expect(query.params).toEqual(
      expect.arrayContaining([
        fixture.tenantId,
        fixture.queuedDispatch.id,
        "queued",
        0
      ])
    );
    expect(normalizeSql(query.sql)).toContain("on conflict do nothing");

    const executor = new QueueOutboundExecutor([
      [
        {
          conversation_id: fixture.references.conversation.id,
          timeline_item_id: fixture.references.timelineItem.id
        }
      ],
      [{ conversation_id: fixture.references.conversation.id }],
      [{ id: fixture.queuedDispatch.id }]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).createDispatch(
        fixture.queuedDispatch
      )
    ).resolves.toEqual({
      kind: "committed",
      dispatch: fixture.queuedDispatch
    });
    expect(executor.statementKinds()).toEqual([
      "lock_message",
      "lock_route",
      "insert_dispatch"
    ]);
  });

  it("recovers current dispatches with strict tenant predicates and stable keyset paging", async () => {
    const findQuery = renderQuery(
      buildFindInboxV2OutboundDispatchSql({
        tenantId: fixture.queuedDispatch.tenantId,
        dispatchId: fixture.queuedDispatch.id
      })
    );
    expect(normalizeSql(findQuery.sql)).toContain(
      "where dispatch_row.tenant_id = $1 and dispatch_row.id = $2"
    );
    expect(findQuery.params).toEqual([
      fixture.tenantId,
      fixture.queuedDispatch.id
    ]);

    const after = {
      createdAt: fixture.queuedDispatch.createdAt,
      dispatchId: fixture.queuedDispatch.id
    };
    const pageQuery = renderQuery(
      buildListInboxV2MessageDispatchesSql({
        tenantId: fixture.queuedDispatch.tenantId,
        messageId: fixture.queuedDispatch.message.id,
        after,
        limit: 2
      })
    );
    const normalizedPageSql = normalizeSql(pageQuery.sql);
    expect(normalizedPageSql).toContain(
      "where dispatch_row.tenant_id = $1 and dispatch_row.message_id = $2"
    );
    expect(normalizedPageSql).toContain("dispatch_row.created_at > $");
    expect(normalizedPageSql).toContain('dispatch_row.id collate "c" > $');
    expect(normalizedPageSql).toContain(
      'order by dispatch_row.created_at asc, dispatch_row.id collate "c" asc'
    );
    expect(normalizedPageSql).toContain("limit $");

    const findExecutor = new QueueOutboundExecutor([
      [dispatchRow(fixture.queuedDispatch)]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(findExecutor).findDispatch({
        tenantId: fixture.queuedDispatch.tenantId,
        dispatchId: fixture.queuedDispatch.id
      })
    ).resolves.toEqual(fixture.queuedDispatch);
    expect(findExecutor.transactionConfigs).toEqual([
      { isolationLevel: "repeatable read" }
    ]);

    const secondRow = {
      ...dispatchRow(fixture.queuedDispatch),
      id: `outbound_dispatch:page-two-${fixture.suffix}`,
      created_at: "2026-07-14T08:01:30.000Z",
      updated_at: "2026-07-14T08:01:30.000Z"
    };
    const pageExecutor = new QueueOutboundExecutor([
      [dispatchRow(fixture.queuedDispatch), secondRow]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(
        pageExecutor
      ).listMessageDispatches({
        tenantId: fixture.queuedDispatch.tenantId,
        messageId: fixture.queuedDispatch.message.id,
        limit: 1
      })
    ).resolves.toEqual({
      tenantId: fixture.tenantId,
      messageId: fixture.references.message.id,
      items: [fixture.queuedDispatch],
      nextAfter: {
        createdAt: fixture.queuedDispatch.createdAt,
        dispatchId: fixture.queuedDispatch.id
      },
      hasMore: true
    });
    expect(pageExecutor.transactionConfigs).toEqual([
      { isolationLevel: "repeatable read" }
    ]);
  });

  it("recovers one exact external message reference without crossing tenants", async () => {
    const expected =
      fixture.echoAssociation.occurrenceResolution.resolvedReference;
    if (expected === null) {
      throw new Error("Echo association fixture must contain a reference.");
    }
    const query = renderQuery(
      buildFindInboxV2ExternalMessageReferenceSql({
        tenantId: expected.tenantId,
        referenceId: expected.id
      })
    );
    const normalizedSql = normalizeSql(query.sql);
    expect(normalizedSql).toContain(
      "where reference_row.tenant_id = $1 and reference_row.id = $2"
    );
    expect(normalizedSql).not.toContain("message_key_digest_sha256 =");
    expect(normalizedSql).not.toContain("for share");
    expect(query.params).toEqual([expected.tenantId, expected.id]);

    const executor = new QueueOutboundExecutor([
      [externalMessageReferenceRow(expected)]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).findExternalMessageReference({
        tenantId: expected.tenantId,
        referenceId: expected.id
      })
    ).resolves.toEqual(expected);
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "repeatable read" }
    ]);

    const foreignFixture = createOutboundTransportContractFixture({
      tenantId: "tenant:outbound-foreign",
      suffix: "foreign"
    });
    const foreignExecutor = new QueueOutboundExecutor([[]]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(
        foreignExecutor
      ).findExternalMessageReference({
        tenantId: foreignFixture.queuedDispatch.tenantId,
        referenceId: expected.id
      })
    ).resolves.toBeNull();
    expect(foreignExecutor.queries[0]?.params).toEqual([
      foreignFixture.queuedDispatch.tenantId,
      expected.id
    ]);
  });

  it("durably opens the attempt and advances the dispatch CAS before provider I/O", async () => {
    const attemptInsert = renderQuery(
      buildInsertInboxV2OutboundDispatchAttemptSql(fixture.pendingAttempt)
    );
    const dispatchCas = renderQuery(
      buildCompareAndSwapInboxV2OutboundDispatchSql(
        fixture.queuedDispatch,
        fixture.attemptingDispatch
      )
    );
    expect(normalizeSql(attemptInsert.sql)).toContain(
      "from inbox_v2_outbound_dispatches dispatch_row"
    );
    expect(normalizeSql(attemptInsert.sql)).toContain("outcome_kind");
    expect(attemptInsert.params).toEqual(
      expect.arrayContaining([
        fixture.pendingAttempt.claimToken,
        fixture.pendingAttempt.retrySafety.providerCorrelationToken,
        "pending"
      ])
    );
    expect(normalizeSql(dispatchCas.sql)).toContain("and state = $");
    expect(normalizeSql(dispatchCas.sql)).toContain("and revision = $");

    const executor = new QueueOutboundExecutor([
      [dispatchRow(fixture.queuedDispatch)],
      [{ id: fixture.route.id }],
      [bindingFenceRow(fixture)],
      [{ id: fixture.pendingAttempt.id }],
      [{ id: fixture.queuedDispatch.id }]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttempt(
        fixture.openAttemptCommit
      )
    ).resolves.toEqual({ kind: "committed" });
    expect(executor.statementKinds()).toEqual([
      "lock_dispatch",
      "lock_route",
      "lock_binding_fence",
      "insert_attempt",
      "cas_dispatch"
    ]);
    expect(executor.statementKinds().indexOf("insert_attempt")).toBeLessThan(
      executor.statementKinds().indexOf("cas_dispatch")
    );
  });

  it("allows a retry open only when the prior attempt has no accepted artifact", async () => {
    const commit = safeRetryOpenAttempt();
    const safetyQuery = renderQuery(
      buildCheckInboxV2ArtifactRetrySafetySql({
        tenantId: commit.tenantId,
        dispatchId: commit.dispatchBefore.id,
        attemptId: commit.priorAttempt!.id
      })
    );
    expect(normalizeSql(safetyQuery.sql)).toContain(
      "artifact.state = 'accepted'"
    );

    const executor = new QueueOutboundExecutor([
      [dispatchRow(fixture.reconciledDispatch)],
      [{ id: fixture.route.id }],
      [bindingFenceRow(fixture)],
      [{ retry_safe: true }],
      [{ id: commit.attempt.id }],
      [{ id: commit.dispatchBefore.id }]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttempt(commit)
    ).resolves.toEqual({ kind: "committed" });
    expect(executor.statementKinds()).toEqual([
      "lock_dispatch",
      "lock_route",
      "lock_binding_fence",
      "check_artifact_retry_safety",
      "insert_attempt",
      "cas_dispatch"
    ]);
  });

  it("rejects retry open before provider I/O when the prior attempt has an accepted artifact", async () => {
    const commit = safeRetryOpenAttempt();
    const executor = new QueueOutboundExecutor([
      [dispatchRow(fixture.reconciledDispatch)],
      [{ id: fixture.route.id }],
      [bindingFenceRow(fixture)],
      [{ retry_safe: false }]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttempt(commit)
    ).resolves.toEqual({ kind: "artifact_retry_unsafe" });
    expect(executor.statementKinds()).toEqual([
      "lock_dispatch",
      "lock_route",
      "lock_binding_fence",
      "check_artifact_retry_safety"
    ]);
    expect(executor.statementKinds()).not.toContain("insert_attempt");
  });

  it("rejects a forged same-id route snapshot before opening a provider attempt", async () => {
    const commit = fixture.openAttemptCommit;
    if (commit.kind !== "open_attempt") throw new Error("open attempt fixture");
    const forgedBinding = {
      ...commit.routeSnapshot.sourceThreadBinding,
      id: "source_thread_binding:forged-open-binding"
    };
    const forgedRoute = {
      ...commit.routeSnapshot,
      sourceThreadBinding: forgedBinding,
      conversationAuthorization: {
        ...commit.routeSnapshot.conversationAuthorization,
        target: {
          ...commit.routeSnapshot.conversationAuthorization.target,
          sourceThreadBinding: forgedBinding
        }
      },
      sourceAccountAuthorization: {
        ...commit.routeSnapshot.sourceAccountAuthorization,
        target: {
          ...commit.routeSnapshot.sourceAccountAuthorization.target,
          sourceThreadBinding: forgedBinding
        }
      }
    };
    const forgedCommit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
      ...commit,
      routeSnapshot: forgedRoute,
      bindingHeadSnapshot: {
        ...commit.bindingHeadSnapshot,
        binding: forgedBinding
      }
    });
    const executor = new QueueOutboundExecutor([
      [dispatchRow(fixture.queuedDispatch)],
      []
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttempt(
        forgedCommit
      )
    ).resolves.toEqual({ kind: "route_not_found" });
    expect(executor.statementKinds()).toEqual(["lock_dispatch", "lock_route"]);
    const routeLock = executor.queries[1]!;
    const routeSql = normalizeSql(routeLock.sql);
    expect(routeSql).toContain("route_row.source_thread_binding_id =");
    expect(routeSql).toContain("route_row.adapter_contract_snapshot =");
    expect(routeSql).toContain(
      "route_row.conversation_authorization_snapshot ="
    );
    expect(routeLock.params).toContain(forgedBinding.id);
  });

  it("loads the exact provider intent and dispatch only under its live outbox lease", async () => {
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [dispatchRow(fixture.queuedDispatch)],
      [providerIoContentPlanRow()]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).loadClaimedProviderIo({ outboxLease: providerIoOutboxLeaseFence })
    ).resolves.toEqual({
      kind: "loaded",
      intent: providerIoIntent,
      dispatch: fixture.queuedDispatch,
      contentPlan: providerIoContentPlan
    });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "lock_dispatch",
      "load_dispatch_content_plan"
    ]);
    const leaseLock = executor.queries[0]!;
    expect(normalizeSql(leaseLock.sql)).toContain("for update of work");
    expect(leaseLock.params).not.toContain(providerIoLeaseToken);
  });

  it("fails closed when a claimed dispatch has no immutable content plan", async () => {
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [dispatchRow(fixture.queuedDispatch)],
      []
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).loadClaimedProviderIo({ outboxLease: providerIoOutboxLeaseFence })
    ).resolves.toEqual({ kind: "outbox_dispatch_content_plan_not_found" });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "lock_dispatch",
      "load_dispatch_content_plan"
    ]);
  });

  it("re-fences the outbox lease before opening an attempt", async () => {
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [providerIoContentPlanRow()],
      [dispatchRow(fixture.queuedDispatch)],
      [{ id: fixture.route.id }],
      [bindingFenceRow(fixture)],
      [{ artifact_ordinal: 1 }],
      [{ id: fixture.pendingAttempt.id }],
      [{ id: fixture.queuedDispatch.id }]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttemptFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit: fixture.openAttemptCommit
      })
    ).resolves.toEqual({ kind: "committed" });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "load_dispatch_content_plan",
      "lock_dispatch",
      "lock_route",
      "lock_binding_fence",
      "validate_provider_capabilities",
      "insert_attempt",
      "cas_dispatch"
    ]);
  });

  it("opens when the current binding revision differs from the independent binding generation", async () => {
    const bindingRevision = "17";
    const contentPlan =
      providerIoContentPlanWithBindingRevision(bindingRevision);
    const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
      ...fixture.openAttemptCommit,
      bindingHeadSnapshot: {
        ...fixture.bindingHeadSnapshot,
        bindingRevision
      }
    });
    if (commit.kind !== "open_attempt")
      throw new Error("Expected open attempt");
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [providerIoContentPlanRow(contentPlan)],
      [dispatchRow(fixture.queuedDispatch)],
      [{ id: fixture.route.id }],
      [bindingFenceRow(fixture, commit.bindingHeadSnapshot)],
      [{ artifact_ordinal: 1 }],
      [{ id: fixture.pendingAttempt.id }],
      [{ id: fixture.queuedDispatch.id }]
    ]);

    expect(bindingRevision).not.toBe(
      commit.routeSnapshot.bindingFence.bindingGeneration
    );
    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttemptFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit
      })
    ).resolves.toEqual({ kind: "committed" });
    expect(executor.statementKinds()).toContain(
      "validate_provider_capabilities"
    );
    expect(executor.statementKinds()).toContain("insert_attempt");
  });

  it("rejects a content plan binding revision mismatch before locking transport state", async () => {
    const contentPlan = providerIoContentPlanWithBindingRevision("17");
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [providerIoContentPlanRow(contentPlan)]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttemptFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit: fixture.openAttemptCommit
      })
    ).resolves.toEqual({ kind: "outbox_dispatch_content_plan_conflict" });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "load_dispatch_content_plan"
    ]);
  });

  it("checks every planned artifact against current capability, expiry and provider roles before open", async () => {
    const query = renderQuery(
      buildValidateInboxV2ProviderOpenContentPlanSql({
        contentPlan: providerIoContentPlan,
        route: fixture.route,
        attempt: fixture.pendingAttempt,
        databaseNow: "2026-07-14T08:02:30.000Z",
        bindingRevision: fixture.bindingHeadSnapshot.bindingRevision,
        capabilityRevision: fixture.route.bindingFence.capabilityRevision,
        providerAccessRevision:
          fixture.bindingHeadSnapshot.providerAccessRevision
      })
    );
    const statement = normalizeSql(query.sql);
    expect(statement).toContain("capability.state = 'supported'");
    expect(statement).toContain(
      "capability.content_kind_id is not distinct from"
    );
    expect(statement).toContain("capability.valid_until >");
    expect(statement).toContain(
      "inbox_v2_source_thread_binding_capability_required_roles"
    );
    expect(statement).toContain("provider_role.provider_access_revision =");
    expect(statement).toContain(
      "current_content_fence(content_plan_id) as materialized"
    );
    expect(statement).toContain("join inbox_v2_messages message_row");
    expect(statement).toContain(
      "message_row.revision = plan_row.message_revision"
    );
    expect(statement).toContain("message_row.content_state = 'available'");
    expect(statement).toContain("join inbox_v2_timeline_contents content_row");
    expect(statement).toContain(
      "content_row.revision = message_row.content_revision"
    );
    expect(statement).toContain("content_row.state = 'available'");
    expect(statement).toContain("plan_row.content_fingerprint_purpose_id =");
    expect(statement).toContain(
      "plan_row.content_fingerprint_key_generation ="
    );
    expect(statement).toContain("plan_row.content_fingerprint_valid_until >");
    expect(statement).toContain("plan_row.content_fingerprint_hmac_sha256 =");
    expect(statement).toContain("for share of message_row, content_row");
    expect(statement).toContain("planned_file_pins");
    expect(statement).toContain("valid_file_pins(block_key) as materialized");
    expect(statement).toContain("join inbox_v2_file_objects file_row");
    expect(statement).toContain("file_row.revision = pin.file_revision");
    expect(statement).toContain("file_row.state = 'ready'");
    expect(statement).toContain(
      "file_row.current_file_version_id = pin.file_version_id"
    );
    expect(statement).toContain(
      "file_row.current_object_version_id = pin.object_version_id"
    );
    expect(statement).toContain("join inbox_v2_file_versions file_version_row");
    expect(statement).toContain(
      "join inbox_v2_file_object_versions object_version_row"
    );
    expect(statement).toContain(
      "join inbox_v2_file_object_version_heads object_head_row"
    );
    expect(statement).toContain("object_head_row.state = 'ready'");
    expect(statement).toContain(
      "order by pin.file_id, pin.file_version_id, pin.object_version_id"
    );
    expect(statement).toContain(
      "for share of file_row, file_version_row, object_version_row, object_head_row"
    );
    expect(statement).toContain("for share of capability");
    expect(statement.indexOf("current_content_fence")).toBeLessThan(
      statement.indexOf("valid_file_pins")
    );
    expect(statement).not.toContain(
      "capability.materialized_by_binding_revision ="
    );
    expect(query.params).toEqual(
      expect.arrayContaining([
        providerIoContentPlan.artifacts[0]?.capabilityId,
        providerIoContentPlan.artifacts[0]?.operationId,
        fixture.route.contentKindId,
        BigInt(fixture.bindingHeadSnapshot.providerAccessRevision)
      ])
    );
  });

  it("pins every file-bearing block to its exact logical and physical current heads", () => {
    const pinnedPlan = providerIoContentPlanWithPinnedFile();
    const query = renderQuery(
      buildValidateInboxV2ProviderOpenContentPlanSql({
        contentPlan: pinnedPlan,
        route: fixture.route,
        attempt: fixture.pendingAttempt,
        databaseNow: "2026-07-14T08:02:30.000Z",
        bindingRevision: fixture.bindingHeadSnapshot.bindingRevision,
        capabilityRevision: fixture.route.bindingFence.capabilityRevision,
        providerAccessRevision:
          fixture.bindingHeadSnapshot.providerAccessRevision
      })
    );
    const pin = pinnedPlan.blocks[0]!.exactFileObjectPin!;
    expect(query.params).toEqual(
      expect.arrayContaining([
        pin.file.id,
        BigInt(pin.fileRevision),
        pin.fileVersion.id,
        pin.objectVersion.id
      ])
    );
  });

  it("fails closed before attempt creation when any pinned file head is no longer exact and ready", async () => {
    const pinnedPlan = providerIoContentPlanWithPinnedFile();
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [providerIoContentPlanRow(pinnedPlan)],
      [dispatchRow(fixture.queuedDispatch)],
      [{ id: fixture.route.id }],
      [bindingFenceRow(fixture)],
      []
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttemptFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit: fixture.openAttemptCommit
      })
    ).resolves.toEqual({ kind: "binding_fence_conflict" });
    expect(executor.statementKinds()).not.toContain("insert_attempt");
    expect(executor.statementKinds()).not.toContain("cas_dispatch");
  });

  it("fails closed before provider I/O when a current capability is revoked, expired or lacks a required role", async () => {
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [providerIoContentPlanRow()],
      [dispatchRow(fixture.queuedDispatch)],
      [{ id: fixture.route.id }],
      [bindingFenceRow(fixture)],
      []
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttemptFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit: fixture.openAttemptCommit
      })
    ).resolves.toEqual({ kind: "binding_fence_conflict" });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "load_dispatch_content_plan",
      "lock_dispatch",
      "lock_route",
      "lock_binding_fence",
      "validate_provider_capabilities"
    ]);
    expect(executor.statementKinds()).not.toContain("insert_attempt");
  });

  it.each([
    ["provider access", { provider_access_revision: "2" }],
    ["capability", { capability_revision: "2" }]
  ] as const)(
    "fails closed when the current %s revision drifts after planning",
    async (_axis, drift) => {
      const executor = new QueueOutboundExecutor([
        [providerIoOutboxLeaseRow()],
        [providerIoContentPlanRow()],
        [dispatchRow(fixture.queuedDispatch)],
        [{ id: fixture.route.id }],
        [{ ...bindingFenceRow(fixture), ...drift }]
      ]);
      await expect(
        createSqlInboxV2OutboundTransportRepository(
          executor
        ).applyAttemptFenced({
          outboxLease: providerIoOutboxLeaseFence,
          commit: fixture.openAttemptCommit
        })
      ).resolves.toEqual({ kind: "binding_fence_conflict" });
      expect(executor.statementKinds()).not.toContain("insert_attempt");
      expect(executor.statementKinds()).not.toContain(
        "validate_provider_capabilities"
      );
    }
  );

  it("atomically persists the exact provider artifact set with attempt completion", async () => {
    const commit = acceptedProviderResultCommit();
    const artifact = acceptedProviderResultArtifact();
    const executor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          databaseNow: OUTBOUND_TEST_TIMES.acceptedAt
        })
      ],
      [providerIoContentPlanRow()],
      [],
      [dispatchRow(fixture.attemptingDispatch)],
      [attemptRow(fixture.pendingAttempt)],
      [{ id: fixture.pendingAttempt.id }],
      [{ id: fixture.attemptingDispatch.id }],
      [{ id: artifact.id }]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).applyProviderResultFenced({
        outboxLease: providerIoOutboxLeaseFence,
        contentPlanDigestSha256: providerIoContentPlan.planDigestSha256,
        commit,
        artifacts: [artifact]
      })
    ).resolves.toEqual({ kind: "committed" });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "load_dispatch_content_plan",
      "lock_artifact_set",
      "lock_dispatch",
      "lock_attempt",
      "cas_attempt",
      "cas_dispatch",
      "insert_artifact"
    ]);
  });

  it("accepts only the reconciliation-only aggregate diagnostic for mixed artifact outcomes", async () => {
    const mixed = mixedProviderResultFixture();
    const executor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          databaseNow: OUTBOUND_TEST_TIMES.acceptedAt
        })
      ],
      providerIoContentPlanRows(mixed.contentPlan),
      [],
      [dispatchRow(fixture.attemptingDispatch)],
      [attemptRow(fixture.pendingAttempt)],
      [{ id: fixture.pendingAttempt.id }],
      [{ id: fixture.attemptingDispatch.id }],
      [{ id: mixed.artifacts[0]!.id }],
      [{ id: mixed.artifacts[1]!.id }]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).applyProviderResultFenced({
        outboxLease: providerIoOutboxLeaseFence,
        contentPlanDigestSha256: mixed.contentPlan.planDigestSha256,
        commit: mixed.commit,
        artifacts: mixed.artifacts
      })
    ).resolves.toEqual({ kind: "committed" });

    const retryableArtifactDiagnostic = mixed.artifacts[1]!.diagnostic!;
    const unsafeAggregate = inboxV2OutboundDispatchAttemptCommitSchema.parse({
      ...mixed.commit,
      attemptAfter: {
        ...mixed.commit.attemptAfter,
        outcome: {
          ...mixed.commit.attemptAfter.outcome,
          diagnostic: retryableArtifactDiagnostic,
          requiredAction: "automated_reconciliation_required"
        }
      }
    });
    if (unsafeAggregate.kind !== "complete_attempt") {
      throw new Error("Expected complete attempt");
    }
    const rejectedExecutor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          databaseNow: OUTBOUND_TEST_TIMES.acceptedAt
        })
      ],
      providerIoContentPlanRows(mixed.contentPlan)
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(
        rejectedExecutor
      ).applyProviderResultFenced({
        outboxLease: providerIoOutboxLeaseFence,
        contentPlanDigestSha256: mixed.contentPlan.planDigestSha256,
        commit: unsafeAggregate,
        artifacts: mixed.artifacts
      })
    ).resolves.toEqual({ kind: "outbox_dispatch_content_plan_conflict" });
    expect(rejectedExecutor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "load_dispatch_content_plan"
    ]);
  });

  it("replays an exact completed provider artifact set without another insert", async () => {
    const commit = acceptedProviderResultCommit();
    const artifact = acceptedProviderResultArtifact();
    const contentPlan = providerIoContentPlanWithPinnedFile();
    const executor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          databaseNow: OUTBOUND_TEST_TIMES.acceptedAt
        })
      ],
      [providerIoContentPlanRow(contentPlan)],
      [artifactRow(artifact)],
      [dispatchRow(fixture.acceptedDispatch)],
      [attemptRow(fixture.acceptedAttempt)]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).applyProviderResultFenced({
        outboxLease: providerIoOutboxLeaseFence,
        contentPlanDigestSha256: contentPlan.planDigestSha256,
        commit,
        artifacts: [artifact]
      })
    ).resolves.toEqual({ kind: "already_applied" });
    expect(executor.statementKinds()).not.toContain("insert_artifact");
  });

  it("rejects incomplete provider artifact coverage before attempt mutation", async () => {
    const executor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          databaseNow: OUTBOUND_TEST_TIMES.acceptedAt
        })
      ],
      [providerIoContentPlanRow()]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).applyProviderResultFenced({
        outboxLease: providerIoOutboxLeaseFence,
        contentPlanDigestSha256: providerIoContentPlan.planDigestSha256,
        commit: acceptedProviderResultCommit(),
        artifacts: []
      })
    ).resolves.toEqual({ kind: "outbox_dispatch_content_plan_conflict" });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "load_dispatch_content_plan"
    ]);
  });

  it.each(["structural", "admin_disabled", "runtime"] as const)(
    "applies a %s zero-I/O route failure only under its exact outbox and binding fences",
    async (kind) => {
      const commit = routeFailureCommit(kind);
      const executor = new QueueOutboundExecutor([
        [providerIoOutboxLeaseRow()],
        [dispatchRow(fixture.queuedDispatch)],
        [{ id: fixture.route.id }],
        [bindingFenceRow(fixture, commit.bindingHeadSnapshot)],
        ...(kind === "runtime"
          ? []
          : [
              [{ id: fixture.queuedDispatch.id }],
              [{ outcome_revision: "3" }],
              [{ intent_id: providerIoIntent.id }]
            ])
      ]);

      await expect(
        createSqlInboxV2OutboundTransportRepository(
          executor
        ).applyRouteFailureFenced({
          outboxLease: providerIoOutboxLeaseFence,
          commit
        })
      ).resolves.toEqual({ kind: "committed" });
      expect(executor.statementKinds()).toEqual([
        "lock_provider_io_outbox",
        "lock_dispatch",
        "lock_route",
        "lock_binding_fence",
        ...(kind === "runtime"
          ? []
          : ["cas_dispatch", "insert_outbox_outcome", "finalize_outbox"])
      ]);
      expect(executor.transactionConfigs).toEqual([
        { isolationLevel: "read committed" }
      ]);
      expect(executor.statementKinds()).not.toContain("insert_attempt");
      expect(commit.dispatchAfter).toMatchObject({
        route: fixture.queuedDispatch.route,
        state: kind === "runtime" ? "queued" : "terminal_failure",
        attemptCount: 0,
        activeAttempt: null,
        revision: kind === "runtime" ? "1" : "2"
      });
    }
  );

  it("closes the crash window by terminally finalizing outbox in the structural CAS transaction", async () => {
    const commit = routeFailureCommit("structural");
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [dispatchRow(fixture.queuedDispatch)],
      [{ id: fixture.route.id }],
      [bindingFenceRow(fixture, commit.bindingHeadSnapshot)],
      [{ id: fixture.queuedDispatch.id }],
      [{ outcome_revision: "3" }],
      [{ intent_id: providerIoIntent.id }]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).applyRouteFailureFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit
      })
    ).resolves.toEqual({ kind: "committed" });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "lock_dispatch",
      "lock_route",
      "lock_binding_fence",
      "cas_dispatch",
      "insert_outbox_outcome",
      "finalize_outbox"
    ]);
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "read committed" }
    ]);
  });

  it("rejects a future route-failure decision before any dispatch write", async () => {
    const commit = routeFailureCommit("runtime", {
      failedAt: "2026-07-14T08:03:00.000Z"
    });
    const executor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          databaseNow: "2026-07-14T08:02:30.000Z"
        })
      ]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).applyRouteFailureFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit
      })
    ).resolves.toEqual({ kind: "outbox_attempt_lease_conflict" });
    expect(executor.statementKinds()).toEqual(["lock_provider_io_outbox"]);
  });

  it("rejects runtime-unavailable evidence when the locked head remains ready", async () => {
    const commit = routeFailureCommit("runtime");
    const currentHead = {
      ...commit.bindingHeadSnapshot,
      runtimeHealth: {
        state: "ready" as const,
        revision: commit.bindingHeadSnapshot.runtimeHealth.revision
      }
    };
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [dispatchRow(fixture.queuedDispatch)],
      [{ id: fixture.route.id }],
      [bindingFenceRow(fixture, currentHead)]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).applyRouteFailureFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit
      })
    ).resolves.toEqual({ kind: "binding_fence_conflict" });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "lock_dispatch",
      "lock_route",
      "lock_binding_fence"
    ]);
  });

  it("rejects a forged same-id route snapshot before evaluating its binding", async () => {
    const commit = routeFailureCommit("structural");
    const forgedBinding = {
      ...commit.routeSnapshot.sourceThreadBinding,
      id: "source_thread_binding:forged-route-binding"
    };
    const forgedRoute = {
      ...commit.routeSnapshot,
      sourceThreadBinding: forgedBinding,
      conversationAuthorization: {
        ...commit.routeSnapshot.conversationAuthorization,
        target: {
          ...commit.routeSnapshot.conversationAuthorization.target,
          sourceThreadBinding: forgedBinding
        }
      },
      sourceAccountAuthorization: {
        ...commit.routeSnapshot.sourceAccountAuthorization,
        target: {
          ...commit.routeSnapshot.sourceAccountAuthorization.target,
          sourceThreadBinding: forgedBinding
        }
      }
    };
    const forgedCommit = inboxV2OutboundDispatchRouteFailureCommitSchema.parse({
      ...commit,
      routeSnapshot: forgedRoute,
      bindingHeadSnapshot: {
        ...commit.bindingHeadSnapshot,
        binding: forgedBinding
      }
    });
    const executor = new QueueOutboundExecutor([
      [providerIoOutboxLeaseRow()],
      [dispatchRow(fixture.queuedDispatch)],
      []
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(
        executor
      ).applyRouteFailureFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit: forgedCommit
      })
    ).resolves.toEqual({ kind: "route_not_found" });
    expect(executor.statementKinds()).toEqual([
      "lock_provider_io_outbox",
      "lock_dispatch",
      "lock_route"
    ]);
    const routeLock = executor.queries[2]!;
    const routeSql = normalizeSql(routeLock.sql);
    expect(routeSql).toContain("route_row.source_thread_binding_id =");
    expect(routeSql).toContain(
      "route_row.content_kind_id is not distinct from"
    );
    expect(routeSql).toContain("route_row.adapter_contract_snapshot =");
    expect(routeSql).toContain(
      "route_row.conversation_authorization_snapshot ="
    );
    expect(routeLock.params).toContain(forgedBinding.id);
  });

  it("rejects a reclaimed outbox token before any outbound transport write", async () => {
    const executor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          leaseTokenHash: calculateInboxV2OutboxLeaseTokenHash(
            inboxV2OutboxLeaseTokenSchema.parse(
              `lease-token:reclaimed-${"r".repeat(40)}`
            )
          )
        })
      ]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttemptFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit: fixture.openAttemptCommit
      })
    ).resolves.toEqual({
      kind: "outbox_stale_token",
      currentLeaseRevision: "1"
    });
    expect(executor.statementKinds()).toEqual(["lock_provider_io_outbox"]);
  });

  it("uses DB time to reject a future or premature attempt completion", async () => {
    const executor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          databaseNow: "2026-07-14T08:05:30.000Z"
        })
      ]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttemptFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit: fixture.completeUnknownCommit
      })
    ).resolves.toEqual({ kind: "outbox_attempt_lease_conflict" });
    expect(executor.statementKinds()).toEqual(["lock_provider_io_outbox"]);
  });

  it("rejects a provider result once the attempt lease has expired in DB time", async () => {
    const providerResultCommit =
      inboxV2OutboundDispatchAttemptCommitSchema.parse({
        ...fixture.completeUnknownCommit,
        attemptAfter: fixture.acceptedAttempt,
        completionSource: "provider_result",
        dispatchAfter: fixture.acceptedDispatch
      });
    const executor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          databaseNow: "2026-07-14T08:05:30.000Z"
        })
      ]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttemptFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit: providerResultCommit
      })
    ).resolves.toEqual({ kind: "outbox_attempt_lease_conflict" });
    expect(executor.statementKinds()).toEqual(["lock_provider_io_outbox"]);
  });

  it("completes a lease-expired claim as immutable outcome_unknown with two CAS fences", async () => {
    const attemptCas = renderQuery(
      buildCompareAndSwapInboxV2OutboundDispatchAttemptSql(
        fixture.pendingAttempt,
        fixture.unknownAttempt
      )
    );
    expect(attemptCas.params).toEqual(
      expect.arrayContaining([
        "outcome_unknown",
        "lease_expired",
        "automated_reconciliation_required",
        fixture.pendingAttempt.claimToken
      ])
    );
    expect(normalizeSql(attemptCas.sql)).toContain("and claim_token = $");

    const executor = new QueueOutboundExecutor([
      [dispatchRow(fixture.attemptingDispatch)],
      [attemptRow(fixture.pendingAttempt)],
      [{ id: fixture.pendingAttempt.id }],
      [{ id: fixture.attemptingDispatch.id }]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).applyAttempt(
        fixture.completeUnknownCommit
      )
    ).resolves.toEqual({ kind: "committed" });
    expect(executor.statementKinds()).toEqual([
      "lock_dispatch",
      "lock_attempt",
      "cas_attempt",
      "cas_dispatch"
    ]);
  });

  it("appends one reconciliation decision and mutates only the dispatch head", async () => {
    const decisionQuery = renderQuery(
      buildInsertInboxV2OutboundDispatchReconciliationDecisionSql(
        fixture.reconciliationDecision
      )
    );
    expect(normalizeSql(decisionQuery.sql)).toContain(
      "insert into inbox_v2_outbound_dispatch_reconciliation_decisions"
    );
    expect(normalizeSql(decisionQuery.sql)).toContain("on conflict do nothing");
    expect(normalizeSql(decisionQuery.sql)).not.toContain(" do update");
    expect(normalizeSql(decisionQuery.sql)).toContain("'outcome_unknown'");
    expect(decisionQuery.params).toEqual(
      expect.arrayContaining([
        fixture.unknownAttempt.id,
        "retryable_failure",
        fixture.reconciliationDecision.result.evidenceToken
      ])
    );

    const executor = new QueueOutboundExecutor([
      [dispatchRow(fixture.unknownDispatch)],
      [attemptRow(fixture.unknownAttempt)],
      [{ retry_safe: true }],
      [{ id: fixture.reconciliationDecision.id }],
      [{ id: fixture.unknownDispatch.id }]
    ]);
    const result = await createSqlInboxV2OutboundTransportRepository(
      executor
    ).reconcile(fixture.reconciliationCommit);
    expect(result).toEqual({ kind: "committed" });
    expect(executor.statementKinds()).toEqual([
      "lock_dispatch",
      "lock_attempt",
      "check_artifact_retry_safety",
      "insert_reconciliation",
      "cas_dispatch"
    ]);
    expect(
      executor.queries.some((query) =>
        normalizeSql(query.sql).startsWith(
          "update inbox_v2_outbound_dispatch_reconciliation_decisions"
        )
      )
    ).toBe(false);
  });

  it("rejects retryable reconciliation when the exact unknown attempt already has an accepted artifact", async () => {
    const executor = new QueueOutboundExecutor([
      [dispatchRow(fixture.unknownDispatch)],
      [attemptRow(fixture.unknownAttempt)],
      [{ retry_safe: false }]
    ]);
    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).reconcile(
        fixture.reconciliationCommit
      )
    ).resolves.toEqual({ kind: "artifact_retry_unsafe" });
    expect(executor.statementKinds()).toEqual([
      "lock_dispatch",
      "lock_attempt",
      "check_artifact_retry_safety"
    ]);
    expect(executor.statementKinds()).not.toContain("insert_reconciliation");
    expect(executor.statementKinds()).not.toContain("cas_dispatch");
  });

  it("rejects a reconciliation timestamp ahead of the fenced DB clock", async () => {
    const executor = new QueueOutboundExecutor([
      [
        providerIoOutboxLeaseRow({
          databaseNow: "2026-07-14T08:06:30.000Z"
        })
      ]
    ]);

    await expect(
      createSqlInboxV2OutboundTransportRepository(executor).reconcileFenced({
        outboxLease: providerIoOutboxLeaseFence,
        commit: fixture.reconciliationCommit
      })
    ).resolves.toEqual({ kind: "outbox_attempt_lease_conflict" });
    expect(executor.statementKinds()).toEqual(["lock_provider_io_outbox"]);
  });

  it("keeps multiple artifacts append-only and builds both occurrence association orders", async () => {
    const artifactQueries = fixture.artifacts.map((artifact) =>
      renderQuery(buildInsertInboxV2OutboundDispatchArtifactSql(artifact))
    );
    expect(artifactQueries.map(({ params }) => params)).toEqual([
      expect.arrayContaining([fixture.artifacts[0]?.id, 1]),
      expect.arrayContaining([fixture.artifacts[1]?.id, 2])
    ]);
    for (const query of artifactQueries) {
      expect(normalizeSql(query.sql)).toContain("on conflict do nothing");
      expect(normalizeSql(query.sql)).not.toContain(" do update");
    }

    for (const commit of [
      fixture.echoAssociation,
      fixture.responseAssociation
    ]) {
      const resolvedReference = commit.occurrenceResolution.resolvedReference;
      if (resolvedReference === null) {
        throw new Error(
          "Association fixture must contain a resolved reference."
        );
      }
      const referenceQuery = renderQuery(
        buildInsertInboxV2ExternalMessageReferenceSql(resolvedReference)
      );
      const transitionQuery = renderQuery(
        buildInsertInboxV2SourceOccurrenceResolutionTransitionSql(
          commit.occurrenceResolution
        )
      );
      const occurrenceCas = renderQuery(
        buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql(
          commit.occurrenceResolution
        )
      );
      const linkQuery = renderQuery(
        buildInsertInboxV2OutboundDispatchArtifactReferenceLinkSql(commit)
      );
      expect(normalizeSql(referenceQuery.sql)).toContain(
        "from inbox_v2_messages message_row"
      );
      expect(normalizeSql(transitionQuery.sql)).toContain(
        "insert into inbox_v2_source_occurrence_resolution_transitions"
      );
      expect(normalizeSql(occurrenceCas.sql)).toContain("and revision = $");
      expect(normalizeSql(linkQuery.sql)).toContain(
        "from inbox_v2_outbound_dispatch_artifacts artifact_row"
      );
      expect(linkQuery.params).toEqual(
        expect.arrayContaining([
          fixture.tenantId,
          commit.link.associationEvidence.kind,
          commit.link.externalMessageReference.id,
          commit.link.sourceOccurrence.id
        ])
      );
      if (
        commit.link.associationEvidence.kind === "provider_echo_correlation"
      ) {
        expect(linkQuery.params).toEqual(
          expect.arrayContaining([
            commit.link.associationEvidence.providerReferenceKindId,
            commit.link.associationEvidence.correlationToken
          ])
        );
      }
    }

    const multiSend = renderQuery(
      buildInsertInboxV2OutboundMultiSendOperationSql(
        fixture.multiSendOperation
      )
    );
    expect(normalizeSql(multiSend.sql)).toContain(
      "insert into inbox_v2_outbound_multi_send_operations"
    );
    expect(multiSend.params).toEqual(
      expect.arrayContaining([fixture.multiSendOperation.id, 2])
    );
  });
});

type AuthorizedRouteContextOverrides = Readonly<{
  tenantId?: string;
  employeeId?: string;
  authorizationEpoch?: string;
  occurredAt?: string;
  commandTypeId?: string;
  conversationId?: string;
  permissionId?: string;
  conversationResourceScopeId?: string;
  sourceAccountDecision?: "missing" | "wrong_permission" | "wrong_resource";
  conversationDecisionMismatch?: RouteDecisionSnapshotMismatch;
  sourceAccountDecisionMismatch?: RouteDecisionSnapshotMismatch;
  omitSourceAccountResourceFence?: boolean;
}>;

type RouteDecisionSnapshotMismatch =
  | "decision_revision"
  | "decided_at"
  | "not_after";

function authorizedRouteContextInput(
  overrides: AuthorizedRouteContextOverrides = {}
): WithInboxV2AuthorizedCommandMutationInput {
  const tenantId = overrides.tenantId ?? authorizedRouteFixture.tenantId;
  const employeeId =
    overrides.employeeId ?? authorizedRouteFixture.references.employee.id;
  const authorizationEpoch =
    overrides.authorizationEpoch ??
    authorizedRouteFixture.route.authorizationEpoch;
  const commandTypeId = overrides.commandTypeId ?? "core:message.send";
  const conversationId =
    overrides.conversationId ??
    authorizedRouteFixture.references.conversation.id;
  const permissionId =
    overrides.permissionId ??
    authorizedRouteFixture.route.requiredConversationPermissionId;
  const occurredAt =
    overrides.occurredAt ??
    authorizedRouteFixture.routeCommit.input.requestedAt;
  const conversationAuthorization =
    authorizedRouteFixture.route.conversationAuthorization;
  const sourceAccountAuthorization =
    authorizedRouteFixture.route.sourceAccountAuthorization;
  const notAfter = conversationAuthorization.notAfter;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const commandId = "command:route-context";
  const clientMutationId = "mutation:route-context";
  const correlationId = "correlation:route-context";
  const changeId = "change:route-context";
  const eventId = "event:route-context";
  const decision = {
    tenantId,
    id: "authorization-decision:route-context",
    authorizationEpoch,
    principal: {
      kind: "employee" as const,
      employee: {
        tenantId,
        kind: "employee" as const,
        id: employeeId
      }
    },
    permissionId,
    resourceScopeId:
      overrides.conversationResourceScopeId ?? "core:conversation",
    resource: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: conversationId
    },
    resourceAccessRevision: "1",
    decisionRevision:
      overrides.conversationDecisionMismatch === "decision_revision"
        ? "2"
        : conversationAuthorization.decisionRevision,
    decisionHash: routeContextHash("a"),
    outcome: "allowed" as const,
    decidedAt:
      overrides.conversationDecisionMismatch === "decided_at"
        ? "2026-07-14T08:00:01.000Z"
        : conversationAuthorization.decidedAt,
    notAfter:
      overrides.conversationDecisionMismatch === "not_after"
        ? "2026-07-14T09:59:00.000Z"
        : notAfter
  };
  const sourceAccountDecisionResourceId =
    overrides.sourceAccountDecision === "wrong_resource"
      ? "source_account:outbound-other"
      : authorizedRouteFixture.references.sourceAccount.id;
  const sourceAccountDecision = {
    ...decision,
    id: "authorization-decision:route-context-source-account",
    permissionId:
      overrides.sourceAccountDecision === "wrong_permission"
        ? "core:message.read"
        : "core:source_account.use",
    resourceScopeId: "core:source-account",
    resource: {
      tenantId,
      entityTypeId: "core:source-account",
      entityId: sourceAccountDecisionResourceId
    },
    decisionRevision:
      overrides.sourceAccountDecisionMismatch === "decision_revision"
        ? "2"
        : sourceAccountAuthorization.decisionRevision,
    decisionHash: routeContextHash("0"),
    decidedAt:
      overrides.sourceAccountDecisionMismatch === "decided_at"
        ? "2026-07-14T08:00:01.000Z"
        : sourceAccountAuthorization.decidedAt,
    notAfter:
      overrides.sourceAccountDecisionMismatch === "not_after"
        ? "2026-07-14T09:59:00.000Z"
        : sourceAccountAuthorization.notAfter
  };
  const authorizationDecisionRefs =
    overrides.sourceAccountDecision === "missing"
      ? [decision]
      : [decision, sourceAccountDecision];
  const sourceEntity = {
    tenantId,
    entityTypeId: "core:source-connection",
    entityId: "source_connection:route-context"
  };
  const sourceStateReference = {
    tenantId,
    recordId: "source-connection-state:route-context",
    schemaId: "core:inbox-v2.source-connection-registry-state",
    schemaVersion: "v1",
    digest: routeContextHash("b")
  };
  const sourceTransitionReference = {
    tenantId,
    recordId: "source-connection-transition:route-context",
    schemaId: "core:inbox-v2.source-registry-transition",
    schemaVersion: "v1",
    digest: routeContextHash("c")
  };

  return {
    tenantId,
    command: {
      id: commandId,
      requestId: "request:route-context",
      clientMutationId,
      commandTypeId,
      requestHash: routeContextHash("d"),
      actor: { kind: "employee", employeeId },
      authorizationDecisionId: decision.id,
      authorizationEpoch,
      authorizedAt: occurredAt,
      publicResultCode: "core:message.queued",
      resultReference: sourceTransitionReference,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [
        {
          employeeId,
          expectedEmployeeAccessRevision: "1",
          expectedEmployeeInboxRelationRevision: "1",
          advanceEmployeeAccess: false,
          advanceEmployeeInboxRelation: false
        }
      ],
      resources: [
        {
          resourceKind: "conversation",
          resourceId: conversationId,
          resourceHeadId: "authorization-resource:route-context",
          expectedResourceAccessRevision: "1",
          advance: "none"
        },
        ...(overrides.omitSourceAccountResourceFence ||
        overrides.sourceAccountDecision === "missing"
          ? []
          : [
              {
                resourceKind: "source_account" as const,
                resourceId: sourceAccountDecisionResourceId,
                resourceHeadId:
                  "authorization-resource:route-context-source-account",
                expectedResourceAccessRevision: "1",
                advance: "none" as const
              }
            ])
      ]
    },
    records: {
      mutationId: "authorization-mutation:route-context",
      relationKind: null,
      streamCommitId: "commit:route-context",
      expectedStreamEpoch: "stream:epoch-route-context",
      audienceImpact: { kind: "none" },
      commitHash: routeContextHash("e"),
      correlationId,
      changes: [
        {
          id: changeId,
          ordinal: 1,
          entity: sourceEntity,
          resultingRevision: "1",
          timeline: null,
          audience: "staff_only",
          state: {
            kind: "upsert",
            stateSchemaId: "core:inbox-v2.source-connection-registry-state",
            stateSchemaVersion: "v1",
            stateHash: routeContextHash("f"),
            payloadReference: sourceStateReference,
            domainCommitReference: sourceTransitionReference
          }
        }
      ],
      events: [
        {
          id: eventId,
          typeId: "core:source-connection.changed",
          payloadSchemaId: "core:inbox-v2.source-connection-change",
          payloadSchemaVersion: "v1",
          ordinal: "1",
          changeIds: [changeId],
          subjects: [sourceEntity],
          payloadReference: null,
          correlationId,
          commandIds: [commandId],
          clientMutationIds: [clientMutationId],
          authorizationDecisionRefs,
          accessEffect: { kind: "none" },
          occurredAt,
          recordedAt: occurredAt,
          eventHash: routeContextHash("1")
        }
      ],
      outboxIntents: [
        {
          id: "outbox-intent:route-context",
          ordinal: 1,
          typeId: "core:projection.update",
          handlerId: "core:source-connection-projection",
          effectClass: "projection",
          eventId,
          changeIds: [changeId],
          payloadReference: null,
          consumerDedupeKey: routeContextHash("2"),
          correlationId,
          availableAt: occurredAt,
          intentHash: routeContextHash("3")
        }
      ],
      audit: {
        id: "authorization-audit:route-context",
        actionId: commandTypeId,
        target: {
          tenantId,
          entityTypeId: "core:source-connection",
          entityId: `internal-ref:${"4".repeat(32)}`
        },
        reasonCodeId: "core:message-send-requested",
        matchedPermissionIds: authorizationDecisionRefs
          .map(({ permissionId: matchedPermissionId }) => matchedPermissionId)
          .sort(),
        grantSourceIds: [`internal-ref:${"5".repeat(32)}`],
        authorizationScopeIds: authorizationDecisionRefs
          .map(({ resourceScopeId }) => resourceScopeId)
          .sort(),
        overrideReasonCodeId: null,
        policyVersion: "v1",
        evidenceReference: sourceTransitionReference,
        authorizationDecisionRefs,
        correlationId,
        outcome: "succeeded",
        revisionDeltaHash: routeContextHash("6"),
        previousAuditHash: null,
        auditHash: routeContextHash("7"),
        occurredAt,
        recordedAt: occurredAt,
        expiresAt,
        facets: [
          {
            ordinal: 1,
            dimension: "tenant",
            reference: {
              tenantId,
              entityTypeId: "core:tenant",
              entityId: `internal-ref:${"8".repeat(32)}`
            },
            relation: "affected",
            facetHash: routeContextHash("9")
          }
        ]
      }
    },
    occurredAt
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

async function expectRouteContextRejectedBeforeSql(
  input: WithInboxV2AuthorizedCommandMutationInput,
  commit: Parameters<typeof persistInboxV2RouteResolutionInTransaction>[1],
  mode: "atomic" | "ordinary"
): Promise<void> {
  const executor = new RouteAuthorizationContextExecutor(input);
  const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(executor);
  let seamQueries:
    | readonly Readonly<{ sql: string; params: readonly unknown[] }>[]
    | undefined;
  const persistRoute = async (
    context: InboxV2AuthorizedCommandMutationContext
  ) => {
    const queryCountBeforeSeam = executor.queries.length;
    try {
      return {
        result: await persistInboxV2RouteResolutionInTransaction(
          context,
          commit
        )
      };
    } finally {
      seamQueries = executor.queries.slice(queryCountBeforeSeam);
    }
  };
  const result =
    mode === "atomic"
      ? coordinator.withAuthorizedAtomicMaterialization(
          input,
          persistRoute,
          async () => {
            throw new Error("route authorization unexpectedly reached seal");
          }
        )
      : coordinator.withAuthorizedCommandMutation(input, persistRoute);

  await expect(result).rejects.toThrow(
    mode === "atomic"
      ? "Inbox V2 route resolution crossed its authorized message-send context."
      : "Message, TimelineItem and provider-dispatch mutations require withAuthorizedAtomicMaterialization."
  );
  expect(seamQueries).toEqual(mode === "atomic" ? [] : undefined);
}

function withAdditionalRouteAuthorizationPermission(
  commit: Parameters<typeof persistInboxV2RouteResolutionInTransaction>[1],
  authorizationKind: "conversation" | "source_account"
): Parameters<typeof persistInboxV2RouteResolutionInTransaction>[1] {
  if (commit.route === null) {
    throw new Error("Authorized route fixture has no selected route.");
  }
  const candidate = commit.input.candidates.soleEligibleCandidate;
  if (candidate === null) {
    throw new Error("Authorized route fixture has no selected candidate.");
  }
  const field =
    authorizationKind === "conversation"
      ? "conversationAuthorization"
      : "sourceAccountAuthorization";
  const authorization = {
    ...candidate[field],
    matchedPermissionIds: [
      ...candidate[field].matchedPermissionIds,
      "core:inbox.read"
    ]
  };
  const input = {
    ...commit,
    input: {
      ...commit.input,
      candidates: {
        ...commit.input.candidates,
        soleEligibleCandidate: {
          ...candidate,
          [field]: authorization
        }
      }
    },
    route: {
      ...commit.route,
      [field]: authorization
    }
  };
  return {
    ...input,
    result: resolveInboxV2OutboundRoute(input.input)
  };
}

type ExplicitRerouteAuthorizationFailure =
  | "missing_reroute"
  | "missing_original_use"
  | "duplicate_selected_use"
  | "wrong_primary";
type ExplicitRerouteDrift =
  | "original_fence"
  | "original_admin"
  | "selected_admin";

function explicitRerouteFixture(
  options: {
    sameSourceAccount?: boolean;
    authorizationFailure?: ExplicitRerouteAuthorizationFailure;
    drift?: ExplicitRerouteDrift;
  } = {}
) {
  const candidate =
    authorizedRouteFixture.routeCommit.input.candidates.soleEligibleCandidate;
  if (candidate === null) {
    throw new Error("Authorized reroute fixture requires one candidate.");
  }
  const oldBindingId = "source_thread_binding:outbound-reroute-original";
  const oldSourceAccountId = options.sameSourceAccount
    ? authorizedRouteFixture.references.sourceAccount.id
    : "source_account:outbound-reroute-original";
  const oldSourceConnectionId = options.sameSourceAccount
    ? authorizedRouteFixture.references.sourceConnection.id
    : "source_connection:outbound-reroute-original";
  const originalDispatchId = "outbound_dispatch:outbound-reroute-original";
  const originalRouteId = "outbound_route:outbound-reroute-original";
  const commit = materializeInboxV2OutboundRouteResolutionCommit(
    {
      ...authorizedRouteFixture.routeCommit.input,
      intent: {
        kind: "explicit_reroute",
        originalRoute: {
          tenantId: authorizedRouteFixture.tenantId,
          kind: "outbound_route",
          id: originalRouteId
        },
        originalDispatch: {
          tenantId: authorizedRouteFixture.tenantId,
          kind: "outbound_dispatch",
          id: originalDispatchId
        },
        expectedOriginalDispatchRevision: "1",
        replacementBinding: candidate.sourceThreadBinding,
        reasonId: "core:operator-reroute"
      },
      candidates: {
        ...authorizedRouteFixture.routeCommit.input.candidates,
        explicitTarget: candidate
      }
    },
    {
      routeId: "outbound_route:outbound-reroute-replacement",
      selectedAt: authorizedRouteFixture.route.createdAt
    }
  );
  if (
    commit.route === null ||
    commit.route.selection.intent.kind !== "explicit_reroute"
  ) {
    throw new Error("Authorized reroute fixture must select a route.");
  }
  const originalRoute = {
    id: commit.route.selection.intent.originalRoute.id,
    conversation_id: commit.route.conversation.id,
    external_thread_id: commit.route.externalThread.id,
    binding_id: oldBindingId,
    source_connection_id: oldSourceConnectionId,
    source_account_id: oldSourceAccountId,
    operation_id: commit.route.operationId,
    content_kind_id: commit.route.contentKindId,
    binding_revision: "1",
    account_generation: "1",
    binding_generation: "1",
    remote_access_revision: "1",
    administrative_revision: "1",
    capability_revision: "1",
    route_descriptor_revision: "1",
    created_at: OUTBOUND_TEST_TIMES.loadedAt
  };
  const originalDispatch = inboxV2OutboundDispatchSchema.parse({
    ...authorizedRouteFixture.queuedDispatch,
    id: originalDispatchId,
    message: {
      ...authorizedRouteFixture.queuedDispatch.message,
      id: "message:outbound-reroute-original"
    },
    route: {
      ...authorizedRouteFixture.queuedDispatch.route,
      id: originalRouteId
    },
    createdAt: OUTBOUND_TEST_TIMES.loadedAt,
    updatedAt: OUTBOUND_TEST_TIMES.loadedAt
  });
  const rerouteCommit = inboxV2OutboundDispatchRerouteCommitSchema.parse({
    tenantId: authorizedRouteFixture.tenantId,
    original: {
      dispatchBefore: originalDispatch,
      dispatchAfter: {
        ...originalDispatch,
        state: "cancelled",
        revision: "2",
        updatedAt: commit.route.selection.selectedAt
      },
      outboxIntentId: "outbox-intent:outbound-reroute-original"
    },
    replacement: {
      message: {
        tenantId: authorizedRouteFixture.tenantId,
        kind: "message",
        id: "message:outbound-reroute-replacement"
      },
      route: {
        tenantId: authorizedRouteFixture.tenantId,
        kind: "outbound_route",
        id: commit.route.id
      },
      dispatch: {
        tenantId: authorizedRouteFixture.tenantId,
        kind: "outbound_dispatch",
        id: "outbound_dispatch:outbound-reroute-replacement"
      },
      outboxIntentId: "outbox-intent:outbound-reroute-replacement"
    },
    reasonId: commit.route.selection.intent.reasonId,
    changedAt: commit.route.selection.selectedAt
  });
  const selectedHead = {
    ...bindingFenceRow(authorizedRouteFixture),
    ...(options.drift === "selected_admin"
      ? {
          binding_revision: "2",
          administrative_revision: "2",
          administrative_state: "disabled"
        }
      : {})
  };
  const input = authorizedExplicitRerouteInput(commit, {
    originalSourceAccountId: oldSourceAccountId,
    authorizationFailure: options.authorizationFailure
  });
  const routeRows = {
    policyHead: {
      revision: commit.input.routePolicy.revision,
      conversation_id: commit.input.routePolicy.conversation.id,
      external_thread_id: commit.input.routePolicy.externalThread.id,
      operation_id: commit.input.routePolicy.operationId,
      content_kind_id: commit.input.routePolicy.contentKindId
    },
    policyVersion: {
      policy_id: commit.input.routePolicy.id,
      revision: commit.input.routePolicy.revision,
      conversation_id: commit.input.routePolicy.conversation.id,
      external_thread_id: commit.input.routePolicy.externalThread.id,
      operation_id: commit.input.routePolicy.operationId,
      content_kind_id: commit.input.routePolicy.contentKindId,
      route_policy_catalog_id: commit.input.routePolicy.policyId,
      required_conversation_permission_id:
        commit.input.routePolicy.requiredConversationPermissionId,
      preferred_binding_id: null,
      fallback_kind: "none",
      fallback_binding_count: 0,
      fallback_bindings_digest_sha256: null,
      created_at: commit.input.routePolicy.createdAt,
      updated_at: commit.input.routePolicy.updatedAt
    },
    originalRoute,
    originalDispatch: {
      id: originalDispatch.id,
      message_id: originalDispatch.message.id,
      route_id: originalDispatch.route.id,
      multi_send_operation_id: null,
      state:
        options.drift === "original_fence"
          ? "attempting"
          : originalDispatch.state,
      attempt_count:
        options.drift === "original_fence" ? 1 : originalDispatch.attemptCount,
      active_attempt_id:
        options.drift === "original_fence"
          ? "outbound_dispatch_attempt:open"
          : null,
      last_attempt_id:
        options.drift === "original_fence"
          ? "outbound_dispatch_attempt:open"
          : null,
      retry_authorization_decision_id: null,
      revision:
        options.drift === "original_fence" ? "2" : originalDispatch.revision,
      created_at: originalDispatch.createdAt,
      updated_at:
        options.drift === "original_fence"
          ? OUTBOUND_TEST_TIMES.openedAt
          : originalDispatch.updatedAt
    },
    originalAttempts:
      options.drift === "original_fence"
        ? [{ id: "outbound_dispatch_attempt:open" }]
        : [],
    originalProviderIntent: {
      id: rerouteCommit.original.outboxIntentId,
      type_id: "core:provider.dispatch",
      effect_class: "provider_io",
      payload_reference: {
        tenantId: originalDispatch.tenantId,
        recordId: originalDispatch.id,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
        schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
        digest: routeContextHash("e")
      },
      work_state: "pending"
    },
    selectedHead,
    insertedRouteId: commit.route.id,
    cancelledDispatchId: originalDispatch.id
  };
  const executor = new RouteAuthorizationContextExecutor(input, routeRows);
  return {
    commit,
    input,
    originalRoute,
    originalDispatch,
    rerouteCommit,
    executor
  };
}

function authorizedExplicitRerouteInput(
  commit: InboxV2OutboundRouteResolutionCommit,
  input: {
    originalSourceAccountId: string;
    authorizationFailure?: ExplicitRerouteAuthorizationFailure;
  }
): WithInboxV2AuthorizedCommandMutationInput {
  if (commit.route === null) {
    throw new Error("Authorized reroute commit has no route.");
  }
  const base = authorizedRouteContextInput();
  const decisions: InboxV2AuthorizationDecisionReference[] = [
    ...base.records.audit.authorizationDecisionRefs
  ];
  const selectedUse = decisions.find(
    (decision) => decision.permissionId === "core:source_account.use"
  );
  if (selectedUse === undefined) {
    throw new Error("Authorized reroute fixture has no selected-account use.");
  }
  const originalUse = inboxV2AuthorizationDecisionReferenceSchema.parse({
    ...selectedUse,
    id: "authorization-decision:route-context-reroute-original-use",
    resource: {
      ...selectedUse.resource,
      entityId: input.originalSourceAccountId
    },
    decisionRevision: (BigInt(selectedUse.decisionRevision) + 1n).toString(),
    decisionHash: routeContextHash("b")
  });
  const rerouteDecision = inboxV2AuthorizationDecisionReferenceSchema.parse({
    ...originalUse,
    id: "authorization-decision:route-context-reroute",
    permissionId: "core:source.dispatch.reroute",
    decisionHash: routeContextHash("c")
  });
  if (input.authorizationFailure !== "missing_original_use") {
    decisions.push(originalUse);
  }
  if (input.authorizationFailure !== "missing_reroute") {
    decisions.push(rerouteDecision);
  }
  if (input.authorizationFailure === "duplicate_selected_use") {
    decisions.push(
      inboxV2AuthorizationDecisionReferenceSchema.parse({
        ...selectedUse,
        id: "authorization-decision:route-context-reroute-duplicate-selected",
        decisionRevision: (
          BigInt(selectedUse.decisionRevision) + 2n
        ).toString(),
        decisionHash: routeContextHash("d")
      })
    );
  }
  decisions.sort((left, right) =>
    String(left.id).localeCompare(String(right.id))
  );
  const permissionIds = [
    ...new Set(decisions.map((decision) => decision.permissionId))
  ].sort();
  const scopeIds = [
    ...new Set(decisions.map((decision) => decision.resourceScopeId))
  ].sort();
  const resources: Array<
    WithInboxV2AuthorizedCommandMutationInput["revisions"]["resources"][number]
  > = [...base.revisions.resources];
  if (
    input.originalSourceAccountId !== commit.route.sourceAccount.id &&
    !resources.some(
      (resource) =>
        resource.resourceKind === "source_account" &&
        resource.resourceId === input.originalSourceAccountId
    )
  ) {
    resources.push({
      resourceKind: "source_account",
      resourceId: input.originalSourceAccountId,
      resourceHeadId: "authorization-resource:route-context-reroute-original",
      expectedResourceAccessRevision: "1",
      advance: "none"
    });
  }
  return {
    ...base,
    command: {
      ...base.command,
      commandTypeId: "core:source.dispatch.reroute",
      authorizationDecisionId:
        input.authorizationFailure === "wrong_primary" ||
        input.authorizationFailure === "missing_reroute"
          ? base.command.authorizationDecisionId
          : rerouteDecision.id
    },
    revisions: { ...base.revisions, resources },
    records: {
      ...base.records,
      events: base.records.events.map((event) => ({
        ...event,
        authorizationDecisionRefs: decisions
      })),
      audit: {
        ...base.records.audit,
        actionId: "core:source.dispatch.reroute",
        matchedPermissionIds: permissionIds,
        authorizationScopeIds: scopeIds,
        authorizationDecisionRefs: decisions
      }
    }
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

class RerouteProbeComplete extends Error {}

async function probeAuthorizedReroute(
  reroute: ReturnType<typeof explicitRerouteFixture>
) {
  const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(
    reroute.executor
  );
  let result:
    | Awaited<
        ReturnType<typeof persistInboxV2ExplicitRerouteResolutionInTransaction>
      >
    | undefined;
  try {
    await coordinator.withAuthorizedAtomicMaterialization(
      reroute.input,
      async (context) => {
        result = await persistInboxV2ExplicitRerouteResolutionInTransaction(
          context,
          {
            routeResolution: reroute.commit,
            rerouteCommit: reroute.rerouteCommit
          }
        );
        throw new RerouteProbeComplete();
      },
      async () => {
        throw new Error("Reroute probe must not reach seal.");
      }
    );
  } catch (error) {
    if (!(error instanceof RerouteProbeComplete)) throw error;
  }
  if (result === undefined) {
    throw new Error("Reroute probe did not produce a repository result.");
  }
  return { result, executor: reroute.executor };
}

class RouteAuthorizationContextExecutor implements InboxV2AuthorizationTransactionExecutor {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly input: WithInboxV2AuthorizedCommandMutationInput,
    private readonly routeRows?: Readonly<{
      policyHead: Readonly<Record<string, unknown>>;
      policyVersion: Readonly<Record<string, unknown>>;
      originalRoute: Readonly<Record<string, unknown>>;
      originalDispatch: Readonly<Record<string, unknown>>;
      originalAttempts: readonly Readonly<Record<string, unknown>>[];
      originalProviderIntent: Readonly<Record<string, unknown>>;
      selectedHead: Readonly<Record<string, unknown>>;
      insertedRouteId: string;
      cancelledDispatchId: string;
    }>
  ) {}

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    expect(config).toEqual({ isolationLevel: "read committed" });
    return work(this);
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const rendered = renderQuery(query);
    this.queries.push(rendered);
    const statement = normalizeSql(rendered.sql);
    const employee = this.input.revisions.employees[0]!;
    let rows: readonly Record<string, unknown>[];

    if (statement.startsWith("insert into inbox_v2_auth_command_records")) {
      rows = [{ id: this.input.command.id }];
    } else if (
      statement.startsWith("insert into inbox_v2_auth_tenant_heads") ||
      statement.includes("insert into inbox_v2_auth_employee_heads") ||
      statement.includes("insert into inbox_v2_auth_resource_heads")
    ) {
      rows = [];
    } else if (
      statement.includes("from inbox_v2_auth_tenant_heads") &&
      statement.includes("for update")
    ) {
      rows = [
        {
          tenant_rbac_revision: "1",
          shared_access_revision: "1",
          revision: "1"
        }
      ];
    } else if (
      statement.includes("inbox_v2_auth_employee_heads head") &&
      statement.includes("for update")
    ) {
      rows = [
        {
          employee_id: employee.employeeId,
          employee_access_revision: "1",
          employee_inbox_relation_revision: "1",
          revision: "1"
        }
      ];
    } else if (
      statement.includes("inbox_v2_auth_resource_heads head") &&
      statement.includes("for update")
    ) {
      rows = this.input.revisions.resources.map((resource) => ({
        head_id: resource.resourceHeadId,
        resource_kind: resource.resourceKind,
        resource_id: resource.resourceId,
        work_item_cycle: null,
        resource_access_revision: "1",
        structural_relation_revision: "1",
        collaborator_set_revision: "1",
        revision: "1"
      }));
    } else if (statement === "select clock_timestamp() as database_now") {
      rows = [{ database_now: this.input.occurredAt }];
    } else if (
      this.routeRows !== undefined &&
      statement.includes("from inbox_v2_thread_route_policy_heads") &&
      statement.includes("for share")
    ) {
      rows = [this.routeRows.policyHead];
    } else if (
      this.routeRows !== undefined &&
      statement.includes("from inbox_v2_thread_route_policy_versions") &&
      statement.includes("for share")
    ) {
      rows = [this.routeRows.policyVersion];
    } else if (
      this.routeRows !== undefined &&
      statement.includes("from inbox_v2_outbound_dispatches") &&
      statement.includes("for update")
    ) {
      rows = [this.routeRows.originalDispatch];
    } else if (
      this.routeRows !== undefined &&
      statement.includes("from inbox_v2_outbound_dispatch_attempts attempt") &&
      statement.includes("for share of attempt")
    ) {
      rows = this.routeRows.originalAttempts;
    } else if (
      this.routeRows !== undefined &&
      statement.includes("from inbox_v2_outbox_intents intent") &&
      statement.includes("join inbox_v2_outbox_work_items work")
    ) {
      rows = [this.routeRows.originalProviderIntent];
    } else if (
      this.routeRows !== undefined &&
      statement.includes("from inbox_v2_outbound_routes route_row") &&
      statement.includes("route_row.binding_revision") &&
      statement.includes("for share of route_row")
    ) {
      rows = [this.routeRows.originalRoute];
    } else if (
      this.routeRows !== undefined &&
      statement.includes("from inbox_v2_source_thread_binding_heads head") &&
      statement.includes("head.binding_id =")
    ) {
      rows = [this.routeRows.selectedHead];
    } else if (
      this.routeRows !== undefined &&
      statement.startsWith("insert into inbox_v2_outbound_routes")
    ) {
      rows = [{ id: this.routeRows.insertedRouteId }];
    } else if (
      this.routeRows !== undefined &&
      statement.startsWith("update inbox_v2_outbound_dispatches")
    ) {
      rows = [{ id: this.routeRows.cancelledDispatchId }];
    } else {
      throw new Error(`Unexpected authorization SQL: ${statement}`);
    }

    return { rows: rows as readonly Row[] };
  }

  routeStatementKinds(): string[] {
    return this.queries
      .map(({ sql }) => classifyStatement(sql))
      .filter((kind) =>
        [
          "preflight_policy_head",
          "lock_policy_version",
          "lock_dispatch",
          "lock_reroute_attempts",
          "lock_reroute_provider_intent",
          "lock_reroute_original_route",
          "lock_binding_fence",
          "cas_dispatch",
          "insert_route"
        ].includes(kind)
      );
  }
}

function routeContextHash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

class QueueOutboundExecutor implements InboxV2OutboundTransportTransactionExecutor {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactionConfigs: Array<
    Readonly<{ isolationLevel: "read committed" | "repeatable read" }>
  > = [];
  private responseIndex = 0;

  constructor(
    private readonly responses: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async transaction<TResult>(
    work: (transaction: QueueOutboundExecutor) => Promise<TResult>,
    config: Readonly<{
      isolationLevel: "read committed" | "repeatable read";
    }>
  ): Promise<TResult> {
    this.transactionConfigs.push(config);
    return work(this);
  }

  async execute<Row extends Record<string, unknown>>(query: SQL) {
    const rendered = renderQuery(query);
    this.queries.push(rendered);
    const rows = this.responses[this.responseIndex];
    this.responseIndex += 1;
    if (rows === undefined) {
      throw new Error(`Unexpected SQL: ${normalizeSql(rendered.sql)}`);
    }
    return { rows: rows as readonly Row[] };
  }

  statementKinds(): string[] {
    return this.queries.map(({ sql }) => classifyStatement(sql));
  }
}

function classifyStatement(sql: string): string {
  const statement = normalizeSql(sql);
  if (
    statement.includes("from inbox_v2_outbox_intents intent") &&
    statement.includes("join inbox_v2_outbox_work_items work")
  )
    return "lock_reroute_provider_intent";
  if (
    statement.includes("from inbox_v2_outbound_dispatch_attempts attempt") &&
    statement.includes("for share of attempt")
  )
    return "lock_reroute_attempts";
  if (statement.includes("from public.inbox_v2_outbox_work_items"))
    return "lock_provider_io_outbox";
  if (
    statement.includes("current_content_fence(content_plan_id)") ||
    statement.includes("valid_file_pins(block_key)") ||
    statement.includes(
      "join inbox_v2_source_thread_binding_capability_entries capability"
    )
  )
    return "validate_provider_capabilities";
  if (statement.includes("from inbox_v2_file_outbound_dispatch_plans"))
    return "load_dispatch_content_plan";
  if (statement.includes("pg_advisory_xact_lock"))
    return "lock_policy_advisory";
  if (
    statement.includes("from inbox_v2_thread_route_policy_heads") &&
    statement.startsWith("select")
  )
    return "preflight_policy_head";
  if (
    statement.includes("from inbox_v2_thread_route_policy_versions") &&
    statement.startsWith("select")
  )
    return "lock_policy_version";
  if (statement.startsWith("insert into inbox_v2_thread_route_policy_versions"))
    return "insert_policy";
  if (statement.startsWith("insert into inbox_v2_thread_route_policy_heads"))
    return "advance_policy_head";
  if (
    statement.includes("from inbox_v2_source_thread_binding_heads") &&
    statement.includes("head.binding_id in")
  )
    return "lock_reroute_binding_fences";
  if (statement.includes("from inbox_v2_source_thread_binding_heads"))
    return "lock_binding_fence";
  if (statement.startsWith("insert into inbox_v2_outbound_routes"))
    return "insert_route";
  if (
    statement.includes("from inbox_v2_messages") &&
    statement.startsWith("select")
  )
    return "lock_message";
  if (
    statement.includes("from inbox_v2_outbound_routes route_row") &&
    statement.includes("route_row.binding_revision") &&
    statement.startsWith("select")
  )
    return "lock_reroute_original_route";
  if (
    statement.includes("from inbox_v2_outbound_routes") &&
    statement.startsWith("select")
  )
    return "lock_route";
  if (statement.startsWith("insert into inbox_v2_outbound_dispatches"))
    return "insert_dispatch";
  if (
    statement.includes("from inbox_v2_outbound_dispatches") &&
    statement.startsWith("select")
  )
    return "lock_dispatch";
  if (statement.startsWith("insert into inbox_v2_outbound_dispatch_attempts"))
    return "insert_attempt";
  if (
    statement.includes("from inbox_v2_outbound_dispatch_attempts") &&
    statement.startsWith("select")
  )
    return "lock_attempt";
  if (statement.startsWith("update inbox_v2_outbound_dispatch_attempts"))
    return "cas_attempt";
  if (statement.startsWith("update inbox_v2_outbound_dispatches"))
    return "cas_dispatch";
  if (
    statement.startsWith(
      "insert into inbox_v2_outbound_dispatch_reconciliation_decisions"
    )
  )
    return "insert_reconciliation";
  if (statement.startsWith("insert into inbox_v2_outbound_dispatch_artifacts"))
    return "insert_artifact";
  if (
    statement.includes("from inbox_v2_outbound_dispatch_artifacts") &&
    statement.includes("as retry_safe")
  )
    return "check_artifact_retry_safety";
  if (
    statement.includes("from inbox_v2_outbound_dispatch_artifacts") &&
    statement.includes("order by ordinal") &&
    statement.includes("for update")
  )
    return "lock_artifact_set";
  if (statement.startsWith("insert into public.inbox_v2_outbox_outcomes"))
    return "insert_outbox_outcome";
  if (statement.startsWith("update public.inbox_v2_outbox_work_items"))
    return "finalize_outbox";
  return `unknown:${statement.slice(0, 80)}`;
}

const providerIoLeaseToken = inboxV2OutboxLeaseTokenSchema.parse(
  `lease-token:provider-io-unit-${"t".repeat(40)}`
);
const providerIoContentPlan = (() => {
  const base = {
    tenantId: fixture.tenantId,
    id: "outbound_dispatch_content_plan:provider-io-unit",
    dispatch: fixture.references.dispatch,
    message: fixture.queuedDispatch.message,
    messageRevision: "1",
    conversation: fixture.references.conversation,
    timelineItem: fixture.references.timelineItem,
    route: fixture.queuedDispatch.route,
    timelineContent: {
      tenantId: fixture.tenantId,
      kind: "timeline_content" as const,
      id: "timeline_content:provider-io-unit"
    },
    contentRevision: "1",
    contentFingerprint: {
      purposeId: "core:outbound_dispatch_content_plan" as const,
      keyGeneration: "outbound-content-key:g1",
      validUntil: "2026-08-18T09:00:00.000Z",
      hmacSha256: `hmac-sha256:${"a".repeat(64)}`
    },
    binding: fixture.route.sourceThreadBinding,
    bindingRevision: fixture.bindingHeadSnapshot.bindingRevision,
    capabilityRevision: fixture.route.bindingFence.capabilityRevision,
    adapterContract: fixture.route.adapterContract,
    blocks: [
      {
        blockKey: "body-1",
        blockKind: "text" as const,
        exactFileObjectPin: null,
        artifactOrdinal: 1
      }
    ],
    artifacts: [
      {
        ordinal: 1,
        grouping: "single" as const,
        capabilityId: "core:message-text-send" as const,
        operationId: fixture.route.operationId,
        blockKeys: ["body-1"]
      }
    ],
    createdAt: fixture.queuedDispatch.createdAt,
    revision: "1" as const
  };
  return inboxV2OutboundDispatchContentPlanSchema.parse({
    ...base,
    planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(base)
  });
})();

function acceptedProviderResultCommit() {
  const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
    ...fixture.completeUnknownCommit,
    attemptAfter: fixture.acceptedAttempt,
    completionSource: "provider_result",
    dispatchAfter: fixture.acceptedDispatch
  });
  if (commit.kind !== "complete_attempt") {
    throw new Error("Expected a complete provider-result fixture.");
  }
  return commit;
}

function acceptedProviderResultArtifact() {
  const attempt = fixture.acceptedAttempt;
  return inboxV2OutboundDispatchArtifactSchema.parse({
    tenantId: fixture.tenantId,
    id: deriveInboxV2OutboundDispatchArtifactId({
      tenantId: fixture.tenantId,
      dispatch: attempt.dispatch,
      route: attempt.route,
      attempt: {
        tenantId: fixture.tenantId,
        kind: "outbound_dispatch_attempt",
        id: attempt.id
      },
      ordinal: 1
    }),
    dispatch: attempt.dispatch,
    route: attempt.route,
    attempt: {
      tenantId: fixture.tenantId,
      kind: "outbound_dispatch_attempt",
      id: attempt.id
    },
    ordinal: 1,
    state: "accepted",
    diagnostic: null,
    createdAt: OUTBOUND_TEST_TIMES.acceptedAt,
    revision: "1"
  });
}

function mixedProviderResultFixture() {
  const { planDigestSha256: _digest, ...base } = providerIoContentPlan;
  const changed = {
    ...base,
    id: "outbound_dispatch_content_plan:provider-io-unit-mixed",
    blocks: [
      {
        blockKey: "body-1",
        blockKind: "text" as const,
        exactFileObjectPin: null,
        artifactOrdinal: 1
      },
      {
        blockKey: "location-1",
        blockKind: "location" as const,
        exactFileObjectPin: null,
        artifactOrdinal: 2
      }
    ],
    artifacts: [
      {
        ordinal: 1,
        grouping: "split" as const,
        capabilityId: "core:message-text-send" as const,
        operationId: fixture.route.operationId,
        blockKeys: ["body-1"]
      },
      {
        ordinal: 2,
        grouping: "split" as const,
        capabilityId: "core:message-location-send" as const,
        operationId: fixture.route.operationId,
        blockKeys: ["location-1"]
      }
    ]
  };
  const contentPlan = inboxV2OutboundDispatchContentPlanSchema.parse({
    ...changed,
    planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(changed)
  });
  const mixedDiagnostic = createInboxV2MixedProviderArtifactOutcomeDiagnostic(
    fixture.pendingAttempt.claimToken
  );
  const retryableDiagnostic = {
    codeId: "core:provider-artifact-temporary-failure",
    retryable: true,
    correlationToken: "provider:artifact-two-failure",
    safeOperatorHintId: null
  } as const;
  const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
    ...fixture.completeUnknownCommit,
    attemptAfter: {
      ...fixture.pendingAttempt,
      outcome: {
        kind: "outcome_unknown",
        completedAt: OUTBOUND_TEST_TIMES.acceptedAt,
        diagnostic: mixedDiagnostic,
        requiredAction: "operator_duplicate_risk_decision_required"
      },
      completionSource: "provider_result",
      revision: "2"
    },
    completionSource: "provider_result",
    dispatchAfter: {
      ...fixture.attemptingDispatch,
      state: "outcome_unknown",
      activeAttempt: null,
      revision: "3",
      updatedAt: OUTBOUND_TEST_TIMES.acceptedAt
    }
  });
  if (commit.kind !== "complete_attempt")
    throw new Error("Expected completion");
  const artifacts = [
    inboxV2OutboundDispatchArtifactSchema.parse({
      tenantId: fixture.tenantId,
      id: deriveInboxV2OutboundDispatchArtifactId({
        tenantId: fixture.tenantId,
        dispatch: fixture.pendingAttempt.dispatch,
        route: fixture.pendingAttempt.route,
        attempt: {
          tenantId: fixture.tenantId,
          kind: "outbound_dispatch_attempt",
          id: fixture.pendingAttempt.id
        },
        ordinal: 1
      }),
      dispatch: fixture.pendingAttempt.dispatch,
      route: fixture.pendingAttempt.route,
      attempt: {
        tenantId: fixture.tenantId,
        kind: "outbound_dispatch_attempt",
        id: fixture.pendingAttempt.id
      },
      ordinal: 1,
      state: "accepted",
      diagnostic: null,
      createdAt: OUTBOUND_TEST_TIMES.acceptedAt,
      revision: "1"
    }),
    inboxV2OutboundDispatchArtifactSchema.parse({
      tenantId: fixture.tenantId,
      id: deriveInboxV2OutboundDispatchArtifactId({
        tenantId: fixture.tenantId,
        dispatch: fixture.pendingAttempt.dispatch,
        route: fixture.pendingAttempt.route,
        attempt: {
          tenantId: fixture.tenantId,
          kind: "outbound_dispatch_attempt",
          id: fixture.pendingAttempt.id
        },
        ordinal: 2
      }),
      dispatch: fixture.pendingAttempt.dispatch,
      route: fixture.pendingAttempt.route,
      attempt: {
        tenantId: fixture.tenantId,
        kind: "outbound_dispatch_attempt",
        id: fixture.pendingAttempt.id
      },
      ordinal: 2,
      state: "failed",
      diagnostic: retryableDiagnostic,
      createdAt: OUTBOUND_TEST_TIMES.acceptedAt,
      revision: "1"
    })
  ] as const;
  return { contentPlan, commit, artifacts };
}

function providerIoContentPlanWithBindingRevision(bindingRevision: string) {
  const { planDigestSha256: _digest, ...base } = providerIoContentPlan;
  const changed = { ...base, bindingRevision };
  return inboxV2OutboundDispatchContentPlanSchema.parse({
    ...changed,
    planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(changed)
  });
}

function providerIoContentPlanWithPinnedFile() {
  const { planDigestSha256: _digest, ...base } = providerIoContentPlan;
  const changed = {
    ...base,
    blocks: [
      {
        ...base.blocks[0]!,
        blockKind: "image" as const,
        exactFileObjectPin: {
          file: {
            tenantId: fixture.tenantId,
            kind: "file" as const,
            id: "file:provider-open-unit"
          },
          fileRevision: "2",
          fileVersion: {
            tenantId: fixture.tenantId,
            kind: "file_version" as const,
            id: "file_version:provider-open-unit-v1"
          },
          objectVersion: {
            tenantId: fixture.tenantId,
            kind: "file_object_version" as const,
            id: "file_object_version:provider-open-unit-v1"
          }
        }
      }
    ]
  };
  return inboxV2OutboundDispatchContentPlanSchema.parse({
    ...changed,
    planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(changed)
  });
}

function providerIoContentPlanRow(
  plan: typeof providerIoContentPlan = providerIoContentPlan
) {
  const block = plan.blocks[0]!;
  const pin = block.exactFileObjectPin;
  return {
    plan_id: plan.id,
    dispatch_id: plan.dispatch.id,
    message_id: plan.message.id,
    message_revision: plan.messageRevision,
    conversation_id: plan.conversation.id,
    timeline_item_id: plan.timelineItem.id,
    route_id: plan.route.id,
    content_id: plan.timelineContent.id,
    content_revision: plan.contentRevision,
    content_fingerprint_purpose_id: plan.contentFingerprint.purposeId,
    content_fingerprint_key_generation: plan.contentFingerprint.keyGeneration,
    content_fingerprint_valid_until: plan.contentFingerprint.validUntil,
    content_fingerprint_hmac_sha256: plan.contentFingerprint.hmacSha256,
    binding_id: plan.binding.id,
    binding_revision: plan.bindingRevision,
    capability_revision: plan.capabilityRevision,
    adapter_contract_id: plan.adapterContract.contractId,
    adapter_contract_version: plan.adapterContract.contractVersion,
    adapter_contract_declaration_revision:
      plan.adapterContract.declarationRevision,
    adapter_surface_id: plan.adapterContract.surfaceId,
    adapter_loaded_by_trusted_service_id:
      plan.adapterContract.loadedByTrustedServiceId,
    adapter_loaded_at: plan.adapterContract.loadedAt,
    plan_digest_sha256: plan.planDigestSha256,
    plan_created_at: plan.createdAt,
    artifact_id: "outbound_dispatch_artifact_plan:provider-io-unit",
    artifact_ordinal: 1,
    grouping: "single",
    capability_id: "core:message-text-send",
    operation_id: plan.artifacts[0]!.operationId,
    artifact_block_ordinal: 1,
    content_block_ordinal: 0,
    block_key: block.blockKey,
    block_kind: block.blockKind,
    file_id: pin?.file.id ?? null,
    file_revision: pin?.fileRevision ?? null,
    file_version_id: pin?.fileVersion.id ?? null,
    object_version_id: pin?.objectVersion.id ?? null
  };
}

function providerIoContentPlanRows(
  plan: ReturnType<typeof mixedProviderResultFixture>["contentPlan"]
) {
  const base = providerIoContentPlanRow(plan);
  return plan.artifacts.flatMap((artifact) =>
    artifact.blockKeys.map((blockKey, artifactBlockIndex) => {
      const contentBlockIndex = plan.blocks.findIndex(
        (block) => block.blockKey === blockKey
      );
      const block = plan.blocks[contentBlockIndex]!;
      return {
        ...base,
        artifact_id: `outbound_dispatch_artifact_plan:provider-io-unit-${artifact.ordinal}`,
        artifact_ordinal: artifact.ordinal,
        grouping: artifact.grouping,
        capability_id: artifact.capabilityId,
        operation_id: artifact.operationId,
        artifact_block_ordinal: artifactBlockIndex + 1,
        content_block_ordinal: contentBlockIndex,
        block_key: block.blockKey,
        block_kind: block.blockKind
      };
    })
  );
}
const providerIoWorkerId = inboxV2OutboxWorkerIdSchema.parse(
  "core:provider-dispatch-worker"
);
const providerIoIntent = inboxV2OutboxIntentSchema.parse({
  tenantId: fixture.tenantId,
  id: "outbox-intent:provider-io-unit",
  typeId: "core:provider.dispatch",
  handlerId: providerIoWorkerId,
  effectClass: "provider_io",
  commit: {
    tenantId: fixture.tenantId,
    streamEpoch: "stream-epoch:provider-io-unit",
    commitId: "commit:provider-io-unit",
    streamPosition: "1"
  },
  eventId: "event:provider-io-unit",
  changeIds: ["change:provider-io-unit"],
  payloadReference: {
    tenantId: fixture.tenantId,
    recordId: fixture.queuedDispatch.id,
    schemaId: "core:inbox-v2.outbound-dispatch",
    schemaVersion: "v1",
    digest: `sha256:${"d".repeat(64)}`
  },
  consumerDedupeKey: `sha256:${"e".repeat(64)}`,
  correlationId: "correlation:provider-io-unit",
  availableAt: "2026-07-14T08:01:00.000Z",
  intentHash: `sha256:${"f".repeat(64)}`
});
const providerIoOutboxLeaseFence = {
  context: { tenantId: providerIoIntent.tenantId },
  intentId: providerIoIntent.id,
  workerId: providerIoWorkerId,
  leaseToken: providerIoLeaseToken,
  expectedLeaseRevision: inboxV2EntityRevisionSchema.parse("1"),
  expectedHandlerId: providerIoIntent.handlerId
} as const;

function providerIoOutboxLeaseRow(input?: {
  databaseNow?: string;
  leaseTokenHash?: string;
}) {
  return {
    state: "leased",
    work_revision: "2",
    lease_owner_id: providerIoOutboxLeaseFence.workerId,
    lease_token_hash:
      input?.leaseTokenHash ??
      calculateInboxV2OutboxLeaseTokenHash(providerIoLeaseToken),
    lease_revision: providerIoOutboxLeaseFence.expectedLeaseRevision,
    lease_claimed_at: "2026-07-14T08:01:30.000Z",
    lease_expires_at: "2026-07-14T08:10:00.000Z",
    database_now: input?.databaseNow ?? "2026-07-14T08:02:30.000Z",
    intent_id: providerIoIntent.id,
    intent_type_id: providerIoIntent.typeId,
    intent_handler_id: providerIoIntent.handlerId,
    intent_effect_class: providerIoIntent.effectClass,
    intent_stream_commit_id: providerIoIntent.commit.commitId,
    intent_stream_position: providerIoIntent.commit.streamPosition,
    intent_stream_epoch: providerIoIntent.commit.streamEpoch,
    intent_event_id: providerIoIntent.eventId,
    intent_change_ids: providerIoIntent.changeIds,
    intent_payload_reference: providerIoIntent.payloadReference,
    intent_consumer_dedupe_key: providerIoIntent.consumerDedupeKey,
    intent_correlation_id: providerIoIntent.correlationId,
    intent_available_at: providerIoIntent.availableAt,
    intent_hash: providerIoIntent.intentHash
  };
}

function bindingFenceRow(
  input: typeof fixture,
  head: {
    bindingRevision: string;
    fence: {
      accountGeneration: string;
      bindingGeneration: string;
      capabilityRevision: string;
      routeDescriptorRevision: string;
    };
    remoteAccess: { revision: string; state: string };
    administrative: { revision: string; state: string };
    runtimeHealth: { revision: string; state: string };
    updatedAt: string;
  } = input.bindingHeadSnapshot
) {
  return {
    binding_id: input.references.binding.id,
    external_thread_id: input.references.externalThread.id,
    source_connection_id: input.references.sourceConnection.id,
    source_account_id: input.references.sourceAccount.id,
    binding_revision: head.bindingRevision,
    account_generation: head.fence.accountGeneration,
    binding_generation: head.fence.bindingGeneration,
    remote_access_revision: head.remoteAccess.revision,
    administrative_revision: head.administrative.revision,
    capability_revision: head.fence.capabilityRevision,
    provider_access_revision: input.bindingHeadSnapshot.providerAccessRevision,
    route_descriptor_revision: head.fence.routeDescriptorRevision,
    remote_access_state: head.remoteAccess.state,
    administrative_state: head.administrative.state,
    runtime_health_state: head.runtimeHealth.state,
    runtime_health_revision: head.runtimeHealth.revision,
    updated_at: head.updatedAt
  };
}

function routeFailureCommit(
  kind: "structural" | "admin_disabled" | "runtime",
  overrides: { failedAt?: string } = {}
) {
  const failedAt = overrides.failedAt ?? OUTBOUND_TEST_TIMES.openedAt;
  const structural = kind === "structural";
  const adminDisabled = kind === "admin_disabled";
  const bindingHeadSnapshot = {
    ...fixture.bindingHeadSnapshot,
    fence: {
      ...fixture.bindingHeadSnapshot.fence,
      ...(structural ? { bindingGeneration: "2" } : {}),
      ...(adminDisabled ? { administrativeRevision: "2" } : {})
    },
    runtimeHealth:
      kind === "runtime"
        ? { state: "unavailable" as const, revision: "2" }
        : fixture.bindingHeadSnapshot.runtimeHealth,
    administrative: adminDisabled
      ? {
          state: "disabled" as const,
          revision: "2"
        }
      : fixture.bindingHeadSnapshot.administrative,
    bindingRevision: "2",
    updatedAt: OUTBOUND_TEST_TIMES.openedAt
  };
  return inboxV2OutboundDispatchRouteFailureCommitSchema.parse({
    tenantId: fixture.tenantId,
    routeSnapshot: fixture.route,
    bindingHeadSnapshot,
    error:
      structural || adminDisabled
        ? {
            code: "route.binding_changed",
            retryability: "retryable_resolution",
            diagnostic: null
          }
        : {
            code: "route.runtime_unavailable",
            retryability: "retryable_same_route",
            diagnostic: null
          },
    dispatchBefore: fixture.queuedDispatch,
    dispatchAfter:
      kind === "runtime"
        ? fixture.queuedDispatch
        : {
            ...fixture.queuedDispatch,
            state: "terminal_failure",
            revision: "2",
            updatedAt: failedAt
          },
    failedByTrustedServiceId:
      fixture.route.adapterContract.loadedByTrustedServiceId,
    failedAt
  });
}

function dispatchRow(dispatch: typeof fixture.queuedDispatch) {
  return {
    tenant_id: dispatch.tenantId,
    id: dispatch.id,
    message_id: dispatch.message.id,
    route_id: dispatch.route.id,
    multi_send_operation_id: dispatch.multiSendOperation?.id ?? null,
    state: dispatch.state,
    attempt_count: dispatch.attemptCount,
    active_attempt_id: dispatch.activeAttempt?.id ?? null,
    last_attempt_id: dispatch.lastAttempt?.id ?? null,
    retry_authorization_decision_id: dispatch.retryAuthorization?.id ?? null,
    revision: dispatch.revision,
    created_at: dispatch.createdAt,
    updated_at: dispatch.updatedAt
  };
}

function externalMessageReferenceRow(
  reference: NonNullable<
    (typeof fixture.echoAssociation.occurrenceResolution)["resolvedReference"]
  >
) {
  const scope = reference.key.scope;
  return {
    tenant_id: reference.tenantId,
    id: reference.id,
    realm_id: reference.key.realm.realmId,
    realm_version: reference.key.realm.realmVersion,
    canonicalization_version: reference.key.realm.canonicalizationVersion,
    scope_kind: scope.kind,
    scope_source_account_id:
      scope.kind === "source_account" ? scope.owner.id : null,
    scope_source_thread_binding_id:
      scope.kind === "source_thread_binding" ? scope.owner.id : null,
    object_kind_id: reference.key.objectKindId,
    canonical_external_subject: reference.key.canonicalExternalSubject,
    message_key_digest_sha256: computeInboxV2ExternalMessageKeyDigest(
      reference.key
    ),
    identity_declaration: reference.identityDeclaration,
    external_thread_id: reference.externalThread.id,
    conversation_id: fixture.references.conversation.id,
    timeline_item_id: reference.timelineItem.id,
    message_id: reference.message.id,
    revision: reference.revision,
    created_at: reference.createdAt
  };
}

function attemptRow(attempt: typeof fixture.pendingAttempt) {
  const outcome = attempt.outcome;
  const diagnostic =
    outcome.kind === "pending" || outcome.kind === "accepted"
      ? null
      : outcome.diagnostic;
  return {
    id: attempt.id,
    dispatch_id: attempt.dispatch.id,
    route_id: attempt.route.id,
    message_id: fixture.references.message.id,
    attempt_number: attempt.attemptNumber,
    claim_token: attempt.claimToken,
    retry_safety_mechanism: attempt.retrySafety.mechanism,
    retry_safety_adapter_contract_snapshot: attempt.retrySafety.adapterContract,
    retry_safety_declared_by_trusted_service_id:
      attempt.retrySafety.declaredByTrustedServiceId,
    retry_safety_declaration_token: attempt.retrySafety.declarationToken,
    retry_safety_declared_at: attempt.retrySafety.declaredAt,
    provider_correlation_token: attempt.retrySafety.providerCorrelationToken,
    automatic_retry_allowed: attempt.retrySafety.automaticRetryAllowed,
    lease_expires_at: attempt.leaseExpiresAt,
    opened_at: attempt.openedAt,
    outcome_kind: outcome.kind,
    completion_source: attempt.completionSource,
    completed_at: outcome.kind === "pending" ? null : outcome.completedAt,
    retry_at: outcome.kind === "retryable_failure" ? outcome.retryAt : null,
    provider_acknowledgement_token:
      outcome.kind === "accepted" ? outcome.providerAcknowledgementToken : null,
    diagnostic_code_id: diagnostic?.codeId ?? null,
    diagnostic_retryable: diagnostic?.retryable ?? null,
    diagnostic_correlation_token: diagnostic?.correlationToken ?? null,
    diagnostic_safe_operator_hint_id: diagnostic?.safeOperatorHintId ?? null,
    unknown_required_action:
      outcome.kind === "outcome_unknown" ? outcome.requiredAction : null,
    revision: attempt.revision
  };
}

function artifactRow(
  artifact: ReturnType<typeof acceptedProviderResultArtifact>
) {
  return {
    id: artifact.id,
    dispatch_id: artifact.dispatch.id,
    route_id: artifact.route.id,
    attempt_id: artifact.attempt.id,
    message_id: fixture.references.message.id,
    ordinal: artifact.ordinal,
    state: artifact.state,
    diagnostic_code_id: artifact.diagnostic?.codeId ?? null,
    diagnostic_retryable: artifact.diagnostic?.retryable ?? null,
    diagnostic_correlation_token: artifact.diagnostic?.correlationToken ?? null,
    diagnostic_safe_operator_hint_id:
      artifact.diagnostic?.safeOperatorHintId ?? null,
    created_at: artifact.createdAt,
    revision: artifact.revision
  };
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
