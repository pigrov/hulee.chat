import {
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SourceMessageReconciliationPlanSchema,
  type InboxV2SourceMessageReconciliationPlan
} from "@hulee/contracts";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import {
  deriveInboxV2SourceMessageReconciliationAuthorizationDigest,
  type InboxV2SourceMessageNamespaceDeriver,
  type InboxV2SourceMessageReconciliationAuthorizationInput
} from "./source-message-reconciliation-materializer";

const VERIFIER_OPTION_KEYS = new Set(["trustedServiceId", "namespaceDeriver"]);
const trustedPlanVerifiers = new WeakSet<object>();

export type InboxV2SourceMessageReconciliationPlanVerifier = Readonly<{
  verify(plan: InboxV2SourceMessageReconciliationPlan): boolean;
}>;

export function createInboxV2SourceMessageReconciliationPlanVerifier(input: {
  trustedServiceId: string;
  namespaceDeriver: InboxV2SourceMessageNamespaceDeriver;
}): InboxV2SourceMessageReconciliationPlanVerifier {
  assertExactOptions(input);
  const trustedServiceId = inboxV2RoutingTrustedServiceIdSchema.parse(
    input.trustedServiceId
  );
  const namespaceGeneration = inboxV2RoutingTokenSchema.parse(
    input.namespaceDeriver.namespaceGeneration
  );
  if (typeof input.namespaceDeriver.deriveNamespaceHmacSha256 !== "function") {
    throw new TypeError(
      "Source-message reconciliation verifier requires a namespace deriver."
    );
  }

  const verifier: InboxV2SourceMessageReconciliationPlanVerifier =
    Object.freeze({
      verify(untrustedPlan) {
        const parsed =
          inboxV2SourceMessageReconciliationPlanSchema.safeParse(untrustedPlan);
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
            deriveInboxV2SourceMessageReconciliationAuthorizationDigest(
              input.namespaceDeriver,
              unsignedPlan satisfies InboxV2SourceMessageReconciliationAuthorizationInput
            );
          return constantTimeEqual(
            materializationToken,
            `source-message-reconciliation:v1:${digest}`
          );
        } catch {
          return false;
        }
      }
    });

  trustedPlanVerifiers.add(verifier);
  return verifier;
}

export function isInboxV2TrustedSourceMessageReconciliationPlanVerifier(
  value: unknown
): value is InboxV2SourceMessageReconciliationPlanVerifier {
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
      "Source-message verifier accepts only trustedServiceId and namespaceDeriver."
    );
  }
}
