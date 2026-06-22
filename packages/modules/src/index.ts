import type { ModuleManifest } from "@hulee/contracts";

import { publicApiChannelManifest } from "./public-api-channel";
import { telegramChannelManifest } from "./telegram-channel";

export const standardModuleManifests: readonly ModuleManifest[] = [
  {
    id: "auth-local",
    type: "auth",
    name: "Local auth",
    version: "0.0.0",
    capabilities: ["auth.email_password"],
    configSchema: {}
  },
  publicApiChannelManifest,
  telegramChannelManifest,
  {
    id: "storage-s3",
    type: "storage",
    name: "S3-compatible storage",
    version: "0.0.0",
    capabilities: ["storage.object"],
    configSchema: {},
    secretsSchema: {}
  },
  {
    id: "license-basic",
    type: "billing",
    name: "Basic license",
    version: "0.0.0",
    capabilities: ["license.snapshot", "entitlements.local"],
    configSchema: {}
  }
];

export {
  createPublicApiChannelAdapter,
  normalizePublicApiIncomingMessage,
  publicApiChannelInboundEnvelopeSchema,
  publicApiChannelManifest
} from "./public-api-channel";
export type { PublicApiChannelInboundEnvelope } from "./public-api-channel";
export {
  createTelegramBotApiClient,
  createTelegramChannelAdapter,
  deleteTelegramWebhook,
  getTelegramBotIdentity,
  getTelegramWebhookInfo,
  normalizeTelegramIncomingMessage,
  parseTelegramChannelConfig,
  sendTelegramTextMessage,
  setTelegramWebhook,
  telegramChannelConfigSchema,
  telegramChannelInboundEnvelopeSchema,
  telegramChannelManifest,
  TelegramAdapterError
} from "./telegram-channel";
export type {
  TelegramBotApiClient,
  TelegramBotIdentity,
  TelegramChannelConfig,
  TelegramChannelInboundEnvelope,
  TelegramBotApiSettings,
  TelegramDeleteWebhookInput,
  TelegramMessageSender,
  TelegramSetWebhookInput,
  TelegramSendMessageInput,
  TelegramSendMessageResult,
  TelegramWebhookInfo
} from "./telegram-channel";
