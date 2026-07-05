import type { createTranslator } from "@hulee/i18n";

import type { AuthActionMessages } from "./auth-action-state";

type Translator = ReturnType<typeof createTranslator>["t"];

export function authActionMessages(t: Translator): AuthActionMessages {
  return {
    forgot_password_sent: t("auth.forgotPassword.sent"),
    invalid_credentials: t("auth.login.invalidCredentials"),
    invite_invalid: t("invite.invalid"),
    registration_invalid: t("auth.register.invalid"),
    reset_invalid: t("auth.resetPassword.invalid"),
    reset_password_policy: t("auth.resetPassword.passwordPolicy")
  };
}
