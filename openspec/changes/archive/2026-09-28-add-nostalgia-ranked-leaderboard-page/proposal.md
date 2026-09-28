## Why

排位后端的账号、结算与排行榜 API 已由 `add-direct-nostalgia-ranked-rooms` 落地，录像也已按小局持久化到 `duel_replays`，但没有任何浏览器可见的展示入口。参考 SRVPro 的 rooms.html / replays.html / ladder.html 三个页面，玩家最需要的三类信息是实时房间、排位录像下载和天梯排行；将其收敛为单一参数化页面的三个 tab，可以在不引入前端工程链的前提下一次性补齐展示层，并避免三份重复的样式与路由。

## What Changes

- `GET /leaderboards/:format` 页面扩展为单页三 tab：房间列表、录像下载、天梯排行；当前支持 1103 与 1109，页面自包含 HTML/CSS/原生 JavaScript，不做三个独立 HTML 页面。
- 房间列表 tab 复用现有 `GET /api/getrooms`，按当前页面格式过滤展示房名、类型（排位/普通）、模式、玩家与状态，提供统计行（房间总数、对局中、在线玩家、更新时间）；普通房提供复制加入标识，排位房展示观战号并提供复制 `format#TT<观战号>`；不显示房间密码。
- 新增排位房无 PIN 观战入口 `<format>#TT<观战号>`：仅对局中（含换备间隙）的排位房可按观战号准入观战者，观战者永不转为玩家、不计入占用与统计；等待匹配中、终结中、不存在或格式不匹配的观战号明确拒绝；裸 `TT` 与 `format#TT` 的既有 PIN 匹配语义不变。
- 新增排位录像只读 API：`GET /api/replays/:format`（分页列表，默认每页 20 条，支持按玩家昵称搜索）与 `GET /api/replays/:format/:replayId`（下载原始 `.yrp` 字节，文件名含结束时间与双方昵称）；数据源为既有 `duel_replays`/`duels` 表，不新增数据库表或迁移。
- `GET /api/leaderboards/:format` 增量扩展可选 `search`、`page`、`pageSize` 参数并在响应中新增 `total` 字段；缺省参数时与 `add-direct-nostalgia-ranked-rooms` 已固定的契约完全兼容。
- 天梯排行 tab 提供总榜/月榜切换与任意 `YYYY-MM` 历史月份查询，展示排名、玩家、总积分、总场次（胜场+败场）、胜场、败场、胜率，前三名高亮，每页 50 条分页，支持玩家昵称搜索；无搜索时排名位于后 30% 的玩家昵称在展示层显示为 `******`，搜索时显示真实昵称。
- 页面标题与可见文案使用本服名称 Nostalgia Duel Server，不出现 SRVPro 等外部品牌；不提供多语言切换，仅中文；三个 tab 均不自动刷新，提供手动刷新。
- 未启用格式不得回退到 1103、1109 或跨格式页面；页面无需登录，且不得展示账号 ID、`userId`、PIN、IP、密码等敏感字段。

## Capabilities

### New Capabilities

- `nostalgia-ranked-leaderboard-page`: 定义三 tab（房间列表、录像下载、天梯排行）参数化页面、排位房观战入口、录像只读 API、排行榜查询增量扩展、数据状态、展示层打码和格式隔离的浏览器可见行为。

### Modified Capabilities

无。对 `/api/leaderboards/:format` 的扩展仅为可选参数与新增字段，不修改 `add-direct-nostalgia-ranked-rooms` 中 `nostalgia-ranked-play` 已固定的默认响应契约；观战入口为新增准入路径，裸 `TT` 与 `format#TT` 的既有匹配语义不变。

## Impact

- HTTP 层：页面 controller 扩展、新增录像列表/下载 controller、排行榜 controller 增量参数，以及对应路由与契约测试。
- 房间加入层：排位加入策略新增观战分支（`format#TT<观战号>` 语法、按状态准入、观战者转正阻断），以及对应加入与结算隔离测试。
- 数据库：只读访问既有 `duel_replays`、`duels`、`player_stats` 表；不新增表、列或迁移。
- 页面依赖 `add-direct-nostalgia-ranked-rooms` 已实现的排行榜 API 与排位录像持久化；录像 API 与页面 tab 同属本变更，一起上线。
- 不引入前端框架、模板引擎、CDN、外部字体或多语言资源。
