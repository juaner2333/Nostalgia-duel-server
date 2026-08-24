---
name: deploy-nostalgia-server
description: 发布 nostalgia-duel-server：按用户指定分支构建 Docker 镜像并以指定 tag 推送腾讯云 CCR（ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<tag>），再按用户选择（仅推送 / 立即重启 / 先查活跃对局后重启）通过 ssh tencent 部署到云端并用冒烟与资源版本接口验证；含 401 凭据、端口冲突、回滚等已知坑位处理。用于任何“发版/上线/部署/换 tag 镜像”请求。
---

# Deploy Nostalgia Duel Server（build → push CCR → 云端重启）

## 输入参数（先向用户确认）

| 参数 | 说明 | 默认 |
|---|---|---|
| `BRANCH` | 构建镜像所用的 git 分支（必须已包含本次改动，且与 origin 同步） | `master` |
| `TAG` | 镜像 tag = git tag（严格对齐，如 `1.0.2`） | 必填 |
| `DEPLOY_MODE` | 上线策略：`build-only`（只构建+预检+推送，不碰线上）/ `deploy-immediate`（推送后立即重启云端）/ `deploy-checked`（推送后先查活跃对局，空闲再重启，**推荐**） | 必填，由用户决定 |

启动时把这三个参数以
`/skill:deploy-nostalgia-server BRANCH=master TAG=1.0.2 MODE=deploy-checked`
或普通对话形式确认清楚；任何一项未确认前不执行 Phase 2 之后的步骤。

## 固定环境事实（常量，不要重新推导）

- 镜像全名模板：`ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG>`
- 云端接入：`ssh tencent`；部署目录 `/opt/nostalgia-duel-server/`；compose 文件 `docker-compose.cloud.yaml`（镜像直拉形态，仅 server 服务，`USE_REDIS=false` / `RANK_ENABLED=false`）。
- 云端 `.env` 属 root（0600），`SERVER_IMAGE` 决定拉取版本；`ADMIN_API_KEY` 等其余变量不动。
- `duel` 快捷命令（经 `sudo`）：`duel {up|restart|ps|logs|down|rooms}`；本技能统一用 `sudo docker compose -f /opt/nostalgia-duel-server/docker-compose.cloud.yaml ...`。
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
# 确认该分支包含本次改动（示例：以资源修复为例）
git log --oneline -3 <BRANCH>
# 少一步都不行：构建镜像必须来自“已含改动且与 origin 一致”的分支树
docker info                        # 本地 daemon 可用
docker login ccr.ccs.tencentyun.com # 已登录则 Silent 成功；失败需向用户要凭据
ssh tencent 'ls /opt/nostalgia-duel-server'   # 确认部署目录
ssh tencent 'sudo docker ps --format "{{.Names}} {{.Image}} {{.Status}}"'  # 当前线上镜像/容器
```

### Phase 1 — git tag（与镜像 tag 严格对齐）

```bash
git tag --list | grep -E "<TAG 前段>"     # 查现有风格（本仓库当前无 tag，用纯数字风格）
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

> 卡数预期值：资源修复后 base=5399、1103=5198、1109=5320；后续发版以 `lock.json`/`/api/resources/version` 实际为准，不要照抄旧数字。

### Phase 3 — 推送镜像（失败则中止，不上线）

```bash
docker push ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG>
```

### Phase 4 — 远程部署（仅当 `DEPLOY_MODE != build-only`）

**4a. 若 `DEPLOY_MODE = deploy-checked`：先查活跃对局，有对局则停下等空闲/询问用户。**

```bash
ssh tencent 'curl -s -m 5 http://127.0.0.1:7922/api/rooms'
# {"rooms":[]} 才继续；有对局时向用户报告并等待确认再重启
```

**4b. 备份并更新 `.env`（root 属主，必须 sudo）：**

```bash
ssh tencent 'sudo cp /opt/nostalgia-duel-server/.env /opt/nostalgia-duel-server/.env.bak-<旧TAG>'
ssh tencent 'sudo sed -i "s#^SERVER_IMAGE=.*#SERVER_IMAGE=ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG>#" /opt/nostalgia-duel-server/.env'
ssh tencent 'sudo grep "^SERVER_IMAGE" /opt/nostalgia-duel-server/.env'   # 复查
```

**4c. 已知坑位：云端 `sudo docker compose pull` 401。**

`sudo docker`（root）没有 registry 凭据（`/root/.docker` 不存在），但 `ubuntu` 用户的 `~/.docker/config.json` 里有有效的 `ccr.ccs.tencentyun.com` 凭据。修复：

```bash
ssh tencent 'sudo docker pull ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<TAG>'  # 先验证 ubuntu 凭据
# 或直接同步凭据到 root 并重跑 compose pull
ssh tencent 'sudo mkdir -p /root/.docker && sudo cp /home/ubuntu/.docker/config.json /root/.docker/config.json && sudo chmod 600 /root/.docker/config.json'
```

**4d. 拉取并重建（up 默认 pull 策略 missing，镜像已在 daemon 时可省略 pull）：**

```bash
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.yaml up -d --force-recreate'
ssh tencent 'sudo docker ps --format "{{.Names}} {{.Image}} {{.Status}}"'   # 确认容器 = <TAG>
```

### Phase 5 — 上线后验证（不停留在“起来了”，要按清单验）

```bash
ssh tencent '
  sudo docker logs nostalgia-duel-server --since 3m 2>&1 | grep -E "integrity verified| cards|ban lists loaded|server ready"
  ss -tlnp 2>/dev/null | grep -oE ":(706|7922|4000|4002) "
  curl -s -m5 http://127.0.0.1:7922/api/resources/version | python3 -m json.tool
'
# 真实双环境冒烟（隧道，本地端口被 dev 占用时用备用端口）：
ssh -N -f -o ServerAliveInterval=30 -L 1706:127.0.0.1:706 tencent
SMOKE_PORT=1706 node scripts/smoke-duel.mjs        # 1103/1109 均 SMOKE PASS
pkill -f "ssh -N -f .*1706" || true                # 关闭隧道
```

### Phase 6 — 失败/回滚

任一环节失败（构建门禁拒、push 失败、pull 401 未解决、启动拒启、冒烟失败）：
- 未部署：直接修/中止，`deploy-immediate` 模式下告知用户未触碰线上。
- 已部署：切回旧镜像即整版本回滚（镜像 tag = 唯一回滚边界；**绝不**单独回滚资源文件）：

```bash
ssh tencent 'sudo sed -i "s#^SERVER_IMAGE=.*#SERVER_IMAGE=ccr.ccs.tencentyun.com/nostalgia-duel-server/nostalgia-duel-server:<旧TAG>#" /opt/nostalgia-duel-server/.env'
ssh tencent 'cd /opt/nostalgia-duel-server && sudo docker compose -f docker-compose.cloud.yaml up -d --force-recreate'
# 复验 docker ps / 日志 / 冒烟
```

## 关键红线

- **tag 三对齐**：git tag = 镜像 tag = 云端 `SERVER_IMAGE`，任何一处不一致都不得上线。
- **构建源必须是指定分支的最新同步树**，禁止从本地旧分支/脏工作区构建。
- 不做在线玩家“无感重启”承诺：重启会中断对局，`deploy-checked` 必须查房间清单。
- 云端改动必经 `sudo`；`.env` 只动 `SERVER_IMAGE` 一行。
- 凭据同步需用户知悉；不要把 registry 密码回显在日志。
- 参考文档：`docs/ops-runbook-bundled-resources.md`（版本模型/回滚边界）、`docs/duel-command.md`。