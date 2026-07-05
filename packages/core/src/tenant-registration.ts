import type { BrandProfile } from "@hulee/branding";
import { normalizeEmailAddress } from "@hulee/contact-identity";
import type { PlatformEvent } from "@hulee/contracts";
import { evaluateEntitlement, type LicenseSnapshot } from "@hulee/entitlements";

import { createDomainEvent } from "./domain-events";
import { CoreError } from "./errors";
import { createSequentialIdFactory, type IdFactory } from "./ids";
import type { Employee } from "./permissions";
import type { ModuleConfigMap, Tenant } from "./vertical-slice";

export type RegisterTenantInput = {
  now: string;
  tenantSlug: string;
  tenantDisplayName: string;
  productName: string;
  adminEmail: string;
  adminDisplayName?: string;
  enabledModules?: readonly string[];
  moduleConfigs?: ModuleConfigMap;
  idFactory?: IdFactory;
};

export type RegisteredTenant = {
  tenant: Tenant;
  brandProfile: BrandProfile;
  license: LicenseSnapshot;
  admin: Employee;
  events: readonly PlatformEvent[];
};

const defaultRegistrationModules = [
  "auth-local",
  "channel-public-api",
  "channel-telegram",
  "storage-s3",
  "license-basic"
] as const;

export function registerTenant(input: RegisterTenantInput): RegisteredTenant {
  const tenantSlug = normalizeTenantSlug(input.tenantSlug);
  const adminEmail = normalizeEmail(input.adminEmail);
  const ids = input.idFactory ?? createSequentialIdFactory(tenantSlug);
  const enabledModules = input.enabledModules ?? defaultRegistrationModules;
  const tenantId = ids.tenantId();
  const tenant: Tenant = {
    id: tenantId,
    tenantId,
    slug: tenantSlug,
    displayName: requireNonEmpty(input.tenantDisplayName, "tenantDisplayName"),
    locale: "ru",
    timezone: "Europe/Moscow",
    createdAt: input.now,
    enabledModules,
    moduleConfigs: input.moduleConfigs
  };
  const brandProfile = createTenantBrandProfile({
    tenant,
    productName: requireNonEmpty(input.productName, "productName"),
    id: ids.stringId("brand")
  });
  const license = createLocalLicenseSnapshot({
    tenant,
    enabledModules,
    id: ids.stringId("license"),
    now: input.now
  });

  assertModuleAvailable({
    license,
    now: input.now,
    moduleId: "auth-local"
  });

  const admin: Employee = {
    id: ids.employeeId(),
    tenantId,
    email: adminEmail,
    displayName: input.adminDisplayName?.trim() || adminEmail,
    systemRoleTemplateIds: ["tenant_admin"],
    createdAt: input.now
  };
  const events: PlatformEvent[] = [
    createDomainEvent({
      id: ids.eventId("tenant.created"),
      type: "tenant.created",
      tenantId,
      occurredAt: input.now,
      payload: { tenantId }
    }),
    createDomainEvent({
      id: ids.eventId("employee.created"),
      type: "employee.created",
      tenantId,
      occurredAt: input.now,
      payload: { employeeId: admin.id }
    })
  ];

  return {
    tenant,
    brandProfile,
    license,
    admin,
    events
  };
}

function createTenantBrandProfile(input: {
  tenant: Tenant;
  productName: string;
  id: string;
}): BrandProfile {
  return {
    id: input.id,
    scope: "tenant",
    tenantId: input.tenant.id,
    productName: input.productName,
    shortProductName: input.productName,
    assets: {},
    themeTokens: {}
  };
}

function createLocalLicenseSnapshot(input: {
  tenant: Tenant;
  enabledModules: readonly string[];
  id: string;
  now: string;
}): LicenseSnapshot {
  return {
    licenseId: input.id,
    customerId: input.tenant.id,
    deploymentId: "local-data-plane",
    validFrom: input.now,
    issuer: "local-registration",
    entitlements: input.enabledModules.map((moduleId) => {
      return {
        key: "module.enabled",
        value: moduleId,
        enabled: true
      };
    })
  };
}

function assertModuleAvailable(input: {
  license: LicenseSnapshot;
  now: string;
  moduleId: string;
}): void {
  const decision = evaluateEntitlement(
    {
      license: input.license,
      now: new Date(input.now)
    },
    "module.enabled",
    input.moduleId
  );

  if (decision.allowed) {
    return;
  }

  if (decision.code === "license.inactive") {
    throw new CoreError("license.inactive");
  }

  throw new CoreError("module.disabled");
}

function normalizeTenantSlug(value: string): string {
  const slug = value.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new CoreError("validation.failed", "Invalid tenant slug.");
  }

  return slug;
}

function normalizeEmail(value: string): string {
  try {
    return normalizeEmailAddress(value);
  } catch {
    throw new CoreError("validation.failed", "Invalid admin email.");
  }
}

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new CoreError("validation.failed", `${name} must not be empty.`);
  }

  return trimmed;
}
