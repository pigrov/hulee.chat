# Inbox V2 Clean Install And Guarded Reset

Status: `verified; repository preserve-compatibility and disposable lanes complete; production preserve expand fails closed pending an online bridge`

Owner task: `INB2-DB-008`

Last verified: `2026-07-16`

## Scope And Current Gate

This runbook implements the DB-008 portion that is independent of deployment
disposition:

- explicit-URL, advisory-locked migration execution;
- bounded migration DDL lock/statement budgets applied on the same PostgreSQL
  session as the advisory lock;
- a PII-safe pending-DDL preflight that refuses blocking, rewriting,
  destructive or unbounded preserve work before the first migration statement;
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

`INB2-MIG-001` completed on `2026-07-16` and selected `preserve`. DB-008 now
verifies that path with a populated migration-0027 V1 snapshot, a read-only RBAC
dry run, a pinned migration-0034 source-bundled N-1 compatibility harness and an
injected failed-migration rollback. The current development and known shared
SaaS databases must still never be reset. The destructive workflow is verified
only against strictly named synthetic disposable databases, and no usable local
disposable manifest is committed to the repository.

The raw historical migration chain contains operations that are not valid as a
normal online preserve expand. DB-008 therefore proves its functional and data
compatibility only inside a strictly fenced integration-test database; the
default install runner refuses that chain before DDL. Production preserve needs
a separately reviewed online bridge or an explicitly approved maintenance
procedure. Runtime dual materialization belongs to `INB2-MIG-002`, and
operational data backfill belongs to `INB2-MIG-003`.

## Non-Destructive Install

`pnpm db:migrate` now calls `scripts/db/run-migrations.mjs`. The runner:

1. refuses a missing `DATABASE_URL`;
2. obtains one fail-fast advisory lock;
3. applies the bounded lock/statement budget on that same session before any
   journal, privilege, preflight or migration query;
4. reads every checked-in SQL file through the Drizzle journal and computes its
   SHA-256;
5. requires the applied rows to be the exact ordered prefix of that contract;
6. refuses a public schema containing managed objects when no migration journal
   exists;
7. inspects pending statements against relations that existed before expand and
   refuses an online-bridge violation before the first migration statement;
8. runs accepted pending migrations on the budgeted lock-owning session;
9. requires the complete current journal and the exact checked-in bodies,
   bindings, modes and safety-critical structural definitions of Inbox V2
   relations, functions, triggers, constraints, indexes and security roles;
10. refuses non-empty default-privilege state, PUBLIC schema creation and any
    PUBLIC privilege on a managed relation, sequence or column before it can
    affect a migration.

It is safe to rerun on an exact current database and never invokes reset.
Partial or forged-current journals fail closed; they may be replaced only by a
separately reviewed disposable reset.

The default migration budget is a `5s` lock timeout and `15m` statement timeout.
Operators may lower or raise it with
`HULEE_INBOX_V2_MIGRATION_LOCK_TIMEOUT_MS` and
`HULEE_INBOX_V2_MIGRATION_STATEMENT_TIMEOUT_MS`; values must be positive safe
integers, cannot exceed `60s` and `60m`, and the statement budget cannot be
shorter than the lock budget. The budget covers journal verification, privilege
checks, DDL preflight, migration, current-schema verification and optional
bootstrap. Both settings are reset before the advisory-lock connection is
released. Install fails closed if cleanup cannot restore them, and the result
contains backend/settings/reset evidence under `migrationDdlBudget`.

### Preserve expand DDL preflight

The preflight returns
`core:inbox-v2.expand-ddl-risk-evidence@v2`. It binds the checked migration
prefix, hashes every relevant statement, hashes the database identity and
records only technical relation names, sizes and occupancy facts. It contains
no row values or PII. The `8 MiB` relation-size boundary is retained as a stable
diagnostic marker only; it never authorizes an operation that ADR 0014 forbids.

Evidence V2 is a discriminated union. A targeted operation carries one
technical `relationName`; an inventory-wide unknown or global operation instead
carries `relationScope=pre_expand_public_inventory`, a relation count and a
domain-separated SHA-256 of the sorted normalized inventory. It never embeds
that raw inventory and never runs per-relation row probes for the scoped case.
This keeps the refusal report bounded by pending statements rather than by
`statements x relations`, while preserving a categorical, tamper-evident gate.

The normal runner fails with `inbox_v2.expand_online_bridge_required` when
pending work against a relation that existed before expand includes any table/
data rewrite, destructive or unknown ALTER, trigger/rule/security change,
unbounded source/target backfill, blocking or concurrently-executed index,
global blocking maintenance, immediate constraint validation/tightening, or
another unclassified relation DDL. Every unrecognized statement on a non-empty
pre-expand inventory becomes a scoped violation. These categories require a
bridge regardless of the mutable size/occupancy snapshot,
which removes a preflight-to-DDL TOCTOU authorization path. A `NOT VALID`
constraint is still immediate tightening for new N-1 writes and therefore also
requires the reviewed bridge. Only explicitly classified metadata-only changes,
such as a plain nullable column, may continue under the bounded lock/statement
budget. The error
carries the frozen sanitized evidence and its `reportSha256`, so refusal is
diagnosable without running DDL. Historical migrations `0029` and `0036` cross
this boundary; a later migration cannot make their earlier statements
online-safe.

There is no command-line or environment-variable bypass. A library-only
compatibility switch is accepted solely when all of these test guards hold:

- the database name matches `hulee_db008_preserve_*` or `hulee_db008_n1_*`;
- `NODE_ENV=test`;
- `HULEE_DB_INTEGRATION=1`;
- the caller explicitly supplies the test-only option.

That switch proves preservation and N-1 semantics for the exact historical
contract. It is not production migration authority and is unavailable through
`pnpm db:migrate` or `pnpm db:inbox-v2:install`.

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

## Preserve V1 Upgrade Lane

`scripts/db/inbox-v2-preserve-upgrade.integration.test.mjs` creates an isolated
database at the representative migration-0027 prefix and inserts two tenants,
active/deactivated employees, organization/team/queue membership, direct/group/
internal/closed conversations, inbound/outbound messages, delivery attempts,
files/attachments, pending/processed outbox rows and varied RBAC grants. It also
persists a complete direct-source chain (`source_connection`,
`source_account`, raw and normalized inbound events) plus connector/session,
session-event and authentication-challenge state. It then:

1. records the V1 column contract and a deterministic per-relation content
   fingerprint;
2. runs the RBAC report and proves that it did not write to the database;
3. proves that the default runner returns the sanitized online-bridge refusal
   while leaving the journal and every V1 fact unchanged;
4. applies the current migration-0038 contract only through the strict DB-008
   compatibility switch and bounded DDL budget;
5. proves every V1 baseline column and row value is unchanged, and that the only
   V2 rows are the migration-owned foundation state expected from existing
   Client/Employee rows;
6. proves the explicit operational-table allowlist remains at zero, so no
   message, dispatch, notification, assignment or projection side effect was
   invented;
7. reruns the normal current-schema install to prove idempotency.

The exact expected foundation result is `14` rows: two Client merge graph
heads, four Client merge node states, four Employee assignment fence heads and
four Employee assignment fence versions. Every other non-empty `inbox_v2_*`
table fails the gate. This distinguishes deterministic schema bootstrap from
the operational backfill owned by `INB2-MIG-003`.

Additive columns are allowed, but a missing or changed V1 baseline column/value
fails the gate. This is the DB-008 schema-preservation proof, not the MIG-003
business-data backfill.

## RBAC Dry Run

The dry run reads all persisted roles, permissions, bindings and direct grants
inside a `REPEATABLE READ READ ONLY` transaction, including scheduled, expired
and revoked rows. It validates tenants, subjects and scopes and applies the
versioned V1-to-V2 mapping catalog. The selected tenant ID remains the explicit
report scope; source role/subject/scope/binding/grant references are hashed, and
the database reader never selects grant reasons or employee PII columns.

```powershell
$env:DATABASE_URL = 'postgresql://...'
pnpm db:inbox-v2:rbac-dry-run -- --tenant-id <tenant-id> `
  --as-of <ISO-8601-timestamp> --pretty
```

Each entry is classified as `mapped`, `review_required`,
`compatibility_only` or `invalid`. `broadenedAccessCount` must remain zero and
`readyForAutomaticApply` is false whenever review/invalid entries, source issues
or a missing journal exist. Asking for an unknown tenant produces the PII-safe
`requested_tenant_missing` issue and fails closed. Deterministic ordering uses
ordinal code-unit comparison rather than host locale. A `compatibility_only`
entry is explicitly retained in V1 and grants no V2 access, so it does not by
itself block the safe mapped subset. `mappingSha256` identifies the stable
source-to-target mapping;
`reportSha256` also binds the observed migration journal and catalog evidence.
This command never applies grants. Human-reviewed write/apply orchestration is a
later migration task.

## Pinned N-1 Compatibility Contract

The checked-in compatibility build is pinned to source revision
`3b9d703bb63d5ce39ea549d62413dee02d1969a0`, tree
`06e6dcad7a6f1d415e42376b62a1716233206373`, its 35-migration prefix through
`0034`, exact lockfile/external versions and bundle SHA-256
`cf68a8574f58d6ee02794cde7950d18d828a7b8d4e68f7a8949170225e55b51b`.
The contract file SHA-256 is
`8582c3e6fb1d9736d77334f0b0b62e8a41f7092430150bcea8a47ee1a1c15f37`.
The contract and generator live under `scripts/db/fixtures/inbox-v2/`; the CJS
bundle is a deterministic `source-bundled-process-harness`, not a production
deployment image.

The raw historical revision has a PostgreSQL `42702` routing failure caused by
unqualified `UPDATE ... RETURNING` columns. The N-1 contract therefore binds the
single patch `db008-n1-routing-returning-qualification-v1` and its source/patch/
result digests. The compatibility patch must be deployed before expand; do not
run schema expand merely because the unpatched historical image starts. The
runtime gate keeps one pinned source-bundled process and one connection pool/
backend alive across pre-expand, a failed expand and migration `0035` through
`0038`. It proves V1 inbox query, reply, routing, web view-model load and worker
outbox processing before expand, immediately after rollback and after the
successful compatibility expand, without provider I/O.

This harness executes the pinned internal API service, Web inbox client with
session/config stubs and in-process fetch, and outbox worker with a fake
no-provider handler. It does not start Next.js, an API HTTP server, a container
entrypoint or provider network egress. Startup of the actual supported
deployable N-1 image remains a release/package gate and cannot be inferred from
this source bundle.

When the supported N-1 release changes, regenerate with
`pnpm db:inbox-v2:n1-bundle`, review any compatibility patch explicitly, verify
the new base/tree/lockfile/migration/inputs/bundle digests, and commit the
contract, patch and generated bundle together. CI checks out full Git history,
rebuilds the artifact from the pinned revision and fails when either generated
file differs. Runtime tests then consume the checked-in bundle without network
access.

## Preserve Rollback

The N-1 gate injects a synthetic migration `0035` through the production
lifecycle runner. It mutates a V1 row, creates a marker and then divides by zero.
The gate immediately probes the still-running source-bundled process and proves
PostgreSQL rolled back the whole transaction: the journal stays at 35 entries,
the V1 fingerprint and pending outbox remain unchanged, the marker is absent,
the advisory lock/session budget is cleaned up and the same backend still
serves work. Recovery is forward-only: fix the migration and rerun expand; do
not attempt an unreviewed down migration or destructive reset of a preserve
deployment.

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
- no other database backend except PostgreSQL's autovacuum worker (the command
  never terminates one);
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

`pg_stat_activity` excludes exactly `autovacuum worker` from the connection
fence because that PostgreSQL-owned worker must not make the guarded CI/reset
gate nondeterministic. Client backends, walsenders, logical-replication workers,
custom background workers and unknown backend types still block reset.
Autovacuum receives no reset authority; ordinary PostgreSQL DDL locking plus the
fixed `5s` lock timeout still prevents schema replacement while its maintenance
lock conflicts.

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

The preserve lane uses the same isolated-child-database rule but does not need
destructive-reset authority or prepared transactions:

```powershell
$env:HULEE_DB_INTEGRATION = '1'
$env:DATABASE_URL = 'postgresql://hulee:hulee@127.0.0.1:15432/postgres'
$env:NODE_ENV = 'test'
pnpm test:inbox-v2:preserve
```

CI runs this command shape sequentially in the
`inbox-v2-preserve-upgrade` job so its global PostgreSQL role fixtures cannot
race each other. That job fetches full Git history, regenerates the N-1 bundle
and contract and rejects any diff before running the preserve tests. A separate
`inbox-v2-disposable-lifecycle` job starts PostgreSQL 16 with
`max_prepared_transactions=10`, runs the guarded install/reset suite and always
stops the container.

Final local evidence on `2026-07-16`: preserve/RBAC/N-1 passed `3` files / `17`
tests; lifecycle/DDL/RBAC/install/routing focused suites passed `5` files / `72`
tests; the disposable PostgreSQL 16 lifecycle passed `1` exhaustive scenario;
both database lanes left `0` child databases. Bundle and contract regeneration
was byte-identical. Full `pnpm check` passed `302` files / `3024` tests, with
`30` files / `251` opt-in integration tests skipped in that non-PostgreSQL run,
and every format, ESLint, TypeScript, DB, i18n, encoding, branding and native
gate passed.

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
- active client/background/replication backend refusal without terminating it;
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
- the default runner detects unsafe pending DDL for the populated
  migration-0027 V1 snapshot and refuses without changing its journal, schema or
  content;
- the strict ephemeral compatibility lane reaches migration 0038 without
  changing V1 baseline facts, creates exactly the allowlisted 14 deterministic
  foundation rows and creates no operational V2 rows;
- the read-only RBAC dry run remains deterministic across expand and reports
  every mapped/review/compatibility/invalid source without applying access;
- the pinned, patched migration-0034 source-bundled N-1 process harness remains
  healthy before, immediately after rollback and after the strict ephemeral
  0035-0038 compatibility expand;
- an injected failed migration rolls back its V1 mutation, marker and journal
  entry while the same N-1 process remains operational.

The DB-008 disposable and preserve repository harnesses are complete; they do
not authorize production expand. `INB2-MIG-002` owns the reviewed online bridge
needed before dual materialization, including the historical `0029`/`0036`
boundaries. `INB2-MIG-003` owns operational backfill. Real supported N-1 image
startup and backup/restore release proof remain in `INB2-MIG-006`, packaged
migration/start ordering in `INB2-OPS-009`, and productized restore evidence in
`INB2-OPS-007`.

The disposable inventory deliberately performs a complete deterministic scan
and sort of managed relation contents. It is a pre-production disposition gate,
not an online maintenance path for a large production database; a preserve
decision must use the migration path instead of this reset command.
