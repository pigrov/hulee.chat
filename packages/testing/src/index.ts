import type { TenantId } from "@hulee/contracts";

export * from "./inbox-v2/scenario-fixtures";
export * from "./inbox-v2/scenario-world";

export function makeTenantId(value = "tenant_test"): TenantId {
  return value as TenantId;
}
