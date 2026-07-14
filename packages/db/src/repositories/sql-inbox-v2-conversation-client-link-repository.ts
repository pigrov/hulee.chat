import {
  inboxV2ClientContactIdSchema,
  inboxV2ConversationClientLinkMigrationProvenanceIdSchema,
  inboxV2ConversationClientLinkPolicyAuthoritySchema,
  inboxV2ConversationClientLinkPolicyIdSchema,
  inboxV2ConversationClientLinkDecisionSchema,
  inboxV2ConversationClientLinkIdSchema,
  inboxV2ConversationClientLinkSchema,
  inboxV2ConversationClientLinkTransitionIdSchema,
  inboxV2ConversationClientLinkTransitionSchema,
  inboxV2ConversationIdSchema,
  inboxV2ClientIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2SchemaVersionTokenSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  inboxV2TrustedServiceIdSchema,
  type InboxV2ClientContactId,
  type InboxV2ConversationClientLink,
  type InboxV2ConversationClientLinkDecision,
  type InboxV2ConversationClientLinkId,
  type InboxV2ConversationClientLinkTransition,
  type InboxV2ConversationClientLinkTransitionId,
  type InboxV2ConversationId,
  type InboxV2ClientId,
  type InboxV2EmployeeId,
  type InboxV2EntityRevision,
  type InboxV2SourceExternalIdentityId,
  type InboxV2SourceIdentityClaimId,
  type InboxV2SourceIdentityClaimVersion,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
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

const LINK_TRANSACTION_CONFIG = { isolationLevel: "read committed" } as const;
const LINK_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const APPLY_KEYS = new Set([
  "tenantId",
  "conversationId",
  "transitionId",
  "expectedRevision",
  "decision",
  "operations",
  "resultingPrimaryLinkId",
  "occurredAt"
]);

export type InboxV2ConversationClientLinkMutationOperation =
  | Readonly<{
      kind: "create_link";
      link: InboxV2ConversationClientLink;
    }>
  | Readonly<{
      kind: "end_link";
      linkId: InboxV2ConversationClientLinkId;
    }>;

export type ApplyInboxV2ConversationClientLinkTransitionInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  transitionId: InboxV2ConversationClientLinkTransitionId;
  expectedRevision: InboxV2EntityRevision | null;
  decision: InboxV2ConversationClientLinkDecision;
  operations: readonly InboxV2ConversationClientLinkMutationOperation[];
  resultingPrimaryLinkId: InboxV2ConversationClientLinkId | null;
  occurredAt: string;
}>;

export type ApplyInboxV2ConversationClientLinkTransitionResult =
  | Readonly<{
      kind: "applied";
      transition: InboxV2ConversationClientLinkTransition;
    }>
  | Readonly<{
      kind: "revision_conflict";
      currentRevision: InboxV2EntityRevision | null;
      currentPrimaryLinkId: InboxV2ConversationClientLinkId | null;
    }>
  | Readonly<{ kind: "conversation_not_found" }>
  | Readonly<{ kind: "client_not_found"; clientId: InboxV2ClientId }>
  | Readonly<{
      kind: "link_not_found" | "link_id_conflict" | "link_state_conflict";
      linkId: InboxV2ConversationClientLinkId;
    }>
  | Readonly<{
      kind: "transition_id_conflict";
      transitionId: InboxV2ConversationClientLinkTransitionId;
    }>
  | Readonly<{
      kind: "actor_not_found" | "actor_inactive";
      employeeId: InboxV2EmployeeId;
    }>
  | Readonly<{
      kind:
        | "claim_not_found"
        | "claim_state_conflict"
        | "claim_target_conflict"
        | "claim_time_conflict"
        | "claim_evidence_scope_conflict";
      claimId: InboxV2SourceIdentityClaimId;
    }>
  | Exclude<
      LockExactActiveInboxV2TenantPolicyAuthorityResult,
      { kind: "locked" }
    >
  | Readonly<{
      kind: "evidence_not_found";
      linkId: InboxV2ConversationClientLinkId;
      purpose: "verification" | "audit";
      ordinal: number;
    }>
  | Readonly<{
      kind: "evidence_scope_conflict";
      linkId: InboxV2ConversationClientLinkId;
      purpose: "verification" | "audit";
      ordinal: number;
    }>;

export type InboxV2ConversationClientLinkTransactionExecutor =
  RawSqlExecutor & {
    transaction<TResult>(
      work: (
        transaction: InboxV2TenantPolicyAuthorityUseTransaction
      ) => Promise<TResult>,
      config: Readonly<{ isolationLevel: "read committed" }>
    ): Promise<TResult>;
  };

export type InboxV2ConversationClientLinkRepository = Readonly<{
  applyTransition(
    input: ApplyInboxV2ConversationClientLinkTransitionInput
  ): Promise<ApplyInboxV2ConversationClientLinkTransitionResult>;
}>;

type IdRow = { id: unknown };
type HeadRow = { revision: unknown; primary_link_id: unknown };
type LinkLockRow = {
  id: unknown;
  client_id: unknown;
  state: unknown;
  association_confidence: unknown;
  provenance_kind: unknown;
  provenance_claim_id: unknown;
  provenance_claim_version: unknown;
  provenance_claim_target_client_contact_id: unknown;
  provenance_verification_service_id: unknown;
  provenance_verification_policy_id: unknown;
  provenance_verification_policy_version: unknown;
  provenance_verification_policy_family: unknown;
  provenance_verification_definition_contract_version: unknown;
  provenance_verification_definition_digest_sha256: unknown;
  provenance_verification_activation_head_revision: unknown;
  provenance_verification_verified_at: unknown;
  provenance_migration_id: unknown;
  provenance_contract_version: unknown;
  linked_actor_kind: unknown;
  linked_actor_service_id: unknown;
  linked_policy_id: unknown;
  linked_policy_version: unknown;
  linked_policy_family: unknown;
  linked_policy_definition_contract_version: unknown;
  linked_policy_definition_digest_sha256: unknown;
  linked_policy_activation_head_revision: unknown;
  legacy_role_count: unknown;
};

type ClaimPreReadRow = {
  id: unknown;
  source_external_identity_id: unknown;
};

type ClaimHeadLockRow = {
  source_external_identity_id: unknown;
  resolution_status: unknown;
  active_claim_id: unknown;
  latest_claim_version: unknown;
};

type ClaimLockRow = {
  id: unknown;
  source_external_identity_id: unknown;
  claim_version: unknown;
  target_kind: unknown;
  target_employee_id: unknown;
  target_client_contact_id: unknown;
  status: unknown;
  created_at: unknown;
  revoked_at: unknown;
};

type EmployeeLockRow = {
  id: unknown;
  created_at: unknown;
  deactivated_at: unknown;
};
type ClientContactLockRow = { id: unknown; client_id: unknown };
type EvidenceClaimLockRow = {
  id: unknown;
  source_external_identity_id: unknown;
  claim_version: unknown;
  target_kind: unknown;
  target_client_contact_id: unknown;
  status: unknown;
  created_at: unknown;
  revoked_at: unknown;
  head_resolution_status: unknown;
  head_active_claim_id: unknown;
  head_latest_claim_version: unknown;
};
type EvidenceParticipantLockRow = {
  id: unknown;
  conversation_id: unknown;
  subject_kind: unknown;
  subject_client_contact_id: unknown;
  subject_source_external_identity_id: unknown;
};
type EvidenceOccurrenceLockRow = {
  id: unknown;
  conversation_id: unknown;
  provider_actor_source_external_identity_id: unknown;
  raw_inbound_event_id: unknown;
  normalized_inbound_event_id: unknown;
};
type EvidenceNormalizedEventLockRow = { id: unknown; raw_event_id: unknown };

type LinkEvidenceReference =
  InboxV2ConversationClientLink["auditEvidenceReferences"][number];
type LinkEvidenceEntry = Readonly<{
  purpose: "verification" | "audit";
  ordinal: number;
  evidence: LinkEvidenceReference;
}>;

type LockedClaimAnchor = Readonly<{
  id: InboxV2SourceIdentityClaimId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  claimVersion: InboxV2SourceIdentityClaimVersion;
  targetClientContactId: InboxV2ClientContactId;
}>;

type NormalizedOperation =
  | Readonly<{ kind: "create_link"; link: InboxV2ConversationClientLink }>
  | Readonly<{ kind: "end_link"; linkId: InboxV2ConversationClientLinkId }>;

type NormalizedInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  transitionId: InboxV2ConversationClientLinkTransitionId;
  expectedRevision: InboxV2EntityRevision | null;
  decision: InboxV2ConversationClientLinkDecision;
  operations: readonly NormalizedOperation[];
  resultingPrimaryLinkId: InboxV2ConversationClientLinkId | null;
  occurredAt: string;
}>;

export function createSqlInboxV2ConversationClientLinkRepository(
  executor: InboxV2ConversationClientLinkTransactionExecutor | HuleeDatabase
): InboxV2ConversationClientLinkRepository {
  const transactionExecutor =
    executor as unknown as InboxV2ConversationClientLinkTransactionExecutor;

  return {
    async applyTransition(input) {
      const normalized = normalizeApplyInput(input);
      const createdLinkIds = normalized.operations
        .filter(
          (
            operation
          ): operation is Extract<
            NormalizedOperation,
            { kind: "create_link" }
          > => operation.kind === "create_link"
        )
        .map((operation) => operation.link.id);

      try {
        return await runLinkTransaction(
          transactionExecutor,
          async (transaction) => {
            if (!(await lockConversation(transaction, normalized))) {
              return { kind: "conversation_not_found" } as const;
            }

            const head = await lockHead(transaction, normalized);
            if (head.revision !== normalized.expectedRevision) {
              return {
                kind: "revision_conflict",
                currentRevision: head.revision,
                currentPrimaryLinkId: head.primaryLinkId
              } as const;
            }

            const policyConflict = await lockAndValidateDecisionPolicyAuthority(
              transaction,
              normalized
            );
            if (policyConflict !== null) return policyConflict;

            const createdLinks = normalized.operations
              .filter(
                (
                  operation
                ): operation is Extract<
                  NormalizedOperation,
                  { kind: "create_link" }
                > => operation.kind === "create_link"
              )
              .map((operation) => operation.link);
            const endedIds = normalized.operations
              .filter(
                (
                  operation
                ): operation is Extract<
                  NormalizedOperation,
                  { kind: "end_link" }
                > => operation.kind === "end_link"
              )
              .map((operation) => operation.linkId);
            const referencedIds = uniqueSorted([
              ...endedIds,
              ...(normalized.resultingPrimaryLinkId === null
                ? []
                : [normalized.resultingPrimaryLinkId]),
              ...(head.primaryLinkId === null ? [] : [head.primaryLinkId]),
              ...createdLinks.map((link) => link.id)
            ]);
            const currentByCreatedClient = await findCurrentLinksByClientIds(
              transaction,
              normalized,
              uniqueSorted(createdLinks.map((link) => link.client.id))
            );
            const observedById = await findLinksByIds(
              transaction,
              normalized,
              uniqueSorted([
                ...referencedIds,
                ...currentByCreatedClient.map((row) => row.id)
              ])
            );
            const observedRows = mergeLinkRows([
              ...currentByCreatedClient,
              ...observedById
            ]);

            const claimValidation = await lockAndValidateClaimAnchors(
              transaction,
              normalized,
              createdLinks
            );
            if (claimValidation.kind !== "ready") return claimValidation;

            const actorConflict = await lockAndValidateActor(
              transaction,
              normalized
            );
            if (actorConflict !== null) return actorConflict;

            const contactConflict = await lockAndValidateClaimContacts(
              transaction,
              normalized,
              createdLinks,
              claimValidation.anchors
            );
            if (contactConflict !== null) return contactConflict;

            const affectedClientIds = uniqueSorted([
              ...createdLinks.map((link) => link.client.id),
              ...observedRows.map((row) => row.clientId)
            ]);
            const lockedClientIds = await lockClients(
              transaction,
              normalized.tenantId,
              affectedClientIds
            );
            const missingClientId = affectedClientIds.find(
              (clientId) => !lockedClientIds.has(clientId)
            );
            if (missingClientId !== undefined) {
              return {
                kind: "client_not_found",
                clientId: inboxV2ClientIdSchema.parse(missingClientId)
              } as const;
            }

            const evidenceConflict = await lockAndValidateEvidenceGraphs(
              transaction,
              normalized,
              createdLinks
            );
            if (evidenceConflict !== null) return evidenceConflict;

            const lockedRows = await lockLinks(
              transaction,
              normalized,
              uniqueSorted(observedRows.map((row) => row.id))
            );
            const linksById = new Map(lockedRows.map((row) => [row.id, row]));

            for (const link of createdLinks) {
              if (linksById.has(String(link.id))) {
                return { kind: "link_id_conflict", linkId: link.id } as const;
              }
              const existingCurrent = lockedRows.find(
                (row) =>
                  row.clientId === String(link.client.id) &&
                  row.state === "active"
              );
              if (
                existingCurrent !== undefined &&
                !endedIds.some(
                  (linkId) => String(linkId) === existingCurrent.id
                )
              ) {
                return {
                  kind: "link_state_conflict",
                  linkId: existingCurrent.id as InboxV2ConversationClientLinkId
                } as const;
              }
            }

            for (const linkId of endedIds) {
              const existing = linksById.get(String(linkId));
              if (existing === undefined) {
                return { kind: "link_not_found", linkId } as const;
              }
              if (existing.state !== "active") {
                return { kind: "link_state_conflict", linkId } as const;
              }
            }

            const primaryConflict = validateResultingPrimary({
              resultingPrimaryLinkId: normalized.resultingPrimaryLinkId,
              createdLinks,
              endedIds,
              linksById
            });
            if (primaryConflict !== null) return primaryConflict;

            const resultingRevision = incrementRevision(head.revision);
            const transition =
              inboxV2ConversationClientLinkTransitionSchema.parse({
                tenantId: normalized.tenantId,
                id: normalized.transitionId,
                conversation: {
                  tenantId: normalized.tenantId,
                  kind: "conversation",
                  id: normalized.conversationId
                },
                operations: normalized.operations.map((operation) => ({
                  kind: operation.kind,
                  link: {
                    tenantId: normalized.tenantId,
                    kind: "conversation_client_link",
                    id:
                      operation.kind === "create_link"
                        ? operation.link.id
                        : operation.linkId
                  }
                })),
                previousPrimaryLink: toLinkReference(
                  normalized.tenantId,
                  head.primaryLinkId
                ),
                resultingPrimaryLink: toLinkReference(
                  normalized.tenantId,
                  normalized.resultingPrimaryLinkId
                ),
                decision: normalized.decision,
                expectedRevision: normalized.expectedRevision,
                currentRevision: head.revision,
                resultingRevision,
                occurredAt: normalized.occurredAt
              });

            for (const linkId of endedIds) {
              await expectOneRow(
                transaction,
                buildEndInboxV2ConversationClientLinkSql({
                  tenantId: normalized.tenantId,
                  conversationId: normalized.conversationId,
                  linkId,
                  decision: normalized.decision,
                  endedAt: normalized.occurredAt
                }),
                "ConversationClientLink end"
              );
            }
            for (const link of createdLinks) {
              const claimAnchor =
                link.provenance.kind === "source_identity_claim"
                  ? claimValidation.anchors.get(
                      String(link.provenance.claim.id)
                    )
                  : null;
              if (
                link.provenance.kind === "source_identity_claim" &&
                claimAnchor === undefined
              ) {
                throw invariantError(
                  "Validated SourceIdentityClaim anchor is missing before Client-link insert."
                );
              }
              await expectOneRow(
                transaction,
                buildInsertInboxV2ConversationClientLinkSql(
                  link,
                  claimAnchor ?? null
                ),
                "ConversationClientLink insert"
              );
              const verificationEvidence =
                link.provenance.kind === "source_identity_claim" ||
                link.provenance.kind === "trusted_policy"
                  ? link.provenance.verification.evidenceReferences
                  : [];
              for (const [
                ordinal,
                evidence
              ] of verificationEvidence.entries()) {
                await expectOneRow(
                  transaction,
                  buildInsertInboxV2ConversationClientLinkEvidenceSql({
                    link,
                    purpose: "verification",
                    ordinal,
                    evidence
                  }),
                  "ConversationClientLink verification evidence insert"
                );
              }
              for (const [
                ordinal,
                evidence
              ] of link.auditEvidenceReferences.entries()) {
                await expectOneRow(
                  transaction,
                  buildInsertInboxV2ConversationClientLinkEvidenceSql({
                    link,
                    purpose: "audit",
                    ordinal,
                    evidence
                  }),
                  "ConversationClientLink audit evidence insert"
                );
              }
            }
            await expectOneRow(
              transaction,
              buildInsertInboxV2ConversationClientLinkTransitionSql(transition),
              "ConversationClientLink transition insert"
            );
            for (const link of createdLinks) {
              for (const roleId of [...link.roleIds].sort()) {
                await expectOneRow(
                  transaction,
                  buildInsertInboxV2ConversationClientLinkRoleSql({
                    link,
                    transition,
                    roleId
                  }),
                  "ConversationClientLink role insert"
                );
              }
            }
            for (const operation of normalized.operations) {
              await expectOneRow(
                transaction,
                buildInsertInboxV2ConversationClientLinkOperationSql({
                  transition,
                  operation
                }),
                "ConversationClientLink operation insert"
              );
            }
            await expectOneRow(
              transaction,
              buildAdvanceInboxV2ConversationClientLinkHeadSql(transition),
              "ConversationClientLink head advance"
            );

            return { kind: "applied", transition } as const;
          }
        );
      } catch (error) {
        const constraint = findPostgresUniqueConstraint(error);
        if (constraint === "inbox_v2_conversation_client_link_transitions_pk") {
          return {
            kind: "transition_id_conflict",
            transitionId: normalized.transitionId
          };
        }
        if (
          constraint === "inbox_v2_conversation_client_links_pk" ||
          constraint === "inbox_v2_conversation_client_links_exact_edge_unique"
        ) {
          const conflictingLinkId =
            await findConflictingCreatedLinkAfterRollback(
              transactionExecutor,
              normalized.tenantId,
              createdLinkIds
            );
          if (conflictingLinkId !== null) {
            return { kind: "link_id_conflict", linkId: conflictingLinkId };
          }
        }
        throw error;
      }
    }
  };
}

export function buildLockInboxV2ConversationClientLinkConversationSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select conversation_row.id
    from inbox_v2_conversations conversation_row
    where conversation_row.tenant_id = ${input.tenantId}
      and conversation_row.id = ${input.conversationId}
    for no key update
  `;
}

export function buildLockInboxV2ConversationClientLinkHeadSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select head_row.revision, head_row.primary_link_id
    from inbox_v2_conversation_client_link_heads head_row
    where head_row.tenant_id = ${input.tenantId}
      and head_row.conversation_id = ${input.conversationId}
    for update
  `;
}

export function buildFindInboxV2ConversationClientLinkClaimAnchorsSql(input: {
  tenantId: InboxV2TenantId;
  claimIds: readonly InboxV2SourceIdentityClaimId[];
}): SQL {
  requireNonEmpty(input.claimIds, "SourceIdentityClaim IDs");
  return sql`
    select claim_row.id, claim_row.source_external_identity_id
    from inbox_v2_source_identity_claims claim_row
    where claim_row.tenant_id = ${input.tenantId}
      and claim_row.id in (${sqlList(input.claimIds)})
    order by claim_row.id collate "C"
  `;
}

export function buildLockInboxV2ConversationClientLinkSourceIdentitiesSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityIds: readonly InboxV2SourceExternalIdentityId[];
}): SQL {
  requireNonEmpty(
    input.sourceExternalIdentityIds,
    "SourceExternalIdentity IDs"
  );
  return sql`
    select identity_row.id
    from inbox_v2_source_external_identities identity_row
    where identity_row.tenant_id = ${input.tenantId}
      and identity_row.id in (${sqlList(input.sourceExternalIdentityIds)})
    order by identity_row.id collate "C"
    for share of identity_row
  `;
}

export function buildLockInboxV2ConversationClientLinkClaimHeadsSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityIds: readonly InboxV2SourceExternalIdentityId[];
}): SQL {
  requireNonEmpty(
    input.sourceExternalIdentityIds,
    "SourceIdentityClaim head IDs"
  );
  return sql`
    select
      head_row.source_external_identity_id,
      head_row.resolution_status,
      head_row.active_claim_id,
      head_row.latest_claim_version
    from inbox_v2_source_identity_claim_heads head_row
    where head_row.tenant_id = ${input.tenantId}
      and head_row.source_external_identity_id in (
        ${sqlList(input.sourceExternalIdentityIds)}
      )
    order by head_row.source_external_identity_id collate "C"
    for share of head_row
  `;
}

export function buildLockInboxV2ConversationClientLinkClaimsSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  claimIds: readonly InboxV2SourceIdentityClaimId[];
}): SQL {
  requireNonEmpty(input.claimIds, "SourceIdentityClaim IDs");
  return sql`
    select
      claim_row.id,
      claim_row.source_external_identity_id,
      claim_row.claim_version,
      claim_row.target_kind,
      claim_row.target_employee_id,
      claim_row.target_client_contact_id,
      claim_row.status,
      claim_row.created_at,
      claim_row.revoked_at
    from inbox_v2_source_identity_claims claim_row
    where claim_row.tenant_id = ${input.tenantId}
      and claim_row.id in (${sqlList(input.claimIds)})
    order by claim_row.id collate "C"
    for share of claim_row
  `;
}

export function buildLockInboxV2ConversationClientLinkEmployeesSql(input: {
  tenantId: InboxV2TenantId;
  employeeIds: readonly InboxV2EmployeeId[];
}): SQL {
  requireNonEmpty(input.employeeIds, "Employee IDs");
  return sql`
    select employee_row.id, employee_row.created_at, employee_row.deactivated_at
    from employees employee_row
    where employee_row.tenant_id = ${input.tenantId}
      and employee_row.id in (${sqlList(input.employeeIds)})
    order by employee_row.id collate "C"
    for no key update
  `;
}

export function buildLockInboxV2ConversationClientLinkClientContactsSql(input: {
  tenantId: InboxV2TenantId;
  clientContactIds: readonly InboxV2ClientContactId[];
}): SQL {
  requireNonEmpty(input.clientContactIds, "ClientContact IDs");
  return sql`
    select contact_row.id, contact_row.client_id
    from client_contacts contact_row
    where contact_row.tenant_id = ${input.tenantId}
      and contact_row.id in (${sqlList(input.clientContactIds)})
    order by contact_row.id collate "C"
    for share of contact_row
  `;
}

export function buildLockInboxV2ConversationClientLinkEvidenceClaimsSql(input: {
  tenantId: InboxV2TenantId;
  ids: readonly string[];
}): SQL {
  requireNonEmpty(input.ids, "evidence claim IDs");
  return sql`
    select claim_row.id, claim_row.source_external_identity_id,
      claim_row.claim_version,
      claim_row.target_kind, claim_row.target_client_contact_id,
      claim_row.status, claim_row.created_at, claim_row.revoked_at,
      head_row.resolution_status as head_resolution_status,
      head_row.active_claim_id as head_active_claim_id,
      head_row.latest_claim_version as head_latest_claim_version
    from inbox_v2_source_identity_claims claim_row
    join inbox_v2_source_identity_claim_heads head_row
      on head_row.tenant_id = claim_row.tenant_id
     and head_row.source_external_identity_id =
       claim_row.source_external_identity_id
    where claim_row.tenant_id = ${input.tenantId}
      and claim_row.id in (${sqlList(input.ids)})
    order by claim_row.id collate "C"
    for share of claim_row, head_row
  `;
}

export function buildLockInboxV2ConversationClientLinkEvidenceParticipantsSql(input: {
  tenantId: InboxV2TenantId;
  ids: readonly string[];
}): SQL {
  requireNonEmpty(input.ids, "evidence participant IDs");
  return sql`
    select participant_row.id, participant_row.conversation_id,
      participant_row.subject_kind,
      participant_row.subject_client_contact_id,
      participant_row.subject_source_external_identity_id
    from inbox_v2_conversation_participants participant_row
    where participant_row.tenant_id = ${input.tenantId}
      and participant_row.id in (${sqlList(input.ids)})
    order by participant_row.id collate "C"
    for share of participant_row
  `;
}

export function buildLockInboxV2ConversationClientLinkEvidenceOccurrencesSql(input: {
  tenantId: InboxV2TenantId;
  ids: readonly string[];
}): SQL {
  requireNonEmpty(input.ids, "evidence occurrence IDs");
  return sql`
    select occurrence_row.id, occurrence_row.conversation_id,
      occurrence_row.provider_actor_source_external_identity_id,
      occurrence_row.raw_inbound_event_id,
      occurrence_row.normalized_inbound_event_id
    from inbox_v2_source_occurrences occurrence_row
    where occurrence_row.tenant_id = ${input.tenantId}
      and occurrence_row.id in (${sqlList(input.ids)})
    order by occurrence_row.id collate "C"
    for share of occurrence_row
  `;
}

export function buildLockInboxV2ConversationClientLinkEvidenceRawEventsSql(input: {
  tenantId: InboxV2TenantId;
  ids: readonly string[];
}): SQL {
  requireNonEmpty(input.ids, "evidence raw-event IDs");
  return sql`
    select event_row.id
    from raw_inbound_events event_row
    where event_row.tenant_id = ${input.tenantId}
      and event_row.id in (${sqlList(input.ids)})
    order by event_row.id collate "C"
    for share of event_row
  `;
}

export function buildLockInboxV2ConversationClientLinkEvidenceNormalizedEventsSql(input: {
  tenantId: InboxV2TenantId;
  ids: readonly string[];
}): SQL {
  requireNonEmpty(input.ids, "evidence normalized-event IDs");
  return sql`
    select event_row.id, event_row.raw_event_id
    from normalized_inbound_events event_row
    where event_row.tenant_id = ${input.tenantId}
      and event_row.id in (${sqlList(input.ids)})
    order by event_row.id collate "C"
    for share of event_row
  `;
}

export function buildFindInboxV2ConversationClientLinksByIdsSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  linkIds: readonly string[];
  lock: boolean;
}): SQL {
  requireNonEmpty(input.linkIds, "link IDs");
  const lockClause = input.lock ? sql`for update of link_row` : sql``;
  return sql`
    select
      link_row.id,
      link_row.client_id,
      link_row.state,
      link_row.association_confidence,
      link_row.provenance_kind,
      link_row.provenance_claim_id,
      link_row.provenance_claim_version,
      link_row.provenance_claim_target_client_contact_id,
      link_row.provenance_verification_service_id,
      link_row.provenance_verification_policy_id,
      link_row.provenance_verification_policy_version,
      link_row.provenance_verification_policy_family,
      link_row.provenance_verification_definition_contract_version,
      link_row.provenance_verification_definition_digest_sha256,
      link_row.provenance_verification_activation_head_revision,
      link_row.provenance_verification_verified_at,
      link_row.provenance_migration_id,
      link_row.provenance_contract_version,
      link_row.linked_actor_kind,
      link_row.linked_actor_service_id,
      link_row.linked_policy_id,
      link_row.linked_policy_version,
      link_row.linked_policy_family,
      link_row.linked_policy_definition_contract_version,
      link_row.linked_policy_definition_digest_sha256,
      link_row.linked_policy_activation_head_revision,
      (
        select count(*)::bigint
        from inbox_v2_conversation_client_link_roles role_row
        where role_row.tenant_id = link_row.tenant_id
          and role_row.link_id = link_row.id
          and role_row.role_id = 'core:legacy-unspecified'
      ) as legacy_role_count
    from inbox_v2_conversation_client_links link_row
    where link_row.tenant_id = ${input.tenantId}
      and link_row.conversation_id = ${input.conversationId}
      and link_row.id in (${sqlList(input.linkIds)})
    order by link_row.id collate "C"
    ${lockClause}
  `;
}

export function buildFindConflictingInboxV2ConversationClientLinksSql(input: {
  tenantId: InboxV2TenantId;
  linkIds: readonly InboxV2ConversationClientLinkId[];
}): SQL {
  requireNonEmpty(input.linkIds, "link IDs");
  return sql`
    select link_row.id
    from inbox_v2_conversation_client_links link_row
    where link_row.tenant_id = ${input.tenantId}
      and link_row.id in (${sqlList(input.linkIds)})
    order by link_row.id collate "C"
  `;
}

export function buildFindCurrentInboxV2ConversationClientLinksByClientIdsSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  clientIds: readonly string[];
}): SQL {
  requireNonEmpty(input.clientIds, "Client IDs");
  return sql`
    select
      link_row.id,
      link_row.client_id,
      link_row.state,
      link_row.association_confidence,
      link_row.provenance_kind,
      link_row.provenance_claim_id,
      link_row.provenance_claim_version,
      link_row.provenance_claim_target_client_contact_id,
      link_row.provenance_verification_service_id,
      link_row.provenance_verification_policy_id,
      link_row.provenance_verification_policy_version,
      link_row.provenance_verification_policy_family,
      link_row.provenance_verification_definition_contract_version,
      link_row.provenance_verification_definition_digest_sha256,
      link_row.provenance_verification_activation_head_revision,
      link_row.provenance_verification_verified_at,
      link_row.provenance_migration_id,
      link_row.provenance_contract_version,
      link_row.linked_actor_kind,
      link_row.linked_actor_service_id,
      link_row.linked_policy_id,
      link_row.linked_policy_version,
      link_row.linked_policy_family,
      link_row.linked_policy_definition_contract_version,
      link_row.linked_policy_definition_digest_sha256,
      link_row.linked_policy_activation_head_revision,
      (
        select count(*)::bigint
        from inbox_v2_conversation_client_link_roles role_row
        where role_row.tenant_id = link_row.tenant_id
          and role_row.link_id = link_row.id
          and role_row.role_id = 'core:legacy-unspecified'
      ) as legacy_role_count
    from inbox_v2_conversation_client_links link_row
    where link_row.tenant_id = ${input.tenantId}
      and link_row.conversation_id = ${input.conversationId}
      and link_row.client_id in (${sqlList(input.clientIds)})
      and link_row.state = 'active'
    order by link_row.client_id collate "C", link_row.id collate "C"
  `;
}

export function buildLockInboxV2ConversationClientLinkClientsSql(input: {
  tenantId: InboxV2TenantId;
  clientIds: readonly string[];
}): SQL {
  requireNonEmpty(input.clientIds, "Client IDs");
  return sql`
    select client_row.id
    from clients client_row
    where client_row.tenant_id = ${input.tenantId}
      and client_row.id in (${sqlList(input.clientIds)})
    order by client_row.id collate "C"
    for no key update
  `;
}

export function buildInsertInboxV2ConversationClientLinkTransitionSql(
  transition: InboxV2ConversationClientLinkTransition
): SQL {
  const actor = toActorColumns(transition.decision);
  const authority = toPolicyAuthorityColumns(transition.decision);
  return sql`
    insert into inbox_v2_conversation_client_link_transitions (
      tenant_id, id, conversation_id,
      previous_primary_link_id, resulting_primary_link_id,
      actor_kind, actor_employee_id, actor_service_id,
      policy_id, policy_version, reason_code_id,
      policy_family, policy_definition_contract_version,
      policy_definition_digest_sha256, policy_activation_head_revision,
      expected_revision, current_revision, resulting_revision, occurred_at
    ) values (
      ${transition.tenantId}, ${transition.id}, ${transition.conversation.id},
      ${transition.previousPrimaryLink?.id ?? null},
      ${transition.resultingPrimaryLink?.id ?? null},
      ${actor.kind}, ${actor.employeeId}, ${actor.serviceId},
      ${transition.decision.policyId}, ${transition.decision.policyVersion},
      ${transition.decision.reasonCodeId},
      ${authority.family}, ${authority.definitionContractVersion},
      ${authority.definitionDigestSha256}, ${authority.activationHeadRevision},
      ${transition.expectedRevision},
      ${transition.currentRevision}, ${transition.resultingRevision},
      ${transition.occurredAt}
    )
    returning id
  `;
}

export function buildInsertInboxV2ConversationClientLinkSql(
  link: InboxV2ConversationClientLink,
  claimAnchor: LockedClaimAnchor | null = null
): SQL {
  const actor = toActorColumns(link.linkedBy);
  const linkedAuthority = toPolicyAuthorityColumns(link.linkedBy);
  if (
    (link.provenance.kind === "source_identity_claim") !==
      (claimAnchor !== null) ||
    (link.provenance.kind === "source_identity_claim" &&
      claimAnchor !== null &&
      String(link.provenance.claim.id) !== String(claimAnchor.id))
  ) {
    throw invariantError(
      "ConversationClientLink claim provenance does not match its locked anchor."
    );
  }
  const claimProvenance =
    link.provenance.kind === "source_identity_claim" && claimAnchor !== null
      ? {
          claimId: claimAnchor.id,
          claimVersion: claimAnchor.claimVersion,
          targetClientContactId: claimAnchor.targetClientContactId
        }
      : {
          claimId: null,
          claimVersion: null,
          targetClientContactId: null
        };
  const verification =
    link.provenance.kind === "source_identity_claim" ||
    link.provenance.kind === "trusted_policy"
      ? {
          serviceId: link.provenance.verification.verifiedByTrustedServiceId,
          policyId: link.provenance.verification.policyId,
          policyVersion: link.provenance.verification.policyVersion,
          family: link.provenance.verification.policyAuthority?.family ?? null,
          definitionContractVersion:
            link.provenance.verification.policyAuthority
              ?.definitionContractVersion ?? null,
          definitionDigestSha256:
            link.provenance.verification.policyAuthority
              ?.definitionDigestSha256 ?? null,
          activationHeadRevision:
            link.provenance.verification.policyAuthority
              ?.activationHeadRevision ?? null,
          verifiedAt: link.provenance.verification.verifiedAt
        }
      : {
          serviceId: null,
          policyId: null,
          policyVersion: null,
          family: null,
          definitionContractVersion: null,
          definitionDigestSha256: null,
          activationHeadRevision: null,
          verifiedAt: null
        };
  const provenance =
    link.provenance.kind === "migration"
      ? {
          migrationId: link.provenance.provenanceId,
          contractVersion: link.provenance.contractVersion
        }
      : { migrationId: null, contractVersion: null };
  return sql`
    insert into inbox_v2_conversation_client_links (
      tenant_id, id, conversation_id, client_id,
      association_confidence, provenance_kind,
      provenance_claim_id, provenance_claim_version,
      provenance_claim_target_client_contact_id,
      provenance_verification_service_id,
      provenance_verification_policy_id,
      provenance_verification_policy_version,
      provenance_verification_policy_family,
      provenance_verification_definition_contract_version,
      provenance_verification_definition_digest_sha256,
      provenance_verification_activation_head_revision,
      provenance_verification_verified_at,
      provenance_migration_id, provenance_contract_version,
      linked_actor_kind, linked_actor_employee_id, linked_actor_service_id,
      linked_policy_id, linked_policy_version, linked_reason_code_id,
      linked_policy_family, linked_policy_definition_contract_version,
      linked_policy_definition_digest_sha256,
      linked_policy_activation_head_revision,
      valid_from, valid_from_basis, state, revision
    ) values (
      ${link.tenantId}, ${link.id}, ${link.conversation.id}, ${link.client.id},
      ${link.associationConfidence}, ${link.provenance.kind},
      ${claimProvenance.claimId}, ${claimProvenance.claimVersion},
      ${claimProvenance.targetClientContactId},
      ${verification.serviceId}, ${verification.policyId},
      ${verification.policyVersion}, ${verification.family},
      ${verification.definitionContractVersion},
      ${verification.definitionDigestSha256},
      ${verification.activationHeadRevision}, ${verification.verifiedAt},
      ${provenance.migrationId}, ${provenance.contractVersion},
      ${actor.kind}, ${actor.employeeId}, ${actor.serviceId},
      ${link.linkedBy.policyId}, ${link.linkedBy.policyVersion},
      ${link.linkedBy.reasonCodeId}, ${linkedAuthority.family},
      ${linkedAuthority.definitionContractVersion},
      ${linkedAuthority.definitionDigestSha256},
      ${linkedAuthority.activationHeadRevision},
      ${link.validFrom}, ${link.validFromBasis},
      'active', 1
    )
    returning id
  `;
}

export function buildInsertInboxV2ConversationClientLinkRoleSql(input: {
  link: InboxV2ConversationClientLink;
  transition: InboxV2ConversationClientLinkTransition;
  roleId: string;
}): SQL {
  return sql`
    insert into inbox_v2_conversation_client_link_roles (
      tenant_id, link_id, conversation_id,
      creation_transition_id, creation_revision, role_id
    ) values (
      ${input.link.tenantId}, ${input.link.id}, ${input.link.conversation.id},
      ${input.transition.id}, ${input.transition.resultingRevision},
      ${input.roleId}
    )
    returning link_id as id
  `;
}

export function buildInsertInboxV2ConversationClientLinkEvidenceSql(input: {
  link: InboxV2ConversationClientLink;
  purpose: "verification" | "audit";
  ordinal: number;
  evidence: InboxV2ConversationClientLink["auditEvidenceReferences"][number];
}): SQL {
  if (
    !Number.isInteger(input.ordinal) ||
    input.ordinal < 0 ||
    input.ordinal > 49
  ) {
    throw new CoreError(
      "validation.failed",
      "Client-link evidence ordinal must be between 0 and 49."
    );
  }
  const ids = {
    sourceIdentityClaimId:
      input.evidence.kind === "source_identity_claim"
        ? input.evidence.reference.id
        : null,
    clientContactId:
      input.evidence.kind === "client_contact"
        ? input.evidence.reference.id
        : null,
    conversationParticipantId:
      input.evidence.kind === "conversation_participant"
        ? input.evidence.reference.id
        : null,
    rawInboundEventId:
      input.evidence.kind === "raw_inbound_event"
        ? input.evidence.reference.id
        : null,
    normalizedInboundEventId:
      input.evidence.kind === "normalized_inbound_event"
        ? input.evidence.reference.id
        : null,
    sourceOccurrenceId:
      input.evidence.kind === "source_occurrence"
        ? input.evidence.reference.id
        : null
  };
  return sql`
    insert into inbox_v2_conversation_client_link_evidence_references (
      tenant_id, link_id, conversation_id, purpose, ordinal, evidence_kind,
      source_identity_claim_id, client_contact_id,
      conversation_participant_id, raw_inbound_event_id,
      normalized_inbound_event_id, source_occurrence_id
    ) values (
      ${input.link.tenantId}, ${input.link.id}, ${input.link.conversation.id},
      ${input.purpose}, ${input.ordinal}, ${input.evidence.kind},
      ${ids.sourceIdentityClaimId}, ${ids.clientContactId},
      ${ids.conversationParticipantId}, ${ids.rawInboundEventId},
      ${ids.normalizedInboundEventId}, ${ids.sourceOccurrenceId}
    )
    returning link_id as id
  `;
}

export function buildEndInboxV2ConversationClientLinkSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  linkId: InboxV2ConversationClientLinkId;
  decision: InboxV2ConversationClientLinkDecision;
  endedAt: string;
}): SQL {
  const actor = toActorColumns(input.decision);
  const authority = toPolicyAuthorityColumns(input.decision);
  return sql`
    update inbox_v2_conversation_client_links
    set state = 'ended',
        ended_at = ${input.endedAt},
        ended_actor_kind = ${actor.kind},
        ended_actor_employee_id = ${actor.employeeId},
        ended_actor_service_id = ${actor.serviceId},
        ended_policy_id = ${input.decision.policyId},
        ended_policy_version = ${input.decision.policyVersion},
        ended_reason_code_id = ${input.decision.reasonCodeId},
        ended_policy_family = ${authority.family},
        ended_policy_definition_contract_version = ${authority.definitionContractVersion},
        ended_policy_definition_digest_sha256 = ${authority.definitionDigestSha256},
        ended_policy_activation_head_revision = ${authority.activationHeadRevision},
        revision = 2
    where tenant_id = ${input.tenantId}
      and conversation_id = ${input.conversationId}
      and id = ${input.linkId}
      and state = 'active'
      and revision = 1
    returning id
  `;
}

export function buildInsertInboxV2ConversationClientLinkOperationSql(input: {
  transition: InboxV2ConversationClientLinkTransition;
  operation: NormalizedOperation;
}): SQL {
  const linkId =
    input.operation.kind === "create_link"
      ? input.operation.link.id
      : input.operation.linkId;
  return sql`
    insert into inbox_v2_conversation_client_link_transition_operations (
      tenant_id, transition_id, conversation_id,
      resulting_revision, link_id, operation_kind
    ) values (
      ${input.transition.tenantId}, ${input.transition.id},
      ${input.transition.conversation.id}, ${input.transition.resultingRevision},
      ${linkId}, ${input.operation.kind}
    )
    returning link_id as id
  `;
}

export function buildAdvanceInboxV2ConversationClientLinkHeadSql(
  transition: InboxV2ConversationClientLinkTransition
): SQL {
  if (transition.currentRevision === null) {
    return sql`
      insert into inbox_v2_conversation_client_link_heads (
        tenant_id, conversation_id, primary_link_id, revision, updated_at
      ) values (
        ${transition.tenantId}, ${transition.conversation.id},
        ${transition.resultingPrimaryLink?.id ?? null},
        ${transition.resultingRevision}, ${transition.occurredAt}
      )
      returning conversation_id as id
    `;
  }
  return sql`
    update inbox_v2_conversation_client_link_heads
    set primary_link_id = ${transition.resultingPrimaryLink?.id ?? null},
        revision = ${transition.resultingRevision},
        updated_at = ${transition.occurredAt}
    where tenant_id = ${transition.tenantId}
      and conversation_id = ${transition.conversation.id}
      and revision = ${transition.currentRevision}
    returning conversation_id as id
  `;
}

async function lockConversation(
  executor: RawSqlExecutor,
  input: Pick<NormalizedInput, "tenantId" | "conversationId">
): Promise<boolean> {
  const result = await executor.execute<IdRow>(
    buildLockInboxV2ConversationClientLinkConversationSql(input)
  );
  if (result.rows.length > 1)
    throw invariantError("Conversation lock was not unique.");
  return result.rows.length === 1;
}

async function lockHead(
  executor: RawSqlExecutor,
  input: Pick<NormalizedInput, "tenantId" | "conversationId">
): Promise<{
  revision: InboxV2EntityRevision | null;
  primaryLinkId: InboxV2ConversationClientLinkId | null;
}> {
  const result = await executor.execute<HeadRow>(
    buildLockInboxV2ConversationClientLinkHeadSql(input)
  );
  if (result.rows.length > 1)
    throw invariantError("Client-link head lock was not unique.");
  const row = result.rows[0];
  if (row === undefined) return { revision: null, primaryLinkId: null };
  return {
    revision: parseRevision(row.revision),
    primaryLinkId:
      row.primary_link_id === null
        ? null
        : inboxV2ConversationClientLinkIdSchema.parse(row.primary_link_id)
  };
}

async function lockAndValidateDecisionPolicyAuthority(
  executor: InboxV2TenantPolicyAuthorityUseTransaction,
  input: NormalizedInput
): Promise<Exclude<
  LockExactActiveInboxV2TenantPolicyAuthorityResult,
  { kind: "locked" }
> | null> {
  if (input.decision.actor.kind !== "trusted_service") return null;
  const authority = input.decision.policyAuthority;
  if (authority === null) {
    throw invariantError(
      "Trusted-service Client-link decision lost its policy authority after validation."
    );
  }
  const result = await lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
    executor,
    {
      tenantId: input.tenantId,
      family: "conversation_client_link",
      policyId: input.decision.policyId,
      policyVersion: input.decision.policyVersion,
      definitionContractVersion: authority.definitionContractVersion,
      definitionDigestSha256: authority.definitionDigestSha256 as never,
      approvedTrustedServiceId: input.decision.actor.trustedServiceId,
      expectedHeadRevision: authority.activationHeadRevision,
      occurredAt: input.occurredAt
    }
  );
  if (result.kind !== "locked") return result;
  if (result.headRevision !== authority.activationHeadRevision) {
    throw invariantError(
      "Tenant-policy lock returned a different Client-link authority revision."
    );
  }
  return null;
}

async function findLinksByIds(
  executor: RawSqlExecutor,
  input: Pick<NormalizedInput, "tenantId" | "conversationId">,
  linkIds: readonly string[]
): Promise<readonly ReturnType<typeof mapLinkRow>[]> {
  if (linkIds.length === 0) return [];
  const result = await executor.execute<LinkLockRow>(
    buildFindInboxV2ConversationClientLinksByIdsSql({
      ...input,
      linkIds,
      lock: false
    })
  );
  return result.rows.map(mapLinkRow);
}

async function findCurrentLinksByClientIds(
  executor: RawSqlExecutor,
  input: Pick<NormalizedInput, "tenantId" | "conversationId">,
  clientIds: readonly string[]
): Promise<readonly ReturnType<typeof mapLinkRow>[]> {
  if (clientIds.length === 0) return [];
  const result = await executor.execute<LinkLockRow>(
    buildFindCurrentInboxV2ConversationClientLinksByClientIdsSql({
      ...input,
      clientIds
    })
  );
  return result.rows.map(mapLinkRow);
}

async function lockClients(
  executor: RawSqlExecutor,
  tenantId: InboxV2TenantId,
  clientIds: readonly string[]
): Promise<ReadonlySet<string>> {
  if (clientIds.length === 0) return new Set();
  const result = await executor.execute<IdRow>(
    buildLockInboxV2ConversationClientLinkClientsSql({ tenantId, clientIds })
  );
  return new Set(result.rows.map((row) => String(row.id)));
}

async function lockLinks(
  executor: RawSqlExecutor,
  input: Pick<NormalizedInput, "tenantId" | "conversationId">,
  linkIds: readonly string[]
): Promise<readonly ReturnType<typeof mapLinkRow>[]> {
  if (linkIds.length === 0) return [];
  const result = await executor.execute<LinkLockRow>(
    buildFindInboxV2ConversationClientLinksByIdsSql({
      ...input,
      linkIds,
      lock: true
    })
  );
  return result.rows.map(mapLinkRow);
}

async function findConflictingCreatedLinkAfterRollback(
  executor: RawSqlExecutor,
  tenantId: InboxV2TenantId,
  linkIds: readonly InboxV2ConversationClientLinkId[]
): Promise<InboxV2ConversationClientLinkId | null> {
  if (linkIds.length === 0) return null;
  const candidates = uniqueSorted(linkIds).map((id) =>
    inboxV2ConversationClientLinkIdSchema.parse(id)
  );
  const candidateSet = new Set(candidates.map(String));
  const result = await executor.execute<IdRow>(
    buildFindConflictingInboxV2ConversationClientLinksSql({
      tenantId,
      linkIds: candidates
    })
  );
  const found = new Map<string, InboxV2ConversationClientLinkId>();
  for (const row of result.rows) {
    const id = inboxV2ConversationClientLinkIdSchema.parse(row.id);
    if (!candidateSet.has(String(id))) {
      throw invariantError(
        "Client-link conflict lookup returned an unexpected link."
      );
    }
    if (found.has(String(id))) {
      throw invariantError(
        "Client-link conflict lookup returned duplicate links."
      );
    }
    found.set(String(id), id);
  }
  return (
    [...found.values()].sort((left, right) =>
      String(left).localeCompare(String(right))
    )[0] ?? null
  );
}

async function lockAndValidateClaimAnchors(
  executor: RawSqlExecutor,
  input: NormalizedInput,
  createdLinks: readonly InboxV2ConversationClientLink[]
): Promise<
  | Readonly<{
      kind: "ready";
      anchors: ReadonlyMap<string, LockedClaimAnchor>;
    }>
  | Extract<
      ApplyInboxV2ConversationClientLinkTransitionResult,
      {
        kind:
          | "claim_not_found"
          | "claim_state_conflict"
          | "claim_target_conflict"
          | "claim_time_conflict"
          | "claim_evidence_scope_conflict";
      }
    >
> {
  const claimLinks = createdLinks.filter(
    (
      link
    ): link is InboxV2ConversationClientLink & {
      provenance: Extract<
        InboxV2ConversationClientLink["provenance"],
        { kind: "source_identity_claim" }
      >;
    } => link.provenance.kind === "source_identity_claim"
  );
  if (claimLinks.length === 0) {
    return { kind: "ready", anchors: new Map() };
  }

  const claimIds = uniqueSorted(
    claimLinks.map((link) => link.provenance.claim.id)
  ).map((id) => inboxV2SourceIdentityClaimIdSchema.parse(id));
  const preRead = await executor.execute<ClaimPreReadRow>(
    buildFindInboxV2ConversationClientLinkClaimAnchorsSql({
      tenantId: input.tenantId,
      claimIds
    })
  );
  const claimToIdentity = new Map<string, InboxV2SourceExternalIdentityId>();
  for (const row of preRead.rows) {
    const claimId = inboxV2SourceIdentityClaimIdSchema.parse(row.id);
    if (claimToIdentity.has(String(claimId))) {
      throw invariantError(
        "ConversationClientLink claim pre-read returned duplicate rows."
      );
    }
    claimToIdentity.set(
      String(claimId),
      inboxV2SourceExternalIdentityIdSchema.parse(
        row.source_external_identity_id
      )
    );
  }
  const missingClaimId = claimIds.find(
    (claimId) => !claimToIdentity.has(String(claimId))
  );
  if (missingClaimId !== undefined) {
    return { kind: "claim_not_found", claimId: missingClaimId };
  }

  const sourceExternalIdentityIds = uniqueSorted([
    ...claimToIdentity.values()
  ]).map((id) => inboxV2SourceExternalIdentityIdSchema.parse(id));
  const identityRows = await executor.execute<IdRow>(
    buildLockInboxV2ConversationClientLinkSourceIdentitiesSql({
      tenantId: input.tenantId,
      sourceExternalIdentityIds
    })
  );
  const lockedIdentityIds = new Set(
    identityRows.rows.map((row) =>
      String(inboxV2SourceExternalIdentityIdSchema.parse(row.id))
    )
  );
  const missingIdentityClaimId = claimIds.find((claimId) => {
    const identityId = claimToIdentity.get(String(claimId));
    return (
      identityId === undefined || !lockedIdentityIds.has(String(identityId))
    );
  });
  if (missingIdentityClaimId !== undefined) {
    return { kind: "claim_not_found", claimId: missingIdentityClaimId };
  }

  const headResult = await executor.execute<ClaimHeadLockRow>(
    buildLockInboxV2ConversationClientLinkClaimHeadsSql({
      tenantId: input.tenantId,
      sourceExternalIdentityIds
    })
  );
  const headsByIdentityId = new Map<string, ClaimHeadLockRow>();
  for (const row of headResult.rows) {
    const identityId = inboxV2SourceExternalIdentityIdSchema.parse(
      row.source_external_identity_id
    );
    if (headsByIdentityId.has(String(identityId))) {
      throw invariantError(
        "ConversationClientLink claim-head lock returned duplicate rows."
      );
    }
    headsByIdentityId.set(String(identityId), row);
  }

  const claimResult = await executor.execute<ClaimLockRow>(
    buildLockInboxV2ConversationClientLinkClaimsSql({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      claimIds
    })
  );
  const claimsById = new Map<string, ClaimLockRow>();
  for (const row of claimResult.rows) {
    const claimId = inboxV2SourceIdentityClaimIdSchema.parse(row.id);
    if (claimsById.has(String(claimId))) {
      throw invariantError(
        "ConversationClientLink claim lock returned duplicate rows."
      );
    }
    claimsById.set(String(claimId), row);
  }

  const anchors = new Map<string, LockedClaimAnchor>();
  for (const link of claimLinks) {
    const claimId = link.provenance.claim.id;
    const claimRow = claimsById.get(String(claimId));
    if (claimRow === undefined) {
      return { kind: "claim_not_found", claimId };
    }
    const sourceExternalIdentityId =
      inboxV2SourceExternalIdentityIdSchema.parse(
        claimRow.source_external_identity_id
      );
    if (
      String(sourceExternalIdentityId) !==
      String(claimToIdentity.get(String(claimId)))
    ) {
      throw invariantError(
        "ConversationClientLink locked claim changed its immutable identity."
      );
    }
    const claimVersion = parseClaimVersion(
      claimRow.claim_version,
      "ConversationClientLink SourceIdentityClaim version"
    );
    const head = headsByIdentityId.get(String(sourceExternalIdentityId));
    const headClaimVersion = parseNullableClaimVersion(
      head?.latest_claim_version ?? null,
      "ConversationClientLink SourceIdentityClaim head version"
    );
    if (
      head === undefined ||
      headClaimVersion === null ||
      BigInt(headClaimVersion) < BigInt(claimVersion)
    ) {
      return { kind: "claim_state_conflict", claimId };
    }
    if (
      claimRow.target_kind !== "client_contact" ||
      claimRow.target_employee_id !== null ||
      claimRow.target_client_contact_id === null
    ) {
      return { kind: "claim_target_conflict", claimId };
    }
    const createdAt = parseTimestamp(
      claimRow.created_at,
      "ConversationClientLink SourceIdentityClaim createdAt"
    );
    const revokedAt =
      claimRow.revoked_at === null
        ? null
        : parseTimestamp(
            claimRow.revoked_at,
            "ConversationClientLink SourceIdentityClaim revokedAt"
          );
    if (
      Date.parse(createdAt) > Date.parse(link.validFrom) ||
      Date.parse(createdAt) >
        Date.parse(link.provenance.verification.verifiedAt) ||
      (revokedAt !== null && Date.parse(revokedAt) < Date.parse(link.validFrom))
    ) {
      return { kind: "claim_time_conflict", claimId };
    }
    anchors.set(String(claimId), {
      id: claimId,
      sourceExternalIdentityId,
      claimVersion,
      targetClientContactId: inboxV2ClientContactIdSchema.parse(
        claimRow.target_client_contact_id
      )
    });
  }

  return { kind: "ready", anchors };
}

async function lockAndValidateActor(
  executor: RawSqlExecutor,
  input: NormalizedInput
): Promise<Extract<
  ApplyInboxV2ConversationClientLinkTransitionResult,
  { kind: "actor_not_found" | "actor_inactive" }
> | null> {
  if (input.decision.actor.kind !== "employee") return null;
  const employeeId = inboxV2EmployeeIdSchema.parse(
    input.decision.actor.employee.id
  );
  if (input.decision.actor.employee.tenantId !== input.tenantId) {
    return { kind: "actor_not_found", employeeId };
  }
  const result = await executor.execute<EmployeeLockRow>(
    buildLockInboxV2ConversationClientLinkEmployeesSql({
      tenantId: input.tenantId,
      employeeIds: [employeeId]
    })
  );
  if (result.rows.length > 1) {
    throw invariantError(
      "ConversationClientLink Employee fence returned multiple rows."
    );
  }
  const row = result.rows[0];
  if (row === undefined) return { kind: "actor_not_found", employeeId };
  if (String(inboxV2EmployeeIdSchema.parse(row.id)) !== String(employeeId)) {
    throw invariantError(
      "ConversationClientLink Employee fence returned an unexpected row."
    );
  }
  const createdAt = parseTimestamp(row.created_at, "Employee createdAt");
  const deactivatedAt =
    row.deactivated_at === null
      ? null
      : parseTimestamp(row.deactivated_at, "Employee deactivatedAt");
  if (
    Date.parse(createdAt) > Date.parse(input.occurredAt) ||
    (deactivatedAt !== null &&
      Date.parse(deactivatedAt) <= Date.parse(input.occurredAt))
  ) {
    return { kind: "actor_inactive", employeeId };
  }
  return null;
}

async function lockAndValidateClaimContacts(
  executor: RawSqlExecutor,
  input: NormalizedInput,
  createdLinks: readonly InboxV2ConversationClientLink[],
  anchors: ReadonlyMap<string, LockedClaimAnchor>
): Promise<Readonly<{
  kind: "claim_target_conflict";
  claimId: InboxV2SourceIdentityClaimId;
}> | null> {
  if (anchors.size === 0) return null;
  const contactIds = uniqueSorted(
    [...anchors.values()].map((anchor) => anchor.targetClientContactId)
  ).map((id) => inboxV2ClientContactIdSchema.parse(id));
  const result = await executor.execute<ClientContactLockRow>(
    buildLockInboxV2ConversationClientLinkClientContactsSql({
      tenantId: input.tenantId,
      clientContactIds: contactIds
    })
  );
  const contactsById = new Map<string, InboxV2ClientId>();
  for (const row of result.rows) {
    const contactId = inboxV2ClientContactIdSchema.parse(row.id);
    if (contactsById.has(String(contactId))) {
      throw invariantError(
        "ConversationClientLink ClientContact fence returned duplicate rows."
      );
    }
    contactsById.set(
      String(contactId),
      inboxV2ClientIdSchema.parse(row.client_id)
    );
  }
  for (const link of createdLinks) {
    if (link.provenance.kind !== "source_identity_claim") continue;
    const anchor = anchors.get(String(link.provenance.claim.id));
    if (anchor === undefined) {
      throw invariantError(
        "ConversationClientLink claim contact validation lost its anchor."
      );
    }
    if (
      String(contactsById.get(String(anchor.targetClientContactId))) !==
      String(link.client.id)
    ) {
      return {
        kind: "claim_target_conflict",
        claimId: link.provenance.claim.id
      };
    }
  }
  return null;
}

async function lockAndValidateEvidenceGraphs(
  executor: RawSqlExecutor,
  input: NormalizedInput,
  createdLinks: readonly InboxV2ConversationClientLink[]
): Promise<Extract<
  ApplyInboxV2ConversationClientLinkTransitionResult,
  { kind: "evidence_not_found" | "evidence_scope_conflict" }
> | null> {
  const entriesByLink = new Map<string, readonly LinkEvidenceEntry[]>();
  const allEntries: LinkEvidenceEntry[] = [];
  for (const link of createdLinks) {
    const entries: LinkEvidenceEntry[] = [];
    if (
      link.provenance.kind === "source_identity_claim" ||
      link.provenance.kind === "trusted_policy"
    ) {
      for (const [
        ordinal,
        evidence
      ] of link.provenance.verification.evidenceReferences.entries()) {
        entries.push({ purpose: "verification", ordinal, evidence });
      }
    }
    for (const [ordinal, evidence] of link.auditEvidenceReferences.entries()) {
      entries.push({ purpose: "audit", ordinal, evidence });
    }
    entriesByLink.set(String(link.id), entries);
    allEntries.push(...entries);
  }
  if (allEntries.length === 0) return null;

  const idsFor = (kind: LinkEvidenceReference["kind"]): string[] =>
    uniqueSorted(
      allEntries
        .filter((entry) => entry.evidence.kind === kind)
        .map((entry) => entry.evidence.reference.id)
    );
  const claimIds = idsFor("source_identity_claim");
  const claimRows = new Map<string, EvidenceClaimLockRow>();
  if (claimIds.length > 0) {
    const result = await executor.execute<EvidenceClaimLockRow>(
      buildLockInboxV2ConversationClientLinkEvidenceClaimsSql({
        tenantId: input.tenantId,
        ids: claimIds
      })
    );
    addUniqueRows(claimRows, result.rows, "evidence SourceIdentityClaim");
  }

  const contactIds = uniqueSorted([
    ...idsFor("client_contact"),
    ...[...claimRows.values()]
      .filter((row) => row.target_client_contact_id !== null)
      .map((row) => String(row.target_client_contact_id))
  ]).map((id) => inboxV2ClientContactIdSchema.parse(id));
  const contactRows = new Map<string, ClientContactLockRow>();
  if (contactIds.length > 0) {
    const result = await executor.execute<ClientContactLockRow>(
      buildLockInboxV2ConversationClientLinkClientContactsSql({
        tenantId: input.tenantId,
        clientContactIds: contactIds
      })
    );
    addUniqueRows(contactRows, result.rows, "evidence ClientContact");
  }

  const participantRows = new Map<string, EvidenceParticipantLockRow>();
  const participantIds = idsFor("conversation_participant");
  if (participantIds.length > 0) {
    const result = await executor.execute<EvidenceParticipantLockRow>(
      buildLockInboxV2ConversationClientLinkEvidenceParticipantsSql({
        tenantId: input.tenantId,
        ids: participantIds
      })
    );
    addUniqueRows(
      participantRows,
      result.rows,
      "evidence ConversationParticipant"
    );
  }

  const rawRows = new Map<string, IdRow>();
  const rawIds = idsFor("raw_inbound_event");
  if (rawIds.length > 0) {
    const result = await executor.execute<IdRow>(
      buildLockInboxV2ConversationClientLinkEvidenceRawEventsSql({
        tenantId: input.tenantId,
        ids: rawIds
      })
    );
    addUniqueRows(rawRows, result.rows, "evidence RawInboundEvent");
  }

  const normalizedRows = new Map<string, EvidenceNormalizedEventLockRow>();
  const normalizedIds = idsFor("normalized_inbound_event");
  if (normalizedIds.length > 0) {
    const result = await executor.execute<EvidenceNormalizedEventLockRow>(
      buildLockInboxV2ConversationClientLinkEvidenceNormalizedEventsSql({
        tenantId: input.tenantId,
        ids: normalizedIds
      })
    );
    addUniqueRows(
      normalizedRows,
      result.rows,
      "evidence NormalizedInboundEvent"
    );
  }

  const occurrenceRows = new Map<string, EvidenceOccurrenceLockRow>();
  const occurrenceIds = idsFor("source_occurrence");
  if (occurrenceIds.length > 0) {
    const result = await executor.execute<EvidenceOccurrenceLockRow>(
      buildLockInboxV2ConversationClientLinkEvidenceOccurrencesSql({
        tenantId: input.tenantId,
        ids: occurrenceIds
      })
    );
    addUniqueRows(occurrenceRows, result.rows, "evidence SourceOccurrence");
  }

  for (const link of createdLinks) {
    const entries = entriesByLink.get(String(link.id)) ?? [];
    for (const purpose of ["verification", "audit"] as const) {
      const purposeEntries = entries.filter(
        (entry) => entry.purpose === purpose
      );
      const seen = new Set<string>();
      for (const entry of purposeEntries) {
        const key = `${entry.evidence.kind}\u0000${entry.evidence.reference.id}`;
        if (seen.has(key))
          return evidenceConflict("evidence_scope_conflict", link, entry);
        seen.add(key);
        const rows = evidenceRowsForKind(entry.evidence.kind, {
          claims: claimRows,
          contacts: contactRows,
          participants: participantRows,
          rawEvents: rawRows,
          normalizedEvents: normalizedRows,
          occurrences: occurrenceRows
        });
        if (!rows.has(String(entry.evidence.reference.id))) {
          return evidenceConflict("evidence_not_found", link, entry);
        }
      }
      const conflict = validateEvidencePurposeGraph({
        link,
        purpose,
        entries: purposeEntries,
        claims: claimRows,
        contacts: contactRows,
        participants: participantRows,
        rawEvents: rawRows,
        normalizedEvents: normalizedRows,
        occurrences: occurrenceRows
      });
      if (conflict !== null) return conflict;
    }
  }
  return null;
}

type EvidenceMaps = Readonly<{
  claims: ReadonlyMap<string, EvidenceClaimLockRow>;
  contacts: ReadonlyMap<string, ClientContactLockRow>;
  participants: ReadonlyMap<string, EvidenceParticipantLockRow>;
  rawEvents: ReadonlyMap<string, IdRow>;
  normalizedEvents: ReadonlyMap<string, EvidenceNormalizedEventLockRow>;
  occurrences: ReadonlyMap<string, EvidenceOccurrenceLockRow>;
}>;

function validateEvidencePurposeGraph(
  input: EvidenceMaps &
    Readonly<{
      link: InboxV2ConversationClientLink;
      purpose: "verification" | "audit";
      entries: readonly LinkEvidenceEntry[];
    }>
): Extract<
  ApplyInboxV2ConversationClientLinkTransitionResult,
  { kind: "evidence_scope_conflict" }
> | null {
  const byKind = new Map<LinkEvidenceReference["kind"], LinkEvidenceEntry[]>();
  for (const entry of input.entries) {
    const existing = byKind.get(entry.evidence.kind) ?? [];
    existing.push(entry);
    byKind.set(entry.evidence.kind, existing);
  }
  const entriesOf = (
    kind: LinkEvidenceReference["kind"]
  ): LinkEvidenceEntry[] => byKind.get(kind) ?? [];
  const claims = entriesOf("source_identity_claim");
  const contacts = entriesOf("client_contact");
  const participants = entriesOf("conversation_participant");
  const occurrences = entriesOf("source_occurrence");

  const contactBelongsToClient = (id: string): boolean =>
    String(input.contacts.get(id)?.client_id) === String(input.link.client.id);
  const claimBelongsToClient = (row: EvidenceClaimLockRow): boolean => {
    const contactId = row.target_client_contact_id;
    return (
      row.target_kind === "client_contact" &&
      contactId !== null &&
      contactBelongsToClient(String(contactId))
    );
  };
  const claimIsActiveAtLink = (row: EvidenceClaimLockRow): boolean =>
    Date.parse(parseTimestamp(row.created_at, "evidence claim createdAt")) <=
      Date.parse(input.link.validFrom) &&
    (row.revoked_at === null ||
      Date.parse(parseTimestamp(row.revoked_at, "evidence claim revokedAt")) >=
        Date.parse(input.link.validFrom));

  for (const entry of input.entries) {
    const id = String(entry.evidence.reference.id);
    if (entry.evidence.kind === "source_identity_claim") {
      const row = input.claims.get(id);
      if (
        row === undefined ||
        !claimBelongsToClient(row) ||
        (input.purpose === "verification" && !claimIsActiveAtLink(row))
      ) {
        return evidenceConflict("evidence_scope_conflict", input.link, entry);
      }
    } else if (entry.evidence.kind === "client_contact") {
      if (!contactBelongsToClient(id)) {
        return evidenceConflict("evidence_scope_conflict", input.link, entry);
      }
    } else if (entry.evidence.kind === "conversation_participant") {
      const row = input.participants.get(id);
      if (String(row?.conversation_id) !== String(input.link.conversation.id)) {
        return evidenceConflict("evidence_scope_conflict", input.link, entry);
      }
    } else if (entry.evidence.kind === "source_occurrence") {
      const row = input.occurrences.get(id);
      if (String(row?.conversation_id) !== String(input.link.conversation.id)) {
        return evidenceConflict("evidence_scope_conflict", input.link, entry);
      }
    } else if (entry.evidence.kind === "raw_inbound_event") {
      if (
        !occurrences.some(
          (occurrence) =>
            String(
              input.occurrences.get(String(occurrence.evidence.reference.id))
                ?.raw_inbound_event_id
            ) === id
        )
      ) {
        return evidenceConflict("evidence_scope_conflict", input.link, entry);
      }
    } else if (
      !occurrences.some(
        (occurrence) =>
          String(
            input.occurrences.get(String(occurrence.evidence.reference.id))
              ?.normalized_inbound_event_id
          ) === id
      )
    ) {
      return evidenceConflict("evidence_scope_conflict", input.link, entry);
    }
  }

  if (input.purpose === "audit" || input.entries.length === 0) return null;

  for (const entry of contacts) {
    const contactId = String(entry.evidence.reference.id);
    if (
      !participants.some((participant) => {
        const row = input.participants.get(
          String(participant.evidence.reference.id)
        );
        return (
          row?.subject_kind === "client_contact" &&
          String(row.subject_client_contact_id) === contactId
        );
      })
    ) {
      return evidenceConflict("evidence_scope_conflict", input.link, entry);
    }
  }

  for (const entry of claims) {
    const claim = input.claims.get(String(entry.evidence.reference.id));
    const identityId = String(claim?.source_external_identity_id);
    const hasIdentityParticipant = participants.some((participant) => {
      const row = input.participants.get(
        String(participant.evidence.reference.id)
      );
      return (
        row?.subject_kind === "source_external_identity" &&
        String(row.subject_source_external_identity_id) === identityId
      );
    });
    const hasIdentityOccurrence = occurrences.some(
      (occurrence) =>
        String(
          input.occurrences.get(String(occurrence.evidence.reference.id))
            ?.provider_actor_source_external_identity_id
        ) === identityId
    );
    if (!hasIdentityParticipant && !hasIdentityOccurrence) {
      return evidenceConflict("evidence_scope_conflict", input.link, entry);
    }
  }

  for (const entry of participants) {
    const row = input.participants.get(String(entry.evidence.reference.id));
    const isContactBridge =
      row?.subject_kind === "client_contact" &&
      contacts.some(
        (contact) =>
          String(contact.evidence.reference.id) ===
          String(row.subject_client_contact_id)
      );
    const isIdentityBridge =
      row?.subject_kind === "source_external_identity" &&
      claims.some((claim) => {
        const claimRow = input.claims.get(String(claim.evidence.reference.id));
        return (
          String(claimRow?.source_external_identity_id) ===
          String(row.subject_source_external_identity_id)
        );
      });
    if (!isContactBridge && !isIdentityBridge) {
      return evidenceConflict("evidence_scope_conflict", input.link, entry);
    }
  }

  for (const entry of occurrences) {
    const row = input.occurrences.get(String(entry.evidence.reference.id));
    if (
      row?.provider_actor_source_external_identity_id === null ||
      !claims.some((claim) => {
        const claimRow = input.claims.get(String(claim.evidence.reference.id));
        return (
          String(claimRow?.source_external_identity_id) ===
          String(row?.provider_actor_source_external_identity_id)
        );
      })
    ) {
      return evidenceConflict("evidence_scope_conflict", input.link, entry);
    }
  }

  const hasContactBridge = contacts.length > 0 && participants.length > 0;
  const hasIdentityBridge =
    claims.length > 0 && (participants.length > 0 || occurrences.length > 0);
  if (!hasContactBridge && !hasIdentityBridge) {
    return evidenceConflict(
      "evidence_scope_conflict",
      input.link,
      input.entries[0] as LinkEvidenceEntry
    );
  }
  return null;
}

function evidenceRowsForKind(
  kind: LinkEvidenceReference["kind"],
  maps: EvidenceMaps
): ReadonlyMap<string, { id: unknown }> {
  switch (kind) {
    case "source_identity_claim":
      return maps.claims;
    case "client_contact":
      return maps.contacts;
    case "conversation_participant":
      return maps.participants;
    case "raw_inbound_event":
      return maps.rawEvents;
    case "normalized_inbound_event":
      return maps.normalizedEvents;
    case "source_occurrence":
      return maps.occurrences;
  }
}

function evidenceConflict<
  TKind extends "evidence_not_found" | "evidence_scope_conflict"
>(kind: TKind, link: InboxV2ConversationClientLink, entry: LinkEvidenceEntry) {
  return {
    kind,
    linkId: link.id,
    purpose: entry.purpose,
    ordinal: entry.ordinal
  } as const;
}

function addUniqueRows<TRow extends { id: unknown }>(
  target: Map<string, TRow>,
  rows: readonly TRow[],
  label: string
): void {
  for (const row of rows) {
    const id = String(row.id);
    if (target.has(id)) {
      throw invariantError(
        `ConversationClientLink ${label} lock duplicated an ID.`
      );
    }
    target.set(id, row);
  }
}

function normalizeApplyInput(
  input: ApplyInboxV2ConversationClientLinkTransitionInput
): NormalizedInput {
  assertExactKeys(input, APPLY_KEYS, "ConversationClientLink apply input");
  if (!Array.isArray(input.operations) || input.operations.length > 100) {
    throw new CoreError(
      "validation.failed",
      "Client-link operations must be a bounded array."
    );
  }

  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const conversationId = inboxV2ConversationIdSchema.parse(
    input.conversationId
  );
  const transitionId = inboxV2ConversationClientLinkTransitionIdSchema.parse(
    input.transitionId
  );
  const expectedRevision =
    input.expectedRevision === null
      ? null
      : inboxV2EntityRevisionSchema.parse(input.expectedRevision);
  const decision = inboxV2ConversationClientLinkDecisionSchema.parse(
    input.decision
  );
  const occurredAt = inboxV2TimestampSchema.parse(input.occurredAt);
  const resultingPrimaryLinkId =
    input.resultingPrimaryLinkId === null
      ? null
      : inboxV2ConversationClientLinkIdSchema.parse(
          input.resultingPrimaryLinkId
        );

  const operations = input.operations.map((operation): NormalizedOperation => {
    if (operation.kind === "create_link") {
      assertExactKeys(
        operation,
        new Set(["kind", "link"]),
        "create-link operation"
      );
      const link = inboxV2ConversationClientLinkSchema.parse(operation.link);
      if (
        link.tenantId !== tenantId ||
        link.conversation.id !== conversationId ||
        link.state !== "active" ||
        link.revision !== "1" ||
        link.termination !== null ||
        link.validFrom !== occurredAt ||
        !sameDecision(link.linkedBy, decision) ||
        !isSupportedCreateLinkProvenance(link, decision)
      ) {
        throw new CoreError(
          "validation.failed",
          "ConversationClientLink accepts only exact active links with compatible provenance, actor and evidence."
        );
      }
      return { kind: "create_link", link };
    }
    if (operation.kind === "end_link") {
      assertExactKeys(
        operation,
        new Set(["kind", "linkId"]),
        "end-link operation"
      );
      return {
        kind: "end_link",
        linkId: inboxV2ConversationClientLinkIdSchema.parse(operation.linkId)
      };
    }
    throw new CoreError(
      "validation.failed",
      "Unsupported Client-link operation."
    );
  });

  const keys = operations.map((operation) =>
    String(
      operation.kind === "create_link" ? operation.link.id : operation.linkId
    )
  );
  if (new Set(keys).size !== keys.length) {
    throw new CoreError(
      "validation.failed",
      "One transition cannot repeat a Client link."
    );
  }

  return {
    tenantId,
    conversationId,
    transitionId,
    expectedRevision,
    decision,
    operations: [...operations].sort((left, right) =>
      operationId(left).localeCompare(operationId(right))
    ),
    resultingPrimaryLinkId,
    occurredAt
  };
}

function isSupportedCreateLinkProvenance(
  link: InboxV2ConversationClientLink,
  decision: InboxV2ConversationClientLinkDecision
): boolean {
  if (link.provenance.kind === "manual") {
    return decision.actor.kind === "employee";
  }
  if (link.provenance.kind === "migration") {
    return decision.actor.kind === "migration_service";
  }
  if (
    link.associationConfidence !== "confirmed" ||
    link.validFromBasis !== "known_effective"
  ) {
    return false;
  }

  if (link.provenance.kind === "trusted_policy") {
    return decision.actor.kind === "trusted_service";
  }
  if (link.provenance.kind !== "source_identity_claim") return false;

  const evidence = link.provenance.verification.evidenceReferences;
  const claimId = link.provenance.claim.id;
  return (
    (decision.actor.kind === "employee" ||
      decision.actor.kind === "trusted_service") &&
    evidence.some(
      (item) =>
        item.kind === "source_identity_claim" &&
        item.reference.tenantId === link.tenantId &&
        item.reference.id === claimId
    ) &&
    link.provenance.claim.tenantId === link.tenantId &&
    Date.parse(link.provenance.verification.verifiedAt) <=
      Date.parse(link.validFrom)
  );
}

function validateResultingPrimary(input: {
  resultingPrimaryLinkId: InboxV2ConversationClientLinkId | null;
  createdLinks: readonly InboxV2ConversationClientLink[];
  endedIds: readonly InboxV2ConversationClientLinkId[];
  linksById: ReadonlyMap<string, ReturnType<typeof mapLinkRow>>;
}): Readonly<{
  kind: "link_not_found" | "link_state_conflict";
  linkId: InboxV2ConversationClientLinkId;
}> | null {
  if (input.resultingPrimaryLinkId === null) return null;
  const id = String(input.resultingPrimaryLinkId);
  const created = input.createdLinks.find((link) => String(link.id) === id);
  if (created !== undefined) {
    if (
      created.associationConfidence !== "confirmed" ||
      created.provenance.kind === "migration" ||
      created.roleIds.includes("core:legacy-unspecified" as never)
    ) {
      return {
        kind: "link_state_conflict",
        linkId: input.resultingPrimaryLinkId
      };
    }
    return null;
  }
  const existing = input.linksById.get(id);
  if (existing === undefined) {
    return { kind: "link_not_found", linkId: input.resultingPrimaryLinkId };
  }
  if (
    existing.state !== "active" ||
    input.endedIds.some((linkId) => String(linkId) === id) ||
    existing.associationConfidence !== "confirmed" ||
    existing.provenanceKind === "migration" ||
    existing.legacyRoleCount !== 0
  ) {
    return {
      kind: "link_state_conflict",
      linkId: input.resultingPrimaryLinkId
    };
  }
  return null;
}

function mapLinkRow(row: LinkLockRow) {
  const id = inboxV2ConversationClientLinkIdSchema.parse(row.id);
  const clientId = inboxV2ClientIdSchema.parse(row.client_id);
  if (row.state !== "active" && row.state !== "ended") {
    throw invariantError("Client-link row has invalid state.");
  }
  if (
    !["confirmed", "supported", "tentative"].includes(
      String(row.association_confidence)
    )
  ) {
    throw invariantError("Client-link row has invalid confidence.");
  }
  if (
    row.provenance_kind !== "manual" &&
    row.provenance_kind !== "migration" &&
    row.provenance_kind !== "source_identity_claim" &&
    row.provenance_kind !== "trusted_policy"
  ) {
    throw invariantError("Client-link row has unsupported provenance.");
  }
  const claimAnchorColumns = [
    row.provenance_claim_id,
    row.provenance_claim_version,
    row.provenance_claim_target_client_contact_id
  ];
  const verificationBaseColumns = [
    row.provenance_verification_service_id,
    row.provenance_verification_policy_id,
    row.provenance_verification_policy_version,
    row.provenance_verification_verified_at
  ];
  const verificationAuthorityColumns = [
    row.provenance_verification_policy_family,
    row.provenance_verification_definition_contract_version,
    row.provenance_verification_definition_digest_sha256,
    row.provenance_verification_activation_head_revision
  ];
  const verificationColumns = [
    ...verificationBaseColumns,
    ...verificationAuthorityColumns
  ];
  const migrationColumns = [
    row.provenance_migration_id,
    row.provenance_contract_version
  ];
  if (row.provenance_kind === "manual") {
    if (
      claimAnchorColumns.some((value) => value !== null) ||
      verificationColumns.some((value) => value !== null) ||
      migrationColumns.some((value) => value !== null)
    ) {
      throw invariantError(
        "Manual Client-link row contains provenance anchors."
      );
    }
  } else if (row.provenance_kind === "migration") {
    if (
      claimAnchorColumns.some((value) => value !== null) ||
      verificationColumns.some((value) => value !== null) ||
      migrationColumns.some((value) => value === null || value === undefined)
    ) {
      throw invariantError(
        "Migration Client-link row has invalid provenance anchors."
      );
    }
    inboxV2ConversationClientLinkMigrationProvenanceIdSchema.parse(
      row.provenance_migration_id
    );
    inboxV2SchemaVersionTokenSchema.parse(row.provenance_contract_version);
  } else if (row.provenance_kind === "source_identity_claim") {
    if (
      migrationColumns.some((value) => value !== null) ||
      claimAnchorColumns.some(
        (value) => value === null || value === undefined
      ) ||
      verificationBaseColumns.some(
        (value) => value === null || value === undefined
      ) ||
      (!verificationAuthorityColumns.every((value) => value === null) &&
        verificationAuthorityColumns.some(
          (value) => value === null || value === undefined
        ))
    ) {
      throw invariantError(
        "Claim Client-link row has invalid provenance anchors."
      );
    }
    inboxV2SourceIdentityClaimIdSchema.parse(row.provenance_claim_id);
    parseClaimVersion(
      row.provenance_claim_version,
      "ConversationClientLink persisted SourceIdentityClaim version"
    );
    inboxV2ClientContactIdSchema.parse(
      row.provenance_claim_target_client_contact_id
    );
    inboxV2TrustedServiceIdSchema.parse(row.provenance_verification_service_id);
    parseTimestamp(
      row.provenance_verification_verified_at,
      "ConversationClientLink persisted verification time"
    );
  } else if (
    claimAnchorColumns.some((value) => value !== null) ||
    migrationColumns.some((value) => value !== null) ||
    verificationColumns.some((value) => value === null || value === undefined)
  ) {
    throw invariantError(
      "Trusted-policy Client-link row has invalid provenance anchors."
    );
  }

  if (
    row.provenance_kind === "source_identity_claim" ||
    row.provenance_kind === "trusted_policy"
  ) {
    inboxV2TrustedServiceIdSchema.parse(row.provenance_verification_service_id);
    inboxV2ConversationClientLinkPolicyIdSchema.parse(
      row.provenance_verification_policy_id
    );
    inboxV2SchemaVersionTokenSchema.parse(
      row.provenance_verification_policy_version
    );
    if (verificationAuthorityColumns.every((value) => value !== null)) {
      inboxV2ConversationClientLinkPolicyAuthoritySchema.parse({
        family: row.provenance_verification_policy_family,
        definitionContractVersion:
          row.provenance_verification_definition_contract_version,
        definitionDigestSha256:
          row.provenance_verification_definition_digest_sha256,
        activationHeadRevision: String(
          row.provenance_verification_activation_head_revision
        )
      });
    }
  }

  if (
    row.provenance_kind === "trusted_policy" ||
    (row.provenance_kind === "source_identity_claim" &&
      row.linked_actor_kind === "trusted_service")
  ) {
    if (
      row.linked_actor_kind !== "trusted_service" ||
      row.linked_actor_service_id === null ||
      row.linked_policy_family === null ||
      row.linked_policy_definition_contract_version === null ||
      row.linked_policy_definition_digest_sha256 === null ||
      row.linked_policy_activation_head_revision === null ||
      String(row.linked_actor_service_id) !==
        String(row.provenance_verification_service_id) ||
      String(row.linked_policy_id) !==
        String(row.provenance_verification_policy_id) ||
      String(row.linked_policy_version) !==
        String(row.provenance_verification_policy_version) ||
      String(row.linked_policy_family) !==
        String(row.provenance_verification_policy_family) ||
      String(row.linked_policy_definition_contract_version) !==
        String(row.provenance_verification_definition_contract_version) ||
      String(row.linked_policy_definition_digest_sha256) !==
        String(row.provenance_verification_definition_digest_sha256) ||
      String(row.linked_policy_activation_head_revision) !==
        String(row.provenance_verification_activation_head_revision)
    ) {
      throw invariantError(
        "Trusted Client-link row has mismatched policy authority anchors."
      );
    }
    inboxV2TrustedServiceIdSchema.parse(row.linked_actor_service_id);
    inboxV2ConversationClientLinkPolicyIdSchema.parse(row.linked_policy_id);
    inboxV2SchemaVersionTokenSchema.parse(row.linked_policy_version);
    inboxV2ConversationClientLinkPolicyAuthoritySchema.parse({
      family: row.linked_policy_family,
      definitionContractVersion: row.linked_policy_definition_contract_version,
      definitionDigestSha256: row.linked_policy_definition_digest_sha256,
      activationHeadRevision: String(row.linked_policy_activation_head_revision)
    });
  }
  const legacyRoleCount = Number(row.legacy_role_count);
  if (!Number.isSafeInteger(legacyRoleCount) || legacyRoleCount < 0) {
    throw invariantError("Client-link row has invalid role count.");
  }
  return {
    id: String(id),
    clientId,
    state: row.state,
    associationConfidence: row.association_confidence as
      | "confirmed"
      | "supported"
      | "tentative",
    provenanceKind: row.provenance_kind,
    legacyRoleCount
  } as const;
}

function toActorColumns(decision: InboxV2ConversationClientLinkDecision): {
  kind: "employee" | "trusted_service" | "migration_service";
  employeeId: string | null;
  serviceId: string | null;
} {
  if (decision.actor.kind === "employee") {
    return {
      kind: "employee",
      employeeId: decision.actor.employee.id,
      serviceId: null
    };
  }
  if (decision.actor.kind === "migration_service") {
    return {
      kind: "migration_service",
      employeeId: null,
      serviceId: decision.actor.trustedServiceId
    };
  }
  return {
    kind: "trusted_service",
    employeeId: null,
    serviceId: decision.actor.trustedServiceId
  };
}

function toPolicyAuthorityColumns(
  decision: InboxV2ConversationClientLinkDecision
): {
  family: "conversation_client_link" | null;
  definitionContractVersion: string | null;
  definitionDigestSha256: string | null;
  activationHeadRevision: string | null;
} {
  const authority = decision.policyAuthority;
  return authority === null
    ? {
        family: null,
        definitionContractVersion: null,
        definitionDigestSha256: null,
        activationHeadRevision: null
      }
    : {
        family: authority.family,
        definitionContractVersion: authority.definitionContractVersion,
        definitionDigestSha256: authority.definitionDigestSha256,
        activationHeadRevision: authority.activationHeadRevision
      };
}

function toLinkReference(
  tenantId: InboxV2TenantId,
  id: InboxV2ConversationClientLinkId | null
) {
  return id === null
    ? null
    : { tenantId, kind: "conversation_client_link" as const, id };
}

function sameDecision(
  left: InboxV2ConversationClientLinkDecision,
  right: InboxV2ConversationClientLinkDecision
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function incrementRevision(
  current: InboxV2EntityRevision | null
): InboxV2EntityRevision {
  const next = current === null ? 1n : BigInt(current) + 1n;
  if (next > 9_223_372_036_854_775_807n) {
    throw invariantError(
      "ConversationClientLink revision exceeds PostgreSQL bigint."
    );
  }
  return inboxV2EntityRevisionSchema.parse(next.toString());
}

function parseRevision(value: unknown): InboxV2EntityRevision {
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw invariantError("Client-link head contains an invalid revision.");
  }
  return inboxV2EntityRevisionSchema.parse(String(value));
}

function parseClaimVersion(
  value: unknown,
  label: string
): InboxV2SourceIdentityClaimVersion {
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw invariantError(`${label} is invalid.`);
  }
  const parsed = inboxV2SourceIdentityClaimVersionSchema.safeParse(
    String(value)
  );
  if (!parsed.success) throw invariantError(`${label} is invalid.`);
  return parsed.data;
}

function parseNullableClaimVersion(
  value: unknown,
  label: string
): InboxV2SourceIdentityClaimVersion | null {
  return value === null ? null : parseClaimVersion(value, label);
}

function parseTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw invariantError(`${label} is invalid.`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw invariantError(`${label} is invalid.`);
  }
  const parsed = inboxV2TimestampSchema.safeParse(date.toISOString());
  if (!parsed.success) throw invariantError(`${label} is invalid.`);
  return parsed.data;
}

function mergeLinkRows(rows: readonly ReturnType<typeof mapLinkRow>[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()].sort(
    (left, right) => left.id.localeCompare(right.id)
  );
}

function uniqueSorted(
  values: readonly (string | { toString(): string })[]
): string[] {
  return [...new Set(values.map(String))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function operationId(operation: NormalizedOperation): string {
  return String(
    operation.kind === "create_link" ? operation.link.id : operation.linkId
  );
}

function sqlList(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  );
}

function requireNonEmpty(values: readonly unknown[], label: string): void {
  if (values.length === 0) {
    throw new CoreError("validation.failed", `${label} cannot be empty.`);
  }
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

async function runLinkTransaction<TResult>(
  executor: InboxV2ConversationClientLinkTransactionExecutor,
  work: (
    transaction: InboxV2TenantPolicyAuthorityUseTransaction
  ) => Promise<TResult>
): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LINK_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await executor.transaction(work, LINK_TRANSACTION_CONFIG);
    } catch (error) {
      lastError = error;
      if (
        !isRetryableLinkTransactionError(error) ||
        attempt === LINK_TRANSACTION_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

function isRetryableLinkTransactionError(error: unknown): boolean {
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
    if (typeof code === "string" && RETRYABLE_SQLSTATES.has(code)) return true;
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
      if (typeof constraint === "string") return constraint;
    }
    current = Reflect.get(current, "cause");
  }

  return null;
}

function assertExactKeys(
  value: object,
  allowed: ReadonlySet<string>,
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length !== 0) {
    throw new CoreError(
      "validation.failed",
      `${label} contains unknown fields.`
    );
  }
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlQueryResult };
