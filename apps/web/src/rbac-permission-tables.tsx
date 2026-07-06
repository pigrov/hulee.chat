import type { Permission } from "@hulee/core";
import type { createTranslator } from "@hulee/i18n";
import type { ReactNode } from "react";

import {
  allowedPermissionScopesText,
  permissionDescriptionKey,
  permissionDomainKey,
  summarizePermissionCatalogDomains
} from "./rbac-permission-display";

type Translator = ReturnType<typeof createTranslator>["t"];

export function PermissionCatalogTable({ t }: { t: Translator }): ReactNode {
  return (
    <div className="permissionEditorTableWrap">
      <table className="permissionEditorTable permissionCatalogTable">
        <thead>
          <tr>
            <th>{t("admin.roles.permission")}</th>
            <th>{t("admin.roles.permissionDescriptionColumn")}</th>
            <th>{t("admin.roles.domain")}</th>
            <th>{t("admin.roles.allowedScopesColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {summarizePermissionCatalogDomains().flatMap((summary) =>
            summary.permissions.map((permission) => (
              <tr key={permission}>
                <td>
                  <code className="permissionCode">{permission}</code>
                </td>
                <td className="permissionCatalogDescription">
                  {t(permissionDescriptionKey(permission))}
                </td>
                <td>{t(permissionDomainKey(summary.domain))}</td>
                <td>{allowedPermissionScopesText(permission, t)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PermissionCheckboxTable({
  idPrefix,
  selectedPermissions,
  t
}: {
  idPrefix: string;
  selectedPermissions: readonly Permission[];
  t: Translator;
}): ReactNode {
  const selected = new Set(selectedPermissions);

  return (
    <div className="permissionEditorTableWrap">
      <table className="permissionEditorTable">
        <thead>
          <tr>
            <th aria-label={t("admin.roles.permissions")} />
            <th>{t("admin.roles.permission")}</th>
            <th>{t("admin.roles.domain")}</th>
            <th>{t("admin.roles.allowedScopesColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {summarizePermissionCatalogDomains().flatMap((summary) =>
            summary.permissions.map((permission) => {
              const inputId = permissionInputId(idPrefix, permission);

              return (
                <tr key={permission}>
                  <td>
                    <input
                      className="permissionEditorCheckbox"
                      defaultChecked={selected.has(permission)}
                      id={inputId}
                      name="permissions"
                      type="checkbox"
                      value={permission}
                    />
                  </td>
                  <td>
                    <label className="permissionEditorLabel" htmlFor={inputId}>
                      <code className="permissionCode">{permission}</code>
                    </label>
                  </td>
                  <td>{t(permissionDomainKey(summary.domain))}</td>
                  <td>{allowedPermissionScopesText(permission, t)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function permissionInputId(idPrefix: string, permission: Permission): string {
  return `${idPrefix}-${permission}`.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}
