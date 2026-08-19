# 破坏性 HTTP 变化（任务 5.5）

面向调用方的对外接口变化汇总。所有变化的动机见 `proposal.md` 与 `design.md` 决策 4。

## 路由级变化

| 路由 | 变化前 | 变化后 |
| --- | --- | --- |
| `POST /api/room` | 创建 EDOPro 房间，返回 `200` + 房间密码 | 返回 `501` + `{ success: false, errors: [{ code: "unsupported", message: "EDOPro room creation is no longer supported" }] }`，不再创建任何房间 |
| `GET /api/banlists/:engine/:name` | `engine` 接受 `edopro`/`ygopro` | 仅接受 `ygopro`；`edopro` 返回 `400` `{ error: "unknown engine or ban list" }` |
| `GET /api/databases/cards?engine=…` | `engine` 接受 `edopro`/`ygopro` | 仅接受 `ygopro`；`edopro` 返回 `400` `{ error: "engine and source are required" }` |

## 响应结构变化

| 路由 | 移除的字段 | 保留部分 |
| --- | --- | --- |
| `GET /api/databases` | 顶层 `edopro` 数组 | `{ ygopro: string[] }` |
| `GET /api/banlists` | 顶层 `edopro` 数组 | `{ ygopro: BanListView[] }` |
| `GET /api/resources/version` | 顶层 `edopro` 节（`cardDbFingerprint`）与 `banlists.edopro` | `schemaVersion`、`ygopro`、`banlists.ygopro`、`banlists.reloadedAt` |
| `GET /api/cards?engine=…` | EDOPro 卡片结果；`engine` 过滤参数现在被忽略 | `{ results }`，每条结果 `engine` 恒为 `"ygopro"` |
| `GET /api/getrooms` | EDOPro 房间条目 | `{ rooms }` 仅含 YGOPro 房间 |

不保留空的 `edopro` 数组/对象：空值会错误宣称系统仍支持该引擎（design.md 决策 4）。

## 行为变化

- `POST /api/admin/message`：仅遍历 YGOPro 房间；消息改用 YGOPro `STOC_CHAT`（0x19）帧序列化，不再发送 EDOPro `ServerMessage` 帧。
- `GET /`（检查页面）：移除引擎选择器与 EDOPro 样式/数据假设，仅展示 YGOPro 禁限卡表、数据库与卡片搜索。
- `GET /api/rooms`、`/api/matchmaking/*`：无变化（本就仅 YGOPro）。

## 验证

`src/http-server/YGOProOnlyHttpContract.test.ts`（11 个用例）与各控制器同目录测试锁定上述契约；`src/ArchitectureGuard.test.ts` 保证 HTTP 层不再导入 EDOPro 模块。
