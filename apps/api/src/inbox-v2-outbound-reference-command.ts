import {
  calculateInboxV2ContentCopySourceDigest,
  calculateInboxV2MessageContentDigest,
  calculateInboxV2CanonicalSha256,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizedCommandSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2MessageIdSchema,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2OutboundRoutePrincipalSchema,
  inboxV2OutboundRouteResolutionCommitSchema,
  inboxV2RoutingTokenSchema,
  inboxV2SourceOccurrenceIdSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineContentDraftSchema,
  resolveInboxV2OutboundRoute,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2AuthorizedCommand,
  type InboxV2MessageCreationCommit,
  type InboxV2OutboundDispatchContentPlan,
  type InboxV2OutboundRoutePrincipal,
  type InboxV2OutboundRouteResolutionCommit,
  type InboxV2TimelineCommandIntent
} from "@hulee/contracts";
import {
  CoreError,
  executeInboxV2AuthorizationGate,
  type InboxV2AuthorizationPlanInput,
  type InboxV2SecurityDenialContext,
  type InboxV2SecurityDenialSink
} from "@hulee/core";
import type {
  InboxV2AuthorizedAtomicMaterializationCoordinator,
  InboxV2AuthorizedCommandMutationResult,
  InboxV2PrivilegedAuthorizationMutationReplayStatus,
  WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";

import {
  inboxV2OutboundDispatchContentPlanMatches,
  materializeInboxV2OutboundMessage,
  type InboxV2OutboundMessageMaterializationFingerprintAuthority,
  type InboxV2OutboundMessageMaterializationPersistence
} from "./inbox-v2-outbound-message-materialization";

export type InboxV2OutboundReferenceRouteIntent =
  | Readonly<{ kind: "automatic" }>
  | Readonly<{ kind: "explicit_binding"; bindingId: string }>
  | Readonly<{ kind: "explicit_occurrence"; occurrenceId: string }>;

export type InboxV2OutboundReferenceRequestScope = Readonly<{
  tenantId: string;
  principal: InboxV2OutboundRoutePrincipal;
}>;

export type InboxV2OutboundReferenceSource = Readonly<{
  conversationId: string;
  messageId: string;
  expectedMessageRevision: string;
}>;

type ReplyContent = Extract<
  InboxV2TimelineCommandIntent,
  { kind: "reply_external" }
>["content"];
type TimelineRouteAuthorizationProof = NonNullable<
  Extract<
    InboxV2TimelineCommandIntent,
    { kind: "reply_external" }
  >["routeAuthorization"]
>;

/**
 * Caller-visible boundary. External references, provider subjects, account,
 * binding, quoted token, capability and authorization proofs remain trusted
 * server-loaded facts.
 */
export type InboxV2OutboundReferenceCommand =
  | Readonly<{
      kind: "reply";
      tenantId: string;
      conversationId: string;
      target: InboxV2OutboundReferenceSource;
      content: ReplyContent;
      routeIntent: InboxV2OutboundReferenceRouteIntent;
      clientMutationId: string;
    }>
  | Readonly<{
      kind: "forward_content_copy";
      tenantId: string;
      conversationId: string;
      sources: readonly InboxV2OutboundReferenceSource[];
      routeIntent: Exclude<
        InboxV2OutboundReferenceRouteIntent,
        { kind: "explicit_occurrence" }
      >;
      clientMutationId: string;
    }>
  | Readonly<{
      kind: "forward_provider_native";
      tenantId: string;
      conversationId: string;
      source: InboxV2OutboundReferenceSource &
        Readonly<{ sourceOccurrenceId: string }>;
      routeIntent: InboxV2OutboundReferenceRouteIntent;
      clientMutationId: string;
    }>;

export type InboxV2OutboundReferenceIdempotencyScope = Readonly<{
  tenantId: string;
  principal: InboxV2OutboundRoutePrincipal;
  commandTypeId: "core:message.send";
  clientMutationId: string;
  publicResultCode: "core:message.queued";
}>;

export type InboxV2PreparedOutboundReferenceCommand =
  | Readonly<{
      kind: "committed_replay";
      requestHash: string;
      scope: InboxV2OutboundReferenceIdempotencyScope;
      status: InboxV2PrivilegedAuthorizationMutationReplayStatus;
    }>
  | Readonly<{
      kind: "idempotency_conflict";
      scope: InboxV2OutboundReferenceIdempotencyScope;
    }>
  | Readonly<{
      kind: "source_rejected";
      disclosureAuthorizationPlan: InboxV2AuthorizationPlanInput;
      denialContext: InboxV2SecurityDenialContext;
      errorCode:
        | "message.source_unavailable"
        | "message.source_revision_stale"
        | "message.source_ambiguous";
    }>
  | Readonly<{
      kind: "route_rejected";
      disclosureAuthorizationPlan: InboxV2AuthorizationPlanInput;
      denialContext: InboxV2SecurityDenialContext;
      routeResolution: InboxV2OutboundRouteResolutionCommit;
    }>
  | Readonly<{
      kind: "selected";
      authorizationPlan: InboxV2AuthorizationPlanInput;
      denialContext: InboxV2SecurityDenialContext;
      authorizedCommand: InboxV2AuthorizedCommand;
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      routeResolution: InboxV2OutboundRouteResolutionCommit;
      messageCreation: InboxV2MessageCreationCommit;
      dispatchContentPlan: InboxV2OutboundDispatchContentPlan;
    }>;

export type InboxV2OutboundReferenceCommandPreparer = Readonly<{
  lookupIdempotency(
    command: InboxV2OutboundReferenceCommand
  ): Promise<Extract<
    InboxV2PreparedOutboundReferenceCommand,
    { kind: "committed_replay" | "idempotency_conflict" }
  > | null>;
  prepareNew(
    command: InboxV2OutboundReferenceCommand
  ): Promise<Extract<
    InboxV2PreparedOutboundReferenceCommand,
    { kind: "source_rejected" | "route_rejected" | "selected" }
  > | null>;
}>;

type AtomicReferenceResult = Readonly<{
  messageId: string;
  outboundRouteId: string;
  outboundDispatchId: string;
}>;

type AtomicReferenceFailure = Exclude<
  InboxV2AuthorizedCommandMutationResult<AtomicReferenceResult>,
  { kind: "applied" | "already_applied" }
>;

export type InboxV2OutboundReferenceCommandResult =
  | Readonly<{
      outcome: "queued";
      messageId: string;
      outboundRouteId: string;
      outboundDispatchId: string;
      commit: Extract<
        InboxV2AuthorizedCommandMutationResult<AtomicReferenceResult>,
        { kind: "applied" }
      >["status"];
    }>
  | Readonly<{
      outcome: "already_queued";
      messageId: string;
      commit: Extract<
        InboxV2AuthorizedCommandMutationResult<AtomicReferenceResult>,
        { kind: "already_applied" }
      >["status"];
    }>
  | Readonly<{ outcome: "idempotency_conflict" }>
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{ outcome: "denied"; errorCode: string }>
  | Readonly<{
      outcome: "source_rejected";
      errorCode:
        | "message.source_unavailable"
        | "message.source_revision_stale"
        | "message.source_ambiguous";
    }>
  | Readonly<{
      outcome: "route_rejected";
      errorCode: string;
      retryable: boolean;
    }>
  | Readonly<{
      outcome: "materialization_rejected";
      reason: string;
    }>
  | Readonly<{
      outcome: "authorization_conflict";
      conflict: AtomicReferenceFailure;
    }>;

export type InboxV2OutboundReferenceCommandServiceOptions = Readonly<{
  requestScope: InboxV2OutboundReferenceRequestScope;
  preparer: InboxV2OutboundReferenceCommandPreparer;
  contentFingerprintAuthority: InboxV2OutboundMessageMaterializationFingerprintAuthority;
  currentTime: () => string;
  denialSink: InboxV2SecurityDenialSink;
  coordinator: InboxV2AuthorizedAtomicMaterializationCoordinator;
  persistence?: InboxV2OutboundMessageMaterializationPersistence;
  authorizationGate?: typeof executeInboxV2AuthorizationGate;
}>;

export type InboxV2OutboundReferenceCommandService = Readonly<{
  execute(
    command: InboxV2OutboundReferenceCommand
  ): Promise<InboxV2OutboundReferenceCommandResult>;
}>;

export function createInboxV2OutboundReferenceCommandService(
  options: InboxV2OutboundReferenceCommandServiceOptions
): InboxV2OutboundReferenceCommandService {
  const requestScope = normalizeRequestScope(options.requestScope);
  const authorizationGate =
    options.authorizationGate ?? executeInboxV2AuthorizationGate;

  return Object.freeze({
    async execute(commandInput) {
      const command = normalizeCommand(commandInput);
      if (command.tenantId !== requestScope.tenantId) {
        throw new CoreError("permission.denied");
      }

      const replay = await options.preparer.lookupIdempotency(command);
      if (replay?.kind === "committed_replay") {
        if (
          !idempotencyScopeMatches(requestScope, command, replay.scope) ||
          replay.status.publicResultCode !== "core:message.queued" ||
          replay.requestHash !==
            calculateInboxV2OutboundReferenceIntentDigest(command)
        ) {
          throw new CoreError("permission.denied");
        }
        return {
          outcome: "already_queued",
          messageId: replayedMessageId(replay.status, command.tenantId),
          commit: replay.status
        };
      }
      if (replay?.kind === "idempotency_conflict") {
        if (!idempotencyScopeMatches(requestScope, command, replay.scope)) {
          throw new CoreError("permission.denied");
        }
        return { outcome: "idempotency_conflict" };
      }

      const prepared = await options.preparer.prepareNew(command);
      // Until a versioned provider-operation plan exists, native forwarding has
      // exactly one admissible prepared outcome. A missing source, any other
      // route error, or a selected route would let a buggy preparer invent a
      // partially supported operation, so none may reach disclosure or writes.
      if (
        command.kind === "forward_provider_native" &&
        (prepared?.kind !== "route_rejected" ||
          prepared.routeResolution.result.kind !== "failed" ||
          prepared.routeResolution.result.error.code !==
            "route.capability_missing")
      ) {
        throw new CoreError("permission.denied");
      }
      if (prepared === null) return { outcome: "not_found" };
      if (prepared.kind === "source_rejected") {
        if (
          !isInboxV2OutboundReferenceSourceRejectionCode(prepared.errorCode) ||
          !routeDisclosureAuthorizationMatches(
            prepared.disclosureAuthorizationPlan,
            requestScope,
            command
          )
        ) {
          throw new CoreError("permission.denied");
        }
        const disclosure = await authorizationGate({
          authorizationPlan: prepared.disclosureAuthorizationPlan,
          denialContext: prepared.denialContext,
          denialSink: options.denialSink,
          executeAllowed: async () => prepared.errorCode
        });
        return disclosure.outcome === "denied"
          ? {
              outcome: "denied",
              errorCode: disclosure.publicDecision.errorCode
            }
          : { outcome: "source_rejected", errorCode: disclosure.value };
      }
      if (prepared.kind === "route_rejected") {
        const resolution = assertRejectedRouteClosure(
          command,
          requestScope,
          prepared
        );
        const disclosure = await authorizationGate({
          authorizationPlan: prepared.disclosureAuthorizationPlan,
          denialContext: prepared.denialContext,
          denialSink: options.denialSink,
          executeAllowed: async () => resolution
        });
        if (disclosure.outcome === "denied") {
          return {
            outcome: "denied",
            errorCode: disclosure.publicDecision.errorCode
          };
        }
        return {
          outcome: "route_rejected",
          errorCode: disclosure.value.result.error.code,
          retryable: disclosure.value.result.error.retryability !== "terminal"
        };
      }

      // The only native state admitted above returned through route_rejected.
      // Keep the selected path explicitly unrepresentable and preserve the
      // non-native type boundary for materialization.
      if (command.kind === "forward_provider_native") {
        throw new CoreError("permission.denied");
      }

      const closed = assertSelectedReferenceClosure(
        command,
        requestScope,
        prepared
      );
      const materialized = await materializeInboxV2OutboundMessage(
        {
          tenantId: command.tenantId,
          conversationId: command.conversationId,
          requiredConversationPermissionId:
            command.kind === "reply"
              ? "core:message.reply_external"
              : "core:message.forward_external",
          replyAuthority: closed.replyAuthority,
          authorizationPlan: prepared.authorizationPlan,
          denialContext: prepared.denialContext,
          authorizedMutation: prepared.authorizedMutation,
          routeResolution: closed.routeResolution,
          messageCreation: closed.messageCreation,
          dispatchContentPlan: closed.dispatchContentPlan
        },
        {
          denialSink: options.denialSink,
          coordinator: options.coordinator,
          contentFingerprintAuthority: options.contentFingerprintAuthority,
          currentTime: options.currentTime,
          persistence: options.persistence,
          authorizationGate
        }
      );
      if (materialized.kind === "applied") {
        return {
          outcome: "queued",
          ...materialized.mutation.result,
          commit: materialized.mutation.status
        };
      }
      if (materialized.kind === "already_applied") {
        return {
          outcome: "already_queued",
          messageId: replayedMessageId(
            materialized.mutation.status,
            command.tenantId
          ),
          commit: materialized.mutation.status
        };
      }
      if (materialized.kind === "idempotency_conflict") {
        return { outcome: "idempotency_conflict" };
      }
      if (materialized.kind === "denied") {
        return {
          outcome: "denied",
          errorCode: materialized.errorCode
        };
      }
      if (materialized.kind === "materialization_rejected") {
        return {
          outcome: "materialization_rejected",
          reason: materialized.reason
        };
      }
      return {
        outcome: "authorization_conflict",
        conflict: materialized.conflict
      };
    }
  });
}

export function calculateInboxV2OutboundReferenceIntentDigest(
  commandInput: InboxV2OutboundReferenceCommand
): string {
  const command = normalizeCommand(commandInput);
  return calculateInboxV2CanonicalSha256({
    protocol: "core:inbox-v2.outbound-reference-command@v1",
    command
  });
}

export function calculateInboxV2OutboundReferenceRouteIdempotencyToken(
  scopeInput: InboxV2OutboundReferenceRequestScope,
  commandInput: InboxV2OutboundReferenceCommand
): string {
  const scope = normalizeRequestScope(scopeInput);
  const command = normalizeCommand(commandInput);
  if (scope.tenantId !== command.tenantId) {
    throw new CoreError("permission.denied");
  }
  return inboxV2RoutingTokenSchema.parse(
    calculateInboxV2CanonicalSha256({
      protocol: "core:inbox-v2.outbound-reference-route-token@v1",
      tenantId: command.tenantId,
      principal: scope.principal,
      requestHash: calculateInboxV2OutboundReferenceIntentDigest(command),
      clientMutationId: command.clientMutationId
    })
  );
}

function assertRejectedRouteClosure(
  command: InboxV2OutboundReferenceCommand,
  requestScope: InboxV2OutboundReferenceRequestScope,
  prepared: Extract<
    InboxV2PreparedOutboundReferenceCommand,
    { kind: "route_rejected" }
  >
) {
  const resolution = inboxV2OutboundRouteResolutionCommitSchema.parse(
    prepared.routeResolution
  );
  if (
    resolution.result.kind !== "failed" ||
    resolution.route !== null ||
    !routeInputMatchesCommand(command, requestScope, resolution) ||
    !routeDisclosureAuthorizationMatches(
      prepared.disclosureAuthorizationPlan,
      requestScope,
      command
    )
  ) {
    throw new CoreError("permission.denied");
  }
  return resolution as typeof resolution & {
    result: Extract<typeof resolution.result, { kind: "failed" }>;
  };
}

function assertSelectedReferenceClosure(
  command: Exclude<
    InboxV2OutboundReferenceCommand,
    { kind: "forward_provider_native" }
  >,
  requestScope: InboxV2OutboundReferenceRequestScope,
  prepared: Extract<
    InboxV2PreparedOutboundReferenceCommand,
    { kind: "selected" }
  >
) {
  const routeResolution = inboxV2OutboundRouteResolutionCommitSchema.parse(
    prepared.routeResolution
  );
  const messageCreation = inboxV2MessageCreationCommitSchema.parse(
    prepared.messageCreation
  );
  const dispatchContentPlan = inboxV2OutboundDispatchContentPlanSchema.parse(
    prepared.dispatchContentPlan
  );
  const authorizedCommand = inboxV2AuthorizedCommandSchema.parse(
    prepared.authorizedCommand
  );
  const routeResult = resolveInboxV2OutboundRoute(routeResolution.input);
  const route = routeResolution.route;
  const dispatch = messageCreation.outboundDispatch;
  const intent = authorizedCommand.intent.payload;
  const mutation = prepared.authorizedMutation;
  const expectedHash = calculateInboxV2OutboundReferenceIntentDigest(command);

  if (
    routeResult.kind !== "selected" ||
    routeResolution.result.kind !== "selected" ||
    route === null ||
    dispatch === null ||
    !requestScopeMatchesRoute(requestScope, route) ||
    !routeInputMatchesCommand(command, requestScope, routeResolution) ||
    !sameValue(routeResult, routeResolution.result) ||
    !sameValue(route, messageCreation.outboundRoute) ||
    !inboxV2OutboundDispatchContentPlanMatches(
      dispatchContentPlan,
      messageCreation,
      route,
      dispatch
    ) ||
    messageCreation.tenantId !== command.tenantId ||
    messageCreation.message.conversation.id !== command.conversationId ||
    messageCreation.message.origin.kind !== "hulee_external" ||
    messageCreation.message.origin.outboundRoute.id !== route.id ||
    dispatch.route.id !== route.id ||
    dispatch.message.id !== messageCreation.message.id ||
    dispatch.multiSendOperation !== null ||
    dispatch.state !== "queued" ||
    dispatch.attemptCount !== 0 ||
    !intentMatchesCommand(command, intent, messageCreation, route) ||
    !messageActorMatchesAuthorizedCommand(messageCreation, authorizedCommand) ||
    mutation.tenantId !== command.tenantId ||
    mutation.command.commandTypeId !== "core:message.send" ||
    mutation.command.clientMutationId !== command.clientMutationId ||
    mutation.command.requestHash !== expectedHash ||
    authorizedCommand.request.requestHash !== expectedHash ||
    authorizedCommand.request.clientMutationId !== command.clientMutationId ||
    authorizedCommand.request.commandTypeId !== "core:timeline.command" ||
    mutation.command.authorizationEpoch !== route.authorizationEpoch ||
    mutation.command.authorizedAt !== authorizedCommand.authorizedAt ||
    mutation.occurredAt !== route.selection.selectedAt ||
    String(mutation.command.resultReference?.recordId) !==
      String(messageCreation.message.id) ||
    mutation.command.resultReference?.tenantId !== command.tenantId ||
    mutation.command.resultReference?.schemaId !== INBOX_V2_MESSAGE_SCHEMA_ID ||
    mutation.command.resultReference?.schemaVersion !==
      INBOX_V2_MESSAGE_SCHEMA_VERSION ||
    !authorizationClosureMatches(
      prepared.authorizationPlan,
      authorizedCommand,
      mutation,
      route,
      command,
      requestScope
    ) ||
    !atomicProviderClosureMatches(mutation, messageCreation, command.kind)
  ) {
    throw new CoreError("permission.denied");
  }

  const replyAuthority = intent.replyAuthority;
  if (replyAuthority === undefined) throw new CoreError("permission.denied");
  return {
    routeResolution,
    messageCreation,
    dispatchContentPlan,
    replyAuthority
  };
}

function intentMatchesCommand(
  command: Exclude<
    InboxV2OutboundReferenceCommand,
    { kind: "forward_provider_native" }
  >,
  intent: InboxV2AuthorizedCommand["intent"]["payload"],
  messageCreation: InboxV2MessageCreationCommit,
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>
): intent is Extract<
  InboxV2AuthorizedCommand["intent"]["payload"],
  { kind: "reply_external" | "forward_content_copy" }
> {
  if (
    !sameValue(
      messageCreation.content.state.kind === "available"
        ? messageCreation.content.state.blocks
        : null,
      "content" in intent ? intent.content.blocks : null
    )
  ) {
    return false;
  }
  if (command.kind === "reply") {
    if (
      intent.kind !== "reply_external" ||
      !sameValue(intent.content, command.content) ||
      intent.referenceContext.kind !== "reply" ||
      messageCreation.message.referenceContext.kind !== "reply" ||
      !sameValue(
        intent.referenceContext,
        messageCreation.message.referenceContext
      ) ||
      intent.referenceContext.target.state !== "resolved_external" ||
      intent.referenceContext.target.canonical.message.id !==
        command.target.messageId ||
      intent.referenceContext.target.canonical.conversation.id !==
        command.target.conversationId ||
      intent.referenceContext.target.canonical.messageRevision !==
        command.target.expectedMessageRevision ||
      route.referenceContext.kind !== "external_message" ||
      intent.externalMessageReference.id !==
        route.referenceContext.externalMessageReference.id ||
      intent.sourceOccurrence.id !==
        route.referenceContext.sourceOccurrence.id ||
      intent.referenceContext.target.external.externalMessageReference.id !==
        route.referenceContext.externalMessageReference.id ||
      intent.referenceContext.target.external.sourceOccurrence.id !==
        route.referenceContext.sourceOccurrence.id
    ) {
      return false;
    }
    return timelineRouteProofMatches(intent.routeAuthorization, route);
  }

  if (
    intent.kind !== "forward_content_copy" ||
    intent.destination.kind !== "external" ||
    intent.referenceContext.kind !== "forward_content_copy" ||
    messageCreation.message.referenceContext.kind !== "forward_content_copy" ||
    route.referenceContext.kind !== "none" ||
    !sameValue(
      intent.referenceContext,
      messageCreation.message.referenceContext
    ) ||
    !canonicalSourcesMatch(command.sources, intent.referenceContext.sources) ||
    intent.sourceReadProofs === undefined ||
    !inboxV2ContentCopyProvenanceMatches(
      command.sources,
      intent,
      messageCreation
    ) ||
    intent.sourceReadProofs.some(
      (proof) => proof.visibilityBoundary !== "external_work"
    )
  ) {
    return false;
  }
  return timelineRouteProofMatches(
    intent.destination.routeAuthorization,
    route
  );
}

function routeInputMatchesCommand(
  command: InboxV2OutboundReferenceCommand,
  scope: InboxV2OutboundReferenceRequestScope,
  resolution: InboxV2OutboundRouteResolutionCommit
): boolean {
  const input = resolution.input;
  const expectedOperation =
    command.kind === "reply"
      ? "core:message.reply"
      : command.kind === "forward_content_copy"
        ? "core:message.forward_content_copy"
        : "core:message.forward_provider_native";
  const expectedPermission =
    command.kind === "reply"
      ? "core:message.reply_external"
      : "core:message.forward_external";
  return (
    input.tenantId === command.tenantId &&
    input.conversation.id === command.conversationId &&
    input.operationId === expectedOperation &&
    input.routePolicy.requiredConversationPermissionId === expectedPermission &&
    (command.kind === "forward_content_copy"
      ? input.referenceContext.kind === "none"
      : input.referenceContext.kind === "external_message") &&
    input.idempotencyToken ===
      calculateInboxV2OutboundReferenceRouteIdempotencyToken(scope, command) &&
    routeIntentMatches(command.routeIntent, input.intent) &&
    (command.kind !== "forward_provider_native" ||
      input.referenceContext.kind !== "external_message" ||
      input.referenceContext.sourceOccurrence.id ===
        command.source.sourceOccurrenceId)
  );
}

function routeIntentMatches(
  command: InboxV2OutboundReferenceRouteIntent,
  prepared: InboxV2OutboundRouteResolutionCommit["input"]["intent"]
): boolean {
  if (command.kind !== prepared.kind) return false;
  if (command.kind === "automatic") return true;
  if (
    command.kind === "explicit_binding" &&
    prepared.kind === "explicit_binding"
  ) {
    return command.bindingId === prepared.binding.id;
  }
  return (
    command.kind === "explicit_occurrence" &&
    prepared.kind === "explicit_occurrence" &&
    command.occurrenceId === prepared.occurrence.id
  );
}

function timelineRouteProofMatches(
  proof: TimelineRouteAuthorizationProof | undefined,
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>
): boolean {
  return (
    proof !== undefined &&
    proof.conversation.id === route.conversation.id &&
    proof.outboundRoute.id === route.id &&
    proof.routeRevision === route.revision &&
    proof.sourceAccount.id === route.sourceAccount.id &&
    proof.sourceThreadBinding.id === route.sourceThreadBinding.id &&
    sameValue(proof.bindingFence, route.bindingFence)
  );
}

function authorizationClosureMatches(
  plan: InboxV2AuthorizationPlanInput,
  authorizedCommand: InboxV2AuthorizedCommand,
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>,
  command: Exclude<
    InboxV2OutboundReferenceCommand,
    { kind: "forward_provider_native" }
  >,
  requestScope: InboxV2OutboundReferenceRequestScope
): boolean {
  const decisions = authorizedCommand.authorizationDecisionRefs.map(
    (decision) => inboxV2AuthorizationDecisionReferenceSchema.parse(decision)
  );
  const auditDecisions = mutation.records.audit.authorizationDecisionRefs.map(
    (decision) => inboxV2AuthorizationDecisionReferenceSchema.parse(decision)
  );
  const expectedPermission =
    command.kind === "reply"
      ? "core:message.reply_external"
      : "core:message.forward_external";
  const actionDecision = decisions.find(
    (decision) =>
      decision.permissionId === expectedPermission &&
      decision.resource.entityTypeId === "core:conversation" &&
      String(decision.resource.entityId) === String(route.conversation.id)
  );
  const sourceUseDecision = decisions.find(
    (decision) =>
      decision.permissionId === "core:source_account.use" &&
      decision.resource.entityTypeId === "core:source-account" &&
      String(decision.resource.entityId) === String(route.sourceAccount.id)
  );
  const actionRequirement = plan.requirements.find(
    (requirement) =>
      requirement.permissionId === expectedPermission &&
      requirement.resource.entityTypeId === "core:conversation" &&
      String(requirement.resource.entityId) === String(route.conversation.id)
  );
  const guard = actionRequirement?.guard;
  const forwardSource =
    command.kind === "forward_content_copy" &&
    authorizedCommand.intent.payload.kind === "forward_content_copy" &&
    authorizedCommand.intent.payload.referenceContext.kind ===
      "forward_content_copy"
      ? authorizedCommand.intent.payload.referenceContext.sources[0]
      : undefined;
  const forwardGuardSourceMatches =
    command.kind !== "forward_content_copy" ||
    (forwardSource !== undefined &&
      guard?.profileId === "core:rbac.guard.external_route" &&
      guard.operation.kind === "forward" &&
      guard.operation.mode === "copy" &&
      String(guard.operation.sourceReadResource.entityId) ===
        command.sources[0]?.conversationId &&
      String(guard.operation.sourceTimelineItemResource.entityId) ===
        String(forwardSource.timelineItem.id));
  const replyGuardReferenceClosureMatches =
    command.kind !== "reply" ||
    externalReplyGuardMatchesReferenceClosure(
      guard,
      authorizedCommand.intent.payload,
      route
    );
  const sourceConversations =
    command.kind === "reply" ? [command.target] : command.sources;
  const sourceReadsPresent = sourceConversations.every((source) =>
    decisions.some(
      (decision) =>
        decision.permissionId === "core:conversation.read" &&
        decision.resource.entityTypeId === "core:conversation" &&
        String(decision.resource.entityId) === source.conversationId
    )
  );

  return (
    plan.tenantId === route.tenantId &&
    plan.currentAuthorization.tenantId === route.tenantId &&
    plan.currentAuthorization.authorizationEpoch === route.authorizationEpoch &&
    samePrincipal(plan, authorizedCommand, mutation, requestScope) &&
    actionDecision !== undefined &&
    sourceUseDecision !== undefined &&
    sourceReadsPresent &&
    forwardGuardSourceMatches &&
    replyGuardReferenceClosureMatches &&
    mutation.command.authorizationDecisionId === actionDecision.id &&
    sameDecisionReferenceMultiset(decisions, auditDecisions) &&
    authorizationRequirementsMatchDecisions(plan.requirements, decisions) &&
    guard?.profileId === "core:rbac.guard.external_route" &&
    guard.authorizationMode === "operation" &&
    guard.routeFallbackRequested === false &&
    (command.kind === "reply"
      ? guard.operation.kind === "reply" &&
        guard.operation.mode === "provider_reference"
      : guard.operation.kind === "forward" &&
        guard.operation.mode === "copy") &&
    externalReplyAuthorityMatchesGuard(
      authorizedCommand.intent.payload.kind === "reply_external" ||
        authorizedCommand.intent.payload.kind === "forward_content_copy"
        ? authorizedCommand.intent.payload.replyAuthority
        : undefined,
      guard
    )
  );
}

function externalReplyGuardMatchesReferenceClosure(
  guard:
    | InboxV2AuthorizationPlanInput["requirements"][number]["guard"]
    | undefined,
  intent: InboxV2AuthorizedCommand["intent"]["payload"],
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>
): boolean {
  if (
    guard?.profileId !== "core:rbac.guard.external_route" ||
    guard.operation.kind !== "reply" ||
    guard.operation.mode !== "provider_reference" ||
    intent.kind !== "reply_external" ||
    intent.referenceContext.kind !== "reply" ||
    intent.referenceContext.target.state !== "resolved_external" ||
    route.referenceContext.kind !== "external_message"
  ) {
    return false;
  }

  const operation = guard.operation;
  const canonical = intent.referenceContext.target.canonical;
  const external = intent.referenceContext.target.external;
  const referenceContext = route.referenceContext;
  const providerGlobalProof = operation.providerGlobalProof;
  const providerGlobalProofMatches =
    referenceContext.portability.kind === "provider_global"
      ? providerGlobalProof !== null &&
        providerGlobalProof.resource.entityTypeId ===
          "core:reference-portability-proof" &&
        providerGlobalProof.resource.tenantId === route.tenantId &&
        resourceMatchesReference(
          providerGlobalProof.sourceReferenceResource,
          "core:external-message-reference",
          referenceContext.externalMessageReference
        ) &&
        resourceMatchesReference(
          providerGlobalProof.sourceOccurrenceResource,
          "core:source-occurrence",
          referenceContext.sourceOccurrence
        ) &&
        resourceMatchesReference(
          providerGlobalProof.originBindingResource,
          "core:source-thread-binding",
          referenceContext.originBinding
        ) &&
        resourceMatchesReference(
          providerGlobalProof.originSourceAccountResource,
          "core:source-account",
          referenceContext.originSourceAccount
        ) &&
        resourceMatchesReference(
          providerGlobalProof.destinationBindingResource,
          "core:source-thread-binding",
          route.sourceThreadBinding
        ) &&
        resourceMatchesReference(
          providerGlobalProof.destinationSourceAccountResource,
          "core:source-account",
          route.sourceAccount
        )
      : providerGlobalProof === null;

  return (
    sameValue(canonical.conversation, route.conversation) &&
    sameValue(external.sourceOccurrence, referenceContext.sourceOccurrence) &&
    sameValue(
      external.externalMessageReference,
      referenceContext.externalMessageReference
    ) &&
    operation.portability === referenceContext.portability.kind &&
    resourceMatchesReference(
      operation.sourceReadResource,
      "core:conversation",
      canonical.conversation
    ) &&
    resourceMatchesReference(
      operation.sourceTimelineItemResource,
      "core:timeline-item",
      canonical.timelineItem
    ) &&
    resourceMatchesReference(
      operation.sourceOccurrenceResource,
      "core:source-occurrence",
      referenceContext.sourceOccurrence
    ) &&
    resourceMatchesReference(
      operation.occurrenceTimelineItemResource,
      "core:timeline-item",
      canonical.timelineItem
    ) &&
    resourceMatchesReference(
      operation.occurrenceReferenceResource,
      "core:external-message-reference",
      referenceContext.externalMessageReference
    ) &&
    resourceMatchesReference(
      operation.occurrenceBindingResource,
      "core:source-thread-binding",
      referenceContext.originBinding
    ) &&
    resourceMatchesReference(
      operation.sourceReferenceResource,
      "core:external-message-reference",
      referenceContext.externalMessageReference
    ) &&
    resourceMatchesReference(
      operation.referenceTimelineItemResource,
      "core:timeline-item",
      canonical.timelineItem
    ) &&
    resourceMatchesReference(
      operation.referenceBindingResource,
      "core:source-thread-binding",
      referenceContext.originBinding
    ) &&
    resourceMatchesReference(
      operation.sourceBindingResource,
      "core:source-thread-binding",
      referenceContext.originBinding
    ) &&
    resourceMatchesReference(
      operation.bindingConversationResource,
      "core:conversation",
      canonical.conversation
    ) &&
    resourceMatchesReference(
      operation.bindingExternalThreadResource,
      "core:external-thread",
      referenceContext.externalThread
    ) &&
    resourceMatchesReference(
      operation.bindingSourceAccountResource,
      "core:source-account",
      referenceContext.originSourceAccount
    ) &&
    resourceMatchesReference(
      operation.sourceExternalThreadResource,
      "core:external-thread",
      referenceContext.externalThread
    ) &&
    resourceMatchesReference(
      guard.targetResource,
      "core:conversation",
      route.conversation
    ) &&
    resourceMatchesReference(
      guard.conversationResource,
      "core:conversation",
      route.conversation
    ) &&
    resourceMatchesReference(
      guard.bindingResource,
      "core:source-thread-binding",
      route.sourceThreadBinding
    ) &&
    resourceMatchesReference(
      guard.externalThreadResource,
      "core:external-thread",
      route.externalThread
    ) &&
    resourceMatchesReference(
      guard.bindingConversationResource,
      "core:conversation",
      route.conversation
    ) &&
    resourceMatchesReference(
      guard.bindingExternalThreadResource,
      "core:external-thread",
      route.externalThread
    ) &&
    resourceMatchesReference(
      guard.bindingSourceAccountResource,
      "core:source-account",
      route.sourceAccount
    ) &&
    resourceMatchesReference(
      guard.capabilityManifestSourceAccountResource,
      "core:source-account",
      route.sourceAccount
    ) &&
    resourceMatchesReference(
      guard.capabilityManifestBindingResource,
      "core:source-thread-binding",
      route.sourceThreadBinding
    ) &&
    String(guard.sourceAccountId) === String(route.sourceAccount.id) &&
    String(guard.bindingSourceAccountId) === String(route.sourceAccount.id) &&
    providerGlobalProofMatches
  );
}

function resourceMatchesReference(
  resource: {
    readonly tenantId: string;
    readonly entityTypeId: string;
    readonly entityId: unknown;
  },
  entityTypeId: string,
  reference: { readonly tenantId: string; readonly id: unknown }
): boolean {
  return (
    resource.tenantId === reference.tenantId &&
    resource.entityTypeId === entityTypeId &&
    String(resource.entityId) === String(reference.id)
  );
}

function atomicProviderClosureMatches(
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  messageCreation: InboxV2MessageCreationCommit,
  kind: "reply" | "forward_content_copy"
): boolean {
  const dispatch = messageCreation.outboundDispatch;
  if (dispatch === null) return false;
  const dispatchChanges = mutation.records.changes.filter(
    (change) => change.entity.entityTypeId === "core:outbound-dispatch"
  );
  const providerIntents = mutation.records.outboxIntents.filter(
    (intent) =>
      intent.effectClass === "provider_io" &&
      intent.typeId === "core:provider.dispatch"
  );
  const change = dispatchChanges[0];
  const providerIntent = providerIntents[0];
  return (
    mutation.records.relationKind === null &&
    mutation.records.audit.actionId ===
      (kind === "reply"
        ? "core:message.reply"
        : "core:message.forward_content_copy") &&
    dispatchChanges.length === 1 &&
    change !== undefined &&
    String(change.entity.entityId) === String(dispatch.id) &&
    change.resultingRevision === "1" &&
    providerIntents.length === 1 &&
    providerIntent !== undefined &&
    providerIntent.changeIds.length === 1 &&
    providerIntent.changeIds[0] === change.id &&
    String(providerIntent.payloadReference?.recordId) === String(dispatch.id)
  );
}

function externalReplyAuthorityMatchesGuard(
  authority:
    | Extract<
        InboxV2TimelineCommandIntent,
        { kind: "reply_external" }
      >["replyAuthority"]
    | undefined,
  guard: Extract<
    InboxV2AuthorizationPlanInput["requirements"][number]["guard"],
    { profileId: "core:rbac.guard.external_route" }
  >
): boolean {
  if (authority === undefined) return false;
  switch (authority.kind) {
    case "active_primary_responsible":
      return (
        guard.actorRelation === "primary_responsible" &&
        guard.workItemId === authority.workItem.id
      );
    case "active_allowed_collaborator":
      return (
        guard.actorRelation === "work_item_collaborator" &&
        guard.workItemId === authority.workItem.id &&
        guard.queueReplyPolicy === "responsible_or_work_item_collaborator"
      );
    case "supervisor_override":
      return (
        guard.actorRelation === "scoped_supervisor_override" &&
        guard.workItemId === authority.workItem.id &&
        guard.overrideReason === authority.reasonId
      );
    case "no_work_item":
      return (
        guard.workItemId === null &&
        guard.workState === "no_work_non_actionable" &&
        guard.workAbsenceProof !== null &&
        guard.workAbsenceProof.workItemCount === 0 &&
        guard.workAbsenceProof.expectedHighWater ===
          authority.intakeDecisionRevision &&
        guard.workAbsenceProof.currentHighWater ===
          authority.intakeDecisionRevision
      );
  }
}

function messageActorMatchesAuthorizedCommand(
  creation: InboxV2MessageCreationCommit,
  command: InboxV2AuthorizedCommand
): boolean {
  const actor = creation.message.appActor;
  if (actor === null || actor.kind !== command.principal.kind) return false;
  if (actor.kind === "employee" && command.principal.kind === "employee") {
    return (
      actor.employee.id === command.principal.employee.id &&
      actor.authorizationEpoch === command.principal.authorization.value &&
      creation.authorParticipant.subject.kind === "employee" &&
      creation.authorParticipant.subject.employee.id ===
        command.principal.employee.id
    );
  }
  return (
    actor.kind === "trusted_service" &&
    command.principal.kind === "trusted_service" &&
    actor.trustedServiceId === command.principal.trustedServiceId
  );
}

function samePrincipal(
  plan: InboxV2AuthorizationPlanInput,
  command: InboxV2AuthorizedCommand,
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  scope: InboxV2OutboundReferenceRequestScope
): boolean {
  if (
    plan.currentAuthorization.principal.kind !== command.principal.kind ||
    mutation.command.actor.kind !== command.principal.kind ||
    scope.principal.kind !== command.principal.kind
  ) {
    return false;
  }
  return command.principal.kind === "employee" &&
    plan.currentAuthorization.principal.kind === "employee" &&
    mutation.command.actor.kind === "employee" &&
    scope.principal.kind === "employee"
    ? command.principal.employee.id ===
        plan.currentAuthorization.principal.employeeId &&
        command.principal.employee.id === mutation.command.actor.employeeId &&
        command.principal.employee.id === scope.principal.employee.id
    : command.principal.kind === "trusted_service" &&
        plan.currentAuthorization.principal.kind === "trusted_service" &&
        mutation.command.actor.kind === "trusted_service" &&
        scope.principal.kind === "trusted_service" &&
        command.principal.trustedServiceId ===
          plan.currentAuthorization.principal.trustedServiceId &&
        command.principal.trustedServiceId ===
          mutation.command.actor.trustedServiceId &&
        command.principal.trustedServiceId === scope.principal.trustedServiceId;
}

function authorizationRequirementsMatchDecisions(
  requirements: InboxV2AuthorizationPlanInput["requirements"],
  decisions: readonly InboxV2AuthorizationDecisionReference[]
): boolean {
  if (requirements.length !== decisions.length) return false;
  const unmatched = [...decisions];
  for (const requirement of requirements) {
    const index = unmatched.findIndex(
      (decision) =>
        decision.permissionId === requirement.permissionId &&
        sameEntity(decision.resource, requirement.resource) &&
        decision.resourceAccessRevision === requirement.resourceAccessRevision
    );
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0;
}

function sameDecisionReferenceMultiset(
  left: readonly InboxV2AuthorizationDecisionReference[],
  right: readonly InboxV2AuthorizationDecisionReference[]
): boolean {
  if (left.length !== right.length) return false;
  const unmatched = [...right];
  for (const decision of left) {
    const index = unmatched.findIndex((candidate) =>
      sameValue(decision, candidate)
    );
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0;
}

function canonicalSourcesMatch(
  expected: readonly InboxV2OutboundReferenceSource[],
  actual: readonly {
    conversation: { id: string };
    message: { id: string };
    messageRevision: string;
  }[]
): boolean {
  return (
    expected.length === actual.length &&
    expected.every(
      (source, index) =>
        actual[index]?.conversation.id === source.conversationId &&
        actual[index]?.message.id === source.messageId &&
        actual[index]?.messageRevision === source.expectedMessageRevision
    )
  );
}

export function inboxV2ContentCopyProvenanceMatches(
  expected: readonly InboxV2OutboundReferenceSource[],
  intent: Extract<
    InboxV2TimelineCommandIntent,
    { kind: "forward_content_copy" }
  >,
  messageCreation: InboxV2MessageCreationCommit
): boolean {
  if (
    expected.length !== 1 ||
    intent.sourceReadProofs?.length !== 1 ||
    intent.referenceContext.kind !== "forward_content_copy" ||
    intent.referenceContext.sources.length !== 1 ||
    messageCreation.canonicalReferenceTargets.length !== 1 ||
    messageCreation.content.state.kind !== "available"
  ) {
    return false;
  }

  const source = expected[0];
  const canonical = intent.referenceContext.sources[0];
  const proof = intent.sourceReadProofs[0];
  const snapshot = messageCreation.canonicalReferenceTargets[0];
  if (
    source === undefined ||
    canonical === undefined ||
    proof === undefined ||
    snapshot === undefined
  ) {
    return false;
  }

  const destinationDigest = calculateInboxV2MessageContentDigest(
    intent.content.blocks
  );
  const reconstructedSourceDigest = calculateInboxV2ContentCopySourceDigest(
    intent.content.blocks,
    proof.attachmentCopies ?? []
  );
  return (
    proof.conversation.tenantId === messageCreation.tenantId &&
    proof.conversation.id === source.conversationId &&
    proof.message.tenantId === messageCreation.tenantId &&
    proof.message.id === source.messageId &&
    proof.expectedMessageRevision === source.expectedMessageRevision &&
    proof.timelineItem.tenantId === messageCreation.tenantId &&
    proof.timelineItem.id === canonical.timelineItem.id &&
    proof.expectedTimelineItemRevision === snapshot.timelineItem.revision &&
    proof.timelineContent.tenantId === messageCreation.tenantId &&
    proof.timelineContent.id === snapshot.message.content.content.id &&
    proof.expectedTimelineContentRevision ===
      snapshot.message.content.contentRevision &&
    reconstructedSourceDigest !== null &&
    proof.sourceContentDigestSha256 === reconstructedSourceDigest &&
    destinationDigest === messageCreation.content.state.contentDigestSha256 &&
    snapshot.message.tenantId === messageCreation.tenantId &&
    snapshot.message.id === source.messageId &&
    snapshot.message.revision === source.expectedMessageRevision &&
    snapshot.message.conversation.id === source.conversationId &&
    snapshot.message.content.stateKind === "available" &&
    snapshot.timelineItem.tenantId === messageCreation.tenantId &&
    snapshot.timelineItem.id === canonical.timelineItem.id &&
    snapshot.timelineItem.subject.kind === "message" &&
    snapshot.timelineItem.subject.message.id === source.messageId &&
    snapshot.timelineItem.subject.messageRevision ===
      source.expectedMessageRevision
  );
}

function routeDisclosureAuthorizationMatches(
  plan: InboxV2AuthorizationPlanInput,
  scope: InboxV2OutboundReferenceRequestScope,
  command: InboxV2OutboundReferenceCommand
): boolean {
  const sourceConversationIds =
    command.kind === "reply"
      ? [command.target.conversationId]
      : command.kind === "forward_content_copy"
        ? command.sources.map((source) => source.conversationId)
        : [command.source.conversationId];
  const requiredConversationIds = [
    ...new Set([command.conversationId, ...sourceConversationIds])
  ];
  return (
    plan.tenantId === command.tenantId &&
    requestScopeMatchesPlan(scope, plan) &&
    plan.requirements.length === requiredConversationIds.length &&
    requiredConversationIds.every((conversationId) =>
      plan.requirements.some(
        (requirement) =>
          requirement.permissionId === "core:conversation.read" &&
          requirement.resource.tenantId === command.tenantId &&
          requirement.resource.entityTypeId === "core:conversation" &&
          String(requirement.resource.entityId) === conversationId
      )
    )
  );
}

function isInboxV2OutboundReferenceSourceRejectionCode(
  value: unknown
): value is Extract<
  InboxV2PreparedOutboundReferenceCommand,
  { kind: "source_rejected" }
>["errorCode"] {
  return (
    value === "message.source_unavailable" ||
    value === "message.source_revision_stale" ||
    value === "message.source_ambiguous"
  );
}

function requestScopeMatchesPlan(
  scope: InboxV2OutboundReferenceRequestScope,
  plan: InboxV2AuthorizationPlanInput
): boolean {
  if (
    scope.tenantId !== plan.tenantId ||
    plan.currentAuthorization.tenantId !== scope.tenantId ||
    plan.principal.kind !== scope.principal.kind ||
    plan.currentAuthorization.principal.kind !== scope.principal.kind
  ) {
    return false;
  }
  return scope.principal.kind === "employee" &&
    plan.principal.kind === "employee" &&
    plan.currentAuthorization.principal.kind === "employee"
    ? scope.principal.employee.id === plan.principal.employee.id &&
        scope.principal.employee.id ===
          plan.currentAuthorization.principal.employeeId
    : scope.principal.kind === "trusted_service" &&
        plan.principal.kind === "trusted_service" &&
        plan.currentAuthorization.principal.kind === "trusted_service" &&
        scope.principal.trustedServiceId === plan.principal.trustedServiceId &&
        scope.principal.trustedServiceId ===
          plan.currentAuthorization.principal.trustedServiceId;
}

function requestScopeMatchesRoute(
  scope: InboxV2OutboundReferenceRequestScope,
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>
): boolean {
  if (
    scope.tenantId !== route.tenantId ||
    scope.principal.kind !== route.principal.kind
  ) {
    return false;
  }
  return scope.principal.kind === "employee" &&
    route.principal.kind === "employee"
    ? scope.principal.employee.id === route.principal.employee.id
    : scope.principal.kind === "trusted_service" &&
        route.principal.kind === "trusted_service" &&
        scope.principal.trustedServiceId === route.principal.trustedServiceId;
}

function idempotencyScopeMatches(
  requestScope: InboxV2OutboundReferenceRequestScope,
  command: InboxV2OutboundReferenceCommand,
  scope: InboxV2OutboundReferenceIdempotencyScope
): boolean {
  const principal = inboxV2OutboundRoutePrincipalSchema.safeParse(
    scope.principal
  );
  return (
    principal.success &&
    scope.tenantId === command.tenantId &&
    scope.tenantId === requestScope.tenantId &&
    scope.commandTypeId === "core:message.send" &&
    scope.clientMutationId === command.clientMutationId &&
    scope.publicResultCode === "core:message.queued" &&
    outboundRoutePrincipalsMatch(principal.data, requestScope.principal)
  );
}

function replayedMessageId(
  status: {
    resultReference: {
      tenantId: string;
      recordId: string;
      schemaId: string;
      schemaVersion: string;
    } | null;
  },
  tenantId: string
): string {
  if (
    status.resultReference === null ||
    status.resultReference.tenantId !== tenantId ||
    status.resultReference.schemaId !== INBOX_V2_MESSAGE_SCHEMA_ID ||
    status.resultReference.schemaVersion !== INBOX_V2_MESSAGE_SCHEMA_VERSION
  ) {
    throw new CoreError("permission.denied");
  }
  return status.resultReference.recordId;
}

function normalizeRequestScope(
  input: InboxV2OutboundReferenceRequestScope
): InboxV2OutboundReferenceRequestScope {
  if (
    typeof input !== "object" ||
    input === null ||
    !hasOnlyKeys(input, ["tenantId", "principal"])
  ) {
    throw new CoreError("permission.denied");
  }
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const principal = inboxV2OutboundRoutePrincipalSchema.parse(input.principal);
  if (
    principal.kind === "employee" &&
    principal.employee.tenantId !== tenantId
  ) {
    throw new CoreError("permission.denied");
  }
  return Object.freeze({ tenantId, principal });
}

function normalizeCommand(
  input: InboxV2OutboundReferenceCommand
): InboxV2OutboundReferenceCommand {
  if (typeof input !== "object" || input === null || !("kind" in input)) {
    throw new CoreError("validation.failed", "Reference command is invalid.");
  }
  const base = {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    clientMutationId: inboxV2ClientMutationIdSchema.parse(
      input.clientMutationId
    )
  };
  if (
    input.kind === "reply" &&
    hasOnlyKeys(input, [
      "kind",
      "tenantId",
      "conversationId",
      "target",
      "content",
      "routeIntent",
      "clientMutationId"
    ])
  ) {
    const target = normalizeSource(input.target);
    if (target.conversationId !== base.conversationId) {
      throw new CoreError(
        "validation.failed",
        "Reply target must belong to the destination Conversation."
      );
    }
    return Object.freeze({
      kind: "reply",
      ...base,
      target,
      content: inboxV2TimelineContentDraftSchema.parse(input.content),
      routeIntent: normalizeRouteIntent(input.routeIntent, true)
    });
  }
  if (
    input.kind === "forward_content_copy" &&
    hasOnlyKeys(input, [
      "kind",
      "tenantId",
      "conversationId",
      "sources",
      "routeIntent",
      "clientMutationId"
    ]) &&
    Array.isArray(input.sources)
  ) {
    const sources = input.sources.map(normalizeSource);
    if (
      sources.length !== 1 ||
      new Set(
        sources.map(
          (source) =>
            `${source.conversationId}\u0000${source.messageId}\u0000${source.expectedMessageRevision}`
        )
      ).size !== sources.length
    ) {
      throw new CoreError(
        "validation.failed",
        "External content-copy currently requires one exact source revision."
      );
    }
    return Object.freeze({
      kind: "forward_content_copy",
      ...base,
      sources: Object.freeze(sources),
      routeIntent: normalizeRouteIntent(input.routeIntent, false)
    });
  }
  if (
    input.kind === "forward_provider_native" &&
    hasOnlyKeys(input, [
      "kind",
      "tenantId",
      "conversationId",
      "source",
      "routeIntent",
      "clientMutationId"
    ]) &&
    typeof input.source === "object" &&
    input.source !== null &&
    hasOnlyKeys(input.source, [
      "conversationId",
      "messageId",
      "expectedMessageRevision",
      "sourceOccurrenceId"
    ])
  ) {
    const source = Object.freeze({
      ...normalizeSource({
        conversationId: input.source.conversationId,
        messageId: input.source.messageId,
        expectedMessageRevision: input.source.expectedMessageRevision
      }),
      sourceOccurrenceId: inboxV2SourceOccurrenceIdSchema.parse(
        input.source.sourceOccurrenceId
      )
    });
    const routeIntent = normalizeRouteIntent(input.routeIntent, true);
    if (
      routeIntent.kind === "explicit_occurrence" &&
      routeIntent.occurrenceId !== source.sourceOccurrenceId
    ) {
      throw new CoreError(
        "validation.failed",
        "Native forward explicit occurrence must be the exact source occurrence."
      );
    }
    return Object.freeze({
      kind: "forward_provider_native",
      ...base,
      source,
      routeIntent
    });
  }
  throw new CoreError("validation.failed", "Reference command is invalid.");
}

function normalizeSource(input: InboxV2OutboundReferenceSource) {
  if (
    typeof input !== "object" ||
    input === null ||
    !hasOnlyKeys(input, [
      "conversationId",
      "messageId",
      "expectedMessageRevision"
    ])
  ) {
    throw new CoreError("validation.failed", "Reference source is invalid.");
  }
  return Object.freeze({
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    messageId: inboxV2MessageIdSchema.parse(input.messageId),
    expectedMessageRevision: inboxV2EntityRevisionSchema.parse(
      input.expectedMessageRevision
    )
  });
}

function normalizeRouteIntent(
  input: InboxV2OutboundReferenceRouteIntent,
  allowOccurrence: false
): Exclude<
  InboxV2OutboundReferenceRouteIntent,
  { kind: "explicit_occurrence" }
>;
function normalizeRouteIntent(
  input: InboxV2OutboundReferenceRouteIntent,
  allowOccurrence: true
): InboxV2OutboundReferenceRouteIntent;
function normalizeRouteIntent(
  input: InboxV2OutboundReferenceRouteIntent,
  allowOccurrence: boolean
): InboxV2OutboundReferenceRouteIntent {
  if (typeof input !== "object" || input === null || !("kind" in input)) {
    throw new CoreError("validation.failed", "Route intent is invalid.");
  }
  if (input.kind === "automatic" && hasOnlyKeys(input, ["kind"])) {
    return Object.freeze({ kind: "automatic" });
  }
  if (
    input.kind === "explicit_binding" &&
    hasOnlyKeys(input, ["kind", "bindingId"])
  ) {
    return Object.freeze({
      kind: "explicit_binding",
      bindingId: inboxV2SourceThreadBindingIdSchema.parse(input.bindingId)
    });
  }
  if (
    allowOccurrence &&
    input.kind === "explicit_occurrence" &&
    hasOnlyKeys(input, ["kind", "occurrenceId"])
  ) {
    return Object.freeze({
      kind: "explicit_occurrence",
      occurrenceId: inboxV2SourceOccurrenceIdSchema.parse(input.occurrenceId)
    });
  }
  throw new CoreError("validation.failed", "Route intent is invalid.");
}

function outboundRoutePrincipalsMatch(
  left: InboxV2OutboundRoutePrincipal,
  right: InboxV2OutboundRoutePrincipal
): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "employee" && right.kind === "employee"
    ? left.employee.tenantId === right.employee.tenantId &&
        left.employee.id === right.employee.id
    : left.kind === "trusted_service" &&
        right.kind === "trusted_service" &&
        left.trustedServiceId === right.trustedServiceId;
}

function sameEntity(
  left: { tenantId: string; entityTypeId: string; entityId: string },
  right: { tenantId: string; entityTypeId: string; entityId: string }
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.entityTypeId === right.entityTypeId &&
    String(left.entityId) === String(right.entityId)
  );
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  return (
    actual.length === allowed.size && actual.every((key) => allowed.has(key))
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
