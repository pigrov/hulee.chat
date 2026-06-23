import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import { mapSqlTimestamp, type SqlTimestamp } from "./sql-timestamp";

export type AuthRateLimitBucketInput = {
  key: string;
  windowMs: number;
  maxAttempts: number;
  now: Date;
};

export type DeleteExpiredAuthRateLimitBucketsInput = {
  now: Date;
  batchSize: number;
};

export type DeleteExpiredAuthRateLimitBucketsResult = {
  deletedCount: number;
};

export type AuthRateLimitBucketDecision =
  | {
      allowed: true;
      count: number;
      resetAt: Date;
    }
  | {
      allowed: false;
      count: number;
      resetAt: Date;
      retryAfterMs: number;
    };

export type AuthRateLimitRepository = {
  consumeBucket(
    input: AuthRateLimitBucketInput
  ): Promise<AuthRateLimitBucketDecision>;
  deleteExpiredBuckets(
    input: DeleteExpiredAuthRateLimitBucketsInput
  ): Promise<DeleteExpiredAuthRateLimitBucketsResult>;
};

type AuthRateLimitBucketRow = {
  count: number;
  reset_at: SqlTimestamp;
};

type DeletedAuthRateLimitBucketCountRow = {
  deleted_count: number | string;
};

export function createSqlAuthRateLimitRepository(
  executor: RawSqlExecutor | HuleeDatabase
): AuthRateLimitRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async consumeBucket(input): Promise<AuthRateLimitBucketDecision> {
      const result = await rawExecutor.execute<AuthRateLimitBucketRow>(
        buildConsumeAuthRateLimitBucketSql(input)
      );
      const row = result.rows[0];

      if (row === undefined) {
        return {
          allowed: true,
          count: 0,
          resetAt: new Date(input.now.getTime() + input.windowMs)
        };
      }

      return mapAuthRateLimitBucketDecision(input, row);
    },

    async deleteExpiredBuckets(
      input
    ): Promise<DeleteExpiredAuthRateLimitBucketsResult> {
      const result =
        await rawExecutor.execute<DeletedAuthRateLimitBucketCountRow>(
          buildDeleteExpiredAuthRateLimitBucketsSql(input)
        );
      const deletedCount = result.rows[0]?.deleted_count ?? 0;

      return {
        deletedCount: Number(deletedCount)
      };
    }
  };
}

export function buildConsumeAuthRateLimitBucketSql(
  input: AuthRateLimitBucketInput
): SQL {
  const resetAt = new Date(input.now.getTime() + input.windowMs);

  return sql`
    insert into auth_rate_limit_buckets (
      key,
      count,
      reset_at,
      updated_at
    )
    values (
      ${input.key},
      1,
      ${resetAt},
      ${input.now}
    )
    on conflict (key) do update
    set count = case
          when auth_rate_limit_buckets.reset_at <= ${input.now} then 1
          else auth_rate_limit_buckets.count + 1
        end,
        reset_at = case
          when auth_rate_limit_buckets.reset_at <= ${input.now} then ${resetAt}
          else auth_rate_limit_buckets.reset_at
        end,
        updated_at = ${input.now}
    returning count,
              reset_at
  `;
}

export function buildDeleteExpiredAuthRateLimitBucketsSql(
  input: DeleteExpiredAuthRateLimitBucketsInput
): SQL {
  return sql`
    with expired as (
      select key
      from auth_rate_limit_buckets
      where reset_at <= ${input.now}
      order by reset_at asc
      limit ${input.batchSize}
    ),
    deleted as (
      delete from auth_rate_limit_buckets
      where key in (select key from expired)
      returning key
    )
    select count(*)::int as deleted_count
    from deleted
  `;
}

function mapAuthRateLimitBucketDecision(
  input: AuthRateLimitBucketInput,
  row: AuthRateLimitBucketRow
): AuthRateLimitBucketDecision {
  const resetAt = new Date(mapSqlTimestamp(row.reset_at));

  if (row.count <= input.maxAttempts) {
    return {
      allowed: true,
      count: row.count,
      resetAt
    };
  }

  return {
    allowed: false,
    count: row.count,
    resetAt,
    retryAfterMs: Math.max(0, resetAt.getTime() - input.now.getTime())
  };
}
