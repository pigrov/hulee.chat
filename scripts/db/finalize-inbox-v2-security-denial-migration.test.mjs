import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const finalizerPath = fileURLToPath(
  new URL("./finalize-inbox-v2-security-denial-migration.mjs", import.meta.url)
);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_SECURITY_DENIAL_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_SECURITY_DENIAL_PREFLIGHT_V1";
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Inbox V2 security-denial migration finalizer", () => {
  it("validates and injects the complete RBAC-007 object inventory", async () => {
    const fixture = await createCurrentSchemaFixture();

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "verified 3 tables, 11 enums and 3 functions"
    );
    const finalized = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(finalized, finalizedMarker)).toBe(1);
    expect(countOccurrences(finalized, preflightMarker)).toBe(1);
    expect(countOccurrences(finalized, "inbox_v2_security_denial_record")).toBe(
      2
    );
    expect(countOccurrences(finalized, "inbox_v2_security_denial_prune")).toBe(
      2
    );
  });

  it("refuses to finalize an already finalized migration", async () => {
    const fixture = await createCurrentSchemaFixture();
    expect(runFinalizer(fixture.root, fixture.migrationPath).status).toBe(0);
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already finalized");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("refreshes only the generated/invariant sections when explicitly requested", async () => {
    const fixture = await createCurrentSchemaFixture();
    expect(runFinalizer(fixture.root, fixture.migrationPath).status).toBe(0);

    const result = runFinalizer(fixture.root, fixture.migrationPath, true);

    expect(result.status, result.stderr).toBe(0);
    const refreshed = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(refreshed, finalizedMarker)).toBe(1);
    expect(countOccurrences(refreshed, preflightMarker)).toBe(1);
  });

  it("rejects incomplete or destructive generated DDL before writing", async () => {
    for (const options of [{ missingTable: true }, { destructiveDdl: true }]) {
      const fixture = await createCurrentSchemaFixture(options);
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

  it("rejects stale preflight inventory before writing", async () => {
    const fixture = await createCurrentSchemaFixture({ stalePreflight: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("preflight tables list is stale");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects forbidden sink dependencies in invariant SQL", async () => {
    const fixture = await createCurrentSchemaFixture({ forbiddenSink: true });
    const before = await readFile(fixture.migrationPath, "utf8");

    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("forbidden sink dependency jsonb");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });
});

async function createCurrentSchemaFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "hulee-rbac007-finalizer-"));
  temporaryRoots.push(root);
  const migrationPath = join(
    root,
    "packages/db/drizzle/0035_inbox_v2_security_denial_sink.sql"
  );
  const preflightPath = join(
    root,
    "scripts/db/inbox-v2-security-denial-preflight.sql"
  );
  const schemaPath = join(
    root,
    "packages/db/src/schema/inbox-v2/security-denial.ts"
  );
  const [currentPreflight, currentSchema] = await Promise.all([
    readFile(
      join(repositoryRoot, "scripts/db/inbox-v2-security-denial-preflight.sql"),
      "utf8"
    ),
    readFile(
      join(
        repositoryRoot,
        "packages/db/src/schema/inbox-v2/security-denial.ts"
      ),
      "utf8"
    )
  ]);
  const schemaSource = options.forbiddenSink
    ? currentSchema.replace(
        "create or replace function public.inbox_v2_security_denial_record(",
        "-- jsonb is forbidden here\ncreate or replace function public.inbox_v2_security_denial_record("
      )
    : currentSchema;
  const tableNames = [...schemaSource.matchAll(/pgTable\(\s*"([^"]+)"/g)].map(
    (match) => match[1]
  );
  const enumNames = [...schemaSource.matchAll(/pgEnum\(\s*"([^"]+)"/g)].map(
    (match) => match[1]
  );
  const includedTables = options.missingTable
    ? tableNames.slice(0, -1)
    : tableNames;
  const statements = [
    ...enumNames.map(
      (enumName) => `CREATE TYPE "public"."${enumName}" AS ENUM('fixture');`
    ),
    ...includedTables.map(
      (tableName) => `CREATE TABLE "${tableName}" ("tenant_id" text NOT NULL);`
    ),
    ...(options.destructiveDdl ? ['DROP TABLE "tenants";'] : [])
  ];
  const preflightSource = options.stalePreflight
    ? currentPreflight.replace(
        "'inbox_v2_security_denial_window_shards'",
        "'inbox_v2_security_denial_stale'"
      )
    : currentPreflight;

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

function runFinalizer(root, migrationPath, refreshFinalized = false) {
  return spawnSync(
    process.execPath,
    [
      finalizerPath,
      migrationPath,
      ...(refreshFinalized ? ["--refresh-finalized"] : [])
    ],
    {
      cwd: root,
      encoding: "utf8"
    }
  );
}

function countOccurrences(value, fragment) {
  return value.split(fragment).length - 1;
}
