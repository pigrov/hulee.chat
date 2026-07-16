import {
  inboxV2ConversationIdSchema,
  inboxV2ConversationParticipantIdSchema,
  inboxV2DeferredParticipantIntentSchema,
  inboxV2ExternalThreadIdSchema,
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2TenantIdSchema,
  type InboxV2DeferredParticipantIntent
} from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import { createInboxV2SourceParticipantMaterializer } from "./source-participant-materialization";

const at = "2026-07-17T09:00:00.000Z";
const tenantId = inboxV2TenantIdSchema.parse("tenant:participant-src004");
const sourceConnectionId = inboxV2SourceConnectionIdSchema.parse(
  "source_connection:src004"
);
const sourceAccountId = inboxV2SourceAccountIdSchema.parse(
  "source_account:src004"
);
const sourceIdentityId = inboxV2SourceExternalIdentityIdSchema.parse(
  "source_external_identity:shared-sender"
);
const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: sourceConnectionId
};
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: sourceAccountId
};
const sourceIdentity = {
  tenantId,
  kind: "source_external_identity" as const,
  id: sourceIdentityId
};
const adapterContract = {
  contractId: "module:synthetic:source-adapter",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "core:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: at
} as const;

describe("Inbox V2 context-bound source participant materialization", () => {
  it("keeps one source identity as distinct participants in separate group conversations", async () => {
    const groupA = groupFixture("a");
    const groupB = groupFixture("b");
    const bindings = new Map([
      [String(groupA.bindingId), groupA.projection],
      [String(groupB.bindingId), groupB.projection]
    ]);
    const mappings = new Map([
      [String(groupA.threadId), groupA.mapping],
      [String(groupB.threadId), groupB.mapping]
    ]);
    const participantRows = new Map<string, Record<string, unknown>>();
    const createParticipant = vi.fn(async (input) => {
      const key = `${input.conversationId}\0${input.subject.sourceExternalIdentity?.id}`;
      const existing = participantRows.get(key);
      if (existing !== undefined) {
        return { kind: "already_exists" as const, record: existing };
      }
      const record = {
        ...input,
        revision: "1",
        updatedAt: input.createdAt
      };
      participantRows.set(key, record);
      return { kind: "created" as const, record };
    });
    const materializer = createInboxV2SourceParticipantMaterializer({
      bindingRepository: {
        async findCurrent({ bindingId }: { bindingId: string }) {
          return bindings.get(String(bindingId)) ?? null;
        }
      } as never,
      externalThreadRepository: {
        async findById({ threadId }: { threadId: string }) {
          return mappings.get(String(threadId)) ?? null;
        }
      } as never,
      participantRepository: { createParticipant } as never,
      participantIdFactory: {
        derive({ conversationId }) {
          return inboxV2ConversationParticipantIdSchema.parse(
            `conversation_participant:${String(conversationId).split(":").at(-1)}`
          );
        }
      },
      now: () => at
    });

    const [first, second] = await Promise.all([
      materializer.materialize({
        tenantId,
        bindingId: groupA.bindingId,
        expectedBindingRevision: "1",
        intent: groupA.intent
      }),
      materializer.materialize({
        tenantId,
        bindingId: groupB.bindingId,
        expectedBindingRevision: "1",
        intent: groupB.intent
      })
    ]);

    expect(first).toMatchObject({
      outcome: "created",
      participant: {
        conversationId: groupA.conversationId,
        subject: {
          kind: "source_external_identity",
          sourceExternalIdentity: sourceIdentity
        }
      }
    });
    expect(second).toMatchObject({
      outcome: "created",
      participant: {
        conversationId: groupB.conversationId,
        subject: {
          kind: "source_external_identity",
          sourceExternalIdentity: sourceIdentity
        }
      }
    });
    expect(first).not.toMatchObject({
      participant: {
        id: (second as { participant: { id: string } }).participant.id
      }
    });
    expect(createParticipant).toHaveBeenCalledTimes(2);
    expect(participantRows).toHaveLength(2);
  });

  it("rejects binding/thread substitution before participant persistence", async () => {
    const groupA = groupFixture("a");
    const groupB = groupFixture("b");
    const createParticipant = vi.fn();
    const materializer = createInboxV2SourceParticipantMaterializer({
      bindingRepository: {
        async findCurrent() {
          return groupA.projection;
        }
      } as never,
      externalThreadRepository: {
        async findById() {
          return groupA.mapping;
        }
      } as never,
      participantRepository: { createParticipant } as never,
      participantIdFactory: {
        derive() {
          return inboxV2ConversationParticipantIdSchema.parse(
            "conversation_participant:never"
          );
        }
      },
      now: () => at
    });

    await expect(
      materializer.materialize({
        tenantId,
        bindingId: groupA.bindingId,
        expectedBindingRevision: "1",
        intent: groupB.intent
      })
    ).resolves.toEqual({ outcome: "context_conflict" });
    expect(createParticipant).not.toHaveBeenCalled();
  });
});

function groupFixture(suffix: "a" | "b") {
  const bindingId = inboxV2SourceThreadBindingIdSchema.parse(
    `source_thread_binding:group-${suffix}`
  );
  const threadId = inboxV2ExternalThreadIdSchema.parse(
    `external_thread:group-${suffix}`
  );
  const conversationId = inboxV2ConversationIdSchema.parse(
    `conversation:group-${suffix}`
  );
  const key = {
    realm: {
      realmId: "module:synthetic:thread-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "source_account" as const, owner: sourceAccount },
    objectKindId: "module:synthetic:group",
    canonicalExternalSubject: `Group-${suffix.toUpperCase()}`
  };
  const declaration = {
    adapterContract,
    identityKind: "external_thread" as const,
    realmId: key.realm.realmId,
    realmVersion: key.realm.realmVersion,
    canonicalizationVersion: key.realm.canonicalizationVersion,
    objectKindId: key.objectKindId,
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
  const intent: InboxV2DeferredParticipantIntent =
    inboxV2DeferredParticipantIntentSchema.parse({
      key: {
        tenantId,
        externalThreadKey: key,
        sourceExternalIdentity: sourceIdentity
      },
      externalThreadContext: {
        sourceConnection,
        sourceAccount,
        identityDeclaration: declaration,
        key,
        observedExternalSubject: key.canonicalExternalSubject
      },
      inducingObservations: [
        {
          normalizedInboundEvent: {
            tenantId,
            kind: "normalized_inbound_event",
            id: inboxV2NormalizedInboundEventIdSchema.parse(
              `normalized_inbound_event:group-${suffix}`
            )
          },
          safeEnvelopeHmacSha256: `hmac-sha256:${suffix.repeat(64)}`,
          observationKey: `observation:author-${suffix}`,
          purpose: "message_author"
        }
      ],
      membershipAuthority: "none",
      recordedAt: at,
      revision: "1"
    });
  const externalThread = {
    tenantId,
    kind: "external_thread" as const,
    id: threadId
  };
  return {
    bindingId,
    threadId,
    conversationId,
    intent,
    projection: {
      binding: {
        tenantId,
        id: bindingId,
        externalThread,
        sourceConnection,
        sourceAccount,
        revision: "1"
      }
    },
    mapping: {
      tenantId,
      thread: {
        tenantId,
        id: threadId,
        key
      },
      conversation: {
        tenantId,
        id: conversationId,
        transport: "external"
      }
    }
  } as const;
}
