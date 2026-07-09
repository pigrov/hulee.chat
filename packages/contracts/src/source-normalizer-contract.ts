import { z } from "zod";

import type {
  NormalizedInboundEvent,
  RawInboundEvent,
  SourceAccountId,
  SourceType
} from "./index";
import { replyCapabilitySchema } from "./source-capabilities";
import { sourceConversationResolverInputSchema } from "./source-conversation";
import { sourceIdempotencyKeySchema } from "./source-idempotency";
import { sourceIdentityResolverInputSchema } from "./source-identity";
import { sourceProcessingDecisionSchema } from "./source-processing";
import type {
  SourceConversationResolverInput,
  SourceIdentityResolverInput,
  SourceProcessingDecision
} from "./index";

export class SourceNormalizerContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceNormalizerContractError";
  }
}

export type SourceNormalizerContractAdapter = {
  sourceType: SourceType | string;
  sourceName: string;
};

export type SourceNormalizerContractEvent = {
  normalizedEvent: NormalizedInboundEvent;
  identityResolverInput?: SourceIdentityResolverInput;
  conversationResolverInput?: SourceConversationResolverInput;
  processingDecision?: SourceProcessingDecision;
};

export type SourceNormalizerContractCase = {
  name: string;
  adapter: SourceNormalizerContractAdapter;
  rawEvent: RawInboundEvent;
  events: readonly SourceNormalizerContractEvent[];
};

export type SourceNormalizerContractReport = {
  name: string;
  eventCount: number;
  sourceType: string;
  sourceName: string;
};

const sourceProcessingStatusSchema = z.enum([
  "new",
  "processed",
  "failed",
  "ignored",
  "duplicate"
]);

export function assertSourceNormalizerContract(
  testCase: SourceNormalizerContractCase
): SourceNormalizerContractReport {
  if (!testCase.name.trim()) {
    fail("Contract case name is required.");
  }

  assertRawEventContract(testCase);

  if (testCase.events.length === 0) {
    if (
      testCase.rawEvent.processingStatus !== "ignored" &&
      testCase.rawEvent.processingStatus !== "duplicate"
    ) {
      fail(
        `${testCase.name}: normalizer must emit at least one event unless the raw event is ignored or duplicate.`
      );
    }
  }

  for (const [index, event] of testCase.events.entries()) {
    assertNormalizedEventContract({
      testCase,
      item: event,
      index
    });
  }

  return {
    name: testCase.name,
    eventCount: testCase.events.length,
    sourceType: String(testCase.adapter.sourceType),
    sourceName: testCase.adapter.sourceName
  };
}

function assertRawEventContract(testCase: SourceNormalizerContractCase): void {
  const rawEvent = testCase.rawEvent;
  const prefix = `${testCase.name}: rawEvent`;

  sourceIdempotencyKeySchema.parse(rawEvent.idempotencyKey);

  if (!rawEvent.idempotencyKey.includes(":raw:")) {
    fail(`${prefix}.idempotencyKey must use the raw phase.`);
  }

  sourceProcessingStatusSchema.parse(rawEvent.processingStatus);
}

function assertNormalizedEventContract(input: {
  testCase: SourceNormalizerContractCase;
  item: SourceNormalizerContractEvent;
  index: number;
}): void {
  const event = input.item.normalizedEvent;
  const rawEvent = input.testCase.rawEvent;
  const prefix = `${input.testCase.name}: events[${input.index}]`;

  sourceIdempotencyKeySchema.parse(event.idempotencyKey);

  if (!event.idempotencyKey.includes(":normalized:")) {
    fail(
      `${prefix}.normalizedEvent.idempotencyKey must use the normalized phase.`
    );
  }

  sourceProcessingStatusSchema.parse(event.processingStatus);

  assertEqual(prefix, "tenantId", event.tenantId, rawEvent.tenantId);
  assertEqual(prefix, "rawEventId", event.rawEventId, rawEvent.id);
  assertEqual(
    prefix,
    "sourceConnectionId",
    event.sourceConnectionId,
    rawEvent.sourceConnectionId
  );
  assertOptionalSourceAccount(input.testCase, event.sourceAccountId, prefix);
  assertEqual(
    prefix,
    "sourceType",
    event.sourceType,
    input.testCase.adapter.sourceType
  );
  assertEqual(
    prefix,
    "sourceName",
    event.sourceName,
    input.testCase.adapter.sourceName
  );

  if (event.replyCapability) {
    replyCapabilitySchema.parse(event.replyCapability);
  }

  if (requiresResolverInputs(event)) {
    if (!input.item.identityResolverInput) {
      fail(`${prefix} requires identityResolverInput.`);
    }

    if (!input.item.conversationResolverInput) {
      fail(`${prefix} requires conversationResolverInput.`);
    }
  }

  if (input.item.identityResolverInput) {
    assertIdentityInputContract({
      prefix,
      event,
      identity: input.item.identityResolverInput
    });
  }

  if (input.item.conversationResolverInput) {
    assertConversationInputContract({
      prefix,
      event,
      conversation: input.item.conversationResolverInput
    });
  }

  if (input.item.processingDecision) {
    const parsed = sourceProcessingDecisionSchema.parse(
      input.item.processingDecision
    );
    assertEqual(
      prefix,
      "processingDecision.diagnostics.tenantId",
      parsed.diagnostics.tenantId,
      event.tenantId
    );
    assertEqual(
      prefix,
      "processingDecision.diagnostics.sourceConnectionId",
      parsed.diagnostics.sourceConnectionId,
      event.sourceConnectionId
    );
  }
}

function assertIdentityInputContract(input: {
  prefix: string;
  event: NormalizedInboundEvent;
  identity: SourceIdentityResolverInput;
}): void {
  const parsed = sourceIdentityResolverInputSchema.parse(input.identity);

  assertEqual(
    input.prefix,
    "identity.tenantId",
    parsed.tenantId,
    input.event.tenantId
  );
  assertEqual(
    input.prefix,
    "identity.sourceConnectionId",
    parsed.sourceConnectionId,
    input.event.sourceConnectionId
  );
  assertEqual(
    input.prefix,
    "identity.sourceType",
    parsed.sourceType,
    input.event.sourceType
  );
  assertEqual(
    input.prefix,
    "identity.sourceName",
    parsed.sourceName,
    input.event.sourceName
  );
  assertEqual(
    input.prefix,
    "identity.sourceEventType",
    parsed.sourceEventType,
    input.event.eventType
  );

  if (parsed.normalizedEventId) {
    assertEqual(
      input.prefix,
      "identity.normalizedEventId",
      parsed.normalizedEventId,
      input.event.id
    );
  }
}

function assertConversationInputContract(input: {
  prefix: string;
  event: NormalizedInboundEvent;
  conversation: SourceConversationResolverInput;
}): void {
  const parsed = sourceConversationResolverInputSchema.parse(
    input.conversation
  );

  assertEqual(
    input.prefix,
    "conversation.tenantId",
    parsed.tenantId,
    input.event.tenantId
  );
  assertEqual(
    input.prefix,
    "conversation.sourceConnectionId",
    parsed.sourceConnectionId,
    input.event.sourceConnectionId
  );
  assertEqual(
    input.prefix,
    "conversation.sourceType",
    parsed.sourceType,
    input.event.sourceType
  );
  assertEqual(
    input.prefix,
    "conversation.sourceName",
    parsed.sourceName,
    input.event.sourceName
  );
  assertEqual(
    input.prefix,
    "conversation.sourceEventType",
    parsed.sourceEventType,
    input.event.eventType
  );

  if (parsed.normalizedEventId) {
    assertEqual(
      input.prefix,
      "conversation.normalizedEventId",
      parsed.normalizedEventId,
      input.event.id
    );
  }
}

function assertOptionalSourceAccount(
  testCase: SourceNormalizerContractCase,
  actual: SourceAccountId | undefined,
  prefix: string
): void {
  const expected = testCase.rawEvent.sourceAccountId;

  if (expected) {
    assertEqual(prefix, "sourceAccountId", actual, expected);
    return;
  }

  if (actual) {
    fail(
      `${prefix}.normalizedEvent.sourceAccountId must be empty when rawEvent.sourceAccountId is empty.`
    );
  }
}

function requiresResolverInputs(event: NormalizedInboundEvent): boolean {
  return (
    event.direction === "inbound" &&
    event.eventType !== "system" &&
    event.eventType !== "status_update"
  );
}

function assertEqual(
  prefix: string,
  field: string,
  actual: unknown,
  expected: unknown
): void {
  if (actual !== expected) {
    fail(
      `${prefix}.${field} must be ${String(expected)}, received ${String(actual)}.`
    );
  }
}

function fail(message: string): never {
  throw new SourceNormalizerContractError(message);
}
