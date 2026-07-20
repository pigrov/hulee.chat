import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  createAuthorizedCoordinator: vi.fn(),
  withAuthorizedAtomicMaterialization: vi.fn(),
  prepareLifecycle: vi.fn(),
  sealLifecycle: vi.fn()
}));

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
  "./sql-inbox-v2-timeline-message-repository",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("./sql-inbox-v2-timeline-message-repository")
      >();
    return {
      ...original,
      prepareInboxV2MessageLifecycleCommand: doubles.prepareLifecycle,
      sealInboxV2PreparedMessageLifecycleCommand: doubles.sealLifecycle
    };
  }
);

import {
  createSqlInboxV2MessageLifecycleAtomicCoordinator,
  type InboxV2MessageLifecycleAtomicCoordinator
} from "./sql-inbox-v2-message-lifecycle-command-coordinator";

type ApiMessageLifecycleAtomicCoordinator =
  import("../../../../apps/api/src/inbox-v2-message-lifecycle-command").InboxV2MessageLifecycleAtomicCoordinator;

const dbCoordinatorSatisfiesApiSeam: InboxV2MessageLifecycleAtomicCoordinator extends ApiMessageLifecycleAtomicCoordinator
  ? true
  : false = true;
const apiSeamSatisfiesDbCoordinator: ApiMessageLifecycleAtomicCoordinator extends InboxV2MessageLifecycleAtomicCoordinator
  ? true
  : false = true;
void dbCoordinatorSatisfiesApiSeam;
void apiSeamSatisfiesDbCoordinator;

describe("SQL Inbox V2 Message lifecycle command coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doubles.createAuthorizedCoordinator.mockReturnValue({
      withAuthorizedAtomicMaterialization:
        doubles.withAuthorizedAtomicMaterialization
    });
    installAtomicDriver();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      label: "internal edit",
      mutationKind: "edited" as const,
      sealedKind: "edit" as const
    },
    {
      label: "local delete",
      mutationKind: "local_delete_tombstone" as const,
      sealedKind: "local_delete" as const
    }
  ])("maps $label through the authorized two-phase seam", async (testCase) => {
    const mutation = messageMutation(testCase.mutationKind, null);
    doubles.prepareLifecycle.mockResolvedValue({
      kind: "ready",
      capability: capability()
    });
    doubles.sealLifecycle.mockResolvedValue(sealed(testCase.sealedKind, "2"));
    const coordinator = createCoordinator();

    await expect(
      coordinator.withAuthorizedMessageLifecycleMutation({
        authorizedMutation: authorizedMutation(),
        messageMutation: mutation,
        providerOperationCreation: null,
        legalHoldFence:
          testCase.mutationKind === "local_delete_tombstone"
            ? legalHoldFence()
            : null,
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      })
    ).resolves.toMatchObject({
      kind: "applied",
      result: {
        messageId: "message:lifecycle-1",
        messageRevision: "2",
        providerOperationId: null
      }
    });

    const preparedInput = doubles.prepareLifecycle.mock.calls[0]?.[1];
    expect(preparedInput).toMatchObject({
      kind: "message_mutation",
      tenantId: "tenant:lifecycle",
      conversationId: "conversation:lifecycle-1",
      messageId: "message:lifecycle-1"
    });
    expect(preparedInput.plan()).toBe(mutation);
    expect(doubles.sealLifecycle).toHaveBeenCalledOnce();
  });

  it("keeps external edit operation identity beside the Message result", async () => {
    const creation = providerCreation("edit", "provider-operation:edit-1");
    const mutation = messageMutation("edited", creation);
    doubles.prepareLifecycle.mockResolvedValue({
      kind: "ready",
      capability: capability()
    });
    doubles.sealLifecycle.mockResolvedValue(sealed("edit", "2"));
    const coordinator = createCoordinator();

    await expect(
      coordinator.withAuthorizedMessageLifecycleMutation({
        authorizedMutation: authorizedMutation(),
        messageMutation: mutation,
        providerOperationCreation: creation,
        legalHoldFence: null,
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      })
    ).resolves.toMatchObject({
      kind: "applied",
      result: {
        messageId: "message:lifecycle-1",
        messageRevision: "2",
        providerOperationId: "provider-operation:edit-1"
      }
    });
    expect(doubles.prepareLifecycle.mock.calls[0]?.[1].kind).toBe(
      "message_mutation"
    );
  });

  it("prepares provider delete without manufacturing a Message revision", async () => {
    const creation = providerCreation("delete", "provider-operation:delete-1");
    doubles.prepareLifecycle.mockResolvedValue({
      kind: "ready",
      capability: capability()
    });
    doubles.sealLifecycle.mockResolvedValue(sealed("provider_delete", "1"));
    const coordinator = createCoordinator();

    await expect(
      coordinator.withAuthorizedMessageLifecycleMutation({
        authorizedMutation: authorizedMutation(),
        messageMutation: null,
        providerOperationCreation: creation,
        legalHoldFence: legalHoldFence(),
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      })
    ).resolves.toMatchObject({
      kind: "applied",
      result: {
        messageId: "message:lifecycle-1",
        messageRevision: null,
        providerOperationId: "provider-operation:delete-1"
      }
    });
    expect(doubles.prepareLifecycle.mock.calls[0]?.[1]).toEqual({
      kind: "provider_lifecycle",
      commit: creation
    });
  });

  it.each([
    {
      label: "missing Message",
      prepared: { kind: "message_not_found" as const },
      expected: { kind: "resource_not_found" as const }
    },
    {
      label: "stale Message",
      prepared: {
        kind: "conflict" as const,
        code: "revision.conflict" as const,
        current: {}
      },
      expected: {
        kind: "revision_conflict" as const,
        code: "revision.conflict" as const,
        conflicts: []
      }
    }
  ])("rolls back and maps $label preparation", async (testCase) => {
    const rollbackObserved = vi.fn();
    installAtomicDriver(rollbackObserved);
    doubles.prepareLifecycle.mockResolvedValue(testCase.prepared);
    const coordinator = createCoordinator();

    await expect(
      coordinator.withAuthorizedMessageLifecycleMutation({
        authorizedMutation: authorizedMutation(),
        messageMutation: messageMutation("edited", null),
        providerOperationCreation: null,
        legalHoldFence: null,
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      })
    ).resolves.toEqual(testCase.expected);
    expect(rollbackObserved).toHaveBeenCalledOnce();
    expect(doubles.sealLifecycle).not.toHaveBeenCalled();
  });

  it("passes committed replay through without preparing or sealing again", async () => {
    doubles.withAuthorizedAtomicMaterialization.mockResolvedValue({
      kind: "already_applied",
      status: {
        commandId: "command:lifecycle-1",
        mutationId: "mutation:lifecycle-1",
        publicResultCode: "core:message.edited",
        resultReference: null,
        streamCommitId: "commit:lifecycle-1",
        streamEpoch: "stream:lifecycle-1",
        streamPosition: "7",
        committedAt: "2026-07-19T09:00:00.000Z"
      }
    });
    const coordinator = createCoordinator();

    await expect(
      coordinator.withAuthorizedMessageLifecycleMutation({
        authorizedMutation: authorizedMutation(),
        messageMutation: messageMutation("edited", null),
        providerOperationCreation: null,
        legalHoldFence: null,
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      })
    ).resolves.toMatchObject({ kind: "already_applied" });
    expect(doubles.prepareLifecycle).not.toHaveBeenCalled();
    expect(doubles.sealLifecycle).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "empty commit set",
      messageMutation: null,
      providerOperationCreation: null
    },
    {
      label: "standalone provider edit",
      messageMutation: null,
      providerOperationCreation: providerCreation(
        "edit",
        "provider-operation:standalone-edit"
      )
    },
    {
      label: "provider operation beside an internal edit",
      messageMutation: messageMutation("edited", null),
      providerOperationCreation: providerCreation(
        "edit",
        "provider-operation:detached"
      )
    },
    {
      label: "different nested provider operation",
      messageMutation: messageMutation(
        "edited",
        providerCreation("edit", "provider-operation:nested")
      ),
      providerOperationCreation: providerCreation(
        "edit",
        "provider-operation:substituted"
      )
    }
  ])("rejects $label before opening the atomic seam", async (testCase) => {
    const coordinator = createCoordinator();

    await expect(
      coordinator.withAuthorizedMessageLifecycleMutation({
        authorizedMutation: authorizedMutation(),
        messageMutation: testCase.messageMutation,
        providerOperationCreation: testCase.providerOperationCreation,
        legalHoldFence: null,
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      })
    ).rejects.toThrow(
      "Message lifecycle coordinator requires one closed edit/local-delete/provider-delete commit set."
    );
    expect(doubles.withAuthorizedAtomicMaterialization).not.toHaveBeenCalled();
  });

  it("contains no provider callback or network I/O in provider-delete execution", async () => {
    const providerIo = vi.fn();
    vi.stubGlobal("fetch", providerIo);
    const creation = providerCreation("delete", "provider-operation:no-io");
    doubles.prepareLifecycle.mockResolvedValue({
      kind: "ready",
      capability: capability()
    });
    doubles.sealLifecycle.mockResolvedValue(sealed("provider_delete", "1"));
    const coordinator = createCoordinator();

    await coordinator.withAuthorizedMessageLifecycleMutation({
      authorizedMutation: authorizedMutation(),
      messageMutation: null,
      providerOperationCreation: creation,
      legalHoldFence: legalHoldFence(),
      fileUploadAuthorityPlan: [],
      fileSourceAuthorityPlan: []
    });

    expect(providerIo).not.toHaveBeenCalled();
    expect(doubles.prepareLifecycle).toHaveBeenCalledOnce();
    expect(doubles.sealLifecycle).toHaveBeenCalledOnce();
  });
});

function installAtomicDriver(onRollback?: () => void): void {
  doubles.withAuthorizedAtomicMaterialization.mockImplementation(
    async (...args: unknown[]) => {
      const prepare = args[1] as (context: unknown) => Promise<unknown>;
      const seal = args[2] as (
        context: unknown,
        prepared: unknown
      ) => Promise<Readonly<{ result: unknown; receipt: unknown }>>;
      try {
        const prepared = await prepare({
          executor: {
            execute: vi
              .fn()
              .mockResolvedValueOnce({ rows: [] })
              .mockResolvedValueOnce({
                rows: [{ legal_hold_set_revision: "0" }]
              })
          }
        });
        const sealedResult = await seal({}, prepared);
        return {
          kind: "applied",
          result: sealedResult.result,
          status: {
            commandId: "command:lifecycle-1",
            mutationId: "mutation:lifecycle-1",
            publicResultCode: "core:message.lifecycle-test",
            resultReference: null,
            sensitiveResultReference: null,
            streamCommitId: "commit:lifecycle-1",
            streamEpoch: "stream:lifecycle-1",
            streamPosition: "1",
            committedAt: "2026-07-19T09:00:00.000Z"
          },
          revisionEffects: []
        };
      } catch (error) {
        onRollback?.();
        throw error;
      }
    }
  );
}

function createCoordinator(): InboxV2MessageLifecycleAtomicCoordinator {
  return createSqlInboxV2MessageLifecycleAtomicCoordinator({} as never);
}

function authorizedMutation() {
  return {
    tenantId: "tenant:lifecycle",
    occurredAt: "2026-07-19T09:00:00.000Z"
  } as never;
}

function messageMutation(
  changeKind: "edited" | "local_delete_tombstone",
  nestedProviderCreation: ReturnType<typeof providerCreation> | null
) {
  return {
    tenantId: "tenant:lifecycle",
    beforeMessage: {
      tenantId: "tenant:lifecycle",
      id: "message:lifecycle-1",
      conversation: { id: "conversation:lifecycle-1" }
    },
    beforeTimelineItem: { id: "timeline_item:lifecycle-1" },
    providerOperationCreationCommit: nestedProviderCreation,
    revision: { change: { kind: changeKind } },
    afterMessage: { id: "message:lifecycle-1", revision: "2" }
  } as never;
}

function providerCreation(action: "edit" | "delete", id: string) {
  return {
    tenantId: "tenant:lifecycle",
    timelineItem: { id: "timeline_item:lifecycle-1" },
    operation: { id, action }
  } as never;
}

function legalHoldFence() {
  return {
    tenantId: "tenant:lifecycle",
    timelineItemId: "timeline_item:lifecycle-1",
    expectedLegalHoldSetRevision: "0"
  } as const;
}

function capability() {
  return Object.freeze({ lifecycle: true }) as never;
}

function sealed(
  commandKind: "edit" | "local_delete" | "provider_delete",
  messageRevision: string
) {
  return {
    kind: "applied",
    commandKind,
    message: { id: "message:lifecycle-1", revision: messageRevision },
    timelineItem: {},
    envelope: {},
    receipt: {}
  } as never;
}
