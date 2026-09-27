## Why

当前天梯每月 1 日切换新赛季，低对局量时当月榜单很快清零，玩家难以在一个周期内累积足够的可比较战绩。将赛季改为北京时间自然半年，可让榜单稳定累积，同时保留明确的历史边界。

## What Changes

- 1103、1109 天梯赛季统一改为自然半年：`YYYYH1` 为 1 月 1 日至 7 月 1 日前，`YYYYH2` 为 7 月 1 日至次年 1 月 1 日前；只汇总各自时间范围内结束的有效排位 Match。
- 天梯页面默认显示当前半年榜，并支持查看历史半年榜及原有跨期总榜；进房私有战绩提示改为当前半年战绩。
- 旧的月度 `matches.season` 与 `player_stats.season` 继续作为内部事实粒度，半年榜按同一环境、同一玩家的六个月记录求和；不删除历史记录，也不修改已应用迁移。
- 此变更只调整天梯赛季；使用率页面的自然半年统计在 `add-rolling-deck-usage-dashboard` 中独立规划。两者采用相同的北京时间半年边界。

## Capabilities

### New Capabilities

- `nostalgia-half-year-ranked-seasons`: 定义半年赛季的归属、积分汇总、历史与总榜查询、进房战绩提示和页面选择行为。

### Modified Capabilities

无。此前月赛季需求尚在未归档的变更 `add-direct-nostalgia-ranked-rooms` 与 `add-nostalgia-ranked-leaderboard-page` 中；本能力明确替代其中的月赛季对外行为。

## Impact

- 排位事实与查询：复用现有按北京时间 `YYYYMM` 写入的 `matches` 与 `player_stats`，调整天梯查询和进房提示的聚合范围；全期总榜继续覆盖所有月份。
- HTTP 与页面：`GET /api/leaderboards/:format` 的 `scope=season` 改用 `season=YYYYH1|YYYYH2`；页面将月份输入改为半年选择，保留搜索、分页、排序及昵称保护。
- 兼容性：月榜查询参数与半年榜含义不同，属于 **BREAKING** API 变更；历史月数据保留在数据库中，可用于构建历史半年榜。
