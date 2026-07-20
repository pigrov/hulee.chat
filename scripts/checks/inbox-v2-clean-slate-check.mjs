import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");

export function validateInboxV2CleanSlateFreeze(input) {
  const issues = [];

  const deployTriggers = parseWorkflowTriggers(input.deployWorkflow);
  if (
    deployTriggers.length !== 1 ||
    deployTriggers[0] !== "workflow_dispatch"
  ) {
    issues.push("deploy workflow triggers must be exactly workflow_dispatch");
  }
  requireText(
    issues,
    input.deployWorkflow,
    "    steps:\n      - name: Enforce the Inbox V2 clean-slate deployment freeze",
    "deploy freeze must be the first deployment step"
  );
  requireText(
    issues,
    input.deployWorkflow,
    "        env:\n          CONFIRMATION: ${{ inputs.confirmation }}\n          UNLOCKED: ${{ vars.HULEE_CLEAN_SLATE_DEPLOY_UNLOCKED }}",
    "deploy guard must bind confirmation input and clean-slate unlock variable"
  );
  requireText(
    issues,
    input.deployWorkflow,
    '          if [[ "$UNLOCKED" != "true" || "$CONFIRMATION" != "DEPLOY_CLEAN_SLATE_V2" ]]; then\n            echo "::error::Application deployment is frozen by INB2-CLEAN-001 until INB2-CLEAN-GATE passes."\n            exit 1\n          fi',
    "deploy guard must fail loudly unless both unlock factors are exact"
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

  requireMatch(
    issues,
    input.configSource,
    /const defaultWorkerFeatures:[^=]+=\s*\[\s*"core"\s*\];/su,
    "a worker without explicit features must be provider-free"
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
    packageSource
  ] = await Promise.all(
    [
      ".github/workflows/deploy.yml",
      ".github/workflows/check.yml",
      "packages/config/src/index.ts",
      "docs/adr/0016-inbox-v2-preproduction-clean-slate.md",
      "docs/product/inbox-v2-backlog.md",
      "docs/product/inbox-v2-migration-and-cutover.md",
      "AGENTS.md",
      "package.json"
    ].map((path) => readFile(resolve(repositoryRoot, path), "utf8"))
  );
  const issues = validateInboxV2CleanSlateFreeze({
    deployWorkflow,
    checkWorkflow,
    configSource,
    adr,
    backlog,
    migrationStrategy,
    agentInstructions,
    packageSource
  });
  if (issues.length > 0) {
    throw new Error(
      `Inbox V2 clean-slate freeze check failed:\n- ${issues.join("\n- ")}`
    );
  }
  console.log("Inbox V2 clean-slate deployment and CI freeze passed.");
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
