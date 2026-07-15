import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const require = createRequire(import.meta.url);
const statementBreakpoint = "--> statement-breakpoint";

export function splitMigrationStatements(sql) {
  return sql
    .replaceAll("\r\n", "\n")
    .split(statementBreakpoint)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function collectFinalizedMigrationDdlStatements({
  migrationSql,
  finalizedMarker,
  preflightMarker,
  invariantBlocks
}) {
  const statements = splitMigrationStatements(migrationSql);
  const firstStatement = statements.shift();
  if (
    !firstStatement?.includes(finalizedMarker) ||
    !firstStatement.includes(preflightMarker)
  ) {
    throw new Error(
      "Finalized Inbox V2 migration must start with its marker and preflight."
    );
  }
  if (
    countOccurrences(migrationSql, finalizedMarker) !== 1 ||
    countOccurrences(migrationSql, preflightMarker) !== 1
  ) {
    throw new Error(
      "Finalized Inbox V2 migration must contain its marker and preflight exactly once."
    );
  }

  const remainingCounts = statementCounts(statements);
  for (const invariantBlock of invariantBlocks) {
    const normalized = normalizeSql(invariantBlock.sql);
    const remaining = remainingCounts.get(normalized) ?? 0;
    if (remaining !== 1) {
      throw new Error(
        `Finalized Inbox V2 migration must contain invariant block ${invariantBlock.name} exactly once; found ${remaining}.`
      );
    }
    remainingCounts.delete(normalized);
  }

  return expandStatementCounts(remainingCounts);
}

export function assertParentUniqueConstraintsBeforeForeignKeys({
  migrationSql,
  constraintNames
}) {
  const firstForeignKeyMatch = migrationSql.match(
    /ADD\s+CONSTRAINT\s+"[^"]+"\s+FOREIGN\s+KEY\b/i
  );
  if (firstForeignKeyMatch?.index === undefined) {
    throw new Error(
      "Finalized Inbox V2 migration contains no foreign-key statements."
    );
  }

  for (const constraintName of constraintNames) {
    const constraintPattern = new RegExp(
      `(?:ADD\\s+)?CONSTRAINT\\s+"${escapeRegExp(constraintName)}"\\s+UNIQUE\\b`,
      "gi"
    );
    const matches = [...migrationSql.matchAll(constraintPattern)];
    if (matches.length !== 1) {
      throw new Error(
        `Parent unique constraint ${constraintName} must occur exactly once; found ${matches.length}.`
      );
    }
    if (matches[0].index > firstForeignKeyMatch.index) {
      throw new Error(
        `Parent unique constraint ${constraintName} must precede the first foreign key.`
      );
    }
  }
}

export function assertSqlStatementParity(expectedStatements, actualStatements) {
  const expected = statementCounts(expectedStatements);
  const actual = statementCounts(actualStatements);
  const missing = subtractStatementCounts(expected, actual);
  const unexpected = subtractStatementCounts(actual, expected);

  if (missing.length === 0 && unexpected.length === 0) {
    return;
  }

  throw new Error(
    [
      "Inbox V2 generated DDL is stale against the current Drizzle schema.",
      summarizeStatements("Missing", missing),
      summarizeStatements("Unexpected", unexpected)
    ]
      .filter(Boolean)
      .join("\n")
  );
}

export function assertDrizzleSnapshotParity(
  expectedSnapshot,
  actualSnapshot,
  snapshotPath = "Drizzle snapshot"
) {
  const expected = normalizeDrizzleSnapshot(expectedSnapshot);
  const actual = normalizeDrizzleSnapshot(actualSnapshot);
  if (isDeepStrictEqual(expected, actual)) {
    return;
  }

  const difference = findFirstDifference(expected, actual);
  throw new Error(
    `${snapshotPath} is stale against the current Drizzle schema${
      difference ? ` at ${difference}` : ""
    }.`
  );
}

export function assertAdditiveMigrationStatements(
  statements,
  label = "Migration"
) {
  const allowed = [
    /^CREATE TYPE\b/iu,
    /^CREATE TABLE\b/iu,
    /^CREATE (?:UNIQUE )?INDEX\b/iu,
    /^ALTER TABLE\b[\s\S]*\bADD CONSTRAINT\b/iu
  ];
  for (const statement of statements) {
    const normalized = statement.trim();
    if (!allowed.some((pattern) => pattern.test(normalized))) {
      throw new Error(
        `${label} must be additive-only; rejected generated statement: ${normalized
          .replace(/\s+/gu, " ")
          .slice(0, 180)}`
      );
    }
  }
}

export function normalizeDrizzleSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Drizzle snapshot must be a JSON object.");
  }

  const normalized = structuredClone(snapshot);
  // Drizzle creates a new random snapshot ID on every generation. prevId and
  // every schema-bearing field remain authoritative and must still match.
  delete normalized.id;
  return normalized;
}

export function migrationJournal(journal, baseIndex) {
  if (!journal || !Array.isArray(journal.entries)) {
    throw new Error("Drizzle journal must contain an entries array.");
  }
  const entries = journal.entries.filter((entry) => entry.idx <= baseIndex);
  if (entries.at(-1)?.idx !== baseIndex) {
    throw new Error(
      `Drizzle journal has no base migration index ${baseIndex}.`
    );
  }
  return { ...journal, entries };
}

export function assertMigrationJournalArtifactParity({
  journal,
  targetIndex,
  finalizedMigrationFileName,
  migrationFileNames,
  snapshotFileNames
}) {
  if (!journal || !Array.isArray(journal.entries)) {
    throw new Error("Drizzle journal must contain an entries array.");
  }
  const duplicateIndexes = journal.entries
    .map(({ idx }) => idx)
    .filter((idx, position, values) => values.indexOf(idx) !== position);
  if (duplicateIndexes.length > 0) {
    throw new Error(
      `Drizzle journal contains duplicate migration indexes: ${[
        ...new Set(duplicateIndexes)
      ].join(", ")}.`
    );
  }
  const targetEntries = journal.entries.filter(
    ({ idx }) => idx === targetIndex
  );
  if (targetEntries.length !== 1) {
    throw new Error(
      `Drizzle journal must own exactly one migration index ${targetIndex}; found ${targetEntries.length}.`
    );
  }
  const prefix = `${String(targetIndex).padStart(4, "0")}_`;
  const target = targetEntries[0];
  const expectedMigrationFileName = `${target.tag}.sql`;
  if (
    typeof target.tag !== "string" ||
    !target.tag.startsWith(prefix) ||
    finalizedMigrationFileName !== expectedMigrationFileName
  ) {
    throw new Error(
      `Finalized migration ${finalizedMigrationFileName} is not owned by Drizzle journal index ${targetIndex} (${String(target.tag)}).`
    );
  }
  const targetMigrations = migrationFileNames.filter(
    (fileName) => fileName.startsWith(prefix) && fileName.endsWith(".sql")
  );
  if (
    targetMigrations.length !== 1 ||
    targetMigrations[0] !== expectedMigrationFileName
  ) {
    throw new Error(
      `Migration index ${targetIndex} must have one journal-owned SQL artifact; found ${targetMigrations.join(", ") || "none"}.`
    );
  }
  const expectedSnapshotFileName = `${String(targetIndex).padStart(
    4,
    "0"
  )}_snapshot.json`;
  const targetSnapshots = snapshotFileNames.filter((fileName) =>
    fileName.startsWith(String(targetIndex).padStart(4, "0"))
  );
  if (
    targetSnapshots.length !== 1 ||
    targetSnapshots[0] !== expectedSnapshotFileName
  ) {
    throw new Error(
      `Migration index ${targetIndex} must have the exact snapshot ${expectedSnapshotFileName}; found ${targetSnapshots.join(", ") || "none"}.`
    );
  }
}

export async function generateExpectedDrizzleMigration({
  workspaceRoot,
  migrationDirectory,
  baseIndex,
  targetIndex,
  schemaPaths
}) {
  const root = resolve(workspaceRoot);
  const migrations = resolve(root, migrationDirectory);
  const metadataDirectory = join(migrations, "meta");
  const baseSnapshotPath = join(
    metadataDirectory,
    `${String(baseIndex).padStart(4, "0")}_snapshot.json`
  );
  const journalPath = join(metadataDirectory, "_journal.json");
  const [journal, baseSnapshot] = await Promise.all([
    readJson(journalPath),
    readFile(baseSnapshotPath, "utf8")
  ]);

  const temporaryParent = join(root, "node_modules", ".cache");
  await mkdir(temporaryParent, { recursive: true });
  const temporaryRoot = await mkdtemp(join(temporaryParent, "hulee-db-check-"));
  const outputDirectory = join(temporaryRoot, "drizzle");
  const outputMetadataDirectory = join(outputDirectory, "meta");
  const configPath = join(temporaryRoot, "drizzle.config.mjs");

  try {
    await mkdir(outputMetadataDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        join(outputMetadataDirectory, "_journal.json"),
        `${JSON.stringify(migrationJournal(journal, baseIndex), null, 2)}\n`,
        "utf8"
      ),
      writeFile(
        join(
          outputMetadataDirectory,
          `${String(baseIndex).padStart(4, "0")}_snapshot.json`
        ),
        baseSnapshot,
        "utf8"
      ),
      writeFile(
        configPath,
        drizzleConfigSource({ root, outputDirectory, schemaPaths }),
        "utf8"
      )
    ]);

    const generationOutput = runDrizzleGenerate({ root, configPath });

    const targetPrefix = `${String(targetIndex).padStart(4, "0")}_`;
    const outputFiles = await readdir(outputDirectory);
    const generatedSqlFiles = outputFiles.filter(
      (fileName) =>
        fileName.startsWith(targetPrefix) && fileName.endsWith(".sql")
    );
    if (generatedSqlFiles.length !== 1) {
      throw new Error(
        `Expected one generated ${targetPrefix} migration, found ${generatedSqlFiles.length}; output contained: ${outputFiles.join(", ")}.\n${generationOutput}`
      );
    }

    const [sql, snapshot] = await Promise.all([
      readFile(join(outputDirectory, generatedSqlFiles[0]), "utf8"),
      readJson(
        join(
          outputMetadataDirectory,
          `${String(targetIndex).padStart(4, "0")}_snapshot.json`
        )
      )
    ]);
    return {
      statements: splitMigrationStatements(sql),
      snapshot
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

// Compatibility aliases for callers that have not migrated to the generic
// helper names yet. They retain exactly the same strict behavior.
export const collectFinalizedFoundationDdlStatements = (input) =>
  collectFinalizedMigrationDdlStatements({
    ...input,
    finalizedMarker: input.finalizedMarker ?? input.foundationMarker
  });
export const foundationJournal = migrationJournal;
export const generateExpectedDrizzleFoundation =
  generateExpectedDrizzleMigration;

function drizzleConfigSource({ root, outputDirectory, schemaPaths }) {
  const schema = (
    schemaPaths ?? [
      join(root, "packages/db/src/schema/tables.ts"),
      join(root, "packages/db/src/schema/inbox-v2/*.ts")
    ]
  ).map((path) => toPortablePath(resolve(root, path)));

  return `export default ${JSON.stringify(
    {
      dialect: "postgresql",
      schema,
      out: toPortablePath(relative(root, outputDirectory)),
      strict: true,
      verbose: false
    },
    null,
    2
  )};\n`;
}

function runDrizzleGenerate({ root, configPath }) {
  const drizzleKitEntry = require.resolve("drizzle-kit");
  const drizzleKitCli = join(dirname(drizzleKitEntry), "bin.cjs");
  const result = spawnSync(
    process.execPath,
    [
      drizzleKitCli,
      "generate",
      "--config",
      configPath,
      "--name",
      "inbox_v2_schema_parity"
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1"
      },
      maxBuffer: 16 * 1024 * 1024
    }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Drizzle schema parity generation failed (${result.status}).\n${[
        result.stdout,
        result.stderr
      ]
        .filter(Boolean)
        .join("\n")}`
    );
  }
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

function statementCounts(statements) {
  const counts = new Map();
  for (const statement of statements) {
    const normalized = normalizeSql(statement);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

function expandStatementCounts(counts) {
  return [...counts.entries()].flatMap(([statement, count]) =>
    Array.from({ length: count }, () => statement)
  );
}

function subtractStatementCounts(left, right) {
  const difference = [];
  for (const [statement, count] of left) {
    const missingCount = count - (right.get(statement) ?? 0);
    for (let index = 0; index < missingCount; index += 1) {
      difference.push(statement);
    }
  }
  return difference;
}

function summarizeStatements(label, statements) {
  if (statements.length === 0) return "";
  const examples = statements
    .slice(0, 3)
    .map((statement) => statement.split("\n", 1)[0].slice(0, 240));
  const suffix = statements.length > examples.length ? " ..." : "";
  return `${label} (${statements.length}): ${examples.join(" | ")}${suffix}`;
}

function normalizeSql(sql) {
  return sql.replaceAll("\r\n", "\n").trim();
}

function countOccurrences(value, fragment) {
  if (fragment.length === 0) return 0;
  return value.split(fragment).length - 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFirstDifference(expected, actual, path = "$") {
  if (Object.is(expected, actual)) return null;
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return path;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return path;
    if (expected.length !== actual.length) return `${path}.length`;
    for (let index = 0; index < expected.length; index += 1) {
      const difference = findFirstDifference(
        expected[index],
        actual[index],
        `${path}[${index}]`
      );
      if (difference) return difference;
    }
    return null;
  }

  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (!isDeepStrictEqual(expectedKeys, actualKeys)) return `${path}.[keys]`;
  for (const key of expectedKeys) {
    const difference = findFirstDifference(
      expected[key],
      actual[key],
      `${path}.${key}`
    );
    if (difference) return difference;
  }
  return null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function toPortablePath(path) {
  return path.replaceAll("\\", "/");
}
