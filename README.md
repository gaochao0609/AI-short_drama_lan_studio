# LAN Studio V1

English | [简体中文](./README.zh-CN.md)

LAN Studio is a small-team LAN deployment for AI short-drama creation. It runs on a single Windows host with Docker Desktop and is designed to be reachable from other machines on the same local network.

The stack is:

- `Next.js`
- `Prisma`
- `Postgres`
- `Redis`
- `BullMQ`
- local filesystem storage

## What the product currently does

LAN Studio currently covers four linked workflow stages inside one project workspace:

1. `Script`: create and finalize scripts.
2. `Storyboard`: generate storyboard segments from a selected script asset.
3. `Images`: generate images from text or from selected reference images.
4. `Videos`: generate videos from selected reference images.

It also includes a unified project-level asset center:

- uploaded script files
- uploaded image reference files
- system-generated final scripts
- generated images
- generated videos

The asset center is the default source of truth for workflow inputs. Users can upload assets once, bind them as project defaults, and reuse them across storyboard, image, and video generation.

## User and admin flow

The app uses an approval-based account flow:

1. A user submits a registration request from `/register-request`.
2. An admin approves the request in `/admin/users`.
3. The approved user receives a temporary password.
4. On first login, the user is redirected to `/force-password`.
5. After the password is changed, the user enters the workspace.

Admin pages currently cover:

- `Users & permissions`
- `Model providers`
- `Task monitoring`
- `Storage management`

## Workspace structure

The main workspace now has three important layers:

- `Workspace home`: overview, recent projects, recent tasks, and quick project creation.
- `Project detail`: workflow summary, asset overview, task history, and entry points into each stage.
- `Project asset center`: upload, preview, download, retry script parsing, delete eligible assets, and manage default bindings.

Default bindings currently support:

- one storyboard script asset
- multiple default image reference assets
- multiple default video reference assets

Workflow pages still allow one-off overrides, but project defaults are managed in the asset center.

## Stack and service responsibilities

- `web`: Next.js UI and API server. Handles auth, admin tools, project CRUD, workflow APIs, asset APIs, and downloads.
- `worker`: BullMQ consumer. Runs async processors for script finalization, uploaded script parsing, storyboard generation, image generation, and video generation.
- `postgres`: primary database for users, sessions, account requests, projects, workflow versions, tasks, bindings, and assets.
- `redis`: BullMQ backing store for queued jobs.
- `storage/`: host-mounted media and cache directory shared by `web` and `worker`.

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

- `DATABASE_URL`: Prisma/Postgres connection string. In Docker Compose, use `postgres`. For host-run app processes, switch the hostname to `localhost`.
- `REDIS_URL`: Redis connection string. In Docker Compose, use `redis`. For host-run app processes, use `redis://127.0.0.1:6379`.
- `APP_URL`: public origin used by redirects and cookies. Set this to the actual LAN or HTTPS URL users will open.
- `SESSION_SECRET`: at least 32 characters. Rotating it invalidates existing sessions.
- `STORAGE_ROOT`: filesystem root for uploads, generated assets, exports, and caches.
- `MAX_UPLOAD_MB`: upload size limit for reference images and other asset-center uploads.
- `DEFAULT_ADMIN_USERNAME`: bootstrap admin username used by seed data.
- `DEFAULT_ADMIN_PASSWORD`: bootstrap admin password used by seed data.

## Windows and WSL2 guidance

On Windows with Docker Desktop, prefer keeping the repository and `storage/` inside the WSL2 Linux filesystem instead of an NTFS path such as `D:\...`.

Why:

- bind-mounted file access is faster and more reliable from WSL2 ext4
- file watching behaves better
- large media I/O is less fragile

Recommended:

1. Open a WSL2 shell.
2. Clone the repo into the Linux filesystem, for example `~/src/lan-studio-v1`.
3. Enable WSL integration in Docker Desktop.
4. Keep `storage/` inside the same WSL2 repo path.

## Local startup

### Recommended on Windows: PowerShell scripts

These scripts are intended for Windows PowerShell or `pwsh`.

Before the first run:

1. Create `.env` manually from `.env.example`.
2. Keep the Compose-style hostnames from `.env.example`, especially `postgres` in `DATABASE_URL` and `redis` in `REDIS_URL`.
3. Re-run the script after saving `.env`.

First deployment:

```powershell
pwsh -File scripts/install.ps1
```

Daily startup:

```powershell
pwsh -File scripts/start.ps1
```

Force rebuild on startup:

```powershell
pwsh -File scripts/start.ps1 -Rebuild
```

What the scripts do:

- `scripts/install.ps1`: checks Docker, waits for `postgres` and `redis`, runs migrations, runs seed data, then starts `web` and `worker`.
- `scripts/start.ps1`: checks Docker, then runs `docker compose up -d` or `docker compose up -d --build`.

### Option A: host-run app, Docker-run Postgres and Redis

Use this when you want `pnpm dev` hot reload.

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

### Option B: full Docker Compose startup

Use this when you want `web + worker + postgres + redis` running together.

```bash
cp .env.example .env
docker compose up -d postgres redis
docker compose run --rm web pnpm db:migrate
docker compose run --rm web pnpm db:seed
docker compose up -d web worker
```

If you need a rebuild:

```bash
docker compose up -d --build
```

## Upgrade note for existing projects

If you are upgrading an existing instance to the asset-center version, run migrations first and then run the backfill script:

```bash
pnpm tsx scripts/backfill-asset-center.ts
```

Run it twice if you want to confirm idempotence. The second run should report no newly created assets or bindings.

## Docker layout

`docker-compose.yml` defines:

- services: `web`, `worker`, `postgres`, `redis`
- named volumes: `pg-data`, `redis-data`
- host-mounted storage: `./storage:/app/storage`

`Dockerfile`:

- installs dependencies with `pnpm install --frozen-lockfile`
- builds the app with `pnpm build`
- starts the production server with `pnpm start`

## Worker behavior

The worker is required for all async workflows. If `web` is up but `worker` is not, users can submit jobs but queued work will not progress.

Host run:

```bash
pnpm worker
```

Compose run:

```bash
docker compose up -d worker
```

Current async worker responsibilities include:

- script finalization
- uploaded script parsing
- storyboard generation
- image generation
- video generation

## LAN access setup

To expose the app to other machines on the same network:

1. Find the host LAN IP, for example `192.168.1.50`.
2. Set `APP_URL` to the real URL users should open:

```env
APP_URL=http://192.168.1.50:3000
```

3. Start the app on the host.
4. Allow inbound TCP `3000` in Windows Firewall if needed.
5. Open the app from another device with that URL.

If you use a reverse proxy, `APP_URL` must match the proxy URL instead of the local bind address.

## HTTPS and reverse proxy guidance

When serving LAN Studio over HTTPS, terminate TLS at a reverse proxy and set `APP_URL` to the final HTTPS origin.

Example:

```env
APP_URL=https://studio.lan
```

### Caddy

```caddy
studio.lan {
  tls internal
  reverse_proxy 127.0.0.1:3000
}
```

### Nginx

Generate a certificate:

```bash
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout certs/studio.lan.key \
  -out certs/studio.lan.crt \
  -days 365 \
  -subj "/CN=studio.lan"
```

Minimal server block:

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

## Backup and restore

Back up three things:

- Postgres data in `pg-data`
- Redis persistence in `redis-data`
- uploaded and generated files in `storage/`

Create a backup directory:

```bash
mkdir -p backups
```

### Postgres backup

```bash
docker compose exec -T postgres pg_dump -U postgres ai_short_drama > backups/postgres.sql
```

Restore:

```bash
cat backups/postgres.sql | docker compose exec -T postgres psql -U postgres -d ai_short_drama
```

### Redis backup

```bash
docker compose exec redis redis-cli SAVE
docker volume ls | grep redis-data
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

### Raw `pg-data` volume backup

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

### `storage/` backup

```bash
tar czf backups/storage.tar.gz storage
```

Restore:

```bash
rm -rf storage
mkdir -p storage
tar xzf backups/storage.tar.gz -C .
```

Stop `web` and `worker` before restoring any backup set.

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

Asset-center rollout checks:

```bash
pnpm tsx scripts/backfill-asset-center.ts
pnpm tsx scripts/backfill-asset-center.ts
pnpm playwright test tests/e2e/workflow.spec.ts tests/e2e/full-smoke.spec.ts
```
