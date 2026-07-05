import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import {
  Ban,
  KeyRound,
  Mail,
  RotateCw,
  UserPlus,
  UsersRound,
  XCircle
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  AdminSectionFrame,
  type AdminSectionFrameItem
} from "../../../src/admin-section-frame";
import { EmailInput, EmailText } from "../../../src/contact-fields";
import {
  EmployeeAdminActionForm,
  EmployeeAdminSubmitButton,
  type EmployeeAdminActionMessages
} from "../../../src/employee-admin-action-form";
import { formatDateTime } from "../../../src/formatting";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
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

const employeeAdminSectionIds = ["directory", "invite", "invitations"] as const;

type EmployeeAdminSectionId = (typeof employeeAdminSectionIds)[number];

export default async function EmployeesAdminPage({
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
      loadTenantAdminViewModel({ tenantId: access.tenantId, database }),
      repository.listEmployees({ tenantId: access.tenantId }),
      repository.listInvitations({ tenantId: access.tenantId, limit: 25 }),
      searchParams
    ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const canManageRoles = hasEffectivePermission(accessSnapshot, "roles.manage");
  const selectedSection = resolveEmployeeAdminSection(
    resolvedSearchParams?.section
  );
  const employeeActionMessages = employeeAdminActionMessages(t);
  const employeeAdminSections: readonly AdminSectionFrameItem<EmployeeAdminSectionId>[] =
    [
      {
        id: "directory",
        title: t("admin.employees.activeEmployees"),
        href: employeeAdminSectionHref("directory"),
        icon: <UsersRound size={18} aria-hidden="true" />
      },
      {
        id: "invite",
        title: t("admin.employees.inviteEmployee"),
        href: employeeAdminSectionHref("invite"),
        icon: <UserPlus size={18} aria-hidden="true" />
      },
      {
        id: "invitations",
        title: t("admin.employees.recentInvites"),
        href: employeeAdminSectionHref("invitations"),
        icon: <Mail size={18} aria-hidden="true" />
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
      title={t("admin.employees")}
      titleId="employees-title"
    >
      <AdminSectionFrame
        ariaLabel={t("admin.employees")}
        navTitle={t("admin.employees")}
        sections={employeeAdminSections}
        selectedSection={selectedSection}
      >
        <section
          className="settingsPanel"
          aria-labelledby="employee-invite-title"
          hidden={selectedSection !== "invite"}
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

          <EmployeeAdminActionForm
            actionKind="inviteEmployee"
            className="settingsForm"
            manualInviteLinkLabel={t("admin.employees.manualInviteLink")}
            messages={employeeActionMessages}
            resetOnSuccess
          >
            <label className="fieldStack">
              <span className="detailLabel">{t("auth.email")}</span>
              <EmailInput className="textInput" name="email" required />
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
            <EmployeeAdminSubmitButton
              className="primaryButton"
              label={t("admin.employees.sendInvite")}
            >
              <UserPlus size={18} aria-hidden="true" />
            </EmployeeAdminSubmitButton>
          </EmployeeAdminActionForm>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="employees-list-title"
          hidden={selectedSection !== "directory"}
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
                    <EmailText
                      asLink={false}
                      className="metaText"
                      value={employee.email}
                    />
                    <span className="badge">
                      {t(
                        employee.deactivatedAt
                          ? "admin.employees.status.deactivated"
                          : "admin.employees.status.active"
                      )}
                    </span>
                  </div>
                  <div className="rowActions">
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
                      <EmployeeAdminActionForm
                        actionKind="deactivateEmployee"
                        className="inlineForm"
                        manualInviteLinkLabel={t(
                          "admin.employees.manualInviteLink"
                        )}
                        messages={employeeActionMessages}
                      >
                        <input
                          name="employeeId"
                          type="hidden"
                          value={employee.employeeId}
                        />
                        <EmployeeAdminSubmitButton
                          className="dangerButton"
                          label={t("admin.employees.deactivate")}
                        >
                          <Ban size={14} aria-hidden="true" />
                        </EmployeeAdminSubmitButton>
                      </EmployeeAdminActionForm>
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
          hidden={selectedSection !== "invitations"}
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
                    <h3 className="listItemTitle">
                      <EmailText asLink={false} value={invitation.email} />
                    </h3>
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
                      <EmployeeAdminActionForm
                        actionKind="resendInvite"
                        className="inlineForm"
                        manualInviteLinkLabel={t(
                          "admin.employees.manualInviteLink"
                        )}
                        messages={employeeActionMessages}
                      >
                        <input
                          name="invitationId"
                          type="hidden"
                          value={invitation.id}
                        />
                        <EmployeeAdminSubmitButton
                          className="secondaryButton"
                          label={t("admin.employees.resendInvite")}
                        >
                          <RotateCw size={14} aria-hidden="true" />
                        </EmployeeAdminSubmitButton>
                      </EmployeeAdminActionForm>
                    ) : null}
                    {!invitation.acceptedAt && !invitation.revokedAt ? (
                      <EmployeeAdminActionForm
                        actionKind="revokeInvite"
                        className="inlineForm"
                        manualInviteLinkLabel={t(
                          "admin.employees.manualInviteLink"
                        )}
                        messages={employeeActionMessages}
                      >
                        <input
                          name="invitationId"
                          type="hidden"
                          value={invitation.id}
                        />
                        <EmployeeAdminSubmitButton
                          className="dangerButton"
                          label={t("admin.employees.revokeInvite")}
                        >
                          <XCircle size={14} aria-hidden="true" />
                        </EmployeeAdminSubmitButton>
                      </EmployeeAdminActionForm>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </AdminSectionFrame>
    </TenantAdminShell>
  );
}

function employeeAdminSectionHref(section: EmployeeAdminSectionId): string {
  return `/admin/employees?section=${encodeURIComponent(section)}`;
}

function resolveEmployeeAdminSection(
  value: string | undefined
): EmployeeAdminSectionId {
  return isEmployeeAdminSectionId(value) ? value : "directory";
}

function isEmployeeAdminSectionId(
  value: string | undefined
): value is EmployeeAdminSectionId {
  return employeeAdminSectionIds.some((section) => section === value);
}

function employeeAdminActionMessages(
  t: ReturnType<typeof createTranslator>["t"]
): EmployeeAdminActionMessages {
  return {
    deactivated: t("admin.employees.actionStatus.deactivated"),
    email_verification_required: t("auth.emailVerification.status.required"),
    invalid: t("admin.employees.actionStatus.invalid"),
    invite_revoked: t("admin.employees.actionStatus.inviteRevoked"),
    not_configured: t("admin.employees.inviteEmailNotConfigured"),
    permission_denied: t("admin.roles.actionStatus.permissionDenied"),
    provider_failed: t("admin.employees.inviteEmailFailed"),
    sent: t("admin.employees.inviteSent")
  };
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
