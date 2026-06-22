import type { TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";

export type TenantScopedRow = {
  tenantId: TenantId | string;
};

export function collectTenantBoundaryViolations(
  expectedTenantId: TenantId,
  rows: readonly TenantScopedRow[]
): TenantScopedRow[] {
  return rows.filter((row) => row.tenantId !== expectedTenantId);
}

export function assertTenantScopedRows(
  expectedTenantId: TenantId,
  rows: readonly TenantScopedRow[]
): void {
  const violations = collectTenantBoundaryViolations(expectedTenantId, rows);

  if (violations.length > 0) {
    throw new CoreError("tenant.boundary_violation");
  }
}
