import { describe, expect, it } from "vitest";

import { validateInboxV2CleanSlateBoundary as validateInboxV2CleanSlateFreeze } from "./inbox-v2-clean-slate-check.mjs";

const validInput = Object.freeze({
  deployWorkflow: `on:
  workflow_run:
    workflows:
      - Check
    types:
      - completed
    branches:
      - main

env:
  TARGET_SHA: \${{ github.event.workflow_run.head_sha }}

jobs:
  deploy:
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'main' &&
      github.event.workflow_run.head_repository.full_name == github.repository
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ env.TARGET_SHA }}
      - name: Refuse a superseded main revision
        run: |
          latest_main_sha=$(git ls-remote origin refs/heads/main | cut -f1)
          if [ -z "$latest_main_sha" ] || [ "$latest_main_sha" != "$TARGET_SHA" ]; then
            exit 1
          fi
      - name: Deploy V2-only runtime
        env:
          SSH_KEY: \${{ secrets.DEPLOY_SSH_KEY }}
        run: |
          for retired_bootstrap_key in HULEE_SEED_API_KEY HULEE_PLATFORM_ADMIN_PASS; do
            grep "$retired_bootstrap_key" .env && exit 1
          done
          docker build --build-arg "HULEE_BUILD_REVISION=\${{ env.TARGET_SHA }}" -t "$IMAGE_NAME:\${{ env.TARGET_SHA }}" .
          docker push "$IMAGE_NAME:\${{ env.TARGET_SHA }}"
          HULEE_IMAGE=$IMAGE_NAME:\${{ env.TARGET_SHA }}
          "\${compose[@]}" run --rm -T migrate pnpm db:inbox-v2:preflight </dev/null
          docker stop --time 30 "$stale_runtime"
          docker rm "$stale_runtime"
          "\${compose[@]}" run --rm -T migrate </dev/null`,
  checkWorkflow: `name: Check
concurrency:
  group: check-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
pnpm test:inbox-v2:postgres
pnpm test:inbox-v2:conversation-head-integrity
inbox-v2-disposable-lifecycle:
inbox-v2-production-runtime-smoke:
Prove a stale declared epoch fails before worker startup
inbox_v2.runtime_schema_epoch_mismatch
timeout --signal=TERM 30s docker run`,
  configSource: `const defaultWorkerFeatures: readonly WorkerFeature[] = ["core"];`,
  adr: `clean-slate-2026-07-20-r1`,
  backlog: "`INB2-CLEAN-001` clean-slate-2026-07-20-r1",
  migrationStrategy: `clean-slate-2026-07-20-r1`,
  agentInstructions: `docs/adr/0016-inbox-v2-preproduction-clean-slate.md`,
  packageSource: JSON.stringify({
    scripts: {
      check: "pnpm test && pnpm inbox-v2:clean-slate:check",
      "inbox-v2:clean-slate:check":
        "node scripts/checks/inbox-v2-clean-slate-check.mjs",
      "db:inbox-v2:preflight": "node scripts/db/preflight-inbox-v2.mjs",
      "db:seed:foundation": "tsx scripts/db/seed-foundation.ts"
    }
  }),
  apiIndexSource: `
    commands: createCleanSlatePublicApiCommandService(),
    integrations: createInternalIntegrationService({
      connectorRepository: repository,
      providerIoEnabled: false
    })
    return createCleanSlateTelegramWebhookHandler();`,
  workerRunnerSource: `
    const runtime = createWorkerRuntime();
    await assertInboxV2RuntimeSchemaEpoch(database);
    runtime.logger.info("worker.started");
    createWorkerSecurityDenialRetentionSweeper({ database });`,
  apiStartupSource: `
    await assertInboxV2RuntimeSchemaEpoch(database);
    server.listen(port);`,
  apiHealthSource: `return { schemaEpoch: evidence.epoch, buildRevision: revision };`,
  webPackageSource: JSON.stringify({
    scripts: {
      start:
        "tsx src/assert-production-schema.ts && next start --hostname 0.0.0.0 --port 3000"
    }
  }),
  runtimeSchemaGuardSource: `export const INBOX_V2_RUNTIME_SCHEMA_EPOCH =
    "preproduction-inbox-v2-1" as const;`,
  dockerfileSource: `
    LABEL org.opencontainers.image.revision=$HULEE_BUILD_REVISION
    LABEL io.hulee.schema-epoch=$HULEE_SCHEMA_EPOCH`,
  v1Allowlist: "Status: `verified`\nPublic API `/v1`",
  webInboxPageSource: `
    export default function InboxPage() {
      return t("inbox.cleanSlate.title");
    }`,
  foundationSeedSource: `
    const registration = registerTenant(input);
    createTenantRegistrationRepository(database).registerTenant({ registration });`,
  productionCompose: `services:
  postgres:
    image: postgres:16-alpine
  migrate:
    command: ["pnpm", "db:migrate"]
  seed:
    command: ["pnpm", "db:seed:foundation"]
  worker:
    environment:
      HULEE_WORKER_FEATURES: core
      HULEE_SCHEMA_EPOCH: preproduction-inbox-v2-1
      HULEE_EGRESS_PROFILE_KIND: disabled
      HULEE_EGRESS_PROFILE_STATUS: unavailable
      HULEE_EGRESS_PROBES_ENABLED: "false"
    command: ["pnpm", "--filter", "@hulee/worker", "start"]
    healthcheck:
      test: ["CMD-SHELL", "grep -q -- '@hulee/worker' /proc/1/cmdline"]
  web:
    environment:
      HULEE_WEB_EMPLOYEE_ID: \${HULEE_WEB_EMPLOYEE_ID:-employee_local_1}
    command: ["pnpm", "--filter", "@hulee/web", "start"]
  site:
    image: \${HULEE_IMAGE:?HULEE_IMAGE is required}
    environment:
      NODE_ENV: production`,
  legacyFilePaths: Object.freeze([]),
  runtimeSources: Object.freeze([])
});

describe("Inbox V2 clean-slate boundary check", () => {
  it("accepts a successful full-Check handoff and retained V2 gates", () => {
    expect(validateInboxV2CleanSlateFreeze(validInput)).toEqual([]);
  });

  it("rejects a Web identity outside the deterministic foundation seed", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      productionCompose: validInput.productionCompose.replace(
        "employee_local_1",
        "employee:local-dev"
      )
    });

    expect(issues).toContain(
      "production Web identity must match the deterministic foundation seed"
    );
  });

  it.each(["postgres", "site"])(
    "rejects application secret inheritance by %s",
    (service) => {
      const productionCompose = validInput.productionCompose.replace(
        `  ${service}:\n`,
        `  ${service}:\n    env_file:\n      - .env\n`
      );

      expect(
        validateInboxV2CleanSlateFreeze({
          ...validInput,
          productionCompose
        })
      ).toContain(
        `${service} must not receive the application secret environment file`
      );
    }
  );

  it("requires ordinary deploys to reject raw bootstrap credentials", () => {
    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        deployWorkflow: validInput.deployWorkflow.replace(
          "HULEE_SEED_API_KEY HULEE_PLATFORM_ADMIN_PASS",
          "REMOVED_BOOTSTRAP_CREDENTIALS"
        )
      })
    ).toContain(
      "ordinary deployment must reject raw one-time bootstrap credentials"
    );
  });

  it("does not accept Check-handoff or bootstrap guards that exist only in comments", () => {
    const deployWorkflow = validInput.deployWorkflow
      .replace(
        "  workflow_run:\n    workflows:\n      - Check\n    types:\n      - completed\n    branches:\n      - main\n",
        "  workflow_run:\n    # workflows:\n    #   - Check\n    # types:\n    #   - completed\n    # branches:\n    #   - main\n"
      )
      .replace(
        "          for retired_bootstrap_key in HULEE_SEED_API_KEY HULEE_PLATFORM_ADMIN_PASS; do",
        "          # for retired_bootstrap_key in HULEE_SEED_API_KEY HULEE_PLATFORM_ADMIN_PASS; do"
      );

    expect(
      validateInboxV2CleanSlateFreeze({ ...validInput, deployWorkflow })
    ).toEqual(
      expect.arrayContaining([
        "deployment must wait for the completed full Check workflow on main",
        "ordinary deployment must reject raw one-time bootstrap credentials"
      ])
    );
  });

  it("rejects a provider-enabled worker default", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      configSource: `const defaultWorkerFeatures: readonly WorkerFeature[] = ["core", "telegram_bot"];`
    });

    expect(issues).toContain(
      "a worker without explicit features must be provider-free"
    );
  });

  it.each([
    ["flow-style trigger", `on: [workflow_run]`],
    [
      "missing workflow run",
      validInput.deployWorkflow.replace(
        "  workflow_run:\n    workflows:\n      - Check\n    types:\n      - completed\n    branches:\n      - main\n",
        ""
      )
    ],
    [
      "scheduled trigger",
      validInput.deployWorkflow.replace(
        "  workflow_run:",
        "  workflow_run:\n  schedule:\n    - cron: '0 0 * * *'"
      )
    ],
    [
      "direct push trigger",
      validInput.deployWorkflow.replace(
        "  workflow_run:",
        "  workflow_run:\n  push:"
      )
    ]
  ])("rejects %s", (_label, deployWorkflow) => {
    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        deployWorkflow
      })
    ).toContain(
      "deploy workflow trigger must be exactly the completed Check workflow"
    );
  });

  it("rejects Check handoff from a non-main branch", () => {
    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        deployWorkflow: validInput.deployWorkflow.replace("- main", "- dev")
      })
    ).toContain(
      "deployment must wait for the completed full Check workflow on main"
    );
  });

  it.each([
    [
      "github.event.workflow_run.conclusion == 'success'",
      "deployment must require a successful full Check workflow"
    ],
    [
      "github.event.workflow_run.event == 'push'",
      "deployment must reject pull-request Check runs"
    ],
    [
      "github.event.workflow_run.head_branch == 'main'",
      "deployment must require a checked main-branch revision"
    ],
    [
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "deployment must require a Check run from the same repository"
    ]
  ])("requires Check handoff guard %s", (guard, message) => {
    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        deployWorkflow: validInput.deployWorkflow.replace(guard, "true")
      })
    ).toContain(message);
  });

  it("requires the checked head SHA and rejects workflow-run github.sha", () => {
    const deployWorkflow = validInput.deployWorkflow.replace(
      "TARGET_SHA: ${{ github.event.workflow_run.head_sha }}",
      "TARGET_SHA: ${{ github.sha }}"
    );

    expect(
      validateInboxV2CleanSlateFreeze({ ...validInput, deployWorkflow })
    ).toEqual(
      expect.arrayContaining([
        "deployment must bind the exact SHA that passed the full Check workflow",
        "workflow-run deployment must not build the unrelated event github.sha"
      ])
    );
  });

  it("pins checkout, image build, tag, push and release to TARGET_SHA", () => {
    const deployWorkflow = validInput.deployWorkflow.replaceAll(
      "${{ env.TARGET_SHA }}",
      "latest"
    );

    expect(
      validateInboxV2CleanSlateFreeze({ ...validInput, deployWorkflow })
    ).toEqual(
      expect.arrayContaining([
        "deployment checkout must use the exact checked TARGET_SHA",
        "production image revision must use the exact checked TARGET_SHA",
        "production image tag must use the exact checked TARGET_SHA",
        "production image push must use the exact checked TARGET_SHA",
        "release environment must use the exact checked TARGET_SHA"
      ])
    );
  });

  it("rejects removal of the superseded-main revision fence", () => {
    const deployWorkflow = validInput.deployWorkflow
      .replace("git ls-remote origin refs/heads/main", "echo stale")
      .replace(
        '[ "$latest_main_sha" != "$TARGET_SHA" ]',
        '[ "$latest_main_sha" = "$TARGET_SHA" ]'
      );

    expect(
      validateInboxV2CleanSlateFreeze({ ...validInput, deployWorkflow })
    ).toEqual(
      expect.arrayContaining([
        "deployment must resolve the current main revision before using secrets",
        "deployment must reject a checked revision superseded on main"
      ])
    );
  });

  it("requires the superseded-main fence before secret-bearing steps", () => {
    const deployWorkflow = `${validInput.deployWorkflow.replace(
      "git ls-remote origin refs/heads/main",
      "echo delayed-revision-fence"
    )}\ngit ls-remote origin refs/heads/main`;

    expect(
      validateInboxV2CleanSlateFreeze({ ...validInput, deployWorkflow })
    ).toContain(
      "deployment must reject a superseded revision before secret-bearing steps"
    );
  });

  it("requires superseded full Check runs to be cancelled per branch", () => {
    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        checkWorkflow: validInput.checkWorkflow.replace(
          "  cancel-in-progress: true",
          "  cancel-in-progress: false"
        )
      })
    ).toContain(
      "full Check workflow must cancel superseded runs for the same branch"
    );
  });

  it("requires the full Check workflow name used by the handoff", () => {
    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        checkWorkflow: validInput.checkWorkflow.replace(
          "name: Check",
          "name: Verify"
        )
      })
    ).toContain("full Check workflow name must match the deployment handoff");
  });

  it.each([
    "HULEE_CLEAN_SLATE_DEPLOY_UNLOCKED",
    "DEPLOY_CLEAN_SLATE_V2",
    "bootstrap_foundation",
    "inputs.confirmation"
  ])("rejects retired temporary gate token %s", (retiredGateToken) => {
    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        deployWorkflow: `${validInput.deployWorkflow}\n# ${retiredGateToken}`
      })
    ).toContain(
      `completed clean-slate gate must not retain ${retiredGateToken}`
    );
  });

  it("rejects removal of retained V2 integrity coverage", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      checkWorkflow: `inbox-v2-preserve-upgrade:`
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "preserve/N-1 CI must not remain active",
        "V2 Conversation-head integrity coverage must remain active",
        "V2 PostgreSQL repository coverage must remain active",
        "disposable install/reset coverage must remain active"
      ])
    );
  });

  it("rejects runtime composition that can start before the schema epoch fence", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      apiStartupSource: `server.listen(port);`,
      workerRunnerSource: `runtime.logger.info("worker.started");`,
      webPackageSource: JSON.stringify({
        scripts: { start: "next start --hostname 0.0.0.0 --port 3000" }
      }),
      productionCompose: validInput.productionCompose.replace(
        "HULEE_EGRESS_PROFILE_KIND: disabled",
        "HULEE_EGRESS_PROFILE_KIND: direct"
      )
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "API must verify the exact schema epoch before opening its listener",
        "worker must verify the exact schema epoch before starting background work",
        "Web production start must verify the exact schema epoch first",
        "production compose must pin the disabled egress profile"
      ])
    );
  });

  it("requires the read-only migration preflight before stopping the live runtime", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      deployWorkflow: validInput.deployWorkflow.replace(
        '          "${compose[@]}" run --rm -T migrate pnpm db:inbox-v2:preflight </dev/null\n          docker stop --time 30 "$stale_runtime"',
        '          docker stop --time 30 "$stale_runtime"\n          "${compose[@]}" run --rm -T migrate pnpm db:inbox-v2:preflight </dev/null'
      )
    });

    expect(issues).toContain(
      "deployment must preflight the exact migration journal before stopping old data-plane runtimes"
    );
  });

  it("requires old data-plane writers to stop before the mutating migration", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      deployWorkflow: validInput.deployWorkflow.replace(
        '          docker rm "$stale_runtime"\n          "${compose[@]}" run --rm -T migrate </dev/null',
        '          "${compose[@]}" run --rm -T migrate </dev/null\n          docker rm "$stale_runtime"'
      )
    });

    expect(issues).toContain(
      "deployment must stop old data-plane writers before applying migrations"
    );
  });

  it.each([
    ["preserve tests", "pnpm test:inbox-v2:preserve"],
    ["N-1 bundle", "pnpm db:inbox-v2:n1-bundle"]
  ])("rejects a renamed CI job that still runs %s", (_label, command) => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      checkWorkflow: `${validInput.checkWorkflow}\n${command}`
    });

    expect(issues).toContain(
      command.includes("preserve")
        ? "preserve test command must not remain active in CI"
        : "N-1 bundle command must not remain active in CI"
    );
  });

  it("rejects removal of the guard from pnpm check", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      packageSource: JSON.stringify({
        scripts: {
          check: "pnpm test",
          "inbox-v2:clean-slate:check":
            "node scripts/checks/inbox-v2-clean-slate-check.mjs"
        }
      })
    });

    expect(issues).toContain("pnpm check must execute the clean-slate guard");
  });

  it("rejects re-composing V1 API message, Inbox and Telegram services", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      apiIndexSource: `${validInput.apiIndexSource}
        const messages = createExternalMessageRepository(database);
        inboxQueries: createSqlInternalInboxQueryService(database),
        return createTelegramWebhookHandler(options);`
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "API production composition must not create a V1 message service",
        "API production composition must not create V1 Inbox services",
        "API production composition must not create a V1 Telegram webhook service"
      ])
    );
  });

  it("rejects provider I/O enabled or omitted from API integration composition", () => {
    for (const apiIndexSource of [
      validInput.apiIndexSource.replace(
        "providerIoEnabled: false",
        "providerIoEnabled: true"
      ),
      validInput.apiIndexSource.replace("providerIoEnabled: false", "")
    ]) {
      expect(
        validateInboxV2CleanSlateFreeze({ ...validInput, apiIndexSource })
      ).toContain("API integration composition must disable provider I/O");
    }
  });

  it("rejects provider outbound, polling and direct-account worker loops", () => {
    const workerRunnerSource = `${validInput.workerRunnerSource}
      createWorkerOutboxHandler(options);
      createWorkerTelegramPollingSweeper(options);
      createWorkerDirectAccountSessionMonitor(options);`;

    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        workerRunnerSource
      })
    ).toContain(
      "worker production runner must not compose provider polling, outbound or direct-account loops"
    );
  });

  it("rejects a V1 Inbox Web root", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      webInboxPageSource: `${validInput.webInboxPageSource}\nloadInboxViewModel();`
    });

    expect(issues).toContain("Web root must not load the V1 Inbox view model");
  });

  it("rejects deleted V1 files and residual implementation symbols", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      legacyFilePaths: ["apps/web/src/inbox-api-client.ts"],
      runtimeSources: [
        {
          path: "apps/api/src/legacy.ts",
          source: `createInternalInboxCommandService();`
        },
        {
          path: "packages/db/src/outbox.test.ts",
          source: `const type = "message.sent";`
        }
      ]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("apps/web/src/inbox-api-client.ts"),
        expect.stringContaining(
          "apps/api/src/legacy.ts, packages/db/src/outbox.test.ts"
        )
      ])
    );
  });

  it("rejects an MVP seed command and provider-egress production services", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      packageSource: validInput.packageSource.replace(
        '"db:seed:foundation":"tsx scripts/db/seed-foundation.ts"',
        '"db:seed:mvp":"tsx scripts/db/seed-mvp.ts"'
      ),
      productionCompose: `${validInput.productionCompose.replace(
        "HULEE_WORKER_FEATURES: core",
        "HULEE_WORKER_FEATURES: ${HULEE_WORKER_FEATURES:-core}"
      )}
  egress-gateway:
    image: gateway
  worker-provider-egress:
    command: ["pnpm", "db:seed:mvp"]`
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "package scripts must not expose the V1 MVP seed",
        "package.json must expose the foundation-only seed command",
        "production compose must not invoke the V1 MVP seed",
        "production compose must not define a provider worker or egress gateway",
        "production worker must set HULEE_WORKER_FEATURES to the literal core value"
      ])
    );
  });

  it("rejects the historical preserve installer in production compose", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      productionCompose: validInput.productionCompose.replace(
        'command: ["pnpm", "db:migrate"]',
        'command: ["pnpm", "db:inbox-v2:install", "--", "--allow-reviewed-online-bridge"]'
      )
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "production compose must use the clean-slate migration runner",
        "production compose must not invoke the historical preserve installer"
      ])
    );
  });

  it("rejects demo client, conversation, message and provider config in the foundation seed", () => {
    const foundationSeedSource = `${validInput.foundationSeedSource}
      createMvpTenantWorkspace({
        clientDisplayName: "Seed Client",
        inboundMessageId: "message-1",
        conversationId: "conversation-1",
        providerConfig: { telegram: true }
      });`;

    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        foundationSeedSource
      })
    ).toContain("foundation seed must not create demo Inbox or provider state");
  });
});
