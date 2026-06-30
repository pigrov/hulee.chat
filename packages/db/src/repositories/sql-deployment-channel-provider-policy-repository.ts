import {
  internalChannelTypeSchema,
  internalEgressProviderSchema,
  internalTelegramIntegrationModeSchema,
  type InternalChannelType,
  type InternalEgressProvider,
  type InternalTelegramIntegrationConfig
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type DeploymentChannelProviderPolicyRecord = {
  provider: InternalEgressProvider;
  channelType: InternalChannelType;
  inboundMode: InternalTelegramIntegrationConfig["mode"];
  outboundEnabled: boolean;
  updatedAt: Date;
  updatedByPlatformAdminAccountId?: string;
};

export type UpsertDeploymentChannelProviderPolicyInput = Omit<
  DeploymentChannelProviderPolicyRecord,
  "updatedAt"
> & {
  updatedAt: Date;
};

export type DeploymentChannelProviderPolicyRepository = {
  listPolicies(): Promise<DeploymentChannelProviderPolicyRecord[]>;
  findPolicy(input: {
    provider: InternalEgressProvider;
    channelType: InternalChannelType;
  }): Promise<DeploymentChannelProviderPolicyRecord | null>;
  upsertPolicy(
    input: UpsertDeploymentChannelProviderPolicyInput
  ): Promise<void>;
};

type DeploymentChannelProviderPolicyRow = {
  provider: string;
  channel_type: string;
  inbound_mode: string;
  outbound_enabled: boolean;
  updated_at: Date | string;
  updated_by_platform_admin_account_id: string | null;
};

export function createSqlDeploymentChannelProviderPolicyRepository(
  executor: RawSqlExecutor | HuleeDatabase
): DeploymentChannelProviderPolicyRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async listPolicies() {
      const result =
        await rawExecutor.execute<DeploymentChannelProviderPolicyRow>(
          buildListDeploymentChannelProviderPoliciesSql()
        );

      return result.rows.map(mapDeploymentChannelProviderPolicyRow);
    },

    async findPolicy(input) {
      const result =
        await rawExecutor.execute<DeploymentChannelProviderPolicyRow>(
          buildFindDeploymentChannelProviderPolicySql(input)
        );
      const [row] = result.rows;

      return row ? mapDeploymentChannelProviderPolicyRow(row) : null;
    },

    async upsertPolicy(input) {
      await rawExecutor.execute(
        buildUpsertDeploymentChannelProviderPolicySql(input)
      );
    }
  };
}

export function buildListDeploymentChannelProviderPoliciesSql(): SQL {
  return sql`
    select provider,
           channel_type,
           inbound_mode,
           outbound_enabled,
           updated_at,
           updated_by_platform_admin_account_id
    from deployment_channel_provider_policies
    order by provider asc,
             channel_type asc
  `;
}

export function buildFindDeploymentChannelProviderPolicySql(input: {
  provider: InternalEgressProvider;
  channelType: InternalChannelType;
}): SQL {
  return sql`
    select provider,
           channel_type,
           inbound_mode,
           outbound_enabled,
           updated_at,
           updated_by_platform_admin_account_id
    from deployment_channel_provider_policies
    where provider = ${input.provider}
      and channel_type = ${input.channelType}
    limit 1
  `;
}

export function buildUpsertDeploymentChannelProviderPolicySql(
  input: UpsertDeploymentChannelProviderPolicyInput
): SQL {
  return sql`
    insert into deployment_channel_provider_policies (
      provider,
      channel_type,
      inbound_mode,
      outbound_enabled,
      updated_by_platform_admin_account_id,
      created_at,
      updated_at
    )
    values (
      ${input.provider},
      ${input.channelType},
      ${input.inboundMode},
      ${input.outboundEnabled},
      ${input.updatedByPlatformAdminAccountId ?? null},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (provider, channel_type) do update
    set inbound_mode = excluded.inbound_mode,
        outbound_enabled = excluded.outbound_enabled,
        updated_by_platform_admin_account_id = excluded.updated_by_platform_admin_account_id,
        updated_at = excluded.updated_at
  `;
}

function mapDeploymentChannelProviderPolicyRow(
  row: DeploymentChannelProviderPolicyRow
): DeploymentChannelProviderPolicyRecord {
  return {
    provider: parseProvider(row.provider),
    channelType: parseChannelType(row.channel_type),
    inboundMode: parseTelegramInboundMode(row.inbound_mode),
    outboundEnabled: row.outbound_enabled,
    updatedAt: toDate(row.updated_at),
    ...(row.updated_by_platform_admin_account_id
      ? {
          updatedByPlatformAdminAccountId:
            row.updated_by_platform_admin_account_id
        }
      : {})
  };
}

function parseProvider(value: string): InternalEgressProvider {
  const parsed = internalEgressProviderSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`Unknown channel provider policy provider: ${value}`);
  }

  return parsed.data;
}

function parseChannelType(value: string): InternalChannelType {
  const parsed = internalChannelTypeSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`Unknown channel provider policy channel type: ${value}`);
  }

  return parsed.data;
}

function parseTelegramInboundMode(
  value: string
): InternalTelegramIntegrationConfig["mode"] {
  const parsed = internalTelegramIntegrationModeSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`Unknown Telegram inbound mode: ${value}`);
  }

  return parsed.data;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
