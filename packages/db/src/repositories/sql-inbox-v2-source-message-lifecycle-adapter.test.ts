import {
  calculateInboxV2MessageContentDigest,
  inboxV2BigintCounterSchema,
  inboxV2DeferredMessageSourceActionEffectProofSchema,
  inboxV2DeferredSourceActionOrderingHeadSchema,
  inboxV2EntityRevisionSchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineSequenceSchema,
  type InboxV2DeferredMessageSourceAction,
  type InboxV2DeferredMessageSourceActionEffectProof,
  type InboxV2DeferredSourceActionOrderingHead,
  type InboxV2ExternalMessageReference,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  fixtureContent,
  fixtureExternalReference,
  fixtureMessage,
  fixtureParticipant,
  fixtureProviderSemanticOrderingCommit,
  fixtureProviderSemanticProof,
  fixtureReference,
  fixtureSourceIdentityReference,
  fixtureT3,
  fixtureTimelineItem
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import {
  createInboxV2SourceMessageLifecycleCallbacks,
  type InboxV2DeferredLifecycleSourceAction,
  type InboxV2SourceMessageLifecycleAdvancePlanner,
  verifyInboxV2SourceMessageLifecycleEffectClosure
} from "./sql-inbox-v2-source-message-lifecycle-adapter";
import type { InboxV2DeferredMessageSourceActionCommit } from "./sql-inbox-v2-source-message-reconciliation-repository";
import {
  deferredNormalizedEvent,
  makeDeferredOrderingHead,
  makePendingDeferredAction
} from "./sql-inbox-v2-source-message-reconciliation-repository.test-support";
import { buildInboxV2SafeGenericEnvelope } from "./sql-inbox-v2-timeline-message-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

type PlanLifecycleAdvance =
  InboxV2SourceMessageLifecycleAdvancePlanner["planLifecycleAdvance"];
type PlanLifecycleAdvanceInput = Parameters<PlanLifecycleAdvance>[1];
type PlanLifecycleAdvanceResult = Awaited<ReturnType<PlanLifecycleAdvance>>;
type ApplySourceActionInput = Parameters<
  ReturnType<
    typeof createInboxV2SourceMessageLifecycleCallbacks
  >["applySourceAction"]
>[1];

const transaction = {
  async execute() {
    throw new Error("The unit adapter must use only injected DB dependencies.");
  }
} as unknown as RawSqlExecutor;

describe("Inbox V2 source Message lifecycle adapter", () => {
  it.each(["stale", "duplicate"] as const)(
    "terminally records %s provenance without planning or writing a lifecycle effect",
    async (outcome) => {
      const { action, head } = nonAdvancingFixture(outcome);
      const target = exactTarget();
      const planner = vi.fn<PlanLifecycleAdvance>();
      const persistLifecycleEffect = vi.fn(async () => "committed" as const);
      const persistEffectClosure = vi.fn(async () => ({
        providerIoIntentCount: 0
      }));
      const persistOccurrenceResolution = vi.fn(
        async () => "committed" as const
      );
      const commits: InboxV2DeferredMessageSourceActionCommit[] = [];
      const callbacks = createInboxV2SourceMessageLifecycleCallbacks({
        planner: { planLifecycleAdvance: planner },
        effectClosure: { persistEffectClosure },
        deriveResolutionToken: () => "resolution:source-lifecycle-test",
        dependencies: {
          readDatabaseNow: async () => fixtureT3,
          loadOrderingHead: async () => head,
          persistOccurrenceResolution,
          persistLifecycleEffect,
          commitDeferredAction: async (_transaction, commit) => {
            commits.push(commit);
            return { kind: "committed", action: commit.after };
          }
        }
      });

      const result = await callbacks.drainDeferredActions(transaction, {
        targetExternalMessageReference: target,
        actions: [action]
      });

      expect(result.kind).toBe("committed");
      if (result.kind !== "committed") return;
      expect(result.result.results[0]?.deferredAction.state.state).toBe(
        outcome
      );
      expect(planner).not.toHaveBeenCalled();
      expect(persistLifecycleEffect).not.toHaveBeenCalled();
      expect(persistEffectClosure).not.toHaveBeenCalled();
      expect(persistOccurrenceResolution).toHaveBeenCalledTimes(1);
      expect(commits).toHaveLength(1);
      expect(commits[0]).toMatchObject({
        transition: { orderingOutcome: outcome },
        targetExternalMessageReference: { id: target.id },
        effectProof: null,
        beforeOrderingHead: head,
        afterOrderingHead: head
      });
    }
  );

  it("applies an edit-before-create exactly once against the resolved Message", async () => {
    const blocks = editedBlocks("Provider edited before the create arrived");
    const action = editAction(
      "edit-before-create",
      calculateInboxV2MessageContentDigest(blocks)
    );
    const target = exactTarget();
    const resolutions: InboxV2SourceOccurrence[] = [];
    const terminalCommits: InboxV2DeferredMessageSourceActionCommit[] = [];
    const persistEffectClosure = vi.fn(async () => ({
      providerIoIntentCount: 0
    }));
    const planLifecycleAdvance = vi.fn(
      async (
        _transaction: RawSqlExecutor,
        input: PlanLifecycleAdvanceInput
      ): Promise<PlanLifecycleAdvanceResult> => {
        expect(input.action.id).toBe(action.id);
        expect(input.targetExternalMessageReference).toEqual(target);
        expect(input.sourceOccurrenceResolution.before).toEqual(
          action.sourceOccurrence
        );
        expect(input.sourceOccurrenceResolution.after.resolution).toMatchObject(
          {
            state: "resolved",
            externalMessageReference: { id: target.id }
          }
        );
        return {
          kind: "planned",
          plan: {
            kind: "message_lifecycle",
            effectProof: providerObservedEditEffect(
              action,
              target,
              input.sourceOccurrenceResolution.after,
              blocks,
              input.recordedAt
            ),
            streamPosition: "100"
          }
        };
      }
    );
    const persistLifecycleEffect = vi.fn(
      async (_transaction, lifecyclePlan, closure) => {
        const closureResult = await closure.persistEffectClosure(transaction, {
          effectProof: lifecyclePlan.effectProof,
          envelopes: []
        });
        expect(closureResult.providerIoIntentCount).toBe(0);
        return "committed" as const;
      }
    );
    const callbacks = createInboxV2SourceMessageLifecycleCallbacks({
      planner: { planLifecycleAdvance },
      effectClosure: { persistEffectClosure },
      deriveResolutionToken: () => "resolution:source-lifecycle-edit",
      dependencies: {
        readDatabaseNow: async () => fixtureT3,
        loadOrderingHead: async () => null,
        persistOccurrenceResolution: async (_transaction, resolution) => {
          resolutions.push(resolution.after);
          return "committed";
        },
        persistLifecycleEffect,
        commitDeferredAction: async (_transaction, commit) => {
          terminalCommits.push(commit);
          return { kind: "committed", action: commit.after };
        }
      }
    });

    const result = await callbacks.applySourceAction(transaction, {
      plan: sourceActionPlan(action),
      targetExternalMessageReference: target
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(planLifecycleAdvance).toHaveBeenCalledTimes(1);
    expect(resolutions).toHaveLength(1);
    expect(persistLifecycleEffect).toHaveBeenCalledTimes(1);
    expect(terminalCommits).toHaveLength(1);
    expect(result.result.deferredAction.state).toMatchObject({
      state: "applied",
      externalMessageReference: { id: target.id },
      message: target.message,
      appliedMessageRevision: "2",
      effectKind: "message_lifecycle"
    });
    expect(persistEffectClosure).toHaveBeenCalledTimes(1);
  });

  it("returns a planner conflict before any occurrence, effect or terminal write", async () => {
    const action = editAction(
      "planner-conflict",
      calculateInboxV2MessageContentDigest(editedBlocks("Edited"))
    );
    const planner = vi.fn<PlanLifecycleAdvance>(async () => ({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict"
    }));
    const persistOccurrenceResolution = vi.fn(async () => "committed" as const);
    const persistLifecycleEffect = vi.fn(async () => "committed" as const);
    const commitDeferredAction = vi.fn();
    const persistEffectClosure = vi.fn(async () => ({
      providerIoIntentCount: 0
    }));
    const callbacks = createInboxV2SourceMessageLifecycleCallbacks({
      planner: { planLifecycleAdvance: planner },
      effectClosure: { persistEffectClosure },
      deriveResolutionToken: () => "resolution:source-lifecycle-edit",
      dependencies: {
        readDatabaseNow: async () => fixtureT3,
        loadOrderingHead: async () => null,
        persistOccurrenceResolution,
        persistLifecycleEffect,
        commitDeferredAction
      }
    });

    const result = await callbacks.applySourceAction(transaction, {
      plan: sourceActionPlan(action),
      targetExternalMessageReference: exactTarget()
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict"
    });
    expect(persistOccurrenceResolution).not.toHaveBeenCalled();
    expect(persistLifecycleEffect).not.toHaveBeenCalled();
    expect(commitDeferredAction).not.toHaveBeenCalled();
    expect(persistEffectClosure).not.toHaveBeenCalled();
  });

  it.each(["40001", "40P01"] as const)(
    "leaves ambient transaction retry for SQLSTATE %s to the outer reconciliation owner",
    async (code) => {
      const blocks = editedBlocks(`Retryable provider edit ${code}`);
      const action = editAction(
        `retryable-${code}`,
        calculateInboxV2MessageContentDigest(blocks)
      );
      const target = exactTarget();
      const retryableError = Object.assign(
        new Error(`retryable lifecycle SQLSTATE ${code}`),
        { code }
      );
      const execute = vi.fn(async () => {
        throw retryableError;
      });
      const ambientTransaction = { execute } as unknown as RawSqlExecutor;
      const persistEffectClosure = vi.fn(async () => ({
        providerIoIntentCount: 0
      }));
      const commitDeferredAction = vi.fn();
      const callbacks = createInboxV2SourceMessageLifecycleCallbacks({
        planner: {
          async planLifecycleAdvance(_transaction, input) {
            return {
              kind: "planned",
              plan: {
                kind: "message_lifecycle",
                effectProof: providerObservedEditEffect(
                  action,
                  target,
                  input.sourceOccurrenceResolution.after,
                  blocks,
                  input.recordedAt
                ),
                streamPosition: "100"
              }
            };
          }
        },
        effectClosure: { persistEffectClosure },
        deriveResolutionToken: () => "resolution:source-lifecycle-retry",
        dependencies: {
          readDatabaseNow: async () => fixtureT3,
          loadOrderingHead: async () => null,
          persistOccurrenceResolution: async () => "committed",
          commitDeferredAction
        }
      });

      await expect(
        callbacks.applySourceAction(ambientTransaction, {
          plan: sourceActionPlan(action),
          targetExternalMessageReference: target
        })
      ).rejects.toBe(retryableError);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(persistEffectClosure).not.toHaveBeenCalled();
      expect(commitDeferredAction).not.toHaveBeenCalled();
    }
  );

  it("drains out-of-order input by advancing same-lane provider positions in ascending order", async () => {
    const action10 = deleteAction("10");
    const action11 = deleteAction("11");
    const target = exactTarget();
    const plannerOrder: string[] = [];
    const effectOrder: string[] = [];
    const commitOrder: string[] = [];
    const resolutionOrder: string[] = [];
    const persistEffectClosure = vi.fn(async () => ({
      providerIoIntentCount: 0
    }));
    const planLifecycleAdvance = vi.fn(
      async (
        _transaction: RawSqlExecutor,
        input: PlanLifecycleAdvanceInput
      ): Promise<PlanLifecycleAdvanceResult> => {
        const position = exactPosition(input.action);
        plannerOrder.push(position);
        const operationPosition = position === "10" ? "100" : "102";
        return {
          kind: "planned",
          plan: {
            kind: "provider_delete_retain_local",
            effectProof: retainedDeleteEffect(
              input.action,
              input.targetExternalMessageReference,
              input.sourceOccurrenceResolution.after,
              position,
              input.recordedAt
            ),
            operationStreamPosition: operationPosition,
            policyStreamPosition: (BigInt(operationPosition) + 1n).toString()
          }
        };
      }
    );
    const callbacks = createInboxV2SourceMessageLifecycleCallbacks({
      planner: { planLifecycleAdvance },
      effectClosure: { persistEffectClosure },
      deriveResolutionToken: ({ action }) =>
        `resolution:source-lifecycle:${exactPosition(action)}`,
      dependencies: {
        readDatabaseNow: async () => fixtureT3,
        loadOrderingHead: async () => null,
        persistOccurrenceResolution: async (_transaction, resolution) => {
          resolutionOrder.push(resolution.before.id);
          return "committed";
        },
        persistLifecycleEffect: async (_transaction, plan) => {
          if (plan.kind !== "provider_delete_retain_local") {
            throw new Error("Expected a retained provider delete plan.");
          }
          effectOrder.push(
            plan.effectProof.operationCreationCommit.operation.id
              .split(":")
              .at(-1)!
          );
          return "committed";
        },
        commitDeferredAction: async (_transaction, commit) => {
          commitOrder.push(exactPosition(commit.before));
          return { kind: "committed", action: commit.after };
        }
      }
    });

    const result = await callbacks.drainDeferredActions(transaction, {
      targetExternalMessageReference: target,
      actions: [action11, action10]
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(plannerOrder).toEqual(["10", "11"]);
    expect(effectOrder).toEqual(["10", "11"]);
    expect(commitOrder).toEqual(["10", "11"]);
    expect(resolutionOrder).toEqual([
      action10.sourceOccurrence.id,
      action11.sourceOccurrence.id
    ]);
    expect(
      result.result.results.map(({ deferredAction }) => deferredAction.id)
    ).toEqual([action11.id, action10.id]);
    expect(
      result.result.results.map(
        ({ deferredAction }) => deferredAction.state.state
      )
    ).toEqual(["applied", "applied"]);
    expect(persistEffectClosure).not.toHaveBeenCalled();
  });

  it("fails closed across incompatible ordering partitions without lifecycle work", async () => {
    const first = deleteAction("10");
    const secondBase = deleteAction("11");
    const second = {
      ...secondBase,
      semanticProof: {
        ...secondBase.semanticProof,
        ordering: {
          ...secondBase.semanticProof.ordering,
          scopeToken: "scope:delete:other-provider-message"
        }
      }
    } as InboxV2DeferredLifecycleSourceAction;
    const planner = vi.fn<PlanLifecycleAdvance>();
    const persistOccurrenceResolution = vi.fn(async () => "committed" as const);
    const persistLifecycleEffect = vi.fn(async () => "committed" as const);
    const commitDeferredAction = vi.fn(
      async (
        _transaction: RawSqlExecutor,
        commit: InboxV2DeferredMessageSourceActionCommit
      ) => ({ kind: "committed" as const, action: commit.after })
    );
    const persistEffectClosure = vi.fn(async () => ({
      providerIoIntentCount: 0
    }));
    const callbacks = createInboxV2SourceMessageLifecycleCallbacks({
      planner: { planLifecycleAdvance: planner },
      effectClosure: { persistEffectClosure },
      deriveResolutionToken: () => "resolution:source-lifecycle-test",
      dependencies: {
        readDatabaseNow: async () => fixtureT3,
        loadOrderingHead: async () => null,
        persistOccurrenceResolution,
        persistLifecycleEffect,
        commitDeferredAction
      }
    });

    const result = await callbacks.drainDeferredActions(transaction, {
      targetExternalMessageReference: exactTarget(),
      actions: [first, second]
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.deferred_action_conflict"
    });
    expect(planner).not.toHaveBeenCalled();
    expect(persistOccurrenceResolution).not.toHaveBeenCalled();
    expect(persistLifecycleEffect).not.toHaveBeenCalled();
    expect(persistEffectClosure).not.toHaveBeenCalled();
    expect(commitDeferredAction).not.toHaveBeenCalled();
  });

  it("verifies the exact persisted stream/event/projection closure instead of trusting a callback count", async () => {
    const envelope = sourceLifecycleEnvelope();
    const execute = vi.fn(async () => ({
      rows: [
        {
          stream_commit_count: "1",
          change_count: "1",
          missing_change_count: "0",
          unexpected_change_count: "0",
          commit_manifest_count: "1",
          event_count: "1",
          exact_event_count: "1",
          outbox_count: "1",
          projection_count: "1",
          provider_io_count: "0"
        }
      ]
    }));

    await expect(
      verifyInboxV2SourceMessageLifecycleEffectClosure(
        { execute } as unknown as RawSqlExecutor,
        [envelope]
      )
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "no durable closure",
      row: {
        stream_commit_count: "0",
        change_count: "0",
        missing_change_count: "1",
        unexpected_change_count: "0",
        commit_manifest_count: "0",
        event_count: "0",
        exact_event_count: "0",
        outbox_count: "0",
        projection_count: "0",
        provider_io_count: "0"
      }
    },
    {
      label: "partial event closure",
      row: {
        stream_commit_count: "1",
        change_count: "1",
        missing_change_count: "0",
        unexpected_change_count: "0",
        commit_manifest_count: "1",
        event_count: "0",
        exact_event_count: "0",
        outbox_count: "1",
        projection_count: "1",
        provider_io_count: "0"
      }
    },
    {
      label: "provider I/O leak",
      row: {
        stream_commit_count: "1",
        change_count: "1",
        missing_change_count: "0",
        unexpected_change_count: "0",
        commit_manifest_count: "1",
        event_count: "1",
        exact_event_count: "1",
        outbox_count: "2",
        projection_count: "1",
        provider_io_count: "1"
      }
    }
  ])("rejects $label after the effect callback", async ({ row }) => {
    const execute = vi.fn(async () => ({ rows: [row] }));

    await expect(
      verifyInboxV2SourceMessageLifecycleEffectClosure(
        { execute } as unknown as RawSqlExecutor,
        [sourceLifecycleEnvelope()]
      )
    ).rejects.toThrow(
      "Source Message effect omitted or duplicated its exact stream change, event or projection closure."
    );
  });

  it("accepts distinct Message and provider-operation envelopes at one stream position", async () => {
    const execute = vi.fn(async () => ({
      rows: [
        {
          stream_commit_count: "1",
          change_count: "2",
          missing_change_count: "0",
          unexpected_change_count: "0",
          commit_manifest_count: "1",
          event_count: "1",
          exact_event_count: "1",
          outbox_count: "1",
          projection_count: "1",
          provider_io_count: "0"
        }
      ]
    }));
    const message = sourceLifecycleEnvelope();
    const providerOperation = buildInboxV2SafeGenericEnvelope({
      ...message,
      entityKind: "provider_lifecycle",
      entityId: "provider-operation:source-lifecycle-1",
      entityRevision: inboxV2EntityRevisionSchema.parse("1"),
      changeKind: "provider_lifecycle.edit.provider_observed"
    });

    await expect(
      verifyInboxV2SourceMessageLifecycleEffectClosure(
        { execute } as unknown as RawSqlExecutor,
        [message, providerOperation]
      )
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects an empty or duplicate-entity envelope set before SQL", async () => {
    const execute = vi.fn();
    const executor = { execute } as unknown as RawSqlExecutor;
    const envelope = sourceLifecycleEnvelope();

    await expect(
      verifyInboxV2SourceMessageLifecycleEffectClosure(executor, [])
    ).rejects.toThrow("one unique entity envelope");
    await expect(
      verifyInboxV2SourceMessageLifecycleEffectClosure(executor, [
        envelope,
        envelope
      ])
    ).rejects.toThrow("one unique entity envelope");
    expect(execute).not.toHaveBeenCalled();
  });
});

function sourceLifecycleEnvelope() {
  return buildInboxV2SafeGenericEnvelope({
    tenantId: exactTarget().tenantId,
    entityKind: "message",
    entityId: exactTarget().message.id,
    entityRevision: inboxV2EntityRevisionSchema.parse("2"),
    timelineItemId: exactTarget().timelineItem.id,
    timelineSequence: inboxV2TimelineSequenceSchema.parse("1"),
    streamPosition: inboxV2BigintCounterSchema.parse("100"),
    changeKind: "edited",
    occurredAt: fixtureT3
  });
}

function nonAdvancingFixture(outcome: "stale" | "duplicate"): Readonly<{
  action: InboxV2DeferredLifecycleSourceAction;
  head: InboxV2DeferredSourceActionOrderingHead;
}> {
  const action = deleteAction(outcome === "stale" ? "9" : "10");
  const baseHead = makeDeferredOrderingHead(action, {
    actionId: `deferred_message_source_action:${outcome}-canonical`,
    position: "10"
  });
  if (outcome === "stale") return { action, head: baseHead };
  return {
    action,
    head: inboxV2DeferredSourceActionOrderingHeadSchema.parse({
      ...baseHead,
      latest: {
        ...baseHead.latest,
        idempotencyKey: {
          ...baseHead.latest.idempotencyKey,
          normalizedInboundEvent: fixtureReference(
            "normalized_inbound_event",
            "normalized_inbound_event:duplicate-canonical"
          ),
          sourceOccurrence: fixtureReference(
            "source_occurrence",
            "source_occurrence:duplicate-canonical"
          )
        }
      }
    })
  };
}

function exactTarget(): InboxV2ExternalMessageReference {
  return inboxV2ExternalMessageReferenceSchema.parse(
    fixtureExternalReference()
  );
}

function deleteAction(position: "9" | "10" | "11") {
  return makePendingDeferredAction(
    {
      kind: "delete",
      normalizedEvent: deferredNormalizedEvent(`lifecycle-delete-${position}`),
      reasonId: "module:synthetic:provider-delete"
    },
    {
      id: `deferred_message_source_action:lifecycle-delete-${position}`,
      occurrenceId: `source_occurrence:lifecycle-delete-${position}`,
      position,
      fingerprint: position.repeat(64).slice(0, 64)
    }
  ) as InboxV2DeferredLifecycleSourceAction;
}

function editedBlocks(text: string) {
  return [
    {
      blockKey: "body-1",
      kind: "text" as const,
      role: "body" as const,
      text,
      language: "en"
    }
  ];
}

function editAction(
  suffix: string,
  normalizedContentDigestSha256: string
): InboxV2DeferredLifecycleSourceAction {
  return makePendingDeferredAction(
    {
      kind: "edit",
      normalizedEvent: deferredNormalizedEvent(`lifecycle-edit-${suffix}`),
      normalizedContentDigestSha256
    },
    {
      id: `deferred_message_source_action:lifecycle-edit-${suffix}`,
      occurrenceId: `source_occurrence:lifecycle-edit-${suffix}`,
      position: "10",
      fingerprint: "e".repeat(64)
    }
  ) as InboxV2DeferredLifecycleSourceAction;
}

function sourceActionPlan(
  action: InboxV2DeferredLifecycleSourceAction
): ApplySourceActionInput["plan"] {
  return {
    intent: { kind: "source_action", deferredAction: action }
  } as ApplySourceActionInput["plan"];
}

function exactPosition(
  action:
    | InboxV2DeferredLifecycleSourceAction
    | InboxV2DeferredMessageSourceAction
): string {
  const ordering = action.semanticProof.ordering;
  if (ordering.kind !== "monotonic_exact") {
    throw new Error("Expected exact monotonic lifecycle ordering.");
  }
  return ordering.position;
}

function retainedDeleteEffect(
  action: InboxV2DeferredLifecycleSourceAction,
  target: InboxV2ExternalMessageReference,
  resolvedOccurrence: InboxV2SourceOccurrence,
  suffix: string,
  recordedAt: string
): Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "provider_delete_retain_local" }
> {
  if (action.action.kind !== "delete") {
    throw new Error("Retained provider delete requires a delete action.");
  }
  const semanticProof = fixtureProviderSemanticProof({
    semanticId: "core:message.lifecycle.delete.observed",
    capabilityId: "core:message-delete",
    normalizedInboundEvent: action.action.normalizedEvent,
    externalMessageReference: fixtureReference(
      "external_message_reference",
      target.id
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      resolvedOccurrence.id
    ),
    actor: fixtureSourceIdentityReference,
    occurredAt: action.observedAt,
    recordedAt: action.recordedAt
  });
  const operation = {
    tenantId: action.tenantId,
    id: `message_provider_lifecycle_operation:${suffix}`,
    message: target.message,
    action: "delete" as const,
    origin: "provider_observed" as const,
    externalMessageReference: fixtureReference(
      "external_message_reference",
      target.id
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      resolvedOccurrence.id
    ),
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    outboundRoute: null,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    capabilityRevision: resolvedOccurrence.descriptor.capabilityRevision,
    appActor: null,
    actionParticipant: null,
    automationCausation: null,
    outcome: { state: "observed" as const },
    deleteLocalPolicy: { effect: "not_evaluated" as const },
    revision: "1",
    occurredAt: action.observedAt,
    recordedAt: action.recordedAt,
    createdAt: action.recordedAt,
    updatedAt: action.recordedAt
  };
  const retainPolicy = {
    effect: "retain_local" as const,
    decisionEvent: fixtureReference(
      "event",
      `event:provider-delete-retain-local-${suffix}`
    ),
    decisionRevision: "1",
    decidedAt: recordedAt
  };
  const afterOperation = {
    ...operation,
    deleteLocalPolicy: retainPolicy,
    revision: "2",
    updatedAt: recordedAt
  };
  return inboxV2DeferredMessageSourceActionEffectProofSchema.parse({
    kind: "provider_delete_retain_local",
    operationCreationCommit: {
      tenantId: action.tenantId,
      message: fixtureMessage("source"),
      timelineItem: fixtureTimelineItem("external"),
      externalMessageReference: target,
      sourceOccurrence: resolvedOccurrence,
      outboundRoute: null,
      outboundBindingSnapshot: null,
      actionParticipantSnapshot: null,
      providerSemanticProof: semanticProof,
      semanticOrderingCommit:
        fixtureProviderSemanticOrderingCommit(semanticProof),
      routeConsumption: null,
      operation
    },
    policyTransitionCommit: {
      tenantId: action.tenantId,
      before: operation,
      transition: {
        operation: fixtureReference(
          "message_provider_lifecycle_operation",
          operation.id
        ),
        expectedRevision: "1",
        resultingRevision: "2",
        outcome: afterOperation.outcome,
        deleteLocalPolicy: retainPolicy,
        resultProof: null,
        recordedAt
      },
      after: afterOperation
    }
  }) as Extract<
    InboxV2DeferredMessageSourceActionEffectProof,
    { kind: "provider_delete_retain_local" }
  >;
}

function providerObservedEditEffect(
  action: InboxV2DeferredLifecycleSourceAction,
  target: InboxV2ExternalMessageReference,
  resolvedOccurrence: InboxV2SourceOccurrence,
  blocks: ReturnType<typeof editedBlocks>,
  recordedAt: string
): Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "message_lifecycle" }
> {
  if (action.action.kind !== "edit") {
    throw new Error("Provider edit effect requires an edit action.");
  }
  const beforeContent = fixtureContent();
  const afterContent = fixtureContent({
    state: {
      kind: "available",
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: "2",
    updatedAt: recordedAt
  });
  const beforeMessage = fixtureMessage("source", beforeContent);
  const beforeTimelineItem = fixtureTimelineItem("external");
  const afterMessage = {
    ...beforeMessage,
    content: inboxV2TimelineContentHeadOf(afterContent as never),
    revision: "2",
    updatedAt: recordedAt
  };
  const afterTimelineItem = {
    ...beforeTimelineItem,
    subject: {
      kind: "message" as const,
      message: target.message,
      messageRevision: "2"
    },
    revision: "2",
    updatedAt: recordedAt
  };
  const semanticProof = fixtureProviderSemanticProof({
    semanticId: "core:message.lifecycle.edit.observed",
    capabilityId: "core:message-edit",
    normalizedInboundEvent: action.action.normalizedEvent,
    externalMessageReference: fixtureReference(
      "external_message_reference",
      target.id
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      resolvedOccurrence.id
    ),
    actor: fixtureSourceIdentityReference,
    occurredAt: action.observedAt,
    recordedAt: action.recordedAt
  });
  const operation = {
    tenantId: action.tenantId,
    id: "message_provider_lifecycle_operation:edit-before-create",
    message: target.message,
    action: "edit" as const,
    origin: "provider_observed" as const,
    externalMessageReference: fixtureReference(
      "external_message_reference",
      target.id
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      resolvedOccurrence.id
    ),
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    outboundRoute: null,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    capabilityRevision: resolvedOccurrence.descriptor.capabilityRevision,
    appActor: null,
    actionParticipant: null,
    automationCausation: null,
    outcome: { state: "observed" as const },
    deleteLocalPolicy: null,
    revision: "1",
    occurredAt: action.observedAt,
    recordedAt: action.recordedAt,
    createdAt: action.recordedAt,
    updatedAt: action.recordedAt
  };
  const providerOperationCreationCommit = {
    tenantId: action.tenantId,
    message: beforeMessage,
    timelineItem: beforeTimelineItem,
    externalMessageReference: target,
    sourceOccurrence: resolvedOccurrence,
    outboundRoute: null,
    outboundBindingSnapshot: null,
    actionParticipantSnapshot: null,
    providerSemanticProof: semanticProof,
    semanticOrderingCommit:
      fixtureProviderSemanticOrderingCommit(semanticProof),
    routeConsumption: null,
    operation
  };
  return inboxV2DeferredMessageSourceActionEffectProofSchema.parse({
    kind: "message_lifecycle",
    commit: {
      tenantId: action.tenantId,
      beforeMessage,
      beforeTimelineItem,
      contentTransition: {
        tenantId: action.tenantId,
        before: beforeContent,
        transition: {
          kind: "edit",
          expectedRevision: "1",
          resultingRevision: "2",
          event: fixtureReference("event", "event:provider-edit-before-create"),
          occurredAt: recordedAt
        },
        after: afterContent
      },
      providerOperation: operation,
      providerOperationCreationCommit,
      actionParticipantSnapshot: fixtureParticipant("source"),
      revision: {
        tenantId: action.tenantId,
        id: "message_revision:provider-edit-before-create",
        message: target.message,
        timelineItem: target.timelineItem,
        expectedPreviousRevision: "1",
        messageRevision: "2",
        change: {
          kind: "edited",
          beforeContent: beforeMessage.content,
          afterContent: afterMessage.content,
          providerOperation: fixtureReference(
            "message_provider_lifecycle_operation",
            operation.id
          )
        },
        actionAttribution: {
          actionParticipant: beforeMessage.authorParticipant,
          appActor: null,
          sourceOccurrence: fixtureReference(
            "source_occurrence",
            resolvedOccurrence.id
          ),
          automationCausation: null
        },
        occurredAt: action.observedAt,
        recordedAt,
        recordRevision: "1",
        createdAt: recordedAt
      },
      afterMessage,
      afterTimelineItem
    }
  }) as Extract<
    InboxV2DeferredMessageSourceActionEffectProof,
    { kind: "message_lifecycle" }
  >;
}
