import { describe, expect, it } from "vitest";

import { inboxV2MessageMutationCommitSchema } from "./message-lifecycle";
import {
  inboxV2MessageProviderLifecycleOperationCreationCommitSchema,
  inboxV2MessageProviderLifecycleOperationSchema,
  inboxV2MessageProviderLifecycleTransitionCommitSchema
} from "./message-provider-lifecycle";
import { inboxV2ProviderSemanticOrderingCommitSchema } from "./provider-semantic-proof";
import {
  calculateInboxV2MessageContentDigest,
  inboxV2TimelineContentHeadOf
} from "./message-content";
import {
  fixtureAdapterContract,
  fixtureBindingReference,
  fixtureContent,
  fixtureEmployeeActor,
  fixtureExternalMessageReference,
  fixtureExternalReference,
  fixtureExternalTargetRoute,
  fixtureMessage,
  fixtureMessageReference,
  fixtureOccurrence,
  fixtureOutboundBindingSnapshot,
  fixtureParticipant,
  fixtureProviderSemanticOrderingCommit,
  fixtureProviderSemanticProof,
  fixtureReference,
  fixtureRouteReference,
  fixtureSourceAccountReference,
  fixtureSourceOccurrenceReference,
  fixtureSourceIdentityReference,
  fixtureT1,
  fixtureT2,
  fixtureT3,
  fixtureT4,
  fixtureTenantId,
  fixtureTimelineItem,
  fixtureTimelineItemReference
} from "./timeline-message-fixtures.type-fixture";

function editedContent() {
  const blocks = [
    {
      blockKey: "body-1",
      kind: "text" as const,
      role: "body" as const,
      text: "Edited",
      language: "en"
    }
  ];
  return fixtureContent({
    state: {
      kind: "available",
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: "2",
    updatedAt: fixtureT3
  });
}

function editMutation() {
  const beforeContent = fixtureContent();
  const afterContent = editedContent();
  const beforeMessage = fixtureMessage("internal", beforeContent);
  const afterMessage = {
    ...beforeMessage,
    content: inboxV2TimelineContentHeadOf(afterContent as never),
    revision: "2",
    updatedAt: fixtureT3
  };
  const beforeTimelineItem = fixtureTimelineItem("internal");
  const afterTimelineItem = {
    ...beforeTimelineItem,
    subject: {
      kind: "message" as const,
      message: fixtureMessageReference,
      messageRevision: "2"
    },
    revision: "2",
    updatedAt: fixtureT3
  };
  const revision = {
    tenantId: fixtureTenantId,
    id: "message_revision:revision-2",
    message: fixtureMessageReference,
    timelineItem: fixtureTimelineItemReference,
    expectedPreviousRevision: "1",
    messageRevision: "2",
    change: {
      kind: "edited" as const,
      beforeContent: beforeMessage.content,
      afterContent: afterMessage.content,
      providerOperation: null
    },
    actionAttribution: {
      actionParticipant: beforeMessage.authorParticipant,
      appActor: fixtureEmployeeActor,
      sourceOccurrence: null,
      automationCausation: null
    },
    occurredAt: fixtureT3,
    recordedAt: fixtureT3,
    recordRevision: "1" as const,
    createdAt: fixtureT3
  };
  const contentTransition = {
    tenantId: fixtureTenantId,
    before: beforeContent,
    transition: {
      kind: "edit" as const,
      expectedRevision: "1",
      resultingRevision: "2",
      event: fixtureReference("event", "event:content-edit-1"),
      occurredAt: fixtureT3
    },
    after: afterContent
  };
  return {
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    contentTransition,
    providerOperation: null,
    providerOperationCreationCommit: null,
    actionParticipantSnapshot: fixtureParticipant("employee"),
    revision,
    afterMessage,
    afterTimelineItem
  };
}

function providerDeleteOperation(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: fixtureTenantId,
    id: "message_provider_lifecycle_operation:delete-1",
    message: fixtureMessageReference,
    action: "delete" as const,
    origin: "provider_observed" as const,
    externalMessageReference: fixtureExternalMessageReference,
    sourceOccurrence: fixtureSourceOccurrenceReference,
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingGeneration: "1",
    outboundRoute: null,
    adapterContract: fixtureAdapterContract,
    capabilityRevision: "1",
    appActor: null,
    actionParticipant: null,
    automationCausation: null,
    outcome: { state: "observed" },
    deleteLocalPolicy: { effect: "not_evaluated" },
    revision: "1",
    occurredAt: fixtureT1,
    recordedAt: fixtureT2,
    createdAt: fixtureT2,
    updatedAt: fixtureT2,
    ...overrides
  };
}

function observedProviderOperationCreationCommit(
  operation: {
    action: "edit" | "delete";
    occurredAt: string;
    recordedAt: string;
    createdAt: string;
    [key: string]: unknown;
  },
  message = fixtureMessage("source"),
  timelineItem = fixtureTimelineItem()
) {
  const occurrence = fixtureOccurrence();
  const initialOperation = {
    ...operation,
    outcome: { state: "observed" as const },
    deleteLocalPolicy:
      operation.action === "delete"
        ? ({ effect: "not_evaluated" as const } as const)
        : null,
    revision: "1",
    updatedAt: operation.createdAt
  };
  const providerSemanticProof = fixtureProviderSemanticProof({
    semanticId: `core:message.lifecycle.${operation.action}.observed`,
    capabilityId: `core:message-${operation.action}`,
    actor: fixtureSourceIdentityReference,
    occurredAt: operation.occurredAt,
    recordedAt: operation.recordedAt
  });
  return {
    tenantId: fixtureTenantId,
    message,
    timelineItem,
    externalMessageReference: fixtureExternalReference(occurrence),
    sourceOccurrence: occurrence,
    outboundRoute: null,
    outboundBindingSnapshot: null,
    actionParticipantSnapshot: null,
    providerSemanticProof,
    semanticOrderingCommit: fixtureProviderSemanticOrderingCommit(
      providerSemanticProof
    ),
    routeConsumption: null,
    operation: initialOperation
  };
}

function providerRouteConsumption(
  route: ReturnType<typeof fixtureExternalTargetRoute>,
  operation: { id: string; recordedAt: string }
) {
  return {
    outboundRoute: fixtureReference("outbound_route", route.id),
    operation: fixtureReference(
      "message_provider_lifecycle_operation",
      operation.id
    ),
    mutationToken: route.mutationToken,
    idempotencyToken: route.idempotencyToken,
    correlationToken: route.correlationToken,
    consumedByTrustedServiceId: route.adapterContract.loadedByTrustedServiceId,
    consumedAt: operation.recordedAt,
    revision: "1" as const
  };
}

describe("Inbox V2 Message lifecycle contracts", () => {
  it("edits content through contiguous Message, content and Timeline CAS", () => {
    const commit = editMutation();
    expect(inboxV2MessageMutationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...commit,
        afterMessage: {
          ...commit.afterMessage,
          authorParticipant: fixtureReference(
            "conversation_participant",
            "conversation_participant:employee-2"
          )
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...commit,
        afterTimelineItem: {
          ...commit.afterTimelineItem,
          timelineSequence: "2"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...commit,
        revision: { ...commit.revision, messageRevision: "3" }
      }).success
    ).toBe(false);
  });

  it("requires an exact provider operation for external edits", () => {
    const internal = editMutation();
    const beforeMessage = fixtureMessage(
      "source",
      internal.contentTransition.before
    );
    const afterMessage = {
      ...beforeMessage,
      content: internal.afterMessage.content,
      revision: "2",
      updatedAt: fixtureT3
    };
    const beforeTimelineItem = fixtureTimelineItem();
    const afterTimelineItem = {
      ...beforeTimelineItem,
      subject: {
        kind: "message" as const,
        message: fixtureMessageReference,
        messageRevision: "2"
      },
      revision: "2",
      updatedAt: fixtureT3
    };
    const providerOperation = {
      ...providerDeleteOperation({
        id: "message_provider_lifecycle_operation:edit-1"
      }),
      action: "edit" as const,
      deleteLocalPolicy: null
    };
    const revision = {
      ...internal.revision,
      change: {
        ...internal.revision.change,
        providerOperation: fixtureReference(
          "message_provider_lifecycle_operation",
          providerOperation.id
        )
      },
      actionAttribution: {
        actionParticipant: beforeMessage.authorParticipant,
        appActor: null,
        sourceOccurrence: fixtureSourceOccurrenceReference,
        automationCausation: null
      },
      occurredAt: fixtureT1
    };
    const commit = {
      ...internal,
      beforeMessage,
      beforeTimelineItem,
      providerOperation,
      providerOperationCreationCommit: observedProviderOperationCreationCommit(
        providerOperation,
        beforeMessage,
        beforeTimelineItem
      ),
      actionParticipantSnapshot: fixtureParticipant("source"),
      revision,
      afterMessage,
      afterTimelineItem
    };
    expect(inboxV2MessageMutationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...commit,
        providerOperation: null
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...commit,
        actionParticipantSnapshot: fixtureParticipant("employee")
      }).success
    ).toBe(false);
  });

  it("binds requested provider mutation attribution to the exact participant and automation cause", () => {
    const beforeContent = fixtureContent();
    const afterContent = editedContent();
    const beforeMessage = fixtureMessage("hulee", beforeContent);
    const afterMessage = {
      ...beforeMessage,
      content: inboxV2TimelineContentHeadOf(afterContent as never),
      revision: "2",
      updatedAt: fixtureT3
    };
    const beforeTimelineItem = fixtureTimelineItem("external");
    const afterTimelineItem = {
      ...beforeTimelineItem,
      subject: {
        kind: "message" as const,
        message: fixtureMessageReference,
        messageRevision: "2"
      },
      revision: "2",
      updatedAt: fixtureT3
    };
    const contentTransition = {
      tenantId: fixtureTenantId,
      before: beforeContent,
      transition: {
        kind: "edit" as const,
        expectedRevision: "1",
        resultingRevision: "2",
        event: fixtureReference("event", "event:requested-edit-1"),
        occurredAt: fixtureT3
      },
      after: afterContent
    };
    const route = fixtureExternalTargetRoute(
      "core:message.edit",
      "core:conversation.read"
    );
    const operation = {
      ...providerDeleteOperation({
        id: "message_provider_lifecycle_operation:requested-edit-1",
        origin: "hulee_requested",
        outboundRoute: fixtureRouteReference,
        appActor: fixtureEmployeeActor,
        actionParticipant: fixtureReference(
          "conversation_participant",
          "conversation_participant:employee-1"
        ),
        capabilityRevision: route.bindingFence.capabilityRevision,
        outcome: { state: "pending" }
      }),
      action: "edit" as const,
      deleteLocalPolicy: null
    };
    const revision = {
      tenantId: fixtureTenantId,
      id: "message_revision:requested-edit-2",
      message: fixtureMessageReference,
      timelineItem: fixtureTimelineItemReference,
      expectedPreviousRevision: "1",
      messageRevision: "2",
      change: {
        kind: "edited" as const,
        beforeContent: beforeMessage.content,
        afterContent: afterMessage.content,
        providerOperation: fixtureReference(
          "message_provider_lifecycle_operation",
          operation.id
        )
      },
      actionAttribution: {
        actionParticipant: operation.actionParticipant,
        appActor: fixtureEmployeeActor,
        sourceOccurrence: null,
        automationCausation: null
      },
      occurredAt: fixtureT3,
      recordedAt: fixtureT3,
      recordRevision: "1" as const,
      createdAt: fixtureT3
    };
    const operationCreationCommit = {
      tenantId: fixtureTenantId,
      message: beforeMessage,
      timelineItem: beforeTimelineItem,
      externalMessageReference: fixtureExternalReference(fixtureOccurrence()),
      sourceOccurrence: fixtureOccurrence(),
      outboundRoute: route,
      outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
        route,
        "core:message-edit"
      ),
      actionParticipantSnapshot: fixtureParticipant("employee"),
      providerSemanticProof: null,
      semanticOrderingCommit: null,
      routeConsumption: providerRouteConsumption(route, operation),
      operation
    };
    const commit = {
      tenantId: fixtureTenantId,
      beforeMessage,
      beforeTimelineItem,
      contentTransition,
      providerOperation: operation,
      providerOperationCreationCommit: operationCreationCommit,
      actionParticipantSnapshot: fixtureParticipant("employee"),
      revision,
      afterMessage,
      afterTimelineItem
    };

    expect(inboxV2MessageMutationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    const participantB = fixtureReference(
      "conversation_participant",
      "conversation_participant:employee-2"
    );
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...commit,
        actionParticipantSnapshot: fixtureParticipant("employee", {
          id: participantB.id
        }),
        revision: {
          ...revision,
          actionAttribution: {
            ...revision.actionAttribution,
            actionParticipant: participantB
          }
        }
      }).success
    ).toBe(false);

    const trustedActor = {
      kind: "trusted_service" as const,
      trustedServiceId: "core:message-automation"
    };
    const causeA = {
      kind: "system_event" as const,
      causeEvent: fixtureReference("event", "event:automation-cause-a"),
      correlationId: "correlation:automation-cause-a",
      causedAt: fixtureT1
    };
    const trustedRoute = {
      ...route,
      principal: trustedActor,
      conversationAuthorization: {
        ...route.conversationAuthorization,
        principal: trustedActor
      },
      sourceAccountAuthorization: {
        ...route.sourceAccountAuthorization,
        principal: trustedActor
      }
    };
    const trustedOperation = {
      ...operation,
      id: "message_provider_lifecycle_operation:trusted-edit-1",
      appActor: trustedActor,
      actionParticipant: null,
      automationCausation: causeA
    };
    const trustedRevision = {
      ...revision,
      change: {
        ...revision.change,
        providerOperation: fixtureReference(
          "message_provider_lifecycle_operation",
          trustedOperation.id
        )
      },
      actionAttribution: {
        actionParticipant: null,
        appActor: trustedActor,
        sourceOccurrence: null,
        automationCausation: causeA
      }
    };
    const trustedCommit = {
      ...commit,
      providerOperation: trustedOperation,
      providerOperationCreationCommit: {
        ...operationCreationCommit,
        outboundRoute: trustedRoute,
        outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
          trustedRoute,
          "core:message-edit"
        ),
        actionParticipantSnapshot: null,
        routeConsumption: providerRouteConsumption(
          trustedRoute,
          trustedOperation
        ),
        operation: trustedOperation
      },
      actionParticipantSnapshot: null,
      revision: trustedRevision
    };
    const trustedParsed =
      inboxV2MessageMutationCommitSchema.safeParse(trustedCommit);
    expect(trustedParsed.success ? [] : trustedParsed.error.issues).toEqual([]);
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...trustedCommit,
        revision: {
          ...trustedRevision,
          actionAttribution: {
            ...trustedRevision.actionAttribution,
            automationCausation: {
              ...causeA,
              causeEvent: fixtureReference("event", "event:automation-cause-b")
            }
          }
        }
      }).success
    ).toBe(false);
  });

  it("materializes an attachment locally without pretending to edit the provider Message", () => {
    const attachment = fixtureReference(
      "message_attachment",
      "message_attachment:image-1"
    );
    const beforeBlocks = [
      {
        blockKey: "image-1",
        kind: "image" as const,
        attachment: { state: "pending" as const, attachment },
        displayName: "photo.png"
      }
    ];
    const afterBlocks = [
      {
        blockKey: "image-1",
        kind: "image" as const,
        attachment: {
          state: "ready" as const,
          attachment,
          file: fixtureReference("file", "file:image-1"),
          fileRevision: "1",
          fileVersion: fixtureReference(
            "file_version",
            "file_version:image-1-v1"
          ),
          objectVersion: fixtureReference(
            "file_object_version",
            "file_object_version:image-1-v1"
          )
        },
        displayName: "photo.png"
      }
    ];
    const beforeContent = fixtureContent({
      state: {
        kind: "available",
        blocks: beforeBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(beforeBlocks)
      }
    });
    const afterContent = fixtureContent({
      state: {
        kind: "available",
        blocks: afterBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(afterBlocks)
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    const beforeMessage = fixtureMessage("source", beforeContent);
    const beforeTimelineItem = fixtureTimelineItem();
    const afterMessage = {
      ...beforeMessage,
      content: inboxV2TimelineContentHeadOf(afterContent as never),
      revision: "2",
      updatedAt: fixtureT3
    };
    const afterTimelineItem = {
      ...beforeTimelineItem,
      subject: {
        kind: "message" as const,
        message: fixtureMessageReference,
        messageRevision: "2"
      },
      revision: "2",
      updatedAt: fixtureT3
    };
    const commit = {
      tenantId: fixtureTenantId,
      beforeMessage,
      beforeTimelineItem,
      contentTransition: {
        tenantId: fixtureTenantId,
        before: beforeContent,
        transition: {
          kind: "attachment_materialization" as const,
          expectedRevision: "1",
          resultingRevision: "2",
          event: fixtureReference("event", "event:attachment-ready-1"),
          occurredAt: fixtureT3
        },
        after: afterContent
      },
      providerOperation: null,
      providerOperationCreationCommit: null,
      actionParticipantSnapshot: null,
      revision: {
        tenantId: fixtureTenantId,
        id: "message_revision:attachment-ready-2",
        message: fixtureMessageReference,
        timelineItem: fixtureTimelineItemReference,
        expectedPreviousRevision: "1",
        messageRevision: "2",
        change: {
          kind: "attachment_materialized" as const,
          beforeContent: beforeMessage.content,
          afterContent: afterMessage.content
        },
        actionAttribution: {
          actionParticipant: null,
          appActor: {
            kind: "trusted_service" as const,
            trustedServiceId: "core:attachment-materializer"
          },
          sourceOccurrence: null,
          automationCausation: {
            kind: "system_event" as const,
            causeEvent: fixtureReference("event", "event:attachment-upload-1"),
            correlationId: "correlation:attachment-1",
            causedAt: fixtureT2
          }
        },
        occurredAt: fixtureT3,
        recordedAt: fixtureT3,
        recordRevision: "1" as const,
        createdAt: fixtureT3
      },
      afterMessage,
      afterTimelineItem
    };

    expect(inboxV2MessageMutationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...commit,
        revision: {
          ...commit.revision,
          change: { ...commit.revision.change, kind: "edited" }
        }
      }).success
    ).toBe(false);
  });

  it("keeps local delete separate from content purge", () => {
    const edit = editMutation();
    const beforeMessage = edit.beforeMessage;
    const beforeTimelineItem = edit.beforeTimelineItem;
    const revisionId = "message_revision:delete-2";
    const afterMessage = {
      ...beforeMessage,
      lifecycle: {
        kind: "local_delete_tombstone" as const,
        revision: fixtureReference("message_revision", revisionId),
        reasonId: "core:employee-delete",
        deletedAt: fixtureT3
      },
      revision: "2",
      updatedAt: fixtureT3
    };
    const afterTimelineItem = {
      ...beforeTimelineItem,
      subject: {
        kind: "message" as const,
        message: fixtureMessageReference,
        messageRevision: "2"
      },
      revision: "2",
      updatedAt: fixtureT3
    };
    const commit = {
      tenantId: fixtureTenantId,
      beforeMessage,
      beforeTimelineItem,
      contentTransition: null,
      providerOperation: null,
      providerOperationCreationCommit: null,
      actionParticipantSnapshot: fixtureParticipant("employee"),
      revision: {
        tenantId: fixtureTenantId,
        id: revisionId,
        message: fixtureMessageReference,
        timelineItem: fixtureTimelineItemReference,
        expectedPreviousRevision: "1",
        messageRevision: "2",
        change: {
          kind: "local_delete_tombstone",
          reasonId: "core:employee-delete"
        },
        actionAttribution: {
          actionParticipant: beforeMessage.authorParticipant,
          appActor: fixtureEmployeeActor,
          sourceOccurrence: null,
          automationCausation: null
        },
        occurredAt: fixtureT3,
        recordedAt: fixtureT3,
        recordRevision: "1",
        createdAt: fixtureT3
      },
      afterMessage,
      afterTimelineItem
    };
    expect(inboxV2MessageMutationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(afterMessage.content.stateKind).toBe("available");
  });

  it("records provider delete before an independent local-policy decision", () => {
    const observed = providerDeleteOperation();
    expect(
      inboxV2MessageProviderLifecycleOperationSchema.safeParse(observed).success
    ).toBe(true);
    expect(
      inboxV2MessageProviderLifecycleOperationSchema.safeParse({
        ...observed,
        outboundRoute: fixtureRouteReference
      }).success
    ).toBe(false);

    const after = providerDeleteOperation({
      outcome: { state: "observed" },
      deleteLocalPolicy: {
        effect: "tombstone_local",
        decisionEvent: fixtureReference("event", "event:delete-policy-1"),
        decisionRevision: "1",
        decidedAt: fixtureT3
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    expect(
      inboxV2MessageProviderLifecycleTransitionCommitSchema.safeParse({
        tenantId: fixtureTenantId,
        before: observed,
        transition: {
          operation: fixtureReference(
            "message_provider_lifecycle_operation",
            observed.id
          ),
          expectedRevision: "1",
          resultingRevision: "2",
          outcome: after.outcome,
          deleteLocalPolicy: after.deleteLocalPolicy,
          resultProof: null,
          recordedAt: fixtureT3
        },
        after
      }).success
    ).toBe(true);
    expect(
      inboxV2MessageProviderLifecycleTransitionCommitSchema.safeParse({
        tenantId: fixtureTenantId,
        before: observed,
        transition: {
          operation: fixtureReference(
            "message_provider_lifecycle_operation",
            observed.id
          ),
          expectedRevision: "1",
          resultingRevision: "2",
          outcome: { state: "confirmed" },
          deleteLocalPolicy: after.deleteLocalPolicy,
          resultProof: null,
          recordedAt: fixtureT3
        },
        after: { ...after, outcome: { state: "confirmed" } }
      }).success
    ).toBe(false);

    const flippedPolicy = {
      effect: "retain_local" as const,
      decisionEvent: fixtureReference("event", "event:delete-policy-flip"),
      decisionRevision: "2",
      decidedAt: fixtureT4
    };
    expect(
      inboxV2MessageProviderLifecycleTransitionCommitSchema.safeParse({
        tenantId: fixtureTenantId,
        before: after,
        transition: {
          operation: fixtureReference(
            "message_provider_lifecycle_operation",
            observed.id
          ),
          expectedRevision: "2",
          resultingRevision: "3",
          outcome: after.outcome,
          deleteLocalPolicy: flippedPolicy,
          resultProof: null,
          recordedAt: fixtureT4
        },
        after: {
          ...after,
          deleteLocalPolicy: flippedPolicy,
          revision: "3",
          updatedAt: fixtureT4
        }
      }).success
    ).toBe(false);
  });

  it("induces provider lifecycle authority from one exact Message transport", () => {
    const occurrence = fixtureOccurrence();
    const observed = providerDeleteOperation();
    const providerSemanticProof = fixtureProviderSemanticProof({
      semanticId: "core:message.lifecycle.delete.observed",
      capabilityId: "core:message-delete",
      actor: fixtureSourceIdentityReference,
      occurredAt: observed.occurredAt,
      recordedAt: observed.recordedAt
    });
    const observedCommit = {
      tenantId: fixtureTenantId,
      message: fixtureMessage("source"),
      timelineItem: fixtureTimelineItem(),
      externalMessageReference: fixtureExternalReference(occurrence),
      sourceOccurrence: occurrence,
      outboundRoute: null,
      outboundBindingSnapshot: null,
      actionParticipantSnapshot: null,
      providerSemanticProof,
      semanticOrderingCommit: fixtureProviderSemanticOrderingCommit(
        providerSemanticProof
      ),
      routeConsumption: null,
      operation: observed
    };
    expect(
      inboxV2MessageProviderLifecycleOperationCreationCommitSchema.safeParse(
        observedCommit
      ).success
    ).toBe(true);
    expect(
      inboxV2MessageProviderLifecycleOperationCreationCommitSchema.safeParse({
        ...observedCommit,
        operation: {
          ...observed,
          sourceAccount: fixtureReference(
            "source_account",
            "source_account:same-tenant-but-unrelated"
          )
        }
      }).success
    ).toBe(false);

    const route = fixtureExternalTargetRoute(
      "core:message.delete",
      "core:conversation.read"
    );
    const requested = providerDeleteOperation({
      origin: "hulee_requested",
      outboundRoute: fixtureRouteReference,
      appActor: fixtureEmployeeActor,
      actionParticipant: fixtureReference(
        "conversation_participant",
        "conversation_participant:employee-1"
      ),
      capabilityRevision: route.bindingFence.capabilityRevision,
      outcome: { state: "pending" }
    });
    const requestedCommit = {
      ...observedCommit,
      message: fixtureMessage("hulee"),
      outboundRoute: route,
      outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
        route,
        "core:message-delete"
      ),
      actionParticipantSnapshot: fixtureParticipant("employee"),
      providerSemanticProof: null,
      semanticOrderingCommit: null,
      routeConsumption: providerRouteConsumption(route, requested),
      operation: requested
    };
    expect(
      inboxV2MessageProviderLifecycleOperationCreationCommitSchema.safeParse(
        requestedCommit
      ).success
    ).toBe(true);
    const actionPermissionRoute = fixtureExternalTargetRoute(
      "core:message.delete",
      "core:message.moderate_external"
    );
    expect(
      inboxV2MessageProviderLifecycleOperationCreationCommitSchema.safeParse({
        ...requestedCommit,
        outboundRoute: actionPermissionRoute,
        outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
          actionPermissionRoute,
          "core:message-delete"
        ),
        routeConsumption: providerRouteConsumption(
          actionPermissionRoute,
          requested
        )
      }).success
    ).toBe(false);
    const unrelatedPermissionRoute = fixtureExternalTargetRoute(
      "core:message.delete",
      "core:message.reply_external"
    );
    expect(
      inboxV2MessageProviderLifecycleOperationCreationCommitSchema.safeParse({
        ...requestedCommit,
        outboundRoute: unrelatedPermissionRoute,
        outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
          unrelatedPermissionRoute,
          "core:message-delete"
        ),
        routeConsumption: providerRouteConsumption(
          unrelatedPermissionRoute,
          requested
        )
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageProviderLifecycleOperationCreationCommitSchema.safeParse({
        ...requestedCommit,
        outboundRoute: {
          ...route,
          selection: {
            ...route.selection,
            intent: {
              kind: "explicit_occurrence",
              occurrence: fixtureReference(
                "source_occurrence",
                "source_occurrence:unrelated"
              )
            }
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageProviderLifecycleOperationCreationCommitSchema.safeParse({
        ...observedCommit,
        message: fixtureMessage("hulee"),
        outboundRoute: {
          ...route,
          sourceThreadBinding: fixtureReference(
            "source_thread_binding",
            "source_thread_binding:unrelated"
          )
        },
        outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
          route,
          "core:message-delete"
        ),
        actionParticipantSnapshot: fixtureParticipant("employee"),
        providerSemanticProof: null,
        semanticOrderingCommit: null,
        routeConsumption: providerRouteConsumption(route, requested),
        operation: requested
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageProviderLifecycleOperationCreationCommitSchema.safeParse({
        ...observedCommit,
        message: fixtureMessage("hulee"),
        outboundRoute: fixtureExternalTargetRoute(
          "core:message.edit",
          "core:conversation.read"
        ),
        outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
          fixtureExternalTargetRoute(
            "core:message.edit",
            "core:conversation.read"
          ),
          "core:message-delete"
        ),
        actionParticipantSnapshot: fixtureParticipant("employee"),
        providerSemanticProof: null,
        semanticOrderingCommit: null,
        routeConsumption: providerRouteConsumption(
          fixtureExternalTargetRoute(
            "core:message.edit",
            "core:conversation.read"
          ),
          requested
        ),
        operation: requested
      }).success
    ).toBe(false);
  });

  it("advances provider semantic order across account observations only on the exact comparator scale", () => {
    const firstProof = fixtureProviderSemanticProof({
      semanticId: "core:message.lifecycle.edit.observed",
      capabilityId: "core:message-edit",
      orderingPosition: "1",
      occurredAt: fixtureT1,
      recordedAt: fixtureT2
    });
    const first = fixtureProviderSemanticOrderingCommit(firstProof);
    const nextProof = fixtureProviderSemanticProof({
      semanticId: "core:message.lifecycle.edit.observed",
      capabilityId: "core:message-edit",
      orderingPosition: "2",
      normalizedInboundEvent: fixtureReference(
        "normalized_inbound_event",
        "normalized_inbound_event:webhook-2"
      ),
      occurredAt: fixtureT2,
      recordedAt: fixtureT3
    });
    const crossAccountProof = {
      ...nextProof,
      sourceAccount: fixtureReference(
        "source_account",
        "source_account:account-2"
      ),
      sourceThreadBinding: fixtureReference(
        "source_thread_binding",
        "source_thread_binding:binding-2"
      ),
      bindingGeneration: "2"
    };
    const nextBase = fixtureProviderSemanticOrderingCommit(crossAccountProof);
    const advance = {
      ...nextBase,
      before: first.after,
      after: { ...nextBase.after, revision: "2" }
    };

    expect(
      inboxV2ProviderSemanticOrderingCommitSchema.safeParse(advance).success
    ).toBe(true);

    const incompatibleProof = {
      ...crossAccountProof,
      ordering: {
        ...crossAccountProof.ordering,
        comparatorId: "module:synthetic:legacy-sequence"
      }
    };
    expect(
      inboxV2ProviderSemanticOrderingCommitSchema.safeParse({
        ...advance,
        proof: incompatibleProof,
        after: {
          ...advance.after,
          comparatorId: incompatibleProof.ordering.comparatorId
        }
      }).success
    ).toBe(false);
  });

  it("requires a trusted adapter result for every requested provider outcome", () => {
    const route = fixtureExternalTargetRoute(
      "core:message.delete",
      "core:conversation.read"
    );
    const before = providerDeleteOperation({
      origin: "hulee_requested",
      outboundRoute: fixtureRouteReference,
      appActor: fixtureEmployeeActor,
      actionParticipant: fixtureReference(
        "conversation_participant",
        "conversation_participant:employee-1"
      ),
      capabilityRevision: route.bindingFence.capabilityRevision,
      outcome: { state: "pending" }
    });
    const after = providerDeleteOperation({
      ...before,
      outcome: { state: "accepted" },
      revision: "2",
      updatedAt: fixtureT3
    });
    const resultProof = {
      tenantId: fixtureTenantId,
      operation: fixtureReference(
        "message_provider_lifecycle_operation",
        before.id
      ),
      outboundRoute: fixtureRouteReference,
      adapterContract: fixtureAdapterContract,
      capabilityId: "core:message-delete",
      capabilityRevision: route.bindingFence.capabilityRevision,
      semanticId: "core:message.lifecycle.delete.result.accepted",
      semanticRevision: "1",
      resultState: "accepted" as const,
      declaredByTrustedServiceId: "core:source-runtime",
      resultToken: "result:delete-accepted-1",
      resultDigestSha256: "d".repeat(64),
      recordedAt: fixtureT3,
      revision: "1" as const
    };
    const commit = {
      tenantId: fixtureTenantId,
      before,
      transition: {
        operation: resultProof.operation,
        expectedRevision: "1",
        resultingRevision: "2",
        outcome: after.outcome,
        deleteLocalPolicy: after.deleteLocalPolicy,
        resultProof,
        recordedAt: fixtureT3
      },
      after
    };

    expect(
      inboxV2MessageProviderLifecycleTransitionCommitSchema.safeParse(commit)
        .success
    ).toBe(true);
    expect(
      inboxV2MessageProviderLifecycleTransitionCommitSchema.safeParse({
        ...commit,
        transition: { ...commit.transition, resultProof: null }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageProviderLifecycleTransitionCommitSchema.safeParse({
        ...commit,
        transition: {
          ...commit.transition,
          resultProof: { ...resultProof, resultState: "confirmed" }
        }
      }).success
    ).toBe(false);
  });

  it("applies provider-delete tombstone without pretending privacy erasure", () => {
    const beforeMessage = fixtureMessage("source");
    const beforeTimelineItem = fixtureTimelineItem();
    const operation = providerDeleteOperation({
      outcome: { state: "observed" },
      deleteLocalPolicy: {
        effect: "tombstone_local",
        decisionEvent: fixtureReference("event", "event:delete-policy-1"),
        decisionRevision: "1",
        decidedAt: fixtureT3
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    const revisionId = "message_revision:provider-delete-2";
    const afterMessage = {
      ...beforeMessage,
      lifecycle: {
        kind: "provider_delete_tombstone" as const,
        revision: fixtureReference("message_revision", revisionId),
        providerOperation: fixtureReference(
          "message_provider_lifecycle_operation",
          operation.id
        ),
        policyReasonId: "core:provider-delete-policy",
        appliedAt: fixtureT3
      },
      revision: "2",
      updatedAt: fixtureT3
    };
    const afterTimelineItem = {
      ...beforeTimelineItem,
      subject: {
        kind: "message" as const,
        message: fixtureMessageReference,
        messageRevision: "2"
      },
      revision: "2",
      updatedAt: fixtureT3
    };
    const commit = {
      tenantId: fixtureTenantId,
      beforeMessage,
      beforeTimelineItem,
      contentTransition: null,
      providerOperation: operation,
      providerOperationCreationCommit: observedProviderOperationCreationCommit(
        operation,
        beforeMessage,
        beforeTimelineItem
      ),
      actionParticipantSnapshot: fixtureParticipant("source"),
      revision: {
        tenantId: fixtureTenantId,
        id: revisionId,
        message: fixtureMessageReference,
        timelineItem: fixtureTimelineItemReference,
        expectedPreviousRevision: "1",
        messageRevision: "2",
        change: {
          kind: "provider_delete_policy_tombstone",
          providerOperation: fixtureReference(
            "message_provider_lifecycle_operation",
            operation.id
          ),
          policyReasonId: "core:provider-delete-policy"
        },
        actionAttribution: {
          actionParticipant: beforeMessage.authorParticipant,
          appActor: null,
          sourceOccurrence: fixtureSourceOccurrenceReference,
          automationCausation: null
        },
        occurredAt: fixtureT1,
        recordedAt: fixtureT3,
        recordRevision: "1",
        createdAt: fixtureT3
      },
      afterMessage,
      afterTimelineItem
    };
    expect(inboxV2MessageMutationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(afterMessage.content.stateKind).toBe("available");

    const requestedBeforeMessage = fixtureMessage("hulee");
    const requestedBeforeTimelineItem = fixtureTimelineItem("external");
    const requestedRoute = fixtureExternalTargetRoute(
      "core:message.delete",
      "core:conversation.read"
    );
    const requestedOccurrence = fixtureOccurrence();
    const requestedInitialOperation = providerDeleteOperation({
      id: "message_provider_lifecycle_operation:requested-delete-1",
      origin: "hulee_requested",
      outboundRoute: fixtureRouteReference,
      appActor: fixtureEmployeeActor,
      actionParticipant: fixtureReference(
        "conversation_participant",
        "conversation_participant:employee-1"
      ),
      capabilityRevision: requestedRoute.bindingFence.capabilityRevision,
      outcome: { state: "pending" }
    });
    const requestedOperation = {
      ...requestedInitialOperation,
      outcome: { state: "confirmed" as const },
      deleteLocalPolicy: {
        effect: "tombstone_local" as const,
        decisionEvent: fixtureReference(
          "event",
          "event:requested-delete-policy-1"
        ),
        decisionRevision: "1",
        decidedAt: fixtureT3
      },
      revision: "3",
      updatedAt: fixtureT3
    };
    const requestedRevisionId = "message_revision:requested-delete-2";
    const requestedAfterMessage = {
      ...requestedBeforeMessage,
      lifecycle: {
        kind: "provider_delete_tombstone" as const,
        revision: fixtureReference("message_revision", requestedRevisionId),
        providerOperation: fixtureReference(
          "message_provider_lifecycle_operation",
          requestedOperation.id
        ),
        policyReasonId: "core:provider-delete-policy",
        appliedAt: fixtureT3
      },
      revision: "2",
      updatedAt: fixtureT3
    };
    const requestedAfterTimelineItem = {
      ...requestedBeforeTimelineItem,
      subject: {
        kind: "message" as const,
        message: fixtureMessageReference,
        messageRevision: "2"
      },
      revision: "2",
      updatedAt: fixtureT3
    };
    const requestedRevision = {
      tenantId: fixtureTenantId,
      id: requestedRevisionId,
      message: fixtureMessageReference,
      timelineItem: fixtureTimelineItemReference,
      expectedPreviousRevision: "1",
      messageRevision: "2",
      change: {
        kind: "provider_delete_policy_tombstone" as const,
        providerOperation: fixtureReference(
          "message_provider_lifecycle_operation",
          requestedOperation.id
        ),
        policyReasonId: "core:provider-delete-policy"
      },
      actionAttribution: {
        actionParticipant: requestedInitialOperation.actionParticipant,
        appActor: fixtureEmployeeActor,
        sourceOccurrence: null,
        automationCausation: null
      },
      occurredAt: fixtureT3,
      recordedAt: fixtureT3,
      recordRevision: "1" as const,
      createdAt: fixtureT3
    };
    const requestedCommit = {
      tenantId: fixtureTenantId,
      beforeMessage: requestedBeforeMessage,
      beforeTimelineItem: requestedBeforeTimelineItem,
      contentTransition: null,
      providerOperation: requestedOperation,
      providerOperationCreationCommit: {
        tenantId: fixtureTenantId,
        message: requestedBeforeMessage,
        timelineItem: requestedBeforeTimelineItem,
        externalMessageReference: fixtureExternalReference(requestedOccurrence),
        sourceOccurrence: requestedOccurrence,
        outboundRoute: requestedRoute,
        outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
          requestedRoute,
          "core:message-delete"
        ),
        actionParticipantSnapshot: fixtureParticipant("employee"),
        providerSemanticProof: null,
        semanticOrderingCommit: null,
        routeConsumption: providerRouteConsumption(
          requestedRoute,
          requestedInitialOperation
        ),
        operation: requestedInitialOperation
      },
      actionParticipantSnapshot: fixtureParticipant("employee"),
      revision: requestedRevision,
      afterMessage: requestedAfterMessage,
      afterTimelineItem: requestedAfterTimelineItem
    };
    expect(
      inboxV2MessageMutationCommitSchema.safeParse(requestedCommit).success
    ).toBe(true);

    const participantB = fixtureReference(
      "conversation_participant",
      "conversation_participant:employee-2"
    );
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...requestedCommit,
        actionParticipantSnapshot: fixtureParticipant("employee", {
          id: participantB.id
        }),
        revision: {
          ...requestedRevision,
          actionAttribution: {
            ...requestedRevision.actionAttribution,
            actionParticipant: participantB
          }
        }
      }).success
    ).toBe(false);

    const futureDecisionAt = "2026-07-11T08:30:00.000-01:00";
    expect(
      inboxV2MessageMutationCommitSchema.safeParse({
        ...requestedCommit,
        providerOperation: {
          ...requestedOperation,
          deleteLocalPolicy: {
            ...requestedOperation.deleteLocalPolicy,
            decidedAt: futureDecisionAt
          },
          revision: "4",
          updatedAt: futureDecisionAt
        }
      }).success
    ).toBe(false);
  });
});
