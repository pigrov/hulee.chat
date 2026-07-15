import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const finalizerPath = fileURLToPath(
  new URL(
    "./finalize-inbox-v2-repository-foundation-migration.mjs",
    import.meta.url
  )
);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_REPOSITORY_FOUNDATION_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_REPOSITORY_FOUNDATION_PREFLIGHT_V1";
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Inbox V2 repository-foundation migration finalizer", () => {
  it("injects exact preflight/backfills/invariants and orders parent uniques before foreign keys", async () => {
    const fixture = await createFixture();

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("verified 6 tables and 3 enums");
    const finalized = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(finalized, finalizedMarker)).toBe(1);
    expect(countOccurrences(finalized, preflightMarker)).toBe(1);
    expect(countOccurrences(finalized, "core:retention-tombstone")).toBe(1);
    expect(
      countOccurrences(
        finalized,
        "disable trigger inbox_v2_auth_immutable_dbcc9ea93cbd94ba"
      )
    ).toBe(1);
    expect(
      countOccurrences(
        finalized,
        "enable trigger inbox_v2_auth_immutable_dbcc9ea93cbd94ba"
      )
    ).toBe(1);
    expect(
      countOccurrences(
        finalized,
        "on conflict (tenant_id, intent_id) do nothing;"
      )
    ).toBe(1);
    expect(
      countOccurrences(
        finalized,
        "create or replace function public.inbox_v2_repository_projection_checkpoint_guard()"
      )
    ).toBe(1);
    expect(
      countOccurrences(
        finalized,
        "create or replace function public.inbox_v2_advance_tenant_stream_retained_prefix_v1("
      )
    ).toBe(1);
    expect(
      countOccurrences(finalized, "owner to hulee_inbox_v2_retention_owner")
    ).toBe(1);
    expect(countOccurrences(finalized, "$retention_boundary_audit$")).toBe(2);
    expect(
      countOccurrences(
        finalized,
        "create or replace function public.inbox_v2_lock_participant_membership_mutation_v1("
      )
    ).toBe(1);
    expect(
      countOccurrences(
        finalized,
        "create or replace function public.inbox_v2_lock_conversation_membership_head_v1("
      )
    ).toBe(1);
    expect(
      countOccurrences(
        finalized,
        "create or replace function public.inbox_v2_apply_participant_membership_mutation_v1("
      )
    ).toBe(1);

    const firstForeignKey = finalized.indexOf(" FOREIGN KEY ");
    expect(firstForeignKey).toBeGreaterThan(0);
    expect(
      finalized.indexOf('CONSTRAINT "accounts_tenant_id_unique"')
    ).toBeLessThan(firstForeignKey);
    expect(
      finalized.indexOf(
        'CONSTRAINT "inbox_v2_tenant_stream_commits_checkpoint_unique"'
      )
    ).toBeLessThan(firstForeignKey);
    expect(
      finalized.indexOf(
        'CONSTRAINT "inbox_v2_tenant_stream_commits_identity_position_unique"'
      )
    ).toBeLessThan(firstForeignKey);
  });

  it("refuses to finalize an already finalized migration", async () => {
    const fixture = await createFixture();
    expect(runFinalizer(fixture.root, fixture.migrationPath).status).toBe(0);
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already finalized");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects incomplete generated inventory before writing", async () => {
    for (const options of [{ missingTable: true }, { missingEnum: true }]) {
      const fixture = await createFixture(options);
      const before = await readFile(fixture.migrationPath, "utf8");

      const result = runFinalizer(fixture.root, fixture.migrationPath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/must contain CREATE (?:TABLE|TYPE)/u);
      await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(
        before
      );
    }
  });

  it("rejects unreviewed destructive DDL before writing", async () => {
    const fixture = await createFixture({ destructiveDdl: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("forbidden destructive DDL");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects duplicate preflight marker before writing", async () => {
    const fixture = await createFixture({ duplicatePreflightMarker: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must start with");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects stale partial-object preflight inventory", async () => {
    const fixture = await createFixture({ stalePreflightInventory: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "preflight inventory must contain inbox_v2_repository_retention_advance_immutable exactly once; found 0"
    );
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects stale source-owned function inventory", async () => {
    const fixture = await createFixture({ staleSourceFunction: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "repository-foundation invariant functions inventory is stale"
    );
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });
});

async function createFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "hulee-db007-finalizer-"));
  temporaryRoots.push(root);
  const migrationPath = join(
    root,
    "packages/db/drizzle/0036_inbox_v2_repository_foundation.sql"
  );
  const preflightPath = join(
    root,
    "scripts/db/inbox-v2-repository-foundation-preflight.sql"
  );
  const repositorySchemaPath = join(
    root,
    "packages/db/src/schema/inbox-v2/repository-foundation.ts"
  );
  const membershipBoundaryPath = join(
    root,
    "packages/db/src/schema/inbox-v2/membership-privilege-boundary.ts"
  );
  const [currentPreflight, currentRepositorySchema, membershipBoundary] =
    await Promise.all([
      readFile(
        join(
          repositoryRoot,
          "scripts/db/inbox-v2-repository-foundation-preflight.sql"
        ),
        "utf8"
      ),
      readFile(
        join(
          repositoryRoot,
          "packages/db/src/schema/inbox-v2/repository-foundation.ts"
        ),
        "utf8"
      ),
      readFile(
        join(
          repositoryRoot,
          "packages/db/src/schema/inbox-v2/membership-privilege-boundary.ts"
        ),
        "utf8"
      )
    ]);
  const repositorySchema = options.staleSourceFunction
    ? currentRepositorySchema.replace(
        "create or replace function public.inbox_v2_advance_tenant_stream_retained_prefix_v1(",
        "create or replace function public.inbox_v2_untracked_retained_prefix_v1("
      )
    : currentRepositorySchema;

  const enumNames = [
    "inbox_v2_outbox_outcome_kind",
    "inbox_v2_outbox_work_state",
    "inbox_v2_projection_generation_state"
  ];
  const tableNames = [
    "inbox_v2_outbox_outcomes",
    "inbox_v2_outbox_work_items",
    "inbox_v2_projection_checkpoints",
    "inbox_v2_projection_generations",
    "inbox_v2_projection_heads",
    "inbox_v2_tenant_stream_retention_advances"
  ];
  const includedEnums = options.missingEnum ? enumNames.slice(1) : enumNames;
  const includedTables = options.missingTable
    ? tableNames.slice(1)
    : tableNames;
  const statements = [
    ...includedEnums.map(
      (enumName) => `CREATE TYPE "public"."${enumName}" AS ENUM('fixture');`
    ),
    ...includedTables.map(
      (tableName) => `CREATE TABLE "${tableName}" ("tenant_id" text NOT NULL);`
    ),
    'ALTER TABLE "inbox_v2_tenant_stream_changes" ADD COLUMN "state_reason_id" text;',
    'ALTER TABLE "inbox_v2_outbox_outcomes" ADD CONSTRAINT "fixture_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");',
    'ALTER TABLE "inbox_v2_domain_events" ADD CONSTRAINT "inbox_v2_domain_events_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id","position");',
    'ALTER TABLE "inbox_v2_outbox_intents" ADD CONSTRAINT "inbox_v2_outbox_intents_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id","position");',
    'ALTER TABLE "inbox_v2_tenant_stream_changes" ADD CONSTRAINT "inbox_v2_tenant_stream_changes_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id","position");',
    'ALTER TABLE "inbox_v2_data_governance_subject_links" ADD CONSTRAINT "inbox_v2_dg_subject_link_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id");',
    'ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_unique" UNIQUE("tenant_id","id");',
    'ALTER TABLE "inbox_v2_tenant_stream_commits" ADD CONSTRAINT "inbox_v2_tenant_stream_commits_checkpoint_unique" UNIQUE("tenant_id","id","stream_epoch","position");',
    'ALTER TABLE "inbox_v2_tenant_stream_commits" ADD CONSTRAINT "inbox_v2_tenant_stream_commits_identity_position_unique" UNIQUE("tenant_id","id","mutation_id","position");',
    'ALTER TABLE "inbox_v2_tenant_stream_changes" ADD CONSTRAINT "inbox_v2_tenant_stream_changes_values_check" CHECK (true);',
    ...(options.destructiveDdl ? ['DROP TABLE "tenants";'] : [])
  ];
  let preflightSource = currentPreflight;
  if (options.duplicatePreflightMarker) {
    preflightSource = `${preflightSource.trim()}\n-- ${preflightMarker}\n`;
  }
  if (options.stalePreflightInventory) {
    preflightSource = preflightSource.replace(
      "'inbox_v2_repository_retention_advance_immutable'",
      "'inbox_v2_repository_stale_immutable'"
    );
  }

  await Promise.all([
    mkdir(dirname(migrationPath), { recursive: true }),
    mkdir(dirname(preflightPath), { recursive: true }),
    mkdir(dirname(repositorySchemaPath), { recursive: true })
  ]);
  await Promise.all([
    writeFile(
      migrationPath,
      `${statements.join(`\n${statementBreakpoint}\n`)}\n`,
      "utf8"
    ),
    writeFile(preflightPath, preflightSource, "utf8"),
    writeFile(repositorySchemaPath, repositorySchema, "utf8"),
    writeFile(membershipBoundaryPath, membershipBoundary, "utf8")
  ]);

  return { root, migrationPath };
}

function runFinalizer(root, migrationPath) {
  return spawnSync(process.execPath, [finalizerPath, migrationPath], {
    cwd: root,
    encoding: "utf8"
  });
}

function countOccurrences(value, fragment) {
  return value.split(fragment).length - 1;
}
