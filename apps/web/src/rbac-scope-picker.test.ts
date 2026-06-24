import { describe, expect, it } from "vitest";

import { resolveScopePickerState } from "./rbac-scope-picker-state";

describe("RBAC scope picker", () => {
  it("falls back to the first allowed scope when requested scope is unavailable", () => {
    expect(
      resolveScopePickerState({
        allowedScopeTypes: ["org_unit", "queue"],
        requestedScopeType: "tenant"
      })
    ).toEqual({
      selectedScopeType: "org_unit",
      requiresReference: true,
      referenceMode: "manual",
      referenceOptions: []
    });
  });

  it("does not require a reference for implicit scopes", () => {
    expect(
      resolveScopePickerState({
        allowedScopeTypes: ["tenant", "assigned"],
        requestedScopeType: "assigned"
      })
    ).toEqual({
      selectedScopeType: "assigned",
      requiresReference: false,
      referenceMode: "none",
      referenceOptions: []
    });
  });

  it("uses connected reference options for supported concrete scopes", () => {
    const orgUnitOptions = [
      {
        value: "org-sales",
        label: "Sales"
      }
    ];

    expect(
      resolveScopePickerState({
        allowedScopeTypes: ["tenant", "org_unit"],
        requestedScopeType: "org_unit",
        scopeReferenceOptions: {
          org_unit: orgUnitOptions
        }
      })
    ).toEqual({
      selectedScopeType: "org_unit",
      requiresReference: true,
      referenceMode: "select",
      referenceOptions: orgUnitOptions
    });
  });

  it("keeps manual id mode for concrete scopes without a connected selector", () => {
    expect(
      resolveScopePickerState({
        allowedScopeTypes: ["team"],
        requestedScopeType: "team",
        scopeReferenceOptions: {
          queue: [
            {
              value: "queue-sales",
              label: "Sales"
            }
          ]
        }
      })
    ).toEqual({
      selectedScopeType: "team",
      requiresReference: true,
      referenceMode: "manual",
      referenceOptions: []
    });
  });
});
