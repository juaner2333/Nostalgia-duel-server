# Nostalgia Duel Server（怀旧决斗服务器）

面向 **YGOPro 客户端** 的怀旧 OCG 决斗服务器，仅提供两个固定环境：**1103**（OCG 2011.03）与 **1109**（OCG 2011.09）。卡池、禁限卡表、Lua 脚本与裁定均为固定历史版本，随应用单一版本发布，绝不跟随上游浮动更新。

| 加入标识 | 禁限卡表 | 卡池 | 规则 |
| --- | --- | --- | --- |
| `1103#<roomId>` | OCG 2011.03 | 5,002 张 | OCG、Master Rule 2、三局两胜 |
| `1109#<roomId>` | OCG 2011.09 | 5,120 张 | OCG、Master Rule 2、三局两胜 |

`roomId` 是非空十进制房间号，不是密码。`1103#1001` 与 `1109#1001` 是相互隔离的两个房间——`format` 与 `roomId` 的组合才是房间身份。

> 本项目由 [EDOpro-server-ts](https://github.com/diangogav/EDOpro-server-ts) 派生而来，在移除 EDOPro 支持后，重构为仅面向 YGOPro 客户端、使用固定 1103/1109 怀旧环境的决斗服务器。

## 核心特性

- **YGOPro 线协议**：二字节小端长度前缀 TCP 帧，协议版本基准为 `0x1362`，并直接兼容支持 `0x1361` 实时对局客户端（下发帧按协议自动适配转换），支持任意分片与粘包；同时提供 WebSocket 传输，兼容 Koishi、YGO Mobile 等客户端。未支持版本连接会先收到版本错误帧与升级客户端提示后断开。
- **真实 WASM 决斗引擎**：基于 `koishipro-core.js` 提供的 ocgcore WASM，在线程 Worker 中运行，还原 2011 年 OCG 效果处理。
- **完整对局功能**：房间创建与加入、卡组校验、决斗状态流转、断线重连、聊天、表情、录像、匹配、WindBot 与观战。
- **历史裁定覆盖**：为已确认的 12 张卡片恢复 2011 OCG 裁定（见下文「历史裁定覆盖」）。
- **固定资源、零运行时刷新**：干净检出即可启动，无资源克隆、下载、组装或刷新路径。

## 架构概览

项目采用**六边形架构 + 领域驱动设计（DDD）**，TypeScript 编写，依赖注入使用 `diod`：

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 核心领域 | `src/ygopro/`、`src/shared/` | 房间、玩家、卡组、禁限卡表、匹配、WindBot 等纯业务逻辑 |
| 管理 API | `src/http-server/` | Express REST 接口：房间列表、卡组/数据库查询、资源版本、匹配等 |
| 实时通信 | `src/socket-server/` | YGOPro TCP 与 WebSocket 连接接入 |
| 持久化 | `src/shared/infrastructure/persistence` | TypeORM + PostgreSQL（用户数据）、Redis/Valkey（缓存） |
| 固定资源 | `nostalgia-resources/` | 1103/1109 卡池、LFList、Lua 脚本与资源锁 |

领域层不感知数据库、HTTP 或 Socket；外部能力通过端口与依赖注入接入。核心领域使用 `koishipro-core.js` 的 ocgcore WASM 作为决斗引擎。

## 固定资源与单一版本

```text
nostalgia-resources/
├── lock.json                  # 资源锁：全部资源摘要
└── ygopro/
    ├── base/
    │   ├── cards.cdb          # 唯一基础数据库（5,120 实卡 + 79 个脚本引用 token 元数据）
    │   └── script/            # 基础脚本
    └── formats/
        ├── 1103/{lflist.conf,script/}   # 环境禁限卡表 + 环境覆盖脚本
        └── 1109/{lflist.conf,script/}
```

- 应用与固定资源是**同一个不可拆分版本**：代码、CDB、LFList、Lua 与 `lock.json` 随同一提交/镜像发布、升级与回滚，不存在独立资源版本或运行时刷新。
- 每场决斗的脚本查找链固定为 `formats/<format>/script` → `base/script`，**禁止**读取另一环境的脚本目录。
- 两份 `lflist.conf` 中的 `$whitelist` 是各环境卡池与禁限数量的唯一事实来源；运行时按它过滤唯一基础 CDB（同时保留脚本引用的 token 虚拟卡元数据，供引擎 `Duel.CreateToken` 读取；token 不可入卡组）。
- 启动时（持久化连接与端口监听之前）、CI 与 Docker 构建执行**同一完整 lock 校验**（`npm run check:nostalgia-resources`），任何文件缺失、漂移或越界都会快速失败。
- 部署后可通过 `GET /api/resources/version` 核对镜像内实际加载的资源摘要。

## 历史裁定覆盖

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
npm run dev
```

固定 1103/1109 资源已随仓库打包在 `nostalgia-resources/` 中，启动时全量校验。干净检出在安装依赖、创建环境文件后即可直接启动，无需任何资源准备步骤。

## 可选中间件（不依赖 PostgreSQL / Redis 启动）

PostgreSQL 与 Redis/Valkey 都是**可选依赖**，最小启动不需要任何中间件：

- **PostgreSQL**：仅当 `RANK_ENABLED=true`（排行与统计持久化）时才连接；
- **Redis / Valkey**：仅当 `USE_REDIS=true` 时才连接。无 Redis 时握手门票校验 fail-closed（不授予 rank 资格）、HTTP 限流 fail-open（直接放行），不影响启动与正常对局。

`.env.example` 默认值即为零中间件组合（`USE_REDIS=false`、`RANK_ENABLED=false`），本地只需 `cp .env.example .env` 后 `npm run dev`。

Docker 方式（只启动 server，不启动 postgres/valkey）：

```bash
# 方式一：compose 单服务启动（--no-deps 跳过 postgres/valkey 依赖）
USE_REDIS=false RANK_ENABLED=false docker compose -f docker-compose.prod.yaml up --no-deps -d server

# 方式二：直接运行镜像
docker compose -f docker-compose.prod.yaml build server
docker run -d --name nostalgia-duel-server \
  -p 706:706 -p 7922:7922 -p 4000:4000 \
  -e NODE_ENV=production -e USE_REDIS=false -e RANK_ENABLED=false \
  evolutionygo-server
```

注意：`docker-compose.prod.yaml` 中 server 服务默认 `USE_REDIS=true`、`RANK_ENABLED=true` 且 `depends_on` 中间件健康检查，因此不带环境变量覆盖的 `up` 会连带启动 postgres/valkey；完整三服务部署见下文 [Docker 部署](#docker-部署)。

## 云主机部署（镜像直拉）

无需中间件（无 PostgreSQL / Valkey，与压测基线一致）时，使用独立的镜像直拉编排，不依赖源码构建：

```bash
cp .env.example .env                                # 填 SERVER_IMAGE 与 ADMIN_API_KEY
chmod 600 .env
# 不同环境只需改 SERVER_IMAGE 的 registry 前缀；仓库名后缀与 tag 必须与发布版本一致
docker compose -f docker-compose.cloud.yaml pull     # 镜像不存在/不一致直接失败
docker compose -f docker-compose.cloud.yaml up -d
```

- 密钥（`ADMIN_API_KEY`）只存在于服务器 `.env`（600 权限，已入 `.gitignore`），仓库只有 `.env.example` 占位符
- 端口：`YGOPRO_PORT`(706) / `HTTP_PORT`(7922) / `WEBSOCKET_PORT`(4000) / `4002`
- `ulimits nofile 65535` 已内置（在线连接上限不受容器默认 1024 限制）
- 回滚：修改 `.env` 中 `SERVER_IMAGE` 的 tag 后 `up -d`，或 `docker compose down` 后用旧镜像重新拉起

## Docker 部署

```bash
docker compose -f docker-compose.prod.yaml up -d --build
```

构建时对完整固定资源根执行校验，然后把 `nostalgia-resources/` 与代码一起直接拷入最终镜像。容器入口直接启动 Node.js 服务，运行时不做任何资源供给、刷新或发布。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `YGOPRO_PORT` | `706` | YGOPro TCP 端口 |
| `HTTP_PORT` | `7922` | 管理 API 端口 |
| `WEBSOCKET_PORT` | `4000` | 实时 API（WebSocket）端口 |
| `RESOURCES_DIR` | `./nostalgia-resources` | 随应用打包的固定资源根（本地开发可覆盖） |

数据库、Redis、排行、限流、WindBot、备牌超时等设置见 [.env.example](.env.example)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务器（调试端口 9229） |
| `npm run build` | 构建生产代码 |
| `npm run test` | 运行全部 Jest 测试 |
| `npm run lint` | 检查代码规范 |
| `npm run check:nostalgia-resources` | 对完整资源根执行同一 lock 校验（数据库、双环境 LFList、脚本摘要与边界检查） |
| `npm run generate:nostalgia-lock` | 在审核过的资源变更后重新生成 `nostalgia-resources/lock.json` |
| `npm run smoke:duel -- [port]` | 双环境 TCP 冒烟（详见下文「冒烟验证」） |
| `npm run migration:generate --name=NameOfChange` | 生成 TypeORM 迁移 |

## 冒烟验证（smoke-duel.mjs）

`scripts/smoke-duel.mjs` 用测试侧 TCP socket 驱动真实服务器完成 `1103#1001` 与 `1109#1001` 的双环境完整决斗流程，并额外以第三个 socket 验证观战，用于确认资源加载、准入、卡组校验与真实 WASM 引擎在改动后仍可用。

**前置条件**：目标服务器已运行（本地 `npm run dev` 或容器均可）且可连接 Redis（无本地 Redis 时可临时 `docker run -d -p 6379:6379 valkey/valkey:9.0-alpine`）。

```bash
node scripts/smoke-duel.mjs [port]      # 默认 706
npm run smoke:duel -- 17711            # 或通过 npm script 指定端口
SMOKE_PORT=17711 node scripts/smoke-duel.mjs
```

**覆盖阶段**：

1. **建房与加入**：`1103#1001` / `1109#1001` 建房，两名玩家依次加入，房间满员后第三个连接被准入为 OBSERVER，host 侧收到观众数从 0 → 1 的 `HS_WATCH_CHANGE` 广播；
2. **真实卡组校验**：从对应环境 whitelist 选取 40 张无限制（qty=3）且有 base 脚本的主卡组怪兽，经仓库内 CDB + 环境禁限卡表真实校验；
3. **真实 WASM 决斗**：双方 READY → RPS 先后手（host=ROCK / guest=PAPER 时按服务器既有判定 host 胜并选择先后手）→ 真实 ocgcore WASM 启动并发出 `MSG_START` → 投降 → `MATCH_END`；
4. **观战验证**：决斗期间观战者同样收到 `DUEL_START` 与观战视角的 `MSG_START`，且玩家席位不受影响。

**预期结果**：每个格式打印 `OK format <id>: ...`，最后 `SMOKE PASS`，退出码 0；任一格式失败（超时 / 被拒 / 校验失败）退出码为 1。注意脚本依赖仓库内 `nostalgia-resources/` 构造卡组，只能对使用固定资源的实例运行。

## 验证

```bash
npm run check:nostalgia-resources
npm run lint
npm run test
npm run build
```

修改涉及协议、资源或冒烟相关逻辑后，另需运行冒烟验证（见上文「冒烟验证」小节）验证双环境真实决斗与观战流程。

## 相关文档

- [docs/historical-card-rulings.md](./docs/historical-card-rulings.md) — 历史裁定修复台账（12 张已恢复卡片 + 候选清单 + 来源）
- [docs/ops-runbook-bundled-resources.md](./docs/ops-runbook-bundled-resources.md) — 运维运行手册：应用与固定资源单一版本的发布、回滚与验证
- [docs/testing.md](./docs/testing.md) — 测试约定（就近放置、Mother、Mock 规范）
- [AGENTS.md](./AGENTS.md) — 项目开发指南（架构、SOP 与固定资源约束）

## 许可证

本项目基于 [MIT License](https://opensource.org/license/mit) 发布（与 `package.json` 中的 `license` 字段一致）。
