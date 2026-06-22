export type ThemeMode = "light" | "dark" | "company";

export type DesignTokenName =
  | "color.brand.primary"
  | "color.brand.foreground"
  | "color.surface.default"
  | "color.surface.muted"
  | "color.text.default"
  | "color.text.muted"
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
