import {
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  inboxV2EntityRevisionSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2NamespacedIdSchema,
  inboxV2OutboundDispatchArtifactAssociationCommitSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchReconciliationCommitSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundRouteResolutionCommitSchema,
  inboxV2OutboundRouteResolutionInputSchema,
  inboxV2OutboundRouteSchema,
  inboxV2OutboxIntentIdSchema,
  inboxV2Sha256DigestSchema,
  inboxV2ThreadRoutePolicySchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentSchema,
  resolveInboxV2OutboundRoute,
  type InboxV2OutboundDispatchArtifactAssociationCommit
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  persistInboxV2RouteResolutionInTransaction
} from "./sql-inbox-v2-outbound-transport-repository";
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

function fixtureFor(label: string): OutboundFixture {
  const suffix = `${label}-${runId}`;
  return canonicalOutboundFixture(
    createOutboundTransportContractFixture({
      tenantId: `tenant:db003-outbound-${suffix}`,
      suffix
    })
  );
}

function canonicalOutboundFixture(fixture: RawOutboundFixture) {
  const operationId = "core:message.send" as const;
  const requiredPermissionId = "core:message.send_external" as const;
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
  const canonicalCandidate = {
    ...candidate,
    operationId,
    conversationAuthorization,
    sourceAccountAuthorization
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

function canonicalMessageCreationCommit(
  fixture: RawOutboundFixture,
  route: ReturnType<typeof inboxV2OutboundRouteSchema.parse>
) {
  const { references: refs, tenantId } = fixture;
  const createdAt = OUTBOUND_TEST_TIMES.loadedAt;
  const committedAt = OUTBOUND_TEST_TIMES.selectedAt;
  const conversation = {
    tenantId,
    id: refs.conversation.id,
    topology: "group" as const,
    transport: "external" as const,
    purposeId: "core:chat",
    lifecycle: "active" as const,
    head: {
      latestTimelineSequence: "0",
      latestActivityItemId: null,
      latestActivityTimelineSequence: null,
      latestActivityAt: null,
      revision: "1",
      createdAt,
      updatedAt: createdAt
    },
    revision: "1",
    createdAt,
    updatedAt: createdAt
  };
  const participant = {
    tenantId,
    id: `conversation_participant:outbound-${fixture.suffix}`,
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
    timelineSequence: "1",
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
      checkedAt: createdAt
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
          latestTimelineSequence: "1",
          latestActivityItemId: timelineItem.id,
          latestActivityTimelineSequence: "1",
          latestActivityAt: timelineItem.occurredAt,
          revision: "2",
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
        'enabled', 1, ${OUTBOUND_TEST_TIMES.loadedAt}, 'ready', 1,
        ${OUTBOUND_TEST_TIMES.loadedAt}, 'unsupported', 1,
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
