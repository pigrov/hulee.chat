import { describe, expect, it } from "vitest";

import { validateInboxV2CleanSlateFreeze } from "./inbox-v2-clean-slate-check.mjs";

const validInput = Object.freeze({
  deployWorkflow: `on:
  workflow_dispatch:
    inputs:
      confirmation:
        type: string

jobs:
  deploy:
    steps:
      - name: Enforce the Inbox V2 clean-slate deployment freeze
        env:
          CONFIRMATION: \${{ inputs.confirmation }}
          UNLOCKED: \${{ vars.HULEE_CLEAN_SLATE_DEPLOY_UNLOCKED }}
        run: |
          if [[ "$UNLOCKED" != "true" || "$CONFIRMATION" != "DEPLOY_CLEAN_SLATE_V2" ]]; then
            echo "::error::Application deployment is frozen by INB2-CLEAN-001 until INB2-CLEAN-GATE passes."
            exit 1
          fi`,
  checkWorkflow: `pnpm test:inbox-v2:postgres\npnpm test:inbox-v2:conversation-head-integrity\ninbox-v2-disposable-lifecycle:`,
  configSource: `const defaultWorkerFeatures: readonly WorkerFeature[] = ["core"];`,
  adr: `clean-slate-2026-07-20-r1`,
  backlog: "`INB2-CLEAN-001` clean-slate-2026-07-20-r1",
  migrationStrategy: `clean-slate-2026-07-20-r1`,
  agentInstructions: `docs/adr/0016-inbox-v2-preproduction-clean-slate.md`,
  packageSource: JSON.stringify({
    scripts: {
      check: "pnpm test && pnpm inbox-v2:clean-slate:check",
      "inbox-v2:clean-slate:check":
        "node scripts/checks/inbox-v2-clean-slate-check.mjs"
    }
  })
});

describe("Inbox V2 clean-slate freeze check", () => {
  it("accepts a fail-loud manual deploy freeze and retained V2 gates", () => {
    expect(validateInboxV2CleanSlateFreeze(validInput)).toEqual([]);
  });

  it("rejects an automatic deploy and provider-enabled worker default", () => {
    const issues = validateInboxV2CleanSlateFreeze({
      ...validInput,
      deployWorkflow: validInput.deployWorkflow.replace(
        "  workflow_dispatch:",
        "  workflow_dispatch:\n  push:"
      ),
      configSource: `const defaultWorkerFeatures: readonly WorkerFeature[] = ["core", "telegram_bot"];`
    });

    expect(issues).toContain(
      "deploy workflow triggers must be exactly workflow_dispatch"
    );
    expect(issues).toContain(
      "a worker without explicit features must be provider-free"
    );
  });

  it.each([
    ["flow-style push", `on: [push, workflow_dispatch]`],
    [
      "quoted push",
      validInput.deployWorkflow.replace(
        "  workflow_dispatch:",
        "  workflow_dispatch:\n  'push':"
      )
    ],
    [
      "spaced push key",
      validInput.deployWorkflow.replace(
        "  workflow_dispatch:",
        "  workflow_dispatch:\n  push :"
      )
    ],
    [
      "scheduled trigger",
      validInput.deployWorkflow.replace(
        "  workflow_dispatch:",
        "  workflow_dispatch:\n  schedule:"
      )
    ],
    [
      "workflow-run trigger",
      validInput.deployWorkflow.replace(
        "  workflow_dispatch:",
        "  workflow_dispatch:\n  workflow_run:"
      )
    ]
  ])("rejects %s", (_label, deployWorkflow) => {
    expect(
      validateInboxV2CleanSlateFreeze({
        ...validInput,
        deployWorkflow
      })
    ).toContain("deploy workflow triggers must be exactly workflow_dispatch");
  });

  it("rejects unlock tokens that exist only in comments", () => {
    const deployWorkflow = `on:
  workflow_dispatch:
jobs:
  deploy:
    steps:
      # CONFIRMATION: \${{ inputs.confirmation }}
      # UNLOCKED: \${{ vars.HULEE_CLEAN_SLATE_DEPLOY_UNLOCKED }}
      # DEPLOY_CLEAN_SLATE_V2 exit 1`;

    expect(
      validateInboxV2CleanSlateFreeze({ ...validInput, deployWorkflow })
    ).toEqual(
      expect.arrayContaining([
        "deploy freeze must be the first deployment step",
        "deploy guard must bind confirmation input and clean-slate unlock variable",
        "deploy guard must fail loudly unless both unlock factors are exact"
      ])
    );
  });

  it("rejects a freeze guard placed after checkout", () => {
    const deployWorkflow = validInput.deployWorkflow.replace(
      "    steps:\n      - name: Enforce the Inbox V2 clean-slate deployment freeze",
      "    steps:\n      - uses: actions/checkout@v4\n      - name: Enforce the Inbox V2 clean-slate deployment freeze"
    );

    expect(
      validateInboxV2CleanSlateFreeze({ ...validInput, deployWorkflow })
    ).toContain("deploy freeze must be the first deployment step");
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
});
