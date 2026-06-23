import { CoreError } from "@hulee/core";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

export type AuthRateLimitAction =
  | "login"
  | "select_company"
  | "register"
  | "forgot_password"
  | "reset_password"
  | "resend_email_verification"
  | "accept_employee_invite";

export type AuthRateLimitPolicy = {
  windowMs: number;
  requesterMaxAttempts: number;
  subjectMaxAttempts: number;
};

export type AuthRateLimitEntry = {
  count: number;
  resetAt: number;
};

export type AuthRateLimitStore = Map<string, AuthRateLimitEntry>;

export type AuthRateLimitDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      retryAfterMs: number;
    };

export type ConsumeAuthRateLimitInput = {
  action: AuthRateLimitAction;
  requester: string;
  subject?: string;
  now?: number;
  policies?: Partial<Record<AuthRateLimitAction, AuthRateLimitPolicy>>;
  store?: AuthRateLimitStore;
};

type HeaderReader = {
  get(name: string): string | null;
};

const minuteMs = 60_000;
const maxStoreEntries = 5_000;

const defaultPolicies: Record<AuthRateLimitAction, AuthRateLimitPolicy> = {
  login: {
    windowMs: 5 * minuteMs,
    requesterMaxAttempts: 30,
    subjectMaxAttempts: 8
  },
  select_company: {
    windowMs: 5 * minuteMs,
    requesterMaxAttempts: 30,
    subjectMaxAttempts: 10
  },
  register: {
    windowMs: 10 * minuteMs,
    requesterMaxAttempts: 10,
    subjectMaxAttempts: 3
  },
  forgot_password: {
    windowMs: 10 * minuteMs,
    requesterMaxAttempts: 10,
    subjectMaxAttempts: 3
  },
  reset_password: {
    windowMs: 10 * minuteMs,
    requesterMaxAttempts: 20,
    subjectMaxAttempts: 8
  },
  resend_email_verification: {
    windowMs: 10 * minuteMs,
    requesterMaxAttempts: 10,
    subjectMaxAttempts: 3
  },
  accept_employee_invite: {
    windowMs: 10 * minuteMs,
    requesterMaxAttempts: 20,
    subjectMaxAttempts: 8
  }
};

const defaultStore: AuthRateLimitStore = new Map();

export function consumeAuthRateLimit(
  input: ConsumeAuthRateLimitInput
): AuthRateLimitDecision {
  const now = input.now ?? Date.now();
  const store = input.store ?? defaultStore;
  const policy =
    input.policies?.[input.action] ?? defaultPolicies[input.action];
  const keys = buildAuthRateLimitKeys(input);
  const decisions = keys.map((key) => {
    return inspectAuthRateLimitBucket({
      store,
      key,
      policy,
      now
    });
  });
  const blocked = decisions.find((decision) => !decision.allowed);

  if (blocked !== undefined) {
    return blocked;
  }

  for (const key of keys) {
    incrementAuthRateLimitBucket({
      store,
      key,
      policy,
      now
    });
  }
  cleanupAuthRateLimitStore(store, now);

  return {
    allowed: true
  };
}

export async function assertWebAuthRateLimit(
  action: AuthRateLimitAction,
  subject?: string
): Promise<void> {
  const decision = consumeAuthRateLimit({
    action,
    subject,
    requester: resolveRequester(await headers())
  });

  if (!decision.allowed) {
    throw new CoreError("auth.rate_limited");
  }
}

export function resolveRequester(headers: HeaderReader): string {
  return (
    firstHeaderValue(headers.get("cf-connecting-ip")) ??
    firstHeaderValue(headers.get("x-real-ip")) ??
    firstHeaderValue(headers.get("x-forwarded-for")) ??
    forwardedForValue(headers.get("forwarded")) ??
    "local"
  );
}

export function clearAuthRateLimitStoreForTests(): void {
  defaultStore.clear();
}

function buildAuthRateLimitKeys(
  input: Pick<ConsumeAuthRateLimitInput, "action" | "requester" | "subject">
): readonly string[] {
  const requester = normalizeScopeValue(input.requester);
  const subject = normalizeScopeValue(input.subject ?? "none");

  return [
    `auth:${input.action}:requester:${hashScopeValue(requester)}`,
    `auth:${input.action}:subject:${hashScopeValue(`${requester}\0${subject}`)}`
  ];
}

function inspectAuthRateLimitBucket(input: {
  store: AuthRateLimitStore;
  key: string;
  policy: AuthRateLimitPolicy;
  now: number;
}): AuthRateLimitDecision {
  const entry = input.store.get(input.key);

  if (entry === undefined || entry.resetAt <= input.now) {
    return {
      allowed: true
    };
  }

  const maxAttempts = input.key.includes(":requester:")
    ? input.policy.requesterMaxAttempts
    : input.policy.subjectMaxAttempts;

  if (entry.count >= maxAttempts) {
    return {
      allowed: false,
      retryAfterMs: entry.resetAt - input.now
    };
  }

  return {
    allowed: true
  };
}

function incrementAuthRateLimitBucket(input: {
  store: AuthRateLimitStore;
  key: string;
  policy: AuthRateLimitPolicy;
  now: number;
}): void {
  const existing = input.store.get(input.key);

  if (existing === undefined || existing.resetAt <= input.now) {
    input.store.set(input.key, {
      count: 1,
      resetAt: input.now + input.policy.windowMs
    });
    return;
  }

  input.store.set(input.key, {
    count: existing.count + 1,
    resetAt: existing.resetAt
  });
}

function cleanupAuthRateLimitStore(
  store: AuthRateLimitStore,
  now: number
): void {
  if (store.size <= maxStoreEntries) {
    return;
  }

  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }

  while (store.size > maxStoreEntries) {
    const firstKey = store.keys().next().value as string | undefined;

    if (firstKey === undefined) {
      return;
    }

    store.delete(firstKey);
  }
}

function firstHeaderValue(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();

  return first && first.length > 0 ? first : undefined;
}

function forwardedForValue(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const match = /(?:^|;)\s*for="?([^";,]+)"?/i.exec(value);
  const forwardedFor = match?.[1]?.trim();

  return forwardedFor && forwardedFor.length > 0 ? forwardedFor : undefined;
}

function normalizeScopeValue(value: string): string {
  return value.trim().toLowerCase().slice(0, 256);
}

function hashScopeValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
