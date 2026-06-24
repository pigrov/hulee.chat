import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import { Ban, KeyRound, Mail, RotateCw, UserPlus, XCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";

import { AccessDeniedPage } from "../../../src/access-denied";
import { DetailItem } from "../../../src/app-chrome";
import {
  deactivateEmployeeAction,
  inviteEmployeeAction,
  resendEmployeeInviteAction,
  revokeEmployeeInviteAction
} from "../../../src/employee-actions";
import { resolvePublicBaseUrl } from "../../../src/email";
import { formatDateTime } from "../../../src/formatting";
import { loadInboxViewModel } from "../../../src/inbox-api-client";
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

export default async function EmployeesAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    actionStatus?: string;
    inviteStatus?: string;
    inviteToken?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const database = getWebDatabase();
  const repository = createSqlEmployeeDirectoryRepository(database);
  const rbacRepository = createSqlTenantRbacRepository(database);
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: access.tenantId,
    employeeId: access.employeeId,
    employeeRepository: repository,
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

  const [model, employees, invitations, resolvedSearchParams] =
    await Promise.all([
      loadInboxViewModel(),
      repository.listEmployees({ tenantId: access.tenantId }),
      repository.listInvitations({ tenantId: access.tenantId, limit: 25 }),
      searchParams
    ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const canManageRoles = hasEffectivePermission(accessSnapshot, "roles.manage");
  const inviteToken = resolvedSearchParams?.inviteToken;
  const manualInviteUrl = inviteToken
    ? new URL(`/invite/${inviteToken}`, resolvePublicBaseUrl()).href
    : undefined;

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="employees"
      effectiveAccess={accessSnapshot}
      sidebarContent={
        <>
          {manualInviteUrl ? (
            <div className="detailGrid">
              <DetailItem
                label={t("admin.employees.inviteStatus")}
                value={t(inviteStatusKey(resolvedSearchParams?.inviteStatus))}
              />
              <label className="fieldStack">
                <span className="detailLabel">
                  {t("admin.employees.manualInviteLink")}
                </span>
                <input
                  className="textInput"
                  type="url"
                  readOnly
                  value={manualInviteUrl}
                />
              </label>
            </div>
          ) : null}

          {resolvedSearchParams?.actionStatus ? (
            <DetailItem
              label={t("admin.employees.actionStatus")}
              value={t(actionStatusKey(resolvedSearchParams.actionStatus))}
            />
          ) : null}
        </>
      }
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.employees")}
      titleId="employees-title"
    >
      <div className="adminStack">
        <section
          className="settingsPanel"
          aria-labelledby="employee-invite-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.employees.invite")}</p>
              <h2 className="sectionTitle" id="employee-invite-title">
                {t("admin.employees.inviteEmployee")}
              </h2>
            </div>
            <span className="badge">
              <Mail size={14} aria-hidden="true" />
              {t("admin.employees.emailInvite")}
            </span>
          </div>

          <form className="settingsForm" action={inviteEmployeeAction}>
            <label className="fieldStack">
              <span className="detailLabel">{t("auth.email")}</span>
              <input
                className="textInput"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">
                {t("admin.employees.displayName")}
              </span>
              <input
                className="textInput"
                name="displayName"
                type="text"
                autoComplete="name"
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">
                {t("admin.employees.accessTemplate")}
              </span>
              <select
                className="selectInput"
                name="role"
                defaultValue="agent"
                required
              >
                <option value="agent">{t("admin.employees.role.agent")}</option>
                <option value="supervisor">
                  {t("admin.employees.role.supervisor")}
                </option>
                <option value="tenant_admin">
                  {t("admin.employees.role.tenantAdmin")}
                </option>
              </select>
              <span className="metaText">
                {t("admin.employees.inviteAccessTemplateDescription")}
              </span>
            </label>
            {resolvedSearchParams?.inviteStatus === "invalid" ? (
              <p className="formError">{t("admin.employees.inviteInvalid")}</p>
            ) : null}
            <button className="primaryButton" type="submit">
              <UserPlus size={18} aria-hidden="true" />
              {t("admin.employees.sendInvite")}
            </button>
          </form>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="employees-list-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.employees.directory")}</p>
              <h2 className="sectionTitle" id="employees-list-title">
                {t("admin.employees.activeEmployees")}
              </h2>
            </div>
            <span className="badge">{employees.length}</span>
          </div>

          <div className="managementList">
            {employees.length === 0 ? (
              <p className="metaText">{t("admin.employees.empty")}</p>
            ) : (
              employees.map((employee) => (
                <article className="managementRow" key={employee.employeeId}>
                  <div>
                    <h3 className="listItemTitle">{employee.displayName}</h3>
                    <p className="metaText">{employee.email}</p>
                    <span className="badge">
                      {t(
                        employee.deactivatedAt
                          ? "admin.employees.status.deactivated"
                          : "admin.employees.status.active"
                      )}
                    </span>
                  </div>
                  <div className="rowActions">
                    <div className="detailItem">
                      <span className="detailLabel">
                        {t("admin.employees.accessTemplate")}
                      </span>
                      <span className="badge">
                        <KeyRound size={14} aria-hidden="true" />
                        {employee.roles
                          .map((role) => t(roleLabelKey(role)))
                          .join(", ")}
                      </span>
                    </div>
                    {canManageRoles ? (
                      <Link
                        className="secondaryButton"
                        href={`/admin/employees/${encodeURIComponent(employee.employeeId)}/access`}
                      >
                        <KeyRound size={14} aria-hidden="true" />
                        {t("admin.employees.openRoles")}
                      </Link>
                    ) : null}
                    {!employee.deactivatedAt &&
                    employee.employeeId !== access.employeeId ? (
                      <form
                        className="inlineForm"
                        action={deactivateEmployeeAction}
                      >
                        <input
                          name="employeeId"
                          type="hidden"
                          value={employee.employeeId}
                        />
                        <button className="dangerButton" type="submit">
                          <Ban size={14} aria-hidden="true" />
                          {t("admin.employees.deactivate")}
                        </button>
                      </form>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="employee-invitations-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.employees.invites")}</p>
              <h2 className="sectionTitle" id="employee-invitations-title">
                {t("admin.employees.recentInvites")}
              </h2>
            </div>
            <span className="badge">{invitations.length}</span>
          </div>

          <div className="managementList">
            {invitations.length === 0 ? (
              <p className="metaText">{t("admin.employees.noInvitations")}</p>
            ) : (
              invitations.map((invitation) => (
                <article className="managementRow" key={invitation.id}>
                  <div>
                    <h3 className="listItemTitle">{invitation.email}</h3>
                    <p className="metaText">
                      {t("admin.employees.expiresAt", {
                        value: formatDateTime(invitation.expiresAt, locale)
                      })}
                    </p>
                  </div>
                  <div className="rowActions">
                    <span className="badge">
                      {t(invitationStatusKey(invitation, new Date()))}
                    </span>
                    {!invitation.acceptedAt ? (
                      <form
                        className="inlineForm"
                        action={resendEmployeeInviteAction}
                      >
                        <input
                          name="invitationId"
                          type="hidden"
                          value={invitation.id}
                        />
                        <button className="secondaryButton" type="submit">
                          <RotateCw size={14} aria-hidden="true" />
                          {t("admin.employees.resendInvite")}
                        </button>
                      </form>
                    ) : null}
                    {!invitation.acceptedAt && !invitation.revokedAt ? (
                      <form
                        className="inlineForm"
                        action={revokeEmployeeInviteAction}
                      >
                        <input
                          name="invitationId"
                          type="hidden"
                          value={invitation.id}
                        />
                        <button className="dangerButton" type="submit">
                          <XCircle size={14} aria-hidden="true" />
                          {t("admin.employees.revokeInvite")}
                        </button>
                      </form>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </TenantAdminShell>
  );
}

function actionStatusKey(status: string): I18nMessageKey {
  switch (status) {
    case "role_changed":
      return "admin.employees.actionStatus.roleChanged";
    case "deactivated":
      return "admin.employees.actionStatus.deactivated";
    case "invite_revoked":
      return "admin.employees.actionStatus.inviteRevoked";
    default:
      return "admin.employees.actionStatus.invalid";
  }
}

function roleLabelKey(role: string): I18nMessageKey {
  switch (role) {
    case "tenant_admin":
      return "admin.employees.role.tenantAdmin";
    case "supervisor":
      return "admin.employees.role.supervisor";
    default:
      return "admin.employees.role.agent";
  }
}

function inviteStatusKey(status: string | undefined): I18nMessageKey {
  switch (status) {
    case "sent":
      return "admin.employees.inviteSent";
    case "not_configured":
      return "admin.employees.inviteEmailNotConfigured";
    case "provider_failed":
      return "admin.employees.inviteEmailFailed";
    case "invalid":
      return "admin.employees.inviteInvalid";
    default:
      return "admin.employees.inviteCreated";
  }
}

function invitationStatusKey(
  invitation: {
    acceptedAt?: string;
    revokedAt?: string;
    expiresAt: string;
  },
  now: Date
): I18nMessageKey {
  if (invitation.acceptedAt) {
    return "admin.employees.inviteStatus.accepted";
  }

  if (invitation.revokedAt) {
    return "admin.employees.inviteStatus.revoked";
  }

  if (new Date(invitation.expiresAt).getTime() <= now.getTime()) {
    return "admin.employees.inviteStatus.expired";
  }

  return "admin.employees.inviteStatus.pending";
}
