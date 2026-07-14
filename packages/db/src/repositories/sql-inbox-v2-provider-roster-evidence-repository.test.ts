import {
  inboxV2ProviderRosterMaterializationCommitSchema,
  type InboxV2ProviderRosterMaterializationCommit,
  type InboxV2ProviderRosterMemberEvidence,
  type InboxV2SourceExternalIdentityId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildFindInboxV2ProviderRosterEvidenceByIdSql,
  buildFindInboxV2ProviderRosterMemberIdsSql,
  buildInsertInboxV2ProviderRosterMemberBatchesSql,
  buildInsertInboxV2ProviderRosterMemberBatchSql,
  buildListInboxV2ProviderRosterMembersSql,
  buildLockInboxV2ProviderRosterBindingSql,
  buildLockInboxV2ProviderRosterObservationSql,
  buildLockInboxV2ProviderRosterSourceIdentitiesSql,
  buildLockInboxV2ProviderRosterSourceIdentityBatchesSql,
  canonicalizeInboxV2ProviderRosterMembers,
  computeInboxV2ProviderRosterMemberDigest,
  createSqlInboxV2ProviderRosterEvidenceRepository,
  INBOX_V2_PROVIDER_ROSTER_IDENTITY_LOCK_BATCH_SIZE,
  INBOX_V2_PROVIDER_ROSTER_MEMBER_INSERT_BATCH_SIZE,
  orderInboxV2ProviderRosterMemberEvidenceIdsForLock,
  type InboxV2ProviderRosterEvidenceTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-provider-roster-evidence-repository";

const tenantId = "tenant:tenant-1";
const t0 = "2026-07-11T09:00:00.000Z";
const observedAt = "2026-07-11T09:01:00.000Z";
const materializedAt = "2026-07-11T09:02:00.000Z";

const adapterContract = {
  contractId: "module:synthetic-source:direct-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:group-surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

function reference(kind: string, id: string) {
  return { tenantId, kind, id };
}

const externalThreadReference = reference(
  "external_thread",
  "external_thread:thread-1"
);
const sourceConnectionReference = reference(
  "source_connection",
  "source_connection:connection-1"
);
const sourceAccountReference = reference(
  "source_account",
  "source_account:account-1"
);
const sourceThreadBindingReference = reference(
  "source_thread_binding",
  "source_thread_binding:binding-1"
);
const rawEventReference = reference(
  "raw_inbound_event",
  "raw_inbound_event:roster-1"
);

function binding() {
  return {
    tenantId,
    id: sourceThreadBindingReference.id,
    externalThread: externalThreadReference,
    sourceConnection: sourceConnectionReference,
    sourceAccount: sourceAccountReference,
    accountIdentitySnapshot: {
      status: "verified" as const,
      sourceConnection: sourceConnectionReference,
      sourceAccount: sourceAccountReference,
      declaration: {
        adapterContract,
        identityKind: "source_account" as const,
        realmId: "module:synthetic-source:account-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1",
        objectKindId: "module:synthetic-source:user-account",
        scopeKind: "source_connection" as const,
        decisionStrength: "authoritative" as const
      },
      realmId: "module:synthetic-source:account-realm",
      canonicalExternalSubject: "ProviderAccount:ABC",
      accountGeneration: "1",
      verificationEvidence: [rawEventReference],
      verifiedAt: t0
    },
    bindingGeneration: "1",
    remoteAccess: {
      state: "active" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: "1",
      since: t0,
      evidence: [rawEventReference]
    },
    administrative: {
      state: "enabled" as const,
      revision: "1",
      changedAt: t0
    },
    runtimeHealth: {
      state: "ready" as const,
      revision: "1",
      checkedAt: t0,
      diagnostic: null
    },
    historySync: {
      state: "live" as const,
      revision: "1",
      receiveCursor: "receive-cursor-1",
      historyCursor: "history-cursor-1",
      providerWatermark: "watermark-1",
      lastDurableRawEvent: rawEventReference,
      updatedAt: t0,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: ["module:synthetic-source:provider-member"],
      evidence: [rawEventReference],
      observedAt: t0
    },
    capabilities: {
      adapterContract,
      revision: "1",
      capturedAt: t0,
      entries: []
    },
    routeDescriptor: {
      adapterContract,
      descriptorSchemaId: "module:synthetic-source:group-route",
      descriptorVersion: "v1",
      descriptorRevision: "1",
      destinationKindId: "module:synthetic-source:group-peer",
      destinationSubject: "GroupABC",
      attributes: [],
      descriptorDigestSha256: "a".repeat(64)
    },
    revision: "3",
    createdAt: t0,
    updatedAt: observedAt
  };
}

function currentBindingProjection() {
  const current = binding();
  return {
    binding: current,
    currentRemoteAccessEpisode: {
      tenantId,
      id: "source_thread_binding_remote_access_episode:episode-1",
      binding: sourceThreadBindingReference,
      state: current.remoteAccess.state,
      startedAt: current.remoteAccess.since,
      endedAt: null,
      startEvidence: current.remoteAccess.evidence,
      endEvidence: [],
      revision: "1",
      createdAt: t0,
      updatedAt: t0
    }
  };
}

function rosterMember(
  index: number,
  sourceIdentityIndex = index
): InboxV2ProviderRosterMemberEvidence {
  return {
    tenantId,
    id: `provider_roster_member_evidence:member-${index}`,
    rosterEvidence: reference(
      "provider_roster_evidence",
      "provider_roster_evidence:roster-1"
    ),
    sourceExternalIdentity: reference(
      "source_external_identity",
      `source_external_identity:identity-${sourceIdentityIndex}`
    ),
    state: "present",
    normalizedRole: index === 1 ? "admin" : "member",
    providerStateCode: "present",
    providerRoleCode: index === 1 ? "administrator" : "participant",
    observedAt,
    revision: "1"
  } as InboxV2ProviderRosterMemberEvidence;
}

function materializationCommit(
  members: readonly InboxV2ProviderRosterMemberEvidence[] = [rosterMember(1)]
): InboxV2ProviderRosterMaterializationCommit {
  return inboxV2ProviderRosterMaterializationCommitSchema.parse({
    tenantId,
    evidence: {
      tenantId,
      id: "provider_roster_evidence:roster-1",
      sourceThreadBinding: sourceThreadBindingReference,
      observation: rawEventReference,
      adapterContractVersion: adapterContract.contractVersion,
      completeness: "complete",
      authority: "authoritative",
      omissionPolicy: "close_missing",
      ordering: {
        kind: "adapter_monotonic",
        scopeToken: "roster-scope:binding-1",
        comparatorId: "module:synthetic-source:roster-sequence",
        comparatorRevision: "1",
        position: "1"
      },
      observedAt,
      watermark: "provider-watermark-1",
      revision: "1"
    },
    members,
    currentBindingProjection: currentBindingProjection(),
    authority: {
      kind: "trusted_service",
      trustedServiceId: adapterContract.loadedByTrustedServiceId,
      authorizationToken: "authorization:provider-roster-1",
      authorizedAt: materializedAt
    },
    materializedAt
  });
}

describe("SQL Inbox V2 provider roster evidence repository", () => {
  it("builds tenant-scoped locks in binding, observation and UTF-8 identity order", () => {
    const commit = materializationCommit();
    const bindingLock = renderQuery(
      buildLockInboxV2ProviderRosterBindingSql(commit as never)
    );
    const observationLock = renderQuery(
      buildLockInboxV2ProviderRosterObservationSql(commit as never)
    );
    const identityLock = renderQuery(
      buildLockInboxV2ProviderRosterSourceIdentitiesSql({
        tenantId: commit.tenantId,
        sourceExternalIdentityIds: [
          commit.members[0]?.sourceExternalIdentity
            .id as InboxV2SourceExternalIdentityId
        ]
      })
    );
    const aggregateRead = renderQuery(
      buildFindInboxV2ProviderRosterEvidenceByIdSql({
        tenantId: commit.tenantId,
        evidenceId: commit.evidence.id
      })
    );
    const memberRead = renderQuery(
      buildListInboxV2ProviderRosterMembersSql({
        tenantId: commit.tenantId,
        evidenceId: commit.evidence.id
      })
    );
    const memberIdRead = renderQuery(
      buildFindInboxV2ProviderRosterMemberIdsSql({
        tenantId: commit.tenantId,
        memberEvidenceIds: [commit.members[0]?.id as never]
      })
    );

    for (const query of [
      bindingLock,
      observationLock,
      identityLock,
      aggregateRead,
      memberRead,
      memberIdRead
    ]) {
      expect(query.sql).toContain("tenant_id = $1");
      expect(query.params[0]).toBe(tenantId);
    }
    expect(normalizeSql(bindingLock.sql)).toContain(
      "with head as materialized"
    );
    expect(normalizeSql(bindingLock.sql)).toContain(
      "exact_snapshot as materialized"
    );
    expect(normalizeSql(bindingLock.sql).match(/for share/gu)).toHaveLength(2);
    expect(normalizeSql(observationLock.sql)).toContain("for share");
    expect(normalizeSql(identityLock.sql)).toContain(
      "order by convert_to(id, 'utf8') for share"
    );
    expect(normalizeSql(memberIdRead.sql)).toContain(
      "order by convert_to(id, 'utf8') for share"
    );
    expect(normalizeSql(memberRead.sql)).toContain("order by ordinal");
  });

  it("bounds 50k identity locks and member inserts below PostgreSQL's parameter limit", () => {
    const ids = Array.from(
      { length: 50_000 },
      (_, index) =>
        `source_external_identity:identity-${String(index).padStart(5, "0")}` as InboxV2SourceExternalIdentityId
    );
    const identityBatches =
      buildLockInboxV2ProviderRosterSourceIdentityBatchesSql({
        tenantId: tenantId as never,
        sourceExternalIdentityIds: ids
      });

    expect(INBOX_V2_PROVIDER_ROSTER_IDENTITY_LOCK_BATCH_SIZE).toBe(2_000);
    expect(identityBatches).toHaveLength(25);
    expect(renderQuery(identityBatches[0] as SQL).params).toHaveLength(2_001);
    expect(renderQuery(identityBatches[24] as SQL).params).toHaveLength(2_001);

    const records = Array.from({ length: 2_001 }, (_, index) =>
      memberPersistenceRecord(index)
    );
    const memberBatches =
      buildInsertInboxV2ProviderRosterMemberBatchesSql(records);
    expect(INBOX_V2_PROVIDER_ROSTER_MEMBER_INSERT_BATCH_SIZE).toBe(1_000);
    expect(
      Math.ceil(50_000 / INBOX_V2_PROVIDER_ROSTER_MEMBER_INSERT_BATCH_SIZE)
    ).toBe(50);
    expect(memberBatches).toHaveLength(3);
    expect(
      Math.max(
        ...memberBatches.map((query) => renderQuery(query).params.length)
      )
    ).toBe(19_000);
    expect(() =>
      buildInsertInboxV2ProviderRosterMemberBatchSql(records.slice(0, 1_001))
    ).toThrow(/exceeds its bound/u);
  });

  it("canonicalizes by UTF-8 identity ID and produces a permutation-stable schema digest", () => {
    const members = [rosterMember(2, 2), rosterMember(1, 10)];
    const revisions = new Map([
      [String(members[0]?.sourceExternalIdentity.id), 7n],
      [String(members[1]?.sourceExternalIdentity.id), 3n]
    ]);
    const canonical = canonicalizeInboxV2ProviderRosterMembers(
      members,
      revisions
    );
    const reversed = canonicalizeInboxV2ProviderRosterMembers(
      [...members].reverse(),
      revisions
    );

    expect(
      canonical.map(({ member }) => member.sourceExternalIdentity.id)
    ).toEqual([
      "source_external_identity:identity-10",
      "source_external_identity:identity-2"
    ]);
    expect(canonical.map(({ ordinal }) => ordinal)).toEqual([0, 1]);
    expect(computeInboxV2ProviderRosterMemberDigest(canonical)).toBe(
      computeInboxV2ProviderRosterMemberDigest(reversed)
    );
    expect(computeInboxV2ProviderRosterMemberDigest(canonical)).toBe(
      "342d7fc00b6e67d43c8e61f9b6ef88ee1f73d26c1419541eb12d9747af8beaf0"
    );
  });

  it("orders member-ID lock batches by member ID, not by competing identity mappings", () => {
    const member20 = {
      ...rosterMember(20, 1),
      id: "provider_roster_member_evidence:member-20"
    } as InboxV2ProviderRosterMemberEvidence;
    const member10 = {
      ...rosterMember(10, 2),
      id: "provider_roster_member_evidence:member-10"
    } as InboxV2ProviderRosterMemberEvidence;

    expect(
      orderInboxV2ProviderRosterMemberEvidenceIdsForLock([member20, member10])
    ).toEqual([
      "provider_roster_member_evidence:member-10",
      "provider_roster_member_evidence:member-20"
    ]);
    expect(
      orderInboxV2ProviderRosterMemberEvidenceIdsForLock([member10, member20])
    ).toEqual([
      "provider_roster_member_evidence:member-10",
      "provider_roster_member_evidence:member-20"
    ]);
  });

  it("materializes one immutable aggregate without membership/RBAC side effects", async () => {
    const commit = materializationCommit([
      rosterMember(2, 2),
      rosterMember(1, 10)
    ]);
    const executor = new ScriptedRosterExecutor(commit);

    await expect(
      createSqlInboxV2ProviderRosterEvidenceRepository(executor).materialize(
        commit
      )
    ).resolves.toEqual({
      kind: "materialized",
      evidence: commit.evidence,
      members: [commit.members[1], commit.members[0]]
    });
    expect(executor.transactionStatements).toEqual([
      "binding",
      "observation",
      "identities",
      "member_ids",
      "insert_roster",
      "insert_members"
    ]);
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "read committed" }
    ]);
    expect(executor.executedSql.join(" ")).not.toMatch(
      /participant_membership|responsibility|rbac|notification/iu
    );
  });

  it("accepts provider-scoped roster members on the exact binding adapter surface", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedRosterExecutor(commit, {
      providerScope: true
    });

    await expect(
      createSqlInboxV2ProviderRosterEvidenceRepository(executor).materialize(
        commit
      )
    ).resolves.toMatchObject({ kind: "materialized" });
  });

  it.each(["contract", "version", "surface", "service"] as const)(
    "keeps provider scope fail-closed for a mismatched identity %s",
    async (providerSurfaceMismatch) => {
      const commit = materializationCommit();
      const executor = new ScriptedRosterExecutor(commit, {
        providerScope: true,
        providerSurfaceMismatch
      });

      await expect(
        createSqlInboxV2ProviderRosterEvidenceRepository(executor).materialize(
          commit
        )
      ).resolves.toEqual({
        kind: "member_identity_provider_scope_unproven",
        sourceExternalIdentityId: "source_external_identity:identity-1"
      });
    }
  );

  it("rejects extra commands before any database call", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedRosterExecutor(commit);

    await expect(
      createSqlInboxV2ProviderRosterEvidenceRepository(executor).materialize({
        ...commit,
        membershipCommands: []
      } as unknown as InboxV2ProviderRosterMaterializationCommit)
    ).rejects.toBeTruthy();
    expect(executor.executeCount).toBe(0);
    expect(executor.transactionCount).toBe(0);
  });

  it.each([
    ["bindingMissing", { kind: "binding_not_found" }],
    ["snapshotMissing", { kind: "binding_snapshot_conflict" }],
    ["adapterMismatch", { kind: "adapter_surface_conflict" }],
    ["capabilityMismatch", { kind: "capability_revision_conflict" }],
    ["authorityMismatch", { kind: "authority_conflict" }],
    [
      "observationMissing",
      { kind: "observation_not_found", observationKind: "raw_inbound_event" }
    ],
    [
      "observationScope",
      {
        kind: "observation_scope_conflict",
        observationKind: "raw_inbound_event"
      }
    ],
    [
      "identityMissing",
      {
        kind: "member_identity_not_found",
        sourceExternalIdentityId: "source_external_identity:identity-1"
      }
    ],
    [
      "identityScope",
      {
        kind: "member_identity_scope_conflict",
        sourceExternalIdentityId: "source_external_identity:identity-1"
      }
    ],
    [
      "identityProvider",
      {
        kind: "member_identity_provider_scope_unproven",
        sourceExternalIdentityId: "source_external_identity:identity-1"
      }
    ]
  ] as const)(
    "returns typed %s outcome without writes",
    async (failure, expected) => {
      const commit = materializationCommit();
      const executor = new ScriptedRosterExecutor(commit, { failure });

      await expect(
        createSqlInboxV2ProviderRosterEvidenceRepository(executor).materialize(
          commit
        )
      ).resolves.toEqual(expected);
      expect(executor.transactionStatements).not.toContain("insert_roster");
      expect(executor.transactionStatements).not.toContain("insert_members");
    }
  );

  it("treats an equal aggregate as idempotent and a changed aggregate as a typed conflict", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedRosterExecutor(commit);
    const repository =
      createSqlInboxV2ProviderRosterEvidenceRepository(executor);

    await expect(repository.materialize(commit)).resolves.toMatchObject({
      kind: "materialized"
    });
    await expect(repository.materialize(commit)).resolves.toEqual({
      kind: "already_materialized",
      evidence: commit.evidence,
      members: commit.members
    });
    expect(executor.transactionCount).toBe(1);

    executor.changePersistedRoster("watermark", "different-watermark");
    await expect(repository.materialize(commit)).resolves.toEqual({
      kind: "roster_evidence_id_conflict",
      evidenceId: commit.evidence.id
    });
    expect(executor.transactionCount).toBe(1);
  });

  it("rechecks the root when a READ COMMITTED member lookup observes the same aggregate", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedRosterExecutor(commit);
    const repository =
      createSqlInboxV2ProviderRosterEvidenceRepository(executor);

    await expect(repository.materialize(commit)).resolves.toMatchObject({
      kind: "materialized"
    });
    executor.hideExistingRosterUntilMemberLookup();

    await expect(repository.materialize(commit)).resolves.toEqual({
      kind: "already_materialized",
      evidence: commit.evidence,
      members: commit.members
    });
    expect(executor.transactionCount).toBe(2);
    expect(
      executor.transactionStatements.filter(
        (statement) => statement === "insert_roster"
      )
    ).toHaveLength(1);
  });

  it("materializes and replays an empty sealed roster without member writes", async () => {
    const commit = materializationCommit([]);
    const executor = new ScriptedRosterExecutor(commit);
    const repository =
      createSqlInboxV2ProviderRosterEvidenceRepository(executor);

    await expect(repository.materialize(commit)).resolves.toEqual({
      kind: "materialized",
      evidence: commit.evidence,
      members: []
    });
    await expect(repository.materialize(commit)).resolves.toEqual({
      kind: "already_materialized",
      evidence: commit.evidence,
      members: []
    });
    expect(executor.transactionStatements).not.toContain("insert_members");
  });

  it("retries only serialization/deadlock SQLSTATEs, at most three times", async () => {
    const commit = materializationCommit();
    const retrying = new ScriptedRosterExecutor(commit, {
      transactionFailures: ["40001", "40P01"]
    });

    await expect(
      createSqlInboxV2ProviderRosterEvidenceRepository(retrying).materialize(
        commit
      )
    ).resolves.toMatchObject({ kind: "materialized" });
    expect(retrying.transactionCount).toBe(3);
    expect(retrying.transactionConfigs).toEqual([
      { isolationLevel: "read committed" },
      { isolationLevel: "read committed" },
      { isolationLevel: "read committed" }
    ]);

    const exhausted = new ScriptedRosterExecutor(commit, {
      transactionFailures: ["40001", "40001", "40001", "40001"]
    });
    await expect(
      createSqlInboxV2ProviderRosterEvidenceRepository(exhausted).materialize(
        commit
      )
    ).rejects.toMatchObject({ code: "40001" });
    expect(exhausted.transactionCount).toBe(3);

    const nonRetryable = new ScriptedRosterExecutor(commit, {
      transactionFailures: ["55P03"]
    });
    await expect(
      createSqlInboxV2ProviderRosterEvidenceRepository(
        nonRetryable
      ).materialize(commit)
    ).rejects.toMatchObject({ code: "55P03" });
    expect(nonRetryable.transactionCount).toBe(1);
  });

  it("maps a concurrent 23505 member collision to its typed member ID", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedRosterExecutor(commit, {
      uniqueMemberConflict: true
    });

    await expect(
      createSqlInboxV2ProviderRosterEvidenceRepository(executor).materialize(
        commit
      )
    ).resolves.toEqual({
      kind: "roster_member_evidence_id_conflict",
      memberEvidenceId: commit.members[0]?.id
    });
    expect(executor.transactionCount).toBe(1);
    expect(executor.persistedRoster).toBeNull();
  });
});

type FailureKind =
  | "bindingMissing"
  | "snapshotMissing"
  | "adapterMismatch"
  | "capabilityMismatch"
  | "authorityMismatch"
  | "observationMissing"
  | "observationScope"
  | "identityMissing"
  | "identityScope"
  | "identityProvider";

type ExecutorOptions = Readonly<{
  failure?: FailureKind;
  transactionFailures?: readonly string[];
  uniqueMemberConflict?: boolean;
  providerScope?: boolean;
  providerSurfaceMismatch?: "contract" | "version" | "surface" | "service";
}>;

class ScriptedRosterExecutor implements InboxV2ProviderRosterEvidenceTransactionExecutor {
  executeCount = 0;
  transactionCount = 0;
  transactionStatements: string[] = [];
  transactionConfigs: Array<Readonly<{ isolationLevel: "read committed" }>> =
    [];
  executedSql: string[] = [];
  private inTransaction = false;
  private rosterRow: Record<string, unknown> | null = null;
  private memberRows: Record<string, unknown>[] = [];
  private readonly transactionFailures: string[];
  private memberIdLookupCount = 0;
  private hideRosterUntilMemberLookup = false;
  private memberLookupReleasedRoster = false;

  constructor(
    private readonly commit: InboxV2ProviderRosterMaterializationCommit,
    private readonly options: ExecutorOptions = {}
  ) {
    this.transactionFailures = [...(options.transactionFailures ?? [])];
  }

  get persistedRoster(): Readonly<Record<string, unknown>> | null {
    return this.rosterRow;
  }

  changePersistedRoster(field: string, value: unknown): void {
    if (this.rosterRow === null) throw new Error("Roster is not persisted.");
    this.rosterRow[field] = value;
  }

  hideExistingRosterUntilMemberLookup(): void {
    if (this.rosterRow === null || this.memberRows.length === 0) {
      throw new Error(
        "A non-empty roster must exist before simulating the race."
      );
    }
    this.hideRosterUntilMemberLookup = true;
    this.memberLookupReleasedRoster = false;
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionCount += 1;
    this.transactionConfigs.push(config);
    const failure = this.transactionFailures.shift();
    if (failure !== undefined) {
      throw Object.assign(new Error(`transaction ${failure}`), {
        code: failure
      });
    }

    const rosterBefore = this.rosterRow;
    const membersBefore = this.memberRows;
    this.inTransaction = true;
    try {
      return await work(this);
    } catch (error) {
      this.rosterRow = rosterBefore;
      this.memberRows = membersBefore;
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.executeCount += 1;
    const rendered = renderQuery(query);
    const statement = normalizeSql(rendered.sql);
    this.executedSql.push(statement);

    if (
      statement.startsWith("select * from inbox_v2_provider_roster_evidence")
    ) {
      if (
        this.hideRosterUntilMemberLookup &&
        !this.memberLookupReleasedRoster
      ) {
        return rowsResult([]);
      }
      return rowsResult(this.rosterRow === null ? [] : [this.rosterRow]);
    }
    if (
      statement.startsWith(
        "select * from inbox_v2_provider_roster_member_evidence"
      )
    ) {
      return rowsResult(
        [...this.memberRows].sort(
          (left, right) => Number(left.ordinal) - Number(right.ordinal)
        )
      );
    }
    if (
      statement.startsWith(
        "select id, roster_evidence_id, source_external_identity_id from inbox_v2_provider_roster_member_evidence"
      )
    ) {
      this.record("member_ids");
      this.memberIdLookupCount += 1;
      if (this.hideRosterUntilMemberLookup) {
        this.memberLookupReleasedRoster = true;
        return rowsResult(
          this.memberRows.map((row) => ({
            id: row.id,
            roster_evidence_id: row.roster_evidence_id,
            source_external_identity_id: row.source_external_identity_id
          }))
        );
      }
      if (
        this.options.uniqueMemberConflict === true &&
        this.memberIdLookupCount > 1
      ) {
        const member = this.commit.members[0];
        return rowsResult([
          {
            id: member?.id,
            roster_evidence_id: "provider_roster_evidence:other",
            source_external_identity_id: member?.sourceExternalIdentity.id
          }
        ]);
      }
      return rowsResult([]);
    }
    if (statement.includes("from inbox_v2_source_thread_binding_heads")) {
      this.record("binding");
      if (this.options.failure === "bindingMissing") return rowsResult([]);
      const row: Record<string, unknown> = bindingRow(this.commit);
      if (this.options.failure === "snapshotMissing") {
        row.snapshot_binding_id = null;
      } else if (this.options.failure === "adapterMismatch") {
        row.capability_contract_version = "v2";
      } else if (this.options.failure === "capabilityMismatch") {
        row.capability_revision = "2";
      } else if (this.options.failure === "authorityMismatch") {
        row.capability_loaded_by_trusted_service_id = "core:other-runtime";
        row.snapshot_capability_loaded_by_trusted_service_id =
          "core:other-runtime";
      }
      return rowsResult([row]);
    }
    if (statement.includes("from raw_inbound_events")) {
      this.record("observation");
      if (this.options.failure === "observationMissing") return rowsResult([]);
      return rowsResult([
        observationRow(this.commit, this.options.failure === "observationScope")
      ]);
    }
    if (statement.includes("from inbox_v2_source_external_identities")) {
      this.record("identities");
      if (this.options.failure === "identityMissing") return rowsResult([]);
      return rowsResult(
        [...this.commit.members]
          .sort((left, right) =>
            Buffer.compare(
              Buffer.from(String(left.sourceExternalIdentity.id), "utf8"),
              Buffer.from(String(right.sourceExternalIdentity.id), "utf8")
            )
          )
          .map((member, index) =>
            identityRow(
              this.commit,
              member,
              index,
              this.options.failure,
              this.options.providerScope === true,
              this.options.providerSurfaceMismatch
            )
          )
      );
    }
    if (statement.startsWith("insert into inbox_v2_provider_roster_evidence")) {
      this.record("insert_roster");
      this.rosterRow = Object.fromEntries(
        ROSTER_INSERT_COLUMNS.map((column, index) => [
          column,
          rendered.params[index]
        ])
      );
      return rowsResult([{ id: this.commit.evidence.id }]);
    }
    if (
      statement.startsWith(
        "insert into inbox_v2_provider_roster_member_evidence"
      )
    ) {
      this.record("insert_members");
      if (this.options.uniqueMemberConflict === true) {
        throw Object.assign(new Error("duplicate member ID"), {
          code: "23505"
        });
      }
      const width = MEMBER_INSERT_COLUMNS.length;
      const batchRows = Array.from(
        { length: rendered.params.length / width },
        (_, rowIndex) =>
          Object.fromEntries(
            MEMBER_INSERT_COLUMNS.map((column, columnIndex) => [
              column,
              rendered.params[rowIndex * width + columnIndex]
            ])
          )
      );
      this.memberRows.push(...batchRows);
      return rowsResult(batchRows.map((row) => ({ id: row.id })));
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  }

  private record(kind: string): void {
    if (this.inTransaction) this.transactionStatements.push(kind);
  }
}

function bindingRow(commit: InboxV2ProviderRosterMaterializationCommit) {
  const current = commit.currentBindingProjection.binding;
  const capability = current.capabilities.adapterContract;
  return {
    binding_id: current.id,
    external_thread_id: current.externalThread.id,
    source_connection_id: current.sourceConnection.id,
    source_account_id: current.sourceAccount.id,
    binding_revision: current.revision,
    binding_generation: current.bindingGeneration,
    capability_contract_id: capability.contractId,
    capability_contract_version: capability.contractVersion,
    capability_declaration_revision: capability.declarationRevision,
    capability_surface_id: capability.surfaceId,
    capability_loaded_by_trusted_service_id:
      capability.loadedByTrustedServiceId,
    capability_loaded_at: capability.loadedAt,
    capability_revision: current.capabilities.revision,
    created_at: current.createdAt,
    updated_at: current.updatedAt,
    snapshot_binding_id: current.id,
    snapshot_external_thread_id: current.externalThread.id,
    snapshot_source_connection_id: current.sourceConnection.id,
    snapshot_source_account_id: current.sourceAccount.id,
    snapshot_revision: current.revision,
    snapshot_binding_generation: current.bindingGeneration,
    snapshot_capability_contract_id: capability.contractId,
    snapshot_capability_contract_version: capability.contractVersion,
    snapshot_capability_declaration_revision: capability.declarationRevision,
    snapshot_capability_surface_id: capability.surfaceId,
    snapshot_capability_loaded_by_trusted_service_id:
      capability.loadedByTrustedServiceId,
    snapshot_capability_loaded_at: capability.loadedAt,
    snapshot_capability_revision: current.capabilities.revision,
    snapshot_created_at: current.createdAt,
    snapshot_updated_at: current.updatedAt
  };
}

function observationRow(
  commit: InboxV2ProviderRosterMaterializationCommit,
  scopeMismatch: boolean
) {
  const current = commit.currentBindingProjection.binding;
  return {
    id: commit.evidence.observation.id,
    source_connection_id: current.sourceConnection.id,
    source_account_id: scopeMismatch
      ? "source_account:other"
      : current.sourceAccount.id,
    evidence_at: commit.evidence.observedAt
  };
}

function identityRow(
  commit: InboxV2ProviderRosterMaterializationCommit,
  member: InboxV2ProviderRosterMemberEvidence,
  index: number,
  failure: FailureKind | undefined,
  providerScope: boolean,
  surfaceMismatch?: "contract" | "version" | "surface" | "service"
) {
  const current = commit.currentBindingProjection.binding;
  const adapter = current.capabilities.adapterContract;
  const isProvider = failure === "identityProvider" || providerScope;
  return {
    id: member.sourceExternalIdentity.id,
    scope_kind: isProvider ? "provider" : "source_account",
    scope_source_connection_id: null,
    scope_source_account_id:
      failure === "identityScope"
        ? "source_account:other"
        : isProvider
          ? null
          : current.sourceAccount.id,
    stability_kind: "stable",
    ephemeral_raw_inbound_event_id: null,
    ephemeral_normalized_inbound_event_id: null,
    declaration_contract_id:
      failure === "identityProvider" || surfaceMismatch === "contract"
        ? "module:other-adapter:contract"
        : adapter.contractId,
    declaration_contract_version:
      surfaceMismatch === "version" ? "v999" : adapter.contractVersion,
    declaration_surface_id:
      surfaceMismatch === "surface"
        ? "module:other-adapter:surface"
        : adapter.surfaceId,
    declaration_loaded_by_trusted_service_id:
      surfaceMismatch === "service"
        ? "core:other-worker"
        : adapter.loadedByTrustedServiceId,
    declaration_loaded_at: t0,
    materialized_at: t0,
    revision: String(index + 5),
    created_at: t0,
    updated_at: observedAt
  };
}

const ROSTER_INSERT_COLUMNS = [
  "tenant_id",
  "id",
  "source_thread_binding_id",
  "external_thread_id",
  "source_connection_id",
  "source_account_id",
  "binding_revision",
  "binding_generation",
  "adapter_contract_id",
  "adapter_contract_version",
  "adapter_declaration_revision",
  "adapter_surface_id",
  "adapter_loaded_by_trusted_service_id",
  "adapter_loaded_at",
  "capability_revision",
  "observation_kind",
  "raw_inbound_event_id",
  "normalized_inbound_event_id",
  "completeness",
  "authority",
  "omission_policy",
  "ordering_kind",
  "ordering_scope_token",
  "ordering_comparator_id",
  "ordering_comparator_revision",
  "ordering_position",
  "watermark",
  "member_count",
  "ordered_member_digest_sha256",
  "materialized_by_trusted_service_id",
  "materialization_authorization_token",
  "observed_at",
  "recorded_at",
  "revision",
  "created_at",
  "updated_at"
] as const;

const MEMBER_INSERT_COLUMNS = [
  "tenant_id",
  "id",
  "roster_evidence_id",
  "source_thread_binding_id",
  "external_thread_id",
  "source_connection_id",
  "source_account_id",
  "ordinal",
  "source_external_identity_id",
  "source_external_identity_revision",
  "state",
  "normalized_role",
  "provider_state_code",
  "provider_role_code",
  "observed_at",
  "roster_recorded_at",
  "revision",
  "created_at",
  "updated_at"
] as const;

type MemberPersistenceRecord = Parameters<
  typeof buildInsertInboxV2ProviderRosterMemberBatchesSql
>[0][number];

function memberPersistenceRecord(index: number): MemberPersistenceRecord {
  return {
    tenant_id: tenantId,
    id: `provider_roster_member_evidence:batch-${index}`,
    roster_evidence_id: "provider_roster_evidence:roster-1",
    source_thread_binding_id: sourceThreadBindingReference.id,
    external_thread_id: externalThreadReference.id,
    source_connection_id: sourceConnectionReference.id,
    source_account_id: sourceAccountReference.id,
    ordinal: index,
    source_external_identity_id: `source_external_identity:batch-${index}`,
    source_external_identity_revision: "1",
    state: "present",
    normalized_role: "member",
    provider_state_code: "present",
    provider_role_code: "participant",
    observed_at: observedAt,
    roster_recorded_at: materializedAt,
    revision: "1",
    created_at: materializedAt,
    updated_at: materializedAt
  } as MemberPersistenceRecord;
}

function rowsResult<Row extends Record<string, unknown>>(
  rows: readonly Record<string, unknown>[]
): RawSqlQueryResult<Row> {
  return { rows: rows as readonly Row[] };
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
