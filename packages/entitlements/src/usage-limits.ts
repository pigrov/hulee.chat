import type { UsagePolicy, UsageState } from "./usage-policy";

export type UsageLimitDecision =
  | {
      allowed: true;
      remaining?: number;
      warning: boolean;
    }
  | {
      allowed: false;
      code: "usage.limit_exceeded";
      limit: number;
      used: number;
    };

export function evaluateUsageLimit(
  policy: UsagePolicy,
  state: UsageState
): UsageLimitDecision {
  const hardLimit = policy.hardLimit ?? policy.included;
  const softLimit = policy.softLimit ?? Math.floor(hardLimit * 0.8);

  if (state.used >= hardLimit) {
    return {
      allowed: false,
      code: "usage.limit_exceeded",
      limit: hardLimit,
      used: state.used
    };
  }

  return {
    allowed: true,
    remaining: hardLimit - state.used,
    warning: state.used >= softLimit
  };
}
