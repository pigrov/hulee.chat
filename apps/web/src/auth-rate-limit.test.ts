import { describe, expect, it } from "vitest";

import {
  consumeAuthRateLimit,
  consumePersistentAuthRateLimit,
  resolveRequester,
  type AuthRateLimitPolicy,
  type AuthRateLimitStore
} from "./auth-rate-limit";
import type {
  AuthRateLimitBucketInput,
  AuthRateLimitRepository
} from "@hulee/db";

const policy: AuthRateLimitPolicy = {
  windowMs: 1_000,
  requesterMaxAttempts: 3,
  subjectMaxAttempts: 2
};

describe("auth rate limit", () => {
  it("limits repeated attempts for the same requester and subject", () => {
    const store: AuthRateLimitStore = new Map();
    const input = {
      action: "login" as const,
      requester: "203.0.113.10",
      subject: "Admin@Example.Test",
      policies: {
        login: policy
      },
      store
    };

    expect(consumeAuthRateLimit({ ...input, now: 1 }).allowed).toBe(true);
    expect(consumeAuthRateLimit({ ...input, now: 2 }).allowed).toBe(true);
    expect(consumeAuthRateLimit({ ...input, now: 3 })).toMatchObject({
      allowed: false,
      retryAfterMs: 998
    });
    expect(consumeAuthRateLimit({ ...input, now: 1_002 }).allowed).toBe(true);
  });

  it("keeps subject values hashed inside the in-memory store", () => {
    const store: AuthRateLimitStore = new Map();

    consumeAuthRateLimit({
      action: "forgot_password",
      requester: "203.0.113.20",
      subject: "person@example.test",
      policies: {
        forgot_password: policy
      },
      store,
      now: 1
    });

    expect([...store.keys()].join(" ")).not.toContain("person@example.test");
  });

  it("limits requesters even when subjects vary", () => {
    const store: AuthRateLimitStore = new Map();
    const base = {
      action: "register" as const,
      requester: "203.0.113.30",
      policies: {
        register: policy
      },
      store
    };

    expect(
      consumeAuthRateLimit({ ...base, subject: "a@example.test", now: 1 })
        .allowed
    ).toBe(true);
    expect(
      consumeAuthRateLimit({ ...base, subject: "b@example.test", now: 2 })
        .allowed
    ).toBe(true);
    expect(
      consumeAuthRateLimit({ ...base, subject: "c@example.test", now: 3 })
        .allowed
    ).toBe(true);
    expect(
      consumeAuthRateLimit({ ...base, subject: "d@example.test", now: 4 })
        .allowed
    ).toBe(false);
  });

  it("resolves requester identity from proxy headers", () => {
    expect(
      resolveRequester({
        get(name) {
          return name === "x-forwarded-for" ? "203.0.113.40, 10.0.0.1" : null;
        }
      })
    ).toBe("203.0.113.40");

    expect(
      resolveRequester({
        get(name) {
          return name === "forwarded"
            ? 'proto=https;for="203.0.113.41";host=example.test'
            : null;
        }
      })
    ).toBe("203.0.113.41");
  });

  it("can consume a persistent repository for production-compatible limits", async () => {
    const repository = new InMemoryAuthRateLimitRepository();
    const input = {
      action: "login" as const,
      requester: "203.0.113.50",
      subject: "person@example.test",
      policies: {
        login: policy
      },
      repository
    };

    await expect(
      consumePersistentAuthRateLimit({ ...input, now: 1 })
    ).resolves.toEqual({ allowed: true });
    await expect(
      consumePersistentAuthRateLimit({ ...input, now: 2 })
    ).resolves.toEqual({ allowed: true });
    await expect(
      consumePersistentAuthRateLimit({ ...input, now: 3 })
    ).resolves.toMatchObject({
      allowed: false,
      retryAfterMs: 998
    });
    expect(repository.cleanupCalls).toBe(3);
  });
});

class InMemoryAuthRateLimitRepository implements AuthRateLimitRepository {
  cleanupCalls = 0;

  private readonly store = new Map<
    string,
    { count: number; resetAt: number }
  >();

  async consumeBucket(input: AuthRateLimitBucketInput) {
    const now = input.now.getTime();
    const resetAt = now + input.windowMs;
    const existing = this.store.get(input.key);
    const next =
      existing === undefined || existing.resetAt <= now
        ? {
            count: 1,
            resetAt
          }
        : {
            count: existing.count + 1,
            resetAt: existing.resetAt
          };

    this.store.set(input.key, next);

    return next.count <= input.maxAttempts
      ? {
          allowed: true as const,
          count: next.count,
          resetAt: new Date(next.resetAt)
        }
      : {
          allowed: false as const,
          count: next.count,
          resetAt: new Date(next.resetAt),
          retryAfterMs: next.resetAt - now
        };
  }

  async deleteExpiredBuckets(input: { now: Date; batchSize: number }) {
    this.cleanupCalls += 1;
    let deletedCount = 0;
    const now = input.now.getTime();

    for (const [key, entry] of this.store) {
      if (deletedCount >= input.batchSize) {
        break;
      }

      if (entry.resetAt <= now) {
        this.store.delete(key);
        deletedCount += 1;
      }
    }

    return {
      deletedCount
    };
  }
}
