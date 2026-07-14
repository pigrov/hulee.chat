import type {
  InboxV2ClientContactId,
  InboxV2EmployeeId,
  InboxV2SourceExternalIdentityId,
  InboxV2SourceIdentityClaim,
  InboxV2SourceIdentityClaimId,
  InboxV2SourceIdentityClaimTransition,
  InboxV2SourceIdentityClaimTransitionId,
  InboxV2TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildAdvanceInboxV2SourceExternalIdentityRevisionSql,
  buildAdvanceInboxV2SourceIdentityClaimHeadSql,
  buildFindInboxV2SourceIdentityClaimByIdSql,
  buildInsertInboxV2SourceIdentityClaimEvidenceSql,
  buildInsertInboxV2SourceIdentityClaimSql,
  buildInsertInboxV2SourceIdentityClaimTransitionSql,
  buildListInboxV2SourceIdentityClaimHistorySql,
  buildLockCurrentInboxV2SourceIdentityClaimSql,
  buildLockInboxV2SourceIdentityClaimClientContactsSql,
  buildLockInboxV2SourceIdentityClaimEmployeesSql,
  buildLockInboxV2SourceIdentityClaimHeadSql,
  buildLockInboxV2SourceIdentityClaimIdentitySql,
  buildLockInboxV2SourceIdentityClaimNormalizedEvidenceSql,
  buildLockInboxV2SourceIdentityClaimOccurrenceEvidenceSql,
  buildLockInboxV2SourceIdentityClaimRawEvidenceSql,
  buildLockInboxV2SourceIdentityClaimRosterEvidenceSql,
  buildLockInboxV2SourceIdentityClaimRosterMembersSql,
  buildRevokeInboxV2SourceIdentityClaimSql,
  createSqlInboxV2SourceIdentityClaimRepository,
  type ApplyInboxV2SourceIdentityClaimTransitionInput,
  type InboxV2SourceIdentityClaimTransactionExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-source-identity-claim-repository";
import type { InboxV2TenantPolicyAuthorityUseTransaction } from "./sql-inbox-v2-tenant-policy-authority-repository";

const tenantId = "tenant:claim-unit" as InboxV2TenantId;
const sourceExternalIdentityId =
  "source_external_identity:sender-1" as InboxV2SourceExternalIdentityId;
const actorEmployeeId = "employee:operator-1" as InboxV2EmployeeId;
const targetEmployeeId = "employee:employee-1" as InboxV2EmployeeId;
const clientContactId = "client_contact:contact-1" as InboxV2ClientContactId;
const claimId = "source_identity_claim:claim-1" as InboxV2SourceIdentityClaimId;
const secondClaimId =
  "source_identity_claim:claim-2" as InboxV2SourceIdentityClaimId;
const transitionId =
  "source_identity_claim_transition:transition-1" as InboxV2SourceIdentityClaimTransitionId;
const secondTransitionId =
  "source_identity_claim_transition:transition-2" as InboxV2SourceIdentityClaimTransitionId;
const revokeTransitionId =
  "source_identity_claim_transition:transition-3" as InboxV2SourceIdentityClaimTransitionId;
const rawEventId = "raw_inbound_event:event-1";
const normalizedEventId = "normalized_inbound_event:event-1";
const sourceOccurrenceId = "source_occurrence:occurrence-1";
const providerRosterEvidenceId = "provider_roster_evidence:evidence-1";
const policyDigest = "a".repeat(64);
const occurredAt = "2026-07-14T09:00:00.000Z";
const reassignedAt = "2026-07-14T09:05:00.000Z";
const revokedAt = "2026-07-14T09:10:00.000Z";

describe("SQL Inbox V2 source identity claim repository", () => {
  it("builds tenant-bound locks, exact writes and bounded keyset history SQL", () => {
    const claim = canonicalClaim();
    const transition = canonicalTransition();
    const identityLock = renderQuery(
      buildLockInboxV2SourceIdentityClaimIdentitySql({
        tenantId,
        sourceExternalIdentityId
      })
    );
    const headLock = renderQuery(
      buildLockInboxV2SourceIdentityClaimHeadSql({
        tenantId,
        sourceExternalIdentityId
      })
    );
    const currentLock = renderQuery(
      buildLockCurrentInboxV2SourceIdentityClaimSql({
        tenantId,
        sourceExternalIdentityId,
        claimId
      })
    );
    const employeeLock = renderQuery(
      buildLockInboxV2SourceIdentityClaimEmployeesSql({
        tenantId,
        employeeIds: [targetEmployeeId, actorEmployeeId]
      })
    );
    const contactLock = renderQuery(
      buildLockInboxV2SourceIdentityClaimClientContactsSql({
        tenantId,
        clientContactIds: [clientContactId]
      })
    );
    const rawLock = renderQuery(
      buildLockInboxV2SourceIdentityClaimRawEvidenceSql({
        tenantId,
        eventIds: [rawEventId]
      })
    );
    const normalizedLock = renderQuery(
      buildLockInboxV2SourceIdentityClaimNormalizedEvidenceSql({
        tenantId,
        eventIds: [normalizedEventId]
      })
    );
    const occurrenceLock = renderQuery(
      buildLockInboxV2SourceIdentityClaimOccurrenceEvidenceSql({
        tenantId,
        occurrenceIds: [sourceOccurrenceId]
      })
    );
    const rosterLock = renderQuery(
      buildLockInboxV2SourceIdentityClaimRosterEvidenceSql({
        tenantId,
        rosterEvidenceIds: [providerRosterEvidenceId]
      })
    );
    const rosterMemberLock = renderQuery(
      buildLockInboxV2SourceIdentityClaimRosterMembersSql({
        tenantId,
        sourceExternalIdentityId,
        rosterEvidenceIds: [providerRosterEvidenceId]
      })
    );
    const insertClaim = renderQuery(
      buildInsertInboxV2SourceIdentityClaimSql(claim)
    );
    const insertEvidence = renderQuery(
      buildInsertInboxV2SourceIdentityClaimEvidenceSql({
        claim,
        evidence: claim.evidenceReferences[0] as never,
        ordinal: 0
      })
    );
    const revoke = renderQuery(
      buildRevokeInboxV2SourceIdentityClaimSql({
        tenantId,
        sourceExternalIdentityId,
        claimId,
        revokedAt
      })
    );
    const insertTransition = renderQuery(
      buildInsertInboxV2SourceIdentityClaimTransitionSql(transition)
    );
    const advanceIdentity = renderQuery(
      buildAdvanceInboxV2SourceExternalIdentityRevisionSql({
        tenantId,
        sourceExternalIdentityId,
        expectedRevision: "1" as never,
        resultingRevision: "2" as never,
        updatedAt: occurredAt
      })
    );
    const advanceHead = renderQuery(
      buildAdvanceInboxV2SourceIdentityClaimHeadSql({
        tenantId,
        sourceExternalIdentityId,
        expectedVersion: null,
        resultingVersion: "1" as never,
        resolutionStatus: "claimed",
        activeClaimId: claimId
      })
    );
    const find = renderQuery(
      buildFindInboxV2SourceIdentityClaimByIdSql({ tenantId, claimId })
    );
    const history = renderQuery(
      buildListInboxV2SourceIdentityClaimHistorySql({
        tenantId,
        sourceExternalIdentityId,
        afterVersion: "1" as never,
        limit: 25
      })
    );

    for (const query of [identityLock, headLock, currentLock]) {
      expect(normalizeSql(query.sql)).toContain("tenant_id = $1");
      expect(normalizeSql(query.sql)).toContain("for update");
      expect(query.params).toContain(tenantId);
    }
    expect(normalizeSql(employeeLock.sql)).toContain(
      'order by employee_row.id collate "c"'
    );
    expect(normalizeSql(employeeLock.sql)).toContain("for no key update");
    expect(normalizeSql(contactLock.sql)).toContain("for no key update");
    expect(normalizeSql(rawLock.sql)).toContain("for key share");
    expect(normalizeSql(normalizedLock.sql)).toContain("for key share");
    for (const query of [occurrenceLock, rosterLock, rosterMemberLock]) {
      expect(normalizeSql(query.sql)).toContain("order by");
      expect(normalizeSql(query.sql)).toContain('collate "c"');
      expect(normalizeSql(query.sql)).toContain("for key share");
      expect(query.params).toContain(tenantId);
    }
    for (const query of [
      insertClaim,
      insertEvidence,
      revoke,
      insertTransition,
      advanceIdentity,
      advanceHead
    ]) {
      expect(query.params).toContain(tenantId);
      expect(normalizeSql(query.sql)).toContain("returning");
    }
    expect(normalizeSql(advanceHead.sql)).toContain(
      "latest_claim_version is not distinct from"
    );
    expect(normalizeSql(find.sql)).toContain(
      "evidence_row.tenant_id = claim_row.tenant_id"
    );
    expect(normalizeSql(history.sql)).toContain(
      "with claim_page as materialized"
    );
    expect(normalizeSql(history.sql)).toContain("claim_row.claim_version > $3");
    expect(normalizeSql(history.sql)).toContain("limit $4");
    expect(history.params).toEqual([
      tenantId,
      sourceExternalIdentityId,
      "1",
      25
    ]);
  });

  it("constructs and persists an initial Employee claim in canonical order", async () => {
    const executor = seededExecutor();
    const repository = createSqlInboxV2SourceIdentityClaimRepository(executor);

    const result = await repository.applyTransition(employeeClaimInput());

    expect(result).toMatchObject({
      kind: "applied",
      transition: {
        id: transitionId,
        operation: {
          kind: "claim_employee",
          target: {
            kind: "employee",
            employee: { tenantId, id: targetEmployeeId }
          },
          previousClaim: null,
          resultingClaim: { tenantId, id: claimId }
        },
        expectedVersion: null,
        currentVersion: null,
        resultingVersion: "1",
        occurredAt
      }
    });
    expect(executor.getIdentity()).toMatchObject({ revision: "2" });
    expect(executor.getHead()).toEqual({
      resolutionStatus: "claimed",
      activeClaimId: claimId,
      latestClaimVersion: "1"
    });
    expect(executor.getClaim(claimId)).toMatchObject({
      previousClaimVersion: null,
      claimVersion: "1",
      targetKind: "employee",
      targetEmployeeId,
      targetClientContactId: null,
      status: "active",
      revision: "1",
      evidence: [
        {
          ordinal: 0,
          kind: "raw_inbound_event",
          rawInboundEventId: rawEventId,
          normalizedInboundEventId: null
        }
      ]
    });
    expect(executor.statementKinds()).toEqual([
      "lock_identity",
      "lock_head",
      "lookup_transition_id",
      "lookup_claim_id",
      "lock_employees",
      "lock_raw_evidence",
      "insert_claim",
      "insert_evidence",
      "insert_transition",
      "advance_identity",
      "advance_head"
    ]);
    expect(executor.transactionIsolationLevels).toEqual(["read committed"]);
    expect(executor.commitCount).toBe(1);
  });

  it("reassigns to ClientContact and revokes using one monotonic claim clock", async () => {
    const executor = seededExecutor();
    const repository = createSqlInboxV2SourceIdentityClaimRepository(executor);
    await repository.applyTransition(employeeClaimInput());
    executor.clearQueries();

    const reassigned = await repository.applyTransition(clientClaimInput());

    expect(reassigned).toMatchObject({
      kind: "applied",
      transition: {
        id: secondTransitionId,
        operation: {
          kind: "claim_client_contact",
          target: {
            kind: "client_contact",
            clientContact: { tenantId, id: clientContactId }
          },
          previousClaim: {
            claim: { tenantId, id: claimId },
            target: {
              kind: "employee",
              employee: { tenantId, id: targetEmployeeId }
            }
          },
          resultingClaim: { tenantId, id: secondClaimId }
        },
        expectedVersion: "1",
        currentVersion: "1",
        resultingVersion: "2"
      }
    });
    expect(executor.getClaim(claimId)).toMatchObject({
      status: "revoked",
      revokedAt: reassignedAt,
      revision: "2"
    });
    expect(executor.getClaim(secondClaimId)).toMatchObject({
      previousClaimVersion: "1",
      claimVersion: "2",
      targetKind: "client_contact",
      targetEmployeeId: null,
      targetClientContactId: clientContactId,
      status: "active"
    });
    expect(executor.getHead()).toEqual({
      resolutionStatus: "claimed",
      activeClaimId: secondClaimId,
      latestClaimVersion: "2"
    });
    expect(executor.getIdentity()).toMatchObject({ revision: "3" });
    expect(executor.statementKinds()).toEqual([
      "lock_identity",
      "lock_head",
      "lock_current_claim",
      "lookup_transition_id",
      "lookup_claim_id",
      "lock_employees",
      "lock_contacts",
      "lock_normalized_evidence",
      "revoke_claim",
      "insert_claim",
      "insert_evidence",
      "insert_transition",
      "advance_identity",
      "advance_head"
    ]);

    executor.clearQueries();
    const revoked = await repository.applyTransition(revokeInput());

    expect(revoked).toMatchObject({
      kind: "applied",
      transition: {
        id: revokeTransitionId,
        operation: {
          kind: "revoke",
          activeClaim: { tenantId, id: secondClaimId },
          target: {
            kind: "client_contact",
            clientContact: { tenantId, id: clientContactId }
          }
        },
        expectedVersion: "2",
        currentVersion: "2",
        resultingVersion: "3",
        occurredAt: revokedAt
      }
    });
    expect(executor.getClaim(secondClaimId)).toMatchObject({
      status: "revoked",
      revokedAt,
      revision: "2"
    });
    expect(executor.getHead()).toEqual({
      resolutionStatus: "unresolved",
      activeClaimId: null,
      latestClaimVersion: "3"
    });
    expect(executor.getIdentity()).toMatchObject({ revision: "4" });
    expect(executor.statementKinds()).toEqual([
      "lock_identity",
      "lock_head",
      "lock_current_claim",
      "lookup_transition_id",
      "lock_contacts",
      "revoke_claim",
      "insert_transition",
      "advance_identity",
      "advance_head"
    ]);
  });

  it("returns version conflict without partial writes and rolls back failed write bundles", async () => {
    const conflictExecutor = seededExecutor();
    const beforeConflict = conflictExecutor.stateSnapshot();
    const conflict = await createSqlInboxV2SourceIdentityClaimRepository(
      conflictExecutor
    ).applyTransition(employeeClaimInput({ expectedVersion: "1" as never }));

    expect(conflict).toEqual({
      kind: "version_conflict",
      currentVersion: null,
      resolutionStatus: "unresolved",
      activeClaimId: null
    });
    expect(conflictExecutor.stateSnapshot()).toEqual(beforeConflict);
    expect(conflictExecutor.statementKinds()).toEqual([
      "lock_identity",
      "lock_head"
    ]);

    const rollbackExecutor = seededExecutor();
    const beforeFailure = rollbackExecutor.stateSnapshot();
    const terminalError = Object.assign(new Error("write failed"), {
      code: "23514"
    });
    rollbackExecutor.failNextStatement("insert_transition", terminalError);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        rollbackExecutor
      ).applyTransition(employeeClaimInput())
    ).rejects.toBe(terminalError);
    expect(rollbackExecutor.stateSnapshot()).toEqual(beforeFailure);
    expect(rollbackExecutor.rollbackCount).toBe(1);
    expect(rollbackExecutor.commitCount).toBe(0);
  });

  it("fails closed for self claims and missing or inactive Employee and ClientContact targets", async () => {
    const selfExecutor = seededExecutor();
    const selfOperation = employeeClaimInput().operation;
    if (selfOperation.kind !== "claim_employee") {
      throw new Error("Expected Employee claim operation.");
    }
    const selfClaim = await createSqlInboxV2SourceIdentityClaimRepository(
      selfExecutor
    ).applyTransition(
      employeeClaimInput({
        operation: {
          ...selfOperation,
          employeeId: actorEmployeeId
        }
      })
    );
    expect(selfClaim).toEqual({ kind: "manual_self_claim_forbidden" });
    expect(selfExecutor.transactionCount).toBe(0);

    const inactiveExecutor = seededExecutor();
    inactiveExecutor.setEmployee(targetEmployeeId, occurredAt);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        inactiveExecutor
      ).applyTransition(employeeClaimInput())
    ).resolves.toEqual({
      kind: "target_inactive",
      employeeId: targetEmployeeId
    });
    expect(inactiveExecutor.claimCount()).toBe(0);

    const missingEmployeeExecutor = seededExecutor();
    missingEmployeeExecutor.removeEmployee(targetEmployeeId);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        missingEmployeeExecutor
      ).applyTransition(employeeClaimInput())
    ).resolves.toEqual({
      kind: "target_not_found",
      targetKind: "employee",
      targetId: targetEmployeeId
    });

    const missingContactExecutor = seededExecutor();
    missingContactExecutor.removeClientContact(clientContactId);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        missingContactExecutor
      ).applyTransition(
        clientClaimInput({ expectedVersion: null, transitionId })
      )
    ).resolves.toEqual({
      kind: "target_not_found",
      targetKind: "client_contact",
      targetId: clientContactId
    });
  });

  it("persists raw and normalized evidence with the exact four-way row shape", async () => {
    const executor = seededExecutor();
    const repository = createSqlInboxV2SourceIdentityClaimRepository(executor);
    const operation = employeeClaimInput().operation;
    if (operation.kind === "revoke")
      throw new Error("Expected claim operation.");

    const result = await repository.applyTransition(
      employeeClaimInput({
        operation: {
          ...operation,
          evidenceReferences: [rawEvidence(), normalizedEvidence()]
        }
      })
    );

    expect(result).toMatchObject({ kind: "applied" });
    expect(executor.getClaim(claimId)?.evidence).toEqual([
      {
        ordinal: 0,
        kind: "raw_inbound_event",
        rawInboundEventId: rawEventId,
        normalizedInboundEventId: null,
        sourceOccurrenceId: null,
        providerRosterEvidenceId: null
      },
      {
        ordinal: 1,
        kind: "normalized_inbound_event",
        rawInboundEventId: null,
        normalizedInboundEventId: normalizedEventId,
        sourceOccurrenceId: null,
        providerRosterEvidenceId: null
      }
    ]);
    await expect(
      repository.findClaimById({ tenantId, claimId })
    ).resolves.toMatchObject({
      evidenceReferences: [rawEvidence(), normalizedEvidence()]
    });
  });

  it("accepts exact occurrence and roster actor proof but rejects provider raw-only and wrong actors", async () => {
    const rawOnlyExecutor = seededExecutor();
    rawOnlyExecutor.setIdentityScope("provider", null, null);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        rawOnlyExecutor
      ).applyTransition(employeeClaimInput())
    ).resolves.toMatchObject({
      kind: "evidence_scope_conflict",
      evidence: rawEvidence()
    });
    expect(rawOnlyExecutor.claimCount()).toBe(0);

    const occurrenceExecutor = seededExecutor();
    occurrenceExecutor.setIdentityScope("provider", null, null);
    const occurrenceOperation = employeeClaimInput().operation;
    if (occurrenceOperation.kind === "revoke") {
      throw new Error("Expected claim operation.");
    }
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        occurrenceExecutor
      ).applyTransition(
        employeeClaimInput({
          operation: {
            ...occurrenceOperation,
            evidenceReferences: [sourceOccurrenceEvidence(), rawEvidence()]
          }
        })
      )
    ).resolves.toMatchObject({ kind: "applied" });
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        occurrenceExecutor
      ).findClaimById({ tenantId, claimId })
    ).resolves.toMatchObject({
      evidenceReferences: [sourceOccurrenceEvidence(), rawEvidence()]
    });

    const rosterExecutor = seededExecutor();
    rosterExecutor.setIdentityScope("provider", null, null);
    const rosterOperation = employeeClaimInput().operation;
    if (rosterOperation.kind === "revoke") {
      throw new Error("Expected claim operation.");
    }
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        rosterExecutor
      ).applyTransition(
        employeeClaimInput({
          operation: {
            ...rosterOperation,
            evidenceReferences: [providerRosterEvidence()]
          }
        })
      )
    ).resolves.toMatchObject({ kind: "applied" });

    const wrongActorExecutor = seededExecutor();
    wrongActorExecutor.setIdentityScope("provider", null, null);
    wrongActorExecutor.setOccurrenceActor(
      sourceOccurrenceId,
      "source_external_identity:someone-else"
    );
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        wrongActorExecutor
      ).applyTransition(
        employeeClaimInput({
          operation: {
            ...occurrenceOperation,
            evidenceReferences: [sourceOccurrenceEvidence()]
          }
        })
      )
    ).resolves.toMatchObject({
      kind: "evidence_scope_conflict",
      evidence: sourceOccurrenceEvidence()
    });
    expect(wrongActorExecutor.claimCount()).toBe(0);
  });

  it("uses one exact active policy-authority fence and persists its immutable snapshot", async () => {
    const executor = seededExecutor();
    const result = await createSqlInboxV2SourceIdentityClaimRepository(
      executor
    ).applyTransition(
      employeeClaimInput({
        decision: automaticDecision()
      })
    );

    expect(result).toMatchObject({
      kind: "applied",
      transition: {
        decision: automaticDecision()
      }
    });
    expect(executor.getClaim(claimId)).toMatchObject({
      decisionKind: "automatic_policy",
      decisionActorEmployeeId: null,
      decisionTrustedServiceId: "core:identity-claim-service",
      policyFamily: "source_identity_claim",
      policyDefinitionContractVersion: "v1",
      policyDefinitionDigestSha256: policyDigest,
      policyActivationHeadRevision: "1"
    });
    expect(executor.statementKinds()).toContain("lock_exact_policy_authority");

    const staleExecutor = seededExecutor();
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        staleExecutor
      ).applyTransition(
        employeeClaimInput({
          decision: automaticDecision({ activationHeadRevision: "2" })
        })
      )
    ).resolves.toEqual({
      kind: "head_revision_conflict",
      currentHeadRevision: "1"
    });
    expect(staleExecutor.claimCount()).toBe(0);
    expect(staleExecutor.statementKinds()).not.toContain("insert_claim");

    const digestExecutor = seededExecutor();
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        digestExecutor
      ).applyTransition(
        employeeClaimInput({
          decision: automaticDecision({
            definitionDigestSha256: "b".repeat(64)
          })
        })
      )
    ).resolves.toEqual({
      kind: "definition_digest_conflict",
      currentDefinitionDigestSha256: policyDigest,
      currentHeadRevision: "1"
    });
    expect(digestExecutor.claimCount()).toBe(0);

    const revokedExecutor = seededExecutor();
    revokedExecutor.setPolicyAuthority({
      state: "revoked",
      revokedByEmployeeId: actorEmployeeId,
      revokedAt: occurredAt
    });
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        revokedExecutor
      ).applyTransition(employeeClaimInput({ decision: automaticDecision() }))
    ).resolves.toEqual({
      kind: "policy_inactive",
      currentHeadRevision: "1"
    });
    expect(revokedExecutor.claimCount()).toBe(0);
  });

  it("distinguishes missing evidence from identity-scope mismatch without writing", async () => {
    const missingExecutor = seededExecutor();
    missingExecutor.removeRawEvent(rawEventId);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        missingExecutor
      ).applyTransition(employeeClaimInput())
    ).resolves.toMatchObject({
      kind: "evidence_not_found",
      evidence: rawEvidence()
    });
    expect(missingExecutor.claimCount()).toBe(0);

    const mismatchExecutor = seededExecutor();
    mismatchExecutor.setIdentityScope(
      "source_connection",
      "source_connection:a",
      null
    );
    mismatchExecutor.setRawEvent(rawEventId, "source_connection:b", null);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        mismatchExecutor
      ).applyTransition(employeeClaimInput())
    ).resolves.toMatchObject({
      kind: "evidence_scope_conflict",
      evidence: rawEvidence()
    });
    expect(mismatchExecutor.claimCount()).toBe(0);

    const providerExecutor = seededExecutor();
    providerExecutor.setIdentityScope("provider", null, null);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        providerExecutor
      ).applyTransition(employeeClaimInput())
    ).resolves.toMatchObject({
      kind: "evidence_scope_conflict",
      evidence: rawEvidence()
    });
    expect(providerExecutor.claimCount()).toBe(0);
  });

  it("maps claimed history with exact evidence and enforces keyset page bounds", async () => {
    const executor = seededExecutor();
    const repository = createSqlInboxV2SourceIdentityClaimRepository(executor);
    await repository.applyTransition(employeeClaimInput());
    await repository.applyTransition(clientClaimInput());
    await repository.applyTransition(revokeInput());

    const firstPage = await repository.listHistory({
      tenantId,
      sourceExternalIdentityId,
      afterVersion: null,
      limit: 1
    });
    const secondPage = await repository.listHistory({
      tenantId,
      sourceExternalIdentityId,
      afterVersion: "1" as never,
      limit: 10
    });
    const exact = await repository.findClaimById({
      tenantId,
      claimId: secondClaimId
    });

    expect(firstPage).toHaveLength(1);
    expect(firstPage[0]).toMatchObject({
      id: claimId,
      previousClaimVersion: null,
      claimVersion: "1",
      status: "revoked",
      revocation: { revokedAt: reassignedAt },
      decision: { kind: "manual", actorEmployee: { id: actorEmployeeId } },
      evidenceReferences: [rawEvidence()]
    });
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]).toMatchObject({
      id: secondClaimId,
      previousClaimVersion: "1",
      claimVersion: "2",
      status: "revoked",
      revocation: { revokedAt },
      decision: { kind: "migration" },
      evidenceReferences: [normalizedEvidence()]
    });
    expect(exact).toEqual(secondPage[0]);
    await expect(
      repository.listHistory({
        tenantId,
        sourceExternalIdentityId,
        afterVersion: null,
        limit: 101
      })
    ).rejects.toMatchObject({ code: "validation.failed" });
  });

  it("rejects lossy JavaScript numbers in aggregate clocks and history rows", async () => {
    const identityExecutor = seededExecutor();
    identityExecutor.unsafeSetIdentityRevision(1);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        identityExecutor
      ).applyTransition(employeeClaimInput())
    ).rejects.toThrow(/lossy JavaScript number/u);

    const claimExecutor = seededExecutor();
    const repository =
      createSqlInboxV2SourceIdentityClaimRepository(claimExecutor);
    await repository.applyTransition(employeeClaimInput());
    claimExecutor.unsafeSetClaimVersion(claimId, 1);
    await expect(
      repository.findClaimById({ tenantId, claimId })
    ).rejects.toThrow(/lossy JavaScript number/u);
  });

  it("uses exact READ COMMITTED retries for nested 40P01 and 40001 only", async () => {
    const retryExecutor = seededExecutor().failNextTransactions(
      Object.assign(new Error("wrapped deadlock"), {
        cause: {
          cause: Object.assign(new Error("deadlock"), { code: "40P01" })
        }
      }),
      Object.assign(new Error("serialization"), { code: "40001" })
    );
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        retryExecutor
      ).applyTransition(employeeClaimInput())
    ).resolves.toMatchObject({ kind: "applied" });
    expect(retryExecutor.transactionCount).toBe(3);
    expect(retryExecutor.rollbackCount).toBe(2);
    expect(retryExecutor.commitCount).toBe(1);
    expect(retryExecutor.transactionIsolationLevels).toEqual([
      "read committed",
      "read committed",
      "read committed"
    ]);

    const nonRetryError = Object.assign(new Error("unique violation"), {
      code: "23505"
    });
    const nonRetryExecutor =
      seededExecutor().failNextTransactions(nonRetryError);
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        nonRetryExecutor
      ).applyTransition(employeeClaimInput())
    ).rejects.toBe(nonRetryError);
    expect(nonRetryExecutor.transactionCount).toBe(1);

    const claimIdConflictExecutor = seededExecutor().failNextTransactions(
      Object.assign(new Error("claim ID race"), {
        code: "23505",
        constraint: "inbox_v2_source_identity_claims_pk"
      })
    );
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        claimIdConflictExecutor
      ).applyTransition(employeeClaimInput())
    ).resolves.toEqual({ kind: "claim_id_conflict", claimId });

    const transitionIdConflictExecutor = seededExecutor().failNextTransactions(
      Object.assign(new Error("transition ID race"), {
        code: "23505",
        constraint: "inbox_v2_identity_claim_transitions_pk"
      })
    );
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        transitionIdConflictExecutor
      ).applyTransition(employeeClaimInput())
    ).resolves.toEqual({
      kind: "transition_id_conflict",
      transitionId
    });

    const exhaustedError = Object.assign(new Error("deadlock"), {
      code: "40P01"
    });
    const exhaustedExecutor = seededExecutor().failNextTransactions(
      exhaustedError,
      exhaustedError,
      exhaustedError
    );
    await expect(
      createSqlInboxV2SourceIdentityClaimRepository(
        exhaustedExecutor
      ).applyTransition(employeeClaimInput())
    ).rejects.toBe(exhaustedError);
    expect(exhaustedExecutor.transactionCount).toBe(3);
    expect(exhaustedExecutor.queries).toHaveLength(0);
  });
});

function employeeClaimInput(
  overrides: Partial<ApplyInboxV2SourceIdentityClaimTransitionInput> = {}
): ApplyInboxV2SourceIdentityClaimTransitionInput {
  return {
    tenantId,
    sourceExternalIdentityId,
    transitionId,
    expectedVersion: null,
    operation: {
      kind: "claim_employee",
      claimId,
      employeeId: targetEmployeeId,
      confidence: "verified",
      evidenceReferences: [rawEvidence()]
    },
    decision: manualDecision(),
    policyId: "core:verified-source-identity" as never,
    policyVersion: "v1",
    reasonCodeId: "core:operator-reviewed" as never,
    occurredAt,
    ...overrides
  };
}

function clientClaimInput(
  overrides: Partial<ApplyInboxV2SourceIdentityClaimTransitionInput> = {}
): ApplyInboxV2SourceIdentityClaimTransitionInput {
  return {
    tenantId,
    sourceExternalIdentityId,
    transitionId: secondTransitionId,
    expectedVersion: "1" as never,
    operation: {
      kind: "claim_client_contact",
      claimId: secondClaimId,
      clientContactId,
      confidence: "strong",
      evidenceReferences: [normalizedEvidence()]
    },
    decision: migrationDecision(),
    policyId: "core:verified-source-identity" as never,
    policyVersion: "v1",
    reasonCodeId: "core:trusted-import" as never,
    occurredAt: reassignedAt,
    ...overrides
  };
}

function revokeInput(
  overrides: Partial<ApplyInboxV2SourceIdentityClaimTransitionInput> = {}
): ApplyInboxV2SourceIdentityClaimTransitionInput {
  return {
    tenantId,
    sourceExternalIdentityId,
    transitionId: revokeTransitionId,
    expectedVersion: "2" as never,
    operation: { kind: "revoke" },
    decision: migrationDecision(),
    policyId: "core:verified-source-identity" as never,
    policyVersion: "v1",
    reasonCodeId: "core:explicit-revoke" as never,
    occurredAt: revokedAt,
    ...overrides
  };
}

function manualDecision() {
  return {
    kind: "manual" as const,
    actorEmployee: {
      tenantId,
      kind: "employee" as const,
      id: actorEmployeeId
    },
    reviewState: "approved" as const
  };
}

function migrationDecision() {
  return {
    kind: "migration" as const,
    trustedServiceId: "core:identity-migration" as never,
    reviewState: "not_required" as const
  };
}

function automaticDecision(
  authorityOverrides: Partial<{
    definitionContractVersion: string;
    definitionDigestSha256: string;
    activationHeadRevision: string;
  }> = {}
) {
  return {
    kind: "automatic_policy" as const,
    trustedServiceId: "core:identity-claim-service" as never,
    reviewState: "not_required" as const,
    policyAuthority: {
      family: "source_identity_claim" as const,
      definitionContractVersion:
        (authorityOverrides.definitionContractVersion ?? "v1") as never,
      definitionDigestSha256:
        authorityOverrides.definitionDigestSha256 ?? policyDigest,
      activationHeadRevision: (authorityOverrides.activationHeadRevision ??
        "1") as never
    }
  };
}

function rawEvidence() {
  return {
    kind: "raw_inbound_event" as const,
    reference: {
      tenantId,
      kind: "raw_inbound_event" as const,
      id: rawEventId as never
    }
  };
}

function normalizedEvidence() {
  return {
    kind: "normalized_inbound_event" as const,
    reference: {
      tenantId,
      kind: "normalized_inbound_event" as const,
      id: normalizedEventId as never
    }
  };
}

function sourceOccurrenceEvidence() {
  return {
    kind: "source_occurrence" as const,
    reference: {
      tenantId,
      kind: "source_occurrence" as const,
      id: sourceOccurrenceId as never
    }
  };
}

function providerRosterEvidence() {
  return {
    kind: "provider_roster_evidence" as const,
    reference: {
      tenantId,
      kind: "provider_roster_evidence" as const,
      id: providerRosterEvidenceId as never
    }
  };
}

function canonicalClaim(): InboxV2SourceIdentityClaim {
  return {
    tenantId,
    id: claimId,
    sourceExternalIdentity: {
      tenantId,
      kind: "source_external_identity",
      id: sourceExternalIdentityId
    },
    previousClaimVersion: null,
    claimVersion: "1" as never,
    target: {
      kind: "employee",
      employee: { tenantId, kind: "employee", id: targetEmployeeId }
    },
    status: "active",
    confidence: "verified",
    evidenceReferences: [rawEvidence()],
    policyId: "core:verified-source-identity" as never,
    policyVersion: "v1" as never,
    reasonCodeId: "core:operator-reviewed" as never,
    decision: manualDecision(),
    createdAt: occurredAt as never,
    revocation: null,
    revision: "1" as never
  };
}

function canonicalTransition(): InboxV2SourceIdentityClaimTransition {
  return {
    tenantId,
    id: transitionId,
    sourceExternalIdentity: {
      tenantId,
      kind: "source_external_identity",
      id: sourceExternalIdentityId
    },
    operation: {
      kind: "claim_employee",
      target: {
        kind: "employee",
        employee: { tenantId, kind: "employee", id: targetEmployeeId }
      },
      previousClaim: null,
      resultingClaim: {
        tenantId,
        kind: "source_identity_claim",
        id: claimId
      }
    },
    decision: manualDecision(),
    policyId: "core:verified-source-identity" as never,
    policyVersion: "v1" as never,
    reasonCodeId: "core:operator-reviewed" as never,
    expectedVersion: null,
    currentVersion: null,
    resultingVersion: "1" as never,
    occurredAt: occurredAt as never
  };
}

type StoredIdentity = {
  tenantId: string;
  id: string;
  scopeKind: "provider" | "source_connection" | "source_account";
  sourceConnectionId: string | null;
  sourceAccountId: string | null;
  revision: unknown;
  updatedAt: unknown;
};

type StoredHead = {
  resolutionStatus: "unresolved" | "claimed" | "conflicted";
  activeClaimId: unknown;
  latestClaimVersion: unknown;
};

type StoredEvidence = {
  ordinal: unknown;
  kind: unknown;
  rawInboundEventId: unknown;
  normalizedInboundEventId: unknown;
  sourceOccurrenceId: unknown;
  providerRosterEvidenceId: unknown;
};

type StoredClaim = {
  tenantId: string;
  id: string;
  sourceExternalIdentityId: string;
  previousClaimVersion: unknown;
  claimVersion: unknown;
  targetKind: unknown;
  targetEmployeeId: unknown;
  targetClientContactId: unknown;
  status: unknown;
  confidence: unknown;
  policyId: unknown;
  policyVersion: unknown;
  reasonCodeId: unknown;
  decisionKind: unknown;
  decisionActorEmployeeId: unknown;
  decisionTrustedServiceId: unknown;
  policyFamily: unknown;
  policyDefinitionContractVersion: unknown;
  policyDefinitionDigestSha256: unknown;
  policyActivationHeadRevision: unknown;
  createdAt: unknown;
  revokedAt: unknown;
  revision: unknown;
  evidence: StoredEvidence[];
};

type StoredEvent = {
  tenantId: string;
  id: string;
  sourceConnectionId: string | null;
  sourceAccountId: string | null;
};

type StoredAnchoredEvidence = StoredEvent & {
  rawInboundEventId: string | null;
  normalizedInboundEventId: string | null;
};

type StoredOccurrence = StoredAnchoredEvidence & {
  providerActorSourceExternalIdentityId: string;
};

type StoredPolicyAuthority = {
  tenantId: string;
  family: "source_identity_claim";
  policyId: string;
  policyVersion: string;
  definitionContractVersion: string;
  definitionDigestSha256: string;
  approvedTrustedServiceId: string;
  state: "active" | "revoked";
  activatedByEmployeeId: string;
  activatedAt: string;
  revokedByEmployeeId: string | null;
  revokedAt: string | null;
  revision: string;
  createdAt: string;
  updatedAt: string;
  versionApprovedByEmployeeId: string;
  versionApprovedAt: string;
};

type ClaimState = {
  identities: Map<string, StoredIdentity>;
  heads: Map<string, StoredHead>;
  claims: Map<string, StoredClaim>;
  transitions: Set<string>;
  employees: Map<string, unknown>;
  contacts: Set<string>;
  rawEvents: Map<string, StoredEvent>;
  normalizedEvents: Map<string, StoredEvent>;
  occurrences: Map<string, StoredOccurrence>;
  rosterEvidence: Map<string, StoredAnchoredEvidence>;
  rosterMembers: Set<string>;
  policyAuthority: StoredPolicyAuthority | null;
};

class StatefulClaimExecutor implements InboxV2SourceIdentityClaimTransactionExecutor {
  readonly queries: SQL[] = [];
  readonly transactionIsolationLevels: string[] = [];
  transactionCount = 0;
  commitCount = 0;
  rollbackCount = 0;
  private transactionFailures: unknown[] = [];
  private statementFailure: { kind: string; error: unknown } | null = null;

  constructor(private state: ClaimState) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rendered = renderQuery(query);
    const statement = normalizeSql(rendered.sql);
    const kind = statementKind(statement);
    if (this.statementFailure?.kind === kind) {
      const failure = this.statementFailure.error;
      this.statementFailure = null;
      throw failure;
    }

    return this.executeKind<Row>(kind, rendered.params);
  }

  async transaction<TResult>(
    work: (
      transaction: InboxV2TenantPolicyAuthorityUseTransaction
    ) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionCount += 1;
    this.transactionIsolationLevels.push(config.isolationLevel);
    const transactionFailure = this.transactionFailures.shift();
    if (transactionFailure !== undefined) {
      this.rollbackCount += 1;
      throw transactionFailure;
    }
    const snapshot = structuredClone(this.state);
    try {
      const result = await work(
        this as unknown as InboxV2TenantPolicyAuthorityUseTransaction
      );
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.state = snapshot;
      this.rollbackCount += 1;
      throw error;
    }
  }

  failNextTransactions(...errors: unknown[]): this {
    this.transactionFailures.push(...errors);
    return this;
  }

  failNextStatement(kind: string, error: unknown): void {
    this.statementFailure = { kind, error };
  }

  clearQueries(): void {
    this.queries.length = 0;
  }

  statementKinds(): string[] {
    return this.queries.map((query) =>
      statementKind(normalizeSql(renderQuery(query).sql))
    );
  }

  stateSnapshot(): ClaimState {
    return structuredClone(this.state);
  }

  getIdentity(): StoredIdentity {
    const identity = this.state.identities.get(
      storageKey(tenantId, sourceExternalIdentityId)
    );
    if (!identity) throw new Error("Expected seeded identity.");
    return structuredClone(identity);
  }

  getHead(): StoredHead {
    const head = this.state.heads.get(
      storageKey(tenantId, sourceExternalIdentityId)
    );
    if (!head) throw new Error("Expected seeded claim head.");
    return structuredClone(head);
  }

  getClaim(id: InboxV2SourceIdentityClaimId): StoredClaim | undefined {
    const claim = this.state.claims.get(storageKey(tenantId, id));
    return claim ? structuredClone(claim) : undefined;
  }

  claimCount(): number {
    return this.state.claims.size;
  }

  setEmployee(id: InboxV2EmployeeId, deactivatedAt: string | null): void {
    this.state.employees.set(storageKey(tenantId, id), deactivatedAt);
  }

  removeEmployee(id: InboxV2EmployeeId): void {
    this.state.employees.delete(storageKey(tenantId, id));
  }

  removeClientContact(id: InboxV2ClientContactId): void {
    this.state.contacts.delete(storageKey(tenantId, id));
  }

  removeRawEvent(id: string): void {
    this.state.rawEvents.delete(storageKey(tenantId, id));
  }

  setIdentityScope(
    kind: StoredIdentity["scopeKind"],
    sourceConnectionId: string | null,
    sourceAccountId: string | null
  ): void {
    const identity = this.getMutableIdentity();
    identity.scopeKind = kind;
    identity.sourceConnectionId = sourceConnectionId;
    identity.sourceAccountId = sourceAccountId;
  }

  setRawEvent(
    id: string,
    sourceConnectionId: string | null,
    sourceAccountId: string | null
  ): void {
    this.state.rawEvents.set(storageKey(tenantId, id), {
      tenantId,
      id,
      sourceConnectionId,
      sourceAccountId
    });
  }

  setOccurrenceActor(id: string, sourceIdentityId: string): void {
    const occurrence = this.state.occurrences.get(storageKey(tenantId, id));
    if (!occurrence) throw new Error("Expected seeded occurrence.");
    occurrence.providerActorSourceExternalIdentityId = sourceIdentityId;
  }

  setPolicyAuthority(overrides: Partial<StoredPolicyAuthority> | null): void {
    if (overrides === null) {
      this.state.policyAuthority = null;
      return;
    }
    const current = this.state.policyAuthority;
    if (current === null) throw new Error("Expected seeded policy authority.");
    this.state.policyAuthority = { ...current, ...overrides };
  }

  unsafeSetIdentityRevision(revision: unknown): void {
    this.getMutableIdentity().revision = revision;
  }

  unsafeSetClaimVersion(
    id: InboxV2SourceIdentityClaimId,
    claimVersion: unknown
  ): void {
    const claim = this.state.claims.get(storageKey(tenantId, id));
    if (!claim) throw new Error("Expected stored claim.");
    claim.claimVersion = claimVersion;
  }

  private getMutableIdentity(): StoredIdentity {
    const identity = this.state.identities.get(
      storageKey(tenantId, sourceExternalIdentityId)
    );
    if (!identity) throw new Error("Expected seeded identity.");
    return identity;
  }

  private executeKind<Row extends Record<string, unknown>>(
    kind: string,
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    switch (kind) {
      case "lock_identity":
        return this.lockIdentity<Row>(params);
      case "lock_head":
        return this.lockHead<Row>(params);
      case "lock_current_claim":
        return this.lockCurrentClaim<Row>(params);
      case "lock_employees":
        return this.lockEmployees<Row>(params);
      case "lock_contacts":
        return this.lockContacts<Row>(params);
      case "lock_raw_evidence":
        return this.lockEvents<Row>(this.state.rawEvents, params);
      case "lock_normalized_evidence":
        return this.lockEvents<Row>(this.state.normalizedEvents, params);
      case "lock_occurrence_evidence":
        return this.lockOccurrences<Row>(params);
      case "lock_roster_evidence":
        return this.lockAnchoredEvidence<Row>(
          this.state.rosterEvidence,
          params
        );
      case "lock_roster_members":
        return this.lockRosterMembers<Row>(params);
      case "lock_exact_policy_authority":
        return this.lockExactPolicyAuthority<Row>(params);
      case "lookup_transition_id":
        return rowsResult<Row>(
          this.state.transitions.has(
            storageKey(String(params[0]), String(params[1]))
          )
            ? [{ id: params[1] }]
            : []
        );
      case "lookup_claim_id":
        return rowsResult<Row>(
          this.state.claims.has(
            storageKey(String(params[0]), String(params[1]))
          )
            ? [{ id: params[1] }]
            : []
        );
      case "insert_claim":
        return this.insertClaim<Row>(params);
      case "insert_evidence":
        return this.insertEvidence<Row>(params);
      case "revoke_claim":
        return this.revokeClaim<Row>(params);
      case "insert_transition":
        return this.insertTransition<Row>(params);
      case "advance_identity":
        return this.advanceIdentity<Row>(params);
      case "advance_head":
        return this.advanceHead<Row>(params);
      case "find_claim":
        return this.findClaim<Row>(params);
      case "list_history":
        return this.listHistory<Row>(params);
      default:
        throw new Error(`Stateful claim fake does not understand ${kind}.`);
    }
  }

  private lockIdentity<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const identity = this.state.identities.get(
      storageKey(String(params[0]), String(params[1]))
    );
    return rowsResult<Row>(
      identity
        ? [
            {
              id: identity.id,
              scope_kind: identity.scopeKind,
              scope_source_connection_id: identity.sourceConnectionId,
              scope_source_account_id: identity.sourceAccountId,
              revision: identity.revision
            }
          ]
        : []
    );
  }

  private lockHead<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const head = this.state.heads.get(
      storageKey(String(params[0]), String(params[1]))
    );
    return rowsResult<Row>(
      head
        ? [
            {
              resolution_status: head.resolutionStatus,
              active_claim_id: head.activeClaimId,
              latest_claim_version: head.latestClaimVersion
            }
          ]
        : []
    );
  }

  private lockCurrentClaim<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const claim = this.state.claims.get(
      storageKey(String(params[0]), String(params[2]))
    );
    return rowsResult<Row>(claim ? [currentClaimRow(claim)] : []);
  }

  private lockEmployees<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[0]);
    return rowsResult<Row>(
      params.slice(1).flatMap((id) => {
        const key = storageKey(tenant, String(id));
        return this.state.employees.has(key)
          ? [{ id, deactivated_at: this.state.employees.get(key) }]
          : [];
      })
    );
  }

  private lockContacts<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[0]);
    return rowsResult<Row>(
      params
        .slice(1)
        .filter((id) => this.state.contacts.has(storageKey(tenant, String(id))))
        .map((id) => ({ id }))
    );
  }

  private lockEvents<Row extends Record<string, unknown>>(
    events: Map<string, StoredEvent>,
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[0]);
    return rowsResult<Row>(
      params.slice(1).flatMap((id) => {
        const event = events.get(storageKey(tenant, String(id)));
        return event
          ? [
              {
                id: event.id,
                source_connection_id: event.sourceConnectionId,
                source_account_id: event.sourceAccountId
              }
            ]
          : [];
      })
    );
  }

  private lockAnchoredEvidence<Row extends Record<string, unknown>>(
    evidence: Map<string, StoredAnchoredEvidence>,
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[0]);
    return rowsResult<Row>(
      params.slice(1).flatMap((id) => {
        const row = evidence.get(storageKey(tenant, String(id)));
        return row
          ? [
              {
                id: row.id,
                source_connection_id: row.sourceConnectionId,
                source_account_id: row.sourceAccountId,
                raw_inbound_event_id: row.rawInboundEventId,
                normalized_inbound_event_id: row.normalizedInboundEventId
              }
            ]
          : [];
      })
    );
  }

  private lockOccurrences<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[0]);
    return rowsResult<Row>(
      params.slice(1).flatMap((id) => {
        const row = this.state.occurrences.get(storageKey(tenant, String(id)));
        return row
          ? [
              {
                id: row.id,
                source_connection_id: row.sourceConnectionId,
                source_account_id: row.sourceAccountId,
                raw_inbound_event_id: row.rawInboundEventId,
                normalized_inbound_event_id: row.normalizedInboundEventId,
                provider_actor_source_external_identity_id:
                  row.providerActorSourceExternalIdentityId
              }
            ]
          : [];
      })
    );
  }

  private lockRosterMembers<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[0]);
    const identityId = String(params.at(-1));
    return rowsResult<Row>(
      params.slice(1, -1).flatMap((rosterEvidenceId) =>
        this.state.rosterMembers.has(
          rosterMemberKey(tenant, String(rosterEvidenceId), identityId)
        )
          ? [
              {
                roster_evidence_id: rosterEvidenceId,
                source_external_identity_id: identityId
              }
            ]
          : []
      )
    );
  }

  private lockExactPolicyAuthority<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const authority = this.state.policyAuthority;
    if (
      authority === null ||
      authority.tenantId !== params[0] ||
      authority.family !== params[1] ||
      authority.policyId !== params[2]
    ) {
      return rowsResult<Row>([]);
    }
    return rowsResult<Row>([
      {
        tenant_id: authority.tenantId,
        family: authority.family,
        policy_id: authority.policyId,
        policy_version: authority.policyVersion,
        definition_contract_version: authority.definitionContractVersion,
        definition_digest_sha256: authority.definitionDigestSha256,
        approved_trusted_service_id: authority.approvedTrustedServiceId,
        state: authority.state,
        activated_by_employee_id: authority.activatedByEmployeeId,
        activated_at: authority.activatedAt,
        revoked_by_employee_id: authority.revokedByEmployeeId,
        revoked_at: authority.revokedAt,
        revision: authority.revision,
        created_at: authority.createdAt,
        updated_at: authority.updatedAt,
        version_approved_by_employee_id: authority.versionApprovedByEmployeeId,
        version_approved_at: authority.versionApprovedAt,
        version_revision: "1",
        version_created_at: authority.versionApprovedAt,
        version_updated_at: authority.versionApprovedAt
      }
    ]);
  }

  private insertClaim<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [
      tenant,
      id,
      identityId,
      previousClaimVersion,
      claimVersion,
      targetKind,
      targetEmployee,
      targetContact,
      confidence,
      policyId,
      policyVersion,
      reasonCodeId,
      decisionKind,
      decisionActorEmployeeId,
      decisionTrustedServiceId,
      policyFamily,
      policyDefinitionContractVersion,
      policyDefinitionDigestSha256,
      policyActivationHeadRevision,
      createdAt
    ] = params;
    const key = storageKey(String(tenant), String(id));
    if (this.state.claims.has(key)) return rowsResult<Row>([]);
    this.state.claims.set(key, {
      tenantId: String(tenant),
      id: String(id),
      sourceExternalIdentityId: String(identityId),
      previousClaimVersion,
      claimVersion,
      targetKind,
      targetEmployeeId: targetEmployee,
      targetClientContactId: targetContact,
      status: "active",
      confidence,
      policyId,
      policyVersion,
      reasonCodeId,
      decisionKind,
      decisionActorEmployeeId,
      decisionTrustedServiceId,
      policyFamily,
      policyDefinitionContractVersion,
      policyDefinitionDigestSha256,
      policyActivationHeadRevision,
      createdAt,
      revokedAt: null,
      revision: "1",
      evidence: []
    });
    return rowsResult<Row>([{ id }]);
  }

  private insertEvidence<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [
      tenant,
      claim,
      ,
      ,
      ordinal,
      kind,
      rawInboundEventId,
      normalizedInboundEventId,
      sourceOccurrenceId,
      providerRosterEvidenceId
    ] = params;
    const stored = this.state.claims.get(
      storageKey(String(tenant), String(claim))
    );
    if (!stored) return rowsResult<Row>([]);
    stored.evidence.push({
      ordinal,
      kind,
      rawInboundEventId,
      normalizedInboundEventId,
      sourceOccurrenceId,
      providerRosterEvidenceId
    });
    return rowsResult<Row>([{ id: claim }]);
  }

  private revokeClaim<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [time, tenant, identityId, id] = params;
    const claim = this.state.claims.get(storageKey(String(tenant), String(id)));
    if (
      !claim ||
      claim.sourceExternalIdentityId !== identityId ||
      claim.status !== "active" ||
      claim.revision !== "1"
    ) {
      return rowsResult<Row>([]);
    }
    claim.status = "revoked";
    claim.revokedAt = time;
    claim.revision = "2";
    return rowsResult<Row>([{ id }]);
  }

  private insertTransition<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[0]);
    const id = String(params[1]);
    const key = storageKey(tenant, id);
    if (this.state.transitions.has(key)) return rowsResult<Row>([]);
    this.state.transitions.add(key);
    return rowsResult<Row>([{ id }]);
  }

  private advanceIdentity<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [resultingRevision, updatedAt, tenant, id, expectedRevision] = params;
    const identity = this.state.identities.get(
      storageKey(String(tenant), String(id))
    );
    if (!identity || identity.revision !== expectedRevision) {
      return rowsResult<Row>([]);
    }
    identity.revision = resultingRevision;
    identity.updatedAt = updatedAt;
    return rowsResult<Row>([{ id }]);
  }

  private advanceHead<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [
      status,
      activeClaimId,
      resultingVersion,
      tenant,
      id,
      expectedVersion
    ] = params;
    const head = this.state.heads.get(storageKey(String(tenant), String(id)));
    if (!head || head.latestClaimVersion !== expectedVersion) {
      return rowsResult<Row>([]);
    }
    head.resolutionStatus = status as StoredHead["resolutionStatus"];
    head.activeClaimId = activeClaimId;
    head.latestClaimVersion = resultingVersion;
    return rowsResult<Row>([{ id }]);
  }

  private findClaim<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const claim = this.state.claims.get(
      storageKey(String(params[0]), String(params[1]))
    );
    return rowsResult<Row>(claim ? persistenceRows(claim) : []);
  }

  private listHistory<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[0]);
    const identityId = String(params[1]);
    const hasCursor = params.length === 4;
    const afterVersion = hasCursor ? BigInt(String(params[2])) : null;
    const limit = Number(params[hasCursor ? 3 : 2]);
    const claims = [...this.state.claims.values()]
      .filter(
        (claim) =>
          claim.tenantId === tenant &&
          claim.sourceExternalIdentityId === identityId &&
          (afterVersion === null ||
            BigInt(String(claim.claimVersion)) > afterVersion)
      )
      .sort((left, right) =>
        BigInt(String(left.claimVersion)) < BigInt(String(right.claimVersion))
          ? -1
          : 1
      )
      .slice(0, limit);
    return rowsResult<Row>(claims.flatMap(persistenceRows));
  }
}

function seededExecutor(): StatefulClaimExecutor {
  const identityKey = storageKey(tenantId, sourceExternalIdentityId);
  const state: ClaimState = {
    identities: new Map([
      [
        identityKey,
        {
          tenantId,
          id: sourceExternalIdentityId,
          scopeKind: "source_account",
          sourceConnectionId: null,
          sourceAccountId: "source_account:a",
          revision: "1",
          updatedAt: occurredAt
        }
      ]
    ]),
    heads: new Map([
      [
        identityKey,
        {
          resolutionStatus: "unresolved",
          activeClaimId: null,
          latestClaimVersion: null
        }
      ]
    ]),
    claims: new Map(),
    transitions: new Set(),
    employees: new Map([
      [storageKey(tenantId, actorEmployeeId), null],
      [storageKey(tenantId, targetEmployeeId), null]
    ]),
    contacts: new Set([storageKey(tenantId, clientContactId)]),
    rawEvents: new Map([
      [
        storageKey(tenantId, rawEventId),
        {
          tenantId,
          id: rawEventId,
          sourceConnectionId: "connection:a",
          sourceAccountId: "source_account:a"
        }
      ]
    ]),
    normalizedEvents: new Map([
      [
        storageKey(tenantId, normalizedEventId),
        {
          tenantId,
          id: normalizedEventId,
          sourceConnectionId: "connection:a",
          sourceAccountId: "source_account:a"
        }
      ]
    ]),
    occurrences: new Map([
      [
        storageKey(tenantId, sourceOccurrenceId),
        {
          tenantId,
          id: sourceOccurrenceId,
          sourceConnectionId: "connection:a",
          sourceAccountId: "source_account:a",
          rawInboundEventId: rawEventId,
          normalizedInboundEventId: normalizedEventId,
          providerActorSourceExternalIdentityId: sourceExternalIdentityId
        }
      ]
    ]),
    rosterEvidence: new Map([
      [
        storageKey(tenantId, providerRosterEvidenceId),
        {
          tenantId,
          id: providerRosterEvidenceId,
          sourceConnectionId: "connection:a",
          sourceAccountId: "source_account:a",
          rawInboundEventId: rawEventId,
          normalizedInboundEventId: normalizedEventId
        }
      ]
    ]),
    rosterMembers: new Set([
      rosterMemberKey(
        tenantId,
        providerRosterEvidenceId,
        sourceExternalIdentityId
      )
    ]),
    policyAuthority: {
      tenantId,
      family: "source_identity_claim",
      policyId: "core:verified-source-identity",
      policyVersion: "v1",
      definitionContractVersion: "v1",
      definitionDigestSha256: policyDigest,
      approvedTrustedServiceId: "core:identity-claim-service",
      state: "active",
      activatedByEmployeeId: actorEmployeeId,
      activatedAt: occurredAt,
      revokedByEmployeeId: null,
      revokedAt: null,
      revision: "1",
      createdAt: occurredAt,
      updatedAt: occurredAt,
      versionApprovedByEmployeeId: actorEmployeeId,
      versionApprovedAt: occurredAt
    }
  };
  return new StatefulClaimExecutor(state);
}

function currentClaimRow(claim: StoredClaim): Record<string, unknown> {
  return {
    id: claim.id,
    source_external_identity_id: claim.sourceExternalIdentityId,
    claim_version: claim.claimVersion,
    target_kind: claim.targetKind,
    target_employee_id: claim.targetEmployeeId,
    target_client_contact_id: claim.targetClientContactId,
    status: claim.status
  };
}

function persistenceRows(claim: StoredClaim): Record<string, unknown>[] {
  return claim.evidence.map((evidence) => ({
    tenant_id: claim.tenantId,
    id: claim.id,
    source_external_identity_id: claim.sourceExternalIdentityId,
    previous_claim_version: claim.previousClaimVersion,
    claim_version: claim.claimVersion,
    target_kind: claim.targetKind,
    target_employee_id: claim.targetEmployeeId,
    target_client_contact_id: claim.targetClientContactId,
    status: claim.status,
    confidence: claim.confidence,
    policy_id: claim.policyId,
    policy_version: claim.policyVersion,
    reason_code_id: claim.reasonCodeId,
    decision_kind: claim.decisionKind,
    decision_actor_employee_id: claim.decisionActorEmployeeId,
    decision_trusted_service_id: claim.decisionTrustedServiceId,
    policy_family: claim.policyFamily,
    policy_definition_contract_version: claim.policyDefinitionContractVersion,
    policy_definition_digest_sha256: claim.policyDefinitionDigestSha256,
    policy_activation_head_revision: claim.policyActivationHeadRevision,
    created_at: claim.createdAt,
    revoked_at: claim.revokedAt,
    revision: claim.revision,
    evidence_ordinal: evidence.ordinal,
    evidence_kind: evidence.kind,
    raw_inbound_event_id: evidence.rawInboundEventId,
    normalized_inbound_event_id: evidence.normalizedInboundEventId,
    source_occurrence_id: evidence.sourceOccurrenceId,
    provider_roster_evidence_id: evidence.providerRosterEvidenceId
  }));
}

function statementKind(statement: string): string {
  if (
    statement.includes("from inbox_v2_source_external_identities identity_row")
  ) {
    return "lock_identity";
  }
  if (
    statement.includes("from inbox_v2_source_identity_claim_heads head_row")
  ) {
    return "lock_head";
  }
  if (
    statement.includes("from inbox_v2_source_identity_claims claim_row") &&
    statement.includes("for update")
  ) {
    return "lock_current_claim";
  }
  if (statement.includes("from employees employee_row"))
    return "lock_employees";
  if (statement.includes("from client_contacts contact_row"))
    return "lock_contacts";
  if (statement.includes("from raw_inbound_events event_row")) {
    return "lock_raw_evidence";
  }
  if (statement.includes("from normalized_inbound_events event_row")) {
    return "lock_normalized_evidence";
  }
  if (statement.includes("from inbox_v2_source_occurrences occurrence_row")) {
    return "lock_occurrence_evidence";
  }
  if (statement.includes("from inbox_v2_provider_roster_evidence roster_row")) {
    return "lock_roster_evidence";
  }
  if (
    statement.includes(
      "from inbox_v2_provider_roster_member_evidence member_row"
    )
  ) {
    return "lock_roster_members";
  }
  if (
    statement.includes(
      "from inbox_v2_tenant_policy_activation_heads head_row"
    ) &&
    statement.includes("for share of head_row, version_row")
  ) {
    return "lock_exact_policy_authority";
  }
  if (
    statement.startsWith(
      "select id from inbox_v2_source_identity_claim_transitions"
    )
  ) {
    return "lookup_transition_id";
  }
  if (statement.startsWith("select id from inbox_v2_source_identity_claims")) {
    return "lookup_claim_id";
  }
  if (
    statement.startsWith(
      "insert into inbox_v2_source_identity_claim_evidence_references"
    )
  ) {
    return "insert_evidence";
  }
  if (statement.startsWith("insert into inbox_v2_source_identity_claims")) {
    return "insert_claim";
  }
  if (statement.startsWith("update inbox_v2_source_identity_claims")) {
    return "revoke_claim";
  }
  if (
    statement.startsWith(
      "insert into inbox_v2_source_identity_claim_transitions"
    )
  ) {
    return "insert_transition";
  }
  if (statement.startsWith("update inbox_v2_source_external_identities")) {
    return "advance_identity";
  }
  if (statement.startsWith("update inbox_v2_source_identity_claim_heads")) {
    return "advance_head";
  }
  if (statement.startsWith("with claim_page as materialized")) {
    return "list_history";
  }
  if (statement.startsWith("select claim_row.tenant_id")) return "find_claim";
  throw new Error(`Unknown claim repository statement: ${statement}`);
}

function rowsResult<Row extends Record<string, unknown>>(
  rows: readonly Record<string, unknown>[]
): RawSqlQueryResult<Row> {
  return { rows: rows as readonly Row[] };
}

function storageKey(tenant: string, id: string): string {
  return `${tenant}\u0000${id}`;
}

function rosterMemberKey(
  tenant: string,
  rosterEvidenceId: string,
  identityId: string
): string {
  return `${tenant}\u0000${rosterEvidenceId}\u0000${identityId}`;
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
