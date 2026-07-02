import type {
  ChannelClass,
  ChannelConnectorHealthStatus,
  ChannelConnectorId,
  ChannelConnectorStatus,
  ChannelType,
  EmployeeId,
  InternalChannelAuthChallengeStatus,
  InternalChannelAuthChallengeType,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import type {
  ChannelAuthChallengeRecord,
  ChannelAuthChallengeRepository,
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  DeploymentChannelCatalogOverrideRecord,
  DeploymentChannelCatalogOverrideRepository,
  DomainEventRepository,
  FindActiveChannelConnectorByConfigStringInput,
  FindActiveChannelConnectorByExternalIdInput,
  FindChannelAuthChallengeInput,
  FindChannelConnectorInput,
  FindFirstChannelConnectorByTypeInput,
  FindLatestActiveChannelAuthChallengeInput,
  ListActiveChannelConnectorsByTypeInput,
  ListTenantChannelConnectorsInput,
  UpsertChannelAuthChallengeInput,
  UpsertChannelConnectorInput
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  createInternalIntegrationService,
  type InternalIntegrationContext
} from "./internal-integrations-service";

const tenantId = "tenant-integrations" as TenantId;
const context: InternalIntegrationContext = {
  requestId: "request-1",
  tenantId,
  employeeId: "employee-1" as EmployeeId
};
const now = new Date("2026-06-22T10:00:00.000Z");
const telegramEgressDiagnostics = (checkedAt = now.toISOString()) => ({
  required: true as const,
  status: "unknown" as const,
  profileKind: "vpn_namespace" as const,
  checkedAt
});

describe("internal integrations service", () => {
  it("returns channel catalog entries with onboarding flows", async () => {
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      now: () => now
    });

    const response = await service.listChannelCatalog(context);

    expect(response.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelType: "telegram_bot",
          egressRequirement: {
            required: true,
            defaultProfileKind: "vpn_namespace",
            allowedProfileKinds: [
              "vpn_namespace",
              "http_proxy",
              "socks_proxy",
              "customer_network"
            ],
            enforcementScope: "hulee_managed_saas"
          },
          onboarding: {
            version: "v1",
            steps: expect.arrayContaining([
              expect.objectContaining({
                id: "token",
                kind: "secret_text",
                action: "update_connector"
              }),
              expect.objectContaining({
                id: "webhook",
                kind: "webhook_sync",
                action: "sync_webhook",
                required: false
              })
            ])
          }
        }),
        expect.objectContaining({
          channelType: "max_qr_bridge",
          egressRequirement: {
            required: false,
            defaultProfileKind: "direct",
            allowedProfileKinds: [
              "direct",
              "http_proxy",
              "socks_proxy",
              "customer_network"
            ],
            enforcementScope: "deployment_policy"
          },
          onboarding: {
            version: "v1",
            steps: expect.arrayContaining([
              expect.objectContaining({
                id: "phone",
                kind: "phone_number"
              }),
              expect.objectContaining({
                id: "code",
                kind: "verification_code"
              })
            ])
          }
        })
      ])
    );
    expect(
      response.channels.every((channel) => channel.onboarding.steps.length > 0)
    ).toBe(true);
  });

  it("applies deployment channel catalog overrides", async () => {
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      channelCatalogOverrideRepository: fakeChannelCatalogOverrideRepository([
        {
          channelType: "telegram_bot",
          titleOverrides: {
            ru: "Telegram"
          },
          shortDescriptionOverrides: {
            ru: "Telegram bot"
          },
          descriptionOverrides: {
            ru: "Bot channel"
          },
          iconAssetRef: "deployment/channel-icons/telegram_bot/hash.webp",
          sortOrder: 20,
          visibility: "visible",
          readiness: "available",
          updatedAt: now
        },
        {
          channelType: "max_bot",
          titleOverrides: {},
          shortDescriptionOverrides: {},
          descriptionOverrides: {},
          sortOrder: 1,
          visibility: "hidden",
          updatedAt: now
        }
      ]),
      now: () => now
    });

    const response = await service.listChannelCatalog(context);
    const telegram = response.channels.find(
      (channel) => channel.channelType === "telegram_bot"
    );

    expect(telegram).toMatchObject({
      titleOverrides: {
        ru: "Telegram"
      },
      shortDescriptionOverrides: {
        ru: "Telegram bot"
      },
      descriptionOverrides: {
        ru: "Bot channel"
      },
      iconAssetRef: "deployment/channel-icons/telegram_bot/hash.webp",
      iconUrl: "/channel-assets/telegram_bot/icon?v=hash.webp",
      sortOrder: 20,
      visibility: "visible",
      readiness: "available"
    });
    expect(
      response.channels.some((channel) => channel.channelType === "max_bot")
    ).toBe(false);
  });

  it("manages user-bridge auth challenge lifecycle without exposing secrets", async () => {
    const authChallengeRepository =
      new InMemoryChannelAuthChallengeRepository();
    const connectorRepository = new InMemoryChannelConnectorRepository([
      createUserBridgeConnector()
    ]);
    const service = createInternalIntegrationService({
      connectorRepository,
      authChallengeRepository,
      now: () => now
    });

    const startResponse = await service.startChannelAuthChallenge(context, {
      connectorId: "telegram_qr_bridge:tenant-integrations",
      request: {
        challengeType: "phone_code",
        phoneNumber: "+79990000000"
      }
    });
    const secondStartResponse = await service.startChannelAuthChallenge(
      context,
      {
        connectorId: "telegram_qr_bridge:tenant-integrations",
        request: {
          challengeType: "phone_code",
          phoneNumber: "+79990000000"
        }
      }
    );

    expect(startResponse).toMatchObject({
      challenge: {
        connectorId: "telegram_qr_bridge:tenant-integrations",
        challengeType: "phone_code",
        status: "requires_code",
        publicPayload: {
          phoneNumber: "+79990000000"
        }
      }
    });
    expect(secondStartResponse.challenge.challengeId).toBe(
      startResponse.challenge.challengeId
    );
    expect(JSON.stringify(startResponse)).not.toContain("secret");

    await expect(
      service.submitChannelAuthChallenge(context, {
        connectorId: "telegram_qr_bridge:tenant-integrations",
        challengeId: startResponse.challenge.challengeId,
        request: {
          code: "12345"
        }
      })
    ).resolves.toMatchObject({
      challenge: {
        status: "waiting"
      }
    });

    await expect(
      service.cancelChannelAuthChallenge(context, {
        connectorId: "telegram_qr_bridge:tenant-integrations",
        challengeId: startResponse.challenge.challengeId
      })
    ).resolves.toMatchObject({
      challenge: {
        status: "cancelled",
        completedAt: now.toISOString()
      }
    });
  });

  it("creates draft Telegram Bot connectors with server-side identity", async () => {
    const repository = new InMemoryChannelConnectorRepository();
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now,
      webhookConnectorIdFactory: () => "tgwh_created"
    });

    const response = await service.createChannelConnector(context, {
      channelType: "telegram_bot"
    });

    expect(response).toMatchObject({
      connectorId: expect.stringMatching(/^telegram_bot:/),
      channelType: "telegram_bot",
      channelClass: "bot_bridge",
      provider: "telegram",
      displayName: "Telegram Bot",
      status: "draft",
      healthStatus: "unknown",
      diagnosticsStatus: "disabled"
    });
    expect(repository.records.get(response.connectorId)).toEqual(
      expect.objectContaining({
        id: response.connectorId,
        tenantId,
        status: "draft",
        healthStatus: "unknown",
        config: expect.objectContaining({
          mode: "webhook",
          webhookConnectorId: "tgwh_created",
          outboundEnabled: false
        }),
        createdByEmployeeId: context.employeeId
      })
    );
  });

  it("disables, enables and soft-deletes tenant channel connectors", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "secret:telegram",
          outboundEnabled: false
        },
        diagnostics: {
          status: "configured",
          checkedAt: now.toISOString(),
          checks: {
            moduleEnabled: true,
            configValid: true,
            inboundWebhookReady: false,
            outboundEnabled: false,
            botTokenSecretRefConfigured: true
          }
        }
      })
    ]);
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now
    });

    await expect(
      service.disableChannelConnector(context, {
        connectorId: "telegram_bot:tenant-integrations"
      })
    ).resolves.toMatchObject({
      connectorId: "telegram_bot:tenant-integrations",
      status: "disabled",
      healthStatus: "unknown",
      diagnosticsStatus: "disabled"
    });
    expect(
      repository.records.get("telegram_bot:tenant-integrations")
    ).toMatchObject({
      status: "disabled",
      healthStatus: "unknown",
      diagnostics: {
        status: "disabled"
      }
    });

    await expect(
      service.enableChannelConnector(context, {
        connectorId: "telegram_bot:tenant-integrations"
      })
    ).resolves.toMatchObject({
      connectorId: "telegram_bot:tenant-integrations",
      status: "connected",
      healthStatus: "healthy",
      diagnosticsStatus: "configured"
    });
    expect(
      repository.records.get("telegram_bot:tenant-integrations")
    ).toMatchObject({
      status: "connected",
      healthStatus: "healthy",
      diagnostics: {
        status: "configured",
        checks: {
          moduleEnabled: true,
          botTokenSecretRefConfigured: true
        }
      }
    });

    await expect(
      service.deleteChannelConnector(context, {
        connectorId: "telegram_bot:tenant-integrations"
      })
    ).resolves.toMatchObject({
      connectorId: "telegram_bot:tenant-integrations",
      status: "deleted",
      healthStatus: "unknown",
      diagnosticsStatus: "disabled"
    });
    expect(
      repository.records.get("telegram_bot:tenant-integrations")
    ).toMatchObject({
      status: "deleted",
      healthStatus: "unknown"
    });
  });

  it("returns disabled Telegram integration when no tenant module row exists", async () => {
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      now: () => now
    });

    await expect(service.loadTelegramIntegration(context)).resolves.toEqual({
      moduleId: "channel-telegram",
      enabled: false,
      diagnostics: {
        status: "disabled",
        checkedAt: now.toISOString(),
        egress: telegramEgressDiagnostics(),
        checks: {
          moduleEnabled: false,
          configValid: false,
          inboundWebhookReady: false,
          outboundEnabled: false,
          botTokenSecretRefConfigured: false
        }
      }
    });
  });

  it("updates selected Telegram connector config and returns safe diagnostics", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {},
        diagnostics: {},
        status: "draft"
      })
    ]);
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now,
      webhookConnectorIdFactory: () => "tgwh_test"
    });

    const response = await service.updateTelegramIntegration(context, {
      connectorId: "telegram_bot:tenant-integrations",
      enabled: true,
      channelExternalId: "telegram-local",
      mode: "webhook",
      botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: true
    });

    expect(response).toEqual({
      moduleId: "channel-telegram",
      connectorId: "telegram_bot:tenant-integrations",
      channelType: "telegram_bot",
      channelClass: "bot_bridge",
      displayName: "Telegram Bot",
      status: "connected",
      setupStep: "diagnostics",
      enabled: true,
      config: {
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        webhookConnectorId: "tgwh_test",
        outboundEnabled: true
      },
      webhookPath: "/webhooks/telegram/tgwh_test",
      diagnostics: {
        status: "configured",
        checkedAt: now.toISOString(),
        egress: telegramEgressDiagnostics(),
        checks: {
          moduleEnabled: true,
          configValid: true,
          inboundWebhookReady: false,
          outboundEnabled: true,
          botTokenSecretRefConfigured: true
        }
      }
    });
    expect(repository.records.get("telegram_bot:tenant-integrations")).toEqual(
      expect.objectContaining({
        id: "telegram_bot:tenant-integrations",
        tenantId,
        channelType: "telegram_bot",
        channelClass: "bot_bridge",
        provider: "telegram",
        status: "connected",
        config: response.config,
        diagnostics: response.diagnostics
      })
    );
  });

  it("validates Telegram bot tokens through provider egress without persisting connectors", async () => {
    const repository = new InMemoryChannelConnectorRepository();
    const botApiClientFactory = vi.fn(() => ({
      async sendTextMessage() {
        return {
          messageId: "1",
          chatId: "1",
          raw: {}
        };
      },
      async getMe() {
        return {
          id: "100",
          username: "hulee_test_bot",
          raw: {}
        };
      },
      async getWebhookInfo() {
        return {
          url: "",
          pendingUpdateCount: 0,
          raw: {}
        };
      },
      async getUpdates() {
        return [];
      },
      async getFile() {
        return {
          fileId: "telegram-file-1",
          filePath: "photos/file-1.jpg",
          raw: {}
        };
      },
      async downloadFile() {
        return new Uint8Array();
      },
      async setWebhook() {},
      async deleteWebhook() {}
    }));
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      botApiClientFactory,
      now: () => now
    });

    await expect(
      service.validateTelegramBotToken(context, {
        botToken: "123456789:AAExampleTokenValue_000000000000000000"
      })
    ).resolves.toEqual({
      bot: {
        id: "100",
        username: "hulee_test_bot"
      }
    });
    expect(botApiClientFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        botToken: "123456789:AAExampleTokenValue_000000000000000000",
        egress: expect.objectContaining({
          tenantId,
          channelType: "telegram_bot",
          provider: "telegram",
          resolution: expect.objectContaining({
            profileKind: "vpn_namespace"
          })
        })
      })
    );
    expect(repository.records.size).toBe(0);
  });

  it("advances draft Telegram setup steps before activation", async () => {
    const repository = new InMemoryChannelConnectorRepository();
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now,
      webhookConnectorIdFactory: () => "tgwh_test"
    });

    const draft = await service.createChannelConnector(context, {
      channelType: "telegram_bot"
    });

    const nameStep = await service.updateTelegramIntegration(context, {
      connectorId: draft.connectorId,
      displayName: "Sales Telegram",
      enabled: false,
      setupStepCompleted: "name",
      channelExternalId: "telegram-local",
      mode: "webhook",
      outboundEnabled: false
    });

    expect(nameStep).toMatchObject({
      connectorId: draft.connectorId,
      displayName: "Sales Telegram",
      status: "draft",
      enabled: false,
      setupStep: "token"
    });

    const tokenStep = await service.updateTelegramIntegration(context, {
      connectorId: draft.connectorId,
      displayName: "Sales Telegram",
      enabled: false,
      setupStepCompleted: "token",
      channelExternalId: "telegram-local",
      mode: "webhook",
      botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: false
    });

    expect(tokenStep).toMatchObject({
      connectorId: draft.connectorId,
      status: "draft",
      enabled: false,
      setupStep: "mode",
      config: {
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN"
      }
    });
    expect(repository.records.get(draft.connectorId)).toMatchObject({
      status: "draft",
      onboardingState: {
        step: "mode"
      }
    });
  });

  it("stores Telegram bot tokens in tenant secret storage and only keeps a secret ref in config", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {},
        diagnostics: {},
        status: "draft"
      })
    ]);
    const secretWriter = new InMemorySecretWriter();
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      secretWriter,
      now: () => now,
      webhookConnectorIdFactory: () => "tgwh_test",
      webhookSecretTokenFactory: () => "raw-telegram-webhook-secret-value"
    });

    const response = await service.updateTelegramIntegration(context, {
      connectorId: "telegram_bot:tenant-integrations",
      enabled: true,
      channelExternalId: "telegram-local",
      mode: "webhook",
      botToken: "telegram-token-1",
      outboundEnabled: true
    });

    expect(secretWriter.upserts).toEqual([
      {
        tenantId,
        secretRef:
          "secret:tenant-integrations/channels/telegram_bot:tenant-integrations/bot-token",
        purpose: "telegram.bot_token",
        plainText: "telegram-token-1",
        updatedAt: now
      },
      {
        tenantId,
        secretRef:
          "secret:tenant-integrations/channels/telegram_bot:tenant-integrations/webhook-secret-token",
        purpose: "telegram.webhook_secret_token",
        plainText: "raw-telegram-webhook-secret-value",
        updatedAt: now
      }
    ]);
    expect(response.config?.botTokenSecretRef).toBe(
      "secret:tenant-integrations/channels/telegram_bot:tenant-integrations/bot-token"
    );
    expect(response.config?.webhookConnectorId).toBe("tgwh_test");
    expect(response.config?.webhookSecretTokenSecretRef).toBe(
      "secret:tenant-integrations/channels/telegram_bot:tenant-integrations/webhook-secret-token"
    );
    expect(JSON.stringify(response)).not.toContain("telegram-token-1");
    expect(JSON.stringify(response)).not.toContain(
      "raw-telegram-webhook-secret-value"
    );
    expect(
      JSON.stringify(repository.records.get("telegram_bot:tenant-integrations"))
    ).not.toContain("telegram-token-1");
  });

  it("does not fall back to the first Telegram connector when none is selected", async () => {
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository([
        createTelegramConnector({
          config: {
            channelExternalId: "telegram-local",
            mode: "webhook",
            outboundEnabled: false
          },
          diagnostics: {}
        })
      ]),
      now: () => now
    });

    await expect(service.loadTelegramIntegration(context)).resolves.toEqual({
      moduleId: "channel-telegram",
      enabled: false,
      diagnostics: {
        status: "disabled",
        checkedAt: now.toISOString(),
        egress: telegramEgressDiagnostics(),
        checks: {
          moduleEnabled: false,
          configValid: false,
          inboundWebhookReady: false,
          outboundEnabled: false,
          botTokenSecretRefConfigured: false
        }
      }
    });
  });

  it("returns invalid diagnostics for malformed stored Telegram config", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {
          outboundEnabled: true
        },
        diagnostics: {}
      })
    ]);
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now
    });

    await expect(
      service.loadTelegramIntegration(context, {
        connectorId: "telegram_bot:tenant-integrations"
      })
    ).resolves.toMatchObject({
      moduleId: "channel-telegram",
      enabled: true,
      diagnostics: {
        status: "invalid_config",
        lastErrorCode: "validation.failed",
        checks: {
          configValid: false
        }
      }
    });
  });

  it("loads Telegram integration by selected connector id", async () => {
    const first = createTelegramConnector({
      config: {
        channelExternalId: "telegram-first",
        mode: "webhook",
        outboundEnabled: false
      },
      diagnostics: {}
    });
    const second = {
      ...createTelegramConnector({
        config: {
          channelExternalId: "telegram-second",
          mode: "polling",
          outboundEnabled: false
        },
        diagnostics: {}
      }),
      id: "telegram_bot:second" as ChannelConnectorId,
      displayName: "Telegram Bot Second"
    };
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository([
        first,
        second
      ]),
      now: () => now
    });

    await expect(
      service.loadTelegramIntegration(context, {
        connectorId: "telegram_bot:second"
      })
    ).resolves.toMatchObject({
      connectorId: "telegram_bot:second",
      displayName: "Telegram Bot Second",
      config: {
        channelExternalId: "telegram-second",
        mode: "polling"
      }
    });
  });

  it("refreshes Telegram provider diagnostics without exposing the bot token", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          webhookConnectorId: "tgwh_test",
          outboundEnabled: true
        },
        diagnostics: {}
      })
    ]);
    const botApiClientFactory = vi.fn(() => ({
      async sendTextMessage() {
        return {
          messageId: "1",
          chatId: "1",
          raw: {}
        };
      },
      async getMe() {
        return {
          id: "100",
          username: "hulee_test_bot",
          raw: {}
        };
      },
      async getWebhookInfo() {
        return {
          url: "https://example.test/webhooks/telegram/tgwh_test",
          pendingUpdateCount: 0,
          raw: {}
        };
      },
      async getUpdates() {
        return [];
      },
      async getFile() {
        return {
          fileId: "telegram-file-1",
          filePath: "photos/file-1.jpg",
          raw: {}
        };
      },
      async downloadFile() {
        return new Uint8Array();
      },
      async setWebhook() {},
      async deleteWebhook() {}
    }));
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now,
      publicWebhookBaseUrl: "https://example.test/",
      secretResolver: {
        async resolveSecret() {
          return "token-1";
        }
      },
      botApiClientFactory
    });

    const response = await service.refreshTelegramDiagnostics(context, {
      connectorId: "telegram_bot:tenant-integrations"
    });

    expect(response).toMatchObject({
      publicWebhookUrl: "https://example.test/webhooks/telegram/tgwh_test",
      displayName: "Telegram Bot (@hulee_test_bot)",
      diagnostics: {
        status: "configured",
        bot: {
          id: "100",
          username: "hulee_test_bot"
        },
        webhook: {
          expectedUrl: "https://example.test/webhooks/telegram/tgwh_test",
          actualUrl: "https://example.test/webhooks/telegram/tgwh_test",
          pendingUpdateCount: 0
        },
        checks: {
          botTokenResolved: true,
          botApiReachable: true,
          webhookMatchesConfig: true,
          inboundWebhookReady: true
        }
      }
    });
    expect(JSON.stringify(response)).not.toContain("token-1");
    expect(botApiClientFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        botToken: "token-1",
        egress: expect.objectContaining({
          tenantId,
          connectorId: "telegram_bot:tenant-integrations",
          channelType: "telegram_bot",
          provider: "telegram",
          resolution: expect.objectContaining({
            profileKind: "vpn_namespace"
          })
        })
      })
    );
    expect(
      repository.records.get("telegram_bot:tenant-integrations")?.diagnostics
    ).toEqual(response.diagnostics);
    expect(
      repository.records.get("telegram_bot:tenant-integrations")?.displayName
    ).toBe("Telegram Bot (@hulee_test_bot)");
  });

  it("reports active Telegram webhooks as a polling diagnostics conflict", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {
          channelExternalId: "telegram-local",
          mode: "polling",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          webhookConnectorId: "tgwh_test",
          outboundEnabled: true
        },
        diagnostics: {}
      })
    ]);
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now,
      publicWebhookBaseUrl: "https://example.test/",
      secretResolver: {
        async resolveSecret() {
          return "token-1";
        }
      },
      botApiClientFactory: () => ({
        async sendTextMessage() {
          return {
            messageId: "1",
            chatId: "1",
            raw: {}
          };
        },
        async getMe() {
          return {
            id: "100",
            raw: {}
          };
        },
        async getWebhookInfo() {
          return {
            url: "https://example.test/webhooks/telegram/old-webhook",
            pendingUpdateCount: 2,
            raw: {}
          };
        },
        async getUpdates() {
          return [];
        },
        async getFile() {
          return {
            fileId: "telegram-file-1",
            filePath: "photos/file-1.jpg",
            raw: {}
          };
        },
        async downloadFile() {
          return new Uint8Array();
        },
        async setWebhook() {},
        async deleteWebhook() {}
      })
    });

    const response = await service.refreshTelegramDiagnostics(context, {
      connectorId: "telegram_bot:tenant-integrations"
    });

    expect(response.diagnostics).toMatchObject({
      status: "webhook_mismatch",
      operatorHint:
        "Telegram has an active webhook while this channel uses polling. Delete the webhook before polling can receive updates.",
      webhook: {
        actualUrl: "https://example.test/webhooks/telegram/old-webhook"
      },
      checks: {
        botApiReachable: true,
        webhookMatchesConfig: false
      }
    });
    expect(response.status).toBe("degraded");
    expect(
      repository.records.get("telegram_bot:tenant-integrations")?.healthStatus
    ).toBe("degraded");
  });

  it("sets Telegram webhook to the public tenant callback URL", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          webhookConnectorId: "tgwh_test",
          webhookSecretTokenSecretRef:
            "secret:tenant-integrations/channels/telegram_bot:tenant-integrations/webhook-secret-token",
          outboundEnabled: true
        },
        diagnostics: {}
      })
    ]);
    const setWebhookCalls: {
      url: string;
      secretToken: string | undefined;
    }[] = [];
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now,
      publicWebhookBaseUrl: "https://example.test/",
      secretResolver: {
        async resolveSecret({ secretRef }) {
          return secretRef.includes("webhook-secret-token")
            ? "webhook-secret"
            : "token-1";
        }
      },
      botApiClientFactory() {
        return {
          async sendTextMessage() {
            return {
              messageId: "1",
              chatId: "1",
              raw: {}
            };
          },
          async getMe() {
            return {
              id: "100",
              raw: {}
            };
          },
          async getWebhookInfo() {
            return {
              url: "https://example.test/webhooks/telegram/tgwh_test",
              pendingUpdateCount: 0,
              raw: {}
            };
          },
          async getUpdates() {
            return [];
          },
          async getFile() {
            return {
              fileId: "telegram-file-1",
              filePath: "photos/file-1.jpg",
              raw: {}
            };
          },
          async downloadFile() {
            return new Uint8Array();
          },
          async setWebhook(input) {
            setWebhookCalls.push({
              url: input.url,
              secretToken: input.secretToken
            });
          },
          async deleteWebhook() {}
        };
      }
    });

    const response = await service.setTelegramWebhook(context, {
      connectorId: "telegram_bot:tenant-integrations"
    });

    expect(setWebhookCalls).toEqual([
      {
        url: "https://example.test/webhooks/telegram/tgwh_test",
        secretToken: "webhook-secret"
      }
    ]);
    expect(response.diagnostics.status).toBe("configured");
  });

  it("queues Telegram provider operations when an outbox event repository is configured", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          webhookConnectorId: "tgwh_test",
          webhookSecretTokenSecretRef:
            "secret:tenant-integrations/channels/telegram_bot:tenant-integrations/webhook-secret-token",
          outboundEnabled: true
        },
        diagnostics: {
          status: "configured",
          checkedAt: now.toISOString(),
          egress: telegramEgressDiagnostics(),
          checks: {
            moduleEnabled: true,
            configValid: true,
            inboundWebhookReady: false,
            outboundEnabled: true,
            botTokenSecretRefConfigured: true
          }
        }
      })
    ]);
    const events = new InMemoryDomainEventRepository();
    const botApiClientFactory = vi.fn();
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      providerOperationEvents: events,
      now: () => now,
      publicWebhookBaseUrl: "https://example.test/",
      botApiClientFactory
    });

    const response = await service.setTelegramWebhook(context, {
      connectorId: "telegram_bot:tenant-integrations"
    });

    expect(botApiClientFactory).not.toHaveBeenCalled();
    expect(events.events).toEqual([
      expect.objectContaining({
        type: "channel.provider_operation.requested",
        tenantId,
        idempotencyKey:
          "request-1:telegram_bot:tenant-integrations:telegram.webhook.set",
        payload: {
          connectorId: "telegram_bot:tenant-integrations",
          channelType: "telegram_bot",
          provider: "telegram",
          operation: "telegram.webhook.set",
          actorEmployeeId: context.employeeId
        }
      })
    ]);
    expect(response.diagnostics.operatorHint).toBeUndefined();
    expect(
      repository.records.get("telegram_bot:tenant-integrations")?.diagnostics
    ).toEqual(response.diagnostics);
  });

  it("reports invalid Telegram diagnostics when the token secret cannot be resolved", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          outboundEnabled: true
        },
        diagnostics: {}
      })
    ]);
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now,
      publicWebhookBaseUrl: "https://example.test/",
      secretResolver: {
        async resolveSecret() {
          return null;
        }
      }
    });

    const response = await service.refreshTelegramDiagnostics(context, {
      connectorId: "telegram_bot:tenant-integrations"
    });

    expect(response.diagnostics).toMatchObject({
      status: "invalid_config",
      lastErrorCode: "validation.failed",
      checks: {
        botTokenResolved: false,
        botApiReachable: false,
        webhookMatchesConfig: false
      }
    });
  });
});

class InMemoryChannelConnectorRepository implements ChannelConnectorRepository {
  readonly records = new Map<string, ChannelConnectorRecord>();

  constructor(records: readonly ChannelConnectorRecord[] = []) {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async findConnector(
    input: FindChannelConnectorInput
  ): Promise<ChannelConnectorRecord | null> {
    const record = this.records.get(String(input.connectorId)) ?? null;

    return record?.tenantId === input.tenantId ? record : null;
  }

  async findFirstConnectorByType(
    input: FindFirstChannelConnectorByTypeInput
  ): Promise<ChannelConnectorRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.channelType === input.channelType &&
          (input.includeDeleted || record.status !== "deleted")
      ) ?? null
    );
  }

  async listActiveConnectorsByType(
    input: ListActiveChannelConnectorsByTypeInput
  ): Promise<ChannelConnectorRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.channelType === input.channelType &&
        (record.status === "connected" || record.status === "degraded")
    );
  }

  async listTenantConnectors(
    input: ListTenantChannelConnectorsInput
  ): Promise<ChannelConnectorRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.tenantId === input.tenantId &&
        (input.includeDeleted || record.status !== "deleted")
    );
  }

  async findActiveConnectorByConfigString(
    input: FindActiveChannelConnectorByConfigStringInput
  ): Promise<ChannelConnectorRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.channelType === input.channelType &&
          record.status !== "disabled" &&
          record.status !== "deleted" &&
          isRecord(record.config) &&
          record.config[input.configKey] === input.configValue
      ) ?? null
    );
  }

  async findActiveConnectorByExternalId(
    input: FindActiveChannelConnectorByExternalIdInput
  ): Promise<ChannelConnectorRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.channelType === input.channelType &&
          record.status !== "disabled" &&
          record.status !== "deleted" &&
          isRecord(record.config) &&
          record.config.channelExternalId === input.channelExternalId
      ) ?? null
    );
  }

  async upsertConnector(input: UpsertChannelConnectorInput): Promise<void> {
    const existing = this.records.get(String(input.id));
    const updatedAt = input.updatedAt;

    this.records.set(String(input.id), {
      id: String(input.id) as ChannelConnectorId,
      tenantId: input.tenantId,
      channelType: input.channelType as ChannelType,
      channelClass: input.channelClass as ChannelClass,
      provider: input.provider,
      displayName: input.displayName,
      status: input.status as ChannelConnectorStatus,
      healthStatus: input.healthStatus as ChannelConnectorHealthStatus,
      capabilities: input.capabilities ?? {},
      onboardingState: input.onboardingState ?? {},
      config: input.config ?? {},
      diagnostics: input.diagnostics ?? {},
      createdByEmployeeId: input.createdByEmployeeId ?? null,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    });
  }
}

class InMemoryChannelAuthChallengeRepository implements ChannelAuthChallengeRepository {
  readonly records = new Map<string, ChannelAuthChallengeRecord>();

  async findChallenge(
    input: FindChannelAuthChallengeInput
  ): Promise<ChannelAuthChallengeRecord | null> {
    const record = this.records.get(input.challengeId) ?? null;

    return record?.tenantId === input.tenantId ? record : null;
  }

  async findLatestActiveChallenge(
    input: FindLatestActiveChannelAuthChallengeInput
  ): Promise<ChannelAuthChallengeRecord | null> {
    return (
      [...this.records.values()]
        .filter(
          (record) =>
            record.tenantId === input.tenantId &&
            record.connectorId === input.connectorId &&
            (!input.challengeType ||
              record.challengeType === input.challengeType) &&
            (record.status === "pending" ||
              record.status === "waiting" ||
              record.status === "requires_code" ||
              record.status === "requires_password")
        )
        .sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
        )[0] ?? null
    );
  }

  async upsertChallenge(input: UpsertChannelAuthChallengeInput): Promise<void> {
    const existing = this.records.get(input.id);
    const updatedAt = input.updatedAt;

    this.records.set(input.id, {
      id: input.id,
      tenantId: input.tenantId,
      connectorId: String(input.connectorId) as ChannelConnectorId,
      challengeType: input.challengeType as InternalChannelAuthChallengeType,
      status: input.status as InternalChannelAuthChallengeStatus,
      publicPayload: input.publicPayload ?? {},
      secretPayloadEncrypted: input.secretPayloadEncrypted ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      expiresAt: input.expiresAt ?? null,
      completedAt: input.completedAt ?? null,
      createdByEmployeeId: input.createdByEmployeeId ?? null,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    });
  }
}

function fakeChannelCatalogOverrideRepository(
  overrides: readonly DeploymentChannelCatalogOverrideRecord[]
): DeploymentChannelCatalogOverrideRepository {
  return {
    async listOverrides() {
      return [...overrides];
    },
    async findOverride(channelType) {
      return (
        overrides.find((override) => override.channelType === channelType) ??
        null
      );
    },
    async upsertOverride() {
      return undefined;
    }
  };
}

class InMemoryDomainEventRepository implements DomainEventRepository {
  readonly events: PlatformEvent[] = [];

  async append(input: {
    tenantId: TenantId;
    events: readonly PlatformEvent[];
  }): Promise<void> {
    expect(
      input.events.every((event) => event.tenantId === input.tenantId)
    ).toBe(true);
    this.events.push(...input.events);
  }
}

class InMemorySecretWriter {
  readonly upserts: {
    tenantId: TenantId;
    secretRef: string;
    purpose: "telegram.bot_token" | "telegram.webhook_secret_token";
    plainText: string;
    updatedAt: Date;
  }[] = [];

  async upsertSecret(input: {
    tenantId: TenantId;
    secretRef: string;
    purpose: "telegram.bot_token" | "telegram.webhook_secret_token";
    plainText: string;
    updatedAt: Date;
  }): Promise<void> {
    this.upserts.push(input);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createTelegramConnector(input: {
  config: unknown;
  diagnostics: unknown;
  status?: ChannelConnectorStatus;
}): ChannelConnectorRecord {
  return {
    id: "telegram_bot:tenant-integrations" as ChannelConnectorId,
    tenantId,
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    provider: "telegram",
    displayName: "Telegram Bot",
    status: input.status ?? "connected",
    healthStatus: "unknown",
    capabilities: {},
    onboardingState: {},
    config: input.config,
    diagnostics: input.diagnostics,
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}

function createUserBridgeConnector(): ChannelConnectorRecord {
  return {
    id: "telegram_qr_bridge:tenant-integrations" as ChannelConnectorId,
    tenantId,
    channelType: "telegram_qr_bridge",
    channelClass: "user_bridge",
    provider: "telegram",
    displayName: "Telegram personal",
    status: "onboarding",
    healthStatus: "unknown",
    capabilities: {},
    onboardingState: {
      step: "qr"
    },
    config: {},
    diagnostics: {},
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}
