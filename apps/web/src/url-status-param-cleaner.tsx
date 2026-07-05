"use client";

import { useEffect, type ReactNode } from "react";

export function UrlStatusParamCleaner({
  params
}: {
  params: readonly string[];
}): ReactNode {
  const paramsKey = params.join(",");

  useEffect(() => {
    const paramNames = paramsKey.split(",").filter(Boolean);

    if (paramNames.length === 0) {
      return;
    }

    const url = new URL(window.location.href);
    let changed = false;

    for (const paramName of paramNames) {
      if (url.searchParams.has(paramName)) {
        url.searchParams.delete(paramName);
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    const search = url.searchParams.toString();
    const nextUrl = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;

    window.history.replaceState(window.history.state, "", nextUrl);
  }, [paramsKey]);

  return null;
}
