import type { TenantId } from "@hulee/contracts";
import type { RawSqlExecutor, RawSqlQueryResult } from "@hulee/db";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createInternalTenantSettingsService } from "./internal-tenant-service";

const tenantId = "tenant-brand" as TenantId;
const context = {
  requestId: "request-1",
  tenantId,
  employeeId: "employee-1"
};

describe("internal tenant settings service", () => {
  it("loads the tenant brand profile with normalized theme tokens", async () => {
    const service = createInternalTenantSettingsService({
      database: new RecordingSqlExecutor([
        {
          tenant_id: tenantId,
          display_name: "Acme",
          brand_id: "brand-1",
          product_name: "Acme Desk",
          short_product_name: "Acme",
          assets: {},
          theme_tokens: {
            "color.brand.primary": "#177F75",
            "color.brand.foreground": "#ffffff"
          },
          links: {}
        }
      ])
    });

    await expect(service.loadTenantBrand(context)).resolves.toMatchObject({
      brand: {
        id: "brand-1",
        tenantId,
        productName: "Acme Desk",
        shortProductName: "Acme",
        themeTokens: {
          "color.brand.primary": "#177f75",
          "color.brand.foreground": "#ffffff"
        }
      }
    });
  });

  it("writes a new tenant brand profile version and event", async () => {
    const executor = new RecordingSqlExecutor([
      {
        tenant_id: tenantId,
        display_name: "Acme",
        brand_id: "brand:tenant-brand:fixed-id",
        product_name: "Acme Desk",
        short_product_name: "Acme",
        assets: {
          logoLight: "/brand-assets/brand-asset%3Afixed/logo.png?v=hash",
          logoDark: "/brand-assets/brand-asset%3Afixed/logo.png?v=hash",
          mark: "/brand-assets/brand-asset%3Afixed/logo.png?v=hash"
        },
        theme_tokens: {
          "color.brand.primary": "#177f75",
          "color.brand.foreground": "#ffffff"
        },
        links: {}
      }
    ]);
    const service = createInternalTenantSettingsService({
      database: executor,
      now: () => new Date("2026-06-23T10:00:00.000Z"),
      idFactory: () => "fixed-id"
    });

    await expect(
      service.updateTenantBrand(context, {
        productName: "Acme Desk",
        shortProductName: "Acme",
        assets: {
          logoLight: "/brand-assets/brand-asset%3Afixed/logo.png?v=hash",
          logoDark: "/brand-assets/brand-asset%3Afixed/logo.png?v=hash",
          mark: "/brand-assets/brand-asset%3Afixed/logo.png?v=hash"
        },
        themeTokens: {
          "color.brand.primary": "#177f75",
          "color.brand.foreground": "#ffffff"
        }
      })
    ).resolves.toMatchObject({
      brand: {
        productName: "Acme Desk",
        assets: {
          logoLight: "/brand-assets/brand-asset%3Afixed/logo.png?v=hash"
        },
        themeTokens: {
          "color.brand.primary": "#177f75"
        }
      }
    });
    expect(executor.queries).toHaveLength(1);
  });

  it("rejects unsupported brand asset paths before writing", async () => {
    const executor = new RecordingSqlExecutor([]);
    const service = createInternalTenantSettingsService({
      database: executor
    });

    await expect(
      service.updateTenantBrand(context, {
        productName: "Acme Desk",
        assets: {
          logoLight: "https://example.test/logo.svg"
        },
        themeTokens: {
          "color.brand.primary": "#177f75",
          "color.brand.foreground": "#ffffff"
        }
      })
    ).rejects.toMatchObject({
      code: "validation.failed"
    });
    expect(executor.queries).toHaveLength(0);
  });

  it("rejects unsupported token names before writing", async () => {
    const executor = new RecordingSqlExecutor([]);
    const service = createInternalTenantSettingsService({
      database: executor
    });

    await expect(
      service.updateTenantBrand(context, {
        productName: "Acme Desk",
        themeTokens: {
          "--hulee-color-brand-primary": "#177f75"
        }
      })
    ).rejects.toMatchObject({
      code: "validation.failed"
    });
    expect(executor.queries).toHaveLength(0);
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);

    return {
      rows: this.rows as readonly Row[]
    };
  }
}
