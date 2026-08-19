# 变更后测量（任务 8.5）

> 与 `baseline.md`（变更前，提交 c5ca796）逐项对比。测量日期：2026-08-19，WSL2。
> 变更后镜像：`nostalgia-duel-server:edopro-removal-verify`（提交 1a92cc5，干净上下文构建）。

## 磁盘占用对比

| 项目 | 基线 | 变更后 | 降幅 |
| --- | --- | --- | --- |
| 仓库缓存（全新克隆，按生效清单） | 254 MB（含 EDOPro 专用 ~130 MB） | **126 MB**（容器内实测，无任何 edopro 目录） | **-50%** |
| 当前资源发布版本 | 193 MB（含 edopro 树 107 MB） | **87 MB**（无 edopro 树） | **-55%** |
| `evolution_cards.db` | 11 MB | 不存在 | -11 MB |
| 原生 C++ 核心 `core/` | 4.2 MB | 不存在 | -4.2 MB |

主机 `repositories/` 当前仍为 255 MB：其中 `edopro-scripts/`（114 MB）、`edopro-cdbs/`（15 MB）、`edopro-lflists/`（688 KB）为遗留缓存，已登记为任务 9.3 部署清理目标（新清单不再拉取）；`project-ignis-lflists/`（680 KB）为重命名后的新缓存。清理完成后主机仓库占用将与容器内全新克隆一致（≈126 MB）。

## 运行时指标对比（本地生产启动，dist 构建，Postgres/Valkey 由 compose 提供）

| 指标 | 基线 | 变更后 | 降幅 |
| --- | --- | --- | --- |
| 启动时间（🚀 starting → ✅ ready） | ≈1.5 s | **1.02 s**（16:33:16.090 → 16:33:17.110） | **-32%** |
| 空闲 RSS（就绪后 ~90 s，无流量） | ≈257 MB（263128 kB） | **≈162 MB**（166100 kB，容器内 PID 8） | **-37%** |
| 活动端口（`ss -tlnp` / 容器 LISTEN） | HTTP 7922 · Mercury TCP 7711 / WS 4002 · **Host TCP 7911 / WS duel 4001** · WebSocket 4000 | HTTP 7922 · Mercury TCP 7711 / WS 4002 · WebSocket 4000 | EDOPro 7911/4001 已消失 |
| 启动期加载 | EDOPro 禁限卡表 + 标准库 2 库 14988 卡 + 扩展库 15 库 15096 卡 + YGOPro LFLIST 32 张 | 标准库 2 库 14988 卡 + 扩展库 15 库 15096 卡 + **YGOPro 禁限卡表 111 张**（无 EDOPro 加载） | 无 EDOPro 加载路径 |

## 资源刷新（任务 8.5 补充测量）

基线未测量（任务 1.1 按用户决定推迟），此处记录变更后单次刷新成本作为新基线：

| 指标 | 变更后实测 |
| --- | --- |
| 单次刷新耗时（git 同步 + 组装 + 发布） | **≈113 s**（容器日志 16:33:15.324 → 16:35:08.665 `refresh ok`） |
| 单次刷新写入量 | 87 MB（单个新发布版本；GC 按 `RESOURCES_KEEP_RELEASES` 保留最近 N 版） |
| 刷新拉取源 | 8 个 git 源 + 3 个 http 源，全部为 YGOPro 消费者；**无 `edopro-*` 源**，刷新日志无 EDOPro 路径 |

## 干净构建生产镜像对比

| 项目 | 基线 | 变更后 |
| --- | --- | --- |
| 镜像体积 | `evolution:baseline-edopro` **959 MB** | `nostalgia-duel-server:edopro-removal-verify` **718 MB**（-25%） |
| 镜像内容 | 含 CoreIntegrator C++ 编译阶段、原生依赖、EDOPro 资源 | 无原生核心阶段、无 `liblua5.3-dev`/`libsqlite3-dev`/`libevent-dev`、无 EDOPro 资产；YGOPro WASM 核心可用（任务 8.3 已验证） |

## 复现命令

```bash
# 镜像
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep -E 'baseline-edopro|edopro-removal-verify'
# 仓库/发布版本
du -sh repositories/ resources/releases/*/          # 主机（含 9.3 遗留缓存）
docker exec edopro-smoke-server du -sh repositories/ resources/releases/*/   # 干净克隆参照
# 启动时间 / 空闲 RSS
docker logs -t edopro-smoke-server | grep -E 'Evolution server starting|Evolution server ready'
docker exec edopro-smoke-server sh -c 'grep VmRSS /proc/8/status'             # 就绪后 ~90s
# 刷新耗时
docker logs -t edopro-smoke-server | grep -E 'refreshing resources|refresh ok'
```
