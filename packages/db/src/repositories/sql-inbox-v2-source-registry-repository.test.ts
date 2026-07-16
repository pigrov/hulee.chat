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
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { RawSqlExecutor } from "./sql-outbox-repository";
import {
  createSqlInboxV2SourceRegistryRepository,
  type InboxV2SourceRegistryTransactionExecutor
} from "./sql-inbox-v2-source-registry-repository";
import type { TenantSecretCipher } from "./sql-tenant-secret-repository";

const tenantId = "tenant:source-registry-test" as TenantId;
const occurredAt = "2026-07-16T08:00:00.000Z";
const dialect = new PgDialect();

describe("SQL Inbox V2 source-registry repository", () => {
  it("commits exact-byte secret, compatibility row, authority and route atomically", async () => {
    const fixture = createFixture();
    const executor = createRecordingTransactionExecutor();
    const cipherInputs: string[] = [];
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher(cipherInputs)
    );

    const record = await repository.commitSourceConnectionOnboarding(
      fixture.input
    );

    expect(record.id).toBe(fixture.connectionId);
    expect(record.status).toBe("onboarding");
    expect(executor.transactionCalls).toBe(1);
    expect(
      executor.committedSql.some((text) => text.includes("tenant_secrets"))
    ).toBe(true);
    expect(
      executor.committedSql.some((text) =>
        text.includes("inbox_v2_source_registry_heads")
      )
    ).toBe(true);
    expect(cipherInputs).toEqual([
      `bytes:v1:${Buffer.from(fixture.secretMaterial).toString("base64url")}`
    ]);
    expect(executor.committedSql.join("\n")).not.toContain(
      new TextDecoder().decode(fixture.secretMaterial)
    );
  });

  it("finds a tenant-scoped source connection only through its committed V2 head", async () => {
    const fixture = createFixture();
    const executor = createRecordingTransactionExecutor();
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher([])
    );

    const record = await repository.findCommittedSourceConnection({
      tenantId,
      sourceConnectionId: fixture.connectionId
    });

    expect(record?.id).toBe(fixture.connectionId);
    expect(record?.tenantId).toBe(tenantId);
    expect(executor.transactionCalls).toBe(0);
    expect(executor.attemptedSql).toHaveLength(1);
    expect(executor.attemptedSql[0]).toContain(
      "join inbox_v2_source_registry_heads"
    );
    expect(executor.attemptedSql[0]).toContain(
      "head.authority_kind = 'source_connection'"
    );
    expect(executor.attemptedSql[0]).toContain(tenantId);
    expect(executor.attemptedSql[0]).toContain(fixture.connectionId);
  });

  it("rolls back the tenant secret when the authority head write fails", async () => {
    const fixture = createFixture();
    const executor = createRecordingTransactionExecutor({
      failOn: "insert into inbox_v2_source_registry_heads"
    });
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher([])
    );

    await expect(
      repository.commitSourceConnectionOnboarding(fixture.input)
    ).rejects.toThrow(/injected transaction failure/u);

    expect(
      executor.attemptedSql.some((text) => text.includes("tenant_secrets"))
    ).toBe(true);
    expect(executor.committedSql).toEqual([]);
  });

  it("rejects a secret byte digest mismatch before opening a transaction", async () => {
    const fixture = createFixture();
    const executor = createRecordingTransactionExecutor();
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher([])
    );

    await expect(
      repository.commitSourceConnectionOnboarding({
        ...fixture.input,
        secretWrites: fixture.input.secretWrites.map((write) => ({
          ...write,
          materialDigest: prefixedDigest(new TextEncoder().encode("different"))
        }))
      })
    ).rejects.toThrow(/digest does not match bytes/u);
    expect(executor.transactionCalls).toBe(0);
  });

  it("fails closed on classified artifact material without a payload writer", async () => {
    const fixture = createFixture({ includeArtifact: true });
    const executor = createRecordingTransactionExecutor();
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher([])
    );

    await expect(
      repository.commitSourceConnectionOnboarding(fixture.input)
    ).rejects.toThrow(/transactional payload writer/u);
    expect(executor.transactionCalls).toBe(0);
  });

  it("persists classified payload bytes in the same transaction before its ref", async () => {
    const fixture = createFixture({ includeArtifact: true });
    const callerArtifactMaterial = Uint8Array.from(
      fixture.input.artifactWrites[0]!.material
    );
    const callerRouteMaterial = Uint8Array.from(
      fixture.input.routeWrites[0]!.material
    );
    const executor = createRecordingTransactionExecutor();
    const writerInputs: unknown[] = [];
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher([]),
      {
        classifiedPayloadWriter: {
          buildWriteSql(input) {
            writerInputs.push(input);
            return sql`select 1 as source_registry_classified_payload_write`;
          }
        }
      }
    );

    await expect(
      repository.commitSourceConnectionOnboarding(fixture.input)
    ).resolves.toMatchObject({
      id: fixture.connectionId,
      status: "onboarding"
    });

    expect(writerInputs).toHaveLength(1);
    expect(writerInputs[0]).toMatchObject({
      tenantId,
      authorityId: fixture.connectionId,
      authorityRevision: "1",
      transitionId: "source-registry-transition:create-0001",
      materialDigest: fixture.input.artifactWrites[0]!.artifact.payload.digest
    });
    expect(
      Array.from((writerInputs[0] as { material: Uint8Array }).material)
    ).toEqual(new Array(callerArtifactMaterial.byteLength).fill(0));
    expect(Array.from(fixture.input.artifactWrites[0]!.material)).toEqual(
      Array.from(callerArtifactMaterial)
    );
    expect(Array.from(fixture.input.routeWrites[0]!.material)).toEqual(
      Array.from(callerRouteMaterial)
    );
    const committed = executor.committedSql.join("\n");
    expect(
      committed.indexOf("source_registry_classified_payload_write")
    ).toBeLessThan(committed.indexOf("inbox_v2_source_registry_artifact_refs"));
  });

  it("rolls back all onboarding writes when the classified payload writer fails", async () => {
    const fixture = createFixture({ includeArtifact: true });
    const callerArtifactMaterial = Uint8Array.from(
      fixture.input.artifactWrites[0]!.material
    );
    const callerRouteMaterial = Uint8Array.from(
      fixture.input.routeWrites[0]!.material
    );
    const executor = createRecordingTransactionExecutor();
    let retainedWriterMaterial: Uint8Array | undefined;
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher([]),
      {
        classifiedPayloadWriter: {
          buildWriteSql(input) {
            retainedWriterMaterial = input.material;
            throw new Error("injected classified payload failure");
          }
        }
      }
    );

    await expect(
      repository.commitSourceConnectionOnboarding(fixture.input)
    ).rejects.toThrow("injected classified payload failure");

    expect(executor.transactionCalls).toBe(1);
    expect(executor.committedSql).toEqual([]);
    expect(
      executor.attemptedSql.some((text) =>
        text.includes("insert into source_connections")
      )
    ).toBe(true);
    expect(
      executor.attemptedSql.some((text) =>
        text.includes("inbox_v2_source_registry_artifact_refs")
      )
    ).toBe(false);
    expect(Array.from(retainedWriterMaterial ?? [])).toEqual(
      new Array(callerArtifactMaterial.byteLength).fill(0)
    );
    expect(Array.from(fixture.input.artifactWrites[0]!.material)).toEqual(
      Array.from(callerArtifactMaterial)
    );
    expect(Array.from(fixture.input.routeWrites[0]!.material)).toEqual(
      Array.from(callerRouteMaterial)
    );
  });

  it.each([
    [
      "unknown artifact schema",
      {
        includeArtifact: true,
        artifactSchemaId: "module:unknown:configuration"
      }
    ],
    [
      "unsupported artifact version",
      { includeArtifact: true, artifactSchemaVersion: "v2" }
    ],
    [
      "undeclared artifact",
      { includeArtifact: true, configurationSchema: null }
    ],
    [
      "missing declared artifact",
      {
        includeArtifact: false,
        configurationSchema: {
          schemaId: "module:synthetic:configuration",
          supportedVersions: ["v1"]
        }
      }
    ]
  ] as const)("rejects %s before SQL", async (_name, options) => {
    const fixture = createFixture(options);
    const executor = createRecordingTransactionExecutor();
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher([]),
      {
        classifiedPayloadWriter: {
          buildWriteSql() {
            return sql`select 1 as source_registry_classified_payload_write`;
          }
        }
      }
    );

    await expect(
      repository.commitSourceConnectionOnboarding(fixture.input)
    ).rejects.toThrow(/artifact/iu);
    expect(executor.transactionCalls).toBe(0);
  });

  it("rejects a different authentic lifecycle binding from the same registry composition", async () => {
    const fixture = createFixture({
      mismatchedAuthenticLifecycleBinding: true
    });
    const executor = createRecordingTransactionExecutor();
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher([])
    );

    await expect(
      repository.commitSourceConnectionOnboarding(fixture.input)
    ).rejects.toThrow(/authentic declaration, lifecycle/iu);
    expect(executor.transactionCalls).toBe(0);
  });

  it("fails closed for a direct employee commit before transaction", async () => {
    const fixture = createFixture({ employeeActor: true });
    const executor = createRecordingTransactionExecutor();
    const cipherInputs: string[] = [];
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher(cipherInputs)
    );

    await expect(
      repository.commitSourceConnectionOnboarding(fixture.input)
    ).rejects.toThrow(/employee source onboarding requires.*coordinator/iu);
    expect(executor.transactionCalls).toBe(0);
    expect(executor.attemptedSql).toEqual([]);
    expect(cipherInputs).toEqual([]);
  });

  it("rejects a structurally forged coordinator context before DB-only employee onboarding", async () => {
    const fixture = createFixture({ employeeActor: true });
    const executor = createRecordingTransactionExecutor();
    const cipherInputs: string[] = [];
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher(cipherInputs)
    );

    await expect(
      repository.persistSourceConnectionOnboarding(
        {
          executor: executor.rawTransaction,
          tenantId,
          commandId: "command:forged-source-onboarding",
          clientMutationId: "client-mutation:forged-source-onboarding",
          commandTypeId: "core:source-connection.create",
          mutationId: "source-onboarding-mutation:forged",
          profile: "domain",
          revisionEffects: []
        } as never,
        {
          onboarding: fixture.input,
          resultSnapshot: {
            resultReference: {
              tenantId,
              recordId: "source-onboarding-result:forged",
              schemaId: "core:inbox-v2.source-onboarding-result",
              schemaVersion: "v1",
              digest: prefixedDigest(new TextEncoder().encode("forged"))
            },
            streamCommitId: "source-onboarding-commit:forged",
            auditTargetRef: `internal-ref:${"a".repeat(64)}`,
            tenantFacetRef: `internal-ref:${"b".repeat(64)}`
          }
        } as never
      )
    ).rejects.toThrow(/live authorized-command context/iu);

    expect(executor.transactionCalls).toBe(0);
    expect(executor.committedSql).toEqual([]);
    expect(executor.rawTransactionSql).toEqual([]);
    expect(cipherInputs).toEqual([]);
  });

  it("resolves immutable onboarding references only inside the requested tenant", async () => {
    const internalReference = `internal-ref:${"c".repeat(64)}`;
    const executor = createRecordingTransactionExecutor({
      sourceOnboardingInternalReferenceRow: {
        source_connection_id: "source_connection:synthetic-primary",
        audit_target_ref: internalReference,
        tenant_facet_ref: `internal-ref:${"d".repeat(64)}`
      }
    });
    const repository = createSqlInboxV2SourceRegistryRepository(
      executor,
      recordingCipher([])
    );

    await expect(
      repository.resolveSourceOnboardingInternalReference({
        tenantId,
        internalReference
      })
    ).resolves.toEqual({
      entityTypeId: "core:source-connection",
      entityId: "source_connection:synthetic-primary"
    });

    expect(executor.attemptedSql).toHaveLength(1);
    expect(executor.attemptedSql[0]).toContain(
      "from inbox_v2_source_onboarding_result_snapshots"
    );
    expect(executor.attemptedSql[0]).toMatch(
      /where result\.tenant_id = \$\d+/u
    );
    expect(executor.attemptedSql[0]).toContain(tenantId);
    expect(executor.attemptedSql[0]).toContain(internalReference);
  });

  it.each([
    ["sourceType", "marketplace"],
    ["status", "active"],
    ["authType", "custom"]
  ] as const)(
    "rejects incompatible legacy compatibility field %s before SQL",
    async (field, value) => {
      const fixture = createFixture();
      const executor = createRecordingTransactionExecutor();
      const repository = createSqlInboxV2SourceRegistryRepository(
        executor,
        recordingCipher([])
      );

      await expect(
        repository.commitSourceConnectionOnboarding({
          ...fixture.input,
          compatibilityConnection: {
            ...fixture.input.compatibilityConnection,
            [field]: value
          }
        })
      ).rejects.toThrow(/compatibility sourceconnection/iu);
      expect(executor.transactionCalls).toBe(0);
    }
  );
});

function createFixture(
  options: {
    includeArtifact?: boolean;
    configurationSchema?: {
      schemaId: string;
      supportedVersions: readonly string[];
    } | null;
    artifactSchemaId?: string;
    artifactSchemaVersion?: string;
    mismatchedAuthenticLifecycleBinding?: boolean;
    employeeActor?: boolean;
  } = {}
) {
  const registry = lifecycleRegistry();
  const registryReference = {
    id: "core:source-registry-lifecycle",
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
    loadedAt: occurredAt
  } as const;
  const rawIngressSanitizerProfile = {
    schemaId: "core:inbox-v2.raw-ingress-sanitizer-profile" as const,
    schemaVersion: "v1" as const,
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
        dataClassId: "core:raw_provider_payload" as const,
        purposeIds: ["core:source_replay_and_diagnostics" as const]
      },
      allowedHeadersClassification: {
        dataClassId: "core:raw_provider_allowed_headers" as const,
        purposeIds: ["core:source_replay_and_diagnostics" as const]
      }
    }
  };
  const sourceNormalizerProfile = {
    schemaId: "core:inbox-v2.source-normalizer-profile" as const,
    schemaVersion: "v1" as const,
    payload: {
      adapterContract,
      handlerId: "module:synthetic:normalize-webhook",
      handlerVersion: "v1",
      declarationRevision: "1",
      rawIngressSanitizer: {
        profileSchemaId: rawIngressSanitizerProfile.schemaId,
        profileSchemaVersion: rawIngressSanitizerProfile.schemaVersion,
        handlerId: rawIngressSanitizerProfile.payload.handlerId,
        handlerVersion: rawIngressSanitizerProfile.payload.handlerVersion,
        declarationRevision:
          rawIngressSanitizerProfile.payload.declarationRevision,
        restrictedPayloadSchema:
          rawIngressSanitizerProfile.payload.restrictedPayloadSchema
      },
      eventKinds: ["message_created" as const],
      identityDeclarations: [],
      evidenceSlots: []
    }
  };
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
        configurationSchema:
          options.configurationSchema !== undefined
            ? options.configurationSchema === null
              ? null
              : {
                  schemaId: options.configurationSchema.schemaId,
                  supportedVersions: [
                    ...options.configurationSchema.supportedVersions
                  ]
                }
            : options.includeArtifact
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
          sanitizerProfile: rawIngressSanitizerProfile
        },
        normalization: {
          mode: "supported",
          normalizerProfile: sourceNormalizerProfile
        }
      }
    }
  });
  const inputLifecycleBinding = options.mismatchedAuthenticLifecycleBinding
    ? defineInboxV2SourceRegistryLifecycleBinding({
        registry,
        value: structuredClone(lifecycleBinding) as never
      })
    : lifecycleBinding;
  const connectionId =
    "source_connection:synthetic-primary" as SourceConnectionId;
  const secretMaterial = new TextEncoder().encode("exact-secret-bytes-0001");
  const routeMaterial = new TextEncoder().encode("exact-route-bytes-0000001");
  const secretBinding = {
    tenantId,
    bindingId: "credential-binding:synthetic-0001",
    revision: "1",
    status: "active",
    lifecycle: locator("credential_binding")
  } as unknown as InboxV2SourceRegistrySecretReference;
  const route: Extract<
    InboxV2SourceRegistryRelatedAuthorityReference,
    { kind: "source_ingress_route" }
  > = {
    kind: "source_ingress_route",
    tenantId,
    authorityId: "source-ingress-route:synthetic-0001",
    revision: "1",
    status: "active",
    sourceConnection: {
      tenantId,
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
  const artifactMaterial = new TextEncoder().encode("classified-artifact");
  const artifact = {
    kind: "configuration",
    payload: {
      tenantId,
      recordId: "payload:source-registry-config-0001",
      schemaId: options.artifactSchemaId ?? "module:synthetic:configuration",
      schemaVersion: options.artifactSchemaVersion ?? "v1",
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
        tenantId,
        entityKind: "source_connection",
        sourceConnection: {
          tenantId,
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
          changedAt: occurredAt
        },
        artifacts: options.includeArtifact ? [artifact] : [],
        credentialBindings: [secretBinding],
        relatedAuthorities: [route],
        createdBy: options.employeeActor
          ? {
              kind: "employee",
              employee: {
                tenantId,
                kind: "employee",
                id: "employee:source-registry-operator"
              },
              authorizationEpoch: "authorization:epoch-1"
            }
          : {
              kind: "trusted_service",
              trustedServiceId: "core:source-runtime"
            },
        createdAt: occurredAt,
        updatedAt: occurredAt
      }
    }
  });
  const transition = defineInboxV2SourceRegistryTransition({
    value: {
      schemaId: "core:inbox-v2.source-registry-transition",
      schemaVersion: "v1",
      payload: {
        tenantId,
        transitionId: "source-registry-transition:create-0001",
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
            transitionId: "related-transition:create-route-0001",
            intent: "create",
            expectedRevision: null,
            resultingRevision: "1",
            previous: null,
            resulting: route
          }
        ],
        actor: state.payload.createdBy,
        committedAt: occurredAt
      }
    }
  });
  return {
    connectionId,
    secretMaterial,
    input: {
      declaration,
      lifecycleBinding: inputLifecycleBinding,
      transition,
      compatibilityConnection: {
        id: connectionId,
        tenantId,
        sourceType: "messenger",
        sourceName: "synthetic",
        displayName: "Synthetic",
        status: "onboarding",
        authType: "webhook_secret",
        createdByEmployeeId:
          state.payload.createdBy.kind === "employee"
            ? state.payload.createdBy.employee.id
            : null,
        updatedAt: new Date(occurredAt)
      },
      artifactWrites: options.includeArtifact
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

function createRecordingTransactionExecutor(
  input: {
    failOn?: string;
    sourceOnboardingInternalReferenceRow?: Record<string, unknown>;
  } = {}
) {
  const committedSql: string[] = [];
  const attemptedSql: string[] = [];
  const rawTransactionSql: string[] = [];
  let transactionCalls = 0;
  const sourceConnectionRow = {
    id: "source_connection:synthetic-primary",
    tenant_id: tenantId,
    source_type: "messenger",
    source_name: "synthetic",
    display_name: "Synthetic",
    status: "onboarding",
    auth_type: "webhook_secret",
    capabilities: {},
    config: {},
    diagnostics: {},
    metadata: {},
    created_by_employee_id: null,
    created_at: new Date(occurredAt),
    updated_at: new Date(occurredAt)
  };
  const createRawExecutor = (pending: string[]): RawSqlExecutor => ({
    async execute<Row extends Record<string, unknown>>(
      query: Parameters<RawSqlExecutor["execute"]>[0]
    ) {
      const rendered = dialect.sqlToQuery(query);
      const normalized = rendered.sql.toLowerCase();
      const captured = `${rendered.sql}\n${JSON.stringify(
        rendered.params,
        (_key, value) => (typeof value === "bigint" ? value.toString() : value)
      )}`;
      attemptedSql.push(captured);
      pending.push(captured);
      if (input.failOn && normalized.includes(input.failOn)) {
        throw new Error("injected transaction failure");
      }
      if (
        normalized.includes("from inbox_v2_data_governance_registry_versions")
      ) {
        return {
          rows: [
            {
              canonical_anchor_id: "core:disconnect_or_account_termination",
              effective_policy_id: "policy:default",
              effective_policy_version: "1",
              effective_rule_id: "rule:source-registry",
              effective_rule_revision: "1",
              policy_activation_id: "activation:default",
              policy_activation_revision: "1",
              policy_activation_head_revision: "1",
              legal_hold_set_revision: "0",
              restriction_set_revision: "0"
            } as unknown as Row
          ]
        };
      }
      if (normalized.includes("from source_connections sc")) {
        return { rows: [sourceConnectionRow as unknown as Row] };
      }
      if (normalized.includes("insert into source_connections")) {
        return { rows: [sourceConnectionRow as unknown as Row] };
      }
      if (
        normalized.includes(
          "from inbox_v2_source_onboarding_result_snapshots"
        ) &&
        input.sourceOnboardingInternalReferenceRow !== undefined
      ) {
        return {
          rows: [input.sourceOnboardingInternalReferenceRow as Row]
        };
      }
      return { rows: [] };
    }
  });
  const rawTransaction = createRawExecutor(rawTransactionSql);
  const readExecutor = createRawExecutor([]);
  const executor: InboxV2SourceRegistryTransactionExecutor & {
    readonly committedSql: string[];
    readonly attemptedSql: string[];
    readonly rawTransaction: RawSqlExecutor;
    readonly rawTransactionSql: string[];
    readonly transactionCalls: number;
  } = {
    committedSql,
    attemptedSql,
    rawTransaction,
    rawTransactionSql,
    get transactionCalls() {
      return transactionCalls;
    },
    async execute(query) {
      return readExecutor.execute(query);
    },
    async transaction(work) {
      transactionCalls += 1;
      const pending: string[] = [];
      const result = await work(createRawExecutor(pending));
      committedSql.push(...pending);
      return result;
    }
  };
  return executor;
}

function recordingCipher(inputs: string[]): TenantSecretCipher {
  return {
    keyRef: "test-key",
    encrypt(value) {
      inputs.push(value);
      return `sealed:${prefixedDigest(new TextEncoder().encode(value))}`;
    },
    decrypt() {
      throw new Error("not used");
    }
  };
}

function prefixedDigest(material: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}
