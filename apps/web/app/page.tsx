import { createTranslator } from "@hulee/i18n";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";
import { CircleSlash2, Settings } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { loadTenantAdminViewModel } from "../src/admin-view-model";
import { AppFrame } from "../src/app-chrome";
import { resolveEmployeeEffectiveAccess } from "../src/rbac-effective-access";
import { getWebDatabase, resolveCurrentWebAccessSession } from "../src/session";
import { navigationAccessFromTenantAdminAccess } from "../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InboxPage(): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const database = getWebDatabase();
  const [model, effectiveAccess] = await Promise.all([
    loadTenantAdminViewModel({ tenantId: access.tenantId, database }),
    resolveEmployeeEffectiveAccess({
      tenantId: access.tenantId,
      employeeId: access.employeeId,
      employeeRepository: createSqlEmployeeDirectoryRepository(database),
      rbacRepository: createSqlTenantRbacRepository(database)
    })
  ]);
  const { t } = createTranslator(model.tenant.locale);
  const navigationAccess = navigationAccessFromTenantAdminAccess({
    session: access,
    effectiveAccess
  });

  return (
    <AppFrame
      brand={model.tenant.brand}
      current="inbox"
      navigationAccess={navigationAccess}
      t={t}
    >
      <section
        className="cleanSlateInboxSurface"
        aria-labelledby="inbox-clean-slate-title"
      >
        <div className="cleanSlateInboxCard">
          <span className="cleanSlateInboxIcon" aria-hidden="true">
            <CircleSlash2 size={28} />
          </span>
          <p className="eyebrow">{t("inbox.cleanSlate.eyebrow")}</p>
          <h1 className="title" id="inbox-clean-slate-title">
            {t("inbox.cleanSlate.title")}
          </h1>
          <p className="cleanSlateInboxDescription">
            {t("inbox.cleanSlate.description")}
          </p>
          <p className="cleanSlateInboxStatus" role="status">
            {t("inbox.cleanSlate.status")}
          </p>
          {navigationAccess.tenantAdmin ? (
            <Link className="primaryButton" href="/admin">
              <Settings size={16} aria-hidden="true" />
              {t("inbox.cleanSlate.openAdmin")}
            </Link>
          ) : null}
        </div>
      </section>
    </AppFrame>
  );
}
