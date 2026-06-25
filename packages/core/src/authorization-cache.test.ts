import type { EmployeeId, TenantId } from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import type { EffectivePermissionGrant } from "./access-control";
import {
  buildEffectiveAccessCacheKey,
  createEffectiveAccessCache
} from "./authorization-cache";

const tenantId = "tenant-1" as TenantId;
const otherTenantId = "tenant-2" as TenantId;
const employeeId = "employee-1" as EmployeeId;
const otherEmployeeId = "employee-2" as EmployeeId;

describe("effective access cache", () => {
  it("builds stable keys from tenant, employee and access versions", () => {
    expect(
      buildEffectiveAccessCacheKey({
        tenantId,
        employeeId,
        roleBindingVersion: 12,
        directGrantVersion: "grant-v4"
      })
    ).toBe(
      buildEffectiveAccessCacheKey({
        tenantId,
        employeeId,
        roleBindingVersion: "12",
        directGrantVersion: "grant-v4"
      })
    );
  });

  it("returns cached effective grants for the same access versions", async () => {
    const cache = createEffectiveAccessCache();
    const resolver = vi.fn(async () => [grant("message.reply")]);
    const key = cacheKey();

    await expect(cache.getOrResolve(key, resolver)).resolves.toEqual([
      grant("message.reply")
    ]);
    await expect(cache.getOrResolve(key, resolver)).resolves.toEqual([
      grant("message.reply")
    ]);

    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("misses cache when role binding or direct grant versions change", async () => {
    const cache = createEffectiveAccessCache();
    const resolver = vi.fn(async () => [grant("message.reply")]);

    await cache.getOrResolve(cacheKey({ roleBindingVersion: 1 }), resolver);
    await cache.getOrResolve(cacheKey({ roleBindingVersion: 2 }), resolver);
    await cache.getOrResolve(cacheKey({ directGrantVersion: 2 }), resolver);

    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it("can be disabled for tests or deployments without cache invalidation", async () => {
    const cache = createEffectiveAccessCache({ enabled: false });
    const resolver = vi.fn(async () => [grant("message.reply")]);
    const key = cacheKey();

    cache.set(key, [grant("inbox.read")]);

    await cache.getOrResolve(key, resolver);
    await cache.getOrResolve(key, resolver);

    expect(cache.get(key)).toBeUndefined();
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("invalidates all entries affected by role or grant mutations", async () => {
    const cache = createEffectiveAccessCache();
    const firstResolver = vi.fn(async () => [grant("message.reply")]);
    const secondResolver = vi.fn(async () => [grant("inbox.read")]);
    const otherTenantResolver = vi.fn(async () => [grant("client.view")]);

    await cache.getOrResolve(cacheKey(), firstResolver);
    await cache.getOrResolve(
      cacheKey({ employeeId: otherEmployeeId }),
      secondResolver
    );
    await cache.getOrResolve(
      cacheKey({ tenantId: otherTenantId }),
      otherTenantResolver
    );

    cache.invalidate({ tenantId, employeeId });

    await cache.getOrResolve(cacheKey(), firstResolver);
    await cache.getOrResolve(
      cacheKey({ employeeId: otherEmployeeId }),
      secondResolver
    );
    await cache.getOrResolve(
      cacheKey({ tenantId: otherTenantId }),
      otherTenantResolver
    );

    expect(firstResolver).toHaveBeenCalledTimes(2);
    expect(secondResolver).toHaveBeenCalledTimes(1);
    expect(otherTenantResolver).toHaveBeenCalledTimes(1);
  });
});

function cacheKey(
  overrides: Partial<Parameters<typeof buildEffectiveAccessCacheKey>[0]> = {}
): Parameters<typeof buildEffectiveAccessCacheKey>[0] {
  return {
    tenantId,
    employeeId,
    roleBindingVersion: 1,
    directGrantVersion: 1,
    ...overrides
  };
}

function grant(
  permission: EffectivePermissionGrant["permission"]
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId,
    permission,
    scope: {
      type: "tenant"
    },
    sources: []
  };
}
