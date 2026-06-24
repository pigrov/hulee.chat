import {
  normalizeBrandThemeTokens,
  resolveBrandProfile
} from "@hulee/branding";
import type {
  InternalInboxBrandProfile,
  InternalInboxTenantContext,
  TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { HuleeDatabase, RawSqlExecutor } from "@hulee/db";
import { sql } from "drizzle-orm";

import { getWebDatabase } from "./web-database";

export type TenantAdminViewModel = {
  readonly tenant: InternalInboxTenantContext;
};

type TenantAdminRow = {
  readonly tenant_id: string;
  readonly display_name: string;
  readonly deployment_type: string;
  readonly locale: string;
  readonly timezone: string;
  readonly brand_id: string | null;
  readonly product_name: string | null;
  readonly short_product_name: string | null;
  readonly assets: unknown;
  readonly theme_tokens: unknown;
  readonly links: unknown;
};

export async function loadTenantAdminViewModel(input: {
  readonly tenantId: TenantId;
  readonly database?: RawSqlExecutor | HuleeDatabase;
}): Promise<TenantAdminViewModel> {
  const database = input.database ?? getWebDatabase();
  const result = await database.execute<TenantAdminRow>(sql`
    select
      t.id as tenant_id,
      t.display_name,
      t.deployment_type,
      coalesce(ts.locale, 'ru') as locale,
      coalesce(ts.timezone, 'Europe/Moscow') as timezone,
      tbp.id as brand_id,
      tbp.product_name,
      tbp.short_product_name,
      tbp.assets,
      tbp.theme_tokens,
      tbp.links
    from tenants t
    left join tenant_settings ts
      on ts.tenant_id = t.id
    left join lateral (
      select id,
             product_name,
             short_product_name,
             assets,
             theme_tokens,
             links
      from tenant_brand_profiles
      where tenant_id = t.id
      order by created_at desc
      limit 1
    ) tbp on true
    where t.id = ${input.tenantId}
    limit 1
  `);
  const row = result.rows[0];

  if (!row) {
    throw new CoreError("tenant.not_found");
  }

  return {
    tenant: mapTenantAdminRow(row, input.tenantId)
  };
}

function mapTenantAdminRow(
  row: TenantAdminRow,
  tenantId: TenantId
): InternalInboxTenantContext {
  const tenantBrand =
    row.brand_id && row.product_name
      ? {
          id: row.brand_id,
          scope: "tenant" as const,
          tenantId,
          productName: row.product_name,
          shortProductName: row.short_product_name ?? undefined,
          companyName: row.display_name,
          assets: normalizeStringRecord(row.assets),
          themeTokens: normalizeThemeTokens(row.theme_tokens),
          links: normalizeStringRecord(row.links)
        }
      : undefined;
  const brand = resolveBrandProfile({ tenant: tenantBrand });

  return {
    tenantId,
    displayName: row.display_name,
    deploymentType: resolveDeploymentType(row.deployment_type),
    locale: resolveLocale(row.locale),
    timezone: row.timezone,
    brand: {
      id: brand.id,
      scope: brand.scope,
      tenantId: brand.tenantId,
      productName: brand.productName,
      shortProductName: brand.shortProductName,
      companyName: brand.companyName,
      assets: brand.assets,
      themeTokens: brand.themeTokens,
      links: brand.links ?? {}
    } satisfies InternalInboxBrandProfile
  };
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, rawValue]) =>
      typeof rawValue === "string" ? [[key, rawValue]] : []
    )
  );
}

function normalizeThemeTokens(value: unknown): Record<string, string> {
  try {
    return normalizeBrandThemeTokens(normalizeStringRecord(value));
  } catch {
    return {};
  }
}

function resolveLocale(locale: string): InternalInboxTenantContext["locale"] {
  return locale === "en" ? "en" : "ru";
}

function resolveDeploymentType(
  deploymentType: string
): InternalInboxTenantContext["deploymentType"] {
  switch (deploymentType) {
    case "saas_isolated":
    case "on_prem":
      return deploymentType;
    default:
      return "saas_shared";
  }
}
