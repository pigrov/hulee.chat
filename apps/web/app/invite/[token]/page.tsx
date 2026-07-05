import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import {
  createSqlEmployeeDirectoryRepository,
  hashEmployeeInvitationToken
} from "@hulee/db";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { authActionMessages } from "../../../src/auth-action-messages";
import {
  AuthActionForm,
  AuthSubmitButton
} from "../../../src/auth-action-form";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../../src/brand-style";
import { EmailInput } from "../../../src/contact-fields";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AcceptInvitePage({
  params
}: {
  params: Promise<{ token: string }>;
}): Promise<ReactNode> {
  const existingSession = await resolveCurrentWebAccessSession({
    allowDevelopmentFallback: false
  });

  if (existingSession !== null) {
    redirect(
      existingSession.platformRoles.includes("platform_admin")
        ? "/platform"
        : "/"
    );
  }

  const { token } = await params;
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  const preview = await repository.findInvitationByTokenHash(
    hashEmployeeInvitationToken(token)
  );
  const brand = {
    ...defaultBrandProfile,
    productName: preview?.productName ?? defaultBrandProfile.productName,
    shortProductName:
      preview?.productName ?? defaultBrandProfile.shortProductName
  };
  const { t } = createTranslator("ru");
  const invitationUnavailable =
    preview === null ||
    preview.invitation.acceptedAt !== undefined ||
    preview.invitation.revokedAt !== undefined ||
    new Date(preview.invitation.expiresAt).getTime() <= Date.now();
  const activePreview = invitationUnavailable ? null : preview;

  return (
    <main className="loginPage" style={brandProfileToCssProperties(brand)}>
      <section className="loginPanel" aria-labelledby="invite-title">
        <div className="brandMark" aria-label={brand.productName}>
          {buildBrandMarkLabel(brand)}
        </div>
        <div>
          <p className="eyebrow">{t("invite.eyebrow")}</p>
          <h1 className="adminTitle" id="invite-title">
            {t("invite.title")}
          </h1>
          <p className="metaText">
            {preview
              ? t("invite.description", {
                  company: preview.tenantDisplayName
                })
              : t("invite.invalid")}
          </p>
        </div>

        {activePreview === null ? (
          <>
            <p className="formError">{t("invite.unavailable")}</p>
            <p className="authSwitch">
              <Link href="/login">{t("auth.login.link")}</Link>
            </p>
          </>
        ) : (
          <AuthActionForm
            actionKind="acceptInvite"
            className="settingsForm"
            messages={authActionMessages(t)}
          >
            <input name="token" type="hidden" value={token} />
            <label className="fieldStack">
              <span className="detailLabel">{t("auth.email")}</span>
              <EmailInput
                className="textInput"
                defaultValue={activePreview.invitation.email}
                readOnly
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("auth.displayName")}</span>
              <input
                className="textInput"
                name="displayName"
                type="text"
                autoComplete="name"
                defaultValue={activePreview.invitation.displayName ?? ""}
                required
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">{t("auth.password")}</span>
              <input
                className="textInput"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <AuthSubmitButton
              className="primaryButton"
              label={t("invite.submit")}
            >
              <KeyRound size={18} aria-hidden="true" />
            </AuthSubmitButton>
          </AuthActionForm>
        )}
      </section>
    </main>
  );
}
