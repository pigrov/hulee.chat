import { describe, expect, it } from "vitest";

import {
  INBOX_V2_EXTERNAL_MESSAGE_KEY_SCHEMA_ID,
  INBOX_V2_EXTERNAL_MESSAGE_REFERENCE_SCHEMA_ID,
  INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_SOURCE_OCCURRENCE_RESOLUTION_COMMIT_SCHEMA_ID,
  INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
  inboxV2ExternalMessageKeyEnvelopeSchema,
  inboxV2ExternalMessageIdentityDeclarationSchema,
  inboxV2ExternalMessageKeySchema,
  inboxV2ExternalMessageReferenceEnvelopeSchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2ExternalReferencePortabilitySchema,
  inboxV2SourceOccurrenceEnvelopeSchema,
  inboxV2SourceOccurrenceResolutionCommitEnvelopeSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema,
  inboxV2SourceOccurrenceSchema
} from "./external-message-reference";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const externalThreadId = "external_thread:thread-group-1";
const externalMessageReferenceId = "external_message_reference:reference-1";

const adapterContract = {
  contractId: "module:synthetic:direct-account-adapter",
  contractVersion: "v1",
  declarationRevision: "7",
  surfaceId: "module:synthetic:direct-account",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: "2026-07-11T09:00:00.000Z"
} as const;

function externalThreadReference(
  id = externalThreadId,
  referenceTenantId = tenantId
) {
  return {
    tenantId: referenceTenantId,
    kind: "external_thread" as const,
    id
  };
}

function sourceAccountReference(suffix = "1", referenceTenantId = tenantId) {
  return {
    tenantId: referenceTenantId,
    kind: "source_account" as const,
    id: `source_account:account-${suffix}`
  };
}

function sourceThreadBindingReference(
  suffix = "1",
  referenceTenantId = tenantId
) {
  return {
    tenantId: referenceTenantId,
    kind: "source_thread_binding" as const,
    id: `source_thread_binding:binding-${suffix}`
  };
}

function externalMessageReferenceRef(
  id = externalMessageReferenceId,
  referenceTenantId = tenantId
) {
  return {
    tenantId: referenceTenantId,
    kind: "external_message_reference" as const,
    id
  };
}

function createMessageKey(input?: {
  scopeKind?: "provider_thread" | "source_account" | "source_thread_binding";
  accountSuffix?: string;
  bindingSuffix?: string;
  threadId?: string;
  subject?: string;
  referenceTenantId?: string;
}) {
  const scopeKind = input?.scopeKind ?? "provider_thread";
  const referenceTenantId = input?.referenceTenantId ?? tenantId;
  const scope =
    scopeKind === "provider_thread"
      ? { kind: "provider_thread" as const }
      : scopeKind === "source_account"
        ? {
            kind: "source_account" as const,
            owner: sourceAccountReference(
              input?.accountSuffix,
              referenceTenantId
            )
          }
        : {
            kind: "source_thread_binding" as const,
            owner: sourceThreadBindingReference(
              input?.bindingSuffix,
              referenceTenantId
            )
          };

  return {
    realm: {
      realmId: "module:synthetic:message-realm",
      realmVersion: "v3",
      canonicalizationVersion: "v2"
    },
    scope,
    objectKindId: "module:synthetic:chat-message",
    externalThread: externalThreadReference(input?.threadId, referenceTenantId),
    canonicalExternalSubject: input?.subject ?? "Provider-Message-ID:AbC-42"
  };
}

function createMessageIdentityDeclaration(
  messageKey = createMessageKey(),
  input?: {
    decisionStrength?: "authoritative" | "safe_default";
    loadedAt?: string;
  }
) {
  return {
    adapterContract: {
      ...adapterContract,
      loadedAt: input?.loadedAt ?? adapterContract.loadedAt
    },
    identityKind: "message" as const,
    realmId: messageKey.realm.realmId,
    realmVersion: messageKey.realm.realmVersion,
    canonicalizationVersion: messageKey.realm.canonicalizationVersion,
    objectKindId: messageKey.objectKindId,
    scopeKind: messageKey.scope.kind,
    decisionStrength:
      input?.decisionStrength ??
      (messageKey.scope.kind === "provider_thread"
        ? "authoritative"
        : "safe_default")
  };
}

function createExternalMessageReference(
  messageKey = createMessageKey(),
  referenceId = externalMessageReferenceId
) {
  return {
    tenantId,
    id: referenceId,
    key: messageKey,
    identityDeclaration: createMessageIdentityDeclaration(messageKey),
    externalThread: messageKey.externalThread,
    timelineItem: {
      tenantId,
      kind: "timeline_item" as const,
      id: "timeline_item:item-1"
    },
    message: {
      tenantId,
      kind: "message" as const,
      id: "message:message-1"
    },
    revision: "1",
    createdAt: "2026-07-11T09:00:03.000Z"
  };
}

function createOccurrence(input?: {
  accountSuffix?: string;
  bindingSuffix?: string;
  messageKey?: ReturnType<typeof createMessageKey>;
  messageIdentityDeclaration?: ReturnType<
    typeof createMessageIdentityDeclaration
  >;
  occurrenceSuffix?: string;
  originKind?:
    | "webhook"
    | "stream"
    | "poll"
    | "history"
    | "provider_echo"
    | "provider_response";
  direction?: "inbound" | "outbound" | "system";
  portabilityKind?: "binding_only" | "external_thread" | "provider_global";
  portabilityStrength?: "authoritative" | "safe_default";
  resolutionState?: "pending" | "resolved" | "conflicted";
}) {
  const accountSuffix = input?.accountSuffix ?? "1";
  const bindingSuffix = input?.bindingSuffix ?? "1";
  const occurrenceSuffix = input?.occurrenceSuffix ?? "1";
  const messageKey = input?.messageKey ?? createMessageKey();
  const messageIdentityDeclaration =
    input?.messageIdentityDeclaration ??
    createMessageIdentityDeclaration(messageKey);
  const originKind = input?.originKind ?? "webhook";
  const direction =
    input?.direction ??
    (originKind === "provider_response" || originKind === "provider_echo"
      ? "outbound"
      : "inbound");
  const sourceAccount = sourceAccountReference(accountSuffix);
  const origin =
    originKind === "provider_response"
      ? {
          kind: "provider_response" as const,
          sourceAccount,
          outboundDispatchAttempt: {
            tenantId,
            kind: "outbound_dispatch_attempt" as const,
            id: `outbound_dispatch_attempt:attempt-${occurrenceSuffix}`
          }
        }
      : {
          kind: originKind,
          sourceAccount,
          rawInboundEvent: {
            tenantId,
            kind: "raw_inbound_event" as const,
            id: `raw_inbound_event:raw-${occurrenceSuffix}`
          },
          normalizedInboundEvent: {
            tenantId,
            kind: "normalized_inbound_event" as const,
            id: `normalized_inbound_event:normalized-${occurrenceSuffix}`
          }
        };
  const resolutionState = input?.resolutionState ?? "resolved";
  const resolution =
    resolutionState === "resolved"
      ? {
          state: "resolved" as const,
          externalMessageReference: externalMessageReferenceRef()
        }
      : resolutionState === "pending"
        ? {
            state: "pending" as const,
            diagnostic: {
              codeId: "core:message-reference-pending",
              retryable: true,
              correlationToken: `correlation-${occurrenceSuffix}`,
              safeOperatorHintId: null
            }
          }
        : {
            state: "conflicted" as const,
            candidateExternalMessageReferences: [
              externalMessageReferenceRef(
                "external_message_reference:candidate-1"
              ),
              externalMessageReferenceRef(
                "external_message_reference:candidate-2"
              )
            ],
            diagnostic: {
              codeId: "core:message-reference-conflicted",
              retryable: false,
              correlationToken: `correlation-${occurrenceSuffix}`,
              safeOperatorHintId: "core:inspect-source-evidence"
            }
          };

  return {
    tenantId,
    id: `source_occurrence:occurrence-${occurrenceSuffix}`,
    messageKey,
    messageIdentityDeclaration,
    bindingContext: {
      externalThread: messageKey.externalThread,
      sourceAccount,
      sourceThreadBinding: sourceThreadBindingReference(bindingSuffix),
      bindingGeneration: "3"
    },
    origin,
    descriptor: {
      adapterContract: messageIdentityDeclaration.adapterContract,
      descriptorSchemaId: "module:synthetic:normalized-message-observation",
      descriptorVersion: "v4",
      capabilityRevision: "9",
      providerReferences: [
        {
          kindId: "module:synthetic:external-message-id",
          subject: messageKey.canonicalExternalSubject
        },
        {
          kindId: "module:synthetic:external-thread-id",
          subject: "group:42"
        }
      ],
      descriptorDigestSha256: "a".repeat(64)
    },
    providerActor:
      originKind === "provider_response" || originKind === "provider_echo"
        ? null
        : direction === "system"
          ? {
              kind: "provider_system" as const,
              actorKindId: "module:synthetic:service-event",
              actorSubject: "provider-system"
            }
          : {
              kind: "source_external_identity" as const,
              sourceExternalIdentity: {
                tenantId,
                kind: "source_external_identity" as const,
                id: `source_external_identity:actor-${occurrenceSuffix}`
              }
            },
    direction,
    providerTimestamps: [
      {
        kindId: "module:synthetic:sent-at",
        timestamp: "2026-07-11T09:00:01.000Z"
      }
    ],
    referencePortability: {
      kind: input?.portabilityKind ?? "binding_only",
      adapterContract: messageIdentityDeclaration.adapterContract,
      decisionStrength:
        input?.portabilityStrength ??
        (input?.portabilityKind && input.portabilityKind !== "binding_only"
          ? "authoritative"
          : "safe_default")
    },
    resolution,
    observedAt: "2026-07-11T09:00:02.000Z",
    recordedAt: "2026-07-11T09:00:03.000Z",
    revision: resolutionState === "pending" ? "1" : "2",
    createdAt: "2026-07-11T09:00:03.000Z",
    updatedAt:
      resolutionState === "pending"
        ? "2026-07-11T09:00:03.000Z"
        : "2026-07-11T09:00:04.000Z"
  };
}

describe("Inbox V2 external message identity", () => {
  it("accepts provider-thread group identity only with authoritative adapter evidence", () => {
    expect(
      inboxV2ExternalMessageKeySchema.parse(createMessageKey())
    ).toMatchObject({
      canonicalExternalSubject: "Provider-Message-ID:AbC-42",
      scope: { kind: "provider_thread" }
    });

    expect(
      inboxV2ExternalMessageIdentityDeclarationSchema.safeParse(
        createMessageIdentityDeclaration(createMessageKey(), {
          decisionStrength: "authoritative"
        })
      ).success
    ).toBe(true);
    expect(
      inboxV2ExternalMessageIdentityDeclarationSchema.safeParse(
        createMessageIdentityDeclaration(createMessageKey(), {
          decisionStrength: "safe_default"
        })
      ).success
    ).toBe(false);
  });

  it.each([
    ["source_account", { accountSuffix: "7" }],
    ["source_thread_binding", { bindingSuffix: "7" }]
  ] as const)("supports safe exact %s scope", (scopeKind, identifiers) => {
    expect(
      inboxV2ExternalMessageKeySchema.safeParse(
        createMessageKey({ scopeKind, ...identifiers })
      ).success
    ).toBe(true);
  });

  it("rejects declaration/scope disagreement and unsupported connection scope", () => {
    const key = createMessageKey({ scopeKind: "source_account" });
    const reference = createExternalMessageReference(key);

    expect(
      inboxV2ExternalMessageReferenceSchema.safeParse({
        ...reference,
        identityDeclaration: {
          ...reference.identityDeclaration,
          scopeKind: "provider_thread"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2ExternalMessageIdentityDeclarationSchema.safeParse({
        ...reference.identityDeclaration,
        scopeKind: "source_connection"
      }).success
    ).toBe(false);
    expect(
      inboxV2ExternalMessageIdentityDeclarationSchema.safeParse({
        ...reference.identityDeclaration,
        identityKind: "external_thread"
      }).success
    ).toBe(false);
  });

  it("keeps opaque subject case and rejects weak content/time/sender identity", () => {
    const upper = inboxV2ExternalMessageKeySchema.parse(
      createMessageKey({ subject: "Message-ID:AbC" })
    );
    const lower = inboxV2ExternalMessageKeySchema.parse(
      createMessageKey({ subject: "message-id:abc" })
    );

    expect(upper.canonicalExternalSubject).not.toBe(
      lower.canonicalExternalSubject
    );

    for (const [field, value] of [
      ["body", "same body"],
      ["text", "same body"],
      ["sender", "client:42"],
      ["occurredAt", "2026-07-11T09:00:00.000Z"],
      ["displayName", "Same Person"]
    ]) {
      expect(
        inboxV2ExternalMessageKeySchema.safeParse({
          ...createMessageKey(),
          [field]: value
        }).success
      ).toBe(false);
    }
  });

  it("requires scope owners and thread references to use the key tenant", () => {
    expect(
      inboxV2ExternalMessageKeySchema.safeParse(
        createMessageKey({
          scopeKind: "source_account",
          referenceTenantId: otherTenantId
        })
      ).success
    ).toBe(true);

    const key = createMessageKey({ scopeKind: "source_account" });
    expect(
      inboxV2ExternalMessageKeySchema.safeParse({
        ...key,
        scope: {
          kind: "source_account",
          owner: sourceAccountReference("1", otherTenantId)
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2ExternalMessageKeySchema.safeParse({
        ...key,
        externalThread: externalThreadReference(undefined, otherTenantId)
      }).success
    ).toBe(false);
  });
});

describe("Inbox V2 immutable external message reference", () => {
  it("maps one exact key to one thread, TimelineItem and Message", () => {
    expect(
      inboxV2ExternalMessageReferenceSchema.parse(
        createExternalMessageReference()
      )
    ).toMatchObject({
      id: externalMessageReferenceId,
      revision: "1",
      timelineItem: { id: "timeline_item:item-1" },
      message: { id: "message:message-1" }
    });
  });

  it.each([
    {
      externalThread: externalThreadReference("external_thread:thread-other")
    },
    {
      timelineItem: {
        tenantId: otherTenantId,
        kind: "timeline_item",
        id: "timeline_item:item-1"
      }
    },
    { revision: "2" },
    { updatedAt: "2026-07-11T09:00:04.000Z" },
    { occurrences: [] }
  ])(
    "rejects mutable, cross-thread or aggregate reference state",
    (override) => {
      expect(
        inboxV2ExternalMessageReferenceSchema.safeParse({
          ...createExternalMessageReference(),
          ...override
        }).success
      ).toBe(false);
    }
  );
});

describe("Inbox V2 SourceOccurrence", () => {
  it.each(["webhook", "stream", "poll", "history"] as const)(
    "retains raw and normalized evidence for %s origin",
    (originKind) => {
      const result = inboxV2SourceOccurrenceSchema.parse(
        createOccurrence({ originKind })
      );

      expect(result.origin.kind).toBe(originKind);
      if (result.origin.kind !== "provider_response") {
        expect(result.origin.rawInboundEvent.kind).toBe("raw_inbound_event");
        expect(result.origin.normalizedInboundEvent.kind).toBe(
          "normalized_inbound_event"
        );
      }
    }
  );

  it("accepts provider response through its exact dispatch attempt", () => {
    const result = inboxV2SourceOccurrenceSchema.parse(
      createOccurrence({ originKind: "provider_response" })
    );

    expect(result.direction).toBe("outbound");
    expect(result.providerActor).toBeNull();
    expect(result.origin).toMatchObject({
      kind: "provider_response",
      outboundDispatchAttempt: {
        id: "outbound_dispatch_attempt:attempt-1"
      }
    });
  });

  it("records provider echo as outbound raw plus normalized evidence", () => {
    expect(
      inboxV2SourceOccurrenceSchema.safeParse(
        createOccurrence({ originKind: "provider_echo" })
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse(
        createOccurrence({
          originKind: "provider_echo",
          direction: "inbound"
        })
      ).success
    ).toBe(false);
  });

  it("requires a proven native actor for provider-originated outbound events", () => {
    const nativeOutbound = createOccurrence({
      originKind: "webhook",
      direction: "outbound"
    });

    expect(
      inboxV2SourceOccurrenceSchema.safeParse(nativeOutbound).success
    ).toBe(true);
    expect(nativeOutbound.providerActor).toMatchObject({
      kind: "source_external_identity"
    });
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...nativeOutbound,
        providerActor: null
      }).success
    ).toBe(false);
  });

  it.each(["pending", "resolved", "conflicted"] as const)(
    "supports explicit %s resolution state",
    (resolutionState) => {
      expect(
        inboxV2SourceOccurrenceSchema.safeParse(
          createOccurrence({ resolutionState })
        ).success
      ).toBe(true);
    }
  );

  it("requires distinct conflict candidates and state-specific fields", () => {
    const occurrence = createOccurrence({ resolutionState: "conflicted" });
    const duplicate = externalMessageReferenceRef(
      "external_message_reference:candidate-1"
    );

    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        resolution: {
          ...occurrence.resolution,
          candidateExternalMessageReferences: [duplicate, duplicate]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...createOccurrence({ resolutionState: "pending" }),
        resolution: {
          state: "pending",
          diagnostic: {
            codeId: "core:message-reference-pending",
            retryable: true,
            correlationToken: "correlation-pending",
            safeOperatorHintId: null
          },
          externalMessageReference: externalMessageReferenceRef()
        }
      }).success
    ).toBe(false);
  });

  it("enforces exact account, binding and thread agreement", () => {
    const accountScopedKey = createMessageKey({
      scopeKind: "source_account",
      accountSuffix: "1"
    });
    const bindingScopedKey = createMessageKey({
      scopeKind: "source_thread_binding",
      bindingSuffix: "1"
    });

    expect(
      inboxV2SourceOccurrenceSchema.safeParse(
        createOccurrence({ messageKey: accountScopedKey, accountSuffix: "2" })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse(
        createOccurrence({ messageKey: bindingScopedKey, bindingSuffix: "2" })
      ).success
    ).toBe(false);

    const occurrence = createOccurrence();
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        bindingContext: {
          ...occurrence.bindingContext,
          externalThread: externalThreadReference(
            "external_thread:thread-other"
          )
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        origin: {
          ...occurrence.origin,
          sourceAccount: sourceAccountReference("2")
        }
      }).success
    ).toBe(false);
  });

  it("requires descriptor and portability to use the pinned adapter snapshot", () => {
    const occurrence = createOccurrence();
    const changedAdapterContract = {
      ...adapterContract,
      declarationRevision: "8"
    };

    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        descriptor: {
          ...occurrence.descriptor,
          adapterContract: changedAdapterContract
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        referencePortability: {
          ...occurrence.referencePortability,
          adapterContract: changedAdapterContract
        }
      }).success
    ).toBe(false);
  });

  it("requires authoritative evidence for cross-binding portability", () => {
    expect(
      inboxV2ExternalReferencePortabilitySchema.safeParse({
        kind: "binding_only",
        adapterContract,
        decisionStrength: "safe_default"
      }).success
    ).toBe(true);

    for (const kind of ["external_thread", "provider_global"] as const) {
      expect(
        inboxV2ExternalReferencePortabilitySchema.safeParse({
          kind,
          adapterContract,
          decisionStrength: "safe_default"
        }).success
      ).toBe(false);
      expect(
        inboxV2SourceOccurrenceSchema.safeParse(
          createOccurrence({
            portabilityKind: kind,
            portabilityStrength: "authoritative"
          })
        ).success
      ).toBe(true);
    }
  });

  it("rejects cross-tenant evidence, transport-account actors and resolutions", () => {
    const occurrence = createOccurrence({ originKind: "provider_response" });

    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        providerActor: {
          kind: "source_account",
          sourceAccount: sourceAccountReference("1")
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        resolution: {
          state: "resolved",
          externalMessageReference: externalMessageReferenceRef(
            undefined,
            otherTenantId
          )
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        origin: {
          ...occurrence.origin,
          outboundDispatchAttempt: {
            tenantId: otherTenantId,
            kind: "outbound_dispatch_attempt",
            id: "outbound_dispatch_attempt:attempt-1"
          }
        }
      }).success
    ).toBe(false);
  });

  it("keeps provider actor/system direction separate from app authority", () => {
    const occurrence = createOccurrence();

    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        direction: "system",
        providerActor: {
          kind: "provider_system",
          actorKindId: "module:synthetic:service-event",
          actorSubject: "provider-system"
        }
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        providerActor: {
          kind: "provider_system",
          actorKindId: "module:synthetic:service-event",
          actorSubject: "provider-system"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        providerRoleIds: ["module:synthetic:admin"],
        employeePermissionIds: ["core:inbox-send"]
      }).success
    ).toBe(false);
  });

  it("validates bounded unique provider facts and immutable observation time", () => {
    const occurrence = createOccurrence();

    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        descriptor: {
          ...occurrence.descriptor,
          providerReferences: [
            occurrence.descriptor.providerReferences[0],
            occurrence.descriptor.providerReferences[0]
          ]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        providerTimestamps: [
          occurrence.providerTimestamps[0],
          occurrence.providerTimestamps[0]
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        recordedAt: "2026-07-11T09:00:01.000Z"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        createdAt: "2026-07-11T09:00:02.000Z"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceSchema.safeParse({
        ...occurrence,
        updatedAt: "2026-07-11T09:00:02.000Z"
      }).success
    ).toBe(false);
  });

  it("rejects lifetime aggregates and untyped observation payloads", () => {
    for (const [field, value] of [
      ["allOccurrences", []],
      ["occurrenceCount", 42],
      ["body", "provider payload"],
      ["rawPayload", { text: "secret" }],
      ["senderDisplayName", "Display only"]
    ] as const) {
      expect(
        inboxV2SourceOccurrenceSchema.safeParse({
          ...createOccurrence(),
          [field]: value
        }).success
      ).toBe(false);
    }
  });
});

describe("Inbox V2 bounded occurrence resolution commit", () => {
  function resolutionCommit(
    before: ReturnType<typeof createOccurrence>,
    reference: ReturnType<typeof createExternalMessageReference>
  ) {
    return {
      tenantId,
      expectedRevision: before.revision,
      resultingRevision: "2",
      changedAt: "2026-07-11T09:00:04.000Z",
      resolver: {
        kind: "trusted_service" as const,
        trustedServiceId: "core:source-runtime",
        resolutionToken: "resolution-token-1"
      },
      before,
      after: {
        ...before,
        resolution: {
          state: "resolved" as const,
          externalMessageReference: externalMessageReferenceRef(reference.id)
        },
        revision: "2",
        updatedAt: "2026-07-11T09:00:04.000Z"
      },
      resolvedReference: reference
    };
  }

  it("allows two accounts to attach exact occurrences to one provider-thread message", () => {
    const messageKey = createMessageKey();
    const reference = createExternalMessageReference(messageKey);
    const firstOccurrence = createOccurrence({
      messageKey,
      accountSuffix: "1",
      bindingSuffix: "1",
      occurrenceSuffix: "1",
      resolutionState: "pending"
    });
    const secondOccurrence = createOccurrence({
      messageKey,
      messageIdentityDeclaration: createMessageIdentityDeclaration(messageKey, {
        loadedAt: "2026-07-11T09:05:00.000Z"
      }),
      accountSuffix: "2",
      bindingSuffix: "2",
      occurrenceSuffix: "2",
      resolutionState: "pending"
    });

    expect(
      inboxV2SourceOccurrenceResolutionCommitSchema.safeParse(
        resolutionCommit(firstOccurrence, reference)
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceOccurrenceResolutionCommitSchema.safeParse(
        resolutionCommit(secondOccurrence, reference)
      ).success
    ).toBe(true);
  });

  it("rejects stale, identity-changing, unresolved and terminal-overwrite commits", () => {
    const messageKey = createMessageKey();
    const reference = createExternalMessageReference(messageKey);
    const before = createOccurrence({
      messageKey,
      resolutionState: "pending"
    });
    const valid = resolutionCommit(before, reference);

    for (const invalid of [
      { ...valid, expectedRevision: "2" },
      {
        ...valid,
        after: {
          ...valid.after,
          messageKey: createMessageKey({ subject: "different-message" })
        }
      },
      {
        ...valid,
        after: {
          ...valid.after,
          resolution: before.resolution
        },
        resolvedReference: null
      },
      {
        ...valid,
        after: {
          ...valid.after,
          resolution: {
            state: "resolved" as const,
            externalMessageReference: externalMessageReferenceRef(
              "external_message_reference:other"
            )
          }
        }
      },
      {
        ...valid,
        before: createOccurrence({ messageKey, resolutionState: "resolved" })
      },
      {
        ...valid,
        resolver: {
          ...valid.resolver,
          trustedServiceId: "core:foreign-runtime"
        }
      },
      {
        ...valid,
        changedAt: "2026-07-11T08:59:00.000Z",
        after: {
          ...valid.after,
          updatedAt: "2026-07-11T08:59:00.000Z"
        }
      }
    ]) {
      expect(
        inboxV2SourceOccurrenceResolutionCommitSchema.safeParse(invalid).success
      ).toBe(false);
    }
  });

  it("supports a fenced pending-to-conflicted decision without claiming a reference", () => {
    const before = createOccurrence({ resolutionState: "pending" });
    const conflicted = createOccurrence({ resolutionState: "conflicted" });

    expect(
      inboxV2SourceOccurrenceResolutionCommitSchema.safeParse({
        tenantId,
        expectedRevision: "1",
        resultingRevision: "2",
        changedAt: conflicted.updatedAt,
        resolver: {
          kind: "trusted_service",
          trustedServiceId: "core:source-runtime",
          resolutionToken: "resolution-token-conflict"
        },
        before,
        after: { ...conflicted, id: before.id },
        resolvedReference: null
      }).success
    ).toBe(true);
  });
});

describe("Inbox V2 external message envelopes", () => {
  it("pins exact schema IDs and v1", () => {
    const key = createMessageKey();
    const reference = createExternalMessageReference(key);
    const occurrence = createOccurrence({ messageKey: key });

    expect(
      inboxV2ExternalMessageKeyEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_EXTERNAL_MESSAGE_KEY_SCHEMA_ID,
        schemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
        payload: key
      }).success
    ).toBe(true);
    expect(
      inboxV2ExternalMessageReferenceEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_EXTERNAL_MESSAGE_REFERENCE_SCHEMA_ID,
        schemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
        payload: reference
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceOccurrenceEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
        schemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
        payload: occurrence
      }).success
    ).toBe(true);

    expect(
      inboxV2SourceOccurrenceEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
        schemaVersion: "v2",
        payload: occurrence
      }).success
    ).toBe(false);

    const pending = createOccurrence({
      messageKey: key,
      resolutionState: "pending"
    });
    const resolutionCommit = {
      tenantId,
      expectedRevision: "1",
      resultingRevision: "2",
      changedAt: "2026-07-11T09:00:04.000Z",
      resolver: {
        kind: "trusted_service" as const,
        trustedServiceId: "core:source-runtime",
        resolutionToken: "resolution-token-envelope"
      },
      before: pending,
      after: {
        ...pending,
        resolution: occurrence.resolution,
        revision: "2",
        updatedAt: "2026-07-11T09:00:04.000Z"
      },
      resolvedReference: reference
    };
    expect(
      inboxV2SourceOccurrenceResolutionCommitEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SOURCE_OCCURRENCE_RESOLUTION_COMMIT_SCHEMA_ID,
        schemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
        payload: resolutionCommit
      }).success
    ).toBe(true);
  });
});
