import type {
  InboxV2EmployeeId,
  InboxV2SourceExternalIdentityId,
  InboxV2SourceIdentityClaimId,
  InboxV2SourceIdentityClaimTransitionId,
  InboxV2TenantId
} from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("./sql-inbox-v2-authorization-repository", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("./sql-inbox-v2-authorization-repository")
    >();
  return {
    ...original,
    // Capability authenticity is covered by the repository's main unit suite.
    // This isolated test reaches the live-executor branch to prove retry
    // ownership without exporting a production bypass for the WeakSet guard.
    assertInboxV2AuthorizedCommandMutationContext: vi.fn()
  };
});

import {
  createSqlInboxV2SourceIdentityClaimRepository,
  type ApplyInboxV2SourceIdentityClaimTransitionInput,
  type InboxV2SourceIdentityClaimTransactionExecutor
} from "./sql-inbox-v2-source-identity-claim-repository";

const tenantId = "tenant:authorized-claim" as InboxV2TenantId;
const actorEmployeeId = "employee:operator-1" as InboxV2EmployeeId;
const targetEmployeeId = "employee:employee-2" as InboxV2EmployeeId;
const sourceExternalIdentityId =
  "source_external_identity:authorized-claim" as InboxV2SourceExternalIdentityId;
const authorizationDecisionId = "authorization-decision:authorized-claim";
const occurredAt = "2026-07-17T09:00:00.000Z";

describe("SQL Inbox V2 authorized source identity claim executor", () => {
  it.each(["40001", "40P01"] as const)(
    "leaves %s retry ownership to the authorization coordinator and preserves the original error",
    async (code) => {
      const originalError = Object.assign(new Error(`original ${code}`), {
        code
      });
      const abortedError = Object.assign(new Error("aborted transaction"), {
        code: "25P02"
      });
      const liveExecutor = {
        execute: vi
          .fn()
          .mockRejectedValueOnce(originalError)
          .mockRejectedValue(abortedError)
      };
      const outerExecutor: InboxV2SourceIdentityClaimTransactionExecutor = {
        execute: vi.fn(),
        transaction: vi.fn(async () => {
          throw new Error(
            "claim repository must not open a nested transaction"
          );
        })
      };
      const repository =
        createSqlInboxV2SourceIdentityClaimRepository(outerExecutor);

      await expect(
        repository.applyTransitionInAuthorizedContext(
          {
            executor: liveExecutor,
            tenantId,
            commandId: "command:authorized-claim",
            clientMutationId: "client-mutation:authorized-claim",
            commandTypeId: "core:identity.claim",
            actor: { kind: "employee", employeeId: actorEmployeeId },
            authorizationDecisionId,
            authorizedAt: occurredAt,
            occurredAt,
            mutationId: "mutation:authorized-claim",
            profile: "domain",
            revisionEffects: []
          } as never,
          claimInput(),
          { authorizationDecisionId, expectedActiveClaim: null }
        )
      ).rejects.toBe(originalError);

      expect(liveExecutor.execute).toHaveBeenCalledTimes(1);
      expect(outerExecutor.transaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      label: "active claim ID",
      expectedActiveClaim: {
        claimId:
          "source_identity_claim:substituted" as InboxV2SourceIdentityClaimId,
        target: {
          kind: "client_contact" as const,
          clientContactId: "client_contact:previous" as never
        }
      }
    },
    {
      label: "typed old target",
      expectedActiveClaim: {
        claimId:
          "source_identity_claim:previous" as InboxV2SourceIdentityClaimId,
        target: {
          kind: "employee" as const,
          employeeId: targetEmployeeId
        }
      }
    }
  ])(
    "rejects substituted $label under the identity-head lock",
    async (testCase) => {
      const liveExecutor = lockedClientClaimExecutor();
      const outerExecutor: InboxV2SourceIdentityClaimTransactionExecutor = {
        execute: vi.fn(),
        transaction: vi.fn(async () => {
          throw new Error(
            "claim repository must not open a nested transaction"
          );
        })
      };
      const repository =
        createSqlInboxV2SourceIdentityClaimRepository(outerExecutor);

      await expect(
        repository.applyTransitionInAuthorizedContext(
          authorizedContext(liveExecutor),
          claimInput({ expectedVersion: "1" as never }),
          {
            authorizationDecisionId,
            expectedActiveClaim: testCase.expectedActiveClaim
          }
        )
      ).resolves.toMatchObject({
        kind: "active_claim_conflict",
        currentVersion: "1",
        activeClaimId: "source_identity_claim:previous",
        activeTarget: {
          kind: "client_contact",
          clientContact: { id: "client_contact:previous" }
        }
      });
      expect(liveExecutor.execute).toHaveBeenCalledTimes(3);
      expect(outerExecutor.transaction).not.toHaveBeenCalled();
    }
  );

  it("rejects an unexpected active claim when the authorized state fence requires exact absence", async () => {
    const liveExecutor = lockedClientClaimExecutor();
    const outerExecutor: InboxV2SourceIdentityClaimTransactionExecutor = {
      execute: vi.fn(),
      transaction: vi.fn(async () => {
        throw new Error("claim repository must not open a nested transaction");
      })
    };
    const repository =
      createSqlInboxV2SourceIdentityClaimRepository(outerExecutor);

    await expect(
      repository.applyTransitionInAuthorizedContext(
        authorizedContext(liveExecutor),
        claimInput({ expectedVersion: "1" as never }),
        { authorizationDecisionId, expectedActiveClaim: null }
      )
    ).resolves.toMatchObject({
      kind: "active_claim_conflict",
      currentVersion: "1",
      activeClaimId: "source_identity_claim:previous"
    });
    expect(liveExecutor.execute).toHaveBeenCalledTimes(3);
    expect(outerExecutor.transaction).not.toHaveBeenCalled();
  });

  it("re-claims an exactly unclaimed identity at the next head version after revoke", async () => {
    const liveExecutor = revokedStateReclaimExecutor();
    const outerExecutor: InboxV2SourceIdentityClaimTransactionExecutor = {
      execute: vi.fn(),
      transaction: vi.fn(async () => {
        throw new Error("claim repository must not open a nested transaction");
      })
    };
    const repository =
      createSqlInboxV2SourceIdentityClaimRepository(outerExecutor);

    await expect(
      repository.applyTransitionInAuthorizedContext(
        authorizedContext(liveExecutor),
        claimInput({ expectedVersion: "1" as never }),
        { authorizationDecisionId, expectedActiveClaim: null }
      )
    ).resolves.toMatchObject({
      kind: "applied",
      transition: {
        operation: {
          kind: "claim_employee",
          previousClaim: null,
          resultingClaim: { id: "source_identity_claim:authorized-claim" }
        },
        expectedVersion: "1",
        resultingVersion: "2"
      }
    });
    expect(liveExecutor.execute).toHaveBeenCalledTimes(11);
    expect(outerExecutor.transaction).not.toHaveBeenCalled();
  });

  it("applies an exact ClientContact-to-Employee reassignment on the coordinator transaction", async () => {
    const liveExecutor = crossKindReassignmentExecutor();
    const outerExecutor: InboxV2SourceIdentityClaimTransactionExecutor = {
      execute: vi.fn(),
      transaction: vi.fn(async () => {
        throw new Error("claim repository must not open a nested transaction");
      })
    };
    const repository =
      createSqlInboxV2SourceIdentityClaimRepository(outerExecutor);

    await expect(
      repository.applyTransitionInAuthorizedContext(
        authorizedContext(liveExecutor),
        claimInput({ expectedVersion: "1" as never }),
        {
          authorizationDecisionId,
          expectedActiveClaim: {
            claimId:
              "source_identity_claim:previous" as InboxV2SourceIdentityClaimId,
            target: {
              kind: "client_contact",
              clientContactId: "client_contact:previous" as never
            }
          }
        }
      )
    ).resolves.toMatchObject({
      kind: "applied",
      transition: {
        operation: {
          kind: "claim_employee",
          previousClaim: {
            claim: { id: "source_identity_claim:previous" },
            target: {
              kind: "client_contact",
              clientContact: { id: "client_contact:previous" }
            }
          },
          resultingClaim: { id: "source_identity_claim:authorized-claim" }
        },
        resultingVersion: "2"
      }
    });
    expect(liveExecutor.execute).toHaveBeenCalledTimes(14);
    expect(outerExecutor.transaction).not.toHaveBeenCalled();
  });
});

function claimInput(
  overrides: Partial<ApplyInboxV2SourceIdentityClaimTransitionInput> = {}
): ApplyInboxV2SourceIdentityClaimTransitionInput {
  return {
    tenantId,
    sourceExternalIdentityId,
    transitionId:
      "source_identity_claim_transition:authorized-claim" as InboxV2SourceIdentityClaimTransitionId,
    expectedVersion: null,
    operation: {
      kind: "claim_employee",
      claimId:
        "source_identity_claim:authorized-claim" as InboxV2SourceIdentityClaimId,
      employeeId: targetEmployeeId,
      confidence: "verified",
      evidenceReferences: [
        {
          kind: "normalized_inbound_event",
          reference: {
            tenantId,
            kind: "normalized_inbound_event",
            id: "normalized_inbound_event:authorized-claim" as never
          }
        }
      ]
    },
    decision: {
      kind: "manual",
      actorEmployee: {
        tenantId,
        kind: "employee",
        id: actorEmployeeId
      },
      reviewState: "approved"
    },
    policyId: "core:authorized-claim" as never,
    policyVersion: "v1",
    reasonCodeId: "core:authorized-claim" as never,
    occurredAt,
    ...overrides
  };
}

function authorizedContext(executor: { execute: ReturnType<typeof vi.fn> }) {
  return {
    executor,
    tenantId,
    commandId: "command:authorized-claim",
    clientMutationId: "client-mutation:authorized-claim",
    commandTypeId: "core:identity.claim",
    actor: { kind: "employee", employeeId: actorEmployeeId },
    authorizationDecisionId,
    authorizedAt: occurredAt,
    occurredAt,
    mutationId: "mutation:authorized-claim",
    profile: "domain",
    revisionEffects: []
  } as never;
}

function lockedClientClaimExecutor() {
  return {
    execute: vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: sourceExternalIdentityId,
            scope_kind: "source_connection",
            scope_source_connection_id: "source_connection:authorized-claim",
            scope_source_account_id: null,
            revision: "2"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            resolution_status: "claimed",
            active_claim_id: "source_identity_claim:previous",
            latest_claim_version: "1"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "source_identity_claim:previous",
            source_external_identity_id: sourceExternalIdentityId,
            claim_version: "1",
            target_kind: "client_contact",
            target_employee_id: null,
            target_client_contact_id: "client_contact:previous",
            status: "active"
          }
        ]
      })
  };
}

function crossKindReassignmentExecutor() {
  const locked = lockedClientClaimExecutor();
  for (const result of [
    { rows: [] },
    { rows: [] },
    {
      rows: [
        { id: actorEmployeeId, deactivated_at: null },
        { id: targetEmployeeId, deactivated_at: null }
      ]
    },
    { rows: [{ id: "client_contact:previous" }] },
    {
      rows: [
        {
          id: "normalized_inbound_event:authorized-claim",
          source_connection_id: "source_connection:authorized-claim",
          source_account_id: null
        }
      ]
    },
    { rows: [{ id: "source_identity_claim:previous" }] },
    { rows: [{ id: "source_identity_claim:authorized-claim" }] },
    { rows: [{ id: "source_identity_claim:authorized-claim" }] },
    { rows: [{ id: "source_identity_claim_transition:authorized-claim" }] },
    { rows: [{ id: sourceExternalIdentityId }] },
    { rows: [{ id: sourceExternalIdentityId }] }
  ]) {
    locked.execute.mockResolvedValueOnce(result);
  }
  return locked;
}

function revokedStateReclaimExecutor() {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          id: sourceExternalIdentityId,
          scope_kind: "source_connection",
          scope_source_connection_id: "source_connection:authorized-claim",
          scope_source_account_id: null,
          revision: "2"
        }
      ]
    })
    .mockResolvedValueOnce({
      rows: [
        {
          resolution_status: "unresolved",
          active_claim_id: null,
          latest_claim_version: "1"
        }
      ]
    });
  for (const result of [
    { rows: [] },
    { rows: [] },
    {
      rows: [
        { id: actorEmployeeId, deactivated_at: null },
        { id: targetEmployeeId, deactivated_at: null }
      ]
    },
    {
      rows: [
        {
          id: "normalized_inbound_event:authorized-claim",
          source_connection_id: "source_connection:authorized-claim",
          source_account_id: null
        }
      ]
    },
    { rows: [{ id: "source_identity_claim:authorized-claim" }] },
    { rows: [{ id: "source_identity_claim:authorized-claim" }] },
    { rows: [{ id: "source_identity_claim_transition:authorized-claim" }] },
    { rows: [{ id: sourceExternalIdentityId }] },
    { rows: [{ id: sourceExternalIdentityId }] }
  ]) {
    execute.mockResolvedValueOnce(result);
  }
  return { execute };
}
