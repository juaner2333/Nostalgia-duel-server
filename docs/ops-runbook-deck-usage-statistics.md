# 运维运行手册：半年度卡组与卡片使用率统计（add-rolling-deck-usage-dashboard）

> 对应 OpenSpec 变更 `openspec/changes/add-rolling-deck-usage-dashboard/`。  
> 适用组件：每日重建 CLI (`npm run rebuild:usage`)、公开 API (`/api/ladder/:format/usage*`)、看板页面 (`/leaderboards/:format/usage`)。

---

## 1. 任务概述与重建机制

- **时间口径**：按北京时间（UTC+8）严格以自然半年为统计窗口：
  - `YYYYH1`：`[YYYY-01-01 00:00:00, YYYY-07-01 00:00:00)`（左闭右开）；
  - `YYYYH2`：`[YYYY-07-01 00:00:00, YYYY+1-01-01 00:00:00)`（左闭右开）。
- **运行频次**：每天北京时间 03:00 执行一次 CLI 全量重建；双环境（`1103` 与 `1109`）依次独立计算与发布。
- **原子性与幂等性**：
  - 基于 PostgreSQL Advisory Lock 实现任务防并发互斥；
  - 基于 `(format_id, window_start)` 自然主键，在短事务内原子清理并插入明细行，更新发布时间与实际截止日；重跑覆盖计数而不累加；
  - 汇总表（`usage_stat_runs`、`usage_deck_rows`、`usage_card_rows` 与 1109 专用的 `stats_deck_matchups`）在同一事务内原子提交，外键约束由 `stats_deck_matchups` 指向 `usage_stat_runs`。不影响在线业务写入。

---

## 2. 宿主 Crontab 配置

### 2.1 确认宿主系统时区

在安装 crontab 之前，必须先核对宿主系统的当前时区：

```bash
timedatectl
# 观察 "Time zone" 字段：
# 若为 Asia/Shanghai (CST, +0800)：每天 03:00 对应的 cron 表达式为 "0 3 * * *"
# 若为 UTC (+0000)：北京时间 03:00 对应 UTC 前一天的 19:00，cron 表达式为 "0 19 * * *"
```

### 2.2 防重复安装检查

检查当前用户或系统是否有已安装的重建任务，必须移除旧的 03:10 条目，确保仅保留唯一的 03:00 条目：

```bash
crontab -l | grep rebuild:usage
```

确认无重复或冲突配置后再进行安装。

### 2.3 Crontab 计划示例

创建日志目录并配置每天仅执行一次的任务（以宿主时区为 Asia/Shanghai 为例）：

```bash
mkdir -p /var/log/nostalgia
chmod 755 /var/log/nostalgia
```

在宿主机的 `crontab -e` 中添加（建议使用生产部署项目的绝对路径，确保加载 `.env` 环境变量与 Node 路径）：

```cron
# 每天北京时间 03:00 重建卡组与卡片使用率及 1109 胜率矩阵（宿主时区为 Asia/Shanghai）
0 3 * * * cd /opt/nostalgia-duel-server && /usr/bin/npm run rebuild:usage >> /var/log/nostalgia/usage-rebuild.log 2>&1
```

*若宿主机为 Docker Compose 容器化部署*：

两份 Compose 配置中的容器名均为 `container_name: nostalgia-duel-server`，因此推荐直接使用容器名称执行：
```cron
# 方案 A (推荐)：直接通过固定容器名调用（prod 与 cloud 形态均通用，且执行编译后的 dist 产物）
0 3 * * * docker exec nostalgia-duel-server npm run rebuild:usage >> /var/log/nostalgia/usage-rebuild.log 2>&1
```

若按 Docker Compose 服务名执行，请注意不同部署形态的服务名差异：
- 在 `docker-compose.prod.yaml`（含中间件）下，服务端服务名为 **`server`**：
  ```cron
  0 3 * * * docker compose -f /opt/nostalgia-duel-server/docker-compose.prod.yaml exec -T server npm run rebuild:usage >> /var/log/nostalgia/usage-rebuild.log 2>&1
  ```
- 在 `docker-compose.cloud.yaml`（无中间件直拉镜像）下，服务名为 **`nostalgia-duel-server`**：
  ```cron
  0 3 * * * docker compose -f /opt/nostalgia-duel-server/docker-compose.cloud.yaml exec -T nostalgia-duel-server npm run rebuild:usage >> /var/log/nostalgia/usage-rebuild.log 2>&1
  ```

> **注意**：生产镜像构建阶段已执行 `npm prune --production` 并移除了 `src/` 与 `ts-node` 等开发依赖。`npm run rebuild:usage` 已配置为执行编译后的产物 `node ./dist/src/shared/stats/usage/cli/rebuild-usage-cli.js`，完全兼容生产轻量容器环境。

---

## 3. 首次历史回填与手动重跑

### 3.1 首次上线回填

### 3.1 首次上线与升级回填

在数据库迁移应用后，必须先手动触发历史半年度及当前半年度的统计构建。特别是在升级包含胜率矩阵（`stats_deck_matchups`）的版本后，**必须统一重建全部已有 1109 半年批次**，以保证历史半年的矩阵数据与使用率批次同步生成，避免旧批次的空对阵表被误认为已发布的零对局：

```bash
# 回填特定历史半年度（例如 2025H2、2026H1）
npm run rebuild:usage -- --period=2025H2
npm run rebuild:usage -- --period=2026H1

# 重建当前半年度（自动计算当前半年度，并检查换期补齐）
npm run rebuild:usage
```

### 3.2 换期自动补齐说明

- 每次无参数运行 `npm run rebuild:usage` 时：
  - 默认计算当前半年度（例如在 2026 年 7 月 3 日运行时，当前半年度为 `2026H2`，截止日推进到 2026-07-03）；
  - **换期前 7 天自动补齐**：当运行日期处于半年开始的前 7 天内（即 1 月 1–7 日或 7 月 1–7 日）时，CLI 会自动检查并补齐上一半年度（例如 `2026H1`），将其截止日从上一年的最后一天最终推进至窗口结束日（`window_end_exclusive`），形成最终归档报表（包含 1109 的矩阵对阵表）。
- 也可以随时通过 `--period=YYYYH1` 显式重跑任意历史半年度以重新计算并修正对阵矩阵。

---

## 4. 运行日志与失败排查

### 4.1 日志输出规范

CLI 的输出不包含数据库密码等敏感凭据，格式如下：

```text
[UsageRebuild] Starting half-year usage statistics rebuild...
[UsageRebuild] Target periods: 2026H1 (current)
[UsageRebuild] Processing format 1103 for period 2026H1...
[UsageRebuild] Format 1103 2026H1 completed in 42ms: totalDecks=4, sideKnownDecks=2, deckRows=1, cardRows=45
[UsageRebuild] Processing format 1109 for period 2026H1...
[UsageRebuild] Format 1109 2026H1 completed in 312ms: totalDecks=3134, sideKnownDecks=122, deckRows=22, cardRows=1560, admittedMatches=428, matchupRows=84
[UsageRebuild] Usage statistics rebuild finished successfully.
```

### 4.2 退出码与监控告警

- **退出码 0**：所有规划的环境与半年度均成功发布；
- **退出码 1**：任一环境或半年度遇到错误（如数据库连接失败、并发锁冲突、卡片校验异常、对阵场数校验不一致）；
- **锁冲突重试**：若出现 `Could not acquire advisory lock for format <formatId>`，表示上一任务尚未结束或有并发执行，CLI 会跳过该环境并以非 0 退出码报错，下一次定时任务将重新尝试。

---

## 5. 停用与回滚方案

### 5.1 停用定时统计

若需暂停统计重建，只需注释掉 crontab 中的行：

```bash
# 注释 crontab 行
crontab -e
# 在任务前加 #
```

### 5.2 数据库数据清理与回滚

汇总表与矩阵数据为完全派生数据，源事实表为 `matches`、`match_decks` 与 `duels`。因 `stats_deck_matchups` 含有指向 `usage_stat_runs` 的外键约束，清空时必须包含该表（遵循外键依赖顺序或一次性级联清理）：

```sql
-- 清空所有汇总与矩阵数据，页面将显示“暂无可用的半年度统计”
TRUNCATE TABLE stats_deck_matchups, usage_card_rows, usage_deck_rows, usage_stat_runs;
```

清空后可通过 `npm run rebuild:usage` 随时无损重新生成。

> **注意：旧版任务运行后的恢复**：  
> 若系统曾回滚至仅有使用率统计的旧版镜像且旧版定时任务运行过（旧版发布会更新 `usage_stat_runs` 但不生成 `stats_deck_matchups`），在重新切回新版并重新启用矩阵接口前，**必须先使用新版 CLI 重建受影响的 1109 半年度**（例如 `npm run rebuild:usage -- --period=2026H2`），确保矩阵对阵表与使用率数据再次同步发布。
