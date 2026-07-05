import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { authActionMessages } from "../../../src/auth-action-messages";
import { AuthActionForm } from "../../../src/auth-action-form";
import {
  brandProfileToCssProperties,
  buildBrandMarkLabel
} from "../../../src/brand-style";
import {
  readTenantLoginChoices,
  resolveCurrentWebAccessSession
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SelectLoginCompanyPage(): Promise<ReactNode> {
  const choices = await readTenantLoginChoices();
  const existingSession = await resolveCurrentWebAccessSession({
    allowDevelopmentFallback: false
  });

  if (existingSession !== null && choices === null) {
    redirect(
      existingSession.platformRoles.includes("platform_admin")
        ? "/platform"
        : "/"
    );
  }

  if (choices === null) {
    redirect("/login");
  }

  const { t } = createTranslator("ru");

  return (
    <main
      className="loginPage"
      style={brandProfileToCssProperties(defaultBrandProfile)}
    >
      <section className="loginPanel" aria-labelledby="select-company-title">
        <div className="brandMark" aria-label={defaultBrandProfile.productName}>
          {buildBrandMarkLabel(defaultBrandProfile)}
        </div>
        <div>
          <p className="eyebrow">{t("auth.selectCompany.eyebrow")}</p>
          <h1 className="adminTitle" id="select-company-title">
            {t("auth.selectCompany.title")}
          </h1>
          <p className="metaText">
            {t("auth.selectCompany.description", {
              email: choices.email
            })}
          </p>
        </div>
        <div className="managementList">
          {choices.choices.map((choice) => (
            <AuthActionForm
              actionKind="selectTenant"
              key={choice.tenantSlug}
              className="settingsForm"
              messages={authActionMessages(t)}
            >
              <input
                name="tenantSlug"
                type="hidden"
                value={choice.tenantSlug}
              />
              <button className="managementRow choiceButton" type="submit">
                <span className="metricIcon" aria-hidden="true">
                  <Building2 size={18} />
                </span>
                <span>
                  <span className="listItemTitle">
                    {choice.tenantDisplayName}
                  </span>
                  <span className="detailLabel">
                    {t("auth.selectCompany.open")}
                  </span>
                </span>
              </button>
            </AuthActionForm>
          ))}
        </div>
        <p className="authSwitch">
          <Link href="/login">{t("auth.login.link")}</Link>
        </p>
      </section>
    </main>
  );
}
