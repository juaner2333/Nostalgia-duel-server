---
name: deploy-nostalgia-server
description: 发布 nostalgia-duel-server：按用户指定分支构建 Docker 镜像并以指定 tag 推送腾讯云 CCR（ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<tag>），再按用户选择（仅推送 / 立即重启 / 先查活跃对局后重启）通过 ssh tencent 部署到云端：排位形态（PostgreSQL + migration 先于 server 启动）部署，并用冒烟与资源版本接口验证；含 401 凭据、端口冲突、回滚等已知坑位处理。用于任何“发版/上线/部署/换 tag 镜像”请求。
---

# Deploy Nostalgia Duel Server（build → push CCR → 云端排位形态部署）

## 输入参数（先向用户确认）

| 参数 | 说明 | 默认 |
|---|---|---|
| `BRANCH` | 构建镜像所用的 git 分支（必须已包含本次改动，且与 origin 同步） | `master` |
| `TAG` | 镜像 tag = git tag（严格对齐，如 `2.0.0`） | 必填 |
| `DEPLOY_MODE` | 上线策略：`build-only`（只构建+预检+推送，不碰线上）/ `deploy-immediate`（推送后立即重启云端）/ `deploy-checked`（推送后先查活跃对局，空闲再重启，**推荐**） | 必填，由用户决定 |

启动时把这三个参数以
`/skill:deploy-nostalgia-server BRANCH=master TAG=2.0.0 MODE=deploy-checked`
或普通对话形式确认清楚；任何一项未确认前不执行 Phase 2 之后的步骤。

## 固定环境事实（常量，不要重新推导）

- 镜像全名模板：`ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG>`
- 云端接入：`ssh tencent`；部署目录 `/opt/nostalgia-duel-server/`。
- **标准部署形态 = 排位形态**：compose 文件 `docker-compose.cloud.ranked.yaml`，含 `postgres`（`nostalgia-ranked-postgres`，`postgres:16-alpine`）与 `nostalgia-duel-server` 两个服务；`RANK_ENABLED=true` / `USE_REDIS=false`；server 通过 `depends_on: postgres: condition: service_healthy` 等待 PG。
- compose 关键环境变量（来自云端 `.env`，root 属主 0600）：`SERVER_IMAGE`（决定拉取版本）、`POSTGRES_PASSWORD`、`POSTGRES_DATA_DIR`、`SEASON`（缺省 `NaN` 落库损坏）、`HTTP_PORT`（当前 **7922**，管理页面/API 端口；以 `.env` 实际值为准）。
- **迁移顺序是硬约束**：server 启动入口带 pending-migration 门禁（`bootstrapPersistence` 检测到未执行迁移直接拒启）。因此必须 **PG healthy → `migration:run:prod` → 再 up server**；`run-migrations.js` 用 `runMigrations()` 执行，输出 `Successfully executed N migration(s)`，N=0 即无待执行迁移（幂等，每次部署都跑）。
- `init.sql`（uuid-ossp 扩展，迁移的 `uuid_generate_v4()` 依赖）必须在部署目录存在且为普通文件；缺了 PG 首次初始化不会建扩展、迁移必失败。
- `duel` 快捷命令（经 `sudo`）：`duel {up|restart|ps|logs|down|rooms}`；本技能统一用 `sudo docker compose -f /opt/nostalgia-duel-server/docker-compose.cloud.ranked.yaml ...`。
- 旧压测形态 `docker-compose.cloud.yaml`（无 PG、`RANK_ENABLED=false`）仍保留在部署目录，仅作形态回滚之用（见 Phase 6）。
- 本地常有 `npm run dev`（ts-node-dev）占住 706/7922/4000/4002——**预检容器必须用备用宿主端口**，绝不能 kill 用户的 dev server。
- 冒烟脚本 `scripts/smoke-duel.mjs` 硬编码连 `127.0.0.1`，对云端验证需先建 ssh 隧道指向备用本地端口。
- 资源门禁：`npm run check:nostalgia-resources`（CI / 镜像构建 / 启动共用同一校验，构建期由 Dockerfile 自动执行）。

## 执行流程

### Phase 0 — 前置检查（只读）

```bash
cd <repo>
git fetch origin
git branch -a                      # 确认分支存在
git checkout <BRANCH> && git pull  # 切到目标分支并同步
git log --oneline -3 <BRANCH>      # 确认分支包含本次改动
docker info                        # 本地 daemon 可用
docker login ccr.ccs.tencentyun.com # 已登录则 Silent 成功；失败需向用户要凭据
ssh tencent 'ls /opt/nostalgia-duel-server'   # 确认部署目录
ssh tencent 'sudo docker ps --format "{{.Names}} {{.Image}} {{.Status}}"'  # 当前线上镜像/容器
ssh tencent 'sudo docker ps --filter name=nostalgia-ranked-postgres --format "{{.Names}} {{.Status}}"'  # PG 是否在运行（后续 4e 依据）
ssh tencent 'sudo grep -E "^(SERVER_IMAGE|HTTP_PORT)" /opt/nostalgia-duel-server/.env'  # 旧 TAG 与 HTTP 端口
```

### Phase 1 — git tag（与镜像 tag 严格对齐）

```bash
git tag --list | grep -E "<TAG 前段>"     # 查现有风格
git tag <TAG> <BRANCH>
git push origin <TAG>
```

### Phase 2 — 本地构建 + 用该镜像预检

```bash
npm run check:nostalgia-resources       # 与镜像构建同一门禁，先本地绿
docker build -t ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG> .
# 预检容器（备用端口，避免与本地 dev server 冲突）：
docker run -d --name preflight-<TAG> \
  -e NODE_ENV=production -e USE_REDIS=false -e RANK_ENABLED=false \
  -e ADMIN_API_KEY=preflight-key -e YGOPRO_PORT=706 -e HTTP_PORT=7922 -e WEBSOCKET_PORT=4000 \
  -p 1706:706 -p 17922:7922 -p 14000:4000 -p 14002:4002 \
  ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG>
docker logs preflight-<TAG> | grep -E "integrity verified|<预期卡数> cards|server ready"
curl -s http://127.0.0.1:17922/api/resources/version   # 核对卡池数量与 lock 一致
SMOKE_PORT=1706 node scripts/smoke-duel.mjs            # 1103/1109 均须 SMOKE PASS
docker rm -f preflight-<TAG>
```

> 卡数预期值：base=5399、1103=5198、1109=5320；后续发版以 `lock.json`/`/api/resources/version` 实际为准，不要照抄旧数字。
> 排位链路预检（可选）：本地临时 PG 挂 `init.sql` → 迁移 → `RANK_ENABLED=true / SEASON=5` 容器指向它 → `smoke-ranked-duel.mjs`；若脚本 MATCH_END 等待超时，以服务端日志 `Successfully persisted ranked match` + 排行榜 API 判定。

### Phase 3 — 推送镜像（失败则中止，不上线）

```bash
docker push ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG>
```

### Phase 4 — 远程部署（排位形态，仅当 `DEPLOY_MODE != build-only`）

**4a. 若 `DEPLOY_MODE = deploy-checked`：先查活跃对局，有对局则停下等空闲/询问用户。**

```bash
HTTP_PORT_VAL=$(ssh tencent 'sudo grep ^HTTP_PORT /opt/nostalgia-duel-server/.env | cut -d= -f2')
ssh tencent "curl -s -m 5 http://127.0.0.1:${HTTP_PORT_VAL}/api/rooms"
# {"rooms":[]} 才继续；有对局时向用户报告并等待确认再重启
```

**4b. 备份并更新 `.env`（root 属主，必须 sudo）：**

```bash
ssh tencent 'sudo cp /opt/nostalgia-duel-server/.env /opt/nostalgia-duel-server/.env.bak-<旧TAG>'
ssh tencent 'sudo sed -i "s#^SERVER_IMAGE=.*#SERVER_IMAGE=ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG>#" /opt/nostalgia-duel-server/.env'
ssh tencent 'sudo grep "^SERVER_IMAGE" /opt/nostalgia-duel-server/.env'   # 复查
```

**4c. 核对部署必需文件（新机器/首次排位部署必查；已存在则跳过）：**

```bash
ssh tencent 'ls -l /opt/nostalgia-duel-server/docker-compose.cloud.ranked.yaml /opt/nostalgia-duel-server/init.sql'  # init.sql 必须为普通文件而非目录
# 任一缺失：从仓库 scp 上去
cd <repo> && scp docker-compose.cloud.ranked.yaml init.sql tencent:/tmp/
ssh tencent 'sudo cp /tmp/docker-compose.cloud.ranked.yaml /tmp/init.sql /opt/nostalgia-duel-server/'
```

**4d. 已知坑位：云端 `sudo docker pull` 401（已核实当前 root 凭据存在，触发才修）。**

若 401，把 `ubuntu` 用户的 registry 凭据同步给 root：

```bash
ssh tencent 'sudo mkdir -p /root/.docker && sudo cp /home/ubuntu/.docker/config.json /root/.docker/config.json && sudo chmod 600 /root/.docker/config.json'
```

**4e. 启动 PostgreSQL（若未运行）并等 healthy —— 幂等，重复执行安全：**

```bash
PG_RUNNING=$(ssh tencent 'sudo docker ps --filter name=nostalgia-ranked-postgres --format "{{.Status}}"')
if [ -z "$PG_RUNNING" ]; then
  ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.ranked.yaml up -d postgres'
fi
# 无论如何都等到 healthy（首次初始化含 init.sql 建 uuid-ossp）
ssh tencent 'for i in $(seq 1 30); do h=$(sudo docker inspect --format "{{.State.Health.Status}}" nostalgia-ranked-postgres 2>/dev/null); [ "$h" = "healthy" ] && break; sleep 3; done; echo "PG health: $h"'
# 抽查扩展（首启机器验证 init.sql 生效）：
ssh tencent 'sudo docker exec nostalgia-ranked-postgres psql -U postgres -d nostalgia_duel -c "SELECT extname FROM pg_extension WHERE extname='"'"'uuid-ossp'"'"';"'
```

**4f. 执行迁移（幂等：只跑 pending，N=0 即无待执行迁移）—— 必须在启动 server 之前：**

```bash
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.ranked.yaml run --rm nostalgia-duel-server npm run migration:run:prod 2>&1 | tail -3'
# 输出 "Successfully executed N migration(s)."，N=0 则跳过说明；失败即停，不上线
```

**4g. 拉取新镜像并重建 server（`depends_on` 会自动等待 PG healthy）：**

```bash
ssh tencent 'sudo docker pull ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG>'   # 401 时先执行 4d
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.ranked.yaml up -d'
ssh tencent 'sudo docker ps --format "{{.Names}} {{.Image}} {{.Status}}"'   # server 容器 = <TAG>，PG healthy
```

### Phase 5 — 上线后验证（不停留在“起来了”，要按清单验）

```bash
HTTP_PORT_VAL=$(ssh tencent 'sudo grep ^HTTP_PORT /opt/nostalgia-duel-server/.env | cut -d= -f2')
ssh tencent "
  sudo docker logs nostalgia-duel-server --since 3m 2>&1 | grep -E 'integrity verified| cards|Postgres connected|ranking ON|server ready'
  ss -tln 2>/dev/null | grep -oE ':(706|${HTTP_PORT_VAL}|4000|4002|5432) '
  curl -s -m5 http://127.0.0.1:${HTTP_PORT_VAL}/api/resources/version | python3 -m json.tool
  ss -tln 2>/dev/null | grep ':5432 ' | awk '{print \$4}'   # 必须仅 127.0.0.1:5432
"
# 排位只读 API（排行榜）可用性：
ssh tencent "curl -s -m5 'http://127.0.0.1:${HTTP_PORT_VAL}/api/leaderboards/1103?scope=overall' | head -c 200"
# 真实双环境冒烟（隧道，本地端口被 dev 占用时用备用端口）：
ssh -N -f -o ServerAliveInterval=30 -L 1706:127.0.0.1:706 tencent
SMOKE_PORT=1706 node scripts/smoke-duel.mjs        # 1103/1109 均 SMOKE PASS
pkill -f "ssh -N -f .*1706" || true                # 关闭隧道
# 排位冒烟注意：smoke-ranked-duel.mjs 的 MATCH_END 等待与服务端消息分发存在已知差异；
# 若超时，以服务端日志 "Successfully persisted ranked match" + 排行榜 API 数据为准判定。
```

### Phase 6 — 失败/回滚

任一环节失败（构建门禁拒、push 失败、pull 401 未解决、启动拒启、迁移失败、冒烟失败）：
- 未部署：直接修/中止，`deploy-immediate` 模式下告知用户未触碰线上。
- 已部署：先切回旧镜像（镜像 tag = 版本回滚边界；**绝不**单独回滚资源文件）：

```bash
# 排位形态内回滚（保留 PG 数据）：切回旧镜像重建即可
ssh tencent 'sudo sed -i "s#^SERVER_IMAGE=.*#SERVER_IMAGE=ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<旧TAG>#" /opt/nostalgia-duel-server/.env'
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.ranked.yaml up -d'
# 全栈形态回滚（回到无 PG 压测形态，仅在迁移/新 schema 不兼容时才需要）：
#   docker compose -f docker-compose.cloud.ranked.yaml down        （PG 容器/数据保留）
#   .env 恢复旧 SERVER_IMAGE 并删 RANK_ENABLED/POSTGRES_*/SEASON 相关行
#   docker compose -f docker-compose.cloud.yaml up -d --force-recreate
# 复验 docker ps / 日志 / 冒烟
```

## 关键红线

- **tag 三对齐**：git tag = 镜像 tag = 云端 `SERVER_IMAGE`，任何一处不一致都不得上线。
- **迁移先于 server 启动**：server 有 pending-migration 门禁，未迁移直接拒启；`migration:run:prod` 幂等，每次部署都执行（N=0 则无变化）。
- **PG 先于迁移**：`up -d postgres` 且 healthy 后再跑迁移；PG 未初始化时 `init.sql`（uuid-ossp）必须在部署目录。
- **构建源必须是指定分支的最新同步树**，禁止从本地旧分支/脏工作区构建。
- 不做在线玩家“无感重启”承诺：重启会中断对局，`deploy-checked` 必须查房间清单。
- 云端改动必经 `sudo`；`.env` 只动 `SERVER_IMAGE` 一行（HTTP_PORT 等端口变更属独立操作，需用户确认）。
- 凭据同步需用户知悉；不要把 registry 密码回显在日志。
- 参考文档：`docs/ops-runbook-bundled-resources.md`（版本模型/回滚边界）、`docs/duel-command.md`、`plan-doc/deploy-ranked-cloud-plan.md`（排位形态切换实操记录）。