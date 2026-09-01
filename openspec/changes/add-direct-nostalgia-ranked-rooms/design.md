## Context

动机参见 [proposal.md](./proposal.md)。当前服务已经具备 1103/1109 固定房间、账号/PIN 准入、排位标记、游戏结束事件、小局净胜分和房间内重连，但这些能力没有组成目标中的低人数排位流程：

- `NostalgiaJoinStrategy` 只接受 `format#数字`，`TT` 会被拒绝。
- `PlayerInfoMessage` 当前以 `:` 读取四字符密码，并把 `$` 及其后内容当作历史签名丢弃。
- `MatchmakingQueue` 通过 HTTP 票据、轮询和定时 tick 等两人到齐后建房，并包含 WindBot 兜底。
- `YGOProRoomList`、排队记录和重连计时器均为进程内状态，符合当前单实例部署方式。
- `GameOverDomainEvent` 已携带 `formatId`，但 `BasicStatsCalculator` 仍在处理事件时临时生成 `gameId`，并逐个写入双方的比赛与统计，缺少稳定的幂等边界和跨双方事务。
- `matches` 已按用户保存每场 MATCH 的比分、胜负、积分、赛季和 `gameId`；`player_stats` 已保存用户积分、胜负和数字 `season`，但仍以禁限卡表/Global 分区并读取人工 `config.season`，两张表都缺少明确的 `formatId`。
- `duels` 已保存每个用户的小局详情，不适合作为排行榜查询源，也没有指向共享录像的关联字段。
- 房间已经把整场的 `DuelRecord[]` 保留到 MATCH 结束，并能生成每局原始 `.yrp/.yrp2` 与整场 `.evrp`；当前录像只发送给客户端，没有 PostgreSQL 录像实体。
- `users.email` 当前非空，而直接由昵称和 PIN 创建的账号没有邮箱。
- 当前 DataSource 注册了排位以外的锦标赛、成就、闪电赛和普通房统计实体，历史目录中有 30 个 Migration；`UnrankedMatchSaver` 还会把普通数字房写入 `unranked_matches`、`unranked_duels` 和日汇总。这些结构都不是本次首次启用 PostgreSQL 排位库所需内容。
- `docker-compose.cloud.yaml` 是不带 PostgreSQL/Valkey 的镜像直拉极简部署；现有 `docker-compose.prod.yaml` 虽然包含 PostgreSQL，却会连带启动本变更不需要的 Valkey，也不符合运维人员显式执行 Migration 后再启动服务的流程。
- 当前生产镜像只保留编译后的 JavaScript 和生产依赖，而 Migration 命令依赖开发期 `ts-node`，`data-source.ts` 也只发现 `*.ts` Migration，因此容器内尚无可执行的生产迁移入口。

该变更横跨线协议解析、账号、房间、重连、统计、数据库和 HTTP API，因此需要显式设计边界。

## Goals / Non-Goals

**Goals:**

- 让已认证玩家从 YGOPro 客户端一次连接即可完成认证和直接合房，并允许裸 `TT` 固定默认进入 1109 排位。
- 把等待房、当前占用和重连状态保持在单实例内存中，并让统一终结路径负责清理。
- 让账号创建和比赛结算具有数据库唯一性、事务性和幂等性。
- 复用现有逐场明细和用户统计模型，按格式与北京时间自然月参数化，同时提供月赛季榜和由月统计汇总的历史总榜，并支持后续显式启用格式。
- 每个格式的每月赛季积分从 0 开始，并在玩家成功进入排位席位后私发当前月积分、胜负、胜率和排名。
- 在比赛期间只保留内存快照，并在 MATCH 终结后原子保存比赛、小局、积分和每局共享录像。
- 将首次排位 PostgreSQL 初始化收敛为六张业务表和一个面向空库的 Migration 基线，普通数字房保持零 PostgreSQL 写入。
- 复用现有房间聚合、固定资源、状态机、卡组校验、客户端录像发送和消息行为。
- 让同一镜像通过 `RANK_ENABLED` 支持无数据库极简模式和 PostgreSQL 排位模式，并提供可在 WSL 与云主机复用的独立排位 Compose。

**Non-Goals:**

- 不实现按积分区间、等待时间或地区筛选对手的竞技匹配算法。
- 不实现多实例协调、Redis 房间锁或服务重启后的对局恢复。
- 不提供找回 PIN、修改 PIN、邮箱绑定、账号合并或 Web 注册流程。
- 不为普通数字房计分，也不改变普通房的匿名、观战和资源语义。
- 不改变小局净胜分公式，不引入 Elo、段位、赛季奖励或反作弊系统。
- 不新增录像列表、下载 API、自动清理策略或 MATCH 级 `.evrp` 数据库存储。
- 不实现排行榜 HTML 页面、样式和浏览器交互；这些内容由独立变更 `add-nostalgia-ranked-leaderboard-page` 处理，本变更只提供稳定 API。
- 不让极简部署隐式启动 PostgreSQL，也不为直接 TT 排位重新引入 Valkey/Redis。
- 不在本变更中删除未注册的旧实体或模块源码；只从 DataSource 和运行时订阅中移除它们，后续代码清理另立变更。
- 不兼容曾经执行过旧 Migration 的本地测试库；这些数据库需要清空后按新初始化基线重建。

## Decisions

### 1. 在加入策略链中增加专用 TT 策略

新增排位加入策略并放在普通 `NostalgiaJoinStrategy` 之前。它只匹配精确裸 `TT` 或已启用格式的精确 `format#TT`：裸 `TT` 在进入认证和房间选择前规范化为固定的 `1109#TT`，显式格式保持不变；普通策略继续只接受 `format#数字房号`。默认值写成排位入口契约中的常量 1109，不从“首个注册格式”或环境变量动态推导，避免格式注册顺序改变玩家落点。

该策略调用应用层“直接加入排位房”用例，不在接口层编写认证、查房和创建规则。用例先认证账号，再同步执行“恢复已有占用 / 预留最早等待房空位 / 创建新房”三选一，最后把已解析凭据交给现有房间准入流程。账号已有活动房时，唯一占用和重连优先于本次入口目标，因此已在 1103 的账号使用裸 `TT` 仍恢复原 1103 席位。

备选方案是直接在 `NostalgiaJoinStrategy` 中增加 `roomId === "TT"` 分支。该方案会把普通环境路由与排位账号、占用和建房规则耦合在一个类中，因此不采用。另一个备选方案是用配置项选择默认格式；当前默认值已经明确为 1109，增加配置只会形成不必要的部署差异，因此不采用。

### 2. 将 `$` PIN 作为 TT 准入的独立解析结果

`PlayerInfo` 解析结果保留纯显示昵称和可选的四位数字 `rankedPin`。TT 策略只接受原始值满足 `^[^$]+\$\d{4}$` 且完整 UTF-16 字符数不超过协议槽位的输入；不截断多余字符，也不接受 `:` 作为 TT 登录分隔符。日志和领域事件只携带纯昵称与账号 ID。

非 TT 加入继续取得纯显示昵称；是否保留旧 `:` 解析仅用于既有非 TT 兼容路径，不得成为 TT 的回退认证方式。

备选方案是继续使用当前 `:` 密码字段，或同时允许 `$` 和 `:`。前者不符合已确认的客户端输入，后者会形成两套长期外部契约，因此 TT 仅使用 `$`。

### 3. 使用一个原子“认证或注册”用例

账号领域新增 PIN 认证/注册用例：按精确昵称查询；存在时验证 bcrypt 摘要与封禁状态，不存在时创建 UUID 账号并保存 PIN 的 bcrypt 摘要。数据库继续以 `users.username` 唯一约束作为并发最终裁决；发生唯一键竞争时，用例重新读取胜出的账号并验证提交的 PIN，而不是覆盖密码。

PIN 账号复用现有 `users` 聚合与 `password` 摘要，不创建第二套账号表。数据库迁移把 `email` 改为可空，领域模型允许 PIN 账号没有邮箱；已有邮箱账号不受影响，`secure_password` 不参与本变更。

备选方案包括伪造 `<uuid>@local.invalid` 邮箱和新建 PIN 用户表。前者制造无意义身份数据，后者会让昵称唯一性、封禁和统计外键跨两套账号模型，因此不采用。

### 4. 用进程内注册表管理排位占用和待落座预留

新增单例内存注册表，以 `userId` 为唯一键保存内部 `roomId`、`formatId` 和席位状态，并按房间维护短暂的待落座预留数。认证完成后的房间选择和预留是同步操作；Node 单事件循环会在下一次加入处理前写入预留，避免两个并发连接同时看到同一最后空位。

注册表只做索引和预留，房间聚合仍是玩家、状态与重连事实来源：

1. 已有占用且房间仍存在时，返回原房间并按账号恢复席位。
2. 没有占用时，按 `YGOProRoomList` 插入顺序选择同格式、排位、等待中、非终结且“现有玩家 + 预留 < 2”的最早房间。
3. 找不到时，通过现有固定格式工厂创建一个 External 排位房并立即预留席位。
4. 准入失败时回滚该次预留；准入成功时把预留转换为活动占用。
5. 等待离房和统一房间终结均调用同一个幂等释放入口。

房间需要显式的直接排位类型/来源，而不是继续复用 `isMatchmaking`。新类型允许 PIN 账号进入、禁止机器人兜底，并参与排位重连；普通数字房和 WindBot 房继续走原类型。

备选方案是每次扫描全部房间和玩家推导账号占用。它无法覆盖准入异步期间的席位预留，也容易让同一账号跨格式并发落座，因此保留一个最小 Map 索引。

### 5. 排位重连按账号恢复，并复用统一终结

排位席位保存认证后的 `userId`。重复 `#TT` 连接先查占用，再以相同 `userId` 接管原席位；有效账号是充分条件，不沿用匿名 TCP 的同 IP 限制。接管继续执行现有“最新连接生效”、旧 socket 解绑与阶段同步。

为已开战的直接排位房建立每个断线玩家 90 秒的期限。期限内接管取消该玩家计时器；单方到期时通过现有投降/胜负路径产生唯一结果；双方都到期且无法确定唯一胜者时，只统一清理，不发布可计分结果。等待阶段离房直接释放占用且不产生比赛。

所有正常完成、投降、断线到期和异常清理最终都进入 `FinalizeYGOProRoom`。注册表释放、计时器取消和房间移除必须幂等，避免并发终局留下僵尸占用或重复结算。

备选方案是复用当前“仅全部玩家都断线才启动一个房间级计时器”的实现。该实现不能在对手仍在线时给单个断线玩家确定的恢复期限，因此需要扩展为排位玩家级期限，同时保持普通房既有行为。

### 6. MATCH 终结后统一保存比赛、统计、小局和录像

PostgreSQL 只承载排位实际使用的六张业务表，不新增排位积分专用表：

- `users` 保存 PIN 账号，保留现有账号字段；`email` 允许为空，昵称继续由 `username` 唯一约束保证唯一。
- `user_bans` 保存账号封禁，继续复用现有到 `users` 的数据库外键。
- `matches` 是逐场事实与审计记录，保持“每个用户每场 MATCH 一行”的结构。`game_id` 使用 UUID，`format_id` 非空，`season` 保存北京时间月份 `YYYYMM`，`points` 保存该用户的小局净胜分；`(game_id, user_id)` 唯一。
- `player_stats` 是面向用户积分和排行榜的月度聚合。`format_id` 非空，`(user_id, format_id, season)` 唯一；每个格式的新月赛季从 0 分开始，首次有效 MATCH 直接以本场小局净胜分创建统计行。`ban_list_name` 继续保存房间固定禁限卡表名称，但不能替代格式键。
- `duel_replays` 每一小局一行，只保存直接 TT 排位录像。`replay_data` 是 `DuelRecord.toYrp(room).toYrp()` 生成的原始 `.yrp/.yrp2` 字节，不包含 YGOPro TCP 长度前缀和 `STOC_REPLAY (0x17)` 命令字节，也不重复 gzip；`(game_id, duel_index)` 唯一。
- `duels` 继续按用户保存有效排位 MATCH 的小局详情。`game_id` 使用 UUID，新增非空 UUID `replay_id` 在语义上指向共享录像；同一小局的双方记录保存同一个 `duel_replays.id`，但 PostgreSQL 不建立外键约束。

DataSource 只注册这六个实体。锦标赛、成就、闪电赛、普通房统计和日汇总实体不注册、表不创建、触发器不创建；普通数字房的 `UnrankedMatchSaver` 不再注册。相关旧源码暂时保留，避免把首次排位落库扩大成无关模块删除。

房间创建时生成稳定 `gameId`。比赛期间，分数、双方小局详情和 `DuelRecord[]` 全部留在房间内存；单局结束与换备不得访问 `matches`、`duels`、`player_stats` 或 `duel_replays`。MATCH 终结时先构造不可变持久化快照，预生成每局 `replayId` 并把原始 YRP 字节序列化一次，客户端发送继续复用同一录像内容。

有唯一有效胜者时，终结应用服务在一个 PostgreSQL 事务中依次完成：

1. 为双方各插入一条 `matches`，以 `(game_id, user_id)` 唯一约束建立幂等边界。
2. 按小局顺序插入 `duel_replays`，每局只写一份 `bytea`。
3. 为双方写入对应 `duels`，并把两条小局详情的 `replay_id` 指向同一录像。
4. upsert 双方 `(user_id, format_id, season)` 的 `player_stats`：没有行时以 0 分为起点，有行时使用当前积分，再按“小局胜数 - 小局负数”改变积分并各增加一次胜负场。

任一步失败都回滚整个事务，并使用相同 `gameId`、`duelIndex` 和预生成 `replayId` 立即重试一次；重复终局因唯一约束不会重复累计。事务完成或最终失败后才能释放持久化快照并继续房间清理。没有唯一胜者但已经存在正常结束小局时，使用一个独立的录像批次只插入 `duel_replays`，不写 `matches`、`duels` 或 `player_stats`。直接 TT 排位不再额外更新旧 Global/禁限卡表统计；普通数字房不触发任何 PostgreSQL 写入。

这意味着 MATCH 结束前进程崩溃会丢失整场尚未落库的数据；这是“不在游戏过程中做数据库操作”的明确取舍。备选方案是在每小局结束时立即写录像，能够缩小崩溃丢失窗口，但会把数据库延迟和故障带入换备阶段，因此不采用。另一个备选方案是每次查看积分时扫描 `matches`，但它不符合现有 `player_stats` 的快速读取职责。

#### PostgreSQL DDL

以下是空库初始化 Migration 的目标 `UP` DDL。实际文件必须在六个目标实体完成、DataSource 裁剪后由 TypeORM 生成，再人工核对列、约束、索引和排除表；TypeORM 生成的哈希约束名可以不同，但语义必须一致：

```sql
CREATE TYPE "users_role_enum" AS ENUM ('admin', 'user');

CREATE TABLE "users" (
    "id" character varying NOT NULL,
    "username" character varying NOT NULL,
    "password" character varying NOT NULL,
    "secure_password" character varying,
    "email" character varying,
    "avatar" text,
    "role" "users_role_enum" NOT NULL DEFAULT 'user',
    "discord_id" character varying,
    "participant_id" character varying,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_users" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_users_username" UNIQUE ("username"),
    CONSTRAINT "UQ_users_email" UNIQUE ("email")
);

CREATE TABLE "user_bans" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "reason" text NOT NULL,
    "banned_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "expires_at" TIMESTAMP WITH TIME ZONE,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "user_id" character varying,
    "banned_by" character varying,
    CONSTRAINT "PK_user_bans" PRIMARY KEY ("id"),
    CONSTRAINT "FK_user_bans_user" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "FK_user_bans_banned_by" FOREIGN KEY ("banned_by")
        REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE "matches" (
    "id" character varying NOT NULL,
    "user_id" character varying NOT NULL,
    "game_id" uuid NOT NULL,
    "format_id" character varying NOT NULL,
    "best_of" integer NOT NULL,
    "player_names" text NOT NULL,
    "opponent_names" text NOT NULL,
    "date" TIMESTAMP NOT NULL,
    "ban_list_name" character varying NOT NULL,
    "ban_list_hash" character varying NOT NULL,
    "player_score" integer NOT NULL,
    "opponent_score" integer NOT NULL,
    "winner" boolean NOT NULL,
    "season" integer NOT NULL,
    "points" integer NOT NULL,
    "player_ids" text,
    "opponent_ids" text,
    "anulled" boolean NOT NULL DEFAULT false,
    "anulled_user_id" character varying,
    "anulled_reason" character varying,
    "anulled_by" character varying,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_matches" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_matches_game_user" UNIQUE ("game_id", "user_id"),
    CONSTRAINT "FK_matches_anulled_user" FOREIGN KEY ("anulled_user_id")
        REFERENCES "users"("id"),
    CONSTRAINT "FK_matches_anulled_by" FOREIGN KEY ("anulled_by")
        REFERENCES "users"("id")
);

CREATE INDEX "IDX_matches_format_season_user"
    ON "matches" ("format_id", "season", "user_id");

CREATE TABLE "duel_replays" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "game_id" uuid NOT NULL,
    "duel_index" smallint NOT NULL,
    "format_id" character varying NOT NULL,
    "ban_list_name" character varying NOT NULL,
    "ban_list_hash" character varying NOT NULL,
    "replay_data" bytea NOT NULL,
    "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "ended_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT "PK_duel_replays" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_duel_replays_game_duel" UNIQUE ("game_id", "duel_index"),
    CONSTRAINT "CK_duel_replays_duel_index" CHECK ("duel_index" > 0),
    CONSTRAINT "CK_duel_replays_time" CHECK ("ended_at" >= "started_at"),
    CONSTRAINT "CK_duel_replays_data" CHECK (octet_length("replay_data") > 0)
);

CREATE INDEX "IDX_duel_replays_format_ended"
    ON "duel_replays" ("format_id", "ended_at" DESC);

CREATE TABLE "duels" (
    "id" character varying NOT NULL,
    "user_id" character varying NOT NULL,
    "game_id" uuid NOT NULL,
    "replay_id" uuid NOT NULL,
    "player_names" text NOT NULL,
    "opponent_names" text NOT NULL,
    "date" TIMESTAMP NOT NULL,
    "ban_list_name" character varying NOT NULL,
    "ban_list_hash" character varying NOT NULL,
    "result" character varying NOT NULL,
    "turns" integer NOT NULL,
    "match_id" character varying NOT NULL,
    "season" integer NOT NULL,
    "ip_address" character varying,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_duels" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_duels_user_replay" UNIQUE ("user_id", "replay_id")
);

CREATE INDEX "IDX_duels_replay" ON "duels" ("replay_id");

CREATE TABLE "player_stats" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "ban_list_name" character varying NOT NULL,
    "format_id" character varying NOT NULL,
    "wins" integer NOT NULL,
    "losses" integer NOT NULL,
    "points" integer NOT NULL,
    "user_id" character varying NOT NULL,
    "season" integer NOT NULL,
    CONSTRAINT "PK_player_stats" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_player_stats_user_format_season"
        UNIQUE ("user_id", "format_id", "season")
);

CREATE INDEX "IDX_player_stats_month"
    ON "player_stats" ("format_id", "season", "points" DESC, "wins" DESC);

CREATE INDEX "IDX_player_stats_overall"
    ON "player_stats" ("format_id", "user_id");
```

TypeORM 会额外自行创建并维护 `migrations` 元数据表，它不写入初始化 Migration 的业务 DDL，也不计入六张业务表。`duel_replays.game_id` 和 `duels.replay_id` 都是应用层语义关联，不建立 PostgreSQL 外键。前者因为 `matches` 按用户保存，同一个 `game_id` 对应两行，且无有效胜者时允许只保存录像；后者遵循现有 `duels.user_id`、`duels.match_id` 等字段只保存关联 ID 的模式，避免数据库级删除耦合。终结事务必须先写 `duel_replays` 再写引用它的 `duels`，仓库测试负责验证每个 `replay_id` 都能在同一事务结果中找到录像。TypeORM 的 `replayData` 列必须使用 `select: false`，避免普通明细和列表查询隐式加载二进制。

### 7. 排行榜和进房战绩提示共用格式查询

应用层查询用例接收 `formatId` 和显式 scope，先通过固定格式注册表校验，再从 `player_stats` 联表 `users`，按 `points DESC, wins DESC, username ASC` 查询账号昵称与统计：

- `scope=season&season=YYYY-MM`：把外部月份严格转换为 `YYYYMM`，读取指定格式和月份的月度聚合；合法但没有比赛的月份返回空列表。
- `scope=overall`：按指定格式跨全部月份分组汇总 `player_stats`，不扫描 `matches`，也不读取或维护独立总分字段。

同一应用层查询端口增加“当前用户月赛季排名”读取：接收认证后的 `userId`、房间不可变 `formatId` 和当前时刻，按 `Asia/Shanghai` 得到 `YYYYMM`，读取该用户月统计并用月榜完全相同的 `points DESC, wins DESC, username ASC` 顺序计算名次。胜率使用 MATCH 维度的 `wins / (wins + losses) * 100`；分母为 0 时返回 0%。没有统计行时返回内存中的默认视图 `{ points: 0, wins: 0, losses: 0, winRate: 0, rank: null }`，不插入 `player_stats`，因此未完成有效比赛的账号仍不进入排行榜。

TT 接口适配器只在认证账号成功取得或恢复玩家席位后调用该查询，并通过现有 YGOPro 私有系统消息能力向新连接发送一次，例如：`[排位] 1109 2026-09：积分 0，胜 0，负 0，胜率 0%，排名 未上榜`。消息使用实际恢复房间的格式，因此已在 1103 的账号通过裸 `TT` 重连时显示 1103 战绩；观战、准入失败和其他玩家连接不接收该消息。提示发送不创建新的领域事件或持久化表。

HTTP 层提供：

- `GET /api/leaderboards/:format?scope=season&season=YYYY-MM`：返回格式、scope、月份和包含 `rank/name/points/wins/losses` 的月榜。
- `GET /api/leaderboards/:format?scope=overall`：返回格式、scope 和相同字段的历史总榜。

HTTP 查询参数使用严格白名单：缺少或未知 scope、月榜缺少合法月份、以及不兼容的参数组合均返回请求错误而不静默回退。没有有效比赛的账号不建立对应 `player_stats` 行，因此自然不会出现在月榜或总榜。为月榜 `(format_id, season)` 和总榜/个人名次 `(format_id, user_id)` 建立查询索引；当前社区数据量很小，不引入缓存或物化总榜。后续新增格式只需完成既有固定资源注册与完整性流程，排行榜和个人战绩提示不增加格式专用表或 controller。

备选方案包括每个格式一张表，以及在数据库中维护额外总榜行。前者会在新增格式时复制模式，后者会让每场比赛同时修改月榜和总榜并产生一致性风险，因此不采用。页面组织方式留给独立前端变更决定。

### 8. 删除队列编排，但保留通用 WindBot 能力

移除 `/api/matchmaking/queue`、`/api/matchmaking/status`、对应取消接口、队列 singleton、tick、票据状态、房间 reaper 和 matchmaking 的机器人兜底启动流程。可复用的固定格式建房逻辑迁入直接排位应用服务；WindBot 自身及显式 AI 房入口不属于删除范围。

这避免同时维护“HTTP 队列排位”和“TT 直接排位”两套事实来源。旧客户端必须改为直接连接 YGOPro，并使用裸 `TT` 或显式 `format#TT`。

### 9. 用单一开关和两份云端 Compose 隔离部署模式

`RANK_ENABLED` 是完整排位能力的唯一运行时开关，而不是只控制某个统计订阅：

- `false`：不初始化 PostgreSQL DataSource，不注册或执行排位认证、TT 合房、比赛持久化和排行榜查询；普通数字房、固定资源和客户端录像保持可用。TT 加入被拒绝，排行榜 HTTP 入口返回明确的功能不可用响应。
- `true`：在开放 TCP、WebSocket 和 HTTP 监听之前初始化 PostgreSQL，并确认数据库不存在待执行 Migration；连接、模式校验或持久化依赖失败时启动失败，不静默降级。

保留 `docker-compose.cloud.yaml` 作为极简部署，只启动同一个应用镜像并固定 `RANK_ENABLED=false`、`USE_REDIS=false`，不声明 PostgreSQL 或 Valkey 服务。新增 `docker-compose.cloud.ranked.yaml`，只定义两个长期服务：

1. `postgres`：使用固定 PostgreSQL 16 镜像，只加入内部 Compose 网络，不向宿主机公开 5432。
2. `server`：设置 `RANK_ENABLED=true`、`USE_REDIS=false`，依赖 PostgreSQL 健康；启动时只检查连接和待执行 Migration，不自动改表。

生产镜像必须包含编译后的 Migration 和不依赖 `ts-node` 的 JavaScript 执行入口。DataSource 的 Migration 发现同时适配源码环境的 `.ts` 和编译环境的 `.js`；开发期继续用 TypeORM CLI 生成迁移，部署期只运行已经随镜像评审并提交的迁移，绝不在线上生成 DDL。运维人员使用 `server` 服务镜像显式运行一次性命令，命令成功后再启动服务：

```bash
docker compose -f docker-compose.cloud.ranked.yaml up -d postgres
docker compose -f docker-compose.cloud.ranked.yaml run --rm server npm run migration:run:prod
docker compose -f docker-compose.cloud.ranked.yaml up -d server
```

Compose 不保留长期或声明式 `migrate` 服务。应用进程自身不自动修改模式，只在排位开启时检查连接与待迁移状态，确保遗漏人工迁移时快速失败。

PostgreSQL 数据使用必填的 `POSTGRES_DATA_DIR` 绑定到宿主机绝对目录，例如云主机 `/srv/nostalgia-duel-server/postgres`；WSL 本地使用 WSL ext4 文件系统中的目录，不使用 `/mnt/c` 等 Windows 挂载路径。首次空目录启动时，PostgreSQL 官方入口只通过只读挂载的 `init.sql` 安装 `uuid-ossp`；随后人工 Migration 命令创建全部业务表。后续部署不会重复执行 `init.sql`，Migration runner 只应用尚未记录的迁移。数据库口令必须由部署环境提供，不保留 `changeme` 生产默认值。

备选方案一是在 `server` 入口中每次自动运行迁移，或在 Compose 中声明自动 `migrate` 服务；两者都会削弱运维人员对线上改表时机的显式控制，因此不采用。备选方案二是把 PostgreSQL 加回原 `docker-compose.cloud.yaml` 并用 profile 切换；它会让极简部署重新携带数据库配置，违背两个部署文件职责明确的目标，因此不采用。命名卷也能在容器删除后保留数据，但宿主机路径不直观，不符合云主机显式保存、备份和迁移数据目录的要求。

## Risks / Trade-offs

- [四位数字 PIN 只有 10,000 种组合，抗暴力破解能力弱] → 对失败认证使用现有连接/API 限流，采用统一错误文案，bcrypt 保存且任何日志不记录 PIN；本变更不声称它等同高强度账号密码。
- [进程重启会清空等待房、对局、账号占用以及尚未终结的比赛/录像快照] → 明确单实例内存边界；MATCH 结束前不写部分数据，重启后允许重新进入，也不尝试恢复未完成比赛。
- [异步认证和落座可能产生并发竞争] → 认证后同步预留账号与席位，数据库唯一键处理同名注册竞争，任何准入失败都回滚预留。
- [多个终局入口可能重复更新积分] → 使用稳定 `gameId`、`matches(game_id, user_id)` 唯一约束和跨双方单事务结算，所有清理由统一终结服务收口。
- [`$` 曾被解析器当作历史签名] → 固定二进制/UTF-16 样本与协议测试明确新语义；TT 不提供静默的 `:` 回退，部署说明标记客户端输入变更。
- [裸 `TT` 隐藏了环境选择，玩家可能误以为进入 1103] → 默认格式固定为 1109，进房私有战绩消息始终显示实际房间格式，客户端文档同时保留显式 `1103#TT` 与 `1109#TT`。
- [移除旧 HTTP 排队接口会中断依赖它的客户端] → 在同一版本更新客户端说明和可访问页面；服务端对旧接口返回明确不可用，回滚旧镜像可恢复接口。
- [新增格式可能误用已有格式积分] → 格式必须来自固定格式注册表和房间不可变属性，HTTP 参数、昵称或禁限卡表名称不能决定结算格式。
- [服务器运行时区或夏令时差异可能让跨月比赛归错赛季] → 月赛季键始终显式按 `Asia/Shanghai` 从 MATCH 结束时刻计算，不读取主机本地时区；用月末边界测试固定行为。
- [`matches`、`duels`、`duel_replays` 与 `player_stats` 可能因部分写入产生漂移] → 有效比赛的全部记录必须在同一数据库事务中提交，并用仓库测试验证失败回滚、一次重试和重复终局不累加。
- [删除旧 Migration 会使使用旧历史的开发数据库无法原地升级] → 这是首次正式启用 PostgreSQL 的一次性基线重置；所有旧本地数据库视为可丢弃环境，清空后从 `init.sql` 和新初始化 Migration 重建，线上不存在需要迁移的旧 PG 数据。
- [遗留实体源码仍在仓库中可能被误注册] → DataSource 采用显式六实体清单，模式验收断言排除表和触发器不存在；源码清理另立变更，不影响运行时或查询性能。
- [总榜查询会扫描一个格式的全部月度 `player_stats`] → 使用格式、月份和用户索引；当前数据规模无需缓存，只有实际查询性能不足时才另立变更评估物化汇总。
- [MATCH 终结事务会增加结束阶段延迟] → 比赛期间零对局表 I/O；终结时只序列化至多三局录像并批量写入，事务完成前保留快照且最多立即重试一次。
- [`bytea` 会增长 PostgreSQL 数据库与备份体积] → 只保存直接 TT 排位的原始 YRP，不保存普通房或重复的双方副本，不二次保存 MATCH 级 EVRP；当前小规模无需对象存储或自动清理。
- [`duels.replay_id` 没有数据库外键，错误代码可能产生悬空关联] → 录像和双方小局详情只能由同一个终结事务适配器按固定顺序写入，不提供独立删除录像的流程，并用仓库与端到端测试校验语义完整性。
- [部署文件与 `RANK_ENABLED` 配置不一致会产生半启用状态] → 两份 Compose 固定各自开关值，应用启动测试覆盖关闭时零数据库连接和开启时失败即停，不允许环境变量把排位部署静默降级。
- [人工遗漏或执行失败的 Migration 会阻止排位服务启动] → 生产 runner 保留明确退出码和日志，应用在监听端口前检查待执行项；修复后重新运行显式命令，禁止用 `synchronize` 绕过。
- [宿主机数据目录权限、磁盘空间或备份遗漏会影响录像数据] → 部署前创建并校验明确目录，监控空间并把该目录纳入主机备份；容器不持有唯一数据副本，回滚应用镜像时保留数据库目录。

## Migration Plan

1. 先按上述 DDL 完成六个 TypeORM 实体：PIN 账号邮箱可空；`matches.game_id`、`duels.game_id` 使用 UUID；`matches.format_id`、`player_stats.format_id` 和 `duels.replay_id` 非空；新增 `DuelReplayEntity`，复用 `season`，不创建排位积分专用表。
2. 将 DataSource 实体清单裁剪为 `users`、`user_bans`、`matches`、`duels`、`player_stats`、`duel_replays`，停止注册 `UnrankedMatchSaver`；遗留实体和模块源码暂不删除，但任何普通数字房路径不得写 PostgreSQL。
3. 删除 `src/evolution-types/src/migrations/` 下全部旧 Migration。对只执行过 `init.sql` 的完全空 PostgreSQL 运行 `npm run migration:generate --name=InitialRankedSchema`，提交唯一的 `InitialRankedSchema<timestamp>.ts` 初始化基线；人工核对它只创建六张业务表且没有非排位触发器。
4. 另建一个完全空的 PostgreSQL 数据目录，先执行 `init.sql`，再运行生产 Migration runner；核对最终结构恰好是六张业务表加 TypeORM `migrations` 元数据表，并确认 `migration:run` 第二次执行没有重复 DDL。任何使用旧 Migration 历史的本地数据库直接丢弃重建。
5. 在生产代码前先加入失败测试，覆盖 `$` PIN 固定样本、裸 `TT` 固定映射 1109、自动注册竞争、直接建房/补位、跨格式唯一占用、重连期限、进房私发当前赛季战绩、每赛季从 0 分开始、普通房零 PostgreSQL 写入、比赛期间零对局表写入、MATCH 终结批量事务、双方共享单份录像、失败回滚/重试、北京时间月末边界、历史月榜和总榜汇总。
6. 构建同一应用镜像，并在 WSL 验证原 `docker-compose.cloud.yaml` 只启动关闭排位的服务、没有 PostgreSQL/Valkey 依赖、普通双格式房间可用且 TT/排行榜不可用。
7. 为 WSL 和云主机分别创建明确的 `POSTGRES_DATA_DIR`；按“启动 PostgreSQL → `docker compose run --rm server npm run migration:run:prod` → 启动 server”的顺序部署 `docker-compose.cloud.ranked.yaml`。Migration 失败时停止，不启动新服务；上线前确认没有需要保留的旧排队票据或未开始 matchmaking 房间，因为这些内存状态不会迁移。
8. 冒烟验证普通 `1103#1001`/`1109#1001`、裸 `TT` 默认 1109 与显式排位 `1103#TT`/`1109#TT`，再验证进房/重连私发当前赛季战绩、0 初始分下的 2:0/2:1 结算、每小局一份可解析 YRP、双方 `duels` 共享 `replay_id`、断线重连、两个格式的当前/历史月榜和总榜；重建容器后再次查询数据，证明宿主机目录持久化有效且没有重复迁移。
9. 首次上线后的任何模式修改都新增 Migration，不再改写 `InitialRankedSchema`。回滚应用镜像时保留 PostgreSQL 宿主机目录；需要撤销数据库结构时另写经过审核的向前修复 Migration，紧急回滚不删除排位数据。
