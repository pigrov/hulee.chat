# Hulee Chat Production Deployment

Runtime secrets live on the server in `/srv/hulee-chat/.env`.
GitHub Actions should not store tenant/provider secrets.

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
