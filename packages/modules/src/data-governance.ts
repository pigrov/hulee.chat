import {
  INBOX_V2_CORE_DATA_CLASS_CATALOG,
  type InboxV2DataClassDefinition,
  type ModuleManifestInput
} from "@hulee/contracts";

type DataBearingManifestInput = Extract<
  ModuleManifestInput,
  { dataHandling: "tenant_or_customer_data" }
>;
type ModuleDataGovernanceInput = DataBearingManifestInput["dataGovernance"];

type StorageRootKind =
  | "sql"
  | "json_blob"
  | "object"
  | "index_cache"
  | "log_trace"
  | "backup"
  | "external_route";
type DataOperation =
  | "read"
  | "persist"
  | "derive"
  | "export"
  | "delete"
  | "verify_absence"
  | "transmit_external";

type DataUseInput = Readonly<{
  dataClassId: `core:${string}`;
  purposeIds: readonly `core:${string}`[];
}>;

type StorageRootInput = Readonly<{
  localId: string;
  kind: StorageRootKind;
  dataUses: readonly DataUseInput[];
}>;

type ExternalRouteInput = Readonly<{
  localId: string;
  storageRootLocalId: string;
  dataClassIds: readonly `core:${string}`[];
  purposeId: `core:${string}`;
  recipientCategoryLocalId: string;
  regionProfileLocalId: string;
}>;

type StandardGovernanceInput = Readonly<{
  moduleId: string;
  storageRoots: readonly StorageRootInput[];
  externalRoutes?: readonly ExternalRouteInput[];
}>;

type ResolvedDataUse = Readonly<{
  input: DataUseInput;
  dataClass: InboxV2DataClassDefinition;
  operations: readonly DataOperation[];
}>;

const coreDataClassById = new Map<string, InboxV2DataClassDefinition>(
  INBOX_V2_CORE_DATA_CLASS_CATALOG.payload.entries.map(
    (entry) =>
      [
        String(entry.id),
        entry.definition as InboxV2DataClassDefinition
      ] as const
  )
);

/**
 * Standard modules currently operate only on core-owned classes. This builder
 * gives each physical/remote surface a module namespace and wires the complete
 * lifecycle/delete/verification/uninstall handler set required by ADR 0015.
 */
export function createStandardModuleDataGovernance(
  input: StandardGovernanceInput
): ModuleDataGovernanceInput {
  const namespace = `module:${input.moduleId}` as const;
  const lifecycleHandlerId = `${namespace}:lifecycle` as const;
  const deleteHandlerId = `${namespace}:delete` as const;
  const verificationHandlerId = `${namespace}:verify` as const;
  const migrationAndUninstallHandlerId =
    `${namespace}:migration-uninstall` as const;
  const externalDeletionHandlerId = `${namespace}:external-delete` as const;
  const subjectDiscoveryHandlerId = `${namespace}:subject-discovery` as const;
  const exportProjectionHandlerId = `${namespace}:export-projection` as const;
  const exportExecutionHandlerId = `${namespace}:export-execution` as const;
  const resolvedRoots = input.storageRoots.map((root) => ({
    root,
    dataUses: root.dataUses.map((use) => resolveDataUse(root.kind, use))
  }));
  const rootKinds = unique(resolvedRoots.map(({ root }) => root.kind));
  const localRootKinds = unique(
    resolvedRoots
      .filter(({ root }) => root.kind !== "external_route")
      .map(({ root }) => root.kind)
  );
  const supportedOperations = unique(
    resolvedRoots.flatMap(({ dataUses }) =>
      dataUses.flatMap((use) => use.operations)
    )
  );
  const subjectRootKinds = unique(
    resolvedRoots
      .filter(({ dataUses }) =>
        dataUses.some(
          ({ dataClass }) => dataClass.subjectLinkBehavior !== "none"
        )
      )
      .map(({ root }) => root.kind)
  );
  const exportRootKinds = unique(
    resolvedRoots
      .filter(
        ({ root, dataUses }) =>
          root.kind !== "external_route" &&
          dataUses.some(({ dataClass }) => dataClass.exportBehavior !== "never")
      )
      .map(({ root }) => root.kind)
  );
  const hasExternalRoute = rootKinds.includes("external_route");

  if (rootKinds.length === 0 || localRootKinds.length === 0) {
    throw new Error(
      `Module ${input.moduleId} must declare at least one locally deletable data root.`
    );
  }

  const handlers: ModuleDataGovernanceInput["payload"]["handlers"] = [
    {
      id: lifecycleHandlerId,
      definition: handlerDefinition({
        kind: "lifecycle",
        supportedRootKinds: rootKinds,
        supportedOperations
      })
    },
    {
      id: deleteHandlerId,
      definition: handlerDefinition({
        kind: "delete_execution",
        supportedRootKinds: localRootKinds,
        supportedOperations: ["delete"]
      })
    },
    {
      id: verificationHandlerId,
      definition: handlerDefinition({
        kind: "verification",
        supportedRootKinds: localRootKinds,
        supportedOperations: ["verify_absence"],
        verifiesAbsence: true
      })
    },
    {
      id: migrationAndUninstallHandlerId,
      definition: handlerDefinition({
        kind: "migration_uninstall",
        supportedRootKinds: rootKinds,
        supportedOperations: ["read"]
      })
    }
  ];

  if (subjectRootKinds.length > 0) {
    handlers.push({
      id: subjectDiscoveryHandlerId,
      definition: handlerDefinition({
        kind: "subject_discovery",
        supportedRootKinds: subjectRootKinds,
        supportedOperations: ["read"]
      })
    });
  }

  if (exportRootKinds.length > 0) {
    handlers.push(
      {
        id: exportProjectionHandlerId,
        definition: handlerDefinition({
          kind: "export_projection",
          supportedRootKinds: exportRootKinds,
          supportedOperations: ["export"]
        })
      },
      {
        id: exportExecutionHandlerId,
        definition: handlerDefinition({
          kind: "export_execution",
          supportedRootKinds: exportRootKinds,
          supportedOperations: ["export"]
        })
      }
    );
  }

  if (hasExternalRoute) {
    handlers.push({
      id: externalDeletionHandlerId,
      definition: handlerDefinition({
        kind: "external_deletion",
        supportedRootKinds: ["external_route"],
        supportedOperations: ["transmit_external"]
      })
    });
  }

  return {
    schemaId: "core:inbox-v2.module-data-governance",
    schemaVersion: "v1",
    payload: {
      moduleId: input.moduleId,
      dataHandling: "tenant_or_customer_data",
      processingPurposes: [],
      retentionRules: [],
      retentionAnchors: [],
      handlers,
      storageRoots: resolvedRoots.map(({ root }) => ({
        id: `${namespace}:${root.localId}`,
        definition: {
          kind: root.kind,
          boundary:
            root.kind === "external_route"
              ? "outside_operated_data_plane"
              : "operated_data_plane",
          tenantIsolation: "required",
          versionEnumeration:
            root.kind === "object"
              ? "supported"
              : root.kind === "backup"
                ? "expiry_ledger"
                : "not_applicable",
          configurationProfileId: `${namespace}:storage-profile`
        }
      })),
      dataClasses: [],
      dataUses: resolvedRoots.flatMap(({ root, dataUses }) =>
        dataUses.map((use) => {
          const external = root.kind === "external_route";
          const subjectBearing = use.dataClass.subjectLinkBehavior !== "none";
          const exportable =
            !external && use.dataClass.exportBehavior !== "never";

          return {
            dataClassId: use.input.dataClassId,
            storageRootId: `${namespace}:${root.localId}`,
            purposeIds: [...use.input.purposeIds],
            operations: [...use.operations],
            canonicalAnchorId: use.dataClass.canonicalAnchorId,
            lifecycleHandlerId,
            subjectDiscoveryHandlerId: subjectBearing
              ? subjectDiscoveryHandlerId
              : null,
            exportProjectionHandlerId: exportable
              ? exportProjectionHandlerId
              : null,
            exportHandlerId: exportable ? exportExecutionHandlerId : null,
            deleteHandlerId: external ? null : deleteHandlerId,
            verificationHandlerId: external ? null : verificationHandlerId
          };
        })
      ),
      externalRoutes: (input.externalRoutes ?? []).map((route) => ({
        id: `${namespace}:${route.localId}`,
        storageRootId: `${namespace}:${route.storageRootLocalId}`,
        dataClassIds: [...route.dataClassIds],
        purposeId: route.purposeId,
        recipientCategoryId: `${namespace}:${route.recipientCategoryLocalId}`,
        regionProfile: {
          id: `${namespace}:${route.regionProfileLocalId}`,
          version: "1"
        },
        deleteCapabilityHandlerId: externalDeletionHandlerId
      })),
      migrationAndUninstallHandlerId
    }
  };
}

function handlerDefinition(input: {
  kind:
    | "lifecycle"
    | "subject_discovery"
    | "export_projection"
    | "export_execution"
    | "delete_execution"
    | "verification"
    | "external_deletion"
    | "migration_uninstall";
  supportedRootKinds: readonly StorageRootKind[];
  supportedOperations: readonly DataOperation[];
  verifiesAbsence?: boolean;
}) {
  return {
    kind: input.kind,
    supportedRootKinds: [...input.supportedRootKinds],
    supportedOperations: [...input.supportedOperations],
    bounded: true as const,
    idempotent: true as const,
    checksTenantFence: true as const,
    checksRevisionFence: true as const,
    checksHoldFence: true,
    verifiesAbsence: input.verifiesAbsence ?? false
  };
}

function resolveDataUse(
  rootKind: StorageRootKind,
  input: DataUseInput
): ResolvedDataUse {
  const dataClass = coreDataClassById.get(input.dataClassId);
  if (dataClass === undefined) {
    throw new Error(
      `Standard module data use references unknown core class ${input.dataClassId}.`
    );
  }
  for (const purposeId of input.purposeIds) {
    if (
      !dataClass.allowedPurposeIds.some(
        (allowedPurposeId) => String(allowedPurposeId) === purposeId
      )
    ) {
      throw new Error(
        `Purpose ${purposeId} is not allowed for core class ${input.dataClassId}.`
      );
    }
  }

  if (rootKind === "external_route") {
    return { input, dataClass, operations: ["transmit_external"] };
  }

  return {
    input,
    dataClass,
    operations: [
      "read",
      "persist",
      ...(dataClass.exportBehavior === "never" ? [] : (["export"] as const)),
      "delete",
      "verify_absence"
    ]
  };
}

function unique<TValue>(values: readonly TValue[]): TValue[] {
  return [...new Set(values)];
}

export const localAuthDataGovernance = createStandardModuleDataGovernance({
  moduleId: "auth-local",
  storageRoots: [
    {
      localId: "credential-store",
      kind: "json_blob",
      dataUses: [
        {
          dataClassId: "core:auth_credential_session_challenge_secret",
          purposeIds: ["core:security_and_fraud_prevention"]
        },
        {
          dataClassId: "core:auth_security_outcome",
          purposeIds: ["core:security_and_fraud_prevention"]
        }
      ]
    }
  ]
});

export const vkAuthDataGovernance = createStandardModuleDataGovernance({
  moduleId: "auth-vk",
  storageRoots: [
    {
      localId: "auth-config-and-outcome",
      kind: "json_blob",
      dataUses: [
        {
          dataClassId: "core:auth_credential_session_challenge_secret",
          purposeIds: ["core:security_and_fraud_prevention"]
        },
        {
          dataClassId: "core:auth_security_outcome",
          purposeIds: ["core:security_and_fraud_prevention"]
        }
      ]
    },
    {
      localId: "vk-oauth-route",
      kind: "external_route",
      dataUses: [
        {
          dataClassId: "core:auth_security_outcome",
          purposeIds: ["core:security_and_fraud_prevention"]
        }
      ]
    }
  ],
  externalRoutes: [
    {
      localId: "vk-oauth-disclosure",
      storageRootLocalId: "vk-oauth-route",
      dataClassIds: ["core:auth_security_outcome"],
      purposeId: "core:security_and_fraud_prevention",
      recipientCategoryLocalId: "vk-oauth-provider",
      regionProfileLocalId: "vk-oauth-region"
    }
  ]
});

export const publicApiChannelDataGovernance =
  createStandardModuleDataGovernance({
    moduleId: "channel-public-api",
    storageRoots: [
      {
        localId: "ingress-envelope",
        kind: "json_blob",
        dataUses: [
          {
            dataClassId: "core:raw_event_envelope",
            purposeIds: ["core:source_replay_and_diagnostics"]
          },
          {
            dataClassId: "core:raw_provider_payload",
            purposeIds: ["core:source_replay_and_diagnostics"]
          }
        ]
      }
    ]
  });

export const telegramChannelDataGovernance = createStandardModuleDataGovernance(
  {
    moduleId: "channel-telegram",
    storageRoots: [
      {
        localId: "ingress-envelope",
        kind: "json_blob",
        dataUses: [
          {
            dataClassId: "core:raw_event_envelope",
            purposeIds: ["core:source_replay_and_diagnostics"]
          },
          {
            dataClassId: "core:raw_provider_payload",
            purposeIds: ["core:source_replay_and_diagnostics"]
          },
          {
            dataClassId: "core:source_account_connector_metadata",
            purposeIds: ["core:communication_delivery"]
          }
        ]
      },
      {
        localId: "credential-secret",
        kind: "json_blob",
        dataUses: [
          {
            dataClassId: "core:auth_credential_session_challenge_secret",
            purposeIds: ["core:security_and_fraud_prevention"]
          }
        ]
      },
      {
        localId: "telegram-bot-api-route",
        kind: "external_route",
        dataUses: [
          {
            dataClassId: "core:message_content_blocks",
            purposeIds: ["core:communication_delivery"]
          },
          {
            dataClassId: "core:file_original_binary",
            purposeIds: ["core:communication_delivery"]
          }
        ]
      }
    ],
    externalRoutes: [
      {
        localId: "telegram-bot-api-disclosure",
        storageRootLocalId: "telegram-bot-api-route",
        dataClassIds: [
          "core:message_content_blocks",
          "core:file_original_binary"
        ],
        purposeId: "core:communication_delivery",
        recipientCategoryLocalId: "telegram-provider",
        regionProfileLocalId: "telegram-provider-region"
      }
    ]
  }
);

export const s3StorageDataGovernance = createStandardModuleDataGovernance({
  moduleId: "storage-s3",
  storageRoots: [
    {
      localId: "objects",
      kind: "object",
      dataUses: [
        {
          dataClassId: "core:file_original_binary",
          purposeIds: ["core:communication_delivery"]
        },
        {
          dataClassId: "core:file_derived_binary",
          purposeIds: ["core:communication_delivery"]
        },
        {
          dataClassId: "core:export_partial_artifact",
          purposeIds: ["core:data_subject_request_execution"]
        },
        {
          dataClassId: "core:export_ready_artifact",
          purposeIds: ["core:data_subject_request_execution"]
        },
        {
          dataClassId: "core:tenant_brand_asset",
          purposeIds: ["core:customer_service_history"]
        }
      ]
    },
    {
      localId: "object-versions",
      kind: "backup",
      dataUses: [
        {
          dataClassId: "core:backup_copy_or_object_version",
          purposeIds: ["core:security_and_fraud_prevention"]
        }
      ]
    }
  ]
});

export const basicLicenseDataGovernance = createStandardModuleDataGovernance({
  moduleId: "license-basic",
  storageRoots: [
    {
      localId: "local-license-snapshot",
      kind: "json_blob",
      dataUses: [
        {
          dataClassId: "core:usage_billing_entitlement_fact",
          purposeIds: ["core:contract_and_billing_evidence"]
        }
      ]
    }
  ]
});
