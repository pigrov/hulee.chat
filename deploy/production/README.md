# Hulee Chat Production Deployment

Runtime secrets live on the server in `/srv/hulee-chat/.env`.
GitHub Actions should not store tenant/provider secrets.

`HULEE_SECRET_ENCRYPTION_KEY` is a deployment-local 32-byte key used to encrypt
tenant-managed provider secrets such as Telegram bot tokens. Keep it in the
server `.env`; do not add provider tokens or this key to GitHub Secrets.

`HULEE_INTERNAL_API_SECRET` is a deployment-local signing secret shared by web
and api containers for internal API headers. Keep the same value in both
containers through the server `.env`.

## V2-only deployment boundary

`INB2-CLEAN-GATE` passed on `2026-07-22`; its operational receipt is
`docs/product/inbox-v2-clean-gate.md`. The temporary deployment freeze, unlock
variable, confirmation token and one-time bootstrap input are retired. A push
to `main` reaches the V2-only deployment only after every job in the full
`Check` workflow succeeds. The deployment checks out and labels the exact
`workflow_run.head_sha`; there is no direct-push or manual bypass around that
handoff. Before any registry or production-host secret-bearing step, it also
rejects a checked SHA that is no longer the current `main` revision, so
out-of-order CI completion cannot roll production back. The `Check` workflow
cancels superseded runs for the same branch, preventing an older completion from
displacing the latest pending delivery.

The separately approved unpublished-baseline replacement and deployment-safety
repair performed on `2026-07-23` are recorded in
`deploy/production/receipts/inbox-v2-reset-2026-07-23.md`.

This re-enables delivery, not provider traffic. Every deploy still verifies the
exact source revision and schema epoch, rejects legacy provider
containers/configuration and starts only the `core` worker with a
disabled/unavailable egress profile. Before any live runtime is stopped, the
target image runs a read-only migration preflight against the exact checked-in
journal contract. An incompatible journal therefore fails the deployment while
the current API, worker and Web remain available. Only after that preflight
passes does deployment stop the old data-plane writers, apply pending DDL and
start the target runtime.

Ordinary deployment refuses a live `.env` containing the one-time
`HULEE_SEED_API_KEY` or `HULEE_PLATFORM_ADMIN_PASS`. On a newly approved fresh
installation, configure those values only for the explicit foundation seed,
store the resulting operator credentials outside the runtime environment, then
remove both values and recreate all containers before normal deployment.

The known pre-production runtime drain is recorded separately in
`docs/product/inbox-v2-clean-002-runtime-detachment.md`. Do not infer remote
drain state from this deployment recipe.

The generic `db:inbox-v2:reset` command must not be weakened or relabelled for
the shared pre-production target: its contract intentionally accepts only
`personal_local` and `ephemeral_ci`. ADR 0016 authorizes a one-time operator
replacement of the two exact disposable Compose volumes for the known target,
with fresh credentials and a recorded before/after receipt. It does not create
a reusable destructive SaaS reset path.

Initial server preparation:

```bash
sudo mkdir -p /srv/hulee-chat
sudo chown -R deploy:deploy /srv/hulee-chat
cp /path/to/env.example /srv/hulee-chat/.env
chmod 600 /srv/hulee-chat/.env
```

After the first migration of an approved fresh installation, the foundation
bootstrap seed can be run exactly once:

```bash
cd /srv/hulee-chat
docker compose --env-file .env --env-file .release.env -f docker-compose.yml --profile bootstrap run --rm seed
```

This seed creates only the platform foundation: tenant, administrator and API
key. It does not create Inbox clients, conversations, messages, channel
connectors or provider credentials. Set `HULEE_SEED_ID_SEED=local`,
`HULEE_WEB_TENANT_ID=tenant_local_1` and
`HULEE_WEB_EMPLOYEE_ID=employee_local_1` together for the deterministic
foundation identity used by the current pre-production profile.

The nginx config in `deploy/nginx/chat.hulee.ru.conf` is a template for the
existing `transcribe_nginx` reverse proxy. Apply it only after the app container
is running and the TLS certificate exists.

The marketing site for `hulee.ru` runs as a separate `hulee_site` container
from the same production image. The nginx config in
`deploy/nginx/hulee.ru.conf` replaces the current inline placeholder page and
proxies the apex domain to that container. Keep `chat.hulee.ru` pointed at
`hulee_chat_web`. The site and infrastructure containers receive only their
explicit environment variables, not the application secret `.env` payload.

## Object storage

Production compose runs a private MinIO service for product files. The deploy
workflow appends missing `HULEE_OBJECT_STORAGE_*` values to the server `.env`,
including a generated storage secret. These values stay on the server and are
not GitHub Secrets.

The default internal endpoint is `http://minio:9000`, bucket `hulee-files`.

## Clean-slate provider runtime fence

The production compose file intentionally contains no provider-egress worker or
VPN gateway while Inbox V2 is rebuilt. Its only worker is pinned to the `core`
feature; provider listeners, polling and outbound dispatch cannot be activated
through server `.env` overrides.

The migration service runs only `pnpm db:migrate`; the historical preserve
installer and reviewed-online-bridge override are not part of production
composition.

The deploy workflow rejects a legacy
`HULEE_PROVIDER_EGRESS_ENABLED=true` setting and any non-core
`HULEE_WORKER_FEATURES` value. Operators must also drain and remove any old
`hulee_chat_worker_provider_egress` or `hulee_chat_vpn_gateway` container; the
workflow refuses to deploy while either container still exists.

Provider egress may return only through an explicitly reviewed Inbox V2 adapter
activation after the clean-slate gate. Retained egress policy and diagnostics
schemas are platform foundations and do not grant runtime provider authority.

## Runtime schema epoch

Production images and Compose declare the exact
`preproduction-inbox-v2-1` epoch. API, Web prestart and worker compare the live
Drizzle journal with the one checked-in baseline and reject missing, older,
newer or V1-bearing databases before opening a listener or scheduling work.
The API health response publishes the verified epoch, migration count and build
revision. The production image carries the same build revision and epoch as OCI
labels, and deployment verifies both labels as well as the exact SHA image tag.

The known pre-production epoch replacement is complete. Any future separately
approved disposable replacement must again remove every old application and
infrastructure container, rotate the database, MinIO, encryption, internal API
and bootstrap credentials before creating new volumes, and delete every
explicitly inventoried secret-bearing backup. Do not turn that operator action
into a generic shared-SaaS reset command.
