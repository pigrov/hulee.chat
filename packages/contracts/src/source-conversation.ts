import { z } from "zod";

import type {
  ClientId,
  ConversationId,
  NormalizedInboundEventId,
  RawInboundEventId,
  SourceAccountId,
  SourceConnectionId,
  SourceEventType,
  SourceType,
  SourceVisibility,
  TenantId
} from "./index";

export const sourceConversationTypeHintSchema = z.enum([
  "client_direct",
  "client_group",
  "internal_direct",
  "internal_group",
  "support_case",
  "intake"
]);

export const sourceConversationKeyKindSchema = z.enum([
  "external_thread",
  "external_post",
  "listing",
  "order",
  "review",
  "lead",
  "call",
  "email_thread",
  "form_submission",
  "crm_record",
  "custom"
]);

export const sourceConversationKeyStrengthSchema = z.enum([
  "exact",
  "strong",
  "weak"
]);

export const sourceConversationKeyCandidateSchema = z
  .object({
    kind: sourceConversationKeyKindSchema,
    value: z.string().trim().min(1).max(512),
    strength: sourceConversationKeyStrengthSchema.default("strong"),
    sourceField: z.string().trim().min(1).max(160).optional(),
    label: z.string().trim().min(1).max(160).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const sourceConversationRoutingHintsSchema = z
  .object({
    queueKey: z.string().trim().min(1).max(160).optional(),
    teamKey: z.string().trim().min(1).max(160).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(20).optional()
  })
  .strict();

export const sourceConversationResolverInputSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    sourceConnectionId: z.string().trim().min(1),
    sourceAccountId: z.string().trim().min(1).optional(),
    sourceType: z.enum([
      "messenger",
      "social",
      "marketplace",
      "classified",
      "review",
      "email",
      "phone",
      "form",
      "internal",
      "crm",
      "api"
    ]),
    sourceName: z.string().trim().min(1).max(120),
    sourceEventType: z.enum([
      "message",
      "comment",
      "review",
      "lead",
      "call",
      "order_question",
      "system",
      "status_update"
    ]),
    sourceVisibility: z.enum(["private", "public", "internal"]),
    rawEventId: z.string().trim().min(1).optional(),
    normalizedEventId: z.string().trim().min(1).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    clientId: z.string().trim().min(1).optional(),
    existingConversationId: z.string().trim().min(1).optional(),
    conversationTypeHint: sourceConversationTypeHintSchema.default("intake"),
    externalThreadId: z.string().trim().min(1).max(512).optional(),
    externalMessageId: z.string().trim().min(1).max(512).optional(),
    parentExternalEventId: z.string().trim().min(1).max(512).optional(),
    title: z.string().trim().min(1).max(240).optional(),
    summary: z.string().trim().min(1).max(1000).optional(),
    keyCandidates: z.array(sourceConversationKeyCandidateSchema).min(1).max(20),
    routingHints: sourceConversationRoutingHintsSchema.optional(),
    eventPayload: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export type SourceConversationTypeHint = z.infer<
  typeof sourceConversationTypeHintSchema
>;

export type SourceConversationKeyKind = z.infer<
  typeof sourceConversationKeyKindSchema
>;

export type SourceConversationKeyStrength = z.infer<
  typeof sourceConversationKeyStrengthSchema
>;

export type SourceConversationKeyCandidate = z.infer<
  typeof sourceConversationKeyCandidateSchema
>;

export type SourceConversationRoutingHints = z.infer<
  typeof sourceConversationRoutingHintsSchema
>;

export type SourceConversationResolverInput = z.infer<
  typeof sourceConversationResolverInputSchema
>;

export type NormalizeSourceConversationResolverInput = {
  tenantId: TenantId | string;
  sourceConnectionId: SourceConnectionId | string;
  sourceAccountId?: SourceAccountId | string | null;
  sourceType: SourceType | string;
  sourceName: string;
  sourceEventType: SourceEventType | string;
  sourceVisibility: SourceVisibility | string;
  rawEventId?: RawInboundEventId | string | null;
  normalizedEventId?: NormalizedInboundEventId | string | null;
  occurredAt?: Date | string | null;
  clientId?: ClientId | string | null;
  existingConversationId?: ConversationId | string | null;
  conversationTypeHint?: SourceConversationTypeHint;
  externalThreadId?: string | null;
  externalMessageId?: string | null;
  parentExternalEventId?: string | null;
  title?: string | null;
  summary?: string | null;
  keyCandidates?: readonly Partial<SourceConversationKeyCandidate>[];
  routingHints?: SourceConversationRoutingHints;
  eventPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export function normalizeSourceConversationResolverInput(
  input: NormalizeSourceConversationResolverInput
): SourceConversationResolverInput {
  const keyCandidates = normalizeSourceConversationKeyCandidates([
    ...(input.externalThreadId
      ? [
          {
            kind: "external_thread" as const,
            value: input.externalThreadId,
            strength: "exact" as const,
            sourceField: "externalThreadId"
          }
        ]
      : []),
    ...(input.keyCandidates ?? [])
  ]);

  return sourceConversationResolverInputSchema.parse({
    tenantId: String(input.tenantId),
    sourceConnectionId: String(input.sourceConnectionId),
    ...(input.sourceAccountId
      ? { sourceAccountId: String(input.sourceAccountId) }
      : {}),
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    sourceEventType: input.sourceEventType,
    sourceVisibility: input.sourceVisibility,
    ...(input.rawEventId ? { rawEventId: String(input.rawEventId) } : {}),
    ...(input.normalizedEventId
      ? { normalizedEventId: String(input.normalizedEventId) }
      : {}),
    ...(input.occurredAt
      ? {
          occurredAt:
            input.occurredAt instanceof Date
              ? input.occurredAt.toISOString()
              : input.occurredAt
        }
      : {}),
    ...(input.clientId ? { clientId: String(input.clientId) } : {}),
    ...(input.existingConversationId
      ? { existingConversationId: String(input.existingConversationId) }
      : {}),
    ...(input.conversationTypeHint
      ? { conversationTypeHint: input.conversationTypeHint }
      : {}),
    ...(input.externalThreadId
      ? { externalThreadId: input.externalThreadId }
      : {}),
    ...(input.externalMessageId
      ? { externalMessageId: input.externalMessageId }
      : {}),
    ...(input.parentExternalEventId
      ? { parentExternalEventId: input.parentExternalEventId }
      : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    keyCandidates,
    ...(input.routingHints ? { routingHints: input.routingHints } : {}),
    ...(input.eventPayload ? { eventPayload: input.eventPayload } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {})
  });
}

export function normalizeSourceConversationKeyCandidates(
  candidates: readonly Partial<SourceConversationKeyCandidate>[]
): SourceConversationKeyCandidate[] {
  const seen = new Map<string, SourceConversationKeyCandidate>();

  for (const candidate of candidates) {
    if (!candidate.value) {
      continue;
    }

    const parsed = sourceConversationKeyCandidateSchema.parse(candidate);
    const key = `${parsed.kind}:${parsed.value.trim().toLowerCase()}`;
    const existing = seen.get(key);

    if (
      !existing ||
      strengthRank(parsed.strength) < strengthRank(existing.strength)
    ) {
      seen.set(key, parsed);
    }
  }

  return [...seen.values()].sort(
    (left, right) => strengthRank(left.strength) - strengthRank(right.strength)
  );
}

function strengthRank(strength: SourceConversationKeyStrength): number {
  switch (strength) {
    case "exact":
      return 0;
    case "strong":
      return 1;
    case "weak":
      return 2;
  }
}
