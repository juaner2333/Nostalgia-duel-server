# 基线测量（变更前）

> 任务 1.1 / 8.5 对比基准。测量日期：2026-08-18（WSL2，Node v24.3.0，工作区 `Nostalgia-duel-server`）。
> 提交：c5ca796（分支 `feat_20260818_removeEdoPro`）。

## 磁盘占用（已测量）

| 项目 | 路径 | 大小 |
| --- | --- | --- |
| 仓库缓存合计 | `repositories/` | **254 MB** |
| ├ EDOPro 专用 | `repositories/edopro-scripts/` | 114 MB |
| ├ EDOPro 专用 | `repositories/edopro-cdbs/` | 15 MB |
| ├ EDOPro 专用 | `repositories/edopro-lflists/` | 0.7 MB |
| ├ 双用途 | `repositories/evolution-lflists/` | 1.5 MB |
| ├ YGOPro 专用 | `repositories/ygopro-fluorohydride-scripts/` | 70 MB |
| ├ YGOPro 专用 | `repositories/ygopro-moecube-prereleases/` | 25 MB |
| └ 其他 | `repositories/{evolution-assets,custom-cards,ocgcore-worker}` 等 | ~26 MB |
| 当前资源发布版本 | `resources/releases/20260818-005655-578185019/` | **193 MB** |
| ├ EDOPro 资源树 | `.../edopro/` | **107 MB** |
| └ YGOPro 资源树 | `.../ygopro/` | 87 MB |
| 生成 SQLite 数据库 | `evolution_cards.db` | **11 MB** |
| 原生 C++ 核心 | `core/` | **4.2 MB** |

EDOPro 专用磁盘合计（约）：仓库缓存 ~130 MB + 资源树 107 MB + SQLite 11 MB + 原生核心 4.2 MB ≈ **252 MB**。

## 运行时指标（本地生产启动，dist 构建，Postgres/Valkey 由 compose 提供）

| 指标 | 基线值 | 采集方式 |
| --- | --- | --- |
| 启动时间（进程启动 → `✅ Evolution server ready`） | **≈ 1.5 s**（22:43:26.144 → 22:43:27.638） | `node --env-file=.env ./dist/src/index.js` |
| 空闲 RSS（就绪后 ~90 s，无流量） | **≈ 257 MB**（263128 KB） | `ps -o rss= -p <pid>` |
| 活动端口（实际 `ss -tlnp`） | HTTP 7922 · Mercury TCP 7711 / WS 4002 · Host TCP 7911 / WS duel 4001 · WebSocket 4000（另有 Postgres 5432、Valkey 6379 由 compose 提供） | 进程 46282 的全部 LISTEN 套接字 |
| 启动期加载 | EDOPro 禁限卡表 + 标准库 2 库 14988 卡 + 扩展库 15 库 15096 卡 + YGOPro LFLIST 32 张 | 启动日志 |

## 待补测指标

| 指标 | 状态 | 复现命令 |
| --- | --- | --- |
| 单次资源刷新耗时/写入量 | ⏸ 按用户决定推迟 | `time bash scripts/resources-updater.sh` |

## 干净构建生产镜像（已测量）

| 项目 | 基线值 |
| --- | --- |
| 镜像 `evolution:baseline-edopro`（Docker Desktop 29.6.2，Node 24.11 基镜像） | **959 MB** |
| 参照：仓库中既有 `edopro-server-ts-main-server:latest` | 945 MB |
| 备注 | 构建含 4 阶段：资源组装（克隆全部仓库）、CoreIntegrator C++ 编译、npm ci、最终镜像。本地首次因 `resources/current` 符号链接污染上下文失败，已按既有 `*repositories/` 惯例将 `resources/` 加入 `.dockerignore`（镜像内资源始终由 Stage 1 自行组装，不受影响） |

## 复现命令（磁盘部分）

```bash
du -sh repositories/ resources/releases/*/ core/
du -sh repositories/*/ | sort -rh
du -sh resources/releases/*/{edopro,ygopro}/
ls -lh evolution_cards.db
```
