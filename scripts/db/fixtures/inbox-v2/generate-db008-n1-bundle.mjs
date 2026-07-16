import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRevision = "3b9d703bb63d5ce39ea549d62413dee02d1969a0";
const sourceTree = "06e6dcad7a6f1d415e42376b62a1716233206373";
const esbuildVersion = "0.28.1";
const compatibilityPatch = Object.freeze({
  id: "db008-n1-routing-returning-qualification-v1",
  reason:
    "Qualify the routing UPDATE RETURNING target columns so PostgreSQL does not raise 42702 while an N-1 process remains online during expand.",
  path: "packages/db/src/repositories/external-message-repository.ts",
  artifactName: "db008-n1-routing-returning-qualification.patch",
  baseSha256:
    "sha256:7bda3b8354c3325ba2e221f8a163ec54cc298104d83f030b59cd34745932df50",
  patchedSha256:
    "sha256:c9e4b84e524058a92911f4aa6114b7c99c9bff62b847e43dc0fdde50f51e32bc"
});
const runtimeSourcePaths = Object.freeze([
  "apps/api/src/internal-inbox-service.ts",
  "apps/web/src/inbox-api-client.ts",
  "apps/worker/src/outbox-processor.ts",
  "packages/db/src/client.ts",
  "packages/db/src/repositories/external-message-repository.ts",
  "packages/db/src/repositories/sql-outbox-repository.ts"
]);
const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(fixtureDirectory, "../../../..");
const entryName = "db008-n1-runtime-probe.entry.ts";
const sessionStubName = "db008-n1-web-session-stub.ts";
const configStubName = "db008-n1-web-config-stub.ts";
const bundleName = "db008-n1-runtime-probe.bundle.cjs";
const contractName = "db008-n1-runtime-probe.contract.json";
const temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-db008-n1-build-"));
const worktree = join(temporaryRoot, "source");
const temporaryBundle = join(temporaryRoot, bundleName);
let worktreeAdded = false;
let buildError;
const cleanupErrors = [];

try {
  runGit(["worktree", "add", "--detach", worktree, sourceRevision]);
  worktreeAdded = true;
  assertGitValue(worktree, "HEAD", sourceRevision);
  assertGitValue(worktree, "HEAD^{tree}", sourceTree);
  await applyCompatibilityPatch(worktree);
  await symlink(
    join(repositoryRoot, "node_modules"),
    join(worktree, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );
  await linkWorkspaceNodeModules(repositoryRoot, worktree);

  const injectedFixtureDirectory = join(
    worktree,
    "scripts/db/fixtures/inbox-v2"
  );
  await mkdir(injectedFixtureDirectory, { recursive: true });
  await copyFile(
    join(fixtureDirectory, entryName),
    join(injectedFixtureDirectory, entryName)
  );
  await copyFile(
    join(fixtureDirectory, sessionStubName),
    join(worktree, "apps/web/src/session.ts")
  );
  await copyFile(
    join(fixtureDirectory, configStubName),
    join(worktree, "apps/web/src/web-config.ts")
  );

  const aliases = await workspaceAliases(worktree);
  const esbuildExecutable = await resolveEsbuildExecutable(repositoryRoot);
  execFileSync(
    process.execPath,
    [
      esbuildExecutable,
      "scripts/db/fixtures/inbox-v2/db008-n1-runtime-probe.entry.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node22",
      "--charset=utf8",
      "--legal-comments=none",
      "--log-level=warning",
      "--minify",
      `--outfile=${temporaryBundle}`,
      "--external:pg",
      "--external:drizzle-orm",
      "--external:drizzle-orm/*",
      "--external:zod",
      ...aliases
    ],
    { cwd: worktree, stdio: "inherit" }
  );

  const lockfile = await readFile(join(worktree, "pnpm-lock.yaml"));
  const journal = JSON.parse(
    await readFile(
      join(worktree, "packages/db/drizzle/meta/_journal.json"),
      "utf8"
    )
  );
  const migrationContract = await migrationJournalContract(worktree, journal);
  const upgradeTargetJournal = JSON.parse(
    await readFile(
      join(repositoryRoot, "packages/db/drizzle/meta/_journal.json"),
      "utf8"
    )
  );
  const upgradeTargetContract = await migrationJournalContract(
    repositoryRoot,
    upgradeTargetJournal
  );
  const contract = {
    schemaId: "core:inbox-v2.db008-n1-runtime-bundle@v1",
    artifactKind: "n-1-compatibility-build",
    source: {
      revision: sourceRevision,
      tree: sourceTree
    },
    compatibility: {
      patches: [
        {
          id: compatibilityPatch.id,
          reason: compatibilityPatch.reason,
          path: compatibilityPatch.path,
          patchArtifact: await artifactContract(
            compatibilityPatch.artifactName
          ),
          baseSha256: compatibilityPatch.baseSha256,
          patchedSha256: compatibilityPatch.patchedSha256
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
      ],
      sourceModules: await sourceModuleContracts(worktree)
    },
    build: {
      esbuildVersion: execFileSync(
        process.execPath,
        [esbuildExecutable, "--version"],
        {
          cwd: repositoryRoot,
          encoding: "utf8"
        }
      ).trim(),
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
    lockfile: {
      path: "pnpm-lock.yaml",
      sha256: sha256(lockfile)
    },
    migrations: {
      folder: "packages/db/drizzle",
      count: migrationContract.length,
      first: migrationContract[0],
      last: migrationContract.at(-1),
      digest: digestMigrationContract(migrationContract)
    },
    upgradeTarget: {
      folder: "packages/db/drizzle",
      count: upgradeTargetContract.length,
      first: upgradeTargetContract[0],
      last: upgradeTargetContract.at(-1),
      digest: digestMigrationContract(upgradeTargetContract)
    },
    inputs: {
      entry: await artifactContract(entryName),
      webSessionStub: await artifactContract(sessionStubName),
      webConfigStub: await artifactContract(configStubName)
    },
    bundle: {
      path: `scripts/db/fixtures/inbox-v2/${bundleName}`,
      sha256: sha256(await readFile(temporaryBundle))
    }
  };

  await copyFile(temporaryBundle, join(fixtureDirectory, bundleName));
  await writeFile(
    join(fixtureDirectory, contractName),
    `${JSON.stringify(contract, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
} catch (error) {
  buildError = error;
} finally {
  if (worktreeAdded) {
    try {
      runGit(["worktree", "remove", "--force", worktree]);
    } catch (error) {
      cleanupErrors.push(error);
      await rm(worktree, { recursive: true, force: true }).catch(
        (cleanupError) => cleanupErrors.push(cleanupError)
      );
      try {
        runGit(["worktree", "prune"]);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
  }
  await rm(temporaryRoot, { recursive: true, force: true }).catch((error) =>
    cleanupErrors.push(error)
  );
}

if (buildError !== undefined && cleanupErrors.length > 0) {
  throw new AggregateError(
    [buildError, ...cleanupErrors],
    `DB-008 N-1 build and cleanup failed: ${[buildError, ...cleanupErrors].map(errorMessage).join("; ")}`
  );
}
if (buildError !== undefined) throw buildError;
if (cleanupErrors.length > 0) {
  throw new AggregateError(
    cleanupErrors,
    `DB-008 N-1 build cleanup failed: ${cleanupErrors.map(errorMessage).join("; ")}`
  );
}

async function workspaceAliases(root) {
  const packageRoot = join(root, "packages");
  const directories = await readdir(packageRoot, { withFileTypes: true });
  const aliases = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const packageJsonPath = join(packageRoot, directory.name, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const entry = manifest.exports?.["."];
    if (typeof manifest.name !== "string" || typeof entry !== "string") {
      continue;
    }
    aliases.push(
      `--alias:${manifest.name}=./packages/${directory.name}/${entry.replace(/^\.\//u, "")}`
    );
  }
  return aliases.sort();
}

async function applyCompatibilityPatch(root) {
  const targetPath = join(root, compatibilityPatch.path);
  const patchPath = join(fixtureDirectory, compatibilityPatch.artifactName);
  assertSha256(
    await readFile(targetPath),
    compatibilityPatch.baseSha256,
    `${compatibilityPatch.id} base`
  );
  execFileSync("git", ["apply", "--check", patchPath], {
    cwd: root,
    stdio: "inherit"
  });
  execFileSync("git", ["apply", patchPath], {
    cwd: root,
    stdio: "inherit"
  });
  assertSha256(
    await readFile(targetPath),
    compatibilityPatch.patchedSha256,
    `${compatibilityPatch.id} result`
  );
}

async function linkWorkspaceNodeModules(sourceRoot, targetRoot) {
  for (const workspaceGroup of ["apps", "packages", "company"]) {
    const sourceGroup = join(sourceRoot, workspaceGroup);
    let directories;
    try {
      directories = await readdir(sourceGroup, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const sourceNodeModules = join(
        sourceGroup,
        directory.name,
        "node_modules"
      );
      try {
        await access(sourceNodeModules);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      await symlink(
        sourceNodeModules,
        join(targetRoot, workspaceGroup, directory.name, "node_modules"),
        process.platform === "win32" ? "junction" : "dir"
      );
    }
  }
}

async function resolveEsbuildExecutable(root) {
  const executable = join(
    root,
    "node_modules/.pnpm",
    `esbuild@${esbuildVersion}`,
    "node_modules/esbuild/bin/esbuild"
  );
  const manifest = JSON.parse(
    await readFile(join(dirname(dirname(executable)), "package.json"), "utf8")
  );
  if (manifest.version !== esbuildVersion) {
    throw new Error(
      `Expected esbuild ${esbuildVersion}, found ${String(manifest.version)}.`
    );
  }
  return executable;
}

async function migrationJournalContract(root, journal) {
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error("N-1 migration journal is empty.");
  }
  return Promise.all(
    journal.entries.map(async (entry) => ({
      hash: sha256(
        await readFile(join(root, "packages/db/drizzle", `${entry.tag}.sql`))
      ).replace(/^sha256:/u, ""),
      createdAt: String(entry.when)
    }))
  );
}

async function sourceModuleContracts(root) {
  return Promise.all(
    runtimeSourcePaths.map(async (path) => ({
      path,
      sha256: sha256(await readFile(join(root, path)))
    }))
  );
}

function digestMigrationContract(contract) {
  return sha256(Buffer.from(JSON.stringify(contract), "utf8"));
}

async function artifactContract(name) {
  return {
    path: `scripts/db/fixtures/inbox-v2/${name}`,
    sha256: sha256(await readFile(join(fixtureDirectory, name)))
  };
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertSha256(value, expected, label) {
  const actual = sha256(value);
  if (actual !== expected) {
    throw new Error(
      `${label} SHA-256 mismatch: expected ${expected}, got ${actual}.`
    );
  }
}

function runGit(args) {
  execFileSync("git", args, { cwd: repositoryRoot, stdio: "inherit" });
}

function assertGitValue(root, expression, expected) {
  const actual = execFileSync("git", ["rev-parse", expression], {
    cwd: root,
    encoding: "utf8"
  }).trim();
  if (actual !== expected) {
    throw new Error(
      `Pinned N-1 ${expression} mismatch: expected ${expected}, got ${actual}.`
    );
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
