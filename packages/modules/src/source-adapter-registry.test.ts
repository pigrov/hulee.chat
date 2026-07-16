import {
  calculateInboxV2BytesSha256,
  defineInboxV2DataLifecycleRegistry,
  defineInboxV2SourceAdapterDeclaration,
  defineInboxV2SourceConnectionRegistryState,
  defineInboxV2SourceRegistryLifecycleBinding,
  defineInboxV2SourceRegistryTransition,
  inboxV2SourceRegistryArtifactReferenceSchema,
  inboxV2SourceRegistryRelatedAuthorityReferenceSchema,
  inboxV2SourceRegistrySecretReferenceSchema,
  inboxV2TenantIdSchema,
  type InboxV2SourceRegistryLifecycleBinding
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  createSourceAdapterRegistry,
  isSourceAdapterRegistry,
  SourceAdapterRegistryError,
  type SourceAdapterIngressDispatchInput,
  type SourceAdapterIngressDispatchResult,
  type SourceAdapterIngressHandler,
  type SourceAdapterOnboardingHandler,
  type SourceAdapterOnboardingPrepareInput,
  type SourceAdapterOnboardingPrepared,
  type SourceAdapterRegistration
} from "./source-adapter-registry";

const tenantId = "tenant:alpha";
const t0 = "2026-07-16T08:00:00.000Z";
const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: "source_connection:synthetic-primary"
};
const actor = {
  kind: "trusted_service" as const,
  trustedServiceId: "core:source-runtime"
};
const adapterContract = {
  contractId: "module:synthetic:source-adapter",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

type MutableOnboardingHandler = {
  handlerId: string;
  prepare: SourceAdapterOnboardingHandler["prepare"];
};

type MutableIngressHandler = {
  handlerId: string;
  dispatch: SourceAdapterIngressHandler["dispatch"];
};

function lifecycleAuthority() {
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
  const registry = defineInboxV2DataLifecycleRegistry({
    coreStorageRootRegistrations: [
      {
        schemaId: "core:inbox-v2.catalog-registration",
        schemaVersion: "v1",
        payload: {
          catalog: "storage-root",
          owner: { kind: "core" },
          entries: [
            {
              id: "core:source-adapter-registry-sql",
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
              id: "core:source-adapter-lifecycle",
              definition: handler("lifecycle", [
                "persist",
                "export",
                "delete",
                "verify_absence"
              ])
            },
            {
              id: "core:source-adapter-subject-discovery",
              definition: handler("subject_discovery", ["read"])
            },
            {
              id: "core:source-adapter-export-projection",
              definition: handler("export_projection", ["export"])
            },
            {
              id: "core:source-adapter-export",
              definition: handler("export_execution", ["export"])
            },
            {
              id: "core:source-adapter-delete",
              definition: handler("delete_execution", ["delete"])
            },
            {
              id: "core:source-adapter-verify",
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
              storageRootId: "core:source-adapter-registry-sql",
              purposeIds: ["core:communication_delivery"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:disconnect_or_account_termination",
              lifecycleHandlerId: "core:source-adapter-lifecycle",
              subjectDiscoveryHandlerId:
                "core:source-adapter-subject-discovery",
              exportProjectionHandlerId:
                "core:source-adapter-export-projection",
              exportHandlerId: "core:source-adapter-export",
              deleteHandlerId: "core:source-adapter-delete",
              verificationHandlerId: "core:source-adapter-verify"
            },
            {
              dataClassId: "core:auth_credential_session_challenge_secret",
              storageRootId: "core:source-adapter-registry-sql",
              purposeIds: ["core:security_and_fraud_prevention"],
              operations: ["persist", "delete", "verify_absence"],
              canonicalAnchorId: "core:revoke_expiry_or_completion",
              lifecycleHandlerId: "core:source-adapter-lifecycle",
              subjectDiscoveryHandlerId: null,
              exportProjectionHandlerId: null,
              exportHandlerId: null,
              deleteHandlerId: "core:source-adapter-delete",
              verificationHandlerId: "core:source-adapter-verify"
            }
          ]
        }
      }
    ]
  });
  const entry = (
    copySlot:
      | "source_connection_registry"
      | "source_onboarding_result_snapshot"
      | "credential_binding"
      | "source_registry_artifact"
      | "source_ingress_route"
      | "source_catalog_registration"
      | "source_module_registration"
  ) => {
    const secret = copySlot === "credential_binding";
    const dataUse = registry.dataUses.find((candidate) =>
      String(candidate.dataClassId).includes(
        secret ? "auth_credential" : "source_account_connector"
      )
    )!;
    const dataClass = registry.dataClasses.find(
      (candidate) => String(candidate.id) === String(dataUse.dataClassId)
    )!;
    const root = registry.storageRoots.find(
      (candidate) => String(candidate.id) === String(dataUse.storageRootId)
    )!;
    return {
      copySlot,
      owner: { kind: "core" as const },
      lineageRevision: "3",
      dataClass: JSON.parse(
        JSON.stringify({ id: dataClass.id, definition: dataClass.definition })
      ),
      storageRoot: JSON.parse(
        JSON.stringify({ id: root.id, definition: root.definition })
      ),
      processingPurposes: dataUse.purposeIds.map((purposeId) => {
        const purpose = registry.processingPurposes.find(
          (candidate) => String(candidate.id) === String(purposeId)
        )!;
        return JSON.parse(
          JSON.stringify({ id: purpose.id, definition: purpose.definition })
        );
      }),
      dataUse: JSON.parse(
        JSON.stringify({
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
      )
    };
  };
  const registryReference = {
    id: "core:source-adapter-lifecycle",
    revision: "2",
    compositionHash: String(registry.compositionHash)
  };
  const binding = defineInboxV2SourceRegistryLifecycleBinding({
    registry,
    value: {
      schemaId: "core:inbox-v2.source-registry-lifecycle-binding",
      schemaVersion: "v1",
      payload: {
        registry: registryReference,
        bindings: [
          entry("source_connection_registry"),
          entry("source_onboarding_result_snapshot"),
          entry("credential_binding"),
          entry("source_registry_artifact"),
          entry("source_ingress_route"),
          entry("source_catalog_registration"),
          entry("source_module_registration")
        ]
      }
    }
  });
  return { registry, binding };
}

function locator(
  binding: InboxV2SourceRegistryLifecycleBinding,
  copySlot:
    | "source_connection_registry"
    | "source_onboarding_result_snapshot"
    | "credential_binding"
    | "source_registry_artifact"
    | "source_ingress_route"
    | "source_catalog_registration"
    | "source_module_registration"
) {
  const entry = binding.payload.bindings.find(
    (candidate) => candidate.copySlot === copySlot
  )!;
  return {
    registry: binding.payload.registry,
    copySlot,
    dataClassId: entry.dataClass.id,
    storageRootId: entry.storageRoot.id,
    purposeId: entry.processingPurposes[0]!.id,
    lineageRevision: entry.lineageRevision
  };
}

function registrationFixture(
  input: {
    configurationArtifact?: Readonly<{
      schemaId: string;
      schemaVersion: string;
    }>;
    configurationDeclaration?: Readonly<{
      schemaId: string;
      supportedVersions: string[];
    }> | null;
    configurationMaterial?: Uint8Array;
    registrationArtifact?: Readonly<{
      kind: "catalog_registration" | "module_registration";
      schemaId: string;
      schemaVersion: string;
    }>;
    credentialMaterial?: Uint8Array;
    routeMaterial?: Uint8Array;
    oneTimeResponseProfile?: Readonly<{
      schemaId: string;
      schemaVersion: string;
      fields: readonly Readonly<{
        fieldId: string;
        value: Uint8Array;
      }>[];
    }>;
  } = {}
) {
  const { registry: lifecycleRegistry, binding } = lifecycleAuthority();
  const configurationMaterial = new Uint8Array(
    input.configurationMaterial ?? [123, 125]
  );
  const oneTimeResponseProfile = input.oneTimeResponseProfile ?? {
    schemaId: "core:source-onboarding-response",
    schemaVersion: "v1",
    fields: [
      {
        fieldId: "core:webhook-token",
        value: new Uint8Array([1, 2, 3])
      }
    ]
  };
  const configurationArtifact = input.configurationArtifact
    ? inboxV2SourceRegistryArtifactReferenceSchema.parse({
        kind: "configuration" as const,
        payload: {
          tenantId,
          recordId: "payload:configuration-0001",
          schemaId: input.configurationArtifact.schemaId,
          schemaVersion: input.configurationArtifact.schemaVersion,
          digest: calculateInboxV2BytesSha256(configurationMaterial)
        },
        lifecycle: locator(binding, "source_registry_artifact")
      })
    : null;
  const registrationMaterial = new Uint8Array([91, 93]);
  const registrationArtifact = input.registrationArtifact
    ? inboxV2SourceRegistryArtifactReferenceSchema.parse({
        kind: input.registrationArtifact.kind,
        payload: {
          tenantId,
          recordId: `payload:${input.registrationArtifact.kind}-0001`,
          schemaId: input.registrationArtifact.schemaId,
          schemaVersion: input.registrationArtifact.schemaVersion,
          digest: calculateInboxV2BytesSha256(registrationMaterial)
        },
        lifecycle: locator(
          binding,
          input.registrationArtifact.kind === "catalog_registration"
            ? "source_catalog_registration"
            : "source_module_registration"
        )
      })
    : null;
  const artifacts = [configurationArtifact, registrationArtifact].filter(
    (artifact): artifact is NonNullable<typeof artifact> => artifact !== null
  );
  const credentialBinding =
    input.credentialMaterial === undefined
      ? null
      : inboxV2SourceRegistrySecretReferenceSchema.parse({
          tenantId,
          bindingId: "credential-binding:synthetic-0001",
          revision: "1",
          status: "active",
          lifecycle: locator(binding, "credential_binding")
        });
  const parsedIngressRoute =
    inboxV2SourceRegistryRelatedAuthorityReferenceSchema.parse({
      kind: "source_ingress_route" as const,
      tenantId,
      authorityId: "ingress-route:synthetic-0001",
      revision: "1",
      status: "active" as const,
      sourceConnection,
      sourceAccount: null,
      lifecycle: locator(binding, "source_ingress_route"),
      parentAuthorityId: sourceConnection.id,
      handlerGeneration: "1"
    });
  if (parsedIngressRoute.kind !== "source_ingress_route") {
    throw new Error("Expected a source ingress route fixture.");
  }
  const ingressRoute = parsedIngressRoute;
  const routeMaterial = new Uint8Array(
    input.routeMaterial ?? new Uint8Array(32).fill(0x45)
  );
  const connectionHead = defineInboxV2SourceConnectionRegistryState({
    lifecycleBinding: binding,
    value: {
      schemaId: "core:inbox-v2.source-connection-registry-state",
      schemaVersion: "v1",
      payload: {
        tenantId,
        entityKind: "source_connection",
        sourceConnection,
        sourceName: "synthetic",
        displayName: "Synthetic",
        sourceTypeId: "core:messenger",
        adapterContract,
        lifecycle: locator(binding, "source_connection_registry"),
        revision: "1",
        status: "pending",
        routeAuthority: {
          state: "denied",
          generation: "1",
          reasonCodeId: "core:onboarding",
          changedAt: t0
        },
        artifacts,
        credentialBindings:
          credentialBinding === null ? [] : [credentialBinding],
        relatedAuthorities: [ingressRoute],
        createdBy: actor,
        createdAt: t0,
        updatedAt: t0
      }
    }
  });
  const transition = defineInboxV2SourceRegistryTransition({
    value: {
      schemaId: "core:inbox-v2.source-registry-transition",
      schemaVersion: "v1",
      payload: {
        tenantId,
        transitionId: "transition:create-0001",
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
            transitionId: "transition:route-create-0001",
            intent: "create",
            expectedRevision: null,
            resultingRevision: "1",
            previous: null,
            resulting: ingressRoute
          }
        ],
        actor,
        committedAt: t0
      }
    }
  });
  const declaration = defineInboxV2SourceAdapterDeclaration({
    lifecycleBinding: binding,
    value: {
      schemaId: "core:inbox-v2.source-adapter-declaration",
      schemaVersion: "v1",
      payload: {
        sourceName: "synthetic",
        sourceTypeId: "core:messenger",
        setupMode: "source_connection",
        adapterContract,
        lifecycleRegistry: binding.payload.registry,
        requiredCopySlots: [
          "source_connection_registry",
          "source_onboarding_result_snapshot",
          "source_registry_artifact",
          ...(credentialBinding === null
            ? []
            : ["credential_binding" as const]),
          "source_ingress_route",
          "source_catalog_registration",
          "source_module_registration"
        ],
        supportsAccounts: false,
        accountIdentityAuthority: "not_applicable",
        credentialMode:
          credentialBinding === null ? "none" : "revocable_secret_binding",
        configurationSchema:
          input.configurationDeclaration !== undefined
            ? input.configurationDeclaration
            : configurationArtifact === null
              ? null
              : {
                  schemaId: "module:synthetic:configuration",
                  supportedVersions: ["v1"]
                },
        capabilitySchema: null,
        metadataSchema: null,
        diagnosticSchema: null,
        onboarding: {
          mode: "standalone",
          handlerId: "module:synthetic:onboarding",
          oneTimeResponse: {
            schemaId: oneTimeResponseProfile.schemaId,
            schemaVersion: oneTimeResponseProfile.schemaVersion,
            fieldIds: oneTimeResponseProfile.fields.map(
              (field) => field.fieldId
            )
          }
        },
        ingress: {
          mode: "webhook",
          handlerId: "module:synthetic:ingress"
        }
      }
    }
  });
  const prepared: SourceAdapterOnboardingPrepared = {
    authority: {
      connection: { head: connectionHead, transitions: [transition] },
      accounts: [],
      ingressRoute
    },
    artifactWrites: artifacts.map((artifact) => ({
      artifact,
      material:
        artifact === configurationArtifact
          ? configurationMaterial
          : registrationMaterial
    })),
    secretWrites:
      credentialBinding === null || input.credentialMaterial === undefined
        ? []
        : [
            {
              binding: credentialBinding,
              material: new Uint8Array(input.credentialMaterial),
              materialDigest: calculateInboxV2BytesSha256(
                input.credentialMaterial
              )
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
      schemaId: oneTimeResponseProfile.schemaId,
      schemaVersion: oneTimeResponseProfile.schemaVersion,
      fields: oneTimeResponseProfile.fields.map((field) => ({
        fieldId: field.fieldId,
        value: new Uint8Array(field.value)
      }))
    }
  };
  const onboardingHandler: SourceAdapterOnboardingHandler = {
    handlerId: "module:synthetic:onboarding",
    async prepare() {
      return prepared;
    }
  };
  const ingressHandler: SourceAdapterIngressHandler = {
    handlerId: "module:synthetic:ingress",
    async dispatch() {
      return { accepted: true, diagnosticCodeId: null };
    }
  };
  const registration: SourceAdapterRegistration = {
    declaration,
    lifecycleBinding: binding,
    onboardingHandler,
    ingressHandler
  };
  const prepareInput: SourceAdapterOnboardingPrepareInput = {
    tenantId: connectionHead.payload.tenantId,
    sourceName: "synthetic",
    sourceConnection: connectionHead.payload.sourceConnection,
    actor: connectionHead.payload.createdBy,
    requestedAt: t0,
    publicBaseUrl: "https://example.test",
    displayName: "Synthetic",
    artifacts,
    credentialBindings: credentialBinding === null ? [] : [credentialBinding],
    ephemeralCredentials:
      credentialBinding === null || input.credentialMaterial === undefined
        ? []
        : [
            {
              bindingId: credentialBinding.bindingId,
              material: new Uint8Array(input.credentialMaterial)
            }
          ],
    ephemeralIngressRouteMaterial: new Uint8Array(routeMaterial)
  };
  return { lifecycleRegistry, registration, prepared, prepareInput };
}

function ingressDispatchInput(
  fixture: ReturnType<typeof registrationFixture>,
  body = new Uint8Array([10, 20, 30])
): SourceAdapterIngressDispatchInput {
  const route = fixture.prepared.authority.ingressRoute;
  if (route?.kind !== "source_ingress_route") {
    throw new Error("Expected an active ingress-route fixture.");
  }
  return {
    tenantId: fixture.prepareInput.tenantId,
    route,
    receivedAt: t0,
    body
  };
}

describe("SourceAdapterRegistry", () => {
  it("registers authentic handlers and validates prepared authority", async () => {
    const fixture = registrationFixture();
    const expected = structuredClone(fixture.prepared);
    const registry = createSourceAdapterRegistry({
      registrations: [fixture.registration]
    });
    expect(isSourceAdapterRegistry(registry)).toBe(true);
    expect(registry.listSourceNames()).toEqual(["synthetic"]);
    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).resolves.toEqual(expected);
    expect(
      Array.from(fixture.prepared.oneTimeResponse!.fields[0]!.value)
    ).toEqual([0, 0, 0]);
  });

  it("zeroes handler-owned input and prepared buffers after successful prepare", async () => {
    const credentialMaterial = new Uint8Array([7, 8, 9]);
    const fixture = registrationFixture({
      configurationArtifact: {
        schemaId: "module:synthetic:configuration",
        schemaVersion: "v1"
      },
      credentialMaterial
    });
    let retainedCredential: Uint8Array | undefined;
    const retainingHandler: SourceAdapterOnboardingHandler = {
      handlerId: "module:synthetic:onboarding",
      async prepare(input) {
        retainedCredential = input.ephemeralCredentials[0]!.material;
        return fixture.prepared;
      }
    };
    const rawArtifact = fixture.prepared.artifactWrites[0]!.material;
    const rawSecret = fixture.prepared.secretWrites[0]!.material;
    const rawRoute = fixture.prepared.routeWrites[0]!.material;
    const rawResponse = fixture.prepared.oneTimeResponse!.fields[0]!.value;
    const registry = createSourceAdapterRegistry({
      registrations: [
        { ...fixture.registration, onboardingHandler: retainingHandler }
      ]
    });

    const result = await registry
      .get("synthetic")!
      .prepare(fixture.prepareInput);

    expect(Array.from(retainedCredential!)).toEqual([0, 0, 0]);
    expect(Array.from(rawArtifact)).toEqual([0, 0]);
    expect(Array.from(rawSecret)).toEqual([0, 0, 0]);
    expect(Array.from(rawRoute)).toEqual(new Array(32).fill(0));
    expect(Array.from(rawResponse)).toEqual([0, 0, 0]);
    expect(
      Array.from(fixture.prepareInput.ephemeralCredentials[0]!.material)
    ).toEqual([7, 8, 9]);
    expect(Array.from(result.artifactWrites[0]!.material)).toEqual([123, 125]);
    expect(Array.from(result.secretWrites[0]!.material)).toEqual([7, 8, 9]);
    expect(Array.from(result.routeWrites[0]!.material)).toEqual(
      new Array(32).fill(0x45)
    );
    expect(Array.from(result.oneTimeResponse!.fields[0]!.value)).toEqual([
      1, 2, 3
    ]);
  });

  it("zeroes handler-owned credential buffers when prepare throws", async () => {
    const fixture = registrationFixture({
      credentialMaterial: new Uint8Array([7, 8, 9])
    });
    let retainedCredential: Uint8Array | undefined;
    const throwingHandler: SourceAdapterOnboardingHandler = {
      handlerId: "module:synthetic:onboarding",
      async prepare(input) {
        retainedCredential = input.ephemeralCredentials[0]!.material;
        throw new Error("synthetic adapter failure");
      }
    };
    const registry = createSourceAdapterRegistry({
      registrations: [
        { ...fixture.registration, onboardingHandler: throwingHandler }
      ]
    });

    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).rejects.toThrow("synthetic adapter failure");
    expect(Array.from(retainedCredential!)).toEqual([0, 0, 0]);
    expect(
      Array.from(fixture.prepareInput.ephemeralCredentials[0]!.material)
    ).toEqual([7, 8, 9]);
  });

  it.each(["missing", "duplicate", "digest"] as const)(
    "rejects %s transient ingress route writes",
    async (mode) => {
      const fixture = registrationFixture();
      const routeWrite = fixture.prepared.routeWrites[0]!;
      const routeWrites =
        mode === "missing"
          ? []
          : mode === "duplicate"
            ? [routeWrite, routeWrite]
            : [
                {
                  ...routeWrite,
                  materialDigest: calculateInboxV2BytesSha256(
                    new Uint8Array([9, 9, 9])
                  )
                }
              ];
      const invalidHandler: SourceAdapterOnboardingHandler = {
        handlerId: "module:synthetic:onboarding",
        async prepare() {
          return { ...fixture.prepared, routeWrites };
        }
      };
      const registry = createSourceAdapterRegistry({
        registrations: [
          { ...fixture.registration, onboardingHandler: invalidHandler }
        ]
      });

      await expect(
        registry.get("synthetic")!.prepare(fixture.prepareInput)
      ).rejects.toThrow(/route write/u);
    }
  );

  it("rejects copied ingress route material in a classified artifact", async () => {
    const routeMaterial = new Uint8Array(32).fill(0x45);
    const fixture = registrationFixture({
      configurationArtifact: {
        schemaId: "module:synthetic:configuration",
        schemaVersion: "v1"
      },
      configurationMaterial: new Uint8Array(routeMaterial),
      routeMaterial: new Uint8Array(routeMaterial)
    });
    expect(fixture.prepared.artifactWrites[0]!.material).not.toBe(
      fixture.prepareInput.ephemeralIngressRouteMaterial
    );
    const registry = createSourceAdapterRegistry({
      registrations: [fixture.registration]
    });

    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).rejects.toThrow(/route material must be independent/u);
  });

  it("rejects copied ingress route material in a classified secret write", async () => {
    const routeMaterial = new Uint8Array(32).fill(0x45);
    const fixture = registrationFixture({
      credentialMaterial: new Uint8Array(routeMaterial),
      routeMaterial: new Uint8Array(routeMaterial)
    });
    const registry = createSourceAdapterRegistry({
      registrations: [fixture.registration]
    });

    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).rejects.toThrow(/route material must be independent/u);
  });

  it("rejects copied ingress route material in the standard one-time response", async () => {
    const routeMaterial = new Uint8Array(32).fill(0x45);
    const fixture = registrationFixture({
      routeMaterial: new Uint8Array(routeMaterial),
      oneTimeResponseProfile: {
        schemaId: "core:source-onboarding-response",
        schemaVersion: "v1",
        fields: [
          {
            fieldId: "core:webhook-token",
            value: new Uint8Array(routeMaterial)
          }
        ]
      }
    });
    const registry = createSourceAdapterRegistry({
      registrations: [fixture.registration]
    });

    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).rejects.toThrow(/route material must be independent/u);
  });

  it("checks every field of future one-time response profiles for route copies", async () => {
    const routeMaterial = new Uint8Array(32).fill(0x45);
    const fixture = registrationFixture({
      routeMaterial: new Uint8Array(routeMaterial),
      oneTimeResponseProfile: {
        schemaId: "core:future-source-onboarding-response",
        schemaVersion: "v2",
        fields: [
          {
            fieldId: "core:future-correlation",
            value: new Uint8Array([9, 8, 7])
          },
          {
            fieldId: "core:future-bootstrap-token",
            value: new Uint8Array(routeMaterial)
          }
        ]
      }
    });
    const registry = createSourceAdapterRegistry({
      registrations: [fixture.registration]
    });

    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).rejects.toThrow(/route material must be independent/u);
  });

  it("accepts the declared secret/response reuse when route material stays independent", async () => {
    const webhookToken = new Uint8Array([7, 8, 9]);
    const fixture = registrationFixture({
      credentialMaterial: new Uint8Array(webhookToken),
      oneTimeResponseProfile: {
        schemaId: "core:source-onboarding-response",
        schemaVersion: "v1",
        fields: [
          {
            fieldId: "core:webhook-token",
            value: new Uint8Array(webhookToken)
          }
        ]
      }
    });
    const registry = createSourceAdapterRegistry({
      registrations: [fixture.registration]
    });

    const prepared = await registry
      .get("synthetic")!
      .prepare(fixture.prepareInput);

    expect(Array.from(prepared.secretWrites[0]!.material)).toEqual(
      Array.from(prepared.oneTimeResponse!.fields[0]!.value)
    );
    expect(Array.from(prepared.routeWrites[0]!.material)).not.toEqual(
      Array.from(prepared.oneTimeResponse!.fields[0]!.value)
    );
  });

  it("accepts independent fields in a future one-time response profile", async () => {
    const fixture = registrationFixture({
      oneTimeResponseProfile: {
        schemaId: "core:future-source-onboarding-response",
        schemaVersion: "v2",
        fields: [
          {
            fieldId: "core:future-correlation",
            value: new Uint8Array([9, 8, 7])
          },
          {
            fieldId: "core:future-bootstrap-token",
            value: new Uint8Array([6, 5, 4])
          }
        ]
      }
    });
    const registry = createSourceAdapterRegistry({
      registrations: [fixture.registration]
    });

    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).resolves.toMatchObject({
      oneTimeResponse: {
        schemaId: "core:future-source-onboarding-response",
        schemaVersion: "v2"
      }
    });
  });

  it.each(["missing", "digest"] as const)(
    "rejects %s optional artifact material",
    async (mode) => {
      const fixture = registrationFixture({
        configurationArtifact: {
          schemaId: "module:synthetic:configuration",
          schemaVersion: "v1"
        }
      });
      const artifactWrite = fixture.prepared.artifactWrites[0]!;
      const artifactWrites =
        mode === "missing"
          ? []
          : [
              {
                ...artifactWrite,
                material: new Uint8Array([0, 0])
              }
            ];
      const invalidHandler: SourceAdapterOnboardingHandler = {
        handlerId: "module:synthetic:onboarding",
        async prepare() {
          return { ...fixture.prepared, artifactWrites };
        }
      };
      const registry = createSourceAdapterRegistry({
        registrations: [
          { ...fixture.registration, onboardingHandler: invalidHandler }
        ]
      });

      await expect(
        registry.get("synthetic")!.prepare(fixture.prepareInput)
      ).rejects.toThrow(/artifact/u);
    }
  );

  it("zeroes raw material when a late prepared snapshot copy fails", async () => {
    const fixture = registrationFixture({
      credentialMaterial: new Uint8Array([7, 8, 9])
    });
    const rawSecret = fixture.prepared.secretWrites[0]!.material;
    const rawRoute = fixture.prepared.routeWrites[0]!.material;
    const rawResponse = new Uint8Array([1, 2, 3]);
    let responseReads = 0;
    const unstableField = {
      fieldId: "core:webhook-token",
      get value() {
        responseReads += 1;
        if (responseReads === 2) {
          throw new Error("synthetic prepared snapshot copy failure");
        }
        return rawResponse;
      }
    };
    const invalidHandler: SourceAdapterOnboardingHandler = {
      handlerId: "module:synthetic:onboarding",
      async prepare() {
        return {
          ...fixture.prepared,
          oneTimeResponse: {
            ...fixture.prepared.oneTimeResponse!,
            fields: [unstableField]
          }
        };
      }
    };
    const registry = createSourceAdapterRegistry({
      registrations: [
        { ...fixture.registration, onboardingHandler: invalidHandler }
      ]
    });

    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).rejects.toThrow("synthetic prepared snapshot copy failure");
    expect(Array.from(rawSecret)).toEqual([0, 0, 0]);
    expect(Array.from(rawRoute)).toEqual(new Array(32).fill(0));
    expect(Array.from(rawResponse)).toEqual([0, 0, 0]);
  });

  it("fails a partial prepare-input snapshot before handler invocation", async () => {
    const fixture = registrationFixture({
      credentialMaterial: new Uint8Array([7, 8, 9])
    });
    const firstMaterial =
      fixture.prepareInput.ephemeralCredentials[0]!.material;
    const secondMaterial = new Uint8Array([4, 5, 6]);
    let materialReads = 0;
    const unstableCredential = {
      bindingId: "credential-binding:synthetic-unstable",
      get material() {
        materialReads += 1;
        if (materialReads === 2) {
          throw new Error("synthetic prepare snapshot copy failure");
        }
        return secondMaterial;
      }
    };
    let prepareCalls = 0;
    const handler: SourceAdapterOnboardingHandler = {
      handlerId: "module:synthetic:onboarding",
      async prepare() {
        prepareCalls += 1;
        return fixture.prepared;
      }
    };
    const registry = createSourceAdapterRegistry({
      registrations: [{ ...fixture.registration, onboardingHandler: handler }]
    });

    await expect(
      registry.get("synthetic")!.prepare({
        ...fixture.prepareInput,
        ephemeralCredentials: [
          fixture.prepareInput.ephemeralCredentials[0]!,
          unstableCredential
        ]
      })
    ).rejects.toThrow("synthetic prepare snapshot copy failure");
    expect(prepareCalls).toBe(0);
    expect(Array.from(firstMaterial)).toEqual([7, 8, 9]);
    expect(Array.from(secondMaterial)).toEqual([4, 5, 6]);
  });

  it("returns a registry-owned snapshot immune to handler mutation", async () => {
    const fixture = registrationFixture();
    const registry = createSourceAdapterRegistry({
      registrations: [fixture.registration]
    });
    const result = await registry
      .get("synthetic")!
      .prepare(fixture.prepareInput);

    fixture.prepared.oneTimeResponse!.fields[0]!.value[0] = 99;
    (fixture.prepared.authority.accounts as unknown as unknown[]).push({
      forged: true
    });

    expect(result.oneTimeResponse!.fields[0]!.value[0]).toBe(1);
    expect(result.authority.accounts).toEqual([]);
    expect(Object.isFrozen(result.authority.accounts)).toBe(true);
    expect(Object.isFrozen(result.oneTimeResponse!.fields)).toBe(true);
  });

  it("validates against an untouched input snapshot when handler mutates its copy", async () => {
    const fixture = registrationFixture();
    const mutatingHandler: SourceAdapterOnboardingHandler = {
      handlerId: "module:synthetic:onboarding",
      async prepare(input) {
        (
          input.sourceConnection as unknown as Record<string, unknown>
        ).tenantId = "tenant:forged";
        (input.actor as unknown as Record<string, unknown>).trustedServiceId =
          "core:forged-service";
        return fixture.prepared;
      }
    };
    const registry = createSourceAdapterRegistry({
      registrations: [
        { ...fixture.registration, onboardingHandler: mutatingHandler }
      ]
    });

    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).resolves.toBeDefined();
    expect(fixture.prepareInput.sourceConnection.tenantId).toBe(tenantId);
    expect(fixture.prepareInput.actor).toEqual(actor);
  });

  it("captures handler callables and IDs at registration time", async () => {
    const onboardingFixture = registrationFixture();
    const rawOnboarding = onboardingFixture.registration
      .onboardingHandler as unknown as MutableOnboardingHandler;
    const onboardingRegistry = createSourceAdapterRegistry({
      registrations: [onboardingFixture.registration]
    });
    rawOnboarding.handlerId = "module:synthetic:mutated-onboarding";
    rawOnboarding.prepare = async () => {
      throw new Error("mutated onboarding handler must not run");
    };

    await expect(
      onboardingRegistry
        .get("synthetic")!
        .prepare(onboardingFixture.prepareInput)
    ).resolves.toBeDefined();
    expect(onboardingRegistry.get("synthetic")!.handlerId).toBe(
      "module:synthetic:onboarding"
    );
    expect(Object.isFrozen(onboardingRegistry.get("synthetic"))).toBe(true);

    const ingressFixture = registrationFixture();
    const rawIngress = ingressFixture.registration
      .ingressHandler as unknown as MutableIngressHandler;
    const ingressRegistry = createSourceAdapterRegistry({
      registrations: [ingressFixture.registration]
    });
    rawIngress.handlerId = "module:synthetic:mutated-ingress";
    rawIngress.dispatch = async () => {
      throw new Error("mutated ingress handler must not run");
    };

    await expect(
      ingressRegistry
        .getIngressHandler("synthetic")!
        .dispatch(ingressDispatchInput(ingressFixture))
    ).resolves.toEqual({ accepted: true, diagnosticCodeId: null });
    expect(ingressRegistry.getIngressHandler("synthetic")!.handlerId).toBe(
      "module:synthetic:ingress"
    );
    expect(
      Object.isFrozen(ingressRegistry.getIngressHandler("synthetic"))
    ).toBe(true);
  });

  it("validates ingress authority and zeroes handler-owned body clones", async () => {
    const fixture = registrationFixture();
    let retainedBody: Uint8Array | undefined;
    let dispatchCalls = 0;
    const retainingHandler: SourceAdapterIngressHandler = {
      handlerId: "module:synthetic:ingress",
      async dispatch(input) {
        dispatchCalls += 1;
        retainedBody = input.body;
        return { accepted: true, diagnosticCodeId: null };
      }
    };
    const registry = createSourceAdapterRegistry({
      registrations: [
        { ...fixture.registration, ingressHandler: retainingHandler }
      ]
    });
    const callerBody = new Uint8Array([10, 20, 30]);
    const result = await registry
      .getIngressHandler("synthetic")!
      .dispatch(ingressDispatchInput(fixture, callerBody));

    expect(result).toEqual({ accepted: true, diagnosticCodeId: null });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Array.from(retainedBody!)).toEqual([0, 0, 0]);
    expect(Array.from(callerBody)).toEqual([10, 20, 30]);

    await expect(
      registry.getIngressHandler("synthetic")!.dispatch({
        ...ingressDispatchInput(fixture),
        tenantId: inboxV2TenantIdSchema.parse("tenant:other")
      })
    ).rejects.toMatchObject({
      code: "source_adapter.invalid_ingress_input"
    });
    expect(dispatchCalls).toBe(1);
  });

  it("rejects malformed ingress results and still zeroes the body clone", async () => {
    const fixture = registrationFixture();
    let retainedBody: Uint8Array | undefined;
    const invalidResultHandler: SourceAdapterIngressHandler = {
      handlerId: "module:synthetic:ingress",
      async dispatch(input) {
        retainedBody = input.body;
        return {
          accepted: "yes",
          diagnosticCodeId: null
        } as unknown as SourceAdapterIngressDispatchResult;
      }
    };
    const registry = createSourceAdapterRegistry({
      registrations: [
        { ...fixture.registration, ingressHandler: invalidResultHandler }
      ]
    });

    await expect(
      registry
        .getIngressHandler("synthetic")!
        .dispatch(ingressDispatchInput(fixture))
    ).rejects.toMatchObject({
      code: "source_adapter.invalid_ingress_result"
    });
    expect(Array.from(retainedBody!)).toEqual([0, 0, 0]);
  });

  it.each(["onboardingHandler", "ingressHandler"] as const)(
    "fails closed when %s is missing",
    (field) => {
      const fixture = registrationFixture();
      expect(() =>
        createSourceAdapterRegistry({
          registrations: [{ ...fixture.registration, [field]: null }]
        })
      ).toThrow(SourceAdapterRegistryError);
    }
  );

  it("rejects fake declarations, mismatched handlers and duplicates", () => {
    const fixture = registrationFixture();
    const siblingBinding = defineInboxV2SourceRegistryLifecycleBinding({
      registry: fixture.lifecycleRegistry,
      value: structuredClone(fixture.registration.lifecycleBinding)
    });
    for (const registration of [
      {
        ...fixture.registration,
        declaration: structuredClone(fixture.registration.declaration)
      },
      {
        ...fixture.registration,
        lifecycleBinding: siblingBinding
      },
      {
        ...fixture.registration,
        onboardingHandler: {
          ...fixture.registration.onboardingHandler!,
          handlerId: "module:synthetic:wrong-handler"
        }
      }
    ]) {
      expect(() =>
        createSourceAdapterRegistry({ registrations: [registration] })
      ).toThrow(SourceAdapterRegistryError);
    }
    expect(() =>
      createSourceAdapterRegistry({
        registrations: [fixture.registration, fixture.registration]
      })
    ).toThrow(/Duplicate source-adapter/u);
  });

  it("rejects fake prepared heads and cross-tenant prepare input", async () => {
    const fixture = registrationFixture();
    const fakeHandler: SourceAdapterOnboardingHandler = {
      handlerId: "module:synthetic:onboarding",
      async prepare() {
        return {
          ...fixture.prepared,
          authority: {
            ...fixture.prepared.authority,
            connection: {
              ...fixture.prepared.authority.connection,
              head: structuredClone(fixture.prepared.authority.connection.head)
            }
          }
        };
      }
    };
    const registry = createSourceAdapterRegistry({
      registrations: [
        { ...fixture.registration, onboardingHandler: fakeHandler }
      ]
    });
    await expect(
      registry.get("synthetic")!.prepare(fixture.prepareInput)
    ).rejects.toThrow(/caller-authored/u);
    expect(
      Array.from(fixture.prepared.oneTimeResponse!.fields[0]!.value)
    ).toEqual([0, 0, 0]);
    await expect(
      registry.get("synthetic")!.prepare({
        ...fixture.prepareInput,
        tenantId: inboxV2TenantIdSchema.parse("tenant:other")
      })
    ).rejects.toThrow(/crosses registration or tenant/u);
  });

  it.each([
    ["wrong schema", "module:synthetic:wrong-configuration", "v1"],
    ["unsupported version", "module:synthetic:configuration", "v2"]
  ] as const)(
    "rejects configuration artifact with %s",
    async (_label, schemaId, schemaVersion) => {
      const fixture = registrationFixture({
        configurationArtifact: { schemaId, schemaVersion }
      });
      const registry = createSourceAdapterRegistry({
        registrations: [fixture.registration]
      });
      await expect(
        registry.get("synthetic")!.prepare(fixture.prepareInput)
      ).rejects.toThrow(/undeclared schema or version/u);
    }
  );

  it.each([
    ["catalog_registration", "core:inbox-v2.catalog-registration"] as const,
    ["module_registration", "core:inbox-v2.source-adapter-declaration"] as const
  ])(
    "accepts optional %s material only with its exact core envelope",
    async (kind, schemaId) => {
      const fixture = registrationFixture({
        registrationArtifact: { kind, schemaId, schemaVersion: "v1" }
      });
      const registry = createSourceAdapterRegistry({
        registrations: [fixture.registration]
      });

      await expect(
        registry.get("synthetic")!.prepare(fixture.prepareInput)
      ).resolves.toBeDefined();
    }
  );

  it.each([
    ["catalog_registration", "core:inbox-v2.catalog-registration"] as const,
    ["module_registration", "core:inbox-v2.source-adapter-declaration"] as const
  ])(
    "rejects optional %s with a non-canonical version or material digest",
    async (kind, schemaId) => {
      const wrongVersion = registrationFixture({
        registrationArtifact: { kind, schemaId, schemaVersion: "v2" }
      });
      const wrongVersionRegistry = createSourceAdapterRegistry({
        registrations: [wrongVersion.registration]
      });
      await expect(
        wrongVersionRegistry
          .get("synthetic")!
          .prepare(wrongVersion.prepareInput)
      ).rejects.toThrow(/registration artifact must pin/u);

      const wrongMaterial = registrationFixture({
        registrationArtifact: { kind, schemaId, schemaVersion: "v1" }
      });
      wrongMaterial.prepared.artifactWrites[0]!.material[0] = 0;
      const wrongMaterialRegistry = createSourceAdapterRegistry({
        registrations: [wrongMaterial.registration]
      });
      await expect(
        wrongMaterialRegistry
          .get("synthetic")!
          .prepare(wrongMaterial.prepareInput)
      ).rejects.toThrow(/artifact write/u);
    }
  );

  it("requires configuration declaration iff an artifact is persisted", async () => {
    const missingArtifact = registrationFixture({
      configurationDeclaration: {
        schemaId: "module:synthetic:configuration",
        supportedVersions: ["v1"]
      }
    });
    const undeclaredArtifact = registrationFixture({
      configurationArtifact: {
        schemaId: "module:synthetic:configuration",
        schemaVersion: "v1"
      },
      configurationDeclaration: null
    });
    for (const fixture of [missingArtifact, undeclaredArtifact]) {
      const registry = createSourceAdapterRegistry({
        registrations: [fixture.registration]
      });
      await expect(
        registry.get("synthetic")!.prepare(fixture.prepareInput)
      ).rejects.toThrow(/declaration and persisted artifacts/u);
    }
  });
});
