import {
  INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS,
  INBOX_V2_LEGACY_V1_CLIENT_LINK_PROVENANCE_ID,
  inboxV2BigintCounterSchema,
  inboxV2ClientIdSchema,
  inboxV2ClientMergeDecisionSchema,
  inboxV2ClientMergeRedirectIdSchema,
  inboxV2ClientMergeTrustedServiceIdSchema,
  inboxV2ConversationClientLinkDecisionSchema,
  inboxV2ConversationClientLinkIdSchema,
  inboxV2ConversationClientLinkSchema,
  inboxV2ConversationClientLinkTransitionIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TenantIdSchema,
  type InboxV2ClientId,
  type InboxV2ClientMergeDecision,
  type InboxV2ConversationClientLink,
  type InboxV2ConversationClientLinkDecision,
  type InboxV2ConversationClientLinkId,
  type InboxV2ConversationId,
  type InboxV2EmployeeId,
  type InboxV2EntityRevision,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2ClientMergeRepository } from "./sql-inbox-v2-client-merge-repository";
import {
  createSqlInboxV2ConversationClientLinkRepository,
  type InboxV2ConversationClientLinkTransactionExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-conversation-client-link-repository";
import { createSqlInboxV2ConversationRepository } from "./sql-inbox-v2-conversation-repository";
import type { InboxV2TenantPolicyAuthorityUseTransaction } from "./sql-inbox-v2-tenant-policy-authority-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantA = tenant("a");
const tenantB = tenant("b");
const employeeA = employee("operator-a");
const t0 = "2026-07-14T01:00:00.000Z";
const t1 = "2026-07-14T01:01:00.000Z";
const t2 = "2026-07-14T01:02:00.000Z";
const t3 = "2026-07-14T01:03:00.000Z";
const mergeResolverId = inboxV2ClientMergeTrustedServiceIdSchema.parse(
  "core:client-merge-resolver"
);

describePostgres("SQL Inbox V2 Client relations (PostgreSQL)", () => {
  let db: HuleeDatabase;

  beforeAll(async () => {
    db = createHuleeDatabase();
    const readiness = await db.execute<Record<string, string | null>>(sql`
      select
        to_regclass(
          'public.inbox_v2_conversation_client_links'
        )::text as links,
        to_regclass(
          'public.inbox_v2_conversation_client_link_heads'
        )::text as link_heads,
        to_regclass(
          'public.inbox_v2_conversation_client_link_transitions'
        )::text as link_transitions,
        to_regclass(
          'public.inbox_v2_conversation_client_link_roles'
        )::text as link_roles,
        to_regclass(
          'public.inbox_v2_conversation_client_link_transition_operations'
        )::text as link_operations,
        to_regclass(
          'public.inbox_v2_client_merge_redirects'
        )::text as merge_redirects,
        to_regclass(
          'public.inbox_v2_client_merge_node_states'
        )::text as merge_nodes,
        to_regclass(
          'public.inbox_v2_client_merge_graph_heads'
        )::text as merge_heads
    `);
    const row = readiness.rows[0];
    if (
      row === undefined ||
      Object.values(row).some((value) => value === null)
    ) {
      throw new Error(
        "Inbox V2 Client-relation PostgreSQL tables are not migrated."
      );
    }

    await insertTenant(db, tenantA, "A");
    await insertTenant(db, tenantB, "B");
    await db.execute(sql`
      insert into employees (
        id, tenant_id, email, display_name, profile, created_at, updated_at
      ) values (
        ${employeeA},
        ${tenantA},
        ${`db002-relations-${runId}@example.test`},
        'DB002 Client relations operator',
        '{}'::jsonb,
        ${t0},
        ${t0}
      )
    `);
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await closeHuleeDatabase(db);
  }, 30_000);

  it("bootstraps the mandatory initial merge node for every new Client", async () => {
    const clientId = await seedClient(db, tenantA, "merge-node-bootstrap");
    const stored = await db.execute<{
      state: string;
      next_client_id: string | null;
      redirect_id: string | null;
      maximum_inbound_depth: number;
      revision: string;
      last_graph_revision: string | null;
    }>(sql`
      select
        state,
        next_client_id,
        redirect_id,
        maximum_inbound_depth,
        revision::text,
        last_graph_revision::text
      from inbox_v2_client_merge_node_states
      where tenant_id = ${tenantA}
        and client_id = ${clientId}
    `);

    expect(stored.rows).toEqual([
      {
        state: "canonical_root",
        next_client_id: null,
        redirect_id: null,
        maximum_inbound_depth: 0,
        revision: "1",
        last_graph_revision: null
      }
    ]);
    const ensured = await createSqlInboxV2ClientMergeRepository(
      db
    ).ensureClientNode({ tenantId: tenantA, clientId });
    expect(ensured).toMatchObject({
      kind: "ready",
      node: {
        state: "canonical_root",
        maximumInboundDepth: 0,
        revision: "1",
        lastGraphRevision: null
      }
    });
  });

  it("rolls back direct deletion of a mandatory node while its Client is live", async () => {
    const clientId = await seedClient(db, tenantA, "merge-node-delete");
    let observedDeletedInsideTransaction = false;

    await expectPostgresError(
      db.transaction(async (transaction) => {
        const deleted = await transaction.execute<{ client_id: string }>(sql`
          delete from inbox_v2_client_merge_node_states
          where tenant_id = ${tenantA}
            and client_id = ${clientId}
          returning client_id
        `);
        expect(deleted.rows).toEqual([{ client_id: clientId }]);
        const inside = await transaction.execute<{ nodes: string }>(sql`
          select count(*)::text as nodes
          from inbox_v2_client_merge_node_states
          where tenant_id = ${tenantA}
            and client_id = ${clientId}
        `);
        expect(inside.rows).toEqual([{ nodes: "0" }]);
        observedDeletedInsideTransaction = true;
      }),
      "23514"
    );
    expect(observedDeletedInsideTransaction).toBe(true);

    const afterRollback = await db.execute<{
      clients: string;
      nodes: string;
    }>(sql`
      select
        (
          select count(*)::text
          from clients
          where tenant_id = ${tenantA}
            and id = ${clientId}
        ) as clients,
        (
          select count(*)::text
          from inbox_v2_client_merge_node_states
          where tenant_id = ${tenantA}
            and client_id = ${clientId}
        ) as nodes
    `);
    expect(afterRollback.rows).toEqual([{ clients: "1", nodes: "1" }]);
  });

  it("allows Client node cascade and subsequent Tenant head cascade", async () => {
    const cascadeTenant = await seedIsolatedTenant(db, "merge-cascade");
    const clientId = await seedClient(
      db,
      cascadeTenant,
      "merge-cascade-client"
    );

    await db.execute(sql`
      delete from clients
      where tenant_id = ${cascadeTenant}
        and id = ${clientId}
    `);
    const afterClientDelete = await db.execute<{
      clients: string;
      nodes: string;
      heads: string;
    }>(sql`
      select
        (
          select count(*)::text from clients
          where tenant_id = ${cascadeTenant}
        ) as clients,
        (
          select count(*)::text
          from inbox_v2_client_merge_node_states
          where tenant_id = ${cascadeTenant}
        ) as nodes,
        (
          select count(*)::text
          from inbox_v2_client_merge_graph_heads
          where tenant_id = ${cascadeTenant}
        ) as heads
    `);
    expect(afterClientDelete.rows).toEqual([
      { clients: "0", nodes: "0", heads: "1" }
    ]);

    await db.execute(sql`
      delete from tenants
      where id = ${cascadeTenant}
    `);
    const afterTenantDelete = await db.execute<{
      tenants: string;
      heads: string;
      nodes: string;
    }>(sql`
      select
        (
          select count(*)::text from tenants
          where id = ${cascadeTenant}
        ) as tenants,
        (
          select count(*)::text
          from inbox_v2_client_merge_graph_heads
          where tenant_id = ${cascadeTenant}
        ) as heads,
        (
          select count(*)::text
          from inbox_v2_client_merge_node_states
          where tenant_id = ${cascadeTenant}
        ) as nodes
    `);
    expect(afterTenantDelete.rows).toEqual([
      { tenants: "0", heads: "0", nodes: "0" }
    ]);
  });

  it("keeps an untouched Conversation at the contract-null Client-link head", async () => {
    const conversationId = await seedConversation(db, tenantA, "untouched");

    expect(await loadLinkSnapshot(db, tenantA, conversationId)).toEqual({
      head_revision: null,
      primary_link_id: null,
      links: "0",
      active_links: "0",
      ended_links: "0",
      transitions: "0",
      roles: "0",
      operations: "0"
    });
  });

  it("commits the first manual link as one null-to-1 transition", async () => {
    const conversationId = await seedConversation(db, tenantA, "first-link");
    const clientId = await seedClient(db, tenantA, "first-link");
    const linkId = link("first-link");
    const decision = manualDecision();
    const candidate = manualLink({
      conversationId,
      clientId,
      linkId,
      decision,
      occurredAt: t1
    });

    const result = await createSqlInboxV2ConversationClientLinkRepository(
      db
    ).applyTransition({
      tenantId: tenantA,
      conversationId,
      transitionId: transition("first-link"),
      expectedRevision: null,
      decision,
      operations: [{ kind: "create_link", link: candidate }],
      resultingPrimaryLinkId: linkId,
      occurredAt: t1
    });

    expect(result).toMatchObject({
      kind: "applied",
      transition: {
        expectedRevision: null,
        currentRevision: null,
        resultingRevision: "1",
        previousPrimaryLink: null,
        resultingPrimaryLink: { id: linkId }
      }
    });
    expect(await loadLinkSnapshot(db, tenantA, conversationId)).toEqual({
      head_revision: "1",
      primary_link_id: linkId,
      links: "1",
      active_links: "1",
      ended_links: "0",
      transitions: "1",
      roles: "1",
      operations: "1"
    });
  });

  it("atomically replaces one active episode for the same Client", async () => {
    const conversationId = await seedConversation(db, tenantA, "relink");
    const clientId = await seedClient(db, tenantA, "relink");
    const oldLinkId = link("relink-old");
    const newLinkId = link("relink-new");
    const decision = manualDecision();
    const repository = createSqlInboxV2ConversationClientLinkRepository(db);

    const first = await repository.applyTransition({
      tenantId: tenantA,
      conversationId,
      transitionId: transition("relink-first"),
      expectedRevision: null,
      decision,
      operations: [
        {
          kind: "create_link",
          link: manualLink({
            conversationId,
            clientId,
            linkId: oldLinkId,
            decision,
            occurredAt: t1
          })
        }
      ],
      resultingPrimaryLinkId: oldLinkId,
      occurredAt: t1
    });
    expect(first.kind).toBe("applied");

    const replaced = await repository.applyTransition({
      tenantId: tenantA,
      conversationId,
      transitionId: transition("relink-replace"),
      expectedRevision: revision("1"),
      decision,
      operations: [
        { kind: "end_link", linkId: oldLinkId },
        {
          kind: "create_link",
          link: manualLink({
            conversationId,
            clientId,
            linkId: newLinkId,
            decision,
            occurredAt: t2,
            roleId: INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.related
          })
        }
      ],
      resultingPrimaryLinkId: newLinkId,
      occurredAt: t2
    });

    expect(replaced).toMatchObject({
      kind: "applied",
      transition: {
        expectedRevision: "1",
        currentRevision: "1",
        resultingRevision: "2",
        previousPrimaryLink: { id: oldLinkId },
        resultingPrimaryLink: { id: newLinkId }
      }
    });
    expect(await loadLinkSnapshot(db, tenantA, conversationId)).toEqual({
      head_revision: "2",
      primary_link_id: newLinkId,
      links: "2",
      active_links: "1",
      ended_links: "1",
      transitions: "2",
      roles: "2",
      operations: "3"
    });
    const links = await db.execute<{
      id: string;
      state: string;
      revision: string;
      ended_at: string | null;
    }>(sql`
      select id, state, revision::text, ended_at
      from inbox_v2_conversation_client_links
      where tenant_id = ${tenantA}
        and conversation_id = ${conversationId}
      order by id
    `);
    expect(links.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: oldLinkId,
          state: "ended",
          revision: "2"
        }),
        expect.objectContaining({
          id: newLinkId,
          state: "active",
          revision: "1",
          ended_at: null
        })
      ])
    );
    const endedAt = links.rows.find((row) => row.id === oldLinkId)?.ended_at;
    expect(Date.parse(String(endedAt))).toBe(Date.parse(t2));
  });

  it("rejects non-eligible supported and migration links as primary", async () => {
    const repository = createSqlInboxV2ConversationClientLinkRepository(db);
    const cases = ["supported", "migration"] as const;

    for (const kind of cases) {
      const conversationId = await seedConversation(
        db,
        tenantA,
        `primary-${kind}`
      );
      const clientId = await seedClient(db, tenantA, `primary-${kind}`);
      const linkId = link(`primary-${kind}`);
      const decision =
        kind === "migration" ? migrationDecision() : manualDecision();
      const candidate =
        kind === "migration"
          ? migrationLink({
              conversationId,
              clientId,
              linkId,
              decision,
              occurredAt: t1
            })
          : manualLink({
              conversationId,
              clientId,
              linkId,
              decision,
              occurredAt: t1,
              confidence: "supported"
            });

      const result = await repository.applyTransition({
        tenantId: tenantA,
        conversationId,
        transitionId: transition(`primary-${kind}`),
        expectedRevision: null,
        decision,
        operations: [{ kind: "create_link", link: candidate }],
        resultingPrimaryLinkId: linkId,
        occurredAt: t1
      });

      expect(result).toEqual({ kind: "link_state_conflict", linkId });
      expect(await loadLinkSnapshot(db, tenantA, conversationId)).toMatchObject(
        {
          head_revision: null,
          links: "0",
          transitions: "0",
          operations: "0"
        }
      );
    }
  });

  it("commits the initial Client merge as one null-to-1 graph transition", async () => {
    const mergeTenant = await seedIsolatedTenant(db, "initial-merge");
    const sourceClientId = await seedClient(db, mergeTenant, "merge-source");
    const targetClientId = await seedClient(db, mergeTenant, "merge-target");
    const repository = createSqlInboxV2ClientMergeRepository(db);

    expect(await loadMergeHeadRevision(db, mergeTenant)).toBeNull();
    const result = await repository.mergeRoots({
      tenantId: mergeTenant,
      redirectId: redirect("initial"),
      sourceRootClientId: sourceClientId,
      targetRootClientId: targetClientId,
      expectedGraphRevision: null,
      resolverTrustedServiceId: mergeResolverId,
      resolvedAt: t1,
      decision: mergeDecision(),
      createdAt: t2
    });

    expect(result).toMatchObject({
      kind: "merged",
      commit: {
        graphHeadAfter: { revision: "1", updatedAt: t2 },
        redirect: {
          currentGraphRevision: null,
          resultingGraphRevision: "1"
        },
        sourceNodeAfter: {
          state: "redirected",
          nextClient: { id: targetClientId }
        },
        targetNodeAfter: {
          state: "canonical_root",
          maximumInboundDepth: 1
        }
      }
    });
    expect(await loadMergeHeadRevision(db, mergeTenant)).toBe("1");

    const resolved = await repository.resolveCanonical({
      tenantId: mergeTenant,
      clientId: sourceClientId,
      trustedServiceId: mergeResolverId,
      resolvedAt: t3
    });
    expect(resolved).toMatchObject({
      kind: "resolved",
      resolution: {
        requestedClient: { id: sourceClientId },
        canonicalClient: { id: targetClientId },
        graphHead: { revision: "1" }
      }
    });
  });

  it("serializes stale/root and reciprocal merge races to one winner", async () => {
    const raceTenant = await seedIsolatedTenant(db, "merge-races");
    const sourceClientId = await seedClient(db, raceTenant, "race-source");
    const targetA = await seedClient(db, raceTenant, "race-target-a");
    const targetB = await seedClient(db, raceTenant, "race-target-b");
    const repository = createSqlInboxV2ClientMergeRepository(db);

    const firstRace = await Promise.all([
      repository.mergeRoots({
        ...mergeInput(raceTenant, sourceClientId, targetA, "stale-a"),
        expectedGraphRevision: null
      }),
      repository.mergeRoots({
        ...mergeInput(raceTenant, sourceClientId, targetB, "stale-b"),
        expectedGraphRevision: null
      })
    ]);
    expect(firstRace.map((result) => result.kind).sort()).toEqual([
      "graph_revision_conflict",
      "merged"
    ]);

    const rootRetry = await repository.mergeRoots({
      ...mergeInput(raceTenant, sourceClientId, targetB, "root-retry"),
      expectedGraphRevision: revision("1"),
      resolvedAt: t2,
      createdAt: t3
    });
    expect(rootRetry.kind).toBe("root_conflict");

    const reciprocalA = await seedClient(db, raceTenant, "reciprocal-a");
    const reciprocalB = await seedClient(db, raceTenant, "reciprocal-b");
    const reciprocalRace = await Promise.all([
      repository.mergeRoots({
        ...mergeInput(raceTenant, reciprocalA, reciprocalB, "reciprocal-a-b"),
        expectedGraphRevision: revision("1"),
        resolvedAt: t2,
        createdAt: t3
      }),
      repository.mergeRoots({
        ...mergeInput(raceTenant, reciprocalB, reciprocalA, "reciprocal-b-a"),
        expectedGraphRevision: revision("1"),
        resolvedAt: t2,
        createdAt: t3
      })
    ]);
    expect(reciprocalRace.map((result) => result.kind).sort()).toEqual([
      "graph_revision_conflict",
      "merged"
    ]);

    const reciprocalNodes = await db.execute<{
      client_id: string;
      state: string;
      next_client_id: string | null;
    }>(sql`
      select client_id, state, next_client_id
      from inbox_v2_client_merge_node_states
      where tenant_id = ${raceTenant}
        and client_id in (${reciprocalA}, ${reciprocalB})
      order by client_id
    `);
    expect(
      reciprocalNodes.rows.filter((row) => row.state === "redirected")
    ).toHaveLength(1);
    expect(
      reciprocalNodes.rows.filter((row) => row.state === "canonical_root")
    ).toHaveLength(1);
    expect(await loadMergeHeadRevision(db, raceTenant)).toBe("2");
  });

  it("rejects a raw cross-tenant Conversation-to-Client edge", async () => {
    const conversationId = await seedConversation(db, tenantA, "cross-tenant");
    const foreignClientId = await seedClient(db, tenantB, "cross-tenant");
    const rawLinkId = link("cross-tenant");

    await expectPostgresError(
      db.execute(sql`
        insert into inbox_v2_conversation_client_links (
          tenant_id, id, conversation_id, client_id,
          association_confidence, provenance_kind,
          linked_actor_kind, linked_actor_employee_id,
          linked_policy_id, linked_policy_version, linked_reason_code_id,
          valid_from, valid_from_basis, state, revision
        ) values (
          ${tenantA}, ${rawLinkId}, ${conversationId}, ${foreignClientId},
          'confirmed', 'manual',
          'employee', ${employeeA},
          'core:manual-client-link', 'v1', 'core:operator-linked-client',
          ${t1}, 'known_effective', 'active', 1
        )
      `),
      "23503"
    );
    expect(await loadLinkSnapshot(db, tenantA, conversationId)).toMatchObject({
      head_revision: null,
      links: "0",
      transitions: "0"
    });
  });

  it("rolls back every Client-link row after a late transactional failure", async () => {
    const conversationId = await seedConversation(db, tenantA, "rollback");
    const clientId = await seedClient(db, tenantA, "rollback");
    const linkId = link("rollback");
    const decision = manualDecision();
    const repository = createSqlInboxV2ConversationClientLinkRepository(
      failAfterLinkOperationExecutor(db)
    );

    await expect(
      repository.applyTransition({
        tenantId: tenantA,
        conversationId,
        transitionId: transition("rollback"),
        expectedRevision: null,
        decision,
        operations: [
          {
            kind: "create_link",
            link: manualLink({
              conversationId,
              clientId,
              linkId,
              decision,
              occurredAt: t1
            })
          }
        ],
        resultingPrimaryLinkId: linkId,
        occurredAt: t1
      })
    ).rejects.toThrow("injected Client-link rollback");

    expect(await loadLinkSnapshot(db, tenantA, conversationId)).toEqual({
      head_revision: null,
      primary_link_id: null,
      links: "0",
      active_links: "0",
      ended_links: "0",
      transitions: "0",
      roles: "0",
      operations: "0"
    });
  });
});

async function insertTenant(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId,
  label: string
): Promise<void> {
  await db.execute(sql`
    insert into tenants (id, slug, display_name, deployment_type, created_at, updated_at)
    values (
      ${tenantId},
      ${`db002-relations-${label.toLowerCase()}-${runId}`},
      ${`DB002 Client relations tenant ${label}`},
      'saas_shared',
      ${t0},
      ${t0}
    )
  `);
}

async function seedIsolatedTenant(
  db: HuleeDatabase,
  suffix: string
): Promise<InboxV2TenantId> {
  const tenantId = tenant(suffix);
  await insertTenant(db, tenantId, suffix);
  return tenantId;
}

async function seedClient(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId,
  suffix: string
): Promise<InboxV2ClientId> {
  const clientId = client(suffix);
  await db.execute(sql`
    insert into clients (
      id, tenant_id, display_name, source, created_at, updated_at
    ) values (
      ${clientId},
      ${tenantId},
      ${`DB002 Client ${suffix}`},
      'db002-integration',
      ${t0},
      ${t0}
    )
  `);
  return clientId;
}

async function seedConversation(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId,
  suffix: string
): Promise<InboxV2ConversationId> {
  const conversationId = conversation(suffix);
  const created = await createSqlInboxV2ConversationRepository(db).create({
    tenantId,
    conversationId,
    topology: "group",
    transport: "external",
    purposeId: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
    lifecycle: "active",
    streamPosition: inboxV2BigintCounterSchema.parse("1"),
    createdAt: t0
  });
  if (created.kind !== "created") {
    throw new Error(`Expected seeded Conversation, got ${created.kind}.`);
  }
  return conversationId;
}

function manualDecision(): InboxV2ConversationClientLinkDecision {
  return inboxV2ConversationClientLinkDecisionSchema.parse({
    actor: {
      kind: "employee",
      employee: { tenantId: tenantA, kind: "employee", id: employeeA }
    },
    policyId: "core:manual-client-link",
    policyVersion: "v1",
    reasonCodeId: "core:operator-linked-client",
    policyAuthority: null
  });
}

function migrationDecision(): InboxV2ConversationClientLinkDecision {
  return inboxV2ConversationClientLinkDecisionSchema.parse({
    actor: {
      kind: "migration_service",
      trustedServiceId: "core:inbox-v1-migration"
    },
    policyId: "core:inbox-v1-client-link-import",
    policyVersion: "v1",
    reasonCodeId: "core:legacy-client-association",
    policyAuthority: null
  });
}

function manualLink(input: {
  conversationId: InboxV2ConversationId;
  clientId: InboxV2ClientId;
  linkId: InboxV2ConversationClientLinkId;
  decision: InboxV2ConversationClientLinkDecision;
  occurredAt: string;
  confidence?: "confirmed" | "supported" | "tentative";
  roleId?: (typeof INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS)[keyof typeof INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS];
}): InboxV2ConversationClientLink {
  return inboxV2ConversationClientLinkSchema.parse({
    tenantId: tenantA,
    id: input.linkId,
    conversation: {
      tenantId: tenantA,
      kind: "conversation",
      id: input.conversationId
    },
    client: { tenantId: tenantA, kind: "client", id: input.clientId },
    roleIds: [
      input.roleId ?? INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.subject
    ],
    associationConfidence: input.confidence ?? "confirmed",
    provenance: { kind: "manual" },
    auditEvidenceReferences: [],
    linkedBy: input.decision,
    validFrom: input.occurredAt,
    validFromBasis: "known_effective",
    state: "active",
    termination: null,
    revision: "1"
  });
}

function migrationLink(input: {
  conversationId: InboxV2ConversationId;
  clientId: InboxV2ClientId;
  linkId: InboxV2ConversationClientLinkId;
  decision: InboxV2ConversationClientLinkDecision;
  occurredAt: string;
}): InboxV2ConversationClientLink {
  return inboxV2ConversationClientLinkSchema.parse({
    tenantId: tenantA,
    id: input.linkId,
    conversation: {
      tenantId: tenantA,
      kind: "conversation",
      id: input.conversationId
    },
    client: { tenantId: tenantA, kind: "client", id: input.clientId },
    roleIds: [INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.legacyUnspecified],
    associationConfidence: "confirmed",
    provenance: {
      kind: "migration",
      provenanceId: INBOX_V2_LEGACY_V1_CLIENT_LINK_PROVENANCE_ID,
      contractVersion: "v1"
    },
    auditEvidenceReferences: [],
    linkedBy: input.decision,
    validFrom: input.occurredAt,
    validFromBasis: "migration_observed",
    state: "active",
    termination: null,
    revision: "1"
  });
}

function mergeDecision(): InboxV2ClientMergeDecision {
  return inboxV2ClientMergeDecisionSchema.parse({
    actor: {
      kind: "trusted_service",
      trustedServiceId: mergeResolverId
    },
    policyId: "core:client-merge-manual",
    policyVersion: "v1",
    reasonCodeId: "core:duplicate-client"
  });
}

function mergeInput(
  tenantId: InboxV2TenantId,
  sourceRootClientId: InboxV2ClientId,
  targetRootClientId: InboxV2ClientId,
  suffix: string
) {
  return {
    tenantId,
    redirectId: redirect(suffix),
    sourceRootClientId,
    targetRootClientId,
    resolverTrustedServiceId: mergeResolverId,
    resolvedAt: t1,
    decision: mergeDecision(),
    createdAt: t2
  };
}

async function loadLinkSnapshot(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId,
  conversationId: InboxV2ConversationId
) {
  const result = await db.execute<{
    head_revision: string | null;
    primary_link_id: string | null;
    links: string;
    active_links: string;
    ended_links: string;
    transitions: string;
    roles: string;
    operations: string;
  }>(sql`
    select
      (
        select revision::text
        from inbox_v2_conversation_client_link_heads
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as head_revision,
      (
        select primary_link_id
        from inbox_v2_conversation_client_link_heads
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as primary_link_id,
      (
        select count(*)::text
        from inbox_v2_conversation_client_links
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as links,
      (
        select count(*)::text
        from inbox_v2_conversation_client_links
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
          and state = 'active'
      ) as active_links,
      (
        select count(*)::text
        from inbox_v2_conversation_client_links
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
          and state = 'ended'
      ) as ended_links,
      (
        select count(*)::text
        from inbox_v2_conversation_client_link_transitions
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as transitions,
      (
        select count(*)::text
        from inbox_v2_conversation_client_link_roles
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as roles,
      (
        select count(*)::text
        from inbox_v2_conversation_client_link_transition_operations
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
      ) as operations
  `);
  const row = result.rows[0];
  if (row === undefined)
    throw new Error("Client-link snapshot query returned no row.");
  return row;
}

async function loadMergeHeadRevision(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId
): Promise<InboxV2EntityRevision | null> {
  const result = await db.execute<{ revision: string | null }>(sql`
    select revision::text
    from inbox_v2_client_merge_graph_heads
    where tenant_id = ${tenantId}
  `);
  const row = result.rows[0];
  if (row === undefined)
    throw new Error("Mandatory Client-merge head is missing.");
  return row.revision === null ? null : revision(row.revision);
}

function failAfterLinkOperationExecutor(
  db: HuleeDatabase
): InboxV2ConversationClientLinkTransactionExecutor {
  return {
    async execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      return (await db.execute(query)) as unknown as RawSqlQueryResult<Row>;
    },
    async transaction<TResult>(
      work: (
        transaction: InboxV2TenantPolicyAuthorityUseTransaction
      ) => Promise<TResult>,
      config: Readonly<{ isolationLevel: "read committed" }>
    ): Promise<TResult> {
      return db.transaction(async (transactionExecutor) => {
        const faultingExecutor = {
          async execute<Row extends Record<string, unknown>>(
            query: SQL
          ): Promise<RawSqlQueryResult<Row>> {
            const result = (await transactionExecutor.execute(
              query
            )) as unknown as RawSqlQueryResult<Row>;
            if (
              normalizeSql(query).includes(
                "insert into inbox_v2_conversation_client_link_transition_operations"
              )
            ) {
              throw new Error("injected Client-link rollback");
            }
            return result;
          }
        };
        return work(
          faultingExecutor as InboxV2TenantPolicyAuthorityUseTransaction
        );
      }, config);
    }
  };
}

function normalizeSql(query: SQL): string {
  return new PgDialect()
    .sqlToQuery(query)
    .sql.replaceAll('"', "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

async function expectPostgresError(
  operation: Promise<unknown>,
  expectedSqlState: string
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(readSqlState(error)).toBe(expectedSqlState);
    return;
  }
  throw new Error(`Expected PostgreSQL SQLSTATE ${expectedSqlState}.`);
}

function readSqlState(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== null; depth += 1) {
    if (typeof current !== "object") return "";
    if ("code" in current && typeof current.code === "string") {
      return current.code;
    }
    current = "cause" in current ? current.cause : null;
  }
  return "";
}

function tenant(suffix: string): InboxV2TenantId {
  return inboxV2TenantIdSchema.parse(`tenant:db002-rel-${suffix}-${runId}`);
}

function employee(suffix: string): InboxV2EmployeeId {
  return inboxV2EmployeeIdSchema.parse(`employee:db002-rel-${suffix}-${runId}`);
}

function client(suffix: string): InboxV2ClientId {
  return inboxV2ClientIdSchema.parse(`client:db002-rel-${suffix}-${runId}`);
}

function conversation(suffix: string): InboxV2ConversationId {
  return inboxV2ConversationIdSchema.parse(
    `conversation:db002-rel-${suffix}-${runId}`
  );
}

function link(suffix: string): InboxV2ConversationClientLinkId {
  return inboxV2ConversationClientLinkIdSchema.parse(
    `conversation_client_link:db002-rel-${suffix}-${runId}`
  );
}

function transition(suffix: string) {
  return inboxV2ConversationClientLinkTransitionIdSchema.parse(
    `conversation_client_link_transition:db002-rel-${suffix}-${runId}`
  );
}

function redirect(suffix: string) {
  return inboxV2ClientMergeRedirectIdSchema.parse(
    `client_merge_redirect:db002-rel-${suffix}-${runId}`
  );
}

function revision(value: string): InboxV2EntityRevision {
  return inboxV2EntityRevisionSchema.parse(value);
}
