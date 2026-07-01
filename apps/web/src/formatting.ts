import type { createTranslator } from "@hulee/i18n";

import type { TelegramIntegrationViewModel } from "./inbox-api-client";

type Translator = ReturnType<typeof createTranslator>["t"];

export function telegramStatusKey(
  status: TelegramIntegrationViewModel["diagnostics"]["status"]
):
  | "integrations.telegram.status.disabled"
  | "integrations.telegram.status.configured"
  | "integrations.telegram.status.invalid_config"
  | "integrations.telegram.status.provider_unreachable"
  | "integrations.telegram.status.webhook_mismatch" {
  return `integrations.telegram.status.${status}` as
    | "integrations.telegram.status.disabled"
    | "integrations.telegram.status.configured"
    | "integrations.telegram.status.invalid_config"
    | "integrations.telegram.status.provider_unreachable"
    | "integrations.telegram.status.webhook_mismatch";
}

export function formatBoolean(value: boolean, t: Translator): string {
  return t(value ? "common.yes" : "common.no");
}

export function formatOptionalBoolean(
  value: boolean | undefined,
  t: Translator
): string {
  return value === undefined ? t("common.unknown") : formatBoolean(value, t);
}

export function formatOptionalValue(
  value: number | string | undefined,
  t: Translator
): string {
  if (value === undefined || value === "") {
    return t("common.unknown");
  }

  return String(value);
}

export function formatOptionalDateTime(
  value: Date | string | undefined,
  locale: string,
  t: Translator
): string {
  return value === undefined
    ? t("common.unknown")
    : formatDateTime(value, locale);
}

export function formatTelegramBotIdentity(
  integration: TelegramIntegrationViewModel,
  t: Translator
): string {
  const bot = integration.diagnostics.bot;

  if (!bot) {
    return t("common.unknown");
  }

  return bot.username ? `@${bot.username}` : bot.id;
}

export function formatDateTime(value: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
