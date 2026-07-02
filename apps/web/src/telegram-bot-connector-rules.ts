import type {
  InternalChannelConnectorSummary,
  InternalTelegramIntegrationResponse
} from "@hulee/contracts";

const defaultTelegramDisplayName = "Telegram Bot";

type TelegramBotIdentity = {
  readonly id: string;
  readonly username?: string;
  readonly firstName?: string;
};

export type TelegramBotDuplicateCandidate = {
  readonly connector: InternalChannelConnectorSummary;
  readonly integration?: Pick<
    InternalTelegramIntegrationResponse,
    "diagnostics"
  >;
};

export function selectDuplicateTelegramBotConnector(input: {
  readonly bot: TelegramBotIdentity;
  readonly candidates: readonly TelegramBotDuplicateCandidate[];
}): InternalChannelConnectorSummary | undefined {
  const botUsername = input.bot.username?.toLowerCase();
  const expectedDisplayName = telegramDisplayNameFromValidatedBot(
    input.bot
  ).toLowerCase();

  return input.candidates.find(({ connector, integration }) => {
    const existingBot = integration?.diagnostics.bot;

    if (!existingBot) {
      return connector.displayName.trim().toLowerCase() === expectedDisplayName;
    }

    return (
      existingBot.id === input.bot.id ||
      (botUsername !== undefined &&
        existingBot.username?.toLowerCase() === botUsername)
    );
  })?.connector;
}

export function telegramDisplayNameFromValidatedBot(
  input: Pick<TelegramBotIdentity, "username" | "firstName">
): string {
  const providerName = input.username
    ? `@${input.username}`
    : input.firstName?.trim();

  return providerName
    ? `${defaultTelegramDisplayName} (${providerName})`
    : defaultTelegramDisplayName;
}
