import {
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2ConversationIdSchema,
  inboxV2ExternalThreadAliasIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  type InboxV2AdapterIdentityDeclaration,
  type InboxV2Conversation,
  type InboxV2ExternalThreadAlias,
  type InboxV2ExternalThreadAliasCommit,
  type InboxV2ExternalThreadKey,
  type InboxV2ExternalThreadMapping,
  type InboxV2TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import {
  buildAcquireInboxV2ExternalThreadAdvisoryLockSql,
  buildFindInboxV2ExternalThreadAliasByIdSql,
  buildFindInboxV2ExternalThreadKeyRegistrySql,
  buildFindInboxV2ExternalThreadMappingByIdSql,
  buildInsertInboxV2ExternalThreadKeyRegistrySql,
  computeInboxV2ExternalThreadKeyDigest,
  createSqlInboxV2ExternalThreadRepository,
  type InboxV2ExternalThreadTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult,
  type ResolveOrCreateInboxV2ExternalThreadInput
} from "./sql-inbox-v2-external-thread-repository";

const tenantId = "tenant:db-003-thread" as InboxV2TenantId;
const otherTenantId = "tenant:db-003-thread-other" as InboxV2TenantId;
const createdAt = "2026-07-13T13:00:00.000Z";
const aliasCreatedAt = "2026-07-13T13:01:00.000Z";

describe("SQL Inbox V2 ExternalThread repository", () => {
  it("matches the PostgreSQL core digest expression and emits tenant-qualified SQL", () => {
    const providerKey = makeKey({
      scope: { kind: "provider" },
      subject: "Room:Case-Sensitive-ABC"
    });
    expect(computeInboxV2ExternalThreadKeyDigest(providerKey)).toBe(
      "bf1182ab9fdfff779d72069920139df41daa077f69f480d3e575ef09411d35d6"
    );

    const mapping = makeMapping({ key: providerKey });
    const digest = computeInboxV2ExternalThreadKeyDigest(mapping.thread.key);
    const registry = renderQuery(
      buildInsertInboxV2ExternalThreadKeyRegistrySql({
        tenantId,
        registryId: `external_thread_key:${digest}`,
        entryKind: "canonical",
        key: mapping.thread.key,
        canonicalThreadId: mapping.thread.id,
        canonicalConversationId: mapping.conversation.id,
        createdAt
      })
    );
    const findRegistry = renderQuery(
      buildFindInboxV2ExternalThreadKeyRegistrySql({
        tenantId,
        keyDigest: digest,
        lock: true
      })
    );
    const findMapping = renderQuery(
      buildFindInboxV2ExternalThreadMappingByIdSql({
        tenantId,
        threadId: mapping.thread.id
      })
    );
    const advisory = renderQuery(
      buildAcquireInboxV2ExternalThreadAdvisoryLockSql({
        namespace: "key",
        tenantId,
        value: digest
      })
    );

    expect(registry.sql).toContain(
      "insert into inbox_v2_external_thread_key_registry"
    );
    expect(registry.sql).toContain("on conflict do nothing");
    expect(findRegistry.sql).toContain("where r.tenant_id = $1");
    expect(findRegistry.sql).toContain("and r.key_digest = $2");
    expect(findRegistry.sql).toContain("for update");
    expect(findMapping.sql).toContain("where t.tenant_id = $1");
    expect(findMapping.sql).toContain("and t.id = $2");
    expect(advisory.sql).toContain("pg_advisory_xact_lock");
    expect(advisory.params[0]).toContain(`${tenantId}:${digest}`);
    expect(() =>
      buildFindInboxV2ExternalThreadAliasByIdSql({ tenantId } as never)
    ).toThrow(/exactly one valid alias or registry ID/u);
    expect(() =>
      buildFindInboxV2ExternalThreadAliasByIdSql({
        tenantId,
        aliasId: inboxV2ExternalThreadAliasIdSchema.parse(
          "external_thread_alias:ambiguous"
        ),
        registryId: `external_thread_key:${digest}`
      } as never)
    ).toThrow(/exactly one valid alias or registry ID/u);
  });

  it("reserves the key namespace first and converges concurrent exact creates", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const input = makeResolveInput();

    const results = await Promise.all([
      repository.resolveOrCreateExactMapping(input),
      repository.resolveOrCreateExactMapping(input)
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      "already_exists",
      "created"
    ]);
    expect(executor.counts()).toEqual({
      conversations: 1,
      membershipHeads: 1,
      registries: 1,
      threads: 1,
      aliases: 0
    });
    expect(executor.advisoryTokens[0]).toContain(
      "inbox-v2:external-thread:key:"
    );

    const firstTransactionStatements = executor.transactionStatements[0] ?? [];
    expect(firstTransactionStatements[0]).toContain("pg_advisory_xact_lock");
    // The immediate registry -> Conversation FK makes this physical insert
    // order necessary after the advisory namespace reservation.
    expect(
      firstTransactionStatements.findIndex((statement) =>
        statement.startsWith("insert into inbox_v2_conversations")
      )
    ).toBeLessThan(
      firstTransactionStatements.findIndex((statement) =>
        statement.startsWith(
          "insert into inbox_v2_external_thread_key_registry"
        )
      )
    );
  });

  it("keeps exact resolution idempotent after mutable Conversation state advances", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const input = makeResolveInput();
    await repository.resolveOrCreateExactMapping(input);

    executor.unsafeMutateConversation(input.mapping.conversation.id, {
      lifecycle: "ended",
      revision: "2" as never,
      updatedAt: "2026-07-13T13:02:00.000Z"
    });

    const repeated = await repository.resolveOrCreateExactMapping(input);
    expect(repeated).toMatchObject({
      kind: "already_exists",
      mapping: {
        thread: input.mapping.thread,
        conversation: {
          id: input.mapping.conversation.id,
          lifecycle: "ended",
          revision: "2"
        }
      }
    });
    expect(executor.counts()).toMatchObject({
      conversations: 1,
      membershipHeads: 1,
      threads: 1
    });
  });

  it("treats equivalent timestamp offsets as the same immutable mapping", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const input = makeResolveInput();
    await repository.resolveOrCreateExactMapping(input);

    const repeated = await repository.resolveOrCreateExactMapping({
      ...input,
      mapping: {
        ...input.mapping,
        thread: {
          ...input.mapping.thread,
          createdAt: "2026-07-13T16:00:00.000+03:00",
          updatedAt: "2026-07-13T16:00:00.000+03:00"
        }
      }
    });

    expect(repeated.kind).toBe("already_exists");
  });

  it("never adopts a pre-existing unowned Conversation chosen by the caller", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const input = makeResolveInput();
    executor.unsafeSeedConversation(input.mapping.conversation);

    const result = await repository.resolveOrCreateExactMapping(input);

    expect(result).toMatchObject({
      kind: "conversation_identity_conflict",
      existingConversation: { id: input.mapping.conversation.id }
    });
    expect(executor.counts()).toEqual({
      conversations: 1,
      membershipHeads: 0,
      registries: 0,
      threads: 0,
      aliases: 0
    });
  });

  it("never remaps an exact key or a Conversation to a different peer", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const first = makeResolveInput();
    await repository.resolveOrCreateExactMapping(first);

    const sameKeyOtherConversation = makeResolveInput({
      mapping: makeMapping({
        key: first.mapping.thread.key,
        threadId: "external_thread:same-key-other-thread",
        conversationId: "conversation:same-key-other-conversation"
      })
    });
    const exactKeyConflict = await repository.resolveOrCreateExactMapping(
      sameKeyOtherConversation
    );
    expect(exactKeyConflict.kind).toBe("exact_key_conflict");

    const otherKeySameConversation = makeResolveInput({
      mapping: makeMapping({
        subject: "Room:Different-Key",
        threadId: "external_thread:different-key-thread",
        conversationId: first.mapping.conversation.id
      })
    });
    const conversationConflict = await repository.resolveOrCreateExactMapping(
      otherKeySameConversation
    );
    expect(conversationConflict).toMatchObject({
      kind: "conversation_conflict",
      existingThreadId: first.mapping.thread.id,
      conversationId: first.mapping.conversation.id
    });
    expect(executor.counts()).toMatchObject({
      conversations: 1,
      membershipHeads: 1,
      threads: 1
    });
  });

  it("keeps tenant, opaque casing and exact scope owner separate", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const accountScope = {
      kind: "source_account" as const,
      owner: {
        tenantId,
        kind: "source_account" as const,
        id: inboxV2SourceAccountIdSchema.parse("source_account:operator-a")
      }
    };

    const inputs = [
      makeResolveInput({
        mapping: makeMapping({ subject: "OpaqueCase" })
      }),
      makeResolveInput({
        mapping: makeMapping({
          subject: "opaquecase",
          threadId: "external_thread:lowercase",
          conversationId: "conversation:lowercase"
        })
      }),
      makeResolveInput({
        mapping: makeMapping({
          subject: "OpaqueCase",
          scope: accountScope,
          threadId: "external_thread:account-scope",
          conversationId: "conversation:account-scope"
        })
      }),
      makeResolveInput({
        mapping: makeMapping({
          tenant: otherTenantId,
          subject: "OpaqueCase",
          threadId: "external_thread:canonical",
          conversationId: "conversation:canonical"
        })
      })
    ];

    const results = await Promise.all(
      inputs.map((input) => repository.resolveOrCreateExactMapping(input))
    );
    expect(results.map((result) => result.kind)).toEqual([
      "created",
      "created",
      "created",
      "created"
    ]);
    expect(executor.counts()).toMatchObject({
      conversations: 4,
      membershipHeads: 4,
      registries: 4,
      threads: 4
    });
  });

  it("rejects cross-tenant scoped lookup keys before opening a transaction", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const scopedKeys = [
      makeKey({
        scope: {
          kind: "source_account",
          owner: {
            tenantId: otherTenantId,
            kind: "source_account",
            id: inboxV2SourceAccountIdSchema.parse(
              "source_account:cross-tenant-lookup"
            )
          }
        },
        subject: "CrossTenantAccount"
      }),
      makeKey({
        scope: {
          kind: "source_connection",
          owner: {
            tenantId: otherTenantId,
            kind: "source_connection",
            id: inboxV2SourceConnectionIdSchema.parse(
              "source_connection:cross-tenant-lookup"
            )
          }
        },
        subject: "CrossTenantConnection"
      })
    ];

    for (const key of scopedKeys) {
      await expect(
        repository.findByExactKey({ tenantId, key })
      ).rejects.toThrow();
    }
    expect(executor.transactionStatements).toHaveLength(0);
  });

  it("fails closed on a digest hit whose full raw key differs", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const canonical = makeResolveInput();
    await repository.resolveOrCreateExactMapping(canonical);
    const colliding = makeResolveInput({
      mapping: makeMapping({
        subject: "Actual-Different-Key",
        threadId: "external_thread:digest-candidate",
        conversationId: "conversation:digest-candidate"
      })
    });
    executor.unsafeReserveDigestForDifferentRawKey(
      colliding.mapping.thread.key,
      canonical.mapping
    );

    await expect(
      repository.resolveOrCreateExactMapping(colliding)
    ).resolves.toEqual({ kind: "digest_collision" });
    await expect(
      repository.findByExactKey({
        tenantId,
        key: colliding.mapping.thread.key
      })
    ).resolves.toEqual({ kind: "digest_collision" });
    expect(executor.counts()).toMatchObject({
      conversations: 1,
      membershipHeads: 1,
      threads: 1
    });
  });

  it("rolls back candidate Conversation/Head when the durable registry reservation loses", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    executor.failNextRegistryInsert = true;

    await expect(
      repository.resolveOrCreateExactMapping(makeResolveInput())
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
    expect(executor.rollbackCount).toBe(1);
    expect(executor.counts()).toEqual({
      conversations: 0,
      membershipHeads: 0,
      registries: 0,
      threads: 0,
      aliases: 0
    });
  });

  it("commits bounded aliases idempotently and resolves them directly", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const input = makeResolveInput();
    await repository.resolveOrCreateExactMapping(input);
    const commit = makeAliasCommit(input.mapping);

    const created = await repository.appendAliases(commit);
    const duplicate = await repository.appendAliases(commit);
    const resolved = await repository.findByExactKey({
      tenantId,
      key: commit.aliases[0]!.aliasKey
    });

    expect(created.kind).toBe("committed");
    expect(duplicate.kind).toBe("already_exists");
    expect(resolved).toMatchObject({
      kind: "found",
      reservationKind: "alias",
      mapping: input.mapping,
      matchedAlias: commit.aliases[0]
    });
    expect(executor.counts()).toMatchObject({
      membershipHeads: 1,
      registries: 2,
      aliases: 1
    });
  });

  it("keeps alias retries idempotent across equivalent timestamp offsets", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const input = makeResolveInput();
    await repository.resolveOrCreateExactMapping(input);
    const commit = makeAliasCommit(input.mapping);
    await repository.appendAliases(commit);

    const repeated = await repository.appendAliases({
      ...commit,
      committedAt: "2026-07-13T16:01:00.000+03:00",
      aliases: commit.aliases.map((alias) => ({
        ...alias,
        decision: {
          ...alias.decision,
          decidedAt: "2026-07-13T16:01:00.000+03:00"
        },
        createdAt: "2026-07-13T16:01:00.000+03:00"
      }))
    });

    expect(repeated.kind).toBe("already_exists");
  });

  it("fails closed when an alias row diverges from its registry raw key", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const input = makeResolveInput();
    await repository.resolveOrCreateExactMapping(input);
    const commit = makeAliasCommit(input.mapping);
    await repository.appendAliases(commit);
    executor.unsafeMutateAlias(commit.aliases[0]!.id, {
      aliasKey: makeKey({
        scope: commit.aliases[0]!.aliasKey.scope,
        subject: "Legacy:Corrupted-Room"
      })
    });

    await expect(
      repository.findByExactKey({
        tenantId,
        key: commit.aliases[0]!.aliasKey
      })
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
  });

  it("makes canonical-vs-alias races deterministic in the shared registry", async () => {
    const aliasFirstExecutor = new StatefulExternalThreadExecutor();
    const aliasFirstRepository =
      createSqlInboxV2ExternalThreadRepository(aliasFirstExecutor);
    const canonical = makeResolveInput();
    await aliasFirstRepository.resolveOrCreateExactMapping(canonical);
    const aliasCommit = makeAliasCommit(canonical.mapping);
    const aliasKeyMapping = makeResolveInput({
      mapping: makeMapping({
        key: aliasCommit.aliases[0]!.aliasKey,
        threadId: "external_thread:alias-race-candidate",
        conversationId: "conversation:alias-race-candidate"
      })
    });

    const [aliasWinner, canonicalLoser] = await Promise.all([
      aliasFirstRepository.appendAliases(aliasCommit),
      aliasFirstRepository.resolveOrCreateExactMapping(aliasKeyMapping)
    ]);
    expect(aliasWinner.kind).toBe("committed");
    expect(canonicalLoser.kind).toBe("key_reserved_as_alias");

    const canonicalFirstExecutor = new StatefulExternalThreadExecutor();
    const canonicalFirstRepository = createSqlInboxV2ExternalThreadRepository(
      canonicalFirstExecutor
    );
    await canonicalFirstRepository.resolveOrCreateExactMapping(canonical);
    const canonicalWinner =
      await canonicalFirstRepository.resolveOrCreateExactMapping(
        aliasKeyMapping
      );
    const aliasLoser =
      await canonicalFirstRepository.appendAliases(aliasCommit);
    expect(canonicalWinner.kind).toBe("created");
    expect(aliasLoser).toMatchObject({
      kind: "key_conflict",
      reservationKind: "canonical"
    });
  });

  it("rejects alias self-maps, duplicate keys and reused alias IDs", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const input = makeResolveInput();
    await repository.resolveOrCreateExactMapping(input);
    const commit = makeAliasCommit(input.mapping);

    await expect(
      repository.appendAliases({
        ...commit,
        aliases: [
          {
            ...commit.aliases[0]!,
            aliasKey: input.mapping.thread.key
          }
        ]
      })
    ).rejects.toThrow();
    await expect(
      repository.appendAliases({
        ...commit,
        aliases: [
          commit.aliases[0]!,
          {
            ...commit.aliases[0]!,
            id: inboxV2ExternalThreadAliasIdSchema.parse(
              "external_thread_alias:duplicate-key"
            )
          }
        ]
      })
    ).rejects.toThrow();

    await repository.appendAliases(commit);
    const reusedIdCommit = makeAliasCommit(input.mapping, {
      aliasId: commit.aliases[0]!.id,
      aliasSubject: "Legacy:Other-Key"
    });
    await expect(repository.appendAliases(reusedIdCommit)).resolves.toEqual({
      kind: "alias_id_conflict",
      aliasId: commit.aliases[0]!.id
    });
  });

  it("rejects non-strict inputs and unsafe bigint/timestamp persistence rows", async () => {
    const executor = new StatefulExternalThreadExecutor();
    const repository = createSqlInboxV2ExternalThreadRepository(executor);
    const input = makeResolveInput();
    await expect(
      repository.resolveOrCreateExactMapping({
        ...input,
        routeHint: "source_account:unsafe"
      } as never)
    ).rejects.toThrow(/unsupported fields/u);
    await repository.resolveOrCreateExactMapping(input);

    executor.unsafeMutateConversation(input.mapping.conversation.id, {
      revision: 1 as never
    });
    await expect(
      repository.findById({
        tenantId,
        threadId: input.mapping.thread.id
      })
    ).rejects.toThrow(/JavaScript number/u);
    executor.unsafeMutateConversation(input.mapping.conversation.id, {
      revision: "1" as never,
      updatedAt: "not-a-timestamp"
    });
    await expect(
      repository.findById({
        tenantId,
        threadId: input.mapping.thread.id
      })
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
  });
});

function makeResolveInput(
  overrides: Partial<ResolveOrCreateInboxV2ExternalThreadInput> = {}
): ResolveOrCreateInboxV2ExternalThreadInput {
  return {
    mapping: makeMapping(),
    streamPosition: "1" as never,
    ...overrides
  };
}

function makeMapping(
  input: {
    tenant?: InboxV2TenantId;
    key?: InboxV2ExternalThreadKey;
    subject?: string;
    scope?: InboxV2ExternalThreadKey["scope"];
    threadId?: string;
    conversationId?: string;
  } = {}
): InboxV2ExternalThreadMapping {
  const tenant = input.tenant ?? tenantId;
  const scope = retenantScope(input.scope ?? { kind: "provider" }, tenant);
  const key = input.key
    ? retenantKey(input.key, tenant)
    : makeKey({
        scope,
        subject: input.subject ?? "Room:Case-Sensitive-ABC"
      });
  const conversationId = inboxV2ConversationIdSchema.parse(
    input.conversationId ?? "conversation:canonical"
  );
  const conversation = {
    tenantId: tenant,
    id: conversationId,
    topology: "group" as const,
    transport: "external" as const,
    purposeId: "core:chat" as never,
    lifecycle: "active" as const,
    head: {
      latestTimelineSequence: "0" as never,
      latestActivityItemId: null,
      latestActivityTimelineSequence: null,
      latestActivityAt: null,
      revision: "1" as never,
      createdAt,
      updatedAt: createdAt
    },
    revision: "1" as never,
    createdAt,
    updatedAt: createdAt
  };
  const threadId = input.threadId ?? "external_thread:canonical";
  return {
    tenantId: tenant,
    thread: {
      tenantId: tenant,
      id: threadId as never,
      key,
      identityDeclaration: declarationFor(key.scope.kind, false),
      conversation: {
        tenantId: tenant,
        kind: "conversation",
        id: conversationId as never
      },
      conversationTopology: "group",
      revision: "1" as never,
      createdAt,
      updatedAt: createdAt
    },
    conversation
  };
}

function makeKey(input: {
  scope: InboxV2ExternalThreadKey["scope"];
  subject: string;
}): InboxV2ExternalThreadKey {
  return {
    realm: {
      realmId: "module:synthetic:thread-realm" as never,
      realmVersion: "v1" as never,
      canonicalizationVersion: "v1" as never
    },
    scope: input.scope,
    objectKindId: "module:synthetic:group-room" as never,
    canonicalExternalSubject: input.subject
  };
}

function declarationFor(
  scopeKind: InboxV2ExternalThreadKey["scope"]["kind"],
  forceAuthoritative: boolean
): InboxV2AdapterIdentityDeclaration {
  return inboxV2AdapterIdentityDeclarationSchema.parse({
    adapterContract: {
      contractId: "module:synthetic:thread-contract",
      contractVersion: "v1",
      declarationRevision: "1",
      surfaceId: "module:synthetic:group-surface",
      loadedByTrustedServiceId: "core:routing-resolver",
      loadedAt: "2026-07-13T12:59:00.000Z"
    },
    identityKind: "external_thread" as const,
    realmId: "module:synthetic:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:group-room",
    scopeKind,
    decisionStrength:
      forceAuthoritative || scopeKind !== "source_account"
        ? ("authoritative" as const)
        : ("safe_default" as const)
  });
}

function makeAliasCommit(
  mapping: InboxV2ExternalThreadMapping,
  input: { aliasId?: string; aliasSubject?: string } = {}
): InboxV2ExternalThreadAliasCommit {
  const aliasKey = makeKey({
    scope: mapping.thread.key.scope,
    subject: input.aliasSubject ?? "Legacy:Room-ABC"
  });
  const alias: InboxV2ExternalThreadAlias = {
    tenantId: mapping.tenantId,
    id: inboxV2ExternalThreadAliasIdSchema.parse(
      input.aliasId ?? "external_thread_alias:legacy-room"
    ),
    aliasKey,
    aliasIdentityDeclaration: declarationFor(aliasKey.scope.kind, true),
    canonicalThread: {
      tenantId: mapping.tenantId,
      kind: "external_thread",
      id: mapping.thread.id
    },
    canonicalConversation: {
      tenantId: mapping.tenantId,
      kind: "conversation",
      id: mapping.conversation.id
    },
    canonicalKeySnapshot: mapping.thread.key,
    expectedCanonicalThreadRevision: "1" as never,
    decision: {
      actor: {
        kind: "trusted_service",
        trustedServiceId: "core:routing-resolver" as never
      },
      policyId: "core:authoritative-thread-migration" as never,
      policyVersion: "v1" as never,
      reasonCodeId: "core:provider-room-upgrade" as never,
      authoritativeEvidenceToken: "evidence.thread-alias-1" as never,
      decidedAt: aliasCreatedAt
    },
    revision: "1" as never,
    createdAt: aliasCreatedAt
  };
  return {
    tenantId: mapping.tenantId,
    canonicalThreadSnapshot: mapping.thread,
    expectedCanonicalThreadRevision: "1" as never,
    currentCanonicalThreadRevision: "1" as never,
    aliases: [alias],
    committedAt: aliasCreatedAt
  };
}

function retenantScope(
  scope: InboxV2ExternalThreadKey["scope"],
  tenant: InboxV2TenantId
): InboxV2ExternalThreadKey["scope"] {
  if (scope.kind === "provider") {
    return scope;
  }
  if (scope.kind === "source_connection") {
    return {
      kind: "source_connection",
      owner: { ...scope.owner, tenantId: tenant }
    };
  }
  return {
    kind: "source_account",
    owner: { ...scope.owner, tenantId: tenant }
  };
}

function retenantKey(
  key: InboxV2ExternalThreadKey,
  tenant: InboxV2TenantId
): InboxV2ExternalThreadKey {
  return { ...key, scope: retenantScope(key.scope, tenant) };
}

type StoredRegistry = {
  tenantId: InboxV2TenantId;
  id: string;
  entryKind: "canonical" | "alias";
  key: InboxV2ExternalThreadKey;
  digest: string;
  canonicalThreadId: string;
  canonicalConversationId: string;
  createdAt: string;
};

type StoredThread = {
  thread: InboxV2ExternalThreadMapping["thread"];
  registryId: string;
};

type StoredConversation = Omit<InboxV2Conversation, "head"> & {
  head: InboxV2Conversation["head"] | null;
};

type StoredConversationMembershipHead = {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2Conversation["id"];
  membershipRevision: "0";
  createdAt: string;
  updatedAt: string;
};

type StoredAlias = {
  alias: InboxV2ExternalThreadAlias;
  aliasRegistryId: string;
  canonicalRegistryId: string;
};

type FakeState = {
  registries: Map<string, StoredRegistry>;
  threads: Map<string, StoredThread>;
  conversations: Map<string, StoredConversation>;
  membershipHeads: Map<string, StoredConversationMembershipHead>;
  aliases: Map<string, StoredAlias>;
};

class StatefulExternalThreadExecutor implements InboxV2ExternalThreadTransactionExecutor {
  readonly advisoryTokens: string[] = [];
  readonly transactionStatements: string[][] = [];
  rollbackCount = 0;
  commitCount = 0;
  failNextRegistryInsert = false;
  private state: FakeState = emptyState();
  private transactionTail: Promise<void> = Promise.resolve();

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    return new StatefulExternalThreadSession(this.state, [], this).execute(
      query
    );
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    const previous = this.transactionTail;
    let release = (): void => undefined;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const draft = structuredClone(this.state);
    const statements: string[] = [];
    this.transactionStatements.push(statements);
    const session = new StatefulExternalThreadSession(draft, statements, this);
    try {
      const result = await work(session);
      this.state = session.takeState();
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.rollbackCount += 1;
      throw error;
    } finally {
      release();
    }
  }

  counts() {
    return {
      conversations: this.state.conversations.size,
      membershipHeads: this.state.membershipHeads.size,
      registries: this.state.registries.size,
      threads: this.state.threads.size,
      aliases: this.state.aliases.size
    };
  }

  unsafeSeedConversation(conversation: InboxV2Conversation): void {
    this.state.conversations.set(
      storageKey(conversation.tenantId, conversation.id),
      structuredClone(conversation)
    );
  }

  unsafeMutateAlias(
    aliasId: InboxV2ExternalThreadAlias["id"],
    patch: Partial<InboxV2ExternalThreadAlias>
  ): void {
    const key = storageKey(tenantId, aliasId);
    const current = this.state.aliases.get(key);
    if (!current) {
      throw new Error("Expected seeded ExternalThreadAlias.");
    }
    this.state.aliases.set(key, {
      ...current,
      alias: { ...current.alias, ...patch }
    });
  }

  unsafeReserveDigestForDifferentRawKey(
    requestedKey: InboxV2ExternalThreadKey,
    target: InboxV2ExternalThreadMapping
  ): void {
    const digest = computeInboxV2ExternalThreadKeyDigest(requestedKey);
    this.state.registries.set(storageKey(target.tenantId, digest), {
      tenantId: target.tenantId,
      id: `external_thread_key:${digest}`,
      entryKind: "alias",
      key: target.thread.key,
      digest,
      canonicalThreadId: target.thread.id,
      canonicalConversationId: target.conversation.id,
      createdAt: target.thread.createdAt
    });
  }

  unsafeMutateConversation(
    conversationId: string,
    patch: Partial<InboxV2Conversation>
  ): void {
    const key = storageKey(tenantId, conversationId);
    const current = this.state.conversations.get(key);
    if (!current) {
      throw new Error("Expected seeded Conversation.");
    }
    this.state.conversations.set(key, { ...current, ...patch });
  }
}

class StatefulExternalThreadSession implements RawSqlExecutor {
  constructor(
    private state: FakeState,
    private readonly statements: string[],
    private readonly controls: StatefulExternalThreadExecutor
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const rendered = renderQuery(query);
    const statement = normalizeSql(rendered.sql);
    this.statements.push(statement);

    if (statement.includes("pg_advisory_xact_lock")) {
      this.controls.advisoryTokens.push(String(rendered.params[0]));
      return rowsResult([{ locked: null }]);
    }
    if (
      statement.startsWith("insert into inbox_v2_external_thread_key_registry")
    ) {
      return this.insertRegistry<Row>(rendered.params);
    }
    if (statement.startsWith("insert into inbox_v2_conversation_heads")) {
      return this.insertConversationHead<Row>(rendered.params);
    }
    if (
      statement.startsWith("insert into inbox_v2_conversation_membership_heads")
    ) {
      return this.insertConversationMembershipHead<Row>(rendered.params);
    }
    if (statement.startsWith("insert into inbox_v2_conversations")) {
      return this.insertConversation<Row>(rendered.params);
    }
    if (statement.startsWith("insert into inbox_v2_external_threads")) {
      return this.insertThread<Row>(rendered.params);
    }
    if (statement.startsWith("insert into inbox_v2_external_thread_aliases")) {
      return this.insertAlias<Row>(rendered.params);
    }
    if (statement.includes("from inbox_v2_external_thread_key_registry r")) {
      return this.findRegistry<Row>(rendered.params);
    }
    if (statement.includes("from inbox_v2_external_threads t left join")) {
      return this.findMapping<Row>(rendered.params);
    }
    if (statement.includes("from inbox_v2_external_thread_aliases a")) {
      return this.findAlias<Row>(statement, rendered.params);
    }
    if (
      statement.includes("from inbox_v2_external_threads t") &&
      statement.includes("for update")
    ) {
      return this.lockThread<Row>(rendered.params);
    }
    if (
      statement.includes("from inbox_v2_conversation_heads h") &&
      statement.includes("for update")
    ) {
      return this.lockConversationHead<Row>(rendered.params);
    }
    if (
      statement.includes("from inbox_v2_conversations c") &&
      statement.includes("for update")
    ) {
      return this.lockConversation<Row>(rendered.params);
    }
    if (
      statement.includes("from inbox_v2_external_threads t") &&
      statement.includes("t.conversation_id =")
    ) {
      return this.findThreadByConversation<Row>(rendered.params);
    }
    if (statement.includes("from inbox_v2_conversations c left join")) {
      return this.findConversation<Row>(rendered.params);
    }

    throw new Error(`Fake does not understand SQL: ${rendered.sql}`);
  }

  takeState(): FakeState {
    return this.state;
  }

  private insertRegistry<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    if (this.controls.failNextRegistryInsert) {
      this.controls.failNextRegistryInsert = false;
      return rowsResult([]);
    }
    const [
      tenant,
      id,
      entryKind,
      realmId,
      realmVersion,
      canonicalizationVersion,
      scopeKind,
      connectionId,
      accountId,
      ownerKey,
      objectKindId,
      subject,
      threadId,
      conversationId,
      created
    ] = params;
    const key = keyFromColumns({
      tenant,
      realmId,
      realmVersion,
      canonicalizationVersion,
      scopeKind,
      connectionId,
      accountId,
      ownerKey,
      objectKindId,
      subject
    });
    const digest = computeInboxV2ExternalThreadKeyDigest(key);
    const stateKey = storageKey(String(tenant), digest);
    if (
      this.state.registries.has(stateKey) ||
      [...this.state.registries.values()].some(
        (registry) => registry.tenantId === tenant && registry.id === id
      )
    ) {
      return rowsResult([]);
    }
    this.state.registries.set(stateKey, {
      tenantId: tenant as InboxV2TenantId,
      id: String(id),
      entryKind: entryKind as "canonical" | "alias",
      key,
      digest,
      canonicalThreadId: String(threadId),
      canonicalConversationId: String(conversationId),
      createdAt: String(created)
    });
    return rowsResult([{ id }]);
  }

  private insertConversation<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [
      tenant,
      id,
      topology,
      transport,
      purposeId,
      lifecycle,
      revision,
      _streamPosition,
      created,
      updated
    ] = params;
    const key = storageKey(String(tenant), String(id));
    if (this.state.conversations.has(key)) {
      return rowsResult([]);
    }
    this.state.conversations.set(key, {
      tenantId: tenant as never,
      id: id as never,
      topology: topology as never,
      transport: transport as never,
      purposeId: purposeId as never,
      lifecycle: lifecycle as never,
      revision: revision as never,
      createdAt: String(created),
      updatedAt: String(updated),
      head: null
    });
    return rowsResult([{ id }]);
  }

  private insertConversationHead<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [
      tenant,
      conversationId,
      latestSequence,
      activityId,
      activitySequence,
      activityAt,
      revision,
      _streamPosition,
      created,
      updated
    ] = params;
    const conversation = this.state.conversations.get(
      storageKey(String(tenant), String(conversationId))
    );
    if (!conversation || conversation.head !== null) {
      return rowsResult([]);
    }
    conversation.head = {
      latestTimelineSequence: latestSequence as never,
      latestActivityItemId: activityId as never,
      latestActivityTimelineSequence: activitySequence as never,
      latestActivityAt: activityAt as never,
      revision: revision as never,
      createdAt: String(created),
      updatedAt: String(updated)
    };
    return rowsResult([{ id: conversationId }]);
  }

  private insertConversationMembershipHead<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, conversationId, created, updated] = params;
    const key = storageKey(String(tenant), String(conversationId));
    if (
      !this.state.conversations.has(key) ||
      this.state.membershipHeads.has(key)
    ) {
      return rowsResult([]);
    }
    this.state.membershipHeads.set(key, {
      tenantId: tenant as InboxV2TenantId,
      conversationId: conversationId as InboxV2Conversation["id"],
      membershipRevision: "0",
      createdAt: String(created),
      updatedAt: String(updated)
    });
    return rowsResult([{ id: conversationId }]);
  }

  private insertThread<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [
      tenant,
      id,
      registryId,
      realmId,
      realmVersion,
      canonicalizationVersion,
      scopeKind,
      connectionId,
      accountId,
      ownerKey,
      objectKindId,
      subject,
      identityDeclaration,
      conversationId,
      topology,
      revision,
      created,
      updated
    ] = params;
    const threadKey = storageKey(String(tenant), String(id));
    if (
      this.state.threads.has(threadKey) ||
      [...this.state.threads.values()].some(
        (stored) =>
          stored.thread.tenantId === tenant &&
          stored.thread.conversation.id === conversationId
      )
    ) {
      return rowsResult([]);
    }
    const key = keyFromColumns({
      tenant,
      realmId,
      realmVersion,
      canonicalizationVersion,
      scopeKind,
      connectionId,
      accountId,
      ownerKey,
      objectKindId,
      subject
    });
    this.state.threads.set(threadKey, {
      registryId: String(registryId),
      thread: {
        tenantId: tenant as never,
        id: id as never,
        key,
        identityDeclaration: identityDeclaration as never,
        conversation: {
          tenantId: tenant as never,
          kind: "conversation",
          id: conversationId as never
        },
        conversationTopology: topology as never,
        revision: revision as never,
        createdAt: String(created),
        updatedAt: String(updated)
      }
    });
    return rowsResult([{ id }]);
  }

  private insertAlias<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [
      tenant,
      id,
      aliasRegistryId,
      aliasRealmId,
      aliasRealmVersion,
      aliasCanonicalizationVersion,
      aliasScopeKind,
      aliasConnectionId,
      aliasAccountId,
      aliasOwnerKey,
      aliasObjectKindId,
      aliasSubject,
      aliasDeclaration,
      canonicalThreadId,
      canonicalConversationId,
      canonicalRegistryId,
      canonicalRealmId,
      canonicalRealmVersion,
      canonicalCanonicalizationVersion,
      canonicalScopeKind,
      canonicalConnectionId,
      canonicalAccountId,
      canonicalOwnerKey,
      canonicalObjectKindId,
      canonicalSubject,
      expectedRevision,
      trustedServiceId,
      policyId,
      policyVersion,
      reasonCodeId,
      evidenceToken,
      decidedAt,
      revision,
      created
    ] = params;
    const stateKey = storageKey(String(tenant), String(id));
    if (this.state.aliases.has(stateKey)) {
      return rowsResult([]);
    }
    const aliasKey = keyFromColumns({
      tenant,
      realmId: aliasRealmId,
      realmVersion: aliasRealmVersion,
      canonicalizationVersion: aliasCanonicalizationVersion,
      scopeKind: aliasScopeKind,
      connectionId: aliasConnectionId,
      accountId: aliasAccountId,
      ownerKey: aliasOwnerKey,
      objectKindId: aliasObjectKindId,
      subject: aliasSubject
    });
    const canonicalKey = keyFromColumns({
      tenant,
      realmId: canonicalRealmId,
      realmVersion: canonicalRealmVersion,
      canonicalizationVersion: canonicalCanonicalizationVersion,
      scopeKind: canonicalScopeKind,
      connectionId: canonicalConnectionId,
      accountId: canonicalAccountId,
      ownerKey: canonicalOwnerKey,
      objectKindId: canonicalObjectKindId,
      subject: canonicalSubject
    });
    const alias: InboxV2ExternalThreadAlias = {
      tenantId: tenant as never,
      id: id as never,
      aliasKey,
      aliasIdentityDeclaration: aliasDeclaration as never,
      canonicalThread: {
        tenantId: tenant as never,
        kind: "external_thread",
        id: canonicalThreadId as never
      },
      canonicalConversation: {
        tenantId: tenant as never,
        kind: "conversation",
        id: canonicalConversationId as never
      },
      canonicalKeySnapshot: canonicalKey,
      expectedCanonicalThreadRevision: expectedRevision as never,
      decision: {
        actor: {
          kind: "trusted_service",
          trustedServiceId: trustedServiceId as never
        },
        policyId: policyId as never,
        policyVersion: policyVersion as never,
        reasonCodeId: reasonCodeId as never,
        authoritativeEvidenceToken: evidenceToken as never,
        decidedAt: String(decidedAt)
      },
      revision: revision as never,
      createdAt: String(created)
    };
    this.state.aliases.set(stateKey, {
      alias,
      aliasRegistryId: String(aliasRegistryId),
      canonicalRegistryId: String(canonicalRegistryId)
    });
    return rowsResult([{ id }]);
  }

  private findRegistry<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, digest] = params;
    const registry = this.state.registries.get(
      storageKey(String(tenant), String(digest))
    );
    return registry ? rowsResult([toRegistryRow(registry)]) : rowsResult([]);
  }

  private findMapping<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, threadId] = params;
    const thread = this.state.threads.get(
      storageKey(String(tenant), String(threadId))
    );
    if (!thread) {
      return rowsResult([]);
    }
    const registry = [...this.state.registries.values()].find(
      (candidate) =>
        candidate.tenantId === tenant && candidate.id === thread.registryId
    );
    const conversation = this.state.conversations.get(
      storageKey(String(tenant), thread.thread.conversation.id)
    );
    if (!registry || !conversation) {
      return rowsResult([
        toMappingRow(thread, registry ?? null, conversation ?? null)
      ]);
    }
    return rowsResult([toMappingRow(thread, registry, conversation)]);
  }

  private findAlias<Row extends Record<string, unknown>>(
    statement: string,
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, value] = params;
    const stored = [...this.state.aliases.values()].filter(
      (candidate) =>
        candidate.alias.tenantId === tenant &&
        (statement.includes("a.alias_key_registry_id =")
          ? candidate.aliasRegistryId === value
          : candidate.alias.id === value)
    );
    return rowsResult(stored.map(toAliasRow));
  }

  private lockThread<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, threadId] = params;
    const thread = this.state.threads.get(
      storageKey(String(tenant), String(threadId))
    );
    return thread
      ? rowsResult([
          {
            id: thread.thread.id,
            conversation_id: thread.thread.conversation.id
          }
        ])
      : rowsResult([]);
  }

  private lockConversation<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, conversationId] = params;
    const conversation = this.state.conversations.get(
      storageKey(String(tenant), String(conversationId))
    );
    return conversation
      ? rowsResult([{ id: conversation.id }])
      : rowsResult([]);
  }

  private lockConversationHead<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, conversationId] = params;
    const conversation = this.state.conversations.get(
      storageKey(String(tenant), String(conversationId))
    );
    return conversation?.head
      ? rowsResult([{ id: conversation.id }])
      : rowsResult([]);
  }

  private findThreadByConversation<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, conversationId] = params;
    const matches = [...this.state.threads.values()].filter(
      (stored) =>
        stored.thread.tenantId === tenant &&
        stored.thread.conversation.id === conversationId
    );
    return rowsResult(matches.map((stored) => ({ id: stored.thread.id })));
  }

  private findConversation<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, conversationId] = params;
    const conversation = this.state.conversations.get(
      storageKey(String(tenant), String(conversationId))
    );
    return conversation
      ? rowsResult([toConversationRow(conversation)])
      : rowsResult([]);
  }
}

function emptyState(): FakeState {
  return {
    registries: new Map(),
    threads: new Map(),
    conversations: new Map(),
    membershipHeads: new Map(),
    aliases: new Map()
  };
}

function keyFromColumns(input: {
  tenant: unknown;
  realmId: unknown;
  realmVersion: unknown;
  canonicalizationVersion: unknown;
  scopeKind: unknown;
  connectionId: unknown;
  accountId: unknown;
  ownerKey: unknown;
  objectKindId: unknown;
  subject: unknown;
}): InboxV2ExternalThreadKey {
  const scope =
    input.scopeKind === "provider"
      ? { kind: "provider" as const }
      : input.scopeKind === "source_connection"
        ? {
            kind: "source_connection" as const,
            owner: {
              tenantId: input.tenant as never,
              kind: "source_connection" as const,
              id: input.connectionId as never
            }
          }
        : {
            kind: "source_account" as const,
            owner: {
              tenantId: input.tenant as never,
              kind: "source_account" as const,
              id: input.accountId as never
            }
          };
  if (
    (input.scopeKind === "provider" && input.ownerKey !== "provider") ||
    (input.scopeKind === "source_connection" &&
      input.ownerKey !== input.connectionId) ||
    (input.scopeKind === "source_account" && input.ownerKey !== input.accountId)
  ) {
    throw new Error("Fake received an invalid scope owner tuple.");
  }
  return {
    realm: {
      realmId: input.realmId as never,
      realmVersion: input.realmVersion as never,
      canonicalizationVersion: input.canonicalizationVersion as never
    },
    scope,
    objectKindId: input.objectKindId as never,
    canonicalExternalSubject: String(input.subject)
  };
}

function toRegistryRow(registry: StoredRegistry): Record<string, unknown> {
  const scope = registry.key.scope;
  return {
    registry_tenant_id: registry.tenantId,
    registry_id: registry.id,
    entry_kind: registry.entryKind,
    realm_id: registry.key.realm.realmId,
    realm_version: registry.key.realm.realmVersion,
    canonicalization_version: registry.key.realm.canonicalizationVersion,
    scope_kind: scope.kind,
    scope_source_connection_id:
      scope.kind === "source_connection" ? scope.owner.id : null,
    scope_source_account_id:
      scope.kind === "source_account" ? scope.owner.id : null,
    scope_owner_key: scope.kind === "provider" ? "provider" : scope.owner.id,
    object_kind_id: registry.key.objectKindId,
    canonical_external_subject: registry.key.canonicalExternalSubject,
    key_digest: registry.digest,
    canonical_thread_id: registry.canonicalThreadId,
    canonical_conversation_id: registry.canonicalConversationId,
    registry_revision: "1",
    registry_created_at: registry.createdAt,
    registry_updated_at: registry.createdAt
  };
}

function toMappingRow(
  stored: StoredThread,
  registry: StoredRegistry | null,
  conversation: StoredConversation | null
): Record<string, unknown> {
  const thread = stored.thread;
  const scope = thread.key.scope;
  return {
    ...(registry ? toRegistryRow(registry) : nullRegistryRow()),
    thread_tenant_id: thread.tenantId,
    thread_id: thread.id,
    thread_key_registry_id: stored.registryId,
    thread_realm_id: thread.key.realm.realmId,
    thread_realm_version: thread.key.realm.realmVersion,
    thread_canonicalization_version: thread.key.realm.canonicalizationVersion,
    thread_scope_kind: scope.kind,
    thread_scope_source_connection_id:
      scope.kind === "source_connection" ? scope.owner.id : null,
    thread_scope_source_account_id:
      scope.kind === "source_account" ? scope.owner.id : null,
    thread_scope_owner_key:
      scope.kind === "provider" ? "provider" : scope.owner.id,
    thread_object_kind_id: thread.key.objectKindId,
    thread_canonical_external_subject: thread.key.canonicalExternalSubject,
    thread_key_digest: computeInboxV2ExternalThreadKeyDigest(thread.key),
    identity_declaration: thread.identityDeclaration,
    thread_conversation_id: thread.conversation.id,
    conversation_topology_snapshot: thread.conversationTopology,
    thread_revision: thread.revision,
    thread_created_at: thread.createdAt,
    thread_updated_at: thread.updatedAt,
    ...(conversation ? toConversationRow(conversation) : nullConversationRow())
  };
}

function toConversationRow(
  conversation: StoredConversation
): Record<string, unknown> {
  return {
    conversation_tenant_id: conversation.tenantId,
    conversation_id: conversation.id,
    conversation_topology: conversation.topology,
    conversation_transport: conversation.transport,
    purpose_id: conversation.purposeId,
    lifecycle: conversation.lifecycle,
    conversation_revision: conversation.revision,
    conversation_created_at: conversation.createdAt,
    conversation_updated_at: conversation.updatedAt,
    head_conversation_id: conversation.head ? conversation.id : null,
    latest_timeline_sequence: conversation.head?.latestTimelineSequence ?? null,
    latest_activity_item_id: conversation.head?.latestActivityItemId ?? null,
    latest_activity_timeline_sequence:
      conversation.head?.latestActivityTimelineSequence ?? null,
    latest_activity_at: conversation.head?.latestActivityAt ?? null,
    head_revision: conversation.head?.revision ?? null,
    head_created_at: conversation.head?.createdAt ?? null,
    head_updated_at: conversation.head?.updatedAt ?? null
  };
}

function toAliasRow(stored: StoredAlias): Record<string, unknown> {
  const alias = stored.alias;
  const aliasScope = alias.aliasKey.scope;
  const canonicalScope = alias.canonicalKeySnapshot.scope;
  return {
    alias_tenant_id: alias.tenantId,
    alias_id: alias.id,
    alias_key_registry_id: stored.aliasRegistryId,
    alias_realm_id: alias.aliasKey.realm.realmId,
    alias_realm_version: alias.aliasKey.realm.realmVersion,
    alias_canonicalization_version:
      alias.aliasKey.realm.canonicalizationVersion,
    alias_scope_kind: aliasScope.kind,
    alias_scope_source_connection_id:
      aliasScope.kind === "source_connection" ? aliasScope.owner.id : null,
    alias_scope_source_account_id:
      aliasScope.kind === "source_account" ? aliasScope.owner.id : null,
    alias_scope_owner_key:
      aliasScope.kind === "provider" ? "provider" : aliasScope.owner.id,
    alias_object_kind_id: alias.aliasKey.objectKindId,
    alias_canonical_external_subject: alias.aliasKey.canonicalExternalSubject,
    alias_key_digest: computeInboxV2ExternalThreadKeyDigest(alias.aliasKey),
    alias_identity_declaration: alias.aliasIdentityDeclaration,
    canonical_thread_id: alias.canonicalThread.id,
    canonical_conversation_id: alias.canonicalConversation.id,
    canonical_key_registry_id: stored.canonicalRegistryId,
    canonical_realm_id: alias.canonicalKeySnapshot.realm.realmId,
    canonical_realm_version: alias.canonicalKeySnapshot.realm.realmVersion,
    canonical_canonicalization_version:
      alias.canonicalKeySnapshot.realm.canonicalizationVersion,
    canonical_scope_kind: canonicalScope.kind,
    canonical_scope_source_connection_id:
      canonicalScope.kind === "source_connection"
        ? canonicalScope.owner.id
        : null,
    canonical_scope_source_account_id:
      canonicalScope.kind === "source_account" ? canonicalScope.owner.id : null,
    canonical_scope_owner_key:
      canonicalScope.kind === "provider" ? "provider" : canonicalScope.owner.id,
    canonical_object_kind_id: alias.canonicalKeySnapshot.objectKindId,
    canonical_external_subject:
      alias.canonicalKeySnapshot.canonicalExternalSubject,
    canonical_key_digest: computeInboxV2ExternalThreadKeyDigest(
      alias.canonicalKeySnapshot
    ),
    expected_canonical_thread_revision: alias.expectedCanonicalThreadRevision,
    decision_trusted_service_id: alias.decision.actor.trustedServiceId,
    decision_policy_id: alias.decision.policyId,
    decision_policy_version: alias.decision.policyVersion,
    decision_reason_code_id: alias.decision.reasonCodeId,
    decision_authoritative_evidence_token:
      alias.decision.authoritativeEvidenceToken,
    decision_decided_at: alias.decision.decidedAt,
    alias_revision: alias.revision,
    alias_created_at: alias.createdAt
  };
}

function nullRegistryRow(): Record<string, null> {
  return {
    registry_tenant_id: null,
    registry_id: null,
    entry_kind: null,
    realm_id: null,
    realm_version: null,
    canonicalization_version: null,
    scope_kind: null,
    scope_source_connection_id: null,
    scope_source_account_id: null,
    scope_owner_key: null,
    object_kind_id: null,
    canonical_external_subject: null,
    key_digest: null,
    canonical_thread_id: null,
    canonical_conversation_id: null,
    registry_revision: null,
    registry_created_at: null,
    registry_updated_at: null
  };
}

function nullConversationRow(): Record<string, null> {
  return {
    conversation_tenant_id: null,
    conversation_id: null,
    conversation_topology: null,
    conversation_transport: null,
    purpose_id: null,
    lifecycle: null,
    conversation_revision: null,
    conversation_created_at: null,
    conversation_updated_at: null,
    head_conversation_id: null,
    latest_timeline_sequence: null,
    latest_activity_item_id: null,
    latest_activity_timeline_sequence: null,
    latest_activity_at: null,
    head_revision: null,
    head_created_at: null,
    head_updated_at: null
  };
}

function storageKey(tenant: string, id: string): string {
  return `${tenant}\u0000${id}`;
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
