import { describe, expect, it } from "vitest";

import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  assertInboxV2SourceNormalizerDeterministic,
  assertInboxV2SourceNormalizationCandidateBatch,
  defineInboxV2SourceNormalizer,
  defineInboxV2SourceNormalizerProfile,
  executeInboxV2SourceNormalizer,
  INBOX_V2_SOURCE_NORMALIZATION_MAX_EVENTS_PER_RAW,
  INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_EVENT,
  INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_RAW,
  isInboxV2SourceNormalizationCandidateBatch,
  isInboxV2SourceNormalizer,
  isInboxV2SourceNormalizerProfile,
  type InboxV2SourceNormalizationInput,
  type InboxV2SourceNormalizedEventDraft,
  type InboxV2SourceNormalizerDecision,
  type InboxV2SourceNormalizerHandler
} from "./source-normalized-ingress";

const t0 = "2026-07-16T08:00:00.000Z";
const tenantId = "tenant:alpha";
const sourceConnectionId = "source_connection:synthetic-1";
const sourceAccountId = "source_account:synthetic-1";

const adapterContract = {
  contractId: "module:synthetic:source-adapter",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "core:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

const rawIngressSanitizer = {
  profileSchemaId: "core:inbox-v2.raw-ingress-sanitizer-profile",
  profileSchemaVersion: "v1",
  handlerId: "module:synthetic:sanitize",
  handlerVersion: "v1",
  declarationRevision: "1",
  restrictedPayloadSchema: {
    schemaId: "module:synthetic:raw-event",
    schemaVersion: "v1"
  }
} as const;

function sourceAccountReference(id = sourceAccountId) {
  return { tenantId, kind: "source_account" as const, id };
}

function threadDeclaration() {
  return {
    adapterContract,
    identityKind: "external_thread" as const,
    realmId: "module:synthetic:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:chat",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function messageDeclaration() {
  return {
    adapterContract,
    identityKind: "message" as const,
    realmId: "module:synthetic:message-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:message",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function senderDeclaration() {
  return {
    adapterContract,
    identityKind: "source_external_identity" as const,
    realmId: "module:synthetic:sender-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:user",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function profileInput() {
  const identityDeclarations = [
    threadDeclaration(),
    messageDeclaration(),
    senderDeclaration()
  ].sort((left, right) =>
    String(calculateInboxV2CanonicalSha256(left)).localeCompare(
      String(calculateInboxV2CanonicalSha256(right))
    )
  );
  return {
    schemaId: "core:inbox-v2.source-normalizer-profile" as const,
    schemaVersion: "v1" as const,
    payload: {
      adapterContract,
      handlerId: "module:synthetic:normalize",
      handlerVersion: "v1",
      declarationRevision: "1",
      rawIngressSanitizer,
      eventKinds: [
        "membership_changed" as const,
        "message_created" as const,
        "message_edited" as const,
        "roster_observed" as const
      ],
      identityDeclarations,
      evidenceSlots: [
        {
          slotId: "module:synthetic:message-content",
          schemaId: "module:synthetic:message-content",
          schemaVersion: "v1",
          dataClassId: "core:normalized_event_payload" as const,
          purposeIds: ["core:source_replay_and_diagnostics" as const]
        }
      ]
    }
  };
}

function rawInput(
  overrides: Partial<InboxV2SourceNormalizationInput> = {}
): InboxV2SourceNormalizationInput {
  return {
    tenantId,
    rawEventId: "raw_inbound_event:raw-1",
    sourceConnectionId,
    sourceAccountId,
    transport: "webhook",
    providerOccurredAt: t0,
    rawIngressSanitizer,
    restrictedPayload: { eventId: "provider-event-1" },
    ...overrides
  };
}

function identityObservation(
  observationKey = "author-0001",
  subject = "User-ABC"
) {
  return {
    observationKey,
    purpose: "message_author" as const,
    identityDeclaration: senderDeclaration(),
    realm: {
      realmId: "module:synthetic:sender-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "source_account" as const, owner: sourceAccountReference() },
    objectKindId: "module:synthetic:user",
    observedExternalSubject: subject,
    canonicalExternalSubject: subject,
    stability: "stable" as const,
    observedAt: t0
  };
}

function messageEvent(): InboxV2SourceNormalizedEventDraft {
  return {
    direction: "inbound",
    visibility: "public",
    payloadVersion: "v1",
    providerOccurredAt: t0,
    semantic: {
      kind: "message_created",
      originKind: "webhook",
      authorObservationKey: "author-0001"
    },
    thread: {
      identityDeclaration: threadDeclaration(),
      key: {
        realm: {
          realmId: "module:synthetic:thread-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: {
          kind: "source_account",
          owner: sourceAccountReference()
        },
        objectKindId: "module:synthetic:chat",
        canonicalExternalSubject: "Chat-ABC"
      },
      observedExternalSubject: "Chat-ABC"
    },
    message: {
      identityDeclaration: messageDeclaration(),
      realm: {
        realmId: "module:synthetic:message-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1"
      },
      scope: { kind: "source_account", owner: sourceAccountReference() },
      objectKindId: "module:synthetic:message",
      observedExternalSubject: "Message-ABC",
      canonicalExternalSubject: "Message-ABC"
    },
    identityObservations: [identityObservation()],
    rosterObservation: null,
    capabilityObservation: {
      schemaId: "module:synthetic:capabilities",
      schemaVersion: "v1",
      capabilities: []
    },
    evidence: [
      {
        slotId: "module:synthetic:message-content",
        value: { text: "classified-message-content" }
      }
    ]
  };
}

function createNormalizer(
  handler: InboxV2SourceNormalizerHandler,
  evidenceParser: (value: unknown) => unknown = (value) => value
) {
  const profile = defineInboxV2SourceNormalizerProfile(profileInput());
  const normalizer = defineInboxV2SourceNormalizer({
    profile,
    parseRestrictedPayload: (value) => value,
    evidenceParsers: {
      "module:synthetic:message-content": evidenceParser
    },
    handler
  });
  return { profile, normalizer };
}

function emitted(
  event: InboxV2SourceNormalizedEventDraft = messageEvent()
): InboxV2SourceNormalizerDecision {
  return { outcome: "emitted", events: [event] };
}

function ownProtoJsonObject(): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  Object.defineProperty(value, "__proto__", {
    value: { polluted: "must-remain-inert-data" },
    enumerable: true,
    configurable: true,
    writable: true
  });
  value.message = "safe";
  return value;
}

function unsafeJsonValueFactories(): readonly Readonly<{
  name: string;
  create: () => Readonly<{
    value: unknown;
    getterReads?: () => number;
  }>;
}>[] {
  return [
    {
      name: "sparse array",
      create: () => {
        const value: unknown[] = [];
        value.length = 2;
        value[1] = "safe";
        return { value };
      }
    },
    {
      name: "array getter",
      create: () => {
        let reads = 0;
        const value = ["safe"];
        Object.defineProperty(value, "0", {
          enumerable: true,
          configurable: true,
          get: () => {
            reads += 1;
            return "must-not-run";
          }
        });
        return { value, getterReads: () => reads };
      }
    },
    {
      name: "object getter",
      create: () => {
        let reads = 0;
        const value = Object.defineProperty({}, "message", {
          enumerable: true,
          configurable: true,
          get: () => {
            reads += 1;
            return "must-not-run";
          }
        });
        return { value, getterReads: () => reads };
      }
    },
    {
      name: "symbol property",
      create: () => {
        const value = { message: "safe" } as Record<PropertyKey, unknown>;
        value[Symbol("hidden")] = "must-not-copy";
        return { value };
      }
    },
    {
      name: "custom array property",
      create: () => {
        const value = ["safe"] as unknown[] & { extra?: string };
        value.extra = "must-not-copy";
        return { value };
      }
    },
    {
      name: "NUL key",
      create: () => ({ value: { ["unsafe\u0000key"]: "safe" } })
    },
    {
      name: "NUL value",
      create: () => ({ value: { message: "unsafe\u0000value" } })
    }
  ];
}

describe("Inbox V2 source-normalizer contract", () => {
  it("authenticates profiles and capabilities, rejecting schema-valid clones", () => {
    const { profile, normalizer } = createNormalizer(() => ({
      outcome: "ignored",
      reasonCode: "source.event_not_actionable"
    }));

    expect(isInboxV2SourceNormalizerProfile(profile)).toBe(true);
    expect(isInboxV2SourceNormalizerProfile(structuredClone(profile))).toBe(
      false
    );
    expect(isInboxV2SourceNormalizer(normalizer)).toBe(true);
    expect(isInboxV2SourceNormalizer(structuredClone(normalizer))).toBe(false);
    expect(() =>
      defineInboxV2SourceNormalizer({
        profile: structuredClone(profile),
        parseRestrictedPayload: (value) => value,
        evidenceParsers: {
          "module:synthetic:message-content": (value) => value
        },
        handler: () => ({
          outcome: "ignored",
          reasonCode: "source.event_not_actionable"
        })
      })
    ).toThrow(/authentic/iu);
  });

  it("creates deterministic frozen ignored and emitted candidates", async () => {
    const ignoredNormalizer = createNormalizer(() => ({
      outcome: "ignored",
      reasonCode: "source.event_not_actionable"
    })).normalizer;
    const ignoredLeft = await executeInboxV2SourceNormalizer({
      normalizer: ignoredNormalizer,
      raw: rawInput()
    });
    const ignoredRight = await executeInboxV2SourceNormalizer({
      normalizer: ignoredNormalizer,
      raw: rawInput()
    });

    expect(ignoredLeft).toMatchObject({
      outcome: "ignored",
      ignoredReasonCode: "source.event_not_actionable",
      events: []
    });
    expect(ignoredLeft).toEqual(ignoredRight);

    const emittedNormalizer = createNormalizer(() => emitted()).normalizer;
    const emittedLeft = await executeInboxV2SourceNormalizer({
      normalizer: emittedNormalizer,
      raw: rawInput()
    });
    const emittedRight = await executeInboxV2SourceNormalizer({
      normalizer: emittedNormalizer,
      raw: rawInput()
    });

    expect(emittedLeft.events.map(({ ordinal }) => ordinal)).toEqual([0]);
    expect(emittedLeft).toEqual(emittedRight);
    expect(emittedLeft.events[0]?.structuralEnvelopeDigest).toBe(
      emittedRight.events[0]?.structuralEnvelopeDigest
    );
    expect(Object.isFrozen(emittedLeft)).toBe(true);
    expect(Object.isFrozen(emittedLeft.events[0]?.thread)).toBe(true);
  });

  it("authenticates candidate batches and rejects forged copies", async () => {
    const candidate = await executeInboxV2SourceNormalizer({
      normalizer: createNormalizer(() => emitted()).normalizer,
      raw: rawInput()
    });
    const forged = structuredClone(candidate);

    expect(isInboxV2SourceNormalizationCandidateBatch(candidate)).toBe(true);
    expect(assertInboxV2SourceNormalizationCandidateBatch(candidate)).toBe(
      candidate
    );
    expect(isInboxV2SourceNormalizationCandidateBatch(forged)).toBe(false);
    expect(() =>
      assertInboxV2SourceNormalizationCandidateBatch(forged)
    ).toThrow(/authentic/iu);
  });

  it("preserves exact case, surrounding spaces and Unicode form", async () => {
    const event = messageEvent();
    const nfdSender = " User-e\u0301 ";
    event.thread.observedExternalSubject = " Chat-Ä ";
    event.thread.key.canonicalExternalSubject = " Chat-Ä ";
    if (event.message === null) throw new Error("Expected message fixture.");
    event.message.observedExternalSubject = " Message-É ";
    event.message.canonicalExternalSubject = " Message-É ";
    event.identityObservations = [
      identityObservation("author-0001", nfdSender)
    ];

    const candidate = await executeInboxV2SourceNormalizer({
      normalizer: createNormalizer(() => emitted(event)).normalizer,
      raw: rawInput()
    });
    const normalized = candidate.events[0];

    expect(normalized?.thread.key.canonicalExternalSubject).toBe(" Chat-Ä ");
    expect(normalized?.message?.canonicalExternalSubject).toBe(" Message-É ");
    expect(normalized?.identityObservations[0]?.canonicalExternalSubject).toBe(
      nfdSender
    );
    expect(
      normalized?.identityObservations[0]?.canonicalExternalSubject
    ).not.toBe(nfdSender.normalize("NFC"));
  });

  it.each([
    [
      "thread case-fold",
      (event: InboxV2SourceNormalizedEventDraft) => {
        event.thread.observedExternalSubject = "Chat-ABC";
        event.thread.key.canonicalExternalSubject = "chat-abc";
      }
    ],
    [
      "message trim",
      (event: InboxV2SourceNormalizedEventDraft) => {
        if (event.message === null)
          throw new Error("Expected message fixture.");
        event.message.observedExternalSubject = " Message-ABC ";
        event.message.canonicalExternalSubject = "Message-ABC";
      }
    ],
    [
      "sender Unicode normalization",
      (event: InboxV2SourceNormalizedEventDraft) => {
        event.identityObservations[0]!.observedExternalSubject = "é";
        event.identityObservations[0]!.canonicalExternalSubject = "e\u0301";
      }
    ]
  ])("rejects unsafe opaque canonicalization: %s", async (_name, mutate) => {
    const event = messageEvent();
    mutate(event);
    const normalizer = createNormalizer(() => emitted(event)).normalizer;

    await expect(
      executeInboxV2SourceNormalizer({ normalizer, raw: rawInput() })
    ).rejects.toMatchObject({ code: "source.normalizer_output_invalid" });
  });

  it("rejects unknown raw-provider fragments in the normalized core shape", async () => {
    const unsafeEvent = {
      ...messageEvent(),
      rawProviderPayload: { update: "must-not-enter-core-envelope" }
    } as unknown as InboxV2SourceNormalizedEventDraft;
    const normalizer = createNormalizer(() => emitted(unsafeEvent)).normalizer;

    await expect(
      executeInboxV2SourceNormalizer({ normalizer, raw: rawInput() })
    ).rejects.toMatchObject({ code: "source.normalizer_output_invalid" });
  });

  it.each([
    [
      "thread",
      (event: InboxV2SourceNormalizedEventDraft) => {
        if (event.thread.key.scope.kind !== "source_account") {
          throw new Error("Expected account-scoped thread fixture.");
        }
        event.thread.key.scope.owner = sourceAccountReference(
          "source_account:other"
        );
      }
    ],
    [
      "message",
      (event: InboxV2SourceNormalizedEventDraft) => {
        if (event.message?.scope.kind !== "source_account") {
          throw new Error("Expected account-scoped message fixture.");
        }
        event.message.scope.owner = sourceAccountReference(
          "source_account:other"
        );
      }
    ],
    [
      "sender",
      (event: InboxV2SourceNormalizedEventDraft) => {
        const sender = event.identityObservations[0];
        if (sender?.scope.kind !== "source_account") {
          throw new Error("Expected account-scoped sender fixture.");
        }
        sender.scope.owner = sourceAccountReference("source_account:other");
      }
    ]
  ])(
    "rejects an exact %s scope that disagrees with the raw account",
    async (_name, mutate) => {
      const event = messageEvent();
      mutate(event);
      const normalizer = createNormalizer(() => emitted(event)).normalizer;

      await expect(
        executeInboxV2SourceNormalizer({ normalizer, raw: rawInput() })
      ).rejects.toMatchObject({ code: "source.normalized_scope_missing" });
    }
  );

  it("rejects lifecycle events without an exact target message", async () => {
    const event = messageEvent();
    event.semantic = {
      kind: "message_edited",
      actorObservationKey: null
    };
    event.message = null;
    const normalizer = createNormalizer(() => emitted(event)).normalizer;

    await expect(
      executeInboxV2SourceNormalizer({ normalizer, raw: rawInput() })
    ).rejects.toMatchObject({ code: "source.normalizer_output_invalid" });
  });

  it("supports zero-to-many identity observations without inventing a sender", async () => {
    const zero = messageEvent();
    zero.semantic = {
      kind: "message_created",
      originKind: "provider_echo",
      authorObservationKey: null
    };
    zero.identityObservations = [];
    const zeroCandidate = await executeInboxV2SourceNormalizer({
      normalizer: createNormalizer(() => emitted(zero)).normalizer,
      raw: rawInput()
    });
    expect(zeroCandidate.events[0]?.identityObservations).toEqual([]);

    const many = messageEvent();
    many.identityObservations = [
      identityObservation("author-0001", "User-A"),
      identityObservation("author-0002", "User-B"),
      identityObservation("author-0003", "User-C")
    ];
    const manyCandidate = await executeInboxV2SourceNormalizer({
      normalizer: createNormalizer(() => emitted(many)).normalizer,
      raw: rawInput()
    });
    expect(manyCandidate.events[0]?.identityObservations).toHaveLength(3);
  });

  it("allows close_missing only for a complete authoritative roster", async () => {
    const complete = messageEvent();
    complete.semantic = { kind: "roster_observed" };
    complete.message = null;
    complete.identityObservations = [
      {
        ...identityObservation("member-0001", "Member-A"),
        purpose: "roster_member"
      }
    ];
    complete.rosterObservation = {
      completeness: "complete",
      authority: "authoritative",
      omissionPolicy: "close_missing",
      ordering: {
        kind: "adapter_monotonic",
        scopeToken: "roster-scope-0001",
        comparatorId: "module:synthetic:roster-order",
        comparatorRevision: "1",
        position: "1"
      },
      members: [
        {
          identityObservationKey: "member-0001",
          state: "present",
          normalizedRole: "member"
        }
      ],
      observedAt: t0
    };

    const accepted = await executeInboxV2SourceNormalizer({
      normalizer: createNormalizer(() => emitted(complete)).normalizer,
      raw: rawInput()
    });
    expect(accepted.events[0]?.rosterObservation).toMatchObject({
      completeness: "complete",
      authority: "authoritative",
      omissionPolicy: "close_missing"
    });

    const partial = structuredClone(complete);
    if (partial.rosterObservation === null) {
      throw new Error("Expected roster fixture.");
    }
    partial.rosterObservation.completeness = "partial";
    const rejected = createNormalizer(() => emitted(partial)).normalizer;
    await expect(
      executeInboxV2SourceNormalizer({ normalizer: rejected, raw: rawInput() })
    ).rejects.toMatchObject({ code: "source.normalizer_output_invalid" });
  });

  it("runs the exact evidence parser and persists only its classified projection", async () => {
    const candidate = await executeInboxV2SourceNormalizer({
      normalizer: createNormalizer(
        () => emitted(),
        (value) => {
          if (
            typeof value !== "object" ||
            value === null ||
            !("text" in value)
          ) {
            throw new TypeError("Evidence shape mismatch.");
          }
          return { text: String(value.text) };
        }
      ).normalizer,
      raw: rawInput()
    });

    expect(candidate.events[0]?.evidence).toEqual([
      {
        slotId: "module:synthetic:message-content",
        value: { text: "classified-message-content" }
      }
    ]);
  });

  it("keeps an own __proto__ property as inert null-prototype JSON data", async () => {
    let observedRestrictedPayload: Readonly<Record<string, unknown>> | null =
      null;
    const event = messageEvent();
    event.evidence[0]!.value = ownProtoJsonObject();
    const candidate = await executeInboxV2SourceNormalizer({
      normalizer: createNormalizer(({ restrictedPayload }) => {
        observedRestrictedPayload = restrictedPayload;
        return emitted(event);
      }).normalizer,
      raw: rawInput({ restrictedPayload: ownProtoJsonObject() })
    });

    const observed = observedRestrictedPayload as Readonly<
      Record<string, unknown>
    > | null;
    const classified = candidate.events[0]?.evidence[0]?.value as
      | Readonly<Record<string, unknown>>
      | undefined;
    expect(observed).not.toBeNull();
    expect(Object.getPrototypeOf(observed)).toBeNull();
    expect(Object.hasOwn(observed ?? {}, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(classified)).toBeNull();
    expect(Object.hasOwn(classified ?? {}, "__proto__")).toBe(true);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("rejects descriptor tricks and PostgreSQL-incompatible NUL data without invoking getters", async () => {
    for (const testCase of unsafeJsonValueFactories()) {
      const rawCase = testCase.create();
      await expect(
        executeInboxV2SourceNormalizer({
          normalizer: createNormalizer(() => emitted()).normalizer,
          raw: rawInput({
            restrictedPayload: { nested: rawCase.value }
          })
        }),
        testCase.name
      ).rejects.toMatchObject({
        code: "source.normalized_payload_unsafe",
        retryable: false
      });
      expect(rawCase.getterReads?.() ?? 0, testCase.name).toBe(0);

      const evidenceCase = testCase.create();
      await expect(
        executeInboxV2SourceNormalizer({
          normalizer: createNormalizer(
            () => emitted(),
            () => ({ nested: evidenceCase.value })
          ).normalizer,
          raw: rawInput()
        }),
        testCase.name
      ).rejects.toMatchObject({
        code: "source.normalized_payload_unsafe",
        retryable: false
      });
      expect(evidenceCase.getterReads?.() ?? 0, testCase.name).toBe(0);
    }
  });

  it("rejects more than 32 normalized events per raw event", async () => {
    const normalizer = createNormalizer(() => ({
      outcome: "emitted",
      events: Array.from(
        { length: INBOX_V2_SOURCE_NORMALIZATION_MAX_EVENTS_PER_RAW + 1 },
        () => messageEvent()
      )
    })).normalizer;

    await expect(
      executeInboxV2SourceNormalizer({ normalizer, raw: rawInput() })
    ).rejects.toMatchObject({
      code: "source.normalizer_output_invalid",
      retryable: false
    });
  });

  it("rejects more than 8 evidence records in one normalized event", async () => {
    const event = messageEvent();
    event.evidence = Array.from(
      { length: INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_EVENT + 1 },
      (_, index) => ({
        slotId: "module:synthetic:message-content",
        value: { index }
      })
    );

    await expect(
      executeInboxV2SourceNormalizer({
        normalizer: createNormalizer(() => emitted(event)).normalizer,
        raw: rawInput()
      })
    ).rejects.toMatchObject({
      code: "source.normalizer_output_invalid",
      retryable: false
    });
  });

  it("rejects more than 64 evidence records across one raw event", async () => {
    const evidenceSlots = Array.from(
      { length: INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_EVENT },
      (_, index) => ({
        slotId: `module:synthetic:evidence-${String(index).padStart(2, "0")}`,
        schemaId: `module:synthetic:evidence-${String(index).padStart(2, "0")}`,
        schemaVersion: "v1" as const,
        dataClassId: "core:normalized_event_payload" as const,
        purposeIds: ["core:source_replay_and_diagnostics" as const]
      })
    );
    const input = profileInput();
    const profile = defineInboxV2SourceNormalizerProfile({
      ...input,
      payload: { ...input.payload, evidenceSlots }
    });
    const evidenceParsers = Object.fromEntries(
      evidenceSlots.map(({ slotId }) => [slotId, (value: unknown) => value])
    );
    const eventCount =
      Math.floor(
        INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_RAW /
          INBOX_V2_SOURCE_NORMALIZATION_MAX_EVIDENCE_PER_EVENT
      ) + 1;
    const normalizer = defineInboxV2SourceNormalizer({
      profile,
      parseRestrictedPayload: (value) => value,
      evidenceParsers,
      handler: () => ({
        outcome: "emitted",
        events: Array.from({ length: eventCount }, () => {
          const event = messageEvent();
          event.evidence = evidenceSlots.map(({ slotId }, index) => ({
            slotId,
            value: { index }
          }));
          return event;
        })
      })
    });

    await expect(
      executeInboxV2SourceNormalizer({ normalizer, raw: rawInput() })
    ).rejects.toMatchObject({
      code: "source.normalizer_output_invalid",
      retryable: false
    });
  });

  it("rejects credential-bearing or failing evidence projections", async () => {
    for (const evidenceParser of [
      () => ({ apiToken: "must-never-persist" }),
      () => {
        throw new TypeError("Unknown provider evidence version.");
      }
    ]) {
      const normalizer = createNormalizer(
        () => emitted(),
        evidenceParser
      ).normalizer;
      await expect(
        executeInboxV2SourceNormalizer({ normalizer, raw: rawInput() })
      ).rejects.toMatchObject({ code: "source.normalized_payload_unsafe" });
    }
  });

  it("rejects missing, extra and non-callable evidence parser capabilities", () => {
    const profile = defineInboxV2SourceNormalizerProfile(profileInput());
    const base = {
      profile,
      parseRestrictedPayload: (value: unknown) => value,
      handler: (() => emitted()) satisfies InboxV2SourceNormalizerHandler
    };

    expect(() =>
      defineInboxV2SourceNormalizer({ ...base, evidenceParsers: {} })
    ).toThrow(/exactly one parser/iu);
    expect(() =>
      defineInboxV2SourceNormalizer({
        ...base,
        evidenceParsers: {
          "module:synthetic:message-content": (value) => value,
          "module:synthetic:undeclared": (value) => value
        }
      })
    ).toThrow(/exactly one parser/iu);
    expect(() =>
      defineInboxV2SourceNormalizer({
        ...base,
        evidenceParsers: {
          "module:synthetic:message-content": null
        } as unknown as Record<string, (value: unknown) => unknown>
      })
    ).toThrow(/exactly one parser/iu);
  });

  it("maps handler exceptions to a stable retryable failure", async () => {
    const normalizer = createNormalizer(() => {
      throw new Error("provider parser crashed with unsafe details");
    }).normalizer;

    await expect(
      executeInboxV2SourceNormalizer({ normalizer, raw: rawInput() })
    ).rejects.toMatchObject({
      code: "source.normalizer_failed",
      retryable: true,
      message: "source.normalizer_failed"
    });
  });

  it("rejects a nondeterministic handler before authenticating a candidate", async () => {
    let invocation = 0;
    const normalizer = createNormalizer(() => {
      invocation += 1;
      return {
        outcome: "ignored",
        reasonCode:
          invocation % 2 === 1
            ? "source.event_not_actionable"
            : "source.event_duplicate_observation"
      };
    }).normalizer;

    await expect(
      assertInboxV2SourceNormalizerDeterministic({
        normalizer,
        raw: rawInput()
      })
    ).rejects.toMatchObject({
      code: "source.normalizer_output_invalid",
      retryable: false
    });
  });
});
