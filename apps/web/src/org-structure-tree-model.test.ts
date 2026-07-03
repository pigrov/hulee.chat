import type { TenantId } from "@hulee/contracts";
import type { OrgUnitKind, OrgUnitRecord } from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  buildOrgUnitTreeState,
  canMoveOrgUnit
} from "./org-structure-tree-model";

const tenantId = "tenant_tree_1" as TenantId;

describe("org structure tree model", () => {
  it("hides descendants of collapsed org units instead of rendering them as roots", () => {
    const orgUnits = [
      orgUnit({ id: "org-root", name: "Root" }),
      orgUnit({
        id: "org-child",
        parentOrgUnitId: "org-root",
        name: "Child"
      }),
      orgUnit({
        id: "org-grandchild",
        parentOrgUnitId: "org-child",
        name: "Grandchild"
      })
    ];

    expect(visibleIds(orgUnits, [])).toEqual(["org-root"]);
    expect(visibleIds(orgUnits, ["org-root"])).toEqual([
      "org-root",
      "org-child"
    ]);
    expect(visibleIds(orgUnits, ["org-root", "org-child"])).toEqual([
      "org-root",
      "org-child",
      "org-grandchild"
    ]);
  });

  it("rejects moves under the same parent, self, or descendants", () => {
    const orgUnits = [
      orgUnit({ id: "org-root", name: "Root" }),
      orgUnit({
        id: "org-child",
        parentOrgUnitId: "org-root",
        name: "Child"
      })
    ];
    const state = buildOrgUnitTreeState({
      expandedUnitIds: new Set(["org-root"]),
      locale: "ru",
      orgUnits
    });

    expect(
      canMoveOrgUnit({
        descendantsByUnit: state.descendantsByUnit,
        draggedId: "org-child",
        targetParentId: "org-root",
        unitsById: state.unitsById
      })
    ).toBe(false);
    expect(
      canMoveOrgUnit({
        descendantsByUnit: state.descendantsByUnit,
        draggedId: "org-root",
        targetParentId: "org-root",
        unitsById: state.unitsById
      })
    ).toBe(false);
    expect(
      canMoveOrgUnit({
        descendantsByUnit: state.descendantsByUnit,
        draggedId: "org-root",
        targetParentId: "org-child",
        unitsById: state.unitsById
      })
    ).toBe(false);
    expect(
      canMoveOrgUnit({
        descendantsByUnit: state.descendantsByUnit,
        draggedId: "org-child",
        targetParentId: null,
        unitsById: state.unitsById
      })
    ).toBe(true);
  });
});

function visibleIds(
  orgUnits: readonly OrgUnitRecord[],
  expandedUnitIds: readonly string[]
): readonly string[] {
  return buildOrgUnitTreeState({
    expandedUnitIds: new Set(expandedUnitIds),
    locale: "ru",
    orgUnits
  }).visibleRows.map((row) => row.orgUnit.id);
}

function orgUnit(input: {
  readonly id: string;
  readonly kind?: OrgUnitKind;
  readonly name: string;
  readonly parentOrgUnitId?: string | null;
}): OrgUnitRecord {
  return {
    id: input.id,
    tenantId,
    parentOrgUnitId: input.parentOrgUnitId ?? null,
    name: input.name,
    kind: input.kind ?? "department",
    status: "active"
  };
}
