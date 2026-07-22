import { defineModuleManifest, defineModuleManifests } from "@hulee/contracts";

import { localAuthManifest } from "./auth-local";
import { vkAuthManifest } from "./auth-vk";
import { publicApiChannelManifest } from "./public-api-channel";
import { telegramChannelManifest } from "./telegram-channel";
import {
  basicLicenseDataGovernance,
  s3StorageDataGovernance
} from "./data-governance";

export const s3StorageManifest = defineModuleManifest({
  id: "storage-s3",
  type: "storage",
  name: "S3-compatible storage",
  version: "0.0.0",
  capabilities: ["storage.object"],
  configSchema: {},
  secretsSchema: {},
  dataHandling: "tenant_or_customer_data",
  dataGovernance: s3StorageDataGovernance
});

export const basicLicenseManifest = defineModuleManifest({
  id: "license-basic",
  type: "billing",
  name: "Basic license",
  version: "0.0.0",
  capabilities: ["license.snapshot", "entitlements.local"],
  configSchema: {},
  dataHandling: "tenant_or_customer_data",
  dataGovernance: basicLicenseDataGovernance
});

export const standardModuleManifests = defineModuleManifests([
  localAuthManifest,
  vkAuthManifest,
  publicApiChannelManifest,
  telegramChannelManifest,
  s3StorageManifest,
  basicLicenseManifest
]);

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
  createSourceAdapterRegistry,
  isSourceAdapterRegistry,
  SourceAdapterRegistryError
} from "./source-adapter-registry";
export type {
  SourceAdapterEphemeralCredentialInput,
  SourceAdapterAccountAuthority,
  SourceAdapterConnectionAuthority,
  SourceAdapterIngressDispatchInput,
  SourceAdapterIngressDispatchResult,
  SourceAdapterIngressHandler,
  SourceAdapterOnboardingAuthority,
  SourceAdapterOnboardingHandler,
  SourceAdapterOnboardingPrepareInput,
  SourceAdapterOnboardingPrepared,
  SourceAdapterOneTimeResponse,
  SourceAdapterRegistration,
  SourceAdapterRegistry,
  SourceAdapterTransientArtifactWrite,
  SourceAdapterTransientRouteWrite,
  SourceAdapterTransientSecretWrite
} from "./source-adapter-registry";
export { publicApiChannelManifest } from "./public-api-channel";
export {
  createTelegramBotApiClient,
  deleteTelegramWebhook,
  buildTelegramProviderFailureOperatorHint,
  getTelegramBotIdentity,
  getTelegramUpdates,
  getTelegramWebhookInfo,
  parseTelegramChannelConfig,
  sendTelegramTextMessage,
  setTelegramWebhook,
  telegramChannelConfigSchema,
  telegramChannelManifest,
  TelegramAdapterError
} from "./telegram-channel";
export type {
  TelegramBotApiClient,
  TelegramBotApiEgressBinding,
  TelegramBotIdentity,
  TelegramChannelConfig,
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
