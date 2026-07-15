import { describe, expect, it } from "vitest";

import {
  calculateInboxV2DestructiveCheckpointExecutionFenceHash,
  claimInboxV2DestructiveCheckpoint,
  defineInboxV2DestructiveCheckpointGuardRepository,
  inboxV2ClaimDestructiveCheckpointInputSchema,
  isInboxV2DestructiveCheckpointGuardRepository
} from "./destructive-checkpoint-guard";
import { inboxV2PolicyActivationAuthoritySchema } from "./data-lifecycle-persistence";
import { inboxV2TenantIdSchema } from "./ids";
import { inboxV2DeletionExecutionFenceSchema } from "./privacy-deletion";
import { inboxV2Sha256DigestSchema } from "./sync-primitives";

const tenantId = inboxV2TenantIdSchema.parse("tenant:tenant-1");
const hashA = inboxV2Sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
const hashB = inboxV2Sha256DigestSchema.parse(`sha256:${"b".repeat(64)}`);
const hashC = inboxV2Sha256DigestSchema.parse(`sha256:${"c".repeat(64)}`);

const authority = inboxV2PolicyActivationAuthoritySchema.parse({
  tenantId,
  registryCompositionHash: hashA,
  governance: {
    tenantId,
    id: "core:governance-context.lifecycle",
    version: "3",
    contextHash: hashB
  },
  effectivePolicy: {
    tenantId,
    id: "core:lifecycle-policy.default",
    version: "8",
    policyHash: hashC
  },
  activation: {
    tenantId,
    id: "core:lifecycle-policy-activation.default",
    revision: "2",
    activationHash: hashA
  }
});

function validClaim() {
  return {
    tenantId,
    plan: {
      tenantId,
      planId: "privacy-deletion-plan:plan-1",
      revision: "4",
      planHash: hashB
    },
    run: {
      tenantId,
      runId: "privacy-deletion-run:run-1",
      revision: "7"
    },
    checkpoint: {
      checkpointId: "privacy-deletion-checkpoint:checkpoint-1",
      requirementHash: hashC,
      surface: "external" as const,
      registry: {
        id: "core:data-lifecycle-registry",
        revision: "5",
        compositionHash: hashA
      },
      root: {
        tenantId,
        dataClassId: "core:provider-message.content",
        storageRootId: "core:provider-message-route",
        recordId: "data_root:provider-message-one"
      },
      entity: {
        tenantId,
        entityTypeId: "core:provider-message",
        entityId: "provider-message:one"
      },
      observedEntityRevision: "11",
      observedLineageRevision: "6",
      rootKind: "external_route" as const,
      boundary: "outside_operated_data_plane" as const,
      copyRole: "external" as const,
      handlers: {
        externalDeleteHandlerId: "core:provider-message.delete-external"
      }
    },
    expectedAuthority: authority,
    expectedControlSet: {
      legalHoldSetRevision: "9",
      restrictionSetRevision: "12"
    },
    executionAuthorization: {
      tenantId,
      id: "authorization-decision:deletion-1",
      authorizationEpoch: "authorization-epoch-1",
      principal: {
        kind: "trusted_service" as const,
        trustedServiceId: "core:privacy-worker"
      },
      permissionId: "core:privacy.deletion.execute",
      resourceScopeId: "core:privacy-deletion-plan",
      resource: {
        tenantId,
        entityTypeId: "core:privacy-deletion-plan",
        entityId: "privacy-deletion-plan:plan-1"
      },
      resourceAccessRevision: "4",
      decisionRevision: "3",
      decisionHash: hashA,
      outcome: "allowed" as const,
      decidedAt: "2026-07-15T09:55:00.000Z",
      notAfter: "2026-07-15T10:05:00.000Z"
    },
    leaseToken: `lease-token-${"x".repeat(48)}`,
    leaseDurationSeconds: 60
  };
}

describe("Inbox V2 destructive checkpoint guard contracts", () => {
  it("binds tenant, exact plan authority and surface-specific handler set", () => {
    expect(
      inboxV2ClaimDestructiveCheckpointInputSchema.parse(validClaim())
    ).toMatchObject({
      tenantId,
      checkpoint: {
        surface: "external",
        handlers: {
          externalDeleteHandlerId: "core:provider-message.delete-external"
        }
      }
    });

    expect(() =>
      inboxV2ClaimDestructiveCheckpointInputSchema.parse({
        ...validClaim(),
        executionAuthorization: {
          ...validClaim().executionAuthorization,
          resourceAccessRevision: "5"
        }
      })
    ).toThrow(/exact deletion plan revision/u);
  });

  it("rejects cross-tenant observed targets before repository I/O", () => {
    const otherTenant = inboxV2TenantIdSchema.parse("tenant:tenant-2");
    expect(() =>
      inboxV2ClaimDestructiveCheckpointInputSchema.parse({
        ...validClaim(),
        checkpoint: {
          ...validClaim().checkpoint,
          entity: { ...validClaim().checkpoint.entity, tenantId: otherTenant }
        }
      })
    ).toThrow(/tenant/u);
  });

  it("derives a deterministic opaque fence digest without persisting the token", () => {
    const token = validClaim().leaseToken;
    expect(
      calculateInboxV2DestructiveCheckpointExecutionFenceHash(token)
    ).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(calculateInboxV2DestructiveCheckpointExecutionFenceHash(token)).toBe(
      calculateInboxV2DestructiveCheckpointExecutionFenceHash(token)
    );
    expect(
      calculateInboxV2DestructiveCheckpointExecutionFenceHash(
        `lease-token-${"y".repeat(48)}`
      )
    ).not.toBe(calculateInboxV2DestructiveCheckpointExecutionFenceHash(token));
  });

  it("accepts only registered durable repositories and freezes typed outcomes", async () => {
    const repository = defineInboxV2DestructiveCheckpointGuardRepository({
      async claim() {
        return { outcome: "checkpoint_conflict", facet: "handler_set" };
      }
    });
    expect(isInboxV2DestructiveCheckpointGuardRepository(repository)).toBe(
      true
    );
    const result = await claimInboxV2DestructiveCheckpoint({
      repository,
      claim: validClaim()
    });
    expect(result).toEqual({
      outcome: "checkpoint_conflict",
      facet: "handler_set"
    });
    expect(Object.isFrozen(result)).toBe(true);

    await expect(
      claimInboxV2DestructiveCheckpoint({
        repository: {
          async claim() {
            return { outcome: "checkpoint_conflict", facet: "handler_set" };
          }
        },
        claim: validClaim()
      })
    ).rejects.toThrow(/registered durable guard repository/u);
  });

  it("rejects a durable adapter response whose lease outlives its authorization", async () => {
    const claim =
      inboxV2ClaimDestructiveCheckpointInputSchema.parse(validClaim());
    if (claim.checkpoint.surface !== "external") {
      throw new Error("The contract fixture must use an external checkpoint.");
    }
    const executionHandlerId =
      claim.checkpoint.handlers.externalDeleteHandlerId;
    const checkedAt = "2026-07-15T10:00:00.000Z";
    const fence = inboxV2DeletionExecutionFenceSchema.parse({
      tenantId,
      plan: claim.plan,
      governance: authority.governance,
      policy: authority.effectivePolicy,
      executionAuthorization: claim.executionAuthorization,
      revision: {
        kind: "matched",
        expectedRevision: claim.checkpoint.observedEntityRevision,
        observedRevision: claim.checkpoint.observedEntityRevision
      },
      lineage: {
        kind: "matched",
        expectedRevision: claim.checkpoint.observedLineageRevision,
        observedRevision: claim.checkpoint.observedLineageRevision
      },
      hold: { kind: "clear" },
      restriction: {
        tenantId,
        restrictions: [],
        evaluatedAt: checkedAt,
        decisionHash: hashB,
        restrictionExtendedRetention: false
      },
      checkedAt
    });
    const repository = defineInboxV2DestructiveCheckpointGuardRepository({
      async claim() {
        return {
          outcome: "granted",
          lease: {
            tenantId,
            plan: claim.plan,
            run: claim.run,
            checkpoint: claim.checkpoint,
            authority,
            controlSet: claim.expectedControlSet,
            claimRevision: claim.run.revision,
            state: "claimed",
            leaseToken: claim.leaseToken,
            executionFenceHash:
              calculateInboxV2DestructiveCheckpointExecutionFenceHash(
                claim.leaseToken
              ),
            executionHandlerId,
            fence,
            claimedAt: checkedAt,
            leaseExpiresAt: "2026-07-15T10:06:00.000Z"
          }
        };
      }
    });

    await expect(
      claimInboxV2DestructiveCheckpoint({ repository, claim })
    ).rejects.toThrow(/authorization intervals/u);
  });
});
