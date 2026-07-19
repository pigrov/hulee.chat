import {
  inboxV2MessageCreationCommitSchema,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2OutboundDispatchRerouteCommitSchema,
  inboxV2OutboundRouteResolutionCommitSchema,
  type InboxV2MessageCreationCommit,
  type InboxV2MessageContentBlock,
  type InboxV2OutboundDispatchContentPlan,
  type InboxV2OutboundDispatchRerouteCommit,
  type InboxV2OutboundRouteResolutionCommit
} from "@hulee/contracts";
import {
  executeInboxV2AuthorizationGate,
  type InboxV2AuthorizationPlanInput,
  type InboxV2SecurityDenialContext,
  type InboxV2SecurityDenialSink
} from "@hulee/core";
import {
  fenceInboxV2OutboundReplyAuthorityInTransaction,
  InboxV2RouteResolutionRollbackError,
  persistInboxV2ExplicitRerouteResolutionInTransaction,
  persistInboxV2OutboundDispatchContentPlanInTransaction,
  persistInboxV2RouteResolutionInTransaction,
  prepareInboxV2MessageCreation,
  sealInboxV2PreparedMessageCreation,
  type InboxV2AuthorizedAtomicMaterializationCoordinator,
  type InboxV2AuthorizedCommandMutationResult,
  type WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";

export type InboxV2OutboundMessageMaterializationFingerprintAuthority =
  Readonly<{
    verify(input: {
      fingerprint: InboxV2OutboundDispatchContentPlan["contentFingerprint"];
      tenantId: string;
      timelineContent: InboxV2OutboundDispatchContentPlan["timelineContent"];
      contentRevision: string;
      contentDigestSha256: string;
      planCreatedAt: string;
      at: string;
    }): Promise<boolean>;
  }>;

export type InboxV2OutboundMessageMaterializationPersistence = Readonly<{
  fenceReplyAuthority: typeof fenceInboxV2OutboundReplyAuthorityInTransaction;
  persistRoute: typeof persistInboxV2RouteResolutionInTransaction;
  persistReroute: typeof persistInboxV2ExplicitRerouteResolutionInTransaction;
  prepareMessage: typeof prepareInboxV2MessageCreation;
  persistContentPlan: typeof persistInboxV2OutboundDispatchContentPlanInTransaction;
  sealMessage: typeof sealInboxV2PreparedMessageCreation;
}>;

export const inboxV2OutboundMessageProductionPersistence: InboxV2OutboundMessageMaterializationPersistence =
  Object.freeze({
    fenceReplyAuthority: fenceInboxV2OutboundReplyAuthorityInTransaction,
    persistRoute: persistInboxV2RouteResolutionInTransaction,
    persistReroute: persistInboxV2ExplicitRerouteResolutionInTransaction,
    prepareMessage: prepareInboxV2MessageCreation,
    persistContentPlan: persistInboxV2OutboundDispatchContentPlanInTransaction,
    sealMessage: sealInboxV2PreparedMessageCreation
  });

export type InboxV2AtomicOutboundMessageResult = Readonly<{
  messageId: string;
  outboundRouteId: string;
  outboundDispatchId: string;
}>;

type AtomicMutationResult =
  InboxV2AuthorizedCommandMutationResult<InboxV2AtomicOutboundMessageResult>;

export type InboxV2OutboundMessageMaterializationResult =
  | Readonly<{
      kind: "applied";
      mutation: Extract<AtomicMutationResult, { kind: "applied" }>;
    }>
  | Readonly<{
      kind: "already_applied";
      mutation: Extract<AtomicMutationResult, { kind: "already_applied" }>;
    }>
  | Readonly<{ kind: "idempotency_conflict" }>
  | Readonly<{ kind: "denied"; errorCode: string }>
  | Readonly<{ kind: "materialization_rejected"; reason: string }>
  | Readonly<{
      kind: "authorization_conflict";
      conflict: Exclude<
        AtomicMutationResult,
        { kind: "applied" | "already_applied" | "idempotency_conflict" }
      >;
    }>;

export type InboxV2OutboundMessageMaterializationInput = Readonly<{
  tenantId: string;
  conversationId: string;
  requiredConversationPermissionId:
    | "core:message.reply_external"
    | "core:message.forward_external";
  replyAuthority: Parameters<
    typeof fenceInboxV2OutboundReplyAuthorityInTransaction
  >[1]["replyAuthority"];
  authorizationPlan: InboxV2AuthorizationPlanInput;
  denialContext: InboxV2SecurityDenialContext;
  authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
  routeResolution: InboxV2OutboundRouteResolutionCommit;
  messageCreation: InboxV2MessageCreationCommit;
  dispatchContentPlan: InboxV2OutboundDispatchContentPlan;
  rerouteCommit?: InboxV2OutboundDispatchRerouteCommit | null;
}>;

export type InboxV2OutboundMessageMaterializationOptions = Readonly<{
  denialSink: InboxV2SecurityDenialSink;
  coordinator: InboxV2AuthorizedAtomicMaterializationCoordinator;
  contentFingerprintAuthority: InboxV2OutboundMessageMaterializationFingerprintAuthority;
  currentTime: () => string;
  persistence?: InboxV2OutboundMessageMaterializationPersistence;
  authorizationGate?: typeof executeInboxV2AuthorizationGate;
}>;

/** Exact content, binding, capability and object-pin closure shared by send,
 * reply and content-copy. */
export function inboxV2OutboundDispatchContentPlanMatches(
  plan: InboxV2OutboundDispatchContentPlan,
  messageCreation: InboxV2MessageCreationCommit,
  route: NonNullable<InboxV2MessageCreationCommit["outboundRoute"]>,
  dispatch: NonNullable<InboxV2MessageCreationCommit["outboundDispatch"]>
): boolean {
  const content = messageCreation.content;
  const binding = messageCreation.outboundBindingSnapshot;
  if (content.state.kind !== "available" || binding === null) return false;
  const artifactCapabilitiesMatch = plan.artifacts.every((artifact) =>
    binding.capabilities.entries.some(
      (capability) =>
        capability.capabilityId === artifact.capabilityId &&
        capability.operationId === artifact.operationId &&
        capability.contentKindId === route.contentKindId &&
        capability.state === "supported" &&
        (capability.validUntil === null ||
          Date.parse(capability.validUntil) > Date.parse(plan.createdAt)) &&
        capability.requiredProviderRoleIds.every((roleId) =>
          binding.providerAccess.roleIds.includes(roleId)
        )
    )
  );
  if (
    plan.tenantId !== messageCreation.tenantId ||
    String(plan.dispatch.id) !== String(dispatch.id) ||
    String(plan.message.id) !== String(messageCreation.message.id) ||
    plan.messageRevision !== messageCreation.message.revision ||
    String(plan.conversation.id) !==
      String(messageCreation.message.conversation.id) ||
    String(plan.timelineItem.id) !==
      String(messageCreation.message.timelineItem.id) ||
    String(plan.route.id) !== String(route.id) ||
    String(plan.timelineContent.id) !== String(content.id) ||
    plan.contentRevision !== content.revision ||
    String(plan.binding.id) !== String(route.sourceThreadBinding.id) ||
    plan.bindingRevision !== binding.revision ||
    plan.capabilityRevision !== route.bindingFence.capabilityRevision ||
    binding.capabilities.revision !== plan.capabilityRevision ||
    !sameValue(plan.adapterContract, route.adapterContract) ||
    plan.createdAt !== dispatch.createdAt ||
    plan.blocks.length !== content.state.blocks.length ||
    !artifactCapabilitiesMatch ||
    plan.artifacts.some(
      (artifact) => artifact.operationId !== route.operationId
    )
  ) {
    return false;
  }

  return content.state.blocks.every((block, index) => {
    const planned = plan.blocks[index];
    return (
      planned !== undefined &&
      planned.blockKey === block.blockKey &&
      planned.blockKind === block.kind &&
      sameValue(planned.exactFileObjectPin, exactFileObjectPinForBlock(block))
    );
  });
}

/**
 * Shared transaction seam for every content-bearing external Message command.
 * The caller must close and verify command/route/authorization semantics first;
 * this function owns only the common atomic persistence order. Provider I/O is
 * still outbox-driven and can start only after the coordinator commits.
 */
export async function materializeInboxV2OutboundMessage(
  input: InboxV2OutboundMessageMaterializationInput,
  options: InboxV2OutboundMessageMaterializationOptions
): Promise<InboxV2OutboundMessageMaterializationResult> {
  const routeResolution = inboxV2OutboundRouteResolutionCommitSchema.parse(
    input.routeResolution
  );
  const messageCreation = inboxV2MessageCreationCommitSchema.parse(
    input.messageCreation
  );
  const dispatchContentPlan = inboxV2OutboundDispatchContentPlanSchema.parse(
    input.dispatchContentPlan
  );
  const rerouteCommit =
    input.rerouteCommit === undefined || input.rerouteCommit === null
      ? null
      : inboxV2OutboundDispatchRerouteCommitSchema.parse(input.rerouteCommit);

  if (
    !(await verifyInboxV2OutboundDispatchContentFingerprint({
      plan: dispatchContentPlan,
      messageCreation,
      authority: options.contentFingerprintAuthority,
      currentTime: options.currentTime()
    }))
  ) {
    return {
      kind: "materialization_rejected",
      reason: "dispatch_content_fingerprint_rejected"
    };
  }

  const persistence =
    options.persistence ?? inboxV2OutboundMessageProductionPersistence;
  const authorizationGate =
    options.authorizationGate ?? executeInboxV2AuthorizationGate;

  try {
    const gated = await authorizationGate({
      authorizationPlan: input.authorizationPlan,
      denialContext: input.denialContext,
      denialSink: options.denialSink,
      executeAllowed: () =>
        options.coordinator.withAuthorizedAtomicMaterialization(
          input.authorizedMutation,
          async (context) => {
            const replyAuthority = await persistence.fenceReplyAuthority(
              context,
              {
                tenantId: input.tenantId,
                conversationId: input.conversationId,
                replyAuthority: input.replyAuthority,
                requiredConversationPermissionId:
                  input.requiredConversationPermissionId
              }
            );
            if (replyAuthority.kind !== "committed") {
              throw new InboxV2OutboundMessageMaterializationRejected(
                replyAuthority.reason
              );
            }

            const route =
              rerouteCommit === null
                ? await persistence.persistRoute(context, routeResolution)
                : await persistence.persistReroute(context, {
                    routeResolution,
                    rerouteCommit
                  });
            if (route.kind !== "committed") {
              throw new InboxV2OutboundMessageMaterializationRejected(
                route.kind
              );
            }

            const message = await persistence.prepareMessage(context, {
              commit: messageCreation
            });
            if (message.kind !== "ready") {
              throw new InboxV2OutboundMessageMaterializationRejected(
                message.kind
              );
            }

            const contentPlan = await persistence.persistContentPlan(
              context,
              dispatchContentPlan
            );
            if (contentPlan.kind !== "persisted") {
              throw new InboxV2OutboundMessageMaterializationRejected(
                "code" in contentPlan
                  ? contentPlan.code
                  : "dispatch_plan_already_persisted"
              );
            }
            return message.capability;
          },
          async (context, capability) => {
            const sealed = await persistence.sealMessage(context, {
              capability
            });
            const route = messageCreation.outboundRoute;
            const dispatch = messageCreation.outboundDispatch;
            if (route === null || dispatch === null) {
              throw new InboxV2OutboundMessageMaterializationRejected(
                "outbound_materialization_missing"
              );
            }
            return {
              result: {
                messageId: sealed.message.id,
                outboundRouteId: route.id,
                outboundDispatchId: dispatch.id
              },
              receipt: sealed.receipt
            };
          }
        )
    });

    if (gated.outcome === "denied") {
      return {
        kind: "denied",
        errorCode: gated.publicDecision.errorCode
      };
    }
    if (gated.value.kind === "applied") {
      return { kind: "applied", mutation: gated.value };
    }
    if (gated.value.kind === "already_applied") {
      return { kind: "already_applied", mutation: gated.value };
    }
    if (gated.value.kind === "idempotency_conflict") {
      return { kind: "idempotency_conflict" };
    }
    return { kind: "authorization_conflict", conflict: gated.value };
  } catch (error) {
    if (error instanceof InboxV2RouteResolutionRollbackError) {
      return {
        kind: "materialization_rejected",
        reason: error.result.kind
      };
    }
    if (error instanceof InboxV2OutboundMessageMaterializationRejected) {
      return {
        kind: "materialization_rejected",
        reason: error.reason
      };
    }
    throw error;
  }
}

async function verifyInboxV2OutboundDispatchContentFingerprint(input: {
  plan: InboxV2OutboundDispatchContentPlan;
  messageCreation: InboxV2MessageCreationCommit;
  authority: InboxV2OutboundMessageMaterializationFingerprintAuthority;
  currentTime: string;
}): Promise<boolean> {
  const content = input.messageCreation.content;
  const currentTimeMillis = Date.parse(input.currentTime);
  if (
    content.state.kind !== "available" ||
    !Number.isFinite(currentTimeMillis) ||
    Date.parse(input.plan.contentFingerprint.validUntil) <= currentTimeMillis
  ) {
    return false;
  }
  try {
    return await input.authority.verify({
      fingerprint: input.plan.contentFingerprint,
      tenantId: input.messageCreation.tenantId,
      timelineContent: input.messageCreation.message.content.content,
      contentRevision: content.revision,
      contentDigestSha256: content.state.contentDigestSha256,
      planCreatedAt: input.plan.createdAt,
      at: input.currentTime
    });
  } catch {
    return false;
  }
}

class InboxV2OutboundMessageMaterializationRejected extends Error {
  constructor(readonly reason: string) {
    super(`Outbound Message materialization rejected: ${reason}`);
    this.name = "InboxV2OutboundMessageMaterializationRejected";
  }
}

function exactFileObjectPinForBlock(block: InboxV2MessageContentBlock) {
  if (
    block.kind === "image" ||
    block.kind === "audio" ||
    block.kind === "video" ||
    block.kind === "file" ||
    block.kind === "sticker"
  ) {
    return block.attachment.state === "ready"
      ? {
          file: block.attachment.file,
          fileRevision: block.attachment.fileRevision,
          fileVersion: block.attachment.fileVersion,
          objectVersion: block.attachment.objectVersion
        }
      : null;
  }
  if (block.kind === "extension") {
    return block.payloadPin.state === "exact"
      ? {
          file: block.payloadFile,
          fileRevision: block.payloadPin.fileRevision,
          fileVersion: block.payloadPin.fileVersion,
          objectVersion: block.payloadPin.objectVersion
        }
      : null;
  }
  return null;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
