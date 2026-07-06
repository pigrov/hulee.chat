import {
  getPermissionDefinition,
  type EffectivePermissionGrant,
  type PermissionGrantSource,
  type PermissionRoleBinding
} from "@hulee/core";
import type {
  OrgUnitRecord,
  TenantEmployeeRecord,
  TenantRoleRecord,
  TeamRecord,
  WorkQueueRecord
} from "@hulee/db";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import type { ReactNode } from "react";

import { permissionDomainKey } from "./rbac-permission-display";
import { permissionScopeKey, roleName, scopeValue } from "./rbac-role-display";

type Translator = ReturnType<typeof createTranslator>["t"];

export function EffectiveAccessTable({
  employee,
  grants,
  orgUnits,
  roleBindings,
  roles,
  t,
  teams,
  workQueues
}: {
  readonly employee: TenantEmployeeRecord;
  readonly grants: readonly EffectivePermissionGrant[];
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly roleBindings: readonly PermissionRoleBinding[];
  readonly roles: readonly TenantRoleRecord[];
  readonly t: Translator;
  readonly teams: readonly TeamRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
}): ReactNode {
  return (
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
          {grants.map((grant) => (
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
    default:
      return "admin.roles.subject.employee";
  }
}
