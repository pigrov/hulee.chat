# Database Scripts

Local and on-prem data-plane commands:

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed:mvp
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

`db:seed:mvp` is the temporary Inbox V1 compatibility seed. It creates an
idempotent MVP tenant/admin/client/conversation scenario through the current V1
core/repository path and is not the Inbox V2 canonical bootstrap. Configure it
with:

- `DATABASE_URL`
- `HULEE_SEED_TENANT_SLUG`
- `HULEE_SEED_TENANT_NAME`
- `HULEE_SEED_PRODUCT_NAME`
- `HULEE_SEED_ADMIN_EMAIL`
- `HULEE_SEED_CLIENT_NAME`
- `HULEE_SEED_INBOUND_TEXT`
- `HULEE_SEED_API_KEY`
- `HULEE_SEED_API_KEY_NAME`
- `HULEE_SEED_ID_SEED`

If `HULEE_SEED_API_KEY` is not set, the seed creates a local development API
key with the raw value `hulee-local-dev-key`. Only the hash is stored in
PostgreSQL.
