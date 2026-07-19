import {
  calculateInboxV2CanonicalSha256,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizedCommandSchema,
  inboxV2CatalogIdSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2InternalOpaqueReferenceSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2OutboundDispatchIdSchema,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2OutboundDispatchRerouteCommitSchema,
  inboxV2OutboundRouteIdSchema,
  inboxV2OutboundRoutePrincipalSchema,
  inboxV2OutboundRouteResolutionCommitSchema,
  inboxV2RoutingTokenSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineContentDraftSchema,
  resolveInboxV2OutboundRoute,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2AuthorizedCommand,
  type InboxV2MessageCreationCommit,
  type InboxV2OutboundDispatchRerouteCommit,
  type InboxV2OutboundDispatchContentPlan,
  type InboxV2OutboundRouteResolutionCommit,
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
  type InboxV2AuthorizedAtomicMaterializationCoordinator,
  type InboxV2AuthorizedCommandMutationResult,
  type InboxV2PrivilegedAuthorizationMutationReplayStatus,
  type WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";

import {
  inboxV2OutboundDispatchContentPlanMatches,
  materializeInboxV2OutboundMessage,
  type InboxV2OutboundMessageMaterializationFingerprintAuthority,
  type InboxV2OutboundMessageMaterializationPersistence
} from "./inbox-v2-outbound-message-materialization";

export type InboxV2OutboundSendRouteIntent =
  | Readonly<{ kind: "automatic" }>
  | Readonly<{
      kind: "explicit_binding";
      bindingId: string;
    }>
  | Readonly<{
      kind: "explicit_reroute";
      originalRouteId: string;
      originalDispatchId: string;
      expectedOriginalDispatchRevision: string;
      replacementBindingId: string;
      reasonId: string;
    }>;

/** Server-authenticated request scope; never populated from the command body. */
export type InboxV2OutboundSendRequestScope = Readonly<{
  tenantId: string;
  principal: InboxV2OutboundRoutePrincipal;
}>;

export type InboxV2OutboundSendIdempotencyScope = Readonly<{
  tenantId: string;
  principal: InboxV2OutboundRoutePrincipal;
  commandTypeId: "core:message.send" | "core:source.dispatch.reroute";
  clientMutationId: string;
  publicResultCode: "core:message.queued";
}>;

type InboxV2OutboundSendContentDraft = Extract<
  InboxV2TimelineCommandIntent,
  { kind: "send_external" }
>["content"];

/**
 * Deliberately narrow caller boundary. Provider account, opaque descriptor,
 * binding fence, authorization decisions and generated IDs are server-owned.
 */
export type InboxV2OutboundSendCommand = Readonly<{
  tenantId: string;
  conversationId: string;
  content: InboxV2OutboundSendContentDraft;
  routeIntent: InboxV2OutboundSendRouteIntent;
  clientMutationId: string;
}>;

export type InboxV2PreparedOutboundSendCommand =
  | Readonly<{
      /** Checked before current route discovery, so replay survives route drift. */
      kind: "committed_replay";
      requestHash: string;
      scope: InboxV2OutboundSendIdempotencyScope;
      status: InboxV2PrivilegedAuthorizationMutationReplayStatus;
    }>
  | Readonly<{
      /** Same authenticated idempotency scope, but a different request hash. */
      kind: "idempotency_conflict";
      scope: InboxV2OutboundSendIdempotencyScope;
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
      supplementalRerouteAuthorizationDecisionRefs?: readonly InboxV2AuthorizationDecisionReference[];
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      routeResolution: InboxV2OutboundRouteResolutionCommit;
      messageCreation: InboxV2MessageCreationCommit;
      dispatchContentPlan: InboxV2OutboundDispatchContentPlan;
      rerouteCommit?: InboxV2OutboundDispatchRerouteCommit;
    }>;

export type InboxV2OutboundSendCommandPreparer = Readonly<{
  /**
   * Performs only the authenticated committed-mutation lookup. The service
   * always invokes this boundary before any current route discovery.
   */
  lookupIdempotency(
    command: InboxV2OutboundSendCommand
  ): Promise<Extract<
    InboxV2PreparedOutboundSendCommand,
    { kind: "committed_replay" | "idempotency_conflict" }
  > | null>;
  /**
   * Loads one bounded current policy/candidate snapshot and all RBAC/relation
   * evidence only after the idempotency lookup proves the command is new.
   * Implementations must never accept provider/account/fence facts from the
   * caller and must cap candidate discovery before authorization.
   */
  prepareNew(
    command: InboxV2OutboundSendCommand
  ): Promise<Extract<
    InboxV2PreparedOutboundSendCommand,
    { kind: "route_rejected" | "selected" }
  > | null>;
}>;

/**
 * Server-only verification boundary for a prepared content fingerprint. The
 * implementation must resolve the tenant/purpose/generation key from trusted
 * lifecycle authority, verify the HMAC over every supplied field (including
 * the fingerprint expiry), and reject generations that were not authorized at
 * `planCreatedAt` or are no longer verifiable at `at`.
 */
export type InboxV2OutboundDispatchContentFingerprintAuthority =
  InboxV2OutboundMessageMaterializationFingerprintAuthority;

type AtomicSendResult = Readonly<{
  messageId: string;
  outboundRouteId: string;
  outboundDispatchId: string;
}>;

type AtomicSendFailure = Exclude<
  InboxV2AuthorizedCommandMutationResult<AtomicSendResult>,
  { kind: "applied" | "already_applied" }
>;

export type InboxV2OutboundSendCommandResult =
  | Readonly<{
      outcome: "queued";
      messageId: string;
      outboundRouteId: string;
      outboundDispatchId: string;
      commit: Extract<
        InboxV2AuthorizedCommandMutationResult<AtomicSendResult>,
        { kind: "applied" }
      >["status"];
    }>
  | Readonly<{
      outcome: "already_queued";
      messageId: string;
      commit: Extract<
        InboxV2AuthorizedCommandMutationResult<AtomicSendResult>,
        { kind: "already_applied" }
      >["status"];
    }>
  | Readonly<{ outcome: "idempotency_conflict" }>
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{ outcome: "denied"; errorCode: string }>
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
      conflict: AtomicSendFailure;
    }>;

type OutboundSendPersistence = InboxV2OutboundMessageMaterializationPersistence;

export type InboxV2OutboundSendCommandServiceOptions = Readonly<{
  requestScope: InboxV2OutboundSendRequestScope;
  preparer: InboxV2OutboundSendCommandPreparer;
  /** Mandatory server-side HMAC/key-lifecycle verification before any write. */
  contentFingerprintAuthority: InboxV2OutboundDispatchContentFingerprintAuthority;
  /** Trusted current-time source used for the finite fingerprint fence. */
  currentTime: () => string;
  denialSink: InboxV2SecurityDenialSink;
  coordinator: InboxV2AuthorizedAtomicMaterializationCoordinator;
  /** Test seam; production uses the non-forgeable DB materialization APIs. */
  persistence?: OutboundSendPersistence;
  /** Test seam; production always uses the core authorization gate. */
  authorizationGate?: typeof executeInboxV2AuthorizationGate;
}>;

export type InboxV2OutboundSendCommandService = Readonly<{
  send(
    command: InboxV2OutboundSendCommand
  ): Promise<InboxV2OutboundSendCommandResult>;
}>;

/**
 * Executes normal outbound send without provider I/O. One immutable route,
 * Message, queued dispatch and provider outbox intent are sealed by the same
 * authorized transaction; provider execution starts only after commit.
 */
export function createInboxV2OutboundSendCommandService(
  options: InboxV2OutboundSendCommandServiceOptions
): InboxV2OutboundSendCommandService {
  const requestScope = normalizeRequestScope(options.requestScope);
  const authorizationGate =
    options.authorizationGate ?? executeInboxV2AuthorizationGate;

  return Object.freeze({
    async send(commandInput) {
      const command = normalizeOutboundSendCommand(commandInput);
      if (command.tenantId !== requestScope.tenantId) {
        throw new CoreError("permission.denied");
      }
      const idempotency = await options.preparer.lookupIdempotency(command);
      if (idempotency?.kind === "committed_replay") {
        if (
          !idempotencyScopeMatches(requestScope, command, idempotency.scope) ||
          idempotency.status.publicResultCode !== "core:message.queued" ||
          idempotency.requestHash !==
            calculateInboxV2OutboundSendIntentDigest(command)
        ) {
          throw new CoreError("permission.denied");
        }
        return {
          outcome: "already_queued",
          messageId: replayedMessageId(idempotency.status, command.tenantId),
          commit: idempotency.status
        };
      }
      if (idempotency?.kind === "idempotency_conflict") {
        if (
          !idempotencyScopeMatches(requestScope, command, idempotency.scope)
        ) {
          throw new CoreError("permission.denied");
        }
        return { outcome: "idempotency_conflict" };
      }

      const prepared = await options.preparer.prepareNew(command);
      if (prepared === null) return { outcome: "not_found" };

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

      const closed = assertSelectedSendClosure(command, requestScope, prepared);
      const materialized = await materializeInboxV2OutboundMessage(
        {
          tenantId: command.tenantId,
          conversationId: command.conversationId,
          requiredConversationPermissionId: "core:message.reply_external",
          replyAuthority: closed.replyAuthority,
          authorizationPlan: prepared.authorizationPlan,
          denialContext: prepared.denialContext,
          authorizedMutation: prepared.authorizedMutation,
          routeResolution: closed.routeResolution,
          messageCreation: closed.messageCreation,
          dispatchContentPlan: closed.dispatchContentPlan,
          rerouteCommit: closed.rerouteCommit
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

export function calculateInboxV2OutboundSendIntentDigest(
  commandInput: InboxV2OutboundSendCommand
): string {
  const command = normalizeOutboundSendCommand(commandInput);
  return calculateInboxV2CanonicalSha256({
    protocol: "core:inbox-v2.outbound-send-command@v1",
    tenantId: command.tenantId,
    conversationId: command.conversationId,
    content: command.content,
    routeIntent: command.routeIntent,
    clientMutationId: command.clientMutationId
  });
}

/**
 * Derives the opaque route-level idempotency token from the complete
 * authenticated command scope. The raw client mutation ID remains the
 * command-level idempotency key and is never used as a tenant-wide route key.
 */
export function calculateInboxV2OutboundRouteIdempotencyToken(
  requestScopeInput: InboxV2OutboundSendRequestScope,
  commandInput: InboxV2OutboundSendCommand
): string {
  const requestScope = normalizeRequestScope(requestScopeInput);
  const command = normalizeOutboundSendCommand(commandInput);
  if (command.tenantId !== requestScope.tenantId) {
    throw new CoreError("permission.denied");
  }
  return inboxV2RoutingTokenSchema.parse(
    calculateInboxV2CanonicalSha256({
      protocol: "core:inbox-v2.outbound-route-idempotency@v1",
      tenantId: requestScope.tenantId,
      principal: requestScope.principal,
      commandTypeId: outboundSendMutationCommandType(command.routeIntent),
      clientMutationId: command.clientMutationId
    })
  );
}

function assertRejectedRouteClosure(
  command: InboxV2OutboundSendCommand,
  requestScope: InboxV2OutboundSendRequestScope,
  prepared: Extract<
    InboxV2PreparedOutboundSendCommand,
    { kind: "route_rejected" }
  >
) {
  const routeResolution = inboxV2OutboundRouteResolutionCommitSchema.parse(
    prepared.routeResolution
  );
  if (
    routeResolution.result.kind !== "failed" ||
    routeResolution.route !== null ||
    !routeInputMatchesCommand(command, requestScope, routeResolution) ||
    !rejectedRouteAuthorizationContextMatches(
      requestScope,
      prepared.disclosureAuthorizationPlan,
      routeResolution
    ) ||
    !routeDisclosureAuthorizationMatches(
      prepared.disclosureAuthorizationPlan,
      requestScope,
      command
    )
  ) {
    throw new CoreError("permission.denied");
  }
  return routeResolution as typeof routeResolution & {
    result: Extract<typeof routeResolution.result, { kind: "failed" }>;
  };
}

function assertSelectedSendClosure(
  command: InboxV2OutboundSendCommand,
  requestScope: InboxV2OutboundSendRequestScope,
  prepared: Extract<InboxV2PreparedOutboundSendCommand, { kind: "selected" }>
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
  const rerouteCommit =
    prepared.rerouteCommit === undefined
      ? null
      : inboxV2OutboundDispatchRerouteCommitSchema.parse(
          prepared.rerouteCommit
        );
  const authorizedCommand = inboxV2AuthorizedCommandSchema.parse(
    prepared.authorizedCommand
  );
  const supplementalRerouteAuthorizationDecisionRefs = (
    prepared.supplementalRerouteAuthorizationDecisionRefs ?? []
  ).map((decision) =>
    inboxV2AuthorizationDecisionReferenceSchema.parse(decision)
  );
  const routeResult = resolveInboxV2OutboundRoute(routeResolution.input);
  const route = routeResolution.route;
  const dispatch = messageCreation.outboundDispatch;
  const intent = authorizedCommand.intent.payload;
  const mutation = prepared.authorizedMutation;
  const expectedRequestHash = calculateInboxV2OutboundSendIntentDigest(command);

  if (
    routeResult.kind !== "selected" ||
    routeResolution.result.kind !== "selected" ||
    route === null ||
    dispatch === null ||
    intent.kind !== "send_external" ||
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
    messageCreation.message.referenceContext.kind !== "none" ||
    messageCreation.message.origin.kind !== "hulee_external" ||
    messageCreation.message.origin.outboundRoute.id !== route.id ||
    dispatch.route.id !== route.id ||
    dispatch.message.id !== messageCreation.message.id ||
    dispatch.multiSendOperation !== null ||
    dispatch.state !== "queued" ||
    dispatch.attemptCount !== 0 ||
    intent.replyAuthority === undefined ||
    !sameValue(
      messageCreation.content.state.kind === "available"
        ? messageCreation.content.state.blocks
        : null,
      command.content.blocks
    ) ||
    intent.tenantId !== command.tenantId ||
    intent.conversation.id !== command.conversationId ||
    !sameValue(intent.content, command.content) ||
    intent.referenceContext.kind !== "none" ||
    intent.outboundRoute.id !== route.id ||
    !timelineRouteProofMatches(intent.routeAuthorization, route) ||
    !messageActorMatchesAuthorizedCommand(messageCreation, authorizedCommand) ||
    mutation.tenantId !== command.tenantId ||
    mutation.command.commandTypeId !==
      outboundSendMutationCommandType(command.routeIntent) ||
    mutation.command.clientMutationId !== command.clientMutationId ||
    mutation.command.requestHash !== expectedRequestHash ||
    authorizedCommand.request.requestHash !== expectedRequestHash ||
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
    !rerouteCommitMatchesSelectedSend(
      command.routeIntent,
      routeResolution,
      messageCreation,
      rerouteCommit
    ) ||
    !authorizationClosureMatches(
      prepared.authorizationPlan,
      authorizedCommand,
      supplementalRerouteAuthorizationDecisionRefs,
      mutation,
      route,
      dispatch,
      rerouteCommit,
      command.routeIntent,
      requestScope
    ) ||
    !atomicProviderClosureMatches(
      mutation,
      messageCreation,
      rerouteCommit,
      command.routeIntent
    )
  ) {
    throw new CoreError("permission.denied");
  }

  return {
    routeResolution,
    messageCreation,
    route,
    dispatch,
    dispatchContentPlan,
    rerouteCommit,
    replyAuthority: intent.replyAuthority
  };
}

function rerouteCommitMatchesSelectedSend(
  routeIntent: InboxV2OutboundSendRouteIntent,
  routeResolution: InboxV2OutboundRouteResolutionCommit,
  messageCreation: InboxV2MessageCreationCommit,
  reroute: InboxV2OutboundDispatchRerouteCommit | null
): boolean {
  if (routeIntent.kind !== "explicit_reroute") return reroute === null;
  const selectedIntent = routeResolution.input.intent;
  const route = routeResolution.route;
  const dispatch = messageCreation.outboundDispatch;
  if (
    reroute === null ||
    selectedIntent.kind !== "explicit_reroute" ||
    route === null ||
    dispatch === null
  ) {
    return false;
  }
  return (
    reroute.tenantId === route.tenantId &&
    String(reroute.original.dispatchBefore.id) ===
      routeIntent.originalDispatchId &&
    String(reroute.original.dispatchBefore.route.id) ===
      routeIntent.originalRouteId &&
    reroute.original.dispatchBefore.revision ===
      routeIntent.expectedOriginalDispatchRevision &&
    String(selectedIntent.originalDispatch.id) ===
      routeIntent.originalDispatchId &&
    selectedIntent.expectedOriginalDispatchRevision ===
      routeIntent.expectedOriginalDispatchRevision &&
    String(reroute.replacement.message.id) ===
      String(messageCreation.message.id) &&
    String(reroute.replacement.route.id) === String(route.id) &&
    String(reroute.replacement.dispatch.id) === String(dispatch.id) &&
    reroute.reasonId === routeIntent.reasonId &&
    reroute.changedAt === route.selection.selectedAt
  );
}

function routeInputMatchesCommand(
  command: InboxV2OutboundSendCommand,
  requestScope: InboxV2OutboundSendRequestScope,
  resolution: InboxV2OutboundRouteResolutionCommit
): boolean {
  const input = resolution.input;
  return (
    input.tenantId === command.tenantId &&
    input.conversation.id === command.conversationId &&
    input.operationId === "core:message.send" &&
    input.routePolicy.requiredConversationPermissionId ===
      "core:message.reply_external" &&
    input.referenceContext.kind === "none" &&
    input.idempotencyToken ===
      calculateInboxV2OutboundRouteIdempotencyToken(requestScope, command) &&
    routeIntentMatches(command.routeIntent, input.intent)
  );
}

function rejectedRouteAuthorizationContextMatches(
  requestScope: InboxV2OutboundSendRequestScope,
  plan: InboxV2AuthorizationPlanInput,
  resolution: InboxV2OutboundRouteResolutionCommit
): boolean {
  return (
    resolution.input.tenantId === requestScope.tenantId &&
    resolution.input.authorizationEpoch ===
      plan.currentAuthorization.authorizationEpoch &&
    sameValue(resolution.input.principal, requestScope.principal)
  );
}

function routeIntentMatches(
  commandIntent: InboxV2OutboundSendRouteIntent,
  preparedIntent: InboxV2OutboundRouteResolutionCommit["input"]["intent"]
): boolean {
  if (commandIntent.kind !== preparedIntent.kind) return false;
  if (commandIntent.kind === "automatic") return true;
  if (
    commandIntent.kind === "explicit_binding" &&
    preparedIntent.kind === "explicit_binding"
  ) {
    return commandIntent.bindingId === preparedIntent.binding.id;
  }
  return (
    commandIntent.kind === "explicit_reroute" &&
    preparedIntent.kind === "explicit_reroute" &&
    commandIntent.originalRouteId === preparedIntent.originalRoute.id &&
    commandIntent.originalDispatchId === preparedIntent.originalDispatch.id &&
    commandIntent.expectedOriginalDispatchRevision ===
      preparedIntent.expectedOriginalDispatchRevision &&
    commandIntent.replacementBindingId ===
      preparedIntent.replacementBinding.id &&
    commandIntent.reasonId === preparedIntent.reasonId
  );
}

function timelineRouteProofMatches(
  proof: Extract<
    InboxV2AuthorizedCommand["intent"]["payload"],
    { kind: "send_external" }
  >["routeAuthorization"],
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

function messageActorMatchesAuthorizedCommand(
  messageCreation: InboxV2MessageCreationCommit,
  command: InboxV2AuthorizedCommand
): boolean {
  const actor = messageCreation.message.appActor;
  if (actor === null || actor.kind !== command.principal.kind) return false;
  if (actor.kind === "employee" && command.principal.kind === "employee") {
    return (
      actor.employee.id === command.principal.employee.id &&
      actor.authorizationEpoch === command.principal.authorization.value &&
      messageCreation.authorParticipant.subject.kind === "employee" &&
      messageCreation.authorParticipant.subject.employee.id ===
        command.principal.employee.id
    );
  }
  return (
    actor.kind === "trusted_service" &&
    command.principal.kind === "trusted_service" &&
    actor.trustedServiceId === command.principal.trustedServiceId
  );
}

function authorizationClosureMatches(
  plan: InboxV2AuthorizationPlanInput,
  command: InboxV2AuthorizedCommand,
  supplementalRerouteAuthorizationDecisionRefs: readonly InboxV2AuthorizationDecisionReference[],
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>,
  dispatch: NonNullable<InboxV2MessageCreationCommit["outboundDispatch"]>,
  rerouteCommit: InboxV2OutboundDispatchRerouteCommit | null,
  routeIntent: InboxV2OutboundSendRouteIntent,
  requestScope: InboxV2OutboundSendRequestScope
): boolean {
  const decisions = effectiveAuthorizationDecisionRefs(
    command,
    supplementalRerouteAuthorizationDecisionRefs,
    route,
    routeIntent
  );
  if (decisions === null) return false;
  const auditDecisions = mutation.records.audit.authorizationDecisionRefs.map(
    (decision) => inboxV2AuthorizationDecisionReferenceSchema.parse(decision)
  );
  const replyDecision = decisions.find(
    (decision) =>
      decision.permissionId === "core:message.reply_external" &&
      decision.resource.entityTypeId === "core:conversation" &&
      String(decision.resource.entityId) === String(route.conversation.id)
  );
  const readDecision = decisions.find(
    (decision) =>
      decision.permissionId === "core:conversation.read" &&
      decision.resource.entityTypeId === "core:conversation" &&
      String(decision.resource.entityId) === String(route.conversation.id)
  );
  const sourceDecision = decisions.find(
    (decision) =>
      decision.permissionId === "core:source_account.use" &&
      decision.resource.entityTypeId === "core:source-account" &&
      String(decision.resource.entityId) === String(route.sourceAccount.id)
  );
  const replyRequirement = plan.requirements.find(
    (requirement) =>
      requirement.permissionId === "core:message.reply_external" &&
      requirement.resource.entityTypeId === "core:conversation" &&
      String(requirement.resource.entityId) === String(route.conversation.id)
  );
  const guard = replyRequirement?.guard;

  return (
    plan.tenantId === route.tenantId &&
    plan.currentAuthorization.tenantId === route.tenantId &&
    plan.currentAuthorization.authorizationEpoch === route.authorizationEpoch &&
    samePrincipal(plan, command, mutation, requestScope) &&
    replyDecision !== undefined &&
    readDecision !== undefined &&
    sourceDecision !== undefined &&
    mutation.command.authorizationDecisionId ===
      (routeIntent.kind === "explicit_reroute"
        ? decisions.find(
            (decision) =>
              decision.permissionId === "core:source.dispatch.reroute"
          )?.id
        : replyDecision.id) &&
    sameDecisionReferenceMultiset(decisions, auditDecisions) &&
    exactCanonicalCatalogValues(
      mutation.records.audit.matchedPermissionIds,
      decisions.map((decision) => decision.permissionId)
    ) &&
    exactCanonicalCatalogValues(
      mutation.records.audit.authorizationScopeIds,
      decisions.map((decision) => decision.resourceScopeId)
    ) &&
    authorizationRequirementsMatchDecisions(plan.requirements, decisions) &&
    guard?.profileId === "core:rbac.guard.external_route" &&
    guard.authorizationMode === "operation" &&
    guard.operation.kind === "reply" &&
    guard.operation.mode === "new_response" &&
    sameEntity(guard.conversationResource, {
      tenantId: route.tenantId,
      entityTypeId: "core:conversation",
      entityId: route.conversation.id
    }) &&
    String(guard.bindingResource.entityId) ===
      String(route.sourceThreadBinding.id) &&
    String(guard.externalThreadResource.entityId) ===
      String(route.externalThread.id) &&
    String(guard.bindingSourceAccountResource.entityId) ===
      String(route.sourceAccount.id) &&
    String(guard.sourceAccountId) === String(route.sourceAccount.id) &&
    String(guard.bindingSourceAccountId) === String(route.sourceAccount.id) &&
    guard.bindingGeneration === route.bindingFence.bindingGeneration &&
    guard.expectedBindingGeneration === route.bindingFence.bindingGeneration &&
    guard.bindingState === "active" &&
    guard.capabilityState === "supported" &&
    guard.routeFallbackRequested === false &&
    externalReplyAuthorityMatchesGuard(
      command.intent.payload.kind === "send_external"
        ? command.intent.payload.replyAuthority
        : undefined,
      guard
    ) &&
    rerouteAuthorizationClosureMatches({
      plan,
      decisions,
      mutation,
      route,
      dispatch,
      rerouteCommit,
      routeIntent
    })
  );
}

function effectiveAuthorizationDecisionRefs(
  command: InboxV2AuthorizedCommand,
  supplementalDecisions: readonly InboxV2AuthorizationDecisionReference[],
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>,
  routeIntent: InboxV2OutboundSendRouteIntent
): readonly InboxV2AuthorizationDecisionReference[] | null {
  const commandDecisions = command.authorizationDecisionRefs;
  if (routeIntent.kind !== "explicit_reroute") {
    return supplementalDecisions.length === 0 ? commandDecisions : null;
  }

  if (
    supplementalDecisions.length !== 2 ||
    supplementalDecisions.filter(
      (decision) => decision.permissionId === "core:source_account.use"
    ).length !== 1 ||
    supplementalDecisions.filter(
      (decision) => decision.permissionId === "core:source.dispatch.reroute"
    ).length !== 1 ||
    !supplementalRerouteDecisionRefsAreValid(
      supplementalDecisions,
      command,
      route
    )
  ) {
    return null;
  }

  const decisions = [...commandDecisions, ...supplementalDecisions];
  if (
    new Set(decisions.map((decision) => decision.id)).size !== decisions.length
  ) {
    return null;
  }
  return decisions.sort((left, right) =>
    compareCanonicalStrings(String(left.id), String(right.id))
  );
}

function supplementalRerouteDecisionRefsAreValid(
  decisions: readonly InboxV2AuthorizationDecisionReference[],
  command: InboxV2AuthorizedCommand,
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>
): boolean {
  const sourceUseDecision = decisions.find(
    (decision) => decision.permissionId === "core:source_account.use"
  );
  const rerouteDecision = decisions.find(
    (decision) => decision.permissionId === "core:source.dispatch.reroute"
  );
  if (sourceUseDecision === undefined || rerouteDecision === undefined) {
    return false;
  }

  const authorizedAt = Date.parse(command.authorizedAt);
  const selectedAt = Date.parse(route.selection.selectedAt);
  return (
    decisions.every((decision) => {
      const decidedAt = Date.parse(decision.decidedAt);
      const notAfter = Date.parse(decision.notAfter);
      return (
        decision.tenantId === route.tenantId &&
        decision.authorizationEpoch === route.authorizationEpoch &&
        decision.outcome === "allowed" &&
        decision.resourceScopeId === "core:source-account" &&
        decision.resource.tenantId === route.tenantId &&
        decision.resource.entityTypeId === "core:source-account" &&
        authorizationDecisionPrincipalMatchesCommand(decision, command) &&
        Number.isFinite(decidedAt) &&
        Number.isFinite(notAfter) &&
        decidedAt <= authorizedAt &&
        decidedAt <= selectedAt &&
        authorizedAt < notAfter &&
        selectedAt < notAfter
      );
    }) && sameEntity(sourceUseDecision.resource, rerouteDecision.resource)
  );
}

function authorizationDecisionPrincipalMatchesCommand(
  decision: InboxV2AuthorizationDecisionReference,
  command: InboxV2AuthorizedCommand
): boolean {
  if (decision.principal.kind !== command.principal.kind) return false;
  return decision.principal.kind === "employee" &&
    command.principal.kind === "employee"
    ? decision.principal.employee.id === command.principal.employee.id &&
        decision.principal.employee.tenantId ===
          command.principal.employee.tenantId
    : decision.principal.kind === "trusted_service" &&
        command.principal.kind === "trusted_service" &&
        decision.principal.trustedServiceId ===
          command.principal.trustedServiceId;
}

function compareCanonicalStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function exactCanonicalCatalogValues(
  actual: readonly string[],
  expectedValues: readonly string[]
): boolean {
  const expected = [...new Set(expectedValues)].sort(compareCanonicalStrings);
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
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

function externalReplyAuthorityMatchesGuard(
  authority: Extract<
    InboxV2AuthorizedCommand["intent"]["payload"],
    { kind: "send_external" }
  >["replyAuthority"],
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
    case "no_work_item": {
      const absence = guard.workAbsenceProof;
      return (
        guard.workItemId === null &&
        guard.workState === "no_work_non_actionable" &&
        absence !== null &&
        absence.resource.tenantId === authority.conversation.tenantId &&
        absence.resource.entityTypeId === "core:conversation-work-head" &&
        sameEntity(absence.conversationResource, {
          tenantId: authority.conversation.tenantId,
          entityTypeId: "core:conversation",
          entityId: authority.conversation.id
        }) &&
        absence.workItemCount === 0 &&
        absence.expectedHighWater === authority.intakeDecisionRevision &&
        absence.currentHighWater === authority.intakeDecisionRevision &&
        absence.revisionChecks.some(
          (revision) =>
            revision.kind === "state" && revision.expected === revision.actual
        )
      );
    }
  }
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

function rerouteAuthorizationClosureMatches(
  input: Readonly<{
    plan: InboxV2AuthorizationPlanInput;
    decisions: readonly InboxV2AuthorizationDecisionReference[];
    mutation: WithInboxV2AuthorizedCommandMutationInput;
    route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>;
    dispatch: NonNullable<InboxV2MessageCreationCommit["outboundDispatch"]>;
    rerouteCommit: InboxV2OutboundDispatchRerouteCommit | null;
    routeIntent: InboxV2OutboundSendRouteIntent;
  }>
): boolean {
  const rerouteRequirements = input.plan.requirements.filter(
    (requirement) => requirement.permissionId === "core:source.dispatch.reroute"
  );
  const rerouteDecisions = input.decisions.filter(
    (decision) => decision.permissionId === "core:source.dispatch.reroute"
  );
  if (input.routeIntent.kind !== "explicit_reroute") {
    return (
      input.rerouteCommit === null &&
      rerouteRequirements.length === 0 &&
      rerouteDecisions.length === 0
    );
  }

  const selectionIntent = input.route.selection.intent;
  const rerouteRequirement = rerouteRequirements[0];
  const reroute = input.rerouteCommit;
  if (
    reroute === null ||
    selectionIntent.kind !== "explicit_reroute" ||
    rerouteRequirements.length !== 1 ||
    rerouteDecisions.length !== 1 ||
    rerouteRequirement === undefined ||
    !decisionMatchesRequirement(rerouteDecisions[0]!, rerouteRequirement) ||
    rerouteRequirement.guard.profileId !==
      "core:rbac.guard.source_account_route" ||
    rerouteRequirement.guard.operation.kind !== "reroute_dispatch"
  ) {
    return false;
  }

  const guard = rerouteRequirement.guard as InboxV2SourceAccountRouteGuard;
  const operation = guard.operation as InboxV2RerouteOperation;
  const originalSourceRequirements = input.plan.requirements.filter(
    (requirement) => requirement.id === operation.originalSourceRequirementId
  );
  const newSourceRequirements = input.plan.requirements.filter(
    (requirement) => requirement.id === operation.newSourceRequirementId
  );
  const originalSourceRequirement = originalSourceRequirements[0];
  const newSourceRequirement = newSourceRequirements[0];
  const originalRoute = operation.originalRoute;
  const newRoute = operation.newRoute;

  if (
    operation.originalSourceRequirementId ===
      operation.newSourceRequirementId ||
    originalSourceRequirements.length !== 1 ||
    newSourceRequirements.length !== 1 ||
    originalSourceRequirement === undefined ||
    newSourceRequirement === undefined ||
    !sourceUseRequirementMatches(
      originalSourceRequirement,
      originalRoute.sourceAccountResource,
      originalRoute.bindingResource
    ) ||
    !sourceUseRequirementMatches(
      newSourceRequirement,
      newRoute.sourceAccountResource,
      newRoute.bindingResource
    ) ||
    String(operation.dispatch.resource.entityId) !==
      String(reroute.original.dispatchBefore.id) ||
    operation.dispatch.resource.entityTypeId !== "core:outbound-dispatch" ||
    !sameEntity(
      operation.dispatch.originalRouteResource,
      originalRoute.resource
    ) ||
    !sameEntity(operation.dispatch.requestedRouteResource, newRoute.resource) ||
    String(originalRoute.resource.entityId) !==
      input.routeIntent.originalRouteId ||
    String(selectionIntent.originalRoute.id) !==
      input.routeIntent.originalRouteId ||
    String(selectionIntent.originalDispatch.id) !==
      input.routeIntent.originalDispatchId ||
    selectionIntent.expectedOriginalDispatchRevision !==
      input.routeIntent.expectedOriginalDispatchRevision ||
    String(reroute.original.dispatchBefore.id) !==
      input.routeIntent.originalDispatchId ||
    reroute.original.dispatchBefore.revision !==
      input.routeIntent.expectedOriginalDispatchRevision ||
    reroute.original.dispatchAfter.state !== "cancelled" ||
    reroute.original.dispatchAfter.revision !== "2" ||
    String(reroute.replacement.message.id) !==
      String(input.mutation.command.resultReference?.recordId) ||
    String(reroute.replacement.route.id) !== String(input.route.id) ||
    String(reroute.replacement.dispatch.id) !== String(input.dispatch.id) ||
    reroute.reasonId !== input.routeIntent.reasonId ||
    reroute.changedAt !== input.mutation.occurredAt ||
    String(newRoute.resource.entityId) !== String(input.route.id) ||
    !sameEntity(newRoute.conversationResource, {
      tenantId: input.route.tenantId,
      entityTypeId: "core:conversation",
      entityId: input.route.conversation.id
    }) ||
    !sameEntity(newRoute.externalThreadResource, {
      tenantId: input.route.tenantId,
      entityTypeId: "core:external-thread",
      entityId: input.route.externalThread.id
    }) ||
    String(newRoute.bindingResource.entityId) !==
      String(input.route.sourceThreadBinding.id) ||
    String(newRoute.sourceAccountResource.entityId) !==
      String(input.route.sourceAccount.id) ||
    sameEntity(originalRoute.resource, newRoute.resource) ||
    sameEntity(originalRoute.bindingResource, newRoute.bindingResource) ||
    operation.dispatch.state !== "before_provider_io" ||
    operation.dispatchState !== "before_provider_io" ||
    operation.dispatch.expectedStateRevision !== "1" ||
    operation.dispatch.currentStateRevision !== "1" ||
    operation.dispatch.expectedStateRevision !==
      input.routeIntent.expectedOriginalDispatchRevision ||
    !operation.originalRouteHistoryRecorded ||
    operation.reason !== input.routeIntent.reasonId ||
    operation.auditEventId !== input.mutation.records.audit.id ||
    input.mutation.records.audit.actionId !== "core:source.dispatch.reroute" ||
    input.mutation.records.audit.reasonCodeId !== input.routeIntent.reasonId ||
    input.mutation.records.audit.target.entityTypeId !==
      "core:outbound-dispatch" ||
    !inboxV2InternalOpaqueReferenceSchema.safeParse(
      input.mutation.records.audit.target.entityId
    ).success ||
    !sameValue(
      input.mutation.records.audit.evidenceReference,
      rerouteCommitReference(reroute)
    ) ||
    !input.mutation.records.audit.matchedPermissionIds.includes(
      "core:source.dispatch.reroute"
    ) ||
    !input.mutation.records.audit.matchedPermissionIds.includes(
      "core:source_account.use"
    ) ||
    !rerouteCapabilityManifestMatches(
      operation.originalCapabilityManifest,
      originalRoute.sourceAccountResource,
      originalRoute.bindingResource,
      originalRoute.resource
    ) ||
    !rerouteCapabilityManifestMatches(
      operation.newCapabilityManifest,
      newRoute.sourceAccountResource,
      newRoute.bindingResource,
      newRoute.resource
    )
  ) {
    return false;
  }

  const sourceUseDecisions = input.decisions.filter(
    (decision) => decision.permissionId === "core:source_account.use"
  );
  return sourceUseDecisions.length === 2;
}

function decisionMatchesRequirement(
  decision: InboxV2AuthorizationDecisionReference,
  requirement: InboxV2AuthorizationPlanInput["requirements"][number]
): boolean {
  return (
    decision.permissionId === requirement.permissionId &&
    sameEntity(decision.resource, requirement.resource) &&
    decision.resourceAccessRevision === requirement.resourceAccessRevision
  );
}

function sourceUseRequirementMatches(
  requirement: InboxV2AuthorizationPlanInput["requirements"][number],
  sourceAccountResource: {
    tenantId: string;
    entityTypeId: string;
    entityId: string;
  },
  bindingResource: {
    tenantId: string;
    entityTypeId: string;
    entityId: string;
  }
): boolean {
  if (
    requirement.permissionId !== "core:source_account.use" ||
    !sameEntity(requirement.resource, sourceAccountResource) ||
    requirement.guard.profileId !== "core:rbac.guard.source_account_route" ||
    requirement.guard.operation.kind !== "use"
  ) {
    return false;
  }
  const guard = requirement.guard as InboxV2SourceAccountRouteGuard;
  const operation = guard.operation as InboxV2SourceUseOperation;
  return (
    String(guard.sourceAccountId) === String(sourceAccountResource.entityId) &&
    String(guard.routeSourceAccountId) ===
      String(sourceAccountResource.entityId) &&
    sameEntity(operation.sourceAccountResource, sourceAccountResource) &&
    sameEntity(operation.bindingResource, bindingResource) &&
    operation.capabilityManifest.capabilityId ===
      "core:capability.source_account.use" &&
    sameEntity(
      operation.capabilityManifest.sourceAccountResource,
      sourceAccountResource
    ) &&
    sameEntity(operation.capabilityManifest.bindingResource, bindingResource) &&
    operation.capabilityManifest.routeResource === null &&
    operation.capabilityManifest.state === "supported"
  );
}

type InboxV2SourceAccountRouteGuard = Extract<
  InboxV2AuthorizationPlanInput["requirements"][number]["guard"],
  { profileId: "core:rbac.guard.source_account_route" }
>;

type InboxV2RerouteOperation = Extract<
  InboxV2SourceAccountRouteGuard["operation"],
  { kind: "reroute_dispatch" }
>;

type InboxV2SourceUseOperation = Extract<
  InboxV2SourceAccountRouteGuard["operation"],
  { kind: "use" }
>;

function rerouteCapabilityManifestMatches(
  manifest: {
    capabilityId: string;
    sourceAccountResource: {
      tenantId: string;
      entityTypeId: string;
      entityId: string;
    };
    bindingResource: {
      tenantId: string;
      entityTypeId: string;
      entityId: string;
    };
    routeResource: {
      tenantId: string;
      entityTypeId: string;
      entityId: string;
    } | null;
    state: string;
  },
  sourceAccountResource: {
    tenantId: string;
    entityTypeId: string;
    entityId: string;
  },
  bindingResource: {
    tenantId: string;
    entityTypeId: string;
    entityId: string;
  },
  routeResource: {
    tenantId: string;
    entityTypeId: string;
    entityId: string;
  }
): boolean {
  return (
    manifest.capabilityId === "core:capability.source.dispatch.reroute" &&
    manifest.state === "supported" &&
    sameEntity(manifest.sourceAccountResource, sourceAccountResource) &&
    sameEntity(manifest.bindingResource, bindingResource) &&
    manifest.routeResource !== null &&
    sameEntity(manifest.routeResource, routeResource)
  );
}

function samePrincipal(
  plan: InboxV2AuthorizationPlanInput,
  command: InboxV2AuthorizedCommand,
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  requestScope: InboxV2OutboundSendRequestScope
): boolean {
  if (
    plan.currentAuthorization.principal.kind !== command.principal.kind ||
    mutation.command.actor.kind !== command.principal.kind ||
    requestScope.principal.kind !== command.principal.kind
  ) {
    return false;
  }
  return command.principal.kind === "employee" &&
    plan.currentAuthorization.principal.kind === "employee" &&
    mutation.command.actor.kind === "employee" &&
    requestScope.principal.kind === "employee"
    ? command.principal.employee.id ===
        plan.currentAuthorization.principal.employeeId &&
        command.principal.employee.id === mutation.command.actor.employeeId &&
        command.principal.employee.id === requestScope.principal.employee.id
    : command.principal.kind === "trusted_service" &&
        plan.currentAuthorization.principal.kind === "trusted_service" &&
        mutation.command.actor.kind === "trusted_service" &&
        requestScope.principal.kind === "trusted_service" &&
        command.principal.trustedServiceId ===
          plan.currentAuthorization.principal.trustedServiceId &&
        command.principal.trustedServiceId ===
          mutation.command.actor.trustedServiceId &&
        command.principal.trustedServiceId ===
          requestScope.principal.trustedServiceId;
}

function atomicProviderClosureMatches(
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  messageCreation: InboxV2MessageCreationCommit,
  rerouteCommit: InboxV2OutboundDispatchRerouteCommit | null,
  routeIntent: InboxV2OutboundSendRouteIntent
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
  const replacementChange = dispatchChanges.find(
    (change) => String(change.entity.entityId) === String(dispatch.id)
  );
  const providerIntent = providerIntents[0];
  const replacementClosureMatches =
    mutation.records.relationKind === null &&
    mutation.records.audit.actionId ===
      (routeIntent.kind === "explicit_reroute"
        ? "core:source.dispatch.reroute"
        : "core:message.send") &&
    replacementChange !== undefined &&
    replacementChange.resultingRevision === "1" &&
    providerIntents.length === 1 &&
    providerIntent !== undefined &&
    providerIntent.changeIds.length === 1 &&
    providerIntent.changeIds[0] === replacementChange.id &&
    String(providerIntent.payloadReference?.recordId) === String(dispatch.id);
  if (!replacementClosureMatches) return false;
  if (routeIntent.kind !== "explicit_reroute") {
    return rerouteCommit === null && dispatchChanges.length === 1;
  }
  if (rerouteCommit === null || dispatchChanges.length !== 2) return false;

  const originalAfter = rerouteCommit.original.dispatchAfter;
  const originalChange = dispatchChanges.find(
    (change) => String(change.entity.entityId) === String(originalAfter.id)
  );
  const originalReference = outboundDispatchStateReference(originalAfter);
  const commitReference = rerouteCommitReference(rerouteCommit);
  const state = originalChange?.state;
  if (
    originalChange === undefined ||
    originalChange === replacementChange ||
    originalChange.resultingRevision !== originalAfter.revision ||
    originalChange.timeline !== null ||
    originalChange.audience !== "conversation_external" ||
    state?.kind !== "upsert" ||
    state.stateSchemaId !== INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID ||
    state.stateSchemaVersion !== INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION ||
    state.stateHash !== originalReference.digest ||
    !sameValue(state.payloadReference, originalReference) ||
    !sameValue(state.domainCommitReference, commitReference) ||
    providerIntent.id !== rerouteCommit.replacement.outboxIntentId
  ) {
    return false;
  }

  const originalEvents = mutation.records.events.filter(
    (event) =>
      event.typeId === "core:outbound-dispatch.changed" &&
      event.changeIds.length === 1 &&
      event.changeIds[0] === originalChange.id &&
      event.subjects.length === 1 &&
      event.subjects[0]?.entityTypeId === "core:outbound-dispatch" &&
      String(event.subjects[0]?.entityId) === String(originalAfter.id) &&
      event.payloadSchemaId ===
        INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID &&
      event.payloadSchemaVersion ===
        INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION &&
      sameValue(event.payloadReference, commitReference) &&
      event.occurredAt === rerouteCommit.changedAt
  );
  if (originalEvents.length !== 1) return false;
  const originalEvent = originalEvents[0]!;
  const originalProjections = mutation.records.outboxIntents.filter(
    (intent) =>
      intent.effectClass === "projection" &&
      intent.typeId === "core:projection.update" &&
      intent.eventId === originalEvent.id &&
      intent.changeIds.length === 1 &&
      intent.changeIds[0] === originalChange.id
  );
  return originalProjections.length === 1;
}

function outboundDispatchStateReference(
  dispatch: InboxV2OutboundDispatchRerouteCommit["original"]["dispatchAfter"]
) {
  return {
    tenantId: dispatch.tenantId,
    recordId: dispatch.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256(dispatch)
  } as const;
}

function rerouteCommitReference(reroute: InboxV2OutboundDispatchRerouteCommit) {
  return {
    tenantId: reroute.tenantId,
    recordId: reroute.original.dispatchAfter.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256(reroute)
  } as const;
}

function routeDisclosureAuthorizationMatches(
  plan: InboxV2AuthorizationPlanInput,
  requestScope: InboxV2OutboundSendRequestScope,
  command: InboxV2OutboundSendCommand
): boolean {
  const requirement = plan.requirements[0];
  return (
    plan.tenantId === command.tenantId &&
    requestScopeMatchesPlan(requestScope, plan) &&
    plan.requirements.length === 1 &&
    requirement?.permissionId === "core:conversation.read" &&
    requirement.resource.tenantId === command.tenantId &&
    requirement.resource.entityTypeId === "core:conversation" &&
    String(requirement.resource.entityId) === command.conversationId
  );
}

function requestScopeMatchesPlan(
  requestScope: InboxV2OutboundSendRequestScope,
  plan: InboxV2AuthorizationPlanInput
): boolean {
  if (
    requestScope.tenantId !== plan.tenantId ||
    plan.currentAuthorization.tenantId !== requestScope.tenantId ||
    plan.principal.kind !== requestScope.principal.kind ||
    plan.currentAuthorization.principal.kind !== requestScope.principal.kind
  ) {
    return false;
  }
  return requestScope.principal.kind === "employee" &&
    plan.principal.kind === "employee" &&
    plan.currentAuthorization.principal.kind === "employee"
    ? requestScope.principal.employee.id === plan.principal.employee.id &&
        requestScope.principal.employee.id ===
          plan.currentAuthorization.principal.employeeId
    : requestScope.principal.kind === "trusted_service" &&
        plan.principal.kind === "trusted_service" &&
        plan.currentAuthorization.principal.kind === "trusted_service" &&
        requestScope.principal.trustedServiceId ===
          plan.principal.trustedServiceId &&
        requestScope.principal.trustedServiceId ===
          plan.currentAuthorization.principal.trustedServiceId;
}

function requestScopeMatchesRoute(
  requestScope: InboxV2OutboundSendRequestScope,
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>
): boolean {
  if (
    requestScope.tenantId !== route.tenantId ||
    requestScope.principal.kind !== route.principal.kind
  ) {
    return false;
  }
  return requestScope.principal.kind === "employee" &&
    route.principal.kind === "employee"
    ? requestScope.principal.employee.id === route.principal.employee.id
    : requestScope.principal.kind === "trusted_service" &&
        route.principal.kind === "trusted_service" &&
        requestScope.principal.trustedServiceId ===
          route.principal.trustedServiceId;
}

function idempotencyScopeMatches(
  requestScope: InboxV2OutboundSendRequestScope,
  command: InboxV2OutboundSendCommand,
  scope: InboxV2OutboundSendIdempotencyScope
): boolean {
  const principal = inboxV2OutboundRoutePrincipalSchema.safeParse(
    scope.principal
  );
  return (
    principal.success &&
    scope.tenantId === command.tenantId &&
    scope.tenantId === requestScope.tenantId &&
    scope.commandTypeId ===
      outboundSendMutationCommandType(command.routeIntent) &&
    scope.clientMutationId === command.clientMutationId &&
    scope.publicResultCode === "core:message.queued" &&
    outboundRoutePrincipalsMatch(principal.data, requestScope.principal)
  );
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

function outboundSendMutationCommandType(
  routeIntent: InboxV2OutboundSendRouteIntent
): InboxV2OutboundSendIdempotencyScope["commandTypeId"] {
  return routeIntent.kind === "explicit_reroute"
    ? "core:source.dispatch.reroute"
    : "core:message.send";
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
  input: InboxV2OutboundSendRequestScope
): InboxV2OutboundSendRequestScope {
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

function normalizeOutboundSendCommand(
  input: InboxV2OutboundSendCommand
): InboxV2OutboundSendCommand {
  if (
    typeof input !== "object" ||
    input === null ||
    !hasOnlyKeys(input, [
      "tenantId",
      "conversationId",
      "content",
      "routeIntent",
      "clientMutationId"
    ])
  ) {
    throw new CoreError(
      "validation.failed",
      "Outbound send accepts only tenant, conversation, content, route intent and client mutation ID."
    );
  }
  return Object.freeze({
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    content: inboxV2TimelineContentDraftSchema.parse(input.content),
    routeIntent: normalizeRouteIntent(input.routeIntent),
    clientMutationId: inboxV2ClientMutationIdSchema.parse(
      input.clientMutationId
    )
  });
}

function normalizeRouteIntent(
  input: InboxV2OutboundSendRouteIntent
): InboxV2OutboundSendRouteIntent {
  if (typeof input !== "object" || input === null || !("kind" in input)) {
    throw new CoreError(
      "validation.failed",
      "Outbound route intent is invalid."
    );
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
    input.kind === "explicit_reroute" &&
    hasOnlyKeys(input, [
      "kind",
      "originalRouteId",
      "originalDispatchId",
      "expectedOriginalDispatchRevision",
      "replacementBindingId",
      "reasonId"
    ])
  ) {
    return Object.freeze({
      kind: "explicit_reroute",
      originalRouteId: inboxV2OutboundRouteIdSchema.parse(
        input.originalRouteId
      ),
      originalDispatchId: inboxV2OutboundDispatchIdSchema.parse(
        input.originalDispatchId
      ),
      expectedOriginalDispatchRevision: inboxV2EntityRevisionSchema.parse(
        input.expectedOriginalDispatchRevision
      ),
      replacementBindingId: inboxV2SourceThreadBindingIdSchema.parse(
        input.replacementBindingId
      ),
      reasonId: inboxV2CatalogIdSchema.parse(input.reasonId)
    });
  }
  throw new CoreError("validation.failed", "Outbound route intent is invalid.");
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  return (
    actual.length === allowed.size && actual.every((key) => allowed.has(key))
  );
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

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
