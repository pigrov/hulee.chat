import {
  closeHuleeDatabase,
  createDrizzlePersistenceExecutor,
  createHuleeDatabase,
  createSqlTenantApiKeyRepository,
  createTenantWorkspaceRepository
} from "@hulee/db";
import {
  createMvpTenantWorkspace,
  createSequentialIdFactory
} from "@hulee/core";

const seedConfig = {
  tenantSlug: process.env.HULEE_SEED_TENANT_SLUG ?? "local",
  tenantDisplayName: process.env.HULEE_SEED_TENANT_NAME ?? "Local Company",
  productName: process.env.HULEE_SEED_PRODUCT_NAME ?? "Hulee",
  adminEmail: process.env.HULEE_SEED_ADMIN_EMAIL ?? "admin@example.com",
  clientDisplayName: process.env.HULEE_SEED_CLIENT_NAME ?? "Seed Client",
  inboundText: process.env.HULEE_SEED_INBOUND_TEXT ?? "Seed inbound message",
  apiKey: process.env.HULEE_SEED_API_KEY ?? "hulee-local-dev-key",
  apiKeyName: process.env.HULEE_SEED_API_KEY_NAME ?? "Local dev API key",
  telegramChannelExternalId:
    process.env.HULEE_SEED_TELEGRAM_CHANNEL_EXTERNAL_ID ?? "telegram-local",
  telegramBotTokenSecretRef:
    process.env.HULEE_SEED_TELEGRAM_BOT_TOKEN_SECRET_REF ??
    "env:HULEE_TELEGRAM_BOT_TOKEN",
  telegramWebhookConnectorId:
    process.env.HULEE_SEED_TELEGRAM_WEBHOOK_CONNECTOR_ID ?? "tgwh_local",
  telegramWebhookSecretTokenSecretRef:
    process.env.HULEE_SEED_TELEGRAM_WEBHOOK_SECRET_TOKEN_SECRET_REF ??
    "secret:tenant_local_1/channel-telegram/webhook-secret-token",
  idSeed: process.env.HULEE_SEED_ID_SEED ?? "local",
  now: process.env.HULEE_SEED_NOW ?? new Date().toISOString()
};

const database = createHuleeDatabase({
  connectionString: process.env.DATABASE_URL,
  logger: process.env.DATABASE_LOG === "true"
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
          process.env.HULEE_SEED_API_KEY === undefined
            ? "default local dev key"
            : "HULEE_SEED_API_KEY",
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
