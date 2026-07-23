import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");

const removedInboxV1Paths = Object.freeze([
  "apps/api/src/external-channel-command-service.test.ts",
  "apps/api/src/external-channel-command-service.ts",
  "apps/api/src/http/telegram-webhook-handler.test.ts",
  "apps/api/src/http/telegram-webhook-handler.ts",
  "apps/api/src/internal-file-service.test.ts",
  "apps/api/src/internal-file-service.ts",
  "apps/api/src/internal-inbox-service.test.ts",
  "apps/api/src/internal-inbox-service.ts",
  "apps/api/src/public-api-command-service.test.ts",
  "apps/api/src/public-api-command-service.ts",
  "apps/web/app/files/[fileId]/route.ts",
  "apps/web/src/conversation-reply-options.test.ts",
  "apps/web/src/conversation-reply-options.ts",
  "apps/web/src/conversation-routing-options.test.ts",
  "apps/web/src/conversation-routing-options.ts",
  "apps/web/src/inbox-action-form.tsx",
  "apps/web/src/inbox-action-state.ts",
  "apps/web/src/inbox-action-status.test.ts",
  "apps/web/src/inbox-action-status.ts",
  "apps/web/src/inbox-api-client.test.ts",
  "apps/web/src/inbox-api-client.ts",
  "apps/web/src/inbox-queue-options.test.ts",
  "apps/web/src/inbox-queue-options.ts",
  "apps/worker/src/outbox-processor.test.ts",
  "apps/worker/src/outbox-processor.ts",
  "apps/worker/src/telegram-attachment-transfer.test.ts",
  "apps/worker/src/telegram-attachment-transfer.ts",
  "apps/worker/src/telegram-outbound-dispatcher.test.ts",
  "apps/worker/src/telegram-outbound-dispatcher.ts",
  "apps/worker/src/telegram-polling-sweeper.test.ts",
  "apps/worker/src/telegram-polling-sweeper.ts",
  "packages/core/src/conversation-routing.test.ts",
  "packages/core/src/conversation-routing.ts",
  "packages/core/src/external-channel-command-service.ts",
  "packages/core/src/external-message.test.ts",
  "packages/core/src/vertical-slice.test.ts",
  "packages/core/src/vertical-slice.ts",
  "packages/db/src/repositories/external-message-repository.ts",
  "packages/db/src/repositories/sql-attachment-transfer-repository.ts",
  "packages/db/src/repositories/sql-file-access-repository.ts",
  "packages/db/src/repositories/sql-outbound-dispatch-repository.ts",
  "packages/modules/src/public-api-channel.test.ts"
]);

const removedInboxV1SymbolPattern =
  /\b(?:InternalInboxConversation|InternalInboxMessage|InternalInboxViewResponse|InternalInboxReply|InternalInboxRouting|createExternalMessageRepository|createExternalChannelCommandService|createPublicApiCommandService|createInternalInboxCommandService|createSqlInternalInboxAuthorizationService|createSqlInternalInboxQueryService|createInternalFileService|createTelegramChannelAdapter|normalizeTelegramIncomingMessage|createTelegramWebhookHandler|createWorkerOutboxHandler|createWorkerTelegramPollingSweeper|createWorkerTelegramAttachmentTransferSweeper)\b|["'](?:message\.sent|conversation\.routing\.updated)["']/u;

export function validateInboxV2CleanSlateBoundary(input) {
  const issues = [];
  const activeDeployWorkflow = stripYamlCommentLines(input.deployWorkflow);
  const activeCheckWorkflow = stripYamlCommentLines(input.checkWorkflow);

  const deployTriggers = parseWorkflowTriggers(activeDeployWorkflow);
  if (deployTriggers.length !== 1 || deployTriggers[0] !== "workflow_run") {
    issues.push(
      "deploy workflow trigger must be exactly the completed Check workflow"
    );
  }
  requireText(
    issues,
    activeDeployWorkflow,
    "  workflow_run:\n    workflows:\n      - Check\n    types:\n      - completed\n    branches:\n      - main",
    "deployment must wait for the completed full Check workflow on main"
  );
  for (const [guard, message] of [
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
  ]) {
    requireText(issues, activeDeployWorkflow, guard, message);
  }
  requireText(
    issues,
    activeDeployWorkflow,
    "TARGET_SHA: ${{ github.event.workflow_run.head_sha }}",
    "deployment must bind the exact SHA that passed the full Check workflow"
  );
  forbidText(
    issues,
    activeDeployWorkflow,
    "${{ github.sha }}",
    "workflow-run deployment must not build the unrelated event github.sha"
  );
  for (const [binding, message] of [
    [
      "ref: ${{ env.TARGET_SHA }}",
      "deployment checkout must use the exact checked TARGET_SHA"
    ],
    [
      '--build-arg "HULEE_BUILD_REVISION=${{ env.TARGET_SHA }}"',
      "production image revision must use the exact checked TARGET_SHA"
    ],
    [
      '-t "$IMAGE_NAME:${{ env.TARGET_SHA }}"',
      "production image tag must use the exact checked TARGET_SHA"
    ],
    [
      'docker push "$IMAGE_NAME:${{ env.TARGET_SHA }}"',
      "production image push must use the exact checked TARGET_SHA"
    ],
    [
      "HULEE_IMAGE=$IMAGE_NAME:${{ env.TARGET_SHA }}",
      "release environment must use the exact checked TARGET_SHA"
    ]
  ]) {
    requireText(issues, activeDeployWorkflow, binding, message);
  }
  requireText(
    issues,
    activeDeployWorkflow,
    "git ls-remote origin refs/heads/main",
    "deployment must resolve the current main revision before using secrets"
  );
  requireText(
    issues,
    activeDeployWorkflow,
    '[ "$latest_main_sha" != "$TARGET_SHA" ]',
    "deployment must reject a checked revision superseded on main"
  );
  requireInOrder(
    issues,
    activeDeployWorkflow,
    "git ls-remote origin refs/heads/main",
    "${{ secrets.",
    "deployment must reject a superseded revision before secret-bearing steps"
  );
  requireText(
    issues,
    activeCheckWorkflow,
    "concurrency:\n  group: check-${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true",
    "full Check workflow must cancel superseded runs for the same branch"
  );
  requireText(
    issues,
    activeCheckWorkflow,
    "name: Check",
    "full Check workflow name must match the deployment handoff"
  );
  for (const retiredGateToken of [
    "HULEE_CLEAN_SLATE_DEPLOY_UNLOCKED",
    "DEPLOY_CLEAN_SLATE_V2",
    "bootstrap_foundation",
    "inputs.confirmation"
  ]) {
    forbidText(
      issues,
      input.deployWorkflow,
      retiredGateToken,
      `completed clean-slate gate must not retain ${retiredGateToken}`
    );
  }
  requireText(
    issues,
    activeDeployWorkflow,
    "HULEE_SEED_API_KEY HULEE_PLATFORM_ADMIN_PASS",
    "ordinary deployment must reject raw one-time bootstrap credentials"
  );

  forbidText(
    issues,
    input.checkWorkflow,
    "inbox-v2-preserve-upgrade:",
    "preserve/N-1 CI must not remain active"
  );
  forbidText(
    issues,
    input.checkWorkflow,
    "pnpm test:inbox-v2:preserve",
    "preserve test command must not remain active in CI"
  );
  forbidText(
    issues,
    input.checkWorkflow,
    "pnpm db:inbox-v2:n1-bundle",
    "N-1 bundle command must not remain active in CI"
  );
  requireText(
    issues,
    input.checkWorkflow,
    "pnpm test:inbox-v2:conversation-head-integrity",
    "V2 Conversation-head integrity coverage must remain active"
  );
  requireText(
    issues,
    input.checkWorkflow,
    "pnpm test:inbox-v2:postgres",
    "V2 PostgreSQL repository coverage must remain active"
  );
  requireText(
    issues,
    input.checkWorkflow,
    "inbox-v2-disposable-lifecycle:",
    "disposable install/reset coverage must remain active"
  );
  requireText(
    issues,
    input.checkWorkflow,
    "inbox-v2-production-runtime-smoke:",
    "production API/Web/worker startup smoke must remain active"
  );
  requireText(
    issues,
    input.checkWorkflow,
    "Prove a stale declared epoch fails before worker startup",
    "production smoke must prove that a stale declared epoch fails closed"
  );
  requireText(
    issues,
    input.checkWorkflow,
    "inbox_v2.runtime_schema_epoch_mismatch",
    "stale-epoch smoke must require the exact mismatch diagnostic"
  );
  requireText(
    issues,
    input.checkWorkflow,
    "timeout --signal=TERM 30s docker run",
    "stale-epoch smoke must have a bounded process timeout"
  );

  requireMatch(
    issues,
    input.configSource,
    /const defaultWorkerFeatures:[^=]+=\s*\[\s*"core"\s*\];/su,
    "a worker without explicit features must be provider-free"
  );

  validateRuntimeDetachment(issues, input);
  validateRuntimeSchemaEpochBoundary(issues, input);
  validateRemovedInboxV1Implementation(issues, input);
  requireText(
    issues,
    input.v1Allowlist,
    "Status: `verified`",
    "the V1 ownership allowlist must remain verified"
  );
  requireText(
    issues,
    input.v1Allowlist,
    "Public API `/v1`",
    "the V1 ownership allowlist must retain the Public API distinction"
  );

  for (const [label, source] of [
    ["ADR 0016", input.adr],
    ["canonical backlog", input.backlog],
    ["migration strategy", input.migrationStrategy]
  ]) {
    requireText(
      issues,
      source,
      "clean-slate-2026-07-20-r1",
      `${label} must bind the active clean-slate disposition revision`
    );
  }
  requireText(
    issues,
    input.backlog,
    "`INB2-CLEAN-001`",
    "canonical backlog must contain CLEAN-001"
  );
  requireText(
    issues,
    input.agentInstructions,
    "docs/adr/0016-inbox-v2-preproduction-clean-slate.md",
    "Inbox V2 agents must read the active clean-slate ADR"
  );

  validatePackageScripts(issues, input.packageSource);

  return Object.freeze(issues);
}

async function main() {
  const [
    deployWorkflow,
    checkWorkflow,
    configSource,
    adr,
    backlog,
    migrationStrategy,
    agentInstructions,
    packageSource,
    apiIndexSource,
    workerRunnerSource,
    webInboxPageSource,
    foundationSeedSource,
    productionCompose,
    apiStartupSource,
    apiHealthSource,
    webPackageSource,
    runtimeSchemaGuardSource,
    dockerfileSource,
    v1Allowlist,
    legacyFilePaths,
    runtimeSources
  ] = await Promise.all(
    [
      ".github/workflows/deploy.yml",
      ".github/workflows/check.yml",
      "packages/config/src/index.ts",
      "docs/adr/0016-inbox-v2-preproduction-clean-slate.md",
      "docs/product/inbox-v2-backlog.md",
      "docs/product/inbox-v2-migration-and-cutover.md",
      "AGENTS.md",
      "package.json",
      "apps/api/src/index.ts",
      "apps/worker/src/runner.ts",
      "apps/web/app/page.tsx",
      "scripts/db/seed-foundation.ts",
      "deploy/production/docker-compose.yml",
      "apps/api/src/dev-server.ts",
      "apps/api/src/http/internal-api-handler.ts",
      "apps/web/package.json",
      "packages/db/src/inbox-v2-runtime-schema-guard.ts",
      "deploy/docker/Dockerfile",
      "docs/product/inbox-v2-clean-gate-v1-allowlist.md"
    ]
      .map((path) => readFile(resolve(repositoryRoot, path), "utf8"))
      .concat([
        findExistingPaths(removedInboxV1Paths),
        collectRuntimeSources(["apps", "packages"])
      ])
  );
  const issues = validateInboxV2CleanSlateBoundary({
    deployWorkflow,
    checkWorkflow,
    configSource,
    adr,
    backlog,
    migrationStrategy,
    agentInstructions,
    packageSource,
    apiIndexSource,
    workerRunnerSource,
    webInboxPageSource,
    foundationSeedSource,
    productionCompose,
    apiStartupSource,
    apiHealthSource,
    webPackageSource,
    runtimeSchemaGuardSource,
    dockerfileSource,
    v1Allowlist,
    legacyFilePaths,
    runtimeSources
  });
  if (issues.length > 0) {
    throw new Error(
      `Inbox V2 clean-slate boundary check failed:\n- ${issues.join("\n- ")}`
    );
  }
  console.log(
    "Inbox V2 clean-slate deployment boundary and runtime detachment passed."
  );
}

function validateRuntimeSchemaEpochBoundary(issues, input) {
  const epoch = "preproduction-inbox-v2-1";
  requireText(
    issues,
    input.runtimeSchemaGuardSource,
    `"${epoch}" as const`,
    "runtime schema guard must pin the active clean-slate epoch"
  );
  requireInOrder(
    issues,
    input.apiStartupSource,
    "await assertInboxV2RuntimeSchemaEpoch(database)",
    "server.listen(",
    "API must verify the exact schema epoch before opening its listener"
  );
  requireInOrder(
    issues,
    input.workerRunnerSource,
    "await assertInboxV2RuntimeSchemaEpoch(database)",
    'runtime.logger.info("worker.started"',
    "worker must verify the exact schema epoch before starting background work"
  );
  requireInOrder(
    issues,
    input.deployWorkflow,
    '"${compose[@]}" run --rm -T migrate pnpm db:inbox-v2:preflight </dev/null',
    'docker stop --time 30 "$stale_runtime"',
    "deployment must preflight the exact migration journal before stopping old data-plane runtimes"
  );
  requireInOrder(
    issues,
    input.deployWorkflow,
    'docker rm "$stale_runtime"',
    '"${compose[@]}" run --rm -T migrate </dev/null',
    "deployment must stop old data-plane writers before applying migrations"
  );
  let webPackage;
  try {
    webPackage = JSON.parse(input.webPackageSource);
  } catch {
    issues.push("Web package manifest must remain valid JSON");
  }
  if (
    typeof webPackage?.scripts?.start !== "string" ||
    !webPackage.scripts.start.startsWith(
      "tsx src/assert-production-schema.ts && next start"
    )
  ) {
    issues.push(
      "Web production start must verify the exact schema epoch first"
    );
  }

  for (const [literal, message] of [
    [
      `HULEE_SCHEMA_EPOCH: ${epoch}`,
      "production compose must pin the active schema epoch"
    ],
    [
      "HULEE_EGRESS_PROFILE_KIND: disabled",
      "production compose must pin the disabled egress profile"
    ],
    [
      "HULEE_EGRESS_PROFILE_STATUS: unavailable",
      "production compose must pin unavailable provider status"
    ],
    [
      'HULEE_EGRESS_PROBES_ENABLED: "false"',
      "production compose must disable provider probes literally"
    ],
    ["@hulee/worker", "production worker must expose a startup healthcheck"]
  ]) {
    requireText(issues, input.productionCompose, literal, message);
  }
  requireText(
    issues,
    input.productionCompose,
    "HULEE_WEB_EMPLOYEE_ID: ${HULEE_WEB_EMPLOYEE_ID:-employee_local_1}",
    "production Web identity must match the deterministic foundation seed"
  );
  for (const service of ["postgres", "minio", "minio-create-bucket", "site"]) {
    forbidMatch(
      issues,
      extractTopLevelYamlEntry(input.productionCompose, service),
      /^\s+env_file:\s*$/mu,
      `${service} must not receive the application secret environment file`
    );
  }
  requireText(
    issues,
    input.apiHealthSource,
    "schemaEpoch:",
    "API health must expose the verified schema epoch"
  );
  requireText(
    issues,
    input.apiHealthSource,
    "buildRevision:",
    "API health must expose the running build revision"
  );
  requireText(
    issues,
    input.dockerfileSource,
    "LABEL org.opencontainers.image.revision=$HULEE_BUILD_REVISION",
    "production image must carry its exact source revision label"
  );
  requireText(
    issues,
    input.dockerfileSource,
    "LABEL io.hulee.schema-epoch=$HULEE_SCHEMA_EPOCH",
    "production image must carry its schema epoch label"
  );
}

function requireInOrder(issues, source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    issues.push(message);
  }
}

function requireText(issues, source, expected, message) {
  if (!source.includes(expected)) issues.push(message);
}

function forbidText(issues, source, forbidden, message) {
  if (source.includes(forbidden)) issues.push(message);
}

function requireMatch(issues, source, pattern, message) {
  if (!pattern.test(source)) issues.push(message);
}

function forbidMatch(issues, source, pattern, message) {
  if (pattern.test(source)) issues.push(message);
}

function validateRuntimeDetachment(issues, input) {
  const apiIndexSource = stripJavaScriptComments(input.apiIndexSource);
  forbidMatch(
    issues,
    apiIndexSource,
    /\b(?:createExternalMessageRepository|createPublicApiCommandService|createExternalChannelCommandService)\s*\(/u,
    "API production composition must not create a V1 message service"
  );
  forbidMatch(
    issues,
    apiIndexSource,
    /\b(?:createSqlInternalInboxAuthorizationService|createSqlInternalInboxQueryService|createInternalInboxCommandService|createInternalFileService)\s*\(|\b(?:inboxQueries|inboxCommands|files)\s*:/u,
    "API production composition must not create V1 Inbox services"
  );
  forbidMatch(
    issues,
    apiIndexSource,
    /\b(?:createTelegramWebhookHandler|createChannelConnectorTelegramWebhookConnectorResolver)\s*\(/u,
    "API production composition must not create a V1 Telegram webhook service"
  );
  requireMatch(
    issues,
    apiIndexSource,
    /commands:\s*createCleanSlatePublicApiCommandService\(\)/u,
    "API public message composition must remain fail closed"
  );
  requireMatch(
    issues,
    apiIndexSource,
    /return\s+createCleanSlateTelegramWebhookHandler\(\);/u,
    "API Telegram webhook composition must remain intentionally detached"
  );
  requireMatch(
    issues,
    apiIndexSource,
    /createInternalIntegrationService\(\{[\s\S]*?\bproviderIoEnabled:\s*false\b[\s\S]*?\}\)/u,
    "API integration composition must disable provider I/O"
  );

  const workerRunnerSource = stripJavaScriptComments(input.workerRunnerSource);
  forbidMatch(
    issues,
    workerRunnerSource,
    /\b(?:createSqlOutboxRepository|createWorkerOutboxHandler|processOutboxBatch|createWorkerTelegramPollingSweeper|createWorkerTelegramAttachmentTransferSweeper|createWorkerDirectAccountAuthSweeper|createWorkerDirectAccountSessionMonitor)\s*\(/u,
    "worker production runner must not compose provider polling, outbound or direct-account loops"
  );

  const webInboxPageSource = stripJavaScriptComments(input.webInboxPageSource);
  forbidMatch(
    issues,
    webInboxPageSource,
    /\bloadInboxViewModel\b/u,
    "Web root must not load the V1 Inbox view model"
  );
  requireText(
    issues,
    webInboxPageSource,
    't("inbox.cleanSlate.title")',
    "Web root must expose the clean-slate unavailable surface"
  );

  const foundationSeedSource = stripJavaScriptComments(
    input.foundationSeedSource
  );
  forbidMatch(
    issues,
    foundationSeedSource,
    /\b(?:createMvpTenantWorkspace|createTenantWorkspaceRepository|saveWorkspace)\b|HULEE_SEED_(?:CLIENT|INBOUND|OUTBOUND|TELEGRAM|WHATSAPP|MAX|VIBER|WECHAT|IMO)|\b(?:moduleConfigs|clientDisplayName|conversationId|inboundMessageId|outboundMessageId|providerConfig|providerConfiguration|sourceConnectionConfig|channelExternalId|botTokenSecretRef|webhookConnectorId|webhookSecretTokenSecretRef)\b/iu,
    "foundation seed must not create demo Inbox or provider state"
  );
  requireMatch(
    issues,
    foundationSeedSource,
    /\bcreateTenantRegistrationRepository\s*\(/u,
    "foundation seed must use the retained tenant registration repository"
  );
  requireMatch(
    issues,
    foundationSeedSource,
    /\bregisterTenant\s*\(/u,
    "foundation seed must create only the retained tenant foundation"
  );

  forbidText(
    issues,
    input.packageSource,
    "db:seed:mvp",
    "package scripts must not expose the V1 MVP seed"
  );
  forbidText(
    issues,
    input.productionCompose,
    "db:seed:mvp",
    "production compose must not invoke the V1 MVP seed"
  );
  requireText(
    issues,
    input.productionCompose,
    'command: ["pnpm", "db:seed:foundation"]',
    "production compose must invoke the foundation-only seed"
  );
  requireText(
    issues,
    input.productionCompose,
    'command: ["pnpm", "db:migrate"]',
    "production compose must use the clean-slate migration runner"
  );
  forbidMatch(
    issues,
    input.productionCompose,
    /\bdb:inbox-v2:install\b|\ballow-reviewed-online-bridge\b/u,
    "production compose must not invoke the historical preserve installer"
  );
  forbidMatch(
    issues,
    input.productionCompose,
    /^ {2}(?:egress-gateway|worker-provider-egress):\s*$|\b(?:HULEE_PROVIDER_EGRESS_WORKER_FEATURES|HULEE_EGRESS_GATEWAY_IMAGE|hulee_chat_worker_provider_egress|hulee_chat_vpn_gateway)\b/mu,
    "production compose must not define a provider worker or egress gateway"
  );
  validateProductionWorkerFeatures(issues, input.productionCompose);
}

function validateRemovedInboxV1Implementation(issues, input) {
  const legacyFilePaths = input.legacyFilePaths ?? [];
  if (legacyFilePaths.length > 0) {
    issues.push(
      `removed Inbox V1 files must not exist: ${legacyFilePaths.join(", ")}`
    );
  }

  const residualSourcePaths = (input.runtimeSources ?? [])
    .filter(({ source }) =>
      removedInboxV1SymbolPattern.test(stripJavaScriptComments(source))
    )
    .map(({ path }) => path);
  if (residualSourcePaths.length > 0) {
    issues.push(
      `removed Inbox V1 symbols must not remain in runtime or tests: ${residualSourcePaths.join(", ")}`
    );
  }
}

async function findExistingPaths(paths) {
  const matches = await Promise.all(
    paths.map(async (path) => {
      try {
        await access(resolve(repositoryRoot, path));
        return path;
      } catch {
        return undefined;
      }
    })
  );
  return Object.freeze(matches.filter((path) => path !== undefined));
}

async function collectRuntimeSources(roots) {
  const sourcePaths = [];
  for (const root of roots) await collectSourcePaths(root, sourcePaths);

  return Promise.all(
    sourcePaths.sort().map(async (path) =>
      Object.freeze({
        path,
        source: await readFile(resolve(repositoryRoot, path), "utf8")
      })
    )
  );
}

async function collectSourcePaths(relativeDirectory, sourcePaths) {
  const entries = await readdir(resolve(repositoryRoot, relativeDirectory), {
    withFileTypes: true
  });
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (
        ![".next", ".turbo", "coverage", "dist", "node_modules"].includes(
          entry.name
        )
      ) {
        await collectSourcePaths(relativePath, sourcePaths);
      }
      continue;
    }
    if (/\.(?:c|m)?(?:j|t)sx?$/u.test(entry.name))
      sourcePaths.push(relativePath);
  }
}

function validateProductionWorkerFeatures(issues, productionCompose) {
  const workerBlock = extractTopLevelYamlEntry(productionCompose, "worker");
  const featureLines = workerBlock
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => /^\s+HULEE_WORKER_FEATURES:/u.test(line));

  if (
    featureLines.length !== 1 ||
    featureLines[0]?.trim() !== "HULEE_WORKER_FEATURES: core"
  ) {
    issues.push(
      "production worker must set HULEE_WORKER_FEATURES to the literal core value"
    );
  }
}

function extractTopLevelYamlEntry(source, key) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => line === `  ${key}:`);
  if (start === -1) return "";

  const endOffset = lines
    .slice(start + 1)
    .findIndex((line) => /^ {2}[A-Za-z0-9_-]+:\s*$/u.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start, end).join("\n");
}

function stripJavaScriptComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
}

function stripYamlCommentLines(source) {
  return source.replace(/^\s*#.*$/gmu, "");
}

function parseWorkflowTriggers(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const onIndex = lines.findIndex((line) => line === "on:");
  if (onIndex === -1) return Object.freeze([]);

  const triggers = [];
  for (const line of lines.slice(onIndex + 1)) {
    if (line.length === 0 || /^\s*#/u.test(line)) continue;
    if (/^[A-Za-z0-9_-]+:/u.test(line)) break;
    if (/^ {2}\S/u.test(line)) {
      triggers.push(
        line === "  workflow_dispatch:"
          ? "workflow_dispatch"
          : line === "  push:"
            ? "push"
            : line === "  workflow_run:"
              ? "workflow_run"
              : `invalid:${line.trim()}`
      );
    }
  }
  return Object.freeze(triggers);
}

function validatePackageScripts(issues, packageSource) {
  let packageManifest;
  try {
    packageManifest = JSON.parse(packageSource);
  } catch {
    issues.push("package.json must remain valid JSON");
    return;
  }
  const scripts = packageManifest?.scripts;
  if (
    scripts?.["inbox-v2:clean-slate:check"] !==
    "node scripts/checks/inbox-v2-clean-slate-check.mjs"
  ) {
    issues.push("package.json must expose the clean-slate check command");
  }
  if (
    typeof scripts?.check !== "string" ||
    !scripts.check.includes("pnpm inbox-v2:clean-slate:check")
  ) {
    issues.push("pnpm check must execute the clean-slate guard");
  }
  if (scripts?.["db:seed:foundation"] !== "tsx scripts/db/seed-foundation.ts") {
    issues.push("package.json must expose the foundation-only seed command");
  }
  if (
    scripts?.["db:inbox-v2:preflight"] !==
    "node scripts/db/preflight-inbox-v2.mjs"
  ) {
    issues.push(
      "package.json must expose the read-only Inbox V2 deployment preflight"
    );
  }
}

function isExecutedDirectly() {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isExecutedDirectly()) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
