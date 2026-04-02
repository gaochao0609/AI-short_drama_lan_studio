# LAN Studio V1

LAN Studio is a small-team LAN deployment for AI short-drama creation. The stack is `Next.js + Prisma + Postgres + Redis + BullMQ + local filesystem storage`, designed to run on one Windows host with Docker Desktop and be reachable by other machines on the same network.

## Stack and service responsibilities

- `web`: Next.js UI and API server. Handles auth, admin tools, project CRUD, task polling, and asset download.
- `worker`: BullMQ consumer. Runs async generation processors and writes task/task-step status back to Postgres.
- `postgres`: Primary database for users, sessions, account requests, projects, tasks, versions, and assets.
- `redis`: BullMQ backing store and Redis persistence for queued jobs.
- `storage/`: Host-mounted media and cache directory shared by `web` and `worker`.

## Environment variables

Copy `.env.example` to `.env` and set values before running:

```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ai_short_drama
REDIS_URL=redis://redis:6379
APP_URL=http://localhost:3000
SESSION_SECRET=replace-with-a-32-character-or-longer-secret
STORAGE_ROOT=./storage
MAX_UPLOAD_MB=25
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=replace-with-a-strong-password
```

- `DATABASE_URL`: Prisma/Postgres connection string. In Docker Compose, use the `postgres` hostname. For host-run app processes, switch the hostname to `localhost`.
- `REDIS_URL`: Redis connection string. In Docker Compose, use `redis`. For host-run app processes, use `redis://127.0.0.1:6379`.
- `APP_URL`: Public origin used by the app. Set this to the final LAN or HTTPS URL, not just the bind address.
- `SESSION_SECRET`: At least 32 characters. Rotate it deliberately because changing it invalidates existing sessions.
- `STORAGE_ROOT`: Filesystem root for uploads, generated assets, exports, and caches.
- `MAX_UPLOAD_MB`: Maximum accepted upload size for reference images.
- `DEFAULT_ADMIN_USERNAME`: Seeded bootstrap admin account name.
- `DEFAULT_ADMIN_PASSWORD`: Seeded bootstrap admin password. Replace immediately in non-test environments.

## Windows and WSL2 guidance

On Windows 10 with Docker Desktop, prefer running the repository and `storage/` from the WSL2 Linux filesystem, not from an NTFS path such as `D:\...`.

Why:

- WSL2 ext4 storage has much better metadata and large-file performance for bind-mounted app folders.
- File watching and asset I/O are more reliable from WSL2 than from NTFS bind mounts.
- NTFS bind mounts can introduce slower image/video workflows and occasional permission edge cases.

Recommended:

1. Open a WSL2 shell.
2. Clone the repo into the Linux filesystem, for example `~/src/lan-studio-v1`.
3. Run Docker Desktop with WSL integration enabled.
4. Keep `storage/` inside the same WSL2 repo path.

If you keep the repo on NTFS anyway, expect slower large-file throughput and more filesystem friction.

## Local startup

### Option A: host-run app, Docker-run Postgres and Redis

Use this during development when you want `pnpm dev` hot reload.

```bash
cp .env.example .env
```

Edit `.env` for host access:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_short_drama`
- `REDIS_URL=redis://127.0.0.1:6379`
- `APP_URL=http://localhost:3000`

Then run:

```bash
docker compose up -d postgres redis
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

In a second shell:

```bash
pnpm worker
```

Order matters:

1. Start `postgres` and `redis`.
2. Run migrations.
3. Run seed data.
4. Start `web`.
5. Start `worker`.

### Option B: Docker Compose startup

Use this when you want `web + worker + postgres + redis` running together.

```bash
cp .env.example .env
```

For Compose, keep service hostnames in `.env`:

- `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ai_short_drama`
- `REDIS_URL=redis://redis:6379`

Bring up the data services first:

```bash
docker compose up -d postgres redis
```

Run migration and seed in order:

```bash
docker compose run --rm web pnpm db:migrate
docker compose run --rm web pnpm db:seed
```

Then start the app services:

```bash
docker compose up -d web worker
```

Or rebuild and start everything after schema/data are ready:

```bash
docker compose up -d --build
```

## Docker layout

`docker-compose.yml` defines:

- services: `web`, `worker`, `postgres`, `redis`
- named volumes: `pg-data`, `redis-data`
- host-mounted media storage: `./storage:/app/storage`

`Dockerfile`:

- installs dependencies with `pnpm install --frozen-lockfile`
- builds the app with `pnpm build`
- starts the production server with `pnpm start`

## Worker startup

The worker is a separate process. It is required for async tasks such as storyboard, image, video, and script-finalize queue jobs.

Host run:

```bash
pnpm worker
```

Compose run:

```bash
docker compose up -d worker
```

If the web app is up but the worker is not, users can enqueue tasks but queued jobs will not progress.

## LAN access setup

To expose the app to other machines on the same network:

1. Find the host machine LAN IP, for example `192.168.1.50`.
2. Set `APP_URL` to the URL users should actually open, for example:

```env
APP_URL=http://192.168.1.50:3000
```

3. Start the app on the host.
4. Allow inbound TCP `3000` in Windows Firewall if required.
5. Make sure the other clients can reach `http://192.168.1.50:3000`.

If you place a reverse proxy in front, users should open the proxy URL instead, and `APP_URL` must match that proxy URL.

## HTTPS and reverse proxy guidance

When serving LAN Studio over HTTPS, terminate TLS at a reverse proxy and set `APP_URL` to the final HTTPS origin.

Example:

```env
APP_URL=https://studio.lan
```

### Caddy with self-signed/internal CA certificates

`Caddyfile` example:

```caddy
studio.lan {
  tls internal
  reverse_proxy 127.0.0.1:3000
}
```

Notes:

- `tls internal` issues a local self-signed/internal certificate from Caddy's internal CA.
- Import Caddy's root CA certificate into each LAN client that should trust the site.
- Keep `APP_URL=https://studio.lan` so cookies and redirects use the correct origin.

### Nginx with a self-signed certificate

Generate a certificate:

```bash
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout certs/studio.lan.key \
  -out certs/studio.lan.crt \
  -days 365 \
  -subj "/CN=studio.lan"
```

Minimal `nginx.conf` server block:

```nginx
server {
  listen 443 ssl;
  server_name studio.lan;

  ssl_certificate     /etc/nginx/certs/studio.lan.crt;
  ssl_certificate_key /etc/nginx/certs/studio.lan.key;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Clients must trust the certificate or the issuing CA. If they do not, browsers will warn and secure cookies/redirect behavior may be unreliable.

## Backup and restore

Back up three things:

- Postgres data in `pg-data`
- Redis persistence in `redis-data`
- generated/uploaded files in `storage/`

Create a backup directory first:

```bash
mkdir -p backups
```

### Postgres backup and restore

Preferred backup is a logical dump:

```bash
docker compose exec -T postgres pg_dump -U postgres ai_short_drama > backups/postgres.sql
```

Restore:

```bash
cat backups/postgres.sql | docker compose exec -T postgres psql -U postgres -d ai_short_drama
```

### Redis backup and restore

Force Redis to flush a snapshot before copying raw files:

```bash
docker compose exec redis redis-cli SAVE
```

Find the actual Docker volume name:

```bash
docker volume ls | grep redis-data
```

Back up the volume contents:

```bash
docker run --rm \
  -v <actual_redis_volume_name>:/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -lc 'tar czf /backup/redis-data.tar.gz -C /data .'
```

Restore:

```bash
docker compose stop redis
docker run --rm \
  -v <actual_redis_volume_name>:/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -lc 'rm -rf /data/* && tar xzf /backup/redis-data.tar.gz -C /data'
docker compose start redis
```

### Raw `pg-data` volume backup and restore

If you need a volume-level backup instead of a logical SQL dump, stop the database first and archive the data volume:

```bash
docker compose stop postgres
docker volume ls | grep pg-data
docker run --rm \
  -v <actual_pg_volume_name>:/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -lc 'tar czf /backup/pg-data.tar.gz -C /data .'
docker compose start postgres
```

Restore:

```bash
docker compose stop postgres
docker run --rm \
  -v <actual_pg_volume_name>:/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -lc 'rm -rf /data/* && tar xzf /backup/pg-data.tar.gz -C /data'
docker compose start postgres
```

### `storage/` backup and restore

Back up:

```bash
tar czf backups/storage.tar.gz storage
```

Restore:

```bash
rm -rf storage
mkdir -p storage
tar xzf backups/storage.tar.gz -C .
```

Before restoring any backup set, stop `web` and `worker` so they do not write while files or volumes are being replaced.

## Verification commands

Useful local checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm playwright test
pnpm build
docker compose ps
docker compose restart web worker
```

For Task 15 specifically, the focused verification includes:

```bash
pnpm vitest run tests/unit/admin/tasks-page.test.tsx
pnpm vitest run tests/unit/workers/minimal-task.test.ts
pnpm vitest run tests/integration/workers/queue-concurrency.test.ts
pnpm playwright test tests/e2e/full-smoke.spec.ts
```
