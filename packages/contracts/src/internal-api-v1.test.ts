import { describe, expect, it } from "vitest";

import {
  internalApiErrorResponseSchema,
  internalAccessDecisionRequestSchema,
  internalAccessDecisionResponseSchema,
  internalChannelAuthChallengeCancelRequestSchema,
  internalChannelAuthChallengeResponseSchema,
  internalChannelAuthChallengeStartRequestSchema,
  internalChannelAuthChallengeSubmitRequestSchema,
  internalChannelCatalogResponseSchema,
  internalChannelConnectorCreateRequestSchema,
  internalChannelConnectorsResponseSchema,
  internalEgressProviderPolicySchema,
  internalEgressStatusResponseSchema,
  internalOrgStructureResponseSchema,
  internalOrgUnitUpsertRequestSchema,
  internalRbacDirectGrantCreateRequestSchema,
  internalRbacDirectGrantResponseSchema,
  internalRbacDirectGrantsResponseSchema,
  internalRbacRoleBindingCreateRequestSchema,
  internalRbacRoleBindingResponseSchema,
  internalRbacRoleBindingsResponseSchema,
  internalRbacRoleMutationRequestSchema,
  internalRbacRoleResponseSchema,
  internalRbacRolesResponseSchema,
  internalSourceConnectionCreateRequestSchema,
  internalSourceConnectionCreateResponseSchema,
  internalTenantBrandResponseSchema,
  internalTenantBrandUpdateRequestSchema,
  internalTelegramIntegrationResponseSchema,
  internalTelegramIntegrationUpdateRequestSchema,
  internalWorkQueueUpsertRequestSchema
} from "./internal-api-v1";

describe("internal API v1 schemas", () => {
  it("requires an idempotent source-onboarding command and exposes a safe replay receipt", () => {
    expect(
      internalSourceConnectionCreateRequestSchema.parse({
        sourceName: "megapbx",
        clientMutationId: "client-mutation:source-onboarding-1",
        displayName: "Sales PBX"
      })
    ).toMatchObject({
      clientMutationId: "client-mutation:source-onboarding-1"
    });
    expect(() =>
      internalSourceConnectionCreateRequestSchema.parse({
        sourceName: "megapbx",
        displayName: "Sales PBX"
      })
    ).toThrow();

    const replay = internalSourceConnectionCreateResponseSchema.parse({
      connection: {
        sourceConnectionId: "source_connection:megapbx:stable",
        sourceName: "megapbx",
        sourceType: "phone",
        displayName: "Sales PBX",
        status: "onboarding",
        authType: "webhook_secret",
        createdAt: "2026-07-16T10:00:00.000Z",
        updatedAt: "2026-07-16T10:00:00.000Z"
      },
      command: {
        outcome: "already_applied",
        commandId: "command:source-onboarding-1",
        clientMutationId: "client-mutation:source-onboarding-1",
        mutationId: "source-onboarding:mutation-1",
        publicResultCode: "core:source-connection.created",
        streamCommitId: "commit:source-onboarding-1",
        streamEpoch: "stream:source-onboarding-1",
        streamPosition: "1",
        committedAt: "2026-07-16T10:00:00.000Z"
      }
    });

    expect(replay.command.outcome).toBe("already_applied");
    expect(replay.command.clientMutationId).toBe(
      "client-mutation:source-onboarding-1"
    );
    expect(replay).not.toHaveProperty("webhookToken");
  });

  it("defines a stable internal error envelope", () => {
    expect(
      internalApiErrorResponseSchema.parse({
        error: {
          code: "permission.denied",
          messageKey: "errors.permission.denied",
          retryability: "not_retryable",
          requestId: "request-1"
        }
      })
    ).toMatchObject({
      error: {
        code: "permission.denied"
      }
    });
  });

  it("parses tenant brand update requests and responses", () => {
    expect(
      internalTenantBrandUpdateRequestSchema.parse({
        productName: " Acme Desk ",
        shortProductName: " Acme ",
        assets: {
          logoLight: " /brand-assets/brand-asset%3A1/logo.png?v=hash "
        },
        themeTokens: {
          "color.brand.primary": "#177f75"
        }
      })
    ).toEqual({
      productName: "Acme Desk",
      shortProductName: "Acme",
      assets: {
        logoLight: "/brand-assets/brand-asset%3A1/logo.png?v=hash"
      },
      themeTokens: {
        "color.brand.primary": "#177f75"
      }
    });

    expect(
      internalTenantBrandResponseSchema.parse({
        brand: {
          id: "brand-1",
          scope: "tenant",
          tenantId: "tenant-1",
          productName: "Acme Desk",
          assets: {},
          themeTokens: {
            "color.brand.primary": "#177f75"
          },
          links: {}
        }
      })
    ).toMatchObject({
      brand: {
        productName: "Acme Desk"
      }
    });
  });

  it("parses org structure responses and scoped upsert requests", () => {
    expect(
      internalOrgStructureResponseSchema.parse({
        orgUnits: [
          {
            id: "org-sales",
            parentOrgUnitId: null,
            name: "Sales",
            kind: "department",
            status: "active"
          }
        ],
        workQueues: [
          {
            id: "queue-sales",
            name: "Sales queue",
            kind: "sales",
            owningOrgUnitId: "org-sales",
            status: "active",
            routingConfig: {
              priority: "normal"
            }
          }
        ]
      })
    ).toMatchObject({
      orgUnits: [
        {
          id: "org-sales"
        }
      ],
      workQueues: [
        {
          owningOrgUnitId: "org-sales"
        }
      ]
    });

    expect(
      internalOrgUnitUpsertRequestSchema.parse({
        name: " Sales ",
        parentOrgUnitId: null
      })
    ).toEqual({
      name: "Sales",
      kind: "department",
      parentOrgUnitId: null,
      status: "active"
    });

    expect(
      internalWorkQueueUpsertRequestSchema.parse({
        name: " Claims ",
        kind: "claims"
      })
    ).toEqual({
      name: "Claims",
      kind: "claims",
      status: "active",
      routingConfig: {}
    });

    expect(() =>
      internalOrgUnitUpsertRequestSchema.parse({
        name: "Sales",
        tenantId: "tenant-1"
      })
    ).toThrow();
    expect(() =>
      internalWorkQueueUpsertRequestSchema.parse({
        name: "Sales",
        kind: "unknown"
      })
    ).toThrow();
  });

  it("parses access decision requests and safe diagnostics", () => {
    expect(
      internalAccessDecisionRequestSchema.parse({
        employeeId: " employee-2 ",
        permission: " conversation.read ",
        resource: {
          queueId: " queue-sales ",
          assignedEmployeeId: "employee-2"
        },
        at: "2026-06-24T10:00:00.000Z"
      })
    ).toEqual({
      employeeId: "employee-2",
      permission: "conversation.read",
      resource: {
        queueId: "queue-sales",
        assignedEmployeeId: "employee-2"
      },
      at: "2026-06-24T10:00:00.000Z"
    });

    expect(
      internalAccessDecisionResponseSchema.parse({
        employeeId: "employee-2",
        permission: "conversation.read",
        resource: {
          queueId: "queue-sales",
          assignedEmployeeId: "employee-2"
        },
        evaluatedAt: "2026-06-24T10:00:00.000Z",
        decision: {
          allowed: true,
          reason: "allowed",
          matchedGrant: {
            permission: "conversation.read",
            scope: {
              type: "assigned"
            },
            sources: [
              {
                type: "role_binding",
                roleId: "role-sales",
                bindingId: "binding-1"
              }
            ]
          }
        },
        candidateGrants: [
          {
            permission: "conversation.read",
            scope: {
              type: "assigned"
            },
            sources: [
              {
                type: "role_binding",
                roleId: "role-sales"
              }
            ]
          }
        ],
        effectiveGrantCount: 3
      })
    ).toMatchObject({
      decision: {
        allowed: true,
        reason: "allowed"
      },
      candidateGrants: [
        {
          scope: {
            type: "assigned"
          }
        }
      ]
    });

    expect(() =>
      internalAccessDecisionRequestSchema.parse({
        employeeId: "employee-2",
        permission: "conversation.read",
        tenantId: "tenant-1"
      })
    ).toThrow();
    expect(() =>
      internalAccessDecisionRequestSchema.parse({
        employeeId: "employee-2",
        permission: "conversation.read",
        resource: {
          queueId: "queue-sales",
          tenantId: "tenant-1"
        }
      })
    ).toThrow();
  });

  it("parses RBAC role management requests and responses", () => {
    expect(
      internalRbacRoleMutationRequestSchema.parse({
        name: " Sales ",
        description: " Sales role ",
        permissions: [" conversation.read ", "message.reply"]
      })
    ).toEqual({
      name: "Sales",
      description: "Sales role",
      permissions: ["conversation.read", "message.reply"]
    });

    expect(
      internalRbacRolesResponseSchema.parse({
        roles: [
          {
            id: "role-sales",
            name: "Sales",
            description: null,
            status: "active",
            isSystem: false,
            permissions: ["conversation.read", "message.reply"],
            createdByEmployeeId: "employee-1"
          }
        ]
      })
    ).toMatchObject({
      roles: [
        {
          id: "role-sales",
          status: "active"
        }
      ]
    });

    expect(
      internalRbacRoleResponseSchema.parse({
        role: {
          id: "role-sales",
          name: "Sales",
          description: null,
          status: "archived",
          isSystem: false,
          permissions: ["conversation.read"],
          createdByEmployeeId: "employee-1",
          archivedAt: "2026-06-24T10:00:00.000Z"
        }
      })
    ).toMatchObject({
      role: {
        archivedAt: "2026-06-24T10:00:00.000Z"
      }
    });

    expect(() =>
      internalRbacRoleMutationRequestSchema.parse({
        name: "Sales",
        permissions: [],
        tenantId: "tenant-1"
      })
    ).toThrow();
  });

  it("parses RBAC role binding contracts without tenant ids in request bodies", () => {
    expect(
      internalRbacRoleBindingCreateRequestSchema.parse({
        roleId: " role-sales ",
        subject: {
          type: "employee",
          id: " employee-2 "
        },
        scope: {
          type: "queue",
          id: " queue-sales "
        },
        expiresAt: "2026-07-24T10:00:00.000Z"
      })
    ).toEqual({
      roleId: "role-sales",
      subject: {
        type: "employee",
        id: "employee-2"
      },
      scope: {
        type: "queue",
        id: "queue-sales"
      },
      expiresAt: "2026-07-24T10:00:00.000Z"
    });

    expect(
      internalRbacRoleBindingsResponseSchema.parse({
        roleBindings: [
          {
            id: "binding-sales",
            roleId: "role-sales",
            subject: {
              type: "team",
              id: "team-sales"
            },
            scope: {
              type: "tenant"
            }
          }
        ]
      })
    ).toMatchObject({
      roleBindings: [
        {
          subject: {
            type: "team"
          }
        }
      ]
    });

    expect(
      internalRbacRoleBindingResponseSchema.parse({
        roleBinding: {
          id: "binding-sales",
          roleId: "role-sales",
          subject: {
            type: "employee",
            id: "employee-2"
          },
          scope: {
            type: "assigned"
          }
        }
      })
    ).toMatchObject({
      roleBinding: {
        scope: {
          type: "assigned"
        }
      }
    });

    expect(() =>
      internalRbacRoleBindingCreateRequestSchema.parse({
        roleId: "role-sales",
        subject: {
          type: "employee",
          id: "employee-2"
        },
        scope: {
          type: "queue"
        },
        tenantId: "tenant-1"
      })
    ).toThrow();
  });

  it("parses RBAC direct grant contracts and trims reasons", () => {
    expect(
      internalRbacDirectGrantCreateRequestSchema.parse({
        employeeId: " employee-2 ",
        permission: " conversation.assign ",
        scope: {
          type: "queue",
          id: " queue-sales "
        },
        reason: " temporary coverage "
      })
    ).toEqual({
      employeeId: "employee-2",
      permission: "conversation.assign",
      scope: {
        type: "queue",
        id: "queue-sales"
      },
      reason: "temporary coverage"
    });

    expect(
      internalRbacDirectGrantsResponseSchema.parse({
        directGrants: [
          {
            id: "grant-sales",
            employeeId: "employee-2",
            permission: "conversation.assign",
            scope: {
              type: "queue",
              id: "queue-sales"
            },
            reason: "temporary coverage"
          }
        ]
      })
    ).toMatchObject({
      directGrants: [
        {
          permission: "conversation.assign"
        }
      ]
    });

    expect(
      internalRbacDirectGrantResponseSchema.parse({
        directGrant: {
          id: "grant-sales",
          employeeId: "employee-2",
          permission: "conversation.assign",
          scope: {
            type: "queue",
            id: "queue-sales"
          },
          reason: "temporary coverage",
          expiresAt: "2026-07-24T10:00:00.000Z"
        }
      })
    ).toMatchObject({
      directGrant: {
        expiresAt: "2026-07-24T10:00:00.000Z"
      }
    });

    expect(() =>
      internalRbacDirectGrantCreateRequestSchema.parse({
        employeeId: "employee-2",
        permission: "conversation.assign",
        scope: {
          type: "assigned",
          id: "employee-2"
        },
        reason: "temporary coverage"
      })
    ).toThrow();
  });

  it("parses Telegram integration responses without raw provider secrets", () => {
    expect(
      internalTelegramIntegrationResponseSchema.parse({
        moduleId: "channel-telegram",
        enabled: true,
        setupStep: "complete",
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          outboundEnabled: true
        },
        webhookPath: "/webhooks/telegram/telegram-local",
        publicWebhookUrl:
          "https://example.test/webhooks/telegram/telegram-local",
        diagnostics: {
          status: "configured",
          checkedAt: "2026-06-22T10:00:00.000Z",
          bot: {
            id: "100",
            username: "hulee_test_bot"
          },
          webhook: {
            expectedUrl:
              "https://example.test/webhooks/telegram/telegram-local",
            actualUrl: "https://example.test/webhooks/telegram/telegram-local",
            pendingUpdateCount: 0
          },
          egress: {
            required: true,
            status: "unknown",
            profileKind: "vpn_namespace",
            checkedAt: "2026-06-22T10:00:00.000Z"
          },
          runtime: {
            inbound: {
              lastSource: "webhook",
              lastReceivedAt: "2026-06-22T10:00:01.000Z",
              lastAcceptedAt: "2026-06-22T10:00:01.000Z",
              lastRequestId: "telegram-webhook-request-1",
              lastUpdateId: 1001,
              lastProviderMessageId: "9001:77",
              lastBatchReceivedCount: 1,
              lastBatchAcceptedCount: 1,
              lastBatchFailedCount: 0
            },
            outbound: {
              lastAttemptAt: "2026-06-22T10:01:00.000Z",
              lastSentAt: "2026-06-22T10:01:00.000Z",
              lastMessageId: "message-1",
              lastProviderMessageId: "telegram-message-1"
            }
          },
          polling: {
            lastUpdateId: 1002,
            lastRunAt: "2026-06-22T10:00:02.000Z",
            receivedUpdateCount: 2,
            acceptedUpdateCount: 1,
            failedUpdateCount: 1,
            recentFailedUpdates: [
              {
                updateId: 1002,
                requestId: "telegram-polling:tenant-1:telegram-local:1002",
                failedAt: "2026-06-22T10:00:02.000Z",
                errorCode: "validation.failed",
                errorMessage:
                  "Telegram update does not contain text or supported attachments.",
                updateType: "message",
                providerMessageId: "9001:77",
                chatType: "private",
                contentTypes: ["sticker"]
              }
            ]
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
        }
      })
    ).toMatchObject({
      moduleId: "channel-telegram",
      setupStep: "complete",
      config: {
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN"
      },
      diagnostics: {
        polling: {
          recentFailedUpdates: [
            {
              updateId: 1002,
              errorCode: "validation.failed",
              contentTypes: ["sticker"]
            }
          ]
        }
      }
    });
  });

  it("parses channel catalog and connector summaries", () => {
    const markdownDescription = [
      "## Telegram Bot",
      "",
      "Use **BotFather** to create a bot.",
      "",
      "- inbound messages",
      "- outbound messages",
      "",
      "Open [Telegram](https://telegram.org) after setup.",
      "",
      "Detailed setup notes. ".repeat(40)
    ].join("\n");

    expect(
      internalChannelCatalogResponseSchema.parse({
        channels: [
          {
            channelType: "telegram_bot",
            channelClass: "bot_bridge",
            provider: "telegram",
            titleKey: "integrations.catalog.telegramBot.title",
            titleOverrides: {
              ru: "Telegram"
            },
            shortDescriptionKey: "integrations.catalog.telegramBot.description",
            shortDescriptionOverrides: {
              ru: "Telegram bot"
            },
            descriptionKey: "integrations.catalog.telegramBot.description",
            descriptionOverrides: {
              ru: markdownDescription
            },
            iconAssetRef: "deployment/channel-icons/telegram_bot/hash.webp",
            iconUrl: "/channel-assets/telegram_bot/icon?v=hash.webp",
            sortOrder: 10,
            visibility: "visible",
            readiness: "available",
            supportsMultiple: true,
            capabilities: ["inbound", "outbound", "webhook"],
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
              steps: [
                {
                  id: "name",
                  kind: "display_name",
                  titleKey: "integrations.channel.onboarding.name",
                  action: "update_connector"
                },
                {
                  id: "complete",
                  kind: "complete",
                  titleKey: "integrations.channel.onboarding.complete"
                }
              ]
            }
          }
        ]
      })
    ).toMatchObject({
      channels: [
        {
          channelType: "telegram_bot",
          readiness: "available",
          egressRequirement: {
            required: true,
            defaultProfileKind: "vpn_namespace"
          },
          onboarding: {
            steps: expect.arrayContaining([
              expect.objectContaining({
                id: "name"
              })
            ])
          }
        }
      ]
    });

    expect(() =>
      internalChannelCatalogResponseSchema.parse({
        channels: [
          {
            channelType: "telegram_bot",
            channelClass: "bot_bridge",
            provider: "telegram",
            titleKey: "integrations.catalog.telegramBot.title",
            descriptionKey: "integrations.catalog.telegramBot.description",
            readiness: "available",
            supportsMultiple: true,
            capabilities: ["inbound", "outbound", "webhook"],
            egressRequirement: {
              required: true,
              defaultProfileKind: "vpn_namespace",
              allowedProfileKinds: ["http_proxy"],
              enforcementScope: "hulee_managed_saas"
            },
            onboarding: {
              version: "v1",
              steps: [
                {
                  id: "complete",
                  kind: "complete",
                  titleKey: "integrations.channel.onboarding.complete"
                }
              ]
            }
          }
        ]
      })
    ).toThrow();

    expect(
      internalChannelConnectorsResponseSchema.parse({
        connectors: [
          {
            connectorId: "telegram_bot:tenant-1",
            channelType: "telegram_bot",
            channelClass: "bot_bridge",
            provider: "telegram",
            displayName: "Telegram Bot",
            status: "connected",
            healthStatus: "healthy",
            channelExternalId: "telegram-local",
            diagnosticsStatus: "configured"
          }
        ]
      })
    ).toMatchObject({
      connectors: [
        {
          connectorId: "telegram_bot:tenant-1",
          status: "connected"
        }
      ]
    });
  });

  it("parses safe egress status responses without runtime secrets", () => {
    expect(
      internalEgressStatusResponseSchema.parse({
        profiles: [
          {
            profileId: "managed-messenger-vpn",
            profileKind: "vpn_namespace",
            status: "ready",
            source: "runtime_probe",
            checkedAt: "2026-06-29T10:00:00.000Z",
            alertSeverity: "none",
            consecutiveFailures: 0,
            lastReadyAt: "2026-06-29T10:00:00.000Z",
            publicIp: "178.212.32.166",
            probes: [
              {
                name: "https.connectivity",
                target: "https://www.gstatic.com/generate_204",
                status: "success",
                checkedAt: "2026-06-29T10:00:00.000Z",
                latencyMs: 80,
                httpStatus: 204
              }
            ],
            supportedProviders: ["telegram", "whatsapp"],
            supportedChannelTypes: ["telegram_bot", "whatsapp_qr_bridge"]
          }
        ]
      })
    ).toMatchObject({
      profiles: [
        {
          profileKind: "vpn_namespace",
          status: "ready",
          source: "runtime_probe",
          alertSeverity: "none"
        }
      ]
    });

    expect(() =>
      internalEgressStatusResponseSchema.parse({
        profiles: [
          {
            profileId: "managed-messenger-vpn",
            profileKind: "vpn_namespace",
            status: "ready",
            source: "deployment_config",
            checkedAt: "2026-06-29T10:00:00.000Z",
            proxyPassword: "secret"
          }
        ]
      })
    ).toThrow();
  });

  it("parses deployment egress provider policies", () => {
    expect(
      internalEgressProviderPolicySchema.parse({
        provider: "telegram",
        routingMode: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway",
        required: true,
        source: "platform_policy",
        supportedChannelTypes: ["telegram_bot", "telegram_qr_bridge"],
        allowedProfileKinds: [
          "vpn_namespace",
          "direct",
          "http_proxy",
          "socks_proxy",
          "customer_network",
          "disabled"
        ],
        updatedAt: "2026-06-29T16:00:00.000Z",
        updatedByPlatformAdminAccountId: "platform-admin-1"
      })
    ).toMatchObject({
      provider: "telegram",
      routingMode: "vpn_namespace",
      source: "platform_policy",
      supportedChannelTypes: ["telegram_bot", "telegram_qr_bridge"]
    });

    expect(() =>
      internalEgressProviderPolicySchema.parse({
        provider: "telegram",
        routingMode: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway",
        required: true,
        source: "platform_policy",
        supportedChannelTypes: ["telegram_bot"],
        allowedProfileKinds: ["direct"]
      })
    ).toThrow();

    expect(() =>
      internalEgressProviderPolicySchema.parse({
        provider: "telegram",
        routingMode: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway",
        required: true,
        source: "platform_policy",
        supportedChannelTypes: ["telegram_bot"],
        allowedProfileKinds: ["vpn_namespace"],
        nordvpnToken: "secret"
      })
    ).toThrow();
  });

  it("parses channel connector create requests", () => {
    expect(
      internalChannelConnectorCreateRequestSchema.parse({
        channelType: "telegram_bot",
        displayName: "Sales Telegram"
      })
    ).toEqual({
      channelType: "telegram_bot",
      displayName: "Sales Telegram"
    });
  });

  it("parses active auth challenge metadata in channel connector summaries", () => {
    expect(
      internalChannelConnectorsResponseSchema.parse({
        connectors: [
          {
            connectorId: "telegram_qr_bridge:tenant-1",
            channelType: "telegram_qr_bridge",
            channelClass: "user_bridge",
            provider: "telegram",
            displayName: "Telegram account",
            status: "failed",
            healthStatus: "unhealthy",
            activeAuthChallenge: {
              challengeId: "channel_auth_challenge:tenant-1",
              challengeType: "qr",
              status: "waiting",
              expiresAt: "2026-06-29T10:00:00.000Z"
            }
          }
        ]
      })
    ).toMatchObject({
      connectors: [
        {
          activeAuthChallenge: {
            challengeType: "qr",
            status: "waiting"
          }
        }
      ]
    });
  });

  it("parses channel auth challenge contracts without secret payloads", () => {
    expect(
      internalChannelAuthChallengeStartRequestSchema.parse({
        challengeType: "phone_code",
        phoneNumber: " +79990000000 "
      })
    ).toEqual({
      challengeType: "phone_code",
      phoneNumber: "+79990000000"
    });

    expect(
      internalChannelAuthChallengeSubmitRequestSchema.parse({
        code: " 12345 "
      })
    ).toEqual({
      code: "12345"
    });

    expect(
      internalChannelAuthChallengeCancelRequestSchema.parse(undefined)
    ).toEqual({});
    expect(
      internalChannelAuthChallengeCancelRequestSchema.parse({
        resetSession: true
      })
    ).toEqual({
      resetSession: true
    });

    expect(
      internalChannelAuthChallengeResponseSchema.parse({
        challenge: {
          challengeId: "challenge-1",
          connectorId: "telegram_qr_bridge:tenant-1",
          challengeType: "qr",
          status: "waiting",
          publicPayload: {
            qrPayloadRef: "qr-ref-1",
            expiresAt: "2026-06-29T10:00:00.000Z"
          },
          expiresAt: "2026-06-29T10:00:00.000Z",
          createdAt: "2026-06-29T09:55:00.000Z",
          updatedAt: "2026-06-29T09:55:00.000Z"
        }
      })
    ).toMatchObject({
      challenge: {
        challengeId: "challenge-1",
        publicPayload: {
          qrPayloadRef: "qr-ref-1"
        }
      }
    });

    expect(() =>
      internalChannelAuthChallengeResponseSchema.parse({
        challenge: {
          challengeId: "challenge-1",
          connectorId: "telegram_qr_bridge:tenant-1",
          challengeType: "qr",
          status: "waiting",
          publicPayload: {},
          secretPayloadEncrypted: "encrypted-session",
          createdAt: "2026-06-29T09:55:00.000Z",
          updatedAt: "2026-06-29T09:55:00.000Z"
        }
      })
    ).toThrow();
  });

  it("allows Telegram updates to carry a write-only bot token", () => {
    expect(
      internalTelegramIntegrationUpdateRequestSchema.parse({
        connectorId: "telegram_bot:tenant-1",
        enabled: true,
        setupStepCompleted: "token",
        channelExternalId: "telegram-local",
        botToken: "telegram-token",
        outboundEnabled: true
      })
    ).toEqual({
      connectorId: "telegram_bot:tenant-1",
      enabled: true,
      setupStepCompleted: "token",
      channelExternalId: "telegram-local",
      mode: "webhook",
      botToken: "telegram-token",
      outboundEnabled: true
    });

    expect(() =>
      internalTelegramIntegrationResponseSchema.parse({
        moduleId: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botToken: "telegram-token",
          outboundEnabled: true
        },
        diagnostics: {
          status: "configured",
          checkedAt: "2026-06-22T10:00:00.000Z",
          checks: {
            moduleEnabled: true,
            configValid: true,
            inboundWebhookReady: true,
            outboundEnabled: true,
            botTokenSecretRefConfigured: true
          }
        }
      })
    ).toThrow();
  });
});
