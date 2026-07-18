import { createHash } from "node:crypto";

import {
  inboxV2ConversationIdSchema,
  inboxV2ExternalReplyAuthoritySchema,
  inboxV2TenantIdSchema,
  type InboxV2AuthorizationDecisionReference
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  assertInboxV2AuthorizedCommandMutationContext,
  type InboxV2AuthorizationActor,
  type InboxV2AuthorizationResourceRevisionExpectation,
  type InboxV2AuthorizedCommandMutationContext
} from "./sql-inbox-v2-authorization-repository";

type InboxV2ExternalReplyAuthority = z.infer<
  typeof inboxV2ExternalReplyAuthoritySchema
>;

const inboxV2OutboundReplyAuthorityFenceInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    conversationId: inboxV2ConversationIdSchema,
    replyAuthority: inboxV2ExternalReplyAuthoritySchema
  })
  .strict();

export type InboxV2OutboundReplyAuthorityFenceInput = z.input<
  typeof inboxV2OutboundReplyAuthorityFenceInputSchema
>;

export type InboxV2OutboundReplyAuthorityFenceRejectionReason =
  | "authorization_context_mismatch"
  | "authorization_fence_missing"
  | "work_head_not_found"
  | "work_head_identity_mismatch"
  | "work_head_revision_stale"
  | "work_intake_not_no_work"
  | "intake_decision_stale"
  | "slot_not_found"
  | "slot_identity_mismatch"
  | "slot_revision_stale"
  | "work_item_present"
  | "work_item_not_found"
  | "work_item_identity_mismatch"
  | "work_item_revision_stale"
  | "primary_assignment_stale"
  | "collaborator_stale"
  | "queue_reply_policy_stale";

export type InboxV2OutboundReplyAuthorityFenceResult =
  | Readonly<{
      kind: "committed";
      authorityKind: InboxV2ExternalReplyAuthority["kind"];
    }>
  | Readonly<{
      kind: "rejected";
      reason: InboxV2OutboundReplyAuthorityFenceRejectionReason;
    }>;

export type InboxV2OutboundReplyAuthoritySlotRow = Readonly<{
  tenant_id: unknown;
  id: unknown;
  conversation_id: unknown;
  latest_ordinal: unknown;
  latest_work_item_id: unknown;
  latest_lifecycle_class: unknown;
  latest_lifecycle_fence_revision: unknown;
  current_non_terminal_work_item_id: unknown;
  current_non_terminal_ordinal: unknown;
  revision: unknown;
}>;

export type InboxV2OutboundReplyAuthorityWorkHeadRow = Readonly<{
  tenant_id: unknown;
  id: unknown;
  conversation_id: unknown;
  work_item_count: unknown;
  current_outcome: unknown;
  intake_decision_high_water: unknown;
  pending_materialization_ordinal: unknown;
  revision: unknown;
}>;

type InboxV2OutboundReplyAuthorityConversationRow = Readonly<{
  tenant_id: unknown;
  id: unknown;
}>;

type InboxV2OutboundReplyAuthorityWorkItemRow = Readonly<{
  tenant_id: unknown;
  id: unknown;
  conversation_id: unknown;
  state: unknown;
  queue_id: unknown;
  queue_revision: unknown;
  current_primary_assignment_id: unknown;
  collaborator_set_revision: unknown;
  resource_access_revision: unknown;
  reopen_cycle: unknown;
  revision: unknown;
}>;

type InboxV2OutboundReplyAuthorityPrimaryAssignmentRow = Readonly<{
  tenant_id: unknown;
  id: unknown;
  work_item_id: unknown;
  employee_id: unknown;
  state: unknown;
  revision: unknown;
}>;

type InboxV2OutboundReplyAuthorityCollaboratorRow = Readonly<{
  tenant_id: unknown;
  collaborator_id: unknown;
  work_item_id: unknown;
  work_item_cycle: unknown;
  employee_id: unknown;
  current_state: unknown;
  current_revision: unknown;
}>;

type InboxV2OutboundReplyAuthorityQueuePolicyRow = Readonly<{
  tenant_id: unknown;
  work_queue_id: unknown;
  revision: unknown;
  external_reply_policy_mode: unknown;
  external_reply_policy_revision: unknown;
}>;

const NON_TERMINAL_WORK_ITEM_STATES = new Set([
  "new",
  "assigned",
  "in_progress",
  "waiting"
]);

/**
 * Revalidates the server-stamped external reply authority inside the same
 * authorized prepare transaction that will persist route and Message rows.
 * Expected races are data results; forged/non-live contexts remain programmer
 * errors and are rejected by the coordinator capability assertion.
 */
export async function fenceInboxV2OutboundReplyAuthorityInTransaction(
  context: InboxV2AuthorizedCommandMutationContext,
  input: InboxV2OutboundReplyAuthorityFenceInput
): Promise<InboxV2OutboundReplyAuthorityFenceResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  if (
    context.profile !== "domain" ||
    context.atomicMaterializationToken === undefined
  ) {
    throw new TypeError(
      "Outbound reply authority requires the live atomic materialization prepare context."
    );
  }

  const normalized = inboxV2OutboundReplyAuthorityFenceInputSchema.parse(input);
  const authority = normalized.replyAuthority;
  if (
    (context.commandTypeId !== "core:message.send" &&
      context.commandTypeId !== "core:source.dispatch.reroute") ||
    context.tenantId !== normalized.tenantId ||
    authority.conversation.tenantId !== normalized.tenantId ||
    authority.conversation.id !== normalized.conversationId ||
    !actorMatchesAuthority(context.actor, context.authorizationEpoch, authority)
  ) {
    return rejected("authorization_context_mismatch");
  }

  const conversationFence = findExactResourceFence(
    context.authorizationResourceRevisionFences,
    "conversation",
    normalized.conversationId
  );
  if (
    conversationFence === null ||
    !hasAllowedDecision({
      decisions: context.authorizationDecisionRefs,
      contextActor: context.actor,
      authorizationEpoch: context.authorizationEpoch,
      tenantId: normalized.tenantId,
      entityTypeId: "core:conversation",
      entityId: normalized.conversationId,
      permissionId: "core:message.reply_external",
      resourceAccessRevision: conversationFence.expectedResourceAccessRevision
    })
  ) {
    return rejected("authorization_fence_missing");
  }

  if (authority.kind === "no_work_item") {
    const conversationResult =
      await context.executor.execute<InboxV2OutboundReplyAuthorityConversationRow>(
        buildLockInboxV2OutboundReplyAuthorityConversationSql({
          tenantId: normalized.tenantId,
          conversationId: normalized.conversationId
        })
      );
    assertAtMostOneRow(
      conversationResult.rows,
      "outbound reply Conversation lock"
    );
    const conversation = conversationResult.rows[0];
    if (
      conversation === undefined ||
      requiredString(conversation.tenant_id) !== normalized.tenantId ||
      requiredString(conversation.id) !== normalized.conversationId
    ) {
      return rejected("work_head_not_found");
    }

    const headResult =
      await context.executor.execute<InboxV2OutboundReplyAuthorityWorkHeadRow>(
        buildLockInboxV2OutboundReplyAuthorityWorkHeadSql({
          tenantId: normalized.tenantId,
          conversationId: normalized.conversationId
        })
      );
    assertAtMostOneRow(
      headResult.rows,
      "outbound reply Conversation Work head lock"
    );
    const headFence = evaluateInboxV2NoWorkItemReplyAuthorityHeadFence({
      tenantId: normalized.tenantId,
      conversationId: normalized.conversationId,
      expectedIntakeDecisionRevision: authority.intakeDecisionRevision,
      row: headResult.rows[0] ?? null
    });
    if (headFence.kind === "rejected") return headFence;

    const slotResult =
      await context.executor.execute<InboxV2OutboundReplyAuthoritySlotRow>(
        buildLockInboxV2OutboundReplyAuthoritySlotSql({
          tenantId: normalized.tenantId,
          slotId: authority.workItemSlot.id
        })
      );
    assertAtMostOneRow(slotResult.rows, "outbound reply WorkItem slot lock");
    return evaluateInboxV2NoWorkItemReplyAuthorityFence({
      tenantId: normalized.tenantId,
      conversationId: normalized.conversationId,
      slotId: authority.workItemSlot.id,
      expectedSlotRevision: authority.expectedSlotRevision,
      row: slotResult.rows[0] ?? null
    });
  }

  const workItemFence = findExactResourceFence(
    context.authorizationResourceRevisionFences,
    "work_item",
    authority.workItem.id
  );
  if (
    workItemFence === null ||
    workItemFence.resourceKind !== "work_item" ||
    workItemFence.expectedWorkItemRevision !==
      authority.expectedWorkItemRevision ||
    !hasAllowedDecision({
      decisions: context.authorizationDecisionRefs,
      contextActor: context.actor,
      authorizationEpoch: context.authorizationEpoch,
      tenantId: normalized.tenantId,
      entityTypeId: "core:work-item",
      entityId: authority.workItem.id,
      permissionId: "core:work.read",
      resourceAccessRevision: workItemFence.expectedResourceAccessRevision
    }) ||
    (authority.kind === "supervisor_override" &&
      !hasAllowedDecision({
        decisions: context.authorizationDecisionRefs,
        contextActor: context.actor,
        authorizationEpoch: context.authorizationEpoch,
        tenantId: normalized.tenantId,
        entityTypeId: "core:work-item",
        entityId: authority.workItem.id,
        permissionId: "core:work.override",
        resourceAccessRevision: workItemFence.expectedResourceAccessRevision
      }))
  ) {
    return rejected("authorization_fence_missing");
  }

  const workItemResult =
    await context.executor.execute<InboxV2OutboundReplyAuthorityWorkItemRow>(
      buildLockInboxV2OutboundReplyAuthorityWorkItemSql({
        tenantId: normalized.tenantId,
        workItemId: authority.workItem.id
      })
    );
  assertAtMostOneRow(workItemResult.rows, "outbound reply WorkItem lock");
  const workItem = workItemResult.rows[0];
  if (workItem === undefined) return rejected("work_item_not_found");
  if (
    requiredString(workItem.tenant_id) !== normalized.tenantId ||
    requiredString(workItem.id) !== authority.workItem.id ||
    requiredString(workItem.conversation_id) !== normalized.conversationId ||
    !NON_TERMINAL_WORK_ITEM_STATES.has(requiredString(workItem.state)) ||
    counterString(workItem.reopen_cycle) !== workItemFence.workItemCycle ||
    counterString(workItem.resource_access_revision) !==
      workItemFence.expectedResourceAccessRevision
  ) {
    return rejected("work_item_identity_mismatch");
  }
  if (counterString(workItem.revision) !== authority.expectedWorkItemRevision) {
    return rejected("work_item_revision_stale");
  }

  if (authority.kind === "active_primary_responsible") {
    if (
      nullableString(workItem.current_primary_assignment_id) !==
      authority.primaryAssignment.id
    ) {
      return rejected("primary_assignment_stale");
    }
    const assignmentResult =
      await context.executor.execute<InboxV2OutboundReplyAuthorityPrimaryAssignmentRow>(
        buildFindInboxV2OutboundReplyAuthorityPrimaryAssignmentSql({
          tenantId: normalized.tenantId,
          assignmentId: authority.primaryAssignment.id
        })
      );
    assertAtMostOneRow(
      assignmentResult.rows,
      "outbound reply primary assignment"
    );
    const assignment = assignmentResult.rows[0];
    if (
      assignment === undefined ||
      requiredString(assignment.tenant_id) !== normalized.tenantId ||
      requiredString(assignment.id) !== authority.primaryAssignment.id ||
      requiredString(assignment.work_item_id) !== authority.workItem.id ||
      requiredString(assignment.employee_id) !==
        authority.appActor.employee.id ||
      requiredString(assignment.state) !== "active" ||
      counterString(assignment.revision) !==
        authority.expectedAssignmentRevision
    ) {
      return rejected("primary_assignment_stale");
    }
  } else if (authority.kind === "active_allowed_collaborator") {
    if (
      workItemFence.expectedCollaboratorSetRevision === undefined ||
      counterString(workItem.collaborator_set_revision) !==
        workItemFence.expectedCollaboratorSetRevision
    ) {
      return rejected("authorization_fence_missing");
    }
    const collaboratorResult =
      await context.executor.execute<InboxV2OutboundReplyAuthorityCollaboratorRow>(
        buildFindInboxV2OutboundReplyAuthorityCollaboratorSql({
          tenantId: normalized.tenantId,
          collaboratorId: authority.collaboratorEpisode.id
        })
      );
    assertAtMostOneRow(collaboratorResult.rows, "outbound reply collaborator");
    const collaborator = collaboratorResult.rows[0];
    if (
      collaborator === undefined ||
      requiredString(collaborator.tenant_id) !== normalized.tenantId ||
      requiredString(collaborator.collaborator_id) !==
        authority.collaboratorEpisode.id ||
      requiredString(collaborator.work_item_id) !== authority.workItem.id ||
      counterString(collaborator.work_item_cycle) !==
        workItemFence.workItemCycle ||
      requiredString(collaborator.employee_id) !==
        authority.appActor.employee.id ||
      requiredString(collaborator.current_state) !== "active" ||
      counterString(collaborator.current_revision) !==
        authority.expectedCollaboratorRevision
    ) {
      return rejected("collaborator_stale");
    }
    const queuePolicyResult =
      await context.executor.execute<InboxV2OutboundReplyAuthorityQueuePolicyRow>(
        buildFindInboxV2OutboundReplyAuthorityQueuePolicySql({
          tenantId: normalized.tenantId,
          workQueueId: requiredString(workItem.queue_id),
          queueRevision: counterString(workItem.queue_revision)
        })
      );
    assertAtMostOneRow(queuePolicyResult.rows, "outbound reply Queue policy");
    const queuePolicy = queuePolicyResult.rows[0];
    if (
      queuePolicy === undefined ||
      requiredString(queuePolicy.tenant_id) !== normalized.tenantId ||
      requiredString(queuePolicy.work_queue_id) !==
        requiredString(workItem.queue_id) ||
      counterString(queuePolicy.revision) !==
        counterString(workItem.queue_revision) ||
      requiredString(queuePolicy.external_reply_policy_mode) !==
        "responsible_or_work_item_collaborator" ||
      counterString(queuePolicy.external_reply_policy_revision) !==
        authority.queueReplyPolicyRevision
    ) {
      return rejected("queue_reply_policy_stale");
    }
  }

  return committed(authority.kind);
}

export function buildLockInboxV2OutboundReplyAuthorityWorkHeadSql(input: {
  tenantId: string;
  conversationId: string;
}): SQL {
  return sql`
    select tenant_id, id, conversation_id, work_item_count, current_outcome,
           intake_decision_high_water, pending_materialization_ordinal,
           revision
    from inbox_v2_conversation_work_heads
    where tenant_id = ${input.tenantId}
      and conversation_id = ${input.conversationId}
    for update
  `;
}

export function buildLockInboxV2OutboundReplyAuthorityConversationSql(input: {
  tenantId: string;
  conversationId: string;
}): SQL {
  return sql`
    select tenant_id, id
    from inbox_v2_conversations
    where tenant_id = ${input.tenantId}
      and id = ${input.conversationId}
    for no key update
  `;
}

export function evaluateInboxV2NoWorkItemReplyAuthorityHeadFence(input: {
  tenantId: string;
  conversationId: string;
  expectedIntakeDecisionRevision: string;
  row: InboxV2OutboundReplyAuthorityWorkHeadRow | null;
}): InboxV2OutboundReplyAuthorityFenceResult {
  if (input.row === null) return rejected("work_head_not_found");
  if (
    requiredString(input.row.tenant_id) !== input.tenantId ||
    requiredString(input.row.id) !==
      conversationWorkHeadId(input.tenantId, input.conversationId) ||
    requiredString(input.row.conversation_id) !== input.conversationId
  ) {
    return rejected("work_head_identity_mismatch");
  }

  const workItemCount = counterString(input.row.work_item_count);
  const highWater = counterString(input.row.intake_decision_high_water);
  const pendingMaterializationOrdinal = nullableCounterString(
    input.row.pending_materialization_ordinal
  );
  const revision = counterString(input.row.revision);
  if (BigInt(revision) !== 1n + BigInt(highWater) + BigInt(workItemCount)) {
    return rejected("work_head_revision_stale");
  }
  if (
    requiredString(input.row.current_outcome) !== "no_work_item" ||
    workItemCount !== "0" ||
    pendingMaterializationOrdinal !== null
  ) {
    return rejected("work_intake_not_no_work");
  }
  if (highWater !== input.expectedIntakeDecisionRevision) {
    return rejected("intake_decision_stale");
  }
  return committed("no_work_item");
}

export function buildLockInboxV2OutboundReplyAuthoritySlotSql(input: {
  tenantId: string;
  slotId: string;
}): SQL {
  return sql`
    select tenant_id, id, conversation_id,
           latest_ordinal, latest_work_item_id, latest_lifecycle_class,
           latest_lifecycle_fence_revision,
           current_non_terminal_work_item_id,
           current_non_terminal_ordinal, revision
    from inbox_v2_conversation_work_item_slots
    where tenant_id = ${input.tenantId}
      and id = ${input.slotId}
    for update
  `;
}

export function evaluateInboxV2NoWorkItemReplyAuthorityFence(input: {
  tenantId: string;
  conversationId: string;
  slotId: string;
  expectedSlotRevision: string;
  row: InboxV2OutboundReplyAuthoritySlotRow | null;
}): InboxV2OutboundReplyAuthorityFenceResult {
  if (input.row === null) return rejected("slot_not_found");
  if (
    requiredString(input.row.tenant_id) !== input.tenantId ||
    requiredString(input.row.id) !== input.slotId ||
    requiredString(input.row.conversation_id) !== input.conversationId
  ) {
    return rejected("slot_identity_mismatch");
  }
  if (counterString(input.row.revision) !== input.expectedSlotRevision) {
    return rejected("slot_revision_stale");
  }
  if (
    counterString(input.row.latest_ordinal) !== "0" ||
    nullableString(input.row.latest_work_item_id) !== null ||
    nullableString(input.row.latest_lifecycle_class) !== null ||
    nullableCounterString(input.row.latest_lifecycle_fence_revision) !== null ||
    nullableString(input.row.current_non_terminal_work_item_id) !== null ||
    nullableCounterString(input.row.current_non_terminal_ordinal) !== null
  ) {
    return rejected("work_item_present");
  }
  return committed("no_work_item");
}

function buildLockInboxV2OutboundReplyAuthorityWorkItemSql(input: {
  tenantId: string;
  workItemId: string;
}): SQL {
  return sql`
    select tenant_id, id, conversation_id, state, queue_id, queue_revision,
           current_primary_assignment_id, collaborator_set_revision,
           resource_access_revision, reopen_cycle, revision
    from inbox_v2_work_items
    where tenant_id = ${input.tenantId}
      and id = ${input.workItemId}
    for update
  `;
}

function buildFindInboxV2OutboundReplyAuthorityPrimaryAssignmentSql(input: {
  tenantId: string;
  assignmentId: string;
}): SQL {
  return sql`
    select tenant_id, id, work_item_id, employee_id, state, revision
    from inbox_v2_work_item_primary_assignments
    where tenant_id = ${input.tenantId}
      and id = ${input.assignmentId}
  `;
}

function buildFindInboxV2OutboundReplyAuthorityCollaboratorSql(input: {
  tenantId: string;
  collaboratorId: string;
}): SQL {
  return sql`
    select tenant_id, collaborator_id, work_item_id, work_item_cycle,
           employee_id, current_state, current_revision
    from inbox_v2_auth_collaborator_heads
    where tenant_id = ${input.tenantId}
      and collaborator_id = ${input.collaboratorId}
      and resource_kind = 'work_item'
  `;
}

function buildFindInboxV2OutboundReplyAuthorityQueuePolicySql(input: {
  tenantId: string;
  workQueueId: string;
  queueRevision: string;
}): SQL {
  return sql`
    select tenant_id, work_queue_id, revision, external_reply_policy_mode,
           external_reply_policy_revision
    from inbox_v2_work_queue_versions
    where tenant_id = ${input.tenantId}
      and work_queue_id = ${input.workQueueId}
      and revision = ${input.queueRevision}
  `;
}

function findExactResourceFence(
  fences: readonly InboxV2AuthorizationResourceRevisionExpectation[],
  resourceKind: "conversation" | "work_item",
  resourceId: string
): InboxV2AuthorizationResourceRevisionExpectation | null {
  const matching = fences.filter(
    (fence) =>
      fence.resourceKind === resourceKind && fence.resourceId === resourceId
  );
  return matching.length === 1 ? matching[0]! : null;
}

function hasAllowedDecision(input: {
  decisions: readonly InboxV2AuthorizationDecisionReference[];
  contextActor: InboxV2AuthorizationActor;
  authorizationEpoch: string;
  tenantId: string;
  entityTypeId: string;
  entityId: string;
  permissionId: string;
  resourceAccessRevision: string;
}): boolean {
  return input.decisions.some(
    (decision) =>
      decision.tenantId === input.tenantId &&
      decision.authorizationEpoch === input.authorizationEpoch &&
      decision.permissionId === input.permissionId &&
      decision.resource.tenantId === input.tenantId &&
      decision.resource.entityTypeId === input.entityTypeId &&
      String(decision.resource.entityId) === input.entityId &&
      decision.resourceAccessRevision === input.resourceAccessRevision &&
      decision.outcome === "allowed" &&
      decisionPrincipalMatchesActor(decision, input.contextActor)
  );
}

function decisionPrincipalMatchesActor(
  decision: InboxV2AuthorizationDecisionReference,
  actor: InboxV2AuthorizationActor
): boolean {
  if (decision.principal.kind !== actor.kind) return false;
  return actor.kind === "employee" && decision.principal.kind === "employee"
    ? decision.principal.employee.id === actor.employeeId
    : actor.kind === "trusted_service" &&
        decision.principal.kind === "trusted_service" &&
        decision.principal.trustedServiceId === actor.trustedServiceId;
}

function actorMatchesAuthority(
  contextActor: InboxV2AuthorizationActor,
  authorizationEpoch: string,
  authority: InboxV2ExternalReplyAuthority
): boolean {
  const appActor = authority.appActor;
  if (contextActor.kind !== appActor.kind) return false;
  return contextActor.kind === "employee" && appActor.kind === "employee"
    ? contextActor.employeeId === appActor.employee.id &&
        authorizationEpoch === appActor.authorizationEpoch
    : contextActor.kind === "trusted_service" &&
        appActor.kind === "trusted_service" &&
        contextActor.trustedServiceId === appActor.trustedServiceId;
}

function committed(
  authorityKind: InboxV2ExternalReplyAuthority["kind"]
): InboxV2OutboundReplyAuthorityFenceResult {
  return Object.freeze({ kind: "committed", authorityKind });
}

function rejected(
  reason: InboxV2OutboundReplyAuthorityFenceRejectionReason
): InboxV2OutboundReplyAuthorityFenceResult {
  return Object.freeze({ kind: "rejected", reason });
}

function assertAtMostOneRow(rows: readonly unknown[], label: string): void {
  if (rows.length > 1) {
    throw new Error(`Inbox V2 ${label} returned more than one row.`);
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Inbox V2 outbound reply authority row is invalid.");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requiredString(value);
}

function counterString(value: unknown): string {
  if (
    (typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "bigint") ||
    !/^(?:0|[1-9][0-9]*)$/u.test(String(value))
  ) {
    throw new TypeError(
      "Inbox V2 outbound reply authority revision is invalid."
    );
  }
  return String(value);
}

function nullableCounterString(value: unknown): string | null {
  return value === null ? null : counterString(value);
}

function conversationWorkHeadId(
  tenantId: string,
  conversationId: string
): string {
  const digest = createHash("sha256")
    .update(`${tenantId}\u001f${conversationId}`, "utf8")
    .digest("hex");
  return `conversation_work_head:${digest}`;
}
