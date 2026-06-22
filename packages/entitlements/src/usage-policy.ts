import type { EntitlementKey } from "./entitlement";

export type UsagePolicy = {
  entitlement: EntitlementKey;
  included: number;
  softLimit?: number;
  hardLimit?: number;
  resetPeriod?: "monthly" | "daily" | "none";
};

export type UsageState = {
  entitlement: EntitlementKey;
  used: number;
};
