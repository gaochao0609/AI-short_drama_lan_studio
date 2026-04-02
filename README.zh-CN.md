# LAN Studio V1

[English](./README.md) | 简体中文

LAN Studio 是一个面向小团队局域网部署的 AI 短剧创作系统。技术栈为 `Next.js + Prisma + Postgres + Redis + BullMQ + 本地文件系统存储`，设计目标是在一台安装了 Docker Desktop 的 Windows 主机上运行，并可被同一局域网内的其他设备访问。

## 技术栈与服务职责

- `web`：Next.js UI 与 API 服务。负责认证、管理后台工具、项目 CRUD、任务轮询和素材下载。
- `worker`：BullMQ 消费进程。负责执行异步生成处理器，并将任务 / 任务步骤状态回写到 Postgres。
- `postgres`：主数据库，存储用户、会话、账号申请、项目、任务、版本和素材。
- `redis`：BullMQ 的后端存储，同时提供 Redis 持久化队列能力。
- `storage/`：宿主机挂载的媒体与缓存目录，由 `web` 和 `worker` 共享。

## 环境变量

运行前先将 `.env.example` 复制为 `.env`，并填写对应值：

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

- `DATABASE_URL`：Prisma / Postgres 连接串。在 Docker Compose 中使用 `postgres` 主机名；如果应用直接运行在宿主机上，请改为 `localhost`。
- `REDIS_URL`：Redis 连接串。在 Docker Compose 中使用 `redis`；如果应用直接运行在宿主机上，请改为 `redis://127.0.0.1:6379`。
- `APP_URL`：应用对外公开访问的地址。这里应填写最终的局域网地址或 HTTPS 地址，而不是仅用于监听的绑定地址。
- `SESSION_SECRET`：至少 32 个字符。修改后会使现有会话失效，因此应有计划地轮换。
- `STORAGE_ROOT`：上传文件、生成素材、导出文件和缓存的文件系统根目录。
- `MAX_UPLOAD_MB`：参考图片上传的最大允许大小。
- `DEFAULT_ADMIN_USERNAME`：初始化种子管理员账号名。
- `DEFAULT_ADMIN_PASSWORD`：初始化种子管理员密码。非测试环境请立即替换为强密码。

## Windows 与 WSL2 建议

在 Windows 10 + Docker Desktop 环境下，建议将仓库和 `storage/` 放在 WSL2 的 Linux 文件系统中，而不是 `D:\...` 这类 NTFS 路径中。

原因：

- WSL2 的 ext4 存储在 bind mount 应用目录时，元数据和大文件性能通常更好。
- 相比 NTFS bind mount，从 WSL2 访问文件时，文件监听和素材 I/O 更稳定。
- NTFS bind mount 可能导致图片 / 视频工作流变慢，并带来偶发的权限边界问题。

推荐做法：

1. 打开一个 WSL2 shell。
2. 将仓库克隆到 Linux 文件系统中，例如 `~/src/lan-studio-v1`。
3. 启用 Docker Desktop 的 WSL 集成。
4. 将 `storage/` 保持在同一个 WSL2 仓库路径下。

如果你仍然将仓库放在 NTFS 上运行，要预期大文件吞吐更慢，文件系统相关摩擦也会更多。

## 本地启动

### 方式 A：应用跑在宿主机，Postgres 和 Redis 跑在 Docker 中

适用于开发阶段，需要 `pnpm dev` 热更新时使用。

```bash
cp .env.example .env
```

将 `.env` 修改为宿主机访问：

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_short_drama`
- `REDIS_URL=redis://127.0.0.1:6379`
- `APP_URL=http://localhost:3000`

然后执行：

```bash
docker compose up -d postgres redis
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

在第二个 shell 中执行：

```bash
pnpm worker
```

启动顺序很重要：

1. 启动 `postgres` 和 `redis`。
2. 执行数据库迁移。
3. 执行种子数据初始化。
4. 启动 `web`。
5. 启动 `worker`。

### 方式 B：使用 Docker Compose 启动全部服务

适用于希望将 `web + worker + postgres + redis` 一起启动时使用。

```bash
cp .env.example .env
```

在 Compose 模式下，`.env` 中应保留服务主机名：

- `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ai_short_drama`
- `REDIS_URL=redis://redis:6379`

先启动数据服务：

```bash
docker compose up -d postgres redis
```

按顺序执行迁移和种子初始化：

```bash
docker compose run --rm web pnpm db:migrate
docker compose run --rm web pnpm db:seed
```

然后启动应用服务：

```bash
docker compose up -d web worker
```

或者在 schema / 数据准备完成后，直接重建并启动所有服务：

```bash
docker compose up -d --build
```

## Docker 布局

`docker-compose.yml` 定义了：

- 服务：`web`、`worker`、`postgres`、`redis`
- 命名卷：`pg-data`、`redis-data`
- 宿主机挂载的媒体存储：`./storage:/app/storage`

`Dockerfile` 的职责：

- 使用 `pnpm install --frozen-lockfile` 安装依赖
- 使用 `pnpm build` 构建应用
- 使用 `pnpm start` 启动生产服务

## Worker 启动

Worker 是独立进程。它负责处理 storyboard、image、video 和 script-finalize 等异步队列任务。

宿主机运行：

```bash
pnpm worker
```

Compose 运行：

```bash
docker compose up -d worker
```

如果 `web` 已经启动但 `worker` 没有启动，用户依然可以提交任务，但队列中的任务不会继续执行。

## 局域网访问配置

如果要让同一局域网中的其他设备访问应用：

1. 找到宿主机的局域网 IP，例如 `192.168.1.50`。
2. 将 `APP_URL` 设置为用户实际访问的地址，例如：

```env
APP_URL=http://192.168.1.50:3000
```

3. 在宿主机上启动应用。
4. 如有需要，在 Windows 防火墙中放行入站 TCP `3000`。
5. 确认其他客户端可以访问 `http://192.168.1.50:3000`。

如果前面还有反向代理，用户应访问反向代理地址，同时 `APP_URL` 也必须与该代理地址一致。

## HTTPS 与反向代理建议

如果要通过 HTTPS 提供 LAN Studio，请在反向代理层终止 TLS，并将 `APP_URL` 设置为最终的 HTTPS 地址。

示例：

```env
APP_URL=https://studio.lan
```

### 使用 Caddy 和内部 CA 签发证书

`Caddyfile` 示例：

```caddy
studio.lan {
  tls internal
  reverse_proxy 127.0.0.1:3000
}
```

说明：

- `tls internal` 会通过 Caddy 的内部 CA 为站点签发本地证书，而不是直接生成站点自签名证书。
- 需要将 Caddy 的根 CA 证书导入到每一台需要信任该站点的局域网客户端中。
- 保持 `APP_URL=https://studio.lan`，这样 cookie 和重定向才会使用正确的源站地址。

### 使用 Nginx 和自签名证书

生成证书：

```bash
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout certs/studio.lan.key \
  -out certs/studio.lan.crt \
  -days 365 \
  -subj "/CN=studio.lan"
```

最小可用的 `nginx.conf` server 块：

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

客户端必须信任该证书或其签发 CA。否则浏览器会报警告，同时 `Secure` Cookie / 重定向行为也可能不可靠。

## 备份与恢复

需要备份三部分：

- `pg-data` 中的 Postgres 数据
- `redis-data` 中的 Redis 持久化数据
- `storage/` 中的生成文件和上传文件

先创建备份目录：

```bash
mkdir -p backups
```

### Postgres 备份与恢复

推荐方式是逻辑导出：

```bash
docker compose exec -T postgres pg_dump -U postgres ai_short_drama > backups/postgres.sql
```

恢复：

```bash
cat backups/postgres.sql | docker compose exec -T postgres psql -U postgres -d ai_short_drama
```

### Redis 备份与恢复

复制原始文件前，先强制 Redis 落一次快照：

```bash
docker compose exec redis redis-cli SAVE
```

找到真实的 Docker 卷名称：

```bash
docker volume ls | grep redis-data
```

备份卷内容：

```bash
docker run --rm \
  -v <actual_redis_volume_name>:/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -lc 'tar czf /backup/redis-data.tar.gz -C /data .'
```

恢复：

```bash
docker compose stop redis
docker run --rm \
  -v <actual_redis_volume_name>:/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -lc 'rm -rf /data/* && tar xzf /backup/redis-data.tar.gz -C /data'
docker compose start redis
```

### 原始 `pg-data` 卷备份与恢复

如果你需要卷级别备份，而不是逻辑 SQL dump，请先停止数据库，再归档数据卷：

```bash
docker compose stop postgres
docker volume ls | grep pg-data
docker run --rm \
  -v <actual_pg_volume_name>:/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -lc 'tar czf /backup/pg-data.tar.gz -C /data .'
docker compose start postgres
```

恢复：

```bash
docker compose stop postgres
docker run --rm \
  -v <actual_pg_volume_name>:/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -lc 'rm -rf /data/* && tar xzf /backup/pg-data.tar.gz -C /data'
docker compose start postgres
```

### `storage/` 备份与恢复

备份：

```bash
tar czf backups/storage.tar.gz storage
```

恢复：

```bash
rm -rf storage
mkdir -p storage
tar xzf backups/storage.tar.gz -C .
```

在恢复任何一组备份前，请先停止 `web` 和 `worker`，避免在替换文件或卷时仍有写入发生。

## 验证命令

常用本地检查命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm playwright test
pnpm build
docker compose ps
docker compose restart web worker
```

针对 Task 15，重点验证命令包括：

```bash
pnpm vitest run tests/unit/admin/tasks-page.test.tsx
pnpm vitest run tests/unit/workers/minimal-task.test.ts
pnpm vitest run tests/integration/workers/queue-concurrency.test.ts
pnpm playwright test tests/e2e/full-smoke.spec.ts
```
