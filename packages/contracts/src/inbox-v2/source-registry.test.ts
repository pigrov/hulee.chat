import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineInboxV2DataLifecycleRegistry } from "./data-lifecycle-catalog";
import {
  assertInboxV2SourceRegistryLifecycleLocator,
  defineInboxV2SourceAccountRegistryState,
  defineInboxV2SourceAdapterDeclaration,
  defineInboxV2SourceConnectionRegistryState,
  defineInboxV2SourceRegistryLifecycleBinding,
  defineInboxV2SourceRegistryTransition,
  inboxV2SourceConnectionRegistryStateSchema,
  inboxV2SourceAccountRegistryStateSchema,
  inboxV2SourceAdapterDeclarationSchema,
  inboxV2SourceRegistryRelatedAuthorityReferenceSchema,
  inboxV2SourceRegistryRelatedAuthorityTransitionSchema,
  inboxV2SourceRegistryLifecycleBindingSchema,
  isInboxV2SourceAdapterDeclarationLifecycleBinding,
  isInboxV2SourceRegistryLifecycleBinding
} from "./source-registry";

const tenantId = "tenant:alpha";
const t0 = "2026-07-16T08:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;

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

function lifecycleBinding() {
  const registry = lifecycleRegistry();
  const registryReference = {
    id: "core:source-registry-lifecycle",
    revision: "7",
    compositionHash: String(registry.compositionHash)
  } as const;
  const slots = [
    "source_connection_registry",
    "source_account_registry",
    "credential_binding",
    "source_registry_artifact",
    "source_ingress_route",
    "channel_connector_registry",
    "channel_session_state",
    "channel_session_event",
    "channel_auth_challenge_outcome",
    "source_catalog_registration",
    "source_module_registration"
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
  const bindingInput = JSON.parse(JSON.stringify(bindings)) as z.input<
    typeof inboxV2SourceRegistryLifecycleBindingSchema
  >["payload"]["bindings"];
  return {
    registry,
    registryReference,
    binding: defineInboxV2SourceRegistryLifecycleBinding({
      registry,
      value: {
        schemaId: "core:inbox-v2.source-registry-lifecycle-binding",
        schemaVersion: "v1",
        payload: { registry: registryReference, bindings: bindingInput }
      }
    })
  };
}

function locator(
  copySlot: ReturnType<
    typeof lifecycleBinding
  >["binding"]["payload"]["bindings"][number]["copySlot"]
) {
  const { binding } = lifecycleBinding();
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

const adapterContract = {
  contractId: "module:synthetic:source-adapter",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

function connectionStateInput(revision = "1", generation = "1") {
  return {
    schemaId: "core:inbox-v2.source-connection-registry-state" as const,
    schemaVersion: "v1" as const,
    payload: {
      tenantId,
      entityKind: "source_connection" as const,
      sourceConnection: {
        tenantId,
        kind: "source_connection" as const,
        id: "source_connection:synthetic-primary"
      },
      sourceName: "synthetic",
      displayName: "Synthetic",
      sourceTypeId: "core:messenger",
      adapterContract,
      lifecycle: locator("source_connection_registry"),
      revision,
      status: revision === "1" ? ("pending" as const) : ("active" as const),
      routeAuthority: {
        state: revision === "1" ? ("denied" as const) : ("enabled" as const),
        generation,
        reasonCodeId: "core:onboarding",
        changedAt: revision === "1" ? t0 : "2026-07-16T08:01:00.000Z"
      },
      artifacts: [],
      credentialBindings: [],
      relatedAuthorities: [],
      createdBy: {
        kind: "trusted_service" as const,
        trustedServiceId: "core:source-runtime"
      },
      createdAt: t0,
      updatedAt: revision === "1" ? t0 : "2026-07-16T08:01:00.000Z"
    }
  };
}

function artifact(
  kind:
    | "configuration"
    | "capability"
    | "metadata"
    | "diagnostic" = "configuration",
  recordId = `payload:${kind}-0001`,
  artifactTenantId = tenantId
) {
  return {
    kind,
    payload: {
      tenantId: artifactTenantId,
      recordId,
      schemaId: `module:synthetic:${kind}`,
      schemaVersion: "v1",
      digest: hash
    },
    lifecycle: locator("source_registry_artifact")
  };
}

function credential(credentialTenantId = tenantId) {
  return {
    tenantId: credentialTenantId,
    bindingId: "credential-binding:synthetic-0001",
    revision: "1",
    status: "active" as const,
    lifecycle: locator("credential_binding")
  };
}

function relatedAuthority(
  kind:
    | "channel_connector"
    | "channel_session"
    | "channel_session_event"
    | "channel_auth_challenge"
    | "source_ingress_route",
  authorityTenantId = tenantId
) {
  const common = {
    kind,
    tenantId: authorityTenantId,
    authorityId: `${kind}:synthetic-0001`,
    revision: "1",
    status: "active" as const,
    sourceConnection: {
      tenantId: authorityTenantId,
      kind: "source_connection" as const,
      id: "source_connection:synthetic-primary"
    },
    sourceAccount: null
  };
  if (kind === "channel_connector") {
    return {
      ...common,
      kind,
      lifecycle: locator("channel_connector_registry")
    };
  }
  if (kind === "channel_session") {
    return {
      ...common,
      kind,
      lifecycle: locator("channel_session_state"),
      connectorAuthorityId: "channel_connector:synthetic-0001"
    };
  }
  if (kind === "channel_session_event") {
    return {
      ...common,
      kind,
      lifecycle: locator("channel_session_event"),
      connectorAuthorityId: "channel_connector:synthetic-0001",
      sessionAuthorityId: "channel_session:synthetic-0001"
    };
  }
  if (kind === "channel_auth_challenge") {
    return {
      ...common,
      kind,
      lifecycle: locator("channel_auth_challenge_outcome"),
      connectorAuthorityId: "channel_connector:synthetic-0001",
      sessionAuthorityId: "channel_session:synthetic-0001"
    };
  }
  return {
    ...common,
    kind,
    lifecycle: locator("source_ingress_route"),
    parentAuthorityId: "channel_connector:synthetic-0001",
    handlerGeneration: "1"
  };
}

function accountStateInput(
  input: {
    revision?: string;
    generation?: string;
    status?:
      | "pending"
      | "active"
      | "degraded"
      | "disabled"
      | "replaced"
      | "deleted";
    routeState?: "enabled" | "inbound_only" | "denied";
    updatedAt?: string;
    identityState?: "provisional" | "verified" | "conflicted";
    identityRevision?: string;
    accountGeneration?: string;
  } = {}
) {
  const identityState = input.identityState ?? "verified";
  const identityFence =
    identityState === "verified"
      ? {
          kind: "source_account_identity" as const,
          state: identityState,
          identityRevision: input.identityRevision ?? "1",
          accountGeneration: input.accountGeneration ?? "1",
          canonicalIdentityDigest: hash
        }
      : identityState === "provisional"
        ? {
            kind: "source_account_identity" as const,
            state: identityState,
            identityRevision: input.identityRevision ?? "1",
            accountGeneration: input.accountGeneration ?? "1",
            provisionalKeyDigest: hash
          }
        : {
            kind: "source_account_identity" as const,
            state: identityState,
            identityRevision: input.identityRevision ?? "1",
            accountGeneration: input.accountGeneration ?? "1",
            conflictEvidenceDigest: hash
          };
  return {
    schemaId: "core:inbox-v2.source-account-registry-state" as const,
    schemaVersion: "v1" as const,
    payload: {
      tenantId,
      entityKind: "source_account" as const,
      sourceAccount: {
        tenantId,
        kind: "source_account" as const,
        id: "source_account:synthetic-operator"
      },
      sourceConnection: {
        tenantId,
        kind: "source_connection" as const,
        id: "source_connection:synthetic-primary"
      },
      sourceName: "synthetic",
      displayName: "Synthetic account",
      sourceTypeId: "core:messenger",
      adapterContract,
      lifecycle: locator("source_account_registry"),
      revision: input.revision ?? "1",
      status: input.status ?? "active",
      routeAuthority: {
        state: input.routeState ?? "enabled",
        generation: input.generation ?? "1",
        reasonCodeId: "core:onboarding",
        changedAt: input.updatedAt ?? t0
      },
      artifacts: [],
      credentialBindings: [],
      relatedAuthorities: [],
      identityFence,
      accessFence: {
        resource: {
          tenantId,
          kind: "source_account" as const,
          id: "source_account:synthetic-operator"
        },
        authorizationResourceHeadId: "authorization-head:synthetic-0001",
        resourceAccessRevision: "1",
        structuralRelationRevision: "1"
      },
      createdBy: {
        kind: "trusted_service" as const,
        trustedServiceId: "core:source-runtime"
      },
      createdAt: t0,
      updatedAt: input.updatedAt ?? t0
    }
  };
}

function adapterDeclarationInput(
  binding = lifecycleBinding().binding
): z.input<typeof inboxV2SourceAdapterDeclarationSchema> {
  return {
    schemaId: "core:inbox-v2.source-adapter-declaration" as const,
    schemaVersion: "v1" as const,
    payload: {
      sourceName: "synthetic",
      sourceTypeId: "core:messenger",
      setupMode: "source_connection" as const,
      adapterContract,
      lifecycleRegistry: binding.payload.registry,
      requiredCopySlots: [
        "source_connection_registry",
        "source_account_registry",
        "credential_binding",
        "source_registry_artifact",
        "source_ingress_route",
        "source_catalog_registration",
        "source_module_registration"
      ],
      supportsAccounts: true,
      accountIdentityAuthority: "db003" as const,
      credentialMode: "revocable_secret_binding" as const,
      configurationSchema: {
        schemaId: "module:synthetic:configuration",
        supportedVersions: ["v1"]
      },
      capabilitySchema: {
        schemaId: "module:synthetic:capabilities",
        supportedVersions: ["v1"]
      },
      metadataSchema: {
        schemaId: "module:synthetic:metadata",
        supportedVersions: ["v1"]
      },
      diagnosticSchema: {
        schemaId: "module:synthetic:diagnostic",
        supportedVersions: ["v1"]
      },
      onboarding: {
        mode: "standalone" as const,
        handlerId: "module:synthetic:onboarding",
        oneTimeResponse: null
      },
      ingress: {
        mode: "webhook" as const,
        handlerId: "module:synthetic:ingress"
      }
    }
  };
}

function defineTransition(input: {
  previousState:
    | ReturnType<typeof defineInboxV2SourceConnectionRegistryState>
    | ReturnType<typeof defineInboxV2SourceAccountRegistryState>;
  resultingState:
    | ReturnType<typeof defineInboxV2SourceConnectionRegistryState>
    | ReturnType<typeof defineInboxV2SourceAccountRegistryState>;
  intent:
    | "enable"
    | "disable"
    | "degrade"
    | "recover"
    | "reconnect"
    | "replace"
    | "delete"
    | "update_metadata";
  expectedRevision?: string;
  expectedGeneration?: string;
  resultingGeneration?: string;
  relatedAuthorityTransitions?: z.input<
    typeof inboxV2SourceRegistryRelatedAuthorityTransitionSchema
  >[];
}) {
  return defineInboxV2SourceRegistryTransition({
    value: {
      schemaId: "core:inbox-v2.source-registry-transition",
      schemaVersion: "v1",
      payload: {
        tenantId,
        transitionId: `transition:${input.intent}-0001`,
        entityKind: input.resultingState.payload.entityKind,
        intent: input.intent,
        cas: {
          expectedRevision:
            input.expectedRevision ?? input.previousState.payload.revision,
          expectedRouteGeneration:
            input.expectedGeneration ??
            input.previousState.payload.routeAuthority.generation,
          resultingRevision: input.resultingState.payload.revision,
          resultingRouteGeneration:
            input.resultingGeneration ??
            input.resultingState.payload.routeAuthority.generation
        },
        lifecycle: input.resultingState.payload.lifecycle,
        previousState: input.previousState,
        resultingState: input.resultingState,
        relatedAuthorityTransitions: input.relatedAuthorityTransitions ?? [],
        actor: {
          kind: "trusted_service",
          trustedServiceId: "core:source-runtime"
        },
        committedAt: input.resultingState.payload.updatedAt
      }
    }
  });
}

describe("Inbox V2 source registry contracts", () => {
  it("creates authentic lifecycle binding and rejects stale locator lineage", () => {
    const { binding } = lifecycleBinding();
    expect(isInboxV2SourceRegistryLifecycleBinding(binding)).toBe(true);
    expect(
      isInboxV2SourceRegistryLifecycleBinding(structuredClone(binding))
    ).toBe(false);
    expect(() =>
      assertInboxV2SourceRegistryLifecycleLocator({
        binding,
        locator: {
          ...locator("source_registry_artifact"),
          lineageRevision: "12"
        }
      })
    ).toThrow(/exact registered copy\/root\/purpose\/lineage/u);
  });

  it("rejects arbitrary registry JSON and inline credentials", () => {
    expect(
      inboxV2SourceConnectionRegistryStateSchema.safeParse({
        ...connectionStateInput(),
        payload: {
          ...connectionStateInput().payload,
          config: { token: "plaintext" }
        }
      }).success
    ).toBe(false);
  });

  it("rejects unknown envelope versions and duplicate artifact kinds", () => {
    expect(
      inboxV2SourceConnectionRegistryStateSchema.safeParse({
        ...connectionStateInput(),
        schemaVersion: "v2"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAdapterDeclarationSchema.safeParse({
        ...adapterDeclarationInput(),
        schemaVersion: "v2"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceConnectionRegistryStateSchema.safeParse({
        ...connectionStateInput(),
        payload: {
          ...connectionStateInput().payload,
          artifacts: [
            artifact("configuration", "payload:config-0001"),
            artifact("configuration", "payload:config-0002")
          ]
        }
      }).success
    ).toBe(false);
  });

  it("requires verified identity digest and an exact SourceAccount access fence for enabled routing", () => {
    expect(
      inboxV2SourceAccountRegistryStateSchema.safeParse(accountStateInput())
        .success
    ).toBe(true);
    expect(
      inboxV2SourceAccountRegistryStateSchema.safeParse(
        accountStateInput({ identityState: "provisional" })
      ).success
    ).toBe(false);
    const wrongAccess = structuredClone(accountStateInput());
    wrongAccess.payload.accessFence.resource.id =
      "source_account:another-account";
    expect(
      inboxV2SourceAccountRegistryStateSchema.safeParse(wrongAccess).success
    ).toBe(false);
    const missingDigest = structuredClone(accountStateInput());
    Reflect.deleteProperty(
      missingDigest.payload.identityFence,
      "canonicalIdentityDigest"
    );
    expect(
      inboxV2SourceAccountRegistryStateSchema.safeParse(missingDigest).success
    ).toBe(false);
  });

  it.each([
    [
      "creator",
      (value: z.input<typeof inboxV2SourceConnectionRegistryStateSchema>) => {
        value.payload.createdBy = {
          kind: "employee",
          employee: {
            tenantId: "tenant:other",
            kind: "employee",
            id: "employee:operator-1"
          },
          authorizationEpoch: "authorization:epoch-1"
        };
      }
    ],
    [
      "artifact",
      (value: z.input<typeof inboxV2SourceConnectionRegistryStateSchema>) => {
        value.payload.artifacts = [
          artifact("configuration", undefined, "tenant:other")
        ];
      }
    ],
    [
      "credential",
      (value: z.input<typeof inboxV2SourceConnectionRegistryStateSchema>) => {
        value.payload.credentialBindings = [credential("tenant:other")];
      }
    ],
    [
      "related authority",
      (value: z.input<typeof inboxV2SourceConnectionRegistryStateSchema>) => {
        value.payload.relatedAuthorities = [
          relatedAuthority("channel_connector", "tenant:other")
        ];
      }
    ]
  ] as const)("rejects cross-tenant %s references", (_label, mutate) => {
    const value = structuredClone(connectionStateInput()) as unknown as z.input<
      typeof inboxV2SourceConnectionRegistryStateSchema
    >;
    mutate(value);
    expect(
      inboxV2SourceConnectionRegistryStateSchema.safeParse(value).success
    ).toBe(false);
  });

  it.each([
    ["channel_connector", null],
    ["channel_session", "connectorAuthorityId"],
    ["channel_session_event", "connectorAuthorityId"],
    ["channel_auth_challenge", "connectorAuthorityId"],
    ["source_ingress_route", "parentAuthorityId"]
  ] as const)(
    "validates typed %s parent authority",
    (kind, requiredParentField) => {
      const value = relatedAuthority(kind);
      expect(
        inboxV2SourceRegistryRelatedAuthorityReferenceSchema.safeParse(value)
          .success
      ).toBe(true);
      if (requiredParentField !== null) {
        const missing = structuredClone(value);
        Reflect.deleteProperty(missing, requiredParentField);
        expect(
          inboxV2SourceRegistryRelatedAuthorityReferenceSchema.safeParse(
            missing
          ).success
        ).toBe(false);
      }
    }
  );

  it("rejects fake/stale lifecycle and adapter authorities", () => {
    const { registry, binding } = lifecycleBinding();
    expect(() =>
      defineInboxV2SourceConnectionRegistryState({
        lifecycleBinding: structuredClone(binding) as unknown as typeof binding,
        value: connectionStateInput()
      })
    ).toThrow(/authentic lifecycle binding/u);

    const staleBinding = structuredClone(binding) as unknown as z.input<
      typeof inboxV2SourceRegistryLifecycleBindingSchema
    >;
    staleBinding.payload.registry.compositionHash = `sha256:${"b".repeat(64)}`;
    expect(() =>
      defineInboxV2SourceRegistryLifecycleBinding({
        registry,
        value: staleBinding
      })
    ).toThrow(/stale or different registry composition/u);

    expect(() =>
      defineInboxV2SourceAdapterDeclaration({
        lifecycleBinding: structuredClone(binding) as unknown as typeof binding,
        value: adapterDeclarationInput(binding)
      })
    ).toThrow(/authentic lifecycle binding/u);

    const declaration = defineInboxV2SourceAdapterDeclaration({
      lifecycleBinding: binding,
      value: adapterDeclarationInput(binding)
    });
    const siblingBinding = defineInboxV2SourceRegistryLifecycleBinding({
      registry,
      value: structuredClone(binding)
    });
    expect(
      isInboxV2SourceAdapterDeclarationLifecycleBinding({
        declaration,
        lifecycleBinding: binding
      })
    ).toBe(true);
    expect(
      isInboxV2SourceAdapterDeclarationLifecycleBinding({
        declaration,
        lifecycleBinding: siblingBinding
      })
    ).toBe(false);
  });

  it.each([
    "source_connection_registry",
    "source_account_registry",
    "credential_binding",
    "source_registry_artifact",
    "source_ingress_route",
    "source_catalog_registration",
    "source_module_registration"
  ] as const)("fails adapter composition without %s", (missingSlot) => {
    const { binding } = lifecycleBinding();
    const value = structuredClone(adapterDeclarationInput(binding));
    value.payload.requiredCopySlots = value.payload.requiredCopySlots.filter(
      (slot: string) => slot !== missingSlot
    );
    expect(inboxV2SourceAdapterDeclarationSchema.safeParse(value).success).toBe(
      false
    );
  });

  it("requires connector lifecycle authority for channel-connector setup", () => {
    const { binding } = lifecycleBinding();
    const value = structuredClone(adapterDeclarationInput(binding));
    value.payload.setupMode = "channel_connector";
    expect(inboxV2SourceAdapterDeclarationSchema.safeParse(value).success).toBe(
      false
    );

    value.payload.requiredCopySlots.push("channel_connector_registry");
    expect(inboxV2SourceAdapterDeclarationSchema.safeParse(value).success).toBe(
      true
    );
  });

  it("creates immutable CAS transitions only from authentic state heads", () => {
    const { binding } = lifecycleBinding();
    const previousState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: connectionStateInput()
    });
    const resultingState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: connectionStateInput("2", "2")
    });
    const transition = defineInboxV2SourceRegistryTransition({
      value: {
        schemaId: "core:inbox-v2.source-registry-transition",
        schemaVersion: "v1",
        payload: {
          tenantId,
          transitionId: "transition:enable-0001",
          entityKind: "source_connection",
          intent: "enable",
          cas: {
            expectedRevision: "1",
            expectedRouteGeneration: "1",
            resultingRevision: "2",
            resultingRouteGeneration: "2"
          },
          lifecycle: resultingState.payload.lifecycle,
          previousState,
          resultingState,
          relatedAuthorityTransitions: [],
          actor: {
            kind: "trusted_service",
            trustedServiceId: "core:source-runtime"
          },
          committedAt: "2026-07-16T08:01:00.000Z"
        }
      }
    });
    expect(Object.isFrozen(transition)).toBe(true);
    expect(() =>
      defineInboxV2SourceRegistryTransition({
        value: {
          ...transition,
          payload: {
            ...transition.payload,
            previousState: structuredClone(previousState)
          }
        }
      })
    ).toThrow(/authentic registry state/u);
  });

  it.each([
    ["expected revision", { expectedRevision: "9" }],
    ["expected generation", { expectedGeneration: "9" }],
    ["resulting generation", { resultingGeneration: "9" }]
  ] as const)("rejects stale transition %s", (_label, cas) => {
    const { binding } = lifecycleBinding();
    const previousState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: connectionStateInput()
    });
    const resultingState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: connectionStateInput("2", "2")
    });
    expect(() =>
      defineTransition({
        previousState,
        resultingState,
        intent: "enable",
        ...cas
      })
    ).toThrow();
  });

  it.each(["adapter", "configuration", "capability", "credential"] as const)(
    "advances route generation for route-critical %s changes",
    (change) => {
      const { binding } = lifecycleBinding();
      const previousState = defineInboxV2SourceConnectionRegistryState({
        lifecycleBinding: binding,
        value: connectionStateInput()
      });
      const next = structuredClone(
        connectionStateInput("2", "1")
      ) as unknown as z.input<
        typeof inboxV2SourceConnectionRegistryStateSchema
      >;
      next.payload.status = "pending";
      next.payload.routeAuthority.state = "denied";
      next.payload.routeAuthority.changedAt = t0;
      next.payload.updatedAt = "2026-07-16T08:01:00.000Z";
      if (change === "adapter") {
        next.payload.adapterContract.declarationRevision = "2";
      } else if (change === "credential") {
        next.payload.credentialBindings = [credential()];
      } else {
        next.payload.artifacts = [artifact(change)];
      }
      const resultingState = defineInboxV2SourceConnectionRegistryState({
        lifecycleBinding: binding,
        value: next
      });
      expect(() =>
        defineTransition({
          previousState,
          resultingState,
          intent: "update_metadata"
        })
      ).toThrow(/route-critical|Route generation/u);
    }
  );

  it.each(["identity", "access"] as const)(
    "advances route generation for SourceAccount %s fence changes",
    (change) => {
      const { binding } = lifecycleBinding();
      const previousState = defineInboxV2SourceAccountRegistryState({
        lifecycleBinding: binding,
        value: accountStateInput({
          status: "pending",
          routeState: "denied"
        })
      });
      const next = structuredClone(
        accountStateInput({
          revision: "2",
          status: "pending",
          routeState: "denied",
          updatedAt: "2026-07-16T08:01:00.000Z"
        })
      ) as unknown as z.input<typeof inboxV2SourceAccountRegistryStateSchema>;
      next.payload.routeAuthority.changedAt = t0;
      if (change === "identity") {
        if (next.payload.identityFence.state !== "verified") {
          throw new Error("Expected a verified identity fence fixture.");
        }
        next.payload.identityFence.identityRevision = "2";
        next.payload.identityFence.canonicalIdentityDigest = `sha256:${"c".repeat(64)}`;
      } else {
        next.payload.accessFence.resourceAccessRevision = "2";
      }
      const resultingState = defineInboxV2SourceAccountRegistryState({
        lifecycleBinding: binding,
        value: next
      });
      expect(() =>
        defineTransition({
          previousState,
          resultingState,
          intent: "update_metadata"
        })
      ).toThrow(/route-critical|Route generation/u);
    }
  );

  it("allows metadata-only revision without route generation churn", () => {
    const { binding } = lifecycleBinding();
    const previousState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: connectionStateInput()
    });
    const next = structuredClone(
      connectionStateInput("2", "1")
    ) as unknown as z.input<typeof inboxV2SourceConnectionRegistryStateSchema>;
    next.payload.status = "pending";
    next.payload.routeAuthority.state = "denied";
    next.payload.routeAuthority.changedAt = t0;
    next.payload.updatedAt = "2026-07-16T08:01:00.000Z";
    next.payload.artifacts = [artifact("metadata")];
    const resultingState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: next
    });
    expect(() =>
      defineTransition({
        previousState,
        resultingState,
        intent: "update_metadata"
      })
    ).not.toThrow();
  });

  it.each([
    ["disable", "disabled"],
    ["delete", "deleted"]
  ] as const)("invalidates route authority on %s", (intent, status) => {
    const { binding } = lifecycleBinding();
    const previousState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: connectionStateInput("2", "2")
    });
    const next = structuredClone(
      connectionStateInput("3", "3")
    ) as unknown as z.input<typeof inboxV2SourceConnectionRegistryStateSchema>;
    next.payload.status = status;
    next.payload.routeAuthority.state = "denied";
    next.payload.routeAuthority.changedAt = "2026-07-16T08:02:00.000Z";
    next.payload.updatedAt = "2026-07-16T08:02:00.000Z";
    const resultingState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: next
    });
    expect(() =>
      defineTransition({ previousState, resultingState, intent })
    ).not.toThrow();
  });

  it("retains and revokes ingress authority when the parent route is invalidated", () => {
    const { binding } = lifecycleBinding();
    const activeRoute =
      inboxV2SourceRegistryRelatedAuthorityReferenceSchema.parse(
        relatedAuthority("source_ingress_route")
      );
    const previousInput = structuredClone(
      connectionStateInput("2", "2")
    ) as unknown as z.input<typeof inboxV2SourceConnectionRegistryStateSchema>;
    previousInput.payload.relatedAuthorities = [activeRoute];
    const previousState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: previousInput
    });

    const stillActiveInput = structuredClone(
      connectionStateInput("3", "3")
    ) as unknown as z.input<typeof inboxV2SourceConnectionRegistryStateSchema>;
    stillActiveInput.payload.status = "disabled";
    stillActiveInput.payload.routeAuthority.state = "denied";
    stillActiveInput.payload.routeAuthority.changedAt =
      "2026-07-16T08:02:00.000Z";
    stillActiveInput.payload.updatedAt = "2026-07-16T08:02:00.000Z";
    stillActiveInput.payload.relatedAuthorities = [activeRoute];
    const stillActiveState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: stillActiveInput
    });
    expect(() =>
      defineTransition({
        previousState,
        resultingState: stillActiveState,
        intent: "disable"
      })
    ).toThrow(/retain and revoke/u);

    const revokedRoute =
      inboxV2SourceRegistryRelatedAuthorityReferenceSchema.parse({
        ...activeRoute,
        revision: "2",
        status: "revoked"
      });
    const revokedInput = structuredClone(stillActiveInput) as z.input<
      typeof inboxV2SourceConnectionRegistryStateSchema
    >;
    revokedInput.payload.relatedAuthorities = [revokedRoute];
    const revokedState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: revokedInput
    });
    expect(() =>
      defineTransition({
        previousState,
        resultingState: revokedState,
        intent: "disable",
        relatedAuthorityTransitions: [
          {
            transitionId: "transition:ingress-revoke-0001",
            intent: "revoke",
            expectedRevision: "1",
            resultingRevision: "2",
            previous: activeRoute,
            resulting: revokedRoute
          }
        ]
      })
    ).not.toThrow();

    const removedInput = structuredClone(stillActiveInput) as z.input<
      typeof inboxV2SourceConnectionRegistryStateSchema
    >;
    removedInput.payload.relatedAuthorities = [];
    const removedState = defineInboxV2SourceConnectionRegistryState({
      lifecycleBinding: binding,
      value: removedInput
    });
    expect(() =>
      defineTransition({
        previousState,
        resultingState: removedState,
        intent: "disable"
      })
    ).toThrow(/cannot be removed/u);
  });

  it.each([
    ["replace", "replaced", "1"],
    ["reconnect", "pending", "2"]
  ] as const)(
    "preserves SourceAccount identity history and invalidates route on %s",
    (intent, status, accountGeneration) => {
      const { binding } = lifecycleBinding();
      const previousState = defineInboxV2SourceAccountRegistryState({
        lifecycleBinding: binding,
        value: accountStateInput({ revision: "2", generation: "2" })
      });
      const resultingState = defineInboxV2SourceAccountRegistryState({
        lifecycleBinding: binding,
        value: accountStateInput({
          revision: "3",
          generation: "3",
          status,
          routeState: "denied",
          updatedAt: "2026-07-16T08:02:00.000Z",
          identityRevision: accountGeneration,
          accountGeneration
        })
      });
      expect(() =>
        defineTransition({ previousState, resultingState, intent })
      ).not.toThrow();
    }
  );

  it("binds an adapter declaration to exact lifecycle composition and slots", () => {
    const { binding } = lifecycleBinding();
    const declaration = defineInboxV2SourceAdapterDeclaration({
      lifecycleBinding: binding,
      value: adapterDeclarationInput(binding)
    });
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(hash).toMatch(/^sha256:/u);
  });
});
