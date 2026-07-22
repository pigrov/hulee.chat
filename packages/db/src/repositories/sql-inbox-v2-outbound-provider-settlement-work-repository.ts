import { createHash, randomBytes } from "node:crypto";

import {
  inboxV2CatalogIdSchema,
  inboxV2ExternalMessageReferenceIdSchema,
  inboxV2MessageTransportOccurrenceLinkIdSchema,
  inboxV2OutboundProviderObservationSchema,
  inboxV2OutboxLeaseTokenSchema,
  inboxV2OutboxWorkerIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2OutboundProviderObservation
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type InboxV2OutboundProviderSettlementWorkEnqueueInput = Readonly<{
  observation: InboxV2OutboundProviderObservation;
  candidateExternalMessageReferenceId: string;
  candidateTransportLinkId: string;
}>;

export type InboxV2OutboundProviderSettlementWorkEnqueueResult = Readonly<{
  kind: "committed" | "already_exists" | "conflict";
}>;

export type InboxV2OutboundProviderSettlementWorkClaim = Readonly<{
  tenantId: string;
  observationId: string;
  candidateExternalMessageReferenceId: string;
  candidateTransportLinkId: string;
  trustedServiceId: string;
  workerId: string;
  leaseToken: string;
  leaseRevision: string;
  attemptCount: string;
  claimedAt: string;
  expiresAt: string;
  revision: string;
}>;

export type InboxV2OutboundProviderSettlementWorkLeaseFence = Readonly<
  Pick<
    InboxV2OutboundProviderSettlementWorkClaim,
    | "tenantId"
    | "observationId"
    | "candidateExternalMessageReferenceId"
    | "candidateTransportLinkId"
    | "trustedServiceId"
    | "workerId"
    | "leaseToken"
    | "leaseRevision"
  >
>;

export type InboxV2OutboundProviderSettlementWorkFinalizeInput = Readonly<{
  tenantId: string;
  observationId: string;
  workerId: string;
  leaseToken: string;
  expectedLeaseRevision: string;
  outcome:
    | Readonly<{ kind: "settled" }>
    | Readonly<{
        kind: "retry";
        availableAt: string;
        errorCode: string;
      }>
    | Readonly<{ kind: "dead"; errorCode: string }>;
}>;

export type InboxV2OutboundProviderSettlementWorkFinalizeResult = Readonly<{
  kind: "committed" | "already_finalized" | "conflict";
}>;

export type InboxV2OutboundProviderSettlementWorkTransactionExecutor =
  Readonly<{
    transaction<T>(
      callback: (transaction: RawSqlExecutor) => Promise<T>
    ): Promise<T>;
  }>;

export type InboxV2OutboundProviderSettlementWorkRepository = Readonly<{
  claim(
    input: Readonly<{
      tenantId: string;
      workerId: string;
      limit: number;
      leaseDurationMs: number;
    }>
  ): Promise<readonly InboxV2OutboundProviderSettlementWorkClaim[]>;
  finalize(
    input: InboxV2OutboundProviderSettlementWorkFinalizeInput
  ): Promise<InboxV2OutboundProviderSettlementWorkFinalizeResult>;
}>;

type WorkIdentity = Readonly<{
  tenantId: string;
  observationId: string;
  candidateExternalMessageReferenceId: string;
  candidateTransportLinkId: string;
  trustedServiceId: string;
  createdAt: string;
}>;

type WorkIdentityRow = Readonly<{
  observation_id: unknown;
  candidate_external_message_reference_id: unknown;
  candidate_transport_link_id: unknown;
  trusted_service_id: unknown;
  created_at: unknown;
}>;

type WorkClaimRow = Readonly<{
  observation_id: unknown;
  candidate_external_message_reference_id: unknown;
  candidate_transport_link_id: unknown;
  trusted_service_id: unknown;
  lease_token_hash: unknown;
  lease_revision: unknown;
  attempt_count: unknown;
  lease_claimed_at: unknown;
  lease_expires_at: unknown;
  revision: unknown;
}>;

type WorkFinalizeReplayRow = Readonly<{
  state: unknown;
  last_finalized_lease_owner_id: unknown;
  last_finalized_lease_token_hash: unknown;
  last_finalized_lease_revision: unknown;
  last_finalized_result_hash: unknown;
}>;

type WorkLeaseFenceRow = Readonly<{
  observation_id: unknown;
}>;

type ParsedFinalizeInput = Readonly<{
  tenantId: string;
  observationId: string;
  workerId: string;
  leaseToken: string;
  leaseTokenHash: string;
  expectedLeaseRevision: bigint;
  resultHash: string;
  outcome:
    | Readonly<{ kind: "settled" }>
    | Readonly<{
        kind: "retry";
        availableAt: string;
        errorCode: string;
      }>
    | Readonly<{ kind: "dead"; errorCode: string }>;
}>;

export function createSqlInboxV2OutboundProviderSettlementWorkRepository(
  executor: InboxV2OutboundProviderSettlementWorkTransactionExecutor,
  options: Readonly<{ tokenSource?: () => string }> = {}
): InboxV2OutboundProviderSettlementWorkRepository {
  if (
    executor === null ||
    typeof executor !== "object" ||
    typeof executor.transaction !== "function"
  ) {
    throw new TypeError(
      "Provider settlement work repository requires a transaction executor."
    );
  }
  const tokenSource = options.tokenSource ?? defaultLeaseTokenSource;
  return Object.freeze({
    claim(input) {
      return executor.transaction((transaction) =>
        claimInboxV2OutboundProviderSettlementWorkInTransaction(
          transaction,
          input,
          tokenSource
        )
      );
    },
    finalize(input) {
      return executor.transaction((transaction) =>
        finalizeInboxV2OutboundProviderSettlementWorkInTransaction(
          transaction,
          input
        )
      );
    }
  });
}

/**
 * Response and echo paths call this only from the transaction that persisted
 * the observation. A successful callback therefore cannot strand an
 * observation without runnable settlement work.
 */
export async function enqueueInboxV2OutboundProviderSettlementWorkInTransaction(
  transaction: RawSqlExecutor,
  input: InboxV2OutboundProviderSettlementWorkEnqueueInput
): Promise<InboxV2OutboundProviderSettlementWorkEnqueueResult> {
  const identity = parseEnqueueInput(input);
  const inserted = await transaction.execute<{ observation_id: unknown }>(
    buildInsertInboxV2OutboundProviderSettlementWorkSql(identity)
  );
  if (inserted.rows.length > 1) {
    throw invariantError("Settlement work insert returned multiple rows.");
  }
  if (inserted.rows.length === 1) return { kind: "committed" };

  const replay = await transaction.execute<WorkIdentityRow>(
    buildFindInboxV2OutboundProviderSettlementWorkReplaySql(identity)
  );
  if (replay.rows.length > 1) return { kind: "conflict" };
  const row = replay.rows[0];
  return row !== undefined && workIdentityMatches(row, identity)
    ? { kind: "already_exists" }
    : { kind: "conflict" };
}

export function buildInsertInboxV2OutboundProviderSettlementWorkSql(
  input: WorkIdentity
): SQL {
  return sql`
    insert into inbox_v2_outbound_provider_settlement_work_items (
      tenant_id, observation_id, candidate_external_message_reference_id,
      candidate_transport_link_id, trusted_service_id, state, attempt_count,
      available_at, lease_owner_id, lease_token_hash, lease_revision,
      lease_claimed_at, lease_expires_at,
      last_finalized_lease_owner_id, last_finalized_lease_token_hash,
      last_finalized_lease_revision, last_finalized_result_hash,
      last_finalized_at, last_error_code, terminal_at,
      revision, created_at, updated_at
    ) values (
      ${input.tenantId}, ${input.observationId},
      ${input.candidateExternalMessageReferenceId},
      ${input.candidateTransportLinkId}, ${input.trustedServiceId},
      'pending', 0, ${toDate(input.createdAt)}, null, null, null, null, null,
      null, null, null, null, null, null, null, 1,
      ${toDate(input.createdAt)}, ${toDate(input.createdAt)}
    )
    on conflict do nothing
    returning observation_id
  `;
}

export function buildFindInboxV2OutboundProviderSettlementWorkReplaySql(
  input: WorkIdentity
): SQL {
  return sql`
    select observation_id, candidate_external_message_reference_id,
           candidate_transport_link_id, trusted_service_id, created_at
      from inbox_v2_outbound_provider_settlement_work_items
     where tenant_id = ${input.tenantId}
       and (
         observation_id = ${input.observationId}
         or candidate_transport_link_id = ${input.candidateTransportLinkId}
       )
     order by case when observation_id = ${input.observationId} then 0 else 1 end
     limit 2
     for share
  `;
}

/**
 * Locks the exact live lease used to authorize a canonical settlement. This
 * query deliberately binds only the domain-separated token hash; raw bearer
 * lease material must never enter SQL logs or durable rows.
 */
export function buildLockInboxV2OutboundProviderSettlementWorkLeaseSql(
  input: InboxV2OutboundProviderSettlementWorkLeaseFence
): SQL {
  const leaseToken = inboxV2OutboxLeaseTokenSchema.parse(input.leaseToken);
  const leaseTokenHash = calculateSettlementLeaseTokenHash(leaseToken);
  return sql`
    select observation_id
      from inbox_v2_outbound_provider_settlement_work_items
     where tenant_id = ${inboxV2TenantIdSchema.parse(input.tenantId)}
       and observation_id = ${input.observationId}
       and candidate_external_message_reference_id =
         ${inboxV2ExternalMessageReferenceIdSchema.parse(
           input.candidateExternalMessageReferenceId
         )}
       and candidate_transport_link_id =
         ${inboxV2MessageTransportOccurrenceLinkIdSchema.parse(
           input.candidateTransportLinkId
         )}
       and trusted_service_id =
         ${inboxV2CatalogIdSchema.parse(input.trustedServiceId)}
       and state = 'leased'
       and lease_owner_id = ${inboxV2OutboxWorkerIdSchema.parse(input.workerId)}
       and lease_token_hash = ${leaseTokenHash}
       and lease_revision = ${BigInt(input.leaseRevision)}
       and lease_expires_at > clock_timestamp()
     for update
  `;
}

export async function lockInboxV2OutboundProviderSettlementWorkLeaseInTransaction(
  transaction: RawSqlExecutor,
  input: InboxV2OutboundProviderSettlementWorkLeaseFence
): Promise<boolean> {
  const result = await transaction.execute<WorkLeaseFenceRow>(
    buildLockInboxV2OutboundProviderSettlementWorkLeaseSql(input)
  );
  if (result.rows.length > 1) {
    throw invariantError(
      "Settlement work lease lookup returned multiple rows."
    );
  }
  return (
    result.rows.length === 1 &&
    String(result.rows[0]?.observation_id) === String(input.observationId)
  );
}

export async function claimInboxV2OutboundProviderSettlementWorkInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    tenantId: string;
    workerId: string;
    limit: number;
    leaseDurationMs: number;
  }>,
  tokenSource: () => string = defaultLeaseTokenSource
): Promise<readonly InboxV2OutboundProviderSettlementWorkClaim[]> {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const workerId = inboxV2OutboxWorkerIdSchema.parse(input.workerId);
  const limit = boundedInteger(input.limit, 1, 100, "claim limit");
  const leaseDurationMs = boundedInteger(
    input.leaseDurationMs,
    1_000,
    3_600_000,
    "lease duration"
  );
  const tokens = Array.from({ length: limit }, () => {
    const leaseToken = inboxV2OutboxLeaseTokenSchema.parse(tokenSource());
    return {
      leaseToken,
      leaseTokenHash: calculateSettlementLeaseTokenHash(leaseToken)
    };
  });
  if (new Set(tokens.map((token) => token.leaseTokenHash)).size !== limit) {
    throw new TypeError("Settlement lease token source returned a duplicate.");
  }
  const byHash = new Map(
    tokens.map((token) => [token.leaseTokenHash, token.leaseToken] as const)
  );
  const result = await transaction.execute<WorkClaimRow>(
    buildClaimInboxV2OutboundProviderSettlementWorkSql({
      tenantId,
      workerId,
      limit,
      leaseDurationMs,
      leaseTokenHashes: tokens.map((token) => token.leaseTokenHash)
    })
  );
  if (result.rows.length > limit) {
    throw invariantError("Settlement work claim exceeded its requested limit.");
  }
  return Object.freeze(
    result.rows.map((row) => {
      const leaseTokenHash = stringValue(
        row.lease_token_hash,
        "lease_token_hash"
      );
      const leaseToken = byHash.get(leaseTokenHash);
      if (leaseToken === undefined) {
        throw invariantError(
          "Settlement work claim returned an unknown lease token hash."
        );
      }
      return Object.freeze({
        tenantId,
        observationId: stringValue(row.observation_id, "observation_id"),
        candidateExternalMessageReferenceId: stringValue(
          row.candidate_external_message_reference_id,
          "candidate_external_message_reference_id"
        ),
        candidateTransportLinkId: stringValue(
          row.candidate_transport_link_id,
          "candidate_transport_link_id"
        ),
        trustedServiceId: stringValue(
          row.trusted_service_id,
          "trusted_service_id"
        ),
        workerId,
        leaseToken,
        leaseRevision: bigintString(row.lease_revision, "lease_revision"),
        attemptCount: bigintString(row.attempt_count, "attempt_count"),
        claimedAt: timestamp(row.lease_claimed_at, "lease_claimed_at"),
        expiresAt: timestamp(row.lease_expires_at, "lease_expires_at"),
        revision: bigintString(row.revision, "revision")
      });
    })
  );
}

export function buildClaimInboxV2OutboundProviderSettlementWorkSql(input: {
  tenantId: string;
  workerId: string;
  limit: number;
  leaseDurationMs: number;
  leaseTokenHashes: readonly string[];
}): SQL {
  return sql`
    with claim_clock as materialized (
      select clock_timestamp() as claimed_at
    ), locked as materialized (
      select work_row.tenant_id, work_row.observation_id,
             work_row.available_at, work_row.lease_expires_at
        from inbox_v2_outbound_provider_settlement_work_items work_row,
             claim_clock
       where work_row.tenant_id = ${input.tenantId}
         and (
           (work_row.state = 'pending'
             and work_row.available_at <= claim_clock.claimed_at)
           or (work_row.state = 'leased'
             and work_row.lease_expires_at <= claim_clock.claimed_at)
         )
       order by case when work_row.state = 'pending' then 0 else 1 end,
                coalesce(work_row.available_at, work_row.lease_expires_at),
                work_row.observation_id
       limit ${input.limit}
       for update of work_row skip locked
    ), numbered as (
      select locked.*,
             row_number() over (
               order by coalesce(locked.available_at, locked.lease_expires_at),
                        locked.observation_id
             )::integer as ordinal
        from locked
    ), token as (
      select token_row.ordinal, token_row.lease_token_hash
        from jsonb_to_recordset(${JSON.stringify(
          input.leaseTokenHashes.map((leaseTokenHash, index) => ({
            ordinal: index + 1,
            lease_token_hash: leaseTokenHash
          }))
        )}::jsonb) as token_row(
          ordinal integer,
          lease_token_hash text
        )
    )
    update inbox_v2_outbound_provider_settlement_work_items work_row
       set state = 'leased',
           attempt_count = work_row.attempt_count + 1,
           lease_owner_id = ${input.workerId},
           lease_token_hash = token.lease_token_hash,
           lease_revision = work_row.attempt_count + 1,
           lease_claimed_at = claim_clock.claimed_at,
           lease_expires_at = claim_clock.claimed_at
             + (${input.leaseDurationMs} * interval '1 millisecond'),
           revision = work_row.revision + 1,
           updated_at = claim_clock.claimed_at
      from numbered, token, claim_clock
     where work_row.tenant_id = numbered.tenant_id
       and work_row.observation_id = numbered.observation_id
       and token.ordinal = numbered.ordinal
    returning work_row.observation_id,
              work_row.candidate_external_message_reference_id,
              work_row.candidate_transport_link_id,
              work_row.trusted_service_id, work_row.lease_token_hash,
              work_row.lease_revision, work_row.attempt_count,
              work_row.lease_claimed_at, work_row.lease_expires_at,
              work_row.revision
  `;
}

export async function finalizeInboxV2OutboundProviderSettlementWorkInTransaction(
  transaction: RawSqlExecutor,
  input: InboxV2OutboundProviderSettlementWorkFinalizeInput
): Promise<InboxV2OutboundProviderSettlementWorkFinalizeResult> {
  const parsed = parseFinalizeInput(input);
  const updated = await transaction.execute<{ observation_id: unknown }>(
    buildFinalizeInboxV2OutboundProviderSettlementWorkSql(parsed)
  );
  if (updated.rows.length > 1) {
    throw invariantError(
      "Settlement work finalization returned multiple rows."
    );
  }
  if (updated.rows.length === 1) return { kind: "committed" };

  const replay = await transaction.execute<WorkFinalizeReplayRow>(sql`
    select state, last_finalized_lease_owner_id,
           last_finalized_lease_token_hash,
           last_finalized_lease_revision, last_finalized_result_hash
      from inbox_v2_outbound_provider_settlement_work_items
     where tenant_id = ${parsed.tenantId}
       and observation_id = ${parsed.observationId}
     for share
  `);
  if (replay.rows.length > 1) {
    throw invariantError(
      "Settlement work finalization replay returned multiple rows."
    );
  }
  const row = replay.rows[0];
  return row !== undefined && finalizationReplayMatches(row, parsed)
    ? { kind: "already_finalized" }
    : { kind: "conflict" };
}

export function buildFinalizeInboxV2OutboundProviderSettlementWorkSql(
  input: ParsedFinalizeInput
): SQL {
  const state = input.outcome.kind === "retry" ? "pending" : input.outcome.kind;
  const availableAt =
    input.outcome.kind === "retry"
      ? sql`${toDate(input.outcome.availableAt)}`
      : sql`null`;
  const errorCode =
    input.outcome.kind === "settled"
      ? sql`null`
      : sql`${input.outcome.errorCode}`;
  const terminalAt =
    input.outcome.kind === "retry"
      ? sql`null`
      : sql`finalize_clock.finalized_at`;
  const retryFence =
    input.outcome.kind === "retry"
      ? sql`and ${toDate(input.outcome.availableAt)} > finalize_clock.finalized_at`
      : sql``;
  const settlementFence =
    input.outcome.kind === "settled"
      ? sql`and exists (
          select 1
            from inbox_v2_outbound_provider_observation_settlements settlement_row
           where settlement_row.tenant_id = work_row.tenant_id
             and settlement_row.observation_id = work_row.observation_id
             and settlement_row.settled_by_trusted_service_id =
               work_row.trusted_service_id
             and settlement_row.settled_at <= finalize_clock.finalized_at
        )`
      : sql``;
  return sql`
    with finalize_clock as materialized (
      select clock_timestamp() as finalized_at
    )
    update inbox_v2_outbound_provider_settlement_work_items work_row
       set state = ${state},
           available_at = ${availableAt},
           lease_owner_id = null,
           lease_token_hash = null,
           lease_revision = null,
           lease_claimed_at = null,
           lease_expires_at = null,
           last_finalized_lease_owner_id = work_row.lease_owner_id,
           last_finalized_lease_token_hash = work_row.lease_token_hash,
           last_finalized_lease_revision = work_row.lease_revision,
           last_finalized_result_hash = ${input.resultHash},
           last_finalized_at = finalize_clock.finalized_at,
           last_error_code = ${errorCode},
           terminal_at = ${terminalAt},
           revision = work_row.revision + 1,
           updated_at = finalize_clock.finalized_at
      from finalize_clock
     where work_row.tenant_id = ${input.tenantId}
       and work_row.observation_id = ${input.observationId}
       and work_row.state = 'leased'
       and work_row.lease_owner_id = ${input.workerId}
       and work_row.lease_token_hash = ${input.leaseTokenHash}
       and work_row.lease_revision = ${input.expectedLeaseRevision}
       and work_row.lease_expires_at > finalize_clock.finalized_at
       ${retryFence}
       ${settlementFence}
    returning work_row.observation_id
  `;
}

function parseEnqueueInput(
  input: InboxV2OutboundProviderSettlementWorkEnqueueInput
): WorkIdentity {
  const observation = inboxV2OutboundProviderObservationSchema.parse(
    input.observation
  );
  return Object.freeze({
    tenantId: observation.tenantId,
    observationId: observation.id,
    candidateExternalMessageReferenceId:
      inboxV2ExternalMessageReferenceIdSchema.parse(
        input.candidateExternalMessageReferenceId
      ),
    candidateTransportLinkId:
      inboxV2MessageTransportOccurrenceLinkIdSchema.parse(
        input.candidateTransportLinkId
      ),
    trustedServiceId: observation.observedByTrustedServiceId,
    createdAt: observation.recordedAt
  });
}

function parseFinalizeInput(
  input: InboxV2OutboundProviderSettlementWorkFinalizeInput
): ParsedFinalizeInput {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const observationId = stringValue(input.observationId, "observationId");
  const workerId = inboxV2OutboxWorkerIdSchema.parse(input.workerId);
  const leaseToken = inboxV2OutboxLeaseTokenSchema.parse(input.leaseToken);
  const expectedLeaseRevision = positiveBigint(
    input.expectedLeaseRevision,
    "expectedLeaseRevision"
  );
  const outcome =
    input.outcome.kind === "settled"
      ? ({ kind: "settled" } as const)
      : input.outcome.kind === "retry"
        ? ({
            kind: "retry" as const,
            availableAt: inboxV2TimestampSchema.parse(
              input.outcome.availableAt
            ),
            errorCode: inboxV2CatalogIdSchema.parse(input.outcome.errorCode)
          } as const)
        : ({
            kind: "dead" as const,
            errorCode: inboxV2CatalogIdSchema.parse(input.outcome.errorCode)
          } as const);
  const leaseTokenHash = calculateSettlementLeaseTokenHash(leaseToken);
  return Object.freeze({
    tenantId,
    observationId,
    workerId,
    leaseToken,
    leaseTokenHash,
    expectedLeaseRevision,
    outcome,
    resultHash: calculateSettlementResultHash({
      tenantId,
      observationId,
      workerId,
      leaseTokenHash,
      expectedLeaseRevision: expectedLeaseRevision.toString(),
      outcome
    })
  });
}

function workIdentityMatches(
  row: WorkIdentityRow,
  identity: WorkIdentity
): boolean {
  return (
    String(row.observation_id) === identity.observationId &&
    String(row.candidate_external_message_reference_id) ===
      identity.candidateExternalMessageReferenceId &&
    String(row.candidate_transport_link_id) ===
      identity.candidateTransportLinkId &&
    String(row.trusted_service_id) === identity.trustedServiceId &&
    timestamp(row.created_at, "created_at") === identity.createdAt
  );
}

function finalizationReplayMatches(
  row: WorkFinalizeReplayRow,
  input: ParsedFinalizeInput
): boolean {
  const expectedState =
    input.outcome.kind === "retry" ? "pending" : input.outcome.kind;
  return (
    String(row.state) === expectedState &&
    String(row.last_finalized_lease_owner_id) === input.workerId &&
    String(row.last_finalized_lease_token_hash) === input.leaseTokenHash &&
    bigintString(
      row.last_finalized_lease_revision,
      "last_finalized_lease_revision"
    ) === input.expectedLeaseRevision.toString() &&
    String(row.last_finalized_result_hash) === input.resultHash
  );
}

export function calculateInboxV2OutboundProviderSettlementLeaseTokenHash(
  leaseToken: string
): string {
  return calculateSettlementLeaseTokenHash(
    inboxV2OutboxLeaseTokenSchema.parse(leaseToken)
  );
}

export function calculateSettlementLeaseTokenHash(leaseToken: string): string {
  return digest(
    `core:inbox-v2.outbound-provider-settlement-lease-token\u0000${leaseToken}`
  );
}

function calculateSettlementResultHash(
  input: Readonly<{
    tenantId: string;
    observationId: string;
    workerId: string;
    leaseTokenHash: string;
    expectedLeaseRevision: string;
    outcome: ParsedFinalizeInput["outcome"];
  }>
): string {
  return digest(
    `core:inbox-v2.outbound-provider-settlement-result\u0000${JSON.stringify(
      input
    )}`
  );
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function defaultLeaseTokenSource(): string {
  return `settlement-lease:${randomBytes(32).toString("base64url")}`;
}

function positiveBigint(value: string, field: string): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  if (parsed < 1n) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return parsed;
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function toDate(value: string): Date {
  return new Date(inboxV2TimestampSchema.parse(value));
}

function timestamp(value: unknown, field: string): string {
  const date =
    value instanceof Date ? value : new Date(stringValue(value, field));
  if (Number.isNaN(date.getTime())) {
    throw invariantError(`Invalid ${field} timestamp.`);
  }
  return inboxV2TimestampSchema.parse(date.toISOString());
}

function bigintString(value: unknown, field: string): string {
  try {
    return BigInt(stringValue(value, field)).toString();
  } catch {
    throw invariantError(`Invalid ${field} bigint.`);
  }
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariantError(`Invalid ${field} value.`);
  }
  return value;
}

function invariantError(detail: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(
    `inbox_v2.outbound_provider_settlement_work_invariant: ${detail}`
  );
}
