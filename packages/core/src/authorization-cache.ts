import type { EmployeeId, TenantId } from "@hulee/contracts";

import type { EffectivePermissionGrant } from "./access-control";

export type EffectiveAccessCacheVersion = string | number;

export type EffectiveAccessCacheKeyInput = {
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly roleBindingVersion: EffectiveAccessCacheVersion;
  readonly directGrantVersion: EffectiveAccessCacheVersion;
};

export type EffectiveAccessCacheInvalidationInput = {
  readonly tenantId?: TenantId;
  readonly employeeId?: EmployeeId;
};

export type EffectiveAccessCacheOptions = {
  readonly enabled?: boolean;
};

export type EffectiveAccessCache = {
  get(
    key: EffectiveAccessCacheKeyInput
  ): readonly EffectivePermissionGrant[] | undefined;
  set(
    key: EffectiveAccessCacheKeyInput,
    grants: readonly EffectivePermissionGrant[]
  ): void;
  getOrResolve(
    key: EffectiveAccessCacheKeyInput,
    resolver: () =>
      | readonly EffectivePermissionGrant[]
      | Promise<readonly EffectivePermissionGrant[]>
  ): Promise<readonly EffectivePermissionGrant[]>;
  invalidate(input?: EffectiveAccessCacheInvalidationInput): void;
  clear(): void;
};

type EffectiveAccessCacheEntry = {
  readonly key: EffectiveAccessCacheKeyInput;
  readonly grants: readonly EffectivePermissionGrant[];
};

export function buildEffectiveAccessCacheKey(
  input: EffectiveAccessCacheKeyInput
): string {
  return JSON.stringify([
    input.tenantId,
    input.employeeId,
    String(input.roleBindingVersion),
    String(input.directGrantVersion)
  ]);
}

export function createEffectiveAccessCache(
  options: EffectiveAccessCacheOptions = {}
): EffectiveAccessCache {
  const enabled = options.enabled ?? true;
  const entries = new Map<string, EffectiveAccessCacheEntry>();

  return {
    get(key) {
      if (!enabled) {
        return undefined;
      }

      return entries.get(buildEffectiveAccessCacheKey(key))?.grants;
    },

    set(key, grants) {
      if (!enabled) {
        return;
      }

      entries.set(buildEffectiveAccessCacheKey(key), {
        key,
        grants
      });
    },

    async getOrResolve(key, resolver) {
      const cached = this.get(key);

      if (cached !== undefined) {
        return cached;
      }

      const grants = await resolver();
      this.set(key, grants);

      return grants;
    },

    invalidate(input = {}) {
      if (!enabled) {
        return;
      }

      for (const [cacheKey, entry] of entries) {
        if (shouldInvalidateEntry(entry, input)) {
          entries.delete(cacheKey);
        }
      }
    },

    clear() {
      entries.clear();
    }
  };
}

function shouldInvalidateEntry(
  entry: EffectiveAccessCacheEntry,
  input: EffectiveAccessCacheInvalidationInput
): boolean {
  if (input.tenantId === undefined && input.employeeId === undefined) {
    return true;
  }

  if (input.tenantId !== undefined && entry.key.tenantId !== input.tenantId) {
    return false;
  }

  if (
    input.employeeId !== undefined &&
    entry.key.employeeId !== input.employeeId
  ) {
    return false;
  }

  return true;
}
