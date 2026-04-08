# LAN Studio V1

[English](./README.md) | 简体中文

LAN Studio 是一个面向小团队局域网部署的 AI 短剧创作系统。它运行在一台安装了 Docker Desktop 的 Windows 主机上，并支持同一局域网内的其他设备访问。

当前技术栈：

- `Next.js`
- `Prisma`
- `Postgres`
- `Redis`
- `BullMQ`
- 本地文件系统存储

## 当前产品能力

LAN Studio 目前围绕同一个项目工作区提供四段创作流程：

1. `脚本`：发起脚本流程并完成定稿。
2. `分镜`：从选中的剧本资产生成分镜段落。
3. `图片`：支持文生图，也支持基于参考图生成图片。
4. `视频`：基于选中的参考图生成视频。

同时，系统已经提供统一的项目级资产中心，用来集中管理：

- 用户上传的剧本文件
- 用户上传的图片参考素材
- 系统生成的定稿剧本
- 系统生成的图片结果
- 系统生成的视频结果

资产中心现在是工作流输入的默认来源。用户可以先上传和沉淀资产，再将它们绑定为项目默认输入，供分镜、图片和视频流程复用。

## 用户与管理员流程

系统采用“注册申请 + 管理员审批”的账号流：

1. 用户在 `/register-request` 提交注册申请。
2. 管理员在 `/admin/users` 审批申请。
3. 审批通过后，系统生成临时密码。
4. 用户首次登录后会跳转到 `/force-password` 强制修改密码。
5. 修改完成后进入工作台。

当前后台管理页面包括：

- `用户与权限`
- `模型提供方`
- `任务监控`
- `存储管理`

## 工作区结构

当前工作区主要分为三层：

- `工作台首页`：展示概览、最近项目、最近任务和快速创建项目入口。
- `项目详情页`：展示流程摘要、资产概览、任务历史，以及进入各阶段页面的入口。
- `项目资产中心`：集中完成上传、预览、下载、脚本重试解析、删除可删资产，以及设置默认绑定。

当前默认绑定支持：

- 一个分镜默认剧本资产
- 多张图片流程默认参考图
- 多张视频流程默认参考图

流程页仍然允许用户做“本次使用”的临时改选，但项目级默认输入统一由资产中心管理。

## 服务职责

- `web`：Next.js 前端和 API 服务，负责认证、后台管理、项目 CRUD、工作流 API、资产 API 和下载接口。
- `worker`：BullMQ 消费进程，负责脚本定稿、剧本解析、分镜生成、图片生成和视频生成等异步任务。
- `postgres`：主数据库，存储用户、会话、注册申请、项目、版本、任务、绑定关系和资产记录。
- `redis`：BullMQ 队列后端。
- `storage/`：宿主机挂载的文件目录，`web` 和 `worker` 共用。

## 环境变量

运行前先把 `.env.example` 复制为 `.env`，再按实际环境修改：

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

- `DATABASE_URL`：Prisma / Postgres 连接串。Docker Compose 下使用 `postgres`；宿主机直跑时改为 `localhost`。
- `REDIS_URL`：Redis 连接串。Docker Compose 下使用 `redis`；宿主机直跑时改为 `redis://127.0.0.1:6379`。
- `APP_URL`：对外访问地址，用于跳转和 Cookie。这里应填写用户真实访问的局域网或 HTTPS 地址。
- `SESSION_SECRET`：至少 32 个字符。修改后会使现有会话失效。
- `STORAGE_ROOT`：上传文件、生成资产、导出文件和缓存的根目录。
- `MAX_UPLOAD_MB`：资产中心上传大小限制。
- `DEFAULT_ADMIN_USERNAME`：初始化管理员用户名。
- `DEFAULT_ADMIN_PASSWORD`：初始化管理员密码。

## Windows 与 WSL2 建议

在 Windows + Docker Desktop 环境下，建议把仓库和 `storage/` 放在 WSL2 的 Linux 文件系统中，而不是 `D:\...` 这类 NTFS 路径。

原因：

- WSL2 ext4 对 bind mount 更友好，文件访问更快更稳定。
- 文件监听效果更好。
- 大文件和媒体 I/O 的稳定性更高。

推荐做法：

1. 打开 WSL2 shell。
2. 把仓库克隆到 Linux 文件系统，例如 `~/src/lan-studio-v1`。
3. 在 Docker Desktop 中启用 WSL 集成。
4. 把 `storage/` 保持在同一个 WSL2 仓库目录下。

## 本地启动

### Windows 推荐方式：PowerShell 脚本

这两个脚本面向 Windows PowerShell 或 `pwsh`。

首次运行前：

1. 先手动从 `.env.example` 创建 `.env`。
2. 保持 Compose 风格主机名，尤其是 `DATABASE_URL` 里的 `postgres` 和 `REDIS_URL` 里的 `redis`。
3. 保存 `.env` 后再运行脚本。

首次部署：

```powershell
pwsh -File scripts/install.ps1
```

日常启动：

```powershell
pwsh -File scripts/start.ps1
```

强制重建并启动：

```powershell
pwsh -File scripts/start.ps1 -Rebuild
```

脚本行为：

- `scripts/install.ps1`：检查 Docker、等待 `postgres` 和 `redis`、执行迁移、执行种子数据、最后启动 `web` 和 `worker`。
- `scripts/start.ps1`：检查 Docker，然后执行 `docker compose up -d` 或 `docker compose up -d --build`。

### 方式 A：应用跑在宿主机，Postgres 和 Redis 跑在 Docker

适合开发时使用 `pnpm dev` 热更新。

```bash
cp .env.example .env
```

然后把 `.env` 改成宿主机访问方式：

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_short_drama`
- `REDIS_URL=redis://127.0.0.1:6379`
- `APP_URL=http://localhost:3000`

执行：

```bash
docker compose up -d postgres redis
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

第二个终端执行：

```bash
pnpm worker
```

### 方式 B：完整 Docker Compose 启动

适合把 `web + worker + postgres + redis` 一起拉起。

```bash
cp .env.example .env
docker compose up -d postgres redis
docker compose run --rm web pnpm db:migrate
docker compose run --rm web pnpm db:seed
docker compose up -d web worker
```

如果需要重建：

```bash
docker compose up -d --build
```

## 升级到资产中心版本时的说明

如果你是在已有实例上升级到当前资产中心版本，先执行数据库迁移，再执行资产回填脚本：

```bash
pnpm tsx scripts/backfill-asset-center.ts
```

如果你想确认幂等性，可以连续执行两次。第二次应当不再创建新的资产或绑定。

## Docker 布局

`docker-compose.yml` 定义了：

- 服务：`web`、`worker`、`postgres`、`redis`
- 命名卷：`pg-data`、`redis-data`
- 宿主机挂载存储：`./storage:/app/storage`

`Dockerfile` 负责：

- 使用 `pnpm install --frozen-lockfile` 安装依赖
- 使用 `pnpm build` 构建
- 使用 `pnpm start` 启动生产服务

## Worker 行为

Worker 是所有异步流程的必需组件。如果 `web` 启动了但 `worker` 没启动，用户仍然能提交任务，但队列不会继续处理。

宿主机运行：

```bash
pnpm worker
```

Compose 运行：

```bash
docker compose up -d worker
```

当前 worker 主要负责：

- 脚本定稿
- 上传剧本解析
- 分镜生成
- 图片生成
- 视频生成

## 局域网访问配置

如果要让局域网中的其他设备访问系统：

1. 找到宿主机的局域网 IP，例如 `192.168.1.50`。
2. 把 `APP_URL` 改成用户实际访问的地址：

```env
APP_URL=http://192.168.1.50:3000
```

3. 在宿主机上启动服务。
4. 如有需要，在 Windows 防火墙中放行 TCP `3000`。
5. 在其他设备上通过该地址访问。

如果前面还有反向代理，那么 `APP_URL` 应该填写代理对外暴露的地址，而不是本地绑定地址。

## HTTPS 与反向代理

如果通过 HTTPS 提供访问，应当在反向代理层终止 TLS，并将 `APP_URL` 设为最终 HTTPS 地址。

示例：

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

生成证书：

```bash
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout certs/studio.lan.key \
  -out certs/studio.lan.crt \
  -days 365 \
  -subj "/CN=studio.lan"
```

最小 server 配置：

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

## 备份与恢复

建议备份三部分：

- `pg-data` 中的 Postgres 数据
- `redis-data` 中的 Redis 持久化数据
- `storage/` 中的上传和生成文件

先创建备份目录：

```bash
mkdir -p backups
```

### Postgres 备份

```bash
docker compose exec -T postgres pg_dump -U postgres ai_short_drama > backups/postgres.sql
```

恢复：

```bash
cat backups/postgres.sql | docker compose exec -T postgres psql -U postgres -d ai_short_drama
```

### Redis 备份

```bash
docker compose exec redis redis-cli SAVE
docker volume ls | grep redis-data
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

### 原始 `pg-data` 卷备份

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

### `storage/` 备份

```bash
tar czf backups/storage.tar.gz storage
```

恢复：

```bash
rm -rf storage
mkdir -p storage
tar xzf backups/storage.tar.gz -C .
```

恢复任何备份前，请先停止 `web` 和 `worker`。

## 验证命令

常用本地检查：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm playwright test
pnpm build
docker compose ps
docker compose restart web worker
```

资产中心相关的重点检查：

```bash
pnpm tsx scripts/backfill-asset-center.ts
pnpm tsx scripts/backfill-asset-center.ts
pnpm playwright test tests/e2e/workflow.spec.ts tests/e2e/full-smoke.spec.ts
```
