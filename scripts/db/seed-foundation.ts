import { loadLocalEnvFile, mergeEnvSources } from "@hulee/config";
import {
  closeHuleeDatabase,
  createDrizzlePersistenceExecutor,
  createHuleeDatabase,
  createSqlLocalAuthRepository,
  createSqlTenantApiKeyRepository,
  createTenantRegistrationRepository
} from "@hulee/db";
import { createSequentialIdFactory, registerTenant } from "@hulee/core";
import { hashLocalPassword } from "@hulee/modules";

const localEnv = loadLocalEnvFile();
const env = mergeEnvSources(localEnv, process.env);
const seedConfig = {
  tenantSlug: env.HULEE_SEED_TENANT_SLUG ?? "local",
  tenantDisplayName: env.HULEE_SEED_TENANT_NAME ?? "Local Company",
  productName: env.HULEE_SEED_PRODUCT_NAME ?? "Hulee",
  adminEmail:
    env.HULEE_SEED_ADMIN_EMAIL ??
    env.HULEE_PLATFORM_ADMIN_USER ??
    "admin@example.com",
  apiKey: env.HULEE_SEED_API_KEY ?? "hulee-local-dev-key",
  apiKeyName: env.HULEE_SEED_API_KEY_NAME ?? "Local dev API key",
  platformAdminEmail: env.HULEE_PLATFORM_ADMIN_USER,
  platformAdminPassword: env.HULEE_PLATFORM_ADMIN_PASS,
  platformAdminDisplayName:
    env.HULEE_PLATFORM_ADMIN_DISPLAY_NAME ??
    env.HULEE_PLATFORM_ADMIN_USER ??
    "Platform Admin",
  idSeed: env.HULEE_SEED_ID_SEED ?? "local",
  now: env.HULEE_SEED_NOW ?? new Date().toISOString()
};

const database = createHuleeDatabase({
  connectionString: env.DATABASE_URL,
  logger: env.DATABASE_LOG === "true"
});

try {
  const registration = registerTenant({
    now: seedConfig.now,
    tenantSlug: seedConfig.tenantSlug,
    tenantDisplayName: seedConfig.tenantDisplayName,
    productName: seedConfig.productName,
    adminEmail: seedConfig.adminEmail,
    idFactory: createSequentialIdFactory(seedConfig.idSeed)
  });
  const platformAdminSeeded =
    seedConfig.platformAdminEmail !== undefined &&
    seedConfig.platformAdminPassword !== undefined &&
    seedConfig.platformAdminPassword.length > 0;
  const adminPasswordHash = platformAdminSeeded
    ? await hashLocalPassword(seedConfig.platformAdminPassword as string)
    : null;

  await createTenantRegistrationRepository(
    createDrizzlePersistenceExecutor(database)
  ).registerTenant({
    registration,
    adminPasswordHash
  });

  if (platformAdminSeeded) {
    await createSqlLocalAuthRepository(database).upsertPlatformAdminAccount({
      id: `platform_admin:${seedConfig.platformAdminEmail?.toLowerCase()}`,
      email: seedConfig.platformAdminEmail as string,
      displayName: seedConfig.platformAdminDisplayName,
      passwordHash: adminPasswordHash as string,
      updatedAt: new Date(seedConfig.now)
    });
  }

  await createSqlTenantApiKeyRepository(database).createApiKey({
    id: `api_key:${registration.tenant.id}:local`,
    tenantId: registration.tenant.id,
    name: seedConfig.apiKeyName,
    rawKey: seedConfig.apiKey,
    createdAt: new Date(seedConfig.now)
  });

  console.log(
    JSON.stringify(
      {
        seedKind: "clean-slate-foundation",
        tenantId: registration.tenant.id,
        tenantSlug: registration.tenant.slug,
        adminEmployeeId: registration.admin.id,
        adminEmail: registration.admin.email,
        apiKeyId: `api_key:${registration.tenant.id}:local`,
        apiKeyName: seedConfig.apiKeyName,
        apiKeySource:
          env.HULEE_SEED_API_KEY === undefined
            ? "default local dev key"
            : "HULEE_SEED_API_KEY",
        platformAdminSeeded,
        platformAdminEmail: seedConfig.platformAdminEmail,
        eventCount: registration.events.length
      },
      null,
      2
    )
  );
} finally {
  await closeHuleeDatabase(database);
}
