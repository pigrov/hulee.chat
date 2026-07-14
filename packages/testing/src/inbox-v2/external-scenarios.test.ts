import {
  INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
  INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
  INBOX_V2_CONVERSATION_SCHEMA_ID,
  INBOX_V2_CONVERSATION_SCHEMA_VERSION,
  INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
  INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
  INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
  INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
  INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
  INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
  INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID,
  INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
  INBOX_V2_STAFF_NOTE_SCHEMA_ID,
  INBOX_V2_WORK_ITEM_SCHEMA_ID,
  inboxV2ConversationClientLinkSchema,
  inboxV2ConversationParticipantSetSchema,
  inboxV2ConversationSchema,
  inboxV2ExternalThreadSchema,
  inboxV2MessageSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundRouteSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceIdentityClaimSchema,
  inboxV2SourceThreadBindingSchema,
  inboxV2StaffNoteSchema,
  inboxV2TimelineCommandIntentSchema,
  inboxV2WorkItemSchema
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  createInboxV2ScenarioAuthorization,
  inboxV2AtomicClaimAndReplyScenarioAuthorization,
  inboxV2CanonicalScenarioGuard,
  inboxV2ClientContactClaimScenarioRequirements,
  inboxV2ExternalConversationReadScenarioGuard,
  inboxV2ExternalMessageEditScenarioAuthorization,
  inboxV2ScenarioClientLink,
  inboxV2ScenarioContractIds,
  inboxV2ScenarioConversation,
  inboxV2ScenarioContent,
  inboxV2ScenarioEntity,
  inboxV2ScenarioIdentityClaim,
  inboxV2ScenarioLater,
  inboxV2ScenarioMessage,
  inboxV2ScenarioNow,
  inboxV2ScenarioExternalThread,
  inboxV2ScenarioOutboundRoute,
  inboxV2ScenarioParticipant,
  inboxV2QueueScenarioScopeFact,
  inboxV2ScenarioSourceIdentity,
  inboxV2ScenarioSourceThreadBinding,
  inboxV2ScenarioStaffNote,
  inboxV2ScenarioStateSchema,
  inboxV2ScenarioWorkItem,
  inboxV2WorkScenarioGuard,
  type InboxV2ScenarioState
} from "./scenario-fixtures";
import {
  createInboxV2ScenarioWorld,
  executeInboxV2ScenarioStep,
  getInboxV2ScenarioRecord,
  snapshotInboxV2ScenarioWorld,
  type InboxV2ScenarioSeedRecord,
  type InboxV2ScenarioStep
} from "./scenario-world";

const tenantId = "tenant:scenario-external";
const otherTenantId = "tenant:scenario-other";
const conversationId = "conversation:external-direct-1";
const workItemId = "work_item:external-direct-1";
const sourceIdentityId = "source_external_identity:external-direct-1";
const sourceParticipantId = "conversation_participant:external-source-1";
const sourceMessageId = "message:external-inbound-1";
const lifecycleMessageId = "message:external-outbound-1";
const lifecycleParticipantId = "conversation_participant:external-operator-1";
const claimReplyMessageId = "message:claim-and-reply-1";
const claimReplyParticipantId = "conversation_participant:claim-and-reply-1";
const operatorId = "employee:operator-1";
const supervisorId = "employee:supervisor-1";
const queueId = "work_queue:external-default";
const sourceAccountId = "source_account:external-direct-1";
const sourceConnectionId = "source_connection:external-direct-1";
const bindingId = "source_thread_binding:external-direct-1";
const externalThreadId = "external_thread:external-direct-1";
const claimReplyRouteId = "outbound_route:claim-and-reply-1";

describe("INB2-CON-009 external Inbox V2 scenarios", () => {
  it("keeps an unknown private sender Client-free and claims exactly one responsible", () => {
    const initial = unknownPrivateSenderWorld();
    const before = snapshotInboxV2ScenarioWorld(initial);

    expect(recordsOfType(initial, "core:client")).toHaveLength(0);
    expect(
      recordsOfType(initial, "core:conversation-client-link")
    ).toHaveLength(0);
    expect(recordValue(initial, sourceEntity())).toMatchObject({
      resolution: { status: "unresolved" }
    });
    expect(recordValue(initial, externalThreadEntity())).toMatchObject({
      conversation: { id: conversationId },
      conversationTopology: "direct"
    });
    expect(recordValue(initial, sourceThreadBindingEntity())).toMatchObject({
      externalThread: { id: externalThreadId },
      sourceAccount: { id: sourceAccountId },
      bindingGeneration: "1"
    });
    expect(recordValue(initial, workEntity())).toMatchObject({
      operationalState: { state: "new", primaryAssignment: null }
    });

    const denied = executeInboxV2ScenarioStep(
      initial,
      claimStep({ employeeId: operatorId, grant: false, suffix: "denied" })
    );
    expect(denied.outcome).toBe("rejected");
    expect(denied.world).toBe(initial);
    expect(snapshotInboxV2ScenarioWorld(denied.world)).toEqual(before);

    const winningStep = claimStep({
      employeeId: operatorId,
      grant: true,
      suffix: "winner"
    });
    const claimed = executeInboxV2ScenarioStep(initial, winningStep);
    expect(claimed.outcome, outcomeDetails(claimed)).toBe("committed");
    if (claimed.outcome !== "committed") return;
    expect(recordValue(claimed.world, workEntity())).toMatchObject({
      operationalState: {
        state: "assigned",
        primaryAssignment: { employee: { id: operatorId } }
      }
    });
    expect(recordValue(claimed.world, scenarioStateEntity())).toMatchObject({
      clientIds: [],
      primaryResponsibleEmployeeId: operatorId,
      workItemId
    });
    expect(recordValue(claimed.world, conversationEntity())).toEqual(
      recordValue(initial, conversationEntity())
    );
    expect(claimed.commit.events[0]).toMatchObject({
      typeId: "core:work-item.changed",
      accessEffect: {
        kind: "may_change_access",
        causes: ["work_item_relation_or_state"]
      }
    });
    expect(claimed.commit.commit.audienceImpact).toMatchObject({
      kind: "structural",
      deliveryFence: "invalidate_before_payload"
    });
    expect(
      recordValue<ReturnType<typeof inboxV2ScenarioMessage>>(
        claimed.world,
        messageEntity()
      ).authorParticipant.id
    ).toBe(sourceParticipantId);

    const loser = executeInboxV2ScenarioStep(
      claimed.world,
      claimStep({
        employeeId: supervisorId,
        grant: true,
        suffix: "loser",
        currentStateRevision: "2"
      })
    );
    expect(loser).toMatchObject({
      outcome: "rejected",
      authorization: { publicErrorCode: "resource.not_found" }
    });
    expect(loser.world).toBe(claimed.world);

    const replay = executeInboxV2ScenarioStep(
      claimed.world,
      claimStep({ employeeId: operatorId, grant: true, suffix: "winner" })
    );
    expect(replay.outcome).toBe("replayed");
    if (replay.outcome !== "replayed") return;
    expect(replay.result.kind).toBe("committed");
    expect(replay.world).toBe(claimed.world);
    expect(replay.world.commits).toHaveLength(1);

    const reusedCommandId = executeInboxV2ScenarioStep(claimed.world, {
      ...winningStep,
      id: "claim-command-id-reuse",
      requestId: "scenario-request:claim-command-id-reuse",
      clientMutationId: "scenario-mutation:claim-command-id-reuse"
    });
    expect(reusedCommandId).toMatchObject({
      outcome: "conflict",
      errorCode: "command.idempotency_conflict"
    });
    expect(reusedCommandId.world).toBe(claimed.world);
  });

  it("atomically claims unassigned Work and creates one routed reply", () => {
    const initial = unknownPrivateSenderWorld();
    const before = snapshotInboxV2ScenarioWorld(initial);
    const authorization = inboxV2AtomicClaimAndReplyScenarioAuthorization({
      tenantId,
      employeeId: operatorId,
      conversationId,
      workItemId,
      queueId,
      sourceAccountId,
      bindingId,
      externalThreadId
    });
    const makeStep = (
      suffix: string,
      stepAuthorization: typeof authorization
    ) =>
      baseStep(
        `claim-and-reply-${suffix}`,
        stepAuthorization,
        ({ requireRecord }) => {
          const currentWork = requireRecord(workEntity());
          const currentState = requireRecord(scenarioStateEntity());
          const currentParticipants = requireRecord(participantSetEntity());
          const participant = inboxV2ScenarioParticipant({
            tenantId,
            conversationId,
            id: claimReplyParticipantId,
            subject: { kind: "employee", employeeId: operatorId }
          });
          const participants = [
            ...(currentParticipants.value as ReturnType<
              typeof inboxV2ConversationParticipantSetSchema.parse
            >),
            participant
          ];
          const message = inboxV2ScenarioMessage({
            tenantId,
            conversationId,
            id: claimReplyMessageId,
            authorParticipantId: claimReplyParticipantId,
            origin: "hulee_external",
            outboundRouteId: claimReplyRouteId,
            content: inboxV2ScenarioContent({
              tenantId,
              id: "timeline_content:claim-and-reply-1",
              text: "Atomic claim and reply"
            })
          });
          const route = inboxV2ScenarioOutboundRoute({
            tenantId,
            id: claimReplyRouteId,
            conversationId,
            externalThreadId,
            bindingId,
            sourceAccountId,
            sourceConnectionId,
            employeeId: operatorId
          });
          const dispatch = inboxV2OutboundDispatchSchema.parse({
            tenantId,
            id: "outbound_dispatch:claim-and-reply-1",
            message: {
              tenantId,
              kind: "message",
              id: claimReplyMessageId
            },
            route: {
              tenantId,
              kind: "outbound_route",
              id: claimReplyRouteId
            },
            multiSendOperation: null,
            state: "queued",
            attemptCount: 0,
            activeAttempt: null,
            lastAttempt: null,
            retryAuthorization: null,
            revision: "1",
            createdAt: inboxV2ScenarioLater,
            updatedAt: inboxV2ScenarioLater
          });
          const nextWork = inboxV2ScenarioWorkItem({
            tenantId,
            conversationId,
            id: workItemId,
            queueId,
            responsibleEmployeeId: operatorId,
            revision: "2",
            updatedAt: inboxV2ScenarioLater
          });
          const nextState: InboxV2ScenarioState = {
            ...(currentState.value as InboxV2ScenarioState),
            participantIds: [sourceParticipantId, claimReplyParticipantId],
            primaryResponsibleEmployeeId: operatorId,
            physicalMessageIds: [sourceMessageId, claimReplyMessageId],
            action: "atomic_claim_and_reply",
            status: "assigned",
            revision: "2"
          };
          return {
            kind: "commit",
            changes: [
              {
                entity: workEntity(),
                expectedRevision: currentWork.revision,
                resultingRevision: "2",
                schemaId: INBOX_V2_WORK_ITEM_SCHEMA_ID,
                schema: inboxV2WorkItemSchema,
                value: nextWork,
                audience: "workforce_metadata"
              },
              {
                entity: participantSetEntity(),
                expectedRevision: currentParticipants.revision,
                resultingRevision: "2",
                schemaId: "core:inbox-v2.conversation-participant-set",
                schemaVersion: INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
                schema: inboxV2ConversationParticipantSetSchema,
                value: participants,
                audience: "conversation_external"
              },
              {
                entity: claimReplyMessageEntity(),
                expectedRevision: null,
                resultingRevision: "1",
                schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
                schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
                schema: inboxV2MessageSchema,
                value: message,
                audience: "conversation_external",
                timeline: {
                  conversation: {
                    tenantId,
                    kind: "conversation",
                    id: conversationId
                  },
                  timelineSequence: "2"
                }
              },
              {
                entity: claimReplyRouteEntity(),
                expectedRevision: null,
                resultingRevision: "1",
                schemaId: INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
                schemaVersion: INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
                schema: inboxV2OutboundRouteSchema,
                value: route,
                audience: "policy_filtered"
              },
              {
                entity: claimReplyDispatchEntity(),
                expectedRevision: null,
                resultingRevision: "1",
                schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
                schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
                schema: inboxV2OutboundDispatchSchema,
                value: dispatch,
                audience: "policy_filtered"
              },
              {
                entity: scenarioStateEntity(),
                expectedRevision: currentState.revision,
                resultingRevision: "2",
                schemaId: inboxV2ScenarioContractIds.scenarioState,
                schema: inboxV2ScenarioStateSchema,
                value: nextState,
                audience: "workforce_metadata"
              }
            ],
            outboxEffects: [
              {
                typeId: "core:provider.dispatch",
                handlerId: "core:claim-and-reply-provider-dispatch",
                effectClass: "provider_io",
                changeEntities: [
                  claimReplyMessageEntity(),
                  claimReplyRouteEntity(),
                  claimReplyDispatchEntity()
                ],
                payloadFromEntity: claimReplyDispatchEntity()
              }
            ],
            resultEntity: claimReplyMessageEntity()
          };
        }
      );

    const deniedAuthorization = {
      ...authorization,
      grants: authorization.grants.filter(
        (grant) => grant.permissionId !== "core:message.reply_external"
      )
    };
    const denied = executeInboxV2ScenarioStep(
      initial,
      makeStep("denied", deniedAuthorization)
    );
    expect(denied).toMatchObject({
      outcome: "rejected",
      authorization: { publicErrorCode: "permission.denied" }
    });
    expect(denied.world).toBe(initial);
    expect(snapshotInboxV2ScenarioWorld(denied.world)).toEqual(before);

    const committed = executeInboxV2ScenarioStep(
      initial,
      makeStep("allowed", authorization)
    );
    expect(committed.outcome, outcomeDetails(committed)).toBe("committed");
    if (committed.outcome !== "committed") return;
    expect(committed.world.commits).toHaveLength(1);
    expect(recordValue(committed.world, workEntity())).toMatchObject({
      operationalState: {
        state: "assigned",
        primaryAssignment: { employee: { id: operatorId } }
      }
    });
    expect(
      recordValue<ReturnType<typeof inboxV2ScenarioMessage>>(
        committed.world,
        claimReplyMessageEntity()
      ).authorParticipant.id
    ).toBe(claimReplyParticipantId);
    expect(committed.commit.outboxIntents).toHaveLength(1);
    expect(recordValue(committed.world, claimReplyRouteEntity())).toMatchObject(
      {
        id: claimReplyRouteId,
        conversation: { id: conversationId },
        externalThread: { id: externalThreadId },
        sourceThreadBinding: { id: bindingId },
        sourceAccount: { id: sourceAccountId }
      }
    );
    expect(committed.commit.outboxIntents[0]).toMatchObject({
      typeId: "core:provider.dispatch",
      effectClass: "provider_io",
      payloadReference: {
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
        schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION
      }
    });
    expect(committed.commit.events[0]).toMatchObject({
      typeId: "core:work-item.changed",
      accessEffect: { kind: "may_change_access" }
    });
  });

  it("rejects decoy and duplicate provider outbox selections", () => {
    const world = outboundMessageLifecycleWorld();
    const before = snapshotInboxV2ScenarioWorld(world);
    const authorization = inboxV2ExternalMessageEditScenarioAuthorization({
      tenantId,
      employeeId: operatorId,
      conversationId,
      timelineItemId: "timeline_item:external-outbound-1",
      sourceAccountId,
      bindingId,
      externalReferenceId: "external_message_reference:external-outbound-1"
    });
    const decoyMessageId = "message:provider-decoy-1";
    const decoyRouteId = "outbound_route:provider-decoy-1";
    const decoyDispatchId = "outbound_dispatch:provider-decoy-1";
    const decoyMessageEntity = inboxV2ScenarioEntity(
      tenantId,
      "core:message",
      decoyMessageId
    );
    const decoyRouteEntity = inboxV2ScenarioEntity(
      tenantId,
      "core:outbound-route",
      decoyRouteId
    );
    const decoyDispatchEntity = inboxV2ScenarioEntity(
      tenantId,
      "core:outbound-dispatch",
      decoyDispatchId
    );
    const canonicalEntities = {
      message: decoyMessageEntity,
      route: decoyRouteEntity,
      dispatch: decoyDispatchEntity
    } as const;
    const falseTypeEntities = {
      message: inboxV2ScenarioEntity(
        tenantId,
        "module:hulee-testing:false-message",
        decoyMessageId
      ),
      route: inboxV2ScenarioEntity(
        tenantId,
        "module:hulee-testing:false-outbound-route",
        decoyRouteId
      ),
      dispatch: inboxV2ScenarioEntity(
        tenantId,
        "module:hulee-testing:false-outbound-dispatch",
        decoyDispatchId
      )
    } as const;
    const decoyMessage = inboxV2ScenarioMessage({
      tenantId,
      conversationId,
      id: decoyMessageId,
      authorParticipantId: lifecycleParticipantId,
      origin: "hulee_external",
      outboundRouteId: decoyRouteId
    });
    const decoyRoute = inboxV2ScenarioOutboundRoute({
      tenantId,
      id: decoyRouteId,
      conversationId,
      externalThreadId,
      bindingId,
      sourceAccountId,
      sourceConnectionId,
      employeeId: operatorId
    });
    const dispatchToExistingPair = inboxV2OutboundDispatchSchema.parse({
      tenantId,
      id: decoyDispatchId,
      message: { tenantId, kind: "message", id: lifecycleMessageId },
      route: {
        tenantId,
        kind: "outbound_route",
        id: "outbound_route:external-direct-1"
      },
      multiSendOperation: null,
      state: "queued",
      attemptCount: 0,
      activeAttempt: null,
      lastAttempt: null,
      retryAuthorization: null,
      revision: "1",
      createdAt: inboxV2ScenarioLater,
      updatedAt: inboxV2ScenarioLater
    });
    const effectFor = (entities: typeof canonicalEntities) => ({
      typeId: "core:provider.dispatch" as const,
      handlerId: "core:provider-decoy-dispatch",
      effectClass: "provider_io" as const,
      changeEntities: [entities.message, entities.route, entities.dispatch],
      payloadFromEntity: entities.dispatch
    });
    const effect = effectFor(canonicalEntities);
    const makeStep = (
      suffix: string,
      outboxEffects: readonly ReturnType<typeof effectFor>[],
      entities: typeof canonicalEntities = canonicalEntities
    ) =>
      baseStep(`provider-outbox-${suffix}`, authorization, () => ({
        kind: "commit",
        changes: [
          {
            entity: entities.message,
            expectedRevision: null,
            resultingRevision: "1",
            schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
            schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
            schema: inboxV2MessageSchema,
            value: decoyMessage,
            audience: "conversation_external"
          },
          {
            entity: entities.route,
            expectedRevision: null,
            resultingRevision: "1",
            schemaId: INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
            schemaVersion: INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
            schema: inboxV2OutboundRouteSchema,
            value: decoyRoute,
            audience: "policy_filtered"
          },
          {
            entity: entities.dispatch,
            expectedRevision: null,
            resultingRevision: "1",
            schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
            schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
            schema: inboxV2OutboundDispatchSchema,
            value: dispatchToExistingPair,
            audience: "policy_filtered"
          }
        ],
        outboxEffects
      }));

    expect(() =>
      executeInboxV2ScenarioStep(world, makeStep("decoy", [effect]))
    ).toThrow(/selected decoy Message or OutboundRoute/u);
    expect(snapshotInboxV2ScenarioWorld(world)).toEqual(before);
    expect(() =>
      executeInboxV2ScenarioStep(
        world,
        makeStep("duplicate", [effect, { ...effect }])
      )
    ).toThrow(/duplicate provider effects/u);
    expect(snapshotInboxV2ScenarioWorld(world)).toEqual(before);
    const falseTypeEffect = effectFor(falseTypeEntities);
    expect(() =>
      executeInboxV2ScenarioStep(
        world,
        makeStep("false-entity-types", [falseTypeEffect], falseTypeEntities)
      )
    ).toThrow(
      /requires one exact Message, OutboundRoute and OutboundDispatch/u
    );
    expect(snapshotInboxV2ScenarioWorld(world)).toEqual(before);
  });

  it("permits a reasoned supervisor override but never two active primaries", () => {
    const claimed = executeInboxV2ScenarioStep(
      unknownPrivateSenderWorld(),
      claimStep({
        employeeId: operatorId,
        grant: true,
        suffix: "override-base"
      })
    );
    expect(claimed.outcome, outcomeDetails(claimed)).toBe("committed");
    if (claimed.outcome !== "committed") return;

    const deniedAuthorization = overrideAuthorization({ reason: null });
    const denied = executeInboxV2ScenarioStep(
      claimed.world,
      baseStep("override-no-reason", deniedAuthorization, () => ({
        kind: "reject",
        errorCode: "should-not-reach-transition"
      }))
    );
    expect(denied.outcome).toBe("rejected");
    expect(denied.world).toBe(claimed.world);

    const allowedAuthorization = overrideAuthorization({
      reason: "verified supervisor reassignment"
    });
    const overridden = executeInboxV2ScenarioStep(
      claimed.world,
      baseStep(
        "override-allowed",
        allowedAuthorization,
        ({ requireRecord }) => {
          const currentWork = requireRecord(workEntity());
          const currentState = requireRecord(scenarioStateEntity());
          const nextWork = inboxV2ScenarioWorkItem({
            tenantId,
            conversationId,
            id: workItemId,
            queueId,
            responsibleEmployeeId: supervisorId,
            revision: "3",
            updatedAt: "2026-07-13T10:00:00.000Z"
          });
          const nextState = {
            ...(currentState.value as InboxV2ScenarioState),
            primaryResponsibleEmployeeId: supervisorId,
            revision: "3"
          };
          return {
            kind: "commit",
            changes: [
              {
                entity: workEntity(),
                expectedRevision: currentWork.revision,
                resultingRevision: "3",
                schemaId: INBOX_V2_WORK_ITEM_SCHEMA_ID,
                schema: inboxV2WorkItemSchema,
                value: nextWork,
                audience: "workforce_metadata"
              },
              {
                entity: scenarioStateEntity(),
                expectedRevision: currentState.revision,
                resultingRevision: "3",
                schemaId: inboxV2ScenarioContractIds.scenarioState,
                schema: inboxV2ScenarioStateSchema,
                value: nextState,
                audience: "workforce_metadata"
              }
            ]
          };
        }
      )
    );
    expect(overridden.outcome).toBe("committed");
    if (overridden.outcome !== "committed") return;
    const work = recordValue<ReturnType<typeof inboxV2ScenarioWorkItem>>(
      overridden.world,
      workEntity()
    );
    expect(work.operationalState.primaryAssignment?.employee.id).toBe(
      supervisorId
    );
    expect(
      JSON.stringify(work).match(/work_item_primary_assignment:/gu)
    ).toHaveLength(1);
  });

  it("preserves two Client links, five participants and one physical group message", () => {
    const world = multiClientGroupWorld();
    const state = recordValue<InboxV2ScenarioState>(world, groupStateEntity());

    expect(state.clientIds).toEqual(["client:group-1", "client:group-2"]);
    expect(state.participantIds).toHaveLength(5);
    expect(state.physicalMessageIds).toEqual(["message:group-physical-1"]);
    expect(state.primaryResponsibleEmployeeId).toBe(operatorId);
    expect(recordsOfType(world, "core:conversation-client-link")).toHaveLength(
      2
    );
    expect(recordsOfType(world, "core:source-external-identity")).toHaveLength(
      2
    );
    expect(
      new Set(
        recordsOfType(world, "core:source-external-identity").map(
          (record) =>
            (record.value as ReturnType<typeof inboxV2ScenarioSourceIdentity>)
              .canonicalExternalSubject
        )
      ).size
    ).toBe(2);
    expect(recordsOfType(world, "core:external-thread")).toHaveLength(1);
    expect(recordsOfType(world, "core:source-thread-binding")).toHaveLength(1);
    expect(
      recordsOfType(world, "core:source-thread-binding")[0]?.value
    ).toMatchObject({
      id: state.groupBindingId,
      externalThread: { id: "external_thread:group-1" },
      sourceAccount: { id: "source_account:group-1" }
    });
    expect(recordsOfType(world, "core:message")).toHaveLength(1);

    const conversationResource = inboxV2ScenarioEntity(
      tenantId,
      "core:conversation",
      "conversation:external-group-1"
    );
    const authorization = createInboxV2ScenarioAuthorization({
      tenantId,
      employeeId: operatorId,
      requirements: [
        {
          id: "staff-note",
          permissionId: "core:message.staff_note.create",
          resource: conversationResource,
          guard: {
            ...inboxV2CanonicalScenarioGuard("staff_only"),
            companionRequirementIds: ["staff-note-conversation-read"]
          }
        },
        {
          id: "staff-note-conversation-read",
          permissionId: "core:conversation.read",
          resource: conversationResource,
          guard: inboxV2ExternalConversationReadScenarioGuard({
            tenantId,
            conversationId: "conversation:external-group-1"
          }),
          visibility: "secondary_hidden"
        }
      ]
    });
    const noteEntity = inboxV2ScenarioEntity(
      tenantId,
      "core:staff-note",
      "staff_note:group-1"
    );
    const result = executeInboxV2ScenarioStep(
      world,
      baseStep("group-staff-note", authorization, () => ({
        kind: "commit",
        changes: [
          {
            entity: noteEntity,
            expectedRevision: null,
            resultingRevision: "1",
            schemaId: INBOX_V2_STAFF_NOTE_SCHEMA_ID,
            schema: inboxV2StaffNoteSchema,
            value: inboxV2ScenarioStaffNote({
              tenantId,
              conversationId: "conversation:external-group-1",
              id: "staff_note:group-1",
              authorParticipantId: "conversation_participant:group-employee-1"
            }),
            audience: "staff_only"
          }
        ],
        outboxEffects: [
          {
            typeId: "core:projection.update",
            handlerId: "core:staff-note-projection",
            effectClass: "projection",
            changeEntities: [noteEntity]
          }
        ]
      }))
    );
    expect(result.outcome, outcomeDetails(result)).toBe("committed");
    if (result.outcome !== "committed") return;
    expect(
      result.commit.outboxIntents.some(
        (intent) => intent.effectClass === "provider_io"
      )
    ).toBe(false);
    expect(recordValue(result.world, groupStateEntity())).toEqual(state);
    expect(recordsOfType(result.world, "core:message")).toHaveLength(1);
  });

  it("rejects provider routing fields on a staff note and emits no provider dispatch", () => {
    const invalid = inboxV2TimelineCommandIntentSchema.safeParse({
      kind: "create_staff_note",
      tenantId,
      conversation: {
        tenantId,
        kind: "conversation",
        id: conversationId
      },
      authorParticipant: {
        tenantId,
        kind: "conversation_participant",
        id: "conversation_participant:employee-1"
      },
      appActor: {
        kind: "employee",
        employee: { tenantId, kind: "employee", id: operatorId },
        authorizationEpoch: "authorization:scenario-operator-1"
      },
      automationCausation: null,
      content: {
        blocks: [{ blockKey: "body", kind: "text", role: "body", text: "x" }]
      },
      fileReadProofs: [],
      outboundRoute: {
        tenantId,
        kind: "outbound_route",
        id: "outbound_route:forbidden"
      },
      occurredAt: inboxV2ScenarioLater
    });
    expect(invalid.success).toBe(false);
  });

  it("claims an identity once without changing participant or Message authorship", () => {
    const world = unknownPrivateSenderWorld();
    const participantBefore = recordValue(world, participantSetEntity());
    const messageBefore = recordValue(world, messageEntity());
    const claimRequirements = inboxV2ClientContactClaimScenarioRequirements({
      tenantId,
      actorEmployeeId: operatorId,
      sourceIdentityId,
      clientContactId: "client_contact:known-1"
    });
    const authorization = createInboxV2ScenarioAuthorization({
      tenantId,
      employeeId: operatorId,
      requirements: claimRequirements.requirements
    });
    const claimEntity = inboxV2ScenarioEntity(
      tenantId,
      "core:source-identity-claim",
      "source_identity_claim:scenario-1"
    );
    const claimed = executeInboxV2ScenarioStep(
      world,
      baseStep("identity-claim", authorization, ({ requireRecord }) => {
        const current = requireRecord(sourceEntity());
        const claim = inboxV2ScenarioIdentityClaim({
          tenantId,
          sourceIdentityId,
          clientContactId: "client_contact:known-1",
          actorEmployeeId: operatorId
        });
        const identity = inboxV2ScenarioSourceIdentity({
          tenantId,
          id: sourceIdentityId,
          resolution: {
            status: "claimed",
            activeClaim: {
              tenantId,
              kind: "source_identity_claim",
              id: claim.id
            }
          },
          latestClaimVersion: "1",
          revision: "2",
          updatedAt: inboxV2ScenarioLater
        });
        return {
          kind: "commit",
          changes: [
            {
              entity: claimEntity,
              expectedRevision: null,
              resultingRevision: "1",
              schemaId: INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
              schema: inboxV2SourceIdentityClaimSchema,
              value: claim,
              audience: "policy_filtered"
            },
            {
              entity: sourceEntity(),
              expectedRevision: current.revision,
              resultingRevision: "2",
              schemaId: INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
              schema: inboxV2SourceExternalIdentitySchema,
              value: identity,
              audience: "policy_filtered"
            }
          ]
        };
      })
    );
    expect(claimed.outcome, outcomeDetails(claimed)).toBe("committed");
    if (claimed.outcome !== "committed") return;
    expect(recordValue(claimed.world, participantSetEntity())).toEqual(
      participantBefore
    );
    expect(recordValue(claimed.world, messageEntity())).toEqual(messageBefore);
    expect(
      recordValue<ReturnType<typeof inboxV2ScenarioMessage>>(
        claimed.world,
        messageEntity()
      ).authorParticipant.id
    ).toBe(sourceParticipantId);

    const second = executeInboxV2ScenarioStep(
      claimed.world,
      baseStep("identity-claim-second", authorization, () => ({
        kind: "commit",
        changes: [
          {
            entity: claimEntity,
            expectedRevision: null,
            resultingRevision: "1",
            schemaId: INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
            schema: inboxV2SourceIdentityClaimSchema,
            value: inboxV2ScenarioIdentityClaim({
              tenantId,
              sourceIdentityId,
              clientContactId: "client_contact:known-2",
              actorEmployeeId: operatorId
            }),
            audience: "policy_filtered"
          }
        ]
      }))
    );
    expect(second).toMatchObject({
      outcome: "conflict",
      errorCode: "revision.conflict"
    });
    expect(second.world).toBe(claimed.world);
  });

  it("applies edit and delete lifecycle revisions, rejects stale changes and keeps authorship", () => {
    const world = outboundMessageLifecycleWorld();
    const message = recordValue<ReturnType<typeof inboxV2ScenarioMessage>>(
      world,
      lifecycleMessageEntity()
    );
    const authorization = inboxV2ExternalMessageEditScenarioAuthorization({
      tenantId,
      employeeId: operatorId,
      conversationId,
      timelineItemId: "timeline_item:external-outbound-1",
      sourceAccountId: "source_account:external-direct-1",
      bindingId: "source_thread_binding:external-direct-1",
      externalReferenceId: "external_message_reference:external-outbound-1"
    });
    const editedMessage = inboxV2ScenarioMessage({
      tenantId,
      conversationId,
      id: lifecycleMessageId,
      authorParticipantId: lifecycleParticipantId,
      origin: "hulee_external",
      outboundRouteId: "outbound_route:external-direct-1",
      content: inboxV2ScenarioContent({
        tenantId,
        id: "timeline_content:external-outbound-2",
        text: "Edited outbound message",
        revision: "2",
        updatedAt: inboxV2ScenarioLater
      }),
      revision: "2",
      updatedAt: inboxV2ScenarioLater
    });
    const edited = executeInboxV2ScenarioStep(
      world,
      baseStep("message-edit", authorization, () => ({
        kind: "commit",
        changes: [
          {
            entity: lifecycleMessageEntity(),
            expectedRevision: "1",
            resultingRevision: "2",
            schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
            schema: inboxV2MessageSchema,
            value: editedMessage,
            audience: "conversation_external"
          }
        ]
      }))
    );
    expect(edited.outcome, outcomeDetails(edited)).toBe("committed");
    if (edited.outcome !== "committed") return;
    expect(
      recordValue<ReturnType<typeof inboxV2ScenarioMessage>>(
        edited.world,
        lifecycleMessageEntity()
      ).authorParticipant
    ).toEqual(message.authorParticipant);

    const stale = executeInboxV2ScenarioStep(
      edited.world,
      baseStep("message-edit-stale", authorization, () => ({
        kind: "commit",
        changes: [
          {
            entity: lifecycleMessageEntity(),
            expectedRevision: "1",
            resultingRevision: "2",
            schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
            schema: inboxV2MessageSchema,
            value: editedMessage,
            audience: "conversation_external"
          }
        ]
      }))
    );
    expect(stale).toMatchObject({
      outcome: "conflict",
      errorCode: "revision.conflict"
    });
    expect(stale.world).toBe(edited.world);

    const deleteAuthorization = inboxV2ExternalMessageEditScenarioAuthorization(
      {
        tenantId,
        employeeId: operatorId,
        conversationId,
        timelineItemId: "timeline_item:external-outbound-1",
        sourceAccountId,
        bindingId,
        externalReferenceId: "external_message_reference:external-outbound-1",
        operation: "delete",
        targetRevision: "2"
      }
    );
    const deletedMessage = inboxV2ScenarioMessage({
      tenantId,
      conversationId,
      id: lifecycleMessageId,
      authorParticipantId: lifecycleParticipantId,
      origin: "hulee_external",
      outboundRouteId: "outbound_route:external-direct-1",
      content: inboxV2ScenarioContent({
        tenantId,
        id: "timeline_content:external-outbound-2",
        text: "Edited outbound message",
        revision: "2",
        updatedAt: inboxV2ScenarioLater
      }),
      lifecycle: {
        kind: "local_delete_tombstone",
        revisionId: "message_revision:external-outbound-3",
        reasonId: "core:author-delete",
        deletedAt: inboxV2ScenarioLater
      },
      revision: "3",
      updatedAt: inboxV2ScenarioLater
    });
    const deleted = executeInboxV2ScenarioStep(
      edited.world,
      baseStep("message-delete", deleteAuthorization, () => ({
        kind: "commit",
        changes: [
          {
            entity: lifecycleMessageEntity(),
            expectedRevision: "2",
            resultingRevision: "3",
            schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
            schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
            schema: inboxV2MessageSchema,
            value: deletedMessage,
            audience: "conversation_external"
          }
        ]
      }))
    );
    expect(deleted.outcome, outcomeDetails(deleted)).toBe("committed");
    if (deleted.outcome !== "committed") return;
    const lifecycleRecord = recordValue<
      ReturnType<typeof inboxV2ScenarioMessage>
    >(deleted.world, lifecycleMessageEntity());
    expect(lifecycleRecord.lifecycle).toMatchObject({
      kind: "local_delete_tombstone",
      reasonId: "core:author-delete"
    });
    expect(lifecycleRecord.authorParticipant).toEqual(
      message.authorParticipant
    );
    expect(lifecycleRecord.origin).toEqual(message.origin);

    const duplicateDelete = executeInboxV2ScenarioStep(
      deleted.world,
      baseStep("message-delete-stale", deleteAuthorization, () => ({
        kind: "commit",
        changes: [
          {
            entity: lifecycleMessageEntity(),
            expectedRevision: "2",
            resultingRevision: "3",
            schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
            schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
            schema: inboxV2MessageSchema,
            value: deletedMessage,
            audience: "conversation_external"
          }
        ]
      }))
    );
    expect(duplicateDelete).toMatchObject({
      outcome: "conflict",
      errorCode: "revision.conflict"
    });
    expect(duplicateDelete.world).toBe(deleted.world);
  });

  it("rejects a cross-tenant authorization plan before mutation", () => {
    const world = unknownPrivateSenderWorld();
    const foreignResource = inboxV2ScenarioEntity(
      otherTenantId,
      "core:conversation",
      "conversation:foreign"
    );
    const foreignAuthorization = createInboxV2ScenarioAuthorization({
      tenantId: otherTenantId,
      employeeId: "employee:foreign",
      requirements: [
        {
          id: "foreign",
          permissionId: "core:conversation.internal.create",
          resource: foreignResource,
          guard: inboxV2CanonicalScenarioGuard("none")
        }
      ]
    });
    expect(() =>
      executeInboxV2ScenarioStep(
        world,
        baseStep("cross-tenant", foreignAuthorization, () => ({
          kind: "reject",
          errorCode: "should-not-run"
        }))
      )
    ).toThrow(/tenant boundary/u);
    expect(snapshotInboxV2ScenarioWorld(world)).toEqual(world);
  });
});

function unknownPrivateSenderWorld() {
  const conversation = inboxV2ScenarioConversation({
    tenantId,
    id: conversationId,
    topology: "direct",
    transport: "external"
  });
  const sourceIdentity = inboxV2ScenarioSourceIdentity({
    tenantId,
    id: sourceIdentityId
  });
  const externalThread = inboxV2ScenarioExternalThread({
    tenantId,
    conversationId,
    id: externalThreadId,
    sourceAccountId,
    topology: "direct"
  });
  const sourceThreadBinding = inboxV2ScenarioSourceThreadBinding({
    tenantId,
    id: bindingId,
    externalThreadId,
    sourceAccountId,
    sourceConnectionId
  });
  const participant = inboxV2ScenarioParticipant({
    tenantId,
    conversationId,
    id: sourceParticipantId,
    subject: {
      kind: "source_external_identity",
      sourceExternalIdentityId: sourceIdentityId
    }
  });
  const message = inboxV2ScenarioMessage({
    tenantId,
    conversationId,
    id: sourceMessageId,
    authorParticipantId: sourceParticipantId,
    origin: "source_originated"
  });
  const workItem = inboxV2ScenarioWorkItem({
    tenantId,
    conversationId,
    id: workItemId,
    queueId
  });
  const state: InboxV2ScenarioState = {
    tenantId,
    kind: "external_thread",
    conversationId,
    clientIds: [],
    participantIds: [sourceParticipantId],
    employeeAnchorIds: [],
    ownerEmployeeIds: [],
    workItemId,
    primaryResponsibleEmployeeId: null,
    groupBindingId: null,
    senderPrivateIdentityId: sourceIdentityId,
    physicalMessageIds: [sourceMessageId],
    action: null,
    status: "new",
    revision: "1"
  };
  return createInboxV2ScenarioWorld({
    tenantId,
    records: [
      seed(
        conversationEntity(),
        INBOX_V2_CONVERSATION_SCHEMA_ID,
        INBOX_V2_CONVERSATION_SCHEMA_VERSION,
        inboxV2ConversationSchema,
        conversation
      ),
      seed(
        sourceEntity(),
        INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
        INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
        inboxV2SourceExternalIdentitySchema,
        sourceIdentity
      ),
      seed(
        externalThreadEntity(),
        INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
        INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
        inboxV2ExternalThreadSchema,
        externalThread
      ),
      seed(
        sourceThreadBindingEntity(),
        INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID,
        INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
        inboxV2SourceThreadBindingSchema,
        sourceThreadBinding
      ),
      seed(
        participantSetEntity(),
        "core:inbox-v2.conversation-participant-set",
        INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
        inboxV2ConversationParticipantSetSchema,
        [participant]
      ),
      seed(
        messageEntity(),
        INBOX_V2_MESSAGE_SCHEMA_ID,
        INBOX_V2_MESSAGE_SCHEMA_VERSION,
        inboxV2MessageSchema,
        message
      ),
      seed(
        workEntity(),
        INBOX_V2_WORK_ITEM_SCHEMA_ID,
        "v1",
        inboxV2WorkItemSchema,
        workItem
      ),
      seed(
        scenarioStateEntity(),
        inboxV2ScenarioContractIds.scenarioState,
        "v1",
        inboxV2ScenarioStateSchema,
        state
      )
    ]
  });
}

function outboundMessageLifecycleWorld() {
  const conversation = inboxV2ScenarioConversation({
    tenantId,
    id: conversationId,
    topology: "direct",
    transport: "external"
  });
  const participant = inboxV2ScenarioParticipant({
    tenantId,
    conversationId,
    id: lifecycleParticipantId,
    subject: { kind: "employee", employeeId: operatorId }
  });
  const externalThread = inboxV2ScenarioExternalThread({
    tenantId,
    conversationId,
    id: externalThreadId,
    sourceAccountId,
    topology: "direct"
  });
  const sourceThreadBinding = inboxV2ScenarioSourceThreadBinding({
    tenantId,
    id: bindingId,
    externalThreadId,
    sourceAccountId,
    sourceConnectionId
  });
  const route = inboxV2ScenarioOutboundRoute({
    tenantId,
    id: "outbound_route:external-direct-1",
    conversationId,
    externalThreadId,
    bindingId,
    sourceAccountId,
    sourceConnectionId,
    employeeId: operatorId,
    selectedAt: inboxV2ScenarioNow
  });
  const message = inboxV2ScenarioMessage({
    tenantId,
    conversationId,
    id: lifecycleMessageId,
    authorParticipantId: lifecycleParticipantId,
    origin: "hulee_external",
    outboundRouteId: "outbound_route:external-direct-1"
  });
  return createInboxV2ScenarioWorld({
    tenantId,
    records: [
      seed(
        conversationEntity(),
        INBOX_V2_CONVERSATION_SCHEMA_ID,
        INBOX_V2_CONVERSATION_SCHEMA_VERSION,
        inboxV2ConversationSchema,
        conversation
      ),
      seed(
        participantSetEntity(),
        "core:inbox-v2.conversation-participant-set",
        INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
        inboxV2ConversationParticipantSetSchema,
        [participant]
      ),
      seed(
        externalThreadEntity(),
        INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
        INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
        inboxV2ExternalThreadSchema,
        externalThread
      ),
      seed(
        sourceThreadBindingEntity(),
        INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID,
        INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
        inboxV2SourceThreadBindingSchema,
        sourceThreadBinding
      ),
      seed(
        inboxV2ScenarioEntity(
          tenantId,
          "core:outbound-route",
          "outbound_route:external-direct-1"
        ),
        INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
        INBOX_V2_OUTBOUND_ROUTE_SCHEMA_VERSION,
        inboxV2OutboundRouteSchema,
        route
      ),
      seed(
        lifecycleMessageEntity(),
        INBOX_V2_MESSAGE_SCHEMA_ID,
        INBOX_V2_MESSAGE_SCHEMA_VERSION,
        inboxV2MessageSchema,
        message
      )
    ]
  });
}

function multiClientGroupWorld() {
  const groupConversationId = "conversation:external-group-1";
  const groupExternalThreadId = "external_thread:group-1";
  const groupBindingId = "source_thread_binding:group-1";
  const groupSourceAccountId = "source_account:group-1";
  const groupSourceConnectionId = "source_connection:group-1";
  const conversation = inboxV2ScenarioConversation({
    tenantId,
    id: groupConversationId,
    topology: "group",
    transport: "external"
  });
  const externalThread = inboxV2ScenarioExternalThread({
    tenantId,
    conversationId: groupConversationId,
    id: groupExternalThreadId,
    sourceAccountId: groupSourceAccountId,
    topology: "group"
  });
  const sourceThreadBinding = inboxV2ScenarioSourceThreadBinding({
    tenantId,
    id: groupBindingId,
    externalThreadId: groupExternalThreadId,
    sourceAccountId: groupSourceAccountId,
    sourceConnectionId: groupSourceConnectionId
  });
  const sourceIdentities = [1, 2].map((ordinal) =>
    inboxV2ScenarioSourceIdentity({
      tenantId,
      id: `source_external_identity:group-${ordinal}`
    })
  );
  const participantInputs: ReadonlyArray<
    readonly [
      string,
      (
        | Readonly<{ kind: "employee"; employeeId: string }>
        | Readonly<{
            kind: "source_external_identity";
            sourceExternalIdentityId: string;
          }>
      )
    ]
  > = [
    [
      "conversation_participant:group-source-1",
      {
        kind: "source_external_identity" as const,
        sourceExternalIdentityId: "source_external_identity:group-1"
      }
    ],
    [
      "conversation_participant:group-source-2",
      {
        kind: "source_external_identity" as const,
        sourceExternalIdentityId: "source_external_identity:group-2"
      }
    ],
    ...[1, 2, 3].map(
      (ordinal) =>
        [
          `conversation_participant:group-employee-${ordinal}`,
          {
            kind: "employee" as const,
            employeeId: ordinal === 1 ? operatorId : `employee:group-${ordinal}`
          }
        ] as const
    )
  ];
  const participants = participantInputs.map(([id, subject]) =>
    inboxV2ScenarioParticipant({
      tenantId,
      conversationId: groupConversationId,
      id,
      subject
    })
  );
  const links = [
    inboxV2ScenarioClientLink({
      tenantId,
      conversationId: groupConversationId,
      clientId: "client:group-1",
      id: "conversation_client_link:group-1",
      actorEmployeeId: operatorId,
      roleId: "core:subject"
    }),
    inboxV2ScenarioClientLink({
      tenantId,
      conversationId: groupConversationId,
      clientId: "client:group-2",
      id: "conversation_client_link:group-2",
      actorEmployeeId: operatorId
    })
  ];
  const message = inboxV2ScenarioMessage({
    tenantId,
    conversationId: groupConversationId,
    id: "message:group-physical-1",
    authorParticipantId: participants[0]!.id,
    origin: "source_originated",
    sourceOccurrenceId: "source_occurrence:group-physical-1"
  });
  const workItem = inboxV2ScenarioWorkItem({
    tenantId,
    conversationId: groupConversationId,
    id: "work_item:external-group-1",
    queueId,
    responsibleEmployeeId: operatorId,
    revision: "2",
    updatedAt: inboxV2ScenarioLater
  });
  const state: InboxV2ScenarioState = {
    tenantId,
    kind: "external_thread",
    conversationId: groupConversationId,
    clientIds: ["client:group-1", "client:group-2"],
    participantIds: participants.map((participant) => participant.id),
    employeeAnchorIds: [],
    ownerEmployeeIds: [],
    workItemId: workItem.id,
    primaryResponsibleEmployeeId: operatorId,
    groupBindingId,
    senderPrivateIdentityId: null,
    physicalMessageIds: [message.id],
    action: null,
    status: "assigned",
    revision: "1"
  };
  return createInboxV2ScenarioWorld({
    tenantId,
    records: [
      seed(
        inboxV2ScenarioEntity(
          tenantId,
          "core:conversation",
          groupConversationId
        ),
        INBOX_V2_CONVERSATION_SCHEMA_ID,
        INBOX_V2_CONVERSATION_SCHEMA_VERSION,
        inboxV2ConversationSchema,
        conversation
      ),
      seed(
        inboxV2ScenarioEntity(
          tenantId,
          "core:external-thread",
          groupExternalThreadId
        ),
        INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
        INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
        inboxV2ExternalThreadSchema,
        externalThread
      ),
      seed(
        inboxV2ScenarioEntity(
          tenantId,
          "core:source-thread-binding",
          groupBindingId
        ),
        INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID,
        INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
        inboxV2SourceThreadBindingSchema,
        sourceThreadBinding
      ),
      ...sourceIdentities.map((sourceIdentity) =>
        seed(
          inboxV2ScenarioEntity(
            tenantId,
            "core:source-external-identity",
            sourceIdentity.id
          ),
          INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
          INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
          inboxV2SourceExternalIdentitySchema,
          sourceIdentity
        )
      ),
      seed(
        inboxV2ScenarioEntity(
          tenantId,
          "core:conversation-participant-set",
          `conversation_participant_set:${groupConversationId.split(":").at(-1)}`
        ),
        "core:inbox-v2.conversation-participant-set",
        INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
        inboxV2ConversationParticipantSetSchema,
        participants
      ),
      ...links.map((link) =>
        seed(
          inboxV2ScenarioEntity(
            tenantId,
            "core:conversation-client-link",
            link.id
          ),
          INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
          INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
          inboxV2ConversationClientLinkSchema,
          link
        )
      ),
      seed(
        inboxV2ScenarioEntity(tenantId, "core:message", message.id),
        INBOX_V2_MESSAGE_SCHEMA_ID,
        INBOX_V2_MESSAGE_SCHEMA_VERSION,
        inboxV2MessageSchema,
        message
      ),
      seed(
        inboxV2ScenarioEntity(tenantId, "core:work-item", workItem.id),
        INBOX_V2_WORK_ITEM_SCHEMA_ID,
        "v1",
        inboxV2WorkItemSchema,
        workItem,
        "2"
      ),
      seed(
        groupStateEntity(),
        inboxV2ScenarioContractIds.scenarioState,
        "v1",
        inboxV2ScenarioStateSchema,
        state
      )
    ]
  });
}

function claimStep(input: {
  employeeId: string;
  grant: boolean;
  suffix: string;
  currentStateRevision?: string;
}): InboxV2ScenarioStep {
  const workResource = workEntity();
  const queueResource = inboxV2ScenarioEntity(
    tenantId,
    "core:work-queue",
    queueId
  );
  const authorization = createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: input.employeeId,
    requirements: [
      {
        id: "work-claim",
        permissionId: "core:work.claim",
        resource: workResource,
        guard: inboxV2WorkScenarioGuard({
          workItemId,
          operation: "claim",
          actorRelation: "queue_member",
          assignmentState: "unassigned",
          expectedStateRevision: "1",
          currentStateRevision: input.currentStateRevision ?? "1",
          destinationRequirementIds: ["work-claim-queue"],
          destinationResources: [queueResource]
        })
      },
      {
        id: "work-claim-queue",
        permissionId: "core:work.claim",
        resource: workResource,
        guard: inboxV2WorkScenarioGuard({
          workItemId,
          operation: "claim",
          authorizationMode: "destination_authority",
          actorRelation: "none",
          assignmentState: "assigned",
          authorityTargetResource: queueResource,
          authorityState: "eligible",
          eligibleEmployeeId: input.employeeId,
          authorityRevisionChecks: [
            { kind: "relation", expected: "1", actual: "1" }
          ]
        }),
        scopeFacts: [
          inboxV2QueueScenarioScopeFact({
            workItemResource: workResource,
            queueResource,
            queueId
          })
        ],
        visibility: "secondary_hidden"
      }
    ],
    grants: input.grant
      ? [{ id: "claim", permissionId: "core:work.claim" }]
      : []
  });
  return baseStep(
    `claim-${input.suffix}`,
    authorization,
    ({ requireRecord }) => {
      const currentWork = requireRecord(workEntity());
      const currentState = requireRecord(scenarioStateEntity());
      const nextWork = inboxV2ScenarioWorkItem({
        tenantId,
        conversationId,
        id: workItemId,
        queueId,
        responsibleEmployeeId: input.employeeId,
        revision: "2",
        updatedAt: inboxV2ScenarioLater
      });
      const nextState = {
        ...(currentState.value as InboxV2ScenarioState),
        primaryResponsibleEmployeeId: input.employeeId,
        status: "assigned",
        revision: "2"
      };
      return {
        kind: "commit",
        changes: [
          {
            entity: workEntity(),
            expectedRevision: currentWork.revision,
            resultingRevision: "2",
            schemaId: INBOX_V2_WORK_ITEM_SCHEMA_ID,
            schema: inboxV2WorkItemSchema,
            value: nextWork,
            audience: "workforce_metadata"
          },
          {
            entity: scenarioStateEntity(),
            expectedRevision: currentState.revision,
            resultingRevision: "2",
            schemaId: inboxV2ScenarioContractIds.scenarioState,
            schema: inboxV2ScenarioStateSchema,
            value: nextState,
            audience: "workforce_metadata"
          }
        ]
      };
    }
  );
}

function overrideAuthorization(input: { reason: string | null }) {
  return createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: supervisorId,
    requirements: [
      {
        id: "work-override",
        permissionId: "core:work.override",
        resource: workEntity(),
        guard: inboxV2WorkScenarioGuard({
          workItemId,
          operation: "override",
          actorRelation: "scoped_supervisor_override",
          assignmentState: "assigned",
          expectedStateRevision: "2",
          currentStateRevision: "2",
          overrideReason: input.reason
        })
      }
    ]
  });
}

function baseStep(
  id: string,
  authorization: ReturnType<typeof createInboxV2ScenarioAuthorization>,
  transition: InboxV2ScenarioStep["transition"]
): InboxV2ScenarioStep {
  const token = id.replaceAll(/[^A-Za-z0-9]/gu, "-");
  return {
    id,
    commandId: `scenario-command:${token}`,
    requestId: `scenario-request:${token}`,
    clientMutationId: `scenario-mutation:${token}`,
    requestHash: `sha256:${"a".repeat(64)}`,
    committedAt: inboxV2ScenarioLater,
    authorization,
    transition
  };
}

function seed<T>(
  entity: ReturnType<typeof inboxV2ScenarioEntity>,
  schemaId: string,
  schemaVersion: string,
  schema: InboxV2ScenarioSeedRecord<T>["schema"],
  value: T,
  revision = "1"
) {
  return { entity, revision, schemaId, schemaVersion, schema, value };
}

function recordValue<T = unknown>(
  world: ReturnType<typeof createInboxV2ScenarioWorld>,
  entity: ReturnType<typeof inboxV2ScenarioEntity>
): T {
  const record = getInboxV2ScenarioRecord(world, entity);
  if (record === null) throw new Error(`Missing ${entity.entityId}.`);
  return record.value as T;
}

function recordsOfType(
  world: ReturnType<typeof createInboxV2ScenarioWorld>,
  entityTypeId: string
) {
  return world.records.filter(
    (record) => record.entity.entityTypeId === entityTypeId
  );
}

function outcomeDetails(
  result: ReturnType<typeof executeInboxV2ScenarioStep>
): string {
  if (result.outcome === "rejected") {
    return JSON.stringify(result.authorization);
  }
  if (result.outcome === "conflict") return result.errorCode;
  return result.outcome;
}

function conversationEntity() {
  return inboxV2ScenarioEntity(tenantId, "core:conversation", conversationId);
}

function sourceEntity() {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:source-external-identity",
    sourceIdentityId
  );
}

function externalThreadEntity() {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:external-thread",
    externalThreadId
  );
}

function sourceThreadBindingEntity() {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:source-thread-binding",
    bindingId
  );
}

function participantSetEntity() {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:conversation-participant-set",
    "conversation_participant_set:external-direct-1"
  );
}

function messageEntity() {
  return inboxV2ScenarioEntity(tenantId, "core:message", sourceMessageId);
}

function lifecycleMessageEntity() {
  return inboxV2ScenarioEntity(tenantId, "core:message", lifecycleMessageId);
}

function claimReplyMessageEntity() {
  return inboxV2ScenarioEntity(tenantId, "core:message", claimReplyMessageId);
}

function claimReplyDispatchEntity() {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:outbound-dispatch",
    "outbound_dispatch:claim-and-reply-1"
  );
}

function claimReplyRouteEntity() {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:outbound-route",
    claimReplyRouteId
  );
}

function workEntity() {
  return inboxV2ScenarioEntity(tenantId, "core:work-item", workItemId);
}

function scenarioStateEntity() {
  return inboxV2ScenarioEntity(
    tenantId,
    "module:hulee-testing:scenario-state",
    "scenario_state:external-direct-1"
  );
}

function groupStateEntity() {
  return inboxV2ScenarioEntity(
    tenantId,
    "module:hulee-testing:scenario-state",
    "scenario_state:external-group-1"
  );
}
