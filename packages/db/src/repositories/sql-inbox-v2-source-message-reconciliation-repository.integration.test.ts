import { createHash } from "node:crypto";

import {
  inboxV2CatalogIdSchema,
  inboxV2DeferredMessageSourceActionCommitSchema,
  inboxV2DeferredMessageSourceActionSchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2MessageTransportOccurrenceLinkSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema,
  type InboxV2DeferredMessageSourceAction,
  type InboxV2ExternalMessageReference,
  type InboxV2MessageTransportOccurrenceLink,
  type InboxV2SourceMessageReconciliationPlan,
  type InboxV2SourceOccurrenceResolutionCommit
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createInboxV2TrustedSourceMessageReconciliationMaterializer,
  type InboxV2SourceMessageNamespaceDeriver
} from "../../../../apps/worker/src/source-message-reconciliation-materializer";
import {
  makeMessageReconciliationDescriptor,
  makeResolvedReconciliationContext
} from "../../../../apps/worker/src/source-message-reconciliation.test-support";
import { createInboxV2SourceMessageReconciliationPlanVerifier } from "../../../../apps/worker/src/source-message-reconciliation-plan-verifier";
import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  buildInsertInboxV2ExternalMessageReferenceSql,
  buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql,
  buildInsertInboxV2SourceOccurrenceResolutionTransitionSql,
  computeInboxV2ExternalMessageKeyDigest,
  findInboxV2ExternalMessageReferenceCandidatesInTransaction
} from "./sql-inbox-v2-outbound-transport-repository";
import { readInboxV2SourceOccurrenceInTransaction } from "./sql-inbox-v2-source-occurrence-repository";
import {
  buildAcquireInboxV2SourceMessageKeyLockSql,
  commitInboxV2DeferredMessageSourceActionInTransaction,
  createSqlInboxV2SourceMessageReconciliationRepository,
  persistInboxV2DeferredMessageSourceActionInTransaction,
  readInboxV2DeferredMessageSourceActionInTransaction,
  registerInboxV2SourceMessageKeyInTransaction,
  type InboxV2DeferredMessageSourceActionCommit,
  type InboxV2SourceMessageReconciliationCallbacks
} from "./sql-inbox-v2-source-message-reconciliation-repository";
import {
  deferredNormalizedEvent,
  makeAppliedReceiptCommit,
  makePendingDeferredAction,
  makeTerminalDeferredCommit,
  scopeDeferredFixture
} from "./sql-inbox-v2-source-message-reconciliation-repository.test-support";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const reconciliationNamespaceDeriver: InboxV2SourceMessageNamespaceDeriver = {
  namespaceGeneration: "namespace-generation-v1",
  deriveNamespaceHmacSha256(input) {
    return createHash("sha256")
      .update(`${input.purpose}\0${input.canonicalPreimage}`, "utf8")
      .digest("hex");
  }
};
const reconciliationMaterializer =
  createInboxV2TrustedSourceMessageReconciliationMaterializer({
    trustedServiceId: "core:source-runtime",
    namespaceDeriver: reconciliationNamespaceDeriver,
    clock: { now: () => "2026-07-17T08:05:00.000Z" }
  });

describePostgres(
  "SQL Inbox V2 source-message reconciliation repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    const tenantIds: string[] = [];

    beforeAll(async () => {
      db = createHuleeDatabase({ poolConfig: { max: 8 } });
      const readiness = await db.execute<{
        actions: string | null;
        transitions: string | null;
        heads: string | null;
        action_guard: string | null;
      }>(sql`
        select
          to_regclass(
            'public.inbox_v2_deferred_message_source_actions'
          )::text as actions,
          to_regclass(
            'public.inbox_v2_deferred_message_source_action_transitions'
          )::text as transitions,
          to_regclass(
            'public.inbox_v2_deferred_source_action_ordering_heads'
          )::text as heads,
          to_regprocedure(
            'public.inbox_v2_deferred_source_action_assert()'
          )::text as action_guard
      `);
      expect(readiness.rows[0]).toEqual({
        actions: "inbox_v2_deferred_message_source_actions",
        transitions: "inbox_v2_deferred_message_source_action_transitions",
        heads: "inbox_v2_deferred_source_action_ordering_heads",
        action_guard: "inbox_v2_deferred_source_action_assert()"
      });
    });

    afterAll(async () => {
      if (!db) return;
      for (const tenantId of tenantIds.reverse()) {
        await purgeSyntheticTenant(db, tenantId);
      }
      await closeHuleeDatabase(db);
    });

    it("serializes cross-account provider-thread creation into one immutable reference and message", async () => {
      const suffix = `canonical-${runId}`;
      const first = makeReconciliationPlan({
        accountSuffix: "a",
        subject: "Provider-Thread-Message-42",
        scopeKind: "provider_thread",
        suffix
      });
      const second = makeReconciliationPlan({
        accountSuffix: "b",
        subject: "Provider-Thread-Message-42",
        scopeKind: "provider_thread",
        suffix
      });
      expect(second.candidateExternalMessageReferenceId).toBe(
        first.candidateExternalMessageReferenceId
      );
      if (
        first.intent.kind !== "message_create" ||
        second.intent.kind !== "message_create"
      ) {
        throw new Error("Expected create plans.");
      }
      expect(second.intent.candidateMessageId).toBe(
        first.intent.candidateMessageId
      );
      tenantIds.push(first.sourceOccurrence.tenantId);
      await seedReconciliationPlanAnchors(db, [first, second], suffix);
      const repository = createPostgresReconciliationRepository(db);

      const results = await Promise.all([
        repository.reconcile({ plan: first }),
        repository.reconcile({ plan: second })
      ]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "message_created",
        "occurrence_attached"
      ]);
      const counts = await db.execute<{
        reference_count: string;
        message_count: string;
        resolved_occurrence_count: string;
        transport_link_count: string;
        transport_head_revision: string;
      }>(sql`
        select
          (
            select count(*)::text
            from inbox_v2_external_message_references
            where tenant_id = ${first.sourceOccurrence.tenantId}
          ) as reference_count,
          (
            select count(*)::text
            from inbox_v2_messages
            where tenant_id = ${first.sourceOccurrence.tenantId}
          ) as message_count,
          (
            select count(*)::text
            from inbox_v2_source_occurrences
            where tenant_id = ${first.sourceOccurrence.tenantId}
              and resolution_state = 'resolved'
              and resolved_external_message_reference_id =
                ${first.candidateExternalMessageReferenceId}
          ) as resolved_occurrence_count,
          (
            select count(*)::text
            from inbox_v2_message_transport_links
            where tenant_id = ${first.sourceOccurrence.tenantId}
              and message_id = ${first.intent.candidateMessageId}
          ) as transport_link_count,
          (
            select revision::text
            from inbox_v2_message_transport_link_heads
            where tenant_id = ${first.sourceOccurrence.tenantId}
              and message_id = ${first.intent.candidateMessageId}
          ) as transport_head_revision
      `);
      expect(counts.rows[0]).toEqual({
        reference_count: "1",
        message_count: "1",
        resolved_occurrence_count: "2",
        transport_link_count: "2",
        transport_head_revision: "2"
      });
    });

    it("rolls back reference and resolution when a callback omits the exact transport link", async () => {
      const suffix = `missing-link-${runId}`;
      const plan = makeReconciliationPlan({
        accountSuffix: "missing-link",
        subject: "Missing-Transport-Link",
        scopeKind: "provider_thread",
        suffix
      });
      tenantIds.push(plan.sourceOccurrence.tenantId);
      await seedReconciliationPlanAnchors(db, [plan], suffix);

      await expect(
        createPostgresReconciliationRepository(db, {
          transportLinkMode: "missing"
        }).reconcile({ plan })
      ).resolves.toMatchObject({
        kind: "conflict",
        code: "source.message_reconciliation.callback_conflict"
      });
      const persisted = await db.execute<{
        reference_count: string;
        link_count: string;
        resolution_state: string;
        revision: string;
      }>(sql`
        select
          (
            select count(*)::text
            from inbox_v2_external_message_references
            where tenant_id = ${plan.sourceOccurrence.tenantId}
          ) as reference_count,
          (
            select count(*)::text
            from inbox_v2_message_transport_links
            where tenant_id = ${plan.sourceOccurrence.tenantId}
          ) as link_count,
          resolution_state::text, revision::text
        from inbox_v2_source_occurrences
        where tenant_id = ${plan.sourceOccurrence.tenantId}
          and id = ${plan.sourceOccurrence.id}
      `);
      expect(persisted.rows[0]).toEqual({
        reference_count: "0",
        link_count: "0",
        resolution_state: "pending",
        revision: "1"
      });
    });

    it("rolls back a reused occurrence when its callback persists a tampered transport link", async () => {
      const suffix = `tampered-link-${runId}`;
      const first = makeReconciliationPlan({
        accountSuffix: "tampered-first",
        subject: "Tampered-Transport-Link",
        scopeKind: "provider_thread",
        suffix
      });
      const second = makeReconciliationPlan({
        accountSuffix: "tampered-second",
        subject: "Tampered-Transport-Link",
        scopeKind: "provider_thread",
        suffix
      });
      tenantIds.push(first.sourceOccurrence.tenantId);
      await seedReconciliationPlanAnchors(db, [first, second], suffix);
      await expect(
        createPostgresReconciliationRepository(db).reconcile({ plan: first })
      ).resolves.toMatchObject({ kind: "message_created" });

      await expect(
        createPostgresReconciliationRepository(db, {
          transportLinkMode: "tampered"
        }).reconcile({ plan: second })
      ).resolves.toMatchObject({
        kind: "conflict",
        code: "source.message_reconciliation.callback_conflict"
      });
      const persisted = await db.execute<{
        link_count: string;
        head_revision: string;
        resolution_state: string;
        revision: string;
      }>(sql`
        select
          (
            select count(*)::text
            from inbox_v2_message_transport_links
            where tenant_id = ${second.sourceOccurrence.tenantId}
          ) as link_count,
          (
            select revision::text
            from inbox_v2_message_transport_link_heads
            where tenant_id = ${second.sourceOccurrence.tenantId}
              and message_id = ${
                first.intent.kind === "message_create"
                  ? first.intent.candidateMessageId
                  : "message:unreachable"
              }
          ) as head_revision,
          resolution_state::text, revision::text
        from inbox_v2_source_occurrences
        where tenant_id = ${second.sourceOccurrence.tenantId}
          and id = ${second.sourceOccurrence.id}
      `);
      expect(persisted.rows[0]).toEqual({
        link_count: "1",
        head_revision: "1",
        resolution_state: "pending",
        revision: "1"
      });
    });

    it("replays only the exact signed terminal source action without another callback or durable write", async () => {
      const suffix = `terminal-action-replay-${runId}`;
      const fixture = {
        accountSuffix: "terminal-action",
        subject: "Terminal-Action-Replay",
        scopeKind: "provider_thread" as const,
        suffix
      };
      const exactPlan = makeSourceActionReconciliationPlan(fixture);
      const changedPlan = makeSourceActionReconciliationPlan({
        ...fixture,
        normalizedContentDigestSha256: "f".repeat(64)
      });
      if (
        exactPlan.intent.kind !== "source_action" ||
        changedPlan.intent.kind !== "source_action"
      ) {
        throw new Error("Expected source-action plans.");
      }
      const exactAction = exactPlan.intent.deferredAction;
      const exactActionId = exactPlan.intent.candidateDeferredActionId;
      expect(changedPlan.sourceOccurrence).toEqual(exactPlan.sourceOccurrence);
      expect(changedPlan.intent.candidateDeferredActionId).toBe(exactActionId);
      expect(changedPlan.materializationToken).not.toBe(
        exactPlan.materializationToken
      );

      tenantIds.push(exactPlan.sourceOccurrence.tenantId);
      await seedReconciliationPlanAnchors(db, [exactPlan], suffix);
      const target = candidateReferenceForPlan(exactPlan);
      const terminalCommit = makeExpiredReconciliationActionCommit(
        exactAction,
        exactPlan.materializedAt
      );
      await db.transaction(async (transaction) => {
        const executor = rawExecutor(transaction);
        await expect(
          registerInboxV2SourceMessageKeyInTransaction(executor, {
            tenantId: exactPlan.sourceOccurrence.tenantId,
            keyDigest: computeInboxV2ExternalMessageKeyDigest(
              exactPlan.messageKey
            ),
            externalMessageKey: exactPlan.messageKey
          })
        ).resolves.toMatch(/registered|already_exists/u);
        await withHistoricalReconciliationFixture(executor, async () => {
          const referenceInsert = await executor.execute(
            buildInsertInboxV2ExternalMessageReferenceSql(target)
          );
          expect(referenceInsert.rows).toHaveLength(1);
          await expect(
            persistInboxV2DeferredMessageSourceActionInTransaction(
              executor,
              exactAction
            )
          ).resolves.toMatchObject({ kind: "created" });
          await expect(
            commitInboxV2DeferredMessageSourceActionInTransaction(
              executor,
              terminalCommit
            )
          ).resolves.toMatchObject({
            kind: "committed",
            action: { state: { state: "expired" } }
          });
          await expect(
            resolveReconciliationOccurrence(
              executor,
              exactPlan,
              target,
              "origin",
              "missing"
            )
          ).resolves.toMatchObject({ kind: "committed" });
        });
      });

      let applyCalls = 0;
      const repository = createPostgresReconciliationRepository(db, {
        onApplySourceAction: () => {
          applyCalls += 1;
        }
      });
      await expect(
        repository.reconcile({ plan: exactPlan })
      ).resolves.toMatchObject({
        kind: "source_action_processed",
        deferredAction: {
          id: exactActionId,
          state: { state: "expired" }
        },
        sourceOccurrence: { resolution: { state: "resolved" } }
      });
      await expect(
        repository.reconcile({ plan: changedPlan })
      ).resolves.toMatchObject({
        kind: "conflict",
        code: "source.message_reconciliation.deferred_action_conflict"
      });
      expect(applyCalls).toBe(0);

      const persisted = await db.execute<{
        action_count: string;
        transition_count: string;
        action_state: string;
        occurrence_revision: string;
        resolution_state: string;
      }>(sql`
        select
          (
            select count(*)::text
            from inbox_v2_deferred_message_source_actions
            where tenant_id = ${exactPlan.sourceOccurrence.tenantId}
          ) as action_count,
          (
            select count(*)::text
            from inbox_v2_deferred_message_source_action_transitions
            where tenant_id = ${exactPlan.sourceOccurrence.tenantId}
          ) as transition_count,
          (
            select state::text
            from inbox_v2_deferred_message_source_actions
            where tenant_id = ${exactPlan.sourceOccurrence.tenantId}
              and id = ${exactActionId}
          ) as action_state,
          revision::text as occurrence_revision,
          resolution_state::text
        from inbox_v2_source_occurrences
        where tenant_id = ${exactPlan.sourceOccurrence.tenantId}
          and id = ${exactPlan.sourceOccurrence.id}
      `);
      expect(persisted.rows[0]).toEqual({
        action_count: "1",
        transition_count: "1",
        action_state: "expired",
        occurrence_revision: "2",
        resolution_state: "resolved"
      });
    });

    it("separates account/binding scopes and preserves case-distinct provider subjects", async () => {
      const suffix = `scope-${runId}`;
      const plans = [
        makeReconciliationPlan({
          accountSuffix: "scope-account-a",
          subject: "Same-Provider-Subject",
          scopeKind: "source_account",
          suffix
        }),
        makeReconciliationPlan({
          accountSuffix: "scope-account-b",
          subject: "Same-Provider-Subject",
          scopeKind: "source_account",
          suffix
        }),
        makeReconciliationPlan({
          accountSuffix: "scope-binding-a",
          subject: "Same-Provider-Subject",
          scopeKind: "source_thread_binding",
          suffix
        }),
        makeReconciliationPlan({
          accountSuffix: "scope-binding-b",
          subject: "Same-Provider-Subject",
          scopeKind: "source_thread_binding",
          suffix
        }),
        makeReconciliationPlan({
          accountSuffix: "case-upper",
          subject: "Case-Sensitive-Provider-ID",
          scopeKind: "provider_thread",
          suffix
        }),
        makeReconciliationPlan({
          accountSuffix: "case-lower",
          subject: "case-sensitive-provider-id",
          scopeKind: "provider_thread",
          suffix
        })
      ];
      expect(
        new Set(plans.map((plan) => plan.candidateExternalMessageReferenceId))
          .size
      ).toBe(plans.length);
      tenantIds.push(plans[0]!.sourceOccurrence.tenantId);
      await seedReconciliationPlanAnchors(db, plans, suffix);
      const repository = createPostgresReconciliationRepository(db);

      const results = await Promise.all(
        plans.map((plan) => repository.reconcile({ plan }))
      );
      expect(results.map((result) => result.kind)).toEqual(
        plans.map(() => "message_created")
      );
      const persisted = await db.execute<{
        scope_kind: string;
        canonical_external_subject: string;
      }>(sql`
        select scope_kind, canonical_external_subject
        from inbox_v2_external_message_references
        where tenant_id = ${plans[0]!.sourceOccurrence.tenantId}
        order by scope_kind, canonical_external_subject,
                 message_key_digest_sha256
      `);
      expect(persisted.rows).toHaveLength(plans.length);
      expect(
        persisted.rows.filter((row) => row.scope_kind === "source_account")
      ).toHaveLength(2);
      expect(
        persisted.rows.filter(
          (row) => row.scope_kind === "source_thread_binding"
        )
      ).toHaveLength(2);
      expect(
        persisted.rows
          .filter((row) => row.scope_kind === "provider_thread")
          .map((row) => row.canonical_external_subject)
          .sort()
      ).toEqual(["Case-Sensitive-Provider-ID", "case-sensitive-provider-id"]);
    });

    it("commits two monotonic advances in one transaction and preserves historical replay", async () => {
      const suffix = `batch-${runId}`;
      const firstRaw = pendingReceipt("batch-first", "10", "a".repeat(64));
      const firstRawCommit = makeAppliedReceiptCommit(firstRaw);
      const secondRaw = pendingReceipt("batch-second", "11", "b".repeat(64));
      const secondRawCommit = makeAppliedReceiptCommit(
        secondRaw,
        firstRawCommit.afterOrderingHead
      );
      const first = scopeDeferredFixture(firstRawCommit, suffix);
      const second = scopeDeferredFixture(secondRawCommit, suffix);
      const tenantId = first.tenantId;
      tenantIds.push(tenantId);
      await seedDeferredActionAnchors(db, [first, second], suffix);

      await expect(
        db.transaction(async (transaction) => {
          await expect(
            persistAndCommit(transaction, first, `${suffix}-1`)
          ).resolves.toMatchObject({ kind: "committed" });
          await expect(
            persistAndCommit(transaction, second, `${suffix}-2`)
          ).resolves.toMatchObject({ kind: "committed" });
        })
      ).resolves.toBeUndefined();

      const head = await readHead(db, second);
      expect(head).toMatchObject({
        latest_action_id: second.after.id,
        latest_position: "11",
        revision: "2"
      });
      await expect(
        db.transaction((transaction) =>
          commitInboxV2DeferredMessageSourceActionInTransaction(
            rawExecutor(transaction),
            first
          )
        )
      ).resolves.toMatchObject({
        kind: "already_exists",
        action: { id: first.after.id, state: { state: "applied" } }
      });
    });

    it("persists stale, semantic duplicate and equal-position conflict without moving the head", async () => {
      const suffix = `nonadvance-${runId}`;
      const canonicalRaw = pendingReceipt(
        "nonadvance-canonical",
        "20",
        "c".repeat(64)
      );
      const canonicalRawCommit = makeAppliedReceiptCommit(canonicalRaw);
      const canonical = scopeDeferredFixture(canonicalRawCommit, suffix);
      const head = canonicalRawCommit.afterOrderingHead;
      if (head === null) throw new Error("Expected canonical ordering head.");

      const staleRaw = pendingReceipt("nonadvance-stale", "19", "d".repeat(64));
      const stale = scopeDeferredFixture(
        makeTerminalDeferredCommit(
          staleRaw,
          {
            state: "stale",
            headAction: head.latest.action,
            staleAt: canonical.transition.recordedAt
          },
          { outcome: "stale", beforeHead: head }
        ),
        suffix
      );

      // Change exactly one ingestion-tuple component (the occurrence), while
      // preserving normalized event, semantic id and provider fingerprint.
      const duplicateRaw = pendingReceipt(
        "nonadvance-duplicate",
        "20",
        canonicalRaw.idempotencyKey.eventFingerprintSha256,
        {
          normalizedEvent: canonicalRaw.idempotencyKey.normalizedInboundEvent,
          occurrenceId: "source_occurrence:nonadvance-duplicate-only"
        }
      );
      const duplicate = scopeDeferredFixture(
        makeTerminalDeferredCommit(
          duplicateRaw,
          {
            state: "duplicate",
            canonicalAction: head.latest.action,
            duplicateAt: canonical.transition.recordedAt
          },
          { outcome: "duplicate", beforeHead: head }
        ),
        suffix
      );

      const conflictRaw = pendingReceipt(
        "nonadvance-conflict",
        "20",
        "e".repeat(64)
      );
      const conflict = scopeDeferredFixture(
        makeTerminalDeferredCommit(
          conflictRaw,
          {
            state: "ordering_conflict",
            conflictingAction: head.latest.action,
            reasonId: inboxV2CatalogIdSchema.parse(
              "core:provider-ordering-conflict"
            ),
            conflictedAt: canonical.transition.recordedAt
          },
          { outcome: "conflict", beforeHead: head }
        ),
        suffix
      );

      tenantIds.push(canonical.tenantId);
      await seedDeferredActionAnchors(
        db,
        [canonical, stale, duplicate, conflict],
        suffix
      );
      await db.transaction(async (transaction) => {
        expect(
          await persistAndCommit(transaction, canonical, `${suffix}-canonical`)
        ).toMatchObject({ kind: "committed" });
      });
      for (const [ordinal, commit] of [stale, duplicate, conflict].entries()) {
        await expect(
          db.transaction((transaction) =>
            persistAndCommit(
              transaction,
              commit,
              `${suffix}-nonadvance-${ordinal}`
            )
          )
        ).resolves.toMatchObject({ kind: "committed" });
      }

      expect(await readHead(db, canonical)).toMatchObject({
        latest_action_id: canonical.after.id,
        latest_position: "20",
        revision: "1"
      });
    });

    it("supports a 100-digit provider position and fails closed on a tampered candidate id", async () => {
      const suffix = `wide-${runId}`;
      const wideRaw = pendingReceipt(
        "wide-position",
        `1${"0".repeat(99)}`,
        "f".repeat(64)
      );
      const wide = scopeDeferredFixture(
        makeAppliedReceiptCommit(wideRaw),
        suffix
      );
      tenantIds.push(wide.tenantId);
      await seedDeferredActionAnchors(db, [wide], suffix);
      await expect(
        db.transaction((transaction) =>
          persistAndCommit(transaction, wide, `${suffix}-wide`)
        )
      ).resolves.toMatchObject({ kind: "committed" });

      const tampered = inboxV2DeferredMessageSourceActionSchema.parse({
        ...wide.before,
        id: `${wide.before.id}-tampered`
      });
      await expect(
        db.transaction((transaction) =>
          persistInboxV2DeferredMessageSourceActionInTransaction(
            rawExecutor(transaction),
            tampered
          )
        )
      ).resolves.toEqual({ kind: "idempotency_conflict" });
    });

    it("rejects tampered occurrence provenance before insert and roundtrips the canonical proof", async () => {
      const suffix = `occurrence-proof-${runId}`;
      const raw = pendingReceipt("occurrence-proof", "25", "7".repeat(64));
      const commit = scopeDeferredFixture(
        makeAppliedReceiptCommit(raw),
        suffix
      );
      tenantIds.push(commit.tenantId);
      await seedDeferredActionAnchors(db, [commit], suffix);
      const originalTimestamp =
        commit.before.sourceOccurrence.providerTimestamps[0];
      if (originalTimestamp === undefined) {
        throw new Error("Expected provider timestamp evidence.");
      }
      const tampered = inboxV2DeferredMessageSourceActionSchema.parse({
        ...commit.before,
        sourceOccurrence: {
          ...commit.before.sourceOccurrence,
          providerTimestamps: [
            {
              ...originalTimestamp,
              timestamp: new Date(
                Date.parse(originalTimestamp.timestamp) + 1_000
              ).toISOString()
            }
          ]
        }
      });

      await expect(
        db.transaction((transaction) =>
          persistInboxV2DeferredMessageSourceActionInTransaction(
            rawExecutor(transaction),
            tampered
          )
        )
      ).resolves.toEqual({ kind: "action_id_conflict" });
      const absent = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_deferred_message_source_actions
        where tenant_id = ${commit.tenantId} and id = ${commit.before.id}
      `);
      expect(absent.rows[0]?.count).toBe("0");

      await expect(
        db.transaction((transaction) =>
          persistInboxV2DeferredMessageSourceActionInTransaction(
            rawExecutor(transaction),
            commit.before
          )
        )
      ).resolves.toEqual({ kind: "created", action: commit.before });
      await expect(
        db.transaction((transaction) =>
          readInboxV2DeferredMessageSourceActionInTransaction(
            rawExecutor(transaction),
            {
              tenantId: commit.tenantId,
              actionId: commit.before.id,
              lock: false
            }
          )
        )
      ).resolves.toEqual(commit.before);
      await expect(
        db.execute(sql`
          update inbox_v2_deferred_message_source_actions
          set semantic_proof_detail = jsonb_set(
            semantic_proof_detail,
            '{ordering,position}',
            '"999"'::jsonb
          )
          where tenant_id = ${commit.tenantId} and id = ${commit.before.id}
        `)
      ).rejects.toMatchObject({
        cause: {
          code: "40001",
          message: "inbox_v2.deferred_source_action_cas"
        }
      });
    });

    it("keeps exact-key pending reads bounded after a large terminal history", async () => {
      const suffix = `terminal-history-${runId}`;
      const raw = pendingReceipt(
        "terminal-history-pending",
        "29",
        "6".repeat(64)
      );
      const commit = scopeDeferredFixture(
        makeAppliedReceiptCommit(raw),
        suffix
      );
      tenantIds.push(commit.tenantId);
      await seedDeferredActionAnchors(db, [commit], suffix);
      await expect(
        db.transaction((transaction) =>
          persistInboxV2DeferredMessageSourceActionInTransaction(
            rawExecutor(transaction),
            commit.before
          )
        )
      ).resolves.toMatchObject({ kind: "created" });

      await bulkInsertTerminalSourceActionHistory(db, commit.before, 5_000);
      const repository = createPostgresReconciliationRepository(db);
      await expect(
        repository.listPendingByExactKey({
          tenantId: commit.tenantId,
          externalMessageKey: commit.before.externalMessageKey,
          afterActionId: null,
          limit: 25
        })
      ).resolves.toMatchObject({
        kind: "page",
        actions: [{ id: commit.before.id }],
        hasMore: false,
        nextAfterActionId: null
      });

      const keyDigest = computeInboxV2ExternalMessageKeyDigest(
        commit.before.externalMessageKey
      );
      const plans = await db.transaction(async (transaction) => {
        await transaction.execute(sql`set local enable_seqscan = off`);
        const registry = await transaction.execute<{
          "QUERY PLAN": unknown;
        }>(sql`
          explain (format json, costs true)
          select external_message_key_detail
          from inbox_v2_source_message_key_registry
          where tenant_id = ${commit.tenantId}
            and message_key_digest_sha256 = ${keyDigest}
          limit 1
        `);
        const pending = await transaction.execute<{
          "QUERY PLAN": unknown;
        }>(sql`
          explain (format json, costs true)
          select id
          from inbox_v2_deferred_message_source_actions
          where tenant_id = ${commit.tenantId}
            and message_key_digest_sha256 = ${keyDigest}
            and external_message_key_detail =
              ${JSON.stringify(commit.before.externalMessageKey)}::jsonb
            and state = 'pending'
          order by id asc
          limit 26
        `);
        return {
          registry: explainPlan(registry.rows[0]?.["QUERY PLAN"]),
          pending: explainPlan(pending.rows[0]?.["QUERY PLAN"])
        };
      });
      expect(JSON.stringify(plans.registry)).toContain(
        '"Node Type":"Index Scan"'
      );
      expect(JSON.stringify(plans.registry)).toContain(
        '"Relation Name":"inbox_v2_source_message_key_registry"'
      );
      expect(JSON.stringify(plans.registry)).not.toContain("Seq Scan");
      expect(JSON.stringify(plans.pending)).toContain(
        "inbox_v2_deferred_actions_pending_key_idx"
      );
      expect(JSON.stringify(plans.pending)).not.toContain("Seq Scan");
      expect(plans.registry[0]!.Plan["Total Cost"]).toBeLessThan(100);
      expect(plans.pending[0]!.Plan["Total Cost"]).toBeLessThan(100);
    }, 20_000);

    it("rolls back induction, occurrence, transition and head after a late action-write failure", async () => {
      const suffix = `rollback-${runId}`;
      const lateRaw = pendingReceipt("rollback-late", "31", "2".repeat(64));
      const late = scopeDeferredFixture(
        makeAppliedReceiptCommit(lateRaw),
        suffix
      );
      tenantIds.push(late.tenantId);
      await seedDeferredActionAnchors(db, [late], suffix);

      await expect(
        db.transaction(async (transaction) => {
          const executor = rawExecutor(transaction);
          expect(
            await persistInboxV2DeferredMessageSourceActionInTransaction(
              executor,
              late.before
            )
          ).toMatchObject({ kind: "created" });
          if (late.sourceOccurrenceResolution === null) {
            throw new Error("Expected occurrence resolution.");
          }
          await persistOccurrenceResolution(
            executor,
            late.sourceOccurrenceResolution,
            `${suffix}-late`
          );
          await commitInboxV2DeferredMessageSourceActionInTransaction(
            failFifthCommitStatementAfterVerifyingWrites(executor, late),
            late
          );
        })
      ).rejects.toThrow("src006.injected_late_action_write_failure");

      await expect(
        db.transaction((transaction) =>
          readInboxV2DeferredMessageSourceActionInTransaction(
            rawExecutor(transaction),
            {
              tenantId: late.tenantId,
              actionId: late.before.id,
              lock: false
            }
          )
        )
      ).resolves.toBeNull();
      const transition = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_deferred_message_source_action_transitions
        where tenant_id = ${late.tenantId} and action_id = ${late.before.id}
      `);
      expect(transition.rows[0]?.count).toBe("0");
      const head = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_deferred_source_action_ordering_heads
        where tenant_id = ${late.tenantId}
      `);
      expect(head.rows[0]?.count).toBe("0");
      const occurrence = await db.execute<{
        resolution_state: string;
        revision: string;
      }>(sql`
        select resolution_state, revision::text as revision
        from inbox_v2_source_occurrences
        where tenant_id = ${late.tenantId} and id = ${late.before.sourceOccurrence.id}
      `);
      expect(occurrence.rows[0]).toEqual({
        resolution_state: "pending",
        revision: "1"
      });
    });

    it("serializes identical advisory keys while distinct keys remain independent", async () => {
      const tenantId = `tenant:src006-lock-${runId}`;
      const keyA = "a".repeat(64);
      const keyB = "b".repeat(64);
      const first = deferred<void>();
      const releaseFirst = deferred<void>();
      const sameAcquired = deferred<void>();

      const firstWriter = db.transaction(async (transaction) => {
        await transaction.execute(
          buildAcquireInboxV2SourceMessageKeyLockSql({
            tenantId,
            keyDigest: keyA
          })
        );
        first.resolve();
        await releaseFirst.promise;
      });
      await first.promise;
      const sameWriter = db.transaction(async (transaction) => {
        await transaction.execute(
          buildAcquireInboxV2SourceMessageKeyLockSql({
            tenantId,
            keyDigest: keyA
          })
        );
        sameAcquired.resolve();
      });
      const distinctWriter = db.transaction(async (transaction) => {
        await transaction.execute(
          buildAcquireInboxV2SourceMessageKeyLockSql({
            tenantId,
            keyDigest: keyB
          })
        );
        return "acquired";
      });

      await expect(distinctWriter).resolves.toBe("acquired");
      await expect(settlesWithin(sameAcquired.promise, 100)).resolves.toBe(
        false
      );
      releaseFirst.resolve();
      await expect(firstWriter).resolves.toBeUndefined();
      await expect(sameWriter).resolves.toBeUndefined();
    });
  }
);

function makeReconciliationPlan(
  input: Readonly<{
    accountSuffix: string;
    subject: string;
    scopeKind: "provider_thread" | "source_account" | "source_thread_binding";
    suffix: string;
  }>
): InboxV2SourceMessageReconciliationPlan {
  const context = scopeReconciliationFixture(
    makeResolvedReconciliationContext(input.accountSuffix),
    input.suffix
  );
  return reconciliationMaterializer.materialize({
    context,
    descriptor: makeMessageReconciliationDescriptor(context, {
      subject: input.subject,
      scopeKind: input.scopeKind,
      intent: "message_create"
    })
  });
}

function makeSourceActionReconciliationPlan(
  input: Readonly<{
    accountSuffix: string;
    subject: string;
    scopeKind: "provider_thread" | "source_account" | "source_thread_binding";
    suffix: string;
    normalizedContentDigestSha256?: string;
  }>
): InboxV2SourceMessageReconciliationPlan {
  const context = scopeReconciliationFixture(
    makeResolvedReconciliationContext(input.accountSuffix),
    input.suffix
  );
  const descriptor = makeMessageReconciliationDescriptor(context, {
    subject: input.subject,
    scopeKind: input.scopeKind,
    intent: "source_action"
  });
  if (
    descriptor.intent.kind !== "source_action" ||
    descriptor.intent.action.kind !== "edit"
  ) {
    throw new Error("Expected edit source-action descriptor.");
  }
  return reconciliationMaterializer.materialize({
    context,
    descriptor: {
      ...descriptor,
      intent: {
        ...descriptor.intent,
        action: {
          ...descriptor.intent.action,
          normalizedContentDigestSha256:
            input.normalizedContentDigestSha256 ??
            descriptor.intent.action.normalizedContentDigestSha256
        }
      }
    }
  });
}

function makeExpiredReconciliationActionCommit(
  before: InboxV2DeferredMessageSourceAction,
  recordedAt: string
): InboxV2DeferredMessageSourceActionCommit {
  const state = {
    state: "expired" as const,
    reasonId: inboxV2CatalogIdSchema.parse("core:source-action-expired"),
    expiredAt: recordedAt
  };
  return inboxV2DeferredMessageSourceActionCommitSchema.parse({
    tenantId: before.tenantId,
    before,
    transition: {
      action: {
        tenantId: before.tenantId,
        kind: "deferred_message_source_action",
        id: before.id
      },
      expectedRevision: before.revision,
      resultingRevision: (BigInt(before.revision) + 1n).toString(),
      afterState: state,
      orderingOutcome: "not_evaluated",
      expectedOrderingHeadRevision: null,
      resultingOrderingHeadRevision: null,
      recordedAt
    },
    targetExternalMessageReference: null,
    sourceOccurrenceResolution: null,
    effectProof: null,
    beforeOrderingHead: null,
    afterOrderingHead: null,
    after: {
      ...before,
      state,
      revision: (BigInt(before.revision) + 1n).toString(),
      updatedAt: recordedAt
    }
  });
}

function candidateReferenceForPlan(
  plan: InboxV2SourceMessageReconciliationPlan
): InboxV2ExternalMessageReference {
  let candidateTimelineItemId: string;
  let candidateMessageId: string;
  if (plan.intent.kind === "message_create") {
    candidateTimelineItemId = plan.intent.candidateTimelineItemId;
    candidateMessageId = plan.intent.candidateMessageId;
  } else {
    const creation = reconciliationMaterializer.materialize({
      context: plan.context,
      descriptor: makeMessageReconciliationDescriptor(plan.context, {
        subject: plan.messageKey.canonicalExternalSubject,
        scopeKind: plan.messageKey.scope.kind,
        intent: "message_create"
      })
    });
    if (creation.intent.kind !== "message_create") {
      throw new Error("Expected message-create candidate derivation.");
    }
    candidateTimelineItemId = creation.intent.candidateTimelineItemId;
    candidateMessageId = creation.intent.candidateMessageId;
  }
  return inboxV2ExternalMessageReferenceSchema.parse({
    tenantId: plan.sourceOccurrence.tenantId,
    id: plan.candidateExternalMessageReferenceId,
    key: plan.messageKey,
    identityDeclaration: plan.sourceOccurrence.messageIdentityDeclaration,
    externalThread: plan.messageKey.externalThread,
    timelineItem: {
      tenantId: plan.sourceOccurrence.tenantId,
      kind: "timeline_item",
      id: candidateTimelineItemId
    },
    message: {
      tenantId: plan.sourceOccurrence.tenantId,
      kind: "message",
      id: candidateMessageId
    },
    revision: "1",
    createdAt: plan.materializedAt
  });
}

function createPostgresReconciliationRepository(
  db: HuleeDatabase,
  options: Readonly<{
    transportLinkMode?: "valid" | "missing" | "tampered";
    onApplySourceAction?: () => void;
  }> = {}
) {
  const callbacks: InboxV2SourceMessageReconciliationCallbacks = {
    async createMessage(transaction, input) {
      return withHistoricalReconciliationFixture(transaction, async () => {
        const inserted = await transaction.execute(
          buildInsertInboxV2ExternalMessageReferenceSql(
            input.candidateExternalMessageReference
          )
        );
        if (inserted.rows.length !== 1) {
          return {
            kind: "conflict" as const,
            code: "source.message_reconciliation.callback_conflict" as const
          };
        }
        return resolveReconciliationOccurrence(
          transaction,
          input.plan,
          input.candidateExternalMessageReference,
          input.plan.intent.transportRole,
          options.transportLinkMode ?? "valid"
        );
      });
    },
    async attachOccurrence(transaction, input) {
      return withHistoricalReconciliationFixture(transaction, () =>
        resolveReconciliationOccurrence(
          transaction,
          input.plan,
          input.targetExternalMessageReference,
          input.reason === "exact_message_reuse" &&
            input.plan.intent.kind === "message_create" &&
            input.plan.intent.transportRole === "origin"
            ? "additional_artifact"
            : input.plan.intent.transportRole,
          options.transportLinkMode ?? "valid"
        )
      );
    },
    async applySourceAction() {
      options.onApplySourceAction?.();
      return {
        kind: "conflict",
        code: "source.message_reconciliation.callback_conflict"
      };
    },
    async drainDeferredActions(_transaction, input) {
      return input.actions.length === 0
        ? { kind: "committed", result: { results: [] } }
        : {
            kind: "conflict",
            code: "source.message_reconciliation.callback_conflict"
          };
    }
  };
  return createSqlInboxV2SourceMessageReconciliationRepository(db, {
    planAuthorizationVerifier:
      createInboxV2SourceMessageReconciliationPlanVerifier({
        trustedServiceId: "core:source-runtime",
        namespaceDeriver: reconciliationNamespaceDeriver
      }),
    callbacks
  });
}

async function withHistoricalReconciliationFixture<TResult>(
  transaction: RawSqlExecutor,
  work: () => Promise<TResult>
): Promise<TResult> {
  // This repository-local suite preserves pre-SRC-007 reconciliation fixtures.
  // Product Message creation goes through the authorized atomic coordinator.
  await transaction.execute(sql`set local session_replication_role = replica`);
  const result = await work();
  await transaction.execute(sql`set local session_replication_role = origin`);
  return result;
}

function scopeReconciliationFixture<T>(value: T, suffix: string): T {
  const scoped = scopeDeferredFixture(value, suffix);
  const visit = (candidate: unknown): unknown => {
    if (candidate === "tenant:alpha") return `tenant:src006-${suffix}`;
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (candidate !== null && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate).map(([key, child]) => [key, visit(child)])
      );
    }
    return candidate;
  };
  return visit(scoped) as T;
}

async function resolveReconciliationOccurrence(
  transaction: RawSqlExecutor,
  plan: InboxV2SourceMessageReconciliationPlan,
  target: InboxV2ExternalMessageReference,
  transportRole: InboxV2MessageTransportOccurrenceLink["role"],
  transportLinkMode: "valid" | "missing" | "tampered"
) {
  const after = {
    ...plan.sourceOccurrence,
    resolution: {
      state: "resolved" as const,
      externalMessageReference: {
        tenantId: target.tenantId,
        kind: "external_message_reference" as const,
        id: target.id
      }
    },
    revision: (BigInt(plan.sourceOccurrence.revision) + 1n).toString(),
    updatedAt: plan.materializedAt
  };
  const resolution = inboxV2SourceOccurrenceResolutionCommitSchema.parse({
    tenantId: plan.sourceOccurrence.tenantId,
    expectedRevision: plan.sourceOccurrence.revision,
    resultingRevision: after.revision,
    changedAt: plan.materializedAt,
    resolver: {
      kind: "trusted_service",
      trustedServiceId: plan.materializedByTrustedServiceId,
      resolutionToken: `resolution:src006-${plan.sourceOccurrence.id}`
    },
    before: plan.sourceOccurrence,
    after,
    resolvedReference: target
  });
  await persistOccurrenceResolution(
    transaction,
    resolution,
    `reconcile-${plan.sourceOccurrence.id}`
  );
  if (plan.intent.kind !== "source_action" && transportLinkMode !== "missing") {
    const link = inboxV2MessageTransportOccurrenceLinkSchema.parse({
      tenantId: plan.sourceOccurrence.tenantId,
      id: plan.intent.candidateTransportLinkId,
      message: target.message,
      sourceOccurrence: {
        tenantId: plan.sourceOccurrence.tenantId,
        kind: "source_occurrence",
        id: plan.sourceOccurrence.id
      },
      externalMessageReference: {
        tenantId: target.tenantId,
        kind: "external_message_reference",
        id: target.id
      },
      role: transportLinkMode === "tampered" ? "provider_echo" : transportRole,
      revision: "1",
      linkedAt: plan.materializedAt
    });
    await persistReconciliationTransportLink(transaction, link);
  }
  const persistedOccurrence = await readInboxV2SourceOccurrenceInTransaction(
    transaction,
    {
      tenantId: plan.sourceOccurrence.tenantId,
      occurrenceId: plan.sourceOccurrence.id
    },
    { lock: true }
  );
  const references =
    await findInboxV2ExternalMessageReferenceCandidatesInTransaction(
      transaction,
      {
        tenantId: target.tenantId,
        referenceId: target.id,
        keyDigest: computeInboxV2ExternalMessageKeyDigest(target.key)
      }
    );
  const persistedReference = references.find(
    (reference) => reference.id === target.id
  );
  if (persistedOccurrence === null || persistedReference === undefined) {
    return {
      kind: "conflict" as const,
      code: "source.message_reconciliation.callback_conflict" as const
    };
  }
  return {
    kind: "committed" as const,
    result: {
      externalMessageReference: persistedReference,
      sourceOccurrence: persistedOccurrence
    }
  };
}

async function persistReconciliationTransportLink(
  transaction: RawSqlExecutor,
  link: InboxV2MessageTransportOccurrenceLink
): Promise<void> {
  const head = await transaction.execute<{
    link_count: string;
    revision: string;
  }>(sql`
    select link_count::text, revision::text
      from inbox_v2_message_transport_link_heads
     where tenant_id = ${link.tenantId}
       and message_id = ${link.message.id}
     for update
  `);
  const before = head.rows[0];
  const nextRevision = (BigInt(before?.revision ?? "0") + 1n).toString();
  const inserted = await transaction.execute<{ id: string }>(sql`
    insert into inbox_v2_message_transport_links (
      tenant_id, id, message_id, source_occurrence_id,
      external_message_reference_id, role, resulting_head_revision,
      revision, linked_at, recorded_stream_position
    ) values (
      ${link.tenantId}, ${link.id}, ${link.message.id},
      ${link.sourceOccurrence.id}, ${link.externalMessageReference.id},
      ${link.role}, ${BigInt(nextRevision)}, ${BigInt(link.revision)},
      ${new Date(link.linkedAt)}, ${BigInt(nextRevision)}
    )
    returning id
  `);
  if (inserted.rows[0]?.id !== link.id) {
    throw new Error("Expected one durable transport occurrence link.");
  }

  if (before === undefined) {
    const created = await transaction.execute<{ message_id: string }>(sql`
      insert into inbox_v2_message_transport_link_heads (
        tenant_id, message_id, link_count, latest_link_id, revision,
        last_changed_stream_position, updated_at
      ) values (
        ${link.tenantId}, ${link.message.id}, 1, ${link.id}, 1, 1,
        ${new Date(link.linkedAt)}
      )
      returning message_id
    `);
    if (created.rows[0]?.message_id !== link.message.id) {
      throw new Error("Expected one durable transport-link head.");
    }
    return;
  }

  if (BigInt(before.link_count) + 1n !== BigInt(nextRevision)) {
    throw new Error("Transport-link head revision/count diverged.");
  }
  const advanced = await transaction.execute<{ message_id: string }>(sql`
    update inbox_v2_message_transport_link_heads
       set link_count = ${BigInt(nextRevision)},
           latest_link_id = ${link.id},
           revision = ${BigInt(nextRevision)},
           last_changed_stream_position = ${BigInt(nextRevision)},
           updated_at = ${new Date(link.linkedAt)}
     where tenant_id = ${link.tenantId}
       and message_id = ${link.message.id}
       and revision = ${BigInt(before.revision)}
       and link_count = ${BigInt(before.link_count)}
    returning message_id
  `);
  if (advanced.rows[0]?.message_id !== link.message.id) {
    throw new Error("Expected an atomic transport-link head advance.");
  }
}

async function seedReconciliationPlanAnchors(
  db: HuleeDatabase,
  plans: readonly InboxV2SourceMessageReconciliationPlan[],
  suffix: string
) {
  const first = plans[0];
  if (first === undefined) throw new Error("At least one plan is required.");
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${first.sourceOccurrence.tenantId}, ${`src006-${suffix}`},
        'SRC006 canonical reconciliation', 'saas_shared'
      )
    `);
    const seenConnections = new Set<string>();
    const seenAccounts = new Set<string>();
    const seenBindings = new Set<string>();
    const seenEvents = new Set<string>();
    const seenOccurrences = new Set<string>();
    const seenThreads = new Set<string>();
    const seenActors = new Set<string>();
    const seenMessages = new Set<string>();
    for (const [ordinal, plan] of plans.entries()) {
      const source = plan.context.plan.source;
      const occurrence = plan.sourceOccurrence;
      const mapping = plan.context.externalThreadMapping;
      const binding = plan.context.sourceThreadBinding.binding;
      const connectionId = source.sourceConnection.id;
      const accountId = source.sourceAccount.id;
      if (!seenConnections.has(connectionId)) {
        seenConnections.add(connectionId);
        await transaction.execute(sql`
          insert into source_connections (
            id, tenant_id, source_type, source_name, display_name,
            status, auth_type, capabilities, config, diagnostics, metadata
          ) values (
            ${connectionId}, ${occurrence.tenantId}, 'messenger', 'synthetic',
            'SRC006 reconciliation connection', 'active', 'custom',
            '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
          )
        `);
      }
      if (!seenAccounts.has(accountId)) {
        seenAccounts.add(accountId);
        await transaction.execute(sql`
          insert into source_accounts (
            id, tenant_id, source_connection_id, account_type,
            display_name, status, metadata
          ) values (
            ${accountId}, ${occurrence.tenantId}, ${connectionId},
            'direct_number', 'SRC006 reconciliation account', 'active',
            '{}'::jsonb
          )
        `);
      }
      if (!seenThreads.has(mapping.thread.id)) {
        seenThreads.add(mapping.thread.id);
        const threadKey = mapping.thread.key;
        const threadScope = externalThreadScopeColumns(threadKey.scope);
        await transaction.execute(sql`
          insert into inbox_v2_external_threads (
            tenant_id, id, key_registry_id, key_registry_entry_kind,
            realm_id, realm_version, canonicalization_version,
            scope_kind, scope_source_connection_id, scope_source_account_id,
            scope_owner_key, object_kind_id, canonical_external_subject,
            identity_declaration, conversation_id, conversation_transport,
            conversation_topology, revision, created_at, updated_at
          ) values (
            ${occurrence.tenantId}, ${mapping.thread.id},
            ${`external_thread_key_registry:src006-${suffix}`}, 'canonical',
            ${threadKey.realm.realmId}, ${threadKey.realm.realmVersion},
            ${threadKey.realm.canonicalizationVersion}, ${threadScope.kind},
            ${threadScope.sourceConnectionId}, ${threadScope.sourceAccountId},
            ${threadScope.ownerKey}, ${threadKey.objectKindId},
            ${threadKey.canonicalExternalSubject},
            ${JSON.stringify(mapping.thread.identityDeclaration)}::jsonb,
            ${mapping.thread.conversation.id}, 'external',
            ${mapping.thread.conversationTopology},
            ${BigInt(mapping.thread.revision)},
            ${new Date(mapping.thread.createdAt)},
            ${new Date(mapping.thread.updatedAt)}
          )
        `);
      }
      if (!seenBindings.has(binding.id)) {
        seenBindings.add(binding.id);
        await transaction.execute(sql`
          insert into inbox_v2_source_thread_bindings (
            tenant_id, id, external_thread_id, source_connection_id,
            source_account_id, created_at
          ) values (
            ${occurrence.tenantId}, ${binding.id},
            ${binding.externalThread.id}, ${connectionId}, ${accountId},
            ${new Date(binding.createdAt)}
          )
        `);
      }
      if (occurrence.origin.kind === "provider_response") {
        throw new Error("Expected event-backed reconciliation occurrence.");
      }
      if (
        occurrence.providerActor?.kind === "source_external_identity" &&
        !seenActors.has(occurrence.providerActor.sourceExternalIdentity.id)
      ) {
        seenActors.add(occurrence.providerActor.sourceExternalIdentity.id);
        await seedSourceActorIdentity(transaction, occurrence);
      }
      if (!seenEvents.has(occurrence.origin.normalizedInboundEvent.id)) {
        seenEvents.add(occurrence.origin.normalizedInboundEvent.id);
        await transaction.execute(sql`
          insert into raw_inbound_events (
            id, tenant_id, source_connection_id, source_account_id,
            idempotency_key, payload, headers, processing_status,
            received_at, created_at, updated_at
          ) values (
            ${occurrence.origin.rawInboundEvent.id}, ${occurrence.tenantId},
            ${connectionId}, ${accountId}, ${`src006-plan-raw-${suffix}-${ordinal}`},
            '{}'::jsonb, '{}'::jsonb, 'processed',
            ${new Date(occurrence.recordedAt)},
            ${new Date(occurrence.recordedAt)},
            ${new Date(occurrence.recordedAt)}
          )
          on conflict (id) do nothing
        `);
        await transaction.execute(sql`
          insert into normalized_inbound_events (
            id, tenant_id, raw_event_id, source_connection_id,
            source_account_id, source_type, source_name, event_type,
            direction, visibility, payload_version, normalized_payload,
            reply_capability, idempotency_key, processing_status,
            created_at, updated_at
          ) values (
            ${occurrence.origin.normalizedInboundEvent.id},
            ${occurrence.tenantId}, ${occurrence.origin.rawInboundEvent.id},
            ${connectionId}, ${accountId}, 'messenger', 'synthetic',
            'message', 'inbound', 'private', 'v1', '{}'::jsonb,
            '{}'::jsonb, ${`src006-plan-event-${suffix}-${ordinal}`},
            'processed', ${new Date(occurrence.recordedAt)},
            ${new Date(occurrence.recordedAt)}
          )
          on conflict (id) do nothing
        `);
      }
      if (!seenOccurrences.has(occurrence.id)) {
        seenOccurrences.add(occurrence.id);
        await seedSourceOccurrence(
          transaction,
          occurrence,
          connectionId,
          mapping.thread.conversation.id
        );
      }
      const target = candidateReferenceForPlan(plan);
      if (!seenMessages.has(target.message.id)) {
        seenMessages.add(target.message.id);
        await seedMessageAnchor(
          transaction,
          target,
          mapping.thread.conversation.id,
          occurrence
        );
      }
    }
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

async function seedMessageAnchor(
  transaction: unknown,
  target: InboxV2ExternalMessageReference,
  conversationId: string,
  originOccurrence: InboxV2SourceMessageReconciliationPlan["sourceOccurrence"]
) {
  const executor = rawExecutor(transaction);
  const digest = createHash("sha256").update(target.message.id).digest("hex");
  await executor.execute(sql`
    insert into inbox_v2_messages (
      tenant_id, id, conversation_id, timeline_item_id,
      author_participant_id, origin_kind, origin_source_occurrence_id,
      origin_source_direction, creation_attribution_id,
      content_id, content_revision, content_state, reference_kind,
      lifecycle, revision, last_changed_stream_position, created_at,
      updated_at
    ) values (
      ${target.tenantId}, ${target.message.id}, ${conversationId},
      ${target.timelineItem.id},
      ${`conversation_participant:src006-${digest.slice(0, 24)}`},
      'source_originated', ${originOccurrence.id},
      ${originOccurrence.direction},
      ${`action_attribution:src006-${digest.slice(0, 24)}`},
      ${`timeline_content:src006-${digest.slice(0, 24)}`},
      1, 'available', 'none', 'active', 1, 1,
      ${new Date(target.createdAt)}, ${new Date(target.createdAt)}
    )
  `);
}

async function seedSourceActorIdentity(
  transaction: unknown,
  occurrence: InboxV2DeferredMessageSourceAction["sourceOccurrence"]
) {
  if (occurrence.providerActor?.kind !== "source_external_identity") return;
  const executor = rawExecutor(transaction);
  const adapter = occurrence.descriptor.adapterContract;
  const actorId = occurrence.providerActor.sourceExternalIdentity.id;
  const declaration = {
    adapterContract: adapter,
    identityKind: "source_external_identity",
    realmId: "module:synthetic:src006-actor-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:src006-provider-user",
    scopeKind: "provider",
    decisionStrength: "authoritative"
  };
  await executor.execute(sql`
    insert into inbox_v2_source_external_identities (
      tenant_id, id, realm_id, realm_version,
      canonicalization_version, object_kind_id, scope_kind,
      identity_declaration, declaration_contract_id,
      declaration_contract_version, declaration_revision,
      declaration_surface_id, declaration_loaded_by_trusted_service_id,
      declaration_loaded_at, materialized_by_trusted_service_id,
      materialization_authorization_token, materialized_at,
      canonical_external_subject, stability_kind, revision,
      created_at, updated_at
    ) values (
      ${occurrence.tenantId}, ${actorId},
      'module:synthetic:src006-actor-realm', 'v1', 'v1',
      'module:synthetic:src006-provider-user', 'provider',
      ${JSON.stringify(declaration)}::jsonb, ${adapter.contractId},
      ${adapter.contractVersion}, ${BigInt(adapter.declarationRevision)},
      ${adapter.surfaceId}, ${adapter.loadedByTrustedServiceId},
      ${new Date(adapter.loadedAt)}, ${adapter.loadedByTrustedServiceId},
      ${`materialization:src006-actor-${actorId}`},
      ${new Date(occurrence.createdAt)}, ${actorId}, 'stable', 1,
      ${new Date(occurrence.createdAt)}, ${new Date(occurrence.createdAt)}
    )
    on conflict (tenant_id, id) do nothing
  `);
}

function externalThreadScopeColumns(
  scope: InboxV2SourceMessageReconciliationPlan["context"]["externalThreadMapping"]["thread"]["key"]["scope"]
) {
  if (scope.kind === "provider") {
    return {
      kind: scope.kind,
      sourceConnectionId: null,
      sourceAccountId: null,
      ownerKey: "provider"
    };
  }
  if (scope.kind === "source_connection") {
    return {
      kind: scope.kind,
      sourceConnectionId: scope.owner.id,
      sourceAccountId: null,
      ownerKey: `source_connection|${String(scope.owner.id).length}:${scope.owner.id}`
    };
  }
  return {
    kind: scope.kind,
    sourceConnectionId: null,
    sourceAccountId: scope.owner.id,
    ownerKey: `source_account|${String(scope.owner.id).length}:${scope.owner.id}`
  };
}

function pendingReceipt(
  id: string,
  position: string,
  fingerprint: string,
  input: Readonly<{
    normalizedEvent?: InboxV2DeferredMessageSourceAction["idempotencyKey"]["normalizedInboundEvent"];
    occurrenceId?: string;
  }> = {}
): InboxV2DeferredMessageSourceAction {
  const action = makePendingDeferredAction(
    {
      kind: "receipt",
      fact: "read",
      scope: "exact_message",
      normalizedEvent:
        input.normalizedEvent ?? deferredNormalizedEvent(`${id}-event`)
    },
    {
      id: `deferred_message_source_action:${id}`,
      occurrenceId: input.occurrenceId ?? `source_occurrence:${id}`,
      position,
      fingerprint
    }
  );
  return action;
}

async function persistAndCommit(
  transaction: unknown,
  commit: InboxV2DeferredMessageSourceActionCommit,
  transitionSuffix: string
) {
  const executor = rawExecutor(transaction);
  const induced = await persistInboxV2DeferredMessageSourceActionInTransaction(
    executor,
    commit.before
  );
  expect(induced).toMatchObject({ kind: "created" });
  if (commit.sourceOccurrenceResolution !== null) {
    await persistOccurrenceResolution(
      executor,
      commit.sourceOccurrenceResolution,
      transitionSuffix
    );
  }
  return commitInboxV2DeferredMessageSourceActionInTransaction(
    executor,
    commit
  );
}

async function persistOccurrenceResolution(
  transaction: unknown,
  resolution: InboxV2SourceOccurrenceResolutionCommit,
  suffix: string
) {
  const executor = rawExecutor(transaction);
  const inserted = await executor.execute(
    buildInsertInboxV2SourceOccurrenceResolutionTransitionSql(
      resolution,
      `source_occurrence_resolution_transition:${suffix}`,
      [],
      null
    )
  );
  expect(inserted.rows).toHaveLength(1);
  const advanced = await executor.execute(
    buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql(resolution)
  );
  expect(advanced.rows).toHaveLength(1);
}

async function readHead(
  db: HuleeDatabase,
  commit: InboxV2DeferredMessageSourceActionCommit
) {
  const head = commit.afterOrderingHead;
  if (head === null) throw new Error("Expected ordering head.");
  const rows = await db.execute<{
    latest_action_id: string;
    latest_position: string;
    revision: string;
  }>(sql`
    select latest_action_id, latest_position, revision::text as revision
    from inbox_v2_deferred_source_action_ordering_heads
    where tenant_id = ${head.tenantId}
      and message_key_digest_sha256 =
        ${computeInboxV2ExternalMessageKeyDigest(head.externalMessageKey)}
      and lane = ${head.lane}
      and scope_token = ${head.scopeToken}
      and comparator_id = ${head.comparatorId}
      and comparator_revision = ${BigInt(head.comparatorRevision)}
  `);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0];
}

type ExplainJson = readonly [
  Readonly<{
    Plan: Readonly<Record<string, unknown>> &
      Readonly<{ "Total Cost": number }>;
  }>
];

function explainPlan(value: unknown): ExplainJson {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("Expected one PostgreSQL JSON EXPLAIN plan.");
  }
  const plan = value[0] as { Plan?: { "Total Cost"?: unknown } };
  if (plan.Plan === undefined || typeof plan.Plan["Total Cost"] !== "number") {
    throw new Error("PostgreSQL JSON EXPLAIN plan has no numeric total cost.");
  }
  return value as unknown as ExplainJson;
}

async function bulkInsertTerminalSourceActionHistory(
  db: HuleeDatabase,
  source: InboxV2DeferredMessageSourceAction,
  count: number
): Promise<void> {
  await db.transaction(async (transaction) => {
    const columns = await transaction.execute<{ column_name: string }>(sql`
      select attribute.attname as column_name
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid =
        'public.inbox_v2_deferred_message_source_actions'::regclass
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attgenerated = ''
      order by attribute.attnum
    `);
    const names = columns.rows.map((row) => row.column_name);
    if (
      names.length < 40 ||
      names.some((name) => !/^[a-z][a-z0-9_]*$/u.test(name))
    ) {
      throw new Error("Unexpected deferred source-action catalog columns.");
    }
    const sourcePrefix = `${source.tenantId}|${source.id}|`;
    const projections = names.map((name) => {
      switch (name) {
        case "id":
          return "'deferred_message_source_action:terminal-history-' || lpad(history.ordinal::text, 6, '0')";
        case "event_fingerprint_sha256":
          return `encode(sha256(convert_to(${sqlLiteral(sourcePrefix)} || history.ordinal::text, 'UTF8')), 'hex')`;
        case "state":
          return "'expired'";
        case "state_reason_id":
          return "'core:terminal_history_compacted'";
        case "terminal_at":
        case "updated_at":
          return "base.updated_at + interval '1 hour'";
        case "revision":
          return "2";
        default:
          return `base.${quoteSqlIdentifier(name)}`;
      }
    });
    const insertSql = `
      insert into public.inbox_v2_deferred_message_source_actions (
        ${names.map(quoteSqlIdentifier).join(", ")}
      )
      select ${projections.join(", ")}
      from public.inbox_v2_deferred_message_source_actions base
      cross join generate_series(1, ${count}) history(ordinal)
      where base.tenant_id = ${sqlLiteral(source.tenantId)}
        and base.id = ${sqlLiteral(source.id)}
    `;
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql.raw(insertSql));
    await transaction.execute(sql`set local session_replication_role = origin`);
    await transaction.execute(
      sql`analyze public.inbox_v2_deferred_message_source_actions`
    );
    const persisted = await transaction.execute<{ count: string }>(sql`
      select count(*)::text as count
      from inbox_v2_deferred_message_source_actions
      where tenant_id = ${source.tenantId}
        and state = 'expired'
        and id like 'deferred_message_source_action:terminal-history-%'
    `);
    expect(persisted.rows[0]?.count).toBe(String(count));
  });
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function seedDeferredActionAnchors(
  db: HuleeDatabase,
  commits: readonly InboxV2DeferredMessageSourceActionCommit[],
  suffix: string
) {
  const first = commits[0];
  if (first === undefined) throw new Error("At least one commit is required.");
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${first.tenantId}, ${`src006-${suffix}`},
        'SRC006 reconciliation integration', 'saas_shared'
      )
    `);
    const seenAccounts = new Set<string>();
    const connectionByAccount = new Map<string, string>();
    const seenBindings = new Set<string>();
    const seenEvents = new Set<string>();
    const seenOccurrences = new Set<string>();
    const seenThreads = new Set<string>();
    const seenActors = new Set<string>();
    for (const [ordinal, commit] of commits.entries()) {
      const action = commit.before;
      const accountId = action.semanticProof.sourceAccount.id;
      const bindingId = action.semanticProof.sourceThreadBinding.id;
      const threadId = action.externalMessageKey.externalThread.id;
      const connectionId =
        connectionByAccount.get(accountId) ??
        `source_connection:src006-${suffix}-${connectionByAccount.size}`;
      const conversationId = `conversation:src006-${suffix}`;
      if (!seenAccounts.has(accountId)) {
        seenAccounts.add(accountId);
        connectionByAccount.set(accountId, connectionId);
        await transaction.execute(sql`
          insert into source_connections (
            id, tenant_id, source_type, source_name, display_name,
            status, auth_type, capabilities, config, diagnostics, metadata
          ) values (
            ${connectionId}, ${action.tenantId}, 'messenger', 'synthetic',
            'SRC006 source connection', 'active', 'custom', '{}'::jsonb,
            '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
          )
        `);
        await transaction.execute(sql`
          insert into source_accounts (
            id, tenant_id, source_connection_id, account_type,
            display_name, status, metadata
          ) values (
            ${accountId}, ${action.tenantId}, ${connectionId},
            'direct_number', 'SRC006 source account', 'active', '{}'::jsonb
          )
        `);
      }
      if (!seenThreads.has(threadId)) {
        seenThreads.add(threadId);
        const adapter = action.sourceOccurrence.descriptor.adapterContract;
        const declaration = {
          adapterContract: adapter,
          identityKind: "external_thread",
          realmId: "module:synthetic:src006-thread-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1",
          objectKindId: "module:synthetic:src006-thread",
          scopeKind: "provider",
          decisionStrength: "authoritative"
        };
        await transaction.execute(sql`
          insert into inbox_v2_external_threads (
            tenant_id, id, key_registry_id, key_registry_entry_kind,
            realm_id, realm_version, canonicalization_version,
            scope_kind, scope_owner_key, object_kind_id,
            canonical_external_subject, identity_declaration,
            conversation_id, conversation_transport,
            conversation_topology, revision, created_at, updated_at
          ) values (
            ${action.tenantId}, ${threadId},
            ${`external_thread_key_registry:src006-${suffix}`}, 'canonical',
            'module:synthetic:src006-thread-realm', 'v1', 'v1',
            'provider', 'provider', 'module:synthetic:src006-thread',
            'SRC006-Thread', ${JSON.stringify(declaration)}::jsonb,
            ${conversationId}, 'external', 'group', 1,
            ${new Date(action.createdAt)}, ${new Date(action.createdAt)}
          )
        `);
      }
      if (!seenBindings.has(bindingId)) {
        seenBindings.add(bindingId);
        await transaction.execute(sql`
          insert into inbox_v2_source_thread_bindings (
            tenant_id, id, external_thread_id, source_connection_id,
            source_account_id, created_at
          ) values (
            ${action.tenantId}, ${bindingId}, ${threadId}, ${connectionId},
            ${accountId}, ${new Date(action.createdAt)}
          )
        `);
      }
      const occurrence = action.sourceOccurrence;
      if (
        occurrence.providerActor?.kind === "source_external_identity" &&
        !seenActors.has(occurrence.providerActor.sourceExternalIdentity.id)
      ) {
        seenActors.add(occurrence.providerActor.sourceExternalIdentity.id);
        await seedSourceActorIdentity(transaction, occurrence);
      }
      if (occurrence.origin.kind === "provider_response") {
        throw new Error("SRC006 ordering fixtures must be event-backed.");
      }
      const normalizedId = occurrence.origin.normalizedInboundEvent.id;
      if (!seenEvents.has(normalizedId)) {
        seenEvents.add(normalizedId);
        await transaction.execute(sql`
          insert into raw_inbound_events (
            id, tenant_id, source_connection_id, source_account_id,
            idempotency_key, payload, headers, processing_status,
            received_at, created_at, updated_at
          ) values (
            ${occurrence.origin.rawInboundEvent.id}, ${action.tenantId},
            ${connectionId}, ${accountId},
            ${`src006-raw-${suffix}-${ordinal}`}, '{}'::jsonb, '{}'::jsonb,
            'processed', ${new Date(action.recordedAt)},
            ${new Date(action.recordedAt)}, ${new Date(action.recordedAt)}
          )
          on conflict (id) do nothing
        `);
        await transaction.execute(sql`
          insert into normalized_inbound_events (
            id, tenant_id, raw_event_id, source_connection_id,
            source_account_id, source_type, source_name, event_type,
            direction, visibility, payload_version, normalized_payload,
            reply_capability, idempotency_key, processing_status,
            created_at, updated_at
          ) values (
            ${normalizedId}, ${action.tenantId},
            ${occurrence.origin.rawInboundEvent.id}, ${connectionId},
            ${accountId}, 'messenger', 'synthetic', 'receipt', 'inbound',
            'private', 'v1', '{}'::jsonb, '{}'::jsonb,
            ${`src006-normalized-${suffix}-${ordinal}`}, 'processed',
            ${new Date(action.recordedAt)}, ${new Date(action.recordedAt)}
          )
          on conflict (id) do nothing
        `);
      }
      if (!seenOccurrences.has(occurrence.id)) {
        seenOccurrences.add(occurrence.id);
        await seedSourceOccurrence(
          transaction,
          action.sourceOccurrence,
          connectionId,
          conversationId
        );
      }
    }
    const target = commits
      .map((commit) => commit.targetExternalMessageReference)
      .find(
        (candidate): candidate is InboxV2ExternalMessageReference =>
          candidate !== null
      );
    if (target !== undefined) {
      await seedExternalTarget(transaction, target, suffix);
    }
    await transaction.execute(sql`set local session_replication_role = origin`);
    const registeredDigests = new Set<string>();
    for (const commit of commits) {
      const keyDigest = computeInboxV2ExternalMessageKeyDigest(
        commit.before.externalMessageKey
      );
      if (registeredDigests.has(keyDigest)) continue;
      registeredDigests.add(keyDigest);
      await expect(
        registerInboxV2SourceMessageKeyInTransaction(rawExecutor(transaction), {
          tenantId: commit.tenantId,
          keyDigest,
          externalMessageKey: commit.before.externalMessageKey
        })
      ).resolves.toMatch(/registered|already_exists/u);
    }
  });
}

async function seedSourceOccurrence(
  transaction: unknown,
  occurrence: InboxV2DeferredMessageSourceAction["sourceOccurrence"],
  connectionId: string,
  conversationId: string
) {
  const executor = rawExecutor(transaction);
  if (
    occurrence.origin.kind === "provider_response" ||
    occurrence.resolution.state !== "pending"
  ) {
    throw new Error("Expected pending event-backed source occurrence.");
  }
  const key = occurrence.messageKey;
  const keyScope = messageScopeColumns(key.scope);
  const adapter = occurrence.descriptor.adapterContract;
  const actor = occurrence.providerActor;
  const diagnostic = occurrence.resolution.diagnostic;
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
      provider_actor_kind, provider_actor_source_external_identity_id,
      provider_system_actor_kind_id, provider_system_actor_subject,
      direction, descriptor_schema_id, descriptor_version,
      capability_revision, provider_reference_count,
      descriptor_digest_sha256, provider_timestamp_count,
      reference_portability_kind,
      reference_portability_decision_strength, resolution_state,
      resolution_candidate_count, resolution_diagnostic_code_id,
      resolution_diagnostic_retryable,
      resolution_diagnostic_correlation_token,
      resolution_diagnostic_safe_operator_hint_id,
      materialized_by_trusted_service_id,
      materialization_authorization_token, observed_at, recorded_at,
      revision, created_at, updated_at
    ) values (
      ${occurrence.tenantId}, ${occurrence.id}, ${conversationId},
      ${key.externalThread.id}, 1, ${connectionId},
      ${occurrence.bindingContext.sourceAccount.id},
      ${occurrence.bindingContext.sourceThreadBinding.id}, 1,
      ${BigInt(occurrence.bindingContext.bindingGeneration)}, 1, 1,
      ${"9".repeat(64)}, ${key.realm.realmId}, ${key.realm.realmVersion},
      ${key.realm.canonicalizationVersion}, ${keyScope.kind},
      ${keyScope.sourceAccountId}, ${keyScope.sourceThreadBindingId},
      ${key.objectKindId}, ${key.canonicalExternalSubject},
      ${adapter.contractId}, ${adapter.contractVersion},
      ${BigInt(adapter.declarationRevision)}, ${adapter.surfaceId},
      ${adapter.loadedByTrustedServiceId}, ${new Date(adapter.loadedAt)},
      ${occurrence.messageIdentityDeclaration.decisionStrength},
      ${occurrence.origin.kind}, ${occurrence.origin.rawInboundEvent.id},
      ${occurrence.origin.normalizedInboundEvent.id}, ${actor?.kind ?? null},
      ${
        actor?.kind === "source_external_identity"
          ? actor.sourceExternalIdentity.id
          : null
      },
      ${actor?.kind === "provider_system" ? actor.actorKindId : null},
      ${actor?.kind === "provider_system" ? actor.actorSubject : null},
      ${occurrence.direction}, ${occurrence.descriptor.descriptorSchemaId},
      ${occurrence.descriptor.descriptorVersion},
      ${BigInt(occurrence.descriptor.capabilityRevision)},
      ${occurrence.descriptor.providerReferences.length},
      ${occurrence.descriptor.descriptorDigestSha256},
      ${occurrence.providerTimestamps.length},
      ${occurrence.referencePortability.kind},
      ${occurrence.referencePortability.decisionStrength}, 'pending', 0,
      ${diagnostic.codeId}, ${diagnostic.retryable},
      ${diagnostic.correlationToken}, ${diagnostic.safeOperatorHintId},
      'core:source-runtime', ${`materialization:src006-${occurrence.id}`},
      ${new Date(occurrence.observedAt)}, ${new Date(occurrence.recordedAt)},
      ${BigInt(occurrence.revision)}, ${new Date(occurrence.createdAt)},
      ${new Date(occurrence.updatedAt)}
    )
  `);
  for (const [
    ordinal,
    reference
  ] of occurrence.descriptor.providerReferences.entries()) {
    await executor.execute(sql`
      insert into inbox_v2_source_occurrence_provider_references (
        tenant_id, source_occurrence_id, ordinal, kind_id, subject
      ) values (
        ${occurrence.tenantId}, ${occurrence.id}, ${ordinal},
        ${reference.kindId}, ${reference.subject}
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
        ${occurrence.tenantId}, ${occurrence.id}, ${ordinal},
        ${providerTimestamp.kindId}, ${new Date(providerTimestamp.timestamp)}
      )
    `);
  }
}

async function seedExternalTarget(
  transaction: unknown,
  target: InboxV2ExternalMessageReference,
  suffix: string
) {
  const executor = rawExecutor(transaction);
  const conversationId = `conversation:src006-${suffix}`;
  const scope = messageScopeColumns(target.key.scope);
  await executor.execute(sql`
    insert into inbox_v2_messages (
      tenant_id, id, conversation_id, timeline_item_id,
      author_participant_id, origin_kind, creation_attribution_id,
      content_id, content_revision, content_state, reference_kind,
      lifecycle, revision, last_changed_stream_position, created_at,
      updated_at
    ) values (
      ${target.tenantId}, ${target.message.id}, ${conversationId},
      ${target.timelineItem.id}, ${`conversation_participant:src006-${suffix}`},
      'internal', ${`action_attribution:src006-${suffix}`},
      ${`timeline_content:src006-${suffix}`}, 1, 'available', 'none',
      'active', 1, 1, ${new Date(target.createdAt)},
      ${new Date(target.createdAt)}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_external_message_references (
      tenant_id, id, realm_id, realm_version,
      canonicalization_version, scope_kind, scope_source_account_id,
      scope_source_thread_binding_id, object_kind_id,
      canonical_external_subject, message_key_digest_sha256,
      identity_declaration, external_thread_id, external_thread_revision,
      conversation_id, timeline_item_id, message_id, revision, created_at
    ) values (
      ${target.tenantId}, ${target.id}, ${target.key.realm.realmId},
      ${target.key.realm.realmVersion},
      ${target.key.realm.canonicalizationVersion}, ${scope.kind},
      ${scope.sourceAccountId}, ${scope.sourceThreadBindingId},
      ${target.key.objectKindId}, ${target.key.canonicalExternalSubject},
      ${computeInboxV2ExternalMessageKeyDigest(target.key)},
      ${JSON.stringify(target.identityDeclaration)}::jsonb,
      ${target.externalThread.id}, 1, ${conversationId},
      ${target.timelineItem.id}, ${target.message.id}, 1,
      ${new Date(target.createdAt)}
    )
  `);
}

function messageScopeColumns(
  scope: InboxV2DeferredMessageSourceAction["externalMessageKey"]["scope"]
) {
  return {
    kind: scope.kind,
    sourceAccountId: scope.kind === "source_account" ? scope.owner.id : null,
    sourceThreadBindingId:
      scope.kind === "source_thread_binding" ? scope.owner.id : null
  };
}

async function purgeSyntheticTenant(db: HuleeDatabase, tenantId: string) {
  await db.transaction(async (transaction) => {
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
        cleanup_tenant text := current_setting('hulee.test_cleanup_tenant');
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
            'delete from public.%I where tenant_id = $1', cleanup_table
          ) using cleanup_tenant;
        end loop;
        delete from public.tenants where id = cleanup_tenant;
      end
      $cleanup$
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function settlesWithin(promise: Promise<unknown>, milliseconds: number) {
  return Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) =>
      setTimeout(() => resolve(false), milliseconds)
    )
  ]);
}

function rawExecutor(executor: unknown): RawSqlExecutor {
  return executor as RawSqlExecutor;
}

function failFifthCommitStatementAfterVerifyingWrites(
  executor: RawSqlExecutor,
  commit: InboxV2DeferredMessageSourceActionCommit
): RawSqlExecutor {
  let statementNumber = 0;
  return {
    async execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      statementNumber += 1;
      // read action, read head, insert transition, insert head, update action.
      if (statementNumber === 5) {
        const written = await executor.execute<{
          transition_count: string;
          head_count: string;
        }>(sql`
          select
            (
              select count(*)::text
              from inbox_v2_deferred_message_source_action_transitions
              where tenant_id = ${commit.tenantId}
                and action_id = ${commit.before.id}
            ) as transition_count,
            (
              select count(*)::text
              from inbox_v2_deferred_source_action_ordering_heads
              where tenant_id = ${commit.tenantId}
            ) as head_count
        `);
        expect(written.rows[0]).toEqual({
          transition_count: "1",
          head_count: "1"
        });
        throw new Error("src006.injected_late_action_write_failure");
      }
      return executor.execute<Row>(query);
    }
  };
}
