import { describe, expect, it } from "vitest";

import {
  INBOX_V2_CORE_WORK_PRIORITY_IDS,
  INBOX_V2_WORK_SLA_SNAPSHOT_SCHEMA_ID,
  inboxV2WorkCounterSchema,
  inboxV2WorkItemStateSchema,
  inboxV2WorkPriorityIdSchema,
  inboxV2WorkSlaSnapshotEnvelopeSchema,
  inboxV2WorkSlaSnapshotSchema
} from "./work-primitives";

const tenantId = "tenant:tenant-1";
const t0 = "2026-07-11T09:00:00.000Z";
const t1 = "2026-07-11T10:00:00.000Z";
const t2 = "2026-07-11T11:00:00.000Z";

function sla(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    policyId: "core:support-standard",
    policyVersion: "v1",
    policyRevision: "3",
    inputRevision: "1",
    businessCalendarId: "core:moscow-business-hours",
    businessCalendarVersion: "v1",
    businessCalendarRevision: "8",
    timeZone: "Europe/Moscow",
    clockState: "running",
    startedAt: t0,
    pausedAt: null,
    pauseConditionId: null,
    stoppedAt: null,
    firstHumanResponseDueAt: t1,
    resolutionDueAt: t2,
    firstHumanResponseAt: null,
    revision: "1",
    calculatedAt: t0,
    ...overrides
  };
}

describe("Inbox V2 work primitives", () => {
  it("keeps the initial WorkItem lifecycle closed", () => {
    expect(inboxV2WorkItemStateSchema.options).toEqual([
      "new",
      "assigned",
      "in_progress",
      "waiting",
      "resolved",
      "dismissed"
    ]);
    expect(
      inboxV2WorkItemStateSchema.safeParse("recovery_pending").success
    ).toBe(false);
  });

  it("uses extensible priority IDs with stable core defaults", () => {
    expect(INBOX_V2_CORE_WORK_PRIORITY_IDS.urgent).toBe("core:urgent");
    expect(
      inboxV2WorkPriorityIdSchema.parse("module:vip-routing:escalated")
    ).toBe("module:vip-routing:escalated");
    expect(inboxV2WorkPriorityIdSchema.safeParse("urgent").success).toBe(false);
  });

  it("pins auditable SLA inputs and deadlines in a versioned envelope", () => {
    const payload = inboxV2WorkSlaSnapshotSchema.parse(sla());
    const envelope = inboxV2WorkSlaSnapshotEnvelopeSchema.parse({
      schemaId: INBOX_V2_WORK_SLA_SNAPSHOT_SCHEMA_ID,
      schemaVersion: "v1",
      payload
    });

    expect(envelope.payload.timeZone).toBe("Europe/Moscow");
    expect(envelope.payload.resolutionDueAt).toBe(t2);
  });

  it("keeps pause and stop axes explicit rather than inferring them from waiting", () => {
    expect(
      inboxV2WorkSlaSnapshotSchema.safeParse(
        sla({
          clockState: "paused",
          pausedAt: t1,
          pauseConditionId: "core:waiting-for-customer",
          calculatedAt: t1
        })
      ).success
    ).toBe(true);
    expect(
      inboxV2WorkSlaSnapshotSchema.safeParse(
        sla({ clockState: "paused", pausedAt: null, pauseConditionId: null })
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkSlaSnapshotSchema.safeParse(
        sla({ clockState: "stopped", stoppedAt: t1, calculatedAt: t1 })
      ).success
    ).toBe(true);
  });

  it("never places observed SLA events after snapshot calculation", () => {
    expect(
      inboxV2WorkSlaSnapshotSchema.safeParse(
        sla({
          clockState: "paused",
          pausedAt: t1,
          pauseConditionId: "core:waiting-for-customer"
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkSlaSnapshotSchema.safeParse(
        sla({ clockState: "stopped", stoppedAt: t1 })
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkSlaSnapshotSchema.safeParse(sla({ firstHumanResponseAt: t1 }))
        .success
    ).toBe(false);
    expect(inboxV2WorkSlaSnapshotSchema.safeParse(sla()).success).toBe(true);
  });

  it("rejects non-canonical counters and SLA timestamps before the anchor", () => {
    expect(inboxV2WorkCounterSchema.safeParse("01").success).toBe(false);
    expect(inboxV2WorkCounterSchema.safeParse("0").success).toBe(true);
    expect(
      inboxV2WorkSlaSnapshotSchema.safeParse(
        sla({ calculatedAt: "2026-07-11T08:59:59.000Z" })
      ).success
    ).toBe(false);
  });
});
