import {
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  calculateInboxV2CanonicalSha256,
  calculateInboxV2MessageContentDigest,
  calculateInboxV2OutboundDispatchContentFingerprint,
  calculateInboxV2OutboundDispatchContentPlanDigest,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizedCommandSchema,
  inboxV2MessageContentBlockSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2OutboundRoutePrincipalSchema,
  inboxV2OutboundRouteResolutionInputSchema,
  inboxV2TimelineCommandIntentSchema,
  inboxV2TimelineContentDraftSchema,
  materializeInboxV2OutboundRouteResolutionCommit,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2MessageContentBlock,
  type InboxV2MessageCreationCommit,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundRoute,
  type InboxV2OutboundRouteResolutionInput,
  type InboxV2TimelineCommandIntent
} from "@hulee/contracts";
import {
  type InboxV2AuthorizationPlanInput,
  type InboxV2SecurityDenialContext,
  type InboxV2SecurityDenialSink
} from "@hulee/core";
import type {
  InboxV2AuthorizedAtomicMaterializationCoordinator,
  InboxV2PrivilegedAuthorizationMutationAppliedStatus,
  WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  fixtureConversationReference,
  fixtureEmployeeReference,
  fixtureExternalReference,
  fixtureExternalTargetRoute,
  fixtureHuleeCreationCommit,
  fixtureMessage,
  fixtureOccurrence,
  fixtureOutboundBindingSnapshot,
  fixtureReference,
  fixtureRoute,
  fixtureT0,
  fixtureT1,
  fixtureT2,
  fixtureT4,
  fixtureTenantId,
  fixtureTimelineItem
} from "../../../packages/contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import type { InboxV2OutboundMessageMaterializationFingerprintAuthority } from "./inbox-v2-outbound-message-materialization";
import {
  calculateInboxV2OutboundReferenceIntentDigest,
  calculateInboxV2OutboundReferenceRouteIdempotencyToken,
  createInboxV2OutboundReferenceCommandService as createUnboundService,
  inboxV2ContentCopyProvenanceMatches,
  type InboxV2OutboundReferenceCommand,
  type InboxV2OutboundReferenceCommandPreparer,
  type InboxV2OutboundReferenceCommandServiceOptions,
  type InboxV2OutboundReferenceIdempotencyScope,
  type InboxV2OutboundReferenceRequestScope,
  type InboxV2PreparedOutboundReferenceCommand
} from "./inbox-v2-outbound-reference-command";

const hash = (seed: string) =>
  calculateInboxV2CanonicalSha256({ test: "outbound-reference", seed });

type ContentCopySourceReadProofFixture = NonNullable<
  Extract<
    InboxV2TimelineCommandIntent,
    { kind: "forward_content_copy" }
  >["sourceReadProofs"]
>[number];

type ExternalRouteGuardFixture = Extract<
  InboxV2AuthorizationPlanInput["requirements"][number]["guard"],
  { profileId: "core:rbac.guard.external_route" }
>;
type ProviderReferenceReplyGuardOperationFixture = Extract<
  ExternalRouteGuardFixture["operation"],
  { kind: "reply"; mode: "provider_reference" }
>;

const compareCanonicalStrings = (left: string, right: string) =>
  left === right ? 0 : left < right ? -1 : 1;

const requestScope = {
  tenantId: fixtureTenantId,
  principal: inboxV2OutboundRoutePrincipalSchema.parse({
    kind: "employee",
    employee: fixtureEmployeeReference
  })
} satisfies InboxV2OutboundReferenceRequestScope;

const replyTarget = Object.freeze({
  conversationId: fixtureConversationReference.id,
  messageId: "message:reply-target-1",
  expectedMessageRevision: "2"
});

const copySource = Object.freeze({
  conversationId: "conversation:copy-source-1",
  messageId: "message:copy-source-1",
  expectedMessageRevision: "3"
});

const rawOutboundContent = fixtureHuleeCreationCommit().content;
if (rawOutboundContent.state.kind !== "available") {
  throw new Error("Outbound reference fixture requires available content.");
}
const outboundContentDraft = inboxV2TimelineContentDraftSchema.parse({
  blocks: rawOutboundContent.state.blocks
});

const replyCommand: Extract<
  InboxV2OutboundReferenceCommand,
  { kind: "reply" }
> = {
  kind: "reply",
  tenantId: fixtureTenantId,
  conversationId: fixtureConversationReference.id,
  target: replyTarget,
  content: outboundContentDraft,
  routeIntent: {
    kind: "explicit_occurrence",
    occurrenceId: "source_occurrence:reply-target-1"
  },
  clientMutationId: "mutation:outbound-reference-reply-1"
};

const copyCommand: Extract<
  InboxV2OutboundReferenceCommand,
  { kind: "forward_content_copy" }
> = {
  kind: "forward_content_copy",
  tenantId: fixtureTenantId,
  conversationId: fixtureConversationReference.id,
  sources: [copySource],
  routeIntent: { kind: "automatic" },
  clientMutationId: "mutation:outbound-reference-copy-1"
};

const nativeCommand: Extract<
  InboxV2OutboundReferenceCommand,
  { kind: "forward_provider_native" }
> = {
  kind: "forward_provider_native",
  tenantId: fixtureTenantId,
  conversationId: fixtureConversationReference.id,
  source: {
    ...copySource,
    sourceOccurrenceId: "source_occurrence:native-source-1"
  },
  routeIntent: {
    kind: "explicit_occurrence",
    occurrenceId: "source_occurrence:native-source-1"
  },
  clientMutationId: "mutation:outbound-reference-native-1"
};

const contentFingerprintKey = new Uint8Array(32).fill(29);
const contentFingerprintKeyGeneration = "outbound-reference-content-key:g1";
const contentFingerprintValidUntil = "2026-08-18T09:00:00.000Z";

type TestServiceOptions = Omit<
  InboxV2OutboundReferenceCommandServiceOptions,
  "contentFingerprintAuthority" | "currentTime"
> &
  Partial<
    Pick<
      InboxV2OutboundReferenceCommandServiceOptions,
      "contentFingerprintAuthority" | "currentTime"
    >
  >;

function createService(options: TestServiceOptions) {
  return createUnboundService({
    contentFingerprintAuthority: fixtureContentFingerprintAuthority(),
    currentTime: () => fixtureT2,
    ...options
  });
}

describe("Inbox V2 outbound reference command", () => {
  it("keeps reply, content-copy and provider-native intent digests distinct", () => {
    const replyDigest =
      calculateInboxV2OutboundReferenceIntentDigest(replyCommand);
    const changedReplyTarget = calculateInboxV2OutboundReferenceIntentDigest({
      ...replyCommand,
      target: { ...replyCommand.target, messageId: "message:reply-target-2" }
    });
    const copyDigest = calculateInboxV2OutboundReferenceIntentDigest({
      ...copyCommand,
      clientMutationId: replyCommand.clientMutationId
    });
    const nativeDigest = calculateInboxV2OutboundReferenceIntentDigest({
      ...nativeCommand,
      clientMutationId: replyCommand.clientMutationId
    });

    expect(
      new Set([replyDigest, changedReplyTarget, copyDigest, nativeDigest])
    ).toHaveLength(4);
    expect(
      calculateInboxV2OutboundReferenceRouteIdempotencyToken(
        requestScope,
        replyCommand
      )
    ).not.toBe(
      calculateInboxV2OutboundReferenceRouteIdempotencyToken(
        requestScope,
        copyCommand
      )
    );
  });

  it.each([
    ["provider", "providerId"],
    ["binding", "sourceThreadBinding"],
    ["provider reference", "externalMessageReference"],
    ["quoted context", "quotedContextToken"]
  ])("rejects caller-injected %s authority", async (_label, injectedKey) => {
    const preparer = preparerReturning(null);
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(
      service.execute({
        ...replyCommand,
        [injectedKey]: `forged:${injectedKey}`
      } as unknown as InboxV2OutboundReferenceCommand)
    ).rejects.toMatchObject({ code: "validation.failed" });
    expect(preparer.lookupIdempotency).not.toHaveBeenCalled();
    expect(preparer.prepareNew).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("fails closed on an incomplete cross-conversation source disclosure plan", async () => {
    const preparer = preparerReturning({
      kind: "source_rejected",
      disclosureAuthorizationPlan: disclosurePlanFor(replyCommand),
      denialContext: {} as InboxV2SecurityDenialContext,
      errorCode: "message.source_unavailable"
    });
    const coordinator = coordinatorThatMustNotRun();
    const authorizationGate = allowGate();
    const service = createService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      authorizationGate
    });

    await expect(service.execute(copyCommand)).rejects.toThrow(
      "permission.denied"
    );
    expect(authorizationGate).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("fails closed on a forged source-rejection code", async () => {
    const preparer = preparerReturning({
      kind: "source_rejected",
      disclosureAuthorizationPlan: disclosurePlanFor(replyCommand),
      denialContext: {} as InboxV2SecurityDenialContext,
      errorCode: "message.source_deleted"
    } as unknown as InboxV2PreparedOutboundReferenceCommand);
    const authorizationGate = allowGate();
    const service = createService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator: coordinatorThatMustNotRun(),
      authorizationGate
    });

    await expect(service.execute(replyCommand)).rejects.toThrow(
      "permission.denied"
    );
    expect(authorizationGate).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant execution before idempotency lookup", async () => {
    const preparer = preparerReturning(null);
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(
      service.execute({ ...replyCommand, tenantId: "tenant:other" })
    ).rejects.toThrow("permission.denied");
    expect(preparer.lookupIdempotency).not.toHaveBeenCalled();
    expect(preparer.prepareNew).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("replays an exact committed reference command without preparation", async () => {
    const prepared = {
      kind: "committed_replay",
      requestHash: calculateInboxV2OutboundReferenceIntentDigest(replyCommand),
      scope: idempotencyScopeFor(replyCommand),
      status: appliedStatusFor(replyCommand, replyTarget.messageId)
    } satisfies InboxV2PreparedOutboundReferenceCommand;
    const preparer = preparerReturning(prepared);
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(replyCommand)).resolves.toMatchObject({
      outcome: "already_queued",
      messageId: replyTarget.messageId
    });
    expect(preparer.lookupIdempotency).toHaveBeenCalledOnce();
    expect(preparer.prepareNew).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("returns a stable idempotency conflict without source or route work", async () => {
    const prepared = {
      kind: "idempotency_conflict",
      scope: idempotencyScopeFor(copyCommand)
    } satisfies InboxV2PreparedOutboundReferenceCommand;
    const preparer = preparerReturning(prepared);
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(copyCommand)).resolves.toEqual({
      outcome: "idempotency_conflict"
    });
    expect(preparer.prepareNew).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it.each([
    "message.source_unavailable",
    "message.source_revision_stale",
    "message.source_ambiguous"
  ] as const)(
    "discloses %s only after destination read authorization",
    async (errorCode) => {
      const prepared = {
        kind: "source_rejected",
        disclosureAuthorizationPlan: disclosurePlanFor(replyCommand),
        denialContext: {} as InboxV2SecurityDenialContext,
        errorCode
      } satisfies InboxV2PreparedOutboundReferenceCommand;
      const preparer = preparerReturning(prepared);
      const coordinator = coordinatorThatMustNotRun();
      const authorizationGate = allowGate();
      const service = createService({
        requestScope,
        preparer,
        denialSink: denialSink(),
        coordinator,
        authorizationGate
      });

      await expect(service.execute(replyCommand)).resolves.toEqual({
        outcome: "source_rejected",
        errorCode
      });
      expect(authorizationGate).toHaveBeenCalledOnce();
      expect(
        coordinator.withAuthorizedAtomicMaterialization
      ).not.toHaveBeenCalled();
    }
  );

  it("fails closed when a preparer claims a selected native-forward route", async () => {
    const preparer = preparerReturning({
      kind: "selected",
      authorizationPlan: disclosurePlanFor(nativeCommand),
      denialContext: {} as InboxV2SecurityDenialContext,
      authorizedCommand: {},
      authorizedMutation: {},
      routeResolution: {},
      messageCreation: {},
      dispatchContentPlan: {}
    } as unknown as InboxV2PreparedOutboundReferenceCommand);
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(nativeCommand)).rejects.toMatchObject({
      code: "permission.denied"
    });
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("fails closed on native-forward absence or source rejection before disclosure", async () => {
    for (const prepared of [
      null,
      {
        kind: "source_rejected" as const,
        disclosureAuthorizationPlan: disclosurePlanFor(nativeCommand),
        denialContext: {} as InboxV2SecurityDenialContext,
        errorCode: "message.source_unavailable" as const
      }
    ]) {
      const authorizationGate = allowGate();
      const coordinator = coordinatorThatMustNotRun();
      const service = createService({
        requestScope,
        preparer: preparerReturning(prepared),
        denialSink: denialSink(),
        coordinator,
        authorizationGate
      });

      await expect(service.execute(nativeCommand)).rejects.toMatchObject({
        code: "permission.denied"
      });
      expect(authorizationGate).not.toHaveBeenCalled();
      expect(
        coordinator.withAuthorizedAtomicMaterialization
      ).not.toHaveBeenCalled();
    }
  });

  it("fails closed on a native-forward route rejection other than capability-missing", async () => {
    const fixture = rejectedNativeFixture("route.reference_unavailable");
    const authorizationGate = allowGate();
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator,
      authorizationGate
    });

    await expect(service.execute(fixture.command)).rejects.toMatchObject({
      code: "permission.denied"
    });
    expect(authorizationGate).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable reference", "route.reference_unavailable"],
    ["non-portable reference", "route.reference_nonportable"],
    ["ambiguous route", "route.ambiguous"]
  ] as const)(
    "returns stable %s rejection without writes",
    async (_label, errorCode) => {
      const fixture = rejectedReplyFixture(errorCode);
      const coordinator = coordinatorThatMustNotRun();
      const authorizationGate = allowGate();
      const service = createService({
        requestScope,
        preparer: preparerReturning(fixture.prepared),
        denialSink: denialSink(),
        coordinator,
        authorizationGate
      });

      await expect(service.execute(fixture.command)).resolves.toEqual({
        outcome: "route_rejected",
        errorCode,
        retryable: false
      });
      expect(authorizationGate).toHaveBeenCalledOnce();
      expect(
        coordinator.withAuthorizedAtomicMaterialization
      ).not.toHaveBeenCalled();
    }
  );

  it("publishes native forward as capability-missing until an operation plan exists", async () => {
    const fixture = rejectedNativeFixture();
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).resolves.toEqual({
      outcome: "route_rejected",
      errorCode: "route.capability_missing",
      retryable: false
    });
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it.each(["reply", "forward_content_copy"] as const)(
    "atomically materializes a closed %s route, Message, content plan and seal",
    async (kind) => {
      const fixture = selectedReferenceFixture(kind);
      const calls: string[] = [];
      const persistence = persistenceFixture(fixture, calls);
      const coordinator = appliedCoordinator(fixture, calls);
      const preparer: InboxV2OutboundReferenceCommandPreparer = {
        lookupIdempotency: vi.fn(async () => {
          calls.push("idempotency.lookup");
          return null;
        }),
        prepareNew: vi.fn(async () => {
          calls.push("reference.prepare");
          return fixture.prepared;
        })
      };
      const service = createService({
        requestScope,
        preparer,
        denialSink: denialSink(),
        coordinator,
        persistence,
        authorizationGate: allowGate()
      });

      await expect(service.execute(fixture.command)).resolves.toMatchObject({
        outcome: "queued",
        messageId: fixture.messageCreation.message.id,
        outboundRouteId: fixture.route.id,
        outboundDispatchId: fixture.dispatch.id
      });
      expect(calls).toEqual([
        "idempotency.lookup",
        "reference.prepare",
        "coordinator",
        "reply-authority",
        "route",
        "message.prepare",
        "content-plan",
        "message.seal"
      ]);
      expect(persistence.persistRoute).toHaveBeenCalledWith(
        expect.anything(),
        fixture.prepared.routeResolution
      );
      expect(persistence.persistContentPlan).toHaveBeenCalledWith(
        expect.anything(),
        fixture.prepared.dispatchContentPlan
      );
      expect(persistence.sealMessage).toHaveBeenCalledOnce();

      const permissionId =
        kind === "reply"
          ? "core:message.reply_external"
          : "core:message.forward_external";
      expect(
        fixture.prepared.authorizationPlan.requirements.some(
          (requirement) => requirement.permissionId === permissionId
        )
      ).toBe(true);
      expect(fixture.prepared.authorizedMutation.records.audit.actionId).toBe(
        kind === "reply"
          ? "core:message.reply"
          : "core:message.forward_content_copy"
      );
    }
  );

  it("rejects reply guards forged for another occurrence, reference or portability boundary", async () => {
    const forgeries: readonly Readonly<{
      label: string;
      mutate: (
        operation: ProviderReferenceReplyGuardOperationFixture
      ) => ProviderReferenceReplyGuardOperationFixture;
    }>[] = [
      {
        label: "occurrence",
        mutate: (operation) => ({
          ...operation,
          sourceOccurrenceResource: {
            ...operation.sourceOccurrenceResource,
            entityId:
              "source_occurrence:forged-reply-target" as typeof operation.sourceOccurrenceResource.entityId
          }
        })
      },
      {
        label: "reference",
        mutate: (operation) => ({
          ...operation,
          sourceReferenceResource: {
            ...operation.sourceReferenceResource,
            entityId:
              "external_message_reference:forged-reply-target" as typeof operation.sourceReferenceResource.entityId
          }
        })
      },
      {
        label: "portability",
        mutate: (operation) => ({
          ...operation,
          portability: "external_thread"
        })
      }
    ];

    for (const forgery of forgeries) {
      const fixture = selectedReferenceFixture("reply");
      const coordinator = coordinatorThatMustNotRun();
      const forged = {
        ...fixture.prepared,
        authorizationPlan: authorizationPlanWithReplyGuardMutation(
          fixture.prepared.authorizationPlan,
          forgery.mutate
        )
      } satisfies InboxV2PreparedOutboundReferenceCommand;
      const service = createService({
        requestScope,
        preparer: preparerReturning(forged),
        denialSink: denialSink(),
        coordinator,
        authorizationGate: allowGate()
      });

      await expect(
        service.execute(fixture.command),
        forgery.label
      ).rejects.toMatchObject({ code: "permission.denied" });
      expect(
        coordinator.withAuthorizedAtomicMaterialization,
        forgery.label
      ).not.toHaveBeenCalled();
    }
  });

  it("accepts the exact provider-global reply proof and rejects destination proof drift", async () => {
    const fixture = selectedReferenceFixture("reply", {
      replyPortability: "provider_global"
    });
    const calls: string[] = [];
    const exactService = createService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator: appliedCoordinator(fixture, calls),
      persistence: persistenceFixture(fixture, calls),
      authorizationGate: allowGate()
    });

    await expect(exactService.execute(fixture.command)).resolves.toMatchObject({
      outcome: "queued"
    });

    const coordinator = coordinatorThatMustNotRun();
    const forged = {
      ...fixture.prepared,
      authorizationPlan: authorizationPlanWithReplyGuardMutation(
        fixture.prepared.authorizationPlan,
        (operation) => {
          const proof = operation.providerGlobalProof;
          if (proof === null) {
            throw new Error("Expected provider-global reply proof fixture.");
          }
          return {
            ...operation,
            providerGlobalProof: {
              ...proof,
              destinationBindingResource: {
                ...proof.destinationBindingResource,
                entityId:
                  "source_thread_binding:forged-destination" as typeof proof.destinationBindingResource.entityId
              }
            }
          };
        }
      )
    } satisfies InboxV2PreparedOutboundReferenceCommand;
    const forgedService = createService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(forgedService.execute(fixture.command)).rejects.toMatchObject({
      code: "permission.denied"
    });
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("derives content-copy bytes and exact read proofs from server-loaded sources", () => {
    const fixture = selectedReferenceFixture("forward_content_copy");
    const intent = fixture.prepared.authorizedCommand.intent.payload;
    if (intent.kind !== "forward_content_copy") {
      throw new Error("Expected content-copy intent fixture.");
    }
    const sourceSnapshot = fixture.messageCreation.canonicalReferenceTargets[0];
    if (
      sourceSnapshot === undefined ||
      sourceSnapshot.message.content.stateKind !== "available"
    ) {
      throw new Error("Expected available source snapshot.");
    }

    expect("content" in fixture.command).toBe(false);
    expect(intent.content.blocks).toEqual(
      fixture.messageCreation.content.state.kind === "available"
        ? fixture.messageCreation.content.state.blocks
        : []
    );
    expect(intent.sourceReadProofs).toEqual([
      {
        conversation: sourceSnapshot.message.conversation,
        message: {
          tenantId: fixtureTenantId,
          kind: "message",
          id: copySource.messageId
        },
        expectedMessageRevision: copySource.expectedMessageRevision,
        timelineItem: {
          tenantId: fixtureTenantId,
          kind: "timeline_item",
          id: sourceSnapshot.timelineItem.id
        },
        expectedTimelineItemRevision: sourceSnapshot.timelineItem.revision,
        timelineContent: sourceSnapshot.message.content.content,
        expectedTimelineContentRevision:
          sourceSnapshot.message.content.contentRevision,
        sourceContentDigestSha256: rawOutboundContent.state.contentDigestSha256,
        visibilityBoundary: "external_work"
      }
    ]);
  });

  it("closes an attachment content-copy over a new destination anchor and exact source digest", () => {
    const fixture = selectedReferenceFixture("forward_content_copy");
    const payload = fixture.prepared.authorizedCommand.intent.payload;
    if (
      payload.kind !== "forward_content_copy" ||
      fixture.command.kind !== "forward_content_copy"
    ) {
      throw new Error("Expected content-copy fixture.");
    }
    const sourceAttachment = fixtureReference(
      "message_attachment",
      "message_attachment:api-copy-source-1"
    );
    const destinationAttachment = fixtureReference(
      "message_attachment",
      "message_attachment:api-copy-destination-1"
    );
    const exactPin = {
      file: fixtureReference("file", "file:api-copy-1"),
      fileRevision: "7",
      fileVersion: fixtureReference(
        "file_version",
        "file_version:api-copy-1-r7"
      ),
      objectVersion: fixtureReference(
        "file_object_version",
        "file_object_version:api-copy-1-r7-v1"
      )
    };
    const sourceBlock = inboxV2MessageContentBlockSchema.parse({
      blockKey: "file-1",
      kind: "file",
      attachment: {
        state: "ready",
        attachment: sourceAttachment,
        ...exactPin
      },
      displayName: "source.pdf"
    });
    if (sourceBlock.kind !== "file") {
      throw new Error("Expected source file block.");
    }
    const destinationBlock = inboxV2MessageContentBlockSchema.parse({
      ...sourceBlock,
      attachment: {
        ...sourceBlock.attachment,
        attachment: destinationAttachment
      }
    });
    const proof = payload.sourceReadProofs?.[0];
    if (proof === undefined) {
      throw new Error("Expected source proof.");
    }
    const intent = inboxV2TimelineCommandIntentSchema.parse({
      ...payload,
      content: { blocks: [destinationBlock] },
      sourceReadProofs: [
        {
          ...proof,
          sourceContentDigestSha256: calculateInboxV2MessageContentDigest([
            sourceBlock
          ]),
          attachmentCopies: [
            {
              blockKey: destinationBlock.blockKey,
              sourceAttachment,
              destinationAttachment
            }
          ]
        }
      ]
    });
    if (intent.kind !== "forward_content_copy") {
      throw new Error("Expected parsed content-copy intent.");
    }
    const outboundRoute = fixture.messageCreation.outboundRoute;
    if (outboundRoute === null) {
      throw new Error("Expected content-copy route.");
    }
    const routeAuthorizationTarget = {
      ...outboundRoute.conversationAuthorization.target,
      contentKindId: "core:file"
    };
    const attachmentRoute = {
      ...outboundRoute,
      contentKindId: "core:file",
      conversationAuthorization: {
        ...outboundRoute.conversationAuthorization,
        target: routeAuthorizationTarget
      },
      sourceAccountAuthorization: {
        ...outboundRoute.sourceAccountAuthorization,
        target: routeAuthorizationTarget
      }
    };
    const messageCreation = inboxV2MessageCreationCommitSchema.parse({
      ...fixture.messageCreation,
      content: {
        ...fixture.messageCreation.content,
        state: {
          kind: "available",
          blocks: [destinationBlock],
          contentDigestSha256: calculateInboxV2MessageContentDigest([
            destinationBlock
          ])
        }
      },
      outboundRoute: attachmentRoute,
      outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
        attachmentRoute as never,
        "core:message-file-send"
      )
    });

    expect(
      inboxV2ContentCopyProvenanceMatches(
        fixture.command.sources,
        intent,
        messageCreation
      )
    ).toBe(true);
    expect(
      inboxV2ContentCopyProvenanceMatches(
        fixture.command.sources,
        {
          ...intent,
          sourceReadProofs: intent.sourceReadProofs?.map((sourceProof) => ({
            ...sourceProof,
            attachmentCopies: []
          }))
        },
        messageCreation
      )
    ).toBe(false);

    if (destinationBlock.kind !== "file") {
      throw new Error("Expected destination file block.");
    }
    const forgedDestinationBlock = inboxV2MessageContentBlockSchema.parse({
      ...destinationBlock,
      attachment: {
        ...destinationBlock.attachment,
        objectVersion: fixtureReference(
          "file_object_version",
          "file_object_version:api-copy-forged"
        )
      }
    });
    const forgedMessageCreation = {
      ...messageCreation,
      content: {
        ...messageCreation.content,
        state: {
          kind: "available" as const,
          blocks: [forgedDestinationBlock],
          contentDigestSha256: calculateInboxV2MessageContentDigest([
            forgedDestinationBlock
          ])
        }
      }
    } as InboxV2MessageCreationCommit;
    expect(
      inboxV2ContentCopyProvenanceMatches(
        fixture.command.sources,
        {
          ...intent,
          content: { blocks: [forgedDestinationBlock] }
        },
        forgedMessageCreation
      )
    ).toBe(false);
  });

  it("rejects a content-copy snapshot whose Message belongs to another Conversation", async () => {
    const fixture = selectedReferenceFixture("forward_content_copy");
    const sourceSnapshot = fixture.messageCreation.canonicalReferenceTargets[0];
    if (sourceSnapshot === undefined) {
      throw new Error("Expected one content-copy source snapshot.");
    }
    const inaccessibleConversation = fixtureReference(
      "conversation",
      "conversation:inaccessible-copy-source"
    );
    const forged = {
      ...fixture.prepared,
      messageCreation: {
        ...fixture.messageCreation,
        canonicalReferenceTargets: [
          {
            message: {
              ...sourceSnapshot.message,
              conversation: inaccessibleConversation
            },
            timelineItem: {
              ...sourceSnapshot.timelineItem,
              conversation: inaccessibleConversation
            }
          }
        ]
      }
    } as unknown as InboxV2PreparedOutboundReferenceCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(copyCommand)).rejects.toThrow();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("rejects an external content-copy closure stamped with an internal source boundary", async () => {
    const fixture = selectedReferenceFixture("forward_content_copy");
    const payload = fixture.prepared.authorizedCommand.intent.payload;
    if (payload.kind !== "forward_content_copy") {
      throw new Error("Expected content-copy intent fixture.");
    }
    const forged = {
      ...fixture.prepared,
      authorizedCommand: {
        ...fixture.prepared.authorizedCommand,
        intent: {
          ...fixture.prepared.authorizedCommand.intent,
          payload: {
            ...payload,
            sourceReadProofs: payload.sourceReadProofs?.map((proof) => ({
              ...proof,
              visibilityBoundary: "internal" as const
            }))
          }
        }
      }
    } as unknown as InboxV2PreparedOutboundReferenceCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(copyCommand)).rejects.toThrow();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("rejects forged prepared content that is not the proven source identity copy", async () => {
    const fixture = selectedReferenceFixture("forward_content_copy");
    const payload = fixture.prepared.authorizedCommand.intent.payload;
    const availableContent = fixture.messageCreation.content.state;
    if (
      payload.kind !== "forward_content_copy" ||
      availableContent.kind !== "available" ||
      availableContent.blocks[0]?.kind !== "text"
    ) {
      throw new Error("Expected text content-copy fixture.");
    }
    const forgedBlocks = [
      { ...availableContent.blocks[0], text: "forged destination content" }
    ];
    const forgedContent = {
      ...fixture.messageCreation.content,
      state: {
        kind: "available" as const,
        blocks: forgedBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(forgedBlocks)
      }
    };
    const forgedMessageCreation = {
      ...fixture.messageCreation,
      content: forgedContent
    } as InboxV2MessageCreationCommit;
    const forged = {
      ...fixture.prepared,
      authorizedCommand: {
        ...fixture.prepared.authorizedCommand,
        intent: {
          ...fixture.prepared.authorizedCommand.intent,
          payload: {
            ...payload,
            content: { blocks: forgedBlocks }
          }
        }
      },
      messageCreation: forgedMessageCreation,
      dispatchContentPlan: dispatchContentPlanFor(forgedMessageCreation)
    } as unknown as InboxV2PreparedOutboundReferenceCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(copyCommand)).rejects.toThrow();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it.each([
    [
      "TimelineContent reference",
      (proof: ContentCopySourceReadProofFixture) => ({
        ...proof,
        timelineContent: {
          ...proof.timelineContent,
          id: "timeline_content:forged-copy-source"
        }
      })
    ],
    [
      "TimelineContent revision",
      (proof: ContentCopySourceReadProofFixture) => ({
        ...proof,
        expectedTimelineContentRevision: "999"
      })
    ],
    [
      "TimelineContent digest",
      (proof: ContentCopySourceReadProofFixture) => ({
        ...proof,
        sourceContentDigestSha256: "f".repeat(64)
      })
    ],
    [
      "TimelineItem reference",
      (proof: ContentCopySourceReadProofFixture) => ({
        ...proof,
        timelineItem: {
          ...proof.timelineItem,
          id: "timeline_item:forged-copy-source"
        }
      })
    ],
    [
      "TimelineItem revision",
      (proof: ContentCopySourceReadProofFixture) => ({
        ...proof,
        expectedTimelineItemRevision: "999"
      })
    ]
  ] as const)("rejects a forged source %s proof", async (_label, mutate) => {
    const fixture = selectedReferenceFixture("forward_content_copy");
    const payload = fixture.prepared.authorizedCommand.intent.payload;
    if (payload.kind !== "forward_content_copy") {
      throw new Error("Expected content-copy intent fixture.");
    }
    const proof = payload.sourceReadProofs?.[0];
    if (proof === undefined) {
      throw new Error("Expected content-copy source proof.");
    }
    const forged = {
      ...fixture.prepared,
      authorizedCommand: {
        ...fixture.prepared.authorizedCommand,
        intent: {
          ...fixture.prepared.authorizedCommand.intent,
          payload: {
            ...payload,
            sourceReadProofs: [mutate(proof)]
          }
        }
      }
    } as unknown as InboxV2PreparedOutboundReferenceCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(copyCommand)).rejects.toThrow();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("keeps a group reply on the binding destination and exact opaque quoted token", async () => {
    const fixture = selectedReferenceFixture("reply");
    const calls: string[] = [];
    const persistence = persistenceFixture(fixture, calls);
    const service = createService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator: appliedCoordinator(fixture, calls),
      persistence,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "queued"
    });
    const committedResolution = vi.mocked(persistence.persistRoute).mock
      .calls[0]?.[1];
    if (committedResolution === undefined) {
      throw new Error("Expected committed group route.");
    }
    const committedRoute = committedResolution.route;
    expect(committedRoute?.routeDescriptor).toMatchObject({
      destinationKindId: "module:synthetic:group-peer",
      destinationSubject: "Group-1"
    });
    expect(
      committedRoute?.referenceContext.kind === "external_message"
        ? committedRoute.referenceContext.resolutionDecision
            .occurrenceDescriptor.providerReferences
        : []
    ).toEqual([
      {
        kindId: "module:synthetic:message-id",
        subject: "provider-quoted-group-message-42"
      }
    ]);
    expect(JSON.stringify(committedRoute?.routeDescriptor)).not.toContain(
      "sender-private-peer"
    );
  });
});

function selectedReferenceFixture(
  kind: "reply" | "forward_content_copy",
  options: {
    readonly replyPortability?:
      | "binding_only"
      | "external_thread"
      | "provider_global";
  } = {}
) {
  const command = kind === "reply" ? replyCommand : copyCommand;
  const baseTarget =
    kind === "reply" ? replyTargetSnapshot() : copySourceSnapshot();
  const target =
    kind === "reply" && options.replyPortability !== undefined
      ? {
          ...baseTarget,
          sourceOccurrence: {
            ...baseTarget.sourceOccurrence,
            referencePortability: {
              ...baseTarget.sourceOccurrence.referencePortability,
              kind: options.replyPortability,
              decisionStrength:
                options.replyPortability === "binding_only"
                  ? ("safe_default" as const)
                  : ("authoritative" as const)
            }
          }
        }
      : baseTarget;
  const referenceContext =
    kind === "reply"
      ? {
          kind: "reply" as const,
          target: {
            state: "resolved_external" as const,
            canonical: {
              conversation: target.message.conversation,
              message: fixtureReference("message", replyTarget.messageId),
              timelineItem: fixtureReference(
                "timeline_item",
                target.timelineItem.id
              ),
              messageRevision: replyTarget.expectedMessageRevision
            },
            external: {
              externalMessageReference:
                target.externalMessageReferenceReference,
              sourceOccurrence: target.sourceOccurrenceReference
            }
          }
        }
      : {
          kind: "forward_content_copy" as const,
          sources: [
            {
              conversation: target.message.conversation,
              message: fixtureReference("message", copySource.messageId),
              timelineItem: fixtureReference(
                "timeline_item",
                target.timelineItem.id
              ),
              messageRevision: copySource.expectedMessageRevision
            }
          ]
        };
  const rawRoute =
    kind === "reply"
      ? fixtureExternalTargetRoute(
          "core:message.reply",
          "core:message.reply_external",
          {
            occurrence: target.sourceOccurrence as ReturnType<
              typeof fixtureOccurrence
            >,
            externalMessageReference: target.externalMessageReferenceReference
          }
        )
      : fixtureRoute();
  const operationId =
    kind === "reply"
      ? "core:message.reply"
      : "core:message.forward_content_copy";
  const permissionId =
    kind === "reply"
      ? "core:message.reply_external"
      : "core:message.forward_external";
  const referenceTarget =
    rawRoute.referenceContext.kind === "external_message"
      ? {
          kind: "external_message" as const,
          externalMessageReference:
            rawRoute.referenceContext.externalMessageReference,
          sourceOccurrence: rawRoute.referenceContext.sourceOccurrence
        }
      : { kind: "none" as const };
  const authorizationTarget = {
    ...rawRoute.conversationAuthorization.target,
    operationId,
    contentKindId: "core:text",
    referenceTarget
  };
  const route = {
    ...rawRoute,
    operationId,
    contentKindId: "core:text",
    requiredConversationPermissionId: permissionId,
    conversationAuthorization: {
      ...rawRoute.conversationAuthorization,
      target: authorizationTarget,
      requiredPermissionId: permissionId,
      matchedPermissionIds: [permissionId]
    },
    sourceAccountAuthorization: {
      ...rawRoute.sourceAccountAuthorization,
      target: authorizationTarget
    },
    idempotencyToken: calculateInboxV2OutboundReferenceRouteIdempotencyToken(
      requestScope,
      command
    )
  };
  const rawMessageCreation = fixtureHuleeCreationCommit();
  const rawActor = rawMessageCreation.message.appActor;
  if (rawActor?.kind !== "employee") {
    throw new Error("Reference fixture requires an Employee actor.");
  }
  const routeActor = {
    ...rawActor,
    authorizationEpoch: route.authorizationEpoch
  };
  const messageCreation = inboxV2MessageCreationCommitSchema.parse({
    ...rawMessageCreation,
    message: {
      ...rawMessageCreation.message,
      appActor: routeActor,
      referenceContext
    },
    initialRevision: {
      ...rawMessageCreation.initialRevision,
      actionAttribution: {
        ...rawMessageCreation.initialRevision.actionAttribution,
        appActor: routeActor
      }
    },
    canonicalReferenceTargets: [
      { message: target.message, timelineItem: target.timelineItem }
    ],
    externalReferenceTargets:
      kind === "reply"
        ? [
            {
              externalMessageReference: target.externalMessageReference,
              sourceOccurrence: target.sourceOccurrence
            }
          ]
        : [],
    outboundRoute: route,
    outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
      route as never,
      "core:message-text-send"
    ),
    routeConsumption:
      rawMessageCreation.routeConsumption === null
        ? null
        : {
            ...rawMessageCreation.routeConsumption,
            idempotencyToken: route.idempotencyToken
          }
  });
  const parsedRoute = messageCreation.outboundRoute;
  const dispatch = messageCreation.outboundDispatch;
  if (parsedRoute === null || dispatch === null) {
    throw new Error("Reference fixture requires route and dispatch.");
  }
  const routeResolution = materializeInboxV2OutboundRouteResolutionCommit(
    routeInputFor(parsedRoute),
    { routeId: parsedRoute.id, selectedAt: parsedRoute.selection.selectedAt }
  );
  if (JSON.stringify(routeResolution.route) !== JSON.stringify(parsedRoute)) {
    throw new Error("Reference route fixture did not round-trip exactly.");
  }
  const decisions = authorizationDecisionsFor(
    parsedRoute,
    permissionId,
    kind === "reply"
      ? [fixtureConversationReference.id]
      : [copySource.conversationId]
  );
  const requestHash = calculateInboxV2OutboundReferenceIntentDigest(command);
  const routeAuthorization = {
    conversation: parsedRoute.conversation,
    outboundRoute: fixtureReference("outbound_route", parsedRoute.id),
    routeRevision: parsedRoute.revision,
    sourceAccount: parsedRoute.sourceAccount,
    sourceThreadBinding: parsedRoute.sourceThreadBinding,
    bindingFence: parsedRoute.bindingFence
  };
  const replyAuthority = {
    kind: "no_work_item" as const,
    appActor: messageCreation.message.appActor,
    conversation: parsedRoute.conversation,
    workItemSlot: fixtureReference(
      "conversation_work_item_slot",
      `conversation_work_item_slot:${parsedRoute.conversation.id}`
    ),
    expectedSlotRevision: "1",
    intakeDecisionRevision: "1"
  };
  const authored = {
    tenantId: fixtureTenantId,
    conversation: parsedRoute.conversation,
    authorParticipant: messageCreation.message.authorParticipant,
    appActor: messageCreation.message.appActor,
    automationCausation: null,
    occurredAt: messageCreation.initialRevision.occurredAt
  };
  const payload =
    kind === "reply"
      ? {
          kind: "reply_external" as const,
          ...authored,
          content:
            replyCommand.kind === "reply" ? replyCommand.content : neverValue(),
          externalMessageReference: target.externalMessageReferenceReference,
          sourceOccurrence: target.sourceOccurrenceReference,
          outboundRoute: fixtureReference("outbound_route", parsedRoute.id),
          routeAuthorization,
          replyAuthority,
          referenceContext
        }
      : {
          kind: "forward_content_copy" as const,
          ...authored,
          content: outboundContentDraft,
          replyAuthority,
          referenceContext,
          sourceReadProofs: [
            {
              conversation: target.message.conversation,
              message: fixtureReference("message", copySource.messageId),
              expectedMessageRevision: copySource.expectedMessageRevision,
              timelineItem: fixtureReference(
                "timeline_item",
                target.timelineItem.id
              ),
              expectedTimelineItemRevision: target.timelineItem.revision,
              timelineContent: target.message.content.content,
              expectedTimelineContentRevision:
                target.message.content.contentRevision,
              sourceContentDigestSha256:
                rawOutboundContent.state.contentDigestSha256,
              visibilityBoundary: "external_work" as const
            }
          ],
          destination: {
            kind: "external" as const,
            outboundRoute: fixtureReference("outbound_route", parsedRoute.id),
            routeAuthorization
          }
        };
  const authorizedCommand = inboxV2AuthorizedCommandSchema.parse({
    tenantId: fixtureTenantId,
    commandId: "command:outbound-reference-1",
    request: {
      tenantId: fixtureTenantId,
      requestId: "request:outbound-reference-1",
      clientMutationId: command.clientMutationId,
      commandTypeId: "core:timeline.command",
      requestHash
    },
    principal: {
      kind: "employee",
      employee: fixtureEmployeeReference,
      authorization: authorizationSnapshot(decisions)
    },
    authorizationDecisionRefs: decisions,
    intent: {
      schemaId: "core:inbox-v2.timeline-command-intent",
      schemaVersion: "v1",
      payload
    },
    authorizedAt: fixtureT2
  });
  const authorizationPlan = authorizationPlanFor(
    parsedRoute,
    decisions,
    kind,
    kind === "reply" ? [replyTarget] : [copySource]
  );
  const authorizedMutation = authorizedMutationFor({
    command,
    messageCreation,
    route: parsedRoute,
    dispatch,
    decisions,
    requestHash,
    actionId:
      kind === "reply"
        ? "core:message.reply"
        : "core:message.forward_content_copy",
    actionDecisionId:
      kind === "reply"
        ? "authorization-decision:message-reply-external"
        : "authorization-decision:message-forward-external"
  });
  const prepared = {
    kind: "selected",
    authorizationPlan,
    denialContext: {} as InboxV2SecurityDenialContext,
    authorizedCommand,
    authorizedMutation,
    routeResolution,
    messageCreation,
    dispatchContentPlan: dispatchContentPlanFor(messageCreation)
  } satisfies Extract<
    InboxV2PreparedOutboundReferenceCommand,
    { kind: "selected" }
  >;
  return {
    command,
    route: parsedRoute,
    dispatch,
    messageCreation,
    prepared,
    authorizedMutation
  };
}

function neverValue(): never {
  throw new Error("Unreachable fixture branch.");
}

function replyTargetSnapshot() {
  const sourceOccurrenceReference = fixtureReference(
    "source_occurrence",
    "source_occurrence:reply-target-1"
  );
  const externalMessageReferenceReference = fixtureReference(
    "external_message_reference",
    "external_message_reference:reply-target-1"
  );
  const timelineItemReference = fixtureReference(
    "timeline_item",
    "timeline_item:reply-target-1"
  );
  const baseOccurrence = fixtureOccurrence({
    occurrenceId: sourceOccurrenceReference.id,
    externalSubject: "provider-quoted-group-message-42"
  });
  const sourceOccurrence = {
    ...baseOccurrence,
    resolution: {
      state: "resolved" as const,
      externalMessageReference: externalMessageReferenceReference
    }
  };
  const externalMessageReference = fixtureExternalReference(sourceOccurrence, {
    id: externalMessageReferenceReference.id,
    message: fixtureReference("message", replyTarget.messageId),
    timelineItem: timelineItemReference
  });
  const message = fixtureMessage("source", rawOutboundContent, {
    id: replyTarget.messageId,
    timelineItem: timelineItemReference,
    origin: {
      kind: "source_originated",
      originOccurrence: sourceOccurrenceReference,
      direction: "inbound",
      claimAtOccurrence: null
    },
    revision: replyTarget.expectedMessageRevision
  });
  const timelineItem = fixtureTimelineItem("external", {
    id: timelineItemReference.id,
    subject: {
      kind: "message",
      message: fixtureReference("message", replyTarget.messageId),
      messageRevision: replyTarget.expectedMessageRevision
    },
    revision: replyTarget.expectedMessageRevision
  });
  return {
    message,
    timelineItem,
    sourceOccurrence,
    externalMessageReference,
    sourceOccurrenceReference,
    externalMessageReferenceReference
  };
}

function copySourceSnapshot() {
  const conversation = fixtureReference(
    "conversation",
    copySource.conversationId
  );
  const timelineItemReference = fixtureReference(
    "timeline_item",
    "timeline_item:copy-source-1"
  );
  const message = fixtureMessage("source", rawOutboundContent, {
    id: copySource.messageId,
    conversation,
    timelineItem: timelineItemReference,
    revision: copySource.expectedMessageRevision
  });
  const timelineItem = fixtureTimelineItem("external", {
    id: timelineItemReference.id,
    conversation,
    subject: {
      kind: "message",
      message: fixtureReference("message", copySource.messageId),
      messageRevision: copySource.expectedMessageRevision
    },
    revision: copySource.expectedMessageRevision
  });
  const sourceOccurrence = fixtureOccurrence();
  return {
    message,
    timelineItem,
    sourceOccurrence,
    externalMessageReference: fixtureExternalReference(sourceOccurrence),
    sourceOccurrenceReference: fixtureReference(
      "source_occurrence",
      sourceOccurrence.id
    ),
    externalMessageReferenceReference: fixtureReference(
      "external_message_reference",
      "external_message_reference:unused-copy-source"
    )
  };
}

function routeInputFor(
  route: InboxV2OutboundRoute
): InboxV2OutboundRouteResolutionInput {
  const candidate = {
    tenantId: route.tenantId,
    conversation: route.conversation,
    externalThread: route.externalThread,
    sourceThreadBinding: route.sourceThreadBinding,
    sourceAccount: route.sourceAccount,
    sourceConnection: route.sourceConnection,
    operationId: route.operationId,
    contentKindId: route.contentKindId,
    authorizationEpoch: route.authorizationEpoch,
    bindingFence: route.bindingFence,
    adapterContract: route.adapterContract,
    routeDescriptor: route.routeDescriptor,
    conversationAuthorization: route.conversationAuthorization,
    sourceAccountAuthorization: route.sourceAccountAuthorization,
    eligibility: { state: "eligible" as const },
    runtimeObservation: route.runtimeObservationAtResolution
  };
  return inboxV2OutboundRouteResolutionInputSchema.parse({
    tenantId: route.tenantId,
    principal: route.principal,
    conversation: route.conversation,
    externalThread: route.externalThread,
    operationId: route.operationId,
    contentKindId: route.contentKindId,
    authorizationEpoch: route.authorizationEpoch,
    intent: route.selection.intent,
    referenceContext: route.referenceContext,
    routePolicy: {
      tenantId: route.tenantId,
      id: route.routePolicy.id,
      conversation: route.conversation,
      externalThread: route.externalThread,
      operationId: route.operationId,
      contentKindId: route.contentKindId,
      policyId: "core:ordered-explicit-policy",
      requiredConversationPermissionId: route.requiredConversationPermissionId,
      preferredBinding: null,
      fallback: { kind: "none" },
      revision: route.routePolicyRevision,
      createdAt: fixtureT0,
      updatedAt: fixtureT0
    },
    candidates: {
      tenantId: route.tenantId,
      conversation: route.conversation,
      externalThread: route.externalThread,
      operationId: route.operationId,
      contentKindId: route.contentKindId,
      authorizationEpoch: route.authorizationEpoch,
      routePolicy: route.routePolicy,
      routePolicyRevision: route.routePolicyRevision,
      automaticCompatibleEligibleCount: 1,
      explicitTarget:
        route.selection.intent.kind === "automatic" ? null : candidate,
      preferredCandidate: null,
      soleEligibleCandidate: candidate,
      fallbackCandidate: null,
      zeroCandidateError: null,
      snapshotToken: route.selection.candidateSnapshotToken,
      loadedByTrustedServiceId: "core:route-resolver",
      loadedAt: fixtureT1,
      notAfter: route.selection.candidateSnapshotNotAfter
    },
    mutationToken: route.mutationToken,
    idempotencyToken: route.idempotencyToken,
    correlationToken: route.correlationToken,
    requestedAt: route.selection.selectedAt
  });
}

function rejectedReplyFixture(
  errorCode:
    | "route.reference_unavailable"
    | "route.reference_nonportable"
    | "route.ambiguous"
) {
  const selected = selectedReferenceFixture("reply");
  const base = selected.prepared.routeResolution.input;
  const automatic = errorCode === "route.ambiguous";
  const command: Extract<InboxV2OutboundReferenceCommand, { kind: "reply" }> =
    automatic
      ? { ...replyCommand, routeIntent: { kind: "automatic" } }
      : replyCommand;
  const explicit = base.candidates.explicitTarget;
  if (!automatic && explicit === null) {
    throw new Error("Rejected reply fixture requires explicit target.");
  }
  const input = inboxV2OutboundRouteResolutionInputSchema.parse({
    ...base,
    intent: automatic ? { kind: "automatic" } : base.intent,
    idempotencyToken: calculateInboxV2OutboundReferenceRouteIdempotencyToken(
      requestScope,
      command
    ),
    candidates: automatic
      ? {
          ...base.candidates,
          automaticCompatibleEligibleCount: 2,
          explicitTarget: null,
          preferredCandidate: null,
          soleEligibleCandidate: null,
          fallbackCandidate: null,
          zeroCandidateError: null
        }
      : {
          ...base.candidates,
          automaticCompatibleEligibleCount: 0,
          explicitTarget: {
            ...explicit,
            eligibility: {
              state: "ineligible",
              error: routeError(errorCode)
            }
          },
          preferredCandidate: null,
          soleEligibleCandidate: null,
          fallbackCandidate: null,
          zeroCandidateError: routeError(errorCode)
        }
  });
  const routeResolution = materializeInboxV2OutboundRouteResolutionCommit(
    input,
    {
      routeId: "outbound_route:rejected-reply",
      selectedAt: fixtureT2
    }
  );
  if (
    routeResolution.result.kind !== "failed" ||
    routeResolution.result.error.code !== errorCode
  ) {
    throw new Error("Rejected reply route produced the wrong stable error.");
  }
  return {
    command,
    prepared: {
      kind: "route_rejected",
      disclosureAuthorizationPlan: disclosurePlanFor(command),
      denialContext: {} as InboxV2SecurityDenialContext,
      routeResolution
    } satisfies InboxV2PreparedOutboundReferenceCommand
  };
}

function rejectedNativeFixture(
  errorCode:
    | "route.capability_missing"
    | "route.reference_unavailable" = "route.capability_missing"
) {
  const occurrence = fixtureOccurrence({
    occurrenceId: nativeCommand.source.sourceOccurrenceId,
    externalSubject: "provider-native-source-1"
  });
  const externalMessageReference = fixtureReference(
    "external_message_reference",
    "external_message_reference:native-source-1"
  );
  const resolvedOccurrence = {
    ...occurrence,
    resolution: {
      state: "resolved" as const,
      externalMessageReference
    }
  };
  const rawRoute = fixtureExternalTargetRoute(
    "core:message.forward_provider_native",
    "core:message.forward_external",
    { occurrence: resolvedOccurrence, externalMessageReference }
  );
  const route = {
    ...rawRoute,
    idempotencyToken: calculateInboxV2OutboundReferenceRouteIdempotencyToken(
      requestScope,
      nativeCommand
    )
  } as unknown as InboxV2OutboundRoute;
  const base = routeInputFor(route);
  const explicit = base.candidates.explicitTarget;
  if (explicit === null) {
    throw new Error("Rejected native fixture requires explicit target.");
  }
  const error = routeError(errorCode);
  const input = inboxV2OutboundRouteResolutionInputSchema.parse({
    ...base,
    candidates: {
      ...base.candidates,
      automaticCompatibleEligibleCount: 0,
      explicitTarget: {
        ...explicit,
        eligibility: { state: "ineligible", error }
      },
      preferredCandidate: null,
      soleEligibleCandidate: null,
      fallbackCandidate: null,
      zeroCandidateError: error
    }
  });
  const routeResolution = materializeInboxV2OutboundRouteResolutionCommit(
    input,
    {
      routeId: "outbound_route:rejected-native",
      selectedAt: fixtureT2
    }
  );
  if (
    routeResolution.result.kind !== "failed" ||
    routeResolution.result.error.code !== errorCode
  ) {
    throw new Error(`Native route must fail with ${errorCode}.`);
  }
  return {
    command: nativeCommand,
    prepared: {
      kind: "route_rejected",
      disclosureAuthorizationPlan: disclosurePlanFor(nativeCommand),
      denialContext: {} as InboxV2SecurityDenialContext,
      routeResolution
    } satisfies InboxV2PreparedOutboundReferenceCommand
  };
}

function routeError(
  code:
    | "route.reference_unavailable"
    | "route.reference_nonportable"
    | "route.capability_missing"
) {
  return {
    code,
    retryability: "terminal" as const,
    diagnostic: {
      codeId: `core:${code.replaceAll(".", "-")}`,
      retryable: false,
      correlationToken: `correlation:${code.replaceAll(".", "-")}`,
      safeOperatorHintId: null
    }
  };
}

function authorizationDecisionsFor(
  route: InboxV2OutboundRoute,
  actionPermissionId:
    | "core:message.reply_external"
    | "core:message.forward_external",
  sourceConversationIds: readonly string[]
): readonly InboxV2AuthorizationDecisionReference[] {
  const decision = (
    id: string,
    permissionId: string,
    resource: ReturnType<typeof entityKey>,
    resourceScopeId = "core:conversation"
  ) =>
    inboxV2AuthorizationDecisionReferenceSchema.parse({
      tenantId: fixtureTenantId,
      id,
      authorizationEpoch: route.authorizationEpoch,
      principal: {
        kind: "employee",
        employee: fixtureEmployeeReference
      },
      permissionId,
      resourceScopeId,
      resource,
      resourceAccessRevision: "1",
      decisionRevision: "1",
      decisionHash: hash(id),
      outcome: "allowed",
      decidedAt: fixtureT1,
      notAfter: fixtureT4
    });
  const destination = entityKey("core:conversation", route.conversation.id);
  const decisions = [
    decision(
      "authorization-decision:conversation-read",
      "core:conversation.read",
      destination
    ),
    decision(
      actionPermissionId === "core:message.reply_external"
        ? "authorization-decision:message-reply-external"
        : "authorization-decision:message-forward-external",
      actionPermissionId,
      destination
    ),
    decision(
      "authorization-decision:source-account-use",
      "core:source_account.use",
      entityKey("core:source-account", route.sourceAccount.id),
      "core:source-account"
    )
  ];
  for (const sourceConversationId of new Set(sourceConversationIds)) {
    if (sourceConversationId === route.conversation.id) continue;
    decisions.push(
      decision(
        `authorization-decision:source-conversation-read:${sourceConversationId}`,
        "core:conversation.read",
        entityKey("core:conversation", sourceConversationId)
      )
    );
  }
  return decisions;
}

function authorizationSnapshot(
  decisions: readonly InboxV2AuthorizationDecisionReference[]
) {
  const resources = new Map(
    decisions.map((decision) => [
      `${decision.resource.entityTypeId}:${decision.resource.entityId}`,
      {
        resource: decision.resource,
        accessRevision: decision.resourceAccessRevision
      }
    ])
  );
  return {
    tenantId: fixtureTenantId,
    employee: fixtureEmployeeReference,
    value: "authorization:route-epoch-1",
    dependencies: {
      tenantRbacRevision: "1",
      employeeAccessRevision: "1",
      employeeInboxRelationRevision: "1",
      sharedAccessRevision: "1",
      resourceDependencies: [...resources.values()].sort((left, right) =>
        compareCanonicalStrings(
          `${left.resource.entityTypeId}:${left.resource.entityId}`,
          `${right.resource.entityTypeId}:${right.resource.entityId}`
        )
      ),
      temporalBoundaryDigest: hash("reference-temporal")
    },
    evaluatedAt: fixtureT1,
    notAfter: fixtureT4,
    nextAuthorizationBoundary: null
  };
}

function authorizationPlanFor(
  route: InboxV2OutboundRoute,
  decisions: readonly InboxV2AuthorizationDecisionReference[],
  kind: "reply" | "forward_content_copy",
  sources: readonly {
    conversationId: string;
    messageId: string;
    expectedMessageRevision: string;
  }[]
): InboxV2AuthorizationPlanInput {
  const destination = entityKey("core:conversation", route.conversation.id);
  const sourceAccount = entityKey(
    "core:source-account",
    route.sourceAccount.id
  );
  const binding = entityKey(
    "core:source-thread-binding",
    route.sourceThreadBinding.id
  );
  const externalThread = entityKey(
    "core:external-thread",
    route.externalThread.id
  );
  const actionPermissionId =
    kind === "reply"
      ? "core:message.reply_external"
      : "core:message.forward_external";
  const actionDecision = decisions.find(
    (decision) => decision.permissionId === actionPermissionId
  );
  if (actionDecision === undefined) throw new Error("Action decision fixture.");
  const operation =
    kind === "reply"
      ? replyGuardOperationFor(route)
      : {
          kind: "forward" as const,
          mode: "copy" as const,
          sourceContentBoundary: "external" as const,
          sourceReadRequirementId: `requirement:authorization-decision:source-conversation-read:${sources[0]?.conversationId}`,
          sourceReadResource: entityKey(
            "core:conversation",
            sources[0]?.conversationId ?? "conversation:missing"
          ),
          sourceTimelineItemResource: entityKey(
            "core:timeline-item",
            "timeline_item:copy-source-1"
          ),
          timelineItemRelationResource: entityKey(
            "core:timeline-item-conversation-relation",
            "timeline_item_conversation_relation:copy-source-1"
          ),
          timelineItemRelationItemResource: entityKey(
            "core:timeline-item",
            "timeline_item:copy-source-1"
          ),
          timelineItemConversationResource: entityKey(
            "core:conversation",
            sources[0]?.conversationId ?? "conversation:missing"
          ),
          timelineItemRelationRevisionChecks: [
            { kind: "relation" as const, expected: "1", actual: "1" }
          ],
          sourceResourceRevisionChecks: [
            {
              resource: entityKey(
                "core:timeline-item-conversation-relation",
                "timeline_item_conversation_relation:copy-source-1"
              ),
              expected: "1",
              actual: "1"
            },
            {
              resource: entityKey(
                "core:timeline-item",
                "timeline_item:copy-source-1"
              ),
              expected: "1",
              actual: "1"
            },
            {
              resource: entityKey(
                "core:conversation",
                sources[0]?.conversationId ?? "conversation:missing"
              ),
              expected: "1",
              actual: "1"
            }
          ],
          sourceOccurrenceResource: null,
          occurrenceTimelineItemResource: null,
          occurrenceReferenceResource: null,
          occurrenceBindingResource: null,
          sourceReferenceResource: null,
          referenceTimelineItemResource: null,
          referenceBindingResource: null,
          sourceBindingResource: null,
          bindingConversationResource: null,
          bindingExternalThreadResource: null,
          bindingSourceAccountResource: null,
          sourceAccountRequirementId: null,
          sourceExternalThreadResource: null,
          portability: "not_applicable" as const,
          providerGlobalProof: null,
          occurrenceRevisionChecks: [],
          nativeResourceRevisionChecks: []
        };
  const guard = {
    profileId: "core:rbac.guard.external_route" as const,
    authorizationMode: "operation" as const,
    multiSendDestinationAuthority: null,
    operation,
    targetResource: destination,
    conversationResource: destination,
    bindingResource: binding,
    externalThreadResource: externalThread,
    bindingConversationResource: destination,
    bindingExternalThreadResource: externalThread,
    bindingSourceAccountResource: sourceAccount,
    routeRevisionChecks: [],
    conversationRequirementId:
      "requirement:authorization-decision:conversation-read",
    sourceAccountRequirementId:
      "requirement:authorization-decision:source-account-use",
    workRequirementId: null,
    overrideRequirementId: null,
    claimRequirementId: null,
    sourceAccountId: route.sourceAccount.id,
    bindingSourceAccountId: route.sourceAccount.id,
    bindingGeneration: route.bindingFence.bindingGeneration,
    expectedBindingGeneration: route.bindingFence.bindingGeneration,
    bindingState: "active" as const,
    capabilityState: "supported" as const,
    capabilityId:
      kind === "reply"
        ? "core:capability.message.reply"
        : "core:capability.message.forward_content_copy",
    capabilityManifestResource: entityKey(
      "core:provider-capability-manifest",
      `provider_capability_manifest:${kind}`
    ),
    capabilityManifestSourceAccountResource: sourceAccount,
    capabilityManifestBindingResource: binding,
    capabilityRevisionChecks: [],
    capabilityNotAfter: fixtureT4,
    actorRelation: "conversation_collaborator" as const,
    workItemId: null,
    workState: "no_work_non_actionable" as const,
    queueReplyPolicy: "responsible_only" as const,
    replyPolicyEvidence: null,
    workAbsenceProof: {
      resource: entityKey(
        "core:conversation-work-head",
        `conversation_work_head:${route.conversation.id}`
      ),
      conversationResource: destination,
      workItemCount: 0,
      expectedHighWater: "1",
      currentHighWater: "1",
      revisionChecks: []
    },
    conversationAccessBindingState: "active" as const,
    structuralAccessBinding: null,
    claimMode: "none" as const,
    overrideReason: null,
    routeFallbackRequested: false
  };
  return {
    tenantId: fixtureTenantId,
    evaluatedAt: fixtureT2,
    principal: {
      kind: "employee",
      employee: fixtureEmployeeReference,
      lifecycle: "active",
      session: {
        state: "active",
        authorization: authorizationSnapshot(decisions),
        notAfter: fixtureT4
      }
    },
    currentAuthorization: {
      tenantId: fixtureTenantId,
      principal: {
        kind: "employee",
        employeeId: fixtureEmployeeReference.id
      },
      authorizationEpoch: route.authorizationEpoch,
      dependencies: authorizationSnapshot(decisions).dependencies
    },
    grants: [],
    requirements: decisions.map((decision) => ({
      id: `requirement:${decision.id}`,
      permissionId: decision.permissionId,
      resource: decision.resource,
      resourceAccessRevision: decision.resourceAccessRevision,
      expectedResourceAccessRevision: decision.resourceAccessRevision,
      scopeFacts: [],
      revisionChecks: [],
      guard:
        decision.id === actionDecision.id
          ? guard
          : decision.permissionId === "core:conversation.read"
            ? canonicalConversationReadGuard(decision.resource)
            : sourceUseGuard(route, sourceAccount, binding),
      visibility:
        decision.id === actionDecision.id ? "primary" : "secondary_hidden",
      authorizationSubject: { kind: "actor" }
    }))
  } as unknown as InboxV2AuthorizationPlanInput;
}

function authorizationPlanWithReplyGuardMutation(
  plan: InboxV2AuthorizationPlanInput,
  mutate: (
    operation: ProviderReferenceReplyGuardOperationFixture
  ) => ProviderReferenceReplyGuardOperationFixture
): InboxV2AuthorizationPlanInput {
  let matched = false;
  const requirements = plan.requirements.map((requirement) => {
    const guard = requirement.guard;
    if (
      requirement.permissionId !== "core:message.reply_external" ||
      guard.profileId !== "core:rbac.guard.external_route"
    ) {
      return requirement;
    }
    if (
      guard.operation.kind !== "reply" ||
      guard.operation.mode !== "provider_reference"
    ) {
      throw new Error("Expected provider-reference reply guard fixture.");
    }
    matched = true;
    return {
      ...requirement,
      guard: {
        ...guard,
        operation: mutate(guard.operation)
      }
    };
  });
  if (!matched) throw new Error("Expected external reply requirement fixture.");
  return { ...plan, requirements };
}

function replyGuardOperationFor(route: InboxV2OutboundRoute) {
  const referenceContext = route.referenceContext;
  if (referenceContext.kind !== "external_message") {
    throw new Error("Reply guard fixture requires an external reference.");
  }
  const sourceConversation = entityKey(
    "core:conversation",
    route.conversation.id
  );
  const sourceTimelineItem = entityKey(
    "core:timeline-item",
    "timeline_item:reply-target-1"
  );
  const sourceOccurrence = entityKey(
    "core:source-occurrence",
    referenceContext.sourceOccurrence.id
  );
  const sourceReference = entityKey(
    "core:external-message-reference",
    referenceContext.externalMessageReference.id
  );
  const originBinding = entityKey(
    "core:source-thread-binding",
    referenceContext.originBinding.id
  );
  const originSourceAccount = entityKey(
    "core:source-account",
    referenceContext.originSourceAccount.id
  );
  const externalThread = entityKey(
    "core:external-thread",
    referenceContext.externalThread.id
  );
  const destinationBinding = entityKey(
    "core:source-thread-binding",
    route.sourceThreadBinding.id
  );
  const destinationSourceAccount = entityKey(
    "core:source-account",
    route.sourceAccount.id
  );
  const providerContract = entityKey(
    "core:adapter-contract-snapshot",
    "adapter_contract_snapshot:reply-provider-1"
  );
  const providerGlobalProof =
    referenceContext.portability.kind === "provider_global"
      ? {
          resource: entityKey(
            "core:reference-portability-proof",
            "reference_portability_proof:reply-target-1"
          ),
          sourceReferenceResource: sourceReference,
          sourceOccurrenceResource: sourceOccurrence,
          originBindingResource: originBinding,
          originSourceAccountResource: originSourceAccount,
          destinationBindingResource: destinationBinding,
          destinationSourceAccountResource: destinationSourceAccount,
          providerContractResource: providerContract,
          originSourceAccountProviderContractResource: providerContract,
          destinationSourceAccountProviderContractResource: providerContract,
          revisionChecks: [],
          resourceRevisionChecks: [],
          notAfter: fixtureT4
        }
      : null;

  return {
    kind: "reply" as const,
    mode: "provider_reference" as const,
    sourceReadRequirementId:
      "requirement:authorization-decision:conversation-read",
    sourceReadResource: sourceConversation,
    sourceTimelineItemResource: sourceTimelineItem,
    sourceOccurrenceResource: sourceOccurrence,
    occurrenceTimelineItemResource: sourceTimelineItem,
    occurrenceReferenceResource: sourceReference,
    occurrenceBindingResource: originBinding,
    sourceReferenceResource: sourceReference,
    referenceTimelineItemResource: sourceTimelineItem,
    referenceBindingResource: originBinding,
    sourceBindingResource: originBinding,
    bindingConversationResource: sourceConversation,
    bindingExternalThreadResource: externalThread,
    bindingSourceAccountResource: originSourceAccount,
    sourceExternalThreadResource: externalThread,
    portability: referenceContext.portability.kind,
    providerGlobalProof,
    revisionChecks: [],
    resourceRevisionChecks: []
  };
}

function sourceUseGuard(
  route: InboxV2OutboundRoute,
  sourceAccount: ReturnType<typeof entityKey>,
  binding: ReturnType<typeof entityKey>
) {
  return {
    profileId: "core:rbac.guard.source_account_route" as const,
    operation: {
      kind: "use" as const,
      sourceAccountResource: sourceAccount,
      bindingResource: binding,
      capabilityManifest: {
        resource: entityKey(
          "core:provider-capability-manifest",
          "provider_capability_manifest:source-use"
        ),
        capabilityId: "core:capability.source_account.use" as const,
        sourceAccountResource: sourceAccount,
        bindingResource: binding,
        routeResource: null,
        manifestSourceAccountResource: sourceAccount,
        manifestBindingResource: binding,
        manifestRouteResource: null,
        state: "supported" as const,
        revisionChecks: [],
        notAfter: fixtureT4
      }
    },
    sourceAccountId: route.sourceAccount.id,
    routeSourceAccountId: route.sourceAccount.id,
    sourceState: "active" as const,
    bindingState: "active" as const,
    bindingGeneration: route.bindingFence.bindingGeneration,
    expectedBindingGeneration: route.bindingFence.bindingGeneration,
    capabilityState: "supported" as const,
    capabilityNotAfter: fixtureT4
  };
}

function authorizedMutationFor(input: {
  command: InboxV2OutboundReferenceCommand;
  messageCreation: InboxV2MessageCreationCommit;
  route: InboxV2OutboundRoute;
  dispatch: InboxV2OutboundDispatch;
  decisions: readonly InboxV2AuthorizationDecisionReference[];
  requestHash: string;
  actionId: "core:message.reply" | "core:message.forward_content_copy";
  actionDecisionId: string;
}): WithInboxV2AuthorizedCommandMutationInput {
  const dispatchChangeId = "change:outbound-reference-dispatch-1";
  const messageReference = {
    tenantId: fixtureTenantId,
    recordId: input.messageCreation.message.id,
    schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
    digest: hash("reference-message")
  };
  const dispatchReference = {
    tenantId: fixtureTenantId,
    recordId: input.dispatch.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    digest: hash("reference-dispatch")
  };
  return {
    tenantId: fixtureTenantId,
    command: {
      id: "command:outbound-reference-1",
      requestId: "request:outbound-reference-1",
      clientMutationId: input.command.clientMutationId,
      commandTypeId: "core:message.send",
      requestHash: input.requestHash,
      actor: { kind: "employee", employeeId: fixtureEmployeeReference.id },
      authorizationDecisionId: input.actionDecisionId,
      authorizationEpoch: input.route.authorizationEpoch,
      authorizedAt: fixtureT2,
      publicResultCode: "core:message.queued",
      resultReference: messageReference,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [],
      resources: []
    },
    records: {
      mutationId: "authorization-mutation:outbound-reference-1",
      relationKind: null,
      streamCommitId: "commit:outbound-reference-1",
      expectedStreamEpoch: "stream:outbound-reference-1",
      audienceImpact: { kind: "none" },
      commitHash: hash("reference-commit"),
      correlationId: "correlation:outbound-reference-1",
      changes: [
        {
          id: dispatchChangeId,
          ordinal: 1,
          entity: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:outbound-dispatch",
            entityId: input.dispatch.id
          },
          resultingRevision: "1",
          timeline: null,
          audience: "conversation_external",
          state: {
            kind: "upsert",
            stateSchemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
            stateSchemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
            stateHash: dispatchReference.digest,
            payloadReference: dispatchReference,
            domainCommitReference: messageReference
          }
        }
      ],
      events: [],
      outboxIntents: [
        {
          id: "outbox-intent:provider-reference-dispatch-1",
          ordinal: 1,
          typeId: "core:provider.dispatch",
          handlerId: "core:provider-dispatch-worker",
          effectClass: "provider_io",
          eventId: "event:message-reference-send-1",
          changeIds: [dispatchChangeId],
          payloadReference: dispatchReference,
          consumerDedupeKey: hash("reference-provider-dedupe"),
          correlationId: "correlation:outbound-reference-1",
          availableAt: fixtureT2,
          intentHash: hash("reference-provider-intent")
        }
      ],
      audit: {
        id: "audit:outbound-reference-1",
        actionId: input.actionId,
        target: {
          tenantId: fixtureTenantId,
          entityTypeId: "core:outbound-dispatch",
          entityId: input.dispatch.id
        },
        reasonCodeId: "core:message-reference-requested",
        matchedPermissionIds: [
          ...new Set(input.decisions.map((item) => item.permissionId))
        ].sort(compareCanonicalStrings),
        grantSourceIds: ["internal-ref:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
        authorizationScopeIds: [
          ...new Set(input.decisions.map((item) => item.resourceScopeId))
        ].sort(compareCanonicalStrings),
        overrideReasonCodeId: null,
        policyVersion: "v1",
        evidenceReference: messageReference,
        authorizationDecisionRefs: input.decisions,
        correlationId: "correlation:outbound-reference-1",
        outcome: "succeeded",
        revisionDeltaHash: hash("reference-revision-delta"),
        previousAuditHash: null,
        auditHash: hash("reference-audit"),
        occurredAt: fixtureT2,
        recordedAt: fixtureT2,
        expiresAt: fixtureT4,
        facets: []
      }
    },
    occurredAt: fixtureT2
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

function dispatchContentPlanFor(messageCreation: InboxV2MessageCreationCommit) {
  const route = messageCreation.outboundRoute;
  const dispatch = messageCreation.outboundDispatch;
  const content = messageCreation.content;
  const binding = messageCreation.outboundBindingSnapshot;
  if (
    route === null ||
    dispatch === null ||
    binding === null ||
    content.state.kind !== "available"
  ) {
    throw new Error(
      "Reference content-plan fixture requires available content."
    );
  }
  const base = {
    tenantId: fixtureTenantId,
    id: `outbound_dispatch_content_plan:${dispatch.id}`,
    dispatch: fixtureReference("outbound_dispatch", dispatch.id),
    message: fixtureReference("message", messageCreation.message.id),
    messageRevision: messageCreation.message.revision,
    conversation: messageCreation.message.conversation,
    timelineItem: messageCreation.message.timelineItem,
    route: fixtureReference("outbound_route", route.id),
    timelineContent: messageCreation.message.content.content,
    contentRevision: content.revision,
    contentFingerprint: calculateInboxV2OutboundDispatchContentFingerprint(
      {
        tenantId: fixtureTenantId,
        timelineContent: messageCreation.message.content.content,
        contentRevision: content.revision,
        contentDigestSha256: content.state.contentDigestSha256
      },
      {
        tenantId: fixtureTenantId,
        purposeId: INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID,
        keyGeneration: contentFingerprintKeyGeneration,
        validUntil: contentFingerprintValidUntil,
        key: contentFingerprintKey
      }
    ),
    binding: route.sourceThreadBinding,
    bindingRevision: binding.revision,
    capabilityRevision: route.bindingFence.capabilityRevision,
    adapterContract: route.adapterContract,
    blocks: content.state.blocks.map((block) => ({
      blockKey: block.blockKey,
      blockKind: fixtureDispatchBlockKind(block),
      exactFileObjectPin: fixtureFileObjectPin(block),
      artifactOrdinal: 1
    })),
    artifacts: [
      {
        ordinal: 1,
        grouping: "single" as const,
        capabilityId: "core:message-text-send" as const,
        operationId: route.operationId,
        blockKeys: content.state.blocks.map((block) => block.blockKey)
      }
    ],
    createdAt: dispatch.createdAt,
    revision: "1" as const
  };
  return inboxV2OutboundDispatchContentPlanSchema.parse({
    ...base,
    planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(base)
  });
}

function fixtureDispatchBlockKind(block: InboxV2MessageContentBlock) {
  if (block.kind === "unsupported_source_content") {
    throw new Error("Unsupported source content cannot dispatch outbound.");
  }
  return block.kind;
}

function fixtureFileObjectPin(block: InboxV2MessageContentBlock) {
  if (
    block.kind === "image" ||
    block.kind === "audio" ||
    block.kind === "video" ||
    block.kind === "file" ||
    block.kind === "sticker"
  ) {
    return block.attachment.state === "ready"
      ? {
          file: block.attachment.file,
          fileRevision: block.attachment.fileRevision,
          fileVersion: block.attachment.fileVersion,
          objectVersion: block.attachment.objectVersion
        }
      : null;
  }
  if (block.kind === "extension") {
    return block.payloadPin.state === "exact"
      ? {
          file: block.payloadFile,
          fileRevision: block.payloadPin.fileRevision,
          fileVersion: block.payloadPin.fileVersion,
          objectVersion: block.payloadPin.objectVersion
        }
      : null;
  }
  return null;
}

function persistenceFixture(
  fixture: ReturnType<typeof selectedReferenceFixture>,
  calls: string[]
) {
  const capability = {};
  return {
    fenceReplyAuthority: vi.fn(async () => {
      calls.push("reply-authority");
      return {
        kind: "committed" as const,
        authorityKind: "no_work_item" as const
      };
    }),
    persistRoute: vi.fn(async () => {
      calls.push("route");
      return { kind: "committed" as const, route: fixture.route };
    }),
    persistReroute: vi.fn(),
    prepareMessage: vi.fn(async () => {
      calls.push("message.prepare");
      return { kind: "ready" as const, capability };
    }),
    persistContentPlan: vi.fn(async () => {
      calls.push("content-plan");
      return { kind: "persisted" as const };
    }),
    sealMessage: vi.fn(async () => {
      calls.push("message.seal");
      return {
        kind: "created" as const,
        message: fixture.messageCreation.message,
        timelineItem: fixture.messageCreation.timelineAllocation.items[0]!,
        envelope: {},
        receipt: {}
      };
    })
  } as unknown as NonNullable<
    InboxV2OutboundReferenceCommandServiceOptions["persistence"]
  >;
}

function appliedCoordinator(
  fixture: ReturnType<typeof selectedReferenceFixture>,
  calls: string[]
): InboxV2AuthorizedAtomicMaterializationCoordinator {
  return {
    withAuthorizedCommandMutation: vi.fn(),
    withAuthorizedAtomicMaterialization: vi.fn(
      async (_input, prepare, seal) => {
        calls.push("coordinator");
        const capability = await prepare({} as never);
        const sealed = await seal({} as never, capability);
        return {
          kind: "applied" as const,
          result: sealed.result,
          status: appliedStatusFor(
            fixture.command,
            fixture.messageCreation.message.id
          ),
          revisionEffects: []
        };
      }
    )
  } as unknown as InboxV2AuthorizedAtomicMaterializationCoordinator;
}

function fixtureContentFingerprintAuthority(): InboxV2OutboundMessageMaterializationFingerprintAuthority {
  return {
    async verify(input) {
      const expected = calculateInboxV2OutboundDispatchContentFingerprint(
        {
          tenantId: input.tenantId,
          timelineContent: input.timelineContent,
          contentRevision: input.contentRevision,
          contentDigestSha256: input.contentDigestSha256
        },
        {
          tenantId: input.tenantId,
          purposeId: INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID,
          keyGeneration: contentFingerprintKeyGeneration,
          validUntil: contentFingerprintValidUntil,
          key: contentFingerprintKey
        }
      );
      return (
        input.fingerprint.purposeId ===
          INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID &&
        input.fingerprint.keyGeneration === contentFingerprintKeyGeneration &&
        input.fingerprint.validUntil === contentFingerprintValidUntil &&
        input.fingerprint.hmacSha256 === expected.hmacSha256 &&
        Date.parse(input.planCreatedAt) <
          Date.parse(input.fingerprint.validUntil) &&
        Date.parse(input.at) < Date.parse(input.fingerprint.validUntil)
      );
    }
  };
}

function preparerReturning(
  prepared: InboxV2PreparedOutboundReferenceCommand | null
): InboxV2OutboundReferenceCommandPreparer {
  const idempotency =
    prepared?.kind === "committed_replay" ||
    prepared?.kind === "idempotency_conflict";
  return {
    lookupIdempotency: vi.fn().mockResolvedValue(idempotency ? prepared : null),
    prepareNew: vi
      .fn()
      .mockResolvedValue(prepared !== null && !idempotency ? prepared : null)
  };
}

function coordinatorThatMustNotRun(): InboxV2AuthorizedAtomicMaterializationCoordinator {
  return {
    withAuthorizedCommandMutation: vi.fn(),
    withAuthorizedAtomicMaterialization: vi.fn()
  } as unknown as InboxV2AuthorizedAtomicMaterializationCoordinator;
}

function allowGate(): NonNullable<
  InboxV2OutboundReferenceCommandServiceOptions["authorizationGate"]
> {
  return vi.fn(async (input: { executeAllowed: () => Promise<unknown> }) => ({
    outcome: "allowed" as const,
    publicDecision: { outcome: "allowed" as const, notAfter: fixtureT4 },
    value: await input.executeAllowed()
  })) as unknown as NonNullable<
    InboxV2OutboundReferenceCommandServiceOptions["authorizationGate"]
  >;
}

function denialSink(): InboxV2SecurityDenialSink {
  return { record: vi.fn() } as unknown as InboxV2SecurityDenialSink;
}

function idempotencyScopeFor(
  command: InboxV2OutboundReferenceCommand
): InboxV2OutboundReferenceIdempotencyScope {
  return {
    tenantId: command.tenantId,
    principal: requestScope.principal,
    commandTypeId: "core:message.send",
    clientMutationId: command.clientMutationId,
    publicResultCode: "core:message.queued"
  };
}

function appliedStatusFor(
  command: InboxV2OutboundReferenceCommand,
  messageId: string
): InboxV2PrivilegedAuthorizationMutationAppliedStatus {
  return {
    commandId: "command:outbound-reference-1",
    mutationId: "authorization-mutation:outbound-reference-1",
    publicResultCode: "core:message.queued",
    resultReference: {
      tenantId: command.tenantId,
      recordId: messageId,
      schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
      schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
      digest: hash("replayed-message")
    },
    streamCommitId: "commit:outbound-reference-1",
    streamEpoch: "stream:outbound-reference-1",
    streamPosition: "1",
    committedAt: fixtureT2,
    sensitiveResultReference: null
  } as unknown as InboxV2PrivilegedAuthorizationMutationAppliedStatus;
}

function disclosurePlanFor(
  command: InboxV2OutboundReferenceCommand
): InboxV2AuthorizationPlanInput {
  const sourceConversationIds =
    command.kind === "reply"
      ? [command.target.conversationId]
      : command.kind === "forward_content_copy"
        ? command.sources.map((source) => source.conversationId)
        : [command.source.conversationId];
  const resources = [
    ...new Set([command.conversationId, ...sourceConversationIds])
  ].map((conversationId) => entityKey("core:conversation", conversationId));
  return {
    tenantId: fixtureTenantId,
    evaluatedAt: fixtureT2,
    principal: {
      kind: "employee",
      employee: fixtureEmployeeReference,
      lifecycle: "active",
      session: {
        state: "active",
        authorization: {
          tenantId: fixtureTenantId,
          employee: fixtureEmployeeReference,
          value: "authorization:route-epoch-1",
          dependencies: {
            tenantRbacRevision: "1",
            employeeAccessRevision: "1",
            employeeInboxRelationRevision: "1",
            sharedAccessRevision: "1",
            resourceDependencies: resources.map((resource) => ({
              resource,
              accessRevision: "1"
            })),
            temporalBoundaryDigest: hash("disclosure-temporal")
          },
          evaluatedAt: fixtureT1,
          notAfter: fixtureT4,
          nextAuthorizationBoundary: null
        },
        notAfter: fixtureT4
      }
    },
    currentAuthorization: {
      tenantId: fixtureTenantId,
      principal: {
        kind: "employee",
        employeeId: fixtureEmployeeReference.id
      },
      authorizationEpoch: "authorization:route-epoch-1",
      dependencies: {
        tenantRbacRevision: "1",
        employeeAccessRevision: "1",
        employeeInboxRelationRevision: "1",
        sharedAccessRevision: "1",
        resourceDependencies: resources.map((resource) => ({
          resource,
          accessRevision: "1"
        })),
        temporalBoundaryDigest: hash("disclosure-temporal")
      }
    },
    grants: [],
    requirements: resources.map((resource, index) => ({
      id: `requirement:disclosure-conversation-read:${index}`,
      permissionId: "core:conversation.read",
      resource,
      resourceAccessRevision: "1",
      expectedResourceAccessRevision: "1",
      scopeFacts: [],
      revisionChecks: [],
      guard: canonicalConversationReadGuard(resource),
      visibility: "primary",
      authorizationSubject: { kind: "actor" }
    }))
  } as unknown as InboxV2AuthorizationPlanInput;
}

function canonicalConversationReadGuard(
  resource: ReturnType<typeof entityKey>
) {
  return {
    profileId: "core:rbac.guard.canonical_resource" as const,
    resourceState: "active" as const,
    contentBoundary: "external" as const,
    routeInputFields: [],
    companionRequirementIds: [],
    action: {
      kind: "conversation_content_read" as const,
      targetResource: resource,
      conversationKind: "external_work" as const,
      contentBoundary: "external" as const,
      topologyResource: entityKey(
        "core:conversation-topology",
        `conversation_topology:${resource.entityId}`
      ),
      topologyConversationResource: resource,
      topologyConversationKind: "external_work" as const,
      topologyRevisionChecks: [
        { kind: "state" as const, expected: "1", actual: "1" }
      ]
    }
  };
}

function entityKey(entityTypeId: string, entityId: string) {
  return { tenantId: fixtureTenantId, entityTypeId, entityId };
}
