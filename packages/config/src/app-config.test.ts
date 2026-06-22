import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConfigError,
  defaultLocalDatabaseUrl,
  loadLocalEnvFile,
  loadApiConfig,
  mergeEnvSources,
  loadWorkerConfig
} from "./index";

describe("app config", () => {
  it("loads development API defaults", () => {
    expect(loadApiConfig({})).toEqual({
      appName: "api",
      nodeEnv: "development",
      deploymentType: "on_prem",
      logLevel: "info",
      databaseUrl: defaultLocalDatabaseUrl,
      secretEncryptionKey: undefined,
      host: "0.0.0.0",
      port: 3000,
      publicBaseUrl: undefined,
      publicWebhookBaseUrl: undefined,
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
        HULEE_WORKER_POLL_INTERVAL_MS: "2500",
        HULEE_OUTBOX_BATCH_SIZE: "25",
        HULEE_OUTBOX_RETRY_DELAY_MS: "45000"
      })
    ).toMatchObject({
      appName: "worker",
      nodeEnv: "test",
      deploymentType: "saas_shared",
      logLevel: "debug",
      pollIntervalMs: 2500,
      outboxBatchSize: 25,
      outboxRetryDelayMs: 45000
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
});
