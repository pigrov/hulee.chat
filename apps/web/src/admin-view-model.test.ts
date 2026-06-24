import type { TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { RawSqlExecutor } from "@hulee/db";
import { describe, expect, it } from "vitest";

import { loadTenantAdminViewModel } from "./admin-view-model";

const tenantId = "tenant-1" as TenantId;

describe("tenant admin view model", () => {
  it("loads tenant display and brand context without inbox data", async () => {
    const model = await loadTenantAdminViewModel({
      tenantId,
      database: executor([
        {
          tenant_id: tenantId,
          display_name: "Acme",
          deployment_type: "saas_isolated",
          locale: "en",
          timezone: "Europe/Berlin",
          brand_id: "brand-1",
          product_name: "Acme Desk",
          short_product_name: "Desk",
          assets: {
            logoLight: "/assets/logo.svg",
            ignored: 123
          },
          theme_tokens: {
            "color.brand.primary": "#177f75",
            ignored: 123
          },
          links: {
            help: "https://help.example.test",
            ignored: 123
          }
        }
      ])
    });

    expect(model.tenant).toMatchObject({
      tenantId,
      displayName: "Acme",
      deploymentType: "saas_isolated",
      locale: "en",
      timezone: "Europe/Berlin",
      brand: {
        id: "brand-1",
        productName: "Acme Desk",
        shortProductName: "Desk",
        companyName: "Acme",
        assets: {
          logoLight: "/assets/logo.svg"
        },
        themeTokens: {
          "color.brand.primary": "#177f75"
        },
        links: {
          help: "https://help.example.test"
        }
      }
    });
  });

  it("fails when tenant context is missing", async () => {
    await expect(
      loadTenantAdminViewModel({
        tenantId,
        database: executor([])
      })
    ).rejects.toEqual(new CoreError("tenant.not_found"));
  });
});

function executor(rows: readonly Record<string, unknown>[]): RawSqlExecutor {
  return {
    async execute<Row extends Record<string, unknown>>() {
      return {
        rows: rows as readonly Row[]
      };
    }
  };
}
