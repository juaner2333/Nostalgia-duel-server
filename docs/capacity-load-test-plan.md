# 2C4G 5Mbps 容量评估与压测方案（Docker 模拟版）

## 摘要

目标：评估 Nostalgia-duel-server 在 2 核 4G 5Mbps 云主机（无 PostgreSQL/Valkey）上的容量上限，核心指标为**同时进行中对局数**。压测执行环境采用**本地 Docker 模拟云环境**（`--cpus=2 --memory=4g` + 可选 tc 带宽限速），先本地摸清数量级，云主机部署后再做小规模确认。

**Docker 环境组成**：仅启动决斗服务器一个容器（现有 Dockerfile 构建），不使用 docker-compose（绕开其中的 postgres/valkey 服务），`USE_REDIS=false`/`RANK_ENABLED=false` 与云主机目标部署形态一致；压测生成器在宿主机运行。

**交付物**：① 本计划文档；② 压测脚本 `scripts/load-test-duel.mjs`。

架构事实（已探明）：单 Node.js 进程，主线程处理 TCP(706)/YGOPro-WS(4002)/HTTP(7922)/管理 WS(4000)；**每场进行中的决斗独立占用 1 个 worker 线程**（`OCGCore.init()` → yuzuthread `initWorker`，运行 ocgcore WASM + Lua 脚本环境 + 格式卡数据副本，决斗结束才 dispose）；`USE_REDIS=false` 时服务器正常启动（ticket 鉴权 fail-closed、限流失效）；`RANK_ENABLED=false` 时不连 PG、统计订阅自动跳过；匹配队列为纯内存实现；代码无连接数/房间数上限。

## 一、容量估算（静态模型，最终以压测校准）

| 资源项 | 估算消耗 |
| --- | --- |
| 主进程基线 | ~200-300MB RSS（Express/ws/ioredis/pino 均已加载） |
| 每场进行中决斗 | 1 worker 线程：ocgcore WASM（二进制 1.1MB，初始内存 64-128MB 随对局增长）+ Lua 环境（base/script 19MB/4520 脚本）+ 卡数据副本（5120 卡）→ **估 150-300MB/场，实测校准** |
| 单场决斗 CPU | **事件驱动模型**：一次 `process()` 1-50ms 后引擎空闲等待；真人节奏下整场平均 1-3% 单核（WASM 加载+开局 ~0.5-1s 为一次性突发） |
| 空闲 TCP/WS 连接 | ~20-50KB/连接，事件循环仅轻量协议解析；提升 `ulimit -n` 后数万级没问题 |
| 观战者 | 房间内额外 socket + 消息复制（主线程编码 O(消息×客户端数)），约等于一个空闲连接 |

**结论：**

- **CPU 不是墙**：真人节奏下 2 核可稳态支撑 50-100 场并发决斗的处理预算；真正瓶颈在内存
- **内存墙（首要）**：4G − OS ~0.5G − Node 基线 ~0.3G ≈ 3.2G → 按 150-300MB/场，**稳态并发对局 10-20 场，短时峰值 20-25 场**（以压测实测 marginal RSS 校准）
- **同时在线（大厅+观战）：5000-10000**（前提 `ulimit -n` 调大）
- 带宽 5Mbps ≈ 625KB/s 双向：单局流量小（操作帧 10-500B、全场刷新 ~2KB、整局含录像 ~50-500KB），10-20 场并发对局远不会饱和；大量观战/录像下载才吃紧
- **边界条件（显著拉低上限）**：① 启用 Windbot/AI 快打（CPU 需求 ×10-30，2 核只够 3-8 场 AI 对局）② 每房观战过多（主线程编码放大）

**无 PG/Redis 部署影响（必须知悉）**：TCP 直连建房/加入完全正常；WS(4002) 匿名连接正常、带 ticket 握手被拒（fail-closed）→ HTTP 匹配排队→ticket→WS 链路不可用；限流失效；排行/统计自动跳过；匹配队列内存版可运行。

## 一·实测结果（2026-02 本地 Docker 模拟，WSL2/Docker Desktop）

### 环境限制与修正

- `--memory=4g` 在 Docker Desktop（WSL2 backend）下**生效**（MEM 数据正常、OOM 限制有效）。
- `--cpus=2` **不生效**：实验验证 8 线程×3s CPU 密集在 `--cpus=0.5` 下仍 3.6s 完成（预期 24s），容器内 `nproc=12`（全部宿主核）——WSL2 backend 不执行 cgroup cpu.max。
- docker stats 的 CPU% 在 WSL2 下同样失真（负载中显示 0.00%）。
- **修正方案**：内存用容器限制；CPU 用**外推法**——`--docker` 采样改为 `docker exec` 直读容器内主进程 `/proc/<pid>/stat`（进程 CPU 时间不依赖核数），以 `--cpu-cores 2` 判定 avg CPU 需求 < 配额×80%。容器内主进程 comm 为 `MainThread`（PID 8，脚本自动解析）。

### 阶梯数据（duel 模式，hold 30s，每房 host+guest，双格式）

| 并发对局数 | 结果 | avg CPU 需求 | max CPU 突发 | max RSS | 线程数 | marginal/场 |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | PASS | 0.21 核 | 227% | 756MB | 28 | 29MB |
| 16 | PASS | 0.34 核 | 204% | 1127MB | 36 | 29MB |
| 24 | PASS | 0.44 核 | 204% | 1508MB | 44 | 29MB |
| 32 | PASS | 0.44 核 | 237% | 1508MB | 44 | 28MB |
| 40 | PASS | 0.58 核 | 299% | 1962MB | 52 | 35MB |
| 48 | PASS | 0.57 核 | 219% | 2360MB | 60 | 27MB |
| 56 | **FAIL 5/56**（MSG_START 15s 超时） | 0.73 核 | 359% | 2762MB | 68 | 33MB |

### 稳定性与在线连接

- **churn 180s**（并发窗口 8）：539 场完成、0 失败，avg CPU 0.79 核，泄漏检查 OK（RSS 稳定）。
- **idle 5000 连接**：5000/5000 alive，marginal RSS 11MB/千连接，max fds 5047。

### 修正后结论（2C4G，无 PG/Redis）

- **稳态并发对局推荐：24-32 场**（12-16 房×2 格式），安全上限约 40 场；56 场开局突发超时。
- **同时在线：5000 无压力**（11MB/千连接），10000 按线性外推可行（约 +110MB）。
- **主要风险点是开局 WASM 初始化突发**：40+ 场同时开局时突发 3-3.6 核，2 核下开局排队（56 场时 MSG_START 超时）。
- **marginal RSS 实测 28-35MB/场**（原估算 150-300MB 明显保守），内存墙在 ~90 场（3.2G 预算外推）。
- 云主机确认步骤仍需执行（真实 vCPU 突发能力可能弱于本地）。

## 二、压测方案

### 交付物 1：计划文档 `docs/capacity-load-test-plan.md`

本计划（含估算、Docker 模拟命令、执行步骤、通过标准）。

### 交付物 2：压测脚本 `scripts/load-test-duel.mjs`

复用 smoke-duel.mjs 的线协议构造（`buildFrame/playerInfoFrame/joinGameFrame/updateDeckFrame/tryStartFrame/rpsChoiceFrame/orderChoiceFrame/surrenderFrame/buildDeck/connect/waitFor`），**独立复制 helpers 而非重构 smoke-duel.mjs**（既有脚本零改动，注释标注同源），使用仓库内固定资源构造真实卡组、测试侧 socket 驱动真实服务器。

两种模式（均走真实 ocgcore WASM 决斗：join → deck → READY → DUEL_START → RPS → MSG_START）：

1. **`duel` 稳态模式（核心）**：`--rooms N` 并发建 N 个房间（每房 host+guest，roomId 取唯一十进制号；`--spectators` 可每房加观战），全部推进到 MSG_START 后 `--hold-ms`（默认 60000）保持并发，再全部投降、等待 MATCH_END、断开；输出每房各阶段耗时与汇总分位数
2. **`churn` 吞吐/稳定性模式**：`--duration 秒` 内循环建房→决斗→投降→关房（唯一 roomId），`--rooms` 控制并发窗口，验证长时间稳定性与泄漏

参数：`--host`（默认 127.0.0.1）、`--port`（默认 706）、`--formats 1103,1109`、`--pid <pid>`（裸进程，直读 /proc）**或** `--docker <容器名>`（解析 `docker stats`）采样 CPU%/RSS/Threads（docker 模式无线程数），结束打印汇总表（含 **marginal RSS/场** 校准内存墙）并写 CSV 到 `/tmp/load-test-*.csv`。

**通过标准**：100% 房间完成全流程；p95 join→MSG_START < 15s；RSS < 3.2G；CPU 平均 < 80%；无 OOM/进程重启；churn 30min 后 RSS 回落基线（无泄漏）。

### 交付物 3：本地 Docker 模拟环境（复用现有 Dockerfile，无新增文件）

现有 Dockerfile 已含 `npm run build` + `check:nostalgia-resources` lock 校验 + `npm prune --production`，直接构建。**只启动服务器容器，不启动任何其他服务**：

```bash
# 构建（含完整资源 lock 校验）
docker build -t nostalgia-duel-server .

# 模拟 2C4G、无 PG/Redis 运行（单容器，不用 compose，避免拉起 postgres/valkey）
# 注意：WEBSOCKET_PORT 必填（config 无默认值，缺失时 Number(undefined)=NaN 启动失败）
docker run -d --name loadtest-server \
  --cpus=2 --memory=4g --memory-swap=4g \
  -p 706:706 -p 7922:7922 \
  -e NODE_ENV=production -e USE_REDIS=false -e RANK_ENABLED=false \
  -e RATE_LIMIT_ENABLED=false -e YGOPRO_PORT=706 -e HTTP_PORT=7922 -e WEBSOCKET_PORT=4000 \
  nostalgia-duel-server

# 可选：模拟 5Mbps 出口带宽（容器内 tc，需 NET_ADMIN + iproute2；入口限速需 ifb 较复杂，可忽略）
docker exec loadtest-server sh -c "tc qdisc add dev eth0 root tbf rate 5mbit burst 32kbit latency 400ms"
```

资源映射：`--cpus=2` ↔ 2 核（**WSL2/Docker Desktop 下不生效**，见实测章节，改用外推法）；`--memory=4g --memory-swap=4g` ↔ 4G 且禁 swap 放大（生效）；tc tbf ↔ 5Mbps（可选项，带宽非瓶颈）。Node 24 自动感知 cgroup 内存，无需 NODE_OPTIONS。容器内进程采样用 `--docker loadtest-server --cpu-cores 2`（docker exec 直读 /proc，docker stats CPU 在 WSL2 下失真）。

### 执行步骤

1. **本地模拟准备**：构建镜像、启动 loadtest-server、`docker logs` 确认资源校验与端口监听正常、`--rooms 1` 冒烟
2. **基准**：`--rooms 1 --hold-ms 60000`，记录基线 RSS/CPU/Threads
3. **阶梯（找内存墙）**：`--rooms 4/8/12/16/20` 各一轮（hold 60s），记录每档 RSS/Threads/CPU/p95 与 marginal RSS/场，找到失败或 RSS>3.2G/CPU>85% 的档位 → 推荐稳态上限取该档 -1
4. **混合持续**：推荐档 + 每房 1-2 观战 + `churn --duration 1800`，验证 30 分钟稳定性（RSS 回落、无 OOM、无 advance 超时判平）
5. **可选**：带宽模拟开启后重跑阶梯中 1-2 档，`docker stats`/`nload` 观察 5Mbps 是否吃紧；`--mode idle` 测 5000/10000 在线
6. **云主机确认**：部署后仅重跑小阶梯 `--rooms 4/8/12`（公网链路、真实 vCPU），与本地结果比对并给出最终运营上限

**本机实测已完成**（见“一·实测结果”章节）：阶梯 8→56 场、churn 180s、idle 5000 均跑通，推荐稳态 24-32 场并发对局。云主机确认命令：`--mode duel --rooms 4/8/12 --hold-ms 60000 --pid <pid>`（公网用 `--host <ip>`）。

**注意事项**：压测生成器与目标容器同机时，本地机器建议 ≥8 核 16G（生成器 <1 核，干扰可控）；本地模拟结果因调度宽裕**略偏高**，云上确认以实际为准；云主机需 `ulimit -n 65535`（systemd `LimitNOFILE`）、`net.core.somaxconn=1024`、`net.ipv4.tcp_tw_reuse=1`。

### 验证

- 计划文档落盘到 `docs/capacity-load-test-plan.md` 且内容完整
- `node --check scripts/load-test-duel.mjs` + `npm run lint` 通过
- 本地单局冒烟（`--rooms 1`）通过
- Docker 构建通过（内含 `check:nostalgia-resources`）
- 阶梯数据表（各档 RSS/线程/CPU/p95 + marginal RSS/场）产出本地推荐上限
- 混合 30min 无泄漏、无 OOM、无判平
- 云主机小阶梯确认后交付最终结论：稳态并发对局数与同时在线推荐值

## 三、假设与默认值

- 压测以"同时进行中对局数"为核心指标；在线连接数为附加验证
- 无 PG/Redis 运行；压测只走 TCP 直连链路，不涉及 ticket/匹配流程
- 玩家节奏按真人（非 Windbot/AI 快打）估算；若运营有 AI 对局需单独测
- 每 worker 150-300MB 为估算值，以压测实测 marginal RSS 校准
- Docker 模拟结果作为数量级参考，云主机小阶梯确认为最终依据
- 新脚本独立复制 smoke-duel.mjs helpers，不改动既有脚本与生产代码（外科手术式变更）
- 本计划落盘不创建 git 分支、不做提交；分支命名建议 `feat/load-test-duel` 供后续使用
