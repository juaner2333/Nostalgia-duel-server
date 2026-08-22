# Nostalgia-duel-server 压测报告

**目标**：评估 Nostalgia-duel-server 在 2 核 / 4G 内存 / 5Mbps 云主机（**不启用 PostgreSQL 与 Valkey/Redis**）上的容量上限，核心指标为**同时进行中对局数**。

**结论摘要**：

| 指标 | 推荐值 | 说明 |
| --- | --- | --- |
| 稳态并发对局 | **24-32 场** | 安全上限约 40 场；56 场出现开局超时（5/56 FAIL） |
| 同时在线连接 | **5000+**（实测通过） | marginal RSS 11MB/千连接，10000 按线性外推可行 |
| 单场边际内存 | **~30MB/场** | 原静态估算 150-300MB/场明显保守 |
| 主要风险点 | **开局 WASM 初始化 CPU 突发** | 40+ 场同时开局突发 3-3.6 核，2 核下开局排队 |
| 带宽 5Mbps | 非瓶颈 | 静态估算 20-30 场并发对局远不会饱和（建议部署后实测确认） |

---

## 1. 测试目标

1. 确定 2C4G 云主机（无 PG/Redis）上的**稳态并发对局数上限**
2. 验证同时在线连接数能力
3. 验证长时间运行稳定性与内存泄漏
4. 校准每场决斗的实际资源消耗（marginal RSS / CPU 需求）

## 2. 测试环境与方法

### 2.1 部署形态（与被测目标一致）

- **服务器**：Docker 容器（`nostalgia-duel-server:latest`，现有 Dockerfile 构建，含完整资源 lock 校验），`--memory=4g` 限制内存
- **环境变量**：`USE_REDIS=false`、`RANK_ENABLED=false`、`RATE_LIMIT_ENABLED=false`（无 PG/Redis，与云主机部署形态一致）
- **固定资源**：仓库内 `nostalgia-resources/`（1103/1109 双环境，5120 卡）
- **压测生成器**：宿主机运行（12 核机器，生成器负载 <1 核）

### 2.2 工具

`scripts/load-test-duel.mjs`（本次交付，与 `scripts/smoke-duel.mjs` 同源线协议构造，驱动真实服务器完整流程）：

- **duel 模式**：并发 N 个房间（每房 host+guest），走真实链路 join → 卡组校验 → READY → DUEL_START → RPS → 真实 ocgcore WASM MSG_START → hold 30s → 投降 → MATCH_END
- **churn 模式**：持续建房→决斗→投降循环，验证稳定性与泄漏
- **idle 模式**：N 个挂机连接（仅 PlayerInfo），验证在线能力
- **采样**：`docker exec` 直读容器内主进程 `/proc/<pid>`（VmRSS / Threads / CPU 时间 / fd），每秒一次

### 2.3 通过标准

100% 房间完成全流程；avg CPU 需求 < 配额×80%；max RSS < 3.2G；无 OOM/重启；churn 无内存泄漏。

## 3. 执行环境限制与处理

本地压测环境为 WSL2 + Docker Desktop，实测发现两项限制（已写入 `docs/capacity-load-test-plan.md`）：

1. **`--cpus=2` 不生效**：8 线程×3s CPU 密集任务在 `--cpus=0.5` 下仍 3.6s 完成（预期 24s），容器 `nproc=12` 使用全部宿主核。WSL2 backend 不执行 cgroup cpu.max。
   → **处理**：CPU 改用**外推法**——采样进程 CPU 时间（绝对值，不依赖核数），按 2 核配额判定（avg < 1.6 核）。
2. **`docker stats` CPU% 失真**：决斗进行中显示 0.00%。
   → **处理**：弃用 docker stats，`docker exec` 直读容器内 `/proc/<pid>/stat`（主进程 comm=`MainThread`，脚本自动解析 PID）。

> 说明：内存限制 `--memory=4g` 在 WSL2 下**生效**，RSS 数据可信；CPU 数据为进程 CPU 需求（外推法），云主机真实 vCPU 突发能力可能弱于本地，需部署后小规模确认。

## 4. 测试结果

### 4.1 并发对局阶梯（duel 模式，hold 30s，每房 host+guest，1103+1109 双格式）

| 并发对局数 | 结果 | join→MSG_START p50/p95 | avg CPU 需求 | max CPU 突发 | max RSS | 线程数 | max fds | marginal/场 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | PASS | 3.1s / 3.2s | 0.12-0.21 核 | 204% | 578-756MB | 20-28 | 75-124 | 29-41MB |
| 16 | PASS | — | 0.34 核 | 204% | 1127MB | 36 | 173 | 29MB |
| 24 | PASS | 6.8s / 7.6s | 0.33-0.44 核 | 224% | 1250-1508MB | 36-44 | 177-221 | 29-35MB |
| 32 | PASS | — | 0.44 核 | 237% | 1508MB | 44 | 221 | 28MB |
| 40 | PASS | — | 0.58 核 | 299% | 1962MB | 52 | 271 | 35MB |
| 48 | PASS | — | 0.57 核 | 219% | 2360MB | 60 | 319 | 27MB |
| **56** | **FAIL 5/56** | — | 0.73 核 | 359% | 2762MB | 68 | 366 | 33MB |

**读表要点**：

- 所有档位（除 56 场）**100% 完成**，无卡组校验失败、无 OOM、无判平
- avg CPU 需求增长平缓：8→56 场仅 0.12→0.73 核（事件驱动模型验证：引擎大部分时间等待玩家响应）
- **56 场失败模式**：5 个房间 MSG_START 15s 超时——56 场同时开局 WASM 初始化，CPU 突发达 3.59 核（2 核预算的 1.8 倍），开局排队导致超时
- max RSS 含连续测试的基线累积（V8 堆不完全释放），单场 marginal 稳定在 **27-35MB**

### 4.2 延迟特征

| 阶段 | 8 场并发 | 24 场并发 |
| --- | --- | --- |
| join（连接+准入） | p50=302ms / p95=351ms | p50=303ms / p95=350ms |
| join→DUEL_START | p50=1504ms / p95=1600ms | p50=1504ms / p95=1601ms |
| join→MSG_START | p50=3149ms / p95=3199ms | p50=6779ms / p95=7621ms |

- join 延迟不随并发增长（事件循环健康）
- **MSG_START 延迟随并发线性增长**（WASM 初始化 CPU 密集，2 核预算下 24 场时 ~6.8s、56 场时超 15s 超时）——这是"同时进行中对局数"的第一约束

### 4.3 冷启动观察

容器首次启动后立即压测：join→MSG_START 约 12s（资源冷加载 + WASM 首次编译）；预热一轮后稳定在 3s（8 场时）。**生产部署建议启动后先预热**（空跑一轮或降低首小时并发预期）。

### 4.4 稳定性（churn 模式，180s，并发窗口 8）

- **539 场完成、0 失败**（约 3 场/秒吞吐）
- avg CPU 0.79 核、max 195%（快速建房/投降是 CPU 密集场景，无 hold 空闲稀释）
- **泄漏检查 OK**：前/后 91s 平均 RSS 1342MB → 1362MB（+20MB，<200MB 阈值）
- max threads 25（决斗结束后 worker 正确回收，无线程泄漏）

### 4.5 在线连接（idle 模式，5000 连接，hold 20s）

- **5000/5000 存活**，0 失败
- marginal RSS **11MB/千连接**（~11KB/连接）
- max fds 5047（单连接 1 fd，符合预期；云主机需 `ulimit -n` ≥ 连接数）
- avg CPU 7.8%（挂机连接开销极小）

### 4.6 带宽评估（静态，未实测）

5Mbps ≈ 625KB/s 双向。单局流量特征：操作帧 10-500B、全场刷新 ~2KB、整局含录像 ~50-500KB。按 30 场并发、每场平均每秒 2-5KB（操作+刷新），总需求 <150KB/s，**远未饱和**；大量观战或录像下载场景才需关注。建议云主机部署后用 `nload`/`iftop` 实测确认。

## 5. 结论与运营建议

### 5.1 推荐运营上限（2C4G，无 PG/Redis）

- **稳态并发对局：24-32 场**（12-16 房 × 双格式），安全上限 ~40 场
- **同时在线：5000+**（大厅+观战）
- 超出 40 场后：开局延迟线性恶化，56 场时已出现 15s 超时判平风险

### 5.2 风险与缓解

| 风险 | 表现 | 缓解 |
| --- | --- | --- |
| 开局 WASM 初始化突发 | 大量玩家同时开局时 MSG_START 延迟飙升 | 限流建房节奏；开局错峰；观察 `max CPU 突发` |
| 连续测试内存基线累积 | V8 堆不完全释放 | 关注 churn 泄漏检查；定期重启（如每日） |
| 无 PG/Redis 的链路缺失 | WS ticket 握手被拒，匹配链路不可用 | 仅支持 TCP 直连场景；如需匹配需部署 Valkey |
| Windbot/AI 对局 | CPU 需求 ×10-30 | 2 核下 AI 对局上限约 3-8 场，需单独压测 |

### 5.3 云主机确认步骤

本地模拟结果作为数量级参考（本地调度宽裕，结果略偏高）。部署后执行：

```bash
# 裸进程采样（云主机）：
node scripts/load-test-duel.mjs --mode duel --rooms 4 --hold-ms 60000 --pid <server_pid>
node scripts/load-test-duel.mjs --mode duel --rooms 8 --hold-ms 60000 --pid <server_pid>
node scripts/load-test-duel.mjs --mode duel --rooms 12 --hold-ms 60000 --pid <server_pid>
# 公网生成器（另一台机器）加 --host <云主机IP>
```

云主机系统参数：`ulimit -n 65535`（systemd `LimitNOFILE`）、`net.core.somaxconn=1024`、`net.ipv4.tcp_tw_reuse=1`。

## 6. 环境与工具说明

- 本报告数据采集于本地 WSL2/Docker Desktop（宿主 12 核/8G），Docker 镜像 `nostalgia-duel-server:latest`（含 `check:nostalgia-resources` 校验）
- 测试脚本：`scripts/load-test-duel.mjs`（duel/churn/idle 三模式；`--docker`/`--pid` 采样；CSV 输出 `/tmp/load-test-*.csv`）
- 完整方法与复现命令见 `docs/capacity-load-test-plan.md`

## 7. 云主机实测确认（2026-08-22）

### 7.1 实测环境

- **腾讯云 CVM**：2 vCPU / 3.6GiB 内存（`nproc=2`），Docker 部署（镜像 `nostalgia-duel-server:1.0.0`，容器名 `evolutionygo-server`，端口 706/4000/4002/7922），**未启用 PG/Redis**
- **压测生成器**：本地 WSL 经公网 `--host 134.175.22.216 --port 706`；服务器侧独立采样循环直读容器主进程宿主 `/proc/<pid>`（与脚本 `--docker` 模式同源）
- **基线**：空闲 RSS ~198MB / 12 线程

### 7.2 并发对局阶梯（duel 模式，hold 60s，双格式）

| rooms | 并发场数 | 结果 | join→MSG_START p95 | max RSS | 线程数 | max CPU 突发 | 非零帧 avg CPU |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 8 | PASS | 3.3s | 1008MB | 20 | 202% | 40.5% |
| 8 | 16 | PASS | 5.9s | — | 28 | — | — |
| 12 | 24 | PASS | 7.4-7.9s | 1490MB | 36 | — | — |
| 16 | 32 | PASS | 9.1s | — | — | — | — |
| 20 | 40 | PASS | 13.5-14.4s | 2003MB | 52 | 205% | 72.6% |
| 24 | 48 | PASS | 14.6s（个别 >15s） | — | — | — | — |
| **28** | **56** | **FAIL 3-6/56** | **>15s 超时** | 2319MB | 65 | 206% | 72.5% |

- 与本地 Docker 模拟**高度一致**：墙位同为 40 场安全 / 48 场边缘 / 56 场开局 MSG_START 超时；marginal RSS ~25-29MB/场（本地 27-35MB）
- max CPU 突发 205-206%：2 核在 40+ 场同时开局时打满，是并发上限的第一约束
- join 延迟不随并发增长（p50≈300ms 为公网 RTT+处理，本地 302ms 一致）

### 7.3 稳定性（churn，并发窗口 8=16 场）

- 180s：**483/484 完成**；300s：**804/805 完成**（两次）
- 每次恰有 1 场 guest join 超时，**服务器日志无该连接准入记录**（0 帧）——为压测客户端（WSL 公网）连接建立偶发失败，非服务器拒绝；服务器侧零拒绝
- avg CPU **1.15 核**（快速建房/投降为 CPU 密集场景），无 OOM/判平
- **泄漏检查 OK**：churn 窗口前/后 60s 平均 RSS 1068MB → 1059MB（-9.4MB，<200MB 阈值）
- 服务器日志存在 71 次 `Error while advancing ocgcore`（`OCGCore disposed` 后的 pending advance 触发），被 `handleAdvanceError` 捕获，未影响任何房间完成；属快速关房竞态，建议后续排查

### 7.4 在线连接（idle）

- **服务器侧能力 ≥3000**：服务器本机（prlimit 提升后）经公网 IP 自连 3000/3000 全通并保持
- **压测客户端（WSL）是瓶颈**：5000 并发仅 ~45% 存活（WSL NAT 并发限制），非服务器问题
- **部署参数发现**：容器内 `ulimit -n` 默认 **1024**（远低于计划要求的 65535），已用 `prlimit --pid <宿主PID> --nofile=65535:65535` 临时提升生效；**需固化到部署配置**（`docker run --ulimit nofile=65535:65535` 或 compose `ulimits:`），否则在线连接上限约 1000

### 7.5 云主机结论

- **稳态并发对局：24-32 场**（安全上限 ~40 场），与本地模拟结论一致，无需修正
- **在线连接**：容器 `ulimit -n` 提升后 ≥3000（受客户端测试能力限制未测更高），建议按计划固化 65535 后复测 5000+
- 部署配置需补充：`ulimits: nofile 65535`（compose）或 `--ulimit nofile=65535:65535`（docker run）
