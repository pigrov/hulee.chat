import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2OpaqueAdapterRouteDescriptorSchema,
  inboxV2SourceConversationResolutionSourceProjectionSchema,
  type InboxV2SourceConversationResolutionSourceProjection
} from "@hulee/contracts";
import {
  computeInboxV2SourceThreadBindingRouteDescriptorDigest,
  createSqlInboxV2SourceConversationResolutionRepository,
  type InboxV2SourceConversationMaterializationPlanAuthorizationVerifier
} from "@hulee/db";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2TrustedSourceConversationResolutionMaterializer,
  type InboxV2SourceConversationNamespaceDeriver,
  type InboxV2SourceConversationThreadPlan
} from "./source-conversation-resolution-materializer";
import {
  createInboxV2SourceConversationMaterializationPlanVerifier,
  isInboxV2TrustedSourceConversationMaterializationPlanVerifier
} from "./source-conversation-resolution-plan-verifier";

const tenantId = "tenant:src005-verifier";
const recordedAt = "2026-07-17T08:01:00.000Z";
const materializedAt = "2026-07-17T08:02:00.000Z";
const trustedServiceId = "core:source-runtime";
const namespaceGeneration = "namespace-generation-v1";
const adapterContract = {
  contractId: "module:synthetic-source:src005-verifier",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:direct-messenger",
  loadedByTrustedServiceId: trustedServiceId,
  loadedAt: "2026-07-17T08:00:00.000Z"
};

describe("Inbox V2 source Conversation materialization plan verifier", () => {
  it("cryptographically authorizes only the exact materializer output", () => {
    const namespaceDeriver = deriver("tenant-secret-a");
    const materializer =
      createInboxV2TrustedSourceConversationResolutionMaterializer({
        trustedServiceId,
        namespaceDeriver,
        threadPlanResolver: { resolve: planForSource },
        clock: { now: () => materializedAt }
      });
    const verifier = createInboxV2SourceConversationMaterializationPlanVerifier(
      {
        trustedServiceId,
        namespaceDeriver
      }
    );
    const plan = materializer.materialize(source());
    const consumerPort: InboxV2SourceConversationMaterializationPlanAuthorizationVerifier =
      verifier;

    expect(consumerPort.verify(plan)).toBe(true);
    expect(
      isInboxV2TrustedSourceConversationMaterializationPlanVerifier(verifier)
    ).toBe(true);
    expect(
      isInboxV2TrustedSourceConversationMaterializationPlanVerifier({
        verify: () => true
      })
    ).toBe(false);
  });

  it("rejects schema-valid candidate, route and token substitutions", () => {
    const namespaceDeriver = deriver("tenant-secret-a");
    const materializer =
      createInboxV2TrustedSourceConversationResolutionMaterializer({
        trustedServiceId,
        namespaceDeriver,
        threadPlanResolver: { resolve: planForSource },
        clock: { now: () => materializedAt }
      });
    const verifier = createInboxV2SourceConversationMaterializationPlanVerifier(
      {
        trustedServiceId,
        namespaceDeriver
      }
    );
    const plan = materializer.materialize(source());

    expect(
      verifier.verify({
        ...plan,
        candidateConversationId: "conversation:substituted"
      } as never)
    ).toBe(false);
    expect(
      verifier.verify({
        ...plan,
        routeDescriptor: routeDescriptor(plan.source, "Route:Other")
      })
    ).toBe(false);
    expect(
      verifier.verify({
        ...plan,
        materializationToken: `${plan.materializationToken}-substituted`
      } as never)
    ).toBe(false);
  });

  it("rejects a tampered materializer plan at the actual DB consume port before transaction", async () => {
    const namespaceDeriver = deriver("tenant-secret-a");
    const materializer =
      createInboxV2TrustedSourceConversationResolutionMaterializer({
        trustedServiceId,
        namespaceDeriver,
        threadPlanResolver: { resolve: planForSource },
        clock: { now: () => materializedAt }
      });
    const verifier = createInboxV2SourceConversationMaterializationPlanVerifier(
      { trustedServiceId, namespaceDeriver }
    );
    const plan = materializer.materialize(source());
    const transaction = vi.fn();
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      {
        execute: vi.fn(),
        transaction
      } as never,
      { planAuthorizationVerifier: verifier }
    );

    await expect(
      repository.resolve({
        plan: {
          ...plan,
          materializationToken: `${plan.materializationToken}-tampered`
        } as never,
        streamPosition: inboxV2BigintCounterSchema.parse("1")
      })
    ).rejects.toMatchObject({ code: "permission.denied" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("isolates trusted service, namespace generation and tenant secrets", () => {
    const namespaceDeriver = deriver("tenant-secret-a");
    const plan = createInboxV2TrustedSourceConversationResolutionMaterializer({
      trustedServiceId,
      namespaceDeriver,
      threadPlanResolver: { resolve: planForSource },
      clock: { now: () => materializedAt }
    }).materialize(source());

    expect(
      createInboxV2SourceConversationMaterializationPlanVerifier({
        trustedServiceId,
        namespaceDeriver: deriver("tenant-secret-b")
      }).verify(plan)
    ).toBe(false);
    expect(
      createInboxV2SourceConversationMaterializationPlanVerifier({
        trustedServiceId: "core:other-source-runtime",
        namespaceDeriver
      }).verify(plan)
    ).toBe(false);
    expect(
      createInboxV2SourceConversationMaterializationPlanVerifier({
        trustedServiceId,
        namespaceDeriver: {
          ...namespaceDeriver,
          namespaceGeneration: "namespace-generation-v2"
        }
      }).verify(plan)
    ).toBe(false);
  });

  it("fails closed when namespace verification cannot derive a digest", () => {
    const materializerDeriver = deriver("tenant-secret-a");
    const plan = createInboxV2TrustedSourceConversationResolutionMaterializer({
      trustedServiceId,
      namespaceDeriver: materializerDeriver,
      threadPlanResolver: { resolve: planForSource },
      clock: { now: () => materializedAt }
    }).materialize(source());
    const verifier = createInboxV2SourceConversationMaterializationPlanVerifier(
      {
        trustedServiceId,
        namespaceDeriver: {
          namespaceGeneration,
          deriveNamespaceHmacSha256() {
            throw new Error("unavailable key authority");
          }
        }
      }
    );

    expect(verifier.verify(plan)).toBe(false);
  });
});

function source(): InboxV2SourceConversationResolutionSourceProjection {
  const sourceConnection = {
    tenantId,
    kind: "source_connection" as const,
    id: "source_connection:src005-verifier"
  };
  const sourceAccount = {
    tenantId,
    kind: "source_account" as const,
    id: "source_account:src005-verifier"
  };
  const key = {
    realm: {
      realmId: "module:synthetic-source:thread-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "source_account" as const, owner: sourceAccount },
    objectKindId: "module:synthetic-source:chat",
    canonicalExternalSubject: "CaseSensitive:Peer"
  };
  return inboxV2SourceConversationResolutionSourceProjectionSchema.parse({
    tenantId,
    rawInboundEvent: {
      tenantId,
      kind: "raw_inbound_event",
      id: "raw_inbound_event:src005-verifier"
    },
    normalizedInboundEvent: {
      tenantId,
      kind: "normalized_inbound_event",
      id: "normalized_inbound_event:src005-verifier"
    },
    sourceConnection,
    sourceAccount,
    domain: "core:inbox-v2.normalized-event-safe-envelope",
    schemaId: "core:inbox-v2.normalized-event-envelope",
    schemaVersion: "v1",
    safeEnvelopeHmacSha256: `hmac-sha256:${"a".repeat(64)}`,
    adapterContract,
    thread: {
      sourceConnection,
      sourceAccount,
      identityDeclaration: {
        adapterContract,
        identityKind: "external_thread",
        realmId: key.realm.realmId,
        realmVersion: key.realm.realmVersion,
        canonicalizationVersion: key.realm.canonicalizationVersion,
        objectKindId: key.objectKindId,
        scopeKind: "source_account",
        decisionStrength: "safe_default"
      },
      key,
      observedExternalSubject: key.canonicalExternalSubject
    },
    recordedAt
  });
}

function planForSource(
  input: InboxV2SourceConversationResolutionSourceProjection
): InboxV2SourceConversationThreadPlan {
  return {
    topology: "direct" as const,
    purposeId: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
    routeDescriptor: routeDescriptor(input, "Route:CaseSensitive:Peer"),
    capabilityEntries: [],
    historySyncState: "not_started" as const
  };
}

function routeDescriptor(
  input: InboxV2SourceConversationResolutionSourceProjection,
  destinationSubject: string
) {
  const unsigned = {
    adapterContract: input.adapterContract,
    descriptorSchemaId: "module:synthetic-source:direct-route",
    descriptorVersion: "v1",
    descriptorRevision: "1" as const,
    destinationKindId: "module:synthetic-source:peer",
    destinationSubject,
    attributes: []
  };
  return inboxV2OpaqueAdapterRouteDescriptorSchema.parse({
    ...unsigned,
    descriptorDigestSha256:
      computeInboxV2SourceThreadBindingRouteDescriptorDigest({
        ...unsigned,
        descriptorDigestSha256: "0".repeat(64)
      } as never)
  });
}

function deriver(secret: string): InboxV2SourceConversationNamespaceDeriver {
  return {
    namespaceGeneration,
    deriveNamespaceHmacSha256(input) {
      return createHmac("sha256", secret)
        .update(
          [
            input.tenantId,
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
