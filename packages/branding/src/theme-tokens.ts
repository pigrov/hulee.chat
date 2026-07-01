export const brandThemeTokenNames = [
  "color.brand.primary",
  "color.brand.foreground",
  "color.accent",
  "color.page",
  "color.surface.default",
  "color.surface.raised",
  "color.surface.muted",
  "color.border",
  "color.border.strong",
  "color.text.default",
  "color.text.muted",
  "color.danger",
  "theme.colorScheme",
  "radius.control"
] as const;

export type BrandThemeTokenName = (typeof brandThemeTokenNames)[number];
export type BrandThemeTokens = Partial<Record<BrandThemeTokenName, string>>;

export type BrandThemePresetId =
  | "hulee"
  | "neutral"
  | "blue"
  | "green"
  | "graphite"
  | "high-contrast"
  | "hulee-dark"
  | "blue-dark";

export type BrandThemePreset = {
  id: BrandThemePresetId;
  label: string;
  tokens: BrandThemeTokens;
};

export type BuildBrandThemeTokensInput = {
  presetId?: BrandThemePresetId;
  primaryColor?: string;
  accentColor?: string;
};

const colorTokenNames = new Set<BrandThemeTokenName>([
  "color.brand.primary",
  "color.brand.foreground",
  "color.accent",
  "color.page",
  "color.surface.default",
  "color.surface.raised",
  "color.surface.muted",
  "color.border",
  "color.border.strong",
  "color.text.default",
  "color.text.muted",
  "color.danger"
]);

const allowedTokenNames = new Set<string>(brandThemeTokenNames);
const hexColorPattern = /^#[0-9a-f]{6}$/;
const radiusPattern = /^(?:[4-9]|1[0-6])px$/;
const colorSchemeValues = new Set(["light", "dark"]);
const customColorTokenNames = new Set<BrandThemeTokenName>([
  "color.brand.primary",
  "color.brand.foreground",
  "color.accent"
]);

export const brandThemePresets: readonly BrandThemePreset[] = [
  {
    id: "hulee",
    label: "Hulee",
    tokens: {
      "color.page": "#f7f9fa",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#fbfdfc",
      "color.surface.muted": "#eef7f2",
      "color.border": "#dbe3e7",
      "color.border.strong": "#b5c2ca",
      "color.text.default": "#111827",
      "color.text.muted": "#64748b",
      "color.brand.primary": "#047857",
      "color.brand.foreground": "#ffffff",
      "color.accent": "#0f766e",
      "color.danger": "#dc2626",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "neutral",
    label: "Neutral",
    tokens: {
      "color.page": "#f6f7f8",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#fafafa",
      "color.surface.muted": "#eef0f2",
      "color.border": "#d7dce0",
      "color.border.strong": "#aeb7bf",
      "color.text.default": "#1f2933",
      "color.text.muted": "#65717d",
      "color.brand.primary": "#3f5f76",
      "color.brand.foreground": "#ffffff",
      "color.accent": "#b47b34",
      "color.danger": "#b5474a",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "blue",
    label: "Blue",
    tokens: {
      "color.page": "#f3f6fb",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#f9fbff",
      "color.surface.muted": "#e8eef8",
      "color.border": "#d4ddeb",
      "color.border.strong": "#aab8ce",
      "color.text.default": "#1d2735",
      "color.text.muted": "#617087",
      "color.brand.primary": "#2563eb",
      "color.brand.foreground": "#ffffff",
      "color.accent": "#0f766e",
      "color.danger": "#b5474a",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "green",
    label: "Green",
    tokens: {
      "color.page": "#f3f8f5",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#f9fcfa",
      "color.surface.muted": "#e6f0ea",
      "color.border": "#cfddd4",
      "color.border.strong": "#9fb6a7",
      "color.text.default": "#1f2a24",
      "color.text.muted": "#627168",
      "color.brand.primary": "#15803d",
      "color.brand.foreground": "#ffffff",
      "color.accent": "#a16207",
      "color.danger": "#b5474a",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "graphite",
    label: "Graphite",
    tokens: {
      "color.page": "#f5f5f4",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#fafaf9",
      "color.surface.muted": "#ecebea",
      "color.border": "#d7d3cf",
      "color.border.strong": "#aaa39c",
      "color.text.default": "#242321",
      "color.text.muted": "#6b6761",
      "color.brand.primary": "#374151",
      "color.brand.foreground": "#ffffff",
      "color.accent": "#b45309",
      "color.danger": "#b5474a",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "high-contrast",
    label: "High contrast",
    tokens: {
      "color.page": "#ffffff",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#ffffff",
      "color.surface.muted": "#f0f0f0",
      "color.border": "#1f2937",
      "color.border.strong": "#111827",
      "color.text.default": "#111827",
      "color.text.muted": "#374151",
      "color.brand.primary": "#111827",
      "color.brand.foreground": "#ffffff",
      "color.accent": "#7c2d12",
      "color.danger": "#991b1b",
      "theme.colorScheme": "light",
      "radius.control": "6px"
    }
  },
  {
    id: "hulee-dark",
    label: "Hulee dark",
    tokens: {
      "color.page": "#081015",
      "color.surface.default": "#111a20",
      "color.surface.raised": "#151f26",
      "color.surface.muted": "#1c2a31",
      "color.border": "#26343d",
      "color.border.strong": "#40515c",
      "color.text.default": "#f4f7f8",
      "color.text.muted": "#a8b6bf",
      "color.brand.primary": "#34d399",
      "color.brand.foreground": "#06251a",
      "color.accent": "#38bdf8",
      "color.danger": "#fb7185",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  },
  {
    id: "blue-dark",
    label: "Blue dark",
    tokens: {
      "color.page": "#0f172a",
      "color.surface.default": "#121c31",
      "color.surface.raised": "#18233a",
      "color.surface.muted": "#22304c",
      "color.border": "#31405f",
      "color.border.strong": "#536482",
      "color.text.default": "#f4f7fb",
      "color.text.muted": "#b9c4d6",
      "color.brand.primary": "#7aa2ff",
      "color.brand.foreground": "#101828",
      "color.accent": "#34d399",
      "color.danger": "#fb7185",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  }
];

export function isBrandThemePresetId(
  value: string
): value is BrandThemePresetId {
  return brandThemePresets.some((preset) => preset.id === value);
}

export function resolveBrandThemePreset(
  presetId: BrandThemePresetId = "hulee"
): BrandThemePreset {
  return (
    brandThemePresets.find((preset) => preset.id === presetId) ??
    brandThemePresets[0]
  );
}

export function buildBrandThemeTokens(
  input: BuildBrandThemeTokensInput
): BrandThemeTokens {
  const preset = resolveBrandThemePreset(input.presetId);
  const tokens: BrandThemeTokens = {
    ...preset.tokens
  };
  const primaryColor = input.primaryColor
    ? normalizeHexColor(input.primaryColor)
    : undefined;
  const accentColor = input.accentColor
    ? normalizeHexColor(input.accentColor)
    : undefined;

  if (primaryColor) {
    tokens["color.brand.primary"] = primaryColor;
    tokens["color.brand.foreground"] =
      contrastRatio(primaryColor, "#ffffff") >= 4.5 ? "#ffffff" : "#111827";
  }

  if (accentColor) {
    tokens["color.accent"] = accentColor;
  }

  return normalizeBrandThemeTokens(tokens);
}

export function normalizeBrandThemeTokens(
  tokens: Record<string, string>
): BrandThemeTokens {
  const normalized: BrandThemeTokens = {};

  for (const [name, rawValue] of Object.entries(tokens)) {
    if (!allowedTokenNames.has(name)) {
      throw new Error(`Unsupported brand theme token: ${name}`);
    }

    const tokenName = name as BrandThemeTokenName;
    const value = rawValue.trim();

    if (colorTokenNames.has(tokenName)) {
      normalized[tokenName] = normalizeHexColor(value);
      continue;
    }

    if (tokenName === "radius.control") {
      if (!radiusPattern.test(value)) {
        throw new Error(`Invalid brand radius token: ${name}`);
      }

      normalized[tokenName] = value;
      continue;
    }

    if (tokenName === "theme.colorScheme") {
      if (!colorSchemeValues.has(value)) {
        throw new Error(`Invalid brand color scheme token: ${name}`);
      }

      normalized[tokenName] = value;
    }
  }

  assertBrandContrast(normalized);

  return normalized;
}

export function normalizeHexColor(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!hexColorPattern.test(normalized)) {
    throw new Error("Invalid brand color token.");
  }

  return normalized;
}

export function resolveBrandThemePresetId(
  tokens: Record<string, string>
): BrandThemePresetId | undefined {
  const normalized = normalizeBrandThemeTokens(tokens);

  return brandThemePresets.find((preset) => {
    return brandThemeTokenNames.every((tokenName) => {
      return normalized[tokenName] === preset.tokens[tokenName];
    });
  })?.id;
}

export function resolveBrandThemeBasePresetId(
  tokens: Record<string, string>
): BrandThemePresetId | undefined {
  const normalized = normalizeBrandThemeTokens(tokens);

  return brandThemePresets.find((preset) => {
    return brandThemeTokenNames.every((tokenName) => {
      return (
        customColorTokenNames.has(tokenName) ||
        normalized[tokenName] === preset.tokens[tokenName]
      );
    });
  })?.id;
}

function assertBrandContrast(tokens: BrandThemeTokens): void {
  const primary = tokens["color.brand.primary"];
  const foreground = tokens["color.brand.foreground"];

  if (primary && foreground && contrastRatio(primary, foreground) < 4.5) {
    throw new Error("Brand primary and foreground colors have low contrast.");
  }

  assertReadableTextContrast(tokens);
}

function assertReadableTextContrast(tokens: BrandThemeTokens): void {
  const defaultText = tokens["color.text.default"];
  const mutedText = tokens["color.text.muted"];
  const surfaces: BrandThemeTokenName[] = [
    "color.page",
    "color.surface.default",
    "color.surface.raised",
    "color.surface.muted"
  ];

  for (const surfaceToken of surfaces) {
    const surface = tokens[surfaceToken];

    if (defaultText && surface && contrastRatio(defaultText, surface) < 4.5) {
      throw new Error(
        "Brand default text and surface colors have low contrast."
      );
    }

    if (mutedText && surface && contrastRatio(mutedText, surface) < 3) {
      throw new Error("Brand muted text and surface colors have low contrast.");
    }
  }
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hexColor: string): number {
  const red = parseInt(hexColor.slice(1, 3), 16) / 255;
  const green = parseInt(hexColor.slice(3, 5), 16) / 255;
  const blue = parseInt(hexColor.slice(5, 7), 16) / 255;

  return (
    0.2126 * linearizeSrgb(red) +
    0.7152 * linearizeSrgb(green) +
    0.0722 * linearizeSrgb(blue)
  );
}

function linearizeSrgb(value: number): number {
  return value <= 0.03928
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}
