import { z } from "zod";

import type {
  NormalizedInboundEventId,
  RawInboundEventId,
  SourceAccountId,
  SourceConnectionId,
  SourceEventType,
  SourceType,
  SourceVisibility,
  TenantId
} from "./index";

export const sourceIdentityCandidateKindSchema = z.enum([
  "external_user",
  "email",
  "phone",
  "username",
  "profile_url",
  "display_name",
  "source_customer_id",
  "custom"
]);

export const sourceIdentityConfidenceSchema = z.enum([
  "verified",
  "strong",
  "weak"
]);

export const sourceIdentityCandidateSchema = z
  .object({
    kind: sourceIdentityCandidateKindSchema,
    value: z.string().trim().min(1).max(512),
    confidence: sourceIdentityConfidenceSchema.default("weak"),
    sourceField: z.string().trim().min(1).max(160).optional(),
    label: z.string().trim().min(1).max(160).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const sourceIdentityResolverInputSchema = z
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
    externalThreadId: z.string().trim().min(1).max(512).optional(),
    externalUserId: z.string().trim().min(1).max(512).optional(),
    rawEventId: z.string().trim().min(1).optional(),
    normalizedEventId: z.string().trim().min(1).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    candidates: z.array(sourceIdentityCandidateSchema).min(1).max(20),
    profileSnapshot: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export type SourceIdentityCandidateKind = z.infer<
  typeof sourceIdentityCandidateKindSchema
>;

export type SourceIdentityConfidence = z.infer<
  typeof sourceIdentityConfidenceSchema
>;

export type SourceIdentityCandidate = z.infer<
  typeof sourceIdentityCandidateSchema
>;

export type SourceIdentityResolverInput = z.infer<
  typeof sourceIdentityResolverInputSchema
>;

export type NormalizeSourceIdentityResolverInput = {
  tenantId: TenantId | string;
  sourceConnectionId: SourceConnectionId | string;
  sourceAccountId?: SourceAccountId | string | null;
  sourceType: SourceType | string;
  sourceName: string;
  sourceEventType: SourceEventType | string;
  sourceVisibility: SourceVisibility | string;
  externalThreadId?: string | null;
  externalUserId?: string | null;
  rawEventId?: RawInboundEventId | string | null;
  normalizedEventId?: NormalizedInboundEventId | string | null;
  occurredAt?: Date | string | null;
  candidates?: readonly Partial<SourceIdentityCandidate>[];
  profileSnapshot?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export function normalizeSourceIdentityResolverInput(
  input: NormalizeSourceIdentityResolverInput
): SourceIdentityResolverInput {
  const candidates = normalizeSourceIdentityCandidates([
    ...(input.externalUserId
      ? [
          {
            kind: "external_user" as const,
            value: input.externalUserId,
            confidence: "strong" as const,
            sourceField: "externalUserId"
          }
        ]
      : []),
    ...(input.candidates ?? [])
  ]);

  return sourceIdentityResolverInputSchema.parse({
    tenantId: String(input.tenantId),
    sourceConnectionId: String(input.sourceConnectionId),
    ...(input.sourceAccountId
      ? { sourceAccountId: String(input.sourceAccountId) }
      : {}),
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    sourceEventType: input.sourceEventType,
    sourceVisibility: input.sourceVisibility,
    ...(input.externalThreadId
      ? { externalThreadId: input.externalThreadId }
      : {}),
    ...(input.externalUserId ? { externalUserId: input.externalUserId } : {}),
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
    candidates,
    ...(input.profileSnapshot
      ? { profileSnapshot: input.profileSnapshot }
      : {}),
    ...(input.metadata ? { metadata: input.metadata } : {})
  });
}

export function normalizeSourceIdentityCandidates(
  candidates: readonly Partial<SourceIdentityCandidate>[]
): SourceIdentityCandidate[] {
  const seen = new Map<string, SourceIdentityCandidate>();

  for (const candidate of candidates) {
    if (!candidate.value) {
      continue;
    }

    const parsed = sourceIdentityCandidateSchema.parse(candidate);
    const key = `${parsed.kind}:${parsed.value.trim().toLowerCase()}`;
    const existing = seen.get(key);

    if (
      !existing ||
      confidenceRank(parsed.confidence) < confidenceRank(existing.confidence)
    ) {
      seen.set(key, parsed);
    }
  }

  return [...seen.values()].sort(
    (left, right) =>
      confidenceRank(left.confidence) - confidenceRank(right.confidence)
  );
}

function confidenceRank(confidence: SourceIdentityConfidence): number {
  switch (confidence) {
    case "verified":
      return 0;
    case "strong":
      return 1;
    case "weak":
      return 2;
  }
}
