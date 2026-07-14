import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationParticipantIdSchema,
  inboxV2ConversationParticipantSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2ParticipantMembershipEpisodeIdSchema,
  inboxV2ParticipantMembershipEpisodeSchema,
  inboxV2ParticipantMembershipRoleSchema,
  inboxV2ParticipantMembershipTransitionIdSchema,
  inboxV2ParticipantMembershipTransitionSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2BigintCounter,
  type InboxV2ConversationId,
  type InboxV2ConversationParticipant,
  type InboxV2ConversationParticipantId,
  type InboxV2ConversationParticipantSubject,
  type InboxV2EmployeeId,
  type InboxV2EntityRevision,
  type InboxV2ParticipantMembershipEpisode,
  type InboxV2ParticipantMembershipEpisodeId,
  type InboxV2ParticipantMembershipOrigin,
  type InboxV2ParticipantMembershipReasonId,
  type InboxV2ParticipantMembershipRole,
  type InboxV2ParticipantMembershipTransition,
  type InboxV2ParticipantMembershipTransitionId,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const PARTICIPANT_MEMBERSHIP_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const PARTICIPANT_MEMBERSHIP_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_PARTICIPANT_MEMBERSHIP_SQLSTATES = new Set(["40001", "40P01"]);
const PARTICIPANT_CREATE_KEYS = new Set([
  "tenantId",
  "id",
  "conversationId",
  "subject",
  "createdAt"
]);
const START_EPISODE_KEYS = new Set([
  "tenantId",
  "conversationId",
  "participantId",
  "episodeId",
  "transitionId",
  "origin",
  "initialState",
  "role",
  "evidenceClassification",
  "cause",
  "reasonCodeId",
  "expectedMembershipRevision",
  "occurredAt"
]);
const TRANSITION_EPISODE_KEYS = new Set([
  "tenantId",
  "conversationId",
  "episodeId",
  "transitionId",
  "intent",
  "nextRole",
  "cause",
  "reasonCodeId",
  "expectedMembershipRevision",
  "expectedEpisodeRevision",
  "occurredAt"
]);

export type InboxV2NonProviderMembershipOrigin = Exclude<
  InboxV2ParticipantMembershipOrigin,
  { kind: "provider_roster" }
>;

export type InboxV2NonProviderMembershipCause = Exclude<
  InboxV2ParticipantMembershipTransition["cause"],
  { kind: "provider_roster" }
>;

export type CreateInboxV2ConversationParticipantInput = Readonly<{
  tenantId: InboxV2TenantId;
  id: InboxV2ConversationParticipantId;
  conversationId: InboxV2ConversationId;
  subject: InboxV2ConversationParticipantSubject;
  createdAt: string;
}>;

export type CreateInboxV2ConversationParticipantResult = Readonly<{
  kind: "created" | "already_exists" | "identity_conflict" | "subject_conflict";
  record: InboxV2ConversationParticipant;
}>;

export type StartInboxV2ParticipantMembershipEpisodeInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  participantId: InboxV2ConversationParticipantId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  origin: InboxV2NonProviderMembershipOrigin;
  initialState: "pending" | "active";
  role: InboxV2ParticipantMembershipRole;
  evidenceClassification: "confirmed" | "imported";
  cause: InboxV2NonProviderMembershipCause;
  reasonCodeId: InboxV2ParticipantMembershipReasonId;
  expectedMembershipRevision: InboxV2BigintCounter;
  occurredAt: string;
}>;

export type TransitionInboxV2ParticipantMembershipEpisodeInput = Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  intent: "activate" | "change_role" | "leave" | "remove";
  nextRole: InboxV2ParticipantMembershipRole | null;
  cause: InboxV2NonProviderMembershipCause;
  reasonCodeId: InboxV2ParticipantMembershipReasonId;
  expectedMembershipRevision: InboxV2BigintCounter;
  expectedEpisodeRevision: InboxV2EntityRevision;
  occurredAt: string;
}>;

export type InboxV2ParticipantMembershipMutationRecord = Readonly<{
  conversationMembershipRevision: InboxV2BigintCounter;
  episode: InboxV2ParticipantMembershipEpisode;
  transition: InboxV2ParticipantMembershipTransition;
}>;

export type StartInboxV2ParticipantMembershipEpisodeResult =
  | Readonly<{
      kind: "created";
      record: InboxV2ParticipantMembershipMutationRecord;
    }>
  | Readonly<{
      kind: "membership_revision_conflict";
      currentMembershipRevision: InboxV2BigintCounter;
    }>
  | Readonly<{
      kind: "participant_not_found" | "episode_id_conflict";
    }>
  | Readonly<{
      kind: "current_origin_conflict";
      currentEpisode: InboxV2ParticipantMembershipEpisode;
    }>
  | Readonly<{ kind: "conversation_not_found" }>;

export type TransitionInboxV2ParticipantMembershipEpisodeResult =
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
  | Readonly<{ kind: "conversation_not_found" | "episode_not_found" }>;

export type InboxV2ParticipantMembershipTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2ParticipantMembershipRepository = Readonly<{
  createParticipant(
    input: CreateInboxV2ConversationParticipantInput
  ): Promise<CreateInboxV2ConversationParticipantResult>;
  findParticipantById(input: {
    tenantId: InboxV2TenantId;
    participantId: InboxV2ConversationParticipantId;
  }): Promise<InboxV2ConversationParticipant | null>;
  findEpisodeById(input: {
    tenantId: InboxV2TenantId;
    episodeId: InboxV2ParticipantMembershipEpisodeId;
  }): Promise<InboxV2ParticipantMembershipEpisode | null>;
  startEpisode(
    input: StartInboxV2ParticipantMembershipEpisodeInput
  ): Promise<StartInboxV2ParticipantMembershipEpisodeResult>;
  transitionEpisode(
    input: TransitionInboxV2ParticipantMembershipEpisodeInput
  ): Promise<TransitionInboxV2ParticipantMembershipEpisodeResult>;
}>;

type ParticipantRow = {
  tenant_id: unknown;
  id: unknown;
  conversation_id: unknown;
  subject_kind: unknown;
  subject_employee_id: unknown;
  subject_source_external_identity_id: unknown;
  subject_client_contact_id: unknown;
  subject_bot_identity_id: unknown;
  subject_system_actor_id: unknown;
  subject_legacy_provenance_id: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type EpisodeRow = {
  tenant_id: unknown;
  id: unknown;
  participant_id: unknown;
  conversation_id: unknown;
  origin_kind: unknown;
  origin_migration_provenance_id: unknown;
  origin_system_policy_id: unknown;
  state: unknown;
  role: unknown;
  evidence_classification: unknown;
  valid_from: unknown;
  valid_to: unknown;
  revision: unknown;
};

type MembershipHeadRow = { membership_revision: unknown };
type InsertedIdRow = { id: unknown };

export function createSqlInboxV2ParticipantMembershipRepository(
  executor: InboxV2ParticipantMembershipTransactionExecutor | HuleeDatabase
): InboxV2ParticipantMembershipRepository {
  const transactionExecutor =
    executor as unknown as InboxV2ParticipantMembershipTransactionExecutor;

  return {
    async createParticipant(input) {
      const participant = normalizeParticipantInput(input);

      return runParticipantMembershipTransaction(
        transactionExecutor,
        async (transaction) => {
          const insertResult = await transaction.execute<InsertedIdRow>(
            buildInsertInboxV2ConversationParticipantSql(participant)
          );

          if (insertResult.rows.length > 1) {
            throw invariantError(
              "ConversationParticipant insert returned more than one row."
            );
          }
          if (insertResult.rows.length === 1) {
            const created = await loadParticipantById(transaction, {
              tenantId: participant.tenantId,
              participantId: participant.id,
              lock: true
            });
            if (created === null) {
              throw invariantError(
                "ConversationParticipant insert did not produce a readable row."
              );
            }
            return { kind: "created", record: created };
          }

          const existingById = await loadParticipantById(transaction, {
            tenantId: participant.tenantId,
            participantId: participant.id,
            lock: true
          });
          if (existingById !== null) {
            return {
              kind: hasSameParticipantIdentity(existingById, participant)
                ? "already_exists"
                : "identity_conflict",
              record: existingById
            };
          }

          const existingBySubject = await loadParticipantBySubject(
            transaction,
            participant
          );
          if (existingBySubject === null) {
            throw invariantError(
              "ConversationParticipant insert conflicted without an ID or exact-subject winner."
            );
          }
          return { kind: "subject_conflict", record: existingBySubject };
        }
      );
    },

    async findParticipantById(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const participantId = inboxV2ConversationParticipantIdSchema.parse(
        input.participantId
      );

      return loadParticipantById(transactionExecutor, {
        tenantId,
        participantId,
        lock: false
      });
    },

    async findEpisodeById(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const episodeId = inboxV2ParticipantMembershipEpisodeIdSchema.parse(
        input.episodeId
      );

      return loadEpisodeById(transactionExecutor, {
        tenantId,
        episodeId,
        lock: false
      });
    },

    async startEpisode(input) {
      const normalized = normalizeStartEpisodeInput(input);

      return runParticipantMembershipTransaction(
        transactionExecutor,
        async (transaction) => {
          const headRevision = await lockMembershipHead(transaction, {
            tenantId: normalized.episode.tenantId,
            conversationId: normalized.conversationId
          });
          if (headRevision === null) {
            return { kind: "conversation_not_found" } as const;
          }
          if (headRevision !== normalized.expectedMembershipRevision) {
            return {
              kind: "membership_revision_conflict",
              currentMembershipRevision: headRevision
            } as const;
          }

          if (
            normalized.episode.origin.kind === "hulee_internal_command" &&
            !(await lockActiveInternalEmployeeForParticipant(transaction, {
              tenantId: normalized.episode.tenantId,
              conversationId: normalized.conversationId,
              participantId: normalized.episode.participant.id
            }))
          ) {
            return { kind: "participant_not_found" } as const;
          }

          const participant = await loadParticipantById(transaction, {
            tenantId: normalized.episode.tenantId,
            participantId: normalized.episode.participant.id,
            lock: true
          });
          if (
            participant === null ||
            participant.conversation.id !== normalized.conversationId
          ) {
            return { kind: "participant_not_found" } as const;
          }

          const episodeById = await loadEpisodeById(transaction, {
            tenantId: normalized.episode.tenantId,
            episodeId: normalized.episode.id,
            lock: true
          });
          if (episodeById !== null) {
            return { kind: "episode_id_conflict" } as const;
          }

          const currentOrigin = await loadCurrentEpisodeByOrigin(
            transaction,
            normalized.episode
          );
          if (currentOrigin !== null) {
            return {
              kind: "current_origin_conflict",
              currentEpisode: currentOrigin
            } as const;
          }

          await expectOneReturnedRow(
            transaction,
            buildInsertInboxV2ConversationMembershipCommitSql({
              tenantId: normalized.episode.tenantId,
              conversationId: normalized.conversationId,
              expectedMembershipRevision: normalized.expectedMembershipRevision,
              resultingMembershipRevision:
                normalized.resultingMembershipRevision,
              occurredAt: normalized.episode.validFrom
            }),
            "Conversation membership commit insert"
          );
          await expectOneReturnedRow(
            transaction,
            buildInsertInboxV2ParticipantMembershipEpisodeSql({
              episode: normalized.episode,
              conversationId: normalized.conversationId
            }),
            "Participant membership episode insert"
          );
          await expectOneReturnedRow(
            transaction,
            buildInsertInboxV2ParticipantMembershipTransitionSql({
              transition: normalized.transition,
              conversationId: normalized.conversationId,
              participantId: normalized.episode.participant.id,
              membershipRevision: normalized.resultingMembershipRevision
            }),
            "Participant membership transition insert"
          );
          await expectOneReturnedRow(
            transaction,
            buildAdvanceInboxV2ConversationMembershipHeadSql({
              tenantId: normalized.episode.tenantId,
              conversationId: normalized.conversationId,
              expectedMembershipRevision: normalized.expectedMembershipRevision,
              resultingMembershipRevision:
                normalized.resultingMembershipRevision,
              changedAt: normalized.episode.validFrom
            }),
            "Conversation membership head advance"
          );

          return {
            kind: "created",
            record: {
              conversationMembershipRevision:
                normalized.resultingMembershipRevision,
              episode: normalized.episode,
              transition: normalized.transition
            }
          } as const;
        }
      );
    },

    async transitionEpisode(input) {
      const normalized = normalizeTransitionEpisodeInput(input);

      return runParticipantMembershipTransaction(
        transactionExecutor,
        async (transaction) => {
          const headRevision = await lockMembershipHead(transaction, {
            tenantId: normalized.tenantId,
            conversationId: normalized.conversationId
          });
          if (headRevision === null) {
            return { kind: "conversation_not_found" } as const;
          }
          if (headRevision !== normalized.expectedMembershipRevision) {
            return {
              kind: "membership_revision_conflict",
              currentMembershipRevision: headRevision
            } as const;
          }

          if (
            normalized.cause.kind === "hulee_internal_command" &&
            (normalized.intent === "activate" ||
              normalized.intent === "change_role") &&
            !(await lockActiveInternalEmployeeForEpisode(transaction, {
              tenantId: normalized.tenantId,
              conversationId: normalized.conversationId,
              episodeId: normalized.episodeId
            }))
          ) {
            return { kind: "episode_not_found" } as const;
          }

          const currentEpisode = await loadEpisodeById(transaction, {
            tenantId: normalized.tenantId,
            episodeId: normalized.episodeId,
            conversationId: normalized.conversationId,
            lock: true
          });
          if (
            currentEpisode === null ||
            currentEpisode.participant.tenantId !== normalized.tenantId
          ) {
            return { kind: "episode_not_found" } as const;
          }
          if (currentEpisode.revision !== normalized.expectedEpisodeRevision) {
            return {
              kind: "episode_revision_conflict",
              currentEpisode
            } as const;
          }
          if (
            !membershipCauseMatchesOrigin(
              currentEpisode.origin,
              normalized.cause
            )
          ) {
            throw new CoreError(
              "validation.failed",
              "Membership transition cause must match the episode origin."
            );
          }

          const mutation = buildEpisodeTransitionMutation({
            currentEpisode,
            input: normalized
          });

          await expectOneReturnedRow(
            transaction,
            buildInsertInboxV2ConversationMembershipCommitSql({
              tenantId: normalized.tenantId,
              conversationId: normalized.conversationId,
              expectedMembershipRevision: normalized.expectedMembershipRevision,
              resultingMembershipRevision:
                mutation.conversationMembershipRevision,
              occurredAt: normalized.occurredAt
            }),
            "Conversation membership commit insert"
          );
          await expectOneReturnedRow(
            transaction,
            buildInsertInboxV2ParticipantMembershipTransitionSql({
              transition: mutation.transition,
              conversationId: normalized.conversationId,
              participantId: currentEpisode.participant.id,
              membershipRevision: mutation.conversationMembershipRevision
            }),
            "Participant membership transition insert"
          );
          await expectOneReturnedRow(
            transaction,
            buildUpdateInboxV2ParticipantMembershipEpisodeSql({
              before: currentEpisode,
              after: mutation.episode
            }),
            "Participant membership episode projection update"
          );
          await expectOneReturnedRow(
            transaction,
            buildAdvanceInboxV2ConversationMembershipHeadSql({
              tenantId: normalized.tenantId,
              conversationId: normalized.conversationId,
              expectedMembershipRevision: normalized.expectedMembershipRevision,
              resultingMembershipRevision:
                mutation.conversationMembershipRevision,
              changedAt: normalized.occurredAt
            }),
            "Conversation membership head advance"
          );

          return {
            kind: "updated",
            record: {
              conversationMembershipRevision:
                mutation.conversationMembershipRevision,
              episode: mutation.episode,
              transition: mutation.transition
            }
          } as const;
        }
      );
    }
  };
}

async function runParticipantMembershipTransaction<TResult>(
  executor: InboxV2ParticipantMembershipTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (
    let attempt = 1;
    attempt <= PARTICIPANT_MEMBERSHIP_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await executor.transaction(
        work,
        PARTICIPANT_MEMBERSHIP_TRANSACTION_CONFIG
      );
    } catch (error) {
      if (
        attempt === PARTICIPANT_MEMBERSHIP_TRANSACTION_ATTEMPTS ||
        !isRetryableParticipantMembershipTransactionError(error)
      ) {
        throw error;
      }
    }
  }

  throw invariantError("Participant membership transaction retry exhausted.");
}

function isRetryableParticipantMembershipTransactionError(
  error: unknown
): boolean {
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
    if (
      typeof code === "string" &&
      RETRYABLE_PARTICIPANT_MEMBERSHIP_SQLSTATES.has(code)
    ) {
      return true;
    }
    current = Reflect.get(current, "cause");
  }

  return false;
}

export function buildInsertInboxV2ConversationParticipantSql(
  participant: InboxV2ConversationParticipant
): SQL {
  const subject = participantSubjectColumns(participant.subject);

  return sql`
    insert into inbox_v2_conversation_participants (
      tenant_id,
      id,
      conversation_id,
      subject_kind,
      subject_employee_id,
      subject_source_external_identity_id,
      subject_client_contact_id,
      subject_bot_identity_id,
      subject_system_actor_id,
      subject_legacy_provenance_id,
      revision,
      created_at,
      updated_at
    ) values (
      ${participant.tenantId},
      ${participant.id},
      ${participant.conversation.id},
      ${participant.subject.kind},
      ${subject.employeeId},
      ${subject.sourceExternalIdentityId},
      ${subject.clientContactId},
      ${subject.botIdentityId},
      ${subject.systemActorId},
      ${subject.legacyProvenanceId},
      1,
      ${participant.createdAt},
      ${participant.updatedAt}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildFindInboxV2ConversationParticipantByIdSql(input: {
  tenantId: InboxV2TenantId;
  participantId: InboxV2ConversationParticipantId;
  lock?: boolean;
}): SQL {
  const lock = input.lock ? sql`for update` : sql``;

  return sql`
    select
      tenant_id,
      id,
      conversation_id,
      subject_kind,
      subject_employee_id,
      subject_source_external_identity_id,
      subject_client_contact_id,
      subject_bot_identity_id,
      subject_system_actor_id,
      subject_legacy_provenance_id,
      revision,
      created_at,
      updated_at
    from inbox_v2_conversation_participants
    where tenant_id = ${input.tenantId}
      and id = ${input.participantId}
    ${lock}
  `;
}

export function buildFindInboxV2ConversationParticipantBySubjectSql(
  participant: InboxV2ConversationParticipant
): SQL {
  const predicate = participantSubjectPredicate(participant.subject);

  return sql`
    select
      tenant_id,
      id,
      conversation_id,
      subject_kind,
      subject_employee_id,
      subject_source_external_identity_id,
      subject_client_contact_id,
      subject_bot_identity_id,
      subject_system_actor_id,
      subject_legacy_provenance_id,
      revision,
      created_at,
      updated_at
    from inbox_v2_conversation_participants
    where tenant_id = ${participant.tenantId}
      and conversation_id = ${participant.conversation.id}
      and ${predicate}
    for update
  `;
}

export function buildLockInboxV2ConversationMembershipHeadSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select membership_revision
    from inbox_v2_conversation_membership_heads
    where tenant_id = ${input.tenantId}
      and conversation_id = ${input.conversationId}
    for update
  `;
}

export function buildLockActiveInboxV2InternalEmployeeForParticipantSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  participantId: InboxV2ConversationParticipantId;
}): SQL {
  return sql`
    select employee_row.id
    from inbox_v2_conversation_participants participant_row
    join employees employee_row
      on employee_row.tenant_id = participant_row.tenant_id
     and employee_row.id = participant_row.subject_employee_id
    join inbox_v2_conversations conversation_row
      on conversation_row.tenant_id = participant_row.tenant_id
     and conversation_row.id = participant_row.conversation_id
    where participant_row.tenant_id = ${input.tenantId}
      and participant_row.id = ${input.participantId}
      and participant_row.conversation_id = ${input.conversationId}
      and participant_row.subject_kind = 'employee'
      and employee_row.deactivated_at is null
      and conversation_row.transport = 'internal'
    for no key update of employee_row
  `;
}

export function buildLockActiveInboxV2InternalEmployeeForEpisodeSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
}): SQL {
  return sql`
    select employee_row.id
    from inbox_v2_participant_membership_episodes episode_row
    join inbox_v2_conversation_participants participant_row
      on participant_row.tenant_id = episode_row.tenant_id
     and participant_row.id = episode_row.participant_id
     and participant_row.conversation_id = episode_row.conversation_id
    join employees employee_row
      on employee_row.tenant_id = participant_row.tenant_id
     and employee_row.id = participant_row.subject_employee_id
    join inbox_v2_conversations conversation_row
      on conversation_row.tenant_id = episode_row.tenant_id
     and conversation_row.id = episode_row.conversation_id
    where episode_row.tenant_id = ${input.tenantId}
      and episode_row.id = ${input.episodeId}
      and episode_row.conversation_id = ${input.conversationId}
      and episode_row.origin_kind = 'hulee_internal_command'
      and episode_row.state in ('pending', 'active')
      and participant_row.subject_kind = 'employee'
      and employee_row.deactivated_at is null
      and conversation_row.transport = 'internal'
    for no key update of employee_row
  `;
}

export function buildInsertInboxV2ConversationMembershipCommitSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  expectedMembershipRevision: InboxV2BigintCounter;
  resultingMembershipRevision: InboxV2BigintCounter;
  occurredAt: string;
}): SQL {
  return sql`
    insert into inbox_v2_conversation_membership_commits (
      tenant_id,
      conversation_id,
      expected_membership_revision,
      resulting_membership_revision,
      occurred_at
    ) values (
      ${input.tenantId},
      ${input.conversationId},
      ${input.expectedMembershipRevision},
      ${input.resultingMembershipRevision},
      ${input.occurredAt}
    )
    returning resulting_membership_revision as id
  `;
}

export function buildInsertInboxV2ParticipantMembershipEpisodeSql(input: {
  episode: InboxV2ParticipantMembershipEpisode;
  conversationId: InboxV2ConversationId;
}): SQL {
  const { episode } = input;
  const origin = membershipOriginColumns(episode.origin);

  return sql`
    insert into inbox_v2_participant_membership_episodes (
      tenant_id,
      id,
      participant_id,
      conversation_id,
      origin_kind,
      origin_migration_provenance_id,
      origin_system_policy_id,
      state,
      role,
      evidence_classification,
      valid_from,
      valid_to,
      revision
    ) values (
      ${episode.tenantId},
      ${episode.id},
      ${episode.participant.id},
      ${input.conversationId},
      ${episode.origin.kind},
      ${origin.migrationProvenanceId},
      ${origin.systemPolicyId},
      ${episode.state},
      ${episode.role},
      ${episode.evidenceClassification},
      ${episode.validFrom},
      ${episode.validTo},
      ${episode.revision}
    )
    returning id
  `;
}

export function buildInsertInboxV2ParticipantMembershipTransitionSql(input: {
  transition: InboxV2ParticipantMembershipTransition;
  participantId: InboxV2ConversationParticipantId;
  conversationId: InboxV2ConversationId;
  membershipRevision: InboxV2BigintCounter;
}): SQL {
  const cause = membershipCauseColumns(input.transition.cause);

  return sql`
    insert into inbox_v2_participant_membership_transitions (
      tenant_id,
      id,
      episode_id,
      participant_id,
      conversation_id,
      membership_revision,
      intent,
      from_state,
      to_state,
      from_role,
      to_role,
      cause_kind,
      cause_actor_employee_id,
      cause_trusted_service_id,
      cause_migration_provenance_id,
      cause_system_policy_id,
      reason_code_id,
      expected_revision,
      current_revision,
      resulting_revision,
      occurred_at
    ) values (
      ${input.transition.tenantId},
      ${input.transition.id},
      ${input.transition.episode.id},
      ${input.participantId},
      ${input.conversationId},
      ${input.membershipRevision},
      ${input.transition.intent},
      ${input.transition.fromState},
      ${input.transition.toState},
      ${input.transition.fromRole},
      ${input.transition.toRole},
      ${input.transition.cause.kind},
      ${cause.actorEmployeeId},
      ${cause.trustedServiceId},
      ${cause.migrationProvenanceId},
      ${cause.systemPolicyId},
      ${input.transition.reasonCodeId},
      ${input.transition.expectedRevision},
      ${input.transition.currentRevision},
      ${input.transition.resultingRevision},
      ${input.transition.occurredAt}
    )
    returning id
  `;
}

export function buildAdvanceInboxV2ConversationMembershipHeadSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  expectedMembershipRevision: InboxV2BigintCounter;
  resultingMembershipRevision: InboxV2BigintCounter;
  changedAt: string;
}): SQL {
  return sql`
    update inbox_v2_conversation_membership_heads
    set membership_revision = ${input.resultingMembershipRevision},
        updated_at = ${input.changedAt}
    where tenant_id = ${input.tenantId}
      and conversation_id = ${input.conversationId}
      and membership_revision = ${input.expectedMembershipRevision}
    returning conversation_id as id
  `;
}

export function buildFindInboxV2ParticipantMembershipEpisodeByIdSql(input: {
  tenantId: InboxV2TenantId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  conversationId?: InboxV2ConversationId;
  lock?: boolean;
}): SQL {
  const lock = input.lock ? sql`for update` : sql``;
  const conversationPredicate = input.conversationId
    ? sql`and conversation_id = ${input.conversationId}`
    : sql``;

  return sql`
    select
      tenant_id,
      id,
      participant_id,
      conversation_id,
      origin_kind,
      origin_migration_provenance_id,
      origin_system_policy_id,
      state,
      role,
      evidence_classification,
      valid_from,
      valid_to,
      revision
    from inbox_v2_participant_membership_episodes
    where tenant_id = ${input.tenantId}
      and id = ${input.episodeId}
      ${conversationPredicate}
    ${lock}
  `;
}

export function buildFindCurrentInboxV2ParticipantMembershipEpisodeSql(
  episode: InboxV2ParticipantMembershipEpisode
): SQL {
  const originPredicate = membershipOriginPredicate(episode.origin);

  return sql`
    select
      tenant_id,
      id,
      participant_id,
      conversation_id,
      origin_kind,
      origin_migration_provenance_id,
      origin_system_policy_id,
      state,
      role,
      evidence_classification,
      valid_from,
      valid_to,
      revision
    from inbox_v2_participant_membership_episodes
    where tenant_id = ${episode.tenantId}
      and participant_id = ${episode.participant.id}
      and ${originPredicate}
      and state in ('pending', 'active')
    for update
  `;
}

export function buildUpdateInboxV2ParticipantMembershipEpisodeSql(input: {
  before: InboxV2ParticipantMembershipEpisode;
  after: InboxV2ParticipantMembershipEpisode;
}): SQL {
  return sql`
    update inbox_v2_participant_membership_episodes
    set state = ${input.after.state},
        role = ${input.after.role},
        valid_to = ${input.after.validTo},
        revision = ${input.after.revision}
    where tenant_id = ${input.before.tenantId}
      and id = ${input.before.id}
      and revision = ${input.before.revision}
    returning id
  `;
}

async function lockMembershipHead(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
  }
): Promise<InboxV2BigintCounter | null> {
  const result = await executor.execute<MembershipHeadRow>(
    buildLockInboxV2ConversationMembershipHeadSql(input)
  );
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw invariantError(
      "Conversation membership head lookup returned more than one row."
    );
  }
  return parseDatabaseCounter(
    result.rows[0]?.membership_revision,
    "Conversation membership revision"
  );
}

async function lockActiveInternalEmployeeForParticipant(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    participantId: InboxV2ConversationParticipantId;
  }
): Promise<boolean> {
  return hasExactlyOneEmployeeLockRow(
    await executor.execute<InsertedIdRow>(
      buildLockActiveInboxV2InternalEmployeeForParticipantSql(input)
    )
  );
}

async function lockActiveInternalEmployeeForEpisode(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    episodeId: InboxV2ParticipantMembershipEpisodeId;
  }
): Promise<boolean> {
  return hasExactlyOneEmployeeLockRow(
    await executor.execute<InsertedIdRow>(
      buildLockActiveInboxV2InternalEmployeeForEpisodeSql(input)
    )
  );
}

function hasExactlyOneEmployeeLockRow(
  result: RawSqlQueryResult<InsertedIdRow>
): boolean {
  if (result.rows.length > 1) {
    throw invariantError(
      "Internal membership Employee lock returned more than one row."
    );
  }
  return result.rows.length === 1;
}

async function loadParticipantById(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    participantId: InboxV2ConversationParticipantId;
    lock: boolean;
  }
): Promise<InboxV2ConversationParticipant | null> {
  const result = await executor.execute<ParticipantRow>(
    buildFindInboxV2ConversationParticipantByIdSql(input)
  );
  return mapSingleParticipantResult(result, input.tenantId);
}

async function loadParticipantBySubject(
  executor: RawSqlExecutor,
  participant: InboxV2ConversationParticipant
): Promise<InboxV2ConversationParticipant | null> {
  const result = await executor.execute<ParticipantRow>(
    buildFindInboxV2ConversationParticipantBySubjectSql(participant)
  );
  return mapSingleParticipantResult(result, participant.tenantId);
}

async function loadEpisodeById(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    episodeId: InboxV2ParticipantMembershipEpisodeId;
    conversationId?: InboxV2ConversationId;
    lock: boolean;
  }
): Promise<InboxV2ParticipantMembershipEpisode | null> {
  const result = await executor.execute<EpisodeRow>(
    buildFindInboxV2ParticipantMembershipEpisodeByIdSql(input)
  );
  return mapSingleEpisodeResult(result, input.tenantId, input.conversationId);
}

async function loadCurrentEpisodeByOrigin(
  executor: RawSqlExecutor,
  episode: InboxV2ParticipantMembershipEpisode
): Promise<InboxV2ParticipantMembershipEpisode | null> {
  const result = await executor.execute<EpisodeRow>(
    buildFindCurrentInboxV2ParticipantMembershipEpisodeSql(episode)
  );
  return mapSingleEpisodeResult(result, episode.tenantId);
}

async function expectOneReturnedRow(
  executor: RawSqlExecutor,
  query: SQL,
  label: string
): Promise<void> {
  const result = await executor.execute<InsertedIdRow>(query);
  if (result.rows.length !== 1) {
    throw invariantError(`${label} did not affect exactly one row.`);
  }
}

function normalizeParticipantInput(
  input: CreateInboxV2ConversationParticipantInput
): InboxV2ConversationParticipant {
  assertStrictInput(input, PARTICIPANT_CREATE_KEYS, "ConversationParticipant");
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const createdAt = inboxV2TimestampSchema.parse(input.createdAt);

  return inboxV2ConversationParticipantSchema.parse({
    tenantId,
    id: inboxV2ConversationParticipantIdSchema.parse(input.id),
    conversation: {
      tenantId,
      kind: "conversation",
      id: inboxV2ConversationIdSchema.parse(input.conversationId)
    },
    subject: input.subject,
    revision: "1",
    createdAt,
    updatedAt: createdAt
  });
}

function normalizeStartEpisodeInput(
  input: StartInboxV2ParticipantMembershipEpisodeInput
): Readonly<{
  conversationId: InboxV2ConversationId;
  expectedMembershipRevision: InboxV2BigintCounter;
  resultingMembershipRevision: InboxV2BigintCounter;
  episode: InboxV2ParticipantMembershipEpisode;
  transition: InboxV2ParticipantMembershipTransition;
}> {
  assertStrictInput(input, START_EPISODE_KEYS, "Membership episode start");
  if (!membershipCauseMatchesOrigin(input.origin, input.cause)) {
    throw new CoreError(
      "validation.failed",
      "Membership cause must match the episode origin."
    );
  }

  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const conversationId = inboxV2ConversationIdSchema.parse(
    input.conversationId
  );
  const participantId = inboxV2ConversationParticipantIdSchema.parse(
    input.participantId
  );
  const expectedMembershipRevision = inboxV2BigintCounterSchema.parse(
    input.expectedMembershipRevision
  );
  const resultingMembershipRevision = incrementCounter(
    expectedMembershipRevision,
    "Conversation membership revision"
  );
  const occurredAt = inboxV2TimestampSchema.parse(input.occurredAt);
  const episode = inboxV2ParticipantMembershipEpisodeSchema.parse({
    tenantId,
    id: inboxV2ParticipantMembershipEpisodeIdSchema.parse(input.episodeId),
    participant: {
      tenantId,
      kind: "conversation_participant",
      id: participantId
    },
    origin: input.origin,
    state: input.initialState,
    role: inboxV2ParticipantMembershipRoleSchema.parse(input.role),
    evidenceClassification: input.evidenceClassification,
    validFrom: occurredAt,
    validTo: null,
    revision: "1"
  });
  const transition = inboxV2ParticipantMembershipTransitionSchema.parse({
    tenantId,
    id: inboxV2ParticipantMembershipTransitionIdSchema.parse(
      input.transitionId
    ),
    episode: {
      tenantId,
      kind: "participant_membership_episode",
      id: episode.id
    },
    intent:
      input.initialState === "pending" ? "initial_pending" : "initial_active",
    fromState: null,
    toState: input.initialState,
    fromRole: null,
    toRole: episode.role,
    cause: input.cause,
    reasonCodeId: input.reasonCodeId,
    expectedRevision: null,
    currentRevision: null,
    resultingRevision: "1",
    occurredAt
  });

  return {
    conversationId,
    expectedMembershipRevision,
    resultingMembershipRevision,
    episode,
    transition
  };
}

function normalizeTransitionEpisodeInput(
  input: TransitionInboxV2ParticipantMembershipEpisodeInput
): Readonly<{
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  episodeId: InboxV2ParticipantMembershipEpisodeId;
  transitionId: InboxV2ParticipantMembershipTransitionId;
  intent: TransitionInboxV2ParticipantMembershipEpisodeInput["intent"];
  nextRole: InboxV2ParticipantMembershipRole | null;
  cause: InboxV2NonProviderMembershipCause;
  reasonCodeId: InboxV2ParticipantMembershipReasonId;
  expectedMembershipRevision: InboxV2BigintCounter;
  expectedEpisodeRevision: InboxV2EntityRevision;
  occurredAt: string;
}> {
  assertStrictInput(
    input,
    TRANSITION_EPISODE_KEYS,
    "Membership episode transition"
  );
  if (
    (input.intent === "change_role" && input.nextRole === null) ||
    (input.intent !== "change_role" && input.nextRole !== null)
  ) {
    throw new CoreError(
      "validation.failed",
      "Only change_role accepts a non-null nextRole."
    );
  }

  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    episodeId: inboxV2ParticipantMembershipEpisodeIdSchema.parse(
      input.episodeId
    ),
    transitionId: inboxV2ParticipantMembershipTransitionIdSchema.parse(
      input.transitionId
    ),
    intent: input.intent,
    nextRole:
      input.nextRole === null
        ? null
        : inboxV2ParticipantMembershipRoleSchema.parse(input.nextRole),
    cause: input.cause,
    reasonCodeId: input.reasonCodeId,
    expectedMembershipRevision: inboxV2BigintCounterSchema.parse(
      input.expectedMembershipRevision
    ),
    expectedEpisodeRevision: inboxV2EntityRevisionSchema.parse(
      input.expectedEpisodeRevision
    ),
    occurredAt: inboxV2TimestampSchema.parse(input.occurredAt)
  };
}

function buildEpisodeTransitionMutation(input: {
  currentEpisode: InboxV2ParticipantMembershipEpisode;
  input: ReturnType<typeof normalizeTransitionEpisodeInput>;
}): InboxV2ParticipantMembershipMutationRecord {
  const nextEpisodeRevision = incrementEntityRevision(
    input.currentEpisode.revision,
    "Participant membership episode revision"
  );
  const resultingMembershipRevision = incrementCounter(
    input.input.expectedMembershipRevision,
    "Conversation membership revision"
  );
  const toState = transitionTargetState(
    input.input.intent,
    input.currentEpisode.state
  );
  const toRole = input.input.nextRole ?? input.currentEpisode.role;
  const transition = inboxV2ParticipantMembershipTransitionSchema.parse({
    tenantId: input.input.tenantId,
    id: input.input.transitionId,
    episode: {
      tenantId: input.input.tenantId,
      kind: "participant_membership_episode",
      id: input.currentEpisode.id
    },
    intent: input.input.intent,
    fromState: input.currentEpisode.state,
    toState,
    fromRole: input.currentEpisode.role,
    toRole,
    cause: input.input.cause,
    reasonCodeId: input.input.reasonCodeId,
    expectedRevision: input.input.expectedEpisodeRevision,
    currentRevision: input.currentEpisode.revision,
    resultingRevision: nextEpisodeRevision,
    occurredAt: input.input.occurredAt
  });
  const episode = inboxV2ParticipantMembershipEpisodeSchema.parse({
    ...input.currentEpisode,
    state: toState,
    role: toRole,
    validTo:
      toState === "left" || toState === "removed"
        ? input.input.occurredAt
        : null,
    revision: nextEpisodeRevision
  });

  return {
    conversationMembershipRevision: resultingMembershipRevision,
    episode,
    transition
  };
}

function transitionTargetState(
  intent: TransitionInboxV2ParticipantMembershipEpisodeInput["intent"],
  currentState: InboxV2ParticipantMembershipEpisode["state"]
): InboxV2ParticipantMembershipEpisode["state"] {
  if (intent === "activate") return "active";
  if (intent === "leave") return "left";
  if (intent === "remove") return "removed";
  return currentState;
}

function mapSingleParticipantResult(
  result: RawSqlQueryResult<ParticipantRow>,
  expectedTenantId: InboxV2TenantId
): InboxV2ConversationParticipant | null {
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw invariantError(
      "Tenant-scoped ConversationParticipant lookup returned more than one row."
    );
  }
  return mapParticipantRow(result.rows[0], expectedTenantId);
}

function mapParticipantRow(
  row: ParticipantRow | undefined,
  expectedTenantId: InboxV2TenantId
): InboxV2ConversationParticipant {
  if (!row) throw invariantError("ConversationParticipant row is missing.");
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  try {
    return inboxV2ConversationParticipantSchema.parse({
      tenantId,
      id: row.id,
      conversation: {
        tenantId,
        kind: "conversation",
        id: row.conversation_id
      },
      subject: participantSubjectFromRow(row, tenantId),
      revision: parseDatabaseEntityRevision(
        row.revision,
        "ConversationParticipant revision"
      ),
      createdAt: parseDatabaseTimestamp(
        row.created_at,
        "ConversationParticipant createdAt"
      ),
      updatedAt: parseDatabaseTimestamp(
        row.updated_at,
        "ConversationParticipant updatedAt"
      )
    });
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw invariantError(
      "ConversationParticipant persistence row violates its canonical contract."
    );
  }
}

function mapSingleEpisodeResult(
  result: RawSqlQueryResult<EpisodeRow>,
  expectedTenantId: InboxV2TenantId,
  expectedConversationId?: InboxV2ConversationId
): InboxV2ParticipantMembershipEpisode | null {
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw invariantError(
      "Tenant-scoped membership episode lookup returned more than one row."
    );
  }
  return mapEpisodeRow(
    result.rows[0],
    expectedTenantId,
    expectedConversationId
  );
}

function mapEpisodeRow(
  row: EpisodeRow | undefined,
  expectedTenantId: InboxV2TenantId,
  expectedConversationId?: InboxV2ConversationId
): InboxV2ParticipantMembershipEpisode | null {
  if (!row) throw invariantError("Membership episode row is missing.");
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  try {
    const conversationId = inboxV2ConversationIdSchema.parse(
      row.conversation_id
    );
    if (
      expectedConversationId !== undefined &&
      conversationId !== expectedConversationId
    ) {
      return null;
    }
    assertMembershipOriginRowShape(row);
    return inboxV2ParticipantMembershipEpisodeSchema.parse({
      tenantId,
      id: row.id,
      participant: {
        tenantId,
        kind: "conversation_participant",
        id: row.participant_id
      },
      origin: membershipOriginFromRow(row),
      state: row.state,
      role: row.role,
      evidenceClassification: row.evidence_classification,
      validFrom: parseDatabaseTimestamp(row.valid_from, "Episode validFrom"),
      validTo:
        row.valid_to === null
          ? null
          : parseDatabaseTimestamp(row.valid_to, "Episode validTo"),
      revision: parseDatabaseEntityRevision(row.revision, "Episode revision")
    });
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw invariantError(
      "Membership episode persistence row violates its canonical contract."
    );
  }
}

function participantSubjectFromRow(
  row: ParticipantRow,
  tenantId: InboxV2TenantId
): InboxV2ConversationParticipantSubject {
  assertParticipantSubjectRowShape(row);
  switch (row.subject_kind) {
    case "employee":
      return {
        kind: "employee",
        employee: {
          tenantId,
          kind: "employee",
          id: inboxV2EmployeeIdSchema.parse(row.subject_employee_id)
        }
      };
    case "source_external_identity":
      return {
        kind: "source_external_identity",
        sourceExternalIdentity: {
          tenantId,
          kind: "source_external_identity",
          id: row.subject_source_external_identity_id as never
        }
      };
    case "client_contact":
      return {
        kind: "client_contact",
        clientContact: {
          tenantId,
          kind: "client_contact",
          id: row.subject_client_contact_id as never
        }
      };
    case "bot":
      return {
        kind: "bot",
        bot: {
          tenantId,
          kind: "bot_identity",
          id: row.subject_bot_identity_id as never
        }
      };
    case "system":
      return {
        kind: "system",
        systemActorId: row.subject_system_actor_id as never
      };
    case "legacy_unknown":
      return {
        kind: "legacy_unknown",
        provenanceCodeId: row.subject_legacy_provenance_id as never
      };
    default:
      throw invariantError(
        "ConversationParticipant row contains an unknown subject kind."
      );
  }
}

function membershipOriginFromRow(
  row: EpisodeRow
): InboxV2NonProviderMembershipOrigin {
  assertMembershipOriginRowShape(row);
  if (row.origin_kind === "hulee_internal_command") {
    return { kind: "hulee_internal_command" };
  }
  if (
    row.origin_kind === "migration" &&
    typeof row.origin_migration_provenance_id === "string"
  ) {
    return {
      kind: "migration",
      provenanceId: row.origin_migration_provenance_id as never
    };
  }
  if (
    row.origin_kind === "system_policy" &&
    typeof row.origin_system_policy_id === "string"
  ) {
    return {
      kind: "system_policy",
      policyId: row.origin_system_policy_id as never
    };
  }
  throw invariantError(
    "Membership episode row contains an unsupported or incomplete origin."
  );
}

function assertParticipantSubjectRowShape(row: ParticipantRow): void {
  const populatedColumns = [
    row.subject_employee_id,
    row.subject_source_external_identity_id,
    row.subject_client_contact_id,
    row.subject_bot_identity_id,
    row.subject_system_actor_id,
    row.subject_legacy_provenance_id
  ].filter((value) => value !== null).length;
  const exactKindColumnIsPopulated =
    (row.subject_kind === "employee" && row.subject_employee_id !== null) ||
    (row.subject_kind === "source_external_identity" &&
      row.subject_source_external_identity_id !== null) ||
    (row.subject_kind === "client_contact" &&
      row.subject_client_contact_id !== null) ||
    (row.subject_kind === "bot" && row.subject_bot_identity_id !== null) ||
    (row.subject_kind === "system" && row.subject_system_actor_id !== null) ||
    (row.subject_kind === "legacy_unknown" &&
      row.subject_legacy_provenance_id !== null);
  if (populatedColumns !== 1 || !exactKindColumnIsPopulated) {
    throw invariantError(
      "ConversationParticipant row violates its typed-subject XOR."
    );
  }
}

function assertMembershipOriginRowShape(row: EpisodeRow): void {
  const valid =
    (row.origin_kind === "hulee_internal_command" &&
      row.origin_migration_provenance_id === null &&
      row.origin_system_policy_id === null) ||
    (row.origin_kind === "migration" &&
      typeof row.origin_migration_provenance_id === "string" &&
      row.origin_system_policy_id === null) ||
    (row.origin_kind === "system_policy" &&
      row.origin_migration_provenance_id === null &&
      typeof row.origin_system_policy_id === "string");
  if (!valid) {
    throw invariantError(
      "Membership episode row violates its non-provider origin XOR."
    );
  }
}

function participantSubjectColumns(
  subject: InboxV2ConversationParticipantSubject
): Readonly<{
  employeeId: string | null;
  sourceExternalIdentityId: string | null;
  clientContactId: string | null;
  botIdentityId: string | null;
  systemActorId: string | null;
  legacyProvenanceId: string | null;
}> {
  return {
    employeeId: subject.kind === "employee" ? subject.employee.id : null,
    sourceExternalIdentityId:
      subject.kind === "source_external_identity"
        ? subject.sourceExternalIdentity.id
        : null,
    clientContactId:
      subject.kind === "client_contact" ? subject.clientContact.id : null,
    botIdentityId: subject.kind === "bot" ? subject.bot.id : null,
    systemActorId: subject.kind === "system" ? subject.systemActorId : null,
    legacyProvenanceId:
      subject.kind === "legacy_unknown" ? subject.provenanceCodeId : null
  };
}

function participantSubjectPredicate(
  subject: InboxV2ConversationParticipantSubject
): SQL {
  switch (subject.kind) {
    case "employee":
      return sql`subject_kind = 'employee'
        and subject_employee_id = ${subject.employee.id}`;
    case "source_external_identity":
      return sql`subject_kind = 'source_external_identity'
        and subject_source_external_identity_id = ${subject.sourceExternalIdentity.id}`;
    case "client_contact":
      return sql`subject_kind = 'client_contact'
        and subject_client_contact_id = ${subject.clientContact.id}`;
    case "bot":
      return sql`subject_kind = 'bot'
        and subject_bot_identity_id = ${subject.bot.id}`;
    case "system":
      return sql`subject_kind = 'system'
        and subject_system_actor_id = ${subject.systemActorId}`;
    case "legacy_unknown":
      return sql`subject_kind = 'legacy_unknown'
        and subject_legacy_provenance_id = ${subject.provenanceCodeId}`;
  }
}

function membershipOriginColumns(
  origin: InboxV2ParticipantMembershipOrigin
): Readonly<{
  migrationProvenanceId: string | null;
  systemPolicyId: string | null;
}> {
  if (origin.kind === "provider_roster") {
    throw new CoreError(
      "validation.failed",
      "Provider roster origin is not available in the foundation repository."
    );
  }
  return {
    migrationProvenanceId:
      origin.kind === "migration" ? origin.provenanceId : null,
    systemPolicyId: origin.kind === "system_policy" ? origin.policyId : null
  };
}

function membershipOriginPredicate(
  origin: InboxV2ParticipantMembershipOrigin
): SQL {
  if (origin.kind === "hulee_internal_command") {
    return sql`origin_kind = 'hulee_internal_command'
      and origin_migration_provenance_id is null
      and origin_system_policy_id is null`;
  }
  if (origin.kind === "migration") {
    return sql`origin_kind = 'migration'
      and origin_migration_provenance_id = ${origin.provenanceId}
      and origin_system_policy_id is null`;
  }
  if (origin.kind === "system_policy") {
    return sql`origin_kind = 'system_policy'
      and origin_migration_provenance_id is null
      and origin_system_policy_id = ${origin.policyId}`;
  }
  throw new CoreError(
    "validation.failed",
    "Provider roster origin is not available in the foundation repository."
  );
}

function membershipCauseColumns(
  cause: InboxV2ParticipantMembershipTransition["cause"]
): Readonly<{
  actorEmployeeId: InboxV2EmployeeId | null;
  trustedServiceId: string | null;
  migrationProvenanceId: string | null;
  systemPolicyId: string | null;
}> {
  switch (cause.kind) {
    case "hulee_internal_command":
      return {
        actorEmployeeId: cause.actorEmployee.id,
        trustedServiceId: null,
        migrationProvenanceId: null,
        systemPolicyId: null
      };
    case "migration":
      return {
        actorEmployeeId: null,
        trustedServiceId: cause.trustedServiceId,
        migrationProvenanceId: cause.provenanceId,
        systemPolicyId: null
      };
    case "system_policy":
      return {
        actorEmployeeId: null,
        trustedServiceId: cause.trustedServiceId,
        migrationProvenanceId: null,
        systemPolicyId: cause.policyId
      };
    case "provider_roster":
      throw new CoreError(
        "validation.failed",
        "Provider roster cause is not available in the foundation repository."
      );
  }
}

function membershipCauseMatchesOrigin(
  origin: InboxV2ParticipantMembershipOrigin,
  cause: InboxV2ParticipantMembershipTransition["cause"]
): boolean {
  if (origin.kind !== cause.kind) return false;
  if (origin.kind === "migration" && cause.kind === "migration") {
    return origin.provenanceId === cause.provenanceId;
  }
  if (origin.kind === "system_policy" && cause.kind === "system_policy") {
    return origin.policyId === cause.policyId;
  }
  return origin.kind === "hulee_internal_command";
}

function hasSameParticipantIdentity(
  left: InboxV2ConversationParticipant,
  right: InboxV2ConversationParticipant
): boolean {
  return (
    left.conversation.id === right.conversation.id &&
    participantSubjectKey(left.subject) === participantSubjectKey(right.subject)
  );
}

function participantSubjectKey(
  subject: InboxV2ConversationParticipantSubject
): string {
  switch (subject.kind) {
    case "employee":
      return `employee\u0000${subject.employee.id}`;
    case "source_external_identity":
      return `source_external_identity\u0000${subject.sourceExternalIdentity.id}`;
    case "client_contact":
      return `client_contact\u0000${subject.clientContact.id}`;
    case "bot":
      return `bot\u0000${subject.bot.id}`;
    case "system":
      return `system\u0000${subject.systemActorId}`;
    case "legacy_unknown":
      return `legacy_unknown\u0000${subject.provenanceCodeId}`;
  }
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

function incrementEntityRevision(
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

function parseDatabaseCounter(
  value: unknown,
  label: string
): InboxV2BigintCounter {
  if (typeof value === "number") {
    throw invariantError(`${label} was decoded as a lossy JavaScript number.`);
  }
  return inboxV2BigintCounterSchema.parse(String(value));
}

function parseDatabaseEntityRevision(
  value: unknown,
  label: string
): InboxV2EntityRevision {
  if (typeof value === "number") {
    throw invariantError(`${label} was decoded as a lossy JavaScript number.`);
  }
  return inboxV2EntityRevisionSchema.parse(String(value));
}

function parseDatabaseTimestamp(value: unknown, label: string): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw invariantError(`${label} is not a PostgreSQL timestamp.`);
  }
  return date.toISOString();
}

function assertStrictInput(
  input: unknown,
  allowedKeys: ReadonlySet<string>,
  label: string
): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CoreError(
      "validation.failed",
      `${label} input must be an object.`
    );
  }
  const unexpected = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new CoreError(
      "validation.failed",
      `${label} input contains unsupported fields: ${unexpected.join(", ")}.`
    );
  }
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
