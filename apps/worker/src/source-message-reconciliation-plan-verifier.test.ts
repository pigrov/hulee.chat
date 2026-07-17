import { inboxV2SourceMessageReconciliationPlanSchema } from "@hulee/contracts";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createInboxV2TrustedSourceMessageReconciliationMaterializer,
  type InboxV2SourceMessageNamespaceDeriver
} from "./source-message-reconciliation-materializer";
import {
  createInboxV2SourceMessageReconciliationPlanVerifier,
  isInboxV2TrustedSourceMessageReconciliationPlanVerifier
} from "./source-message-reconciliation-plan-verifier";
import {
  makeMessageReconciliationDescriptor,
  makeResolvedReconciliationContext,
  reconciliationT5
} from "./source-message-reconciliation.test-support";

function deriver(): InboxV2SourceMessageNamespaceDeriver {
  return {
    namespaceGeneration: "namespace-generation-v1",
    deriveNamespaceHmacSha256(input) {
      return createHmac("sha256", `tenant-secret:${input.tenantId}`)
        .update(
          [
            input.trustedServiceId,
            input.namespaceGeneration,
            input.purpose,
            input.canonicalPreimage
          ].join("\u0000")
        )
        .digest("hex");
    }
  };
}

describe("Inbox V2 source-message reconciliation plan verifier", () => {
  it("authenticates every plan field and rejects coherent-looking tampering", () => {
    const namespaceDeriver = deriver();
    const context = makeResolvedReconciliationContext();
    const plan = createInboxV2TrustedSourceMessageReconciliationMaterializer({
      trustedServiceId: "core:source-runtime",
      namespaceDeriver,
      clock: { now: () => reconciliationT5 }
    }).materialize({
      context,
      descriptor: makeMessageReconciliationDescriptor(context, {
        weakEvidence: true
      })
    });
    const verifier = createInboxV2SourceMessageReconciliationPlanVerifier({
      trustedServiceId: "core:source-runtime",
      namespaceDeriver
    });

    expect(
      isInboxV2TrustedSourceMessageReconciliationPlanVerifier(verifier)
    ).toBe(true);
    expect(verifier.verify(plan)).toBe(true);

    const changedSubject = "Message:Exact-Tampered";
    expect(
      verifier.verify({
        ...plan,
        messageKey: {
          ...plan.messageKey,
          canonicalExternalSubject: changedSubject
        },
        sourceOccurrence: {
          ...plan.sourceOccurrence,
          messageKey: {
            ...plan.sourceOccurrence.messageKey,
            canonicalExternalSubject: changedSubject
          }
        }
      })
    ).toBe(false);
    expect(
      verifier.verify({
        ...plan,
        candidateExternalMessageReferenceId:
          "external_message_reference:tampered"
      } as never)
    ).toBe(false);
    expect(
      verifier.verify({
        ...plan,
        weakCorrelationEvidence: [
          {
            ...plan.weakCorrelationEvidence[0]!,
            evidenceHmacSha256: `hmac-sha256:${"1".repeat(64)}`
          }
        ]
      })
    ).toBe(false);
    expect(
      verifier.verify({
        ...plan,
        materializationToken: `${plan.materializationToken}x`
      })
    ).toBe(false);
  });

  it("rejects a verifier with another service or namespace generation", () => {
    const namespaceDeriver = deriver();
    const context = makeResolvedReconciliationContext();
    const plan = createInboxV2TrustedSourceMessageReconciliationMaterializer({
      trustedServiceId: "core:source-runtime",
      namespaceDeriver,
      clock: { now: () => reconciliationT5 }
    }).materialize({
      context,
      descriptor: makeMessageReconciliationDescriptor(context)
    });
    expect(
      createInboxV2SourceMessageReconciliationPlanVerifier({
        trustedServiceId: "core:other-runtime",
        namespaceDeriver
      }).verify(plan)
    ).toBe(false);
    expect(
      createInboxV2SourceMessageReconciliationPlanVerifier({
        trustedServiceId: "core:source-runtime",
        namespaceDeriver: {
          ...namespaceDeriver,
          namespaceGeneration: "namespace-generation-v2"
        }
      }).verify(plan)
    ).toBe(false);
  });

  it("rejects provider-response occurrences and roles outside MSG-007", () => {
    const namespaceDeriver = deriver();
    const context = makeResolvedReconciliationContext();
    const plan = createInboxV2TrustedSourceMessageReconciliationMaterializer({
      trustedServiceId: "core:source-runtime",
      namespaceDeriver,
      clock: { now: () => reconciliationT5 }
    }).materialize({
      context,
      descriptor: makeMessageReconciliationDescriptor(context, {
        origin: "provider_echo",
        direction: "outbound",
        intent: "echo_handoff"
      })
    });
    const verifier = createInboxV2SourceMessageReconciliationPlanVerifier({
      trustedServiceId: "core:source-runtime",
      namespaceDeriver
    });

    const providerResponseRole = {
      ...plan,
      intent: { ...plan.intent, transportRole: "provider_response" }
    };
    const providerResponseOrigin = {
      ...plan,
      sourceOccurrence: {
        ...plan.sourceOccurrence,
        origin: {
          kind: "provider_response",
          sourceAccount: context.plan.source.sourceAccount,
          outboundDispatchAttempt: {
            tenantId: context.plan.source.tenantId,
            kind: "outbound_dispatch_attempt",
            id: "outbound_dispatch_attempt:attempt-1"
          }
        }
      }
    };

    for (const forgedPlan of [providerResponseRole, providerResponseOrigin]) {
      expect(
        inboxV2SourceMessageReconciliationPlanSchema.safeParse(forgedPlan)
          .success
      ).toBe(false);
      expect(verifier.verify(forgedPlan as never)).toBe(false);
    }
  });
});
