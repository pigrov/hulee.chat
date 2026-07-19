import {
  INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  calculateInboxV2CanonicalSha256,
  calculateInboxV2MessageContentDigest,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2CatalogIdSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2CommandIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2CorrelationIdSchema,
  inboxV2EntityKeySchema,
  inboxV2EntityRevisionSchema,
  inboxV2EventIdSchema,
  inboxV2InternalOpaqueReferenceSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageMutationCommitSchema,
  inboxV2NamespacedIdSchema,
  inboxV2OutboxIntentIdSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2RequestIdSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantIdSchema,
  inboxV2TenantStreamChangeIdSchema,
  inboxV2TimestampSchema,
  inboxV2TimelineContentHeadOf,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2MessageContentBlock,
  type InboxV2PayloadReference
} from "@hulee/contracts";
import { sql } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { deriveInboxV2AttachmentMaterializationAuditReference } from "./sql-inbox-v2-atomic-materialization-internal";
import {
  deriveInboxV2AttachmentMaterializationFailureReasonId,
  prepareFailedAttachmentMaterializationInTransaction,
  prepareReadyAttachmentMaterializationInTransaction,
  sealPreparedFailedAttachmentMaterializationInMessageMutation,
  sealPreparedReadyAttachmentMaterializationInMessageMutation,
  type FinalizeInboxV2AttachmentMaterializationResult,
  type InboxV2AppliedAttachmentMaterializationClosure,
  type InboxV2AttachmentMaterializationClaim,
  type InboxV2AttachmentMaterializationContentFence,
  type InboxV2PreparedFailedAttachmentMaterializationCapability,
  type InboxV2PreparedReadyAttachmentMaterializationCapability
} from "./sql-inbox-v2-file-object-repository";
import {
  INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID,
  computeInboxV2TimelineMessageCommitDigest,
  prepareInboxV2AttachmentMaterializationMessageMutation,
  readInboxV2AttachmentMaterializationMessageCurrent,
  sealInboxV2PreparedAttachmentMaterializationMessageMutation,
  type InboxV2MessageMutationCommit,
  type InboxV2MessageMutationPlanCurrent,
  type InboxV2PreparedAttachmentMaterializationMessageMutationCapability
} from "./sql-inbox-v2-timeline-message-repository";
import {
  computeInboxV2TenantStreamManifestDigest,
  createSqlInboxV2AuthorizedCommandCoordinator,
  type InboxV2AuthorizedAtomicMaterializationCoordinator,
  type InboxV2AuthorizedCommandMutationResult,
  type InboxV2AuthorizationTransactionExecutor,
  type InboxV2PrivilegedAuthorizationMutationReplayStatus,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export const INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_RESULT_CODE =
  "core:attachment.materialization.completed" as const;

const MAX_REBASE_ATTEMPTS = 4;

export type InboxV2AttachmentMaterializationTerminalOutcome =
  | Readonly<{
      kind: "ready";
      storage: Readonly<{
        storageKey: string;
        storageVersionId: string;
        checksumSha256: string;
        sizeBytes: number;
        mediaType: string;
        putOutcome: "created" | "already_exists";
      }>;
    }>
  | Readonly<{
      kind: "failed";
      code: string;
      retryable: boolean;
    }>;

export type InboxV2AttachmentMaterializationTerminalIntent = Readonly<{
  claim: InboxV2AttachmentMaterializationClaim;
  outcome: InboxV2AttachmentMaterializationTerminalOutcome;
  requestHash: string;
  commandId: string;
  requestId: string;
  clientMutationId: string;
}>;

type TerminalReplay = Readonly<{
  kind: "committed_replay";
  tenantId: string;
  commandTypeId: typeof INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID;
  clientMutationId: string;
  requestHash: string;
  status: InboxV2PrivilegedAuthorizationMutationReplayStatus;
}>;

type TerminalIdempotencyConflict = Readonly<{
  kind: "idempotency_conflict";
  tenantId: string;
  commandTypeId: typeof INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID;
  clientMutationId: string;
}>;

export type InboxV2PreparedAttachmentMaterializationTerminalCommand =
  | TerminalReplay
  | TerminalIdempotencyConflict
  | Readonly<{
      kind: "selected";
      current: InboxV2MessageMutationPlanCurrent;
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
    }>;

/**
 * Server-only policy/DB boundary. Replay lookup must query the durable command
 * scope before loading the mutable Message content head. `prepareNew` owns all
 * current RBAC/revision reads and never accepts decisions from provider data.
 */
export type InboxV2AttachmentMaterializationTerminalCommandPreparer = Readonly<{
  lookupIdempotency(
    intent: InboxV2AttachmentMaterializationTerminalIntent
  ): Promise<TerminalReplay | TerminalIdempotencyConflict | null>;
  prepareNew(
    intent: InboxV2AttachmentMaterializationTerminalIntent
  ): Promise<InboxV2PreparedAttachmentMaterializationTerminalCommand | null>;
}>;

type AtomicTerminalResult = Readonly<{
  messageId: string;
  messageRevision: string;
  contentId: string;
  contentRevision: string;
  materialization: InboxV2AppliedAttachmentMaterializationClosure;
}>;

type AtomicTerminalFailure = Exclude<
  InboxV2AuthorizedCommandMutationResult<AtomicTerminalResult>,
  { kind: "applied" | "already_applied" }
>;

export type InboxV2AttachmentMaterializationTerminalCommandResult =
  | Readonly<{
      kind: "applied";
      result: AtomicTerminalResult;
      status: Extract<
        InboxV2AuthorizedCommandMutationResult<AtomicTerminalResult>,
        { kind: "applied" }
      >["status"];
    }>
  | Readonly<{
      kind: "already_applied";
      status: InboxV2PrivilegedAuthorizationMutationReplayStatus;
    }>
  | Readonly<{ kind: "idempotency_conflict" }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{
      kind: "materialization_conflict";
      reason:
        | "already_applied_without_command"
        | "lease_lost"
        | "message_state_conflict"
        | "state_conflict";
    }>
  | Readonly<{
      kind: "authorization_conflict";
      conflict: AtomicTerminalFailure;
    }>;

export type InboxV2AttachmentMaterializationTerminalPersistenceForTest =
  Readonly<{
    prepareMessage: typeof prepareInboxV2AttachmentMaterializationMessageMutation;
    sealMessage: typeof sealInboxV2PreparedAttachmentMaterializationMessageMutation;
    prepareReadyFile: typeof prepareReadyAttachmentMaterializationInTransaction;
    sealReadyFile: typeof sealPreparedReadyAttachmentMaterializationInMessageMutation;
    prepareFailedFile: typeof prepareFailedAttachmentMaterializationInTransaction;
    sealFailedFile: typeof sealPreparedFailedAttachmentMaterializationInMessageMutation;
  }>;

export type InboxV2AttachmentMaterializationTerminalCommandServiceOptions =
  Readonly<{
    preparer: InboxV2AttachmentMaterializationTerminalCommandPreparer;
    coordinator: InboxV2AuthorizedAtomicMaterializationCoordinator;
    maximumRebaseAttempts?: number;
  }>;

export type InboxV2AttachmentMaterializationTerminalCommandService = Readonly<{
  ready(input: {
    claim: InboxV2AttachmentMaterializationClaim;
    storage: Extract<
      InboxV2AttachmentMaterializationTerminalOutcome,
      { kind: "ready" }
    >["storage"];
  }): Promise<InboxV2AttachmentMaterializationTerminalCommandResult>;
  failed(input: {
    claim: InboxV2AttachmentMaterializationClaim;
    code: string;
    retryable: boolean;
  }): Promise<InboxV2AttachmentMaterializationTerminalCommandResult>;
}>;

type PreparedAtomicTerminal = Readonly<{
  message: InboxV2PreparedAttachmentMaterializationMessageMutationCapability;
  file:
    | Readonly<{
        kind: "ready";
        capability: InboxV2PreparedReadyAttachmentMaterializationCapability;
      }>
    | Readonly<{
        kind: "failed";
        capability: InboxV2PreparedFailedAttachmentMaterializationCapability;
      }>;
}>;

const productionPersistence: InboxV2AttachmentMaterializationTerminalPersistenceForTest =
  Object.freeze({
    prepareMessage: prepareInboxV2AttachmentMaterializationMessageMutation,
    sealMessage: sealInboxV2PreparedAttachmentMaterializationMessageMutation,
    prepareReadyFile: prepareReadyAttachmentMaterializationInTransaction,
    sealReadyFile: sealPreparedReadyAttachmentMaterializationInMessageMutation,
    prepareFailedFile: prepareFailedAttachmentMaterializationInTransaction,
    sealFailedFile: sealPreparedFailedAttachmentMaterializationInMessageMutation
  });

type TerminalCommandReplayRow = Readonly<{
  id: unknown;
  request_hash: unknown;
  mutation_id: unknown;
  public_result_code: unknown;
  result_reference: unknown;
  stream_commit_id: unknown;
  stream_epoch: unknown;
  stream_position: unknown;
  committed_at: unknown;
}>;

type TerminalAuthorityRow = Readonly<{
  authorization_decision_id: unknown;
  authorization_epoch: unknown;
  authorization_decision_refs: unknown;
  actor_trusted_service_id: unknown;
  tenant_rbac_revision: unknown;
  shared_access_revision: unknown;
  resource_head_id: unknown;
  resource_access_revision: unknown;
  structural_relation_revision: unknown;
  collaborator_set_revision: unknown;
  audit_grant_source_ids: unknown;
  audit_policy_version: unknown;
  stream_epoch: unknown;
  database_now: unknown;
}>;

/** Concrete DB preparer; provider input never supplies authorization facts. */
export function createSqlInboxV2AttachmentMaterializationTerminalCommandPreparer(
  executor: InboxV2AuthorizationTransactionExecutor | HuleeDatabase
): InboxV2AttachmentMaterializationTerminalCommandPreparer {
  const transactionExecutor =
    executor as unknown as InboxV2AuthorizationTransactionExecutor;
  return Object.freeze({
    lookupIdempotency: (intent) =>
      transactionExecutor.transaction(
        (transaction) => loadTerminalReplay(transaction, intent),
        { isolationLevel: "read committed" }
      ),
    prepareNew: (intent) =>
      transactionExecutor.transaction(
        async (transaction) => {
          const replay = await loadTerminalReplay(transaction, intent);
          if (replay !== null) return replay;
          const authority = await loadTerminalAuthority(transaction, intent);
          if (authority === null) return null;
          const trustedServiceId = trustedReservationServiceId(intent.claim);
          const occurredAt = databaseTimestamp(authority.database_now);
          const decisions = parseTerminalDecisions(
            authority.authorization_decision_refs
          );
          assertPersistedTerminalAuthority(
            intent,
            authority,
            decisions,
            occurredAt,
            trustedServiceId
          );
          const current =
            await readInboxV2AttachmentMaterializationMessageCurrent(
              transaction,
              {
                tenantId: inboxV2TenantIdSchema.parse(intent.claim.tenantId),
                conversationId: inboxV2ConversationIdSchema.parse(
                  intent.claim.contentOrigin.conversationId
                ),
                messageId: inboxV2MessageIdSchema.parse(
                  intent.claim.contentOrigin.parentEntityId
                )
              }
            );
          if (current === null) return null;
          const plan = planInboxV2AttachmentMaterializationMessageMutation({
            current,
            intent,
            occurredAt,
            trustedServiceId
          });
          return {
            kind: "selected" as const,
            current,
            authorizedMutation: buildTerminalAuthorizedMutation({
              intent,
              plan,
              authority,
              decisions,
              occurredAt,
              trustedServiceId
            })
          };
        },
        { isolationLevel: "read committed" }
      )
  });
}

async function loadTerminalReplay(
  executor: RawSqlExecutor,
  intent: InboxV2AttachmentMaterializationTerminalIntent
): Promise<TerminalReplay | TerminalIdempotencyConflict | null> {
  const result = await executor.execute<TerminalCommandReplayRow>(sql`
    select command.id, command.request_hash, command.mutation_id,
           command.public_result_code, command.result_reference,
           stream_commit.id as stream_commit_id, stream_commit.stream_epoch,
           stream_commit.position as stream_position,
           stream_commit.committed_at
      from inbox_v2_auth_command_records command
      left join inbox_v2_tenant_stream_commits stream_commit
        on stream_commit.tenant_id = command.tenant_id
       and stream_commit.mutation_id = command.mutation_id
     where command.tenant_id = ${intent.claim.tenantId}
       and command.actor_kind = 'trusted_service'
       and command.actor_employee_id is null
       and command.actor_trusted_service_id =
         ${trustedReservationServiceId(intent.claim)}
       and command.command_type_id =
         ${INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID}
       and command.client_mutation_id = ${intent.clientMutationId}
     for update of command
  `);
  if (result.rows.length > 1) {
    throw new TypeError("Terminal command replay scope is not unique.");
  }
  const row = result.rows[0];
  if (row === undefined) return null;
  const requestHash = requiredString(row.request_hash, "terminal request hash");
  if (requestHash !== intent.requestHash) {
    return {
      kind: "idempotency_conflict",
      tenantId: intent.claim.tenantId,
      commandTypeId:
        INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID,
      clientMutationId: intent.clientMutationId
    };
  }
  const mutationId = nullableString(row.mutation_id);
  if (mutationId === null) {
    throw new TypeError("Terminal command cannot remain pending after commit.");
  }
  return {
    kind: "committed_replay",
    tenantId: intent.claim.tenantId,
    commandTypeId:
      INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID,
    clientMutationId: intent.clientMutationId,
    requestHash,
    status: {
      commandId: requiredString(row.id, "terminal command ID"),
      mutationId,
      publicResultCode: requiredString(
        row.public_result_code,
        "terminal result code"
      ),
      resultReference:
        row.result_reference === null
          ? null
          : inboxV2PayloadReferenceSchema.parse(row.result_reference),
      streamCommitId: requiredString(
        row.stream_commit_id,
        "terminal stream commit ID"
      ),
      streamEpoch: requiredString(row.stream_epoch, "terminal stream epoch"),
      streamPosition: positiveCounter(
        row.stream_position,
        "terminal stream position"
      ),
      committedAt: databaseTimestamp(row.committed_at)
    }
  };
}

async function loadTerminalAuthority(
  executor: RawSqlExecutor,
  intent: InboxV2AttachmentMaterializationTerminalIntent
): Promise<TerminalAuthorityRow | null> {
  const claim = intent.claim;
  const result = await executor.execute<TerminalAuthorityRow>(sql`
    select reservation.authorization_decision_id,
           reservation.authorization_epoch,
           reservation.authorization_decision_refs,
           reservation.actor_trusted_service_id,
           tenant_head.tenant_rbac_revision,
           tenant_head.shared_access_revision,
           resource_head.id as resource_head_id,
           resource_head.resource_access_revision,
           resource_head.structural_relation_revision,
           resource_head.collaborator_set_revision,
           reservation_audit.grant_source_ids as audit_grant_source_ids,
           reservation_audit.policy_version as audit_policy_version,
           stream_head.stream_epoch,
           clock.database_now
      from inbox_v2_auth_command_records reservation
      join inbox_v2_auth_tenant_heads tenant_head
        on tenant_head.tenant_id = reservation.tenant_id
      join inbox_v2_auth_resource_heads resource_head
        on resource_head.tenant_id = reservation.tenant_id
       and resource_head.resource_kind = 'conversation'
       and resource_head.conversation_id =
         ${claim.contentOrigin.conversationId}
      join inbox_v2_auth_audit_events reservation_audit
        on reservation_audit.tenant_id = reservation.tenant_id
       and reservation_audit.command_record_id = reservation.id
       and reservation_audit.mutation_id = reservation.mutation_id
      join inbox_v2_tenant_stream_heads stream_head
        on stream_head.tenant_id = reservation.tenant_id
      cross join (select clock_timestamp() as database_now) clock
     where reservation.tenant_id = ${claim.tenantId}
       and reservation.id = ${claim.reservationAuthority.commandId}
       and reservation.command_type_id =
         ${claim.reservationAuthority.commandTypeId}
       and reservation.client_mutation_id =
         ${claim.reservationAuthority.clientMutationId}
       and reservation.mutation_id = ${claim.reservationAuthority.mutationId}
       and reservation.authorization_decision_id =
         ${claim.reservationAuthority.decisionId}
       and reservation.authorization_epoch =
         ${claim.reservationAuthority.epoch}
       and reservation.actor_kind = 'trusted_service'
       and reservation.actor_trusted_service_id =
         ${trustedReservationServiceId(claim)}
       and reservation.state = 'completed'
     for share of reservation, tenant_head, resource_head, reservation_audit,
       stream_head
  `);
  if (result.rows.length > 1) {
    throw new TypeError("Terminal reservation authority is not unique.");
  }
  return result.rows[0] ?? null;
}

function assertPersistedTerminalAuthority(
  intent: InboxV2AttachmentMaterializationTerminalIntent,
  row: TerminalAuthorityRow,
  decisions: readonly InboxV2AuthorizationDecisionReference[],
  occurredAt: string,
  trustedServiceId: string
): void {
  const claim = intent.claim;
  const accessRevision = requiredString(
    row.resource_access_revision,
    "terminal resource access revision"
  );
  const persistedGrantSourceIds = parseTerminalGrantSourceIds(
    row.audit_grant_source_ids
  );
  const claimedGrantSourceIds = parseTerminalGrantSourceIds(
    claim.reservationAuthority.auditGrantSourceIds
  );
  const persistedPolicyVersion = nullableString(row.audit_policy_version);
  if (
    requiredString(row.authorization_decision_id, "terminal decision ID") !==
      claim.reservationAuthority.decisionId ||
    requiredString(row.authorization_epoch, "terminal authorization epoch") !==
      claim.reservationAuthority.epoch ||
    requiredString(row.actor_trusted_service_id, "terminal trusted service") !==
      trustedServiceId ||
    requiredString(
      row.tenant_rbac_revision,
      "terminal tenant RBAC revision"
    ) !== claim.reservationAuthority.tenantRbacRevision ||
    requiredString(
      row.shared_access_revision,
      "terminal shared access revision"
    ) !== claim.reservationAuthority.sharedAccessRevision ||
    requiredString(row.resource_head_id, "terminal resource head ID") !==
      claim.reservationAuthority.resourceHeadId ||
    accessRevision !== claim.reservationAuthority.resourceAccessRevision ||
    requiredString(
      row.structural_relation_revision,
      "terminal structural relation revision"
    ) !== claim.reservationAuthority.structuralRelationRevision ||
    requiredString(
      row.collaborator_set_revision,
      "terminal collaborator-set revision"
    ) !== claim.reservationAuthority.collaboratorSetRevision ||
    !sameValue(persistedGrantSourceIds, claimedGrantSourceIds) ||
    persistedPolicyVersion !== claim.reservationAuthority.auditPolicyVersion ||
    decisions.length !== 2 ||
    decisions.some(
      (decision) =>
        decision.tenantId !== claim.tenantId ||
        decision.authorizationEpoch !== claim.reservationAuthority.epoch ||
        decision.principal.kind !== "trusted_service" ||
        decision.principal.trustedServiceId !== trustedServiceId ||
        decision.outcome !== "allowed" ||
        decision.resourceScopeId !== "core:conversation" ||
        decision.resource.entityTypeId !== "core:conversation" ||
        String(decision.resource.entityId) !==
          String(claim.contentOrigin.conversationId) ||
        String(decision.resourceAccessRevision) !== accessRevision ||
        Date.parse(occurredAt) >= Date.parse(decision.notAfter)
    )
  ) {
    throw new TerminalMaterializationRollback("state_conflict", false);
  }
}

function buildTerminalAuthorizedMutation(input: {
  intent: InboxV2AttachmentMaterializationTerminalIntent;
  plan: ReturnType<typeof planInboxV2AttachmentMaterializationMessageMutation>;
  authority: TerminalAuthorityRow;
  decisions: readonly InboxV2AuthorizationDecisionReference[];
  occurredAt: string;
  trustedServiceId: string;
}): WithInboxV2AuthorizedCommandMutationInput {
  const { intent, plan, authority, decisions, occurredAt, trustedServiceId } =
    input;
  const claim = intent.claim;
  const commit = plan.commit;
  const ids = terminalRecordIds(intent, commit);
  const messageReference = payloadReference({
    tenantId: claim.tenantId,
    recordId: commit.afterMessage.id,
    schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
    payload: commit.afterMessage
  });
  const domainCommitReference = payloadReference({
    tenantId: claim.tenantId,
    recordId: commit.revision.id,
    schemaId: INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
    payload: commit.revision
  });
  const requiredPermissions = [
    "core:file.upload",
    commit.beforeTimelineItem.visibility === "conversation_external"
      ? "core:conversation.read"
      : "core:conversation.internal.read"
  ].sort(compareText);
  const entity = inboxV2EntityKeySchema.parse({
    tenantId: claim.tenantId,
    entityTypeId: "core:message",
    entityId: commit.afterMessage.id
  });
  const auditTarget = internalEntityReference(
    claim.tenantId,
    "core:message",
    "message",
    commit.afterMessage.id
  );
  const eventHash = terminalEventHash({
    ids,
    intent,
    domainCommitReference,
    decisions,
    occurredAt
  });
  const projectionIntentHash = terminalProjectionIntentHash({
    ids,
    claim,
    occurredAt
  });
  const change: WithInboxV2AuthorizedCommandMutationInput["records"]["changes"][number] =
    {
      id: ids.changeId,
      ordinal: 1,
      entity,
      resultingRevision: commit.afterMessage.revision,
      timeline: {
        conversation: commit.afterMessage.conversation,
        timelineSequence: commit.afterTimelineItem.timelineSequence
      },
      audience:
        commit.beforeTimelineItem.visibility === "conversation_external"
          ? ("conversation_external" as const)
          : ("internal_participants" as const),
      state: {
        kind: "upsert" as const,
        stateSchemaId: inboxV2NamespacedIdSchema.parse(
          INBOX_V2_MESSAGE_SCHEMA_ID
        ),
        stateSchemaVersion: messageReference.schemaVersion,
        stateHash: messageReference.digest,
        payloadReference: messageReference,
        domainCommitReference
      }
    };
  const event: WithInboxV2AuthorizedCommandMutationInput["records"]["events"][number] =
    {
      id: ids.eventId,
      typeId: "core:message.changed" as const,
      payloadSchemaId: inboxV2NamespacedIdSchema.parse(
        INBOX_V2_MESSAGE_REVISION_SCHEMA_ID
      ),
      payloadSchemaVersion: domainCommitReference.schemaVersion,
      ordinal: inboxV2EntityRevisionSchema.parse("1"),
      changeIds: [ids.changeId],
      subjects: [entity],
      payloadReference: domainCommitReference,
      correlationId: inboxV2CorrelationIdSchema.parse(claim.correlationId),
      commandIds: [inboxV2CommandIdSchema.parse(intent.commandId)],
      clientMutationIds: [
        inboxV2ClientMutationIdSchema.parse(intent.clientMutationId)
      ],
      authorizationDecisionRefs: [...decisions],
      accessEffect: { kind: "none" as const },
      occurredAt,
      recordedAt: occurredAt,
      eventHash: inboxV2Sha256DigestSchema.parse(eventHash)
    };
  const outbox: WithInboxV2AuthorizedCommandMutationInput["records"]["outboxIntents"][number] =
    {
      id: ids.outboxIntentId,
      ordinal: 1,
      typeId: "core:projection.update" as const,
      handlerId: inboxV2NamespacedIdSchema.parse("core:inbox-projection"),
      effectClass: "projection" as const,
      eventId: ids.eventId,
      changeIds: [ids.changeId],
      payloadReference: null,
      consumerDedupeKey: inboxV2Sha256DigestSchema.parse(
        ids.projectionDedupeKey
      ),
      correlationId: inboxV2CorrelationIdSchema.parse(claim.correlationId),
      availableAt: occurredAt,
      intentHash: inboxV2Sha256DigestSchema.parse(projectionIntentHash)
    };
  const revisionDeltaHash = terminalRevisionDeltaHash(plan);
  const facet: WithInboxV2AuthorizedCommandMutationInput["records"]["audit"]["facets"][number] =
    {
      ordinal: 1,
      dimension: "resource" as const,
      reference: internalEntityReference(
        claim.tenantId,
        "core:conversation",
        "conversation",
        claim.contentOrigin.conversationId
      ),
      relation: "affected" as const,
      facetHash: calculateInboxV2CanonicalSha256({
        domain: "core:inbox-v2.attachment-materialization-terminal-facet@v1",
        conversationId: claim.contentOrigin.conversationId
      })
    };
  const expiresAt = decisions
    .map(({ notAfter }) => notAfter)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0]!;
  const auditGrantSourceIds = parseTerminalGrantSourceIds(
    claim.reservationAuthority.auditGrantSourceIds
  );
  const auditBase: Omit<
    WithInboxV2AuthorizedCommandMutationInput["records"]["audit"],
    "auditHash"
  > = {
    id: ids.auditId,
    actionId: INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID,
    target: auditTarget,
    reasonCodeId: "core:attachment_materialization.completed",
    matchedPermissionIds: requiredPermissions,
    grantSourceIds: auditGrantSourceIds,
    authorizationScopeIds: ["core:conversation"],
    overrideReasonCodeId: null,
    policyVersion: claim.reservationAuthority.auditPolicyVersion,
    evidenceReference: domainCommitReference,
    authorizationDecisionRefs: decisions,
    correlationId: inboxV2CorrelationIdSchema.parse(claim.correlationId),
    outcome: "succeeded" as const,
    revisionDeltaHash,
    previousAuditHash: null,
    occurredAt,
    recordedAt: occurredAt,
    expiresAt,
    facets: [facet]
  };
  const auditHash = terminalAuditHash(auditBase);
  const recordsWithoutCommitHash: Omit<
    WithInboxV2AuthorizedCommandMutationInput["records"],
    "commitHash"
  > = {
    mutationId: ids.mutationId,
    relationKind: null,
    streamCommitId: ids.streamCommitId,
    expectedStreamEpoch: requiredString(
      authority.stream_epoch,
      "terminal stream epoch"
    ),
    audienceImpact: { kind: "none" as const },
    correlationId: inboxV2CorrelationIdSchema.parse(claim.correlationId),
    changes: [change],
    events: [event],
    outboxIntents: [outbox],
    audit: { ...auditBase, auditHash }
  };
  const primaryDecision = decisions.find(
    ({ permissionId }) => permissionId === "core:file.upload"
  );
  if (primaryDecision === undefined) {
    throw new TerminalMaterializationRollback("state_conflict", false);
  }
  const mutation: WithInboxV2AuthorizedCommandMutationInput = {
    tenantId: claim.tenantId,
    command: {
      id: inboxV2CommandIdSchema.parse(intent.commandId),
      requestId: inboxV2RequestIdSchema.parse(intent.requestId),
      clientMutationId: inboxV2ClientMutationIdSchema.parse(
        intent.clientMutationId
      ),
      commandTypeId: inboxV2CatalogIdSchema.parse(
        INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID
      ),
      requestHash: inboxV2Sha256DigestSchema.parse(intent.requestHash),
      actor: { kind: "trusted_service", trustedServiceId },
      authorizationDecisionId: primaryDecision.id,
      authorizationEpoch: claim.reservationAuthority.epoch,
      authorizedAt: occurredAt,
      publicResultCode:
        INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_RESULT_CODE,
      resultReference: messageReference,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: claim.reservationAuthority.tenantRbacRevision,
      expectedSharedAccessRevision:
        claim.reservationAuthority.sharedAccessRevision,
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [],
      resources: [
        {
          resourceKind: "conversation",
          resourceId: claim.contentOrigin.conversationId,
          resourceHeadId: claim.reservationAuthority.resourceHeadId,
          expectedResourceAccessRevision:
            claim.reservationAuthority.resourceAccessRevision,
          expectedStructuralRelationRevision:
            claim.reservationAuthority.structuralRelationRevision,
          expectedCollaboratorSetRevision:
            claim.reservationAuthority.collaboratorSetRevision,
          advance: "none",
          advanceStructuralRelation: "none",
          advanceCollaboratorSet: "none"
        }
      ]
    },
    records: {
      ...recordsWithoutCommitHash,
      commitHash: computeInboxV2TenantStreamManifestDigest(
        recordsWithoutCommitHash
      )
    },
    occurredAt
  };
  assertTerminalAuthorizedMutationClosure(intent, plan, mutation);
  return mutation;
}

/** Relative-module test seam; deliberately omitted from every package barrel. */
export function buildInboxV2AttachmentMaterializationTerminalAuthorizedMutationForTest(
  input: Parameters<typeof buildTerminalAuthorizedMutation>[0]
): WithInboxV2AuthorizedCommandMutationInput {
  return buildTerminalAuthorizedMutation(input);
}

/**
 * Completes one claimed attachment through the DB-verified authorized command
 * coordinator. The command is replay-checked before the mutable content head is
 * read, so a process restart after a committed/lost acknowledgement consumes no
 * second stream position. A concurrent attachment completion causes a bounded
 * re-read/rebase; every prepared capability remains transaction-local.
 */
export function createInboxV2AttachmentMaterializationTerminalCommandService(
  options: InboxV2AttachmentMaterializationTerminalCommandServiceOptions
): InboxV2AttachmentMaterializationTerminalCommandService {
  return createInboxV2AttachmentMaterializationTerminalCommandServiceForTest({
    ...options,
    persistence: productionPersistence
  });
}

/**
 * Production construction boundary. Both authorization preparation and the
 * atomic coordinator capture the same real database executor; callers cannot
 * inject a structurally forged prepared mutation through the package root.
 */
export function createSqlInboxV2AttachmentMaterializationTerminalCommandService(
  executor: InboxV2AuthorizationTransactionExecutor | HuleeDatabase
): InboxV2AttachmentMaterializationTerminalCommandService {
  return createInboxV2AttachmentMaterializationTerminalCommandService({
    preparer:
      createSqlInboxV2AttachmentMaterializationTerminalCommandPreparer(
        executor
      ),
    coordinator: createSqlInboxV2AuthorizedCommandCoordinator(executor)
  });
}

/** Relative-module test seam; deliberately omitted from every @hulee/db root. */
export function createInboxV2AttachmentMaterializationTerminalCommandServiceForTest(
  options: InboxV2AttachmentMaterializationTerminalCommandServiceOptions &
    Readonly<{
      persistence: InboxV2AttachmentMaterializationTerminalPersistenceForTest;
    }>
): InboxV2AttachmentMaterializationTerminalCommandService {
  const persistence = options.persistence;
  const maximumRebaseAttempts = normalizeMaximumRebaseAttempts(
    options.maximumRebaseAttempts
  );

  const execute = async (
    claim: InboxV2AttachmentMaterializationClaim,
    outcome: InboxV2AttachmentMaterializationTerminalOutcome
  ): Promise<InboxV2AttachmentMaterializationTerminalCommandResult> => {
    const intent = terminalIntent(claim, outcome);
    const replay = await options.preparer.lookupIdempotency(intent);
    if (replay !== null) return terminalReplayResult(intent, replay);

    for (let attempt = 0; attempt < maximumRebaseAttempts; attempt += 1) {
      try {
        const prepared = await options.preparer.prepareNew(intent);
        if (prepared === null) return { kind: "not_found" };
        if (prepared.kind !== "selected") {
          return terminalReplayResult(intent, prepared);
        }
        const plan = planInboxV2AttachmentMaterializationMessageMutation({
          current: prepared.current,
          intent,
          occurredAt: prepared.authorizedMutation.occurredAt,
          trustedServiceId: trustedServiceId(prepared.authorizedMutation)
        });
        assertTerminalAuthorizedMutationClosure(
          intent,
          plan,
          prepared.authorizedMutation
        );
        const result =
          await options.coordinator.withAuthorizedAtomicMaterialization(
            prepared.authorizedMutation,
            async (context): Promise<PreparedAtomicTerminal> => {
              const message = await persistence.prepareMessage(context, {
                tenantId: plan.commit.tenantId,
                conversationId: plan.commit.beforeMessage.conversation.id,
                messageId: plan.commit.beforeMessage.id,
                plan: (current) => {
                  const rebased =
                    planInboxV2AttachmentMaterializationMessageMutation({
                      current,
                      intent,
                      occurredAt: context.occurredAt,
                      trustedServiceId: trustedServiceIdFromContext(context)
                    });
                  if (digest(rebased.commit) !== digest(plan.commit)) {
                    throw new TerminalMaterializationRollback(
                      "message_state_conflict",
                      true
                    );
                  }
                  return rebased.commit;
                }
              });
              if (message.kind !== "ready") {
                throw new TerminalMaterializationRollback(
                  message.kind === "already_applied"
                    ? "already_applied_without_command"
                    : "message_state_conflict",
                  false
                );
              }
              if (outcome.kind === "ready") {
                const file = await persistence.prepareReadyFile(context, {
                  claim,
                  storage: outcome.storage,
                  contentFence: plan.contentFence
                });
                if (file.kind !== "proceed") {
                  throw new TerminalMaterializationRollback(
                    file.kind === "lease_lost"
                      ? "lease_lost"
                      : "state_conflict",
                    false
                  );
                }
                return {
                  message: message.capability,
                  file: { kind: "ready", capability: file.capability }
                };
              }
              const file = await persistence.prepareFailedFile(context, {
                claim,
                code: outcome.code,
                retryable: outcome.retryable,
                contentFence: plan.contentFence
              });
              if (file.kind !== "proceed") {
                throw new TerminalMaterializationRollback(
                  file.kind === "lease_lost" ? "lease_lost" : "state_conflict",
                  false
                );
              }
              return {
                message: message.capability,
                file: { kind: "failed", capability: file.capability }
              };
            },
            async (context, capabilities) => {
              const fileResult =
                capabilities.file.kind === "ready"
                  ? await persistence.sealReadyFile(
                      context,
                      capabilities.file.capability
                    )
                  : await persistence.sealFailedFile(
                      context,
                      capabilities.file.capability
                    );
              const materialization = requireAppliedFileClosure(fileResult);
              const message = await persistence.sealMessage(context, {
                capability: capabilities.message
              });
              return {
                result: {
                  messageId: message.message.id,
                  messageRevision: message.message.revision,
                  contentId: materialization.contentId,
                  contentRevision: materialization.contentRevision,
                  materialization
                },
                receipt: message.receipt
              };
            }
          );
        if (result.kind === "applied") {
          return {
            kind: "applied",
            result: result.result,
            status: result.status
          };
        }
        if (result.kind === "already_applied") {
          assertReplayStatus(intent, result.status);
          return { kind: "already_applied", status: result.status };
        }
        if (result.kind === "idempotency_conflict") {
          return { kind: "idempotency_conflict" };
        }
        return { kind: "authorization_conflict", conflict: result };
      } catch (error) {
        if (
          error instanceof TerminalMaterializationRollback &&
          error.rebase &&
          attempt + 1 < maximumRebaseAttempts
        ) {
          continue;
        }
        if (error instanceof TerminalMaterializationRollback) {
          return { kind: "materialization_conflict", reason: error.reason };
        }
        throw error;
      }
    }
    return {
      kind: "materialization_conflict",
      reason: "message_state_conflict"
    };
  };

  return Object.freeze({
    ready: ({ claim, storage }) => execute(claim, { kind: "ready", storage }),
    failed: ({ claim, code, retryable }) =>
      execute(claim, { kind: "failed", code, retryable })
  });
}

export function calculateInboxV2AttachmentMaterializationTerminalRequestHash(
  claim: InboxV2AttachmentMaterializationClaim,
  outcome: InboxV2AttachmentMaterializationTerminalOutcome
): string {
  const canonicalOutcome =
    outcome.kind === "ready"
      ? {
          kind: outcome.kind,
          storage: {
            storageKey: outcome.storage.storageKey,
            storageVersionId: outcome.storage.storageVersionId,
            checksumSha256: outcome.storage.checksumSha256,
            sizeBytes: outcome.storage.sizeBytes,
            mediaType: outcome.storage.mediaType
          }
        }
      : outcome;
  return calculateInboxV2CanonicalSha256({
    protocol: "core:inbox-v2.attachment-materialization-terminal-command@v1",
    claim: {
      tenantId: claim.tenantId,
      jobId: claim.jobId,
      attachmentId: claim.attachmentId,
      attemptId: claim.attemptId,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      workerId: claim.workerId,
      claimedAt: claim.claimedAt,
      leaseExpiresAt: claim.leaseExpiresAt,
      expectedJobRevision: claim.expectedJobRevision,
      fileId: claim.fileId,
      expectedFileRevision: claim.expectedFileRevision,
      dataClassId: claim.dataClassId,
      processingPurposeId: claim.processingPurposeId,
      retentionAnchorAt: claim.retentionAnchorAt,
      fileVersionId: claim.fileVersionId,
      objectVersionId: claim.objectVersionId,
      storageRootId: claim.storageRootId,
      storageKey: claim.storageKey,
      contentOrigin: claim.contentOrigin,
      sourceLocator: claim.sourceLocator,
      sourceOccurrenceId: claim.sourceOccurrenceId,
      causeEventId: claim.causeEventId,
      causeMutationId: claim.causeMutationId,
      causeStreamCommitId: claim.causeStreamCommitId,
      causeStreamPosition: claim.causeStreamPosition,
      correlationId: claim.correlationId,
      causedAt: claim.causedAt,
      reservationAuthority: claim.reservationAuthority
    },
    outcome: canonicalOutcome
  });
}

export function planInboxV2AttachmentMaterializationMessageMutation(input: {
  current: InboxV2MessageMutationPlanCurrent;
  intent: InboxV2AttachmentMaterializationTerminalIntent;
  occurredAt: string;
  trustedServiceId: string;
}): Readonly<{
  commit: InboxV2MessageMutationCommit;
  contentFence: InboxV2AttachmentMaterializationContentFence;
}> {
  const { current, intent, occurredAt, trustedServiceId } = input;
  const { claim, outcome } = intent;
  assertCurrentMaterializationOrigin(current, claim, occurredAt);
  const content = current.content;
  if (content.state.kind !== "available") {
    throw new TerminalMaterializationRollback("message_state_conflict", true);
  }
  const targetIndexes = content.state.blocks
    .map((block, index) => ({ block, index }))
    .filter(
      ({ block }) =>
        block.blockKey === claim.contentOrigin.contentBlockKey &&
        "attachment" in block &&
        block.attachment.attachment.id === claim.attachmentId
    );
  const target = targetIndexes[0];
  if (
    targetIndexes.length !== 1 ||
    target === undefined ||
    !("attachment" in target.block) ||
    target.block.attachment.state !== "pending"
  ) {
    throw new TerminalMaterializationRollback("message_state_conflict", true);
  }

  const resultingFileRevision = incrementCounter(claim.expectedFileRevision);
  const terminalAttachment =
    outcome.kind === "ready"
      ? {
          state: "ready" as const,
          attachment: target.block.attachment.attachment,
          file: reference(claim.tenantId, "file", claim.fileId),
          fileRevision: resultingFileRevision,
          fileVersion: reference(
            claim.tenantId,
            "file_version",
            claim.fileVersionId
          ),
          objectVersion: reference(
            claim.tenantId,
            "file_object_version",
            claim.objectVersionId
          )
        }
      : {
          state: "failed" as const,
          attachment: target.block.attachment.attachment,
          reasonId: deriveInboxV2AttachmentMaterializationFailureReasonId(
            outcome.code
          )
        };
  const blocks = content.state.blocks.map((block, index) =>
    index === target.index
      ? { ...block, attachment: terminalAttachment }
      : block
  ) as InboxV2MessageContentBlock[];
  const contentRevision = incrementCounter(content.revision);
  const messageRevision = incrementCounter(current.message.revision);
  const timelineItemRevision = incrementCounter(current.timelineItem.revision);
  const eventId = derivePrefixedId(
    "event",
    intent.requestHash,
    current.message.id,
    messageRevision,
    current.content.id,
    contentRevision
  );
  const afterContent = {
    ...content,
    state: {
      kind: "available" as const,
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: contentRevision,
    updatedAt: occurredAt
  };
  const afterContentHead = inboxV2TimelineContentHeadOf(afterContent);
  const afterMessage = {
    ...current.message,
    content: afterContentHead,
    revision: messageRevision,
    updatedAt: occurredAt
  };
  const afterTimelineItem = {
    ...current.timelineItem,
    subject: {
      kind: "message" as const,
      message: reference(claim.tenantId, "message", current.message.id),
      messageRevision
    },
    revision: timelineItemRevision,
    updatedAt: occurredAt
  };
  const commit = inboxV2MessageMutationCommitSchema.parse({
    tenantId: claim.tenantId,
    beforeMessage: current.message,
    beforeTimelineItem: current.timelineItem,
    contentTransition: {
      tenantId: claim.tenantId,
      before: current.content,
      transition: {
        kind: "attachment_materialization",
        expectedRevision: current.content.revision,
        resultingRevision: contentRevision,
        event: reference(claim.tenantId, "event", eventId),
        occurredAt
      },
      after: afterContent
    },
    providerOperation: null,
    providerOperationCreationCommit: null,
    actionParticipantSnapshot: null,
    revision: {
      tenantId: claim.tenantId,
      id: derivePrefixedId(
        "message_revision",
        intent.requestHash,
        current.message.id,
        messageRevision,
        current.content.id,
        contentRevision
      ),
      message: reference(claim.tenantId, "message", current.message.id),
      timelineItem: reference(
        claim.tenantId,
        "timeline_item",
        current.timelineItem.id
      ),
      expectedPreviousRevision: current.message.revision,
      messageRevision,
      change: {
        kind: "attachment_materialized",
        beforeContent: current.message.content,
        afterContent: afterContentHead
      },
      actionAttribution: {
        actionParticipant: null,
        appActor: { kind: "trusted_service", trustedServiceId },
        sourceOccurrence: null,
        automationCausation: {
          kind: "system_event",
          causeEvent: reference(claim.tenantId, "event", claim.causeEventId),
          correlationId: claim.correlationId,
          causedAt: claim.causedAt
        }
      },
      occurredAt,
      recordedAt: occurredAt,
      recordRevision: "1",
      createdAt: occurredAt
    },
    afterMessage,
    afterTimelineItem
  });
  const contentFence: InboxV2AttachmentMaterializationContentFence = {
    tenantId: claim.tenantId,
    conversationId: claim.contentOrigin.conversationId,
    timelineItemId: claim.contentOrigin.timelineItemId,
    timelineContentId: claim.contentOrigin.timelineContentId,
    resultingContentRevision: contentRevision,
    contentBlockKey: claim.contentOrigin.contentBlockKey,
    attachmentId: claim.attachmentId,
    resultingAttachmentRevision: incrementCounter(
      claim.contentOrigin.expectedAttachmentRevision
    ),
    parentKind: "message",
    parentEntityId: claim.contentOrigin.parentEntityId,
    parentEntityRevision: messageRevision,
    visibilityBoundary: claim.contentOrigin.visibilityBoundary,
    parentConversationVisibility: null,
    dataClassId: claim.dataClassId,
    processingPurposeId: claim.processingPurposeId,
    retentionAnchorAt: claim.retentionAnchorAt
  };
  return Object.freeze({ commit, contentFence: Object.freeze(contentFence) });
}

function assertTerminalAuthorizedMutationClosure(
  intent: InboxV2AttachmentMaterializationTerminalIntent,
  plan: ReturnType<typeof planInboxV2AttachmentMaterializationMessageMutation>,
  mutation: WithInboxV2AuthorizedCommandMutationInput
): void {
  const { claim } = intent;
  const commit = plan.commit;
  const messageReference = payloadReference({
    tenantId: claim.tenantId,
    recordId: commit.afterMessage.id,
    schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
    payload: commit.afterMessage
  });
  const domainCommitReference = payloadReference({
    tenantId: claim.tenantId,
    recordId: commit.revision.id,
    schemaId: INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
    payload: commit.revision
  });
  const records = mutation.records;
  const change = records.changes[0];
  const event = records.events[0];
  const outbox = records.outboxIntents[0];
  const decisions = records.audit.authorizationDecisionRefs;
  const requiredReadPermission =
    commit.beforeTimelineItem.visibility === "conversation_external"
      ? "core:conversation.read"
      : "core:conversation.internal.read";
  const requiredPermissions = ["core:file.upload", requiredReadPermission].sort(
    compareText
  );
  const expectedIds = terminalRecordIds(intent, commit);
  const expectedAudience =
    commit.beforeTimelineItem.visibility === "conversation_external"
      ? "conversation_external"
      : "internal_participants";
  const expectedAuditTarget = internalEntityReference(
    claim.tenantId,
    "core:message",
    "message",
    commit.afterMessage.id
  );
  const expectedAuditFacetReference = internalEntityReference(
    claim.tenantId,
    "core:conversation",
    "conversation",
    claim.contentOrigin.conversationId
  );
  const decisionsMatch = exactTerminalDecisions(
    decisions,
    mutation,
    claim,
    requiredPermissions
  );
  const expectedEventHash = terminalEventHash({
    ids: expectedIds,
    intent,
    domainCommitReference,
    decisions,
    occurredAt: mutation.occurredAt
  });
  const expectedIntentHash = terminalProjectionIntentHash({
    ids: expectedIds,
    claim,
    occurredAt: mutation.occurredAt
  });
  const expectedRevisionDeltaHash = terminalRevisionDeltaHash(plan);
  const expectedAuditHash = terminalAuditHash({
    id: expectedIds.auditId,
    actionId: INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID,
    target: expectedAuditTarget,
    reasonCodeId: "core:attachment_materialization.completed",
    matchedPermissionIds: requiredPermissions,
    grantSourceIds: records.audit.grantSourceIds,
    authorizationScopeIds: ["core:conversation"],
    policyVersion: records.audit.policyVersion,
    evidenceReference: domainCommitReference,
    authorizationDecisionRefs: decisions,
    correlationId: claim.correlationId,
    revisionDeltaHash: expectedRevisionDeltaHash,
    previousAuditHash: records.audit.previousAuditHash,
    occurredAt: mutation.occurredAt,
    recordedAt: mutation.occurredAt,
    expiresAt: records.audit.expiresAt,
    facets: records.audit.facets
  });

  if (
    mutation.tenantId !== claim.tenantId ||
    mutation.command.id !== intent.commandId ||
    mutation.command.requestId !== intent.requestId ||
    mutation.command.clientMutationId !== intent.clientMutationId ||
    mutation.command.commandTypeId !==
      INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID ||
    mutation.command.requestHash !== intent.requestHash ||
    mutation.command.actor.kind !== "trusted_service" ||
    mutation.command.actor.trustedServiceId !== trustedServiceId(mutation) ||
    mutation.command.actor.trustedServiceId !==
      trustedReservationServiceId(claim) ||
    mutation.command.publicResultCode !==
      INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_RESULT_CODE ||
    mutation.command.sensitiveResultReference !== null ||
    !sameValue(mutation.command.resultReference, messageReference) ||
    mutation.occurredAt !== commit.revision.occurredAt ||
    mutation.occurredAt !== commit.revision.recordedAt ||
    mutation.occurredAt !== commit.contentTransition?.transition.occurredAt ||
    records.mutationId !== expectedIds.mutationId ||
    records.streamCommitId !== expectedIds.streamCommitId ||
    records.relationKind !== null ||
    records.audienceImpact.kind !== "none" ||
    records.correlationId !== claim.correlationId ||
    records.changes.length !== 1 ||
    records.events.length !== 1 ||
    records.outboxIntents.length !== 1 ||
    change === undefined ||
    change.id !== expectedIds.changeId ||
    change.ordinal !== 1 ||
    change.entity.tenantId !== claim.tenantId ||
    change.entity.entityTypeId !== "core:message" ||
    String(change.entity.entityId) !== String(commit.afterMessage.id) ||
    String(change.resultingRevision) !== commit.afterMessage.revision ||
    change.audience !== expectedAudience ||
    change.timeline?.conversation.tenantId !== claim.tenantId ||
    String(change.timeline?.conversation.id) !==
      String(commit.afterMessage.conversation.id) ||
    String(change.timeline?.timelineSequence) !==
      String(commit.afterTimelineItem.timelineSequence) ||
    change.state.kind !== "upsert" ||
    change.state.stateSchemaId !== INBOX_V2_MESSAGE_SCHEMA_ID ||
    change.state.stateSchemaVersion !== INBOX_V2_MESSAGE_SCHEMA_VERSION ||
    change.state.stateHash !== messageReference.digest ||
    !sameValue(change.state.payloadReference, messageReference) ||
    !sameValue(change.state.domainCommitReference, domainCommitReference) ||
    event === undefined ||
    event.id !== expectedIds.eventId ||
    String(event.ordinal) !== "1" ||
    event.typeId !== "core:message.changed" ||
    event.payloadSchemaId !== INBOX_V2_MESSAGE_REVISION_SCHEMA_ID ||
    event.payloadSchemaVersion !== INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION ||
    !sameValue(event.payloadReference, domainCommitReference) ||
    !sameValue(event.changeIds, [expectedIds.changeId]) ||
    !sameValue(event.subjects, [change.entity]) ||
    event.correlationId !== claim.correlationId ||
    !sameValue(event.commandIds, [intent.commandId]) ||
    !sameValue(event.clientMutationIds, [intent.clientMutationId]) ||
    !sameValue(event.authorizationDecisionRefs, decisions) ||
    event.accessEffect.kind !== "none" ||
    event.occurredAt !== mutation.occurredAt ||
    event.recordedAt !== mutation.occurredAt ||
    event.eventHash !== expectedEventHash ||
    outbox === undefined ||
    outbox.id !== expectedIds.outboxIntentId ||
    outbox.ordinal !== 1 ||
    outbox.typeId !== "core:projection.update" ||
    outbox.handlerId !== "core:inbox-projection" ||
    outbox.effectClass !== "projection" ||
    outbox.eventId !== expectedIds.eventId ||
    !sameValue(outbox.changeIds, [expectedIds.changeId]) ||
    outbox.payloadReference !== null ||
    outbox.correlationId !== claim.correlationId ||
    outbox.availableAt !== mutation.occurredAt ||
    outbox.consumerDedupeKey !== expectedIds.projectionDedupeKey ||
    outbox.intentHash !== expectedIntentHash ||
    records.commitHash !== computeInboxV2TenantStreamManifestDigest(records) ||
    records.audit.id !== expectedIds.auditId ||
    records.audit.actionId !==
      INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID ||
    !sameValue(records.audit.target, expectedAuditTarget) ||
    records.audit.reasonCodeId !==
      "core:attachment_materialization.completed" ||
    !sameValue(records.audit.matchedPermissionIds, requiredPermissions) ||
    !sameValue(records.audit.authorizationScopeIds, ["core:conversation"]) ||
    records.audit.overrideReasonCodeId !== null ||
    !sameValue(records.audit.evidenceReference, domainCommitReference) ||
    !decisionsMatch ||
    records.audit.correlationId !== claim.correlationId ||
    records.audit.outcome !== "succeeded" ||
    records.audit.revisionDeltaHash !== expectedRevisionDeltaHash ||
    records.audit.auditHash !== expectedAuditHash ||
    records.audit.occurredAt !== mutation.occurredAt ||
    records.audit.recordedAt !== mutation.occurredAt ||
    Date.parse(records.audit.expiresAt) <= Date.parse(mutation.occurredAt) ||
    records.audit.facets.length !== 1 ||
    records.audit.facets[0]?.ordinal !== 1 ||
    records.audit.facets[0]?.dimension !== "resource" ||
    records.audit.facets[0]?.relation !== "affected" ||
    !sameValue(records.audit.facets[0]?.reference, expectedAuditFacetReference)
  ) {
    throw new TypeError(
      "Attachment materialization authorization envelope does not exactly close the terminal Message mutation."
    );
  }
}

function exactTerminalDecisions(
  decisions: readonly InboxV2AuthorizationDecisionReference[],
  mutation: WithInboxV2AuthorizedCommandMutationInput,
  claim: InboxV2AttachmentMaterializationClaim,
  requiredPermissions: readonly string[]
): boolean {
  const primary = decisions.find(
    ({ id }) => id === mutation.command.authorizationDecisionId
  );
  const accessRevisions = new Set(
    decisions.map(({ resourceAccessRevision }) =>
      String(resourceAccessRevision)
    )
  );
  const fence = mutation.revisions.resources[0];
  return (
    decisions.length === 2 &&
    new Set(decisions.map(({ id }) => String(id))).size === 2 &&
    sameValue(
      decisions.map(({ permissionId }) => permissionId).sort(compareText),
      requiredPermissions
    ) &&
    decisions.every(
      (decision) =>
        decision.tenantId === claim.tenantId &&
        decision.authorizationEpoch === mutation.command.authorizationEpoch &&
        decision.principal.kind === "trusted_service" &&
        decision.principal.trustedServiceId ===
          trustedReservationServiceId(claim) &&
        decision.outcome === "allowed" &&
        decision.resourceScopeId === "core:conversation" &&
        decision.resource.tenantId === claim.tenantId &&
        decision.resource.entityTypeId === "core:conversation" &&
        String(decision.resource.entityId) ===
          String(claim.contentOrigin.conversationId) &&
        Date.parse(decision.decidedAt) <=
          Date.parse(mutation.command.authorizedAt) &&
        Date.parse(mutation.command.authorizedAt) <
          Date.parse(decision.notAfter) &&
        Date.parse(mutation.occurredAt) < Date.parse(decision.notAfter)
    ) &&
    primary?.permissionId === "core:file.upload" &&
    mutation.revisions.resources.length === 1 &&
    fence?.resourceKind === "conversation" &&
    String(fence.resourceId) === String(claim.contentOrigin.conversationId) &&
    fence.advance === "none" &&
    accessRevisions.size === 1 &&
    String(fence.expectedResourceAccessRevision) === [...accessRevisions][0]
  );
}

function terminalEventHash(input: {
  ids: ReturnType<typeof terminalRecordIds>;
  intent: InboxV2AttachmentMaterializationTerminalIntent;
  domainCommitReference: InboxV2PayloadReference;
  decisions: readonly InboxV2AuthorizationDecisionReference[];
  occurredAt: string;
}): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.attachment-materialization-terminal-event@v1",
    id: input.ids.eventId,
    typeId: "core:message.changed",
    payloadReference: input.domainCommitReference,
    changeId: input.ids.changeId,
    commandId: input.intent.commandId,
    clientMutationId: input.intent.clientMutationId,
    decisions: input.decisions,
    correlationId: input.intent.claim.correlationId,
    occurredAt: input.occurredAt
  });
}

function terminalProjectionIntentHash(input: {
  ids: ReturnType<typeof terminalRecordIds>;
  claim: InboxV2AttachmentMaterializationClaim;
  occurredAt: string;
}): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.attachment-materialization-terminal-projection@v1",
    id: input.ids.outboxIntentId,
    eventId: input.ids.eventId,
    changeId: input.ids.changeId,
    correlationId: input.claim.correlationId,
    availableAt: input.occurredAt
  });
}

function terminalRevisionDeltaHash(
  plan: ReturnType<typeof planInboxV2AttachmentMaterializationMessageMutation>
): string {
  const commit = plan.commit;
  return calculateInboxV2CanonicalSha256({
    domain:
      "core:inbox-v2.attachment-materialization-terminal-revision-delta@v1",
    messageId: commit.afterMessage.id,
    beforeMessageRevision: commit.beforeMessage.revision,
    afterMessageRevision: commit.afterMessage.revision,
    timelineItemId: commit.afterTimelineItem.id,
    beforeTimelineItemRevision: commit.beforeTimelineItem.revision,
    afterTimelineItemRevision: commit.afterTimelineItem.revision,
    contentId: commit.contentTransition?.after.id,
    beforeContentRevision: commit.contentTransition?.before.revision,
    afterContentRevision: commit.contentTransition?.after.revision,
    attachmentId: plan.contentFence.attachmentId,
    attachmentRevision: plan.contentFence.resultingAttachmentRevision
  });
}

function terminalAuditHash(audit: Readonly<Record<string, unknown>>): string {
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.attachment-materialization-terminal-audit@v1",
    id: audit.id,
    actionId: audit.actionId,
    target: audit.target,
    reasonCodeId: audit.reasonCodeId,
    matchedPermissionIds: audit.matchedPermissionIds,
    grantSourceIds: audit.grantSourceIds,
    authorizationScopeIds: audit.authorizationScopeIds,
    policyVersion: audit.policyVersion,
    evidenceReference: audit.evidenceReference,
    authorizationDecisionRefs: audit.authorizationDecisionRefs,
    correlationId: audit.correlationId,
    revisionDeltaHash: audit.revisionDeltaHash,
    previousAuditHash: audit.previousAuditHash,
    occurredAt: audit.occurredAt,
    recordedAt: audit.recordedAt,
    expiresAt: audit.expiresAt,
    facets: audit.facets
  });
}

function parseTerminalDecisions(
  value: unknown
): readonly InboxV2AuthorizationDecisionReference[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Terminal authorization decisions must be an array.");
  }
  return Object.freeze(
    value.map((decision) =>
      inboxV2AuthorizationDecisionReferenceSchema.parse(decision)
    )
  );
}

function parseTerminalGrantSourceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new TypeError(
      "Terminal authorization grant sources must be a non-empty bounded array."
    );
  }
  const parsed = value.map((grantSourceId) =>
    inboxV2InternalOpaqueReferenceSchema.parse(grantSourceId)
  );
  if (
    parsed.some(
      (grantSourceId, index) =>
        index > 0 && compareText(parsed[index - 1]!, grantSourceId) >= 0
    )
  ) {
    throw new TypeError(
      "Terminal authorization grant sources must be unique and canonically sorted."
    );
  }
  return Object.freeze(parsed);
}

function databaseTimestamp(value: unknown): string {
  const timestamp =
    value instanceof Date
      ? value
      : new Date(requiredString(value, "timestamp"));
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError("timestamp must be a finite database timestamp.");
  }
  return inboxV2TimestampSchema.parse(timestamp.toISOString());
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    if (typeof value === "bigint" || typeof value === "number") {
      return String(value);
    }
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requiredString(value, "nullable string");
}

function positiveCounter(value: unknown, field: string): string {
  const counter = requiredString(value, field);
  if (!/^[1-9][0-9]*$/u.test(counter)) {
    throw new TypeError(`${field} must be a positive decimal counter.`);
  }
  return counter;
}

function terminalIntent(
  claim: InboxV2AttachmentMaterializationClaim,
  outcome: InboxV2AttachmentMaterializationTerminalOutcome
): InboxV2AttachmentMaterializationTerminalIntent {
  const requestHash =
    calculateInboxV2AttachmentMaterializationTerminalRequestHash(
      claim,
      outcome
    );
  const suffix = requestHash.slice("sha256:".length);
  return Object.freeze({
    claim,
    outcome,
    requestHash: inboxV2Sha256DigestSchema.parse(requestHash),
    commandId: inboxV2CommandIdSchema.parse(
      `attachment-materialization-command:${suffix}`
    ),
    requestId: inboxV2RequestIdSchema.parse(
      `attachment-materialization-request:${suffix}`
    ),
    clientMutationId: inboxV2ClientMutationIdSchema.parse(
      `attachment-materialization:${suffix}`
    )
  });
}

function terminalRecordIds(
  intent: InboxV2AttachmentMaterializationTerminalIntent,
  commit: InboxV2MessageMutationCommit
) {
  const suffix = hashParts(
    intent.requestHash,
    commit.afterMessage.id,
    commit.afterMessage.revision,
    commit.contentTransition?.after.id ?? "",
    commit.contentTransition?.after.revision ?? ""
  );
  return Object.freeze({
    mutationId: `mutation:attachment-materialization-${suffix}`,
    streamCommitId: `stream-commit:attachment-materialization-${suffix}`,
    changeId: inboxV2TenantStreamChangeIdSchema.parse(
      `change:attachment-materialization-${suffix}`
    ),
    eventId: inboxV2EventIdSchema.parse(
      String(commit.contentTransition?.transition.event.id)
    ),
    outboxIntentId: inboxV2OutboxIntentIdSchema.parse(
      `outbox-intent:attachment-materialization-${suffix}`
    ),
    projectionDedupeKey: inboxV2Sha256DigestSchema.parse(
      `sha256:${hashParts("projection-dedupe", suffix)}`
    ),
    auditId: `audit:attachment-materialization-${suffix}`
  });
}

function terminalReplayResult(
  intent: InboxV2AttachmentMaterializationTerminalIntent,
  replay: TerminalReplay | TerminalIdempotencyConflict
): InboxV2AttachmentMaterializationTerminalCommandResult {
  if (
    replay.tenantId !== intent.claim.tenantId ||
    replay.commandTypeId !==
      INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID ||
    replay.clientMutationId !== intent.clientMutationId
  ) {
    throw new TypeError("Attachment materialization replay scope mismatch.");
  }
  if (replay.kind === "idempotency_conflict") {
    return { kind: "idempotency_conflict" };
  }
  if (replay.requestHash !== intent.requestHash) {
    return { kind: "idempotency_conflict" };
  }
  assertReplayStatus(intent, replay.status);
  return { kind: "already_applied", status: replay.status };
}

function assertReplayStatus(
  intent: InboxV2AttachmentMaterializationTerminalIntent,
  status: InboxV2PrivilegedAuthorizationMutationReplayStatus
): void {
  if (
    status.commandId !== intent.commandId ||
    status.publicResultCode !==
      INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_RESULT_CODE ||
    status.resultReference?.tenantId !== intent.claim.tenantId ||
    status.resultReference.schemaId !== INBOX_V2_MESSAGE_SCHEMA_ID ||
    status.resultReference.schemaVersion !== INBOX_V2_MESSAGE_SCHEMA_VERSION ||
    String(status.resultReference.recordId) !==
      String(intent.claim.contentOrigin.parentEntityId)
  ) {
    throw new TypeError("Attachment materialization replay closure mismatch.");
  }
}

function assertCurrentMaterializationOrigin(
  current: InboxV2MessageMutationPlanCurrent,
  claim: InboxV2AttachmentMaterializationClaim,
  occurredAt: string
): void {
  const origin = claim.contentOrigin;
  if (
    current.message.tenantId !== claim.tenantId ||
    String(current.message.id) !== String(origin.parentEntityId) ||
    String(current.message.conversation.id) !== String(origin.conversationId) ||
    String(current.message.timelineItem.id) !== String(origin.timelineItemId) ||
    current.timelineItem.tenantId !== claim.tenantId ||
    String(current.timelineItem.id) !== String(origin.timelineItemId) ||
    String(current.timelineItem.conversation.id) !==
      String(origin.conversationId) ||
    current.timelineItem.subject.kind !== "message" ||
    String(current.timelineItem.subject.message.id) !==
      String(origin.parentEntityId) ||
    String(current.content.id) !== String(origin.timelineContentId) ||
    String(current.message.content.content.id) !==
      String(origin.timelineContentId) ||
    BigInt(current.message.revision) < BigInt(origin.expectedParentRevision) ||
    BigInt(current.content.revision) < BigInt(origin.expectedContentRevision) ||
    Date.parse(occurredAt) < Date.parse(current.message.updatedAt) ||
    Date.parse(occurredAt) < Date.parse(current.timelineItem.updatedAt) ||
    Date.parse(occurredAt) < Date.parse(current.content.updatedAt) ||
    Date.parse(occurredAt) < Date.parse(claim.causedAt)
  ) {
    throw new TerminalMaterializationRollback("message_state_conflict", true);
  }
}

function requireAppliedFileClosure(
  result: FinalizeInboxV2AttachmentMaterializationResult
): InboxV2AppliedAttachmentMaterializationClosure {
  if (typeof result === "string") {
    throw new TerminalMaterializationRollback(
      result === "lease_lost" ? "lease_lost" : "state_conflict",
      false
    );
  }
  return result;
}

function payloadReference(input: {
  tenantId: string;
  recordId: string;
  schemaId: string;
  schemaVersion: string;
  payload: unknown;
}): InboxV2PayloadReference {
  return inboxV2PayloadReferenceSchema.parse({
    tenantId: input.tenantId,
    recordId: input.recordId,
    schemaId: input.schemaId,
    schemaVersion: input.schemaVersion,
    digest: `sha256:${computeInboxV2TimelineMessageCommitDigest(input.payload)}`
  });
}

function internalEntityReference(
  tenantId: string,
  entityTypeId: "core:message" | "core:conversation",
  referenceDomain: "message" | "conversation",
  entityId: string
) {
  return deriveInboxV2AttachmentMaterializationAuditReference({
    tenantId,
    entityTypeId,
    referenceDomain,
    entityId
  });
}

function trustedServiceId(
  mutation: WithInboxV2AuthorizedCommandMutationInput
): string {
  if (mutation.command.actor.kind !== "trusted_service") {
    throw new TypeError(
      "Attachment materialization terminal command requires a trusted service."
    );
  }
  return mutation.command.actor.trustedServiceId;
}

function trustedServiceIdFromContext(context: {
  actor:
    | Readonly<{ kind: "employee"; employeeId: string }>
    | Readonly<{ kind: "trusted_service"; trustedServiceId: string }>;
}): string {
  if (context.actor.kind !== "trusted_service") {
    throw new TypeError(
      "Attachment materialization terminal context requires a trusted service."
    );
  }
  return context.actor.trustedServiceId;
}

function trustedReservationServiceId(
  claim: InboxV2AttachmentMaterializationClaim
): string {
  const actor = claim.reservationAuthority.actor;
  if (actor.kind !== "trusted_service") {
    throw new TypeError(
      "Attachment materialization reservation requires trusted-service authority."
    );
  }
  return actor.trustedServiceId;
}

function reference(tenantId: string, kind: string, id: string) {
  return { tenantId, kind, id };
}

function derivePrefixedId(prefix: string, ...parts: string[]): string {
  return `${prefix}:${hashParts(prefix, ...parts)}`;
}

function hashParts(...parts: string[]): string {
  return calculateInboxV2CanonicalSha256({ parts }).slice("sha256:".length);
}

function digest(value: unknown): string {
  return computeInboxV2TimelineMessageCommitDigest(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return digest(left) === digest(right);
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function incrementCounter(value: string) {
  return inboxV2EntityRevisionSchema.parse(String(BigInt(value) + 1n));
}

function normalizeMaximumRebaseAttempts(value: number | undefined): number {
  if (value === undefined) return MAX_REBASE_ATTEMPTS;
  if (!Number.isInteger(value) || value < 1 || value > 16) {
    throw new TypeError(
      "maximumRebaseAttempts must be an integer from 1 to 16."
    );
  }
  return value;
}

class TerminalMaterializationRollback extends Error {
  constructor(
    readonly reason:
      | "already_applied_without_command"
      | "lease_lost"
      | "message_state_conflict"
      | "state_conflict",
    readonly rebase: boolean
  ) {
    super(reason);
    this.name = "TerminalMaterializationRollback";
  }
}
