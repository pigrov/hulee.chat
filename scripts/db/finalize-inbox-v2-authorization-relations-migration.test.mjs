import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const finalizerPath = fileURLToPath(
  new URL(
    "./finalize-inbox-v2-authorization-relations-migration.mjs",
    import.meta.url
  )
);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker =
  "INBOX_V2_AUTHORIZATION_RELATIONS_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_AUTHORIZATION_RELATIONS_PREFLIGHT_V1";
const invariantSql = String.raw`create or replace function public.inbox_v2_authorization_fixture_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return new;
end;
$function$;

create constraint trigger inbox_v2_authorization_fixture_guard_trigger
after insert or update or delete on public.inbox_v2_authorization_fixture_heads
deferrable initially deferred
for each row execute function public.inbox_v2_authorization_fixture_guard();`;
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Inbox V2 authorization-relations migration finalizer", () => {
  it("validates the complete production RBAC-003 schema object inventory", async () => {
    const fixture = await createCurrentSchemaFixture();
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "verified 27 tables, 17 enums, 19 functions, 8 foundation trigger fingerprints"
    );
    const finalized = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(finalized, finalizedMarker)).toBe(1);
    expect(countOccurrences(finalized, preflightMarker)).toBe(1);
  });

  it("injects the exact preflight and invariant block", async () => {
    const fixture = await createFixture();
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status, result.stderr).toBe(0);
    const finalized = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(finalized, finalizedMarker)).toBe(1);
    expect(countOccurrences(finalized, preflightMarker)).toBe(1);
    expect(countOccurrences(finalized, invariantSql)).toBe(1);
    expect(result.stdout).toContain(
      "verified 1 tables, 1 enums, 1 functions, 0 foundation trigger fingerprints"
    );
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

  it("rejects incomplete or destructive generated DDL before writing", async () => {
    for (const options of [{ missingTable: true }, { destructiveDdl: true }]) {
      const fixture = await createFixture(options);
      const before = await readFile(fixture.migrationPath, "utf8");

      const result = runFinalizer(fixture.root, fixture.migrationPath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(
        options.missingTable ? /CREATE TABLE/u : /additive-only/u
      );
      await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(
        before
      );
    }
  });

  it("rejects stale preflight inventory", async () => {
    const fixture = await createFixture({ stalePreflight: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("preflight tables list is stale");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects a stale WorkItem foundation trigger fingerprint", async () => {
    const fixture = await createCurrentSchemaFixture({
      staleFoundationTrigger: true
    });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "foundation trigger inventory is stale against the pinned WorkItem bridge contract"
    );
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });
});

async function createCurrentSchemaFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "hulee-rbac003-production-"));
  temporaryRoots.push(root);
  const migrationPath = join(
    root,
    "packages/db/drizzle/0034_inbox_v2_authorization_relations.sql"
  );
  const preflightPath = join(
    root,
    "scripts/db/inbox-v2-authorization-relations-preflight.sql"
  );
  const schemaPath = join(
    root,
    "packages/db/src/schema/inbox-v2/authorization-relations.ts"
  );
  const [currentPreflightSource, schemaSource] = await Promise.all([
    readFile(
      join(
        repositoryRoot,
        "scripts/db/inbox-v2-authorization-relations-preflight.sql"
      ),
      "utf8"
    ),
    readFile(
      join(
        repositoryRoot,
        "packages/db/src/schema/inbox-v2/authorization-relations.ts"
      ),
      "utf8"
    )
  ]);
  let preflightSource = currentPreflightSource;
  if (options.staleFoundationTrigger) {
    preflightSource = preflightSource.replace(
      `'inbox_v2_work_item_mutation_coherence',\n            17`,
      `'inbox_v2_work_item_aggregate_coherence',\n            17`
    );
  }
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
  const root = await mkdtemp(join(tmpdir(), "hulee-rbac003-finalizer-"));
  temporaryRoots.push(root);
  const migrationPath = join(
    root,
    "packages/db/drizzle/0034_inbox_v2_authorization_relations.sql"
  );
  const preflightPath = join(
    root,
    "scripts/db/inbox-v2-authorization-relations-preflight.sql"
  );
  const schemaPath = join(
    root,
    "packages/db/src/schema/inbox-v2/authorization-relations.ts"
  );
  await Promise.all([
    mkdir(dirname(migrationPath), { recursive: true }),
    mkdir(dirname(preflightPath), { recursive: true }),
    mkdir(dirname(schemaPath), { recursive: true })
  ]);

  const statements = [
    'CREATE TYPE "public"."inbox_v2_authorization_fixture_state" AS ENUM(\'active\');',
    ...(options.missingTable
      ? []
      : [
          'CREATE TABLE "inbox_v2_authorization_fixture_heads" ("tenant_id" text NOT NULL);'
        ]),
    ...(options.destructiveDdl ? ['DROP TABLE "tenant_roles";'] : [])
  ];
  await Promise.all([
    writeFile(
      migrationPath,
      `${statements.join(`\n${statementBreakpoint}\n`)}\n`,
      "utf8"
    ),
    writeFile(
      preflightPath,
      `-- ${preflightMarker}
-- RBAC003_PARTIAL_TABLES_BEGIN
'${options.stalePreflight ? "inbox_v2_authorization_stale" : "inbox_v2_authorization_fixture_heads"}'
-- RBAC003_PARTIAL_TABLES_END
-- RBAC003_PARTIAL_TYPES_BEGIN
'inbox_v2_authorization_fixture_state'
-- RBAC003_PARTIAL_TYPES_END
-- RBAC003_PARTIAL_FUNCTIONS_BEGIN
'inbox_v2_authorization_fixture_guard'
-- RBAC003_PARTIAL_FUNCTIONS_END
-- RBAC003_FOUNDATION_FUNCTIONS_BEGIN
-- RBAC003_FOUNDATION_FUNCTIONS_END
-- RBAC003_FOUNDATION_TRIGGERS_BEGIN
-- RBAC003_FOUNDATION_TRIGGERS_END
-- RBAC003_PARTIAL_TRIGGERS_BEGIN
'inbox_v2_authorization_fixture_guard_trigger'
-- RBAC003_PARTIAL_TRIGGERS_END
do $preflight$ begin null; end; $preflight$;
`,
      "utf8"
    ),
    writeFile(
      schemaPath,
      `const state = pgEnum("inbox_v2_authorization_fixture_state", []);
export const heads = pgTable("inbox_v2_authorization_fixture_heads", {});
export const INBOX_V2_AUTHORIZATION_FIXTURE_INVARIANTS_SQL = String.raw\`${invariantSql}\`;
`,
      "utf8"
    )
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
