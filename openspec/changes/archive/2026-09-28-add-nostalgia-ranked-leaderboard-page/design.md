## Context

动机参见 [proposal.md](./proposal.md)。项目没有独立前端工程或浏览器构建链；现有根页面由 Express controller 直接返回自包含 HTML、CSS 和原生 JavaScript。`add-direct-nostalgia-ranked-rooms` 已落地以下后端能力：

- `GET /api/getrooms`：返回全部 YGOPro 房间，含 `roomname`（普通房 `format#roomId`、排位房 `format#TT`）、`formatId`、`roomnotes`（`(Mercury-Ranked)` 排位标记）、`roommode`、`istart`、`users[].name`。
- `GET /api/leaderboards/:format?scope=season&season=YYYY-MM | scope=overall`：返回 `format/scope/season?` 与 `leaderboard[]`（`rank/userId/username/points/wins/losses/winRate`）；排位关闭 503，未知格式 400；无搜索与分页。
- `duel_replays` 表按排位小局保存原始 `.yrp` bytea（默认查询不 select 二进制），`duels` 表按用户保存小局明细（`replayId`、双方 `playerNames/opponentNames`、日期、`matchId`），`matches` 表含 `anulled` 无效标记；没有任何录像列表或下载 HTTP API。
- 排位房当前没有观战路径：`TT`/`format#TT` 加入强制 PIN 且只路由到等待匹配的房间或新开房；纯数字 `format#roomId` 策略要求十进制房号，永远匹配不到排位房的 `format#TT` 准入键。房间内部 ID 由 `generateUniqueId()` 生成（1000–9999 随机数），与普通房玩家自选房号同一数字空间，且 `/api/getrooms` 已以 `roomid` 字段暴露。

本变更参考 SRVPro 的 rooms.html / replays.html / ladder.html 三个页面，将其收敛为 `/leaderboards/:format` 单页三 tab，并补齐页面所需的录像只读 API、排行榜查询扩展与排位房观战入口。约束：姊妹变更（未归档）的 `nostalgia-ranked-play` 增量规格固定「每种榜单响应必须至少包含排名、昵称、积分、胜场和负场」，因此对既有 API 只能做增量扩展，昵称打码只能在展示层实现。

## Goals / Non-Goals

**Goals:**

- 用单一参数化页面的三个 tab 覆盖房间列表、录像下载与天梯排行，服务 1103、1109 与以后显式启用的格式。
- 新增排位房无 PIN 观战入口 `format#TT<观战号>`，仅对局中（含换备间隙）可进观战，观战者永不转为玩家。
- 新增排位录像只读 API（分页列表 + `.yrp` 下载），只读既有 `duel_replays`/`duels`/`matches` 数据。
- 增量扩展排行榜 API：可选 `search`、`page`、`pageSize` 与 `total` 响应字段，缺省行为与既有契约一致。
- 天梯 tab 提供总榜/月榜切换、任意 `YYYY-MM` 月份、搜索、分页、前三名高亮与后 30% 昵称展示层打码。
- 明确处理北京时间当前月、加载、空数据、失败、排位关闭与未知格式；仅中文，手动刷新。

**Non-Goals:**

- 不修改积分结算、赛季计算、数据库模式、录像写入路径或既有排行榜默认排序。
- 不改变裸 `TT` 与 `format#TT` 的既有玩家匹配语义（需要 PIN）。
- 不允许观战等待匹配中的排位房（防止狙击），不为观战提供 PIN 或账号绑定。
- 不提供多语言切换、登录、个人中心、自动轮询、实时推送、缓存或录像清理策略。
- 不新增数据库表、列或迁移；不提供 MATCH 级 `.evrp` 存储或下载。
- 不引入 React、Vue、模板引擎、CSS 框架、外部字体或 CDN 资源。
- 不拆成三个独立 HTML 页面，也不为 1103 与 1109 复制格式专用实现。

## Decisions

### 1. 单页三 tab 的自包含页面 controller

`GET /leaderboards/:format` 返回一份参数化、自包含的 HTML/CSS/原生 JavaScript；三个 tab 是前端显示状态而非独立路由，切换不重新加载页面。交付模型与现有 `InspectPageController` 一致，不需要 npm 前端依赖、构建产物或第二个部署服务。

备选方案是照搬参考站的三个独立 HTML 页面加顶部导航。用户已明确选择保留 `/leaderboards/:format` 单路由三 tab，避免三份重复样式、脚本与路由注册，因此不采用。参考站仅作为布局与交互来源：页面标题与可见文案使用本服名称 Nostalgia Duel Server，不复制 SRVPro 标题或品牌元素。

### 2. 服务端先校验排位开关和格式

页面 controller 在返回 HTML 前先检查 `RANK_ENABLED` 与固定格式注册表：排位关闭返回明确不可用响应，未知格式返回 404；只有已启用格式才渲染页面。格式值作为经过白名单验证的数据注入页面，浏览器不从任意路径字符串推断后端地址。录像列表/下载 API 采用同一门控：关闭 503、未知格式明确拒绝。

### 3. 排位房观战入口

观战标识语法为 `^\d{4}#TT\d+$`（如 `1103#TT4821`），观战号取房间内部 ID。`TT` 前缀使其与普通房纯数字房号空间完全隔离；新的匹配分支必须在普通数字房号策略之前接管该输入——当前此类输入会落入 `NostalgiaJoinStrategy` 并因“非法房号”被拒，必须显式处理而不是回退创建普通房。

查找与准入规则：按 `formatId` 一致、`isDirectRanked`、`room.id` 等于观战号且非 `finalizing` 查找房间；房间处于对局中或换备状态时 emit `JOIN` 复用既有观战准入（创建观战者并重放历史消息）；等待匹配中的房间拒绝进入，返回不含等待玩家昵称的 YGOPro 原生序列化提示；未命中则拒绝且不创建任何房间。同格式出现内部 ID 重复的多房间病态场景时，取第一个对局中的房间并记录日志。

观战者无 PIN、凭据为 guest；对 `isDirectRanked` 房间显式阻断观战者转正路径（TO_DUEL/入座），观战者始终留在观众席。观战者不写入 `RankedRoomRegistry` 的占用与预留，不参与终结结算；裸 `TT` 与 `format#TT` 的 PIN 匹配路径保持不变。

备选方案是复用纯数字 `format#roomId` 作为观战号（与普通房自选房号冲突，需要复杂的优先级规则）或要求 PIN 才能观战（对观众不友好且无法指定具体房间），均不采用。

### 4. 录像只读 API 从 duel_replays ⋈ duels 读取

`GET /api/replays/:format` 以 `duel_replays` 为主表按 `endedAt` 倒序分页，列表查询不 select `replay_data` bytea，文件大小用 `octet_length(replay_data)` 在 SQL 侧计算；双方昵称取该 `replayId` 对应 `duels` 行的 `playerNames`/`opponentNames`；经 `matchId`/`gameId` 关联 `matches.anulled` 排除无效比赛。`search` 使用参数化查询对昵称做子串匹配，并转义 `%`、`_` 等 LIKE 通配符。`GET /api/replays/:format/:replayId` 校验录像属于路径格式后流式返回 bytea，`Content-Disposition` 文件名为 `<结束时间> <玩家1> VS <玩家2>.yrp`：时间按北京时间格式化，昵称过滤路径分隔符、控制字符与引号。两个接口响应都不包含 `userId`、IP、账号字段。

备选方案是新增录像元数据表或对象存储。数据已在库中且写入路径已固定，新增存储违反最小实现原则，因此不采用。

### 5. 排行榜 API 扩展只做增量

`GET /api/leaderboards/:format` 新增可选 `search`（username 子串，参数化匹配）、`page`、`pageSize`，响应新增 `total` 字段；缺省新参数时响应体与排序和既有契约完全一致，既有调用方与测试不受影响。月榜在 `player_stats` 行级过滤分页；总榜先按账号聚合全部月份再排序分页。`userId` 字段保留在响应中（既有契约），由页面负责不渲染。

### 6. 昵称打码在展示层实现

页面按参考页规则打码：无搜索关键词时，`名次 / 玩家总数 ≥ 0.7` 的行昵称显示为 `******`，搜索时显示真实昵称。服务端打码会违反姊妹变更固定的「响应必须至少包含昵称」契约，且昵称本就通过房间列表与对局公开，因此打码定位为展示层隐私降噪而非安全边界；直接调用 API 仍可得昵称，此权衡已记录。

### 7. 当前月固定按 Asia/Shanghai 计算

页面首次加载月榜。浏览器使用支持显式 `timeZone: "Asia/Shanghai"` 的日期格式化能力得到 `YYYY-MM`，不使用用户设备本地月份；月份控件只产生严格 `YYYY-MM`。总榜请求不携带 `season`，月榜请求必须携带当前选择的 `season`。

### 8. 每个 tab 独立状态与请求序号

房间、录像、天梯三个 tab 各自维护状态：房间 tab 保存列表与统计；录像 tab 保存页码、搜索词与结果；天梯 tab 保存 `scope`、`season`、页码、搜索词与结果。每次条件变更递增该 tab 的请求序号，响应仅在序号仍为最新时渲染，避免慢响应覆盖新选择。三个 tab 均不自动轮询，只在进入 tab、手动刷新或条件变更时请求。

DOM 通过 `textContent` 创建单元格，禁止把昵称、房名或玩家名拼入 `innerHTML`。页面不渲染 `userId`、PIN、IP 或密码字段。

### 9. 页面与后端 API 通过契约测试保持一致

controller/路由测试固定以下边界：有效格式返回三 tab 页面、未知格式拒绝、排位关闭不可用、页面只引用参数化 API 且不包含敏感字段与语言切换；观战入口的语法命中、状态准入、等待房拒绝与转正阻断；录像 API 的分页、搜索转义、格式隔离、无效比赛排除、下载字节一致性与文件名安全；排行榜 API 增量参数与缺省契约回归。浏览器脚本保持小型函数结构，使请求 URL、北京时间月份、打码阈值、过期响应忽略和纯文本渲染逻辑可在不新增 DOM 测试依赖的前提下接受聚焦测试或固定契约验证。

## Risks / Trade-offs

- [内联 HTML/CSS/JavaScript 随三 tab 增长更难维护] → 每个 tab 的脚本保持独立小函数与单一状态对象；出现更复杂交互需求时再以独立变更评估前端工程化。
- [录像 bytea 下载造成内存压力] → 列表不加载二进制，下载按单条查询并流式写出，不做批量或缓存。
- [观战号被枚举或误输] → 观战仅能获得已在公开对局中的广播内容，等待房与无效观战号明确拒绝且无任何房间副作用。
- [房间内部 ID 随机生成可能碰撞] → 观战查找只在同格式排位房范围内进行，病态多命中时取第一个对局中的房间并记录日志。
- [观战者被转正破坏排位完整性] → 对 `isDirectRanked` 房间阻断 TO_DUEL/入座两条转正路径，并以加入与状态机测试覆盖。
- [search 参数引发 LIKE 注入或通配符滥用] → 一律参数化查询并转义 `%`、`_`、`\`。
- [展示层打码可被直接调用 API 绕过] → 记录为权衡：昵称非机密数据，服务端打码与既有 API 契约冲突。
- [扩展参数破坏既有排行榜契约] → 仅新增可选参数与字段，缺省行为不变，并补默认契约回归测试。
- [`/api/getrooms` 返回全部格式房间] → 房间 tab 按 `formatId` 在展示层过滤，统计行同范围计算。
- [浏览器本地时区导致月份错误] → 显式使用 `Asia/Shanghai` 并覆盖月末边界测试。
- [快速切换导致旧响应覆盖新结果] → 每 tab 递增请求序号，仅渲染最后一次选择。
- [玩家昵称可能形成 XSS] → 所有用户数据使用 `textContent`，不允许进入 `innerHTML`。
- [窄屏表格字段过多] → 保留完整表格语义并允许横向滚动，不隐藏列。

## Migration Plan

1. 确认 `add-direct-nostalgia-ranked-rooms` 的排行榜 API、`RANK_ENABLED` 门控与 `duel_replays`/`duels` 写入已在目标环境可用。
2. 实现排位房观战入口（加入策略观战分支、状态准入与转正阻断）、录像列表/下载 API 与排行榜增量参数（含测试），不修改数据库模式或排位启动流程。
3. 实现三 tab 页面 controller 与单一路由，替换原规划的排行榜单页。
4. 在 `RANK_ENABLED=true` 环境验证 1103/1109 三个 tab：房间过滤与复制（含观战号）、录像搜索/分页/下载（`.yrp` 可被客户端解析）、天梯当前月/历史月/总榜/搜索/分页/打码/失败重试；用真实客户端或测试 socket 验证对局中排位房观战进入、等待房观战被拒与观战者不转正；在 `RANK_ENABLED=false` 与未知格式下验证明确拒绝。
5. 在桌面和不超过 480 像素的窄屏完成三 tab 验收，确认昵称按纯文本渲染。
6. 随同普通应用镜像部署，无需 Migration 或独立前端服务。回滚时恢复上一应用镜像即可，数据库与既有 API 不受影响。
