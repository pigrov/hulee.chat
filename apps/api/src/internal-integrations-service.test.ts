import type {
  ChannelClass,
  ChannelConnectorHealthStatus,
  ChannelConnectorId,
  ChannelConnectorStatus,
  ChannelType,
  EmployeeId,
  InternalChannelAuthChallengeStatus,
  InternalChannelAuthChallengeType,
  PlatformErrorCode,
  PlatformEvent,
  SourceCatalogItem,
  SourceConnectionId,
  TenantId
} from "@hulee/contracts";
import {
  findSourceCatalogItem,
  inboxV2AuthorizationEpochSchema
} from "@hulee/contracts";
import type {
  ChannelAuthChallengeRecord,
  ChannelAuthChallengeRepository,
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  ChannelSessionRecord,
  ChannelSessionRepository,
  ChannelSessionEventRecord,
  AppendChannelSessionEventInput,
  ChannelProviderValidationJobRecord,
  ChannelProviderValidationJobRepository,
  DeploymentChannelCatalogOverrideRecord,
  DeploymentChannelCatalogOverrideRepository,
  DomainEventRepository,
  FindSourceConnectionInput,
  FindActiveChannelConnectorByConfigStringInput,
  FindActiveChannelConnectorByExternalIdInput,
  FindChannelAuthChallengeInput,
  FindChannelConnectorInput,
  FindChannelSessionInput,
  FindConnectorChannelSessionInput,
  FindChannelProviderValidationJobInput,
  FindFirstChannelConnectorByTypeInput,
  FindLatestActiveChannelAuthChallengeInput,
  ListActiveChannelAuthChallengesInput,
  ListChannelSessionEventsInput,
  ListRunnableChannelSessionsInput,
  ClaimChannelSessionLeaseInput,
  ReleaseChannelSessionLeaseInput,
  ListActiveChannelConnectorsByTypeInput,
  ListTenantSourceConnectionsInput,
  ListTenantChannelConnectorsInput,
  InboxV2SourceRegistryRepository,
  NormalizedInboundEventRecord,
  RawInboundEventRecord,
  RecordNormalizedInboundEventInput,
  RecordRawInboundEventInput,
  SourceAccountRecord,
  SourceConnectionRecord,
  SourceIntegrationRepository,
  UpsertChannelAuthChallengeInput,
  UpsertChannelSessionInput,
  UpsertChannelConnectorInput,
  UpsertChannelProviderValidationJobInput,
  UpsertSourceAccountInput,
  UpsertSourceConnectionInput
} from "@hulee/db";
import type {
  SourceAdapterRegistry,
  SourceAdapterTransientSecretWrite
} from "@hulee/modules";
import { createSourceAdapterRegistry } from "@hulee/modules";
import { describe, expect, it, vi } from "vitest";

import {
  createInternalIntegrationService,
  type InternalIntegrationContext
} from "./internal-integrations-service";
import {
  createSourceAdapterOnboardingPrepareInput,
  createSourceRegistryOnboardingUnitOfWork,
  type SourceOnboardingAuthorizationResolver,
  type SourceRegistryOnboardingUnitOfWork
} from "./source-registry-onboarding";
import { createTestMegaPbxSourceAdapterRegistry } from "./test-support/source-adapter-registry-fixture";

const tenantId = "tenant-integrations" as TenantId;
const context: InternalIntegrationContext = {
  requestId: "request-1",
  tenantId,
  employeeId: "employee-1" as EmployeeId
};
const now = new Date("2026-06-22T10:00:00.000Z");
const fakeAuthChallengeCipher = {
  encrypt(plainText: string): string {
    return `sealed:${Buffer.from(plainText, "utf8").toString("base64url")}`;
  },
  decrypt(sealedValue: string): string {
    return Buffer.from(
      sealedValue.replace(/^sealed:/, ""),
      "base64url"
    ).toString("utf8");
  }
};
const telegramEgressDiagnostics = (checkedAt = now.toISOString()) => ({
  required: true as const,
  status: "unknown" as const,
  profileKind: "vpn_namespace" as const,
  checkedAt
});
const directEgressDiagnostics = (checkedAt = now.toISOString()) => ({
  required: false as const,
  status: "unknown" as const,
  profileKind: "direct" as const,
  checkedAt
});

function availableMegaPbxCatalogItemResolver(
  sourceName: string
): SourceCatalogItem | undefined {
  const source = findSourceCatalogItem(sourceName);

  return source?.sourceName === "megapbx"
    ? {
        ...source,
        readiness: "available"
      }
    : undefined;
}

function structuralFakeSourceAdapterRegistry(): SourceAdapterRegistry {
  return {
    get: vi.fn(() => null),
    getRegistration: vi.fn(() => null),
    getIngressHandler: vi.fn(() => null),
    listSourceNames: vi.fn(() => [])
  };
}

type SourceOnboardingAuthorization = Exclude<
  Awaited<
    ReturnType<
      SourceOnboardingAuthorizationResolver["resolveSourceOnboardingAuthorization"]
    >
  >,
  null
>;

function currentSourceOnboardingAuthorizationResolver(
  transform?: (
    authorization: SourceOnboardingAuthorization
  ) => SourceOnboardingAuthorization
): SourceOnboardingAuthorizationResolver {
  return {
    async resolveSourceOnboardingAuthorization(input) {
      const authorization: SourceOnboardingAuthorization = {
        actor: {
          kind: "employee",
          employee: {
            tenantId: input.tenantId,
            kind: "employee",
            id: input.employeeId
          },
          authorizationEpoch: inboxV2AuthorizationEpochSchema.parse(
            "authorization:source-onboarding-current"
          )
        },
        decision: {
          tenantId: input.tenantId,
          principal: {
            kind: "employee",
            employee: {
              tenantId: input.tenantId,
              kind: "employee",
              id: input.employeeId
            }
          },
          resource: { kind: "tenant", tenantId: input.tenantId },
          authorizationEpoch: "authorization:source-onboarding-current",
          permissionId: "modules.manage",
          outcome: "allowed",
          decidedAt: new Date(
            input.requestedAt.getTime() - 1_000
          ).toISOString(),
          notAfter: new Date(input.requestedAt.getTime() + 60_000).toISOString()
        }
      };

      return transform?.(authorization) ?? authorization;
    }
  };
}

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
      createUserBridgeConnector({
        channelType: "max_qr_bridge",
        provider: "max",
        connectorId: "max_qr_bridge:tenant-integrations" as ChannelConnectorId,
        displayName: "MAX personal",
        onboardingStep: "phone"
      })
    ]);
    const channelSessionRepository = new InMemoryChannelSessionRepository();
    await channelSessionRepository.upsertSession({
      id: "channel_session:max-primary",
      tenantId,
      connectorId: "max_qr_bridge:tenant-integrations",
      sessionKey: "primary",
      status: "pending_auth",
      sessionEncrypted: "sealed:session",
      publicState: {
        stage: "code_sent"
      },
      challengeType: "phone_code",
      challengeExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      lastHeartbeatAt: now,
      updatedAt: now
    });
    const service = createInternalIntegrationService({
      connectorRepository,
      channelSessionRepository,
      authChallengeRepository,
      authChallengeCipher: fakeAuthChallengeCipher,
      now: () => now
    });

    const startResponse = await service.startChannelAuthChallenge(context, {
      connectorId: "max_qr_bridge:tenant-integrations",
      request: {
        challengeType: "phone_code",
        phoneNumber: "+79990000000"
      }
    });
    const secondStartResponse = await service.startChannelAuthChallenge(
      context,
      {
        connectorId: "max_qr_bridge:tenant-integrations",
        request: {
          challengeType: "phone_code",
          phoneNumber: "+79990000000"
        }
      }
    );

    expect(startResponse).toMatchObject({
      challenge: {
        connectorId: "max_qr_bridge:tenant-integrations",
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
        connectorId: "max_qr_bridge:tenant-integrations",
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
    expect(
      authChallengeRepository.records.get(startResponse.challenge.challengeId)
        ?.secretPayloadEncrypted
    ).toContain("sealed:");
    expect(
      authChallengeRepository.records.get(startResponse.challenge.challengeId)
        ?.secretPayloadEncrypted
    ).not.toContain("12345");

    await expect(
      service.cancelChannelAuthChallenge(context, {
        connectorId: "max_qr_bridge:tenant-integrations",
        challengeId: startResponse.challenge.challengeId,
        request: {
          resetSession: true
        }
      })
    ).resolves.toMatchObject({
      challenge: {
        status: "cancelled",
        completedAt: now.toISOString()
      }
    });
    expect(
      connectorRepository.records.get("max_qr_bridge:tenant-integrations")
    ).toMatchObject({
      status: "onboarding",
      healthStatus: "unknown",
      onboardingState: {
        step: "phone"
      }
    });
    expect(
      channelSessionRepository.records.get("channel_session:max-primary")
    ).toMatchObject({
      status: "not_started",
      sessionEncrypted: null,
      challengeType: null,
      lastErrorCode: null,
      publicState: {
        stage: "not_started"
      }
    });
    expect(channelSessionRepository.events).toContainEqual(
      expect.objectContaining({
        eventType: "auth.session_reset",
        connectorId: "max_qr_bridge:tenant-integrations"
      })
    );
  });

  it("exposes active user-bridge auth challenges in connector summaries", async () => {
    const authChallengeRepository =
      new InMemoryChannelAuthChallengeRepository();
    const connectorId =
      "telegram_qr_bridge:tenant-integrations" as ChannelConnectorId;
    const connectorRepository = new InMemoryChannelConnectorRepository([
      {
        ...createUserBridgeConnector({ connectorId }),
        status: "failed",
        healthStatus: "unhealthy"
      }
    ]);
    const service = createInternalIntegrationService({
      connectorRepository,
      authChallengeRepository,
      now: () => now
    });

    await authChallengeRepository.upsertChallenge({
      id: "channel_auth_challenge:active-summary",
      tenantId,
      connectorId,
      challengeType: "qr",
      status: "waiting",
      publicPayload: {
        qrPayloadRef: "challenge:qr-ref"
      },
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      updatedAt: now
    });

    await expect(service.listChannelConnectors(context)).resolves.toMatchObject(
      {
        connectors: [
          {
            connectorId,
            status: "failed",
            healthStatus: "unhealthy",
            activeAuthChallenge: {
              challengeId: "channel_auth_challenge:active-summary",
              challengeType: "qr",
              status: "waiting"
            }
          }
        ]
      }
    );
  });

  it("includes direct-account session activity in connector summaries", async () => {
    const connectorId =
      "telegram_qr_bridge:tenant-integrations" as ChannelConnectorId;
    const connectorRepository = new InMemoryChannelConnectorRepository([
      {
        ...createUserBridgeConnector({ connectorId }),
        status: "connected",
        healthStatus: "healthy"
      }
    ]);
    const channelSessionRepository = new InMemoryChannelSessionRepository();
    const service = createInternalIntegrationService({
      connectorRepository,
      channelSessionRepository,
      now: () => now
    });
    const lastInboundAt = new Date("2026-06-22T10:01:00.000Z");
    const lastOutboundAt = new Date("2026-06-22T10:02:00.000Z");

    await channelSessionRepository.upsertSession({
      id: "channel_session:primary",
      tenantId,
      connectorId,
      sessionKey: "primary",
      status: "connected",
      displayAddress: "@sales_account",
      lastInboundAt,
      lastOutboundAt,
      updatedAt: now
    });

    await expect(service.listChannelConnectors(context)).resolves.toMatchObject(
      {
        connectors: [
          {
            connectorId,
            status: "connected",
            healthStatus: "healthy",
            session: {
              status: "connected",
              displayAddress: "@sales_account",
              lastInboundAt: lastInboundAt.toISOString(),
              lastOutboundAt: lastOutboundAt.toISOString()
            }
          }
        ]
      }
    );
  });

  it("rejects auth challenge flows that do not match a direct account channel", async () => {
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository([
        createUserBridgeConnector()
      ]),
      authChallengeRepository: new InMemoryChannelAuthChallengeRepository(),
      now: () => now
    });

    await expect(
      service.startChannelAuthChallenge(context, {
        connectorId: "telegram_qr_bridge:tenant-integrations",
        request: {
          challengeType: "password"
        }
      })
    ).rejects.toMatchObject({
      code: "validation.failed"
    });
  });

  it("updates channel connector display name without changing lifecycle state", async () => {
    const connectorId =
      "telegram_qr_bridge:tenant-integrations" as ChannelConnectorId;
    const repository = new InMemoryChannelConnectorRepository([
      {
        ...createUserBridgeConnector({ connectorId }),
        status: "connected",
        healthStatus: "healthy"
      }
    ]);
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now
    });

    const response = await service.updateChannelConnector(context, {
      connectorId,
      request: {
        displayName: "Sales Telegram"
      }
    });

    expect(response).toMatchObject({
      connectorId,
      displayName: "Sales Telegram",
      status: "connected",
      healthStatus: "healthy"
    });
    expect(repository.records.get(connectorId)).toMatchObject({
      displayName: "Sales Telegram",
      status: "connected",
      healthStatus: "healthy"
    });
  });

  it("creates draft Telegram Bot connectors with server-side identity", async () => {
    const repository = new InMemoryChannelConnectorRepository();
    const sourceRepository = new InMemorySourceIntegrationRepository();
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      sourceRepository,
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
        sourceConnectionId: `source_connection:${response.connectorId}`,
        createdByEmployeeId: context.employeeId
      })
    );
    expect([...sourceRepository.connections.values()]).toEqual([
      expect.objectContaining({
        id: `source_connection:${response.connectorId}`,
        tenantId,
        sourceType: "messenger",
        sourceName: "telegram_bot",
        displayName: "Telegram Bot",
        status: "draft",
        authType: "token",
        config: {
          channelConnectorId: response.connectorId,
          channelType: "telegram_bot",
          channelClass: "bot_bridge",
          provider: "telegram"
        }
      })
    ]);
  });

  it("rejects coming-soon standalone sources before registry or persistence side effects", async () => {
    const registry = structuralFakeSourceAdapterRegistry();
    const unitOfWork = new InMemorySourceRegistryOnboardingUnitOfWork(
      new InMemorySourceIntegrationRepository()
    );
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      sourceAdapterRegistry: registry,
      sourceRegistryOnboardingUnitOfWork: unitOfWork,
      now: () => now
    });

    await expect(
      service.createSourceConnection(context, {
        sourceName: "megapbx",
        webhookToken: "megapbx-webhook-token"
      })
    ).rejects.toMatchObject({
      code: "validation.failed"
    });
    expect(registry.getRegistration).not.toHaveBeenCalled();
    expect(registry.get).not.toHaveBeenCalled();
    expect(unitOfWork.commits).toHaveLength(0);
    expect(unitOfWork.secretWrites).toHaveLength(0);
  });

  it("rejects a caller-authored structural source-adapter registry before handler access", async () => {
    const sourceRepository = new InMemorySourceIntegrationRepository();
    const registry = structuralFakeSourceAdapterRegistry();
    const unitOfWork = new InMemorySourceRegistryOnboardingUnitOfWork(
      sourceRepository
    );
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      sourceRepository,
      sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
      sourceAdapterRegistry: registry,
      sourceOnboardingAuthorizationResolver:
        currentSourceOnboardingAuthorizationResolver(),
      sourceRegistryOnboardingUnitOfWork: unitOfWork,
      now: () => now
    });

    await expect(
      service.createSourceConnection(context, {
        sourceName: "megapbx",
        webhookToken: "megapbx-webhook-token"
      })
    ).rejects.toMatchObject({ code: "module.unhealthy" });
    expect(registry.getRegistration).not.toHaveBeenCalled();
    expect(registry.get).not.toHaveBeenCalled();
    expect(unitOfWork.commits).toHaveLength(0);
    expect(sourceRepository.connections.size).toBe(0);
  });

  it("rejects available standalone sources without an exact registered handler", async () => {
    const sourceRepository = new InMemorySourceIntegrationRepository();
    const unitOfWork = new InMemorySourceRegistryOnboardingUnitOfWork(
      sourceRepository
    );
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      sourceRepository,
      sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
      sourceAdapterRegistry: createSourceAdapterRegistry({ registrations: [] }),
      sourceOnboardingAuthorizationResolver:
        currentSourceOnboardingAuthorizationResolver(),
      sourceRegistryOnboardingUnitOfWork: unitOfWork,
      now: () => now
    });

    await expect(
      service.createSourceConnection(context, {
        sourceName: "megapbx",
        webhookToken: "megapbx-webhook-token"
      })
    ).rejects.toMatchObject({
      code: "module.unhealthy"
    });
    expect(unitOfWork.commits).toHaveLength(0);
    expect(unitOfWork.secretWrites).toHaveLength(0);
    expect(sourceRepository.connections.size).toBe(0);
  });

  it("does not prepare registered standalone onboarding without an atomic unit-of-work", async () => {
    const prepare = vi.fn();
    const fixture = createTestMegaPbxSourceAdapterRegistry({
      onPrepare: prepare
    });
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
      sourceAdapterRegistry: fixture.registry,
      sourceOnboardingAuthorizationResolver:
        currentSourceOnboardingAuthorizationResolver(),
      now: () => now
    });

    await expect(
      service.createSourceConnection(context, {
        sourceName: "megapbx",
        webhookToken: "megapbx-webhook-token"
      })
    ).rejects.toMatchObject({
      code: "module.unhealthy"
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("does not prepare standalone onboarding without current RBAC authorization authority", async () => {
    const sourceRepository = new InMemorySourceIntegrationRepository();
    const prepare = vi.fn();
    const fixture = createTestMegaPbxSourceAdapterRegistry({
      onPrepare: prepare
    });
    const unitOfWork = new InMemorySourceRegistryOnboardingUnitOfWork(
      sourceRepository
    );
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      sourceRepository,
      sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
      sourceAdapterRegistry: fixture.registry,
      sourceRegistryOnboardingUnitOfWork: unitOfWork,
      now: () => now
    });

    await expect(
      service.createSourceConnection(context, {
        sourceName: "megapbx",
        webhookToken: "megapbx-webhook-token"
      })
    ).rejects.toMatchObject({ code: "module.unhealthy" });
    expect(prepare).not.toHaveBeenCalled();
    expect(unitOfWork.commits).toHaveLength(0);
    expect(sourceRepository.connections.size).toBe(0);
  });

  it("rejects unsupported revocable credential profiles before generating or handing off secret bytes", async () => {
    const prepare = vi.fn();
    const fixture = createTestMegaPbxSourceAdapterRegistry({
      credentialProfile: "unsupported_webhook_secret",
      onPrepare: prepare
    });
    const source = availableMegaPbxCatalogItemResolver("megapbx")!;
    const authorization =
      await currentSourceOnboardingAuthorizationResolver().resolveSourceOnboardingAuthorization(
        {
          requestId: context.requestId,
          tenantId: context.tenantId,
          employeeId: context.employeeId,
          sourceName: source.sourceName,
          requestedAt: now
        }
      );
    const createWebhookToken = vi.fn(() => "generated-webhook-token");

    expect(() =>
      createSourceAdapterOnboardingPrepareInput({
        context,
        actor: authorization!.actor,
        source,
        sourceConnectionId:
          "source_connection:megapbx:unsupported-profile" as SourceConnectionId,
        registration: fixture.registration,
        displayName: "Unsupported MegaPBX",
        createWebhookToken,
        requestedAt: now
      })
    ).toThrowError(expect.objectContaining({ code: "validation.failed" }));
    expect(createWebhookToken).not.toHaveBeenCalled();

    const unitOfWork = new InMemorySourceRegistryOnboardingUnitOfWork(
      new InMemorySourceIntegrationRepository()
    );
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
      sourceAdapterRegistry: fixture.registry,
      sourceOnboardingAuthorizationResolver:
        currentSourceOnboardingAuthorizationResolver(),
      sourceRegistryOnboardingUnitOfWork: unitOfWork,
      now: () => now
    });

    await expect(
      service.createSourceConnection(context, { sourceName: "megapbx" })
    ).rejects.toMatchObject({ code: "validation.failed" });
    expect(prepare).not.toHaveBeenCalled();
    expect(unitOfWork.commits).toHaveLength(0);
  });

  it("builds credential-free adapter input without generating a webhook token", async () => {
    const fixture = createTestMegaPbxSourceAdapterRegistry({
      credentialProfile: "none"
    });
    const source = availableMegaPbxCatalogItemResolver("megapbx")!;
    const authorization =
      await currentSourceOnboardingAuthorizationResolver().resolveSourceOnboardingAuthorization(
        {
          requestId: context.requestId,
          tenantId: context.tenantId,
          employeeId: context.employeeId,
          sourceName: source.sourceName,
          requestedAt: now
        }
      );
    const createWebhookToken = vi.fn(() => "generated-webhook-token");

    const invocation = createSourceAdapterOnboardingPrepareInput({
      context,
      actor: authorization!.actor,
      source,
      sourceConnectionId:
        "source_connection:megapbx:no-credentials" as SourceConnectionId,
      registration: fixture.registration,
      displayName: "Credential-free MegaPBX",
      createWebhookToken,
      requestedAt: now
    });

    expect(createWebhookToken).not.toHaveBeenCalled();
    expect(invocation.expectedStandardWebhookSecretToken).toBeUndefined();
    expect(invocation.prepareInput.credentialBindings).toEqual([]);
    expect(invocation.prepareInput.ephemeralCredentials).toEqual([]);
  });

  it.each([
    {
      name: "cross-tenant actor",
      transform: (authorization: SourceOnboardingAuthorization) => ({
        ...authorization,
        actor: {
          ...authorization.actor,
          employee: {
            ...authorization.actor.employee,
            tenantId: "tenant-other" as TenantId
          }
        }
      })
    },
    {
      name: "different employee",
      transform: (authorization: SourceOnboardingAuthorization) => ({
        ...authorization,
        actor: {
          ...authorization.actor,
          employee: {
            ...authorization.actor.employee,
            id: "employee-other" as EmployeeId
          }
        }
      })
    },
    {
      name: "cross-tenant decision",
      transform: (authorization: SourceOnboardingAuthorization) => ({
        ...authorization,
        decision: {
          ...authorization.decision,
          tenantId: "tenant-other" as TenantId,
          resource: {
            ...authorization.decision.resource,
            tenantId: "tenant-other" as TenantId
          }
        }
      })
    },
    {
      name: "different decision employee",
      transform: (authorization: SourceOnboardingAuthorization) => ({
        ...authorization,
        decision: {
          ...authorization.decision,
          principal: {
            ...authorization.decision.principal,
            employee: {
              ...authorization.decision.principal.employee,
              id: "employee-other" as EmployeeId
            }
          }
        }
      })
    },
    {
      name: "mismatched authorization epoch",
      transform: (authorization: SourceOnboardingAuthorization) => ({
        ...authorization,
        decision: {
          ...authorization.decision,
          authorizationEpoch: "authorization:forged"
        }
      })
    },
    {
      name: "future decision",
      transform: (authorization: SourceOnboardingAuthorization) => ({
        ...authorization,
        decision: {
          ...authorization.decision,
          decidedAt: new Date(now.getTime() + 1_000).toISOString()
        }
      })
    },
    {
      name: "stale decision",
      transform: (authorization: SourceOnboardingAuthorization) => ({
        ...authorization,
        decision: {
          ...authorization.decision,
          notAfter: now.toISOString()
        }
      })
    },
    {
      name: "denied decision",
      transform: (authorization: SourceOnboardingAuthorization) => ({
        ...authorization,
        decision: { ...authorization.decision, outcome: "denied" as const }
      })
    },
    {
      name: "wrong permission",
      transform: (authorization: SourceOnboardingAuthorization) => ({
        ...authorization,
        decision: {
          ...authorization.decision,
          permissionId: "integrations.manage"
        }
      })
    }
  ])(
    "rejects $name authorization before adapter prepare",
    async ({ transform }) => {
      const sourceRepository = new InMemorySourceIntegrationRepository();
      const prepare = vi.fn();
      const fixture = createTestMegaPbxSourceAdapterRegistry({
        onPrepare: prepare
      });
      const registryRepository = new InMemoryInboxV2SourceRegistryRepository(
        sourceRepository
      );
      const unitOfWork =
        createSourceRegistryOnboardingUnitOfWork(registryRepository);
      const service = createInternalIntegrationService({
        connectorRepository: new InMemoryChannelConnectorRepository(),
        sourceRepository,
        sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
        sourceAdapterRegistry: fixture.registry,
        sourceOnboardingAuthorizationResolver:
          currentSourceOnboardingAuthorizationResolver(transform),
        sourceRegistryOnboardingUnitOfWork: unitOfWork,
        now: () => now
      });

      await expect(
        service.createSourceConnection(context, {
          sourceName: "megapbx",
          webhookToken: "megapbx-webhook-token"
        })
      ).rejects.toMatchObject({ code: "permission.denied" });
      expect(prepare).not.toHaveBeenCalled();
      expect(registryRepository.commits).toHaveLength(0);
      expect(sourceRepository.connections.size).toBe(0);
    }
  );

  it("creates standalone sources only through a registered handler and atomic unit-of-work", async () => {
    const repository = new InMemoryChannelConnectorRepository();
    const sourceRepository = new InMemorySourceIntegrationRepository();
    const prepare = vi.fn();
    const fixture = createTestMegaPbxSourceAdapterRegistry({
      onPrepare: prepare
    });
    const registryRepository = new InMemoryInboxV2SourceRegistryRepository(
      sourceRepository
    );
    const unitOfWork =
      createSourceRegistryOnboardingUnitOfWork(registryRepository);
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      sourceRepository,
      sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
      sourceAdapterRegistry: fixture.registry,
      sourceOnboardingAuthorizationResolver:
        currentSourceOnboardingAuthorizationResolver(),
      sourceRegistryOnboardingUnitOfWork: unitOfWork,
      publicWebhookBaseUrl: "https://chat.example.test",
      now: () => now
    });

    const response = await service.createSourceConnection(context, {
      sourceName: "megapbx",
      displayName: "Sales MegaPBX",
      webhookToken: "megapbx-webhook-token"
    });

    expect(response).toMatchObject({
      connection: {
        sourceConnectionId: expect.stringMatching(
          /^source_connection:megapbx:/
        ),
        sourceName: "megapbx",
        sourceType: "phone",
        displayName: "Sales MegaPBX",
        status: "onboarding",
        authType: "webhook_secret"
      },
      webhookToken: "megapbx-webhook-token"
    });
    expect(response.connection).not.toHaveProperty("webhookPath");
    expect(response.connection).not.toHaveProperty("webhookUrl");
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          kind: "employee",
          authorizationEpoch: "authorization:source-onboarding-current"
        }),
        publicBaseUrl: "https://chat.example.test"
      })
    );
    expect(registryRepository.secretWrites).toHaveLength(1);
    expect(registryRepository.secretWrites[0]).toEqual(
      expect.objectContaining({
        binding: expect.objectContaining({
          tenantId,
          status: "active"
        }),
        materialDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
      })
    );
    expect(
      new TextDecoder().decode(registryRepository.secretWrites[0]!.material)
    ).toBe("megapbx-webhook-token");
    expect([...sourceRepository.connections.values()]).toEqual([
      expect.objectContaining({
        id: response.connection.sourceConnectionId,
        tenantId,
        sourceType: "phone",
        sourceName: "megapbx",
        displayName: "Sales MegaPBX",
        status: "onboarding",
        authType: "webhook_secret",
        config: {}
      })
    ]);
    expect(registryRepository.commits).toEqual([
      expect.objectContaining({
        declaration: expect.objectContaining({
          payload: expect.objectContaining({ sourceName: "megapbx" })
        }),
        compatibilityConnection: expect.objectContaining({
          tenantId,
          sourceType: "phone",
          sourceName: "megapbx",
          displayName: "Sales MegaPBX",
          status: "onboarding",
          authType: "webhook_secret",
          createdByEmployeeId: context.employeeId
        }),
        transition: expect.objectContaining({
          payload: expect.objectContaining({
            entityKind: "source_connection",
            intent: "create",
            previousState: null,
            resultingState: expect.objectContaining({
              payload: expect.objectContaining({
                createdBy: expect.objectContaining({
                  authorizationEpoch: "authorization:source-onboarding-current"
                })
              })
            })
          })
        }),
        routeWrites: [
          expect.objectContaining({
            route: expect.objectContaining({ kind: "source_ingress_route" }),
            materialDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
          })
        ]
      })
    ]);
    expect(
      new TextDecoder().decode(registryRepository.routeWrites[0]!.material)
    ).toBe(`route:${response.connection.sourceConnectionId}`);

    await expect(service.listSourceConnections(context)).resolves.toEqual({
      connections: [response.connection]
    });
  });

  it("fails the API-to-DB adapter closed for accounts and non-create chains", async () => {
    const sourceRepository = new InMemorySourceIntegrationRepository();
    const fixture = createTestMegaPbxSourceAdapterRegistry();
    const capture = new InMemorySourceRegistryOnboardingUnitOfWork(
      sourceRepository
    );
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      sourceRepository,
      sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
      sourceAdapterRegistry: fixture.registry,
      sourceOnboardingAuthorizationResolver:
        currentSourceOnboardingAuthorizationResolver(),
      sourceRegistryOnboardingUnitOfWork: capture,
      now: () => now
    });
    await service.createSourceConnection(context, {
      sourceName: "megapbx",
      webhookToken: "megapbx-webhook-token"
    });
    const valid = capture.commits[0]!;
    const commitSourceConnectionOnboarding = vi.fn(async () => {
      throw new Error("DB boundary must not be reached.");
    });
    const unitOfWork = createSourceRegistryOnboardingUnitOfWork({
      commitSourceConnectionOnboarding
    });
    const transition = valid.prepared.authority.connection.transitions[0]!;
    const invalidInputs: SourceRegistryOnboardingCommitInput[] = [
      {
        ...valid,
        prepared: {
          ...valid.prepared,
          authority: {
            ...valid.prepared.authority,
            accounts: [
              null
            ] as unknown as typeof valid.prepared.authority.accounts
          }
        }
      },
      {
        ...valid,
        prepared: {
          ...valid.prepared,
          authority: {
            ...valid.prepared.authority,
            connection: {
              ...valid.prepared.authority.connection,
              transitions: [
                {
                  ...transition,
                  payload: { ...transition.payload, intent: "enable" }
                } as typeof transition
              ]
            }
          }
        }
      }
    ];

    for (const invalid of invalidInputs) {
      await expect(
        unitOfWork.onboardStandaloneSource(invalid)
      ).rejects.toMatchObject({ code: "module.unhealthy" });
    }
    expect(commitSourceConnectionOnboarding).not.toHaveBeenCalled();
  });

  it("leaves no standalone source or secret behind when the onboarding unit-of-work fails", async () => {
    const sourceRepository = new InMemorySourceIntegrationRepository();
    const fixture = createTestMegaPbxSourceAdapterRegistry();
    const registryRepository = new InMemoryInboxV2SourceRegistryRepository(
      sourceRepository,
      { failBeforeCommit: true }
    );
    const unitOfWork =
      createSourceRegistryOnboardingUnitOfWork(registryRepository);
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      sourceRepository,
      sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
      sourceAdapterRegistry: fixture.registry,
      sourceOnboardingAuthorizationResolver:
        currentSourceOnboardingAuthorizationResolver(),
      sourceRegistryOnboardingUnitOfWork: unitOfWork,
      publicWebhookBaseUrl: "https://chat.example.test",
      now: () => now
    });

    await expect(
      service.createSourceConnection(context, {
        sourceName: "megapbx",
        webhookToken: "megapbx-webhook-token"
      })
    ).rejects.toThrow("Injected source onboarding transaction failure.");
    expect(registryRepository.commits).toHaveLength(1);
    expect(registryRepository.secretWrites).toHaveLength(0);
    expect(sourceRepository.connections.size).toBe(0);
    const committed = registryRepository.commits[0]!;
    expect([...committed.secretWrites[0]!.material]).toEqual(
      new Array("megapbx-webhook-token".length).fill(0)
    );
    expect(committed.routeWrites[0]!.material.every((byte) => byte === 0)).toBe(
      true
    );
  });

  it("rejects caller-authored adapter authority before persistence", async () => {
    const sourceRepository = new InMemorySourceIntegrationRepository();
    const fixture = createTestMegaPbxSourceAdapterRegistry({
      transformPrepared(prepared) {
        return {
          ...prepared,
          authority: {
            ...prepared.authority,
            connection: {
              ...prepared.authority.connection,
              head: structuredClone(prepared.authority.connection.head)
            }
          }
        } as typeof prepared;
      }
    });
    const unitOfWork = new InMemorySourceRegistryOnboardingUnitOfWork(
      sourceRepository
    );
    const service = createInternalIntegrationService({
      connectorRepository: new InMemoryChannelConnectorRepository(),
      sourceRepository,
      sourceCatalogItemResolver: availableMegaPbxCatalogItemResolver,
      sourceAdapterRegistry: fixture.registry,
      sourceOnboardingAuthorizationResolver:
        currentSourceOnboardingAuthorizationResolver(),
      sourceRegistryOnboardingUnitOfWork: unitOfWork,
      now: () => now
    });

    await expect(
      service.createSourceConnection(context, {
        sourceName: "megapbx",
        webhookToken: "megapbx-webhook-token"
      })
    ).rejects.toMatchObject({
      code: "module.unhealthy"
    });
    expect(unitOfWork.commits).toHaveLength(0);
    expect(unitOfWork.secretWrites).toHaveLength(0);
    expect(sourceRepository.connections.size).toBe(0);
  });

  it.each([
    {
      channelType: "telegram_qr_bridge" as const,
      provider: "telegram",
      displayName: "Telegram account",
      authMode: "qr",
      initialStep: "qr",
      expectedEgress: telegramEgressDiagnostics()
    },
    {
      channelType: "whatsapp_qr_bridge" as const,
      provider: "whatsapp",
      displayName: "WhatsApp account",
      authMode: "qr",
      initialStep: "qr",
      expectedEgress: telegramEgressDiagnostics()
    },
    {
      channelType: "max_qr_bridge" as const,
      provider: "max",
      displayName: "MAX account",
      authMode: "phone_code",
      initialStep: "phone",
      expectedEgress: directEgressDiagnostics()
    }
  ])(
    "creates $channelType connectors with a primary user session",
    async (expected) => {
      const connectorRepository = new InMemoryChannelConnectorRepository();
      const channelSessionRepository = new InMemoryChannelSessionRepository();
      const sourceRepository = new InMemorySourceIntegrationRepository();
      const service = createInternalIntegrationService({
        connectorRepository,
        channelSessionRepository,
        sourceRepository,
        now: () => now
      });

      const response = await service.createChannelConnector(context, {
        channelType: expected.channelType
      });

      expect(response).toMatchObject({
        connectorId: expect.stringMatching(
          new RegExp(`^${expected.channelType}:`)
        ),
        channelType: expected.channelType,
        channelClass: "user_bridge",
        provider: expected.provider,
        displayName: expected.displayName,
        status: "onboarding",
        healthStatus: "unknown",
        diagnosticsStatus: "not_started",
        egress: expected.expectedEgress
      });
      expect(connectorRepository.records.get(response.connectorId)).toEqual(
        expect.objectContaining({
          id: response.connectorId,
          tenantId,
          channelType: expected.channelType,
          channelClass: "user_bridge",
          provider: expected.provider,
          status: "onboarding",
          onboardingState: {
            step: expected.initialStep
          },
          config: {
            sessionKey: "primary",
            authMode: expected.authMode
          },
          sourceConnectionId: `source_connection:${response.connectorId}`,
          createdByEmployeeId: context.employeeId
        })
      );
      expect([...sourceRepository.connections.values()]).toEqual([
        expect.objectContaining({
          id: `source_connection:${response.connectorId}`,
          tenantId,
          sourceType: "messenger",
          sourceName:
            expected.channelType === "telegram_qr_bridge"
              ? "telegram_user_session"
              : expected.channelType === "whatsapp_qr_bridge"
                ? "whatsapp_user_session"
                : "max_user_session",
          displayName: expected.displayName,
          status: "onboarding",
          authType: "custom",
          config: {
            channelConnectorId: response.connectorId,
            channelType: expected.channelType,
            channelClass: "user_bridge",
            provider: expected.provider
          }
        })
      ]);
      expect([...channelSessionRepository.records.values()]).toEqual([
        expect.objectContaining({
          tenantId,
          connectorId: response.connectorId,
          sessionKey: "primary",
          status: "not_started",
          publicState: {
            stage: "not_started"
          },
          metadata: {
            provider: expected.provider,
            channelType: expected.channelType,
            authMode: expected.authMode
          }
        })
      ]);
      expect(channelSessionRepository.events).toEqual([
        expect.objectContaining({
          tenantId,
          connectorId: response.connectorId,
          eventType: "session.created",
          metadata: {
            channelType: expected.channelType,
            provider: expected.provider,
            sessionKey: "primary"
          }
        })
      ]);
    }
  );

  it("disables, enables and soft-deletes tenant channel connectors", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      {
        ...createTelegramConnector({
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
        }),
        sourceConnectionId:
          "source_connection:telegram_bot:tenant-integrations" as SourceConnectionId
      }
    ]);
    const sourceRepository = new InMemorySourceIntegrationRepository();
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      sourceRepository,
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
    expect(
      sourceRepository.connections.get(
        "source_connection:telegram_bot:tenant-integrations"
      )
    ).toMatchObject({
      status: "disabled",
      displayName: "Telegram Bot"
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
    expect(
      sourceRepository.connections.get(
        "source_connection:telegram_bot:tenant-integrations"
      )
    ).toMatchObject({
      status: "active"
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
    expect(
      sourceRepository.connections.get(
        "source_connection:telegram_bot:tenant-integrations"
      )
    ).toMatchObject({
      status: "deleted"
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

  it("validates Telegram bot tokens through provider validation outbox jobs", async () => {
    const repository = new InMemoryChannelConnectorRepository();
    const validationJobs = new InMemoryChannelProviderValidationJobRepository();
    const secretWriter = new InMemorySecretWriter();
    const events = new InMemoryDomainEventRepository(async (appended) => {
      const event = appended.events[0];

      expect(event).toEqual(
        expect.objectContaining({
          type: "channel.provider_validation.requested",
          tenantId,
          payload: expect.objectContaining({
            channelType: "telegram_bot",
            provider: "telegram",
            validationKind: "telegram_bot_token",
            actorEmployeeId: context.employeeId
          })
        })
      );

      if (event?.type !== "channel.provider_validation.requested") {
        throw new Error("Unexpected provider validation event.");
      }

      const job = validationJobs.records.get(event.payload.jobId);

      expect(job).toMatchObject({
        tenantId,
        status: "pending",
        botTokenSecretRef: expect.stringContaining(
          "channel-provider-validation-"
        )
      });

      validationJobs.records.set(event.payload.jobId, {
        ...job!,
        status: "succeeded",
        resultPayload: {
          bot: {
            id: "100",
            username: "hulee_test_bot"
          }
        },
        completedAt: now,
        updatedAt: now
      });
    });
    const botApiClientFactory = vi.fn();
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      providerValidationJobRepository: validationJobs,
      providerOperationEvents: events,
      secretWriter,
      botApiClientFactory,
      providerValidationTimeoutMs: 50,
      providerValidationPollIntervalMs: 1,
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
    expect(botApiClientFactory).not.toHaveBeenCalled();
    expect(secretWriter.upserts).toEqual([
      expect.objectContaining({
        tenantId,
        purpose: "telegram.bot_token_validation",
        plainText: "123456789:AAExampleTokenValue_000000000000000000"
      })
    ]);
    expect(events.events).toHaveLength(1);
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
        secretRef: expect.stringMatching(
          /^secret:tenant-integrations\/channels\/telegram_bot:tenant-integrations\/bot-token-v1-/
        ),
        purpose: "telegram.bot_token",
        plainText: "telegram-token-1",
        updatedAt: now
      },
      {
        tenantId,
        secretRef: expect.stringMatching(
          /^secret:tenant-integrations\/channels\/telegram_bot:tenant-integrations\/webhook-secret-token-v1-/
        ),
        purpose: "telegram.webhook_secret_token",
        plainText: "raw-telegram-webhook-secret-value",
        updatedAt: now
      }
    ]);
    expect(response.config?.botTokenSecretRef).toBe(
      secretWriter.upserts[0]?.secretRef
    );
    expect(response.config?.webhookConnectorId).toBe("tgwh_test");
    expect(response.config?.webhookSecretTokenSecretRef).toBe(
      secretWriter.upserts[1]?.secretRef
    );
    expect(JSON.stringify(response)).not.toContain("telegram-token-1");
    expect(JSON.stringify(response)).not.toContain(
      "raw-telegram-webhook-secret-value"
    );
    expect(
      JSON.stringify(repository.records.get("telegram_bot:tenant-integrations"))
    ).not.toContain("telegram-token-1");

    const rotated = await service.updateTelegramIntegration(context, {
      connectorId: "telegram_bot:tenant-integrations",
      enabled: true,
      channelExternalId: "telegram-local",
      mode: "webhook",
      botToken: "telegram-token-2",
      outboundEnabled: true
    });

    expect(secretWriter.upserts).toHaveLength(3);
    expect(secretWriter.upserts[2]).toEqual(
      expect.objectContaining({
        purpose: "telegram.bot_token",
        plainText: "telegram-token-2",
        secretRef: expect.stringContaining("/bot-token-v1-")
      })
    );
    expect(secretWriter.upserts[2]?.secretRef).not.toBe(
      secretWriter.upserts[0]?.secretRef
    );
    expect(rotated.config?.botTokenSecretRef).toBe(
      secretWriter.upserts[2]?.secretRef
    );
    expect(rotated.config?.webhookSecretTokenSecretRef).toBe(
      secretWriter.upserts[1]?.secretRef
    );
  });

  it("does not overwrite the active Telegram secret when connector rotation persistence fails", async () => {
    const activeBotTokenSecretRef =
      "secret:tenant-integrations/channels/telegram_bot:tenant-integrations/bot-token-v1-active";
    const activeWebhookSecretRef =
      "secret:tenant-integrations/channels/telegram_bot:tenant-integrations/webhook-secret-token-v1-active";
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: activeBotTokenSecretRef,
          webhookConnectorId: "tgwh_test",
          webhookSecretTokenSecretRef: activeWebhookSecretRef,
          outboundEnabled: true
        },
        diagnostics: {}
      })
    ]);
    vi.spyOn(repository, "upsertConnector").mockRejectedValueOnce(
      new Error("Injected connector persistence failure.")
    );
    const secretWriter = new InMemorySecretWriter();
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      secretWriter,
      now: () => now
    });

    await expect(
      service.updateTelegramIntegration(context, {
        connectorId: "telegram_bot:tenant-integrations",
        enabled: true,
        channelExternalId: "telegram-local",
        mode: "webhook",
        botToken: "telegram-token-rotated",
        outboundEnabled: true
      })
    ).rejects.toThrow("Injected connector persistence failure.");

    expect(secretWriter.upserts).toEqual([
      expect.objectContaining({
        purpose: "telegram.bot_token",
        plainText: "telegram-token-rotated",
        secretRef: expect.stringContaining("/bot-token-v1-")
      })
    ]);
    expect(secretWriter.upserts[0]?.secretRef).not.toBe(
      activeBotTokenSecretRef
    );
    expect(
      repository.records.get("telegram_bot:tenant-integrations")?.config
    ).toEqual(
      expect.objectContaining({
        botTokenSecretRef: activeBotTokenSecretRef,
        webhookSecretTokenSecretRef: activeWebhookSecretRef
      })
    );
  });

  it("preserves Telegram diagnostics when only display name changes", async () => {
    const diagnostics = {
      status: "configured",
      checkedAt: "2026-06-22T09:55:00.000Z",
      bot: {
        id: "100",
        username: "hulee_test_bot"
      },
      webhook: {
        expectedUrl: "https://example.test/webhooks/telegram/tgwh_test",
        actualUrl: "https://example.test/webhooks/telegram/tgwh_test",
        pendingUpdateCount: 0
      },
      runtime: {
        inbound: {
          lastSource: "webhook",
          lastReceivedAt: "2026-06-22T09:54:00.000Z",
          lastAcceptedAt: "2026-06-22T09:54:00.000Z",
          lastBatchReceivedCount: 1,
          lastBatchAcceptedCount: 1,
          lastBatchFailedCount: 0
        }
      },
      checks: {
        moduleEnabled: true,
        configValid: true,
        inboundWebhookReady: true,
        outboundEnabled: true,
        botTokenSecretRefConfigured: true,
        botTokenResolved: true,
        botApiReachable: true,
        webhookMatchesConfig: true
      }
    };
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "secret:bot-token",
          webhookConnectorId: "tgwh_test",
          webhookSecretTokenSecretRef: "secret:webhook-token",
          outboundEnabled: true
        },
        diagnostics
      })
    ]);
    const service = createInternalIntegrationService({
      connectorRepository: repository,
      now: () => now
    });

    const response = await service.updateTelegramIntegration(context, {
      connectorId: "telegram_bot:tenant-integrations",
      displayName: "Sales Telegram",
      enabled: true,
      channelExternalId: "telegram-local",
      mode: "webhook",
      botTokenSecretRef: "secret:bot-token",
      outboundEnabled: true
    });

    expect(response.displayName).toBe("Sales Telegram");
    expect(response.diagnostics).toEqual(diagnostics);
    expect(
      repository.records.get("telegram_bot:tenant-integrations")?.diagnostics
    ).toEqual(diagnostics);
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
      sourceConnectionId:
        (input.sourceConnectionId as SourceConnectionId | null | undefined) ??
        existing?.sourceConnectionId ??
        null,
      createdByEmployeeId: input.createdByEmployeeId ?? null,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    });
  }
}

class InMemorySourceIntegrationRepository implements SourceIntegrationRepository {
  readonly connections = new Map<string, SourceConnectionRecord>();

  async findSourceConnection(
    input: FindSourceConnectionInput
  ): Promise<SourceConnectionRecord | null> {
    const record = this.connections.get(String(input.sourceConnectionId));

    return record?.tenantId === input.tenantId ? record : null;
  }

  async listTenantSourceConnections(
    input: ListTenantSourceConnectionsInput
  ): Promise<SourceConnectionRecord[]> {
    return [...this.connections.values()].filter(
      (record) =>
        record.tenantId === input.tenantId &&
        (input.includeDeleted || record.status !== "deleted")
    );
  }

  async upsertSourceConnection(
    input: UpsertSourceConnectionInput
  ): Promise<SourceConnectionRecord> {
    const existing = this.connections.get(String(input.id));
    const record: SourceConnectionRecord = {
      id: String(input.id) as SourceConnectionRecord["id"],
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      displayName: input.displayName,
      status: input.status,
      authType: input.authType,
      capabilities: input.capabilities ?? {},
      config: input.config ?? {},
      diagnostics: input.diagnostics ?? {},
      metadata: input.metadata ?? {},
      createdByEmployeeId: input.createdByEmployeeId ?? null,
      createdAt: existing?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt
    };

    this.connections.set(String(input.id), record);

    return record;
  }

  async upsertSourceAccount(
    _input: UpsertSourceAccountInput
  ): Promise<SourceAccountRecord> {
    throw new Error("Not implemented in this test fake.");
  }

  async recordRawInboundEvent(
    _input: RecordRawInboundEventInput
  ): Promise<RawInboundEventRecord> {
    throw new Error("Not implemented in this test fake.");
  }

  async recordNormalizedInboundEvent(
    _input: RecordNormalizedInboundEventInput
  ): Promise<NormalizedInboundEventRecord> {
    throw new Error("Not implemented in this test fake.");
  }
}

type SourceRegistryOnboardingCommitInput = Parameters<
  SourceRegistryOnboardingUnitOfWork["onboardStandaloneSource"]
>[0];

class InMemorySourceRegistryOnboardingUnitOfWork implements SourceRegistryOnboardingUnitOfWork {
  readonly commits: SourceRegistryOnboardingCommitInput[] = [];
  readonly secretWrites: SourceAdapterTransientSecretWrite[] = [];

  constructor(
    private readonly sourceRepository: InMemorySourceIntegrationRepository,
    private readonly options: { failBeforeCommit?: boolean } = {}
  ) {}

  async onboardStandaloneSource(
    input: SourceRegistryOnboardingCommitInput
  ): Promise<SourceConnectionRecord> {
    this.commits.push(input);

    if (this.options.failBeforeCommit) {
      throw new Error("Injected source onboarding transaction failure.");
    }

    const record: SourceConnectionRecord = {
      ...input.sourceConnection,
      capabilities: {},
      config: {},
      diagnostics: {},
      metadata: {},
      createdAt: input.sourceConnection.updatedAt
    };

    this.sourceRepository.connections.set(String(record.id), record);
    this.secretWrites.push(
      ...input.prepared.secretWrites.map((write) => ({
        binding: write.binding,
        material: new Uint8Array(write.material),
        materialDigest: write.materialDigest
      }))
    );

    return record;
  }
}

type InboxV2SourceRegistryCommitInput = Parameters<
  InboxV2SourceRegistryRepository["commitSourceConnectionOnboarding"]
>[0];

/* Verifies the API-to-DB adapter without pretending to be SQL itself. */
class InMemoryInboxV2SourceRegistryRepository implements Pick<
  InboxV2SourceRegistryRepository,
  "commitSourceConnectionOnboarding"
> {
  readonly commits: InboxV2SourceRegistryCommitInput[] = [];
  readonly secretWrites: SourceAdapterTransientSecretWrite[] = [];
  readonly routeWrites: InboxV2SourceRegistryCommitInput["routeWrites"][number][] =
    [];

  constructor(
    private readonly sourceRepository: InMemorySourceIntegrationRepository,
    private readonly options: { failBeforeCommit?: boolean } = {}
  ) {}

  async commitSourceConnectionOnboarding(
    input: InboxV2SourceRegistryCommitInput
  ): Promise<SourceConnectionRecord> {
    this.commits.push(input);

    if (this.options.failBeforeCommit) {
      throw new Error("Injected source onboarding transaction failure.");
    }

    const compatibility = input.compatibilityConnection;
    const record: SourceConnectionRecord = {
      id: compatibility.id as SourceConnectionRecord["id"],
      tenantId: compatibility.tenantId,
      sourceType:
        compatibility.sourceType as SourceConnectionRecord["sourceType"],
      sourceName: compatibility.sourceName,
      displayName: compatibility.displayName,
      status: compatibility.status as SourceConnectionRecord["status"],
      authType: compatibility.authType as SourceConnectionRecord["authType"],
      capabilities: {},
      config: {},
      diagnostics: {},
      metadata: {},
      createdByEmployeeId:
        compatibility.createdByEmployeeId as EmployeeId | null,
      createdAt: compatibility.updatedAt,
      updatedAt: compatibility.updatedAt
    };

    this.sourceRepository.connections.set(String(record.id), record);
    this.secretWrites.push(
      ...input.secretWrites.map((write) => ({
        binding: write.binding,
        material: new Uint8Array(write.material),
        materialDigest:
          write.materialDigest as SourceAdapterTransientSecretWrite["materialDigest"]
      }))
    );
    this.routeWrites.push(
      ...input.routeWrites.map((write) => ({
        route: write.route,
        material: new Uint8Array(write.material),
        materialDigest: write.materialDigest
      }))
    );

    return record;
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

  async listActiveChallenges(
    input: ListActiveChannelAuthChallengesInput = {}
  ): Promise<ChannelAuthChallengeRecord[]> {
    const statuses = new Set(
      input.statuses ?? [
        "pending",
        "waiting",
        "requires_code",
        "requires_password"
      ]
    );
    const now = input.now ?? new Date();

    return [...this.records.values()]
      .filter(
        (record) =>
          statuses.has(record.status) &&
          (!record.expiresAt || record.expiresAt.getTime() > now.getTime())
      )
      .sort((left, right) => {
        const byUpdatedAt =
          left.updatedAt.getTime() - right.updatedAt.getTime();

        return byUpdatedAt === 0
          ? left.id.localeCompare(right.id)
          : byUpdatedAt;
      })
      .slice(0, input.limit ?? 100);
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

class InMemoryChannelSessionRepository implements ChannelSessionRepository {
  readonly records = new Map<string, ChannelSessionRecord>();
  readonly events: ChannelSessionEventRecord[] = [];

  async findSession(
    input: FindChannelSessionInput
  ): Promise<ChannelSessionRecord | null> {
    const record = this.records.get(input.sessionId) ?? null;

    return record?.tenantId === input.tenantId ? record : null;
  }

  async findConnectorSession(
    input: FindConnectorChannelSessionInput
  ): Promise<ChannelSessionRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.connectorId === input.connectorId &&
          record.sessionKey === input.sessionKey
      ) ?? null
    );
  }

  async listRunnableSessions(
    input: ListRunnableChannelSessionsInput
  ): Promise<ChannelSessionRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.status === input.status
    );
  }

  async upsertSession(input: UpsertChannelSessionInput): Promise<void> {
    const existing = this.records.get(input.id);
    const updatedAt = input.updatedAt;

    this.records.set(input.id, {
      id: input.id,
      tenantId: input.tenantId,
      connectorId: String(input.connectorId) as ChannelConnectorId,
      sessionKey: input.sessionKey,
      status: input.status,
      sessionEncrypted: input.sessionEncrypted ?? null,
      sessionFingerprint: input.sessionFingerprint ?? null,
      externalAccountId: input.externalAccountId ?? null,
      displayAddress: input.displayAddress ?? null,
      publicState: input.publicState ?? {},
      metadata: input.metadata ?? {},
      challengeType: input.challengeType ?? null,
      challengeExpiresAt: input.challengeExpiresAt ?? null,
      leaseOwner: input.leaseOwner ?? null,
      leaseExpiresAt: input.leaseExpiresAt ?? null,
      lastConnectedAt: input.lastConnectedAt ?? null,
      lastDisconnectedAt: input.lastDisconnectedAt ?? null,
      lastHeartbeatAt: input.lastHeartbeatAt ?? null,
      lastInboundAt: input.lastInboundAt ?? null,
      lastOutboundAt: input.lastOutboundAt ?? null,
      lastErrorAt: input.lastErrorAt ?? null,
      lastErrorCode: input.lastErrorCode ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    });
  }

  async claimSessionLease(
    input: ClaimChannelSessionLeaseInput
  ): Promise<ChannelSessionRecord | null> {
    const record = this.records.get(input.sessionId);

    if (!record || record.tenantId !== input.tenantId) {
      return null;
    }

    const updated = {
      ...record,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: input.leaseExpiresAt,
      lastHeartbeatAt: input.now,
      updatedAt: input.now
    };

    this.records.set(input.sessionId, updated);

    return updated;
  }

  async releaseSessionLease(
    input: ReleaseChannelSessionLeaseInput
  ): Promise<void> {
    const record = this.records.get(input.sessionId);

    if (
      !record ||
      record.tenantId !== input.tenantId ||
      record.leaseOwner !== input.leaseOwner
    ) {
      return;
    }

    this.records.set(input.sessionId, {
      ...record,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: input.updatedAt
    });
  }

  async appendSessionEvent(
    input: AppendChannelSessionEventInput
  ): Promise<void> {
    this.events.push({
      id: input.id,
      tenantId: input.tenantId,
      connectorId: String(input.connectorId) as ChannelConnectorId,
      sessionId: input.sessionId,
      eventType: input.eventType,
      severity: input.severity ?? "info",
      code: input.code ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
      occurredAt: input.occurredAt,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt
    });
  }

  async listSessionEvents(
    input: ListChannelSessionEventsInput
  ): Promise<ChannelSessionEventRecord[]> {
    return this.events.filter(
      (event) =>
        event.tenantId === input.tenantId && event.sessionId === input.sessionId
    );
  }
}

class InMemoryChannelProviderValidationJobRepository implements ChannelProviderValidationJobRepository {
  readonly records = new Map<string, ChannelProviderValidationJobRecord>();

  async findJob(
    input: FindChannelProviderValidationJobInput
  ): Promise<ChannelProviderValidationJobRecord | null> {
    const record = this.records.get(input.jobId) ?? null;

    return record?.tenantId === input.tenantId ? record : null;
  }

  async upsertJob(
    input: UpsertChannelProviderValidationJobInput
  ): Promise<void> {
    const existing = this.records.get(input.id);
    const updatedAt = input.updatedAt;

    this.records.set(input.id, {
      id: input.id,
      tenantId: input.tenantId,
      channelType: input.channelType as ChannelType,
      provider: input.provider,
      validationKind: input.validationKind,
      status: input.status,
      botTokenSecretRef: input.botTokenSecretRef,
      resultPayload: input.resultPayload ?? {},
      errorCode: (input.errorCode as PlatformErrorCode | undefined) ?? null,
      errorMessage: input.errorMessage ?? null,
      expiresAt: input.expiresAt,
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

  constructor(
    private readonly onAppend?: (input: {
      tenantId: TenantId;
      events: readonly PlatformEvent[];
    }) => Promise<void> | void
  ) {}

  async append(input: {
    tenantId: TenantId;
    events: readonly PlatformEvent[];
  }): Promise<void> {
    expect(
      input.events.every((event) => event.tenantId === input.tenantId)
    ).toBe(true);
    this.events.push(...input.events);
    await this.onAppend?.(input);
  }
}

type InMemorySecretPurpose =
  | "telegram.bot_token"
  | "telegram.bot_token_validation"
  | "telegram.webhook_secret_token";

class InMemorySecretWriter {
  readonly upserts: {
    tenantId: TenantId;
    secretRef: string;
    purpose: InMemorySecretPurpose;
    plainText: string;
    updatedAt: Date;
  }[] = [];

  async upsertSecret(input: {
    tenantId: TenantId;
    secretRef: string;
    purpose: InMemorySecretPurpose;
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

function createUserBridgeConnector(
  input: {
    connectorId?: ChannelConnectorId;
    channelType?: ChannelType;
    provider?: string;
    displayName?: string;
    onboardingStep?: string;
  } = {}
): ChannelConnectorRecord {
  return {
    id:
      input.connectorId ??
      ("telegram_qr_bridge:tenant-integrations" as ChannelConnectorId),
    tenantId,
    channelType: input.channelType ?? "telegram_qr_bridge",
    channelClass: "user_bridge",
    provider: input.provider ?? "telegram",
    displayName: input.displayName ?? "Telegram personal",
    status: "onboarding",
    healthStatus: "unknown",
    capabilities: {},
    onboardingState: {
      step: input.onboardingStep ?? "qr"
    },
    config: {},
    diagnostics: {},
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}
