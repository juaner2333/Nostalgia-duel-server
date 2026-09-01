## Why

当前排位入口依赖 HTTP 票据、轮询和“两人先匹配、后建房”的队列模型，不适合在线人数很少的单实例怀旧服。服务器需要让第一名玩家立即进入可等待的排位房，让后来的同格式玩家直接补位，同时提供按自然月重置的赛季榜、跨月份累计的历史总榜和可追溯的排位小局录像。

## What Changes

- 新增 `1103#TT` 与 `1109#TT` 排位入口，并允许客户端只输入裸 `TT` 作为 `1109#TT` 的固定默认别名：第一名合格玩家直接创建对应格式的排位房，后来的同格式玩家加入已有等待房；没有合适房间时才创建新房。
- **BREAKING**：以直接合房替代现有 HTTP 排队票据、状态轮询、定时配对与 WindBot 兜底流程；移除对应排队 API 和启动逻辑。
- **BREAKING**：为排位加入增加裸 `TT` 和 `format#TT` 两种精确的非数字例外。普通房仍严格使用 `format#数字房间号`，且继续保持匿名、无房间密码和不计排名。
- 排位玩家必须在 YGOPro `PlayerInfo` 中使用 `昵称$1234` 形式认证，`$` 后必须恰好为 4 位数字。昵称不存在时以昵称为唯一键自动创建 PIN 账号；昵称已存在时只接受正确 PIN。
- 玩家每次成功进入或重连排位玩家席位后，服务器向该连接私发一条当前房间格式、北京时间当前月赛季的战绩消息，包含积分、胜场、败场、胜率和当前排名；每名玩家在每个格式的每月赛季积分从 0 开始，新账号或当月尚无有效比赛时显示 0 分、零战绩和“未上榜”。
- 在单实例内存中记录账号当前占用的排位房；同一账号在所有格式之间同时只能占用一个排位房，重复进入 `#TT` 时优先恢复原房间。
- 排位房复用现有房间状态、玩家席位与重连能力；等待阶段离房不计分，开战后的投降和断线终局进入正常比赛结算。
- PostgreSQL 只保留排位实际使用的六张业务表：`users`、`user_bans`、`matches`、`duels`、`player_stats` 和 `duel_replays`。`matches` 保存逐场结果，`player_stats` 按 `format` 与北京时间自然月保存用户积分、胜场和负场；每个赛季从 0 分开始，积分沿用现有小局净胜分，即每名玩家本场积分变化等于小局胜数减小局负数。
- 排位 MATCH 进行期间只在房间内存中保留小局记录，不写入对局统计或录像表；整场终结后统一把比赛、小局、月度统计以及每一小局的原始 `.yrp/.yrp2` 录像以单次 PostgreSQL 事务批量保存。普通数字房保持客户端录像发送，但不产生任何 PostgreSQL 写入。
- 新增可扩展的格式排行榜 API：每个格式同时提供指定历史月份的月赛季榜和汇总全部月份的总榜；1103、1109 独立查询，未来格式复用同一路由和数据模型。排行榜前端页面迁移到独立变更 `add-nostalgia-ranked-leaderboard-page`。
- 复用 `RANK_ENABLED` 作为完整排位能力开关：关闭时不连接或要求 PostgreSQL，裸 `TT`、`format#TT` 与排行榜均不可用，普通数字房继续运行；开启时 PostgreSQL 和成功应用数据库迁移是服务启动的必要条件。
- 保持 `docker-compose.cloud.yaml` 为无 PostgreSQL、无 Valkey 的极简部署，并新增 `docker-compose.cloud.ranked.yaml`，只长期运行 PostgreSQL 与排位服务；运维人员使用同一应用镜像手动执行一次性 Migration 命令后再启动或升级排位服务。
- **BREAKING**：由于这是首次正式启用 PostgreSQL 排位库，删除全部旧 Migration，并在裁剪 TypeORM DataSource 后针对空库生成唯一的排位初始化 Migration；既有旧 Migration 历史和非排位表不纳入新基线。

## Capabilities

### New Capabilities

- `nostalgia-ranked-play`: 定义格式化直接排位房、PIN 账号、单账号房间占用、重连结算、排位小局录像、格式积分和排行榜的完整外部行为。

### Modified Capabilities

无。

## Impact

- YGOPro 加入路由、裸 `TT` 默认格式映射、`PlayerInfo` 解析、账号认证、自动注册和私有赛季战绩提示。
- 排位房创建、等待房选择、房间列表索引、断线重连和统一终结流程。
- 现有 matchmaking 队列、HTTP controllers/routes、bootstrap、WindBot 兜底及其测试。
- `GameOverDomainEvent` 的稳定比赛标识、格式元数据与完整小局记录，统计和录像持久化领域服务，以及 `users`、`user_bans`、`matches`、`duels`、`player_stats`、`duel_replays` 六张排位业务表的全新初始化基线；不新增排位积分专用表。
- 月赛季/总排行榜查询 API 和格式注册表；`/leaderboards/:format` 页面、月份切换与页面展示由独立前端变更处理。
- 排位开关、持久化 bootstrap、生产 Migration runner、Docker 镜像与 `docker-compose.cloud.ranked.yaml`，以及 PostgreSQL 宿主机数据目录和人工迁移部署流程。
- 普通 1103/1109 数字房、固定资源、卡组规则和决斗协议版本不变；不新增 Redis 依赖。
