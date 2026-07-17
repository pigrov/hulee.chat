import {
  inboxV2SourceMessageReconciliationPlanSchema,
  inboxV2SourceMessageReconciliationRequestSchema
} from "@hulee/contracts";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createInboxV2TrustedSourceMessageReconciliationMaterializer,
  InboxV2SourceMessageReconciliationMaterializerError,
  isInboxV2TrustedSourceMessageReconciliationMaterializer,
  type InboxV2SourceMessageNamespaceDeriver
} from "./source-message-reconciliation-materializer";
import {
  makeMessageReconciliationDescriptor,
  makeResolvedReconciliationContext,
  reconciliationT3,
  reconciliationT5
} from "./source-message-reconciliation.test-support";

function namespaceDeriver(
  generation = "namespace-generation-v1"
): InboxV2SourceMessageNamespaceDeriver {
  return {
    namespaceGeneration: generation,
    deriveNamespaceHmacSha256(input) {
      return createHmac("sha256", `tenant-secret:${input.tenantId}`)
        .update(
          [
            input.trustedServiceId,
            input.namespaceGeneration,
            input.purpose,
            input.canonicalPreimage
          ].join("\u0000"),
          "utf8"
        )
        .digest("hex");
    }
  };
}

function materializer(now = reconciliationT5) {
  return createInboxV2TrustedSourceMessageReconciliationMaterializer({
    trustedServiceId: "core:source-runtime",
    namespaceDeriver: namespaceDeriver(),
    clock: { now: () => now }
  });
}

describe("Inbox V2 source-message reconciliation materializer", () => {
  it("derives one closed exact-key create plan without weak selectors", () => {
    const context = makeResolvedReconciliationContext();
    const descriptor = makeMessageReconciliationDescriptor(context);
    const trusted = materializer();
    const plan = trusted.materialize({ context, descriptor });

    expect(
      isInboxV2TrustedSourceMessageReconciliationMaterializer(trusted)
    ).toBe(true);
    expect(
      inboxV2SourceMessageReconciliationPlanSchema.safeParse(plan).success
    ).toBe(true);
    expect(plan.messageKey).toMatchObject({
      scope: { kind: "provider_thread" },
      externalThread: {
        id: context.externalThreadMapping.thread.id
      },
      canonicalExternalSubject: "Message:Exact-42"
    });
    expect(plan.sourceOccurrence.bindingContext).toMatchObject({
      sourceAccount: context.plan.source.sourceAccount,
      sourceThreadBinding: {
        id: context.sourceThreadBinding.binding.id
      }
    });
    expect(plan.sourceOccurrence.resolution.state).toBe("pending");
    expect(plan.intent.kind).toBe("message_create");
    expect(Object.isFrozen(plan)).toBe(true);

    expect(
      inboxV2SourceMessageReconciliationPlanSchema.safeParse({
        ...plan,
        sourceOccurrence: {
          ...plan.sourceOccurrence,
          direction: "system"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceMessageReconciliationPlanSchema.safeParse({
        ...plan,
        sourceOccurrence: {
          ...plan.sourceOccurrence,
          providerActor: null
        }
      }).success
    ).toBe(false);

    for (const forbidden of [
      { content: "same text" },
      { sender: "display sender" },
      { existingMessageId: "message:latest" },
      { providerTimestampSelector: reconciliationT3 }
    ]) {
      expect(
        inboxV2SourceMessageReconciliationRequestSchema.safeParse({
          context,
          descriptor: { ...descriptor, ...forbidden }
        }).success
      ).toBe(false);
    }
  });

  it("keeps observation IDs distinct while replay and provider-wide canonical candidates converge", () => {
    const firstContext = makeResolvedReconciliationContext("a");
    const secondContext = makeResolvedReconciliationContext("b");
    const first = materializer().materialize({
      context: firstContext,
      descriptor: makeMessageReconciliationDescriptor(firstContext, {
        origin: "webhook"
      })
    });
    const replay = materializer().materialize({
      context: firstContext,
      descriptor: makeMessageReconciliationDescriptor(firstContext, {
        origin: "webhook"
      })
    });
    const pollingObservation = materializer().materialize({
      context: firstContext,
      descriptor: makeMessageReconciliationDescriptor(firstContext, {
        origin: "poll"
      })
    });
    const secondAccount = materializer().materialize({
      context: secondContext,
      descriptor: makeMessageReconciliationDescriptor(secondContext)
    });

    expect(replay.sourceOccurrence.id).toBe(first.sourceOccurrence.id);
    expect(replay.candidateExternalMessageReferenceId).toBe(
      first.candidateExternalMessageReferenceId
    );
    expect(pollingObservation.sourceOccurrence.id).not.toBe(
      first.sourceOccurrence.id
    );
    expect(secondAccount.sourceOccurrence.id).not.toBe(
      first.sourceOccurrence.id
    );
    expect(secondAccount.candidateExternalMessageReferenceId).toBe(
      first.candidateExternalMessageReferenceId
    );
    if (
      first.intent.kind !== "message_create" ||
      secondAccount.intent.kind !== "message_create"
    ) {
      throw new Error("fixture must create messages");
    }
    expect(secondAccount.intent.candidateMessageId).toBe(
      first.intent.candidateMessageId
    );
    expect(secondAccount.intent.candidateTimelineItemId).toBe(
      first.intent.candidateTimelineItemId
    );
    expect(secondAccount.intent.candidateTransportLinkId).not.toBe(
      first.intent.candidateTransportLinkId
    );
  });

  it("separates account-scoped keys and equal-content genuine provider messages", () => {
    const firstContext = makeResolvedReconciliationContext("a");
    const secondContext = makeResolvedReconciliationContext("b");
    const firstAccount = materializer().materialize({
      context: firstContext,
      descriptor: makeMessageReconciliationDescriptor(firstContext, {
        scopeKind: "source_account"
      })
    });
    const secondAccount = materializer().materialize({
      context: secondContext,
      descriptor: makeMessageReconciliationDescriptor(secondContext, {
        scopeKind: "source_account"
      })
    });
    const genuineSecondMessage = materializer().materialize({
      context: firstContext,
      descriptor: makeMessageReconciliationDescriptor(firstContext, {
        subject: "Message:Exact-43"
      })
    });

    expect(firstAccount.messageKey.scope).toMatchObject({
      kind: "source_account",
      owner: firstContext.plan.source.sourceAccount
    });
    expect(secondAccount.candidateExternalMessageReferenceId).not.toBe(
      firstAccount.candidateExternalMessageReferenceId
    );
    expect(genuineSecondMessage.candidateExternalMessageReferenceId).not.toBe(
      firstAccount.candidateExternalMessageReferenceId
    );
  });

  it("materializes edit-before-create as one exact pending action and never chooses a latest Message", () => {
    const context = makeResolvedReconciliationContext();
    const plan = materializer().materialize({
      context,
      descriptor: makeMessageReconciliationDescriptor(context, {
        intent: "source_action"
      })
    });

    expect(plan.intent.kind).toBe("source_action");
    if (plan.intent.kind !== "source_action") return;
    expect(plan.intent.deferredAction).toMatchObject({
      id: plan.intent.candidateDeferredActionId,
      externalMessageKey: plan.messageKey,
      sourceOccurrence: { id: plan.sourceOccurrence.id },
      state: { state: "pending" },
      action: { kind: "edit" }
    });
    expect(plan.intent.deferredAction.semanticProof).toMatchObject({
      externalMessageReference: null,
      sourceOccurrence: null
    });
    expect(JSON.stringify(plan.intent.deferredAction)).not.toContain("latest");
  });

  it("hands off exact echoes and retains only bounded target-free weak evidence", () => {
    const context = makeResolvedReconciliationContext();
    const descriptor = makeMessageReconciliationDescriptor(context, {
      origin: "provider_echo",
      direction: "outbound",
      intent: "echo_handoff",
      weakEvidence: true
    });
    const plan = materializer().materialize({ context, descriptor });

    expect(plan.intent.kind).toBe("echo_handoff");
    expect(plan.sourceOccurrence.origin.kind).toBe("provider_echo");
    expect(plan.weakCorrelationEvidence).toHaveLength(1);
    expect(Object.keys(plan.weakCorrelationEvidence[0] ?? {}).sort()).toEqual([
      "codeId",
      "evidenceHmacSha256",
      "expiresAt"
    ]);
    expect(
      inboxV2SourceMessageReconciliationRequestSchema.safeParse({
        context,
        descriptor: {
          ...descriptor,
          weakCorrelationEvidence: [
            descriptor.weakCorrelationEvidence[0],
            descriptor.weakCorrelationEvidence[0]
          ]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceMessageReconciliationPlanSchema.safeParse({
        ...plan,
        weakCorrelationEvidence: [
          {
            ...plan.weakCorrelationEvidence[0],
            expiresAt: "2026-08-17T08:05:00.001Z"
          }
        ]
      }).success
    ).toBe(false);
  });

  it("rejects provider-response observations and handoff roles at the SRC-006 boundary", () => {
    const context = makeResolvedReconciliationContext();
    const descriptor = makeMessageReconciliationDescriptor(context, {
      origin: "provider_echo",
      direction: "outbound",
      intent: "echo_handoff"
    });
    const trusted = materializer();

    for (const providerResponseDescriptor of [
      {
        ...descriptor,
        occurrence: {
          ...descriptor.occurrence,
          origin: {
            kind: "provider_response",
            outboundDispatchAttempt: {
              tenantId: context.plan.source.tenantId,
              kind: "outbound_dispatch_attempt",
              id: "outbound_dispatch_attempt:attempt-1"
            }
          }
        }
      },
      {
        ...descriptor,
        intent: {
          kind: "echo_handoff",
          transportRole: "provider_response"
        }
      }
    ]) {
      expect(() =>
        trusted.materialize({
          context,
          descriptor: providerResponseDescriptor
        } as never)
      ).toThrowError(
        expect.objectContaining<
          Partial<InboxV2SourceMessageReconciliationMaterializerError>
        >({ code: "source.message_reconciliation.request_invalid" })
      );
    }
  });

  it("fails closed on a wrong service, pre-resolution clock or extended options", () => {
    const context = makeResolvedReconciliationContext();
    const descriptor = makeMessageReconciliationDescriptor(context);
    const wrongService =
      createInboxV2TrustedSourceMessageReconciliationMaterializer({
        trustedServiceId: "core:other-runtime",
        namespaceDeriver: namespaceDeriver(),
        clock: { now: () => reconciliationT5 }
      });
    expect(() =>
      wrongService.materialize({ context, descriptor })
    ).toThrowError(
      expect.objectContaining<
        Partial<InboxV2SourceMessageReconciliationMaterializerError>
      >({
        code: "source.message_reconciliation.materializer_service_mismatch"
      })
    );
    expect(() =>
      materializer(reconciliationT3).materialize({ context, descriptor })
    ).toThrowError(
      expect.objectContaining<
        Partial<InboxV2SourceMessageReconciliationMaterializerError>
      >({ code: "source.message_reconciliation.materialization_clock_invalid" })
    );
    expect(() =>
      createInboxV2TrustedSourceMessageReconciliationMaterializer({
        trustedServiceId: "core:source-runtime",
        namespaceDeriver: namespaceDeriver(),
        clock: { now: () => reconciliationT5 },
        providerClient: {} // rejected before any provider I/O could exist
      } as never)
    ).toThrow(TypeError);
  });
});
