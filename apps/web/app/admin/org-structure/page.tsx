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
import {
  AdminSectionFrame,
  type AdminSectionFrameItem
} from "../../../src/admin-section-frame";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import {
  OrgStructureActionForm,
  OrgStructureSubmitButton,
  type OrgStructureActionMessages
} from "../../../src/org-structure-action-form";
import {
  isOrgStructureSectionId,
  orgStructureStatusKey,
  type OrgStructureSectionId,
  orgUnitKindKey,
  workQueueKindKey
} from "../../../src/org-structure-labels";
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
import { OrgUnitTree } from "../../../src/org-structure-tree";
import {
  PersistentHelpDisclosure,
  type PersistentHelpDisclosureContent,
  type PersistentHelpDisclosureLabels
} from "../../../src/persistent-help-disclosure";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

type OrgUnitTreeRow = {
  readonly orgUnit: OrgUnitRecord;
  readonly depth: number;
  readonly childCount: number;
};

export default async function OrgStructureAdminPage({
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
  const orgStructureHelp = createOrgStructureHelp(t);
  const actionMessages = orgStructureActionMessages(t);
  const selectedSection = resolveOrgStructureSection(
    resolvedSearchParams?.section
  );
  const sections: readonly AdminSectionFrameItem<OrgStructureSectionId>[] = [
    {
      id: "org_units",
      title: t("admin.orgStructure.orgUnits"),
      href: orgStructureSectionHref("org_units"),
      icon: <Building2 size={18} aria-hidden="true" />
    },
    {
      id: "teams",
      title: t("admin.orgStructure.teams"),
      href: orgStructureSectionHref("teams"),
      icon: <UsersRound size={18} aria-hidden="true" />
    },
    {
      id: "work_queues",
      title: t("admin.orgStructure.workQueues"),
      href: orgStructureSectionHref("work_queues"),
      icon: <ListChecks size={18} aria-hidden="true" />
    }
  ];

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="orgStructure"
      effectiveAccess={accessSnapshot}
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.orgStructure")}
      titleId="org-structure-title"
    >
      <AdminSectionFrame
        ariaLabel={t("admin.orgStructure.sections")}
        navTitle={t("admin.orgStructure")}
        sections={sections}
        selectedSection={selectedSection}
      >
        {selectedSection === "org_units" ? (
          <>
            <section
              className="settingsPanel helpPanel"
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
              </div>
              <PersistentHelpDisclosure
                content={orgStructureHelp.createOrgUnit}
                id="org-unit-create-help"
                labels={orgStructureHelp.labels}
                storageKey="hulee:admin:org-structure:create-org-unit:help"
              />

              <OrgStructureActionForm
                actionKind="upsertOrgUnit"
                className="settingsForm orgStructureCreateForm"
                messages={actionMessages}
                resetOnSuccess
              >
                <input name="section" type="hidden" value="org_units" />
                <OrgUnitNameField t={t} />
                <OrgUnitKindField t={t} />
                <OrgUnitParentField orgUnits={orgUnits} t={t} />
                <OrgStructureSubmitButton
                  className="primaryButton"
                  label={t("admin.orgStructure.create")}
                >
                  <Plus size={18} aria-hidden="true" />
                </OrgStructureSubmitButton>
              </OrgStructureActionForm>
            </section>

            <section
              className="settingsPanel helpPanel"
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
              </div>
              <PersistentHelpDisclosure
                content={orgStructureHelp.orgUnitsList}
                id="org-units-help"
                labels={orgStructureHelp.labels}
                storageKey="hulee:admin:org-structure:org-units-list:help"
              />

              <OrgUnitTree
                kindOptions={orgUnitKinds.map((kind) => ({
                  id: kind,
                  label: t(orgUnitKindKey(kind))
                }))}
                labels={{
                  activeStatus: t("admin.orgStructure.status.active"),
                  actionMessages,
                  archive: t("admin.orgStructure.archive"),
                  archivedStatus: t("admin.orgStructure.status.archived"),
                  childCountTemplate: t("admin.orgStructure.childCount", {
                    count: "{count}"
                  }),
                  collapse: t("admin.orgStructure.collapse"),
                  dragHandle: t("admin.orgStructure.dragHandle"),
                  dropOnRoot: t("admin.orgStructure.dropOnRoot"),
                  expand: t("admin.orgStructure.expand"),
                  kind: t("admin.orgStructure.kind"),
                  moveFailed: t("admin.orgStructure.moveFailed"),
                  moving: t("admin.orgStructure.moving"),
                  name: t("admin.orgStructure.name"),
                  noOrgUnits: t("admin.orgStructure.noOrgUnits"),
                  noParent: t("admin.orgStructure.noParent"),
                  parentOrgUnit: t("admin.orgStructure.parentOrgUnit"),
                  restore: t("admin.orgStructure.restore"),
                  root: t("admin.orgStructure.root"),
                  rootDescription: t("admin.orgStructure.root.description"),
                  save: t("common.save")
                }}
                locale={model.tenant.locale}
                orgUnits={orgUnits}
              />
            </section>
          </>
        ) : null}

        {selectedSection === "teams" ? (
          <>
            <section
              className="settingsPanel helpPanel"
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
              </div>
              <PersistentHelpDisclosure
                content={orgStructureHelp.createTeam}
                id="team-create-help"
                labels={orgStructureHelp.labels}
                storageKey="hulee:admin:org-structure:create-team:help"
              />

              <OrgStructureActionForm
                actionKind="upsertTeam"
                className="settingsForm orgStructureCreateForm"
                messages={actionMessages}
                resetOnSuccess
              >
                <input name="section" type="hidden" value="teams" />
                <TeamNameField t={t} />
                <OrgStructureSubmitButton
                  className="primaryButton"
                  label={t("admin.orgStructure.create")}
                >
                  <Plus size={18} aria-hidden="true" />
                </OrgStructureSubmitButton>
              </OrgStructureActionForm>
            </section>

            <section
              className="settingsPanel helpPanel"
              aria-labelledby="teams-title"
            >
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
              </div>
              <PersistentHelpDisclosure
                content={orgStructureHelp.teamsList}
                id="teams-help"
                labels={orgStructureHelp.labels}
                storageKey="hulee:admin:org-structure:teams-list:help"
              />

              <div className="managementList">
                {teams.length === 0 ? (
                  <p className="metaText">{t("admin.orgStructure.noTeams")}</p>
                ) : (
                  teams.map((team) => (
                    <TeamRow
                      actionMessages={actionMessages}
                      key={team.id}
                      t={t}
                      team={team}
                    />
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}

        {selectedSection === "work_queues" ? (
          <>
            <section
              className="settingsPanel helpPanel"
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
              </div>
              <PersistentHelpDisclosure
                content={orgStructureHelp.createWorkQueue}
                id="work-queue-create-help"
                labels={orgStructureHelp.labels}
                storageKey="hulee:admin:org-structure:create-work-queue:help"
              />

              <OrgStructureActionForm
                actionKind="upsertWorkQueue"
                className="settingsForm orgStructureCreateForm"
                messages={actionMessages}
                resetOnSuccess
              >
                <input name="section" type="hidden" value="work_queues" />
                <WorkQueueNameField t={t} />
                <WorkQueueKindField t={t} />
                <WorkQueueOwnerField orgUnits={orgUnits} t={t} />
                <OrgStructureSubmitButton
                  className="primaryButton"
                  label={t("admin.orgStructure.create")}
                >
                  <Plus size={18} aria-hidden="true" />
                </OrgStructureSubmitButton>
              </OrgStructureActionForm>
            </section>

            <section
              className="settingsPanel helpPanel"
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
              </div>
              <PersistentHelpDisclosure
                content={orgStructureHelp.workQueuesList}
                id="work-queues-help"
                labels={orgStructureHelp.labels}
                storageKey="hulee:admin:org-structure:work-queues-list:help"
              />

              <div className="managementList">
                {workQueues.length === 0 ? (
                  <p className="metaText">
                    {t("admin.orgStructure.noWorkQueues")}
                  </p>
                ) : (
                  workQueues.map((workQueue) => (
                    <WorkQueueRow
                      actionMessages={actionMessages}
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
      </AdminSectionFrame>
    </TenantAdminShell>
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

function orgStructureActionMessages(t: Translator): OrgStructureActionMessages {
  return {
    email_verification_required: t("auth.emailVerification.status.required"),
    invalid: t("admin.orgStructure.actionStatus.invalid"),
    org_unit_archived: t("admin.orgStructure.actionStatus.orgUnitArchived"),
    org_unit_restored: t("admin.orgStructure.actionStatus.orgUnitRestored"),
    org_unit_saved: t("admin.orgStructure.actionStatus.orgUnitSaved"),
    team_saved: t("admin.orgStructure.actionStatus.teamSaved"),
    work_queue_archived: t("admin.orgStructure.actionStatus.workQueueArchived"),
    work_queue_restored: t("admin.orgStructure.actionStatus.workQueueRestored"),
    work_queue_saved: t("admin.orgStructure.actionStatus.workQueueSaved")
  };
}

function createOrgStructureHelp(t: Translator): {
  readonly createOrgUnit: PersistentHelpDisclosureContent;
  readonly createTeam: PersistentHelpDisclosureContent;
  readonly createWorkQueue: PersistentHelpDisclosureContent;
  readonly labels: PersistentHelpDisclosureLabels;
  readonly orgUnitsList: PersistentHelpDisclosureContent;
  readonly teamsList: PersistentHelpDisclosureContent;
  readonly workQueuesList: PersistentHelpDisclosureContent;
} {
  return {
    createOrgUnit: createHelpContent(t, {
      examples: [
        "admin.orgStructure.help.createOrgUnit.example.sales",
        "admin.orgStructure.help.createOrgUnit.example.branch",
        "admin.orgStructure.help.createOrgUnit.example.service"
      ],
      paragraphs: [
        "admin.orgStructure.help.createOrgUnit.paragraph.structure",
        "admin.orgStructure.help.createOrgUnit.paragraph.scope"
      ],
      title: "admin.orgStructure.help.createOrgUnit.title"
    }),
    createTeam: createHelpContent(t, {
      examples: [
        "admin.orgStructure.help.createTeam.example.shift",
        "admin.orgStructure.help.createTeam.example.vip",
        "admin.orgStructure.help.createTeam.example.project"
      ],
      paragraphs: [
        "admin.orgStructure.help.createTeam.paragraph.group",
        "admin.orgStructure.help.createTeam.paragraph.access"
      ],
      title: "admin.orgStructure.help.createTeam.title"
    }),
    createWorkQueue: createHelpContent(t, {
      examples: [
        "admin.orgStructure.help.createWorkQueue.example.leads",
        "admin.orgStructure.help.createWorkQueue.example.claims",
        "admin.orgStructure.help.createWorkQueue.example.measurements"
      ],
      paragraphs: [
        "admin.orgStructure.help.createWorkQueue.paragraph.intake",
        "admin.orgStructure.help.createWorkQueue.paragraph.routing"
      ],
      title: "admin.orgStructure.help.createWorkQueue.title"
    }),
    labels: {
      examples: t("admin.help.examples"),
      hide: t("admin.help.hide"),
      show: t("admin.help.show")
    },
    orgUnitsList: createHelpContent(t, {
      examples: [
        "admin.orgStructure.help.orgUnitsList.example.drag",
        "admin.orgStructure.help.orgUnitsList.example.archive"
      ],
      paragraphs: [
        "admin.orgStructure.help.orgUnitsList.paragraph.tree",
        "admin.orgStructure.help.orgUnitsList.paragraph.drag"
      ],
      title: "admin.orgStructure.help.orgUnitsList.title"
    }),
    teamsList: createHelpContent(t, {
      examples: [
        "admin.orgStructure.help.teamsList.example.assign",
        "admin.orgStructure.help.teamsList.example.access"
      ],
      paragraphs: [
        "admin.orgStructure.help.teamsList.paragraph.membership",
        "admin.orgStructure.help.teamsList.paragraph.roles"
      ],
      title: "admin.orgStructure.help.teamsList.title"
    }),
    workQueuesList: createHelpContent(t, {
      examples: [
        "admin.orgStructure.help.workQueuesList.example.sales",
        "admin.orgStructure.help.workQueuesList.example.support"
      ],
      paragraphs: [
        "admin.orgStructure.help.workQueuesList.paragraph.status",
        "admin.orgStructure.help.workQueuesList.paragraph.rbac"
      ],
      title: "admin.orgStructure.help.workQueuesList.title"
    })
  };
}

function createHelpContent(
  t: Translator,
  keys: {
    readonly examples: readonly I18nMessageKey[];
    readonly paragraphs: readonly I18nMessageKey[];
    readonly title: I18nMessageKey;
  }
): PersistentHelpDisclosureContent {
  return {
    examples: keys.examples.map((key) => t(key)),
    paragraphs: keys.paragraphs.map((key) => t(key)),
    title: t(keys.title)
  };
}

function TeamRow({
  actionMessages,
  t,
  team
}: {
  readonly actionMessages: OrgStructureActionMessages;
  readonly t: Translator;
  readonly team: TeamRecord;
}): ReactNode {
  return (
    <article className="managementRow orgStructureRow">
      <span className="metricIcon">
        <UsersRound size={18} aria-hidden="true" />
      </span>
      <OrgStructureActionForm
        actionKind="upsertTeam"
        className="settingsForm orgStructureInlineForm"
        messages={actionMessages}
      >
        <input name="section" type="hidden" value="teams" />
        <input name="id" type="hidden" value={team.id} />
        <TeamNameField defaultValue={team.name} t={t} />
        <OrgStructureSubmitButton
          className="secondaryButton"
          label={t("common.save")}
        >
          <Save size={14} aria-hidden="true" />
        </OrgStructureSubmitButton>
      </OrgStructureActionForm>
    </article>
  );
}

function WorkQueueRow({
  actionMessages,
  orgUnits,
  t,
  workQueue
}: {
  readonly actionMessages: OrgStructureActionMessages;
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
      <OrgStructureActionForm
        actionKind="upsertWorkQueue"
        className="settingsForm orgStructureInlineForm"
        messages={actionMessages}
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
        <OrgStructureSubmitButton
          className="secondaryButton"
          label={t("common.save")}
        >
          <Save size={14} aria-hidden="true" />
        </OrgStructureSubmitButton>
      </OrgStructureActionForm>
      <div className="rowActions">
        <span className="badge">
          {t(orgStructureStatusKey(workQueue.status))}
        </span>
        <OrgStructureActionForm
          actionKind="setWorkQueueStatus"
          className="inlineForm"
          messages={actionMessages}
        >
          <input name="section" type="hidden" value="work_queues" />
          <input name="id" type="hidden" value={workQueue.id} />
          <input name="status" type="hidden" value={nextStatus} />
          <OrgStructureSubmitButton
            className={
              workQueue.status === "active" ? "dangerButton" : "secondaryButton"
            }
            label={t(
              workQueue.status === "active"
                ? "admin.orgStructure.archive"
                : "admin.orgStructure.restore"
            )}
          >
            {workQueue.status === "active" ? (
              <Archive size={14} aria-hidden="true" />
            ) : (
              <ArchiveRestore size={14} aria-hidden="true" />
            )}
          </OrgStructureSubmitButton>
        </OrgStructureActionForm>
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
  const excludedOrgUnitIds =
    excludeOrgUnitId === undefined
      ? new Set<string>()
      : new Set([
          excludeOrgUnitId,
          ...collectOrgUnitDescendantIds(orgUnits, excludeOrgUnitId)
        ]);
  const parentOptions = buildOrgUnitTreeRows(orgUnits).filter(
    (row) => !excludedOrgUnitIds.has(row.orgUnit.id)
  );

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
        {parentOptions.map((row) => (
          <option key={row.orgUnit.id} value={row.orgUnit.id}>
            {`${"  ".repeat(row.depth)}${orgUnitOptionLabel(row.orgUnit, t)}`}
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

function buildOrgUnitTreeRows(
  orgUnits: readonly OrgUnitRecord[]
): readonly OrgUnitTreeRow[] {
  const unitsById = new Map(orgUnits.map((orgUnit) => [orgUnit.id, orgUnit]));
  const childrenByParent = new Map<string, OrgUnitRecord[]>();

  for (const orgUnit of orgUnits) {
    const parentKey =
      orgUnit.parentOrgUnitId !== null && unitsById.has(orgUnit.parentOrgUnitId)
        ? orgUnit.parentOrgUnitId
        : "__root__";
    childrenByParent.set(parentKey, [
      ...(childrenByParent.get(parentKey) ?? []),
      orgUnit
    ]);
  }

  for (const [parentId, childOrgUnits] of childrenByParent) {
    childrenByParent.set(parentId, sortOrgUnits(childOrgUnits));
  }

  const rows: OrgUnitTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string, depth: number): void => {
    for (const orgUnit of childrenByParent.get(parentId) ?? []) {
      if (visited.has(orgUnit.id)) {
        continue;
      }

      visited.add(orgUnit.id);
      rows.push({
        orgUnit,
        depth,
        childCount: childrenByParent.get(orgUnit.id)?.length ?? 0
      });
      visit(orgUnit.id, depth + 1);
    }
  };

  visit("__root__", 0);

  for (const orgUnit of sortOrgUnits(orgUnits)) {
    if (!visited.has(orgUnit.id)) {
      rows.push({
        orgUnit,
        depth: 0,
        childCount: childrenByParent.get(orgUnit.id)?.length ?? 0
      });
      visited.add(orgUnit.id);
      visit(orgUnit.id, 1);
    }
  }

  return rows;
}

function collectOrgUnitDescendantIds(
  orgUnits: readonly OrgUnitRecord[],
  orgUnitId: string
): readonly string[] {
  const childrenByParent = new Map<string, OrgUnitRecord[]>();

  for (const orgUnit of orgUnits) {
    if (orgUnit.parentOrgUnitId === null) {
      continue;
    }

    childrenByParent.set(orgUnit.parentOrgUnitId, [
      ...(childrenByParent.get(orgUnit.parentOrgUnitId) ?? []),
      orgUnit
    ]);
  }

  const descendantIds: string[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string): void => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (visited.has(child.id)) {
        continue;
      }

      visited.add(child.id);
      descendantIds.push(child.id);
      visit(child.id);
    }
  };

  visit(orgUnitId);

  return descendantIds;
}

function sortOrgUnits(orgUnits: readonly OrgUnitRecord[]): OrgUnitRecord[] {
  return [...orgUnits].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "active" ? -1 : 1;
    }

    const nameComparison = left.name.localeCompare(right.name, "ru");

    return nameComparison === 0
      ? left.id.localeCompare(right.id)
      : nameComparison;
  });
}
