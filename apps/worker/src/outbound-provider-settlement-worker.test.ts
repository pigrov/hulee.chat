import type { InboxV2OutboundProviderSettlementCommit } from "@hulee/contracts";
import type {
  InboxV2OutboundProviderSettlementWorkClaim,
  InboxV2OutboundProviderSettlementWorkFinalizeInput,
  InboxV2OutboundProviderSettlementWorkFinalizeResult,
  InboxV2OutboundProviderSettlementWorkRepository,
  InboxV2OutboundProviderSettlementPlanner
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2OutboundProviderSettlementAuthority,
  createInboxV2OutboundProviderSettlementWorkerCoordinator,
  type InboxV2OutboundProviderSettlementAuthorityPort
} from "./outbound-provider-settlement-worker";

describe("Inbox V2 outbound provider settlement worker", () => {
  it("runs claim -> exact plan -> authorized settle -> settled finalize", async () => {
    const work = workDouble([[claim(1)]]);
    const authority = authorityDouble();
    const planner = plannerDouble();
    const worker = createInboxV2OutboundProviderSettlementWorkerCoordinator({
      work,
      planner,
      settlementAuthority: authority
    });

    await expect(worker.processBatch(batch())).resolves.toEqual([
      {
        kind: "settled",
        observationId: claim(1).observationId,
        replay: false
      }
    ]);
    expect(planner.loadAndPlanExactCommit).toHaveBeenCalledOnce();
    expect(authority.authorizeExactCommit).toHaveBeenCalledWith({
      claim: claim(1),
      commit: exactCommit
    });
    expect(authority.executeAuthorizedExactCommit).toHaveBeenCalledWith({
      claim: claim(1),
      commit: exactCommit,
      authority: exactAuthority
    });
    expect(work.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: { kind: "settled" } })
    );
  });

  it("abandons a crash-before-settle lease and completes only after expiry reclaim", async () => {
    const firstClaim = claim(1);
    const reclaimed = claim(2);
    const work = workDouble([[firstClaim], [reclaimed]]);
    const loadAndPlanExactCommit = vi
      .fn<InboxV2OutboundProviderSettlementPlanner["loadAndPlanExactCommit"]>()
      .mockRejectedValueOnce(new Error("process crashed before settle"))
      .mockResolvedValueOnce({ kind: "planned", commit: exactCommit });
    const planner = { loadAndPlanExactCommit };
    const authority = authorityDouble();
    const worker = createInboxV2OutboundProviderSettlementWorkerCoordinator({
      work,
      planner,
      settlementAuthority: authority
    });

    await expect(worker.processBatch(batch())).resolves.toEqual([
      {
        kind: "lease_abandoned",
        observationId: firstClaim.observationId,
        stage: "load"
      }
    ]);
    expect(work.finalize).not.toHaveBeenCalled();

    await expect(worker.processBatch(batch())).resolves.toEqual([
      {
        kind: "settled",
        observationId: reclaimed.observationId,
        replay: false
      }
    ]);
    expect(reclaimed.leaseRevision).toBe("2");
    expect(reclaimed.leaseToken).not.toBe(firstClaim.leaseToken);
    expect(authority.executeAuthorizedExactCommit).toHaveBeenCalledOnce();
  });

  it("recovers crash-after-settle through already-settled load without a second settlement", async () => {
    const firstClaim = claim(1);
    const reclaimed = claim(2);
    const work = workDouble(
      [[firstClaim], [reclaimed]],
      vi
        .fn()
        .mockRejectedValueOnce(new Error("process crashed after settle"))
        .mockResolvedValueOnce({ kind: "committed" })
    );
    let durableSettlementExists = false;
    const loadAndPlanExactCommit = vi.fn(async () =>
      durableSettlementExists
        ? ({ kind: "already_settled" } as const)
        : ({ kind: "planned", commit: exactCommit } as const)
    );
    const executeAuthorizedExactCommit = vi.fn(async () => {
      durableSettlementExists = true;
      return { kind: "settled" } as const;
    });
    const authority = {
      authorizeExactCommit: vi.fn(async () => ({
        kind: "authorized" as const,
        authority: exactAuthority
      })),
      executeAuthorizedExactCommit
    };
    const worker = createInboxV2OutboundProviderSettlementWorkerCoordinator({
      work,
      planner: { loadAndPlanExactCommit },
      settlementAuthority: authority
    });

    await expect(worker.processBatch(batch())).resolves.toEqual([
      {
        kind: "lease_abandoned",
        observationId: firstClaim.observationId,
        stage: "finalize"
      }
    ]);
    await expect(worker.processBatch(batch())).resolves.toEqual([
      {
        kind: "settled",
        observationId: reclaimed.observationId,
        replay: true
      }
    ]);
    expect(executeAuthorizedExactCommit).toHaveBeenCalledOnce();
    expect(work.finalize).toHaveBeenCalledTimes(2);
  });

  it("classifies durable retry and dead decisions without provider I/O", async () => {
    const work = workDouble([[claim(1), claim(1, "other")]]);
    const loadAndPlanExactCommit = vi
      .fn<InboxV2OutboundProviderSettlementPlanner["loadAndPlanExactCommit"]>()
      .mockResolvedValueOnce({
        kind: "retry",
        availableAt: "2026-07-14T08:04:00.000Z",
        errorCode: "core:settlement-retry"
      })
      .mockResolvedValueOnce({
        kind: "dead",
        errorCode: "core:settlement-invalid"
      });
    const worker = createInboxV2OutboundProviderSettlementWorkerCoordinator({
      work,
      planner: { loadAndPlanExactCommit },
      settlementAuthority: authorityDouble()
    });

    await expect(worker.processBatch(batch())).resolves.toEqual([
      {
        kind: "retry_scheduled",
        observationId: claim(1).observationId
      },
      {
        kind: "dead",
        observationId: claim(1, "other").observationId
      }
    ]);
    expect(work.finalize).toHaveBeenCalledTimes(2);
    expect(work.finalize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        outcome: {
          kind: "retry",
          availableAt: "2026-07-14T08:04:00.000Z",
          errorCode: "core:settlement-retry"
        }
      })
    );
    expect(work.finalize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        outcome: { kind: "dead", errorCode: "core:settlement-invalid" }
      })
    );
  });

  it("treats finalization replay as success", async () => {
    const work = workDouble(
      [[claim(1)]],
      vi.fn(async () => ({ kind: "already_finalized" as const }))
    );
    const worker = createInboxV2OutboundProviderSettlementWorkerCoordinator({
      work,
      planner: plannerDouble(),
      settlementAuthority: authorityDouble()
    });

    await expect(worker.processBatch(batch())).resolves.toEqual([
      {
        kind: "settled",
        observationId: claim(1).observationId,
        replay: true
      }
    ]);
  });

  it("lets concurrent workers observe one exclusive claim", async () => {
    const batches = [[claim(1)]];
    const claimExclusive = vi.fn(async () => batches.shift() ?? []);
    const finalize = vi.fn(async () => ({ kind: "committed" as const }));
    const work = { claim: claimExclusive, finalize };
    const authority = authorityDouble();
    const planner = plannerDouble();
    const first = createInboxV2OutboundProviderSettlementWorkerCoordinator({
      work,
      planner,
      settlementAuthority: authority
    });
    const second = createInboxV2OutboundProviderSettlementWorkerCoordinator({
      work,
      planner,
      settlementAuthority: authority
    });

    const results = await Promise.all([
      first.processBatch(batch("core:settlement-worker-a")),
      second.processBatch(batch("core:settlement-worker-b"))
    ]);
    expect(results.flat()).toHaveLength(1);
    expect(authority.executeAuthorizedExactCommit).toHaveBeenCalledOnce();
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("fails closed when the lease was concurrently reclaimed", async () => {
    const work = workDouble(
      [[claim(1)]],
      vi.fn(async () => ({ kind: "conflict" as const }))
    );
    const worker = createInboxV2OutboundProviderSettlementWorkerCoordinator({
      work,
      planner: plannerDouble(),
      settlementAuthority: authorityDouble()
    });

    await expect(worker.processBatch(batch())).resolves.toEqual([
      {
        kind: "lease_conflict",
        observationId: claim(1).observationId
      }
    ]);
  });

  it("executes delayed durable provider truth with fresh Conversation authority at planner time", async () => {
    const service = {
      settle: vi.fn(async () => ({ kind: "applied" as const }))
    };
    const historicalAuthority = authorizedMutationAt(
      "2026-07-14T09:30:00.000Z"
    );
    const authority = createInboxV2OutboundProviderSettlementAuthority({
      authorizer: {
        authorizeExactCommit: vi.fn(async () => ({
          kind: "authorized" as const,
          authority: historicalAuthority
        }))
      },
      settlementService: service as never
    });
    const commit = {
      ...exactCommit,
      observation: {
        ...exactCommit.observation,
        recordedAt: "2026-07-14T08:00:00.000Z"
      },
      settledAt: "2026-07-14T09:30:00.000Z"
    } as InboxV2OutboundProviderSettlementCommit;
    const authorization = await authority.authorizeExactCommit({
      claim: claim(1),
      commit
    });
    if (authorization.kind !== "authorized") {
      throw new Error("Expected historical provider-truth authority.");
    }

    await expect(
      authority.executeAuthorizedExactCommit({
        claim: claim(1),
        commit,
        authority: authorization.authority
      })
    ).resolves.toEqual({ kind: "settled" });
    expect(Date.parse(commit.settledAt)).toBeGreaterThan(
      Date.parse(commit.observation.recordedAt)
    );
    expect(service.settle).toHaveBeenCalledWith({
      authorizedMutation: historicalAuthority,
      workLease: claim(1),
      commit
    });
  });
});

const exactCommit = {
  tenantId: "tenant:outbound-unit",
  observation: {
    id: "outbound_provider_observation:settlement-work",
    recordedAt: "2026-07-14T08:00:00.000Z"
  },
  messageTransportAssociation: {
    message: {
      conversation: { id: "conversation:settlement-work" }
    },
    link: { id: "message_transport_occurrence_link:settlement-work" }
  },
  settledByTrustedServiceId: "core:source-runtime",
  settledAt: "2026-07-14T09:30:00.000Z"
} as unknown as InboxV2OutboundProviderSettlementCommit;
const exactAuthority = Object.freeze({ kind: "authorized-settlement" });

function plannerDouble(): InboxV2OutboundProviderSettlementPlanner & {
  loadAndPlanExactCommit: ReturnType<typeof vi.fn>;
} {
  return {
    loadAndPlanExactCommit: vi.fn(async () => ({
      kind: "planned" as const,
      commit: exactCommit
    }))
  };
}

function authorityDouble(): InboxV2OutboundProviderSettlementAuthorityPort<object> & {
  authorizeExactCommit: ReturnType<typeof vi.fn>;
  executeAuthorizedExactCommit: ReturnType<typeof vi.fn>;
} {
  return {
    authorizeExactCommit: vi.fn(async () => ({
      kind: "authorized" as const,
      authority: exactAuthority
    })),
    executeAuthorizedExactCommit: vi.fn(async () => ({
      kind: "settled" as const
    }))
  };
}

function workDouble(
  batches: InboxV2OutboundProviderSettlementWorkClaim[][],
  finalizeImplementation: (
    input: InboxV2OutboundProviderSettlementWorkFinalizeInput
  ) => Promise<InboxV2OutboundProviderSettlementWorkFinalizeResult> = vi.fn(
    async () => ({ kind: "committed" as const })
  )
): InboxV2OutboundProviderSettlementWorkRepository & {
  claim: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
} {
  const claimNext = vi.fn(async () => batches.shift() ?? []);
  const finalize = vi.fn(
    async (input: InboxV2OutboundProviderSettlementWorkFinalizeInput) =>
      (await finalizeImplementation(
        input
      )) as InboxV2OutboundProviderSettlementWorkFinalizeResult
  );
  return { claim: claimNext, finalize };
}

function claim(
  leaseRevision: number,
  suffix = "settlement-work"
): InboxV2OutboundProviderSettlementWorkClaim {
  return {
    tenantId: "tenant:outbound-unit",
    observationId: `outbound_provider_observation:${suffix}`,
    candidateExternalMessageReferenceId: `external_message_reference:${suffix}`,
    candidateTransportLinkId: `message_transport_occurrence_link:${suffix}`,
    trustedServiceId: "core:source-runtime",
    workerId: "core:settlement-worker",
    leaseToken: `settlement-lease:${leaseRevision}-${"a".repeat(40)}`,
    leaseRevision: String(leaseRevision),
    attemptCount: String(leaseRevision),
    claimedAt: "2026-07-14T08:03:00.000Z",
    expiresAt: "2026-07-14T08:03:30.000Z",
    revision: String(leaseRevision + 1)
  };
}

function batch(workerId = "core:settlement-worker") {
  return {
    tenantId: "tenant:outbound-unit",
    workerId,
    limit: 8,
    leaseDurationMs: 30_000
  } as const;
}

function authorizedMutationAt(authorizedAt: string) {
  const decision = {
    id: "authorization-decision:settlement-work",
    permissionId: "core:message.receive_external",
    resourceScopeId: "core:conversation",
    resource: {
      tenantId: "tenant:outbound-unit",
      entityTypeId: "core:conversation",
      entityId: "conversation:settlement-work"
    },
    principal: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:source-runtime"
    },
    authorizationEpoch: "1",
    resourceAccessRevision: "7",
    outcome: "allowed" as const
  };
  return {
    command: {
      commandTypeId: "core:outbound-provider-observation.settle",
      actor: decision.principal,
      authorizationDecisionId: decision.id,
      authorizedAt
    },
    occurredAt: authorizedAt,
    revisions: {
      resources: [
        {
          resourceKind: "conversation" as const,
          resourceId: "conversation:settlement-work",
          expectedResourceAccessRevision: "7",
          advance: "none" as const
        }
      ]
    },
    records: {
      audit: { authorizationDecisionRefs: [decision] },
      outboxIntents: []
    }
  } as unknown as import("@hulee/db").WithInboxV2AuthorizedCommandMutationInput;
}
