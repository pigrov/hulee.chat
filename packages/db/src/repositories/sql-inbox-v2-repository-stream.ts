import {
  inboxV2LoadTenantStreamSnapshotInputSchema,
  inboxV2LoadTenantStreamSnapshotResultSchema,
  inboxV2ReplayTenantStreamInputSchema,
  inboxV2ReplayTenantStreamResultSchema,
  inboxV2TenantStreamChangeSchema,
  inboxV2TenantStreamCommitSchema,
  inboxV2TenantStreamReplayCommitSchema,
  inboxV2TenantStreamSnapshotSchema,
  type InboxV2ReplayTenantStreamInput,
  type InboxV2ReplayTenantStreamResult,
  type InboxV2TenantStreamChange,
  type InboxV2TenantStreamCommit,
  type InboxV2TenantStreamReplayCommit,
  type InboxV2TenantStreamRepositoryPort,
  type InboxV2TenantStreamSnapshot
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

export const INBOX_V2_STREAM_SNAPSHOT_TRANSACTION_CONFIG = {
  isolationLevel: "repeatable read",
  accessMode: "read only"
} as const;

export type InboxV2TenantStreamTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{
      isolationLevel: "repeatable read";
      accessMode: "read only";
    }>
  ): Promise<TResult>;
};

type TenantStreamHeadRow = Readonly<{
  tenant_id: unknown;
  stream_epoch: unknown;
  last_position: unknown;
  min_retained_position: unknown;
  captured_at: unknown;
}>;

type TenantStreamCommitRow = Readonly<{
  tenant_id: unknown;
  id: unknown;
  stream_epoch: unknown;
  position: unknown;
  previous_position: unknown;
  schema_version: unknown;
  correlation_id: unknown;
  command_ids: unknown;
  client_mutation_ids: unknown;
  authorization_decision_refs: unknown;
  change_ids: unknown;
  event_ids: unknown;
  outbox_intent_ids: unknown;
  audience_impact_kind: unknown;
  audience_impact_manifest: unknown;
  change_count: unknown;
  event_count: unknown;
  outbox_intent_count: unknown;
  committed_at: unknown;
  commit_hash: unknown;
}>;

type TenantStreamChangeRow = Readonly<{
  tenant_id: unknown;
  id: unknown;
  stream_commit_id: unknown;
  stream_position: unknown;
  ordinal: unknown;
  entity_type_id: unknown;
  entity_id: unknown;
  resulting_revision: unknown;
  timeline: unknown;
  audience: unknown;
  state_kind: unknown;
  state_schema_id: unknown;
  state_schema_version: unknown;
  state_reason_id: unknown;
  state_hash: unknown;
  payload_reference: unknown;
  domain_commit_reference: unknown;
}>;

export function createSqlInboxV2TenantStreamRepository(
  executor: InboxV2TenantStreamTransactionExecutor | HuleeDatabase
): InboxV2TenantStreamRepositoryPort {
  const transactionExecutor =
    executor as unknown as InboxV2TenantStreamTransactionExecutor;

  return {
    async loadSnapshot(input) {
      const normalized =
        inboxV2LoadTenantStreamSnapshotInputSchema.parse(input);

      return transactionExecutor.transaction(async (transaction) => {
        const head = singleRow(
          await transaction.execute<TenantStreamHeadRow>(
            buildLoadInboxV2TenantStreamSnapshotSql(normalized.context.tenantId)
          ),
          "Tenant stream snapshot head"
        );
        if (head === null) {
          return inboxV2LoadTenantStreamSnapshotResultSchema.parse({
            outcome: "not_found",
            tenantId: normalized.context.tenantId
          });
        }

        const snapshot = mapTenantStreamSnapshot(
          head,
          normalized.context.tenantId
        );
        return inboxV2LoadTenantStreamSnapshotResultSchema.parse({
          outcome: "found",
          tenantId: normalized.context.tenantId,
          snapshot
        });
      }, INBOX_V2_STREAM_SNAPSHOT_TRANSACTION_CONFIG);
    },

    async replayBounded(input) {
      const normalized = inboxV2ReplayTenantStreamInputSchema.parse(input);

      return transactionExecutor.transaction(
        (transaction) => replayInSnapshot(transaction, normalized),
        INBOX_V2_STREAM_SNAPSHOT_TRANSACTION_CONFIG
      );
    }
  };
}

async function replayInSnapshot(
  transaction: RawSqlExecutor,
  input: InboxV2ReplayTenantStreamInput
): Promise<InboxV2ReplayTenantStreamResult> {
  const tenantId = input.context.tenantId;
  const head = singleRow(
    await transaction.execute<TenantStreamHeadRow>(
      buildLoadInboxV2TenantStreamSnapshotSql(tenantId)
    ),
    "Tenant stream replay head"
  );
  if (head === null) {
    return parseReplayResult({ outcome: "not_found", tenantId });
  }

  const snapshot = mapTenantStreamSnapshot(head, tenantId);
  if (snapshot.streamEpoch !== input.streamEpoch) {
    return parseReplayResult({
      outcome: "epoch_mismatch",
      tenantId,
      currentStreamEpoch: snapshot.streamEpoch
    });
  }

  const after = BigInt(input.afterPosition);
  const minimum = BigInt(snapshot.minRetainedPosition);
  const capturedHead = BigInt(snapshot.lastPosition);
  const earliestResumeCursor = minimum > 0n ? minimum - 1n : 0n;
  if (after < earliestResumeCursor) {
    return parseReplayResult({
      outcome: "cursor_expired",
      tenantId,
      minRetainedPosition: snapshot.minRetainedPosition
    });
  }
  if (after > capturedHead) {
    return parseReplayResult({
      outcome: "cursor_future",
      tenantId,
      lastPosition: snapshot.lastPosition
    });
  }

  const through = minBigint(BigInt(input.throughPosition), capturedHead);
  if (after === through) {
    return parseReplayPage({
      input,
      snapshot,
      through,
      commits: []
    });
  }

  const commitRows = (
    await transaction.execute<TenantStreamCommitRow>(
      buildListInboxV2TenantStreamCommitsSql({
        tenantId,
        streamEpoch: input.streamEpoch,
        afterPosition: input.afterPosition,
        throughPosition: String(through),
        limit: input.limit
      })
    )
  ).rows;
  if (commitRows.length > input.limit + 1) {
    throw invariant("Tenant stream commit page exceeded its SQL limit.");
  }

  const mappedRows = commitRows.map((row) => ({
    row,
    commit: mapTenantStreamCommit(row, tenantId, input.streamEpoch)
  }));
  assertUniqueStrings(
    mappedRows.map(({ commit }) => commit.id),
    "Tenant stream commit IDs"
  );
  let expectedPosition = after + 1n;
  for (const mapped of mappedRows) {
    const observedPosition = BigInt(mapped.commit.position);
    if (observedPosition > expectedPosition) {
      return parseReplayResult({
        outcome: "gap_detected",
        tenantId,
        expectedPosition: String(expectedPosition),
        observedPosition: mapped.commit.position
      });
    }
    if (observedPosition < expectedPosition) {
      throw invariant(
        "Tenant stream commit query returned a duplicate or backwards position."
      );
    }
    if (
      BigInt(parseBigint(mapped.row.previous_position, "previous position")) !==
      observedPosition - 1n
    ) {
      throw invariant(
        "Tenant stream commit previous position is not contiguous."
      );
    }
    expectedPosition += 1n;
  }

  const selected = mappedRows.slice(0, input.limit);
  const finalObserved =
    mappedRows.length === 0
      ? after
      : BigInt(mappedRows[mappedRows.length - 1]!.commit.position);
  if (mappedRows.length <= input.limit && finalObserved < through) {
    throw invariant(
      "Tenant stream head advertises a committed position that replay cannot read."
    );
  }

  const selectedCommitIds = selected.map(({ commit }) => commit.id);
  const changeRows =
    selectedCommitIds.length === 0
      ? []
      : (
          await transaction.execute<TenantStreamChangeRow>(
            buildListInboxV2TenantStreamChangesSql({
              tenantId,
              streamEpoch: input.streamEpoch,
              commitIds: selectedCommitIds
            })
          )
        ).rows;
  const changesByCommit = mapChangesByCommit({
    rows: changeRows,
    tenantId,
    selected
  });
  const commits = selected.map(({ commit }) =>
    inboxV2TenantStreamReplayCommitSchema.parse({
      commit,
      changes: changesByCommit.get(commit.id) ?? []
    })
  );

  return parseReplayPage({ input, snapshot, through, commits });
}

export function buildLoadInboxV2TenantStreamSnapshotSql(tenantId: string): SQL {
  return sql`
    select tenant_id,
           stream_epoch,
           last_position::text as last_position,
           min_retained_position::text as min_retained_position,
           transaction_timestamp() as captured_at
    from inbox_v2_tenant_stream_heads
    where tenant_id = ${tenantId}
  `;
}

export function buildListInboxV2TenantStreamCommitsSql(input: {
  tenantId: string;
  streamEpoch: string;
  afterPosition: string;
  throughPosition: string;
  limit: number;
}): SQL {
  return sql`
    select tenant_id,
           id,
           stream_epoch,
           position::text as position,
           previous_position::text as previous_position,
           schema_version,
           correlation_id,
           command_ids,
           client_mutation_ids,
           authorization_decision_refs,
           change_ids,
           event_ids,
           outbox_intent_ids,
           audience_impact_kind,
           audience_impact_manifest,
           change_count::text as change_count,
           event_count::text as event_count,
           outbox_intent_count::text as outbox_intent_count,
           committed_at,
           commit_hash
    from inbox_v2_tenant_stream_commits
    where tenant_id = ${input.tenantId}
      and stream_epoch = ${input.streamEpoch}
      and (tenant_id, stream_epoch, position) >
        (${input.tenantId}, ${input.streamEpoch}, ${input.afterPosition}::bigint)
      and (tenant_id, stream_epoch, position) <=
        (${input.tenantId}, ${input.streamEpoch}, ${input.throughPosition}::bigint)
    order by tenant_id, stream_epoch, position
    limit ${input.limit + 1}
  `;
}

export function buildListInboxV2TenantStreamChangesSql(input: {
  tenantId: string;
  streamEpoch: string;
  commitIds: readonly string[];
}): SQL {
  if (input.commitIds.length === 0) {
    throw new TypeError("Tenant stream change query requires commit IDs.");
  }
  const commitIds = sql.join(
    input.commitIds.map((commitId) => sql`${commitId}`),
    sql`, `
  );

  return sql`
    select change_row.tenant_id,
           change_row.id,
           change_row.stream_commit_id,
           change_row.stream_position::text as stream_position,
           change_row.ordinal::text as ordinal,
           change_row.entity_type_id,
           change_row.entity_id,
           change_row.resulting_revision::text as resulting_revision,
           change_row.timeline,
           change_row.audience,
           change_row.state_kind,
           change_row.state_schema_id,
           change_row.state_schema_version,
           change_row.state_reason_id,
           change_row.state_hash,
           change_row.payload_reference,
           change_row.domain_commit_reference
    from inbox_v2_tenant_stream_changes change_row
    join inbox_v2_tenant_stream_commits commit_row
      on commit_row.tenant_id = change_row.tenant_id
     and commit_row.id = change_row.stream_commit_id
     and commit_row.position = change_row.stream_position
    where change_row.tenant_id = ${input.tenantId}
      and commit_row.stream_epoch = ${input.streamEpoch}
      and change_row.stream_commit_id in (${commitIds})
    order by change_row.tenant_id,
             commit_row.stream_epoch,
             change_row.stream_position,
             change_row.ordinal
  `;
}

function mapTenantStreamSnapshot(
  row: TenantStreamHeadRow,
  expectedTenantId: string
): InboxV2TenantStreamSnapshot {
  assertExpectedTenant(row.tenant_id, expectedTenantId, "stream head");
  return inboxV2TenantStreamSnapshotSchema.parse({
    tenantId: expectedTenantId,
    streamEpoch: requireString(row.stream_epoch, "stream epoch"),
    lastPosition: parseBigint(row.last_position, "stream head position"),
    minRetainedPosition: parseBigint(
      row.min_retained_position,
      "minimum retained position"
    ),
    capturedAt: parseTimestamp(row.captured_at, "stream snapshot time")
  });
}

function mapTenantStreamCommit(
  row: TenantStreamCommitRow,
  expectedTenantId: string,
  expectedStreamEpoch: string
): InboxV2TenantStreamCommit {
  assertExpectedTenant(row.tenant_id, expectedTenantId, "stream commit");
  if (row.stream_epoch !== expectedStreamEpoch) {
    throw invariant("Tenant stream commit escaped the requested epoch.");
  }
  if (
    !isRecord(row.audience_impact_manifest) ||
    row.audience_impact_manifest.kind !== row.audience_impact_kind
  ) {
    throw invariant("Tenant stream audience impact columns disagree.");
  }
  assertManifestCount(row.change_ids, row.change_count, "change");
  assertManifestCount(row.event_ids, row.event_count, "event");
  assertManifestCount(
    row.outbox_intent_ids,
    row.outbox_intent_count,
    "outbox intent"
  );

  return inboxV2TenantStreamCommitSchema.parse({
    tenantId: expectedTenantId,
    streamEpoch: expectedStreamEpoch,
    id: requireString(row.id, "stream commit ID"),
    position: parseBigint(row.position, "stream commit position"),
    schemaVersion: requireString(row.schema_version, "stream schema version"),
    correlationId: requireString(row.correlation_id, "correlation ID"),
    commandIds: row.command_ids,
    clientMutationIds: row.client_mutation_ids,
    authorizationDecisionRefs: row.authorization_decision_refs,
    changeIds: row.change_ids,
    eventIds: row.event_ids,
    outboxIntentIds: row.outbox_intent_ids,
    audienceImpact: row.audience_impact_manifest,
    committedAt: parseTimestamp(row.committed_at, "stream commit time"),
    commitHash: requireString(row.commit_hash, "stream commit hash")
  });
}

function mapTenantStreamChange(
  row: TenantStreamChangeRow,
  expectedTenantId: string
): InboxV2TenantStreamChange {
  assertExpectedTenant(row.tenant_id, expectedTenantId, "stream change");
  const stateKind = requireString(row.state_kind, "change state kind");
  const state =
    stateKind === "upsert"
      ? mapUpsertState(row)
      : stateKind === "tombstone"
        ? mapTombstoneState(row)
        : (() => {
            throw invariant("Tenant stream change has an unknown state kind.");
          })();

  return inboxV2TenantStreamChangeSchema.parse({
    reference: {
      tenantId: expectedTenantId,
      commitId: requireString(row.stream_commit_id, "change commit ID"),
      streamPosition: parseBigint(row.stream_position, "change position"),
      changeId: requireString(row.id, "change ID"),
      ordinal: parseBigint(row.ordinal, "change ordinal")
    },
    entity: {
      tenantId: expectedTenantId,
      entityTypeId: requireString(row.entity_type_id, "entity type ID"),
      entityId: requireString(row.entity_id, "entity ID")
    },
    resultingRevision: parseBigint(
      row.resulting_revision,
      "resulting entity revision"
    ),
    timeline: row.timeline,
    audience: row.audience,
    state
  });
}

function mapUpsertState(row: TenantStreamChangeRow): Readonly<{
  kind: "upsert";
  stateSchemaId: string;
  stateSchemaVersion: string;
  stateHash: string;
  payloadReference: unknown;
  domainCommitReference: unknown;
}> {
  if (row.state_reason_id !== null || row.payload_reference === null) {
    throw invariant("Upsert stream change has incoherent state columns.");
  }
  return {
    kind: "upsert",
    stateSchemaId: requireString(row.state_schema_id, "state schema ID"),
    stateSchemaVersion: requireString(
      row.state_schema_version,
      "state schema version"
    ),
    stateHash: requireString(row.state_hash, "state hash"),
    payloadReference: row.payload_reference,
    domainCommitReference: row.domain_commit_reference
  };
}

function mapTombstoneState(row: TenantStreamChangeRow): Readonly<{
  kind: "tombstone";
  reasonId: string;
  stateHash: string;
  domainCommitReference: unknown;
}> {
  if (
    row.state_schema_id !== null ||
    row.state_schema_version !== null ||
    row.payload_reference !== null
  ) {
    throw invariant("Tombstone stream change has incoherent state columns.");
  }
  return {
    kind: "tombstone",
    reasonId: requireString(row.state_reason_id, "tombstone reason ID"),
    stateHash: requireString(row.state_hash, "state hash"),
    domainCommitReference: row.domain_commit_reference
  };
}

function mapChangesByCommit(input: {
  rows: readonly TenantStreamChangeRow[];
  tenantId: string;
  selected: readonly Readonly<{ commit: InboxV2TenantStreamCommit }>[];
}): ReadonlyMap<string, readonly InboxV2TenantStreamChange[]> {
  const selected = new Map(
    input.selected.map(({ commit }) => [commit.id, commit])
  );
  const changes = new Map<string, InboxV2TenantStreamChange[]>();

  for (const row of input.rows) {
    const change = mapTenantStreamChange(row, input.tenantId);
    const commit = selected.get(change.reference.commitId);
    if (
      commit === undefined ||
      commit.position !== change.reference.streamPosition
    ) {
      throw invariant("Tenant stream change escaped its selected commit.");
    }
    const owned = changes.get(commit.id) ?? [];
    owned.push(change);
    changes.set(commit.id, owned);
  }

  return changes;
}

function parseReplayPage(input: {
  input: InboxV2ReplayTenantStreamInput;
  snapshot: InboxV2TenantStreamSnapshot;
  through: bigint;
  commits: readonly InboxV2TenantStreamReplayCommit[];
}): InboxV2ReplayTenantStreamResult {
  const scannedThrough =
    input.commits.length === 0
      ? input.input.afterPosition
      : input.commits[input.commits.length - 1]!.commit.position;
  const hasMore = BigInt(scannedThrough) < input.through;
  return parseReplayResult({
    outcome: "page",
    page: {
      tenantId: input.input.context.tenantId,
      streamEpoch: input.input.streamEpoch,
      snapshotPosition: input.snapshot.lastPosition,
      minRetainedPosition: input.snapshot.minRetainedPosition,
      fromExclusive: input.input.afterPosition,
      throughInclusive: String(input.through),
      scannedThrough,
      limit: input.input.limit,
      commits: input.commits,
      hasMore,
      nextAfterPosition: hasMore ? scannedThrough : null
    }
  });
}

function parseReplayResult(input: unknown): InboxV2ReplayTenantStreamResult {
  return inboxV2ReplayTenantStreamResultSchema.parse(input);
}

function assertManifestCount(
  manifest: unknown,
  count: unknown,
  label: string
): void {
  if (
    !Array.isArray(manifest) ||
    BigInt(parseBigint(count, `${label} count`)) !== BigInt(manifest.length)
  ) {
    throw invariant(`Tenant stream ${label} manifest count disagrees.`);
  }
}

function assertUniqueStrings(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw invariant(`${label} must be unique inside one replay page.`);
  }
}

function assertExpectedTenant(
  value: unknown,
  expectedTenantId: string,
  label: string
): void {
  if (value !== expectedTenantId) {
    throw invariant(`Tenant-scoped ${label} returned a different tenant.`);
  }
}

function parseBigint(value: unknown, label: string): string {
  if (typeof value === "number") {
    throw invariant(`${label} was decoded as an unsafe JavaScript number.`);
  }
  try {
    return String(BigInt(requireString(value, label)));
  } catch (error) {
    if (error instanceof InboxV2PersistenceInvariantError) throw error;
    throw invariant(`${label} is not a PostgreSQL bigint.`);
  }
}

function parseTimestamp(value: unknown, label: string): string {
  const candidate = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(candidate.getTime())) {
    throw invariant(`${label} is not a timestamp.`);
  }
  return candidate.toISOString();
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariant(`${label} is not a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function singleRow<TRow>(
  result: RawSqlQueryResult<TRow>,
  label: string
): TRow | null {
  if (result.rows.length > 1) {
    throw invariant(`${label} returned more than one row.`);
  }
  return result.rows[0] ?? null;
}

function minBigint(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function invariant(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
