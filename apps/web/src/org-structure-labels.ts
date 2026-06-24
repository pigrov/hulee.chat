import type { OrgStructureStatus, OrgUnitKind, WorkQueueKind } from "@hulee/db";
import type { I18nMessageKey } from "@hulee/i18n";

export function orgUnitKindKey(kind: OrgUnitKind): I18nMessageKey {
  switch (kind) {
    case "department":
      return "admin.orgStructure.orgUnit.kind.department";
    case "branch":
      return "admin.orgStructure.orgUnit.kind.branch";
    case "function":
      return "admin.orgStructure.orgUnit.kind.function";
    case "custom":
      return "admin.orgStructure.kind.custom";
  }
}

export function workQueueKindKey(kind: WorkQueueKind): I18nMessageKey {
  switch (kind) {
    case "lead_intake":
      return "admin.orgStructure.workQueue.kind.leadIntake";
    case "sales":
      return "admin.orgStructure.workQueue.kind.sales";
    case "claims":
      return "admin.orgStructure.workQueue.kind.claims";
    case "measurements":
      return "admin.orgStructure.workQueue.kind.measurements";
    case "support":
      return "admin.orgStructure.workQueue.kind.support";
    case "custom":
      return "admin.orgStructure.kind.custom";
  }
}

export function orgStructureStatusKey(
  status: OrgStructureStatus
): I18nMessageKey {
  switch (status) {
    case "active":
      return "admin.orgStructure.status.active";
    case "archived":
      return "admin.orgStructure.status.archived";
  }
}
