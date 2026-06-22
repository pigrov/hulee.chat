export type { Entitlement, EntitlementKey } from "./entitlement";
export type { LicenseSnapshot } from "./license";
export { isLicenseActive } from "./license";
export {
  evaluateEntitlement,
  evaluatePolicyUsage,
  hasEntitlement
} from "./entitlement-evaluator";
export type {
  EntitlementDecision,
  EntitlementEvaluatorInput
} from "./entitlement-evaluator";
export type { UsagePolicy, UsageState } from "./usage-policy";
export { evaluateUsageLimit } from "./usage-limits";
export type { UsageLimitDecision } from "./usage-limits";
