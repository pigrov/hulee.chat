import { createSqlDeploymentEgressStatusRepository } from "@hulee/db";
import { createTranslator } from "@hulee/i18n";
import { KeyRound, Network, Server, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../src/access";
import {
  AdminSectionFrame,
  type AdminSectionFrameItem
} from "../../../src/admin-section-frame";
import { DetailItem } from "../../../src/app-chrome";
import {
  egressStatusKey,
  resolveOverallEgressStatus
} from "../../../src/egress-formatting";
import {
  formatDeploymentType,
  ManagementRow,
  PlatformEgressProfile
} from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import { loadPlatformEgressStatus } from "../../../src/platform-egress-status";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession,
  resolveWebConfig
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const deploymentSectionIds = [
  "deployment",
  "commercial",
  "support",
  "egress"
] as const;

type DeploymentSectionId = (typeof deploymentSectionIds)[number];
type Translator = ReturnType<typeof createTranslator>["t"];

export default async function PlatformDeploymentsPage({
  searchParams
}: {
  searchParams?: Promise<{
    section?: string;
  }>;
}): Promise<ReactNode> {
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
  const database = getWebDatabase();
  const webConfig = resolveWebConfig();
  const publicBaseUrl = webConfig.publicBaseUrl ?? "http://127.0.0.1:3001";
  const [resolvedSearchParams, egressStatus] = await Promise.all([
    searchParams,
    loadPlatformEgressStatus({
      config: webConfig,
      repository: createSqlDeploymentEgressStatusRepository(database)
    })
  ]);
  const selectedSection = resolveDeploymentSection(
    resolvedSearchParams?.section
  );
  const overallStatus = resolveOverallEgressStatus(egressStatus.profiles);
  const sections: readonly AdminSectionFrameItem<DeploymentSectionId>[] = [
    {
      id: "deployment",
      href: deploymentSectionHref("deployment"),
      icon: <Server size={18} aria-hidden="true" />,
      title: t("platform.deployments")
    },
    {
      id: "commercial",
      href: deploymentSectionHref("commercial"),
      icon: <KeyRound size={18} aria-hidden="true" />,
      title: t("platform.commercial")
    },
    {
      id: "support",
      href: deploymentSectionHref("support"),
      icon: <ShieldCheck size={18} aria-hidden="true" />,
      title: t("platform.supportAccess")
    },
    {
      id: "egress",
      href: deploymentSectionHref("egress"),
      icon: <Network size={18} aria-hidden="true" />,
      title: t("platform.egress")
    }
  ];

  return (
    <PlatformAdminShell
      access={access}
      current="deployments"
      t={t}
      title={t("platform.deployments")}
      titleId="platform-deployments-title"
    >
      <AdminSectionFrame
        ariaLabel={t("platform.deployments")}
        navTitle={t("platform.deployments")}
        sections={sections}
        selectedSection={selectedSection}
      >
        <section
          className="settingsPanel"
          aria-labelledby="deployments-title"
          hidden={selectedSection !== "deployment"}
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("platform.controlPlane")}</p>
              <h2 className="sectionTitle" id="deployments-title">
                {t("platform.deployments")}
              </h2>
            </div>
            <Server size={18} aria-hidden="true" />
          </div>
          <div className="detailGrid">
            <DetailItem
              label={t("platform.deploymentType")}
              value={formatDeploymentType(webConfig.deploymentType, t)}
            />
            <DetailItem
              label={t("platform.publicBaseUrl")}
              value={publicBaseUrl}
            />
            <DetailItem
              label={t("platform.dataPlane")}
              value={t("platform.status.currentDeployment")}
            />
          </div>
        </section>

        <CommercialSection selected={selectedSection === "commercial"} t={t} />
        <SupportSection selected={selectedSection === "support"} t={t} />

        <section
          className="settingsPanel"
          aria-labelledby="egress-title"
          hidden={selectedSection !== "egress"}
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("platform.dataPlane")}</p>
              <h2 className="sectionTitle" id="egress-title">
                {t("platform.egress")}
              </h2>
              <p className="metaText">{t("platform.egressDescription")}</p>
            </div>
            <span className="badge">
              <Network size={14} aria-hidden="true" />
              {t(egressStatusKey(overallStatus))}
            </span>
          </div>
          <div className="managementList">
            {egressStatus.profiles.map((profile) => (
              <PlatformEgressProfile
                key={profile.profileId}
                locale={locale}
                profile={profile}
                t={t}
              />
            ))}
          </div>
        </section>
      </AdminSectionFrame>
    </PlatformAdminShell>
  );
}

function CommercialSection({
  selected,
  t
}: {
  selected: boolean;
  t: Translator;
}): ReactNode {
  return (
    <section
      className="settingsPanel"
      aria-labelledby="commercial-title"
      hidden={!selected}
    >
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
  );
}

function SupportSection({
  selected,
  t
}: {
  selected: boolean;
  t: Translator;
}): ReactNode {
  return (
    <section
      className="settingsPanel"
      aria-labelledby="support-title"
      hidden={!selected}
    >
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
  );
}

function deploymentSectionHref(section: DeploymentSectionId): string {
  return `/platform/deployments?section=${encodeURIComponent(section)}`;
}

function resolveDeploymentSection(
  value: string | undefined
): DeploymentSectionId {
  return isDeploymentSectionId(value) ? value : "deployment";
}

function isDeploymentSectionId(
  value: string | undefined
): value is DeploymentSectionId {
  return deploymentSectionIds.some((section) => section === value);
}
