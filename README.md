# Nostalgia Duel Server（怀旧决斗服务器）

面向 **YGOPro 客户端** 的怀旧决斗服务器。本分支默认启动 **GOAT**，用于独立部署 GOAT 对局。

| 加入标识 | 禁限卡表 | 卡池白名单 | 规则 |
| --- | --- | ---: | --- |
| `goat#<roomId>` | `2005.4.1 W/O Exarion` | 1,740 个卡号 | TCG、大师规则 1、三局两胜 |

`roomId` 是非空十进制房间号，例如 `goat#1001`。双方使用相同标识进入同一房间。白名单中有 1,718 个卡号可入组。GOAT 排位可选开启。GOAT 模式关闭 WindBot。详见 [GOAT 资源说明](./nostalgia-resources/ygopro/formats/goat/README.md)。

> 本项目由 [EDOpro-server-ts](https://github.com/diangogav/EDOpro-server-ts) 派生而来，使用 YGOPro 协议。仓库保留原 1103/1109 资源和裁定资料，默认实例只加载 GOAT 赛制。

## 核心特性

- **YGOPro 线协议**：二字节小端长度前缀 TCP 帧，协议版本 `0x1362`，支持任意分片与粘包；同时提供 WebSocket 传输，兼容 Koishi、YGO Mobile 等客户端。非 `0x1362` 版本连接会先收到版本错误帧与升级客户端提示后断开（不做任何版本兼容）。
- **真实 WASM 决斗引擎**：基于 `koishipro-core.js` 提供的 ocgcore WASM，在线程 Worker 中运行。GOAT 使用大师规则 1，支持召唤成功后的起动效果优先权。
- **完整对局功能**：房间创建与加入、卡组校验、决斗状态流转、断线重连、聊天、表情、录像与观战。
- **GOAT 脚本**：优先查找 GOAT 目录，未命中时回退至基础 Lua。
- **固定资源、零运行时刷新**：干净检出即可启动，无资源克隆、下载、组装或刷新路径。

## 架构概览

项目采用**六边形架构 + 领域驱动设计（DDD）**，TypeScript 编写，依赖注入使用 `diod`：

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 核心领域 | `src/ygopro/`、`src/shared/` | 房间、玩家、卡组、禁限卡表、匹配、WindBot 等纯业务逻辑 |
| 管理 API | `src/http-server/` | Express REST 接口：房间列表、卡组/数据库查询、资源版本、匹配等 |
| 实时通信 | `src/socket-server/` | YGOPro TCP 与 WebSocket 连接接入 |
| 持久化 | `src/shared/infrastructure/persistence` | TypeORM + PostgreSQL（用户数据）、Redis/Valkey（缓存） |
| 固定资源 | `nostalgia-resources/` | GOAT 卡库、LFList、Lua 脚本与资源锁 |

领域层不感知数据库、HTTP 或 Socket；外部能力通过端口与依赖注入接入。核心领域使用 `koishipro-core.js` 的 ocgcore WASM 作为决斗引擎。

## 固定资源与单一版本

```text
nostalgia-resources/
├── lock.json                  # 原 2011 资源锁
└── ygopro/
    ├── base/
    │   ├── cards.cdb          # 原 2011 卡库
    │   └── script/            # 基础脚本
    └── formats/
        ├── 1103/{lflist.conf,script/}   # 环境禁限卡表 + 环境覆盖脚本
        ├── 1109/{lflist.conf,script/}
        └── goat/{cards.cdb,lflist.conf,lock.json,script/}
```

- 应用与固定资源是**同一个不可拆分版本**：代码、CDB、LFList、Lua 与 `lock.json` 随同一提交/镜像发布、升级与回滚，不存在独立资源版本或运行时刷新。
- 每场决斗的脚本查找链固定为 `formats/<format>/script` → `base/script`，**禁止**读取另一环境的脚本目录。
- GOAT 从专用 `cards.cdb` 派生白名单，并应用 `lflist.conf` 中的 `2005.4.1 W/O Exarion` 段。衍生物仅供引擎使用。
- 启动时（持久化连接与端口监听之前）、CI 与 Docker 构建执行**同一完整 lock 校验**（`npm run check:nostalgia-resources`），任何文件缺失、漂移或越界都会快速失败。
- 部署后可通过 `GET /api/resources/version` 核对镜像内实际加载的资源摘要。

## 1103/1109 历史裁定资料

为还原 2011 OCG 的原始效果处理，项目为 **12 张卡**在 1103/1109 双环境提供了 2011 裁定脚本覆盖（两环境同 ID 脚本逐字节一致），例如移除勘误新增的「卡名 1 回合 1 次」限制、恢复目标选择时点与表示形式语义等。每张覆盖均由真实 WASM 场景测试验证，且两环境逐字节一致。

裁定脚本来源于 [purerosefallen/specials](https://github.com/purerosefallen/specials/tree/master/706) 仓库的 `706` 目录（固定提交 `f993d739344f1914bcf8c54e90d638eb1fb45d45`）；导入时对无法在本核心加载的上游脚本做了最小修复，不改变 2011 裁定语义，详见下方台账。

| ID | 卡名 | 2011 行为摘要 |
| --- | --- | --- |
| 95727991 | 弹射龟 | 每回合可多次发动，解放怪兽给予其攻击力一半的伤害 |
| 26202165 | 三眼怪 | 从场上送墓时检索 ATK1500 以下怪兽；无卡名一回合一次 |
| 50321796 | 冰结界之龙 光枪龙 | 无 1 回合 1 次；丢弃任意张手牌，弹回等量对方场上卡 |
| 70583986 | 冰结界之虎王 杜罗伦 | 每实例软一回合一次；弹回全部相关目标 |
| 88264978 | 真红眼暗钢龙 | 特召手续与效果均为每实例软一回合一次 |
| 25862681 | 古代妖精龙 | 两个效果均为每实例软一回合一次 |
| 96782886 | 精神脑魔 | 无 1 回合 1 次；解放自身以外的念动力族 |
| 77565204 | 未来融合 | 发动处理时立即从卡组送融合素材，第二个自己的准备阶段融合召唤 |
| 21502796 | 光道猎犬 雷光 | 翻转效果发动时取对象（场上 1 张卡），处理时破坏目标并送卡组顶 3 张 |
| 80168720 | 暗之拜访 | 目标保持原表示形式翻为里侧（攻击表示 → 里侧攻击表示） |
| 16226786 | 深渊暗杀者 | 从手牌送墓时可将自己墓地另一张同名卡作为翻转怪兽回收 |
| 47355498 | 王家长眠之谷 | 禁止除外墓地卡；无效会移动/直接影响墓地卡的效果 |

完整台账见 **[docs/historical-card-rulings.md](./docs/historical-card-rulings.md)**：包含每张卡的 2011 行为摘要、与现代裁定差异、脚本路径、可追溯来源（Fluorohydride 历史提交、ProjectIgnis pre-errata、Konami 旧文本）及验证状态，并列出 15 张已调查但**尚未纳入运行时**的候选卡片。该台账是人工审阅记录，不进入资源锁、不被运行时扫描。

## 快速开始

前置要求：Node.js 24+。

```bash
npm ci
cp .env.example .env
npm start
```

GOAT 使用[独立决斗核心](vendor/goat-core/README.md)，支持攻击卷回后重新选择攻击者，两只 0 攻攻击表示怪兽交战时双方战斗破坏，以及同一回合内取得对方刚在其场上召唤或特殊召唤的怪兽后手动变更表示形式。

GOAT 固定资源随仓库打包，启动时校验。直接运行 `npm start` 或 `npm run dev` 即可启用 GOAT。客户端通过 TCP 端口 `706` 或决斗 WebSocket 端口 `4002` 接入。

## GOAT 天梯

本机可用 PostgreSQL 测试天梯。先在仓库根目录执行 `npm ci`。首次启动时从 `.env.example` 复制 `.env`，填写可用的 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`，并设置 `RANK_ENABLED=true`。例如，已有 Docker 时可在本机启动一个测试数据库，数据库名和账号为 `evolution`，密码与示例配置一致。

```bash
docker run -d --name goat-postgres -p 127.0.0.1:5432:5432 \
  -e POSTGRES_DB=evolution -e POSTGRES_USER=evolution \
  -e POSTGRES_PASSWORD=your-postgres-password \
  -v goat-postgres-data:/var/lib/postgresql/data postgres:16-alpine
```

数据库就绪后，从项目目录执行：

```bash
npm run build
npm run migration:run:prod
NOSTALGIA_PROFILE=goat npm start
```

客户端连接 `127.0.0.1:706`，在玩家名填写 `昵称$四位数字PIN`，例如 `玩家A$1234`，房间密码填写 `goat#TT`。新昵称首次加入时注册，之后用同一个 PIN 登录。双方都提交合法卡组并准备后，由房主点击开始。完整比赛结束后，战绩和积分按 `goat` 赛制保存。打开 `http://127.0.0.1:7922/leaderboards/goat?tab=ladder` 查看赛季或总榜。排位的卡组使用率和胜率统计仍适用于原有赛制。

服务器运行时，在另一终端执行 `npm run smoke:ranked -- 706 7922`，可用两个临时账号完成一场排位并验证积分。请在本地测试数据库执行，这场比赛会写入天梯。

## Docker 部署

在云主机上从本分支构建并运行单个 GOAT 容器。沿用示例端口时，使用以下命令。

```bash
cp .env.example .env
# 在 .env 中设置 ADMIN_API_KEY
docker build -t nostalgia-duel-server:goat .
docker run -d --name nostalgia-duel-server --restart unless-stopped \
  --env-file .env -e NODE_ENV=production \
  -p 706:706 -p 4002:4002 nostalgia-duel-server:goat
```

镜像构建和启动默认使用 GOAT。按示例配置即可单容器运行，无需 PostgreSQL 或 Redis。使用预构建镜像时，在 `.env` 中将 `SERVER_IMAGE` 指向本分支构建的镜像，再运行 `docker compose -f docker-compose.cloud.yaml up -d`。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `YGOPRO_PORT` | `706` | YGOPro TCP 端口 |
| `HTTP_PORT` | `7922` | 管理 API 端口 |
| `WEBSOCKET_PORT` | `4000` | 实时 API（WebSocket）端口 |
| `NOSTALGIA_PROFILE` | `goat` | 当前分支的默认赛制模式 |
| `RESOURCES_DIR` | `./nostalgia-resources` | 随应用打包的固定资源根（本地开发可覆盖） |

数据库、Redis、排行、限流、WindBot、备牌超时等设置见 [.env.example](.env.example)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务器（调试端口 9229） |
| `npm run build` | 构建生产代码 |
| `npm run test` | 运行全部 Jest 测试 |
| `npm run lint` | 检查代码规范 |
| `npm run check:nostalgia-resources` | 对完整资源根执行同一 lock 校验（GOAT 卡库、LFList、脚本摘要与边界检查） |
| `npm run generate:nostalgia-lock` | 在审核过的资源变更后重新生成 `nostalgia-resources/ygopro/formats/goat/lock.json` |
| `npm run smoke:duel -- [port]` | GOAT TCP 冒烟（详见下文「冒烟验证」） |
| `npm run migration:generate --name=NameOfChange` | 生成 TypeORM 迁移 |

## 冒烟验证（smoke-duel.mjs）

`scripts/smoke-duel.mjs` 用测试侧 TCP socket 驱动真实服务器完成 `goat#1001` 的房间加入、开局及换备流程，并额外以第三个 socket 验证观战，用于确认资源加载、准入、卡组校验与真实 WASM 引擎在改动后仍可用。

**前置条件**：目标服务器已运行，且本地已执行 `npm run build`。

```bash
node scripts/smoke-duel.mjs [port]      # 默认 706
npm run smoke:duel -- 17711            # 或通过 npm script 指定端口
SMOKE_PORT=17711 node scripts/smoke-duel.mjs
```

**覆盖阶段**：

1. **建房与加入**：`goat#1001` 建房，两名玩家依次加入，房间满员后第三个连接被准入为 OBSERVER，host 侧收到观众数从 0 → 1 的 `HS_WATCH_CHANGE` 广播；
2. **真实卡组校验**：从对应环境 whitelist 选取 40 张无限制（qty=3）且有 base 脚本的主卡组怪兽，经仓库内 CDB + 环境禁限卡表真实校验；
3. **真实 WASM 决斗**：双方 READY → RPS 先后手（host=ROCK / guest=PAPER 时按服务器既有判定 host 胜并选择先后手）→ 真实 ocgcore WASM 启动并发出 `MSG_START` → 投降 → `STOC_CHANGE_SIDE`；
4. **观战验证**：决斗期间观战者同样收到 `DUEL_START` 与观战视角的 `MSG_START`，且玩家席位不受影响。

**预期结果**：每个格式打印 `OK format <id>: ...`，最后 `SMOKE PASS`，退出码 0；任一格式失败（超时 / 被拒 / 校验失败）退出码为 1。注意脚本依赖仓库内 `nostalgia-resources/` 构造卡组，只能对使用固定资源的实例运行。

## 验证

```bash
npm run check:nostalgia-resources
npm run lint
npm run test
npm run build
```

修改涉及协议、资源或冒烟相关逻辑后，另需运行冒烟验证（见上文「冒烟验证」小节）验证 GOAT 真实决斗与观战流程。

## 相关文档

- [docs/historical-card-rulings.md](./docs/historical-card-rulings.md) — 历史裁定修复台账（12 张已恢复卡片 + 候选清单 + 来源）
- [docs/ops-runbook-bundled-resources.md](./docs/ops-runbook-bundled-resources.md) — 运维运行手册：应用与固定资源单一版本的发布、回滚与验证
- [docs/testing.md](./docs/testing.md) — 测试约定（就近放置、Mother、Mock 规范）
- [AGENTS.md](./AGENTS.md) — 项目开发指南（架构、SOP 与固定资源约束）

## 许可证

本项目基于 [MIT License](https://opensource.org/license/mit) 发布（与 `package.json` 中的 `license` 字段一致）。
