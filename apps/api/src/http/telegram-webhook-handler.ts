import type {
  ChannelConnectorId,
  InternalTelegramIntegrationDiagnostics,
  PlatformErrorCode,
  PublicApiInboundMessageResponse,
  TenantId
} from "@hulee/contracts";
import {
  getPlatformErrorDefinition,
  internalTelegramIntegrationDiagnosticsSchema,
  isPlatformErrorCode
} from "@hulee/contracts";
import type {
  ChannelConnectorRecord,
  ChannelConnectorRepository
} from "@hulee/db";
import {
  createTelegramChannelAdapter,
  parseTelegramChannelConfig,
  type TelegramChannelConfig
} from "@hulee/modules";
import type { Logger } from "@hulee/observability";
import { timingSafeEqual } from "node:crypto";

import type { ExternalChannelCommandService } from "../external-channel-command-service";
import type { ApiHttpRequest, ApiHttpResponse } from "./public-api-handler";
import { resolveRequestId } from "./request-id";

export type TelegramWebhookConnector = {
  connectorId?: ChannelConnectorId | string;
  record?: ChannelConnectorRecord;
  tenantId: TenantId;
  config: TelegramChannelConfig;
};

export type TelegramWebhookConnectorResolver = {
  resolveConnector(input: {
    connectorId: string;
  }): Promise<TelegramWebhookConnector | null>;
};

export type SecretResolver = {
  resolveSecret(input: {
    tenantId: TenantId;
    secretRef: string;
  }): Promise<string | null>;
};

export type TelegramWebhookHandlerOptions = {
  commands: ExternalChannelCommandService;
  connectorRepository?: ChannelConnectorRepository;
  connectorResolver: TelegramWebhookConnectorResolver;
  secretResolver: SecretResolver;
  logger?: Logger;
  now?: () => Date;
  requestIdFactory?: () => string;
};

export type TelegramWebhookHandler = {
  handle(request: ApiHttpRequest): Promise<ApiHttpResponse>;
};

type RouteMatch = {
  connectorId: string;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};
const telegramChannelType = "telegram_bot";
const telegramSecretTokenHeader = "x-telegram-bot-api-secret-token";

export function createChannelConnectorTelegramWebhookConnectorResolver(input: {
  repository: ChannelConnectorRepository;
}): TelegramWebhookConnectorResolver {
  return {
    async resolveConnector({ connectorId }) {
      const record = await input.repository.findActiveConnectorByConfigString({
        channelType: telegramChannelType,
        configKey: "webhookConnectorId",
        configValue: connectorId
      });

      if (!record) {
        return null;
      }

      return {
        connectorId: record.id,
        record,
        tenantId: record.tenantId,
        config: parseTelegramChannelConfig(record.config)
      };
    }
  };
}

export function createTelegramWebhookHandler(
  options: TelegramWebhookHandlerOptions
): TelegramWebhookHandler {
  const requestIdFactory = options.requestIdFactory ?? defaultRequestIdFactory;
  const now = options.now ?? (() => new Date());
  const adapter = createTelegramChannelAdapter();

  return {
    async handle(request) {
      const requestId = resolveRequestId({
        headers: request.headers,
        requestIdFactory
      });
      const route = matchRoute(request);
      let connector: TelegramWebhookConnector | null = null;

      if (route === undefined) {
        return errorResponse("validation.failed", requestId, 404);
      }

      try {
        connector = await options.connectorResolver.resolveConnector({
          connectorId: route.connectorId
        });

        if (!connector) {
          return errorResponse("tenant.not_found", requestId, 404);
        }

        assertWebhookConnectorReady(connector.config);
        await assertTelegramSecretToken({
          request,
          connector,
          secretResolver: options.secretResolver
        });

        const normalized = await adapter.normalizeIncoming({
          tenantId: connector.tenantId,
          channelExternalId: connector.config.channelExternalId,
          update: request.body
        });
        const response: PublicApiInboundMessageResponse =
          await options.commands.acceptInboundMessage(
            {
              requestId,
              tenantId: connector.tenantId,
              channelId: connector.config.channelExternalId,
              channelProvider: "telegram"
            },
            normalized
          );

        await persistWebhookRuntimeDiagnostics({
          connector,
          connectorRepository: options.connectorRepository,
          event: {
            kind: "accepted",
            checkedAt: now().toISOString(),
            requestId,
            updateId: readTelegramUpdateId(request.body),
            providerMessageId: normalized.providerMessageId
          },
          logger: options.logger
        });

        return jsonResponse(202, {
          ...response,
          channelExternalId: connector.config.channelExternalId
        });
      } catch (error) {
        const code = platformErrorCodeFromUnknown(error);
        const response = errorResponse(code, requestId);

        await persistWebhookRuntimeDiagnostics({
          connector,
          connectorRepository: options.connectorRepository,
          event: {
            kind: "failed",
            checkedAt: now().toISOString(),
            requestId,
            updateId: readTelegramUpdateId(request.body),
            errorCode: code,
            operatorHint: webhookRuntimeOperatorHint(code)
          },
          logger: options.logger
        });

        options.logger?.warn(
          "telegram_webhook.request_failed",
          {
            requestId,
            connectorId: route.connectorId,
            status: response.status
          },
          error
        );

        return response;
      }
    }
  };
}

async function persistWebhookRuntimeDiagnostics(input: {
  connector: TelegramWebhookConnector | null;
  connectorRepository: ChannelConnectorRepository | undefined;
  event:
    | {
        kind: "accepted";
        checkedAt: string;
        requestId: string;
        updateId?: number;
        providerMessageId: string;
      }
    | {
        kind: "failed";
        checkedAt: string;
        requestId: string;
        updateId?: number;
        errorCode: PlatformErrorCode;
        operatorHint: string;
      };
  logger?: Logger;
}): Promise<void> {
  if (
    !input.connector ||
    !input.connectorRepository ||
    !input.connector.connectorId
  ) {
    return;
  }

  try {
    const record =
      (await input.connectorRepository.findConnector({
        tenantId: input.connector.tenantId,
        connectorId: input.connector.connectorId
      })) ??
      input.connector.record ??
      null;

    if (!record) {
      return;
    }

    const diagnostics = buildWebhookRuntimeDiagnostics({
      checkedAt: input.event.checkedAt,
      config: input.connector.config,
      event: input.event,
      previous: parseStoredTelegramDiagnostics(record.diagnostics)
    });

    await input.connectorRepository.upsertConnector({
      id: record.id,
      tenantId: record.tenantId,
      channelType: record.channelType,
      channelClass: record.channelClass,
      provider: record.provider,
      displayName: record.displayName,
      status: record.status,
      healthStatus: record.healthStatus,
      capabilities: record.capabilities,
      onboardingState: record.onboardingState,
      config: record.config,
      diagnostics,
      sourceConnectionId: record.sourceConnectionId,
      createdByEmployeeId: record.createdByEmployeeId,
      updatedAt: new Date(input.event.checkedAt)
    });
  } catch (error) {
    input.logger?.warn(
      "telegram_webhook.diagnostics_update_failed",
      {
        connectorId: input.connector.connectorId,
        requestId: input.event.requestId
      },
      error
    );
  }
}

function buildWebhookRuntimeDiagnostics(input: {
  checkedAt: string;
  config: TelegramChannelConfig;
  event:
    | {
        kind: "accepted";
        requestId: string;
        updateId?: number;
        providerMessageId: string;
      }
    | {
        kind: "failed";
        requestId: string;
        updateId?: number;
        errorCode: PlatformErrorCode;
        operatorHint: string;
      };
  previous: InternalTelegramIntegrationDiagnostics | null;
}): InternalTelegramIntegrationDiagnostics {
  const previousInbound = input.previous?.runtime?.inbound;
  const inbound =
    input.event.kind === "accepted"
      ? {
          lastSource: "webhook" as const,
          lastReceivedAt: input.checkedAt,
          lastAcceptedAt: input.checkedAt,
          ...(previousInbound?.lastFailedAt
            ? { lastFailedAt: previousInbound.lastFailedAt }
            : {}),
          lastRequestId: input.event.requestId,
          ...(input.event.updateId === undefined
            ? {}
            : { lastUpdateId: input.event.updateId }),
          lastProviderMessageId: input.event.providerMessageId,
          lastBatchReceivedCount: 1,
          lastBatchAcceptedCount: 1,
          lastBatchFailedCount: 0,
          ...(previousInbound?.lastErrorCode
            ? { lastErrorCode: previousInbound.lastErrorCode }
            : {})
        }
      : {
          lastSource: "webhook" as const,
          lastReceivedAt: input.checkedAt,
          lastFailedAt: input.checkedAt,
          lastRequestId: input.event.requestId,
          ...(input.event.updateId === undefined
            ? {}
            : { lastUpdateId: input.event.updateId }),
          ...(previousInbound?.lastProviderMessageId
            ? { lastProviderMessageId: previousInbound.lastProviderMessageId }
            : {}),
          lastBatchReceivedCount: 1,
          lastBatchAcceptedCount: 0,
          lastBatchFailedCount: 1,
          lastErrorCode: input.event.errorCode,
          operatorHint: input.event.operatorHint
        };

  return internalTelegramIntegrationDiagnosticsSchema.parse({
    status:
      input.previous?.status ??
      (input.config.mode === "webhook" ? "configured" : "invalid_config"),
    checkedAt: input.checkedAt,
    ...(input.previous?.lastErrorCode
      ? { lastErrorCode: input.previous.lastErrorCode }
      : {}),
    ...(input.previous?.operatorHint
      ? { operatorHint: input.previous.operatorHint }
      : {}),
    ...(input.previous?.bot ? { bot: input.previous.bot } : {}),
    ...(input.previous?.webhook ? { webhook: input.previous.webhook } : {}),
    ...(input.previous?.polling ? { polling: input.previous.polling } : {}),
    ...(input.previous?.egress ? { egress: input.previous.egress } : {}),
    runtime: {
      ...(input.previous?.runtime?.outbound
        ? { outbound: input.previous.runtime.outbound }
        : {}),
      inbound
    },
    checks:
      input.previous?.checks ?? buildWebhookRuntimeFallbackChecks(input.config)
  });
}

function buildWebhookRuntimeFallbackChecks(
  config: TelegramChannelConfig
): InternalTelegramIntegrationDiagnostics["checks"] {
  return {
    moduleEnabled: true,
    configValid: true,
    inboundWebhookReady:
      config.mode === "webhook" && Boolean(config.webhookSecretTokenSecretRef),
    outboundEnabled: config.outboundEnabled,
    botTokenSecretRefConfigured: Boolean(config.botTokenSecretRef),
    webhookSecretTokenResolved: Boolean(config.webhookSecretTokenSecretRef),
    webhookMatchesConfig: config.mode === "webhook"
  };
}

function parseStoredTelegramDiagnostics(
  input: unknown
): InternalTelegramIntegrationDiagnostics | null {
  const result = internalTelegramIntegrationDiagnosticsSchema.safeParse(input);

  return result.success ? result.data : null;
}

function readTelegramUpdateId(input: unknown): number | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  return typeof input.update_id === "number" &&
    Number.isInteger(input.update_id) &&
    input.update_id >= 0
    ? input.update_id
    : undefined;
}

function webhookRuntimeOperatorHint(code: PlatformErrorCode): string {
  switch (code) {
    case "auth.invalid_credentials":
      return "Telegram webhook secret token is missing or invalid.";
    case "module.disabled":
      return "Telegram connector is not configured for webhook mode.";
    case "tenant.not_found":
      return "Telegram webhook connector was not found.";
    default:
      return "Telegram webhook update failed to normalize or ingest.";
  }
}

function matchRoute(request: ApiHttpRequest): RouteMatch | undefined {
  const url = new URL(request.path, "http://hulee.local");
  const path = normalizePath(url.pathname);
  const match = path.match(/^\/webhooks\/telegram\/([^/]+)$/);

  if (request.method === "POST" && match?.[1]) {
    return {
      connectorId: decodeURIComponent(match[1])
    };
  }

  return undefined;
}

function assertWebhookConnectorReady(config: TelegramChannelConfig): void {
  if (config.mode !== "webhook") {
    throw new ErrorWithCode("module.disabled");
  }

  if (!config.webhookSecretTokenSecretRef) {
    throw new ErrorWithCode("validation.failed");
  }
}

async function assertTelegramSecretToken(input: {
  request: ApiHttpRequest;
  connector: TelegramWebhookConnector;
  secretResolver: SecretResolver;
}): Promise<void> {
  const expectedToken = await input.secretResolver.resolveSecret({
    tenantId: input.connector.tenantId,
    secretRef: input.connector.config.webhookSecretTokenSecretRef ?? ""
  });
  const actualToken = headerValue(
    input.request.headers,
    telegramSecretTokenHeader
  )?.trim();

  if (
    !expectedToken ||
    !actualToken ||
    !constantTimeStringEquals(expectedToken, actualToken)
  ) {
    throw new ErrorWithCode("auth.invalid_credentials");
  }
}

function constantTimeStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}

function headerValue(
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | undefined {
  if (headers === undefined) {
    return undefined;
  }

  const lowerName = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function platformErrorCodeFromUnknown(error: unknown): PlatformErrorCode {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    isPlatformErrorCode(error.code)
  ) {
    return error.code;
  }

  return "validation.failed";
}

class ErrorWithCode extends Error {
  readonly code: PlatformErrorCode;

  constructor(code: PlatformErrorCode) {
    super(code);
    this.code = code;
  }
}

function errorResponse(
  code: PlatformErrorCode,
  requestId: string,
  statusOverride?: number
): ApiHttpResponse {
  const definition = getPlatformErrorDefinition(code);

  return jsonResponse(statusOverride ?? definition.httpStatus, {
    error: {
      code,
      messageKey: definition.messageKey,
      retryability: definition.retryability,
      requestId
    }
  });
}

function jsonResponse(status: number, body: unknown): ApiHttpResponse {
  return {
    status,
    headers: jsonHeaders,
    body
  };
}

function defaultRequestIdFactory(): string {
  return `telegram-webhook-request-${Date.now()}`;
}
