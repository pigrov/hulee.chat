import type {
  AdapterHealth,
  ChannelAdapter,
  DeliveryResult,
  ModuleManifest,
  NormalizedIncomingMessage,
  NormalizedOutgoingMessage,
  TenantId
} from "@hulee/contracts";
import { publicApiInboundMessageRequestSchema } from "@hulee/contracts";
import { z } from "zod";

export const publicApiChannelManifest = {
  id: "channel-public-api",
  type: "channel",
  name: "Public API channel",
  version: "0.0.0",
  capabilities: ["channel.inbound", "channel.outbound"],
  configSchema: {},
  healthChecks: ["public_api_channel.health"]
} satisfies ModuleManifest;

export const publicApiChannelInboundEnvelopeSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    body: publicApiInboundMessageRequestSchema
  })
  .strict();

export type PublicApiChannelInboundEnvelope = z.infer<
  typeof publicApiChannelInboundEnvelopeSchema
>;

export function normalizePublicApiIncomingMessage(
  input: unknown
): NormalizedIncomingMessage {
  const envelope = publicApiChannelInboundEnvelopeSchema.parse(input);
  const body = envelope.body;

  return {
    tenantId: envelope.tenantId as TenantId,
    providerMessageId: body.providerMessageId,
    channelExternalId: body.channelExternalId,
    clientExternalId: body.clientExternalId,
    text: body.text,
    attachments: body.attachments.map((attachment) => ({
      fileName: attachment.fileName,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
      storageKey: attachment.storageKey,
      sourceUrl: attachment.sourceUrl
    })),
    occurredAt: body.occurredAt,
    idempotencyKey: body.idempotencyKey
  };
}

export function createPublicApiChannelAdapter(): ChannelAdapter {
  return {
    manifest: publicApiChannelManifest,
    async normalizeIncoming(input) {
      return normalizePublicApiIncomingMessage(input);
    },
    async sendMessage(
      message: NormalizedOutgoingMessage
    ): Promise<DeliveryResult> {
      return {
        providerMessageId: message.messageId,
        status: "accepted"
      };
    },
    async health(): Promise<AdapterHealth> {
      return {
        status: "healthy",
        checkedAt: new Date(0).toISOString()
      };
    }
  };
}
