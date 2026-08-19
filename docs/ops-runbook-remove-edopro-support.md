# 运维运行手册：EDOPro 支持移除（remove-edopro-support）

> 对应 OpenSpec 变更 `openspec/changes/remove-edopro-support/`（spec: `ygopro-only-server`）。
> 本文档是 9.2 部署验证、9.3 破坏性清理的唯一执行依据；审批门禁见文末「审批点」。
> 环境基线：WSL2 + Docker Compose，项目 `nostalgia-duel-server`（`docker-compose.prod.yaml`：postgres / valkey / server 三服务）。

## 1. 解析后的明确目标（清理对象）

只有下列**明确解析**的路径/对象可以被删除。禁止把工作区根目录、资源根目录或未解析的环境变量作为递归删除目标（design.md 决策 6）。

### 1.1 仓库缓存（主机 `repositories/`）

| 目录 | 成因 | 删除条件 |
| --- | --- | --- |
| `repositories/edopro-scripts/`（114 MB） | 源 `edopro-scripts` 已从清单删除，无 YGOPro 消费者 | 9.3 审批 |
| `repositories/edopro-cdbs/`（15 MB） | 源 `edopro-cdbs` 已从清单删除，无 YGOPro 消费者 | 9.3 审批 |
| `repositories/edopro-lflists/`（688 KB） | 源 ID 重命名为 `project-ignis-lflists` 后的旧缓存；**不得因上游内容相同而保留** | `repositories/project-ignis-lflists/` 已成功克隆且 world/speed/rush/goat/ocg 映射验证通过（9.3 前置） |

保留：`project-ignis-lflists/`、`evolution-lflists/`、`ygopro-fluorohydride-scripts/`、`ygopro-moecube-prereleases/`、`evolution-assets/`、`custom-cards/`、`ocgcore-worker`、`ygopro-moecube-cards.cdb`、`moecube-lflist.conf`。

### 1.2 旧部署容器与数据卷（本环境实测）

| 对象 | 说明 | 处置 |
| --- | --- | --- |
| 容器 `evolutionygo-server`（镜像 `edopro-server-ts-main-server:latest`，945 MB） | 变更前部署，已停止 47h；其内部保留变更前资源树（含 `edopro/` 目录） | **先保留**：作为回滚参考资产（见 §3）；9.3 审批后删除 |
| 容器 `evolutionygo-postgres` / `evolutionygo-valkey` | 旧 compose 项目（`edopro-server-ts-main`）数据服务，已停止 | 9.3 审批后随旧项目删除 |
| 卷 `edopro-server-ts-main_postgres_data` / `edopro-server-ts-main_valkey_data` | 旧项目数据卷 | 9.3 审批后删除（删除前确认无数据迁移需求） |
| 镜像 `evolution:baseline-edopro`（959 MB） | 变更前基线镜像（任务 1.1 构建） | **先保留**作回滚资产；9.3 审批后可选删除 |
| 镜像 `edopro-server-ts-main-server:latest`（945 MB） | 变更前部署镜像 | 同上 |
| 生成 SQLite `evolution_cards.db` | 已随代码删除不再生成；若部署残留则删除 | 确认无进程占用后删除 |

### 1.3 配置残留

| 对象 | 说明 |
| --- | --- |
| `.env` 中 `HOST_PORT=7911`、`WEBSOCKET_DUEL_PORT`（若存在） | 已从代码移除的 EDOPro 端口配置；部署时清理 `.env`/`docker-compose.prod.yaml` 中残留项 |
| 外部入口（负载均衡/防火墙/域名规则） | 任何指向 EDOPro 端口 `7911`（TCP）/`4001`（WS duel）的映射、健康检查与路由规则 | 

### 1.4 资源发布版本

发布 GC（`RESOURCES_KEEP_RELEASES`）随新版本发布自动淘汰旧版本；升级部署中残留的含 `edopro/` 树的旧发布版本按 9.3 显式移除，仅保留当前生效版本与回滚版本。

## 2. 清理前资产盘点（检查清单，全部通过才允许进入 9.3）

```bash
# ① 新缓存已克隆且映射验证（9.3 硬前置）
ls repositories/project-ignis-lflists/ && ls repositories/edopro-lflists/   # 后者将删
# ② 保留赛制禁限卡表已加载（容器内应看到 edison/tengu/hat/jtp/md/world 等）
curl -s http://127.0.0.1:7922/api/banlists | jq '.ygopro | length'          # = 111
# ③ 生效清单无 edopro
grep -c 'edopro' resources.manifest.json || echo "manifest clean"            # 仅注释/名称可含
# ④ 发布版本无 edopro 目录
ls resources/releases/*/edopro 2>/dev/null && echo "FOUND edopro tree" || echo "clean"
# ⑤ 数据库/核心已消失
ls evolution_cards.db core/ 2>/dev/null || echo "clean"
# ⑥ 端口清单（应只有 YGOPro 端口）
ss -tlnp | grep -E ':(7711|4002|4000|7922)'   # 不应出现 7911 / 4001
```

## 3. 回滚资产（部署第 7 步前有效）

> 本环境实测部署 ID（2026-08-19）：新镜像 `nostalgia-duel-server:edopro-removal-verify`（718 MB），新发布版本主机 `20260819-032626-485581575`（87 MB，容器内 `20260819-163505-155648951`）。

| 资产 | ID / 位置 | 回滚方式 |
| --- | --- | --- |
| 上一版镜像 | `evolution:baseline-edopro`（959 MB）、`edopro-server-ts-main-server:latest`（945 MB） | `docker compose -f docker-compose.prod.yaml up -d --no-deps server` 前将镜像 tag 回退 |
| 上一版资源 | 旧容器 `evolutionygo-server` 内部 `resources/current`（含 `edopro/` 树的 193 MB 版本） | 重启旧容器，或将其 `resources/` 目录导出后把 `resources/current` 软链指回 |
| 旧数据服务 | `evolutionygo-postgres` / `evolutionygo-valkey`（已停止，卷未删） | `docker start` 即恢复 |
| 回滚边界 | **9.3 破坏性清理执行前**：回滚 = 换镜像 + 重指资源 + 恢复入口；**清理执行后**：回滚需重新构建并部署上一版本及其资源（design.md 迁移计划第 8 步） | — |

## 4. YGOPro 健康检查（9.2 部署后、9.3 清理前后各执行一遍）

```bash
# ① 进程与端口（仅 YGOPro 端口）
ss -tlnp | grep -E ':(7711|4002|4000|7922)'
# ② HTTP 检查页与 API
curl -sf http://127.0.0.1:7922/ | grep -i ygopro
curl -sf http://127.0.0.1:7922/api/banlists | jq '.ygopro | length'
curl -sf "http://127.0.0.1:7922/api/resources/version" | jq '.schemaVersion'
# ③ 资源刷新（定时任务仍在，且日志无 EDOPro 路径）
docker logs --since 6h <server> | grep -E 'refresh ok|Repositories synced' | tail
# ④ 完整决斗冒烟（固定 TCP 首包 → 怀旧赛制建房 → 卡组校验 → 断线/重连 → 投降 → 录像 → 关闭）
#    命令与断言见 openspec/changes/remove-edopro-support/wsl-test-matrix.md 与任务 8.4 实测
# ⑤ 统计恰好一次持久化
docker exec <pg> psql -U evolution -d evolution -tc \
  "SELECT count(*) FROM unranked_matches WHERE player_names @> ARRAY['<name>']"
```

## 5. 审批点（独立、不可合并）

| # | 审批点 | 内容 | 批准人 |
| --- | --- | --- | --- |
| G1 | **外部入口关闭** | 移除指向 EDOPro 端口 7911/4001 的负载均衡/防火墙/域名规则与健康检查；仅允许在 9.2 全量验证通过后执行 | 运维负责人 |
| G2 | **破坏性数据清理** | 删除 §1.1 仓库缓存、§1.2 旧容器/卷/镜像、§1.4 旧发布版本；删除前须确认 §2 盘点清单全绿且新缓存映射验证通过 | 运维负责人 + 数据负责人（涉及旧数据卷） |

> 门禁：G1/G2 均须在 §4 健康检查全部通过之后触发；两项审批相互独立，G1 先行。执行 G2 时逐项使用**绝对路径**（如 `rm -rf /personal-vscode-project/Nostalgia-duel-server/repositories/edopro-scripts`），禁止通配根目录。

## 6. 清理后验证（9.3 收尾）

```bash
# 更新器不会重新创建 EDOPro 资产：等待下一个定时刷新周期（或手动触发一次），确认
#   repositories/ 无 edopro-* 目录、resources/releases/*/ 无 edopro/ 树、日志无 EDOPro 路径
docker exec <server> sh -c 'ls repositories/ | grep edopro || echo "no edopro repos"'
# YGOPro 冒烟重跑（固定首包 + 建房 + 卡组校验），确认清理未影响服务
```
