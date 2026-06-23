import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createSqlAuthRateLimitRepository } from "./sql-auth-rate-limit-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("SQL auth rate limit repository", () => {
  it("allows buckets at the configured attempt limit", async () => {
    const executor = new RecordingSqlExecutor([
      {
        count: 2,
        reset_at: new Date("2026-06-23T12:05:00.000Z")
      }
    ]);
    const repository = createSqlAuthRateLimitRepository(executor);

    await expect(
      repository.consumeBucket({
        key: "auth:login:requester:hash",
        windowMs: 300_000,
        maxAttempts: 2,
        now: new Date("2026-06-23T12:00:00.000Z")
      })
    ).resolves.toMatchObject({
      allowed: true,
      count: 2
    });
    expect(executor.queries).toHaveLength(1);
  });

  it("blocks buckets above the configured attempt limit", async () => {
    const repository = createSqlAuthRateLimitRepository(
      new RecordingSqlExecutor([
        {
          count: 3,
          reset_at: new Date("2026-06-23T12:05:00.000Z")
        }
      ])
    );

    await expect(
      repository.consumeBucket({
        key: "auth:login:subject:hash",
        windowMs: 300_000,
        maxAttempts: 2,
        now: new Date("2026-06-23T12:00:00.000Z")
      })
    ).resolves.toMatchObject({
      allowed: false,
      retryAfterMs: 300_000
    });
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);

    return {
      rows: this.rows as readonly Row[]
    };
  }
}
