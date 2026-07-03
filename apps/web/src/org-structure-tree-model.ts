import type { OrgUnitRecord } from "@hulee/db";

export const ROOT_PARENT_ID = "__root__";

export type OrgUnitTreeRow = {
  readonly orgUnit: OrgUnitRecord;
  readonly depth: number;
  readonly childCount: number;
};

export type OrgUnitTreeDerivedState = {
  readonly allRows: readonly OrgUnitTreeRow[];
  readonly visibleRows: readonly OrgUnitTreeRow[];
  readonly childrenByParent: ReadonlyMap<string, readonly OrgUnitRecord[]>;
  readonly descendantsByUnit: ReadonlyMap<string, ReadonlySet<string>>;
  readonly unitsById: ReadonlyMap<string, OrgUnitRecord>;
};

export function buildOrgUnitTreeState(input: {
  readonly expandedUnitIds: ReadonlySet<string>;
  readonly locale: string;
  readonly orgUnits: readonly OrgUnitRecord[];
}): OrgUnitTreeDerivedState {
  const unitsById = new Map(
    input.orgUnits.map((orgUnit) => [orgUnit.id, orgUnit])
  );
  const childrenByParent = new Map<string, OrgUnitRecord[]>();

  for (const orgUnit of input.orgUnits) {
    const parentKey =
      orgUnit.parentOrgUnitId !== null && unitsById.has(orgUnit.parentOrgUnitId)
        ? orgUnit.parentOrgUnitId
        : ROOT_PARENT_ID;
    childrenByParent.set(parentKey, [
      ...(childrenByParent.get(parentKey) ?? []),
      orgUnit
    ]);
  }

  for (const [parentId, childOrgUnits] of childrenByParent) {
    childrenByParent.set(parentId, sortOrgUnits(childOrgUnits, input.locale));
  }

  const descendantsByUnit = buildDescendantsByUnit(input.orgUnits);
  const allRows: OrgUnitTreeRow[] = [];
  const visibleRows: OrgUnitTreeRow[] = [];
  const allVisited = new Set<string>();
  const visibleVisited = new Set<string>();
  const rootReachableUnitIds = new Set<string>();

  const visit = (params: {
    readonly parentId: string;
    readonly depth: number;
    readonly target: OrgUnitTreeRow[];
    readonly visited: Set<string>;
    readonly respectExpansion: boolean;
  }): void => {
    for (const orgUnit of childrenByParent.get(params.parentId) ?? []) {
      if (params.visited.has(orgUnit.id)) {
        continue;
      }

      params.visited.add(orgUnit.id);
      const childCount = childrenByParent.get(orgUnit.id)?.length ?? 0;
      params.target.push({
        orgUnit,
        depth: params.depth,
        childCount
      });

      if (!params.respectExpansion || input.expandedUnitIds.has(orgUnit.id)) {
        visit({
          parentId: orgUnit.id,
          depth: params.depth + 1,
          target: params.target,
          visited: params.visited,
          respectExpansion: params.respectExpansion
        });
      }
    }
  };

  visit({
    parentId: ROOT_PARENT_ID,
    depth: 0,
    target: allRows,
    visited: allVisited,
    respectExpansion: false
  });

  for (const id of allVisited) {
    rootReachableUnitIds.add(id);
  }

  visit({
    parentId: ROOT_PARENT_ID,
    depth: 0,
    target: visibleRows,
    visited: visibleVisited,
    respectExpansion: true
  });

  for (const orgUnit of sortOrgUnits(input.orgUnits, input.locale)) {
    if (!allVisited.has(orgUnit.id)) {
      const childCount = childrenByParent.get(orgUnit.id)?.length ?? 0;
      allRows.push({
        orgUnit,
        depth: 0,
        childCount
      });
      allVisited.add(orgUnit.id);
      visit({
        parentId: orgUnit.id,
        depth: 1,
        target: allRows,
        visited: allVisited,
        respectExpansion: false
      });
    }

    if (
      !visibleVisited.has(orgUnit.id) &&
      !rootReachableUnitIds.has(orgUnit.id)
    ) {
      const childCount = childrenByParent.get(orgUnit.id)?.length ?? 0;
      visibleRows.push({
        orgUnit,
        depth: 0,
        childCount
      });
      visibleVisited.add(orgUnit.id);

      if (input.expandedUnitIds.has(orgUnit.id)) {
        visit({
          parentId: orgUnit.id,
          depth: 1,
          target: visibleRows,
          visited: visibleVisited,
          respectExpansion: true
        });
      }
    }
  }

  return {
    allRows,
    visibleRows,
    childrenByParent,
    descendantsByUnit,
    unitsById
  };
}

export function expandableOrgUnitIds(
  orgUnits: readonly OrgUnitRecord[]
): ReadonlySet<string> {
  const parentIds = new Set<string>();
  const unitIds = new Set(orgUnits.map((orgUnit) => orgUnit.id));

  for (const orgUnit of orgUnits) {
    if (
      orgUnit.parentOrgUnitId !== null &&
      unitIds.has(orgUnit.parentOrgUnitId)
    ) {
      parentIds.add(orgUnit.parentOrgUnitId);
    }
  }

  return parentIds;
}

export function canMoveOrgUnit(input: {
  readonly descendantsByUnit: ReadonlyMap<string, ReadonlySet<string>>;
  readonly draggedId: string | null;
  readonly targetParentId: string | null;
  readonly unitsById: ReadonlyMap<string, OrgUnitRecord>;
}): boolean {
  if (input.draggedId === null) {
    return false;
  }

  const draggedUnit = input.unitsById.get(input.draggedId);

  if (draggedUnit === undefined) {
    return false;
  }

  if (input.targetParentId === input.draggedId) {
    return false;
  }

  if ((draggedUnit.parentOrgUnitId ?? null) === input.targetParentId) {
    return false;
  }

  if (
    input.targetParentId !== null &&
    input.descendantsByUnit.get(input.draggedId)?.has(input.targetParentId)
  ) {
    return false;
  }

  return true;
}

function buildDescendantsByUnit(
  orgUnits: readonly OrgUnitRecord[]
): ReadonlyMap<string, ReadonlySet<string>> {
  const childrenByParent = new Map<string, OrgUnitRecord[]>();

  for (const orgUnit of orgUnits) {
    if (orgUnit.parentOrgUnitId === null) {
      continue;
    }

    childrenByParent.set(orgUnit.parentOrgUnitId, [
      ...(childrenByParent.get(orgUnit.parentOrgUnitId) ?? []),
      orgUnit
    ]);
  }

  const descendantsByUnit = new Map<string, Set<string>>();
  const collect = (orgUnitId: string): Set<string> => {
    const cached = descendantsByUnit.get(orgUnitId);

    if (cached !== undefined) {
      return cached;
    }

    const descendantIds = new Set<string>();
    descendantsByUnit.set(orgUnitId, descendantIds);

    for (const child of childrenByParent.get(orgUnitId) ?? []) {
      descendantIds.add(child.id);

      for (const nestedId of collect(child.id)) {
        descendantIds.add(nestedId);
      }
    }

    return descendantIds;
  };

  for (const orgUnit of orgUnits) {
    collect(orgUnit.id);
  }

  return descendantsByUnit;
}

function sortOrgUnits(
  orgUnits: readonly OrgUnitRecord[],
  locale: string
): OrgUnitRecord[] {
  return [...orgUnits].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "active" ? -1 : 1;
    }

    const nameComparison = left.name.localeCompare(right.name, locale);

    return nameComparison === 0
      ? left.id.localeCompare(right.id)
      : nameComparison;
  });
}
