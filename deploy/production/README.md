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
HULEE_EGRESS_PROBES_ENABLED=true
HULEE_EGRESS_PROBE_INTERVAL_MS=30000
HULEE_EGRESS_PROBE_TIMEOUT_MS=8000
```

The compose service supports two first-step gateway env shapes:

- `qmcgaw/gluetun` through `HULEE_EGRESS_OPENVPN_*` and related gluetun envs;
- the Bridge-compatible NordVPN gateway image through
  `HULEE_EGRESS_NORDVPN_*` values.

These values belong in the server `.env`; do not put VPN credentials or tenant
channel secrets in GitHub Secrets. The deploy workflow auto-detects
`HULEE_PROVIDER_EGRESS_ENABLED=true` and starts `hulee_chat_vpn_gateway` plus
`hulee_chat_worker_provider_egress`. Without that flag, the normal app services
deploy without VPN requirements.

The provider-egress worker uses the VPN gateway network namespace, so the deploy
workflow writes `.provider-egress.env` with current internal IPs for `postgres`
and `api`. The worker writes those values to `/etc/hosts` before startup, which
lets Gluetun use VPN-backed DNS instead of Docker's default nameserver for
external provider traffic.

For the pinned `qmcgaw/gluetun:v3.40` image, DNS-over-TLS is configured with
the legacy `DOT_*` environment variables exposed as `HULEE_EGRESS_DOT*`. Keep
`HULEE_EGRESS_DNS_KEEP_NAMESERVER=off`; otherwise Gluetun warns that Docker's
default nameserver can leak DNS outside the VPN. A startup log line like
`using plaintext DNS at address 1.1.1.1` is expected before the DoT server is
ready. Treat it as a problem only if it is not followed by
`DNS server listening` and `ready`, or if the gateway/worker `/etc/resolv.conf`
does not point at `127.0.0.1`.

The provider-egress worker writes runtime probe snapshots to
`deployment_egress_status_snapshots`. Platform admins can see the latest VPN
state, failed probes, consecutive failures and public egress IP on `/platform`.
If the snapshot becomes stale, the UI marks the profile degraded so a stopped
provider worker is visible even when the deployment config still says `ready`.

Platform admins can also choose desired egress routing per provider on
`/platform`. Those rows are stored in `deployment_egress_provider_policies` and
are enforced by provider workers before they call external APIs. The setting is
desired state, not an in-process network switch: if a policy says `direct` while
the Telegram worker is still running inside `hulee_chat_vpn_gateway`, calls are
blocked with egress diagnostics until the matching worker profile is deployed.
Switching between `direct` and `vpn_namespace` requires moving provider worker
features to the correct compose service and restarting/redeploying it.

Registry gateway images such as `qmcgaw/gluetun:v3.40` are pulled by the deploy
workflow. Server-local gateway images such as `bridge-nordvpn-gateway:latest`
must already exist on the host; the deploy workflow verifies them locally and
does not try to pull them from a registry.

The first gateway implementation uses the Hulee-owned compose service
`hulee_chat_vpn_gateway` with a configurable gateway image and provider envs.
It does not depend on Bridge containers or files.
