import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, "../..");
const integrationTestRoots = Object.freeze([
  "packages/db/src/repositories",
  "packages/db/src/schema"
]);
const integrationTestSuffix = ".integration.test.ts";
const optInMarker = "HULEE_DB_INTEGRATION";
const disposableDatabasePattern = /^hulee_inbox_v2_gate_[a-z0-9_]+$/u;
const safeIntegrationTestPathPattern =
  /^packages\/db\/src\/(?:repositories|schema)\/[A-Za-z0-9_./-]+\.integration\.test\.ts$/u;

export async function main(argv = process.argv.slice(2)) {
  const options = parseRunnerArguments(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const testFiles = await discoverInboxV2PostgresIntegrationTests({
    repositoryRoot: defaultRepositoryRoot
  });

  if (options.list) {
    printTestCorpus(testFiles);
    return;
  }

  if (options.dryRun) {
    printDryRun(testFiles);
    return;
  }

  const databaseUrl = requiredDatabaseUrl(process.env.DATABASE_URL);
  await runInboxV2PostgresIntegrationGate({
    databaseUrl,
    repositoryRoot: defaultRepositoryRoot,
    testFiles
  });
}

export function parseRunnerArguments(argv) {
  const options = {
    dryRun: false,
    help: false,
    list: false
  };

  for (const argument of argv) {
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--list") {
      options.list = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.dryRun && options.list) {
    throw new Error("--dry-run and --list cannot be used together.");
  }

  return Object.freeze(options);
}

export async function discoverInboxV2PostgresIntegrationTests({
  repositoryRoot,
  roots = integrationTestRoots
}) {
  const discovered = [];

  for (const root of roots) {
    const absoluteRoot = resolve(repositoryRoot, root);
    for (const absolutePath of await walkFiles(absoluteRoot)) {
      if (!absolutePath.endsWith(integrationTestSuffix)) continue;
      const source = await readFile(absolutePath, "utf8");
      if (!source.includes(optInMarker)) continue;
      const relativePath = toPortableRelativePath(repositoryRoot, absolutePath);
      assertSafeIntegrationTestPath(relativePath);
      discovered.push(relativePath);
    }
  }

  discovered.sort((left, right) => left.localeCompare(right, "en"));
  if (discovered.length === 0) {
    throw new Error(
      "No opt-in Inbox V2 PostgreSQL repository/schema integration tests were found."
    );
  }
  return Object.freeze(discovered);
}

export function createDisposableDatabaseName({
  now = Date.now(),
  processId = process.pid,
  randomToken = randomBytes(6).toString("hex")
} = {}) {
  const databaseName = [
    "hulee_inbox_v2_gate",
    Number(now).toString(36),
    Number(processId).toString(36),
    randomToken.toLowerCase()
  ].join("_");
  assertDisposableDatabaseName(databaseName);
  return databaseName;
}

export function createChildDatabaseUrl(databaseUrl, databaseName) {
  assertDisposableDatabaseName(databaseName);
  const url = new URL(requiredDatabaseUrl(databaseUrl));
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme.");
  }
  url.pathname = `/${databaseName}`;
  url.hash = "";
  return url.toString();
}

export function pnpmExecutable(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export async function runInboxV2PostgresIntegrationGate({
  databaseUrl,
  repositoryRoot,
  testFiles
}) {
  if (!Array.isArray(testFiles) || testFiles.length === 0) {
    throw new Error("The Inbox V2 PostgreSQL integration corpus is empty.");
  }

  const databaseName = createDisposableDatabaseName();
  const childDatabaseUrl = createChildDatabaseUrl(databaseUrl, databaseName);
  const adminClient = new Client({ connectionString: databaseUrl });
  let connected = false;
  let created = false;
  let runError = null;
  let cleanupError = null;

  try {
    await adminClient.connect();
    connected = true;
    console.log(`Creating disposable PostgreSQL database ${databaseName}.`);
    await adminClient.query(`create database ${quoteIdentifier(databaseName)}`);
    created = true;

    const childEnvironment = {
      ...process.env,
      DATABASE_URL: childDatabaseUrl,
      HULEE_DB_INTEGRATION: "1",
      NODE_ENV: "test"
    };
    delete childEnvironment.HULEE_MIGRATIONS_FOLDER;

    console.log("Applying the current migration bundle with pnpm db:migrate.");
    await runCommand({
      command: pnpmExecutable(),
      arguments_: ["db:migrate"],
      cwd: repositoryRoot,
      environment: childEnvironment
    });

    console.log(
      `Running ${testFiles.length} Inbox V2 PostgreSQL repository/schema integration test files sequentially.`
    );
    await runCommand({
      command: pnpmExecutable(),
      arguments_: [
        "exec",
        "vitest",
        "run",
        "--no-file-parallelism",
        ...testFiles
      ],
      cwd: repositoryRoot,
      environment: childEnvironment
    });
  } catch (error) {
    runError = error;
  } finally {
    if (connected && created) {
      try {
        await dropDisposableDatabase(adminClient, databaseName);
        console.log(`Dropped disposable PostgreSQL database ${databaseName}.`);
      } catch (error) {
        cleanupError = error;
      }
    }
    if (connected) {
      try {
        await adminClient.end();
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }

  if (runError && cleanupError) {
    throw new AggregateError(
      [runError, cleanupError],
      "Inbox V2 PostgreSQL integration gate and disposable database cleanup both failed."
    );
  }
  if (runError) throw runError;
  if (cleanupError) throw cleanupError;
}

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function runCommand({ command, arguments_, cwd, environment }) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: environment,
      shell: process.platform === "win32",
      stdio: "inherit"
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectPromise(
        new Error(
          `${formatCommand(command, arguments_)} failed with ${outcome}.`
        )
      );
    });
  });
}

async function dropDisposableDatabase(client, databaseName) {
  assertDisposableDatabaseName(databaseName);
  await client.query(
    `select pg_catalog.pg_terminate_backend(pid)
       from pg_catalog.pg_stat_activity
      where datname = $1
        and pid <> pg_catalog.pg_backend_pid()`,
    [databaseName]
  );
  await client.query(
    `drop database if exists ${quoteIdentifier(databaseName)}`
  );
}

function printTestCorpus(testFiles) {
  console.log(
    `Inbox V2 PostgreSQL repository/schema integration corpus (${testFiles.length} files):`
  );
  for (const testFile of testFiles) console.log(testFile);
}

function printDryRun(testFiles) {
  console.log(
    "[dry-run] Create one disposable child database from DATABASE_URL."
  );
  console.log(`[dry-run] ${formatCommand("pnpm", ["db:migrate"])}`);
  console.log(
    `[dry-run] ${formatCommand("pnpm", [
      "exec",
      "vitest",
      "run",
      "--no-file-parallelism",
      ...testFiles
    ])}`
  );
  console.log("[dry-run] Drop the disposable child database in cleanup.");
}

function printHelp() {
  console.log(`Usage: pnpm test:inbox-v2:postgres [-- --list|--dry-run]

Creates a disposable child database from DATABASE_URL, applies the ordinary
pnpm db:migrate path, runs every opt-in Inbox V2 repository/schema PostgreSQL
integration test sequentially, and drops the child database.

Options:
  --list     List the discovered opt-in integration corpus without a database.
  --dry-run  Print the planned migration/test lifecycle without a database.
  --help     Show this help.`);
}

function assertDisposableDatabaseName(databaseName) {
  if (
    typeof databaseName !== "string" ||
    databaseName.length > 63 ||
    !disposableDatabasePattern.test(databaseName)
  ) {
    throw new Error(`Unsafe disposable database name: ${databaseName}`);
  }
}

function assertSafeIntegrationTestPath(path) {
  if (!safeIntegrationTestPathPattern.test(path)) {
    throw new Error(
      `Unsafe Inbox V2 PostgreSQL integration test path: ${path}`
    );
  }
}

function requiredDatabaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      "DATABASE_URL is required; refusing to use an implicit PostgreSQL database."
    );
  }
  return value.trim();
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function toPortableRelativePath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

function formatCommand(command, arguments_) {
  return [command, ...arguments_]
    .map((part) =>
      /^[A-Za-z0-9_./:@=-]+$/u.test(part) ? part : JSON.stringify(part)
    )
    .join(" ");
}

function isExecutedDirectly() {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isExecutedDirectly()) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}
