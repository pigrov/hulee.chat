import {
  inboxV2SourceThreadBindingCreationCommitSchema,
  inboxV2SourceThreadBindingEvidenceReferenceSchema,
  inboxV2SourceThreadBindingTransitionCommitSchema,
  type InboxV2SourceThreadBindingCreationCommit,
  type InboxV2SourceThreadBindingTransitionCommit
} from "@hulee/contracts";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildFindCurrentInboxV2SourceThreadBindingSql,
  buildInsertEvidenceReferenceSql,
  createSqlInboxV2SourceThreadBindingRepository,
  type InboxV2SourceThreadBindingTransactionExecutor
} from "./sql-inbox-v2-source-thread-binding-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  inboxV2SourceThreadBindingHeads,
  inboxV2SourceThreadBindingSnapshots,
  inboxV2SourceThreadBindingTransitions
} from "../schema/inbox-v2/source-thread-binding";

const tenantId = "tenant:tenant-1";
const t0 = "2026-07-11T09:00:00.000Z";
const t1 = "2026-07-11T09:01:00.000Z";

const adapterContract = {
  contractId: "module:synthetic-source:direct-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:group-surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: "source_connection:connection-1"
};
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:account-1"
};
const externalThread = {
  tenantId,
  kind: "external_thread" as const,
  id: "external_thread:thread-1"
};
const rawEvidence = {
  tenantId,
  kind: "raw_inbound_event" as const,
  id: "raw_inbound_event:raw-1"
};
const secondRawEvidence = {
  tenantId,
  kind: "raw_inbound_event" as const,
  id: "raw_inbound_event:raw-2"
};

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

function routeDescriptor() {
  const descriptor = {
    adapterContract,
    descriptorSchemaId: "module:synthetic-source:group-route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:synthetic-source:group-peer",
    destinationSubject: "GroupABC",
    attributes: [
      {
        attributeId: "module:synthetic-source:route-shard",
        value: "primary"
      }
    ]
  };
  return {
    ...descriptor,
    descriptorDigestSha256: computeRouteDigest(descriptor)
  };
}

function projection() {
  const binding = {
    tenantId,
    id: "source_thread_binding:binding-1",
    externalThread,
    sourceConnection,
    sourceAccount,
    accountIdentitySnapshot: {
      status: "verified" as const,
      sourceConnection,
      sourceAccount,
      declaration: accountDeclaration,
      realmId: accountDeclaration.realmId,
      canonicalExternalSubject: "AccountABC",
      accountGeneration: "1",
      verificationEvidence: [rawEvidence],
      verifiedAt: t0
    },
    bindingGeneration: "1",
    remoteAccess: {
      state: "active" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: "1",
      since: t0,
      evidence: [rawEvidence]
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
      lastDurableRawEvent: rawEvidence,
      updatedAt: t0,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: ["module:synthetic-source:provider-member"],
      evidence: [rawEvidence],
      observedAt: t0
    },
    capabilities: {
      adapterContract,
      revision: "1",
      capturedAt: t0,
      entries: [
        {
          capabilityId: "core:message-text-send",
          operationId: "core:send",
          contentKindId: "core:text",
          state: "supported" as const,
          referencePortability: "external_thread" as const,
          requiredProviderRoleIds: ["module:synthetic-source:provider-member"],
          validUntil: null,
          diagnostic: null,
          evidence: [rawEvidence]
        }
      ]
    },
    routeDescriptor: routeDescriptor(),
    revision: "1",
    createdAt: t0,
    updatedAt: t0
  };
  return {
    binding,
    currentRemoteAccessEpisode: {
      tenantId,
      id: "source_thread_binding_remote_access_episode:episode-1",
      binding: {
        tenantId,
        kind: "source_thread_binding" as const,
        id: binding.id
      },
      state: "active" as const,
      startedAt: t0,
      endedAt: null,
      startEvidence: [rawEvidence],
      endEvidence: [],
      revision: "1",
      createdAt: t0,
      updatedAt: t0
    }
  };
}

function creationCommit(): InboxV2SourceThreadBindingCreationCommit {
  const initialProjection = projection();
  return inboxV2SourceThreadBindingCreationCommitSchema.parse({
    tenantId,
    externalThreadMapping: {
      tenantId,
      thread: {
        tenantId,
        id: externalThread.id,
        key: {
          realm: {
            realmId: "module:synthetic-source:thread-realm",
            realmVersion: "v1",
            canonicalizationVersion: "v1"
          },
          scope: { kind: "provider" },
          objectKindId: "module:synthetic-source:group-room",
          canonicalExternalSubject: "GroupABC"
        },
        identityDeclaration: {
          adapterContract,
          identityKind: "external_thread",
          realmId: "module:synthetic-source:thread-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1",
          objectKindId: "module:synthetic-source:group-room",
          scopeKind: "provider",
          decisionStrength: "authoritative"
        },
        conversation: {
          tenantId,
          kind: "conversation",
          id: "conversation:conversation-1"
        },
        conversationTopology: "group",
        revision: "1",
        createdAt: t0,
        updatedAt: t0
      },
      conversation: {
        tenantId,
        id: "conversation:conversation-1",
        topology: "group",
        transport: "external",
        purposeId: "core:chat",
        lifecycle: "active",
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
      }
    },
    sourceAccountIdentity: {
      tenantId,
      sourceAccount,
      sourceConnection,
      identityDeclaration: accountDeclaration,
      accountGeneration: "1",
      revision: "1",
      createdAt: t0,
      updatedAt: t0,
      state: "verified",
      expectedCanonicalScope: null,
      provisionalIdentity: null,
      canonicalIdentity: {
        realm: {
          realmId: accountDeclaration.realmId,
          realmVersion: accountDeclaration.realmVersion,
          canonicalizationVersion: accountDeclaration.canonicalizationVersion,
          objectKindId: accountDeclaration.objectKindId
        },
        scope: { kind: "source_connection", owner: sourceConnection },
        canonicalExternalSubject: "AccountABC"
      },
      verifiedBy: {
        actor: {
          kind: "trusted_service",
          trustedServiceId: "core:source-runtime"
        },
        policyId: "core:verified-provider-account",
        policyVersion: "v1",
        reasonCodeId: "core:account-verified",
        verificationEvidenceToken: "evidence.account-verify-1",
        decidedAt: t0
      },
      conflict: null
    },
    initialProjection
  });
}

function remoteTransitionCommit(): InboxV2SourceThreadBindingTransitionCommit {
  const before = projection();
  const resultingRemoteAccess = {
    state: "left" as const,
    evidenceAuthority: "explicit_terminal_event" as const,
    revision: "2",
    since: t1,
    evidence: [secondRawEvidence]
  };
  const transition = {
    tenantId,
    id: "source_thread_binding_transition:transition-1",
    binding: {
      tenantId,
      kind: "source_thread_binding" as const,
      id: before.binding.id
    },
    actor: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:source-runtime"
    },
    reasonId: "core:provider-observation",
    expectedBindingRevision: "1",
    resultingBindingRevision: "2",
    occurredAt: t1,
    kind: "remote_access" as const,
    fromState: "active" as const,
    toState: "left" as const,
    expectedRemoteAccessRevision: "1",
    resultingRemoteAccess,
    closedEpisode: {
      tenantId,
      kind: "source_thread_binding_remote_access_episode" as const,
      id: before.currentRemoteAccessEpisode.id
    },
    openedEpisode: {
      tenantId,
      kind: "source_thread_binding_remote_access_episode" as const,
      id: "source_thread_binding_remote_access_episode:episode-2"
    },
    evidence: [secondRawEvidence]
  };
  const after = {
    binding: {
      ...before.binding,
      remoteAccess: resultingRemoteAccess,
      revision: "2",
      updatedAt: t1
    },
    currentRemoteAccessEpisode: {
      ...before.currentRemoteAccessEpisode,
      id: transition.openedEpisode.id,
      state: "left" as const,
      startedAt: t1,
      startEvidence: [secondRawEvidence],
      createdAt: t1,
      updatedAt: t1
    }
  };
  const closedRemoteAccessEpisode = {
    ...before.currentRemoteAccessEpisode,
    endedAt: t1,
    endEvidence: [secondRawEvidence],
    revision: "2",
    updatedAt: t1
  };
  return inboxV2SourceThreadBindingTransitionCommitSchema.parse({
    before,
    transition,
    after,
    closedRemoteAccessEpisode
  });
}

describe("SQL Inbox V2 SourceThreadBinding repository", () => {
  it("loads one bounded projection and locks only the exact current head", () => {
    const rendered = renderQuery(
      buildFindCurrentInboxV2SourceThreadBindingSql({
        tenantId,
        bindingId: "source_thread_binding:binding-1",
        lock: true
      })
    );
    const statement = normalizeSql(rendered.sql);

    expect(statement).toContain("from inbox_v2_source_thread_binding_heads");
    expect(statement).toContain("for update");
    expect(statement).toContain(
      "inbox_v2_source_thread_binding_capability_entries"
    );
    expect(statement).toContain(
      "inbox_v2_source_thread_binding_route_attributes"
    );
    expect(rendered.params).toEqual([
      tenantId,
      "source_thread_binding:binding-1",
      tenantId
    ]);
  });

  it("materializes identity-transition evidence through its typed authority", () => {
    const rendered = renderQuery(
      buildInsertEvidenceReferenceSql({
        tenantId,
        evidenceSetId: "source_thread_binding_evidence_set:evidence-1",
        bindingId: "source_thread_binding:binding-1",
        sourceConnectionId: sourceConnection.id,
        sourceAccountId: sourceAccount.id,
        ordinal: 0,
        reference: inboxV2SourceThreadBindingEvidenceReferenceSchema.parse({
          tenantId,
          kind: "source_account_identity_transition",
          id: "source_account_identity_transition:transition-1"
        })
      })
    );
    const statement = normalizeSql(rendered.sql);
    expect(statement).toContain(
      "from inbox_v2_source_account_identity_transitions authority"
    );
    expect(statement).toContain("authority.resulting_revision");
    expect(statement).toContain("returning ordinal");
  });

  it("creates the aggregate with deterministic write ordering and snapshot-last closure", async () => {
    const commit = creationCommit();
    const executor = new CreationExecutor(commit);
    const repository = createSqlInboxV2SourceThreadBindingRepository(executor);

    await expect(repository.resolveOrCreate(commit)).resolves.toEqual({
      kind: "created",
      projection: commit.initialProjection
    });
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "read committed" }
    ]);
    expect(executor.order.indexOf("identity_lock")).toBeLessThan(
      executor.order.indexOf("thread_lock")
    );
    expect(executor.headRecord).toMatchObject({
      provider_roles_digest_sha256: sha256(
        lengthPrefixed("module:synthetic-source:provider-member")
      ),
      capability_semantic_digest_sha256: computeCapabilityDigest(
        commit.initialProjection.binding.capabilities
      ),
      route_attributes_digest_sha256: sha256(
        "0|module:synthetic-source:route-shard|7:primary"
      ),
      route_descriptor_digest_sha256:
        commit.initialProjection.binding.routeDescriptor.descriptorDigestSha256
    });
    expect(Object.keys(executor.headRecord ?? {}).sort()).toEqual(
      getTableConfig(inboxV2SourceThreadBindingHeads)
        .columns.map((column) => column.name)
        .sort()
    );
    expect(Object.keys(executor.snapshotRecord ?? {}).sort()).toEqual(
      getTableConfig(inboxV2SourceThreadBindingSnapshots)
        .columns.map((column) => column.name)
        .sort()
    );
    expect(executor.order.at(-1)).toBe("insert_snapshot");
  });

  it("resolves an identical target idempotently without taking authority locks", async () => {
    const commit = creationCommit();
    const executor = new CreationExecutor(commit, true);
    const repository = createSqlInboxV2SourceThreadBindingRepository(executor);

    await expect(repository.resolveOrCreate(commit)).resolves.toEqual({
      kind: "already_exists",
      projection: commit.initialProjection
    });
    expect(executor.order).toEqual([]);
  });

  it("materializes provider roster and member evidence through exact binding authorities", () => {
    const common = {
      tenantId,
      evidenceSetId: "source_thread_binding_evidence_set:evidence-roster-1",
      bindingId: "source_thread_binding:binding-1",
      sourceConnectionId: sourceConnection.id,
      sourceAccountId: sourceAccount.id,
      ordinal: 0
    } as const;
    const roster = normalizeSql(
      renderQuery(
        buildInsertEvidenceReferenceSql({
          ...common,
          reference: inboxV2SourceThreadBindingEvidenceReferenceSchema.parse({
            tenantId,
            kind: "provider_roster_evidence",
            id: "provider_roster_evidence:roster-1"
          })
        })
      ).sql
    );
    const member = normalizeSql(
      renderQuery(
        buildInsertEvidenceReferenceSql({
          ...common,
          reference: inboxV2SourceThreadBindingEvidenceReferenceSchema.parse({
            tenantId,
            kind: "provider_roster_member_evidence",
            id: "provider_roster_member_evidence:member-1"
          })
        })
      ).sql
    );

    expect(roster).toContain(
      "from inbox_v2_provider_roster_evidence authority"
    );
    expect(member).toContain(
      "from inbox_v2_provider_roster_member_evidence authority"
    );
    for (const statement of [roster, member]) {
      expect(statement).toContain("authority.source_thread_binding_id");
      expect(statement).toContain("authority.source_connection_id");
      expect(statement).toContain("authority.source_account_id");
      expect(statement).toContain("returning ordinal");
    }
  });

  it("persists a transition before one exact head CAS and closes with its snapshot", async () => {
    const commit = remoteTransitionCommit();
    const executor = new TransitionExecutor(commit);
    const repository = createSqlInboxV2SourceThreadBindingRepository(executor);

    await expect(repository.applyTransition(commit)).resolves.toEqual({
      kind: "committed",
      projection: commit.after
    });
    expect(executor.order.indexOf("head_lock")).toBeLessThan(
      executor.order.indexOf("identity_lock")
    );
    expect(executor.order.indexOf("identity_lock")).toBeLessThan(
      executor.order.indexOf("thread_lock")
    );
    expect(executor.order.indexOf("close_episode")).toBeLessThan(
      executor.order.indexOf("open_episode")
    );
    expect(executor.order.indexOf("open_episode")).toBeLessThan(
      executor.order.indexOf("insert_transition")
    );
    expect(executor.order.indexOf("insert_transition")).toBeLessThan(
      executor.order.indexOf("update_head")
    );
    expect(Object.keys(executor.transitionRecord ?? {}).sort()).toEqual(
      getTableConfig(inboxV2SourceThreadBindingTransitions)
        .columns.map((column) => column.name)
        .sort()
    );
    expect(executor.order.at(-1)).toBe("insert_snapshot");
  });

  it("replays the exact transition idempotently from its immutable revision snapshot", async () => {
    const commit = remoteTransitionCommit();
    const executor = new TransitionExecutor(commit);
    const repository = createSqlInboxV2SourceThreadBindingRepository(executor);

    await expect(repository.applyTransition(commit)).resolves.toMatchObject({
      kind: "committed"
    });
    const writeCount = executor.order.length;
    await expect(repository.applyTransition(commit)).resolves.toEqual({
      kind: "already_committed",
      projection: commit.after
    });
    expect(executor.order).toHaveLength(writeCount);
  });
});

abstract class ScriptedExecutor implements InboxV2SourceThreadBindingTransactionExecutor {
  readonly order: string[] = [];
  readonly transactionConfigs: Readonly<{
    isolationLevel: "read committed";
  }>[] = [];

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionConfigs.push(config);
    return work(this);
  }

  abstract execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>>;
}

class CreationExecutor extends ScriptedExecutor {
  private materialized = false;
  headRecord: Record<string, unknown> | null = null;
  snapshotRecord: Record<string, unknown> | null = null;

  constructor(
    private readonly commit: InboxV2SourceThreadBindingCreationCommit,
    preexisting = false
  ) {
    super();
    this.materialized = preexisting;
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const rendered = renderQuery(query);
    const statement = normalizeSql(rendered.sql);
    if (statement.includes("pg_advisory_xact_lock")) return rows<Row>([]);
    if (
      statement.includes("jsonb_build_object") &&
      statement.includes("as projection")
    ) {
      return this.materialized
        ? rows<Row>([
            {
              projection: this.commit.initialProjection,
              persistence: persistence()
            }
          ])
        : rows<Row>([]);
    }
    if (statement.includes("from inbox_v2_source_account_identities")) {
      this.order.push("identity_lock");
      return rows<Row>([identityRow(this.commit)]);
    }
    if (statement.includes("from inbox_v2_external_threads")) {
      this.order.push("thread_lock");
      return rows<Row>([threadRow(this.commit)]);
    }
    if (statement.startsWith("insert into inbox_v2_source_thread_bindings")) {
      this.order.push("insert_anchor");
      return rows<Row>([{ id: this.commit.initialProjection.binding.id }]);
    }
    if (
      statement.startsWith(
        "insert into inbox_v2_source_thread_binding_evidence_references"
      )
    ) {
      return rows<Row>([{ ordinal: 0 }]);
    }
    if (
      statement.startsWith("insert into inbox_v2_source_thread_binding_heads")
    ) {
      this.headRecord = JSON.parse(String(rendered.params[0])) as Record<
        string,
        unknown
      >;
      this.order.push("insert_head");
      return rows<Row>([]);
    }
    if (
      statement.startsWith(
        "insert into inbox_v2_source_thread_binding_snapshots"
      )
    ) {
      this.snapshotRecord = JSON.parse(String(rendered.params[0])) as Record<
        string,
        unknown
      >;
      this.materialized = true;
      this.order.push("insert_snapshot");
      return rows<Row>([]);
    }
    this.order.push(statement.split(" ").slice(0, 3).join("_"));
    return rows<Row>([]);
  }
}

class TransitionExecutor extends ScriptedExecutor {
  private advanced = false;
  transitionRecord: Record<string, unknown> | null = null;

  constructor(
    private readonly commit: InboxV2SourceThreadBindingTransitionCommit
  ) {
    super();
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const rendered = renderQuery(query);
    const statement = normalizeSql(rendered.sql);
    if (statement.includes("to_jsonb(transition_row)")) {
      return this.transitionRecord === null
        ? rows<Row>([])
        : rows<Row>([
            {
              transition: this.transitionRecord,
              matched_permission_ids: [],
              evidence:
                "evidence" in this.commit.transition
                  ? this.commit.transition.evidence
                  : []
            }
          ]);
    }
    if (
      statement.includes("jsonb_build_object") &&
      statement.includes("as projection")
    ) {
      if (!this.advanced) this.order.push("head_lock");
      return rows<Row>([
        {
          projection: this.advanced ? this.commit.after : this.commit.before,
          persistence: persistence()
        }
      ]);
    }
    if (statement.includes("from inbox_v2_source_account_identities")) {
      this.order.push("identity_lock");
      return rows<Row>([transitionIdentityRow(this.commit)]);
    }
    if (statement.includes("from inbox_v2_external_threads")) {
      this.order.push("thread_lock");
      return rows<Row>([{ id: this.commit.before.binding.externalThread.id }]);
    }
    if (
      statement.startsWith(
        "insert into inbox_v2_source_thread_binding_evidence_references"
      )
    ) {
      return rows<Row>([{ ordinal: 0 }]);
    }
    if (
      statement.startsWith(
        "insert into inbox_v2_source_thread_binding_transitions"
      )
    ) {
      this.transitionRecord = JSON.parse(String(rendered.params[0])) as Record<
        string,
        unknown
      >;
      this.order.push("insert_transition");
      return rows<Row>([]);
    }
    if (
      statement.startsWith(
        "update inbox_v2_source_thread_binding_remote_access_episodes"
      )
    ) {
      this.order.push("close_episode");
      return rows<Row>([
        { id: this.commit.before.currentRemoteAccessEpisode.id }
      ]);
    }
    if (
      statement.startsWith(
        "insert into inbox_v2_source_thread_binding_remote_access_episodes"
      )
    ) {
      this.order.push("open_episode");
      return rows<Row>([]);
    }
    if (
      statement.startsWith("with desired as materialized") &&
      statement.includes("update inbox_v2_source_thread_binding_heads")
    ) {
      this.advanced = true;
      this.order.push("update_head");
      return rows<Row>([{ revision: "2" }]);
    }
    if (
      statement.startsWith(
        "insert into inbox_v2_source_thread_binding_snapshots"
      )
    ) {
      this.order.push("insert_snapshot");
      return rows<Row>([]);
    }
    return rows<Row>([]);
  }
}

function identityRow(commit: InboxV2SourceThreadBindingCreationCommit) {
  const identity = commit.sourceAccountIdentity;
  if (identity.state !== "verified" || identity.canonicalIdentity === null) {
    throw new Error("fixture requires verified identity");
  }
  const canonical = identity.canonicalIdentity;
  return {
    source_account_id: identity.sourceAccount.id,
    source_connection_id: identity.sourceConnection.id,
    state: identity.state,
    revision: identity.revision,
    account_generation: identity.accountGeneration,
    identity_declaration: identity.identityDeclaration,
    canonical_key_digest_sha256: computeCanonicalAccountDigest(canonical),
    canonical_realm_id: canonical.realm.realmId,
    canonical_realm_version: canonical.realm.realmVersion,
    canonicalization_version: canonical.realm.canonicalizationVersion,
    canonical_object_kind_id: canonical.realm.objectKindId,
    canonical_scope_kind: canonical.scope.kind,
    canonical_scope_source_connection_id:
      canonical.scope.kind === "source_connection"
        ? canonical.scope.owner.id
        : null,
    canonical_external_subject: canonical.canonicalExternalSubject,
    updated_at: identity.updatedAt
  };
}

function transitionIdentityRow(
  commit: InboxV2SourceThreadBindingTransitionCommit
) {
  const snapshot = commit.before.binding.accountIdentitySnapshot;
  const declaration = snapshot.declaration;
  const canonical = {
    realm: {
      realmId: snapshot.realmId,
      realmVersion: declaration.realmVersion,
      canonicalizationVersion: declaration.canonicalizationVersion,
      objectKindId: declaration.objectKindId
    },
    scope:
      declaration.scopeKind === "provider"
        ? ({ kind: "provider" } as const)
        : ({
            kind: "source_connection",
            owner: snapshot.sourceConnection
          } as const),
    canonicalExternalSubject: snapshot.canonicalExternalSubject
  };
  return {
    source_account_id: snapshot.sourceAccount.id,
    source_connection_id: snapshot.sourceConnection.id,
    state: "verified",
    revision: "1",
    account_generation: snapshot.accountGeneration,
    identity_declaration: snapshot.declaration,
    canonical_key_digest_sha256: computeCanonicalAccountDigest(canonical),
    canonical_realm_id: snapshot.realmId,
    canonical_realm_version: declaration.realmVersion,
    canonicalization_version: declaration.canonicalizationVersion,
    canonical_object_kind_id: declaration.objectKindId,
    canonical_scope_kind: declaration.scopeKind,
    canonical_scope_source_connection_id:
      declaration.scopeKind === "source_connection"
        ? snapshot.sourceConnection.id
        : null,
    canonical_external_subject: snapshot.canonicalExternalSubject,
    updated_at: snapshot.verifiedAt
  };
}

function threadRow(commit: InboxV2SourceThreadBindingCreationCommit) {
  const thread = commit.externalThreadMapping.thread;
  const key = thread.key;
  return {
    id: thread.id,
    conversation_id: thread.conversation.id,
    conversation_transport: "external",
    conversation_topology: thread.conversationTopology,
    realm_id: key.realm.realmId,
    realm_version: key.realm.realmVersion,
    canonicalization_version: key.realm.canonicalizationVersion,
    scope_kind: key.scope.kind,
    scope_source_connection_id:
      key.scope.kind === "source_connection" ? key.scope.owner.id : null,
    scope_source_account_id:
      key.scope.kind === "source_account" ? key.scope.owner.id : null,
    object_kind_id: key.objectKindId,
    canonical_external_subject: key.canonicalExternalSubject,
    identity_declaration: thread.identityDeclaration,
    revision: thread.revision,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt
  };
}

function persistence() {
  return {
    accountIdentityRevision: "1",
    accountVerificationEvidenceSetId:
      "source_thread_binding_evidence_set:account-old",
    remoteAccessEvidenceSetId: "source_thread_binding_evidence_set:remote-old",
    providerAccessEvidenceSetId:
      "source_thread_binding_evidence_set:provider-old",
    capabilityEvidenceSetIds: [
      "source_thread_binding_evidence_set:capability-old"
    ],
    transitionId: null,
    expectedBindingRevision: null
  };
}

function computeCanonicalAccountDigest(
  key: NonNullable<
    InboxV2SourceThreadBindingCreationCommit["sourceAccountIdentity"]["canonicalIdentity"]
  >
): string {
  const scopeConnectionId =
    key.scope.kind === "source_connection" ? String(key.scope.owner.id) : null;
  return sha256(
    [
      "source-account-canonical-key:v1|",
      lengthPrefixed(String(key.realm.realmId)),
      lengthPrefixed(key.realm.realmVersion),
      lengthPrefixed(key.realm.canonicalizationVersion),
      lengthPrefixed(String(key.realm.objectKindId)),
      key.scope.kind === "provider" ? "8:provider" : "17:source_connection",
      scopeConnectionId === null ? "-1:" : lengthPrefixed(scopeConnectionId),
      lengthPrefixed(key.canonicalExternalSubject)
    ]
      .join("")
      .replaceAll("\\", "\\\\")
  );
}

function computeRouteDigest(descriptor: {
  adapterContract: typeof adapterContract;
  descriptorSchemaId: string;
  descriptorVersion: string;
  descriptorRevision: string;
  destinationKindId: string;
  destinationSubject: string;
  attributes: readonly { attributeId: string; value: string }[];
}): string {
  const adapter = descriptor.adapterContract;
  return sha256(
    [
      lengthPrefixed(adapter.contractId),
      lengthPrefixed(adapter.contractVersion),
      lengthPrefixed(adapter.declarationRevision),
      lengthPrefixed(adapter.surfaceId),
      lengthPrefixed(adapter.loadedByTrustedServiceId),
      lengthPrefixed(descriptor.descriptorSchemaId),
      lengthPrefixed(descriptor.descriptorVersion),
      lengthPrefixed(descriptor.descriptorRevision),
      lengthPrefixed(descriptor.destinationKindId),
      lengthPrefixed(descriptor.destinationSubject),
      ...[...descriptor.attributes]
        .sort((left, right) =>
          left.attributeId.localeCompare(right.attributeId)
        )
        .flatMap((attribute) => [
          lengthPrefixed(attribute.attributeId),
          lengthPrefixed(attribute.value)
        ])
    ].join("")
  );
}

function computeCapabilityDigest(
  snapshot: InboxV2SourceThreadBindingCreationCommit["initialProjection"]["binding"]["capabilities"]
): string {
  const adapter = snapshot.adapterContract;
  const entries = [...snapshot.entries]
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(
          `${left.capabilityId}\u0000${left.operationId}\u0000${left.contentKindId ?? ""}`,
          "utf8"
        ),
        Buffer.from(
          `${right.capabilityId}\u0000${right.operationId}\u0000${right.contentKindId ?? ""}`,
          "utf8"
        )
      )
    )
    .map((entry) => {
      const diagnostic = entry.diagnostic;
      const contentKey =
        entry.contentKindId === null
          ? "0:"
          : `1:${Buffer.byteLength(entry.contentKindId, "utf8")}:${entry.contentKindId}`;
      const roles = [...entry.requiredProviderRoleIds]
        .sort()
        .map(lengthPrefixed)
        .join("");
      return [
        entry.capabilityId,
        entry.operationId,
        contentKey,
        entry.state,
        entry.referencePortability,
        entry.validUntil === null ? "-" : String(Date.parse(entry.validUntil)),
        diagnostic?.codeId ?? "-",
        diagnostic === null ? "-" : String(diagnostic.retryable),
        diagnostic?.correlationToken ?? "-",
        diagnostic?.safeOperatorHintId ?? "-",
        roles
      ].join("|");
    })
    .join("");
  return sha256(
    lengthPrefixed(adapter.contractId) +
      lengthPrefixed(adapter.contractVersion) +
      `${adapter.declarationRevision}|` +
      lengthPrefixed(adapter.surfaceId) +
      lengthPrefixed(adapter.loadedByTrustedServiceId) +
      entries
  );
}

function lengthPrefixed(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function rows<Row extends Record<string, unknown>>(
  values: readonly Record<string, unknown>[]
): RawSqlQueryResult<Row> {
  return { rows: values as readonly Row[] };
}
