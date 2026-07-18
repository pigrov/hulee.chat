import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  INBOX_V2_SOURCE_GATE_TASK_GROUPS,
  INBOX_V2_SOURCE_GATE_TASK_IDS
} from "./inbox-v2-source-gate-manifest.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, "../..");
const safeTestPathPattern =
  /^(?:(?:apps\/(?:api|web|worker)|packages\/(?:contracts|db|modules|testing))\/src|scripts\/test)\/[A-Za-z0-9_./-]+\.test\.(?:ts|mjs)$/u;
const integrationTestPattern = /\.integration\.test\.(?:ts|mjs)$/u;

export const inboxV2SourceGateTaskIds = INBOX_V2_SOURCE_GATE_TASK_IDS;
export const inboxV2SourceGateGroups = INBOX_V2_SOURCE_GATE_TASK_GROUPS;

export async function main(argv = process.argv.slice(2)) {
  const options = parseRunnerArguments(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const testFiles = flattenInboxV2SourceGateManifest(inboxV2SourceGateGroups);
  await assertInboxV2SourceGateFilesExist({
    repositoryRoot: defaultRepositoryRoot,
    testFiles
  });

  if (options.list) {
    printTestCorpus(inboxV2SourceGateGroups, testFiles.length);
    return;
  }

  await runVitest({
    repositoryRoot: defaultRepositoryRoot,
    testFiles
  });
}

export function parseRunnerArguments(argv) {
  const options = { help: false, list: false };
  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--list") {
      options.list = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return Object.freeze(options);
}

export function flattenInboxV2SourceGateManifest(groups) {
  if (!Array.isArray(groups)) {
    throw new TypeError("Inbox V2 source gate manifest must be an array.");
  }

  const expectedTaskIds = new Set(inboxV2SourceGateTaskIds);
  const observedTaskIds = new Set();
  const observedTestFiles = new Set();
  const testFiles = [];

  for (const entry of groups) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      !expectedTaskIds.has(entry.taskId)
    ) {
      throw new Error(`Unexpected Inbox V2 source gate task: ${entry?.taskId}`);
    }
    if (observedTaskIds.has(entry.taskId)) {
      throw new Error(`Duplicate Inbox V2 source gate task: ${entry.taskId}`);
    }
    if (!Array.isArray(entry.testFiles) || entry.testFiles.length === 0) {
      throw new Error(
        `Inbox V2 source gate task has no tests: ${entry.taskId}`
      );
    }
    observedTaskIds.add(entry.taskId);

    for (const testFile of entry.testFiles) {
      const pathSegments =
        typeof testFile === "string" ? testFile.split("/") : [];
      if (
        typeof testFile !== "string" ||
        !safeTestPathPattern.test(testFile) ||
        integrationTestPattern.test(testFile) ||
        pathSegments.some(
          (segment) => segment === "" || segment === "." || segment === ".."
        )
      ) {
        throw new Error(`Unsafe Inbox V2 source gate test path: ${testFile}`);
      }
      if (observedTestFiles.has(testFile)) {
        throw new Error(
          `Duplicate Inbox V2 source gate test path: ${testFile}`
        );
      }
      observedTestFiles.add(testFile);
      testFiles.push(testFile);
    }
  }

  const missingTaskIds = inboxV2SourceGateTaskIds.filter(
    (taskId) => !observedTaskIds.has(taskId)
  );
  if (missingTaskIds.length > 0) {
    throw new Error(
      `Inbox V2 source gate manifest misses tasks: ${missingTaskIds.join(", ")}`
    );
  }

  return Object.freeze(testFiles);
}

export async function assertInboxV2SourceGateFilesExist({
  repositoryRoot,
  testFiles
}) {
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  for (const testFile of testFiles) {
    let canonicalTestFile;
    try {
      canonicalTestFile = await realpath(
        resolve(canonicalRepositoryRoot, ...testFile.split("/"))
      );
    } catch {
      throw new Error(`Inbox V2 source gate test file is missing: ${testFile}`);
    }
    const relativeTestFile = relative(
      canonicalRepositoryRoot,
      canonicalTestFile
    );
    if (
      relativeTestFile === "" ||
      relativeTestFile === ".." ||
      relativeTestFile.startsWith(`..${sep}`) ||
      isAbsolute(relativeTestFile)
    ) {
      throw new Error(
        `Inbox V2 source gate test file escapes the repository: ${testFile}`
      );
    }
    if (!(await stat(canonicalTestFile)).isFile()) {
      throw new Error(
        `Inbox V2 source gate test path is not a regular file: ${testFile}`
      );
    }
  }
}

export function pnpmExecutable(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

async function runVitest({ repositoryRoot, testFiles }) {
  await new Promise((resolvePromise, rejectPromise) => {
    const command = pnpmExecutable();
    const arguments_ = [
      "exec",
      "vitest",
      "run",
      "--no-file-parallelism",
      ...testFiles
    ];
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: { ...process.env, NODE_ENV: "test" },
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
      rejectPromise(new Error(`Inbox V2 source gate failed with ${outcome}.`));
    });
  });
}

function printTestCorpus(groups, fileCount) {
  console.log(
    `Inbox V2 Epic 3 source gate corpus (${groups.length} tasks, ${fileCount} files):`
  );
  for (const entry of groups) {
    console.log(`${entry.taskId} (${entry.testFiles.length} files)`);
    for (const testFile of entry.testFiles) console.log(`  ${testFile}`);
  }
}

function printHelp() {
  console.log(`Usage: pnpm test:inbox-v2:source [-- --list]

Runs the explicit non-PostgreSQL Inbox V2 Epic 3 source corpus. Use
pnpm test:inbox-v2:postgres separately for the live repository/schema corpus.

Options:
  --list  List the task-grouped source corpus without running Vitest.
  --help  Show this help.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
