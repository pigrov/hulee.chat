"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ThemeMode = "system" | "light" | "dark";

type ThemeToggleLabels = {
  label: string;
  system: string;
  light: string;
  dark: string;
};

const modes: ThemeMode[] = ["system", "light", "dark"];

function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.themeMode = mode;

  if (mode === "system") {
    root.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    return;
  }

  root.dataset.theme = mode;
}

export function ThemeToggle({ labels }: { labels: ThemeToggleLabels }) {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const savedMode = window.localStorage.getItem("hulee-site-theme");
    const nextMode =
      savedMode === "light" || savedMode === "dark" || savedMode === "system"
        ? savedMode
        : "system";

    setMode(nextMode);
    applyTheme(nextMode);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (
        (document.documentElement.dataset.themeMode ?? "system") === "system"
      ) {
        applyTheme("system");
      }
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const Icon = useMemo(() => {
    if (mode === "light") {
      return Sun;
    }

    if (mode === "dark") {
      return Moon;
    }

    return Monitor;
  }, [mode]);

  const label = labels[mode];

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={`${labels.label}: ${label}`}
      onClick={() => {
        const nextMode =
          modes[(modes.indexOf(mode) + 1) % modes.length] ?? "system";
        window.localStorage.setItem("hulee-site-theme", nextMode);
        setMode(nextMode);
        applyTheme(nextMode);
      }}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
