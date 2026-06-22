import type { ModuleManifest } from "@hulee/contracts";

import { localAuthManifest } from "./auth-local";
import { publicApiChannelManifest } from "./public-api-channel";
import { telegramChannelManifest } from "./telegram-channel";

export const standardModuleManifests: readonly ModuleManifest[] = [
  localAuthManifest,
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
  createLocalAuthProvider,
  hashLocalPassword,
  localAuthManifest,
  verifyLocalPassword
} from "./auth-local";
export type { LocalAuthProvider } from "./auth-local";
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
  getTelegramUpdates,
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
  TelegramGetUpdatesInput,
  TelegramMessageSender,
  TelegramSetWebhookInput,
  TelegramSendMessageInput,
  TelegramSendMessageResult,
  TelegramUpdate,
  TelegramWebhookInfo
} from "./telegram-channel";
