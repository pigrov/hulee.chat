import {
  internalChannelTypeSchema,
  internalEgressProfileKindSchema,
  internalEgressProviderSchema,
  type InternalChannelType,
  type InternalEgressProfileKind,
  type InternalEgressProvider
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type DeploymentEgressProviderPolicyRecord = {
  provider: InternalEgressProvider;
  routingMode: InternalEgressProfileKind;
  profileId: string;
  required: boolean;
  supportedChannelTypes: readonly InternalChannelType[];
  allowedProfileKinds: readonly InternalEgressProfileKind[];
  updatedAt: Date;
  updatedByPlatformAdminAccountId?: string;
};

export type UpsertDeploymentEgressProviderPolicyInput = Omit<
  DeploymentEgressProviderPolicyRecord,
  "updatedAt"
> & {
  updatedAt: Date;
};

export type DeploymentEgressProviderPolicyRepository = {
  listPolicies(): Promise<DeploymentEgressProviderPolicyRecord[]>;
  findPolicy(
    provider: InternalEgressProvider
  ): Promise<DeploymentEgressProviderPolicyRecord | null>;
  upsertPolicy(input: UpsertDeploymentEgressProviderPolicyInput): Promise<void>;
};

type DeploymentEgressProviderPolicyRow = {
  provider: string;
  routing_mode: string;
  profile_id: string;
  required: boolean;
  supported_channel_types: unknown;
  allowed_profile_kinds: unknown;
  updated_at: Date | string;
  updated_by_platform_admin_account_id: string | null;
};

export function createSqlDeploymentEgressProviderPolicyRepository(
  executor: RawSqlExecutor | HuleeDatabase
): DeploymentEgressProviderPolicyRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async listPolicies() {
      const result =
        await rawExecutor.execute<DeploymentEgressProviderPolicyRow>(
          buildListDeploymentEgressProviderPoliciesSql()
        );

      return result.rows.map(mapDeploymentEgressProviderPolicyRow);
    },

    async findPolicy(provider) {
      const result =
        await rawExecutor.execute<DeploymentEgressProviderPolicyRow>(
          buildFindDeploymentEgressProviderPolicySql(provider)
        );
      const [row] = result.rows;

      return row ? mapDeploymentEgressProviderPolicyRow(row) : null;
    },

    async upsertPolicy(input) {
      await rawExecutor.execute(
        buildUpsertDeploymentEgressProviderPolicySql(input)
      );
    }
  };
}

export function buildListDeploymentEgressProviderPoliciesSql(): SQL {
  return sql`
    select provider,
           routing_mode,
           profile_id,
           required,
           supported_channel_types,
           allowed_profile_kinds,
           updated_at,
           updated_by_platform_admin_account_id
    from deployment_egress_provider_policies
    order by provider asc
  `;
}

export function buildFindDeploymentEgressProviderPolicySql(
  provider: InternalEgressProvider
): SQL {
  return sql`
    select provider,
           routing_mode,
           profile_id,
           required,
           supported_channel_types,
           allowed_profile_kinds,
           updated_at,
           updated_by_platform_admin_account_id
    from deployment_egress_provider_policies
    where provider = ${provider}
    limit 1
  `;
}

export function buildUpsertDeploymentEgressProviderPolicySql(
  input: UpsertDeploymentEgressProviderPolicyInput
): SQL {
  return sql`
    insert into deployment_egress_provider_policies (
      provider,
      routing_mode,
      profile_id,
      required,
      supported_channel_types,
      allowed_profile_kinds,
      updated_by_platform_admin_account_id,
      created_at,
      updated_at
    )
    values (
      ${input.provider},
      ${input.routingMode},
      ${input.profileId},
      ${input.required},
      ${JSON.stringify(input.supportedChannelTypes)}::jsonb,
      ${JSON.stringify(input.allowedProfileKinds)}::jsonb,
      ${input.updatedByPlatformAdminAccountId ?? null},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (provider) do update
    set routing_mode = excluded.routing_mode,
        profile_id = excluded.profile_id,
        required = excluded.required,
        supported_channel_types = excluded.supported_channel_types,
        allowed_profile_kinds = excluded.allowed_profile_kinds,
        updated_by_platform_admin_account_id = excluded.updated_by_platform_admin_account_id,
        updated_at = excluded.updated_at
  `;
}

function mapDeploymentEgressProviderPolicyRow(
  row: DeploymentEgressProviderPolicyRow
): DeploymentEgressProviderPolicyRecord {
  return {
    provider: parseProvider(row.provider),
    routingMode: parseProfileKind(row.routing_mode),
    profileId: row.profile_id,
    required: row.required,
    supportedChannelTypes: parseChannelTypes(row.supported_channel_types),
    allowedProfileKinds: parseProfileKinds(row.allowed_profile_kinds),
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
    throw new Error(`Unknown egress provider policy provider: ${value}`);
  }

  return parsed.data;
}

function parseProfileKind(value: string): InternalEgressProfileKind {
  const parsed = internalEgressProfileKindSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`Unknown egress profile kind: ${value}`);
  }

  return parsed.data;
}

function parseChannelTypes(value: unknown): InternalChannelType[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const parsed = internalChannelTypeSchema.safeParse(item);

    return parsed.success ? [parsed.data] : [];
  });
}

function parseProfileKinds(value: unknown): InternalEgressProfileKind[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const parsed = internalEgressProfileKindSchema.safeParse(item);

    return parsed.success ? [parsed.data] : [];
  });
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
