## Why

现有排位录像页只能按玩家搜索并下载 `.yrp`，无法看到双方卡组类型、按类型查找录像或下载双方卡组。比赛和录像数据已按整场 Match 结算，但缺少可信的初始卡组事实；本变更为这三项公开能力补齐同一份事实来源，并让分类按环境路由。

## What Changes

- 为当前 1103、1109 排位 Match 冻结双方 G1 前通过对应环境校验的 Main、Extra、Side；整场 Match 正式结算后，随比赛、各小局及录像原子且幂等地保存玩家视角卡组快照。G1/G2/G3 的录像共用该 Match 的初始快照。
- 按 `format_id` 路由代码中的分类器：1109 使用分析仓库 `Nostalgia-duel-server-analysis` 基线提交 `c9ba01c` 的 25 类有序规则；1103 暂无具名规则，可信卡组统一归为「其他」。新增环境若尚无规则，也按同一兜底行为处理。类型目录按环境隔离，分类结果记录版本；不在数据库维护条件解释器。
- 离线回填从线上 PostgreSQL 生产库读取 1103 和 1109 的历史 Match 与 G1 录像，并写回同一库的 `match_decks`；仅在身份和卡组可验证时回填 Main、Extra，未知 Side 明确标记为缺失。连接参数由执行环境提供，沿用分析仓库的只读连接配置约定，不将地址或凭据写入本变更。
- 扩展各已启用环境的录像列表，展示双方类型，支持任一方命中的类型筛选，并在每条录像上提供双方初始卡组下载。
- 公开按环境与玩家视角 Match 下载 `.ydk` 的接口；文件按 `#main`、`#extra`、`!side` 导出原始卡片 ID，历史 Side 缺失时标记为部分卡组。现有 `.yrp` 字节与下载路径保持兼容。

## Capabilities

### New Capabilities

- `nostalgia-deck-facts`: 定义各环境初始卡组冻结、整场结算后保存、历史回填以及完整性边界。
- `nostalgia-deck-classification`: 定义按环境隔离的类型目录、代码路由、1109 规则顺序和版本一致性。
- `nostalgia-replay-deck-access`: 定义各环境录像类型展示与筛选、双方公开 `.ydk` 下载及页面反馈。

### Modified Capabilities

无。现有录像列表与 `.yrp` 下载契约保留，1103 和 1109 均增加字段与可选查询能力。

## Impact

- 数据：新增按 `(format_id, code)` 定义的 `deck_types`、玩家视角 `match_decks` 及新迁移；通过既有 `matches`、`duels`、`duel_replays` 关联录像与双方快照。统计汇总表不属于本变更。
- 历史回填：`Nostalgia-duel-server-analysis/analyze_online_g1.py` 的 PostgreSQL 只读连接方式作为数据源参考；回填另用本服务既有生产写入连接提交快照。分析脚本当前只查询 1109，回填须覆盖 1103 与 1109，且不得把生产连接凭据纳入版本控制、运行日志或报告。
- 结算：各环境排位结束事件与现有持久化事务扩展为保存双方初始快照；正常结束、判负、重复通知与失败重试须保持一致。
- HTTP 与页面：扩展 `GET /api/replays/:format` 和 `/leaderboards/:format` 的录像标签，新增公开 `GET /api/ladder/:format/matches/:matchId/deck`；保留原始 `.yrp` 下载。
- 资源与兼容：分类只使用随应用发布的对应环境固定卡池及本仓库代码规则，不在运行时读取分析仓库；不改变现有决斗与统计行为。
