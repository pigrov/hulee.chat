"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

export type ToastVariant = "success" | "warning" | "error" | "info";

export type ToastMessage = {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  durationMs?: number;
};

type ToastState = ToastMessage & {
  closing: boolean;
};

export function ToastViewport({
  closeLabel,
  regionLabel,
  toasts
}: {
  closeLabel: string;
  regionLabel: string;
  toasts?: readonly ToastMessage[];
}): ReactNode {
  const initialToasts = useMemo(
    () => (toasts ?? []).map((toast) => ({ ...toast, closing: false })),
    [toasts]
  );
  const [visibleToasts, setVisibleToasts] =
    useState<readonly ToastState[]>(initialToasts);

  useEffect(() => {
    setVisibleToasts(initialToasts);
  }, [initialToasts]);

  if (visibleToasts.length === 0) {
    return null;
  }

  function closeToast(id: string): void {
    setVisibleToasts((current) =>
      current.map((toast) =>
        toast.id === id ? { ...toast, closing: true } : toast
      )
    );
  }

  function removeToast(id: string): void {
    setVisibleToasts((current) => current.filter((toast) => toast.id !== id));
  }

  return (
    <section
      className="toastViewport"
      aria-label={regionLabel}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {visibleToasts.map((toast) => (
        <article
          className="toastCard"
          data-state={toast.closing ? "closing" : "open"}
          data-variant={toast.variant}
          key={toast.id}
          onAnimationEnd={(event) => {
            if (
              event.animationName === "toastExit" &&
              event.currentTarget === event.target
            ) {
              removeToast(toast.id);
            }
          }}
          role={toast.variant === "error" ? "alert" : "status"}
        >
          <span className="toastIcon" aria-hidden="true">
            <ToastIcon variant={toast.variant} />
          </span>
          <div className="toastText">
            <h2 className="toastTitle">{toast.title}</h2>
            {toast.description ? (
              <p className="toastDescription">{toast.description}</p>
            ) : null}
          </div>
          <button
            className="toastCloseButton"
            type="button"
            aria-label={closeLabel}
            onClick={() => closeToast(toast.id)}
          >
            <X size={16} aria-hidden="true" />
          </button>
          <span
            className="toastProgress"
            style={{
              animationDuration: `${toast.durationMs ?? 5_000}ms`
            }}
            onAnimationEnd={(event) => {
              if (event.animationName === "toastProgress") {
                closeToast(toast.id);
              }
            }}
          />
        </article>
      ))}
    </section>
  );
}

function ToastIcon({ variant }: { variant: ToastVariant }): ReactNode {
  switch (variant) {
    case "success":
      return <CheckCircle2 size={18} />;
    case "warning":
      return <AlertTriangle size={18} />;
    case "error":
      return <XCircle size={18} />;
    case "info":
      return <Info size={18} />;
  }
}
