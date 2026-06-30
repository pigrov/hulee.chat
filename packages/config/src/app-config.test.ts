import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConfigError,
  defaultLocalDatabaseUrl,
  loadLocalEnvFile,
  loadApiConfig,
  loadWebConfig,
  mergeEnvSources,
  loadWorkerConfig
} from "./index";

const localEgressProfile = {
  profileId: "deployment:direct",
  profileKind: "direct",
  status: "ready"
};

describe("app config", () => {
  it("loads development API defaults", () => {
    expect(loadApiConfig({})).toEqual({
      appName: "api",
      nodeEnv: "development",
      deploymentType: "on_prem",
      logLevel: "info",
      databaseUrl: defaultLocalDatabaseUrl,
      secretEncryptionKey: undefined,
      egressProfile: localEgressProfile,
      host: "0.0.0.0",
      port: 3000,
      internalApiSecret: undefined,
      publicBaseUrl: undefined,
      publicWebhookBaseUrl: undefined,
      objectStorage: undefined,
      sseEnabled: true
    });
  });

  it("loads local env files and lets process env override them", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hulee-config-"));
    const nestedCwd = join(cwd, "apps", "api");
    mkdirSync(nestedCwd, { recursive: true });
    writeFileSync(
      join(cwd, "env.local"),
      [
        "# local development",
        "HULEE_PUBLIC_WEBHOOK_BASE_URL=https://local.example/hooks",
        "HULEE_LOG_LEVEL=debug",
        "QUOTED_VALUE='quoted'"
      ].join("\n")
    );

    const localEnv = loadLocalEnvFile({ cwd: nestedCwd });

    expect(localEnv).toMatchObject({
      HULEE_PUBLIC_WEBHOOK_BASE_URL: "https://local.example/hooks",
      HULEE_LOG_LEVEL: "debug",
      QUOTED_VALUE: "quoted"
    });
    expect(
      loadApiConfig(
        mergeEnvSources(localEnv, {
          HULEE_LOG_LEVEL: "warn"
        })
      )
    ).toMatchObject({
      logLevel: "warn",
      publicWebhookBaseUrl: "https://local.example/hooks"
    });
  });

  it("prefers .env.local over legacy env.local", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hulee-config-"));

    writeFileSync(join(cwd, "env.local"), "HULEE_LOG_LEVEL=debug");
    writeFileSync(join(cwd, ".env.local"), "HULEE_LOG_LEVEL=warn");

    expect(loadLocalEnvFile({ cwd })).toMatchObject({
      HULEE_LOG_LEVEL: "warn"
    });
    expect(loadLocalEnvFile({ cwd, fileName: "env.local" })).toMatchObject({
      HULEE_LOG_LEVEL: "debug"
    });
  });

  it("parses worker tuning values from environment strings", () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: "test",
        HULEE_DEPLOYMENT_TYPE: "saas_shared",
        HULEE_LOG_LEVEL: "debug",
        DATABASE_URL: "postgres://user:pass@example.test:5432/hulee",
        HULEE_WORKER_FEATURES: "core, telegram_bot, telegram_bot",
        HULEE_PUBLIC_BASE_URL: "https://chat.example.test",
        HULEE_PUBLIC_WEBHOOK_BASE_URL: "https://hooks.example.test",
        HULEE_WORKER_POLL_INTERVAL_MS: "2500",
        HULEE_OUTBOX_BATCH_SIZE: "25",
        HULEE_OUTBOX_RETRY_DELAY_MS: "45000",
        HULEE_EGRESS_PROBES_ENABLED: "true",
        HULEE_EGRESS_PROBE_INTERVAL_MS: "60000",
        HULEE_EGRESS_PROBE_TIMEOUT_MS: "5000"
      })
    ).toMatchObject({
      appName: "worker",
      nodeEnv: "test",
      deploymentType: "saas_shared",
      logLevel: "debug",
      workerFeatures: ["core", "telegram_bot"],
      publicBaseUrl: "https://chat.example.test",
      publicWebhookBaseUrl: "https://hooks.example.test",
      pollIntervalMs: 2500,
      outboxBatchSize: 25,
      outboxRetryDelayMs: 45000,
      egressProbesEnabled: true,
      egressProbeIntervalMs: 60000,
      egressProbeTimeoutMs: 5000
    });
  });

  it("loads optional worker object storage settings", () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: "test",
        HULEE_OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
        HULEE_OBJECT_STORAGE_REGION: "eu-central-1",
        HULEE_OBJECT_STORAGE_BUCKET: "hulee-files",
        HULEE_OBJECT_STORAGE_ACCESS_KEY_ID: "storage-access",
        HULEE_OBJECT_STORAGE_SECRET_ACCESS_KEY: "storage-secret",
        HULEE_OBJECT_STORAGE_FORCE_PATH_STYLE: "true"
      })
    ).toMatchObject({
      objectStorage: {
        endpoint: "http://localhost:9000",
        region: "eu-central-1",
        bucket: "hulee-files",
        accessKeyId: "storage-access",
        secretAccessKey: "storage-secret",
        forcePathStyle: true
      }
    });

    expect(loadWorkerConfig({})).toMatchObject({
      objectStorage: undefined
    });
  });

  it("loads optional API object storage settings", () => {
    expect(
      loadApiConfig({
        NODE_ENV: "test",
        HULEE_OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
        HULEE_OBJECT_STORAGE_REGION: "eu-central-1",
        HULEE_OBJECT_STORAGE_BUCKET: "hulee-files",
        HULEE_OBJECT_STORAGE_ACCESS_KEY_ID: "storage-access",
        HULEE_OBJECT_STORAGE_SECRET_ACCESS_KEY: "storage-secret",
        HULEE_OBJECT_STORAGE_FORCE_PATH_STYLE: "false"
      })
    ).toMatchObject({
      objectStorage: {
        endpoint: "http://localhost:9000",
        region: "eu-central-1",
        bucket: "hulee-files",
        accessKeyId: "storage-access",
        secretAccessKey: "storage-secret",
        forcePathStyle: false
      }
    });
  });

  it("defaults worker features to core and Telegram Bot for local bootstrap", () => {
    expect(loadWorkerConfig({})).toMatchObject({
      workerFeatures: ["core", "telegram_bot"]
    });
  });

  it("loads development web defaults", () => {
    expect(loadWebConfig({})).toEqual({
      appName: "web",
      nodeEnv: "development",
      deploymentType: "on_prem",
      logLevel: "info",
      databaseUrl: defaultLocalDatabaseUrl,
      secretEncryptionKey: undefined,
      egressProfile: localEgressProfile,
      internalApiBaseUrl: "http://127.0.0.1:4000",
      internalApiSecret: undefined,
      publicBaseUrl: undefined,
      publicWebhookBaseUrl: undefined,
      authChoiceSecret: undefined,
      webAllowedOrigins: [],
      webAuthRequired: true,
      resendToken: undefined,
      emailFrom: undefined
    });
  });

  it("allows explicit local web auth fallback opt-in", () => {
    expect(
      loadWebConfig({
        HULEE_WEB_AUTH_REQUIRED: "false"
      })
    ).toMatchObject({
      webAuthRequired: false
    });
  });

  it("normalizes web allowed origins", () => {
    expect(
      loadWebConfig({
        HULEE_WEB_ALLOWED_ORIGINS:
          "https://chat.example.test/path, https://chat.example.test, http://localhost:3001"
      })
    ).toMatchObject({
      webAllowedOrigins: ["https://chat.example.test", "http://localhost:3001"]
    });
  });

  it("loads the deployment secret encryption key without logging it", () => {
    expect(
      loadApiConfig({
        HULEE_SECRET_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef"
      })
    ).toMatchObject({
      secretEncryptionKey: "0123456789abcdef0123456789abcdef"
    });
  });

  it("defaults production SaaS egress to misconfigured VPN until explicitly ready", () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: "production",
        HULEE_DEPLOYMENT_TYPE: "saas_shared",
        DATABASE_URL: "postgres://user:pass@example.test:5432/hulee"
      })
    ).toMatchObject({
      egressProfile: {
        profileId: "deployment:vpn_namespace",
        profileKind: "vpn_namespace",
        status: "misconfigured",
        lastErrorCode: "validation.failed"
      }
    });

    expect(
      loadWorkerConfig({
        NODE_ENV: "production",
        HULEE_DEPLOYMENT_TYPE: "saas_shared",
        DATABASE_URL: "postgres://user:pass@example.test:5432/hulee",
        HULEE_EGRESS_PROFILE_ID: "hulee-chat-vpn",
        HULEE_EGRESS_PROFILE_KIND: "vpn_namespace",
        HULEE_EGRESS_PROFILE_STATUS: "ready"
      })
    ).toMatchObject({
      egressProfile: {
        profileId: "hulee-chat-vpn",
        profileKind: "vpn_namespace",
        status: "ready"
      }
    });
  });

  it("loads the internal API signing secret without logging it", () => {
    expect(
      loadApiConfig({
        HULEE_INTERNAL_API_SECRET: "internal-secret"
      })
    ).toMatchObject({
      internalApiSecret: "internal-secret"
    });
  });

  it("requires an explicit database URL in production", () => {
    expect(() => loadApiConfig({ NODE_ENV: "production" })).toThrow(
      ConfigError
    );

    try {
      loadApiConfig({ NODE_ENV: "production" });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toEqual([
        {
          variable: "DATABASE_URL",
          message: "must be a valid URL and is required in production"
        }
      ]);
    }
  });

  it("requires an internal API signing secret in production", () => {
    expect(() =>
      loadApiConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@example.test:5432/hulee"
      })
    ).toThrow(ConfigError);

    try {
      loadApiConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@example.test:5432/hulee"
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toEqual([
        {
          variable: "HULEE_INTERNAL_API_SECRET",
          message: "must be set in production"
        }
      ]);
    }
  });

  it("requires web production security settings", () => {
    expect(() =>
      loadWebConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@example.test:5432/hulee"
      })
    ).toThrow(ConfigError);

    try {
      loadWebConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@example.test:5432/hulee"
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toEqual([
        {
          variable: "HULEE_INTERNAL_API_SECRET",
          message: "must be set in production"
        },
        {
          variable: "HULEE_PUBLIC_BASE_URL",
          message: "must be set in production"
        }
      ]);
    }
  });

  it("rejects invalid web allowed origins without echoing values", () => {
    expect(() =>
      loadWebConfig({
        HULEE_WEB_ALLOWED_ORIGINS:
          "https://valid.example, ftp://files.example, not-a-url"
      })
    ).toThrow(ConfigError);

    try {
      loadWebConfig({
        HULEE_WEB_ALLOWED_ORIGINS:
          "https://valid.example, ftp://files.example, not-a-url"
      });
    } catch (error) {
      expect(String(error)).not.toContain("not-a-url");
      expect(String(error)).not.toContain("ftp://files.example");
      expect((error as ConfigError).issues).toEqual([
        {
          variable: "HULEE_WEB_ALLOWED_ORIGINS",
          message: "must be a comma-separated list of valid URL origins"
        }
      ]);
    }
  });

  it("does not echo invalid environment values in errors", () => {
    const secretLikeValue = "postgres://user:secret@example.test";

    expect(() =>
      loadApiConfig({
        DATABASE_URL: secretLikeValue,
        HULEE_API_PORT: "not-a-port"
      })
    ).toThrow(ConfigError);

    try {
      loadApiConfig({
        DATABASE_URL: secretLikeValue,
        HULEE_API_PORT: "not-a-port"
      });
    } catch (error) {
      expect(String(error)).not.toContain(secretLikeValue);
      expect(String(error)).not.toContain("not-a-port");
      expect((error as ConfigError).issues).toEqual([
        {
          variable: "HULEE_API_PORT",
          message: "must be an integer from 1 to 65535"
        }
      ]);
    }
  });

  it("rejects unknown worker features without echoing values", () => {
    expect(() =>
      loadWorkerConfig({
        HULEE_WORKER_FEATURES: "core,unknown-provider-feature"
      })
    ).toThrow(ConfigError);

    try {
      loadWorkerConfig({
        HULEE_WORKER_FEATURES: "core,unknown-provider-feature"
      });
    } catch (error) {
      expect(String(error)).not.toContain("unknown-provider-feature");
      expect((error as ConfigError).issues).toEqual([
        {
          variable: "HULEE_WORKER_FEATURES",
          message:
            "must be a comma-separated list of worker features: core, webhooks, telegram_bot, telegram_user, whatsapp_user, whatsapp_official or max_user"
        }
      ]);
    }
  });
});
