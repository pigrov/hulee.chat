import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  decideInboxV2ImmutableRecordWrite,
  INBOX_V2_ATOMIC_MUTATION_COMMIT_SCHEMA_ID,
  inboxV2AtomicMutationCommitEnvelopeSchema,
  inboxV2AtomicMutationCommitSchema,
  inboxV2DomainEventSchema,
  inboxV2OutboxIntentSchema,
  inboxV2TenantRbacAudienceImpactSchema,
  inboxV2TenantStreamChangeSchema,
  inboxV2TenantStreamCommitSchema,
  parseInboxV2AtomicMutationCommitEnvelope
} from "../index";

const tenantId = "tenant:tenant-1";
const streamEpoch = "stream:epoch:0001";
const committedAt = "2026-07-11T09:00:00.000Z";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const archivedV1AtomicMutationBytes =
  '{"schemaId":"core:inbox-v2.atomic-mutation-commit","schemaVersion":"v1","payload":{"headBefore":{"tenantId":"tenant:tenant-1","streamEpoch":"stream:epoch:0001","lastPosition":"0","minRetainedPosition":"0"},"commit":{"tenantId":"tenant:tenant-1","streamEpoch":"stream:epoch:0001","id":"commit:archived-1","position":"1","schemaVersion":"v1","correlationId":"correlation:archived-1","commandIds":[],"clientMutationIds":[],"changeIds":["change:archived-1"],"eventIds":["event:archived-1"],"outboxIntentIds":[],"audienceImpact":{"kind":"none"},"committedAt":"2026-07-11T09:00:00.000Z","commitHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"changes":[{"reference":{"tenantId":"tenant:tenant-1","commitId":"commit:archived-1","streamPosition":"1","changeId":"change:archived-1","ordinal":"1"},"entity":{"tenantId":"tenant:tenant-1","entityTypeId":"core:message","entityId":"message:archived-1"},"resultingRevision":"1","timeline":null,"audience":"conversation_external","state":{"kind":"tombstone","reasonId":"core:privacy-erased","stateHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","domainCommitReference":{"tenantId":"tenant:tenant-1","recordId":"domain-commit:archived-1","schemaId":"core:inbox-v2.message-tombstone","schemaVersion":"v1","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}],"events":[{"tenantId":"tenant:tenant-1","id":"event:archived-1","typeId":"core:message.changed","payloadSchemaId":"core:inbox-v2.message-change-fact","payloadSchemaVersion":"v1","commit":{"tenantId":"tenant:tenant-1","streamEpoch":"stream:epoch:0001","commitId":"commit:archived-1","streamPosition":"1"},"ordinal":"1","changeIds":["change:archived-1"],"subjects":[{"tenantId":"tenant:tenant-1","entityTypeId":"core:message","entityId":"message:archived-1"}],"payloadReference":null,"correlationId":"correlation:archived-1","commandIds":[],"clientMutationIds":[],"authorizationDecisionRefs":[],"accessEffect":{"kind":"none"},"occurredAt":"2026-07-11T09:00:00.000Z","recordedAt":"2026-07-11T09:00:00.000Z","eventHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],"outboxIntents":[],"commandRecords":[],"headAfter":{"tenantId":"tenant:tenant-1","streamEpoch":"stream:epoch:0001","lastPosition":"1","minRetainedPosition":"0"}}}';

function authorizationDecision(outcome: "allowed" | "denied" = "allowed") {
  return {
    tenantId,
    id: `authorization-decision:${outcome}-1`,
    authorizationEpoch: "authorization:epoch-0001",
    principal: {
      kind: "employee" as const,
      employee: {
        tenantId,
        kind: "employee" as const,
        id: "employee:employee-1"
      }
    },
    permissionId: "core:message.write",
    resourceScopeId: "core:message",
    resource: {
      tenantId,
      entityTypeId: "core:message",
      entityId: "message:message-1"
    },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: hashA,
    outcome,
    decidedAt: committedAt,
    notAfter: "2026-07-11T10:00:00.000Z"
  };
}

function payloadReference(recordId = "payload:message-1") {
  return {
    tenantId,
    recordId,
    schemaId: "core:inbox-v2.message",
    schemaVersion: "v1",
    digest: hashA
  };
}

function change(input?: {
  changeId?: string;
  ordinal?: string;
  entityTypeId?: string;
  entityId?: string;
  audience?: "conversation_external" | "staff_only";
}): z.input<typeof inboxV2TenantStreamChangeSchema> {
  return {
    reference: {
      tenantId,
      commitId: "commit:commit-1",
      streamPosition: "1",
      changeId: input?.changeId ?? "change:change-1",
      ordinal: input?.ordinal ?? "1"
    },
    entity: {
      tenantId,
      entityTypeId: input?.entityTypeId ?? "core:message",
      entityId: input?.entityId ?? "message:message-1"
    },
    resultingRevision: "1",
    timeline: null,
    audience: input?.audience ?? ("conversation_external" as const),
    state: {
      kind: "upsert" as const,
      stateSchemaId: "core:inbox-v2.message",
      stateSchemaVersion: "v1",
      stateHash: hashA,
      payloadReference: payloadReference(),
      domainCommitReference: payloadReference("domain-commit:message-1")
    }
  };
}

function event(
  changeIds = ["change:change-1"],
  subjects = [change().entity]
): z.input<typeof inboxV2DomainEventSchema> {
  return {
    tenantId,
    id: "event:event-1",
    typeId: "core:message.changed" as const,
    payloadSchemaId: "core:inbox-v2.message-change-fact",
    payloadSchemaVersion: "v1",
    commit: {
      tenantId,
      streamEpoch,
      commitId: "commit:commit-1",
      streamPosition: "1"
    },
    ordinal: "1",
    changeIds,
    subjects,
    payloadReference: null,
    correlationId: "correlation:correlation-1",
    commandIds: ["command:command-1"],
    clientMutationIds: ["mutation:mutation-1"],
    authorizationDecisionRefs: [authorizationDecision()],
    accessEffect: { kind: "none" as const },
    occurredAt: committedAt,
    recordedAt: committedAt,
    eventHash: hashA
  };
}

function bundle(): z.input<typeof inboxV2AtomicMutationCommitSchema> {
  const firstChange = change();
  const firstEvent = event();
  return {
    headBefore: {
      tenantId,
      streamEpoch,
      lastPosition: "0",
      minRetainedPosition: "0"
    },
    commit: {
      tenantId,
      streamEpoch,
      id: "commit:commit-1",
      position: "1",
      schemaVersion: "v1",
      correlationId: "correlation:correlation-1",
      commandIds: ["command:command-1"],
      clientMutationIds: ["mutation:mutation-1"],
      authorizationDecisionRefs: [authorizationDecision()],
      changeIds: [firstChange.reference.changeId],
      eventIds: [firstEvent.id],
      outboxIntentIds: [],
      audienceImpact: { kind: "none" as const },
      committedAt,
      commitHash: hashA
    },
    changes: [firstChange],
    events: [firstEvent],
    outboxIntents: [],
    commandRecords: [commandRecord()],
    headAfter: {
      tenantId,
      streamEpoch,
      lastPosition: "1",
      minRetainedPosition: "0"
    }
  };
}

function providerIntent(): z.input<typeof inboxV2OutboxIntentSchema> {
  return {
    tenantId,
    id: "outbox-intent:dispatch-1",
    typeId: "core:provider.dispatch" as const,
    handlerId: "core:provider-dispatch-handler",
    effectClass: "provider_io" as const,
    commit: {
      tenantId,
      streamEpoch,
      commitId: "commit:commit-1",
      streamPosition: "1"
    },
    eventId: "event:event-1",
    changeIds: ["change:dispatch-1"],
    payloadReference: dispatchPayloadReference(),
    consumerDedupeKey: hashB,
    correlationId: "correlation:correlation-1",
    availableAt: committedAt,
    intentHash: hashB
  };
}

function dispatchPayloadReference() {
  return {
    ...payloadReference("dispatch:dispatch-1"),
    schemaId: "core:inbox-v2.outbound-dispatch"
  };
}

function outboundDispatchChange(): z.input<
  typeof inboxV2TenantStreamChangeSchema
> {
  const base = change({
    changeId: "change:dispatch-1",
    ordinal: "2",
    entityTypeId: "core:outbound-dispatch",
    entityId: "outbound_dispatch:dispatch-1"
  });
  if (base.state.kind !== "upsert") {
    throw new Error("Fixture invariant: dispatch change must be an upsert.");
  }
  return {
    ...base,
    state: {
      ...base.state,
      stateSchemaId: "core:inbox-v2.outbound-dispatch",
      payloadReference: dispatchPayloadReference()
    }
  };
}

function providerLifecycleIntent(): z.input<typeof inboxV2OutboxIntentSchema> {
  return {
    ...providerIntent(),
    id: "outbox-intent:message-lifecycle-1",
    typeId: "core:provider.message_lifecycle",
    handlerId: "core:provider-message-lifecycle-handler",
    changeIds: ["change:message-lifecycle-1"],
    payloadReference: providerLifecyclePayloadReference()
  };
}

function providerLifecyclePayloadReference() {
  return {
    ...payloadReference("message-provider-lifecycle-operation:operation-1"),
    schemaId: "core:inbox-v2.message-provider-lifecycle-operation"
  };
}

function providerLifecycleChange(): z.input<
  typeof inboxV2TenantStreamChangeSchema
> {
  const base = change({
    changeId: "change:message-lifecycle-1",
    ordinal: "2",
    entityTypeId: "core:message-provider-lifecycle-operation",
    entityId: "message_provider_lifecycle_operation:operation-1"
  });
  if (base.state.kind !== "upsert") {
    throw new Error(
      "Fixture invariant: provider lifecycle change must be an upsert."
    );
  }
  return {
    ...base,
    state: {
      ...base.state,
      stateSchemaId: "core:inbox-v2.message-provider-lifecycle-operation",
      payloadReference: providerLifecyclePayloadReference()
    }
  };
}

function providerReactionIntent(): z.input<typeof inboxV2OutboxIntentSchema> {
  return {
    ...providerIntent(),
    id: "outbox-intent:message-reaction-1",
    typeId: "core:provider.message_reaction",
    handlerId: "core:provider-message-reaction-handler",
    changeIds: ["change:message-reaction-1"],
    payloadReference: providerReactionPayloadReference()
  };
}

function providerReactionPayloadReference() {
  return {
    ...payloadReference("message-reaction-transition:transition-1"),
    schemaId: "core:inbox-v2.message-reaction-transition"
  };
}

function providerReactionChange(): z.input<
  typeof inboxV2TenantStreamChangeSchema
> {
  const base = change({
    changeId: "change:message-reaction-1",
    ordinal: "2",
    entityTypeId: "core:message-reaction-transition",
    entityId: "message_reaction_transition:transition-1"
  });
  if (base.state.kind !== "upsert") {
    throw new Error(
      "Fixture invariant: provider reaction transition must be an upsert."
    );
  }
  return {
    ...base,
    state: {
      ...base.state,
      stateSchemaId: "core:inbox-v2.message-reaction-transition",
      payloadReference: providerReactionPayloadReference()
    }
  };
}

function commandRecord() {
  return {
    scope: {
      tenantId,
      principal: {
        kind: "employee" as const,
        employee: {
          tenantId,
          kind: "employee" as const,
          id: "employee:employee-1"
        }
      },
      commandTypeId: "core:timeline.command",
      clientMutationId: "mutation:mutation-1"
    },
    commandId: "command:command-1",
    firstRequestId: "request:request-1",
    requestHash: hashA,
    state: {
      kind: "completed" as const,
      authorizationDecisionRefs: [authorizationDecision()],
      authorizedAt: committedAt,
      authorizationNotAfter: "2026-07-11T10:00:00.000Z",
      result: {
        tenantId,
        commandId: "command:command-1",
        principal: {
          kind: "employee" as const,
          employee: {
            tenantId,
            kind: "employee" as const,
            id: "employee:employee-1"
          }
        },
        clientMutationId: "mutation:mutation-1",
        requestHash: hashA,
        authorizationEpoch: "authorization:epoch-0001",
        recordedAt: committedAt,
        kind: "committed" as const,
        commit: {
          tenantId,
          streamEpoch,
          commitId: "commit:commit-1",
          streamPosition: "1"
        },
        resultReference: null
      }
    }
  };
}

describe("Inbox V2 tenant stream", () => {
  it("appends one immutable multi-entity mutation at one exact head position", () => {
    const candidate = bundle();
    const second = change({
      changeId: "change:change-2",
      ordinal: "2",
      entityTypeId: "core:work-item",
      entityId: "work_item:work-1"
    });
    candidate.changes.push(second);
    candidate.commit.changeIds.push(second.reference.changeId);
    candidate.events[0]!.changeIds.push(second.reference.changeId);
    candidate.events[0]!.subjects.push(second.entity);

    expect(inboxV2AtomicMutationCommitSchema.safeParse(candidate).success).toBe(
      true
    );
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...candidate,
        changes: [
          candidate.changes[0],
          { ...second, reference: { ...second.reference, ordinal: "3" } }
        ]
      }).success
    ).toBe(false);
  });

  it("rejects zero, gaps and stale-head commit-order races", () => {
    expect(
      inboxV2TenantStreamCommitSchema.safeParse({
        ...bundle().commit,
        position: "0"
      }).success
    ).toBe(false);
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...bundle(),
        commit: { ...bundle().commit, position: "2" },
        headAfter: { ...bundle().headAfter, lastPosition: "2" }
      }).success
    ).toBe(false);
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...bundle(),
        headBefore: { ...bundle().headBefore, lastPosition: "1" }
      }).success
    ).toBe(false);
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...bundle(),
        commandRecords: []
      }).success
    ).toBe(false);
    const expiredAuthorization = bundle();
    if (expiredAuthorization.commandRecords[0]!.state.kind === "completed") {
      expiredAuthorization.commandRecords[0]!.state.authorizationNotAfter =
        committedAt;
    }
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(expiredAuthorization).success
    ).toBe(false);
    const widenedAuthorization = bundle();
    if (widenedAuthorization.commandRecords[0]!.state.kind === "completed") {
      widenedAuthorization.commandRecords[0]!.state.authorizationNotAfter =
        "2099-01-01T00:00:00.000Z";
    }
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(widenedAuthorization).success
    ).toBe(false);
  });

  it("keeps canonical tombstones distinct from recipient invalidation", () => {
    expect(
      inboxV2TenantStreamChangeSchema.safeParse({
        ...change(),
        state: {
          kind: "invalidate",
          reasonId: "core:authorization-revoked"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2TenantStreamChangeSchema.safeParse({
        ...change(),
        state: {
          ...change().state,
          payloadReference: {
            ...payloadReference(),
            tenantId: "tenant:tenant-2"
          }
        }
      }).success
    ).toBe(false);
  });

  it("allows only provider-neutral core events and reference-only payloads", () => {
    expect(inboxV2DomainEventSchema.safeParse(event()).success).toBe(true);
    expect(
      inboxV2DomainEventSchema.safeParse({
        ...event(),
        typeId: "core:source-occurrence.changed"
      }).success
    ).toBe(true);
    expect(
      inboxV2DomainEventSchema.safeParse({
        ...event(),
        typeId: "core:outbound-dispatch.changed"
      }).success
    ).toBe(true);
    expect(
      inboxV2DomainEventSchema.safeParse({
        ...event(),
        typeId: "core:attachment-materialization.changed"
      }).success
    ).toBe(true);
    expect(
      inboxV2DomainEventSchema.safeParse({
        ...event(),
        typeId: "core:telegram.message-received"
      }).success
    ).toBe(false);
    expect(
      inboxV2DomainEventSchema.safeParse({
        ...event(),
        payloadReference: {
          ...payloadReference("event-payload:event-1"),
          tenantId: "tenant:tenant-2",
          schemaId: "core:inbox-v2.message-change-fact"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2DomainEventSchema.safeParse({
        ...event(),
        providerPayload: { text: "must not be copied" }
      }).success
    ).toBe(false);
    expect(
      inboxV2DomainEventSchema.safeParse({
        ...event(),
        typeId: "module:example-adapter:message-observed"
      }).success
    ).toBe(true);
    expect(
      inboxV2TenantStreamChangeSchema.safeParse({
        ...change(),
        state: {
          ...change().state,
          payloadReference: {
            ...payloadReference(),
            schemaId: "core:inbox-v2.wrong-state"
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2DomainEventSchema.safeParse({
        ...event(),
        payloadReference: payloadReference("event-payload:event-1")
      }).success
    ).toBe(false);
    const lostCorrelation = bundle();
    lostCorrelation.events[0]!.clientMutationIds = [];
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(lostCorrelation).success
    ).toBe(false);
    const injectedDecision = bundle();
    injectedDecision.events[0]!.authorizationDecisionRefs[0]!.id =
      "authorization-decision:injected";
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(injectedDecision).success
    ).toBe(false);
  });

  it("separates immutable outbox intent from events and blocks staff-note dispatch", () => {
    const withDispatch = bundle();
    const intent = providerIntent();
    const dispatchChange = outboundDispatchChange();
    withDispatch.changes.push(dispatchChange);
    withDispatch.commit.changeIds.push(dispatchChange.reference.changeId);
    withDispatch.events[0]!.changeIds.push(dispatchChange.reference.changeId);
    withDispatch.events[0]!.subjects.push(dispatchChange.entity);
    withDispatch.commit.outboxIntentIds = [intent.id];
    withDispatch.outboxIntents = [intent];
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(withDispatch).success
    ).toBe(true);
    expect(
      inboxV2OutboxIntentSchema.safeParse({
        ...intent,
        payloadReference: payloadReference("dispatch:opaque-message")
      }).success
    ).toBe(false);
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...withDispatch,
        outboxIntents: [
          {
            ...intent,
            changeIds: [withDispatch.changes[0]!.reference.changeId]
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboxIntentSchema.safeParse({
        ...intent,
        payloadReference: {
          ...intent.payloadReference!,
          tenantId: "tenant:tenant-2"
        }
      }).success
    ).toBe(false);

    const staffOnly = {
      ...withDispatch,
      changes: [
        change({
          entityTypeId: "core:staff-note",
          entityId: "staff_note:note-1",
          audience: "staff_only"
        })
      ]
    };
    expect(inboxV2AtomicMutationCommitSchema.safeParse(staffOnly).success).toBe(
      false
    );
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...withDispatch,
        outboxIntents: [
          { ...intent, effectClass: "workflow", payloadReference: null }
        ]
      }).success
    ).toBe(false);
  });

  it("routes provider message lifecycle through its own exact outbox payload", () => {
    const withLifecycle = bundle();
    const intent = providerLifecycleIntent();
    const lifecycleChange = providerLifecycleChange();
    withLifecycle.changes.push(lifecycleChange);
    withLifecycle.commit.changeIds.push(lifecycleChange.reference.changeId);
    withLifecycle.events[0]!.changeIds.push(lifecycleChange.reference.changeId);
    withLifecycle.events[0]!.subjects.push(lifecycleChange.entity);
    withLifecycle.commit.outboxIntentIds = [intent.id];
    withLifecycle.outboxIntents = [intent];

    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(withLifecycle).success
    ).toBe(true);
    expect(
      inboxV2OutboxIntentSchema.safeParse({
        ...intent,
        typeId: "core:provider.dispatch"
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboxIntentSchema.safeParse({
        ...intent,
        payloadReference: dispatchPayloadReference()
      }).success
    ).toBe(false);
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...withLifecycle,
        changes: [
          {
            ...lifecycleChange,
            entity: {
              ...lifecycleChange.entity,
              entityTypeId: "core:outbound-dispatch"
            }
          }
        ]
      }).success
    ).toBe(false);

    const duplicateOperationChange = {
      ...lifecycleChange,
      reference: {
        ...lifecycleChange.reference,
        changeId: "change:message-lifecycle-2",
        ordinal: "3"
      },
      entity: {
        ...lifecycleChange.entity,
        entityId: "message_provider_lifecycle_operation:operation-2"
      }
    };
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...withLifecycle,
        commit: {
          ...withLifecycle.commit,
          changeIds: [
            ...withLifecycle.commit.changeIds,
            duplicateOperationChange.reference.changeId
          ]
        },
        changes: [...withLifecycle.changes, duplicateOperationChange],
        events: [
          {
            ...withLifecycle.events[0]!,
            changeIds: [
              ...withLifecycle.events[0]!.changeIds,
              duplicateOperationChange.reference.changeId
            ],
            subjects: [
              ...withLifecycle.events[0]!.subjects,
              duplicateOperationChange.entity
            ]
          }
        ],
        outboxIntents: [
          {
            ...intent,
            changeIds: [
              lifecycleChange.reference.changeId,
              duplicateOperationChange.reference.changeId
            ]
          }
        ]
      }).success
    ).toBe(false);
  });

  it("routes a provider reaction through one exact versioned transition payload", () => {
    const withReaction = bundle();
    const intent = providerReactionIntent();
    const reactionChange = providerReactionChange();
    withReaction.changes.push(reactionChange);
    withReaction.commit.changeIds.push(reactionChange.reference.changeId);
    withReaction.events[0]!.changeIds.push(reactionChange.reference.changeId);
    withReaction.events[0]!.subjects.push(reactionChange.entity);
    withReaction.commit.outboxIntentIds = [intent.id];
    withReaction.outboxIntents = [intent];

    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(withReaction).success
    ).toBe(true);
    expect(
      inboxV2OutboxIntentSchema.safeParse({
        ...intent,
        payloadReference: {
          ...providerReactionPayloadReference(),
          schemaVersion: "v2"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboxIntentSchema.safeParse({
        ...intent,
        payloadReference: providerLifecyclePayloadReference()
      }).success
    ).toBe(false);
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...withReaction,
        changes: [
          {
            ...reactionChange,
            entity: {
              ...reactionChange.entity,
              entityTypeId: "core:message-provider-lifecycle-operation"
            }
          }
        ]
      }).success
    ).toBe(false);

    const duplicateTransitionChange = {
      ...reactionChange,
      reference: {
        ...reactionChange.reference,
        changeId: "change:message-reaction-2",
        ordinal: "3"
      },
      entity: {
        ...reactionChange.entity,
        entityId: "message_reaction_transition:transition-2"
      }
    };
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse({
        ...withReaction,
        commit: {
          ...withReaction.commit,
          changeIds: [
            ...withReaction.commit.changeIds,
            duplicateTransitionChange.reference.changeId
          ]
        },
        changes: [...withReaction.changes, duplicateTransitionChange],
        events: [
          {
            ...withReaction.events[0]!,
            changeIds: [
              ...withReaction.events[0]!.changeIds,
              duplicateTransitionChange.reference.changeId
            ],
            subjects: [
              ...withReaction.events[0]!.subjects,
              duplicateTransitionChange.entity
            ]
          }
        ],
        outboxIntents: [
          {
            ...intent,
            changeIds: [
              reactionChange.reference.changeId,
              duplicateTransitionChange.reference.changeId
            ]
          }
        ]
      }).success
    ).toBe(false);
  });

  it("treats an immutable ID with changed version/hash as a conflict", () => {
    const identity = {
      tenantId,
      recordTypeId: "core:tenant-stream-commit",
      recordId: "commit:commit-1",
      schemaVersion: "v1",
      recordHash: hashA
    };
    expect(
      decideInboxV2ImmutableRecordWrite({ incoming: identity, existing: null })
    ).toEqual({ kind: "insert" });
    expect(
      decideInboxV2ImmutableRecordWrite({
        incoming: identity,
        existing: identity
      })
    ).toEqual({ kind: "duplicate" });
    expect(
      decideInboxV2ImmutableRecordWrite({
        incoming: { ...identity, recordHash: hashB },
        existing: identity
      })
    ).toEqual({
      kind: "conflict",
      errorCode: "stream.immutable_record_conflict"
    });
    expect(
      decideInboxV2ImmutableRecordWrite({
        incoming: { ...identity, tenantId: "tenant:tenant-2" },
        existing: identity
      })
    ).toEqual({ kind: "insert" });
  });

  it("binds v1 atomic envelopes to a v1 tenant commit and rejects forward versions", () => {
    const envelope = {
      schemaId: INBOX_V2_ATOMIC_MUTATION_COMMIT_SCHEMA_ID,
      schemaVersion: "v1",
      payload: bundle()
    };
    expect(
      inboxV2AtomicMutationCommitEnvelopeSchema.safeParse(envelope).success
    ).toBe(true);
    expect(parseInboxV2AtomicMutationCommitEnvelope(envelope).kind).toBe(
      "parsed"
    );
    expect(
      parseInboxV2AtomicMutationCommitEnvelope(
        JSON.parse(archivedV1AtomicMutationBytes) as unknown
      ).kind
    ).toBe("parsed");
    expect(
      parseInboxV2AtomicMutationCommitEnvelope({
        ...envelope,
        schemaVersion: "v2"
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "stream.schema_unsupported",
      cursorAdvance: null
    });
    expect(
      parseInboxV2AtomicMutationCommitEnvelope({
        ...envelope,
        payload: {
          ...envelope.payload,
          commit: { ...envelope.payload.commit, schemaVersion: "v2" }
        }
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "stream.envelope_invalid",
      cursorAdvance: null
    });
  });

  it("requires direct access impact to invalidate a real old-to-new epoch", () => {
    const candidate = bundle();
    const impact: NonNullable<
      z.input<typeof inboxV2TenantStreamCommitSchema>["audienceImpact"]
    > = {
      kind: "direct",
      impactId: "audience-impact:impact-1",
      deliveryFence: "invalidate_before_payload",
      affectedRecipients: [
        {
          employee: {
            tenantId,
            kind: "employee",
            id: "employee:employee-1"
          },
          relation: "previous",
          previousAuthorizationEpoch: "authorization:epoch-0001",
          resultingAuthorizationEpoch: "authorization:epoch-0002",
          invalidations: [{ kind: "recipient_scope" }],
          authorizationDecisionRefs: [
            {
              tenantId,
              id: "authorization-decision:decision-1",
              authorizationEpoch: "authorization:epoch-0002",
              principal: {
                kind: "employee",
                employee: {
                  tenantId,
                  kind: "employee",
                  id: "employee:employee-1"
                }
              },
              permissionId: "core:message.read",
              resourceScopeId: "core:message",
              resource: candidate.changes[0]!.entity,
              resourceAccessRevision: "2",
              decisionRevision: "1",
              decisionHash: hashA,
              outcome: "denied",
              decidedAt: committedAt,
              notAfter: "2026-07-11T10:00:00.000Z"
            }
          ]
        }
      ]
    };
    candidate.commit.audienceImpact = impact;
    expect(inboxV2AtomicMutationCommitSchema.safeParse(candidate).success).toBe(
      true
    );
    const wrongPrincipal = bundle();
    wrongPrincipal.commit.audienceImpact = structuredClone(impact);
    if (wrongPrincipal.commit.audienceImpact.kind === "direct") {
      const principal =
        wrongPrincipal.commit.audienceImpact.affectedRecipients[0]!
          .authorizationDecisionRefs[0]!.principal;
      if (principal.kind === "employee") {
        principal.employee.id = "employee:employee-2";
      }
    }
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(wrongPrincipal).success
    ).toBe(false);

    const wrongOutcome = bundle();
    wrongOutcome.commit.audienceImpact = structuredClone(impact);
    if (wrongOutcome.commit.audienceImpact.kind === "direct") {
      wrongOutcome.commit.audienceImpact.affectedRecipients[0]!.authorizationDecisionRefs[0]!.outcome =
        "allowed";
    }
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(wrongOutcome).success
    ).toBe(false);
    const insufficientPurge = bundle();
    insufficientPurge.commit.audienceImpact = structuredClone(impact);
    if (insufficientPurge.commit.audienceImpact.kind === "direct") {
      insufficientPurge.commit.audienceImpact.affectedRecipients[0]!.invalidations =
        [{ kind: "entity", entity: candidate.changes[0]!.entity }];
    }
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(insufficientPurge).success
    ).toBe(false);

    const mixed = bundle();
    mixed.commit.audienceImpact = structuredClone(impact);
    if (mixed.commit.audienceImpact.kind === "direct") {
      const recipient = mixed.commit.audienceImpact.affectedRecipients[0]!;
      recipient.relation = "both";
      recipient.authorizationDecisionRefs.push({
        ...recipient.authorizationDecisionRefs[0]!,
        id: "authorization-decision:allowed-retained",
        outcome: "allowed"
      });
    }
    expect(inboxV2AtomicMutationCommitSchema.safeParse(mixed).success).toBe(
      true
    );
    candidate.commit.audienceImpact = {
      ...impact,
      affectedRecipients: [
        {
          ...impact.affectedRecipients[0],
          resultingAuthorizationEpoch: "authorization:epoch-0001"
        }
      ]
    };
    expect(inboxV2AtomicMutationCommitSchema.safeParse(candidate).success).toBe(
      false
    );

    const missingImpact = bundle();
    missingImpact.events[0]!.typeId = "core:authorization.changed";
    missingImpact.events[0]!.accessEffect = {
      kind: "may_change_access",
      causes: ["rbac_or_direct_grant"]
    };
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(missingImpact).success
    ).toBe(false);
    const workRelationWithoutImpact = bundle();
    workRelationWithoutImpact.events[0]!.typeId = "core:work-item.changed";
    workRelationWithoutImpact.events[0]!.accessEffect = {
      kind: "may_change_access",
      causes: ["work_item_relation_or_state"]
    };
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(workRelationWithoutImpact)
        .success
    ).toBe(false);
  });

  it("keeps tenant-RBAC invalidation +1, tenant-safe and free of Employee fan-out", () => {
    const candidate = bundle();
    candidate.events[0]!.typeId = "core:authorization.changed";
    candidate.events[0]!.accessEffect = {
      kind: "may_change_access",
      causes: ["rbac_or_direct_grant"]
    };
    candidate.commit.audienceImpact = {
      kind: "tenant_rbac",
      impactId: "audience-impact:tenant-rbac-1",
      deliveryFence: "invalidate_before_payload",
      previousTenantRbacRevision: "7",
      resultingTenantRbacRevision: "8",
      invalidations: [
        { kind: "projection", projectionId: "core:authorization" }
      ],
      indexedFanoutPlanId: "audience-impact:tenant-rbac-plan-1"
    };

    expect(
      inboxV2TenantRbacAudienceImpactSchema.safeParse(
        candidate.commit.audienceImpact
      ).success
    ).toBe(true);
    expect(inboxV2AtomicMutationCommitSchema.safeParse(candidate).success).toBe(
      true
    );
    expect(
      inboxV2TenantRbacAudienceImpactSchema.safeParse({
        ...candidate.commit.audienceImpact,
        previousTenantRbacRevision: "0",
        resultingTenantRbacRevision: "1"
      }).success
    ).toBe(false);
    expect(
      inboxV2TenantRbacAudienceImpactSchema.safeParse({
        ...candidate.commit.audienceImpact,
        resultingTenantRbacRevision: "9"
      }).success
    ).toBe(false);
    expect(
      inboxV2TenantRbacAudienceImpactSchema.safeParse({
        ...candidate.commit.audienceImpact,
        affectedRecipients: [
          {
            employee: {
              tenantId,
              kind: "employee",
              id: "employee:employee-1"
            }
          }
        ]
      }).success
    ).toBe(false);

    if (candidate.commit.audienceImpact.kind === "tenant_rbac") {
      candidate.commit.audienceImpact.invalidations = [
        {
          kind: "entity",
          entity: {
            tenantId: "tenant:tenant-2",
            entityTypeId: "core:role",
            entityId: "role:role-1"
          }
        }
      ];
    }
    expect(inboxV2AtomicMutationCommitSchema.safeParse(candidate).success).toBe(
      false
    );
  });
});
