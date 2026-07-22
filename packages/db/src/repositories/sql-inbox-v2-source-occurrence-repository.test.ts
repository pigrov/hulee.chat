import {
  inboxV2SourceOccurrenceMaterializationCommitSchema,
  type InboxV2SourceOccurrenceMaterializationCommit
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildFindInboxV2SourceOccurrenceByIdSql,
  buildInsertInboxV2SourceOccurrenceProviderReferenceSql,
  buildInsertInboxV2SourceOccurrenceProviderTimestampSql,
  buildListInboxV2SourceOccurrenceProviderReferencesSql,
  buildListInboxV2SourceOccurrenceProviderTimestampsSql,
  buildListInboxV2SourceOccurrenceResolutionCandidatesSql,
  buildLockInboxV2SourceOccurrenceAccountIdentitySql,
  buildLockInboxV2SourceOccurrenceBindingSql,
  buildLockInboxV2SourceOccurrenceExternalThreadSql,
  buildLockInboxV2SourceOccurrenceNormalizedEventSql,
  buildLockInboxV2ProviderResponseAccountSnapshotSql,
  buildLockInboxV2ProviderResponseBindingSnapshotSql,
  buildLockInboxV2SourceOccurrenceProviderActorSql,
  buildLockInboxV2SourceOccurrenceRawEventSql,
  computeInboxV2SourceAccountCanonicalKeyDigest,
  createSqlInboxV2SourceOccurrenceRepository,
  materializeInboxV2SourceOccurrenceInTransaction,
  readInboxV2SourceOccurrenceHistoricalMaterializationFenceInTransaction,
  type InboxV2SourceOccurrenceTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-source-occurrence-repository";

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
  "raw_inbound_event:raw-1"
);
const normalizedEventReference = reference(
  "normalized_inbound_event",
  "normalized_inbound_event:normalized-1"
);

const accountDeclaration = {
  adapterContract,
  identityKind: "source_account" as const,
  realmId: "module:synthetic-source:account-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic-source:user-account",
  scopeKind: "source_connection" as const,
  decisionStrength: "authoritative" as const
};

const messageDeclaration = {
  adapterContract,
  identityKind: "message" as const,
  realmId: "module:synthetic-source:message-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic-source:chat-message",
  scopeKind: "provider_thread" as const,
  decisionStrength: "authoritative" as const
};

const threadDeclaration = {
  adapterContract,
  identityKind: "external_thread" as const,
  realmId: "module:synthetic-source:thread-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic-source:group-thread",
  scopeKind: "source_account" as const,
  decisionStrength: "safe_default" as const
};

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
      declaration: accountDeclaration,
      realmId: accountDeclaration.realmId,
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
    revision: "1",
    createdAt: t0,
    updatedAt: t0
  };
}

function currentProjection() {
  const currentBinding = binding();
  return {
    binding: currentBinding,
    currentRemoteAccessEpisode: {
      tenantId,
      id: "source_thread_binding_remote_access_episode:episode-1",
      binding: sourceThreadBindingReference,
      state: currentBinding.remoteAccess.state,
      startedAt: currentBinding.remoteAccess.since,
      endedAt: null,
      startEvidence: currentBinding.remoteAccess.evidence,
      endEvidence: [],
      revision: "1",
      createdAt: t0,
      updatedAt: t0
    }
  };
}

function externalThreadMapping() {
  const conversation = {
    tenantId,
    id: "conversation:conversation-1",
    topology: "group" as const,
    transport: "external" as const,
    purposeId: "core:chat",
    lifecycle: "active" as const,
    head: {
      latestTimelineSequence: "0",
      latestActivityItemId: null,
      latestActivityTimelineSequence: null,
      latestActivityAt: null,
      revision: "1",
      createdAt: t0,
      updatedAt: t0
    },
    revision: "1",
    createdAt: t0,
    updatedAt: t0
  };
  return {
    tenantId,
    thread: {
      tenantId,
      id: externalThreadReference.id,
      key: {
        realm: {
          realmId: threadDeclaration.realmId,
          realmVersion: threadDeclaration.realmVersion,
          canonicalizationVersion: threadDeclaration.canonicalizationVersion
        },
        scope: {
          kind: "source_account" as const,
          owner: sourceAccountReference
        },
        objectKindId: threadDeclaration.objectKindId,
        canonicalExternalSubject: "ProviderGroup:ABC"
      },
      identityDeclaration: threadDeclaration,
      conversation: reference("conversation", conversation.id),
      conversationTopology: "group" as const,
      revision: "1",
      createdAt: t0,
      updatedAt: t0
    },
    conversation
  };
}

function verifiedSourceAccountIdentity() {
  return {
    tenantId,
    sourceAccount: sourceAccountReference,
    sourceConnection: sourceConnectionReference,
    identityDeclaration: accountDeclaration,
    accountGeneration: "1",
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    state: "verified" as const,
    expectedCanonicalScope: null,
    provisionalIdentity: null,
    canonicalIdentity: {
      realm: {
        realmId: accountDeclaration.realmId,
        realmVersion: accountDeclaration.realmVersion,
        canonicalizationVersion: accountDeclaration.canonicalizationVersion,
        objectKindId: accountDeclaration.objectKindId
      },
      scope: {
        kind: "source_connection" as const,
        owner: sourceConnectionReference
      },
      canonicalExternalSubject: "ProviderAccount:ABC"
    },
    verifiedBy: {
      actor: {
        kind: "trusted_service" as const,
        trustedServiceId: "core:source-runtime"
      },
      policyId: "core:provider-account-verification",
      policyVersion: "v1",
      reasonCodeId: "core:account-verified",
      verificationEvidenceToken: "evidence:account-verified-1",
      decidedAt: t0
    },
    conflict: null
  };
}

function occurrence(
  originKind: "webhook" | "stream" | "poll" | "history" = "webhook"
) {
  return {
    tenantId,
    id: "source_occurrence:occurrence-1",
    messageKey: {
      realm: {
        realmId: messageDeclaration.realmId,
        realmVersion: messageDeclaration.realmVersion,
        canonicalizationVersion: messageDeclaration.canonicalizationVersion
      },
      scope: { kind: "provider_thread" as const },
      objectKindId: messageDeclaration.objectKindId,
      externalThread: externalThreadReference,
      canonicalExternalSubject: "ProviderMessage:ABC-1"
    },
    messageIdentityDeclaration: messageDeclaration,
    bindingContext: {
      externalThread: externalThreadReference,
      sourceAccount: sourceAccountReference,
      sourceThreadBinding: sourceThreadBindingReference,
      bindingGeneration: "1"
    },
    origin: {
      kind: originKind,
      sourceAccount: sourceAccountReference,
      rawInboundEvent: rawEventReference,
      normalizedInboundEvent: normalizedEventReference
    },
    descriptor: {
      adapterContract,
      descriptorSchemaId: "module:synthetic-source:message-observation",
      descriptorVersion: "v1",
      capabilityRevision: "1",
      providerReferences: [
        {
          kindId: "module:synthetic-source:external-message-id",
          subject: "ProviderMessage:ABC-1"
        }
      ],
      descriptorDigestSha256: "b".repeat(64)
    },
    providerActor: {
      kind: "source_external_identity" as const,
      sourceExternalIdentity: reference(
        "source_external_identity",
        "source_external_identity:actor-1"
      )
    },
    direction: "inbound" as const,
    providerTimestamps: [
      {
        kindId: "module:synthetic-source:provider-observed-at",
        timestamp: observedAt
      }
    ],
    referencePortability: {
      kind: "binding_only" as const,
      adapterContract,
      decisionStrength: "safe_default" as const
    },
    resolution: {
      state: "pending" as const,
      diagnostic: {
        codeId: "core:message-reference-pending",
        retryable: true,
        correlationToken: "correlation:occurrence-1",
        safeOperatorHintId: null
      }
    },
    observedAt,
    recordedAt: materializedAt,
    revision: "1",
    createdAt: materializedAt,
    updatedAt: materializedAt
  };
}

function materializationCommit(
  originKind: "webhook" | "stream" | "poll" | "history" = "webhook"
): InboxV2SourceOccurrenceMaterializationCommit {
  return inboxV2SourceOccurrenceMaterializationCommitSchema.parse({
    tenantId,
    occurrence: occurrence(originKind),
    bindingMaterialization: {
      kind: "existing",
      currentProjection: currentProjection(),
      creationAuthority: null
    },
    externalThreadMapping: externalThreadMapping(),
    sourceAccountIdentity: verifiedSourceAccountIdentity(),
    outboundDispatchAttempt: null,
    outboundDispatch: null,
    outboundRoute: null,
    authority: {
      kind: "trusted_service",
      trustedServiceId: "core:source-runtime",
      authorizationToken: "authorization:occurrence-materialization-1",
      authorizedAt: materializedAt
    },
    materializedAt
  });
}

describe("SQL Inbox V2 SourceOccurrence repository", () => {
  it("matches the PostgreSQL canonical-key digest for opaque backslashes", () => {
    const key = materializationCommit().sourceAccountIdentity.canonicalIdentity;

    expect(
      computeInboxV2SourceAccountCanonicalKeyDigest({
        ...key,
        canonicalExternalSubject: "Provider\\Account"
      })
    ).toBe("8b9c6002afa16e688d739ad2284e6dbc3dd0c4583f538d6a05249152ad352953");
  });

  it("builds bounded tenant-scoped locks in the database guard order", () => {
    const commit = materializationCommit();
    const actor = commit.occurrence.providerActor;
    const queries = [
      buildLockInboxV2SourceOccurrenceBindingSql(commit as never),
      buildLockInboxV2SourceOccurrenceAccountIdentitySql(commit as never),
      buildLockInboxV2SourceOccurrenceExternalThreadSql(commit as never),
      buildLockInboxV2SourceOccurrenceRawEventSql(commit as never),
      buildLockInboxV2SourceOccurrenceNormalizedEventSql(commit as never),
      buildLockInboxV2SourceOccurrenceProviderActorSql({
        tenantId: commit.tenantId,
        sourceExternalIdentityId:
          actor?.kind === "source_external_identity"
            ? actor.sourceExternalIdentity.id
            : ("unreachable" as never)
      })
    ].map(renderQuery);

    for (const query of queries) {
      expect(query.sql).toContain("tenant_id = $1");
      expect(query.params[0]).toBe(tenantId);
    }
    expect(queries[0]?.sql).toContain("with head as materialized");
    expect(queries[0]?.sql).toContain("for share of snapshot");
    expect(queries[3]?.sql).toContain("for key share");
    expect(queries[4]?.sql).toContain("for key share");
  });

  it("pins provider-response settlement to immutable route-time snapshots", () => {
    const commit = materializationCommit();
    const binding = renderQuery(
      buildLockInboxV2ProviderResponseBindingSnapshotSql(commit as never)
    );
    const identity = renderQuery(
      buildLockInboxV2ProviderResponseAccountSnapshotSql(commit as never)
    );

    expect(binding.sql).toContain(
      "from inbox_v2_source_thread_binding_snapshots snapshot"
    );
    expect(binding.sql).toContain("snapshot.revision = $3");
    expect(binding.sql).not.toContain("source_thread_binding_heads");
    expect(binding.params).toEqual([
      tenantId,
      sourceThreadBindingReference.id,
      "1"
    ]);
    expect(identity.sql).toContain(
      "from inbox_v2_source_account_identity_verified_snapshots"
    );
    expect(identity.sql).toContain("identity_revision = $3");
    expect(identity.sql).not.toContain("source_account_identities\n");
    expect(identity.params).toEqual([tenantId, sourceAccountReference.id, "1"]);
  });

  it("builds exact aggregate and bounded child reads/writes", () => {
    const commit = materializationCommit();
    const input = {
      tenantId: commit.tenantId,
      occurrenceId: commit.occurrence.id
    };
    const find = renderQuery(buildFindInboxV2SourceOccurrenceByIdSql(input));
    const refs = renderQuery(
      buildListInboxV2SourceOccurrenceProviderReferencesSql(input)
    );
    const timestamps = renderQuery(
      buildListInboxV2SourceOccurrenceProviderTimestampsSql(input)
    );
    const candidates = renderQuery(
      buildListInboxV2SourceOccurrenceResolutionCandidatesSql({
        ...input,
        resultingRevision: "2"
      })
    );
    const insertRef = renderQuery(
      buildInsertInboxV2SourceOccurrenceProviderReferenceSql({
        ...input,
        ordinal: 0,
        kindId: "module:synthetic-source:external-message-id",
        subject: "ProviderMessage:ABC-1"
      })
    );
    const insertTimestamp = renderQuery(
      buildInsertInboxV2SourceOccurrenceProviderTimestampSql({
        ...input,
        ordinal: 0,
        kindId: "module:synthetic-source:provider-observed-at",
        timestamp: observedAt
      })
    );

    expect(normalizeSql(find.sql)).toContain(
      "where tenant_id = $1 and id = $2"
    );
    expect(refs.sql).toContain("order by ordinal asc");
    expect(timestamps.sql).toContain("timestamp as provider_timestamp");
    expect(normalizeSql(candidates.sql)).toContain(
      "where tenant_id = $1 and source_occurrence_id = $2 and resulting_revision = $3"
    );
    expect(candidates.params).toEqual([tenantId, input.occurrenceId, "2"]);
    expect(insertRef.sql).toContain("provider_references");
    expect(insertTimestamp.sql).toContain("provider_timestamps");
  });

  it.each(["webhook", "stream", "poll", "history"] as const)(
    "materializes supported %s observations with canonical lock order",
    async (originKind) => {
      const commit = materializationCommit(originKind);
      const executor = new ScriptedOccurrenceExecutor(commit);
      const result =
        await createSqlInboxV2SourceOccurrenceRepository(executor).materialize(
          commit
        );

      expect(result).toEqual({
        kind: "materialized",
        occurrence: commit.occurrence
      });
      expect(executor.transactionStatements.slice(0, 6)).toEqual([
        "binding",
        "account_identity",
        "external_thread",
        "raw_event",
        "normalized_event",
        "provider_actor"
      ]);
      expect(executor.transactionStatements.slice(-3)).toEqual([
        "insert_occurrence",
        "insert_reference",
        "insert_timestamp"
      ]);
    }
  );

  it("materializes idempotently inside a caller-owned transaction without nesting it", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedOccurrenceExecutor(commit);
    const transactionConfig = { isolationLevel: "read committed" } as const;

    await expect(
      executor.transaction(
        (transaction) =>
          materializeInboxV2SourceOccurrenceInTransaction(transaction, commit),
        transactionConfig
      )
    ).resolves.toEqual({
      kind: "materialized",
      occurrence: commit.occurrence
    });
    expect(executor.transactionCount).toBe(1);
    expect(executor.transactionStatements.slice(0, 6)).toEqual([
      "binding",
      "account_identity",
      "external_thread",
      "raw_event",
      "normalized_event",
      "provider_actor"
    ]);

    const statementCountAfterMaterialization =
      executor.transactionStatements.length;
    await expect(
      executor.transaction(
        (transaction) =>
          materializeInboxV2SourceOccurrenceInTransaction(transaction, commit),
        transactionConfig
      )
    ).resolves.toEqual({
      kind: "already_materialized",
      occurrence: commit.occurrence
    });
    expect(executor.transactionCount).toBe(2);
    expect(executor.transactionStatements).toHaveLength(
      statementCountAfterMaterialization
    );
  });

  it("recovers one strict tenant-scoped aggregate in a repeatable-read snapshot", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedOccurrenceExecutor(commit);
    const repository = createSqlInboxV2SourceOccurrenceRepository(executor);
    await expect(repository.materialize(commit)).resolves.toMatchObject({
      kind: "materialized"
    });

    await expect(
      repository.findOccurrence({
        tenantId: commit.tenantId,
        occurrenceId: commit.occurrence.id
      })
    ).resolves.toEqual(commit.occurrence);
    await expect(
      repository.findOccurrence({
        tenantId: "tenant:other-source-occurrence" as never,
        occurrenceId: commit.occurrence.id
      })
    ).resolves.toBeNull();
    expect(executor.transactionConfigs.slice(-2)).toEqual([
      { isolationLevel: "repeatable read" },
      { isolationLevel: "repeatable read" }
    ]);
  });

  it("rejects created binding materialization before any database call", async () => {
    const input = mutableObject(structuredClone(materializationCommit()));
    const materialization = mutableObject(input.bindingMaterialization);
    materialization.kind = "created";
    materialization.creationAuthority = {
      kind: "trusted_service",
      trustedServiceId: "core:source-runtime",
      authorizationToken: "authorization:binding-creation-1",
      authorizedAt: t0
    };
    const executor = new ScriptedOccurrenceExecutor(materializationCommit());

    await expect(
      createSqlInboxV2SourceOccurrenceRepository(executor).materialize(
        input as unknown as InboxV2SourceOccurrenceMaterializationCommit
      )
    ).rejects.toThrow(/does not create SourceThreadBindings/u);
    expect(executor.executeCount).toBe(0);
    expect(executor.transactionCount).toBe(0);
  });

  it("materializes provider_echo from exact durable event evidence", async () => {
    const input = mutableObject(structuredClone(materializationCommit()));
    const occurrenceInput = mutableObject(input.occurrence);
    mutableObject(occurrenceInput.origin).kind = "provider_echo";
    occurrenceInput.direction = "outbound";
    occurrenceInput.providerActor = null;
    const commit =
      input as unknown as InboxV2SourceOccurrenceMaterializationCommit;
    const executor = new ScriptedOccurrenceExecutor(commit);

    await expect(
      createSqlInboxV2SourceOccurrenceRepository(executor).materialize(commit)
    ).resolves.toMatchObject({ kind: "materialized" });
    expect(executor.transactionStatements).toContain("raw_event");
    expect(executor.transactionStatements).toContain("normalized_event");
  });

  it.each(["provider_response", "resolved", "outbound"])(
    "fails closed for unsupported %s materialization before a transaction",
    async (unsupportedKind) => {
      const input = mutableObject(structuredClone(materializationCommit()));
      const occurrenceInput = mutableObject(input.occurrence);
      if (unsupportedKind === "provider_echo") {
        mutableObject(occurrenceInput.origin).kind = "provider_echo";
        occurrenceInput.direction = "outbound";
        occurrenceInput.providerActor = null;
      } else if (unsupportedKind === "provider_response") {
        occurrenceInput.origin = {
          kind: "provider_response",
          sourceAccount: sourceAccountReference,
          outboundDispatchAttempt: reference(
            "outbound_dispatch_attempt",
            "outbound_dispatch_attempt:attempt-1"
          )
        };
        occurrenceInput.direction = "outbound";
        occurrenceInput.providerActor = null;
      } else if (unsupportedKind === "resolved") {
        occurrenceInput.resolution = {
          state: "resolved",
          externalMessageReference: reference(
            "external_message_reference",
            "external_message_reference:reference-1"
          )
        };
        occurrenceInput.revision = "2";
        occurrenceInput.updatedAt = "2026-07-11T09:03:00.000Z";
      } else {
        input.outboundDispatch = {};
      }
      const executor = new ScriptedOccurrenceExecutor(materializationCommit());

      await expect(
        createSqlInboxV2SourceOccurrenceRepository(executor).materialize(
          input as unknown as InboxV2SourceOccurrenceMaterializationCommit
        )
      ).rejects.toBeTruthy();
      expect(executor.transactionCount).toBe(0);
    }
  );

  it("returns a typed binding snapshot conflict for a fence newer than the commit", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedOccurrenceExecutor(commit, {
      bindingUpdatedAt: "2026-07-11T09:03:00.000Z"
    });

    await expect(
      createSqlInboxV2SourceOccurrenceRepository(executor).materialize(commit)
    ).resolves.toEqual({ kind: "binding_snapshot_conflict" });
  });

  it.each(["raw", "normalized"] as const)(
    "rejects an ephemeral provider actor with a mismatched %s observation",
    async (mismatchKind) => {
      const commit = materializationCommit();
      const executor = new ScriptedOccurrenceExecutor(commit, {
        actorMismatch: mismatchKind
      });

      await expect(
        createSqlInboxV2SourceOccurrenceRepository(executor).materialize(commit)
      ).resolves.toEqual({
        kind: "provider_actor_scope_conflict",
        sourceExternalIdentityId: "source_external_identity:actor-1"
      });
    }
  );

  it("accepts a provider-scoped actor only on the exact binding adapter surface", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedOccurrenceExecutor(commit, {
      actorScope: "provider"
    });

    await expect(
      createSqlInboxV2SourceOccurrenceRepository(executor).materialize(commit)
    ).resolves.toEqual({ kind: "materialized", occurrence: commit.occurrence });
  });

  it.each(["contract", "version", "surface", "service"] as const)(
    "rejects provider scope when the identity %s diverges from the binding surface",
    async (actorSurfaceMismatch) => {
      const commit = materializationCommit();
      const executor = new ScriptedOccurrenceExecutor(commit, {
        actorScope: "provider",
        actorSurfaceMismatch
      });

      await expect(
        createSqlInboxV2SourceOccurrenceRepository(executor).materialize(commit)
      ).resolves.toEqual({
        kind: "provider_actor_adapter_surface_conflict",
        sourceExternalIdentityId: "source_external_identity:actor-1"
      });
    }
  );

  it("treats an exact concurrent duplicate as idempotent", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedOccurrenceExecutor(commit, {
      concurrentDuplicate: "exact"
    });

    await expect(
      createSqlInboxV2SourceOccurrenceRepository(executor).materialize(commit)
    ).resolves.toEqual({
      kind: "already_materialized",
      occurrence: commit.occurrence
    });
  });

  it("returns an occurrence ID conflict for a different concurrent aggregate", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedOccurrenceExecutor(commit, {
      concurrentDuplicate: "different"
    });

    await expect(
      createSqlInboxV2SourceOccurrenceRepository(executor).materialize(commit)
    ).resolves.toEqual({
      kind: "occurrence_id_conflict",
      occurrenceId: commit.occurrence.id
    });
  });

  it("retries serialization/deadlock SQLSTATEs with the same read-committed boundary", async () => {
    const commit = materializationCommit();
    const executor = new ScriptedOccurrenceExecutor(commit, {
      retryableFailures: 2
    });

    await expect(
      createSqlInboxV2SourceOccurrenceRepository(executor).materialize(commit)
    ).resolves.toMatchObject({ kind: "materialized" });
    expect(executor.transactionCount).toBe(3);
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "read committed" },
      { isolationLevel: "read committed" },
      { isolationLevel: "read committed" }
    ]);
  });

  it("loads the immutable occurrence-time binding/account fence without consulting current heads", async () => {
    const commit = materializationCommit();
    const occurrence = commit.occurrence;
    const historicalBinding =
      commit.bindingMaterialization.currentProjection.binding;
    const adapter = occurrence.descriptor.adapterContract;
    const executor: RawSqlExecutor = {
      async execute<Row extends Record<string, unknown>>(query: SQL) {
        const statement = normalizeSql(renderQuery(query).sql);
        expect(statement).toContain("from inbox_v2_source_occurrences");
        expect(statement).not.toContain("source_thread_binding_heads");
        return rowsResult<Row>([
          {
            external_thread_id: occurrence.bindingContext.externalThread.id,
            source_account_id: occurrence.bindingContext.sourceAccount.id,
            source_thread_binding_id:
              occurrence.bindingContext.sourceThreadBinding.id,
            binding_revision: historicalBinding.revision,
            binding_generation: occurrence.bindingContext.bindingGeneration,
            account_identity_revision: commit.sourceAccountIdentity.revision,
            capability_revision: occurrence.descriptor.capabilityRevision,
            adapter_contract_id: adapter.contractId,
            adapter_contract_version: adapter.contractVersion,
            adapter_declaration_revision: adapter.declarationRevision,
            adapter_surface_id: adapter.surfaceId,
            adapter_loaded_by_trusted_service_id:
              adapter.loadedByTrustedServiceId,
            adapter_loaded_at: adapter.loadedAt
          } as unknown as Row
        ]);
      }
    };

    await expect(
      readInboxV2SourceOccurrenceHistoricalMaterializationFenceInTransaction(
        executor,
        { occurrence }
      )
    ).resolves.toEqual({
      bindingRevision: historicalBinding.revision,
      accountIdentityRevision: commit.sourceAccountIdentity.revision
    });
  });
});

type ExecutorOptions = Readonly<{
  bindingUpdatedAt?: string;
  actorMismatch?: "raw" | "normalized";
  actorScope?: "provider" | "source_account";
  actorSurfaceMismatch?: "contract" | "version" | "surface" | "service";
  concurrentDuplicate?: "exact" | "different";
  retryableFailures?: number;
}>;

class ScriptedOccurrenceExecutor implements InboxV2SourceOccurrenceTransactionExecutor {
  executeCount = 0;
  transactionCount = 0;
  transactionStatements: string[] = [];
  transactionConfigs: Array<
    Readonly<{ isolationLevel: "read committed" | "repeatable read" }>
  > = [];
  private inTransaction = false;
  private mainInsertParams: unknown[] | null = null;
  private retryableFailuresRemaining: number;

  constructor(
    private readonly commit: InboxV2SourceOccurrenceMaterializationCommit,
    private readonly options: ExecutorOptions = {}
  ) {
    this.retryableFailuresRemaining = options.retryableFailures ?? 0;
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{
      isolationLevel: "read committed" | "repeatable read";
    }>
  ): Promise<TResult> {
    this.transactionCount += 1;
    this.transactionConfigs.push(config);
    if (this.retryableFailuresRemaining > 0) {
      this.retryableFailuresRemaining -= 1;
      throw Object.assign(new Error("retry"), { code: "40001" });
    }
    this.inTransaction = true;
    try {
      return await work(this);
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

    if (statement.includes("select * from inbox_v2_source_occurrences")) {
      if (
        rendered.params[0] !== this.commit.tenantId ||
        rendered.params[1] !== this.commit.occurrence.id
      ) {
        return rowsResult([]);
      }
      if (this.mainInsertParams === null) return rowsResult([]);
      const row = Object.fromEntries(
        OCCURRENCE_INSERT_COLUMNS.map((column, index) => [
          column,
          this.mainInsertParams?.[index]
        ])
      );
      if (this.options.concurrentDuplicate === "different") {
        row.canonical_external_subject = "ProviderMessage:DIFFERENT";
      }
      return rowsResult([row]);
    }
    if (
      statement.includes("source_occurrence_provider_references") &&
      statement.startsWith("select")
    ) {
      return rowsResult(
        this.commit.occurrence.descriptor.providerReferences.map(
          (item, ordinal) => ({
            ordinal,
            kind_id: item.kindId,
            subject: item.subject
          })
        )
      );
    }
    if (
      statement.includes("source_occurrence_provider_timestamps") &&
      statement.startsWith("select")
    ) {
      return rowsResult(
        this.commit.occurrence.providerTimestamps.map((item, ordinal) => ({
          ordinal,
          kind_id: item.kindId,
          provider_timestamp: item.timestamp
        }))
      );
    }

    if (statement.includes("from inbox_v2_source_thread_binding_heads")) {
      this.record("binding");
      return rowsResult([
        bindingRow(this.commit, this.options.bindingUpdatedAt)
      ]);
    }
    if (statement.includes("from inbox_v2_source_account_identities")) {
      this.record("account_identity");
      return rowsResult([accountIdentityRow(this.commit)]);
    }
    if (statement.includes("from inbox_v2_external_threads")) {
      this.record("external_thread");
      return rowsResult([externalThreadRow(this.commit)]);
    }
    if (statement.includes("from raw_inbound_events")) {
      this.record("raw_event");
      return rowsResult([rawEventRow(this.commit)]);
    }
    if (statement.includes("from normalized_inbound_events")) {
      this.record("normalized_event");
      return rowsResult([normalizedEventRow(this.commit)]);
    }
    if (statement.includes("from inbox_v2_source_external_identities")) {
      this.record("provider_actor");
      return rowsResult([
        providerActorRow(
          this.commit,
          this.options.actorMismatch,
          this.options.actorScope,
          this.options.actorSurfaceMismatch
        )
      ]);
    }
    if (statement.startsWith("insert into inbox_v2_source_occurrences")) {
      this.record("insert_occurrence");
      this.mainInsertParams = rendered.params;
      return this.options.concurrentDuplicate
        ? rowsResult([])
        : rowsResult([{ id: this.commit.occurrence.id }]);
    }
    if (
      statement.startsWith(
        "insert into inbox_v2_source_occurrence_provider_references"
      )
    ) {
      this.record("insert_reference");
      return rowsResult([{ id: this.commit.occurrence.id }]);
    }
    if (
      statement.startsWith(
        "insert into inbox_v2_source_occurrence_provider_timestamps"
      )
    ) {
      this.record("insert_timestamp");
      return rowsResult([{ id: this.commit.occurrence.id }]);
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  }

  private record(kind: string): void {
    if (this.inTransaction) this.transactionStatements.push(kind);
  }
}

function bindingRow(
  commit: InboxV2SourceOccurrenceMaterializationCommit,
  updatedAt = t0
) {
  const current = commit.bindingMaterialization.currentProjection.binding;
  const capability = current.capabilities.adapterContract;
  const identityDigest = computeInboxV2SourceAccountCanonicalKeyDigest(
    commit.sourceAccountIdentity.canonicalIdentity
  );
  return {
    binding_id: current.id,
    external_thread_id: current.externalThread.id,
    source_connection_id: current.sourceConnection.id,
    source_account_id: current.sourceAccount.id,
    binding_revision: current.revision,
    binding_generation: current.bindingGeneration,
    account_identity_revision: commit.sourceAccountIdentity.revision,
    account_generation: commit.sourceAccountIdentity.accountGeneration,
    account_identity_state: "verified",
    account_canonical_key_digest_sha256: identityDigest,
    capability_contract_id: capability.contractId,
    capability_contract_version: capability.contractVersion,
    capability_declaration_revision: capability.declarationRevision,
    capability_surface_id: capability.surfaceId,
    capability_loaded_by_trusted_service_id:
      capability.loadedByTrustedServiceId,
    capability_loaded_at: capability.loadedAt,
    capability_revision: current.capabilities.revision,
    created_at: current.createdAt,
    updated_at: updatedAt,
    snapshot_binding_id: current.id,
    snapshot_external_thread_id: current.externalThread.id,
    snapshot_source_connection_id: current.sourceConnection.id,
    snapshot_source_account_id: current.sourceAccount.id,
    snapshot_revision: current.revision,
    snapshot_binding_generation: current.bindingGeneration,
    snapshot_account_identity_revision: commit.sourceAccountIdentity.revision,
    snapshot_account_generation: commit.sourceAccountIdentity.accountGeneration,
    snapshot_account_identity_state: "verified",
    snapshot_account_canonical_key_digest_sha256: identityDigest,
    snapshot_capability_contract_id: capability.contractId,
    snapshot_capability_contract_version: capability.contractVersion,
    snapshot_capability_declaration_revision: capability.declarationRevision,
    snapshot_capability_surface_id: capability.surfaceId,
    snapshot_capability_loaded_by_trusted_service_id:
      capability.loadedByTrustedServiceId,
    snapshot_capability_loaded_at: capability.loadedAt,
    snapshot_capability_revision: current.capabilities.revision,
    snapshot_created_at: current.createdAt,
    snapshot_updated_at: updatedAt
  };
}

function accountIdentityRow(
  commit: InboxV2SourceOccurrenceMaterializationCommit
) {
  const identity = commit.sourceAccountIdentity;
  const key = identity.canonicalIdentity;
  return {
    source_account_id: identity.sourceAccount.id,
    source_connection_id: identity.sourceConnection.id,
    state: identity.state,
    revision: identity.revision,
    account_generation: identity.accountGeneration,
    canonical_key_digest_sha256:
      computeInboxV2SourceAccountCanonicalKeyDigest(key),
    canonical_realm_id: key.realm.realmId,
    canonical_realm_version: key.realm.realmVersion,
    canonicalization_version: key.realm.canonicalizationVersion,
    canonical_object_kind_id: key.realm.objectKindId,
    canonical_scope_kind: key.scope.kind,
    canonical_scope_source_connection_id:
      key.scope.kind === "source_connection" ? key.scope.owner.id : null,
    canonical_external_subject: key.canonicalExternalSubject,
    identity_declaration: identity.identityDeclaration,
    updated_at: identity.updatedAt
  };
}

function externalThreadRow(
  commit: InboxV2SourceOccurrenceMaterializationCommit
) {
  const thread = commit.externalThreadMapping.thread;
  return {
    id: thread.id,
    conversation_id: thread.conversation.id,
    revision: thread.revision,
    identity_declaration: thread.identityDeclaration,
    created_at: thread.createdAt
  };
}

function rawEventRow(commit: InboxV2SourceOccurrenceMaterializationCommit) {
  const current = commit.bindingMaterialization.currentProjection.binding;
  return {
    id:
      commit.occurrence.origin.kind === "provider_response"
        ? "unreachable"
        : commit.occurrence.origin.rawInboundEvent.id,
    source_connection_id: current.sourceConnection.id,
    source_account_id: current.sourceAccount.id,
    evidence_at: t0
  };
}

function normalizedEventRow(
  commit: InboxV2SourceOccurrenceMaterializationCommit
) {
  const current = commit.bindingMaterialization.currentProjection.binding;
  if (commit.occurrence.origin.kind === "provider_response")
    throw new Error("unreachable");
  return {
    id: commit.occurrence.origin.normalizedInboundEvent.id,
    raw_event_id: commit.occurrence.origin.rawInboundEvent.id,
    source_connection_id: current.sourceConnection.id,
    source_account_id: current.sourceAccount.id,
    evidence_at: t0
  };
}

function providerActorRow(
  commit: InboxV2SourceOccurrenceMaterializationCommit,
  mismatch?: "raw" | "normalized",
  scope: "provider" | "source_account" = "source_account",
  surfaceMismatch?: "contract" | "version" | "surface" | "service"
) {
  const current = commit.bindingMaterialization.currentProjection.binding;
  const adapter = current.capabilities.adapterContract;
  if (commit.occurrence.origin.kind === "provider_response")
    throw new Error("unreachable");
  return {
    id: "source_external_identity:actor-1",
    scope_kind: scope,
    scope_source_connection_id: null,
    scope_source_account_id:
      scope === "source_account" ? current.sourceAccount.id : null,
    stability_kind: mismatch ? "observation_ephemeral" : "stable",
    ephemeral_raw_inbound_event_id:
      mismatch === "raw" ? "raw_inbound_event:wrong" : null,
    ephemeral_normalized_inbound_event_id:
      mismatch === "normalized" ? "normalized_inbound_event:wrong" : null,
    declaration_contract_id:
      surfaceMismatch === "contract"
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
    created_at: t0
  };
}

const OCCURRENCE_INSERT_COLUMNS = [
  "tenant_id",
  "id",
  "conversation_id",
  "external_thread_id",
  "external_thread_revision",
  "source_connection_id",
  "source_account_id",
  "source_thread_binding_id",
  "binding_revision",
  "binding_generation",
  "account_identity_revision",
  "account_generation",
  "account_canonical_key_digest_sha256",
  "message_realm_id",
  "message_realm_version",
  "message_canonicalization_version",
  "message_scope_kind",
  "message_scope_source_account_id",
  "message_scope_source_thread_binding_id",
  "message_object_kind_id",
  "canonical_external_subject",
  "adapter_contract_id",
  "adapter_contract_version",
  "adapter_declaration_revision",
  "adapter_surface_id",
  "adapter_loaded_by_trusted_service_id",
  "adapter_loaded_at",
  "message_decision_strength",
  "origin_kind",
  "raw_inbound_event_id",
  "normalized_inbound_event_id",
  "outbound_dispatch_attempt_id",
  "provider_actor_kind",
  "provider_actor_source_external_identity_id",
  "provider_system_actor_kind_id",
  "provider_system_actor_subject",
  "direction",
  "descriptor_schema_id",
  "descriptor_version",
  "capability_revision",
  "provider_reference_count",
  "descriptor_digest_sha256",
  "provider_timestamp_count",
  "reference_portability_kind",
  "reference_portability_decision_strength",
  "resolution_state",
  "resolved_external_message_reference_id",
  "resolution_candidate_count",
  "resolution_candidate_digest_sha256",
  "resolution_diagnostic_code_id",
  "resolution_diagnostic_retryable",
  "resolution_diagnostic_correlation_token",
  "resolution_diagnostic_safe_operator_hint_id",
  "materialized_by_trusted_service_id",
  "materialization_authorization_token",
  "observed_at",
  "recorded_at",
  "revision",
  "created_at",
  "updated_at"
] as const;

function mutableObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected mutable object test fixture.");
  }
  return value as Record<string, unknown>;
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
