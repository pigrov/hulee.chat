import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  getPermissionDefinition,
  permissionCatalog,
  resolveEffectivePermissionGrants,
  type DirectPermissionGrant,
  type EffectivePermissionGrant,
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
  type OrgUnitRecord,
  type TenantEmployeeRecord,
  type TenantRoleRecord,
  type TeamRecord,
  type WorkQueueRecord
} from "@hulee/db";
import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import {
  ArrowLeft,
  Building2,
  Camera,
  Inbox,
  KeyRound,
  ListChecks,
  Plus,
  Save,
  UserRound,
  UsersRound,
  XCircle
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../../../src/access-denied";
import {
  AdminSectionFrame,
  type AdminSectionFrameItem
} from "../../../../../src/admin-section-frame";
import {
  isEmployeeAccessSectionId,
  type EmployeeAccessSectionId
} from "../../../../../src/employee-access-sections";
import {
  EmployeeMembershipActionForm,
  EmployeeMembershipSubmitButton,
  type EmployeeMembershipActionMessages
} from "../../../../../src/employee-membership-action-form";
import { EmployeeEmailChangeForm } from "../../../../../src/employee-email-change-form";
import { EmployeeProfileForm } from "../../../../../src/employee-profile-form";
import { loadTenantAdminViewModel } from "../../../../../src/admin-view-model";
import { EmailText, PhoneNumberText } from "../../../../../src/contact-fields";
import { allowedRoleBindingScopeTypesForPermissions } from "../../../../../src/rbac-scope";
import { buildScopeReferenceOptions } from "../../../../../src/rbac-scope-options";
import {
  DirectGrantFields,
  RoleAssignmentFields,
  type ScopePickerMessages
} from "../../../../../src/rbac-scope-picker";
import {
  RoleActionForm,
  RoleActionSubmitButton,
  type RoleActionMessages
} from "../../../../../src/role-action-form";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../../../src/session";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "../../../../../src/rbac-effective-access";
import { TenantAdminShell } from "../../../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../../../src/tenant-admin-nav";

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
    section?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const now = new Date();
  const rbacRepository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: access.tenantId,
    employeeId: access.employeeId,
    employeeRepository,
    rbacRepository,
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

  const { employeeId: employeeIdParam } = await params;
  const employeeId = decodeURIComponent(employeeIdParam) as EmployeeId;
  const orgStructureRepository =
    createSqlOrgStructureRepository(getWebDatabase());
  const [
    model,
    employee,
    roles,
    roleBindings,
    directGrants,
    expiredRoleBindings,
    expiredDirectGrants,
    orgUnits,
    teams,
    workQueues,
    resolvedSearch
  ] = await Promise.all([
    loadTenantAdminViewModel({ tenantId: access.tenantId }),
    employeeRepository.findEmployee({
      tenantId: access.tenantId,
      employeeId
    }),
    rbacRepository.listRoleDefinitions({ tenantId: access.tenantId }),
    rbacRepository.listRoleBindings({ tenantId: access.tenantId, at: now }),
    rbacRepository.listDirectGrants({ tenantId: access.tenantId, at: now }),
    rbacRepository.listExpiredRoleBindings({
      tenantId: access.tenantId,
      at: now
    }),
    rbacRepository.listExpiredDirectGrants({
      tenantId: access.tenantId,
      at: now
    }),
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
    teams,
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
  const expiredEmployeeRoleBindings = expiredRoleBindings
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
  const expiredEmployeeDirectGrants = expiredDirectGrants
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
  const selectedSection = resolveEmployeeAccessSection(resolvedSearch?.section);
  const membershipActionMessages = employeeMembershipActionMessages(t);
  const roleActionMessages = employeeAccessRoleActionMessages(t);
  const membershipCount =
    employee.orgUnitIds.length +
    employee.teamIds.length +
    employee.queueIds.length;
  const sections: readonly AdminSectionFrameItem<EmployeeAccessSectionId>[] = [
    {
      id: "profile",
      title: t("admin.employeeAccess.profile"),
      href: employeeAccessSectionHref(returnPath, "profile"),
      icon: <UserRound size={18} aria-hidden="true" />
    },
    {
      id: "memberships",
      title: t("admin.employeeAccess.memberships"),
      href: employeeAccessSectionHref(returnPath, "memberships"),
      icon: <Building2 size={18} aria-hidden="true" />
    },
    {
      id: "roles",
      title: t("admin.employeeAccess.roles"),
      href: employeeAccessSectionHref(returnPath, "roles"),
      icon: <UsersRound size={18} aria-hidden="true" />
    },
    {
      id: "direct_grants",
      title: t("admin.employeeAccess.directGrants"),
      href: employeeAccessSectionHref(returnPath, "direct_grants"),
      icon: <KeyRound size={18} aria-hidden="true" />
    },
    {
      id: "effective_access",
      title: t("admin.employeeAccess.effectiveAccess"),
      href: employeeAccessSectionHref(returnPath, "effective_access"),
      icon: <ListChecks size={18} aria-hidden="true" />
    }
  ];

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="employees"
      effectiveAccess={accessSnapshot}
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.employeeAccess")}
      titleId="employee-access-title"
    >
      <AdminSectionFrame
        ariaLabel={t("admin.employeeAccess.sections")}
        navTitle={t("admin.employeeAccess")}
        sections={sections}
        selectedSection={selectedSection}
      >
        <section
          className="settingsPanel employeeAccessSummaryPanel"
          aria-labelledby="employee-access-summary-title"
        >
          <div className="employeeAccessSummaryHeader">
            <div className="employeeAccessSummaryIdentity">
              <EmployeeAvatar employee={employee} size="large" />
              <div className="employeeAccessSummaryTitleBlock">
                <p className="eyebrow">{t("admin.employeeAccess")}</p>
                <h2 className="sectionTitle" id="employee-access-summary-title">
                  {employee.displayName}
                </h2>
                <p className="metaText">
                  {t("admin.employeeAccess.description")}
                </p>
              </div>
            </div>
            <Link className="secondaryButton" href="/admin/employees">
              <ArrowLeft size={14} aria-hidden="true" />
              {t("admin.employeeAccess.backToEmployees")}
            </Link>
          </div>

          <dl className="employeeAccessSummaryMeta">
            <div className="employeeAccessSummaryMetaItem">
              <dt>{t("auth.email")}</dt>
              <dd>
                <EmailText value={employee.email} />
              </dd>
            </div>
            <div className="employeeAccessSummaryMetaItem">
              <dt>{t("admin.employees.phoneNumber")}</dt>
              <dd>
                <PhoneNumberText
                  fallback={t("common.unknown")}
                  value={employee.phoneNumber}
                />
              </dd>
            </div>
            <div className="employeeAccessSummaryMetaItem">
              <dt>{t("admin.employeeAccess.status")}</dt>
              <dd>
                <span className="statusBadge">
                  {t(
                    isDeactivated
                      ? "admin.employees.status.deactivated"
                      : "admin.employees.status.active"
                  )}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        {selectedSection === "profile" ? (
          <section
            className="settingsPanel"
            aria-labelledby="employee-profile-title"
          >
            <div className="sectionHeader">
              <div>
                <h2 className="sectionTitle" id="employee-profile-title">
                  {t("admin.employeeAccess.profile")}
                </h2>
                <p className="metaText">
                  {t("admin.employeeAccess.profile.description")}
                </p>
              </div>
              <span className="badge">
                <UserRound size={14} aria-hidden="true" />
                {t(
                  isDeactivated
                    ? "admin.employees.status.deactivated"
                    : "admin.employees.status.active"
                )}
              </span>
            </div>

            <EmployeeProfileForm
              avatarUrl={employee.avatarUrl}
              defaultDisplayName={employee.displayName}
              defaultPhoneNumber={employee.phoneNumber}
              disabled={isDeactivated}
              employeeId={employee.employeeId}
              labels={{
                avatar: t("admin.employees.avatar"),
                avatarCurrent: t("admin.employees.avatarCurrent"),
                avatarRecommendation: t("admin.employees.avatarRecommendation"),
                displayName: t("admin.employees.displayName"),
                phoneNumber: t("admin.employees.phoneNumber"),
                phonePlaceholder: t("admin.employees.phoneNumber.placeholder"),
                saveProfile: t("admin.employeeAccess.saveProfile"),
                savingProfile: t("admin.employeeAccess.savingProfile")
              }}
              messages={{
                avatar_invalid_type: t(
                  "admin.employeeAccess.actionStatus.avatarInvalidType"
                ),
                avatar_storage_unavailable: t(
                  "admin.employeeAccess.actionStatus.avatarStorageUnavailable"
                ),
                avatar_too_large: t(
                  "admin.employeeAccess.actionStatus.avatarTooLarge"
                ),
                email_verification_required: t(
                  "auth.emailVerification.status.required"
                ),
                permission_denied: t(
                  "admin.roles.actionStatus.permissionDenied"
                ),
                phone_invalid: t(
                  "admin.employeeAccess.actionStatus.phoneInvalid"
                ),
                profile_invalid: t(
                  "admin.employeeAccess.actionStatus.profileInvalid"
                ),
                profile_updated: t(
                  "admin.employeeAccess.actionStatus.profileUpdated"
                )
              }}
            />

            <div className="settingsSubPanel">
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("auth.email")}</p>
                  <h3 className="sectionTitle">
                    {t("admin.employeeAccess.emailChange")}
                  </h3>
                  <p className="metaText">
                    {t("admin.employeeAccess.emailChange.description")}
                  </p>
                </div>
              </div>
              <EmployeeEmailChangeForm
                currentEmail={employee.email}
                disabled={isDeactivated}
                employeeId={employee.employeeId}
                labels={{
                  cancel: t("common.cancel"),
                  changeEmail: t("admin.employeeAccess.changeEmail"),
                  currentEmail: t("admin.employeeAccess.currentEmail"),
                  emailPlaceholder: t(
                    "admin.employeeAccess.newEmail.placeholder"
                  ),
                  newEmail: t("admin.employeeAccess.newEmail"),
                  requestChange: t("admin.employeeAccess.requestEmailChange"),
                  requestingChange: t(
                    "admin.employeeAccess.requestingEmailChange"
                  )
                }}
                messages={{
                  email_change_duplicate: t(
                    "admin.employeeAccess.actionStatus.emailChangeDuplicate"
                  ),
                  email_change_invalid: t(
                    "admin.employeeAccess.actionStatus.emailChangeInvalid"
                  ),
                  email_change_sent: t(
                    "admin.employeeAccess.actionStatus.emailChangeSent"
                  ),
                  email_change_unavailable: t(
                    "admin.employeeAccess.actionStatus.emailChangeUnavailable"
                  ),
                  email_unchanged: t(
                    "admin.employeeAccess.actionStatus.emailUnchanged"
                  ),
                  email_verification_required: t(
                    "auth.emailVerification.status.required"
                  ),
                  not_configured: t(
                    "auth.emailVerification.status.not_configured"
                  ),
                  permission_denied: t(
                    "admin.roles.actionStatus.permissionDenied"
                  ),
                  provider_failed: t(
                    "auth.emailVerification.status.provider_failed"
                  )
                }}
              />
            </div>
          </section>
        ) : null}

        {selectedSection === "memberships" ? (
          <section
            className="settingsPanel"
            aria-labelledby="employee-memberships-title"
          >
            <div className="sectionHeader">
              <div>
                <h2 className="sectionTitle" id="employee-memberships-title">
                  {t("admin.employeeAccess.memberships")}
                </h2>
                <p className="metaText">
                  {t("admin.employeeAccess.memberships.description")}
                </p>
              </div>
              <span className="badge">{membershipCount}</span>
            </div>

            <div className="employeeMembershipGrid">
              <EmployeeMembershipActionForm
                actionKind="setOrgUnitMemberships"
                className="settingsForm settingsSubPanel employeeMembershipForm"
                messages={membershipActionMessages}
                reauthLabel={t("auth.login.link")}
              >
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
                <EmployeeMembershipSubmitButton
                  className="primaryButton"
                  disabled={isDeactivated}
                  label={t("admin.employeeAccess.saveMemberships")}
                >
                  <Save size={18} aria-hidden="true" />
                </EmployeeMembershipSubmitButton>
              </EmployeeMembershipActionForm>

              <EmployeeMembershipActionForm
                actionKind="setTeamMemberships"
                className="settingsForm settingsSubPanel employeeMembershipForm"
                messages={membershipActionMessages}
                reauthLabel={t("auth.login.link")}
              >
                <input
                  name="employeeId"
                  type="hidden"
                  value={employee.employeeId}
                />
                <MembershipCheckboxGroup
                  emptyLabel={t("admin.employeeAccess.noTeamsAvailable")}
                  icon={<UsersRound size={18} aria-hidden="true" />}
                  items={teams.map((team) => ({
                    id: team.id,
                    label: team.name
                  }))}
                  name="teamId"
                  selectedIds={employee.teamIds}
                  title={t("admin.employeeAccess.teamMemberships")}
                />
                <EmployeeMembershipSubmitButton
                  className="primaryButton"
                  disabled={isDeactivated}
                  label={t("admin.employeeAccess.saveMemberships")}
                >
                  <Save size={18} aria-hidden="true" />
                </EmployeeMembershipSubmitButton>
              </EmployeeMembershipActionForm>

              <EmployeeMembershipActionForm
                actionKind="setWorkQueueMemberships"
                className="settingsForm settingsSubPanel employeeMembershipForm"
                messages={membershipActionMessages}
                reauthLabel={t("auth.login.link")}
              >
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
                <EmployeeMembershipSubmitButton
                  className="primaryButton"
                  disabled={isDeactivated}
                  label={t("admin.employeeAccess.saveMemberships")}
                >
                  <Save size={18} aria-hidden="true" />
                </EmployeeMembershipSubmitButton>
              </EmployeeMembershipActionForm>
            </div>
          </section>
        ) : null}

        {selectedSection === "roles" ? (
          <>
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

              <RoleActionForm
                actionKind="assignRole"
                className="settingsForm employeeAccessAssignForm"
                messages={roleActionMessages}
                reauthLabel={t("auth.login.link")}
                resetOnSuccess
              >
                <RoleAssignmentFields
                  employees={employeeOptions}
                  messages={scopePickerMessages(t)}
                  roles={roleAssignmentOptions}
                  scopeReferenceOptions={scopeReferenceOptions}
                  selectedEmployeeId={employee.employeeId}
                />
                <RoleActionSubmitButton
                  className="primaryButton"
                  disabled={isDeactivated || roleAssignmentOptions.length === 0}
                  label={t("admin.roles.assign")}
                >
                  <Plus size={18} aria-hidden="true" />
                </RoleActionSubmitButton>
              </RoleActionForm>
            </section>
          </>
        ) : null}

        {selectedSection === "direct_grants" ? (
          <>
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
                <span className="badge">
                  {directGrantPermissionOptions.length}
                </span>
              </div>

              <RoleActionForm
                actionKind="createDirectGrant"
                className="settingsForm employeeAccessGrantForm"
                messages={roleActionMessages}
                reauthLabel={t("auth.login.link")}
                resetOnSuccess
              >
                <DirectGrantFields
                  employees={employeeOptions}
                  messages={scopePickerMessages(t)}
                  permissions={directGrantPermissionOptions}
                  scopeReferenceOptions={scopeReferenceOptions}
                  selectedEmployeeId={employee.employeeId}
                />
                <RoleActionSubmitButton
                  className="primaryButton"
                  disabled={
                    isDeactivated || directGrantPermissionOptions.length === 0
                  }
                  label={t("admin.roles.grantDirectPermission")}
                >
                  <Plus size={18} aria-hidden="true" />
                </RoleActionSubmitButton>
              </RoleActionForm>
            </section>
          </>
        ) : null}

        {selectedSection === "roles" ? (
          <>
            <section
              className="settingsPanel"
              aria-labelledby="employee-role-bindings-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.roles.assignments")}</p>
                  <h2
                    className="sectionTitle"
                    id="employee-role-bindings-title"
                  >
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
                      actionMessages={roleActionMessages}
                      binding={binding}
                      currentEmployeeId={access.employeeId}
                      key={
                        binding.id ??
                        `${binding.roleId}:${permissionScopeKey(binding.scope)}`
                      }
                      reauthLabel={t("auth.login.link")}
                      roles={roles}
                      t={t}
                    />
                  ))
                )}
              </div>
            </section>

            <section
              className="settingsPanel"
              aria-labelledby="employee-expired-role-bindings-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.roles.assignments")}</p>
                  <h2
                    className="sectionTitle"
                    id="employee-expired-role-bindings-title"
                  >
                    {t("admin.employeeAccess.expiredAssignments")}
                  </h2>
                  <p className="metaText">
                    {t("admin.employeeAccess.expiredAssignments.description")}
                  </p>
                </div>
                <span className="badge">
                  {expiredEmployeeRoleBindings.length}
                </span>
              </div>

              <div className="managementList">
                {expiredEmployeeRoleBindings.length === 0 ? (
                  <p className="metaText">
                    {t("admin.employeeAccess.noExpiredAssignments")}
                  </p>
                ) : (
                  expiredEmployeeRoleBindings.map((binding) => (
                    <EmployeeRoleBindingRow
                      actionMessages={roleActionMessages}
                      binding={binding}
                      currentEmployeeId={access.employeeId}
                      expired
                      key={
                        binding.id ??
                        `${binding.roleId}:${permissionScopeKey(binding.scope)}`
                      }
                      reauthLabel={t("auth.login.link")}
                      roles={roles}
                      t={t}
                    />
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}

        {selectedSection === "direct_grants" ? (
          <>
            <section
              className="settingsPanel"
              aria-labelledby="employee-direct-grants-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.roles.directGrants")}</p>
                  <h2
                    className="sectionTitle"
                    id="employee-direct-grants-title"
                  >
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
                      actionMessages={roleActionMessages}
                      currentEmployeeId={access.employeeId}
                      grant={grant}
                      key={
                        grant.id ??
                        `${grant.permission}:${permissionScopeKey(grant.scope)}`
                      }
                      reauthLabel={t("auth.login.link")}
                      t={t}
                    />
                  ))
                )}
              </div>
            </section>

            <section
              className="settingsPanel"
              aria-labelledby="employee-expired-direct-grants-title"
            >
              <div className="sectionHeader">
                <div>
                  <p className="eyebrow">{t("admin.roles.directGrants")}</p>
                  <h2
                    className="sectionTitle"
                    id="employee-expired-direct-grants-title"
                  >
                    {t("admin.employeeAccess.expiredDirectGrants")}
                  </h2>
                  <p className="metaText">
                    {t("admin.employeeAccess.expiredDirectGrants.description")}
                  </p>
                </div>
                <span className="badge">
                  {expiredEmployeeDirectGrants.length}
                </span>
              </div>

              <div className="managementList">
                {expiredEmployeeDirectGrants.length === 0 ? (
                  <p className="metaText">
                    {t("admin.employeeAccess.noExpiredDirectGrants")}
                  </p>
                ) : (
                  expiredEmployeeDirectGrants.map((grant) => (
                    <EmployeeDirectGrantRow
                      actionMessages={roleActionMessages}
                      currentEmployeeId={access.employeeId}
                      expired
                      grant={grant}
                      key={
                        grant.id ??
                        `${grant.permission}:${permissionScopeKey(grant.scope)}`
                      }
                      reauthLabel={t("auth.login.link")}
                      t={t}
                    />
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}

        {selectedSection === "effective_access" ? (
          <section
            className="settingsPanel"
            aria-labelledby="employee-effective-access-title"
          >
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">{t("admin.roles.accessPreview")}</p>
                <h2
                  className="sectionTitle"
                  id="employee-effective-access-title"
                >
                  {t("admin.employeeAccess.effectiveAccess")}
                </h2>
                <p className="metaText">
                  {t("admin.employeeAccess.effectiveAccess.description")}
                </p>
              </div>
              <span className="badge">{effectiveAccess.length}</span>
            </div>

            {effectiveAccess.length === 0 ? (
              <p className="metaText">
                {t("admin.employeeAccess.noEffectiveAccess")}
              </p>
            ) : (
              <div className="effectiveAccessTableWrap">
                <table className="effectiveAccessTable">
                  <thead>
                    <tr>
                      <th scope="col">{t("admin.roles.permission")}</th>
                      <th scope="col">{t("admin.roles.domain")}</th>
                      <th scope="col">{t("admin.roles.scopeType")}</th>
                      <th scope="col">{t("admin.roles.source")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveAccess.map((grant) => (
                      <EffectiveGrantTableRow
                        employee={employee}
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
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </AdminSectionFrame>
    </TenantAdminShell>
  );
}

function resolveEmployeeAccessSection(
  section: string | undefined
): EmployeeAccessSectionId {
  if (section !== undefined && isEmployeeAccessSectionId(section)) {
    return section;
  }

  return "profile";
}

function EmployeeAvatar({
  employee,
  size = "default"
}: {
  readonly employee: TenantEmployeeRecord;
  readonly size?: "default" | "large";
}): ReactNode {
  const className =
    size === "large" ? "employeeAvatar employeeAvatarLarge" : "employeeAvatar";

  if (employee.avatarUrl) {
    return <img alt="" className={className} src={employee.avatarUrl} />;
  }

  const initials = employeeInitials(employee.displayName);

  return (
    <span className={className} aria-hidden="true">
      {initials.length > 0 ? initials : <Camera size={18} aria-hidden="true" />}
    </span>
  );
}

function employeeInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function employeeAccessSectionHref(
  returnPath: string,
  section: EmployeeAccessSectionId
): string {
  const params = new URLSearchParams({ section });

  return `${returnPath}?${params.toString()}`;
}

function EmployeeRoleBindingRow({
  actionMessages,
  binding,
  currentEmployeeId,
  expired = false,
  reauthLabel,
  roles,
  t
}: {
  readonly actionMessages: RoleActionMessages;
  readonly binding: PermissionRoleBinding;
  readonly currentEmployeeId: EmployeeId;
  readonly expired?: boolean;
  readonly reauthLabel: string;
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
        {expired ? (
          <span className="badge">{t("admin.roles.expired")}</span>
        ) : isCurrentEmployee || binding.id === undefined ? (
          <span className="badge">{t("admin.roles.currentUser")}</span>
        ) : (
          <RoleActionForm
            actionKind="revokeRoleBinding"
            className="inlineForm"
            messages={actionMessages}
            reauthLabel={reauthLabel}
          >
            <input name="bindingId" type="hidden" value={binding.id} />
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
  actionMessages,
  currentEmployeeId,
  expired = false,
  grant,
  reauthLabel,
  t
}: {
  readonly actionMessages: RoleActionMessages;
  readonly currentEmployeeId: EmployeeId;
  readonly expired?: boolean;
  readonly grant: DirectPermissionGrant;
  readonly reauthLabel: string;
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
        {expired ? (
          <span className="badge">{t("admin.roles.expired")}</span>
        ) : isCurrentEmployee || grant.id === undefined ? (
          <span className="badge">{t("admin.roles.currentUser")}</span>
        ) : (
          <RoleActionForm
            actionKind="revokeDirectGrant"
            className="inlineForm"
            messages={actionMessages}
            reauthLabel={reauthLabel}
          >
            <input name="grantId" type="hidden" value={grant.id} />
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

function EffectiveGrantTableRow({
  employee,
  grant,
  orgUnits,
  roleBindings,
  roles,
  t,
  teams,
  workQueues
}: {
  readonly employee: TenantEmployeeRecord;
  readonly grant: EffectivePermissionGrant;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly roleBindings: readonly PermissionRoleBinding[];
  readonly roles: readonly TenantRoleRecord[];
  readonly t: Translator;
  readonly teams: readonly TeamRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
}): ReactNode {
  const definition = getPermissionDefinition(grant.permission);

  return (
    <tr>
      <td>
        <code className="permissionCode">{grant.permission}</code>
      </td>
      <td>{t(permissionDomainKey(definition.domain))}</td>
      <td>{scopeValue(grant.scope, t)}</td>
      <td>
        <div className="sourceList effectiveAccessTableSourceList">
          {grant.sources.map((source, index) => (
            <span
              className="badge"
              key={effectiveGrantSourceKey(source, index)}
            >
              {sourceLabel(source, {
                employees: [employee],
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
      </td>
    </tr>
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

      return references.t("admin.roles.source.roleBindingWithSubject", {
        role: roleLabel,
        subject: references.t(subjectTypeKey(binding.subject)),
        value: roleBindingSubjectValue(binding.subject, references)
      });
    }
    case "direct_grant":
      return references.t("admin.roles.source.directGrant", {
        value: source.reason
      });
  }
}

function roleBindingSubjectValue(
  subject: PermissionRoleBinding["subject"],
  references: {
    readonly employees: readonly TenantEmployeeRecord[];
    readonly orgUnits: readonly OrgUnitRecord[];
    readonly teams: readonly TeamRecord[];
    readonly workQueues: readonly WorkQueueRecord[];
  }
): string {
  switch (subject.type) {
    case "employee": {
      const employee = references.employees.find(
        (candidate) => candidate.employeeId === subject.id
      );

      return employee === undefined
        ? subject.id
        : `${employee.displayName} (${employee.email})`;
    }
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

function employeeMembershipActionMessages(
  t: Translator
): EmployeeMembershipActionMessages {
  return {
    email_verification_required: t("auth.emailVerification.status.required"),
    invalid: t("admin.employeeAccess.actionStatus.invalid"),
    memberships_updated: t(
      "admin.employeeAccess.actionStatus.membershipsUpdated"
    ),
    permission_denied: t("admin.roles.actionStatus.permissionDenied"),
    reauth_required: t("admin.roles.actionStatus.reauthRequired")
  };
}

function employeeAccessRoleActionMessages(t: Translator): RoleActionMessages {
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

function subjectTypeKey(
  subject: PermissionRoleBinding["subject"]
): I18nMessageKey {
  switch (subject.type) {
    case "team":
      return "admin.roles.subject.team";
    case "org_unit":
      return "admin.roles.subject.orgUnit";
    case "queue":
      return "admin.roles.subject.queue";
    case "employee":
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
