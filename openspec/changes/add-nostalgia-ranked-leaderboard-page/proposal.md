## Why

排位后端需要先稳定账号、结算、排行榜 API 和部署边界，排行榜页面若混在同一变更中会扩大实现与验收范围。将页面独立后，可以在不影响排位核心上线的前提下单独设计、实现和维护浏览器端展示。

## What Changes

- 新增公开的参数化排行榜页面 `GET /leaderboards/:format`，当前支持 1103 与 1109，并复用同一页面结构支持以后显式启用的格式。
- 页面消费 `add-direct-nostalgia-ranked-rooms` 提供的 `/api/leaderboards/:format`，不新增数据库表、积分算法或排行榜后端数据源。
- 页面提供总榜与月赛季榜切换；月榜默认使用北京时间当前月份，并允许用户通过月份控件查询其他 `YYYY-MM` 月份。
- 排行榜以表格展示排名、昵称、积分、胜场和负场，并提供加载中、空榜、请求失败和排位关闭等明确状态。
- 未启用格式不得回退到 1103、1109 或跨格式页面；页面无需登录，且不得展示账号 ID、PIN 或录像数据。

## Capabilities

### New Capabilities

- `nostalgia-ranked-leaderboard-page`: 定义参数化排位排行榜页面、总榜/月榜交互、月份选择、数据状态和格式隔离的浏览器可见行为。

### Modified Capabilities

无。

## Impact

- HTTP 页面路由与独立页面 controller，以及对应路由和页面契约测试。
- 复用现有内联 HTML/CSS/JavaScript 页面交付方式和已规划的排行榜 JSON API，不新增前端框架或第三方运行时依赖。
- 页面依赖 `add-direct-nostalgia-ranked-rooms` 先提供稳定的 1103/1109 月榜与总榜 API；该依赖未就绪时不应单独上线页面。
