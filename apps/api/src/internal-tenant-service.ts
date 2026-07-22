import {
  isAllowedBrandAssetPath,
  normalizeBrandThemeTokens,
  resolveBrandProfile,
  type BrandProfile
} from "@hulee/branding";
import type {
  EventId,
  InternalTenantBrandProfile,
  InternalTenantBrandResponse,
  InternalTenantBrandUpdateRequest,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { HuleeDatabase, RawSqlExecutor } from "@hulee/db";
import { sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type InternalTenantSettingsContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: string;
};

export type InternalTenantSettingsService = {
  loadTenantBrand(
    context: InternalTenantSettingsContext
  ): Promise<InternalTenantBrandResponse>;
  updateTenantBrand(
    context: InternalTenantSettingsContext,
    request: InternalTenantBrandUpdateRequest
  ): Promise<InternalTenantBrandResponse>;
};

type TenantBrandRow = {
  tenant_id: string;
  display_name: string;
  brand_id: string | null;
  product_name: string | null;
  short_product_name: string | null;
  assets: unknown;
  theme_tokens: unknown;
  links: unknown;
};

export function createInternalTenantSettingsService(input: {
  database: RawSqlExecutor | HuleeDatabase;
  now?: () => Date;
  idFactory?: () => string;
}): InternalTenantSettingsService {
  const executor = input.database as RawSqlExecutor;
  const now = input.now ?? (() => new Date());
  const idFactory = input.idFactory ?? (() => randomUUID());

  return {
    async loadTenantBrand(context) {
      return {
        brand: await loadTenantBrand(executor, context.tenantId)
      };
    },

    async updateTenantBrand(context, request) {
      const updatedAt = now();
      const brandId = `brand:${context.tenantId}:${idFactory()}`;
      const assets = normalizeRequestAssets(request.assets);
      const themeTokens = normalizeRequestThemeTokens(request.themeTokens);
      const event: PlatformEvent = {
        id: `event:${brandId}` as EventId,
        type: "tenant.brand_profile_updated",
        version: "v1",
        tenantId: context.tenantId,
        occurredAt: updatedAt.toISOString(),
        idempotencyKey: `tenant-brand:${context.tenantId}:${brandId}`,
        payload: {
          brandProfileId: brandId,
          productName: request.productName
        }
      };
      const result = await executor.execute<TenantBrandRow>(
        buildUpdateTenantBrandSql({
          tenantId: context.tenantId,
          brandId,
          productName: request.productName,
          shortProductName: request.shortProductName,
          assets,
          themeTokens,
          event,
          updatedAt
        })
      );
      const row = result.rows[0];

      if (!row) {
        throw new CoreError("tenant.not_found");
      }

      return {
        brand: mapTenantBrandRow(row, { strictTokens: true })
      };
    }
  };
}

export function buildLoadTenantBrandSql(tenantId: TenantId): SQL {
  return sql`
    select
      tenants.id as tenant_id,
      tenants.display_name,
      tenant_brand_profiles.id as brand_id,
      tenant_brand_profiles.product_name,
      tenant_brand_profiles.short_product_name,
      tenant_brand_profiles.assets,
      tenant_brand_profiles.theme_tokens,
      tenant_brand_profiles.links
    from tenants
    left join lateral (
      select id,
             product_name,
             short_product_name,
             assets,
             theme_tokens,
             links
      from tenant_brand_profiles
      where tenant_id = tenants.id
      order by created_at desc
      limit 1
    ) tenant_brand_profiles on true
    where tenants.id = ${tenantId}
    limit 1
  `;
}

export function buildUpdateTenantBrandSql(input: {
  tenantId: TenantId;
  brandId: string;
  productName: string;
  shortProductName?: string;
  assets?: Record<string, string>;
  themeTokens: Record<string, string>;
  event: PlatformEvent;
  updatedAt: Date;
}): SQL {
  const assetsSql =
    input.assets === undefined
      ? sql`coalesce(latest_brand.assets, '{}'::jsonb)`
      : sql`coalesce(latest_brand.assets, '{}'::jsonb) || ${JSON.stringify(input.assets)}::jsonb`;

  return sql`
    with tenant_row as (
      select id,
             display_name
      from tenants
      where id = ${input.tenantId}
      limit 1
    ),
    latest_brand as (
      select assets,
             links
      from tenant_brand_profiles
      where tenant_id = ${input.tenantId}
      order by created_at desc
      limit 1
    ),
    inserted_brand as (
      insert into tenant_brand_profiles (
        id,
        tenant_id,
        product_name,
        short_product_name,
        assets,
        theme_tokens,
        links,
        created_at,
        updated_at
      )
      select ${input.brandId},
             tenant_row.id,
             ${input.productName},
             ${input.shortProductName ?? null},
             ${assetsSql},
             ${JSON.stringify(input.themeTokens)}::jsonb,
             coalesce(latest_brand.links, '{}'::jsonb),
             ${input.updatedAt},
             ${input.updatedAt}
      from tenant_row
      left join latest_brand on true
      returning id,
                tenant_id,
                product_name,
                short_product_name,
                assets,
                theme_tokens,
                links
    ),
    inserted_event as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select ${input.event.id},
             inserted_brand.tenant_id,
             ${input.event.type},
             ${input.event.version},
             ${input.event.occurredAt},
             ${input.event.idempotencyKey ?? null},
             ${JSON.stringify(input.event)}::jsonb,
             ${input.updatedAt},
             ${input.updatedAt}
      from inserted_brand
      returning id,
                tenant_id,
                payload,
                occurred_at
    ),
    inserted_outbox as (
      insert into outbox (
        id,
        tenant_id,
        event_id,
        status,
        attempts,
        payload,
        created_at,
        updated_at
      )
      select concat('outbox:', id),
             tenant_id,
             id,
             'pending',
             0,
             payload,
             occurred_at,
             occurred_at
      from inserted_event
      returning id
    )
    select tenant_row.id as tenant_id,
           tenant_row.display_name,
           inserted_brand.id as brand_id,
           inserted_brand.product_name,
           inserted_brand.short_product_name,
           inserted_brand.assets,
           inserted_brand.theme_tokens,
           inserted_brand.links
    from inserted_brand
    inner join tenant_row on tenant_row.id = inserted_brand.tenant_id
    limit 1
  `;
}

async function loadTenantBrand(
  executor: RawSqlExecutor,
  tenantId: TenantId
): Promise<InternalTenantBrandProfile> {
  const result = await executor.execute<TenantBrandRow>(
    buildLoadTenantBrandSql(tenantId)
  );
  const row = result.rows[0];

  if (!row) {
    throw new CoreError("tenant.not_found");
  }

  return mapTenantBrandRow(row, { strictTokens: false });
}

function mapTenantBrandRow(
  row: TenantBrandRow,
  input: { strictTokens: boolean }
): InternalTenantBrandProfile {
  const tenantBrand: BrandProfile | undefined =
    row.brand_id && row.product_name
      ? {
          id: row.brand_id,
          scope: "tenant",
          tenantId: row.tenant_id,
          productName: row.product_name,
          shortProductName: row.short_product_name ?? undefined,
          companyName: row.display_name,
          assets: recordFromUnknown(row.assets),
          themeTokens: themeTokensFromUnknown(row.theme_tokens, input),
          links: recordFromUnknown(row.links)
        }
      : undefined;
  const brand = resolveBrandProfile({ tenant: tenantBrand });

  return {
    id: brand.id,
    scope: brand.scope,
    tenantId: brand.tenantId,
    productName: brand.productName,
    shortProductName: brand.shortProductName,
    companyName: brand.companyName,
    assets: brand.assets,
    themeTokens: brand.themeTokens,
    links: brand.links ?? {}
  };
}

function normalizeRequestThemeTokens(
  tokens: Record<string, string>
): Record<string, string> {
  try {
    return normalizeBrandThemeTokens(tokens);
  } catch {
    throw new CoreError("validation.failed");
  }
}

function normalizeRequestAssets(
  assets: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (assets === undefined) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(assets).flatMap(([key, value]) => {
      const normalizedKey = key.trim();
      const normalizedValue = value.trim();

      return normalizedValue.length > 0
        ? [[normalizedKey, normalizedValue]]
        : [];
    })
  );

  const allowedKeys = new Set([
    "logoLight",
    "logoDark",
    "mark",
    "favicon",
    "pwaIcon",
    "appIcon",
    "splashScreen"
  ]);

  for (const [key, value] of Object.entries(normalized)) {
    if (
      !allowedKeys.has(key) ||
      !value.startsWith("/") ||
      value.startsWith("//") ||
      !isAllowedBrandAssetPath(value)
    ) {
      throw new CoreError("validation.failed");
    }
  }

  return normalized;
}

function themeTokensFromUnknown(
  value: unknown,
  input: { strictTokens: boolean }
): Record<string, string> {
  const record = recordFromUnknown(value);

  if (input.strictTokens) {
    return normalizeRequestThemeTokens(record);
  }

  try {
    return normalizeBrandThemeTokens(record);
  } catch {
    return {};
  }
}

function recordFromUnknown(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, rawValue]) => {
      return typeof rawValue === "string" ? [[key, rawValue]] : [];
    })
  );
}
