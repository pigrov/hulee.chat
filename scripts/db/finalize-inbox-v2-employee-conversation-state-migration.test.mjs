import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { collectFinalizedMigrationDdlStatements } from "../checks/db-check-lib.mjs";

const finalizerPath = fileURLToPath(
  new URL(
    "./finalize-inbox-v2-employee-conversation-state-migration.mjs",
    import.meta.url
  )
);
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker =
  "INBOX_V2_EMPLOYEE_CONVERSATION_STATE_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_EMPLOYEE_CONVERSATION_STATE_PREFLIGHT_V1";
const invariantSql = String.raw`create or replace function public.inbox_v2_ecs_test_guard()
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

describe("Inbox V2 EmployeeConversationState migration finalizer", () => {
  it("injects one preflight and the exact invariant block", async () => {
    const fixture = await createFixture();
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status, result.stderr).toBe(0);
    const finalized = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(finalized, finalizedMarker)).toBe(1);
    expect(countOccurrences(finalized, preflightMarker)).toBe(1);
    expect(countOccurrences(finalized, invariantSql)).toBe(1);
    expect(result.stdout).toContain("1 invariant block");
    expect(
      collectFinalizedMigrationDdlStatements({
        migrationSql: finalized,
        finalizedMarker,
        preflightMarker,
        invariantBlocks: [
          {
            name: "INBOX_V2_EMPLOYEE_CONVERSATION_STATE_INVARIANTS_SQL",
            sql: invariantSql
          }
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
    const fixture = await createFixture({ missingInvariant: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Could not extract INBOX_V2_EMPLOYEE_CONVERSATION_STATE_INVARIANTS_SQL"
    );
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });
});

async function createFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "hulee-db006-finalizer-"));
  temporaryRoots.push(root);
  const migrationPath = join(
    root,
    "packages/db/drizzle/0032_inbox_v2_employee_conversation_state.sql"
  );
  const preflightPath = join(
    root,
    "scripts/db/inbox-v2-employee-conversation-state-preflight.sql"
  );
  const invariantPath = join(
    root,
    "packages/db/src/schema/inbox-v2/employee-conversation-state.ts"
  );
  await Promise.all([
    mkdir(dirname(migrationPath), { recursive: true }),
    mkdir(dirname(preflightPath), { recursive: true }),
    mkdir(dirname(invariantPath), { recursive: true })
  ]);

  const statements = [
    "CREATE TYPE \"public\".\"inbox_v2_employee_conversation_notification_level\" AS ENUM('inherit', 'all', 'mentions_only', 'none');",
    'CREATE TABLE "inbox_v2_employee_conversation_states" ("tenant_id" text NOT NULL);',
    'ALTER TABLE "inbox_v2_employee_conversation_states" ADD CONSTRAINT "inbox_v2_employee_conversation_states_employee_fk" FOREIGN KEY ("tenant_id") REFERENCES "employees"("tenant_id");',
    'ALTER TABLE "inbox_v2_employee_conversation_states" ADD CONSTRAINT "inbox_v2_employee_conversation_states_conversation_fk" FOREIGN KEY ("tenant_id") REFERENCES "inbox_v2_conversations"("tenant_id");'
  ];
  await Promise.all([
    writeFile(
      migrationPath,
      `${statements.join(`\n${statementBreakpoint}\n`)}\n`,
      "utf8"
    ),
    writeFile(
      preflightPath,
      `-- ${preflightMarker}\ndo $preflight$ begin null; end; $preflight$;\n`,
      "utf8"
    ),
    writeFile(
      invariantPath,
      options.missingInvariant
        ? "export const SOMETHING_ELSE = String.raw`select 1`;\n"
        : `export const INBOX_V2_EMPLOYEE_CONVERSATION_STATE_INVARIANTS_SQL = String.raw\`${invariantSql}\`;\n`,
      "utf8"
    )
  ]);

  return { root, migrationPath, statements };
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
