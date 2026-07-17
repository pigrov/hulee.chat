import {
  calculateInboxV2OutboxLeaseTokenHash,
  inboxV2ClaimOutboxInputSchema,
  inboxV2ClaimOutboxResultSchema,
  inboxV2FinalizeOutboxInputSchema,
  inboxV2FinalizeOutboxResultSchema,
  inboxV2EntityRevisionSchema,
  inboxV2OutboxLeaseTokenSchema,
  inboxV2OutboxWorkItemSchema,
  inboxV2PurgeOutboxTerminalPayloadInputSchema,
  inboxV2PurgeOutboxTerminalPayloadResultSchema,
  inboxV2RenewOutboxLeaseInputSchema,
  inboxV2RenewOutboxLeaseResultSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TimestampSchema,
  type InboxV2ClaimOutboxInput,
  type InboxV2ClaimOutboxResult,
  type InboxV2FinalizeOutboxInput,
  type InboxV2FinalizeOutboxResult,
  type InboxV2OutboxTerminalPayloadRetentionPort,
  type InboxV2OutboxWorkItem,
  type InboxV2OutboxWorkRepositoryPort,
  type InboxV2PurgeOutboxTerminalPayloadInput,
  type InboxV2PurgeOutboxTerminalPayloadResult,
  type InboxV2RenewOutboxLeaseInput,
  type InboxV2RenewOutboxLeaseResult
} from "@hulee/contracts";
import { randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type InboxV2RepositoryOutboxTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult>;
};

export type InboxV2OutboxLeaseTokenSource = (
  count: number
) => readonly string[];

export type CreateSqlInboxV2RepositoryOutboxOptions = Readonly<{
  tokenSource?: InboxV2OutboxLeaseTokenSource;
}>;

type OutboxWorkRow = Record<string, unknown> & {
  tenant_id: unknown;
  intent_id: unknown;
  state: unknown;
  attempt_count: unknown;
  available_at: unknown;
  lease_owner_id: unknown;
  lease_token_hash: unknown;
  lease_revision: unknown;
  lease_claimed_at: unknown;
  lease_expires_at: unknown;
  last_retry_result_hash: unknown;
  last_retry_error_code: unknown;
  last_retry_available_at: unknown;
  last_retry_recorded_at: unknown;
  terminal_result_hash: unknown;
  terminal_error_code: unknown;
  terminal_result_reference: unknown;
  terminal_finalized_at: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type ClaimedOutboxWorkRow = OutboxWorkRow & {
  previous_state: unknown;
  claim_ordinal: unknown;
};

type LockedOutboxWorkRow = OutboxWorkRow & { db_now: unknown };
type InsertedOutcomeRow = { outcome_revision: unknown };
type TerminalReplayOutcomeRow = { outcome_revision: unknown };
type PurgedTerminalPayloadRow = {
  outcome_found: unknown;
  payload_purged: unknown;
};

export class InboxV2RepositoryOutboxPersistenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxV2RepositoryOutboxPersistenceInvariantError";
  }
}

export function createSqlInboxV2RepositoryOutbox(
  executor: InboxV2RepositoryOutboxTransactionExecutor | HuleeDatabase,
  options: CreateSqlInboxV2RepositoryOutboxOptions = {}
): InboxV2OutboxWorkRepositoryPort {
  const transactionExecutor =
    executor as unknown as InboxV2RepositoryOutboxTransactionExecutor;
  const tokenSource = options.tokenSource ?? defaultLeaseTokenSource;

  return Object.freeze({
    async claimAvailable(rawInput: InboxV2ClaimOutboxInput) {
      const input = inboxV2ClaimOutboxInputSchema.parse(rawInput);
      const tokens = createClaimTokens(tokenSource, input.batchSize);
      return transactionExecutor.transaction(async (transaction) => {
        const result = await transaction.execute<ClaimedOutboxWorkRow>(
          buildClaimInboxV2OutboxSql(
            input,
            tokens.map(({ tokenHash }) => tokenHash)
          )
        );
        return mapClaimResult(input, tokens, result.rows);
      });
    },

    async renewLease(rawInput: InboxV2RenewOutboxLeaseInput) {
      const input = inboxV2RenewOutboxLeaseInputSchema.parse(rawInput);
      const tokenHash = calculateInboxV2OutboxLeaseTokenHash(input.leaseToken);
      return transactionExecutor.transaction(async (transaction) => {
        const locked = await lockAndClassifyLease(
          transaction,
          input,
          tokenHash
        );
        if (locked.kind === "result") return locked.result;

        const renewed = await transaction.execute<OutboxWorkRow>(
          buildRenewInboxV2OutboxLeaseSql({
            input,
            tokenHash,
            dbNow: locked.dbNow,
            expectedWorkRevision: locked.work.revision
          })
        );
        const row = exactlyOneRow(renewed.rows, "outbox lease renewal");
        const work = mapOutboxWorkRow(
          input.context.tenantId,
          input.intentId,
          row
        );
        return inboxV2RenewOutboxLeaseResultSchema.parse({
          outcome: "renewed",
          work
        });
      });
    },

    async finalize(rawInput: InboxV2FinalizeOutboxInput) {
      const input = inboxV2FinalizeOutboxInputSchema.parse(rawInput);
      const tokenHash = calculateInboxV2OutboxLeaseTokenHash(input.leaseToken);
      return transactionExecutor.transaction(async (transaction) => {
        const locked = await lockAndClassifyFinalizeLease(
          transaction,
          input,
          tokenHash
        );
        if (locked.kind === "result") {
          return locked.result;
        }

        const outcomeRevision = incrementBigint(
          locked.work.revision,
          "outbox outcome revision"
        );
        const inserted = await transaction.execute<InsertedOutcomeRow>(
          buildInsertInboxV2OutboxOutcomeSql({
            input,
            tokenHash,
            dbNow: locked.dbNow,
            outcomeRevision
          })
        );
        const insertedOutcome = exactlyOneRow(
          inserted.rows,
          "outbox outcome insert"
        );
        if (bigintText(insertedOutcome.outcome_revision) !== outcomeRevision) {
          throw invariantError(
            "Outbox outcome insert returned a different revision."
          );
        }

        const terminalReference = terminalResultReference(input);
        if (terminalReference !== null) {
          await transaction.execute(
            buildInsertInboxV2OutboxTerminalPayloadReferenceSql({
              input,
              dbNow: locked.dbNow,
              outcomeRevision
            })
          );
        }

        const finalized = await transaction.execute<OutboxWorkRow>(
          buildFinalizeInboxV2OutboxSql({
            input,
            tokenHash,
            dbNow: locked.dbNow,
            expectedWorkRevision: locked.work.revision,
            outcomeRevision
          })
        );
        const finalizedRow = exactlyOneRow(
          finalized.rows,
          "outbox finalization"
        );
        const work = mapOutboxWorkRow(
          input.context.tenantId,
          input.intentId,
          terminalReference === null
            ? finalizedRow
            : {
                ...finalizedRow,
                terminal_result_reference: terminalReference
              }
        );
        await transaction.execute(sql.raw("set constraints all immediate"));
        const outcome =
          input.instruction.kind === "retry"
            ? "retry_scheduled"
            : input.instruction.kind;
        return inboxV2FinalizeOutboxResultSchema.parse({ outcome, work });
      });
    }
  });
}

/**
 * Creates the destructive terminal-payload lifecycle boundary. The supplied
 * executor must authenticate as the dedicated retention-owner database role.
 */
export function createSqlInboxV2OutboxTerminalPayloadRetention(
  executor: InboxV2RepositoryOutboxTransactionExecutor | HuleeDatabase
): InboxV2OutboxTerminalPayloadRetentionPort {
  const transactionExecutor =
    executor as unknown as InboxV2RepositoryOutboxTransactionExecutor;
  return Object.freeze({
    async purgeTerminalPayload(
      rawInput: InboxV2PurgeOutboxTerminalPayloadInput
    ): Promise<InboxV2PurgeOutboxTerminalPayloadResult> {
      const input =
        inboxV2PurgeOutboxTerminalPayloadInputSchema.parse(rawInput);
      return transactionExecutor.transaction(async (transaction) => {
        const result = await transaction.execute<PurgedTerminalPayloadRow>(
          buildPurgeInboxV2OutboxTerminalPayloadSql(input)
        );
        const row = exactlyOneRow(result.rows, "outbox terminal payload purge");
        const outcomeFound = booleanValue(
          row.outcome_found,
          "outbox terminal payload outcome existence"
        );
        const payloadPurged = booleanValue(
          row.payload_purged,
          "outbox terminal payload purge result"
        );
        return inboxV2PurgeOutboxTerminalPayloadResultSchema.parse({
          outcome: !outcomeFound
            ? "not_found"
            : payloadPurged
              ? "purged"
              : "already_absent",
          tenantId: input.context.tenantId,
          intentId: input.intentId,
          outcomeRevision: input.outcomeRevision
        });
      });
    }
  });
}

export function buildClaimInboxV2OutboxSql(
  rawInput: InboxV2ClaimOutboxInput,
  rawTokenHashes: readonly string[]
): SQL {
  const input = inboxV2ClaimOutboxInputSchema.parse(rawInput);
  const tokenHashes = rawTokenHashes.map((value) =>
    inboxV2Sha256DigestSchema.parse(value)
  );
  if (
    tokenHashes.length !== input.batchSize ||
    new Set(tokenHashes).size !== tokenHashes.length
  ) {
    throw invariantError(
      "Outbox claim requires one unique token digest per requested ordinal."
    );
  }
  const tokenRows = JSON.stringify(
    tokenHashes.map((tokenHash, index) => ({
      claim_ordinal: index + 1,
      token_hash: tokenHash
    }))
  );

  return sql`
    with db_clock as materialized (
      select clock_timestamp() as db_now
    ),
    locked_candidates as materialized (
      select work.tenant_id,
             work.intent_id,
             work.state::text as previous_state,
             work.lease_revision,
             db_clock.db_now,
             case
               when work.state = 'pending' then work.available_at
               else work.lease_expires_at
             end as due_at
        from public.inbox_v2_outbox_work_items work
        cross join db_clock
       where work.tenant_id = ${input.context.tenantId}
         and (
           (work.state = 'pending' and work.available_at <= db_clock.db_now)
           or
           (work.state = 'leased' and work.lease_expires_at <= db_clock.db_now)
         )
       order by due_at asc, work.intent_id collate "C" asc
       limit ${input.batchSize}
       for update of work skip locked
    ),
    ranked_candidates as (
      select locked_candidates.*,
             row_number() over (
               order by due_at asc, intent_id collate "C" asc
             )::integer as claim_ordinal
        from locked_candidates
    ),
    claim_tokens as (
      select token.claim_ordinal,
             token.token_hash
        from jsonb_to_recordset(${tokenRows}::jsonb)
          as token(claim_ordinal integer, token_hash text)
    ),
    claimed as (
      update public.inbox_v2_outbox_work_items work
         set state = 'leased',
             attempt_count = work.attempt_count + 1,
             lease_owner_id = ${input.workerId},
             lease_token_hash = claim_tokens.token_hash,
             lease_revision = case
               when ranked_candidates.previous_state = 'pending' then 1
               else ranked_candidates.lease_revision + 1
             end,
             lease_claimed_at = ranked_candidates.db_now,
             lease_expires_at = ranked_candidates.db_now
               + make_interval(secs => ${input.leaseDurationSeconds}),
             revision = work.revision + 1,
             updated_at = ranked_candidates.db_now
        from ranked_candidates
        join claim_tokens
          on claim_tokens.claim_ordinal = ranked_candidates.claim_ordinal
       where work.tenant_id = ranked_candidates.tenant_id
         and work.intent_id = ranked_candidates.intent_id
      returning ${outboxWorkReturningColumns("work")},
                ranked_candidates.previous_state,
                ranked_candidates.claim_ordinal
    )
    select *
      from claimed
     order by claim_ordinal asc
  `;
}

export function buildLockInboxV2OutboxWorkSql(input: {
  context: InboxV2RenewOutboxLeaseInput["context"];
  intentId: InboxV2RenewOutboxLeaseInput["intentId"];
}): SQL {
  return sql`
    with db_clock as materialized (
      select clock_timestamp() as db_now
    )
    select ${outboxWorkSelectColumns("work", "terminal_payload")},
           db_clock.db_now
      from public.inbox_v2_outbox_work_items work
      left join public.inbox_v2_outbox_terminal_payload_refs terminal_payload
        on terminal_payload.tenant_id = work.tenant_id
       and terminal_payload.intent_id = work.intent_id
       and terminal_payload.outcome_revision = work.revision
      cross join db_clock
     where work.tenant_id = ${input.context.tenantId}
       and work.intent_id = ${input.intentId}
     for update of work
  `;
}

export function buildFindInboxV2OutboxTerminalReplaySql(raw: {
  input: InboxV2FinalizeOutboxInput;
  tokenHash: string;
  terminalWork: InboxV2OutboxWorkItem;
}): SQL {
  const input = inboxV2FinalizeOutboxInputSchema.parse(raw.input);
  const tokenHash = inboxV2Sha256DigestSchema.parse(raw.tokenHash);
  const terminalWork = inboxV2OutboxWorkItemSchema.parse(raw.terminalWork);
  if (
    terminalWork.tenantId !== input.context.tenantId ||
    terminalWork.intentId !== input.intentId ||
    (terminalWork.state !== "processed" && terminalWork.state !== "dead")
  ) {
    throw invariantError(
      "Terminal outbox replay lookup requires the exact terminal work item."
    );
  }
  const instruction = input.instruction;
  if (instruction.kind === "retry") {
    throw invariantError(
      "Terminal outbox replay lookup cannot use a retry instruction."
    );
  }
  const resultReference =
    instruction.resultReference === null
      ? null
      : JSON.stringify(instruction.resultReference);
  const errorCode = instruction.kind === "dead" ? instruction.errorCode : null;
  return sql`
    select outcome.outcome_revision::text as outcome_revision
      from public.inbox_v2_outbox_outcomes outcome
      left join public.inbox_v2_outbox_terminal_payload_refs terminal_payload
        on terminal_payload.tenant_id = outcome.tenant_id
       and terminal_payload.intent_id = outcome.intent_id
       and terminal_payload.outcome_revision = outcome.outcome_revision
     where outcome.tenant_id = ${input.context.tenantId}
       and outcome.intent_id = ${input.intentId}
       and outcome.outcome_revision = ${terminalWork.revision}
       and outcome.kind = ${terminalWork.state}
             ::public.inbox_v2_outbox_outcome_kind
       and outcome.lease_token_hash = ${tokenHash}
       and outcome.worker_id = ${input.workerId}
       and outcome.outcome_hash = ${instruction.resultHash}
       and outcome.error_code is not distinct from ${errorCode}
       and (
         (not outcome.payload_reference_recorded
           and ${resultReference}::jsonb is null)
         or (
           outcome.payload_reference_recorded
           and (
             terminal_payload.tenant_id is null
             or terminal_payload.result_reference = ${resultReference}::jsonb
           )
         )
       )
     limit 1
  `;
}

export function buildRenewInboxV2OutboxLeaseSql(raw: {
  input: InboxV2RenewOutboxLeaseInput;
  tokenHash: string;
  dbNow: string;
  expectedWorkRevision: string;
}): SQL {
  const input = inboxV2RenewOutboxLeaseInputSchema.parse(raw.input);
  const tokenHash = inboxV2Sha256DigestSchema.parse(raw.tokenHash);
  const dbNow = inboxV2TimestampSchema.parse(raw.dbNow);
  const expectedWorkRevision = inboxV2EntityRevisionSchema.parse(
    raw.expectedWorkRevision
  );
  return sql`
    update public.inbox_v2_outbox_work_items work
       set lease_revision = work.lease_revision + 1,
           lease_expires_at = greatest(
             work.lease_expires_at,
             ${dbNow}::timestamptz
               + make_interval(secs => ${input.leaseDurationSeconds})
           ),
           revision = work.revision + 1,
           updated_at = ${dbNow}::timestamptz
     where work.tenant_id = ${input.context.tenantId}
       and work.intent_id = ${input.intentId}
       and work.state = 'leased'
       and work.lease_owner_id = ${input.workerId}
       and work.lease_token_hash = ${tokenHash}
       and work.lease_revision = ${input.expectedLeaseRevision}
       and work.lease_expires_at > ${dbNow}::timestamptz
       and work.revision = ${expectedWorkRevision}
    returning ${outboxWorkReturningColumns("work")}
  `;
}

export function buildInsertInboxV2OutboxOutcomeSql(raw: {
  input: InboxV2FinalizeOutboxInput;
  tokenHash: string;
  dbNow: string;
  outcomeRevision: string;
}): SQL {
  const input = inboxV2FinalizeOutboxInputSchema.parse(raw.input);
  const tokenHash = inboxV2Sha256DigestSchema.parse(raw.tokenHash);
  const dbNow = inboxV2TimestampSchema.parse(raw.dbNow);
  const outcomeRevision = inboxV2EntityRevisionSchema.parse(
    raw.outcomeRevision
  );
  const instruction = input.instruction;
  const errorCode =
    instruction.kind === "processed" ? null : instruction.errorCode;
  const payloadReferenceRecorded = terminalResultReference(input) !== null;
  const retryAt =
    instruction.kind === "retry"
      ? sql`${dbNow}::timestamptz
          + make_interval(secs => ${instruction.retryAfterSeconds})`
      : sql`null::timestamptz`;

  return sql`
    insert into public.inbox_v2_outbox_outcomes (
      tenant_id,
      intent_id,
      outcome_revision,
      kind,
      lease_token_hash,
      worker_id,
      error_code,
      payload_reference_recorded,
      retry_at,
      outcome_hash,
      occurred_at,
      created_at
    ) values (
      ${input.context.tenantId},
      ${input.intentId},
      ${outcomeRevision},
      ${instruction.kind}::public.inbox_v2_outbox_outcome_kind,
      ${tokenHash},
      ${input.workerId},
      ${errorCode},
      ${payloadReferenceRecorded},
      ${retryAt},
      ${instruction.resultHash},
      ${dbNow}::timestamptz,
      ${dbNow}::timestamptz
    )
    returning outcome_revision::text as outcome_revision
  `;
}

export function buildInsertInboxV2OutboxTerminalPayloadReferenceSql(raw: {
  input: InboxV2FinalizeOutboxInput;
  dbNow: string;
  outcomeRevision: string;
}): SQL {
  const input = inboxV2FinalizeOutboxInputSchema.parse(raw.input);
  const dbNow = inboxV2TimestampSchema.parse(raw.dbNow);
  const outcomeRevision = inboxV2EntityRevisionSchema.parse(
    raw.outcomeRevision
  );
  const resultReference = terminalResultReference(input);
  if (resultReference === null) {
    throw invariantError(
      "Terminal payload reference insert requires a recorded reference."
    );
  }
  return sql`
    insert into public.inbox_v2_outbox_terminal_payload_refs (
      tenant_id,
      intent_id,
      outcome_revision,
      result_reference,
      recorded_at
    ) values (
      ${input.context.tenantId},
      ${input.intentId},
      ${outcomeRevision},
      ${JSON.stringify(resultReference)}::jsonb,
      ${dbNow}::timestamptz
    )
  `;
}

export function buildPurgeInboxV2OutboxTerminalPayloadSql(
  rawInput: InboxV2PurgeOutboxTerminalPayloadInput
): SQL {
  const input = inboxV2PurgeOutboxTerminalPayloadInputSchema.parse(rawInput);
  return sql`
    with observed_outcome as materialized (
      select outcome.tenant_id,
             outcome.intent_id,
             outcome.outcome_revision
        from public.inbox_v2_outbox_outcomes outcome
       where outcome.tenant_id = ${input.context.tenantId}
         and outcome.intent_id = ${input.intentId}
         and outcome.outcome_revision = ${input.outcomeRevision}
         and outcome.kind in ('processed', 'dead')
    ),
    deleted_payload as (
      delete from public.inbox_v2_outbox_terminal_payload_refs payload
       using observed_outcome
       where payload.tenant_id = observed_outcome.tenant_id
         and payload.intent_id = observed_outcome.intent_id
         and payload.outcome_revision = observed_outcome.outcome_revision
      returning payload.tenant_id
    )
    select exists(select 1 from observed_outcome) as outcome_found,
           exists(select 1 from deleted_payload) as payload_purged
  `;
}

export function buildFinalizeInboxV2OutboxSql(raw: {
  input: InboxV2FinalizeOutboxInput;
  tokenHash: string;
  dbNow: string;
  expectedWorkRevision: string;
  outcomeRevision: string;
}): SQL {
  const input = inboxV2FinalizeOutboxInputSchema.parse(raw.input);
  const tokenHash = inboxV2Sha256DigestSchema.parse(raw.tokenHash);
  const dbNow = inboxV2TimestampSchema.parse(raw.dbNow);
  const expectedWorkRevision = inboxV2EntityRevisionSchema.parse(
    raw.expectedWorkRevision
  );
  const outcomeRevision = inboxV2EntityRevisionSchema.parse(
    raw.outcomeRevision
  );
  if (BigInt(outcomeRevision) !== BigInt(expectedWorkRevision) + 1n) {
    throw invariantError(
      "Outbox finalization outcome revision must advance work exactly once."
    );
  }
  const instruction = input.instruction;
  const retry = instruction.kind === "retry";
  const terminal = !retry;
  const retryAt = retry
    ? sql`${dbNow}::timestamptz
        + make_interval(secs => ${instruction.retryAfterSeconds})`
    : sql`null::timestamptz`;
  return sql`
    update public.inbox_v2_outbox_work_items work
       set state = ${retry ? "pending" : instruction.kind}
             ::public.inbox_v2_outbox_work_state,
           available_at = ${retryAt},
           lease_owner_id = null,
           lease_token_hash = null,
           lease_revision = null,
           lease_claimed_at = null,
           lease_expires_at = null,
           last_retry_result_hash = ${retry ? instruction.resultHash : null},
           last_retry_error_code = ${retry ? instruction.errorCode : null},
           last_retry_available_at = ${retryAt},
           last_retry_recorded_at = ${retry ? dbNow : null}::timestamptz,
           terminal_result_hash = ${terminal ? instruction.resultHash : null},
           terminal_error_code = ${
             instruction.kind === "dead" ? instruction.errorCode : null
           },
           terminal_result_reference = null,
           terminal_finalized_at = ${terminal ? dbNow : null}::timestamptz,
           revision = ${outcomeRevision},
           updated_at = ${dbNow}::timestamptz
     where work.tenant_id = ${input.context.tenantId}
       and work.intent_id = ${input.intentId}
       and work.state = 'leased'
       and work.lease_owner_id = ${input.workerId}
       and work.lease_token_hash = ${tokenHash}
       and work.lease_revision = ${input.expectedLeaseRevision}
       and work.lease_expires_at > ${dbNow}::timestamptz
       and work.revision = ${expectedWorkRevision}
    returning ${outboxWorkReturningColumns("work")}
  `;
}

type LeaseFenceInput = Readonly<{
  context: InboxV2RenewOutboxLeaseInput["context"];
  intentId: InboxV2RenewOutboxLeaseInput["intentId"];
  workerId: InboxV2RenewOutboxLeaseInput["workerId"];
  leaseToken: InboxV2RenewOutboxLeaseInput["leaseToken"];
  expectedLeaseRevision: InboxV2RenewOutboxLeaseInput["expectedLeaseRevision"];
}>;

type LeaseFenceFailure = Exclude<
  InboxV2RenewOutboxLeaseResult,
  Readonly<{ outcome: "renewed" }>
>;

type LockedLease =
  | Readonly<{ kind: "result"; result: LeaseFenceFailure }>
  | Readonly<{
      kind: "locked";
      work: InboxV2OutboxWorkItem & Readonly<{ state: "leased" }>;
      dbNow: string;
    }>;

type LockedFinalizeLease =
  | Readonly<{ kind: "result"; result: InboxV2FinalizeOutboxResult }>
  | Readonly<{
      kind: "locked";
      work: InboxV2OutboxWorkItem & Readonly<{ state: "leased" }>;
      dbNow: string;
    }>;

async function lockAndClassifyLease(
  executor: RawSqlExecutor,
  input: LeaseFenceInput,
  tokenHash: string
): Promise<LockedLease> {
  const result = await executor.execute<LockedOutboxWorkRow>(
    buildLockInboxV2OutboxWorkSql(input)
  );
  if (result.rows.length > 1) {
    throw invariantError("Outbox work lock returned more than one row.");
  }
  const row = result.rows[0];
  if (row === undefined) {
    return {
      kind: "result",
      result: parseLeaseFailure({
        outcome: "not_found",
        tenantId: input.context.tenantId,
        intentId: input.intentId
      })
    };
  }

  const work = mapOutboxWorkRow(input.context.tenantId, input.intentId, row);
  const dbNow = timestampValue(row.db_now, "outbox database clock");
  if (work.state !== "leased") {
    return {
      kind: "result",
      result: parseLeaseFailure({
        outcome: "not_leased",
        tenantId: input.context.tenantId,
        intentId: input.intentId,
        currentState: work.state
      })
    };
  }
  if (work.lease === null) {
    throw invariantError("Leased outbox work has no mapped lease.");
  }
  if (
    work.lease.workerId !== input.workerId ||
    work.lease.leaseTokenHash !== tokenHash
  ) {
    return {
      kind: "result",
      result: parseLeaseFailure({
        outcome: "stale_token",
        tenantId: input.context.tenantId,
        intentId: input.intentId,
        currentLeaseRevision: work.lease.leaseRevision
      })
    };
  }
  if (Date.parse(work.lease.expiresAt) <= Date.parse(dbNow)) {
    return {
      kind: "result",
      result: parseLeaseFailure({
        outcome: "lease_expired",
        tenantId: input.context.tenantId,
        intentId: input.intentId,
        currentLeaseRevision: work.lease.leaseRevision
      })
    };
  }
  if (work.lease.leaseRevision !== input.expectedLeaseRevision) {
    return {
      kind: "result",
      result: parseLeaseFailure({
        outcome: "lease_revision_conflict",
        tenantId: input.context.tenantId,
        intentId: input.intentId,
        currentLeaseRevision: work.lease.leaseRevision
      })
    };
  }
  return {
    kind: "locked",
    work: work as InboxV2OutboxWorkItem & Readonly<{ state: "leased" }>,
    dbNow
  };
}

async function lockAndClassifyFinalizeLease(
  executor: RawSqlExecutor,
  input: InboxV2FinalizeOutboxInput,
  tokenHash: string
): Promise<LockedFinalizeLease> {
  const result = await executor.execute<LockedOutboxWorkRow>(
    buildLockInboxV2OutboxWorkSql(input)
  );
  if (result.rows.length > 1) {
    throw invariantError("Outbox work lock returned more than one row.");
  }
  const row = result.rows[0];
  if (row === undefined) {
    return {
      kind: "result",
      result: asFinalizeFailure(
        parseLeaseFailure({
          outcome: "not_found",
          tenantId: input.context.tenantId,
          intentId: input.intentId
        })
      )
    };
  }

  const work = mapOutboxWorkRow(input.context.tenantId, input.intentId, row);
  const dbNow = timestampValue(row.db_now, "outbox database clock");
  if (work.state === "processed" || work.state === "dead") {
    if (!terminalInstructionMatches(input, work)) {
      return {
        kind: "result",
        result: asFinalizeFailure(
          parseLeaseFailure({
            outcome: "not_leased",
            tenantId: input.context.tenantId,
            intentId: input.intentId,
            currentState: work.state
          })
        )
      };
    }
    const replay = await executor.execute<TerminalReplayOutcomeRow>(
      buildFindInboxV2OutboxTerminalReplaySql({
        input,
        tokenHash,
        terminalWork: work
      })
    );
    if (replay.rows.length > 1) {
      throw invariantError(
        "Outbox terminal replay lookup returned too many rows."
      );
    }
    if (replay.rows[0] !== undefined) {
      const outcomeRevision = bigintText(replay.rows[0].outcome_revision);
      if (outcomeRevision !== work.revision) {
        throw invariantError(
          "Outbox terminal replay outcome is not bound to the terminal work revision."
        );
      }
      return {
        kind: "result",
        result: inboxV2FinalizeOutboxResultSchema.parse({
          outcome: "already_finalized",
          work
        })
      };
    }
    return {
      kind: "result",
      result: asFinalizeFailure(
        parseLeaseFailure({
          outcome: "not_leased",
          tenantId: input.context.tenantId,
          intentId: input.intentId,
          currentState: work.state
        })
      )
    };
  }
  if (work.state !== "leased") {
    return {
      kind: "result",
      result: asFinalizeFailure(
        parseLeaseFailure({
          outcome: "not_leased",
          tenantId: input.context.tenantId,
          intentId: input.intentId,
          currentState: work.state
        })
      )
    };
  }
  if (work.lease === null) {
    throw invariantError("Leased outbox work has no mapped lease.");
  }
  if (
    work.lease.workerId !== input.workerId ||
    work.lease.leaseTokenHash !== tokenHash
  ) {
    return {
      kind: "result",
      result: asFinalizeFailure(
        parseLeaseFailure({
          outcome: "stale_token",
          tenantId: input.context.tenantId,
          intentId: input.intentId,
          currentLeaseRevision: work.lease.leaseRevision
        })
      )
    };
  }
  if (Date.parse(work.lease.expiresAt) <= Date.parse(dbNow)) {
    return {
      kind: "result",
      result: asFinalizeFailure(
        parseLeaseFailure({
          outcome: "lease_expired",
          tenantId: input.context.tenantId,
          intentId: input.intentId,
          currentLeaseRevision: work.lease.leaseRevision
        })
      )
    };
  }
  if (work.lease.leaseRevision !== input.expectedLeaseRevision) {
    return {
      kind: "result",
      result: asFinalizeFailure(
        parseLeaseFailure({
          outcome: "lease_revision_conflict",
          tenantId: input.context.tenantId,
          intentId: input.intentId,
          currentLeaseRevision: work.lease.leaseRevision
        })
      )
    };
  }
  return {
    kind: "locked",
    work: work as InboxV2OutboxWorkItem & Readonly<{ state: "leased" }>,
    dbNow
  };
}

function parseLeaseFailure(input: unknown): LeaseFenceFailure {
  const result = inboxV2RenewOutboxLeaseResultSchema.parse(input);
  if (result.outcome === "renewed") {
    throw invariantError("Lease failure mapper produced a renewed result.");
  }
  return result;
}

function asFinalizeFailure(
  result: LeaseFenceFailure
): InboxV2FinalizeOutboxResult {
  return inboxV2FinalizeOutboxResultSchema.parse(result);
}

function terminalInstructionMatches(
  input: InboxV2FinalizeOutboxInput,
  work: InboxV2OutboxWorkItem
): boolean {
  const terminal = work.terminalResult;
  const instruction = input.instruction;
  if (terminal === null || terminal.kind !== instruction.kind) return false;
  if (terminal.resultHash !== instruction.resultHash) return false;
  if (
    terminal.kind === "dead" &&
    instruction.kind === "dead" &&
    terminal.errorCode !== instruction.errorCode
  ) {
    return false;
  }
  return true;
}

function terminalResultReference(
  input: InboxV2FinalizeOutboxInput
): Readonly<Record<string, unknown>> | null {
  return input.instruction.kind === "retry"
    ? null
    : input.instruction.resultReference;
}

type ClaimToken = Readonly<{ rawToken: string; tokenHash: string }>;

function createClaimTokens(
  source: InboxV2OutboxLeaseTokenSource,
  count: number
): readonly ClaimToken[] {
  const rawTokens = Array.from(source(count));
  if (rawTokens.length !== count) {
    throw invariantError(
      "Outbox token source must return exactly one token per claim ordinal."
    );
  }
  const tokens = rawTokens.map((value) => {
    const rawToken = inboxV2OutboxLeaseTokenSchema.parse(value);
    return {
      rawToken,
      tokenHash: calculateInboxV2OutboxLeaseTokenHash(rawToken)
    } as const;
  });
  if (
    new Set(tokens.map(({ rawToken }) => rawToken)).size !== tokens.length ||
    new Set(tokens.map(({ tokenHash }) => tokenHash)).size !== tokens.length
  ) {
    throw invariantError(
      "Outbox token source returned duplicate capabilities."
    );
  }
  return Object.freeze(tokens);
}

function defaultLeaseTokenSource(count: number): readonly string[] {
  return Array.from({ length: count }, () =>
    randomBytes(32).toString("base64url")
  );
}

function mapClaimResult(
  input: InboxV2ClaimOutboxInput,
  tokens: readonly ClaimToken[],
  rows: readonly ClaimedOutboxWorkRow[]
): InboxV2ClaimOutboxResult {
  if (rows.length > input.batchSize) {
    throw invariantError("Outbox claim exceeded its requested batch size.");
  }
  if (rows.length === 0) {
    return inboxV2ClaimOutboxResultSchema.parse({
      outcome: "empty",
      tenantId: input.context.tenantId,
      workerId: input.workerId,
      batchSize: input.batchSize
    });
  }

  const claimed = rows
    .map((row) => ({ row, ordinal: integerValue(row.claim_ordinal) }))
    .sort((left, right) => left.ordinal - right.ordinal);
  if (
    new Set(claimed.map(({ ordinal }) => ordinal)).size !== claimed.length ||
    claimed.some(
      ({ ordinal }, index) =>
        ordinal !== index + 1 || ordinal < 1 || ordinal > input.batchSize
    )
  ) {
    throw invariantError(
      "Outbox claim rows did not preserve contiguous token ordinals."
    );
  }

  const claims = claimed.map(({ row, ordinal }) => {
    const token = tokens[ordinal - 1];
    if (token === undefined) {
      throw invariantError("Outbox claim returned an unknown token ordinal.");
    }
    const work = mapOutboxWorkRow(input.context.tenantId, undefined, row);
    if (
      work.state !== "leased" ||
      work.lease === null ||
      work.lease.workerId !== input.workerId ||
      work.lease.leaseTokenHash !== token.tokenHash
    ) {
      throw invariantError(
        "Outbox claim row is not bound to its tenant worker and token ordinal."
      );
    }
    const previousState = stringValue(
      row.previous_state,
      "outbox previous state"
    );
    if (previousState !== "pending" && previousState !== "leased") {
      throw invariantError("Outbox claim has an invalid previous state.");
    }
    return {
      claimKind: previousState === "pending" ? "initial" : "reclaimed",
      work,
      leaseToken: token.rawToken
    } as const;
  });

  return inboxV2ClaimOutboxResultSchema.parse({
    outcome: "claimed",
    tenantId: input.context.tenantId,
    workerId: input.workerId,
    batchSize: input.batchSize,
    claims
  });
}

function mapOutboxWorkRow(
  expectedTenantId: string,
  expectedIntentId: string | undefined,
  row: OutboxWorkRow
): InboxV2OutboxWorkItem {
  const tenantId = stringValue(row.tenant_id, "outbox tenant");
  const intentId = stringValue(row.intent_id, "outbox intent");
  if (
    tenantId !== expectedTenantId ||
    (expectedIntentId !== undefined && intentId !== expectedIntentId)
  ) {
    throw invariantError(
      "Outbox repository returned a row outside the requested tenant or intent."
    );
  }

  const state = stringValue(row.state, "outbox state");
  const leaseValues = [
    row.lease_owner_id,
    row.lease_token_hash,
    row.lease_revision,
    row.lease_claimed_at,
    row.lease_expires_at
  ];
  if (leaseValues.some((value) => value === undefined)) {
    throw invariantError("Outbox row omitted a persisted lease column.");
  }
  const hasLease = leaseValues.every(isPresent);
  if (hasLease !== (state === "leased") || hasMixedNullability(leaseValues)) {
    throw invariantError("Outbox row has an incoherent persisted lease group.");
  }
  const retryValues = [
    row.last_retry_result_hash,
    row.last_retry_error_code,
    row.last_retry_available_at,
    row.last_retry_recorded_at
  ];
  if (retryValues.some((value) => value === undefined)) {
    throw invariantError("Outbox row omitted a persisted retry column.");
  }
  if (hasMixedNullability(retryValues)) {
    throw invariantError("Outbox row has an incoherent retry result group.");
  }
  const terminalCoreValues = [
    row.terminal_result_hash,
    row.terminal_finalized_at
  ];
  const hasTerminal = terminalCoreValues.every(isPresent);
  if (
    hasMixedNullability(terminalCoreValues) ||
    hasTerminal !== (state === "processed" || state === "dead") ||
    (state === "processed" && row.terminal_error_code !== null) ||
    (state === "dead" && row.terminal_error_code === null) ||
    ((state === "pending" || state === "leased") &&
      (row.terminal_error_code !== null ||
        row.terminal_result_reference !== null))
  ) {
    throw invariantError("Outbox row has an incoherent terminal result group.");
  }

  timestampValue(row.created_at, "outbox createdAt");
  const availableAt = nullableTimestampValue(
    row.available_at,
    "outbox availableAt"
  );
  const lease = hasLease
    ? {
        workerId: stringValue(row.lease_owner_id, "outbox lease worker"),
        leaseTokenHash: stringValue(
          row.lease_token_hash,
          "outbox lease token hash"
        ),
        leaseRevision: bigintText(row.lease_revision),
        claimedAt: timestampValue(
          row.lease_claimed_at,
          "outbox lease claimedAt"
        ),
        expiresAt: timestampValue(
          row.lease_expires_at,
          "outbox lease expiresAt"
        )
      }
    : null;
  const lastRetryResult = retryValues.every(isPresent)
    ? {
        kind: "retry" as const,
        resultHash: stringValue(
          row.last_retry_result_hash,
          "outbox retry result hash"
        ),
        errorCode: stringValue(
          row.last_retry_error_code,
          "outbox retry error code"
        ),
        retryAvailableAt: timestampValue(
          row.last_retry_available_at,
          "outbox retry availableAt"
        ),
        recordedAt: timestampValue(
          row.last_retry_recorded_at,
          "outbox retry recordedAt"
        )
      }
    : null;
  const terminalResult = hasTerminal
    ? state === "processed"
      ? {
          kind: "processed" as const,
          resultHash: stringValue(
            row.terminal_result_hash,
            "outbox terminal result hash"
          ),
          resultReference: nullableJsonObject(
            row.terminal_result_reference,
            "outbox terminal result reference"
          ),
          finalizedAt: timestampValue(
            row.terminal_finalized_at,
            "outbox terminal finalizedAt"
          )
        }
      : {
          kind: "dead" as const,
          resultHash: stringValue(
            row.terminal_result_hash,
            "outbox terminal result hash"
          ),
          errorCode: stringValue(
            row.terminal_error_code,
            "outbox terminal error code"
          ),
          resultReference: nullableJsonObject(
            row.terminal_result_reference,
            "outbox terminal result reference"
          ),
          finalizedAt: timestampValue(
            row.terminal_finalized_at,
            "outbox terminal finalizedAt"
          )
        }
    : null;

  return inboxV2OutboxWorkItemSchema.parse({
    tenantId,
    intentId,
    state,
    attemptCount: bigintText(row.attempt_count),
    availableAt,
    lease,
    lastRetryResult,
    terminalResult,
    revision: bigintText(row.revision),
    updatedAt: timestampValue(row.updated_at, "outbox updatedAt")
  });
}

function outboxWorkSelectColumns(
  alias: string,
  terminalPayloadAlias?: string
): SQL {
  return outboxWorkColumns(alias, terminalPayloadAlias);
}

function outboxWorkReturningColumns(alias: string): SQL {
  return outboxWorkColumns(alias);
}

function outboxWorkColumns(alias: string, terminalPayloadAlias?: string): SQL {
  if (alias !== "work") {
    throw invariantError("Unsupported outbox SQL alias.");
  }
  if (
    terminalPayloadAlias !== undefined &&
    terminalPayloadAlias !== "terminal_payload"
  ) {
    throw invariantError("Unsupported terminal payload SQL alias.");
  }
  const terminalReference =
    terminalPayloadAlias === undefined
      ? "null::jsonb"
      : `${terminalPayloadAlias}.result_reference`;
  return sql.raw(`
    work.tenant_id,
    work.intent_id,
    work.state::text as state,
    work.attempt_count::text as attempt_count,
    work.available_at,
    work.lease_owner_id,
    work.lease_token_hash,
    work.lease_revision::text as lease_revision,
    work.lease_claimed_at,
    work.lease_expires_at,
    work.last_retry_result_hash,
    work.last_retry_error_code,
    work.last_retry_available_at,
    work.last_retry_recorded_at,
    work.terminal_result_hash,
    work.terminal_error_code,
    ${terminalReference} as terminal_result_reference,
    work.terminal_finalized_at,
    work.revision::text as revision,
    work.created_at,
    work.updated_at
  `);
}

function nullableJsonObject(
  value: unknown,
  label: string
): Record<string, unknown> | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw invariantError(`${label} must be a JSON object or null.`);
  }
  return value as Record<string, unknown>;
}

function nullableTimestampValue(value: unknown, label: string): string | null {
  return value === null ? null : timestampValue(value, label);
}

function timestampValue(value: unknown, label: string): string {
  const timestamp =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (timestamp === null || Number.isNaN(timestamp.getTime())) {
    throw invariantError(`${label} must be a timestamp.`);
  }
  return inboxV2TimestampSchema.parse(timestamp.toISOString());
}

function bigintText(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string") return value;
  throw invariantError("Outbox bigint value is invalid.");
}

function incrementBigint(value: string, label: string): string {
  const next = (BigInt(value) + 1n).toString();
  const parsed = inboxV2EntityRevisionSchema.safeParse(next);
  if (!parsed.success) throw invariantError(`${label} overflowed.`);
  return parsed.data;
}

function integerValue(value: unknown): number {
  const result =
    typeof value === "number"
      ? value
      : typeof value === "bigint" || typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(result)) {
    throw invariantError("Outbox claim ordinal is invalid.");
  }
  return result;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw invariantError(`${label} must be a boolean.`);
  }
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw invariantError(`${label} must be a string.`);
  }
  return value;
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function hasMixedNullability(values: readonly unknown[]): boolean {
  return values.some(isPresent) && !values.every(isPresent);
}

function exactlyOneRow<Row>(rows: readonly Row[], label: string): Row {
  if (rows.length !== 1) {
    throw invariantError(`${label} must return exactly one row.`);
  }
  return rows[0]!;
}

function invariantError(
  message: string
): InboxV2RepositoryOutboxPersistenceInvariantError {
  return new InboxV2RepositoryOutboxPersistenceInvariantError(message);
}
