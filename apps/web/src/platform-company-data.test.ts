import type { ChannelConnectorRecord } from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  platformChannelConnectorFromRecord,
  platformTelegramIntegrationFromRecord
} from "./platform-company-data";

describe("platform company data", () => {
  it("maps safe channel connector metadata from a data-plane record", () => {
    const connector = platformChannelConnectorFromRecord(
      telegramConnectorRecord()
    );

    expect(connector).toMatchObject({
      connectorId: "telegram-connector-1",
      channelType: "telegram_bot",
      channelClass: "bot_bridge",
      provider: "telegram",
      status: "degraded",
      healthStatus: "degraded",
      channelExternalId: "tgwh_1",
      diagnosticsStatus: "provider_unreachable",
      egress: {
        status: "ready",
        profileKind: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway"
      }
    });
  });

  it("builds a Telegram diagnostics view without raw secrets", () => {
    const integration = platformTelegramIntegrationFromRecord({
      publicWebhookBaseUrl: "https://chat.example.test",
      record: telegramConnectorRecord()
    });

    expect(integration).toMatchObject({
      moduleId: "channel-telegram",
      connectorId: "telegram-connector-1",
      channelType: "telegram_bot",
      channelClass: "bot_bridge",
      displayName: "Telegram",
      status: "degraded",
      enabled: true,
      webhookPath: "/webhooks/telegram/tgwh_1",
      publicWebhookUrl: "https://chat.example.test/webhooks/telegram/tgwh_1"
    });
    expect(integration?.diagnostics.runtime?.inbound?.lastReceivedAt).toBe(
      "2026-07-01T01:00:00.000Z"
    );
    expect(JSON.stringify(integration)).not.toContain("123456:secret");
  });

  it("does not expose malformed Telegram diagnostics as a valid view", () => {
    const integration = platformTelegramIntegrationFromRecord({
      record: {
        ...telegramConnectorRecord(),
        diagnostics: { status: "configured" }
      }
    });

    expect(integration).toBeNull();
  });
});

function telegramConnectorRecord(): ChannelConnectorRecord {
  return {
    id: "telegram-connector-1" as never,
    tenantId: "tenant-1" as never,
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    provider: "telegram",
    displayName: "Telegram",
    status: "degraded",
    healthStatus: "degraded",
    capabilities: {},
    onboardingState: {},
    config: {
      channelExternalId: "tgwh_1",
      mode: "polling",
      botTokenSecretRef: "tenant_secret:bot-token",
      webhookConnectorId: "tgwh_1",
      outboundEnabled: true
    },
    diagnostics: {
      status: "provider_unreachable",
      lastErrorCode: "provider.permanent_failure",
      operatorHint:
        "Telegram getUpdates failed because Telegram polling conflicts with an active webhook or another polling consumer. Delete the webhook, stop the other consumer or switch this channel to webhook mode, then run the check again.",
      checkedAt: "2026-07-01T01:01:00.000Z",
      bot: {
        id: "42",
        username: "Hulee_Bot"
      },
      webhook: {
        expectedUrl: "https://chat.example.test/webhooks/telegram/tgwh_1",
        actualUrl: "https://chat.example.test/webhooks/telegram/tgwh_1",
        pendingUpdateCount: 2
      },
      polling: {
        lastUpdateId: 10,
        lastRunAt: "2026-07-01T01:01:00.000Z",
        receivedUpdateCount: 1,
        acceptedUpdateCount: 0,
        failedUpdateCount: 1
      },
      runtime: {
        inbound: {
          lastSource: "polling",
          lastReceivedAt: "2026-07-01T01:00:00.000Z",
          lastFailedAt: "2026-07-01T01:01:00.000Z",
          lastErrorCode: "provider.permanent_failure",
          operatorHint:
            "Telegram getUpdates failed because Telegram polling conflicts with an active webhook or another polling consumer. Delete the webhook, stop the other consumer or switch this channel to webhook mode, then run the check again."
        },
        outbound: {
          lastSentAt: "2026-07-01T01:02:00.000Z"
        }
      },
      egress: {
        required: true,
        status: "ready",
        profileKind: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway",
        checkedAt: "2026-07-01T01:01:00.000Z",
        operatorHint:
          "Provider traffic is routed through hulee_chat_vpn_gateway."
      },
      checks: {
        moduleEnabled: true,
        configValid: true,
        inboundWebhookReady: false,
        outboundEnabled: true,
        botTokenSecretRefConfigured: true,
        botTokenResolved: true,
        botApiReachable: false,
        webhookMatchesConfig: true
      }
    },
    createdByEmployeeId: "employee-1" as never,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T01:01:00.000Z")
  };
}
