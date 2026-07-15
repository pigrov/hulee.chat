import { describe, expect, it } from "vitest";

import {
  calculateInboxV2OutboxLeaseTokenHash,
  INBOX_V2_REPOSITORY_FOUNDATION_SCHEMA_VERSION,
  INBOX_V2_TENANT_STREAM_SNAPSHOT_SCHEMA_ID,
  inboxV2ApplyProjectionContiguousInputSchema,
  inboxV2ApplyProjectionContiguousResultSchema,
  inboxV2ClaimOutboxResultSchema,
  inboxV2CompareAndSetRetainedPrefixInputSchema,
  inboxV2CompareAndSetRetainedPrefixResultSchema,
  inboxV2CutoverProjectionGenerationInputSchema,
  inboxV2CutoverProjectionGenerationResultSchema,
  inboxV2FinalizeOutboxInputSchema,
  inboxV2FinalizeOutboxResultSchema,
  inboxV2InitializeProjectionGenerationInputSchema,
  inboxV2OutboxClaimSchema,
  inboxV2OutboxWorkItemEnvelopeSchema,
  inboxV2OutboxWorkItemSchema,
  inboxV2ProjectionGenerationEnvelopeSchema,
  inboxV2ProjectionGenerationSnapshotSchema,
  inboxV2RenewOutboxLeaseInputSchema,
  inboxV2RenewOutboxLeaseResultSchema,
  inboxV2ReplayTenantStreamInputSchema,
  inboxV2ReplayTenantStreamResultSchema,
  inboxV2RepositoryTenantContextSchema,
  inboxV2RetainedPrefixEnvelopeSchema,
  inboxV2RetainedPrefixStateSchema,
  inboxV2TenantStreamReplayCommitSchema,
  inboxV2TenantStreamReplayPageEnvelopeSchema,
  inboxV2TenantStreamReplayPageSchema,
  inboxV2TenantStreamSnapshotEnvelopeSchema
} from "../index";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const streamEpoch = "stream:epoch:0001";
const projectionId = "core:inbox-recipient-projection";
const scopeId = "scope:employee-1";
const workerId = "core:outbox-worker";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const initializedAt = "2026-07-15T09:00:00.000Z";
const claimedAt = "2026-07-15T09:01:00.000Z";
const expiresAt = "2026-07-15T09:02:00.000Z";
const retryAt = "2026-07-15T09:03:00.000Z";
const leaseToken = `lease-token-${"a".repeat(32)}`;

function payloadReference(forTenant = tenantId) {
  return {
    tenantId: forTenant,
    recordId: "result:outbox-1",
    schemaId: "core:inbox-v2.outbox-result",
    schemaVersion: "v1",
    digest: hashB
  };
}

function replayCommit(position: string) {
  const commitId = `commit:commit-${position}`;
  const changeId = `change:change-${position}`;
  return {
    commit: {
      tenantId,
      streamEpoch,
      id: commitId,
      position,
      schemaVersion: "v1",
      correlationId: `correlation:correlation-${position}`,
      commandIds: [],
      clientMutationIds: [],
      changeIds: [changeId],
      eventIds: [`event:event-${position}`],
      outboxIntentIds: [],
      audienceImpact: { kind: "none" },
      committedAt: initializedAt,
      commitHash: hashA
    },
    changes: [
      {
        reference: {
          tenantId,
          commitId,
          streamPosition: position,
          changeId,
          ordinal: "1"
        },
        entity: {
          tenantId,
          entityTypeId: "core:message",
          entityId: `message:message-${position}`
        },
        resultingRevision: "1",
        timeline: null,
        audience: "conversation_external",
        state: {
          kind: "tombstone",
          reasonId: "core:privacy-erased",
          stateHash: hashA,
          domainCommitReference: {
            tenantId,
            recordId: `domain-commit:message-${position}`,
            schemaId: "core:inbox-v2.message-tombstone",
            schemaVersion: "v1",
            digest: hashA
          }
        }
      }
    ]
  };
}

function replayPage() {
  return {
    tenantId,
    streamEpoch,
    snapshotPosition: "2",
    minRetainedPosition: "0",
    fromExclusive: "0",
    throughInclusive: "2",
    scannedThrough: "2",
    limit: 2,
    commits: [replayCommit("1"), replayCommit("2")],
    hasMore: false,
    nextAfterPosition: null
  };
}

function generation(state: "shadow" | "active" | "retired" = "active") {
  return {
    tenantId,
    projectionId,
    scopeId,
    streamEpoch,
    syncGeneration: "2",
    projectionSchemaVersion: "v1",
    state,
    minRetainedPosition: "0",
    revision: state === "retired" ? "3" : state === "active" ? "2" : "1",
    initializedAt,
    activatedAt: state === "active" || state === "retired" ? claimedAt : null,
    retiredAt: state === "retired" ? expiresAt : null
  };
}

function checkpoint(position = "5") {
  return {
    tenantId,
    projectionId,
    scopeId,
    streamEpoch,
    syncGeneration: "2",
    projectionSchemaVersion: "v1",
    position
  };
}

function generationSnapshot(state: "shadow" | "active" | "retired" = "active") {
  return { generation: generation(state), checkpoint: checkpoint() };
}

function projectionInput(position = "5") {
  return {
    tenantId,
    streamEpoch,
    commitId: `commit:commit-${position}`,
    commitSchemaVersion: "v1",
    streamPosition: position
  };
}

describe("Inbox V2 repository foundation tenant stream", () => {
  it("requires one strict explicit tenant context and strict v1 envelopes", () => {
    expect(
      inboxV2RepositoryTenantContextSchema.safeParse({ tenantId }).success
    ).toBe(true);
    expect(
      inboxV2RepositoryTenantContextSchema.safeParse({
        tenantId,
        inferredFromCursor: true
      }).success
    ).toBe(false);

    const snapshot = {
      tenantId,
      streamEpoch,
      lastPosition: "2",
      minRetainedPosition: "0",
      capturedAt: initializedAt
    };
    expect(
      inboxV2TenantStreamSnapshotEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_TENANT_STREAM_SNAPSHOT_SCHEMA_ID,
        schemaVersion: INBOX_V2_REPOSITORY_FOUNDATION_SCHEMA_VERSION,
        payload: snapshot
      }).success
    ).toBe(true);
    expect(
      inboxV2TenantStreamSnapshotEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_TENANT_STREAM_SNAPSHOT_SCHEMA_ID,
        schemaVersion: "v2",
        payload: snapshot
      }).success
    ).toBe(false);
    expect(
      inboxV2TenantStreamSnapshotEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_TENANT_STREAM_SNAPSHOT_SCHEMA_ID,
        schemaVersion: "v1",
        payload: snapshot,
        extra: true
      }).success
    ).toBe(false);
  });

  it("returns only contiguous commits with their exact one-based change manifest", () => {
    expect(
      inboxV2TenantStreamReplayCommitSchema.safeParse(replayCommit("1")).success
    ).toBe(true);
    const wrongManifest = replayCommit("1");
    wrongManifest.commit.changeIds = ["change:other"];
    expect(
      inboxV2TenantStreamReplayCommitSchema.safeParse(wrongManifest).success
    ).toBe(false);
    const wrongOrdinal = replayCommit("1");
    wrongOrdinal.changes[0]!.reference.ordinal = "2";
    expect(
      inboxV2TenantStreamReplayCommitSchema.safeParse(wrongOrdinal).success
    ).toBe(false);

    expect(
      inboxV2TenantStreamReplayPageSchema.safeParse(replayPage()).success
    ).toBe(true);
    const gap = replayPage();
    gap.commits[1] = replayCommit("3");
    expect(inboxV2TenantStreamReplayPageSchema.safeParse(gap).success).toBe(
      false
    );
    expect(
      inboxV2TenantStreamReplayPageSchema.safeParse({
        ...replayPage(),
        throughInclusive: "3",
        snapshotPosition: "3",
        hasMore: true,
        nextAfterPosition: "2"
      }).success
    ).toBe(true);
    expect(
      inboxV2TenantStreamReplayPageSchema.safeParse({
        ...replayPage(),
        hasMore: true,
        nextAfterPosition: null
      }).success
    ).toBe(false);
    expect(
      inboxV2TenantStreamReplayPageSchema.safeParse({
        ...replayPage(),
        limit: 1
      }).success
    ).toBe(false);
    expect(
      inboxV2TenantStreamReplayPageSchema.safeParse({
        ...replayPage(),
        minRetainedPosition: "1"
      }).success
    ).toBe(true);
    expect(
      inboxV2TenantStreamReplayPageSchema.safeParse({
        ...replayPage(),
        minRetainedPosition: "2"
      }).success
    ).toBe(false);
  });

  it("bounds replay at a snapshot and types expired, future and gap outcomes", () => {
    expect(
      inboxV2ReplayTenantStreamInputSchema.safeParse({
        context: { tenantId },
        streamEpoch,
        afterPosition: "2",
        throughPosition: "1",
        limit: 100
      }).success
    ).toBe(false);
    expect(
      inboxV2TenantStreamReplayPageEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.repository-tenant-stream-replay-page",
        schemaVersion: "v1",
        payload: replayPage()
      }).success
    ).toBe(true);
    for (const result of [
      { outcome: "page", page: replayPage() },
      { outcome: "cursor_expired", tenantId, minRetainedPosition: "4" },
      { outcome: "cursor_future", tenantId, lastPosition: "5" },
      { outcome: "epoch_mismatch", tenantId, currentStreamEpoch: streamEpoch },
      {
        outcome: "gap_detected",
        tenantId,
        expectedPosition: "2",
        observedPosition: "4"
      }
    ]) {
      expect(
        inboxV2ReplayTenantStreamResultSchema.safeParse(result).success
      ).toBe(true);
    }
    expect(
      inboxV2ReplayTenantStreamResultSchema.safeParse({
        outcome: "gap_detected",
        tenantId,
        expectedPosition: "4",
        observedPosition: "4"
      }).success
    ).toBe(false);
  });
});

describe("Inbox V2 repository foundation projection persistence", () => {
  it("binds generation, checkpoint, schema, epoch and retained prefix", () => {
    expect(
      inboxV2ProjectionGenerationEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.repository-projection-generation",
        schemaVersion: "v1",
        payload: generation()
      }).success
    ).toBe(true);
    expect(
      inboxV2ProjectionGenerationSnapshotSchema.safeParse(generationSnapshot())
        .success
    ).toBe(true);
    expect(
      inboxV2ProjectionGenerationSnapshotSchema.safeParse(
        generationSnapshot("retired")
      ).success
    ).toBe(true);
    expect(
      inboxV2ProjectionGenerationSnapshotSchema.safeParse({
        generation: { ...generation("retired"), activatedAt: null },
        checkpoint: checkpoint()
      }).success
    ).toBe(false);
    expect(
      inboxV2ProjectionGenerationSnapshotSchema.safeParse({
        ...generationSnapshot(),
        checkpoint: { ...checkpoint(), syncGeneration: "3" }
      }).success
    ).toBe(false);
    expect(
      inboxV2ProjectionGenerationSnapshotSchema.safeParse({
        generation: { ...generation(), minRetainedPosition: "6" },
        checkpoint: checkpoint("5")
      }).success
    ).toBe(false);
    expect(
      inboxV2InitializeProjectionGenerationInputSchema.safeParse({
        context: { tenantId },
        projectionId,
        scopeId,
        streamEpoch,
        syncGeneration: "2",
        projectionSchemaVersion: "v1",
        initialPosition: "0",
        minRetainedPosition: "1",
        initialState: "shadow",
        initializedAt
      }).success
    ).toBe(false);
  });

  it("types applied, irrelevant, duplicate, gap and checkpoint-conflict outcomes", () => {
    expect(
      inboxV2ApplyProjectionContiguousInputSchema.safeParse({
        context: { tenantId },
        projectionId,
        scopeId,
        syncGeneration: "2",
        expectedCheckpoint: "4",
        input: projectionInput("5"),
        relevance: "relevant"
      }).success
    ).toBe(true);
    expect(
      inboxV2ApplyProjectionContiguousInputSchema.safeParse({
        context: { tenantId },
        projectionId,
        scopeId,
        syncGeneration: "2",
        expectedCheckpoint: "4",
        input: { ...projectionInput("5"), tenantId: otherTenantId },
        relevance: "relevant"
      }).success
    ).toBe(false);

    const transition = {
      before: checkpoint("4"),
      input: projectionInput("5"),
      disposition: "applied",
      after: checkpoint("5")
    };
    expect(
      inboxV2ApplyProjectionContiguousResultSchema.safeParse({
        outcome: "applied",
        transition
      }).success
    ).toBe(true);
    expect(
      inboxV2ApplyProjectionContiguousResultSchema.safeParse({
        outcome: "advanced_irrelevant",
        transition
      }).success
    ).toBe(false);
    expect(
      inboxV2ApplyProjectionContiguousResultSchema.safeParse({
        outcome: "duplicate",
        tenantId,
        projectionId,
        scopeId,
        syncGeneration: "2",
        currentCheckpoint: "5",
        receivedPosition: "5"
      }).success
    ).toBe(true);
    expect(
      inboxV2ApplyProjectionContiguousResultSchema.safeParse({
        outcome: "gap_detected",
        tenantId,
        projectionId,
        scopeId,
        syncGeneration: "2",
        currentCheckpoint: "5",
        expectedPosition: "6",
        observedPosition: "7"
      }).success
    ).toBe(true);
  });

  it("requires a caught-up distinct shadow generation for atomic cutover", () => {
    const input = {
      context: { tenantId },
      projectionId,
      scopeId,
      expectedActiveGeneration: "1",
      candidateGeneration: "2",
      expectedCandidateCheckpoint: "10",
      requiredThroughPosition: "10",
      cutoverAt: expiresAt
    };
    expect(
      inboxV2CutoverProjectionGenerationInputSchema.safeParse(input).success
    ).toBe(true);
    expect(
      inboxV2CutoverProjectionGenerationInputSchema.safeParse({
        ...input,
        candidateGeneration: "1"
      }).success
    ).toBe(false);
    expect(
      inboxV2CutoverProjectionGenerationInputSchema.safeParse({
        ...input,
        expectedCandidateCheckpoint: "9"
      }).success
    ).toBe(false);
    expect(
      inboxV2CutoverProjectionGenerationResultSchema.safeParse({
        outcome: "candidate_not_ready",
        currentCheckpoint: "9",
        requiredThroughPosition: "10"
      }).success
    ).toBe(true);
    expect(
      inboxV2CutoverProjectionGenerationResultSchema.safeParse({
        outcome: "candidate_not_ready",
        currentCheckpoint: "10",
        requiredThroughPosition: "10"
      }).success
    ).toBe(false);
  });
});

function retainedPrefixState() {
  return {
    tenantId,
    owner: { kind: "tenant_stream", streamEpoch },
    minRetainedPosition: "5",
    headPosition: "10",
    revision: "2",
    updatedAt: expiresAt
  };
}

function leasedWork(forTenant = tenantId) {
  return {
    tenantId: forTenant,
    intentId: "outbox-intent:intent-1",
    state: "leased",
    attemptCount: "1",
    availableAt: initializedAt,
    lease: {
      workerId,
      leaseTokenHash: calculateInboxV2OutboxLeaseTokenHash(leaseToken),
      leaseRevision: "1",
      claimedAt,
      expiresAt
    },
    lastRetryResult: null,
    terminalResult: null,
    revision: "2",
    updatedAt: claimedAt
  };
}

function pendingRetryWork() {
  return {
    tenantId,
    intentId: "outbox-intent:intent-1",
    state: "pending",
    attemptCount: "1",
    availableAt: retryAt,
    lease: null,
    lastRetryResult: {
      kind: "retry",
      resultHash: hashB,
      errorCode: "core:outbox.retryable",
      retryAvailableAt: retryAt,
      recordedAt: expiresAt
    },
    terminalResult: null,
    revision: "3",
    updatedAt: expiresAt
  };
}

function terminalWork(state: "processed" | "dead") {
  return {
    tenantId,
    intentId: "outbox-intent:intent-1",
    state,
    attemptCount: "1",
    availableAt: null,
    lease: null,
    lastRetryResult: null,
    terminalResult:
      state === "processed"
        ? {
            kind: "processed",
            resultHash: hashB,
            resultReference: payloadReference(),
            finalizedAt: expiresAt
          }
        : {
            kind: "dead",
            resultHash: hashB,
            errorCode: "core:outbox.terminal",
            resultReference: null,
            finalizedAt: expiresAt
          },
    revision: "3",
    updatedAt: expiresAt
  };
}

describe("Inbox V2 repository foundation retained prefix", () => {
  it("uses monotonic revision CAS and cannot pass the mandatory checkpoint", () => {
    const input = {
      context: { tenantId },
      owner: { kind: "tenant_stream", streamEpoch },
      expectedRevision: "1",
      expectedMinRetainedPosition: "0",
      nextMinRetainedPosition: "5",
      mandatoryCheckpointFloor: "5",
      changedAt: expiresAt
    };
    expect(
      inboxV2CompareAndSetRetainedPrefixInputSchema.safeParse(input).success
    ).toBe(true);
    expect(
      inboxV2CompareAndSetRetainedPrefixInputSchema.safeParse({
        ...input,
        nextMinRetainedPosition: "0"
      }).success
    ).toBe(false);
    expect(
      inboxV2CompareAndSetRetainedPrefixInputSchema.safeParse({
        ...input,
        nextMinRetainedPosition: "6"
      }).success
    ).toBe(false);
    expect(
      inboxV2RetainedPrefixStateSchema.safeParse(retainedPrefixState()).success
    ).toBe(true);
    expect(
      inboxV2RetainedPrefixEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.repository-retained-prefix",
        schemaVersion: "v1",
        payload: retainedPrefixState()
      }).success
    ).toBe(true);
    expect(
      inboxV2RetainedPrefixStateSchema.safeParse({
        ...retainedPrefixState(),
        minRetainedPosition: "11"
      }).success
    ).toBe(false);
  });

  it("types idempotent, conflict, checkpoint-blocked and missing CAS results", () => {
    for (const outcome of [
      "advanced",
      "already_applied",
      "conflict"
    ] as const) {
      expect(
        inboxV2CompareAndSetRetainedPrefixResultSchema.safeParse({
          outcome,
          current: retainedPrefixState()
        }).success
      ).toBe(true);
    }
    expect(
      inboxV2CompareAndSetRetainedPrefixResultSchema.safeParse({
        outcome: "checkpoint_blocked",
        current: retainedPrefixState(),
        mandatoryCheckpointFloor: "5"
      }).success
    ).toBe(true);
    expect(
      inboxV2CompareAndSetRetainedPrefixResultSchema.safeParse({
        outcome: "not_found",
        tenantId,
        owner: {
          kind: "projection_generation",
          projectionId,
          scopeId,
          streamEpoch,
          syncGeneration: "2"
        }
      }).success
    ).toBe(true);
  });
});

describe("Inbox V2 repository foundation token-fenced outbox", () => {
  it("stores only a deterministic digest and rejects raw token fields", () => {
    const digest = calculateInboxV2OutboxLeaseTokenHash(leaseToken);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(calculateInboxV2OutboxLeaseTokenHash(leaseToken)).toBe(digest);
    expect(inboxV2OutboxWorkItemSchema.safeParse(leasedWork()).success).toBe(
      true
    );
    expect(
      inboxV2OutboxWorkItemSchema.safeParse({
        ...leasedWork(),
        lease: { ...leasedWork().lease, leaseToken }
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboxWorkItemEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.repository-outbox-work-item",
        schemaVersion: "v1",
        payload: leasedWork()
      }).success
    ).toBe(true);
  });

  it("enforces coherent pending, leased, processed and dead work states", () => {
    expect(
      inboxV2OutboxWorkItemSchema.safeParse(pendingRetryWork()).success
    ).toBe(true);
    expect(
      inboxV2OutboxWorkItemSchema.safeParse(terminalWork("processed")).success
    ).toBe(true);
    expect(
      inboxV2OutboxWorkItemSchema.safeParse(terminalWork("dead")).success
    ).toBe(true);
    expect(
      inboxV2OutboxWorkItemSchema.safeParse({
        ...leasedWork(),
        lease: null
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboxWorkItemSchema.safeParse({
        ...terminalWork("processed"),
        availableAt: retryAt
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboxWorkItemSchema.safeParse({
        ...terminalWork("processed"),
        terminalResult: {
          ...terminalWork("processed").terminalResult,
          resultReference: payloadReference(otherTenantId)
        }
      }).success
    ).toBe(false);
  });

  it("returns transient claim capabilities bound to tenant, worker and digest", () => {
    const claim = { claimKind: "initial", work: leasedWork(), leaseToken };
    expect(inboxV2OutboxClaimSchema.safeParse(claim).success).toBe(true);
    expect(
      inboxV2OutboxClaimSchema.safeParse({
        ...claim,
        leaseToken: `lease-token-${"b".repeat(32)}`
      }).success
    ).toBe(false);
    expect(
      inboxV2ClaimOutboxResultSchema.safeParse({
        outcome: "claimed",
        tenantId,
        workerId,
        batchSize: 1,
        claims: [claim]
      }).success
    ).toBe(true);
    expect(
      inboxV2ClaimOutboxResultSchema.safeParse({
        outcome: "claimed",
        tenantId: otherTenantId,
        workerId,
        batchSize: 1,
        claims: [claim]
      }).success
    ).toBe(false);
    expect(
      inboxV2ClaimOutboxResultSchema.safeParse({
        outcome: "claimed",
        tenantId,
        workerId,
        batchSize: 2,
        claims: [claim, claim]
      }).success
    ).toBe(false);
    const secondToken = `lease-token-${"b".repeat(32)}`;
    const secondClaim = {
      claimKind: "reclaimed",
      leaseToken: secondToken,
      work: {
        ...leasedWork(),
        intentId: "outbox-intent:intent-2",
        lease: {
          ...leasedWork().lease,
          leaseTokenHash: calculateInboxV2OutboxLeaseTokenHash(secondToken)
        }
      }
    };
    expect(
      inboxV2ClaimOutboxResultSchema.safeParse({
        outcome: "claimed",
        tenantId,
        workerId,
        batchSize: 1,
        claims: [claim, secondClaim]
      }).success
    ).toBe(false);
  });

  it("types renewal fencing including stale-token and expired-lease outcomes", () => {
    const input = {
      context: { tenantId },
      intentId: "outbox-intent:intent-1",
      workerId,
      leaseToken,
      expectedLeaseRevision: "1",
      leaseDurationSeconds: 30
    };
    expect(inboxV2RenewOutboxLeaseInputSchema.safeParse(input).success).toBe(
      true
    );
    expect(
      inboxV2RenewOutboxLeaseInputSchema.safeParse({
        ...input,
        leaseToken: "short"
      }).success
    ).toBe(false);
    expect(
      inboxV2RenewOutboxLeaseResultSchema.safeParse({
        outcome: "renewed",
        work: leasedWork()
      }).success
    ).toBe(true);
    for (const outcome of [
      "stale_token",
      "lease_expired",
      "lease_revision_conflict"
    ] as const) {
      expect(
        inboxV2RenewOutboxLeaseResultSchema.safeParse({
          outcome,
          tenantId,
          intentId: "outbox-intent:intent-1",
          currentLeaseRevision: "2"
        }).success
      ).toBe(true);
    }
    expect(
      inboxV2RenewOutboxLeaseResultSchema.safeParse({
        outcome: "stale_token",
        tenantId,
        intentId: "outbox-intent:intent-1",
        currentLeaseRevision: "2",
        currentLeaseTokenHash: hashA
      }).success
    ).toBe(false);
  });

  it("fences retry, processed and dead finalization and preserves strict result hashes", () => {
    const base = {
      context: { tenantId },
      intentId: "outbox-intent:intent-1",
      workerId,
      leaseToken,
      expectedLeaseRevision: "1"
    };
    expect(
      inboxV2FinalizeOutboxInputSchema.safeParse({
        ...base,
        instruction: {
          kind: "retry",
          resultHash: hashB,
          errorCode: "core:outbox.retryable",
          retryAfterSeconds: 60
        }
      }).success
    ).toBe(true);
    expect(
      inboxV2FinalizeOutboxInputSchema.safeParse({
        ...base,
        instruction: {
          kind: "processed",
          resultHash: hashB,
          resultReference: payloadReference(otherTenantId)
        }
      }).success
    ).toBe(false);

    for (const result of [
      { outcome: "retry_scheduled", work: pendingRetryWork() },
      { outcome: "processed", work: terminalWork("processed") },
      { outcome: "dead", work: terminalWork("dead") },
      { outcome: "already_finalized", work: terminalWork("processed") },
      {
        outcome: "stale_token",
        tenantId,
        intentId: "outbox-intent:intent-1",
        currentLeaseRevision: "2"
      }
    ]) {
      expect(inboxV2FinalizeOutboxResultSchema.safeParse(result).success).toBe(
        true
      );
    }
    expect(
      inboxV2FinalizeOutboxResultSchema.safeParse({
        outcome: "processed",
        work: terminalWork("dead")
      }).success
    ).toBe(false);
  });
});
