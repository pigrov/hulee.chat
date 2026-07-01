import { createTranslator } from "@hulee/i18n";
import { ShieldCheck } from "lucide-react";
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

export default async function PlatformSupportPage(): Promise<ReactNode> {
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
      current="support"
      t={t}
      title={t("platform.supportAccess")}
      titleId="platform-support-title"
    >
      <section className="settingsPanel" aria-labelledby="support-title">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.boundary")}</p>
            <h2 className="sectionTitle" id="support-title">
              {t("platform.supportAccess")}
            </h2>
          </div>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        <div className="managementList">
          <ManagementRow
            label={t("platform.customerData")}
            value={t("platform.status.notStored")}
          />
          <ManagementRow
            label={t("platform.audit")}
            value={t("platform.status.required")}
          />
          <ManagementRow
            label={t("platform.impersonation")}
            value={t("platform.status.deferred")}
          />
        </div>
      </section>
    </PlatformAdminShell>
  );
}
