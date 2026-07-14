import {
  defineModuleManifests,
  INBOX_V2_CORE_DATA_CLASS_CATALOG
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  basicLicenseDataGovernance,
  createStandardModuleDataGovernance,
  localAuthDataGovernance,
  publicApiChannelDataGovernance,
  s3StorageDataGovernance,
  telegramChannelDataGovernance,
  vkAuthDataGovernance
} from "./data-governance";
import { standardModuleManifests } from "./index";

const contributions = [
  localAuthDataGovernance,
  vkAuthDataGovernance,
  publicApiChannelDataGovernance,
  telegramChannelDataGovernance,
  s3StorageDataGovernance,
  basicLicenseDataGovernance
];
const coreClassById = new Map(
  INBOX_V2_CORE_DATA_CLASS_CATALOG.payload.entries.map((entry) => [
    String(entry.id),
    entry.definition
  ])
);

describe("standard module data-governance registry", () => {
  it("classifies all six standard modules and composes them atomically", () => {
    expect(standardModuleManifests).toHaveLength(6);
    expect(
      standardModuleManifests.every(
        (manifest) =>
          manifest.dataHandling === "tenant_or_customer_data" &&
          manifest.dataGovernance.payload.moduleId === manifest.id
      )
    ).toBe(true);

    expect(defineModuleManifests(standardModuleManifests)).toHaveLength(6);
  });

  it("derives complete local discovery, export and deletion lineage from the core catalog", () => {
    for (const contribution of contributions) {
      const payload = contribution.payload;
      const handlerIds = new Set(payload.handlers.map((handler) => handler.id));
      const handlerById = new Map(
        payload.handlers.map((handler) => [handler.id, handler])
      );
      const rootById = new Map(
        payload.storageRoots.map((root) => [root.id, root])
      );

      expect(payload.storageRoots.length).toBeGreaterThan(0);
      expect(handlerIds.has(payload.migrationAndUninstallHandlerId)).toBe(true);
      expect(
        handlerById.get(payload.migrationAndUninstallHandlerId)?.definition
          .checksHoldFence
      ).toBe(true);
      expect(
        payload.dataUses.some((use) => use.operations.includes("delete"))
      ).toBe(true);

      for (const use of payload.dataUses) {
        const dataClass = coreClassById.get(use.dataClassId);
        const root = rootById.get(use.storageRootId);
        expect(dataClass).toBeDefined();
        expect(root).toBeDefined();
        expect(use.canonicalAnchorId).toBe(dataClass?.canonicalAnchorId);

        const subjectBearing = dataClass?.subjectLinkBehavior !== "none";
        expect(use.subjectDiscoveryHandlerId !== null).toBe(subjectBearing);
        if (use.subjectDiscoveryHandlerId !== null) {
          expect(
            handlerById.get(use.subjectDiscoveryHandlerId)?.definition.kind
          ).toBe("subject_discovery");
        }

        if (root?.definition.kind === "external_route") {
          expect(use.operations).toEqual(["transmit_external"]);
          expect(use.exportProjectionHandlerId).toBeNull();
          expect(use.exportHandlerId).toBeNull();
          expect(use.deleteHandlerId).toBeNull();
          expect(use.verificationHandlerId).toBeNull();
          continue;
        }

        expect(use.operations).toEqual(
          expect.arrayContaining(["persist", "delete", "verify_absence"])
        );
        expect(use.deleteHandlerId).not.toBeNull();
        expect(use.verificationHandlerId).not.toBeNull();

        const exportable = dataClass?.exportBehavior !== "never";
        expect(use.operations.includes("export")).toBe(exportable);
        expect(use.exportProjectionHandlerId !== null).toBe(exportable);
        expect(use.exportHandlerId !== null).toBe(exportable);
        if (use.exportProjectionHandlerId !== null) {
          expect(
            handlerById.get(use.exportProjectionHandlerId)?.definition.kind
          ).toBe("export_projection");
        }
        if (use.exportHandlerId !== null) {
          expect(handlerById.get(use.exportHandlerId)?.definition.kind).toBe(
            "export_execution"
          );
        }
      }
    }
  });

  it("declares provider disclosure routes only where external transmission occurs", () => {
    expect(vkAuthDataGovernance.payload.externalRoutes).toHaveLength(1);
    expect(telegramChannelDataGovernance.payload.externalRoutes).toHaveLength(
      1
    );
    expect(publicApiChannelDataGovernance.payload.externalRoutes).toHaveLength(
      0
    );

    for (const contribution of contributions) {
      const routedRoots = new Set(
        contribution.payload.externalRoutes.map((route) => route.storageRootId)
      );

      for (const use of contribution.payload.dataUses.filter((candidate) =>
        candidate.operations.includes("transmit_external")
      )) {
        expect(routedRoots.has(use.storageRootId)).toBe(true);
        expect(use.dataClassId).not.toBe(
          "core:auth_credential_session_challenge_secret"
        );
      }
    }
  });

  it("keeps live S3 objects separate from bounded object-version backup residuals", () => {
    const roots = new Map(
      s3StorageDataGovernance.payload.storageRoots.map((root) => [
        root.id,
        root.definition
      ])
    );
    const liveOriginal = s3StorageDataGovernance.payload.dataUses.find(
      (use) => use.dataClassId === "core:file_original_binary"
    );
    const objectVersion = s3StorageDataGovernance.payload.dataUses.find(
      (use) => use.dataClassId === "core:backup_copy_or_object_version"
    );

    expect(liveOriginal?.storageRootId).toBe("module:storage-s3:objects");
    expect(roots.get(liveOriginal!.storageRootId)).toMatchObject({
      kind: "object",
      versionEnumeration: "supported"
    });
    expect(objectVersion?.storageRootId).toBe(
      "module:storage-s3:object-versions"
    );
    expect(roots.get(objectVersion!.storageRootId)).toMatchObject({
      kind: "backup",
      versionEnumeration: "expiry_ledger"
    });
  });

  it("rejects an external-only module without a locally deletable lifecycle root", () => {
    expect(() =>
      createStandardModuleDataGovernance({
        moduleId: "external-only",
        storageRoots: [
          {
            localId: "remote",
            kind: "external_route",
            dataUses: [
              {
                dataClassId: "core:message_content_blocks",
                purposeIds: ["core:communication_delivery"]
              }
            ]
          }
        ]
      })
    ).toThrow(/locally deletable data root/);
  });

  it("rejects unknown core classes and purposes before emitting governance", () => {
    expect(() =>
      createStandardModuleDataGovernance({
        moduleId: "unknown-class",
        storageRoots: [
          {
            localId: "data",
            kind: "json_blob",
            dataUses: [
              {
                dataClassId: "core:not_registered",
                purposeIds: ["core:communication_delivery"]
              }
            ]
          }
        ]
      })
    ).toThrow(/unknown core class/u);

    expect(() =>
      createStandardModuleDataGovernance({
        moduleId: "wrong-purpose",
        storageRoots: [
          {
            localId: "data",
            kind: "json_blob",
            dataUses: [
              {
                dataClassId: "core:message_content_blocks",
                purposeIds: ["core:manager_reporting"]
              }
            ]
          }
        ]
      })
    ).toThrow(/is not allowed for core class/u);
  });
});
