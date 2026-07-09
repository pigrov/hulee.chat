import {
  normalizeSourceCapabilities,
  type SourceConnectionStatus
} from "@hulee/contracts";
import type {
  ChannelConnectorRecord,
  ChannelSessionRecord,
  SourceIntegrationRepository
} from "@hulee/db";
import { createHash } from "node:crypto";

const directAccountCapabilities = normalizeSourceCapabilities({
  canReceive: true,
  canReply: true,
  canFetchHistory: true,
  canSendFiles: true,
  canReceiveFiles: true,
  supportsThreads: true,
  supportsReactions: true,
  supportsReadStatus: true,
  supportsDeliveryStatus: true,
  webhookSupported: false,
  pollingRequired: false,
  customerProfile: true,
  rateLimitsKnown: false,
  oauthSupported: false,
  sandboxAvailable: false,
  legalRisk: "high"
});

export type DirectAccountSourceSyncInput = {
  sourceRepository?: SourceIntegrationRepository;
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  status: SourceConnectionStatus;
  checkedAt: Date;
  externalAccountId?: string | null;
  displayAddress?: string | null;
  diagnostics?: Record<string, unknown>;
};

export async function syncDirectAccountSource(
  input: DirectAccountSourceSyncInput
): Promise<void> {
  const sourceConnectionId = input.connector.sourceConnectionId;

  if (!input.sourceRepository || !sourceConnectionId) {
    return;
  }

  const sourceName = sourceNameFromChannelType(input.connector.channelType);
  const externalAccountId =
    input.externalAccountId ?? input.session.externalAccountId ?? null;
  const displayAddress =
    input.displayAddress ?? input.session.displayAddress ?? null;

  await input.sourceRepository.upsertSourceConnection({
    id: sourceConnectionId,
    tenantId: input.connector.tenantId,
    sourceType: "messenger",
    sourceName,
    displayName: input.connector.displayName,
    status: input.status,
    authType: "custom",
    capabilities: directAccountCapabilities,
    config: {
      channelClass: input.connector.channelClass,
      channelConnectorId: input.connector.id,
      channelType: input.connector.channelType,
      provider: input.connector.provider
    },
    diagnostics: {
      ...(input.diagnostics ?? {}),
      checkedAt: input.checkedAt.toISOString(),
      channelConnectorStatus: input.connector.status,
      channelHealthStatus: input.connector.healthStatus,
      sessionStatus: input.session.status
    },
    metadata: {
      managedBy: "channel_connector",
      sessionKey: input.session.sessionKey
    },
    createdByEmployeeId: input.connector.createdByEmployeeId,
    updatedAt: input.checkedAt
  });

  const stableExternalAccountId =
    externalAccountId ?? displayAddress ?? input.session.id;
  const accountDisplayName =
    displayAddress ?? externalAccountId ?? input.connector.displayName;

  await input.sourceRepository.upsertSourceAccount({
    id: sourceAccountId(input.connector.id, stableExternalAccountId),
    tenantId: input.connector.tenantId,
    sourceConnectionId,
    externalAccountId,
    externalAccountName: displayAddress ?? externalAccountId,
    accountType: "user_session",
    displayName: accountDisplayName,
    status: accountStatusFromConnectionStatus(input.status),
    metadata: {
      channelConnectorId: input.connector.id,
      channelType: input.connector.channelType,
      provider: input.connector.provider,
      sessionId: input.session.id,
      sessionKey: input.session.sessionKey
    },
    updatedAt: input.checkedAt
  });
}

function sourceNameFromChannelType(channelType: string): string {
  switch (channelType) {
    case "telegram_qr_bridge":
      return "telegram_user_session";
    case "whatsapp_qr_bridge":
      return "whatsapp_user_session";
    case "max_qr_bridge":
      return "max_user_session";
    default:
      return channelType;
  }
}

function accountStatusFromConnectionStatus(
  status: SourceConnectionStatus
): SourceConnectionStatus {
  return status === "degraded" ? "active" : status;
}

function sourceAccountId(
  connectorId: string,
  stableExternalAccountId: string
): string {
  const digest = createHash("sha256")
    .update(`${connectorId}:${stableExternalAccountId}`)
    .digest("hex")
    .slice(0, 24);

  return `source_account:${digest}`;
}
