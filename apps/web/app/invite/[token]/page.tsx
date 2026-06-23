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

import { acceptEmployeeInviteAction } from "../../../src/employee-actions";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../../src/brand-style";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AcceptInvitePage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
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

  const [{ token }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams
  ]);
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
          <form className="settingsForm" action={acceptEmployeeInviteAction}>
            <input name="token" type="hidden" value={token} />
            <label className="fieldStack">
              <span className="detailLabel">{t("auth.email")}</span>
              <input
                className="textInput"
                type="email"
                value={activePreview.invitation.email}
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
            {resolvedSearchParams?.error === "invalid" ? (
              <p className="formError">{t("invite.invalid")}</p>
            ) : null}
            <button className="primaryButton" type="submit">
              <KeyRound size={18} aria-hidden="true" />
              {t("invite.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
