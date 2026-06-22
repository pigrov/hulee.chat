import enMessages from "../messages/en.json";
import ruMessages from "../messages/ru.json";

export const defaultLocale = "ru";
export const supportedLocales = ["ru", "en"] as const;

export type SupportedLocale = (typeof supportedLocales)[number];
export type I18nMessageKey = keyof typeof ruMessages;
export type I18nMessageVariables = Record<string, string | number | undefined>;

const dictionaries: Record<SupportedLocale, Record<I18nMessageKey, string>> = {
  ru: ruMessages,
  en: enMessages
};

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return supportedLocales.includes(locale as SupportedLocale);
}

export function resolveLocale(locale: string | undefined): SupportedLocale {
  if (locale && isSupportedLocale(locale)) {
    return locale;
  }

  return defaultLocale;
}

export function formatI18nMessage(
  locale: SupportedLocale,
  key: I18nMessageKey,
  variables: I18nMessageVariables = {}
): string {
  const template =
    dictionaries[locale][key] ?? dictionaries[defaultLocale][key];

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name: string) => {
    const value = variables[name];
    return value === undefined ? "" : String(value);
  });
}

export function createTranslator(locale: SupportedLocale): {
  locale: SupportedLocale;
  t: (key: I18nMessageKey, variables?: I18nMessageVariables) => string;
} {
  return {
    locale,
    t: (key, variables) => formatI18nMessage(locale, key, variables)
  };
}
