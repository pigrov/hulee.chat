# Inbox V2 Clean Install And Guarded Reset

Status: `disposable fixture implementation verified; preserve upgrade lane required`

Owner task: `INB2-DB-008`

Last verified: `2026-07-16`

## Scope And Current Gate

This runbook implements the DB-008 portion that is independent of deployment
disposition:

- explicit-URL, advisory-locked migration execution;
- exact full migration-journal prefix verification by timestamp and SQL hash;
- empty/current database installation and current-schema audit;
- an explicit idempotent V2 tenant stream/projection bootstrap;
- a destructive reset path guarded by a durable disposition manifest, its exact
  digest, bounded expiry, separately hashed MIG-001 disposition/object-storage
  receipts and the live PostgreSQL target;
- a target-connection fence plus one atomic schema/migration/bootstrap transaction;
- an immutable, reset-surviving reset-generation ledger and exact-retry
  `reset_noop`;
- stream-epoch rotation after every successful reset.

`INB2-MIG-001` completed on `2026-07-16` and selected `preserve`. Therefore the
reset implementation may still be exercised only against synthetic disposable
databases, the current development and known shared SaaS databases must not be
reset, and DB-008 cannot yet be marked `done`. No usable local disposable
manifest is committed to the repository.

A representative V1 snapshot/additive-schema upgrade harness, RBAC dry-run,
migrate-before-restart N-1 API/web/worker smoke and rollback harness are now
mandatory. Runtime dual materialization belongs to `INB2-MIG-002`, and data
backfill belongs to `INB2-MIG-003`; neither is implemented by DB-008. The four
harness/evidence items above are the remaining DB-008 preserve lane.

## Non-Destructive Install

`pnpm db:migrate` now calls `scripts/db/run-migrations.mjs`. The runner:

1. refuses a missing `DATABASE_URL`;
2. obtains one fail-fast advisory lock;
3. reads every checked-in SQL file through the Drizzle journal and computes its
   SHA-256;
4. requires the applied rows to be the exact ordered prefix of that contract;
5. refuses a public schema containing managed objects when no migration journal
   exists;
6. runs pending migrations;
7. requires the complete current journal and the exact checked-in bodies,
   bindings, modes and safety-critical structural definitions of Inbox V2
   relations, functions, triggers, constraints, indexes and security roles;
8. refuses non-empty default-privilege state, PUBLIC schema creation and any
   PUBLIC privilege on a managed relation, sequence or column before it can
   affect a migration.

It is safe to rerun on an exact current database and never invokes reset.
Partial or forged-current journals fail closed; they may be replaced only by a
separately reviewed disposable reset.

`pnpm db:inbox-v2:install -- --bootstrap <file>` additionally applies
`core:inbox-v2.repository-bootstrap@v2`. The document contains one explicit
tenant prerequisite and one or more projection identities. Bootstrap inserts
missing state with database time and a random stream epoch, then reads every
row back and requires exact initial values. Existing mismatched state is an
error rather than an overwrite. Re-running the same bootstrap keeps one tenant
stream head, generation, checkpoint and reader head with unchanged epoch and
revision.

The old `db:seed:mvp` remains a V1 compatibility seed and is not called by this
workflow.

## Destructive Authorization Contract

`pnpm db:inbox-v2:reset` requires all five independent inputs:

- `--manifest <file>`: `core:inbox-v2.database-disposition-manifest@v2`;
- `--confirm sha256:<digest>`: SHA-256 of the exact selected manifest bytes;
- `--mig-001-evidence <file>`:
  `core:inbox-v2.mig-001-disposition-evidence@v2`, bound to the same manifest,
  reset generation, PostgreSQL target and canonical reviewed disposition;
- `--object-receipt <file>`:
  `core:inbox-v2.object-storage-reset-receipt@v2` whose exact digest and fields
  match the manifest;
- `--bootstrap <file>`: explicit post-reset stream/projection bootstrap.

The manifest records:

- migration contract version, manifest/deployment identity and deployment kind;
- `disposable` classification, approver, UTC approval/expiry timestamps and
  reason;
- PostgreSQL cluster system identifier, exact database name/owner, observed
  migration-journal digest and target migration-bundle digest;
- `INB2-MIG-001` evidence ID/digest, `eligible` decision and every required
  no-consumer/no-data/no-hold/no-side-effect/no-unknown condition as `true`;
- a digest of every row's canonical JSON content and row count for managed
  public/drizzle relations, sequence state/options, schema/catalog definitions,
  object ACLs, Inbox V2 role attributes/memberships and live semantic provider/
  outbox/lease state, plus explicit tenant and V1 business-row totals and the
  published-cursor fact;
- object-storage status/scope/checkpoint/receipt and verification time;
- explicit reset generation, exact bootstrap digest, reset authorization and
  required stream-epoch rotation.

Only `personal_local` and `ephemeral_ci` may enter the destructive path.
`empty`, `preserve`, shared development, shared/isolated SaaS, on-prem and
unknown deployments are rejected even if an environment variable or database
name suggests development. `postgres` and template databases are always
protected.

New destructive authority is deliberately short-lived. MIG-001, database inventory and
object-storage evidence must all be no later than approval and no more than one
hour older than it. Approval may not be more than five minutes in the future;
`expiresAt` must be after approval, no more than 24 hours later, and still in
the future when reset begins. Expired, stale, reversed or future-dated evidence
requires a newly reviewed manifest and newly bound receipts.

Expiry does not make a completed generation destructive again. When the exact
generation already has a receipt, the command may proceed only to the fenced
full receipt/journal/schema/inventory/epoch comparison and return `reset_noop`.
Any mismatch is rejected; no expired manifest can authorize schema replacement.

Before the first destructive statement, the command also requires:

- a live target fingerprint equal to the manifest;
- the connection user to be the exact database owner;
- an independently verified control connection to the same PostgreSQL cluster;
- `ALLOW_CONNECTIONS=false` on the target before the final live recheck;
- no other database session (the command never terminates one);
- no prepared transaction and a bounded DDL lock wait;
- only the managed `public` and `drizzle` schemas in addition to exact PostgreSQL
  system/temp schemas (a user-created `pg_*` schema is not ignored);
- no PostgreSQL large object, custom extension, event trigger, foreign server,
  publication or subscription that would survive schema replacement;
- no default ACL entry, no PUBLIC `CREATE` on managed schemas and no PUBLIC
  privilege on a managed table, column or sequence;
- an exact reviewed migration-journal digest;
- an exact reviewed content/catalog and semantic provider/outbox/lease inventory;
- the exact in-memory migration contract and bootstrap byte digests;
- a matching separate completed MIG-001 evidence receipt;
- a matching separate object-storage receipt.

The object-storage receipt is a barrier, not a hidden delete implementation.
When storage is absent it records `not_configured` with scope `none`; when data
was present, an external/local operator must first produce a reviewed
`reset_completed` receipt for the exact bucket/prefix/checkpoint. PostgreSQL is
not reset before that receipt matches.

After all guards pass, one PostgreSQL transaction replaces only `public` and
`drizzle`, applies the already-hashed in-memory migration contract, audits
critical relations/functions/triggers/constraints, applies the explicit
bootstrap, proves that any prior tenant stream epoch was rotated, restores the
complete historical reset ledger and appends an immutable
`inbox_v2_database_reset_receipts` row. Row changes, deletes and table truncation
are blocked. Any failure, including one after `DROP SCHEMA`, rolls the entire
operation back. Cluster roles and sibling databases are not dropped.

The command releases `ALLOW_CONNECTIONS` in `finally`, verifies the resulting
catalog state and retries recovery through a fresh control connection if the
first control connection is lost. A process kill or host crash cannot run
`finally`. In that case, do not retry reset until an operator connects to the
`postgres` control database on the exact reviewed cluster, verifies the system
identifier and database name, and runs:

```powershell
psql "$env:CONTROL_DATABASE_URL" -v ON_ERROR_STOP=1 -c `
  'ALTER DATABASE "<exact-reviewed-database-name>" WITH ALLOW_CONNECTIONS true;'
psql "$env:CONTROL_DATABASE_URL" -v ON_ERROR_STOP=1 -c `
  "SELECT datname, datallowconn FROM pg_catalog.pg_database WHERE datname = '<exact-reviewed-database-name>';"
```

The second query must return exactly the reviewed database with
`datallowconn = true`. The operator must also compare
`(pg_catalog.pg_control_system()).system_identifier` with the manifest before
the `ALTER DATABASE` command.

An exact retry finds that database-wide generation receipt and verifies the
current journal, critical schema, inventory, stream epoch and every authority digest. It returns
`reset_noop` without destructive DDL. A reused generation with any drift,
including a different bootstrap tenant, is rejected.

## Verification

The opt-in lifecycle suite creates only strictly named `hulee_db008_*` child
databases and drops those exact children during cleanup. It never resets the
database from `DATABASE_URL`.

```powershell
$container = 'hulee-db008-postgres'
docker run --rm -d --name $container `
  -e POSTGRES_USER=hulee -e POSTGRES_PASSWORD=hulee `
  -e POSTGRES_DB=postgres -p 15433:5432 postgres:16-alpine `
  -c max_prepared_transactions=10
$env:HULEE_DB_INTEGRATION='1'
$env:DATABASE_URL='postgresql://hulee:hulee@127.0.0.1:15433/postgres'
$env:NODE_ENV='test'
pnpm exec vitest run scripts/db/inbox-v2-install-reset.integration.test.mjs
docker stop $container
```

The suite fails setup instead of skipping the prepared-transaction branch when
`max_prepared_transactions` is zero. Use a strictly disposable PostgreSQL 16
instance; the connection database itself is never reset.

Verified scenarios:

- empty install and full current rerun;
- idempotent stream/projection bootstrap with sentinel-row preservation;
- refusal without manifest/confirmation/object receipt;
- refusal of expired, stale, reversed and future-dated authority;
- refusal of preserve/shared/wrong-target/wrong-journal/wrong-inventory inputs;
- refusal of a different migration bundle/bootstrap/MIG-001 or object receipt;
- refusal after a same-row-count connector status changes from inert to active;
- refusal after same-row tenant content changes, a sequence option changes or a
  new `drizzle` relation appears without changing reviewed business row totals;
- fail-closed refusal for PostgreSQL large objects and prepared transactions;
- refusal of default ACL before the first migration and during reviewed reset;
- refusal of PUBLIC schema creation before the first migration;
- active connection refusal without terminating that connection;
- automatic fence recovery after an injected lost
  `ALLOW_CONNECTIONS=false` response;
- rollback restores the original schema after an injected post-`DROP` failure;
- guarded reset removes the reviewed disposable state and rotates stream epoch;
- an exact retry is an idempotent `reset_noop` with the same stream epoch;
- reset receipts reject update/delete/truncate, use a database-wide generation
  and survive later resets;
- reuse of one generation with a different bootstrap tenant is rejected;
- an exact completed generation remains a verified `reset_noop` after manifest
  expiry, while expiry still rejects every new destructive generation;
- replay of an older completed generation after a later reset is rejected
  without rotating the current stream epoch;
- same-name no-op functions, weakened exact-name checks, replica-only or
  `WHEN(false)` triggers, missing CAS triggers, removed receipt indexes/unique
  constraints, unsafe PUBLIC table/column/function grants, non-owner execute
  grant options, changed SECURITY DEFINER lock functions and non-owner reset
  ledger grants/ownership block install/no-op; a new reviewed reset repairs the
  checked-in PostgreSQL 16 schema contract;
- forged journal blocks install but a newly reviewed disposable manifest can
  repair it by reset/reinstall;
- the repaired current database reruns without changes.

Repository completion now requires the preserve V1-upgrade/N-1/RBAC/rollback
lane activated by `INB2-MIG-001`, then `pnpm db:check` and full `pnpm check`.

The disposable inventory deliberately performs a complete deterministic scan
and sort of managed relation contents. It is a pre-production disposition gate,
not an online maintenance path for a large production database; a preserve
decision must use the migration path instead of this reset command.
