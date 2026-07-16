import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createChildDatabaseUrl,
  createDisposableDatabaseName,
  discoverInboxV2PostgresIntegrationTests,
  parseRunnerArguments,
  pnpmExecutable
} from "./run-inbox-v2-postgres-integration.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("Inbox V2 PostgreSQL integration gate runner", () => {
  it("discovers only opted-in repository/schema integration tests in stable order", async () => {
    const repositoryRoot = await temporaryRepository();
    await writeFixture(
      repositoryRoot,
      "packages/db/src/repositories/z.integration.test.ts",
      "process.env.HULEE_DB_INTEGRATION"
    );
    await writeFixture(
      repositoryRoot,
      "packages/db/src/repositories/ignored.integration.test.ts",
      "describe.skip('not opted in', () => {})"
    );
    await writeFixture(
      repositoryRoot,
      "packages/db/src/schema/a.integration.test.ts",
      "const flag = 'HULEE_DB_INTEGRATION'"
    );
    await writeFixture(
      repositoryRoot,
      "scripts/db/out-of-scope.integration.test.ts",
      "process.env.HULEE_DB_INTEGRATION"
    );

    await expect(
      discoverInboxV2PostgresIntegrationTests({ repositoryRoot })
    ).resolves.toEqual([
      "packages/db/src/repositories/z.integration.test.ts",
      "packages/db/src/schema/a.integration.test.ts"
    ]);
  });

  it("rejects an empty integration corpus", async () => {
    const repositoryRoot = await temporaryRepository();
    await expect(
      discoverInboxV2PostgresIntegrationTests({ repositoryRoot })
    ).rejects.toThrow("No opt-in Inbox V2 PostgreSQL");
  });

  it("rejects shell-sensitive integration test paths", async () => {
    const repositoryRoot = await temporaryRepository();
    await writeFixture(
      repositoryRoot,
      "packages/db/src/repositories/unsafe&command.integration.test.ts",
      "process.env.HULEE_DB_INTEGRATION"
    );
    await expect(
      discoverInboxV2PostgresIntegrationTests({ repositoryRoot })
    ).rejects.toThrow("Unsafe Inbox V2 PostgreSQL integration test path");
  });

  it("builds a safe bounded disposable database name", () => {
    expect(
      createDisposableDatabaseName({
        now: 1_720_000_000_000,
        processId: 12_345,
        randomToken: "abcdef123456"
      })
    ).toBe("hulee_inbox_v2_gate_ly5nl9ts_9ix_abcdef123456");
  });

  it("changes only the database path in the child connection URL", () => {
    expect(
      createChildDatabaseUrl(
        "postgresql://user:secret@localhost:5432/postgres?sslmode=disable",
        "hulee_inbox_v2_gate_child"
      )
    ).toBe(
      "postgresql://user:secret@localhost:5432/hulee_inbox_v2_gate_child?sslmode=disable"
    );
  });

  it("rejects unsafe child database names and connection schemes", () => {
    expect(() =>
      createChildDatabaseUrl(
        "postgresql://localhost/postgres",
        "postgres; drop database postgres"
      )
    ).toThrow("Unsafe disposable database name");
    expect(() =>
      createChildDatabaseUrl(
        "https://localhost/postgres",
        "hulee_inbox_v2_gate_child"
      )
    ).toThrow("postgres or postgresql scheme");
  });

  it("parses non-mutating modes and rejects ambiguous or unknown arguments", () => {
    expect(parseRunnerArguments([])).toEqual({
      dryRun: false,
      help: false,
      list: false
    });
    expect(parseRunnerArguments(["--list"]).list).toBe(true);
    expect(parseRunnerArguments(["--dry-run"]).dryRun).toBe(true);
    expect(() => parseRunnerArguments(["--list", "--dry-run"])).toThrow(
      "cannot be used together"
    );
    expect(() => parseRunnerArguments(["--unknown"])).toThrow(
      "Unknown argument"
    );
  });

  it("uses the native pnpm launcher on Windows", () => {
    expect(pnpmExecutable("win32")).toBe("pnpm.cmd");
    expect(pnpmExecutable("linux")).toBe("pnpm");
  });
});

async function temporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), "hulee-postgres-gate-"));
  temporaryRoots.push(root);
  await Promise.all([
    mkdir(join(root, "packages/db/src/repositories"), { recursive: true }),
    mkdir(join(root, "packages/db/src/schema"), { recursive: true })
  ]);
  return root;
}

async function writeFixture(root, relativePath, source) {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, "utf8");
}
