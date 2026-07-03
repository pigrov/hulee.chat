"use client";

import { Moon, SunMedium } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export type AppTheme = "light" | "dark";

const storageKey = "hulee.theme";
const themeChangeEventName = "hulee-theme-change";

export function AppThemeToggle({
  darkLabel,
  lightLabel,
  themeStyles,
  toggleLabel
}: {
  readonly darkLabel: string;
  readonly lightLabel: string;
  readonly themeStyles?: AppThemeStyleMap;
  readonly toggleLabel: string;
}): ReactNode {
  const [theme, setTheme] = useState<AppTheme>("light");

  useEffect(() => {
    const savedTheme = readStoredTheme();
    const resolvedTheme =
      savedTheme ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");

    applyTheme(resolvedTheme, themeStyles);
    setTheme(resolvedTheme);

    const handleThemeChange = (event: Event): void => {
      const nextTheme = (event as CustomEvent<{ theme?: unknown }>).detail
        ?.theme;

      if (nextTheme === "light" || nextTheme === "dark") {
        applyTheme(nextTheme, themeStyles);
        setTheme(nextTheme);
      }
    };

    window.addEventListener(themeChangeEventName, handleThemeChange);

    return () => {
      window.removeEventListener(themeChangeEventName, handleThemeChange);
    };
  }, [themeStyles]);

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      className="railThemeToggle"
      type="button"
      aria-label={toggleLabel}
      title={theme === "dark" ? darkLabel : lightLabel}
      onClick={() => {
        syncAppTheme(nextTheme, themeStyles);
        setTheme(nextTheme);
      }}
    >
      <span className="railThemeToggleThumb">
        {theme === "dark" ? (
          <Moon size={15} strokeWidth={1.6} aria-hidden="true" />
        ) : (
          <SunMedium size={15} strokeWidth={1.6} aria-hidden="true" />
        )}
      </span>
    </button>
  );
}

export type AppThemeStyleMap = Record<AppTheme, Record<`--${string}`, string>>;

export function syncAppTheme(
  theme: AppTheme,
  themeStyles?: AppThemeStyleMap
): void {
  applyTheme(theme, themeStyles);
  window.localStorage.setItem(storageKey, theme);
  window.dispatchEvent(
    new CustomEvent(themeChangeEventName, { detail: { theme } })
  );
}

function readStoredTheme(): AppTheme | undefined {
  const value = window.localStorage.getItem(storageKey);

  return value === "dark" || value === "light" ? value : undefined;
}

function applyTheme(theme: AppTheme, themeStyles?: AppThemeStyleMap): void {
  document.documentElement.dataset.theme = theme;
  applyFrameThemeStyles(themeStyles?.[theme]);
}

function applyFrameThemeStyles(
  themeStyle: Record<`--${string}`, string> | undefined
): void {
  if (!themeStyle) {
    return;
  }

  document.querySelectorAll<HTMLElement>(".appFrame").forEach((frame) => {
    for (const [propertyName, value] of Object.entries(themeStyle)) {
      frame.style.setProperty(propertyName, value);
    }
  });
}
