import { describe, expect, it } from "vitest";

import {
  assertInboxV2SanitizedRawIngressCandidate,
  calculateInboxV2RawIngressLeaseTokenHash,
  defineInboxV2RawIngressSanitizer,
  defineInboxV2RawIngressSanitizerProfile,
  inboxV2ClaimRawIngressResultSchema,
  inboxV2RawIngressClaimSchema,
  inboxV2RawIngressSanitizerProfileSchema,
  inboxV2RawIngressWorkItemSchema,
  inboxV2RecordRawIngressResultSchema,
  inboxV2ReleaseRawIngressLeaseInputSchema,
  inboxV2ReleaseRawIngressLeaseResultSchema,
  inboxV2RenewRawIngressLeaseInputSchema,
  inboxV2RenewRawIngressLeaseResultSchema,
  isInboxV2RawIngressSanitizer,
  isInboxV2RawIngressSanitizerProfile,
  isInboxV2SanitizedRawIngressCandidate,
  sanitizeInboxV2RawIngress,
  type InboxV2RawIngressInput,
  type InboxV2RawIngressSanitizerHandler,
  type InboxV2SanitizedRawIngressCandidate
} from "./source-raw-ingress";

const t0 = "2026-07-16T08:00:00.000Z";
const t1 = "2026-07-16T08:00:01.000Z";
const t2 = "2026-07-16T08:00:02.000Z";
const hash = `sha256:${"a".repeat(64)}`;
const leaseToken = "raw-lease-token-000000000000000000000001";

function profileInput() {
  return {
    schemaId: "core:inbox-v2.raw-ingress-sanitizer-profile" as const,
    schemaVersion: "v1" as const,
    payload: {
      adapterContract: {
        contractId: "module:synthetic:raw-ingress",
        contractVersion: "v1",
        declarationRevision: "1",
        surfaceId: "core:direct-messenger",
        loadedByTrustedServiceId: "core:source-runtime",
        loadedAt: t0
      },
      handlerId: "module:synthetic:sanitize-webhook",
      handlerVersion: "v1",
      declarationRevision: "1",
      restrictedPayloadSchema: {
        schemaId: "module:synthetic:raw-webhook",
        schemaVersion: "v1"
      },
      persistedHeaderNames: ["x-request-id", "x-signature"],
      payloadClassification: {
        dataClassId: "core:raw_provider_payload" as const,
        purposeIds: [
          "core:source_replay_and_diagnostics" as const,
          "core:security_and_fraud_prevention" as const
        ]
      },
      allowedHeadersClassification: {
        dataClassId: "core:raw_provider_allowed_headers" as const,
        purposeIds: [
          "core:source_replay_and_diagnostics" as const,
          "core:security_and_fraud_prevention" as const
        ]
      }
    }
  };
}

function sanitizer(
  handler: InboxV2RawIngressSanitizerHandler,
  parseRestrictedPayload: (value: unknown) => unknown = (value) => value
) {
  return defineInboxV2RawIngressSanitizer({
    profile: defineInboxV2RawIngressSanitizerProfile(profileInput()),
    handler,
    parseRestrictedPayload
  });
}

function request(
  overrides: Partial<InboxV2RawIngressInput> = {}
): InboxV2RawIngressInput {
  return {
    tenantId: "tenant:alpha",
    sourceConnectionId: "source_connection:synthetic-1",
    sourceAccountId: "source_account:synthetic-1",
    transport: "webhook",
    eventIdentity: { kind: "provider_event_id", value: "event-123" },
    providerOccurredAt: t0,
    receivedAt: t1,
    sanitizedAt: t2,
    body: new TextEncoder().encode('{"message":"hello"}'),
    headers: {
      Authorization: "Bearer transient-secret",
      Cookie: "sid=transient-secret",
      "X-Request-Id": "request-1",
      "X-Signature": "sha256=allowed-signature"
    },
    ...overrides
  };
}

function acceptedCandidate(
  candidate: InboxV2SanitizedRawIngressCandidate
): Extract<
  InboxV2SanitizedRawIngressCandidate["disposition"],
  { outcome: "accepted" }
> {
  if (candidate.disposition.outcome !== "accepted") {
    throw new Error("Expected an accepted test candidate.");
  }
  return candidate.disposition;
}

function lease(revision = "1") {
  return {
    workerId: "core:raw-ingress-worker",
    leaseTokenHash: calculateInboxV2RawIngressLeaseTokenHash(leaseToken),
    leaseRevision: revision,
    claimedAt: t1,
    expiresAt: t2
  };
}

function work(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    tenantId: "tenant:alpha",
    rawEventId: "raw_inbound_event:event-1",
    state: "leased",
    attemptCount: "1",
    lease: lease(),
    revision: "2",
    updatedAt: t1,
    ...overrides
  };
}

describe("Inbox V2 raw ingress sanitization", () => {
  it("authenticates a versioned adapter profile and rejects unsafe allowlists", () => {
    const profile = defineInboxV2RawIngressSanitizerProfile(profileInput());
    expect(isInboxV2RawIngressSanitizerProfile(profile)).toBe(true);
    expect(isInboxV2RawIngressSanitizerProfile(structuredClone(profile))).toBe(
      false
    );

    for (const persistedHeaderNames of [
      ["authorization"],
      ["X-Signature"],
      ["x-signature", "x-request-id"],
      ["x-signature", "x-signature"]
    ]) {
      expect(
        inboxV2RawIngressSanitizerProfileSchema.safeParse({
          ...profileInput(),
          payload: { ...profileInput().payload, persistedHeaderNames }
        }).success
      ).toBe(false);
    }

    expect(
      inboxV2RawIngressSanitizerProfileSchema.safeParse({
        ...profileInput(),
        payload: {
          ...profileInput().payload,
          payloadClassification: {
            dataClassId: "core:raw_provider_payload",
            purposeIds: [
              "core:security_and_fraud_prevention",
              "core:source_replay_and_diagnostics"
            ]
          }
        }
      }).success
    ).toBe(false);
  });

  it("persists only the exact lowercase allowlist and no credential headers", async () => {
    const ephemeral = request();
    const configured = sanitizer(({ body, headers }) => ({
      outcome: "accepted",
      restrictedPayload: {
        message: new TextDecoder().decode(body),
        requestId: headers["x-request-id"]?.[0]
      },
      validatedAllowedHeaders: [
        {
          name: "x-request-id",
          values: [headers["x-request-id"]?.[0] ?? ""]
        },
        {
          name: "x-signature",
          values: [headers["x-signature"]?.[0] ?? ""]
        }
      ]
    }));

    const result = await sanitizeInboxV2RawIngress({
      sanitizer: configured,
      request: ephemeral
    });

    expect(result.outcome).toBe("accepted");
    const disposition = acceptedCandidate(result.candidate);
    expect(disposition.allowedHeaders.values).toEqual([
      { name: "x-request-id", values: ["request-1"] },
      { name: "x-signature", values: ["sha256=allowed-signature"] }
    ]);
    expect(disposition.allowedHeaders.classification).toEqual({
      dataClassId: "core:raw_provider_allowed_headers",
      purposeIds: [
        "core:source_replay_and_diagnostics",
        "core:security_and_fraud_prevention"
      ]
    });
    expect(JSON.stringify(result)).not.toMatch(
      /authorization|cookie|bearer|transient-secret/iu
    );
    expect([...ephemeral.body]).toEqual(
      new Array(ephemeral.body.length).fill(0)
    );
    expect(ephemeral.headers).toEqual({});
  });

  it("executes the parser bound to the declared payload schema", async () => {
    const configured = sanitizer(
      () => ({
        outcome: "accepted",
        restrictedPayload: {
          eventId: "event-1",
          unexpectedProviderField: "must-not-be-mislabeled"
        },
        validatedAllowedHeaders: []
      }),
      (value) => {
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value) ||
          Object.keys(value).join(",") !== "eventId" ||
          typeof (value as Record<string, unknown>).eventId !== "string"
        ) {
          throw new TypeError("Declared payload schema mismatch.");
        }
        return { eventId: (value as Record<string, unknown>).eventId };
      }
    );

    const result = await sanitizeInboxV2RawIngress({
      sanitizer: configured,
      request: request()
    });

    expect(result).toMatchObject({
      outcome: "quarantined",
      candidate: {
        disposition: { reasonCode: "source.payload_shape_unknown" }
      }
    });
    expect(JSON.stringify(result)).not.toContain("must-not-be-mislabeled");
  });

  it("lets the adapter reject credential material hidden in an allowlisted header value", async () => {
    const hiddenCredential = "allowlisted-header-secret-must-not-persist";
    const configured = sanitizer(({ headers }) => {
      const requestId = headers["x-request-id"]?.[0];
      return {
        outcome: "accepted",
        restrictedPayload: { eventId: "event-1" },
        validatedAllowedHeaders:
          requestId?.startsWith("request-") === true
            ? [{ name: "x-request-id", values: [requestId] }]
            : []
      };
    });
    const result = await sanitizeInboxV2RawIngress({
      sanitizer: configured,
      request: request({
        headers: {
          "X-Request-Id": `Bearer ${hiddenCredential}`,
          Authorization: `Bearer ${hiddenCredential}`
        }
      })
    });

    expect(acceptedCandidate(result.candidate).allowedHeaders.values).toEqual(
      []
    );
    expect(JSON.stringify(result)).not.toContain(hiddenCredential);

    const unlisted = await sanitizeInboxV2RawIngress({
      sanitizer: sanitizer(() => ({
        outcome: "accepted",
        restrictedPayload: { eventId: "event-1" },
        validatedAllowedHeaders: [
          { name: "x-unlisted-diagnostic", values: ["safe"] }
        ]
      })),
      request: request()
    });
    expect(unlisted.candidate.disposition).toEqual({
      outcome: "quarantined",
      reasonCode: "source.sanitizer_output_invalid"
    });
  });

  it("accepts the streaming transport declared by source adapters", async () => {
    const result = await sanitizeInboxV2RawIngress({
      sanitizer: sanitizer(() => ({
        outcome: "accepted",
        restrictedPayload: { eventId: "stream-event-1" },
        validatedAllowedHeaders: []
      })),
      request: request({ transport: "stream" })
    });

    expect(result).toMatchObject({
      outcome: "accepted",
      candidate: { transport: "stream" }
    });
  });

  it("quarantines every nested credential-key shape without copying it", async () => {
    for (const unsafePayload of [
      { authorization: "Bearer do-not-copy" },
      { nested: { accessToken: "do-not-copy" } },
      { password_hash: "do-not-copy" },
      [{ sessionId: "do-not-copy" }],
      { api_key: "do-not-copy" },
      { privateKeyPem: "do-not-copy" }
    ]) {
      const result = await sanitizeInboxV2RawIngress({
        sanitizer: sanitizer(() => ({
          outcome: "accepted",
          restrictedPayload: unsafePayload,
          validatedAllowedHeaders: []
        })),
        request: request()
      });
      expect(result.outcome).toBe("quarantined");
      expect(result.candidate.disposition).toEqual({
        outcome: "quarantined",
        reasonCode: "source.payload_shape_unknown"
      });
      expect(JSON.stringify(result)).not.toContain("do-not-copy");
    }
  });

  it("quarantines exotic, accessor, cyclic and malformed output shapes", async () => {
    const accessor = Object.defineProperty({}, "message", {
      enumerable: true,
      get: () => "must-not-run"
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const symbolKey = { message: "safe" } as Record<PropertyKey, unknown>;
    symbolKey[Symbol("secret")] = "must-not-copy";

    for (const unsafePayload of [
      new Date(t0),
      new Uint8Array([1, 2]),
      accessor,
      cyclic,
      symbolKey,
      { value: Number.NaN },
      ["plain-array-is-not-a-persistable-evidence-object"],
      "plain-string-is-not-a-persistable-evidence-object",
      42,
      null,
      undefined
    ]) {
      const result = await sanitizeInboxV2RawIngress({
        sanitizer: sanitizer(() => ({
          outcome: "accepted",
          restrictedPayload: unsafePayload,
          validatedAllowedHeaders: []
        })),
        request: request()
      });
      expect(result.outcome).toBe("quarantined");
      expect(result.candidate.disposition).toMatchObject({
        reasonCode: "source.payload_shape_unknown"
      });
      expect(JSON.stringify(result)).not.toContain("must-not-copy");
    }
  });

  it("keeps an own __proto__ property as inert null-prototype JSON data", async () => {
    const payload: Record<string, unknown> = {};
    Object.defineProperty(payload, "__proto__", {
      value: { polluted: "must-remain-inert-data" },
      enumerable: true,
      configurable: true,
      writable: true
    });
    payload.message = "safe";

    const result = await sanitizeInboxV2RawIngress({
      sanitizer: sanitizer(() => ({
        outcome: "accepted",
        restrictedPayload: payload,
        validatedAllowedHeaders: []
      })),
      request: request()
    });

    const persisted = acceptedCandidate(result.candidate).restrictedPayload
      .value as Readonly<Record<string, unknown>>;
    expect(Object.getPrototypeOf(persisted)).toBeNull();
    expect(Object.hasOwn(persisted, "__proto__")).toBe(true);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("quarantines sparse/accessor arrays, custom properties and NUL data without invoking getters", async () => {
    const factories: readonly Readonly<{
      name: string;
      create: () => Readonly<{
        value: unknown;
        getterReads?: () => number;
      }>;
    }>[] = [
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
        name: "custom array property",
        create: () => {
          const value = ["safe"] as unknown[] & { extra?: string };
          value.extra = "must-not-copy";
          return { value };
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
        name: "NUL key",
        create: () => ({ value: { ["unsafe\u0000key"]: "safe" } })
      },
      {
        name: "NUL value",
        create: () => ({ value: { message: "unsafe\u0000value" } })
      }
    ];

    for (const testCase of factories) {
      const unsafe = testCase.create();
      const result = await sanitizeInboxV2RawIngress({
        sanitizer: sanitizer(() => ({
          outcome: "accepted",
          restrictedPayload: { nested: unsafe.value },
          validatedAllowedHeaders: []
        })),
        request: request()
      });

      expect(result.outcome, testCase.name).toBe("quarantined");
      expect(result.candidate.disposition, testCase.name).toEqual({
        outcome: "quarantined",
        reasonCode: "source.payload_shape_unknown"
      });
      expect(unsafe.getterReads?.() ?? 0, testCase.name).toBe(0);
    }
  });

  it("uses bounded stable quarantine codes for handler rejection, throw and malformed decisions", async () => {
    const rejected = await sanitizeInboxV2RawIngress({
      sanitizer: sanitizer(() => ({
        outcome: "quarantined",
        reasonCode: "source.sanitizer_rejected"
      })),
      request: request()
    });
    expect(rejected.candidate.disposition).toEqual({
      outcome: "quarantined",
      reasonCode: "source.sanitizer_rejected"
    });

    const failed = await sanitizeInboxV2RawIngress({
      sanitizer: sanitizer(() => {
        throw new Error("Bearer secret-must-never-escape");
      }),
      request: request()
    });
    expect(failed.candidate.disposition).toEqual({
      outcome: "quarantined",
      reasonCode: "source.sanitizer_failed"
    });
    expect(JSON.stringify(failed)).not.toContain("secret-must-never-escape");

    const malformed = await sanitizeInboxV2RawIngress({
      sanitizer: sanitizer(
        () =>
          ({
            outcome: "quarantined",
            reasonCode: "source.sanitizer_rejected",
            rawError: "password=secret-must-never-escape"
          }) as never
      ),
      request: request()
    });
    expect(malformed.candidate.disposition).toEqual({
      outcome: "quarantined",
      reasonCode: "source.sanitizer_output_invalid"
    });
    expect(JSON.stringify(malformed)).not.toContain("secret-must-never-escape");
  });

  it("isolates handler mutations, scrubs both byte copies and deep-freezes output", async () => {
    const ephemeral = request();
    const payload = { message: { text: "safe" } };
    let retainedBody: Uint8Array | null = null;
    let retainedHeaders: Readonly<Record<string, readonly string[]>> | null =
      null;
    const result = await sanitizeInboxV2RawIngress({
      sanitizer: sanitizer(({ body, headers }) => {
        retainedBody = body;
        retainedHeaders = headers;
        body.fill(9);
        (headers as Record<string, string[]>)["x-added"] = ["transient"];
        return {
          outcome: "accepted",
          restrictedPayload: payload,
          validatedAllowedHeaders: []
        };
      }),
      request: ephemeral
    });
    payload.message.text = "mutated-after-return";

    const zeroizedRetainedBody = retainedBody as Uint8Array | null;
    expect(zeroizedRetainedBody).not.toBeNull();
    expect([...(zeroizedRetainedBody ?? [])]).toEqual(
      new Array(zeroizedRetainedBody?.length ?? 0).fill(0)
    );
    expect(retainedHeaders).toEqual({});
    expect(ephemeral.headers).toEqual({});
    expect([...ephemeral.body]).toEqual(
      new Array(ephemeral.body.length).fill(0)
    );
    expect(acceptedCandidate(result.candidate).restrictedPayload.value).toEqual(
      {
        message: { text: "safe" }
      }
    );
    expect(Object.isFrozen(result.candidate)).toBe(true);
    expect(Object.isFrozen(result.candidate.disposition)).toBe(true);
    expect(
      Object.isFrozen(
        acceptedCandidate(result.candidate).restrictedPayload.value
      )
    ).toBe(true);
  });

  it("makes the safe digest deterministic across redelivery time/header casing and excludes raw identity value", async () => {
    const configured = sanitizer(({ body }) => ({
      outcome: "accepted",
      restrictedPayload: JSON.parse(new TextDecoder().decode(body)),
      validatedAllowedHeaders: []
    }));
    const first = await sanitizeInboxV2RawIngress({
      sanitizer: configured,
      request: request()
    });
    const retry = await sanitizeInboxV2RawIngress({
      sanitizer: configured,
      request: request({
        eventIdentity: {
          kind: "provider_event_id",
          value: "a-different-transient-identity"
        },
        receivedAt: "2026-07-16T09:00:00.000Z",
        sanitizedAt: "2026-07-16T09:00:03.000Z",
        headers: {
          "x-signature": "sha256=allowed-signature",
          "x-request-id": "request-1",
          authorization: "Bearer another-secret"
        }
      })
    });
    const changed = await sanitizeInboxV2RawIngress({
      sanitizer: configured,
      request: request({
        body: new TextEncoder().encode('{"message":"changed"}')
      })
    });

    expect(retry.candidate.safeEnvelopeDigest).toBe(
      first.candidate.safeEnvelopeDigest
    );
    expect(retry.candidate.eventIdentity.value).not.toBe(
      first.candidate.eventIdentity.value
    );
    expect(changed.candidate.safeEnvelopeDigest).not.toBe(
      first.candidate.safeEnvelopeDigest
    );
  });

  it("rejects structural sanitizer/candidate lookalikes at the persistence boundary", async () => {
    const configured = sanitizer(() => ({
      outcome: "accepted",
      restrictedPayload: { message: "safe" },
      validatedAllowedHeaders: []
    }));
    const result = await sanitizeInboxV2RawIngress({
      sanitizer: configured,
      request: request()
    });

    expect(isInboxV2RawIngressSanitizer(configured)).toBe(true);
    expect(isInboxV2RawIngressSanitizer({ profile: configured.profile })).toBe(
      false
    );
    expect(isInboxV2SanitizedRawIngressCandidate(result.candidate)).toBe(true);
    expect(
      isInboxV2SanitizedRawIngressCandidate(structuredClone(result.candidate))
    ).toBe(false);
    expect(() =>
      assertInboxV2SanitizedRawIngressCandidate(
        structuredClone(result.candidate)
      )
    ).toThrow(/authentic sanitized candidate/u);
  });
});

describe("Inbox V2 raw ingress lease and record schemas", () => {
  it("keeps the raw work lifecycle strictly pending or leased", () => {
    expect(inboxV2RawIngressWorkItemSchema.safeParse(work()).success).toBe(
      true
    );
    expect(
      inboxV2RawIngressWorkItemSchema.safeParse(
        work({ state: "pending", lease: null })
      ).success
    ).toBe(true);
    for (const invalid of [
      work({ state: "pending" }),
      work({ state: "leased", lease: null }),
      work({ state: "leased", attemptCount: "0" }),
      work({ state: "processed", lease: null }),
      work({ state: "dead", lease: null })
    ]) {
      expect(inboxV2RawIngressWorkItemSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });

  it("binds a transient claim token and exposes safe expired-lease reclaim evidence", () => {
    const claimedWork = work({
      lease: {
        ...lease("2"),
        claimedAt: t2,
        expiresAt: "2026-07-16T08:00:03.000Z"
      },
      attemptCount: "2",
      revision: "3",
      updatedAt: t2
    });
    const reclaimed = {
      claimKind: "reclaimed",
      work: claimedWork,
      leaseToken,
      expiredLease: {
        workerId: "core:crashed-worker",
        leaseRevision: "1",
        claimedAt: t0,
        expiredAt: t1
      }
    };
    expect(inboxV2RawIngressClaimSchema.safeParse(reclaimed).success).toBe(
      true
    );
    expect(
      inboxV2RawIngressClaimSchema.safeParse({
        ...reclaimed,
        leaseToken: "wrong-token-0000000000000000000000000000"
      }).success
    ).toBe(false);
    expect(
      inboxV2RawIngressClaimSchema.safeParse({
        ...reclaimed,
        expiredLease: null
      }).success
    ).toBe(false);
    expect(
      inboxV2RawIngressClaimSchema.safeParse({
        ...reclaimed,
        expiredLease: { ...reclaimed.expiredLease, leaseRevision: "2" }
      }).success
    ).toBe(false);
  });

  it("rejects invalid lease renew/release fences and state-shaped successes", () => {
    expect(
      inboxV2RenewRawIngressLeaseInputSchema.safeParse({
        tenantId: "tenant:alpha",
        rawEventId: "raw_inbound_event:event-1",
        workerId: "core:raw-ingress-worker",
        leaseToken,
        expectedLeaseRevision: "1",
        leaseDurationSeconds: 30
      }).success
    ).toBe(true);
    expect(
      inboxV2RenewRawIngressLeaseInputSchema.safeParse({
        tenantId: "tenant:alpha",
        rawEventId: "raw_inbound_event:event-1",
        workerId: "core:raw-ingress-worker",
        leaseToken: "short",
        expectedLeaseRevision: "0",
        leaseDurationSeconds: 0
      }).success
    ).toBe(false);
    expect(
      inboxV2ReleaseRawIngressLeaseInputSchema.safeParse({
        tenantId: "tenant:alpha",
        rawEventId: "raw_inbound_event:event-1",
        workerId: "core:raw-ingress-worker",
        leaseToken,
        expectedLeaseRevision: "1",
        retryAfterSeconds: 30
      }).success
    ).toBe(false);
    expect(
      inboxV2RenewRawIngressLeaseResultSchema.safeParse({
        outcome: "renewed",
        work: work({ state: "pending", lease: null })
      }).success
    ).toBe(false);
    expect(
      inboxV2ReleaseRawIngressLeaseResultSchema.safeParse({
        outcome: "released",
        work: work()
      }).success
    ).toBe(false);
  });

  it("keeps recording outcomes bounded and creates work only for accepted records", () => {
    const pendingWork = work({
      state: "pending",
      attemptCount: "0",
      lease: null,
      revision: "1",
      updatedAt: t0
    });
    expect(
      inboxV2RecordRawIngressResultSchema.safeParse({
        outcome: "recorded",
        rawEventId: "raw_inbound_event:event-1",
        safeEnvelopeDigest: hash,
        work: pendingWork
      }).success
    ).toBe(true);
    expect(
      inboxV2RecordRawIngressResultSchema.safeParse({
        outcome: "already_recorded",
        rawEventId: "raw_inbound_event:event-1",
        safeEnvelopeDigest: hash
      }).success
    ).toBe(true);
    expect(
      inboxV2RecordRawIngressResultSchema.safeParse({
        outcome: "quarantined",
        quarantineId: "core:raw-ingress-collision-1",
        existingRawEventId: "raw_inbound_event:event-1",
        safeEnvelopeDigest: hash,
        reasonCode: "source.idempotency_collision"
      }).success
    ).toBe(true);
    expect(
      inboxV2RecordRawIngressResultSchema.safeParse({
        outcome: "quarantined",
        quarantineId: "core:unsafe-payload-1",
        existingRawEventId: "raw_inbound_event:event-1",
        safeEnvelopeDigest: hash,
        reasonCode: "source.payload_shape_unknown"
      }).success
    ).toBe(false);
    expect(
      inboxV2RecordRawIngressResultSchema.safeParse({
        outcome: "recorded",
        rawEventId: "raw_inbound_event:other",
        safeEnvelopeDigest: hash,
        work: pendingWork
      }).success
    ).toBe(false);
  });

  it("validates tenant-local unique claim batches", () => {
    const claim = {
      claimKind: "pending",
      work: work(),
      leaseToken,
      expiredLease: null
    };
    expect(
      inboxV2ClaimRawIngressResultSchema.safeParse({
        outcome: "claimed",
        tenantId: "tenant:alpha",
        workerId: "core:raw-ingress-worker",
        batchSize: 1,
        claims: [claim]
      }).success
    ).toBe(true);
    expect(
      inboxV2ClaimRawIngressResultSchema.safeParse({
        outcome: "claimed",
        tenantId: "tenant:alpha",
        workerId: "core:raw-ingress-worker",
        batchSize: 2,
        claims: [claim, claim]
      }).success
    ).toBe(false);
  });
});
