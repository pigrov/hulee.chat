import type {
  ChannelType,
  EmployeeId,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type ChannelProviderValidationJobStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed";

export type ChannelProviderValidationJobRecord = {
  id: string;
  tenantId: TenantId;
  channelType: ChannelType | (string & {});
  provider: string;
  validationKind: string;
  status: ChannelProviderValidationJobStatus | (string & {});
  botTokenSecretRef: string;
  resultPayload: unknown;
  errorCode: PlatformErrorCode | (string & {}) | null;
  errorMessage: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  createdByEmployeeId: EmployeeId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FindChannelProviderValidationJobInput = {
  tenantId: TenantId;
  jobId: string;
};

export type UpsertChannelProviderValidationJobInput = {
  id: string;
  tenantId: TenantId;
  channelType: ChannelType | string;
  provider: string;
  validationKind: string;
  status: ChannelProviderValidationJobStatus | string;
  botTokenSecretRef: string;
  resultPayload?: unknown;
  errorCode?: PlatformErrorCode | string | null;
  errorMessage?: string | null;
  expiresAt: Date;
  completedAt?: Date | null;
  createdByEmployeeId?: EmployeeId | null;
  updatedAt: Date;
};

export type ChannelProviderValidationJobRepository = {
  findJob(
    input: FindChannelProviderValidationJobInput
  ): Promise<ChannelProviderValidationJobRecord | null>;
  upsertJob(input: UpsertChannelProviderValidationJobInput): Promise<void>;
};

type ChannelProviderValidationJobRow = {
  id: string;
  tenant_id: string;
  channel_type: string;
  provider: string;
  validation_kind: string;
  status: string;
  bot_token_secret_ref: string;
  result_payload: unknown;
  error_code: string | null;
  error_message: string | null;
  expires_at: Date;
  completed_at: Date | null;
  created_by_employee_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export function createSqlChannelProviderValidationJobRepository(
  executor: RawSqlExecutor | HuleeDatabase
): ChannelProviderValidationJobRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findJob(input) {
      const result = await rawExecutor.execute<ChannelProviderValidationJobRow>(
        buildFindChannelProviderValidationJobSql(input)
      );

      return result.rows[0]
        ? mapChannelProviderValidationJobRow(result.rows[0])
        : null;
    },

    async upsertJob(input) {
      await rawExecutor.execute(
        buildUpsertChannelProviderValidationJobSql(input)
      );
    }
  };
}

export function buildFindChannelProviderValidationJobSql(
  input: FindChannelProviderValidationJobInput
): SQL {
  return sql`
    select ${channelProviderValidationJobSelectList}
    from channel_provider_validation_jobs
    where tenant_id = ${input.tenantId}
      and id = ${input.jobId}
    limit 1
  `;
}

export function buildUpsertChannelProviderValidationJobSql(
  input: UpsertChannelProviderValidationJobInput
): SQL {
  return sql`
    insert into channel_provider_validation_jobs (
      id,
      tenant_id,
      channel_type,
      provider,
      validation_kind,
      status,
      bot_token_secret_ref,
      result_payload,
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
      ${input.channelType},
      ${input.provider},
      ${input.validationKind},
      ${input.status},
      ${input.botTokenSecretRef},
      ${JSON.stringify(input.resultPayload ?? {})}::jsonb,
      ${input.errorCode ?? null},
      ${input.errorMessage ?? null},
      ${input.expiresAt},
      ${input.completedAt ?? null},
      ${input.createdByEmployeeId ?? null},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (id) do update
    set status = excluded.status,
        result_payload = excluded.result_payload,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        expires_at = excluded.expires_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    where channel_provider_validation_jobs.tenant_id = excluded.tenant_id
  `;
}

const channelProviderValidationJobSelectList = sql`
  id,
  tenant_id,
  channel_type,
  provider,
  validation_kind,
  status,
  bot_token_secret_ref,
  result_payload,
  error_code,
  error_message,
  expires_at,
  completed_at,
  created_by_employee_id,
  created_at,
  updated_at
`;

function mapChannelProviderValidationJobRow(
  row: ChannelProviderValidationJobRow
): ChannelProviderValidationJobRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    channelType: row.channel_type as ChannelType,
    provider: row.provider,
    validationKind: row.validation_kind,
    status: row.status as ChannelProviderValidationJobStatus,
    botTokenSecretRef: row.bot_token_secret_ref,
    resultPayload: row.result_payload,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    createdByEmployeeId: row.created_by_employee_id as EmployeeId | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
