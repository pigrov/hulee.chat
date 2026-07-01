import type { createTranslator, I18nMessageKey } from "@hulee/i18n";

import type { ToastMessage, ToastVariant } from "./toast";

type Translator = ReturnType<typeof createTranslator>["t"];

export function buildActionStatusToast(input: {
  id: string;
  status: string;
  titleKey: I18nMessageKey;
  descriptionKey: I18nMessageKey;
  t: Translator;
}): ToastMessage {
  return {
    id: input.id,
    variant: toastVariantFromStatus(input.status),
    title: input.t(input.titleKey),
    description: input.t(input.descriptionKey)
  };
}

export function buildToast(input: {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}): ToastMessage {
  return {
    id: input.id,
    variant: input.variant,
    title: input.title,
    ...(input.description ? { description: input.description } : {})
  };
}

function toastVariantFromStatus(status: string): ToastVariant {
  switch (status) {
    case "invalid":
    case "provider_failed":
    case "permission_denied":
    case "password_policy":
      return "error";
    case "not_configured":
    case "reauth_required":
    case "email_verification_required":
      return "warning";
    case "diagnosticsQueued":
      return "info";
    default:
      return "success";
  }
}
