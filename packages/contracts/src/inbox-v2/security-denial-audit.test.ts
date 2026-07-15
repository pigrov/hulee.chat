import { describe, expect, it } from "vitest";

import { inboxV2TenantIdSchema } from "./ids";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";
import {
  INBOX_V2_SECURITY_DENIAL_ATTEMPT_SCHEMA_ID,
  INBOX_V2_SECURITY_DENIAL_POLICY,
  INBOX_V2_SECURITY_DENIAL_RESULT_SCHEMA_ID,
  INBOX_V2_SECURITY_DENIAL_SCHEMA_VERSION,
  inboxV2SecurityDenialAttemptEnvelopeSchema,
  inboxV2SecurityDenialAttemptSchema,
  inboxV2SecurityDenialMaximumRowsPerWindow,
  inboxV2SecurityDenialResultMatchesAttempt,
  inboxV2SecurityDenialResultEnvelopeSchema,
  inboxV2SecurityDenialResultSchema,
  inboxV2SecurityDenialReviewRecordSchema,
  inboxV2SecurityDenialShardForActorFingerprint,
  inboxV2SecurityDenialWindowForObservedAt,
  type InboxV2SecurityDenialAction,
  type InboxV2SecurityDenialReviewType
} from "./security-denial-audit";

const tenantId = inboxV2TenantIdSchema.parse("tenant:security-denial-contract");
const observedAt = "2026-07-15T10:10:00.000Z";
const windowStartedAt = "2026-07-15T10:00:00.000Z";
const windowEndedAt = "2026-07-15T11:00:00.000Z";
const expiresAt = "2026-08-14T10:00:00.000Z";
const actorFingerprint = `hmac-sha256:${"a".repeat(64)}`;
const dedupeFingerprint = `hmac-sha256:${"b".repeat(64)}`;
const observationReceipt = `security-denial-observation:${"c".repeat(64)}`;

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    observationReceipt,
    tenantId,
    action: "resource.read" as const,
    principalClass: "employee" as const,
    fingerprintKeyEpoch: "security-denial-key:0123456789abcdef",
    actorFingerprint,
    dedupeFingerprint,
    denialKind: "unknown_or_hidden_resource" as const,
    publicErrorClass: "not_found" as const,
    risk: "high" as const,
    reviewSignal: {
      reviewType: "guessed_identifier_probe" as const,
      alertType: "security_probe_review" as const,
      candidateRef: null
    },
    policy: INBOX_V2_SECURITY_DENIAL_POLICY,
    ...overrides
  };
}

describe("Inbox V2 bounded security-denial contracts", () => {
  it("accepts closed versioned redacted attempt and result envelopes", () => {
    expect(inboxV2SecurityDenialAttemptSchema.parse(attempt())).toEqual(
      attempt()
    );
    expect(
      inboxV2SecurityDenialAttemptEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SECURITY_DENIAL_ATTEMPT_SCHEMA_ID,
        schemaVersion: INBOX_V2_SECURITY_DENIAL_SCHEMA_VERSION,
        payload: attempt()
      }).success
    ).toBe(true);

    const result = {
      observationReceipt,
      tenantId,
      observedAt,
      disposition: "recorded" as const,
      shardNo: 2,
      windowStartedAt,
      windowEndedAt,
      expiresAt,
      shardAttemptCount: "1",
      detailOccurrenceCount: "1",
      admittedDetailBucketCount: 1,
      overflowCount: "0",
      counterSaturated: false,
      reviewWrites: [
        {
          reviewType: "guessed_identifier_probe" as const,
          disposition: "candidate_created" as const
        }
      ]
    };
    expect(inboxV2SecurityDenialResultSchema.parse(result)).toEqual(result);
    expect(
      inboxV2SecurityDenialResultEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SECURITY_DENIAL_RESULT_SCHEMA_ID,
        schemaVersion: INBOX_V2_SECURITY_DENIAL_SCHEMA_VERSION,
        payload: result
      }).success
    ).toBe(true);
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2SecurityDenialAttemptSchema,
        "security denial attempt"
      )
    ).not.toThrow();
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2SecurityDenialResultSchema,
        "security denial result"
      )
    ).not.toThrow();
  });

  it("has a fixed, review-type-inclusive maximum row budget per tenant window", () => {
    expect(inboxV2SecurityDenialMaximumRowsPerWindow()).toBe(
      INBOX_V2_SECURITY_DENIAL_POLICY.shardCount *
        (1 +
          INBOX_V2_SECURITY_DENIAL_POLICY.detailBucketLimitPerShard +
          INBOX_V2_SECURITY_DENIAL_POLICY.reviewCandidateLimitPerShard +
          12)
    );
    expect(inboxV2SecurityDenialMaximumRowsPerWindow()).toBe(528);
  });

  it("cannot represent raw targets, request metadata, PII, provider data or arbitrary JSON", () => {
    for (const forbidden of [
      { targetId: "employee:guessed" },
      { target: { id: "conversation:guessed" } },
      { requestId: "request:attacker" },
      { correlationId: "correlation:attacker" },
      { clientMutationId: "mutation:attacker" },
      { ip: "203.0.113.10" },
      { email: "person@example.test" },
      { phone: "+79990000000" },
      { headers: { authorization: "Bearer secret" } },
      { body: "message content" },
      { metadata: { arbitrary: true } },
      { providerPayload: { update_id: 1 } },
      { occurredAt: "2099-01-01T00:00:00.000Z" },
      { decisionEvaluatedAt: "2099-01-01T00:00:00.000Z" }
    ]) {
      expect(
        inboxV2SecurityDenialAttemptSchema.safeParse({
          ...attempt(),
          ...forbidden
        }).success
      ).toBe(false);
    }
    for (const fingerprint of [
      "employee:employee-1",
      "sha256:" + "a".repeat(64),
      "+79990000000",
      "person@example.test",
      "hmac-sha256:short"
    ]) {
      expect(
        inboxV2SecurityDenialAttemptSchema.safeParse({
          ...attempt(),
          dedupeFingerprint: fingerprint
        }).success
      ).toBe(false);
    }
  });

  it("forces missing, hidden and cross-tenant probes into one non-disclosing public class", () => {
    for (const denialKind of [
      "unknown_or_hidden_resource",
      "cross_tenant_probe"
    ] as const) {
      expect(
        inboxV2SecurityDenialAttemptSchema.safeParse({
          ...attempt(),
          denialKind,
          risk: denialKind === "cross_tenant_probe" ? "critical" : "high",
          publicErrorClass: "permission_denied",
          reviewSignal: {
            reviewType:
              denialKind === "cross_tenant_probe"
                ? "cross_tenant_probe"
                : "guessed_identifier_probe",
            alertType: "security_probe_review",
            candidateRef: null
          }
        }).success
      ).toBe(false);
    }
    expect(
      inboxV2SecurityDenialAttemptSchema.safeParse({
        ...attempt(),
        denialKind: "cross_tenant_probe",
        publicErrorClass: "not_found",
        risk: "critical",
        reviewSignal: {
          reviewType: "cross_tenant_probe",
          alertType: "security_probe_review",
          candidateRef: null
        }
      }).success
    ).toBe(true);
    expect(
      inboxV2SecurityDenialAttemptSchema.safeParse({
        ...attempt(),
        action: "privacy.deletion.execute",
        denialKind: "manual_self_claim",
        publicErrorClass: "identity_claim_self_forbidden",
        risk: "critical",
        reviewSignal: {
          reviewType: "manual_self_claim",
          alertType: "identity_claim_review",
          candidateRef: null
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SecurityDenialAttemptSchema.safeParse({
        ...attempt(),
        action: "identity.claim",
        denialKind: "missing_permission",
        publicErrorClass: "identity_claim_self_forbidden",
        risk: "high",
        reviewSignal: null
      }).success
    ).toBe(false);
  });

  it("requires action-specific high-risk lifecycle and self-claim review signals", () => {
    const matrix: readonly [
      InboxV2SecurityDenialAction,
      InboxV2SecurityDenialReviewType,
      "high" | "critical"
    ][] = [
      ["privacy.hold.issue", "privacy_hold_issue_denied", "high"],
      ["privacy.hold.release", "privacy_hold_release_denied", "high"],
      [
        "privacy.subject_evidence.view",
        "privacy_evidence_access_denied",
        "high"
      ],
      ["privacy.tenant_export", "tenant_export_denied", "high"],
      ["privacy.deletion.preview", "destructive_preview_denied", "high"],
      ["privacy.deletion.approve", "destructive_approval_denied", "high"],
      ["privacy.deletion.execute", "destructive_execution_denied", "critical"]
    ];
    for (const [action, reviewType, risk] of matrix) {
      const privacyAttempt = {
        ...attempt(),
        action,
        denialKind: "missing_permission" as const,
        publicErrorClass: "permission_denied" as const,
        risk,
        reviewSignal: {
          reviewType,
          alertType: "privacy_control_review" as const,
          candidateRef: null
        }
      };
      expect(
        inboxV2SecurityDenialAttemptSchema.safeParse(privacyAttempt).success
      ).toBe(true);
      expect(
        inboxV2SecurityDenialAttemptSchema.safeParse({
          ...privacyAttempt,
          reviewSignal: null
        }).success
      ).toBe(false);
    }

    expect(
      inboxV2SecurityDenialAttemptSchema.safeParse({
        ...attempt(),
        action: "identity.claim",
        denialKind: "manual_self_claim",
        publicErrorClass: "identity_claim_self_forbidden",
        risk: "high",
        reviewSignal: {
          reviewType: "manual_self_claim",
          alertType: "identity_claim_review",
          candidateRef: `internal-ref:${"d".repeat(32)}`
        }
      }).success
    ).toBe(true);

    expect(
      inboxV2SecurityDenialAttemptSchema.parse({
        ...attempt(),
        action: "privacy.hold.release",
        denialKind: "cross_tenant_probe",
        publicErrorClass: "not_found",
        risk: "critical",
        reviewSignal: {
          reviewType: "privacy_hold_release_denied",
          alertType: "privacy_control_review",
          candidateRef: null
        }
      }).reviewSignal
    ).toEqual({
      reviewType: "privacy_hold_release_denied",
      alertType: "privacy_control_review",
      candidateRef: null
    });
  });

  it("rejects caller-selected policy expansion, risk downgrades and incoherent results", () => {
    expect(
      inboxV2SecurityDenialAttemptSchema.safeParse({
        ...attempt(),
        policy: { ...INBOX_V2_SECURITY_DENIAL_POLICY, shardCount: 32 }
      }).success
    ).toBe(false);
    expect(
      inboxV2SecurityDenialAttemptSchema.safeParse({
        ...attempt(),
        risk: "low"
      }).success
    ).toBe(false);
    expect(
      inboxV2SecurityDenialResultSchema.safeParse({
        observationReceipt,
        tenantId,
        observedAt,
        disposition: "aggregated_overflow",
        shardNo: 0,
        windowStartedAt,
        windowEndedAt,
        expiresAt,
        shardAttemptCount: "20",
        detailOccurrenceCount: "1",
        admittedDetailBucketCount: 16,
        overflowCount: "4",
        counterSaturated: false,
        reviewWrites: []
      }).success
    ).toBe(false);
  });

  it("binds every sink result field to the exact source attempt", () => {
    const source = inboxV2SecurityDenialAttemptSchema.parse(attempt());
    const window = inboxV2SecurityDenialWindowForObservedAt(observedAt);
    const valid = {
      observationReceipt: source.observationReceipt,
      tenantId,
      observedAt,
      disposition: "recorded" as const,
      shardNo: inboxV2SecurityDenialShardForActorFingerprint(actorFingerprint),
      ...window,
      shardAttemptCount: "1",
      detailOccurrenceCount: "1",
      admittedDetailBucketCount: 1,
      overflowCount: "0",
      counterSaturated: false,
      reviewWrites: [
        {
          reviewType: "guessed_identifier_probe" as const,
          disposition: "candidate_created" as const
        }
      ]
    };
    expect(inboxV2SecurityDenialResultMatchesAttempt(source, valid)).toBe(true);
    for (const coherent of [
      {
        ...valid,
        disposition: "deduplicated" as const,
        shardAttemptCount: "2",
        detailOccurrenceCount: "2",
        reviewWrites: [
          {
            reviewType: "guessed_identifier_probe" as const,
            disposition: "candidate_aggregated" as const
          }
        ]
      },
      {
        ...valid,
        disposition: "aggregated_overflow" as const,
        shardAttemptCount: "17",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 16,
        overflowCount: "1",
        reviewWrites: [
          {
            reviewType: "guessed_identifier_probe" as const,
            disposition: "overflow_created" as const
          },
          {
            reviewType: "denial_volume_exceeded" as const,
            disposition: "overflow_created" as const
          }
        ]
      },
      {
        ...valid,
        disposition: "rate_limited" as const,
        shardAttemptCount: "601",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 16,
        overflowCount: "1",
        reviewWrites: [
          {
            reviewType: "guessed_identifier_probe" as const,
            disposition: "overflow_aggregated" as const
          },
          {
            reviewType: "denial_rate_exceeded" as const,
            disposition: "overflow_created" as const
          }
        ]
      }
    ]) {
      expect(inboxV2SecurityDenialResultMatchesAttempt(source, coherent)).toBe(
        true
      );
    }

    const invalidResults = [
      { ...valid, tenantId: "tenant:foreign" },
      {
        ...valid,
        observationReceipt: `security-denial-observation:${"d".repeat(64)}`
      },
      { ...valid, observedAt: "2026-07-15T11:10:00.000Z" },
      { ...valid, windowStartedAt: "2026-07-15T10:01:00.000Z" },
      { ...valid, windowEndedAt: "2026-07-15T11:01:00.000Z" },
      { ...valid, expiresAt: "2026-08-14T10:00:00.001Z" },
      { ...valid, shardNo: (valid.shardNo + 1) % 16 },
      { ...valid, shardAttemptCount: "0" },
      { ...valid, shardAttemptCount: "601" },
      { ...valid, detailOccurrenceCount: "2" },
      { ...valid, reviewWrites: [] },
      {
        ...valid,
        reviewWrites: [valid.reviewWrites[0], valid.reviewWrites[0]]
      },
      {
        ...valid,
        shardAttemptCount: "9223372036854775807",
        counterSaturated: false
      },
      {
        ...valid,
        disposition: "aggregated_overflow" as const,
        shardAttemptCount: "601",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 16,
        overflowCount: "1",
        reviewWrites: [
          valid.reviewWrites[0],
          {
            reviewType: "denial_volume_exceeded" as const,
            disposition: "overflow_created" as const
          }
        ]
      }
    ];
    for (const invalid of invalidResults) {
      expect(
        inboxV2SecurityDenialResultMatchesAttempt(
          source,
          invalid as typeof valid
        )
      ).toBe(false);
    }
  });

  it("rejects a cached result from another observation in the same shard window", () => {
    const source = inboxV2SecurityDenialAttemptSchema.parse(attempt());
    const cachedResult = {
      observationReceipt: source.observationReceipt,
      tenantId,
      observedAt,
      disposition: "recorded" as const,
      shardNo: inboxV2SecurityDenialShardForActorFingerprint(actorFingerprint),
      ...inboxV2SecurityDenialWindowForObservedAt(observedAt),
      shardAttemptCount: "1",
      detailOccurrenceCount: "1",
      admittedDetailBucketCount: 1,
      overflowCount: "0",
      counterSaturated: false,
      reviewWrites: [
        {
          reviewType: "guessed_identifier_probe" as const,
          disposition: "candidate_created" as const
        }
      ]
    };
    const nextObservation = inboxV2SecurityDenialAttemptSchema.parse(
      attempt({
        observationReceipt: `security-denial-observation:${"d".repeat(64)}`,
        dedupeFingerprint: `hmac-sha256:${"e".repeat(64)}`
      })
    );

    expect(
      inboxV2SecurityDenialResultMatchesAttempt(source, cachedResult)
    ).toBe(true);
    expect(
      inboxV2SecurityDenialResultMatchesAttempt(nextObservation, cachedResult)
    ).toBe(false);
  });

  it("rejects impossible counter mass and threshold-write transitions", () => {
    const source = inboxV2SecurityDenialAttemptSchema.parse(attempt());
    const base = {
      observationReceipt: source.observationReceipt,
      tenantId,
      observedAt,
      shardNo: inboxV2SecurityDenialShardForActorFingerprint(actorFingerprint),
      ...inboxV2SecurityDenialWindowForObservedAt(observedAt),
      counterSaturated: false
    };
    const guessed = (
      disposition:
        | "candidate_created"
        | "candidate_aggregated"
        | "overflow_created"
        | "overflow_aggregated"
    ) => ({ reviewType: "guessed_identifier_probe" as const, disposition });
    const threshold = (
      reviewType: "denial_rate_exceeded" | "denial_volume_exceeded",
      disposition: "overflow_created" | "overflow_aggregated"
    ) => ({ reviewType, disposition });

    const impossible = [
      {
        ...base,
        disposition: "recorded",
        shardAttemptCount: "1",
        detailOccurrenceCount: "1",
        admittedDetailBucketCount: 1,
        overflowCount: "1",
        reviewWrites: [guessed("candidate_created")]
      },
      {
        ...base,
        disposition: "deduplicated",
        shardAttemptCount: "600",
        detailOccurrenceCount: "600",
        admittedDetailBucketCount: 1,
        overflowCount: "600",
        reviewWrites: [guessed("candidate_aggregated")]
      },
      {
        ...base,
        disposition: "deduplicated",
        shardAttemptCount: "600",
        detailOccurrenceCount: "2",
        admittedDetailBucketCount: 1,
        overflowCount: "0",
        reviewWrites: [guessed("candidate_aggregated")]
      },
      {
        ...base,
        disposition: "rate_limited",
        shardAttemptCount: "601",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 0,
        overflowCount: "1",
        reviewWrites: [
          guessed("overflow_created"),
          threshold("denial_rate_exceeded", "overflow_created")
        ]
      },
      {
        ...base,
        disposition: "rate_limited",
        shardAttemptCount: "601",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 16,
        overflowCount: "600",
        reviewWrites: [
          guessed("overflow_aggregated"),
          threshold("denial_rate_exceeded", "overflow_created")
        ]
      },
      {
        ...base,
        disposition: "rate_limited",
        shardAttemptCount: "1000",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 1,
        overflowCount: "1",
        reviewWrites: [
          guessed("overflow_aggregated"),
          threshold("denial_rate_exceeded", "overflow_aggregated")
        ]
      },
      {
        ...base,
        disposition: "rate_limited",
        shardAttemptCount: "601",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 1,
        overflowCount: "600",
        reviewWrites: [
          guessed("overflow_aggregated"),
          threshold("denial_rate_exceeded", "overflow_created")
        ]
      },
      {
        ...base,
        disposition: "aggregated_overflow",
        shardAttemptCount: "17",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 16,
        overflowCount: "1",
        reviewWrites: [
          guessed("overflow_created"),
          threshold("denial_volume_exceeded", "overflow_aggregated")
        ]
      },
      {
        ...base,
        disposition: "aggregated_overflow",
        shardAttemptCount: "18",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 16,
        overflowCount: "2",
        reviewWrites: [
          guessed("overflow_aggregated"),
          threshold("denial_volume_exceeded", "overflow_created")
        ]
      },
      {
        ...base,
        disposition: "rate_limited",
        shardAttemptCount: "601",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 1,
        overflowCount: "1",
        reviewWrites: [
          guessed("overflow_created"),
          threshold("denial_rate_exceeded", "overflow_aggregated")
        ]
      },
      {
        ...base,
        disposition: "rate_limited",
        shardAttemptCount: "602",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 1,
        overflowCount: "2",
        reviewWrites: [
          guessed("overflow_aggregated"),
          threshold("denial_rate_exceeded", "overflow_created")
        ]
      },
      {
        ...base,
        disposition: "recorded",
        shardAttemptCount: "1",
        detailOccurrenceCount: "1",
        admittedDetailBucketCount: 1,
        overflowCount: "0",
        counterSaturated: true,
        reviewWrites: [guessed("candidate_created")]
      },
      {
        ...base,
        disposition: "rate_limited",
        shardAttemptCount: "9223372036854775807",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 16,
        overflowCount: "1",
        counterSaturated: true,
        reviewWrites: [
          guessed("overflow_aggregated"),
          threshold("denial_rate_exceeded", "overflow_aggregated")
        ]
      }
    ];

    for (const result of impossible) {
      expect(inboxV2SecurityDenialResultMatchesAttempt(source, result)).toBe(
        false
      );
    }

    expect(
      inboxV2SecurityDenialResultMatchesAttempt(source, {
        ...base,
        disposition: "rate_limited",
        shardAttemptCount: "9223372036854775807",
        detailOccurrenceCount: null,
        admittedDetailBucketCount: 16,
        overflowCount: "9223372036854775807",
        counterSaturated: true,
        reviewWrites: [
          guessed("overflow_aggregated"),
          threshold("denial_rate_exceeded", "overflow_aggregated")
        ]
      })
    ).toBe(true);
  });

  it("models review candidates and coarse overflow without target disclosure", () => {
    const base = {
      tenantId,
      windowStartedAt,
      windowEndedAt,
      shardNo: 0,
      reviewType: "manual_self_claim" as const,
      alertType: "identity_claim_review" as const,
      risk: "high" as const,
      status: "open" as const,
      triggerCount: "2",
      firstSeenAt: observedAt,
      lastSeenAt: "2026-07-15T10:11:00.000Z",
      expiresAt
    };
    expect(
      inboxV2SecurityDenialReviewRecordSchema.safeParse({
        ...base,
        aggregationKind: "candidate",
        candidateFingerprint: dedupeFingerprint,
        candidateRef: `internal-ref:${"e".repeat(32)}`
      }).success
    ).toBe(true);
    expect(
      inboxV2SecurityDenialReviewRecordSchema.safeParse({
        ...base,
        aggregationKind: "overflow",
        candidateFingerprint: null,
        candidateRef: null
      }).success
    ).toBe(true);
    expect(
      inboxV2SecurityDenialReviewRecordSchema.safeParse({
        ...base,
        aggregationKind: "overflow",
        candidateFingerprint: null,
        candidateRef: `internal-ref:${"e".repeat(32)}`
      }).success
    ).toBe(false);

    for (const invalid of [
      { ...base, triggerCount: "0" },
      {
        ...base,
        windowStartedAt: "2026-07-15T10:10:00.000Z",
        windowEndedAt: "2026-07-15T11:10:00.000Z",
        expiresAt: "2026-08-14T10:10:00.000Z"
      },
      { ...base, windowEndedAt: windowStartedAt },
      { ...base, lastSeenAt: windowEndedAt },
      { ...base, alertType: "security_probe_review" },
      { ...base, risk: "medium" },
      {
        ...base,
        reviewType: "privacy_hold_release_denied",
        alertType: "privacy_control_review",
        candidateRef: `internal-ref:${"f".repeat(32)}`
      }
    ]) {
      expect(
        inboxV2SecurityDenialReviewRecordSchema.safeParse({
          ...invalid,
          aggregationKind: "candidate",
          candidateFingerprint: dedupeFingerprint,
          candidateRef: "candidateRef" in invalid ? invalid.candidateRef : null
        }).success
      ).toBe(false);
    }

    expect(
      inboxV2SecurityDenialReviewRecordSchema.safeParse({
        ...base,
        reviewType: "privacy_hold_release_denied",
        alertType: "privacy_control_review",
        risk: "critical",
        aggregationKind: "candidate",
        candidateFingerprint: dedupeFingerprint,
        candidateRef: null
      }).success
    ).toBe(true);
  });
});
