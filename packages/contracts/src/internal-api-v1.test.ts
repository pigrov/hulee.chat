import { describe, expect, it } from "vitest";

import {
  internalApiErrorResponseSchema,
  internalAccessDecisionRequestSchema,
  internalAccessDecisionResponseSchema,
  internalChannelAuthChallengeResponseSchema,
  internalChannelAuthChallengeStartRequestSchema,
  internalChannelAuthChallengeSubmitRequestSchema,
  internalChannelCatalogResponseSchema,
  internalChannelConnectorCreateRequestSchema,
  internalChannelConnectorsResponseSchema,
  internalEgressStatusResponseSchema,
  internalInboxConversationRoutingUpdateRequestSchema,
  internalInboxConversationRoutingUpdateResponseSchema,
  internalInboxReplyRequestSchema,
  internalInboxViewResponseSchema,
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
  internalTenantBrandResponseSchema,
  internalTenantBrandUpdateRequestSchema,
  internalTelegramIntegrationResponseSchema,
  internalTelegramIntegrationUpdateRequestSchema,
  internalWorkQueueUpsertRequestSchema
} from "./internal-api-v1";

describe("internal API v1 schemas", () => {
  it("parses an inbox view response with tenant brand context", () => {
    expect(
      internalInboxViewResponseSchema.parse({
        tenant: {
          tenantId: "tenant-1",
          displayName: "Acme",
          deploymentType: "saas_shared",
          locale: "en",
          timezone: "UTC",
          brand: {
            id: "brand-1",
            scope: "tenant",
            tenantId: "tenant-1",
            productName: "Acme Desk",
            assets: {},
            themeTokens: {},
            links: {}
          }
        },
        conversations: [
          {
            id: "conversation-1",
            clientId: "client-1",
            clientDisplayName: "Alice",
            status: "open",
            source: "telegram",
            currentQueueId: "queue-sales",
            currentQueueName: "Sales",
            assignedEmployeeId: "employee-1",
            assignedEmployeeDisplayName: "Agent",
            assignedTeamId: "team-sales",
            assignedTeamName: "Sales team",
            messageCount: 2,
            queuedCount: 0
          }
        ],
        messages: []
      })
    ).toMatchObject({
      tenant: {
        tenantId: "tenant-1",
        brand: {
          productName: "Acme Desk"
        }
      },
      conversations: [
        {
          currentQueueName: "Sales",
          assignedEmployeeDisplayName: "Agent",
          assignedTeamName: "Sales team"
        }
      ]
    });
  });

  it("normalizes reply text and rejects empty replies", () => {
    expect(
      internalInboxReplyRequestSchema.parse({
        text: "  Hello  "
      })
    ).toEqual({
      text: "Hello"
    });
    expect(() =>
      internalInboxReplyRequestSchema.parse({ text: " " })
    ).toThrow();
  });

  it("parses conversation routing updates with nullable clear fields", () => {
    expect(
      internalInboxConversationRoutingUpdateRequestSchema.parse({
        currentQueueId: " queue-sales ",
        assignedEmployeeId: null
      })
    ).toEqual({
      currentQueueId: "queue-sales",
      assignedEmployeeId: null
    });

    expect(
      internalInboxConversationRoutingUpdateResponseSchema.parse({
        conversationId: "conversation-1",
        currentQueueId: "queue-sales"
      })
    ).toEqual({
      conversationId: "conversation-1",
      currentQueueId: "queue-sales"
    });

    expect(() =>
      internalInboxConversationRoutingUpdateRequestSchema.parse({})
    ).toThrow();
    expect(() =>
      internalInboxConversationRoutingUpdateRequestSchema.parse({
        currentQueueId: ""
      })
    ).toThrow();
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
        themeTokens: {
          "color.brand.primary": "#177f75"
        }
      })
    ).toEqual({
      productName: "Acme Desk",
      shortProductName: "Acme",
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
      }
    });
  });

  it("parses channel catalog and connector summaries", () => {
    expect(
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
