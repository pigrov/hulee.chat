import { describe, expect, it } from "vitest";

import { initialTables } from "./index";

describe("initial table scope", () => {
  it("requires tenantId for tenant-owned tables", () => {
    const invalidTables = initialTables.filter(
      (table) => table.scope === "tenant" && !table.requiresTenantId
    );

    expect(invalidTables).toEqual([]);
  });
});
