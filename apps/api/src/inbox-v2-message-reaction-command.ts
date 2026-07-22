import {
  calculateInboxV2CanonicalSha256,
  INBOX_V2_MESSAGE_REACTION_COMMIT_SCHEMA_ID,
  INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizedCommandSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageReactionCommitSchema,
  inboxV2MessageReactionIdSchema,
  inboxV2MessageReactionTransitionIdSchema,
  inboxV2OutboundRoutePrincipalSchema,
  inboxV2ReactionValueSchema,
  inboxV2TenantIdSchema,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2AuthorizedCommand,
  type InboxV2MessageReaction,
  type InboxV2OutboundRoutePrincipal,
  type InboxV2TimelineCommandIntent
} from "@hulee/contracts";
import {
  CoreError,
  executeInboxV2AuthorizationGate,
  type InboxV2AuthorizationPlanInput,
  type InboxV2SecurityDenialContext,
  type InboxV2SecurityDenialSink
} from "@hulee/core";
import {
  deriveInboxV2MessageReactionAuditTargetReference,
  type InboxV2AuthorizedCommandMutationResult,
  type InboxV2PrivilegedAuthorizationMutationReplayStatus,
  type WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";

type ReactionCommit = ReturnType<
  typeof inboxV2MessageReactionCommitSchema.parse
>;
type ReactionIntent = Extract<
  InboxV2TimelineCommandIntent,
  { kind: "reaction_set" | "reaction_replace" | "reaction_clear" }
>;

export const INBOX_V2_MESSAGE_REACTION_RESULT_CODE =
  "core:message.reaction.accepted" as const;

export type InboxV2MessageReactionRequestScope = Readonly<{
  tenantId: string;
  principal: InboxV2OutboundRoutePrincipal;
  authorizationEpoch: string;
}>;

/**
 * Public reaction input deliberately excludes actor, provider account, route,
 * binding, occurrence, capability and authorization evidence. Those values
 * are loaded and stamped by the trusted preparer.
 */
export type InboxV2MessageReactionCommand =
  | Readonly<{
      kind: "set";
      tenantId: string;
      conversationId: string;
      messageId: string;
      expectedMessageRevision: string;
      value: ReactionIntent extends infer _T
        ? Extract<ReactionIntent, { kind: "reaction_set" }>["value"]
        : never;
      clientMutationId: string;
    }>
  | Readonly<{
      kind: "replace";
      tenantId: string;
      conversationId: string;
      messageId: string;
      reactionId: string;
      expectedReactionRevision: string;
      value: Extract<ReactionIntent, { kind: "reaction_replace" }>["value"];
      clientMutationId: string;
    }>
  | Readonly<{
      kind: "clear";
      tenantId: string;
      conversationId: string;
      messageId: string;
      reactionId: string;
      expectedReactionRevision: string;
      clientMutationId: string;
    }>;

export type InboxV2MessageReactionIdempotencyScope = Readonly<{
  tenantId: string;
  principal: InboxV2OutboundRoutePrincipal;
  authorizationEpoch: string;
  commandTypeId:
    | "core:message.reaction.set"
    | "core:message.reaction.replace"
    | "core:message.reaction.clear";
  clientMutationId: string;
  publicResultCode: typeof INBOX_V2_MESSAGE_REACTION_RESULT_CODE;
}>;

export type InboxV2PreparedMessageReactionCommand =
  | Readonly<{
      /** Idempotency lookup must happen before mutable Message/route reads. */
      kind: "committed_replay";
      requestHash: string;
      scope: InboxV2MessageReactionIdempotencyScope;
      status: InboxV2PrivilegedAuthorizationMutationReplayStatus;
    }>
  | Readonly<{
      kind: "idempotency_conflict";
      scope: InboxV2MessageReactionIdempotencyScope;
    }>
  | Readonly<{
      kind: "revision_conflict";
      requestHash: string;
      scope: InboxV2MessageReactionIdempotencyScope;
      disclosureAuthorizationPlan: InboxV2AuthorizationPlanInput;
      denialContext: InboxV2SecurityDenialContext;
    }>
  | Readonly<{
      kind: "selected";
      authorizationPlan: InboxV2AuthorizationPlanInput;
      denialContext: InboxV2SecurityDenialContext;
      authorizedCommand: InboxV2AuthorizedCommand;
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      reactionCommit: ReactionCommit;
    }>;

export type InboxV2MessageReactionCommandPreparer = Readonly<{
  lookupIdempotency(
    command: InboxV2MessageReactionCommand
  ): Promise<Extract<
    InboxV2PreparedMessageReactionCommand,
    { kind: "committed_replay" | "idempotency_conflict" }
  > | null>;
  /**
   * Loads the current Message/Timeline/reaction slot, participant and exact
   * provider authority. No provider-facing fact may be copied from the body.
   */
  prepareNew(
    command: InboxV2MessageReactionCommand
  ): Promise<Extract<
    InboxV2PreparedMessageReactionCommand,
    { kind: "revision_conflict" | "selected" }
  > | null>;
}>;

export type InboxV2MessageReactionAtomicResult = Readonly<{
  reactionId: string;
  reactionRevision: string;
  transitionId: string;
}>;

export type InboxV2MessageReactionAtomicCoordinator = Readonly<{
  withAuthorizedMessageReactionMutation(
    input: Readonly<{
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      reactionCommit: ReactionCommit;
    }>
  ): Promise<
    InboxV2AuthorizedCommandMutationResult<InboxV2MessageReactionAtomicResult>
  >;
}>;

type ReactionAtomicFailure = Exclude<
  InboxV2AuthorizedCommandMutationResult<InboxV2MessageReactionAtomicResult>,
  { kind: "applied" | "already_applied" }
>;

export type InboxV2MessageReactionCommandResult =
  | Readonly<{
      outcome: "applied" | "pending_external";
      reaction: InboxV2MessageReaction;
      transitionId: string;
      commit: Extract<
        InboxV2AuthorizedCommandMutationResult<InboxV2MessageReactionAtomicResult>,
        { kind: "applied" }
      >["status"];
    }>
  | Readonly<{
      outcome: "already_applied";
      action: InboxV2MessageReactionCommand["kind"];
      transitionId: string;
      commit: InboxV2PrivilegedAuthorizationMutationReplayStatus;
    }>
  | Readonly<{ outcome: "idempotency_conflict" }>
  | Readonly<{ outcome: "revision_conflict" }>
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{ outcome: "denied"; errorCode: string }>
  | Readonly<{
      outcome: "authorization_conflict";
      conflict: ReactionAtomicFailure;
    }>;

export type InboxV2MessageReactionCommandServiceOptions = Readonly<{
  requestScope: InboxV2MessageReactionRequestScope;
  preparer: InboxV2MessageReactionCommandPreparer;
  denialSink: InboxV2SecurityDenialSink;
  coordinator: InboxV2MessageReactionAtomicCoordinator;
  /** Test seam; production always uses the core authorization gate. */
  authorizationGate?: typeof executeInboxV2AuthorizationGate;
}>;

export type InboxV2MessageReactionCommandService = Readonly<{
  execute(
    command: InboxV2MessageReactionCommand
  ): Promise<InboxV2MessageReactionCommandResult>;
}>;

export function createInboxV2MessageReactionCommandService(
  options: InboxV2MessageReactionCommandServiceOptions
): InboxV2MessageReactionCommandService {
  const requestScope = normalizeRequestScope(options.requestScope);
  const authorizationGate =
    options.authorizationGate ?? executeInboxV2AuthorizationGate;

  return Object.freeze({
    async execute(commandInput) {
      const command = normalizeCommand(commandInput);
      if (command.tenantId !== requestScope.tenantId) deny();

      const replay = await options.preparer.lookupIdempotency(command);
      if (replay?.kind === "committed_replay") {
        assertReplayClosure(command, requestScope, replay);
        return {
          outcome: "already_applied",
          action: command.kind,
          transitionId: replayedTransitionId(replay.status, command.tenantId),
          commit: replay.status
        };
      }
      if (replay?.kind === "idempotency_conflict") {
        if (!idempotencyScopeMatches(command, requestScope, replay.scope)) {
          deny();
        }
        return { outcome: "idempotency_conflict" };
      }

      const prepared = await options.preparer.prepareNew(command);
      if (prepared === null) return { outcome: "not_found" };
      if (prepared.kind === "revision_conflict") {
        if (
          prepared.requestHash !==
            calculateInboxV2MessageReactionIntentDigest(command) ||
          !idempotencyScopeMatches(command, requestScope, prepared.scope) ||
          !disclosureAuthorizationMatches(
            prepared.disclosureAuthorizationPlan,
            requestScope,
            command
          )
        ) {
          deny();
        }
        const disclosure = await authorizationGate({
          authorizationPlan: prepared.disclosureAuthorizationPlan,
          denialContext: prepared.denialContext,
          denialSink: options.denialSink,
          executeAllowed: async () => true
        });
        return disclosure.outcome === "denied"
          ? {
              outcome: "denied",
              errorCode: disclosure.publicDecision.errorCode
            }
          : { outcome: "revision_conflict" };
      }

      const commit = assertSelectedClosure(command, requestScope, prepared);
      const coordinated = await authorizationGate({
        authorizationPlan: prepared.authorizationPlan,
        denialContext: prepared.denialContext,
        denialSink: options.denialSink,
        executeAllowed: () =>
          options.coordinator.withAuthorizedMessageReactionMutation({
            authorizedMutation: prepared.authorizedMutation,
            reactionCommit: commit
          })
      });
      if (coordinated.outcome === "denied") {
        return {
          outcome: "denied",
          errorCode: coordinated.publicDecision.errorCode
        };
      }
      if (coordinated.value.kind === "applied") {
        if (
          coordinated.value.result.reactionId !== commit.afterReaction.id ||
          coordinated.value.result.reactionRevision !==
            commit.afterReaction.revision ||
          coordinated.value.result.transitionId !== commit.transition.id ||
          !coordinatedStatusMatchesCommit(coordinated.value.status, commit) ||
          coordinated.value.status.sensitiveResultReference !== null
        ) {
          deny();
        }
        return {
          outcome:
            commit.afterReaction.state.kind === "pending_external"
              ? "pending_external"
              : "applied",
          reaction: commit.afterReaction,
          transitionId: commit.transition.id,
          commit: coordinated.value.status
        };
      }
      if (coordinated.value.kind === "already_applied") {
        const replayedTransition = replayedTransitionId(
          coordinated.value.status,
          command.tenantId
        );
        if (
          coordinated.value.status.publicResultCode !==
          INBOX_V2_MESSAGE_REACTION_RESULT_CODE
        ) {
          deny();
        }
        return {
          outcome: "already_applied",
          action: command.kind,
          transitionId: replayedTransition,
          commit: coordinated.value.status
        };
      }
      if (coordinated.value.kind === "idempotency_conflict") {
        return { outcome: "idempotency_conflict" };
      }
      if (
        coordinated.value.kind === "resource_not_found" ||
        coordinated.value.kind === "revision_conflict"
      ) {
        return { outcome: "revision_conflict" };
      }
      return {
        outcome: "authorization_conflict",
        conflict: coordinated.value
      };
    }
  });
}

export function calculateInboxV2MessageReactionIntentDigest(
  commandInput: InboxV2MessageReactionCommand
): string {
  const command = normalizeCommand(commandInput);
  return calculateInboxV2CanonicalSha256({
    protocol: "core:inbox-v2.message-reaction-command@v1",
    command
  });
}

function assertSelectedClosure(
  command: InboxV2MessageReactionCommand,
  scope: InboxV2MessageReactionRequestScope,
  prepared: Extract<InboxV2PreparedMessageReactionCommand, { kind: "selected" }>
): ReactionCommit {
  const requestHash = calculateInboxV2MessageReactionIntentDigest(command);
  const authorized = inboxV2AuthorizedCommandSchema.parse(
    prepared.authorizedCommand
  );
  const commit = inboxV2MessageReactionCommitSchema.parse(
    prepared.reactionCommit
  );
  const intent = authorized.intent.payload;
  if (
    !isReactionIntent(intent) ||
    !authorizedCommandMatches(
      command,
      scope,
      requestHash,
      authorized,
      intent
    ) ||
    !reactionCommitMatchesIntent(command, intent, commit) ||
    !authorizationClosureMatches(
      prepared.authorizationPlan,
      authorized,
      prepared.authorizedMutation,
      scope,
      commit
    ) ||
    !authorizedMutationMatches(
      command,
      scope,
      requestHash,
      authorized,
      prepared.authorizedMutation,
      commit
    )
  ) {
    deny();
  }
  return commit;
}

function authorizedCommandMatches(
  command: InboxV2MessageReactionCommand,
  scope: InboxV2MessageReactionRequestScope,
  requestHash: string,
  authorized: InboxV2AuthorizedCommand,
  intent: ReactionIntent
): boolean {
  if (
    authorized.tenantId !== command.tenantId ||
    authorized.request.tenantId !== command.tenantId ||
    authorized.request.commandTypeId !== "core:timeline.command" ||
    authorized.request.clientMutationId !== command.clientMutationId ||
    authorized.request.requestHash !== requestHash ||
    !authorizedPrincipalMatchesScope(authorized, scope) ||
    intent.tenantId !== command.tenantId ||
    intent.conversation.id !== command.conversationId ||
    intent.appActor.kind !== scope.principal.kind ||
    !appActorMatchesScope(intent.appActor, scope)
  ) {
    return false;
  }
  const proof = intent.targetProof;
  if (
    proof === undefined ||
    proof.conversation.id !== command.conversationId ||
    proof.message.id !== command.messageId ||
    proof.timelineItem.id.length === 0 ||
    proof.ownerParticipant.id !== intent.actionParticipant.id
  ) {
    return false;
  }
  if (command.kind === "set") {
    return (
      intent.kind === "reaction_set" &&
      intent.message.id === command.messageId &&
      intent.expectedMessageRevision === command.expectedMessageRevision &&
      sameValue(intent.value, command.value)
    );
  }
  if (command.kind === "replace") {
    return (
      intent.kind === "reaction_replace" &&
      intent.reaction.id === command.reactionId &&
      intent.expectedReactionRevision === command.expectedReactionRevision &&
      intent.targetProof !== undefined &&
      intent.targetProof.reaction.id === command.reactionId &&
      sameValue(intent.value, command.value)
    );
  }
  return (
    intent.kind === "reaction_clear" &&
    intent.reaction.id === command.reactionId &&
    intent.expectedReactionRevision === command.expectedReactionRevision &&
    intent.targetProof !== undefined &&
    intent.targetProof.reaction.id === command.reactionId &&
    intent.value === null
  );
}

function reactionCommitMatchesIntent(
  command: InboxV2MessageReactionCommand,
  intent: ReactionIntent,
  commit: ReactionCommit
): boolean {
  const transition = commit.transition;
  const reaction = commit.afterReaction;
  const targetProof = intent.targetProof;
  const actionParticipant = transition.actionAttribution.actionParticipant;
  if (
    commit.tenantId !== command.tenantId ||
    commit.beforeMessage.id !== command.messageId ||
    commit.beforeMessage.conversation.id !== command.conversationId ||
    commit.beforeTimelineItem.id !== commit.beforeMessage.timelineItem.id ||
    commit.beforeTimelineItem.conversation.id !== command.conversationId ||
    targetProof === undefined ||
    targetProof.message.id !== commit.beforeMessage.id ||
    targetProof.expectedMessageRevision !== commit.beforeMessage.revision ||
    targetProof.timelineItem.id !== commit.beforeTimelineItem.id ||
    targetProof.expectedTimelineItemRevision !==
      commit.beforeTimelineItem.revision ||
    transition.operation !== command.kind ||
    transition.actionAttribution.appActor === null ||
    !sameValue(transition.actionAttribution.appActor, intent.appActor) ||
    actionParticipant === null ||
    actionParticipant.id !== intent.actionParticipant.id ||
    reaction.actor.kind !== "participant" ||
    reaction.actor.participant.id !== intent.actionParticipant.id ||
    reaction.message.id !== command.messageId
  ) {
    return false;
  }
  if (command.kind === "set") {
    if (
      commit.beforeMessage.revision !== command.expectedMessageRevision ||
      transition.operation !== "set" ||
      reactionValueOfState(reaction.state) === null ||
      !sameValue(reactionValueOfState(reaction.state), command.value)
    ) {
      return false;
    }
  } else if (
    commit.beforeReaction === null ||
    commit.beforeReaction.id !== command.reactionId ||
    commit.beforeReaction.revision !== command.expectedReactionRevision ||
    reaction.id !== command.reactionId ||
    (command.kind === "replace" &&
      !sameValue(reactionValueOfState(reaction.state), command.value))
  ) {
    return false;
  }

  if (intent.target.kind === "internal") {
    return (
      transition.mode === "internal_apply" &&
      reaction.capability.kind === "internal" &&
      transition.externalAuthority === null &&
      commit.externalAuthorityEvidence === null &&
      commit.outboundBindingSnapshot === null &&
      commit.routeConsumption === null
    );
  }
  const authority = transition.externalAuthority;
  const evidence = commit.externalAuthorityEvidence;
  const route = evidence?.outboundRoute ?? null;
  return (
    transition.mode === "external_request" &&
    reaction.capability.kind === "external" &&
    reaction.state.kind === "pending_external" &&
    authority !== null &&
    authority.outboundRoute !== null &&
    evidence !== null &&
    route !== null &&
    commit.outboundBindingSnapshot !== null &&
    commit.routeConsumption !== null &&
    intent.target.externalMessageReference.id ===
      authority.externalMessageReference.id &&
    intent.target.sourceOccurrence.id === authority.sourceOccurrence.id &&
    intent.target.outboundRoute.id === authority.outboundRoute.id &&
    route.id === authority.outboundRoute.id &&
    route.sourceAccount.id === authority.sourceAccount.id &&
    route.sourceThreadBinding.id === authority.sourceThreadBinding.id &&
    route.bindingFence.bindingGeneration === authority.bindingGeneration &&
    route.selection.intent.kind === "explicit_occurrence" &&
    route.selection.reason === "explicit_occurrence"
  );
}

function authorizationClosureMatches(
  plan: InboxV2AuthorizationPlanInput,
  authorized: InboxV2AuthorizedCommand,
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  scope: InboxV2MessageReactionRequestScope,
  commit: ReactionCommit
): boolean {
  const intent = authorized.intent.payload;
  if (!isReactionIntent(intent)) return false;
  const decisions = authorized.authorizationDecisionRefs;
  const requirements = plan.requirements;
  const auditDecisions = mutation.records.audit.authorizationDecisionRefs.map(
    (decision) => inboxV2AuthorizationDecisionReferenceSchema.parse(decision)
  );
  const expectedReadPermission =
    intent.target.kind === "internal"
      ? "core:conversation.internal.read"
      : "core:conversation.read";
  const reactionDecisions = decisions.filter(
    (decision) =>
      decision.permissionId === "core:message.react" &&
      String(decision.resource.entityId) ===
        String(commit.beforeTimelineItem.id)
  );
  const readDecisions = decisions.filter(
    (decision) =>
      decision.permissionId === expectedReadPermission &&
      String(decision.resource.entityId) === String(intent.conversation.id)
  );
  const sourceAccountId =
    commit.transition.externalAuthority?.sourceAccount.id ?? null;
  const sourceDecisions = decisions.filter(
    (decision) =>
      decision.permissionId === "core:source_account.use" &&
      sourceAccountId !== null &&
      String(decision.resource.entityId) === String(sourceAccountId)
  );
  return (
    plan.tenantId === authorized.tenantId &&
    plan.currentAuthorization.tenantId === authorized.tenantId &&
    plan.currentAuthorization.authorizationEpoch === scope.authorizationEpoch &&
    authorizationPlanPrincipalMatchesScope(plan, scope) &&
    reactionDecisions.length === 1 &&
    readDecisions.length === 1 &&
    sourceDecisions.length === (intent.target.kind === "external" ? 1 : 0) &&
    authorizationRequirementDecisionMultisetMatches(requirements, decisions) &&
    sameDecisionMultiset(decisions, auditDecisions) &&
    mutation.command.authorizationDecisionId === reactionDecisions[0]?.id
  );
}

function authorizedMutationMatches(
  command: InboxV2MessageReactionCommand,
  scope: InboxV2MessageReactionRequestScope,
  requestHash: string,
  authorized: InboxV2AuthorizedCommand,
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  commit: ReactionCommit
): boolean {
  const resultReference = mutation.command.resultReference;
  const auditTarget = mutation.records.audit.target;
  const expectedAuditTarget = deriveInboxV2MessageReactionAuditTargetReference({
    tenantId: commit.tenantId,
    timelineItemId: commit.beforeTimelineItem.id
  });
  const transitionReference = {
    tenantId: commit.tenantId,
    recordId: commit.transition.id,
    schemaId: INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256(commit.transition)
  } as const;
  const domainCommitReference = {
    tenantId: commit.tenantId,
    recordId: commit.transition.id,
    schemaId: INBOX_V2_MESSAGE_REACTION_COMMIT_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256(commit)
  } as const;
  const reactionChanges = mutation.records.changes.filter(
    (change) =>
      change.entity.tenantId === command.tenantId &&
      String(change.entity.entityTypeId) ===
        "core:message-reaction-transition" &&
      String(change.entity.entityId) === commit.transition.id
  );
  const providerOutbox = mutation.records.outboxIntents.filter(
    (intent) => intent.effectClass === "provider_io"
  );
  const projectionOutbox = mutation.records.outboxIntents.filter(
    (intent) =>
      intent.effectClass === "projection" &&
      intent.typeId === "core:projection.update"
  );
  const expectsProvider = commit.transition.mode === "external_request";
  const change = reactionChanges[0];
  const event = mutation.records.events[0];
  const projection = projectionOutbox[0];
  const providerIntent = providerOutbox[0];
  return (
    mutation.tenantId === command.tenantId &&
    mutation.command.commandTypeId === reactionCommandTypeId(command) &&
    mutation.command.clientMutationId === command.clientMutationId &&
    mutation.command.requestHash === requestHash &&
    mutation.command.authorizationEpoch === scope.authorizationEpoch &&
    mutation.command.authorizedAt === authorized.authorizedAt &&
    mutation.command.publicResultCode ===
      INBOX_V2_MESSAGE_REACTION_RESULT_CODE &&
    mutation.command.sensitiveResultReference === null &&
    mutationActorMatchesScope(mutation.command.actor, scope) &&
    samePayloadReference(resultReference, transitionReference) &&
    mutation.records.audit.actionId === reactionCommandTypeId(command) &&
    sameEntity(auditTarget, expectedAuditTarget) &&
    reactionChanges.length === 1 &&
    mutation.records.changes.length === 1 &&
    change !== undefined &&
    change.resultingRevision === commit.transition.recordRevision &&
    change.timeline !== null &&
    change.timeline.conversation.tenantId === command.tenantId &&
    String(change.timeline.conversation.id) === command.conversationId &&
    change.timeline.timelineSequence ===
      commit.beforeTimelineItem.timelineSequence &&
    change.audience === commit.beforeTimelineItem.visibility &&
    change.state.kind === "upsert" &&
    change.state.stateSchemaId ===
      INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID &&
    change.state.stateSchemaVersion ===
      INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION &&
    change.state.stateHash === transitionReference.digest &&
    samePayloadReference(change.state.payloadReference, transitionReference) &&
    samePayloadReference(
      change.state.domainCommitReference,
      domainCommitReference
    ) &&
    mutation.records.events.length === 1 &&
    event !== undefined &&
    event.typeId === "core:message.changed" &&
    event.payloadSchemaId === INBOX_V2_MESSAGE_REACTION_COMMIT_SCHEMA_ID &&
    event.payloadSchemaVersion === INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION &&
    event.changeIds.length === 1 &&
    String(event.changeIds[0]) === String(change.id) &&
    event.subjects.length === 1 &&
    event.subjects[0]?.tenantId === command.tenantId &&
    event.subjects[0]?.entityTypeId === "core:message" &&
    String(event.subjects[0]?.entityId) === command.messageId &&
    samePayloadReference(event.payloadReference, domainCommitReference) &&
    event.occurredAt === commit.transition.occurredAt &&
    event.recordedAt === commit.transition.recordedAt &&
    sameDecisionMultiset(
      authorized.authorizationDecisionRefs,
      event.authorizationDecisionRefs
    ) &&
    projectionOutbox.length === 1 &&
    projection !== undefined &&
    String(projection.eventId) === String(event.id) &&
    projection.changeIds.length === 1 &&
    String(projection.changeIds[0]) === String(change.id) &&
    samePayloadReference(projection.payloadReference, transitionReference) &&
    providerOutbox.length === (expectsProvider ? 1 : 0) &&
    mutation.records.outboxIntents.length === (expectsProvider ? 2 : 1) &&
    (!expectsProvider ||
      (providerIntent?.typeId === "core:provider.message_reaction" &&
        String(providerIntent.eventId) === String(event.id) &&
        providerIntent.changeIds.length === 1 &&
        String(providerIntent.changeIds[0]) === String(change.id) &&
        samePayloadReference(
          providerIntent.payloadReference,
          transitionReference
        )))
  );
}

function samePayloadReference(
  left: Readonly<{
    tenantId: string;
    recordId: unknown;
    schemaId: unknown;
    schemaVersion: string;
    digest: string;
  }> | null,
  right: Readonly<{
    tenantId: string;
    recordId: unknown;
    schemaId: unknown;
    schemaVersion: string;
    digest: string;
  }>
): boolean {
  return left !== null && sameValue(left, right);
}

function disclosureAuthorizationMatches(
  plan: InboxV2AuthorizationPlanInput,
  scope: InboxV2MessageReactionRequestScope,
  command: InboxV2MessageReactionCommand
): boolean {
  const conversationReads = plan.requirements.filter(
    (requirement) =>
      (requirement.permissionId === "core:conversation.read" ||
        requirement.permissionId === "core:conversation.internal.read") &&
      requirement.resource.tenantId === command.tenantId &&
      requirement.resource.entityTypeId === "core:conversation" &&
      String(requirement.resource.entityId) === command.conversationId
  );
  return (
    plan.tenantId === command.tenantId &&
    plan.currentAuthorization.tenantId === command.tenantId &&
    plan.currentAuthorization.authorizationEpoch === scope.authorizationEpoch &&
    authorizationPlanPrincipalMatchesScope(plan, scope) &&
    plan.requirements.length === 1 &&
    conversationReads.length === 1
  );
}

function assertReplayClosure(
  command: InboxV2MessageReactionCommand,
  scope: InboxV2MessageReactionRequestScope,
  replay: Extract<
    InboxV2PreparedMessageReactionCommand,
    { kind: "committed_replay" }
  >
): void {
  if (
    replay.requestHash !==
      calculateInboxV2MessageReactionIntentDigest(command) ||
    !idempotencyScopeMatches(command, scope, replay.scope) ||
    replay.status.publicResultCode !== INBOX_V2_MESSAGE_REACTION_RESULT_CODE
  ) {
    deny();
  }
  replayedTransitionId(replay.status, command.tenantId);
}

function idempotencyScopeMatches(
  command: InboxV2MessageReactionCommand,
  scope: InboxV2MessageReactionRequestScope,
  candidate: InboxV2MessageReactionIdempotencyScope
): boolean {
  return (
    candidate.tenantId === command.tenantId &&
    candidate.tenantId === scope.tenantId &&
    candidate.authorizationEpoch === scope.authorizationEpoch &&
    candidate.commandTypeId === reactionCommandTypeId(command) &&
    candidate.clientMutationId === command.clientMutationId &&
    candidate.publicResultCode === INBOX_V2_MESSAGE_REACTION_RESULT_CODE &&
    sameValue(candidate.principal, scope.principal)
  );
}

function replayedTransitionId(
  status: InboxV2PrivilegedAuthorizationMutationReplayStatus,
  tenantId: string
): string {
  const reference = status.resultReference;
  if (
    reference === null ||
    reference.tenantId !== tenantId ||
    reference.schemaId !== INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID ||
    reference.schemaVersion !== INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION
  ) {
    deny();
  }
  return inboxV2MessageReactionTransitionIdSchema.parse(
    String(reference.recordId)
  );
}

function coordinatedStatusMatchesCommit(
  status: InboxV2PrivilegedAuthorizationMutationReplayStatus,
  commit: ReactionCommit
): boolean {
  return (
    status.publicResultCode === INBOX_V2_MESSAGE_REACTION_RESULT_CODE &&
    samePayloadReference(status.resultReference, {
      tenantId: commit.tenantId,
      recordId: commit.transition.id,
      schemaId: INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID,
      schemaVersion: INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
      digest: calculateInboxV2CanonicalSha256(commit.transition)
    })
  );
}

function normalizeRequestScope(
  input: InboxV2MessageReactionRequestScope
): InboxV2MessageReactionRequestScope {
  if (
    typeof input !== "object" ||
    input === null ||
    !hasOnlyKeys(input, ["tenantId", "principal", "authorizationEpoch"])
  ) {
    deny();
  }
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const principal = inboxV2OutboundRoutePrincipalSchema.parse(input.principal);
  const authorizationEpoch = inboxV2AuthorizationEpochSchema.parse(
    input.authorizationEpoch
  );
  if (
    principal.kind === "employee" &&
    principal.employee.tenantId !== tenantId
  ) {
    deny();
  }
  return Object.freeze({ tenantId, principal, authorizationEpoch });
}

function normalizeCommand(
  input: InboxV2MessageReactionCommand
): InboxV2MessageReactionCommand {
  if (typeof input !== "object" || input === null || !("kind" in input)) {
    throw new CoreError(
      "validation.failed",
      "Message reaction command is invalid."
    );
  }
  const commonKeys = [
    "kind",
    "tenantId",
    "conversationId",
    "messageId",
    "clientMutationId"
  ] as const;
  const base = {
    kind: input.kind,
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    messageId: inboxV2MessageIdSchema.parse(input.messageId),
    clientMutationId: inboxV2ClientMutationIdSchema.parse(
      input.clientMutationId
    )
  } as const;
  if (
    input.kind === "set" &&
    hasOnlyKeys(input, [...commonKeys, "expectedMessageRevision", "value"])
  ) {
    return Object.freeze({
      ...base,
      kind: "set",
      expectedMessageRevision: inboxV2EntityRevisionSchema.parse(
        input.expectedMessageRevision
      ),
      value: inboxV2ReactionValueSchema.parse(input.value)
    });
  }
  if (
    (input.kind === "replace" || input.kind === "clear") &&
    hasOnlyKeys(input, [
      ...commonKeys,
      "reactionId",
      "expectedReactionRevision",
      ...(input.kind === "replace" ? ["value"] : [])
    ])
  ) {
    const mutationBase = {
      ...base,
      reactionId: inboxV2MessageReactionIdSchema.parse(input.reactionId),
      expectedReactionRevision: inboxV2EntityRevisionSchema.parse(
        input.expectedReactionRevision
      )
    } as const;
    return input.kind === "replace"
      ? Object.freeze({
          ...mutationBase,
          kind: "replace" as const,
          value: inboxV2ReactionValueSchema.parse(input.value)
        })
      : Object.freeze({ ...mutationBase, kind: "clear" as const });
  }
  throw new CoreError(
    "validation.failed",
    "Message reaction accepts only kind, tenant, conversation, message, expected revision, value and client mutation ID."
  );
}

function reactionValueOfState(
  state: InboxV2MessageReaction["state"]
): ReturnType<typeof inboxV2ReactionValueSchema.parse> | null {
  if (state.kind === "active") return state.value;
  if (state.kind === "cleared") return state.lastValue;
  return state.desired.kind === "active"
    ? state.desired.value
    : state.desired.lastValue;
}

function isReactionIntent(
  intent: InboxV2TimelineCommandIntent
): intent is ReactionIntent {
  return (
    intent.kind === "reaction_set" ||
    intent.kind === "reaction_replace" ||
    intent.kind === "reaction_clear"
  );
}

function authorizedPrincipalMatchesScope(
  authorized: InboxV2AuthorizedCommand,
  scope: InboxV2MessageReactionRequestScope
): boolean {
  return authorized.principal.kind === "employee"
    ? scope.principal.kind === "employee" &&
        authorized.principal.employee.tenantId === scope.tenantId &&
        scope.principal.employee.tenantId === scope.tenantId &&
        authorized.principal.employee.id === scope.principal.employee.id &&
        authorized.principal.authorization.value === scope.authorizationEpoch
    : scope.principal.kind === "trusted_service" &&
        authorized.principal.trustedServiceId ===
          scope.principal.trustedServiceId &&
        authorized.principal.authorizationEpoch === scope.authorizationEpoch;
}

function appActorMatchesScope(
  actor: ReactionIntent["appActor"],
  scope: InboxV2MessageReactionRequestScope
): boolean {
  return actor.kind === "employee"
    ? scope.principal.kind === "employee" &&
        actor.employee.tenantId === scope.tenantId &&
        scope.principal.employee.tenantId === scope.tenantId &&
        actor.employee.id === scope.principal.employee.id &&
        actor.authorizationEpoch === scope.authorizationEpoch
    : scope.principal.kind === "trusted_service" &&
        actor.trustedServiceId === scope.principal.trustedServiceId;
}

function authorizationPlanPrincipalMatchesScope(
  plan: InboxV2AuthorizationPlanInput,
  scope: InboxV2MessageReactionRequestScope
): boolean {
  return plan.principal.kind === "employee"
    ? scope.principal.kind === "employee" &&
        plan.principal.employee.tenantId === scope.tenantId &&
        scope.principal.employee.tenantId === scope.tenantId &&
        plan.principal.employee.id === scope.principal.employee.id &&
        plan.currentAuthorization.principal.kind === "employee" &&
        plan.currentAuthorization.principal.employeeId ===
          scope.principal.employee.id
    : scope.principal.kind === "trusted_service" &&
        plan.principal.kind === "trusted_service" &&
        plan.principal.trustedServiceId === scope.principal.trustedServiceId &&
        plan.currentAuthorization.principal.kind === "trusted_service" &&
        plan.currentAuthorization.principal.trustedServiceId ===
          scope.principal.trustedServiceId;
}

function reactionCommandTypeId(
  command: InboxV2MessageReactionCommand
): InboxV2MessageReactionIdempotencyScope["commandTypeId"] {
  return `core:message.reaction.${command.kind}`;
}

function mutationActorMatchesScope(
  actor: WithInboxV2AuthorizedCommandMutationInput["command"]["actor"],
  scope: InboxV2MessageReactionRequestScope
): boolean {
  return actor.kind === "employee"
    ? scope.principal.kind === "employee" &&
        scope.principal.employee.tenantId === scope.tenantId &&
        actor.employeeId === scope.principal.employee.id
    : scope.principal.kind === "trusted_service" &&
        actor.trustedServiceId === scope.principal.trustedServiceId;
}

function sameDecisionMultiset(
  left: readonly InboxV2AuthorizationDecisionReference[],
  right: readonly InboxV2AuthorizationDecisionReference[]
): boolean {
  return (
    left.length === right.length &&
    left.every((decision) =>
      right.some((candidate) => sameValue(candidate, decision))
    )
  );
}

function authorizationRequirementDecisionMultisetMatches(
  requirements: InboxV2AuthorizationPlanInput["requirements"],
  decisions: readonly InboxV2AuthorizationDecisionReference[]
): boolean {
  if (requirements.length !== decisions.length) return false;
  const unmatched = [...decisions];
  for (const requirement of requirements) {
    const matchingIndex = unmatched.findIndex(
      (decision) =>
        decision.permissionId === requirement.permissionId &&
        sameEntity(decision.resource, requirement.resource) &&
        decision.resourceAccessRevision === requirement.resourceAccessRevision
    );
    if (matchingIndex === -1) return false;
    unmatched.splice(matchingIndex, 1);
  }
  return unmatched.length === 0;
}

function sameEntity(
  left: Readonly<{
    tenantId: string;
    entityTypeId: string;
    entityId: unknown;
  }>,
  right: Readonly<{
    tenantId: string;
    entityTypeId: string;
    entityId: unknown;
  }>
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.entityTypeId === right.entityTypeId &&
    String(left.entityId) === String(right.entityId)
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    calculateInboxV2CanonicalSha256(left) ===
    calculateInboxV2CanonicalSha256(right)
  );
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  return (
    actual.length === allowed.size && actual.every((key) => allowed.has(key))
  );
}

function deny(): never {
  throw new CoreError("permission.denied");
}
