import { describe, expect, it } from "vitest";

import { assertTenantBoundary } from "./index";

describe("tenant boundary", () => {
  it("rejects cross-tenant entity access", () => {
    expect(() => {
      assertTenantBoundary(
        { tenantId: "tenant_a" as never },
        { tenantId: "tenant_b" as never }
      );
    }).toThrow("tenant.boundary_violation");
  });
});
