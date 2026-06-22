import { loadLocalEnvFile, mergeEnvSources } from "@hulee/config";
import {
  closeHuleeDatabase,
  createDrizzlePersistenceExecutor,
  createHuleeDatabase,
  createSqlLocalAuthRepository,
  createSqlTenantApiKeyRepository,
  createTenantWorkspaceRepository
} from "@hulee/db";
import {
  createMvpTenantWorkspace,
  createSequentialIdFactory
} from "@hulee/core";
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
  clientDisplayName: env.HULEE_SEED_CLIENT_NAME ?? "Seed Client",
  inboundText: env.HULEE_SEED_INBOUND_TEXT ?? "Seed inbound message",
  apiKey: env.HULEE_SEED_API_KEY ?? "hulee-local-dev-key",
  apiKeyName: env.HULEE_SEED_API_KEY_NAME ?? "Local dev API key",
  telegramChannelExternalId:
    env.HULEE_SEED_TELEGRAM_CHANNEL_EXTERNAL_ID ?? "telegram-local",
  telegramBotTokenSecretRef:
    env.HULEE_SEED_TELEGRAM_BOT_TOKEN_SECRET_REF ??
    "env:HULEE_TELEGRAM_BOT_TOKEN",
  telegramWebhookConnectorId:
    env.HULEE_SEED_TELEGRAM_WEBHOOK_CONNECTOR_ID ?? "tgwh_local",
  telegramWebhookSecretTokenSecretRef:
    env.HULEE_SEED_TELEGRAM_WEBHOOK_SECRET_TOKEN_SECRET_REF ??
    "secret:tenant_local_1/channel-telegram/webhook-secret-token",
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
  const repository = createTenantWorkspaceRepository(
    createDrizzlePersistenceExecutor(database)
  );
  const workspace = createMvpTenantWorkspace({
    now: seedConfig.now,
    tenantSlug: seedConfig.tenantSlug,
    tenantDisplayName: seedConfig.tenantDisplayName,
    productName: seedConfig.productName,
    adminEmail: seedConfig.adminEmail,
    clientDisplayName: seedConfig.clientDisplayName,
    inboundText: seedConfig.inboundText,
    moduleConfigs: {
      "channel-telegram": {
        channelExternalId: seedConfig.telegramChannelExternalId,
        mode: "webhook",
        botTokenSecretRef: seedConfig.telegramBotTokenSecretRef,
        webhookConnectorId: seedConfig.telegramWebhookConnectorId,
        webhookSecretTokenSecretRef:
          seedConfig.telegramWebhookSecretTokenSecretRef,
        outboundEnabled: true
      }
    },
    idFactory: createSequentialIdFactory(seedConfig.idSeed)
  });

  await repository.saveWorkspace(workspace);
  const authRepository = createSqlLocalAuthRepository(database);
  const platformAdminSeeded =
    seedConfig.platformAdminEmail !== undefined &&
    seedConfig.platformAdminPassword !== undefined &&
    seedConfig.platformAdminPassword.length > 0;

  if (platformAdminSeeded) {
    const passwordHash = await hashLocalPassword(
      seedConfig.platformAdminPassword
    );

    await authRepository.upsertTenantAdminAccount({
      accountId: `account:${workspace.admin.id}`,
      employeeId: workspace.admin.id,
      tenantId: workspace.tenant.id,
      email: seedConfig.adminEmail,
      displayName: seedConfig.adminEmail,
      passwordHash,
      updatedAt: new Date(seedConfig.now)
    });
    await authRepository.upsertPlatformAdminAccount({
      id: `platform_admin:${seedConfig.platformAdminEmail.toLowerCase()}`,
      email: seedConfig.platformAdminEmail,
      displayName: seedConfig.platformAdminDisplayName,
      passwordHash,
      updatedAt: new Date(seedConfig.now)
    });
  }

  await createSqlTenantApiKeyRepository(database).createApiKey({
    id: `api_key:${workspace.tenant.id}:local`,
    tenantId: workspace.tenant.id,
    name: seedConfig.apiKeyName,
    rawKey: seedConfig.apiKey,
    createdAt: new Date(seedConfig.now)
  });

  console.log(
    JSON.stringify(
      {
        tenantId: workspace.tenant.id,
        tenantSlug: workspace.tenant.slug,
        adminEmployeeId: workspace.admin.id,
        adminEmail: workspace.admin.email,
        apiKeyId: `api_key:${workspace.tenant.id}:local`,
        apiKeyName: seedConfig.apiKeyName,
        apiKeySource:
          env.HULEE_SEED_API_KEY === undefined
            ? "default local dev key"
            : "HULEE_SEED_API_KEY",
        platformAdminSeeded,
        platformAdminEmail: seedConfig.platformAdminEmail,
        conversationId: workspace.conversation.id,
        inboundMessageId: workspace.inboundMessage.id,
        telegramChannelExternalId: seedConfig.telegramChannelExternalId,
        telegramBotTokenSecretRef: seedConfig.telegramBotTokenSecretRef,
        telegramWebhookConnectorId: seedConfig.telegramWebhookConnectorId,
        telegramWebhookSecretTokenSecretRef:
          seedConfig.telegramWebhookSecretTokenSecretRef,
        eventCount: workspace.events.length
      },
      null,
      2
    )
  );
} finally {
  await closeHuleeDatabase(database);
}
