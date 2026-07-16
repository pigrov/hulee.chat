import {
  inboxV2ClientContactIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2ExactActiveTenantPolicyAuthorityInputSchema,
  inboxV2IdentityClaimPolicyIdSchema,
  inboxV2IdentityClaimReasonIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceIdentityClaimConfidenceSchema,
  inboxV2SourceIdentityClaimDecisionSchema,
  inboxV2SourceIdentityClaimEvidenceReferenceSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityClaimSchema,
  inboxV2SourceIdentityClaimTransitionIdSchema,
  inboxV2SourceIdentityClaimTransitionSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2ClientContactId,
  type InboxV2EmployeeId,
  type InboxV2EntityRevision,
  type InboxV2IdentityClaimPolicyId,
  type InboxV2IdentityClaimReasonId,
  type InboxV2SourceExternalIdentityId,
  type InboxV2SourceIdentityClaim,
  type InboxV2SourceIdentityClaimId,
  type InboxV2SourceIdentityClaimTarget,
  type InboxV2SourceIdentityClaimTransition,
  type InboxV2SourceIdentityClaimTransitionId,
  type InboxV2SourceIdentityClaimVersion,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import {
  assertInboxV2AuthorizedCommandMutationContext,
  type InboxV2AuthorizedCommandMutationContext
} from "./sql-inbox-v2-authorization-repository";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import {
  lockAndValidateExactActiveInboxV2TenantPolicyAuthority,
  type InboxV2TenantPolicyAuthorityUseTransaction,
  type LockExactActiveInboxV2TenantPolicyAuthorityResult
} from "./sql-inbox-v2-tenant-policy-authority-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const CLAIM_TRANSACTION_CONFIG = { isolationLevel: "read committed" } as const;
const CLAIM_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const HISTORY_PAGE_MAX = 100;
const APPLY_KEYS = new Set([
  "tenantId",
  "sourceExternalIdentityId",
  "transitionId",
  "expectedVersion",
  "operation",
  "decision",
  "policyId",
  "policyVersion",
  "reasonCodeId",
  "occurredAt"
]);

type ClaimEvidenceReference =
  InboxV2SourceIdentityClaim["evidenceReferences"][number];
type ClaimDecision = InboxV2SourceIdentityClaim["decision"];
type ClaimConfidence = InboxV2SourceIdentityClaim["confidence"];

export type InboxV2SourceIdentityClaimMutationOperation =
  | Readonly<{
      kind: "claim_employee";
      claimId: InboxV2SourceIdentityClaimId;
      employeeId: InboxV2EmployeeId;
      confidence: ClaimConfidence;
      evidenceReferences: readonly ClaimEvidenceReference[];
    }>
  | Readonly<{
      kind: "claim_client_contact";
      claimId: InboxV2SourceIdentityClaimId;
      clientContactId: InboxV2ClientContactId;
      confidence: ClaimConfidence;
      evidenceReferences: readonly ClaimEvidenceReference[];
    }>
  | Readonly<{ kind: "revoke" }>;

export type ApplyInboxV2SourceIdentityClaimTransitionInput = Readonly<{
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  transitionId: InboxV2SourceIdentityClaimTransitionId;
  expectedVersion: InboxV2SourceIdentityClaimVersion | null;
  operation: InboxV2SourceIdentityClaimMutationOperation;
  decision: ClaimDecision;
  policyId: InboxV2IdentityClaimPolicyId;
  policyVersion: string;
  reasonCodeId: InboxV2IdentityClaimReasonId;
  occurredAt: string;
}>;

export type InboxV2AuthorizedSourceIdentityClaimStateFence = Readonly<{
  authorizationDecisionId: string;
  expectedActiveClaim: null | Readonly<{
    claimId: InboxV2SourceIdentityClaimId;
    target:
      | Readonly<{
          kind: "employee";
          employeeId: InboxV2EmployeeId;
        }>
      | Readonly<{
          kind: "client_contact";
          clientContactId: InboxV2ClientContactId;
        }>;
  }>;
}>;

export type ApplyInboxV2SourceIdentityClaimTransitionResult =
  | Readonly<{
      kind: "applied";
      transition: InboxV2SourceIdentityClaimTransition;
    }>
  | Readonly<{
      kind: "version_conflict";
      currentVersion: InboxV2SourceIdentityClaimVersion | null;
      resolutionStatus: ClaimResolutionStatus;
      activeClaimId: InboxV2SourceIdentityClaimId | null;
    }>
  | Readonly<{ kind: "identity_not_found" }>
  | Readonly<{
      kind: "target_not_found";
      targetKind: "employee" | "client_contact";
      targetId: InboxV2EmployeeId | InboxV2ClientContactId;
    }>
  | Readonly<{
      kind: "target_inactive" | "actor_inactive";
      employeeId: InboxV2EmployeeId;
    }>
  | Readonly<{
      kind: "actor_not_found";
      employeeId: InboxV2EmployeeId;
    }>
  | Readonly<{ kind: "manual_self_claim_forbidden" }>
  | Readonly<{ kind: "no_active_claim" }>
  | Readonly<{
      kind: "active_claim_conflict";
      currentVersion: InboxV2SourceIdentityClaimVersion | null;
      activeClaimId: InboxV2SourceIdentityClaimId | null;
      activeTarget: InboxV2SourceIdentityClaimTarget | null;
    }>
  | Readonly<{
      kind: "evidence_not_found" | "evidence_scope_conflict";
      evidence: ClaimEvidenceReference;
    }>
  | Readonly<{
      kind: "claim_id_conflict";
      claimId: InboxV2SourceIdentityClaimId;
    }>
  | Readonly<{
      kind: "transition_id_conflict";
      transitionId: InboxV2SourceIdentityClaimTransitionId;
    }>
  | Exclude<
      LockExactActiveInboxV2TenantPolicyAuthorityResult,
      Readonly<{ kind: "locked" }>
    >;

export type ListInboxV2SourceIdentityClaimHistoryInput = Readonly<{
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  afterVersion: InboxV2SourceIdentityClaimVersion | null;
  limit: number;
}>;

export type InboxV2SourceIdentityClaimTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (
      transaction: InboxV2TenantPolicyAuthorityUseTransaction
    ) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2SourceIdentityClaimRepository = Readonly<{
  /**
   * Low-level compatibility and migration entrypoint. Runtime/API commands
   * must use applyTransitionInAuthorizedContext so authenticated attribution
   * and live authorization revision fences share the mutation transaction.
   */
  applyTransition(
    input: ApplyInboxV2SourceIdentityClaimTransitionInput
  ): Promise<ApplyInboxV2SourceIdentityClaimTransitionResult>;
  applyTransitionInAuthorizedContext(
    context: InboxV2AuthorizedCommandMutationContext,
    input: ApplyInboxV2SourceIdentityClaimTransitionInput,
    stateFence: InboxV2AuthorizedSourceIdentityClaimStateFence
  ): Promise<ApplyInboxV2SourceIdentityClaimTransitionResult>;
  findClaimById(input: {
    tenantId: InboxV2TenantId;
    claimId: InboxV2SourceIdentityClaimId;
  }): Promise<InboxV2SourceIdentityClaim | null>;
  listHistory(
    input: ListInboxV2SourceIdentityClaimHistoryInput
  ): Promise<readonly InboxV2SourceIdentityClaim[]>;
}>;

type ClaimResolutionStatus = "unresolved" | "claimed" | "conflicted";
type NormalizedOperation =
  | Readonly<{
      kind: "claim_employee";
      claimId: InboxV2SourceIdentityClaimId;
      employeeId: InboxV2EmployeeId;
      confidence: ClaimConfidence;
      evidenceReferences: readonly SupportedClaimEvidenceReference[];
    }>
  | Readonly<{
      kind: "claim_client_contact";
      claimId: InboxV2SourceIdentityClaimId;
      clientContactId: InboxV2ClientContactId;
      confidence: ClaimConfidence;
      evidenceReferences: readonly SupportedClaimEvidenceReference[];
    }>
  | Readonly<{ kind: "revoke" }>;
type SupportedClaimEvidenceReference = ClaimEvidenceReference;
type NormalizedInput = Readonly<{
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  transitionId: InboxV2SourceIdentityClaimTransitionId;
  expectedVersion: InboxV2SourceIdentityClaimVersion | null;
  operation: NormalizedOperation;
  decision: ClaimDecision;
  policyId: InboxV2IdentityClaimPolicyId;
  policyVersion: string;
  reasonCodeId: InboxV2IdentityClaimReasonId;
  occurredAt: string;
}>;

type IdRow = { id: unknown };
type IdentityLockRow = {
  id: unknown;
  scope_kind: unknown;
  scope_source_connection_id: unknown;
  scope_source_account_id: unknown;
  revision: unknown;
};
type HeadLockRow = {
  resolution_status: unknown;
  active_claim_id: unknown;
  latest_claim_version: unknown;
};
type CurrentClaimRow = {
  id: unknown;
  source_external_identity_id: unknown;
  claim_version: unknown;
  target_kind: unknown;
  target_employee_id: unknown;
  target_client_contact_id: unknown;
  status: unknown;
};
type EmployeeLockRow = { id: unknown; deactivated_at: unknown };
type ClientContactLockRow = { id: unknown };
type EventLockRow = {
  id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
};
type AnchoredEvidenceLockRow = EventLockRow & {
  raw_inbound_event_id: unknown;
  normalized_inbound_event_id: unknown;
};
type OccurrenceLockRow = AnchoredEvidenceLockRow & {
  provider_actor_source_external_identity_id: unknown;
};
type RosterLockRow = AnchoredEvidenceLockRow;
type RosterMemberLockRow = {
  roster_evidence_id: unknown;
  source_external_identity_id: unknown;
};
type ClaimPersistenceRow = {
  tenant_id: unknown;
  id: unknown;
  source_external_identity_id: unknown;
  previous_claim_version: unknown;
  claim_version: unknown;
  target_kind: unknown;
  target_employee_id: unknown;
  target_client_contact_id: unknown;
  status: unknown;
  confidence: unknown;
  policy_id: unknown;
  policy_version: unknown;
  reason_code_id: unknown;
  decision_kind: unknown;
  decision_actor_employee_id: unknown;
  decision_trusted_service_id: unknown;
  policy_family: unknown;
  policy_definition_contract_version: unknown;
  policy_definition_digest_sha256: unknown;
  policy_activation_head_revision: unknown;
  created_at: unknown;
  revoked_at: unknown;
  revision: unknown;
  evidence_ordinal: unknown;
  evidence_kind: unknown;
  raw_inbound_event_id: unknown;
  normalized_inbound_event_id: unknown;
  source_occurrence_id: unknown;
  provider_roster_evidence_id: unknown;
};

export function createSqlInboxV2SourceIdentityClaimRepository(
  executor: InboxV2SourceIdentityClaimTransactionExecutor | HuleeDatabase
): InboxV2SourceIdentityClaimRepository {
  const transactionExecutor =
    executor as unknown as InboxV2SourceIdentityClaimTransactionExecutor;

  return {
    async applyTransitionInAuthorizedContext(context, input, stateFence) {
      assertInboxV2AuthorizedCommandMutationContext(context);
      const normalized = normalizeApplyInput(input);
      const normalizedFence = normalizeAuthorizedStateFence(
        stateFence,
        normalized
      );

      if (
        context.profile !== "domain" ||
        context.tenantId !== normalized.tenantId ||
        context.occurredAt !== normalized.occurredAt ||
        context.authorizationDecisionId !==
          normalizedFence.authorizationDecisionId ||
        normalized.decision.kind === "migration" ||
        !claimDecisionMatchesAuthorizedActor(normalized.decision, context.actor)
      ) {
        throw new CoreError("permission.denied");
      }

      // The authorization coordinator owns the live transaction and its retry
      // loop. Call the no-transaction core directly: one failed statement
      // aborts PostgreSQL's executor, so a local retry would only hide the
      // original 40001/40P01 behind 25P02.
      return applyNormalizedTransitionOnExistingTransaction(
        context.executor as InboxV2TenantPolicyAuthorityUseTransaction,
        normalized,
        normalizedFence
      );
    },

    async applyTransition(input) {
      const normalized = normalizeApplyInput(input);
      if (isManualSelfClaim(normalized)) {
        return { kind: "manual_self_claim_forbidden" };
      }

      try {
        return await runClaimTransaction(
          transactionExecutor,
          async (transaction) =>
            applyNormalizedTransition(transaction, normalized, null),
          CLAIM_TRANSACTION_ATTEMPTS
        );
      } catch (error) {
        return mapClaimPersistenceConflictOrThrow(normalized, error);
      }
    },

    async findClaimById(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const claimId = inboxV2SourceIdentityClaimIdSchema.parse(input.claimId);
      const result = await transactionExecutor.execute<ClaimPersistenceRow>(
        buildFindInboxV2SourceIdentityClaimByIdSql({ tenantId, claimId })
      );
      return mapSingleClaimRows(result.rows, tenantId);
    },

    async listHistory(input) {
      const normalized = normalizeHistoryInput(input);
      const result = await transactionExecutor.execute<ClaimPersistenceRow>(
        buildListInboxV2SourceIdentityClaimHistorySql(normalized)
      );
      return mapClaimRows(result.rows, normalized.tenantId);
    }
  };
}

async function applyNormalizedTransitionOnExistingTransaction(
  transaction: InboxV2TenantPolicyAuthorityUseTransaction,
  normalized: NormalizedInput,
  stateFence: InboxV2AuthorizedSourceIdentityClaimStateFence
): Promise<ApplyInboxV2SourceIdentityClaimTransitionResult> {
  if (isManualSelfClaim(normalized)) {
    return { kind: "manual_self_claim_forbidden" };
  }
  try {
    return await applyNormalizedTransition(transaction, normalized, stateFence);
  } catch (error) {
    return mapClaimPersistenceConflictOrThrow(normalized, error);
  }
}

async function applyNormalizedTransition(
  transaction: InboxV2TenantPolicyAuthorityUseTransaction,
  normalized: NormalizedInput,
  stateFence: InboxV2AuthorizedSourceIdentityClaimStateFence | null
): Promise<ApplyInboxV2SourceIdentityClaimTransitionResult> {
  const identity = await lockIdentity(transaction, normalized);
  if (identity === null) return { kind: "identity_not_found" };

  const head = await lockHead(transaction, normalized);
  assertIdentityClaimClock(identity.revision, head.latestVersion);
  if (head.latestVersion !== normalized.expectedVersion) {
    return {
      kind: "version_conflict",
      currentVersion: head.latestVersion,
      resolutionStatus: head.resolutionStatus,
      activeClaimId: head.activeClaimId
    };
  }

  const activeClaim = await lockCurrentClaim(transaction, normalized, head);
  if (
    stateFence !== null &&
    !activeClaimMatchesStateFence(activeClaim, stateFence)
  ) {
    return {
      kind: "active_claim_conflict",
      currentVersion: head.latestVersion,
      activeClaimId: activeClaim?.id ?? null,
      activeTarget: activeClaim?.target ?? null
    };
  }
  if (normalized.operation.kind === "revoke" && activeClaim === null) {
    return { kind: "no_active_claim" };
  }

  if (
    await rowIdExists(
      transaction,
      "inbox_v2_source_identity_claim_transitions",
      normalized.tenantId,
      normalized.transitionId
    )
  ) {
    return {
      kind: "transition_id_conflict",
      transitionId: normalized.transitionId
    };
  }
  if (
    normalized.operation.kind !== "revoke" &&
    (await rowIdExists(
      transaction,
      "inbox_v2_source_identity_claims",
      normalized.tenantId,
      normalized.operation.claimId
    ))
  ) {
    return {
      kind: "claim_id_conflict",
      claimId: normalized.operation.claimId
    };
  }

  const targetResult = await lockAndValidateTargets(
    transaction,
    normalized,
    activeClaim
  );
  if (targetResult !== null) return targetResult;

  let validatedPolicyAuthorityHeadRevision: InboxV2EntityRevision | null = null;
  if (normalized.decision.kind === "automatic_policy") {
    const policyAuthority =
      await lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
        transaction,
        inboxV2ExactActiveTenantPolicyAuthorityInputSchema.parse({
          tenantId: normalized.tenantId,
          family: "source_identity_claim",
          policyId: normalized.policyId,
          policyVersion: normalized.policyVersion,
          definitionContractVersion:
            normalized.decision.policyAuthority.definitionContractVersion,
          definitionDigestSha256:
            normalized.decision.policyAuthority.definitionDigestSha256,
          approvedTrustedServiceId: normalized.decision.trustedServiceId,
          expectedHeadRevision:
            normalized.decision.policyAuthority.activationHeadRevision,
          occurredAt: normalized.occurredAt
        })
      );
    if (policyAuthority.kind !== "locked") return policyAuthority;
    validatedPolicyAuthorityHeadRevision = policyAuthority.headRevision;
  }

  const evidenceResult = await lockAndValidateEvidence(
    transaction,
    normalized,
    identity
  );
  if (evidenceResult !== null) return evidenceResult;

  const resultingVersion = incrementClaimVersion(head.latestVersion);
  const mutation = buildCanonicalMutation({
    input: normalized,
    activeClaim,
    resultingVersion,
    validatedPolicyAuthorityHeadRevision
  });

  if (activeClaim !== null) {
    await expectOneRow(
      transaction,
      buildRevokeInboxV2SourceIdentityClaimSql({
        tenantId: normalized.tenantId,
        sourceExternalIdentityId: normalized.sourceExternalIdentityId,
        claimId: activeClaim.id,
        revokedAt: normalized.occurredAt
      }),
      "SourceIdentityClaim revoke"
    );
  }
  if (mutation.claim !== null) {
    await expectOneRow(
      transaction,
      buildInsertInboxV2SourceIdentityClaimSql(mutation.claim),
      "SourceIdentityClaim insert"
    );
    for (const [
      ordinal,
      evidence
    ] of mutation.claim.evidenceReferences.entries()) {
      await expectOneRow(
        transaction,
        buildInsertInboxV2SourceIdentityClaimEvidenceSql({
          claim: mutation.claim,
          evidence: evidence as SupportedClaimEvidenceReference,
          ordinal
        }),
        "SourceIdentityClaim evidence insert"
      );
    }
  }
  await expectOneRow(
    transaction,
    buildInsertInboxV2SourceIdentityClaimTransitionSql(mutation.transition),
    "SourceIdentityClaim transition insert"
  );
  await expectOneRow(
    transaction,
    buildAdvanceInboxV2SourceExternalIdentityRevisionSql({
      tenantId: normalized.tenantId,
      sourceExternalIdentityId: normalized.sourceExternalIdentityId,
      expectedRevision: identity.revision,
      resultingRevision: incrementEntityRevision(identity.revision),
      updatedAt: normalized.occurredAt
    }),
    "SourceExternalIdentity revision advance"
  );
  await expectOneRow(
    transaction,
    buildAdvanceInboxV2SourceIdentityClaimHeadSql({
      tenantId: normalized.tenantId,
      sourceExternalIdentityId: normalized.sourceExternalIdentityId,
      expectedVersion: head.latestVersion,
      resultingVersion,
      activeClaimId: mutation.claim?.id ?? null,
      resolutionStatus: mutation.claim === null ? "unresolved" : "claimed"
    }),
    "SourceIdentityClaim head advance"
  );

  return { kind: "applied", transition: mutation.transition };
}

function activeClaimMatchesStateFence(
  activeClaim: Awaited<ReturnType<typeof lockCurrentClaim>>,
  stateFence: InboxV2AuthorizedSourceIdentityClaimStateFence
): boolean {
  const expected = stateFence.expectedActiveClaim;
  if (expected === null) return activeClaim === null;
  if (activeClaim === null || activeClaim.id !== expected.claimId) return false;
  return expected.target.kind === "employee"
    ? activeClaim.target.kind === "employee" &&
        activeClaim.target.employee.id === expected.target.employeeId
    : activeClaim.target.kind === "client_contact" &&
        activeClaim.target.clientContact.id === expected.target.clientContactId;
}

function mapClaimPersistenceConflictOrThrow(
  normalized: NormalizedInput,
  error: unknown
): ApplyInboxV2SourceIdentityClaimTransitionResult {
  const constraint = findPostgresUniqueConstraint(error);
  if (constraint === "inbox_v2_source_identity_claims_pk") {
    if (normalized.operation.kind === "revoke") throw error;
    return {
      kind: "claim_id_conflict",
      claimId: normalized.operation.claimId
    };
  }
  if (constraint === "inbox_v2_identity_claim_transitions_pk") {
    return {
      kind: "transition_id_conflict",
      transitionId: normalized.transitionId
    };
  }
  throw error;
}

export function buildLockInboxV2SourceIdentityClaimIdentitySql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select
      identity_row.id,
      identity_row.scope_kind,
      identity_row.scope_source_connection_id,
      identity_row.scope_source_account_id,
      identity_row.revision
    from inbox_v2_source_external_identities identity_row
    where identity_row.tenant_id = ${input.tenantId}
      and identity_row.id = ${input.sourceExternalIdentityId}
    for update
  `;
}

export function buildLockInboxV2SourceIdentityClaimHeadSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select
      head_row.resolution_status,
      head_row.active_claim_id,
      head_row.latest_claim_version
    from inbox_v2_source_identity_claim_heads head_row
    where head_row.tenant_id = ${input.tenantId}
      and head_row.source_external_identity_id = ${input.sourceExternalIdentityId}
    for update
  `;
}

export function buildLockCurrentInboxV2SourceIdentityClaimSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  claimId: InboxV2SourceIdentityClaimId;
}): SQL {
  return sql`
    select
      claim_row.id,
      claim_row.source_external_identity_id,
      claim_row.claim_version,
      claim_row.target_kind,
      claim_row.target_employee_id,
      claim_row.target_client_contact_id,
      claim_row.status
    from inbox_v2_source_identity_claims claim_row
    where claim_row.tenant_id = ${input.tenantId}
      and claim_row.source_external_identity_id = ${input.sourceExternalIdentityId}
      and claim_row.id = ${input.claimId}
    for update
  `;
}

export function buildLockInboxV2SourceIdentityClaimEmployeesSql(input: {
  tenantId: InboxV2TenantId;
  employeeIds: readonly InboxV2EmployeeId[];
}): SQL {
  requireNonEmpty(input.employeeIds, "Employee IDs");
  return sql`
    select employee_row.id, employee_row.deactivated_at
    from employees employee_row
    where employee_row.tenant_id = ${input.tenantId}
      and employee_row.id in (${sqlList(input.employeeIds)})
    order by employee_row.id collate "C"
    for no key update
  `;
}

export function buildLockInboxV2SourceIdentityClaimClientContactsSql(input: {
  tenantId: InboxV2TenantId;
  clientContactIds: readonly InboxV2ClientContactId[];
}): SQL {
  requireNonEmpty(input.clientContactIds, "ClientContact IDs");
  return sql`
    select contact_row.id
    from client_contacts contact_row
    where contact_row.tenant_id = ${input.tenantId}
      and contact_row.id in (${sqlList(input.clientContactIds)})
    order by contact_row.id collate "C"
    for no key update
  `;
}

export function buildLockInboxV2SourceIdentityClaimRawEvidenceSql(input: {
  tenantId: InboxV2TenantId;
  eventIds: readonly string[];
}): SQL {
  requireNonEmpty(input.eventIds, "raw evidence IDs");
  return sql`
    select event_row.id, event_row.source_connection_id, event_row.source_account_id
    from raw_inbound_events event_row
    where event_row.tenant_id = ${input.tenantId}
      and event_row.id in (${sqlList(input.eventIds)})
    order by event_row.id collate "C"
    for key share
  `;
}

export function buildLockInboxV2SourceIdentityClaimNormalizedEvidenceSql(input: {
  tenantId: InboxV2TenantId;
  eventIds: readonly string[];
}): SQL {
  requireNonEmpty(input.eventIds, "normalized evidence IDs");
  return sql`
    select event_row.id, event_row.source_connection_id, event_row.source_account_id
    from normalized_inbound_events event_row
    where event_row.tenant_id = ${input.tenantId}
      and event_row.id in (${sqlList(input.eventIds)})
    order by event_row.id collate "C"
    for key share
  `;
}

export function buildLockInboxV2SourceIdentityClaimOccurrenceEvidenceSql(input: {
  tenantId: InboxV2TenantId;
  occurrenceIds: readonly string[];
}): SQL {
  requireNonEmpty(input.occurrenceIds, "source occurrence evidence IDs");
  return sql`
    select
      occurrence_row.id,
      occurrence_row.source_connection_id,
      occurrence_row.source_account_id,
      occurrence_row.raw_inbound_event_id,
      occurrence_row.normalized_inbound_event_id,
      occurrence_row.provider_actor_source_external_identity_id
    from inbox_v2_source_occurrences occurrence_row
    where occurrence_row.tenant_id = ${input.tenantId}
      and occurrence_row.id in (${sqlList(input.occurrenceIds)})
    order by occurrence_row.id collate "C"
    for key share
  `;
}

export function buildLockInboxV2SourceIdentityClaimRosterEvidenceSql(input: {
  tenantId: InboxV2TenantId;
  rosterEvidenceIds: readonly string[];
}): SQL {
  requireNonEmpty(input.rosterEvidenceIds, "provider roster evidence IDs");
  return sql`
    select
      roster_row.id,
      roster_row.source_connection_id,
      roster_row.source_account_id,
      roster_row.raw_inbound_event_id,
      roster_row.normalized_inbound_event_id
    from inbox_v2_provider_roster_evidence roster_row
    where roster_row.tenant_id = ${input.tenantId}
      and roster_row.id in (${sqlList(input.rosterEvidenceIds)})
    order by roster_row.id collate "C"
    for key share
  `;
}

export function buildLockInboxV2SourceIdentityClaimRosterMembersSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  rosterEvidenceIds: readonly string[];
}): SQL {
  requireNonEmpty(
    input.rosterEvidenceIds,
    "provider roster member evidence IDs"
  );
  return sql`
    select
      member_row.roster_evidence_id,
      member_row.source_external_identity_id
    from inbox_v2_provider_roster_member_evidence member_row
    where member_row.tenant_id = ${input.tenantId}
      and member_row.roster_evidence_id in (${sqlList(input.rosterEvidenceIds)})
      and member_row.source_external_identity_id =
        ${input.sourceExternalIdentityId}
    order by
      member_row.roster_evidence_id collate "C",
      member_row.source_external_identity_id collate "C"
    for key share
  `;
}

export function buildInsertInboxV2SourceIdentityClaimSql(
  claim: InboxV2SourceIdentityClaim
): SQL {
  const target = targetColumns(claim.target);
  const decision = decisionColumns(claim.decision);
  return sql`
    insert into inbox_v2_source_identity_claims (
      tenant_id, id, source_external_identity_id,
      previous_claim_version, claim_version,
      target_kind, target_employee_id, target_client_contact_id,
      status, confidence,
      policy_id, policy_version, reason_code_id,
      decision_kind, decision_actor_employee_id,
      decision_trusted_service_id,
      policy_family, policy_definition_contract_version,
      policy_definition_digest_sha256, policy_activation_head_revision,
      created_at, revoked_at, revision
    ) values (
      ${claim.tenantId}, ${claim.id}, ${claim.sourceExternalIdentity.id},
      ${claim.previousClaimVersion}, ${claim.claimVersion},
      ${target.kind}, ${target.employeeId}, ${target.clientContactId},
      'active', ${claim.confidence},
      ${claim.policyId}, ${claim.policyVersion}, ${claim.reasonCodeId},
      ${decision.kind}, ${decision.employeeId}, ${decision.trustedServiceId},
      ${decision.policyFamily}, ${decision.definitionContractVersion},
      ${decision.definitionDigestSha256}, ${decision.activationHeadRevision},
      ${claim.createdAt}, null, 1
    )
    returning id
  `;
}

export function buildInsertInboxV2SourceIdentityClaimEvidenceSql(input: {
  claim: InboxV2SourceIdentityClaim;
  evidence: SupportedClaimEvidenceReference;
  ordinal: number;
}): SQL {
  const rawEventId =
    input.evidence.kind === "raw_inbound_event"
      ? input.evidence.reference.id
      : null;
  const normalizedEventId =
    input.evidence.kind === "normalized_inbound_event"
      ? input.evidence.reference.id
      : null;
  const sourceOccurrenceId =
    input.evidence.kind === "source_occurrence"
      ? input.evidence.reference.id
      : null;
  const providerRosterEvidenceId =
    input.evidence.kind === "provider_roster_evidence"
      ? input.evidence.reference.id
      : null;
  return sql`
    insert into inbox_v2_source_identity_claim_evidence_references (
      tenant_id, claim_id, source_external_identity_id, claim_version,
      ordinal, evidence_kind,
      raw_inbound_event_id, normalized_inbound_event_id,
      source_occurrence_id, provider_roster_evidence_id
    ) values (
      ${input.claim.tenantId}, ${input.claim.id},
      ${input.claim.sourceExternalIdentity.id}, ${input.claim.claimVersion},
      ${input.ordinal}, ${input.evidence.kind},
      ${rawEventId}, ${normalizedEventId},
      ${sourceOccurrenceId}, ${providerRosterEvidenceId}
    )
    returning claim_id as id
  `;
}

export function buildRevokeInboxV2SourceIdentityClaimSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  claimId: InboxV2SourceIdentityClaimId;
  revokedAt: string;
}): SQL {
  return sql`
    update inbox_v2_source_identity_claims
    set status = 'revoked', revoked_at = ${input.revokedAt}, revision = 2
    where tenant_id = ${input.tenantId}
      and source_external_identity_id = ${input.sourceExternalIdentityId}
      and id = ${input.claimId}
      and status = 'active'
      and revision = 1
    returning id
  `;
}

export function buildInsertInboxV2SourceIdentityClaimTransitionSql(
  transition: InboxV2SourceIdentityClaimTransition
): SQL {
  const operation = transitionColumns(transition);
  const decision = decisionColumns(transition.decision);
  return sql`
    insert into inbox_v2_source_identity_claim_transitions (
      tenant_id, id, source_external_identity_id,
      operation_kind,
      target_kind, target_employee_id, target_client_contact_id,
      previous_claim_id, previous_target_kind,
      previous_target_employee_id, previous_target_client_contact_id,
      resulting_claim_id, active_claim_id,
      decision_kind, decision_actor_employee_id,
      decision_trusted_service_id,
      policy_family, policy_definition_contract_version,
      policy_definition_digest_sha256, policy_activation_head_revision,
      policy_id, policy_version, reason_code_id,
      expected_version, current_version, resulting_version, occurred_at
    ) values (
      ${transition.tenantId}, ${transition.id},
      ${transition.sourceExternalIdentity.id},
      ${transition.operation.kind},
      ${operation.target.kind}, ${operation.target.employeeId},
      ${operation.target.clientContactId},
      ${operation.previousClaimId}, ${operation.previousTarget?.kind ?? null},
      ${operation.previousTarget?.employeeId ?? null},
      ${operation.previousTarget?.clientContactId ?? null},
      ${operation.resultingClaimId}, ${operation.activeClaimId},
      ${decision.kind}, ${decision.employeeId}, ${decision.trustedServiceId},
      ${decision.policyFamily}, ${decision.definitionContractVersion},
      ${decision.definitionDigestSha256}, ${decision.activationHeadRevision},
      ${transition.policyId}, ${transition.policyVersion},
      ${transition.reasonCodeId}, ${transition.expectedVersion},
      ${transition.currentVersion}, ${transition.resultingVersion},
      ${transition.occurredAt}
    )
    returning id
  `;
}

export function buildAdvanceInboxV2SourceExternalIdentityRevisionSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  expectedRevision: InboxV2EntityRevision;
  resultingRevision: InboxV2EntityRevision;
  updatedAt: string;
}): SQL {
  return sql`
    update inbox_v2_source_external_identities
    set revision = ${input.resultingRevision}, updated_at = ${input.updatedAt}
    where tenant_id = ${input.tenantId}
      and id = ${input.sourceExternalIdentityId}
      and revision = ${input.expectedRevision}
    returning id
  `;
}

export function buildAdvanceInboxV2SourceIdentityClaimHeadSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  expectedVersion: InboxV2SourceIdentityClaimVersion | null;
  resultingVersion: InboxV2SourceIdentityClaimVersion;
  resolutionStatus: "unresolved" | "claimed";
  activeClaimId: InboxV2SourceIdentityClaimId | null;
}): SQL {
  return sql`
    update inbox_v2_source_identity_claim_heads
    set resolution_status = ${input.resolutionStatus},
        active_claim_id = ${input.activeClaimId},
        latest_claim_version = ${input.resultingVersion}
    where tenant_id = ${input.tenantId}
      and source_external_identity_id = ${input.sourceExternalIdentityId}
      and latest_claim_version is not distinct from ${input.expectedVersion}
    returning source_external_identity_id as id
  `;
}

export function buildFindInboxV2SourceIdentityClaimByIdSql(input: {
  tenantId: InboxV2TenantId;
  claimId: InboxV2SourceIdentityClaimId;
}): SQL {
  return sql`
    select
      claim_row.tenant_id,
      claim_row.id,
      claim_row.source_external_identity_id,
      claim_row.previous_claim_version,
      claim_row.claim_version,
      claim_row.target_kind,
      claim_row.target_employee_id,
      claim_row.target_client_contact_id,
      claim_row.status,
      claim_row.confidence,
      claim_row.policy_id,
      claim_row.policy_version,
      claim_row.reason_code_id,
      claim_row.decision_kind,
      claim_row.decision_actor_employee_id,
      claim_row.decision_trusted_service_id,
      claim_row.policy_family,
      claim_row.policy_definition_contract_version,
      claim_row.policy_definition_digest_sha256,
      claim_row.policy_activation_head_revision,
      claim_row.created_at,
      claim_row.revoked_at,
      claim_row.revision,
      evidence_row.ordinal as evidence_ordinal,
      evidence_row.evidence_kind,
      evidence_row.raw_inbound_event_id,
      evidence_row.normalized_inbound_event_id,
      evidence_row.source_occurrence_id,
      evidence_row.provider_roster_evidence_id
    from inbox_v2_source_identity_claims claim_row
    left join inbox_v2_source_identity_claim_evidence_references evidence_row
      on evidence_row.tenant_id = claim_row.tenant_id
     and evidence_row.claim_id = claim_row.id
     and evidence_row.source_external_identity_id =
       claim_row.source_external_identity_id
     and evidence_row.claim_version = claim_row.claim_version
    where claim_row.tenant_id = ${input.tenantId}
      and claim_row.id = ${input.claimId}
    order by evidence_row.ordinal
  `;
}

export function buildListInboxV2SourceIdentityClaimHistorySql(
  input: ListInboxV2SourceIdentityClaimHistoryInput
): SQL {
  const cursor =
    input.afterVersion === null
      ? sql``
      : sql`and claim_row.claim_version > ${input.afterVersion}`;
  return sql`
    with claim_page as materialized (
      select claim_row.*
      from inbox_v2_source_identity_claims claim_row
      where claim_row.tenant_id = ${input.tenantId}
        and claim_row.source_external_identity_id =
          ${input.sourceExternalIdentityId}
        ${cursor}
      order by claim_row.claim_version
      limit ${input.limit}
    )
    select
      claim_row.tenant_id,
      claim_row.id,
      claim_row.source_external_identity_id,
      claim_row.previous_claim_version,
      claim_row.claim_version,
      claim_row.target_kind,
      claim_row.target_employee_id,
      claim_row.target_client_contact_id,
      claim_row.status,
      claim_row.confidence,
      claim_row.policy_id,
      claim_row.policy_version,
      claim_row.reason_code_id,
      claim_row.decision_kind,
      claim_row.decision_actor_employee_id,
      claim_row.decision_trusted_service_id,
      claim_row.policy_family,
      claim_row.policy_definition_contract_version,
      claim_row.policy_definition_digest_sha256,
      claim_row.policy_activation_head_revision,
      claim_row.created_at,
      claim_row.revoked_at,
      claim_row.revision,
      evidence_row.ordinal as evidence_ordinal,
      evidence_row.evidence_kind,
      evidence_row.raw_inbound_event_id,
      evidence_row.normalized_inbound_event_id,
      evidence_row.source_occurrence_id,
      evidence_row.provider_roster_evidence_id
    from claim_page claim_row
    left join inbox_v2_source_identity_claim_evidence_references evidence_row
      on evidence_row.tenant_id = claim_row.tenant_id
     and evidence_row.claim_id = claim_row.id
     and evidence_row.source_external_identity_id =
       claim_row.source_external_identity_id
     and evidence_row.claim_version = claim_row.claim_version
    order by claim_row.claim_version, evidence_row.ordinal
  `;
}

async function lockIdentity(
  executor: RawSqlExecutor,
  input: NormalizedInput
): Promise<{
  scopeKind: "provider" | "source_connection" | "source_account";
  sourceConnectionId: string | null;
  sourceAccountId: string | null;
  revision: InboxV2EntityRevision;
} | null> {
  const result = await executor.execute<IdentityLockRow>(
    buildLockInboxV2SourceIdentityClaimIdentitySql(input)
  );
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw invariantError(
      "SourceIdentityClaim identity lock returned multiple rows."
    );
  }
  const row = result.rows[0];
  const scopeKind = row?.scope_kind;
  const sourceConnectionId = nullableString(row?.scope_source_connection_id);
  const sourceAccountId = nullableString(row?.scope_source_account_id);
  if (
    (scopeKind === "provider" &&
      (sourceConnectionId !== null || sourceAccountId !== null)) ||
    (scopeKind === "source_connection" &&
      (sourceConnectionId === null || sourceAccountId !== null)) ||
    (scopeKind === "source_account" &&
      (sourceConnectionId !== null || sourceAccountId === null)) ||
    !["provider", "source_connection", "source_account"].includes(
      String(scopeKind)
    )
  ) {
    throw invariantError(
      "SourceIdentityClaim identity lock has invalid scope."
    );
  }
  return {
    scopeKind: scopeKind as "provider" | "source_connection" | "source_account",
    sourceConnectionId,
    sourceAccountId,
    revision: parseEntityRevision(
      row?.revision,
      "SourceExternalIdentity revision"
    )
  };
}

async function lockHead(
  executor: RawSqlExecutor,
  input: NormalizedInput
): Promise<{
  resolutionStatus: ClaimResolutionStatus;
  activeClaimId: InboxV2SourceIdentityClaimId | null;
  latestVersion: InboxV2SourceIdentityClaimVersion | null;
}> {
  const result = await executor.execute<HeadLockRow>(
    buildLockInboxV2SourceIdentityClaimHeadSql(input)
  );
  if (result.rows.length !== 1) {
    throw invariantError(
      "SourceExternalIdentity exists without exactly one mandatory claim head."
    );
  }
  const row = result.rows[0];
  const status = row?.resolution_status;
  if (!["unresolved", "claimed", "conflicted"].includes(String(status))) {
    throw invariantError(
      "SourceIdentityClaim head has invalid resolution status."
    );
  }
  const activeClaimId =
    row?.active_claim_id === null
      ? null
      : parseClaimId(
          row?.active_claim_id,
          "SourceIdentityClaim head active claim"
        );
  const latestVersion = parseNullableClaimVersion(
    row?.latest_claim_version,
    "SourceIdentityClaim head latest version"
  );
  if (
    (status === "claimed" &&
      (activeClaimId === null || latestVersion === null)) ||
    (status !== "claimed" && activeClaimId !== null) ||
    (status === "conflicted" && latestVersion === null)
  ) {
    throw invariantError("SourceIdentityClaim head has an incoherent shape.");
  }
  return {
    resolutionStatus: status as ClaimResolutionStatus,
    activeClaimId,
    latestVersion
  };
}

async function lockCurrentClaim(
  executor: RawSqlExecutor,
  input: NormalizedInput,
  head: Awaited<ReturnType<typeof lockHead>>
): Promise<{
  id: InboxV2SourceIdentityClaimId;
  claimVersion: InboxV2SourceIdentityClaimVersion;
  target: InboxV2SourceIdentityClaimTarget;
} | null> {
  if (head.activeClaimId === null) return null;
  const result = await executor.execute<CurrentClaimRow>(
    buildLockCurrentInboxV2SourceIdentityClaimSql({
      tenantId: input.tenantId,
      sourceExternalIdentityId: input.sourceExternalIdentityId,
      claimId: head.activeClaimId
    })
  );
  if (result.rows.length !== 1) {
    throw invariantError(
      "Claimed identity head does not resolve to one claim."
    );
  }
  const row = result.rows[0];
  const claimVersion = parseClaimVersion(
    row?.claim_version,
    "active SourceIdentityClaim version"
  );
  if (
    row?.source_external_identity_id !== input.sourceExternalIdentityId ||
    row?.status !== "active" ||
    claimVersion !== head.latestVersion
  ) {
    throw invariantError(
      "Claimed identity head points to an incoherent claim."
    );
  }
  return {
    id: parseClaimId(row?.id, "active SourceIdentityClaim ID"),
    claimVersion,
    target: mapTargetFromCurrentRow(row, input.tenantId)
  };
}

async function lockAndValidateTargets(
  executor: RawSqlExecutor,
  input: NormalizedInput,
  activeClaim: Awaited<ReturnType<typeof lockCurrentClaim>>
): Promise<ApplyInboxV2SourceIdentityClaimTransitionResult | null> {
  const employeeIds = uniqueSorted([
    ...(input.decision.kind === "manual"
      ? [input.decision.actorEmployee.id]
      : []),
    ...(input.operation.kind === "claim_employee"
      ? [input.operation.employeeId]
      : []),
    ...(activeClaim?.target.kind === "employee"
      ? [activeClaim.target.employee.id]
      : [])
  ]).map((id) => inboxV2EmployeeIdSchema.parse(id));
  const clientContactIds = uniqueSorted([
    ...(input.operation.kind === "claim_client_contact"
      ? [input.operation.clientContactId]
      : []),
    ...(activeClaim?.target.kind === "client_contact"
      ? [activeClaim.target.clientContact.id]
      : [])
  ]).map((id) => inboxV2ClientContactIdSchema.parse(id));

  const employeeRows =
    employeeIds.length === 0
      ? []
      : (
          await executor.execute<EmployeeLockRow>(
            buildLockInboxV2SourceIdentityClaimEmployeesSql({
              tenantId: input.tenantId,
              employeeIds
            })
          )
        ).rows;
  const contactRows =
    clientContactIds.length === 0
      ? []
      : (
          await executor.execute<ClientContactLockRow>(
            buildLockInboxV2SourceIdentityClaimClientContactsSql({
              tenantId: input.tenantId,
              clientContactIds
            })
          )
        ).rows;
  const employeesById = new Map(
    employeeRows.map((row) => [
      inboxV2EmployeeIdSchema.parse(row.id),
      row.deactivated_at
    ])
  );
  const contacts = new Set(
    contactRows.map((row) => inboxV2ClientContactIdSchema.parse(row.id))
  );

  if (input.decision.kind === "manual") {
    const actorId = input.decision.actorEmployee.id;
    if (!employeesById.has(actorId)) {
      return { kind: "actor_not_found", employeeId: actorId };
    }
    if (employeesById.get(actorId) !== null) {
      return { kind: "actor_inactive", employeeId: actorId };
    }
  }
  if (input.operation.kind === "claim_employee") {
    const targetId = input.operation.employeeId;
    if (!employeesById.has(targetId)) {
      return {
        kind: "target_not_found",
        targetKind: "employee",
        targetId
      };
    }
    if (employeesById.get(targetId) !== null) {
      return { kind: "target_inactive", employeeId: targetId };
    }
  }
  if (
    input.operation.kind === "claim_client_contact" &&
    !contacts.has(input.operation.clientContactId)
  ) {
    return {
      kind: "target_not_found",
      targetKind: "client_contact",
      targetId: input.operation.clientContactId
    };
  }

  if (
    activeClaim?.target.kind === "employee" &&
    !employeesById.has(activeClaim.target.employee.id)
  ) {
    throw invariantError("Active claim Employee target is missing.");
  }
  if (
    activeClaim?.target.kind === "client_contact" &&
    !contacts.has(activeClaim.target.clientContact.id)
  ) {
    throw invariantError("Active claim ClientContact target is missing.");
  }
  return null;
}

async function lockAndValidateEvidence(
  executor: RawSqlExecutor,
  input: NormalizedInput,
  identity: Awaited<ReturnType<typeof lockIdentity>> & object
): Promise<ApplyInboxV2SourceIdentityClaimTransitionResult | null> {
  if (input.operation.kind === "revoke") return null;
  const evidence = input.operation.evidenceReferences;
  const rawIds = uniqueSorted(
    evidence
      .filter((item) => item.kind === "raw_inbound_event")
      .map((item) => item.reference.id)
  );
  const occurrenceIds = uniqueSorted(
    evidence
      .filter((item) => item.kind === "source_occurrence")
      .map((item) => item.reference.id)
  );
  const rosterEvidenceIds = uniqueSorted(
    evidence
      .filter((item) => item.kind === "provider_roster_evidence")
      .map((item) => item.reference.id)
  );
  const normalizedIds = uniqueSorted(
    evidence
      .filter((item) => item.kind === "normalized_inbound_event")
      .map((item) => item.reference.id)
  );
  const rawRows =
    rawIds.length === 0
      ? []
      : (
          await executor.execute<EventLockRow>(
            buildLockInboxV2SourceIdentityClaimRawEvidenceSql({
              tenantId: input.tenantId,
              eventIds: rawIds
            })
          )
        ).rows;
  const normalizedRows =
    normalizedIds.length === 0
      ? []
      : (
          await executor.execute<EventLockRow>(
            buildLockInboxV2SourceIdentityClaimNormalizedEvidenceSql({
              tenantId: input.tenantId,
              eventIds: normalizedIds
            })
          )
        ).rows;
  const occurrenceRows =
    occurrenceIds.length === 0
      ? []
      : (
          await executor.execute<OccurrenceLockRow>(
            buildLockInboxV2SourceIdentityClaimOccurrenceEvidenceSql({
              tenantId: input.tenantId,
              occurrenceIds
            })
          )
        ).rows;
  const rosterRows =
    rosterEvidenceIds.length === 0
      ? []
      : (
          await executor.execute<RosterLockRow>(
            buildLockInboxV2SourceIdentityClaimRosterEvidenceSql({
              tenantId: input.tenantId,
              rosterEvidenceIds
            })
          )
        ).rows;
  const rosterMemberRows =
    rosterEvidenceIds.length === 0
      ? []
      : (
          await executor.execute<RosterMemberLockRow>(
            buildLockInboxV2SourceIdentityClaimRosterMembersSql({
              tenantId: input.tenantId,
              sourceExternalIdentityId: input.sourceExternalIdentityId,
              rosterEvidenceIds
            })
          )
        ).rows;
  const rawById = indexEventRows(rawRows);
  const normalizedById = indexEventRows(normalizedRows);
  const occurrenceById = indexAnchoredEvidenceRows(occurrenceRows, true);
  const rosterById = indexAnchoredEvidenceRows(rosterRows, false);
  const rosterMembership = indexRosterMembershipRows(rosterMemberRows);
  const providerRawAnchors = new Set<string>();
  const providerNormalizedAnchors = new Set<string>();
  let hasExactProviderActorProof = false;

  for (const item of evidence) {
    if (
      item.kind === "raw_inbound_event" ||
      item.kind === "normalized_inbound_event"
    ) {
      continue;
    }
    const row =
      item.kind === "source_occurrence"
        ? occurrenceById.get(String(item.reference.id))
        : rosterById.get(String(item.reference.id));
    if (row === undefined) {
      return { kind: "evidence_not_found", evidence: item };
    }
    if (
      (item.kind === "source_occurrence" &&
        row.sourceExternalIdentityId !== input.sourceExternalIdentityId) ||
      (item.kind === "provider_roster_evidence" &&
        !rosterMembership.has(String(item.reference.id))) ||
      !evidenceMatchesIdentityScope(row, identity)
    ) {
      return { kind: "evidence_scope_conflict", evidence: item };
    }
    hasExactProviderActorProof = true;
    if (row.rawInboundEventId !== null) {
      providerRawAnchors.add(row.rawInboundEventId);
    }
    if (row.normalizedInboundEventId !== null) {
      providerNormalizedAnchors.add(row.normalizedInboundEventId);
    }
  }

  for (const item of evidence) {
    if (
      item.kind !== "raw_inbound_event" &&
      item.kind !== "normalized_inbound_event"
    ) {
      continue;
    }
    const evidenceId = String(item.reference.id);
    const row =
      item.kind === "raw_inbound_event"
        ? rawById.get(evidenceId)
        : normalizedById.get(evidenceId);
    if (row === undefined) {
      return { kind: "evidence_not_found", evidence: item };
    }
    if (
      !evidenceMatchesIdentityScope(row, identity) ||
      (identity.scopeKind === "provider" &&
        !(item.kind === "raw_inbound_event"
          ? providerRawAnchors.has(evidenceId)
          : providerNormalizedAnchors.has(evidenceId)))
    ) {
      return { kind: "evidence_scope_conflict", evidence: item };
    }
  }
  if (identity.scopeKind === "provider" && !hasExactProviderActorProof) {
    return {
      kind: "evidence_scope_conflict",
      evidence: evidence[0] as ClaimEvidenceReference
    };
  }
  return null;
}

function buildCanonicalMutation(input: {
  input: NormalizedInput;
  activeClaim: Awaited<ReturnType<typeof lockCurrentClaim>>;
  resultingVersion: InboxV2SourceIdentityClaimVersion;
  validatedPolicyAuthorityHeadRevision: InboxV2EntityRevision | null;
}): {
  claim: InboxV2SourceIdentityClaim | null;
  transition: InboxV2SourceIdentityClaimTransition;
} {
  const identityReference = {
    tenantId: input.input.tenantId,
    kind: "source_external_identity" as const,
    id: input.input.sourceExternalIdentityId
  };
  const previousClaim =
    input.activeClaim === null
      ? null
      : {
          claim: {
            tenantId: input.input.tenantId,
            kind: "source_identity_claim" as const,
            id: input.activeClaim.id
          },
          target: input.activeClaim.target
        };
  const decision = decisionWithValidatedPolicyAuthority(
    input.input.decision,
    input.validatedPolicyAuthorityHeadRevision
  );

  if (input.input.operation.kind === "revoke") {
    if (input.activeClaim === null) {
      throw invariantError("Revoke mutation lost its active claim.");
    }
    return {
      claim: null,
      transition: inboxV2SourceIdentityClaimTransitionSchema.parse({
        tenantId: input.input.tenantId,
        id: input.input.transitionId,
        sourceExternalIdentity: identityReference,
        operation: {
          kind: "revoke",
          activeClaim: previousClaim?.claim,
          target: input.activeClaim.target
        },
        decision,
        policyId: input.input.policyId,
        policyVersion: input.input.policyVersion,
        reasonCodeId: input.input.reasonCodeId,
        expectedVersion: input.input.expectedVersion,
        currentVersion: input.input.expectedVersion,
        resultingVersion: input.resultingVersion,
        occurredAt: input.input.occurredAt
      })
    };
  }

  const target = operationTarget(input.input.operation, input.input.tenantId);
  const claim = inboxV2SourceIdentityClaimSchema.parse({
    tenantId: input.input.tenantId,
    id: input.input.operation.claimId,
    sourceExternalIdentity: identityReference,
    previousClaimVersion: input.input.expectedVersion,
    claimVersion: input.resultingVersion,
    target,
    status: "active",
    confidence: input.input.operation.confidence,
    evidenceReferences: input.input.operation.evidenceReferences,
    policyId: input.input.policyId,
    policyVersion: input.input.policyVersion,
    reasonCodeId: input.input.reasonCodeId,
    decision,
    createdAt: input.input.occurredAt,
    revocation: null,
    revision: "1"
  });
  return {
    claim,
    transition: inboxV2SourceIdentityClaimTransitionSchema.parse({
      tenantId: input.input.tenantId,
      id: input.input.transitionId,
      sourceExternalIdentity: identityReference,
      operation: {
        kind: input.input.operation.kind,
        target,
        previousClaim,
        resultingClaim: {
          tenantId: input.input.tenantId,
          kind: "source_identity_claim",
          id: claim.id
        }
      },
      decision,
      policyId: input.input.policyId,
      policyVersion: input.input.policyVersion,
      reasonCodeId: input.input.reasonCodeId,
      expectedVersion: input.input.expectedVersion,
      currentVersion: input.input.expectedVersion,
      resultingVersion: input.resultingVersion,
      occurredAt: input.input.occurredAt
    })
  };
}

function decisionWithValidatedPolicyAuthority(
  decision: ClaimDecision,
  validatedHeadRevision: InboxV2EntityRevision | null
): ClaimDecision {
  if (decision.kind !== "automatic_policy") {
    if (validatedHeadRevision !== null) {
      throw invariantError(
        "Non-automatic SourceIdentityClaim decision received policy authority."
      );
    }
    return decision;
  }
  if (validatedHeadRevision === null) {
    throw invariantError(
      "Automatic SourceIdentityClaim decision lost its policy authority."
    );
  }
  return {
    ...decision,
    policyAuthority: {
      ...decision.policyAuthority,
      activationHeadRevision: validatedHeadRevision
    }
  };
}

function normalizeApplyInput(
  input: ApplyInboxV2SourceIdentityClaimTransitionInput
): NormalizedInput {
  assertExactKeys(input, APPLY_KEYS, "SourceIdentityClaim apply input");
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const sourceExternalIdentityId = inboxV2SourceExternalIdentityIdSchema.parse(
    input.sourceExternalIdentityId
  );
  const transitionId = inboxV2SourceIdentityClaimTransitionIdSchema.parse(
    input.transitionId
  );
  const expectedVersion =
    input.expectedVersion === null
      ? null
      : inboxV2SourceIdentityClaimVersionSchema.parse(input.expectedVersion);
  const decision = inboxV2SourceIdentityClaimDecisionSchema.parse(
    input.decision
  );
  return {
    tenantId,
    sourceExternalIdentityId,
    transitionId,
    expectedVersion,
    operation: normalizeOperation(input.operation, tenantId),
    decision,
    policyId: inboxV2IdentityClaimPolicyIdSchema.parse(input.policyId),
    policyVersion: input.policyVersion,
    reasonCodeId: inboxV2IdentityClaimReasonIdSchema.parse(input.reasonCodeId),
    occurredAt: inboxV2TimestampSchema.parse(input.occurredAt)
  };
}

function normalizeAuthorizedStateFence(
  input: InboxV2AuthorizedSourceIdentityClaimStateFence,
  transition: NormalizedInput
): InboxV2AuthorizedSourceIdentityClaimStateFence {
  assertExactKeys(
    input,
    new Set(["authorizationDecisionId", "expectedActiveClaim"]),
    "authorized SourceIdentityClaim state fence"
  );
  if (
    typeof input.authorizationDecisionId !== "string" ||
    input.authorizationDecisionId.length === 0 ||
    input.authorizationDecisionId.length > 256
  ) {
    throw new CoreError("permission.denied");
  }
  if (input.expectedActiveClaim === null) {
    return {
      authorizationDecisionId: input.authorizationDecisionId,
      expectedActiveClaim: null
    };
  }
  if (transition.expectedVersion === null) {
    throw new CoreError("permission.denied");
  }
  assertExactKeys(
    input.expectedActiveClaim,
    new Set(["claimId", "target"]),
    "authorized SourceIdentityClaim active-state fence"
  );
  const claimId = inboxV2SourceIdentityClaimIdSchema.parse(
    input.expectedActiveClaim.claimId
  );
  const target = input.expectedActiveClaim.target;
  if (target.kind === "employee") {
    assertExactKeys(
      target,
      new Set(["kind", "employeeId"]),
      "authorized SourceIdentityClaim Employee target fence"
    );
    return {
      authorizationDecisionId: input.authorizationDecisionId,
      expectedActiveClaim: {
        claimId,
        target: {
          kind: "employee",
          employeeId: inboxV2EmployeeIdSchema.parse(target.employeeId)
        }
      }
    };
  }
  if (target.kind === "client_contact") {
    assertExactKeys(
      target,
      new Set(["kind", "clientContactId"]),
      "authorized SourceIdentityClaim ClientContact target fence"
    );
    return {
      authorizationDecisionId: input.authorizationDecisionId,
      expectedActiveClaim: {
        claimId,
        target: {
          kind: "client_contact",
          clientContactId: inboxV2ClientContactIdSchema.parse(
            target.clientContactId
          )
        }
      }
    };
  }
  throw new CoreError("permission.denied");
}

function normalizeOperation(
  operation: InboxV2SourceIdentityClaimMutationOperation,
  tenantId: InboxV2TenantId
): NormalizedOperation {
  if (operation.kind === "revoke") {
    assertExactKeys(operation, new Set(["kind"]), "claim revoke operation");
    return { kind: "revoke" };
  }
  const commonKeys = new Set([
    "kind",
    "claimId",
    operation.kind === "claim_employee" ? "employeeId" : "clientContactId",
    "confidence",
    "evidenceReferences"
  ]);
  assertExactKeys(operation, commonKeys, "claim creation operation");
  if (
    !Array.isArray(operation.evidenceReferences) ||
    operation.evidenceReferences.length < 1 ||
    operation.evidenceReferences.length > 50
  ) {
    throw new CoreError(
      "validation.failed",
      "SourceIdentityClaim requires between 1 and 50 evidence references."
    );
  }
  const evidenceReferences = operation.evidenceReferences.map((reference) => {
    const parsed =
      inboxV2SourceIdentityClaimEvidenceReferenceSchema.parse(reference);
    if (parsed.reference.tenantId !== tenantId) {
      throw new CoreError("tenant.boundary_violation");
    }
    return parsed;
  });
  const common = {
    claimId: inboxV2SourceIdentityClaimIdSchema.parse(operation.claimId),
    confidence: inboxV2SourceIdentityClaimConfidenceSchema.parse(
      operation.confidence
    ),
    evidenceReferences
  };
  return operation.kind === "claim_employee"
    ? {
        kind: "claim_employee",
        ...common,
        employeeId: inboxV2EmployeeIdSchema.parse(operation.employeeId)
      }
    : {
        kind: "claim_client_contact",
        ...common,
        clientContactId: inboxV2ClientContactIdSchema.parse(
          operation.clientContactId
        )
      };
}

function normalizeHistoryInput(
  input: ListInboxV2SourceIdentityClaimHistoryInput
): ListInboxV2SourceIdentityClaimHistoryInput {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > HISTORY_PAGE_MAX
  ) {
    throw new CoreError(
      "validation.failed",
      `SourceIdentityClaim history limit must be between 1 and ${HISTORY_PAGE_MAX}.`
    );
  }
  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    sourceExternalIdentityId: inboxV2SourceExternalIdentityIdSchema.parse(
      input.sourceExternalIdentityId
    ),
    afterVersion:
      input.afterVersion === null
        ? null
        : inboxV2SourceIdentityClaimVersionSchema.parse(input.afterVersion),
    limit: input.limit
  };
}

function isManualSelfClaim(input: NormalizedInput): boolean {
  return (
    input.decision.kind === "manual" &&
    input.operation.kind === "claim_employee" &&
    input.decision.actorEmployee.id === input.operation.employeeId
  );
}

function operationTarget(
  operation: Exclude<NormalizedOperation, { kind: "revoke" }>,
  tenantId: InboxV2TenantId
): InboxV2SourceIdentityClaimTarget {
  return operation.kind === "claim_employee"
    ? {
        kind: "employee",
        employee: {
          tenantId,
          kind: "employee",
          id: operation.employeeId
        }
      }
    : {
        kind: "client_contact",
        clientContact: {
          tenantId,
          kind: "client_contact",
          id: operation.clientContactId
        }
      };
}

function targetColumns(target: InboxV2SourceIdentityClaimTarget): {
  kind: "employee" | "client_contact";
  employeeId: string | null;
  clientContactId: string | null;
} {
  return target.kind === "employee"
    ? {
        kind: "employee",
        employeeId: target.employee.id,
        clientContactId: null
      }
    : {
        kind: "client_contact",
        employeeId: null,
        clientContactId: target.clientContact.id
      };
}

function decisionColumns(decision: ClaimDecision): {
  kind: "manual" | "automatic_policy" | "migration";
  employeeId: string | null;
  trustedServiceId: string | null;
  policyFamily: "source_identity_claim" | null;
  definitionContractVersion: string | null;
  definitionDigestSha256: string | null;
  activationHeadRevision: InboxV2EntityRevision | null;
} {
  if (decision.kind === "manual") {
    return {
      kind: "manual",
      employeeId: decision.actorEmployee.id,
      trustedServiceId: null,
      policyFamily: null,
      definitionContractVersion: null,
      definitionDigestSha256: null,
      activationHeadRevision: null
    };
  }
  if (decision.kind === "migration") {
    return {
      kind: "migration",
      employeeId: null,
      trustedServiceId: decision.trustedServiceId,
      policyFamily: null,
      definitionContractVersion: null,
      definitionDigestSha256: null,
      activationHeadRevision: null
    };
  }
  return {
    kind: "automatic_policy",
    employeeId: null,
    trustedServiceId: decision.trustedServiceId,
    policyFamily: decision.policyAuthority.family,
    definitionContractVersion:
      decision.policyAuthority.definitionContractVersion,
    definitionDigestSha256: decision.policyAuthority.definitionDigestSha256,
    activationHeadRevision: decision.policyAuthority.activationHeadRevision
  };
}

function transitionColumns(transition: InboxV2SourceIdentityClaimTransition): {
  target: ReturnType<typeof targetColumns>;
  previousClaimId: string | null;
  previousTarget: ReturnType<typeof targetColumns> | null;
  resultingClaimId: string | null;
  activeClaimId: string | null;
} {
  if (transition.operation.kind === "revoke") {
    return {
      target: targetColumns(transition.operation.target),
      previousClaimId: null,
      previousTarget: null,
      resultingClaimId: null,
      activeClaimId: transition.operation.activeClaim.id
    };
  }
  return {
    target: targetColumns(transition.operation.target),
    previousClaimId: transition.operation.previousClaim?.claim.id ?? null,
    previousTarget:
      transition.operation.previousClaim === null
        ? null
        : targetColumns(transition.operation.previousClaim.target),
    resultingClaimId: transition.operation.resultingClaim.id,
    activeClaimId: null
  };
}

function mapSingleClaimRows(
  rows: readonly ClaimPersistenceRow[],
  tenantId: InboxV2TenantId
): InboxV2SourceIdentityClaim | null {
  if (rows.length === 0) return null;
  const claims = mapClaimRows(rows, tenantId);
  if (claims.length !== 1) {
    throw invariantError("Claim lookup returned more than one aggregate.");
  }
  return claims[0] ?? null;
}

function mapClaimRows(
  rows: readonly ClaimPersistenceRow[],
  expectedTenantId: InboxV2TenantId
): InboxV2SourceIdentityClaim[] {
  const grouped = new Map<string, ClaimPersistenceRow[]>();
  for (const row of rows) {
    if (row.tenant_id !== expectedTenantId) {
      throw new CoreError("tenant.boundary_violation");
    }
    const id = parseClaimId(row.id, "SourceIdentityClaim row ID");
    const group = grouped.get(String(id)) ?? [];
    group.push(row);
    grouped.set(String(id), group);
  }
  return [...grouped.values()].map((group) =>
    mapClaimGroup(group, expectedTenantId)
  );
}

function mapClaimGroup(
  rows: readonly ClaimPersistenceRow[],
  tenantId: InboxV2TenantId
): InboxV2SourceIdentityClaim {
  const row = rows[0];
  if (row === undefined) {
    throw invariantError("SourceIdentityClaim row group is empty.");
  }
  const evidence = rows.map((item, index) => {
    const ordinal = parseSmallInteger(
      item.evidence_ordinal,
      "SourceIdentityClaim evidence ordinal"
    );
    if (ordinal !== index) {
      throw invariantError(
        "SourceIdentityClaim evidence ordinals are not contiguous from zero."
      );
    }
    if (
      item.evidence_kind === "raw_inbound_event" &&
      typeof item.raw_inbound_event_id === "string" &&
      item.normalized_inbound_event_id === null &&
      item.source_occurrence_id === null &&
      item.provider_roster_evidence_id === null
    ) {
      return {
        kind: "raw_inbound_event" as const,
        reference: {
          tenantId,
          kind: "raw_inbound_event" as const,
          id: item.raw_inbound_event_id as never
        }
      };
    }
    if (
      item.evidence_kind === "normalized_inbound_event" &&
      typeof item.normalized_inbound_event_id === "string" &&
      item.raw_inbound_event_id === null &&
      item.source_occurrence_id === null &&
      item.provider_roster_evidence_id === null
    ) {
      return {
        kind: "normalized_inbound_event" as const,
        reference: {
          tenantId,
          kind: "normalized_inbound_event" as const,
          id: item.normalized_inbound_event_id as never
        }
      };
    }
    if (
      item.evidence_kind === "source_occurrence" &&
      typeof item.source_occurrence_id === "string" &&
      item.raw_inbound_event_id === null &&
      item.normalized_inbound_event_id === null &&
      item.provider_roster_evidence_id === null
    ) {
      return {
        kind: "source_occurrence" as const,
        reference: {
          tenantId,
          kind: "source_occurrence" as const,
          id: item.source_occurrence_id as never
        }
      };
    }
    if (
      item.evidence_kind === "provider_roster_evidence" &&
      typeof item.provider_roster_evidence_id === "string" &&
      item.raw_inbound_event_id === null &&
      item.normalized_inbound_event_id === null &&
      item.source_occurrence_id === null
    ) {
      return {
        kind: "provider_roster_evidence" as const,
        reference: {
          tenantId,
          kind: "provider_roster_evidence" as const,
          id: item.provider_roster_evidence_id as never
        }
      };
    }
    throw invariantError("SourceIdentityClaim evidence row has invalid shape.");
  });

  const target = mapTarget(row, tenantId);
  const decision = mapDecision(row, tenantId);
  const status = row.status;
  if (status !== "active" && status !== "revoked") {
    throw invariantError("SourceIdentityClaim row has invalid status.");
  }
  const revokedAt =
    row.revoked_at === null
      ? null
      : parseTimestamp(row.revoked_at, "SourceIdentityClaim revokedAt");
  try {
    return inboxV2SourceIdentityClaimSchema.parse({
      tenantId,
      id: row.id,
      sourceExternalIdentity: {
        tenantId,
        kind: "source_external_identity",
        id: row.source_external_identity_id
      },
      previousClaimVersion: parseNullableClaimVersion(
        row.previous_claim_version,
        "SourceIdentityClaim previous version"
      ),
      claimVersion: parseClaimVersion(
        row.claim_version,
        "SourceIdentityClaim version"
      ),
      target,
      status,
      confidence: row.confidence,
      evidenceReferences: evidence,
      policyId: row.policy_id,
      policyVersion: row.policy_version,
      reasonCodeId: row.reason_code_id,
      decision,
      createdAt: parseTimestamp(
        row.created_at,
        "SourceIdentityClaim createdAt"
      ),
      revocation: revokedAt === null ? null : { revokedAt },
      revision: parseEntityRevision(
        row.revision,
        "SourceIdentityClaim revision"
      )
    });
  } catch (error) {
    if (error instanceof InboxV2PersistenceInvariantError) throw error;
    throw invariantError(
      "SourceIdentityClaim persistence rows do not satisfy the canonical contract."
    );
  }
}

function mapTarget(
  row: Pick<
    CurrentClaimRow | ClaimPersistenceRow,
    "target_kind" | "target_employee_id" | "target_client_contact_id"
  >,
  tenantId?: InboxV2TenantId
): InboxV2SourceIdentityClaimTarget {
  const targetTenantId = tenantId;
  if (targetTenantId === undefined) {
    throw invariantError("SourceIdentityClaim target mapping requires tenant.");
  }
  if (row.target_kind === "employee" && row.target_client_contact_id === null) {
    return {
      kind: "employee",
      employee: {
        tenantId: targetTenantId,
        kind: "employee",
        id: inboxV2EmployeeIdSchema.parse(row.target_employee_id)
      }
    };
  }
  if (row.target_kind === "client_contact" && row.target_employee_id === null) {
    return {
      kind: "client_contact",
      clientContact: {
        tenantId: targetTenantId,
        kind: "client_contact",
        id: inboxV2ClientContactIdSchema.parse(row.target_client_contact_id)
      }
    };
  }
  throw invariantError("SourceIdentityClaim row has invalid target shape.");
}

function mapDecision(
  row: ClaimPersistenceRow,
  tenantId: InboxV2TenantId
): ClaimDecision {
  if (
    row.decision_kind === "manual" &&
    row.decision_trusted_service_id === null &&
    hasNullPolicyAuthority(row)
  ) {
    return inboxV2SourceIdentityClaimDecisionSchema.parse({
      kind: "manual",
      actorEmployee: {
        tenantId,
        kind: "employee",
        id: row.decision_actor_employee_id
      },
      reviewState: "approved"
    });
  }
  if (
    row.decision_kind === "migration" &&
    row.decision_actor_employee_id === null &&
    hasNullPolicyAuthority(row)
  ) {
    return inboxV2SourceIdentityClaimDecisionSchema.parse({
      kind: "migration",
      trustedServiceId: row.decision_trusted_service_id,
      reviewState: "not_required"
    });
  }
  if (
    row.decision_kind === "automatic_policy" &&
    row.decision_actor_employee_id === null &&
    row.policy_family === "source_identity_claim"
  ) {
    return inboxV2SourceIdentityClaimDecisionSchema.parse({
      kind: "automatic_policy",
      trustedServiceId: row.decision_trusted_service_id,
      reviewState: "not_required",
      policyAuthority: {
        family: row.policy_family,
        definitionContractVersion: row.policy_definition_contract_version,
        definitionDigestSha256: row.policy_definition_digest_sha256,
        activationHeadRevision: parseEntityRevision(
          row.policy_activation_head_revision,
          "SourceIdentityClaim policy activation head revision"
        )
      }
    });
  }
  throw invariantError("SourceIdentityClaim row has invalid decision shape.");
}

function hasNullPolicyAuthority(row: ClaimPersistenceRow): boolean {
  return (
    row.policy_family === null &&
    row.policy_definition_contract_version === null &&
    row.policy_definition_digest_sha256 === null &&
    row.policy_activation_head_revision === null
  );
}

function mapTargetFromCurrentRow(
  row: CurrentClaimRow,
  tenantId: InboxV2TenantId
): InboxV2SourceIdentityClaimTarget {
  return mapTarget(row, tenantId);
}

function indexEventRows(
  rows: readonly EventLockRow[]
): Map<
  string,
  { sourceConnectionId: string | null; sourceAccountId: string | null }
> {
  const result = new Map<
    string,
    { sourceConnectionId: string | null; sourceAccountId: string | null }
  >();
  for (const row of rows) {
    if (typeof row.id !== "string" || result.has(row.id)) {
      throw invariantError(
        "Claim evidence lookup returned invalid duplicate rows."
      );
    }
    result.set(row.id, {
      sourceConnectionId: nullableString(row.source_connection_id),
      sourceAccountId: nullableString(row.source_account_id)
    });
  }
  return result;
}

function indexAnchoredEvidenceRows(
  rows: readonly (OccurrenceLockRow | RosterLockRow)[],
  includesActor: boolean
): Map<
  string,
  {
    sourceConnectionId: string | null;
    sourceAccountId: string | null;
    rawInboundEventId: string | null;
    normalizedInboundEventId: string | null;
    sourceExternalIdentityId: string | null;
  }
> {
  const result = new Map<
    string,
    {
      sourceConnectionId: string | null;
      sourceAccountId: string | null;
      rawInboundEventId: string | null;
      normalizedInboundEventId: string | null;
      sourceExternalIdentityId: string | null;
    }
  >();
  for (const row of rows) {
    if (typeof row.id !== "string" || result.has(row.id)) {
      throw invariantError(
        "Claim anchored evidence lookup returned invalid duplicate rows."
      );
    }
    const actorId =
      includesActor && "provider_actor_source_external_identity_id" in row
        ? nullableString(row.provider_actor_source_external_identity_id)
        : null;
    result.set(row.id, {
      sourceConnectionId: nullableString(row.source_connection_id),
      sourceAccountId: nullableString(row.source_account_id),
      rawInboundEventId: nullableString(row.raw_inbound_event_id),
      normalizedInboundEventId: nullableString(row.normalized_inbound_event_id),
      sourceExternalIdentityId: actorId
    });
  }
  return result;
}

function indexRosterMembershipRows(
  rows: readonly RosterMemberLockRow[]
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const row of rows) {
    if (
      typeof row.roster_evidence_id !== "string" ||
      typeof row.source_external_identity_id !== "string" ||
      result.has(row.roster_evidence_id)
    ) {
      throw invariantError(
        "Claim roster member evidence lookup returned invalid duplicate rows."
      );
    }
    result.add(row.roster_evidence_id);
  }
  return result;
}

function evidenceMatchesIdentityScope(
  evidence: {
    sourceConnectionId: string | null;
    sourceAccountId: string | null;
  },
  identity: {
    scopeKind: "provider" | "source_connection" | "source_account";
    sourceConnectionId: string | null;
    sourceAccountId: string | null;
  }
): boolean {
  if (identity.scopeKind === "provider") return true;
  if (identity.scopeKind === "source_connection") {
    return evidence.sourceConnectionId === identity.sourceConnectionId;
  }
  return evidence.sourceAccountId === identity.sourceAccountId;
}

async function rowIdExists(
  executor: RawSqlExecutor,
  table:
    | "inbox_v2_source_identity_claims"
    | "inbox_v2_source_identity_claim_transitions",
  tenantId: InboxV2TenantId,
  id: InboxV2SourceIdentityClaimId | InboxV2SourceIdentityClaimTransitionId
): Promise<boolean> {
  const query =
    table === "inbox_v2_source_identity_claims"
      ? sql`
          select id
          from inbox_v2_source_identity_claims
          where tenant_id = ${tenantId} and id = ${id}
        `
      : sql`
          select id
          from inbox_v2_source_identity_claim_transitions
          where tenant_id = ${tenantId} and id = ${id}
        `;
  const result = await executor.execute<IdRow>(query);
  if (result.rows.length > 1) {
    throw invariantError(`${table} ID lookup returned multiple rows.`);
  }
  return result.rows.length === 1;
}

async function expectOneRow(
  executor: RawSqlExecutor,
  query: SQL,
  operation: string
): Promise<void> {
  const result = await executor.execute<IdRow>(query);
  if (result.rows.length !== 1) {
    throw invariantError(`${operation} did not affect exactly one row.`);
  }
}

async function runClaimTransaction<TResult>(
  executor: InboxV2SourceIdentityClaimTransactionExecutor,
  work: (
    transaction: InboxV2TenantPolicyAuthorityUseTransaction
  ) => Promise<TResult>,
  attempts: number
): Promise<TResult> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await executor.transaction(work, CLAIM_TRANSACTION_CONFIG);
    } catch (error) {
      if (attempt === attempts || !isRetryableClaimTransactionError(error)) {
        throw error;
      }
    }
  }
  throw invariantError("SourceIdentityClaim transaction retry exhausted.");
}

function isRetryableClaimTransactionError(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return false;
    }
    if (seen.has(current)) return false;
    seen.add(current);
    const code = Reflect.get(current, "code");
    if (typeof code === "string" && RETRYABLE_SQLSTATES.has(code)) {
      return true;
    }
    current = Reflect.get(current, "cause");
  }
  return false;
}

function findPostgresUniqueConstraint(error: unknown): string | null {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return null;
    }
    if (seen.has(current)) return null;
    seen.add(current);
    if (Reflect.get(current, "code") === "23505") {
      const constraint = Reflect.get(current, "constraint");
      return typeof constraint === "string" ? constraint : null;
    }
    current = Reflect.get(current, "cause");
  }
  return null;
}

function incrementClaimVersion(
  current: InboxV2SourceIdentityClaimVersion | null
): InboxV2SourceIdentityClaimVersion {
  const next = current === null ? 1n : BigInt(current) + 1n;
  if (next >= POSTGRES_BIGINT_MAX) {
    throw invariantError(
      "SourceIdentityClaim version cannot advance without overflowing the aggregate revision clock."
    );
  }
  return inboxV2SourceIdentityClaimVersionSchema.parse(next.toString());
}

function incrementEntityRevision(
  current: InboxV2EntityRevision
): InboxV2EntityRevision {
  const next = BigInt(current) + 1n;
  if (next > POSTGRES_BIGINT_MAX) {
    throw invariantError(
      "SourceExternalIdentity revision exceeds PostgreSQL bigint."
    );
  }
  return inboxV2EntityRevisionSchema.parse(next.toString());
}

function assertIdentityClaimClock(
  identityRevision: InboxV2EntityRevision,
  latestVersion: InboxV2SourceIdentityClaimVersion | null
): void {
  const expectedRevision =
    latestVersion === null ? 1n : BigInt(latestVersion) + 1n;
  if (BigInt(identityRevision) !== expectedRevision) {
    throw invariantError(
      "SourceExternalIdentity revision diverges from its claim aggregate clock."
    );
  }
}

function parseClaimId(
  value: unknown,
  field: string
): InboxV2SourceIdentityClaimId {
  const parsed = inboxV2SourceIdentityClaimIdSchema.safeParse(value);
  if (!parsed.success) throw invariantError(`${field} is invalid.`);
  return parsed.data;
}

function parseClaimVersion(
  value: unknown,
  field: string
): InboxV2SourceIdentityClaimVersion {
  if (typeof value === "number") {
    throw invariantError(`${field} was decoded as a lossy JavaScript number.`);
  }
  const parsed = inboxV2SourceIdentityClaimVersionSchema.safeParse(
    typeof value === "bigint" ? value.toString() : value
  );
  if (!parsed.success) throw invariantError(`${field} is invalid.`);
  return parsed.data;
}

function parseNullableClaimVersion(
  value: unknown,
  field: string
): InboxV2SourceIdentityClaimVersion | null {
  return value === null ? null : parseClaimVersion(value, field);
}

function parseEntityRevision(
  value: unknown,
  field: string
): InboxV2EntityRevision {
  if (typeof value === "number") {
    throw invariantError(`${field} was decoded as a lossy JavaScript number.`);
  }
  const parsed = inboxV2EntityRevisionSchema.safeParse(
    typeof value === "bigint" ? value.toString() : value
  );
  if (!parsed.success) throw invariantError(`${field} is invalid.`);
  return parsed.data;
}

function parseTimestamp(value: unknown, field: string): string {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (parsed === null || Number.isNaN(parsed.getTime())) {
    throw invariantError(`${field} is invalid.`);
  }
  return parsed.toISOString();
}

function parseSmallInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 49) {
    throw invariantError(`${field} is invalid.`);
  }
  return parsed;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw invariantError("Database row contains an invalid nullable string.");
  }
  return value;
}

function uniqueSorted(
  values: readonly (string | { toString(): string })[]
): string[] {
  return [...new Set(values.map(String))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
}

function sqlList(values: readonly (string | { toString(): string })[]): SQL {
  return sql.join(
    values.map((value) => sql`${String(value)}`),
    sql`, `
  );
}

function requireNonEmpty(values: readonly unknown[], label: string): void {
  if (values.length === 0) {
    throw new CoreError("validation.failed", `${label} cannot be empty.`);
  }
}

function claimDecisionMatchesAuthorizedActor(
  decision: ClaimDecision,
  actor: InboxV2AuthorizedCommandMutationContext["actor"]
): boolean {
  if (decision.kind === "manual") {
    return (
      actor.kind === "employee" &&
      actor.employeeId === String(decision.actorEmployee.id)
    );
  }
  if (decision.kind === "automatic_policy") {
    return (
      actor.kind === "trusted_service" &&
      actor.trustedServiceId === String(decision.trustedServiceId)
    );
  }
  return false;
}

function assertExactKeys(
  value: unknown,
  expected: ReadonlySet<string>,
  label: string
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CoreError("validation.failed", `${label} must be an object.`);
  }
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !expected.has(key));
  const missing = [...expected].filter((key) => !keys.includes(key));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new CoreError(
      "validation.failed",
      `${label} has an invalid field set.`
    );
  }
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
