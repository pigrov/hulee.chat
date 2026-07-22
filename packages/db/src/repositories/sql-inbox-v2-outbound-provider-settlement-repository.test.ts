import type { InboxV2OutboundProviderSettlementCommit } from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  trace: [] as string[],
  observationById: new Map<string, unknown>(),
  parseCommit: vi.fn((value: unknown) => value),
  assertMutationContext: vi.fn(),
  assertAtomicContext: vi.fn(),
  requireSealExecutor: vi.fn(),
  readObservation: vi.fn(),
  materializeOccurrence: vi.fn(),
  readOccurrence: vi.fn(),
  lockWorkLease: vi.fn(),
  lockDispatchAttempt: vi.fn(),
  resolveOccurrence: vi.fn(),
  applyTransition: vi.fn(),
  buildArtifactLinkInsert: vi.fn(),
  prepareTransport: vi.fn(),
  sealTransport: vi.fn()
}));

vi.mock("@hulee/contracts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@hulee/contracts")>();
  return {
    ...original,
    inboxV2OutboundProviderSettlementCommitSchema: {
      ...original.inboxV2OutboundProviderSettlementCommitSchema,
      parse: doubles.parseCommit
    }
  };
});

vi.mock(
  "./sql-inbox-v2-atomic-materialization-internal",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("./sql-inbox-v2-atomic-materialization-internal")
      >();
    return {
      ...original,
      requireInboxV2AtomicSealExecutor: doubles.requireSealExecutor
    };
  }
);

vi.mock("./sql-inbox-v2-authorization-repository", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("./sql-inbox-v2-authorization-repository")
    >();
  return {
    ...original,
    assertInboxV2AuthorizedCommandMutationContext:
      doubles.assertMutationContext,
    assertInboxV2AuthorizedAtomicMaterializationContext:
      doubles.assertAtomicContext
  };
});

vi.mock(
  "./sql-inbox-v2-outbound-provider-observation-repository",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("./sql-inbox-v2-outbound-provider-observation-repository")
      >();
    return {
      ...original,
      readInboxV2OutboundProviderObservationInTransaction:
        doubles.readObservation
    };
  }
);

vi.mock(
  "./sql-inbox-v2-outbound-provider-settlement-work-repository",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("./sql-inbox-v2-outbound-provider-settlement-work-repository")
      >();
    return {
      ...original,
      lockInboxV2OutboundProviderSettlementWorkLeaseInTransaction:
        doubles.lockWorkLease
    };
  }
);

vi.mock(
  "./sql-inbox-v2-outbound-transport-repository",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("./sql-inbox-v2-outbound-transport-repository")
      >();
    return {
      ...original,
      applyInboxV2OutboundProviderSettlementTransitionInTransaction:
        doubles.applyTransition,
      buildInsertInboxV2OutboundDispatchArtifactReferenceLinkSql:
        doubles.buildArtifactLinkInsert,
      lockAndValidateInboxV2OutboundDispatchAttemptInTransaction:
        doubles.lockDispatchAttempt,
      resolveInboxV2SourceOccurrenceInTransaction: doubles.resolveOccurrence
    };
  }
);

vi.mock(
  "./sql-inbox-v2-source-occurrence-repository",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("./sql-inbox-v2-source-occurrence-repository")
      >();
    return {
      ...original,
      materializeInboxV2SourceOccurrenceInTransaction:
        doubles.materializeOccurrence,
      readInboxV2SourceOccurrenceInTransaction: doubles.readOccurrence
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
      prepareInboxV2MessageTransportAssociation: doubles.prepareTransport,
      sealInboxV2PreparedMessageTransportAssociation: doubles.sealTransport
    };
  }
);

import {
  buildFindInboxV2OutboundDispatchArtifactResolutionSql,
  buildInsertInboxV2OutboundDispatchArtifactResolutionSql,
  buildInsertInboxV2OutboundProviderObservationSettlementSql,
  INBOX_V2_OUTBOUND_PROVIDER_SETTLEMENT_COMMAND_TYPE_ID,
  prepareInboxV2OutboundProviderSettlement,
  sealInboxV2PreparedOutboundProviderSettlement
} from "./sql-inbox-v2-outbound-provider-settlement-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const dialect = new PgDialect();
const tenantId = "tenant:msg007-settlement";
const trustedServiceId = "module:synthetic:trusted-provider-runtime";
const settledAt = "2026-07-22T10:30:00.000Z";

describe("SQL Inbox V2 outbound provider settlement repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doubles.trace.length = 0;
    doubles.observationById.clear();
    doubles.readObservation.mockReset();
    doubles.lockWorkLease.mockReset();
    doubles.lockDispatchAttempt.mockReset();
    doubles.readObservation.mockImplementation(
      async (_executor: unknown, input: { observationId: string }) => {
        doubles.trace.push("lock_observation");
        return doubles.observationById.get(input.observationId) ?? null;
      }
    );
    doubles.lockWorkLease.mockImplementation(async () => {
      doubles.trace.push("lock_work_lease");
      return true;
    });
    doubles.lockDispatchAttempt.mockImplementation(async () => {
      doubles.trace.push("lock_dispatch");
      doubles.trace.push("lock_attempt");
      return { kind: "matched" };
    });
    doubles.readOccurrence.mockImplementation(
      async (_executor: unknown, input: { occurrenceId: string }) => {
        doubles.trace.push("lock_occurrence");
        return occurrence(input.occurrenceId);
      }
    );
    doubles.materializeOccurrence.mockImplementation(
      async (_executor: unknown, input: { occurrence: unknown }) => {
        doubles.trace.push("materialize_occurrence");
        return {
          kind: "materialized",
          occurrence: input.occurrence
        };
      }
    );
    doubles.resolveOccurrence.mockResolvedValue({ kind: "committed" });
    doubles.applyTransition.mockResolvedValue({ kind: "committed" });
    doubles.buildArtifactLinkInsert.mockReturnValue(
      sql`insert into test_artifact_link values ('one') returning id`
    );
    doubles.prepareTransport.mockResolvedValue({
      kind: "ready",
      capability: Object.freeze({})
    });
    doubles.sealTransport.mockResolvedValue({
      receipt: Object.freeze({})
    });
    doubles.requireSealExecutor.mockImplementation(
      (context: { executor: RawSqlExecutor }) => context.executor
    );
  });

  it("pins one immutable effective resolution by both id and artifact slot", () => {
    const commit = settlementCommit();
    const resolution = selectedResolution(commit);
    const insert = render(
      buildInsertInboxV2OutboundDispatchArtifactResolutionSql(resolution)
    );
    const find = render(
      buildFindInboxV2OutboundDispatchArtifactResolutionSql(resolution)
    );

    expect(normalize(insert.sql)).toContain(
      "insert into inbox_v2_outbound_dispatch_artifact_resolutions"
    );
    expect(normalize(insert.sql)).toContain(
      "on conflict do nothing returning id"
    );
    expect(insert.params).toEqual(
      expect.arrayContaining([
        resolution.id,
        resolution.effectiveArtifact.id,
        resolution.observation.id,
        resolution.observation.sourceOccurrence.id
      ])
    );
    expect(normalize(find.sql)).toContain("id = $2 or artifact_id = $3");
    expect(normalize(find.sql)).toContain("limit 2 for share");
  });

  it("appends the post-link settlement with every canonical foreign key", () => {
    const commit = settlementCommit();
    const rendered = render(
      buildInsertInboxV2OutboundProviderObservationSettlementSql(commit)
    );
    const statement = normalize(rendered.sql);

    expect(statement).toContain(
      "insert into inbox_v2_outbound_provider_observation_settlements"
    );
    expect(statement).toContain("artifact_resolution_id");
    expect(statement).toContain("canonical_artifact_reference_link_id");
    expect(statement).toContain("message_transport_link_id");
    expect(statement).toContain("source_occurrence_resolution_state");
    expect(statement).toContain("'resolved'");
    expect(statement).toContain("on conflict do nothing");
    expect(statement).toContain("returning observation_id as id");
    expect(rendered.params).toEqual(
      expect.arrayContaining([
        commit.observation.id,
        selectedResolution(commit).id,
        selectedArtifactLink(commit).id,
        commit.messageTransportAssociation.link.id,
        commit.occurrenceResolution.after.id
      ])
    );
  });

  it("seals transport before its unique observation settlement and consumes the capability once", async () => {
    const trace = doubles.trace;
    const commit = settlementCommit();
    const executor = createExecutor(
      createPreparationRows(commit, {
        resolution: "create",
        artifactLink: "create"
      })
    );
    doubles.sealTransport.mockImplementation(async () => {
      trace.push("seal_transport");
      return { receipt: Object.freeze({}) };
    });
    const token = Object.freeze({});
    const capability = await prepareInboxV2OutboundProviderSettlement(
      mutationContext(executor, token) as never,
      { workLease: workLease(commit), commit }
    );
    const sealed = await sealInboxV2PreparedOutboundProviderSettlement(
      atomicContext(token) as never,
      { capability }
    );

    expect(sealed.result).toEqual({
      observationId: commit.observation.id,
      artifactResolutionId: selectedResolution(commit).id,
      canonicalArtifactReferenceLinkId: selectedArtifactLink(commit).id,
      messageTransportLinkId: commit.messageTransportAssociation.link.id
    });
    expect(trace.slice(0, 7)).toEqual([
      "lock_occurrence",
      "lock_dispatch",
      "lock_attempt",
      "lock_artifact",
      "lock_observation",
      "find_observation_settlement",
      "lock_work_lease"
    ]);
    expect(trace.indexOf("lock_work_lease")).toBeLessThan(
      trace.indexOf("insert_artifact_resolution")
    );
    expect(trace.indexOf("seal_transport")).toBeLessThan(
      trace.indexOf("insert_observation_settlement")
    );
    expect(
      trace.filter((step) => step === "insert_observation_settlement")
    ).toHaveLength(1);
    await expect(
      sealInboxV2PreparedOutboundProviderSettlement(
        atomicContext(token) as never,
        { capability }
      )
    ).rejects.toThrow(/unknown or already consumed/iu);
  });

  it("reuses the one effective artifact resolution and canonical link while appending a distinct transport settlement", async () => {
    const first = settlementCommit();
    const commit = settlementCommit({
      suffix: "echo-2",
      artifactResolution: {
        kind: "reuse_existing",
        existingResolution: selectedResolution(first)
      },
      artifactAssociation: {
        kind: "reuse_existing",
        existingLink: selectedArtifactLink(first)
      }
    });
    const executor = createExecutor(
      createPreparationRows(commit, {
        resolution: "reuse",
        artifactLink: "reuse"
      })
    );
    const token = Object.freeze({});
    const capability = await prepareInboxV2OutboundProviderSettlement(
      mutationContext(executor, token) as never,
      { workLease: workLease(commit), commit }
    );
    const sealed = await sealInboxV2PreparedOutboundProviderSettlement(
      atomicContext(token) as never,
      { capability }
    );

    expect(doubles.trace).toContain("find_artifact_resolution");
    expect(doubles.trace).toContain("find_artifact_link");
    expect(doubles.trace).not.toContain("insert_artifact_resolution");
    expect(doubles.trace).not.toContain("insert_artifact_link");
    expect(sealed.result).toMatchObject({
      observationId: commit.observation.id,
      artifactResolutionId: selectedResolution(first).id,
      canonicalArtifactReferenceLinkId: selectedArtifactLink(first).id,
      messageTransportLinkId: "message_transport_occurrence_link:echo-2"
    });
    const settlement = executor.rendered.at(-1);
    expect(settlement?.params).toEqual(
      expect.arrayContaining([
        commit.observation.id,
        selectedResolution(first).id,
        selectedArtifactLink(first).id,
        "message_transport_occurrence_link:echo-2"
      ])
    );
  });

  it("rejects a second settlement for the same observation before transport preparation", async () => {
    const commit = settlementCommit();
    const executor = createExecutor([
      [artifactRow(commit)],
      [{ observation_id: commit.observation.id }]
    ]);

    await expect(
      prepareInboxV2OutboundProviderSettlement(
        mutationContext(executor, Object.freeze({})) as never,
        { workLease: workLease(commit), commit }
      )
    ).rejects.toMatchObject({ reason: "observation_already_settled" });
    expect(doubles.prepareTransport).not.toHaveBeenCalled();
  });

  it("rejects an expired or reclaimed work lease after canonical locks but before canonical writes", async () => {
    const commit = settlementCommit();
    doubles.lockWorkLease.mockImplementationOnce(async () => {
      doubles.trace.push("lock_work_lease");
      return false;
    });

    await expect(
      prepareInboxV2OutboundProviderSettlement(
        mutationContext(
          createExecutor([[artifactRow(commit)], []]),
          Object.freeze({})
        ) as never,
        { workLease: workLease(commit), commit }
      )
    ).rejects.toMatchObject({ reason: "work_lease_conflict" });
    expect(doubles.trace.slice(0, 7)).toEqual([
      "lock_occurrence",
      "lock_dispatch",
      "lock_attempt",
      "lock_artifact",
      "lock_observation",
      "find_observation_settlement",
      "lock_work_lease"
    ]);
    expect(doubles.trace).not.toContain("insert_artifact_resolution");
    expect(doubles.prepareTransport).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "missing",
      persisted() {
        return null;
      }
    },
    {
      label: "non-exact",
      persisted(
        observation: InboxV2OutboundProviderSettlementCommit["observation"]
      ) {
        return {
          ...observation,
          sourceOccurrence: {
            ...observation.sourceOccurrence,
            revision: "9"
          }
        };
      }
    }
  ])(
    "rejects a $label immutable observation before the work lease",
    async (testCase) => {
      const commit = settlementCommit();
      doubles.readObservation.mockImplementationOnce(async () => {
        doubles.trace.push("lock_observation");
        return testCase.persisted(commit.observation);
      });

      await expect(
        prepareInboxV2OutboundProviderSettlement(
          mutationContext(
            createExecutor([[artifactRow(commit)]]),
            Object.freeze({})
          ) as never,
          { workLease: workLease(commit), commit }
        )
      ).rejects.toMatchObject({ reason: "observation_conflict" });
      expect(doubles.trace.slice(0, 5)).toEqual([
        "lock_occurrence",
        "lock_dispatch",
        "lock_attempt",
        "lock_artifact",
        "lock_observation"
      ]);
      expect(doubles.lockWorkLease).not.toHaveBeenCalled();
      expect(doubles.prepareTransport).not.toHaveBeenCalled();
    }
  );

  it("locks provider-response dispatch and attempt before materializing and locking its occurrence", async () => {
    const base = settlementCommit();
    const commit = {
      ...base,
      occurrenceMaterialization: {
        kind: "provider_response",
        commit: { occurrence: base.observation.sourceOccurrence }
      }
    } as unknown as InboxV2OutboundProviderSettlementCommit;
    const executor = createExecutor(
      createPreparationRows(commit, {
        resolution: "create",
        artifactLink: "create"
      })
    );

    await prepareInboxV2OutboundProviderSettlement(
      mutationContext(executor, Object.freeze({})) as never,
      { workLease: workLease(commit), commit }
    );

    expect(doubles.trace.slice(0, 4)).toEqual([
      "lock_dispatch",
      "lock_attempt",
      "materialize_occurrence",
      "lock_occurrence"
    ]);
  });

  it.each([
    "dispatch_not_found",
    "attempt_state_conflict",
    "dispatch_state_conflict"
  ] as const)(
    "maps a %s head fence to a settlement conflict before artifact locking",
    async (kind) => {
      const commit = settlementCommit();
      doubles.lockDispatchAttempt.mockImplementationOnce(async () => {
        doubles.trace.push("lock_dispatch");
        doubles.trace.push("lock_attempt");
        return { kind };
      });

      await expect(
        prepareInboxV2OutboundProviderSettlement(
          mutationContext(createExecutor([]), Object.freeze({})) as never,
          { workLease: workLease(commit), commit }
        )
      ).rejects.toMatchObject({ reason: "dispatch_transition_conflict" });
      expect(doubles.trace).toEqual([
        "lock_occurrence",
        "lock_dispatch",
        "lock_attempt"
      ]);
      expect(doubles.readObservation).not.toHaveBeenCalled();
      expect(doubles.lockWorkLease).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      kind: "complete_pending_attempt",
      transition(dispatch: unknown, attempt: unknown) {
        return {
          kind: "complete_pending_attempt",
          attemptCommit: {
            kind: "complete_attempt",
            dispatchBefore: dispatch,
            attemptBefore: attempt
          }
        };
      }
    },
    {
      kind: "reconcile_outcome_unknown",
      transition(dispatch: unknown, attempt: unknown) {
        return {
          kind: "reconcile_outcome_unknown",
          reconciliationCommit: {
            dispatchBefore: dispatch,
            decision: { unknownAttempt: attempt }
          }
        };
      }
    },
    {
      kind: "already_accepted",
      transition(dispatch: unknown, attempt: unknown) {
        return { kind: "already_accepted", dispatch, attempt };
      }
    },
    {
      kind: "retain_dispatch_state",
      transition(dispatch: unknown, attempt: unknown) {
        return { kind: "retain_dispatch_state", dispatch, attempt };
      }
    }
  ])(
    "locks the exact $kind transition head before artifact work",
    async (testCase) => {
      const base = settlementCommit({ suffix: `head-${testCase.kind}` });
      const selectedDispatch =
        testCase.kind === "retain_dispatch_state"
          ? base.observation.dispatch
          : {
              ...base.observation.dispatch,
              id: `outbound_dispatch:${testCase.kind}`
            };
      const selectedAttempt =
        testCase.kind === "retain_dispatch_state"
          ? base.observation.attempt
          : {
              ...base.observation.attempt,
              id: `outbound_dispatch_attempt:${testCase.kind}`
            };
      const commit = settlementCommit({
        suffix: `head-${testCase.kind}`,
        transition: testCase.transition(selectedDispatch, selectedAttempt)
      });
      doubles.lockDispatchAttempt.mockResolvedValueOnce({
        kind: "dispatch_state_conflict"
      });

      await expect(
        prepareInboxV2OutboundProviderSettlement(
          mutationContext(createExecutor([]), Object.freeze({})) as never,
          { workLease: workLease(commit), commit }
        )
      ).rejects.toMatchObject({ reason: "dispatch_transition_conflict" });
      expect(doubles.lockDispatchAttempt).toHaveBeenCalledWith(
        expect.anything(),
        { dispatch: selectedDispatch, attempt: selectedAttempt }
      );
      expect(doubles.readObservation).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      label: "resolution occurrence",
      mutate(rows: Record<string, unknown>[][]) {
        rows[2]![0]!.observation_source_occurrence_id =
          "source_occurrence:tampered";
      },
      reason: "artifact_resolution_conflict"
    },
    {
      label: "artifact-link message",
      mutate(rows: Record<string, unknown>[][]) {
        rows[3]![0]!.message_id = "message:tampered";
      },
      reason: "artifact_association_conflict"
    }
  ])("rejects non-exact reused $label evidence", async (testCase) => {
    const first = settlementCommit();
    const commit = settlementCommit({
      suffix: "echo-tamper",
      artifactResolution: {
        kind: "reuse_existing",
        existingResolution: selectedResolution(first)
      },
      artifactAssociation: {
        kind: "reuse_existing",
        existingLink: selectedArtifactLink(first)
      }
    });
    const rows = createPreparationRows(commit, {
      resolution: "reuse",
      artifactLink: "reuse"
    });
    testCase.mutate(rows);

    await expect(
      prepareInboxV2OutboundProviderSettlement(
        mutationContext(createExecutor(rows), Object.freeze({})) as never,
        { workLease: workLease(commit), commit }
      )
    ).rejects.toMatchObject({ reason: testCase.reason });
    expect(doubles.prepareTransport).not.toHaveBeenCalled();
  });
});

function settlementCommit(
  input: Readonly<{
    suffix?: string;
    artifactResolution?: Record<string, unknown>;
    artifactAssociation?: Record<string, unknown>;
    transition?: Record<string, unknown>;
  }> = {}
): InboxV2OutboundProviderSettlementCommit {
  const suffix = input.suffix ?? "echo-1";
  const observedOccurrence = occurrence(`source_occurrence:${suffix}`);
  const observedArtifact = artifact();
  const observed = {
    tenantId,
    id: `outbound_provider_observation:${suffix}`,
    artifact: observedArtifact,
    dispatch: {
      tenantId,
      id: "outbound_dispatch:dispatch-1",
      message: reference("message", "message:message-1")
    },
    route: { tenantId, id: "outbound_route:route-1" },
    attempt: { tenantId, id: "outbound_dispatch_attempt:attempt-1" },
    sourceOccurrence: observedOccurrence
  };
  const resolution = {
    tenantId,
    id: "outbound_dispatch_artifact_resolution:resolution-1",
    observation: observed,
    artifactOrdinal: 1,
    fromState: "accepted",
    effectiveState: "accepted",
    effectiveArtifact: observedArtifact,
    resolvedByTrustedServiceId: trustedServiceId,
    resolvedAt: settledAt,
    revision: "1"
  };
  const externalMessageReference = {
    tenantId,
    id: `external_message_reference:${suffix}`,
    key: {
      externalThread: reference("external_thread", "external_thread:thread-1")
    }
  };
  const artifactLink = {
    tenantId,
    id: "outbound_dispatch_artifact_reference_link:link-1",
    artifact: reference("outbound_dispatch_artifact", observedArtifact.id),
    dispatch: reference("outbound_dispatch", observed.dispatch.id),
    route: reference("outbound_route", observed.route.id),
    attempt: reference("outbound_dispatch_attempt", observed.attempt.id),
    externalThread: reference("external_thread", "external_thread:thread-1"),
    externalMessageReference: reference(
      "external_message_reference",
      externalMessageReference.id
    ),
    sourceOccurrence: reference("source_occurrence", observedOccurrence.id),
    associationEvidence: {
      kind: "provider_echo_correlation",
      providerReferenceKindId: "module:synthetic:correlation-token",
      correlationToken: "provider:correlation-1"
    },
    linkedByTrustedServiceId: trustedServiceId,
    linkedAt: settledAt,
    revision: "1"
  };
  const commit = {
    tenantId,
    observation: observed,
    artifactResolution:
      input.artifactResolution ?? ({ kind: "create", resolution } as const),
    artifactCoverage: {
      contentPlan: { id: "outbound_dispatch_content_plan:plan-1" },
      resolutions: [resolution]
    },
    occurrenceMaterialization: {
      kind: "provider_echo",
      persistedSourceOccurrence: observedOccurrence,
      verifiedByTrustedServiceId: trustedServiceId,
      verifiedAt: settledAt
    },
    occurrenceResolution: {
      after: { ...observedOccurrence, revision: "2" }
    },
    externalMessageReference,
    artifactAssociation:
      input.artifactAssociation ??
      ({
        kind: "create",
        commit: { link: artifactLink }
      } as const),
    messageTransportAssociation: {
      link: {
        id: `message_transport_occurrence_link:${suffix}`
      }
    },
    transition: input.transition ?? {
      kind: "already_accepted",
      dispatch: observed.dispatch,
      attempt: observed.attempt
    },
    settledByTrustedServiceId: trustedServiceId,
    settledAt
  };
  doubles.observationById.set(observed.id, observed);
  return commit as unknown as InboxV2OutboundProviderSettlementCommit;
}

function workLease(commit: InboxV2OutboundProviderSettlementCommit) {
  return {
    tenantId: commit.tenantId,
    observationId: commit.observation.id,
    candidateExternalMessageReferenceId: commit.externalMessageReference.id,
    candidateTransportLinkId: commit.messageTransportAssociation.link.id,
    trustedServiceId: commit.settledByTrustedServiceId,
    workerId: "core:settlement-worker",
    leaseToken: `settlement-lease:${"a".repeat(48)}`,
    leaseRevision: "1"
  };
}

function artifact() {
  return {
    tenantId,
    id: "outbound_dispatch_artifact:artifact-1",
    dispatch: reference("outbound_dispatch", "outbound_dispatch:dispatch-1"),
    route: reference("outbound_route", "outbound_route:route-1"),
    attempt: reference(
      "outbound_dispatch_attempt",
      "outbound_dispatch_attempt:attempt-1"
    ),
    ordinal: 1,
    state: "accepted",
    diagnostic: null,
    createdAt: settledAt,
    revision: "1"
  };
}

function occurrence(id: string) {
  return { tenantId, id, revision: "1" };
}

function reference(kind: string, id: string) {
  return { tenantId, kind, id };
}

function selectedResolution(commit: InboxV2OutboundProviderSettlementCommit) {
  return commit.artifactResolution.kind === "create"
    ? commit.artifactResolution.resolution
    : commit.artifactResolution.existingResolution;
}

function selectedArtifactLink(commit: InboxV2OutboundProviderSettlementCommit) {
  return commit.artifactAssociation.kind === "create"
    ? commit.artifactAssociation.commit.link
    : commit.artifactAssociation.existingLink;
}

function createPreparationRows(
  commit: InboxV2OutboundProviderSettlementCommit,
  modes: Readonly<{
    resolution: "create" | "reuse";
    artifactLink: "create" | "reuse";
  }>
): Record<string, unknown>[][] {
  const resolution = selectedResolution(commit);
  const link = selectedArtifactLink(commit);
  return [
    [artifactRow(commit)],
    [],
    [
      modes.resolution === "create"
        ? { id: resolution.id }
        : artifactResolutionRow(resolution)
    ],
    [
      modes.artifactLink === "create"
        ? { id: link.id }
        : artifactLinkRow(link, commit.observation.dispatch.message.id)
    ],
    [{ id: commit.observation.id }]
  ];
}

function artifactRow(commit: InboxV2OutboundProviderSettlementCommit) {
  const value = commit.observation.artifact;
  return {
    id: value.id,
    dispatch_id: value.dispatch.id,
    route_id: value.route.id,
    attempt_id: value.attempt.id,
    message_id: commit.observation.dispatch.message.id,
    ordinal: value.ordinal,
    state: value.state,
    created_at: value.createdAt,
    revision: value.revision
  };
}

function artifactResolutionRow(
  resolution: ReturnType<typeof selectedResolution>
) {
  return {
    id: resolution.id,
    artifact_id: resolution.effectiveArtifact.id,
    dispatch_id: resolution.observation.dispatch.id,
    route_id: resolution.observation.route.id,
    attempt_id: resolution.observation.attempt.id,
    message_id: resolution.observation.dispatch.message.id,
    artifact_ordinal: resolution.artifactOrdinal,
    from_state: resolution.fromState,
    effective_state: resolution.effectiveState,
    observation_id: resolution.observation.id,
    observation_source_occurrence_id:
      resolution.observation.sourceOccurrence.id,
    resolved_by_trusted_service_id: resolution.resolvedByTrustedServiceId,
    resolved_at: resolution.resolvedAt,
    revision: resolution.revision
  };
}

function artifactLinkRow(
  link: ReturnType<typeof selectedArtifactLink>,
  messageId: string
) {
  const evidence = link.associationEvidence;
  return {
    id: link.id,
    artifact_id: link.artifact.id,
    dispatch_id: link.dispatch.id,
    route_id: link.route.id,
    attempt_id: link.attempt.id,
    message_id: messageId,
    external_thread_id: link.externalThread.id,
    external_message_reference_id: link.externalMessageReference.id,
    source_occurrence_id: link.sourceOccurrence.id,
    evidence_kind: evidence.kind,
    provider_reference_kind_id:
      evidence.kind === "provider_echo_correlation"
        ? evidence.providerReferenceKindId
        : null,
    correlation_token:
      evidence.kind === "provider_echo_correlation"
        ? evidence.correlationToken
        : null,
    linked_by_trusted_service_id: link.linkedByTrustedServiceId,
    linked_at: link.linkedAt,
    revision: link.revision
  };
}

function mutationContext(
  executor: RawSqlExecutor,
  atomicMaterializationToken: object
) {
  return {
    tenantId,
    commandTypeId: INBOX_V2_OUTBOUND_PROVIDER_SETTLEMENT_COMMAND_TYPE_ID,
    actor: { kind: "trusted_service", trustedServiceId },
    occurredAt: settledAt,
    executor,
    atomicMaterializationToken
  };
}

function atomicContext(atomicMaterializationToken: object) {
  return {
    tenantId,
    commandTypeId: INBOX_V2_OUTBOUND_PROVIDER_SETTLEMENT_COMMAND_TYPE_ID,
    actor: { kind: "trusted_service", trustedServiceId },
    occurredAt: settledAt,
    atomicMaterializationToken
  };
}

function createExecutor(
  rows: Record<string, unknown>[][],
  trace: string[] = doubles.trace
): RawSqlExecutor & { rendered: ReturnType<typeof render>[] } {
  let index = 0;
  const rendered: ReturnType<typeof render>[] = [];
  return {
    rendered,
    async execute<
      TRow extends Record<string, unknown> = Record<string, unknown>
    >(query: SQL): Promise<RawSqlQueryResult<TRow>> {
      const statement = render(query);
      rendered.push(statement);
      trace.push(classify(statement.sql));
      const response = rows[index++] ?? [];
      return { rows: response as TRow[] };
    }
  };
}

function classify(statement: string): string {
  const normalized = normalize(statement);
  if (normalized.includes("from inbox_v2_outbound_provider_observations")) {
    return "lock_observation";
  }
  if (
    normalized.includes(
      "from inbox_v2_outbound_provider_observation_settlements"
    )
  ) {
    return "find_observation_settlement";
  }
  if (normalized.includes("from inbox_v2_outbound_dispatch_artifacts")) {
    return "lock_artifact";
  }
  if (
    normalized.includes(
      "insert into inbox_v2_outbound_dispatch_artifact_resolutions"
    )
  ) {
    return "insert_artifact_resolution";
  }
  if (
    normalized.includes("from inbox_v2_outbound_dispatch_artifact_resolutions")
  ) {
    return "find_artifact_resolution";
  }
  if (normalized.includes("insert into test_artifact_link")) {
    return "insert_artifact_link";
  }
  if (
    normalized.includes(
      "from inbox_v2_outbound_dispatch_artifact_reference_links"
    )
  ) {
    return "find_artifact_link";
  }
  if (
    normalized.includes(
      "insert into inbox_v2_outbound_provider_observation_settlements"
    )
  ) {
    return "insert_observation_settlement";
  }
  return normalized;
}

function render(query: SQL) {
  return dialect.sqlToQuery(query);
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
