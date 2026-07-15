import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const migrationsDirectory = resolve("packages/db/drizzle");
const finalizedMarker =
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_MIGRATION_FINALIZED_V1";
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const startedAt = "2026-07-15T00:00:00.000Z";
const completedAt = "2026-07-15T00:01:00.000Z";
const expiresAt = "2026-07-16T00:00:00.000Z";

describePostgres("Inbox V2 DB-009 PostgreSQL invariants", () => {
  let adminClient;
  let client;
  let databaseName;
  let databaseUrl;

  beforeAll(async () => {
    const adminDatabaseUrl = process.env.DATABASE_URL;
    if (!adminDatabaseUrl) {
      throw new Error(
        "DATABASE_URL is required for the DB-009 invariant integration test."
      );
    }
    const journal = JSON.parse(
      await readFile(resolve("packages/db/drizzle/meta/_journal.json"), "utf8")
    );
    const targetEntry = journal.entries.find(({ idx }) => idx === 33);
    if (!targetEntry) {
      throw new Error("Finalized DB-009 migration index 0033 is missing.");
    }
    const migrationSql = await readFile(
      resolve(`packages/db/drizzle/${targetEntry.tag}.sql`),
      "utf8"
    );
    expect(migrationSql).toContain(finalizedMarker);

    const baseUrl = new URL(adminDatabaseUrl);
    databaseName = `hulee_db009_invariants_${process.pid}`;
    adminClient = new pg.Client({ connectionString: adminDatabaseUrl });
    await adminClient.connect();
    await adminClient.query(
      `create database ${quoteDatabaseName(databaseName)}`
    );
    baseUrl.pathname = `/${databaseName}`;
    databaseUrl = baseUrl.toString();
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    try {
      await migrate(drizzle(pool), { migrationsFolder: migrationsDirectory });
    } finally {
      await pool.end();
    }
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  }, 120_000);

  afterAll(async () => {
    await client?.end().catch(() => {});
    if (adminClient && databaseName) {
      await adminClient
        .query(
          `select pg_terminate_backend(pid)
               from pg_catalog.pg_stat_activity
              where datname = $1 and pid <> pg_backend_pid()`,
          [databaseName]
        )
        .catch(() => {});
      await adminClient
        .query(`drop database if exists ${quoteDatabaseName(databaseName)}`)
        .catch(() => {});
    }
    await adminClient?.end().catch(() => {});
  });

  beforeEach(async () => {
    await client.query("begin");
  });

  afterEach(async () => {
    await client.query("rollback").catch(() => {});
  });

  it("rejects an operated root disguised as an external checkpoint", async () => {
    await expectConstraintViolation(
      client,
      {
        text: `
            insert into public.inbox_v2_data_governance_deletion_checkpoint_requirements (
              tenant_id, plan_id, plan_revision, checkpoint_id,
              requirement_hash, surface, registry_id, registry_revision,
              storage_root_id, data_class_id, root_kind, boundary, copy_role,
              root_record_id, entity_type_id, entity_id,
              expected_entity_revision, expected_lineage_revision,
              delete_handler_id, verification_handler_id,
              expiry_ledger_handler_id, external_delete_handler_id,
              canonical_snapshot
            ) values (
              'tenant:missing', 'plan:missing', 1, 'checkpoint:external',
              $1, 'external', 'registry:missing', 1,
              'root:internal', 'class:message', 'sql',
              'operated_data_plane', 'primary',
              'record:1', 'entity:message', 'message:1', 1, 1,
              null, null, null, 'handler:external', '{}'::jsonb
            )
          `,
        values: [digestA]
      },
      "23514",
      "inbox_v2_dg_checkpoint_requirement_surface_check"
    );
  });

  it("rejects backup-expiry pending without verified primary absence", async () => {
    await expectConstraintViolation(
      client,
      {
        text: `
            insert into public.inbox_v2_data_governance_backup_checkpoint_attempts (
              tenant_id, run_id, run_revision, plan_id, plan_revision,
              checkpoint_id, requirement_hash, attempt,
              registry_id, registry_revision, storage_root_id, data_class_id,
              root_record_id, entity_type_id, entity_id,
              verification_handler_id, expiry_ledger_handler_id,
              expected_entity_revision, expected_lineage_revision,
              legal_hold_set_revision, restriction_set_revision,
              outcome, primary_absence_verified, latest_possible_expiry_at,
              expiry_verified_at, evidence_hash, execution_fence_hash,
              lease_expires_at, started_at, completed_at, canonical_snapshot
            ) values (
              'tenant:missing', 'run:missing', 1, 'plan:missing', 1,
              'checkpoint:backup', $1, 1,
              'registry:missing', 1, 'root:backup', 'class:message',
              'record:1', 'entity:message', 'message:1',
              'handler:verify', 'handler:expiry', 1, 1, 0, 0,
              'finite_expiry_pending', false, $2, null, $3, $4,
              $5, $6, $7, '{}'::jsonb
            )
          `,
        values: [
          digestA,
          expiresAt,
          digestB,
          digestA,
          expiresAt,
          startedAt,
          completedAt
        ]
      },
      "23514",
      "inbox_v2_dg_backup_attempt_pending_check"
    );
  });

  it("rejects a premature completed deletion run at the initial transition guard", async () => {
    await expectConstraintViolation(
      client,
      {
        text: `
            insert into public.inbox_v2_data_governance_deletion_runs (
              tenant_id, run_id, revision, state_revision,
              plan_id, plan_revision,
              state, result, stage_one_state, stage_one_committed_at,
              primary_absence_verified, has_internal_residual,
              has_external_residual, has_backup_expiry_pending,
              backup_latest_possible_expiry_at, operated_checkpoint_count,
              backup_checkpoint_count, external_checkpoint_count,
              completed_checkpoint_count, started_at, completed_at,
              updated_at, state_hash
            ) values (
              'tenant:missing', 'run:premature', 1, 1,
              'plan:missing', 1,
              'terminal', 'completed', 'content_unavailable', $1,
              false, false, false, false, null, 1, 0, 0, 1,
              $2, $3, $3, $4
            )
          `,
        values: [completedAt, startedAt, completedAt, digestA]
      },
      "23514",
      undefined,
      "Deletion run must start at the exact frozen checkpoint set"
    );
  });
});

async function expectConstraintViolation(
  client,
  query,
  expectedCode,
  expectedConstraint,
  expectedMessage
) {
  let databaseError;
  try {
    await client.query(query);
  } catch (error) {
    databaseError = error;
  }
  expect(databaseError).toMatchObject({ code: expectedCode });
  if (expectedConstraint !== undefined) {
    expect(databaseError).toMatchObject({ constraint: expectedConstraint });
  }
  if (expectedMessage !== undefined) {
    expect(databaseError).toMatchObject({ message: expectedMessage });
  }
}

function quoteDatabaseName(value) {
  if (!/^hulee_db009_invariants_[0-9]+$/u.test(value)) {
    throw new Error(`Unsafe DB-009 invariant database name: ${value}`);
  }
  return `"${value}"`;
}
