## Why

当前排位系统已保存初始卡组快照，但玩家无法查看最近环境中卡组与卡片的实际采用情况。需要一个对 1103、1109 分开统计、每天更新的公开使用率页面，帮助玩家理解最近 90 天的环境，同时清楚显示历史快照缺失造成的样本覆盖差异。

## What Changes

- 新增最近 90 个已结束的北京时间自然日合并使用率：卡组类型，以及 Main 怪兽、Main 魔法、Main 陷阱、额外卡组、Side 卡片，共六个榜单；不提供日、周、月或全历史切换。
- 以有效排位 Match 的玩家视角初始卡组快照为样本，每份快照只计一次。1109 沿用已有 25 个具名类型与“其他”；1103 暂沿用现有分类，可信快照均为“其他”，本变更不新增 1103 具名分类规则。
- 新增由宿主 crontab 每天调用的一次性统计任务，按环境重建并原子发布汇总；失败时保留最近一次成功结果，支持安全重跑。
- 新增公开聚合查询 API 和与现有决斗专区相连的使用率页面，显示窗口、更新时间、样本覆盖、排名、使用率及卡片投入 1/2/3 张分布。

## Capabilities

### New Capabilities

- `nostalgia-rolling-usage-statistics`: 定义 90 天窗口、统计样本与分母、卡片归一及分类口径、每日任务和汇总发布行为。
- `nostalgia-usage-dashboard`: 定义双环境公开查询接口、六类榜单的展示、分页及数据新鲜度反馈。

### Modified Capabilities

无。现有排位、卡组快照、录像及分类规则的行为不变。

## Impact

- 数据与任务：读取现有 `matches`、`match_decks`、`deck_types` 及随应用发布的固定 `cards.cdb`；新增可重建的 PostgreSQL 汇总表、必要索引、一次性 CLI 与 crontab 配置说明。
- HTTP：新增 `/leaderboards/:format/usage` 页面及 `/api/ladder/:format/usage` 只读接口，并从现有 `/leaderboards/:format` 提供入口；仅支持 1103、1109。
- 依赖：上线前需要 `add-replay-deck-access` 的迁移与在线快照采集已生效；历史回填完成度通过覆盖率展示，Side 未知的历史快照不进入 Side 分母。
- 范围：不改变决斗、排位结算或 `.yrp`/`.ydk`；不纳入 Match 对阵、胜率排行或参考页的其他时间周期。
