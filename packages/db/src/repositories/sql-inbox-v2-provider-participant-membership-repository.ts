import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationParticipantIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2ParticipantMembershipEpisodeIdSchema,
  inboxV2ParticipantMembershipEpisodeSchema,
  inboxV2ParticipantMembershipRoleSchema,
  inboxV2ParticipantMembershipTransitionIdSchema,
  inboxV2ParticipantMembershipTransitionSchema,
  inboxV2ProviderRosterEvidenceIdSchema,
  inboxV2ProviderRosterMemberEvidenceIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2BigintCounter,
  type InboxV2ConversationId,
  type InboxV2ConversationParticipantId,
  type InboxV2EntityRevision,
  type InboxV2ParticipantMembershipEpisode,
  type InboxV2ParticipantMembershipEpisodeId,
  type InboxV2ParticipantMembershipReasonId,
  type InboxV2ParticipantMembershipRole,
  type InboxV2ParticipantMembershipTransitionId,
  type InboxV2ProviderRosterEvidenceId,
  type InboxV2ProviderRosterMemberEvidenceId,
  type InboxV2SourceExternalIdentityId,
  type InboxV2SourceThreadBindingId,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import {
  buildAdvanceInboxV2ConversationMembershipHeadSql,
  buildInsertInboxV2ConversationMembershipCommitSql,
  buildLockInboxV2ConversationMembershipHeadSql,
  type InboxV2ParticipantMembershipMutationRecord,
  type InboxV2ParticipantMembershipTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-participant-membership-repository";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const TRANSACTION_CONFIG = { isolationLevel: "read committed" } as const;
const TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const START_KEYS = new Set([
  "tenantId",
  "conversationId",
  "participantId",
  "episodeId",
  "transitionId",
  "rosterEvidenceId",
  "memberEvidenceId",
  "sourceThreadBindingId",
  "sourceExternalIdentityId",
  "role",
  "reasonCodeId",
  "expectedMembershipRevision",
  "occurredAt"
]);
const TRANSITION_KEYS = new Set([
  "tenantId",
  "conversationId",
  "episodeId",
  "transitionId",
  "evidence",
  "intent",
  "nextRole",
  "reasonCodeId",
  "expectedMembershipRevision",
  "expectedEpisodeRevision",
  "occurredAt"
]);
const MEMBER_EVIDENCE_KEYS = new Set([
  "kind",
  "rosterEvidenceId",
  "memberEvidenceId",
  "sourceThreadBindingId",
  "sourceExternalIdentityId"
]);
const OMISSION_EVIDENCE_KEYS = new Set([
  "kind",
  "rosterEvidenceId",
  "sourceThreadBindingId",
  "sourceExternalIdentityId"
]);

export type StartInboxV2ProviderMembershipEpisodeInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  participantId: InboxV2ConversationParticipantId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  rosterEvidenceId: InboxV2ProviderRosterEvidenceId;
  memberEvidenceId: InboxV2ProviderRosterMemberEvidenceId;
  sourceThreadBindingId: InboxV2SourceThreadBindingId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  role: InboxV2ParticipantMembershipRole;
  reasonCodeId: InboxV2ParticipantMembershipReasonId;
  expectedMembershipRevision: InboxV2BigintCounter;
  occurredAt: string;
}>;

export type InboxV2ProviderMembershipTransitionEvidence =
  | Readonly<{
      kind: "member";
      rosterEvidenceId: InboxV2ProviderRosterEvidenceId;
      memberEvidenceId: InboxV2ProviderRosterMemberEvidenceId;
      sourceThreadBindingId: InboxV2SourceThreadBindingId;
      sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
    }>
  | Readonly<{
      kind: "roster_omission";
      rosterEvidenceId: InboxV2ProviderRosterEvidenceId;
      sourceThreadBindingId: InboxV2SourceThreadBindingId;
      sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
    }>;

export type TransitionInboxV2ProviderMembershipEpisodeInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  evidence: InboxV2ProviderMembershipTransitionEvidence;
  intent: "change_role" | "leave" | "remove";
  nextRole: InboxV2ParticipantMembershipRole | null;
  reasonCodeId: InboxV2ParticipantMembershipReasonId;
  expectedMembershipRevision: InboxV2BigintCounter;
  expectedEpisodeRevision: InboxV2EntityRevision;
  occurredAt: string;
}>;

type EvidenceFailureKind =
  | "evidence_not_found"
  | "evidence_scope_conflict"
  | "evidence_semantic_conflict"
  | "evidence_not_authoritative"
  | "evidence_stale"
  | "evidence_reused";

export type StartInboxV2ProviderMembershipEpisodeResult =
  | Readonly<{
      kind: "created";
      record: InboxV2ParticipantMembershipMutationRecord;
    }>
  | Readonly<{
      kind: "membership_revision_conflict";
      currentMembershipRevision: InboxV2BigintCounter;
    }>
  | Readonly<{
      kind:
        | "conversation_not_found"
        | "participant_not_found"
        | "episode_id_conflict"
        | "current_origin_conflict"
        | EvidenceFailureKind;
    }>;

export type TransitionInboxV2ProviderMembershipEpisodeResult =
  | Readonly<{
      kind: "updated";
      record: InboxV2ParticipantMembershipMutationRecord;
    }>
  | Readonly<{
      kind: "membership_revision_conflict";
      currentMembershipRevision: InboxV2BigintCounter;
    }>
  | Readonly<{
      kind: "episode_revision_conflict";
      currentEpisode: InboxV2ParticipantMembershipEpisode;
    }>
  | Readonly<{
      kind:
        | "conversation_not_found"
        | "episode_not_found"
        | EvidenceFailureKind;
    }>;

export type InboxV2ProviderParticipantMembershipRepository = Readonly<{
  startProviderEpisode(
    input: StartInboxV2ProviderMembershipEpisodeInput
  ): Promise<StartInboxV2ProviderMembershipEpisodeResult>;
  transitionProviderEpisode(
    input: TransitionInboxV2ProviderMembershipEpisodeInput
  ): Promise<TransitionInboxV2ProviderMembershipEpisodeResult>;
}>;

type ProviderEvidenceRow = {
  roster_id: unknown;
  member_id: unknown;
  binding_id: unknown;
  source_identity_id: unknown;
  external_conversation_id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  identity_scope_kind: unknown;
  identity_scope_connection_id: unknown;
  identity_scope_account_id: unknown;
  identity_declaration_contract_id: unknown;
  identity_declaration_contract_version: unknown;
  identity_declaration_surface_id: unknown;
  identity_declaration_loaded_by: unknown;
  adapter_contract_id: unknown;
  adapter_contract_version: unknown;
  adapter_surface_id: unknown;
  adapter_loaded_by: unknown;
  authority: unknown;
  completeness: unknown;
  omission_policy: unknown;
  ordering_kind: unknown;
  ordering_scope_token: unknown;
  ordering_comparator_id: unknown;
  ordering_comparator_revision: unknown;
  ordering_position: unknown;
  observed_at: unknown;
  member_state: unknown;
  normalized_role: unknown;
  identity_present: unknown;
};

type ProviderEpisodeRow = {
  tenant_id: unknown;
  id: unknown;
  participant_id: unknown;
  conversation_id: unknown;
  origin_provider_roster_member_evidence_id: unknown;
  origin_provider_roster_evidence_id: unknown;
  origin_source_thread_binding_id: unknown;
  origin_source_external_identity_id: unknown;
  origin_ordering_kind: unknown;
  origin_ordering_scope_token: unknown;
  origin_ordering_comparator_id: unknown;
  origin_ordering_comparator_revision: unknown;
  origin_ordering_position: unknown;
  provider_ordering_head_position: unknown;
  state: unknown;
  role: unknown;
  evidence_classification: unknown;
  valid_from: unknown;
  valid_to: unknown;
  revision: unknown;
};

type ParticipantRow = {
  conversation_id: unknown;
  subject_kind: unknown;
  subject_source_external_identity_id: unknown;
};
type MembershipHeadRow = { membership_revision: unknown };
type InsertedIdRow = { id: unknown };
type ProviderOrderingHeadRow = {
  participant_id: unknown;
  conversation_id: unknown;
  source_thread_binding_id: unknown;
  source_external_identity_id: unknown;
  ordering_kind: unknown;
  ordering_scope_token: unknown;
  ordering_comparator_id: unknown;
  ordering_comparator_revision: unknown;
  ordering_position: unknown;
  episode_id: unknown;
  transition_id: unknown;
  membership_revision: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type NormalizedStart = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  participantId: InboxV2ConversationParticipantId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  rosterEvidenceId: InboxV2ProviderRosterEvidenceId;
  memberEvidenceId: InboxV2ProviderRosterMemberEvidenceId;
  sourceThreadBindingId: InboxV2SourceThreadBindingId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  role: InboxV2ParticipantMembershipRole;
  reasonCodeId: InboxV2ParticipantMembershipReasonId;
  expectedMembershipRevision: InboxV2BigintCounter;
  occurredAt: string;
}>;

type NormalizedTransition = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  evidence: InboxV2ProviderMembershipTransitionEvidence;
  intent: TransitionInboxV2ProviderMembershipEpisodeInput["intent"];
  nextRole: InboxV2ParticipantMembershipRole | null;
  reasonCodeId: InboxV2ParticipantMembershipReasonId;
  expectedMembershipRevision: InboxV2BigintCounter;
  expectedEpisodeRevision: InboxV2EntityRevision;
  occurredAt: string;
}>;

export function createSqlInboxV2ProviderParticipantMembershipRepository(
  executor: InboxV2ParticipantMembershipTransactionExecutor | HuleeDatabase
): InboxV2ProviderParticipantMembershipRepository {
  const transactionExecutor =
    executor as unknown as InboxV2ParticipantMembershipTransactionExecutor;

  return {
    async startProviderEpisode(input) {
      const normalized = normalizeStartInput(input);
      try {
        return await runTransaction(
          transactionExecutor,
          async (transaction) => {
            const headRevision = await lockMembershipHead(
              transaction,
              normalized
            );
            if (headRevision === null)
              return { kind: "conversation_not_found" };
            if (headRevision !== normalized.expectedMembershipRevision) {
              return {
                kind: "membership_revision_conflict",
                currentMembershipRevision: headRevision
              };
            }

            const providerOrderingHead = await loadProviderOrderingHead(
              transaction,
              {
                tenantId: normalized.tenantId,
                participantId: normalized.participantId,
                sourceThreadBindingId: normalized.sourceThreadBindingId
              }
            );

            const participantResult = await transaction.execute<ParticipantRow>(
              buildLockInboxV2ProviderParticipantSql(normalized)
            );
            if (participantResult.rows.length !== 1) {
              return { kind: "participant_not_found" };
            }
            const participant = participantResult.rows[0];
            if (
              participant?.conversation_id !== normalized.conversationId ||
              participant.subject_kind !== "source_external_identity" ||
              participant.subject_source_external_identity_id !==
                normalized.sourceExternalIdentityId
            ) {
              return { kind: "evidence_scope_conflict" };
            }

            const evidence = await loadMemberEvidence(transaction, normalized);
            if (evidence === null) return { kind: "evidence_not_found" };
            const evidenceFailure = validateMemberEvidenceScope(evidence, {
              conversationId: normalized.conversationId,
              rosterEvidenceId: normalized.rosterEvidenceId,
              sourceThreadBindingId: normalized.sourceThreadBindingId,
              sourceExternalIdentityId: normalized.sourceExternalIdentityId
            });
            if (evidenceFailure) return { kind: evidenceFailure };
            if (evidence.authority !== "authoritative") {
              return { kind: "evidence_not_authoritative" };
            }
            if (
              evidence.member_state !== "present" ||
              evidence.normalized_role !== normalized.role ||
              parseTimestamp(
                evidence.observed_at,
                "Provider member observedAt"
              ) !== normalized.occurredAt
            ) {
              return { kind: "evidence_semantic_conflict" };
            }

            const ordering = orderingFromEvidence(evidence);
            const orderingFailure = validateNextProviderOrdering(
              providerOrderingHead,
              {
                conversationId: normalized.conversationId,
                sourceExternalIdentityId: normalized.sourceExternalIdentityId,
                ordering
              }
            );
            if (orderingFailure === "evidence_stale") {
              const evidenceWasUsed = await rowExists(
                transaction,
                buildFindUsedInboxV2ProviderMembershipEvidenceSql({
                  tenantId: normalized.tenantId,
                  evidence: {
                    kind: "member",
                    rosterEvidenceId: normalized.rosterEvidenceId,
                    memberEvidenceId: normalized.memberEvidenceId,
                    sourceThreadBindingId: normalized.sourceThreadBindingId,
                    sourceExternalIdentityId:
                      normalized.sourceExternalIdentityId
                  }
                })
              );
              return {
                kind: evidenceWasUsed ? "evidence_reused" : "evidence_stale"
              };
            }
            if (orderingFailure !== null) return { kind: orderingFailure };
            if (
              providerOrderingHead !== null &&
              isTimestampBefore(
                normalized.occurredAt,
                providerOrderingHead.updatedAt
              )
            ) {
              return { kind: "evidence_semantic_conflict" };
            }

            if (
              await rowExists(
                transaction,
                buildFindInboxV2ProviderEpisodeByIdSql({
                  tenantId: normalized.tenantId,
                  episodeId: normalized.episodeId,
                  lock: true
                })
              )
            ) {
              return { kind: "episode_id_conflict" };
            }
            if (
              await rowExists(
                transaction,
                buildFindCurrentInboxV2ProviderEpisodeSql({
                  tenantId: normalized.tenantId,
                  participantId: normalized.participantId,
                  sourceThreadBindingId: normalized.sourceThreadBindingId
                })
              )
            ) {
              return { kind: "current_origin_conflict" };
            }

            const resultingMembershipRevision = incrementCounter(
              normalized.expectedMembershipRevision,
              "Conversation membership revision"
            );
            const episode = inboxV2ParticipantMembershipEpisodeSchema.parse({
              tenantId: normalized.tenantId,
              id: normalized.episodeId,
              participant: {
                tenantId: normalized.tenantId,
                kind: "conversation_participant",
                id: normalized.participantId
              },
              origin: {
                kind: "provider_roster",
                memberEvidence: {
                  tenantId: normalized.tenantId,
                  kind: "provider_roster_member_evidence",
                  id: normalized.memberEvidenceId
                }
              },
              state: "active",
              role: normalized.role,
              evidenceClassification: "confirmed",
              validFrom: normalized.occurredAt,
              validTo: null,
              revision: "1"
            });
            const transition =
              inboxV2ParticipantMembershipTransitionSchema.parse({
                tenantId: normalized.tenantId,
                id: normalized.transitionId,
                episode: {
                  tenantId: normalized.tenantId,
                  kind: "participant_membership_episode",
                  id: normalized.episodeId
                },
                intent: "initial_active",
                fromState: null,
                toState: "active",
                fromRole: null,
                toRole: normalized.role,
                cause: {
                  kind: "provider_roster",
                  evidence: {
                    kind: "provider_roster_member",
                    reference: {
                      tenantId: normalized.tenantId,
                      kind: "provider_roster_member_evidence",
                      id: normalized.memberEvidenceId
                    }
                  }
                },
                reasonCodeId: normalized.reasonCodeId,
                expectedRevision: null,
                currentRevision: null,
                resultingRevision: "1",
                occurredAt: normalized.occurredAt
              });

            await writeProviderMutation(transaction, {
              tenantId: normalized.tenantId,
              conversationId: normalized.conversationId,
              participantId: normalized.participantId,
              expectedMembershipRevision: normalized.expectedMembershipRevision,
              resultingMembershipRevision,
              episode,
              transition,
              provider: {
                evidenceKind: "member",
                rosterEvidenceId: normalized.rosterEvidenceId,
                memberEvidenceId: normalized.memberEvidenceId,
                sourceThreadBindingId: normalized.sourceThreadBindingId,
                sourceExternalIdentityId: normalized.sourceExternalIdentityId,
                ordering
              },
              previousEpisodeRevision: null,
              previousProviderOrderingHead: providerOrderingHead
            });

            return {
              kind: "created",
              record: {
                conversationMembershipRevision: resultingMembershipRevision,
                episode,
                transition
              }
            };
          }
        );
      } catch (error) {
        if (isProviderEvidenceReuseError(error)) {
          return { kind: "evidence_reused" };
        }
        throw error;
      }
    },

    async transitionProviderEpisode(input) {
      const normalized = normalizeTransitionInput(input);
      try {
        return await runTransaction(
          transactionExecutor,
          async (transaction) => {
            const headRevision = await lockMembershipHead(
              transaction,
              normalized
            );
            if (headRevision === null)
              return { kind: "conversation_not_found" };
            if (headRevision !== normalized.expectedMembershipRevision) {
              return {
                kind: "membership_revision_conflict",
                currentMembershipRevision: headRevision
              };
            }

            const episodeResult = await transaction.execute<ProviderEpisodeRow>(
              buildFindInboxV2ProviderEpisodeByIdSql({
                tenantId: normalized.tenantId,
                episodeId: normalized.episodeId,
                conversationId: normalized.conversationId,
                lock: true
              })
            );
            if (episodeResult.rows.length !== 1) {
              return { kind: "episode_not_found" };
            }
            const episodeRow = episodeResult.rows[0];
            if (!episodeRow)
              throw invariant("Provider episode row is missing.");
            const currentEpisode = mapProviderEpisode(
              episodeRow,
              normalized.tenantId
            );
            if (
              currentEpisode.revision !== normalized.expectedEpisodeRevision
            ) {
              return {
                kind: "episode_revision_conflict",
                currentEpisode
              };
            }
            if (currentEpisode.state !== "active") {
              return { kind: "evidence_semantic_conflict" };
            }

            const episodeBindingId = inboxV2SourceThreadBindingIdSchema.parse(
              requireString(
                episodeRow.origin_source_thread_binding_id,
                "Provider episode source-thread binding"
              )
            );
            const episodeSourceIdentityId =
              inboxV2SourceExternalIdentityIdSchema.parse(
                requireString(
                  episodeRow.origin_source_external_identity_id,
                  "Provider episode source identity"
                )
              );
            const providerOrderingHead = await loadProviderOrderingHead(
              transaction,
              {
                tenantId: normalized.tenantId,
                participantId: currentEpisode.participant.id,
                sourceThreadBindingId: episodeBindingId
              }
            );
            assertProviderOrderingHeadMatchesEpisode(
              providerOrderingHead,
              episodeRow,
              normalized.episodeId
            );

            const evidence =
              normalized.evidence.kind === "member"
                ? await loadMemberEvidence(transaction, {
                    tenantId: normalized.tenantId,
                    memberEvidenceId: normalized.evidence.memberEvidenceId
                  })
                : await loadOmissionEvidence(transaction, {
                    tenantId: normalized.tenantId,
                    rosterEvidenceId: normalized.evidence.rosterEvidenceId,
                    sourceExternalIdentityId:
                      normalized.evidence.sourceExternalIdentityId
                  });
            if (evidence === null) return { kind: "evidence_not_found" };
            const scopeFailure = validateEvidenceAgainstEpisode(
              evidence,
              normalized,
              episodeRow
            );
            if (scopeFailure) return { kind: scopeFailure };
            if (evidence.authority !== "authoritative") {
              return { kind: "evidence_not_authoritative" };
            }

            const ordering = orderingFromEvidence(evidence);
            const orderingFailure = validateNextProviderOrdering(
              providerOrderingHead,
              {
                conversationId: normalized.conversationId,
                sourceExternalIdentityId: episodeSourceIdentityId,
                ordering
              }
            );
            if (orderingFailure !== null) return { kind: orderingFailure };

            const observedAt = parseTimestamp(
              evidence.observed_at,
              "Provider evidence observedAt"
            );
            const nextState =
              normalized.intent === "leave"
                ? "left"
                : normalized.intent === "remove"
                  ? "removed"
                  : "active";
            const nextRole = normalized.nextRole ?? currentEpisode.role;
            if (observedAt !== normalized.occurredAt) {
              return { kind: "evidence_semantic_conflict" };
            }
            if (isTimestampBefore(observedAt, providerOrderingHead.updatedAt)) {
              return { kind: "evidence_semantic_conflict" };
            }
            if (normalized.evidence.kind === "member") {
              const expectedMemberState =
                nextState === "left"
                  ? "left"
                  : nextState === "removed"
                    ? "removed"
                    : "present";
              if (
                evidence.member_state !== expectedMemberState ||
                evidence.normalized_role !== nextRole
              ) {
                return { kind: "evidence_semantic_conflict" };
              }
            } else if (
              nextState === "active" ||
              evidence.completeness !== "complete" ||
              evidence.omission_policy !== "close_missing" ||
              evidence.identity_present === true
            ) {
              return { kind: "evidence_semantic_conflict" };
            }

            if (
              await rowExists(
                transaction,
                buildFindUsedInboxV2ProviderMembershipEvidenceSql({
                  tenantId: normalized.tenantId,
                  evidence: normalized.evidence
                })
              )
            ) {
              return { kind: "evidence_reused" };
            }

            const nextEpisodeRevision = incrementRevision(
              currentEpisode.revision,
              "Provider episode revision"
            );
            const resultingMembershipRevision = incrementCounter(
              normalized.expectedMembershipRevision,
              "Conversation membership revision"
            );
            const transition =
              inboxV2ParticipantMembershipTransitionSchema.parse({
                tenantId: normalized.tenantId,
                id: normalized.transitionId,
                episode: {
                  tenantId: normalized.tenantId,
                  kind: "participant_membership_episode",
                  id: normalized.episodeId
                },
                intent: normalized.intent,
                fromState: currentEpisode.state,
                toState: nextState,
                fromRole: currentEpisode.role,
                toRole: nextRole,
                cause: {
                  kind: "provider_roster",
                  evidence:
                    normalized.evidence.kind === "member"
                      ? {
                          kind: "provider_roster_member",
                          reference: {
                            tenantId: normalized.tenantId,
                            kind: "provider_roster_member_evidence",
                            id: normalized.evidence.memberEvidenceId
                          }
                        }
                      : {
                          kind: "provider_roster",
                          reference: {
                            tenantId: normalized.tenantId,
                            kind: "provider_roster_evidence",
                            id: normalized.evidence.rosterEvidenceId
                          }
                        }
                },
                reasonCodeId: normalized.reasonCodeId,
                expectedRevision: normalized.expectedEpisodeRevision,
                currentRevision: currentEpisode.revision,
                resultingRevision: nextEpisodeRevision,
                occurredAt: normalized.occurredAt
              });
            const episode = inboxV2ParticipantMembershipEpisodeSchema.parse({
              ...currentEpisode,
              state: nextState,
              role: nextRole,
              validTo: nextState === "active" ? null : normalized.occurredAt,
              revision: nextEpisodeRevision
            });

            await writeProviderMutation(transaction, {
              tenantId: normalized.tenantId,
              conversationId: normalized.conversationId,
              participantId: currentEpisode.participant.id,
              expectedMembershipRevision: normalized.expectedMembershipRevision,
              resultingMembershipRevision,
              episode,
              transition,
              provider: {
                evidenceKind: normalized.evidence.kind,
                rosterEvidenceId: normalized.evidence.rosterEvidenceId,
                memberEvidenceId:
                  normalized.evidence.kind === "member"
                    ? normalized.evidence.memberEvidenceId
                    : null,
                sourceThreadBindingId:
                  normalized.evidence.sourceThreadBindingId,
                sourceExternalIdentityId:
                  normalized.evidence.sourceExternalIdentityId,
                ordering
              },
              previousEpisodeRevision: currentEpisode.revision,
              previousProviderOrderingHead: providerOrderingHead
            });

            return {
              kind: "updated",
              record: {
                conversationMembershipRevision: resultingMembershipRevision,
                episode,
                transition
              }
            };
          }
        );
      } catch (error) {
        if (isProviderEvidenceReuseError(error)) {
          return { kind: "evidence_reused" };
        }
        throw error;
      }
    }
  };
}

export function buildLockInboxV2ProviderParticipantSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  participantId: InboxV2ConversationParticipantId;
}): SQL {
  return sql`
    select conversation_id, subject_kind, subject_source_external_identity_id
    from inbox_v2_conversation_participants
    where tenant_id = ${input.tenantId}
      and id = ${input.participantId}
      and conversation_id = ${input.conversationId}
    for update
  `;
}

export function buildLockInboxV2ProviderMembershipOrderingHeadSql(input: {
  tenantId: InboxV2TenantId;
  participantId: InboxV2ConversationParticipantId;
  sourceThreadBindingId: InboxV2SourceThreadBindingId;
}): SQL {
  return sql`
    select
      participant_id,
      conversation_id,
      source_thread_binding_id,
      source_external_identity_id,
      ordering_kind,
      ordering_scope_token,
      ordering_comparator_id,
      ordering_comparator_revision,
      ordering_position,
      episode_id,
      transition_id,
      membership_revision,
      revision,
      created_at,
      updated_at
    from inbox_v2_provider_membership_ordering_heads
    where tenant_id = ${input.tenantId}
      and participant_id = ${input.participantId}
      and source_thread_binding_id = ${input.sourceThreadBindingId}
    for update
  `;
}

export function buildLockInboxV2ProviderRosterMemberEvidenceSql(input: {
  tenantId: InboxV2TenantId;
  memberEvidenceId: InboxV2ProviderRosterMemberEvidenceId;
}): SQL {
  return providerEvidenceSelectSql(sql`
    member_row.tenant_id = ${input.tenantId}
    and member_row.id = ${input.memberEvidenceId}
  `);
}

export function buildLockInboxV2ProviderRosterOmissionEvidenceSql(input: {
  tenantId: InboxV2TenantId;
  rosterEvidenceId: InboxV2ProviderRosterEvidenceId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select
      roster_row.id as roster_id,
      null::text as member_id,
      roster_row.source_thread_binding_id as binding_id,
      ${input.sourceExternalIdentityId}::text as source_identity_id,
      thread_row.conversation_id as external_conversation_id,
      binding_row.source_connection_id,
      binding_row.source_account_id,
      identity_row.scope_kind as identity_scope_kind,
      identity_row.scope_source_connection_id as identity_scope_connection_id,
      identity_row.scope_source_account_id as identity_scope_account_id,
      identity_row.declaration_contract_id as identity_declaration_contract_id,
      identity_row.declaration_contract_version as identity_declaration_contract_version,
      identity_row.declaration_surface_id as identity_declaration_surface_id,
      identity_row.declaration_loaded_by_trusted_service_id as identity_declaration_loaded_by,
      roster_row.adapter_contract_id,
      roster_row.adapter_contract_version,
      roster_row.adapter_surface_id,
      roster_row.adapter_loaded_by_trusted_service_id as adapter_loaded_by,
      roster_row.authority,
      roster_row.completeness,
      roster_row.omission_policy,
      roster_row.ordering_kind,
      roster_row.ordering_scope_token,
      roster_row.ordering_comparator_id,
      roster_row.ordering_comparator_revision,
      roster_row.ordering_position,
      roster_row.observed_at,
      null::text as member_state,
      null::text as normalized_role,
      exists (
        select 1
        from inbox_v2_provider_roster_member_evidence present_member
        where present_member.tenant_id = roster_row.tenant_id
          and present_member.roster_evidence_id = roster_row.id
          and present_member.source_external_identity_id = ${input.sourceExternalIdentityId}
      ) as identity_present
    from inbox_v2_provider_roster_evidence roster_row
    join inbox_v2_source_thread_bindings binding_row
      on binding_row.tenant_id = roster_row.tenant_id
     and binding_row.id = roster_row.source_thread_binding_id
    join inbox_v2_external_threads thread_row
      on thread_row.tenant_id = binding_row.tenant_id
     and thread_row.id = binding_row.external_thread_id
    join inbox_v2_source_external_identities identity_row
      on identity_row.tenant_id = roster_row.tenant_id
     and identity_row.id = ${input.sourceExternalIdentityId}
    where roster_row.tenant_id = ${input.tenantId}
      and roster_row.id = ${input.rosterEvidenceId}
    for share of roster_row, binding_row, thread_row, identity_row
  `;
}

function providerEvidenceSelectSql(predicate: SQL): SQL {
  return sql`
    select
      roster_row.id as roster_id,
      member_row.id as member_id,
      roster_row.source_thread_binding_id as binding_id,
      member_row.source_external_identity_id as source_identity_id,
      thread_row.conversation_id as external_conversation_id,
      binding_row.source_connection_id,
      binding_row.source_account_id,
      identity_row.scope_kind as identity_scope_kind,
      identity_row.scope_source_connection_id as identity_scope_connection_id,
      identity_row.scope_source_account_id as identity_scope_account_id,
      identity_row.declaration_contract_id as identity_declaration_contract_id,
      identity_row.declaration_contract_version as identity_declaration_contract_version,
      identity_row.declaration_surface_id as identity_declaration_surface_id,
      identity_row.declaration_loaded_by_trusted_service_id as identity_declaration_loaded_by,
      roster_row.adapter_contract_id,
      roster_row.adapter_contract_version,
      roster_row.adapter_surface_id,
      roster_row.adapter_loaded_by_trusted_service_id as adapter_loaded_by,
      roster_row.authority,
      roster_row.completeness,
      roster_row.omission_policy,
      roster_row.ordering_kind,
      roster_row.ordering_scope_token,
      roster_row.ordering_comparator_id,
      roster_row.ordering_comparator_revision,
      roster_row.ordering_position,
      member_row.observed_at,
      member_row.state as member_state,
      member_row.normalized_role,
      true as identity_present
    from inbox_v2_provider_roster_member_evidence member_row
    join inbox_v2_provider_roster_evidence roster_row
      on roster_row.tenant_id = member_row.tenant_id
     and roster_row.id = member_row.roster_evidence_id
     and roster_row.source_thread_binding_id = member_row.source_thread_binding_id
    join inbox_v2_source_thread_bindings binding_row
      on binding_row.tenant_id = roster_row.tenant_id
     and binding_row.id = roster_row.source_thread_binding_id
    join inbox_v2_external_threads thread_row
      on thread_row.tenant_id = binding_row.tenant_id
     and thread_row.id = binding_row.external_thread_id
    join inbox_v2_source_external_identities identity_row
      on identity_row.tenant_id = member_row.tenant_id
     and identity_row.id = member_row.source_external_identity_id
    where ${predicate}
    for share of member_row, roster_row, binding_row, thread_row, identity_row
  `;
}

export function buildFindInboxV2ProviderEpisodeByIdSql(input: {
  tenantId: InboxV2TenantId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  conversationId?: InboxV2ConversationId;
  lock?: boolean;
}): SQL {
  const conversation = input.conversationId
    ? sql`and conversation_id = ${input.conversationId}`
    : sql``;
  const lock = input.lock ? sql`for update` : sql``;
  return sql`
    select
      tenant_id,
      id,
      participant_id,
      conversation_id,
      origin_provider_roster_member_evidence_id,
      origin_provider_roster_evidence_id,
      origin_source_thread_binding_id,
      origin_source_external_identity_id,
      origin_ordering_kind,
      origin_ordering_scope_token,
      origin_ordering_comparator_id,
      origin_ordering_comparator_revision,
      origin_ordering_position,
      provider_ordering_head_position,
      state,
      role,
      evidence_classification,
      valid_from,
      valid_to,
      revision
    from inbox_v2_participant_membership_episodes
    where tenant_id = ${input.tenantId}
      and id = ${input.episodeId}
      and origin_kind = 'provider_roster'
      ${conversation}
    ${lock}
  `;
}

export function buildFindCurrentInboxV2ProviderEpisodeSql(input: {
  tenantId: InboxV2TenantId;
  participantId: InboxV2ConversationParticipantId;
  sourceThreadBindingId: InboxV2SourceThreadBindingId;
}): SQL {
  return sql`
    select id
    from inbox_v2_participant_membership_episodes
    where tenant_id = ${input.tenantId}
      and participant_id = ${input.participantId}
      and origin_kind = 'provider_roster'
      and origin_source_thread_binding_id = ${input.sourceThreadBindingId}
      and state in ('pending', 'active')
    for update
  `;
}

export function buildFindUsedInboxV2ProviderMembershipEvidenceSql(input: {
  tenantId: InboxV2TenantId;
  evidence: InboxV2ProviderMembershipTransitionEvidence;
}): SQL {
  return input.evidence.kind === "member"
    ? sql`
        select id
        from inbox_v2_participant_membership_transitions
        where tenant_id = ${input.tenantId}
          and cause_kind = 'provider_roster'
          and cause_provider_evidence_kind = 'member'
          and cause_provider_roster_member_evidence_id = ${input.evidence.memberEvidenceId}
        for update
      `
    : sql`
        select id
        from inbox_v2_participant_membership_transitions
        where tenant_id = ${input.tenantId}
          and cause_kind = 'provider_roster'
          and cause_provider_evidence_kind = 'roster_omission'
          and cause_provider_roster_evidence_id = ${input.evidence.rosterEvidenceId}
          and cause_source_external_identity_id = ${input.evidence.sourceExternalIdentityId}
        for update
      `;
}

type ProviderWriteAnchor = Readonly<{
  evidenceKind: "member" | "roster_omission";
  rosterEvidenceId: InboxV2ProviderRosterEvidenceId;
  memberEvidenceId: InboxV2ProviderRosterMemberEvidenceId | null;
  sourceThreadBindingId: InboxV2SourceThreadBindingId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  ordering: ProviderOrdering;
}>;

type ProviderOrdering = Readonly<{
  kind: string;
  scopeToken: string;
  comparatorId: string;
  comparatorRevision: bigint;
  position: bigint;
}>;

type ProviderOrderingHead = Readonly<{
  participantId: InboxV2ConversationParticipantId;
  conversationId: InboxV2ConversationId;
  sourceThreadBindingId: InboxV2SourceThreadBindingId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  ordering: ProviderOrdering;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  membershipRevision: bigint;
  revision: bigint;
  createdAt: string;
  updatedAt: string;
}>;

export function buildInsertInboxV2ProviderMembershipEpisodeSql(input: {
  episode: InboxV2ParticipantMembershipEpisode;
  conversationId: InboxV2ConversationId;
  provider: ProviderWriteAnchor;
}): SQL {
  return sql`
    insert into inbox_v2_participant_membership_episodes (
      tenant_id, id, participant_id, conversation_id, origin_kind,
      origin_provider_roster_member_evidence_id,
      origin_provider_roster_evidence_id,
      origin_source_thread_binding_id,
      origin_source_external_identity_id,
      origin_ordering_kind,
      origin_ordering_scope_token,
      origin_ordering_comparator_id,
      origin_ordering_comparator_revision,
      origin_ordering_position,
      provider_ordering_head_position,
      origin_migration_provenance_id,
      origin_system_policy_id,
      state, role, evidence_classification, valid_from, valid_to, revision
    ) values (
      ${input.episode.tenantId}, ${input.episode.id},
      ${input.episode.participant.id}, ${input.conversationId}, 'provider_roster',
      ${input.provider.memberEvidenceId}, ${input.provider.rosterEvidenceId},
      ${input.provider.sourceThreadBindingId},
      ${input.provider.sourceExternalIdentityId},
      ${input.provider.ordering.kind}, ${input.provider.ordering.scopeToken},
      ${input.provider.ordering.comparatorId},
      ${input.provider.ordering.comparatorRevision},
      ${input.provider.ordering.position}, ${input.provider.ordering.position},
      null, null,
      ${input.episode.state}, ${input.episode.role},
      ${input.episode.evidenceClassification}, ${input.episode.validFrom},
      ${input.episode.validTo}, ${input.episode.revision}
    )
    returning id
  `;
}

export function buildInsertInboxV2ProviderMembershipTransitionSql(input: {
  transition: InboxV2ParticipantMembershipMutationRecord["transition"];
  participantId: InboxV2ConversationParticipantId;
  conversationId: InboxV2ConversationId;
  membershipRevision: InboxV2BigintCounter;
  provider: ProviderWriteAnchor;
}): SQL {
  return sql`
    insert into inbox_v2_participant_membership_transitions (
      tenant_id, id, episode_id, participant_id, conversation_id,
      membership_revision, intent, from_state, to_state, from_role, to_role,
      cause_kind, cause_provider_evidence_kind,
      cause_provider_roster_member_evidence_id,
      cause_provider_roster_evidence_id,
      cause_source_thread_binding_id,
      cause_source_external_identity_id,
      cause_ordering_kind, cause_ordering_scope_token,
      cause_ordering_comparator_id, cause_ordering_comparator_revision,
      cause_ordering_position,
      cause_actor_employee_id, cause_trusted_service_id,
      cause_migration_provenance_id, cause_system_policy_id,
      reason_code_id, expected_revision, current_revision,
      resulting_revision, occurred_at
    ) values (
      ${input.transition.tenantId}, ${input.transition.id},
      ${input.transition.episode.id}, ${input.participantId},
      ${input.conversationId}, ${input.membershipRevision},
      ${input.transition.intent}, ${input.transition.fromState},
      ${input.transition.toState}, ${input.transition.fromRole},
      ${input.transition.toRole}, 'provider_roster',
      ${input.provider.evidenceKind}, ${input.provider.memberEvidenceId},
      ${input.provider.rosterEvidenceId},
      ${input.provider.sourceThreadBindingId},
      ${input.provider.sourceExternalIdentityId},
      ${input.provider.ordering.kind}, ${input.provider.ordering.scopeToken},
      ${input.provider.ordering.comparatorId},
      ${input.provider.ordering.comparatorRevision},
      ${input.provider.ordering.position},
      null, null, null, null,
      ${input.transition.reasonCodeId}, ${input.transition.expectedRevision},
      ${input.transition.currentRevision}, ${input.transition.resultingRevision},
      ${input.transition.occurredAt}
    )
    returning id
  `;
}

export function buildUpdateInboxV2ProviderMembershipEpisodeSql(input: {
  beforeRevision: InboxV2EntityRevision;
  after: InboxV2ParticipantMembershipEpisode;
  orderingPosition: bigint;
}): SQL {
  return sql`
    update inbox_v2_participant_membership_episodes
    set state = ${input.after.state},
        role = ${input.after.role},
        valid_to = ${input.after.validTo},
        revision = ${input.after.revision},
        provider_ordering_head_position = ${input.orderingPosition}
    where tenant_id = ${input.after.tenantId}
      and id = ${input.after.id}
      and origin_kind = 'provider_roster'
      and revision = ${input.beforeRevision}
    returning id
  `;
}

export function buildInsertInboxV2ProviderMembershipOrderingHeadSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  participantId: InboxV2ConversationParticipantId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  membershipRevision: InboxV2BigintCounter;
  occurredAt: string;
  provider: ProviderWriteAnchor;
}): SQL {
  return sql`
    insert into inbox_v2_provider_membership_ordering_heads (
      tenant_id, participant_id, conversation_id,
      source_thread_binding_id, source_external_identity_id,
      ordering_kind, ordering_scope_token, ordering_comparator_id,
      ordering_comparator_revision, ordering_position,
      episode_id, transition_id, membership_revision, revision,
      created_at, updated_at
    ) values (
      ${input.tenantId}, ${input.participantId}, ${input.conversationId},
      ${input.provider.sourceThreadBindingId},
      ${input.provider.sourceExternalIdentityId},
      ${input.provider.ordering.kind}, ${input.provider.ordering.scopeToken},
      ${input.provider.ordering.comparatorId},
      ${input.provider.ordering.comparatorRevision},
      ${input.provider.ordering.position}, ${input.episodeId},
      ${input.transitionId}, ${input.membershipRevision}, 1,
      ${input.occurredAt}, ${input.occurredAt}
    )
    returning transition_id as id
  `;
}

export function buildAdvanceInboxV2ProviderMembershipOrderingHeadSql(input: {
  tenantId: InboxV2TenantId;
  previous: ProviderOrderingHead;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  membershipRevision: InboxV2BigintCounter;
  occurredAt: string;
  provider: ProviderWriteAnchor;
}): SQL {
  return sql`
    update inbox_v2_provider_membership_ordering_heads
    set ordering_position = ${input.provider.ordering.position},
        episode_id = ${input.episodeId},
        transition_id = ${input.transitionId},
        membership_revision = ${input.membershipRevision},
        revision = ${input.previous.revision + 1n},
        updated_at = ${input.occurredAt}
    where tenant_id = ${input.tenantId}
      and participant_id = ${input.previous.participantId}
      and source_thread_binding_id = ${input.previous.sourceThreadBindingId}
      and conversation_id = ${input.previous.conversationId}
      and source_external_identity_id =
        ${input.previous.sourceExternalIdentityId}
      and ordering_kind = ${input.previous.ordering.kind}
      and ordering_scope_token = ${input.previous.ordering.scopeToken}
      and ordering_comparator_id = ${input.previous.ordering.comparatorId}
      and ordering_comparator_revision =
        ${input.previous.ordering.comparatorRevision}
      and ordering_position = ${input.previous.ordering.position}
      and revision = ${input.previous.revision}
    returning transition_id as id
  `;
}

async function writeProviderMutation(
  transaction: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    participantId: InboxV2ConversationParticipantId;
    expectedMembershipRevision: InboxV2BigintCounter;
    resultingMembershipRevision: InboxV2BigintCounter;
    episode: InboxV2ParticipantMembershipEpisode;
    transition: InboxV2ParticipantMembershipMutationRecord["transition"];
    provider: ProviderWriteAnchor;
    previousEpisodeRevision: InboxV2EntityRevision | null;
    previousProviderOrderingHead: ProviderOrderingHead | null;
  }>
): Promise<void> {
  await expectOne(
    transaction,
    buildInsertInboxV2ConversationMembershipCommitSql({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      expectedMembershipRevision: input.expectedMembershipRevision,
      resultingMembershipRevision: input.resultingMembershipRevision,
      occurredAt: input.transition.occurredAt
    }),
    "Provider membership commit insert"
  );
  if (input.previousEpisodeRevision === null) {
    await expectOne(
      transaction,
      buildInsertInboxV2ProviderMembershipEpisodeSql({
        episode: input.episode,
        conversationId: input.conversationId,
        provider: input.provider
      }),
      "Provider membership episode insert"
    );
  }
  await expectOne(
    transaction,
    buildInsertInboxV2ProviderMembershipTransitionSql({
      transition: input.transition,
      participantId: input.participantId,
      conversationId: input.conversationId,
      membershipRevision: input.resultingMembershipRevision,
      provider: input.provider
    }),
    "Provider membership transition insert"
  );
  if (input.previousEpisodeRevision !== null) {
    await expectOne(
      transaction,
      buildUpdateInboxV2ProviderMembershipEpisodeSql({
        beforeRevision: input.previousEpisodeRevision,
        after: input.episode,
        orderingPosition: input.provider.ordering.position
      }),
      "Provider membership episode update"
    );
  }
  await expectOne(
    transaction,
    input.previousProviderOrderingHead === null
      ? buildInsertInboxV2ProviderMembershipOrderingHeadSql({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          participantId: input.participantId,
          episodeId: input.episode.id,
          transitionId: input.transition.id,
          membershipRevision: input.resultingMembershipRevision,
          occurredAt: input.transition.occurredAt,
          provider: input.provider
        })
      : buildAdvanceInboxV2ProviderMembershipOrderingHeadSql({
          tenantId: input.tenantId,
          previous: input.previousProviderOrderingHead,
          episodeId: input.episode.id,
          transitionId: input.transition.id,
          membershipRevision: input.resultingMembershipRevision,
          occurredAt: input.transition.occurredAt,
          provider: input.provider
        }),
    "Provider membership ordering head advance"
  );
  await expectOne(
    transaction,
    buildAdvanceInboxV2ConversationMembershipHeadSql({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      expectedMembershipRevision: input.expectedMembershipRevision,
      resultingMembershipRevision: input.resultingMembershipRevision,
      changedAt: input.transition.occurredAt
    }),
    "Provider membership head advance"
  );
}

async function loadMemberEvidence(
  transaction: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    memberEvidenceId: InboxV2ProviderRosterMemberEvidenceId;
  }
): Promise<ProviderEvidenceRow | null> {
  return singleRow(
    await transaction.execute<ProviderEvidenceRow>(
      buildLockInboxV2ProviderRosterMemberEvidenceSql(input)
    ),
    "Provider roster member evidence"
  );
}

async function loadOmissionEvidence(
  transaction: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    rosterEvidenceId: InboxV2ProviderRosterEvidenceId;
    sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  }
): Promise<ProviderEvidenceRow | null> {
  return singleRow(
    await transaction.execute<ProviderEvidenceRow>(
      buildLockInboxV2ProviderRosterOmissionEvidenceSql(input)
    ),
    "Provider roster omission evidence"
  );
}

function validateMemberEvidenceScope(
  evidence: ProviderEvidenceRow,
  expected: {
    conversationId: InboxV2ConversationId;
    rosterEvidenceId: InboxV2ProviderRosterEvidenceId;
    sourceThreadBindingId: InboxV2SourceThreadBindingId;
    sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  }
): EvidenceFailureKind | null {
  if (
    evidence.roster_id !== expected.rosterEvidenceId ||
    evidence.binding_id !== expected.sourceThreadBindingId ||
    evidence.source_identity_id !== expected.sourceExternalIdentityId ||
    evidence.external_conversation_id !== expected.conversationId ||
    !identityScopeMatchesEvidence(evidence)
  ) {
    return "evidence_scope_conflict";
  }
  return null;
}

function validateEvidenceAgainstEpisode(
  evidence: ProviderEvidenceRow,
  input: NormalizedTransition,
  episode: ProviderEpisodeRow
): EvidenceFailureKind | null {
  if (
    evidence.roster_id !== input.evidence.rosterEvidenceId ||
    evidence.binding_id !== input.evidence.sourceThreadBindingId ||
    evidence.source_identity_id !== input.evidence.sourceExternalIdentityId ||
    evidence.external_conversation_id !== input.conversationId ||
    evidence.binding_id !== episode.origin_source_thread_binding_id ||
    evidence.source_identity_id !==
      episode.origin_source_external_identity_id ||
    evidence.ordering_kind !== episode.origin_ordering_kind ||
    evidence.ordering_scope_token !== episode.origin_ordering_scope_token ||
    evidence.ordering_comparator_id !== episode.origin_ordering_comparator_id ||
    parseBigint(
      evidence.ordering_comparator_revision,
      "Provider comparator revision"
    ) !==
      parseBigint(
        episode.origin_ordering_comparator_revision,
        "Provider episode comparator revision"
      ) ||
    !identityScopeMatchesEvidence(evidence)
  ) {
    return "evidence_scope_conflict";
  }
  if (
    input.evidence.kind === "member" &&
    evidence.member_id !== input.evidence.memberEvidenceId
  ) {
    return "evidence_scope_conflict";
  }
  return null;
}

function identityScopeMatchesEvidence(evidence: ProviderEvidenceRow): boolean {
  if (evidence.identity_scope_kind === "provider") {
    return (
      evidence.identity_declaration_contract_id ===
        evidence.adapter_contract_id &&
      evidence.identity_declaration_contract_version ===
        evidence.adapter_contract_version &&
      evidence.identity_declaration_surface_id ===
        evidence.adapter_surface_id &&
      evidence.identity_declaration_loaded_by === evidence.adapter_loaded_by
    );
  }
  if (evidence.identity_scope_kind === "source_connection") {
    return (
      evidence.identity_scope_connection_id === evidence.source_connection_id
    );
  }
  if (evidence.identity_scope_kind === "source_account") {
    return evidence.identity_scope_account_id === evidence.source_account_id;
  }
  return false;
}

function orderingFromEvidence(evidence: ProviderEvidenceRow): ProviderOrdering {
  if (
    evidence.ordering_kind !== "adapter_monotonic" ||
    typeof evidence.ordering_scope_token !== "string" ||
    typeof evidence.ordering_comparator_id !== "string"
  ) {
    throw invariant("Provider evidence ordering declaration is invalid.");
  }
  return {
    kind: evidence.ordering_kind,
    scopeToken: evidence.ordering_scope_token,
    comparatorId: evidence.ordering_comparator_id,
    comparatorRevision: parseBigint(
      evidence.ordering_comparator_revision,
      "Provider comparator revision"
    ),
    position: parseBigint(
      evidence.ordering_position,
      "Provider ordering position"
    )
  };
}

async function loadProviderOrderingHead(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    participantId: InboxV2ConversationParticipantId;
    sourceThreadBindingId: InboxV2SourceThreadBindingId;
  }
): Promise<ProviderOrderingHead | null> {
  const row = singleRow(
    await executor.execute<ProviderOrderingHeadRow>(
      buildLockInboxV2ProviderMembershipOrderingHeadSql(input)
    ),
    "Provider membership durable ordering head"
  );
  if (row === null) return null;
  return {
    participantId: inboxV2ConversationParticipantIdSchema.parse(
      requireString(row.participant_id, "Provider ordering participant")
    ),
    conversationId: inboxV2ConversationIdSchema.parse(
      requireString(row.conversation_id, "Provider ordering conversation")
    ),
    sourceThreadBindingId: inboxV2SourceThreadBindingIdSchema.parse(
      requireString(row.source_thread_binding_id, "Provider ordering binding")
    ),
    sourceExternalIdentityId: inboxV2SourceExternalIdentityIdSchema.parse(
      requireString(
        row.source_external_identity_id,
        "Provider ordering source identity"
      )
    ),
    ordering: {
      kind: requireString(row.ordering_kind, "Provider ordering kind"),
      scopeToken: requireString(
        row.ordering_scope_token,
        "Provider ordering scope token"
      ),
      comparatorId: requireString(
        row.ordering_comparator_id,
        "Provider ordering comparator"
      ),
      comparatorRevision: parseBigint(
        row.ordering_comparator_revision,
        "Provider ordering comparator revision"
      ),
      position: parseBigint(
        row.ordering_position,
        "Provider ordering head position"
      )
    },
    episodeId: inboxV2ParticipantMembershipEpisodeIdSchema.parse(
      requireString(row.episode_id, "Provider ordering episode")
    ),
    transitionId: inboxV2ParticipantMembershipTransitionIdSchema.parse(
      requireString(row.transition_id, "Provider ordering transition")
    ),
    membershipRevision: parseBigint(
      row.membership_revision,
      "Provider ordering membership revision"
    ),
    revision: parseBigint(row.revision, "Provider ordering head revision"),
    createdAt: parseTimestamp(row.created_at, "Provider ordering createdAt"),
    updatedAt: parseTimestamp(row.updated_at, "Provider ordering updatedAt")
  };
}

function validateNextProviderOrdering(
  head: ProviderOrderingHead | null,
  input: {
    conversationId: InboxV2ConversationId;
    sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
    ordering: ProviderOrdering;
  }
): "evidence_scope_conflict" | "evidence_stale" | null {
  if (head === null) return null;
  if (
    head.conversationId !== input.conversationId ||
    head.sourceExternalIdentityId !== input.sourceExternalIdentityId ||
    head.ordering.kind !== input.ordering.kind ||
    head.ordering.scopeToken !== input.ordering.scopeToken ||
    head.ordering.comparatorId !== input.ordering.comparatorId ||
    head.ordering.comparatorRevision !== input.ordering.comparatorRevision
  ) {
    return "evidence_scope_conflict";
  }
  return input.ordering.position <= head.ordering.position
    ? "evidence_stale"
    : null;
}

function assertProviderOrderingHeadMatchesEpisode(
  head: ProviderOrderingHead | null,
  episode: ProviderEpisodeRow,
  episodeId: InboxV2ParticipantMembershipEpisodeId
): asserts head is ProviderOrderingHead {
  if (
    head === null ||
    head.episodeId !== episodeId ||
    head.participantId !== episode.participant_id ||
    head.conversationId !== episode.conversation_id ||
    head.sourceThreadBindingId !== episode.origin_source_thread_binding_id ||
    head.sourceExternalIdentityId !==
      episode.origin_source_external_identity_id ||
    head.ordering.kind !== episode.origin_ordering_kind ||
    head.ordering.scopeToken !== episode.origin_ordering_scope_token ||
    head.ordering.comparatorId !== episode.origin_ordering_comparator_id ||
    head.ordering.comparatorRevision !==
      parseBigint(
        episode.origin_ordering_comparator_revision,
        "Provider episode comparator revision"
      ) ||
    head.ordering.position !==
      parseBigint(
        episode.provider_ordering_head_position,
        "Provider episode ordering head"
      )
  ) {
    throw invariant(
      "Provider episode does not match its durable ordering head."
    );
  }
}

function mapProviderEpisode(
  row: ProviderEpisodeRow,
  expectedTenantId: InboxV2TenantId
): InboxV2ParticipantMembershipEpisode {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId)
    throw new CoreError("tenant.boundary_violation");
  if (
    typeof row.origin_provider_roster_member_evidence_id !== "string" ||
    typeof row.origin_provider_roster_evidence_id !== "string" ||
    typeof row.origin_source_thread_binding_id !== "string" ||
    typeof row.origin_source_external_identity_id !== "string"
  ) {
    throw invariant("Provider episode origin anchors are incomplete.");
  }
  return inboxV2ParticipantMembershipEpisodeSchema.parse({
    tenantId,
    id: row.id,
    participant: {
      tenantId,
      kind: "conversation_participant",
      id: row.participant_id
    },
    origin: {
      kind: "provider_roster",
      memberEvidence: {
        tenantId,
        kind: "provider_roster_member_evidence",
        id: row.origin_provider_roster_member_evidence_id
      }
    },
    state: row.state,
    role: row.role,
    evidenceClassification: row.evidence_classification,
    validFrom: parseTimestamp(row.valid_from, "Provider episode validFrom"),
    validTo:
      row.valid_to === null
        ? null
        : parseTimestamp(row.valid_to, "Provider episode validTo"),
    revision: String(parseBigint(row.revision, "Provider episode revision"))
  });
}

function normalizeStartInput(
  input: StartInboxV2ProviderMembershipEpisodeInput
): NormalizedStart {
  assertStrictInput(input, START_KEYS, "Provider membership start");
  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    participantId: inboxV2ConversationParticipantIdSchema.parse(
      input.participantId
    ),
    episodeId: inboxV2ParticipantMembershipEpisodeIdSchema.parse(
      input.episodeId
    ),
    transitionId: inboxV2ParticipantMembershipTransitionIdSchema.parse(
      input.transitionId
    ),
    rosterEvidenceId: inboxV2ProviderRosterEvidenceIdSchema.parse(
      input.rosterEvidenceId
    ),
    memberEvidenceId: inboxV2ProviderRosterMemberEvidenceIdSchema.parse(
      input.memberEvidenceId
    ),
    sourceThreadBindingId: inboxV2SourceThreadBindingIdSchema.parse(
      input.sourceThreadBindingId
    ),
    sourceExternalIdentityId: inboxV2SourceExternalIdentityIdSchema.parse(
      input.sourceExternalIdentityId
    ),
    role: inboxV2ParticipantMembershipRoleSchema.parse(input.role),
    reasonCodeId: input.reasonCodeId,
    expectedMembershipRevision: inboxV2BigintCounterSchema.parse(
      input.expectedMembershipRevision
    ),
    occurredAt: parseTimestamp(
      inboxV2TimestampSchema.parse(input.occurredAt),
      "Provider membership start occurredAt"
    )
  };
}

function normalizeTransitionInput(
  input: TransitionInboxV2ProviderMembershipEpisodeInput
): NormalizedTransition {
  assertStrictInput(input, TRANSITION_KEYS, "Provider membership transition");
  assertStrictInput(
    input.evidence,
    input.evidence.kind === "member"
      ? MEMBER_EVIDENCE_KEYS
      : OMISSION_EVIDENCE_KEYS,
    "Provider membership transition evidence"
  );
  if (
    (input.intent === "change_role" && input.nextRole === null) ||
    (input.intent !== "change_role" && input.nextRole !== null)
  ) {
    throw new CoreError(
      "validation.failed",
      "Only provider change_role accepts a non-null nextRole."
    );
  }
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const evidenceBase = {
    rosterEvidenceId: inboxV2ProviderRosterEvidenceIdSchema.parse(
      input.evidence.rosterEvidenceId
    ),
    sourceThreadBindingId: inboxV2SourceThreadBindingIdSchema.parse(
      input.evidence.sourceThreadBindingId
    ),
    sourceExternalIdentityId: inboxV2SourceExternalIdentityIdSchema.parse(
      input.evidence.sourceExternalIdentityId
    )
  };
  return {
    tenantId,
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    episodeId: inboxV2ParticipantMembershipEpisodeIdSchema.parse(
      input.episodeId
    ),
    transitionId: inboxV2ParticipantMembershipTransitionIdSchema.parse(
      input.transitionId
    ),
    evidence:
      input.evidence.kind === "member"
        ? {
            kind: "member",
            ...evidenceBase,
            memberEvidenceId: inboxV2ProviderRosterMemberEvidenceIdSchema.parse(
              input.evidence.memberEvidenceId
            )
          }
        : { kind: "roster_omission", ...evidenceBase },
    intent: input.intent,
    nextRole:
      input.nextRole === null
        ? null
        : inboxV2ParticipantMembershipRoleSchema.parse(input.nextRole),
    reasonCodeId: input.reasonCodeId,
    expectedMembershipRevision: inboxV2BigintCounterSchema.parse(
      input.expectedMembershipRevision
    ),
    expectedEpisodeRevision: inboxV2EntityRevisionSchema.parse(
      input.expectedEpisodeRevision
    ),
    occurredAt: parseTimestamp(
      inboxV2TimestampSchema.parse(input.occurredAt),
      "Provider membership transition occurredAt"
    )
  };
}

async function lockMembershipHead(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId; conversationId: InboxV2ConversationId }
): Promise<InboxV2BigintCounter | null> {
  const row = singleRow(
    await executor.execute<MembershipHeadRow>(
      buildLockInboxV2ConversationMembershipHeadSql(input)
    ),
    "Conversation membership head"
  );
  return row === null
    ? null
    : inboxV2BigintCounterSchema.parse(String(row.membership_revision));
}

async function rowExists(
  executor: RawSqlExecutor,
  query: SQL
): Promise<boolean> {
  const result = await executor.execute<InsertedIdRow>(query);
  if (result.rows.length > 1)
    throw invariant("Uniqueness lookup returned many rows.");
  return result.rows.length === 1;
}

async function expectOne(
  executor: RawSqlExecutor,
  query: SQL,
  label: string
): Promise<void> {
  const result = await executor.execute<InsertedIdRow>(query);
  if (result.rows.length !== 1)
    throw invariant(`${label} affected no exact row.`);
}

function singleRow<TRow>(
  result: RawSqlQueryResult<TRow>,
  label: string
): TRow | null {
  if (result.rows.length > 1) throw invariant(`${label} returned many rows.`);
  return result.rows[0] ?? null;
}

async function runTransaction<TResult>(
  executor: InboxV2ParticipantMembershipTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (let attempt = 1; attempt <= TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await executor.transaction(work, TRANSACTION_CONFIG);
    } catch (error) {
      if (
        attempt === TRANSACTION_ATTEMPTS ||
        !hasSqlState(error, RETRYABLE_SQLSTATES)
      ) {
        throw error;
      }
    }
  }
  throw invariant("Provider membership transaction retry exhausted.");
}

function incrementCounter(
  value: InboxV2BigintCounter,
  label: string
): InboxV2BigintCounter {
  const current = BigInt(value);
  if (current >= POSTGRES_BIGINT_MAX) {
    throw new CoreError(
      "validation.failed",
      `${label} exceeds PostgreSQL bigint.`
    );
  }
  return inboxV2BigintCounterSchema.parse(String(current + 1n));
}

function incrementRevision(
  value: InboxV2EntityRevision,
  label: string
): InboxV2EntityRevision {
  const current = BigInt(value);
  if (current >= POSTGRES_BIGINT_MAX) {
    throw new CoreError(
      "validation.failed",
      `${label} exceeds PostgreSQL bigint.`
    );
  }
  return inboxV2EntityRevisionSchema.parse(String(current + 1n));
}

function parseBigint(value: unknown, label: string): bigint {
  if (typeof value === "number") throw invariant(`${label} decoded as number.`);
  try {
    return BigInt(String(value));
  } catch {
    throw invariant(`${label} is not a bigint.`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw invariant(`${label} is not a string.`);
  return value;
}

function parseTimestamp(value: unknown, label: string): string {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw invariant(`${label} is not a timestamp.`);
  }
  return parsed.toISOString();
}

function isTimestampBefore(left: string, right: string): boolean {
  return Date.parse(left) < Date.parse(right);
}

function assertStrictInput(
  input: unknown,
  allowed: ReadonlySet<string>,
  label: string
): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CoreError(
      "validation.failed",
      `${label} input must be an object.`
    );
  }
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new CoreError(
      "validation.failed",
      `${label} input contains unsupported fields: ${unexpected.join(", ")}.`
    );
  }
}

function hasSqlState(error: unknown, states: ReadonlySet<string>): boolean {
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
    if (typeof code === "string" && states.has(code)) return true;
    current = Reflect.get(current, "cause");
  }
  return false;
}

function isProviderEvidenceReuseError(error: unknown): boolean {
  if (!hasSqlState(error, new Set(["23505"]))) return false;
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
    const constraint = Reflect.get(current, "constraint");
    if (
      constraint ===
        "inbox_v2_membership_transitions_provider_member_evidence_unique" ||
      constraint ===
        "inbox_v2_membership_transitions_provider_omission_evidence_unique"
    ) {
      return true;
    }
    current = Reflect.get(current, "cause");
  }
  return false;
}

function invariant(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
