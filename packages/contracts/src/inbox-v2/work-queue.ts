import { z } from "zod";

import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2EmployeeReferenceSchema,
  inboxV2OrgUnitReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemReferenceSchema,
  inboxV2WorkQueueEligibilityDecisionIdSchema,
  inboxV2WorkQueueIdSchema,
  inboxV2WorkQueueReferenceSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2BusinessCalendarIdSchema,
  inboxV2IanaTimeZoneSchema,
  inboxV2WorkPriorityIdSchema,
  inboxV2WorkSlaPolicyIdSchema
} from "./work-primitives";

export const INBOX_V2_WORK_QUEUE_SCHEMA_ID =
  "core:inbox-v2.work-queue" as const;
export const INBOX_V2_WORK_QUEUE_ELIGIBILITY_DECISION_SCHEMA_ID =
  "core:inbox-v2.work-queue-eligibility-decision" as const;
export const INBOX_V2_WORK_QUEUE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_WORK_ASSIGNMENT_ELIGIBILITY_POLICY_CATALOG =
  "work-assignment-eligibility-policy" as const;
export const INBOX_V2_WORK_ASSIGNMENT_ELIGIBILITY_REASON_CATALOG =
  "work-assignment-eligibility-reason" as const;
const _INBOX_V2_TRUSTED_SERVICE_CATALOG = "trusted-service" as const;

export type InboxV2WorkAssignmentEligibilityPolicyId = InboxV2CatalogId<
  typeof INBOX_V2_WORK_ASSIGNMENT_ELIGIBILITY_POLICY_CATALOG
>;
export type InboxV2WorkAssignmentEligibilityReasonId = InboxV2CatalogId<
  typeof INBOX_V2_WORK_ASSIGNMENT_ELIGIBILITY_REASON_CATALOG
>;
type InboxV2TrustedServiceId = InboxV2CatalogId<
  typeof _INBOX_V2_TRUSTED_SERVICE_CATALOG
>;

export const inboxV2WorkAssignmentEligibilityPolicyIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2WorkAssignmentEligibilityPolicyId
  );
export const inboxV2WorkAssignmentEligibilityReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2WorkAssignmentEligibilityReasonId
  );
const inboxV2TrustedServiceIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2TrustedServiceId
);

export const inboxV2WorkQueueLifecycleSchema = z.enum(["active", "disabled"]);
export const inboxV2WorkQueueExternalReplyPolicySchema = z
  .object({
    mode: z.enum(["responsible_only", "responsible_or_work_item_collaborator"]),
    policyVersion: inboxV2SchemaVersionTokenSchema,
    policyRevision: inboxV2EntityRevisionSchema
  })
  .strict();
export const inboxV2WorkQueueEligibilityPolicySchema = z
  .object({
    policyId: inboxV2WorkAssignmentEligibilityPolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    policyRevision: inboxV2EntityRevisionSchema
  })
  .strict();
export const inboxV2WorkQueueDefaultSlaPolicySchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("not_applied") }).strict(),
    z
      .object({
        kind: z.literal("tracked"),
        policyId: inboxV2WorkSlaPolicyIdSchema,
        policyVersion: inboxV2SchemaVersionTokenSchema,
        policyRevision: inboxV2EntityRevisionSchema,
        businessCalendarId: inboxV2BusinessCalendarIdSchema,
        businessCalendarVersion: inboxV2SchemaVersionTokenSchema,
        businessCalendarRevision: inboxV2EntityRevisionSchema,
        timeZone: inboxV2IanaTimeZoneSchema
      })
      .strict()
  ]
);

/** Queue is an operational destination, never a Team or an access grant. */
export const inboxV2WorkQueueSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2WorkQueueIdSchema,
    ownerOrgUnit: inboxV2OrgUnitReferenceSchema,
    lifecycle: inboxV2WorkQueueLifecycleSchema,
    eligibilityPolicy: inboxV2WorkQueueEligibilityPolicySchema,
    externalReplyPolicy: inboxV2WorkQueueExternalReplyPolicySchema,
    defaultPriorityId: inboxV2WorkPriorityIdSchema,
    defaultSlaPolicy: inboxV2WorkQueueDefaultSlaPolicySchema,
    resourceAccessRevision: inboxV2EntityRevisionSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((queue, context) => {
    addTenantReferenceIssue(context, queue.tenantId, queue.ownerOrgUnit, [
      "ownerOrgUnit"
    ]);
    if (!isInboxV2TimestampOrderValid(queue.createdAt, queue.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "WorkQueue updatedAt cannot precede createdAt."
      );
    }
  });

/**
 * This is the authoritative Employee assignment fence read in the same
 * transaction as a claim/assign/transfer. It is not a caller boolean.
 */
export const inboxV2EmployeeAssignmentEligibilityFenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    state: z.enum(["active", "draining", "inactive"]),
    generation: inboxV2EntityRevisionSchema,
    revision: inboxV2EntityRevisionSchema,
    effectiveFrom: inboxV2TimestampSchema,
    loadedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((fence, context) => {
    addTenantReferenceIssue(context, fence.tenantId, fence.employee, [
      "employee"
    ]);
    if (!isInboxV2TimestampOrderValid(fence.effectiveFrom, fence.loadedAt)) {
      addIssue(
        context,
        ["loadedAt"],
        "Assignment fence cannot be loaded before it becomes effective."
      );
    }
  });

/**
 * Server-loaded exact target decision. A persisted primary assignment may
 * reference only an allow decision current for this WorkItem/Queue/Employee.
 */
export const inboxV2WorkQueueEligibilityDecisionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2WorkQueueEligibilityDecisionIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    expectedWorkItemRevision: inboxV2EntityRevisionSchema,
    queue: inboxV2WorkQueueReferenceSchema,
    queueRevision: inboxV2EntityRevisionSchema,
    queueLifecycle: inboxV2WorkQueueLifecycleSchema,
    employee: inboxV2EmployeeReferenceSchema,
    employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema,
    policy: inboxV2WorkQueueEligibilityPolicySchema,
    eligibilityBasis: z.enum([
      "queue_membership",
      "policy_override",
      "routing_policy"
    ]),
    eligibilityEvidenceRevision: inboxV2EntityRevisionSchema,
    effect: z.enum(["allow", "deny"]),
    reasonId: inboxV2WorkAssignmentEligibilityReasonIdSchema,
    decisionRevision: inboxV2EntityRevisionSchema,
    loadedByTrustedServiceId: inboxV2TrustedServiceIdSchema,
    decidedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((decision, context) => {
    for (const [field, reference] of [
      ["workItem", decision.workItem],
      ["queue", decision.queue],
      ["employee", decision.employee]
    ] as const) {
      addTenantReferenceIssue(context, decision.tenantId, reference, [field]);
    }
    if (
      decision.employeeFence.tenantId !== decision.tenantId ||
      !sameReference(decision.employeeFence.employee, decision.employee)
    ) {
      addIssue(
        context,
        ["employeeFence"],
        "Eligibility decision fence must bind the exact target Employee."
      );
    }
    if (!isInboxV2TimestampOrderValid(decision.decidedAt, decision.notAfter)) {
      addIssue(
        context,
        ["notAfter"],
        "Eligibility decision cannot expire before it is made."
      );
    }
    if (
      Date.parse(decision.employeeFence.loadedAt) >
        Date.parse(decision.decidedAt) ||
      decision.decisionRevision !== "1"
    ) {
      addIssue(
        context,
        ["decisionRevision"],
        "Eligibility decision is one immutable server-loaded snapshot current at decision time."
      );
    }
    if (
      decision.effect === "allow" &&
      (decision.queueLifecycle !== "active" ||
        decision.employeeFence.state !== "active")
    ) {
      addIssue(
        context,
        ["effect"],
        "Assignment eligibility can allow only an active Queue and Employee fence."
      );
    }
  });

export const inboxV2WorkQueueEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
  INBOX_V2_WORK_QUEUE_SCHEMA_ID,
  INBOX_V2_WORK_QUEUE_SCHEMA_VERSION,
  inboxV2WorkQueueSchema
);
export const inboxV2WorkQueueEligibilityDecisionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_QUEUE_ELIGIBILITY_DECISION_SCHEMA_ID,
    INBOX_V2_WORK_QUEUE_SCHEMA_VERSION,
    inboxV2WorkQueueEligibilityDecisionSchema
  );

export type InboxV2WorkQueueLifecycle = z.infer<
  typeof inboxV2WorkQueueLifecycleSchema
>;
export type InboxV2WorkQueueExternalReplyPolicy = z.infer<
  typeof inboxV2WorkQueueExternalReplyPolicySchema
>;
export type InboxV2WorkQueue = z.infer<typeof inboxV2WorkQueueSchema>;
export type InboxV2EmployeeAssignmentEligibilityFence = z.infer<
  typeof inboxV2EmployeeAssignmentEligibilityFenceSchema
>;
export type InboxV2WorkQueueEligibilityDecision = z.infer<
  typeof inboxV2WorkQueueEligibilityDecisionSchema
>;

function sameReference(
  left: { tenantId: string; kind: string; id: string },
  right: { tenantId: string; kind: string; id: string }
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.kind === right.kind &&
    String(left.id) === String(right.id)
  );
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "WorkQueue references must share one tenant.");
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
