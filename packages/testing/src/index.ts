import type { TenantId } from "@hulee/contracts";

export function makeTenantId(value = "tenant_test"): TenantId {
  return value as TenantId;
}
