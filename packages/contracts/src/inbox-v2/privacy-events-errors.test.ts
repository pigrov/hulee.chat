import { describe, expect, it } from "vitest";

import {
  inboxV2PrivacyDiagnosticEnvelopeSchema,
  inboxV2PrivacyDiagnosticSchema,
  inboxV2PrivacyErrorCodeSchema,
  inboxV2PrivacyEventEnvelopeSchema,
  inboxV2PrivacyEventSchema,
  inboxV2PrivacyEventTypeSchema
} from "./privacy-events-errors";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const occurredAt = "2026-07-11T10:00:00.000Z";
const eventId = `event:${"a".repeat(32)}`;
const correlationId = `privacy-correlation:${"b".repeat(32)}`;
const evidenceId = `privacy-evidence:${"c".repeat(32)}`;
const diagnosticId = `privacy-diagnostic:${"d".repeat(32)}`;
const subject = {
  tenantId,
  entityTypeId: "core:privacy-request",
  entityId: `internal-ref:${"e".repeat(32)}`
};

const revisionedEventTypes = [
  "privacy.policy.revised",
  "privacy.policy.activated",
  "privacy.request.received",
  "privacy.hold.issued",
  "privacy.hold.released",
  "privacy.restriction.changed",
  "privacy.export.started",
  "privacy.export.ready",
  "privacy.export.expired",
  "privacy.export.revoked",
  "privacy.deletion.started",
  "retention.run.started"
] as const;

function event(payload: Record<string, unknown>) {
  return {
    tenantId,
    eventId,
    eventType: payload.kind,
    occurredAt,
    correlationId,
    payload
  };
}

function revisionedPayload(kind: (typeof revisionedEventTypes)[number]) {
  return {
    kind,
    subject,
    revision: "1",
    reasonId: "core:privacy.reason.approved"
  };
}

describe("Inbox V2 privacy events and diagnostics", () => {
  it("keeps the ADR event and error catalogs exact and finite", () => {
    expect(inboxV2PrivacyEventTypeSchema.options).toHaveLength(20);
    expect(inboxV2PrivacyErrorCodeSchema.options).toHaveLength(15);
    expect(new Set(inboxV2PrivacyEventTypeSchema.options).size).toBe(20);
    expect(new Set(inboxV2PrivacyErrorCodeSchema.options).size).toBe(15);
    expect(() =>
      assertInboxV2ClosedJsonSchema(inboxV2PrivacyEventSchema, "privacy event")
    ).not.toThrow();
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2PrivacyDiagnosticSchema,
        "privacy diagnostic"
      )
    ).not.toThrow();
  });

  it("accepts every event family and its versioned envelope", () => {
    const payloads = [
      ...revisionedEventTypes.map(revisionedPayload),
      {
        kind: "privacy.request.decided",
        subject,
        revision: "2",
        result: "partially_approved",
        reasonId: "core:privacy.reason.partially-approved"
      },
      {
        kind: "privacy.request.completed",
        subject,
        revision: "3",
        result: "completed",
        reasonId: "core:privacy.reason.completed"
      },
      {
        kind: "privacy.deletion.handler_failed",
        subject,
        revision: "2",
        handlerId: "core:lifecycle.message-content",
        rootId: "core:message-content",
        errorCode: "privacy.delete_handler_failed",
        retryable: true
      },
      {
        kind: "privacy.deletion.completed",
        subject,
        revision: "3",
        result: "completed_with_external_residuals",
        reasonId: "core:privacy.reason.external-residual"
      },
      {
        kind: "privacy.external_deletion.updated",
        subject,
        revision: "4",
        routeId: "core:external-route.telegram",
        outcome: "confirmed",
        evidenceRef: {
          tenantId,
          entityTypeId: "core:privacy-evidence",
          entityId: evidenceId
        }
      },
      {
        kind: "retention.run.completed",
        subject,
        revision: "2",
        result: "primary_purged_backup_expiry_pending",
        reasonId: "core:privacy.reason.backup-expiry-pending"
      },
      {
        kind: "retention.run.blocked",
        subject,
        revision: "2",
        errorCode: "retention.backup_expiry_unproven",
        blockedRootCount: "1"
      },
      {
        kind: "retention.stream_prefix_advanced",
        streamEpoch: "stream-epoch-1",
        syncGeneration: "1",
        previousMinRetainedPosition: "10",
        resultingMinRetainedPosition: "11"
      }
    ];

    expect(payloads).toHaveLength(20);
    for (const payload of payloads) {
      const value = event(payload);
      expect(inboxV2PrivacyEventSchema.safeParse(value).success).toBe(true);
      expect(
        inboxV2PrivacyEventEnvelopeSchema.safeParse({
          schemaId: "core:inbox-v2.privacy-event",
          schemaVersion: "v1",
          payload: value
        }).success
      ).toBe(true);
    }
  });

  it("rejects mismatched types, cross-tenant references and illegal outcomes", () => {
    expect(
      inboxV2PrivacyEventSchema.safeParse({
        ...event(revisionedPayload("privacy.policy.revised")),
        eventType: "privacy.policy.activated"
      }).success
    ).toBe(false);

    expect(
      inboxV2PrivacyEventSchema.safeParse(
        event({
          ...revisionedPayload("privacy.request.received"),
          subject: { ...subject, tenantId: "tenant:tenant-2" }
        })
      ).success
    ).toBe(false);

    expect(
      inboxV2PrivacyEventSchema.safeParse(
        event({
          kind: "privacy.request.decided",
          subject,
          revision: "2",
          result: "completed",
          reasonId: "core:privacy.reason.completed"
        })
      ).success
    ).toBe(false);

    expect(
      inboxV2PrivacyEventSchema.safeParse(
        event({
          kind: "privacy.deletion.completed",
          subject,
          revision: "2",
          result: "approved",
          reasonId: "core:privacy.reason.approved"
        })
      ).success
    ).toBe(false);
  });

  it("requires stream-prefix advancement to be strictly monotonic", () => {
    for (const resultingMinRetainedPosition of ["10", "9"]) {
      expect(
        inboxV2PrivacyEventSchema.safeParse(
          event({
            kind: "retention.stream_prefix_advanced",
            streamEpoch: "stream-epoch-1",
            syncGeneration: "1",
            previousMinRetainedPosition: "10",
            resultingMinRetainedPosition
          })
        ).success
      ).toBe(false);
    }
  });

  it("keeps event and diagnostic payloads metadata-only", () => {
    for (const forbidden of [
      { messageText: "secret" },
      { phone: "+79990000000" },
      { token: "provider-token" },
      { rawProviderPayload: { update_id: 1 } },
      { metadata: { arbitrary: true } }
    ]) {
      expect(
        inboxV2PrivacyEventSchema.safeParse({
          ...event(revisionedPayload("privacy.request.received")),
          ...forbidden
        }).success
      ).toBe(false);
    }
  });

  it("rejects PII-bearing or non-opaque event, correlation, evidence and diagnostic references", () => {
    const baseEvent = event(revisionedPayload("privacy.request.received"));
    for (const invalid of [
      { eventId: "event:customer-alice" },
      { eventId: `event:${"A".repeat(32)}` },
      { correlationId: "privacy-correlation:person@example.test" },
      { correlationId: `privacy-correlation:${"b".repeat(31)}` }
    ]) {
      expect(
        inboxV2PrivacyEventSchema.safeParse({ ...baseEvent, ...invalid })
          .success
      ).toBe(false);
    }

    expect(
      inboxV2PrivacyEventSchema.safeParse(
        event({
          kind: "privacy.external_deletion.updated",
          subject,
          revision: "4",
          routeId: "core:external-route.telegram",
          outcome: "confirmed",
          evidenceRef: {
            tenantId,
            entityTypeId: "core:privacy-evidence",
            entityId: "privacy-evidence:customer-phone-79990000000"
          }
        })
      ).success
    ).toBe(false);

    for (const entityId of [
      "79990000000",
      "person@example.test",
      "telegram:123456789",
      "+79990000000"
    ]) {
      expect(
        inboxV2PrivacyEventSchema.safeParse(
          event({
            ...revisionedPayload("privacy.request.received"),
            subject: { ...subject, entityId }
          })
        ).success
      ).toBe(false);
    }
  });

  it("enforces tenant-safe and retry-safe diagnostics", () => {
    const diagnostic = {
      tenantId,
      diagnosticId,
      errorCode: "privacy.delete_handler_failed" as const,
      severity: "error" as const,
      retryability: "retryable" as const,
      target: subject,
      rootId: "core:message-content",
      affectedCount: "1",
      operatorHintId: "core:privacy.hint.retry-handler",
      observedAt: occurredAt,
      nextRetryAt: "2026-07-11T10:05:00.000Z"
    };

    expect(inboxV2PrivacyDiagnosticSchema.safeParse(diagnostic).success).toBe(
      true
    );
    expect(
      inboxV2PrivacyDiagnosticEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.privacy-diagnostic",
        schemaVersion: "v1",
        payload: diagnostic
      }).success
    ).toBe(true);
    expect(
      inboxV2PrivacyDiagnosticSchema.safeParse({
        ...diagnostic,
        target: { ...subject, tenantId: "tenant:tenant-2" }
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyDiagnosticSchema.safeParse({
        ...diagnostic,
        retryability: "not_retryable"
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyDiagnosticSchema.safeParse({
        ...diagnostic,
        diagnosticId: "privacy-diagnostic:person-alice"
      }).success
    ).toBe(false);
    for (const entityId of [
      "79990000000",
      "person@example.test",
      "telegram:123456789"
    ]) {
      expect(
        inboxV2PrivacyDiagnosticSchema.safeParse({
          ...diagnostic,
          target: { ...subject, entityId }
        }).success
      ).toBe(false);
    }
  });
});
