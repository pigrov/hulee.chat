# Database Scripts

Local and on-prem data-plane commands:

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed:mvp
```

`db:seed:mvp` creates an idempotent MVP tenant/admin/client/conversation scenario
through the same core and repository path used by the app. Configure it with:

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
