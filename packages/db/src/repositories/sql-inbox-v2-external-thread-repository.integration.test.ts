import {
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2ExternalThreadAliasCommitSchema,
  inboxV2ExternalThreadAliasIdSchema,
  inboxV2ExternalThreadIdSchema,
  inboxV2ExternalThreadKeySchema,
  inboxV2ExternalThreadMappingSchema,
  inboxV2TenantIdSchema,
  type InboxV2ExternalThreadAliasCommit,
  type InboxV2ExternalThreadKey,
  type InboxV2ExternalThreadMapping,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  computeInboxV2ExternalThreadKeyDigest,
  createSqlInboxV2ExternalThreadRepository
} from "./sql-inbox-v2-external-thread-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantA = inboxV2TenantIdSchema.parse(`tenant:db003-thread-a-${runId}`);
const tenantB = inboxV2TenantIdSchema.parse(`tenant:db003-thread-b-${runId}`);
const t0 = "2026-07-13T13:00:00.000Z";
const t0Plus3 = "2026-07-13T16:00:00.000+03:00";
const aliasAt = "2026-07-13T13:01:00.000Z";
const aliasAtPlus3 = "2026-07-13T16:01:00.000+03:00";

describePostgres("SQL Inbox V2 ExternalThread repository (PostgreSQL)", () => {
  let db: HuleeDatabase;

  beforeAll(async () => {
    db = createHuleeDatabase();
    await db.execute(sql`
        insert into tenants (id, slug, display_name, deployment_type)
        values
          (${tenantA}, ${`db003-thread-a-${runId}`}, 'DB003 thread tenant A', 'saas_shared'),
          (${tenantB}, ${`db003-thread-b-${runId}`}, 'DB003 thread tenant B', 'saas_shared')
      `);
  });

  afterAll(async () => {
    if (!db) {
      return;
    }

    try {
      await db.execute(sql`
          delete from inbox_v2_external_thread_aliases
          where tenant_id in (${tenantA}, ${tenantB})
        `);
      await db.execute(sql`
          delete from inbox_v2_external_threads
          where tenant_id in (${tenantA}, ${tenantB})
        `);
      await db.execute(sql`
          delete from inbox_v2_external_thread_key_registry
          where tenant_id in (${tenantA}, ${tenantB})
        `);
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`
            delete from inbox_v2_conversation_membership_heads
            where tenant_id in (${tenantA}, ${tenantB})
          `);
        await transaction.execute(sql`
            delete from inbox_v2_conversation_heads
            where tenant_id in (${tenantA}, ${tenantB})
          `);
        await transaction.execute(sql`
            delete from inbox_v2_conversations
            where tenant_id in (${tenantA}, ${tenantB})
          `);
      });
      await db.execute(sql`
          delete from tenants
          where id in (${tenantA}, ${tenantB})
        `);
    } finally {
      await closeHuleeDatabase(db);
    }
  });

  it("creates one exact mapping under concurrent identical requests", async () => {
    const repository = createSqlInboxV2ExternalThreadRepository(db);
    const input = resolveInput(
      mapping(tenantA, "same-exact", "ProviderGroup:SameExact")
    );

    const results = await Promise.all([
      repository.resolveOrCreateExactMapping(input),
      repository.resolveOrCreateExactMapping(input)
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      "already_exists",
      "created"
    ]);
    const counts = await aggregateCounts(db, tenantA, [
      input.mapping.conversation.id
    ]);
    expect(counts).toEqual({
      conversations: "1",
      heads: "1",
      registries: "1",
      threads: "1"
    });
  });

  it("keeps one winner when different candidates race for the same exact key", async () => {
    const repository = createSqlInboxV2ExternalThreadRepository(db);
    const key = threadKey("ProviderGroup:DifferentCandidates");
    const candidateA = resolveInput(
      mapping(tenantA, "different-candidate-a", undefined, key),
      "2"
    );
    const candidateB = resolveInput(
      mapping(tenantA, "different-candidate-b", undefined, key),
      "3"
    );

    const results = await Promise.all([
      repository.resolveOrCreateExactMapping(candidateA),
      repository.resolveOrCreateExactMapping(candidateB)
    ]);
    const winner = results.find((result) => result.kind === "created");
    const conflict = results.find(
      (result) => result.kind === "exact_key_conflict"
    );

    expect(winner?.kind).toBe("created");
    expect(conflict?.kind).toBe("exact_key_conflict");
    if (winner?.kind !== "created" || conflict?.kind !== "exact_key_conflict") {
      throw new Error("Expected one created mapping and one exact-key loser.");
    }
    expect(conflict.existingMapping.thread.id).toBe(winner.mapping.thread.id);
    expect(conflict.existingMapping.conversation.id).toBe(
      winner.mapping.conversation.id
    );

    const resolved = await repository.findByExactKey({
      tenantId: tenantA,
      key
    });
    expect(resolved).toMatchObject({
      kind: "found",
      reservationKind: "canonical",
      mapping: { thread: { id: winner.mapping.thread.id } }
    });
    const counts = await aggregateCounts(db, tenantA, [
      candidateA.mapping.conversation.id,
      candidateB.mapping.conversation.id
    ]);
    expect(counts).toEqual({
      conversations: "1",
      heads: "1",
      registries: "1",
      threads: "1"
    });
  });

  it("gives an alias key to exactly one canonical or alias reservation racer", async () => {
    const repository = createSqlInboxV2ExternalThreadRepository(db);
    const canonicalInput = resolveInput(
      mapping(tenantA, "alias-target", "ProviderGroup:AliasTarget"),
      "4"
    );
    const canonical =
      await repository.resolveOrCreateExactMapping(canonicalInput);
    expect(canonical.kind).toBe("created");
    if (canonical.kind !== "created") {
      throw new Error("Expected the alias target mapping to be created.");
    }

    const aliasCommit = makeAliasCommit(
      canonical.mapping,
      "alias-race",
      "LegacyProviderGroup:AliasRace"
    );
    const aliasKey = aliasCommit.aliases[0]!.aliasKey;
    const canonicalCandidate = resolveInput(
      mapping(tenantA, "alias-key-candidate", undefined, aliasKey),
      "5"
    );
    const [aliasResult, canonicalResult] = await Promise.all([
      repository.appendAliases(aliasCommit),
      repository.resolveOrCreateExactMapping(canonicalCandidate)
    ]);

    const aliasWon =
      aliasResult.kind === "committed" &&
      canonicalResult.kind === "key_reserved_as_alias";
    const canonicalWon =
      aliasResult.kind === "key_conflict" &&
      aliasResult.reservationKind === "canonical" &&
      canonicalResult.kind === "created";
    expect(aliasWon || canonicalWon).toBe(true);

    const digest = computeInboxV2ExternalThreadKeyDigest(aliasKey);
    const reservation = await db.execute<{
      entry_kind: string;
      canonical_thread_id: string;
    }>(sql`
        select entry_kind, canonical_thread_id
        from inbox_v2_external_thread_key_registry
        where tenant_id = ${tenantA}
          and key_digest = ${digest}
      `);
    expect(reservation.rows).toHaveLength(1);

    const aliasCount = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_external_thread_aliases
        where tenant_id = ${tenantA}
          and id = ${aliasCommit.aliases[0]!.id}
      `);
    expect(aliasCount.rows[0]?.count).toBe(aliasWon ? "1" : "0");
    expect(reservation.rows[0]?.entry_kind).toBe(
      aliasWon ? "alias" : "canonical"
    );
    expect(reservation.rows[0]?.canonical_thread_id).toBe(
      aliasWon
        ? canonical.mapping.thread.id
        : canonicalCandidate.mapping.thread.id
    );
  });

  it("keeps equal provider keys and aggregate IDs isolated by tenant", async () => {
    const repository = createSqlInboxV2ExternalThreadRepository(db);
    const key = threadKey("ProviderGroup:TenantIsolation");
    const mappingA = mapping(tenantA, "tenant-shared", undefined, key);
    const mappingB = mapping(tenantB, "tenant-shared", undefined, key);

    const [createdA, createdB] = await Promise.all([
      repository.resolveOrCreateExactMapping(resolveInput(mappingA, "6")),
      repository.resolveOrCreateExactMapping(resolveInput(mappingB, "6"))
    ]);

    expect(createdA.kind).toBe("created");
    expect(createdB.kind).toBe("created");
    expect(
      (await repository.findByExactKey({ tenantId: tenantA, key })).kind
    ).toBe("found");
    expect(
      (await repository.findByExactKey({ tenantId: tenantB, key })).kind
    ).toBe("found");

    const rows = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_external_threads
        where tenant_id in (${tenantA}, ${tenantB})
          and id = ${mappingA.thread.id}
      `);
    expect(rows.rows).toEqual([{ count: "2" }]);
  });

  it("keeps mapping and alias retries idempotent after PostgreSQL timezone normalization", async () => {
    const repository = createSqlInboxV2ExternalThreadRepository(db);
    const input = resolveInput(
      mapping(
        tenantA,
        "offset-retry",
        "ProviderGroup:OffsetRetry",
        undefined,
        t0Plus3
      ),
      "7"
    );

    const created = await repository.resolveOrCreateExactMapping(input);
    const repeated = await repository.resolveOrCreateExactMapping(input);
    expect(created.kind).toBe("created");
    expect(repeated.kind).toBe("already_exists");
    if (created.kind !== "created" || repeated.kind !== "already_exists") {
      throw new Error(
        "Expected timezone-normalized mapping retry to converge."
      );
    }
    expect(created.mapping.thread.createdAt).toBe(t0);
    expect(repeated.mapping.thread.createdAt).toBe(t0);

    const aliasCommit = makeAliasCommit(
      created.mapping,
      "offset-retry",
      "LegacyProviderGroup:OffsetRetry",
      aliasAtPlus3
    );
    const aliasCreated = await repository.appendAliases(aliasCommit);
    const aliasRepeated = await repository.appendAliases(aliasCommit);
    expect(aliasCreated.kind).toBe("committed");
    expect(aliasRepeated.kind).toBe("already_exists");
    if (
      aliasCreated.kind !== "committed" ||
      aliasRepeated.kind !== "already_exists"
    ) {
      throw new Error("Expected timezone-normalized alias retry to converge.");
    }
    expect(aliasCreated.aliases[0]?.createdAt).toBe(aliasAt);
    expect(aliasRepeated.aliases[0]?.createdAt).toBe(aliasAt);
  });
});

function resolveInput(
  value: InboxV2ExternalThreadMapping,
  streamPosition = "1"
) {
  return {
    mapping: value,
    streamPosition: inboxV2BigintCounterSchema.parse(streamPosition)
  };
}

function mapping(
  tenantId: InboxV2TenantId,
  idSuffix: string,
  subject?: string,
  exactKey?: InboxV2ExternalThreadKey,
  createdAt = t0
): InboxV2ExternalThreadMapping {
  const key = exactKey ?? threadKey(subject ?? `ProviderGroup:${idSuffix}`);
  const conversationId = inboxV2ConversationIdSchema.parse(
    `conversation:db003-thread-${idSuffix}-${runId}`
  );

  return inboxV2ExternalThreadMappingSchema.parse({
    tenantId,
    thread: {
      tenantId,
      id: inboxV2ExternalThreadIdSchema.parse(
        `external_thread:db003-${idSuffix}-${runId}`
      ),
      key,
      identityDeclaration: identityDeclaration(),
      conversation: {
        tenantId,
        kind: "conversation",
        id: conversationId
      },
      conversationTopology: "group",
      revision: "1",
      createdAt,
      updatedAt: createdAt
    },
    conversation: {
      tenantId,
      id: conversationId,
      topology: "group",
      transport: "external",
      purposeId: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
      lifecycle: "active",
      head: {
        latestTimelineSequence: "0",
        latestActivityItemId: null,
        latestActivityTimelineSequence: null,
        latestActivityAt: null,
        revision: "1",
        createdAt,
        updatedAt: createdAt
      },
      revision: "1",
      createdAt,
      updatedAt: createdAt
    }
  });
}

function threadKey(subject: string): InboxV2ExternalThreadKey {
  return inboxV2ExternalThreadKeySchema.parse({
    realm: {
      realmId: "module:synthetic:thread-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "provider" },
    objectKindId: "module:synthetic:group-room",
    canonicalExternalSubject: subject
  });
}

function identityDeclaration() {
  return inboxV2AdapterIdentityDeclarationSchema.parse({
    adapterContract: {
      contractId: "module:synthetic:thread-contract",
      contractVersion: "v1",
      declarationRevision: "1",
      surfaceId: "module:synthetic:group-surface",
      loadedByTrustedServiceId: "core:routing-resolver",
      loadedAt: "2026-07-13T12:59:00.000Z"
    },
    identityKind: "external_thread",
    realmId: "module:synthetic:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:group-room",
    scopeKind: "provider",
    decisionStrength: "authoritative"
  });
}

function makeAliasCommit(
  canonical: InboxV2ExternalThreadMapping,
  idSuffix: string,
  aliasSubject: string,
  committedAt = aliasAt
): InboxV2ExternalThreadAliasCommit {
  const aliasKey = threadKey(aliasSubject);
  return inboxV2ExternalThreadAliasCommitSchema.parse({
    tenantId: canonical.tenantId,
    canonicalThreadSnapshot: canonical.thread,
    expectedCanonicalThreadRevision: "1",
    currentCanonicalThreadRevision: "1",
    aliases: [
      {
        tenantId: canonical.tenantId,
        id: inboxV2ExternalThreadAliasIdSchema.parse(
          `external_thread_alias:db003-${idSuffix}-${runId}`
        ),
        aliasKey,
        aliasIdentityDeclaration: identityDeclaration(),
        canonicalThread: {
          tenantId: canonical.tenantId,
          kind: "external_thread",
          id: canonical.thread.id
        },
        canonicalConversation: {
          tenantId: canonical.tenantId,
          kind: "conversation",
          id: canonical.conversation.id
        },
        canonicalKeySnapshot: canonical.thread.key,
        expectedCanonicalThreadRevision: "1",
        decision: {
          actor: {
            kind: "trusted_service",
            trustedServiceId: "core:routing-resolver"
          },
          policyId: "core:authoritative-thread-migration",
          policyVersion: "v1",
          reasonCodeId: "core:provider-room-upgrade",
          authoritativeEvidenceToken: `evidence.db003-${idSuffix}-${runId}`,
          decidedAt: committedAt
        },
        revision: "1",
        createdAt: committedAt
      }
    ],
    committedAt
  });
}

async function aggregateCounts(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId,
  conversationIds: readonly string[]
): Promise<{
  conversations: string;
  heads: string;
  registries: string;
  threads: string;
}> {
  const firstId = conversationIds[0] ?? "conversation:missing";
  const secondId = conversationIds[1] ?? firstId;
  const result = await db.execute<{
    conversations: string;
    heads: string;
    registries: string;
    threads: string;
  }>(sql`
    select
      (
        select count(*)::text
        from inbox_v2_conversations
        where tenant_id = ${tenantId}
          and id in (${firstId}, ${secondId})
      ) as conversations,
      (
        select count(*)::text
        from inbox_v2_conversation_heads
        where tenant_id = ${tenantId}
          and conversation_id in (${firstId}, ${secondId})
      ) as heads,
      (
        select count(*)::text
        from inbox_v2_external_thread_key_registry
        where tenant_id = ${tenantId}
          and canonical_conversation_id in (${firstId}, ${secondId})
      ) as registries,
      (
        select count(*)::text
        from inbox_v2_external_threads
        where tenant_id = ${tenantId}
          and conversation_id in (${firstId}, ${secondId})
      ) as threads
  `);

  const row = result.rows[0];
  if (!row) {
    throw new Error("Expected aggregate count row.");
  }
  return row;
}
