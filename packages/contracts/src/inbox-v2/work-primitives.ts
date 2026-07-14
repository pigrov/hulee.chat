import { z } from "zod";

import type { Brand } from "../brand";
import {
  inboxV2AuthorizationEpochSchema,
  type InboxV2AuthorizationEpoch
} from "./authorization-epoch";
import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2EmployeeReferenceSchema, inboxV2TenantIdSchema } from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";

export const INBOX_V2_WORK_SLA_SNAPSHOT_SCHEMA_ID =
  "core:inbox-v2.work-sla-snapshot" as const;
export const INBOX_V2_WORK_PRIMITIVES_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_WORK_PRIORITY_CATALOG = "work-priority" as const;
export const INBOX_V2_WORK_REASON_CATALOG = "work-reason" as const;
export const INBOX_V2_WORK_SLA_POLICY_CATALOG = "work-sla-policy" as const;
export const INBOX_V2_BUSINESS_CALENDAR_CATALOG = "business-calendar" as const;
export const INBOX_V2_WORK_SLA_PAUSE_CONDITION_CATALOG =
  "work-sla-pause-condition" as const;
export const INBOX_V2_WORK_SLA_ABSENCE_REASON_CATALOG =
  "work-sla-absence-reason" as const;
const _INBOX_V2_TRUSTED_SERVICE_CATALOG = "trusted-service" as const;

export type InboxV2WorkPriorityId = InboxV2CatalogId<
  typeof INBOX_V2_WORK_PRIORITY_CATALOG
>;
export type InboxV2WorkReasonId = InboxV2CatalogId<
  typeof INBOX_V2_WORK_REASON_CATALOG
>;
export type InboxV2WorkSlaPolicyId = InboxV2CatalogId<
  typeof INBOX_V2_WORK_SLA_POLICY_CATALOG
>;
export type InboxV2BusinessCalendarId = InboxV2CatalogId<
  typeof INBOX_V2_BUSINESS_CALENDAR_CATALOG
>;
export type InboxV2WorkSlaPauseConditionId = InboxV2CatalogId<
  typeof INBOX_V2_WORK_SLA_PAUSE_CONDITION_CATALOG
>;
export type InboxV2WorkSlaAbsenceReasonId = InboxV2CatalogId<
  typeof INBOX_V2_WORK_SLA_ABSENCE_REASON_CATALOG
>;
type InboxV2TrustedServiceId = InboxV2CatalogId<
  typeof _INBOX_V2_TRUSTED_SERVICE_CATALOG
>;
export type InboxV2WorkCounter = Brand<string, "InboxV2WorkCounter">;
export type InboxV2WorkAuthorizationEpoch = InboxV2AuthorizationEpoch;

export const inboxV2WorkPriorityIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2WorkPriorityId
);
export const inboxV2WorkReasonIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2WorkReasonId
);
export const inboxV2WorkSlaPolicyIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2WorkSlaPolicyId
);
export const inboxV2BusinessCalendarIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2BusinessCalendarId
);
export const inboxV2WorkSlaPauseConditionIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2WorkSlaPauseConditionId
  );
export const inboxV2WorkSlaAbsenceReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2WorkSlaAbsenceReasonId
  );
const inboxV2TrustedServiceIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2TrustedServiceId
);

export const inboxV2WorkCounterSchema = inboxV2BigintCounterSchema.transform(
  (value) => value as unknown as InboxV2WorkCounter
);

export const inboxV2WorkAuthorizationEpochSchema =
  inboxV2AuthorizationEpochSchema;

/** The server stamps the actor; callers cannot claim an Employee identity. */
export const inboxV2WorkActorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("employee"),
      employee: inboxV2EmployeeReferenceSchema,
      authorizationEpoch: inboxV2WorkAuthorizationEpochSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("trusted_service"),
      trustedServiceId: inboxV2TrustedServiceIdSchema
    })
    .strict()
]);

export const inboxV2WorkItemStateSchema = z.enum([
  "new",
  "assigned",
  "in_progress",
  "waiting",
  "resolved",
  "dismissed"
]);
export const inboxV2OwnedWorkItemStateSchema = z.enum([
  "assigned",
  "in_progress",
  "waiting"
]);
export const inboxV2TerminalWorkItemStateSchema = z.enum([
  "resolved",
  "dismissed"
]);

export const INBOX_V2_CORE_WORK_PRIORITY_IDS = Object.freeze({
  low: inboxV2WorkPriorityIdSchema.parse("core:low"),
  normal: inboxV2WorkPriorityIdSchema.parse("core:normal"),
  high: inboxV2WorkPriorityIdSchema.parse("core:high"),
  urgent: inboxV2WorkPriorityIdSchema.parse("core:urgent")
});

export const inboxV2IanaTimeZoneSchema = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (value) =>
      value === "UTC" ||
      /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+$/.test(value),
    { message: "SLA timezone must be UTC or an IANA timezone identifier." }
  );

export const inboxV2WorkSlaClockStateSchema = z.enum([
  "running",
  "paused",
  "stopped"
]);

/**
 * Immutable calculation snapshot. INB2-WRK-007 owns the calendar evaluator;
 * this contract pins its versioned inputs and auditable outputs now.
 */
export const inboxV2WorkSlaSnapshotSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    policyId: inboxV2WorkSlaPolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    policyRevision: inboxV2EntityRevisionSchema,
    inputRevision: inboxV2EntityRevisionSchema,
    businessCalendarId: inboxV2BusinessCalendarIdSchema,
    businessCalendarVersion: inboxV2SchemaVersionTokenSchema,
    businessCalendarRevision: inboxV2EntityRevisionSchema,
    timeZone: inboxV2IanaTimeZoneSchema,
    clockState: inboxV2WorkSlaClockStateSchema,
    startedAt: inboxV2TimestampSchema,
    pausedAt: inboxV2TimestampSchema.nullable(),
    pauseConditionId: inboxV2WorkSlaPauseConditionIdSchema.nullable(),
    stoppedAt: inboxV2TimestampSchema.nullable(),
    firstHumanResponseDueAt: inboxV2TimestampSchema.nullable(),
    resolutionDueAt: inboxV2TimestampSchema.nullable(),
    firstHumanResponseAt: inboxV2TimestampSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    calculatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    const pausePairIsValid =
      snapshot.clockState === "paused"
        ? snapshot.pausedAt !== null && snapshot.pauseConditionId !== null
        : snapshot.pausedAt === null && snapshot.pauseConditionId === null;
    if (!pausePairIsValid) {
      addIssue(
        context,
        ["pausedAt"],
        "Only a paused SLA clock has pause time and condition."
      );
    }

    if ((snapshot.clockState === "stopped") !== (snapshot.stoppedAt !== null)) {
      addIssue(
        context,
        ["stoppedAt"],
        "Only a stopped SLA clock has a stop timestamp."
      );
    }

    for (const [field, timestamp] of [
      ["pausedAt", snapshot.pausedAt],
      ["stoppedAt", snapshot.stoppedAt],
      ["firstHumanResponseDueAt", snapshot.firstHumanResponseDueAt],
      ["resolutionDueAt", snapshot.resolutionDueAt],
      ["firstHumanResponseAt", snapshot.firstHumanResponseAt],
      ["calculatedAt", snapshot.calculatedAt]
    ] as const) {
      if (
        timestamp !== null &&
        !isInboxV2TimestampOrderValid(snapshot.startedAt, timestamp)
      ) {
        addIssue(context, [field], `SLA ${field} cannot precede clock start.`);
      }
    }

    for (const [field, timestamp] of [
      ["pausedAt", snapshot.pausedAt],
      ["stoppedAt", snapshot.stoppedAt],
      ["firstHumanResponseAt", snapshot.firstHumanResponseAt]
    ] as const) {
      if (
        timestamp !== null &&
        !isInboxV2TimestampOrderValid(timestamp, snapshot.calculatedAt)
      ) {
        addIssue(
          context,
          [field],
          `Observed SLA ${field} cannot follow snapshot calculation.`
        );
      }
    }
  });

export const inboxV2WorkSlaSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("not_applied"),
      reasonId: inboxV2WorkSlaAbsenceReasonIdSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("tracked"),
      snapshot: inboxV2WorkSlaSnapshotSchema
    })
    .strict()
]);

export const inboxV2WorkSlaSnapshotEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_SLA_SNAPSHOT_SCHEMA_ID,
    INBOX_V2_WORK_PRIMITIVES_SCHEMA_VERSION,
    inboxV2WorkSlaSnapshotSchema
  );

export type InboxV2WorkActor = z.infer<typeof inboxV2WorkActorSchema>;
export type InboxV2WorkItemState = z.infer<typeof inboxV2WorkItemStateSchema>;
export type InboxV2OwnedWorkItemState = z.infer<
  typeof inboxV2OwnedWorkItemStateSchema
>;
export type InboxV2TerminalWorkItemState = z.infer<
  typeof inboxV2TerminalWorkItemStateSchema
>;
export type InboxV2WorkSlaSnapshot = z.infer<
  typeof inboxV2WorkSlaSnapshotSchema
>;
export type InboxV2WorkSla = z.infer<typeof inboxV2WorkSlaSchema>;
export type InboxV2WorkSlaSnapshotEnvelope = z.infer<
  typeof inboxV2WorkSlaSnapshotEnvelopeSchema
>;

export function isInboxV2OwnedWorkItemState(
  state: InboxV2WorkItemState
): state is InboxV2OwnedWorkItemState {
  return state === "assigned" || state === "in_progress" || state === "waiting";
}

export function isInboxV2TerminalWorkItemState(
  state: InboxV2WorkItemState
): state is InboxV2TerminalWorkItemState {
  return state === "resolved" || state === "dismissed";
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
