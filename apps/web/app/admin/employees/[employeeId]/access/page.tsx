import type { EmployeeId } from "@hulee/contracts";
import {
  canAccess,
  permissionCatalog,
  type DirectPermissionGrant,
  type PermissionRoleBinding
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlTenantRbacRepository,
  type TenantEmployeeRecord,
  type TenantRoleRecord
} from "@hulee/db";
import { createTranslator } from "@hulee/i18n";
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
import { buildEmployeeEffectiveAccessPreview } from "../../../../../src/employee-effective-access-model";
import { EffectiveAccessTable } from "../../../../../src/employee-effective-access-table";
import { loadTenantAdminViewModel } from "../../../../../src/admin-view-model";
import { EmailText, PhoneNumberText } from "../../../../../src/contact-fields";
import { permissionDomainKey } from "../../../../../src/rbac-permission-display";
import {
  permissionScopeKey,
  roleName,
  roleNameById,
  scopePickerMessages,
  scopeValue
} from "../../../../../src/rbac-role-display";
import { allowedRoleBindingScopeTypesForPermissions } from "../../../../../src/rbac-scope";
import { buildScopeReferenceOptions } from "../../../../../src/rbac-scope-options";
import {
  DirectGrantFields,
  RoleAssignmentFields
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
import { resolveEmployeeEffectiveAccess } from "../../../../../src/rbac-effective-access";
import { TenantAdminShell } from "../../../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../../../src/tenant-admin-nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Translator = ReturnType<typeof createTranslator>["t"];

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
    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromTenantAdminAccess({
          session: access,
          effectiveAccess: accessSnapshot
        })}
      />
    );
  }

  if (
    !canAccess({
      actor: accessSnapshot.actor,
      effectiveGrants: accessSnapshot.effectiveGrants,
      permission: "employees.manage",
      resource: {
        tenantId: employee.tenantId,
        orgUnitIds: employee.orgUnitIds,
        teamIds: employee.teamIds
      }
    }).allowed
  ) {
    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromTenantAdminAccess({
          session: access,
          effectiveAccess: accessSnapshot
        })}
      />
    );
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
  const effectiveAccess = buildEmployeeEffectiveAccessPreview({
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
              <EffectiveAccessTable
                employee={employee}
                grants={effectiveAccess}
                orgUnits={orgUnits}
                roleBindings={roleBindings}
                roles={roles}
                t={t}
                teams={teams}
                workQueues={workQueues}
              />
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
