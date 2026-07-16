import {
  calculateInboxV2RawIngressLeaseTokenHash,
  defineInboxV2SourceNormalizer,
  defineInboxV2SourceNormalizerProfile,
  inboxV2EntityRevisionSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2RawIngressClaimSchema,
  InboxV2SourceNormalizationError,
  inboxV2TenantIdSchema,
  type InboxV2SourceNormalizationInput,
  type InboxV2SourceNormalizationRepositoryPort,
  type InboxV2SourceNormalizer
} from "@hulee/contracts";
import type {
  SourceAdapterRegistration,
  SourceAdapterRegistry
} from "@hulee/modules";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2SourceNormalizationProcessor,
  type InboxV2SourceNormalizationClaim
} from "./source-normalization-processor";

const t0 = "2026-07-16T08:00:00.000Z";
const t1 = "2026-07-16T08:00:01.000Z";
const t2 = "2026-07-16T08:01:01.000Z";
const leaseToken = "source-normalization-lease-token-000000000001";
const tenantId = inboxV2TenantIdSchema.parse("tenant:alpha");
const rawEventId = inboxV2RawInboundEventIdSchema.parse(
  "raw_inbound_event:raw-1"
);
const sourceTypeId = "core:messenger";
const sourceName = "synthetic";
const hmac = `hmac-sha256:${"a".repeat(64)}`;

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

function claim(
  overrides: Record<string, unknown> = {}
): InboxV2SourceNormalizationClaim {
  return inboxV2RawIngressClaimSchema.parse({
    claimKind: "pending",
    work: {
      tenantId: "tenant:alpha",
      rawEventId: "raw_inbound_event:raw-1",
      state: "leased",
      attemptCount: "1",
      lease: {
        workerId: "core:source-normalization-worker",
        leaseTokenHash: calculateInboxV2RawIngressLeaseTokenHash(leaseToken),
        leaseRevision: "7",
        claimedAt: t1,
        expiresAt: t2
      },
      revision: "8",
      updatedAt: t1
    },
    leaseToken,
    expiredLease: null,
    ...overrides
  });
}

function rawInput(): InboxV2SourceNormalizationInput {
  return {
    tenantId: "tenant:alpha",
    rawEventId: "raw_inbound_event:raw-1",
    sourceConnectionId: "source_connection:synthetic-1",
    sourceAccountId: "source_account:synthetic-1",
    transport: "webhook",
    providerOccurredAt: t0,
    rawIngressSanitizer,
    restrictedPayload: { providerEventId: "event-1" }
  };
}

function normalizer(
  handler = vi.fn(() => ({
    outcome: "ignored" as const,
    reasonCode: "source.event_not_actionable" as const
  }))
) {
  const profile = defineInboxV2SourceNormalizerProfile({
    schemaId: "core:inbox-v2.source-normalizer-profile",
    schemaVersion: "v1",
    payload: {
      adapterContract,
      handlerId: "module:synthetic:normalize",
      handlerVersion: "v1",
      declarationRevision: "1",
      rawIngressSanitizer,
      eventKinds: ["message_created"],
      identityDeclarations: [],
      evidenceSlots: []
    }
  });
  return {
    handler,
    normalizer: defineInboxV2SourceNormalizer({
      profile,
      parseRestrictedPayload: (value) => value,
      evidenceParsers: {},
      handler
    })
  };
}

function registration(
  configuredNormalizer: InboxV2SourceNormalizer,
  overrides: {
    sourceName?: string;
    sourceTypeId?: string;
    registeredNormalizer?: InboxV2SourceNormalizer | null;
    normalizationMode?: "supported" | "not_supported";
  } = {}
): SourceAdapterRegistration {
  return {
    declaration: {
      payload: {
        sourceName: overrides.sourceName ?? sourceName,
        sourceTypeId: overrides.sourceTypeId ?? sourceTypeId,
        normalization:
          overrides.normalizationMode === "not_supported"
            ? { mode: "not_supported" }
            : { mode: "supported" }
      }
    },
    sourceNormalizer:
      overrides.registeredNormalizer === undefined
        ? configuredNormalizer
        : overrides.registeredNormalizer
  } as unknown as SourceAdapterRegistration;
}

function registry(input: {
  registration: SourceAdapterRegistration | null;
  normalizer: InboxV2SourceNormalizer | null;
}) {
  const getRegistration = vi.fn(() => input.registration);
  const getSourceNormalizer = vi.fn(() => input.normalizer);
  return {
    getRegistration,
    getSourceNormalizer,
    value: {
      get: () => null,
      getRegistration,
      getIngressHandler: () => null,
      getRawIngressSanitizer: () => null,
      getSourceNormalizer,
      listSourceNames: () => [sourceName]
    } as SourceAdapterRegistry
  };
}

function successfulRepository() {
  const loadClaimedInput = vi.fn(async () => ({
    outcome: "loaded" as const,
    sourceTypeId,
    sourceName,
    raw: rawInput()
  }));
  const complete = vi.fn(async (input) => ({
    outcome: "completed" as const,
    completion: {
      tenantId: input.candidate.tenantId,
      rawEventId: input.candidate.rawEventId,
      outcome: "ignored" as const,
      normalizedEventIds: [],
      quarantineId: null,
      orderedEventHmacSha256: hmac,
      candidateCompletionHmacSha256: hmac,
      resultHmacSha256: hmac,
      completedAt: t1
    }
  }));
  return {
    loadClaimedInput,
    complete,
    value: {
      loadClaimedInput,
      complete
    } as InboxV2SourceNormalizationRepositoryPort
  };
}

describe("Inbox V2 source-normalization worker processor", () => {
  it("loads persisted evidence, invokes the registered normalizer once and completes with the same lease fence", async () => {
    const configured = normalizer();
    const adapterRegistry = registry({
      registration: registration(configured.normalizer),
      normalizer: configured.normalizer
    });
    const repository = successfulRepository();
    const processor = createInboxV2SourceNormalizationProcessor({
      repository: repository.value,
      sourceAdapterRegistry: adapterRegistry.value
    });

    await expect(processor.process(claim())).resolves.toMatchObject({
      outcome: "completed",
      completion: {
        tenantId: "tenant:alpha",
        rawEventId: "raw_inbound_event:raw-1",
        outcome: "ignored"
      }
    });

    const expectedFence = {
      tenantId: "tenant:alpha",
      rawEventId: "raw_inbound_event:raw-1",
      workerId: "core:source-normalization-worker",
      leaseToken,
      expectedLeaseRevision: "7"
    };
    expect(repository.loadClaimedInput).toHaveBeenCalledOnce();
    expect(repository.loadClaimedInput).toHaveBeenCalledWith(expectedFence);
    expect(adapterRegistry.getRegistration).toHaveBeenCalledWith(sourceName);
    expect(adapterRegistry.getSourceNormalizer).toHaveBeenCalledWith(
      sourceName
    );
    expect(configured.handler).toHaveBeenCalledOnce();
    expect(configured.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        restrictedPayload: { providerEventId: "event-1" }
      })
    );
    expect(repository.complete).toHaveBeenCalledOnce();
    expect(repository.complete).toHaveBeenCalledWith({
      candidate: expect.objectContaining({
        tenantId: "tenant:alpha",
        rawEventId: "raw_inbound_event:raw-1",
        outcome: "ignored"
      }),
      ...expectedFence
    });
  });

  it.each([
    {
      outcome: "evidence_unavailable" as const,
      tenantId,
      rawEventId,
      reasonCode: "source.evidence_unavailable" as const
    },
    {
      outcome: "lease_expired" as const,
      tenantId,
      rawEventId,
      currentLeaseRevision: inboxV2EntityRevisionSchema.parse("7"),
      expiredAt: t2
    }
  ])(
    "returns $outcome without resolving or running an adapter",
    async (loadResult) => {
      const configured = normalizer();
      const adapterRegistry = registry({
        registration: registration(configured.normalizer),
        normalizer: configured.normalizer
      });
      const complete = vi.fn();
      const processor = createInboxV2SourceNormalizationProcessor({
        repository: {
          loadClaimedInput: vi.fn(async () => loadResult),
          complete
        },
        sourceAdapterRegistry: adapterRegistry.value
      });

      await expect(processor.process(claim())).resolves.toEqual(loadResult);
      expect(adapterRegistry.getRegistration).not.toHaveBeenCalled();
      expect(adapterRegistry.getSourceNormalizer).not.toHaveBeenCalled();
      expect(configured.handler).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["missing registration", null, "same", "source.normalizer_missing"],
    ["missing normalizer", "same", null, "source.normalizer_missing"],
    [
      "source type mismatch",
      "wrong-type",
      "same",
      "source.normalizer_mismatch"
    ],
    [
      "registered instance mismatch",
      "other-instance",
      "same",
      "source.normalizer_mismatch"
    ],
    [
      "unsupported declaration",
      "unsupported",
      "same",
      "source.normalizer_mismatch"
    ]
  ] as const)(
    "fails closed for %s before normalization or completion",
    async (_case, registrationMode, normalizerMode, expectedCode) => {
      const configured = normalizer();
      const other = normalizer().normalizer;
      const selectedRegistration =
        registrationMode === null
          ? null
          : registrationMode === "wrong-type"
            ? registration(configured.normalizer, {
                sourceTypeId: "core:source-type.phone"
              })
            : registrationMode === "other-instance"
              ? registration(configured.normalizer, {
                  registeredNormalizer: other
                })
              : registrationMode === "unsupported"
                ? registration(configured.normalizer, {
                    normalizationMode: "not_supported"
                  })
                : registration(configured.normalizer);
      const adapterRegistry = registry({
        registration: selectedRegistration,
        normalizer: normalizerMode === null ? null : configured.normalizer
      });
      const repository = successfulRepository();
      const processor = createInboxV2SourceNormalizationProcessor({
        repository: repository.value,
        sourceAdapterRegistry: adapterRegistry.value
      });

      const result = processor.process(claim());
      await expect(result).rejects.toMatchObject({
        name: "InboxV2SourceNormalizationError",
        code: expectedCode,
        retryable: false
      });
      expect(configured.handler).not.toHaveBeenCalled();
      expect(repository.complete).not.toHaveBeenCalled();
    }
  );

  it("does not complete when the adapter handler fails", async () => {
    const handler = vi.fn(() => {
      throw new Error("provider parser failure");
    });
    const configured = normalizer(handler);
    const adapterRegistry = registry({
      registration: registration(configured.normalizer),
      normalizer: configured.normalizer
    });
    const repository = successfulRepository();
    const processor = createInboxV2SourceNormalizationProcessor({
      repository: repository.value,
      sourceAdapterRegistry: adapterRegistry.value
    });

    await expect(processor.process(claim())).rejects.toEqual(
      expect.objectContaining<Partial<InboxV2SourceNormalizationError>>({
        code: "source.normalizer_failed",
        retryable: true
      })
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("rejects a forged claim before loading persisted evidence", async () => {
    const repository = successfulRepository();
    const configured = normalizer();
    const adapterRegistry = registry({
      registration: registration(configured.normalizer),
      normalizer: configured.normalizer
    });
    const processor = createInboxV2SourceNormalizationProcessor({
      repository: repository.value,
      sourceAdapterRegistry: adapterRegistry.value
    });
    const forged = {
      ...claim(),
      leaseToken: "forged-source-normalization-token-000000000001"
    } as InboxV2SourceNormalizationClaim;

    await expect(processor.process(forged)).rejects.toThrow();
    expect(repository.loadClaimedInput).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
