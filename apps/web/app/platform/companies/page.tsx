import { createTranslator } from "@hulee/i18n";
import { Building2 } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../src/access";
import {
  loadPlatformTenantSnapshots,
  PlatformTenantRow
} from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PlatformCompaniesPage(): Promise<ReactNode> {
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

  const { t, locale } = createTranslator("ru");
  const tenants = await loadPlatformTenantSnapshots(getWebDatabase());

  return (
    <PlatformAdminShell
      access={access}
      current="companies"
      t={t}
      title={t("platform.tenants")}
      titleId="platform-companies-title"
    >
      <section className="settingsPanel" aria-labelledby="companies-title">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.controlPlane")}</p>
            <h2 className="sectionTitle" id="companies-title">
              {t("platform.tenants")}
            </h2>
            <p className="metaText">{t("platform.tenantsDescription")}</p>
          </div>
          <span className="badge">
            <Building2 size={14} aria-hidden="true" />
            {String(tenants.length)}
          </span>
        </div>
        <div className="managementList">
          {tenants.length > 0 ? (
            tenants.map((tenant) => (
              <PlatformTenantRow
                href={`/platform/companies/${encodeURIComponent(
                  tenant.tenantId
                )}`}
                key={tenant.tenantId}
                locale={locale}
                tenant={tenant}
                t={t}
              />
            ))
          ) : (
            <p className="metaText">{t("platform.tenantsEmpty")}</p>
          )}
        </div>
      </section>
    </PlatformAdminShell>
  );
}
