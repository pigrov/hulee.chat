import { defaultBrandProfile } from "@hulee/branding";
import { createTranslator } from "@hulee/i18n";
import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

import {
  AppFrame,
  type AppNavigationSection,
  type NavigationAccess
} from "./app-chrome";

export function AccessDeniedPage({
  current,
  navigationAccess
}: {
  current: AppNavigationSection;
  navigationAccess?: NavigationAccess;
}): ReactNode {
  const { t } = createTranslator("ru");

  return (
    <AppFrame
      brand={defaultBrandProfile}
      current={current}
      frameClassName="adminFrame"
      navigationAccess={navigationAccess}
      t={t}
    >
      <section className="adminWorkspace" aria-labelledby="access-denied-title">
        <div className="accessDenied">
          <div className="metricIcon">
            <LockKeyhole size={20} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">{t("access.denied.eyebrow")}</p>
            <h1 className="adminTitle" id="access-denied-title">
              {t("access.denied.title")}
            </h1>
            <p className="metaText">{t("access.denied.description")}</p>
          </div>
        </div>
      </section>
    </AppFrame>
  );
}
