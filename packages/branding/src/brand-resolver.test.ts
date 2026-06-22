import { describe, expect, it } from "vitest";

import { resolveBrandProfile, type BrandProfile } from "./index";

describe("brand resolver", () => {
  it("applies tenant brand values over platform defaults", () => {
    const platform: BrandProfile = {
      id: "platform",
      scope: "platform",
      productName: "Hulee",
      assets: {
        logoLight: "platform.svg"
      },
      themeTokens: {
        "color.brand.primary": "#111111"
      }
    };

    const tenant: BrandProfile = {
      id: "tenant",
      scope: "tenant",
      tenantId: "tenant_1",
      productName: "Customer Desk",
      assets: {
        logoDark: "tenant-dark.svg"
      },
      themeTokens: {
        "color.brand.primary": "#2255aa"
      }
    };

    expect(resolveBrandProfile({ platform, tenant })).toMatchObject({
      id: "tenant",
      scope: "tenant",
      productName: "Customer Desk",
      assets: {
        logoLight: "platform.svg",
        logoDark: "tenant-dark.svg"
      },
      themeTokens: {
        "color.brand.primary": "#2255aa"
      }
    });
  });
});
