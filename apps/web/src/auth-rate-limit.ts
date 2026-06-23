import { CoreError } from "@hulee/core";
import {
  createSqlAuthRateLimitRepository,
  type AuthRateLimitRepository
} from "@hulee/db";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { getWebDatabase } from "./web-database";
import { resolveWebConfig } from "./web-config";

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

export type ConsumePersistentAuthRateLimitInput = Omit<
  ConsumeAuthRateLimitInput,
  "store"
> & {
  repository: AuthRateLimitRepository;
};

type AuthRateLimitBucket = {
  key: string;
  maxAttempts: number;
};

type HeaderReader = {
  get(name: string): string | null;
};

const minuteMs = 60_000;
const maxStoreEntries = 5_000;
const persistentCleanupBatchSize = 100;

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
  const buckets = buildAuthRateLimitBuckets(input, policy);
  const decisions = buckets.map((bucket) => {
    return inspectAuthRateLimitBucket({
      store,
      bucket,
      now
    });
  });
  const blocked = decisions.find((decision) => !decision.allowed);

  if (blocked !== undefined) {
    return blocked;
  }

  for (const bucket of buckets) {
    incrementAuthRateLimitBucket({
      store,
      bucket,
      policy,
      now
    });
  }
  cleanupAuthRateLimitStore(store, now);

  return {
    allowed: true
  };
}

export async function consumePersistentAuthRateLimit(
  input: ConsumePersistentAuthRateLimitInput
): Promise<AuthRateLimitDecision> {
  const nowMs = input.now ?? Date.now();
  const now = new Date(nowMs);
  const policy =
    input.policies?.[input.action] ?? defaultPolicies[input.action];
  const buckets = buildAuthRateLimitBuckets(input, policy);
  let result: AuthRateLimitDecision = {
    allowed: true
  };

  for (const bucket of buckets) {
    const decision = await input.repository.consumeBucket({
      key: bucket.key,
      windowMs: policy.windowMs,
      maxAttempts: bucket.maxAttempts,
      now
    });

    if (!decision.allowed) {
      result = {
        allowed: false,
        retryAfterMs: decision.retryAfterMs
      };
      break;
    }
  }

  await cleanupPersistentAuthRateLimit(input.repository, now);

  return result;
}

export async function assertWebAuthRateLimit(
  action: AuthRateLimitAction,
  subject?: string
): Promise<void> {
  const input = {
    action,
    subject,
    requester: resolveRequester(await headers())
  };
  const decision =
    resolveWebConfig().nodeEnv === "production"
      ? await consumePersistentAuthRateLimit({
          ...input,
          repository: createSqlAuthRateLimitRepository(getWebDatabase())
        })
      : consumeAuthRateLimit(input);

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

function buildAuthRateLimitBuckets(
  input: Pick<ConsumeAuthRateLimitInput, "action" | "requester" | "subject">,
  policy: AuthRateLimitPolicy
): readonly AuthRateLimitBucket[] {
  const requester = normalizeScopeValue(input.requester);
  const subject = normalizeScopeValue(input.subject ?? "none");

  return [
    {
      key: `auth:${input.action}:requester:${hashScopeValue(requester)}`,
      maxAttempts: policy.requesterMaxAttempts
    },
    {
      key: `auth:${input.action}:subject:${hashScopeValue(`${requester}\0${subject}`)}`,
      maxAttempts: policy.subjectMaxAttempts
    }
  ];
}

function inspectAuthRateLimitBucket(input: {
  store: AuthRateLimitStore;
  bucket: AuthRateLimitBucket;
  now: number;
}): AuthRateLimitDecision {
  const entry = input.store.get(input.bucket.key);

  if (entry === undefined || entry.resetAt <= input.now) {
    return {
      allowed: true
    };
  }

  if (entry.count >= input.bucket.maxAttempts) {
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
  bucket: AuthRateLimitBucket;
  policy: AuthRateLimitPolicy;
  now: number;
}): void {
  const existing = input.store.get(input.bucket.key);

  if (existing === undefined || existing.resetAt <= input.now) {
    input.store.set(input.bucket.key, {
      count: 1,
      resetAt: input.now + input.policy.windowMs
    });
    return;
  }

  input.store.set(input.bucket.key, {
    count: existing.count + 1,
    resetAt: existing.resetAt
  });
}

async function cleanupPersistentAuthRateLimit(
  repository: AuthRateLimitRepository,
  now: Date
): Promise<void> {
  try {
    await repository.deleteExpiredBuckets({
      now,
      batchSize: persistentCleanupBatchSize
    });
  } catch {
    // Cleanup must not bypass a completed rate-limit decision.
  }
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
