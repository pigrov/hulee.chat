import {
  calculateInboxV2CanonicalSha256,
  inboxV2BigintCounterSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemIdSchema,
  type InboxV2MessageEditFileSourceAuthorityTarget,
  type InboxV2MessageEditFileUploadAuthorityTarget
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import {
  createSqlInboxV2AuthorizedCommandCoordinator,
  type InboxV2AuthorizationTransactionExecutor,
  type InboxV2AuthorizedCommandMutationResult,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import {
  prepareInboxV2MessageLifecycleCommand,
  sealInboxV2PreparedMessageLifecycleCommand,
  type InboxV2MessageMutationCommit,
  type InboxV2MessageProviderLifecycleCreationCommit
} from "./sql-inbox-v2-timeline-message-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type InboxV2MessageLifecycleAtomicResult = Readonly<{
  messageId: string;
  messageRevision: string | null;
  providerOperationId: string | null;
}>;

/**
 * Transactional delete fence copied from the already-validated lifecycle
 * authorization guard. The coordinator always rechecks the current governance
 * control-set row and the exact TimelineItem before it mutates Message state or
 * creates provider work.
 */
export type InboxV2MessageLifecycleLegalHoldFence = Readonly<{
  tenantId: string;
  timelineItemId: string;
  expectedLegalHoldSetRevision: string;
}>;

export type InboxV2MessageLifecycleAtomicCoordinator = Readonly<{
  withAuthorizedMessageLifecycleMutation(
    input: Readonly<{
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      messageMutation: InboxV2MessageMutationCommit | null;
      providerOperationCreation: InboxV2MessageProviderLifecycleCreationCommit | null;
      legalHoldFence: InboxV2MessageLifecycleLegalHoldFence | null;
      fileUploadAuthorityPlan: readonly InboxV2MessageEditFileUploadAuthorityTarget[];
      fileSourceAuthorityPlan: readonly InboxV2MessageEditFileSourceAuthorityTarget[];
    }>
  ): Promise<
    InboxV2AuthorizedCommandMutationResult<InboxV2MessageLifecycleAtomicResult>
  >;
}>;

type LifecyclePreparationRollbackResult = Extract<
  InboxV2AuthorizedCommandMutationResult<InboxV2MessageLifecycleAtomicResult>,
  { kind: "resource_not_found" | "revision_conflict" }
>;

class InboxV2MessageLifecyclePreparationRollback extends Error {
  constructor(readonly result: LifecyclePreparationRollbackResult) {
    super("Inbox V2 Message lifecycle preparation requires rollback.");
    this.name = "InboxV2MessageLifecyclePreparationRollback";
  }
}

/**
 * Production-only adapter used by the API command boundary. The generic
 * Message writer remains private; callers can supply only closed lifecycle
 * commits through the authorized two-phase coordinator.
 */
export function createSqlInboxV2MessageLifecycleAtomicCoordinator(
  executor: InboxV2AuthorizationTransactionExecutor | HuleeDatabase
): InboxV2MessageLifecycleAtomicCoordinator {
  const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(executor);
  return Object.freeze({
    async withAuthorizedMessageLifecycleMutation(input) {
      const messageMutation = input.messageMutation;
      const providerOperationCreation = input.providerOperationCreation;
      const nestedProviderOperationCreation =
        messageMutation?.providerOperationCreationCommit ?? null;
      const commandKind = messageLifecycleCommandKind(messageMutation);
      const legalHoldFence = normalizeLegalHoldFence(input.legalHoldFence);
      const fileUploadAuthorityPlan = input.fileUploadAuthorityPlan;
      const fileSourceAuthorityPlan = input.fileSourceAuthorityPlan;
      if (
        (messageMutation === null && providerOperationCreation === null) ||
        (messageMutation === null &&
          providerOperationCreation?.operation.action !== "delete") ||
        (messageMutation !== null &&
          ((providerOperationCreation === null) !==
            (nestedProviderOperationCreation === null) ||
            (providerOperationCreation !== null &&
              nestedProviderOperationCreation !== null &&
              calculateInboxV2CanonicalSha256(providerOperationCreation) !==
                calculateInboxV2CanonicalSha256(
                  nestedProviderOperationCreation
                )))) ||
        (commandKind !== "edit" &&
          (fileUploadAuthorityPlan.length !== 0 ||
            fileSourceAuthorityPlan.length !== 0)) ||
        !legalHoldFenceMatchesCommand(
          legalHoldFence,
          commandKind,
          messageMutation,
          providerOperationCreation
        )
      ) {
        throw new TypeError(
          "Message lifecycle coordinator requires one closed edit/local-delete/provider-delete commit set."
        );
      }
      try {
        return await coordinator.withAuthorizedAtomicMaterialization(
          input.authorizedMutation,
          async (context) => {
            if (
              legalHoldFence !== null &&
              !(await lockAndValidateMessageLifecycleLegalHoldFence(
                context.executor,
                legalHoldFence,
                input.authorizedMutation.occurredAt
              ))
            ) {
              throw new InboxV2MessageLifecyclePreparationRollback({
                kind: "revision_conflict",
                code: "revision.conflict",
                conflicts: []
              });
            }
            const prepared =
              messageMutation === null
                ? providerOperationCreation === null
                  ? neverLifecyclePreparation()
                  : await prepareInboxV2MessageLifecycleCommand(context, {
                      kind: "provider_lifecycle",
                      commit: providerOperationCreation
                    })
                : await prepareInboxV2MessageLifecycleCommand(context, {
                    kind: "message_mutation",
                    tenantId: messageMutation.tenantId,
                    conversationId:
                      messageMutation.beforeMessage.conversation.id,
                    messageId: messageMutation.beforeMessage.id,
                    fileUploadAuthorityPlan,
                    fileSourceAuthorityPlan,
                    plan: () => messageMutation
                  });
            if (prepared.kind === "message_not_found") {
              throw new InboxV2MessageLifecyclePreparationRollback({
                kind: "resource_not_found"
              });
            }
            if (prepared.kind !== "ready") {
              throw new InboxV2MessageLifecyclePreparationRollback({
                kind: "revision_conflict",
                code: "revision.conflict",
                conflicts: []
              });
            }
            return prepared.capability;
          },
          async (context, capability) => {
            const sealed = await sealInboxV2PreparedMessageLifecycleCommand(
              context,
              {
                capability
              }
            );
            return {
              result: {
                messageId: sealed.message.id,
                messageRevision:
                  sealed.commandKind === "provider_delete"
                    ? null
                    : sealed.message.revision,
                providerOperationId:
                  providerOperationCreation?.operation.id ?? null
              },
              receipt: sealed.receipt
            };
          }
        );
      } catch (error) {
        if (error instanceof InboxV2MessageLifecyclePreparationRollback) {
          return error.result;
        }
        throw error;
      }
    }
  });
}

type MessageLifecycleCommandKind = "edit" | "local_delete" | "provider_delete";

function messageLifecycleCommandKind(
  messageMutation: InboxV2MessageMutationCommit | null
): MessageLifecycleCommandKind {
  if (messageMutation === null) return "provider_delete";
  return messageMutation.revision.change.kind === "local_delete_tombstone"
    ? "local_delete"
    : "edit";
}

function normalizeLegalHoldFence(
  fence: InboxV2MessageLifecycleLegalHoldFence | null
): InboxV2MessageLifecycleLegalHoldFence | null {
  if (fence === null) return null;
  return Object.freeze({
    tenantId: inboxV2TenantIdSchema.parse(fence.tenantId),
    timelineItemId: inboxV2TimelineItemIdSchema.parse(fence.timelineItemId),
    expectedLegalHoldSetRevision: inboxV2BigintCounterSchema.parse(
      fence.expectedLegalHoldSetRevision
    )
  });
}

function legalHoldFenceMatchesCommand(
  fence: InboxV2MessageLifecycleLegalHoldFence | null,
  commandKind: MessageLifecycleCommandKind,
  messageMutation: InboxV2MessageMutationCommit | null,
  providerOperationCreation: InboxV2MessageProviderLifecycleCreationCommit | null
): boolean {
  const requiresFence = commandKind !== "edit";
  if (requiresFence !== (fence !== null)) return false;
  if (fence === null) return true;
  const tenantId =
    messageMutation?.tenantId ?? providerOperationCreation?.tenantId ?? null;
  const timelineItemId =
    messageMutation?.beforeTimelineItem.id ??
    providerOperationCreation?.timelineItem.id ??
    null;
  return fence.tenantId === tenantId && fence.timelineItemId === timelineItemId;
}

export function buildEnsureInboxV2MessageLifecycleLegalHoldControlSetSql(
  fence: InboxV2MessageLifecycleLegalHoldFence,
  occurredAt: string
): SQL {
  return sql`
    insert into inbox_v2_data_governance_control_set_heads (
      tenant_id, legal_hold_set_revision, restriction_set_revision,
      last_changed_stream_position, head_revision, updated_at
    )
    select tenant.id, 0, 0, 0, 1, ${occurredAt}::timestamptz
      from tenants tenant
     where tenant.id = ${fence.tenantId}
    on conflict (tenant_id) do nothing
  `;
}

export function buildLockInboxV2MessageLifecycleLegalHoldFenceSql(
  fence: InboxV2MessageLifecycleLegalHoldFence
): SQL {
  return sql`
    select control_set.legal_hold_set_revision::text as legal_hold_set_revision
      from inbox_v2_data_governance_control_set_heads control_set
     where control_set.tenant_id = ${fence.tenantId}
       and control_set.legal_hold_set_revision =
           ${fence.expectedLegalHoldSetRevision}::bigint
       and not exists (
         select 1
           from inbox_v2_data_governance_legal_hold_targets hold_target
           join inbox_v2_data_governance_legal_hold_heads hold_head
             on hold_head.tenant_id = hold_target.tenant_id
            and hold_head.hold_id = hold_target.hold_id
            and hold_head.current_revision = hold_target.hold_revision
            and hold_head.state = 'active'
          where hold_target.tenant_id = control_set.tenant_id
            and hold_target.entity_type_id = 'core:timeline-item'
            and hold_target.entity_id = ${fence.timelineItemId}
            and hold_target.state = 'active'
       )
     for share of control_set
  `;
}

async function lockAndValidateMessageLifecycleLegalHoldFence(
  executor: RawSqlExecutor,
  fence: InboxV2MessageLifecycleLegalHoldFence,
  occurredAt: string
): Promise<boolean> {
  await executor.execute(
    buildEnsureInboxV2MessageLifecycleLegalHoldControlSetSql(fence, occurredAt)
  );
  const result = await executor.execute<{ legal_hold_set_revision: unknown }>(
    buildLockInboxV2MessageLifecycleLegalHoldFenceSql(fence)
  );
  return (
    result.rows.length === 1 &&
    String(result.rows[0]?.legal_hold_set_revision) ===
      fence.expectedLegalHoldSetRevision
  );
}

function neverLifecyclePreparation(): never {
  throw new TypeError("Provider-delete lifecycle commit is missing.");
}
