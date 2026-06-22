# PostgreSQL

Local default URL:

```bash
postgres://hulee:hulee@localhost:5432/hulee
```

Commands:

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed:mvp
```

When the compose host port is overridden, set `DATABASE_URL` for migration and
seed commands:

```powershell
$env:HULEE_POSTGRES_PORT = "55432"
pnpm infra:up

$env:DATABASE_URL = "postgres://hulee:hulee@localhost:55432/hulee"
pnpm db:migrate
pnpm db:seed:mvp
```

Production/on-prem operators should run migrations explicitly before starting app
services that depend on the new schema.
