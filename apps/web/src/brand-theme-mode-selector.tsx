"use client";

import { Moon, SunMedium } from "lucide-react";
import type { ReactNode } from "react";

import { syncAppTheme, type AppTheme } from "./theme-toggle";

export function BrandThemeModeSelector({
  currentThemeMode,
  darkLabel,
  label,
  lightLabel
}: {
  readonly currentThemeMode: AppTheme;
  readonly darkLabel: string;
  readonly label: string;
  readonly lightLabel: string;
}): ReactNode {
  return (
    <>
      <span className="detailLabel">{label}</span>
      <div className="brandModeSwitch" role="group" aria-label={label}>
        <button
          className="brandModeButton"
          name="themeMode"
          type="submit"
          value="light"
          aria-current={currentThemeMode === "light" ? "page" : undefined}
          onClick={() => syncAppTheme("light")}
        >
          <SunMedium size={16} aria-hidden="true" />
          {lightLabel}
        </button>
        <button
          className="brandModeButton"
          name="themeMode"
          type="submit"
          value="dark"
          aria-current={currentThemeMode === "dark" ? "page" : undefined}
          onClick={() => syncAppTheme("dark")}
        >
          <Moon size={16} aria-hidden="true" />
          {darkLabel}
        </button>
      </div>
    </>
  );
}
