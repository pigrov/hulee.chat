import { orgUnitKinds, workQueueKinds } from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  isOrgStructureSectionId,
  orgStructureSectionIds,
  orgStructureStatusKey,
  orgUnitKindKey,
  workQueueKindKey
} from "./org-structure-labels";

describe("org structure labels", () => {
  it("covers every org unit kind", () => {
    expect(orgUnitKinds.map((kind) => orgUnitKindKey(kind))).toEqual([
      "admin.orgStructure.orgUnit.kind.department",
      "admin.orgStructure.orgUnit.kind.branch",
      "admin.orgStructure.orgUnit.kind.function",
      "admin.orgStructure.kind.custom"
    ]);
  });

  it("covers every work queue kind", () => {
    expect(workQueueKinds.map((kind) => workQueueKindKey(kind))).toEqual([
      "admin.orgStructure.workQueue.kind.leadIntake",
      "admin.orgStructure.workQueue.kind.sales",
      "admin.orgStructure.workQueue.kind.claims",
      "admin.orgStructure.workQueue.kind.measurements",
      "admin.orgStructure.workQueue.kind.support",
      "admin.orgStructure.kind.custom"
    ]);
  });

  it("maps record statuses", () => {
    expect(orgStructureStatusKey("active")).toBe(
      "admin.orgStructure.status.active"
    );
    expect(orgStructureStatusKey("archived")).toBe(
      "admin.orgStructure.status.archived"
    );
  });

  it("recognizes org structure sections", () => {
    expect(orgStructureSectionIds).toEqual([
      "org_units",
      "teams",
      "work_queues"
    ]);
    expect(isOrgStructureSectionId("teams")).toBe(true);
    expect(isOrgStructureSectionId("unknown")).toBe(false);
  });
});
