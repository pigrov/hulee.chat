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
