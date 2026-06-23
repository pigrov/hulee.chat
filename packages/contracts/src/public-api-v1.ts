import { z } from "zod";

import type { PlatformErrorCode } from "./index";

export const publicApiV1Version = "v1";

export const publicApiPlatformErrorCodeSchema = z.enum([
  "auth.invalid_credentials",
  "auth.email_not_verified",
  "entitlement.missing",
  "license.inactive",
  "permission.denied",
  "tenant.not_found",
  "tenant.boundary_violation",
  "module.disabled",
  "module.unhealthy",
  "usage.limit_exceeded",
  "provider.temporary_failure",
  "provider.permanent_failure",
  "validation.failed"
] satisfies [PlatformErrorCode, ...PlatformErrorCode[]]);

export const publicApiExternalIdSchema = z.string().trim().min(1).max(200);
export const publicApiIdempotencyKeySchema = z.string().trim().min(1).max(300);
export const publicApiTextSchema = z.string().trim().min(1).max(20_000);

export const publicApiMetadataSchema = z
  .record(z.string().trim().min(1).max(100), z.unknown())
  .optional();

export const publicApiClientContactSchema = z
  .object({
    type: z.enum(["phone", "email", "external_handle"]),
    value: z.string().trim().min(1).max(300)
  })
  .strict();

export const publicApiAttachmentSchema = z
  .object({
    fileName: z.string().trim().min(1).max(300).optional(),
    mediaType: z.string().trim().min(1).max(200),
    sizeBytes: z.number().int().nonnegative().optional(),
    sourceUrl: z.string().url().optional(),
    storageKey: z.string().trim().min(1).max(1_000).optional()
  })
  .strict()
  .refine(
    (attachment) =>
      attachment.sourceUrl !== undefined || attachment.storageKey !== undefined,
    {
      message: "Attachment must include sourceUrl or storageKey"
    }
  );

const messageBodySchema = z
  .object({
    text: publicApiTextSchema.optional(),
    attachments: z.array(publicApiAttachmentSchema).max(20).default([])
  })
  .strict()
  .refine((body) => body.text !== undefined || body.attachments.length > 0, {
    message: "Message must include text or attachments"
  });

export const publicApiRegisterClientRequestSchema = z
  .object({
    externalId: publicApiExternalIdSchema,
    displayName: z.string().trim().min(1).max(300),
    contacts: z.array(publicApiClientContactSchema).max(20).default([]),
    metadata: publicApiMetadataSchema
  })
  .strict();

export const publicApiRegisterClientResponseSchema = z
  .object({
    clientId: z.string().trim().min(1),
    externalId: publicApiExternalIdSchema,
    created: z.boolean()
  })
  .strict();

export const publicApiInboundMessageRequestSchema = messageBodySchema
  .extend({
    clientExternalId: publicApiExternalIdSchema,
    channelExternalId: publicApiExternalIdSchema,
    providerMessageId: publicApiExternalIdSchema,
    occurredAt: z.string().datetime({ offset: true }),
    idempotencyKey: publicApiIdempotencyKeySchema,
    metadata: publicApiMetadataSchema
  })
  .strict();

export const publicApiInboundMessageResponseSchema = z
  .object({
    clientId: z.string().trim().min(1),
    conversationId: z.string().trim().min(1),
    messageId: z.string().trim().min(1),
    accepted: z.literal(true)
  })
  .strict();

export const publicApiOutboundMessageRequestSchema = messageBodySchema
  .extend({
    conversationId: z.string().trim().min(1),
    channelExternalId: publicApiExternalIdSchema.optional(),
    idempotencyKey: publicApiIdempotencyKeySchema,
    metadata: publicApiMetadataSchema
  })
  .strict();

export const publicApiOutboundMessageResponseSchema = z
  .object({
    messageId: z.string().trim().min(1),
    status: z.enum(["queued", "accepted"]),
    idempotencyKey: publicApiIdempotencyKeySchema
  })
  .strict();

export const publicApiDeliveryStatusRequestSchema = z
  .object({
    messageId: z.string().trim().min(1)
  })
  .strict();

export const publicApiDeliveryStatusResponseSchema = z
  .object({
    messageId: z.string().trim().min(1),
    status: z.enum([
      "queued",
      "accepted",
      "sent",
      "delivered",
      "read",
      "failed"
    ]),
    providerMessageId: z.string().trim().min(1).optional(),
    errorCode: publicApiPlatformErrorCodeSchema.optional(),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict();

export const publicApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: publicApiPlatformErrorCodeSchema,
        messageKey: z.string().trim().min(1),
        retryability: z.enum(["retryable", "not_retryable", "unknown"]),
        requestId: z.string().trim().min(1)
      })
      .strict()
  })
  .strict();

export type PublicApiRegisterClientRequest = z.infer<
  typeof publicApiRegisterClientRequestSchema
>;
export type PublicApiRegisterClientResponse = z.infer<
  typeof publicApiRegisterClientResponseSchema
>;
export type PublicApiInboundMessageRequest = z.infer<
  typeof publicApiInboundMessageRequestSchema
>;
export type PublicApiInboundMessageResponse = z.infer<
  typeof publicApiInboundMessageResponseSchema
>;
export type PublicApiOutboundMessageRequest = z.infer<
  typeof publicApiOutboundMessageRequestSchema
>;
export type PublicApiOutboundMessageResponse = z.infer<
  typeof publicApiOutboundMessageResponseSchema
>;
export type PublicApiDeliveryStatusRequest = z.infer<
  typeof publicApiDeliveryStatusRequestSchema
>;
export type PublicApiDeliveryStatusResponse = z.infer<
  typeof publicApiDeliveryStatusResponseSchema
>;
export type PublicApiErrorResponse = z.infer<
  typeof publicApiErrorResponseSchema
>;
