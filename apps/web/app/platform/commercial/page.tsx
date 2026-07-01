import { createTranslator } from "@hulee/i18n";
import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../src/access";
import { ManagementRow } from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import { resolveCurrentWebAccessSession } from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PlatformCommercialPage(): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  if (!canPlatformAdmin(access)) {
    return (
      <AccessDeniedPage
        current="platform-admin"
        navigationAccess={navigationAccessFromSession(access)}
      />
    );
  }

  const { t } = createTranslator("ru");

  return (
    <PlatformAdminShell
      access={access}
      current="commercial"
      t={t}
      title={t("platform.commercial")}
      titleId="platform-commercial-title"
    >
      <section className="settingsPanel" aria-labelledby="commercial-title">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.controlPlane")}</p>
            <h2 className="sectionTitle" id="commercial-title">
              {t("platform.commercial")}
            </h2>
          </div>
          <KeyRound size={18} aria-hidden="true" />
        </div>
        <div className="managementList">
          <ManagementRow
            label={t("platform.plans")}
            value={t("platform.status.deferred")}
          />
          <ManagementRow
            label={t("platform.entitlements")}
            value={t("platform.status.localSnapshot")}
          />
          <ManagementRow
            label={t("platform.licenses")}
            value={t("platform.status.localSnapshot")}
          />
        </div>
      </section>
    </PlatformAdminShell>
  );
}
