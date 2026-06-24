import {
  permissionScopeRequiresReference,
  type PermissionScopeType
} from "@hulee/core";

export type ScopeReferenceOption = {
  readonly value: string;
  readonly label: string;
};

export type ScopeReferenceOptions = Partial<
  Record<PermissionScopeType, readonly ScopeReferenceOption[]>
>;

export type ScopeReferenceMode = "none" | "select" | "manual";

export type ResolvedScopePickerState = {
  readonly selectedScopeType?: PermissionScopeType;
  readonly requiresReference: boolean;
  readonly referenceMode: ScopeReferenceMode;
  readonly referenceOptions: readonly ScopeReferenceOption[];
};

export function resolveScopePickerState(input: {
  readonly allowedScopeTypes: readonly PermissionScopeType[];
  readonly requestedScopeType: PermissionScopeType;
  readonly scopeReferenceOptions?: ScopeReferenceOptions;
}): ResolvedScopePickerState {
  const selectedScopeType = input.allowedScopeTypes.includes(
    input.requestedScopeType
  )
    ? input.requestedScopeType
    : input.allowedScopeTypes[0];

  if (selectedScopeType === undefined) {
    return {
      selectedScopeType: undefined,
      requiresReference: false,
      referenceMode: "none",
      referenceOptions: []
    };
  }

  const requiresReference = permissionScopeRequiresReference(selectedScopeType);
  const referenceOptions =
    input.scopeReferenceOptions?.[selectedScopeType] ?? [];

  return {
    selectedScopeType,
    requiresReference,
    referenceMode: resolveScopeReferenceMode({
      referenceOptions,
      requiresReference
    }),
    referenceOptions
  };
}

function resolveScopeReferenceMode(input: {
  readonly referenceOptions: readonly ScopeReferenceOption[];
  readonly requiresReference: boolean;
}): ScopeReferenceMode {
  if (!input.requiresReference) {
    return "none";
  }

  return input.referenceOptions.length > 0 ? "select" : "manual";
}
