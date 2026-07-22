import { createHash } from "node:crypto";

import {
  inboxV2CatalogIdSchema,
  inboxV2DeferredMessageSourceActionSchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2MessageTransportOccurrenceLinkSchema,
  inboxV2SourceMessageReconciliationPlanSchema,
  type InboxV2DeferredMessageSourceAction,
  type InboxV2ExternalMessageReference,
  type InboxV2MessageTransportOccurrenceLink,
  type InboxV2SourceMessageReconciliationPlan,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2TrustedSourceMessageReconciliationMaterializer,
  type InboxV2SourceMessageNamespaceDeriver
} from "../../../../apps/worker/src/source-message-reconciliation-materializer";
import {
  makeMessageReconciliationDescriptor,
  makeResolvedReconciliationContext,
  reconciliationT5
} from "../../../../apps/worker/src/source-message-reconciliation.test-support";
import {
  buildInsertInboxV2SourceMessageKeyRegistrySql,
  buildInsertInboxV2SourceMessageWeakCorrelationEvidenceSql,
  buildListPendingInboxV2DeferredMessageSourceActionsSql,
  buildReadInboxV2SourceMessageKeyRegistrySql,
  classifyInboxV2DeferredSourceActionOrdering,
  classifyInboxV2ExternalMessageReferenceCandidates,
  compareCanonicalInboxV2ProviderPosition,
  createSqlInboxV2SourceMessageReconciliationRepository,
  sameInboxV2ExternalMessageKey,
  type InboxV2SourceMessageReconciliationCallbacks,
  type InboxV2SourceMessageReconciliationTransactionExecutor,
  type PersistInboxV2DeferredMessageSourceActionResult
} from "./sql-inbox-v2-source-message-reconciliation-repository";
import { computeInboxV2ExternalMessageKeyDigest } from "./sql-inbox-v2-outbound-transport-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  deferredNormalizedEvent,
  makeDeferredOrderingHead,
  makePendingDeferredAction
} from "./sql-inbox-v2-source-message-reconciliation-repository.test-support";

const namespaceDeriver: InboxV2SourceMessageNamespaceDeriver = {
  namespaceGeneration: "namespace-generation-v1",
  deriveNamespaceHmacSha256(input) {
    return createHash("sha256")
      .update(`${input.purpose}\0${input.canonicalPreimage}`, "utf8")
      .digest("hex");
  }
};

const materializer =
  createInboxV2TrustedSourceMessageReconciliationMaterializer({
    trustedServiceId: "core:source-runtime",
    namespaceDeriver,
    clock: { now: () => reconciliationT5 }
  });

describe("SQL Inbox V2 source-message reconciliation repository", () => {
  it("compares the full exact key and fails closed on digest/candidate collisions", () => {
    const plan = makePlan("message_create", "a", "Case-Sensitive-42");
    const exactReference = candidateReference(plan);
    const changedCase = inboxV2ExternalMessageReferenceSchema.parse({
      ...exactReference,
      id: `${exactReference.id}-case`,
      key: {
        ...exactReference.key,
        canonicalExternalSubject: "case-sensitive-42"
      }
    });
    const changedScope = inboxV2ExternalMessageReferenceSchema.parse({
      ...exactReference,
      id: `${exactReference.id}-scope`,
      key: {
        ...exactReference.key,
        scope: {
          kind: "source_account" as const,
          owner: plan.context.plan.source.sourceAccount
        }
      },
      identityDeclaration: {
        ...exactReference.identityDeclaration,
        scopeKind: "source_account",
        decisionStrength: "safe_default"
      }
    });
    const candidateIdCollision = inboxV2ExternalMessageReferenceSchema.parse({
      ...changedCase,
      id: plan.candidateExternalMessageReferenceId
    });

    expect(
      sameInboxV2ExternalMessageKey(exactReference.key, plan.messageKey)
    ).toBe(true);
    expect(
      sameInboxV2ExternalMessageKey(changedCase.key, plan.messageKey)
    ).toBe(false);
    expect(
      sameInboxV2ExternalMessageKey(changedScope.key, plan.messageKey)
    ).toBe(false);
    expect(
      classifyInboxV2ExternalMessageReferenceCandidates({
        plan,
        candidates: [changedCase]
      })
    ).toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.message_key_digest_collision"
    });
    expect(
      classifyInboxV2ExternalMessageReferenceCandidates({
        plan,
        candidates: [candidateIdCollision]
      })
    ).toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.candidate_reference_conflict"
    });
    expect(
      classifyInboxV2ExternalMessageReferenceCandidates({
        plan,
        candidates: [exactReference, changedScope]
      })
    ).toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.external_reference_conflict"
    });
  });

  it("classifies advance/stale/exact replay/semantic duplicate/equal conflict without bigint overflow", () => {
    const canonical = makePendingDeferredAction(
      {
        kind: "delivery",
        fact: "delivered",
        normalizedEvent: deferredNormalizedEvent("canonical")
      },
      { id: "deferred_message_source_action:canonical", position: "10" }
    );
    const head = makeDeferredOrderingHead(canonical);
    const actionAt = (
      id: string,
      position: string,
      fingerprint: string,
      semanticIdChange = false
    ) => {
      const action = makePendingDeferredAction(
        {
          kind: "delivery",
          fact: semanticIdChange ? "sent" : "delivered",
          normalizedEvent: deferredNormalizedEvent(id)
        },
        {
          id: `deferred_message_source_action:${id}`,
          occurrenceId: `source_occurrence:${id}`,
          position,
          fingerprint
        }
      );
      return action;
    };

    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: actionAt("advance", "11", "b".repeat(64)),
        currentHead: head
      })
    ).toEqual({ kind: "advance" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: actionAt("stale", "9", "c".repeat(64)),
        currentHead: head
      })
    ).toMatchObject({ kind: "stale" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: canonical,
        currentHead: head
      })
    ).toEqual({ kind: "already_exists" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: inboxV2DeferredMessageSourceActionSchema.parse({
          ...canonical,
          id: `${canonical.id}-tampered`
        }),
        currentHead: head
      })
    ).toMatchObject({ kind: "conflict" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: actionAt("semantic-duplicate", "10", "a".repeat(64)),
        currentHead: head
      })
    ).toMatchObject({ kind: "duplicate" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: actionAt("equal-conflict", "10", "d".repeat(64), true),
        currentHead: head
      })
    ).toMatchObject({ kind: "conflict" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: inboxV2DeferredMessageSourceActionSchema.parse({
          ...canonical,
          id: "deferred_message_source_action:ordering-unavailable",
          semanticProof: {
            ...canonical.semanticProof,
            ordering: {
              kind: "unavailable",
              reasonId: inboxV2CatalogIdSchema.parse(
                "core:provider-ordering-unavailable"
              )
            }
          }
        }),
        currentHead: head
      })
    ).toMatchObject({ kind: "conflict" });

    const maximum = `1${"0".repeat(127)}`;
    expect(compareCanonicalInboxV2ProviderPosition(maximum, "9")).toBe(1);
    expect(compareCanonicalInboxV2ProviderPosition(maximum, maximum)).toBe(0);
    expect(() =>
      compareCanonicalInboxV2ProviderPosition(`1${"0".repeat(128)}`, "9")
    ).toThrow("bounded canonical non-negative decimals");
  });

  it("orders reaction replay, stale, duplicate, conflict and advance by provider position", () => {
    const reactionAt = (
      id: string,
      position: string,
      fingerprint: string,
      operation: "set" | "replace" | "clear" = "set"
    ) =>
      makePendingDeferredAction(
        {
          kind: "reaction",
          operation,
          value:
            operation === "clear"
              ? null
              : {
                  kind: "unicode" as const,
                  value: operation === "set" ? "👍" : "🔥"
                },
          normalizedEvent: deferredNormalizedEvent(`reaction-${id}`)
        },
        {
          id: `deferred_message_source_action:reaction-${id}`,
          occurrenceId: `source_occurrence:reaction-${id}`,
          position,
          fingerprint
        }
      );
    const canonical = reactionAt("canonical", "10", "a".repeat(64));
    const head = makeDeferredOrderingHead(canonical);

    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: canonical,
        currentHead: head
      })
    ).toEqual({ kind: "already_exists" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: reactionAt("stale", "9", "b".repeat(64), "clear"),
        currentHead: head
      })
    ).toMatchObject({ kind: "stale" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: reactionAt("duplicate", "10", "a".repeat(64)),
        currentHead: head
      })
    ).toMatchObject({ kind: "duplicate" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: reactionAt("conflict", "10", "c".repeat(64), "replace"),
        currentHead: head
      })
    ).toMatchObject({ kind: "conflict" });
    expect(
      classifyInboxV2DeferredSourceActionOrdering({
        action: reactionAt("advance", "11", "d".repeat(64), "replace"),
        currentHead: head
      })
    ).toEqual({ kind: "advance" });
  });

  it("renders bounded exact-key pending queries and target-free finite weak evidence", () => {
    const sourcePlan = makePlan("source_action", "a", "Message:Exact-42", {
      weakEvidence: true
    });
    if (sourcePlan.intent.kind !== "source_action") {
      throw new Error("Expected source-action plan.");
    }
    const digest = computeInboxV2ExternalMessageKeyDigest(
      sourcePlan.messageKey
    );
    const pending = render(
      buildListPendingInboxV2DeferredMessageSourceActionsSql({
        tenantId: sourcePlan.sourceOccurrence.tenantId,
        externalMessageKey: sourcePlan.messageKey,
        keyDigest: digest,
        afterActionId: null,
        limit: 25
      })
    );
    const registryInsert = render(
      buildInsertInboxV2SourceMessageKeyRegistrySql({
        tenantId: sourcePlan.sourceOccurrence.tenantId,
        externalMessageKey: sourcePlan.messageKey
      })
    );
    const registryRead = render(
      buildReadInboxV2SourceMessageKeyRegistrySql({
        tenantId: sourcePlan.sourceOccurrence.tenantId,
        keyDigest: digest
      })
    );
    const evidence = render(
      buildInsertInboxV2SourceMessageWeakCorrelationEvidenceSql(sourcePlan, 0)
    );

    expect(normalizeSql(pending.sql)).toContain(
      "external_message_key_detail = $3::jsonb"
    );
    expect(normalizeSql(pending.sql)).toContain("limit $6 for share");
    expect(pending.params).toContain(26);
    expect(normalizeSql(registryInsert.sql)).toContain(
      "insert into public.inbox_v2_source_message_key_registry"
    );
    expect(normalizeSql(registryInsert.sql)).toContain(
      "on conflict do nothing returning message_key_digest_sha256"
    );
    expect(normalizeSql(registryRead.sql)).toContain(
      "from public.inbox_v2_source_message_key_registry where tenant_id = $1 and message_key_digest_sha256 = $2 limit 1 for share"
    );
    expect(normalizeSql(registryRead.sql)).not.toContain(
      "inbox_v2_deferred_message_source_actions"
    );
    expect(normalizeSql(evidence.sql)).toContain(
      "where $8 > transaction_timestamp()"
    );
    expect(normalizeSql(evidence.sql)).toContain(
      "'core:operational_log_trace_diagnostic', 'security_evidence', 'core:source_replay_and_diagnostics', 'core:creation', 'hard_delete'"
    );
    expect(evidence.sql).not.toMatch(
      /message_id|external_message_reference_id|outbound_dispatch/iu
    );
  });

  it("rejects an unauthorized plan before opening a transaction", async () => {
    const state = makeState(makePlan("message_create", "a"));
    const executor = new MemoryTransactionExecutor(state);
    const repository = makeRepository(state, executor, undefined, false);

    await expect(
      repository.reconcile({ plan: makePlan("message_create", "a") })
    ).rejects.toMatchObject({ code: "permission.denied" });
    expect(executor.transactionCalls).toBe(0);
  });

  it("creates once and attaches a distinct occurrence with the same exact key", async () => {
    const first = makePlan("message_create", "a");
    const second = makePlan("message_create", "b");
    const state = makeState(first, second);
    const executor = new MemoryTransactionExecutor(state);
    const callbacks = defaultCallbacks(state);
    const repository = makeRepository(state, executor, callbacks);

    await expect(repository.reconcile({ plan: first })).resolves.toMatchObject({
      kind: "message_created",
      deferredDrain: { processedActionIds: [], hasMore: false }
    });
    await expect(repository.reconcile({ plan: first })).resolves.toMatchObject({
      kind: "already_reconciled",
      externalMessageReference: {
        id: first.candidateExternalMessageReferenceId
      },
      sourceOccurrence: { id: first.sourceOccurrence.id }
    });
    expect(state.references).toHaveLength(1);
    await expect(repository.reconcile({ plan: second })).resolves.toMatchObject(
      {
        kind: "occurrence_attached",
        externalMessageReference: {
          id: first.candidateExternalMessageReferenceId
        }
      }
    );
    expect(state.references).toHaveLength(1);
    expect(
      state.occurrences.get(second.sourceOccurrence.id)?.resolution.state
    ).toBe("resolved");
  });

  it("rolls back a canonical create callback that resolves without its exact transport link", async () => {
    const plan = makePlan("message_create", "missing-link");
    if (plan.intent.kind !== "message_create") {
      throw new Error("Expected message-create plan.");
    }
    const state = makeState(plan);
    const executor = new MemoryTransactionExecutor(state);
    const callbacks = defaultCallbacks(state, {
      async createMessage(_transaction, input) {
        state.references.push(input.candidateExternalMessageReference);
        const occurrence = resolveOccurrence(
          input.plan.sourceOccurrence,
          input.candidateExternalMessageReference,
          input.plan.materializedAt
        );
        state.occurrences.set(occurrence.id, occurrence);
        return {
          kind: "committed",
          result: {
            externalMessageReference: input.candidateExternalMessageReference,
            sourceOccurrence: occurrence
          }
        };
      }
    });

    await expect(
      makeRepository(state, executor, callbacks).reconcile({ plan })
    ).resolves.toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict",
      retainedOccurrence: plan.sourceOccurrence
    });
    expect(state.references).toHaveLength(0);
    expect(state.transportLinks).toHaveLength(0);
    expect(state.occurrences.get(plan.sourceOccurrence.id)).toEqual(
      plan.sourceOccurrence
    );
    expect(executor.rollbackCount).toBe(1);
  });

  it("fails closed when an exact-reuse callback persists a tampered transport link", async () => {
    const first = makePlan("message_create", "link-first");
    const second = makePlan("message_create", "link-second");
    const state = makeState(first, second);
    await makeRepository(state, new MemoryTransactionExecutor(state)).reconcile(
      { plan: first }
    );
    const executor = new MemoryTransactionExecutor(state);
    const callbacks = defaultCallbacks(state, {
      async attachOccurrence(_transaction, input) {
        const occurrence = resolveOccurrence(
          input.plan.sourceOccurrence,
          input.targetExternalMessageReference,
          input.plan.materializedAt
        );
        state.occurrences.set(occurrence.id, occurrence);
        state.transportLinks.push(
          transportLinkForPlan(
            input.plan,
            input.targetExternalMessageReference,
            "provider_echo"
          )
        );
        return {
          kind: "committed",
          result: {
            externalMessageReference: input.targetExternalMessageReference,
            sourceOccurrence: occurrence
          }
        };
      }
    });

    await expect(
      makeRepository(state, executor, callbacks).reconcile({ plan: second })
    ).resolves.toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict",
      retainedOccurrence: second.sourceOccurrence
    });
    expect(state.transportLinks).toHaveLength(1);
    expect(state.occurrences.get(second.sourceOccurrence.id)).toEqual(
      second.sourceOccurrence
    );
    expect(executor.rollbackCount).toBe(1);
  });

  it("rejects terminal replay when its exact transport link is missing", async () => {
    const plan = makePlan("message_create", "replay-link");
    const state = makeState(plan);
    const repository = makeRepository(
      state,
      new MemoryTransactionExecutor(state)
    );
    await expect(repository.reconcile({ plan })).resolves.toMatchObject({
      kind: "message_created"
    });
    state.transportLinks = [];

    await expect(repository.reconcile({ plan })).resolves.toMatchObject({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict"
    });
  });

  it("rolls back when create publishes the right ID/key with a different canonical target", async () => {
    const plan = makePlan("message_create", "a");
    const state = makeState(plan);
    const executor = new MemoryTransactionExecutor(state);
    const callbacks = defaultCallbacks(state, {
      async createMessage(_transaction, input) {
        const wrong = {
          ...input.candidateExternalMessageReference,
          message: {
            ...input.candidateExternalMessageReference.message,
            id: `${input.candidateExternalMessageReference.message.id}-wrong`
          }
        } as InboxV2ExternalMessageReference;
        state.references.push(wrong);
        const occurrence = resolveOccurrence(
          input.plan.sourceOccurrence,
          input.candidateExternalMessageReference,
          input.plan.materializedAt
        );
        state.occurrences.set(occurrence.id, occurrence);
        return {
          kind: "committed",
          result: {
            externalMessageReference: input.candidateExternalMessageReference,
            sourceOccurrence: occurrence
          }
        };
      }
    });

    await expect(
      makeRepository(state, executor, callbacks).reconcile({ plan })
    ).resolves.toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict",
      retainedOccurrence: plan.sourceOccurrence
    });
    expect(state.references).toHaveLength(0);
    expect(executor.rollbackCount).toBe(1);
  });

  it("retains an echo/response occurrence when the exact reference has not arrived", async () => {
    const plan = makePlan("echo_handoff", "a");
    const state = makeState(plan);
    const repository = makeRepository(
      state,
      new MemoryTransactionExecutor(state)
    );

    await expect(repository.reconcile({ plan })).resolves.toEqual({
      kind: "echo_handoff_pending",
      messageKey: plan.messageKey,
      candidateExternalMessageReferenceId:
        plan.candidateExternalMessageReferenceId,
      retainedOccurrence: plan.sourceOccurrence
    });
  });

  it("lets an exact outbound correlation settle an echo before its reference arrives", async () => {
    const plan = makePlan("echo_handoff", "correlated-before-response");
    if (plan.intent.kind !== "echo_handoff") {
      throw new Error("Expected echo-handoff plan.");
    }
    const state = makeState(plan);
    const reference = candidateReference(plan);
    const callbacks = defaultCallbacks(state, {
      async resolveProviderEcho(_transaction, input) {
        expect(input.plan.sourceOccurrence.id).toBe(plan.sourceOccurrence.id);
        state.references.push(reference);
        const occurrence = resolveOccurrence(
          input.plan.sourceOccurrence,
          reference,
          input.plan.materializedAt
        );
        state.occurrences.set(occurrence.id, occurrence);
        state.transportLinks.push(
          transportLinkForPlan(input.plan, reference, "provider_echo")
        );
        return {
          kind: "committed",
          result: {
            externalMessageReference: reference,
            sourceOccurrence: occurrence
          }
        };
      }
    });
    const repository = makeRepository(
      state,
      new MemoryTransactionExecutor(state),
      callbacks
    );

    await expect(repository.reconcile({ plan })).resolves.toMatchObject({
      kind: "echo_handoff",
      externalMessageReference: { id: reference.id },
      sourceOccurrence: { id: plan.sourceOccurrence.id }
    });
    expect(state.references).toEqual([reference]);
    expect(state.transportLinks).toHaveLength(1);
  });

  it("routes an exact echo through provider settlement even when a response already created its reference", async () => {
    const plan = makePlan("echo_handoff", "response-before-echo");
    if (plan.intent.kind !== "echo_handoff") {
      throw new Error("Expected echo-handoff plan.");
    }
    const state = makeState(plan);
    const reference = candidateReference(plan);
    state.references.push(reference);
    const resolveProviderEcho = vi.fn(async () => ({
      kind: "pending" as const
    }));
    const attachOccurrence = vi.fn(async () => {
      throw new Error("Exact provider echo must not use generic attachment.");
    });
    const callbacks = defaultCallbacks(state, {
      resolveProviderEcho,
      attachOccurrence
    });
    const repository = makeRepository(
      state,
      new MemoryTransactionExecutor(state),
      callbacks
    );

    await expect(repository.reconcile({ plan })).resolves.toEqual({
      kind: "echo_handoff_pending",
      messageKey: plan.messageKey,
      candidateExternalMessageReferenceId:
        plan.candidateExternalMessageReferenceId,
      retainedOccurrence: plan.sourceOccurrence
    });
    expect(resolveProviderEcho).toHaveBeenCalledOnce();
    expect(attachOccurrence).not.toHaveBeenCalled();
    expect(state.references).toEqual([reference]);
    expect(state.transportLinks).toHaveLength(0);
    expect(state.occurrences.get(plan.sourceOccurrence.id)).toEqual(
      plan.sourceOccurrence
    );
  });

  it("induces an existing-target source action before invoking its terminal callback", async () => {
    const plan = makePlan("source_action", "a");
    if (plan.intent.kind !== "source_action") {
      throw new Error("Expected source action.");
    }
    const state = makeState(plan);
    const reference = candidateReference(plan);
    state.references.push(reference);
    const callbacks = defaultCallbacks(state, {
      async applySourceAction(_transaction, input) {
        const durable = state.actions.get(input.plan.intent.deferredAction.id);
        expect(durable?.state.state).toBe("pending");
        const terminal = expireAction(input.plan.intent.deferredAction);
        state.actions.set(terminal.id, terminal);
        return {
          kind: "committed",
          result: {
            externalMessageReference: reference,
            sourceOccurrence: input.plan.sourceOccurrence,
            deferredAction: terminal
          }
        };
      }
    });
    const repository = makeRepository(
      state,
      new MemoryTransactionExecutor(state),
      callbacks
    );

    await expect(repository.reconcile({ plan })).resolves.toMatchObject({
      kind: "source_action_processed",
      deferredAction: { state: { state: "expired" } }
    });
  });

  it("replays one exact terminal source action without invoking its effect callback", async () => {
    const plan = makePlan("source_action", "terminal-exact");
    if (plan.intent.kind !== "source_action") {
      throw new Error("Expected source action.");
    }
    const state = makeState(plan);
    const reference = candidateReference(plan);
    const terminal = applyAction(plan.intent.deferredAction, reference);
    state.references.push(reference);
    state.actions.set(terminal.id, terminal);
    state.occurrences.set(
      plan.sourceOccurrence.id,
      resolveOccurrence(plan.sourceOccurrence, reference, reconciliationT5)
    );
    const apply = vi.fn();
    const repository = makeRepository(
      state,
      new MemoryTransactionExecutor(state),
      defaultCallbacks(state, { applySourceAction: apply as never })
    );

    await expect(repository.reconcile({ plan })).resolves.toEqual({
      kind: "source_action_processed",
      externalMessageReference: reference,
      sourceOccurrence: state.occurrences.get(plan.sourceOccurrence.id),
      deferredAction: terminal
    });
    expect(apply).not.toHaveBeenCalled();
    expect([...state.actions.values()]).toEqual([terminal]);
  });

  it("fails closed when a terminal occurrence is replayed with changed action facts or candidate id", async () => {
    const plan = makePlan("source_action", "terminal-tampered");
    if (
      plan.intent.kind !== "source_action" ||
      plan.intent.deferredAction.action.kind !== "edit"
    ) {
      throw new Error("Expected edit source action.");
    }
    const reference = candidateReference(plan);
    const terminal = applyAction(plan.intent.deferredAction, reference);
    const changedFacts = inboxV2SourceMessageReconciliationPlanSchema.parse({
      ...plan,
      intent: {
        ...plan.intent,
        deferredAction: {
          ...plan.intent.deferredAction,
          action: {
            ...plan.intent.deferredAction.action,
            normalizedContentDigestSha256: "f".repeat(64)
          }
        }
      }
    });
    const changedId = `${plan.intent.candidateDeferredActionId}-changed`;
    const changedCandidate = inboxV2SourceMessageReconciliationPlanSchema.parse(
      {
        ...plan,
        intent: {
          ...plan.intent,
          candidateDeferredActionId: changedId,
          deferredAction: {
            ...plan.intent.deferredAction,
            id: changedId
          }
        }
      }
    );

    for (const replay of [changedFacts, changedCandidate]) {
      const state = makeState(plan);
      state.references.push(reference);
      state.actions.set(terminal.id, terminal);
      state.occurrences.set(
        plan.sourceOccurrence.id,
        resolveOccurrence(plan.sourceOccurrence, reference, reconciliationT5)
      );
      const apply = vi.fn();
      await expect(
        makeRepository(
          state,
          new MemoryTransactionExecutor(state),
          defaultCallbacks(state, { applySourceAction: apply as never })
        ).reconcile({ plan: replay })
      ).resolves.toMatchObject({
        kind: "conflict",
        code: "source.message_reconciliation.deferred_action_conflict"
      });
      expect(apply).not.toHaveBeenCalled();
      expect([...state.actions.values()]).toEqual([terminal]);
    }
  });

  it("does not induce a missing action after its occurrence became terminal", async () => {
    const plan = makePlan("source_action", "terminal-missing");
    if (plan.intent.kind !== "source_action") {
      throw new Error("Expected source action.");
    }
    const state = makeState(plan);
    const reference = candidateReference(plan);
    state.references.push(reference);
    state.occurrences.set(
      plan.sourceOccurrence.id,
      resolveOccurrence(plan.sourceOccurrence, reference, reconciliationT5)
    );
    const apply = vi.fn();

    await expect(
      makeRepository(
        state,
        new MemoryTransactionExecutor(state),
        defaultCallbacks(state, { applySourceAction: apply as never })
      ).reconcile({ plan })
    ).resolves.toMatchObject({
      kind: "conflict",
      code: "source.message_reconciliation.deferred_action_conflict"
    });
    expect(apply).not.toHaveBeenCalled();
    expect(state.actions.size).toBe(0);
  });

  it("rolls back a fabricated immediate terminal action not present in SQL", async () => {
    const plan = makePlan("source_action", "a");
    if (plan.intent.kind !== "source_action") {
      throw new Error("Expected source action.");
    }
    const state = makeState(plan);
    const reference = candidateReference(plan);
    state.references.push(reference);
    const executor = new MemoryTransactionExecutor(state);
    const callbacks = defaultCallbacks(state, {
      async applySourceAction(_transaction, input) {
        return {
          kind: "committed",
          result: {
            externalMessageReference: reference,
            sourceOccurrence: input.plan.sourceOccurrence,
            deferredAction: expireAction(input.plan.intent.deferredAction)
          }
        };
      }
    });
    const repository = makeRepository(state, executor, callbacks);

    await expect(repository.reconcile({ plan })).resolves.toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict",
      retainedOccurrence: plan.sourceOccurrence
    });
    expect(state.actions.size).toBe(0);
    expect(executor.rollbackCount).toBe(1);
  });

  it("drains edit/delete before create and converges by provider position", async () => {
    const edit = withDeferredOrdering(
      makePlan("source_action", "b", "Message:Before-Create"),
      {
        id: "deferred_message_source_action:z-edit-before-create",
        position: "10"
      }
    );
    const remove = withDeferredOrdering(
      makeDeletePlan("c", "Message:Before-Create"),
      {
        id: "deferred_message_source_action:a-delete-before-create",
        position: "11"
      }
    );
    const create = makePlan("message_create", "a", "Message:Before-Create");
    const state = makeState(edit, remove, create);
    const executor = new MemoryTransactionExecutor(state);
    const classifyInOrder = (
      actions: readonly InboxV2DeferredMessageSourceAction[]
    ) => {
      let head: ReturnType<typeof makeDeferredOrderingHead> | null = null;
      const classified: Array<{
        action: InboxV2DeferredMessageSourceAction;
        decision: ReturnType<
          typeof classifyInboxV2DeferredSourceActionOrdering
        >;
        actionKind: InboxV2DeferredMessageSourceAction["action"]["kind"];
        position: string;
      }> = [];
      for (const action of actions) {
        const decision = classifyInboxV2DeferredSourceActionOrdering({
          action,
          currentHead: head
        });
        const ordering = action.semanticProof.ordering;
        if (ordering.kind !== "monotonic_exact") {
          throw new Error("Expected exact lifecycle provider ordering.");
        }
        if (decision.kind === "advance") {
          head = makeDeferredOrderingHead(action);
        }
        classified.push({
          action,
          decision,
          actionKind: action.action.kind,
          position: ordering.position
        });
      }
      return {
        classified,
        head: head as ReturnType<typeof makeDeferredOrderingHead> | null
      };
    };
    const drainedOutcomes: Array<{
      actionKind: string;
      position: string;
      decision: string;
    }> = [];
    let drainedHeadActionId: string | null = null;
    const repository = makeRepository(
      state,
      executor,
      defaultCallbacks(state, {
        async drainDeferredActions(_transaction, input) {
          const ordering = classifyInOrder(input.actions);
          drainedHeadActionId = ordering.head?.latest.action.id ?? null;
          const results = ordering.classified.map(
            ({ action, decision, actionKind, position }) => {
              drainedOutcomes.push({
                actionKind,
                position,
                decision: decision.kind
              });
              const terminal =
                decision.kind === "stale"
                  ? inboxV2DeferredMessageSourceActionSchema.parse({
                      ...action,
                      state: {
                        state: "stale",
                        headAction: decision.headAction,
                        staleAt: reconciliationT5
                      },
                      revision: "2",
                      updatedAt: reconciliationT5
                    })
                  : expireAction(action);
              state.actions.set(terminal.id, terminal);
              return {
                externalMessageReference: input.targetExternalMessageReference,
                sourceOccurrence: action.sourceOccurrence,
                deferredAction: terminal
              };
            }
          );
          return { kind: "committed", result: { results } };
        }
      })
    );

    await expect(repository.reconcile({ plan: edit })).resolves.toMatchObject({
      kind: "source_action_deferred"
    });
    await expect(repository.reconcile({ plan: remove })).resolves.toMatchObject(
      {
        kind: "source_action_deferred"
      }
    );
    const created = await repository.reconcile({ plan: create });

    expect(created).toMatchObject({
      kind: "message_created",
      deferredDrain: { hasMore: false }
    });
    if (created.kind !== "message_created") {
      throw new Error("Expected message creation result.");
    }
    if (
      edit.intent.kind !== "source_action" ||
      remove.intent.kind !== "source_action"
    ) {
      throw new Error("Expected source-action plans.");
    }
    expect(created.deferredDrain.processedActionIds).toEqual([
      remove.intent.deferredAction.id,
      edit.intent.deferredAction.id
    ]);
    expect(drainedOutcomes).toEqual([
      { actionKind: "delete", position: "11", decision: "advance" },
      { actionKind: "edit", position: "10", decision: "stale" }
    ]);
    expect(drainedHeadActionId).toBe(remove.intent.deferredAction.id);
    expect(
      classifyInOrder([
        edit.intent.deferredAction,
        remove.intent.deferredAction
      ]).head?.latest.action.id
    ).toBe(remove.intent.deferredAction.id);
    expect(
      state.actions.get(remove.intent.deferredAction.id)?.state.state
    ).toBe("expired");
    expect(state.actions.get(edit.intent.deferredAction.id)?.state.state).toBe(
      "stale"
    );
  });

  it("rolls back create/ref/resolution when drain conflicts and returns pre-write truth", async () => {
    const action = makePlan("source_action", "b", "Message:Rollback");
    const create = makePlan("message_create", "a", "Message:Rollback");
    const state = makeState(action, create);
    const executor = new MemoryTransactionExecutor(state);
    const callbacks = defaultCallbacks(state, {
      async drainDeferredActions() {
        return {
          kind: "conflict",
          code: "source.message_reconciliation.callback_conflict"
        };
      }
    });
    const repository = makeRepository(state, executor, callbacks);
    await repository.reconcile({ plan: action });

    await expect(repository.reconcile({ plan: create })).resolves.toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict",
      retainedOccurrence: create.sourceOccurrence
    });
    expect(state.references).toHaveLength(0);
    expect(state.occurrences.get(create.sourceOccurrence.id)).toEqual(
      create.sourceOccurrence
    );
    expect(state.actions.values().next().value?.state.state).toBe("pending");
    expect(executor.rollbackCount).toBe(1);
  });

  it("rejects an applied drain row when its occurrence was not resolved exactly", async () => {
    const action = makePlan("source_action", "b", "Message:Applied-Drain");
    const create = makePlan("message_create", "a", "Message:Applied-Drain");
    const state = makeState(action, create);
    const executor = new MemoryTransactionExecutor(state);
    const callbacks = defaultCallbacks(state, {
      async drainDeferredActions(_transaction, input) {
        const results = input.actions.map((before) => {
          const applied = {
            ...before,
            state: {
              state: "applied",
              externalMessageReference: {
                tenantId: before.tenantId,
                kind: "external_message_reference",
                id: input.targetExternalMessageReference.id
              },
              message: input.targetExternalMessageReference.message,
              appliedMessageRevision: "1",
              effectKind: "message_lifecycle",
              appliedAt: reconciliationT5
            },
            revision: "2",
            updatedAt: reconciliationT5
          } as InboxV2DeferredMessageSourceAction;
          state.actions.set(applied.id, applied);
          return {
            externalMessageReference: input.targetExternalMessageReference,
            sourceOccurrence: before.sourceOccurrence,
            deferredAction: applied
          };
        });
        return { kind: "committed", result: { results } };
      }
    });
    const repository = makeRepository(state, executor, callbacks);
    await repository.reconcile({ plan: action });

    await expect(repository.reconcile({ plan: create })).resolves.toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict",
      retainedOccurrence: create.sourceOccurrence
    });
    expect(state.references).toHaveLength(0);
    expect(state.actions.values().next().value?.state.state).toBe("pending");
  });

  it("replays a terminal deferred action while its occurrence legitimately stays pending", async () => {
    const plan = makePlan("source_action", "a");
    if (plan.intent.kind !== "source_action") {
      throw new Error("Expected source action.");
    }
    const state = makeState(plan);
    state.references.push(candidateReference(plan));
    state.actions.set(
      plan.intent.deferredAction.id,
      expireAction(plan.intent.deferredAction)
    );
    const apply = vi.fn();
    const repository = makeRepository(
      state,
      new MemoryTransactionExecutor(state),
      defaultCallbacks(state, { applySourceAction: apply as never })
    );

    await expect(repository.reconcile({ plan })).resolves.toMatchObject({
      kind: "source_action_processed",
      sourceOccurrence: { resolution: { state: "pending" } },
      deferredAction: { state: { state: "expired" } }
    });
    expect(apply).not.toHaveBeenCalled();
  });
});

type MemoryState = {
  occurrences: Map<string, InboxV2SourceOccurrence>;
  references: InboxV2ExternalMessageReference[];
  transportLinks: InboxV2MessageTransportOccurrenceLink[];
  actions: Map<string, InboxV2DeferredMessageSourceAction>;
  weakEvidence: Map<string, unknown>;
};

class MemoryTransactionExecutor implements InboxV2SourceMessageReconciliationTransactionExecutor {
  transactionCalls = 0;
  rollbackCount = 0;

  constructor(private readonly state: MemoryState) {}

  async execute<TRow extends Record<string, unknown>>(
    _query: SQL
  ): Promise<RawSqlQueryResult<TRow>> {
    throw new Error("All SQL dependencies must be replaced in memory tests.");
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    this.transactionCalls += 1;
    const snapshot = snapshotState(this.state);
    try {
      return await work(this);
    } catch (error) {
      restoreState(this.state, snapshot);
      this.rollbackCount += 1;
      throw error;
    }
  }
}

function makeRepository(
  state: MemoryState,
  executor: MemoryTransactionExecutor,
  callbacks = defaultCallbacks(state),
  authorized = true
) {
  return createSqlInboxV2SourceMessageReconciliationRepository(executor, {
    planAuthorizationVerifier: { verify: () => authorized },
    callbacks,
    dependencies: {
      computeMessageKeyDigest: computeInboxV2ExternalMessageKeyDigest,
      async acquireMessageKeyLock() {},
      async registerMessageKey() {
        return "already_exists";
      },
      async readOccurrence(_transaction, input) {
        return state.occurrences.get(input.occurrenceId) ?? null;
      },
      async findReferenceCandidates(_transaction, input) {
        return state.references.filter(
          (reference) =>
            reference.id === input.referenceId ||
            computeInboxV2ExternalMessageKeyDigest(reference.key) ===
              input.keyDigest
        );
      },
      async findTransportLinkCandidates(_transaction, input) {
        return state.transportLinks.filter(
          (link) =>
            link.id === input.linkId ||
            link.sourceOccurrence.id === input.sourceOccurrenceId
        );
      },
      async persistDeferredAction(_transaction, action) {
        const canonicalOccurrence = state.occurrences.get(
          action.sourceOccurrence.id
        );
        const existing = state.actions.get(action.id);
        if (existing !== undefined) {
          if (
            existing.state.state === "pending" &&
            canonicalOccurrence?.resolution.state !== "pending"
          ) {
            return { kind: "action_id_conflict" };
          }
          return {
            kind: "already_exists",
            action: existing
          } satisfies PersistInboxV2DeferredMessageSourceActionResult;
        }
        const idempotency = [...state.actions.values()].find(
          (candidate) =>
            JSON.stringify(candidate.idempotencyKey) ===
            JSON.stringify(action.idempotencyKey)
        );
        if (idempotency !== undefined) return { kind: "idempotency_conflict" };
        if (
          canonicalOccurrence === undefined ||
          canonicalOccurrence.resolution.state !== "pending" ||
          JSON.stringify(canonicalOccurrence) !==
            JSON.stringify(action.sourceOccurrence)
        ) {
          return { kind: "action_id_conflict" };
        }
        state.actions.set(action.id, action);
        return { kind: "created", action };
      },
      async persistWeakCorrelationEvidence(_transaction, plan) {
        const key = plan.sourceOccurrence.id;
        const existing = state.weakEvidence.get(key);
        if (existing !== undefined) {
          return JSON.stringify(existing) ===
            JSON.stringify(plan.weakCorrelationEvidence)
            ? "already_exists"
            : "conflict";
        }
        state.weakEvidence.set(key, plan.weakCorrelationEvidence);
        return "created";
      },
      async listPendingActions(_transaction, input) {
        const all = [...state.actions.values()]
          .filter(
            (action) =>
              action.tenantId === input.tenantId &&
              action.state.state === "pending" &&
              sameInboxV2ExternalMessageKey(
                action.externalMessageKey,
                input.externalMessageKey
              ) &&
              (input.afterActionId === null ||
                input.afterActionId === undefined ||
                action.id > input.afterActionId)
          )
          .sort((left, right) => left.id.localeCompare(right.id));
        const actions = all.slice(0, input.limit);
        return {
          kind: "page" as const,
          actions,
          hasMore: all.length > input.limit,
          nextAfterActionId:
            all.length > input.limit ? (actions.at(-1)?.id ?? null) : null
        };
      },
      async readDeferredAction(_transaction, input) {
        return state.actions.get(input.actionId) ?? null;
      }
    }
  });
}

function defaultCallbacks(
  state: MemoryState,
  overrides: Partial<InboxV2SourceMessageReconciliationCallbacks> = {}
): InboxV2SourceMessageReconciliationCallbacks {
  const callbacks: InboxV2SourceMessageReconciliationCallbacks = {
    async createMessage(_transaction, input) {
      state.references.push(input.candidateExternalMessageReference);
      const occurrence = resolveOccurrence(
        input.plan.sourceOccurrence,
        input.candidateExternalMessageReference,
        input.plan.materializedAt
      );
      state.occurrences.set(occurrence.id, occurrence);
      state.transportLinks.push(
        transportLinkForPlan(
          input.plan,
          input.candidateExternalMessageReference,
          input.plan.intent.transportRole
        )
      );
      return {
        kind: "committed",
        result: {
          externalMessageReference: input.candidateExternalMessageReference,
          sourceOccurrence: occurrence
        }
      };
    },
    async attachOccurrence(_transaction, input) {
      const occurrence = resolveOccurrence(
        input.plan.sourceOccurrence,
        input.targetExternalMessageReference,
        input.plan.materializedAt
      );
      state.occurrences.set(occurrence.id, occurrence);
      state.transportLinks.push(
        transportLinkForPlan(
          input.plan,
          input.targetExternalMessageReference,
          input.reason === "exact_message_reuse" &&
            input.plan.intent.kind === "message_create" &&
            input.plan.intent.transportRole === "origin"
            ? "additional_artifact"
            : input.plan.intent.transportRole
        )
      );
      return {
        kind: "committed",
        result: {
          externalMessageReference: input.targetExternalMessageReference,
          sourceOccurrence: occurrence
        }
      };
    },
    async applySourceAction(_transaction, input) {
      const terminal = expireAction(input.plan.intent.deferredAction);
      state.actions.set(terminal.id, terminal);
      return {
        kind: "committed",
        result: {
          externalMessageReference: input.targetExternalMessageReference,
          sourceOccurrence: input.plan.sourceOccurrence,
          deferredAction: terminal
        }
      };
    },
    async drainDeferredActions(_transaction, input) {
      const results = input.actions.map((action) => {
        const terminal = expireAction(action);
        state.actions.set(terminal.id, terminal);
        return {
          externalMessageReference: input.targetExternalMessageReference,
          sourceOccurrence: action.sourceOccurrence,
          deferredAction: terminal
        };
      });
      return { kind: "committed", result: { results } };
    }
  };
  return { ...callbacks, ...overrides };
}

function makePlan(
  intent: "message_create" | "echo_handoff" | "source_action",
  accountSuffix: string,
  subject = "Message:Exact-42",
  options: Readonly<{ weakEvidence?: boolean }> = {}
): InboxV2SourceMessageReconciliationPlan {
  const context = makeResolvedReconciliationContext(accountSuffix);
  return materializer.materialize({
    context,
    descriptor: makeMessageReconciliationDescriptor(context, {
      subject,
      intent,
      origin: intent === "echo_handoff" ? "provider_echo" : "webhook",
      direction: intent === "echo_handoff" ? "outbound" : "inbound",
      weakEvidence: options.weakEvidence
    })
  });
}

function makeDeletePlan(accountSuffix: string, subject: string) {
  const context = makeResolvedReconciliationContext(accountSuffix);
  const descriptor = makeMessageReconciliationDescriptor(context, {
    subject,
    intent: "source_action"
  });
  if (descriptor.intent.kind !== "source_action") {
    throw new Error("Expected source-action descriptor.");
  }
  return materializer.materialize({
    context,
    descriptor: {
      ...descriptor,
      intent: {
        ...descriptor.intent,
        action: {
          kind: "delete",
          normalizedEvent: descriptor.intent.action.normalizedEvent,
          reasonId: inboxV2CatalogIdSchema.parse("core:provider-delete")
        },
        semanticProof: {
          ...descriptor.intent.semanticProof,
          capabilityId: inboxV2CatalogIdSchema.parse(
            "module:synthetic-source:message-delete"
          ),
          semanticId: inboxV2CatalogIdSchema.parse(
            "core:message.lifecycle.delete.observed"
          ),
          proofToken: "proof:message-delete-42"
        },
        eventFingerprintSha256: "9".repeat(64)
      }
    }
  });
}

function withDeferredOrdering(
  plan: InboxV2SourceMessageReconciliationPlan,
  input: Readonly<{ id: string; position: string }>
): InboxV2SourceMessageReconciliationPlan {
  if (
    plan.intent.kind !== "source_action" ||
    plan.intent.deferredAction.semanticProof.ordering.kind !== "monotonic_exact"
  ) {
    throw new Error("Expected a monotonic source-action plan.");
  }
  const deferredAction = inboxV2DeferredMessageSourceActionSchema.parse({
    ...plan.intent.deferredAction,
    id: input.id,
    semanticProof: {
      ...plan.intent.deferredAction.semanticProof,
      ordering: {
        ...plan.intent.deferredAction.semanticProof.ordering,
        position: input.position
      }
    }
  });
  return inboxV2SourceMessageReconciliationPlanSchema.parse({
    ...plan,
    intent: {
      ...plan.intent,
      candidateDeferredActionId: input.id,
      deferredAction
    }
  });
}

function makeState(
  ...plans: readonly InboxV2SourceMessageReconciliationPlan[]
): MemoryState {
  return {
    occurrences: new Map(
      plans.map((plan) => [plan.sourceOccurrence.id, plan.sourceOccurrence])
    ),
    references: [],
    transportLinks: [],
    actions: new Map(),
    weakEvidence: new Map()
  };
}

function candidateReference(
  plan: InboxV2SourceMessageReconciliationPlan
): InboxV2ExternalMessageReference {
  if (plan.intent.kind !== "message_create") {
    const creation = makePlan(
      "message_create",
      "candidate",
      plan.messageKey.canonicalExternalSubject
    );
    return candidateReference({
      ...creation,
      context: plan.context,
      messageKey: plan.messageKey,
      sourceOccurrence: plan.sourceOccurrence,
      candidateExternalMessageReferenceId:
        plan.candidateExternalMessageReferenceId
    });
  }
  return {
    tenantId: plan.sourceOccurrence.tenantId,
    id: plan.candidateExternalMessageReferenceId,
    key: plan.messageKey,
    identityDeclaration: plan.sourceOccurrence.messageIdentityDeclaration,
    externalThread: plan.messageKey.externalThread,
    timelineItem: {
      tenantId: plan.sourceOccurrence.tenantId,
      kind: "timeline_item",
      id: plan.intent.candidateTimelineItemId
    },
    message: {
      tenantId: plan.sourceOccurrence.tenantId,
      kind: "message",
      id: plan.intent.candidateMessageId
    },
    revision: "1",
    createdAt: plan.materializedAt
  } as InboxV2ExternalMessageReference;
}

function resolveOccurrence(
  occurrence: InboxV2SourceOccurrence,
  reference: InboxV2ExternalMessageReference,
  changedAt: string
): InboxV2SourceOccurrence {
  return {
    ...occurrence,
    resolution: {
      state: "resolved",
      externalMessageReference: {
        tenantId: reference.tenantId,
        kind: "external_message_reference",
        id: reference.id
      }
    },
    revision: (BigInt(occurrence.revision) + 1n).toString(),
    updatedAt: changedAt
  } as InboxV2SourceOccurrence;
}

function transportLinkForPlan(
  plan: InboxV2SourceMessageReconciliationPlan &
    Readonly<{
      intent: Extract<
        InboxV2SourceMessageReconciliationPlan["intent"],
        { kind: "message_create" | "echo_handoff" }
      >;
    }>,
  reference: InboxV2ExternalMessageReference,
  role: InboxV2MessageTransportOccurrenceLink["role"]
): InboxV2MessageTransportOccurrenceLink {
  return inboxV2MessageTransportOccurrenceLinkSchema.parse({
    tenantId: plan.sourceOccurrence.tenantId,
    id: plan.intent.candidateTransportLinkId,
    message: reference.message,
    sourceOccurrence: {
      tenantId: plan.sourceOccurrence.tenantId,
      kind: "source_occurrence",
      id: plan.sourceOccurrence.id
    },
    externalMessageReference: {
      tenantId: reference.tenantId,
      kind: "external_message_reference",
      id: reference.id
    },
    role,
    revision: "1",
    linkedAt: plan.materializedAt
  });
}

function expireAction(
  action: InboxV2DeferredMessageSourceAction
): InboxV2DeferredMessageSourceAction {
  return {
    ...action,
    state: {
      state: "expired",
      reasonId: "core:source-action-expired",
      expiredAt: reconciliationT5
    },
    revision: "2",
    updatedAt: reconciliationT5
  } as InboxV2DeferredMessageSourceAction;
}

function applyAction(
  action: InboxV2DeferredMessageSourceAction,
  reference: InboxV2ExternalMessageReference
): InboxV2DeferredMessageSourceAction {
  return inboxV2DeferredMessageSourceActionSchema.parse({
    ...action,
    state: {
      state: "applied",
      externalMessageReference: {
        tenantId: reference.tenantId,
        kind: "external_message_reference",
        id: reference.id
      },
      message: reference.message,
      appliedMessageRevision: "1",
      effectKind: "message_lifecycle",
      appliedAt: reconciliationT5
    },
    revision: "2",
    updatedAt: reconciliationT5
  });
}

function snapshotState(state: MemoryState): MemoryState {
  return structuredClone(state);
}

function restoreState(state: MemoryState, snapshot: MemoryState): void {
  state.occurrences = snapshot.occurrences;
  state.references = snapshot.references;
  state.transportLinks = snapshot.transportLinks;
  state.actions = snapshot.actions;
  state.weakEvidence = snapshot.weakEvidence;
}

function render(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

void inboxV2SourceMessageReconciliationPlanSchema;
