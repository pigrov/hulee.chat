import { describe, expect, it } from "vitest";

import { initialTables } from "./index";

describe("initial table scope", () => {
  it("requires tenantId for tenant-owned tables", () => {
    const invalidTables = initialTables.filter(
      (table) => table.scope === "tenant" && !table.requiresTenantId
    );

    expect(invalidTables).toEqual([]);
  });

  it("registers every MSG-007 provider observation and settlement relation as tenant-owned", () => {
    const expectedNames = [
      "inbox_v2_outbound_provider_correlation_anchors",
      "inbox_v2_outbound_provider_observations",
      "inbox_v2_outbound_dispatch_artifact_resolutions",
      "inbox_v2_outbound_provider_observation_settlements",
      "inbox_v2_outbound_provider_settlement_work_items"
    ] as const;
    const registered = new Map(
      initialTables.map((table) => [table.name, table])
    );

    expect(
      expectedNames.map((name) => ({
        name,
        scope: registered.get(name)?.scope,
        requiresTenantId: registered.get(name)?.requiresTenantId
      }))
    ).toEqual(
      expectedNames.map((name) => ({
        name,
        scope: "tenant",
        requiresTenantId: true
      }))
    );
  });
});
