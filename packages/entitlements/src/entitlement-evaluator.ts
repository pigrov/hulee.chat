import type { Entitlement, EntitlementKey } from "./entitlement";
import { isLicenseActive, type LicenseSnapshot } from "./license";
import { evaluateUsageLimit, type UsageLimitDecision } from "./usage-limits";
import type { UsagePolicy, UsageState } from "./usage-policy";

export type EntitlementDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      code: "entitlement.missing" | "license.inactive";
      key?: EntitlementKey;
    };

export type EntitlementEvaluatorInput = {
  license: LicenseSnapshot;
  now: Date;
};

export function hasEntitlement(
  entitlements: Entitlement[],
  key: EntitlementKey,
  value: string
): boolean {
  return entitlements.some((entitlement) => {
    return (
      entitlement.key === key &&
      entitlement.value === value &&
      entitlement.enabled
    );
  });
}

export function evaluateEntitlement(
  input: EntitlementEvaluatorInput,
  key: EntitlementKey,
  value: string
): EntitlementDecision {
  if (!isLicenseActive(input.license, input.now)) {
    return {
      allowed: false,
      code: "license.inactive",
      key
    };
  }

  if (!hasEntitlement(input.license.entitlements, key, value)) {
    return {
      allowed: false,
      code: "entitlement.missing",
      key
    };
  }

  return {
    allowed: true
  };
}

export function evaluatePolicyUsage(
  policy: UsagePolicy,
  state: UsageState
): UsageLimitDecision {
  return evaluateUsageLimit(policy, state);
}
