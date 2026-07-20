# Hulee Chat Production Deployment

Runtime secrets live on the server in `/srv/hulee-chat/.env`.
GitHub Actions should not store tenant/provider secrets.

`HULEE_SECRET_ENCRYPTION_KEY` is a deployment-local 32-byte key used to encrypt
tenant-managed provider secrets such as Telegram bot tokens. Keep it in the
server `.env`; do not add provider tokens or this key to GitHub Secrets.

`HULEE_INTERNAL_API_SECRET` is a deployment-local signing secret shared by web
and api containers for internal API headers. Keep the same value in both
containers through the server `.env`.

## Deployment freeze

Application deployment remains frozen until `INB2-CLEAN-GATE` passes. The
workflow is manual (`workflow_dispatch`) and proceeds only when repository
variable `HULEE_CLEAN_SLATE_DEPLOY_UNLOCKED` is `true` and the operator enters
the exact `DEPLOY_CLEAN_SLATE_V2` confirmation. These controls are an explicit
temporary exception gate, not permission to restore Inbox V1 or provider I/O.

The known pre-production runtime drain is recorded separately in
`docs/product/inbox-v2-clean-002-runtime-detachment.md`. Do not infer remote
drain state from this deployment recipe.

Initial server preparation:

```bash
sudo mkdir -p /srv/hulee-chat
sudo chown -R deploy:deploy /srv/hulee-chat
cp /path/to/env.example /srv/hulee-chat/.env
chmod 600 /srv/hulee-chat/.env
```

After the first deploy creates containers and runs migrations, the foundation
bootstrap seed can be run once:

```bash
cd /srv/hulee-chat
docker compose --env-file .env --env-file .release.env -f docker-compose.yml --profile bootstrap run --rm seed
```

This seed creates only the platform foundation: tenant, administrator and API
key. It does not create Inbox clients, conversations, messages, channel
connectors or provider credentials.

The nginx config in `deploy/nginx/chat.hulee.ru.conf` is a template for the
existing `transcribe_nginx` reverse proxy. Apply it only after the app container
is running and the TLS certificate exists.

The marketing site for `hulee.ru` runs as a separate `hulee_site` container
from the same production image. The nginx config in
`deploy/nginx/hulee.ru.conf` replaces the current inline placeholder page and
proxies the apex domain to that container. Keep `chat.hulee.ru` pointed at
`hulee_chat_web`.

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
`HULEE_WORKER_FEATURES` value. Before unlocking deployment, operators must also
drain and remove any old `hulee_chat_worker_provider_egress` or
`hulee_chat_vpn_gateway` container; the workflow refuses to deploy while either
container still exists.

Provider egress may return only through an explicitly reviewed Inbox V2 adapter
activation after the clean-slate gate. Retained egress policy and diagnostics
schemas are platform foundations and do not grant runtime provider authority.
