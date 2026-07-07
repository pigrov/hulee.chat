import type {
  ChannelConnectorId,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type ChannelSessionStatus =
  | "not_started"
  | "pending_auth"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "revoked"
  | "error"
  | (string & {});

export type ChannelSessionEventSeverity =
  | "info"
  | "warning"
  | "error"
  | (string & {});

export type ChannelSessionRecord = {
  id: string;
  tenantId: TenantId;
  connectorId: ChannelConnectorId;
  sessionKey: string;
  status: ChannelSessionStatus;
  sessionEncrypted: string | null;
  sessionFingerprint: string | null;
  externalAccountId: string | null;
  displayAddress: string | null;
  publicState: unknown;
  metadata: unknown;
  challengeType: string | null;
  challengeExpiresAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastHeartbeatAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: PlatformErrorCode | (string & {}) | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ChannelSessionEventRecord = {
  id: string;
  tenantId: TenantId;
  connectorId: ChannelConnectorId;
  sessionId: string;
  eventType: string;
  severity: ChannelSessionEventSeverity;
  code: string | null;
  message: string | null;
  metadata: unknown;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type FindChannelSessionInput = {
  tenantId: TenantId;
  sessionId: string;
};

export type FindConnectorChannelSessionInput = {
  tenantId: TenantId;
  connectorId: ChannelConnectorId | string;
  sessionKey: string;
};

export type ListRunnableChannelSessionsInput = {
  status: ChannelSessionStatus | string;
  limit?: number;
};

export type UpsertChannelSessionInput = {
  id: string;
  tenantId: TenantId;
  connectorId: ChannelConnectorId | string;
  sessionKey: string;
  status: ChannelSessionStatus | string;
  sessionEncrypted?: string | null;
  sessionFingerprint?: string | null;
  externalAccountId?: string | null;
  displayAddress?: string | null;
  publicState?: unknown;
  metadata?: unknown;
  challengeType?: string | null;
  challengeExpiresAt?: Date | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: Date | null;
  lastConnectedAt?: Date | null;
  lastDisconnectedAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
  lastErrorAt?: Date | null;
  lastErrorCode?: PlatformErrorCode | string | null;
  lastErrorMessage?: string | null;
  updatedAt: Date;
};

export type ClaimChannelSessionLeaseInput = {
  tenantId: TenantId;
  sessionId: string;
  leaseOwner: string;
  leaseExpiresAt: Date;
  now: Date;
};

export type ReleaseChannelSessionLeaseInput = {
  tenantId: TenantId;
  sessionId: string;
  leaseOwner: string;
  updatedAt: Date;
};

export type AppendChannelSessionEventInput = {
  id: string;
  tenantId: TenantId;
  connectorId: ChannelConnectorId | string;
  sessionId: string;
  eventType: string;
  severity?: ChannelSessionEventSeverity | string;
  code?: string | null;
  message?: string | null;
  metadata?: unknown;
  occurredAt: Date;
  updatedAt: Date;
};

export type ListChannelSessionEventsInput = {
  tenantId: TenantId;
  sessionId: string;
  limit?: number;
};

export type ChannelSessionRepository = {
  findSession(
    input: FindChannelSessionInput
  ): Promise<ChannelSessionRecord | null>;
  findConnectorSession(
    input: FindConnectorChannelSessionInput
  ): Promise<ChannelSessionRecord | null>;
  listRunnableSessions(
    input: ListRunnableChannelSessionsInput
  ): Promise<ChannelSessionRecord[]>;
  upsertSession(input: UpsertChannelSessionInput): Promise<void>;
  claimSessionLease(
    input: ClaimChannelSessionLeaseInput
  ): Promise<ChannelSessionRecord | null>;
  releaseSessionLease(input: ReleaseChannelSessionLeaseInput): Promise<void>;
  appendSessionEvent(input: AppendChannelSessionEventInput): Promise<void>;
  listSessionEvents(
    input: ListChannelSessionEventsInput
  ): Promise<ChannelSessionEventRecord[]>;
};

type ChannelSessionRow = {
  id: string;
  tenant_id: string;
  connector_id: string;
  session_key: string;
  status: string;
  session_encrypted: string | null;
  session_fingerprint: string | null;
  external_account_id: string | null;
  display_address: string | null;
  public_state: unknown;
  metadata: unknown;
  challenge_type: string | null;
  challenge_expires_at: Date | string | null;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  last_connected_at: Date | string | null;
  last_disconnected_at: Date | string | null;
  last_heartbeat_at: Date | string | null;
  last_inbound_at: Date | string | null;
  last_outbound_at: Date | string | null;
  last_error_at: Date | string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ChannelSessionEventRow = {
  id: string;
  tenant_id: string;
  connector_id: string;
  session_id: string;
  event_type: string;
  severity: string;
  code: string | null;
  message: string | null;
  metadata: unknown;
  occurred_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

export function createSqlChannelSessionRepository(
  executor: RawSqlExecutor | HuleeDatabase
): ChannelSessionRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findSession(input) {
      const result = await rawExecutor.execute<ChannelSessionRow>(
        buildFindChannelSessionSql(input)
      );

      return result.rows[0] ? mapChannelSessionRow(result.rows[0]) : null;
    },

    async findConnectorSession(input) {
      const result = await rawExecutor.execute<ChannelSessionRow>(
        buildFindConnectorChannelSessionSql(input)
      );

      return result.rows[0] ? mapChannelSessionRow(result.rows[0]) : null;
    },

    async listRunnableSessions(input) {
      const result = await rawExecutor.execute<ChannelSessionRow>(
        buildListRunnableChannelSessionsSql(input)
      );

      return result.rows.map(mapChannelSessionRow);
    },

    async upsertSession(input) {
      await rawExecutor.execute(buildUpsertChannelSessionSql(input));
    },

    async claimSessionLease(input) {
      const result = await rawExecutor.execute<ChannelSessionRow>(
        buildClaimChannelSessionLeaseSql(input)
      );

      return result.rows[0] ? mapChannelSessionRow(result.rows[0]) : null;
    },

    async releaseSessionLease(input) {
      await rawExecutor.execute(buildReleaseChannelSessionLeaseSql(input));
    },

    async appendSessionEvent(input) {
      await rawExecutor.execute(buildAppendChannelSessionEventSql(input));
    },

    async listSessionEvents(input) {
      const result = await rawExecutor.execute<ChannelSessionEventRow>(
        buildListChannelSessionEventsSql(input)
      );

      return result.rows.map(mapChannelSessionEventRow);
    }
  };
}

export function buildFindChannelSessionSql(
  input: FindChannelSessionInput
): SQL {
  return sql`
    select ${channelSessionSelectList}
    from channel_sessions
    where tenant_id = ${input.tenantId}
      and id = ${input.sessionId}
    limit 1
  `;
}

export function buildFindConnectorChannelSessionSql(
  input: FindConnectorChannelSessionInput
): SQL {
  return sql`
    select ${channelSessionSelectList}
    from channel_sessions
    where tenant_id = ${input.tenantId}
      and connector_id = ${input.connectorId}
      and session_key = ${input.sessionKey}
    limit 1
  `;
}

export function buildListRunnableChannelSessionsSql(
  input: ListRunnableChannelSessionsInput
): SQL {
  return sql`
    select ${channelSessionSelectList}
    from channel_sessions
    where status = ${input.status}
      and (lease_expires_at is null or lease_expires_at <= now())
    order by updated_at asc, id asc
    limit ${input.limit ?? 100}
  `;
}

export function buildUpsertChannelSessionSql(
  input: UpsertChannelSessionInput
): SQL {
  return sql`
    insert into channel_sessions (
      id,
      tenant_id,
      connector_id,
      session_key,
      status,
      session_encrypted,
      session_fingerprint,
      external_account_id,
      display_address,
      public_state,
      metadata,
      challenge_type,
      challenge_expires_at,
      lease_owner,
      lease_expires_at,
      last_connected_at,
      last_disconnected_at,
      last_heartbeat_at,
      last_inbound_at,
      last_outbound_at,
      last_error_at,
      last_error_code,
      last_error_message,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.tenantId},
      ${input.connectorId},
      ${input.sessionKey},
      ${input.status},
      ${input.sessionEncrypted ?? null},
      ${input.sessionFingerprint ?? null},
      ${input.externalAccountId ?? null},
      ${input.displayAddress ?? null},
      ${JSON.stringify(input.publicState ?? {})}::jsonb,
      ${JSON.stringify(input.metadata ?? {})}::jsonb,
      ${input.challengeType ?? null},
      ${input.challengeExpiresAt ?? null},
      ${input.leaseOwner ?? null},
      ${input.leaseExpiresAt ?? null},
      ${input.lastConnectedAt ?? null},
      ${input.lastDisconnectedAt ?? null},
      ${input.lastHeartbeatAt ?? null},
      ${input.lastInboundAt ?? null},
      ${input.lastOutboundAt ?? null},
      ${input.lastErrorAt ?? null},
      ${input.lastErrorCode ?? null},
      ${input.lastErrorMessage ?? null},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (tenant_id, connector_id, session_key) do update
    set status = excluded.status,
        session_encrypted = excluded.session_encrypted,
        session_fingerprint = excluded.session_fingerprint,
        external_account_id = excluded.external_account_id,
        display_address = excluded.display_address,
        public_state = excluded.public_state,
        metadata = excluded.metadata,
        challenge_type = excluded.challenge_type,
        challenge_expires_at = excluded.challenge_expires_at,
        lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at,
        last_connected_at = excluded.last_connected_at,
        last_disconnected_at = excluded.last_disconnected_at,
        last_heartbeat_at = excluded.last_heartbeat_at,
        last_inbound_at = excluded.last_inbound_at,
        last_outbound_at = excluded.last_outbound_at,
        last_error_at = excluded.last_error_at,
        last_error_code = excluded.last_error_code,
        last_error_message = excluded.last_error_message,
        updated_at = excluded.updated_at
  `;
}

export function buildClaimChannelSessionLeaseSql(
  input: ClaimChannelSessionLeaseInput
): SQL {
  return sql`
    update channel_sessions
    set lease_owner = ${input.leaseOwner},
        lease_expires_at = ${input.leaseExpiresAt},
        last_heartbeat_at = ${input.now},
        updated_at = ${input.now}
    where tenant_id = ${input.tenantId}
      and id = ${input.sessionId}
      and (
        lease_owner is null
        or lease_owner = ${input.leaseOwner}
        or lease_expires_at is null
        or lease_expires_at <= ${input.now}
      )
    returning ${channelSessionSelectList}
  `;
}

export function buildReleaseChannelSessionLeaseSql(
  input: ReleaseChannelSessionLeaseInput
): SQL {
  return sql`
    update channel_sessions
    set lease_owner = null,
        lease_expires_at = null,
        updated_at = ${input.updatedAt}
    where tenant_id = ${input.tenantId}
      and id = ${input.sessionId}
      and lease_owner = ${input.leaseOwner}
  `;
}

export function buildAppendChannelSessionEventSql(
  input: AppendChannelSessionEventInput
): SQL {
  return sql`
    insert into channel_session_events (
      id,
      tenant_id,
      connector_id,
      session_id,
      event_type,
      severity,
      code,
      message,
      metadata,
      occurred_at,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.tenantId},
      ${input.connectorId},
      ${input.sessionId},
      ${input.eventType},
      ${input.severity ?? "info"},
      ${input.code ?? null},
      ${input.message ?? null},
      ${JSON.stringify(input.metadata ?? {})}::jsonb,
      ${input.occurredAt},
      ${input.updatedAt},
      ${input.updatedAt}
    )
  `;
}

export function buildListChannelSessionEventsSql(
  input: ListChannelSessionEventsInput
): SQL {
  return sql`
    select ${channelSessionEventSelectList}
    from channel_session_events
    where tenant_id = ${input.tenantId}
      and session_id = ${input.sessionId}
    order by occurred_at desc, id desc
    limit ${input.limit ?? 50}
  `;
}

const channelSessionSelectList = sql`
  id,
  tenant_id,
  connector_id,
  session_key,
  status,
  session_encrypted,
  session_fingerprint,
  external_account_id,
  display_address,
  public_state,
  metadata,
  challenge_type,
  challenge_expires_at,
  lease_owner,
  lease_expires_at,
  last_connected_at,
  last_disconnected_at,
  last_heartbeat_at,
  last_inbound_at,
  last_outbound_at,
  last_error_at,
  last_error_code,
  last_error_message,
  created_at,
  updated_at
`;

const channelSessionEventSelectList = sql`
  id,
  tenant_id,
  connector_id,
  session_id,
  event_type,
  severity,
  code,
  message,
  metadata,
  occurred_at,
  created_at,
  updated_at
`;

function mapChannelSessionRow(row: ChannelSessionRow): ChannelSessionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    connectorId: row.connector_id as ChannelConnectorId,
    sessionKey: row.session_key,
    status: row.status,
    sessionEncrypted: row.session_encrypted,
    sessionFingerprint: row.session_fingerprint,
    externalAccountId: row.external_account_id,
    displayAddress: row.display_address,
    publicState: row.public_state,
    metadata: row.metadata,
    challengeType: row.challenge_type,
    challengeExpiresAt: toNullableDate(row.challenge_expires_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: toNullableDate(row.lease_expires_at),
    lastConnectedAt: toNullableDate(row.last_connected_at),
    lastDisconnectedAt: toNullableDate(row.last_disconnected_at),
    lastHeartbeatAt: toNullableDate(row.last_heartbeat_at),
    lastInboundAt: toNullableDate(row.last_inbound_at),
    lastOutboundAt: toNullableDate(row.last_outbound_at),
    lastErrorAt: toNullableDate(row.last_error_at),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at)
  };
}

function mapChannelSessionEventRow(
  row: ChannelSessionEventRow
): ChannelSessionEventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    connectorId: row.connector_id as ChannelConnectorId,
    sessionId: row.session_id,
    eventType: row.event_type,
    severity: row.severity,
    code: row.code,
    message: row.message,
    metadata: row.metadata,
    occurredAt: toDate(row.occurred_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at)
  };
}

function toNullableDate(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
