import type { TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import { buildScopeReferenceOptions } from "./rbac-scope-options";

describe("RBAC scope reference options", () => {
  it("maps active org structure records to scope picker options", () => {
    const tenantId = "tenant-1" as TenantId;

    expect(
      buildScopeReferenceOptions({
        orgUnits: [
          {
            id: "org-unit-1",
            tenantId,
            parentOrgUnitId: null,
            name: "Sales",
            kind: "department",
            status: "active"
          }
        ],
        workQueues: [
          {
            id: "queue-1",
            tenantId,
            name: "Lead intake",
            kind: "lead_intake",
            owningOrgUnitId: "org-unit-1",
            status: "active",
            routingConfig: {}
          }
        ]
      })
    ).toEqual({
      org_unit: [
        {
          value: "org-unit-1",
          label: "Sales"
        }
      ],
      queue: [
        {
          value: "queue-1",
          label: "Lead intake"
        }
      ]
    });
  });
});
