import { z } from "zod";

import type {
  ReplyCapability,
  SourceCapabilities,
  SourceConnectionStatus,
  SourceEventDirection
} from "./index";

export const sourceCapabilitiesSchema = z
  .object({
    canReceive: z.boolean(),
    canReply: z.boolean(),
    canFetchHistory: z.boolean(),
    canSendFiles: z.boolean(),
    canReceiveFiles: z.boolean(),
    supportsThreads: z.boolean(),
    supportsReactions: z.boolean(),
    supportsReadStatus: z.boolean(),
    supportsDeliveryStatus: z.boolean(),
    webhookSupported: z.boolean(),
    pollingRequired: z.boolean(),
    customerProfile: z.boolean(),
    rateLimitsKnown: z.boolean(),
    oauthSupported: z.boolean(),
    sandboxAvailable: z.boolean(),
    legalRisk: z.enum(["low", "medium", "high"]).optional(),
    replyWindowSeconds: z.number().int().positive().optional()
  })
  .strict();

export const replyCapabilitySchema = z
  .object({
    mode: z.enum([
      "native_reply",
      "external_link",
      "readonly",
      "expired",
      "unsupported"
    ]),
    reason: z.string().trim().min(1).optional(),
    externalReplyUrl: z.string().trim().url().optional(),
    expiresAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const defaultSourceCapabilities: SourceCapabilities = {
  canReceive: false,
  canReply: false,
  canFetchHistory: false,
  canSendFiles: false,
  canReceiveFiles: false,
  supportsThreads: false,
  supportsReactions: false,
  supportsReadStatus: false,
  supportsDeliveryStatus: false,
  webhookSupported: false,
  pollingRequired: false,
  customerProfile: false,
  rateLimitsKnown: false,
  oauthSupported: false,
  sandboxAvailable: false
};

export type ResolveReplyCapabilityInput = {
  capabilities: SourceCapabilities;
  sourceStatus: SourceConnectionStatus;
  direction?: SourceEventDirection;
  externalReplyUrl?: string | null;
  receivedAt?: Date | string | null;
  now?: Date | string;
};

export function normalizeSourceCapabilities(
  input: Partial<SourceCapabilities> = {}
): SourceCapabilities {
  return sourceCapabilitiesSchema.parse({
    ...defaultSourceCapabilities,
    ...input
  });
}

export function resolveReplyCapability(
  input: ResolveReplyCapabilityInput
): ReplyCapability {
  const capabilities = sourceCapabilitiesSchema.parse(input.capabilities);
  const sourceStatus = input.sourceStatus;
  const direction = input.direction ?? "inbound";
  const now = toDate(input.now ?? new Date());
  const receivedAt = input.receivedAt ? toDate(input.receivedAt) : null;
  const expiresAt = replyWindowExpiresAt({
    capabilities,
    receivedAt
  });
  const sharedWindow =
    expiresAt && expiresAt.getTime() > now.getTime()
      ? { expiresAt: expiresAt.toISOString() }
      : {};

  if (sourceStatus !== "active" && sourceStatus !== "degraded") {
    return {
      mode: "readonly",
      reason: "source_not_active"
    };
  }

  if (direction !== "inbound") {
    return {
      mode: "readonly",
      reason: "event_not_inbound"
    };
  }

  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return {
      mode: "expired",
      reason: "reply_window_expired",
      expiresAt: expiresAt.toISOString()
    };
  }

  if (capabilities.canReply) {
    return {
      mode: "native_reply",
      ...sharedWindow
    };
  }

  if (input.externalReplyUrl) {
    return replyCapabilitySchema.parse({
      mode: "external_link",
      externalReplyUrl: input.externalReplyUrl,
      ...sharedWindow
    });
  }

  return {
    mode: "unsupported",
    reason: "native_reply_not_supported"
  };
}

function replyWindowExpiresAt(input: {
  capabilities: SourceCapabilities;
  receivedAt: Date | null;
}): Date | null {
  if (!input.receivedAt || !input.capabilities.replyWindowSeconds) {
    return null;
  }

  return new Date(
    input.receivedAt.getTime() + input.capabilities.replyWindowSeconds * 1_000
  );
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid reply capability timestamp.");
  }

  return date;
}
