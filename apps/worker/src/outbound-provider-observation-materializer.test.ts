import { createHash } from "node:crypto";

import {
  INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundProviderResponseObservationDescriptorSchema,
  type InboxV2OutboundProviderResponseObservationDescriptor
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  createOutboundTransportContractFixture,
  OUTBOUND_TEST_TIMES
} from "../../../packages/db/src/repositories/sql-inbox-v2-outbound-transport-repository.test-support";
import {
  createInboxV2TrustedOutboundProviderObservationMaterializer,
  InboxV2OutboundProviderObservationMaterializerError,
  type InboxV2OutboundProviderEchoObservationMaterializationInput,
  type InboxV2OutboundProviderObservationMaterializationInput,
  type InboxV2OutboundProviderObservationMaterializerErrorCode
} from "./outbound-provider-observation-materializer";

const fixture = createOutboundTransportContractFixture({
  suffix: "worker-provider-observation"
});
const siblingFixture = createOutboundTransportContractFixture({
  suffix: "worker-provider-observation-sibling"
});
const foreignTenantFixture = createOutboundTransportContractFixture({
  tenantId: "tenant:worker-provider-observation-foreign",
  suffix: "worker-provider-observation-foreign"
});
const trustedServiceId = "core:source-runtime";

function createMaterializer() {
  return createInboxV2TrustedOutboundProviderObservationMaterializer({
    trustedServiceId,
    namespaceDeriver: {
      namespaceGeneration:
        "namespace-generation:worker-provider-observation-materializer",
      deriveNamespaceHmacSha256: ({ canonicalPreimage }) =>
        createHash("sha256").update(canonicalPreimage).digest("hex")
    }
  });
}

function providerResponseDescriptor(
  artifactOrdinal = 1
): InboxV2OutboundProviderResponseObservationDescriptor {
  return inboxV2OutboundProviderResponseObservationDescriptorSchema.parse({
    artifactOrdinal,
    canonicalExternalSubject: `ProviderMessage:${artifactOrdinal}`,
    messageIdentityDeclaration: {
      adapterContract: fixture.route.adapterContract,
      identityKind: "message",
      realmId: "module:synthetic-source:message-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1",
      objectKindId: "module:synthetic-source:chat-message",
      scopeKind: "provider_thread",
      decisionStrength: "authoritative"
    },
    occurrenceDescriptor: {
      adapterContract: fixture.route.adapterContract,
      descriptorSchemaId:
        "module:synthetic-source:provider-response-observation",
      descriptorVersion: "v1",
      capabilityRevision: "1",
      providerReferences: [
        {
          kindId: "module:synthetic-source:message-id",
          subject: `ProviderMessage:${artifactOrdinal}`
        }
      ],
      descriptorDigestSha256: "c".repeat(64)
    },
    providerTimestamps: [
      {
        kindId: "module:synthetic-source:sent-at",
        timestamp: OUTBOUND_TEST_TIMES.artifactAt
      }
    ],
    referencePortability: {
      kind: "external_thread",
      adapterContract: fixture.route.adapterContract,
      decisionStrength: "authoritative"
    },
    observedAt: OUTBOUND_TEST_TIMES.artifactAt
  });
}

function validInput(): InboxV2OutboundProviderObservationMaterializationInput {
  return {
    dispatch: fixture.acceptedDispatch,
    route: fixture.route,
    attempt: fixture.acceptedAttempt,
    artifact: fixture.artifacts[0],
    descriptor: providerResponseDescriptor(),
    recordedAt: OUTBOUND_TEST_TIMES.linkedAt
  };
}

function validEchoInput(): InboxV2OutboundProviderEchoObservationMaterializationInput {
  return {
    dispatch: fixture.attemptingDispatch,
    route: fixture.route,
    attempt: fixture.pendingAttempt,
    artifact: fixture.artifacts[0],
    sourceOccurrence: fixture.echoAssociation.occurrenceResolution.before,
    exactCorrelation: {
      providerReferenceKindId:
        fixture.echoAssociation.occurrenceResolution.before.descriptor
          .providerReferences[1]!.kindId,
      correlationToken:
        fixture.pendingAttempt.retrySafety.providerCorrelationToken!,
      artifactOrdinal: 1
    },
    recordedAt: fixture.echoAssociation.occurrenceResolution.before.recordedAt
  };
}

function expectMaterializationFailure(
  input: InboxV2OutboundProviderObservationMaterializationInput,
  code: InboxV2OutboundProviderObservationMaterializerErrorCode = "outbound_provider_observation.materialization_invalid"
): void {
  try {
    createMaterializer().materializeProviderResponse(input);
    throw new Error("Expected provider observation materialization to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(
      InboxV2OutboundProviderObservationMaterializerError
    );
    expect(error).toMatchObject({ code, retryable: false });
  }
}

describe("Inbox V2 outbound provider observation materializer", () => {
  it("replays the same fenced provider response into one deterministic immutable observation", () => {
    const materializer = createMaterializer();
    const input = validInput();

    const first = materializer.materializeProviderResponse(input);
    const replay = materializer.materializeProviderResponse(input);

    expect(replay).toStrictEqual(first);
    expect(replay.id).toBe(first.id);
    expect(replay.sourceOccurrence.id).toBe(first.sourceOccurrence.id);
    expect(replay.sourceOccurrenceDetailDigestSha256).toBe(
      first.sourceOccurrenceDetailDigestSha256
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sourceOccurrence)).toBe(true);
    expect(first).toMatchObject({
      tenantId: fixture.tenantId,
      dispatch: { id: fixture.acceptedDispatch.id },
      route: { id: fixture.route.id },
      attempt: { id: fixture.acceptedAttempt.id },
      artifact: { id: fixture.artifacts[0].id, ordinal: 1 },
      sourceOccurrence: {
        origin: { kind: "provider_response" },
        direction: "outbound",
        providerActor: null,
        resolution: { state: "pending" }
      },
      evidence: {
        kind: "provider_response_attempt",
        artifactOrdinal: 1
      }
    });
  });

  it("derives one deterministic settlement handoff from the canonical message key and occurrence", () => {
    const materializer = createMaterializer();
    const observation = materializer.materializeProviderResponse(validInput());

    const first = materializer.materializeSettlementWork(observation);
    const replay = materializer.materializeSettlementWork(observation);

    expect(replay).toStrictEqual(first);
    expect(first).toMatchObject({
      observation: { id: observation.id },
      candidateExternalMessageReferenceId: expect.stringMatching(
        /^external_message_reference:[a-f0-9]{64}$/u
      ),
      candidateTransportLinkId: expect.stringMatching(
        /^message_transport_occurrence_link:[a-f0-9]{64}$/u
      )
    });
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("rejects canonical IDs and tenant/message ownership supplied by an adapter descriptor", () => {
    const descriptorWithCanonicalOwnership = {
      ...providerResponseDescriptor(),
      tenantId: fixture.tenantId,
      messageId: fixture.references.message.id,
      sourceOccurrenceId: "source_occurrence:adapter-forged",
      externalMessageReferenceId: "external_message_reference:adapter-forged"
    };

    expectMaterializationFailure({
      ...validInput(),
      descriptor:
        descriptorWithCanonicalOwnership as InboxV2OutboundProviderResponseObservationDescriptor
    });
  });

  it.each([
    ["tenant", { dispatch: foreignTenantFixture.acceptedDispatch }],
    ["route", { route: siblingFixture.route }],
    ["attempt", { attempt: siblingFixture.acceptedAttempt }],
    ["artifact", { artifact: siblingFixture.artifacts[0] }]
  ] as const)(
    "fails closed when the %s member is spliced into another route-attempt-artifact chain",
    (_member, override) => {
      expectMaterializationFailure({ ...validInput(), ...override });
    }
  );

  it("fails closed on artifact ordinal, observation time and adapter-surface tampering", () => {
    expectMaterializationFailure(
      {
        ...validInput(),
        descriptor: providerResponseDescriptor(2)
      },
      "outbound_provider_observation.service_mismatch"
    );

    expectMaterializationFailure({
      ...validInput(),
      recordedAt: OUTBOUND_TEST_TIMES.selectedAt
    });

    expectMaterializationFailure({
      ...validInput(),
      descriptor: {
        ...providerResponseDescriptor(),
        observedAt: OUTBOUND_TEST_TIMES.loadedAt
      }
    });

    expectMaterializationFailure({
      ...validInput(),
      descriptor: {
        ...providerResponseDescriptor(),
        occurrenceDescriptor: {
          ...providerResponseDescriptor().occurrenceDescriptor,
          adapterContract: {
            ...fixture.route.adapterContract,
            surfaceId: "module:synthetic:tampered-provider-surface"
          }
        }
      } as unknown as InboxV2OutboundProviderResponseObservationDescriptor
    });

    expectMaterializationFailure({
      ...validInput(),
      attempt: inboxV2OutboundDispatchAttemptSchema.parse({
        ...fixture.acceptedAttempt,
        retrySafety: {
          ...fixture.acceptedAttempt.retrySafety,
          adapterContract: {
            ...fixture.acceptedAttempt.retrySafety.adapterContract,
            contractVersion: "v2"
          }
        }
      })
    });
  });

  it("hard-codes every provider-response effect to false", () => {
    const observation =
      createMaterializer().materializeProviderResponse(validInput());

    expect(observation.effectDisposition).toStrictEqual(
      INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION
    );
    expect(Object.values(observation.effectDisposition)).toStrictEqual([
      false,
      false,
      false,
      false,
      false,
      false
    ]);
  });

  it("replays one exact provider echo into a deterministic observation without client effects", () => {
    const materializer = createMaterializer();
    const input = validEchoInput();

    const first = materializer.materializeProviderEcho(input);
    const replay = materializer.materializeProviderEcho(input);

    expect(replay).toStrictEqual(first);
    expect(replay).toMatchObject({
      tenantId: fixture.tenantId,
      dispatch: { id: fixture.attemptingDispatch.id },
      route: { id: fixture.route.id },
      attempt: { id: fixture.pendingAttempt.id },
      artifact: { id: fixture.artifacts[0].id, ordinal: 1 },
      sourceOccurrence: {
        id: fixture.echoAssociation.occurrenceResolution.before.id,
        origin: { kind: "provider_echo" },
        direction: "outbound",
        providerActor: null,
        resolution: { state: "pending" }
      },
      evidence: {
        kind: "provider_echo_correlation",
        artifactOrdinal: 1,
        providerReferenceKindId: "module:synthetic:client-correlation-token",
        correlationToken:
          fixture.pendingAttempt.retrySafety.providerCorrelationToken
      },
      effectDisposition:
        INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.values(first.effectDisposition)).toStrictEqual([
      false,
      false,
      false,
      false,
      false,
      false
    ]);
  });

  it("fails closed when exact provider-echo correlation is weak, spliced or inconsistent", () => {
    const materializer = createMaterializer();
    const input = validEchoInput();

    expect(() =>
      materializer.materializeProviderEcho({
        ...input,
        exactCorrelation: {
          ...input.exactCorrelation,
          correlationToken: "provider:unknown-correlation"
        }
      })
    ).toThrowError(
      expect.objectContaining({
        code: "outbound_provider_observation.service_mismatch",
        retryable: false
      })
    );
    expect(() =>
      materializer.materializeProviderEcho({
        ...input,
        exactCorrelation: {
          ...input.exactCorrelation,
          artifactOrdinal: 2
        }
      })
    ).toThrowError(
      expect.objectContaining({
        code: "outbound_provider_observation.service_mismatch",
        retryable: false
      })
    );
    expect(() =>
      materializer.materializeProviderEcho({
        ...input,
        route: siblingFixture.route
      })
    ).toThrowError(
      expect.objectContaining({
        code: "outbound_provider_observation.materialization_invalid",
        retryable: false
      })
    );
    expect(() =>
      materializer.materializeProviderEcho({
        ...input,
        recordedAt: OUTBOUND_TEST_TIMES.linkedAt
      })
    ).toThrowError(
      expect.objectContaining({
        code: "outbound_provider_observation.service_mismatch",
        retryable: false
      })
    );
  });
});
