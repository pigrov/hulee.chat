import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  getPermissionDefinition,
  permissionCatalog,
  resolveEffectivePermissionGrants,
  type DirectPermissionGrant,
  type EffectivePermissionGrant,
  type EmployeeRole,
  type PermissionActor,
  type PermissionDomain,
  type PermissionGrantSource,
  type PermissionRoleBinding,
  type PermissionScope,
  type PermissionScopeType
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlTenantRbacRepository,
  type TenantEmployeeRecord,
  type TenantRoleRecord
} from "@hulee/db";
import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import {
  ArrowLeft,
  Building2,
  Inbox,
  KeyRound,
  ListChecks,
  Plus,
  Save,
  XCircle
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../../../src/access-denied";
import {
  canTenantPermission,
  navigationAccessFromSession
} from "../../../../../src/access";
import { DetailItem } from "../../../../../src/app-chrome";
import {
  setEmployeeOrgUnitMembershipsAction,
  setEmployeeWorkQueueMembershipsAction
} from "../../../../../src/employee-membership-actions";
import { loadInboxViewModel } from "../../../../../src/inbox-api-client";
import { allowedRoleBindingScopeTypesForPermissions } from "../../../../../src/rbac-scope";
import { buildScopeReferenceOptions } from "../../../../../src/rbac-scope-options";
import {
  DirectGrantFields,
  RoleAssignmentFields,
  type ScopePickerMessages
} from "../../../../../src/rbac-scope-picker";
import {
  assignTenantRoleAction,
  createDirectPermissionGrantAction,
  revokeDirectPermissionGrantAction,
  revokeTenantRoleBindingAction
} from "../../../../../src/role-actions";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../../../src/session";
import { TenantAdminShell } from "../../../../../src/tenant-admin-shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

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

export default async function EmployeeAccessAdminPage({
  params,
  searchParams
}: {
  params: Promise<{
    employeeId: string;
  }>;
  searchParams?: Promise<{
    roleActionStatus?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  if (!canTenantPermission(access, "roles.manage")) {
    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromSession(access)}
      />
    );
  }

  const now = new Date();
  const { employeeId: employeeIdParam } = await params;
  const employeeId = decodeURIComponent(employeeIdParam) as EmployeeId;
  const rbacRepository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  const orgStructureRepository =
    createSqlOrgStructureRepository(getWebDatabase());
  const [
    model,
    employee,
    roles,
    roleBindings,
    directGrants,
    orgUnits,
    workQueues,
    resolvedSearch
  ] = await Promise.all([
    loadInboxViewModel(),
    employeeRepository.findEmployee({
      tenantId: access.tenantId,
      employeeId
    }),
    rbacRepository.listRoleDefinitions({ tenantId: access.tenantId }),
    rbacRepository.listRoleBindings({ tenantId: access.tenantId, at: now }),
    rbacRepository.listDirectGrants({ tenantId: access.tenantId, at: now }),
    orgStructureRepository.listOrgUnits({
      tenantId: access.tenantId,
      activeOnly: true
    }),
    orgStructureRepository.listWorkQueues({
      tenantId: access.tenantId,
      activeOnly: true
    }),
    searchParams
  ]);

  if (employee === null) {
    redirect("/admin/employees");
  }

  const { t } = createTranslator(model.tenant.locale);
  const returnPath = `/admin/employees/${encodeURIComponent(employee.employeeId)}/access`;
  const activeRoles = roles.filter((role) => role.status === "active");
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
  const employeeOptions = [
    {
      value: employee.employeeId,
      label: employee.displayName
    }
  ];
  const scopeReferenceOptions = buildScopeReferenceOptions({
    orgUnits,
    workQueues
  });
  const employeeRoleBindings = roleBindings
    .filter(
      (binding) =>
        binding.subject.type === "employee" &&
        binding.subject.id === employee.employeeId
    )
    .sort((left, right) =>
      roleNameById(left.roleId, roles, t).localeCompare(
        roleNameById(right.roleId, roles, t)
      )
    );
  const employeeDirectGrants = directGrants
    .filter((grant) => grant.employeeId === employee.employeeId)
    .sort((left, right) => left.permission.localeCompare(right.permission));
  const effectiveAccess = buildEffectiveAccessPreview({
    at: now,
    directGrants,
    employee,
    roleBindings,
    roles,
    tenantId: access.tenantId
  });
  const isDeactivated = employee.deactivatedAt !== null;

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="employees"
      sidebarContent={
        resolvedSearch?.roleActionStatus ? (
          <DetailItem
            label={t("admin.roles.actionStatus")}
            value={t(roleActionStatusKey(resolvedSearch.roleActionStatus))}
          />
        ) : null
      }
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.employeeAccess")}
      titleId="employee-access-title"
    >
      <div className="adminStack">
        <section
          className="settingsPanel"
          aria-labelledby="employee-access-summary-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.employeeAccess")}</p>
              <h2 className="sectionTitle" id="employee-access-summary-title">
                {employee.displayName}
              </h2>
              <p className="metaText">
                {t("admin.employeeAccess.description")}
              </p>
            </div>
            <Link className="secondaryButton" href="/admin/employees">
              <ArrowLeft size={14} aria-hidden="true" />
              {t("admin.employeeAccess.backToEmployees")}
            </Link>
          </div>

          <div className="detailGrid">
            <DetailItem
              label={t("admin.employees.displayName")}
              value={employee.displayName}
            />
            <DetailItem label={t("auth.email")} value={employee.email} />
            <DetailItem
              label={t("admin.employeeAccess.status")}
              value={t(
                isDeactivated
                  ? "admin.employees.status.deactivated"
                  : "admin.employees.status.active"
              )}
            />
            <DetailItem
              label={t("admin.employeeAccess.fixedRoles")}
              value={employee.roles
                .map((role) => roleLabelFromEmployeeRole(role, t))
                .join(", ")}
            />
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="employee-memberships-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.employeeAccess.memberships")}</p>
              <h2 className="sectionTitle" id="employee-memberships-title">
                {t("admin.employeeAccess.memberships")}
              </h2>
              <p className="metaText">
                {t("admin.employeeAccess.memberships.description")}
              </p>
            </div>
            <span className="badge">
              {employee.orgUnitIds.length + employee.queueIds.length}
            </span>
          </div>

          <div className="employeeMembershipGrid">
            <form
              action={setEmployeeOrgUnitMembershipsAction}
              className="settingsForm employeeMembershipForm"
            >
              <input name="returnTo" type="hidden" value={returnPath} />
              <input
                name="employeeId"
                type="hidden"
                value={employee.employeeId}
              />
              <MembershipCheckboxGroup
                emptyLabel={t("admin.employeeAccess.noOrgUnitsAvailable")}
                icon={<Building2 size={18} aria-hidden="true" />}
                items={orgUnits.map((orgUnit) => ({
                  id: orgUnit.id,
                  label: orgUnit.name
                }))}
                name="orgUnitId"
                selectedIds={employee.orgUnitIds}
                title={t("admin.employeeAccess.orgUnitMemberships")}
              />
              <button
                className="primaryButton"
                disabled={isDeactivated}
                type="submit"
              >
                <Save size={18} aria-hidden="true" />
                {t("admin.employeeAccess.saveMemberships")}
              </button>
            </form>

            <form
              action={setEmployeeWorkQueueMembershipsAction}
              className="settingsForm employeeMembershipForm"
            >
              <input name="returnTo" type="hidden" value={returnPath} />
              <input
                name="employeeId"
                type="hidden"
                value={employee.employeeId}
              />
              <MembershipCheckboxGroup
                emptyLabel={t("admin.employeeAccess.noWorkQueuesAvailable")}
                icon={<Inbox size={18} aria-hidden="true" />}
                items={workQueues.map((workQueue) => ({
                  id: workQueue.id,
                  label: workQueue.name
                }))}
                name="workQueueId"
                selectedIds={employee.queueIds}
                title={t("admin.employeeAccess.workQueueMemberships")}
              />
              <button
                className="primaryButton"
                disabled={isDeactivated}
                type="submit"
              >
                <Save size={18} aria-hidden="true" />
                {t("admin.employeeAccess.saveMemberships")}
              </button>
            </form>
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="employee-role-assign-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.assignments")}</p>
              <h2 className="sectionTitle" id="employee-role-assign-title">
                {t("admin.employeeAccess.assignRole")}
              </h2>
              <p className="metaText">
                {t("admin.employeeAccess.assignRole.description")}
              </p>
            </div>
            <span className="badge">{roleAssignmentOptions.length}</span>
          </div>

          <form
            action={assignTenantRoleAction}
            className="settingsForm employeeAccessAssignForm"
          >
            <input name="returnTo" type="hidden" value={returnPath} />
            <RoleAssignmentFields
              employees={employeeOptions}
              messages={scopePickerMessages(t)}
              roles={roleAssignmentOptions}
              scopeReferenceOptions={scopeReferenceOptions}
              selectedEmployeeId={employee.employeeId}
            />
            <button
              className="primaryButton"
              disabled={isDeactivated || roleAssignmentOptions.length === 0}
              type="submit"
            >
              <Plus size={18} aria-hidden="true" />
              {t("admin.roles.assign")}
            </button>
          </form>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="employee-direct-grant-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.directGrants")}</p>
              <h2 className="sectionTitle" id="employee-direct-grant-title">
                {t("admin.employeeAccess.directGrant")}
              </h2>
              <p className="metaText">
                {t("admin.employeeAccess.directGrant.description")}
              </p>
            </div>
            <span className="badge">{directGrantPermissionOptions.length}</span>
          </div>

          <form
            action={createDirectPermissionGrantAction}
            className="settingsForm employeeAccessGrantForm"
          >
            <input name="returnTo" type="hidden" value={returnPath} />
            <DirectGrantFields
              employees={employeeOptions}
              messages={scopePickerMessages(t)}
              permissions={directGrantPermissionOptions}
              scopeReferenceOptions={scopeReferenceOptions}
              selectedEmployeeId={employee.employeeId}
            />
            <button
              className="primaryButton"
              disabled={
                isDeactivated || directGrantPermissionOptions.length === 0
              }
              type="submit"
            >
              <Plus size={18} aria-hidden="true" />
              {t("admin.roles.grantDirectPermission")}
            </button>
          </form>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="employee-role-bindings-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.assignments")}</p>
              <h2 className="sectionTitle" id="employee-role-bindings-title">
                {t("admin.employeeAccess.activeAssignments")}
              </h2>
              <p className="metaText">
                {t("admin.employeeAccess.activeAssignments.description")}
              </p>
            </div>
            <span className="badge">{employeeRoleBindings.length}</span>
          </div>

          <div className="managementList">
            {employeeRoleBindings.length === 0 ? (
              <p className="metaText">
                {t("admin.employeeAccess.noAssignments")}
              </p>
            ) : (
              employeeRoleBindings.map((binding) => (
                <EmployeeRoleBindingRow
                  binding={binding}
                  currentEmployeeId={access.employeeId}
                  key={
                    binding.id ??
                    `${binding.roleId}:${permissionScopeKey(binding.scope)}`
                  }
                  returnPath={returnPath}
                  roles={roles}
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="employee-direct-grants-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.directGrants")}</p>
              <h2 className="sectionTitle" id="employee-direct-grants-title">
                {t("admin.employeeAccess.activeDirectGrants")}
              </h2>
              <p className="metaText">
                {t("admin.employeeAccess.activeDirectGrants.description")}
              </p>
            </div>
            <span className="badge">{employeeDirectGrants.length}</span>
          </div>

          <div className="managementList">
            {employeeDirectGrants.length === 0 ? (
              <p className="metaText">
                {t("admin.employeeAccess.noDirectGrants")}
              </p>
            ) : (
              employeeDirectGrants.map((grant) => (
                <EmployeeDirectGrantRow
                  currentEmployeeId={access.employeeId}
                  grant={grant}
                  key={
                    grant.id ??
                    `${grant.permission}:${permissionScopeKey(grant.scope)}`
                  }
                  returnPath={returnPath}
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="employee-effective-access-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.roles.accessPreview")}</p>
              <h2 className="sectionTitle" id="employee-effective-access-title">
                {t("admin.employeeAccess.effectiveAccess")}
              </h2>
              <p className="metaText">
                {t("admin.employeeAccess.effectiveAccess.description")}
              </p>
            </div>
            <span className="badge">{effectiveAccess.length}</span>
          </div>

          <div className="managementList">
            {effectiveAccess.length === 0 ? (
              <p className="metaText">
                {t("admin.employeeAccess.noEffectiveAccess")}
              </p>
            ) : (
              effectiveAccess.map((grant) => (
                <EffectiveGrantRow
                  grant={grant}
                  key={effectiveGrantKey(grant)}
                  roles={roles}
                  t={t}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </TenantAdminShell>
  );
}

function EmployeeRoleBindingRow({
  binding,
  currentEmployeeId,
  returnPath,
  roles,
  t
}: {
  readonly binding: PermissionRoleBinding;
  readonly currentEmployeeId: EmployeeId;
  readonly returnPath: string;
  readonly roles: readonly TenantRoleRecord[];
  readonly t: Translator;
}): ReactNode {
  const role = roles.find((candidate) => candidate.id === binding.roleId);
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
          {role === undefined ? binding.roleId : roleName(role, t)}
        </h3>
        <p className="metaText">
          {t("admin.roles.assignmentScope", {
            value: scopeValue(binding.scope, t)
          })}
        </p>
      </div>
      <div className="rowActions">
        {isCurrentEmployee || binding.id === undefined ? (
          <span className="badge">{t("admin.roles.currentUser")}</span>
        ) : (
          <form className="inlineForm" action={revokeTenantRoleBindingAction}>
            <input name="returnTo" type="hidden" value={returnPath} />
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

function MembershipCheckboxGroup({
  emptyLabel,
  icon,
  items,
  name,
  selectedIds,
  title
}: {
  readonly emptyLabel: string;
  readonly icon: ReactNode;
  readonly items: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly name: string;
  readonly selectedIds: readonly string[];
  readonly title: string;
}): ReactNode {
  const selectedIdSet = new Set(selectedIds);

  return (
    <fieldset className="membershipFieldset">
      <legend className="membershipLegend">
        <span className="metricIcon">{icon}</span>
        <span>{title}</span>
      </legend>
      {items.length === 0 ? (
        <p className="metaText">{emptyLabel}</p>
      ) : (
        <div className="permissionCheckboxList">
          {items.map((item) => (
            <label className="permissionCheckboxRow" key={item.id}>
              <input
                defaultChecked={selectedIdSet.has(item.id)}
                name={name}
                type="checkbox"
                value={item.id}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function EmployeeDirectGrantRow({
  currentEmployeeId,
  grant,
  returnPath,
  t
}: {
  readonly currentEmployeeId: EmployeeId;
  readonly grant: DirectPermissionGrant;
  readonly returnPath: string;
  readonly t: Translator;
}): ReactNode {
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
        {isCurrentEmployee || grant.id === undefined ? (
          <span className="badge">{t("admin.roles.currentUser")}</span>
        ) : (
          <form
            className="inlineForm"
            action={revokeDirectPermissionGrantAction}
          >
            <input name="returnTo" type="hidden" value={returnPath} />
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
  grant,
  roles,
  t
}: {
  readonly grant: EffectivePermissionGrant;
  readonly roles: readonly TenantRoleRecord[];
  readonly t: Translator;
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
            {sourceLabel(source, roles, t)}
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
  readonly tenantId: TenantId;
}): readonly EffectivePermissionGrant[] {
  const actor: PermissionActor = {
    tenantId: input.tenantId,
    employeeId: input.employee.employeeId,
    roles: input.employee.roles,
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

function roleNameById(
  roleId: string,
  roles: readonly TenantRoleRecord[],
  t: Translator
): string {
  const role = roles.find((candidate) => candidate.id === roleId);

  return role === undefined ? roleId : roleName(role, t);
}

function roleName(role: TenantRoleRecord, t: Translator): string {
  const roleLabelKey = role.isSystem ? fixedRoleLabelKey(role.id) : undefined;

  return roleLabelKey ? t(roleLabelKey) : role.name;
}

function roleLabelFromEmployeeRole(role: EmployeeRole, t: Translator): string {
  switch (role) {
    case "tenant_admin":
      return t("admin.employees.role.tenantAdmin");
    case "supervisor":
      return t("admin.employees.role.supervisor");
    case "agent":
      return t("admin.employees.role.agent");
  }
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

function sourceLabel(
  source: PermissionGrantSource,
  roles: readonly TenantRoleRecord[],
  t: Translator
): string {
  switch (source.type) {
    case "fixed_role":
      return t("admin.roles.source.fixedRole", {
        value: roleLabelFromEmployeeRole(source.role, t)
      });
    case "role_binding": {
      const role = roles.find((candidate) => candidate.id === source.roleId);

      return t("admin.roles.source.roleBinding", {
        value: role === undefined ? source.roleId : roleName(role, t)
      });
    }
    case "direct_grant":
      return t("admin.roles.source.directGrant", {
        value: source.reason
      });
  }
}

function effectiveGrantKey(grant: EffectivePermissionGrant): string {
  return [grant.permission, permissionScopeKey(grant.scope)].join(":");
}

function effectiveGrantSourceKey(
  source: PermissionGrantSource,
  index: number
): string {
  switch (source.type) {
    case "fixed_role":
      return `${index}:fixed_role:${source.role}`;
    case "role_binding":
      return `${index}:role_binding:${source.bindingId ?? source.roleId}`;
    case "direct_grant":
      return `${index}:direct_grant:${source.grantId ?? source.reason}`;
  }
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
    scopeReferencePlaceholder: t("admin.roles.scopeReference.placeholder"),
    scopeUnavailable: t("admin.roles.scopeUnavailable"),
    selectEmployee: t("admin.roles.selectEmployee"),
    selectPermission: t("admin.roles.selectPermission"),
    selectRole: t("admin.roles.selectRole"),
    selectSubject: t("admin.roles.selectSubject"),
    subjectLabels: {
      employee: t("admin.roles.subject.employee"),
      org_unit: t("admin.roles.subject.orgUnit"),
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

function roleActionStatusKey(status: string): I18nMessageKey {
  switch (status) {
    case "assigned":
      return "admin.roles.actionStatus.assigned";
    case "revoked":
      return "admin.roles.actionStatus.revoked";
    case "direct_grant_created":
      return "admin.roles.actionStatus.directGrantCreated";
    case "direct_grant_revoked":
      return "admin.roles.actionStatus.directGrantRevoked";
    case "memberships_updated":
      return "admin.employeeAccess.actionStatus.membershipsUpdated";
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
