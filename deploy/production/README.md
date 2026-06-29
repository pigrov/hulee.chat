# Hulee Chat Production Deployment

Runtime secrets live on the server in `/srv/hulee-chat/.env`.
GitHub Actions should not store tenant/provider secrets.

`HULEE_SECRET_ENCRYPTION_KEY` is a deployment-local 32-byte key used to encrypt
tenant-managed provider secrets such as Telegram bot tokens. Keep it in the
server `.env`; do not add provider tokens or this key to GitHub Secrets.

`HULEE_INTERNAL_API_SECRET` is a deployment-local signing secret shared by web
and api containers for internal API headers. Keep the same value in both
containers through the server `.env`.

Initial server preparation:

```bash
sudo mkdir -p /srv/hulee-chat
sudo chown -R deploy:deploy /srv/hulee-chat
cp /path/to/env.example /srv/hulee-chat/.env
chmod 600 /srv/hulee-chat/.env
```

After the first deploy creates containers and runs migrations, bootstrap seed can
be run once:

```bash
cd /srv/hulee-chat
docker compose --env-file .env --env-file .release.env -f docker-compose.yml --profile bootstrap run --rm seed
```

The nginx config in `deploy/nginx/chat.hulee.ru.conf` is a template for the
existing `transcribe_nginx` reverse proxy. Apply it only after the app container
is running and the TLS certificate exists.

## Provider egress

Telegram and WhatsApp provider traffic for Hulee-managed SaaS must run through a
deployment egress profile. The production compose file keeps `api`, `web`,
`postgres` and the regular `worker` on normal Docker networking. Provider-facing
runtime jobs can be enabled separately with the `provider-egress` compose
profile:

```bash
HULEE_PROVIDER_EGRESS_ENABLED=true
HULEE_WORKER_FEATURES=core
HULEE_PROVIDER_EGRESS_WORKER_FEATURES=telegram_bot,telegram_user,whatsapp_user,whatsapp_official
HULEE_EGRESS_OPENVPN_USER=...
HULEE_EGRESS_OPENVPN_PASSWORD=...
```

These values belong in the server `.env`; do not put VPN credentials or tenant
channel secrets in GitHub Secrets. The deploy workflow auto-detects
`HULEE_PROVIDER_EGRESS_ENABLED=true` and starts `hulee_chat_vpn_gateway` plus
`hulee_chat_worker_provider_egress`. Without that flag, the normal app services
deploy without VPN requirements.

The first gateway implementation uses the Hulee-owned compose service
`hulee_chat_vpn_gateway` with a configurable gateway image and provider envs.
It does not depend on Bridge containers or files.
