"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

type ThemeToggleProps = {
  labels: {
    label: string;
    light: string;
    dark: string;
  };
};

function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  window.localStorage.setItem("hulee-site-theme", mode);
}

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const saved = window.localStorage.getItem("hulee-site-theme");

  if (saved === "light" || saved === "dark") {
    return saved;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle({ labels }: ThemeToggleProps) {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const initial = getInitialTheme();
    setMode(initial);
    applyTheme(initial);
  }, []);

  function selectMode(nextMode: ThemeMode): void {
    setMode(nextMode);
    applyTheme(nextMode);
  }

  return (
    <div className="theme-toggle" aria-label={labels.label} role="group">
      <button
        aria-label={labels.light}
        className={mode === "light" ? "is-active" : undefined}
        type="button"
        onClick={() => selectMode("light")}
      >
        <Sun aria-hidden="true" size={17} strokeWidth={2.2} />
      </button>
      <button
        aria-label={labels.dark}
        className={mode === "dark" ? "is-active" : undefined}
        type="button"
        onClick={() => selectMode("dark")}
      >
        <Moon aria-hidden="true" size={16} strokeWidth={2.2} />
      </button>
    </div>
  );
}
