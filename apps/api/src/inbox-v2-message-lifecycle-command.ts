import {
  calculateInboxV2CanonicalSha256,
  deriveInboxV2MessageEditFileSourceAuthorityPlan,
  deriveInboxV2MessageEditFileUploadAuthorityPlan,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID,
  INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
  INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizedCommandSchema,
  inboxV2CatalogIdSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageMutationCommitSchema,
  inboxV2MessageProviderLifecycleOperationCreationCommitSchema,
  inboxV2OutboundRoutePrincipalSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineContentDraftSchema,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2AuthorizedCommand,
  type InboxV2MessageEditFileUploadAuthorityTarget,
  type InboxV2MessageEditFileSourceAuthorityTarget,
  type InboxV2MessageProviderLifecycleOperationCreationCommit,
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
  type InboxV2AuthorizedCommandMutationResult,
  type InboxV2PrivilegedAuthorizationMutationReplayStatus,
  type WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";

type MessageMutationCommit = ReturnType<
  typeof inboxV2MessageMutationCommitSchema.parse
>;

type LifecycleContentDraft = Extract<
  InboxV2TimelineCommandIntent,
  { kind: "edit_message" }
>["content"];

export type InboxV2MessageLifecycleRequestScope = Readonly<{
  tenantId: string;
  principal: InboxV2OutboundRoutePrincipal;
  authorizationEpoch: string;
}>;

export type InboxV2MessageLifecycleCommand =
  | Readonly<{
      kind: "edit";
      tenantId: string;
      conversationId: string;
      messageId: string;
      expectedMessageRevision: string;
      content: LifecycleContentDraft;
      clientMutationId: string;
    }>
  | Readonly<{
      kind: "delete_local";
      tenantId: string;
      conversationId: string;
      messageId: string;
      expectedMessageRevision: string;
      reasonId: string;
      clientMutationId: string;
    }>
  | Readonly<{
      kind: "delete_provider";
      tenantId: string;
      conversationId: string;
      messageId: string;
      expectedMessageRevision: string;
      reasonId: string;
      clientMutationId: string;
    }>;

export type InboxV2MessageLifecycleIdempotencyScope = Readonly<{
  tenantId: string;
  principal: InboxV2OutboundRoutePrincipal;
  authorizationEpoch: string;
  commandTypeId:
    | "core:message.edit"
    | "core:message.delete_local"
    | "core:message.delete_provider";
  clientMutationId: string;
  publicResultCode:
    | "core:message.edited"
    | "core:message.deleted_local"
    | "core:message.provider_delete_queued";
}>;

export type InboxV2PreparedMessageLifecycleCommand =
  | Readonly<{
      /** Must be resolved before loading a mutable Message or provider route. */
      kind: "committed_replay";
      requestHash: string;
      scope: InboxV2MessageLifecycleIdempotencyScope;
      status: InboxV2PrivilegedAuthorizationMutationReplayStatus;
    }>
  | Readonly<{
      kind: "idempotency_conflict";
      scope: InboxV2MessageLifecycleIdempotencyScope;
    }>
  | Readonly<{
      kind: "revision_conflict";
      requestHash: string;
      scope: InboxV2MessageLifecycleIdempotencyScope;
      visibilityBoundary: "external_work" | "internal";
      disclosureAuthorizationPlan: InboxV2AuthorizationPlanInput;
      denialContext: InboxV2SecurityDenialContext;
    }>
  | Readonly<{
      kind: "selected";
      authorizationPlan: InboxV2AuthorizationPlanInput;
      denialContext: InboxV2SecurityDenialContext;
      authorizedCommand: InboxV2AuthorizedCommand;
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      /** Present for edit/local delete; absent for a provider-delete request. */
      messageMutation: MessageMutationCommit | null;
      /** Exact pending provider operation for external edit/provider delete. */
      providerOperationCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null;
    }>;

export type InboxV2MessageLifecycleCommandPreparer = Readonly<{
  lookupIdempotency(
    command: InboxV2MessageLifecycleCommand
  ): Promise<Extract<
    InboxV2PreparedMessageLifecycleCommand,
    { kind: "committed_replay" | "idempotency_conflict" }
  > | null>;
  /**
   * Loads Message/authorship/legal-hold and exact provider route facts from
   * trusted storage. None of these facts may be copied from the public body.
   */
  prepareNew(
    command: InboxV2MessageLifecycleCommand
  ): Promise<Extract<
    InboxV2PreparedMessageLifecycleCommand,
    { kind: "revision_conflict" | "selected" }
  > | null>;
}>;

export type InboxV2MessageLifecycleAtomicResult = Readonly<{
  messageId: string;
  messageRevision: string | null;
  providerOperationId: string | null;
}>;

export type InboxV2MessageLifecycleLegalHoldFence = Readonly<{
  tenantId: string;
  timelineItemId: string;
  expectedLegalHoldSetRevision: string;
}>;

/**
 * Narrow DB-only seam. Implementations persist the supplied domain commits and
 * authorized tenant-stream mutation atomically. They must not perform provider
 * I/O; the sealed provider_io outbox intent is the only post-commit trigger.
 */
export type InboxV2MessageLifecycleAtomicCoordinator = Readonly<{
  withAuthorizedMessageLifecycleMutation(
    input: Readonly<{
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      messageMutation: MessageMutationCommit | null;
      providerOperationCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null;
      legalHoldFence: InboxV2MessageLifecycleLegalHoldFence | null;
      fileUploadAuthorityPlan: readonly InboxV2MessageEditFileUploadAuthorityTarget[];
      fileSourceAuthorityPlan: readonly InboxV2MessageEditFileSourceAuthorityTarget[];
    }>
  ): Promise<
    InboxV2AuthorizedCommandMutationResult<InboxV2MessageLifecycleAtomicResult>
  >;
}>;

type LifecycleAtomicFailure = Exclude<
  InboxV2AuthorizedCommandMutationResult<InboxV2MessageLifecycleAtomicResult>,
  { kind: "applied" | "already_applied" }
>;

export type InboxV2MessageLifecycleCommandResult =
  | Readonly<{
      outcome: "edited" | "deleted_local";
      messageId: string;
      messageRevision: string;
      commit: Extract<
        InboxV2AuthorizedCommandMutationResult<InboxV2MessageLifecycleAtomicResult>,
        { kind: "applied" }
      >["status"];
    }>
  | Readonly<{
      outcome: "provider_delete_queued";
      messageId: string;
      providerOperationId: string;
      commit: Extract<
        InboxV2AuthorizedCommandMutationResult<InboxV2MessageLifecycleAtomicResult>,
        { kind: "applied" }
      >["status"];
    }>
  | Readonly<{
      outcome: "already_applied";
      action: InboxV2MessageLifecycleCommand["kind"];
      targetId: string;
      commit: InboxV2PrivilegedAuthorizationMutationReplayStatus;
    }>
  | Readonly<{ outcome: "idempotency_conflict" }>
  | Readonly<{ outcome: "revision_conflict" }>
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{ outcome: "denied"; errorCode: string }>
  | Readonly<{
      outcome: "authorization_conflict";
      conflict: LifecycleAtomicFailure;
    }>;

export type InboxV2MessageLifecycleCommandServiceOptions = Readonly<{
  requestScope: InboxV2MessageLifecycleRequestScope;
  preparer: InboxV2MessageLifecycleCommandPreparer;
  denialSink: InboxV2SecurityDenialSink;
  coordinator: InboxV2MessageLifecycleAtomicCoordinator;
  /** Test seam; production always uses the core authorization gate. */
  authorizationGate?: typeof executeInboxV2AuthorizationGate;
}>;

export type InboxV2MessageLifecycleCommandService = Readonly<{
  execute(
    command: InboxV2MessageLifecycleCommand
  ): Promise<InboxV2MessageLifecycleCommandResult>;
}>;

type ClosedLifecycleSelection = Readonly<{
  messageMutation: MessageMutationCommit | null;
  providerOperationCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null;
  legalHoldFence: InboxV2MessageLifecycleLegalHoldFence | null;
  fileUploadAuthorityPlan: readonly InboxV2MessageEditFileUploadAuthorityTarget[];
  fileSourceAuthorityPlan: readonly InboxV2MessageEditFileSourceAuthorityTarget[];
}>;

/**
 * Executes edit/local-delete/provider-delete orchestration. The idempotency
 * lookup deliberately precedes every mutable read, and provider execution is
 * represented only by a durable outbox intent committed by the coordinator.
 */
export function createInboxV2MessageLifecycleCommandService(
  options: InboxV2MessageLifecycleCommandServiceOptions
): InboxV2MessageLifecycleCommandService {
  const requestScope = normalizeRequestScope(options.requestScope);
  const authorizationGate =
    options.authorizationGate ?? executeInboxV2AuthorizationGate;

  return Object.freeze({
    async execute(commandInput) {
      const command = normalizeCommand(commandInput);
      if (command.tenantId !== requestScope.tenantId) deny();

      const idempotency = await options.preparer.lookupIdempotency(command);
      if (idempotency?.kind === "committed_replay") {
        assertReplayClosure(command, requestScope, idempotency);
        return {
          outcome: "already_applied",
          action: command.kind,
          targetId: replayedTargetId(command, idempotency.status),
          commit: idempotency.status
        };
      }
      if (idempotency?.kind === "idempotency_conflict") {
        if (
          !idempotencyScopeMatches(command, requestScope, idempotency.scope)
        ) {
          deny();
        }
        return { outcome: "idempotency_conflict" };
      }

      const prepared = await options.preparer.prepareNew(command);
      if (prepared === null) return { outcome: "not_found" };
      if (prepared.kind === "revision_conflict") {
        if (
          prepared.requestHash !==
            calculateInboxV2MessageLifecycleIntentDigest(command) ||
          !idempotencyScopeMatches(command, requestScope, prepared.scope) ||
          (command.kind === "delete_provider" &&
            prepared.visibilityBoundary !== "external_work") ||
          !lifecycleDisclosureAuthorizationMatches(
            prepared.disclosureAuthorizationPlan,
            requestScope,
            command,
            prepared.visibilityBoundary
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

      const closed = assertSelectedClosure(command, requestScope, prepared);
      const coordinated = await authorizationGate({
        authorizationPlan: prepared.authorizationPlan,
        denialContext: prepared.denialContext,
        denialSink: options.denialSink,
        executeAllowed: () =>
          options.coordinator.withAuthorizedMessageLifecycleMutation({
            authorizedMutation: prepared.authorizedMutation,
            messageMutation: closed.messageMutation,
            providerOperationCreation: closed.providerOperationCreation,
            legalHoldFence: closed.legalHoldFence,
            fileUploadAuthorityPlan: closed.fileUploadAuthorityPlan,
            fileSourceAuthorityPlan: closed.fileSourceAuthorityPlan
          })
      });
      if (coordinated.outcome === "denied") {
        return {
          outcome: "denied",
          errorCode: coordinated.publicDecision.errorCode
        };
      }
      return mapCoordinatedResult(command, closed, coordinated.value);
    }
  });
}

export function calculateInboxV2MessageLifecycleIntentDigest(
  commandInput: InboxV2MessageLifecycleCommand
): string {
  const command = normalizeCommand(commandInput);
  return calculateInboxV2CanonicalSha256({
    protocol: "core:inbox-v2.message-lifecycle-command@v1",
    command
  });
}

function assertSelectedClosure(
  command: InboxV2MessageLifecycleCommand,
  requestScope: InboxV2MessageLifecycleRequestScope,
  prepared: Extract<
    InboxV2PreparedMessageLifecycleCommand,
    { kind: "selected" }
  >
): ClosedLifecycleSelection {
  const requestHash = calculateInboxV2MessageLifecycleIntentDigest(command);
  const authorizedCommand = inboxV2AuthorizedCommandSchema.parse(
    prepared.authorizedCommand
  );
  assertAuthorizedCommandClosure(
    command,
    requestScope,
    requestHash,
    authorizedCommand
  );

  const messageMutation =
    prepared.messageMutation === null
      ? null
      : inboxV2MessageMutationCommitSchema.parse(prepared.messageMutation);
  const providerOperationCreation =
    prepared.providerOperationCreation === null
      ? null
      : inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse(
          prepared.providerOperationCreation
        );

  if (
    !authorizationClosureMatches(
      prepared.authorizationPlan,
      authorizedCommand,
      prepared.authorizedMutation,
      requestScope,
      messageMutation,
      providerOperationCreation
    )
  ) {
    deny();
  }

  if (command.kind === "edit") {
    if (messageMutation === null) deny();
    assertEditClosure(
      command,
      authorizedCommand,
      messageMutation,
      providerOperationCreation
    );
  } else if (command.kind === "delete_local") {
    if (messageMutation === null || providerOperationCreation !== null) deny();
    assertLocalDeleteClosure(command, authorizedCommand, messageMutation);
  } else {
    if (messageMutation !== null || providerOperationCreation === null) deny();
    assertProviderDeleteClosure(
      command,
      authorizedCommand,
      providerOperationCreation
    );
  }

  assertAuthorizedMutationClosure(
    command,
    requestScope,
    requestHash,
    authorizedCommand,
    prepared.authorizedMutation,
    messageMutation,
    providerOperationCreation
  );
  return Object.freeze({
    messageMutation,
    providerOperationCreation,
    fileUploadAuthorityPlan:
      authorizedCommand.intent.payload.kind === "edit_message"
        ? deriveInboxV2MessageEditFileUploadAuthorityPlan(
            authorizedCommand.intent.payload
          )
        : Object.freeze([]),
    fileSourceAuthorityPlan:
      authorizedCommand.intent.payload.kind === "edit_message" &&
      messageMutation !== null
        ? deriveInboxV2MessageEditFileSourceAuthorityPlan(
            authorizedCommand.intent.payload,
            {
              message: {
                tenantId: messageMutation.afterMessage.tenantId,
                kind: "message",
                id: messageMutation.afterMessage.id
              },
              expectedMessageRevision: messageMutation.afterMessage.revision
            }
          )
        : Object.freeze([]),
    legalHoldFence: lifecycleLegalHoldFence(
      command,
      prepared.authorizationPlan,
      authorizedCommand,
      messageMutation,
      providerOperationCreation
    )
  });
}

function assertAuthorizedCommandClosure(
  command: InboxV2MessageLifecycleCommand,
  scope: InboxV2MessageLifecycleRequestScope,
  requestHash: string,
  authorized: InboxV2AuthorizedCommand
): void {
  const intent = authorized.intent.payload;
  if (
    authorized.tenantId !== command.tenantId ||
    authorized.request.tenantId !== command.tenantId ||
    authorized.request.commandTypeId !== "core:timeline.command" ||
    authorized.request.clientMutationId !== command.clientMutationId ||
    authorized.request.requestHash !== requestHash ||
    !commandPrincipalMatchesScope(authorized, scope) ||
    intent.tenantId !== command.tenantId ||
    intent.conversation.id !== command.conversationId ||
    !("message" in intent) ||
    intent.message.id !== command.messageId ||
    !("expectedMessageRevision" in intent) ||
    intent.expectedMessageRevision !== command.expectedMessageRevision ||
    !("mutationAuthority" in intent) ||
    intent.mutationAuthority === undefined ||
    !mutationAuthorityMatchesIntent(intent)
  ) {
    deny();
  }

  if (
    (command.kind === "edit" &&
      (intent.kind !== "edit_message" ||
        !sameValue(intent.content, command.content))) ||
    (command.kind === "delete_local" &&
      (intent.kind !== "delete_message_local" ||
        intent.reasonId !== command.reasonId)) ||
    (command.kind === "delete_provider" &&
      intent.kind !== "delete_message_provider")
  ) {
    deny();
  }
  if (
    intent.mutationAuthority.kind !== "own" &&
    "reasonId" in command &&
    intent.mutationAuthority.reasonId !== command.reasonId
  ) {
    deny();
  }
}

function assertEditClosure(
  command: Extract<InboxV2MessageLifecycleCommand, { kind: "edit" }>,
  authorized: InboxV2AuthorizedCommand,
  mutation: MessageMutationCommit,
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null
): void {
  const intent = authorized.intent.payload;
  if (
    intent.kind !== "edit_message" ||
    !messageMutationBaseMatches(command, intent, mutation) ||
    mutation.revision.change.kind !== "edited" ||
    !messageLifecycleTopologyMatches(
      intent.transport.kind === "external" ? "external_work" : "internal",
      mutation.beforeMessage.origin.kind,
      mutation.beforeTimelineItem.visibility
    ) ||
    mutation.contentTransition?.transition.kind !== "edit" ||
    mutation.afterMessage.lifecycle.kind !== "active" ||
    mutation.revision.change.afterContent.stateKind !== "available" ||
    mutation.contentTransition.after.state.kind !== "available" ||
    !sameValue(
      mutation.contentTransition.after.state.blocks,
      command.content.blocks
    )
  ) {
    deny();
  }
  assertOwnAuthorityMaterialization(
    intent,
    mutation.beforeMessage,
    mutation.actionParticipantSnapshot,
    mutation.revision.actionAttribution.actionParticipant
  );

  if (intent.transport.kind === "internal") {
    if (
      mutation.providerOperation !== null ||
      mutation.providerOperationCreationCommit !== null ||
      providerCreation !== null
    ) {
      deny();
    }
    return;
  }
  const nested = mutation.providerOperationCreationCommit;
  if (
    nested === null ||
    mutation.providerOperation === null ||
    providerCreation === null ||
    !sameValue(nested, providerCreation) ||
    mutation.providerOperation.id !== providerCreation.operation.id ||
    mutation.revision.change.providerOperation?.id !==
      providerCreation.operation.id ||
    !sameValue(providerCreation.message, mutation.beforeMessage) ||
    !sameValue(providerCreation.timelineItem, mutation.beforeTimelineItem)
  ) {
    deny();
  }
  assertProviderCreationClosure(intent, providerCreation, "edit");
}

function assertLocalDeleteClosure(
  command: Extract<InboxV2MessageLifecycleCommand, { kind: "delete_local" }>,
  authorized: InboxV2AuthorizedCommand,
  mutation: MessageMutationCommit
): void {
  const intent = authorized.intent.payload;
  if (
    intent.kind !== "delete_message_local" ||
    !messageMutationBaseMatches(command, intent, mutation) ||
    mutation.contentTransition !== null ||
    mutation.providerOperation !== null ||
    mutation.providerOperationCreationCommit !== null ||
    !messageLifecycleTopologyMatches(
      intent.visibilityBoundary ?? "external_work",
      mutation.beforeMessage.origin.kind,
      mutation.beforeTimelineItem.visibility
    ) ||
    mutation.revision.change.kind !== "local_delete_tombstone" ||
    mutation.revision.change.reasonId !== command.reasonId ||
    mutation.afterMessage.lifecycle.kind !== "local_delete_tombstone" ||
    mutation.afterMessage.lifecycle.reasonId !== command.reasonId ||
    !sameValue(mutation.beforeMessage.content, mutation.afterMessage.content)
  ) {
    deny();
  }
  assertOwnAuthorityMaterialization(
    intent,
    mutation.beforeMessage,
    mutation.actionParticipantSnapshot,
    mutation.revision.actionAttribution.actionParticipant
  );
}

function assertProviderDeleteClosure(
  command: Extract<InboxV2MessageLifecycleCommand, { kind: "delete_provider" }>,
  authorized: InboxV2AuthorizedCommand,
  creation: InboxV2MessageProviderLifecycleOperationCreationCommit
): void {
  const intent = authorized.intent.payload;
  if (
    intent.kind !== "delete_message_provider" ||
    creation.message.id !== command.messageId ||
    creation.message.conversation.id !== command.conversationId ||
    creation.message.revision !== command.expectedMessageRevision ||
    creation.message.lifecycle.kind !== "active" ||
    !messageLifecycleTopologyMatches(
      "external_work",
      creation.message.origin.kind,
      creation.timelineItem.visibility
    )
  ) {
    deny();
  }
  assertOwnAuthorityMaterialization(
    intent,
    creation.message,
    creation.actionParticipantSnapshot,
    creation.operation.actionParticipant
  );
  assertProviderCreationClosure(intent, creation, "delete");
}

function assertProviderCreationClosure(
  intent: Extract<
    InboxV2TimelineCommandIntent,
    { kind: "edit_message" | "delete_message_provider" }
  >,
  creation: InboxV2MessageProviderLifecycleOperationCreationCommit,
  action: "edit" | "delete"
): void {
  const external = intent.kind === "edit_message" ? intent.transport : intent;
  if (
    (intent.kind === "edit_message" && external.kind !== "external") ||
    !("externalMessageReference" in external) ||
    creation.operation.origin !== "hulee_requested" ||
    creation.operation.action !== action ||
    creation.operation.revision !== "1" ||
    creation.operation.outcome.state !== "pending" ||
    creation.operation.deleteLocalPolicy?.effect !==
      (action === "delete" ? "not_evaluated" : undefined) ||
    (action === "edit" && creation.operation.deleteLocalPolicy !== null) ||
    creation.outboundRoute === null ||
    creation.outboundBindingSnapshot === null ||
    creation.routeConsumption === null ||
    creation.externalMessageReference.id !==
      external.externalMessageReference.id ||
    creation.sourceOccurrence.id !== external.sourceOccurrence.id ||
    creation.outboundRoute.id !== external.outboundRoute.id ||
    external.routeAuthorization === undefined ||
    external.routeAuthorization.outboundRoute.id !==
      creation.outboundRoute.id ||
    external.routeAuthorization.routeRevision !==
      creation.outboundRoute.revision ||
    external.routeAuthorization.sourceAccount.id !==
      creation.operation.sourceAccount.id ||
    external.routeAuthorization.sourceThreadBinding.id !==
      creation.operation.sourceThreadBinding.id ||
    !sameValue(
      external.routeAuthorization.bindingFence,
      creation.outboundRoute.bindingFence
    ) ||
    creation.operation.bindingGeneration !==
      creation.outboundRoute.bindingFence.bindingGeneration ||
    creation.operation.capabilityRevision !==
      creation.outboundRoute.bindingFence.capabilityRevision ||
    !sameValue(creation.operation.appActor, intent.appActor)
  ) {
    deny();
  }
}

function messageMutationBaseMatches(
  command: Extract<
    InboxV2MessageLifecycleCommand,
    { kind: "edit" | "delete_local" }
  >,
  intent: Extract<
    InboxV2TimelineCommandIntent,
    { kind: "edit_message" | "delete_message_local" }
  >,
  mutation: MessageMutationCommit
): boolean {
  return (
    mutation.tenantId === command.tenantId &&
    mutation.beforeMessage.id === command.messageId &&
    mutation.beforeMessage.conversation.id === command.conversationId &&
    mutation.beforeMessage.revision === command.expectedMessageRevision &&
    mutation.beforeMessage.lifecycle.kind === "active" &&
    mutation.revision.expectedPreviousRevision ===
      command.expectedMessageRevision &&
    mutation.revision.message.id === command.messageId &&
    mutation.afterMessage.id === command.messageId &&
    sameValue(mutation.revision.actionAttribution.appActor, intent.appActor)
  );
}

function messageLifecycleTopologyMatches(
  boundary: "external_work" | "internal",
  originKind: string,
  visibility: string
): boolean {
  if (!messageLifecycleVisibilityMatches(boundary, visibility)) return false;
  return boundary === "external_work"
    ? originKind === "source_originated" || originKind === "hulee_external"
    : originKind === "internal" || originKind === "migration";
}

function messageLifecycleVisibilityMatches(
  boundary: "external_work" | "internal",
  visibility: string
): boolean {
  return boundary === "external_work"
    ? visibility === "conversation_external"
    : visibility === "internal_participants";
}

function assertAuthorizedMutationClosure(
  command: InboxV2MessageLifecycleCommand,
  scope: InboxV2MessageLifecycleRequestScope,
  requestHash: string,
  authorized: InboxV2AuthorizedCommand,
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  messageMutation: MessageMutationCommit | null,
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null
): void {
  const expectedCommandType = commandTypeId(command);
  const expectedResultCode = publicResultCode(command);
  const lifecycleIntent = authorized.intent.payload;
  if (
    lifecycleIntent.kind !== "edit_message" &&
    lifecycleIntent.kind !== "delete_message_local" &&
    lifecycleIntent.kind !== "delete_message_provider"
  ) {
    deny();
  }
  const expectedReference =
    command.kind === "delete_provider"
      ? {
          schemaId: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
          schemaVersion: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
          recordId: providerCreation?.operation.id,
          digest:
            providerCreation === null
              ? null
              : calculateInboxV2CanonicalSha256(providerCreation.operation)
        }
      : {
          schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
          schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
          recordId: messageMutation?.afterMessage.id,
          digest:
            messageMutation === null
              ? null
              : calculateInboxV2CanonicalSha256(messageMutation.afterMessage)
        };
  const resultReference = mutation.command.resultReference;
  const authority = lifecycleIntent.mutationAuthority;
  const expectedAuditReason =
    authority !== undefined && authority.kind !== "own"
      ? authority.reasonId
      : command.kind === "edit"
        ? null
        : command.reasonId;
  if (
    mutation.tenantId !== command.tenantId ||
    mutation.command.commandTypeId !== expectedCommandType ||
    mutation.command.clientMutationId !== command.clientMutationId ||
    mutation.command.requestHash !== requestHash ||
    mutation.command.authorizationEpoch !== scope.authorizationEpoch ||
    mutation.command.authorizedAt !== authorized.authorizedAt ||
    mutation.command.publicResultCode !== expectedResultCode ||
    mutation.command.sensitiveResultReference !== null ||
    !mutationActorMatchesScope(mutation.command.actor, scope) ||
    resultReference === null ||
    resultReference.tenantId !== command.tenantId ||
    resultReference.schemaId !== expectedReference.schemaId ||
    resultReference.schemaVersion !== expectedReference.schemaVersion ||
    String(resultReference.recordId) !== String(expectedReference.recordId) ||
    resultReference.digest !== expectedReference.digest ||
    mutation.records.audit.actionId !== expectedCommandType ||
    (expectedAuditReason !== null &&
      mutation.records.audit.reasonCodeId !== expectedAuditReason)
  ) {
    deny();
  }

  const providerOutbox = mutation.records.outboxIntents.filter(
    (intent) => intent.effectClass === "provider_io"
  );
  const projectionOutbox = mutation.records.outboxIntents.filter(
    (intent) =>
      intent.effectClass === "projection" &&
      intent.typeId === "core:projection.update"
  );
  const messageChanges = mutation.records.changes.filter(
    (change) =>
      change.entity.tenantId === command.tenantId &&
      String(change.entity.entityTypeId) === "core:message" &&
      String(change.entity.entityId) === command.messageId
  );
  const operationChanges = mutation.records.changes.filter(
    (change) =>
      change.entity.tenantId === command.tenantId &&
      String(change.entity.entityTypeId) ===
        INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID &&
      String(change.entity.entityId) === providerCreation?.operation.id
  );
  const messageStateReference =
    messageMutation === null
      ? null
      : {
          tenantId: command.tenantId,
          recordId: messageMutation.afterMessage.id,
          schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
          schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
          digest: calculateInboxV2CanonicalSha256(messageMutation.afterMessage)
        };
  const messageCommitReference =
    messageMutation === null
      ? null
      : {
          tenantId: command.tenantId,
          recordId: messageMutation.revision.id,
          schemaId: INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
          schemaVersion: INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
          digest: calculateInboxV2CanonicalSha256(messageMutation.revision)
        };
  const messageChange = messageChanges[0];
  if (
    (messageMutation === null) !== (messageChange === undefined) ||
    (messageMutation !== null &&
      messageChange !== undefined &&
      (messageChange.resultingRevision !==
        messageMutation.afterMessage.revision ||
        messageChange.state.kind !== "upsert" ||
        messageChange.state.stateSchemaId !== INBOX_V2_MESSAGE_SCHEMA_ID ||
        messageChange.state.stateSchemaVersion !==
          INBOX_V2_MESSAGE_SCHEMA_VERSION ||
        !sameValue(
          messageChange.state.payloadReference,
          messageStateReference
        ) ||
        !sameValue(
          messageChange.state.domainCommitReference,
          messageCommitReference
        )))
  ) {
    deny();
  }
  const owningEvent = mutation.records.events[0];
  const expectedEventReference =
    messageCommitReference ??
    (providerCreation === null
      ? null
      : {
          tenantId: command.tenantId,
          recordId: providerCreation.operation.id,
          schemaId:
            INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID,
          schemaVersion: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
          digest: calculateInboxV2CanonicalSha256(providerCreation)
        });
  const expectedChangeIds = mutation.records.changes.map(({ id }) =>
    String(id)
  );
  const eventChangeIds = owningEvent?.changeIds.map(String) ?? [];
  const projection = projectionOutbox[0];
  if (
    expectedEventReference === null ||
    mutation.records.events.length !== 1 ||
    owningEvent === undefined ||
    owningEvent.typeId !== "core:message.changed" ||
    owningEvent.payloadSchemaId !== expectedEventReference.schemaId ||
    owningEvent.payloadSchemaVersion !== expectedEventReference.schemaVersion ||
    !sameValue(owningEvent.payloadReference, expectedEventReference) ||
    eventChangeIds.length !== expectedChangeIds.length ||
    expectedChangeIds.some((id) => !eventChangeIds.includes(id)) ||
    !owningEvent.subjects.some(
      (subject) =>
        subject.tenantId === command.tenantId &&
        String(subject.entityTypeId) === "core:message" &&
        String(subject.entityId) === command.messageId
    ) ||
    projectionOutbox.length !== 1 ||
    projection === undefined ||
    projection.handlerId !== "core:inbox-projection" ||
    projection.eventId !== owningEvent.id ||
    projection.changeIds.length !== expectedChangeIds.length ||
    expectedChangeIds.some(
      (id) =>
        !projection.changeIds.some((candidate) => String(candidate) === id)
    ) ||
    projection.payloadReference !== null ||
    mutation.records.outboxIntents.length !==
      1 + (providerCreation === null ? 0 : 1)
  ) {
    deny();
  }
  if (providerCreation === null) {
    if (
      providerOutbox.length !== 0 ||
      mutation.records.changes.length !== 1 ||
      messageChanges.length !== 1 ||
      operationChanges.length !== 0
    ) {
      deny();
    }
    return;
  }
  const [intent] = providerOutbox;
  const [operationChange] = operationChanges;
  const expectsMessageChange = command.kind === "edit";
  const operationDigest = calculateInboxV2CanonicalSha256(
    providerCreation.operation
  );
  const creationDigest = calculateInboxV2CanonicalSha256(providerCreation);
  const operationReference = {
    tenantId: command.tenantId,
    recordId: providerCreation.operation.id,
    schemaId: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
    digest: operationDigest
  };
  const creationReference = {
    tenantId: command.tenantId,
    recordId: providerCreation.operation.id,
    schemaId: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
    digest: creationDigest
  };
  if (
    mutation.records.changes.length !== (expectsMessageChange ? 2 : 1) ||
    messageChanges.length !== (expectsMessageChange ? 1 : 0) ||
    operationChanges.length !== 1 ||
    operationChange === undefined ||
    operationChange.resultingRevision !== providerCreation.operation.revision ||
    providerCreation.operation.revision !== "1" ||
    operationChange.state.kind !== "upsert" ||
    operationChange.state.stateSchemaId !==
      INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID ||
    operationChange.state.stateSchemaVersion !==
      INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION ||
    operationChange.state.stateHash !== operationDigest ||
    !sameValue(operationChange.state.payloadReference, operationReference) ||
    !sameValue(
      operationChange.state.domainCommitReference,
      creationReference
    ) ||
    providerOutbox.length !== 1 ||
    intent === undefined ||
    intent.typeId !== "core:provider.message_lifecycle" ||
    intent.changeIds.length !== 1 ||
    intent.changeIds[0] !== operationChange.id ||
    intent.payloadReference === null ||
    intent.payloadReference.tenantId !== command.tenantId ||
    intent.payloadReference.schemaId !==
      INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID ||
    intent.payloadReference.schemaVersion !==
      INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION ||
    String(intent.payloadReference.recordId) !==
      providerCreation.operation.id ||
    intent.payloadReference.digest !== operationDigest ||
    !eventChangeIds.includes(String(operationChange.id)) ||
    intent.eventId !== owningEvent.id
  ) {
    deny();
  }
}

function authorizationClosureMatches(
  plan: InboxV2AuthorizationPlanInput,
  command: InboxV2AuthorizedCommand,
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  requestScope: InboxV2MessageLifecycleRequestScope,
  messageMutation: MessageMutationCommit | null,
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null
): boolean {
  const intent = command.intent.payload;
  if (
    intent.kind !== "edit_message" &&
    intent.kind !== "delete_message_local" &&
    intent.kind !== "delete_message_provider"
  ) {
    return false;
  }
  const authority = intent.mutationAuthority;
  if (authority === undefined) return false;
  const primaryPermission =
    authority.kind === "moderate_external"
      ? "core:message.moderate_external"
      : authority.kind === "moderate_internal"
        ? "core:message.moderate_internal"
        : intent.kind === "edit_message"
          ? "core:message.edit_own"
          : "core:message.delete_own";
  const readPermission =
    intent.kind === "delete_message_local"
      ? intent.visibilityBoundary === "internal"
        ? "core:conversation.internal.read"
        : "core:conversation.read"
      : intent.kind === "edit_message" && intent.transport.kind === "internal"
        ? "core:conversation.internal.read"
        : "core:conversation.read";
  const decisions = command.authorizationDecisionRefs;
  const auditDecisions = mutation.records.audit.authorizationDecisionRefs.map(
    (decision) => inboxV2AuthorizationDecisionReferenceSchema.parse(decision)
  );
  const conversation = {
    tenantId: command.tenantId,
    entityTypeId: "core:conversation",
    entityId: intent.conversation.id
  };
  const timelineItem =
    messageMutation?.beforeTimelineItem ?? providerCreation?.timelineItem;
  if (timelineItem === undefined) return false;
  const primaryResource =
    authority.kind === "moderate_internal"
      ? conversation
      : {
          tenantId: command.tenantId,
          entityTypeId: "core:timeline-item",
          entityId: timelineItem.id
        };
  const primaryResourceScopeId =
    authority.kind === "moderate_internal"
      ? "core:conversation"
      : "core:timeline-item";
  const readDecisions = decisions.filter(
    (decision) =>
      decision.permissionId === readPermission &&
      decision.resourceScopeId === "core:conversation" &&
      sameEntity(decision.resource, conversation)
  );
  const primaryDecisions = decisions.filter(
    (decision) =>
      decision.permissionId === primaryPermission &&
      decision.resourceScopeId === primaryResourceScopeId &&
      sameEntity(decision.resource, primaryResource)
  );
  const sourceDecisions = decisions.filter(
    (decision) =>
      decision.permissionId === "core:source_account.use" &&
      decision.resourceScopeId === "core:source-account" &&
      providerCreation !== null &&
      decision.resource.tenantId === command.tenantId &&
      decision.resource.entityTypeId === "core:source-account" &&
      String(decision.resource.entityId) ===
        providerCreation.operation.sourceAccount.id
  );
  const readRequirements = plan.requirements.filter(
    (requirement) =>
      requirement.permissionId === readPermission &&
      sameEntity(requirement.resource, conversation)
  );
  const primaryRequirements = plan.requirements.filter(
    (requirement) =>
      requirement.permissionId === primaryPermission &&
      sameEntity(requirement.resource, primaryResource)
  );
  const sourceRequirements = plan.requirements.filter(
    (requirement) =>
      requirement.permissionId === "core:source_account.use" &&
      providerCreation !== null &&
      requirement.resource.tenantId === command.tenantId &&
      requirement.resource.entityTypeId === "core:source-account" &&
      String(requirement.resource.entityId) ===
        providerCreation.operation.sourceAccount.id
  );
  const expectsProvider = providerCreation !== null;
  const readDecision = readDecisions[0];
  const primaryDecision = primaryDecisions[0];
  const sourceDecision = sourceDecisions[0];
  const expectedPrimaryResourceAccessRevision =
    authority.kind === "moderate_internal"
      ? readDecision?.resourceAccessRevision
      : timelineItem.revision;
  const revisionResources = mutation.revisions.resources;
  const conversationFences = revisionResources.filter(
    (fence) =>
      fence.resourceKind === "conversation" &&
      String(fence.resourceId) === String(intent.conversation.id)
  );
  const sourceAccountFences = revisionResources.filter(
    (fence) =>
      fence.resourceKind === "source_account" &&
      providerCreation !== null &&
      String(fence.resourceId) ===
        String(providerCreation.operation.sourceAccount.id)
  );
  if (
    plan.tenantId !== command.tenantId ||
    plan.currentAuthorization.tenantId !== command.tenantId ||
    plan.currentAuthorization.authorizationEpoch !==
      requestScope.authorizationEpoch ||
    !requestScopeMatchesPlan(requestScope, plan) ||
    readDecisions.length !== 1 ||
    primaryDecisions.length !== 1 ||
    sourceDecisions.length !== (expectsProvider ? 1 : 0) ||
    readRequirements.length !== 1 ||
    primaryRequirements.length !== 1 ||
    sourceRequirements.length !== (expectsProvider ? 1 : 0) ||
    readDecision === undefined ||
    primaryDecision === undefined ||
    primaryDecision.resourceAccessRevision !==
      expectedPrimaryResourceAccessRevision ||
    conversationFences.length !== 1 ||
    conversationFences[0]?.expectedResourceAccessRevision !==
      readDecision.resourceAccessRevision ||
    conversationFences[0]?.advance !== "none" ||
    sourceAccountFences.length !== (expectsProvider ? 1 : 0) ||
    (expectsProvider &&
      (sourceDecision === undefined ||
        sourceAccountFences[0]?.expectedResourceAccessRevision !==
          sourceDecision.resourceAccessRevision ||
        sourceAccountFences[0]?.advance !== "none")) ||
    !lifecycleAuthorizationResourceFencesMatchDecisions(
      revisionResources,
      decisions,
      command.tenantId
    ) ||
    mutation.command.authorizationDecisionId !== primaryDecision.id ||
    !sameDecisionReferenceMultiset(decisions, auditDecisions) ||
    !exactCanonicalCatalogValues(
      mutation.records.audit.matchedPermissionIds,
      decisions.map((decision) => decision.permissionId)
    ) ||
    !exactCanonicalCatalogValues(
      mutation.records.audit.authorizationScopeIds,
      decisions.map((decision) => decision.resourceScopeId)
    ) ||
    !authorizationRequirementsMatchDecisions(plan.requirements, decisions) ||
    !lifecycleFileAuthorizationGuardsMatch(
      intent,
      plan.requirements,
      decisions
    ) ||
    !lifecyclePrimaryGuardMatches({
      intent,
      mutation,
      messageMutation,
      providerCreation,
      primaryPermission,
      primaryRequirement: primaryRequirements[0]!,
      readRequirement: readRequirements[0]!,
      sourceRequirement: sourceRequirements[0] ?? null
    })
  ) {
    return false;
  }
  if (providerCreation === null) return true;
  const route = providerCreation.outboundRoute;
  return (
    route !== null &&
    sourceDecision !== undefined &&
    route.authorizationEpoch === requestScope.authorizationEpoch &&
    route.conversation.id === intent.conversation.id &&
    route.sourceAccount.id === providerCreation.operation.sourceAccount.id &&
    route.requiredConversationPermissionId === readPermission &&
    lifecycleRouteAuthorizationSnapshotMatchesDecision(
      route.conversationAuthorization,
      readDecision,
      route,
      "conversation"
    ) &&
    lifecycleRouteAuthorizationSnapshotMatchesDecision(
      route.sourceAccountAuthorization,
      sourceDecision,
      route,
      "source_account"
    )
  );
}

type LifecycleAuthorizationResourceFence =
  WithInboxV2AuthorizedCommandMutationInput["revisions"]["resources"][number];

type LifecycleAuthorizationFencedResourceKind =
  LifecycleAuthorizationResourceFence["resourceKind"];

function lifecycleAuthorizationResourceFencesMatchDecisions(
  fences: readonly LifecycleAuthorizationResourceFence[],
  decisions: readonly InboxV2AuthorizationDecisionReference[],
  tenantId: string
): boolean {
  const mappedDecisions = decisions.map((decision) => ({
    decision,
    fenceKind: lifecycleAuthorizationFenceKindForDecision(decision)
  }));
  if (
    mappedDecisions.some(
      ({ decision, fenceKind }) =>
        decision.tenantId !== tenantId ||
        decision.resource.tenantId !== tenantId ||
        fenceKind === "unsupported"
    )
  ) {
    return false;
  }

  const fencedDecisions = mappedDecisions.filter(
    (
      entry
    ): entry is typeof entry & {
      fenceKind: LifecycleAuthorizationFencedResourceKind;
    } => entry.fenceKind !== null && entry.fenceKind !== "unsupported"
  );
  const fenceMatchesDecision = (
    fence: LifecycleAuthorizationResourceFence,
    entry: (typeof fencedDecisions)[number]
  ) =>
    fence.advance === "none" &&
    fence.resourceKind === entry.fenceKind &&
    String(fence.resourceId) === String(entry.decision.resource.entityId) &&
    String(fence.expectedResourceAccessRevision) ===
      String(entry.decision.resourceAccessRevision);

  return (
    fences.every(
      (fence) =>
        fence.advance === "none" &&
        fencedDecisions.some((entry) => fenceMatchesDecision(fence, entry))
    ) &&
    fencedDecisions.every(
      (entry) =>
        fences.filter((fence) => fenceMatchesDecision(fence, entry)).length ===
        1
    )
  );
}

function lifecycleAuthorizationFenceKindForDecision(
  decision: InboxV2AuthorizationDecisionReference
): LifecycleAuthorizationFencedResourceKind | null | "unsupported" {
  switch (decision.resource.entityTypeId) {
    case "core:conversation":
      return "conversation";
    case "core:client":
      return "client";
    case "core:source-account":
      return "source_account";
    case "core:work-item":
      return "work_item";
    case "core:timeline-item":
    case "core:file":
      return null;
    default:
      return "unsupported";
  }
}

type LifecycleOutboundRoute = NonNullable<
  InboxV2MessageProviderLifecycleOperationCreationCommit["outboundRoute"]
>;

function lifecycleRouteAuthorizationSnapshotMatchesDecision(
  snapshot:
    | LifecycleOutboundRoute["conversationAuthorization"]
    | LifecycleOutboundRoute["sourceAccountAuthorization"],
  decision: InboxV2AuthorizationDecisionReference,
  route: LifecycleOutboundRoute,
  resourceKind: "conversation" | "source_account"
): boolean {
  const expectedEntityTypeId =
    resourceKind === "conversation"
      ? "core:conversation"
      : "core:source-account";
  const expectedResourceId =
    resourceKind === "conversation"
      ? route.conversation.id
      : route.sourceAccount.id;
  const expectedDecisionKind =
    resourceKind === "conversation"
      ? "conversation_action"
      : "source_account_use";
  return (
    snapshot.decisionKind === expectedDecisionKind &&
    snapshot.tenantId === decision.tenantId &&
    lifecycleRouteAuthorizationPrincipalsMatch(
      snapshot.principal,
      decision.principal
    ) &&
    snapshot.effect === "allow" &&
    snapshot.requiredPermissionId === decision.permissionId &&
    snapshot.matchedPermissionIds.length === 1 &&
    snapshot.matchedPermissionIds[0] === decision.permissionId &&
    snapshot.decisionRevision === decision.decisionRevision &&
    snapshot.decidedAt === decision.decidedAt &&
    snapshot.notAfter === decision.notAfter &&
    decision.resource.tenantId === route.tenantId &&
    decision.resource.entityTypeId === expectedEntityTypeId &&
    String(decision.resource.entityId) === String(expectedResourceId) &&
    lifecycleRouteAuthorizationTargetMatchesRoute(snapshot.target, route)
  );
}

function lifecycleRouteAuthorizationTargetMatchesRoute(
  target: LifecycleOutboundRoute["conversationAuthorization"]["target"],
  route: LifecycleOutboundRoute
): boolean {
  const expectedReferenceTarget =
    route.referenceContext.kind === "none"
      ? { kind: "none" as const }
      : {
          kind: "external_message" as const,
          externalMessageReference:
            route.referenceContext.externalMessageReference,
          sourceOccurrence: route.referenceContext.sourceOccurrence
        };
  return (
    target.authorizationEpoch === route.authorizationEpoch &&
    sameTenantReference(target.conversation, route.conversation) &&
    sameTenantReference(target.externalThread, route.externalThread) &&
    sameTenantReference(
      target.sourceThreadBinding,
      route.sourceThreadBinding
    ) &&
    sameTenantReference(target.sourceAccount, route.sourceAccount) &&
    sameTenantReference(target.sourceConnection, route.sourceConnection) &&
    target.operationId === route.operationId &&
    target.contentKindId === route.contentKindId &&
    sameValue(target.bindingFence, route.bindingFence) &&
    sameValue(target.referenceTarget, expectedReferenceTarget)
  );
}

function lifecycleRouteAuthorizationPrincipalsMatch(
  routePrincipal: LifecycleOutboundRoute["principal"],
  decisionPrincipal: InboxV2AuthorizationDecisionReference["principal"]
): boolean {
  if (routePrincipal.kind !== decisionPrincipal.kind) return false;
  return routePrincipal.kind === "employee" &&
    decisionPrincipal.kind === "employee"
    ? sameTenantReference(routePrincipal.employee, decisionPrincipal.employee)
    : routePrincipal.kind === "trusted_service" &&
        decisionPrincipal.kind === "trusted_service" &&
        routePrincipal.trustedServiceId === decisionPrincipal.trustedServiceId;
}

function sameTenantReference(
  left: Readonly<{ tenantId: string; id: string }>,
  right: Readonly<{ tenantId: string; id: string }>
): boolean {
  return left.tenantId === right.tenantId && left.id === right.id;
}

type LifecycleAuthorizationIntent = Extract<
  InboxV2TimelineCommandIntent,
  { kind: "edit_message" | "delete_message_local" | "delete_message_provider" }
>;

function lifecyclePrimaryGuardMatches(
  input: Readonly<{
    intent: LifecycleAuthorizationIntent;
    mutation: WithInboxV2AuthorizedCommandMutationInput;
    messageMutation: MessageMutationCommit | null;
    providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null;
    primaryPermission: string;
    primaryRequirement: InboxV2AuthorizationPlanInput["requirements"][number];
    readRequirement: InboxV2AuthorizationPlanInput["requirements"][number];
    sourceRequirement:
      | InboxV2AuthorizationPlanInput["requirements"][number]
      | null;
  }>
): boolean {
  const timelineItem =
    input.messageMutation?.beforeTimelineItem ??
    input.providerCreation?.timelineItem;
  const message =
    input.messageMutation?.beforeMessage ?? input.providerCreation?.message;
  if (timelineItem === undefined || message === undefined) return false;
  const targetResource = {
    tenantId: input.intent.tenantId,
    entityTypeId: "core:timeline-item",
    entityId: timelineItem.id
  };
  const conversationResource = {
    tenantId: input.intent.tenantId,
    entityTypeId: "core:conversation",
    entityId: input.intent.conversation.id
  };
  const expectedOperation =
    input.intent.kind === "edit_message" ? "edit" : "delete";
  const externalBoundary =
    input.intent.kind === "delete_message_provider" ||
    (input.intent.kind === "edit_message" &&
      input.intent.transport.kind === "external") ||
    (input.intent.kind === "delete_message_local" &&
      input.intent.visibilityBoundary !== "internal");
  const expectedDeletionMode =
    input.intent.kind === "delete_message_provider"
      ? "provider_delete"
      : input.intent.kind === "delete_message_local"
        ? "local_tombstone"
        : null;
  const authority = input.intent.mutationAuthority;
  if (
    authority === undefined ||
    authority.timelineItem.tenantId !== input.intent.tenantId ||
    authority.timelineItem.id !== timelineItem.id
  ) {
    return false;
  }

  const guard = input.primaryRequirement.guard;
  let action:
    | Extract<
        typeof guard,
        { profileId: "core:rbac.guard.canonical_resource" }
      >["action"]
    | NonNullable<
        Extract<
          typeof guard,
          { profileId: "core:rbac.guard.internal_membership" }
        >["moderationAction"]
      >;
  if (input.primaryPermission === "core:message.moderate_internal") {
    if (
      guard.profileId !== "core:rbac.guard.internal_membership" ||
      guard.moderationAction === undefined ||
      guard.conversationId !== input.intent.conversation.id ||
      guard.membershipState !== "active" ||
      guard.membershipOrigin !== "hulee_internal_command" ||
      guard.contentBoundary !== "internal" ||
      (guard.validUntil !== null &&
        Date.parse(guard.validUntil) <= Date.parse(input.mutation.occurredAt))
    ) {
      return false;
    }
    action = guard.moderationAction;
  } else {
    if (
      guard.profileId !== "core:rbac.guard.canonical_resource" ||
      guard.resourceState !== "active" ||
      guard.routeInputFields.length !== 0 ||
      guard.contentBoundary !== (externalBoundary ? "external" : "none")
    ) {
      return false;
    }
    action = guard.action;
  }

  if (
    (authority.kind === "own" && action.kind !== "message_author_action") ||
    (authority.kind === "moderate_external" &&
      action.kind !== "external_moderation") ||
    (authority.kind === "moderate_internal" &&
      action.kind !== "internal_moderation") ||
    (action.kind !== "message_author_action" &&
      action.kind !== "external_moderation" &&
      action.kind !== "internal_moderation") ||
    action.operation !== expectedOperation ||
    !sameEntity(action.targetResource, targetResource) ||
    !revisionChecksAreCurrent(
      action.targetRevisionChecks,
      "entity",
      timelineItem.revision
    ) ||
    action.deletionMode !== expectedDeletionMode ||
    action.topologyBoundary !== (externalBoundary ? "external" : "internal") ||
    !sameEntity(action.topologyTimelineItemResource, targetResource) ||
    !sameEntity(action.topologyConversationResource, conversationResource) ||
    action.contentTopologyResource.tenantId !== input.intent.tenantId ||
    action.contentTopologyResource.entityTypeId !==
      "core:timeline-content-topology" ||
    !revisionChecksAreCurrent(action.topologyRevisionChecks, "state") ||
    !lifecycleHoldProofMatches(
      action.holdProof,
      targetResource,
      expectedDeletionMode
    )
  ) {
    return false;
  }

  if (action.kind === "message_author_action") {
    const participant =
      input.messageMutation?.actionParticipantSnapshot ??
      input.providerCreation?.actionParticipantSnapshot;
    if (
      authority.kind !== "own" ||
      input.mutation.command.actor.kind !== "employee" ||
      participant?.subject.kind !== "employee" ||
      action.actorEmployeeId !== input.mutation.command.actor.employeeId ||
      action.authorEmployeeId !== participant.subject.employee.id ||
      action.authorshipResource.tenantId !== input.intent.tenantId ||
      action.authorshipResource.entityTypeId !== "core:message-authorship" ||
      !sameEntity(action.authorshipTimelineItemResource, targetResource) ||
      action.authorshipEmployeeResource.entityTypeId !== "core:employee" ||
      String(action.authorshipEmployeeResource.entityId) !==
        String(participant.subject.employee.id) ||
      !revisionChecksAreCurrent(
        action.authorshipRevisionChecks,
        "relation",
        authority.expectedAuthorshipRevision
      ) ||
      action.contentReadRequirementIds.length !== 1 ||
      action.contentReadRequirementIds[0] !== input.readRequirement.id
    ) {
      return false;
    }
  } else {
    if (
      authority.kind === "own" ||
      action.reason !== authority.reasonId ||
      action.auditEventId !== input.mutation.records.audit.id ||
      action.contentReadRequirementId !== input.readRequirement.id ||
      !sameEntity(action.contentReadResource, conversationResource) ||
      !sameEntity(action.contentRelationTargetResource, targetResource) ||
      !sameEntity(action.contentRelationReadResource, conversationResource) ||
      !revisionChecksAreCurrent(
        action.contentRelationRevisionChecks,
        "relation"
      )
    ) {
      return false;
    }
  }

  if (input.providerCreation === null) {
    return (
      action.kind === "internal_moderation" ||
      lifecycleProviderGuardEvidenceIsAbsent(action)
    );
  }
  if (action.kind === "internal_moderation") return false;
  return lifecycleProviderGuardEvidenceMatches({
    action,
    creation: input.providerCreation,
    sourceRequirement: input.sourceRequirement,
    authorityAt: input.mutation.occurredAt,
    targetResource
  });
}

function lifecycleHoldProofMatches(
  proof: Readonly<{
    resource: Readonly<{
      tenantId: string;
      entityTypeId: string;
      entityId: unknown;
    }>;
    targetResource: Readonly<{
      tenantId: string;
      entityTypeId: string;
      entityId: unknown;
    }>;
    state: "none" | "active";
    revisionChecks: readonly Readonly<{
      kind: string;
      expected: string;
      actual: string;
    }>[];
  }> | null,
  targetResource: Readonly<{
    tenantId: string;
    entityTypeId: string;
    entityId: unknown;
  }>,
  deletionMode: "local_tombstone" | "provider_delete" | null
): boolean {
  if (deletionMode === null) return proof === null;
  return (
    proof !== null &&
    proof.state === "none" &&
    proof.resource.tenantId === targetResource.tenantId &&
    proof.resource.entityTypeId === "core:content-hold-index" &&
    sameEntity(proof.targetResource, targetResource) &&
    proof.revisionChecks.length === 1 &&
    revisionChecksAreCurrent(proof.revisionChecks, "legal_hold_set")
  );
}

function lifecycleLegalHoldFence(
  command: InboxV2MessageLifecycleCommand,
  plan: InboxV2AuthorizationPlanInput,
  authorized: InboxV2AuthorizedCommand,
  messageMutation: MessageMutationCommit | null,
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null
): InboxV2MessageLifecycleLegalHoldFence | null {
  if (command.kind === "edit") return null;
  const intent = authorized.intent.payload;
  if (
    intent.kind !== "delete_message_local" &&
    intent.kind !== "delete_message_provider"
  ) {
    deny();
  }
  const authority = intent.mutationAuthority;
  if (authority === undefined) deny();
  const permissionId =
    authority.kind === "moderate_external"
      ? "core:message.moderate_external"
      : authority.kind === "moderate_internal"
        ? "core:message.moderate_internal"
        : "core:message.delete_own";
  const requirements = plan.requirements.filter(
    (requirement) => requirement.permissionId === permissionId
  );
  if (requirements.length !== 1) deny();
  const guard = requirements[0]!.guard;
  const action =
    guard.profileId === "core:rbac.guard.internal_membership"
      ? guard.moderationAction
      : guard.profileId === "core:rbac.guard.canonical_resource"
        ? guard.action
        : undefined;
  if (
    action === undefined ||
    (action.kind !== "message_author_action" &&
      action.kind !== "external_moderation" &&
      action.kind !== "internal_moderation")
  ) {
    deny();
  }
  const proof = "holdProof" in action ? action.holdProof : null;
  const stateChecks = proof?.revisionChecks.filter(
    (check) => check.kind === "legal_hold_set"
  );
  const timelineItemId =
    messageMutation?.beforeTimelineItem.id ?? providerCreation?.timelineItem.id;
  if (
    proof === null ||
    proof === undefined ||
    proof.state !== "none" ||
    stateChecks?.length !== 1 ||
    stateChecks[0]?.expected !== stateChecks[0]?.actual ||
    timelineItemId === undefined ||
    String(proof.targetResource.entityId) !== String(timelineItemId)
  ) {
    deny();
  }
  const stateCheck = stateChecks[0]!;
  return Object.freeze({
    tenantId: command.tenantId,
    timelineItemId: String(timelineItemId),
    expectedLegalHoldSetRevision: stateCheck.expected
  });
}

function lifecycleProviderGuardEvidenceIsAbsent(
  action: Extract<
    NonNullable<
      Extract<
        InboxV2AuthorizationPlanInput["requirements"][number]["guard"],
        { profileId: "core:rbac.guard.canonical_resource" }
      >["action"]
    >,
    { kind: "message_author_action" | "external_moderation" }
  >
): boolean {
  return (
    action.originalRouteRequirementId === null &&
    action.originalSourceAccountId === null &&
    action.originalSourceAccountResource === null &&
    action.originalBindingResource === null &&
    action.originalBindingSourceAccountResource === null &&
    action.externalReferenceResource === null &&
    action.externalReferenceBindingResource === null &&
    action.externalReferenceTargetResource === null &&
    action.routeRevisionChecks.length === 0 &&
    action.capabilityId === null &&
    action.capabilityManifestResource === null &&
    action.capabilityManifestSourceAccountResource === null &&
    action.capabilityRevisionChecks.length === 0 &&
    action.capabilityState === "not_applicable" &&
    action.capabilityNotAfter === null
  );
}

function lifecycleProviderGuardEvidenceMatches(
  input: Readonly<{
    action: Extract<
      NonNullable<
        Extract<
          InboxV2AuthorizationPlanInput["requirements"][number]["guard"],
          { profileId: "core:rbac.guard.canonical_resource" }
        >["action"]
      >,
      { kind: "message_author_action" | "external_moderation" }
    >;
    creation: InboxV2MessageProviderLifecycleOperationCreationCommit;
    sourceRequirement:
      | InboxV2AuthorizationPlanInput["requirements"][number]
      | null;
    authorityAt: string;
    targetResource: Readonly<{
      tenantId: string;
      entityTypeId: string;
      entityId: unknown;
    }>;
  }>
): boolean {
  const route = input.creation.outboundRoute;
  const binding = input.creation.outboundBindingSnapshot;
  const source = input.creation.operation.sourceAccount;
  const sourceRequirement = input.sourceRequirement;
  const originalSourceAccountResource =
    input.action.originalSourceAccountResource;
  const originalBindingResource = input.action.originalBindingResource;
  const originalBindingSourceAccountResource =
    input.action.originalBindingSourceAccountResource;
  const externalReferenceResource = input.action.externalReferenceResource;
  const externalReferenceBindingResource =
    input.action.externalReferenceBindingResource;
  const externalReferenceTargetResource =
    input.action.externalReferenceTargetResource;
  const capabilityManifestResource = input.action.capabilityManifestResource;
  const capabilityManifestSourceAccountResource =
    input.action.capabilityManifestSourceAccountResource;
  if (
    route === null ||
    binding === null ||
    sourceRequirement === null ||
    originalSourceAccountResource === null ||
    originalBindingResource === null ||
    originalBindingSourceAccountResource === null ||
    externalReferenceResource === null ||
    externalReferenceBindingResource === null ||
    externalReferenceTargetResource === null ||
    capabilityManifestResource === null ||
    capabilityManifestSourceAccountResource === null ||
    input.action.originalRouteRequirementId !== sourceRequirement.id ||
    input.action.originalSourceAccountId !== source.id ||
    !sameEntity(originalSourceAccountResource, {
      tenantId: source.tenantId,
      entityTypeId: "core:source-account",
      entityId: source.id
    }) ||
    !sameEntity(originalBindingResource, {
      tenantId: source.tenantId,
      entityTypeId: "core:source-thread-binding",
      entityId: input.creation.operation.sourceThreadBinding.id
    }) ||
    !sameEntity(
      originalBindingSourceAccountResource,
      originalSourceAccountResource
    ) ||
    !sameEntity(externalReferenceResource, {
      tenantId: source.tenantId,
      entityTypeId: "core:external-message-reference",
      entityId: input.creation.externalMessageReference.id
    }) ||
    !sameEntity(externalReferenceBindingResource, originalBindingResource) ||
    !sameEntity(externalReferenceTargetResource, input.targetResource) ||
    input.action.capabilityId !==
      (input.creation.operation.action === "edit"
        ? "core:capability.message.edit"
        : "core:capability.message.delete") ||
    input.action.capabilityState !== "supported" ||
    capabilityManifestResource.entityTypeId !==
      "core:provider-capability-manifest" ||
    !sameEntity(
      capabilityManifestSourceAccountResource,
      originalSourceAccountResource
    ) ||
    !revisionChecksAreCurrent(
      input.action.capabilityRevisionChecks,
      "manifest",
      route.bindingFence.capabilityRevision
    ) ||
    !revisionChecksAreCurrent(input.action.routeRevisionChecks, "binding") ||
    !revisionChecksAreCurrent(input.action.routeRevisionChecks, "route") ||
    !revisionChecksAreCurrent(input.action.routeRevisionChecks, "state") ||
    (input.action.capabilityNotAfter !== null &&
      Date.parse(input.action.capabilityNotAfter) <=
        Date.parse(input.authorityAt)) ||
    !sourceRouteRequirementMatches(
      sourceRequirement,
      route,
      binding.bindingGeneration
    )
  ) {
    return false;
  }
  return true;
}

function sourceRouteRequirementMatches(
  requirement: InboxV2AuthorizationPlanInput["requirements"][number],
  route: NonNullable<
    InboxV2MessageProviderLifecycleOperationCreationCommit["outboundRoute"]
  >,
  bindingGeneration: string
): boolean {
  const guard = requirement.guard;
  return (
    guard.profileId === "core:rbac.guard.source_account_route" &&
    guard.operation.kind === "use" &&
    sameEntity(guard.operation.sourceAccountResource, requirement.resource) &&
    String(guard.operation.bindingResource.entityId) ===
      String(route.sourceThreadBinding.id) &&
    guard.sourceAccountId === route.sourceAccount.id &&
    guard.routeSourceAccountId === route.sourceAccount.id &&
    guard.sourceState === "active" &&
    guard.bindingState === "active" &&
    guard.bindingGeneration === bindingGeneration &&
    guard.expectedBindingGeneration === bindingGeneration &&
    guard.capabilityState === "supported"
  );
}

function revisionChecksAreCurrent(
  checks: readonly Readonly<{
    kind: string;
    expected: string;
    actual: string;
  }>[],
  kind: string,
  expectedRevision?: string
): boolean {
  return (
    checks.length > 0 &&
    checks.every((check) => check.expected === check.actual) &&
    checks.some(
      (check) =>
        check.kind === kind &&
        (expectedRevision === undefined || check.expected === expectedRevision)
    )
  );
}

function lifecycleDisclosureAuthorizationMatches(
  plan: InboxV2AuthorizationPlanInput,
  requestScope: InboxV2MessageLifecycleRequestScope,
  command: InboxV2MessageLifecycleCommand,
  visibilityBoundary: "external_work" | "internal"
): boolean {
  const requirement = plan.requirements[0];
  return (
    plan.tenantId === command.tenantId &&
    requestScopeMatchesPlan(requestScope, plan) &&
    plan.currentAuthorization.authorizationEpoch ===
      requestScope.authorizationEpoch &&
    plan.requirements.length === 1 &&
    requirement?.permissionId ===
      (visibilityBoundary === "internal"
        ? "core:conversation.internal.read"
        : "core:conversation.read") &&
    requirement.resource.tenantId === command.tenantId &&
    requirement.resource.entityTypeId === "core:conversation" &&
    String(requirement.resource.entityId) === command.conversationId
  );
}

function requestScopeMatchesPlan(
  requestScope: InboxV2MessageLifecycleRequestScope,
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

function lifecycleFileAuthorizationGuardsMatch(
  intent: InboxV2TimelineCommandIntent,
  requirements: InboxV2AuthorizationPlanInput["requirements"],
  decisions: readonly InboxV2AuthorizationDecisionReference[]
): boolean {
  const proofs =
    intent.kind === "edit_message" ? (intent.fileReadProofs ?? []) : [];
  const fileRequirements = requirements.filter(
    ({ permissionId }) =>
      permissionId === "core:file.view" || permissionId === "core:file.upload"
  );
  const fileDecisions = decisions.filter(
    ({ permissionId }) =>
      permissionId === "core:file.view" || permissionId === "core:file.upload"
  );
  const expectedKeys = new Map<string, (typeof proofs)[number]>();
  for (const proof of proofs) {
    const viewKey = fileAuthorityRequirementKey(
      "core:file.view",
      proof.file.id
    );
    const existingView = expectedKeys.get(viewKey);
    if (
      existingView !== undefined &&
      (existingView.expectedFileRevision !== proof.expectedFileRevision ||
        !sameValue(existingView.sourceParent, proof.sourceParent))
    ) {
      return false;
    }
    expectedKeys.set(viewKey, proof);
    if (proof.sourceParent.kind === "upload_staging") {
      expectedKeys.set(
        fileAuthorityRequirementKey("core:file.upload", proof.file.id),
        proof
      );
    }
  }
  if (
    fileRequirements.length !== expectedKeys.size ||
    fileDecisions.length !== expectedKeys.size
  ) {
    return false;
  }
  for (const [key, proof] of expectedKeys) {
    const separator = key.indexOf("\u0000");
    const permissionId = key.slice(0, separator) as
      | "core:file.view"
      | "core:file.upload";
    const matchingRequirements = fileRequirements.filter(
      (requirement) =>
        requirement.permissionId === permissionId &&
        sameEntity(requirement.resource, {
          tenantId: proof.file.tenantId,
          entityTypeId: "core:file",
          entityId: proof.file.id
        }) &&
        requirement.resourceAccessRevision === proof.expectedFileRevision
    );
    const matchingDecisions = fileDecisions.filter(
      (decision) =>
        decision.permissionId === permissionId &&
        sameEntity(decision.resource, {
          tenantId: proof.file.tenantId,
          entityTypeId: "core:file",
          entityId: proof.file.id
        }) &&
        decision.resourceAccessRevision === proof.expectedFileRevision
    );
    if (
      matchingRequirements.length !== 1 ||
      matchingDecisions.length !== 1 ||
      !fileParentGuardMatchesProof(
        matchingRequirements[0]!,
        proof,
        permissionId === "core:file.view" ? "view" : "upload"
      )
    ) {
      return false;
    }
  }
  return true;
}

function fileAuthorityRequirementKey(
  permissionId: "core:file.view" | "core:file.upload",
  fileId: string
): string {
  return `${permissionId}\u0000${fileId}`;
}

function fileParentGuardMatchesProof(
  requirement: InboxV2AuthorizationPlanInput["requirements"][number],
  proof: NonNullable<
    Extract<
      InboxV2TimelineCommandIntent,
      { kind: "edit_message" }
    >["fileReadProofs"]
  >[number],
  operation: "view" | "upload"
): boolean {
  const guard = requirement.guard;
  if (
    guard?.profileId !== "core:rbac.guard.file_parent_content" ||
    guard.operation !== operation
  ) {
    return false;
  }
  const fileResource = {
    tenantId: proof.file.tenantId,
    entityTypeId: "core:file",
    entityId: proof.file.id
  };
  const parentConversation =
    proof.sourceParent.kind === "upload_staging"
      ? proof.parentConversation
      : proof.sourceParent.conversation;
  const parentResource = {
    tenantId: parentConversation.tenantId,
    entityTypeId: "core:conversation",
    entityId: parentConversation.id
  };
  const boundary =
    proof.sourceParent.kind === "staff_note"
      ? "staff_only"
      : proof.sourceParent.kind === "message"
        ? proof.sourceParent.visibilityBoundary === "internal"
          ? "internal"
          : "external"
        : proof.visibilityBoundary === "internal"
          ? "internal"
          : "external";
  if (
    !sameEntity(guard.targetResource, fileResource) ||
    !sameEntity(guard.relationFileResource, fileResource) ||
    !sameEntity(guard.parentResource, parentResource) ||
    !sameEntity(guard.relationParentResource, parentResource) ||
    guard.parentBoundary !== boundary ||
    guard.relationBoundary !== boundary ||
    guard.expectedFileRevision !== proof.expectedFileRevision ||
    guard.currentFileRevision !== proof.expectedFileRevision ||
    !currentRevisionChecks(guard.parentRelationRevisionChecks, "relation")
  ) {
    return false;
  }
  if (proof.sourceParent.kind !== "upload_staging") return true;
  if (proof.sourceParent.appActor.kind !== "employee") return false;
  const uploaderEmployee = proof.sourceParent.appActor.employee;
  return (
    String(guard.uploaderEmployeeId) === String(uploaderEmployee.id) &&
    guard.uploaderRelationResource?.tenantId === uploaderEmployee.tenantId &&
    guard.uploaderRelationResource.entityTypeId ===
      "core:file-uploader-relation" &&
    guard.uploaderRelationFileResource !== null &&
    sameEntity(guard.uploaderRelationFileResource, fileResource) &&
    guard.uploaderEmployeeResource !== null &&
    sameEntity(guard.uploaderEmployeeResource, {
      tenantId: uploaderEmployee.tenantId,
      entityTypeId: "core:employee",
      entityId: uploaderEmployee.id
    }) &&
    currentRevisionChecks(guard.uploaderRevisionChecks, "relation")
  );
}

function currentRevisionChecks(
  checks: readonly Readonly<{
    kind: string;
    expected: string;
    actual: string;
  }>[],
  kind: string
): boolean {
  return (
    checks.length > 0 &&
    checks.every(
      (check) =>
        check.kind === kind && String(check.expected) === String(check.actual)
    )
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

function exactCanonicalCatalogValues(
  actual: readonly string[],
  expectedValues: readonly string[]
): boolean {
  const compare = (left: string, right: string) =>
    left === right ? 0 : left < right ? -1 : 1;
  const expected = [...new Set(expectedValues)].sort(compare);
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
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

function mapCoordinatedResult(
  command: InboxV2MessageLifecycleCommand,
  closed: ClosedLifecycleSelection,
  result: InboxV2AuthorizedCommandMutationResult<InboxV2MessageLifecycleAtomicResult>
): InboxV2MessageLifecycleCommandResult {
  if (result.kind === "already_applied") {
    return {
      outcome: "already_applied",
      action: command.kind,
      targetId: replayedTargetId(command, result.status),
      commit: result.status
    };
  }
  if (result.kind === "idempotency_conflict") {
    return { outcome: "idempotency_conflict" };
  }
  if (result.kind === "revision_conflict") {
    return { outcome: "revision_conflict" };
  }
  if (result.kind === "resource_not_found") return { outcome: "not_found" };
  if (result.kind !== "applied") {
    return { outcome: "authorization_conflict", conflict: result };
  }

  if (command.kind === "delete_provider") {
    const operationId = closed.providerOperationCreation?.operation.id;
    if (
      operationId === undefined ||
      result.result.messageId !== command.messageId ||
      result.result.messageRevision !== null ||
      result.result.providerOperationId !== operationId
    ) {
      deny();
    }
    return {
      outcome: "provider_delete_queued",
      messageId: command.messageId,
      providerOperationId: operationId,
      commit: result.status
    };
  }

  const revision = closed.messageMutation?.afterMessage.revision;
  if (
    revision === undefined ||
    result.result.messageId !== command.messageId ||
    result.result.messageRevision !== revision ||
    result.result.providerOperationId !==
      (closed.providerOperationCreation?.operation.id ?? null)
  ) {
    deny();
  }
  return {
    outcome: command.kind === "edit" ? "edited" : "deleted_local",
    messageId: command.messageId,
    messageRevision: revision,
    commit: result.status
  };
}

function assertReplayClosure(
  command: InboxV2MessageLifecycleCommand,
  scope: InboxV2MessageLifecycleRequestScope,
  replay: Extract<
    InboxV2PreparedMessageLifecycleCommand,
    { kind: "committed_replay" }
  >
): void {
  if (
    replay.requestHash !==
      calculateInboxV2MessageLifecycleIntentDigest(command) ||
    replay.status.publicResultCode !== publicResultCode(command) ||
    !idempotencyScopeMatches(command, scope, replay.scope)
  ) {
    deny();
  }
  replayedTargetId(command, replay.status);
}

function replayedTargetId(
  command: InboxV2MessageLifecycleCommand,
  status: InboxV2PrivilegedAuthorizationMutationReplayStatus
): string {
  const reference = status.resultReference;
  const providerDelete = command.kind === "delete_provider";
  if (
    reference === null ||
    reference.tenantId !== command.tenantId ||
    reference.schemaId !==
      (providerDelete
        ? INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID
        : INBOX_V2_MESSAGE_SCHEMA_ID) ||
    reference.schemaVersion !==
      (providerDelete
        ? INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION
        : INBOX_V2_MESSAGE_SCHEMA_VERSION) ||
    (!providerDelete && reference.recordId !== command.messageId)
  ) {
    deny();
  }
  return reference.recordId;
}

function idempotencyScopeMatches(
  command: InboxV2MessageLifecycleCommand,
  requestScope: InboxV2MessageLifecycleRequestScope,
  scope: InboxV2MessageLifecycleIdempotencyScope
): boolean {
  const principal = inboxV2OutboundRoutePrincipalSchema.safeParse(
    scope.principal
  );
  return (
    principal.success &&
    scope.tenantId === command.tenantId &&
    scope.tenantId === requestScope.tenantId &&
    scope.authorizationEpoch === requestScope.authorizationEpoch &&
    scope.commandTypeId === commandTypeId(command) &&
    scope.clientMutationId === command.clientMutationId &&
    scope.publicResultCode === publicResultCode(command) &&
    samePrincipal(principal.data, requestScope.principal)
  );
}

function commandPrincipalMatchesScope(
  command: InboxV2AuthorizedCommand,
  scope: InboxV2MessageLifecycleRequestScope
): boolean {
  if (command.principal.kind !== scope.principal.kind) return false;
  return command.principal.kind === "employee" &&
    scope.principal.kind === "employee"
    ? command.principal.employee.id === scope.principal.employee.id &&
        command.principal.employee.tenantId === scope.tenantId &&
        command.principal.authorization.value === scope.authorizationEpoch
    : command.principal.kind === "trusted_service" &&
        scope.principal.kind === "trusted_service" &&
        command.principal.trustedServiceId ===
          scope.principal.trustedServiceId &&
        command.principal.authorizationEpoch === scope.authorizationEpoch;
}

function mutationActorMatchesScope(
  actor: WithInboxV2AuthorizedCommandMutationInput["command"]["actor"],
  scope: InboxV2MessageLifecycleRequestScope
): boolean {
  return actor.kind === "employee" && scope.principal.kind === "employee"
    ? actor.employeeId === scope.principal.employee.id
    : actor.kind === "trusted_service" &&
        scope.principal.kind === "trusted_service" &&
        actor.trustedServiceId === scope.principal.trustedServiceId;
}

function mutationAuthorityMatchesIntent(
  intent: Extract<
    InboxV2TimelineCommandIntent,
    {
      kind: "edit_message" | "delete_message_local" | "delete_message_provider";
    }
  >
): boolean {
  const authority = intent.mutationAuthority;
  return (
    authority !== undefined &&
    authority.conversation.id === intent.conversation.id &&
    authority.message.id === intent.message.id &&
    sameValue(authority.appActor, intent.appActor)
  );
}

function assertOwnAuthorityMaterialization(
  intent: Extract<
    InboxV2TimelineCommandIntent,
    {
      kind: "edit_message" | "delete_message_local" | "delete_message_provider";
    }
  >,
  beforeMessage: Readonly<{
    conversation: Readonly<{ id: string }>;
    authorParticipant: Readonly<{ id: string }>;
  }>,
  actionParticipantSnapshot: Readonly<{
    id: string;
    revision: string;
    conversation: Readonly<{ id: string }>;
    subject: Readonly<{
      kind: string;
      employee?: Readonly<{ id: string }>;
    }>;
  }> | null,
  actionParticipant: Readonly<{ id: string }> | null
): void {
  const authority = intent.mutationAuthority;
  if (
    authority?.kind === "own" &&
    (authority.authorParticipant.id !== beforeMessage.authorParticipant.id ||
      actionParticipantSnapshot === null ||
      authority.expectedAuthorshipRevision !==
        actionParticipantSnapshot.revision ||
      actionParticipantSnapshot?.id !== authority.authorParticipant.id ||
      actionParticipantSnapshot.conversation.id !==
        beforeMessage.conversation.id ||
      (intent.appActor.kind === "employee" &&
        (actionParticipantSnapshot.subject.kind !== "employee" ||
          actionParticipantSnapshot.subject.employee?.id !==
            intent.appActor.employee.id)) ||
      actionParticipant?.id !== authority.authorParticipant.id)
  ) {
    deny();
  }
}

function commandTypeId(
  command: InboxV2MessageLifecycleCommand
): InboxV2MessageLifecycleIdempotencyScope["commandTypeId"] {
  switch (command.kind) {
    case "edit":
      return "core:message.edit";
    case "delete_local":
      return "core:message.delete_local";
    case "delete_provider":
      return "core:message.delete_provider";
  }
}

function publicResultCode(
  command: InboxV2MessageLifecycleCommand
): InboxV2MessageLifecycleIdempotencyScope["publicResultCode"] {
  switch (command.kind) {
    case "edit":
      return "core:message.edited";
    case "delete_local":
      return "core:message.deleted_local";
    case "delete_provider":
      return "core:message.provider_delete_queued";
  }
}

function normalizeRequestScope(
  input: InboxV2MessageLifecycleRequestScope
): InboxV2MessageLifecycleRequestScope {
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
  input: InboxV2MessageLifecycleCommand
): InboxV2MessageLifecycleCommand {
  if (typeof input !== "object" || input === null || !("kind" in input)) {
    throw new CoreError(
      "validation.failed",
      "Message lifecycle command is invalid."
    );
  }
  const baseKeys = [
    "kind",
    "tenantId",
    "conversationId",
    "messageId",
    "expectedMessageRevision",
    "clientMutationId"
  ];
  const common = {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    messageId: inboxV2MessageIdSchema.parse(input.messageId),
    expectedMessageRevision: inboxV2EntityRevisionSchema.parse(
      input.expectedMessageRevision
    ),
    clientMutationId: inboxV2ClientMutationIdSchema.parse(
      input.clientMutationId
    )
  };
  if (input.kind === "edit" && hasOnlyKeys(input, [...baseKeys, "content"])) {
    return Object.freeze({
      kind: "edit",
      ...common,
      content: inboxV2TimelineContentDraftSchema.parse(input.content)
    });
  }
  if (
    (input.kind === "delete_local" || input.kind === "delete_provider") &&
    hasOnlyKeys(input, [...baseKeys, "reasonId"])
  ) {
    return Object.freeze({
      kind: input.kind,
      ...common,
      reasonId: inboxV2CatalogIdSchema.parse(input.reasonId)
    });
  }
  throw new CoreError(
    "validation.failed",
    "Message lifecycle accepts only kind, tenant, conversation, message, expected revision, content/reason and client mutation ID."
  );
}

function samePrincipal(
  left: InboxV2OutboundRoutePrincipal,
  right: InboxV2OutboundRoutePrincipal
): boolean {
  return left.kind === "employee" && right.kind === "employee"
    ? left.employee.tenantId === right.employee.tenantId &&
        left.employee.id === right.employee.id
    : left.kind === "trusted_service" &&
        right.kind === "trusted_service" &&
        left.trustedServiceId === right.trustedServiceId;
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
