import {
  inboxV2BigintCounterSchema,
  inboxV2ExternalThreadAliasCommitSchema,
  inboxV2SourceConversationMaterializationPlanSchema,
  type InboxV2SourceConversationMaterializationPlan
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2ExternalThreadRepository,
  reserveInboxV2ExternalThreadExactKeyInTransaction
} from "./sql-inbox-v2-external-thread-repository";
import {
  createSqlInboxV2SourceConversationResolutionRepository,
  type CreateSqlInboxV2SourceConversationResolutionRepositoryOptions
} from "./sql-inbox-v2-source-conversation-resolution-repository";
import { computeInboxV2SourceThreadBindingRouteDescriptorDigest } from "./sql-inbox-v2-source-thread-binding-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `src005-${process.pid}-${Date.now().toString(36)}`;
const tenantId = `tenant:${runId}`;
const loadedAt = "2026-07-17T08:00:00.000Z";
const verifiedAt = "2026-07-17T08:00:30.000Z";
const recordedAt = "2026-07-17T08:01:00.000Z";
const materializedAt = "2026-07-17T08:02:00.000Z";
const adapterContract = {
  contractId: "module:synthetic-source:src005",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt
};
const allowPlan = Object.freeze({ verify: () => true });

const groupFirst = plan({
  account: "group-a",
  connection: "group-a",
  event: "group-a",
  candidate: "group-a",
  topology: "group",
  scope: "provider",
  threadSubject: "ProviderGroup:SharedCase",
  routeSubject: "ProviderGroup:Route-A"
});
const groupSecond = plan({
  account: "group-b",
  connection: "group-b",
  event: "group-b",
  candidate: "group-b-loser",
  topology: "group",
  scope: "provider",
  threadSubject: "ProviderGroup:SharedCase",
  routeSubject: "ProviderGroup:Route-B"
});
const privateFirst = plan({
  account: "private-a",
  connection: "private-a",
  event: "private-a",
  candidate: "private-a",
  topology: "direct",
  scope: "source_account",
  threadSubject: "Private:SamePeer",
  routeSubject: "Private:Route-A"
});
const privateSecond = plan({
  account: "private-b",
  connection: "private-b",
  event: "private-b",
  candidate: "private-b",
  topology: "direct",
  scope: "source_account",
  threadSubject: "Private:SamePeer",
  routeSubject: "Private:Route-B"
});
const concurrentFirst = plan({
  account: "concurrent",
  connection: "concurrent",
  event: "concurrent-a",
  candidate: "concurrent",
  topology: "group",
  scope: "provider",
  threadSubject: "ProviderGroup:Concurrent",
  routeSubject: "ProviderGroup:ConcurrentRoute"
});
const concurrentSecond = plan({
  account: "concurrent",
  connection: "concurrent",
  event: "concurrent-b",
  candidate: "concurrent",
  topology: "group",
  scope: "provider",
  threadSubject: "ProviderGroup:Concurrent",
  routeSubject: "ProviderGroup:ConcurrentRoute"
});
const canonicalPlan = plan({
  account: "alias",
  connection: "alias",
  event: "alias-canonical",
  candidate: "alias-canonical",
  topology: "direct",
  scope: "source_account",
  threadSubject: "Thread:CanonicalCase",
  routeSubject: "Alias:SharedRoute"
});
const aliasPlan = plan({
  account: "alias",
  connection: "alias",
  event: "alias-lookup",
  candidate: "alias-unused",
  topology: "direct",
  scope: "source_account",
  threadSubject: "Thread:LegacyCase",
  routeSubject: "Alias:SharedRoute",
  authoritativeThread: true
});
const caseUpperPlan = plan({
  account: "case-sensitive",
  connection: "case-sensitive",
  event: "case-upper",
  candidate: "case-upper",
  topology: "direct",
  scope: "source_account",
  threadSubject: "Thread:CaseSensitive",
  routeSubject: "Case:UpperRoute"
});
const caseLowerPlan = plan({
  account: "case-sensitive",
  connection: "case-sensitive",
  event: "case-lower",
  candidate: "case-lower",
  topology: "direct",
  scope: "source_account",
  threadSubject: "thread:casesensitive",
  routeSubject: "Case:LowerRoute"
});
const rollbackPlan = plan({
  account: "rollback",
  connection: "rollback",
  event: "rollback",
  candidate: "rollback",
  topology: "direct",
  scope: "source_account",
  threadSubject: "Thread:Rollback",
  routeSubject: "Rollback:Route"
});
const lockOrderPlan = plan({
  account: "lock-order",
  connection: "lock-order",
  event: "lock-order",
  candidate: "lock-order",
  topology: "direct",
  scope: "source_account",
  threadSubject: "Thread:LockOrder",
  routeSubject: "LockOrder:Route"
});
const allPlans = [
  groupFirst,
  groupSecond,
  privateFirst,
  privateSecond,
  concurrentFirst,
  concurrentSecond,
  canonicalPlan,
  aliasPlan,
  caseUpperPlan,
  caseLowerPlan,
  rollbackPlan,
  lockOrderPlan
] as const;

describePostgres(
  "SQL Inbox V2 source Conversation resolution PostgreSQL invariants",
  () => {
    let database: HuleeDatabase;
    let seeded = false;

    beforeAll(async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error(
          "DATABASE_URL is required for SRC-005 integration tests."
        );
      }
      database = createHuleeDatabase({
        connectionString: process.env.DATABASE_URL,
        poolConfig: { max: 12 }
      });
      await assertMigrationReady(database);
      await seedScope(database, allPlans);
      seeded = true;
    }, 30_000);

    afterAll(async () => {
      if (!database) return;
      try {
        if (seeded) {
          await cleanupScope(database);
        }
      } finally {
        await closeHuleeDatabase(database);
      }
    }, 30_000);

    it("converges a provider group concurrently across two accounts and connections", async () => {
      const repository = resolutionRepository(database);
      const [first, second] = await Promise.all([
        repository.resolve({
          plan: groupFirst,
          streamPosition: position("101")
        }),
        repository.resolve({
          plan: groupSecond,
          streamPosition: position("102")
        })
      ]);

      if (first.outcome !== "resolved" || second.outcome !== "resolved") {
        throw new Error("Expected both provider-group plans to resolve.");
      }
      expect([first.threadResolution, second.threadResolution].sort()).toEqual([
        "created",
        "matched_canonical"
      ]);
      expect(first.bindingResolution).toBe("created");
      expect(second.bindingResolution).toBe("created");
      expect(second.externalThreadMapping.thread.id).toBe(
        first.externalThreadMapping.thread.id
      );
      expect(second.sourceThreadBinding.binding.id).not.toBe(
        first.sourceThreadBinding.binding.id
      );
      await expect(
        mappingAndBindingCounts(database, [groupFirst, groupSecond])
      ).resolves.toEqual({
        conversations: "1",
        threads: "1",
        bindings: "2"
      });
    });

    it("separates concurrent account-scoped private chats across accounts and connections", async () => {
      const repository = resolutionRepository(database);
      const [first, second] = await Promise.all([
        repository.resolve({
          plan: privateFirst,
          streamPosition: position("103")
        }),
        repository.resolve({
          plan: privateSecond,
          streamPosition: position("104")
        })
      ]);

      expect(first).toMatchObject({
        outcome: "resolved",
        threadResolution: "created"
      });
      expect(second).toMatchObject({
        outcome: "resolved",
        threadResolution: "created"
      });
      if (first.outcome !== "resolved" || second.outcome !== "resolved") {
        throw new Error("Expected both private plans to resolve.");
      }
      expect(second.externalThreadMapping.thread.id).not.toBe(
        first.externalThreadMapping.thread.id
      );
      await expect(
        mappingAndBindingCounts(database, [privateFirst, privateSecond])
      ).resolves.toEqual({
        conversations: "2",
        threads: "2",
        bindings: "2"
      });
    });

    it("converges concurrent first events on one mapping and one account binding", async () => {
      const repository = resolutionRepository(database);
      const results = await Promise.all([
        repository.resolve({
          plan: concurrentFirst,
          streamPosition: position("105")
        }),
        repository.resolve({
          plan: concurrentSecond,
          streamPosition: position("106")
        })
      ]);

      expect(
        results.map((result) =>
          result.outcome === "resolved"
            ? `${result.threadResolution}/${result.bindingResolution}`
            : result.conflictCode
        )
      ).toEqual(
        expect.arrayContaining([
          "created/created",
          "matched_canonical/already_exists"
        ])
      );
      await expect(
        mappingAndBindingCounts(database, [concurrentFirst, concurrentSecond])
      ).resolves.toEqual({
        conversations: "1",
        threads: "1",
        bindings: "1"
      });
    });

    it("does not invert ExternalThread locks against binding-transition order", async () => {
      const repository = resolutionRepository(database);
      await expect(
        repository.resolve({
          plan: lockOrderPlan,
          streamPosition: position("120")
        })
      ).resolves.toMatchObject({
        outcome: "resolved",
        threadResolution: "created",
        bindingResolution: "created"
      });

      const bindingAndIdentityLocked = deferred<void>();
      const continueToExternalThread = deferred<void>();
      const transitionStyleTransaction = database.transaction(
        async (transaction) => {
          await transaction.execute(sql`set local lock_timeout = '3s'`);
          await transaction.execute(sql`
            select binding_id
            from inbox_v2_source_thread_binding_heads
            where tenant_id = ${tenantId}
              and binding_id = ${lockOrderPlan.candidateSourceThreadBindingId}
            for update
          `);
          await transaction.execute(sql`
            select source_account_id
            from inbox_v2_source_account_identities
            where tenant_id = ${tenantId}
              and source_account_id = ${lockOrderPlan.source.sourceAccount.id}
            for share
          `);
          bindingAndIdentityLocked.resolve();
          await continueToExternalThread.promise;
          await transaction.execute(sql`
            select id
            from inbox_v2_external_threads
            where tenant_id = ${tenantId}
              and id = ${lockOrderPlan.candidateExternalThreadId}
            for share
          `);
        }
      );
      void transitionStyleTransaction.catch((error) => {
        bindingAndIdentityLocked.reject(error);
      });
      await bindingAndIdentityLocked.promise;

      const replayApplicationName = `src005-lock-order-${runId}`;
      const orderedRepository = resolutionRepository(database, {
        dependencies: {
          reserveExternalThreadKey: async (transaction, input) => {
            await transaction.execute(
              sql`select set_config('application_name', ${replayApplicationName}, true)`
            );
            return reserveInboxV2ExternalThreadExactKeyInTransaction(
              transaction,
              input
            );
          }
        }
      });
      const replay = orderedRepository.resolve({
        plan: lockOrderPlan,
        streamPosition: position("121")
      });

      try {
        await waitForPostgresLockWait(database, replayApplicationName);
        continueToExternalThread.resolve();
        await transitionStyleTransaction;
      } catch (error) {
        continueToExternalThread.resolve();
        await Promise.allSettled([transitionStyleTransaction, replay]);
        throw error;
      }

      await expect(replay).resolves.toMatchObject({
        outcome: "resolved",
        threadResolution: "matched_canonical",
        bindingResolution: "already_exists"
      });
    });

    it("replays canonically, resolves a direct alias, and preserves opaque casing", async () => {
      const repository = resolutionRepository(database);
      const created = await repository.resolve({
        plan: canonicalPlan,
        streamPosition: position("107")
      });
      expect(created).toMatchObject({
        outcome: "resolved",
        threadResolution: "created",
        bindingResolution: "created"
      });
      if (created.outcome !== "resolved") {
        throw new Error("Expected canonical alias target to resolve.");
      }
      await expect(
        repository.resolve({
          plan: canonicalPlan,
          streamPosition: position("108")
        })
      ).resolves.toMatchObject({
        outcome: "resolved",
        threadResolution: "matched_canonical",
        bindingResolution: "already_exists"
      });

      const aliasCommit = inboxV2ExternalThreadAliasCommitSchema.parse({
        tenantId,
        canonicalThreadSnapshot: created.externalThreadMapping.thread,
        expectedCanonicalThreadRevision:
          created.externalThreadMapping.thread.revision,
        currentCanonicalThreadRevision:
          created.externalThreadMapping.thread.revision,
        aliases: [
          {
            tenantId,
            id: `external_thread_alias:${runId}`,
            aliasKey: aliasPlan.source.thread.key,
            aliasIdentityDeclaration:
              aliasPlan.source.thread.identityDeclaration,
            canonicalThread: {
              tenantId,
              kind: "external_thread",
              id: created.externalThreadMapping.thread.id
            },
            canonicalConversation: {
              tenantId,
              kind: "conversation",
              id: created.externalThreadMapping.conversation.id
            },
            canonicalKeySnapshot: created.externalThreadMapping.thread.key,
            expectedCanonicalThreadRevision:
              created.externalThreadMapping.thread.revision,
            decision: {
              actor: {
                kind: "trusted_service",
                trustedServiceId: "core:source-runtime"
              },
              policyId: "core:authoritative-thread-alias",
              policyVersion: "v1",
              reasonCodeId: "core:provider-thread-replacement",
              authoritativeEvidenceToken: `alias-evidence-${runId}`,
              decidedAt: materializedAt
            },
            revision: "1",
            createdAt: materializedAt
          }
        ],
        committedAt: materializedAt
      });
      await expect(
        createSqlInboxV2ExternalThreadRepository(database).appendAliases(
          aliasCommit
        )
      ).resolves.toMatchObject({ kind: "committed" });
      await expect(
        repository.resolve({
          plan: aliasPlan,
          streamPosition: position("109")
        })
      ).resolves.toMatchObject({
        outcome: "resolved",
        threadResolution: "matched_alias",
        bindingResolution: "already_exists",
        matchedAlias: {
          aliasKey: { canonicalExternalSubject: "Thread:LegacyCase" }
        },
        externalThreadMapping: {
          thread: {
            key: { canonicalExternalSubject: "Thread:CanonicalCase" }
          }
        }
      });

      const upper = await repository.resolve({
        plan: caseUpperPlan,
        streamPosition: position("110")
      });
      const lower = await repository.resolve({
        plan: caseLowerPlan,
        streamPosition: position("111")
      });
      expect(upper).toMatchObject({
        outcome: "resolved",
        threadResolution: "created"
      });
      expect(lower).toMatchObject({
        outcome: "resolved",
        threadResolution: "created"
      });
      if (upper.outcome !== "resolved" || lower.outcome !== "resolved") {
        throw new Error("Expected case-distinct plans to resolve.");
      }
      expect(upper.externalThreadMapping.thread.key).not.toEqual(
        lower.externalThreadMapping.thread.key
      );
    });

    it("rolls back Conversation/head/membership/key/thread when binding fails after mapping creation", async () => {
      const repository = resolutionRepository(database, {
        dependencies: {
          resolveBinding: async () => ({
            kind: "source_account_identity_conflict"
          })
        }
      });

      await expect(
        repository.resolve({
          plan: rollbackPlan,
          streamPosition: position("112")
        })
      ).resolves.toMatchObject({
        outcome: "conflict",
        conflictCode: "source.conversation_resolution.account_identity_conflict"
      });
      await expect(rollbackCounts(database, rollbackPlan)).resolves.toEqual({
        conversations: "0",
        conversation_heads: "0",
        membership_heads: "0",
        key_registry: "0",
        threads: "0",
        bindings: "0"
      });
    });
  }
);

function resolutionRepository(
  database: HuleeDatabase,
  overrides: Partial<CreateSqlInboxV2SourceConversationResolutionRepositoryOptions> = {}
) {
  return createSqlInboxV2SourceConversationResolutionRepository(database, {
    planAuthorizationVerifier: allowPlan,
    ...overrides
  });
}

function plan(input: {
  account: string;
  connection: string;
  event: string;
  candidate: string;
  topology: "direct" | "group";
  scope: "provider" | "source_account";
  threadSubject: string;
  routeSubject: string;
  authoritativeThread?: boolean;
}): InboxV2SourceConversationMaterializationPlan {
  const sourceConnection = {
    tenantId,
    kind: "source_connection" as const,
    id: `source_connection:${input.connection}-${runId}`
  };
  const sourceAccount = {
    tenantId,
    kind: "source_account" as const,
    id: `source_account:${input.account}-${runId}`
  };
  const rawInboundEvent = {
    tenantId,
    kind: "raw_inbound_event" as const,
    id: `raw_inbound_event:${input.event}-${runId}`
  };
  const normalizedInboundEvent = {
    tenantId,
    kind: "normalized_inbound_event" as const,
    id: `normalized_inbound_event:${input.event}-${runId}`
  };
  const threadKey = {
    realm: {
      realmId: "module:synthetic-source:thread-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope:
      input.scope === "provider"
        ? ({ kind: "provider" } as const)
        : ({ kind: "source_account", owner: sourceAccount } as const),
    objectKindId: "module:synthetic-source:chat",
    canonicalExternalSubject: input.threadSubject
  };
  const source = {
    tenantId,
    rawInboundEvent,
    normalizedInboundEvent,
    sourceConnection,
    sourceAccount,
    domain: "core:inbox-v2.normalized-event-safe-envelope" as const,
    schemaId: "core:inbox-v2.normalized-event-envelope" as const,
    schemaVersion: "v1" as const,
    safeEnvelopeHmacSha256: `hmac-sha256:${hash(input.event)}`,
    adapterContract,
    thread: {
      sourceConnection,
      sourceAccount,
      identityDeclaration: {
        adapterContract,
        identityKind: "external_thread" as const,
        realmId: threadKey.realm.realmId,
        realmVersion: threadKey.realm.realmVersion,
        canonicalizationVersion: threadKey.realm.canonicalizationVersion,
        objectKindId: threadKey.objectKindId,
        scopeKind: input.scope,
        decisionStrength:
          input.scope === "provider" || input.authoritativeThread
            ? ("authoritative" as const)
            : ("safe_default" as const)
      },
      key: threadKey,
      observedExternalSubject: threadKey.canonicalExternalSubject
    },
    recordedAt
  };
  const descriptorWithoutDigest = {
    adapterContract,
    descriptorSchemaId: "module:synthetic-source:direct-route",
    descriptorVersion: "v1",
    descriptorRevision: "1" as const,
    destinationKindId: "module:synthetic-source:peer",
    destinationSubject: input.routeSubject,
    attributes: []
  };
  const routeDescriptor = {
    ...descriptorWithoutDigest,
    descriptorDigestSha256:
      computeInboxV2SourceThreadBindingRouteDescriptorDigest({
        ...descriptorWithoutDigest,
        descriptorDigestSha256: "0".repeat(64)
      } as never)
  };
  return inboxV2SourceConversationMaterializationPlanSchema.parse({
    source,
    topology: input.topology,
    purposeId: "core:chat",
    routeDescriptor,
    candidateConversationId: `conversation:${input.candidate}-${runId}`,
    candidateExternalThreadId: `external_thread:${input.candidate}-${runId}`,
    candidateSourceThreadBindingId: `source_thread_binding:${input.account}-${input.candidate}-${runId}`,
    candidateRemoteAccessEpisodeId: `source_thread_binding_remote_access_episode:${input.account}-${input.candidate}-${runId}`,
    capabilityEntries: [],
    historySyncState: "not_started",
    namespaceGeneration: `namespace-generation-${runId}`,
    materializedByTrustedServiceId: "core:source-runtime",
    materializationToken: `materialization-${input.event}-${runId}`,
    materializedAt
  });
}

async function seedScope(
  database: HuleeDatabase,
  plans: readonly InboxV2SourceConversationMaterializationPlan[]
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (${tenantId}, ${runId}, 'SRC-005 integration tenant', 'saas_shared')
    `);
    const connections = new Map<string, string>();
    for (const candidate of plans) {
      connections.set(
        candidate.source.sourceConnection.id,
        candidate.source.sourceConnection.id.replace(/^source_connection:/u, "")
      );
    }
    for (const [sourceConnectionId, label] of connections) {
      await transaction.execute(sql`
        insert into source_connections (
          id, tenant_id, source_type, source_name, display_name
        ) values (
          ${sourceConnectionId}, ${tenantId}, 'messenger', 'synthetic',
          ${`SRC-005 synthetic ${label}`}
        )
      `);
    }

    const accounts = new Map<
      string,
      InboxV2SourceConversationMaterializationPlan
    >();
    for (const candidate of plans) {
      accounts.set(candidate.source.sourceAccount.id, candidate);
    }
    for (const accountPlan of accounts.values()) {
      await seedAccount(transaction, accountPlan);
    }
    for (const eventPlan of plans) {
      await seedNormalizedEvent(transaction, eventPlan);
    }
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

async function seedAccount(
  executor: { execute(query: SQL): Promise<unknown> },
  accountPlan: InboxV2SourceConversationMaterializationPlan
): Promise<void> {
  const accountId = accountPlan.source.sourceAccount.id;
  const sourceConnectionId = accountPlan.source.sourceConnection.id;
  const accountLabel = accountId.replace(/^source_account:/u, "");
  const declaration = {
    adapterContract,
    identityKind: "source_account",
    realmId: "module:synthetic-source:account-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:user-account",
    scopeKind: "source_connection",
    decisionStrength: "authoritative"
  };
  const canonicalSubject = `ProviderAccount:${accountLabel}`;
  const transitionId = `source_account_identity_transition:${accountLabel}`;
  const evidenceToken = `identity-evidence-${accountLabel}`;

  await executor.execute(sql`
    insert into source_accounts (
      id, tenant_id, source_connection_id, account_type, display_name
    ) values (
      ${accountId}, ${tenantId}, ${sourceConnectionId}, 'direct_number',
      ${`SRC-005 ${accountLabel}`}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_account_identities (
      tenant_id, source_account_id, source_connection_id, state,
      identity_declaration, declaration_contract_id,
      declaration_contract_version, declaration_revision,
      declaration_surface_id, declaration_loaded_by_trusted_service_id,
      declaration_loaded_at, declaration_realm_id,
      declaration_realm_version, declaration_canonicalization_version,
      declaration_object_kind_id, declaration_scope_kind,
      canonical_realm_id, canonical_realm_version,
      canonicalization_version, canonical_object_kind_id,
      canonical_scope_kind, canonical_scope_source_connection_id,
      canonical_scope_owner_key, canonical_external_subject,
      verified_decision_actor_trusted_service_id,
      verified_decision_policy_id, verified_decision_policy_version,
      verified_decision_reason_code_id,
      verified_decision_verification_evidence_token,
      verified_decision_decided_at, account_generation, revision,
      created_at, updated_at
    ) values (
      ${tenantId}, ${accountId}, ${sourceConnectionId}, 'verified',
      ${JSON.stringify(declaration)}::jsonb,
      ${adapterContract.contractId}, ${adapterContract.contractVersion}, 1,
      ${adapterContract.surfaceId},
      ${adapterContract.loadedByTrustedServiceId}, ${loadedAt},
      ${declaration.realmId}, ${declaration.realmVersion},
      ${declaration.canonicalizationVersion}, ${declaration.objectKindId},
      'source_connection', ${declaration.realmId},
      ${declaration.realmVersion}, ${declaration.canonicalizationVersion},
      ${declaration.objectKindId}, 'source_connection', ${sourceConnectionId},
      ${sourceConnectionId}, ${canonicalSubject},
      ${adapterContract.loadedByTrustedServiceId},
      'core:provider-account-verification', 'v1',
      'core:account-verified', ${evidenceToken}, ${verifiedAt},
      2, 2, ${loadedAt}, ${verifiedAt}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_account_identity_verified_snapshots (
      tenant_id, source_account_id, source_connection_id, transition_id,
      identity_revision, account_generation, state,
      identity_declaration, declaration_contract_id,
      declaration_contract_version, declaration_revision,
      declaration_surface_id, declaration_loaded_by_trusted_service_id,
      declaration_loaded_at, declaration_realm_id,
      declaration_realm_version, declaration_canonicalization_version,
      declaration_object_kind_id, declaration_scope_kind,
      canonical_realm_id, canonical_realm_version,
      canonicalization_version, canonical_object_kind_id,
      canonical_scope_kind, canonical_scope_source_connection_id,
      canonical_scope_owner_key, canonical_external_subject,
      verified_decision_actor_trusted_service_id,
      verified_decision_policy_id, verified_decision_policy_version,
      verified_decision_reason_code_id,
      verified_decision_verification_evidence_token,
      verified_decision_decided_at, identity_created_at, verified_at
    ) values (
      ${tenantId}, ${accountId}, ${sourceConnectionId}, ${transitionId}, 2, 2,
      'verified', ${JSON.stringify(declaration)}::jsonb,
      ${adapterContract.contractId}, ${adapterContract.contractVersion}, 1,
      ${adapterContract.surfaceId},
      ${adapterContract.loadedByTrustedServiceId}, ${loadedAt},
      ${declaration.realmId}, ${declaration.realmVersion},
      ${declaration.canonicalizationVersion}, ${declaration.objectKindId},
      'source_connection', ${declaration.realmId},
      ${declaration.realmVersion}, ${declaration.canonicalizationVersion},
      ${declaration.objectKindId}, 'source_connection', ${sourceConnectionId},
      ${sourceConnectionId}, ${canonicalSubject},
      ${adapterContract.loadedByTrustedServiceId},
      'core:provider-account-verification', 'v1',
      'core:account-verified', ${evidenceToken}, ${verifiedAt},
      ${loadedAt}, ${verifiedAt}
    )
  `);
}

async function seedNormalizedEvent(
  executor: { execute(query: SQL): Promise<unknown> },
  eventPlan: InboxV2SourceConversationMaterializationPlan
): Promise<void> {
  const source = eventPlan.source;
  const rawId = source.rawInboundEvent.id;
  const normalizedId = source.normalizedInboundEvent.id;
  const accountId = source.sourceAccount.id;
  const sourceConnectionId = source.sourceConnection.id;
  const scopeKey = `1:${Buffer.byteLength(accountId, "utf8")}:${accountId}`;
  const safeEnvelope = {
    domain: source.domain,
    adapterContract: source.adapterContract,
    thread: source.thread,
    identityObservations: [],
    rosterObservation: null
  };

  await executor.execute(sql`
    insert into raw_inbound_events (
      id, tenant_id, source_connection_id, source_account_id,
      idempotency_key, received_at, payload, headers,
      processing_status, created_at, updated_at
    ) values (
      ${rawId}, ${tenantId}, ${sourceConnectionId}, ${accountId},
      ${`raw-${hash(rawId)}`}, ${recordedAt}, '{}'::jsonb, '{}'::jsonb,
      'processed', ${recordedAt}, ${recordedAt}
    )
  `);
  await executor.execute(sql`
    insert into normalized_inbound_events (
      id, tenant_id, raw_event_id, source_connection_id, source_account_id,
      source_type, source_name, event_type, direction, visibility,
      payload_version, normalized_payload, reply_capability,
      idempotency_key, processing_status, created_at, updated_at
    ) values (
      ${normalizedId}, ${tenantId}, ${rawId}, ${sourceConnectionId}, ${accountId},
      'messenger', 'synthetic', 'message', 'inbound', 'private',
      'v1', '{}'::jsonb, '{}'::jsonb, ${`normalized-${hash(normalizedId)}`},
      'processed', ${recordedAt}, ${recordedAt}
    )
  `);
  await executor.execute(sql`
    insert into inbox_v2_source_normalized_envelopes (
      tenant_id, normalized_event_id, raw_event_id, source_connection_id,
      source_account_id, source_account_scope_key, normalized_ordinal,
      idempotency_key, source_type, source_name, event_type, direction,
      visibility, provider_occurred_at, payload_schema_id,
      payload_schema_version, capability_schema_id,
      capability_schema_version, capability_hmac_sha256,
      identity_observation_count, roster_completeness, roster_authority,
      roster_omission_policy, normalizer_id, normalizer_version,
      normalizer_declaration_revision, adapter_contract_id,
      adapter_contract_version, adapter_declaration_revision,
      adapter_surface_id, safe_envelope_schema_id,
      safe_envelope_schema_version, digest_key_generation,
      safe_envelope_hmac_sha256, safe_envelope, normalized_evidence_count,
      data_class_id, sensitivity_class, processing_purpose_id,
      canonical_anchor_id, expiry_action, normalized_at, created_at
    ) values (
      ${tenantId}, ${normalizedId}, ${rawId}, ${sourceConnectionId}, ${accountId},
      ${scopeKey}, 0, ${`source:v2:normalized:${hash(normalizedId)}`},
      'messenger', 'synthetic', 'message', 'inbound', 'private', null,
      'module:synthetic-source:event', 'v1',
      'module:synthetic-source:capabilities', 'v1',
      ${`hmac-sha256:${hash(`capability-${normalizedId}`)}`}, 0,
      null, null, null, 'module:synthetic-source:normalizer', 'v1', 1,
      ${adapterContract.contractId}, ${adapterContract.contractVersion}, 1,
      ${adapterContract.surfaceId}, ${source.schemaId}, ${source.schemaVersion},
      'src005-test-v1', ${source.safeEnvelopeHmacSha256},
      ${JSON.stringify(safeEnvelope)}::jsonb, 0,
      'core:normalized_event_envelope', 'personal_operational',
      'core:source_replay_and_diagnostics',
      'core:materialization_or_final_failure', 'compact_to_safe_skeleton',
      ${recordedAt}, ${recordedAt}
    )
  `);
}

async function mappingAndBindingCounts(
  database: HuleeDatabase,
  plans: readonly InboxV2SourceConversationMaterializationPlan[]
): Promise<{
  conversations: string;
  threads: string;
  bindings: string;
}> {
  const accountIds = plans.map(
    (candidate) => candidate.source.sourceAccount.id
  );
  const result = await database.execute<{
    conversations: string;
    threads: string;
    bindings: string;
  }>(sql`
    select
      count(distinct conversation.id)::text as conversations,
      count(distinct thread.id)::text as threads,
      count(distinct binding.id)::text as bindings
    from inbox_v2_external_threads thread
    join inbox_v2_conversations conversation
      on conversation.tenant_id = thread.tenant_id
     and conversation.id = thread.conversation_id
    left join inbox_v2_source_thread_bindings binding
      on binding.tenant_id = thread.tenant_id
     and binding.external_thread_id = thread.id
     and binding.source_account_id in (${sql.join(
       accountIds.map((id) => sql`${id}`),
       sql`, `
     )})
    where thread.tenant_id = ${tenantId}
      and thread.id in (
        ${sql.join(
          plans.map((candidate) => sql`${candidate.candidateExternalThreadId}`),
          sql`, `
        )}
      )
  `);
  return result.rows[0]!;
}

async function rollbackCounts(
  database: HuleeDatabase,
  candidate: InboxV2SourceConversationMaterializationPlan
) {
  const result = await database.execute<Record<string, string>>(sql`
    select
      (select count(*)::text from inbox_v2_conversations
        where tenant_id = ${tenantId}
          and id = ${candidate.candidateConversationId}) as conversations,
      (select count(*)::text from inbox_v2_conversation_heads
        where tenant_id = ${tenantId}
          and conversation_id = ${candidate.candidateConversationId}) as conversation_heads,
      (select count(*)::text from inbox_v2_conversation_membership_heads
        where tenant_id = ${tenantId}
          and conversation_id = ${candidate.candidateConversationId}) as membership_heads,
      (select count(*)::text from inbox_v2_external_thread_key_registry
        where tenant_id = ${tenantId}
          and canonical_thread_id = ${candidate.candidateExternalThreadId}) as key_registry,
      (select count(*)::text from inbox_v2_external_threads
        where tenant_id = ${tenantId}
          and id = ${candidate.candidateExternalThreadId}) as threads,
      (select count(*)::text from inbox_v2_source_thread_bindings
        where tenant_id = ${tenantId}
          and id = ${candidate.candidateSourceThreadBindingId}) as bindings
  `);
  return result.rows[0]!;
}

async function assertMigrationReady(database: HuleeDatabase): Promise<void> {
  const result = await database.execute<{
    normalized: string | null;
    registry: string | null;
    bindings: string | null;
  }>(sql`
    select
      to_regclass('public.inbox_v2_source_normalized_envelopes')::text as normalized,
      to_regclass('public.inbox_v2_external_thread_key_registry')::text as registry,
      to_regclass('public.inbox_v2_source_thread_binding_heads')::text as bindings
  `);
  expect(result.rows[0]).toEqual({
    normalized: "inbox_v2_source_normalized_envelopes",
    registry: "inbox_v2_external_thread_key_registry",
    bindings: "inbox_v2_source_thread_binding_heads"
  });
}

async function cleanupScope(database: HuleeDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    for (const table of [
      "inbox_v2_source_thread_binding_transition_matched_permissions",
      "inbox_v2_source_thread_binding_transitions",
      "inbox_v2_source_thread_binding_capability_required_roles",
      "inbox_v2_source_thread_binding_capability_entries",
      "inbox_v2_source_thread_binding_provider_roles",
      "inbox_v2_source_thread_binding_route_attributes",
      "inbox_v2_source_thread_binding_snapshots",
      "inbox_v2_source_thread_binding_heads",
      "inbox_v2_source_thread_binding_remote_access_episodes",
      "inbox_v2_source_thread_binding_evidence_references",
      "inbox_v2_source_thread_binding_evidence_sets",
      "inbox_v2_source_thread_bindings",
      "inbox_v2_external_thread_aliases",
      "inbox_v2_external_threads",
      "inbox_v2_external_thread_key_registry",
      "inbox_v2_conversation_membership_heads",
      "inbox_v2_conversation_heads",
      "inbox_v2_conversations",
      "inbox_v2_source_account_identity_verified_snapshots",
      "inbox_v2_source_account_identities",
      "inbox_v2_source_normalized_envelopes",
      "normalized_inbound_events",
      "raw_inbound_events",
      "source_accounts",
      "source_connections"
    ]) {
      await transaction.execute(
        sql.raw(
          `delete from public.${table} where tenant_id = '${tenantId.replaceAll("'", "''")}'`
        )
      );
    }
    await transaction.execute(sql`delete from tenants where id = ${tenantId}`);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

async function waitForPostgresLockWait(
  database: HuleeDatabase,
  applicationName: string
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await database.execute<{ waiting: boolean }>(sql`
      select exists (
        select 1
        from pg_stat_activity
        where datname = current_database()
          and application_name = ${applicationName}
          and wait_event_type = 'Lock'
      ) as waiting
    `);
    if (result.rows[0]?.waiting === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    "Timed out waiting for source Conversation replay to block on BindingHead."
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function position(value: string) {
  return inboxV2BigintCounterSchema.parse(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
