import type {
  EmployeeId,
  SourceConnectionId,
  TenantId
} from "@hulee/contracts";
import {
  calculateInboxV2CanonicalSha256,
  findSourceCatalogItem,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2StreamEpochSchema
} from "@hulee/contracts";
import type {
  InboxV2AuthorizedCommandCoordinator,
  InboxV2AuthorizedCommandMutationCallbackResult,
  InboxV2AuthorizedCommandMutationContext,
  InboxV2AuthorizedCommandMutationResult,
  SourceConnectionRecord,
  WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";
import { createSqlInboxV2AuthorizedCommandCoordinator } from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  createSourceAdapterOnboardingPrepareInput,
  createHmacSourceOnboardingCredentialFingerprintProvider,
  createSourceOnboardingRequestHash,
  createSourceRegistryOnboardingUnitOfWork,
  resolveSourceOnboardingAuthorization,
  type SourceOnboardingAuthorization,
  type SourceRegistryOnboardingUnitOfWork
} from "./source-registry-onboarding";
import { createTestMegaPbxSourceAdapterRegistry } from "./test-support/source-adapter-registry-fixture";

const tenantId = "tenant-integrations" as TenantId;
const employeeId = "employee-1" as EmployeeId;
const sourceConnectionId =
  "source_connection:megapbx:source-test" as SourceConnectionId;
const requestedAt = new Date("2026-07-16T10:00:00.000Z");
const clientMutationId = inboxV2ClientMutationIdSchema.parse(
  "client-mutation:source-onboarding-test"
);
const credentialFingerprintProvider =
  createHmacSourceOnboardingCredentialFingerprintProvider({
    keyGeneration: "test-generation-v1",
    hmacKey: new TextEncoder().encode(
      "source-onboarding-test-hmac-key-material-v1"
    )
  });

describe("source registry authorized onboarding", () => {
  it("commits the DB-only source callback through the domain coordinator", async () => {
    const fixture = await createFixture();
    let captured:
      | Parameters<
          InboxV2AuthorizedCommandCoordinator["withAuthorizedCommandMutation"]
        >[0]
      | undefined;
    const transaction = { execute: vi.fn() };
    const persistSourceConnectionOnboarding = vi.fn(async (context, input) => {
      expect(context).toMatchObject({
        executor: transaction,
        tenantId,
        commandId: expect.any(String),
        clientMutationId,
        commandTypeId: "core:source-connection.create",
        mutationId: expect.any(String),
        profile: "domain",
        revisionEffects: []
      });
      expect(input.onboarding.secretWrites[0]?.material).toEqual(
        new TextEncoder().encode("megapbx-webhook-token")
      );
      expect(input.resultSnapshot).toMatchObject({
        resultReference: {
          tenantId,
          recordId: expect.any(String),
          schemaId: "core:inbox-v2.source-onboarding-result",
          schemaVersion: "v1",
          digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
        },
        streamCommitId: expect.any(String),
        lifecycle: {
          copySlot: "source_onboarding_result_snapshot",
          dataClassId: "core:source_account_connector_metadata",
          storageRootId: "core:source-registry-sql",
          purposeId: "core:source_replay_and_diagnostics",
          lineageRevision: "1"
        },
        auditTargetRef: expect.any(String),
        tenantFacetRef: expect.any(String),
        grantSourceMappings: [
          {
            internalReference: expect.stringMatching(
              /^internal-ref:[a-f0-9]{64}$/u
            ),
            authorizationDecisionId: fixture.authorization.decisionRefs[0]!.id
          }
        ]
      });
      return fixture.record;
    });
    const coordinator: InboxV2AuthorizedCommandCoordinator = {
      async withAuthorizedCommandMutation<TResult>(
        input: WithInboxV2AuthorizedCommandMutationInput,
        persist: (
          context: InboxV2AuthorizedCommandMutationContext
        ) => Promise<InboxV2AuthorizedCommandMutationCallbackResult<TResult>>
      ): Promise<InboxV2AuthorizedCommandMutationResult<TResult>> {
        captured = input;
        const callback = await persist({
          executor,
          tenantId: input.tenantId,
          commandId: input.command.id,
          clientMutationId: input.command.clientMutationId,
          commandTypeId: input.command.commandTypeId,
          actor: input.command.actor,
          authorizationDecisionId: input.command.authorizationDecisionId,
          authorizedAt: input.command.authorizedAt,
          occurredAt: input.occurredAt,
          mutationId: input.records.mutationId,
          profile: "domain",
          revisionEffects: []
        });
        return {
          kind: "applied",
          result: callback.result,
          status: {
            ...commitStatus(input),
            sensitiveResultReference: null
          },
          revisionEffects: []
        };
      }
    };
    const executor = transaction as never;
    const unitOfWork = createSourceRegistryOnboardingUnitOfWork({
      repository: {
        persistSourceConnectionOnboarding,
        loadSourceOnboardingResultSnapshot: vi.fn()
      },
      coordinator
    });

    const result = await unitOfWork.onboardStandaloneSource(fixture.input);

    expect(result).toMatchObject({
      kind: "applied",
      connection: { id: sourceConnectionId },
      commit: { publicResultCode: "core:source-connection.created" }
    });
    expect(persistSourceConnectionOnboarding).toHaveBeenCalledTimes(1);
    expect(captured).toMatchObject({
      tenantId,
      command: {
        clientMutationId,
        commandTypeId: "core:source-connection.create",
        actor: { kind: "employee", employeeId },
        authorizationEpoch: fixture.authorization.snapshot.value,
        resultReference: {
          tenantId,
          recordId: expect.any(String),
          schemaId: "core:inbox-v2.source-onboarding-result",
          schemaVersion: "v1",
          digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
        },
        sensitiveResultReference: null
      },
      revisions: {
        expectedTenantRbacRevision: "7",
        expectedSharedAccessRevision: "2",
        advanceTenantRbac: false,
        advanceSharedAccess: false,
        employees: [
          {
            employeeId,
            expectedEmployeeAccessRevision: "5",
            expectedEmployeeInboxRelationRevision: "6",
            advanceEmployeeAccess: false,
            advanceEmployeeInboxRelation: false
          }
        ],
        resources: []
      },
      records: {
        relationKind: null,
        audienceImpact: { kind: "none" },
        changes: [
          {
            state: {
              payloadReference: { recordId: expect.any(String) },
              domainCommitReference: {
                recordId: expect.any(String)
              }
            }
          }
        ],
        events: [
          {
            typeId: "core:source-connection.changed",
            commandIds: [expect.any(String)],
            clientMutationIds: [clientMutationId]
          }
        ],
        audit: {
          grantSourceIds: [
            expect.stringMatching(/^internal-ref:[a-f0-9]{64}$/u)
          ]
        }
      }
    });
    expect(JSON.stringify(captured)).not.toContain("megapbx-webhook-token");
    const normalizationSentinel = new Error(
      "authorized command normalization completed"
    );
    const validatingCoordinator = createSqlInboxV2AuthorizedCommandCoordinator({
      execute: vi.fn(),
      transaction: vi.fn(async () => {
        throw normalizationSentinel;
      })
    } as never);
    await expect(
      validatingCoordinator.withAuthorizedCommandMutation(
        captured!,
        async () => ({ result: fixture.record })
      )
    ).rejects.toBe(normalizationSentinel);
  });

  it("loads the immutable non-sensitive result snapshot on an equal-hash replay", async () => {
    const fixture = await createFixture();
    const immutableResult = Object.freeze({ ...fixture.record });
    const loadSourceOnboardingResultSnapshot = vi.fn(
      async (_context, _input) => immutableResult
    );
    const persistSourceConnectionOnboarding = vi.fn();
    const executor = { execute: vi.fn() } as never;
    const coordinator: InboxV2AuthorizedCommandCoordinator = {
      async withAuthorizedCommandMutation<TResult>(
        input: WithInboxV2AuthorizedCommandMutationInput,
        _persist: (
          context: InboxV2AuthorizedCommandMutationContext
        ) => Promise<InboxV2AuthorizedCommandMutationCallbackResult<TResult>>,
        loadCommittedResult?: (
          context: InboxV2AuthorizedCommandMutationContext,
          status: ReturnType<typeof commitStatus>
        ) => Promise<TResult>
      ): Promise<InboxV2AuthorizedCommandMutationResult<TResult>> {
        const status = commitStatus(input);
        const context = {
          executor,
          tenantId: input.tenantId,
          commandId: input.command.id,
          clientMutationId: input.command.clientMutationId,
          commandTypeId: input.command.commandTypeId,
          actor: input.command.actor,
          authorizationDecisionId: input.command.authorizationDecisionId,
          authorizedAt: input.command.authorizedAt,
          occurredAt: input.occurredAt,
          mutationId: input.records.mutationId,
          profile: "domain" as const,
          revisionEffects: []
        };
        return {
          kind: "already_applied",
          status,
          ...(loadCommittedResult
            ? { result: await loadCommittedResult(context, status) }
            : {})
        } as InboxV2AuthorizedCommandMutationResult<TResult>;
      }
    };
    const unitOfWork = createSourceRegistryOnboardingUnitOfWork({
      repository: {
        persistSourceConnectionOnboarding,
        loadSourceOnboardingResultSnapshot
      },
      coordinator
    });

    const result = await unitOfWork.onboardStandaloneSource(fixture.input);

    expect(result.kind).toBe("already_applied");
    expect(result.connection).toBe(immutableResult);
    expect(persistSourceConnectionOnboarding).not.toHaveBeenCalled();
    expect(loadSourceOnboardingResultSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        executor,
        tenantId,
        commandId: expect.any(String),
        clientMutationId,
        commandTypeId: "core:source-connection.create",
        profile: "domain"
      }),
      {
        resultReference: expect.objectContaining({
          tenantId,
          schemaId: "core:inbox-v2.source-onboarding-result",
          schemaVersion: "v1"
        })
      }
    );
  });

  it("fails closed on a different-hash idempotency conflict", async () => {
    const fixture = await createFixture();
    const persistSourceConnectionOnboarding = vi.fn();
    const coordinator: InboxV2AuthorizedCommandCoordinator = {
      async withAuthorizedCommandMutation<TResult>(
        _input: WithInboxV2AuthorizedCommandMutationInput,
        _persist: (
          context: InboxV2AuthorizedCommandMutationContext
        ) => Promise<InboxV2AuthorizedCommandMutationCallbackResult<TResult>>
      ): Promise<InboxV2AuthorizedCommandMutationResult<TResult>> {
        return {
          kind: "idempotency_conflict",
          code: "command.idempotency_conflict"
        } as InboxV2AuthorizedCommandMutationResult<TResult>;
      }
    };
    const unitOfWork = createSourceRegistryOnboardingUnitOfWork({
      repository: {
        persistSourceConnectionOnboarding,
        loadSourceOnboardingResultSnapshot: vi.fn()
      },
      coordinator
    });

    await expect(
      unitOfWork.onboardStandaloneSource(fixture.input)
    ).rejects.toMatchObject({
      code: "command.idempotency_conflict",
      message: "command.idempotency_conflict"
    });
    expect(persistSourceConnectionOnboarding).not.toHaveBeenCalled();
  });

  it("hashes an HMAC credential fingerprint without retaining plaintext", async () => {
    const webhookToken = "megapbx-webhook-token";
    const input = {
      tenantId,
      sourceName: "megapbx",
      displayName: "Sales MegaPBX",
      clientMutationId,
      credentialFingerprint: await fingerprintCredential(webhookToken)
    };

    const hash = createSourceOnboardingRequestHash(input);

    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(hash).toBe(createSourceOnboardingRequestHash(input));
    expect(hash).not.toContain(webhookToken);
    expect(
      createSourceOnboardingRequestHash({
        ...input,
        credentialFingerprint: await fingerprintCredential(
          "different-megapbx-token"
        )
      })
    ).not.toBe(hash);
  });

  it.each([
    {
      name: "non-tenant scope",
      patch: {
        resourceScopeId: "core:permission-scope.team",
        resource: { tenantId, entityTypeId: "core:tenant", entityId: tenantId }
      }
    },
    {
      name: "non-tenant resource type",
      patch: {
        resourceScopeId: "core:permission-scope.tenant",
        resource: {
          tenantId,
          entityTypeId: "core:work-item",
          entityId: tenantId
        }
      }
    },
    {
      name: "different tenant entity",
      patch: {
        resourceScopeId: "core:permission-scope.tenant",
        resource: {
          tenantId,
          entityTypeId: "core:tenant",
          entityId: "tenant-other"
        }
      }
    }
  ])("rejects a $name decision before onboarding", async ({ patch }) => {
    const authorization = currentAuthorization();
    const decision = authorization.decisionRefs[0]!;
    const forgedDecision = inboxV2AuthorizationDecisionReferenceSchema.parse({
      ...decision,
      ...patch
    });

    await expect(
      resolveSourceOnboardingAuthorization({
        context: { requestId: "request-tenant-scope", tenantId, employeeId },
        sourceName: "megapbx",
        requestedAt,
        authorizationResolver: {
          async resolveSourceOnboardingAuthorization() {
            return { ...authorization, decisionRefs: [forgedDecision] };
          }
        }
      })
    ).rejects.toMatchObject({ code: "permission.denied" });
  });
});

async function createFixture(): Promise<{
  authorization: SourceOnboardingAuthorization;
  input: Parameters<
    SourceRegistryOnboardingUnitOfWork["onboardStandaloneSource"]
  >[0];
  record: SourceConnectionRecord;
}> {
  const source = findSourceCatalogItem("megapbx");
  if (source === undefined) throw new Error("Missing MegaPBX source fixture.");
  const adapter = createTestMegaPbxSourceAdapterRegistry();
  const authorization = currentAuthorization();
  const invocation = createSourceAdapterOnboardingPrepareInput({
    context: { requestId: "request-1", tenantId, employeeId },
    actor: authorization.actor,
    source,
    sourceConnectionId,
    registration: adapter.registration,
    displayName: "Sales MegaPBX",
    publicBaseUrl: "https://chat.example.test",
    webhookToken: "megapbx-webhook-token",
    createWebhookToken: () => "unused-generated-token",
    createIngressRouteMaterial: testIngressRouteMaterial,
    requestedAt
  });
  const prepared = await adapter.onboardingHandler.prepare(
    invocation.prepareInput
  );
  const record: SourceConnectionRecord = {
    id: sourceConnectionId,
    tenantId,
    sourceType: source.sourceType,
    sourceName: source.sourceName,
    displayName: "Sales MegaPBX",
    status: "onboarding",
    authType: "webhook_secret",
    capabilities: {},
    config: {},
    diagnostics: {},
    metadata: {},
    createdByEmployeeId: employeeId,
    createdAt: requestedAt,
    updatedAt: requestedAt
  };
  return {
    authorization,
    input: {
      requestId: "request-1",
      clientMutationId,
      requestHash: createSourceOnboardingRequestHash({
        tenantId,
        sourceName: source.sourceName,
        displayName: record.displayName,
        clientMutationId,
        credentialFingerprint: await fingerprintCredential(
          "megapbx-webhook-token"
        )
      }),
      authorization,
      registration: adapter.registration,
      sourceConnection: {
        id: record.id,
        tenantId: record.tenantId,
        sourceType: record.sourceType,
        sourceName: record.sourceName,
        displayName: record.displayName,
        status: record.status,
        authType: record.authType,
        createdByEmployeeId: employeeId,
        updatedAt: requestedAt
      },
      prepared
    },
    record
  };
}

function currentAuthorization(): SourceOnboardingAuthorization {
  const epoch = inboxV2AuthorizationEpochSchema.parse(
    "authorization:source-onboarding-current"
  );
  const decidedAt = "2026-07-16T09:59:59.000Z";
  const notAfter = "2026-07-16T10:05:00.000Z";
  const snapshot = inboxV2AuthorizationEpochSnapshotSchema.parse({
    tenantId,
    employee: { tenantId, kind: "employee", id: employeeId },
    value: epoch,
    dependencies: {
      tenantRbacRevision: "7",
      employeeAccessRevision: "5",
      employeeInboxRelationRevision: "6",
      sharedAccessRevision: "2",
      resourceDependencies: [],
      temporalBoundaryDigest: calculateInboxV2CanonicalSha256({
        decidedAt,
        notAfter
      })
    },
    evaluatedAt: decidedAt,
    notAfter,
    nextAuthorizationBoundary: null
  });
  const decision = inboxV2AuthorizationDecisionReferenceSchema.parse({
    tenantId,
    id: "authorization-decision:source-onboarding",
    authorizationEpoch: epoch,
    principal: {
      kind: "employee",
      employee: { tenantId, kind: "employee", id: employeeId }
    },
    permissionId: "core:tenant.manage",
    resourceScopeId: "core:permission-scope.tenant",
    resource: {
      tenantId,
      entityTypeId: "core:tenant",
      entityId: tenantId
    },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: calculateInboxV2CanonicalSha256({
      tenantId,
      employeeId,
      permissionId: "core:tenant.manage",
      decidedAt,
      notAfter
    }),
    outcome: "allowed",
    decidedAt,
    notAfter
  });
  return {
    actor: {
      kind: "employee",
      employee: { tenantId, kind: "employee", id: employeeId },
      authorizationEpoch: epoch
    },
    snapshot,
    decisionRefs: [decision],
    expectedStreamEpoch: inboxV2StreamEpochSchema.parse(
      "stream:epoch:source-onboarding-test"
    )
  };
}

function commitStatus(
  input: Parameters<
    InboxV2AuthorizedCommandCoordinator["withAuthorizedCommandMutation"]
  >[0]
) {
  return {
    commandId: input.command.id,
    mutationId: input.records.mutationId,
    publicResultCode: input.command.publicResultCode,
    resultReference: input.command.resultReference,
    streamCommitId: input.records.streamCommitId,
    streamEpoch: input.records.expectedStreamEpoch,
    streamPosition: "1",
    committedAt: input.occurredAt
  };
}

async function fingerprintCredential(token: string) {
  const material = new TextEncoder().encode(token);
  try {
    return await credentialFingerprintProvider.fingerprint({
      tenantId,
      purpose: "core:source-onboarding.webhook-token",
      material
    });
  } finally {
    material.fill(0);
  }
}

function testIngressRouteMaterial(): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => index + 1);
}
