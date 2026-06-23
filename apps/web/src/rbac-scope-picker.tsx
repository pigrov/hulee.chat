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

export type DirectGrantPermissionOption = {
  readonly id: string;
  readonly label: string;
  readonly allowedScopeTypes: readonly PermissionScopeType[];
};

export type ScopePickerMessages = {
  readonly employee: string;
  readonly expiresAt: string;
  readonly permission: string;
  readonly reason: string;
  readonly reasonPlaceholder: string;
  readonly role: string;
  readonly scopeType: string;
  readonly scopeReference: string;
  readonly scopeReferenceDescription: string;
  readonly scopeReferencePlaceholder: string;
  readonly scopeUnavailable: string;
  readonly selectEmployee: string;
  readonly selectPermission: string;
  readonly selectRole: string;
  readonly scopeLabels: Record<PermissionScopeType, string>;
};

export function ScopePickerFields({
  allowedScopeTypes,
  disabled = false,
  messages,
  unavailableMessage
}: {
  readonly allowedScopeTypes: readonly PermissionScopeType[];
  readonly disabled?: boolean;
  readonly messages: ScopePickerMessages;
  readonly unavailableMessage?: string;
}): ReactNode {
  const [scopeType, setScopeType] = useState<PermissionScopeType>("tenant");
  const [scopeId, setScopeId] = useState("");
  const selectedScopeType = allowedScopeTypes.includes(scopeType)
    ? scopeType
    : allowedScopeTypes[0];
  const isDisabled = disabled || allowedScopeTypes.length === 0;
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
    <div className="scopePickerGrid">
      <label className="fieldStack">
        <span className="detailLabel">{messages.scopeType}</span>
        <select
          className="selectInput"
          disabled={isDisabled}
          name="scopeType"
          onChange={(event) =>
            setScopeType(event.currentTarget.value as PermissionScopeType)
          }
          required
          value={selectedScopeType ?? ""}
        >
          {allowedScopeTypes.length === 0 ? (
            <option value="">
              {unavailableMessage ?? messages.scopeUnavailable}
            </option>
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
          disabled={isDisabled || !requiresReference}
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
  );
}

export function RoleAssignmentFields({
  employees,
  messages,
  roles,
  selectedEmployeeId
}: {
  readonly employees: readonly SelectOption[];
  readonly messages: ScopePickerMessages;
  readonly roles: readonly RoleAssignmentOption[];
  readonly selectedEmployeeId?: string;
}): ReactNode {
  const [roleId, setRoleId] = useState("");
  const selectedRole = useMemo(
    () => roles.find((role) => role.id === roleId),
    [roleId, roles]
  );
  const allowedScopeTypes = selectedRole?.allowedScopeTypes ?? [];

  return (
    <>
      {selectedEmployeeId === undefined ? (
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
      ) : (
        <input name="employeeId" type="hidden" value={selectedEmployeeId} />
      )}
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
      <ScopePickerFields
        allowedScopeTypes={allowedScopeTypes}
        disabled={selectedRole === undefined}
        messages={messages}
      />
    </>
  );
}

export function DirectGrantFields({
  employees,
  messages,
  permissions,
  selectedEmployeeId
}: {
  readonly employees: readonly SelectOption[];
  readonly messages: ScopePickerMessages;
  readonly permissions: readonly DirectGrantPermissionOption[];
  readonly selectedEmployeeId?: string;
}): ReactNode {
  const [permissionId, setPermissionId] = useState("");
  const selectedPermission = useMemo(
    () => permissions.find((permission) => permission.id === permissionId),
    [permissionId, permissions]
  );
  const allowedScopeTypes = selectedPermission?.allowedScopeTypes ?? [];

  return (
    <>
      {selectedEmployeeId === undefined ? (
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
      ) : (
        <input name="employeeId" type="hidden" value={selectedEmployeeId} />
      )}
      <label className="fieldStack">
        <span className="detailLabel">{messages.permission}</span>
        <select
          className="selectInput"
          name="permission"
          onChange={(event) => setPermissionId(event.currentTarget.value)}
          required
          value={permissionId}
        >
          <option value="">{messages.selectPermission}</option>
          {permissions.map((permission) => (
            <option key={permission.id} value={permission.id}>
              {permission.label}
            </option>
          ))}
        </select>
      </label>
      <ScopePickerFields
        allowedScopeTypes={allowedScopeTypes}
        disabled={selectedPermission === undefined}
        messages={messages}
        unavailableMessage={messages.selectPermission}
      />
      <label className="fieldStack">
        <span className="detailLabel">{messages.reason}</span>
        <textarea
          className="textInput directGrantReasonInput"
          maxLength={500}
          name="reason"
          placeholder={messages.reasonPlaceholder}
          required
        />
      </label>
      <label className="fieldStack">
        <span className="detailLabel">{messages.expiresAt}</span>
        <input className="textInput" name="expiresAt" type="datetime-local" />
      </label>
    </>
  );
}
