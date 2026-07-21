# Database Scripts

Local and on-prem data-plane commands:

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed:foundation
```

`db:migrate` requires an explicit `DATABASE_URL`, takes the Inbox V2 database
lifecycle advisory lock, verifies that every applied Drizzle journal row is the
exact `(created_at, SHA-256)` prefix of the checked-in migration contract, runs
pending migrations and audits the current V2 schema. It never falls back to a
localhost database. The preflight refuses default ACL entries and the current
audit refuses PUBLIC schema creation, any PUBLIC privilege on a managed
relation, sequence or column, and unsafe privileged-function/reset-ledger ACLs.

The repeatable V2 install can also apply an explicit tenant stream/projection
bootstrap:

```bash
pnpm db:inbox-v2:install -- --bootstrap path/to/repository-bootstrap.json
```

The bootstrap document uses schema
`core:inbox-v2.repository-bootstrap@v2`. It creates only the requested shared
tenant prerequisite, tenant stream head and projection generation/checkpoint/
head. Re-running it verifies and preserves the same epoch/revisions; it does not
write legacy Client/Conversation/Message rows.

ADR 0016 defines the current pre-production database epoch as a clean-slate
baseline. The checked-in migration directory contains the complete install
contract for a new database; populated databases from the unpublished V1 era
are unsupported and must be recreated. The install runner therefore has no V1
backfill, preserve mode, blocking-DDL compatibility override or reviewed online
bridge.

The baseline never hard-codes the source deployment owner. Run migrations as
the actual database owner with authority to create and harden the four managed
`hulee_inbox_v2_*` roles. Ordinary schema objects remain owned by that database
owner; only the explicitly audited security functions are transferred to their
dedicated no-login owner roles.

The destructive command is deliberately separate:

```bash
pnpm db:inbox-v2:reset -- \
  --manifest path/to/mig-001-disposition.json \
  --mig-001-evidence path/to/mig-001-evidence.json \
  --object-receipt path/to/object-storage-receipt.json \
  --confirm sha256:<exact-manifest-digest> \
  --bootstrap path/to/repository-bootstrap.json
```

Reset is unavailable until `INB2-MIG-001` records an eligible disposable
manifest and a separate completed MIG-001 evidence receipt. It validates the
exact PostgreSQL cluster system identifier, database name/owner, current journal,
target migration-bundle digest, bootstrap bytes, complete managed relation
content/catalog/sequence/ACL inventory, live provider/outbox/lease state,
object-storage receipt and all fast-path conditions. It fences new target
connections through the cluster control database, refuses existing sessions,
prepared transactions, large/database-level objects and unmanaged schemas, and
performs schema replacement, all migrations, bootstrap, exact schema audit and
completion receipt in one transaction. Completion receipts survive later resets
and reject update/delete/truncate. An exact successful retry returns
`reset_noop`; the generation is database-wide, so drift, a different bootstrap
tenant or replay of an older generation fails closed. Manifest approval expires
within 24 hours and all evidence must be refreshed within one hour of approval.
An exact completed generation may still be fully verified and returned as
`reset_noop` after expiry; expiry can never authorize a new destructive reset.
It refuses
protected, shared, SaaS, on-prem and preserve/unknown targets.
There is no `--force`, environment-label or row-count authorization shortcut.
The current local database must not use this command until its disposition is
recorded by `INB2-MIG-001`.

If the process/host dies after the target was fenced, follow the exact
`ALLOW_CONNECTIONS=true` control-database recovery and system-identifier check
in `docs/product/inbox-v2-db-008-install-and-reset.md` before retrying.

`db:seed:foundation` is the one-shot retained-foundation seed for a freshly
migrated database. It creates the initial tenant, tenant settings and brand
profile, module rows, entitlements, local account and admin employee, tenant
RBAC role/permissions/binding, domain events and outbox rows, followed by one
tenant API key. When both platform-admin credentials are supplied, it also
creates or updates the separate platform-admin account.

The seed deliberately creates no Client, Conversation, Message, attachment,
delivery, source connector/session, webhook or other provider configuration.
It is not a demo Inbox seed and is not an Inbox V2 projection bootstrap. Run it
once after `db:migrate` on a fresh clean-slate database; foundation conflicts
fail instead of being overwritten. Configure it with:

- `DATABASE_URL`
- `HULEE_SEED_TENANT_SLUG`
- `HULEE_SEED_TENANT_NAME`
- `HULEE_SEED_PRODUCT_NAME`
- `HULEE_SEED_ADMIN_EMAIL`
- `HULEE_SEED_API_KEY`
- `HULEE_SEED_API_KEY_NAME`
- `HULEE_SEED_ID_SEED`
- `HULEE_SEED_NOW`
- `HULEE_PLATFORM_ADMIN_USER`
- `HULEE_PLATFORM_ADMIN_PASS`
- `HULEE_PLATFORM_ADMIN_DISPLAY_NAME`

If `HULEE_SEED_API_KEY` is not set, the seed creates a local development API
key with the raw value `hulee-local-dev-key`. Only the hash is stored in
PostgreSQL.
