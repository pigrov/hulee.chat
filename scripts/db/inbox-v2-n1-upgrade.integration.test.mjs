import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  digestMigrationJournal,
  expectedMigrationContract,
  installInboxV2Database,
  readAppliedMigrationJournal
} from "./inbox-v2-database-lifecycle.mjs";
import { sha256 } from "./inbox-v2-install-contract.mjs";

const { Client, Pool } = pg;
const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const migrationsFolder = resolve("packages/db/drizzle");
const fixtureFolder = resolve("scripts/db/fixtures/inbox-v2");
const bundlePath = join(fixtureFolder, "db008-n1-runtime-probe.bundle.cjs");
const contractPath = join(
  fixtureFolder,
  "db008-n1-runtime-probe.contract.json"
);
const expectedSourceRevision = "3b9d703bb63d5ce39ea549d62413dee02d1969a0";
const expectedCompatibilityPatchId =
  "db008-n1-routing-returning-qualification-v1";
const createdDatabases = [];
let adminClient;
let temporaryRoot;

describe("Inbox V2 pinned N-1 runtime artifact", () => {
  it("verifies the source, build inputs, bundle, lockfile and exact migration boundary digests", async () => {
    const contract = await readContract();

    expect(contract).toMatchObject({
      schemaId: "core:inbox-v2.db008-n1-runtime-bundle@v1",
      artifactKind: "n-1-compatibility-build",
      source: {
        revision: expectedSourceRevision,
        tree: "06e6dcad7a6f1d415e42376b62a1716233206373"
      },
      compatibility: {
        patches: [
          {
            id: expectedCompatibilityPatchId,
            reason:
              "Qualify the routing UPDATE RETURNING target columns so PostgreSQL does not raise 42702 while an N-1 process remains online during expand.",
            path: "packages/db/src/repositories/external-message-repository.ts",
            baseSha256:
              "sha256:7bda3b8354c3325ba2e221f8a163ec54cc298104d83f030b59cd34745932df50",
            patchedSha256:
              "sha256:c9e4b84e524058a92911f4aa6114b7c99c9bff62b847e43dc0fdde50f51e32bc"
          }
        ]
      },
      runtimeBoundary: {
        kind: "source-bundled-process-harness",
        exercises: [
          "N-1 internal inbox query, reply and routing services",
          "N-1 Web loadInboxViewModel with pinned session/config stubs and in-process fetch",
          "N-1 processOutboxBatch with a fake no-provider handler",
          "one N-1 database pool and backend across pre-expand, failed-expand and post-expand probes"
        ],
        doesNotExercise: [
          "Next.js server bootstrap",
          "API HTTP server bootstrap",
          "container or deployment image entrypoint",
          "provider network egress"
        ]
      },
      build: {
        esbuildVersion: "0.28.1",
        platform: "node",
        format: "cjs",
        target: "node22",
        minify: true,
        externalPackages: {
          pg: "8.22.0",
          "drizzle-orm": "0.45.2",
          zod: "4.4.3"
        }
      },
      migrations: {
        folder: "packages/db/drizzle",
        count: 35,
        last: {
          hash: "d628f034e497ff7b521ab68febe7f38e57cc7dfeb9222da07615f7bf935d50e5",
          createdAt: "1784118691728"
        },
        digest:
          "sha256:bdbc7e631b2364b5c674eccc63bbe2ddf18c2a462988eb39258b2dd2bc8ce704"
      },
      upgradeTarget: {
        folder: "packages/db/drizzle",
        count: 44,
        digest:
          "sha256:97e9204e2c12572f14bc23e91bde1bf03e4f701bed6d804f02a55c2f2be72d45"
      }
    });

    await expectArtifactDigest(contract.bundle);
    await expectArtifactDigest(contract.inputs.entry);
    await expectArtifactDigest(contract.inputs.webSessionStub);
    await expectArtifactDigest(contract.inputs.webConfigStub);
    await expectArtifactDigest(contract.compatibility.patches[0].patchArtifact);
    expect(contract.runtimeBoundary.sourceModules).toEqual([
      {
        path: "apps/api/src/internal-inbox-service.ts",
        sha256:
          "sha256:74bb44c8e89a2fed449fa8ad2fb15d49e87cd22b1fc93f6ac00ee6fcfdc1a7d7"
      },
      {
        path: "apps/web/src/inbox-api-client.ts",
        sha256:
          "sha256:3425a8c91db51bd18c5018be47986667c2c2a802914d6e98da6dd6b0532182bb"
      },
      {
        path: "apps/worker/src/outbox-processor.ts",
        sha256:
          "sha256:17426e41a03f27dbcbaed1d48283c0efd26367fa04b0745eea1178f1f0e5305e"
      },
      {
        path: "packages/db/src/client.ts",
        sha256:
          "sha256:ffbaf03bf1ba48e9ddd1608b0370d137aeecdd6509602d359b1bb8430036e806"
      },
      {
        path: "packages/db/src/repositories/external-message-repository.ts",
        sha256:
          "sha256:c9e4b84e524058a92911f4aa6114b7c99c9bff62b847e43dc0fdde50f51e32bc"
      },
      {
        path: "packages/db/src/repositories/sql-outbox-repository.ts",
        sha256:
          "sha256:472ee90d6369d4fc39fb8a11e018ac3954f50618a900fed0744a77e2cdfb35cf"
      }
    ]);
    expect(
      contract.runtimeBoundary.sourceModules.find(
        ({ path }) => path === contract.compatibility.patches[0].path
      )?.sha256
    ).toBe(contract.compatibility.patches[0].patchedSha256);
    expect(
      sha256(await readFile(resolve(contract.compatibility.patches[0].path)))
    ).toBe(contract.compatibility.patches[0].patchedSha256);
    expect(sha256(await readFile(resolve(contract.lockfile.path)))).toBe(
      contract.lockfile.sha256
    );

    const currentContract = expectedMigrationContract(migrationsFolder);
    const n1Prefix = currentContract.slice(0, contract.migrations.count);
    expect(n1Prefix).toHaveLength(contract.migrations.count);
    expect(n1Prefix[0]).toEqual(contract.migrations.first);
    expect(n1Prefix.at(-1)).toEqual(contract.migrations.last);
    expect(digestMigrationJournal(n1Prefix)).toBe(contract.migrations.digest);
    expect(currentContract).toHaveLength(contract.upgradeTarget.count);
    expect(currentContract[0]).toEqual(contract.upgradeTarget.first);
    expect(currentContract.at(-1)).toEqual(contract.upgradeTarget.last);
    expect(digestMigrationJournal(currentContract)).toBe(
      contract.upgradeTarget.digest
    );
  });
});

describePostgres("Inbox V2 source-bundled N-1 compatibility upgrade", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for the DB-008 N-1 integration test."
      );
    }
    temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-db008-n1-test-"));
    adminClient = new Client({ connectionString: process.env.DATABASE_URL });
    await adminClient.connect();
  }, 30_000);

  afterAll(async () => {
    const cleanupErrors = [];
    if (adminClient) {
      for (const databaseName of createdDatabases.reverse()) {
        assertDisposableTestDatabaseName(databaseName);
        try {
          await adminClient.query(
            `select pg_catalog.pg_terminate_backend(pid)
               from pg_catalog.pg_stat_activity
              where datname = $1
                and pid <> pg_backend_pid()`,
            [databaseName]
          );
          await adminClient.query(
            `drop database if exists ${quoteIdentifier(databaseName)}`
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      await adminClient.end().catch((error) => cleanupErrors.push(error));
    }
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true }).catch((error) =>
        cleanupErrors.push(error)
      );
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "DB-008 N-1 cleanup failed.");
    }
  }, 60_000);

  it("keeps the source-bundled N-1 compatibility process healthy through rollback and additive expand", async () => {
    const contract = await readContract();
    const database = await createDisposableDatabase("runtime_upgrade");
    const prefixFolder = await prepareMigrationDirectory(
      "n1-prefix",
      contract.migrations.count
    );
    await applyMigrations(database.url, prefixFolder);
    await expectAppliedJournal(database.url, contract.migrations);

    const runtime = startN1Runtime(database.url);
    try {
      const ready = await runtime.readMessage("ready");
      expect(ready).toMatchObject({
        type: "ready",
        protocolVersion: 1,
        sourceRevision: expectedSourceRevision,
        artifactKind: "n-1-compatibility-build",
        compatibilityPatchId: expectedCompatibilityPatchId,
        runtimeBoundary: "source-bundled-process-harness",
        api: {
          initialConversationCount: 1,
          initialMessageCount: 1,
          preReply: {
            status: "queued",
            idempotencyKey: "db008:n-1:reply:before-expand"
          },
          preRouting: {
            conversationId: ready.workspace.conversationId,
            assignedEmployeeId: ready.workspace.employeeId
          }
        },
        web: {
          conversationCount: 1,
          messageCount: 2,
          selectedConversationId: ready.workspace.conversationId,
          directions: ["inbound", "outbound"]
        },
        worker: {
          handler: "fake-no-provider",
          claimed: 5,
          processed: 5,
          failed: 0,
          skippedDuplicates: 0,
          messageSentIds: []
        }
      });
      expect(ready.backend.pid).toBeGreaterThan(0);
      const allowedEnvironmentKeys = new Set([
        "HULEE_DB008_DATABASE_URL",
        "NODE_ENV",
        "TZ",
        ...(process.platform === "win32"
          ? [
              "HOMEDRIVE",
              "HOMEPATH",
              "LOGONSERVER",
              "PATH",
              "SYSTEMDRIVE",
              "SYSTEMROOT",
              "TEMP",
              "USERDOMAIN",
              "USERNAME",
              "USERPROFILE",
              "WINDIR"
            ]
          : [])
      ]);
      expect(ready.environmentKeys).toEqual(
        expect.arrayContaining(["HULEE_DB008_DATABASE_URL", "NODE_ENV", "TZ"])
      );
      expect(
        ready.environmentKeys.filter((key) => !allowedEnvironmentKeys.has(key))
      ).toEqual([]);
      expect(
        await readTenantOutboxStatuses(database.url, ready.workspace.tenantId)
      ).toEqual([
        { status: "pending", count: 2 },
        { status: "processed", count: 5 }
      ]);

      const beforeFailure = await captureV1Fingerprint(database.url);
      const failedExpandFolder = await prepareFailedExpandDirectory(
        contract.migrations.count,
        ready.workspace.inboundMessageId
      );
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder: failedExpandFolder,
          lockTimeoutMs: 1_234,
          statementTimeoutMs: 5_678,
          allowEphemeralBlockingDdlCompatibilityTest: true
        })
        // The production lifecycle only rethrows the original 22012 after
        // both session-scoped DDL timeout settings have reset successfully.
      ).rejects.toMatchObject({ cause: { code: "22012" } });
      await expectAppliedJournal(database.url, contract.migrations);
      expect(await captureV1Fingerprint(database.url)).toEqual(beforeFailure);
      await expect(
        withClient(database.url, async (client) => {
          const result = await client.query(
            "select to_regclass('public.inbox_v2_db008_forced_failure') as relation_name"
          );
          return result.rows[0].relation_name;
        })
      ).resolves.toBeNull();
      await expectFailedInstallCleanup(database, ready.backend.pid);

      runtime.send({ command: "after-failed-migration" });
      const afterFailure = await runtime.readMessage("after-failed-migration");
      expect(afterFailure).toMatchObject({
        type: "after-failed-migration",
        protocolVersion: 1,
        sourceRevision: expectedSourceRevision,
        artifactKind: "n-1-compatibility-build",
        compatibilityPatchId: expectedCompatibilityPatchId,
        runtimeBoundary: "source-bundled-process-harness",
        processPid: ready.processPid,
        backend: ready.backend,
        sameBackend: true,
        api: {
          view: {
            conversationCount: 1,
            messageCount: 2,
            selectedConversationId: ready.workspace.conversationId
          },
          retriedPreReply: {
            messageId: ready.api.preReply.messageId,
            idempotencyKey: "db008:n-1:reply:before-expand"
          },
          assignedEmployeeId: ready.workspace.employeeId
        },
        web: {
          conversationCount: 1,
          messageCount: 2,
          selectedConversationId: ready.workspace.conversationId
        }
      });
      expect(await captureV1Fingerprint(database.url)).toEqual(beforeFailure);
      expect(
        await readTenantOutboxStatuses(database.url, ready.workspace.tenantId)
      ).toEqual([
        { status: "pending", count: 2 },
        { status: "processed", count: 5 }
      ]);

      const install = await installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder,
        lockTimeoutMs: 2_345,
        statementTimeoutMs: 6_789,
        allowEphemeralBlockingDdlCompatibilityTest: true
      });
      expect(install).toMatchObject({
        action: "install",
        migrationCount: contract.upgradeTarget.count,
        migrationContractSha256: contract.upgradeTarget.digest,
        migrationJournalSha256: contract.upgradeTarget.digest,
        expandDdlRisk: {
          schemaId: "core:inbox-v2.expand-ddl-risk-evidence@v2",
          appliedMigrationCount: contract.migrations.count,
          pendingMigrationCount:
            contract.upgradeTarget.count - contract.migrations.count,
          requiresOnlineBridge: true,
          overrideRequested: true,
          overrideAuthorized: true
        },
        migrationDdlBudget: {
          schemaId: "core:inbox-v2.migration-ddl-budget-evidence@v1",
          sessionScope: "lifecycle_advisory_lock_connection",
          lockTimeoutMs: 2_345,
          statementTimeoutMs: 6_789,
          appliedLockTimeout: "2345ms",
          appliedStatementTimeout: "6789ms",
          sessionSettingsReset: true
        }
      });
      expect(install.expandDdlRisk.violationCount).toBeGreaterThan(0);
      expect(install.expandDdlRisk.reportSha256).toMatch(
        /^sha256:[0-9a-f]{64}$/u
      );
      expect(await captureV1Fingerprint(database.url)).toEqual(beforeFailure);
      await expectAppliedJournal(database.url, contract.upgradeTarget);

      runtime.send({ command: "after-expand" }, { end: true });
      const after = await runtime.readMessage("after-expand");
      const exit = await runtime.waitForExit();

      expect(exit).toEqual({ code: 0, signal: null });
      expect(after).toMatchObject({
        type: "after-expand",
        protocolVersion: 1,
        sourceRevision: expectedSourceRevision,
        artifactKind: "n-1-compatibility-build",
        compatibilityPatchId: expectedCompatibilityPatchId,
        runtimeBoundary: "source-bundled-process-harness",
        processPid: ready.processPid,
        backend: ready.backend,
        sameBackend: true,
        api: {
          beforeWrite: {
            conversationCount: 1,
            messageCount: 2,
            selectedConversationId: ready.workspace.conversationId
          },
          retriedPreReply: {
            messageId: ready.api.preReply.messageId,
            idempotencyKey: "db008:n-1:reply:before-expand"
          },
          postReply: {
            status: "queued",
            idempotencyKey: "db008:n-1:reply:after-expand"
          },
          postRouting: {
            conversationId: ready.workspace.conversationId,
            assignedEmployeeId: null
          },
          final: {
            conversationCount: 1,
            messageCount: 3,
            selectedConversationId: ready.workspace.conversationId,
            directions: ["inbound", "outbound", "outbound"]
          }
        },
        web: {
          conversationCount: 1,
          messageCount: 2,
          selectedConversationId: ready.workspace.conversationId
        },
        worker: {
          handler: "fake-no-provider",
          failed: 0,
          skippedDuplicates: 0
        }
      });
      expect(after.api.postReply.messageId).not.toBe(
        ready.api.preReply.messageId
      );
      expect(after.worker.claimed).toBe(4);
      expect(after.worker.processed).toBe(after.worker.claimed);
      expect([...after.worker.messageSentIds].sort()).toEqual(
        [ready.api.preReply.messageId, after.api.postReply.messageId].sort()
      );
      expect(after.outboxStatuses).toEqual([
        {
          status: "processed",
          count: ready.worker.processed + after.worker.processed
        }
      ]);
    } finally {
      await runtime.stop();
    }
  }, 180_000);
});

async function readContract() {
  return JSON.parse(await readFile(contractPath, "utf8"));
}

async function expectArtifactDigest(artifact) {
  expect(artifact.path).toMatch(/^scripts\/db\/fixtures\/inbox-v2\//u);
  expect(sha256(await readFile(resolve(artifact.path)))).toBe(artifact.sha256);
}

async function prepareMigrationDirectory(name, migrationCount) {
  const destination = join(temporaryRoot, name);
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8")
  );
  const entries = journal.entries.slice(0, migrationCount);
  if (entries.length !== migrationCount) {
    throw new Error(
      `Requested ${migrationCount} migrations but found ${entries.length}.`
    );
  }
  await mkdir(join(destination, "meta"), { recursive: true });
  for (const entry of entries) {
    await copyFile(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(destination, `${entry.tag}.sql`)
    );
  }
  await writeFile(
    join(destination, "meta/_journal.json"),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
    "utf8"
  );
  return destination;
}

async function prepareFailedExpandDirectory(migrationCount, inboundMessageId) {
  const destination = await prepareMigrationDirectory(
    "forced-failed-expand",
    migrationCount
  );
  const journalPath = join(destination, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const previous = journal.entries.at(-1);
  const tag = "0035_db008_forced_failure";
  journal.entries.push({
    idx: migrationCount,
    version: previous.version,
    when: Number(previous.when) + 1,
    tag,
    breakpoints: true
  });
  await writeFile(
    join(destination, `${tag}.sql`),
    `update public.messages\n` +
      `   set text = 'DB-008 FAILED EXPAND MUST ROLLBACK'\n` +
      ` where id = '${escapeSqlLiteral(inboundMessageId)}';\n` +
      `--> statement-breakpoint\n` +
      `create table public.inbox_v2_db008_forced_failure (id text primary key);\n` +
      `--> statement-breakpoint\n` +
      `select 1 / 0;\n`,
    "utf8"
  );
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  return destination;
}

async function applyMigrations(databaseUrl, folder) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

async function expectAppliedJournal(databaseUrl, expected) {
  const journal = await withClient(databaseUrl, (client) =>
    readAppliedMigrationJournal(client)
  );
  const contract = journal.map(({ hash, createdAt }) => ({ hash, createdAt }));
  expect(contract).toHaveLength(expected.count);
  expect(contract[0]).toEqual(expected.first);
  expect(contract.at(-1)).toEqual(expected.last);
  expect(digestMigrationJournal(contract)).toBe(expected.digest);
}

async function captureV1Fingerprint(databaseUrl) {
  return withClient(databaseUrl, async (client) => {
    const relationResult = await client.query(`
      select table_name
        from information_schema.tables
       where table_schema = 'public'
         and table_type = 'BASE TABLE'
         and table_name not like 'inbox\\_v2\\_%' escape '\\'
       order by table_name
    `);
    const relations = [];
    const aggregate = createHash("sha256");
    for (const { table_name: relationName } of relationResult.rows) {
      const rows = await client.query(
        `select to_jsonb(relation_row)::text as row_json
           from public.${quoteIdentifier(relationName)} as relation_row
          order by to_jsonb(relation_row)::text`
      );
      const relationHash = createHash("sha256");
      for (const row of rows.rows) {
        const serialized = String(row.row_json);
        relationHash.update(`${Buffer.byteLength(serialized, "utf8")}:`);
        relationHash.update(serialized);
      }
      const relationDigest = `sha256:${relationHash.digest("hex")}`;
      relations.push({
        name: relationName,
        rowCount: rows.rowCount,
        digest: relationDigest
      });
      aggregate.update(
        `${relationName}\0${rows.rowCount}\0${relationDigest}\n`,
        "utf8"
      );
    }
    return {
      digest: `sha256:${aggregate.digest("hex")}`,
      relations
    };
  });
}

async function readTenantOutboxStatuses(databaseUrl, tenantId) {
  return withClient(databaseUrl, async (client) => {
    const result = await client.query(
      `select status, count(*)::int as row_count
         from public.outbox
        where tenant_id = $1
        group by status
        order by status`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      status: row.status,
      count: Number(row.row_count)
    }));
  });
}

async function expectFailedInstallCleanup(database, runtimeBackendPid) {
  const lockAvailable = await withClient(database.url, async (client) => {
    const result = await client.query(
      `select pg_catalog.pg_try_advisory_lock(pg_catalog.hashtext($1)) as locked`,
      ["hulee:inbox-v2:database-lifecycle:v1"]
    );
    if (result.rows[0].locked === true) {
      await client.query(
        `select pg_catalog.pg_advisory_unlock(pg_catalog.hashtext($1))`,
        ["hulee:inbox-v2:database-lifecycle:v1"]
      );
    }
    return result.rows[0].locked;
  });
  expect(lockAvailable).toBe(true);

  const sessions = await adminClient.query(
    `select pid::int
       from pg_catalog.pg_stat_activity
      where datname = $1
        and backend_type = 'client backend'
      order by pid`,
    [database.name]
  );
  expect(sessions.rows.map(({ pid }) => pid)).toEqual([runtimeBackendPid]);
}

function startN1Runtime(databaseUrl) {
  const child = spawn(process.execPath, [bundlePath], {
    cwd: resolve("."),
    env: {
      HULEE_DB008_DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      TZ: "UTC"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = output[Symbol.asyncIterator]();
  let stderr = "";
  let commandCount = 0;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  return {
    async readMessage(expectedType) {
      const next = await withTimeout(
        iterator.next(),
        60_000,
        `N-1 runtime did not emit ${expectedType}.`
      );
      if (next.done) {
        throw new Error(
          `N-1 runtime ended before ${expectedType}. stderr: ${stderr}`
        );
      }
      let message;
      try {
        message = JSON.parse(next.value);
      } catch (error) {
        throw new Error(
          `N-1 runtime emitted invalid JSON (${next.value}). stderr: ${stderr}`,
          { cause: error }
        );
      }
      if (message.type === "fatal") {
        throw new Error(
          `N-1 runtime failed: ${JSON.stringify(message.error, null, 2)}\nstderr: ${stderr}`
        );
      }
      expect(message.type).toBe(expectedType);
      return message;
    },
    send(command, options = {}) {
      if (child.stdin.destroyed || child.stdin.writableEnded) {
        throw new Error("N-1 runtime stdin is already closed.");
      }
      commandCount += 1;
      if (commandCount > 2) {
        throw new Error("N-1 runtime accepts at most two probe commands.");
      }
      const line = `${JSON.stringify(command)}\n`;
      if (options.end === true) {
        child.stdin.end(line);
        return;
      }
      child.stdin.write(line);
    },
    async waitForExit() {
      return withTimeout(
        new Promise((resolveExit) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolveExit({ code: child.exitCode, signal: child.signalCode });
            return;
          }
          child.once("exit", (code, signal) => resolveExit({ code, signal }));
        }),
        30_000,
        `N-1 runtime did not exit. stderr: ${stderr}`
      );
    },
    async stop() {
      output.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise((resolveExit) => child.once("exit", resolveExit));
      }
    }
  };
}

async function createDisposableDatabase(label) {
  const databaseName = `hulee_db008_n1_${label}_${randomBytes(5).toString("hex")}`;
  assertDisposableTestDatabaseName(databaseName);
  await adminClient.query(`create database ${quoteIdentifier(databaseName)}`);
  createdDatabases.push(databaseName);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return { name: databaseName, url: url.toString() };
}

async function withClient(databaseUrl, work) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
}

function assertDisposableTestDatabaseName(databaseName) {
  if (!/^hulee_db008_n1_[a-z0-9_]+$/u.test(databaseName)) {
    throw new Error(`Unsafe DB-008 N-1 database name: ${databaseName}`);
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeSqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}
