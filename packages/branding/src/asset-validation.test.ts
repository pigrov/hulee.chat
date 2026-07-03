import { describe, expect, it } from "vitest";

import { isAllowedBrandAssetPath } from "./asset-validation";

describe("brand asset validation", () => {
  it("allows versioned image paths with query strings", () => {
    expect(
      isAllowedBrandAssetPath("/brand-assets/brand-asset%3A1/logo.png?v=hash")
    ).toBe(true);
  });
});
