import {
  getPermissionDefinition,
  permissionCatalog,
  resolveEffectivePermissionGrants,
  type DirectPermissionGrant,
  type EffectivePermissionGrant,
  type Permission,
  type PermissionDomain,
  type PermissionGrantSource,
  type PermissionRoleBinding,
  type PermissionRoleBindingSubject,
  type PermissionScope,
  type PermissionScopeType,
  type PermissionActor
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlTenantRbacRepository,
  type OrgUnitRecord,
  type TenantEmployeeRecord,
  type TenantRoleRecord,
  type TeamRecord,
  type WorkQueueRecord
} from "@hulee/db";
import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import {
  Archive,
  ArchiveRestore,
  KeyRound,
  ListChecks,
  Plus,
  Save,
  Search,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import { DetailItem } from "../../../src/app-chrome";
import { loadInboxViewModel } from "../../../src/inbox-api-client";
import {
  archiveCustomTenantRoleAction,
  assignTenantRoleAction,
  createDirectPermissionGrantAction,
  createCustomTenantRoleAction,
  createRoleFromTemplateAction,
  restoreCustomTenantRoleAction,
  revokeDirectPermissionGrantAction,
  updateCustomTenantRoleAction,
  revokeTenantRoleBindingAction
} from "../../../src/role-actions";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import { allowedRoleBindingScopeTypesForPermissions } from "../../../src/rbac-scope";
import { buildScopeReferenceOptions } from "../../../src/rbac-scope-options";
import {
  DirectGrantFields,
  RoleAssignmentFields,
  type RoleAssignmentSubjectOptions,
  type ScopePickerMessages
} from "../../../src/rbac-scope-picker";
import {
  roleTemplateCatalog,
  type RoleTemplateDefinition
} from "../../../src/role-templates";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "../../../src/rbac-effective-access";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const domainOrder = [
  "tenant",
  "employees",
  "roles",
  "integrations",
  "branding",
  "inbox",
  "messages",
  "conversations",
  "clients",
  "leads",
  "files",
  "reports",
  "audit",
  "api"
] as const satisfies readonly PermissionDomain[];

type Translator = ReturnType<typeof createTranslator>["t"];

type DomainSummary = {
  domain: PermissionDomain;
  permissions: readonly Permission[];
};

export default async function RolesAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    accessPreviewEmployeeId?: string;
    roleActionStatus?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const repository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  const now = new Date();
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: access.tenantId,
    employeeId: access.employeeId,
    employeeRepository,
    rbacRepository: repository,
    at: now
  });

  if (!hasEffectivePermission(accessSnapshot, "roles.manage")) {
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

  const orgStructureRepository =
    createSqlOrgStructureRepository(getWebDatabase());
  const [
    model,
    roles,
    roleBindings,
    directGrants,
    expiredRoleBindings,
    expiredDirectGrants,
    employees,
    orgUnits,
    teams,
    workQueues,
    resolvedSearchParams
  ] = await Promise.all([
    loadInboxViewModel(),
    repository.listRoleDefinitions({ tenantId: access.tenantId }),
    repository.listRoleBindings({ tenantId: access.tenantId, at: now }),
    repository.listDirectGrants({ tenantId: access.tenantId, at: now }),
    repository.listExpiredRoleBindings({
      tenantId: access.tenantId,
      at: now
    }),
    repository.listExpiredDirectGrants({
      tenantId: access.tenantId,
      at: now
    }),
    employeeRepository.listEmployees({ tenantId: access.tenantId }),
    orgStructureRepository.listOrgUnits({
      tenantId: access.tenantId,
      activeOnly: true
    }),
    orgStructureRepository.listTeams({
      tenantId: access.tenantId
    }),
    orgStructureRepository.listWorkQueues({
      tenantId: access.tenantId,
      activeOnly: true
    }),
    searchParams
  ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const activeRoles = roles.filter((role) => role.status === "active");
  const activeEmployees = employees.filter(
    (employee) => employee.deactivatedAt === null
  );
  const roleAssignmentOptions = activeRoles.map((role) => ({
    id: role.id,
    label: roleName(role, t),
    allowedScopeTypes: allowedRoleBindingScopeTypesForPermissions(
      role.permissions
    )
  }));
  const directGrantPermissionOptions = permissionCatalog.map((definition) => ({
    id: definition.id,
    label: `${definition.id} - ${t(permissionDomainKey(definition.domain))}`,
    allowedScopeTypes: definition.allowedScopes
  }));
  const employeeOptions = activeEmployees.map((employee) => ({
    value: employee.employeeId,
    label: employee.displayName
  }));
  const roleAssignmentSubjectOptions = {
    employee: employeeOptions,
    org_unit: orgUnits.map((orgUnit) => ({
      value: orgUnit.id,
      label: orgUnit.name
    })),
    team: teams.map((team) => ({
      value: team.id,
      label: team.name
    })),
    queue: workQueues.map((workQueue) => ({
      value: workQueue.id,
      label: workQueue.name
    }))
  } satisfies RoleAssignmentSubjectOptions;
  const roleAssignmentSubjectCount = Object.values(
    roleAssignmentSubjectOptions
  ).reduce((count, options) => count + options.length, 0);
  const scopeReferenceOptions = buildScopeReferenceOptions({
    orgUnits,
    teams,
    workQueues
  });
  const roleBindingsByRoleId = countBindingsByRoleId(roleBindings);
  const accessPreviewEmployee = activeEmployees.find(
    (employee) =>
      employee.employeeId === resolvedSearchParams?.accessPreviewEmployeeId
  );
  const effectiveAccessPreview =
    accessPreviewEmployee === undefined
      ? undefined
      : buildEffectiveAccessPreview({
          at: now,
          directGrants,
          employee: accessPreviewEmployee,
          roleBindings,
          roles,
          tenantId: access.tenantId
        });

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="roles"
      effectiveAccess={accessSnapshot}
      sidebarContent={
        resolvedSearchParams?.roleActionStatus ? (
          <DetailItem
            label={t("admin.roles.actionStatus")}
            value={t(
              roleActionStatusKey(resolvedSearchParams.roleActionStatus)
            )}
          />
        ) : null
      }
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.roles")}
      titleId="roles-title"
    >
      <div className="adminStack">
        <section className="settingsPanel" aria-labelledby="role-create-title">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.editor")}</p>
              <h2 className="sectionTitle" id="role-create-title">
                {t("admin.roles.createRole")}
              </h2>
              <p className="metaText">
                {t("admin.roles.createRole.description")}
              </p>
            </div>
            <span className="badge">{permissionCatalog.length}</span>
          </div>

          <form className="settingsForm" action={createCustomTenantRoleAction}>
            <div className="roleEditorGrid">
              <label className="fieldStack">
                <span className="detailLabel">{t("admin.roles.roleName")}</span>
                <input
                  className="textInput"
                  name="name"
                  type="text"
                  maxLength={80}
                  required
                />
              </label>
              <label className="fieldStack">
                <span className="detailLabel">
                  {t("admin.roles.roleDescription")}
                </span>
                <textarea
                  className="textInput roleDescriptionInput"
                  name="description"
                  maxLength={500}
                />
              </label>
            </div>

            <PermissionCheckboxGroups selectedPermissions={[]} t={t} />

            <button className="primaryButton" type="submit">
              <Plus size={18} aria-hidden="true" />
              {t("admin.roles.create")}
            </button>
          </form>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="role-templates-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.templates")}</p>
              <h2 className="sectionTitle" id="role-templates-title">
                {t("admin.roles.createFromTemplate")}
              </h2>
              <p className="metaText">
                {t("admin.roles.createFromTemplate.description")}
              </p>
            </div>
            <span className="badge">{roleTemplateCatalog.length}</span>
          </div>

          <div className="managementList">
            {roleTemplateCatalog.map((template) => (
              <RoleTemplateRow
                key={template.id}
                locale={locale}
                t={t}
                template={template}
              />
            ))}
          </div>
        </section>

        <section className="settingsPanel" aria-labelledby="role-assign-title">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.assignments")}</p>
              <h2 className="sectionTitle" id="role-assign-title">
                {t("admin.roles.assignRole")}
              </h2>
              <p className="metaText">
                {t("admin.roles.assignRole.description")}
              </p>
            </div>
            <span className="badge">{roleAssignmentSubjectCount}</span>
          </div>

          <form
            className="settingsForm roleAssignForm"
            action={assignTenantRoleAction}
          >
            <RoleAssignmentFields
              employees={employeeOptions}
              messages={scopePickerMessages(t)}
              roles={roleAssignmentOptions}
              scopeReferenceOptions={scopeReferenceOptions}
              subjectOptions={roleAssignmentSubjectOptions}
            />
            <button
              className="primaryButton"
              type="submit"
              disabled={
                roleAssignmentSubjectCount === 0 ||
                roleAssignmentOptions.length === 0
              }
            >
              <Plus size={18} aria-hidden="true" />
              {t("admin.roles.assign")}
            </button>
          </form>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="access-preview-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.accessPreview")}</p>
              <h2 className="sectionTitle" id="access-preview-title">
                {t("admin.roles.effectiveAccessPreview")}
              </h2>
              <p className="metaText">
                {t("admin.roles.effectiveAccessPreview.description")}
              </p>
            </div>
            <span className="badge">
              {effectiveAccessPreview?.length ?? activeEmployees.length}
            </span>
          </div>

          <form className="settingsForm accessPreviewForm" method="get">
            <label className="fieldStack">
              <span className="detailLabel">
                {t("admin.roles.previewEmployee")}
              </span>
              <select
                className="selectInput"
                defaultValue={accessPreviewEmployee?.employeeId ?? ""}
                name="accessPreviewEmployeeId"
                required
              >
                <option value="">{t("admin.roles.selectEmployee")}</option>
                {employeeOptions.map((employee) => (
                  <option key={employee.value} value={employee.value}>
                    {employee.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primaryButton"
              disabled={employeeOptions.length === 0}
              type="submit"
            >
              <Search size={18} aria-hidden="true" />
              {t("admin.roles.previewAccess")}
            </button>
          </form>

          {effectiveAccessPreview === undefined ? (
            <p className="metaText">{t("admin.roles.noAccessPreview")}</p>
          ) : effectiveAccessPreview.length === 0 ? (
            <p className="metaText">{t("admin.roles.noEffectiveAccess")}</p>
          ) : (
            <div className="managementList">
              {effectiveAccessPreview.map((grant) => (
                <EffectiveGrantRow
                  employees={employees}
                  grant={grant}
                  key={effectiveGrantKey(grant)}
                  orgUnits={orgUnits}
                  roleBindings={roleBindings}
                  roles={roles}
                  t={t}
                  teams={teams}
                  workQueues={workQueues}
                />
              ))}
            </div>
          )}
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="role-bindings-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.assignments")}</p>
              <h2 className="sectionTitle" id="role-bindings-title">
                {t("admin.roles.activeAssignments")}
              </h2>
              <p className="metaText">
                {t("admin.roles.activeAssignments.description")}
              </p>
            </div>
            <span className="badge">{roleBindings.length}</span>
          </div>

          <div className="managementList">
            {roleBindings.length === 0 ? (
              <p className="metaText">{t("admin.roles.noAssignments")}</p>
            ) : (
              roleBindings.map((binding) => (
                <RoleBindingRow
                  binding={binding}
                  currentEmployeeId={access.employeeId}
                  employees={employees}
                  key={binding.id}
                  orgUnits={orgUnits}
                  roles={roles}
                  t={t}
                  teams={teams}
                  workQueues={workQueues}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="expired-role-bindings-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.assignments")}</p>
              <h2 className="sectionTitle" id="expired-role-bindings-title">
                {t("admin.roles.expiredAssignments")}
              </h2>
              <p className="metaText">
                {t("admin.roles.expiredAssignments.description")}
              </p>
            </div>
            <span className="badge">{expiredRoleBindings.length}</span>
          </div>

          <div className="managementList">
            {expiredRoleBindings.length === 0 ? (
              <p className="metaText">
                {t("admin.roles.noExpiredAssignments")}
              </p>
            ) : (
              expiredRoleBindings.map((binding) => (
                <RoleBindingRow
                  binding={binding}
                  currentEmployeeId={access.employeeId}
                  employees={employees}
                  expired
                  key={binding.id}
                  orgUnits={orgUnits}
                  roles={roles}
                  t={t}
                  teams={teams}
                  workQueues={workQueues}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="direct-grant-create-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.directGrants")}</p>
              <h2 className="sectionTitle" id="direct-grant-create-title">
                {t("admin.roles.addDirectGrant")}
              </h2>
              <p className="metaText">
                {t("admin.roles.addDirectGrant.description")}
              </p>
            </div>
            <span className="badge">{permissionCatalog.length}</span>
          </div>

          <form
            className="settingsForm directGrantForm"
            action={createDirectPermissionGrantAction}
          >
            <DirectGrantFields
              employees={employeeOptions}
              messages={scopePickerMessages(t)}
              permissions={directGrantPermissionOptions}
              scopeReferenceOptions={scopeReferenceOptions}
            />
            <button
              className="primaryButton"
              type="submit"
              disabled={
                employeeOptions.length === 0 ||
                directGrantPermissionOptions.length === 0
              }
            >
              <Plus size={18} aria-hidden="true" />
              {t("admin.roles.grantDirectPermission")}
            </button>
          </form>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="direct-grants-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.directGrants")}</p>
              <h2 className="sectionTitle" id="direct-grants-title">
                {t("admin.roles.activeDirectGrants")}
              </h2>
              <p className="metaText">
                {t("admin.roles.activeDirectGrants.description")}
              </p>
            </div>
            <span className="badge">{directGrants.length}</span>
          </div>

          <div className="managementList">
            {directGrants.length === 0 ? (
              <p className="metaText">{t("admin.roles.noDirectGrants")}</p>
            ) : (
              directGrants.map((grant) => (
                <DirectGrantRow
                  currentEmployeeId={access.employeeId}
                  employees={employees}
                  grant={grant}
                  key={grant.id}
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="expired-direct-grants-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.directGrants")}</p>
              <h2 className="sectionTitle" id="expired-direct-grants-title">
                {t("admin.roles.expiredDirectGrants")}
              </h2>
              <p className="metaText">
                {t("admin.roles.expiredDirectGrants.description")}
              </p>
            </div>
            <span className="badge">{expiredDirectGrants.length}</span>
          </div>

          <div className="managementList">
            {expiredDirectGrants.length === 0 ? (
              <p className="metaText">
                {t("admin.roles.noExpiredDirectGrants")}
              </p>
            ) : (
              expiredDirectGrants.map((grant) => (
                <DirectGrantRow
                  currentEmployeeId={access.employeeId}
                  employees={employees}
                  expired
                  grant={grant}
                  key={grant.id}
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        <section className="settingsPanel" aria-labelledby="roles-list-title">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles")}</p>
              <h2 className="sectionTitle" id="roles-list-title">
                {t("admin.roles.roleDefinitions")}
              </h2>
              <p className="metaText">
                {t("admin.roles.roleDefinitions.description")}
              </p>
            </div>
            <span className="badge">{roles.length}</span>
          </div>

          <div className="managementList">
            {roles.length === 0 ? (
              <p className="metaText">{t("admin.roles.empty")}</p>
            ) : (
              roles.map((role) => (
                <RoleDefinitionRow
                  bindingCount={roleBindingsByRoleId.get(role.id) ?? 0}
                  key={role.id}
                  role={role}
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="permission-catalog-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.permissions")}</p>
              <h2 className="sectionTitle" id="permission-catalog-title">
                {t("admin.roles.permissionCatalog")}
              </h2>
              <p className="metaText">
                {t("admin.roles.permissionCatalog.description")}
              </p>
            </div>
            <span className="badge">{permissionCatalog.length}</span>
          </div>

          <div className="managementList">
            {summarizeCatalogDomains().map((summary) => (
              <article
                className="managementRow roleCatalogRow"
                key={summary.domain}
              >
                <div>
                  <h3 className="listItemTitle">
                    {t(permissionDomainKey(summary.domain))}
                  </h3>
                  <p className="metaText">
                    {t("admin.roles.permissionCount", {
                      count: summary.permissions.length
                    })}
                  </p>
                </div>
                <div className="permissionCodeList">
                  {summary.permissions.map((permission) => (
                    <code className="permissionCode" key={permission}>
                      {permission}
                    </code>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </TenantAdminShell>
  );
}

function RoleDefinitionRow({
  bindingCount,
  role,
  t
}: {
  bindingCount: number;
  role: TenantRoleRecord;
  t: Translator;
}): ReactNode {
  const summaries = summarizeRoleDomains(role.permissions);
  const statusAction =
    role.status === "archived"
      ? restoreCustomTenantRoleAction
      : archiveCustomTenantRoleAction;
  const statusActionIcon =
    role.status === "archived" ? (
      <ArchiveRestore size={14} aria-hidden="true" />
    ) : (
      <Archive size={14} aria-hidden="true" />
    );
  const statusActionLabel =
    role.status === "archived" ? "admin.roles.restore" : "admin.roles.archive";

  return (
    <article className="managementRow roleDefinitionRow">
      <span className="metricIcon">
        {role.isSystem ? (
          <ShieldCheck size={18} aria-hidden="true" />
        ) : (
          <KeyRound size={18} aria-hidden="true" />
        )}
      </span>
      <div>
        <h3 className="listItemTitle">{roleName(role, t)}</h3>
        {role.description ? (
          <p className="metaText">{role.description}</p>
        ) : null}
        <p className="metaText">
          {t("admin.roles.permissionCount", {
            count: role.permissions.length
          })}
        </p>
        <p className="metaText">
          {t("admin.roles.assignmentCount", {
            count: bindingCount
          })}
        </p>
      </div>
      <div className="badgeRow roleDefinitionMeta">
        <span className="badge">
          {t(
            role.isSystem
              ? "admin.roles.kind.system"
              : "admin.roles.kind.custom"
          )}
        </span>
        <span className="badge">{t(roleStatusKey(role.status))}</span>
      </div>
      <div className="rowActions">
        {role.isSystem ? (
          <span className="badge">{t("admin.roles.readOnly")}</span>
        ) : (
          <form className="inlineForm" action={statusAction}>
            <input name="roleId" type="hidden" value={role.id} />
            <button
              className={
                role.status === "archived" ? "secondaryButton" : "dangerButton"
              }
              type="submit"
            >
              {statusActionIcon}
              {t(statusActionLabel)}
            </button>
          </form>
        )}
      </div>
      <div className="badgeRow rolePermissionDomains">
        {summaries.map((summary) => (
          <span className="badge" key={summary.domain}>
            {t("admin.roles.domainCount", {
              domain: t(permissionDomainKey(summary.domain)),
              count: summary.permissions.length
            })}
          </span>
        ))}
      </div>
      {role.isSystem ? (
        <p className="metaText roleDefinitionReadonly">
          {t("admin.roles.systemRoleReadOnly")}
        </p>
      ) : (
        <form
          className="settingsForm roleDefinitionEditor"
          action={updateCustomTenantRoleAction}
        >
          <input name="roleId" type="hidden" value={role.id} />
          <div className="roleEditorGrid">
            <label className="fieldStack">
              <span className="detailLabel">{t("admin.roles.roleName")}</span>
              <input
                className="textInput"
                name="name"
                type="text"
                maxLength={80}
                defaultValue={role.name}
                required
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">
                {t("admin.roles.roleDescription")}
              </span>
              <textarea
                className="textInput roleDescriptionInput"
                name="description"
                maxLength={500}
                defaultValue={role.description ?? ""}
              />
            </label>
          </div>

          <PermissionCheckboxGroups
            selectedPermissions={role.permissions}
            t={t}
          />

          <button className="primaryButton" type="submit">
            <Save size={18} aria-hidden="true" />
            {t("admin.roles.saveChanges")}
          </button>
        </form>
      )}
    </article>
  );
}

function RoleTemplateRow({
  locale,
  t,
  template
}: {
  locale: string;
  t: Translator;
  template: RoleTemplateDefinition;
}): ReactNode {
  return (
    <article className="managementRow roleTemplateRow">
      <span className="metricIcon">
        <ShieldCheck size={18} aria-hidden="true" />
      </span>
      <div>
        <h3 className="listItemTitle">{t(template.nameKey)}</h3>
        <p className="metaText">{t(template.descriptionKey)}</p>
        <p className="metaText">
          {t("admin.roles.templateRecommendedScope", {
            value: t(permissionScopeTypeKey(template.recommendedScopeType))
          })}
        </p>
        <p className="metaText">
          {t("admin.roles.permissionCount", {
            count: template.permissions.length
          })}
        </p>
      </div>
      <form className="inlineForm" action={createRoleFromTemplateAction}>
        <input name="templateId" type="hidden" value={template.id} />
        <input name="locale" type="hidden" value={locale} />
        <button className="primaryButton" type="submit">
          <Plus size={14} aria-hidden="true" />
          {t("admin.roles.createFromTemplate.action")}
        </button>
      </form>
    </article>
  );
}

function PermissionCheckboxGroups({
  selectedPermissions,
  t
}: {
  selectedPermissions: readonly Permission[];
  t: Translator;
}): ReactNode {
  const selected = new Set(selectedPermissions);

  return (
    <div className="permissionEditorGrid">
      {summarizeCatalogDomains().map((summary) => (
        <fieldset className="permissionDomainGroup" key={summary.domain}>
          <legend className="listItemTitle">
            {t(permissionDomainKey(summary.domain))}
          </legend>
          <p className="metaText">
            {t("admin.roles.permissionCount", {
              count: summary.permissions.length
            })}
          </p>
          <div className="permissionCheckboxList">
            {summary.permissions.map((permission) => (
              <label className="permissionCheckboxRow" key={permission}>
                <input
                  defaultChecked={selected.has(permission)}
                  name="permissions"
                  type="checkbox"
                  value={permission}
                />
                <span>
                  <code className="permissionCode">{permission}</code>
                  <span className="metaText">
                    {t("admin.roles.allowedScopes", {
                      value: allowedScopesText(permission, t)
                    })}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function RoleBindingRow({
  binding,
  currentEmployeeId,
  employees,
  expired = false,
  roles,
  t,
  teams,
  orgUnits,
  workQueues
}: {
  binding: PermissionRoleBinding;
  currentEmployeeId: string;
  employees: readonly TenantEmployeeRecord[];
  expired?: boolean;
  roles: readonly TenantRoleRecord[];
  t: Translator;
  teams: readonly TeamRecord[];
  orgUnits: readonly OrgUnitRecord[];
  workQueues: readonly WorkQueueRecord[];
}): ReactNode {
  const role = roles.find((candidate) => candidate.id === binding.roleId);
  const employee =
    binding.subject.type === "employee"
      ? employees.find(
          (candidate) => candidate.employeeId === binding.subject.id
        )
      : undefined;
  const isCurrentEmployee =
    binding.subject.type === "employee" &&
    binding.subject.id === currentEmployeeId;

  return (
    <article className="managementRow roleBindingRow">
      <span className="metricIcon">
        <KeyRound size={18} aria-hidden="true" />
      </span>
      <div>
        <h3 className="listItemTitle">
          {role ? roleName(role, t) : binding.roleId}
        </h3>
        <p className="metaText">
          {t("admin.roles.assignmentSubject", {
            subject: t(subjectTypeKey(binding.subject)),
            value: subjectValue(binding.subject, {
              employee,
              orgUnits,
              teams,
              workQueues
            })
          })}
        </p>
        <p className="metaText">
          {t("admin.roles.assignmentScope", {
            value: scopeValue(binding.scope, t)
          })}
        </p>
      </div>
      <div className="rowActions">
        {expired ? (
          <span className="badge">{t("admin.roles.expired")}</span>
        ) : isCurrentEmployee ? (
          <span className="badge">{t("admin.roles.currentUser")}</span>
        ) : (
          <form className="inlineForm" action={revokeTenantRoleBindingAction}>
            <input name="bindingId" type="hidden" value={binding.id} />
            <button className="dangerButton" type="submit">
              <XCircle size={14} aria-hidden="true" />
              {t("admin.roles.revoke")}
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

function DirectGrantRow({
  currentEmployeeId,
  employees,
  expired = false,
  grant,
  t
}: {
  currentEmployeeId: string;
  employees: readonly TenantEmployeeRecord[];
  expired?: boolean;
  grant: DirectPermissionGrant;
  t: Translator;
}): ReactNode {
  const employee = employees.find(
    (candidate) => candidate.employeeId === grant.employeeId
  );
  const isCurrentEmployee = grant.employeeId === currentEmployeeId;

  return (
    <article className="managementRow directGrantRow">
      <span className="metricIcon">
        <KeyRound size={18} aria-hidden="true" />
      </span>
      <div>
        <h3 className="listItemTitle">
          <code className="permissionCode">{grant.permission}</code>
        </h3>
        <p className="metaText">
          {t("admin.roles.directGrantEmployee", {
            value: employeeValue(grant.employeeId, employee)
          })}
        </p>
        <p className="metaText">
          {t("admin.roles.assignmentScope", {
            value: scopeValue(grant.scope, t)
          })}
        </p>
        <p className="metaText">
          {t("admin.roles.directGrantReason", {
            value: grant.reason
          })}
        </p>
        <p className="metaText">
          {t("admin.roles.directGrantExpiresAt", {
            value: grant.expiresAt ?? t("admin.roles.directGrantNoExpiry")
          })}
        </p>
      </div>
      <div className="rowActions">
        {expired ? (
          <span className="badge">{t("admin.roles.expired")}</span>
        ) : isCurrentEmployee || grant.id === undefined ? (
          <span className="badge">{t("admin.roles.currentUser")}</span>
        ) : (
          <form
            className="inlineForm"
            action={revokeDirectPermissionGrantAction}
          >
            <input name="grantId" type="hidden" value={grant.id} />
            <button className="dangerButton" type="submit">
              <XCircle size={14} aria-hidden="true" />
              {t("admin.roles.revoke")}
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

function EffectiveGrantRow({
  employees,
  grant,
  orgUnits,
  roleBindings,
  roles,
  t,
  teams,
  workQueues
}: {
  employees: readonly TenantEmployeeRecord[];
  grant: EffectivePermissionGrant;
  orgUnits: readonly OrgUnitRecord[];
  roleBindings: readonly PermissionRoleBinding[];
  roles: readonly TenantRoleRecord[];
  t: Translator;
  teams: readonly TeamRecord[];
  workQueues: readonly WorkQueueRecord[];
}): ReactNode {
  const definition = getPermissionDefinition(grant.permission);

  return (
    <article className="managementRow effectiveAccessRow">
      <span className="metricIcon">
        <ListChecks size={18} aria-hidden="true" />
      </span>
      <div>
        <h3 className="listItemTitle">
          <code className="permissionCode">{grant.permission}</code>
        </h3>
        <p className="metaText">
          {t("admin.roles.effectiveGrantDomain", {
            value: t(permissionDomainKey(definition.domain))
          })}
        </p>
        <p className="metaText">
          {t("admin.roles.assignmentScope", {
            value: scopeValue(grant.scope, t)
          })}
        </p>
      </div>
      <div className="sourceList">
        {grant.sources.map((source, index) => (
          <span className="badge" key={effectiveGrantSourceKey(source, index)}>
            {sourceLabel(source, {
              employees,
              orgUnits,
              roleBindings,
              roles,
              t,
              teams,
              workQueues
            })}
          </span>
        ))}
      </div>
    </article>
  );
}

function buildEffectiveAccessPreview(input: {
  readonly at: Date;
  readonly directGrants: readonly DirectPermissionGrant[];
  readonly employee: TenantEmployeeRecord;
  readonly roleBindings: readonly PermissionRoleBinding[];
  readonly roles: readonly TenantRoleRecord[];
  readonly tenantId: PermissionActor["tenantId"];
}): readonly EffectivePermissionGrant[] {
  const actor: PermissionActor = {
    tenantId: input.tenantId,
    employeeId: input.employee.employeeId,
    teamIds: input.employee.teamIds,
    orgUnitIds: input.employee.orgUnitIds,
    queueIds: input.employee.queueIds
  };

  return [
    ...resolveEffectivePermissionGrants({
      actor,
      roles: input.roles,
      roleBindings: input.roleBindings,
      directGrants: input.directGrants,
      at: input.at
    })
  ].sort(compareEffectiveGrants);
}

function compareEffectiveGrants(
  left: EffectivePermissionGrant,
  right: EffectivePermissionGrant
): number {
  const leftDefinition = getPermissionDefinition(left.permission);
  const rightDefinition = getPermissionDefinition(right.permission);
  const domainComparison =
    domainOrder.indexOf(leftDefinition.domain) -
    domainOrder.indexOf(rightDefinition.domain);

  if (domainComparison !== 0) {
    return domainComparison;
  }

  const permissionComparison = left.permission.localeCompare(right.permission);

  if (permissionComparison !== 0) {
    return permissionComparison;
  }

  return permissionScopeKey(left.scope).localeCompare(
    permissionScopeKey(right.scope)
  );
}

function effectiveGrantKey(grant: EffectivePermissionGrant): string {
  return [grant.permission, permissionScopeKey(grant.scope)].join(":");
}

function effectiveGrantSourceKey(
  source: PermissionGrantSource,
  index: number
): string {
  switch (source.type) {
    case "role_binding":
      return `${index}:role_binding:${source.bindingId ?? source.roleId}`;
    case "direct_grant":
      return `${index}:direct_grant:${source.grantId ?? source.reason}`;
  }
}

function sourceLabel(
  source: PermissionGrantSource,
  references: {
    readonly employees: readonly TenantEmployeeRecord[];
    readonly orgUnits: readonly OrgUnitRecord[];
    readonly roleBindings: readonly PermissionRoleBinding[];
    readonly roles: readonly TenantRoleRecord[];
    readonly t: Translator;
    readonly teams: readonly TeamRecord[];
    readonly workQueues: readonly WorkQueueRecord[];
  }
): string {
  switch (source.type) {
    case "role_binding": {
      const role = references.roles.find(
        (candidate) => candidate.id === source.roleId
      );
      const roleLabel =
        role === undefined ? source.roleId : roleName(role, references.t);
      const binding =
        source.bindingId === undefined
          ? undefined
          : references.roleBindings.find(
              (candidate) => candidate.id === source.bindingId
            );

      if (binding === undefined) {
        return references.t("admin.roles.source.roleBinding", {
          value: roleLabel
        });
      }
      const employee =
        binding.subject.type === "employee"
          ? references.employees.find(
              (candidate) => candidate.employeeId === binding.subject.id
            )
          : undefined;

      return references.t("admin.roles.source.roleBindingWithSubject", {
        role: roleLabel,
        subject: references.t(subjectTypeKey(binding.subject)),
        value: subjectValue(binding.subject, {
          employee,
          orgUnits: references.orgUnits,
          teams: references.teams,
          workQueues: references.workQueues
        })
      });
    }
    case "direct_grant":
      return references.t("admin.roles.source.directGrant", {
        value: source.reason
      });
  }
}

function roleName(role: TenantRoleRecord, t: Translator): string {
  const roleLabelKey = role.isSystem ? fixedRoleLabelKey(role.id) : undefined;

  return roleLabelKey ? t(roleLabelKey) : role.name;
}

function countBindingsByRoleId(
  bindings: readonly PermissionRoleBinding[]
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const binding of bindings) {
    counts.set(binding.roleId, (counts.get(binding.roleId) ?? 0) + 1);
  }

  return counts;
}

function subjectValue(
  subject: PermissionRoleBindingSubject,
  references: {
    readonly employee?: TenantEmployeeRecord;
    readonly orgUnits: readonly OrgUnitRecord[];
    readonly teams: readonly TeamRecord[];
    readonly workQueues: readonly WorkQueueRecord[];
  }
): string {
  switch (subject.type) {
    case "employee":
      return references.employee
        ? `${references.employee.displayName} (${references.employee.email})`
        : subject.id;
    case "org_unit":
      return (
        references.orgUnits.find((orgUnit) => orgUnit.id === subject.id)
          ?.name ?? subject.id
      );
    case "queue":
      return (
        references.workQueues.find((workQueue) => workQueue.id === subject.id)
          ?.name ?? subject.id
      );
    case "team":
      return (
        references.teams.find((team) => team.id === subject.id)?.name ??
        subject.id
      );
  }
}

function employeeValue(
  employeeId: string,
  employee: TenantEmployeeRecord | undefined
): string {
  return employee ? `${employee.displayName} (${employee.email})` : employeeId;
}

function scopeValue(scope: PermissionScope, t: Translator): string {
  if (scope.type === "tenant") {
    return t("admin.roles.scope.tenant");
  }

  return "id" in scope
    ? `${t(permissionScopeTypeKey(scope.type))}:${scope.id}`
    : t(permissionScopeTypeKey(scope.type));
}

function permissionScopeKey(scope: PermissionScope): string {
  return "id" in scope ? `${scope.type}:${scope.id}` : scope.type;
}

function allowedScopesText(permission: Permission, t: Translator): string {
  return getPermissionDefinition(permission)
    .allowedScopes.map((scopeType) => t(permissionScopeTypeKey(scopeType)))
    .join(", ");
}

function scopePickerMessages(t: Translator): ScopePickerMessages {
  return {
    employee: t("admin.roles.employee"),
    expiresAt: t("admin.roles.directGrantExpiresAtInput"),
    permission: t("admin.roles.permission"),
    reason: t("admin.roles.directGrantReasonInput"),
    reasonPlaceholder: t("admin.roles.directGrantReason.placeholder"),
    role: t("admin.roles.role"),
    subjectReference: t("admin.roles.subjectReference"),
    subjectType: t("admin.roles.subjectType"),
    scopeType: t("admin.roles.scopeType"),
    scopeReference: t("admin.roles.scopeReference"),
    scopeReferenceDescription: t("admin.roles.scopeReference.description"),
    scopeReferenceManualDescription: t(
      "admin.roles.scopeReference.manualDescription"
    ),
    scopeReferenceNotRequired: t("admin.roles.scopeReference.notRequired"),
    scopeReferencePlaceholder: t("admin.roles.scopeReference.placeholder"),
    scopeUnavailable: t("admin.roles.scopeUnavailable"),
    selectEmployee: t("admin.roles.selectEmployee"),
    selectPermission: t("admin.roles.selectPermission"),
    selectRole: t("admin.roles.selectRole"),
    selectSubject: t("admin.roles.selectSubject"),
    subjectLabels: {
      employee: t("admin.roles.subject.employee"),
      org_unit: t("admin.roles.subject.orgUnit"),
      team: t("admin.roles.subject.team"),
      queue: t("admin.roles.subject.queue")
    },
    scopeLabels: {
      tenant: t("admin.roles.scope.tenant"),
      org_unit: t("admin.roles.scope.orgUnit"),
      team: t("admin.roles.scope.team"),
      queue: t("admin.roles.scope.queue"),
      assigned: t("admin.roles.scope.assigned"),
      own: t("admin.roles.scope.own"),
      client: t("admin.roles.scope.client"),
      conversation: t("admin.roles.scope.conversation")
    }
  };
}

function summarizeRoleDomains(
  permissions: readonly Permission[]
): readonly DomainSummary[] {
  const permissionsByDomain = new Map<PermissionDomain, Permission[]>();

  for (const permission of permissions) {
    const definition = getPermissionDefinition(permission);
    const domainPermissions = permissionsByDomain.get(definition.domain) ?? [];

    permissionsByDomain.set(definition.domain, [
      ...domainPermissions,
      permission
    ]);
  }

  return domainOrder.flatMap((domain) => {
    const domainPermissions = permissionsByDomain.get(domain);

    return domainPermissions
      ? [
          {
            domain,
            permissions: domainPermissions
          }
        ]
      : [];
  });
}

function summarizeCatalogDomains(): readonly DomainSummary[] {
  return summarizeRoleDomains(permissionCatalog.map(({ id }) => id));
}

function fixedRoleLabelKey(roleId: string): I18nMessageKey | undefined {
  const segments = roleId.split(":");
  const role = segments[segments.length - 1];

  switch (role) {
    case "tenant_admin":
      return "admin.employees.role.tenantAdmin";
    case "supervisor":
      return "admin.employees.role.supervisor";
    case "agent":
      return "admin.employees.role.agent";
    default:
      return undefined;
  }
}

function roleStatusKey(status: TenantRoleRecord["status"]): I18nMessageKey {
  switch (status) {
    case "archived":
      return "admin.roles.status.archived";
    default:
      return "admin.roles.status.active";
  }
}

function roleActionStatusKey(status: string): I18nMessageKey {
  switch (status) {
    case "created":
      return "admin.roles.actionStatus.created";
    case "template_created":
      return "admin.roles.actionStatus.templateCreated";
    case "updated":
      return "admin.roles.actionStatus.updated";
    case "archived":
      return "admin.roles.actionStatus.archived";
    case "restored":
      return "admin.roles.actionStatus.restored";
    case "assigned":
      return "admin.roles.actionStatus.assigned";
    case "revoked":
      return "admin.roles.actionStatus.revoked";
    case "direct_grant_created":
      return "admin.roles.actionStatus.directGrantCreated";
    case "direct_grant_revoked":
      return "admin.roles.actionStatus.directGrantRevoked";
    case "permission_denied":
      return "admin.roles.actionStatus.permissionDenied";
    case "reauth_required":
      return "admin.roles.actionStatus.reauthRequired";
    case "email_verification_required":
      return "auth.emailVerification.status.required";
    default:
      return "admin.roles.actionStatus.invalid";
  }
}

function permissionScopeTypeKey(
  scopeType: PermissionScopeType
): I18nMessageKey {
  switch (scopeType) {
    case "tenant":
      return "admin.roles.scope.tenant";
    case "org_unit":
      return "admin.roles.scope.orgUnit";
    case "team":
      return "admin.roles.scope.team";
    case "queue":
      return "admin.roles.scope.queue";
    case "assigned":
      return "admin.roles.scope.assigned";
    case "own":
      return "admin.roles.scope.own";
    case "client":
      return "admin.roles.scope.client";
    case "conversation":
      return "admin.roles.scope.conversation";
  }
}

function subjectTypeKey(subject: PermissionRoleBindingSubject): I18nMessageKey {
  switch (subject.type) {
    case "team":
      return "admin.roles.subject.team";
    case "org_unit":
      return "admin.roles.subject.orgUnit";
    case "queue":
      return "admin.roles.subject.queue";
    default:
      return "admin.roles.subject.employee";
  }
}

function permissionDomainKey(domain: PermissionDomain): I18nMessageKey {
  switch (domain) {
    case "tenant":
      return "permission.domain.tenant";
    case "employees":
      return "permission.domain.employees";
    case "roles":
      return "permission.domain.roles";
    case "integrations":
      return "permission.domain.integrations";
    case "branding":
      return "permission.domain.branding";
    case "inbox":
      return "permission.domain.inbox";
    case "messages":
      return "permission.domain.messages";
    case "conversations":
      return "permission.domain.conversations";
    case "clients":
      return "permission.domain.clients";
    case "leads":
      return "permission.domain.leads";
    case "files":
      return "permission.domain.files";
    case "reports":
      return "permission.domain.reports";
    case "audit":
      return "permission.domain.audit";
    case "api":
      return "permission.domain.api";
  }
}
