import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { LogIn } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { authActionMessages } from "../../src/auth-action-messages";
import { AuthActionForm, AuthSubmitButton } from "../../src/auth-action-form";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../src/brand-style";
import { EmailInput } from "../../src/contact-fields";
import { resolveCurrentWebAccessSession } from "../../src/session";
import { ToastViewport } from "../../src/toast";
import { buildToast } from "../../src/toast-messages";
import { UrlStatusParamCleaner } from "../../src/url-status-param-cleaner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<{
    reauth?: string;
    reset?: string;
    returnTo?: string;
  }>;
}): Promise<ReactNode> {
  const resolvedSearchParams = await searchParams;
  const returnTo = resolveLoginReturnTo(resolvedSearchParams?.returnTo);
  const isReauth = resolvedSearchParams?.reauth === "1";
  const existingSession = await resolveCurrentWebAccessSession({
    allowDevelopmentFallback: false
  });

  if (existingSession !== null && !isReauth) {
    redirect(
      existingSession.platformRoles.includes("platform_admin")
        ? "/platform"
        : "/"
    );
  }

  const hasPasswordResetNotice = resolvedSearchParams?.reset === "complete";
  const { t } = createTranslator("ru");
  const toasts = hasPasswordResetNotice
    ? [
        buildToast({
          id: "password-reset-complete",
          variant: "success",
          title: t("auth.resetPassword.title"),
          description: t("auth.login.passwordResetComplete")
        })
      ]
    : [];

  return (
    <main
      className="loginPage"
      style={brandProfileToCssProperties(defaultBrandProfile)}
    >
      <ToastViewport
        closeLabel={t("notifications.close")}
        regionLabel={t("notifications.region")}
        toasts={toasts}
      />
      {hasPasswordResetNotice ? (
        <UrlStatusParamCleaner params={["reset"]} />
      ) : null}
      <section className="loginPanel" aria-labelledby="login-title">
        <div className="brandMark" aria-label={defaultBrandProfile.productName}>
          {buildBrandMarkLabel(defaultBrandProfile)}
        </div>
        <div>
          <p className="eyebrow">{t("auth.local.eyebrow")}</p>
          <h1 className="adminTitle" id="login-title">
            {t("auth.login.title")}
          </h1>
          <p className="metaText">{t("auth.login.description")}</p>
        </div>
        <AuthActionForm
          actionKind="login"
          className="settingsForm"
          messages={authActionMessages(t)}
        >
          {existingSession?.tenantSlug ? (
            <input
              name="tenantSlug"
              type="hidden"
              value={existingSession.tenantSlug}
            />
          ) : null}
          {returnTo ? (
            <input name="returnTo" type="hidden" value={returnTo} />
          ) : null}
          <label className="fieldStack">
            <span className="detailLabel">{t("auth.email")}</span>
            <EmailInput className="textInput" name="email" required />
          </label>
          <label className="fieldStack">
            <span className="detailLabel">{t("auth.password")}</span>
            <input
              className="textInput"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <AuthSubmitButton
            className="primaryButton"
            label={t("auth.login.submit")}
          >
            <LogIn size={18} aria-hidden="true" />
          </AuthSubmitButton>
          <p className="authSwitch">
            <Link href="/forgot-password">{t("auth.forgotPassword.link")}</Link>
          </p>
          <p className="authSwitch">
            {t("auth.login.noAccount")}{" "}
            <Link href="/register">{t("auth.register.link")}</Link>
          </p>
        </AuthActionForm>
      </section>
    </main>
  );
}

function resolveLoginReturnTo(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  if (value === "/login" || value.startsWith("/login?")) {
    return undefined;
  }

  return value;
}
