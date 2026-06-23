import { CoreError } from "./errors";
import { isPermission, type Permission } from "./permissions";

export type PrepareCustomTenantRoleInput = {
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly string[];
};

export type PreparedCustomTenantRole = {
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly Permission[];
};

const maxRoleNameLength = 80;
const maxRoleDescriptionLength = 500;

export function prepareCustomTenantRole(
  input: PrepareCustomTenantRoleInput
): PreparedCustomTenantRole {
  const name = normalizeRequiredText(input.name, maxRoleNameLength);
  const description = normalizeOptionalText(
    input.description,
    maxRoleDescriptionLength
  );
  const permissions = normalizePermissions(input.permissions);

  return {
    name,
    description,
    permissions
  };
}

function normalizeRequiredText(value: string, maxLength: number): string {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new CoreError("validation.failed");
  }

  return normalized;
}

function normalizeOptionalText(
  value: string | undefined,
  maxLength: number
): string | undefined {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw new CoreError("validation.failed");
  }

  return normalized;
}

function normalizePermissions(
  values: readonly string[]
): readonly Permission[] {
  const result = new Set<Permission>();

  for (const value of values) {
    if (!isPermission(value)) {
      throw new CoreError("validation.failed");
    }

    result.add(value);
  }

  if (result.size === 0) {
    throw new CoreError("validation.failed");
  }

  return [...result];
}
