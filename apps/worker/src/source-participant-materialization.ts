import {
  calculateInboxV2CanonicalSha256,
  inboxV2ConversationParticipantIdSchema,
  inboxV2DeferredParticipantIntentSchema,
  inboxV2EntityRevisionSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2TenantIdSchema,
  type InboxV2ConversationId,
  type InboxV2ConversationParticipant,
  type InboxV2ConversationParticipantId,
  type InboxV2DeferredParticipantIntent,
  type InboxV2SourceExternalIdentityId,
  type InboxV2SourceThreadBindingId,
  type InboxV2TenantId
} from "@hulee/contracts";
import type {
  InboxV2ExternalThreadRepository,
  InboxV2ParticipantMembershipRepository,
  InboxV2SourceThreadBindingRepository
} from "@hulee/db";

export type InboxV2ParticipantIdFactory = Readonly<{
  derive(input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
  }): InboxV2ConversationParticipantId;
}>;

export type MaterializeInboxV2DeferredParticipantInput = Readonly<{
  tenantId: InboxV2TenantId;
  bindingId: InboxV2SourceThreadBindingId;
  expectedBindingRevision: string;
  intent: InboxV2DeferredParticipantIntent;
}>;

export type MaterializeInboxV2DeferredParticipantResult =
  | Readonly<{
      outcome: "created" | "already_exists";
      participant: InboxV2ConversationParticipant;
    }>
  | Readonly<{
      outcome:
        | "binding_not_found"
        | "external_thread_not_found"
        | "context_conflict"
        | "binding_revision_conflict"
        | "participant_id_conflict";
    }>;

export type InboxV2SourceParticipantMaterializer = Readonly<{
  materialize(
    input: MaterializeInboxV2DeferredParticipantInput
  ): Promise<MaterializeInboxV2DeferredParticipantResult>;
}>;

export type InboxV2SourceParticipantMaterializerOptions = Readonly<{
  bindingRepository: Pick<InboxV2SourceThreadBindingRepository, "findCurrent">;
  externalThreadRepository: Pick<InboxV2ExternalThreadRepository, "findById">;
  participantRepository: Pick<
    InboxV2ParticipantMembershipRepository,
    "createParticipant"
  >;
  participantIdFactory: InboxV2ParticipantIdFactory;
  now(): string;
}>;

/**
 * Consumes an SRC-004 deferred participant intent only after SRC-005 has
 * supplied an exact current SourceThreadBinding. The service reloads the
 * binding and immutable ExternalThread mapping, verifies the preserved thread
 * key/source scope, and creates a conversation-local source-identity subject.
 *
 * It intentionally has no membership, claim, Account, RBAC, watcher/read,
 * WorkItem, CRM or notification dependency. Provider roster membership must be
 * materialized separately against exact binding-specific evidence.
 */
export function createInboxV2SourceParticipantMaterializer(
  options: InboxV2SourceParticipantMaterializerOptions
): InboxV2SourceParticipantMaterializer {
  return Object.freeze({
    async materialize(inputValue) {
      const tenantId = inboxV2TenantIdSchema.parse(inputValue.tenantId);
      const bindingId = inboxV2SourceThreadBindingIdSchema.parse(
        inputValue.bindingId
      );
      const expectedBindingRevision = inboxV2EntityRevisionSchema.parse(
        inputValue.expectedBindingRevision
      );
      const intent = inboxV2DeferredParticipantIntentSchema.parse(
        inputValue.intent
      );
      if (intent.key.tenantId !== tenantId) {
        return { outcome: "context_conflict" };
      }

      const projection = await options.bindingRepository.findCurrent({
        tenantId,
        bindingId
      });
      if (projection === null) return { outcome: "binding_not_found" };
      const binding = projection.binding;
      if (binding.revision !== expectedBindingRevision) {
        return { outcome: "binding_revision_conflict" };
      }
      if (
        binding.tenantId !== tenantId ||
        !sameReference(
          binding.sourceConnection,
          intent.externalThreadContext.sourceConnection
        ) ||
        intent.externalThreadContext.sourceAccount === null ||
        !sameReference(
          binding.sourceAccount,
          intent.externalThreadContext.sourceAccount
        )
      ) {
        return { outcome: "context_conflict" };
      }

      const mapping = await options.externalThreadRepository.findById({
        tenantId,
        threadId: binding.externalThread.id
      });
      if (mapping === null) return { outcome: "external_thread_not_found" };
      if (
        mapping.tenantId !== tenantId ||
        mapping.thread.tenantId !== binding.externalThread.tenantId ||
        String(mapping.thread.id) !== String(binding.externalThread.id) ||
        mapping.conversation.transport !== "external" ||
        calculateInboxV2CanonicalSha256(mapping.thread.key) !==
          calculateInboxV2CanonicalSha256(intent.key.externalThreadKey)
      ) {
        return { outcome: "context_conflict" };
      }

      const participantId = inboxV2ConversationParticipantIdSchema.parse(
        options.participantIdFactory.derive({
          tenantId,
          conversationId: mapping.conversation.id,
          sourceExternalIdentityId: intent.key.sourceExternalIdentity.id
        })
      );
      const createdAt = options.now();
      const result = await options.participantRepository.createParticipant({
        tenantId,
        id: participantId,
        conversationId: mapping.conversation.id,
        subject: {
          kind: "source_external_identity",
          sourceExternalIdentity: intent.key.sourceExternalIdentity
        },
        createdAt
      });
      if (result.kind === "created" || result.kind === "already_exists") {
        return { outcome: result.kind, participant: result.record };
      }
      // A subject winner with a different server-derived ID is not silently
      // adopted: it means ID derivation or tenant-key generation drifted.
      return { outcome: "participant_id_conflict" };
    }
  });
}

function sameReference(
  left: Readonly<{ tenantId: string; kind: string; id: string }>,
  right: Readonly<{ tenantId: string; kind: string; id: string }>
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.kind === right.kind &&
    String(left.id) === String(right.id)
  );
}
