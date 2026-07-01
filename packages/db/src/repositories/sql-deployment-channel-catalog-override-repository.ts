import {
  internalChannelReadinessSchema,
  internalChannelTypeSchema,
  internalChannelVisibilitySchema,
  internalLocalizedMarkdownTextOverridesSchema,
  internalLocalizedTextOverridesSchema,
  type InternalChannelReadiness,
  type InternalChannelType,
  type InternalChannelVisibility
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type LocalizedTextOverrides = Readonly<Record<string, string>>;

export type DeploymentChannelCatalogOverrideRecord = {
  channelType: InternalChannelType;
  titleOverrides: LocalizedTextOverrides;
  shortDescriptionOverrides: LocalizedTextOverrides;
  descriptionOverrides: LocalizedTextOverrides;
  iconAssetRef?: string;
  sortOrder?: number;
  visibility: InternalChannelVisibility;
  readiness?: InternalChannelReadiness;
  updatedAt: Date;
  updatedByPlatformAdminAccountId?: string;
};

export type UpsertDeploymentChannelCatalogOverrideInput = Omit<
  DeploymentChannelCatalogOverrideRecord,
  "updatedAt"
> & {
  updatedAt: Date;
};

export type DeploymentChannelCatalogOverrideRepository = {
  listOverrides(): Promise<DeploymentChannelCatalogOverrideRecord[]>;
  findOverride(
    channelType: InternalChannelType
  ): Promise<DeploymentChannelCatalogOverrideRecord | null>;
  upsertOverride(
    input: UpsertDeploymentChannelCatalogOverrideInput
  ): Promise<void>;
};

type DeploymentChannelCatalogOverrideRow = {
  channel_type: string;
  title_overrides: unknown;
  short_description_overrides: unknown;
  description_overrides: unknown;
  icon_asset_ref: string | null;
  sort_order: number | null;
  visibility: string;
  readiness: string | null;
  updated_at: Date | string;
  updated_by_platform_admin_account_id: string | null;
};

export function createSqlDeploymentChannelCatalogOverrideRepository(
  executor: RawSqlExecutor | HuleeDatabase
): DeploymentChannelCatalogOverrideRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async listOverrides() {
      const result =
        await rawExecutor.execute<DeploymentChannelCatalogOverrideRow>(
          buildListDeploymentChannelCatalogOverridesSql()
        );

      return result.rows.map(mapDeploymentChannelCatalogOverrideRow);
    },

    async findOverride(channelType) {
      const result =
        await rawExecutor.execute<DeploymentChannelCatalogOverrideRow>(
          buildFindDeploymentChannelCatalogOverrideSql(channelType)
        );
      const [row] = result.rows;

      return row ? mapDeploymentChannelCatalogOverrideRow(row) : null;
    },

    async upsertOverride(input) {
      await rawExecutor.execute(
        buildUpsertDeploymentChannelCatalogOverrideSql(input)
      );
    }
  };
}

export function buildListDeploymentChannelCatalogOverridesSql(): SQL {
  return sql`
    select channel_type,
           title_overrides,
           short_description_overrides,
           description_overrides,
           icon_asset_ref,
           sort_order,
           visibility,
           readiness,
           updated_at,
           updated_by_platform_admin_account_id
    from deployment_channel_catalog_overrides
    order by coalesce(sort_order, 100000) asc,
             channel_type asc
  `;
}

export function buildFindDeploymentChannelCatalogOverrideSql(
  channelType: InternalChannelType
): SQL {
  return sql`
    select channel_type,
           title_overrides,
           short_description_overrides,
           description_overrides,
           icon_asset_ref,
           sort_order,
           visibility,
           readiness,
           updated_at,
           updated_by_platform_admin_account_id
    from deployment_channel_catalog_overrides
    where channel_type = ${channelType}
    limit 1
  `;
}

export function buildUpsertDeploymentChannelCatalogOverrideSql(
  input: UpsertDeploymentChannelCatalogOverrideInput
): SQL {
  return sql`
    insert into deployment_channel_catalog_overrides (
      channel_type,
      title_overrides,
      short_description_overrides,
      description_overrides,
      icon_asset_ref,
      sort_order,
      visibility,
      readiness,
      updated_by_platform_admin_account_id,
      created_at,
      updated_at
    )
    values (
      ${input.channelType},
      ${JSON.stringify(input.titleOverrides)}::jsonb,
      ${JSON.stringify(input.shortDescriptionOverrides)}::jsonb,
      ${JSON.stringify(input.descriptionOverrides)}::jsonb,
      ${input.iconAssetRef ?? null},
      ${input.sortOrder ?? null},
      ${input.visibility},
      ${input.readiness ?? null},
      ${input.updatedByPlatformAdminAccountId ?? null},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (channel_type) do update
    set title_overrides = excluded.title_overrides,
        short_description_overrides = excluded.short_description_overrides,
        description_overrides = excluded.description_overrides,
        icon_asset_ref = excluded.icon_asset_ref,
        sort_order = excluded.sort_order,
        visibility = excluded.visibility,
        readiness = excluded.readiness,
        updated_by_platform_admin_account_id = excluded.updated_by_platform_admin_account_id,
        updated_at = excluded.updated_at
  `;
}

function mapDeploymentChannelCatalogOverrideRow(
  row: DeploymentChannelCatalogOverrideRow
): DeploymentChannelCatalogOverrideRecord {
  return {
    channelType: parseChannelType(row.channel_type),
    titleOverrides: parseLocalizedShortTextOverrides(row.title_overrides),
    shortDescriptionOverrides: parseLocalizedShortTextOverrides(
      row.short_description_overrides
    ),
    descriptionOverrides: parseLocalizedMarkdownTextOverrides(
      row.description_overrides
    ),
    ...(row.icon_asset_ref ? { iconAssetRef: row.icon_asset_ref } : {}),
    ...(row.sort_order === null ? {} : { sortOrder: row.sort_order }),
    visibility: parseVisibility(row.visibility),
    ...(row.readiness ? { readiness: parseReadiness(row.readiness) } : {}),
    updatedAt: toDate(row.updated_at),
    ...(row.updated_by_platform_admin_account_id
      ? {
          updatedByPlatformAdminAccountId:
            row.updated_by_platform_admin_account_id
        }
      : {})
  };
}

function parseChannelType(value: string): InternalChannelType {
  const parsed = internalChannelTypeSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`Unknown channel catalog override channel type: ${value}`);
  }

  return parsed.data;
}

function parseLocalizedShortTextOverrides(
  value: unknown
): LocalizedTextOverrides {
  const parsed = internalLocalizedTextOverridesSchema.safeParse(value);

  return parsed.success ? parsed.data : {};
}

function parseLocalizedMarkdownTextOverrides(
  value: unknown
): LocalizedTextOverrides {
  const parsed = internalLocalizedMarkdownTextOverridesSchema.safeParse(value);

  return parsed.success ? parsed.data : {};
}

function parseVisibility(value: string): InternalChannelVisibility {
  const parsed = internalChannelVisibilitySchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`Unknown channel catalog override visibility: ${value}`);
  }

  return parsed.data;
}

function parseReadiness(value: string): InternalChannelReadiness {
  const parsed = internalChannelReadinessSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`Unknown channel catalog override readiness: ${value}`);
  }

  return parsed.data;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
