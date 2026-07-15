import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { collectFinalizedMigrationDdlStatements } from "../checks/db-check-lib.mjs";

const finalizerPath = fileURLToPath(
  new URL(
    "./finalize-inbox-v2-data-governance-privacy-migration.mjs",
    import.meta.url
  )
);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker =
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_DATA_GOVERNANCE_PRIVACY_PREFLIGHT_V1";
const firstInvariantName = "INBOX_V2_DATA_GOVERNANCE_POLICY_INVARIANTS_SQL";
const secondInvariantName = "INBOX_V2_PRIVACY_OPERATION_INVARIANTS_SQL";
const terminalExportRequiredTriggerName =
  "inbox_v2_dg_deletion_run_terminal_export_required";
const dynamicImmutabilityTriggerName = "inbox_v2_dg_immutable_71d36b5cd6cefe42";
const firstInvariantSql = String.raw`create or replace function public.inbox_v2_dgp_policy_test_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return new;
end;
$function$;

create or replace function public.inbox_v2_dg_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return old;
end;
$function$;

create or replace function public.inbox_v2_dg_deletion_run_terminal_export_required()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return new;
end;
$function$;

create constraint trigger inbox_v2_dg_deletion_run_terminal_export_required
after insert or update or delete on public.inbox_v2_privacy_requests
deferrable initially deferred
for each row execute function public.inbox_v2_dg_deletion_run_terminal_export_required();

do $block$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'inbox_v2_data_governance_contexts'
  ]
  loop
    v_trigger := 'inbox_v2_dg_immutable_' || substr(md5(v_table), 1, 16);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.inbox_v2_dg_reject_immutable()',
      v_trigger,
      v_table
    );
  end loop;
end
$block$;`;
const secondInvariantSql = String.raw`create or replace function public.inbox_v2_dgp_operation_test_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return new;
end;
$function$;`;
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Inbox V2 data-governance/privacy migration finalizer", () => {
  it("validates the complete production DB-009 schema object inventory", async () => {
    const fixture = await createCurrentSchemaFixture();
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "verified 52 tables, 37 enums, 11 functions"
    );
  });

  it("injects one preflight and every exact invariant block", async () => {
    const fixture = await createFixture();
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status, result.stderr).toBe(0);
    const finalized = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(finalized, finalizedMarker)).toBe(1);
    expect(countOccurrences(finalized, preflightMarker)).toBe(1);
    expect(countOccurrences(finalized, firstInvariantSql)).toBe(1);
    expect(countOccurrences(finalized, secondInvariantSql)).toBe(1);
    expect(result.stdout).toContain("2 invariant block(s)");
    expect(
      collectFinalizedMigrationDdlStatements({
        migrationSql: finalized,
        finalizedMarker,
        preflightMarker,
        invariantBlocks: [
          { name: firstInvariantName, sql: firstInvariantSql },
          { name: secondInvariantName, sql: secondInvariantSql }
        ]
      })
    ).toEqual(fixture.statements);
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

  it("rejects a missing invariant export before touching the migration", async () => {
    const fixture = await createFixture({ missingInvariants: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "must export at least one Inbox V2 invariant SQL block"
    );
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects a malformed preflight before touching the migration", async () => {
    const fixture = await createFixture({ malformedPreflight: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("preflight must start");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects generated DDL that is incomplete for the schema", async () => {
    const fixture = await createFixture({ missingTableDdl: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'CREATE TABLE "inbox_v2_privacy_requests" exactly 1 time(s); found 0'
    );
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects generated DDL with a table outside the frozen schema", async () => {
    const fixture = await createFixture({ unexpectedTableDdl: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "declares unexpected table(s): inbox_v2_data_governance_stale"
    );
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects a preflight missing the terminal-export required trigger", async () => {
    const fixture = await createFixture({
      missingTerminalExportTrigger: true
    });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("preflight triggers list is stale");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects a preflight missing a materialized md5 trigger", async () => {
    const fixture = await createFixture({ missingDynamicTrigger: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("preflight triggers list is stale");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects destructive generated DDL before touching the migration", async () => {
    const fixture = await createFixture({ destructiveDdl: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be additive-only");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });
});

async function createCurrentSchemaFixture() {
  const root = await mkdtemp(
    join(tmpdir(), "hulee-db009-production-finalizer-")
  );
  temporaryRoots.push(root);
  const migrationPath = join(
    root,
    "packages/db/drizzle/0033_inbox_v2_data_governance_privacy.sql"
  );
  const preflightPath = join(
    root,
    "scripts/db/inbox-v2-data-governance-privacy-preflight.sql"
  );
  const schemaPath = join(
    root,
    "packages/db/src/schema/inbox-v2/data-governance-privacy.ts"
  );
  const [preflightSource, schemaSource] = await Promise.all([
    readFile(
      join(
        repositoryRoot,
        "scripts/db/inbox-v2-data-governance-privacy-preflight.sql"
      ),
      "utf8"
    ),
    readFile(
      join(
        repositoryRoot,
        "packages/db/src/schema/inbox-v2/data-governance-privacy.ts"
      ),
      "utf8"
    )
  ]);
  const enumNames = [...schemaSource.matchAll(/pgEnum\(\s*"([^"]+)"/g)].map(
    (match) => match[1]
  );
  const tableNames = [...schemaSource.matchAll(/pgTable\(\s*"([^"]+)"/g)].map(
    (match) => match[1]
  );
  const statements = [
    ...enumNames.map(
      (enumName) => `CREATE TYPE "public"."${enumName}" AS ENUM('fixture');`
    ),
    ...tableNames.map(
      (tableName) => `CREATE TABLE "${tableName}" ("tenant_id" text NOT NULL);`
    )
  ];

  await Promise.all([
    mkdir(dirname(migrationPath), { recursive: true }),
    mkdir(dirname(preflightPath), { recursive: true }),
    mkdir(dirname(schemaPath), { recursive: true })
  ]);
  await Promise.all([
    writeFile(
      migrationPath,
      `${statements.join(`\n${statementBreakpoint}\n`)}\n`,
      "utf8"
    ),
    writeFile(preflightPath, preflightSource, "utf8"),
    writeFile(schemaPath, schemaSource, "utf8")
  ]);

  return { root, migrationPath };
}

async function createFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "hulee-db009-finalizer-"));
  temporaryRoots.push(root);
  const migrationPath = join(
    root,
    "packages/db/drizzle/0033_inbox_v2_data_governance_privacy.sql"
  );
  const preflightPath = join(
    root,
    "scripts/db/inbox-v2-data-governance-privacy-preflight.sql"
  );
  const schemaPath = join(
    root,
    "packages/db/src/schema/inbox-v2/data-governance-privacy.ts"
  );
  await Promise.all([
    mkdir(dirname(migrationPath), { recursive: true }),
    mkdir(dirname(preflightPath), { recursive: true }),
    mkdir(dirname(schemaPath), { recursive: true })
  ]);

  const statements = [
    "CREATE TYPE \"public\".\"inbox_v2_privacy_request_state\" AS ENUM('open', 'completed');",
    'CREATE TABLE "inbox_v2_data_governance_contexts" ("tenant_id" text NOT NULL);',
    'CREATE TABLE "inbox_v2_privacy_requests" ("tenant_id" text NOT NULL);'
  ];
  const writtenStatements = options.missingTableDdl
    ? statements.slice(0, 2)
    : options.destructiveDdl
      ? [...statements, 'DROP TABLE "legacy_customer_data";']
      : options.unexpectedTableDdl
        ? [
            ...statements,
            'CREATE TABLE "inbox_v2_data_governance_stale" ("tenant_id" text NOT NULL);'
          ]
        : statements;
  const invariantExports = options.missingInvariants
    ? "export const SOMETHING_ELSE = String.raw`select 1`;\n"
    : `export const ${firstInvariantName} = String.raw\`${firstInvariantSql}\`;\nexport const ${secondInvariantName} = String.raw\`${secondInvariantSql}\`;\n`;
  const preflightTriggerNames = [
    terminalExportRequiredTriggerName,
    dynamicImmutabilityTriggerName
  ].filter(
    (triggerName) =>
      !(
        (options.missingTerminalExportTrigger &&
          triggerName === terminalExportRequiredTriggerName) ||
        (options.missingDynamicTrigger &&
          triggerName === dynamicImmutabilityTriggerName)
      )
  );
  await Promise.all([
    writeFile(
      migrationPath,
      `${writtenStatements.join(`\n${statementBreakpoint}\n`)}\n`,
      "utf8"
    ),
    writeFile(
      preflightPath,
      options.malformedPreflight
        ? "do $preflight$ begin null; end; $preflight$;\n"
        : `-- ${preflightMarker}
-- DB009_PARTIAL_TABLES_BEGIN
'inbox_v2_data_governance_contexts',
'inbox_v2_privacy_requests'
-- DB009_PARTIAL_TABLES_END
-- DB009_PARTIAL_TYPES_BEGIN
'inbox_v2_privacy_request_state'
-- DB009_PARTIAL_TYPES_END
-- DB009_PARTIAL_FUNCTIONS_BEGIN
'inbox_v2_dg_reject_immutable',
'inbox_v2_dg_deletion_run_terminal_export_required',
'inbox_v2_dgp_policy_test_guard',
'inbox_v2_dgp_operation_test_guard'
-- DB009_PARTIAL_FUNCTIONS_END
-- DB009_PARTIAL_TRIGGERS_BEGIN
${preflightTriggerNames.map((triggerName) => `'${triggerName}'`).join(",\n")}
-- DB009_PARTIAL_TRIGGERS_END
do $preflight$ begin null; end; $preflight$;
`,
      "utf8"
    ),
    writeFile(
      schemaPath,
      `const state = pgEnum("inbox_v2_privacy_request_state", []);\nexport const contexts = pgTable("inbox_v2_data_governance_contexts", {});\nexport const requests = pgTable("inbox_v2_privacy_requests", {});\n${invariantExports}`,
      "utf8"
    )
  ]);

  return { root, migrationPath, statements: writtenStatements };
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
