import {
  deriveInboxV2RouteFailureOutboxFinalization,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2NamespacedIdSchema,
  inboxV2OutboundDispatchArtifactAssociationCommitSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchReconciliationCommitSchema,
  inboxV2OutboundDispatchRerouteCommitSchema,
  inboxV2OutboundDispatchRouteFailureCommitSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundRouteResolutionCommitSchema,
  inboxV2OutboundRouteResolutionInputSchema,
  inboxV2OutboundRouteSchema,
  inboxV2OutboxIntentIdSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantIdSchema,
  inboxV2ThreadRoutePolicySchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentSchema,
  materializeInboxV2OutboundRouteResolutionCommit,
  resolveInboxV2OutboundRoute,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2OutboundDispatchArtifactAssociationCommit
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInboxV2ProviderDispatchCoordinator } from "../../../../apps/worker/src/inbox-v2-provider-dispatch-coordinator";
import {
  fixtureOutboundBindingSnapshot,
  fixtureReference
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  computeInboxV2LeafHashDigest,
  computeInboxV2TenantStreamManifestDigest,
  createSqlInboxV2AuthorizedCommandCoordinator,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import {
  buildCompareAndSwapInboxV2OutboundDispatchSql,
  buildInsertInboxV2OutboundDispatchAttemptSql,
  buildInsertInboxV2OutboundDispatchSql,
  buildInsertInboxV2OutboundRouteSql,
  createSqlInboxV2OutboundTransportRepository,
  persistInboxV2ExplicitRerouteResolutionInTransaction,
  persistInboxV2RouteResolutionInTransaction
} from "./sql-inbox-v2-outbound-transport-repository";
import { createSqlInboxV2RepositoryOutbox } from "./sql-inbox-v2-repository-outbox";
import {
  computeInboxV2TimelineMessageCommitDigest,
  prepareInboxV2MessageCreation,
  sealInboxV2PreparedMessageCreation
} from "./sql-inbox-v2-timeline-message-repository";
import {
  createOutboundTransportContractFixture,
  OUTBOUND_TEST_TIMES
} from "./sql-inbox-v2-outbound-transport-repository.test-support";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

describePostgres(
  "SQL Inbox V2 outbound transport repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    const tenantIds: string[] = [];

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{
        routes: string | null;
        dispatches: string | null;
        attempts: string | null;
        artifacts: string | null;
        reconciliation: string | null;
        route_guard: string | null;
      }>(sql`
        select
          to_regclass('public.inbox_v2_outbound_routes')::text as routes,
          to_regclass('public.inbox_v2_outbound_dispatches')::text as dispatches,
          to_regclass(
            'public.inbox_v2_outbound_dispatch_attempts'
          )::text as attempts,
          to_regclass(
            'public.inbox_v2_outbound_dispatch_artifacts'
          )::text as artifacts,
          to_regclass(
            'public.inbox_v2_outbound_dispatch_reconciliation_decisions'
          )::text as reconciliation,
          to_regprocedure(
            'public.inbox_v2_outbound_route_guard_insert()'
          )::text as route_guard
      `);
      expect(readiness.rows[0]).toEqual({
        routes: "inbox_v2_outbound_routes",
        dispatches: "inbox_v2_outbound_dispatches",
        attempts: "inbox_v2_outbound_dispatch_attempts",
        artifacts: "inbox_v2_outbound_dispatch_artifacts",
        reconciliation: "inbox_v2_outbound_dispatch_reconciliation_decisions",
        route_guard: "inbox_v2_outbound_route_guard_insert()"
      });
    });

    afterAll(async () => {
      if (!db) return;
      for (const tenantId of tenantIds.reverse()) {
        await db.transaction(async (transaction) => {
          // The fixture spans identity, binding, timeline and transport tables
          // whose tenant FKs intentionally use different delete policies. Purge
          // only this synthetic tenant while RI triggers are locally disabled;
          // this keeps repeated integration runs independent as the graph grows.
          await transaction.execute(
            sql`select set_config('hulee.test_cleanup_tenant', ${tenantId}, true)`
          );
          await transaction.execute(
            sql`set local session_replication_role = replica`
          );
          await transaction.execute(sql`
            do $cleanup$
            declare
              cleanup_table text;
              cleanup_tenant text := current_setting(
                'hulee.test_cleanup_tenant'
              );
            begin
              for cleanup_table in
                select columns.table_name
                  from information_schema.columns columns
                  join information_schema.tables tables
                    on tables.table_schema = columns.table_schema
                   and tables.table_name = columns.table_name
                 where columns.table_schema = 'public'
                   and columns.column_name = 'tenant_id'
                   and tables.table_type = 'BASE TABLE'
                   and columns.table_name <> 'tenants'
                 order by columns.table_name
              loop
                execute format(
                  'delete from public.%I where tenant_id = $1',
                  cleanup_table
                ) using cleanup_tenant;
              end loop;
              delete from public.tenants where id = cleanup_tenant;
            end
            $cleanup$
          `);
          await transaction.execute(
            sql`set local session_replication_role = origin`
          );
        });
      }
      await closeHuleeDatabase(db);
    });

    it("commits route, Message, queued dispatch and provider intent atomically before provider I/O", async () => {
      const fixture = fixtureFor("atomic-producer");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      const input = authorizedExternalSendInput(fixture);
      const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);
      let prepareCount = 0;
      let sealCount = 0;
      let failAfterMessageSeal = true;

      const materialize = () =>
        coordinator.withAuthorizedAtomicMaterialization(
          input,
          async (context) => {
            prepareCount += 1;
            const route = await persistInboxV2RouteResolutionInTransaction(
              context,
              fixture.routeCommit
            );
            if (route.kind !== "committed" && route.kind !== "already_exists") {
              throw new Error(`Atomic route preparation failed: ${route.kind}`);
            }
            const prepared = await prepareInboxV2MessageCreation(context, {
              commit: fixture.messageCreationCommit
            });
            if (prepared.kind !== "ready") {
              throw new Error(
                `Atomic Message preparation failed: ${prepared.kind}`
              );
            }
            return prepared.capability;
          },
          async (context, capability) => {
            sealCount += 1;
            const sealed = await sealInboxV2PreparedMessageCreation(context, {
              capability
            });
            if (failAfterMessageSeal) {
              throw new Error("injected failure after outbound Message seal");
            }
            return {
              result: {
                messageId: sealed.message.id,
                dispatchId: fixture.queuedDispatch.id
              },
              receipt: sealed.receipt
            };
          }
        );

      await expect(materialize()).rejects.toThrow(
        "injected failure after outbound Message seal"
      );
      expect(await loadAtomicOutboundProducerCounts(db, fixture)).toMatchObject(
        {
          commands: "0",
          stream_commits: "0",
          stream_heads: "1",
          stream_position: "1",
          policy_versions: "1",
          policy_heads: "1",
          routes: "0",
          messages: "0",
          dispatches: "0",
          atomic_dispatch_materializations: "0",
          attempts: "0",
          outbox_intents: "0",
          outbox_work: "0"
        }
      );

      failAfterMessageSeal = false;
      await expect(materialize()).resolves.toMatchObject({
        kind: "applied",
        result: {
          messageId: fixture.references.message.id,
          dispatchId: fixture.queuedDispatch.id
        },
        status: { streamPosition: "2" }
      });
      expect(await loadAtomicOutboundProducerCounts(db, fixture)).toEqual({
        commands: "1",
        stream_commits: "1",
        stream_heads: "1",
        stream_position: "2",
        changes: "2",
        events: "1",
        policy_versions: "1",
        policy_heads: "1",
        routes: "1",
        messages: "1",
        dispatches: "1",
        atomic_dispatch_materializations: "1",
        queued_dispatches: "1",
        attempts: "0",
        outbox_intents: "2",
        provider_intents: "1",
        outbox_work: "2"
      });

      await expect(
        coordinator.withAuthorizedAtomicMaterialization(
          input,
          async () => {
            throw new Error("committed replay must not prepare domain state");
          },
          async () => {
            throw new Error("committed replay must not seal domain state");
          }
        )
      ).resolves.toMatchObject({
        kind: "already_applied",
        status: { streamPosition: "2" }
      });
      expect(prepareCount).toBe(2);
      expect(sealCount).toBe(2);
    });

    it("deduplicates a concurrent clientMutationId into one route, Message and dispatch", async () => {
      const fixture = fixtureFor("atomic-concurrent-mutation");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);

      const results = await Promise.all([
        persistAtomicOutboundProducer(db, fixture),
        persistAtomicOutboundProducer(db, fixture)
      ]);

      expect(results.map(({ kind }) => kind).sort()).toEqual([
        "already_applied",
        "applied"
      ]);
      expect(await loadAtomicOutboundProducerCounts(db, fixture)).toEqual({
        commands: "1",
        stream_commits: "1",
        stream_heads: "1",
        stream_position: "2",
        changes: "2",
        events: "1",
        policy_versions: "1",
        policy_heads: "1",
        routes: "1",
        messages: "1",
        dispatches: "1",
        atomic_dispatch_materializations: "1",
        queued_dispatches: "1",
        attempts: "0",
        outbox_intents: "2",
        provider_intents: "1",
        outbox_work: "2"
      });
    });

    it.each(["ready", "degraded", "unknown", "unavailable"] as const)(
      "atomically commits Message, route, queued dispatch and provider outbox when runtime health is %s",
      async (runtimeHealthState) => {
        const fixture = fixtureFor(
          `atomic-runtime-health-${runtimeHealthState}`,
          runtimeHealthState
        );
        tenantIds.push(fixture.tenantId);
        await seedOutboundAnchors(db, fixture);

        await expect(
          persistAtomicOutboundProducer(db, fixture)
        ).resolves.toMatchObject({
          kind: "applied",
          result: { messageId: fixture.references.message.id }
        });
        expect(await loadAtomicOutboundProducerCounts(db, fixture)).toEqual({
          commands: "1",
          stream_commits: "1",
          stream_heads: "1",
          stream_position: "2",
          changes: "2",
          events: "1",
          policy_versions: "1",
          policy_heads: "1",
          routes: "1",
          messages: "1",
          dispatches: "1",
          atomic_dispatch_materializations: "1",
          queued_dispatches: "1",
          attempts: "0",
          outbox_intents: "2",
          provider_intents: "1",
          outbox_work: "2"
        });
        const runtimeEvidence = await db.execute<{
          route_state: string;
          binding_state: string;
          binding_revision: string;
          binding_checked_at: Date | string;
        }>(sql`
          select route_row.runtime_observation_snapshot #>> '{state}'
                   as route_state,
                 binding_snapshot.runtime_health_state::text
                   as binding_state,
                 binding_snapshot.runtime_health_revision::text
                   as binding_revision,
                 binding_snapshot.runtime_health_checked_at
                   as binding_checked_at
            from inbox_v2_outbound_routes route_row
            join inbox_v2_source_thread_binding_snapshots binding_snapshot
              on binding_snapshot.tenant_id = route_row.tenant_id
             and binding_snapshot.binding_id =
                 route_row.source_thread_binding_id
             and binding_snapshot.revision = route_row.binding_revision
           where route_row.tenant_id = ${fixture.tenantId}
             and route_row.id = ${fixture.route.id}
        `);
        expect(runtimeEvidence.rows[0]).toMatchObject({
          route_state: runtimeHealthState,
          binding_state: runtimeHealthState,
          binding_revision:
            fixture.route.runtimeObservationAtResolution.revision
        });
        const bindingCheckedAt = runtimeEvidence.rows[0]?.binding_checked_at;
        expect(
          bindingCheckedAt instanceof Date
            ? bindingCheckedAt.toISOString()
            : new Date(bindingCheckedAt ?? "invalid").toISOString()
        ).toBe(fixture.route.runtimeObservationAtResolution.observedAt);
      }
    );

    it.each(["unknown", "unavailable"] as const)(
      "keeps the same %s runtime route queued with zero attempts before provider I/O",
      async (runtimeHealthState) => {
        const fixture = fixtureFor(
          `atomic-runtime-retry-${runtimeHealthState}`,
          runtimeHealthState
        );
        tenantIds.push(fixture.tenantId);
        await seedOutboundAnchors(db, fixture);
        await expect(
          persistAtomicOutboundProducer(db, fixture)
        ).resolves.toMatchObject({ kind: "applied" });

        const providerIntent = authorizedExternalSendInput(
          fixture
        ).records.outboxIntents.find(
          (intent) => intent.typeId === "core:provider.dispatch"
        );
        if (providerIntent === undefined) {
          throw new Error("Runtime retry fixture has no provider intent.");
        }
        const tenantId = inboxV2TenantIdSchema.parse(fixture.tenantId);
        const workerId = inboxV2NamespacedIdSchema.parse(
          `core:runtime-retry-worker-${runtimeHealthState}`
        );
        const outbox = createSqlInboxV2RepositoryOutbox(db, {
          tokenSource: (count) =>
            Array.from(
              { length: count },
              (_, index) =>
                `lease-token:runtime-${runtimeHealthState}-${index}-${runId}-${"r".repeat(24)}`
            )
        });
        const claimed = await outbox.claimAvailable({
          context: { tenantId },
          workerId,
          leaseDurationSeconds: 30,
          batchSize: 2
        });
        if (claimed.outcome !== "claimed") {
          throw new Error("Runtime retry provider intent was not claimed.");
        }
        const providerClaim = claimed.claims.find(
          (claim) => claim.work.intentId === providerIntent.id
        );
        if (providerClaim === undefined || providerClaim.work.lease === null) {
          throw new Error("Runtime retry claim has no exact provider lease.");
        }
        const failedAt = providerClaim.work.lease.claimedAt;
        const commit = inboxV2OutboundDispatchRouteFailureCommitSchema.parse({
          tenantId: fixture.tenantId,
          routeSnapshot: fixture.route,
          bindingHeadSnapshot: {
            ...fixture.bindingHeadSnapshot,
            runtimeHealth: {
              state: runtimeHealthState,
              revision: fixture.route.runtimeObservationAtResolution.revision
            },
            updatedAt: OUTBOUND_TEST_TIMES.loadedAt
          },
          error: {
            code: "route.runtime_unavailable",
            retryability: "retryable_same_route",
            diagnostic: null
          },
          dispatchBefore: fixture.queuedDispatch,
          dispatchAfter: fixture.queuedDispatch,
          failedByTrustedServiceId:
            fixture.route.adapterContract.loadedByTrustedServiceId,
          failedAt
        });

        await expect(
          createSqlInboxV2OutboundTransportRepository(
            db
          ).applyRouteFailureFenced({
            outboxLease: {
              context: { tenantId },
              intentId: providerIntent.id,
              workerId,
              leaseToken: providerClaim.leaseToken,
              expectedLeaseRevision: providerClaim.work.lease.leaseRevision,
              expectedHandlerId: providerIntent.handlerId
            },
            commit
          })
        ).resolves.toEqual({ kind: "committed" });

        const state = await db.execute<{
          dispatch_state: string;
          route_id: string;
          attempt_count: string;
          provider_outbox_state: string;
          provider_outcome_count: string;
        }>(sql`
          select dispatch_row.state::text as dispatch_state,
                 dispatch_row.route_id,
                 (
                   select count(*)::text
                     from inbox_v2_outbound_dispatch_attempts attempt_row
                    where attempt_row.tenant_id = dispatch_row.tenant_id
                      and attempt_row.dispatch_id = dispatch_row.id
                 ) as attempt_count,
                 work.state::text as provider_outbox_state,
                 (
                   select count(*)::text
                     from inbox_v2_outbox_outcomes outcome_row
                    where outcome_row.tenant_id = work.tenant_id
                      and outcome_row.intent_id = work.intent_id
                 ) as provider_outcome_count
            from inbox_v2_outbound_dispatches dispatch_row
            join inbox_v2_outbox_work_items work
              on work.tenant_id = dispatch_row.tenant_id
             and work.intent_id = ${providerIntent.id}
           where dispatch_row.tenant_id = ${fixture.tenantId}
             and dispatch_row.id = ${fixture.queuedDispatch.id}
        `);
        expect(state.rows[0]).toEqual({
          dispatch_state: "queued",
          route_id: fixture.route.id,
          attempt_count: "0",
          provider_outbox_state: "leased",
          provider_outcome_count: "0"
        });
      }
    );

    it.each([
      "missing_provider_intent",
      "duplicate_provider_intents",
      "revision_2_dispatch_change",
      "dispatch_row_without_change_or_provider_intent"
    ] as const)(
      "rejects an incomplete atomic provider closure: %s",
      async (failureKind) => {
        const fixture = fixtureFor(`atomic-reject-${failureKind}`);
        tenantIds.push(fixture.tenantId);
        await seedOutboundAnchors(db, fixture);
        const baseInput = authorizedExternalSendInput(fixture);
        const input = atomicProviderClosureFailureInput(
          baseInput,
          fixture,
          failureKind
        );
        const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);

        const materialization = coordinator.withAuthorizedAtomicMaterialization(
          input,
          async (context) => {
            const route = await persistInboxV2RouteResolutionInTransaction(
              context,
              fixture.routeCommit
            );
            if (route.kind !== "committed" && route.kind !== "already_exists") {
              throw new Error(`Atomic route preparation failed: ${route.kind}`);
            }
            const prepared = await prepareInboxV2MessageCreation(context, {
              commit: fixture.messageCreationCommit
            });
            if (prepared.kind !== "ready") {
              throw new Error(
                `Atomic Message preparation failed: ${prepared.kind}`
              );
            }
            return prepared.capability;
          },
          async (context, capability) => {
            const sealed = await sealInboxV2PreparedMessageCreation(context, {
              capability
            });
            return { result: null, receipt: sealed.receipt };
          }
        );

        await expect(materialization).rejects.toThrow(
          "atomic Message seal manifest does not match"
        );
        expect(
          await loadAtomicOutboundProducerCounts(db, fixture)
        ).toMatchObject({
          commands: "0",
          stream_commits: "0",
          stream_heads: "1",
          stream_position: "1",
          policy_versions: "1",
          policy_heads: "1",
          routes: "0",
          messages: "0",
          dispatches: "0",
          atomic_dispatch_materializations: "0",
          attempts: "0",
          outbox_intents: "0",
          outbox_work: "0"
        });
      }
    );

    it("rejects a coherent duplicate Message projection in the deferred database closure", async () => {
      const fixture = fixtureFor("atomic-raw-duplicate-message-projection");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      const input = authorizedExternalSendInput(fixture);
      await expect(
        persistAtomicOutboundProducer(db, fixture)
      ).resolves.toMatchObject({ kind: "applied" });
      const messageChange = input.records.changes.find(
        ({ entity }) => entity.entityTypeId === "core:message"
      );
      const messageEvent = input.records.events.find(
        ({ typeId }) => typeId === "core:message.changed"
      );
      const projectionIntent = input.records.outboxIntents.find(
        ({ effectClass }) => effectClass === "projection"
      );
      if (
        messageChange === undefined ||
        messageEvent === undefined ||
        projectionIntent === undefined
      ) {
        throw new Error(
          "Atomic outbound fixture requires its Message projection closure."
        );
      }
      const duplicateProjection = {
        ...projectionIntent,
        id: inboxV2OutboxIntentIdSchema.parse(
          `outbox-intent:atomic-message-projection-duplicate-${fixture.suffix}`
        ),
        ordinal: input.records.outboxIntents.length + 1,
        handlerId: inboxV2NamespacedIdSchema.parse(
          "core:inbox-projection-duplicate"
        ),
        consumerDedupeKey: inboxV2Sha256DigestSchema.parse(
          sha256(`${fixture.suffix}:message-projection-duplicate-dedupe`)
        ),
        intentHash: inboxV2Sha256DigestSchema.parse(
          sha256(`${fixture.suffix}:message-projection-duplicate-intent`)
        )
      };

      await expectDatabaseFailure(
        insertCoherentDuplicateProjectionAndRecheckDomainClosure(
          db,
          input,
          duplicateProjection
        ),
        /23514 inbox_v2\.domain_mutation_stream_child_mismatch/u
      );
      expect(await loadAtomicOutboundProducerCounts(db, fixture)).toMatchObject(
        {
          outbox_intents: "2",
          outbox_work: "2"
        }
      );
    });

    it.each([
      ["missing exact route policy", "missing"],
      ["unpublished next route-policy revision", "next_revision"]
    ] as const)(
      "keeps the live authorized route seam read-only for %s",
      async (_label, policyState) => {
        const fixture = fixtureFor(`atomic-read-only-policy-${policyState}`);
        tenantIds.push(fixture.tenantId);
        await seedOutboundAnchors(db, fixture);
        if (policyState === "missing") {
          await db.transaction(async (transaction) => {
            await transaction.execute(
              sql`set local session_replication_role = replica`
            );
            await transaction.execute(sql`
              delete from inbox_v2_thread_route_policy_heads
               where tenant_id = ${fixture.tenantId}
                 and policy_id = ${fixture.routePolicy.id}
            `);
            await transaction.execute(sql`
              delete from inbox_v2_thread_route_policy_versions
               where tenant_id = ${fixture.tenantId}
                 and policy_id = ${fixture.routePolicy.id}
            `);
            await transaction.execute(
              sql`set local session_replication_role = origin`
            );
          });
        }
        const routeCommit =
          policyState === "next_revision"
            ? routeCommitAtPolicyRevision(fixture, "2")
            : fixture.routeCommit;
        const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);
        let routeResultKind: string | null = null;
        let sealCount = 0;

        const materialization = coordinator.withAuthorizedAtomicMaterialization(
          authorizedExternalSendInput(fixture),
          async (context) => {
            const routeResult =
              await persistInboxV2RouteResolutionInTransaction(
                context,
                routeCommit
              );
            routeResultKind = routeResult.kind;
            if (routeResult.kind !== "policy_conflict") {
              throw new Error(
                `Expected a read-only policy conflict, received ${routeResult.kind}.`
              );
            }
            throw new Error("route policy probe completed");
          },
          async () => {
            sealCount += 1;
            throw new Error("route policy probe must not reach seal");
          }
        );

        await expect(materialization).rejects.toThrow(
          "route policy probe completed"
        );
        expect(routeResultKind).toBe("policy_conflict");
        expect(sealCount).toBe(0);
        expect(
          await loadAtomicOutboundProducerCounts(db, fixture)
        ).toMatchObject({
          commands: "0",
          stream_commits: "0",
          stream_heads: "1",
          stream_position: "1",
          policy_versions: policyState === "missing" ? "0" : "1",
          policy_heads: policyState === "missing" ? "0" : "1",
          routes: "0",
          messages: "0",
          dispatches: "0",
          atomic_dispatch_materializations: "0",
          outbox_intents: "0",
          outbox_work: "0"
        });
      }
    );

    it("rejects a raw revision-2 dispatch with a nonzero attempt as an atomic outbound creation", async () => {
      const fixture = fixtureFor("atomic-raw-attempting-dispatch");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      await expect(
        persistAtomicOutboundProducer(db, fixture)
      ).resolves.toMatchObject({ kind: "applied" });
      await db.transaction(async (transaction) => {
        await transaction.execute(
          sql`set local session_replication_role = replica`
        );
        await transaction.execute(sql`
          delete from inbox_v2_atomic_outbound_dispatch_materializations
           where tenant_id = ${fixture.tenantId}
             and dispatch_id = ${fixture.queuedDispatch.id}
        `);
        await transaction.execute(sql`
          delete from inbox_v2_outbound_dispatches
           where tenant_id = ${fixture.tenantId}
             and id = ${fixture.queuedDispatch.id}
        `);
        await transaction.execute(
          sql`set local session_replication_role = origin`
        );
      });

      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          await transaction.execute(
            buildInsertInboxV2OutboundDispatchSql({
              dispatch: fixture.queuedDispatch,
              conversationId: fixture.references.conversation.id,
              timelineItemId: fixture.references.timelineItem.id
            })
          );
          await transaction.execute(
            buildInsertInboxV2OutboundDispatchAttemptSql(fixture.pendingAttempt)
          );
          await transaction.execute(
            buildCompareAndSwapInboxV2OutboundDispatchSql(
              fixture.queuedDispatch,
              fixture.attemptingDispatch
            )
          );
          await transaction.execute(sql`set constraints all immediate`);
        }),
        /23514 inbox_v2\.atomic_outbound_creation_closure_missing/u
      );
      expect(await loadAtomicOutboundProducerCounts(db, fixture)).toMatchObject(
        {
          commands: "1",
          stream_commits: "1",
          stream_heads: "1",
          stream_position: "2",
          routes: "1",
          messages: "1",
          dispatches: "0",
          atomic_dispatch_materializations: "0",
          attempts: "0"
        }
      );
    });

    it("does not treat an already persisted OutboundRoute as a live route proof", async () => {
      const fixture = fixtureFor("atomic-existing-route-no-proof");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      await seedExistingOutboundRoute(db, fixture);
      const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);
      let rejectedExistingRoute = false;

      const materialization = coordinator.withAuthorizedAtomicMaterialization(
        authorizedExternalSendInput(fixture),
        async (context) => {
          try {
            await persistInboxV2RouteResolutionInTransaction(
              context,
              fixture.routeCommit
            );
            throw new Error("Expected the live route seam to reject replay.");
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !/must commit a new exact OutboundRoute/iu.test(error.message)
            ) {
              throw error;
            }
            rejectedExistingRoute = true;
          }
          const prepared = await prepareInboxV2MessageCreation(context, {
            commit: fixture.messageCreationCommit
          });
          if (prepared.kind !== "ready") {
            throw new Error(
              `Atomic Message preparation failed: ${prepared.kind}`
            );
          }
          return prepared.capability;
        },
        async (context, capability) => {
          const sealed = await sealInboxV2PreparedMessageCreation(context, {
            capability
          });
          return { result: null, receipt: sealed.receipt };
        }
      );

      await expect(materialization).rejects.toThrow(
        /requires exactly one matching live outbound route proof/iu
      );
      expect(rejectedExistingRoute).toBe(true);
      expect(await loadAtomicOutboundProducerCounts(db, fixture)).toMatchObject(
        {
          commands: "0",
          stream_commits: "0",
          stream_heads: "1",
          stream_position: "1",
          policy_versions: "1",
          policy_heads: "1",
          routes: "1",
          messages: "0",
          dispatches: "0",
          atomic_dispatch_materializations: "0",
          outbox_intents: "0",
          outbox_work: "0"
        }
      );
    });

    it("rejects a standalone fresh OutboundRoute without its atomic producer closure", async () => {
      const fixture = fixtureFor("atomic-raw-route-inverse");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);

      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          await transaction.execute(
            buildInsertInboxV2OutboundRouteSql(fixture.route, {
              binding_id: fixture.references.binding.id,
              external_thread_id: fixture.references.externalThread.id,
              source_connection_id: fixture.references.sourceConnection.id,
              source_account_id: fixture.references.sourceAccount.id,
              binding_revision: "1",
              account_generation: fixture.route.bindingFence.accountGeneration,
              binding_generation: fixture.route.bindingFence.bindingGeneration,
              remote_access_revision:
                fixture.route.bindingFence.remoteAccessRevision,
              administrative_revision:
                fixture.route.bindingFence.administrativeRevision,
              capability_revision:
                fixture.route.bindingFence.capabilityRevision,
              route_descriptor_revision:
                fixture.route.bindingFence.routeDescriptorRevision,
              remote_access_state: "active",
              administrative_state: "enabled",
              runtime_health_state: "ready"
            })
          );
          await transaction.execute(sql`set constraints all immediate`);
        }),
        /23514 inbox_v2\.atomic_outbound_creation_closure_missing/u
      );
      expect(await loadAtomicOutboundProducerCounts(db, fixture)).toMatchObject(
        {
          routes: "0",
          messages: "0",
          dispatches: "0",
          atomic_dispatch_materializations: "0"
        }
      );
    });

    it("rejects a forged route destination that differs from the persisted binding snapshot", async () => {
      const fixture = fixtureFor("atomic-forged-destination");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      const forgedCommit = routeCommitWithDestinationSubject(
        fixture,
        `${fixture.route.routeDescriptor.destinationSubject}-forged`
      );
      const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);
      let sealCount = 0;

      const materialization = coordinator.withAuthorizedAtomicMaterialization(
        authorizedExternalSendInput(fixture),
        async (context) => {
          await persistInboxV2RouteResolutionInTransaction(
            context,
            forgedCommit
          );
          const prepared = await prepareInboxV2MessageCreation(context, {
            commit: fixture.messageCreationCommit
          });
          if (prepared.kind !== "ready") {
            throw new Error(
              `Atomic Message preparation failed: ${prepared.kind}`
            );
          }
          return prepared.capability;
        },
        async (context, capability) => {
          sealCount += 1;
          const sealed = await sealInboxV2PreparedMessageCreation(context, {
            capability
          });
          return { result: null, receipt: sealed.receipt };
        }
      );

      await expectDatabaseFailure(
        materialization,
        /40001 inbox_v2\.outbound_route_binding_fence_conflict/u
      );
      expect(sealCount).toBe(0);
      expect(await loadAtomicOutboundProducerCounts(db, fixture)).toMatchObject(
        {
          commands: "0",
          stream_commits: "0",
          stream_heads: "1",
          stream_position: "1",
          policy_versions: "1",
          policy_heads: "1",
          routes: "0",
          messages: "0",
          dispatches: "0",
          atomic_dispatch_materializations: "0",
          outbox_intents: "0",
          outbox_work: "0"
        }
      );
    });

    it.each([
      ["live different-account bindings", false, "committed"],
      ["an administratively drifted original binding", true, "committed"]
    ] as const)(
      "fences an explicit reroute across %s",
      async (_label, driftOriginalBinding, expectedKind) => {
        const fixture = fixtureFor(
          `atomic-explicit-reroute-${driftOriginalBinding ? "drift" : "different-account"}`
        );
        tenantIds.push(fixture.tenantId);
        await seedOutboundAnchors(db, fixture);
        await persistAtomicOutboundProducer(db, fixture);
        const reroute = explicitRerouteIntegrationFixture(fixture);
        await seedReplacementBinding(db, fixture, reroute.replacement);
        const rerouteFixture = explicitRerouteAtomicFixture(fixture, reroute);
        if (driftOriginalBinding) {
          await db.transaction(async (transaction) => {
            await transaction.execute(
              sql`set local session_replication_role = replica`
            );
            await transaction.execute(sql`
              update inbox_v2_source_thread_binding_heads
                 set administrative_state = 'disabled',
                     administrative_revision = 2,
                     revision = 2,
                     updated_at = ${OUTBOUND_TEST_TIMES.openedAt}
               where tenant_id = ${fixture.tenantId}
                 and binding_id = ${fixture.references.binding.id}
            `);
            await transaction.execute(
              sql`set local session_replication_role = origin`
            );
          });
        }

        const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);
        const input = authorizedExplicitRerouteIntegrationInput(
          fixture,
          rerouteFixture,
          reroute
        );
        let routeResult:
          | Awaited<
              ReturnType<
                typeof persistInboxV2ExplicitRerouteResolutionInTransaction
              >
            >
          | undefined;
        const materialization = coordinator.withAuthorizedAtomicMaterialization(
          input,
          async (context) => {
            routeResult =
              await persistInboxV2ExplicitRerouteResolutionInTransaction(
                context,
                {
                  routeResolution: reroute.commit,
                  rerouteCommit: reroute.rerouteCommit
                }
              );
            throw new PostgresRerouteProbeComplete();
          },
          async () => {
            throw new Error("Explicit reroute probe must not reach seal.");
          }
        );

        await expect(materialization).rejects.toBeInstanceOf(
          PostgresRerouteProbeComplete
        );
        expect(routeResult).toMatchObject({ kind: expectedKind });
        const persisted = await db.execute<{
          original_count: string;
          replacement_count: string;
        }>(sql`
          select (
                   select count(*)::text
                     from inbox_v2_outbound_routes
                    where tenant_id = ${fixture.tenantId}
                      and id = ${fixture.route.id}
                 ) as original_count,
                 (
                   select count(*)::text
                     from inbox_v2_outbound_routes
                    where tenant_id = ${fixture.tenantId}
                      and id = ${reroute.commit.route!.id}
                 ) as replacement_count
        `);
        expect(persisted.rows[0]).toEqual({
          original_count: "1",
          replacement_count: "0"
        });
      }
    );

    it("commits an allowed explicit reroute with Message, dispatch and provider outbox atomically", async () => {
      const fixture = fixtureFor("atomic-explicit-reroute-full-commit");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      await persistAtomicOutboundProducer(db, fixture);
      const reroute = explicitRerouteIntegrationFixture(fixture);
      await seedReplacementBinding(db, fixture, reroute.replacement);
      const atomicFixture = explicitRerouteAtomicFixture(fixture, reroute);
      const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);

      await expect(
        coordinator.withAuthorizedAtomicMaterialization(
          authorizedExplicitRerouteIntegrationInput(
            fixture,
            atomicFixture,
            reroute
          ),
          async (context) => {
            const route =
              await persistInboxV2ExplicitRerouteResolutionInTransaction(
                context,
                {
                  routeResolution: reroute.commit,
                  rerouteCommit: reroute.rerouteCommit
                }
              );
            if (route.kind !== "committed") {
              throw new Error(
                `Explicit reroute preparation failed: ${route.kind}`
              );
            }
            const prepared = await prepareInboxV2MessageCreation(context, {
              commit: atomicFixture.messageCreationCommit
            });
            if (prepared.kind !== "ready") {
              throw new Error(
                `Explicit reroute Message preparation failed: ${prepared.kind}`
              );
            }
            return prepared.capability;
          },
          async (context, capability) => {
            const sealed = await sealInboxV2PreparedMessageCreation(context, {
              capability
            });
            return {
              result: { messageId: sealed.message.id },
              receipt: sealed.receipt
            };
          }
        )
      ).resolves.toMatchObject({
        kind: "applied",
        result: { messageId: atomicFixture.references.message.id }
      });
      expect(
        await loadAtomicOutboundProducerCounts(db, atomicFixture)
      ).toMatchObject({
        commands: "2",
        routes: "2",
        messages: "2",
        dispatches: "2",
        atomic_dispatch_materializations: "2",
        queued_dispatches: "1",
        attempts: "0",
        outbox_intents: "5",
        provider_intents: "2",
        outbox_work: "5"
      });
      const dispatch = await db.execute<{
        id: string;
        route_id: string;
        state: string;
        revision: string;
      }>(sql`
        select id, route_id, state::text as state, revision::text as revision
          from inbox_v2_outbound_dispatches
         where tenant_id = ${fixture.tenantId}
           and id in (${atomicFixture.queuedDispatch.id}, ${fixture.queuedDispatch.id})
         order by id
      `);
      expect(dispatch.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: atomicFixture.queuedDispatch.id,
            route_id: reroute.commit.route!.id,
            state: "queued",
            revision: "1"
          }),
          expect.objectContaining({
            id: fixture.queuedDispatch.id,
            route_id: fixture.route.id,
            state: "cancelled",
            revision: "2"
          })
        ])
      );
      const originalWork = await db.execute<{ state: string }>(sql`
        select state::text as state
          from inbox_v2_outbox_work_items
         where tenant_id = ${fixture.tenantId}
           and intent_id = ${reroute.rerouteCommit.original.outboxIntentId}
      `);
      expect(originalWork.rows[0]?.state).toBe("pending");
    });

    it("lets explicit reroute win after a provider worker loaded the queued dispatch but before fenced open", async () => {
      const fixture = fixtureFor("atomic-explicit-reroute-wins-open-race");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      await persistAtomicOutboundProducer(db, fixture);
      const reroute = explicitRerouteIntegrationFixture(fixture);
      await seedReplacementBinding(db, fixture, reroute.replacement);
      const atomicFixture = explicitRerouteAtomicFixture(fixture, reroute);
      const providerIntent = authorizedExternalSendInput(
        fixture
      ).records.outboxIntents.find(
        (intent) => intent.typeId === "core:provider.dispatch"
      );
      if (providerIntent === undefined) {
        throw new Error("Reroute-wins fixture has no provider intent.");
      }

      const tenantId = inboxV2TenantIdSchema.parse(fixture.tenantId);
      const workerId = inboxV2NamespacedIdSchema.parse(
        "core:provider-reroute-wins-worker"
      );
      const outbox = createSqlInboxV2RepositoryOutbox(db, {
        tokenSource: (count) =>
          Array.from(
            { length: count },
            (_, index) =>
              `lease-token:reroute-wins-${index}-${runId}-${"r".repeat(32)}`
          )
      });
      const claimed = await outbox.claimAvailable({
        context: { tenantId },
        workerId,
        leaseDurationSeconds: 30,
        batchSize: 2
      });
      if (claimed.outcome !== "claimed") {
        throw new Error("Reroute-wins provider intent was not claimed.");
      }
      const providerClaim = claimed.claims.find(
        (claim) => claim.work.intentId === providerIntent.id
      );
      if (providerClaim === undefined || providerClaim.work.lease === null) {
        throw new Error("Reroute-wins provider claim has no exact lease.");
      }
      const providerLease = providerClaim.work.lease;
      const pendingAttempt = inboxV2OutboundDispatchAttemptSchema.parse({
        ...fixture.pendingAttempt,
        openedAt: providerLease.claimedAt,
        leaseExpiresAt: providerLease.expiresAt
      });
      const attemptingDispatch = inboxV2OutboundDispatchSchema.parse({
        ...fixture.attemptingDispatch,
        updatedAt: pendingAttempt.openedAt
      });
      const openCommit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
        ...fixture.openAttemptCommit,
        attempt: pendingAttempt,
        dispatchAfter: attemptingDispatch
      });
      if (openCommit.kind !== "open_attempt") {
        throw new Error("Reroute-wins fixture did not build an open commit.");
      }

      let markPlannerLoaded!: () => void;
      const plannerLoaded = new Promise<void>((resolve) => {
        markPlannerLoaded = resolve;
      });
      let releasePlanner!: () => void;
      const plannerGate = new Promise<void>((resolve) => {
        releasePlanner = resolve;
      });
      let loadedDispatchState: string | undefined;
      let adapterCallCount = 0;
      const processing = createInboxV2ProviderDispatchCoordinator({
        outbox,
        transport: createSqlInboxV2OutboundTransportRepository(db),
        planner: {
          async plan({ loaded }) {
            loadedDispatchState = loaded.dispatch.state;
            markPlannerLoaded();
            await plannerGate;
            return {
              kind: "open_attempt" as const,
              commit: openCommit,
              request: { text: "must-not-reach-provider" }
            };
          }
        },
        adapter: {
          async dispatch() {
            adapterCallCount += 1;
            return {
              outcome: "accepted" as const,
              providerAcknowledgementToken: `provider:unexpected-${runId}`
            };
          }
        },
        completedByTrustedServiceId:
          fixture.route.adapterContract.loadedByTrustedServiceId,
        expectedHandlerId: providerIntent.handlerId,
        providerDeadlineMs: 30_000
      }).process(providerClaim);

      await Promise.race([
        plannerLoaded,
        processing.then(
          (result) => {
            throw new Error(
              `Provider worker completed before the planner gate: ${result.outcome}`
            );
          },
          (error: unknown) => Promise.reject(error)
        )
      ]);
      expect(loadedDispatchState).toBe("queued");

      try {
        const rerouteResult =
          await createSqlInboxV2AuthorizedCommandCoordinator(
            db
          ).withAuthorizedAtomicMaterialization(
            authorizedExplicitRerouteIntegrationInput(
              fixture,
              atomicFixture,
              reroute
            ),
            async (context) => {
              const route =
                await persistInboxV2ExplicitRerouteResolutionInTransaction(
                  context,
                  {
                    routeResolution: reroute.commit,
                    rerouteCommit: reroute.rerouteCommit
                  }
                );
              if (route.kind !== "committed") {
                throw new Error(
                  `Reroute-wins preparation failed: ${route.kind}`
                );
              }
              const prepared = await prepareInboxV2MessageCreation(context, {
                commit: atomicFixture.messageCreationCommit
              });
              if (prepared.kind !== "ready") {
                throw new Error(
                  `Reroute-wins Message preparation failed: ${prepared.kind}`
                );
              }
              return prepared.capability;
            },
            async (context, capability) => {
              const sealed = await sealInboxV2PreparedMessageCreation(context, {
                capability
              });
              return {
                result: { messageId: sealed.message.id },
                receipt: sealed.receipt
              };
            }
          );
        expect(rerouteResult).toMatchObject({
          kind: "applied",
          result: { messageId: atomicFixture.references.message.id }
        });
      } finally {
        releasePlanner();
      }

      await expect(processing).resolves.toMatchObject({
        outcome: "finalized",
        source: "rerouted",
        result: { outcome: "processed" }
      });
      expect(adapterCallCount).toBe(0);

      const state = await db.execute<{
        original_dispatch_state: string;
        original_dispatch_revision: string;
        replacement_dispatch_state: string;
        attempt_count: string;
        original_work_state: string;
        processed_outcome_count: string;
      }>(sql`
        select
          (select state::text
             from inbox_v2_outbound_dispatches
            where tenant_id = ${fixture.tenantId}
              and id = ${fixture.queuedDispatch.id})
            as original_dispatch_state,
          (select revision::text
             from inbox_v2_outbound_dispatches
            where tenant_id = ${fixture.tenantId}
              and id = ${fixture.queuedDispatch.id})
            as original_dispatch_revision,
          (select state::text
             from inbox_v2_outbound_dispatches
            where tenant_id = ${fixture.tenantId}
              and id = ${atomicFixture.queuedDispatch.id})
            as replacement_dispatch_state,
          (select count(*)::text
             from inbox_v2_outbound_dispatch_attempts
            where tenant_id = ${fixture.tenantId}
              and dispatch_id = ${fixture.queuedDispatch.id})
            as attempt_count,
          (select state::text
             from inbox_v2_outbox_work_items
            where tenant_id = ${fixture.tenantId}
              and intent_id = ${providerIntent.id})
            as original_work_state,
          (select count(*)::text
             from inbox_v2_outbox_outcomes
            where tenant_id = ${fixture.tenantId}
              and intent_id = ${providerIntent.id}
              and kind = 'processed')
            as processed_outcome_count
      `);
      expect(state.rows[0]).toEqual({
        original_dispatch_state: "cancelled",
        original_dispatch_revision: "2",
        replacement_dispatch_state: "queued",
        attempt_count: "0",
        original_work_state: "processed",
        processed_outcome_count: "1"
      });
    });

    it("rejects explicit reroute without replacement residue when fenced provider open wins first", async () => {
      const fixture = fixtureFor("atomic-provider-open-wins-reroute-race");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      await persistAtomicOutboundProducer(db, fixture);
      const reroute = explicitRerouteIntegrationFixture(fixture);
      await seedReplacementBinding(db, fixture, reroute.replacement);
      const atomicFixture = explicitRerouteAtomicFixture(fixture, reroute);
      const providerIntent = authorizedExternalSendInput(
        fixture
      ).records.outboxIntents.find(
        (intent) => intent.typeId === "core:provider.dispatch"
      );
      if (providerIntent === undefined) {
        throw new Error("Open-wins fixture has no provider intent.");
      }

      const tenantId = inboxV2TenantIdSchema.parse(fixture.tenantId);
      const workerId = inboxV2NamespacedIdSchema.parse(
        "core:provider-open-wins-worker"
      );
      const outbox = createSqlInboxV2RepositoryOutbox(db, {
        tokenSource: (count) =>
          Array.from(
            { length: count },
            (_, index) =>
              `lease-token:open-wins-${index}-${runId}-${"o".repeat(32)}`
          )
      });
      const claimed = await outbox.claimAvailable({
        context: { tenantId },
        workerId,
        leaseDurationSeconds: 30,
        batchSize: 2
      });
      if (claimed.outcome !== "claimed") {
        throw new Error("Open-wins provider intent was not claimed.");
      }
      const providerClaim = claimed.claims.find(
        (claim) => claim.work.intentId === providerIntent.id
      );
      if (providerClaim === undefined || providerClaim.work.lease === null) {
        throw new Error("Open-wins provider claim has no exact lease.");
      }
      const providerLease = providerClaim.work.lease;
      const pendingAttempt = inboxV2OutboundDispatchAttemptSchema.parse({
        ...fixture.pendingAttempt,
        openedAt: providerLease.claimedAt,
        leaseExpiresAt: providerLease.expiresAt
      });
      const attemptingDispatch = inboxV2OutboundDispatchSchema.parse({
        ...fixture.attemptingDispatch,
        updatedAt: pendingAttempt.openedAt
      });
      const openCommit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
        ...fixture.openAttemptCommit,
        attempt: pendingAttempt,
        dispatchAfter: attemptingDispatch
      });
      await expect(
        createSqlInboxV2OutboundTransportRepository(db).applyAttemptFenced({
          outboxLease: {
            context: { tenantId },
            intentId: providerIntent.id,
            workerId,
            leaseToken: providerClaim.leaseToken,
            expectedLeaseRevision: providerLease.leaseRevision,
            expectedHandlerId: providerIntent.handlerId
          },
          commit: openCommit
        })
      ).resolves.toEqual({ kind: "committed" });

      let routeResult:
        | Awaited<
            ReturnType<
              typeof persistInboxV2ExplicitRerouteResolutionInTransaction
            >
          >
        | undefined;
      const materialization = createSqlInboxV2AuthorizedCommandCoordinator(
        db
      ).withAuthorizedAtomicMaterialization(
        authorizedExplicitRerouteIntegrationInput(
          fixture,
          atomicFixture,
          reroute
        ),
        async (context) => {
          routeResult =
            await persistInboxV2ExplicitRerouteResolutionInTransaction(
              context,
              {
                routeResolution: reroute.commit,
                rerouteCommit: reroute.rerouteCommit
              }
            );
          throw new PostgresRerouteProbeComplete();
        },
        async () => {
          throw new Error("Open-wins reroute probe must not reach seal.");
        }
      );

      await expect(materialization).rejects.toBeInstanceOf(
        PostgresRerouteProbeComplete
      );
      expect(routeResult).toEqual({ kind: "original_dispatch_conflict" });

      const state = await db.execute<{
        original_dispatch_state: string;
        original_dispatch_revision: string;
        attempt_count: string;
        replacement_route_count: string;
        replacement_message_count: string;
        replacement_dispatch_count: string;
        replacement_intent_count: string;
        replacement_work_count: string;
      }>(sql`
        select
          (select state::text
             from inbox_v2_outbound_dispatches
            where tenant_id = ${fixture.tenantId}
              and id = ${fixture.queuedDispatch.id})
            as original_dispatch_state,
          (select revision::text
             from inbox_v2_outbound_dispatches
            where tenant_id = ${fixture.tenantId}
              and id = ${fixture.queuedDispatch.id})
            as original_dispatch_revision,
          (select count(*)::text
             from inbox_v2_outbound_dispatch_attempts
            where tenant_id = ${fixture.tenantId}
              and dispatch_id = ${fixture.queuedDispatch.id})
            as attempt_count,
          (select count(*)::text
             from inbox_v2_outbound_routes
            where tenant_id = ${fixture.tenantId}
              and id = ${reroute.commit.route!.id})
            as replacement_route_count,
          (select count(*)::text
             from inbox_v2_messages
            where tenant_id = ${fixture.tenantId}
              and id = ${atomicFixture.references.message.id})
            as replacement_message_count,
          (select count(*)::text
             from inbox_v2_outbound_dispatches
            where tenant_id = ${fixture.tenantId}
              and id = ${atomicFixture.queuedDispatch.id})
            as replacement_dispatch_count,
          (select count(*)::text
             from inbox_v2_outbox_intents
            where tenant_id = ${fixture.tenantId}
              and id = ${reroute.rerouteCommit.replacement.outboxIntentId})
            as replacement_intent_count,
          (select count(*)::text
             from inbox_v2_outbox_work_items
            where tenant_id = ${fixture.tenantId}
              and intent_id = ${reroute.rerouteCommit.replacement.outboxIntentId})
            as replacement_work_count
      `);
      expect(state.rows[0]).toEqual({
        original_dispatch_state: "attempting",
        original_dispatch_revision: "2",
        attempt_count: "1",
        replacement_route_count: "0",
        replacement_message_count: "0",
        replacement_dispatch_count: "0",
        replacement_intent_count: "0",
        replacement_work_count: "0"
      });
    });

    it("observes an admin-disable race before inserting the replacement route", async () => {
      const fixture = fixtureFor("atomic-explicit-reroute-admin-race");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      await persistAtomicOutboundProducer(db, fixture);
      const reroute = explicitRerouteIntegrationFixture(fixture);
      await seedReplacementBinding(db, fixture, reroute.replacement);
      const rerouteFixture = explicitRerouteAtomicFixture(fixture, reroute);
      const heldDisable = holdBindingAdminDisable(
        db,
        fixture,
        reroute.replacement.binding.id
      );
      await heldDisable.ready;

      const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);
      let routeResult:
        | Awaited<
            ReturnType<
              typeof persistInboxV2ExplicitRerouteResolutionInTransaction
            >
          >
        | undefined;
      const materialization = coordinator.withAuthorizedAtomicMaterialization(
        authorizedExplicitRerouteIntegrationInput(
          fixture,
          rerouteFixture,
          reroute
        ),
        async (context) => {
          routeResult =
            await persistInboxV2ExplicitRerouteResolutionInTransaction(
              context,
              {
                routeResolution: reroute.commit,
                rerouteCommit: reroute.rerouteCommit
              }
            );
          throw new PostgresRerouteProbeComplete();
        },
        async () => {
          throw new Error("Explicit reroute race probe must not reach seal.");
        }
      );
      let settled = false;
      void materialization.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(settled).toBe(false);
      heldDisable.release();
      await heldDisable.completed;

      await expect(materialization).rejects.toBeInstanceOf(
        PostgresRerouteProbeComplete
      );
      expect(routeResult).toEqual({ kind: "binding_fence_conflict" });
      const replacement = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
          from inbox_v2_outbound_routes
         where tenant_id = ${fixture.tenantId}
           and id = ${reroute.commit.route!.id}
      `);
      expect(replacement.rows[0]?.count).toBe("0");
    });

    it("commits route -> queued dispatch -> durable attempt -> outcome_unknown -> reconciliation", async () => {
      const fixture = fixtureFor("lifecycle");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      const repository = createSqlInboxV2OutboundTransportRepository(db);

      await expect(
        persistAtomicOutboundProducer(db, fixture)
      ).resolves.toMatchObject({ kind: "applied" });
      await expect(
        repository.createDispatch(fixture.queuedDispatch)
      ).resolves.toEqual({
        kind: "already_exists",
        dispatch: fixture.queuedDispatch
      });
      await expect(
        repository.applyAttempt(fixture.openAttemptCommit)
      ).resolves.toEqual({ kind: "committed" });
      await expect(
        repository.applyAttempt(fixture.completeUnknownCommit)
      ).resolves.toEqual({ kind: "committed" });
      await expect(
        repository.reconcile(fixture.reconciliationCommit)
      ).resolves.toEqual({ kind: "committed" });

      await expect(
        repository.findDispatch({
          tenantId: fixture.reconciledDispatch.tenantId,
          dispatchId: fixture.queuedDispatch.id
        })
      ).resolves.toEqual(fixture.reconciledDispatch);
      await expect(
        repository.listMessageDispatches({
          tenantId: fixture.reconciledDispatch.tenantId,
          messageId: fixture.reconciledDispatch.message.id,
          limit: 1
        })
      ).resolves.toEqual({
        tenantId: fixture.tenantId,
        messageId: fixture.references.message.id,
        items: [fixture.reconciledDispatch],
        nextAfter: null,
        hasMore: false
      });

      const state = await db.execute<{
        dispatch_state: string;
        dispatch_revision: string;
        attempt_outcome: string;
        attempt_revision: string;
        reconciliation_count: string;
      }>(sql`
        select dispatch_row.state as dispatch_state,
               dispatch_row.revision::text as dispatch_revision,
               attempt_row.outcome_kind as attempt_outcome,
               attempt_row.revision::text as attempt_revision,
               (
                 select count(*)::text
                 from inbox_v2_outbound_dispatch_reconciliation_decisions d
                 where d.tenant_id = dispatch_row.tenant_id
                   and d.dispatch_id = dispatch_row.id
               ) as reconciliation_count
        from inbox_v2_outbound_dispatches dispatch_row
        join inbox_v2_outbound_dispatch_attempts attempt_row
          on attempt_row.tenant_id = dispatch_row.tenant_id
         and attempt_row.dispatch_id = dispatch_row.id
        where dispatch_row.tenant_id = ${fixture.tenantId}
          and dispatch_row.id = ${fixture.queuedDispatch.id}
      `);
      expect(state.rows[0]).toEqual({
        dispatch_state: "retryable_failure",
        dispatch_revision: "4",
        attempt_outcome: "outcome_unknown",
        attempt_revision: "2",
        reconciliation_count: "1"
      });
    });

    it("fences provider I/O across an expired lease reclaimed by another worker", async () => {
      const fixture = fixtureFor("fenced-provider-race");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      await expect(
        persistAtomicOutboundProducer(db, fixture)
      ).resolves.toMatchObject({ kind: "applied" });

      const commandInput = authorizedExternalSendInput(fixture);
      const raceTenantId = inboxV2TenantIdSchema.parse(commandInput.tenantId);
      const providerIntent = commandInput.records.outboxIntents.find(
        (intent) => intent.typeId === "core:provider.dispatch"
      );
      const projectionIntent = commandInput.records.outboxIntents.find(
        (intent) => intent.effectClass === "projection"
      );
      if (providerIntent === undefined || projectionIntent === undefined) {
        throw new Error("Provider race fixture is missing its outbox intents.");
      }

      const workerA = inboxV2NamespacedIdSchema.parse(
        "core:provider-dispatch-worker-a"
      );
      const workerB = inboxV2NamespacedIdSchema.parse(
        "core:provider-dispatch-worker-b"
      );
      const workerADb = createHuleeDatabase();
      const workerBDb = createHuleeDatabase();
      try {
        const outboxA = createSqlInboxV2RepositoryOutbox(workerADb, {
          tokenSource: (count) =>
            Array.from(
              { length: count },
              (_, index) =>
                `lease-token:src009-a-${index}-${runId}-${"a".repeat(32)}`
            )
        });
        const outboxB = createSqlInboxV2RepositoryOutbox(workerBDb, {
          tokenSource: (count) =>
            Array.from(
              { length: count },
              (_, index) =>
                `lease-token:src009-b-${index}-${runId}-${"b".repeat(32)}`
            )
        });
        const transportA =
          createSqlInboxV2OutboundTransportRepository(workerADb);
        const transportB =
          createSqlInboxV2OutboundTransportRepository(workerBDb);

        const claimedA = await outboxA.claimAvailable({
          context: { tenantId: raceTenantId },
          workerId: workerA,
          leaseDurationSeconds: 3,
          batchSize: 2
        });
        if (claimedA.outcome !== "claimed") {
          throw new Error("Worker A did not claim the provider intent.");
        }
        const providerClaimA = claimedA.claims.find(
          (claim) => claim.work.intentId === providerIntent.id
        );
        const projectionClaimA = claimedA.claims.find(
          (claim) => claim.work.intentId === projectionIntent.id
        );
        if (
          providerClaimA?.work.lease === null ||
          providerClaimA === undefined ||
          projectionClaimA?.work.lease === null ||
          projectionClaimA === undefined
        ) {
          throw new Error("Worker A claim is missing its exact leases.");
        }
        const fenceA = {
          context: { tenantId: raceTenantId },
          intentId: providerIntent.id,
          workerId: workerA,
          leaseToken: providerClaimA.leaseToken,
          expectedLeaseRevision: providerClaimA.work.lease.leaseRevision,
          expectedHandlerId: providerIntent.handlerId
        } as const;

        await expect(
          transportA.loadClaimedProviderIo({ outboxLease: fenceA })
        ).resolves.toMatchObject({
          kind: "loaded",
          intent: {
            id: providerIntent.id,
            handlerId: providerIntent.handlerId
          },
          dispatch: fixture.queuedDispatch
        });
        await expect(
          transportA.loadClaimedProviderIo({
            outboxLease: {
              ...fenceA,
              expectedHandlerId: inboxV2NamespacedIdSchema.parse(
                "core:wrong-provider-handler"
              )
            }
          })
        ).resolves.toEqual({ kind: "outbox_intent_conflict" });
        await expect(
          transportA.loadClaimedProviderIo({
            outboxLease: {
              ...fenceA,
              intentId: projectionIntent.id,
              leaseToken: projectionClaimA.leaseToken,
              expectedLeaseRevision: projectionClaimA.work.lease.leaseRevision
            }
          })
        ).resolves.toEqual({ kind: "outbox_intent_conflict" });

        const pendingAttempt = inboxV2OutboundDispatchAttemptSchema.parse({
          ...fixture.pendingAttempt,
          openedAt: providerClaimA.work.lease.claimedAt,
          leaseExpiresAt: providerClaimA.work.lease.expiresAt
        });
        const attemptingDispatch = inboxV2OutboundDispatchSchema.parse({
          ...fixture.attemptingDispatch,
          updatedAt: pendingAttempt.openedAt
        });
        const openCommit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
          ...fixture.openAttemptCommit,
          attempt: pendingAttempt,
          dispatchAfter: attemptingDispatch
        });
        await expect(
          transportA.applyAttemptFenced({
            outboxLease: fenceA,
            commit: openCommit
          })
        ).resolves.toEqual({ kind: "committed" });

        await db.execute(sql`select pg_sleep(3.2)`);
        const claimedB = await outboxB.claimAvailable({
          context: { tenantId: raceTenantId },
          workerId: workerB,
          leaseDurationSeconds: 30,
          batchSize: 2
        });
        if (claimedB.outcome !== "claimed") {
          throw new Error(
            "Worker B did not reclaim the expired provider intent."
          );
        }
        const providerClaimB = claimedB.claims.find(
          (claim) => claim.work.intentId === providerIntent.id
        );
        if (
          providerClaimB === undefined ||
          providerClaimB.work.lease === null
        ) {
          throw new Error("Worker B provider claim is missing its lease.");
        }
        expect(providerClaimB.claimKind).toBe("reclaimed");
        const fenceB = {
          context: { tenantId: raceTenantId },
          intentId: providerIntent.id,
          workerId: workerB,
          leaseToken: providerClaimB.leaseToken,
          expectedLeaseRevision: providerClaimB.work.lease.leaseRevision,
          expectedHandlerId: providerIntent.handlerId
        } as const;

        const acceptedAttempt = inboxV2OutboundDispatchAttemptSchema.parse({
          ...pendingAttempt,
          outcome: {
            kind: "accepted",
            completedAt: pendingAttempt.leaseExpiresAt,
            providerAcknowledgementToken: `provider:late-ack-${runId}`
          },
          completionSource: "provider_result",
          revision: "2"
        });
        const acceptedDispatch = inboxV2OutboundDispatchSchema.parse({
          ...attemptingDispatch,
          state: "accepted",
          activeAttempt: null,
          revision: "3",
          updatedAt: pendingAttempt.leaseExpiresAt
        });
        const staleProviderResult =
          inboxV2OutboundDispatchAttemptCommitSchema.parse({
            kind: "complete_attempt",
            tenantId: raceTenantId,
            dispatchBefore: attemptingDispatch,
            attemptBefore: pendingAttempt,
            attemptAfter: acceptedAttempt,
            completionSource: "provider_result",
            completedByTrustedServiceId:
              pendingAttempt.retrySafety.adapterContract
                .loadedByTrustedServiceId,
            dispatchAfter: acceptedDispatch
          });
        await expect(
          transportA.applyAttemptFenced({
            outboxLease: fenceA,
            commit: staleProviderResult
          })
        ).resolves.toMatchObject({ kind: "outbox_stale_token" });

        const stillPending = await db.execute<{
          dispatch_state: string;
          attempt_outcome: string;
          attempt_count: string;
        }>(sql`
          select dispatch_row.state as dispatch_state,
                 attempt_row.outcome_kind as attempt_outcome,
                 (count(*) over ())::text as attempt_count
            from inbox_v2_outbound_dispatches dispatch_row
            join inbox_v2_outbound_dispatch_attempts attempt_row
              on attempt_row.tenant_id = dispatch_row.tenant_id
             and attempt_row.dispatch_id = dispatch_row.id
           where dispatch_row.tenant_id = ${fixture.tenantId}
             and dispatch_row.id = ${fixture.queuedDispatch.id}
        `);
        expect(stillPending.rows).toEqual([
          {
            dispatch_state: "attempting",
            attempt_outcome: "pending",
            attempt_count: "1"
          }
        ]);

        const unknownCompletedAt = providerClaimB.work.lease.claimedAt;
        const unknownAttempt = inboxV2OutboundDispatchAttemptSchema.parse({
          ...pendingAttempt,
          outcome: {
            ...fixture.unknownAttempt.outcome,
            completedAt: unknownCompletedAt
          },
          completionSource: "lease_expired",
          revision: "2"
        });
        const unknownDispatch = inboxV2OutboundDispatchSchema.parse({
          ...attemptingDispatch,
          state: "outcome_unknown",
          activeAttempt: null,
          revision: "3",
          updatedAt: unknownCompletedAt
        });
        const closeUnknown = inboxV2OutboundDispatchAttemptCommitSchema.parse({
          kind: "complete_attempt",
          tenantId: raceTenantId,
          dispatchBefore: attemptingDispatch,
          attemptBefore: pendingAttempt,
          attemptAfter: unknownAttempt,
          completionSource: "lease_expired",
          completedByTrustedServiceId:
            pendingAttempt.retrySafety.adapterContract.loadedByTrustedServiceId,
          dispatchAfter: unknownDispatch
        });
        await expect(
          transportB.applyAttemptFenced({
            outboxLease: fenceB,
            commit: closeUnknown
          })
        ).resolves.toEqual({ kind: "committed" });

        const retryAt = new Date(
          Date.parse(unknownCompletedAt) + 1_000
        ).toISOString();
        const decision = {
          ...fixture.reconciliationDecision,
          routeSnapshot: fixture.route,
          unknownAttempt,
          decidedAt: unknownCompletedAt,
          result: {
            ...fixture.reconciliationDecision.result,
            retryAt
          }
        };
        const reconciledDispatch = inboxV2OutboundDispatchSchema.parse({
          ...unknownDispatch,
          state: "retryable_failure",
          retryAuthorization: {
            tenantId: raceTenantId,
            kind: "outbound_dispatch_reconciliation_decision",
            id: decision.id
          },
          revision: "4",
          updatedAt: decision.decidedAt
        });
        const reconcileCommit =
          inboxV2OutboundDispatchReconciliationCommitSchema.parse({
            tenantId: raceTenantId,
            dispatchBefore: unknownDispatch,
            decision,
            dispatchAfter: reconciledDispatch
          });
        await expect(
          transportB.reconcileFenced({
            outboxLease: fenceB,
            commit: reconcileCommit
          })
        ).resolves.toEqual({ kind: "committed" });

        const finalState = await db.execute<{
          dispatch_state: string;
          dispatch_revision: string;
          attempt_outcome: string;
          attempt_revision: string;
          attempt_count: string;
          reconciliation_count: string;
        }>(sql`
          select dispatch_row.state as dispatch_state,
                 dispatch_row.revision::text as dispatch_revision,
                 attempt_row.outcome_kind as attempt_outcome,
                 attempt_row.revision::text as attempt_revision,
                 (count(*) over ())::text as attempt_count,
                 (
                   select count(*)::text
                     from inbox_v2_outbound_dispatch_reconciliation_decisions d
                    where d.tenant_id = dispatch_row.tenant_id
                      and d.dispatch_id = dispatch_row.id
                 ) as reconciliation_count
            from inbox_v2_outbound_dispatches dispatch_row
            join inbox_v2_outbound_dispatch_attempts attempt_row
              on attempt_row.tenant_id = dispatch_row.tenant_id
             and attempt_row.dispatch_id = dispatch_row.id
           where dispatch_row.tenant_id = ${fixture.tenantId}
             and dispatch_row.id = ${fixture.queuedDispatch.id}
        `);
        expect(finalState.rows).toEqual([
          {
            dispatch_state: "retryable_failure",
            dispatch_revision: "4",
            attempt_outcome: "outcome_unknown",
            attempt_revision: "2",
            attempt_count: "1",
            reconciliation_count: "1"
          }
        ]);
      } finally {
        await Promise.all([
          closeHuleeDatabase(workerADb),
          closeHuleeDatabase(workerBDb)
        ]);
      }
    }, 10_000);

    it.each([
      ["provider echo before response", ["echo", "response"]],
      ["provider response before echo", ["response", "echo"]]
    ] as const)(
      "associates %s without losing either artifact",
      async (_label, order) => {
        const fixture = fixtureFor(`association-${order.join("-")}`);
        tenantIds.push(fixture.tenantId);
        await seedOutboundAnchors(db, fixture);
        const repository = createSqlInboxV2OutboundTransportRepository(db);
        await expect(
          persistAtomicOutboundProducer(db, fixture)
        ).resolves.toMatchObject({ kind: "applied" });
        await expect(
          repository.createDispatch(fixture.queuedDispatch)
        ).resolves.toEqual({
          kind: "already_exists",
          dispatch: fixture.queuedDispatch
        });
        await repository.applyAttempt(fixture.openAttemptCommit);
        const acceptedCommit = inboxV2OutboundDispatchAttemptCommitSchema.parse(
          {
            ...fixture.completeUnknownCommit,
            attemptAfter: fixture.acceptedAttempt,
            completionSource: "provider_result",
            dispatchAfter: fixture.acceptedDispatch
          }
        );
        await expect(repository.applyAttempt(acceptedCommit)).resolves.toEqual({
          kind: "committed"
        });
        for (const artifact of fixture.artifacts) {
          await expect(repository.appendArtifact(artifact)).resolves.toEqual({
            kind: "committed"
          });
        }
        await seedAssociationOccurrences(db, fixture);

        const commits = {
          echo: fixture.echoAssociation,
          response: fixture.responseAssociation
        } as const;
        for (const kind of order) {
          await expect(
            repository.associateArtifact(commits[kind])
          ).resolves.toEqual({ kind: "committed" });
        }
        const foreignTenantFixture = createOutboundTransportContractFixture({
          tenantId: `tenant:db003-outbound-reference-foreign-${runId}`,
          suffix: `reference-foreign-${fixture.suffix}`
        });
        for (const kind of order) {
          const expected = commits[kind].occurrenceResolution.resolvedReference;
          if (expected === null) {
            throw new Error("Associated artifact must resolve one reference.");
          }
          await expect(
            repository.findExternalMessageReference({
              tenantId: expected.tenantId,
              referenceId: expected.id
            })
          ).resolves.toEqual(expected);
          await expect(
            repository.findExternalMessageReference({
              tenantId: foreignTenantFixture.queuedDispatch.tenantId,
              referenceId: expected.id
            })
          ).resolves.toBeNull();
        }

        const links = await db.execute<{
          evidence_kind: string;
          source_occurrence_id: string;
        }>(sql`
        select evidence_kind, source_occurrence_id
        from inbox_v2_outbound_dispatch_artifact_reference_links
        where tenant_id = ${fixture.tenantId}
          and dispatch_id = ${fixture.queuedDispatch.id}
        order by evidence_kind::text
      `);
        expect(links.rows).toEqual([
          {
            evidence_kind: "provider_echo_correlation",
            source_occurrence_id:
              fixture.echoAssociation.link.sourceOccurrence.id
          },
          {
            evidence_kind: "provider_response_attempt",
            source_occurrence_id:
              fixture.responseAssociation.link.sourceOccurrence.id
          }
        ]);
      }
    );

    it("keeps tenant boundaries and real foreign keys fail closed", async () => {
      const fixture = fixtureFor("tenant-fk");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      const repository = createSqlInboxV2OutboundTransportRepository(db);
      await expect(
        persistAtomicOutboundProducer(db, fixture)
      ).resolves.toMatchObject({ kind: "applied" });
      await expect(
        repository.createDispatch(fixture.queuedDispatch)
      ).resolves.toEqual({
        kind: "already_exists",
        dispatch: fixture.queuedDispatch
      });

      const otherTenantFixture = createOutboundTransportContractFixture({
        tenantId: `tenant:db003-outbound-other-${runId}`,
        suffix: fixture.suffix
      });
      await expect(
        repository.createDispatch(otherTenantFixture.queuedDispatch)
      ).resolves.toEqual({ kind: "message_not_found" });
      await expect(
        repository.findDispatch({
          tenantId: otherTenantFixture.queuedDispatch.tenantId,
          dispatchId: fixture.queuedDispatch.id
        })
      ).resolves.toBeNull();
      await expect(
        repository.listMessageDispatches({
          tenantId: otherTenantFixture.queuedDispatch.tenantId,
          messageId: fixture.queuedDispatch.message.id
        })
      ).resolves.toEqual({
        tenantId: otherTenantFixture.tenantId,
        messageId: fixture.references.message.id,
        items: [],
        nextAfter: null,
        hasMore: false
      });

      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          await transaction.execute(sql`
            insert into inbox_v2_outbound_dispatch_artifacts (
              tenant_id, id, dispatch_id, route_id, attempt_id, message_id,
              ordinal, state, diagnostic_code_id, diagnostic_retryable,
              diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
              created_at, revision
            ) values (
              ${fixture.tenantId},
              ${`outbound_dispatch_artifact:missing-attempt-${runId}`},
              ${fixture.queuedDispatch.id}, ${fixture.route.id},
              ${`outbound_dispatch_attempt:missing-${runId}`},
              ${fixture.references.message.id}, 1, 'accepted',
              null, null, null, null, ${OUTBOUND_TEST_TIMES.artifactAt}, 1
            )
          `);
          await transaction.execute(sql`set constraints all immediate`);
        }),
        /23503|foreign key/u
      );
    });

    it("atomically terminally finalizes a claimed provider intent after admin disable with zero attempts", async () => {
      const fixture = fixtureFor("atomic-route-failure");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      await expect(
        persistAtomicOutboundProducer(db, fixture)
      ).resolves.toMatchObject({ kind: "applied" });

      const commandInput = authorizedExternalSendInput(fixture);
      const providerIntent = commandInput.records.outboxIntents.find(
        (intent) => intent.typeId === "core:provider.dispatch"
      );
      if (providerIntent === undefined) {
        throw new Error("Atomic route-failure fixture has no provider intent.");
      }
      const routeFailureTenantId = inboxV2TenantIdSchema.parse(
        fixture.tenantId
      );
      const workerId = inboxV2NamespacedIdSchema.parse(
        "core:provider-route-failure-worker"
      );
      const outbox = createSqlInboxV2RepositoryOutbox(db, {
        tokenSource: (count) =>
          Array.from(
            { length: count },
            (_, index) =>
              `lease-token:route-failure-${index}-${runId}-${"r".repeat(32)}`
          )
      });
      const claimed = await outbox.claimAvailable({
        context: { tenantId: routeFailureTenantId },
        workerId,
        leaseDurationSeconds: 30,
        batchSize: 2
      });
      if (claimed.outcome !== "claimed") {
        throw new Error(
          "Atomic route-failure provider intent was not claimed."
        );
      }
      const providerClaim = claimed.claims.find(
        (claim) => claim.work.intentId === providerIntent.id
      );
      if (providerClaim === undefined || providerClaim.work.lease === null) {
        throw new Error("Atomic route-failure claim has no exact lease.");
      }
      const failedAt = providerClaim.work.lease.claimedAt;
      await db.transaction(async (transaction) => {
        await transaction.execute(
          sql`set local session_replication_role = replica`
        );
        await transaction.execute(sql`
          update inbox_v2_source_thread_binding_heads
             set administrative_state = 'disabled',
                 administrative_revision = 2,
                 administrative_changed_at = ${failedAt},
                 revision = 2,
                 updated_at = ${failedAt}
           where tenant_id = ${fixture.tenantId}
             and binding_id = ${fixture.references.binding.id}
        `);
        await transaction.execute(
          sql`set local session_replication_role = origin`
        );
      });

      const bindingHeadSnapshot = {
        ...fixture.bindingHeadSnapshot,
        fence: {
          ...fixture.bindingHeadSnapshot.fence,
          administrativeRevision: "2"
        },
        administrative: { state: "disabled" as const, revision: "2" },
        bindingRevision: "2",
        updatedAt: failedAt
      };
      const dispatchAfter = inboxV2OutboundDispatchSchema.parse({
        ...fixture.queuedDispatch,
        state: "terminal_failure",
        revision: "2",
        updatedAt: failedAt
      });
      const commit = inboxV2OutboundDispatchRouteFailureCommitSchema.parse({
        tenantId: fixture.tenantId,
        routeSnapshot: fixture.route,
        bindingHeadSnapshot,
        error: {
          code: "route.binding_changed",
          retryability: "retryable_resolution",
          diagnostic: null
        },
        dispatchBefore: fixture.queuedDispatch,
        dispatchAfter,
        failedByTrustedServiceId:
          fixture.route.adapterContract.loadedByTrustedServiceId,
        failedAt
      });
      const fence = {
        context: { tenantId: routeFailureTenantId },
        intentId: providerIntent.id,
        workerId,
        leaseToken: providerClaim.leaseToken,
        expectedLeaseRevision: providerClaim.work.lease.leaseRevision,
        expectedHandlerId: providerIntent.handlerId
      } as const;

      await expect(
        createSqlInboxV2OutboundTransportRepository(db).applyRouteFailureFenced(
          {
            outboxLease: fence,
            commit
          }
        )
      ).resolves.toEqual({ kind: "committed" });

      const expectedFinalization = deriveInboxV2RouteFailureOutboxFinalization({
        intentId: providerIntent.id,
        commit
      });
      const state = await db.execute<{
        dispatch_state: string;
        dispatch_revision: string;
        attempt_count: string;
        outbox_state: string;
        terminal_error_code: string | null;
        terminal_result_hash: string | null;
        outcome_count: string;
      }>(sql`
        select dispatch_row.state::text as dispatch_state,
               dispatch_row.revision::text as dispatch_revision,
               (
                 select count(*)::text
                   from inbox_v2_outbound_dispatch_attempts attempt_row
                  where attempt_row.tenant_id = dispatch_row.tenant_id
                    and attempt_row.dispatch_id = dispatch_row.id
               ) as attempt_count,
               work.state::text as outbox_state,
               work.terminal_error_code,
               work.terminal_result_hash,
               (
                 select count(*)::text
                   from inbox_v2_outbox_outcomes outcome_row
                  where outcome_row.tenant_id = work.tenant_id
                    and outcome_row.intent_id = work.intent_id
                    and outcome_row.kind = 'dead'
               ) as outcome_count
          from inbox_v2_outbound_dispatches dispatch_row
          join inbox_v2_outbox_work_items work
            on work.tenant_id = dispatch_row.tenant_id
           and work.intent_id = ${providerIntent.id}
         where dispatch_row.tenant_id = ${fixture.tenantId}
           and dispatch_row.id = ${fixture.queuedDispatch.id}
      `);
      expect(state.rows[0]).toEqual({
        dispatch_state: "terminal_failure",
        dispatch_revision: "2",
        attempt_count: "0",
        outbox_state: "dead",
        terminal_error_code: "core:route.binding_changed",
        terminal_result_hash: expectedFinalization.resultHash,
        outcome_count: "1"
      });
    });

    it("rejects a stale binding fence before opening provider I/O", async () => {
      const fixture = fixtureFor("stale-fence");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      const repository = createSqlInboxV2OutboundTransportRepository(db);
      await expect(
        persistAtomicOutboundProducer(db, fixture)
      ).resolves.toMatchObject({ kind: "applied" });
      await expect(
        repository.createDispatch(fixture.queuedDispatch)
      ).resolves.toEqual({
        kind: "already_exists",
        dispatch: fixture.queuedDispatch
      });
      await db.transaction(async (transaction) => {
        await transaction.execute(
          sql`set local session_replication_role = replica`
        );
        await transaction.execute(sql`
          update inbox_v2_source_thread_binding_heads
             set capability_revision = capability_revision + 1
           where tenant_id = ${fixture.tenantId}
             and binding_id = ${fixture.references.binding.id}
        `);
        await transaction.execute(
          sql`set local session_replication_role = origin`
        );
      });

      await expect(
        repository.applyAttempt(fixture.openAttemptCommit)
      ).resolves.toEqual({ kind: "binding_fence_conflict" });
      const count = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_outbound_dispatch_attempts
        where tenant_id = ${fixture.tenantId}
          and dispatch_id = ${fixture.queuedDispatch.id}
      `);
      expect(count.rows[0]?.count).toBe("0");
    });

    it("rejects a same-id forged route snapshot before opening provider I/O", async () => {
      const fixture = fixtureFor("forged-open-route");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      const repository = createSqlInboxV2OutboundTransportRepository(db);
      await expect(
        persistAtomicOutboundProducer(db, fixture)
      ).resolves.toMatchObject({ kind: "applied" });
      await expect(
        repository.createDispatch(fixture.queuedDispatch)
      ).resolves.toEqual({
        kind: "already_exists",
        dispatch: fixture.queuedDispatch
      });
      const commit = fixture.openAttemptCommit;
      if (commit.kind !== "open_attempt") {
        throw new Error("open attempt fixture");
      }
      const forgedBinding = {
        ...commit.routeSnapshot.sourceThreadBinding,
        id: `source_thread_binding:forged-open-${runId}`
      };
      const forgedCommit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
        ...commit,
        routeSnapshot: {
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
        },
        bindingHeadSnapshot: {
          ...commit.bindingHeadSnapshot,
          binding: forgedBinding
        }
      });

      await expect(repository.applyAttempt(forgedCommit)).resolves.toEqual({
        kind: "route_not_found"
      });
      const count = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_outbound_dispatch_attempts
        where tenant_id = ${fixture.tenantId}
          and dispatch_id = ${fixture.queuedDispatch.id}
      `);
      expect(count.rows[0]?.count).toBe("0");
    });

    it("allows only one concurrent claimant to open the first attempt", async () => {
      const fixture = fixtureFor("concurrent-claim");
      tenantIds.push(fixture.tenantId);
      await seedOutboundAnchors(db, fixture);
      const repository = createSqlInboxV2OutboundTransportRepository(db);
      await expect(
        persistAtomicOutboundProducer(db, fixture)
      ).resolves.toMatchObject({ kind: "applied" });
      await expect(
        repository.createDispatch(fixture.queuedDispatch)
      ).resolves.toEqual({
        kind: "already_exists",
        dispatch: fixture.queuedDispatch
      });

      const competingAttemptReference = {
        tenantId: fixture.tenantId,
        kind: "outbound_dispatch_attempt" as const,
        id: `outbound_dispatch_attempt:competing-${runId}`
      };
      const competingAttempt = inboxV2OutboundDispatchAttemptSchema.parse({
        ...fixture.pendingAttempt,
        id: competingAttemptReference.id,
        claimToken: `claim:competing-${runId}`
      });
      const competingDispatchAfter = inboxV2OutboundDispatchSchema.parse({
        ...fixture.attemptingDispatch,
        activeAttempt: competingAttemptReference,
        lastAttempt: competingAttemptReference
      });
      const competingCommit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
        ...fixture.openAttemptCommit,
        attempt: competingAttempt,
        dispatchAfter: competingDispatchAfter
      });

      const results = await Promise.all([
        repository.applyAttempt(fixture.openAttemptCommit),
        repository.applyAttempt(competingCommit)
      ]);
      expect(results.map(({ kind }) => kind).sort()).toEqual([
        "committed",
        "dispatch_state_conflict"
      ]);
      const attempts = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_outbound_dispatch_attempts
        where tenant_id = ${fixture.tenantId}
          and dispatch_id = ${fixture.queuedDispatch.id}
      `);
      expect(attempts.rows[0]?.count).toBe("1");
    });
  }
);

type RawOutboundFixture = ReturnType<
  typeof createOutboundTransportContractFixture
>;
type OutboundFixture = ReturnType<typeof canonicalOutboundFixture>;
type OutboundRuntimeHealthState =
  | "unknown"
  | "ready"
  | "degraded"
  | "unavailable";

function fixtureFor(
  label: string,
  runtimeHealthState: OutboundRuntimeHealthState = "ready"
): OutboundFixture {
  const suffix = `${label}-${runId}`;
  return canonicalOutboundFixture(
    createOutboundTransportContractFixture({
      tenantId: `tenant:db003-outbound-${suffix}`,
      suffix
    }),
    runtimeHealthState
  );
}

function canonicalOutboundFixture(
  fixture: RawOutboundFixture,
  runtimeHealthState: OutboundRuntimeHealthState = "ready"
) {
  const operationId = "core:message.send" as const;
  const requiredPermissionId = "core:message.reply_external" as const;
  const authorizationNotAfter = new Date(
    Date.now() + 60 * 60 * 1_000
  ).toISOString();
  const candidate = fixture.routeInput.candidates.soleEligibleCandidate;
  if (candidate === null) {
    throw new Error(
      "Outbound integration fixture requires one route candidate."
    );
  }
  const canonicalTarget = {
    ...candidate.conversationAuthorization.target,
    operationId
  };
  const conversationAuthorization = {
    ...candidate.conversationAuthorization,
    target: canonicalTarget,
    requiredPermissionId,
    matchedPermissionIds: [requiredPermissionId],
    notAfter: authorizationNotAfter
  };
  const sourceAccountAuthorization = {
    ...candidate.sourceAccountAuthorization,
    target: canonicalTarget,
    notAfter: authorizationNotAfter
  };
  const runtimeObservation = {
    state: runtimeHealthState,
    revision: candidate.runtimeObservation.revision,
    observedAt: candidate.runtimeObservation.observedAt,
    diagnostic:
      runtimeHealthState === "degraded" || runtimeHealthState === "unavailable"
        ? {
            codeId: `module:synthetic:runtime-${runtimeHealthState}`,
            retryable: true,
            correlationToken: `diagnostic:runtime-${runtimeHealthState}-${fixture.suffix}`,
            safeOperatorHintId: "core:retry-same-route"
          }
        : null
  };
  const canonicalCandidate = {
    ...candidate,
    operationId,
    conversationAuthorization,
    sourceAccountAuthorization,
    runtimeObservation
  };
  const routePolicy = inboxV2ThreadRoutePolicySchema.parse({
    ...fixture.routePolicy,
    operationId,
    requiredConversationPermissionId: requiredPermissionId
  });
  const routeInput = inboxV2OutboundRouteResolutionInputSchema.parse({
    ...fixture.routeInput,
    operationId,
    routePolicy,
    candidates: {
      ...fixture.routeInput.candidates,
      operationId,
      notAfter: authorizationNotAfter,
      soleEligibleCandidate: canonicalCandidate
    }
  });
  const routeResult = resolveInboxV2OutboundRoute(routeInput);
  if (routeResult.kind !== "selected") {
    throw new Error("Canonical outbound fixture route must be selected.");
  }
  const route = inboxV2OutboundRouteSchema.parse({
    ...fixture.route,
    operationId,
    requiredConversationPermissionId: requiredPermissionId,
    conversationAuthorization,
    sourceAccountAuthorization,
    runtimeObservationAtResolution: routeResult.candidate.runtimeObservation,
    selection: {
      ...fixture.route.selection,
      reason: routeResult.selectionReason,
      candidateSnapshotNotAfter: authorizationNotAfter
    }
  });
  const routeCommit = inboxV2OutboundRouteResolutionCommitSchema.parse({
    input: routeInput,
    result: routeResult,
    route
  });
  const messageCreationCommit = canonicalMessageCreationCommit(fixture, route);
  const openAttemptCommit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
    ...fixture.openAttemptCommit,
    routeSnapshot: route
  });
  const reconciliationDecision = {
    ...fixture.reconciliationDecision,
    routeSnapshot: route
  };
  const reconciliationCommit =
    inboxV2OutboundDispatchReconciliationCommitSchema.parse({
      ...fixture.reconciliationCommit,
      decision: reconciliationDecision
    });
  const echoAssociation =
    inboxV2OutboundDispatchArtifactAssociationCommitSchema.parse({
      ...fixture.echoAssociation,
      route
    });
  const responseAssociation =
    inboxV2OutboundDispatchArtifactAssociationCommitSchema.parse({
      ...fixture.responseAssociation,
      route
    });

  return {
    ...fixture,
    routePolicy,
    routeInput,
    routeResult,
    route,
    routeCommit,
    messageCreationCommit,
    openAttemptCommit,
    reconciliationDecision: reconciliationCommit.decision,
    reconciliationCommit,
    echoAssociation,
    responseAssociation
  };
}

function routeCommitAtPolicyRevision(
  fixture: OutboundFixture,
  revision: string
) {
  const routePolicy = inboxV2ThreadRoutePolicySchema.parse({
    ...fixture.routeCommit.input.routePolicy,
    revision
  });
  const input = inboxV2OutboundRouteResolutionInputSchema.parse({
    ...fixture.routeCommit.input,
    routePolicy,
    candidates: {
      ...fixture.routeCommit.input.candidates,
      routePolicyRevision: revision
    }
  });
  const result = resolveInboxV2OutboundRoute(input);
  if (result.kind !== "selected") {
    throw new Error("Advanced route-policy fixture must remain selectable.");
  }
  return inboxV2OutboundRouteResolutionCommitSchema.parse({
    input,
    result,
    route: {
      ...fixture.route,
      routePolicyRevision: revision
    }
  });
}

function routeCommitWithDestinationSubject(
  fixture: OutboundFixture,
  destinationSubject: string
) {
  const candidate = fixture.routeCommit.input.candidates.soleEligibleCandidate;
  if (candidate === null) {
    throw new Error("Forged destination fixture requires one route candidate.");
  }
  const routeDescriptor = {
    ...candidate.routeDescriptor,
    destinationSubject
  };
  const input = inboxV2OutboundRouteResolutionInputSchema.parse({
    ...fixture.routeCommit.input,
    candidates: {
      ...fixture.routeCommit.input.candidates,
      soleEligibleCandidate: {
        ...candidate,
        routeDescriptor
      }
    }
  });
  const result = resolveInboxV2OutboundRoute(input);
  if (result.kind !== "selected") {
    throw new Error("Forged destination fixture must remain selectable.");
  }
  return inboxV2OutboundRouteResolutionCommitSchema.parse({
    input,
    result,
    route: {
      ...fixture.route,
      routeDescriptor,
      selection: {
        ...fixture.route.selection,
        reason: result.selectionReason,
        fallbackPolicyOrdinal: result.fallbackPolicyOrdinal
      }
    }
  });
}

function explicitRerouteIntegrationFixture(fixture: OutboundFixture) {
  const candidate = fixture.routeCommit.input.candidates.soleEligibleCandidate;
  if (candidate === null) {
    throw new Error("Explicit reroute fixture requires one route candidate.");
  }
  const replacementBinding = {
    ...candidate.sourceThreadBinding,
    id: `source_thread_binding:outbound-reroute-${fixture.suffix}`
  };
  const replacementSourceConnection = {
    ...candidate.sourceConnection,
    id: `source_connection:outbound-reroute-${fixture.suffix}`
  };
  const replacementSourceAccount = {
    ...candidate.sourceAccount,
    id: `source_account:outbound-reroute-${fixture.suffix}`
  };
  const target = {
    ...candidate.conversationAuthorization.target,
    sourceThreadBinding: replacementBinding,
    sourceConnection: replacementSourceConnection,
    sourceAccount: replacementSourceAccount
  };
  const replacementCandidate = {
    ...candidate,
    sourceThreadBinding: replacementBinding,
    sourceConnection: replacementSourceConnection,
    sourceAccount: replacementSourceAccount,
    conversationAuthorization: {
      ...candidate.conversationAuthorization,
      target
    },
    sourceAccountAuthorization: {
      ...candidate.sourceAccountAuthorization,
      target
    }
  };
  const replacementSuffix = `${fixture.suffix}-reroute-replacement`;
  const replacementMessageId = `message:${replacementSuffix}`;
  const replacementDispatchId = `outbound_dispatch:${replacementSuffix}`;
  const replacementProviderIntentId = `outbox-intent:atomic-provider-${replacementSuffix}`;
  const input = inboxV2OutboundRouteResolutionInputSchema.parse({
    ...fixture.routeCommit.input,
    intent: {
      kind: "explicit_reroute",
      originalRoute: {
        tenantId: fixture.tenantId,
        kind: "outbound_route",
        id: fixture.route.id
      },
      originalDispatch: {
        tenantId: fixture.tenantId,
        kind: "outbound_dispatch",
        id: fixture.queuedDispatch.id
      },
      expectedOriginalDispatchRevision: fixture.queuedDispatch.revision,
      replacementBinding,
      reasonId: "core:operator-reroute"
    },
    candidates: {
      ...fixture.routeCommit.input.candidates,
      explicitTarget: replacementCandidate,
      soleEligibleCandidate: replacementCandidate,
      snapshotToken: `snapshot:outbound-reroute-${fixture.suffix}`
    },
    mutationToken: `mutation:outbound-reroute-${fixture.suffix}`,
    idempotencyToken: `idempotency:outbound-reroute-${fixture.suffix}`,
    correlationToken: `correlation:outbound-reroute-${fixture.suffix}`,
    requestedAt: OUTBOUND_TEST_TIMES.openedAt
  });
  const commit = materializeInboxV2OutboundRouteResolutionCommit(input, {
    routeId: `outbound_route:outbound-reroute-${fixture.suffix}`,
    selectedAt: input.requestedAt
  });
  if (
    commit.route === null ||
    commit.route.selection.intent.kind !== "explicit_reroute"
  ) {
    throw new Error("Explicit reroute fixture did not select its replacement.");
  }
  const rerouteCommit = inboxV2OutboundDispatchRerouteCommitSchema.parse({
    tenantId: fixture.tenantId,
    original: {
      dispatchBefore: fixture.queuedDispatch,
      dispatchAfter: {
        ...fixture.queuedDispatch,
        state: "cancelled",
        revision: "2",
        updatedAt: commit.route.selection.selectedAt
      },
      outboxIntentId: `outbox-intent:atomic-provider-${fixture.suffix}`
    },
    replacement: {
      message: {
        tenantId: fixture.tenantId,
        kind: "message",
        id: replacementMessageId
      },
      route: {
        tenantId: fixture.tenantId,
        kind: "outbound_route",
        id: commit.route.id
      },
      dispatch: {
        tenantId: fixture.tenantId,
        kind: "outbound_dispatch",
        id: replacementDispatchId
      },
      outboxIntentId: replacementProviderIntentId
    },
    reasonId: commit.route.selection.intent.reasonId,
    changedAt: commit.route.selection.selectedAt
  });
  return {
    replacement: {
      binding: replacementBinding,
      sourceConnection: replacementSourceConnection,
      sourceAccount: replacementSourceAccount
    },
    replacementSuffix,
    replacementMessageId,
    replacementDispatchId,
    commit,
    rerouteCommit
  };
}

function explicitRerouteAtomicFixture(
  fixture: OutboundFixture,
  reroute: ReturnType<typeof explicitRerouteIntegrationFixture>
): OutboundFixture {
  const commit = reroute.commit;
  if (commit.route === null) {
    throw new Error(
      "Explicit reroute atomic fixture requires a selected route."
    );
  }
  const routeReference = {
    tenantId: fixture.tenantId,
    kind: "outbound_route" as const,
    id: commit.route.id
  };
  const messageReference = {
    tenantId: fixture.tenantId,
    kind: "message" as const,
    id: reroute.replacementMessageId
  };
  const timelineItemReference = {
    tenantId: fixture.tenantId,
    kind: "timeline_item" as const,
    id: `timeline_item:${reroute.replacementSuffix}`
  };
  const queuedDispatch = inboxV2OutboundDispatchSchema.parse({
    ...fixture.queuedDispatch,
    id: reroute.replacementDispatchId,
    message: messageReference,
    route: routeReference,
    createdAt: commit.route.createdAt,
    updatedAt: commit.route.createdAt
  });
  const reroutedFixture = {
    ...fixture,
    suffix: reroute.replacementSuffix,
    references: {
      ...fixture.references,
      message: messageReference,
      timelineItem: timelineItemReference,
      route: routeReference
    },
    route: commit.route,
    routeCommit: commit,
    queuedDispatch
  };
  return {
    ...reroutedFixture,
    messageCreationCommit: canonicalMessageCreationCommit(
      reroutedFixture,
      commit.route,
      {
        priorTimelineSequence: "1",
        priorTimelineItemId: fixture.references.timelineItem.id,
        priorActivityAt:
          fixture.messageCreationCommit.timelineAllocation.committedAt,
        committedAt: commit.route.selection.selectedAt,
        authorParticipantId: fixture.messageCreationCommit.authorParticipant.id
      }
    )
  };
}

function authorizedExplicitRerouteIntegrationInput(
  originalFixture: OutboundFixture,
  fixture: OutboundFixture,
  reroute: ReturnType<typeof explicitRerouteIntegrationFixture>
): WithInboxV2AuthorizedCommandMutationInput {
  const commit = reroute.commit;
  const rerouteCommit = reroute.rerouteCommit;
  if (commit.route === null) {
    throw new Error("Explicit reroute command requires a selected route.");
  }
  const base = authorizedExternalSendInput(fixture);
  const decisions: InboxV2AuthorizationDecisionReference[] = [
    ...base.records.audit.authorizationDecisionRefs
  ];
  const selectedUse = decisions.find(
    (decision) => decision.permissionId === "core:source_account.use"
  );
  if (selectedUse === undefined) {
    throw new Error("Explicit reroute input has no selected-account use.");
  }
  const originalUse = selectedUse;
  const selectedReplacementUse: InboxV2AuthorizationDecisionReference =
    inboxV2AuthorizationDecisionReferenceSchema.parse({
      ...selectedUse,
      id: `authorization-decision:atomic-reroute-replacement-use-${fixture.suffix}`,
      resource: {
        ...selectedUse.resource,
        entityId: commit.route.sourceAccount.id
      },
      decisionHash: sha256(`${fixture.suffix}:reroute-replacement-use`)
    });
  const rerouteDecision: InboxV2AuthorizationDecisionReference =
    inboxV2AuthorizationDecisionReferenceSchema.parse({
      ...originalUse,
      id: `authorization-decision:atomic-reroute-${fixture.suffix}`,
      permissionId: "core:source.dispatch.reroute",
      decisionHash: sha256(`${fixture.suffix}:reroute-permission`)
    });
  const sourceDecisionIndex = decisions.findIndex(
    (decision) => decision.id === selectedUse.id
  );
  decisions.splice(sourceDecisionIndex, 1, selectedReplacementUse);
  decisions.push(originalUse, rerouteDecision);
  decisions.sort((left, right) => left.id.localeCompare(right.id));
  const matchedPermissionIds = [
    ...new Set(decisions.map((decision) => decision.permissionId))
  ].sort();
  const authorizationScopeIds = [
    ...new Set(decisions.map((decision) => decision.resourceScopeId))
  ].sort();
  const originalAuthorization = authorizedExternalSendInput(originalFixture);
  const resources: Array<
    WithInboxV2AuthorizedCommandMutationInput["revisions"]["resources"][number]
  > = [
    ...originalAuthorization.revisions.resources,
    {
      resourceKind: "source_account",
      resourceId: commit.route.sourceAccount.id,
      resourceHeadId: `authorization-resource:atomic-reroute-${fixture.suffix}`,
      expectedResourceAccessRevision: "1",
      advance: "none"
    }
  ];
  const rerouteCommitReference = {
    tenantId: fixture.tenantId,
    recordId: rerouteCommit.original.dispatchAfter.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
    digest: `sha256:${computeInboxV2TimelineMessageCommitDigest(
      rerouteCommit
    )}` as const
  };
  const originalDispatchReference = {
    tenantId: fixture.tenantId,
    recordId: rerouteCommit.original.dispatchAfter.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    digest: `sha256:${computeInboxV2TimelineMessageCommitDigest(
      rerouteCommit.original.dispatchAfter
    )}` as const
  };
  const originalChange = {
    id: `change:atomic-reroute-original-${fixture.suffix}`,
    ordinal: base.records.changes.length + 1,
    entity: {
      tenantId: fixture.tenantId,
      entityTypeId: "core:outbound-dispatch",
      entityId: rerouteCommit.original.dispatchAfter.id
    },
    resultingRevision: rerouteCommit.original.dispatchAfter.revision,
    timeline: null,
    audience: "conversation_external" as const,
    state: {
      kind: "upsert" as const,
      stateSchemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
      stateSchemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
      stateHash: originalDispatchReference.digest,
      payloadReference: originalDispatchReference,
      domainCommitReference: rerouteCommitReference
    }
  };
  const originalEvent = {
    ...base.records.events[0]!,
    id: `event:atomic-reroute-original-${fixture.suffix}`,
    ordinal: "2",
    typeId: "core:outbound-dispatch.changed" as const,
    payloadSchemaId: rerouteCommitReference.schemaId,
    payloadSchemaVersion: rerouteCommitReference.schemaVersion,
    changeIds: [originalChange.id],
    subjects: [originalChange.entity],
    payloadReference: rerouteCommitReference,
    authorizationDecisionRefs: decisions,
    occurredAt: rerouteCommit.changedAt,
    recordedAt: rerouteCommit.changedAt,
    eventHash: sha256(`${fixture.suffix}:reroute-original-event`)
  };
  const originalProjection = {
    ...base.records.outboxIntents[0]!,
    id: `outbox-intent:atomic-reroute-original-projection-${fixture.suffix}`,
    ordinal: base.records.outboxIntents.length + 1,
    eventId: originalEvent.id,
    changeIds: [originalChange.id],
    payloadReference: rerouteCommitReference,
    consumerDedupeKey: sha256(
      `${fixture.suffix}:reroute-original-projection-dedupe`
    ),
    intentHash: sha256(`${fixture.suffix}:reroute-original-projection-intent`)
  };
  return {
    ...base,
    command: {
      ...base.command,
      commandTypeId: rerouteDecision.permissionId,
      authorizationDecisionId: rerouteDecision.id
    },
    revisions: { ...base.revisions, resources },
    records: {
      ...base.records,
      expectedStreamEpoch: originalAuthorization.records.expectedStreamEpoch,
      changes: [...base.records.changes, originalChange],
      events: [
        ...base.records.events.map((event) => ({
          ...event,
          authorizationDecisionRefs: decisions
        })),
        originalEvent
      ],
      outboxIntents: [...base.records.outboxIntents, originalProjection],
      audit: {
        ...base.records.audit,
        actionId: rerouteDecision.permissionId,
        reasonCodeId: rerouteCommit.reasonId,
        matchedPermissionIds,
        authorizationScopeIds,
        evidenceReference: rerouteCommitReference,
        authorizationDecisionRefs: decisions
      }
    }
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

class PostgresRerouteProbeComplete extends Error {}

function canonicalMessageCreationCommit(
  fixture: RawOutboundFixture,
  route: ReturnType<typeof inboxV2OutboundRouteSchema.parse>,
  options: Readonly<{
    priorTimelineSequence: string;
    priorTimelineItemId: string;
    priorActivityAt: string;
    committedAt: string;
    authorParticipantId?: string;
  }> | null = null
) {
  const { references: refs, tenantId } = fixture;
  const createdAt = OUTBOUND_TEST_TIMES.loadedAt;
  const committedAt = options?.committedAt ?? OUTBOUND_TEST_TIMES.selectedAt;
  const timelineSequence = (
    BigInt(options?.priorTimelineSequence ?? "0") + 1n
  ).toString();
  const headRevision = options === null ? "1" : "2";
  const conversation = {
    tenantId,
    id: refs.conversation.id,
    topology: "group" as const,
    transport: "external" as const,
    purposeId: "core:chat",
    lifecycle: "active" as const,
    head: {
      latestTimelineSequence: options?.priorTimelineSequence ?? "0",
      latestActivityItemId: options?.priorTimelineItemId ?? null,
      latestActivityTimelineSequence: options?.priorTimelineSequence ?? null,
      latestActivityAt: options?.priorActivityAt ?? null,
      revision: headRevision,
      createdAt,
      updatedAt: options?.priorActivityAt ?? createdAt
    },
    revision: "1",
    createdAt,
    updatedAt: createdAt
  };
  const participant = {
    tenantId,
    id:
      options?.authorParticipantId ??
      `conversation_participant:outbound-${fixture.suffix}`,
    conversation: refs.conversation,
    subject: { kind: "employee" as const, employee: refs.employee },
    revision: "1",
    createdAt,
    updatedAt: createdAt
  };
  const content = inboxV2TimelineContentSchema.parse({
    tenantId,
    id: `timeline_content:outbound-${fixture.suffix}`,
    state: {
      kind: "available",
      blocks: [
        {
          blockKey: "body-1",
          kind: "text",
          role: "body",
          text: "Outbound transport integration message",
          language: "en"
        }
      ],
      contentDigestSha256: "4".repeat(64)
    },
    revision: "1",
    createdAt: committedAt,
    updatedAt: committedAt
  });
  const timelineItem = {
    tenantId,
    id: refs.timelineItem.id,
    conversation: refs.conversation,
    timelineSequence,
    subject: {
      kind: "message" as const,
      message: refs.message,
      messageRevision: "1"
    },
    visibility: "conversation_external" as const,
    activity: { kind: "eligible" as const },
    occurredAt: committedAt,
    receivedAt: committedAt,
    revision: "1",
    createdAt: committedAt,
    updatedAt: committedAt
  };
  const message = {
    tenantId,
    id: refs.message.id,
    conversation: refs.conversation,
    timelineItem: refs.timelineItem,
    authorParticipant: fixtureReference(
      "conversation_participant",
      participant.id,
      tenantId
    ),
    origin: { kind: "hulee_external" as const, outboundRoute: refs.route },
    appActor: {
      kind: "employee" as const,
      employee: refs.employee,
      authorizationEpoch: route.authorizationEpoch
    },
    automationCausation: null,
    content: inboxV2TimelineContentHeadOf(content),
    referenceContext: { kind: "none" as const },
    lifecycle: { kind: "active" as const },
    revision: "1",
    createdAt: committedAt,
    updatedAt: committedAt
  };
  const externalThreadMapping = {
    tenantId,
    thread: {
      tenantId,
      id: refs.externalThread.id,
      key: {
        realm: {
          realmId: "module:synthetic:thread-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account" as const, owner: refs.sourceAccount },
        objectKindId: "module:synthetic:group-thread",
        canonicalExternalSubject: `ProviderGroup:${fixture.suffix}`
      },
      identityDeclaration: {
        adapterContract: route.adapterContract,
        identityKind: "external_thread" as const,
        realmId: "module:synthetic:thread-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1",
        objectKindId: "module:synthetic:group-thread",
        scopeKind: "source_account" as const,
        decisionStrength: "safe_default" as const
      },
      conversation: refs.conversation,
      conversationTopology: "group" as const,
      revision: "1",
      createdAt,
      updatedAt: createdAt
    },
    conversation
  };
  const rawBindingSnapshot = replaceFixtureTenant(
    fixtureOutboundBindingSnapshot(route),
    tenantId
  );
  const bindingSnapshot = {
    ...rawBindingSnapshot,
    accountIdentitySnapshot: {
      ...rawBindingSnapshot.accountIdentitySnapshot,
      verifiedAt: createdAt
    },
    remoteAccess: {
      ...rawBindingSnapshot.remoteAccess,
      since: createdAt
    },
    administrative: {
      ...rawBindingSnapshot.administrative,
      changedAt: createdAt
    },
    runtimeHealth: {
      ...rawBindingSnapshot.runtimeHealth,
      state: route.runtimeObservationAtResolution.state,
      revision: route.runtimeObservationAtResolution.revision,
      checkedAt: route.runtimeObservationAtResolution.observedAt,
      diagnostic: route.runtimeObservationAtResolution.diagnostic
    },
    historySync: {
      ...rawBindingSnapshot.historySync,
      updatedAt: createdAt
    },
    providerAccess: {
      ...rawBindingSnapshot.providerAccess,
      observedAt: createdAt
    },
    capabilities: {
      ...rawBindingSnapshot.capabilities,
      capturedAt: createdAt
    },
    createdAt,
    updatedAt: committedAt
  };
  return inboxV2MessageCreationCommitSchema.parse({
    tenantId,
    timelineAllocation: {
      tenantId,
      conversationBefore: conversation,
      items: [timelineItem],
      conversationAfter: {
        ...conversation,
        head: {
          ...conversation.head,
          latestTimelineSequence: timelineSequence,
          latestActivityItemId: timelineItem.id,
          latestActivityTimelineSequence: timelineSequence,
          latestActivityAt: timelineItem.occurredAt,
          revision: (BigInt(headRevision) + 1n).toString(),
          updatedAt: committedAt
        }
      },
      committedAt
    },
    authorParticipant: participant,
    content,
    message,
    initialRevision: {
      tenantId,
      id: `message_revision:outbound-${fixture.suffix}`,
      message: refs.message,
      timelineItem: refs.timelineItem,
      expectedPreviousRevision: null,
      messageRevision: "1",
      change: { kind: "created", content: message.content },
      actionAttribution: {
        actionParticipant: message.authorParticipant,
        appActor: message.appActor,
        sourceOccurrence: null,
        automationCausation: null
      },
      occurredAt: timelineItem.occurredAt,
      recordedAt: committedAt,
      recordRevision: "1",
      createdAt: committedAt
    },
    sourceOccurrence: null,
    claimAtOccurrenceSnapshot: null,
    sourceResolutionCommit: null,
    externalMessageReference: null,
    originTransportLink: null,
    originTransportLinkHead: null,
    externalThreadMapping,
    canonicalReferenceTargets: [],
    externalReferenceTargets: [],
    unresolvedReferenceTarget: null,
    providerReferenceSemantics: [],
    outboundRoute: route,
    outboundBindingSnapshot: bindingSnapshot,
    outboundDispatch: fixture.queuedDispatch,
    routeConsumption: {
      outboundRoute: refs.route,
      message: refs.message,
      mutationToken: route.mutationToken,
      idempotencyToken: route.idempotencyToken,
      correlationToken: route.correlationToken,
      consumedByTrustedServiceId:
        route.adapterContract.loadedByTrustedServiceId,
      consumedAt: committedAt,
      revision: "1"
    }
  });
}

function replaceFixtureTenant<T>(value: T, tenantId: string): T {
  if (value === "tenant:tenant-1") return tenantId as T;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => replaceFixtureTenant(item, tenantId)) as T;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      replaceFixtureTenant(item, tenantId)
    ])
  ) as T;
}

function authorizedExternalSendInput(
  fixture: OutboundFixture
): WithInboxV2AuthorizedCommandMutationInput {
  const tenantId = fixture.tenantId;
  const occurredAt =
    fixture.messageCreationCommit.timelineAllocation.committedAt;
  const authorizedAt = occurredAt;
  const conversationAuthorization = fixture.route.conversationAuthorization;
  const sourceAccountAuthorization = fixture.route.sourceAccountAuthorization;
  const notAfter = conversationAuthorization.notAfter;
  const expiresAt = new Date(
    Date.parse(occurredAt) + 24 * 60 * 60 * 1_000
  ).toISOString();
  const token = fixture.suffix;
  const commandId = `command:atomic-${token}`;
  const clientMutationId = `mutation:atomic-${token}`;
  const mutationId = `authorization-mutation:atomic-${token}`;
  const streamCommitId = `commit:atomic-${token}`;
  const correlationId = `correlation:atomic-${token}`;
  const messageChangeId = `change:atomic-message-${token}`;
  const dispatchChangeId = `change:atomic-dispatch-${token}`;
  const eventId = `event:atomic-message-${token}`;
  const projectionIntentId = `outbox-intent:atomic-projection-${token}`;
  const providerIntentId = `outbox-intent:atomic-provider-${token}`;
  const decision = {
    tenantId,
    id: `authorization-decision:atomic-${token}`,
    authorizationEpoch: fixture.route.authorizationEpoch,
    principal: {
      kind: "employee" as const,
      employee: fixture.references.employee
    },
    permissionId: fixture.route.requiredConversationPermissionId,
    resourceScopeId: "core:conversation",
    resource: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: fixture.references.conversation.id
    },
    resourceAccessRevision: "1",
    decisionRevision: conversationAuthorization.decisionRevision,
    decisionHash: sha256(`${token}:authorization-decision`),
    outcome: "allowed" as const,
    decidedAt: conversationAuthorization.decidedAt,
    notAfter
  };
  const sourceAccountDecision = {
    ...decision,
    id: `authorization-decision:atomic-source-account-${token}`,
    permissionId: "core:source_account.use",
    resourceScopeId: "core:source-account",
    resource: {
      tenantId,
      entityTypeId: "core:source-account",
      entityId: fixture.references.sourceAccount.id
    },
    decisionRevision: sourceAccountAuthorization.decisionRevision,
    decisionHash: sha256(`${token}:source-account-authorization-decision`),
    decidedAt: sourceAccountAuthorization.decidedAt,
    notAfter: sourceAccountAuthorization.notAfter
  };
  const authorizationDecisionRefs = [decision, sourceAccountDecision].sort(
    (left, right) => (left.id === right.id ? 0 : left.id < right.id ? -1 : 1)
  );
  const messageReference = {
    tenantId,
    recordId: fixture.references.message.id,
    schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
    digest: `sha256:${computeInboxV2TimelineMessageCommitDigest(
      fixture.messageCreationCommit.message
    )}` as const
  };
  const dispatchReference = {
    tenantId,
    recordId: fixture.queuedDispatch.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    digest: `sha256:${computeInboxV2TimelineMessageCommitDigest(
      fixture.queuedDispatch
    )}` as const
  };
  const domainCommitReference = {
    tenantId,
    recordId: fixture.messageCreationCommit.initialRevision.id,
    schemaId: "core:inbox-v2.message-creation-commit",
    schemaVersion: "v1",
    digest: `sha256:${computeInboxV2TimelineMessageCommitDigest(
      fixture.messageCreationCommit
    )}` as const
  };
  const changes = [
    {
      id: messageChangeId,
      ordinal: 1,
      entity: {
        tenantId,
        entityTypeId: "core:message",
        entityId: fixture.references.message.id
      },
      resultingRevision: "1",
      timeline: {
        conversation: fixture.references.conversation,
        timelineSequence:
          fixture.messageCreationCommit.timelineAllocation.items[0]!
            .timelineSequence
      },
      audience: "conversation_external" as const,
      state: {
        kind: "upsert" as const,
        stateSchemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
        stateSchemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
        stateHash: messageReference.digest,
        payloadReference: messageReference,
        domainCommitReference
      }
    },
    {
      id: dispatchChangeId,
      ordinal: 2,
      entity: {
        tenantId,
        entityTypeId: "core:outbound-dispatch",
        entityId: fixture.queuedDispatch.id
      },
      resultingRevision: "1",
      timeline: null,
      audience: "conversation_external" as const,
      state: {
        kind: "upsert" as const,
        stateSchemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
        stateSchemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
        stateHash: dispatchReference.digest,
        payloadReference: dispatchReference,
        domainCommitReference
      }
    }
  ];
  const event = {
    id: eventId,
    typeId: "core:message.changed" as const,
    payloadSchemaId: domainCommitReference.schemaId,
    payloadSchemaVersion: domainCommitReference.schemaVersion,
    ordinal: "1",
    changeIds: [messageChangeId, dispatchChangeId],
    subjects: changes.map((change) => change.entity),
    payloadReference: domainCommitReference,
    correlationId,
    commandIds: [commandId],
    clientMutationIds: [clientMutationId],
    authorizationDecisionRefs,
    accessEffect: { kind: "none" as const },
    occurredAt: fixture.messageCreationCommit.initialRevision.occurredAt,
    recordedAt: fixture.messageCreationCommit.initialRevision.recordedAt,
    eventHash: sha256(`${token}:message-event`)
  };
  const internalReference = (purpose: string) =>
    `internal-ref:${createHash("sha256")
      .update(`${token}:${purpose}`, "utf8")
      .digest("hex")
      .slice(0, 32)}`;

  return {
    tenantId,
    command: {
      id: commandId,
      requestId: `request:atomic-${token}`,
      clientMutationId,
      commandTypeId: "core:message.send",
      requestHash: sha256(`${token}:request`),
      actor: {
        kind: "employee",
        employeeId: fixture.references.employee.id
      },
      authorizationDecisionId: decision.id,
      authorizationEpoch: decision.authorizationEpoch,
      authorizedAt,
      publicResultCode: "core:message.queued",
      resultReference: messageReference,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [
        {
          employeeId: fixture.references.employee.id,
          expectedEmployeeAccessRevision: "1",
          expectedEmployeeInboxRelationRevision: "1",
          advanceEmployeeAccess: false,
          advanceEmployeeInboxRelation: false
        }
      ],
      resources: [
        {
          resourceKind: "conversation",
          resourceId: fixture.references.conversation.id,
          resourceHeadId: `authorization-resource:atomic-${token}`,
          expectedResourceAccessRevision: "1",
          advance: "none"
        },
        {
          resourceKind: "source_account",
          resourceId: fixture.references.sourceAccount.id,
          resourceHeadId: `authorization-resource:atomic-source-account-${token}`,
          expectedResourceAccessRevision: "1",
          advance: "none"
        }
      ]
    },
    records: {
      mutationId,
      relationKind: null,
      streamCommitId,
      expectedStreamEpoch: `stream-epoch:atomic-${token}`,
      audienceImpact: { kind: "none" },
      commitHash: sha256(`${token}:stream-commit`),
      correlationId,
      changes,
      events: [event],
      outboxIntents: [
        {
          id: projectionIntentId,
          ordinal: 1,
          typeId: "core:projection.update",
          handlerId: "core:inbox-projection",
          effectClass: "projection",
          eventId,
          changeIds: [messageChangeId, dispatchChangeId],
          payloadReference: null,
          consumerDedupeKey: sha256(`${token}:projection-dedupe`),
          correlationId,
          availableAt: occurredAt,
          intentHash: sha256(`${token}:projection-intent`)
        },
        {
          id: providerIntentId,
          ordinal: 2,
          typeId: "core:provider.dispatch",
          handlerId: "core:provider-dispatch-worker",
          effectClass: "provider_io",
          eventId,
          changeIds: [dispatchChangeId],
          payloadReference: dispatchReference,
          consumerDedupeKey: sha256(`${token}:provider-dedupe`),
          correlationId,
          availableAt: occurredAt,
          intentHash: sha256(`${token}:provider-intent`)
        }
      ],
      audit: {
        id: `authorization-audit:atomic-${token}`,
        actionId: "core:message.send",
        target: {
          tenantId,
          entityTypeId: "core:outbound-dispatch",
          entityId: internalReference("audit-target")
        },
        reasonCodeId: "core:message-send-requested",
        matchedPermissionIds: authorizationDecisionRefs
          .map(({ permissionId }) => permissionId)
          .sort(comparePostgresCText),
        grantSourceIds: [internalReference("grant-source")],
        authorizationScopeIds: authorizationDecisionRefs
          .map(({ resourceScopeId }) => resourceScopeId)
          .sort(comparePostgresCText),
        overrideReasonCodeId: null,
        policyVersion: "v1",
        evidenceReference: domainCommitReference,
        authorizationDecisionRefs,
        correlationId,
        outcome: "succeeded",
        revisionDeltaHash: computeInboxV2LeafHashDigest([]),
        previousAuditHash: null,
        auditHash: sha256(`${token}:audit`),
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
              entityId: internalReference("tenant-facet")
            },
            relation: "affected",
            facetHash: sha256(`${token}:audit-facet`)
          }
        ]
      }
    },
    occurredAt
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

function withoutAtomicProviderIntent(
  input: WithInboxV2AuthorizedCommandMutationInput
): WithInboxV2AuthorizedCommandMutationInput {
  return {
    ...input,
    records: {
      ...input.records,
      outboxIntents: input.records.outboxIntents.filter(
        ({ effectClass }) => effectClass !== "provider_io"
      )
    }
  };
}

function atomicProviderClosureFailureInput(
  input: WithInboxV2AuthorizedCommandMutationInput,
  fixture: OutboundFixture,
  failureKind:
    | "missing_provider_intent"
    | "duplicate_provider_intents"
    | "revision_2_dispatch_change"
    | "dispatch_row_without_change_or_provider_intent"
): WithInboxV2AuthorizedCommandMutationInput {
  switch (failureKind) {
    case "missing_provider_intent":
      return withoutAtomicProviderIntent(input);
    case "duplicate_provider_intents":
      return duplicateAtomicProviderClosure(input, fixture);
    case "revision_2_dispatch_change":
      return withRevision2DispatchChangeWithoutProviderIntent(input);
    case "dispatch_row_without_change_or_provider_intent":
      return withoutAtomicDispatchChangeAndProviderIntent(input);
  }
}

function withRevision2DispatchChangeWithoutProviderIntent(
  input: WithInboxV2AuthorizedCommandMutationInput
): WithInboxV2AuthorizedCommandMutationInput {
  const withoutProviderIntent = withoutAtomicProviderIntent(input);
  return {
    ...withoutProviderIntent,
    records: {
      ...withoutProviderIntent.records,
      changes: withoutProviderIntent.records.changes.map((change) =>
        change.entity.entityTypeId === "core:outbound-dispatch"
          ? {
              ...change,
              resultingRevision: inboxV2EntityRevisionSchema.parse("2")
            }
          : change
      )
    }
  };
}

function withoutAtomicDispatchChangeAndProviderIntent(
  input: WithInboxV2AuthorizedCommandMutationInput
): WithInboxV2AuthorizedCommandMutationInput {
  const dispatchChangeIds = new Set(
    input.records.changes
      .filter(({ entity }) => entity.entityTypeId === "core:outbound-dispatch")
      .map(({ id }) => String(id))
  );
  return {
    ...input,
    records: {
      ...input.records,
      changes: input.records.changes.filter(
        ({ id }) => !dispatchChangeIds.has(String(id))
      ),
      events: input.records.events.map((event) => ({
        ...event,
        changeIds: event.changeIds.filter(
          (changeId) => !dispatchChangeIds.has(String(changeId))
        ),
        subjects: event.subjects.filter(
          ({ entityTypeId }) => entityTypeId !== "core:outbound-dispatch"
        )
      })),
      outboxIntents: input.records.outboxIntents
        .filter(({ effectClass }) => effectClass !== "provider_io")
        .map((intent) => ({
          ...intent,
          changeIds: intent.changeIds.filter(
            (changeId) => !dispatchChangeIds.has(String(changeId))
          )
        }))
    }
  };
}

function duplicateAtomicProviderClosure(
  input: WithInboxV2AuthorizedCommandMutationInput,
  fixture: OutboundFixture
): WithInboxV2AuthorizedCommandMutationInput {
  const dispatchChange = input.records.changes.find(
    ({ entity }) => entity.entityTypeId === "core:outbound-dispatch"
  );
  const providerIntent = input.records.outboxIntents.find(
    ({ effectClass }) => effectClass === "provider_io"
  );
  if (dispatchChange === undefined || providerIntent === undefined) {
    throw new Error("Atomic outbound fixture lacks its provider closure.");
  }
  const duplicateChange = {
    ...dispatchChange,
    id: `change:atomic-dispatch-duplicate-${fixture.suffix}`,
    ordinal: input.records.changes.length + 1
  };
  const duplicateIntent = {
    ...providerIntent,
    id: `outbox-intent:atomic-provider-duplicate-${fixture.suffix}`,
    ordinal: input.records.outboxIntents.length + 1,
    changeIds: [duplicateChange.id],
    consumerDedupeKey: sha256(`${fixture.suffix}:provider-duplicate-dedupe`),
    intentHash: sha256(`${fixture.suffix}:provider-duplicate-intent`)
  };
  return {
    ...input,
    records: {
      ...input.records,
      changes: [...input.records.changes, duplicateChange],
      events: input.records.events.map((event) =>
        event.id === providerIntent.eventId
          ? {
              ...event,
              changeIds: [...event.changeIds, duplicateChange.id]
            }
          : event
      ),
      outboxIntents: [...input.records.outboxIntents, duplicateIntent]
    }
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function comparePostgresCText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

async function loadAtomicOutboundProducerCounts(
  db: HuleeDatabase,
  fixture: OutboundFixture
) {
  const result = await db.execute<Record<string, string>>(sql`
    select
      (select count(*)::text from inbox_v2_auth_command_records
        where tenant_id = ${fixture.tenantId}) as commands,
      (select count(*)::text from inbox_v2_tenant_stream_commits
        where tenant_id = ${fixture.tenantId}) as stream_commits,
      (select count(*)::text from inbox_v2_tenant_stream_heads
        where tenant_id = ${fixture.tenantId}) as stream_heads,
      coalesce((select last_position::text from inbox_v2_tenant_stream_heads
        where tenant_id = ${fixture.tenantId}), '0') as stream_position,
      (select count(*)::text from inbox_v2_tenant_stream_changes
        where tenant_id = ${fixture.tenantId}) as changes,
      (select count(*)::text from inbox_v2_domain_events
        where tenant_id = ${fixture.tenantId}) as events,
      (select count(*)::text from inbox_v2_thread_route_policy_versions
        where tenant_id = ${fixture.tenantId}) as policy_versions,
      (select count(*)::text from inbox_v2_thread_route_policy_heads
        where tenant_id = ${fixture.tenantId}) as policy_heads,
      (select count(*)::text from inbox_v2_outbound_routes
        where tenant_id = ${fixture.tenantId}) as routes,
      (select count(*)::text from inbox_v2_messages
        where tenant_id = ${fixture.tenantId}) as messages,
      (select count(*)::text from inbox_v2_outbound_dispatches
        where tenant_id = ${fixture.tenantId}) as dispatches,
      (select count(*)::text
         from inbox_v2_atomic_outbound_dispatch_materializations
        where tenant_id = ${fixture.tenantId})
        as atomic_dispatch_materializations,
      (select count(*)::text from inbox_v2_outbound_dispatches
        where tenant_id = ${fixture.tenantId} and state = 'queued'
          and attempt_count = 0) as queued_dispatches,
      (select count(*)::text from inbox_v2_outbound_dispatch_attempts
        where tenant_id = ${fixture.tenantId}) as attempts,
      (select count(*)::text from inbox_v2_outbox_intents
        where tenant_id = ${fixture.tenantId}) as outbox_intents,
      (select count(*)::text from inbox_v2_outbox_intents
        where tenant_id = ${fixture.tenantId}
          and effect_class = 'provider_io') as provider_intents,
      (select count(*)::text from inbox_v2_outbox_work_items
        where tenant_id = ${fixture.tenantId}) as outbox_work
  `);
  return result.rows[0]!;
}

async function persistAtomicOutboundProducer(
  db: HuleeDatabase,
  fixture: OutboundFixture
) {
  return createSqlInboxV2AuthorizedCommandCoordinator(
    db
  ).withAuthorizedAtomicMaterialization(
    authorizedExternalSendInput(fixture),
    async (context) => {
      const route = await persistInboxV2RouteResolutionInTransaction(
        context,
        fixture.routeCommit
      );
      if (route.kind !== "committed") {
        throw new Error(`Atomic route preparation failed: ${route.kind}`);
      }
      const prepared = await prepareInboxV2MessageCreation(context, {
        commit: fixture.messageCreationCommit
      });
      if (prepared.kind !== "ready") {
        throw new Error(`Atomic Message preparation failed: ${prepared.kind}`);
      }
      return prepared.capability;
    },
    async (context, capability) => {
      const sealed = await sealInboxV2PreparedMessageCreation(context, {
        capability
      });
      return {
        result: { messageId: sealed.message.id },
        receipt: sealed.receipt
      };
    }
  );
}

async function insertCoherentDuplicateProjectionAndRecheckDomainClosure(
  db: HuleeDatabase,
  input: WithInboxV2AuthorizedCommandMutationInput,
  duplicateProjection: WithInboxV2AuthorizedCommandMutationInput["records"]["outboxIntents"][number]
): Promise<void> {
  const outboxIntents = [...input.records.outboxIntents, duplicateProjection];
  const manifestDigest = computeInboxV2TenantStreamManifestDigest({
    ...input.records,
    outboxIntents
  });
  const projectionIntentCount = outboxIntents.filter(
    ({ effectClass }) => effectClass === "projection"
  ).length;

  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      create temporary table inbox_v2_test_mutation_backup
      on commit drop
      as select *
           from inbox_v2_auth_mutation_commits
          where tenant_id = ${input.tenantId}
            and mutation_id = ${input.records.mutationId}
    `);
    await transaction.execute(sql`
      insert into inbox_v2_outbox_intents (
        tenant_id, id, mutation_id, stream_commit_id, stream_position,
        ordinal, type_id, handler_id, effect_class, event_id, change_ids,
        payload_reference, consumer_dedupe_key, correlation_id, available_at,
        intent_hash, created_at
      )
      select original_intent.tenant_id,
             ${duplicateProjection.id},
             original_intent.mutation_id,
             original_intent.stream_commit_id,
             original_intent.stream_position,
             ${duplicateProjection.ordinal},
             ${duplicateProjection.typeId},
             ${duplicateProjection.handlerId},
             ${duplicateProjection.effectClass},
             ${duplicateProjection.eventId},
             ${JSON.stringify(duplicateProjection.changeIds)}::jsonb,
             ${
               duplicateProjection.payloadReference === null
                 ? null
                 : JSON.stringify(duplicateProjection.payloadReference)
             }::jsonb,
             ${duplicateProjection.consumerDedupeKey},
             ${duplicateProjection.correlationId},
             ${duplicateProjection.availableAt},
             ${duplicateProjection.intentHash},
             original_intent.created_at
        from inbox_v2_outbox_intents original_intent
       where original_intent.tenant_id = ${input.tenantId}
         and original_intent.id = ${input.records.outboxIntents[0]!.id}
    `);
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      update inbox_v2_tenant_stream_commits
         set outbox_intent_count = ${outboxIntents.length},
             outbox_intent_ids = ${JSON.stringify(
               outboxIntents.map(({ id }) => id)
             )}::jsonb,
             manifest_digest_sha256 = ${manifestDigest}
       where tenant_id = ${input.tenantId}
         and id = ${input.records.streamCommitId}
         and mutation_id = ${input.records.mutationId}
    `);
    await transaction.execute(sql`
      delete from inbox_v2_auth_mutation_commits
       where tenant_id = ${input.tenantId}
         and mutation_id = ${input.records.mutationId}
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
    await transaction.execute(sql`
      insert into inbox_v2_auth_mutation_commits (
        tenant_id, mutation_id, command_record_id, stream_commit_id,
        audit_event_id, revision_effect_count,
        revision_effect_digest_sha256, relation_write_count,
        relation_write_digest_sha256, projection_intent_count,
        manifest_digest_sha256, committed_at, created_at
      )
      select tenant_id, mutation_id, command_record_id, stream_commit_id,
             audit_event_id, revision_effect_count,
             revision_effect_digest_sha256, relation_write_count,
             relation_write_digest_sha256, ${projectionIntentCount},
             manifest_digest_sha256, committed_at, created_at
        from inbox_v2_test_mutation_backup
    `);
    await transaction.execute(sql`set constraints all immediate`);
  });
}

async function seedOutboundAnchors(
  db: HuleeDatabase,
  fixture: OutboundFixture
): Promise<void> {
  const refs = fixture.references;
  const adapter = fixture.adapterContract;
  const policy = fixture.routeCommit.input.routePolicy;
  const label = fixture.suffix;
  const threadDeclaration = JSON.stringify({
    adapterContract: adapter,
    identityKind: "external_thread",
    realmId: "module:synthetic:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:group-thread",
    scopeKind: "source_account",
    decisionStrength: "safe_default"
  });

  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${fixture.tenantId}, ${`db003-outbound-${label}`},
        ${`DB003 outbound ${label}`}, 'saas_shared'
      )
    `);
    await transaction.execute(sql`
      insert into employees (id, tenant_id, email, display_name)
      values (
        ${refs.employee.id}, ${fixture.tenantId},
        ${`outbound-${label}@example.test`}, ${`Outbound ${label}`}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_tenant_stream_heads (
        tenant_id, stream_epoch, last_position, min_retained_position,
        revision, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${`stream-epoch:atomic-${label}`}, 1, 0, 1,
        ${OUTBOUND_TEST_TIMES.loadedAt}, ${OUTBOUND_TEST_TIMES.loadedAt}
      )
    `);
    await transaction.execute(sql`
      insert into source_connections (
        id, tenant_id, source_type, source_name, display_name
      ) values (
        ${refs.sourceConnection.id}, ${fixture.tenantId}, 'messenger',
        'synthetic', ${`Connection ${label}`}
      )
    `);
    await transaction.execute(sql`
      insert into source_accounts (
        id, tenant_id, source_connection_id, account_type, display_name
      ) values (
        ${refs.sourceAccount.id}, ${fixture.tenantId},
        ${refs.sourceConnection.id}, 'direct_number', ${`Account ${label}`}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversations (
        tenant_id, id, topology, transport, purpose_id, lifecycle,
        revision, last_changed_stream_position, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${refs.conversation.id}, 'group', 'external',
        'core:chat', 'active', 1, 1, ${OUTBOUND_TEST_TIMES.loadedAt},
        ${OUTBOUND_TEST_TIMES.loadedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_heads (
        tenant_id, conversation_id, latest_timeline_sequence,
        latest_activity_item_id, latest_activity_timeline_sequence,
        latest_activity_at, revision, last_changed_stream_position,
        created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${refs.conversation.id}, 0,
        null, null, null, 1, 1, ${OUTBOUND_TEST_TIMES.loadedAt},
        ${OUTBOUND_TEST_TIMES.loadedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_membership_heads (
        tenant_id, conversation_id, membership_revision, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${refs.conversation.id}, 0,
        ${OUTBOUND_TEST_TIMES.loadedAt}, ${OUTBOUND_TEST_TIMES.loadedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_participants (
        tenant_id, id, conversation_id, subject_kind,
        subject_employee_id, revision, created_at, updated_at
      ) values (
        ${fixture.tenantId},
        ${fixture.messageCreationCommit.authorParticipant.id},
        ${refs.conversation.id}, 'employee', ${refs.employee.id}, 1,
        ${OUTBOUND_TEST_TIMES.loadedAt}, ${OUTBOUND_TEST_TIMES.loadedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_external_threads (
        tenant_id, id, key_registry_id, key_registry_entry_kind,
        realm_id, realm_version, canonicalization_version, scope_kind,
        scope_source_account_id, scope_owner_key, object_kind_id,
        canonical_external_subject, identity_declaration, conversation_id,
        conversation_transport, conversation_topology, revision,
        created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${refs.externalThread.id},
        ${`external_thread_key:outbound-${label}`}, 'canonical',
        'module:synthetic:thread-realm', 'v1', 'v1', 'source_account',
        ${refs.sourceAccount.id}, ${refs.sourceAccount.id},
        'module:synthetic:group-thread', ${`ProviderGroup:${label}`},
        ${threadDeclaration}::jsonb, ${refs.conversation.id}, 'external',
        'group', 1, ${OUTBOUND_TEST_TIMES.loadedAt},
        ${OUTBOUND_TEST_TIMES.loadedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_bindings (
        tenant_id, id, external_thread_id, source_connection_id,
        source_account_id, created_at
      ) values (
        ${fixture.tenantId}, ${refs.binding.id}, ${refs.externalThread.id},
        ${refs.sourceConnection.id}, ${refs.sourceAccount.id},
        ${OUTBOUND_TEST_TIMES.loadedAt}
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
        runtime_diagnostic_code_id, runtime_diagnostic_retryable,
        runtime_diagnostic_correlation_token,
        runtime_diagnostic_safe_operator_hint_id,
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
        ${fixture.tenantId}, ${refs.binding.id}, ${refs.externalThread.id},
        ${refs.sourceConnection.id}, ${refs.sourceAccount.id}, 1, 1, 'verified',
        ${"a".repeat(64)}, 'core:source-runtime',
        ${OUTBOUND_TEST_TIMES.loadedAt},
        ${`source_thread_binding_evidence_set:account-${label}`}, 1,
        ${`source_thread_binding_remote_access_episode:${label}`}, 1,
        'active', 'direct_observation', 1, ${OUTBOUND_TEST_TIMES.loadedAt},
        ${`source_thread_binding_evidence_set:remote-${label}`},
        'enabled', 1, ${OUTBOUND_TEST_TIMES.loadedAt},
        ${fixture.route.runtimeObservationAtResolution.state},
        ${BigInt(fixture.route.runtimeObservationAtResolution.revision)},
        ${fixture.route.runtimeObservationAtResolution.observedAt},
        ${fixture.route.runtimeObservationAtResolution.diagnostic?.codeId ?? null},
        ${fixture.route.runtimeObservationAtResolution.diagnostic?.retryable ?? null},
        ${fixture.route.runtimeObservationAtResolution.diagnostic?.correlationToken ?? null},
        ${fixture.route.runtimeObservationAtResolution.diagnostic?.safeOperatorHintId ?? null},
        'unsupported', 1,
        ${OUTBOUND_TEST_TIMES.loadedAt}, 1, 0, ${"0".repeat(64)},
        ${`source_thread_binding_evidence_set:provider-${label}`},
        ${OUTBOUND_TEST_TIMES.loadedAt}, ${adapter.contractId},
        ${adapter.contractVersion}, 1, ${adapter.surfaceId},
        ${adapter.loadedByTrustedServiceId}, ${adapter.loadedAt}, 1, 0,
        ${"1".repeat(64)}, ${OUTBOUND_TEST_TIMES.loadedAt},
        ${adapter.contractId}, ${adapter.contractVersion}, 1,
        ${adapter.surfaceId}, ${adapter.loadedByTrustedServiceId},
        ${adapter.loadedAt}, 'module:synthetic:group-route', 'v1', 1,
        'module:synthetic:group-peer', ${`Group-${label}`},
        ${"a".repeat(64)}, 0, ${"3".repeat(64)}, 1,
        ${OUTBOUND_TEST_TIMES.loadedAt}, ${OUTBOUND_TEST_TIMES.loadedAt}
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
        and head_row.binding_id = ${refs.binding.id}
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_binding_capability_entries (
        tenant_id, binding_id, capability_revision,
        materialized_by_binding_revision, ordinal, capability_id,
        operation_id, content_kind_id, state, reference_portability,
        valid_until, required_provider_role_count, evidence_set_id
      ) values (
        ${fixture.tenantId}, ${refs.binding.id}, 1, 1, 0,
        'core:message-text-send', ${fixture.route.operationId},
        ${fixture.route.contentKindId}, 'supported', 'external_thread',
        null, 0, ${`source_thread_binding_evidence_set:capability-${label}`}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_thread_route_policy_versions (
        tenant_id, policy_id, revision, conversation_id, external_thread_id,
        external_thread_revision, operation_id, content_kind_id,
        route_policy_catalog_id, required_conversation_permission_id,
        preferred_binding_id, preferred_source_connection_id,
        preferred_source_account_id, fallback_kind, fallback_binding_count,
        fallback_bindings_digest_sha256, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${policy.id}, ${BigInt(policy.revision)},
        ${policy.conversation.id}, ${policy.externalThread.id}, 1,
        ${policy.operationId}, ${policy.contentKindId}, ${policy.policyId},
        ${policy.requiredConversationPermissionId}, null, null, null,
        'none', 0, null, ${policy.createdAt}, ${policy.updatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_thread_route_policy_heads (
        tenant_id, policy_id, conversation_id, external_thread_id,
        operation_id, content_kind_id, revision, updated_at
      ) values (
        ${fixture.tenantId}, ${policy.id}, ${policy.conversation.id},
        ${policy.externalThread.id}, ${policy.operationId},
        ${policy.contentKindId}, ${BigInt(policy.revision)}, ${policy.updatedAt}
      )
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

async function seedExistingOutboundRoute(
  db: HuleeDatabase,
  fixture: OutboundFixture
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    const inserted = await transaction.execute(
      buildInsertInboxV2OutboundRouteSql(fixture.route, {
        binding_id: fixture.references.binding.id,
        external_thread_id: fixture.references.externalThread.id,
        source_connection_id: fixture.references.sourceConnection.id,
        source_account_id: fixture.references.sourceAccount.id,
        binding_revision: "1",
        account_generation: fixture.route.bindingFence.accountGeneration,
        binding_generation: fixture.route.bindingFence.bindingGeneration,
        remote_access_revision: fixture.route.bindingFence.remoteAccessRevision,
        administrative_revision:
          fixture.route.bindingFence.administrativeRevision,
        capability_revision: fixture.route.bindingFence.capabilityRevision,
        route_descriptor_revision:
          fixture.route.bindingFence.routeDescriptorRevision,
        remote_access_state: "active",
        administrative_state: "enabled",
        runtime_health_state: "ready"
      })
    );
    if (inserted.rows.length !== 1) {
      throw new Error("Expected one pre-existing outbound route fixture.");
    }
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

async function seedReplacementBinding(
  db: HuleeDatabase,
  fixture: OutboundFixture,
  replacement: ReturnType<
    typeof explicitRerouteIntegrationFixture
  >["replacement"]
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      update inbox_v2_external_threads
         set scope_kind = 'provider',
             scope_source_account_id = null,
             scope_owner_key = 'provider',
             identity_declaration = jsonb_set(
               jsonb_set(
                 identity_declaration,
                 '{scopeKind}',
                 '"provider"'::jsonb
               ),
               '{decisionStrength}',
               '"authoritative"'::jsonb
             )
       where tenant_id = ${fixture.tenantId}
         and id = ${fixture.references.externalThread.id}
    `);
    await transaction.execute(sql`
      insert into source_connections (
        id, tenant_id, source_type, source_name, display_name
      ) values (
        ${replacement.sourceConnection.id}, ${fixture.tenantId},
        'messenger', 'synthetic',
        ${`Reroute connection ${fixture.suffix}`}
      )
    `);
    await transaction.execute(sql`
      insert into source_accounts (
        id, tenant_id, source_connection_id, account_type, display_name
      ) values (
        ${replacement.sourceAccount.id}, ${fixture.tenantId},
        ${replacement.sourceConnection.id}, 'direct_number',
        ${`Reroute account ${fixture.suffix}`}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_bindings (
        tenant_id, id, external_thread_id, source_connection_id,
        source_account_id, created_at
      ) values (
        ${fixture.tenantId}, ${replacement.binding.id},
        ${fixture.references.externalThread.id},
        ${replacement.sourceConnection.id}, ${replacement.sourceAccount.id},
        ${OUTBOUND_TEST_TIMES.loadedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_binding_heads
      select (jsonb_populate_record(
        null::inbox_v2_source_thread_binding_heads,
        to_jsonb(head_row) || jsonb_build_object(
          'binding_id', ${replacement.binding.id}::text,
          'source_connection_id', ${replacement.sourceConnection.id}::text,
          'source_account_id', ${replacement.sourceAccount.id}::text,
          'account_verification_evidence_set_id',
            ${`source_thread_binding_evidence_set:reroute-account-${fixture.suffix}`}::text,
          'current_remote_access_episode_id',
            ${`source_thread_binding_remote_access_episode:reroute-${fixture.suffix}`}::text,
          'remote_access_evidence_set_id',
            ${`source_thread_binding_evidence_set:reroute-remote-${fixture.suffix}`}::text,
          'provider_access_evidence_set_id',
            ${`source_thread_binding_evidence_set:reroute-provider-${fixture.suffix}`}::text
        )
      )).*
        from inbox_v2_source_thread_binding_heads head_row
       where head_row.tenant_id = ${fixture.tenantId}
         and head_row.binding_id = ${fixture.references.binding.id}
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
         and head_row.binding_id = ${replacement.binding.id}
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_binding_capability_entries (
        tenant_id, binding_id, capability_revision,
        materialized_by_binding_revision, ordinal, capability_id,
        operation_id, content_kind_id, state, reference_portability,
        valid_until, required_provider_role_count, evidence_set_id
      )
      select tenant_id, ${replacement.binding.id}, capability_revision,
             materialized_by_binding_revision, ordinal, capability_id,
             operation_id, content_kind_id, state, reference_portability,
             valid_until, required_provider_role_count,
             ${`source_thread_binding_evidence_set:reroute-capability-${fixture.suffix}`}
        from inbox_v2_source_thread_binding_capability_entries
       where tenant_id = ${fixture.tenantId}
         and binding_id = ${fixture.references.binding.id}
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

function holdBindingAdminDisable(
  db: HuleeDatabase,
  fixture: OutboundFixture,
  bindingId: string
): Readonly<{
  ready: Promise<void>;
  release(): void;
  completed: Promise<void>;
}> {
  let markReady!: () => void;
  let failReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completed = db
    .transaction(async (transaction) => {
      await transaction.execute(
        sql`set local session_replication_role = replica`
      );
      await transaction.execute(sql`
        update inbox_v2_source_thread_binding_heads
           set administrative_state = 'disabled',
               administrative_revision = 2,
               revision = 2,
               updated_at = ${OUTBOUND_TEST_TIMES.openedAt}
         where tenant_id = ${fixture.tenantId}
           and binding_id = ${bindingId}
      `);
      markReady();
      await gate;
      await transaction.execute(
        sql`set local session_replication_role = origin`
      );
    })
    .catch((error: unknown) => {
      failReady(error);
      throw error;
    });
  return { ready, release, completed };
}

async function seedAssociationOccurrences(
  db: HuleeDatabase,
  fixture: OutboundFixture
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    for (const commit of [
      fixture.echoAssociation,
      fixture.responseAssociation
    ]) {
      await seedProviderObservation(transaction, fixture, commit);
    }
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

async function seedProviderObservation(
  executor: { execute(query: SQL): Promise<unknown> },
  fixture: OutboundFixture,
  commit: InboxV2OutboundDispatchArtifactAssociationCommit
): Promise<void> {
  const occurrence = commit.occurrenceResolution.before;
  const origin = occurrence.origin;
  if (occurrence.resolution.state !== "pending") {
    throw new Error("Association seed requires a pending source occurrence.");
  }
  const resolutionDiagnostic = occurrence.resolution.diagnostic;
  if (origin.kind === "provider_echo") {
    await executor.execute(sql`
      insert into raw_inbound_events (
        id, tenant_id, source_connection_id, source_account_id,
        idempotency_key, received_at, payload, headers,
        processing_status, created_at, updated_at
      ) values (
        ${origin.rawInboundEvent.id}, ${fixture.tenantId},
        ${fixture.references.sourceConnection.id},
        ${fixture.references.sourceAccount.id},
        ${`raw:${fixture.suffix}:echo`}, ${occurrence.recordedAt},
        '{}'::jsonb, '{}'::jsonb, 'processed', ${occurrence.recordedAt},
        ${occurrence.recordedAt}
      )
    `);
    await executor.execute(sql`
      insert into normalized_inbound_events (
        id, tenant_id, raw_event_id, source_connection_id, source_account_id,
        source_type, source_name, event_type, direction, visibility,
        payload_version, normalized_payload, reply_capability,
        idempotency_key, processing_status, created_at, updated_at
      ) values (
        ${origin.normalizedInboundEvent.id}, ${fixture.tenantId},
        ${origin.rawInboundEvent.id}, ${fixture.references.sourceConnection.id},
        ${fixture.references.sourceAccount.id}, 'messenger', 'synthetic',
        'message', 'outbound', 'private', 'v1', '{}'::jsonb, '{}'::jsonb,
        ${`normalized:${fixture.suffix}:echo`}, 'processed',
        ${occurrence.recordedAt}, ${occurrence.recordedAt}
      )
    `);
  }

  const messageKey = occurrence.messageKey;
  const adapter = occurrence.descriptor.adapterContract;
  const scopeAccountId =
    messageKey.scope.kind === "source_account"
      ? messageKey.scope.owner.id
      : null;
  const scopeBindingId =
    messageKey.scope.kind === "source_thread_binding"
      ? messageKey.scope.owner.id
      : null;
  await executor.execute(sql`
    insert into inbox_v2_source_occurrences (
      tenant_id, id, conversation_id, external_thread_id,
      external_thread_revision, source_connection_id, source_account_id,
      source_thread_binding_id, binding_revision, binding_generation,
      account_identity_revision, account_generation,
      account_canonical_key_digest_sha256, message_realm_id,
      message_realm_version, message_canonicalization_version,
      message_scope_kind, message_scope_source_account_id,
      message_scope_source_thread_binding_id, message_object_kind_id,
      canonical_external_subject, adapter_contract_id,
      adapter_contract_version, adapter_declaration_revision,
      adapter_surface_id, adapter_loaded_by_trusted_service_id,
      adapter_loaded_at, message_decision_strength, origin_kind,
      raw_inbound_event_id, normalized_inbound_event_id,
      outbound_dispatch_attempt_id, provider_actor_kind,
      provider_actor_source_external_identity_id,
      provider_system_actor_kind_id, provider_system_actor_subject,
      direction, descriptor_schema_id, descriptor_version,
      capability_revision, provider_reference_count,
      descriptor_digest_sha256, provider_timestamp_count,
      reference_portability_kind, reference_portability_decision_strength,
      resolution_state, resolved_external_message_reference_id,
      resolution_candidate_count, resolution_candidate_digest_sha256,
      resolution_diagnostic_code_id, resolution_diagnostic_retryable,
      resolution_diagnostic_correlation_token,
      resolution_diagnostic_safe_operator_hint_id,
      materialized_by_trusted_service_id, materialization_authorization_token,
      observed_at, recorded_at, revision, created_at, updated_at
    ) values (
      ${fixture.tenantId}, ${occurrence.id},
      ${fixture.references.conversation.id},
      ${fixture.references.externalThread.id}, 1,
      ${fixture.references.sourceConnection.id},
      ${fixture.references.sourceAccount.id}, ${fixture.references.binding.id},
      1, 1, 1, 1, ${"a".repeat(64)}, ${messageKey.realm.realmId},
      ${messageKey.realm.realmVersion},
      ${messageKey.realm.canonicalizationVersion}, ${messageKey.scope.kind},
      ${scopeAccountId}, ${scopeBindingId}, ${messageKey.objectKindId},
      ${messageKey.canonicalExternalSubject}, ${adapter.contractId},
      ${adapter.contractVersion}, ${adapter.declarationRevision},
      ${adapter.surfaceId}, ${adapter.loadedByTrustedServiceId},
      ${adapter.loadedAt}, ${occurrence.messageIdentityDeclaration.decisionStrength},
      ${origin.kind},
      ${origin.kind === "provider_echo" ? origin.rawInboundEvent.id : null},
      ${origin.kind === "provider_echo" ? origin.normalizedInboundEvent.id : null},
      ${
        origin.kind === "provider_response"
          ? origin.outboundDispatchAttempt.id
          : null
      }, null, null, null, null, 'outbound',
      ${occurrence.descriptor.descriptorSchemaId},
      ${occurrence.descriptor.descriptorVersion},
      ${occurrence.descriptor.capabilityRevision},
      ${occurrence.descriptor.providerReferences.length},
      ${occurrence.descriptor.descriptorDigestSha256},
      ${occurrence.providerTimestamps.length},
      ${occurrence.referencePortability.kind},
      ${occurrence.referencePortability.decisionStrength}, 'pending', null,
      0, null, ${resolutionDiagnostic.codeId},
      ${resolutionDiagnostic.retryable},
      ${resolutionDiagnostic.correlationToken},
      ${resolutionDiagnostic.safeOperatorHintId},
      ${adapter.loadedByTrustedServiceId},
      ${`materialization:${fixture.suffix}:${origin.kind}`},
      ${occurrence.observedAt}, ${occurrence.recordedAt}, 1,
      ${occurrence.createdAt}, ${occurrence.updatedAt}
    )
  `);
  for (const [
    ordinal,
    providerReference
  ] of occurrence.descriptor.providerReferences.entries()) {
    await executor.execute(sql`
      insert into inbox_v2_source_occurrence_provider_references (
        tenant_id, source_occurrence_id, ordinal, kind_id, subject
      ) values (
        ${fixture.tenantId}, ${occurrence.id}, ${ordinal},
        ${providerReference.kindId}, ${providerReference.subject}
      )
    `);
  }
  for (const [
    ordinal,
    providerTimestamp
  ] of occurrence.providerTimestamps.entries()) {
    await executor.execute(sql`
      insert into inbox_v2_source_occurrence_provider_timestamps (
        tenant_id, source_occurrence_id, ordinal, kind_id, timestamp
      ) values (
        ${fixture.tenantId}, ${occurrence.id}, ${ordinal},
        ${providerTimestamp.kindId}, ${providerTimestamp.timestamp}
      )
    `);
  }
}

async function expectDatabaseFailure(
  promise: Promise<unknown>,
  pattern: RegExp
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected PostgreSQL to reject the forged write.");
  } catch (error) {
    const diagnostics: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
      const record =
        typeof current === "object" && current !== null
          ? (current as Record<string, unknown>)
          : {};
      diagnostics.push(
        `${String(record.code ?? "")} ${String(record.message ?? current)}`
      );
      current = record.cause;
    }
    expect(diagnostics.join("\ncaused by: ")).toMatch(pattern);
  }
}
