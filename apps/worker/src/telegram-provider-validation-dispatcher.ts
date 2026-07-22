import type {
  PlatformErrorCode,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import { isPlatformErrorCode } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  ChannelProviderValidationJobRecord,
  ChannelProviderValidationJobRepository,
  UpsertChannelProviderValidationJobInput
} from "@hulee/db";
import {
  createPassthroughEgressRuntime,
  createTelegramBotApiClient,
  managedMessengerVpnEgressRequirement,
  TelegramAdapterError,
  type EgressProfileResolution,
  type EgressRuntime,
  type TelegramBotApiEgressBinding,
  type TelegramBotApiSettings,
  type TelegramBotIdentity
} from "@hulee/modules";

import type {
  OutboxRecord,
  ProviderControlOutboxHandler
} from "./provider-control-outbox";
import type { SecretResolver } from "./secret-resolver";

export type TelegramProviderValidationBotApiClient = {
  getMe(): Promise<TelegramBotIdentity>;
};

export type TelegramProviderValidationBotApiClientFactory = (
  settings: TelegramBotApiSettings
) => TelegramProviderValidationBotApiClient;

export type TelegramProviderValidationDispatcherOptions = {
  validationJobRepository: ChannelProviderValidationJobRepository;
  secretResolver: SecretResolver;
  botApiClientFactory?: TelegramProviderValidationBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  telegramApiBaseUrl?: string;
  now?: () => Date;
};

const telegramChannelType = "telegram_bot";
const telegramProvider = "telegram";
const telegramBotTokenValidationKind = "telegram_bot_token";

export function createTelegramProviderValidationDispatcher(
  options: TelegramProviderValidationDispatcherOptions
): ProviderControlOutboxHandler {
  const botApiClientFactory =
    options.botApiClientFactory ?? createTelegramBotApiClient;
  const egressRuntime =
    options.egressRuntime ?? createPassthroughEgressRuntime();
  const now = options.now ?? (() => new Date());

  return {
    async handle(record: OutboxRecord): Promise<void> {
      const request = parseTelegramProviderValidationRequest(record.payload);

      if (request === null) {
        return;
      }

      if (request.tenantId !== record.tenantId) {
        throw new CoreError("tenant.boundary_violation");
      }

      await runTelegramProviderValidation({
        ...options,
        botApiClientFactory,
        egressRuntime,
        now,
        tenantId: record.tenantId,
        jobId: request.jobId
      });
    }
  };
}

async function runTelegramProviderValidation(input: {
  validationJobRepository: ChannelProviderValidationJobRepository;
  secretResolver: SecretResolver;
  botApiClientFactory: TelegramProviderValidationBotApiClientFactory;
  egressRuntime: EgressRuntime;
  telegramApiBaseUrl?: string;
  now: () => Date;
  tenantId: TenantId;
  jobId: string;
}): Promise<void> {
  const updatedAt = input.now();
  const checkedAt = updatedAt.toISOString();
  const job = await input.validationJobRepository.findJob({
    tenantId: input.tenantId,
    jobId: input.jobId
  });

  if (!job) {
    throw new CoreError("validation.failed");
  }

  if (
    job.channelType !== telegramChannelType ||
    job.provider !== telegramProvider ||
    job.validationKind !== telegramBotTokenValidationKind
  ) {
    return;
  }

  if (job.status === "succeeded" || job.status === "failed") {
    return;
  }

  if (updatedAt >= job.expiresAt) {
    await markValidationJobFailed({
      repository: input.validationJobRepository,
      job,
      errorCode: "provider.temporary_failure",
      errorMessage: "Telegram token validation job expired before processing.",
      updatedAt
    });
    return;
  }

  await upsertValidationJob({
    repository: input.validationJobRepository,
    job,
    status: "processing",
    updatedAt
  });

  try {
    const botToken = await input.secretResolver.resolveSecret({
      tenantId: input.tenantId,
      secretRef: job.botTokenSecretRef
    });

    if (!botToken) {
      throw new CoreError("validation.failed");
    }

    const egressResolution = await resolveTelegramEgressProfile({
      egressRuntime: input.egressRuntime,
      tenantId: input.tenantId,
      connectorId: job.id,
      checkedAt
    });
    const client = input.botApiClientFactory({
      apiBaseUrl: input.telegramApiBaseUrl,
      botToken,
      egress: buildTelegramBotApiEgressBinding({
        egressRuntime: input.egressRuntime,
        resolution: egressResolution,
        tenantId: input.tenantId,
        connectorId: job.id
      })
    });
    const bot = await client.getMe();

    await upsertValidationJob({
      repository: input.validationJobRepository,
      job,
      status: "succeeded",
      resultPayload: {
        bot: telegramBotTokenValidationIdentity(bot)
      },
      completedAt: updatedAt,
      updatedAt
    });
  } catch (error) {
    await markValidationJobFailed({
      repository: input.validationJobRepository,
      job,
      errorCode: platformErrorCodeFromTelegramError(error),
      errorMessage: error instanceof Error ? error.message : String(error),
      updatedAt
    });
  }
}

async function markValidationJobFailed(input: {
  repository: ChannelProviderValidationJobRepository;
  job: ChannelProviderValidationJobRecord;
  errorCode: PlatformErrorCode;
  errorMessage: string;
  updatedAt: Date;
}): Promise<void> {
  await upsertValidationJob({
    repository: input.repository,
    job: input.job,
    status: "failed",
    errorCode: input.errorCode,
    errorMessage: safeErrorMessage(input.errorMessage),
    completedAt: input.updatedAt,
    updatedAt: input.updatedAt
  });
}

async function upsertValidationJob(input: {
  repository: ChannelProviderValidationJobRepository;
  job: ChannelProviderValidationJobRecord;
  status: UpsertChannelProviderValidationJobInput["status"];
  resultPayload?: unknown;
  errorCode?: PlatformErrorCode | null;
  errorMessage?: string | null;
  completedAt?: Date | null;
  updatedAt: Date;
}): Promise<void> {
  await input.repository.upsertJob({
    id: input.job.id,
    tenantId: input.job.tenantId,
    channelType: input.job.channelType,
    provider: input.job.provider,
    validationKind: input.job.validationKind,
    status: input.status,
    botTokenSecretRef: input.job.botTokenSecretRef,
    resultPayload: input.resultPayload ?? input.job.resultPayload,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    expiresAt: input.job.expiresAt,
    completedAt: input.completedAt ?? null,
    createdByEmployeeId: input.job.createdByEmployeeId,
    updatedAt: input.updatedAt
  });
}

async function resolveTelegramEgressProfile(input: {
  egressRuntime: EgressRuntime;
  tenantId: TenantId;
  connectorId: string;
  checkedAt: string;
}): Promise<EgressProfileResolution> {
  return input.egressRuntime.resolveProfile({
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    channelType: telegramChannelType,
    provider: telegramProvider,
    requirement: managedMessengerVpnEgressRequirement,
    checkedAt: input.checkedAt
  });
}

function buildTelegramBotApiEgressBinding(input: {
  egressRuntime: EgressRuntime;
  resolution: EgressProfileResolution;
  tenantId: TenantId;
  connectorId: string;
}): TelegramBotApiEgressBinding {
  return {
    runtime: input.egressRuntime,
    resolution: input.resolution,
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    channelType: telegramChannelType,
    provider: telegramProvider
  };
}

function telegramBotTokenValidationIdentity(input: TelegramBotIdentity): {
  id: string;
  firstName?: string;
  username?: string;
} {
  return {
    id: input.id,
    ...(input.firstName ? { firstName: input.firstName } : {}),
    ...(input.username ? { username: input.username } : {})
  };
}

function parseTelegramProviderValidationRequest(
  event: PlatformEvent
): { tenantId: TenantId; jobId: string } | null {
  if (event.type !== "channel.provider_validation.requested") {
    return null;
  }

  if (
    event.payload.channelType !== telegramChannelType ||
    event.payload.provider !== telegramProvider ||
    event.payload.validationKind !== telegramBotTokenValidationKind
  ) {
    return null;
  }

  return {
    tenantId: event.tenantId,
    jobId: event.payload.jobId
  };
}

function platformErrorCodeFromTelegramError(error: unknown): PlatformErrorCode {
  if (error instanceof TelegramAdapterError) {
    return error.code;
  }

  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    isPlatformErrorCode(error.code)
  ) {
    return error.code;
  }

  return "provider.temporary_failure";
}

function safeErrorMessage(message: string): string {
  const trimmed = message.trim();

  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}
