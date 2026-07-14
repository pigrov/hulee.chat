import { describe, expect, it } from "vitest";

import {
  inboxV2ExternalThreadMappingSchema,
  type InboxV2ExternalThreadMapping
} from "./external-thread";
import {
  inboxV2MessageDeliveryObservationSchema,
  inboxV2MessageTransportAssociationCommitSchema,
  inboxV2MessageTransportFactCommitSchema,
  inboxV2MessageTransportFactPageSchema,
  inboxV2ProviderReceiptObservationSchema
} from "./message-transport";
import {
  fixtureAdapterContract,
  fixtureAcceptedAttempt,
  fixtureAcceptedDispatch,
  fixtureBindingReference,
  fixtureDispatch,
  fixtureExternalMessageReference,
  fixtureExternalReference,
  fixtureExternalThreadMapping,
  fixtureMessage,
  fixtureMessageReference,
  fixtureOccurrence,
  fixtureOutboundBindingSnapshot,
  fixtureProviderSemanticProof,
  fixtureReference,
  fixtureRoute,
  fixtureSourceAccountReference,
  fixtureSourceIdentityReference,
  fixtureSourceOccurrenceReference,
  fixtureT2,
  fixtureT3,
  fixtureTenantId,
  fixtureTimelineItem
} from "./timeline-message-fixtures.type-fixture";

const otherTenantId = "tenant:tenant-2";

function deliveryObservation(
  fact: "accepted" | "sent" | "delivered" | "failed" = "delivered",
  overrides: Record<string, unknown> = {}
) {
  return {
    tenantId: fixtureTenantId,
    id: `message_delivery_observation:${fact}-1`,
    message: fixtureMessageReference,
    fact,
    scope: {
      kind: "dispatch" as const,
      dispatch: fixtureReference(
        "outbound_dispatch",
        "outbound_dispatch:dispatch-1"
      ),
      attempt: fixtureReference(
        "outbound_dispatch_attempt",
        "outbound_dispatch_attempt:attempt-1"
      ),
      artifact: null
    },
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingGeneration: "1",
    adapterContract: fixtureAdapterContract,
    capabilityId: `module:synthetic:delivery-${fact}`,
    capabilityRevision: "1",
    evidence: {
      kind: "provider_event" as const,
      normalizedInboundEvent: fixtureReference(
        "normalized_inbound_event",
        "normalized_inbound_event:provider_echo-1"
      ),
      externalMessageReference: fixtureExternalMessageReference,
      sourceOccurrence: fixtureReference(
        "source_occurrence",
        fixtureSourceOccurrenceReference.id
      )
    },
    semanticProof: fixtureProviderSemanticProof({
      semanticId: `core:message.delivery.${fact}`,
      capabilityId: `module:synthetic:delivery-${fact}`,
      normalizedInboundEvent: fixtureReference(
        "normalized_inbound_event",
        "normalized_inbound_event:provider_echo-1"
      ),
      occurredAt: fixtureT2,
      recordedAt: fixtureT3
    }),
    evidenceKindId: "module:synthetic:provider-event",
    evidenceDigestSha256: "d".repeat(64),
    failureReasonId: fact === "failed" ? "core:provider-failure" : null,
    observedAt: fixtureT2,
    recordedAt: fixtureT3,
    revision: "1" as const,
    ...overrides
  };
}

function receiptObservation(
  input: {
    target?: "exact_message" | "provider_watermark" | "thread_readmark";
    reader?: "known" | "aggregate";
    overrides?: Record<string, unknown>;
  } = {}
) {
  const targetKind = input.target ?? "exact_message";
  const target =
    targetKind === "exact_message"
      ? {
          kind: "exact_message" as const,
          message: fixtureMessageReference,
          externalMessageReference: fixtureExternalMessageReference,
          sourceOccurrence: fixtureSourceOccurrenceReference
        }
      : targetKind === "provider_watermark"
        ? {
            kind: "provider_watermark" as const,
            watermark: "watermark:42"
          }
        : {
            kind: "thread_readmark" as const,
            readThroughProviderTime: fixtureT2
          };
  const reader =
    input.reader === "aggregate"
      ? {
          kind: "aggregate_only" as const,
          aggregateKey: "all-participants"
        }
      : {
          kind: "source_external_identity" as const,
          sourceExternalIdentity: fixtureSourceIdentityReference
        };
  return {
    tenantId: fixtureTenantId,
    id: `provider_receipt_observation:${targetKind}-${input.reader ?? "known"}`,
    fact: "read" as const,
    target,
    reader,
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingGeneration: "1",
    adapterContract: fixtureAdapterContract,
    capabilityId: "module:synthetic:read-receipt",
    capabilityRevision: "1",
    evidenceEvent: fixtureReference(
      "normalized_inbound_event",
      "normalized_inbound_event:webhook-1"
    ),
    semanticProof: fixtureProviderSemanticProof({
      semanticId: "core:message.receipt.read",
      capabilityId: "module:synthetic:read-receipt",
      normalizedInboundEvent: fixtureReference(
        "normalized_inbound_event",
        "normalized_inbound_event:webhook-1"
      ),
      externalMessageReference:
        targetKind === "exact_message" ? fixtureExternalMessageReference : null,
      sourceOccurrence:
        targetKind === "exact_message"
          ? fixtureSourceOccurrenceReference
          : null,
      actor:
        input.reader === "aggregate" ? null : fixtureSourceIdentityReference,
      occurredAt: fixtureT2,
      recordedAt: fixtureT3
    }),
    evidenceKindId: "module:synthetic:provider-event",
    evidenceDigestSha256: "e".repeat(64),
    observedAt: fixtureT2,
    recordedAt: fixtureT3,
    revision: "1" as const,
    ...input.overrides
  };
}

function transportFactCommit(
  fact:
    | { kind: "delivery"; observation: ReturnType<typeof deliveryObservation> }
    | { kind: "receipt"; observation: ReturnType<typeof receiptObservation> }
) {
  const beforeMessage = fixtureMessage("hulee");
  const providerOccurrence =
    fact.kind === "delivery"
      ? fixtureOccurrence({
          origin: "provider_echo",
          direction: "outbound",
          recordedAt: fixtureT3
        })
      : fixtureOccurrence({ recordedAt: fixtureT3 });
  const transportEvidence =
    fact.kind === "delivery" && fact.observation.scope.kind === "dispatch"
      ? {
          kind: "dispatch" as const,
          dispatch: fixtureAcceptedDispatch(),
          route: fixtureRoute(),
          externalThreadMapping: fixtureExternalThreadMapping(),
          attempt: fixtureAcceptedAttempt(),
          artifact: null,
          externalMessageReference:
            fixtureExternalReference(providerOccurrence),
          sourceOccurrence: providerOccurrence
        }
      : {
          kind: "external_reference" as const,
          externalMessageReference:
            fixtureExternalReference(providerOccurrence),
          sourceOccurrence: providerOccurrence,
          externalThreadMapping: fixtureExternalThreadMapping()
        };
  return {
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem: fixtureTimelineItem("external"),
    fact,
    transportEvidence,
    commitToken: `transport:${fact.kind}:${fact.observation.id}`,
    committedAt: fixtureT3
  };
}

function associationCommit(
  occurrence = fixtureOccurrence({
    origin: "provider_echo",
    direction: "outbound",
    recordedAt: fixtureT3
  })
) {
  const beforeMessage = fixtureMessage("hulee");
  const beforeTimelineItem = fixtureTimelineItem("external");
  const externalMessageReference = fixtureExternalReference(occurrence);
  return {
    tenantId: fixtureTenantId,
    message: beforeMessage,
    timelineItem: beforeTimelineItem,
    linkHeadBefore: null,
    sourceOccurrence: occurrence,
    externalMessageReference,
    externalThreadMapping: fixtureExternalThreadMapping(),
    occurrenceBinding: occurrenceBindingSnapshot(occurrence),
    messageOriginProof: {
      kind: "hulee_outbound" as const,
      outboundRoute: fixtureRoute()
    },
    link: {
      tenantId: fixtureTenantId,
      id: "message_transport_occurrence_link:provider-echo-1",
      message: fixtureMessageReference,
      sourceOccurrence: fixtureReference("source_occurrence", occurrence.id),
      externalMessageReference: fixtureExternalMessageReference,
      role: "provider_echo" as const,
      revision: "1" as const,
      linkedAt: fixtureT3
    },
    linkHeadAfter: {
      tenantId: fixtureTenantId,
      message: fixtureMessageReference,
      linkCount: "1",
      latestLink: fixtureReference(
        "message_transport_occurrence_link",
        "message_transport_occurrence_link:provider-echo-1"
      ),
      revision: "1",
      updatedAt: fixtureT3
    },
    committedAt: fixtureT3
  };
}

function occurrenceBindingSnapshot(
  occurrence: ReturnType<typeof fixtureOccurrence>,
  route = fixtureRoute()
) {
  const snapshot = fixtureOutboundBindingSnapshot(route);
  return {
    ...snapshot,
    id: occurrence.bindingContext.sourceThreadBinding.id,
    externalThread: occurrence.bindingContext.externalThread,
    sourceAccount: occurrence.bindingContext.sourceAccount,
    accountIdentitySnapshot: {
      ...snapshot.accountIdentitySnapshot,
      sourceAccount: occurrence.bindingContext.sourceAccount
    },
    bindingGeneration: occurrence.bindingContext.bindingGeneration,
    capabilities: {
      ...snapshot.capabilities,
      adapterContract: occurrence.descriptor.adapterContract,
      revision: occurrence.descriptor.capabilityRevision
    }
  };
}

function providerWideExternalThreadMapping() {
  const mapping = fixtureExternalThreadMapping();
  return inboxV2ExternalThreadMappingSchema.parse({
    ...mapping,
    thread: {
      ...mapping.thread,
      key: { ...mapping.thread.key, scope: { kind: "provider" as const } },
      identityDeclaration: {
        ...mapping.thread.identityDeclaration,
        scopeKind: "provider" as const,
        decisionStrength: "authoritative" as const
      }
    }
  });
}

function sourceAssociationCommit(input: {
  direction: "inbound" | "outbound";
  role: "additional_artifact" | "native_outbound" | "provider_echo";
  originOccurrence: ReturnType<typeof fixtureOccurrence>;
  occurrence: ReturnType<typeof fixtureOccurrence>;
  occurrenceRoute?: ReturnType<typeof fixtureRoute>;
  externalThreadMapping?: InboxV2ExternalThreadMapping;
}) {
  const message = fixtureMessage("source", undefined, {
    origin: {
      kind: "source_originated" as const,
      originOccurrence: fixtureReference(
        "source_occurrence",
        input.originOccurrence.id
      ),
      direction: input.direction,
      claimAtOccurrence: null
    }
  });
  const externalMessageReference = fixtureExternalReference(input.occurrence, {
    createdAt: input.originOccurrence.recordedAt
  });
  const linkId = `message_transport_occurrence_link:${input.role}-additional-1`;
  return {
    tenantId: fixtureTenantId,
    message,
    timelineItem: fixtureTimelineItem("external"),
    linkHeadBefore: {
      tenantId: fixtureTenantId,
      message: fixtureMessageReference,
      linkCount: "1",
      latestLink: fixtureReference(
        "message_transport_occurrence_link",
        "message_transport_occurrence_link:origin-1"
      ),
      revision: "1",
      updatedAt: fixtureT2
    },
    sourceOccurrence: input.occurrence,
    externalMessageReference,
    externalThreadMapping:
      input.externalThreadMapping ?? fixtureExternalThreadMapping(),
    occurrenceBinding: occurrenceBindingSnapshot(
      input.occurrence,
      input.occurrenceRoute
    ),
    messageOriginProof: {
      kind: "source_originated" as const,
      originOccurrence: input.originOccurrence
    },
    link: {
      tenantId: fixtureTenantId,
      id: linkId,
      message: fixtureMessageReference,
      sourceOccurrence: fixtureReference(
        "source_occurrence",
        input.occurrence.id
      ),
      externalMessageReference: fixtureExternalMessageReference,
      role: input.role,
      revision: "1" as const,
      linkedAt: fixtureT3
    },
    linkHeadAfter: {
      tenantId: fixtureTenantId,
      message: fixtureMessageReference,
      linkCount: "2",
      latestLink: fixtureReference("message_transport_occurrence_link", linkId),
      revision: "2",
      updatedAt: fixtureT3
    },
    committedAt: fixtureT3
  };
}

describe("Inbox V2 Message transport contracts", () => {
  it("stores delivery facts independently instead of synthesizing one scalar state", () => {
    const delivered = deliveryObservation("delivered");
    const failedArtifact = deliveryObservation("failed", {
      id: "message_delivery_observation:failed-artifact-2",
      scope: {
        kind: "dispatch",
        dispatch: fixtureReference(
          "outbound_dispatch",
          "outbound_dispatch:dispatch-1"
        ),
        attempt: fixtureReference(
          "outbound_dispatch_attempt",
          "outbound_dispatch_attempt:attempt-2"
        ),
        artifact: fixtureReference(
          "outbound_dispatch_artifact",
          "outbound_dispatch_artifact:artifact-2"
        )
      }
    });

    expect(
      inboxV2MessageDeliveryObservationSchema.safeParse(delivered).success
    ).toBe(true);
    expect(
      inboxV2MessageDeliveryObservationSchema.safeParse(failedArtifact).success
    ).toBe(true);
    expect(
      inboxV2MessageTransportFactCommitSchema.safeParse(
        transportFactCommit({ kind: "delivery", observation: delivered })
      ).success
    ).toBe(true);
    const deliveryCommit = transportFactCommit({
      kind: "delivery",
      observation: delivered
    });
    if (deliveryCommit.transportEvidence.kind !== "dispatch") {
      throw new Error("Delivery fixture must use dispatch evidence.");
    }
    expect(
      inboxV2MessageTransportFactCommitSchema.safeParse({
        ...deliveryCommit,
        transportEvidence: {
          ...deliveryCommit.transportEvidence,
          dispatch: {
            ...deliveryCommit.transportEvidence.dispatch,
            message: fixtureReference("message", "message:unrelated")
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageTransportFactCommitSchema.safeParse({
        ...deliveryCommit,
        transportEvidence: {
          ...deliveryCommit.transportEvidence,
          dispatch: fixtureDispatch()
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageTransportFactPageSchema.safeParse({
        tenantId: fixtureTenantId,
        message: fixtureMessageReference,
        facts: [
          { kind: "delivery", observation: delivered },
          { kind: "delivery", observation: failedArtifact }
        ],
        snapshotToken: "snapshot:transport-page-1",
        nextCursor: null
      }).success
    ).toBe(true);
  });

  it("accepts a read receipt without inventing accepted, sent or delivered facts", () => {
    const read = receiptObservation();
    expect(
      inboxV2ProviderReceiptObservationSchema.safeParse(read).success
    ).toBe(true);
    const parsedRead = inboxV2MessageTransportFactCommitSchema.safeParse(
      transportFactCommit({ kind: "receipt", observation: read })
    );
    expect(parsedRead.success ? [] : parsedRead.error.issues).toEqual([]);
    const receiptCommit = transportFactCommit({
      kind: "receipt",
      observation: read
    });
    if (receiptCommit.transportEvidence.kind !== "external_reference") {
      throw new Error("Receipt fixture must use external evidence.");
    }
    expect(
      inboxV2MessageTransportFactCommitSchema.safeParse({
        ...receiptCommit,
        transportEvidence: {
          ...receiptCommit.transportEvidence,
          externalMessageReference: {
            ...receiptCommit.transportEvidence.externalMessageReference,
            message: fixtureReference("message", "message:unrelated")
          }
        }
      }).success
    ).toBe(false);
  });

  it("binds an exact receipt semantic proof to the exact SourceOccurrence provenance", () => {
    const receipt = receiptObservation();
    const otherOccurrence = fixtureReference(
      "source_occurrence",
      "source_occurrence:other-read-event"
    );
    expect(
      inboxV2ProviderReceiptObservationSchema.safeParse({
        ...receipt,
        target: { ...receipt.target, sourceOccurrence: otherOccurrence }
      }).success
    ).toBe(false);
    expect(
      inboxV2ProviderReceiptObservationSchema.safeParse({
        ...receipt,
        semanticProof: {
          ...receipt.semanticProof,
          sourceOccurrence: otherOccurrence
        }
      }).success
    ).toBe(false);

    const commit = transportFactCommit({
      kind: "receipt",
      observation: receipt
    });
    if (commit.transportEvidence.kind !== "external_reference") {
      throw new Error("Receipt fixture must use external evidence.");
    }
    expect(
      inboxV2MessageTransportFactCommitSchema.safeParse({
        ...commit,
        transportEvidence: {
          ...commit.transportEvidence,
          sourceOccurrence: {
            ...commit.transportEvidence.sourceOccurrence,
            id: otherOccurrence.id
          }
        }
      }).success
    ).toBe(false);
  });

  it("keeps known and provider-aggregate readers distinct", () => {
    const known = receiptObservation({ reader: "known" });
    const aggregate = receiptObservation({ reader: "aggregate" });
    expect(
      inboxV2ProviderReceiptObservationSchema.safeParse(known).success
    ).toBe(true);
    expect(
      inboxV2ProviderReceiptObservationSchema.safeParse(aggregate).success
    ).toBe(true);
    expect(
      inboxV2ProviderReceiptObservationSchema.safeParse({
        ...known,
        reader: {
          kind: "source_external_identity",
          sourceExternalIdentity: fixtureReference(
            "source_external_identity",
            "source_external_identity:actor-1",
            otherTenantId
          )
        }
      }).success
    ).toBe(false);
  });

  it("does not materialize provider watermark or thread readmark directly into one Message", () => {
    for (const target of ["provider_watermark", "thread_readmark"] as const) {
      const receipt = receiptObservation({ target });
      expect(
        inboxV2ProviderReceiptObservationSchema.safeParse(receipt).success
      ).toBe(true);
      expect(
        inboxV2MessageTransportFactCommitSchema.safeParse(
          transportFactCommit({ kind: "receipt", observation: receipt })
        ).success
      ).toBe(false);
      expect(
        inboxV2MessageTransportFactPageSchema.safeParse({
          tenantId: fixtureTenantId,
          message: fixtureMessageReference,
          facts: [{ kind: "receipt", observation: receipt }],
          snapshotToken: "snapshot:transport-page-1",
          nextCursor: null
        }).success
      ).toBe(false);
    }

    const aggregateDelivery = deliveryObservation("delivered", {
      scope: { kind: "thread_aggregate" }
    });
    expect(
      inboxV2MessageDeliveryObservationSchema.safeParse(aggregateDelivery)
        .success
    ).toBe(false);
    expect(
      inboxV2MessageTransportFactCommitSchema.safeParse(
        transportFactCommit({
          kind: "delivery",
          observation: aggregateDelivery
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2MessageTransportFactPageSchema.safeParse({
        tenantId: fixtureTenantId,
        message: fixtureMessageReference,
        facts: [{ kind: "delivery", observation: aggregateDelivery }],
        snapshotToken: "snapshot:transport-page-1",
        nextCursor: null
      }).success
    ).toBe(false);
  });

  it("associates a provider echo without rewriting Message authorship or order", () => {
    const commit = associationCommit();
    const result =
      inboxV2MessageTransportAssociationCommitSchema.safeParse(commit);
    expect(result.success ? [] : result.error.issues).toEqual([]);
    expect(commit.linkHeadAfter.message).toEqual(fixtureMessageReference);
    expect(commit.timelineItem.timelineSequence).toBe("1");
  });

  it("associates a provider-wide Hulee echo received through another exact account binding", () => {
    const secondAccount = fixtureReference(
      "source_account",
      "source_account:hulee-echo-account-2"
    );
    const secondBinding = fixtureReference(
      "source_thread_binding",
      "source_thread_binding:hulee-echo-binding-2"
    );
    const secondConnection = fixtureReference(
      "source_connection",
      "source_connection:hulee-echo-connection-2"
    );
    const baseEcho = fixtureOccurrence({
      origin: "provider_echo",
      direction: "outbound",
      occurrenceId: "source_occurrence:hulee-cross-account-echo-2",
      recordedAt: fixtureT3
    });
    const echo = {
      ...baseEcho,
      bindingContext: {
        ...baseEcho.bindingContext,
        sourceAccount: secondAccount,
        sourceThreadBinding: secondBinding
      },
      origin: { ...baseEcho.origin, sourceAccount: secondAccount }
    };
    const originRoute = fixtureRoute();
    const occurrenceRoute = {
      ...originRoute,
      sourceConnection: secondConnection,
      sourceAccount: secondAccount,
      sourceThreadBinding: secondBinding
    };
    const commit = {
      ...associationCommit(echo),
      externalThreadMapping: providerWideExternalThreadMapping(),
      occurrenceBinding: occurrenceBindingSnapshot(echo, occurrenceRoute)
    };

    const parsed =
      inboxV2MessageTransportAssociationCommitSchema.safeParse(commit);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(
      commit.messageOriginProof.kind === "hulee_outbound"
        ? commit.messageOriginProof.outboundRoute.sourceAccount
        : null
    ).toEqual(fixtureSourceAccountReference);
    expect(commit.occurrenceBinding.sourceAccount).toEqual(secondAccount);
    expect(commit.occurrenceBinding.id).toBe(secondBinding.id);
  });

  it("rejects cross-account Hulee echoes with a wrong provider, thread or account-scoped reference", () => {
    const secondAccount = fixtureReference(
      "source_account",
      "source_account:hulee-echo-account-2"
    );
    const secondBinding = fixtureReference(
      "source_thread_binding",
      "source_thread_binding:hulee-echo-binding-2"
    );
    const secondConnection = fixtureReference(
      "source_connection",
      "source_connection:hulee-echo-connection-2"
    );
    const baseEcho = fixtureOccurrence({
      origin: "provider_echo",
      direction: "outbound",
      occurrenceId: "source_occurrence:hulee-cross-account-echo-2",
      recordedAt: fixtureT3
    });
    const providerWideEcho = {
      ...baseEcho,
      bindingContext: {
        ...baseEcho.bindingContext,
        sourceAccount: secondAccount,
        sourceThreadBinding: secondBinding
      },
      origin: { ...baseEcho.origin, sourceAccount: secondAccount }
    };
    const originRoute = fixtureRoute();
    const occurrenceRoute = {
      ...originRoute,
      sourceConnection: secondConnection,
      sourceAccount: secondAccount,
      sourceThreadBinding: secondBinding
    };
    const valid = {
      ...associationCommit(providerWideEcho),
      externalThreadMapping: providerWideExternalThreadMapping(),
      occurrenceBinding: occurrenceBindingSnapshot(
        providerWideEcho,
        occurrenceRoute
      )
    };
    const otherAdapterContract = {
      ...fixtureAdapterContract,
      contractId: "module:other-provider:direct-account-adapter",
      surfaceId: "module:other-provider:direct-account"
    };
    const wrongProvider = {
      ...valid,
      externalThreadMapping: {
        ...valid.externalThreadMapping,
        thread: {
          ...valid.externalThreadMapping.thread,
          identityDeclaration: {
            ...valid.externalThreadMapping.thread.identityDeclaration,
            adapterContract: otherAdapterContract
          }
        }
      }
    };
    const wrongThread = {
      ...valid,
      externalThreadMapping: {
        ...valid.externalThreadMapping,
        thread: {
          ...valid.externalThreadMapping.thread,
          id: "external_thread:unrelated-provider-thread"
        }
      }
    };
    const accountScopedEcho = {
      ...providerWideEcho,
      messageKey: {
        ...providerWideEcho.messageKey,
        scope: { kind: "source_account" as const, owner: secondAccount }
      },
      messageIdentityDeclaration: {
        ...providerWideEcho.messageIdentityDeclaration,
        scopeKind: "source_account" as const,
        decisionStrength: "safe_default" as const
      }
    };
    const wrongScope = {
      ...valid,
      sourceOccurrence: accountScopedEcho,
      externalMessageReference: {
        ...valid.externalMessageReference,
        key: accountScopedEcho.messageKey,
        identityDeclaration: accountScopedEcho.messageIdentityDeclaration
      }
    };

    for (const invalid of [wrongProvider, wrongThread, wrongScope]) {
      expect(
        inboxV2MessageTransportAssociationCommitSchema.safeParse(invalid)
          .success
      ).toBe(false);
    }
  });

  it("associates exact additional occurrences for source inbound and native outbound Messages", () => {
    const inboundOrigin = fixtureOccurrence({
      origin: "webhook",
      direction: "inbound",
      occurrenceId: fixtureSourceOccurrenceReference.id
    });
    const inboundAdditional = fixtureOccurrence({
      origin: "history",
      direction: "inbound",
      occurrenceId: "source_occurrence:inbound-additional-2",
      recordedAt: fixtureT3
    });
    const nativeOrigin = fixtureOccurrence({
      origin: "webhook",
      direction: "outbound",
      occurrenceId: fixtureSourceOccurrenceReference.id
    });
    const nativeAdditional = fixtureOccurrence({
      origin: "history",
      direction: "outbound",
      occurrenceId: "source_occurrence:native-outbound-additional-2",
      recordedAt: fixtureT3
    });

    for (const commit of [
      sourceAssociationCommit({
        direction: "inbound",
        role: "additional_artifact",
        originOccurrence: inboundOrigin,
        occurrence: inboundAdditional
      }),
      sourceAssociationCommit({
        direction: "outbound",
        role: "native_outbound",
        originOccurrence: nativeOrigin,
        occurrence: nativeAdditional
      })
    ]) {
      const parsed =
        inboxV2MessageTransportAssociationCommitSchema.safeParse(commit);
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
      expect(commit.linkHeadAfter.revision).toBe("2");
      expect(commit.message.revision).toBe("1");
      expect(commit.timelineItem.timelineSequence).toBe("1");
    }
  });

  it("associates a provider-wide cross-account echo only through its exact second binding", () => {
    const originOccurrence = fixtureOccurrence({
      origin: "webhook",
      direction: "outbound",
      occurrenceId: fixtureSourceOccurrenceReference.id
    });
    const secondAccount = fixtureReference(
      "source_account",
      "source_account:account-2"
    );
    const secondBinding = fixtureReference(
      "source_thread_binding",
      "source_thread_binding:binding-2"
    );
    const secondConnection = fixtureReference(
      "source_connection",
      "source_connection:connection-2"
    );
    const baseEcho = fixtureOccurrence({
      origin: "provider_echo",
      direction: "outbound",
      occurrenceId: "source_occurrence:cross-account-echo-2",
      recordedAt: fixtureT3
    });
    const echo = {
      ...baseEcho,
      bindingContext: {
        ...baseEcho.bindingContext,
        sourceAccount: secondAccount,
        sourceThreadBinding: secondBinding
      },
      origin: { ...baseEcho.origin, sourceAccount: secondAccount }
    };
    const route = fixtureRoute();
    const secondBindingRoute = {
      ...route,
      sourceConnection: secondConnection,
      sourceAccount: secondAccount,
      sourceThreadBinding: secondBinding
    };
    const providerMapping = providerWideExternalThreadMapping();
    const commit = sourceAssociationCommit({
      direction: "outbound",
      role: "provider_echo",
      originOccurrence,
      occurrence: echo,
      occurrenceRoute: secondBindingRoute,
      externalThreadMapping: providerMapping
    });

    const parsed =
      inboxV2MessageTransportAssociationCommitSchema.safeParse(commit);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(commit.occurrenceBinding.sourceAccount).toEqual(secondAccount);
    expect(commit.occurrenceBinding.id).toBe(secondBinding.id);
  });

  it("rejects arbitrary source associations without exact origin, mapping, binding or role proof", () => {
    const originOccurrence = fixtureOccurrence({
      origin: "webhook",
      direction: "inbound",
      occurrenceId: fixtureSourceOccurrenceReference.id
    });
    const additional = fixtureOccurrence({
      origin: "history",
      direction: "inbound",
      occurrenceId: "source_occurrence:inbound-additional-2",
      recordedAt: fixtureT3
    });
    const commit = sourceAssociationCommit({
      direction: "inbound",
      role: "additional_artifact",
      originOccurrence,
      occurrence: additional
    });

    const invalidCommits = [
      { ...commit, linkHeadBefore: null },
      {
        ...commit,
        messageOriginProof: {
          ...commit.messageOriginProof,
          originOccurrence: fixtureOccurrence({
            origin: "webhook",
            direction: "inbound",
            occurrenceId: fixtureSourceOccurrenceReference.id,
            externalSubject: "unrelated-provider-message"
          })
        }
      },
      {
        ...commit,
        occurrenceBinding: {
          ...commit.occurrenceBinding,
          sourceAccount: fixtureReference(
            "source_account",
            "source_account:unrelated"
          )
        }
      },
      {
        ...commit,
        externalThreadMapping: {
          ...commit.externalThreadMapping,
          conversation: {
            ...commit.externalThreadMapping.conversation,
            id: "conversation:unrelated"
          }
        }
      },
      {
        ...commit,
        link: { ...commit.link, role: "provider_echo" }
      }
    ];

    for (const invalid of invalidCommits) {
      expect(
        inboxV2MessageTransportAssociationCommitSchema.safeParse(invalid)
          .success
      ).toBe(false);
    }
  });

  it("rejects echo association that creates or reattributes a Message", () => {
    const commit = associationCommit();
    expect(
      inboxV2MessageTransportAssociationCommitSchema.safeParse({
        ...commit,
        message: undefined
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageTransportAssociationCommitSchema.safeParse({
        ...commit,
        afterMessage: { ...commit.message, id: "message:message-2" }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageTransportAssociationCommitSchema.safeParse({
        ...commit,
        afterMessage: {
          ...commit.message,
          authorParticipant: fixtureReference(
            "conversation_participant",
            "conversation_participant:employee-2"
          )
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageTransportAssociationCommitSchema.safeParse({
        ...commit,
        link: {
          ...commit.link,
          tenantId: otherTenantId,
          message: fixtureReference(
            "message",
            commit.link.message.id,
            otherTenantId
          ),
          sourceOccurrence: fixtureReference(
            "source_occurrence",
            commit.link.sourceOccurrence.id,
            otherTenantId
          ),
          externalMessageReference: fixtureReference(
            "external_message_reference",
            commit.link.externalMessageReference.id,
            otherTenantId
          )
        }
      }).success
    ).toBe(false);
  });

  it("rejects echo association for a wrong Message origin or occurrence kind", () => {
    const wrongMessageOrigin = associationCommit();
    const internalBefore = fixtureMessage("internal");
    expect(
      inboxV2MessageTransportAssociationCommitSchema.safeParse({
        ...wrongMessageOrigin,
        message: internalBefore
      }).success
    ).toBe(false);

    const providerResponse = fixtureOccurrence({
      origin: "provider_response",
      direction: "outbound",
      recordedAt: fixtureT3
    });
    expect(
      inboxV2MessageTransportAssociationCommitSchema.safeParse(
        associationCommit(providerResponse)
      ).success
    ).toBe(false);
  });

  it("bounds fact pages and enforces tenant plus exact-Message consistency", () => {
    const delivered = deliveryObservation("delivered");
    const validPage = {
      tenantId: fixtureTenantId,
      message: fixtureMessageReference,
      facts: [{ kind: "delivery" as const, observation: delivered }],
      snapshotToken: "snapshot:transport-page-1",
      nextCursor: null
    };
    const boundedFacts = Array.from({ length: 200 }, (_, index) => ({
      kind: "delivery" as const,
      observation: {
        ...delivered,
        id: `message_delivery_observation:page-${String(index).padStart(3, "0")}`
      }
    }));
    expect(
      inboxV2MessageTransportFactPageSchema.safeParse({
        ...validPage,
        facts: boundedFacts
      }).success
    ).toBe(true);
    expect(
      inboxV2MessageTransportFactPageSchema.safeParse({
        ...validPage,
        facts: [
          ...boundedFacts,
          {
            kind: "delivery",
            observation: {
              ...delivered,
              id: "message_delivery_observation:page-200"
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2MessageTransportFactPageSchema.safeParse({
        ...validPage,
        message: fixtureReference(
          "message",
          fixtureMessageReference.id,
          otherTenantId
        )
      }).success
    ).toBe(false);

    const otherTenantObservation = deliveryObservation("delivered", {
      tenantId: otherTenantId,
      message: fixtureReference(
        "message",
        fixtureMessageReference.id,
        otherTenantId
      ),
      scope: {
        kind: "dispatch",
        dispatch: fixtureReference(
          "outbound_dispatch",
          "outbound_dispatch:dispatch-1",
          otherTenantId
        ),
        attempt: null,
        artifact: null
      },
      sourceAccount: fixtureReference(
        "source_account",
        fixtureSourceAccountReference.id,
        otherTenantId
      ),
      sourceThreadBinding: fixtureReference(
        "source_thread_binding",
        fixtureBindingReference.id,
        otherTenantId
      ),
      evidence: {
        kind: "provider_event",
        normalizedInboundEvent: fixtureReference(
          "normalized_inbound_event",
          "normalized_inbound_event:delivery-other-tenant",
          otherTenantId
        ),
        externalMessageReference: fixtureReference(
          "external_message_reference",
          fixtureExternalMessageReference.id,
          otherTenantId
        ),
        sourceOccurrence: fixtureReference(
          "source_occurrence",
          fixtureSourceOccurrenceReference.id,
          otherTenantId
        )
      },
      semanticProof: {
        ...delivered.semanticProof,
        tenantId: otherTenantId,
        normalizedInboundEvent: fixtureReference(
          "normalized_inbound_event",
          "normalized_inbound_event:delivery-other-tenant",
          otherTenantId
        ),
        externalMessageReference: fixtureReference(
          "external_message_reference",
          fixtureExternalMessageReference.id,
          otherTenantId
        ),
        sourceOccurrence: fixtureReference(
          "source_occurrence",
          fixtureSourceOccurrenceReference.id,
          otherTenantId
        ),
        sourceAccount: fixtureReference(
          "source_account",
          fixtureSourceAccountReference.id,
          otherTenantId
        ),
        sourceThreadBinding: fixtureReference(
          "source_thread_binding",
          fixtureBindingReference.id,
          otherTenantId
        )
      }
    });
    expect(
      inboxV2MessageDeliveryObservationSchema.safeParse(otherTenantObservation)
        .success
    ).toBe(true);
    expect(
      inboxV2MessageTransportFactPageSchema.safeParse({
        ...validPage,
        facts: [{ kind: "delivery", observation: otherTenantObservation }]
      }).success
    ).toBe(false);

    const wrongMessage = deliveryObservation("delivered", {
      message: fixtureReference("message", "message:message-2")
    });
    expect(
      inboxV2MessageDeliveryObservationSchema.safeParse(wrongMessage).success
    ).toBe(true);
    expect(
      inboxV2MessageTransportFactPageSchema.safeParse({
        ...validPage,
        facts: [{ kind: "delivery", observation: wrongMessage }]
      }).success
    ).toBe(false);

    const wrongReceiptTarget = receiptObservation({
      overrides: {
        target: {
          kind: "exact_message",
          message: fixtureReference("message", "message:message-2"),
          externalMessageReference: fixtureExternalMessageReference,
          sourceOccurrence: fixtureSourceOccurrenceReference
        }
      }
    });
    expect(
      inboxV2MessageTransportFactPageSchema.safeParse({
        ...validPage,
        facts: [{ kind: "receipt", observation: wrongReceiptTarget }]
      }).success
    ).toBe(false);
  });
});
