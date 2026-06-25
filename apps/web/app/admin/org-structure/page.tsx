import {
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlTenantRbacRepository,
  orgUnitKinds,
  workQueueKinds,
  type OrgUnitRecord,
  type TeamRecord,
  type WorkQueueRecord
} from "@hulee/db";
import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import {
  Archive,
  ArchiveRestore,
  Building2,
  ListChecks,
  Plus,
  Save,
  UsersRound
} from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import { DetailItem } from "../../../src/app-chrome";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import {
  isOrgStructureSectionId,
  orgStructureStatusKey,
  type OrgStructureSectionId,
  orgUnitKindKey,
  workQueueKindKey
} from "../../../src/org-structure-labels";
import {
  setOrgUnitStatusAction,
  setWorkQueueStatusAction,
  upsertOrgUnitAction,
  upsertTeamAction,
  upsertWorkQueueAction
} from "../../../src/org-structure-actions";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "../../../src/rbac-effective-access";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

type OrgStructureSection = {
  readonly id: OrgStructureSectionId;
  readonly titleKey: I18nMessageKey;
  readonly descriptionKey: I18nMessageKey;
  readonly count: number;
  readonly activeCount: number;
  readonly icon: ReactNode;
};

export default async function OrgStructureAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    orgStructureStatus?: string;
    section?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const database = getWebDatabase();
  const employeeRepository = createSqlEmployeeDirectoryRepository(database);
  const rbacRepository = createSqlTenantRbacRepository(database);
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: access.tenantId,
    employeeId: access.employeeId,
    employeeRepository,
    rbacRepository
  });

  if (!hasEffectivePermission(accessSnapshot, "employees.manage")) {
    const adminAccess = {
      session: access,
      effectiveAccess: accessSnapshot
    };

    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromTenantAdminAccess(adminAccess)}
      />
    );
  }

  const repository = createSqlOrgStructureRepository(database);
  const [model, orgUnits, teams, workQueues, resolvedSearchParams] =
    await Promise.all([
      loadTenantAdminViewModel({ tenantId: access.tenantId, database }),
      repository.listOrgUnits({ tenantId: access.tenantId }),
      repository.listTeams({ tenantId: access.tenantId }),
      repository.listWorkQueues({ tenantId: access.tenantId }),
      searchParams
    ]);
  const { t } = createTranslator(model.tenant.locale);
  const activeOrgUnits = orgUnits.filter(
    (orgUnit) => orgUnit.status === "active"
  );
  const activeWorkQueues = workQueues.filter(
    (workQueue) => workQueue.status === "active"
  );
  const selectedSection = resolveOrgStructureSection(
    resolvedSearchParams?.section
  );
  const sections: readonly OrgStructureSection[] = [
    {
      id: "org_units",
      titleKey: "admin.orgStructure.orgUnits",
      descriptionKey: "admin.orgStructure.orgUnits.description",
      count: orgUnits.length,
      activeCount: activeOrgUnits.length,
      icon: <Building2 size={18} aria-hidden="true" />
    },
    {
      id: "teams",
      titleKey: "admin.orgStructure.teams",
      descriptionKey: "admin.orgStructure.teams.description",
      count: teams.length,
      activeCount: teams.length,
      icon: <UsersRound size={18} aria-hidden="true" />
    },
    {
      id: "work_queues",
      titleKey: "admin.orgStructure.workQueues",
      descriptionKey: "admin.orgStructure.workQueues.description",
      count: workQueues.length,
      activeCount: activeWorkQueues.length,
      icon: <ListChecks size={18} aria-hidden="true" />
    }
  ];

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="orgStructure"
      effectiveAccess={accessSnapshot}
      sidebarContent={
        resolvedSearchParams?.orgStructureStatus ? (
          <DetailItem
            label={t("admin.orgStructure.actionStatus")}
            value={t(
              orgStructureActionStatusKey(
                resolvedSearchParams.orgStructureStatus
              )
            )}
          />
        ) : null
      }
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.orgStructure")}
      titleId="org-structure-title"
    >
      <div className="adminStack">
        <OrgStructureSectionNavigation
          sections={sections}
          selectedSection={selectedSection}
          t={t}
        />

        {selectedSection === "org_units" ? (
          <>
            <section
              className="settingsPanel"
              aria-labelledby="org-unit-create-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.orgStructure.orgUnits")}</p>
                  <h2 className="sectionTitle" id="org-unit-create-title">
                    {t("admin.orgStructure.createOrgUnit")}
                  </h2>
                  <p className="metaText">
                    {t("admin.orgStructure.createOrgUnit.description")}
                  </p>
                </div>
                <span className="badge">{activeOrgUnits.length}</span>
              </div>

              <form
                className="settingsForm orgStructureCreateForm"
                action={upsertOrgUnitAction}
              >
                <input name="section" type="hidden" value="org_units" />
                <OrgUnitNameField t={t} />
                <OrgUnitKindField t={t} />
                <OrgUnitParentField orgUnits={orgUnits} t={t} />
                <button className="primaryButton" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  {t("admin.orgStructure.create")}
                </button>
              </form>
            </section>

            <section
              className="settingsPanel"
              aria-labelledby="org-units-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.directory")}</p>
                  <h2 className="sectionTitle" id="org-units-title">
                    {t("admin.orgStructure.orgUnits")}
                  </h2>
                  <p className="metaText">
                    {t("admin.orgStructure.orgUnits.description")}
                  </p>
                </div>
                <span className="badge">{orgUnits.length}</span>
              </div>

              <div className="managementList">
                {orgUnits.length === 0 ? (
                  <p className="metaText">
                    {t("admin.orgStructure.noOrgUnits")}
                  </p>
                ) : (
                  orgUnits.map((orgUnit) => (
                    <OrgUnitRow
                      key={orgUnit.id}
                      orgUnit={orgUnit}
                      orgUnits={orgUnits}
                      t={t}
                    />
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}

        {selectedSection === "teams" ? (
          <>
            <section
              className="settingsPanel"
              aria-labelledby="team-create-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.orgStructure.teams")}</p>
                  <h2 className="sectionTitle" id="team-create-title">
                    {t("admin.orgStructure.createTeam")}
                  </h2>
                  <p className="metaText">
                    {t("admin.orgStructure.createTeam.description")}
                  </p>
                </div>
                <span className="badge">{teams.length}</span>
              </div>

              <form
                className="settingsForm orgStructureCreateForm"
                action={upsertTeamAction}
              >
                <input name="section" type="hidden" value="teams" />
                <TeamNameField t={t} />
                <button className="primaryButton" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  {t("admin.orgStructure.create")}
                </button>
              </form>
            </section>

            <section className="settingsPanel" aria-labelledby="teams-title">
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.directory")}</p>
                  <h2 className="sectionTitle" id="teams-title">
                    {t("admin.orgStructure.teams")}
                  </h2>
                  <p className="metaText">
                    {t("admin.orgStructure.teams.description")}
                  </p>
                </div>
                <span className="badge">{teams.length}</span>
              </div>

              <div className="managementList">
                {teams.length === 0 ? (
                  <p className="metaText">{t("admin.orgStructure.noTeams")}</p>
                ) : (
                  teams.map((team) => (
                    <TeamRow key={team.id} t={t} team={team} />
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}

        {selectedSection === "work_queues" ? (
          <>
            <section
              className="settingsPanel"
              aria-labelledby="work-queue-create-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">
                    {t("admin.orgStructure.workQueues")}
                  </p>
                  <h2 className="sectionTitle" id="work-queue-create-title">
                    {t("admin.orgStructure.createWorkQueue")}
                  </h2>
                  <p className="metaText">
                    {t("admin.orgStructure.createWorkQueue.description")}
                  </p>
                </div>
                <span className="badge">{activeWorkQueues.length}</span>
              </div>

              <form
                className="settingsForm orgStructureCreateForm"
                action={upsertWorkQueueAction}
              >
                <input name="section" type="hidden" value="work_queues" />
                <WorkQueueNameField t={t} />
                <WorkQueueKindField t={t} />
                <WorkQueueOwnerField orgUnits={orgUnits} t={t} />
                <button className="primaryButton" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  {t("admin.orgStructure.create")}
                </button>
              </form>
            </section>

            <section
              className="settingsPanel"
              aria-labelledby="work-queues-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.directory")}</p>
                  <h2 className="sectionTitle" id="work-queues-title">
                    {t("admin.orgStructure.workQueues")}
                  </h2>
                  <p className="metaText">
                    {t("admin.orgStructure.workQueues.description")}
                  </p>
                </div>
                <span className="badge">{workQueues.length}</span>
              </div>

              <div className="managementList">
                {workQueues.length === 0 ? (
                  <p className="metaText">
                    {t("admin.orgStructure.noWorkQueues")}
                  </p>
                ) : (
                  workQueues.map((workQueue) => (
                    <WorkQueueRow
                      key={workQueue.id}
                      orgUnits={orgUnits}
                      t={t}
                      workQueue={workQueue}
                    />
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </TenantAdminShell>
  );
}

function OrgStructureSectionNavigation({
  sections,
  selectedSection,
  t
}: {
  readonly sections: readonly OrgStructureSection[];
  readonly selectedSection: OrgStructureSectionId;
  readonly t: Translator;
}): ReactNode {
  return (
    <section
      className="settingsPanel orgStructureSectionPanel"
      aria-labelledby="org-structure-sections-title"
    >
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.orgStructure")}</p>
          <h2 className="sectionTitle" id="org-structure-sections-title">
            {t("admin.orgStructure.workspace")}
          </h2>
          <p className="metaText">
            {t("admin.orgStructure.workspace.description")}
          </p>
        </div>
      </div>

      <nav
        className="orgStructureTabs"
        aria-label={t("admin.orgStructure.sections")}
      >
        {sections.map((section) => (
          <a
            key={section.id}
            className={
              section.id === selectedSection
                ? "orgStructureTab orgStructureTabActive"
                : "orgStructureTab"
            }
            href={orgStructureSectionHref(section.id)}
            aria-current={section.id === selectedSection ? "page" : undefined}
          >
            <span className="metricIcon">{section.icon}</span>
            <span className="orgStructureTabBody">
              <span className="orgStructureTabTitle">
                {t(section.titleKey)}
              </span>
              <span className="orgStructureTabDescription">
                {t(section.descriptionKey)}
              </span>
            </span>
            <span className="orgStructureTabMeta">
              <span className="badge">
                {t("admin.orgStructure.totalCount", {
                  count: section.count
                })}
              </span>
              <span className="badge">
                {t("admin.orgStructure.activeCount", {
                  count: section.activeCount
                })}
              </span>
            </span>
          </a>
        ))}
      </nav>
    </section>
  );
}

function resolveOrgStructureSection(
  section: string | undefined
): OrgStructureSectionId {
  if (section !== undefined && isOrgStructureSectionId(section)) {
    return section;
  }

  return "org_units";
}

function orgStructureSectionHref(section: OrgStructureSectionId): string {
  const params = new URLSearchParams({ section });

  return `/admin/org-structure?${params.toString()}`;
}

function OrgUnitRow({
  orgUnit,
  orgUnits,
  t
}: {
  readonly orgUnit: OrgUnitRecord;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly t: Translator;
}): ReactNode {
  const nextStatus = orgUnit.status === "active" ? "archived" : "active";

  return (
    <article className="managementRow orgStructureRow">
      <span className="metricIcon">
        <Building2 size={18} aria-hidden="true" />
      </span>
      <form
        className="settingsForm orgStructureInlineForm"
        action={upsertOrgUnitAction}
      >
        <input name="section" type="hidden" value="org_units" />
        <input name="id" type="hidden" value={orgUnit.id} />
        <OrgUnitNameField defaultValue={orgUnit.name} t={t} />
        <OrgUnitKindField defaultValue={orgUnit.kind} t={t} />
        <OrgUnitParentField
          defaultValue={orgUnit.parentOrgUnitId ?? ""}
          excludeOrgUnitId={orgUnit.id}
          orgUnits={orgUnits}
          t={t}
        />
        <button className="secondaryButton" type="submit">
          <Save size={14} aria-hidden="true" />
          {t("common.save")}
        </button>
      </form>
      <div className="rowActions">
        <span className="badge">
          {t(orgStructureStatusKey(orgUnit.status))}
        </span>
        <form className="inlineForm" action={setOrgUnitStatusAction}>
          <input name="section" type="hidden" value="org_units" />
          <input name="id" type="hidden" value={orgUnit.id} />
          <input name="status" type="hidden" value={nextStatus} />
          <button
            className={
              orgUnit.status === "active" ? "dangerButton" : "secondaryButton"
            }
            type="submit"
          >
            {orgUnit.status === "active" ? (
              <Archive size={14} aria-hidden="true" />
            ) : (
              <ArchiveRestore size={14} aria-hidden="true" />
            )}
            {t(
              orgUnit.status === "active"
                ? "admin.orgStructure.archive"
                : "admin.orgStructure.restore"
            )}
          </button>
        </form>
      </div>
    </article>
  );
}

function TeamRow({
  t,
  team
}: {
  readonly t: Translator;
  readonly team: TeamRecord;
}): ReactNode {
  return (
    <article className="managementRow orgStructureRow">
      <span className="metricIcon">
        <UsersRound size={18} aria-hidden="true" />
      </span>
      <form
        className="settingsForm orgStructureInlineForm"
        action={upsertTeamAction}
      >
        <input name="section" type="hidden" value="teams" />
        <input name="id" type="hidden" value={team.id} />
        <TeamNameField defaultValue={team.name} t={t} />
        <button className="secondaryButton" type="submit">
          <Save size={14} aria-hidden="true" />
          {t("common.save")}
        </button>
      </form>
    </article>
  );
}

function WorkQueueRow({
  orgUnits,
  t,
  workQueue
}: {
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly t: Translator;
  readonly workQueue: WorkQueueRecord;
}): ReactNode {
  const nextStatus = workQueue.status === "active" ? "archived" : "active";

  return (
    <article className="managementRow orgStructureRow">
      <span className="metricIcon">
        <ListChecks size={18} aria-hidden="true" />
      </span>
      <form
        className="settingsForm orgStructureInlineForm"
        action={upsertWorkQueueAction}
      >
        <input name="section" type="hidden" value="work_queues" />
        <input name="id" type="hidden" value={workQueue.id} />
        <WorkQueueNameField defaultValue={workQueue.name} t={t} />
        <WorkQueueKindField defaultValue={workQueue.kind} t={t} />
        <WorkQueueOwnerField
          defaultValue={workQueue.owningOrgUnitId ?? ""}
          orgUnits={orgUnits}
          t={t}
        />
        <button className="secondaryButton" type="submit">
          <Save size={14} aria-hidden="true" />
          {t("common.save")}
        </button>
      </form>
      <div className="rowActions">
        <span className="badge">
          {t(orgStructureStatusKey(workQueue.status))}
        </span>
        <form className="inlineForm" action={setWorkQueueStatusAction}>
          <input name="section" type="hidden" value="work_queues" />
          <input name="id" type="hidden" value={workQueue.id} />
          <input name="status" type="hidden" value={nextStatus} />
          <button
            className={
              workQueue.status === "active" ? "dangerButton" : "secondaryButton"
            }
            type="submit"
          >
            {workQueue.status === "active" ? (
              <Archive size={14} aria-hidden="true" />
            ) : (
              <ArchiveRestore size={14} aria-hidden="true" />
            )}
            {t(
              workQueue.status === "active"
                ? "admin.orgStructure.archive"
                : "admin.orgStructure.restore"
            )}
          </button>
        </form>
      </div>
    </article>
  );
}

function OrgUnitNameField({
  defaultValue,
  t
}: {
  readonly defaultValue?: string;
  readonly t: Translator;
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">{t("admin.orgStructure.name")}</span>
      <input
        className="textInput"
        defaultValue={defaultValue}
        maxLength={120}
        name="name"
        required
        type="text"
      />
    </label>
  );
}

function TeamNameField({
  defaultValue,
  t
}: {
  readonly defaultValue?: string;
  readonly t: Translator;
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">{t("admin.orgStructure.teamName")}</span>
      <input
        className="textInput"
        defaultValue={defaultValue}
        maxLength={120}
        name="name"
        required
        type="text"
      />
    </label>
  );
}

function OrgUnitKindField({
  defaultValue = "department",
  t
}: {
  readonly defaultValue?: OrgUnitRecord["kind"];
  readonly t: Translator;
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">{t("admin.orgStructure.kind")}</span>
      <select
        className="selectInput"
        defaultValue={defaultValue}
        name="kind"
        required
      >
        {orgUnitKinds.map((kind) => (
          <option key={kind} value={kind}>
            {t(orgUnitKindKey(kind))}
          </option>
        ))}
      </select>
    </label>
  );
}

function OrgUnitParentField({
  defaultValue = "",
  excludeOrgUnitId,
  orgUnits,
  t
}: {
  readonly defaultValue?: string;
  readonly excludeOrgUnitId?: string;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly t: Translator;
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">
        {t("admin.orgStructure.parentOrgUnit")}
      </span>
      <select
        className="selectInput"
        defaultValue={defaultValue}
        name="parentOrgUnitId"
      >
        <option value="">{t("admin.orgStructure.noParent")}</option>
        {orgUnits
          .filter((orgUnit) => orgUnit.id !== excludeOrgUnitId)
          .map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnitOptionLabel(orgUnit, t)}
            </option>
          ))}
      </select>
    </label>
  );
}

function WorkQueueNameField({
  defaultValue,
  t
}: {
  readonly defaultValue?: string;
  readonly t: Translator;
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">{t("admin.orgStructure.name")}</span>
      <input
        className="textInput"
        defaultValue={defaultValue}
        maxLength={120}
        name="name"
        required
        type="text"
      />
    </label>
  );
}

function WorkQueueKindField({
  defaultValue = "lead_intake",
  t
}: {
  readonly defaultValue?: WorkQueueRecord["kind"];
  readonly t: Translator;
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">{t("admin.orgStructure.kind")}</span>
      <select
        className="selectInput"
        defaultValue={defaultValue}
        name="kind"
        required
      >
        {workQueueKinds.map((kind) => (
          <option key={kind} value={kind}>
            {t(workQueueKindKey(kind))}
          </option>
        ))}
      </select>
    </label>
  );
}

function WorkQueueOwnerField({
  defaultValue = "",
  orgUnits,
  t
}: {
  readonly defaultValue?: string;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly t: Translator;
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">
        {t("admin.orgStructure.owningOrgUnit")}
      </span>
      <select
        className="selectInput"
        defaultValue={defaultValue}
        name="owningOrgUnitId"
      >
        <option value="">{t("admin.orgStructure.noOwner")}</option>
        {orgUnits.map((orgUnit) => (
          <option key={orgUnit.id} value={orgUnit.id}>
            {orgUnitOptionLabel(orgUnit, t)}
          </option>
        ))}
      </select>
    </label>
  );
}

function orgUnitOptionLabel(orgUnit: OrgUnitRecord, t: Translator): string {
  if (orgUnit.status === "active") {
    return orgUnit.name;
  }

  return `${orgUnit.name} (${t(orgStructureStatusKey(orgUnit.status))})`;
}

function orgStructureActionStatusKey(status: string): I18nMessageKey {
  switch (status) {
    case "org_unit_saved":
      return "admin.orgStructure.actionStatus.orgUnitSaved";
    case "org_unit_archived":
      return "admin.orgStructure.actionStatus.orgUnitArchived";
    case "org_unit_restored":
      return "admin.orgStructure.actionStatus.orgUnitRestored";
    case "team_saved":
      return "admin.orgStructure.actionStatus.teamSaved";
    case "work_queue_saved":
      return "admin.orgStructure.actionStatus.workQueueSaved";
    case "work_queue_archived":
      return "admin.orgStructure.actionStatus.workQueueArchived";
    case "work_queue_restored":
      return "admin.orgStructure.actionStatus.workQueueRestored";
    case "email_verification_required":
      return "auth.emailVerification.status.required";
    default:
      return "admin.orgStructure.actionStatus.invalid";
  }
}
