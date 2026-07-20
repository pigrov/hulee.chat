import type {
  DeploymentType,
  InternalEgressDiagnostics,
  InternalEgressProfileKind
} from "@hulee/contracts";
import type { LogLevel } from "@hulee/observability";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const defaultLocalDatabaseUrl =
  "postgres://hulee:hulee@localhost:5432/hulee";

export type RuntimeEnvironment = "development" | "test" | "production";
export type HuleeAppName = "api" | "web" | "worker";
export const workerFeatureValues = [
  "core",
  "webhooks",
  "telegram_bot",
  "telegram_user",
  "whatsapp_user",
  "whatsapp_official",
  "max_user"
] as const;
export type WorkerFeature = (typeof workerFeatureValues)[number];
const defaultWorkerFeatures: readonly WorkerFeature[] = ["core"];

export type EnvSource = Record<string, string | undefined>;

export type ConfigIssue = {
  variable: string;
  message: string;
};

export class ConfigError extends Error {
  readonly appName: HuleeAppName;
  readonly issues: ConfigIssue[];

  constructor(appName: HuleeAppName, issues: ConfigIssue[]) {
    super(
      `Invalid ${appName} configuration: ${issues
        .map((issue) => `${issue.variable} ${issue.message}`)
        .join("; ")}`
    );
    this.name = "ConfigError";
    this.appName = appName;
    this.issues = issues;
  }
}

export type BaseAppConfig = {
  appName: HuleeAppName;
  nodeEnv: RuntimeEnvironment;
  deploymentType: DeploymentType;
  logLevel: LogLevel;
  databaseUrl: string;
  secretEncryptionKey?: string;
  egressProfile: DeploymentEgressProfileConfig;
};

export type DeploymentEgressProfileConfig = {
  profileId: string;
  profileKind: InternalEgressProfileKind;
  status: InternalEgressDiagnostics["status"];
  lastErrorCode?: "validation.failed" | "provider.temporary_failure";
  operatorHint?: string;
};

export type ApiConfig = BaseAppConfig & {
  appName: "api";
  host: string;
  port: number;
  internalApiSecret?: string;
  publicBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  objectStorage?: ObjectStorageConfig;
  sseEnabled: boolean;
};

export type WebConfig = BaseAppConfig & {
  appName: "web";
  internalApiBaseUrl: string;
  internalApiSecret?: string;
  publicBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  objectStorage?: ObjectStorageConfig;
  authChoiceSecret?: string;
  webAllowedOrigins: readonly string[];
  webAuthRequired: boolean;
  resendToken?: string;
  emailFrom?: string;
};

export type WorkerConfig = BaseAppConfig & {
  appName: "worker";
  workerFeatures: readonly WorkerFeature[];
  publicBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  telegramUserApiId?: number;
  telegramUserApiHash?: string;
  objectStorage?: ObjectStorageConfig;
  pollIntervalMs: number;
  outboxBatchSize: number;
  outboxRetryDelayMs: number;
  egressProbesEnabled: boolean;
  egressProbeIntervalMs: number;
  egressProbeTimeoutMs: number;
};

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

const runtimeEnvironmentSchema = z.enum(["development", "test", "production"]);

const deploymentTypeSchema = z.enum([
  "saas_shared",
  "saas_isolated",
  "on_prem"
]);

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const egressProfileKindSchema = z.enum([
  "direct",
  "vpn_namespace",
  "http_proxy",
  "socks_proxy",
  "customer_network",
  "disabled"
]);
const egressProfileStatusSchema = z.enum([
  "unknown",
  "ready",
  "degraded",
  "unavailable",
  "misconfigured"
]);
const workerFeatureSchema = z.enum(workerFeatureValues);

const emptyToUndefined = (value: unknown): unknown => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
};

const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const optionalHttpUrl = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .url()
    .refine((value) => isHttpUrl(value))
    .optional()
);

const optionalNonEmptyString = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional()
);

const optionalInteger = (minimum: number, maximum: number) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(minimum).max(maximum).optional()
  );

const optionalBoolean = z.preprocess(
  emptyToUndefined,
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }

      return value === "true" || value === "1";
    })
);

const optionalWorkerFeatures = z.preprocess((value) => {
  const normalized = emptyToUndefined(value);

  if (typeof normalized !== "string") {
    return normalized;
  }

  return normalized
    .split(",")
    .map((feature) => feature.trim())
    .filter((feature) => feature.length > 0);
}, z.array(workerFeatureSchema).min(1).optional());

const baseEnvSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, runtimeEnvironmentSchema.optional()),
  HULEE_DEPLOYMENT_TYPE: z.preprocess(
    emptyToUndefined,
    deploymentTypeSchema.optional()
  ),
  HULEE_LOG_LEVEL: z.preprocess(emptyToUndefined, logLevelSchema.optional()),
  DATABASE_URL: optionalUrl,
  HULEE_SECRET_ENCRYPTION_KEY: optionalNonEmptyString,
  HULEE_EGRESS_PROFILE_ID: optionalNonEmptyString,
  HULEE_EGRESS_PROFILE_KIND: z.preprocess(
    emptyToUndefined,
    egressProfileKindSchema.optional()
  ),
  HULEE_EGRESS_PROFILE_STATUS: z.preprocess(
    emptyToUndefined,
    egressProfileStatusSchema.optional()
  ),
  HULEE_EGRESS_OPERATOR_HINT: optionalNonEmptyString
});

const apiEnvSchema = baseEnvSchema.extend({
  HULEE_API_HOST: optionalNonEmptyString,
  HULEE_API_PORT: optionalInteger(1, 65_535),
  HULEE_INTERNAL_API_SECRET: optionalNonEmptyString,
  HULEE_PUBLIC_BASE_URL: optionalHttpUrl,
  HULEE_PUBLIC_WEBHOOK_BASE_URL: optionalHttpUrl,
  HULEE_OBJECT_STORAGE_ENDPOINT: optionalHttpUrl,
  HULEE_OBJECT_STORAGE_REGION: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_BUCKET: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_ACCESS_KEY_ID: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_SECRET_ACCESS_KEY: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_FORCE_PATH_STYLE: optionalBoolean,
  HULEE_SSE_ENABLED: optionalBoolean
});

const webEnvSchema = baseEnvSchema.extend({
  HULEE_INTERNAL_API_BASE_URL: optionalHttpUrl,
  HULEE_INTERNAL_API_SECRET: optionalNonEmptyString,
  HULEE_PUBLIC_BASE_URL: optionalHttpUrl,
  HULEE_PUBLIC_WEBHOOK_BASE_URL: optionalHttpUrl,
  HULEE_OBJECT_STORAGE_ENDPOINT: optionalHttpUrl,
  HULEE_OBJECT_STORAGE_REGION: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_BUCKET: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_ACCESS_KEY_ID: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_SECRET_ACCESS_KEY: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_FORCE_PATH_STYLE: optionalBoolean,
  HULEE_AUTH_CHOICE_SECRET: optionalNonEmptyString,
  HULEE_WEB_ALLOWED_ORIGINS: optionalNonEmptyString,
  HULEE_WEB_AUTH_REQUIRED: optionalBoolean,
  HULEE_RESEND_TOKEN: optionalNonEmptyString,
  HULEE_EMAIL_FROM: optionalNonEmptyString
});

const workerEnvSchema = baseEnvSchema.extend({
  HULEE_WORKER_FEATURES: optionalWorkerFeatures,
  HULEE_PUBLIC_BASE_URL: optionalHttpUrl,
  HULEE_PUBLIC_WEBHOOK_BASE_URL: optionalHttpUrl,
  HULEE_TELEGRAM_USER_API_ID: optionalInteger(1, 2_147_483_647),
  HULEE_TELEGRAM_USER_API_HASH: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_ENDPOINT: optionalHttpUrl,
  HULEE_OBJECT_STORAGE_REGION: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_BUCKET: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_ACCESS_KEY_ID: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_SECRET_ACCESS_KEY: optionalNonEmptyString,
  HULEE_OBJECT_STORAGE_FORCE_PATH_STYLE: optionalBoolean,
  HULEE_WORKER_POLL_INTERVAL_MS: optionalInteger(100, 60_000),
  HULEE_OUTBOX_BATCH_SIZE: optionalInteger(1, 500),
  HULEE_OUTBOX_RETRY_DELAY_MS: optionalInteger(100, 3_600_000),
  HULEE_EGRESS_PROBES_ENABLED: optionalBoolean,
  HULEE_EGRESS_PROBE_INTERVAL_MS: optionalInteger(5_000, 3_600_000),
  HULEE_EGRESS_PROBE_TIMEOUT_MS: optionalInteger(500, 60_000)
});

const issueMessages: Record<string, string> = {
  NODE_ENV: "must be development, test or production",
  HULEE_DEPLOYMENT_TYPE: "must be saas_shared, saas_isolated or on_prem",
  HULEE_LOG_LEVEL: "must be debug, info, warn or error",
  DATABASE_URL: "must be a valid URL and is required in production",
  HULEE_SECRET_ENCRYPTION_KEY:
    "must be a base64, hex or 32-byte UTF-8 encryption key",
  HULEE_EGRESS_PROFILE_ID: "must not be empty",
  HULEE_EGRESS_PROFILE_KIND:
    "must be direct, vpn_namespace, http_proxy, socks_proxy, customer_network or disabled",
  HULEE_EGRESS_PROFILE_STATUS:
    "must be unknown, ready, degraded, unavailable or misconfigured",
  HULEE_EGRESS_OPERATOR_HINT: "must not be empty",
  HULEE_API_HOST: "must not be empty",
  HULEE_API_PORT: "must be an integer from 1 to 65535",
  HULEE_INTERNAL_API_SECRET: "must not be empty",
  HULEE_PUBLIC_BASE_URL: "must be a valid HTTP(S) URL",
  HULEE_PUBLIC_WEBHOOK_BASE_URL: "must be a valid HTTP(S) URL",
  HULEE_TELEGRAM_USER_API_ID: "must be a positive integer",
  HULEE_TELEGRAM_USER_API_HASH: "must not be empty",
  HULEE_SSE_ENABLED: "must be true, false, 1 or 0",
  HULEE_INTERNAL_API_BASE_URL: "must be a valid HTTP(S) URL",
  HULEE_AUTH_CHOICE_SECRET: "must not be empty",
  HULEE_WEB_ALLOWED_ORIGINS:
    "must be a comma-separated list of valid URL origins",
  HULEE_WEB_AUTH_REQUIRED: "must be true, false, 1 or 0",
  HULEE_RESEND_TOKEN: "must not be empty",
  HULEE_EMAIL_FROM: "must not be empty",
  HULEE_WORKER_FEATURES:
    "must be a comma-separated list of worker features: core, webhooks, telegram_bot, telegram_user, whatsapp_user, whatsapp_official or max_user",
  HULEE_OBJECT_STORAGE_ENDPOINT: "must be a valid HTTP(S) URL",
  HULEE_OBJECT_STORAGE_REGION: "must not be empty",
  HULEE_OBJECT_STORAGE_BUCKET: "must not be empty",
  HULEE_OBJECT_STORAGE_ACCESS_KEY_ID: "must not be empty",
  HULEE_OBJECT_STORAGE_SECRET_ACCESS_KEY: "must not be empty",
  HULEE_OBJECT_STORAGE_FORCE_PATH_STYLE: "must be true, false, 1 or 0",
  HULEE_WORKER_POLL_INTERVAL_MS:
    "must be an integer from 100 to 60000 milliseconds",
  HULEE_OUTBOX_BATCH_SIZE: "must be an integer from 1 to 500",
  HULEE_OUTBOX_RETRY_DELAY_MS:
    "must be an integer from 100 to 3600000 milliseconds",
  HULEE_EGRESS_PROBES_ENABLED: "must be true, false, 1 or 0",
  HULEE_EGRESS_PROBE_INTERVAL_MS:
    "must be an integer from 5000 to 3600000 milliseconds",
  HULEE_EGRESS_PROBE_TIMEOUT_MS:
    "must be an integer from 500 to 60000 milliseconds"
};

function zodIssuesToConfigIssues(issues: z.core.$ZodIssue[]): ConfigIssue[] {
  return issues.map((issue) => {
    const variable = String(issue.path[0] ?? "UNKNOWN");

    return {
      variable,
      message: issueMessages[variable] ?? "has an invalid value"
    };
  });
}

function buildBaseConfig(
  appName: HuleeAppName,
  env: z.infer<typeof baseEnvSchema>
): BaseAppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const issues: ConfigIssue[] = [];

  if (nodeEnv === "production" && env.DATABASE_URL === undefined) {
    issues.push({
      variable: "DATABASE_URL",
      message: "must be a valid URL and is required in production"
    });
  }

  if (issues.length > 0) {
    throw new ConfigError(appName, issues);
  }

  return {
    appName,
    nodeEnv,
    deploymentType: env.HULEE_DEPLOYMENT_TYPE ?? "on_prem",
    logLevel: env.HULEE_LOG_LEVEL ?? "info",
    databaseUrl: env.DATABASE_URL ?? defaultLocalDatabaseUrl,
    secretEncryptionKey: env.HULEE_SECRET_ENCRYPTION_KEY,
    egressProfile: buildDeploymentEgressProfile({
      nodeEnv,
      deploymentType: env.HULEE_DEPLOYMENT_TYPE ?? "on_prem",
      profileId: env.HULEE_EGRESS_PROFILE_ID,
      profileKind: env.HULEE_EGRESS_PROFILE_KIND,
      status: env.HULEE_EGRESS_PROFILE_STATUS,
      operatorHint: env.HULEE_EGRESS_OPERATOR_HINT
    })
  };
}

function buildDeploymentEgressProfile(input: {
  nodeEnv: RuntimeEnvironment;
  deploymentType: DeploymentType;
  profileId: string | undefined;
  profileKind: InternalEgressProfileKind | undefined;
  status: InternalEgressDiagnostics["status"] | undefined;
  operatorHint: string | undefined;
}): DeploymentEgressProfileConfig {
  const profileKind =
    input.profileKind ??
    defaultEgressProfileKind({
      nodeEnv: input.nodeEnv,
      deploymentType: input.deploymentType
    });
  const status =
    input.status ??
    defaultEgressProfileStatus({
      nodeEnv: input.nodeEnv,
      deploymentType: input.deploymentType,
      profileKind
    });
  const operatorHint =
    input.operatorHint ??
    defaultEgressOperatorHint({
      nodeEnv: input.nodeEnv,
      deploymentType: input.deploymentType,
      profileKind,
      status
    });

  return {
    profileId: input.profileId ?? `deployment:${profileKind}`,
    profileKind,
    status,
    ...(status === "misconfigured"
      ? { lastErrorCode: "validation.failed" as const }
      : {}),
    ...(operatorHint ? { operatorHint } : {})
  };
}

function defaultEgressProfileKind(input: {
  nodeEnv: RuntimeEnvironment;
  deploymentType: DeploymentType;
}): InternalEgressProfileKind {
  if (input.nodeEnv !== "production") {
    return "direct";
  }

  if (
    input.deploymentType === "saas_shared" ||
    input.deploymentType === "saas_isolated"
  ) {
    return "vpn_namespace";
  }

  return "customer_network";
}

function defaultEgressProfileStatus(input: {
  nodeEnv: RuntimeEnvironment;
  deploymentType: DeploymentType;
  profileKind: InternalEgressProfileKind;
}): InternalEgressDiagnostics["status"] {
  if (
    input.nodeEnv === "production" &&
    (input.deploymentType === "saas_shared" ||
      input.deploymentType === "saas_isolated") &&
    input.profileKind === "vpn_namespace"
  ) {
    return "misconfigured";
  }

  if (input.profileKind === "disabled") {
    return "unavailable";
  }

  return "ready";
}

function defaultEgressOperatorHint(input: {
  nodeEnv: RuntimeEnvironment;
  deploymentType: DeploymentType;
  profileKind: InternalEgressProfileKind;
  status: InternalEgressDiagnostics["status"];
}): string | undefined {
  if (
    input.nodeEnv === "production" &&
    (input.deploymentType === "saas_shared" ||
      input.deploymentType === "saas_isolated") &&
    input.profileKind === "vpn_namespace" &&
    input.status === "misconfigured"
  ) {
    return "Configure a ready deployment VPN egress profile before enabling Telegram or WhatsApp provider traffic.";
  }

  return undefined;
}

export function loadApiConfig(env: EnvSource = process.env): ApiConfig {
  const result = apiEnvSchema.safeParse(env);

  if (!result.success) {
    throw new ConfigError("api", zodIssuesToConfigIssues(result.error.issues));
  }

  const baseConfig = buildBaseConfig("api", result.data);

  if (
    baseConfig.nodeEnv === "production" &&
    result.data.HULEE_INTERNAL_API_SECRET === undefined
  ) {
    throw new ConfigError("api", [
      {
        variable: "HULEE_INTERNAL_API_SECRET",
        message: "must be set in production"
      }
    ]);
  }

  return {
    ...baseConfig,
    appName: "api",
    host: result.data.HULEE_API_HOST ?? "0.0.0.0",
    port: result.data.HULEE_API_PORT ?? 3000,
    internalApiSecret: result.data.HULEE_INTERNAL_API_SECRET,
    publicBaseUrl: result.data.HULEE_PUBLIC_BASE_URL,
    publicWebhookBaseUrl:
      result.data.HULEE_PUBLIC_WEBHOOK_BASE_URL ??
      result.data.HULEE_PUBLIC_BASE_URL,
    objectStorage: buildObjectStorageConfig(result.data),
    sseEnabled: result.data.HULEE_SSE_ENABLED ?? true
  };
}

export function loadWebConfig(env: EnvSource = process.env): WebConfig {
  const result = webEnvSchema.safeParse(env);

  if (!result.success) {
    throw new ConfigError("web", zodIssuesToConfigIssues(result.error.issues));
  }

  const baseConfig = buildBaseConfig("web", result.data);
  const issues: ConfigIssue[] = [];
  const publicBaseUrl = result.data.HULEE_PUBLIC_BASE_URL;

  if (
    baseConfig.nodeEnv === "production" &&
    result.data.HULEE_INTERNAL_API_SECRET === undefined
  ) {
    issues.push({
      variable: "HULEE_INTERNAL_API_SECRET",
      message: "must be set in production"
    });
  }

  if (baseConfig.nodeEnv === "production" && publicBaseUrl === undefined) {
    issues.push({
      variable: "HULEE_PUBLIC_BASE_URL",
      message: "must be set in production"
    });
  }

  const webAllowedOrigins = parseAllowedOrigins(
    result.data.HULEE_WEB_ALLOWED_ORIGINS
  );

  if (webAllowedOrigins === null) {
    issues.push({
      variable: "HULEE_WEB_ALLOWED_ORIGINS",
      message: "must be a comma-separated list of valid URL origins"
    });
  }

  if (issues.length > 0) {
    throw new ConfigError("web", issues);
  }

  return {
    ...baseConfig,
    appName: "web",
    internalApiBaseUrl:
      result.data.HULEE_INTERNAL_API_BASE_URL ?? "http://127.0.0.1:4000",
    internalApiSecret: result.data.HULEE_INTERNAL_API_SECRET,
    publicBaseUrl,
    publicWebhookBaseUrl:
      result.data.HULEE_PUBLIC_WEBHOOK_BASE_URL ?? publicBaseUrl,
    objectStorage: buildObjectStorageConfig(result.data),
    authChoiceSecret: result.data.HULEE_AUTH_CHOICE_SECRET,
    webAllowedOrigins: webAllowedOrigins ?? [],
    webAuthRequired: result.data.HULEE_WEB_AUTH_REQUIRED ?? true,
    resendToken: result.data.HULEE_RESEND_TOKEN,
    emailFrom: result.data.HULEE_EMAIL_FROM
  };
}

export function loadWorkerConfig(env: EnvSource = process.env): WorkerConfig {
  const result = workerEnvSchema.safeParse(env);

  if (!result.success) {
    throw new ConfigError(
      "worker",
      zodIssuesToConfigIssues(result.error.issues)
    );
  }

  return {
    ...buildBaseConfig("worker", result.data),
    appName: "worker",
    workerFeatures: normalizeWorkerFeatures(result.data.HULEE_WORKER_FEATURES),
    publicBaseUrl: result.data.HULEE_PUBLIC_BASE_URL,
    publicWebhookBaseUrl:
      result.data.HULEE_PUBLIC_WEBHOOK_BASE_URL ??
      result.data.HULEE_PUBLIC_BASE_URL,
    telegramUserApiId: result.data.HULEE_TELEGRAM_USER_API_ID,
    telegramUserApiHash: result.data.HULEE_TELEGRAM_USER_API_HASH,
    objectStorage: buildObjectStorageConfig(result.data),
    pollIntervalMs: result.data.HULEE_WORKER_POLL_INTERVAL_MS ?? 1_000,
    outboxBatchSize: result.data.HULEE_OUTBOX_BATCH_SIZE ?? 50,
    outboxRetryDelayMs: result.data.HULEE_OUTBOX_RETRY_DELAY_MS ?? 30_000,
    egressProbesEnabled: result.data.HULEE_EGRESS_PROBES_ENABLED ?? true,
    egressProbeIntervalMs: result.data.HULEE_EGRESS_PROBE_INTERVAL_MS ?? 30_000,
    egressProbeTimeoutMs: result.data.HULEE_EGRESS_PROBE_TIMEOUT_MS ?? 8_000
  };
}

function buildObjectStorageConfig(env: {
  HULEE_OBJECT_STORAGE_ENDPOINT?: string;
  HULEE_OBJECT_STORAGE_REGION?: string;
  HULEE_OBJECT_STORAGE_BUCKET?: string;
  HULEE_OBJECT_STORAGE_ACCESS_KEY_ID?: string;
  HULEE_OBJECT_STORAGE_SECRET_ACCESS_KEY?: string;
  HULEE_OBJECT_STORAGE_FORCE_PATH_STYLE?: boolean;
}): ObjectStorageConfig | undefined {
  if (
    !env.HULEE_OBJECT_STORAGE_ENDPOINT ||
    !env.HULEE_OBJECT_STORAGE_BUCKET ||
    !env.HULEE_OBJECT_STORAGE_ACCESS_KEY_ID ||
    !env.HULEE_OBJECT_STORAGE_SECRET_ACCESS_KEY
  ) {
    return undefined;
  }

  return {
    endpoint: env.HULEE_OBJECT_STORAGE_ENDPOINT,
    region: env.HULEE_OBJECT_STORAGE_REGION ?? "us-east-1",
    bucket: env.HULEE_OBJECT_STORAGE_BUCKET,
    accessKeyId: env.HULEE_OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.HULEE_OBJECT_STORAGE_SECRET_ACCESS_KEY,
    forcePathStyle: env.HULEE_OBJECT_STORAGE_FORCE_PATH_STYLE ?? true
  };
}

function normalizeWorkerFeatures(
  features: readonly WorkerFeature[] | undefined
): readonly WorkerFeature[] {
  return [...new Set(features ?? defaultWorkerFeatures)];
}

export function loadLocalEnvFile(input?: {
  cwd?: string;
  fileName?: string;
}): EnvSource {
  const cwd = input?.cwd ?? process.cwd();
  const filePath =
    input?.fileName === undefined
      ? (findEnvFile({ cwd, fileName: ".env.local" }) ??
        findEnvFile({ cwd, fileName: "env.local" }))
      : findEnvFile({
          cwd,
          fileName: input.fileName
        });

  if (filePath === null) {
    return {};
  }

  return parseEnvFile(readFileSync(filePath, "utf8"));
}

export function mergeEnvSources(...sources: readonly EnvSource[]): EnvSource {
  return Object.assign({}, ...sources);
}

function parseEnvFile(source: string): EnvSource {
  const env: EnvSource = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripEnvQuotes(line.slice(separatorIndex + 1).trim());

    if (key.length > 0) {
      env[key] = value;
    }
  }

  return env;
}

function findEnvFile(input: { cwd: string; fileName: string }): string | null {
  let currentDirectory = resolve(input.cwd);

  while (true) {
    const candidate = resolve(currentDirectory, input.fileName);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

function stripEnvQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;

    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function parseAllowedOrigins(
  value: string | undefined
): readonly string[] | null {
  if (value === undefined) {
    return [];
  }

  const origins: string[] = [];

  for (const rawOrigin of value.split(",")) {
    const origin = rawOrigin.trim();

    if (origin.length === 0) {
      continue;
    }

    try {
      const url = new URL(origin);

      if (!isHttpUrl(origin) || url.origin === "null") {
        return null;
      }

      origins.push(url.origin);
    } catch {
      return null;
    }
  }

  return [...new Set(origins)];
}
