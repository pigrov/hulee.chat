import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildCompareAndSwapInboxV2OutboundDispatchAttemptSql,
  buildCompareAndSwapInboxV2OutboundDispatchSql,
  buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql,
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
  computeInboxV2ExternalMessageKeyDigest,
  createSqlInboxV2OutboundTransportRepository,
  type InboxV2OutboundTransportTransactionExecutor
} from "./sql-inbox-v2-outbound-transport-repository";
import { createOutboundTransportContractFixture } from "./sql-inbox-v2-outbound-transport-repository.test-support";

const fixture = createOutboundTransportContractFixture();

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

    const executor = new QueueOutboundExecutor([
      [{ id: fixture.artifacts[0]?.id }],
      [{ id: fixture.artifacts[1]?.id }]
    ]);
    const repository = createSqlInboxV2OutboundTransportRepository(executor);
    await expect(
      repository.appendArtifact(fixture.artifacts[0])
    ).resolves.toEqual({ kind: "committed" });
    await expect(
      repository.appendArtifact(fixture.artifacts[1])
    ).resolves.toEqual({ kind: "committed" });

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
  if (statement.includes("pg_advisory_xact_lock"))
    return "lock_policy_advisory";
  if (
    statement.includes("from inbox_v2_thread_route_policy_heads") &&
    statement.startsWith("select")
  )
    return "preflight_policy_head";
  if (statement.startsWith("insert into inbox_v2_thread_route_policy_versions"))
    return "insert_policy";
  if (statement.startsWith("insert into inbox_v2_thread_route_policy_heads"))
    return "advance_policy_head";
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
  return `unknown:${statement.slice(0, 80)}`;
}

function bindingFenceRow(input: typeof fixture) {
  return {
    binding_id: input.references.binding.id,
    external_thread_id: input.references.externalThread.id,
    source_connection_id: input.references.sourceConnection.id,
    source_account_id: input.references.sourceAccount.id,
    binding_revision: input.bindingHeadSnapshot.bindingRevision,
    account_generation: input.bindingFence.accountGeneration,
    binding_generation: input.bindingFence.bindingGeneration,
    remote_access_revision: input.bindingFence.remoteAccessRevision,
    administrative_revision: input.bindingFence.administrativeRevision,
    capability_revision: input.bindingFence.capabilityRevision,
    route_descriptor_revision: input.bindingFence.routeDescriptorRevision,
    remote_access_state: "active",
    administrative_state: "enabled",
    runtime_health_state: "ready"
  };
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

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
