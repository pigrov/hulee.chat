import {
  inboxV2DeferredSourceActionOrderingHeadSchema,
  type InboxV2DeferredMessageSourceActionEffectProof
} from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import { fixtureT3 } from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import {
  composeInboxV2SourceMessageActionCallbacks,
  createInboxV2SourceMessageEffectCallbacks,
  type InboxV2DeferredMessageEffectSourceAction,
  type InboxV2SourceMessageActionCallbacks,
  type InboxV2SourceMessageEffectAdvancePlanner
} from "./sql-inbox-v2-source-message-effect-adapter";
import type { InboxV2DeferredMessageSourceActionCommit } from "./sql-inbox-v2-source-message-reconciliation-repository";
import {
  deferredNormalizedEvent,
  makeDeferredMessageEffectTarget,
  makeDeferredOrderingHead,
  makePendingDeferredAction,
  makeProviderObservedMessageEffectProof
} from "./sql-inbox-v2-source-message-reconciliation-repository.test-support";
import type { RawSqlExecutor } from "./sql-outbox-repository";

type PlanMessageEffectAdvance =
  InboxV2SourceMessageEffectAdvancePlanner["planMessageEffectAdvance"];
type PlanMessageEffectAdvanceInput = Parameters<PlanMessageEffectAdvance>[1];
type PlanMessageEffectAdvanceResult = Awaited<
  ReturnType<PlanMessageEffectAdvance>
>;

const transaction = {
  async execute() {
    throw new Error("The unit adapter must use only injected DB dependencies.");
  }
} as unknown as RawSqlExecutor;

describe("Inbox V2 source Message reaction/transport adapter", () => {
  it("composes one exhaustive apply/drain callback for all five source-action kinds", async () => {
    const actions = [
      makePendingDeferredAction(
        {
          kind: "edit",
          normalizedEvent: deferredNormalizedEvent("router-edit"),
          normalizedContentDigestSha256: "1".repeat(64)
        },
        { id: "deferred_message_source_action:router-edit" }
      ),
      makePendingDeferredAction(
        {
          kind: "delete",
          normalizedEvent: deferredNormalizedEvent("router-delete"),
          reasonId: "module:synthetic:provider-delete"
        },
        { id: "deferred_message_source_action:router-delete" }
      ),
      reactionAction("set", "1", "👍"),
      deliveryAction("sent", "1"),
      receiptAction("1")
    ];
    const target = makeDeferredMessageEffectTarget(actions[0]!);
    const lifecycle = recordingCallbacks();
    const messageEffect = recordingCallbacks();
    const callbacks = composeInboxV2SourceMessageActionCallbacks({
      lifecycle: lifecycle.callbacks,
      messageEffect: messageEffect.callbacks
    });

    for (const action of actions) {
      const result = await callbacks.applySourceAction(transaction, {
        plan: {
          intent: { kind: "source_action", deferredAction: action }
        },
        targetExternalMessageReference: target
      } as Parameters<
        InboxV2SourceMessageActionCallbacks["applySourceAction"]
      >[1]);
      expect(result.kind).toBe("committed");
    }
    const drained = await callbacks.drainDeferredActions(transaction, {
      targetExternalMessageReference: target,
      actions: [actions[4]!, actions[0]!, actions[2]!, actions[1]!, actions[3]!]
    });

    expect(lifecycle.appliedKinds).toEqual(["edit", "delete"]);
    expect(messageEffect.appliedKinds).toEqual([
      "reaction",
      "delivery",
      "receipt"
    ]);
    expect(lifecycle.drainedKinds).toEqual(["edit", "delete"]);
    expect(messageEffect.drainedKinds).toEqual([
      "receipt",
      "reaction",
      "delivery"
    ]);
    expect(drained.kind).toBe("committed");
    if (drained.kind !== "committed") return;
    expect(
      drained.result.results.map((result) => result.deferredAction.action.kind)
    ).toEqual(["receipt", "edit", "reaction", "delete", "delivery"]);
  });

  it("applies provider reaction set -> replace -> clear with exact occurrence and lane ordering closure", async () => {
    const actions = [
      reactionAction("set", "1", "👍"),
      reactionAction("replace", "2", "🔥"),
      reactionAction("clear", "3", null)
    ];
    const target = makeDeferredMessageEffectTarget(actions[0]!);
    let previousReaction: Extract<
      InboxV2DeferredMessageSourceActionEffectProof,
      { kind: "message_reaction" }
    > | null = null;
    const effectProofs: InboxV2DeferredMessageSourceActionEffectProof[] = [];
    const planMessageEffectAdvance = vi.fn<PlanMessageEffectAdvance>(
      async (
        _transaction: RawSqlExecutor,
        input: PlanMessageEffectAdvanceInput
      ): Promise<PlanMessageEffectAdvanceResult> => {
        const effectProof = makeProviderObservedMessageEffectProof(
          input.action,
          input.targetExternalMessageReference,
          input.sourceOccurrenceResolution.after,
          { recordedAt: input.recordedAt, previousReaction }
        );
        if (effectProof.kind !== "message_reaction") {
          throw new Error("Expected a reaction proof.");
        }
        previousReaction = effectProof;
        effectProofs.push(effectProof);
        return {
          kind: "planned",
          plan: {
            kind: "message_reaction",
            effectProof,
            streamPosition: String(100 + effectProofs.length)
          }
        };
      }
    );
    const closure = vi.fn(async () => ({ providerIoIntentCount: 0 }));
    const commits: InboxV2DeferredMessageSourceActionCommit[] = [];
    const callbacks = createInboxV2SourceMessageEffectCallbacks({
      planner: { planMessageEffectAdvance },
      effectClosure: { persistEffectClosure: closure },
      deriveResolutionToken: ({ action }) =>
        `resolution:message-effect:${action.id}`,
      dependencies: {
        readDatabaseNow: async () => fixtureT3,
        loadOrderingHead: async () => null,
        persistOccurrenceResolution: async () => "committed",
        persistMessageEffect: async (_transaction, plan, effectClosure) => {
          await effectClosure.persistEffectClosure(transaction, {
            effectProof: plan.effectProof,
            envelopes: []
          });
          return "committed";
        },
        commitDeferredAction: async (_transaction, commit) => {
          commits.push(commit);
          return { kind: "committed", action: commit.after };
        }
      }
    });

    const result = await callbacks.drainDeferredActions(transaction, {
      targetExternalMessageReference: target,
      actions: [...actions].reverse()
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(planMessageEffectAdvance).toHaveBeenCalledTimes(3);
    expect(closure).toHaveBeenCalledTimes(3);
    expect(effectProofs.map(reactionTransition)).toEqual([
      { operation: "set", before: null, after: "active", revision: "1" },
      {
        operation: "replace",
        before: "active",
        after: "active",
        revision: "2"
      },
      { operation: "clear", before: "active", after: "cleared", revision: "3" }
    ]);
    expect(commits.map((commit) => commit.afterOrderingHead?.revision)).toEqual(
      ["1", "2", "3"]
    );
    expect(
      result.result.results.map((item) => item.deferredAction.state)
    ).toEqual([
      expect.objectContaining({
        state: "applied",
        effectKind: "message_reaction"
      }),
      expect.objectContaining({
        state: "applied",
        effectKind: "message_reaction"
      }),
      expect.objectContaining({
        state: "applied",
        effectKind: "message_reaction"
      })
    ]);
  });

  it("persists accepted/sent/delivered/failed and exact read without inventing a shared cursor", async () => {
    const actions = [
      deliveryAction("accepted", "1"),
      deliveryAction("sent", "2"),
      deliveryAction("delivered", "3"),
      deliveryAction("failed", "4"),
      receiptAction("1")
    ];
    const target = makeDeferredMessageEffectTarget(actions[0]!);
    const effects: InboxV2DeferredMessageSourceActionEffectProof[] = [];
    const planMessageEffectAdvance = vi.fn<PlanMessageEffectAdvance>(
      async (_transaction, input) => {
        const effectProof = makeProviderObservedMessageEffectProof(
          input.action,
          input.targetExternalMessageReference,
          input.sourceOccurrenceResolution.after,
          { recordedAt: input.recordedAt }
        );
        effects.push(effectProof);
        return {
          kind: "planned" as const,
          plan: {
            kind: "message_transport_fact" as const,
            effectProof: effectProof as Extract<
              typeof effectProof,
              { kind: "message_transport_fact" }
            >,
            streamPosition: String(200 + effects.length)
          }
        };
      }
    );
    const commits: InboxV2DeferredMessageSourceActionCommit[] = [];
    const callbacks = createInboxV2SourceMessageEffectCallbacks({
      planner: { planMessageEffectAdvance },
      effectClosure: {
        persistEffectClosure: async () => ({ providerIoIntentCount: 0 })
      },
      deriveResolutionToken: ({ action }) =>
        `resolution:message-effect:${action.id}`,
      dependencies: {
        readDatabaseNow: async () => fixtureT3,
        loadOrderingHead: async () => null,
        persistOccurrenceResolution: async () => "committed",
        persistMessageEffect: async () => "committed",
        commitDeferredAction: async (_transaction, commit) => {
          commits.push(commit);
          return { kind: "committed", action: commit.after };
        }
      }
    });

    const result = await callbacks.drainDeferredActions(transaction, {
      targetExternalMessageReference: target,
      actions: [actions[4]!, actions[2]!, actions[0]!, actions[3]!, actions[1]!]
    });

    expect(result.kind).toBe("committed");
    expect(effects.map(transportFact)).toEqual([
      { kind: "delivery", fact: "accepted" },
      { kind: "delivery", fact: "sent" },
      { kind: "delivery", fact: "delivered" },
      { kind: "delivery", fact: "failed" },
      { kind: "receipt", fact: "read" }
    ]);
    expect(
      commits.map((commit) => ({
        lane: commit.afterOrderingHead?.lane,
        revision: commit.afterOrderingHead?.revision
      }))
    ).toEqual([
      { lane: "delivery", revision: "1" },
      { lane: "delivery", revision: "2" },
      { lane: "delivery", revision: "3" },
      { lane: "delivery", revision: "4" },
      { lane: "receipt", revision: "1" }
    ]);
  });

  it.each(["stale", "duplicate"] as const)(
    "records %s provider provenance with exact occurrence but no domain effect",
    async (outcome) => {
      const action = receiptAction(outcome === "stale" ? "9" : "10");
      const baseHead = makeDeferredOrderingHead(action, {
        actionId: `deferred_message_source_action:${outcome}-canonical`,
        position: "10"
      });
      const head =
        outcome === "stale"
          ? baseHead
          : inboxV2DeferredSourceActionOrderingHeadSchema.parse({
              ...baseHead,
              latest: {
                ...baseHead.latest,
                idempotencyKey: {
                  ...baseHead.latest.idempotencyKey,
                  normalizedInboundEvent: deferredNormalizedEvent(
                    "duplicate-canonical"
                  ),
                  sourceOccurrence: {
                    ...baseHead.latest.idempotencyKey.sourceOccurrence,
                    id: "source_occurrence:duplicate-canonical"
                  }
                }
              }
            });
      const planner = vi.fn<PlanMessageEffectAdvance>();
      const persistMessageEffect = vi.fn(async () => "committed" as const);
      const persistOccurrenceResolution = vi.fn(
        async () => "committed" as const
      );
      const commits: InboxV2DeferredMessageSourceActionCommit[] = [];
      const callbacks = createInboxV2SourceMessageEffectCallbacks({
        planner: { planMessageEffectAdvance: planner },
        effectClosure: {
          persistEffectClosure: async () => ({ providerIoIntentCount: 0 })
        },
        deriveResolutionToken: ({ action: candidate }) =>
          `resolution:message-effect:${candidate.id}`,
        dependencies: {
          readDatabaseNow: async () => fixtureT3,
          loadOrderingHead: async () => head,
          persistOccurrenceResolution,
          persistMessageEffect,
          commitDeferredAction: async (_transaction, commit) => {
            commits.push(commit);
            return { kind: "committed", action: commit.after };
          }
        }
      });

      const result = await callbacks.drainDeferredActions(transaction, {
        targetExternalMessageReference: makeDeferredMessageEffectTarget(action),
        actions: [action]
      });

      expect(result.kind).toBe("committed");
      if (result.kind !== "committed") return;
      expect(result.result.results[0]?.deferredAction.state.state).toBe(
        outcome
      );
      expect(planner).not.toHaveBeenCalled();
      expect(persistMessageEffect).not.toHaveBeenCalled();
      expect(persistOccurrenceResolution).toHaveBeenCalledTimes(1);
      expect(commits[0]).toMatchObject({
        effectProof: null,
        beforeOrderingHead: head,
        afterOrderingHead: head,
        transition: { orderingOutcome: outcome }
      });
    }
  );

  it("rejects a provider-I/O closure receipt and leaves the outer transaction to roll back", async () => {
    const action = receiptAction("1");
    const target = makeDeferredMessageEffectTarget(action);
    const callbacks = createInboxV2SourceMessageEffectCallbacks({
      planner: {
        async planMessageEffectAdvance(_transaction, input) {
          const effectProof = makeProviderObservedMessageEffectProof(
            input.action,
            input.targetExternalMessageReference,
            input.sourceOccurrenceResolution.after,
            { recordedAt: input.recordedAt }
          );
          if (effectProof.kind !== "message_transport_fact") {
            throw new Error("Expected a transport proof.");
          }
          return {
            kind: "planned",
            plan: {
              kind: "message_transport_fact",
              effectProof,
              streamPosition: "301"
            }
          };
        }
      },
      effectClosure: {
        persistEffectClosure: async () => ({ providerIoIntentCount: 1 })
      },
      deriveResolutionToken: () => "resolution:message-effect:provider-io",
      dependencies: {
        readDatabaseNow: async () => fixtureT3,
        loadOrderingHead: async () => null,
        persistOccurrenceResolution: async () => "committed",
        persistMessageEffect: async (_transaction, plan, closure) => {
          const receipt = await closure.persistEffectClosure(transaction, {
            effectProof: plan.effectProof,
            envelopes: []
          });
          if (receipt.providerIoIntentCount !== 0) {
            throw new Error("provider-I/O closure rejected");
          }
          return "committed";
        },
        commitDeferredAction: vi.fn()
      }
    });

    await expect(
      callbacks.drainDeferredActions(transaction, {
        targetExternalMessageReference: target,
        actions: [action]
      })
    ).rejects.toThrow("provider-I/O closure rejected");
  });
});

function reactionAction(
  operation: "set" | "replace" | "clear",
  position: string,
  value: string | null
): InboxV2DeferredMessageEffectSourceAction {
  return makePendingDeferredAction(
    {
      kind: "reaction",
      operation,
      value: value === null ? null : { kind: "unicode", value },
      normalizedEvent: deferredNormalizedEvent(`effect-reaction-${operation}`)
    },
    {
      id: `deferred_message_source_action:effect-reaction-${operation}`,
      occurrenceId: `source_occurrence:effect-reaction-${operation}`,
      position,
      fingerprint: position.repeat(64).slice(0, 64)
    }
  ) as InboxV2DeferredMessageEffectSourceAction;
}

function deliveryAction(
  fact: "accepted" | "sent" | "delivered" | "failed",
  position: string
): InboxV2DeferredMessageEffectSourceAction {
  return makePendingDeferredAction(
    {
      kind: "delivery",
      fact,
      normalizedEvent: deferredNormalizedEvent(`effect-delivery-${fact}`)
    },
    {
      id: `deferred_message_source_action:effect-delivery-${fact}`,
      occurrenceId: `source_occurrence:effect-delivery-${fact}`,
      occurrenceOrigin: "provider_echo",
      occurrenceDirection: "outbound",
      position,
      fingerprint: position.repeat(64).slice(0, 64)
    }
  ) as InboxV2DeferredMessageEffectSourceAction;
}

function receiptAction(
  position: string
): InboxV2DeferredMessageEffectSourceAction {
  return makePendingDeferredAction(
    {
      kind: "receipt",
      fact: "read",
      scope: "exact_message",
      normalizedEvent: deferredNormalizedEvent(`effect-receipt-${position}`)
    },
    {
      id: `deferred_message_source_action:effect-receipt-${position}`,
      occurrenceId: `source_occurrence:effect-receipt-${position}`,
      occurrenceOrigin: "provider_echo",
      occurrenceDirection: "outbound",
      position,
      fingerprint: position.repeat(64).slice(0, 64)
    }
  ) as InboxV2DeferredMessageEffectSourceAction;
}

function reactionTransition(
  effect: InboxV2DeferredMessageSourceActionEffectProof
) {
  if (effect.kind !== "message_reaction") throw new Error("reaction expected");
  return {
    operation: effect.commit.transition.operation,
    before: effect.commit.transition.beforeState?.kind ?? null,
    after: effect.commit.transition.afterState.kind,
    revision: effect.commit.afterReaction.revision
  };
}

function transportFact(effect: InboxV2DeferredMessageSourceActionEffectProof) {
  if (effect.kind !== "message_transport_fact") {
    throw new Error("transport expected");
  }
  return {
    kind: effect.commit.fact.kind,
    fact: effect.commit.fact.observation.fact
  };
}

function recordingCallbacks(): Readonly<{
  callbacks: InboxV2SourceMessageActionCallbacks;
  appliedKinds: string[];
  drainedKinds: string[];
}> {
  const appliedKinds: string[] = [];
  const drainedKinds: string[] = [];
  const actionResult = (
    action: Parameters<
      InboxV2SourceMessageActionCallbacks["drainDeferredActions"]
    >[1]["actions"][number],
    target: Parameters<
      InboxV2SourceMessageActionCallbacks["drainDeferredActions"]
    >[1]["targetExternalMessageReference"]
  ) => ({
    externalMessageReference: target,
    sourceOccurrence: action.sourceOccurrence,
    deferredAction: action
  });
  return {
    appliedKinds,
    drainedKinds,
    callbacks: {
      async applySourceAction(_transaction, input) {
        const action = input.plan.intent.deferredAction;
        appliedKinds.push(action.action.kind);
        return {
          kind: "committed",
          result: actionResult(action, input.targetExternalMessageReference)
        };
      },
      async drainDeferredActions(_transaction, input) {
        drainedKinds.push(...input.actions.map((action) => action.action.kind));
        return {
          kind: "committed",
          result: {
            results: input.actions.map((action) =>
              actionResult(action, input.targetExternalMessageReference)
            )
          }
        };
      }
    }
  };
}
