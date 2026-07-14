import {
  canAccess,
  permissionCatalog,
  type DirectPermissionGrant,
  type PermissionRoleBinding,
  type PermissionRoleBindingSubject
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
  Plus,
  Save,
  ShieldCheck,
  XCircle
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
  RoleActionForm,
  RoleActionSubmitButton,
  type RoleActionMessages
} from "../../../src/role-action-form";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import {
  roleTemplateCatalog,
  type RoleTemplateDefinition
} from "../../../src/role-templates";
import { resolveEmployeeEffectiveAccess } from "../../../src/rbac-effective-access";
import {
  permissionDomainKey,
  permissionScopeTypeKey,
  summarizePermissionDomains
} from "../../../src/rbac-permission-display";
import {
  PermissionCatalogTable,
  PermissionCheckboxTable
} from "../../../src/rbac-permission-tables";
import { roleName, scopeValue } from "../../../src/rbac-role-display";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

const roleAdminSectionIds = ["roles", "permissions"] as const;

type RoleAdminSectionId = (typeof roleAdminSectionIds)[number];

export default async function RolesAdminPage({
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

  if (
    accessSnapshot === undefined ||
    !canAccess({
      actor: accessSnapshot.actor,
      effectiveGrants: accessSnapshot.effectiveGrants,
      permission: "roles.manage",
      resource: { tenantId: access.tenantId }
    }).allowed
  ) {
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
    loadTenantAdminViewModel({ tenantId: access.tenantId }),
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
  const actionMessages = roleActionMessages(t);
  const selectedSection = resolveRoleAdminSection(
    resolvedSearchParams?.section
  );
  const roleBindingsByRoleId = countBindingsByRoleId(roleBindings);
  const roleAdminSections: readonly AdminSectionFrameItem<RoleAdminSectionId>[] =
    [
      {
        id: "roles",
        title: t("admin.roles.roleDefinitions"),
        href: roleAdminSectionHref("roles"),
        icon: <KeyRound size={18} aria-hidden="true" />
      },
      {
        id: "permissions",
        title: t("admin.roles.permissions"),
        href: roleAdminSectionHref("permissions"),
        icon: <ShieldCheck size={18} aria-hidden="true" />
      }
    ];

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="roles"
      effectiveAccess={accessSnapshot}
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.roles")}
      titleId="roles-title"
    >
      <AdminSectionFrame
        ariaLabel={t("admin.roles")}
        navTitle={t("admin.roles")}
        sections={roleAdminSections}
        selectedSection={selectedSection}
      >
        <section
          className="settingsPanel"
          aria-labelledby="roles-list-title"
          hidden={selectedSection !== "roles"}
        >
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

          <div className="roleAdminActionBar">
            <a className="secondaryButton" href="#role-create-title">
              <Plus size={16} aria-hidden="true" />
              {t("admin.roles.createRole")}
            </a>
            <a className="secondaryButton" href="#role-templates-title">
              <ShieldCheck size={16} aria-hidden="true" />
              {t("admin.roles.createFromTemplate")}
            </a>
          </div>

          <div className="managementList">
            {roles.length === 0 ? (
              <p className="metaText">{t("admin.roles.empty")}</p>
            ) : (
              roles.map((role) => (
                <RoleDefinitionRow
                  actionMessages={actionMessages}
                  bindingCount={roleBindingsByRoleId.get(role.id) ?? 0}
                  key={role.id}
                  roleAdminSection="roles"
                  role={role}
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="role-create-title"
          hidden={selectedSection !== "roles"}
          id="role-create-panel"
        >
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

          <RoleActionForm
            actionKind="createRole"
            className="settingsForm"
            messages={actionMessages}
            reauthLabel={t("auth.login.link")}
            resetOnSuccess
          >
            <input name="roleAdminSection" type="hidden" value="roles" />
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

            <PermissionCheckboxTable
              idPrefix="role-create-permission"
              selectedPermissions={[]}
              t={t}
            />

            <RoleActionSubmitButton
              className="primaryButton"
              label={t("admin.roles.create")}
            >
              <Plus size={18} aria-hidden="true" />
            </RoleActionSubmitButton>
          </RoleActionForm>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="role-templates-title"
          hidden={selectedSection !== "roles"}
          id="role-templates-panel"
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
                actionMessages={actionMessages}
                key={template.id}
                locale={locale}
                roleAdminSection="roles"
                t={t}
                template={template}
              />
            ))}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="role-bindings-title"
          hidden={selectedSection !== "roles"}
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

          <nav
            className="roleAdminTabStrip"
            aria-label={t("admin.roles.assignments")}
          >
            <a className="secondaryButton" href="#role-bindings-title">
              {t("admin.roles.activeAssignments")}
              <span className="badge">{roleBindings.length}</span>
            </a>
            <a className="secondaryButton" href="#expired-role-bindings-title">
              {t("admin.roles.expiredAssignments")}
              <span className="badge">{expiredRoleBindings.length}</span>
            </a>
          </nav>

          <div className="managementList">
            {roleBindings.length === 0 ? (
              <p className="metaText">{t("admin.roles.noAssignments")}</p>
            ) : (
              roleBindings.map((binding) => (
                <RoleBindingRow
                  actionMessages={actionMessages}
                  binding={binding}
                  currentEmployeeId={access.employeeId}
                  employees={employees}
                  key={binding.id}
                  orgUnits={orgUnits}
                  roleAdminSection="roles"
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
          hidden={selectedSection !== "roles"}
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
                  actionMessages={actionMessages}
                  binding={binding}
                  currentEmployeeId={access.employeeId}
                  employees={employees}
                  expired
                  key={binding.id}
                  orgUnits={orgUnits}
                  roleAdminSection="roles"
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
          aria-labelledby="permission-catalog-title"
          hidden={selectedSection !== "permissions"}
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

          <PermissionCatalogTable t={t} />

          <nav
            className="roleAdminTabStrip"
            aria-label={t("admin.roles.directGrants")}
          >
            <a className="secondaryButton" href="#direct-grants-title">
              {t("admin.roles.activeDirectGrants")}
              <span className="badge">{directGrants.length}</span>
            </a>
            <a className="secondaryButton" href="#expired-direct-grants-title">
              {t("admin.roles.expiredDirectGrants")}
              <span className="badge">{expiredDirectGrants.length}</span>
            </a>
          </nav>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="direct-grants-title"
          hidden={selectedSection !== "permissions"}
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
                  actionMessages={actionMessages}
                  currentEmployeeId={access.employeeId}
                  employees={employees}
                  grant={grant}
                  key={grant.id}
                  roleAdminSection="permissions"
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="expired-direct-grants-title"
          hidden={selectedSection !== "permissions"}
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
                  actionMessages={actionMessages}
                  currentEmployeeId={access.employeeId}
                  employees={employees}
                  expired
                  grant={grant}
                  key={grant.id}
                  roleAdminSection="permissions"
                  t={t}
                />
              ))
            )}
          </div>
        </section>
      </AdminSectionFrame>
    </TenantAdminShell>
  );
}

function roleAdminSectionHref(section: RoleAdminSectionId): string {
  return `/admin/roles?section=${encodeURIComponent(section)}`;
}

function resolveRoleAdminSection(
  value: string | undefined
): RoleAdminSectionId {
  if (isRoleAdminSectionId(value)) {
    return value;
  }

  switch (value) {
    case "permissionCatalog":
    case "directGrantCreate":
    case "activeDirectGrants":
    case "expiredDirectGrants":
    case "preview":
      return "permissions";
    default:
      return "roles";
  }
}

function isRoleAdminSectionId(
  value: string | undefined
): value is RoleAdminSectionId {
  return roleAdminSectionIds.some((section) => section === value);
}

function RoleDefinitionRow({
  actionMessages,
  bindingCount,
  roleAdminSection,
  role,
  t
}: {
  actionMessages: RoleActionMessages;
  bindingCount: number;
  roleAdminSection: RoleAdminSectionId;
  role: TenantRoleRecord;
  t: Translator;
}): ReactNode {
  const summaries = summarizePermissionDomains(role.permissions);
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
          <RoleActionForm
            actionKind={
              role.status === "archived" ? "restoreRole" : "archiveRole"
            }
            className="inlineForm"
            messages={actionMessages}
            reauthLabel={t("auth.login.link")}
          >
            <input name="roleId" type="hidden" value={role.id} />
            <input
              name="roleAdminSection"
              type="hidden"
              value={roleAdminSection}
            />
            <RoleActionSubmitButton
              className={
                role.status === "archived" ? "secondaryButton" : "dangerButton"
              }
              label={t(statusActionLabel)}
            >
              {statusActionIcon}
            </RoleActionSubmitButton>
          </RoleActionForm>
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
        <RoleActionForm
          actionKind="updateRole"
          className="settingsForm roleDefinitionEditor"
          messages={actionMessages}
          reauthLabel={t("auth.login.link")}
        >
          <input name="roleId" type="hidden" value={role.id} />
          <input
            name="roleAdminSection"
            type="hidden"
            value={roleAdminSection}
          />
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

          <PermissionCheckboxTable
            idPrefix={`role-edit-${role.id}`}
            selectedPermissions={role.permissions}
            t={t}
          />

          <RoleActionSubmitButton
            className="primaryButton"
            label={t("admin.roles.saveChanges")}
          >
            <Save size={18} aria-hidden="true" />
          </RoleActionSubmitButton>
        </RoleActionForm>
      )}
    </article>
  );
}

function RoleTemplateRow({
  actionMessages,
  locale,
  roleAdminSection,
  t,
  template
}: {
  actionMessages: RoleActionMessages;
  locale: string;
  roleAdminSection: RoleAdminSectionId;
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
      <RoleActionForm
        actionKind="createRoleFromTemplate"
        className="inlineForm"
        messages={actionMessages}
        reauthLabel={t("auth.login.link")}
      >
        <input name="templateId" type="hidden" value={template.id} />
        <input name="locale" type="hidden" value={locale} />
        <input name="roleAdminSection" type="hidden" value={roleAdminSection} />
        <RoleActionSubmitButton
          className="primaryButton"
          label={t("admin.roles.createFromTemplate.action")}
        >
          <Plus size={14} aria-hidden="true" />
        </RoleActionSubmitButton>
      </RoleActionForm>
    </article>
  );
}

function RoleBindingRow({
  actionMessages,
  binding,
  currentEmployeeId,
  employees,
  expired = false,
  roleAdminSection,
  roles,
  t,
  teams,
  orgUnits,
  workQueues
}: {
  actionMessages: RoleActionMessages;
  binding: PermissionRoleBinding;
  currentEmployeeId: string;
  employees: readonly TenantEmployeeRecord[];
  expired?: boolean;
  roleAdminSection: RoleAdminSectionId;
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
          <RoleActionForm
            actionKind="revokeRoleBinding"
            className="inlineForm"
            messages={actionMessages}
            reauthLabel={t("auth.login.link")}
          >
            <input name="bindingId" type="hidden" value={binding.id} />
            <input
              name="roleAdminSection"
              type="hidden"
              value={roleAdminSection}
            />
            <RoleActionSubmitButton
              className="dangerButton"
              label={t("admin.roles.revoke")}
            >
              <XCircle size={14} aria-hidden="true" />
            </RoleActionSubmitButton>
          </RoleActionForm>
        )}
      </div>
    </article>
  );
}

function DirectGrantRow({
  actionMessages,
  currentEmployeeId,
  employees,
  expired = false,
  grant,
  roleAdminSection,
  t
}: {
  actionMessages: RoleActionMessages;
  currentEmployeeId: string;
  employees: readonly TenantEmployeeRecord[];
  expired?: boolean;
  grant: DirectPermissionGrant;
  roleAdminSection: RoleAdminSectionId;
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
          <RoleActionForm
            actionKind="revokeDirectGrant"
            className="inlineForm"
            messages={actionMessages}
            reauthLabel={t("auth.login.link")}
          >
            <input name="grantId" type="hidden" value={grant.id} />
            <input
              name="roleAdminSection"
              type="hidden"
              value={roleAdminSection}
            />
            <RoleActionSubmitButton
              className="dangerButton"
              label={t("admin.roles.revoke")}
            >
              <XCircle size={14} aria-hidden="true" />
            </RoleActionSubmitButton>
          </RoleActionForm>
        )}
      </div>
    </article>
  );
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
        ? `${references.employee.displayName} (${references.employee.employeeId})`
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
  return employee
    ? `${employee.displayName} (${employee.employeeId})`
    : employeeId;
}

function roleStatusKey(status: TenantRoleRecord["status"]): I18nMessageKey {
  switch (status) {
    case "archived":
      return "admin.roles.status.archived";
    default:
      return "admin.roles.status.active";
  }
}

function roleActionMessages(t: Translator): RoleActionMessages {
  return {
    assigned: t("admin.roles.actionStatus.assigned"),
    archived: t("admin.roles.actionStatus.archived"),
    created: t("admin.roles.actionStatus.created"),
    direct_grant_created: t("admin.roles.actionStatus.directGrantCreated"),
    direct_grant_revoked: t("admin.roles.actionStatus.directGrantRevoked"),
    email_verification_required: t("auth.emailVerification.status.required"),
    invalid: t("admin.roles.actionStatus.invalid"),
    permission_denied: t("admin.roles.actionStatus.permissionDenied"),
    reauth_required: t("admin.roles.actionStatus.reauthRequired"),
    restored: t("admin.roles.actionStatus.restored"),
    revoked: t("admin.roles.actionStatus.revoked"),
    template_created: t("admin.roles.actionStatus.templateCreated"),
    updated: t("admin.roles.actionStatus.updated")
  };
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
