import {
  INBOX_V2_SECURITY_DENIAL_POLICY,
  inboxV2BigintCounterSchema,
  inboxV2SecurityDenialFingerprintSchema,
  inboxV2SecurityDenialAttemptSchema,
  inboxV2SecurityDenialResultSchema,
  inboxV2SecurityDenialReviewRecordSchema,
  inboxV2SecurityDenialReviewAggregationKindSchema,
  inboxV2SecurityDenialReviewStatusSchema,
  inboxV2SecurityDenialReviewTypeSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2BigintCounter,
  type InboxV2SecurityDenialAttempt,
  type InboxV2SecurityDenialResult,
  type InboxV2SecurityDenialReviewRecord,
  type InboxV2SecurityDenialReviewType,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const MAXIMUM_REVIEW_PAGE_SIZE = 100;

export type InboxV2SecurityDenialReviewStatus =
  | "open"
  | "acknowledged"
  | "closed";

export type ListInboxV2SecurityDenialReviewsInput = Readonly<{
  tenantId: InboxV2TenantId;
  limit: number;
  status?: InboxV2SecurityDenialReviewStatus;
  reviewType?: InboxV2SecurityDenialReviewType;
  cursor?: InboxV2SecurityDenialReviewCursor;
}>;

export type InboxV2SecurityDenialReviewCursor = Readonly<{
  cursorVersion: 1;
  tenantId: InboxV2TenantId;
  filterStatus: InboxV2SecurityDenialReviewStatus | null;
  filterReviewType: InboxV2SecurityDenialReviewType | null;
  snapshotHighWater: InboxV2BigintCounter;
  lastReviewSequence: InboxV2BigintCounter;
  lastWindowStartedAt: string;
  lastShardNo: number;
  lastReviewType: InboxV2SecurityDenialReviewType;
  lastAggregationKind: "candidate" | "overflow";
  lastAggregationKey: string;
}>;

export type InboxV2SecurityDenialReviewPage = Readonly<{
  items: readonly InboxV2SecurityDenialReviewRecord[];
  nextCursor: InboxV2SecurityDenialReviewCursor | null;
}>;

export type InboxV2SecurityDenialRecordOptions = Readonly<{
  signal: AbortSignal;
}>;

export type InboxV2SecurityDenialRepository = Readonly<{
  record(
    attempt: InboxV2SecurityDenialAttempt,
    options: InboxV2SecurityDenialRecordOptions
  ): Promise<InboxV2SecurityDenialResult>;
  listReviews(
    input: ListInboxV2SecurityDenialReviewsInput
  ): Promise<InboxV2SecurityDenialReviewPage>;
}>;

type SecurityDenialRecordRow = Record<string, unknown> & {
  observation_receipt: unknown;
  observed_at: unknown;
  disposition: unknown;
  shard_no: unknown;
  window_started_at: unknown;
  window_ended_at: unknown;
  expires_at: unknown;
  shard_attempt_count: unknown;
  detail_occurrence_count: unknown;
  admitted_detail_bucket_count: unknown;
  overflow_count: unknown;
  counter_saturated: unknown;
  review_types: unknown;
  review_dispositions: unknown;
};

type SecurityDenialReviewRow = Record<string, unknown> & {
  tenant_id: unknown;
  review_sequence: unknown;
  window_started_at: unknown;
  window_ended_at: unknown;
  shard_no: unknown;
  review_type: unknown;
  alert_type: unknown;
  aggregation_kind: unknown;
  aggregation_key: unknown;
  candidate_fingerprint: unknown;
  candidate_ref: unknown;
  risk: unknown;
  status: unknown;
  trigger_count: unknown;
  first_seen_at: unknown;
  last_seen_at: unknown;
  expires_at: unknown;
  snapshot_high_water: unknown;
};

export class InboxV2SecurityDenialPersistenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxV2SecurityDenialPersistenceInvariantError";
  }
}

/**
 * Separate best-effort persistence boundary for denied requests. It invokes
 * only the bounded security-denial routines and never enters the successful
 * authorization mutation, tenant-stream, event or provider-outbox paths.
 */
export function createSqlInboxV2SecurityDenialRepository(
  executor: RawSqlExecutor | HuleeDatabase
): InboxV2SecurityDenialRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return Object.freeze({
    async record(attemptInput, options) {
      options.signal.throwIfAborted();
      const attempt = inboxV2SecurityDenialAttemptSchema.parse(attemptInput);
      options.signal.throwIfAborted();
      const result = await rawExecutor.execute<SecurityDenialRecordRow>(
        buildRecordInboxV2SecurityDenialSql(attempt)
      );
      const row = exactlyOneRow(result.rows, "security-denial record");
      return mapSecurityDenialResult(attempt.tenantId, row);
    },

    async listReviews(input) {
      const normalized = normalizeListReviewsInput(input);
      const result = await rawExecutor.execute<SecurityDenialReviewRow>(
        buildListInboxV2SecurityDenialReviewsSql(normalized)
      );
      if (result.rows.length > normalized.limit + 1) {
        throw invariantError(
          "Security-denial review query exceeded its requested page bound."
        );
      }
      const pageRows = result.rows.slice(0, normalized.limit);
      const items = Object.freeze(
        pageRows.map((row) => mapSecurityDenialReview(normalized.tenantId, row))
      );
      const nextCursor =
        result.rows.length > normalized.limit
          ? mapSecurityDenialReviewCursor(normalized, pageRows.at(-1))
          : null;
      return Object.freeze({ items, nextCursor });
    }
  });
}

export function buildRecordInboxV2SecurityDenialSql(
  attemptInput: InboxV2SecurityDenialAttempt
): SQL {
  const attempt = inboxV2SecurityDenialAttemptSchema.parse(attemptInput);
  const review = attempt.reviewSignal;
  const policy = attempt.policy;

  return sql`
    select recorded.observation_receipt,
           recorded.observed_at,
           recorded.disposition::text as disposition,
           recorded.shard_no::integer as shard_no,
           recorded.window_started_at,
           recorded.window_ended_at,
           recorded.expires_at,
           recorded.shard_attempt_count::text as shard_attempt_count,
           recorded.detail_occurrence_count::text as detail_occurrence_count,
           recorded.admitted_detail_bucket_count::integer
             as admitted_detail_bucket_count,
           recorded.overflow_count::text as overflow_count,
           recorded.counter_saturated,
           recorded.review_types::text[] as review_types,
           recorded.review_dispositions::text[] as review_dispositions
      from public.inbox_v2_security_denial_record(
        ${attempt.tenantId},
        ${attempt.action}::public.inbox_v2_security_denial_action,
        ${attempt.principalClass}::public.inbox_v2_security_denial_principal_class,
        ${attempt.fingerprintKeyEpoch},
        ${attempt.actorFingerprint},
        ${attempt.dedupeFingerprint},
        ${attempt.observationReceipt},
        ${attempt.denialKind}::public.inbox_v2_security_denial_kind,
        ${attempt.publicErrorClass}::public.inbox_v2_security_denial_public_error_class,
        ${attempt.risk}::public.inbox_v2_security_denial_risk,
        ${review?.reviewType ?? null}::public.inbox_v2_security_denial_review_type,
        ${review?.alertType ?? null}::public.inbox_v2_security_denial_alert_type,
        ${review?.candidateRef ?? null},
        ${policy.policyId},
        ${policy.windowSeconds},
        ${policy.retentionSeconds},
        ${policy.shardCount},
        ${policy.detailBucketLimitPerShard},
        ${policy.reviewCandidateLimitPerShard},
        ${policy.attemptRateLimitPerShard},
        ${policy.lockTimeoutMilliseconds},
        ${policy.statementTimeoutMilliseconds}
      ) recorded
  `;
}

export function buildListInboxV2SecurityDenialReviewsSql(
  input: ListInboxV2SecurityDenialReviewsInput
): SQL {
  const normalized = normalizeListReviewsInput(input);
  const status = normalized.status ?? null;
  const reviewType = normalized.reviewType ?? null;
  const cursor = normalized.cursor ?? null;
  const cursorPredicate = buildReviewCursorPredicate(cursor);
  const statusPredicate =
    status === null
      ? sql`true`
      : sql`review.status = ${status}::public.inbox_v2_security_denial_review_status`;
  const reviewTypePredicate =
    reviewType === null
      ? sql`true`
      : sql`review.review_type = ${reviewType}::public.inbox_v2_security_denial_review_type`;

  return sql`
    with bounds as materialized (
      select coalesce(
        ${cursor?.snapshotHighWater ?? null}::bigint,
        (
          select coalesce(max(high_water.review_sequence), 0)::bigint
            from public.inbox_v2_security_denial_review_signals high_water
           where high_water.tenant_id = ${normalized.tenantId}
        )
      ) as snapshot_high_water
    )
    select review.tenant_id,
           review.review_sequence::text as review_sequence,
           review.window_started_at,
           review.window_ended_at,
           review.shard_no::integer as shard_no,
           review.review_type::text as review_type,
           review.alert_type::text as alert_type,
           review.aggregation_kind::text as aggregation_kind,
           review.aggregation_key,
           review.candidate_fingerprint,
           review.candidate_ref,
           review.risk::text as risk,
           review.status::text as status,
           review.trigger_count::text as trigger_count,
           review.first_seen_at,
           review.last_seen_at,
           review.expires_at,
           bounds.snapshot_high_water::text as snapshot_high_water
      from public.inbox_v2_security_denial_review_signals review
      cross join bounds
     where review.tenant_id = ${normalized.tenantId}
       and review.expires_at > clock_timestamp()
       and review.review_sequence <= bounds.snapshot_high_water
       and ${statusPredicate}
       and ${reviewTypePredicate}
       and ${cursorPredicate}
     order by review.review_sequence desc,
              review.window_started_at desc,
              review.shard_no asc,
              review.review_type asc,
              review.aggregation_kind asc,
              review.aggregation_key asc
     limit ${normalized.limit + 1}
  `;
}

function buildReviewCursorPredicate(
  cursor: InboxV2SecurityDenialReviewCursor | null
): SQL {
  if (cursor === null) return sql`true`;
  return sql`(
    review.review_sequence < ${cursor.lastReviewSequence}::bigint
    or (
      review.review_sequence = ${cursor.lastReviewSequence}::bigint
      and (
        review.window_started_at < ${cursor.lastWindowStartedAt}::timestamptz
        or (
          review.window_started_at = ${cursor.lastWindowStartedAt}::timestamptz
          and (
            review.shard_no > ${cursor.lastShardNo}
            or (
              review.shard_no = ${cursor.lastShardNo}
              and (
                review.review_type >
                  ${cursor.lastReviewType}::public.inbox_v2_security_denial_review_type
                or (
                  review.review_type =
                    ${cursor.lastReviewType}::public.inbox_v2_security_denial_review_type
                  and (
                    review.aggregation_kind >
                      ${cursor.lastAggregationKind}::public.inbox_v2_security_denial_review_aggregation_kind
                    or (
                      review.aggregation_kind =
                        ${cursor.lastAggregationKind}::public.inbox_v2_security_denial_review_aggregation_kind
                      and review.aggregation_key > ${cursor.lastAggregationKey}
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  )`;
}

function normalizeListReviewsInput(
  input: ListInboxV2SecurityDenialReviewsInput
): ListInboxV2SecurityDenialReviewsInput {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const limit = boundedInteger(
    input.limit,
    1,
    MAXIMUM_REVIEW_PAGE_SIZE,
    "security-denial review page size"
  );
  const status =
    input.status === undefined
      ? undefined
      : inboxV2SecurityDenialReviewStatusSchema.parse(input.status);
  const reviewType =
    input.reviewType === undefined
      ? undefined
      : inboxV2SecurityDenialReviewTypeSchema.parse(input.reviewType);
  const cursor =
    input.cursor === undefined
      ? undefined
      : normalizeReviewCursor(input.cursor, tenantId, status, reviewType);
  return Object.freeze({ tenantId, limit, status, reviewType, cursor });
}

const REVIEW_CURSOR_KEYS = Object.freeze([
  "cursorVersion",
  "tenantId",
  "filterStatus",
  "filterReviewType",
  "snapshotHighWater",
  "lastReviewSequence",
  "lastWindowStartedAt",
  "lastShardNo",
  "lastReviewType",
  "lastAggregationKind",
  "lastAggregationKey"
] as const);

function normalizeReviewCursor(
  cursorInput: InboxV2SecurityDenialReviewCursor,
  tenantId: InboxV2TenantId,
  status: InboxV2SecurityDenialReviewStatus | undefined,
  reviewType: InboxV2SecurityDenialReviewType | undefined
): InboxV2SecurityDenialReviewCursor {
  if (
    typeof cursorInput !== "object" ||
    cursorInput === null ||
    !hasExactKeys(cursorInput, REVIEW_CURSOR_KEYS)
  ) {
    throw new TypeError("Security-denial review cursor has an invalid shape.");
  }
  if (cursorInput.cursorVersion !== 1) {
    throw new TypeError(
      "Security-denial review cursor version is unsupported."
    );
  }
  const cursorTenantId = inboxV2TenantIdSchema.parse(cursorInput.tenantId);
  const filterStatus =
    cursorInput.filterStatus === null
      ? null
      : inboxV2SecurityDenialReviewStatusSchema.parse(cursorInput.filterStatus);
  const filterReviewType =
    cursorInput.filterReviewType === null
      ? null
      : inboxV2SecurityDenialReviewTypeSchema.parse(
          cursorInput.filterReviewType
        );
  if (
    cursorTenantId !== tenantId ||
    filterStatus !== (status ?? null) ||
    filterReviewType !== (reviewType ?? null)
  ) {
    throw new TypeError(
      "Security-denial review cursor is not bound to this tenant and filter."
    );
  }
  const snapshotHighWater = inboxV2BigintCounterSchema.parse(
    cursorInput.snapshotHighWater
  );
  const lastReviewSequence = inboxV2BigintCounterSchema.parse(
    cursorInput.lastReviewSequence
  );
  if (
    BigInt(lastReviewSequence) < 1n ||
    BigInt(snapshotHighWater) < BigInt(lastReviewSequence)
  ) {
    throw new TypeError(
      "Security-denial review cursor high-water is inconsistent."
    );
  }
  const lastWindowStartedAt = inboxV2TimestampSchema.parse(
    cursorInput.lastWindowStartedAt
  );
  const windowMilliseconds =
    INBOX_V2_SECURITY_DENIAL_POLICY.windowSeconds * 1_000;
  if (Date.parse(lastWindowStartedAt) % windowMilliseconds !== 0) {
    throw new TypeError(
      "Security-denial review cursor window is not canonical."
    );
  }
  const lastShardNo = boundedInteger(
    cursorInput.lastShardNo,
    0,
    INBOX_V2_SECURITY_DENIAL_POLICY.shardCount - 1,
    "security-denial review cursor shard"
  );
  const lastReviewType = inboxV2SecurityDenialReviewTypeSchema.parse(
    cursorInput.lastReviewType
  );
  const lastAggregationKind =
    inboxV2SecurityDenialReviewAggregationKindSchema.parse(
      cursorInput.lastAggregationKind
    );
  const lastAggregationKey =
    lastAggregationKind === "candidate"
      ? inboxV2SecurityDenialFingerprintSchema.parse(
          cursorInput.lastAggregationKey
        )
      : cursorInput.lastAggregationKey;
  if (lastAggregationKind === "overflow" && lastAggregationKey !== "overflow") {
    throw new TypeError(
      "Security-denial overflow cursor requires its canonical key."
    );
  }
  return Object.freeze({
    cursorVersion: 1,
    tenantId: cursorTenantId,
    filterStatus,
    filterReviewType,
    snapshotHighWater,
    lastReviewSequence,
    lastWindowStartedAt,
    lastShardNo,
    lastReviewType,
    lastAggregationKind,
    lastAggregationKey
  });
}

function mapSecurityDenialResult(
  tenantId: InboxV2TenantId,
  row: SecurityDenialRecordRow
): InboxV2SecurityDenialResult {
  const reviewTypes = textArray(row.review_types, "denial review types");
  const reviewDispositions = textArray(
    row.review_dispositions,
    "denial review dispositions"
  );
  if (reviewTypes.length !== reviewDispositions.length) {
    throw invariantError(
      "Security-denial result returned misaligned review arrays."
    );
  }

  return inboxV2SecurityDenialResultSchema.parse({
    tenantId,
    observationReceipt: textValue(
      row.observation_receipt,
      "denial observation receipt"
    ),
    observedAt: timestampValue(row.observed_at, "denial observation time"),
    disposition: textValue(row.disposition, "denial disposition"),
    shardNo: exactInteger(row.shard_no, "denial shard number"),
    windowStartedAt: timestampValue(
      row.window_started_at,
      "denial window start"
    ),
    windowEndedAt: timestampValue(row.window_ended_at, "denial window end"),
    expiresAt: timestampValue(row.expires_at, "denial expiry"),
    shardAttemptCount: exactBigintCounter(
      row.shard_attempt_count,
      "denial shard attempt count"
    ),
    detailOccurrenceCount:
      row.detail_occurrence_count === null
        ? null
        : exactBigintCounter(
            row.detail_occurrence_count,
            "denial detail occurrence count"
          ),
    admittedDetailBucketCount: exactInteger(
      row.admitted_detail_bucket_count,
      "admitted denial detail bucket count"
    ),
    overflowCount: exactBigintCounter(
      row.overflow_count,
      "denial overflow count"
    ),
    counterSaturated: booleanValue(
      row.counter_saturated,
      "denial counter saturation"
    ),
    reviewWrites: reviewTypes.map((reviewType, index) => ({
      reviewType,
      disposition: reviewDispositions[index]
    }))
  });
}

function mapSecurityDenialReview(
  expectedTenantId: InboxV2TenantId,
  row: SecurityDenialReviewRow
): InboxV2SecurityDenialReviewRecord {
  const tenantId = inboxV2TenantIdSchema.parse(
    textValue(row.tenant_id, "security-denial review tenant")
  );
  if (tenantId !== expectedTenantId) {
    throw invariantError(
      "Security-denial review query returned a cross-tenant row."
    );
  }

  return inboxV2SecurityDenialReviewRecordSchema.parse({
    tenantId,
    windowStartedAt: timestampValue(
      row.window_started_at,
      "review window start"
    ),
    windowEndedAt: timestampValue(row.window_ended_at, "review window end"),
    shardNo: exactInteger(row.shard_no, "review shard number"),
    reviewType: textValue(row.review_type, "review type"),
    alertType: textValue(row.alert_type, "review alert type"),
    aggregationKind: textValue(row.aggregation_kind, "review aggregation kind"),
    candidateFingerprint: optionalTextValue(
      row.candidate_fingerprint,
      "review candidate fingerprint"
    ),
    candidateRef: optionalTextValue(
      row.candidate_ref,
      "review candidate reference"
    ),
    risk: textValue(row.risk, "review risk"),
    status: textValue(row.status, "review status"),
    triggerCount: exactBigintCounter(row.trigger_count, "review trigger count"),
    firstSeenAt: timestampValue(row.first_seen_at, "review first-seen time"),
    lastSeenAt: timestampValue(row.last_seen_at, "review last-seen time"),
    expiresAt: timestampValue(row.expires_at, "review expiry")
  });
}

function mapSecurityDenialReviewCursor(
  input: ListInboxV2SecurityDenialReviewsInput,
  row: SecurityDenialReviewRow | undefined
): InboxV2SecurityDenialReviewCursor {
  if (row === undefined) {
    throw invariantError(
      "Security-denial review continuation requires one boundary row."
    );
  }
  const aggregationKind =
    inboxV2SecurityDenialReviewAggregationKindSchema.parse(
      textValue(row.aggregation_kind, "review cursor aggregation kind")
    );
  const aggregationKey = textValue(
    row.aggregation_key,
    "review cursor aggregation key"
  );
  return normalizeReviewCursor(
    {
      cursorVersion: 1,
      tenantId: input.tenantId,
      filterStatus: input.status ?? null,
      filterReviewType: input.reviewType ?? null,
      snapshotHighWater: exactBigintCounter(
        row.snapshot_high_water,
        "review cursor snapshot high-water"
      ),
      lastReviewSequence: exactBigintCounter(
        row.review_sequence,
        "review cursor sequence"
      ),
      lastWindowStartedAt: timestampValue(
        row.window_started_at,
        "review cursor window start"
      ),
      lastShardNo: exactInteger(row.shard_no, "review cursor shard number"),
      lastReviewType: inboxV2SecurityDenialReviewTypeSchema.parse(
        textValue(row.review_type, "review cursor review type")
      ),
      lastAggregationKind: aggregationKind,
      lastAggregationKey: aggregationKey
    },
    input.tenantId,
    input.status,
    input.reviewType
  );
}

function exactlyOneRow<TRow>(rows: readonly TRow[], label: string): TRow {
  if (rows.length !== 1) {
    throw invariantError(`${label} must return exactly one row.`);
  }
  return rows[0]!;
}

function exactBigintCounter(
  value: unknown,
  label: string
): InboxV2BigintCounter {
  if (typeof value !== "string") {
    throw invariantError(`${label} must be returned as exact bigint text.`);
  }
  const parsed = inboxV2BigintCounterSchema.safeParse(value);
  if (!parsed.success) {
    throw invariantError(`${label} is not a canonical PostgreSQL bigint.`);
  }
  return parsed.data;
}

function exactInteger(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw invariantError(`${label} must be an exact nonnegative integer.`);
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function timestampValue(value: unknown, label: string): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (date === null || !Number.isFinite(date.getTime())) {
    throw invariantError(`${label} must be a timestamp.`);
  }
  const serialized = date.toISOString();
  const parsed = inboxV2TimestampSchema.safeParse(serialized);
  if (!parsed.success) {
    throw invariantError(`${label} must be an exact millisecond timestamp.`);
  }
  return parsed.data;
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw invariantError(`${label} must be text.`);
  }
  return value;
}

function optionalTextValue(value: unknown, label: string): string | null {
  return value === null ? null : textValue(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw invariantError(`${label} must be boolean.`);
  }
  return value;
}

function textArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invariantError(`${label} must be returned as a text array.`);
  }
  return [...value] as string[];
}

function hasExactKeys(value: object, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.includes(key))
  );
}

function invariantError(
  message: string
): InboxV2SecurityDenialPersistenceInvariantError {
  return new InboxV2SecurityDenialPersistenceInvariantError(message);
}
