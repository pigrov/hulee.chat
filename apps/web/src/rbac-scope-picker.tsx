"use client";

import type { PermissionScopeType } from "@hulee/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  resolveScopePickerState,
  type ScopeReferenceOptions
} from "./rbac-scope-picker-state";

type SelectOption = {
  readonly value: string;
  readonly label: string;
};

export type RoleAssignmentSubjectType = "employee" | "org_unit" | "queue";

export type RoleAssignmentSubject = {
  readonly type: RoleAssignmentSubjectType;
  readonly id: string;
};

export type RoleAssignmentSubjectOptions = Partial<
  Record<RoleAssignmentSubjectType, readonly SelectOption[]>
>;

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
  readonly subjectReference: string;
  readonly subjectType: string;
  readonly scopeType: string;
  readonly scopeReference: string;
  readonly scopeReferenceDescription: string;
  readonly scopeReferenceManualDescription: string;
  readonly scopeReferenceNotRequired: string;
  readonly scopeReferencePlaceholder: string;
  readonly scopeUnavailable: string;
  readonly selectEmployee: string;
  readonly selectPermission: string;
  readonly selectRole: string;
  readonly selectSubject: string;
  readonly subjectLabels: Record<RoleAssignmentSubjectType, string>;
  readonly scopeLabels: Record<PermissionScopeType, string>;
};

export function ScopePickerFields({
  allowedScopeTypes,
  disabled = false,
  messages,
  scopeReferenceOptions = {},
  unavailableMessage
}: {
  readonly allowedScopeTypes: readonly PermissionScopeType[];
  readonly disabled?: boolean;
  readonly messages: ScopePickerMessages;
  readonly scopeReferenceOptions?: ScopeReferenceOptions;
  readonly unavailableMessage?: string;
}): ReactNode {
  const [scopeType, setScopeType] = useState<PermissionScopeType>("tenant");
  const [scopeId, setScopeId] = useState("");
  const isDisabled = disabled || allowedScopeTypes.length === 0;
  const {
    referenceMode,
    referenceOptions: selectedReferenceOptions,
    requiresReference,
    selectedScopeType
  } = resolveScopePickerState({
    allowedScopeTypes,
    requestedScopeType: scopeType,
    scopeReferenceOptions
  });

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
      return;
    }

    if (
      requiresReference &&
      referenceMode === "select" &&
      scopeId.length > 0 &&
      !selectedReferenceOptions.some((option) => option.value === scopeId)
    ) {
      setScopeId("");
    }
  }, [referenceMode, requiresReference, scopeId, selectedReferenceOptions]);

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
        {referenceMode === "select" ? (
          <select
            className="selectInput"
            disabled={isDisabled || !requiresReference}
            name="scopeId"
            onChange={(event) => setScopeId(event.currentTarget.value)}
            required={requiresReference}
            value={scopeId}
          >
            <option value="">{messages.scopeReferencePlaceholder}</option>
            {selectedReferenceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="textInput"
            disabled={isDisabled || !requiresReference}
            name="scopeId"
            onChange={(event) => setScopeId(event.currentTarget.value)}
            placeholder={
              requiresReference
                ? messages.scopeReferencePlaceholder
                : messages.scopeReferenceNotRequired
            }
            required={requiresReference}
            type="text"
            value={scopeId}
          />
        )}
        <span className="metaText">
          {referenceMode === "manual"
            ? messages.scopeReferenceManualDescription
            : messages.scopeReferenceDescription}
        </span>
      </label>
    </div>
  );
}

export function RoleAssignmentFields({
  employees,
  messages,
  roles,
  scopeReferenceOptions,
  selectedEmployeeId,
  selectedSubject,
  subjectOptions
}: {
  readonly employees: readonly SelectOption[];
  readonly messages: ScopePickerMessages;
  readonly roles: readonly RoleAssignmentOption[];
  readonly scopeReferenceOptions?: ScopeReferenceOptions;
  readonly selectedEmployeeId?: string;
  readonly selectedSubject?: RoleAssignmentSubject;
  readonly subjectOptions?: RoleAssignmentSubjectOptions;
}): ReactNode {
  const [roleId, setRoleId] = useState("");
  const [subjectType, setSubjectType] =
    useState<RoleAssignmentSubjectType>("employee");
  const [subjectId, setSubjectId] = useState("");
  const selectedRole = useMemo(
    () => roles.find((role) => role.id === roleId),
    [roleId, roles]
  );
  const effectiveSelectedSubject =
    selectedSubject ??
    (selectedEmployeeId === undefined
      ? undefined
      : ({
          type: "employee",
          id: selectedEmployeeId
        } satisfies RoleAssignmentSubject));
  const effectiveSubjectOptions =
    subjectOptions ??
    ({
      employee: employees
    } satisfies RoleAssignmentSubjectOptions);
  const availableSubjectTypes = (
    ["employee", "org_unit", "queue"] as const
  ).filter((candidate) => (effectiveSubjectOptions[candidate] ?? []).length);
  const selectedSubjectType = availableSubjectTypes.includes(subjectType)
    ? subjectType
    : availableSubjectTypes[0];
  const selectedSubjectOptions =
    selectedSubjectType === undefined
      ? []
      : (effectiveSubjectOptions[selectedSubjectType] ?? []);
  const allowedScopeTypes = selectedRole?.allowedScopeTypes ?? [];

  useEffect(() => {
    if (
      selectedSubjectType !== undefined &&
      selectedSubjectType !== subjectType
    ) {
      setSubjectType(selectedSubjectType);
    }
  }, [selectedSubjectType, subjectType]);

  useEffect(() => {
    if (
      subjectId.length > 0 &&
      !selectedSubjectOptions.some((option) => option.value === subjectId)
    ) {
      setSubjectId("");
    }
  }, [selectedSubjectOptions, subjectId]);

  return (
    <>
      {effectiveSelectedSubject === undefined ? (
        <div className="roleSubjectGrid">
          <label className="fieldStack">
            <span className="detailLabel">{messages.subjectType}</span>
            <select
              className="selectInput"
              name="subjectType"
              onChange={(event) =>
                setSubjectType(
                  event.currentTarget.value as RoleAssignmentSubjectType
                )
              }
              required
              value={selectedSubjectType ?? ""}
            >
              {availableSubjectTypes.length === 0 ? (
                <option value="">{messages.selectSubject}</option>
              ) : null}
              {availableSubjectTypes.map((availableSubjectType) => (
                <option key={availableSubjectType} value={availableSubjectType}>
                  {messages.subjectLabels[availableSubjectType]}
                </option>
              ))}
            </select>
          </label>
          <label className="fieldStack">
            <span className="detailLabel">{messages.subjectReference}</span>
            <select
              className="selectInput"
              name="subjectId"
              onChange={(event) => setSubjectId(event.currentTarget.value)}
              required
              value={subjectId}
            >
              <option value="">{messages.selectSubject}</option>
              {selectedSubjectOptions.map((subjectOption) => (
                <option key={subjectOption.value} value={subjectOption.value}>
                  {subjectOption.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <>
          <input
            name="subjectType"
            type="hidden"
            value={effectiveSelectedSubject.type}
          />
          <input
            name="subjectId"
            type="hidden"
            value={effectiveSelectedSubject.id}
          />
        </>
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
        scopeReferenceOptions={scopeReferenceOptions}
      />
    </>
  );
}

export function DirectGrantFields({
  employees,
  messages,
  permissions,
  scopeReferenceOptions,
  selectedEmployeeId
}: {
  readonly employees: readonly SelectOption[];
  readonly messages: ScopePickerMessages;
  readonly permissions: readonly DirectGrantPermissionOption[];
  readonly scopeReferenceOptions?: ScopeReferenceOptions;
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
        scopeReferenceOptions={scopeReferenceOptions}
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
