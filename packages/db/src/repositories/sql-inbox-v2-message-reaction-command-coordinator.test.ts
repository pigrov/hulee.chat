import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  parseReaction: vi.fn((value: unknown) => value),
  createAuthorizedCoordinator: vi.fn(),
  withAuthorizedAtomicMaterialization: vi.fn(),
  persistRoute: vi.fn(),
  prepareReaction: vi.fn(),
  sealReaction: vi.fn()
}));

vi.mock("@hulee/contracts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@hulee/contracts")>();
  return {
    ...original,
    inboxV2MessageReactionCommitSchema: {
      ...original.inboxV2MessageReactionCommitSchema,
      parse: doubles.parseReaction
    }
  };
});

vi.mock("./sql-inbox-v2-authorization-repository", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("./sql-inbox-v2-authorization-repository")
    >();
  return {
    ...original,
    createSqlInboxV2AuthorizedCommandCoordinator:
      doubles.createAuthorizedCoordinator
  };
});

vi.mock(
  "./sql-inbox-v2-outbound-transport-repository",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("./sql-inbox-v2-outbound-transport-repository")
      >();
    return {
      ...original,
      persistInboxV2ReactionRouteInTransaction: doubles.persistRoute
    };
  }
);

vi.mock(
  "./sql-inbox-v2-timeline-message-repository",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("./sql-inbox-v2-timeline-message-repository")
      >();
    return {
      ...original,
      prepareInboxV2MessageReactionCommand: doubles.prepareReaction,
      sealInboxV2PreparedMessageReactionCommand: doubles.sealReaction
    };
  }
);

import { createSqlInboxV2MessageReactionAtomicCoordinator } from "./sql-inbox-v2-message-reaction-command-coordinator";
import { createSqlInboxV2TimelineMessageRepository } from "./sql-inbox-v2-timeline-message-repository";

describe("SQL Inbox V2 Message reaction atomic coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doubles.createAuthorizedCoordinator.mockReturnValue({
      withAuthorizedAtomicMaterialization:
        doubles.withAuthorizedAtomicMaterialization
    });
    doubles.persistRoute.mockResolvedValue({ kind: "committed", route: {} });
    doubles.prepareReaction.mockResolvedValue({
      kind: "ready",
      capability: Object.freeze({})
    });
    doubles.sealReaction.mockResolvedValue({
      kind: "applied",
      reaction: { id: "message_reaction:r-1", revision: "2" },
      transition: { id: "message_reaction_transition:t-1" },
      receipt: Object.freeze({})
    });
    installAtomicDriver();
  });

  it("seals an internal reaction without manufacturing a provider route", async () => {
    const commit = reactionCommit("internal_apply");
    await expect(
      createCoordinator().withAuthorizedMessageReactionMutation({
        authorizedMutation: {} as never,
        reactionCommit: commit as never
      })
    ).resolves.toMatchObject({
      kind: "applied",
      result: {
        reactionId: "message_reaction:r-1",
        reactionRevision: "2",
        transitionId: "message_reaction_transition:t-1"
      }
    });
    expect(doubles.persistRoute).not.toHaveBeenCalled();
    expect(doubles.prepareReaction).toHaveBeenCalledWith(expect.anything(), {
      commit
    });
    expect(doubles.sealReaction).toHaveBeenCalledOnce();
  });

  it("persists the exact external route before locking and sealing the reaction", async () => {
    const commit = reactionCommit("external_request");
    await createCoordinator().withAuthorizedMessageReactionMutation({
      authorizedMutation: {} as never,
      reactionCommit: commit as never
    });
    expect(doubles.persistRoute).toHaveBeenCalledWith(
      expect.anything(),
      commit
    );
    expect(doubles.persistRoute.mock.invocationCallOrder[0]).toBeLessThan(
      doubles.prepareReaction.mock.invocationCallOrder[0]!
    );
  });

  it("rolls back route drift without preparing, sealing or provider I/O", async () => {
    const providerIo = vi.fn();
    vi.stubGlobal("fetch", providerIo);
    doubles.persistRoute.mockResolvedValue({ kind: "binding_fence_conflict" });
    const rollbackObserved = vi.fn();
    installAtomicDriver(rollbackObserved);

    await expect(
      createCoordinator().withAuthorizedMessageReactionMutation({
        authorizedMutation: {} as never,
        reactionCommit: reactionCommit("external_request") as never
      })
    ).resolves.toEqual({
      kind: "revision_conflict",
      code: "revision.conflict",
      conflicts: []
    });
    expect(rollbackObserved).toHaveBeenCalledOnce();
    expect(doubles.prepareReaction).not.toHaveBeenCalled();
    expect(doubles.sealReaction).not.toHaveBeenCalled();
    expect(providerIo).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("maps stale slot/one-use-route preparation to a closed revision conflict", async () => {
    doubles.prepareReaction.mockResolvedValue({
      kind: "conflict",
      code: "message.transport_conflict"
    });
    const rollbackObserved = vi.fn();
    installAtomicDriver(rollbackObserved);
    await expect(
      createCoordinator().withAuthorizedMessageReactionMutation({
        authorizedMutation: {} as never,
        reactionCommit: reactionCommit("internal_apply") as never
      })
    ).resolves.toMatchObject({
      kind: "revision_conflict",
      code: "revision.conflict"
    });
    expect(rollbackObserved).toHaveBeenCalledOnce();
    expect(doubles.sealReaction).not.toHaveBeenCalled();
  });

  it.each(["provider_observed", "provider_result"] as const)(
    "rejects %s before opening the operator atomic seam",
    async (mode) => {
      await expect(
        createCoordinator().withAuthorizedMessageReactionMutation({
          authorizedMutation: {} as never,
          reactionCommit: reactionCommit(mode) as never
        })
      ).rejects.toThrow(/only internal apply or external request/iu);
      expect(
        doubles.withAuthorizedAtomicMaterialization
      ).not.toHaveBeenCalled();
    }
  );

  it.each(["internal_apply", "external_request"] as const)(
    "rejects %s at the public low-level repository seam before opening a transaction",
    async (mode) => {
      const transaction = vi.fn();
      const repository = createSqlInboxV2TimelineMessageRepository({
        execute: vi.fn(),
        transaction
      } as never);

      await expect(
        repository.applyReaction({
          commit: reactionCommit(mode) as never,
          streamPosition: "1" as never
        })
      ).rejects.toThrow(/authorized atomic reaction coordinator/iu);
      expect(transaction).not.toHaveBeenCalled();
    }
  );
});

function createCoordinator() {
  return createSqlInboxV2MessageReactionAtomicCoordinator({} as never);
}

function reactionCommit(
  mode:
    | "internal_apply"
    | "external_request"
    | "provider_observed"
    | "provider_result"
) {
  return {
    transition: { mode },
    afterReaction: { id: "message_reaction:r-1", revision: "2" }
  };
}

function installAtomicDriver(onRollback?: () => void): void {
  doubles.withAuthorizedAtomicMaterialization.mockImplementation(
    async (...args: unknown[]) => {
      const prepare = args[1] as (context: unknown) => Promise<unknown>;
      const seal = args[2] as (
        context: unknown,
        capability: unknown
      ) => Promise<{ result: unknown; receipt: unknown }>;
      try {
        const capability = await prepare({ executor: {} });
        const sealed = await seal({}, capability);
        return {
          kind: "applied",
          result: sealed.result,
          status: {},
          revisionEffects: []
        };
      } catch (error) {
        onRollback?.();
        throw error;
      }
    }
  );
}
