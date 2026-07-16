import {
  INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID,
  INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION,
  calculateInboxV2CanonicalSha256,
  defineInboxV2DataLifecycleRegistry,
  defineInboxV2SourceAdapterDeclaration,
  defineInboxV2SourceConnectionRegistryState,
  defineInboxV2SourceRegistryLifecycleBinding,
  defineInboxV2SourceRegistryTransition,
  inboxV2PayloadReferenceSchema,
  type EmployeeId,
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
  employeeId?: EmployeeId;
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
    "source_onboarding_result_snapshot",
    "credential_binding",
    "source_registry_artifact",
    "source_ingress_route"
  ] as const;
  const bindings = slots.map((copySlot) => {
    const secret = copySlot === "credential_binding";
    const dataUse = registry.dataUses.find(
      (candidate) =>
        String(candidate.dataClassId).includes(
          secret ? "auth_credential" : "source_account_connector"
        ) &&
        (!secret
          ? String(candidate.storageRootId) === "core:source-registry-sql"
          : true)
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
    const purposeId =
      copySlot === "source_onboarding_result_snapshot"
        ? binding.processingPurposes.find(
            ({ id }) => String(id) === "core:source_replay_and_diagnostics"
          )!.id
        : binding.processingPurposes[0]!.id;
    return {
      registry: lifecycleBinding.payload.registry,
      copySlot,
      dataClassId: binding.dataClass.id,
      storageRootId: binding.storageRoot.id,
      purposeId,
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
          handlerId: "module:synthetic:ingress",
          sanitizerProfile: {
            schemaId: "core:inbox-v2.raw-ingress-sanitizer-profile",
            schemaVersion: "v1",
            payload: {
              adapterContract,
              handlerId: "module:synthetic:sanitize-webhook",
              handlerVersion: "v1",
              declarationRevision: "1",
              restrictedPayloadSchema: {
                schemaId: "module:synthetic:raw-webhook",
                schemaVersion: "v1"
              },
              persistedHeaderNames: ["x-request-id"],
              payloadClassification: {
                dataClassId: "core:raw_provider_payload",
                purposeIds: ["core:source_replay_and_diagnostics"]
              },
              allowedHeadersClassification: {
                dataClassId: "core:raw_provider_allowed_headers",
                purposeIds: ["core:source_replay_and_diagnostics"]
              }
            }
          }
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
        createdBy:
          input.employeeId === undefined
            ? {
                kind: "trusted_service",
                trustedServiceId: "core:source-runtime"
              }
            : {
                kind: "employee",
                employee: {
                  tenantId: input.tenantId,
                  kind: "employee",
                  id: input.employeeId
                },
                authorizationEpoch: `authorization:source-onboarding-${input.suffix}`
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
  const compatibilityConnection = {
    id: connectionId,
    tenantId: input.tenantId,
    sourceType: "messenger" as const,
    sourceName: "synthetic",
    displayName: "Synthetic",
    status: "onboarding" as const,
    authType: "webhook_secret" as const,
    createdByEmployeeId: input.employeeId ?? null,
    updatedAt: new Date(sourceRegistryFixtureOccurredAt)
  };
  const resultSnapshotId = `source-onboarding-result:${createHash("sha256")
    .update(`${input.tenantId}\u001f${input.suffix}`, "utf8")
    .digest("hex")}`;
  const auditTargetRef = internalReference(
    `${input.tenantId}:${input.suffix}:source-audit`
  );
  const tenantFacetRef = internalReference(
    `${input.tenantId}:${input.suffix}:tenant-facet`
  );
  const grantSourceMappings = [
    {
      internalReference: internalReference(
        `${input.tenantId}:${input.suffix}:grant-source`
      ),
      authorizationDecisionId: `authorization-decision:${createHash("sha256")
        .update(`${input.tenantId}\u001f${input.suffix}`, "utf8")
        .digest("hex")}`
    }
  ] as const;
  const resultReference = inboxV2PayloadReferenceSchema.parse({
    tenantId: input.tenantId,
    recordId: resultSnapshotId,
    schemaId: INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID,
    schemaVersion: INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256({
      protocol: `${INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID}@${INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION}`,
      connection: {
        id: compatibilityConnection.id,
        tenantId: compatibilityConnection.tenantId,
        sourceType: compatibilityConnection.sourceType,
        sourceName: compatibilityConnection.sourceName,
        displayName: compatibilityConnection.displayName,
        status: compatibilityConnection.status,
        authType: compatibilityConnection.authType,
        capabilities: {},
        config: {},
        diagnostics: {},
        metadata: {},
        createdByEmployeeId: compatibilityConnection.createdByEmployeeId,
        createdAt: sourceRegistryFixtureOccurredAt,
        updatedAt: sourceRegistryFixtureOccurredAt
      }
    })
  });
  const onboarding = {
    declaration,
    lifecycleBinding,
    transition,
    compatibilityConnection,
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
  };
  return {
    registry,
    connectionId,
    routeMaterial,
    secretMaterial,
    input: onboarding,
    authorizedInput: {
      onboarding,
      resultSnapshot: {
        resultReference,
        streamCommitId: `source-onboarding-commit:${createHash("sha256")
          .update(`${input.tenantId}\u001f${input.suffix}:stream`, "utf8")
          .digest("hex")}`,
        lifecycle: locator("source_onboarding_result_snapshot"),
        auditTargetRef,
        tenantFacetRef,
        grantSourceMappings
      }
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
              purposeIds: [
                "core:communication_delivery",
                "core:source_replay_and_diagnostics"
              ],
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

function internalReference(value: string): `internal-ref:${string}` {
  return `internal-ref:${createHash("sha256")
    .update(value, "utf8")
    .digest("hex")}`;
}
