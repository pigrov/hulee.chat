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

export type BrandThemeMode = "light" | "dark";

export type BrandThemeColorPresetId =
  | "hulee"
  | "neutral"
  | "blue"
  | "green"
  | "red"
  | "orange"
  | "amber"
  | "violet"
  | "rose"
  | "cyan"
  | "graphite"
  | "high-contrast";

export type BrandThemePresetId =
  | BrandThemeColorPresetId
  | "hulee-dark"
  | "neutral-dark"
  | "blue-dark"
  | "green-dark"
  | "red-dark"
  | "orange-dark"
  | "amber-dark"
  | "violet-dark"
  | "rose-dark"
  | "cyan-dark"
  | "graphite-dark"
  | "high-contrast-dark";

export type BrandThemePreset = {
  id: BrandThemePresetId;
  label: string;
  tokens: BrandThemeTokens;
};

export type BuildBrandThemeTokensInput = {
  presetId?: BrandThemePresetId;
  mode?: BrandThemeMode;
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
    id: "red",
    label: "Red",
    tokens: {
      "color.page": "#fdf8f8",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#fffdfd",
      "color.surface.muted": "#f7eeee",
      "color.border": "#ead6d6",
      "color.border.strong": "#d8b9b9",
      "color.text.default": "#2a1717",
      "color.text.muted": "#7f4a4a",
      "color.brand.primary": "#dc2626",
      "color.brand.foreground": "#ffffff",
      "color.accent": "#0f766e",
      "color.danger": "#991b1b",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "orange",
    label: "Orange",
    tokens: {
      "color.page": "#fdf8f3",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#fffdf9",
      "color.surface.muted": "#f5eee7",
      "color.border": "#ead8c7",
      "color.border.strong": "#d7b99c",
      "color.text.default": "#2b1b12",
      "color.text.muted": "#76523a",
      "color.brand.primary": "#ea580c",
      "color.brand.foreground": "#111827",
      "color.accent": "#2563eb",
      "color.danger": "#b91c1c",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "amber",
    label: "Amber",
    tokens: {
      "color.page": "#fcf9f0",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#fffdf8",
      "color.surface.muted": "#f3eedf",
      "color.border": "#e6d8b9",
      "color.border.strong": "#d0b375",
      "color.text.default": "#282014",
      "color.text.muted": "#745d2c",
      "color.brand.primary": "#d97706",
      "color.brand.foreground": "#111827",
      "color.accent": "#7c3aed",
      "color.danger": "#b91c1c",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "violet",
    label: "Violet",
    tokens: {
      "color.page": "#faf8fd",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#fdfcff",
      "color.surface.muted": "#f1edf8",
      "color.border": "#ded4ec",
      "color.border.strong": "#c5b5dc",
      "color.text.default": "#221a35",
      "color.text.muted": "#675887",
      "color.brand.primary": "#7c3aed",
      "color.brand.foreground": "#ffffff",
      "color.accent": "#0f766e",
      "color.danger": "#b91c1c",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "rose",
    label: "Rose",
    tokens: {
      "color.page": "#fdf8fa",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#fffdfd",
      "color.surface.muted": "#f7eef2",
      "color.border": "#ead3dc",
      "color.border.strong": "#d8b2c0",
      "color.text.default": "#2d1720",
      "color.text.muted": "#7f4a5b",
      "color.brand.primary": "#e11d48",
      "color.brand.foreground": "#ffffff",
      "color.accent": "#2563eb",
      "color.danger": "#be123c",
      "theme.colorScheme": "light",
      "radius.control": "8px"
    }
  },
  {
    id: "cyan",
    label: "Cyan",
    tokens: {
      "color.page": "#f5fbfc",
      "color.surface.default": "#ffffff",
      "color.surface.raised": "#fbfeff",
      "color.surface.muted": "#e8f3f5",
      "color.border": "#cfe2e7",
      "color.border.strong": "#9ebfca",
      "color.text.default": "#11282f",
      "color.text.muted": "#466b76",
      "color.brand.primary": "#0891b2",
      "color.brand.foreground": "#111827",
      "color.accent": "#9333ea",
      "color.danger": "#b91c1c",
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
    id: "neutral-dark",
    label: "Neutral dark",
    tokens: {
      "color.page": "#0d1117",
      "color.surface.default": "#141922",
      "color.surface.raised": "#1a202b",
      "color.surface.muted": "#222a36",
      "color.border": "#2d3745",
      "color.border.strong": "#4b596b",
      "color.text.default": "#f4f6f8",
      "color.text.muted": "#aeb8c4",
      "color.brand.primary": "#9eb3c7",
      "color.brand.foreground": "#111827",
      "color.accent": "#f0b45a",
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
  },
  {
    id: "green-dark",
    label: "Green dark",
    tokens: {
      "color.page": "#07140d",
      "color.surface.default": "#101b15",
      "color.surface.raised": "#14221a",
      "color.surface.muted": "#1b2d22",
      "color.border": "#284034",
      "color.border.strong": "#496352",
      "color.text.default": "#f3f8f5",
      "color.text.muted": "#a9b8ad",
      "color.brand.primary": "#4ade80",
      "color.brand.foreground": "#052e16",
      "color.accent": "#facc15",
      "color.danger": "#fb7185",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  },
  {
    id: "red-dark",
    label: "Red dark",
    tokens: {
      "color.page": "#120d0d",
      "color.surface.default": "#1a1414",
      "color.surface.raised": "#211919",
      "color.surface.muted": "#2a2020",
      "color.border": "#3c2c2c",
      "color.border.strong": "#5a4040",
      "color.text.default": "#fff5f5",
      "color.text.muted": "#e8b4b4",
      "color.brand.primary": "#f87171",
      "color.brand.foreground": "#3f0b0b",
      "color.accent": "#5eead4",
      "color.danger": "#fca5a5",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  },
  {
    id: "orange-dark",
    label: "Orange dark",
    tokens: {
      "color.page": "#130f0b",
      "color.surface.default": "#1b1510",
      "color.surface.raised": "#231b14",
      "color.surface.muted": "#2c2219",
      "color.border": "#423125",
      "color.border.strong": "#624736",
      "color.text.default": "#fff7ed",
      "color.text.muted": "#e8c2a3",
      "color.brand.primary": "#fb923c",
      "color.brand.foreground": "#2f1605",
      "color.accent": "#93c5fd",
      "color.danger": "#fca5a5",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  },
  {
    id: "amber-dark",
    label: "Amber dark",
    tokens: {
      "color.page": "#121009",
      "color.surface.default": "#1a1710",
      "color.surface.raised": "#211d14",
      "color.surface.muted": "#2a2418",
      "color.border": "#403521",
      "color.border.strong": "#5d4b2d",
      "color.text.default": "#fffbeb",
      "color.text.muted": "#e6cd90",
      "color.brand.primary": "#fbbf24",
      "color.brand.foreground": "#241400",
      "color.accent": "#a78bfa",
      "color.danger": "#fca5a5",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  },
  {
    id: "violet-dark",
    label: "Violet dark",
    tokens: {
      "color.page": "#100d16",
      "color.surface.default": "#17131f",
      "color.surface.raised": "#1e1928",
      "color.surface.muted": "#272132",
      "color.border": "#3b314c",
      "color.border.strong": "#594872",
      "color.text.default": "#faf5ff",
      "color.text.muted": "#cbbbe4",
      "color.brand.primary": "#a78bfa",
      "color.brand.foreground": "#1f1147",
      "color.accent": "#5eead4",
      "color.danger": "#fca5a5",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  },
  {
    id: "rose-dark",
    label: "Rose dark",
    tokens: {
      "color.page": "#140d11",
      "color.surface.default": "#1d1419",
      "color.surface.raised": "#251a20",
      "color.surface.muted": "#30222a",
      "color.border": "#46323c",
      "color.border.strong": "#654858",
      "color.text.default": "#fff5f7",
      "color.text.muted": "#e8b4c0",
      "color.brand.primary": "#fb7185",
      "color.brand.foreground": "#3f0a18",
      "color.accent": "#93c5fd",
      "color.danger": "#fda4af",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  },
  {
    id: "cyan-dark",
    label: "Cyan dark",
    tokens: {
      "color.page": "#081214",
      "color.surface.default": "#101b1e",
      "color.surface.raised": "#142225",
      "color.surface.muted": "#1b2d31",
      "color.border": "#29434a",
      "color.border.strong": "#3d626d",
      "color.text.default": "#ecfeff",
      "color.text.muted": "#a9d5dc",
      "color.brand.primary": "#22d3ee",
      "color.brand.foreground": "#062b35",
      "color.accent": "#c084fc",
      "color.danger": "#fca5a5",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  },
  {
    id: "graphite-dark",
    label: "Graphite dark",
    tokens: {
      "color.page": "#0c0c0d",
      "color.surface.default": "#161616",
      "color.surface.raised": "#1d1d1f",
      "color.surface.muted": "#27272a",
      "color.border": "#3f3f46",
      "color.border.strong": "#63636d",
      "color.text.default": "#f4f4f5",
      "color.text.muted": "#b9b9c0",
      "color.brand.primary": "#cbd5e1",
      "color.brand.foreground": "#111827",
      "color.accent": "#f59e0b",
      "color.danger": "#fb7185",
      "theme.colorScheme": "dark",
      "radius.control": "8px"
    }
  },
  {
    id: "high-contrast-dark",
    label: "High contrast dark",
    tokens: {
      "color.page": "#000000",
      "color.surface.default": "#050505",
      "color.surface.raised": "#0a0a0a",
      "color.surface.muted": "#111111",
      "color.border": "#ffffff",
      "color.border.strong": "#ffffff",
      "color.text.default": "#ffffff",
      "color.text.muted": "#e5e7eb",
      "color.brand.primary": "#ffffff",
      "color.brand.foreground": "#000000",
      "color.accent": "#facc15",
      "color.danger": "#fca5a5",
      "theme.colorScheme": "dark",
      "radius.control": "6px"
    }
  }
];

const darkPresetByColorPresetId = {
  hulee: "hulee-dark",
  neutral: "neutral-dark",
  blue: "blue-dark",
  green: "green-dark",
  red: "red-dark",
  orange: "orange-dark",
  amber: "amber-dark",
  violet: "violet-dark",
  rose: "rose-dark",
  cyan: "cyan-dark",
  graphite: "graphite-dark",
  "high-contrast": "high-contrast-dark"
} as const satisfies Record<BrandThemeColorPresetId, BrandThemePresetId>;

const colorPresetByDarkPresetId = {
  "hulee-dark": "hulee",
  "neutral-dark": "neutral",
  "blue-dark": "blue",
  "green-dark": "green",
  "red-dark": "red",
  "orange-dark": "orange",
  "amber-dark": "amber",
  "violet-dark": "violet",
  "rose-dark": "rose",
  "cyan-dark": "cyan",
  "graphite-dark": "graphite",
  "high-contrast-dark": "high-contrast"
} as const satisfies Record<
  Exclude<BrandThemePresetId, BrandThemeColorPresetId>,
  BrandThemeColorPresetId
>;

export const brandThemeColorPresets = brandThemePresets.filter(
  (preset): preset is BrandThemePreset & { id: BrandThemeColorPresetId } =>
    isBrandThemeColorPresetId(preset.id)
);

export function isBrandThemePresetId(
  value: string
): value is BrandThemePresetId {
  return brandThemePresets.some((preset) => preset.id === value);
}

export function isBrandThemeColorPresetId(
  value: string
): value is BrandThemeColorPresetId {
  return Object.hasOwn(darkPresetByColorPresetId, value);
}

export function resolveBrandThemePreset(
  presetId: BrandThemePresetId = "hulee"
): BrandThemePreset {
  return (
    brandThemePresets.find((preset) => preset.id === presetId) ??
    brandThemePresets[0]
  );
}

export function resolveBrandThemePresetForMode(
  presetId: BrandThemePresetId = "hulee",
  mode: BrandThemeMode = "light"
): BrandThemePreset {
  const colorPresetId = resolveColorPresetIdFromPresetId(presetId);

  return resolveBrandThemePreset(
    mode === "dark" ? darkPresetByColorPresetId[colorPresetId] : colorPresetId
  );
}

export function buildBrandThemeTokens(
  input: BuildBrandThemeTokensInput
): BrandThemeTokens {
  const preset =
    input.mode === undefined
      ? resolveBrandThemePreset(input.presetId)
      : resolveBrandThemePresetForMode(input.presetId, input.mode);
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
      resolveReadableBrandForegroundColor(primaryColor);
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

export function resolveBrandThemeColorPresetId(
  tokens: Record<string, string>
): BrandThemeColorPresetId | undefined {
  const presetId =
    resolveBrandThemePresetId(tokens) ?? resolveBrandThemeBasePresetId(tokens);

  return presetId === undefined
    ? undefined
    : resolveColorPresetIdFromPresetId(presetId);
}

export function resolveBrandThemeMode(
  tokens: Record<string, string>
): BrandThemeMode {
  const normalized = normalizeBrandThemeTokens(tokens);

  return normalized["theme.colorScheme"] === "dark" ? "dark" : "light";
}

function resolveColorPresetIdFromPresetId(
  presetId: BrandThemePresetId = "hulee"
): BrandThemeColorPresetId {
  if (isBrandThemeColorPresetId(presetId)) {
    return presetId;
  }

  return colorPresetByDarkPresetId[presetId];
}

function assertBrandContrast(tokens: BrandThemeTokens): void {
  const primary = tokens["color.brand.primary"];
  const foreground = tokens["color.brand.foreground"];

  if (primary && foreground && contrastRatio(primary, foreground) < 4.5) {
    throw new Error("Brand primary and foreground colors have low contrast.");
  }

  assertReadableTextContrast(tokens);
}

function resolveReadableBrandForegroundColor(primaryColor: string): string {
  if (contrastRatio(primaryColor, "#ffffff") >= 4.5) {
    return "#ffffff";
  }

  if (contrastRatio(primaryColor, "#111827") >= 4.5) {
    return "#111827";
  }

  return "#000000";
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
