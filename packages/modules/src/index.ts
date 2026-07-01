import type { ModuleManifest } from "@hulee/contracts";

import { localAuthManifest } from "./auth-local";
import { vkAuthManifest } from "./auth-vk";
import { publicApiChannelManifest } from "./public-api-channel";
import { telegramChannelManifest } from "./telegram-channel";

export const standardModuleManifests: readonly ModuleManifest[] = [
  localAuthManifest,
  vkAuthManifest,
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
export { createVkAuthProviderPlaceholder, vkAuthManifest } from "./auth-vk";
export type { VkAuthProvider } from "./auth-vk";
export {
  createDeploymentEgressRuntime,
  createPassthroughEgressRuntime,
  createStaticEgressRuntimeRegistry,
  deploymentPolicyDirectEgressRequirement,
  EgressRuntimeError,
  managedMessengerVpnEgressRequirement
} from "./egress";
export type {
  DeploymentEgressProfile,
  EgressOperationInput,
  EgressProfileResolution,
  EgressProfileResolveInput,
  EgressRuntime,
  EgressRuntimeRegistry
} from "./egress";
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
  buildTelegramProviderFailureOperatorHint,
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
  TelegramBotApiEgressBinding,
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
