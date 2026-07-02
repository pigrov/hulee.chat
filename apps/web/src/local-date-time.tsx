"use client";

import { useEffect, useState, type ReactNode } from "react";

export function LocalDateTime({
  fallback,
  locale,
  value
}: {
  readonly fallback: string;
  readonly locale: string;
  readonly value?: string;
}): ReactNode {
  const [formatted, setFormatted] = useState(fallback);

  useEffect(() => {
    if (!value) {
      setFormatted(fallback);
      return;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      setFormatted(fallback);
      return;
    }

    setFormatted(
      new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date)
    );
  }, [fallback, locale, value]);

  return formatted;
}
