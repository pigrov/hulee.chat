import type {
  ChannelConnectorId,
  EmployeeId,
  InternalChannelAuthChallengeStatus,
  InternalChannelAuthChallengeType,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type ChannelAuthChallengeRecord = {
  id: string;
  tenantId: TenantId;
  connectorId: ChannelConnectorId;
  challengeType: InternalChannelAuthChallengeType | (string & {});
  status: InternalChannelAuthChallengeStatus | (string & {});
  publicPayload: unknown;
  secretPayloadEncrypted: string | null;
  errorCode: PlatformErrorCode | (string & {}) | null;
  errorMessage: string | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  createdByEmployeeId: EmployeeId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FindChannelAuthChallengeInput = {
  tenantId: TenantId;
  challengeId: string;
};

export type FindLatestActiveChannelAuthChallengeInput = {
  tenantId: TenantId;
  connectorId: ChannelConnectorId | string;
  challengeType?: InternalChannelAuthChallengeType | string;
};

export type ListActiveChannelAuthChallengesInput = {
  statuses?: readonly (InternalChannelAuthChallengeStatus | string)[];
  limit?: number;
  now?: Date;
};

export type UpsertChannelAuthChallengeInput = {
  id: string;
  tenantId: TenantId;
  connectorId: ChannelConnectorId | string;
  challengeType: InternalChannelAuthChallengeType | string;
  status: InternalChannelAuthChallengeStatus | string;
  publicPayload?: unknown;
  secretPayloadEncrypted?: string | null;
  errorCode?: PlatformErrorCode | string | null;
  errorMessage?: string | null;
  expiresAt?: Date | null;
  completedAt?: Date | null;
  createdByEmployeeId?: EmployeeId | null;
  updatedAt: Date;
};

export type ChannelAuthChallengeRepository = {
  findChallenge(
    input: FindChannelAuthChallengeInput
  ): Promise<ChannelAuthChallengeRecord | null>;
  findLatestActiveChallenge(
    input: FindLatestActiveChannelAuthChallengeInput
  ): Promise<ChannelAuthChallengeRecord | null>;
  listActiveChallenges(
    input?: ListActiveChannelAuthChallengesInput
  ): Promise<ChannelAuthChallengeRecord[]>;
  upsertChallenge(input: UpsertChannelAuthChallengeInput): Promise<void>;
};

type ChannelAuthChallengeRow = {
  id: string;
  tenant_id: string;
  connector_id: string;
  challenge_type: string;
  status: string;
  public_payload: unknown;
  secret_payload_encrypted: string | null;
  error_code: string | null;
  error_message: string | null;
  expires_at: Date | string | null;
  completed_at: Date | string | null;
  created_by_employee_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export function createSqlChannelAuthChallengeRepository(
  executor: RawSqlExecutor | HuleeDatabase
): ChannelAuthChallengeRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findChallenge(input) {
      const result = await rawExecutor.execute<ChannelAuthChallengeRow>(
        buildFindChannelAuthChallengeSql(input)
      );

      return result.rows[0] ? mapChannelAuthChallengeRow(result.rows[0]) : null;
    },

    async findLatestActiveChallenge(input) {
      const result = await rawExecutor.execute<ChannelAuthChallengeRow>(
        buildFindLatestActiveChannelAuthChallengeSql(input)
      );

      return result.rows[0] ? mapChannelAuthChallengeRow(result.rows[0]) : null;
    },

    async listActiveChallenges(input = {}) {
      const result = await rawExecutor.execute<ChannelAuthChallengeRow>(
        buildListActiveChannelAuthChallengesSql(input)
      );

      return result.rows.map(mapChannelAuthChallengeRow);
    },

    async upsertChallenge(input) {
      await rawExecutor.execute(buildUpsertChannelAuthChallengeSql(input));
    }
  };
}

export function buildFindChannelAuthChallengeSql(
  input: FindChannelAuthChallengeInput
): SQL {
  return sql`
    select ${channelAuthChallengeSelectList}
    from channel_auth_challenges
    where tenant_id = ${input.tenantId}
      and id = ${input.challengeId}
    limit 1
  `;
}

export function buildFindLatestActiveChannelAuthChallengeSql(
  input: FindLatestActiveChannelAuthChallengeInput
): SQL {
  const typeClause = input.challengeType
    ? sql`and challenge_type = ${input.challengeType}`
    : sql``;

  return sql`
    select ${channelAuthChallengeSelectList}
    from channel_auth_challenges
    where tenant_id = ${input.tenantId}
      and connector_id = ${input.connectorId}
      and status in ('pending', 'waiting', 'requires_code', 'requires_password')
      ${typeClause}
    order by created_at desc, id desc
    limit 1
  `;
}

export function buildListActiveChannelAuthChallengesSql(
  input: ListActiveChannelAuthChallengesInput = {}
): SQL {
  const statuses =
    input.statuses && input.statuses.length > 0
      ? input.statuses
      : defaultActiveChannelAuthChallengeStatuses;
  const statusList = sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `
  );
  const now = input.now ?? new Date();

  return sql`
    select ${channelAuthChallengeSelectList}
    from channel_auth_challenges
    where status in (${statusList})
      and (expires_at is null or expires_at > ${now})
    order by updated_at asc, id asc
    limit ${input.limit ?? 100}
  `;
}

export function buildUpsertChannelAuthChallengeSql(
  input: UpsertChannelAuthChallengeInput
): SQL {
  return sql`
    insert into channel_auth_challenges (
      id,
      tenant_id,
      connector_id,
      challenge_type,
      status,
      public_payload,
      secret_payload_encrypted,
      error_code,
      error_message,
      expires_at,
      completed_at,
      created_by_employee_id,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.tenantId},
      ${input.connectorId},
      ${input.challengeType},
      ${input.status},
      ${JSON.stringify(input.publicPayload ?? {})}::jsonb,
      ${input.secretPayloadEncrypted ?? null},
      ${input.errorCode ?? null},
      ${input.errorMessage ?? null},
      ${input.expiresAt ?? null},
      ${input.completedAt ?? null},
      ${input.createdByEmployeeId ?? null},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (id) do update
    set status = excluded.status,
        public_payload = excluded.public_payload,
        secret_payload_encrypted = excluded.secret_payload_encrypted,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        expires_at = excluded.expires_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    where channel_auth_challenges.tenant_id = excluded.tenant_id
  `;
}

const channelAuthChallengeSelectList = sql`
  id,
  tenant_id,
  connector_id,
  challenge_type,
  status,
  public_payload,
  secret_payload_encrypted,
  error_code,
  error_message,
  expires_at,
  completed_at,
  created_by_employee_id,
  created_at,
  updated_at
`;

const defaultActiveChannelAuthChallengeStatuses = [
  "pending",
  "waiting",
  "requires_code",
  "requires_password"
] as const;

function mapChannelAuthChallengeRow(
  row: ChannelAuthChallengeRow
): ChannelAuthChallengeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    connectorId: row.connector_id as ChannelConnectorId,
    challengeType: row.challenge_type,
    status: row.status,
    publicPayload: row.public_payload,
    secretPayloadEncrypted: row.secret_payload_encrypted,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    expiresAt: toNullableDate(row.expires_at),
    completedAt: toNullableDate(row.completed_at),
    createdByEmployeeId: row.created_by_employee_id as EmployeeId | null,
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
