import { describe, expect, it } from "vitest";

import {
  INBOX_V2_MESSAGE_SCHEMA_ID,
  inboxV2MessageEnvelopeSchema,
  inboxV2MessageReferenceContextSchema,
  inboxV2MessageSchema
} from "./message";
import {
  calculateInboxV2MessageContentDigest,
  inboxV2TimelineContentHeadOf
} from "./message-content";
import {
  inboxV2StaffNoteCreationCommitSchema,
  inboxV2StaffNoteReadIntentSchema,
  inboxV2StaffNoteSchema
} from "./staff-note";
import { inboxV2TimelineCommandIntentSchema } from "./timeline-command-intents";
import { inboxV2MessageCreationCommitSchema } from "./timeline-message-commit";
import {
  fixtureAdapterContract,
  fixtureContent,
  fixtureEmployeeActor,
  fixtureEmployeeReference,
  fixtureExternalMessageReference,
  fixtureExternalReference,
  fixtureExternalTargetRoute,
  fixtureHuleeCreationCommit,
  fixtureInternalCreationCommit,
  fixtureMessage,
  fixtureMessageReference,
  fixtureOccurrence,
  fixtureOccurrenceResolutionCommit,
  fixtureOutboundBindingSnapshot,
  fixtureParticipant,
  fixtureProviderSemanticOrderingCommit,
  fixtureProviderSemanticProof,
  fixtureReference,
  fixtureRouteReference,
  fixtureSourceCreationCommit,
  fixtureSourceIdentityClaim,
  fixtureSourceIdentityReference,
  fixtureSourceOccurrenceReference,
  fixtureT0,
  fixtureT1,
  fixtureT2,
  fixtureTenantId,
  fixtureTimelineAllocation,
  fixtureTimelineItem,
  fixtureTimelineItemReference,
  fixtureTransportLink
} from "./timeline-message-fixtures.type-fixture";

function providerReferenceSemanticEvidence(
  commit: ReturnType<typeof fixtureSourceCreationCommit>,
  kind: "reply" | "forward",
  target:
    | {
        kind: "resolved_external";
        externalMessageReference: ReturnType<typeof fixtureReference>;
        sourceOccurrence: ReturnType<typeof fixtureReference>;
      }
    | {
        kind: "unresolved_source";
        sourceOccurrence: ReturnType<typeof fixtureReference>;
      }
    | {
        kind: "event_classification";
        sourceOccurrence: ReturnType<typeof fixtureReference>;
        provenanceCompleteness: "exact" | "partial" | "opaque";
      }
) {
  const occurrence = commit.sourceOccurrence;
  if (occurrence.origin.kind === "provider_response") {
    throw new Error("provider reference fixture requires an inbound event");
  }
  const exactProofTarget =
    target.kind === "resolved_external"
      ? target
      : {
          externalMessageReference: fixtureReference(
            "external_message_reference",
            commit.externalMessageReference.id
          ),
          sourceOccurrence: fixtureReference("source_occurrence", occurrence.id)
        };
  const proof = fixtureProviderSemanticProof({
    semanticId:
      target.kind === "event_classification"
        ? `core:message.reference.${kind}.observed.${target.provenanceCompleteness}`
        : `core:message.reference.${kind}.observed`,
    capabilityId: `core:message-${kind}-reference-observed`,
    normalizedInboundEvent: occurrence.origin.normalizedInboundEvent,
    externalMessageReference: exactProofTarget.externalMessageReference,
    sourceOccurrence: exactProofTarget.sourceOccurrence,
    actor: fixtureSourceIdentityReference,
    occurredAt: occurrence.observedAt,
    recordedAt: occurrence.recordedAt
  });
  return {
    target,
    providerSemanticProof: proof,
    semanticOrderingCommit: fixtureProviderSemanticOrderingCommit(
      proof,
      target.kind === "event_classification"
        ? `core:message.reference.${kind}.classification`
        : `core:message.reference.${kind}`,
      occurrence.recordedAt
    )
  };
}

describe("Inbox V2 Message and StaffNote contracts", () => {
  it("keeps internal, source-originated and Hulee external origins distinct", () => {
    expect(
      inboxV2MessageSchema.safeParse(fixtureMessage("internal")).success
    ).toBe(true);
    expect(
      inboxV2MessageSchema.safeParse(fixtureMessage("source")).success
    ).toBe(true);
    expect(
      inboxV2MessageSchema.safeParse(fixtureMessage("hulee")).success
    ).toBe(true);
    expect(
      inboxV2MessageSchema.safeParse({
        ...fixtureMessage("source"),
        appActor: fixtureEmployeeActor
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageSchema.safeParse({
        ...fixtureMessage("internal"),
        sourceAccountId: "source_account:fake"
      }).success
    ).toBe(false);
  });

  it("atomically creates internal, source-native and Hulee outbound Messages", () => {
    const internal = inboxV2MessageCreationCommitSchema.safeParse(
      fixtureInternalCreationCommit()
    );
    const source = inboxV2MessageCreationCommitSchema.safeParse(
      fixtureSourceCreationCommit()
    );
    const hulee = inboxV2MessageCreationCommitSchema.safeParse(
      fixtureHuleeCreationCommit()
    );
    const nativeBase = fixtureSourceCreationCommit();
    const nativeOccurrence = fixtureOccurrence({ direction: "outbound" });
    const native = inboxV2MessageCreationCommitSchema.safeParse({
      ...nativeBase,
      message: {
        ...nativeBase.message,
        origin: {
          ...nativeBase.message.origin,
          direction: "outbound"
        }
      },
      timelineAllocation: fixtureTimelineAllocation(
        "external",
        fixtureTimelineItem("external")
      ),
      sourceOccurrence: nativeOccurrence,
      sourceResolutionCommit:
        fixtureOccurrenceResolutionCommit(nativeOccurrence),
      externalMessageReference: fixtureExternalReference(nativeOccurrence),
      originTransportLink: fixtureTransportLink(
        nativeOccurrence,
        "native_outbound"
      ),
      originTransportLinkHead: {
        ...nativeBase.originTransportLinkHead,
        latestLink: fixtureReference(
          "message_transport_occurrence_link",
          "message_transport_occurrence_link:native_outbound-1"
        )
      }
    });
    expect(internal.success ? [] : internal.error.issues).toEqual([]);
    expect(source.success ? [] : source.error.issues).toEqual([]);
    expect(hulee.success ? [] : hulee.error.issues).toEqual([]);
    expect(native.success ? [] : native.error.issues).toEqual([]);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...fixtureInternalCreationCommit(),
        timelineAllocation: fixtureTimelineAllocation("external")
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...fixtureSourceCreationCommit(),
        timelineAllocation: fixtureTimelineAllocation(
          "internal",
          fixtureTimelineItem("internal")
        )
      }).success
    ).toBe(false);
  });

  it("uses reply_external authority for a normal external send", () => {
    const commit = fixtureHuleeCreationCommit();
    expect(commit.outboundRoute.operationId).toBe("core:message.send");
    expect(commit.outboundRoute.requiredConversationPermissionId).toBe(
      "core:message.reply_external"
    );
    expect(inboxV2MessageCreationCommitSchema.safeParse(commit).success).toBe(
      true
    );

    const legacyRoute = {
      ...commit.outboundRoute,
      requiredConversationPermissionId: "core:message.send_external",
      conversationAuthorization: {
        ...commit.outboundRoute.conversationAuthorization,
        requiredPermissionId: "core:message.send_external",
        matchedPermissionIds: ["core:message.send_external"]
      }
    };
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...commit,
        outboundRoute: legacyRoute,
        outboundBindingSnapshot: fixtureOutboundBindingSnapshot(legacyRoute)
      }).success
    ).toBe(false);
  });

  it("persists an unavailable selected route for same-route retry", () => {
    const commit = fixtureHuleeCreationCommit();
    const diagnostic = {
      codeId: "core:runtime-unavailable",
      retryable: true,
      correlationToken: "runtime:message-create-1",
      safeOperatorHintId: null
    };
    const unavailable = {
      ...commit,
      outboundRoute: {
        ...commit.outboundRoute,
        runtimeObservationAtResolution: {
          state: "unavailable" as const,
          revision: "2",
          observedAt: fixtureT1,
          diagnostic
        }
      },
      outboundBindingSnapshot: {
        ...commit.outboundBindingSnapshot,
        runtimeHealth: {
          state: "unavailable" as const,
          revision: "2",
          checkedAt: fixtureT1,
          diagnostic
        }
      }
    };

    const parsed = inboxV2MessageCreationCommitSchema.safeParse(unavailable);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(unavailable.outboundRoute.sourceThreadBinding).toEqual(
      commit.outboundRoute.sourceThreadBinding
    );
    expect(unavailable.outboundRoute.bindingFence).toEqual(
      commit.outboundRoute.bindingFence
    );
    expect(unavailable.outboundDispatch.route).toEqual(
      commit.outboundDispatch.route
    );
  });

  it.each(["state", "revision", "checkedAt", "diagnostic"] as const)(
    "rejects an outbound binding whose runtime %s differs from the pinned route observation",
    (field) => {
      const commit = fixtureHuleeCreationCommit();
      const diagnostic = {
        codeId: "core:runtime-unavailable",
        retryable: true,
        correlationToken: "runtime:message-create-mismatch",
        safeOperatorHintId: null
      };
      const routeRuntime = {
        state: "unavailable" as const,
        revision: "2",
        observedAt: fixtureT1,
        diagnostic
      };
      const bindingRuntime = {
        state: "unavailable" as const,
        revision: "2",
        checkedAt: fixtureT1,
        diagnostic
      };
      const mismatchedRuntime =
        field === "state"
          ? { ...bindingRuntime, state: "degraded" as const }
          : field === "revision"
            ? { ...bindingRuntime, revision: "3" }
            : field === "checkedAt"
              ? { ...bindingRuntime, checkedAt: fixtureT0 }
              : {
                  ...bindingRuntime,
                  diagnostic: {
                    ...diagnostic,
                    codeId: "core:runtime-unavailable-other"
                  }
                };

      expect(
        inboxV2MessageCreationCommitSchema.safeParse({
          ...commit,
          outboundRoute: {
            ...commit.outboundRoute,
            runtimeObservationAtResolution: routeRuntime
          },
          outboundBindingSnapshot: {
            ...commit.outboundBindingSnapshot,
            runtimeHealth: mismatchedRuntime
          }
        }).success
      ).toBe(false);
    }
  );

  it("binds source Message timeline clocks to the exact SourceOccurrence", () => {
    const base = fixtureSourceCreationCommit();
    const timelineItem = base.timelineAllocation.items[0];
    if (timelineItem === undefined) {
      throw new Error("Source Message fixture requires one TimelineItem.");
    }

    const occurredMismatchItem = {
      ...timelineItem,
      occurredAt: fixtureT0
    };
    const occurredMismatch = inboxV2MessageCreationCommitSchema.safeParse({
      ...base,
      timelineAllocation: {
        ...base.timelineAllocation,
        items: [occurredMismatchItem],
        conversationAfter: {
          ...base.timelineAllocation.conversationAfter,
          head: {
            ...base.timelineAllocation.conversationAfter.head,
            latestActivityAt: fixtureT0
          }
        }
      },
      initialRevision: {
        ...base.initialRevision,
        occurredAt: fixtureT0
      }
    });
    expect(occurredMismatch.success).toBe(false);
    if (!occurredMismatch.success) {
      expect(occurredMismatch.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["timelineAllocation", "items", 0, "occurredAt"],
            message:
              "Source Message occurrence time must match its exact SourceOccurrence observation time."
          })
        ])
      );
    }

    const receivedMismatch = inboxV2MessageCreationCommitSchema.safeParse({
      ...base,
      timelineAllocation: {
        ...base.timelineAllocation,
        items: [{ ...timelineItem, receivedAt: fixtureT1 }]
      }
    });
    expect(receivedMismatch.success).toBe(false);
    if (!receivedMismatch.success) {
      expect(receivedMismatch.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["timelineAllocation", "items", 0, "receivedAt"],
            message:
              "Source Message receipt time must match its exact SourceOccurrence recording time."
          })
        ])
      );
    }
  });

  it("binds a source Employee claim to its full event-time snapshot", () => {
    const commit = fixtureSourceCreationCommit();
    const claim = fixtureSourceIdentityClaim();
    const message = {
      ...commit.message,
      origin: {
        ...commit.message.origin,
        claimAtOccurrence: {
          claim: fixtureReference("source_identity_claim", claim.id),
          claimVersion: claim.claimVersion,
          resolvedEmployee: fixtureEmployeeReference
        }
      }
    };
    const claimed = {
      ...commit,
      message,
      claimAtOccurrenceSnapshot: claim
    };

    expect(inboxV2MessageCreationCommitSchema.safeParse(claimed).success).toBe(
      true
    );
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...claimed,
        claimAtOccurrenceSnapshot: {
          ...claim,
          target: {
            kind: "employee",
            employee: fixtureReference("employee", "employee:employee-2")
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...claimed,
        claimAtOccurrenceSnapshot: null
      }).success
    ).toBe(false);
  });

  it("imports source history without advancing operational activity", () => {
    const base = fixtureSourceCreationCommit();
    const occurrence = fixtureOccurrence({ origin: "history" });
    const historyItem = fixtureTimelineItem("external", {
      activity: {
        kind: "history_import",
        sourceOccurrence: fixtureSourceOccurrenceReference,
        importedAt: fixtureT2
      }
    });
    const commit = {
      ...base,
      timelineAllocation: fixtureTimelineAllocation("external", historyItem),
      sourceOccurrence: occurrence,
      sourceResolutionCommit: fixtureOccurrenceResolutionCommit(occurrence),
      externalMessageReference: fixtureExternalReference(occurrence),
      originTransportLink: fixtureTransportLink(occurrence, "origin")
    };

    expect(inboxV2MessageCreationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(
      commit.timelineAllocation.conversationAfter.head.latestActivityItemId
    ).toBe(null);
  });

  it("rejects author-plane confusion and provider echo as a new Message", () => {
    const source = fixtureSourceCreationCommit();
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...source,
        authorParticipant: fixtureParticipant("employee")
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...source,
        sourceOccurrence: {
          ...source.sourceOccurrence,
          origin: {
            ...source.sourceOccurrence.origin,
            kind: "provider_echo"
          },
          direction: "outbound",
          providerActor: null
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...fixtureHuleeCreationCommit(),
        outboundDispatch: null
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...source,
        sourceOccurrence: {
          ...source.sourceOccurrence,
          resolution: {
            state: "pending",
            diagnostic: {
              codeId: "core:source-reference-pending",
              retryable: true,
              correlationToken: "correlation:source-reference-pending",
              safeOperatorHintId: null
            }
          }
        }
      }).success
    ).toBe(false);
  });

  it("keeps content-copy and provider-native forward as different semantics", () => {
    const canonical = {
      conversation: fixtureHuleeCreationCommit().message.conversation,
      message: fixtureMessageReference,
      timelineItem: fixtureTimelineItemReference,
      messageRevision: "1"
    };
    const nativeCapability = {
      capabilityId: "core:provider-native-forward",
      capabilityRevision: "1",
      adapterContract:
        fixtureSourceCreationCommit().sourceOccurrence.descriptor
          .adapterContract,
      decision: "supported" as const
    };
    const nativeSource = {
      externalMessageReference: fixtureExternalMessageReference,
      sourceOccurrence: fixtureSourceOccurrenceReference
    };
    const secondNativeSource = {
      externalMessageReference: fixtureReference(
        "external_message_reference",
        "external_message_reference:message-2"
      ),
      sourceOccurrence: fixtureReference(
        "source_occurrence",
        "source_occurrence:occurrence-2"
      )
    };
    expect(
      inboxV2MessageReferenceContextSchema.safeParse({
        kind: "forward_content_copy",
        sources: [canonical]
      }).success
    ).toBe(true);
    expect(
      inboxV2MessageReferenceContextSchema.safeParse({
        kind: "forward_provider_native",
        sources: [nativeSource],
        capability: nativeCapability
      }).success
    ).toBe(true);
    expect(
      inboxV2MessageReferenceContextSchema.safeParse({
        kind: "forward_content_copy",
        sources: [canonical, canonical]
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReferenceContextSchema.safeParse({
        kind: "forward_provider_native",
        sources: [canonical],
        copied: true
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReferenceContextSchema.safeParse({
        kind: "forward_provider_native",
        sources: [nativeSource, secondNativeSource],
        capability: nativeCapability
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageReferenceContextSchema.safeParse({
        kind: "forward_provider_observed",
        originOccurrence: fixtureSourceOccurrenceReference,
        provenanceCompleteness: "exact",
        sourceReferences: [nativeSource, secondNativeSource]
      }).success
    ).toBe(true);
  });

  it("requires exact external-work source proof for external content-copy", () => {
    const base = fixtureHuleeCreationCommit();
    if (base.content.state.kind !== "available") {
      throw new Error("Expected available content fixture.");
    }
    const source = {
      conversation: base.message.conversation,
      message: fixtureMessageReference,
      timelineItem: fixtureTimelineItemReference,
      messageRevision: "1"
    };
    const sourceProof = {
      conversation: source.conversation,
      message: source.message,
      expectedMessageRevision: source.messageRevision,
      timelineItem: source.timelineItem,
      expectedTimelineItemRevision: source.messageRevision,
      timelineContent: base.message.content.content,
      expectedTimelineContentRevision: base.message.content.contentRevision,
      sourceContentDigestSha256: base.content.state.contentDigestSha256,
      visibilityBoundary: "external_work" as const
    };
    const intent = {
      kind: "forward_content_copy" as const,
      tenantId: base.tenantId,
      conversation: base.message.conversation,
      authorParticipant: base.message.authorParticipant,
      appActor: base.message.appActor,
      automationCausation: base.message.automationCausation,
      occurredAt: base.message.createdAt,
      content: { blocks: base.content.state.blocks },
      referenceContext: {
        kind: "forward_content_copy" as const,
        sources: [source]
      },
      destination: {
        kind: "external" as const,
        outboundRoute: fixtureRouteReference
      }
    };

    expect(inboxV2TimelineCommandIntentSchema.safeParse(intent).success).toBe(
      false
    );
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        ...intent,
        sourceReadProofs: [
          { ...sourceProof, visibilityBoundary: "internal" as const }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        ...intent,
        sourceReadProofs: [sourceProof]
      }).success
    ).toBe(true);
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        ...intent,
        content: {
          blocks: [
            {
              ...base.content.state.blocks[0],
              text: "forged identity-copy content"
            }
          ]
        },
        sourceReadProofs: [sourceProof]
      }).success
    ).toBe(false);
  });

  it("allows external content-copy to allocate a new attachment anchor only", () => {
    const base = fixtureHuleeCreationCommit();
    const sourceAttachment = fixtureReference(
      "message_attachment",
      "message_attachment:copy-source-1"
    );
    const destinationAttachment = fixtureReference(
      "message_attachment",
      "message_attachment:copy-destination-1"
    );
    const sourceBlocks = [
      {
        blockKey: "file-1",
        kind: "file" as const,
        attachment: {
          state: "ready" as const,
          attachment: sourceAttachment,
          file: fixtureReference("file", "file:copy-1"),
          fileRevision: "4",
          fileVersion: fixtureReference(
            "file_version",
            "file_version:copy-1-r4"
          ),
          objectVersion: fixtureReference(
            "file_object_version",
            "file_object_version:copy-1-r4-v1"
          )
        },
        displayName: "copy.pdf"
      }
    ];
    const destinationBlocks = [
      {
        ...sourceBlocks[0],
        attachment: {
          ...sourceBlocks[0]!.attachment,
          attachment: destinationAttachment
        }
      }
    ];
    const source = {
      conversation: base.message.conversation,
      message: fixtureMessageReference,
      timelineItem: fixtureTimelineItemReference,
      messageRevision: "1"
    };
    const sourceProof = {
      conversation: source.conversation,
      message: source.message,
      expectedMessageRevision: source.messageRevision,
      timelineItem: source.timelineItem,
      expectedTimelineItemRevision: source.messageRevision,
      timelineContent: base.message.content.content,
      expectedTimelineContentRevision: base.message.content.contentRevision,
      sourceContentDigestSha256:
        calculateInboxV2MessageContentDigest(sourceBlocks),
      attachmentCopies: [
        {
          blockKey: "file-1",
          sourceAttachment,
          destinationAttachment
        }
      ],
      visibilityBoundary: "external_work" as const
    };
    const intent = {
      kind: "forward_content_copy" as const,
      tenantId: base.tenantId,
      conversation: base.message.conversation,
      authorParticipant: base.message.authorParticipant,
      appActor: base.message.appActor,
      automationCausation: base.message.automationCausation,
      occurredAt: base.message.createdAt,
      content: { blocks: destinationBlocks },
      referenceContext: {
        kind: "forward_content_copy" as const,
        sources: [source]
      },
      sourceReadProofs: [sourceProof],
      destination: {
        kind: "external" as const,
        outboundRoute: fixtureRouteReference
      }
    };

    expect(inboxV2TimelineCommandIntentSchema.safeParse(intent).success).toBe(
      true
    );
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        ...intent,
        sourceReadProofs: [{ ...sourceProof, attachmentCopies: [] }]
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        ...intent,
        content: {
          blocks: [
            {
              ...destinationBlocks[0],
              displayName: "forged-name.pdf"
            }
          ]
        }
      }).success
    ).toBe(false);
  });

  it("pins one provider-native forward source to the exact route capability", () => {
    const targetExternalReference = fixtureReference(
      "external_message_reference",
      "external_message_reference:forward-target-1"
    );
    const targetOccurrence = {
      ...fixtureOccurrence({
        occurrenceId: "source_occurrence:forward-target-1"
      }),
      referencePortability: {
        kind: "external_thread" as const,
        adapterContract: fixtureAdapterContract,
        decisionStrength: "authoritative" as const
      },
      resolution: {
        state: "resolved" as const,
        externalMessageReference: targetExternalReference
      }
    };
    const targetOccurrenceFixture = targetOccurrence as unknown as ReturnType<
      typeof fixtureOccurrence
    >;
    const target = {
      externalMessageReference: targetExternalReference,
      sourceOccurrence: fixtureReference(
        "source_occurrence",
        targetOccurrence.id
      )
    };
    const externalSnapshot = {
      externalMessageReference: fixtureExternalReference(
        targetOccurrenceFixture,
        {
          id: targetExternalReference.id,
          message: fixtureReference("message", "message:forward-target-1"),
          timelineItem: fixtureReference(
            "timeline_item",
            "timeline_item:forward-target-1"
          )
        }
      ),
      sourceOccurrence: targetOccurrence
    };
    const route = fixtureExternalTargetRoute(
      "core:message.forward_provider_native",
      "core:message.forward_external",
      {
        occurrence: targetOccurrenceFixture,
        externalMessageReference: targetExternalReference
      }
    );
    const base = fixtureHuleeCreationCommit();
    const referenceContext = {
      kind: "forward_provider_native" as const,
      sources: [target],
      capability: {
        capabilityId: "core:provider-native-forward",
        capabilityRevision: route.bindingFence.capabilityRevision,
        adapterContract: route.adapterContract,
        decision: "supported" as const
      }
    };
    const commit = {
      ...base,
      message: { ...base.message, referenceContext },
      externalReferenceTargets: [externalSnapshot],
      outboundRoute: route,
      outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
        route,
        "core:provider-native-forward"
      )
    };

    const parsed = inboxV2MessageCreationCommitSchema.safeParse(commit);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);

    const destinationBinding = fixtureReference(
      "source_thread_binding",
      "source_thread_binding:forward-destination-2"
    );
    const destinationAccount = fixtureReference(
      "source_account",
      "source_account:forward-destination-2"
    );
    const destinationConnection = fixtureReference(
      "source_connection",
      "source_connection:forward-destination-2"
    );
    const destinationAuthorizationTarget = {
      ...route.conversationAuthorization.target,
      sourceThreadBinding: destinationBinding,
      sourceAccount: destinationAccount,
      sourceConnection: destinationConnection
    };
    const portableRoute = {
      ...route,
      sourceThreadBinding: destinationBinding,
      sourceAccount: destinationAccount,
      sourceConnection: destinationConnection,
      conversationAuthorization: {
        ...route.conversationAuthorization,
        target: destinationAuthorizationTarget
      },
      sourceAccountAuthorization: {
        ...route.sourceAccountAuthorization,
        target: destinationAuthorizationTarget
      },
      selection: {
        ...route.selection,
        intent: {
          kind: "explicit_binding" as const,
          binding: destinationBinding
        },
        reason: "explicit_binding" as const
      }
    };
    const portableCommit = {
      ...commit,
      outboundRoute: portableRoute,
      outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
        portableRoute,
        "core:provider-native-forward"
      )
    };
    const portableParsed =
      inboxV2MessageCreationCommitSchema.safeParse(portableCommit);
    expect(portableParsed.success ? [] : portableParsed.error.issues).toEqual(
      []
    );

    const bindingOnlyPortability = {
      kind: "binding_only" as const,
      adapterContract: targetOccurrence.descriptor.adapterContract,
      decisionStrength: "safe_default" as const
    };
    if (portableRoute.referenceContext.kind !== "external_message") {
      throw new Error("Portable forward fixture requires an exact reference.");
    }
    const bindingOnlyRoute = {
      ...portableRoute,
      referenceContext: {
        ...portableRoute.referenceContext,
        portability: bindingOnlyPortability,
        resolutionDecision: {
          ...portableRoute.referenceContext.resolutionDecision,
          portability: bindingOnlyPortability
        }
      }
    };
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...portableCommit,
        externalReferenceTargets: [
          {
            ...externalSnapshot,
            sourceOccurrence: {
              ...targetOccurrence,
              referencePortability: bindingOnlyPortability
            }
          }
        ],
        outboundRoute: bindingOnlyRoute,
        outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
          bindingOnlyRoute,
          "core:provider-native-forward"
        )
      }).success
    ).toBe(false);

    const observedBase = fixtureSourceCreationCommit();
    if (observedBase.message.origin.kind !== "source_originated") {
      throw new Error("Observed forward fixture requires source origin.");
    }
    const observedOriginOccurrence =
      observedBase.message.origin.originOccurrence;
    const observedForward = {
      ...observedBase,
      message: {
        ...observedBase.message,
        referenceContext: {
          kind: "forward_provider_observed" as const,
          originOccurrence: observedOriginOccurrence,
          provenanceCompleteness: "exact" as const,
          sourceReferences: [target]
        }
      },
      externalReferenceTargets: [externalSnapshot],
      providerReferenceSemantics: [
        providerReferenceSemanticEvidence(observedBase, "forward", {
          kind: "event_classification",
          sourceOccurrence: observedOriginOccurrence,
          provenanceCompleteness: "exact"
        }),
        providerReferenceSemanticEvidence(observedBase, "forward", {
          kind: "resolved_external",
          ...target
        })
      ]
    };
    expect(
      inboxV2MessageCreationCommitSchema.safeParse(observedForward).success
    ).toBe(true);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...observedForward,
        providerReferenceSemantics: []
      }).success
    ).toBe(false);
    const forgedProof = {
      ...observedForward.providerReferenceSemantics[0].providerSemanticProof,
      semanticId: "core:message.reference.reply.observed"
    };
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...observedForward,
        providerReferenceSemantics: [
          {
            ...observedForward.providerReferenceSemantics[0],
            providerSemanticProof: forgedProof,
            semanticOrderingCommit: {
              ...observedForward.providerReferenceSemantics[0]
                .semanticOrderingCommit,
              proof: forgedProof
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...commit,
        message: {
          ...commit.message,
          referenceContext: {
            ...referenceContext,
            sources: [target, target]
          }
        }
      }).success
    ).toBe(false);
  });

  it("requires event-level trusted classification for partial and opaque observed forwards without targets", () => {
    for (const provenanceCompleteness of ["partial", "opaque"] as const) {
      const base = fixtureSourceCreationCommit();
      if (base.message.origin.kind !== "source_originated") {
        throw new Error("Observed forward fixture requires source origin.");
      }
      const originOccurrence = base.message.origin.originOccurrence;
      const eventEvidence = providerReferenceSemanticEvidence(base, "forward", {
        kind: "event_classification",
        sourceOccurrence: originOccurrence,
        provenanceCompleteness
      });
      const commit = {
        ...base,
        message: {
          ...base.message,
          referenceContext: {
            kind: "forward_provider_observed" as const,
            originOccurrence,
            provenanceCompleteness,
            sourceReferences: []
          }
        },
        providerReferenceSemantics: [eventEvidence]
      };

      expect(inboxV2MessageCreationCommitSchema.safeParse(commit).success).toBe(
        true
      );
      expect(
        inboxV2MessageCreationCommitSchema.safeParse({
          ...commit,
          message: {
            ...commit.message,
            referenceContext: {
              ...commit.message.referenceContext,
              provenanceCompleteness:
                provenanceCompleteness === "partial" ? "opaque" : "partial"
            }
          }
        }).success
      ).toBe(false);
      expect(
        inboxV2MessageCreationCommitSchema.safeParse({
          ...commit,
          providerReferenceSemantics: []
        }).success
      ).toBe(false);

      const wrongSemanticProof = {
        ...eventEvidence.providerSemanticProof,
        semanticId: "core:message.reference.reply.observed"
      };
      expect(
        inboxV2MessageCreationCommitSchema.safeParse({
          ...commit,
          providerReferenceSemantics: [
            {
              ...eventEvidence,
              providerSemanticProof: wrongSemanticProof,
              semanticOrderingCommit: {
                ...eventEvidence.semanticOrderingCommit,
                proof: wrongSemanticProof
              }
            }
          ]
        }).success
      ).toBe(false);

      const wrongNormalizedEvent = fixtureReference(
        "normalized_inbound_event",
        `normalized_inbound_event:wrong-forward-${provenanceCompleteness}`
      );
      const wrongEventProof = {
        ...eventEvidence.providerSemanticProof,
        normalizedInboundEvent: wrongNormalizedEvent
      };
      expect(
        inboxV2MessageCreationCommitSchema.safeParse({
          ...commit,
          providerReferenceSemantics: [
            {
              ...eventEvidence,
              providerSemanticProof: wrongEventProof,
              semanticOrderingCommit: {
                ...eventEvidence.semanticOrderingCommit,
                proof: wrongEventProof,
                after: {
                  ...eventEvidence.semanticOrderingCommit.after,
                  normalizedInboundEvent: wrongNormalizedEvent
                }
              }
            }
          ]
        }).success
      ).toBe(false);
    }
  });

  it("keeps the maximum 32 observed-forward targets representable with one classification proof", () => {
    const base = fixtureSourceCreationCommit();
    if (base.message.origin.kind !== "source_originated") {
      throw new Error("Observed forward fixture requires source origin.");
    }
    const originOccurrence = base.message.origin.originOccurrence;
    const targets = Array.from({ length: 32 }, (_, index) => {
      const suffix = String(index + 1);
      const externalReference = fixtureReference(
        "external_message_reference",
        `external_message_reference:forward-target-${suffix}`
      );
      const occurrenceBase = fixtureOccurrence({
        occurrenceId: `source_occurrence:forward-target-${suffix}`,
        externalSubject: `forward-target-${suffix}`
      });
      const sourceOccurrence = {
        ...occurrenceBase,
        resolution: {
          state: "resolved" as const,
          externalMessageReference: externalReference
        }
      };
      const target = {
        externalMessageReference: externalReference,
        sourceOccurrence: fixtureReference(
          "source_occurrence",
          sourceOccurrence.id
        )
      };
      return {
        target,
        snapshot: {
          externalMessageReference: fixtureExternalReference(sourceOccurrence, {
            id: externalReference.id,
            timelineItem: fixtureReference(
              "timeline_item",
              `timeline_item:forward-target-${suffix}`
            ),
            message: fixtureReference(
              "message",
              `message:forward-target-${suffix}`
            )
          }),
          sourceOccurrence
        },
        evidence: providerReferenceSemanticEvidence(base, "forward", {
          kind: "resolved_external",
          ...target
        })
      };
    });
    const commit = {
      ...base,
      message: {
        ...base.message,
        referenceContext: {
          kind: "forward_provider_observed" as const,
          originOccurrence,
          provenanceCompleteness: "exact" as const,
          sourceReferences: targets.map(({ target }) => target)
        }
      },
      externalReferenceTargets: targets.map(({ snapshot }) => snapshot),
      providerReferenceSemantics: [
        providerReferenceSemanticEvidence(base, "forward", {
          kind: "event_classification",
          sourceOccurrence: originOccurrence,
          provenanceCompleteness: "exact"
        }),
        ...targets.map(({ evidence }) => evidence)
      ]
    };

    const parsed = inboxV2MessageCreationCommitSchema.safeParse(commit);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it("requires a bounded same-Conversation snapshot for an internal reply", () => {
    const targetMessage = fixtureReference("message", "message:target-1");
    const targetTimelineItem = fixtureReference(
      "timeline_item",
      "timeline_item:target-1"
    );
    const targetMessageSnapshot = fixtureMessage("internal", fixtureContent(), {
      id: targetMessage.id,
      timelineItem: targetTimelineItem
    });
    const targetTimelineSnapshot = fixtureTimelineItem("internal", {
      id: targetTimelineItem.id,
      timelineSequence: "9",
      subject: {
        kind: "message",
        message: targetMessage,
        messageRevision: "1"
      }
    });
    const base = fixtureInternalCreationCommit();
    const message = {
      ...base.message,
      referenceContext: {
        kind: "reply" as const,
        target: {
          state: "resolved_internal" as const,
          canonical: {
            conversation: targetMessageSnapshot.conversation,
            message: targetMessage,
            timelineItem: targetTimelineItem,
            messageRevision: "1"
          }
        }
      }
    };
    const commit = {
      ...base,
      message,
      canonicalReferenceTargets: [
        { message: targetMessageSnapshot, timelineItem: targetTimelineSnapshot }
      ]
    };
    expect(inboxV2MessageCreationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...commit,
        canonicalReferenceTargets: []
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...commit,
        canonicalReferenceTargets: [
          {
            message: {
              ...targetMessageSnapshot,
              conversation: fixtureReference(
                "conversation",
                "conversation:unrelated"
              )
            },
            timelineItem: {
              ...targetTimelineSnapshot,
              conversation: fixtureReference(
                "conversation",
                "conversation:unrelated"
              )
            }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("binds an unresolved provider reply to its exact pending occurrence", () => {
    const base = fixtureSourceCreationCommit();
    const unresolvedOccurrence = {
      ...fixtureOccurrence({
        occurrenceId: "source_occurrence:reply-pending-1",
        externalSubject: "provider-message-pending-1"
      }),
      resolution: {
        state: "pending" as const,
        diagnostic: {
          codeId: "core:source-reference-pending",
          retryable: true,
          correlationToken: "correlation:reply-pending-1",
          safeOperatorHintId: null
        }
      }
    };
    const referenceContext = {
      kind: "reply" as const,
      target: {
        state: "unresolved_source" as const,
        source: {
          externalMessageKey: unresolvedOccurrence.messageKey,
          sourceOccurrence: fixtureReference(
            "source_occurrence",
            unresolvedOccurrence.id
          ),
          resolution: { state: "pending" as const }
        }
      }
    };
    const commit = {
      ...base,
      message: { ...base.message, referenceContext },
      unresolvedReferenceTarget: unresolvedOccurrence,
      providerReferenceSemantics: [
        providerReferenceSemanticEvidence(base, "reply", {
          kind: "unresolved_source",
          sourceOccurrence: fixtureReference(
            "source_occurrence",
            unresolvedOccurrence.id
          )
        })
      ]
    };

    expect(inboxV2MessageCreationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...commit,
        unresolvedReferenceTarget: {
          ...unresolvedOccurrence,
          id: "source_occurrence:reply-other-1"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...commit,
        providerReferenceSemantics: []
      }).success
    ).toBe(false);
  });

  it("resolves an external reply through matching canonical and provider snapshots", () => {
    const targetMessage = fixtureReference(
      "message",
      "message:target-external"
    );
    const targetTimelineItem = fixtureReference(
      "timeline_item",
      "timeline_item:target-external"
    );
    const targetOccurrenceReference = fixtureReference(
      "source_occurrence",
      "source_occurrence:target-external"
    );
    const targetExternalReference = fixtureReference(
      "external_message_reference",
      "external_message_reference:target-external"
    );
    const occurrenceBase = fixtureSourceCreationCommit().sourceOccurrence;
    const targetOccurrence = {
      ...occurrenceBase,
      id: targetOccurrenceReference.id,
      messageKey: {
        ...occurrenceBase.messageKey,
        canonicalExternalSubject: "provider-target-external"
      },
      descriptor: {
        ...occurrenceBase.descriptor,
        providerReferences: [
          {
            ...occurrenceBase.descriptor.providerReferences[0],
            subject: "provider-target-external"
          }
        ]
      },
      resolution: {
        state: "resolved" as const,
        externalMessageReference: targetExternalReference
      }
    };
    const externalReference = {
      ...fixtureExternalReference(targetOccurrence),
      id: targetExternalReference.id,
      message: targetMessage,
      timelineItem: targetTimelineItem
    };
    const targetMessageSnapshot = fixtureMessage("source", fixtureContent(), {
      id: targetMessage.id,
      timelineItem: targetTimelineItem,
      origin: {
        kind: "source_originated",
        originOccurrence: targetOccurrenceReference,
        direction: "inbound",
        claimAtOccurrence: null
      }
    });
    const targetTimelineSnapshot = fixtureTimelineItem("external", {
      id: targetTimelineItem.id,
      timelineSequence: "9",
      subject: {
        kind: "message",
        message: targetMessage,
        messageRevision: "1"
      }
    });
    const base = fixtureSourceCreationCommit();
    const commit = {
      ...base,
      message: {
        ...base.message,
        referenceContext: {
          kind: "reply" as const,
          target: {
            state: "resolved_external" as const,
            canonical: {
              conversation: targetMessageSnapshot.conversation,
              message: targetMessage,
              timelineItem: targetTimelineItem,
              messageRevision: "1"
            },
            external: {
              externalMessageReference: targetExternalReference,
              sourceOccurrence: targetOccurrenceReference
            }
          }
        }
      },
      canonicalReferenceTargets: [
        { message: targetMessageSnapshot, timelineItem: targetTimelineSnapshot }
      ],
      externalReferenceTargets: [
        {
          externalMessageReference: externalReference,
          sourceOccurrence: targetOccurrence
        }
      ],
      providerReferenceSemantics: [
        providerReferenceSemanticEvidence(base, "reply", {
          kind: "resolved_external",
          externalMessageReference: targetExternalReference,
          sourceOccurrence: targetOccurrenceReference
        })
      ]
    };
    expect(inboxV2MessageCreationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...commit,
        externalReferenceTargets: [
          {
            ...commit.externalReferenceTargets[0],
            externalMessageReference: {
              ...externalReference,
              message: fixtureMessageReference
            }
          }
        ]
      }).success
    ).toBe(false);
    const unrelatedTarget = fixtureReference(
      "source_occurrence",
      "source_occurrence:unrelated-reference-proof"
    );
    expect(
      inboxV2MessageCreationCommitSchema.safeParse({
        ...commit,
        providerReferenceSemantics: [
          {
            ...commit.providerReferenceSemantics[0],
            target: {
              ...commit.providerReferenceSemantics[0].target,
              sourceOccurrence: unrelatedTarget
            }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("models StaffNote as a separate staff-only entity with no transport fields", () => {
    const content = fixtureContent();
    const timelineItem = fixtureTimelineItem("external", {
      subject: {
        kind: "staff_note",
        staffNote: fixtureReference("staff_note", "staff_note:note-1"),
        staffNoteRevision: "1"
      },
      visibility: "staff_only"
    });
    const note = {
      tenantId: fixtureTenantId,
      id: "staff_note:note-1",
      conversation: fixtureReference(
        "conversation",
        "conversation:conversation-1"
      ),
      timelineItem: fixtureTimelineItemReference,
      authorParticipant: fixtureReference(
        "conversation_participant",
        "conversation_participant:employee-1"
      ),
      appActor: fixtureEmployeeActor,
      automationCausation: null,
      content: fixtureMessage("internal", content).content,
      revision: "1",
      createdAt: fixtureT2,
      updatedAt: fixtureT2
    };
    const initialRevision = {
      tenantId: fixtureTenantId,
      id: "staff_note_revision:revision-1",
      staffNote: fixtureReference("staff_note", "staff_note:note-1"),
      timelineItem: fixtureTimelineItemReference,
      expectedPreviousRevision: null,
      staffNoteRevision: "1",
      change: { kind: "created", content: note.content },
      actionAttribution: {
        actionParticipant: note.authorParticipant,
        appActor: note.appActor,
        automationCausation: null
      },
      occurredAt: timelineItem.occurredAt,
      recordedAt: fixtureT2,
      recordRevision: "1",
      createdAt: fixtureT2
    };
    expect(inboxV2StaffNoteSchema.safeParse(note).success).toBe(true);
    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse({
        tenantId: fixtureTenantId,
        timelineAllocation: fixtureTimelineAllocation("external", timelineItem),
        authorParticipant: fixtureParticipant("employee"),
        content,
        initialRevision,
        staffNote: note
      }).success
    ).toBe(true);
    expect(
      inboxV2StaffNoteSchema.safeParse({
        ...note,
        outboundRoute: fixtureRouteReference
      }).success
    ).toBe(false);
    expect(
      inboxV2StaffNoteSchema.safeParse({
        ...note,
        providerDelivery: "sent"
      }).success
    ).toBe(false);

    const sourceBlocks = [
      {
        blockKey: "unsupported-1",
        kind: "unsupported_source_content" as const,
        sourceOccurrence: fixtureSourceOccurrenceReference,
        providerContentKindId: "module:synthetic:unknown",
        safeFallbackReasonId: "core:unsupported"
      }
    ];
    const sourceContent = fixtureContent({
      state: {
        kind: "available",
        blocks: sourceBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(sourceBlocks)
      }
    });
    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse({
        tenantId: fixtureTenantId,
        timelineAllocation: fixtureTimelineAllocation("external", timelineItem),
        authorParticipant: fixtureParticipant("employee"),
        content: sourceContent,
        initialRevision: {
          ...initialRevision,
          change: {
            kind: "created",
            content: inboxV2TimelineContentHeadOf(sourceContent as never)
          }
        },
        staffNote: {
          ...note,
          content: inboxV2TimelineContentHeadOf(sourceContent as never)
        }
      }).success
    ).toBe(false);
  });

  it("keeps StaffNote read separate from provider receipt and create", () => {
    expect(
      inboxV2StaffNoteReadIntentSchema.safeParse({
        tenantId: fixtureTenantId,
        staffNote: fixtureReference("staff_note", "staff_note:note-1"),
        reader: fixtureEmployeeActor,
        readAt: fixtureT2
      }).success
    ).toBe(true);
    expect(
      inboxV2StaffNoteReadIntentSchema.safeParse({
        tenantId: fixtureTenantId,
        staffNote: fixtureReference("staff_note", "staff_note:note-1"),
        reader: fixtureEmployeeActor,
        readAt: fixtureT2,
        providerReceipt: true
      }).success
    ).toBe(false);
  });

  it("uses structurally distinct external, internal and StaffNote command intents", () => {
    const content = {
      blocks:
        fixtureContent().state.kind === "available"
          ? fixtureContent().state.blocks
          : []
    };
    const authored = {
      tenantId: fixtureTenantId,
      conversation: fixtureReference(
        "conversation",
        "conversation:conversation-1"
      ),
      authorParticipant: fixtureReference(
        "conversation_participant",
        "conversation_participant:employee-1"
      ),
      appActor: fixtureEmployeeActor,
      automationCausation: null,
      occurredAt: fixtureT2
    };
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        kind: "send_internal",
        ...authored,
        content,
        referenceContext: { kind: "none" }
      }).success
    ).toBe(true);
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        kind: "create_staff_note",
        ...authored,
        content
      }).success
    ).toBe(true);
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        kind: "create_staff_note",
        ...authored,
        content,
        outboundRoute: fixtureRouteReference
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        kind: "send_internal",
        ...authored,
        content,
        referenceContext: { kind: "none" },
        sourceOccurrence: fixtureSourceOccurrenceReference
      }).success
    ).toBe(false);

    const replyContext = {
      kind: "reply" as const,
      target: {
        state: "resolved_external" as const,
        canonical: {
          conversation: authored.conversation,
          message: fixtureMessageReference,
          timelineItem: fixtureTimelineItemReference,
          messageRevision: "1"
        },
        external: {
          externalMessageReference: fixtureExternalMessageReference,
          sourceOccurrence: fixtureSourceOccurrenceReference
        }
      }
    };
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        kind: "reply_external",
        ...authored,
        content,
        externalMessageReference: fixtureExternalMessageReference,
        sourceOccurrence: fixtureSourceOccurrenceReference,
        outboundRoute: fixtureRouteReference,
        referenceContext: replyContext
      }).success
    ).toBe(true);
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        kind: "send_external",
        ...authored,
        content,
        outboundRoute: fixtureRouteReference,
        referenceContext: replyContext
      }).success
    ).toBe(false);
  });

  it("rejects unsupported-source fallback in outbound command content", () => {
    const hulee = fixtureHuleeCreationCommit();
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        kind: "send_external",
        tenantId: fixtureTenantId,
        conversation: hulee.message.conversation,
        authorParticipant: hulee.message.authorParticipant,
        appActor: fixtureEmployeeActor,
        automationCausation: null,
        occurredAt: fixtureT2,
        outboundRoute: fixtureRouteReference,
        referenceContext: { kind: "none" },
        content: {
          blocks: [
            {
              blockKey: "unsupported-1",
              kind: "unsupported_source_content",
              sourceOccurrence: fixtureSourceOccurrenceReference,
              providerContentKindId: "module:synthetic:unknown",
              safeFallbackReasonId: "core:unsupported"
            }
          ]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        kind: "send_external",
        tenantId: fixtureTenantId,
        conversation: hulee.message.conversation,
        authorParticipant: hulee.message.authorParticipant,
        appActor: fixtureEmployeeActor,
        automationCausation: null,
        occurredAt: fixtureT2,
        outboundRoute: fixtureRouteReference,
        referenceContext: { kind: "none" },
        content: {
          blocks: [
            {
              blockKey: "pending-image-1",
              kind: "image",
              attachment: {
                state: "pending",
                attachment: fixtureReference(
                  "message_attachment",
                  "message_attachment:pending-1"
                )
              },
              displayName: "pending.png"
            }
          ]
        }
      }).success
    ).toBe(false);
  });

  it("exports Message through the exact versioned envelope", () => {
    expect(
      inboxV2MessageEnvelopeSchema.parse({
        schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
        schemaVersion: "v1",
        payload: fixtureMessage("internal")
      }).payload.id
    ).toBe(fixtureMessageReference.id);
  });
});
