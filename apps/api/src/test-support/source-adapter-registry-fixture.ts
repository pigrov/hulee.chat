import {
  calculateInboxV2BytesSha256,
  defineInboxV2DataLifecycleRegistry,
  defineInboxV2SourceAdapterDeclaration,
  defineInboxV2SourceConnectionRegistryState,
  defineInboxV2SourceRegistryLifecycleBinding,
  defineInboxV2SourceRegistryTransition,
  INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID,
  INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID,
  inboxV2SourceRegistryRelatedAuthorityReferenceSchema,
  type InboxV2SourceRegistryCopySlot,
  type InboxV2SourceRegistryLifecycleBinding,
  type InboxV2SourceRegistryLifecycleLocator
} from "@hulee/contracts";
import {
  createSourceAdapterRegistry,
  telegramChannelManifest,
  type SourceAdapterOnboardingHandler,
  type SourceAdapterOnboardingPrepareInput,
  type SourceAdapterOnboardingPrepared,
  type SourceAdapterRegistration,
  type SourceAdapterRegistry
} from "@hulee/modules";

const lifecycleModuleId = "channel-telegram";
const metadataClassId = "core:source_account_connector_metadata";
const secretClassId = "core:auth_credential_session_challenge_secret";
const sourceTypeId = "core:phone";
const adapterContract = {
  contractId: "module:megapbx:source-adapter",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:megapbx:telephony",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: "2026-01-01T00:00:00.000Z"
} as const;

export type TestMegaPbxRegistryFixture = Readonly<{
  registry: SourceAdapterRegistry;
  registration: SourceAdapterRegistration;
  onboardingHandler: SourceAdapterOnboardingHandler;
}>;

type TestMegaPbxCredentialProfile =
  | "standard_webhook_secret"
  | "unsupported_webhook_secret"
  | "none";

/**
 * API-only test authority. It deliberately composes the same branded contract
 * factories as production so service tests cannot pass with structural fakes.
 */
export function createTestMegaPbxSourceAdapterRegistry(input?: {
  credentialProfile?: TestMegaPbxCredentialProfile;
  onPrepare?: (prepareInput: SourceAdapterOnboardingPrepareInput) => void;
  transformPrepared?: (
    prepared: SourceAdapterOnboardingPrepared,
    prepareInput: SourceAdapterOnboardingPrepareInput
  ) => SourceAdapterOnboardingPrepared;
}): TestMegaPbxRegistryFixture {
  const credentialProfile =
    input?.credentialProfile ?? "standard_webhook_secret";
  const lifecycleBinding = createLifecycleBinding();
  const onboardingHandler: SourceAdapterOnboardingHandler = {
    handlerId: "module:megapbx:onboarding-v1",
    async prepare(prepareInput) {
      input?.onPrepare?.(prepareInput);
      const credential = prepareInput.credentialBindings[0];
      const ephemeral = prepareInput.ephemeralCredentials[0];

      if (
        credential === undefined ||
        ephemeral === undefined ||
        credential.bindingId !== ephemeral.bindingId
      ) {
        throw new Error("MegaPBX test handler requires one exact credential.");
      }

      const ingressRoute =
        inboxV2SourceRegistryRelatedAuthorityReferenceSchema.parse({
          tenantId: prepareInput.tenantId,
          kind: "source_ingress_route",
          authorityId: `ingress-route:megapbx:${prepareInput.sourceConnection.id}`,
          revision: "1",
          status: "active",
          sourceConnection: prepareInput.sourceConnection,
          sourceAccount: null,
          parentAuthorityId: `source:${prepareInput.sourceConnection.id}`,
          handlerGeneration: "1",
          lifecycle: lifecycleLocator(lifecycleBinding, "source_ingress_route")
        });

      if (ingressRoute.kind !== "source_ingress_route") {
        throw new Error("MegaPBX test handler requires an ingress route.");
      }
      const routeMaterial = new TextEncoder().encode(
        `route:${prepareInput.sourceConnection.id}`
      );
      const connectionHead = defineInboxV2SourceConnectionRegistryState({
        lifecycleBinding,
        value: {
          schemaId: "core:inbox-v2.source-connection-registry-state",
          schemaVersion: "v1",
          payload: {
            tenantId: prepareInput.tenantId,
            entityKind: "source_connection",
            sourceConnection: prepareInput.sourceConnection,
            sourceName: prepareInput.sourceName,
            displayName: prepareInput.displayName,
            sourceTypeId,
            adapterContract,
            lifecycle: lifecycleLocator(
              lifecycleBinding,
              "source_connection_registry"
            ),
            revision: "1",
            status: "pending",
            routeAuthority: {
              state: "denied",
              generation: "1",
              reasonCodeId: "core:onboarding",
              changedAt: prepareInput.requestedAt
            },
            artifacts: [...prepareInput.artifacts],
            credentialBindings: [...prepareInput.credentialBindings],
            relatedAuthorities: [ingressRoute],
            createdBy: prepareInput.actor,
            createdAt: prepareInput.requestedAt,
            updatedAt: prepareInput.requestedAt
          }
        }
      });
      const transition = defineInboxV2SourceRegistryTransition({
        value: {
          schemaId: "core:inbox-v2.source-registry-transition",
          schemaVersion: "v1",
          payload: {
            tenantId: prepareInput.tenantId,
            transitionId: `transition:create:${prepareInput.sourceConnection.id}`,
            entityKind: "source_connection",
            intent: "create",
            cas: {
              expectedRevision: null,
              expectedRouteGeneration: null,
              resultingRevision: "1",
              resultingRouteGeneration: "1"
            },
            lifecycle: connectionHead.payload.lifecycle,
            previousState: null,
            resultingState: connectionHead,
            relatedAuthorityTransitions: [
              {
                transitionId: `transition:route:${prepareInput.sourceConnection.id}`,
                intent: "create",
                expectedRevision: null,
                resultingRevision: "1",
                previous: null,
                resulting: ingressRoute
              }
            ],
            actor: prepareInput.actor,
            committedAt: prepareInput.requestedAt
          }
        }
      });
      const prepared: SourceAdapterOnboardingPrepared = {
        authority: {
          connection: {
            head: connectionHead,
            transitions: [transition]
          },
          accounts: [],
          ingressRoute
        },
        artifactWrites: [],
        secretWrites: [
          {
            binding: credential,
            material: ephemeral.material,
            materialDigest: calculateInboxV2BytesSha256(ephemeral.material)
          }
        ],
        routeWrites: [
          {
            route: ingressRoute,
            material: routeMaterial,
            materialDigest: calculateInboxV2BytesSha256(routeMaterial)
          }
        ],
        oneTimeResponse: {
          schemaId: INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID,
          schemaVersion: "v1",
          fields: [
            {
              fieldId: INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID,
              value: ephemeral.material
            }
          ]
        }
      };

      return input?.transformPrepared?.(prepared, prepareInput) ?? prepared;
    }
  };
  const registration: SourceAdapterRegistration = {
    declaration: defineInboxV2SourceAdapterDeclaration({
      lifecycleBinding,
      value: {
        schemaId: "core:inbox-v2.source-adapter-declaration",
        schemaVersion: "v1",
        payload: {
          sourceName: "megapbx",
          sourceTypeId,
          setupMode: "source_connection",
          adapterContract,
          lifecycleRegistry: lifecycleBinding.payload.registry,
          requiredCopySlots: [
            "source_catalog_registration",
            "source_module_registration",
            "source_connection_registry",
            "source_account_registry",
            "source_registry_artifact",
            "source_ingress_route",
            ...(credentialProfile === "none"
              ? []
              : (["credential_binding"] as const))
          ],
          supportsAccounts: true,
          accountIdentityAuthority: "db003",
          credentialMode:
            credentialProfile === "none" ? "none" : "revocable_secret_binding",
          configurationSchema: null,
          capabilitySchema: null,
          metadataSchema: null,
          diagnosticSchema: null,
          onboarding: {
            mode: "standalone",
            handlerId: onboardingHandler.handlerId,
            oneTimeResponse:
              credentialProfile === "standard_webhook_secret"
                ? {
                    schemaId:
                      INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID,
                    schemaVersion: "v1",
                    fieldIds: [
                      INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID
                    ]
                  }
                : null
          },
          ingress: {
            mode: "webhook",
            handlerId: "module:megapbx:ingress-v1"
          }
        }
      }
    }),
    lifecycleBinding,
    onboardingHandler,
    ingressHandler: {
      handlerId: "module:megapbx:ingress-v1",
      async dispatch() {
        return { accepted: true, diagnosticCodeId: null };
      }
    }
  };

  return {
    registry: createSourceAdapterRegistry({ registrations: [registration] }),
    registration,
    onboardingHandler
  };
}

function createLifecycleBinding(): InboxV2SourceRegistryLifecycleBinding {
  if (telegramChannelManifest.dataHandling !== "tenant_or_customer_data") {
    throw new Error("Telegram test manifest must declare data governance.");
  }
  const registry = defineInboxV2DataLifecycleRegistry({
    moduleContributions: [telegramChannelManifest.dataGovernance]
  });
  const registryReference = {
    id: `module:${lifecycleModuleId}:lifecycle`,
    revision: "1",
    compositionHash: String(registry.compositionHash)
  };
  const bindings = JSON.parse(
    JSON.stringify([
      lifecycleBindingEntry(
        registry,
        "source_catalog_registration",
        metadataClassId
      ),
      lifecycleBindingEntry(
        registry,
        "source_module_registration",
        metadataClassId
      ),
      lifecycleBindingEntry(
        registry,
        "source_connection_registry",
        metadataClassId
      ),
      lifecycleBindingEntry(
        registry,
        "source_account_registry",
        metadataClassId
      ),
      lifecycleBindingEntry(
        registry,
        "source_registry_artifact",
        metadataClassId
      ),
      lifecycleBindingEntry(registry, "source_ingress_route", metadataClassId),
      lifecycleBindingEntry(registry, "credential_binding", secretClassId)
    ])
  ) as Parameters<
    typeof defineInboxV2SourceRegistryLifecycleBinding
  >[0]["value"]["payload"]["bindings"];

  return defineInboxV2SourceRegistryLifecycleBinding({
    registry,
    value: {
      schemaId: "core:inbox-v2.source-registry-lifecycle-binding",
      schemaVersion: "v1",
      payload: {
        registry: registryReference,
        bindings
      }
    }
  });
}

function lifecycleBindingEntry(
  registry: ReturnType<typeof defineInboxV2DataLifecycleRegistry>,
  copySlot: InboxV2SourceRegistryCopySlot,
  dataClassId: string
) {
  const dataUse = registry.dataUses.find(
    (candidate) => String(candidate.dataClassId) === dataClassId
  );
  const dataClass = registry.dataClasses.find(
    (candidate) => String(candidate.id) === dataClassId
  );
  const storageRoot = registry.storageRoots.find(
    (candidate) => String(candidate.id) === String(dataUse?.storageRootId)
  );
  const purpose = registry.processingPurposes.find(
    (candidate) => String(candidate.id) === String(dataUse?.purposeIds[0])
  );

  if (!dataUse || !dataClass || !storageRoot || !purpose) {
    throw new Error("Incomplete API source-registry test lifecycle authority.");
  }

  return {
    copySlot,
    owner: { kind: "module" as const, moduleId: lifecycleModuleId },
    lineageRevision: "1",
    dataClass: clone({ id: dataClass.id, definition: dataClass.definition }),
    storageRoot: clone({
      id: storageRoot.id,
      definition: storageRoot.definition
    }),
    processingPurposes: [
      clone({ id: purpose.id, definition: purpose.definition })
    ],
    dataUse: clone({
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
    })
  };
}

function lifecycleLocator(
  binding: InboxV2SourceRegistryLifecycleBinding,
  copySlot: InboxV2SourceRegistryCopySlot
): InboxV2SourceRegistryLifecycleLocator {
  const entry = binding.payload.bindings.find(
    (candidate) => candidate.copySlot === copySlot
  );
  const purpose = entry?.processingPurposes[0];

  if (!entry || !purpose) {
    throw new Error(`Missing ${copySlot} lifecycle test binding.`);
  }

  return {
    registry: binding.payload.registry,
    copySlot,
    dataClassId: entry.dataClass.id,
    storageRootId: entry.storageRoot.id,
    purposeId: purpose.id,
    lineageRevision: entry.lineageRevision
  };
}

function clone<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}
