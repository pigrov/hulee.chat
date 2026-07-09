import type {
  ChannelConnectorId,
  ChannelProviderOperation,
  EmployeeId,
  EventId,
  InternalChannelAuthChallengeResponse,
  InternalChannelAuthChallengeStartRequest,
  InternalChannelAuthChallengeStatus,
  InternalChannelAuthChallengeSubmitRequest,
  InternalChannelAuthChallengeType,
  InternalChannelCatalogResponse,
  InternalChannelConnectorCreateRequest,
  InternalChannelConnectorHealthStatus,
  InternalChannelConnectorSummary,
  InternalChannelConnectorStatus,
  InternalChannelConnectorUpdateRequest,
  InternalChannelConnectorsResponse,
  InternalChannelClass,
  InternalChannelOnboardingFlow,
  InternalChannelType,
  InternalEgressDiagnostics,
  InternalTelegramBotTokenValidateRequest,
  InternalTelegramBotTokenValidateResponse,
  InternalTelegramIntegrationConfig,
  InternalTelegramIntegrationDiagnostics,
  InternalTelegramIntegrationResponse,
  InternalTelegramIntegrationUpdateRequest,
  InternalTelegramSetupStep,
  PlatformErrorCode,
  PlatformEvent,
  SourceConnectionId,
  TenantId
} from "@hulee/contracts";
import {
  internalEgressDiagnosticsSchema,
  internalTelegramBotTokenValidateResponseSchema,
  internalTelegramIntegrationDiagnosticsSchema,
  isPlatformErrorCode
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  ChannelAuthChallengeRecord,
  ChannelAuthChallengeRepository,
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  ChannelSessionRecord,
  ChannelSessionRepository,
  ChannelProviderValidationJobRepository,
  DeploymentChannelCatalogOverrideRecord,
  DeploymentChannelCatalogOverrideRepository,
  DomainEventRepository,
  SourceIntegrationRepository,
  TenantSecretCipher,
  TenantSecretRepository
} from "@hulee/db";
import {
  createChannelConnectorSecretRef,
  createTenantSecretRef
} from "@hulee/db";
import {
  buildTelegramProviderFailureOperatorHint,
  createPassthroughEgressRuntime,
  createTelegramBotApiClient,
  parseTelegramChannelConfig,
  telegramChannelManifest,
  TelegramAdapterError,
  managedMessengerVpnEgressRequirement,
  deploymentPolicyDirectEgressRequirement,
  type EgressProfileResolution,
  type EgressRuntime,
  type TelegramBotApiEgressBinding,
  type TelegramBotApiClient,
  type TelegramBotApiSettings,
  type TelegramBotIdentity
} from "@hulee/modules";
import { randomBytes, randomUUID } from "node:crypto";

export type InternalIntegrationContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type InternalIntegrationService = {
  listChannelCatalog(
    context: InternalIntegrationContext
  ): Promise<InternalChannelCatalogResponse>;
  listChannelConnectors(
    context: InternalIntegrationContext
  ): Promise<InternalChannelConnectorsResponse>;
  createChannelConnector(
    context: InternalIntegrationContext,
    request: InternalChannelConnectorCreateRequest
  ): Promise<InternalChannelConnectorSummary>;
  updateChannelConnector(
    context: InternalIntegrationContext,
    input: {
      connectorId: string;
      request: InternalChannelConnectorUpdateRequest;
    }
  ): Promise<InternalChannelConnectorSummary>;
  enableChannelConnector(
    context: InternalIntegrationContext,
    input: { connectorId: string }
  ): Promise<InternalChannelConnectorSummary>;
  disableChannelConnector(
    context: InternalIntegrationContext,
    input: { connectorId: string }
  ): Promise<InternalChannelConnectorSummary>;
  deleteChannelConnector(
    context: InternalIntegrationContext,
    input: { connectorId: string }
  ): Promise<InternalChannelConnectorSummary>;
  startChannelAuthChallenge(
    context: InternalIntegrationContext,
    input: {
      connectorId: string;
      request: InternalChannelAuthChallengeStartRequest;
    }
  ): Promise<InternalChannelAuthChallengeResponse>;
  loadChannelAuthChallenge(
    context: InternalIntegrationContext,
    input: { connectorId: string; challengeId: string }
  ): Promise<InternalChannelAuthChallengeResponse>;
  submitChannelAuthChallenge(
    context: InternalIntegrationContext,
    input: {
      connectorId: string;
      challengeId: string;
      request: InternalChannelAuthChallengeSubmitRequest;
    }
  ): Promise<InternalChannelAuthChallengeResponse>;
  cancelChannelAuthChallenge(
    context: InternalIntegrationContext,
    input: { connectorId: string; challengeId: string }
  ): Promise<InternalChannelAuthChallengeResponse>;
  loadTelegramIntegration(
    context: InternalIntegrationContext,
    input?: { connectorId?: string }
  ): Promise<InternalTelegramIntegrationResponse>;
  validateTelegramBotToken(
    context: InternalIntegrationContext,
    request: InternalTelegramBotTokenValidateRequest
  ): Promise<InternalTelegramBotTokenValidateResponse>;
  updateTelegramIntegration(
    context: InternalIntegrationContext,
    request: InternalTelegramIntegrationUpdateRequest
  ): Promise<InternalTelegramIntegrationResponse>;
  refreshTelegramDiagnostics(
    context: InternalIntegrationContext,
    input: { connectorId: string }
  ): Promise<InternalTelegramIntegrationResponse>;
  setTelegramWebhook(
    context: InternalIntegrationContext,
    input: { connectorId: string }
  ): Promise<InternalTelegramIntegrationResponse>;
  deleteTelegramWebhook(
    context: InternalIntegrationContext,
    input: { connectorId: string }
  ): Promise<InternalTelegramIntegrationResponse>;
};

export type SecretResolver = {
  resolveSecret(input: {
    tenantId: TenantId;
    secretRef: string;
  }): Promise<string | null>;
};

export type SecretWriter = {
  upsertSecret(input: {
    tenantId: TenantId;
    secretRef: string;
    purpose:
      | "telegram.bot_token"
      | "telegram.bot_token_validation"
      | "telegram.webhook_secret_token";
    plainText: string;
    updatedAt: Date;
  }): Promise<void>;
};

export type TelegramBotApiClientFactory = (
  settings: TelegramBotApiSettings
) => TelegramBotApiClient;

export type InternalIntegrationServiceOptions = {
  connectorRepository: ChannelConnectorRepository;
  channelSessionRepository?: ChannelSessionRepository;
  channelCatalogOverrideRepository?: DeploymentChannelCatalogOverrideRepository;
  authChallengeRepository?: ChannelAuthChallengeRepository;
  providerValidationJobRepository?: ChannelProviderValidationJobRepository;
  providerOperationEvents?: DomainEventRepository;
  sourceRepository?: SourceIntegrationRepository;
  authChallengeCipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  secretResolver?: SecretResolver;
  secretWriter?: SecretWriter;
  botApiClientFactory?: TelegramBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  webhookConnectorIdFactory?: (input: {
    tenantId: TenantId;
    channelExternalId: string;
  }) => string;
  webhookSecretTokenFactory?: () => string;
  providerValidationTimeoutMs?: number;
  providerValidationPollIntervalMs?: number;
  now?: () => Date;
};

const telegramModuleId = "channel-telegram" as const;
const telegramChannelType = "telegram_bot" as const;
const telegramQrBridgeChannelType = "telegram_qr_bridge" as const;
const whatsappQrBridgeChannelType = "whatsapp_qr_bridge" as const;
const maxQrBridgeChannelType = "max_qr_bridge" as const;
const telegramChannelClass = "bot_bridge" as const;
const userBridgeChannelClass = "user_bridge" as const;
const telegramProvider = "telegram";
const whatsappProvider = "whatsapp";
const maxProvider = "max";
const defaultTelegramDisplayName = "Telegram Bot";
const defaultTelegramQrDisplayName = "Telegram account";
const defaultWhatsappQrDisplayName = "WhatsApp account";
const defaultMaxQrDisplayName = "MAX account";
const userBridgePrimarySessionKey = "primary";
const telegramBotTokenValidationKind = "telegram_bot_token" as const;
const defaultProviderValidationTimeoutMs = 15_000;
const defaultProviderValidationPollIntervalMs = 250;
const channelOnboardingFlows = {
  telegram_bot: {
    version: "v1",
    steps: [
      {
        id: "name",
        kind: "display_name",
        titleKey: "integrations.channel.onboarding.name",
        action: "update_connector"
      },
      {
        id: "token",
        kind: "secret_text",
        titleKey: "integrations.channel.onboarding.token",
        action: "update_connector"
      },
      {
        id: "mode",
        kind: "activation",
        titleKey: "integrations.channel.onboarding.activation",
        action: "update_connector"
      },
      {
        id: "diagnostics",
        kind: "diagnostics",
        titleKey: "integrations.channel.onboarding.diagnostics",
        action: "refresh_diagnostics"
      },
      {
        id: "webhook",
        kind: "webhook_sync",
        titleKey: "integrations.channel.onboarding.webhook",
        action: "sync_webhook",
        required: false
      },
      {
        id: "complete",
        kind: "complete",
        titleKey: "integrations.channel.onboarding.complete"
      }
    ]
  },
  telegram_qr_bridge: {
    version: "v1",
    steps: [
      {
        id: "name",
        kind: "display_name",
        titleKey: "integrations.channel.onboarding.name",
        action: "update_connector"
      },
      {
        id: "qr",
        kind: "qr_code",
        titleKey: "integrations.channel.onboarding.qr",
        action: "start_auth_challenge"
      },
      {
        id: "password",
        kind: "password",
        titleKey: "integrations.channel.onboarding.password",
        action: "submit_auth_password",
        required: false
      },
      {
        id: "waiting",
        kind: "waiting",
        titleKey: "integrations.channel.onboarding.waiting",
        action: "poll_auth_challenge"
      },
      {
        id: "complete",
        kind: "complete",
        titleKey: "integrations.channel.onboarding.complete"
      }
    ]
  },
  whatsapp_qr_bridge: {
    version: "v1",
    steps: [
      {
        id: "name",
        kind: "display_name",
        titleKey: "integrations.channel.onboarding.name",
        action: "update_connector"
      },
      {
        id: "qr",
        kind: "qr_code",
        titleKey: "integrations.channel.onboarding.qr",
        action: "start_auth_challenge"
      },
      {
        id: "waiting",
        kind: "waiting",
        titleKey: "integrations.channel.onboarding.waiting",
        action: "poll_auth_challenge"
      },
      {
        id: "complete",
        kind: "complete",
        titleKey: "integrations.channel.onboarding.complete"
      }
    ]
  },
  max_bot: {
    version: "v1",
    steps: [
      {
        id: "name",
        kind: "display_name",
        titleKey: "integrations.channel.onboarding.name",
        action: "update_connector"
      },
      {
        id: "token",
        kind: "secret_text",
        titleKey: "integrations.channel.onboarding.token",
        action: "update_connector"
      },
      {
        id: "diagnostics",
        kind: "diagnostics",
        titleKey: "integrations.channel.onboarding.diagnostics",
        action: "refresh_diagnostics"
      },
      {
        id: "complete",
        kind: "complete",
        titleKey: "integrations.channel.onboarding.complete"
      }
    ]
  },
  max_qr_bridge: {
    version: "v1",
    steps: [
      {
        id: "name",
        kind: "display_name",
        titleKey: "integrations.channel.onboarding.name",
        action: "update_connector"
      },
      {
        id: "phone",
        kind: "phone_number",
        titleKey: "integrations.channel.onboarding.phone",
        action: "start_auth_challenge"
      },
      {
        id: "code",
        kind: "verification_code",
        titleKey: "integrations.channel.onboarding.code",
        action: "submit_auth_code"
      },
      {
        id: "password",
        kind: "password",
        titleKey: "integrations.channel.onboarding.password",
        action: "submit_auth_password",
        required: false
      },
      {
        id: "waiting",
        kind: "waiting",
        titleKey: "integrations.channel.onboarding.waiting",
        action: "poll_auth_challenge"
      },
      {
        id: "complete",
        kind: "complete",
        titleKey: "integrations.channel.onboarding.complete"
      }
    ]
  },
  vk_community: {
    version: "v1",
    steps: [
      {
        id: "name",
        kind: "display_name",
        titleKey: "integrations.channel.onboarding.name",
        action: "update_connector"
      },
      {
        id: "token",
        kind: "secret_text",
        titleKey: "integrations.channel.onboarding.token",
        action: "update_connector"
      },
      {
        id: "diagnostics",
        kind: "diagnostics",
        titleKey: "integrations.channel.onboarding.diagnostics",
        action: "refresh_diagnostics"
      },
      {
        id: "complete",
        kind: "complete",
        titleKey: "integrations.channel.onboarding.complete"
      }
    ]
  }
} satisfies Record<InternalChannelType, InternalChannelOnboardingFlow>;

type UserBridgeChannelType =
  | typeof telegramQrBridgeChannelType
  | typeof whatsappQrBridgeChannelType
  | typeof maxQrBridgeChannelType;

const userBridgeChannelSpecs = {
  telegram_qr_bridge: {
    channelType: telegramQrBridgeChannelType,
    provider: telegramProvider,
    defaultDisplayName: defaultTelegramQrDisplayName,
    authMode: "qr",
    initialStep: "qr",
    egressRequirement: managedMessengerVpnEgressRequirement,
    allowedStartChallengeTypes: ["qr", "phone_code", "reauth"],
    initialChallengeStatuses: {
      phone_code: "pending"
    },
    capabilities: {
      inbound: true,
      outbound: true,
      qrAuth: true,
      phoneCodeAuth: true,
      sessionRuntime: true,
      attachmentsMetadata: true
    }
  },
  whatsapp_qr_bridge: {
    channelType: whatsappQrBridgeChannelType,
    provider: whatsappProvider,
    defaultDisplayName: defaultWhatsappQrDisplayName,
    authMode: "qr",
    initialStep: "qr",
    egressRequirement: managedMessengerVpnEgressRequirement,
    allowedStartChallengeTypes: ["qr", "phone_code", "reauth"],
    initialChallengeStatuses: {
      phone_code: "pending"
    },
    capabilities: {
      inbound: true,
      outbound: true,
      qrAuth: true,
      pairingCodeAuth: true,
      sessionRuntime: true,
      attachmentsMetadata: true
    }
  },
  max_qr_bridge: {
    channelType: maxQrBridgeChannelType,
    provider: maxProvider,
    defaultDisplayName: defaultMaxQrDisplayName,
    authMode: "phone_code",
    initialStep: "phone",
    egressRequirement: deploymentPolicyDirectEgressRequirement,
    allowedStartChallengeTypes: ["phone_code", "reauth"],
    initialChallengeStatuses: {
      phone_code: "requires_code"
    },
    capabilities: {
      inbound: true,
      outbound: true,
      phoneCodeAuth: true,
      passwordAuth: true,
      sessionRuntime: true,
      attachmentsMetadata: true
    }
  }
} satisfies Record<
  UserBridgeChannelType,
  {
    channelType: UserBridgeChannelType;
    provider: string;
    defaultDisplayName: string;
    authMode: "qr" | "phone_code";
    initialStep: string;
    egressRequirement: InternalChannelCatalogResponse["channels"][number]["egressRequirement"];
    allowedStartChallengeTypes: readonly InternalChannelAuthChallengeType[];
    initialChallengeStatuses?: Partial<
      Record<
        InternalChannelAuthChallengeType,
        InternalChannelAuthChallengeStatus
      >
    >;
    capabilities: Record<string, boolean>;
  }
>;

const channelCatalogV1 = [
  {
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    provider: "telegram",
    titleKey: "integrations.catalog.telegramBot.title",
    shortDescriptionKey: "integrations.catalog.telegramBot.description",
    descriptionKey: "integrations.catalog.telegramBot.description",
    readiness: "available",
    visibility: "visible",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound", "webhook", "polling"],
    egressRequirement: managedMessengerVpnEgressRequirement,
    onboarding: channelOnboardingFlows.telegram_bot
  },
  {
    channelType: userBridgeChannelSpecs.telegram_qr_bridge.channelType,
    channelClass: "user_bridge",
    provider: userBridgeChannelSpecs.telegram_qr_bridge.provider,
    titleKey: "integrations.catalog.telegramQr.title",
    shortDescriptionKey: "integrations.catalog.telegramQr.description",
    descriptionKey: "integrations.catalog.telegramQr.description",
    readiness: "available",
    visibility: "visible",
    supportsMultiple: true,
    capabilities: [
      "inbound",
      "outbound",
      "qr_auth",
      "phone_code_auth",
      "session_runtime"
    ],
    egressRequirement:
      userBridgeChannelSpecs.telegram_qr_bridge.egressRequirement,
    onboarding: channelOnboardingFlows.telegram_qr_bridge
  },
  {
    channelType: userBridgeChannelSpecs.whatsapp_qr_bridge.channelType,
    channelClass: "user_bridge",
    provider: userBridgeChannelSpecs.whatsapp_qr_bridge.provider,
    titleKey: "integrations.catalog.whatsappQr.title",
    shortDescriptionKey: "integrations.catalog.whatsappQr.description",
    descriptionKey: "integrations.catalog.whatsappQr.description",
    readiness: "available",
    visibility: "visible",
    supportsMultiple: true,
    capabilities: [
      "inbound",
      "outbound",
      "qr_auth",
      "pairing_code_auth",
      "session_runtime"
    ],
    egressRequirement:
      userBridgeChannelSpecs.whatsapp_qr_bridge.egressRequirement,
    onboarding: channelOnboardingFlows.whatsapp_qr_bridge
  },
  {
    channelType: "max_bot",
    channelClass: "bot_bridge",
    provider: "max",
    titleKey: "integrations.catalog.maxBot.title",
    shortDescriptionKey: "integrations.catalog.maxBot.description",
    descriptionKey: "integrations.catalog.maxBot.description",
    readiness: "coming_soon",
    visibility: "visible",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound"],
    egressRequirement: deploymentPolicyDirectEgressRequirement,
    onboarding: channelOnboardingFlows.max_bot
  },
  {
    channelType: userBridgeChannelSpecs.max_qr_bridge.channelType,
    channelClass: "user_bridge",
    provider: userBridgeChannelSpecs.max_qr_bridge.provider,
    titleKey: "integrations.catalog.maxQr.title",
    shortDescriptionKey: "integrations.catalog.maxQr.description",
    descriptionKey: "integrations.catalog.maxQr.description",
    readiness: "available",
    visibility: "visible",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound", "code_auth", "session_runtime"],
    egressRequirement: userBridgeChannelSpecs.max_qr_bridge.egressRequirement,
    onboarding: channelOnboardingFlows.max_qr_bridge
  },
  {
    channelType: "vk_community",
    channelClass: "official_api",
    provider: "vk",
    titleKey: "integrations.catalog.vkCommunity.title",
    shortDescriptionKey: "integrations.catalog.vkCommunity.description",
    descriptionKey: "integrations.catalog.vkCommunity.description",
    readiness: "coming_soon",
    visibility: "visible",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound", "official_api"],
    egressRequirement: deploymentPolicyDirectEgressRequirement,
    onboarding: channelOnboardingFlows.vk_community
  }
] satisfies InternalChannelCatalogResponse["channels"];

export function applyChannelCatalogOverrides(
  catalog: readonly InternalChannelCatalogResponse["channels"][number][],
  overrides: readonly DeploymentChannelCatalogOverrideRecord[]
): InternalChannelCatalogResponse["channels"] {
  const overridesByChannelType = new Map(
    overrides.map((override) => [override.channelType, override])
  );

  return catalog
    .flatMap((channel, index) => {
      const override = overridesByChannelType.get(channel.channelType);

      if (override?.visibility === "hidden") {
        return [];
      }

      const iconAssetRef = override?.iconAssetRef;

      return [
        {
          ...channel,
          titleOverrides: override?.titleOverrides ?? {},
          shortDescriptionOverrides: override?.shortDescriptionOverrides ?? {},
          descriptionOverrides: override?.descriptionOverrides ?? {},
          ...(iconAssetRef
            ? {
                iconAssetRef,
                iconUrl: channelIconUrl({
                  channelType: channel.channelType,
                  iconAssetRef
                })
              }
            : {}),
          sortOrder: override?.sortOrder ?? index * 100,
          visibility: override?.visibility ?? "visible",
          readiness: override?.readiness ?? channel.readiness
        }
      ];
    })
    .sort((left, right) => {
      const leftOrder = left.sortOrder ?? 100_000;
      const rightOrder = right.sortOrder ?? 100_000;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.channelType.localeCompare(right.channelType);
    });
}

function channelIconUrl(input: {
  channelType: InternalChannelType;
  iconAssetRef: string;
}): string {
  const segments = input.iconAssetRef.split("/");
  const assetVersion = segments[segments.length - 1] ?? input.iconAssetRef;

  return `/channel-assets/${encodeURIComponent(input.channelType)}/icon?v=${encodeURIComponent(
    assetVersion
  )}`;
}

if (telegramChannelManifest.id !== telegramModuleId) {
  throw new CoreError("validation.failed");
}

export function createInternalIntegrationService(
  options: InternalIntegrationServiceOptions
): InternalIntegrationService {
  const now = options.now ?? (() => new Date());
  const secretResolver =
    options.secretResolver ?? createEnvSecretResolver(process.env);
  const botApiClientFactory =
    options.botApiClientFactory ?? createTelegramBotApiClient;
  const egressRuntime =
    options.egressRuntime ?? createPassthroughEgressRuntime();
  const webhookConnectorIdFactory =
    options.webhookConnectorIdFactory ?? createTelegramWebhookConnectorId;
  const webhookSecretTokenFactory =
    options.webhookSecretTokenFactory ?? createTelegramWebhookSecretToken;

  return {
    async listChannelCatalog() {
      const overrides = options.channelCatalogOverrideRepository
        ? await options.channelCatalogOverrideRepository.listOverrides()
        : [];

      return {
        channels: applyChannelCatalogOverrides(channelCatalogV1, overrides)
      };
    },

    async listChannelConnectors(context) {
      const records = await options.connectorRepository.listTenantConnectors({
        tenantId: context.tenantId
      });
      const authChallengeRepository = options.authChallengeRepository;
      const checkedAt = now();
      const summaries = await Promise.all(
        records.flatMap((record) => {
          const summary = channelConnectorSummaryFromRecord(record);

          return summary
            ? [
                withChannelConnectorListDetails({
                  authChallengeRepository,
                  checkedAt,
                  record,
                  sessionRepository: options.channelSessionRepository,
                  summary
                })
              ]
            : [];
        })
      );

      return {
        connectors: summaries
      };
    },

    async createChannelConnector(context, request) {
      if (request.channelType === telegramChannelType) {
        return createTelegramBotConnector({
          context,
          request,
          repository: options.connectorRepository,
          sourceRepository: options.sourceRepository,
          updatedAt: now(),
          webhookConnectorIdFactory
        });
      }

      const userBridgeSpec = getUserBridgeChannelSpec(request.channelType);

      if (userBridgeSpec) {
        return createUserBridgeConnector({
          context,
          request,
          repository: options.connectorRepository,
          sessionRepository: requireChannelSessionRepository(
            options.channelSessionRepository
          ),
          sourceRepository: options.sourceRepository,
          spec: userBridgeSpec,
          updatedAt: now()
        });
      }

      throw new CoreError("validation.failed");
    },

    async updateChannelConnector(context, input) {
      const record = await loadChannelConnector({
        repository: options.connectorRepository,
        tenantId: context.tenantId,
        connectorId: input.connectorId
      });
      const displayName = input.request.displayName?.trim();

      if (!displayName) {
        throw new CoreError("validation.failed");
      }

      const updatedRecord = {
        ...record,
        displayName,
        updatedAt: now()
      };

      await options.connectorRepository.upsertConnector({
        id: updatedRecord.id,
        tenantId: updatedRecord.tenantId,
        channelType: updatedRecord.channelType,
        channelClass: updatedRecord.channelClass,
        provider: updatedRecord.provider,
        displayName: updatedRecord.displayName,
        status: updatedRecord.status,
        healthStatus: updatedRecord.healthStatus,
        capabilities: updatedRecord.capabilities,
        onboardingState: updatedRecord.onboardingState,
        config: updatedRecord.config,
        diagnostics: updatedRecord.diagnostics,
        sourceConnectionId: updatedRecord.sourceConnectionId,
        createdByEmployeeId: updatedRecord.createdByEmployeeId,
        updatedAt: updatedRecord.updatedAt
      });
      await upsertSourceConnectionForChannelConnector({
        context,
        record: updatedRecord,
        sourceRepository: options.sourceRepository
      });

      const summary = channelConnectorSummaryFromRecord(updatedRecord);

      if (!summary) {
        throw new CoreError("validation.failed");
      }

      return summary;
    },

    async enableChannelConnector(context, input) {
      return updateChannelConnectorLifecycle({
        context,
        repository: options.connectorRepository,
        sourceRepository: options.sourceRepository,
        connectorId: input.connectorId,
        action: "enable",
        updatedAt: now()
      });
    },

    async disableChannelConnector(context, input) {
      return updateChannelConnectorLifecycle({
        context,
        repository: options.connectorRepository,
        sourceRepository: options.sourceRepository,
        connectorId: input.connectorId,
        action: "disable",
        updatedAt: now()
      });
    },

    async deleteChannelConnector(context, input) {
      return updateChannelConnectorLifecycle({
        context,
        repository: options.connectorRepository,
        sourceRepository: options.sourceRepository,
        connectorId: input.connectorId,
        action: "delete",
        updatedAt: now()
      });
    },

    async startChannelAuthChallenge(context, input) {
      const authChallengeRepository = requireAuthChallengeRepository(
        options.authChallengeRepository
      );
      const updatedAt = now();
      const connector = await loadUserBridgeConnector({
        repository: options.connectorRepository,
        tenantId: context.tenantId,
        connectorId: input.connectorId
      });

      assertUserBridgeStartChallengeAllowed({
        connector,
        challengeType: input.request.challengeType
      });
      const spec = getUserBridgeChannelSpec(connector.channelType);

      const existingChallenge =
        await authChallengeRepository.findLatestActiveChallenge({
          tenantId: context.tenantId,
          connectorId: connector.id,
          challengeType: input.request.challengeType
        });

      if (
        existingChallenge &&
        !isChannelAuthChallengeExpired(existingChallenge, updatedAt)
      ) {
        return channelAuthChallengeResponseFromRecord(existingChallenge);
      }

      if (
        existingChallenge &&
        isChannelAuthChallengeExpired(existingChallenge, updatedAt)
      ) {
        await authChallengeRepository.upsertChallenge({
          ...authChallengePersistenceInputFromRecord(existingChallenge),
          status: "expired",
          updatedAt,
          completedAt: updatedAt
        });
      }

      const expiresAt = new Date(updatedAt.getTime() + 10 * 60 * 1000);
      const status = initialChannelAuthChallengeStatus({
        challengeType: input.request.challengeType,
        spec
      });
      const publicPayload = channelAuthChallengePublicPayload({
        challengeType: input.request.challengeType,
        phoneNumber: input.request.phoneNumber,
        expiresAt
      });
      const challengeId = createRandomChannelAuthChallengeId();

      await authChallengeRepository.upsertChallenge({
        id: challengeId,
        tenantId: context.tenantId,
        connectorId: connector.id,
        challengeType: input.request.challengeType,
        status,
        publicPayload,
        expiresAt,
        createdByEmployeeId: context.employeeId,
        updatedAt
      });

      const challenge = await authChallengeRepository.findChallenge({
        tenantId: context.tenantId,
        challengeId
      });

      if (!challenge) {
        throw new CoreError("validation.failed");
      }

      return channelAuthChallengeResponseFromRecord(challenge);
    },

    async loadChannelAuthChallenge(context, input) {
      const authChallengeRepository = requireAuthChallengeRepository(
        options.authChallengeRepository
      );
      const challenge = await loadConnectorAuthChallenge({
        repository: authChallengeRepository,
        tenantId: context.tenantId,
        connectorId: input.connectorId,
        challengeId: input.challengeId
      });
      const updatedAt = now();

      if (isChannelAuthChallengeExpired(challenge, updatedAt)) {
        await authChallengeRepository.upsertChallenge({
          ...authChallengePersistenceInputFromRecord(challenge),
          status: "expired",
          completedAt: updatedAt,
          updatedAt
        });

        const expiredChallenge = await authChallengeRepository.findChallenge({
          tenantId: context.tenantId,
          challengeId: challenge.id
        });

        if (expiredChallenge) {
          return channelAuthChallengeResponseFromRecord(expiredChallenge);
        }
      }

      return channelAuthChallengeResponseFromRecord(challenge);
    },

    async submitChannelAuthChallenge(context, input) {
      const authChallengeRepository = requireAuthChallengeRepository(
        options.authChallengeRepository
      );
      const challenge = await loadConnectorAuthChallenge({
        repository: authChallengeRepository,
        tenantId: context.tenantId,
        connectorId: input.connectorId,
        challengeId: input.challengeId
      });
      const updatedAt = now();

      if (isChannelAuthChallengeTerminal(challenge.status)) {
        return channelAuthChallengeResponseFromRecord(challenge);
      }

      const nextStatus = submittedChannelAuthChallengeStatus({
        challengeType: challenge.challengeType,
        currentStatus: challenge.status,
        hasCode: Boolean(input.request.code),
        hasPassword: Boolean(input.request.password)
      });

      await authChallengeRepository.upsertChallenge({
        ...authChallengePersistenceInputFromRecord(challenge),
        status: nextStatus,
        secretPayloadEncrypted: submittedChannelAuthChallengeSecretPayload({
          existingSecretPayloadEncrypted: challenge.secretPayloadEncrypted,
          request: input.request,
          cipher: options.authChallengeCipher,
          submittedAt: updatedAt
        }),
        updatedAt
      });

      const updatedChallenge = await authChallengeRepository.findChallenge({
        tenantId: context.tenantId,
        challengeId: challenge.id
      });

      if (!updatedChallenge) {
        throw new CoreError("validation.failed");
      }

      return channelAuthChallengeResponseFromRecord(updatedChallenge);
    },

    async cancelChannelAuthChallenge(context, input) {
      const authChallengeRepository = requireAuthChallengeRepository(
        options.authChallengeRepository
      );
      const challenge = await loadConnectorAuthChallenge({
        repository: authChallengeRepository,
        tenantId: context.tenantId,
        connectorId: input.connectorId,
        challengeId: input.challengeId
      });
      const updatedAt = now();

      await authChallengeRepository.upsertChallenge({
        ...authChallengePersistenceInputFromRecord(challenge),
        status: "cancelled",
        completedAt: updatedAt,
        updatedAt
      });

      const cancelledChallenge = await authChallengeRepository.findChallenge({
        tenantId: context.tenantId,
        challengeId: challenge.id
      });

      if (!cancelledChallenge) {
        throw new CoreError("validation.failed");
      }

      return channelAuthChallengeResponseFromRecord(cancelledChallenge);
    },

    async loadTelegramIntegration(context, input) {
      const record = await loadExistingTelegramConnector({
        repository: options.connectorRepository,
        tenantId: context.tenantId,
        connectorId: input?.connectorId
      });

      return telegramResponseFromRecord({
        record,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        checkedAt: now().toISOString()
      });
    },

    async validateTelegramBotToken(context, request) {
      if (
        options.providerOperationEvents &&
        options.providerValidationJobRepository &&
        options.secretWriter
      ) {
        return validateTelegramBotTokenViaProviderWorker({
          context,
          request,
          validationJobRepository: options.providerValidationJobRepository,
          events: options.providerOperationEvents,
          secretWriter: options.secretWriter,
          timeoutMs:
            options.providerValidationTimeoutMs ??
            defaultProviderValidationTimeoutMs,
          pollIntervalMs:
            options.providerValidationPollIntervalMs ??
            defaultProviderValidationPollIntervalMs,
          now
        });
      }

      const checkedAt = now().toISOString();
      const connectorId = createTelegramTokenValidationConnectorId(context);
      const egressResolution = await resolveTelegramEgressProfile({
        egressRuntime,
        tenantId: context.tenantId,
        connectorId,
        checkedAt
      });
      const client = botApiClientFactory({
        apiBaseUrl: options.telegramApiBaseUrl,
        botToken: request.botToken.trim(),
        egress: buildTelegramBotApiEgressBinding({
          egressRuntime,
          resolution: egressResolution,
          tenantId: context.tenantId,
          connectorId
        })
      });
      const bot = await client.getMe();

      return {
        bot: telegramBotTokenValidationIdentity(bot)
      };
    },

    async updateTelegramIntegration(context, request) {
      const updatedAt = now();
      const connectorId = requireTelegramConnectorId(request);
      const existingRecord = await loadExistingTelegramConnector({
        repository: options.connectorRepository,
        tenantId: context.tenantId,
        connectorId
      });

      if (!existingRecord) {
        throw new CoreError("validation.failed");
      }

      const existingConfig = parseTelegramConfigFromRecord(existingRecord);
      const botTokenSecretRef = await resolveTelegramBotTokenSecretRef({
        context,
        request,
        connectorId,
        existingConfig,
        secretWriter: options.secretWriter,
        updatedAt
      });
      const webhookConnectorId =
        existingConfig?.webhookConnectorId ??
        webhookConnectorIdFactory({
          tenantId: context.tenantId,
          channelExternalId: request.channelExternalId
        });
      const webhookSecretTokenSecretRef =
        await resolveTelegramWebhookSecretTokenSecretRef({
          context,
          connectorId,
          existingConfig,
          secretWriter: options.secretWriter,
          webhookSecretTokenFactory,
          updatedAt
        });
      const config: InternalTelegramIntegrationConfig = {
        channelExternalId: request.channelExternalId,
        mode: request.mode,
        botTokenSecretRef,
        webhookConnectorId,
        webhookSecretTokenSecretRef,
        outboundEnabled: request.outboundEnabled
      };
      const parsedConfig = parseTelegramChannelConfig(config);
      const existingDiagnostics = parseStoredTelegramDiagnostics(
        existingRecord.diagnostics
      );
      const diagnostics =
        shouldPreserveTelegramDiagnostics({
          existingConfig,
          existingDiagnostics,
          request,
          nextConfig: parsedConfig
        }) && existingDiagnostics
          ? existingDiagnostics
          : buildTelegramDiagnostics({
              enabled: request.enabled,
              config: parsedConfig,
              checkedAt: updatedAt.toISOString(),
              runtime: existingDiagnostics?.runtime
            });
      const status = telegramConnectorStatusFromUpdate({
        existingRecord,
        enabled: request.enabled,
        diagnostics
      });
      const onboardingState = updateTelegramOnboardingState({
        existingState: existingRecord?.onboardingState,
        completedStep: request.setupStepCompleted
      });
      const setupStep = resolveTelegramSetupStep({
        onboardingState,
        config: parsedConfig,
        diagnostics
      });

      await upsertTelegramConnector({
        repository: options.connectorRepository,
        sourceRepository: options.sourceRepository,
        context,
        existingRecord,
        connectorId,
        displayName:
          request.displayName?.trim() ||
          existingRecord?.displayName ||
          defaultTelegramDisplayName,
        enabled: request.enabled,
        config: parsedConfig,
        diagnostics,
        status,
        onboardingState,
        updatedAt
      });

      return telegramResponseFromConfig({
        connectorId,
        displayName:
          request.displayName?.trim() ||
          existingRecord?.displayName ||
          defaultTelegramDisplayName,
        status,
        enabled: request.enabled,
        config: parsedConfig,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        diagnostics,
        setupStep
      });
    },

    async refreshTelegramDiagnostics(context, input) {
      if (options.providerOperationEvents) {
        return enqueueTelegramProviderOperation({
          context,
          connectorId: requireTelegramConnectorId(input),
          operation: "telegram.diagnostics.refresh",
          repository: options.connectorRepository,
          sourceRepository: options.sourceRepository,
          events: options.providerOperationEvents,
          publicWebhookBaseUrl: options.publicWebhookBaseUrl,
          now
        });
      }

      return runTelegramProviderDiagnostics({
        context,
        connectorId: requireTelegramConnectorId(input),
        repository: options.connectorRepository,
        sourceRepository: options.sourceRepository,
        secretResolver,
        botApiClientFactory,
        egressRuntime,
        telegramApiBaseUrl: options.telegramApiBaseUrl,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        now
      });
    },

    async setTelegramWebhook(context, input) {
      if (options.providerOperationEvents) {
        return enqueueTelegramProviderOperation({
          context,
          connectorId: requireTelegramConnectorId(input),
          operation: "telegram.webhook.set",
          repository: options.connectorRepository,
          sourceRepository: options.sourceRepository,
          events: options.providerOperationEvents,
          publicWebhookBaseUrl: options.publicWebhookBaseUrl,
          now
        });
      }

      return runTelegramWebhookSync({
        operation: "set",
        context,
        connectorId: requireTelegramConnectorId(input),
        repository: options.connectorRepository,
        sourceRepository: options.sourceRepository,
        secretResolver,
        botApiClientFactory,
        egressRuntime,
        telegramApiBaseUrl: options.telegramApiBaseUrl,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        now
      });
    },

    async deleteTelegramWebhook(context, input) {
      if (options.providerOperationEvents) {
        return enqueueTelegramProviderOperation({
          context,
          connectorId: requireTelegramConnectorId(input),
          operation: "telegram.webhook.delete",
          repository: options.connectorRepository,
          sourceRepository: options.sourceRepository,
          events: options.providerOperationEvents,
          publicWebhookBaseUrl: options.publicWebhookBaseUrl,
          now
        });
      }

      return runTelegramWebhookSync({
        operation: "delete",
        context,
        connectorId: requireTelegramConnectorId(input),
        repository: options.connectorRepository,
        sourceRepository: options.sourceRepository,
        secretResolver,
        botApiClientFactory,
        egressRuntime,
        telegramApiBaseUrl: options.telegramApiBaseUrl,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        now
      });
    }
  };
}

type TelegramProviderOperationOptions = {
  context: InternalIntegrationContext;
  connectorId: string;
  repository: ChannelConnectorRepository;
  sourceRepository?: SourceIntegrationRepository;
  secretResolver: SecretResolver;
  botApiClientFactory: TelegramBotApiClientFactory;
  egressRuntime: EgressRuntime;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  now: () => Date;
};

type TelegramWebhookSyncOptions = TelegramProviderOperationOptions & {
  operation: "set" | "delete";
};

type TelegramProviderOperationRequestOptions = {
  context: InternalIntegrationContext;
  connectorId: string;
  operation: ChannelProviderOperation;
  repository: ChannelConnectorRepository;
  sourceRepository?: SourceIntegrationRepository;
  events: DomainEventRepository;
  publicWebhookBaseUrl?: string;
  now: () => Date;
};

export function createEnvSecretResolver(
  env: Record<string, string | undefined> = process.env
): SecretResolver {
  return {
    async resolveSecret({ secretRef }) {
      const envName = secretRef.startsWith("env:")
        ? secretRef.slice("env:".length)
        : secretRef;
      const value = env[envName]?.trim();

      return value && value.length > 0 ? value : null;
    }
  };
}

export function createTenantSecretResolver(input: {
  env?: Record<string, string | undefined>;
  tenantSecrets?: TenantSecretRepository;
}): SecretResolver {
  const envResolver = createEnvSecretResolver(input.env);

  return {
    async resolveSecret({ tenantId, secretRef }) {
      if (secretRef.startsWith("secret:")) {
        return (
          (await input.tenantSecrets?.resolveSecret({ tenantId, secretRef })) ??
          null
        );
      }

      return envResolver.resolveSecret({ tenantId, secretRef });
    }
  };
}

function requireTelegramConnectorId(
  input: { connectorId?: string } | undefined
): string {
  const connectorId = input?.connectorId?.trim();

  if (!connectorId) {
    throw new CoreError("validation.failed");
  }

  return connectorId;
}

async function loadExistingTelegramConnector(input: {
  repository: ChannelConnectorRepository;
  tenantId: TenantId;
  connectorId?: string;
}): Promise<ChannelConnectorRecord | null> {
  const connectorId = input.connectorId?.trim();

  if (!connectorId) {
    return null;
  }

  const record = await input.repository.findConnector({
    tenantId: input.tenantId,
    connectorId
  });

  return record?.channelType === telegramChannelType ? record : null;
}

async function updateChannelConnectorLifecycle(input: {
  context: InternalIntegrationContext;
  repository: ChannelConnectorRepository;
  sourceRepository?: SourceIntegrationRepository;
  connectorId: string;
  action: "enable" | "disable" | "delete";
  updatedAt: Date;
}): Promise<InternalChannelConnectorSummary> {
  const connectorId = input.connectorId.trim();
  const record = connectorId
    ? await input.repository.findConnector({
        tenantId: input.context.tenantId,
        connectorId
      })
    : null;

  if (!record || record.status === "deleted") {
    throw new CoreError("validation.failed");
  }

  const updatedRecord =
    input.action === "enable"
      ? buildEnabledChannelConnectorRecord({
          record,
          updatedAt: input.updatedAt
        })
      : buildDisabledChannelConnectorRecord({
          record,
          status: input.action === "delete" ? "deleted" : "disabled",
          updatedAt: input.updatedAt
        });

  await input.repository.upsertConnector({
    id: updatedRecord.id,
    tenantId: updatedRecord.tenantId,
    channelType: updatedRecord.channelType,
    channelClass: updatedRecord.channelClass,
    provider: updatedRecord.provider,
    displayName: updatedRecord.displayName,
    status: updatedRecord.status,
    healthStatus: updatedRecord.healthStatus,
    capabilities: updatedRecord.capabilities,
    onboardingState: updatedRecord.onboardingState,
    config: updatedRecord.config,
    diagnostics: updatedRecord.diagnostics,
    sourceConnectionId: updatedRecord.sourceConnectionId,
    createdByEmployeeId: updatedRecord.createdByEmployeeId,
    updatedAt: updatedRecord.updatedAt
  });
  await upsertSourceConnectionForChannelConnector({
    context: input.context,
    record: updatedRecord,
    sourceRepository: input.sourceRepository
  });

  const summary = channelConnectorSummaryFromRecord(updatedRecord);

  if (!summary) {
    throw new CoreError("validation.failed");
  }

  return summary;
}

function buildEnabledChannelConnectorRecord(input: {
  record: ChannelConnectorRecord;
  updatedAt: Date;
}): ChannelConnectorRecord {
  const checkedAt = input.updatedAt.toISOString();

  if (input.record.channelType === telegramChannelType) {
    const config = parseTelegramConfigFromRecord(input.record);

    if (!config?.botTokenSecretRef) {
      return {
        ...input.record,
        status: "onboarding",
        healthStatus: "unknown",
        diagnostics: buildInvalidTelegramDiagnostics(checkedAt),
        updatedAt: input.updatedAt
      };
    }

    const diagnostics = buildTelegramDiagnostics({
      enabled: true,
      config,
      checkedAt
    });

    return {
      ...input.record,
      status: telegramConnectorStatusFromDiagnostics({
        enabled: true,
        diagnostics
      }),
      healthStatus: telegramConnectorHealthFromDiagnostics({
        enabled: true,
        diagnostics
      }),
      diagnostics,
      updatedAt: input.updatedAt
    };
  }

  return {
    ...input.record,
    status: "onboarding",
    healthStatus: "unknown",
    diagnostics: {
      status: "unknown",
      checkedAt
    },
    updatedAt: input.updatedAt
  };
}

function buildDisabledChannelConnectorRecord(input: {
  record: ChannelConnectorRecord;
  status: "disabled" | "deleted";
  updatedAt: Date;
}): ChannelConnectorRecord {
  return {
    ...input.record,
    status: input.status,
    healthStatus: "unknown",
    diagnostics: buildDisabledChannelConnectorDiagnostics({
      record: input.record,
      checkedAt: input.updatedAt.toISOString()
    }),
    updatedAt: input.updatedAt
  };
}

function requireAuthChallengeRepository(
  repository: ChannelAuthChallengeRepository | undefined
): ChannelAuthChallengeRepository {
  if (!repository) {
    throw new CoreError("validation.failed");
  }

  return repository;
}

function requireChannelSessionRepository(
  repository: ChannelSessionRepository | undefined
): ChannelSessionRepository {
  if (!repository) {
    throw new CoreError("validation.failed");
  }

  return repository;
}

async function upsertSourceConnectionForChannelConnector(input: {
  context: InternalIntegrationContext;
  record: ChannelConnectorRecord;
  sourceRepository?: SourceIntegrationRepository;
}): Promise<void> {
  if (!input.sourceRepository || !input.record.sourceConnectionId) {
    return;
  }

  await input.sourceRepository.upsertSourceConnection({
    id: input.record.sourceConnectionId,
    tenantId: input.record.tenantId,
    sourceType: "messenger",
    sourceName: sourceNameForChannelConnector(input.record),
    displayName: input.record.displayName,
    status: sourceStatusFromChannelConnectorStatus(input.record.status),
    authType: sourceAuthTypeForChannelConnector(input.record),
    capabilities: sourceCapabilitiesForChannelConnector(input.record),
    config: {
      channelConnectorId: input.record.id,
      channelType: input.record.channelType,
      channelClass: input.record.channelClass,
      provider: input.record.provider
    },
    diagnostics: sourceDiagnosticsForChannelConnector(input.record),
    metadata: {
      managedBy: "channel_connector",
      createdByEmployeeId: input.context.employeeId
    },
    createdByEmployeeId: input.record.createdByEmployeeId,
    updatedAt: input.record.updatedAt
  });
}

async function createTelegramBotConnector(input: {
  context: InternalIntegrationContext;
  request: InternalChannelConnectorCreateRequest;
  repository: ChannelConnectorRepository;
  sourceRepository?: SourceIntegrationRepository;
  updatedAt: Date;
  webhookConnectorIdFactory: NonNullable<
    InternalIntegrationServiceOptions["webhookConnectorIdFactory"]
  >;
}): Promise<InternalChannelConnectorSummary> {
  const connectorId = createRandomChannelConnectorId(input.request.channelType);
  const sourceConnectionId = input.sourceRepository
    ? createSourceConnectionIdFromConnectorId(connectorId)
    : null;
  const channelExternalId = createDefaultTelegramChannelExternalId();
  const config: InternalTelegramIntegrationConfig = {
    channelExternalId,
    mode: "webhook",
    webhookConnectorId: input.webhookConnectorIdFactory({
      tenantId: input.context.tenantId,
      channelExternalId
    }),
    outboundEnabled: false
  };
  const diagnostics = buildTelegramDiagnostics({
    enabled: false,
    config,
    checkedAt: input.updatedAt.toISOString()
  });
  const displayName =
    input.request.displayName?.trim() || defaultTelegramDisplayName;
  await upsertSourceConnectionForChannelConnector({
    context: input.context,
    record: {
      id: connectorId,
      tenantId: input.context.tenantId,
      channelType: telegramChannelType,
      channelClass: telegramChannelClass,
      provider: telegramProvider,
      displayName,
      status: "draft",
      healthStatus: "unknown",
      capabilities: {
        inbound: true,
        outbound: true,
        attachmentsMetadata: true
      },
      onboardingState: {
        step: "name"
      },
      config,
      diagnostics,
      sourceConnectionId,
      createdByEmployeeId: input.context.employeeId,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt
    },
    sourceRepository: input.sourceRepository
  });

  await input.repository.upsertConnector({
    id: connectorId,
    tenantId: input.context.tenantId,
    channelType: telegramChannelType,
    channelClass: telegramChannelClass,
    provider: telegramProvider,
    displayName,
    status: "draft",
    healthStatus: "unknown",
    capabilities: {
      inbound: true,
      outbound: true,
      attachmentsMetadata: true
    },
    onboardingState: {
      step: "name"
    },
    config,
    diagnostics,
    sourceConnectionId,
    createdByEmployeeId: input.context.employeeId,
    updatedAt: input.updatedAt
  });

  return {
    connectorId,
    channelType: telegramChannelType,
    channelClass: telegramChannelClass,
    provider: telegramProvider,
    displayName,
    status: "draft",
    healthStatus: "unknown",
    channelExternalId,
    diagnosticsStatus: diagnostics.status,
    ...(diagnostics.egress ? { egress: diagnostics.egress } : {})
  };
}

async function createUserBridgeConnector(input: {
  context: InternalIntegrationContext;
  request: InternalChannelConnectorCreateRequest;
  repository: ChannelConnectorRepository;
  sessionRepository: ChannelSessionRepository;
  sourceRepository?: SourceIntegrationRepository;
  spec: (typeof userBridgeChannelSpecs)[UserBridgeChannelType];
  updatedAt: Date;
}): Promise<InternalChannelConnectorSummary> {
  const connectorId = createRandomChannelConnectorId(input.request.channelType);
  const sourceConnectionId = input.sourceRepository
    ? createSourceConnectionIdFromConnectorId(connectorId)
    : null;
  const sessionId = createRandomChannelSessionId();
  const displayName =
    input.request.displayName?.trim() || input.spec.defaultDisplayName;
  const checkedAt = input.updatedAt.toISOString();
  const diagnostics = {
    status: "not_started",
    checkedAt,
    egress: buildUserBridgeEgressDiagnostics({
      checkedAt,
      requirement: input.spec.egressRequirement
    }),
    session: {
      sessionKey: userBridgePrimarySessionKey,
      status: "not_started"
    }
  };
  await upsertSourceConnectionForChannelConnector({
    context: input.context,
    record: {
      id: connectorId,
      tenantId: input.context.tenantId,
      channelType: input.spec.channelType,
      channelClass: userBridgeChannelClass,
      provider: input.spec.provider,
      displayName,
      status: "onboarding",
      healthStatus: "unknown",
      capabilities: input.spec.capabilities,
      onboardingState: {
        step: input.spec.initialStep
      },
      config: {
        sessionKey: userBridgePrimarySessionKey,
        authMode: input.spec.authMode
      },
      diagnostics,
      sourceConnectionId,
      createdByEmployeeId: input.context.employeeId,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt
    },
    sourceRepository: input.sourceRepository
  });

  await input.repository.upsertConnector({
    id: connectorId,
    tenantId: input.context.tenantId,
    channelType: input.spec.channelType,
    channelClass: userBridgeChannelClass,
    provider: input.spec.provider,
    displayName,
    status: "onboarding",
    healthStatus: "unknown",
    capabilities: input.spec.capabilities,
    onboardingState: {
      step: input.spec.initialStep
    },
    config: {
      sessionKey: userBridgePrimarySessionKey,
      authMode: input.spec.authMode
    },
    diagnostics,
    sourceConnectionId,
    createdByEmployeeId: input.context.employeeId,
    updatedAt: input.updatedAt
  });

  await input.sessionRepository.upsertSession({
    id: sessionId,
    tenantId: input.context.tenantId,
    connectorId,
    sessionKey: userBridgePrimarySessionKey,
    status: "not_started",
    publicState: {
      stage: "not_started"
    },
    metadata: {
      provider: input.spec.provider,
      channelType: input.spec.channelType,
      authMode: input.spec.authMode
    },
    updatedAt: input.updatedAt
  });
  await input.sessionRepository.appendSessionEvent({
    id: createRandomChannelSessionEventId(),
    tenantId: input.context.tenantId,
    connectorId,
    sessionId,
    eventType: "session.created",
    metadata: {
      channelType: input.spec.channelType,
      provider: input.spec.provider,
      sessionKey: userBridgePrimarySessionKey
    },
    occurredAt: input.updatedAt,
    updatedAt: input.updatedAt
  });

  return {
    connectorId,
    channelType: input.spec.channelType,
    channelClass: userBridgeChannelClass,
    provider: input.spec.provider,
    displayName,
    status: "onboarding",
    healthStatus: "unknown",
    diagnosticsStatus: diagnostics.status,
    egress: diagnostics.egress
  };
}

async function loadUserBridgeConnector(input: {
  repository: ChannelConnectorRepository;
  tenantId: TenantId;
  connectorId: string;
}): Promise<ChannelConnectorRecord> {
  const connectorId = input.connectorId.trim();
  const record = connectorId
    ? await input.repository.findConnector({
        tenantId: input.tenantId,
        connectorId
      })
    : null;

  if (
    !record ||
    record.channelClass !== "user_bridge" ||
    record.status === "deleted"
  ) {
    throw new CoreError("validation.failed");
  }

  return record;
}

async function loadChannelConnector(input: {
  repository: ChannelConnectorRepository;
  tenantId: TenantId;
  connectorId: string;
}): Promise<ChannelConnectorRecord> {
  const connectorId = input.connectorId.trim();
  const record = connectorId
    ? await input.repository.findConnector({
        tenantId: input.tenantId,
        connectorId
      })
    : null;

  if (!record || record.status === "deleted") {
    throw new CoreError("validation.failed");
  }

  return record;
}

function getUserBridgeChannelSpec(
  channelType: string
): (typeof userBridgeChannelSpecs)[UserBridgeChannelType] | undefined {
  if (channelType === telegramQrBridgeChannelType) {
    return userBridgeChannelSpecs.telegram_qr_bridge;
  }

  if (channelType === whatsappQrBridgeChannelType) {
    return userBridgeChannelSpecs.whatsapp_qr_bridge;
  }

  if (channelType === maxQrBridgeChannelType) {
    return userBridgeChannelSpecs.max_qr_bridge;
  }

  return undefined;
}

function createSourceConnectionIdFromConnectorId(
  connectorId: ChannelConnectorId
): SourceConnectionId {
  return `source_connection:${connectorId}` as SourceConnectionId;
}

function sourceNameForChannelConnector(record: ChannelConnectorRecord): string {
  if (record.channelType === telegramChannelType) {
    return "telegram_bot";
  }

  if (record.channelType === telegramQrBridgeChannelType) {
    return "telegram_user_session";
  }

  if (record.channelType === whatsappQrBridgeChannelType) {
    return "whatsapp_user_session";
  }

  if (record.channelType === maxQrBridgeChannelType) {
    return "max_user_session";
  }

  return String(record.channelType);
}

function sourceAuthTypeForChannelConnector(
  record: ChannelConnectorRecord
): "token" | "custom" {
  return record.channelType === telegramChannelType ? "token" : "custom";
}

function sourceStatusFromChannelConnectorStatus(
  status: ChannelConnectorRecord["status"]
) {
  if (status === "draft") {
    return "draft";
  }

  if (status === "onboarding") {
    return "onboarding";
  }

  if (status === "connected") {
    return "active";
  }

  if (status === "disabled") {
    return "disabled";
  }

  if (status === "degraded") {
    return "degraded";
  }

  if (status === "deleted") {
    return "deleted";
  }

  return "error";
}

function sourceCapabilitiesForChannelConnector(record: ChannelConnectorRecord) {
  const isUserBridge = record.channelClass === userBridgeChannelClass;
  const isTelegramBot = record.channelType === telegramChannelType;

  return {
    canReceive: true,
    canReply: true,
    canFetchHistory: isUserBridge,
    canSendFiles: true,
    canReceiveFiles: true,
    supportsThreads: record.channelType === telegramQrBridgeChannelType,
    supportsReactions: isUserBridge,
    supportsReadStatus: isUserBridge,
    supportsDeliveryStatus: true,
    webhookSupported: isTelegramBot,
    pollingRequired: false,
    customerProfile: true,
    rateLimitsKnown: record.provider === telegramProvider,
    oauthSupported: false,
    sandboxAvailable: false,
    legalRisk: isUserBridge ? "high" : "low"
  };
}

function sourceDiagnosticsForChannelConnector(record: ChannelConnectorRecord) {
  return {
    channelStatus: record.status,
    channelHealthStatus: record.healthStatus,
    diagnosticsStatus: readRecordString(record.diagnostics, "status"),
    checkedAt: readRecordString(record.diagnostics, "checkedAt")
  };
}

function assertUserBridgeStartChallengeAllowed(input: {
  connector: ChannelConnectorRecord;
  challengeType: InternalChannelAuthChallengeType;
}): void {
  const spec = getUserBridgeChannelSpec(input.connector.channelType);
  const allowedStartChallengeTypes:
    | readonly InternalChannelAuthChallengeType[]
    | undefined = spec?.allowedStartChallengeTypes;

  if (!allowedStartChallengeTypes?.includes(input.challengeType)) {
    throw new CoreError("validation.failed");
  }
}

async function loadConnectorAuthChallenge(input: {
  repository: ChannelAuthChallengeRepository;
  tenantId: TenantId;
  connectorId: string;
  challengeId: string;
}): Promise<ChannelAuthChallengeRecord> {
  const challenge = await input.repository.findChallenge({
    tenantId: input.tenantId,
    challengeId: input.challengeId
  });

  if (!challenge || challenge.connectorId !== input.connectorId.trim()) {
    throw new CoreError("validation.failed");
  }

  return challenge;
}

function authChallengePersistenceInputFromRecord(
  record: ChannelAuthChallengeRecord
) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    connectorId: record.connectorId,
    challengeType: record.challengeType,
    status: record.status,
    publicPayload: record.publicPayload,
    secretPayloadEncrypted: record.secretPayloadEncrypted,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    expiresAt: record.expiresAt,
    completedAt: record.completedAt,
    createdByEmployeeId: record.createdByEmployeeId
  };
}

function initialChannelAuthChallengeStatus(input: {
  challengeType: InternalChannelAuthChallengeType;
  spec?: (typeof userBridgeChannelSpecs)[UserBridgeChannelType];
}): InternalChannelAuthChallengeStatus {
  const initialChallengeStatuses = input.spec?.initialChallengeStatuses as
    | Partial<
        Record<
          InternalChannelAuthChallengeType,
          InternalChannelAuthChallengeStatus
        >
      >
    | undefined;
  const override = initialChallengeStatuses?.[input.challengeType];

  if (override) {
    return override;
  }

  switch (input.challengeType) {
    case "phone_code":
      return "requires_code";
    case "password":
      return "requires_password";
    case "qr":
    case "reauth":
      return "waiting";
  }
}

function submittedChannelAuthChallengeStatus(input: {
  challengeType: string;
  currentStatus: string;
  hasCode: boolean;
  hasPassword: boolean;
}): InternalChannelAuthChallengeStatus {
  if (input.currentStatus === "requires_code" && input.hasCode) {
    return "waiting";
  }

  if (input.currentStatus === "requires_password" && input.hasPassword) {
    return "waiting";
  }

  return internalChannelAuthChallengeStatus(input.currentStatus) ?? "failed";
}

function submittedChannelAuthChallengeSecretPayload(input: {
  existingSecretPayloadEncrypted: string | null;
  request: InternalChannelAuthChallengeSubmitRequest;
  cipher?: Pick<TenantSecretCipher, "encrypt" | "decrypt">;
  submittedAt: Date;
}): string | null {
  const code = input.request.code?.trim();
  const password = input.request.password?.trim();

  if (!code && !password) {
    return input.existingSecretPayloadEncrypted;
  }

  if (!input.cipher) {
    return input.existingSecretPayloadEncrypted;
  }

  const existingPayload = readEncryptedAuthChallengePayload({
    cipher: input.cipher,
    secretPayloadEncrypted: input.existingSecretPayloadEncrypted
  });

  return input.cipher.encrypt(
    JSON.stringify({
      ...existingPayload,
      ...(code ? { code } : {}),
      ...(password ? { password } : {}),
      submittedAt: input.submittedAt.toISOString()
    })
  );
}

function readEncryptedAuthChallengePayload(input: {
  cipher: Pick<TenantSecretCipher, "decrypt">;
  secretPayloadEncrypted: string | null;
}): Record<string, unknown> {
  if (!input.secretPayloadEncrypted) {
    return {};
  }

  try {
    const parsed = JSON.parse(
      input.cipher.decrypt(input.secretPayloadEncrypted)
    );

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function channelAuthChallengePublicPayload(input: {
  challengeType: InternalChannelAuthChallengeType;
  phoneNumber?: string;
  expiresAt: Date;
}): Record<string, string> {
  const expiresAt = input.expiresAt.toISOString();

  if (input.challengeType === "phone_code" && input.phoneNumber) {
    return {
      phoneNumber: input.phoneNumber,
      expiresAt
    };
  }

  if (input.challengeType === "qr") {
    return {
      qrPayloadRef: `challenge:${randomUUID()}`,
      expiresAt
    };
  }

  return {
    expiresAt
  };
}

function isChannelAuthChallengeExpired(
  challenge: ChannelAuthChallengeRecord,
  now: Date
): boolean {
  return (
    !isChannelAuthChallengeTerminal(challenge.status) &&
    challenge.expiresAt !== null &&
    challenge.expiresAt.getTime() <= now.getTime()
  );
}

function isChannelAuthChallengeTerminal(status: string): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "expired" ||
    status === "cancelled"
  );
}

function channelAuthChallengeResponseFromRecord(
  record: ChannelAuthChallengeRecord
): InternalChannelAuthChallengeResponse {
  return {
    challenge: {
      challengeId: record.id,
      connectorId: record.connectorId,
      challengeType: internalChannelAuthChallengeType(record.challengeType),
      status: internalChannelAuthChallengeStatus(record.status) ?? "failed",
      publicPayload: publicChannelAuthChallengePayload(record.publicPayload),
      ...(record.errorCode && isPlatformErrorCode(record.errorCode)
        ? { errorCode: record.errorCode }
        : {}),
      ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
      ...(record.expiresAt
        ? { expiresAt: record.expiresAt.toISOString() }
        : {}),
      ...(record.completedAt
        ? { completedAt: record.completedAt.toISOString() }
        : {}),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    }
  };
}

function internalChannelAuthChallengeType(
  value: string
): InternalChannelAuthChallengeType {
  switch (value) {
    case "qr":
    case "phone_code":
    case "password":
    case "reauth":
      return value;
    default:
      return "reauth";
  }
}

function internalChannelAuthChallengeStatus(
  value: string
): InternalChannelAuthChallengeStatus | null {
  switch (value) {
    case "pending":
    case "waiting":
    case "requires_code":
    case "requires_password":
    case "succeeded":
    case "failed":
    case "expired":
    case "cancelled":
      return value;
    default:
      return null;
  }
}

function publicChannelAuthChallengePayload(
  payload: unknown
): InternalChannelAuthChallengeResponse["challenge"]["publicPayload"] {
  if (!isRecord(payload)) {
    return {};
  }

  return {
    ...(readRecordString(payload, "qrImageDataUrl")
      ? { qrImageDataUrl: readRecordString(payload, "qrImageDataUrl") }
      : {}),
    ...(readRecordString(payload, "qrPayloadRef")
      ? { qrPayloadRef: readRecordString(payload, "qrPayloadRef") }
      : {}),
    ...(readRecordString(payload, "phoneNumber")
      ? { phoneNumber: readRecordString(payload, "phoneNumber") }
      : {}),
    ...(readRecordString(payload, "pairingCode")
      ? { pairingCode: readRecordString(payload, "pairingCode") }
      : {}),
    ...(readRecordString(payload, "expiresAt")
      ? { expiresAt: readRecordString(payload, "expiresAt") }
      : {}),
    ...(readRecordString(payload, "operatorHint")
      ? { operatorHint: readRecordString(payload, "operatorHint") }
      : {})
  };
}

function buildDisabledChannelConnectorDiagnostics(input: {
  record: ChannelConnectorRecord;
  checkedAt: string;
}): unknown {
  if (input.record.channelType === telegramChannelType) {
    const config = parseTelegramConfigFromRecord(input.record);

    if (config) {
      return buildTelegramDiagnostics({
        enabled: false,
        config,
        checkedAt: input.checkedAt
      });
    }
  }

  return {
    status: "disabled",
    checkedAt: input.checkedAt
  };
}

function parseTelegramConfigFromRecord(
  record: ChannelConnectorRecord | null
): InternalTelegramIntegrationConfig | null {
  if (!record?.config) {
    return null;
  }

  try {
    return parseTelegramChannelConfig(record.config);
  } catch {
    return null;
  }
}

async function resolveTelegramBotTokenSecretRef(input: {
  context: InternalIntegrationContext;
  request: InternalTelegramIntegrationUpdateRequest;
  connectorId: string;
  existingConfig: InternalTelegramIntegrationConfig | null;
  secretWriter?: SecretWriter;
  updatedAt: Date;
}): Promise<string | undefined> {
  const botToken = input.request.botToken?.trim();

  if (botToken && botToken.length > 0) {
    if (!input.secretWriter) {
      throw new CoreError("validation.failed");
    }

    const secretRef = buildTelegramBotTokenSecretRef({
      tenantId: input.context.tenantId,
      connectorId: input.connectorId
    });

    await input.secretWriter.upsertSecret({
      tenantId: input.context.tenantId,
      secretRef,
      purpose: "telegram.bot_token",
      plainText: botToken,
      updatedAt: input.updatedAt
    });

    return secretRef;
  }

  return (
    input.request.botTokenSecretRef?.trim() ||
    input.existingConfig?.botTokenSecretRef
  );
}

function buildTelegramBotTokenSecretRef(input: {
  tenantId: TenantId;
  connectorId: string;
}): string {
  return createChannelConnectorSecretRef({
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    secretName: "bot-token"
  });
}

async function resolveTelegramWebhookSecretTokenSecretRef(input: {
  context: InternalIntegrationContext;
  connectorId: string;
  existingConfig: InternalTelegramIntegrationConfig | null;
  secretWriter?: SecretWriter;
  webhookSecretTokenFactory: () => string;
  updatedAt: Date;
}): Promise<string | undefined> {
  if (input.existingConfig?.webhookSecretTokenSecretRef) {
    return input.existingConfig.webhookSecretTokenSecretRef;
  }

  if (!input.secretWriter) {
    return undefined;
  }

  const secretRef = buildTelegramWebhookSecretTokenSecretRef({
    tenantId: input.context.tenantId,
    connectorId: input.connectorId
  });

  await input.secretWriter.upsertSecret({
    tenantId: input.context.tenantId,
    secretRef,
    purpose: "telegram.webhook_secret_token",
    plainText: input.webhookSecretTokenFactory(),
    updatedAt: input.updatedAt
  });

  return secretRef;
}

function buildTelegramWebhookSecretTokenSecretRef(input: {
  tenantId: TenantId;
  connectorId: string;
}): string {
  return createChannelConnectorSecretRef({
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    secretName: "webhook-secret-token"
  });
}

function createRandomChannelConnectorId(
  channelType: InternalChannelType
): ChannelConnectorId {
  return `${channelType}:${randomUUID()}` as ChannelConnectorId;
}

function createRandomChannelAuthChallengeId(): string {
  return `cha_${randomUUID()}`;
}

function createRandomChannelSessionId(): string {
  return `chs_${randomUUID()}`;
}

function createRandomChannelSessionEventId(): string {
  return `cse_${randomUUID()}`;
}

function createDefaultTelegramChannelExternalId(): string {
  return `telegram-${randomUUID().slice(0, 8)}`;
}

function createTelegramWebhookConnectorId(input: {
  tenantId: TenantId;
  channelExternalId: string;
}): string {
  void input;

  return `tgwh_${randomUUID()}`;
}

function createTelegramWebhookSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

async function validateTelegramBotTokenViaProviderWorker(input: {
  context: InternalIntegrationContext;
  request: InternalTelegramBotTokenValidateRequest;
  validationJobRepository: ChannelProviderValidationJobRepository;
  events: DomainEventRepository;
  secretWriter: SecretWriter;
  timeoutMs: number;
  pollIntervalMs: number;
  now: () => Date;
}): Promise<InternalTelegramBotTokenValidateResponse> {
  const updatedAt = input.now();
  const jobId = createTelegramProviderValidationJobId();
  const botTokenSecretRef = createTelegramProviderValidationSecretRef({
    tenantId: input.context.tenantId,
    jobId
  });
  const expiresAt = new Date(updatedAt.getTime() + input.timeoutMs + 30_000);

  await input.secretWriter.upsertSecret({
    tenantId: input.context.tenantId,
    secretRef: botTokenSecretRef,
    purpose: "telegram.bot_token_validation",
    plainText: input.request.botToken,
    updatedAt
  });

  await input.validationJobRepository.upsertJob({
    id: jobId,
    tenantId: input.context.tenantId,
    channelType: telegramChannelType,
    provider: telegramProvider,
    validationKind: telegramBotTokenValidationKind,
    status: "pending",
    botTokenSecretRef,
    expiresAt,
    createdByEmployeeId: input.context.employeeId,
    updatedAt
  });

  await input.events.append({
    tenantId: input.context.tenantId,
    events: [
      buildTelegramProviderValidationRequestedEvent({
        context: input.context,
        jobId,
        occurredAt: updatedAt.toISOString()
      })
    ]
  });

  return waitForTelegramProviderValidationJob({
    context: input.context,
    validationJobRepository: input.validationJobRepository,
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
    now: input.now,
    jobId
  });
}

async function waitForTelegramProviderValidationJob(input: {
  context: InternalIntegrationContext;
  validationJobRepository: ChannelProviderValidationJobRepository;
  timeoutMs: number;
  pollIntervalMs: number;
  now: () => Date;
  jobId: string;
}): Promise<InternalTelegramBotTokenValidateResponse> {
  const startedAt = Date.now();
  const deadlineAt = startedAt + input.timeoutMs;

  for (;;) {
    const job = await input.validationJobRepository.findJob({
      tenantId: input.context.tenantId,
      jobId: input.jobId
    });

    if (!job) {
      throw new CoreError("validation.failed");
    }

    if (job.status === "succeeded") {
      return internalTelegramBotTokenValidateResponseSchema.parse(
        job.resultPayload
      );
    }

    if (job.status === "failed") {
      throw new CoreError(
        typeof job.errorCode === "string" && isPlatformErrorCode(job.errorCode)
          ? job.errorCode
          : "provider.temporary_failure"
      );
    }

    if (input.now() >= job.expiresAt || Date.now() >= deadlineAt) {
      throw new CoreError("provider.temporary_failure");
    }

    await sleep(
      Math.min(input.pollIntervalMs, Math.max(deadlineAt - Date.now(), 0))
    );
  }
}

function createTelegramProviderValidationJobId(): string {
  return `channel-provider-validation:${randomUUID()}`;
}

function createTelegramProviderValidationSecretRef(input: {
  tenantId: TenantId;
  jobId: string;
}): string {
  return createTenantSecretRef({
    tenantId: input.tenantId,
    moduleId: telegramModuleId,
    secretName: `${input.jobId.replaceAll(":", "-")}-bot-token`
  });
}

function buildTelegramProviderValidationRequestedEvent(input: {
  context: InternalIntegrationContext;
  jobId: string;
  occurredAt: string;
}): PlatformEvent {
  return {
    id: `event:channel-provider-validation:${randomUUID()}` as EventId,
    type: "channel.provider_validation.requested",
    version: "v1",
    tenantId: input.context.tenantId,
    occurredAt: input.occurredAt,
    idempotencyKey: [input.context.requestId, input.jobId].join(":"),
    payload: {
      jobId: input.jobId,
      channelType: telegramChannelType,
      provider: telegramProvider,
      validationKind: telegramBotTokenValidationKind,
      actorEmployeeId: input.context.employeeId
    }
  };
}

async function enqueueTelegramProviderOperation(
  options: TelegramProviderOperationRequestOptions
): Promise<InternalTelegramIntegrationResponse> {
  const state = await loadTelegramState({
    context: options.context,
    connectorId: options.connectorId,
    repository: options.repository,
    secretResolver: createEnvSecretResolver({}),
    botApiClientFactory: createTelegramBotApiClient,
    egressRuntime: createPassthroughEgressRuntime(),
    publicWebhookBaseUrl: options.publicWebhookBaseUrl,
    now: options.now
  });

  if (!state.config || !state.enabled) {
    return state.response;
  }

  const diagnostics = buildQueuedTelegramProviderOperationDiagnostics({
    previous: state.response.diagnostics,
    checkedAt: state.checkedAt
  });

  await persistTelegramDiagnostics({
    context: options.context,
    repository: options.repository,
    sourceRepository: options.sourceRepository,
    existingRecord: state.record,
    connectorId: state.connectorId,
    displayName: state.displayName,
    enabled: state.enabled,
    config: state.config,
    diagnostics,
    updatedAt: state.updatedAt
  });

  await options.events.append({
    tenantId: options.context.tenantId,
    events: [
      buildTelegramProviderOperationRequestedEvent({
        context: options.context,
        connectorId: state.connectorId,
        operation: options.operation,
        occurredAt: state.checkedAt
      })
    ]
  });

  return telegramResponseFromConfig({
    connectorId: state.connectorId,
    displayName: state.displayName,
    status: telegramConnectorStatusFromDiagnostics({
      enabled: state.enabled,
      diagnostics
    }),
    setupStep: resolveTelegramSetupStep({
      onboardingState: state.record?.onboardingState,
      config: state.config,
      diagnostics
    }),
    enabled: state.enabled,
    config: state.config,
    publicWebhookBaseUrl: options.publicWebhookBaseUrl,
    diagnostics
  });
}

function buildTelegramProviderOperationRequestedEvent(input: {
  context: InternalIntegrationContext;
  connectorId: string;
  operation: ChannelProviderOperation;
  occurredAt: string;
}): PlatformEvent {
  return {
    id: `event:channel-provider-operation:${randomUUID()}` as EventId,
    type: "channel.provider_operation.requested",
    version: "v1",
    tenantId: input.context.tenantId,
    occurredAt: input.occurredAt,
    idempotencyKey: [
      input.context.requestId,
      input.connectorId,
      input.operation
    ].join(":"),
    payload: {
      connectorId: input.connectorId as ChannelConnectorId,
      channelType: telegramChannelType,
      provider: telegramProvider,
      operation: input.operation,
      actorEmployeeId: input.context.employeeId
    }
  };
}

function buildQueuedTelegramProviderOperationDiagnostics(input: {
  previous: InternalTelegramIntegrationDiagnostics;
  checkedAt: string;
}): InternalTelegramIntegrationDiagnostics {
  return internalTelegramIntegrationDiagnosticsSchema.parse({
    ...input.previous,
    checkedAt: input.checkedAt,
    egress:
      input.previous.egress ?? buildTelegramEgressDiagnostics(input.checkedAt)
  });
}

async function runTelegramProviderDiagnostics(
  options: TelegramProviderOperationOptions
): Promise<InternalTelegramIntegrationResponse> {
  const state = await loadTelegramState(options);

  if (!state.config || !state.enabled) {
    return state.response;
  }

  const diagnostics = await buildTelegramProviderDiagnostics({
    tenantId: options.context.tenantId,
    connectorId: state.connectorId,
    config: state.config,
    enabled: state.enabled,
    secretResolver: options.secretResolver,
    botApiClientFactory: options.botApiClientFactory,
    egressRuntime: options.egressRuntime,
    telegramApiBaseUrl: options.telegramApiBaseUrl,
    publicWebhookBaseUrl: options.publicWebhookBaseUrl,
    polling: state.response.diagnostics.polling,
    runtime: state.response.diagnostics.runtime,
    checkedAt: state.checkedAt
  });

  await persistTelegramDiagnostics({
    ...options,
    existingRecord: state.record,
    connectorId: state.connectorId,
    displayName: telegramDisplayNameFromDiagnostics({
      currentDisplayName: state.displayName,
      diagnostics
    }),
    enabled: state.enabled,
    config: state.config,
    diagnostics,
    updatedAt: state.updatedAt
  });

  return telegramResponseFromConfig({
    connectorId: state.connectorId,
    displayName: telegramDisplayNameFromDiagnostics({
      currentDisplayName: state.displayName,
      diagnostics
    }),
    status: telegramConnectorStatusFromDiagnostics({
      enabled: state.enabled,
      diagnostics
    }),
    setupStep: resolveTelegramSetupStep({
      onboardingState: state.record?.onboardingState,
      config: state.config,
      diagnostics
    }),
    enabled: state.enabled,
    config: state.config,
    publicWebhookBaseUrl: options.publicWebhookBaseUrl,
    diagnostics
  });
}

async function runTelegramWebhookSync(
  options: TelegramWebhookSyncOptions
): Promise<InternalTelegramIntegrationResponse> {
  const state = await loadTelegramState(options);

  if (!state.config || !state.enabled) {
    return state.response;
  }

  const token = await resolveTelegramBotToken({
    tenantId: options.context.tenantId,
    config: state.config,
    secretResolver: options.secretResolver
  });
  const webhookSecretToken = await resolveTelegramWebhookSecretToken({
    tenantId: options.context.tenantId,
    config: state.config,
    secretResolver: options.secretResolver
  });
  const expectedUrl = buildTelegramPublicWebhookUrl(
    options.publicWebhookBaseUrl,
    buildTelegramWebhookPath(state.config)
  );
  const egressResolution = await resolveTelegramEgressProfile({
    egressRuntime: options.egressRuntime,
    tenantId: options.context.tenantId,
    connectorId: state.connectorId,
    checkedAt: state.checkedAt
  });

  if (!token || !expectedUrl || !webhookSecretToken) {
    const diagnostics = buildTelegramDiagnostics({
      enabled: state.enabled,
      config: state.config,
      checkedAt: state.checkedAt,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      status: "invalid_config",
      lastErrorCode: "validation.failed",
      operatorHint: telegramWebhookInvalidConfigHint({
        token,
        expectedUrl,
        webhookSecretToken
      }),
      polling: state.response.diagnostics.polling,
      runtime: state.response.diagnostics.runtime,
      egress: egressResolution.diagnostics,
      checks: {
        botTokenResolved: Boolean(token),
        webhookSecretTokenResolved: Boolean(webhookSecretToken),
        botApiReachable: false,
        webhookMatchesConfig: false
      }
    });

    await persistTelegramDiagnostics({
      ...options,
      existingRecord: state.record,
      connectorId: state.connectorId,
      displayName: state.displayName,
      enabled: state.enabled,
      config: state.config,
      diagnostics,
      updatedAt: state.updatedAt
    });

    return telegramResponseFromConfig({
      connectorId: state.connectorId,
      displayName: state.displayName,
      status: telegramConnectorStatusFromDiagnostics({
        enabled: state.enabled,
        diagnostics
      }),
      setupStep: resolveTelegramSetupStep({
        onboardingState: state.record?.onboardingState,
        config: state.config,
        diagnostics
      }),
      enabled: state.enabled,
      config: state.config,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      diagnostics
    });
  }

  try {
    const client = options.botApiClientFactory({
      apiBaseUrl: options.telegramApiBaseUrl,
      botToken: token,
      egress: buildTelegramBotApiEgressBinding({
        egressRuntime: options.egressRuntime,
        resolution: egressResolution,
        tenantId: options.context.tenantId,
        connectorId: state.connectorId
      })
    });

    if (options.operation === "set") {
      await client.setWebhook({
        url: expectedUrl,
        secretToken: webhookSecretToken
      });
    } else {
      await client.deleteWebhook();
    }
  } catch (error) {
    const diagnostics = telegramProviderFailureDiagnostics({
      enabled: state.enabled,
      config: state.config,
      checkedAt: state.checkedAt,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      polling: state.response.diagnostics.polling,
      runtime: state.response.diagnostics.runtime,
      egress: egressResolution.diagnostics,
      error
    });

    await persistTelegramDiagnostics({
      ...options,
      existingRecord: state.record,
      connectorId: state.connectorId,
      displayName: state.displayName,
      enabled: state.enabled,
      config: state.config,
      diagnostics,
      updatedAt: state.updatedAt
    });

    return telegramResponseFromConfig({
      connectorId: state.connectorId,
      displayName: state.displayName,
      status: telegramConnectorStatusFromDiagnostics({
        enabled: state.enabled,
        diagnostics
      }),
      setupStep: resolveTelegramSetupStep({
        onboardingState: state.record?.onboardingState,
        config: state.config,
        diagnostics
      }),
      enabled: state.enabled,
      config: state.config,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      diagnostics
    });
  }

  return runTelegramProviderDiagnostics(options);
}

async function loadTelegramState(options: TelegramProviderOperationOptions) {
  const updatedAt = options.now();
  const checkedAt = updatedAt.toISOString();
  const record = await loadExistingTelegramConnector({
    repository: options.repository,
    tenantId: options.context.tenantId,
    connectorId: options.connectorId
  });

  if (!record) {
    throw new CoreError("validation.failed");
  }

  const response = telegramResponseFromRecord({
    record,
    publicWebhookBaseUrl: options.publicWebhookBaseUrl,
    checkedAt
  });

  return {
    record,
    connectorId: record.id,
    displayName: record.displayName,
    enabled: response.enabled,
    config: response.config,
    response,
    updatedAt,
    checkedAt
  };
}

async function persistTelegramDiagnostics(input: {
  context: InternalIntegrationContext;
  repository: ChannelConnectorRepository;
  sourceRepository?: SourceIntegrationRepository;
  existingRecord: ChannelConnectorRecord | null;
  connectorId: string;
  displayName: string;
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  diagnostics: InternalTelegramIntegrationDiagnostics;
  updatedAt: Date;
}): Promise<void> {
  await upsertTelegramConnector({
    repository: input.repository,
    sourceRepository: input.sourceRepository,
    context: input.context,
    existingRecord: input.existingRecord,
    connectorId: input.connectorId,
    displayName: input.displayName,
    enabled: input.enabled,
    config: input.config,
    diagnostics: input.diagnostics,
    status: telegramConnectorStatusFromDiagnostics({
      enabled: input.enabled,
      diagnostics: input.diagnostics
    }),
    updatedAt: input.updatedAt
  });
}

function createTelegramTokenValidationConnectorId(
  context: InternalIntegrationContext
): string {
  return `${telegramChannelType}:token-validation:${context.employeeId}`;
}

function telegramBotTokenValidationIdentity(
  bot: TelegramBotIdentity
): InternalTelegramBotTokenValidateResponse["bot"] {
  return {
    id: bot.id,
    ...(bot.username ? { username: bot.username } : {}),
    ...(bot.firstName ? { firstName: bot.firstName } : {})
  };
}

function telegramDisplayNameFromDiagnostics(input: {
  currentDisplayName: string;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): string {
  const providerName =
    input.diagnostics.bot?.username ?? input.diagnostics.bot?.firstName;

  if (!providerName) {
    return input.currentDisplayName;
  }

  const normalizedProviderName = input.diagnostics.bot?.username
    ? `@${providerName}`
    : providerName;
  const nextDisplayName = `${defaultTelegramDisplayName} (${normalizedProviderName})`;

  return input.currentDisplayName === defaultTelegramDisplayName ||
    input.currentDisplayName.startsWith(`${defaultTelegramDisplayName} (`)
    ? nextDisplayName
    : input.currentDisplayName;
}

function shouldPreserveTelegramDiagnostics(input: {
  existingConfig: InternalTelegramIntegrationConfig | null;
  existingDiagnostics: InternalTelegramIntegrationDiagnostics | null;
  nextConfig: InternalTelegramIntegrationConfig;
  request: InternalTelegramIntegrationUpdateRequest;
}): boolean {
  return (
    !hasNewTelegramBotToken(input.request) &&
    input.existingDiagnostics !== null &&
    input.existingConfig !== null &&
    telegramConfigEquals(input.existingConfig, input.nextConfig)
  );
}

function hasNewTelegramBotToken(
  request: InternalTelegramIntegrationUpdateRequest
): boolean {
  return request.botToken?.trim().length ? true : false;
}

function telegramConfigEquals(
  left: InternalTelegramIntegrationConfig,
  right: InternalTelegramIntegrationConfig
): boolean {
  return (
    left.channelExternalId === right.channelExternalId &&
    left.mode === right.mode &&
    left.botTokenSecretRef === right.botTokenSecretRef &&
    left.webhookConnectorId === right.webhookConnectorId &&
    left.webhookSecretTokenSecretRef === right.webhookSecretTokenSecretRef &&
    left.outboundEnabled === right.outboundEnabled
  );
}

async function upsertTelegramConnector(input: {
  repository: ChannelConnectorRepository;
  sourceRepository?: SourceIntegrationRepository;
  context: InternalIntegrationContext;
  existingRecord: ChannelConnectorRecord | null;
  connectorId: string;
  displayName: string;
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  diagnostics: InternalTelegramIntegrationDiagnostics;
  status: ChannelConnectorRecord["status"];
  onboardingState?: unknown;
  updatedAt: Date;
}): Promise<void> {
  const sourceConnectionId =
    input.existingRecord?.sourceConnectionId ??
    (input.sourceRepository
      ? createSourceConnectionIdFromConnectorId(
          input.connectorId as ChannelConnectorId
        )
      : null);
  const record: ChannelConnectorRecord = {
    id: input.connectorId as ChannelConnectorId,
    tenantId: input.context.tenantId,
    channelType: telegramChannelType,
    channelClass: telegramChannelClass,
    provider: telegramProvider,
    displayName: input.displayName,
    status: input.status,
    healthStatus: telegramConnectorHealthFromDiagnostics({
      enabled: input.enabled,
      diagnostics: input.diagnostics
    }),
    capabilities: input.existingRecord?.capabilities ?? {
      inbound: true,
      outbound: true,
      attachmentsMetadata: true
    },
    onboardingState:
      input.onboardingState ?? input.existingRecord?.onboardingState ?? {},
    config: input.config,
    diagnostics: input.diagnostics,
    sourceConnectionId,
    createdByEmployeeId:
      input.existingRecord?.createdByEmployeeId ?? input.context.employeeId,
    createdAt: input.existingRecord?.createdAt ?? input.updatedAt,
    updatedAt: input.updatedAt
  };

  await upsertSourceConnectionForChannelConnector({
    context: input.context,
    record,
    sourceRepository: input.sourceRepository
  });
  await input.repository.upsertConnector({
    id: record.id,
    tenantId: record.tenantId,
    channelType: record.channelType,
    channelClass: record.channelClass,
    provider: record.provider,
    displayName: record.displayName,
    status: record.status,
    healthStatus: record.healthStatus,
    capabilities: record.capabilities,
    onboardingState: record.onboardingState,
    config: record.config,
    diagnostics: record.diagnostics,
    sourceConnectionId: record.sourceConnectionId,
    createdByEmployeeId: record.createdByEmployeeId,
    updatedAt: record.updatedAt
  });
}

async function buildTelegramProviderDiagnostics(input: {
  tenantId: TenantId;
  connectorId: string;
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  secretResolver: SecretResolver;
  botApiClientFactory: TelegramBotApiClientFactory;
  egressRuntime: EgressRuntime;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  polling?: InternalTelegramIntegrationDiagnostics["polling"];
  runtime?: InternalTelegramIntegrationDiagnostics["runtime"];
  checkedAt: string;
}): Promise<InternalTelegramIntegrationDiagnostics> {
  const egressResolution = await resolveTelegramEgressProfile({
    egressRuntime: input.egressRuntime,
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    checkedAt: input.checkedAt
  });
  const token = await resolveTelegramBotToken(input);

  if (!token) {
    return buildTelegramDiagnostics({
      enabled: input.enabled,
      config: input.config,
      checkedAt: input.checkedAt,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      status: "invalid_config",
      lastErrorCode: "validation.failed",
      operatorHint: "Bot token secret could not be resolved.",
      polling: input.polling,
      runtime: input.runtime,
      egress: egressResolution.diagnostics,
      checks: {
        botTokenResolved: false,
        botApiReachable: false,
        webhookMatchesConfig: false
      }
    });
  }

  try {
    const client = input.botApiClientFactory({
      apiBaseUrl: input.telegramApiBaseUrl,
      botToken: token,
      egress: buildTelegramBotApiEgressBinding({
        egressRuntime: input.egressRuntime,
        resolution: egressResolution,
        tenantId: input.tenantId,
        connectorId: input.connectorId
      })
    });
    const [bot, webhook] = await Promise.all([
      client.getMe(),
      client.getWebhookInfo()
    ]);
    const expectedUrl = buildTelegramPublicWebhookUrl(
      input.publicWebhookBaseUrl,
      buildTelegramWebhookPath(input.config)
    );
    const webhookMatchesConfig =
      expectedUrl === undefined ? false : webhook.url === expectedUrl;
    const webhookState = telegramWebhookStateDiagnostics({
      config: input.config,
      expectedUrl,
      actualUrl: webhook.url,
      webhookMatchesConfig
    });

    return buildTelegramDiagnostics({
      enabled: input.enabled,
      config: input.config,
      checkedAt: input.checkedAt,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      status: webhookState.status,
      ...(webhookState.operatorHint
        ? { operatorHint: webhookState.operatorHint }
        : {}),
      polling: input.polling,
      runtime: input.runtime,
      bot: {
        id: bot.id,
        username: bot.username,
        firstName: bot.firstName
      },
      egress: egressResolution.diagnostics,
      webhook: {
        expectedUrl,
        actualUrl: webhook.url,
        pendingUpdateCount: webhook.pendingUpdateCount,
        lastErrorAt: webhook.lastErrorAt,
        lastErrorMessage: webhook.lastErrorMessage
      },
      checks: {
        botTokenResolved: true,
        botApiReachable: true,
        webhookMatchesConfig
      }
    });
  } catch (error) {
    return telegramProviderFailureDiagnostics({
      enabled: input.enabled,
      config: input.config,
      checkedAt: input.checkedAt,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      polling: input.polling,
      runtime: input.runtime,
      egress: egressResolution.diagnostics,
      error
    });
  }
}

async function resolveTelegramBotToken(input: {
  tenantId: TenantId;
  config: InternalTelegramIntegrationConfig;
  secretResolver: SecretResolver;
}): Promise<string | null> {
  if (!input.config.botTokenSecretRef) {
    return null;
  }

  return input.secretResolver.resolveSecret({
    tenantId: input.tenantId,
    secretRef: input.config.botTokenSecretRef
  });
}

async function resolveTelegramWebhookSecretToken(input: {
  tenantId: TenantId;
  config: InternalTelegramIntegrationConfig;
  secretResolver: SecretResolver;
}): Promise<string | null> {
  if (!input.config.webhookSecretTokenSecretRef) {
    return null;
  }

  return input.secretResolver.resolveSecret({
    tenantId: input.tenantId,
    secretRef: input.config.webhookSecretTokenSecretRef
  });
}

function telegramWebhookInvalidConfigHint(input: {
  token: string | null;
  expectedUrl: string | undefined;
  webhookSecretToken: string | null;
}): string {
  if (!input.token) {
    return "Bot token secret could not be resolved.";
  }

  if (!input.webhookSecretToken) {
    return "Webhook secret token could not be resolved.";
  }

  return "Public webhook base URL is not configured.";
}

function telegramWebhookStateDiagnostics(input: {
  config: InternalTelegramIntegrationConfig;
  expectedUrl: string | undefined;
  actualUrl: string | undefined;
  webhookMatchesConfig: boolean;
}): Pick<InternalTelegramIntegrationDiagnostics, "status" | "operatorHint"> {
  if (input.config.mode === "webhook" && !input.webhookMatchesConfig) {
    return {
      status: "webhook_mismatch",
      operatorHint:
        input.expectedUrl === undefined
          ? "Public webhook base URL is not configured."
          : "Telegram webhook URL does not match this channel configuration."
    };
  }

  if (
    input.config.mode === "polling" &&
    isActiveTelegramWebhook(input.actualUrl)
  ) {
    return {
      status: "webhook_mismatch",
      operatorHint:
        "Telegram has an active webhook while this channel uses polling. Delete the webhook before polling can receive updates."
    };
  }

  return {
    status: "configured"
  };
}

function isActiveTelegramWebhook(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function telegramProviderFailureDiagnostics(input: {
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  checkedAt: string;
  publicWebhookBaseUrl?: string;
  polling?: InternalTelegramIntegrationDiagnostics["polling"];
  runtime?: InternalTelegramIntegrationDiagnostics["runtime"];
  egress?: InternalTelegramIntegrationDiagnostics["egress"];
  error: unknown;
}): InternalTelegramIntegrationDiagnostics {
  return buildTelegramDiagnostics({
    enabled: input.enabled,
    config: input.config,
    checkedAt: input.checkedAt,
    publicWebhookBaseUrl: input.publicWebhookBaseUrl,
    status: "provider_unreachable",
    lastErrorCode: platformErrorCodeFromTelegramError(input.error),
    operatorHint: buildTelegramProviderFailureOperatorHint({
      error: input.error,
      operation: "diagnostics"
    }),
    polling: input.polling,
    runtime: input.runtime,
    egress: input.egress,
    checks: {
      botTokenResolved: true,
      botApiReachable: false,
      webhookMatchesConfig: false
    }
  });
}

function telegramResponseFromRecord(input: {
  record: ChannelConnectorRecord | null;
  publicWebhookBaseUrl?: string;
  checkedAt: string;
}): InternalTelegramIntegrationResponse {
  if (!input.record?.config) {
    const diagnostics = buildDisabledTelegramDiagnostics(input.checkedAt);

    return {
      moduleId: telegramModuleId,
      enabled: false,
      diagnostics
    };
  }

  try {
    const enabled = isTelegramConnectorEnabled(input.record);
    const config = parseTelegramChannelConfig(input.record.config);
    const diagnostics = buildTelegramDiagnostics({
      enabled,
      config,
      checkedAt: input.checkedAt
    });

    const storedDiagnostics = parseStoredTelegramDiagnostics(
      input.record.diagnostics
    );

    return telegramResponseFromConfig({
      connectorId: input.record.id,
      displayName: input.record.displayName,
      status: input.record.status,
      setupStep: resolveTelegramSetupStep({
        onboardingState: input.record.onboardingState,
        config,
        diagnostics: enabled ? (storedDiagnostics ?? diagnostics) : diagnostics
      }),
      enabled,
      config,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      diagnostics: enabled ? (storedDiagnostics ?? diagnostics) : diagnostics
    });
  } catch {
    return {
      moduleId: telegramModuleId,
      connectorId: input.record.id,
      channelType: telegramChannelType,
      channelClass: telegramChannelClass,
      displayName: input.record.displayName,
      status: internalTelegramConnectorStatus(input.record.status),
      enabled: isTelegramConnectorEnabled(input.record),
      diagnostics: buildInvalidTelegramDiagnostics(input.checkedAt)
    };
  }
}

function channelConnectorSummaryFromRecord(
  record: ChannelConnectorRecord
): InternalChannelConnectorSummary | null {
  const channelType = internalChannelType(record.channelType);
  const channelClass = internalChannelClass(record.channelClass);
  const status = internalChannelConnectorStatus(record.status);
  const healthStatus = internalChannelConnectorHealthStatus(
    record.healthStatus
  );

  if (!channelType || !channelClass || !status || !healthStatus) {
    return null;
  }

  const channelExternalId = readRecordString(
    record.config,
    "channelExternalId"
  );
  const diagnosticsStatus = readRecordString(record.diagnostics, "status");
  const egress = readRecordEgressDiagnostics(record.diagnostics);

  return {
    connectorId: record.id,
    channelType,
    channelClass,
    provider: record.provider,
    displayName: record.displayName,
    status,
    healthStatus,
    ...(channelExternalId ? { channelExternalId } : {}),
    ...(diagnosticsStatus ? { diagnosticsStatus } : {}),
    ...(egress ? { egress } : {})
  };
}

async function withActiveAuthChallenge(input: {
  authChallengeRepository: ChannelAuthChallengeRepository | undefined;
  checkedAt: Date;
  record: ChannelConnectorRecord;
  summary: InternalChannelConnectorSummary;
}): Promise<InternalChannelConnectorSummary> {
  if (
    input.authChallengeRepository === undefined ||
    input.summary.channelClass !== userBridgeChannelClass
  ) {
    return input.summary;
  }

  const activeChallenge =
    await input.authChallengeRepository.findLatestActiveChallenge({
      tenantId: input.record.tenantId,
      connectorId: input.record.id
    });

  if (
    activeChallenge === null ||
    isChannelAuthChallengeExpired(activeChallenge, input.checkedAt)
  ) {
    return input.summary;
  }

  const status = internalChannelAuthChallengeStatus(activeChallenge.status);

  if (status === null) {
    return input.summary;
  }

  return {
    ...input.summary,
    activeAuthChallenge: {
      challengeId: activeChallenge.id,
      challengeType: internalChannelAuthChallengeType(
        activeChallenge.challengeType
      ),
      status,
      ...(activeChallenge.expiresAt
        ? { expiresAt: activeChallenge.expiresAt.toISOString() }
        : {})
    }
  };
}

async function withChannelConnectorListDetails(input: {
  authChallengeRepository: ChannelAuthChallengeRepository | undefined;
  checkedAt: Date;
  record: ChannelConnectorRecord;
  sessionRepository: ChannelSessionRepository | undefined;
  summary: InternalChannelConnectorSummary;
}): Promise<InternalChannelConnectorSummary> {
  const withSession = await withChannelSessionSummary({
    record: input.record,
    sessionRepository: input.sessionRepository,
    summary: input.summary
  });

  return withActiveAuthChallenge({
    authChallengeRepository: input.authChallengeRepository,
    checkedAt: input.checkedAt,
    record: input.record,
    summary: withSession
  });
}

async function withChannelSessionSummary(input: {
  record: ChannelConnectorRecord;
  sessionRepository: ChannelSessionRepository | undefined;
  summary: InternalChannelConnectorSummary;
}): Promise<InternalChannelConnectorSummary> {
  if (
    input.sessionRepository === undefined ||
    input.summary.channelClass !== userBridgeChannelClass
  ) {
    return input.summary;
  }

  const sessionKey =
    readRecordString(input.record.config, "sessionKey") ??
    userBridgePrimarySessionKey;
  const session = await input.sessionRepository.findConnectorSession({
    tenantId: input.record.tenantId,
    connectorId: input.record.id,
    sessionKey
  });

  if (!session) {
    return input.summary;
  }

  return {
    ...input.summary,
    session: channelSessionSummaryFromRecord(session)
  };
}

function channelSessionSummaryFromRecord(
  session: ChannelSessionRecord
): NonNullable<InternalChannelConnectorSummary["session"]> {
  return {
    status: session.status,
    ...(session.displayAddress
      ? { displayAddress: session.displayAddress }
      : {}),
    ...(session.externalAccountId
      ? { externalAccountId: session.externalAccountId }
      : {}),
    ...optionalDateField("lastConnectedAt", session.lastConnectedAt),
    ...optionalDateField("lastDisconnectedAt", session.lastDisconnectedAt),
    ...optionalDateField("lastHeartbeatAt", session.lastHeartbeatAt),
    ...optionalDateField("lastInboundAt", session.lastInboundAt),
    ...optionalDateField("lastOutboundAt", session.lastOutboundAt),
    ...optionalDateField("lastErrorAt", session.lastErrorAt),
    ...(session.lastErrorCode ? { lastErrorCode: session.lastErrorCode } : {}),
    ...(session.lastErrorMessage
      ? { lastErrorMessage: session.lastErrorMessage }
      : {})
  };
}

function optionalDateField<TKey extends string>(
  key: TKey,
  value: Date | null
): { [K in TKey]?: string } {
  return value
    ? ({ [key]: value.toISOString() } as { [K in TKey]: string })
    : {};
}

function internalChannelType(
  value: ChannelConnectorRecord["channelType"]
): InternalChannelType | null {
  switch (value) {
    case "telegram_bot":
    case "telegram_qr_bridge":
    case "whatsapp_qr_bridge":
    case "max_qr_bridge":
    case "max_bot":
    case "vk_community":
      return value as InternalChannelType;
    default:
      return null;
  }
}

function internalChannelClass(
  value: ChannelConnectorRecord["channelClass"]
): InternalChannelClass | null {
  switch (value) {
    case "bot_bridge":
    case "user_bridge":
    case "official_api":
      return value as InternalChannelClass;
    default:
      return null;
  }
}

function internalChannelConnectorStatus(
  value: ChannelConnectorRecord["status"]
): InternalChannelConnectorStatus | null {
  switch (value) {
    case "draft":
    case "onboarding":
    case "authorizing":
    case "connected":
    case "degraded":
    case "reauth_required":
    case "disabled":
    case "failed":
    case "deleted":
      return value as InternalChannelConnectorStatus;
    default:
      return null;
  }
}

function internalChannelConnectorHealthStatus(
  value: ChannelConnectorRecord["healthStatus"]
): InternalChannelConnectorHealthStatus | null {
  switch (value) {
    case "unknown":
    case "healthy":
    case "degraded":
    case "unhealthy":
      return value as InternalChannelConnectorHealthStatus;
    default:
      return null;
  }
}

function readRecordString(input: unknown, key: string): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const value = input[key];

  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readRecordEgressDiagnostics(
  input: unknown
): InternalEgressDiagnostics | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const result = internalEgressDiagnosticsSchema.safeParse(input.egress);

  return result.success ? result.data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function telegramResponseFromConfig(input: {
  connectorId?: string;
  displayName?: string;
  status?: ChannelConnectorRecord["status"];
  setupStep?: InternalTelegramSetupStep;
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  publicWebhookBaseUrl?: string;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): InternalTelegramIntegrationResponse {
  const webhookPath = buildTelegramWebhookPath(input.config);
  const publicWebhookUrl = buildTelegramPublicWebhookUrl(
    input.publicWebhookBaseUrl,
    webhookPath
  );

  return {
    moduleId: telegramModuleId,
    ...(input.connectorId ? { connectorId: input.connectorId } : {}),
    channelType: telegramChannelType,
    channelClass: telegramChannelClass,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.status
      ? { status: internalTelegramConnectorStatus(input.status) }
      : {}),
    ...(input.setupStep ? { setupStep: input.setupStep } : {}),
    enabled: input.enabled,
    config: input.config,
    webhookPath,
    ...(publicWebhookUrl ? { publicWebhookUrl } : {}),
    diagnostics: input.diagnostics
  };
}

function internalTelegramConnectorStatus(
  status: ChannelConnectorRecord["status"]
): InternalTelegramIntegrationResponse["status"] {
  if (
    status === "draft" ||
    status === "onboarding" ||
    status === "authorizing" ||
    status === "connected" ||
    status === "degraded" ||
    status === "reauth_required" ||
    status === "disabled" ||
    status === "failed" ||
    status === "deleted"
  ) {
    return status as InternalTelegramIntegrationResponse["status"];
  }

  return "failed";
}

function isTelegramConnectorEnabled(record: ChannelConnectorRecord): boolean {
  return (
    record.status !== "draft" &&
    record.status !== "onboarding" &&
    record.status !== "authorizing" &&
    record.status !== "disabled" &&
    record.status !== "deleted"
  );
}

function telegramConnectorStatusFromDiagnostics(input: {
  enabled: boolean;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): ChannelConnectorRecord["status"] {
  if (!input.enabled) {
    return "disabled";
  }

  if (input.diagnostics.status === "invalid_config") {
    return "reauth_required";
  }

  if (
    input.diagnostics.status === "provider_unreachable" ||
    input.diagnostics.status === "webhook_mismatch"
  ) {
    return "degraded";
  }

  return "connected";
}

function telegramConnectorStatusFromUpdate(input: {
  existingRecord: ChannelConnectorRecord | null;
  enabled: boolean;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): ChannelConnectorRecord["status"] {
  if (
    !input.enabled &&
    (input.existingRecord?.status === "draft" ||
      input.existingRecord?.status === "onboarding")
  ) {
    return "draft";
  }

  return telegramConnectorStatusFromDiagnostics({
    enabled: input.enabled,
    diagnostics: input.diagnostics
  });
}

function updateTelegramOnboardingState(input: {
  existingState: unknown;
  completedStep?: "name" | "token" | "mode";
}): unknown {
  const existingState = isRecord(input.existingState)
    ? input.existingState
    : {};

  switch (input.completedStep) {
    case "name":
      return {
        ...existingState,
        step: "token"
      };
    case "token":
      return {
        ...existingState,
        step: "mode"
      };
    case "mode":
      return {
        ...existingState,
        step: "diagnostics"
      };
    default:
      return existingState;
  }
}

function resolveTelegramSetupStep(input: {
  onboardingState: unknown;
  config?: InternalTelegramIntegrationConfig;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): InternalTelegramSetupStep {
  if (
    input.config?.mode === "webhook" &&
    input.diagnostics.checks.inboundWebhookReady
  ) {
    return "complete";
  }

  if (
    input.config?.mode === "polling" &&
    input.diagnostics.status === "configured"
  ) {
    return "complete";
  }

  if (
    input.config?.mode === "webhook" &&
    input.diagnostics.checks.botApiReachable === true &&
    !input.diagnostics.checks.inboundWebhookReady
  ) {
    return "webhook";
  }

  const storedStep = readRecordString(input.onboardingState, "step");

  if (isTelegramSetupStep(storedStep)) {
    return storedStep;
  }

  if (!input.config?.botTokenSecretRef) {
    return "token";
  }

  if (input.diagnostics.checks.botApiReachable !== true) {
    return "diagnostics";
  }

  return input.config.mode === "webhook" ? "webhook" : "complete";
}

function isTelegramSetupStep(
  value: string | undefined
): value is InternalTelegramSetupStep {
  return (
    value === "name" ||
    value === "token" ||
    value === "mode" ||
    value === "diagnostics" ||
    value === "webhook" ||
    value === "complete"
  );
}

function telegramConnectorHealthFromDiagnostics(input: {
  enabled: boolean;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): ChannelConnectorRecord["healthStatus"] {
  if (!input.enabled) {
    return "unknown";
  }

  if (input.diagnostics.status === "configured") {
    return "healthy";
  }

  if (
    input.diagnostics.status === "provider_unreachable" ||
    input.diagnostics.status === "webhook_mismatch"
  ) {
    return "degraded";
  }

  return "unhealthy";
}

async function resolveTelegramEgressProfile(input: {
  egressRuntime: EgressRuntime;
  tenantId: TenantId;
  connectorId: string;
  checkedAt: string;
}): Promise<EgressProfileResolution> {
  return input.egressRuntime.resolveProfile({
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    channelType: telegramChannelType,
    provider: telegramProvider,
    requirement: managedMessengerVpnEgressRequirement,
    checkedAt: input.checkedAt
  });
}

function buildTelegramBotApiEgressBinding(input: {
  egressRuntime: EgressRuntime;
  resolution: EgressProfileResolution;
  tenantId: TenantId;
  connectorId: string;
}): TelegramBotApiEgressBinding {
  return {
    runtime: input.egressRuntime,
    resolution: input.resolution,
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    channelType: telegramChannelType,
    provider: telegramProvider
  };
}

function buildTelegramDiagnostics(input: {
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  checkedAt: string;
  publicWebhookBaseUrl?: string;
  status?: InternalTelegramIntegrationDiagnostics["status"];
  lastErrorCode?: PlatformErrorCode;
  operatorHint?: string;
  bot?: InternalTelegramIntegrationDiagnostics["bot"];
  webhook?: InternalTelegramIntegrationDiagnostics["webhook"];
  checks?: Partial<InternalTelegramIntegrationDiagnostics["checks"]>;
  polling?: InternalTelegramIntegrationDiagnostics["polling"];
  runtime?: InternalTelegramIntegrationDiagnostics["runtime"];
  egress?: InternalTelegramIntegrationDiagnostics["egress"];
}): InternalTelegramIntegrationDiagnostics {
  const webhookPath = buildTelegramWebhookPath(input.config);
  const expectedWebhookUrl = buildTelegramPublicWebhookUrl(
    input.publicWebhookBaseUrl,
    webhookPath
  );
  const webhook =
    input.webhook ??
    (expectedWebhookUrl === undefined
      ? undefined
      : {
          expectedUrl: expectedWebhookUrl
        });

  if (!input.enabled) {
    return withOptionalTelegramDiagnostics(
      {
        status: "disabled",
        checkedAt: input.checkedAt,
        checks: {
          moduleEnabled: false,
          configValid: true,
          inboundWebhookReady: false,
          outboundEnabled: input.config.outboundEnabled,
          botTokenSecretRefConfigured: Boolean(input.config.botTokenSecretRef),
          ...input.checks
        }
      },
      {
        lastErrorCode: input.lastErrorCode,
        operatorHint: input.operatorHint,
        bot: input.bot,
        webhook,
        polling: input.polling,
        runtime: input.runtime,
        egress: input.egress ?? buildTelegramEgressDiagnostics(input.checkedAt)
      }
    );
  }

  const webhookMatchesConfig = input.checks?.webhookMatchesConfig;
  const inboundWebhookReady =
    input.config.mode === "webhook" ? webhookMatchesConfig === true : false;

  return withOptionalTelegramDiagnostics(
    {
      status: input.status ?? "configured",
      checkedAt: input.checkedAt,
      checks: {
        moduleEnabled: true,
        configValid: true,
        inboundWebhookReady,
        outboundEnabled: input.config.outboundEnabled,
        botTokenSecretRefConfigured: Boolean(input.config.botTokenSecretRef),
        ...input.checks
      }
    },
    {
      lastErrorCode: input.lastErrorCode,
      operatorHint: input.operatorHint,
      bot: input.bot,
      webhook,
      polling: input.polling,
      runtime: input.runtime,
      egress: input.egress ?? buildTelegramEgressDiagnostics(input.checkedAt)
    }
  );
}

function withOptionalTelegramDiagnostics(
  base: InternalTelegramIntegrationDiagnostics,
  optional: {
    lastErrorCode?: PlatformErrorCode;
    operatorHint?: string;
    bot?: InternalTelegramIntegrationDiagnostics["bot"];
    webhook?: InternalTelegramIntegrationDiagnostics["webhook"];
    polling?: InternalTelegramIntegrationDiagnostics["polling"];
    runtime?: InternalTelegramIntegrationDiagnostics["runtime"];
    egress?: InternalTelegramIntegrationDiagnostics["egress"];
  }
): InternalTelegramIntegrationDiagnostics {
  return {
    ...base,
    ...(optional.lastErrorCode
      ? { lastErrorCode: optional.lastErrorCode }
      : {}),
    ...(optional.operatorHint ? { operatorHint: optional.operatorHint } : {}),
    ...(optional.bot ? { bot: optional.bot } : {}),
    ...(optional.webhook ? { webhook: optional.webhook } : {}),
    ...(optional.polling ? { polling: optional.polling } : {}),
    ...(optional.runtime ? { runtime: optional.runtime } : {}),
    ...(optional.egress ? { egress: optional.egress } : {})
  };
}

function buildTelegramEgressDiagnostics(
  checkedAt: string
): InternalEgressDiagnostics {
  return {
    required: true,
    status: "unknown",
    profileKind: managedMessengerVpnEgressRequirement.defaultProfileKind,
    checkedAt
  };
}

function buildUserBridgeEgressDiagnostics(input: {
  checkedAt: string;
  requirement: InternalChannelCatalogResponse["channels"][number]["egressRequirement"];
}): InternalEgressDiagnostics {
  return {
    required: input.requirement.required,
    status: "unknown",
    profileKind: input.requirement.defaultProfileKind,
    checkedAt: input.checkedAt
  };
}

function buildDisabledTelegramDiagnostics(
  checkedAt: string
): InternalTelegramIntegrationDiagnostics {
  return {
    status: "disabled",
    checkedAt,
    egress: buildTelegramEgressDiagnostics(checkedAt),
    checks: {
      moduleEnabled: false,
      configValid: false,
      inboundWebhookReady: false,
      outboundEnabled: false,
      botTokenSecretRefConfigured: false
    }
  };
}

function buildInvalidTelegramDiagnostics(
  checkedAt: string
): InternalTelegramIntegrationDiagnostics {
  return {
    status: "invalid_config",
    lastErrorCode: "validation.failed" satisfies PlatformErrorCode,
    checkedAt,
    egress: buildTelegramEgressDiagnostics(checkedAt),
    checks: {
      moduleEnabled: true,
      configValid: false,
      inboundWebhookReady: false,
      outboundEnabled: false,
      botTokenSecretRefConfigured: false
    }
  };
}

function parseStoredTelegramDiagnostics(
  input: unknown
): InternalTelegramIntegrationDiagnostics | null {
  const result = internalTelegramIntegrationDiagnosticsSchema.safeParse(input);

  return result.success ? result.data : null;
}

function buildTelegramWebhookPath(
  config: Pick<
    InternalTelegramIntegrationConfig,
    "channelExternalId" | "webhookConnectorId"
  >
): string {
  const connectorId = config.webhookConnectorId ?? config.channelExternalId;

  if (!connectorId) {
    throw new CoreError("validation.failed");
  }

  return `/webhooks/telegram/${encodeURIComponent(connectorId)}`;
}

function buildTelegramPublicWebhookUrl(
  publicWebhookBaseUrl: string | undefined,
  webhookPath: string
): string | undefined {
  if (!publicWebhookBaseUrl) {
    return undefined;
  }

  return new URL(webhookPath, publicWebhookBaseUrl).toString();
}

function platformErrorCodeFromTelegramError(error: unknown): PlatformErrorCode {
  if (error instanceof TelegramAdapterError) {
    return error.code;
  }

  if (
    error instanceof Error &&
    "code" in error &&
    (error.code === "provider.temporary_failure" ||
      error.code === "provider.permanent_failure" ||
      error.code === "validation.failed")
  ) {
    return error.code;
  }

  return "provider.temporary_failure";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
