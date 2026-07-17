import {
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SourceConversationMaterializationPlanSchema,
  type InboxV2SourceConversationMaterializationPlan
} from "@hulee/contracts";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import {
  deriveInboxV2SourceConversationMaterializationAuthorizationDigest,
  type InboxV2SourceConversationMaterializationAuthorizationInput,
  type InboxV2SourceConversationNamespaceDeriver
} from "./source-conversation-resolution-materializer";

const VERIFIER_OPTION_KEYS = new Set(["trustedServiceId", "namespaceDeriver"]);
const trustedPlanVerifiers = new WeakSet<object>();

/**
 * Synchronous cryptographic authority used by the DB consume boundary. It is
 * deliberately compatible with the repository's structural verifier port,
 * while the WeakSet lets trusted worker composition reject lookalikes.
 */
export type InboxV2SourceConversationMaterializationPlanVerifier = Readonly<{
  verify(plan: InboxV2SourceConversationMaterializationPlan): boolean;
}>;

export function createInboxV2SourceConversationMaterializationPlanVerifier(input: {
  trustedServiceId: string;
  namespaceDeriver: InboxV2SourceConversationNamespaceDeriver;
}): InboxV2SourceConversationMaterializationPlanVerifier {
  assertExactOptions(input);
  const trustedServiceId = inboxV2RoutingTrustedServiceIdSchema.parse(
    input.trustedServiceId
  );
  const namespaceGeneration = inboxV2RoutingTokenSchema.parse(
    input.namespaceDeriver.namespaceGeneration
  );
  if (typeof input.namespaceDeriver.deriveNamespaceHmacSha256 !== "function") {
    throw new TypeError(
      "Conversation materialization verifier requires a namespace deriver."
    );
  }

  const verifier: InboxV2SourceConversationMaterializationPlanVerifier =
    Object.freeze({
      verify(untrustedPlan) {
        const parsed =
          inboxV2SourceConversationMaterializationPlanSchema.safeParse(
            untrustedPlan
          );
        if (!parsed.success) return false;
        const plan = parsed.data;
        if (
          String(plan.materializedByTrustedServiceId) !==
            String(trustedServiceId) ||
          String(plan.namespaceGeneration) !== String(namespaceGeneration)
        ) {
          return false;
        }

        try {
          const { materializationToken, ...unsignedPlan } = plan;
          const digest =
            deriveInboxV2SourceConversationMaterializationAuthorizationDigest(
              input.namespaceDeriver,
              unsignedPlan satisfies InboxV2SourceConversationMaterializationAuthorizationInput
            );
          const expected = `source-conversation-materialization:${namespaceGeneration}:${digest}`;
          return constantTimeEqual(materializationToken, expected);
        } catch {
          return false;
        }
      }
    });

  trustedPlanVerifiers.add(verifier);
  return verifier;
}

export function isInboxV2TrustedSourceConversationMaterializationPlanVerifier(
  value: unknown
): value is InboxV2SourceConversationMaterializationPlanVerifier {
  return (
    typeof value === "object" &&
    value !== null &&
    trustedPlanVerifiers.has(value)
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function assertExactOptions(input: object): void {
  const keys = Object.keys(input);
  if (
    keys.length !== VERIFIER_OPTION_KEYS.size ||
    keys.some((key) => !VERIFIER_OPTION_KEYS.has(key))
  ) {
    throw new TypeError(
      "Conversation materialization verifier accepts only trustedServiceId and namespaceDeriver."
    );
  }
}
