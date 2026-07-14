import { describe, expect, it } from "vitest";

import {
  defineModuleManifest,
  defineModuleManifests,
  moduleManifestSchema,
  type ModuleManifestInput
} from "./module-manifest";

type GovernanceInput = Extract<
  ModuleManifestInput,
  { dataHandling: "tenant_or_customer_data" }
>["dataGovernance"];

function governanceContribution(moduleId = "sample-module"): GovernanceInput {
  const prefix = `module:${moduleId}`;

  return {
    schemaId: "core:inbox-v2.module-data-governance",
    schemaVersion: "v1",
    payload: {
      moduleId,
      dataHandling: "tenant_or_customer_data",
      processingPurposes: [],
      retentionRules: [],
      retentionAnchors: [],
      handlers: [
        {
          id: `${prefix}:lifecycle`,
          definition: handler("lifecycle", [
            "read",
            "persist",
            "delete",
            "verify_absence"
          ])
        },
        {
          id: `${prefix}:delete`,
          definition: handler("delete_execution", ["delete"])
        },
        {
          id: `${prefix}:verify`,
          definition: {
            ...handler("verification", ["verify_absence"]),
            verifiesAbsence: true
          }
        },
        {
          id: `${prefix}:migration-uninstall`,
          definition: handler("migration_uninstall", ["read"])
        }
      ],
      storageRoots: [
        {
          id: `${prefix}:diagnostics`,
          definition: {
            kind: "json_blob",
            boundary: "operated_data_plane",
            tenantIsolation: "required",
            versionEnumeration: "not_applicable",
            configurationProfileId: `${prefix}:storage-profile`
          }
        }
      ],
      dataClasses: [],
      dataUses: [
        {
          dataClassId: "core:operational_log_trace_diagnostic",
          storageRootId: `${prefix}:diagnostics`,
          purposeIds: ["core:source_replay_and_diagnostics"],
          operations: ["read", "persist", "delete", "verify_absence"],
          canonicalAnchorId: "core:creation",
          lifecycleHandlerId: `${prefix}:lifecycle`,
          subjectDiscoveryHandlerId: null,
          exportProjectionHandlerId: null,
          exportHandlerId: null,
          deleteHandlerId: `${prefix}:delete`,
          verificationHandlerId: `${prefix}:verify`
        }
      ],
      externalRoutes: [],
      migrationAndUninstallHandlerId: `${prefix}:migration-uninstall`
    }
  };
}

function handler(
  kind:
    | "lifecycle"
    | "delete_execution"
    | "verification"
    | "migration_uninstall",
  supportedOperations: readonly (
    | "read"
    | "persist"
    | "delete"
    | "verify_absence"
  )[]
): GovernanceInput["payload"]["handlers"][number]["definition"] {
  return {
    kind,
    supportedRootKinds: ["json_blob"],
    supportedOperations: [...supportedOperations],
    bounded: true,
    idempotent: true,
    checksTenantFence: true,
    checksRevisionFence: true,
    checksHoldFence: true,
    verifiesAbsence: false
  } as const;
}

function governedManifest(moduleId = "sample-module"): ModuleManifestInput {
  return {
    id: moduleId,
    type: "company",
    name: "Sample module",
    version: "1.0.0",
    capabilities: ["sample.capability"],
    configSchema: {},
    dataHandling: "tenant_or_customer_data",
    dataGovernance: governanceContribution(moduleId)
  };
}

describe("module manifest data-governance boundary", () => {
  it("defines a data-bearing manifest only after registry validation", () => {
    const manifest = defineModuleManifest(governedManifest());

    expect(manifest.dataHandling).toBe("tenant_or_customer_data");
    expect(Object.isFrozen(manifest)).toBe(true);
    if (manifest.dataHandling === "tenant_or_customer_data") {
      expect(Object.isFrozen(manifest.dataGovernance)).toBe(true);
      expect(Object.isFrozen(manifest.dataGovernance.payload.dataUses)).toBe(
        true
      );
    }
  });

  it("accepts an explicit strict no-data manifest", () => {
    expect(
      defineModuleManifest({
        id: "static-company-ui",
        type: "company",
        name: "Static company UI",
        version: "1.0.0",
        capabilities: [],
        configSchema: {},
        dataHandling: "none"
      }).dataHandling
    ).toBe("none");

    expect(
      defineModuleManifest({
        id: "stateless-workflow",
        type: "workflow",
        name: "Stateless workflow",
        version: "1.0.0",
        capabilities: ["workflow.static-rules"],
        configSchema: {},
        dataHandling: "none"
      }).type
    ).toBe("workflow");
  });

  it("rejects governance omission, smuggling and unknown manifest fields", () => {
    const missingGovernance = {
      ...governedManifest(),
      dataGovernance: undefined
    };
    const noDataWithGovernance = {
      ...governedManifest(),
      dataHandling: "none"
    };
    const unknownField = {
      ...governedManifest(),
      retentionDays: 365
    };

    expect(moduleManifestSchema.safeParse(missingGovernance).success).toBe(
      false
    );
    expect(moduleManifestSchema.safeParse(noDataWithGovernance).success).toBe(
      false
    );
    expect(moduleManifestSchema.safeParse(unknownField).success).toBe(false);
  });

  it("rejects data-bearing no-data facets and requires configSchema", () => {
    expect(
      moduleManifestSchema.safeParse({
        id: "static-company-ui",
        type: "company",
        name: "Invalid static UI",
        version: "1.0.0",
        capabilities: [],
        configSchema: {},
        secretsSchema: {},
        dataHandling: "none"
      }).success
    ).toBe(false);
    expect(
      moduleManifestSchema.safeParse({
        id: "static-company-ui",
        type: "company",
        name: "Invalid static UI",
        version: "1.0.0",
        capabilities: [],
        dataHandling: "none"
      }).success
    ).toBe(false);
  });

  it("requires contribution ownership to match the manifest id", () => {
    const manifest = governedManifest("sample-module");

    expect(
      moduleManifestSchema.safeParse({
        ...manifest,
        dataGovernance: governanceContribution("different-module")
      }).success
    ).toBe(false);
  });

  it("fails closed on an unknown or incompatible lifecycle handler", () => {
    const manifest = governedManifest();
    const broken = structuredClone(manifest) as Record<string, unknown>;
    const contribution = broken.dataGovernance as {
      payload: { dataUses: Array<{ deleteHandlerId: string }> };
    };
    contribution.payload.dataUses[0]!.deleteHandlerId =
      "module:sample-module:missing-delete-handler";

    expect(() => defineModuleManifest(broken as ModuleManifestInput)).toThrow(
      /Unknown Inbox V2 lifecycle handler/
    );
  });

  it("composes contributions atomically and rejects duplicate manifest ids", () => {
    expect(
      defineModuleManifests([
        governedManifest("first-module"),
        governedManifest("second-module")
      ])
    ).toHaveLength(2);

    expect(() =>
      defineModuleManifests([
        governedManifest("same-module"),
        governedManifest("same-module")
      ])
    ).toThrow(/Duplicate module manifest id/);
  });
});
