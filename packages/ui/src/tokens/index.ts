export type ThemeMode = "light" | "dark" | "company";

export type DesignTokenName =
  | "color.brand.primary"
  | "color.brand.foreground"
  | "color.accent"
  | "color.page"
  | "color.surface.default"
  | "color.surface.raised"
  | "color.surface.muted"
  | "color.border"
  | "color.border.strong"
  | "color.text.default"
  | "color.text.muted"
  | "color.danger"
  | "theme.colorScheme"
  | "radius.control"
  | "spacing.control";

export type DesignTokenMap = Partial<Record<DesignTokenName, string>>;

export const baseTokens: Record<ThemeMode, DesignTokenMap> = {
  light: {
    "color.surface.default": "var(--hulee-color-surface-default)",
    "color.text.default": "var(--hulee-color-text-default)"
  },
  dark: {
    "color.surface.default": "var(--hulee-color-surface-default)",
    "color.text.default": "var(--hulee-color-text-default)"
  },
  company: {
    "color.brand.primary": "var(--hulee-color-brand-primary)"
  }
};
