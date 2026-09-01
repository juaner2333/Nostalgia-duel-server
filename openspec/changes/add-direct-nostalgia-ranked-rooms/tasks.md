## 1. PIN 协议与账号领域

- [ ] 1.1 为 `PlayerInfo` 增加人工固定 UTF-16LE 样本和失败测试，覆盖 `昵称$1234`、缺少/多余 `$`、非数字或非四位 PIN、协议长度上限以及显示名不泄露 PIN，并先确认测试失败。
- [ ] 1.2 以最小改动扩展 `PlayerInfoMessage`，保留纯昵称和独立 `rankedPin`，使 TT 严格使用 `$` 四位数字语法，同时保持非 TT 所需兼容行为并通过聚焦测试。
- [ ] 1.3 为 PIN“认证或注册”应用用例增加失败测试，覆盖已有账号成功、错误 PIN、封禁账号、首次自动注册和同名唯一键竞争后的重新验证。
- [ ] 1.4 实现 PIN 认证/自动注册用例及所需仓库端口，复用 `UserProfile`、bcrypt、精确昵称唯一键和现有封禁查询，不记录明文 PIN。
- [ ] 1.5 增加日志与 YGOPro 拒绝消息测试，确认所有认证失败使用统一提示，日志、异常和展示数据均不包含 PIN。

## 2. 排位持久化模式

- [ ] 2.1 为格式排位持久化模型和仓库端口增加失败测试，覆盖稳定 `gameId`、每名玩家一条 MATCH 明细、`(userId, formatId, season)` 唯一月统计、每局一份共享录像、北京时间结束月份 `YYYYMM`、每个格式每月从 0 分开始，以及小局净胜分 `2:0 => ±2`、`2:1 => ±1`。
- [ ] 2.2 以最小改动扩展现有 `UserProfileEntity`、`MatchResumeEntity`、`PlayerStatsEntity` 和 `DuelResumeEntity`：PIN 账号允许空邮箱，`matches.gameId`/`duels.gameId` 使用 UUID，比赛/统计增加非空 `formatId`，小局增加纯 UUID 的非空 `replayId` 且不声明数据库关系；新增 `DuelReplayEntity`，把 `replayData` 映射为 `bytea` 且默认查询不选择二进制。
- [ ] 2.3 将 DataSource 显式裁剪为 `UserProfileEntity`、`UserBanEntity`、`MatchResumeEntity`、`DuelResumeEntity`、`PlayerStatsEntity` 和 `DuelReplayEntity` 六个实体；停止注册 `UnrankedMatchSaver`，但暂不删除遗留实体/模块源码，并增加普通数字房零 PostgreSQL 写入测试。
- [ ] 2.4 删除 `src/evolution-types/src/migrations/` 下全部旧 Migration；对只完成 `init.sql` 的完全空库执行 `npm run migration:generate --name=InitialRankedSchema`，提交唯一的 `InitialRankedSchema<timestamp>.ts`，逐项对照 `design.md` 完整 DDL并确认不含非排位表或触发器。
- [ ] 2.5 在另一个完全空库运行生产 Migration runner，验证第一次创建且只创建六张业务表和 TypeORM `migrations` 元数据表、第二次无重复 DDL；通过 PostgreSQL 仓库测试验证同名注册竞争、非空格式/录像约束、双方 `duels` 共享同一语义 `replayId` 且能查到对应录像、非空录像数据约束和查询默认不加载 `bytea`。

## 3. 直接排位房选择与占用

- [ ] 3.1 为内存排位注册表增加失败测试，覆盖账号跨格式唯一占用、同账号重复请求返回原房、同步席位预留、准入失败回滚和幂等释放。
- [ ] 3.2 实现最小内存注册表及领域/应用端口，以 `userId` 索引房间归属并只保存待落座预留；房间聚合继续作为玩家和状态事实来源。
- [ ] 3.3 为直接合房用例增加失败测试，覆盖第一人立即建房、第二人加入最早同格式等待房、满员/开战/终结房跳过、1103/1109 隔离以及未来注册格式复用。
- [ ] 3.4 实现直接合房应用用例和固定格式排位房工厂，显式标识 External 真人排位房，原子执行“恢复 / 补位 / 建房”并复用现有规则、卡池、禁限卡表和脚本。
- [ ] 3.5 为 TT 加入策略增加失败测试，覆盖精确裸 `TT` 固定映射 `1109#TT`、显式大写 `format#TT`、裸 `tt`、无效格式、额外 `#` 分段和 PIN 失败无房间副作用，并确认裸 `TT` 不查找 1103、普通 `format#数字` 回归不变。
- [ ] 3.6 将专用 TT 策略接入普通怀旧策略之前，把裸 `TT` 规范化为固定 `1109#TT`，再通过一次认证结果完成准入；接入账号占用登记和失败回滚，保证既有 1103 占用优先恢复原房，不在策略层复制业务规则。
- [ ] 3.7 扩展房间列表/展示测试，确认直接排位房可被后续玩家发现、不会被当成普通匿名房或 AI 房，并且内部数字房号不会让 1103/1109 串房。

## 4. 排位断线重连与生命周期

- [ ] 4.1 为账号级排位重连增加失败测试，覆盖同账号不同 IP 接管、最后连接生效、原位置与阶段恢复、其他账号不能接管，以及重复进入不同格式仍回原房。
- [ ] 4.2 为排位玩家 90 秒期限增加失败测试，覆盖单方窗口内恢复、单方到期按投降、双方无唯一胜者只清理、等待阶段退出不计分和重复计时/清理幂等。
- [ ] 4.3 扩展房间与断线处理，使直接排位房按玩家持有重连期限并复用现有 socket 接管与状态同步；普通匿名房、现有房间级宽限和 AI 生命周期保持不变。
- [ ] 4.4 将等待离房、正常终局、投降、重连到期和异常清理全部接入统一终结服务，在其中取消计时器并释放所有账号占用；增加防止僵尸 Map 记录的回归测试。

## 5. MATCH 终结批量持久化

- [ ] 5.1 为排位终结应用服务增加失败测试，证明第一小局结束和换备期间只更新房间内存，`matches`、`duels`、`duel_replays`、`player_stats` 均无读写；账号准入数据库访问不受此约束。
- [ ] 5.2 为排位房生成稳定 `gameId`，并在 MATCH 终结时构造包含不可变 `formatId`、双方 `userId`、结束时间和全部小局记录的持久化快照；按 `Asia/Shanghai` 计算整数 `YYYYMM`，不通过昵称、禁限卡表或人工 `config.season` 决定归属。
- [ ] 5.3 为录像序列化增加固定测试，证明每个 `DuelRecord` 只生成一份可由 `YGOProYrp.fromYrp` 解析的原始 `.yrp/.yrp2` 字节，不含 TCP/STOC 帧头、不二次 gzip，并与客户端收到的对应录像内容一致。
- [ ] 5.4 为 PostgreSQL 事务适配器增加测试，证明有效 MATCH 终结后在一个事务中写入双方 `matches`、每局一条 `duel_replays`、双方逐局 `duels` 及共享 `replayId`，再从 0 分起点 upsert 双方月度 `player_stats`；任一写入失败时全部回滚。
- [ ] 5.5 增加幂等和失败测试：重复终局不重复写入或加分，首次事务失败使用相同 `gameId`/`duelIndex`/`replayId` 立即重试一次，重试仍失败时没有部分比赛、部分录像或单方积分。
- [ ] 5.6 增加无结果与普通房测试：直接 TT 房没有唯一胜者但已有完成小局时只批量保存录像，等待阶段关闭不保存；普通数字房继续向客户端发送录像，但不写 `users`、`matches`、`duels`、`player_stats`、`duel_replays` 或任何其他 PostgreSQL 表。
- [ ] 5.7 调整统计订阅启动和既有处理边界，移除普通房 `UnrankedMatchSaver` 与旧 Global/禁限卡表写入，确保终局快照在数据库事务完成或最终失败前不会被房间清理释放，并让一个 YGOPro 终局仍恰好通知所有实际配置的订阅者。

## 6. 月赛季榜、总榜 API 与进房提示

- [ ] 6.1 为排行榜和个人赛季战绩查询用例增加失败测试，覆盖指定 `YYYY-MM` 月榜、合法空月份、跨全部月份的总榜求和、格式隔离、只展示有有效比赛的账号、`points DESC / wins DESC / username ASC` 稳定排序，以及未参赛账号返回 0 分/0 胜/0 负/0%/未上榜但不创建统计行。
- [ ] 6.2 实现格式排行榜查询端口、PostgreSQL 适配器和应用用例：月榜直接读取指定 `(formatId, YYYYMM)` 的 `player_stats`，总榜按用户汇总该格式全部月份的 `player_stats`，个人查询复用同一排序计算当前月名次和 MATCH 胜率；不扫描 `matches` 且不维护第二份累计数据，使用固定格式注册表校验。
- [ ] 6.3 为 `GET /api/leaderboards/:format` 增加 controller/路由测试，覆盖 `scope=season&season=YYYY-MM`、`scope=overall`、1103/1109 隔离、无需登录访问、未知格式以及缺少/冲突/非法查询参数。
- [ ] 6.4 为排位进房提示增加失败测试并实现接口适配：成功取得或重连玩家席位后向新连接恰好私发一次实际房间格式的当前 `YYYY-MM` 积分、胜场、败场、胜率和排名；裸 `TT` 新进房显示 1109，既有 1103 占用通过裸 `TT` 重连显示 1103，观战或准入失败不发送且不向他人广播。

## 7. 移除旧排队编排

- [ ] 7.1 先修改 HTTP 和启动契约测试，要求旧排队创建、状态、取消接口不可用，应用启动不再初始化队列 tick、房间 reaper或 matchmaking WindBot 兜底。
- [ ] 7.2 删除旧 matchmaking queue、票据轮询 controllers/routes、队列 bootstrap、房间 reaper和仅服务于自动兜底的代码/测试；保留显式 WindBot/AI 房及其他仍有消费者的通用票据能力。
- [ ] 7.3 清理因删除队列产生的 imports、配置、启动顺序和测试桩，确认直接排位房工厂没有依赖 HTTP 票据、Redis 或定时轮询。

## 8. 排位开关与双部署模式

- [ ] 8.1 为启动契约增加失败测试：`RANK_ENABLED=false` 时不初始化或查询 PostgreSQL、普通数字房继续可用、裸 `TT` 与显式 `format#TT` 均被拒绝且排行榜返回不可用；`RANK_ENABLED=true` 时连接失败或存在待执行 Migration 必须发生在端口监听前并阻止启动。
- [ ] 8.2 以 `RANK_ENABLED` 统一门控排位认证、TT 合房、终结持久化和排行榜，复用现有可选持久化 bootstrap；关闭时保持零数据库依赖，开启时初始化 DataSource 并检查 Migration 状态，不增加静默降级分支。
- [ ] 8.3 为生产 Migration runner 增加失败测试，证明编译后的 JavaScript DataSource 能发现初始化基线及以后追加的 `.js` Migration、空库可应用基线、已有库只应用待执行项，并且任一 Migration 失败返回非零退出码。
- [ ] 8.4 实现不依赖 `ts-node` 的生产 Migration 入口，调整 DataSource 兼容源码 `.ts` 与产物 `.js`，确保 Docker 最终镜像包含编译后的 Migration 和所需生产依赖；保留 `synchronize: false`，不在运行时生成 DDL。
- [ ] 8.5 保持 `docker-compose.cloud.yaml` 为 `RANK_ENABLED=false`、`USE_REDIS=false` 的单服务极简编排；新增 `docker-compose.cloud.ranked.yaml`，只定义长期运行的内部 PostgreSQL 与 `RANK_ENABLED=true`/`USE_REDIS=false` 服务，不声明 `migrate` 或 Valkey 服务，也不公开 5432。
- [ ] 8.6 让排位 Compose 要求部署环境提供数据库口令和绝对 `POSTGRES_DATA_DIR`，把该目录绑定到 PostgreSQL 数据目录并只读挂载 `init.sql`；通过 `docker compose config` 和 WSL 集成测试验证“启动 PostgreSQL → `docker compose run --rm server npm run migration:run:prod` → 启动 server”的人工流程、迁移失败不启动服务、容器重建保留数据及重复执行不产生 DDL。

## 9. 文档、回归与验收

- [ ] 9.1 更新客户端、部署和项目边界文档，明确 `RANK_ENABLED` 两种行为、`docker-compose.cloud.yaml` 极简模式、`docker-compose.cloud.ranked.yaml` 排位模式、WSL/云主机数据目录与备份、人工 Migration 命令及后续追加规则，以及裸 `TT` 默认 1109、显式 `1103#TT`/`1109#TT`、`昵称$4位数字密码`、进房私有赛季战绩提示、每赛季 0 初始积分、普通数字房零 PostgreSQL 写入、月榜/总榜、旧排队 API 移除和重启不恢复对局。
- [ ] 9.2 扩展仓库内 TCP 测试/冒烟脚本，覆盖裸 `TT` 映射 1109、两个显式格式第一人建房、第二人补位、进房/重连私发赛季战绩、真实 MATCH、比赛期间零对局表写入、0 初始分下的 2:0/2:1 终结批量结算、每局 YRP 入库、同账号跨格式阻止、断线重连、当前/历史月榜及总榜，同时保留普通双环境与观战冒烟。
- [ ] 9.3 运行全部聚焦测试并确认新增用例通过，再运行 `npm run lint`、`npm run test`、`npm run check:nostalgia-resources` 和 `npm run build`，修复本变更引入的回归。
- [ ] 9.4 分别完成两种本地端到端验收：极简 Compose 不创建 PostgreSQL/Valkey 且普通房可用；排位 Compose 先人工应用初始化 Migration，核对数据库仅有六张业务表和 `migrations` 元数据表、账号密码为摘要、普通房及排位比赛中均无对局表写入、终结后 `matches`/`duels`/`duel_replays`/`player_stats` 原子且幂等、双方共享录像、原始 YRP 可解析、北京时间跨月归属、1103/1109 隔离、房间终结后 Map 释放，并在重建容器后确认数据仍存在和重复迁移无 DDL。
