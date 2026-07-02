import { describe, expect, it } from "vitest";
import type {
  InternalChannelConnectorSummary,
  InternalTelegramIntegrationResponse
} from "@hulee/contracts";

import {
  selectDuplicateTelegramBotConnector,
  telegramDisplayNameFromValidatedBot,
  type TelegramBotDuplicateCandidate
} from "./telegram-bot-connector-rules";

describe("telegram bot connector rules", () => {
  it("formats default display name from validated bot identity", () => {
    expect(
      telegramDisplayNameFromValidatedBot({ username: "hulee_test_bot" })
    ).toBe("Telegram Bot (@hulee_test_bot)");
    expect(telegramDisplayNameFromValidatedBot({ firstName: "Hulee" })).toBe(
      "Telegram Bot (Hulee)"
    );
    expect(telegramDisplayNameFromValidatedBot({})).toBe("Telegram Bot");
  });

  it("selects existing connector by Telegram bot id or username", () => {
    const first = connector("telegram_bot:first");
    const second = connector("telegram_bot:second");

    expect(
      selectDuplicateTelegramBotConnector({
        bot: {
          id: "200",
          username: "HULEE_BOT"
        },
        candidates: [
          candidate(first, { id: "100", username: "another_bot" }),
          candidate(second, { id: "300", username: "hulee_bot" })
        ]
      })
    ).toBe(second);

    expect(
      selectDuplicateTelegramBotConnector({
        bot: {
          id: "100"
        },
        candidates: [
          candidate(first, { id: "100", username: "another_bot" }),
          candidate(second, { id: "300", username: "hulee_bot" })
        ]
      })
    ).toBe(first);
  });

  it("uses default display name as fallback while bot identity is not stored yet", () => {
    expect(
      selectDuplicateTelegramBotConnector({
        bot: {
          id: "100",
          username: "hulee_bot"
        },
        candidates: [
          {
            connector: {
              ...connector("telegram_bot:first"),
              displayName: "Telegram Bot (@hulee_bot)"
            }
          }
        ]
      })?.connectorId
    ).toBe("telegram_bot:first");

    expect(
      selectDuplicateTelegramBotConnector({
        bot: {
          id: "100",
          username: "hulee_bot"
        },
        candidates: [
          {
            connector: connector("telegram_bot:first")
          }
        ]
      })
    ).toBeUndefined();
  });
});

function candidate(
  connectorRecord: InternalChannelConnectorSummary,
  bot: { id: string; username?: string }
): TelegramBotDuplicateCandidate {
  return {
    connector: connectorRecord,
    integration: {
      diagnostics: {
        status: "configured",
        checkedAt: "2026-07-02T00:00:00.000Z",
        bot,
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
    } satisfies Pick<InternalTelegramIntegrationResponse, "diagnostics">
  };
}

function connector(connectorId: string): InternalChannelConnectorSummary {
  return {
    connectorId,
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    provider: "telegram",
    displayName: "Telegram Bot",
    status: "connected",
    healthStatus: "healthy",
    channelExternalId: connectorId,
    diagnosticsStatus: "configured"
  };
}
