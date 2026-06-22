import type {
  PlatformErrorCode,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";

export type OutboxRecord = {
  id: string;
  tenantId: TenantId;
  eventId: string;
  payload: PlatformEvent;
  attempts: number;
  status: "processing";
};

export type ClaimPendingOutboxInput = {
  batchSize: number;
  now: Date;
};

export type MarkOutboxProcessedInput = {
  id: string;
  tenantId: TenantId;
  processedAt: Date;
};

export type MarkOutboxFailedInput = {
  id: string;
  tenantId: TenantId;
  failedAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  errorCode: PlatformErrorCode;
};

export type OutboxRepository = {
  claimPending(
    input: ClaimPendingOutboxInput
  ): Promise<readonly OutboxRecord[]>;
  markProcessed(input: MarkOutboxProcessedInput): Promise<void>;
  markFailed(input: MarkOutboxFailedInput): Promise<void>;
};

export type RawSqlQueryResult<Row> = {
  rows: readonly Row[];
};

export type RawSqlExecutor = {
  execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>>;
};

type ClaimedOutboxRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  payload: unknown;
  attempts: number;
};

export function createSqlOutboxRepository(
  executor: RawSqlExecutor | HuleeDatabase
): OutboxRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async claimPending(
      input: ClaimPendingOutboxInput
    ): Promise<readonly OutboxRecord[]> {
      const result = await rawExecutor.execute<ClaimedOutboxRow>(
        buildClaimPendingOutboxSql(input)
      );

      return result.rows.map(mapClaimedOutboxRow);
    },

    async markProcessed(input: MarkOutboxProcessedInput): Promise<void> {
      await rawExecutor.execute(buildMarkOutboxProcessedSql(input));
    },

    async markFailed(input: MarkOutboxFailedInput): Promise<void> {
      await rawExecutor.execute(buildMarkOutboxFailedSql(input));
    }
  };
}

export function buildClaimPendingOutboxSql(
  input: ClaimPendingOutboxInput
): SQL {
  return sql`
    with claimed as (
      select id
      from outbox
      where status = 'pending'
        and (next_attempt_at is null or next_attempt_at <= ${input.now})
      order by created_at asc
      limit ${input.batchSize}
      for update skip locked
    )
    update outbox
    set status = 'processing',
        updated_at = ${input.now}
    from claimed
    where outbox.id = claimed.id
    returning outbox.id,
              outbox.tenant_id,
              outbox.event_id,
              outbox.payload,
              outbox.attempts
  `;
}

export function buildMarkOutboxProcessedSql(
  input: MarkOutboxProcessedInput
): SQL {
  return sql`
    update outbox
    set status = 'processed',
        next_attempt_at = null,
        last_error_code = null,
        updated_at = ${input.processedAt}
    where id = ${input.id}
      and tenant_id = ${input.tenantId}
      and status = 'processing'
  `;
}

export function buildMarkOutboxFailedSql(input: MarkOutboxFailedInput): SQL {
  return sql`
    update outbox
    set status = 'pending',
        attempts = ${input.attempts},
        next_attempt_at = ${input.nextAttemptAt},
        last_error_code = ${input.errorCode},
        updated_at = ${input.failedAt}
    where id = ${input.id}
      and tenant_id = ${input.tenantId}
      and status = 'processing'
  `;
}

function mapClaimedOutboxRow(row: ClaimedOutboxRow): OutboxRecord {
  const tenantId = row.tenant_id as TenantId;
  const payload = coercePlatformEvent(row.payload);

  if (payload.tenantId !== tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  return {
    id: row.id,
    tenantId,
    eventId: row.event_id,
    payload,
    attempts: row.attempts,
    status: "processing"
  };
}

function coercePlatformEvent(payload: unknown): PlatformEvent {
  if (!isRecord(payload) || typeof payload.tenantId !== "string") {
    throw new CoreError("validation.failed", "Invalid outbox event payload");
  }

  return payload as PlatformEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
