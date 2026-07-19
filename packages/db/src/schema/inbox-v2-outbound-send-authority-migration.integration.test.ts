import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import pg from "pg";
import { describe, expect, it } from "vitest";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const migrationPath = resolve(
  "packages/db/drizzle/0050_inbox_v2_outbound_send_authority.sql"
);
const providerClosureMigrationPath = resolve(
  "packages/db/drizzle/0046_inbox_v2_atomic_provider_io_closure.sql"
);
const timelineFoundationMigrationPath = resolve(
  "packages/db/drizzle/0031_inbox_v2_timeline_message_foundation.sql"
);
const legacyPermission = "core:message.send_external";
const canonicalPermission = "core:message.reply_external";
const rerouteCommandType = "core:source.dispatch.reroute";

type GuardedFunction = Readonly<{
  guardSlug: string;
  name: string;
  signature: string;
  successorMd5Constant: string;
}>;

const guardedFunctions: readonly GuardedFunction[] = [
  {
    guardSlug: "core_coherence",
    name: "inbox_v2_tm_core_coherence",
    signature: "public.inbox_v2_tm_core_coherence()",
    successorMd5Constant: "core_successor_md5"
  },
  {
    guardSlug: "route_action",
    name: "inbox_v2_tm_outbound_route_action_valid",
    signature:
      "public.inbox_v2_tm_outbound_route_action_valid(text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,bigint,text,text,bigint,text,text,timestamptz,text,bigint,text,boolean)",
    successorMd5Constant: "route_action_successor_md5"
  },
  {
    guardSlug: "domain_mutation",
    name: "inbox_v2_auth_domain_mutation_coherence",
    signature: "public.inbox_v2_auth_domain_mutation_coherence()",
    successorMd5Constant: "domain_mutation_successor_md5"
  },
  {
    guardSlug: "atomic_message",
    name: "inbox_v2_atomic_message_creation_coherence",
    signature: "public.inbox_v2_atomic_message_creation_coherence()",
    successorMd5Constant: "atomic_message_successor_md5"
  },
  {
    guardSlug: "atomic_outbound",
    name: "inbox_v2_atomic_outbound_creation_coherence",
    signature: "public.inbox_v2_atomic_outbound_creation_coherence()",
    successorMd5Constant: "atomic_outbound_successor_md5"
  }
];

describePostgres(
  "Inbox V2 MSG-002 outbound-send authority migration guard",
  () => {
    it("keeps every reviewed successor idempotent and rejects body drift fail-closed", async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the MSG-002 migration guard test."
        );
      }

      const migrationSql = await readFile(migrationPath, "utf8");
      const providerClosureMigrationSql = await readFile(
        providerClosureMigrationPath,
        "utf8"
      );
      const timelineFoundationMigrationSql = await readFile(
        timelineFoundationMigrationPath,
        "utf8"
      );
      const reviewedSuccessorMd5 = new Map(
        guardedFunctions.map((guardedFunction) => [
          guardedFunction.name,
          extractMigrationConstant(
            migrationSql,
            guardedFunction.successorMd5Constant
          )
        ])
      );
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();

      try {
        const currentInstalled = await readGuardedFunctions(client);
        expectCurrentReviewedOverrides(currentInstalled, reviewedSuccessorMd5);
        const staleMigrationError = await captureDatabaseError(
          client.query(migrationSql)
        );
        expect(staleMigrationError).toMatchObject({
          code: "55000",
          message: "inbox_v2.msg002_core_coherence_unreviewed_shape"
        });
        expect(functionSources(await readGuardedFunctions(client))).toEqual(
          functionSources(currentInstalled)
        );

        await client.query("begin");
        try {
          await client.query(
            extractFunctionDefinition(
              timelineFoundationMigrationSql,
              "public.inbox_v2_tm_core_coherence"
            )
          );
          await client.query(
            extractFunctionDefinition(
              timelineFoundationMigrationSql,
              "public.inbox_v2_tm_outbound_route_action_valid"
            )
          );
          await client.query(
            extractFunctionDefinition(
              providerClosureMigrationSql,
              "public.inbox_v2_auth_domain_mutation_coherence"
            )
          );
          await client.query(migrationSql);
          const installed = await readGuardedFunctions(client);
          expectReviewedSuccessorShapes(installed, reviewedSuccessorMd5);

          await client.query(migrationSql);
          const afterFirstRerun = await readGuardedFunctions(client);
          expect(functionSources(afterFirstRerun)).toEqual(
            functionSources(installed)
          );

          for (const guardedFunction of guardedFunctions) {
            await client.query("savepoint msg002_guard_drift");
            try {
              const baseline = requiredFunction(
                installed,
                guardedFunction.name
              );
              await client.query(
                addBodyDriftComment(
                  baseline.definition,
                  guardedFunction.guardSlug
                )
              );

              const tampered = await readGuardedFunction(
                client,
                guardedFunction
              );
              expect(md5(tampered.source)).not.toBe(
                reviewedSuccessorMd5.get(guardedFunction.name)
              );

              const migrationError = await captureDatabaseError(
                client.query(migrationSql)
              );
              expect(migrationError).toMatchObject({
                code: "55000",
                message: `inbox_v2.msg002_${guardedFunction.guardSlug}_unreviewed_shape`
              });
            } finally {
              await client.query("rollback to savepoint msg002_guard_drift");
              await client.query("release savepoint msg002_guard_drift");
            }

            const restored = await readGuardedFunctions(client);
            expect(functionSources(restored)).toEqual(
              functionSources(installed)
            );
          }

          await client.query(migrationSql);
          const afterFinalRerun = await readGuardedFunctions(client);
          expect(functionSources(afterFinalRerun)).toEqual(
            functionSources(installed)
          );
          expectReviewedSuccessorShapes(afterFinalRerun, reviewedSuccessorMd5);
        } finally {
          await client.query("rollback");
        }
        expect(functionSources(await readGuardedFunctions(client))).toEqual(
          functionSources(currentInstalled)
        );
      } finally {
        await client.end();
      }
    });
  }
);

type InstalledFunction = Readonly<{
  definition: string;
  source: string;
}>;

async function readGuardedFunctions(
  client: pg.Client
): Promise<ReadonlyMap<string, InstalledFunction>> {
  const installed = new Map<string, InstalledFunction>();
  for (const guardedFunction of guardedFunctions) {
    installed.set(
      guardedFunction.name,
      await readGuardedFunction(client, guardedFunction)
    );
  }
  return installed;
}

async function readGuardedFunction(
  client: pg.Client,
  guardedFunction: GuardedFunction
): Promise<InstalledFunction> {
  const result = await client.query<{
    definition: string | null;
    source: string | null;
  }>(
    `select pg_get_functiondef($1::regprocedure) as definition,
            replace(function_row.prosrc, E'\\r\\n', E'\\n') as source
       from pg_catalog.pg_proc function_row
      where function_row.oid = $1::regprocedure`,
    [guardedFunction.signature]
  );
  const row = result.rows[0];
  if (!row?.definition || !row.source) {
    throw new Error(`Missing installed function ${guardedFunction.signature}.`);
  }
  return { definition: row.definition, source: row.source };
}

function expectReviewedSuccessorShapes(
  installed: ReadonlyMap<string, InstalledFunction>,
  reviewedSuccessorMd5: ReadonlyMap<string, string>
): void {
  for (const guardedFunction of guardedFunctions) {
    const installedFunction = requiredFunction(installed, guardedFunction.name);
    expect(md5(installedFunction.source)).toBe(
      reviewedSuccessorMd5.get(guardedFunction.name)
    );
  }

  const coreCoherence = requiredFunction(
    installed,
    "inbox_v2_tm_core_coherence"
  ).source;
  expect(countOccurrences(coreCoherence, legacyPermission)).toBe(0);
  expect(countOccurrences(coreCoherence, canonicalPermission)).toBe(2);

  const routeAction = requiredFunction(
    installed,
    "inbox_v2_tm_outbound_route_action_valid"
  ).source;
  expect(routeAction).toContain("binding_snapshot.runtime_health_state");
  expect(routeAction).toContain(
    "route_row.runtime_observation_snapshot #>> '{state}'"
  );
  expect(routeAction).not.toContain(
    "binding_snapshot.runtime_health_state = 'ready'"
  );
  expect(routeAction).not.toContain(
    "route_row.runtime_observation_snapshot #>> '{state}' = 'ready'"
  );

  for (const functionName of [
    "inbox_v2_auth_domain_mutation_coherence",
    "inbox_v2_atomic_message_creation_coherence",
    "inbox_v2_atomic_outbound_creation_coherence"
  ]) {
    expect(requiredFunction(installed, functionName).source).toContain(
      rerouteCommandType
    );
  }

  const domainMutation = requiredFunction(
    installed,
    "inbox_v2_auth_domain_mutation_coherence"
  ).source;
  for (const fragment of [
    "dispatch_change.resulting_revision = 2",
    "dispatch_row.state = 'cancelled'",
    "dispatch_change.state_reason_id is null",
    "core:inbox-v2.outbound-dispatch-reroute-commit",
    "dispatch_change.domain_commit_reference =",
    "v_audit.evidence_reference"
  ]) {
    expect(domainMutation).toContain(fragment);
  }

  const atomicOutbound = requiredFunction(
    installed,
    "inbox_v2_atomic_outbound_creation_coherence"
  ).source;
  for (const fragment of [
    "'{originalDispatch,id}'",
    "'expectedOriginalDispatchRevision' = '1'",
    "original_dispatch.state = 'cancelled'",
    "original_dispatch.revision = 2",
    "original_change.state_reason_id is null",
    "original_event.type_id =",
    "'core:outbound-dispatch.changed'",
    "projection_intent.effect_class = 'projection'",
    "original_work.state in ('pending', 'leased')",
    "forbidden_provider_intent.effect_class = 'provider_io'",
    "reroute_audit.target_type_id =",
    "reroute_audit.evidence_reference =",
    "sibling_dispatch_change.entity_type_id ="
  ]) {
    expect(atomicOutbound).toContain(fragment);
  }
}

function expectCurrentReviewedOverrides(
  installed: ReadonlyMap<string, InstalledFunction>,
  reviewedSuccessorMd5: ReadonlyMap<string, string>
): void {
  for (const guardedFunction of guardedFunctions) {
    const installedFunction = requiredFunction(installed, guardedFunction.name);
    const reviewedMd5 = reviewedSuccessorMd5.get(guardedFunction.name);
    if (guardedFunction.name === "inbox_v2_tm_core_coherence") {
      expect(md5(installedFunction.source)).not.toBe(reviewedMd5);
      for (const fragment of [
        "inbox_v2_tm_assert_reference_context",
        "inbox_v2.message_creation_dispatch_mismatch",
        "inbox_v2.message_dispatch_coherence"
      ]) {
        expect(installedFunction.source).toContain(fragment);
      }
    } else if (
      guardedFunction.name === "inbox_v2_tm_outbound_route_action_valid"
    ) {
      expect(md5(installedFunction.source)).not.toBe(reviewedMd5);
      for (const fragment of [
        "expected_reference_owner_message_id",
        "reference_portability_kind",
        "binding_only"
      ]) {
        expect(installedFunction.source).toContain(fragment);
      }
    } else if (
      guardedFunction.name === "inbox_v2_auth_domain_mutation_coherence"
    ) {
      expect(md5(installedFunction.source)).not.toBe(reviewedMd5);
      for (const fragment of [
        "core:attachment.materialization.complete",
        "inbox_v2_auth_attachment_message_change_valid",
        "inbox_v2.domain_mutation_attachment_cardinality_invalid"
      ]) {
        expect(installedFunction.source).toContain(fragment);
      }
    } else {
      expect(md5(installedFunction.source)).toBe(reviewedMd5);
    }
  }
}

function functionSources(
  installed: ReadonlyMap<string, InstalledFunction>
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...installed].map(([name, installedFunction]) => [
      name,
      installedFunction.source
    ])
  );
}

function requiredFunction(
  installed: ReadonlyMap<string, InstalledFunction>,
  name: string
): InstalledFunction {
  const installedFunction = installed.get(name);
  if (!installedFunction) {
    throw new Error(`Missing installed function ${name}.`);
  }
  return installedFunction;
}

function addBodyDriftComment(definition: string, guardSlug: string): string {
  const delimiter = "$function$";
  const delimiterIndex = definition.indexOf(delimiter);
  if (delimiterIndex < 0) {
    throw new Error("Cannot find the guarded function body delimiter.");
  }
  return `${definition.slice(0, delimiterIndex + delimiter.length)}\n-- MSG-002 adversarial ${guardSlug} body drift${definition.slice(delimiterIndex + delimiter.length)}`;
}

function extractMigrationConstant(sql: string, name: string): string {
  const match = sql.match(
    new RegExp(`${name}\\s+constant\\s+text\\s*:=\\s*'([a-f0-9]{32})'`, "u")
  );
  if (!match?.[1]) {
    throw new Error(`Missing ${name} in the MSG-002 migration.`);
  }
  return match[1];
}

function extractFunctionDefinition(sql: string, functionName: string): string {
  const normalized = sql.replaceAll("\r\n", "\n");
  const start = normalized.indexOf(
    `create or replace function ${functionName}`
  );
  const delimiter = "$function$";
  const bodyStart = normalized.indexOf(`as ${delimiter}`, start);
  const bodyEnd = normalized.indexOf(
    `${delimiter};`,
    bodyStart + `as ${delimiter}`.length
  );
  if (start < 0 || bodyStart < 0 || bodyEnd < 0) {
    throw new Error(`Cannot extract ${functionName} from migration 0046.`);
  }
  return normalized.slice(start, bodyEnd + `${delimiter};`.length);
}

function countOccurrences(value: string, fragment: string): number {
  return value.split(fragment).length - 1;
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

async function captureDatabaseError(
  promise: Promise<unknown>
): Promise<Readonly<{ code?: string; message?: string }>> {
  try {
    await promise;
  } catch (error) {
    if (error && typeof error === "object") {
      return error as Readonly<{ code?: string; message?: string }>;
    }
    throw error;
  }
  throw new Error("Expected the MSG-002 migration guard to reject body drift.");
}
