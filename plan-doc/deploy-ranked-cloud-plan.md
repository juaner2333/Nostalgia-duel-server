# Plan：带排位 PG 库版本部署腾讯云（形态切换 + 2.0.0 上线）

> 状态：已确认参数 + 云端现状已核实（ssh tencent 只读检查），待执行
>
> 性质：云端部署形态从「无中间件压测形态」切换为「排位 PostgreSQL 形态」，随镜像 2.0.0 一次上线
>
> 本次修订（云端核实后）：① 旧镜像实为 `1.0.7`；② 云端缺 `init.sql`（迁移依赖 uuid-ossp 扩展，缺了必失败）；③ compose ranked 缺少 `SEASON` 环境传递（缺了 `config.season=NaN` 落库损坏）；④ root docker 凭据已存在，401 坑位已消；⑤ 线上正有 2 场 casual 对局在进行，deploy-checked 必然要先等待；⑥ 数据库访问方式已定：compose 补 `127.0.0.1:5432:5432` 宿主回环绑定 + ssh 隧道（§2.1-3），**不开任何公网端口**

## 1. 背景与目标

当前云端（`ssh tencent` → 134.175.22.216）运行的是无 PostgreSQL/Valkey 的压测基线形态（`docker-compose.cloud.yaml`，`USE_REDIS=false` / `RANK_ENABLED=false`）。本版本新增了排位赛季功能与六张排位表（`lightning_rankings`、`unranked_matches`、`unranked_duels`、`user_profiles` 等），需要 PostgreSQL 持久化。

目标：将「带排位 PG 库的版本」部署到云端，从无排位形态平滑切入排位形态，并完成 DB 初始化、迁移与端到端验证。

### 已确认决策

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `BRANCH` | `feat_20260830_ranked-season` | 当前检出分支，执行前先 `git fetch`/`git pull` 与 origin 同步并核对含排位改动 |
| `TAG` | `2.0.0` | git tag = 镜像 tag = 云端 `SERVER_IMAGE` 三对齐 |
| `DEPLOY_MODE` | `deploy-checked` | 推送后先查云端活跃房间，有对局则停下等确认再重启 |
| `POSTGRES_PASSWORD` | 自动生成 | 随机强密码，仅写入云端 root 属主 `.env`（0600），不回显到日志 |
| `POSTGRES_DATA_DIR` | `/opt/nostalgia-duel-server/pgdata` | 宿主绝对路径，首次初始化（云端已核实无既有数据） |
| `SEASON` | `5` | 见 §2.1：compose ranked 当前**未传递 SEASON**，必须补 `SEASON: ${SEASON:-5}` 并在云 `.env` 设置，否则 `config.season=NaN` 落库损坏 |
| 旧镜像（回滚目标） | `1.0.7` | 云端已核实 `SERVER_IMAGE=...:1.0.7`，备份名 `.env.bak-1.0.7` |
| `ADMIN_API_KEY` | 云端现有值 | 不动，复用现有 `.env` |

## 2. 形态差异：排位版 vs 现有云端形态

| 维度 | 现有云端（docker-compose.cloud.yaml） | 排位版（docker-compose.cloud.ranked.yaml） |
| --- | --- | --- |
| 服务 | 仅 `nostalgia-duel-server` | `postgres` + `nostalgia-duel-server` |
| 数据库 | 无 | `postgres:16-alpine`，内部网络 `postgres`（5432 仅绑宿主 `127.0.0.1`，外网经 ssh 隧道访问，不暴露公网） |
| `RANK_ENABLED` | `false`（默认） | `true`（compose 内硬编码） |
| `USE_REDIS` | `false` | `false`（Valkey 不需要；排位/匹配/限流走 PG + 内存） |
| `.env` 必填 | `SERVER_IMAGE`、`ADMIN_API_KEY` | 额外必须 `POSTGRES_PASSWORD`、`POSTGRES_DATA_DIR` |
| 迁移 | 无 | 上线前必须 `npm run migration:run:prod`（TypeORM InitialRankedSchema，大量 `uuid_generate_v4()`，**依赖 init.sql 的 uuid-ossp 扩展**） |
| 启动顺序 | `up -d` 即可 | `postgres healthy` → server 才启动（`depends_on` 带 healthcheck，Compose v5.3.1 支持） |
| 回滚边界 | 换镜像 tag | 整栈形态回滚（见 §6） |

### 2.1 云端已核实的 compose 修订点（本次修订新增）

1. **`docker-compose.cloud.ranked.yaml` 未向容器传递 `SEASON`**：compose `environment` 列表无 `SEASON` 项，`.env` 的值不会进容器 → `config.season = Number(undefined) = NaN`，而 `PlayerStatsPostgresRepository`/`UnrankedMatchSaver` 会直接写 `config.season` 落库，NaN 写库即坏。
   **修订**：compose ranked 文件 environment 补 `SEASON: ${SEASON:-5}`（仓库内小改，需提交；compose 是部署编排文件，不入镜像，无需重建镜像）。
2. **云端部署目录无 `init.sql`**：compose 挂载 `./init.sql:/docker-entrypoint-initdb.d/init.sql:ro`，而 `/opt/nostalgia-duel-server/` 无此文件 → bind mount 会以目录形态挂载，PG 首次初始化不执行扩展 DDL，随后迁移 `CREATE TABLE ... uuid_generate_v4()` 因缺 uuid-ossp 扩展直接失败。
   **修订**：部署前必须 `scp init.sql` 到云端部署目录。
3. **数据库外网访问（用户需求，方案 A：ssh 隧道）**：现阶段只能 `docker exec` 进容器查，用户要能从本机（Windows/WSL）用 psql/DBeaver 直查。postgres 服务补宿主回环绑定：
   ```yaml
   ports:
     - "127.0.0.1:5432:5432"   # 只绑宿主回环，公网不可达，安全组不开 5432
   ```
   用户本地建隧道后连 `127.0.0.1:5432`（用户 `postgres`，库 `nostalgia_duel`，密码为云端 `.env` 的 `POSTGRES_PASSWORD`）：
   ```powershell
   # Windows 宿主机（PowerShell，Win10 1809+ 自带 OpenSSH）
   ssh -N -L 5432:127.0.0.1:5432 ubuntu@134.175.22.216 -i C:\Users\zhuweitian\.ssh\id_ed25519_win
   # 或 WSL 内：
   ssh -N -f -L 5432:127.0.0.1:5432 tencent
   ```
   **影响**：compose 端口映射改动需重建 postgres 容器生效，随排位上线一并执行；迁移/应用连库走 compose 内部网络，不经此绑定，互不影响。

关键点：排位版需要**先迁移 Schema 再启动 server**，因为 `synchronize=false`，表不存在时运行期访问会失败。

## 3. 云端现状（已完成 ssh 只读核实，2026-09-xx）

| 项 | 核实结果 | 对计划的影响 |
| --- | --- | --- |
| 主机 | `VM-0-12-ubuntu`，2 核 / 3.6GiB（可用 2.7Gi），磁盘剩 49G | PG16 内存余量充足，无容量风险 |
| 部署目录 | `/opt/nostalgia-duel-server/`：`docker-compose.cloud.yaml`（与本地一致）、`.env`（root 0600）、`.env.bak-1.0.0~1.0.6` | 备份序列延续：切版前新增 `.env.bak-1.0.7` |
| 当前镜像 | `SERVER_IMAGE=...:1.0.7`，容器 Up 6 天 restarts=0 | 回滚目标/备份名用 1.0.7 |
| 端口 | 706/7922/4000/4002 全部监听；**5432 空闲**；无 postgres 容器/无 pgdata | 全新初始化的排位形态，无既有 DB 数据要保护 |
| **活跃对局** | **2 场进行中**：`1109#404`（别梦寒 vs moon）、`1109#123`（Player 2011 vs 蒋神，3 旁观） | deploy-checked 会命中非空 `/api/rooms`，**必须等对局结束/用户确认后才重启** |
| Docker 凭据 | root 与 ubuntu 的 `~/.docker/config.json` 均含 ccr auth | **401 坑位已消**：`sudo docker pull` 可直接执行，无需同步凭据 |
| Docker/Compose | Docker 29.6.1 / Compose v5.3.1 | 支持 `condition: service_healthy` |
| 资源版本 | `/api/resources/version` 返回 base 5399 / 1103 5198 / 1109 5320，与 lock 一致 | 分支构建应保持一致（以 lock 为准） |
| 缺失文件 | 部署目录**无 `init.sql`**、**无 `docker-compose.cloud.ranked.yaml`** | 4b 必须 scp 两个文件（见 §2.1） |

## 4. 执行流程

### Phase 0 — 本地前置检查（只读）

```bash
cd /personal-vscode-project/Nostalgia-duel-server
git fetch origin && git checkout feat_20260830_ranked-season && git pull
git log --oneline -5                                # 确认包含排位改动
docker info                                         # 本地 daemon 可用
docker login ccr.ccs.tencentyun.com                 # 已登录则 Silent 成功，失败向用户要凭据
ssh tencent 'ls /opt/nostalgia-duel-server'         # 确认部署目录（§3 详情在此做）
```

### Phase 1 — git tag（与镜像 tag 严格对齐）

```bash
git tag 2.0.0 feat_20260830_ranked-season
git push origin 2.0.0
```

### Phase 2 — 本地构建 + 预检

```bash
npm run check:nostalgia-resources       # 与镜像构建同一门禁，先本地绿
docker build -t ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:2.0.0 .
```

**预检容器 A（基础能力，备用端口，避免冲突本地 dev server）：**

```bash
docker run -d --name preflight-2.0.0 \
  -e NODE_ENV=production -e USE_REDIS=false -e RANK_ENABLED=false \
  -e ADMIN_API_KEY=preflight-key -e YGOPRO_PORT=706 -e HTTP_PORT=7922 -e WEBSOCKET_PORT=4000 \
  -p 1706:706 -p 17922:7922 -p 14000:4000 -p 14002:4002 \
  ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:2.0.0
docker logs preflight-2.0.0 | grep -E "integrity verified|[0-9]+ cards|server ready"
curl -s http://127.0.0.1:17922/api/resources/version   # 卡池 5399 / 1103 5198 / 1109 5320 与 lock 一致
SMOKE_PORT=1706 node scripts/smoke-duel.mjs            # 1103/1109 均 SMOKE PASS
docker rm -f preflight-2.0.0
```

**预检容器 B（排位链路，本地临时 postgres，不污染本地 5432）：**

```bash
# 起临时 PG（映射备用端口 15432）与 preflight 容器同网络跑迁移 + 排位冒烟
# 预检容器必须显式 -e SEASON=5（模拟云端 compose 修订后行为，复验 §2.1 缺陷修复）
docker run -d --name preflight-pg -e POSTGRES_PASSWORD=preflight -e POSTGRES_DB=nostalgia_duel \
  -p 15432:5432 postgres:16-alpine
# 等待 pg_isready 后，preflight 容器带 RANK_ENABLED=true / SEASON=5 指向 15432，依次：
#   npm run migration:run:prod    → “Successfully executed 1 migration(s).”
#   排行榜 API scope=season 查询 + node scripts/smoke-ranked-duel.mjs → 排位房 2-0 落库 season 校验
docker rm -f preflight-pg
```

### Phase 3 — 推送镜像（失败则中止，不上线）

```bash
docker push ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:2.0.0
```

### Phase 4 — 云端切换（deploy-checked）

**4a. 查活跃对局，`{"rooms":[]}` 才继续：**

```bash
ssh tencent 'curl -s -m 5 http://127.0.0.1:7922/api/rooms'
# 已核实：执行时线上大概率有 2 场 casual 对局在打（1109#404、1109#123）。
# 非空即停：向用户报告对局清单（房号/玩家/旁观数），等全部结束或用户明确确认后再继续。
# 每场 MATCH 有 300s 时间限制，若持续不断开新局，向用户提示可改 deploy-immediate 或延后切换。
```

**4b. 备份 .env 与上传排位 compose + init.sql（保留旧 cloud.yaml 供形态回滚）：**

```bash
# 前置：仓库内小改 docker-compose.cloud.ranked.yaml（① environment 补 SEASON 传递；② postgres 补 127.0.0.1:5432:5432 绑定，见 §2.1），先提交
ssh tencent 'sudo cp /opt/nostalgia-duel-server/.env /opt/nostalgia-duel-server/.env.bak-1.0.7'
scp docker-compose.cloud.ranked.yaml init.sql tencent:/tmp/ && \
ssh tencent 'sudo cp /tmp/docker-compose.cloud.ranked.yaml /tmp/init.sql /opt/nostalgia-duel-server/'
ssh tencent 'ls -la /opt/nostalgia-duel-server/init.sql /opt/nostalgia-duel-server/docker-compose.cloud.ranked.yaml'  # 必查：init.sql 必须为普通文件而非目录
```

**4c. 更新 .env（root 属主，必须 sudo；只改/增 5 行）：**

```bash
ssh tencent 'sudo sed -i "s#^SERVER_IMAGE=.*#SERVER_IMAGE=ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:2.0.0#" /opt/nostalgia-duel-server/.env'
ssh tencent 'sudo bash -c "PG_PASS=\$(openssl rand -hex 24); echo \"POSTGRES_PASSWORD=\$PG_PASS\" >> /opt/nostalgia-duel-server/.env; echo \"POSTGRES_DATA_DIR=/opt/nostalgia-duel-server/pgdata\" >> /opt/nostalgia-duel-server/.env; echo \"SEASON=5\" >> /opt/nostalgia-duel-server/.env"'
ssh tencent 'sudo grep -E "^(SERVER_IMAGE|POSTGRES_PASSWORD|POSTGRES_DATA_DIR|SEASON)" /opt/nostalgia-duel-server/.env'  # 复查（密码不回显完整值）
ssh tencent 'sudo chmod 600 /opt/nostalgia-duel-server/.env'
```

> POSTGRES_PASSWORD、POSTGRES_DATA_DIR 为 compose 必填（`${VAR:?...}`），缺失时 `up` 直接报错，不会半启动；SEASON 依赖 §2.1 的 compose 修订才能传入容器。

**4d. 切换形态（顺序关键：先停旧栈解放冲突容器名 → 起 PG → 迁移 → 起 server）：**

```bash
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.yaml down'   # 旧栈（容器名 nostalgia-duel-server 冲突，必须先停）
ssh tencent 'sudo mkdir -p /opt/nostalgia-duel-server/pgdata'   # 空目录由 PG 镜像 entrypoint 初始化并 chown
# 凭据已核实存在（root + ubuntu 均有 ccr auth），直接拉取即可；失败才需查 /root/.docker：
ssh tencent 'sudo docker pull ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:2.0.0'
# 启动数据库并等 healthy（depends_on 只影响 server，PG 自身 up 立即返回）
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.ranked.yaml up -d postgres'
ssh tencent 'sudo docker inspect --format "{{.State.Health.Status}}" nostalgia-ranked-postgres'  # healthy
# 执行迁移（此时宿主 706/7922/4000/4002 空闲，run 一次性容器无端口冲突；PG 已在运行则复用）
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.ranked.yaml run --rm nostalgia-duel-server npm run migration:run:prod'
ssh tencent 'sudo docker logs nostalgia-ranked-postgres 2>&1 | grep -iE "migration|created table" | tail -5'  # 抽查六张排位表
# 正式启动 server（depends_on postgres healthy 后才拉起）
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.ranked.yaml up -d'
ssh tencent 'sudo docker ps --format "{{.Names}} {{.Image}} {{.Status}}"'   # 容器 = 2.0.0，PG healthy
```

### Phase 5 — 上线后验证（按清单验，不停留在“起来了”）

```bash
ssh tencent '
  sudo docker logs nostalgia-duel-server --since 3m 2>&1 | grep -E "integrity verified| cards|Postgres connected|ranking ON|server ready"
  ss -tlnp 2>/dev/null | grep -oE ":(706|7922|4000|4002) "
  curl -s -m5 http://127.0.0.1:7922/api/resources/version | python3 -m json.tool
'
# 排位只读 API（排行榜）可用性：
ssh tencent 'curl -s -m5 -H "X-Admin-Key: <ADMIN_API_KEY>" http://127.0.0.1:7922/api/rankings | head -c 400'
# 真实双环境冒烟（ssh 隧道映射备用本地端口；smoke-ranked 默认 TCP 706 + HTTP 707，需显式传 7922 → 本地）：
ssh -N -f -o ServerAliveInterval=30 -L 1706:127.0.0.1:706 -L 17922:127.0.0.1:7922 tencent
SMOKE_PORT=1706 node scripts/smoke-duel.mjs                    # 普通 1103/1109 决斗
SMOKE_PORT=1706 SMOKE_HTTP_PORT=17922 node scripts/smoke-ranked-duel.mjs  # 排位房 2-0 + 积分落库
pkill -f "ssh -N -f .*1706" || true
```

> `smoke-ranked-duel.mjs` 默认 HTTP 端口 707，云端 HTTP 是 7922，必须用 `SMOKE_HTTP_PORT` 显式指向隧道。

## 5. 安全与数据边界

- `POSTGRES_PASSWORD` 由 `openssl rand -hex 24` 生成，只落盘云端 root 0600 `.env`，日志与回显只显示掩码/行存在性。
- `postgres` 容器 5432 仅绑宿主 `127.0.0.1`（§2.1-3），公网不可达，**安全组不开 5432**；外网查询一律经 ssh 隧道（Windows PowerShell 或 WSL 均可建）。
- `pgdata` 不可删除、不可覆盖；回滚不触碰 PG 数据。
- 排位冒烟只跑本地预检容器或经隧道连接的云端，`scripts/smoke-ranked-duel.mjs` 不得直连云生产库。

## 6. 回滚（整栈形态回滚）

排位形态的回滚边界是「整栈形态 + 镜像 tag」，**绝不单独回滚资源文件或删 PG 数据**：

```bash
# 1) 停排位栈（PG 容器与数据保留）
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.ranked.yaml down'
# 2) .env 恢复旧 tag，并移除 RANK_ENABLED/POSTGRES_* 干扰（旧 cloud.yaml 默认 RANK_ENABLED=false）
ssh tencent 'sudo sed -i "s#^SERVER_IMAGE=.*#SERVER_IMAGE=ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<旧TAG>#" /opt/nostalgia-duel-server/.env'
ssh tencent 'sudo sed -i "/^RANK_ENABLED=/d;/^POSTGRES_PASSWORD=/d;/^POSTGRES_DATA_DIR=/d" /opt/nostalgia-duel-server/.env'
# 3) 起旧无排位形态
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.yaml up -d --force-recreate'
# 复验 docker ps / 日志 / smoke-duel
```

代码级回滚（保留排位形态）仅当镜像与 2.0.0 的 migration/schema 完全兼容时才允许，否则一律整栈回滚。

## 7. 风险与注意事项

| 风险 | 缓解 |
| --- | --- |
| 云端 `sudo docker` pull 401 | 已核实 **root 凭据存在**，正常不会触发；若仍 401 再 `cp /home/ubuntu/.docker/config.json /root/.docker/` |
| 云端缺 `init.sql` → bind mount 成目录、uuid-ossp 扩展缺失 → 迁移失败 | 4b 必传 `init.sql` 并 `ls` 复查为普通文件；`pgdata` 为空目录由镜像初始化 DDL |
| compose ranked 未传 `SEASON` → `config.season=NaN` 落库损坏 | §2.1 修订 compose 补 `SEASON: ${SEASON:-5}` + 云 `.env` 设 5；预检容器 B 显式 `-e SEASON=5` 复验 |
| 5432 绑定/隧道问题（未绑 127.0.0.1 误暴露公网、Windows 侧无密钥致隧道失败） | compose 固定写死 `127.0.0.1:5432:5432`；上线后验证 `ss -tlnp` 仅回环监听；隧道需 Windows 侧有 `id_ed25519_win`（已存在） |
| 旧栈容器名与排位栈 `container_name` 冲突 | 4d 顺序保证先 `down` 旧栈再 `up` 新栈 |
| 迁移失败（PG 未 ready / SQL 权限） | `depends_on` healthcheck + 4d 显式等 healthy；迁移失败即停，不上线 |
| 端口 706/7922/4000/4002 被残留进程占用 | Phase 0 核对 `ss -tlnp`；冲突先报告不强行 kill |
| 重启中断在线对局 | `deploy-checked`：先 `curl /api/rooms`，非空则停下等用户确认 |
| 首局性能（WASM 冷加载 ~12s） | 上线后先跑一轮冒烟预热，首小时降低并发预期 |
| 历史资源门禁 | Dockerfile 构建期 `npm run build && npm run check:nostalgia-resources`，门禁失败镜像不产出 |

## 8. 验证命令汇总（本地 + 云端）

```bash
npm run lint
npm run test
npm run check:nostalgia-resources
npm run build
# 预检容器 A：smoke-duel；预检容器 B：migration:run:prod + smoke-ranked（本地临时 PG）
# 云端：smoke-duel + smoke-ranked（ssh 隧道）
# 云端隧道连通性（上线后由用户本机验证，WSL 侧可先行）：
ssh -N -f -L 15432:127.0.0.1:5432 tencent && psql "host=127.0.0.1 port=15432 user=postgres dbname=nostalgia_duel" -c '\dt'
```

## 9. 验收标准

- 云端 `docker ps` 显示 `nostalgia-duel-server:2.0.0` 与 `nostalgia-ranked-postgres`（healthy）。
- 启动日志包含 `integrity verified`、`Postgres connected · ranking ON`、`server ready`；六张排位表均存在。
- `/api/resources/version` 卡池与 lock 一致（base 5399 / 1103 5198 / 1109 5320，以 lock 实际为准）。
- 普通 `smoke-duel` 与排位 `smoke-ranked`（2-0 落库）均 PASS。
- `.env` root 0600，只有 `SERVER_IMAGE`/`POSTGRES_PASSWORD`/`POSTGRES_DATA_DIR`/`SEASON` 变更，其余不动。
- 云端 `ss -tlnp` 确认 5432 仅监听 `127.0.0.1`（公网不可达）；本机 ssh 隧道建通后 psql `\dt` 可查到排位表（users/player_stats/lightning_rankings 等）。

## 10. 备注

- 云端现状已完成 ssh 只读核实（本版 §3），与首次草案的差异均已修订：旧镜像 1.0.7、缺 init.sql、缺 SEASON 传递、401 坑位已消、线上 2 场活跃对局。
- 本计划为只读调研产物；任何部署动作（down/up/pull/迁移/重启）均未执行。
- `docs/ops-runbook-bundled-resources.md`、`docs/duel-command.md` 与 `.agents/skills/deploy-nostalgia-server/SKILL.md` 为既有部署事实来源，本计划只在其上叠加排位形态切换步骤。