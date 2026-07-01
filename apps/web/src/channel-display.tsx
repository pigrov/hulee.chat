import type {
  InternalChannelCatalogItem,
  InternalChannelClass
} from "@hulee/contracts";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import { Bot, MessageCircle, Smartphone } from "lucide-react";
import type { ReactNode } from "react";

type Translator = ReturnType<typeof createTranslator>["t"];

export function resolveChannelTitle(input: {
  channel?: Pick<InternalChannelCatalogItem, "titleKey" | "titleOverrides">;
  locale: string;
  t: Translator;
  fallback: string;
}): string {
  return (
    resolveLocalizedOverride(input.channel?.titleOverrides, input.locale) ??
    (input.channel
      ? input.t(input.channel.titleKey as I18nMessageKey)
      : undefined) ??
    input.fallback
  );
}

export function resolveChannelDescription(input: {
  channel: Pick<
    InternalChannelCatalogItem,
    "descriptionKey" | "descriptionOverrides"
  >;
  locale: string;
  t: Translator;
}): string {
  return (
    resolveLocalizedOverride(
      input.channel.descriptionOverrides,
      input.locale
    ) ?? input.t(input.channel.descriptionKey as I18nMessageKey)
  );
}

export function resolveChannelShortDescription(input: {
  channel: Pick<
    InternalChannelCatalogItem,
    | "descriptionKey"
    | "descriptionOverrides"
    | "shortDescriptionKey"
    | "shortDescriptionOverrides"
  >;
  locale: string;
  t: Translator;
}): string {
  return (
    resolveLocalizedOverride(
      input.channel.shortDescriptionOverrides,
      input.locale
    ) ??
    (input.channel.shortDescriptionKey
      ? input.t(input.channel.shortDescriptionKey as I18nMessageKey)
      : undefined) ??
    resolveChannelDescription(input)
  );
}

export function ChannelIcon({
  channel,
  channelClass,
  size = "default"
}: {
  channel?: Pick<InternalChannelCatalogItem, "iconUrl" | "channelClass">;
  channelClass?: InternalChannelClass;
  size?: "default" | "large";
}): ReactNode {
  const iconSize = size === "large" ? 36 : 18;

  if (channel?.iconUrl) {
    return (
      <img
        className={
          size === "large"
            ? "channelIconImage channelIconImageLarge"
            : "channelIconImage"
        }
        src={channel.iconUrl}
        alt=""
        aria-hidden="true"
      />
    );
  }

  switch (channel?.channelClass ?? channelClass) {
    case "bot_bridge":
      return <Bot size={iconSize} aria-hidden="true" />;
    case "user_bridge":
      return <Smartphone size={iconSize} aria-hidden="true" />;
    case "official_api":
      return <MessageCircle size={iconSize} aria-hidden="true" />;
    default:
      return <MessageCircle size={iconSize} aria-hidden="true" />;
  }
}

export function ChannelBadge({
  channel,
  children,
  locale,
  t
}: {
  channel: InternalChannelCatalogItem;
  children?: ReactNode;
  locale: string;
  t: Translator;
}): ReactNode {
  return (
    <span className="badge">
      <ChannelIcon channel={channel} />
      {children ??
        resolveChannelTitle({
          channel,
          locale,
          t,
          fallback: channel.channelType
        })}
    </span>
  );
}

function resolveLocalizedOverride(
  overrides: Readonly<Record<string, string>> | undefined,
  locale: string
): string | undefined {
  if (!overrides) {
    return undefined;
  }

  const normalizedLocale = locale.toLowerCase();
  const language = normalizedLocale.split("-")[0];

  return (
    overrides[normalizedLocale] ??
    (language ? overrides[language] : undefined) ??
    overrides.ru ??
    overrides.en
  );
}
