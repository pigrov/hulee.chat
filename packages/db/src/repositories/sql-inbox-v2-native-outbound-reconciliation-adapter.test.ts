import { createHash } from "node:crypto";

import {
  calculateInboxV2MessageContentDigest,
  inboxV2BigintCounterSchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2MessageTransportAssociationCommitSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceIdentityClaimSchema,
  inboxV2SourceOccurrenceSchema,
  inboxV2TimelineContentSchema,
  inboxV2TimelineContentHeadOf,
  type InboxV2ExternalMessageReference,
  type InboxV2BigintCounter,
  type InboxV2ConversationParticipant,
  type InboxV2MessageCreationCommit,
  type InboxV2MessageTransportOccurrenceLink,
  type InboxV2SourceIdentityClaim,
  type InboxV2SourceMessageReconciliationPlan,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";
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
  createInboxV2NativeOutboundCanonicalCallbacks,
  inboxV2NativeOutboundNoEffectDisposition,
  InboxV2NativeOutboundPersistenceInvariantError,
  type InboxV2NativeOutboundCanonicalPersistence,
  type InboxV2NativeOutboundEffectDisposition
} from "./sql-inbox-v2-native-outbound-reconciliation-adapter";
import {
  buildDeriveInboxV2NativeOutboundEffectDispositionSql,
  createSqlInboxV2NativeOutboundCanonicalCallbacks,
  createSqlInboxV2NativeOutboundCanonicalPersistence,
  createSqlInboxV2NativeOutboundProductionPlanner,
  createSqlInboxV2NativeOutboundReconciliationRuntime,
  type InboxV2NativeOutboundAuthorizationPort,
  type InboxV2NativeOutboundMessageCreationPersistencePlan,
  type InboxV2NativeOutboundOccurrenceAssociationPersistencePlan,
  type InboxV2NativeOutboundPersistencePlanner
} from "./sql-inbox-v2-native-outbound-persistence";
import {
  createSqlInboxV2SourceMessageReconciliationRepository,
  type CreateSqlInboxV2SourceMessageReconciliationRepositoryOptions,
  type InboxV2SourceMessageReconciliationCallbacks,
  type InboxV2SourceMessageReconciliationTransactionExecutor
} from "./sql-inbox-v2-source-message-reconciliation-repository";
import {
  INBOX_V2_NATIVE_OUTBOUND_OCCURRENCE_ATTACH_COMMAND_TYPE_ID,
  assertInboxV2NativeOutboundTransportAssociationAuthority,
  buildLockInboxV2NativeOutboundTransportAuthorSql,
  type InboxV2SafeGenericEnvelope
} from "./sql-inbox-v2-timeline-message-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

type MessageCreatePlan = Parameters<
  InboxV2SourceMessageReconciliationCallbacks["createMessage"]
>[1]["plan"];

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

describe("Inbox V2 native-outbound reconciliation adapter", () => {
  it("imports one source-authored native outbound Message once and replays without persistence", async () => {
    const plan = nativeOutboundPlan();
    const duplicatePlan = nativeOutboundPlan("b");
    const state = nativeState(plan);
    state.occurrences.set(
      duplicatePlan.sourceOccurrence.id,
      duplicatePlan.sourceOccurrence
    );
    const persistence = nativePersistence(state);
    const callbacks = fullCallbacks(
      createInboxV2NativeOutboundCanonicalCallbacks(persistence)
    );
    const repository = createSqlInboxV2SourceMessageReconciliationRepository(
      transactionExecutor(),
      {
        planAuthorizationVerifier: { verify: () => true },
        callbacks,
        dependencies: nativeDependencies(state)
      }
    );

    const first = await repository.reconcile({ plan });
    const duplicate = await repository.reconcile({ plan: duplicatePlan });
    const replay = await repository.reconcile({ plan });
    const duplicateReplay = await repository.reconcile({
      plan: duplicatePlan
    });

    expect(first.kind).toBe("message_created");
    expect(duplicate.kind).toBe("occurrence_attached");
    expect(replay.kind).toBe("already_reconciled");
    expect(duplicateReplay.kind).toBe("already_reconciled");
    expect(persistence.createMessage).toHaveBeenCalledTimes(1);
    expect(persistence.attachOccurrence).toHaveBeenCalledTimes(1);
    expect(
      first.kind === "message_created"
        ? first.sourceOccurrence.resolution.state
        : null
    ).toBe("resolved");
  });

  it("rejects non-native plans before invoking trusted persistence", async () => {
    const nativePlan = nativeOutboundPlan();
    const persistence = nativePersistence(nativeState(nativePlan));
    const callbacks =
      createInboxV2NativeOutboundCanonicalCallbacks(persistence);
    const inbound = materializedInboundPlan();

    await expect(
      callbacks.createMessage(executor(), {
        plan: inbound as Parameters<typeof callbacks.createMessage>[1]["plan"],
        candidateExternalMessageReference: candidateReference(inbound)
      })
    ).rejects.toBeInstanceOf(InboxV2NativeOutboundPersistenceInvariantError);
    expect(persistence.createMessage).not.toHaveBeenCalled();
  });

  it.each([
    "countsAsCustomerInbound",
    "createsUnread",
    "createsWorkItem",
    "requiresProviderIo",
    "createsOutboundDispatch",
    "notificationEligible"
  ] as const)("rolls back when %s is enabled", async (effect) => {
    const plan = nativeOutboundPlan();
    const state = nativeState(plan);
    const persistence = nativePersistence(state, {
      ...inboxV2NativeOutboundNoEffectDisposition,
      [effect]: true
    });
    const callbacks =
      createInboxV2NativeOutboundCanonicalCallbacks(persistence);
    const candidate = candidateReference(plan);

    await expect(
      callbacks.createMessage(executor(), {
        plan,
        candidateExternalMessageReference: candidate
      })
    ).rejects.toThrow(
      "Native outbound import cannot count as customer inbound"
    );
  });

  it("rejects a forged app actor even when persistence returns a canonical result", async () => {
    const plan = nativeOutboundPlan();
    const state = nativeState(plan);
    const candidate = candidateReference(plan);
    const valid = nativeCreationCommit(plan, candidate);
    const forged = {
      ...valid,
      message: {
        ...valid.message,
        appActor: {
          kind: "trusted_service" as const,
          trustedServiceId: "core:source-runtime"
        }
      }
    } as unknown as InboxV2MessageCreationCommit;
    const persistence: InboxV2NativeOutboundCanonicalPersistence = {
      createMessage: vi.fn(async () => ({
        kind: "committed" as const,
        result: canonicalResult(valid),
        proof: {
          commit: forged,
          effectDisposition: inboxV2NativeOutboundNoEffectDisposition
        }
      })),
      attachOccurrence: vi.fn(async () => ({
        kind: "conflict" as const,
        code: "source.message_reconciliation.callback_conflict" as const
      }))
    };
    const callbacks =
      createInboxV2NativeOutboundCanonicalCallbacks(persistence);

    await expect(
      callbacks.createMessage(executor(), {
        plan,
        candidateExternalMessageReference: candidate
      })
    ).rejects.toBeInstanceOf(InboxV2NativeOutboundPersistenceInvariantError);
    expect(
      state.occurrences.get(plan.sourceOccurrence.id)?.resolution.state
    ).toBe("pending");
  });

  it("rejects attaching a native occurrence authored by another source identity", async () => {
    const plan = nativeOutboundPlan();
    const secondPlan = nativeOutboundPlan("b");
    const state = nativeState(plan);
    const persistence = nativePersistence(state);
    const callbacks =
      createInboxV2NativeOutboundCanonicalCallbacks(persistence);
    const target = candidateReference(plan);
    const secondActor = secondPlan.sourceOccurrence.providerActor;
    if (secondActor?.kind !== "source_external_identity") {
      throw new Error("Native fixture has no source identity actor.");
    }
    const sourceOccurrence = inboxV2SourceOccurrenceSchema.parse({
      ...secondPlan.sourceOccurrence,
      providerActor: {
        kind: "source_external_identity",
        sourceExternalIdentity: {
          ...secondActor.sourceExternalIdentity,
          id: inboxV2SourceExternalIdentityIdSchema.parse(
            "source_external_identity:native-self-2"
          )
        }
      }
    });
    const authoredByAnotherIdentity = {
      ...secondPlan,
      sourceOccurrence
    } as MessageCreatePlan;

    await callbacks.createMessage(executor(), {
      plan,
      candidateExternalMessageReference: target
    });
    await expect(
      callbacks.attachOccurrence(executor(), {
        plan: authoredByAnotherIdentity,
        targetExternalMessageReference: target,
        reason: "exact_message_reuse"
      })
    ).rejects.toBeInstanceOf(InboxV2NativeOutboundPersistenceInvariantError);
  });

  it("fences duplicate native-outbound attachment to one trusted source identity and Conversation receive decision", () => {
    const originPlan = nativeOutboundPlan();
    const duplicatePlan = nativeOutboundPlan("b");
    const target = candidateReference(originPlan);
    const origin = nativeCreationCommit(originPlan, target);
    const association = nativeAssociationProof(
      duplicatePlan,
      target,
      origin,
      inboxV2NativeOutboundNoEffectDisposition
    );
    const context = nativeAssociationAuthorityContext(association);

    expect(() =>
      assertInboxV2NativeOutboundTransportAssociationAuthority(
        context,
        association.commit,
        association.sourceResolutionCommit
      )
    ).not.toThrow();
    expect(() =>
      assertInboxV2NativeOutboundTransportAssociationAuthority(
        { ...context, commandTypeId: "core:message.receive" },
        association.commit,
        association.sourceResolutionCommit
      )
    ).toThrow("one exact source-authored outbound Message");
    expect(() =>
      assertInboxV2NativeOutboundTransportAssociationAuthority(
        {
          ...context,
          authorizationDecisionRefs: context.authorizationDecisionRefs.map(
            (decision) => ({
              ...decision,
              permissionId: "core:message.send_internal" as never
            })
          )
        },
        association.commit,
        association.sourceResolutionCommit
      )
    ).toThrow("one exact source-authored outbound Message");

    const authorFence = new PgDialect().sqlToQuery(
      buildLockInboxV2NativeOutboundTransportAuthorSql({
        commit: association.commit,
        sourceResolutionCommit: association.sourceResolutionCommit
      })
    );
    expect(authorFence.sql).toContain("attribution_row.app_actor_kind is null");
    expect(authorFence.sql).toContain(
      "author_row.subject_kind = 'source_external_identity'"
    );
    expect(authorFence.sql).toContain("for share of message_row");
    expect(authorFence.sql).toContain("for update of observed_occurrence");
  });

  it("owns deterministic production creation planning and exposes only the narrow authorization request", async () => {
    const plan = nativeOutboundPlan();
    const target = candidateReference(plan);
    const fixture = nativeCreationCommit(plan, target);
    const transaction = nativeParticipantExecutor(fixture.authorParticipant);
    const authorizedMutation = opaqueAuthorizedMutation();
    const authorize = vi.fn<
      InboxV2NativeOutboundAuthorizationPort["authorize"]
    >(async (_transaction, request) => {
      expect(_transaction).toBe(transaction);
      expect(request.kind).toBe("message_creation");
      expect("streamPosition" in request).toBe(false);
      return { kind: "authorized", authorizedMutation };
    });
    const planner = createSqlInboxV2NativeOutboundProductionPlanner({
      authorize
    });
    const input = {
      plan,
      candidateExternalMessageReference: target
    };

    const first = await planner.planMessageCreation(transaction, input);
    const second = await planner.planMessageCreation(transaction, input);

    expect(first.kind).toBe("planned");
    expect(second).toEqual(first);
    expect(authorize).toHaveBeenCalledTimes(2);
    if (first.kind !== "planned") {
      throw new Error("Native production planner did not plan creation.");
    }
    expect(first.plan.authorizedMutation).toBe(authorizedMutation);
    expect(first.plan.commit).toMatchObject({
      message: {
        appActor: null,
        automationCausation: null,
        origin: {
          kind: "source_originated",
          direction: "outbound",
          claimAtOccurrence: null
        }
      },
      claimAtOccurrenceSnapshot: null,
      authorParticipant: {
        subject: { kind: "source_external_identity" }
      },
      outboundRoute: null,
      outboundDispatch: null,
      content: {
        state: {
          kind: "available",
          blocks: [{ kind: "unsupported_source_content" }]
        }
      }
    });
    expect(
      createSqlInboxV2NativeOutboundReconciliationRuntime({
        authorization: { authorize }
      })
    ).toEqual({
      createMessage: expect.any(Function),
      attachOccurrence: expect.any(Function)
    });
  });

  it("captures the exact Employee claim effective at provider observation even after a later revocation", async () => {
    const plan = nativeOutboundPlan();
    const target = candidateReference(plan);
    const fixture = nativeCreationCommit(plan, target);
    const claim = nativeEmployeeClaim(plan, "revoked_after_observation");
    if (claim.target.kind !== "employee") {
      throw new Error("Native claim fixture did not resolve an Employee.");
    }
    const delegate = nativeParticipantExecutor(
      fixture.authorParticipant,
      claim
    );
    const executedSql: string[] = [];
    const dialect = new PgDialect();
    const transaction: RawSqlExecutor = {
      async execute<T extends Record<string, unknown>>(
        query: Parameters<RawSqlExecutor["execute"]>[0]
      ) {
        executedSql.push(dialect.sqlToQuery(query).sql);
        return delegate.execute<T>(query);
      }
    };
    const authorizedMutation = opaqueAuthorizedMutation();
    const planner = createSqlInboxV2NativeOutboundProductionPlanner({
      async authorize() {
        return { kind: "authorized", authorizedMutation };
      }
    });

    const planned = await planner.planMessageCreation(transaction, {
      plan,
      candidateExternalMessageReference: target
    });

    expect(planned.kind).toBe("planned");
    if (planned.kind !== "planned") {
      throw new Error("Claimed native outbound Message was not planned.");
    }
    expect(planned.plan.commit).toMatchObject({
      authorParticipant: {
        subject: { kind: "source_external_identity" }
      },
      message: {
        appActor: null,
        origin: {
          kind: "source_originated",
          claimAtOccurrence: {
            claim: { id: claim.id },
            claimVersion: claim.claimVersion,
            resolvedEmployee: { id: claim.target.employee.id }
          }
        }
      },
      claimAtOccurrenceSnapshot: claim
    });
    expect(
      executedSql.some(
        (statement) =>
          statement.includes("inbox_v2_source_external_identities") &&
          statement.includes("for share")
      )
    ).toBe(true);
    expect(
      executedSql.some(
        (statement) =>
          statement.includes("inbox_v2_source_identity_claim_heads") &&
          statement.includes("for share")
      )
    ).toBe(true);
    expect(
      executedSql.some(
        (statement) =>
          statement.includes("claim_row.created_at <=") &&
          statement.includes("claim_row.revoked_at >") &&
          statement.includes("limit 2") &&
          statement.includes("for share")
      )
    ).toBe(true);
  });

  it("persists native creation through the ambient SQL boundary and derives the no-effect proof", async () => {
    const plan = nativeOutboundPlan();
    const target = candidateReference(plan);
    const commit = nativeCreationCommit(plan, target);
    const streamPosition = inboxV2BigintCounterSchema.parse("101");
    const envelope = nativeMessageEnvelope(commit, streamPosition);
    const transaction = nativeClosureExecutor("message_creation");
    const authorizedMutation = opaqueAuthorizedMutation();
    const coordinateMessageCreation = vi.fn(
      async (
        receivedTransaction: RawSqlExecutor,
        receivedPlan: InboxV2NativeOutboundMessageCreationPersistencePlan
      ) => {
        expect(receivedTransaction).toBe(transaction);
        expect(receivedPlan).toEqual({ commit, authorizedMutation });
        return { kind: "committed" as const, envelope };
      }
    );
    const persistence = createSqlInboxV2NativeOutboundCanonicalPersistence({
      planner: nativeSqlPlanner({
        creation: { commit, authorizedMutation }
      }),
      dependencies: {
        coordinateMessageCreation
      }
    });

    const result = await persistence.createMessage(transaction, {
      plan,
      candidateExternalMessageReference: target
    });

    expect(result.kind).toBe("committed");
    expect(
      result.kind === "committed" ? result.proof.effectDisposition : null
    ).toEqual(inboxV2NativeOutboundNoEffectDisposition);
    expect(coordinateMessageCreation).toHaveBeenCalledOnce();
  });

  it("attaches one exact duplicate occurrence once and verifies replay from durable rows", async () => {
    const originPlan = nativeOutboundPlan();
    const duplicatePlan = nativeOutboundPlan("b");
    const target = candidateReference(originPlan);
    const origin = nativeCreationCommit(originPlan, target);
    const association = nativeAssociationProof(
      duplicatePlan,
      target,
      origin,
      inboxV2NativeOutboundNoEffectDisposition
    );
    const streamPosition = inboxV2BigintCounterSchema.parse("102");
    const envelope = nativeTransportEnvelope(
      association.commit,
      streamPosition
    );
    const transaction = nativeClosureExecutor("transport_association");
    const authorizedMutation = opaqueAuthorizedMutation();
    const coordinateOccurrenceAssociation = vi.fn(async () => ({
      kind: "committed" as const,
      envelope
    }));
    const loadAuthorParticipant = vi.fn(async () => origin.authorParticipant);
    const callbacks = createSqlInboxV2NativeOutboundCanonicalCallbacks({
      planner: nativeSqlPlanner({
        association: {
          commit: association.commit,
          sourceResolutionCommit: association.sourceResolutionCommit,
          authorizedMutation
        }
      }),
      dependencies: {
        coordinateOccurrenceAssociation,
        loadAuthorParticipant
      }
    });
    const input = {
      plan: duplicatePlan,
      targetExternalMessageReference: target,
      reason: "exact_message_reuse" as const
    };

    const first = await callbacks.attachOccurrence(transaction, input);
    const replay = await callbacks.attachOccurrence(transaction, input);

    expect(first.kind).toBe("committed");
    expect(replay.kind).toBe("committed");
    expect(coordinateOccurrenceAssociation).toHaveBeenCalledTimes(2);
    expect(coordinateOccurrenceAssociation).toHaveBeenNthCalledWith(
      1,
      transaction,
      {
        commit: association.commit,
        sourceResolutionCommit: association.sourceResolutionCommit,
        authorizedMutation
      }
    );
    expect(loadAuthorParticipant).toHaveBeenCalledTimes(2);
  });

  it.each(["notification_count", "provider_io_count"] as const)(
    "rejects a durable closure containing a %s effect",
    async (effectCount) => {
      const plan = nativeOutboundPlan();
      const target = candidateReference(plan);
      const commit = nativeCreationCommit(plan, target);
      const streamPosition = inboxV2BigintCounterSchema.parse("103");
      const envelope = nativeMessageEnvelope(commit, streamPosition);
      const transaction = nativeClosureExecutor("message_creation", {
        [effectCount]: "1"
      });
      const authorizedMutation = opaqueAuthorizedMutation();
      const persistence = createSqlInboxV2NativeOutboundCanonicalPersistence({
        planner: nativeSqlPlanner({
          creation: { commit, authorizedMutation }
        }),
        dependencies: {
          coordinateMessageCreation: async () => ({
            kind: "committed",
            envelope
          })
        }
      });

      await expect(
        persistence.createMessage(transaction, {
          plan,
          candidateExternalMessageReference: target
        })
      ).rejects.toThrow("Native outbound durable closure");
    }
  );

  it("builds an inverse closure over author, occurrence, dispatch and outbox rows", () => {
    const query = new PgDialect().sqlToQuery(
      buildDeriveInboxV2NativeOutboundEffectDispositionSql({
        operationKind: "transport_association",
        tenantId: "tenant:tenant-1",
        messageId: "message:message-1",
        messageRevision: "1",
        authorParticipantId: "conversation_participant:participant-1",
        sourceExternalIdentityId: "source_external_identity:identity-1",
        sourceOccurrenceId: "source_occurrence:occurrence-1",
        sourceOccurrenceRevision: "2",
        resolutionTransitionId: "source_occurrence_resolution_transition:t-1",
        externalMessageReferenceId: "external_message_reference:reference-1",
        transportLinkId: "message_transport_occurrence_link:link-1",
        transportLinkHeadRevision: "2",
        streamPosition: inboxV2BigintCounterSchema.parse("104")
      })
    );
    const rendered = query.sql;

    expect(rendered).toContain("inbox_v2_action_attributions");
    expect(rendered).toContain("inbox_v2_conversation_participants");
    expect(rendered).toContain("inbox_v2_source_occurrences");
    expect(rendered).toContain("inbox_v2_message_transport_links");
    expect(rendered).toContain("inbox_v2_auth_command_records");
    expect(query.params).toContain(
      "core:message.native_outbound_occurrence.attach"
    );
    expect(rendered).toContain("inbox_v2_outbound_dispatches");
    expect(rendered).toContain("effect_class = 'provider_io'");
    expect(rendered).toContain("effect_class = 'notification'");
    expect(rendered).toContain("origin_source_direction = 'outbound'");
    expect(rendered).toContain("link_row.role = 'native_outbound'");
  });
});

function nativeSqlPlanner(input: {
  creation?: InboxV2NativeOutboundMessageCreationPersistencePlan;
  association?: InboxV2NativeOutboundOccurrenceAssociationPersistencePlan;
}): InboxV2NativeOutboundPersistencePlanner {
  return {
    async planMessageCreation() {
      return input.creation === undefined
        ? {
            kind: "conflict" as const,
            code: "source.message_reconciliation.callback_conflict" as const
          }
        : { kind: "planned" as const, plan: input.creation };
    },
    async planOccurrenceAssociation() {
      return input.association === undefined
        ? {
            kind: "conflict" as const,
            code: "source.message_reconciliation.callback_conflict" as const
          }
        : { kind: "planned" as const, plan: input.association };
    }
  };
}

function nativeMessageEnvelope(
  commit: InboxV2MessageCreationCommit,
  streamPosition: InboxV2BigintCounter
): InboxV2SafeGenericEnvelope {
  const timelineItem = commit.timelineAllocation.items[0];
  if (timelineItem === undefined)
    throw new Error("Native fixture has no item.");
  return {
    tenantId: commit.tenantId,
    entityKind: "message",
    entityId: commit.message.id,
    entityRevision: commit.message.revision,
    timelineItemId: timelineItem.id,
    timelineSequence: timelineItem.timelineSequence,
    streamPosition,
    changeKind: "created",
    occurredAt: commit.initialRevision.occurredAt
  };
}

function nativeTransportEnvelope(
  commit: ReturnType<
    typeof inboxV2MessageTransportAssociationCommitSchema.parse
  >,
  streamPosition: InboxV2BigintCounter
): InboxV2SafeGenericEnvelope {
  return {
    tenantId: commit.tenantId,
    entityKind: "message_transport",
    entityId: commit.link.id,
    entityRevision: commit.linkHeadAfter.revision,
    timelineItemId: commit.timelineItem.id,
    timelineSequence: commit.timelineItem.timelineSequence,
    streamPosition,
    changeKind: "transport_link.native_outbound",
    occurredAt: commit.committedAt
  };
}

type NativeClosureCount =
  | "native_shape_count"
  | "stream_commit_count"
  | "authorization_command_count"
  | "change_count"
  | "exact_primary_change_count"
  | "exact_source_change_count"
  | "unexpected_change_count"
  | "event_count"
  | "exact_primary_event_count"
  | "exact_source_event_count"
  | "outbox_count"
  | "exact_primary_projection_count"
  | "exact_source_projection_count"
  | "provider_io_count"
  | "notification_count"
  | "outbound_dispatch_count"
  | "source_resolution_transition_count"
  | "atomic_source_materialization_count";

function nativeClosureExecutor(
  operationKind: "message_creation" | "transport_association",
  overrides: Partial<Record<NativeClosureCount, string>> = {}
): RawSqlExecutor {
  const creation = operationKind === "message_creation";
  const row = {
    native_shape_count: "1",
    stream_commit_count: "1",
    authorization_command_count: "1",
    change_count: creation ? "2" : "1",
    exact_primary_change_count: "1",
    exact_source_change_count: creation ? "1" : "0",
    unexpected_change_count: "0",
    event_count: creation ? "2" : "1",
    exact_primary_event_count: "1",
    exact_source_event_count: creation ? "1" : "0",
    outbox_count: creation ? "2" : "1",
    exact_primary_projection_count: "1",
    exact_source_projection_count: creation ? "1" : "0",
    outbound_dispatch_count: "0",
    provider_io_count: "0",
    notification_count: "0",
    source_resolution_transition_count: "1",
    atomic_source_materialization_count: creation ? "1" : "0",
    ...overrides
  };
  return {
    async execute<T>(): Promise<RawSqlQueryResult<T>> {
      return { rows: [row as T] };
    }
  };
}

function nativeParticipantExecutor(
  participant: InboxV2ConversationParticipant,
  claim: InboxV2SourceIdentityClaim | null = null
): RawSqlExecutor {
  if (participant.subject.kind !== "source_external_identity") {
    throw new Error("Native planner fixture requires a source participant.");
  }
  const sourceExternalIdentityId =
    participant.subject.sourceExternalIdentity.id;
  const dialect = new PgDialect();
  return {
    async execute<T extends Record<string, unknown>>(
      query: Parameters<RawSqlExecutor["execute"]>[0]
    ): Promise<RawSqlQueryResult<T>> {
      const rendered = dialect.sqlToQuery(query).sql;
      if (
        rendered.includes(
          "from inbox_v2_source_external_identities identity_row"
        ) ||
        rendered.includes("from inbox_v2_source_identity_claim_heads head_row")
      ) {
        return {
          rows: [{ id: sourceExternalIdentityId } as unknown as T]
        };
      }
      if (
        rendered.includes("from inbox_v2_source_identity_claims claim_row") &&
        rendered.includes("limit 2")
      ) {
        return {
          rows: claim === null ? [] : [{ id: claim.id } as unknown as T]
        };
      }
      if (rendered.includes("from inbox_v2_source_identity_claims claim_row")) {
        return {
          rows:
            claim === null
              ? []
              : (nativeClaimPersistenceRows(claim) as readonly T[])
        };
      }
      return {
        rows: [
          {
            tenant_id: participant.tenantId,
            id: participant.id,
            conversation_id: participant.conversation.id,
            subject_kind: "source_external_identity",
            subject_employee_id: null,
            subject_source_external_identity_id: sourceExternalIdentityId,
            subject_client_contact_id: null,
            subject_bot_identity_id: null,
            subject_system_actor_id: null,
            subject_legacy_provenance_id: null,
            revision: participant.revision,
            created_at: participant.createdAt,
            updated_at: participant.updatedAt
          } as unknown as T
        ]
      };
    }
  };
}

function nativeClaimPersistenceRows(
  claim: InboxV2SourceIdentityClaim
): readonly Record<string, unknown>[] {
  const targetEmployeeId =
    claim.target.kind === "employee" ? claim.target.employee.id : null;
  const targetClientContactId =
    claim.target.kind === "client_contact"
      ? claim.target.clientContact.id
      : null;
  const decisionActorEmployeeId =
    claim.decision.kind === "manual" ? claim.decision.actorEmployee.id : null;
  const decisionTrustedServiceId =
    claim.decision.kind === "manual" ? null : claim.decision.trustedServiceId;
  const policyAuthority =
    claim.decision.kind === "automatic_policy"
      ? claim.decision.policyAuthority
      : null;
  return claim.evidenceReferences.map((evidence, ordinal) => ({
    tenant_id: claim.tenantId,
    id: claim.id,
    source_external_identity_id: claim.sourceExternalIdentity.id,
    previous_claim_version: claim.previousClaimVersion,
    claim_version: claim.claimVersion,
    target_kind: claim.target.kind,
    target_employee_id: targetEmployeeId,
    target_client_contact_id: targetClientContactId,
    status: claim.status,
    confidence: claim.confidence,
    policy_id: claim.policyId,
    policy_version: claim.policyVersion,
    reason_code_id: claim.reasonCodeId,
    decision_kind: claim.decision.kind,
    decision_actor_employee_id: decisionActorEmployeeId,
    decision_trusted_service_id: decisionTrustedServiceId,
    policy_family: policyAuthority?.family ?? null,
    policy_definition_contract_version:
      policyAuthority?.definitionContractVersion ?? null,
    policy_definition_digest_sha256:
      policyAuthority?.definitionDigestSha256 ?? null,
    policy_activation_head_revision:
      policyAuthority?.activationHeadRevision ?? null,
    created_at: claim.createdAt,
    revoked_at: claim.revocation?.revokedAt ?? null,
    revision: claim.revision,
    evidence_ordinal: ordinal,
    evidence_kind: evidence.kind,
    raw_inbound_event_id:
      evidence.kind === "raw_inbound_event" ? evidence.reference.id : null,
    normalized_inbound_event_id:
      evidence.kind === "normalized_inbound_event"
        ? evidence.reference.id
        : null,
    source_occurrence_id:
      evidence.kind === "source_occurrence" ? evidence.reference.id : null,
    provider_roster_evidence_id:
      evidence.kind === "provider_roster_evidence"
        ? evidence.reference.id
        : null
  }));
}

function nativeEmployeeClaim(
  plan: MessageCreatePlan,
  suffix: string
): InboxV2SourceIdentityClaim {
  const actor = plan.sourceOccurrence.providerActor;
  const origin = plan.sourceOccurrence.origin;
  if (
    actor?.kind !== "source_external_identity" ||
    origin.kind === "provider_echo" ||
    origin.kind === "provider_response"
  ) {
    throw new Error("Native claim fixture requires event-backed source actor.");
  }
  const observedAt = Date.parse(plan.sourceOccurrence.observedAt);
  return inboxV2SourceIdentityClaimSchema.parse({
    tenantId: plan.sourceOccurrence.tenantId,
    id: `source_identity_claim:native-${suffix}`,
    sourceExternalIdentity: actor.sourceExternalIdentity,
    previousClaimVersion: null,
    claimVersion: "1",
    target: {
      kind: "employee",
      employee: {
        tenantId: plan.sourceOccurrence.tenantId,
        kind: "employee",
        id: `employee:native-${suffix}`
      }
    },
    status: "revoked",
    confidence: "verified",
    evidenceReferences: [
      {
        kind: "raw_inbound_event",
        reference: origin.rawInboundEvent
      }
    ],
    policyId: "core:verified-source-identity",
    policyVersion: "v1",
    reasonCodeId: "core:operator-reviewed",
    decision: {
      kind: "manual",
      actorEmployee: {
        tenantId: plan.sourceOccurrence.tenantId,
        kind: "employee",
        id: `employee:native-reviewer-${suffix}`
      },
      reviewState: "approved"
    },
    createdAt: new Date(observedAt - 1_000).toISOString(),
    revocation: {
      revokedAt: new Date(observedAt + 1_000).toISOString()
    },
    revision: "2"
  });
}

function opaqueAuthorizedMutation(): InboxV2NativeOutboundMessageCreationPersistencePlan["authorizedMutation"] {
  return Object.freeze(
    {}
  ) as InboxV2NativeOutboundMessageCreationPersistencePlan["authorizedMutation"];
}

type NativeState = Readonly<{
  occurrences: Map<string, InboxV2SourceOccurrence>;
  references: InboxV2ExternalMessageReference[];
  links: InboxV2MessageTransportOccurrenceLink[];
  creationCommits: Map<string, InboxV2MessageCreationCommit>;
}>;

function nativeOutboundPlan(accountSuffix = "a"): MessageCreatePlan {
  const context = makeResolvedReconciliationContext(accountSuffix);
  const descriptor = makeMessageReconciliationDescriptor(context, {
    direction: "outbound"
  });
  return materializer.materialize({
    context,
    descriptor: {
      ...descriptor,
      occurrence: {
        ...descriptor.occurrence,
        providerActor: {
          kind: "source_external_identity",
          sourceExternalIdentity: {
            tenantId: context.plan.source.tenantId,
            kind: "source_external_identity",
            id: inboxV2SourceExternalIdentityIdSchema.parse(
              "source_external_identity:native-self-1"
            )
          }
        }
      }
    }
  }) as MessageCreatePlan;
}

function materializedInboundPlan(): MessageCreatePlan {
  const context = makeResolvedReconciliationContext();
  return materializer.materialize({
    context,
    descriptor: makeMessageReconciliationDescriptor(context)
  }) as MessageCreatePlan;
}

function nativeState(
  plan: InboxV2SourceMessageReconciliationPlan
): NativeState {
  return {
    occurrences: new Map([[plan.sourceOccurrence.id, plan.sourceOccurrence]]),
    references: [],
    links: [],
    creationCommits: new Map()
  };
}

function nativePersistence(
  state: NativeState,
  effectDisposition: InboxV2NativeOutboundEffectDisposition = inboxV2NativeOutboundNoEffectDisposition
): InboxV2NativeOutboundCanonicalPersistence & {
  createMessage: ReturnType<typeof vi.fn>;
  attachOccurrence: ReturnType<typeof vi.fn>;
} {
  const createMessage = vi.fn(
    async (
      _transaction: RawSqlExecutor,
      input: Parameters<
        InboxV2NativeOutboundCanonicalPersistence["createMessage"]
      >[1]
    ) => {
      const commit = nativeCreationCommit(
        input.plan,
        input.candidateExternalMessageReference
      );
      state.occurrences.set(
        commit.sourceOccurrence!.id,
        commit.sourceOccurrence!
      );
      state.references.push(commit.externalMessageReference!);
      state.links.push(commit.originTransportLink!);
      state.creationCommits.set(commit.message.id, commit);
      return {
        kind: "committed" as const,
        result: canonicalResult(commit),
        proof: { commit, effectDisposition }
      };
    }
  );
  const attachOccurrence = vi.fn(
    async (
      _transaction: RawSqlExecutor,
      input: Parameters<
        InboxV2NativeOutboundCanonicalPersistence["attachOccurrence"]
      >[1]
    ) => {
      const origin = state.creationCommits.get(
        input.targetExternalMessageReference.message.id
      );
      if (origin === undefined || input.plan.intent.kind !== "message_create") {
        return {
          kind: "conflict" as const,
          code: "source.message_reconciliation.callback_conflict" as const
        };
      }
      const proof = nativeAssociationProof(
        input.plan as MessageCreatePlan,
        input.targetExternalMessageReference,
        origin,
        effectDisposition
      );
      state.occurrences.set(
        proof.commit.sourceOccurrence.id,
        proof.commit.sourceOccurrence
      );
      state.links.push(proof.commit.link);
      return {
        kind: "committed" as const,
        result: {
          externalMessageReference: proof.commit.externalMessageReference,
          sourceOccurrence: proof.commit.sourceOccurrence
        },
        proof
      };
    }
  );
  return { createMessage, attachOccurrence };
}

function nativeAssociationProof(
  plan: MessageCreatePlan,
  externalMessageReference: InboxV2ExternalMessageReference,
  origin: InboxV2MessageCreationCommit,
  effectDisposition: InboxV2NativeOutboundEffectDisposition
) {
  const originOccurrence = origin.sourceOccurrence;
  const originLinkHead = origin.originTransportLinkHead;
  const timelineItem = origin.timelineAllocation.items[0];
  if (
    originOccurrence === null ||
    originLinkHead === null ||
    timelineItem === undefined ||
    plan.sourceOccurrence.providerActor?.kind !== "source_external_identity"
  ) {
    throw new Error("Native association fixture has no source origin proof.");
  }
  const committedAt = plan.materializedAt;
  const resolvedOccurrence = inboxV2SourceOccurrenceSchema.parse({
    ...plan.sourceOccurrence,
    resolution: {
      state: "resolved",
      externalMessageReference: reference(
        plan.sourceOccurrence.tenantId,
        "external_message_reference",
        externalMessageReference.id
      )
    },
    revision: (BigInt(plan.sourceOccurrence.revision) + 1n).toString(),
    updatedAt: committedAt
  });
  const sourceResolutionCommit = {
    tenantId: plan.sourceOccurrence.tenantId,
    expectedRevision: plan.sourceOccurrence.revision,
    resultingRevision: resolvedOccurrence.revision,
    changedAt: committedAt,
    resolver: {
      kind: "trusted_service" as const,
      trustedServiceId: plan.materializedByTrustedServiceId,
      resolutionToken: `resolution:${plan.sourceOccurrence.id}`
    },
    before: plan.sourceOccurrence,
    after: resolvedOccurrence,
    resolvedReference: externalMessageReference
  };
  const link = {
    tenantId: plan.sourceOccurrence.tenantId,
    id: plan.intent.candidateTransportLinkId,
    message: externalMessageReference.message,
    sourceOccurrence: reference(
      plan.sourceOccurrence.tenantId,
      "source_occurrence",
      plan.sourceOccurrence.id
    ),
    externalMessageReference: reference(
      plan.sourceOccurrence.tenantId,
      "external_message_reference",
      externalMessageReference.id
    ),
    role: "native_outbound" as const,
    revision: "1" as const,
    linkedAt: committedAt
  };
  const commit = inboxV2MessageTransportAssociationCommitSchema.parse({
    tenantId: plan.sourceOccurrence.tenantId,
    message: origin.message,
    timelineItem,
    linkHeadBefore: originLinkHead,
    sourceOccurrence: resolvedOccurrence,
    externalMessageReference,
    externalThreadMapping: plan.context.externalThreadMapping,
    occurrenceBinding: plan.context.sourceThreadBinding.binding,
    messageOriginProof: {
      kind: "source_originated",
      originOccurrence
    },
    link,
    linkHeadAfter: {
      tenantId: plan.sourceOccurrence.tenantId,
      message: externalMessageReference.message,
      linkCount: (BigInt(originLinkHead.linkCount) + 1n).toString(),
      latestLink: reference(
        plan.sourceOccurrence.tenantId,
        "message_transport_occurrence_link",
        link.id
      ),
      revision: (BigInt(originLinkHead.revision) + 1n).toString(),
      updatedAt: committedAt
    },
    committedAt
  });
  return {
    commit,
    sourceResolutionCommit,
    authorParticipant: origin.authorParticipant,
    effectDisposition
  };
}

function nativeAssociationAuthorityContext(
  association: ReturnType<typeof nativeAssociationProof>
): Parameters<
  typeof assertInboxV2NativeOutboundTransportAssociationAuthority
>[0] {
  const resolver = association.sourceResolutionCommit.resolver;
  if (resolver.kind !== "trusted_service") {
    throw new Error("Native association fixture requires a trusted resolver.");
  }
  const authorizationEpoch = "authorization:native-outbound";
  const authorizationDecisionId =
    "authorization-decision:native-outbound-receive";
  const resourceAccessRevision = "1";
  return {
    tenantId: association.commit.tenantId,
    commandTypeId: INBOX_V2_NATIVE_OUTBOUND_OCCURRENCE_ATTACH_COMMAND_TYPE_ID,
    actor: {
      kind: "trusted_service",
      trustedServiceId: resolver.trustedServiceId
    },
    authorizationEpoch,
    authorizationDecisionId,
    authorizationDecisionRefs: [
      {
        tenantId: association.commit.tenantId,
        id: authorizationDecisionId,
        authorizationEpoch,
        principal: {
          kind: "trusted_service",
          trustedServiceId: resolver.trustedServiceId
        },
        permissionId: "core:message.receive_external",
        resourceScopeId: "core:conversation",
        resource: {
          tenantId: association.commit.tenantId,
          entityTypeId: "core:conversation",
          entityId: association.commit.message.conversation.id
        },
        resourceAccessRevision,
        decisionRevision: "1",
        decisionHash: "a".repeat(64),
        outcome: "allowed",
        decidedAt: association.commit.committedAt,
        notAfter: "2026-07-23T00:00:00.000Z"
      }
    ],
    authorizationResourceRevisionFences: [
      {
        resourceKind: "conversation",
        resourceId: association.commit.message.conversation.id,
        resourceHeadId: "authorization-resource:native-conversation",
        expectedResourceAccessRevision: resourceAccessRevision,
        advance: "none"
      }
    ],
    occurredAt: association.commit.committedAt
  } as unknown as Parameters<
    typeof assertInboxV2NativeOutboundTransportAssociationAuthority
  >[0];
}

function nativeCreationCommit(
  plan: InboxV2SourceMessageReconciliationPlan,
  externalMessageReference: InboxV2ExternalMessageReference
): InboxV2MessageCreationCommit {
  if (
    plan.intent.kind !== "message_create" ||
    plan.sourceOccurrence.providerActor?.kind !== "source_external_identity"
  ) {
    throw new Error("Native creation fixture requires a native Message plan.");
  }
  const tenantId = plan.sourceOccurrence.tenantId;
  const committedAt = plan.materializedAt;
  const conversationBefore = plan.context.externalThreadMapping.conversation;
  const conversation = reference(
    tenantId,
    "conversation",
    conversationBefore.id
  );
  const timelineItemReference = reference(
    tenantId,
    "timeline_item",
    plan.intent.candidateTimelineItemId
  );
  const messageReference = reference(
    tenantId,
    "message",
    plan.intent.candidateMessageId
  );
  const participantReference = reference(
    tenantId,
    "conversation_participant",
    "conversation_participant:native-self-1"
  );
  const sourceOccurrenceReference = reference(
    tenantId,
    "source_occurrence",
    plan.sourceOccurrence.id
  );
  const externalMessageReferenceReference = reference(
    tenantId,
    "external_message_reference",
    externalMessageReference.id
  );
  const transportLinkReference = reference(
    tenantId,
    "message_transport_occurrence_link",
    plan.intent.candidateTransportLinkId
  );
  const blocks = [
    {
      blockKey: "body-1",
      kind: "text" as const,
      role: "body" as const,
      text: "Native provider-app outbound",
      language: "en"
    }
  ];
  const content = inboxV2TimelineContentSchema.parse({
    tenantId,
    id: "timeline_content:native-outbound-1",
    state: {
      kind: "available" as const,
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: "1" as const,
    createdAt: committedAt,
    updatedAt: committedAt
  });
  const message = {
    tenantId,
    id: plan.intent.candidateMessageId,
    conversation,
    timelineItem: timelineItemReference,
    authorParticipant: participantReference,
    origin: {
      kind: "source_originated" as const,
      originOccurrence: sourceOccurrenceReference,
      direction: "outbound" as const,
      claimAtOccurrence: null
    },
    appActor: null,
    automationCausation: null,
    content: inboxV2TimelineContentHeadOf(content),
    referenceContext: { kind: "none" as const },
    lifecycle: { kind: "active" as const },
    revision: "1" as const,
    createdAt: committedAt,
    updatedAt: committedAt
  };
  const timelineItem = {
    tenantId,
    id: plan.intent.candidateTimelineItemId,
    conversation,
    timelineSequence: (
      BigInt(conversationBefore.head.latestTimelineSequence) + 1n
    ).toString(),
    subject: {
      kind: "message" as const,
      message: messageReference,
      messageRevision: "1" as const
    },
    visibility: "conversation_external" as const,
    activity: { kind: "eligible" as const },
    occurredAt: plan.sourceOccurrence.observedAt,
    receivedAt: plan.sourceOccurrence.recordedAt,
    revision: "1" as const,
    createdAt: committedAt,
    updatedAt: committedAt
  };
  const conversationAfter = {
    ...conversationBefore,
    head: {
      ...conversationBefore.head,
      latestTimelineSequence: timelineItem.timelineSequence,
      latestActivityItemId: timelineItem.id,
      latestActivityTimelineSequence: timelineItem.timelineSequence,
      latestActivityAt: timelineItem.occurredAt,
      revision: (BigInt(conversationBefore.head.revision) + 1n).toString(),
      updatedAt: committedAt
    }
  };
  const resolvedOccurrence = inboxV2SourceOccurrenceSchema.parse({
    ...plan.sourceOccurrence,
    resolution: {
      state: "resolved",
      externalMessageReference: externalMessageReferenceReference
    },
    revision: (BigInt(plan.sourceOccurrence.revision) + 1n).toString(),
    updatedAt: committedAt
  });
  const sourceResolutionCommit = {
    tenantId,
    expectedRevision: plan.sourceOccurrence.revision,
    resultingRevision: resolvedOccurrence.revision,
    changedAt: committedAt,
    resolver: {
      kind: "trusted_service" as const,
      trustedServiceId: plan.materializedByTrustedServiceId,
      resolutionToken: `resolution:${plan.sourceOccurrence.id}`
    },
    before: plan.sourceOccurrence,
    after: resolvedOccurrence,
    resolvedReference: externalMessageReference
  };
  const originTransportLink = {
    tenantId,
    id: plan.intent.candidateTransportLinkId,
    message: messageReference,
    sourceOccurrence: sourceOccurrenceReference,
    externalMessageReference: externalMessageReferenceReference,
    role: "native_outbound" as const,
    revision: "1" as const,
    linkedAt: committedAt
  };
  const commit = {
    tenantId,
    timelineAllocation: {
      tenantId,
      conversationBefore,
      items: [timelineItem],
      conversationAfter,
      committedAt
    },
    authorParticipant: {
      tenantId,
      id: participantReference.id,
      conversation,
      subject: {
        kind: "source_external_identity" as const,
        sourceExternalIdentity:
          plan.sourceOccurrence.providerActor.sourceExternalIdentity
      },
      revision: "1" as const,
      createdAt: conversationBefore.createdAt,
      updatedAt: conversationBefore.createdAt
    },
    content,
    message,
    initialRevision: {
      tenantId,
      id: "message_revision:native-outbound-1",
      message: messageReference,
      timelineItem: timelineItemReference,
      expectedPreviousRevision: null,
      messageRevision: "1" as const,
      change: { kind: "created" as const, content: message.content },
      actionAttribution: {
        actionParticipant: participantReference,
        appActor: null,
        sourceOccurrence: sourceOccurrenceReference,
        automationCausation: null
      },
      occurredAt: timelineItem.occurredAt,
      recordedAt: committedAt,
      recordRevision: "1" as const,
      createdAt: committedAt
    },
    sourceOccurrence: resolvedOccurrence,
    claimAtOccurrenceSnapshot: null,
    sourceResolutionCommit,
    externalMessageReference,
    originTransportLink,
    originTransportLinkHead: {
      tenantId,
      message: messageReference,
      linkCount: "1",
      latestLink: transportLinkReference,
      revision: "1",
      updatedAt: committedAt
    },
    externalThreadMapping: plan.context.externalThreadMapping,
    canonicalReferenceTargets: [],
    externalReferenceTargets: [],
    unresolvedReferenceTarget: null,
    providerReferenceSemantics: [],
    outboundRoute: null,
    outboundBindingSnapshot: null,
    outboundDispatch: null,
    routeConsumption: null
  };
  const parsed = inboxV2MessageCreationCommitSchema.safeParse(commit);
  if (!parsed.success) {
    throw new Error(`Invalid native fixture: ${parsed.error.message}`);
  }
  return parsed.data;
}

function candidateReference(
  plan: InboxV2SourceMessageReconciliationPlan
): InboxV2ExternalMessageReference {
  if (plan.intent.kind !== "message_create") {
    throw new Error("Candidate fixture requires a Message-create plan.");
  }
  return inboxV2ExternalMessageReferenceSchema.parse({
    tenantId: plan.sourceOccurrence.tenantId,
    id: plan.candidateExternalMessageReferenceId,
    key: plan.messageKey,
    identityDeclaration: plan.sourceOccurrence.messageIdentityDeclaration,
    externalThread: plan.messageKey.externalThread,
    timelineItem: reference(
      plan.sourceOccurrence.tenantId,
      "timeline_item",
      plan.intent.candidateTimelineItemId
    ),
    message: reference(
      plan.sourceOccurrence.tenantId,
      "message",
      plan.intent.candidateMessageId
    ),
    revision: "1",
    createdAt: plan.materializedAt
  });
}

function canonicalResult(commit: InboxV2MessageCreationCommit) {
  if (
    commit.externalMessageReference === null ||
    commit.sourceOccurrence === null
  ) {
    throw new Error("Native commit has no canonical result.");
  }
  return {
    externalMessageReference: commit.externalMessageReference,
    sourceOccurrence: commit.sourceOccurrence
  };
}

function fullCallbacks(
  canonical: Pick<
    InboxV2SourceMessageReconciliationCallbacks,
    "createMessage" | "attachOccurrence"
  >
): InboxV2SourceMessageReconciliationCallbacks {
  return {
    ...canonical,
    async applySourceAction() {
      return {
        kind: "conflict",
        code: "source.message_reconciliation.callback_conflict"
      };
    },
    async drainDeferredActions() {
      return { kind: "committed", result: { results: [] } };
    }
  };
}

function nativeDependencies(
  state: NativeState
): NonNullable<
  CreateSqlInboxV2SourceMessageReconciliationRepositoryOptions["dependencies"]
> {
  return {
    computeMessageKeyDigest: () => "native-key-digest",
    acquireMessageKeyLock: async () => undefined,
    registerMessageKey: async () => "registered",
    readOccurrence: async (_transaction, input) =>
      state.occurrences.get(input.occurrenceId) ?? null,
    findReferenceCandidates: async () => state.references,
    findTransportLinkCandidates: async (_transaction, input) =>
      state.links.filter(
        (link) =>
          link.id === input.linkId ||
          link.sourceOccurrence.id === input.sourceOccurrenceId
      ),
    persistDeferredAction: async () => ({ kind: "action_id_conflict" }),
    persistWeakCorrelationEvidence: async () => "created",
    listPendingActions: async () => ({
      kind: "page",
      actions: [],
      hasMore: false,
      nextAfterActionId: null
    }),
    readDeferredAction: async () => null
  };
}

function transactionExecutor(): InboxV2SourceMessageReconciliationTransactionExecutor {
  const transaction = executor();
  return {
    ...transaction,
    async transaction(work) {
      return work(transaction);
    }
  };
}

function executor(): RawSqlExecutor {
  return {
    async execute<T>(): Promise<RawSqlQueryResult<T>> {
      return { rows: [] };
    }
  };
}

function reference<
  TKind extends
    | "conversation"
    | "conversation_participant"
    | "external_message_reference"
    | "message"
    | "message_transport_occurrence_link"
    | "source_occurrence"
    | "timeline_item"
>(tenantId: string, kind: TKind, id: string) {
  return { tenantId, kind, id };
}
