import type {
  InboxV2ClientContactId,
  InboxV2ConversationClientLink,
  InboxV2ConversationClientLinkDecision,
  InboxV2ConversationClientLinkId,
  InboxV2ConversationClientLinkTransitionId,
  InboxV2ConversationId,
  InboxV2EmployeeId,
  InboxV2EntityRevision,
  InboxV2SourceExternalIdentityId,
  InboxV2SourceIdentityClaimId,
  InboxV2TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type { InboxV2TenantPolicyAuthorityUseTransaction } from "./sql-inbox-v2-tenant-policy-authority-repository";
import {
  buildFindConflictingInboxV2ConversationClientLinksSql,
  buildFindCurrentInboxV2ConversationClientLinksByClientIdsSql,
  buildFindInboxV2ConversationClientLinkClaimAnchorsSql,
  buildFindInboxV2ConversationClientLinksByIdsSql,
  buildLockInboxV2ConversationClientLinkClaimHeadsSql,
  buildLockInboxV2ConversationClientLinkClaimsSql,
  buildLockInboxV2ConversationClientLinkClientContactsSql,
  buildLockInboxV2ConversationClientLinkClientsSql,
  buildLockInboxV2ConversationClientLinkConversationSql,
  buildLockInboxV2ConversationClientLinkEmployeesSql,
  buildLockInboxV2ConversationClientLinkHeadSql,
  buildLockInboxV2ConversationClientLinkSourceIdentitiesSql,
  createSqlInboxV2ConversationClientLinkRepository,
  type ApplyInboxV2ConversationClientLinkTransitionInput,
  type InboxV2ConversationClientLinkTransactionExecutor
} from "./sql-inbox-v2-conversation-client-link-repository";
import type { RawSqlQueryResult } from "./sql-outbox-repository";

const tenantId = "tenant:db-002-client-link" as InboxV2TenantId;
const conversationId = "conversation:client-link-1" as InboxV2ConversationId;
const clientId = "client:client-1";
const secondClientId = "client:client-2";
const employeeId = "employee:operator-1" as InboxV2EmployeeId;
const linkId =
  "conversation_client_link:link-1" as InboxV2ConversationClientLinkId;
const secondLinkId =
  "conversation_client_link:link-2" as InboxV2ConversationClientLinkId;
const transitionId =
  "conversation_client_link_transition:transition-1" as InboxV2ConversationClientLinkTransitionId;
const sourceExternalIdentityId =
  "source_external_identity:identity-1" as InboxV2SourceExternalIdentityId;
const claimId = "source_identity_claim:claim-1" as InboxV2SourceIdentityClaimId;
const clientContactId = "client_contact:contact-1" as InboxV2ClientContactId;
const participantId = "conversation_participant:participant-1";
const verificationServiceId = "core:client-link-resolver";
const claimCreatedAt = "2026-07-14T07:00:00.000Z";
const occurredAt = "2026-07-14T08:00:00.000Z";
const endedAt = "2026-07-14T09:00:00.000Z";

describe("SQL Inbox V2 ConversationClientLink repository", () => {
  it("keeps reads and locks tenant-scoped in the canonical total order", () => {
    const conversationLock = renderQuery(
      buildLockInboxV2ConversationClientLinkConversationSql({
        tenantId,
        conversationId
      })
    );
    const headLock = renderQuery(
      buildLockInboxV2ConversationClientLinkHeadSql({
        tenantId,
        conversationId
      })
    );
    const currentLookup = renderQuery(
      buildFindCurrentInboxV2ConversationClientLinksByClientIdsSql({
        tenantId,
        conversationId,
        clientIds: ["client:z", "client:a"]
      })
    );
    const claimPreRead = renderQuery(
      buildFindInboxV2ConversationClientLinkClaimAnchorsSql({
        tenantId,
        claimIds: [claimId]
      })
    );
    const identityLock = renderQuery(
      buildLockInboxV2ConversationClientLinkSourceIdentitiesSql({
        tenantId,
        sourceExternalIdentityIds: [sourceExternalIdentityId]
      })
    );
    const claimHeadLock = renderQuery(
      buildLockInboxV2ConversationClientLinkClaimHeadsSql({
        tenantId,
        sourceExternalIdentityIds: [sourceExternalIdentityId]
      })
    );
    const claimLock = renderQuery(
      buildLockInboxV2ConversationClientLinkClaimsSql({
        tenantId,
        conversationId,
        claimIds: [claimId]
      })
    );
    const employeeLock = renderQuery(
      buildLockInboxV2ConversationClientLinkEmployeesSql({
        tenantId,
        employeeIds: [employeeId]
      })
    );
    const contactLock = renderQuery(
      buildLockInboxV2ConversationClientLinkClientContactsSql({
        tenantId,
        clientContactIds: [clientContactId]
      })
    );
    const clientLock = renderQuery(
      buildLockInboxV2ConversationClientLinkClientsSql({
        tenantId,
        clientIds: ["client:a", "client:z"]
      })
    );
    const linkLock = renderQuery(
      buildFindInboxV2ConversationClientLinksByIdsSql({
        tenantId,
        conversationId,
        linkIds: [String(linkId)],
        lock: true
      })
    );
    const conflictLookup = renderQuery(
      buildFindConflictingInboxV2ConversationClientLinksSql({
        tenantId,
        linkIds: [linkId]
      })
    );

    expect(normalizeSql(conversationLock.sql)).toContain(
      "where conversation_row.tenant_id ="
    );
    expect(normalizeSql(conversationLock.sql)).toContain("for no key update");
    expect(conversationLock.params).toEqual([tenantId, conversationId]);
    expect(normalizeSql(headLock.sql)).toContain("where head_row.tenant_id =");
    expect(normalizeSql(headLock.sql)).toContain("for update");
    expect(headLock.params).toEqual([tenantId, conversationId]);

    expect(normalizeSql(currentLookup.sql)).toContain(
      'order by link_row.client_id collate "c", link_row.id collate "c"'
    );
    expect(currentLookup.params).toContain(tenantId);
    expect(currentLookup.params).toContain(conversationId);
    expect(normalizeSql(claimPreRead.sql)).not.toContain("for share");
    expect(normalizeSql(claimPreRead.sql)).toContain(
      'order by claim_row.id collate "c"'
    );
    expect(claimPreRead.params).toContain(tenantId);

    expect(normalizeSql(identityLock.sql)).toContain(
      'order by identity_row.id collate "c" for share of identity_row'
    );
    expect(normalizeSql(claimHeadLock.sql)).toContain(
      'order by head_row.source_external_identity_id collate "c" for share of head_row'
    );
    expect(normalizeSql(claimLock.sql)).not.toContain(
      "from inbox_v2_conversation_participants participant_row"
    );
    expect(normalizeSql(claimLock.sql)).toContain("for share of claim_row");
    expect(claimLock.params).toContain(tenantId);
    expect(claimLock.params).not.toContain(conversationId);
    expect(normalizeSql(employeeLock.sql)).toContain(
      'order by employee_row.id collate "c" for no key update'
    );
    expect(normalizeSql(contactLock.sql)).toContain(
      'order by contact_row.id collate "c" for share of contact_row'
    );
    expect(normalizeSql(clientLock.sql)).toContain(
      'order by client_row.id collate "c" for no key update'
    );
    expect(normalizeSql(linkLock.sql)).toContain(
      'order by link_row.id collate "c" for update of link_row'
    );
    expect(normalizeSql(conflictLookup.sql)).toContain(
      'order by link_row.id collate "c"'
    );
    expect(conflictLookup.params).toEqual([tenantId, linkId]);
  });

  it("creates the first primary manual link with an absent head and safe FK write order", async () => {
    const executor = successfulCreateExecutor();
    const repository =
      createSqlInboxV2ConversationClientLinkRepository(executor);

    await expect(repository.applyTransition(createInput())).resolves.toEqual({
      kind: "applied",
      transition: expect.objectContaining({
        tenantId,
        id: transitionId,
        expectedRevision: null,
        currentRevision: null,
        resultingRevision: "1",
        previousPrimaryLink: null,
        resultingPrimaryLink: expect.objectContaining({ id: linkId })
      })
    });

    expect(executor.transactionIsolationLevels).toEqual(["read committed"]);
    expect(executor.transactionCount).toBe(1);
    expect(executor.commitCount).toBe(1);
    expect(executor.rollbackCount).toBe(0);
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_conversation",
      "lock_head",
      "find_current_links",
      "find_links",
      "lock_employees",
      "lock_clients",
      "insert_link",
      "insert_transition",
      "insert_role",
      "insert_operation",
      "insert_head"
    ]);
    executor.expectExhausted();
  });

  it("round-trips non-empty manual audit evidence in exact input order", async () => {
    const link = manualLinkWithAuditEvidence();
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [],
      [],
      [],
      [activeEmployeeRow()],
      [{ id: clientId }],
      [{ id: clientContactId, client_id: clientId }],
      [
        {
          id: participantId,
          conversation_id: conversationId,
          subject_kind: "client_contact",
          subject_client_contact_id: clientContactId,
          subject_source_external_identity_id: null
        }
      ],
      [{ id: linkId }],
      [{ id: linkId }],
      [{ id: linkId }],
      [{ id: transitionId }],
      [{ id: linkId }],
      [{ id: linkId }],
      [{ id: conversationId }]
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ link }))
    ).resolves.toMatchObject({ kind: "applied" });
    const inserts = executor.queries
      .map(renderQuery)
      .filter(({ sql }) =>
        normalizeSql(sql).startsWith(
          "insert into inbox_v2_conversation_client_link_evidence_references"
        )
      );
    expect(inserts.map(({ params }) => params.slice(3, 6))).toEqual([
      ["audit", 0, "client_contact"],
      ["audit", 1, "conversation_participant"]
    ]);
    executor.expectExhausted();
  });

  it("creates a confirmed claim-backed link only after every anchor fence", async () => {
    const executor = successfulClaimCreateExecutor();
    const repository =
      createSqlInboxV2ConversationClientLinkRepository(executor);

    await expect(
      repository.applyTransition(createInput({ link: claimBackedLink() }))
    ).resolves.toMatchObject({
      kind: "applied",
      transition: { resultingPrimaryLink: { id: linkId } }
    });

    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_conversation",
      "lock_head",
      "find_current_links",
      "find_links",
      "find_claim_anchors",
      "lock_source_identities",
      "lock_claim_heads",
      "lock_claims",
      "lock_employees",
      "lock_client_contacts",
      "lock_clients",
      "lock_claims",
      "lock_client_contacts",
      "lock_evidence_participants",
      "insert_link",
      "insert_evidence",
      "insert_evidence",
      "insert_transition",
      "insert_role",
      "insert_operation",
      "insert_head"
    ]);
    const insert = executor.queries.find(
      (query) =>
        statementKind(normalizeSql(renderQuery(query).sql)) === "insert_link"
    );
    expect(insert).toBeDefined();
    const renderedInsert = renderQuery(insert!);
    expect(normalizeSql(renderedInsert.sql)).toContain(
      "provenance_claim_id, provenance_claim_version, provenance_claim_target_client_contact_id, provenance_verification_service_id, provenance_verification_policy_id"
    );
    expect(renderedInsert.params).toEqual(
      expect.arrayContaining([
        claimId,
        "1",
        clientContactId,
        verificationServiceId,
        occurredAt
      ])
    );
    executor.expectExhausted();
  });

  it("locks exact active policy and persists trusted verification evidence", async () => {
    const decision = trustedServiceDecision();
    const link = trustedPolicyLink(decision);
    const executor = successfulTrustedPolicyCreateExecutor();

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ decision, link }))
    ).resolves.toMatchObject({ kind: "applied" });
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_conversation",
      "lock_head",
      "lock_policy",
      "find_current_links",
      "find_links",
      "lock_clients",
      "lock_client_contacts",
      "lock_evidence_participants",
      "insert_link",
      "insert_evidence",
      "insert_evidence",
      "insert_transition",
      "insert_role",
      "insert_operation",
      "insert_head"
    ]);
    executor.expectExhausted();
  });

  it("returns typed inactive-policy conflict before trusted link mutation", async () => {
    const decision = trustedServiceDecision();
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [],
      [
        trustedPolicyAuthorityRow({
          state: "revoked",
          revoked_by_employee_id: employeeId,
          revoked_at: occurredAt,
          revision: "2",
          updated_at: occurredAt
        })
      ]
    ]);
    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(
        createInput({ decision, link: trustedPolicyLink(decision) })
      )
    ).resolves.toEqual({ kind: "policy_inactive", currentHeadRevision: "2" });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("preserves the migration create path without an Employee fence", async () => {
    const decision = migrationDecision();
    const link = migrationLink(decision);
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [],
      [],
      [],
      [{ id: clientId }],
      [{ id: linkId }],
      [{ id: transitionId }],
      [{ id: linkId }],
      [{ id: linkId }],
      [{ id: conversationId }]
    ]);
    const input = {
      ...createInput({ decision, link }),
      resultingPrimaryLinkId: null
    };

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(input)
    ).resolves.toMatchObject({ kind: "applied" });
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_conversation",
      "lock_head",
      "find_current_links",
      "find_links",
      "lock_clients",
      "insert_link",
      "insert_transition",
      "insert_role",
      "insert_operation",
      "insert_head"
    ]);
    executor.expectExhausted();
  });

  it("returns a structured conflict without writes when the head revision changed", async () => {
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [{ revision: "2", primary_link_id: linkId }]
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput())
    ).resolves.toEqual({
      kind: "revision_conflict",
      currentRevision: "2",
      currentPrimaryLinkId: linkId
    });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("fails closed when the affected Client is absent", async () => {
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [],
      [],
      [],
      [activeEmployeeRow()],
      []
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput())
    ).resolves.toEqual({ kind: "client_not_found", clientId });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("prevents a second active episode for the same Conversation and Client", async () => {
    const existingId =
      "conversation_client_link:existing" as InboxV2ConversationClientLinkId;
    const row = activeLinkRow(existingId);
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [],
      [row],
      [row],
      [activeEmployeeRow()],
      [{ id: clientId }],
      [row]
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput())
    ).resolves.toEqual({ kind: "link_state_conflict", linkId: existingId });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("ends an active episode and advances an existing head by exact CAS", async () => {
    const row = activeLinkRow(linkId);
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [{ revision: "1", primary_link_id: linkId }],
      [row],
      [activeEmployeeRow()],
      [{ id: clientId }],
      [row],
      [{ id: linkId }],
      [{ id: transitionId }],
      [{ id: linkId }],
      [{ id: conversationId }]
    ]);

    const result =
      await createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(endInput());

    expect(result).toEqual({
      kind: "applied",
      transition: expect.objectContaining({
        expectedRevision: "1",
        currentRevision: "1",
        resultingRevision: "2",
        previousPrimaryLink: expect.objectContaining({ id: linkId }),
        resultingPrimaryLink: null
      })
    });
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_conversation",
      "lock_head",
      "find_links",
      "lock_employees",
      "lock_clients",
      "lock_links",
      "end_link",
      "insert_transition",
      "insert_operation",
      "update_head"
    ]);
    executor.expectExhausted();
  });

  it("ends a historical claim-backed episode without revalidating a revoked claim", async () => {
    const row = activeClaimLinkRow(linkId);
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [{ revision: "1", primary_link_id: linkId }],
      [row],
      [activeEmployeeRow()],
      [{ id: clientId }],
      [row],
      [{ id: linkId }],
      [{ id: transitionId }],
      [{ id: linkId }],
      [{ id: conversationId }]
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(endInput())
    ).resolves.toMatchObject({ kind: "applied" });
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_conversation",
      "lock_head",
      "find_links",
      "lock_employees",
      "lock_clients",
      "lock_links",
      "end_link",
      "insert_transition",
      "insert_operation",
      "update_head"
    ]);
    executor.expectExhausted();
  });

  it("reads and ends a persisted trusted-policy episode", async () => {
    const row = activeTrustedPolicyLinkRow(linkId);
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [{ revision: "1", primary_link_id: linkId }],
      [row],
      [activeEmployeeRow()],
      [{ id: clientId }],
      [row],
      [{ id: linkId }],
      [{ id: transitionId }],
      [{ id: linkId }],
      [{ id: conversationId }]
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(endInput())
    ).resolves.toMatchObject({ kind: "applied" });
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_conversation",
      "lock_head",
      "find_links",
      "lock_employees",
      "lock_clients",
      "lock_links",
      "end_link",
      "insert_transition",
      "insert_operation",
      "update_head"
    ]);
    executor.expectExhausted();
  });

  it("ends before create so an exact same-Client relink is atomic", async () => {
    const replacementId = secondLinkId;
    const row = activeLinkRow(linkId);
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [{ revision: "1", primary_link_id: linkId }],
      [row],
      [row],
      [activeEmployeeRow()],
      [{ id: clientId }],
      [row],
      [{ id: linkId }],
      [{ id: replacementId }],
      [{ id: transitionId }],
      [{ id: replacementId }],
      [{ id: linkId }],
      [{ id: replacementId }],
      [{ id: conversationId }]
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(relinkInput(replacementId))
    ).resolves.toMatchObject({
      kind: "applied",
      transition: {
        resultingRevision: "2",
        resultingPrimaryLink: { id: replacementId }
      }
    });
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_conversation",
      "lock_head",
      "find_current_links",
      "find_links",
      "lock_employees",
      "lock_clients",
      "lock_links",
      "end_link",
      "insert_link",
      "insert_transition",
      "insert_role",
      "insert_operation",
      "insert_operation",
      "update_head"
    ]);
    executor.expectExhausted();
  });

  it("does not allow a tentative link to become primary", async () => {
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [],
      [],
      [],
      [activeEmployeeRow()],
      [{ id: clientId }]
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(
        createInput({
          link: activeLink({ associationConfidence: "tentative" })
        })
      )
    ).resolves.toEqual({ kind: "link_state_conflict", linkId });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("rejects tentative automatic provenance before opening a transaction", async () => {
    const tentativeClaim = claimBackedLink({
      associationConfidence: "tentative"
    });
    const executor = new ScriptedClientLinkExecutor([]);
    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ link: tentativeClaim }))
    ).rejects.toMatchObject({ code: "validation.failed" });
    expect(executor.transactionCount).toBe(0);
  });

  it.each([
    ["missing", [], "actor_not_found"],
    [
      "deactivated",
      [
        {
          id: employeeId,
          created_at: claimCreatedAt,
          deactivated_at: occurredAt
        }
      ],
      "actor_inactive"
    ],
    [
      "not-yet-created",
      [
        {
          id: employeeId,
          created_at: endedAt,
          deactivated_at: null
        }
      ],
      "actor_inactive"
    ]
  ] as const)(
    "returns typed %s Employee actor outcome before Client locks",
    async (_label, employeeRows, expectedKind) => {
      const executor = new ScriptedClientLinkExecutor([
        [{ id: conversationId }],
        [],
        [],
        [],
        employeeRows
      ]);

      await expect(
        createSqlInboxV2ConversationClientLinkRepository(
          executor
        ).applyTransition(createInput())
      ).resolves.toEqual({ kind: expectedKind, employeeId });
      expect(writeStatements(executor)).toEqual([]);
      executor.expectExhausted();
    }
  );

  it("returns claim_not_found when the claim pre-read cannot anchor an identity", async () => {
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [],
      [],
      [],
      []
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ link: claimBackedLink() }))
    ).resolves.toEqual({ kind: "claim_not_found", claimId });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("keeps exact temporal claim evidence valid after head advance and at its revocation boundary", async () => {
    const executor = successfulClaimCreateExecutor({
      head: claimHeadRow({
        resolution_status: "unresolved",
        active_claim_id: null,
        latest_claim_version: "2"
      }),
      claim: claimRow({ status: "revoked", revoked_at: occurredAt })
    });

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ link: claimBackedLink() }))
    ).resolves.toMatchObject({ kind: "applied" });
    executor.expectExhausted();
  });

  it("returns claim_time_conflict when revocation predates the link", async () => {
    const executor = new ScriptedClientLinkExecutor(
      sourceClaimReadSteps({
        claim: claimRow({ status: "revoked", revoked_at: claimCreatedAt })
      })
    );
    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ link: claimBackedLink() }))
    ).resolves.toEqual({ kind: "claim_time_conflict", claimId });
    executor.expectExhausted();
  });

  it("returns claim_target_conflict for a non-ClientContact claim target", async () => {
    const executor = new ScriptedClientLinkExecutor(
      sourceClaimReadSteps({
        claim: claimRow({
          target_kind: "employee",
          target_employee_id: employeeId,
          target_client_contact_id: null
        })
      })
    );

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ link: claimBackedLink() }))
    ).resolves.toEqual({ kind: "claim_target_conflict", claimId });
    executor.expectExhausted();
  });

  it("returns claim_target_conflict when the locked contact belongs to another Client", async () => {
    const executor = new ScriptedClientLinkExecutor([
      ...sourceClaimReadSteps(),
      [activeEmployeeRow()],
      [{ id: clientContactId, client_id: secondClientId }]
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ link: claimBackedLink() }))
    ).resolves.toEqual({ kind: "claim_target_conflict", claimId });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("returns claim_time_conflict for claim evidence created after verification", async () => {
    const executor = new ScriptedClientLinkExecutor(
      sourceClaimReadSteps({
        claim: claimRow({ created_at: "2026-07-14 08:30:00+00" })
      })
    );

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ link: claimBackedLink() }))
    ).resolves.toEqual({ kind: "claim_time_conflict", claimId });
    executor.expectExhausted();
  });

  it("canonicalizes PostgreSQL timestamptz strings and rejects malformed claim time", async () => {
    const postgresTimestampExecutor = successfulClaimCreateExecutor({
      claim: claimRow({ created_at: "2026-07-14 07:00:00+00" })
    });
    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        postgresTimestampExecutor
      ).applyTransition(createInput({ link: claimBackedLink() }))
    ).resolves.toMatchObject({ kind: "applied" });
    postgresTimestampExecutor.expectExhausted();

    const malformedExecutor = new ScriptedClientLinkExecutor(
      sourceClaimReadSteps({ claim: claimRow({ created_at: "not-a-date" }) })
    );
    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        malformedExecutor
      ).applyTransition(createInput({ link: claimBackedLink() }))
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
    expect(writeStatements(malformedExecutor)).toEqual([]);
    malformedExecutor.expectExhausted();
  });

  it("returns typed missing verification evidence for an absent participant", async () => {
    const executor = new ScriptedClientLinkExecutor([
      ...sourceClaimReadSteps(),
      [activeEmployeeRow()],
      [{ id: clientContactId, client_id: clientId }],
      [{ id: clientId }],
      [evidenceClaimRow()],
      [{ id: clientContactId, client_id: clientId }],
      []
    ]);

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput({ link: claimBackedLink() }))
    ).resolves.toEqual({
      kind: "evidence_not_found",
      linkId,
      purpose: "verification",
      ordinal: 1
    });
    expect(writeStatements(executor)).toEqual([]);
    executor.expectExhausted();
  });

  it("maps a named transition 23505 to transition_id_conflict after rollback", async () => {
    const error = {
      code: "23505",
      cause: {
        code: "23505",
        constraint: "inbox_v2_conversation_client_link_transitions_pk"
      }
    };
    const executor = successfulCreateExecutor({
      stopBeforeTransition: true
    }).failOnStatement(
      "insert into inbox_v2_conversation_client_link_transitions",
      error
    );

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(createInput())
    ).resolves.toEqual({ kind: "transition_id_conflict", transitionId });
    expect(executor.rollbackCount).toBe(1);
    expect(executor.commitCount).toBe(0);
    executor.expectExhausted();
  });

  it("maps a link PK race to the exact conflicting created ID after rollback", async () => {
    const decision = manualDecision();
    const first = activeLink({ linkedBy: decision });
    const second = activeLink({
      id: secondLinkId,
      client: { tenantId, kind: "client", id: secondClientId as never },
      linkedBy: decision
    });
    const input: ApplyInboxV2ConversationClientLinkTransitionInput = {
      tenantId,
      conversationId,
      transitionId,
      expectedRevision: null,
      decision,
      operations: [
        { kind: "create_link", link: first },
        { kind: "create_link", link: second }
      ],
      resultingPrimaryLinkId: first.id,
      occurredAt
    };
    const executor = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [],
      [],
      [],
      [activeEmployeeRow()],
      [{ id: clientId }, { id: secondClientId }],
      [{ id: linkId }],
      [{ id: secondLinkId }]
    ]).failOnStatement(
      "insert into inbox_v2_conversation_client_links (",
      {
        code: "23505",
        constraint: "inbox_v2_conversation_client_links_pk"
      },
      2
    );

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        executor
      ).applyTransition(input)
    ).resolves.toEqual({ kind: "link_id_conflict", linkId: secondLinkId });
    expect(executor.rollbackCount).toBe(1);
    expect(executor.normalizedStatements().map(statementKind)).toEqual([
      "lock_conversation",
      "lock_head",
      "find_current_links",
      "find_links",
      "lock_employees",
      "lock_clients",
      "insert_link",
      "insert_link",
      "find_conflicting_links"
    ]);
    executor.expectExhausted();
  });

  it("fails closed on lossy revisions and malformed typed Client IDs", async () => {
    const lossyHead = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [{ revision: 1, primary_link_id: null }]
    ]);
    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        lossyHead
      ).applyTransition(createInput())
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
    expect(writeStatements(lossyHead)).toEqual([]);

    const malformedClientId = new ScriptedClientLinkExecutor([
      [{ id: conversationId }],
      [],
      [],
      [
        {
          ...activeLinkRow(linkId),
          client_id: "employee:not-a-client"
        }
      ]
    ]);
    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        malformedClientId
      ).applyTransition(createInput())
    ).rejects.toBeDefined();
    expect(writeStatements(malformedClientId)).toEqual([]);
  });

  it("retries only PostgreSQL deadlock and serialization SQLSTATEs", async () => {
    const retryExecutor = successfulCreateExecutor().failNextTransactions(
      { cause: { cause: { code: "40P01" } } },
      { code: "40001" }
    );

    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        retryExecutor
      ).applyTransition(createInput())
    ).resolves.toMatchObject({ kind: "applied" });
    expect(retryExecutor.transactionCount).toBe(3);
    expect(retryExecutor.rollbackCount).toBe(2);
    expect(retryExecutor.commitCount).toBe(1);
    expect(retryExecutor.transactionIsolationLevels).toEqual([
      "read committed",
      "read committed",
      "read committed"
    ]);

    const nonRetryable = new ScriptedClientLinkExecutor(
      []
    ).failNextTransactions({ code: "23505" });
    await expect(
      createSqlInboxV2ConversationClientLinkRepository(
        nonRetryable
      ).applyTransition(createInput())
    ).rejects.toMatchObject({ code: "23505" });
    expect(nonRetryable.transactionCount).toBe(1);

    const cyclicError: { cause?: unknown } = {};
    cyclicError.cause = cyclicError;
    const cyclic = new ScriptedClientLinkExecutor([]).failNextTransactions(
      cyclicError
    );
    await expect(
      createSqlInboxV2ConversationClientLinkRepository(cyclic).applyTransition(
        createInput()
      )
    ).rejects.toBe(cyclicError);
    expect(cyclic.transactionCount).toBe(1);
  });
});

class ScriptedClientLinkExecutor implements InboxV2ConversationClientLinkTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly transactionIsolationLevels: string[] = [];
  private readonly transactionFailures: unknown[] = [];
  private readonly statementFailures: Array<{
    fragment: string;
    error: unknown;
    remaining: number;
  }> = [];
  transactionCount = 0;
  commitCount = 0;
  rollbackCount = 0;

  constructor(
    private readonly steps: Array<readonly Record<string, unknown>[]>
  ) {}

  failNextTransactions(...errors: unknown[]): this {
    this.transactionFailures.push(...errors);
    return this;
  }

  failOnStatement(fragment: string, error: unknown, occurrence = 1): this {
    this.statementFailures.push({
      fragment: normalizeSql(fragment),
      error,
      remaining: occurrence
    });
    return this;
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const statement = normalizeSql(renderQuery(query).sql);
    const failureIndex = this.statementFailures.findIndex((failure) =>
      statement.includes(failure.fragment)
    );
    if (failureIndex !== -1) {
      const failure = this.statementFailures[failureIndex]!;
      failure.remaining -= 1;
      if (failure.remaining === 0) {
        this.statementFailures.splice(failureIndex, 1);
        throw failure.error;
      }
    }
    const rows = this.steps.shift();
    if (rows === undefined) {
      throw new Error(
        `Scripted executor has no response for: ${renderQuery(query).sql}`
      );
    }
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (
      transaction: InboxV2TenantPolicyAuthorityUseTransaction
    ) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionCount += 1;
    this.transactionIsolationLevels.push(config.isolationLevel);
    if (this.transactionFailures.length > 0) {
      this.rollbackCount += 1;
      throw this.transactionFailures.shift();
    }
    try {
      const result = await work(
        this as unknown as InboxV2TenantPolicyAuthorityUseTransaction
      );
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.rollbackCount += 1;
      throw error;
    }
  }

  normalizedStatements(): string[] {
    return this.queries.map((query) => normalizeSql(renderQuery(query).sql));
  }

  expectExhausted(): void {
    expect(this.steps).toHaveLength(0);
    expect(this.statementFailures).toHaveLength(0);
  }
}

function createInput(
  overrides: Readonly<{
    link?: InboxV2ConversationClientLink;
    decision?: InboxV2ConversationClientLinkDecision;
  }> = {}
): ApplyInboxV2ConversationClientLinkTransitionInput {
  const decision = overrides.decision ?? manualDecision();
  const link = overrides.link ?? activeLink({ linkedBy: decision });
  return {
    tenantId,
    conversationId,
    transitionId,
    expectedRevision: null,
    decision,
    operations: [{ kind: "create_link", link }],
    resultingPrimaryLinkId: link.id,
    occurredAt
  };
}

function endInput(): ApplyInboxV2ConversationClientLinkTransitionInput {
  return {
    tenantId,
    conversationId,
    transitionId,
    expectedRevision: "1" as InboxV2EntityRevision,
    decision: manualDecision(),
    operations: [{ kind: "end_link", linkId }],
    resultingPrimaryLinkId: null,
    occurredAt: endedAt
  };
}

function relinkInput(
  replacementId: InboxV2ConversationClientLinkId
): ApplyInboxV2ConversationClientLinkTransitionInput {
  const decision = manualDecision();
  const replacement = activeLink({
    id: replacementId,
    linkedBy: decision,
    validFrom: endedAt
  });
  return {
    tenantId,
    conversationId,
    transitionId,
    expectedRevision: "1" as InboxV2EntityRevision,
    decision,
    operations: [
      { kind: "end_link", linkId },
      { kind: "create_link", link: replacement }
    ],
    resultingPrimaryLinkId: replacementId,
    occurredAt: endedAt
  };
}

function activeLink(
  overrides: Partial<InboxV2ConversationClientLink> = {}
): InboxV2ConversationClientLink {
  return {
    tenantId,
    id: linkId,
    conversation: { tenantId, kind: "conversation", id: conversationId },
    client: { tenantId, kind: "client", id: clientId as never },
    roleIds: ["core:subject" as never],
    associationConfidence: "confirmed",
    provenance: { kind: "manual" },
    auditEvidenceReferences: [],
    linkedBy: manualDecision(),
    validFrom: occurredAt,
    validFromBasis: "known_effective",
    state: "active",
    termination: null,
    revision: "1" as InboxV2EntityRevision,
    ...overrides
  };
}

function claimBackedLink(
  overrides: Partial<InboxV2ConversationClientLink> = {}
): InboxV2ConversationClientLink {
  const decision = manualDecision();
  return activeLink({
    associationConfidence: "confirmed",
    provenance: {
      kind: "source_identity_claim",
      claim: { tenantId, kind: "source_identity_claim", id: claimId },
      verification: claimVerification()
    },
    auditEvidenceReferences: [],
    linkedBy: decision,
    ...overrides
  });
}

function manualLinkWithAuditEvidence(): InboxV2ConversationClientLink {
  return activeLink({
    auditEvidenceReferences: [
      {
        kind: "client_contact",
        reference: {
          tenantId,
          kind: "client_contact",
          id: clientContactId
        }
      },
      {
        kind: "conversation_participant",
        reference: {
          tenantId,
          kind: "conversation_participant",
          id: participantId as never
        }
      }
    ]
  });
}

function trustedPolicyLink(
  decision: InboxV2ConversationClientLinkDecision
): InboxV2ConversationClientLink {
  if (decision.actor.kind !== "trusted_service") {
    throw new Error("trustedPolicyLink requires trusted-service decision");
  }
  return activeLink({
    linkedBy: decision,
    provenance: {
      kind: "trusted_policy",
      verification: {
        tenantId,
        conversation: { tenantId, kind: "conversation", id: conversationId },
        client: { tenantId, kind: "client", id: clientId as never },
        policyId: decision.policyId,
        policyVersion: decision.policyVersion,
        verifiedByTrustedServiceId: decision.actor.trustedServiceId,
        verifiedAt: occurredAt,
        policyAuthority: decision.policyAuthority,
        evidenceReferences: [
          {
            kind: "client_contact",
            reference: {
              tenantId,
              kind: "client_contact",
              id: clientContactId
            }
          },
          {
            kind: "conversation_participant",
            reference: {
              tenantId,
              kind: "conversation_participant",
              id: participantId as never
            }
          }
        ]
      }
    },
    auditEvidenceReferences: []
  });
}

function migrationLink(
  decision: InboxV2ConversationClientLinkDecision
): InboxV2ConversationClientLink {
  return activeLink({
    roleIds: ["core:legacy-unspecified" as never],
    provenance: {
      kind: "migration",
      provenanceId: "core:legacy-v1" as never,
      contractVersion: "v1" as never
    },
    linkedBy: decision,
    validFromBasis: "migration_observed"
  });
}

function claimVerification() {
  return {
    tenantId,
    conversation: {
      tenantId,
      kind: "conversation" as const,
      id: conversationId
    },
    client: { tenantId, kind: "client" as const, id: clientId as never },
    policyId: manualDecision().policyId,
    policyVersion: manualDecision().policyVersion,
    verifiedByTrustedServiceId: verificationServiceId as never,
    verifiedAt: occurredAt,
    policyAuthority: null,
    evidenceReferences: [
      {
        kind: "source_identity_claim" as const,
        reference: {
          tenantId,
          kind: "source_identity_claim" as const,
          id: claimId
        }
      },
      {
        kind: "conversation_participant" as const,
        reference: {
          tenantId,
          kind: "conversation_participant" as const,
          id: participantId as never
        }
      }
    ]
  };
}

function manualDecision(): InboxV2ConversationClientLinkDecision {
  return {
    actor: {
      kind: "employee",
      employee: { tenantId, kind: "employee", id: employeeId }
    },
    policyId: "core:manual-client-link" as never,
    policyVersion: "v1" as never,
    reasonCodeId: "core:operator-linked-client" as never,
    policyAuthority: null
  };
}

function trustedServiceDecision(): InboxV2ConversationClientLinkDecision {
  return {
    actor: {
      kind: "trusted_service",
      trustedServiceId: verificationServiceId as never
    },
    policyId: "core:verified-client-resolution" as never,
    policyVersion: "v1" as never,
    reasonCodeId: "core:verified-source-evidence" as never,
    policyAuthority: {
      family: "conversation_client_link",
      definitionContractVersion: "v1" as never,
      definitionDigestSha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      activationHeadRevision: "1" as InboxV2EntityRevision
    }
  };
}

function migrationDecision(): InboxV2ConversationClientLinkDecision {
  return {
    actor: {
      kind: "migration_service",
      trustedServiceId: "core:inbox-v1-migration" as never
    },
    policyId: "core:inbox-v1-client-link-import" as never,
    policyVersion: "v1" as never,
    reasonCodeId: "core:legacy-client-association" as never,
    policyAuthority: null
  };
}

function activeEmployeeRow(): Record<string, unknown> {
  return {
    id: employeeId,
    created_at: claimCreatedAt,
    deactivated_at: null
  };
}

function trustedPolicyAuthorityRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    family: "conversation_client_link",
    policy_id: "core:verified-client-resolution",
    policy_version: "v1",
    definition_contract_version: "v1",
    definition_digest_sha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    approved_trusted_service_id: verificationServiceId,
    state: "active",
    activated_by_employee_id: employeeId,
    activated_at: claimCreatedAt,
    revoked_by_employee_id: null,
    revoked_at: null,
    revision: "1",
    created_at: claimCreatedAt,
    updated_at: claimCreatedAt,
    version_approved_by_employee_id: employeeId,
    version_approved_at: claimCreatedAt,
    version_revision: "1",
    version_created_at: claimCreatedAt,
    version_updated_at: claimCreatedAt,
    ...overrides
  };
}

function activeLinkRow(
  id: InboxV2ConversationClientLinkId,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    client_id: clientId,
    state: "active",
    association_confidence: "confirmed",
    provenance_kind: "manual",
    provenance_claim_id: null,
    provenance_claim_version: null,
    provenance_claim_target_client_contact_id: null,
    provenance_verification_service_id: null,
    provenance_verification_policy_id: null,
    provenance_verification_policy_version: null,
    provenance_verification_policy_family: null,
    provenance_verification_definition_contract_version: null,
    provenance_verification_definition_digest_sha256: null,
    provenance_verification_activation_head_revision: null,
    provenance_verification_verified_at: null,
    provenance_migration_id: null,
    provenance_contract_version: null,
    linked_actor_kind: "employee",
    linked_actor_service_id: null,
    linked_policy_id: "core:manual-client-link",
    linked_policy_version: "v1",
    linked_policy_family: null,
    linked_policy_definition_contract_version: null,
    linked_policy_definition_digest_sha256: null,
    linked_policy_activation_head_revision: null,
    legacy_role_count: "0",
    ...overrides
  };
}

function activeClaimLinkRow(
  id: InboxV2ConversationClientLinkId
): Record<string, unknown> {
  return activeLinkRow(id, {
    provenance_kind: "source_identity_claim",
    provenance_claim_id: claimId,
    provenance_claim_version: "1",
    provenance_claim_target_client_contact_id: clientContactId,
    provenance_verification_service_id: verificationServiceId,
    provenance_verification_policy_id: "core:manual-client-link",
    provenance_verification_policy_version: "v1",
    provenance_verification_verified_at: occurredAt
  });
}

function activeTrustedPolicyLinkRow(
  id: InboxV2ConversationClientLinkId
): Record<string, unknown> {
  return activeLinkRow(id, {
    provenance_kind: "trusted_policy",
    provenance_verification_service_id: verificationServiceId,
    provenance_verification_policy_id: "core:verified-client-resolution",
    provenance_verification_policy_version: "v1",
    provenance_verification_policy_family: "conversation_client_link",
    provenance_verification_definition_contract_version: "v1",
    provenance_verification_definition_digest_sha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    provenance_verification_activation_head_revision: "1",
    provenance_verification_verified_at: occurredAt,
    linked_actor_kind: "trusted_service",
    linked_actor_service_id: verificationServiceId,
    linked_policy_id: "core:verified-client-resolution",
    linked_policy_version: "v1",
    linked_policy_family: "conversation_client_link",
    linked_policy_definition_contract_version: "v1",
    linked_policy_definition_digest_sha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    linked_policy_activation_head_revision: "1"
  });
}

function claimHeadRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    source_external_identity_id: sourceExternalIdentityId,
    resolution_status: "claimed",
    active_claim_id: claimId,
    latest_claim_version: "1",
    ...overrides
  };
}

function claimRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: claimId,
    source_external_identity_id: sourceExternalIdentityId,
    claim_version: "1",
    target_kind: "client_contact",
    target_employee_id: null,
    target_client_contact_id: clientContactId,
    status: "active",
    created_at: claimCreatedAt,
    revoked_at: null,
    participant_exists: true,
    ...overrides
  };
}

function evidenceClaimRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const claim = claimRow(overrides);
  return {
    ...claim,
    head_resolution_status: "claimed",
    head_active_claim_id: claimId,
    head_latest_claim_version: "1"
  };
}

function sourceClaimReadSteps(
  overrides: Readonly<{
    head?: Record<string, unknown>;
    claim?: Record<string, unknown>;
  }> = {}
): Array<readonly Record<string, unknown>[]> {
  return [
    [{ id: conversationId }],
    [],
    [],
    [],
    [{ id: claimId, source_external_identity_id: sourceExternalIdentityId }],
    [{ id: sourceExternalIdentityId }],
    [overrides.head ?? claimHeadRow()],
    [overrides.claim ?? claimRow()]
  ];
}

function successfulCreateExecutor(
  options: Readonly<{ stopBeforeTransition?: boolean }> = {}
): ScriptedClientLinkExecutor {
  const steps: Array<readonly Record<string, unknown>[]> = [
    [{ id: conversationId }],
    [],
    [],
    [],
    [activeEmployeeRow()],
    [{ id: clientId }],
    [{ id: linkId }]
  ];
  if (!options.stopBeforeTransition) {
    steps.push(
      [{ id: transitionId }],
      [{ id: linkId }],
      [{ id: linkId }],
      [{ id: conversationId }]
    );
  }
  return new ScriptedClientLinkExecutor(steps);
}

function successfulClaimCreateExecutor(
  overrides: Readonly<{
    head?: Record<string, unknown>;
    claim?: Record<string, unknown>;
  }> = {}
): ScriptedClientLinkExecutor {
  return new ScriptedClientLinkExecutor([
    ...sourceClaimReadSteps({ head: overrides.head, claim: overrides.claim }),
    [activeEmployeeRow()],
    [{ id: clientContactId, client_id: clientId }],
    [{ id: clientId }],
    [evidenceClaimRow(overrides.claim)],
    [{ id: clientContactId, client_id: clientId }],
    [
      {
        id: participantId,
        conversation_id: conversationId,
        subject_kind: "source_external_identity",
        subject_client_contact_id: null,
        subject_source_external_identity_id: sourceExternalIdentityId
      }
    ],
    [{ id: linkId }],
    [{ id: linkId }],
    [{ id: linkId }],
    [{ id: transitionId }],
    [{ id: linkId }],
    [{ id: linkId }],
    [{ id: conversationId }]
  ]);
}

function successfulTrustedPolicyCreateExecutor(): ScriptedClientLinkExecutor {
  return new ScriptedClientLinkExecutor([
    [{ id: conversationId }],
    [],
    [trustedPolicyAuthorityRow()],
    [],
    [],
    [{ id: clientId }],
    [{ id: clientContactId, client_id: clientId }],
    [
      {
        id: participantId,
        conversation_id: conversationId,
        subject_kind: "client_contact",
        subject_client_contact_id: clientContactId,
        subject_source_external_identity_id: null
      }
    ],
    [{ id: linkId }],
    [{ id: linkId }],
    [{ id: linkId }],
    [{ id: transitionId }],
    [{ id: linkId }],
    [{ id: linkId }],
    [{ id: conversationId }]
  ]);
}

function writeStatements(executor: ScriptedClientLinkExecutor): string[] {
  return executor
    .normalizedStatements()
    .filter(
      (statement) =>
        statement.startsWith("insert ") || statement.startsWith("update ")
    );
}

function statementKind(statement: string): string {
  if (statement.includes("from inbox_v2_conversations conversation_row")) {
    return "lock_conversation";
  }
  if (statement.includes("from inbox_v2_conversation_client_link_heads")) {
    return "lock_head";
  }
  if (
    statement.includes("from inbox_v2_tenant_policy_activation_heads head_row")
  ) {
    return "lock_policy";
  }
  if (statement.includes("from inbox_v2_source_external_identities")) {
    return "lock_source_identities";
  }
  if (statement.includes("from inbox_v2_source_identity_claim_heads")) {
    return "lock_claim_heads";
  }
  if (statement.includes("from inbox_v2_source_identity_claims claim_row")) {
    return statement.includes("for share of claim_row")
      ? "lock_claims"
      : "find_claim_anchors";
  }
  if (statement.includes("from employees employee_row")) {
    return "lock_employees";
  }
  if (statement.includes("from client_contacts contact_row")) {
    return "lock_client_contacts";
  }
  if (
    statement.includes(
      "from inbox_v2_conversation_participants participant_row"
    )
  ) {
    return "lock_evidence_participants";
  }
  if (
    statement.startsWith(
      "insert into inbox_v2_conversation_client_link_evidence_references"
    )
  ) {
    return "insert_evidence";
  }
  if (
    statement.includes("from inbox_v2_conversation_client_links link_row") &&
    !statement.includes("link_row.conversation_id =")
  ) {
    return "find_conflicting_links";
  }
  if (
    statement.includes("from inbox_v2_conversation_client_links link_row") &&
    statement.includes("link_row.client_id in")
  ) {
    return "find_current_links";
  }
  if (
    statement.includes("from inbox_v2_conversation_client_links link_row") &&
    statement.includes("for update of link_row")
  ) {
    return "lock_links";
  }
  if (statement.includes("from inbox_v2_conversation_client_links link_row")) {
    return "find_links";
  }
  if (statement.includes("from clients client_row")) return "lock_clients";
  if (statement.startsWith("insert into inbox_v2_conversation_client_links")) {
    return "insert_link";
  }
  if (
    statement.startsWith(
      "insert into inbox_v2_conversation_client_link_transitions"
    )
  ) {
    return "insert_transition";
  }
  if (
    statement.startsWith("insert into inbox_v2_conversation_client_link_roles")
  ) {
    return "insert_role";
  }
  if (
    statement.startsWith(
      "insert into inbox_v2_conversation_client_link_transition_operations"
    )
  ) {
    return "insert_operation";
  }
  if (statement.startsWith("update inbox_v2_conversation_client_links")) {
    return "end_link";
  }
  if (
    statement.startsWith("insert into inbox_v2_conversation_client_link_heads")
  ) {
    return "insert_head";
  }
  if (statement.startsWith("update inbox_v2_conversation_client_link_heads")) {
    return "update_head";
  }
  return "unknown";
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
