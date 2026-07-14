import { describe, expect, it } from "vitest";

import {
  INBOX_V2_WORK_QUEUE_SCHEMA_ID,
  inboxV2EmployeeAssignmentEligibilityFenceSchema,
  inboxV2WorkQueueEligibilityDecisionSchema,
  inboxV2WorkQueueEnvelopeSchema,
  inboxV2WorkQueueSchema
} from "./work-queue";

const tenantId = "tenant:tenant-1";
const t0 = "2026-07-11T09:00:00.000Z";
const t1 = "2026-07-11T10:00:00.000Z";
const t2 = "2026-07-11T11:00:00.000Z";

const employee = {
  tenantId,
  kind: "employee" as const,
  id: "employee:employee-1"
};
const queueReference = {
  tenantId,
  kind: "work_queue" as const,
  id: "work_queue:support"
};
const workItem = {
  tenantId,
  kind: "work_item" as const,
  id: "work_item:work-1"
};

function queue(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: queueReference.id,
    ownerOrgUnit: {
      tenantId,
      kind: "org_unit",
      id: "org_unit:support"
    },
    lifecycle: "active",
    eligibilityPolicy: {
      policyId: "core:active-queue-member",
      policyVersion: "v1",
      policyRevision: "5"
    },
    externalReplyPolicy: {
      mode: "responsible_only",
      policyVersion: "v1",
      policyRevision: "4"
    },
    defaultPriorityId: "core:normal",
    defaultSlaPolicy: {
      kind: "tracked",
      policyId: "core:support-standard",
      policyVersion: "v1",
      policyRevision: "3",
      businessCalendarId: "core:moscow-business-hours",
      businessCalendarVersion: "v1",
      businessCalendarRevision: "8",
      timeZone: "Europe/Moscow"
    },
    resourceAccessRevision: "2",
    revision: "3",
    createdAt: t0,
    updatedAt: t1,
    ...overrides
  };
}

function fence(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    employee,
    state: "active",
    generation: "2",
    revision: "7",
    effectiveFrom: t0,
    loadedAt: t1,
    ...overrides
  };
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: "work_queue_eligibility_decision:decision-1",
    workItem,
    expectedWorkItemRevision: "1",
    queue: queueReference,
    queueRevision: "3",
    queueLifecycle: "active",
    employee,
    employeeFence: fence(),
    policy: {
      policyId: "core:active-queue-member",
      policyVersion: "v1",
      policyRevision: "5"
    },
    eligibilityBasis: "queue_membership",
    eligibilityEvidenceRevision: "4",
    effect: "allow",
    reasonId: "core:active-member",
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:authorization",
    decidedAt: t1,
    notAfter: t2,
    ...overrides
  };
}

describe("Inbox V2 WorkQueue and assignment eligibility", () => {
  it("keeps Queue, Team and permission semantics separate", () => {
    const parsed = inboxV2WorkQueueSchema.parse(queue());
    expect(parsed.ownerOrgUnit.kind).toBe("org_unit");
    expect(parsed.externalReplyPolicy.mode).toBe("responsible_only");
    expect("team" in parsed).toBe(false);
    expect("members" in parsed).toBe(false);
    expect("grants" in parsed).toBe(false);
  });

  it("publishes Queue through an exact versioned envelope", () => {
    expect(
      inboxV2WorkQueueEnvelopeSchema.parse({
        schemaId: INBOX_V2_WORK_QUEUE_SCHEMA_ID,
        schemaVersion: "v1",
        payload: queue()
      }).payload.id
    ).toBe(queueReference.id);
  });

  it("accepts an exact server-loaded allow decision for an active target", () => {
    const parsed = inboxV2WorkQueueEligibilityDecisionSchema.parse(decision());
    expect(parsed.effect).toBe("allow");
    expect(parsed.employeeFence.generation).toBe("2");
  });

  it("rejects allow for disabled Queue or draining/inactive target", () => {
    expect(
      inboxV2WorkQueueEligibilityDecisionSchema.safeParse(
        decision({ queueLifecycle: "disabled" })
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkQueueEligibilityDecisionSchema.safeParse(
        decision({ employeeFence: fence({ state: "draining" }) })
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkQueueEligibilityDecisionSchema.safeParse(
        decision({ employeeFence: fence({ state: "inactive" }) })
      ).success
    ).toBe(false);
  });

  it("allows diagnosable deny decisions without inventing permission", () => {
    expect(
      inboxV2WorkQueueEligibilityDecisionSchema.safeParse(
        decision({
          effect: "deny",
          queueLifecycle: "disabled",
          employeeFence: fence({ state: "draining" }),
          reasonId: "core:employee-draining"
        })
      ).success
    ).toBe(true);
  });

  it("rejects cross-tenant fences, employees and expired decisions", () => {
    expect(
      inboxV2EmployeeAssignmentEligibilityFenceSchema.safeParse(
        fence({ employee: { ...employee, tenantId: "tenant:tenant-2" } })
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkQueueEligibilityDecisionSchema.safeParse(
        decision({ notAfter: "2026-07-11T09:59:59.000Z" })
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkQueueEligibilityDecisionSchema.safeParse(
        decision({
          employeeFence: fence({ loadedAt: t2 }),
          decidedAt: t1
        })
      ).success
    ).toBe(false);
  });
});
