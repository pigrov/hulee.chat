"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

export function ChannelAuthChallengeAutoRefresh({
  active,
  intervalMs = 2_000,
  label,
  refreshKey
}: {
  readonly active: boolean;
  readonly intervalMs?: number;
  readonly label: string;
  readonly refreshKey: string;
}): ReactNode {
  const router = useRouter();
  const latestRefreshKey = useRef(refreshKey);

  useEffect(() => {
    latestRefreshKey.current = refreshKey;
  }, [refreshKey]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };
    const intervalId = window.setInterval(refresh, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [active, intervalMs, router]);

  if (!active) {
    return null;
  }

  return (
    <div
      className="authChallengeRefreshIndicator"
      aria-live="polite"
      data-refresh-key={latestRefreshKey.current}
    >
      <LoaderCircle className="buttonSpinner" size={14} aria-hidden="true" />
      {label}
    </div>
  );
}
