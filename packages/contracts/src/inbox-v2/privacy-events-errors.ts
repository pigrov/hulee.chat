import { z } from "zod";

import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2EventIdSchema, inboxV2TenantIdSchema } from "./ids";
import { inboxV2CatalogIdSchema } from "./catalog";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2InternalEntityReferenceSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";
import {
  inboxV2LifecycleHandlerIdSchema,
  inboxV2StorageRootIdSchema
} from "./data-lifecycle-primitives";
import {
  inboxV2PrivacyCorrelationIdSchema,
  inboxV2PrivacyEvidenceReferenceSchema
} from "./privacy-audit";

export const INBOX_V2_PRIVACY_EVENT_SCHEMA_ID =
  "core:inbox-v2.privacy-event" as const;
export const INBOX_V2_PRIVACY_DIAGNOSTIC_SCHEMA_ID =
  "core:inbox-v2.privacy-diagnostic" as const;
export const INBOX_V2_PRIVACY_EVENT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

const minimizedPrivacyTokenSchema = (prefix: string) =>
  z
    .string()
    .min(prefix.length + 33)
    .max(prefix.length + 65)
    .regex(new RegExp(`^${prefix}:[a-f0-9]{32,64}$`, "u"));

export const inboxV2PrivacyEventIdSchema = minimizedPrivacyTokenSchema(
  "event"
).transform((value) => value as z.output<typeof inboxV2EventIdSchema>);
export const inboxV2PrivacyDiagnosticIdSchema =
  minimizedPrivacyTokenSchema("privacy-diagnostic");

export const inboxV2PrivacyEventTypeSchema = z.enum([
  "privacy.policy.revised",
  "privacy.policy.activated",
  "privacy.request.received",
  "privacy.request.decided",
  "privacy.request.completed",
  "privacy.hold.issued",
  "privacy.hold.released",
  "privacy.restriction.changed",
  "privacy.export.started",
  "privacy.export.ready",
  "privacy.export.expired",
  "privacy.export.revoked",
  "privacy.deletion.started",
  "privacy.deletion.handler_failed",
  "privacy.deletion.completed",
  "privacy.external_deletion.updated",
  "retention.run.started",
  "retention.run.completed",
  "retention.run.blocked",
  "retention.stream_prefix_advanced"
]);

export const inboxV2PrivacyErrorCodeSchema = z.enum([
  "privacy.policy_missing",
  "privacy.data_class_unknown",
  "privacy.identity_verification_required",
  "privacy.scope_ambiguous",
  "privacy.third_party_redaction_required",
  "privacy.hold_active",
  "privacy.restriction_active",
  "privacy.legal_review_required",
  "privacy.export_access_changed",
  "privacy.export_expired",
  "privacy.delete_handler_failed",
  "privacy.external_residual",
  "retention.parent_deadline_violation",
  "retention.backup_expiry_unproven",
  "retention.stream_prefix_blocked"
]);

export const inboxV2ExternalDeletionOutcomeSchema = z.enum([
  "not_required",
  "requested",
  "confirmed",
  "unsupported",
  "unknown",
  "failed_retryable"
]);

export const inboxV2PrivacyOperationResultSchema = z.enum([
  "approved",
  "partially_approved",
  "rejected",
  "blocked_by_legal_hold",
  "completed",
  "completed_with_external_residuals",
  "primary_purged_backup_expiry_pending",
  "verification_blocked_internal_residual",
  "failed_retryable"
]);

const privacyDecisionResults = new Set([
  "approved",
  "partially_approved",
  "rejected",
  "blocked_by_legal_hold"
]);
const privacyCompletionResults = new Set([
  "completed",
  "completed_with_external_residuals",
  "primary_purged_backup_expiry_pending",
  "verification_blocked_internal_residual",
  "failed_retryable"
]);

const revisionedSubjectPayloadFields = {
  subject: inboxV2InternalEntityReferenceSchema,
  revision: inboxV2EntityRevisionSchema
} as const;

function revisionedPayload<const TKind extends string>(kind: TKind) {
  return z
    .object({
      kind: z.literal(kind),
      ...revisionedSubjectPayloadFields,
      reasonId: inboxV2CatalogIdSchema.nullable()
    })
    .strict();
}

function resultPayload<const TKind extends string>(kind: TKind) {
  return z
    .object({
      kind: z.literal(kind),
      ...revisionedSubjectPayloadFields,
      result: inboxV2PrivacyOperationResultSchema,
      reasonId: inboxV2CatalogIdSchema
    })
    .strict();
}

export const inboxV2PrivacyEventPayloadSchema = z.discriminatedUnion("kind", [
  revisionedPayload("privacy.policy.revised"),
  revisionedPayload("privacy.policy.activated"),
  revisionedPayload("privacy.request.received"),
  resultPayload("privacy.request.decided"),
  resultPayload("privacy.request.completed"),
  revisionedPayload("privacy.hold.issued"),
  revisionedPayload("privacy.hold.released"),
  revisionedPayload("privacy.restriction.changed"),
  revisionedPayload("privacy.export.started"),
  revisionedPayload("privacy.export.ready"),
  revisionedPayload("privacy.export.expired"),
  revisionedPayload("privacy.export.revoked"),
  revisionedPayload("privacy.deletion.started"),
  z
    .object({
      kind: z.literal("privacy.deletion.handler_failed"),
      ...revisionedSubjectPayloadFields,
      handlerId: inboxV2LifecycleHandlerIdSchema,
      rootId: inboxV2StorageRootIdSchema,
      errorCode: inboxV2PrivacyErrorCodeSchema,
      retryable: z.boolean()
    })
    .strict(),
  resultPayload("privacy.deletion.completed"),
  z
    .object({
      kind: z.literal("privacy.external_deletion.updated"),
      ...revisionedSubjectPayloadFields,
      routeId: inboxV2CatalogIdSchema,
      outcome: inboxV2ExternalDeletionOutcomeSchema,
      evidenceRef: inboxV2PrivacyEvidenceReferenceSchema.nullable()
    })
    .strict(),
  revisionedPayload("retention.run.started"),
  resultPayload("retention.run.completed"),
  z
    .object({
      kind: z.literal("retention.run.blocked"),
      ...revisionedSubjectPayloadFields,
      errorCode: inboxV2PrivacyErrorCodeSchema,
      blockedRootCount: inboxV2BigintCounterSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("retention.stream_prefix_advanced"),
      streamEpoch: inboxV2StreamEpochSchema,
      syncGeneration: inboxV2SyncGenerationSchema,
      previousMinRetainedPosition: inboxV2TenantStreamPositionSchema,
      resultingMinRetainedPosition: inboxV2TenantStreamPositionSchema
    })
    .strict()
]);

export const inboxV2PrivacyEventSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    eventId: inboxV2PrivacyEventIdSchema,
    eventType: inboxV2PrivacyEventTypeSchema,
    occurredAt: inboxV2TimestampSchema,
    correlationId: inboxV2PrivacyCorrelationIdSchema,
    payload: inboxV2PrivacyEventPayloadSchema
  })
  .strict()
  .superRefine((event, context) => {
    const payloadTenantInvalid =
      "subject" in event.payload &&
      event.payload.subject.tenantId !== event.tenantId;
    const evidenceTenantInvalid =
      "evidenceRef" in event.payload &&
      event.payload.evidenceRef !== null &&
      event.payload.evidenceRef.tenantId !== event.tenantId;
    const resultInvalid =
      event.payload.kind === "privacy.request.decided"
        ? !privacyDecisionResults.has(event.payload.result)
        : event.payload.kind === "privacy.request.completed" ||
            event.payload.kind === "privacy.deletion.completed" ||
            event.payload.kind === "retention.run.completed"
          ? !privacyCompletionResults.has(event.payload.result)
          : false;
    if (
      event.eventType !== event.payload.kind ||
      payloadTenantInvalid ||
      evidenceTenantInvalid ||
      resultInvalid ||
      (event.payload.kind === "retention.stream_prefix_advanced" &&
        BigInt(event.payload.resultingMinRetainedPosition) <=
          BigInt(event.payload.previousMinRetainedPosition))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Privacy event must bind its exact type and tenant-safe monotonic payload."
      });
    }
  });

export const inboxV2PrivacyEventEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVACY_EVENT_SCHEMA_ID,
    INBOX_V2_PRIVACY_EVENT_SCHEMA_VERSION,
    inboxV2PrivacyEventSchema
  );

export const inboxV2PrivacyDiagnosticSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    diagnosticId: inboxV2PrivacyDiagnosticIdSchema,
    errorCode: inboxV2PrivacyErrorCodeSchema,
    severity: z.enum(["info", "warning", "error", "critical"]),
    retryability: z.enum(["retryable", "not_retryable", "unknown"]),
    target: inboxV2InternalEntityReferenceSchema.nullable(),
    rootId: inboxV2StorageRootIdSchema.nullable(),
    affectedCount: inboxV2BigintCounterSchema,
    operatorHintId: inboxV2CatalogIdSchema,
    observedAt: inboxV2TimestampSchema,
    nextRetryAt: inboxV2TimestampSchema.nullable()
  })
  .strict()
  .superRefine((diagnostic, context) => {
    if (
      diagnostic.target?.tenantId !== undefined &&
      diagnostic.target.tenantId !== diagnostic.tenantId
    ) {
      context.addIssue({
        code: "custom",
        message: "Privacy diagnostic target cannot cross tenants."
      });
    }
    if (
      diagnostic.retryability === "not_retryable" &&
      diagnostic.nextRetryAt !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextRetryAt"],
        message: "Non-retryable diagnostic cannot schedule a retry."
      });
    }
  });

export const inboxV2PrivacyDiagnosticEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVACY_DIAGNOSTIC_SCHEMA_ID,
    INBOX_V2_PRIVACY_EVENT_SCHEMA_VERSION,
    inboxV2PrivacyDiagnosticSchema
  );

export type InboxV2PrivacyEvent = z.infer<typeof inboxV2PrivacyEventSchema>;
export type InboxV2PrivacyDiagnostic = z.infer<
  typeof inboxV2PrivacyDiagnosticSchema
>;
