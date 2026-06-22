# Docker Compose

Local and simple on-prem infrastructure for the data-plane.

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed:mvp
```

If another local project already uses PostgreSQL or MinIO default ports:

```powershell
$env:HULEE_POSTGRES_PORT = "55432"
$env:HULEE_MINIO_API_PORT = "19000"
$env:HULEE_MINIO_CONSOLE_PORT = "19001"
pnpm infra:up

$env:DATABASE_URL = "postgres://hulee:hulee@localhost:55432/hulee"
pnpm db:migrate
pnpm db:seed:mvp
```

Services:

- PostgreSQL: `localhost:5432`, database/user/password `hulee`.
- MinIO API: `localhost:9000`.
- MinIO console: `localhost:9001`.
- Default bucket: `hulee-files`.

Useful commands:

```bash
pnpm infra:logs
pnpm infra:down
```

Environment overrides:

- `HULEE_POSTGRES_PORT`
- `HULEE_POSTGRES_DB`
- `HULEE_POSTGRES_USER`
- `HULEE_POSTGRES_PASSWORD`
- `HULEE_MINIO_API_PORT`
- `HULEE_MINIO_CONSOLE_PORT`
- `HULEE_MINIO_ROOT_USER`
- `HULEE_MINIO_ROOT_PASSWORD`
- `HULEE_MINIO_BUCKET`
