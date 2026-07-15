import type {
  InboxV2BigintCounter,
  InboxV2ConversationId,
  InboxV2ConversationParticipantId,
  InboxV2ParticipantMembershipEpisode,
  InboxV2ParticipantMembershipTransition
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

export type InboxV2ProviderMembershipMutationAnchor = Readonly<{
  evidenceKind: "member" | "roster_omission";
  rosterEvidenceId: string;
  memberEvidenceId: string | null;
  sourceThreadBindingId: string;
  sourceExternalIdentityId: string;
  ordering: Readonly<{
    kind: string;
    scopeToken: string;
    comparatorId: string;
    comparatorRevision: bigint;
    position: bigint;
  }>;
}>;

export type ApplyInboxV2ParticipantMembershipMutationInput = Readonly<{
  operation: "start" | "transition";
  conversationId: InboxV2ConversationId;
  participantId: InboxV2ConversationParticipantId;
  expectedMembershipRevision: InboxV2BigintCounter;
  resultingMembershipRevision: InboxV2BigintCounter;
  episode: InboxV2ParticipantMembershipEpisode;
  transition: InboxV2ParticipantMembershipTransition;
  provider: InboxV2ProviderMembershipMutationAnchor | null;
}>;

export type InboxV2MembershipMutationEntrypointRow = Readonly<{
  resulting_membership_revision: unknown;
}>;

/**
 * Calls the only database entrypoint allowed to mutate the four ADR 0010
 * revision-owned membership tables. The payload is intentionally closed and
 * versioned; the SECURITY DEFINER function rejects missing or extra fields.
 */
export function buildApplyInboxV2ParticipantMembershipMutationSql(
  input: ApplyInboxV2ParticipantMembershipMutationInput
): SQL {
  const payload = buildMutationPayload(input);

  return sql`
    select public.inbox_v2_apply_participant_membership_mutation_v1(
      ${JSON.stringify(payload)}::jsonb
    ) as resulting_membership_revision
  `;
}

function buildMutationPayload(
  input: ApplyInboxV2ParticipantMembershipMutationInput
): Record<string, string | number | null> {
  const origin = originColumns(input);
  const cause = causeColumns(input);
  const episodeExpectedRevision =
    input.operation === "transition" ? input.transition.currentRevision : null;

  return {
    version: 1,
    operation: input.operation,
    tenantId: input.episode.tenantId,
    conversationId: input.conversationId,
    participantId: input.participantId,
    episodeId: input.episode.id,
    transitionId: input.transition.id,
    expectedMembershipRevision: input.expectedMembershipRevision,
    resultingMembershipRevision: input.resultingMembershipRevision,
    occurredAt: input.transition.occurredAt,
    originKind: input.episode.origin.kind,
    targetState: input.episode.state,
    episodeOriginProviderRosterMemberEvidenceId:
      origin.providerRosterMemberEvidenceId,
    episodeOriginProviderRosterEvidenceId: origin.providerRosterEvidenceId,
    episodeOriginSourceThreadBindingId: origin.sourceThreadBindingId,
    episodeOriginSourceExternalIdentityId: origin.sourceExternalIdentityId,
    episodeOriginOrderingKind: origin.orderingKind,
    episodeOriginOrderingScopeToken: origin.orderingScopeToken,
    episodeOriginOrderingComparatorId: origin.orderingComparatorId,
    episodeOriginOrderingComparatorRevision: origin.orderingComparatorRevision,
    episodeOriginOrderingPosition: origin.orderingPosition,
    episodeProviderOrderingHeadPosition: origin.providerOrderingHeadPosition,
    episodeOriginMigrationProvenanceId: origin.migrationProvenanceId,
    episodeOriginSystemPolicyId: origin.systemPolicyId,
    episodeState: input.episode.state,
    episodeRole: input.episode.role,
    episodeEvidenceClassification: input.episode.evidenceClassification,
    episodeValidFrom: input.episode.validFrom,
    episodeValidTo: input.episode.validTo,
    episodeExpectedRevision,
    episodeResultingRevision: input.episode.revision,
    transitionIntent: input.transition.intent,
    transitionFromState: input.transition.fromState,
    transitionToState: input.transition.toState,
    transitionFromRole: input.transition.fromRole,
    transitionToRole: input.transition.toRole,
    transitionCauseKind: input.transition.cause.kind,
    transitionCauseProviderEvidenceKind: cause.providerEvidenceKind,
    transitionCauseProviderRosterMemberEvidenceId:
      cause.providerRosterMemberEvidenceId,
    transitionCauseProviderRosterEvidenceId: cause.providerRosterEvidenceId,
    transitionCauseSourceThreadBindingId: cause.sourceThreadBindingId,
    transitionCauseSourceExternalIdentityId: cause.sourceExternalIdentityId,
    transitionCauseOrderingKind: cause.orderingKind,
    transitionCauseOrderingScopeToken: cause.orderingScopeToken,
    transitionCauseOrderingComparatorId: cause.orderingComparatorId,
    transitionCauseOrderingComparatorRevision: cause.orderingComparatorRevision,
    transitionCauseOrderingPosition: cause.orderingPosition,
    transitionCauseActorEmployeeId: cause.actorEmployeeId,
    transitionCauseTrustedServiceId: cause.trustedServiceId,
    transitionCauseMigrationProvenanceId: cause.migrationProvenanceId,
    transitionCauseSystemPolicyId: cause.systemPolicyId,
    transitionReasonCodeId: input.transition.reasonCodeId,
    transitionExpectedRevision: input.transition.expectedRevision,
    transitionCurrentRevision: input.transition.currentRevision,
    transitionResultingRevision: input.transition.resultingRevision
  };
}

function originColumns(input: ApplyInboxV2ParticipantMembershipMutationInput) {
  const { episode, provider } = input;
  if (episode.origin.kind === "provider_roster") {
    if (provider === null) {
      throw new Error("Provider membership mutation anchor is required.");
    }
    return {
      providerRosterMemberEvidenceId: provider.memberEvidenceId,
      providerRosterEvidenceId: provider.rosterEvidenceId,
      sourceThreadBindingId: provider.sourceThreadBindingId,
      sourceExternalIdentityId: provider.sourceExternalIdentityId,
      orderingKind: provider.ordering.kind,
      orderingScopeToken: provider.ordering.scopeToken,
      orderingComparatorId: provider.ordering.comparatorId,
      orderingComparatorRevision: String(provider.ordering.comparatorRevision),
      orderingPosition: String(provider.ordering.position),
      providerOrderingHeadPosition: String(provider.ordering.position),
      migrationProvenanceId: null,
      systemPolicyId: null
    };
  }
  if (provider !== null) {
    throw new Error(
      "Provider anchor is forbidden for non-provider membership."
    );
  }
  return {
    providerRosterMemberEvidenceId: null,
    providerRosterEvidenceId: null,
    sourceThreadBindingId: null,
    sourceExternalIdentityId: null,
    orderingKind: null,
    orderingScopeToken: null,
    orderingComparatorId: null,
    orderingComparatorRevision: null,
    orderingPosition: null,
    providerOrderingHeadPosition: null,
    migrationProvenanceId:
      episode.origin.kind === "migration" ? episode.origin.provenanceId : null,
    systemPolicyId:
      episode.origin.kind === "system_policy" ? episode.origin.policyId : null
  };
}

function causeColumns(input: ApplyInboxV2ParticipantMembershipMutationInput) {
  const { cause } = input.transition;
  if (cause.kind === "provider_roster") {
    const provider = input.provider;
    if (provider === null) {
      throw new Error("Provider membership mutation anchor is required.");
    }
    return {
      providerEvidenceKind: provider.evidenceKind,
      providerRosterMemberEvidenceId: provider.memberEvidenceId,
      providerRosterEvidenceId: provider.rosterEvidenceId,
      sourceThreadBindingId: provider.sourceThreadBindingId,
      sourceExternalIdentityId: provider.sourceExternalIdentityId,
      orderingKind: provider.ordering.kind,
      orderingScopeToken: provider.ordering.scopeToken,
      orderingComparatorId: provider.ordering.comparatorId,
      orderingComparatorRevision: String(provider.ordering.comparatorRevision),
      orderingPosition: String(provider.ordering.position),
      actorEmployeeId: null,
      trustedServiceId: null,
      migrationProvenanceId: null,
      systemPolicyId: null
    };
  }
  return {
    providerEvidenceKind: null,
    providerRosterMemberEvidenceId: null,
    providerRosterEvidenceId: null,
    sourceThreadBindingId: null,
    sourceExternalIdentityId: null,
    orderingKind: null,
    orderingScopeToken: null,
    orderingComparatorId: null,
    orderingComparatorRevision: null,
    orderingPosition: null,
    actorEmployeeId:
      cause.kind === "hulee_internal_command" ? cause.actorEmployee.id : null,
    trustedServiceId:
      cause.kind === "migration" || cause.kind === "system_policy"
        ? cause.trustedServiceId
        : null,
    migrationProvenanceId:
      cause.kind === "migration" ? cause.provenanceId : null,
    systemPolicyId: cause.kind === "system_policy" ? cause.policyId : null
  };
}
