import {
  defineInboxV2DataLifecycleRegistry,
  defineInboxV2SourceAdapterDeclaration,
  defineInboxV2SourceConnectionRegistryState,
  defineInboxV2SourceRegistryLifecycleBinding,
  defineInboxV2SourceRegistryTransition,
  type InboxV2SourceRegistryArtifactReference,
  type InboxV2SourceRegistryRelatedAuthorityReference,
  type InboxV2SourceRegistrySecretReference,
  type SourceConnectionId,
  type TenantId
} from "@hulee/contracts";
import { createHash } from "node:crypto";

export const sourceRegistryFixtureOccurredAt = new Date(
  Date.now() - 60_000
).toISOString();

export function createInboxV2SourceRegistryOnboardingFixture(input: {
  tenantId: TenantId;
  suffix: string;
  registryId?: string;
  includeArtifact?: boolean;
}) {
  const registry = lifecycleRegistry();
  const registryReference = {
    id: input.registryId ?? "core:source-registry-lifecycle",
    revision: "7",
    compositionHash: String(registry.compositionHash)
  } as const;
  const slots = [
    "source_catalog_registration",
    "source_module_registration",
    "source_connection_registry",
    "credential_binding",
    "source_registry_artifact",
    "source_ingress_route"
  ] as const;
  const bindings = slots.map((copySlot) => {
    const secret = copySlot === "credential_binding";
    const dataUse = registry.dataUses.find((candidate) =>
      String(candidate.dataClassId).includes(
        secret ? "auth_credential" : "source_account_connector"
      )
    )!;
    const dataClass = registry.dataClasses.find(
      (candidate) => String(candidate.id) === String(dataUse.dataClassId)
    )!;
    const storageRoot = registry.storageRoots.find(
      (candidate) => String(candidate.id) === String(dataUse.storageRootId)
    )!;
    return {
      copySlot,
      owner: { kind: "core" as const },
      lineageRevision: "11",
      dataClass: { id: dataClass.id, definition: dataClass.definition },
      storageRoot: { id: storageRoot.id, definition: storageRoot.definition },
      processingPurposes: dataUse.purposeIds.map((id) => ({
        id,
        definition: registry.processingPurposes.find(
          (candidate) => String(candidate.id) === String(id)
        )!.definition
      })),
      dataUse: {
        dataClassId: dataUse.dataClassId,
        storageRootId: dataUse.storageRootId,
        purposeIds: dataUse.purposeIds,
        operations: dataUse.operations,
        canonicalAnchorId: dataUse.canonicalAnchorId,
        lifecycleHandlerId: dataUse.lifecycleHandlerId,
        subjectDiscoveryHandlerId: dataUse.subjectDiscoveryHandlerId,
        exportProjectionHandlerId: dataUse.exportProjectionHandlerId,
        exportHandlerId: dataUse.exportHandlerId,
        deleteHandlerId: dataUse.deleteHandlerId,
        verificationHandlerId: dataUse.verificationHandlerId
      }
    };
  });
  const lifecycleBinding = defineInboxV2SourceRegistryLifecycleBinding({
    registry,
    value: {
      schemaId: "core:inbox-v2.source-registry-lifecycle-binding",
      schemaVersion: "v1",
      payload: {
        registry: registryReference,
        bindings: structuredClone(bindings) as never
      }
    }
  });
  const locator = (copySlot: (typeof slots)[number]) => {
    const binding = lifecycleBinding.payload.bindings.find(
      (candidate) => candidate.copySlot === copySlot
    )!;
    return {
      registry: lifecycleBinding.payload.registry,
      copySlot,
      dataClassId: binding.dataClass.id,
      storageRootId: binding.storageRoot.id,
      purposeId: binding.processingPurposes[0]!.id,
      lineageRevision: binding.lineageRevision
    };
  };
  const adapterContract = {
    contractId: "module:synthetic:source-adapter",
    contractVersion: "v1",
    declarationRevision: "1",
    surfaceId: "module:synthetic:direct-messenger",
    loadedByTrustedServiceId: "core:source-runtime",
    loadedAt: sourceRegistryFixtureOccurredAt
  } as const;
  const declaration = defineInboxV2SourceAdapterDeclaration({
    lifecycleBinding,
    value: {
      schemaId: "core:inbox-v2.source-adapter-declaration",
      schemaVersion: "v1",
      payload: {
        sourceName: "synthetic",
        sourceTypeId: "core:messenger",
        setupMode: "source_connection",
        adapterContract,
        lifecycleRegistry: lifecycleBinding.payload.registry,
        requiredCopySlots: [...slots],
        supportsAccounts: false,
        accountIdentityAuthority: "not_applicable",
        credentialMode: "revocable_secret_binding",
        configurationSchema: input.includeArtifact
          ? {
              schemaId: "module:synthetic:configuration",
              supportedVersions: ["v1"]
            }
          : null,
        capabilitySchema: null,
        metadataSchema: null,
        diagnosticSchema: null,
        onboarding: {
          mode: "standalone",
          handlerId: "module:synthetic:onboarding",
          oneTimeResponse: null
        },
        ingress: {
          mode: "webhook",
          handlerId: "module:synthetic:ingress"
        }
      }
    }
  });
  const connectionId =
    `source_connection:synthetic-${input.suffix}` as SourceConnectionId;
  const secretMaterial = new TextEncoder().encode(
    `exact-secret-bytes-${input.suffix}`
  );
  const routeMaterial = new TextEncoder().encode(
    `exact-route-bytes-${input.suffix}`
  );
  const secretBinding = {
    tenantId: input.tenantId,
    bindingId: `credential-binding:synthetic-${input.suffix}`,
    revision: "1",
    status: "active",
    lifecycle: locator("credential_binding")
  } as unknown as InboxV2SourceRegistrySecretReference;
  const route: Extract<
    InboxV2SourceRegistryRelatedAuthorityReference,
    { kind: "source_ingress_route" }
  > = {
    kind: "source_ingress_route",
    tenantId: input.tenantId,
    authorityId: `source-ingress-route:synthetic-${input.suffix}`,
    revision: "1",
    status: "active",
    sourceConnection: {
      tenantId: input.tenantId,
      kind: "source_connection",
      id: connectionId
    },
    sourceAccount: null,
    lifecycle: locator("source_ingress_route"),
    parentAuthorityId: connectionId,
    handlerGeneration: "1"
  } as unknown as Extract<
    InboxV2SourceRegistryRelatedAuthorityReference,
    { kind: "source_ingress_route" }
  >;
  const artifactMaterial = new TextEncoder().encode(
    `classified-artifact-${input.suffix}`
  );
  const artifact = {
    kind: "configuration",
    payload: {
      tenantId: input.tenantId,
      recordId: `payload:source-registry-config-${input.suffix}`,
      schemaId: "module:synthetic:configuration",
      schemaVersion: "v1",
      digest: prefixedDigest(artifactMaterial)
    },
    lifecycle: locator("source_registry_artifact")
  } as unknown as InboxV2SourceRegistryArtifactReference;
  const state = defineInboxV2SourceConnectionRegistryState({
    lifecycleBinding,
    value: {
      schemaId: "core:inbox-v2.source-connection-registry-state",
      schemaVersion: "v1",
      payload: {
        tenantId: input.tenantId,
        entityKind: "source_connection",
        sourceConnection: {
          tenantId: input.tenantId,
          kind: "source_connection",
          id: connectionId
        },
        sourceName: "synthetic",
        displayName: "Synthetic",
        sourceTypeId: "core:messenger",
        adapterContract,
        lifecycle: locator("source_connection_registry"),
        revision: "1",
        status: "pending",
        routeAuthority: {
          state: "denied",
          generation: "1",
          reasonCodeId: "core:onboarding",
          changedAt: sourceRegistryFixtureOccurredAt
        },
        artifacts: input.includeArtifact ? [artifact] : [],
        credentialBindings: [secretBinding],
        relatedAuthorities: [route],
        createdBy: {
          kind: "trusted_service",
          trustedServiceId: "core:source-runtime"
        },
        createdAt: sourceRegistryFixtureOccurredAt,
        updatedAt: sourceRegistryFixtureOccurredAt
      }
    }
  });
  const transition = defineInboxV2SourceRegistryTransition({
    value: {
      schemaId: "core:inbox-v2.source-registry-transition",
      schemaVersion: "v1",
      payload: {
        tenantId: input.tenantId,
        transitionId: `source-registry-transition:create-${input.suffix}`,
        entityKind: "source_connection",
        intent: "create",
        cas: {
          expectedRevision: null,
          expectedRouteGeneration: null,
          resultingRevision: "1",
          resultingRouteGeneration: "1"
        },
        lifecycle: state.payload.lifecycle,
        previousState: null,
        resultingState: state,
        relatedAuthorityTransitions: [
          {
            transitionId: `related-transition:create-route-${input.suffix}`,
            intent: "create",
            expectedRevision: null,
            resultingRevision: "1",
            previous: null,
            resulting: route
          }
        ],
        actor: state.payload.createdBy,
        committedAt: sourceRegistryFixtureOccurredAt
      }
    }
  });
  return {
    registry,
    connectionId,
    routeMaterial,
    secretMaterial,
    input: {
      declaration,
      lifecycleBinding,
      transition,
      compatibilityConnection: {
        id: connectionId,
        tenantId: input.tenantId,
        sourceType: "messenger" as const,
        sourceName: "synthetic",
        displayName: "Synthetic",
        status: "onboarding" as const,
        authType: "webhook_secret" as const,
        createdByEmployeeId: null,
        updatedAt: new Date(sourceRegistryFixtureOccurredAt)
      },
      artifactWrites: input.includeArtifact
        ? [{ artifact, material: artifactMaterial }]
        : [],
      secretWrites: [
        {
          binding: secretBinding,
          material: secretMaterial,
          materialDigest: prefixedDigest(secretMaterial)
        }
      ],
      routeWrites: [
        {
          route,
          material: routeMaterial,
          materialDigest: prefixedDigest(routeMaterial)
        }
      ]
    }
  };
}

function lifecycleRegistry() {
  const handler = (
    kind:
      | "lifecycle"
      | "subject_discovery"
      | "export_projection"
      | "export_execution"
      | "delete_execution"
      | "verification",
    operations: readonly (
      | "read"
      | "persist"
      | "export"
      | "delete"
      | "verify_absence"
    )[],
    verifiesAbsence = false
  ) => ({
    kind,
    supportedRootKinds: ["sql" as const],
    supportedOperations: [...operations],
    bounded: true as const,
    idempotent: true as const,
    checksTenantFence: true as const,
    checksRevisionFence: true as const,
    checksHoldFence: true,
    verifiesAbsence
  });
  return defineInboxV2DataLifecycleRegistry({
    coreStorageRootRegistrations: [
      {
        schemaId: "core:inbox-v2.catalog-registration",
        schemaVersion: "v1",
        payload: {
          catalog: "storage-root",
          owner: { kind: "core" },
          entries: [
            {
              id: "core:source-registry-sql",
              definition: {
                kind: "sql",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.sql"
              }
            }
          ]
        }
      }
    ],
    coreLifecycleHandlerRegistrations: [
      {
        schemaId: "core:inbox-v2.catalog-registration",
        schemaVersion: "v1",
        payload: {
          catalog: "lifecycle-handler",
          owner: { kind: "core" },
          entries: [
            {
              id: "core:source-registry-lifecycle",
              definition: handler("lifecycle", [
                "persist",
                "export",
                "delete",
                "verify_absence"
              ])
            },
            {
              id: "core:source-registry-subject-discovery",
              definition: handler("subject_discovery", ["read"])
            },
            {
              id: "core:source-registry-export-projection",
              definition: handler("export_projection", ["export"])
            },
            {
              id: "core:source-registry-export",
              definition: handler("export_execution", ["export"])
            },
            {
              id: "core:source-registry-delete",
              definition: handler("delete_execution", ["delete"])
            },
            {
              id: "core:source-registry-verify",
              definition: handler("verification", ["verify_absence"], true)
            }
          ]
        }
      }
    ],
    coreDataUseRegistrations: [
      {
        schemaId: "core:inbox-v2.core-data-use-registration",
        schemaVersion: "v1",
        payload: {
          dataUses: [
            {
              dataClassId: "core:source_account_connector_metadata",
              storageRootId: "core:source-registry-sql",
              purposeIds: ["core:communication_delivery"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:disconnect_or_account_termination",
              lifecycleHandlerId: "core:source-registry-lifecycle",
              subjectDiscoveryHandlerId:
                "core:source-registry-subject-discovery",
              exportProjectionHandlerId:
                "core:source-registry-export-projection",
              exportHandlerId: "core:source-registry-export",
              deleteHandlerId: "core:source-registry-delete",
              verificationHandlerId: "core:source-registry-verify"
            },
            {
              dataClassId: "core:auth_credential_session_challenge_secret",
              storageRootId: "core:source-registry-sql",
              purposeIds: ["core:security_and_fraud_prevention"],
              operations: ["persist", "delete", "verify_absence"],
              canonicalAnchorId: "core:revoke_expiry_or_completion",
              lifecycleHandlerId: "core:source-registry-lifecycle",
              subjectDiscoveryHandlerId: null,
              exportProjectionHandlerId: null,
              exportHandlerId: null,
              deleteHandlerId: "core:source-registry-delete",
              verificationHandlerId: "core:source-registry-verify"
            }
          ]
        }
      }
    ]
  });
}

function prefixedDigest(material: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}
