import type {
  ChannelConnectorId,
  InternalChannelConnectorSummary,
  InternalTelegramIntegrationConfig,
  InternalTelegramIntegrationResponse,
  TenantId
} from "@hulee/contracts";
import {
  internalChannelConnectorSummarySchema,
  internalEgressDiagnosticsSchema,
  internalTelegramIntegrationConfigSchema,
  internalTelegramIntegrationDiagnosticsSchema,
  internalTelegramIntegrationResponseSchema
} from "@hulee/contracts";
import {
  createSqlChannelConnectorRepository,
  createSqlEmployeeDirectoryRepository,
  type ChannelConnectorRecord,
  type HuleeDatabase,
  type TenantEmployeeRecord
} from "@hulee/db";
import { sql } from "drizzle-orm";

export type PlatformCompanySnapshot = {
  readonly tenantId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly deploymentType: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type PlatformCompanyChannelConnector =
  InternalChannelConnectorSummary & {
    readonly createdAt: string;
    readonly updatedAt: string;
  };

export type PlatformCompanyDetails = {
  readonly tenant: PlatformCompanySnapshot;
  readonly employees: readonly TenantEmployeeRecord[];
  readonly connectors: readonly PlatformCompanyChannelConnector[];
};

export type PlatformCompanyChannelDetails = {
  readonly tenant: PlatformCompanySnapshot;
  readonly connector: PlatformCompanyChannelConnector;
  readonly telegramIntegration?: InternalTelegramIntegrationResponse;
};

type PlatformTenantRowRecord = {
  readonly tenant_id: string;
  readonly slug: string;
  readonly display_name: string;
  readonly deployment_type: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
};

export async function loadPlatformCompanyDetails(input: {
  database: HuleeDatabase;
  tenantId: string;
}): Promise<PlatformCompanyDetails | null> {
  const tenant = await loadPlatformCompanySnapshot(input);

  if (!tenant) {
    return null;
  }

  const employeeRepository = createSqlEmployeeDirectoryRepository(
    input.database
  );
  const connectorRepository = createSqlChannelConnectorRepository(
    input.database
  );
  const [employees, connectorRecords] = await Promise.all([
    employeeRepository.listEmployees({
      tenantId: tenant.tenantId as TenantId
    }),
    connectorRepository.listTenantConnectors({
      tenantId: tenant.tenantId as TenantId
    })
  ]);

  return {
    tenant,
    employees,
    connectors: connectorRecords.flatMap((record) => {
      const connector = platformChannelConnectorFromRecord(record);

      return connector ? [connector] : [];
    })
  };
}

export async function loadPlatformCompanyChannelDetails(input: {
  database: HuleeDatabase;
  publicWebhookBaseUrl?: string;
  tenantId: string;
  connectorId: string;
}): Promise<PlatformCompanyChannelDetails | null> {
  const tenant = await loadPlatformCompanySnapshot(input);

  if (!tenant) {
    return null;
  }

  const connectorRepository = createSqlChannelConnectorRepository(
    input.database
  );
  const record = await connectorRepository.findConnector({
    tenantId: tenant.tenantId as TenantId,
    connectorId: input.connectorId as ChannelConnectorId
  });

  if (!record) {
    return null;
  }

  const connector = platformChannelConnectorFromRecord(record);

  if (!connector) {
    return null;
  }

  const telegramIntegration = platformTelegramIntegrationFromRecord({
    publicWebhookBaseUrl: input.publicWebhookBaseUrl,
    record
  });

  return {
    tenant,
    connector,
    ...(telegramIntegration ? { telegramIntegration } : {})
  };
}

export function platformChannelConnectorFromRecord(
  record: ChannelConnectorRecord
): PlatformCompanyChannelConnector | null {
  const channelExternalId = readRecordString(
    record.config,
    "channelExternalId"
  );
  const diagnosticsStatus = readRecordString(record.diagnostics, "status");
  const egress = readRecordEgressDiagnostics(record.diagnostics);
  const result = internalChannelConnectorSummarySchema.safeParse({
    connectorId: record.id,
    channelType: record.channelType,
    channelClass: record.channelClass,
    provider: record.provider,
    displayName: record.displayName,
    status: record.status,
    healthStatus: record.healthStatus,
    ...(channelExternalId ? { channelExternalId } : {}),
    ...(diagnosticsStatus ? { diagnosticsStatus } : {}),
    ...(egress ? { egress } : {})
  });

  if (!result.success) {
    return null;
  }

  return {
    ...result.data,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export function platformTelegramIntegrationFromRecord(input: {
  publicWebhookBaseUrl?: string;
  record: ChannelConnectorRecord;
}): InternalTelegramIntegrationResponse | null {
  if (
    input.record.channelType !== "telegram_bot" ||
    input.record.channelClass !== "bot_bridge"
  ) {
    return null;
  }

  const diagnosticsResult =
    internalTelegramIntegrationDiagnosticsSchema.safeParse(
      input.record.diagnostics
    );

  if (!diagnosticsResult.success) {
    return null;
  }

  const configResult = internalTelegramIntegrationConfigSchema.safeParse(
    input.record.config
  );
  const config = configResult.success ? configResult.data : undefined;
  const webhookPath = config ? buildTelegramWebhookPath(config) : undefined;
  const response = internalTelegramIntegrationResponseSchema.safeParse({
    moduleId: "channel-telegram",
    connectorId: input.record.id,
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    displayName: input.record.displayName,
    status: input.record.status,
    enabled:
      input.record.status !== "disabled" && input.record.status !== "deleted",
    ...(config ? { config } : {}),
    ...(webhookPath ? { webhookPath } : {}),
    ...(webhookPath && input.publicWebhookBaseUrl
      ? {
          publicWebhookUrl: buildTelegramPublicWebhookUrl({
            publicWebhookBaseUrl: input.publicWebhookBaseUrl,
            webhookPath
          })
        }
      : {}),
    diagnostics: diagnosticsResult.data
  });

  return response.success ? response.data : null;
}

async function loadPlatformCompanySnapshot(input: {
  database: HuleeDatabase;
  tenantId: string;
}): Promise<PlatformCompanySnapshot | null> {
  const result = await input.database.execute<PlatformTenantRowRecord>(sql`
    select id as tenant_id,
           slug,
           display_name,
           deployment_type,
           created_at,
           updated_at
    from tenants
    where id = ${input.tenantId}
    limit 1
  `);
  const row = result.rows[0];

  return row ? platformCompanySnapshotFromRow(row) : null;
}

function platformCompanySnapshotFromRow(
  row: PlatformTenantRowRecord
): PlatformCompanySnapshot {
  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    displayName: row.display_name,
    deploymentType: row.deployment_type,
    createdAt: dateLikeToIsoString(row.created_at),
    updatedAt: dateLikeToIsoString(row.updated_at)
  };
}

function buildTelegramWebhookPath(
  config: Pick<
    InternalTelegramIntegrationConfig,
    "channelExternalId" | "webhookConnectorId"
  >
): string {
  const connectorId = config.webhookConnectorId ?? config.channelExternalId;

  return `/webhooks/telegram/${encodeURIComponent(connectorId)}`;
}

function buildTelegramPublicWebhookUrl(input: {
  publicWebhookBaseUrl: string;
  webhookPath: string;
}): string {
  return new URL(input.webhookPath, input.publicWebhookBaseUrl).toString();
}

function readRecordString(input: unknown, key: string): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const value = input[key];

  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readRecordEgressDiagnostics(
  input: unknown
): InternalChannelConnectorSummary["egress"] | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const result = internalEgressDiagnosticsSchema.safeParse(input.egress);

  return result.success ? result.data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateLikeToIsoString(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
