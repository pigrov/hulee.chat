"use client";

import {
  permissionScopeRequiresReference,
  type PermissionScopeType
} from "@hulee/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type SelectOption = {
  readonly value: string;
  readonly label: string;
};

export type RoleAssignmentOption = {
  readonly id: string;
  readonly label: string;
  readonly allowedScopeTypes: readonly PermissionScopeType[];
};

export type ScopePickerMessages = {
  readonly employee: string;
  readonly role: string;
  readonly scopeType: string;
  readonly scopeReference: string;
  readonly scopeReferenceDescription: string;
  readonly scopeReferencePlaceholder: string;
  readonly scopeUnavailable: string;
  readonly selectEmployee: string;
  readonly selectRole: string;
  readonly scopeLabels: Record<PermissionScopeType, string>;
};

export function RoleAssignmentFields({
  employees,
  messages,
  roles
}: {
  readonly employees: readonly SelectOption[];
  readonly messages: ScopePickerMessages;
  readonly roles: readonly RoleAssignmentOption[];
}): ReactNode {
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<PermissionScopeType>("tenant");
  const [scopeId, setScopeId] = useState("");
  const selectedRole = useMemo(
    () => roles.find((role) => role.id === roleId),
    [roleId, roles]
  );
  const allowedScopeTypes = selectedRole?.allowedScopeTypes ?? [];
  const selectedScopeType = allowedScopeTypes.includes(scopeType)
    ? scopeType
    : allowedScopeTypes[0];
  const requiresReference =
    selectedScopeType !== undefined &&
    permissionScopeRequiresReference(selectedScopeType);

  useEffect(() => {
    if (selectedScopeType === undefined) {
      return;
    }

    if (selectedScopeType !== scopeType) {
      setScopeType(selectedScopeType);
    }
  }, [scopeType, selectedScopeType]);

  useEffect(() => {
    if (!requiresReference && scopeId.length > 0) {
      setScopeId("");
    }
  }, [requiresReference, scopeId]);

  return (
    <>
      <label className="fieldStack">
        <span className="detailLabel">{messages.employee}</span>
        <select className="selectInput" name="employeeId" required>
          <option value="">{messages.selectEmployee}</option>
          {employees.map((employee) => (
            <option key={employee.value} value={employee.value}>
              {employee.label}
            </option>
          ))}
        </select>
      </label>
      <label className="fieldStack">
        <span className="detailLabel">{messages.role}</span>
        <select
          className="selectInput"
          name="roleId"
          onChange={(event) => setRoleId(event.currentTarget.value)}
          required
          value={roleId}
        >
          <option value="">{messages.selectRole}</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.label}
            </option>
          ))}
        </select>
      </label>
      <div className="scopePickerGrid">
        <label className="fieldStack">
          <span className="detailLabel">{messages.scopeType}</span>
          <select
            className="selectInput"
            disabled={allowedScopeTypes.length === 0}
            name="scopeType"
            onChange={(event) =>
              setScopeType(event.currentTarget.value as PermissionScopeType)
            }
            required
            value={selectedScopeType ?? ""}
          >
            {allowedScopeTypes.length === 0 ? (
              <option value="">{messages.scopeUnavailable}</option>
            ) : null}
            {allowedScopeTypes.map((allowedScopeType) => (
              <option key={allowedScopeType} value={allowedScopeType}>
                {messages.scopeLabels[allowedScopeType]}
              </option>
            ))}
          </select>
        </label>
        <label className="fieldStack">
          <span className="detailLabel">{messages.scopeReference}</span>
          <input
            className="textInput"
            disabled={!requiresReference}
            name="scopeId"
            onChange={(event) => setScopeId(event.currentTarget.value)}
            placeholder={messages.scopeReferencePlaceholder}
            required={requiresReference}
            type="text"
            value={scopeId}
          />
          <span className="metaText">{messages.scopeReferenceDescription}</span>
        </label>
      </div>
    </>
  );
}
