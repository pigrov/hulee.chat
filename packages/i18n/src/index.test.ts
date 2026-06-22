import { describe, expect, it } from "vitest";

import { createTranslator, formatI18nMessage, resolveLocale } from "./index";

describe("i18n helpers", () => {
  it("falls back to the default locale", () => {
    expect(resolveLocale("de")).toBe("ru");
  });

  it("interpolates message variables", () => {
    expect(formatI18nMessage("en", "app.name", { productName: "Acme" })).toBe(
      "Acme"
    );
  });

  it("creates a locale-bound translator", () => {
    const { t } = createTranslator("en");

    expect(t("inbox.title")).toBe("Inbox");
  });
});
