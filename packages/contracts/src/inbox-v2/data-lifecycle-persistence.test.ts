import { describe, expect, it } from "vitest";

import {
  calculateInboxV2DeletionRunMutableStateHash,
  compareAndSetInboxV2PolicyActivation,
  commitInboxV2DeletionStageOne,
  createInboxV2DeletionRun,
  defineInboxV2DeletionRunStateRepository,
  defineInboxV2PolicyActivationRepository,
  inboxV2CommitDeletionStageOneInputSchema,
  inboxV2CreateDeletionRunInputSchema,
  inboxV2DeletionRunStateTransitionInputSchema,
  inboxV2DeletionRunStateTransitionResultSchema,
  inboxV2PolicyActivationAuthoritySchema,
  inboxV2PolicyActivationCompareAndSetInputSchema,
  inboxV2PolicyActivationCompareAndSetResultSchema,
  inboxV2PolicyActivationRepositoryLoadResultSchema,
  isInboxV2PolicyActivationRepository,
  isInboxV2DeletionRunStateRepository,
  loadInboxV2CurrentPolicyActivation,
  transitionInboxV2DeletionRunState,
  type InboxV2CommitDeletionStageOneInput,
  type InboxV2DeletionRunStateRepository,
  type InboxV2PolicyActivationAuthority,
  type InboxV2PolicyActivationRepository
} from "./data-lifecycle-persistence";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const policyId = "core:tenant-lifecycle-policy";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const hashC = `sha256:${"c".repeat(64)}`;

function authority(
  version = "1",
  authorityTenantId = tenantId
): InboxV2PolicyActivationAuthority {
  return inboxV2PolicyActivationAuthoritySchema.parse({
    tenantId: authorityTenantId,
    registryCompositionHash: hashA,
    governance: {
      tenantId: authorityTenantId,
      id: "core:tenant-data-governance",
      version,
      contextHash: hashB
    },
    effectivePolicy: {
      tenantId: authorityTenantId,
      id: policyId,
      version,
      policyHash: hashC
    },
    activation: {
      tenantId: authorityTenantId,
      id: `core:tenant-policy-activation-${version}`,
      revision: version,
      activationHash: hashA
    }
  });
}

function durableTestRepository() {
  let current: InboxV2PolicyActivationAuthority | null = null;
  const repository = defineInboxV2PolicyActivationRepository({
    async loadCurrent() {
      return current === null
        ? { outcome: "not_found" as const }
        : { outcome: "found" as const, current };
    },
    async compareAndSetActivation(input) {
      if (current !== null && sameAuthority(current, input.candidate)) {
        return { outcome: "already_applied" as const, current };
      }
      if (!sameNullableAuthority(current, input.expectedCurrent)) {
        if (current === null) {
          return {
            outcome: "lineage_conflict" as const,
            current
          };
        }
        return { outcome: "current_conflict" as const, current };
      }
      current = input.candidate;
      return { outcome: "applied" as const, current };
    }
  });
  return repository;
}

describe("Inbox V2 durable policy activation repository port", () => {
  it("loads and CASes restart-safe authority through an authentic async adapter", async () => {
    const repository = durableTestRepository();
    const candidate = authority();
    const key = { tenantId, policyId };

    await expect(
      loadInboxV2CurrentPolicyActivation({ repository, key })
    ).resolves.toEqual({ outcome: "not_found" });
    await expect(
      compareAndSetInboxV2PolicyActivation({
        repository,
        mutation: { key, expectedCurrent: null, candidate }
      })
    ).resolves.toMatchObject({ outcome: "applied", current: candidate });
    await expect(
      compareAndSetInboxV2PolicyActivation({
        repository,
        mutation: { key, expectedCurrent: null, candidate }
      })
    ).resolves.toMatchObject({
      outcome: "already_applied",
      current: candidate
    });
    const loaded = await loadInboxV2CurrentPolicyActivation({
      repository,
      key
    });
    expect(loaded).toEqual({ outcome: "found", current: candidate });
    expect(Object.isFrozen(loaded)).toBe(true);
  });

  it("rejects endpoint lookalikes and invalid repository capabilities", async () => {
    const repository = durableTestRepository();
    expect(isInboxV2PolicyActivationRepository(repository)).toBe(true);
    expect(isInboxV2PolicyActivationRepository({ ...repository })).toBe(false);
    expect(() =>
      defineInboxV2PolicyActivationRepository({
        loadCurrent: null,
        compareAndSetActivation: null
      } as unknown as InboxV2PolicyActivationRepository)
    ).toThrow(/repository is invalid/u);
    await expect(
      loadInboxV2CurrentPolicyActivation({
        repository: { ...repository },
        key: { tenantId, policyId }
      })
    ).rejects.toThrow(/registered durable repository/u);
  });

  it("rejects cross-tenant CAS lineage and mismatched adapter results", async () => {
    expect(() =>
      inboxV2PolicyActivationCompareAndSetInputSchema.parse({
        key: { tenantId, policyId },
        expectedCurrent: null,
        candidate: authority("1", otherTenantId)
      })
    ).toThrow(/CAS key must match/u);

    const repository = defineInboxV2PolicyActivationRepository({
      async loadCurrent() {
        return { outcome: "found", current: authority("1", otherTenantId) };
      },
      async compareAndSetActivation() {
        return { outcome: "applied", current: authority("2") };
      }
    });
    await expect(
      loadInboxV2CurrentPolicyActivation({
        repository,
        key: { tenantId, policyId }
      })
    ).rejects.toThrow(/different tenant or policy/u);
    await expect(
      compareAndSetInboxV2PolicyActivation({
        repository,
        mutation: {
          key: { tenantId, policyId },
          expectedCurrent: null,
          candidate: authority("1")
        }
      })
    ).rejects.toThrow(/exact candidate authority/u);
  });

  it("keeps all persisted DTOs closed and exposes the required CAS outcomes", () => {
    for (const outcome of [
      { outcome: "applied", current: authority() },
      { outcome: "already_applied", current: authority() },
      { outcome: "current_conflict", current: authority() },
      { outcome: "lineage_conflict", current: null },
      { outcome: "not_found", missingAuthority: "activation" }
    ]) {
      expect(
        inboxV2PolicyActivationCompareAndSetResultSchema.safeParse(outcome)
          .success
      ).toBe(true);
    }
    assertInboxV2ClosedJsonSchema(inboxV2PolicyActivationAuthoritySchema);
    assertInboxV2ClosedJsonSchema(
      inboxV2PolicyActivationCompareAndSetInputSchema
    );
    assertInboxV2ClosedJsonSchema(
      inboxV2PolicyActivationRepositoryLoadResultSchema
    );
    assertInboxV2ClosedJsonSchema(
      inboxV2PolicyActivationCompareAndSetResultSchema
    );
  });
});

describe("Inbox V2 deletion-run state persistence port", () => {
  it("registers a durable provider-neutral CAS and stage-one commit adapter", async () => {
    const repository = defineInboxV2DeletionRunStateRepository({
      async createRun() {
        return inboxV2DeletionRunStateTransitionResultSchema.parse({
          outcome: "applied",
          stateRevision: "1"
        });
      },
      async transition(input) {
        return inboxV2DeletionRunStateTransitionResultSchema.parse({
          outcome: "applied",
          stateRevision: (BigInt(input.expectedStateRevision) + 1n).toString()
        });
      },
      async commitStageOne(input) {
        return inboxV2DeletionRunStateTransitionResultSchema.parse({
          outcome: "applied",
          stateRevision: (BigInt(input.expectedStateRevision) + 1n).toString()
        });
      }
    });
    const mutation = stageOneMutation();
    expect(isInboxV2DeletionRunStateRepository(repository)).toBe(true);
    await expect(
      createInboxV2DeletionRun({
        repository,
        mutation: createRunMutation()
      })
    ).resolves.toEqual({ outcome: "applied", stateRevision: "1" });
    await expect(
      commitInboxV2DeletionStageOne({ repository, mutation })
    ).resolves.toEqual({ outcome: "applied", stateRevision: "2" });
    const { targets: _targets, ...transitionMutation } = mutation;
    const { stateHash: _stateHash, ...currentState } = mutation.next;
    const transitionedState = {
      ...currentState,
      state: "verification_pending" as const,
      updatedAt: "2026-07-15T05:00:02.000Z"
    };
    await expect(
      transitionInboxV2DeletionRunState({
        repository,
        mutation: {
          ...transitionMutation,
          expectedStateRevision: "2",
          expectedStageOneState: "content_unavailable",
          next: {
            ...transitionedState,
            stateHash:
              calculateInboxV2DeletionRunMutableStateHash(transitionedState)
          }
        }
      })
    ).resolves.toEqual({ outcome: "applied", stateRevision: "3" });
  });

  it("keeps stage-one DTOs closed, tenant-safe, canonical, and revision advancing", () => {
    const mutation = stageOneMutation();
    expect(
      inboxV2CommitDeletionStageOneInputSchema.safeParse(mutation).success
    ).toBe(true);
    expect(
      inboxV2CommitDeletionStageOneInputSchema.safeParse({
        ...mutation,
        targets: [
          {
            ...mutation.targets[0]!,
            entity: {
              ...mutation.targets[0]!.entity,
              tenantId: otherTenantId
            }
          }
        ]
      }).success
    ).toBe(false);
    const { stateHash: _pendingHash, ...mutableState } = mutation.next;
    const lyingPendingState = {
      ...mutableState,
      stageOneState: "pending" as const,
      stageOneCommittedAt: null,
      completedCheckpointCount: "1"
    };
    const { targets: _pendingTargets, ...pendingTransition } = mutation;
    expect(
      inboxV2DeletionRunStateTransitionInputSchema.safeParse({
        ...pendingTransition,
        next: {
          ...lyingPendingState,
          stateHash:
            calculateInboxV2DeletionRunMutableStateHash(lyingPendingState)
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2CommitDeletionStageOneInputSchema.safeParse({
        ...mutation,
        next: {
          ...mutation.next,
          canonicalSnapshot: { rawContent: "must-not-persist" }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2CommitDeletionStageOneInputSchema.safeParse({
        ...mutation,
        targets: [mutation.targets[0]!, mutation.targets[0]!]
      }).success
    ).toBe(false);
    const { stateHash: _lyingStageOneHash, ...stageOneState } = mutation.next;
    const lyingStageOneState = {
      ...stageOneState,
      completedCheckpointCount: "1"
    };
    expect(
      inboxV2CommitDeletionStageOneInputSchema.safeParse({
        ...mutation,
        next: {
          ...lyingStageOneState,
          stateHash:
            calculateInboxV2DeletionRunMutableStateHash(lyingStageOneState)
        }
      }).success
    ).toBe(false);
    const futureProofTime = "2026-07-15T05:00:02.000Z";
    const { stateHash: _futureHash, ...futureState } = mutation.next;
    const futureCommittedState = {
      ...futureState,
      stageOneCommittedAt: futureProofTime
    };
    expect(
      inboxV2CommitDeletionStageOneInputSchema.safeParse({
        ...mutation,
        next: {
          ...futureCommittedState,
          stateHash:
            calculateInboxV2DeletionRunMutableStateHash(futureCommittedState)
        },
        targets: [{ ...mutation.targets[0]!, committedAt: futureProofTime }]
      }).success
    ).toBe(false);
    assertInboxV2ClosedJsonSchema(inboxV2DeletionRunStateTransitionInputSchema);
    assertInboxV2ClosedJsonSchema(inboxV2CommitDeletionStageOneInputSchema);
    assertInboxV2ClosedJsonSchema(
      inboxV2DeletionRunStateTransitionResultSchema
    );
  });

  it("rejects lookalike adapters and wrong successful CAS revisions", async () => {
    const mutation = stageOneMutation();
    const repository = defineInboxV2DeletionRunStateRepository({
      async createRun() {
        return inboxV2DeletionRunStateTransitionResultSchema.parse({
          outcome: "applied",
          stateRevision: "9"
        });
      },
      async transition() {
        return inboxV2DeletionRunStateTransitionResultSchema.parse({
          outcome: "applied",
          stateRevision: "9"
        });
      },
      async commitStageOne() {
        return inboxV2DeletionRunStateTransitionResultSchema.parse({
          outcome: "applied",
          stateRevision: "9"
        });
      }
    });
    await expect(
      createInboxV2DeletionRun({
        repository,
        mutation: createRunMutation()
      })
    ).rejects.toThrow(/wrong initial state revision/u);
    await expect(
      commitInboxV2DeletionStageOne({ repository, mutation })
    ).rejects.toThrow(/wrong state revision/u);
    await expect(
      commitInboxV2DeletionStageOne({
        repository: { ...repository },
        mutation
      })
    ).rejects.toThrow(/registered durable repository/u);
    expect(() =>
      defineInboxV2DeletionRunStateRepository({
        createRun: null,
        transition: null,
        commitStageOne: null
      } as unknown as InboxV2DeletionRunStateRepository)
    ).toThrow(/repository is invalid/u);
  });

  it("keeps deletion-run creation tenant-safe and tied to an exact plan revision", () => {
    const mutation = createRunMutation();
    expect(
      inboxV2CreateDeletionRunInputSchema.safeParse(mutation).success
    ).toBe(true);
    expect(
      inboxV2CreateDeletionRunInputSchema.safeParse({
        ...mutation,
        plan: { ...mutation.plan, tenantId: otherTenantId }
      }).success
    ).toBe(false);
    expect(
      inboxV2CreateDeletionRunInputSchema.safeParse({
        ...mutation,
        terminalExport: {
          ...terminalExportMutation(),
          tenantId: otherTenantId
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2CreateDeletionRunInputSchema.safeParse({
        tenantId: mutation.tenantId,
        runId: mutation.runId,
        revision: mutation.revision,
        plan: mutation.plan,
        startedAt: mutation.startedAt
      }).success
    ).toBe(false);
    expect(
      inboxV2CreateDeletionRunInputSchema.safeParse({
        ...mutation,
        arbitrarySnapshot: { rawContent: "must-not-persist" }
      }).success
    ).toBe(false);
    assertInboxV2ClosedJsonSchema(inboxV2CreateDeletionRunInputSchema);
  });
});

function createRunMutation() {
  return inboxV2CreateDeletionRunInputSchema.parse({
    tenantId,
    runId: "deletion-run:one",
    revision: "1",
    plan: {
      tenantId,
      planId: "deletion-plan:one",
      revision: "1",
      planHash: hashA
    },
    terminalExport: null,
    startedAt: "2026-07-15T04:59:59.000Z"
  });
}

function terminalExportMutation() {
  return {
    tenantId,
    productKind: "tenant_deployment" as const,
    job: { id: "export-job:terminal-one", revision: "1" },
    manifest: {
      id: "export-manifest:terminal-one",
      revision: "1",
      manifestHash: hashA
    },
    artifact: {
      id: "export-artifact:terminal-one",
      revision: "1",
      checksum: hashB,
      readyAt: "2026-07-15T04:58:00.000Z",
      expiresAt: "2026-07-15T06:00:00.000Z"
    },
    governanceContext: {
      tenantId,
      id: "core:governance-terminal-one",
      version: "1",
      contextHash: hashA
    },
    policy: {
      tenantId,
      id: "core:policy-terminal-one",
      version: "1",
      policyHash: hashB
    },
    rootSetHash: hashA,
    tenantScopeProofHash: hashB
  };
}

function stageOneMutation(): InboxV2CommitDeletionStageOneInput {
  const next = {
    state: "executing" as const,
    result: null,
    stageOneState: "content_unavailable" as const,
    stageOneCommittedAt: "2026-07-15T05:00:00.000Z",
    primaryAbsenceVerified: false,
    hasInternalResidual: false,
    hasExternalResidual: false,
    hasBackupExpiryPending: false,
    backupLatestPossibleExpiryAt: null,
    completedCheckpointCount: "0",
    completedAt: null,
    updatedAt: "2026-07-15T05:00:01.000Z"
  };
  return inboxV2CommitDeletionStageOneInputSchema.parse({
    tenantId,
    runId: "deletion-run:one",
    revision: "1",
    expectedState: "executing",
    expectedStageOneState: "pending",
    expectedStateRevision: "1",
    next: {
      ...next,
      stateHash: calculateInboxV2DeletionRunMutableStateHash(next)
    },
    targets: [
      {
        checkpointId: "checkpoint:one",
        requirementHash: hashA,
        root: {
          tenantId,
          dataClassId: "core:message-content",
          storageRootId: "core:postgres-primary",
          recordId: "data_root:record-one"
        },
        entity: {
          tenantId,
          entityTypeId: "core:message",
          entityId: "message:one"
        },
        expectedRevision: "1",
        resultingRevision: "2",
        tombstoneManifest: {
          tenantId,
          recordId: "tombstone:one",
          schemaId: "core:deletion-tombstone",
          schemaVersion: "v1",
          digest: hashB
        },
        invalidationDigest: hashC,
        committedAt: "2026-07-15T05:00:00.000Z"
      }
    ]
  });
}

function sameNullableAuthority(
  left: InboxV2PolicyActivationAuthority | null,
  right: InboxV2PolicyActivationAuthority | null
): boolean {
  return left === null || right === null
    ? left === right
    : sameAuthority(left, right);
}

function sameAuthority(
  left: InboxV2PolicyActivationAuthority,
  right: InboxV2PolicyActivationAuthority
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
