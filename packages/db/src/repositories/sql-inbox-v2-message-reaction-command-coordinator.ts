import {
  inboxV2MessageReactionCommitSchema,
  type InboxV2MessageReactionCommit
} from "@hulee/contracts";

import type { HuleeDatabase } from "../client";
import {
  createSqlInboxV2AuthorizedCommandCoordinator,
  type InboxV2AuthorizationTransactionExecutor,
  type InboxV2AuthorizedCommandMutationResult,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import { persistInboxV2ReactionRouteInTransaction } from "./sql-inbox-v2-outbound-transport-repository";
import {
  prepareInboxV2MessageReactionCommand,
  sealInboxV2PreparedMessageReactionCommand
} from "./sql-inbox-v2-timeline-message-repository";

export type InboxV2MessageReactionAtomicResult = Readonly<{
  reactionId: string;
  reactionRevision: string;
  transitionId: string;
}>;

export type InboxV2MessageReactionAtomicCoordinator = Readonly<{
  withAuthorizedMessageReactionMutation(
    input: Readonly<{
      authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      reactionCommit: InboxV2MessageReactionCommit;
    }>
  ): Promise<
    InboxV2AuthorizedCommandMutationResult<InboxV2MessageReactionAtomicResult>
  >;
}>;

type ReactionPreparationRollbackResult = Extract<
  InboxV2AuthorizedCommandMutationResult<InboxV2MessageReactionAtomicResult>,
  { kind: "resource_not_found" | "revision_conflict" }
>;

class InboxV2MessageReactionPreparationRollback extends Error {
  constructor(readonly result: ReactionPreparationRollbackResult) {
    super("Inbox V2 Message reaction preparation requires rollback.");
    this.name = "InboxV2MessageReactionPreparationRollback";
  }
}

/**
 * Production persistence boundary for app-authored reactions. Route creation,
 * exact Message/reaction-slot locks, route consumption and stream/outbox seal
 * share the same authorized transaction. Provider I/O starts only from the
 * committed outbox intent.
 */
export function createSqlInboxV2MessageReactionAtomicCoordinator(
  executor: InboxV2AuthorizationTransactionExecutor | HuleeDatabase
): InboxV2MessageReactionAtomicCoordinator {
  const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(executor);
  return Object.freeze({
    async withAuthorizedMessageReactionMutation(input) {
      const reactionCommit = inboxV2MessageReactionCommitSchema.parse(
        input.reactionCommit
      );
      if (
        reactionCommit.transition.mode !== "internal_apply" &&
        reactionCommit.transition.mode !== "external_request"
      ) {
        throw new TypeError(
          "Message reaction coordinator accepts only internal apply or external request commits."
        );
      }
      try {
        return await coordinator.withAuthorizedAtomicMaterialization(
          input.authorizedMutation,
          async (context) => {
            if (reactionCommit.transition.mode === "external_request") {
              const route = await persistInboxV2ReactionRouteInTransaction(
                context,
                reactionCommit
              );
              if (route.kind !== "committed") {
                throw new InboxV2MessageReactionPreparationRollback({
                  kind: "revision_conflict",
                  code: "revision.conflict",
                  conflicts: []
                });
              }
            }
            const prepared = await prepareInboxV2MessageReactionCommand(
              context,
              { commit: reactionCommit }
            );
            if (prepared.kind === "message_not_found") {
              throw new InboxV2MessageReactionPreparationRollback({
                kind: "resource_not_found"
              });
            }
            if (prepared.kind !== "ready") {
              throw new InboxV2MessageReactionPreparationRollback({
                kind: "revision_conflict",
                code: "revision.conflict",
                conflicts: []
              });
            }
            return prepared.capability;
          },
          async (context, capability) => {
            const sealed = await sealInboxV2PreparedMessageReactionCommand(
              context,
              { capability }
            );
            return {
              result: {
                reactionId: sealed.reaction.id,
                reactionRevision: sealed.reaction.revision,
                transitionId: sealed.transition.id
              },
              receipt: sealed.receipt
            };
          }
        );
      } catch (error) {
        if (error instanceof InboxV2MessageReactionPreparationRollback) {
          return error.result;
        }
        throw error;
      }
    }
  });
}
