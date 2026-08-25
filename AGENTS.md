# AGENTS.md - 怀旧决斗服务器开发指南

## 如何使用本指南

- **从这里开始**：本文件定义 `Nostalgia-duel-server` 的项目边界、开发规则和工作流。
- **严格遵守**：必须无例外地遵守“首要准则”“归档规格约束”和“技能自动调用规则”。
- **架构背景**：本项目采用高性能的六边形架构与领域驱动设计（DDD）。
- **局部规则**：修改子目录前还需读取该目录中的 `AGENTS.md`；发生冲突时，以离目标文件最近的规则为准。

## 项目概览

| 组件 | 位置 | 技术栈 | 说明 |
| --- | --- | --- | --- |
| **核心领域** | `src/ygopro/`、`src/shared/` | TypeScript、DDD | 业务逻辑、实体、值对象 |
| **管理 API** | `src/http-server/` | Express、Diod | 管理、匹配与查询 REST 接口 |
| **实时通信** | `src/socket-server/` | WS、Node.js Net | YGOPro TCP 与 WebSocket 连接 |
| **持久化** | `src/shared/db/`、`src/evolution-types/src/` | TypeORM、PostgreSQL、Redis/Valkey | 用户数据、统计与排行（Postgres）；缓存与门票（Redis/Valkey，可选） |
| **固定资源** | `nostalgia-resources/` | CDB、Lua、LFList、JSON | 固定的 1103/1109 卡池、脚本、禁限卡表与资源锁 |

---

## 归档规格定义的产品边界

以下约束来自已归档的 `remove-edopro-support`、`add-fixed-ocg-1109-environment`、`bundle-nostalgia-resources-with-app` 与 `restore-2011-card-rulings` 变更，是当前系统的长期行为契约。

### 1. 仅支持 YGOPro

- 只允许暴露 YGOPro TCP 和 WebSocket 决斗端点；不得恢复 EDOPro TCP/WebSocket 监听器、端口映射、入口规则或健康检查。
- 生产代码、依赖、构建和部署产物不得包含 EDOPro TypeScript 模块、原生 CoreIntegrator、EDOPro SQLite 数据库、热重载器、环境变量或资源树。
- HTTP 检查、房间、卡片、禁限卡表、资源版本和管理消息接口只能处理 YGOPro 数据；不得新增 `edopro` 响应分支或恢复 EDOPro 专用建房行为。
- `src/shared/` 不得依赖任何客户端专用模块；统计订阅必须通过显式启动流程注册，不得依赖 Socket 服务器构造函数的副作用。
- 不得因为历史名称含有 Mercury、Evolution 或上游 Project Ignis 字样就删除仍被 YGOPro 使用的组件；应以实际运行时消费者判断归属。

### 2. 固定怀旧环境与房间路由

- 当前且仅当前启用 `1103` 与 `1109` 两个环境：

| 环境 | 规则 | 模式 | 初始 LP | 对局制 | 固定卡池基线 |
| --- | --- | --- | --- | --- | --- |
| `1103` | OCG 2011.03、Master Rule 2 | MATCH | 8000 | 三局两胜 | 5198 个唯一卡片 ID（含 196 个异画码） |
| `1109` | OCG 2011.09、Master Rule 2 | MATCH | 8000 | 三局两胜 | 5320 个唯一卡片 ID（含 200 个异画码） |

- 玩家和观战者使用 `format#roomId` 加入，例如 `1103#1001`。`roomId` 必须是非空十进制数字，完整值必须适配 `JoinGame` 的 20 个 UTF-16LE 字符槽。
- `format` 与 `roomId` 的组合才是房间身份。同一个 `roomId` 在 1103 和 1109 中对应两个隔离的房间，禁止以裸 `roomId` 查找房间。
- 环境化房间不使用密码；`#` 右侧全部内容都是外部房间号，不得复用旧式“房间名/密码”语义。
- 未启用环境、空或非数字房间号、额外的 `#` 分段以及超长标识必须被拒绝，且不得创建或修改房间，也不得回退到其他加入策略。
- 房间创建后，其环境、卡池、规则、禁限卡表和脚本集合不可变。新路由必须继续使用现有玩家准入、重连、观战、消息可见性、席位和生命周期逻辑。
- 如需新增环境，必须通过独立变更明确提供卡池派生规则、禁限卡表、可选脚本覆盖及固定资源完整性验证；不得以动态命令或隐式资源扫描启用。

### 3. 固定资源边界

固定资源布局为：

```text
nostalgia-resources/
├── lock.json
└── ygopro/
    ├── base/
    │   ├── cards.cdb
    │   └── script/
    └── formats/
        ├── 1103/
        │   ├── lflist.conf
        │   └── script/
        └── 1109/
            ├── lflist.conf
            └── script/
```

- `ygopro/base/cards.cdb` 是唯一基础数据库，其 `datas` 表当前包含 5399 个有效、唯一的卡片 ID（5320 张实卡含 200 个异画码 + 79 个脚本引用的 token 虚拟卡元数据）；不得合并其他 `.cdb`、YDK、历史 LFList 或临时输入来扩展卡池。token 虚拟卡不进 whitelist、不能入卡组，仅为 `Duel.CreateToken` 提供卡数据；lock 校验会断言脚本引用的 token 集合与 CDB 中的 TYPE_TOKEN 卡集合完全一致，任何一边缺失即失败。
- `formats/1103/lflist.conf` 与 `formats/1109/lflist.conf` 中的 `$whitelist` 分别是对应环境卡池与禁限数量的唯一事实来源。卡片 ID 必须唯一、属于基础数据库，数量只能为 0–3。
- 脚本查找顺序固定为 `formats/<format>/script`，未命中时回退 `base/script`；禁止读取另一环境的脚本目录。
- 数据库、基础脚本、环境覆盖脚本、两份 LFList 和 `lock.json` 必须作为一个整体校验并发布。任何文件缺失或摘要不匹配时，都不得切换活动版本。
- 应用与固定资源是单一版本：代码、CDB、LFList、Lua 与 lock 随同一提交/镜像整体发布与回滚，禁止独立升级或回滚任一资源组成部分。
- 启动时（在持久化连接和端口监听之前）、CI 与镜像构建必须执行同一完整 lock 校验（`npm run check:nostalgia-resources`），并检查 EDOPro、未启用赛制、额外卡池与仓库缓存等越界内容；失败即停。
- 不存在运行时 manifest、`resources/current`/`resources/releases`/`repositories` 约定或任何资源刷新路径；资源根目录固定为 `nostalgia-resources/`，路径由领域层 1103/1109 注册表派生。
- 固定资源不得在启动或周期刷新时跟随浮动上游更新，也不得创建外部仓库缓存。资源内容只能通过经过评审、更新 lock 并通过完整性检查的应用变更升级。
- 发布树只能包含固定 base、1103/1109 format 和 YGOPro WASM 核心；不得重新引入 EDOPro、未启用赛制、现代 OCG、预发布或自定义扩展资源。

### 4. YGOPro 线协议兼容性

- TCP 帧使用二字节小端长度前缀，长度包含一字节命令及消息负载。
- 固定加入序列依次为 `ExternalAddress (0x17)`、`PlayerInfo (0x10)` 和 `JoinGame (0x12)`；协议版本保持 `0x1362`。
- `PlayerInfo` 使用 20 个 UTF-16LE 字符槽；`JoinGame` 在版本后包含两个 `0xCC` 字节、一个 32 位保留/游戏 ID 字段和 20 个 UTF-16LE 字符槽。
- 解析器必须正确处理任意 TCP 分片与粘包，每个完整帧只分发一次；截断、非法长度或超过上限的帧必须被拒绝，且不得产生房间副作用。
- 认证、准入和版本错误必须使用 YGOPro 原生序列化。存在兼容错误码时先发送错误再关闭；版本错误还必须向用户发送可读的升级客户端提示，不得以静默关闭作为唯一的用户交互；错误房间标识等静默拒绝必须保留既有关闭语义。
- 修改协议时必须显式更新仓库内人工核对的固定二进制样本、规格与预期解析结果；测试不得用被测编码器动态生成期望样本。

### 5. 必须保持的行为

- 保持房间创建与加入、卡组校验、决斗状态流转、断线与受支持重连、聊天、表情、录像、匹配、WindBot 和观战行为。
- 房间展示、卡组校验、录像元数据与持久化决斗事件必须使用同一份 YGOPro 禁限卡表名称和哈希作为唯一事实来源。
- 启用统计持久化时，一次 YGOPro 游戏结束事件必须恰好一次送达所有已配置订阅者。
- 阻断回归必须能在 WSL 内仅依赖 Node.js、仓库内固定样本和测试侧套接字执行；网络测试只能监听系统分配的临时 loopback 端口。

### 6. 历史裁定覆盖（restore-2011-card-rulings）

- 1103 与 1109 的 `formats/<format>/script/` 下存在 12 张卡的 2011 OCG 裁定覆盖（`c<cardId>.lua`，清单见 `docs/historical-card-rulings.md` 已修复表格）；同一卡片 ID 在两个环境的脚本必须逐字节一致，由 `src/ygopro/ygopro/historical-rulings/coverage.test.ts` 校验。
- 覆盖脚本遵循既有 format-first 查找链（`formats/<format>/script` → `base/script`），不改变脚本解析规则。
- 台账 `docs/historical-card-rulings.md` 是人工审阅记录：**不进入 `lock.json`、不被运行时扫描**。新增或移除裁定覆盖时，必须在同一变更中同步更新台账、更新两个 format 目录并重新生成资源锁。
- 台账「后续候选脚本」中的卡片仍使用现代 base 脚本，未纳入运行时；未经证据与独立 WASM 验证不得擅自启用。

---

## 首要准则

### 1. 架构与模式

- **DDD 是强制要求**：业务逻辑必须位于 `domain/`；领域层不得导入 `application/` 或 `infrastructure/`，依赖只能指向内层。
- **六边形架构**：核心领域不感知数据库、HTTP 或 Socket；外部能力通过端口与依赖注入接入。
- **测试数据**：共享领域实体使用 `*Mother`；套件专用桩件使用本地 `make*` 工厂。测试与源码共同放在 `src/` 中，详见 [测试约定](./docs/testing.md)。
- **职责链**：复杂校验（例如卡组规则）使用项目已有的职责链模式，不得另建平行实现。
- **依赖注入**：使用 `diod` 或构造函数注入管理依赖。

### 2. 编码标准

- **显式可见性**：类成员必须显式声明 `public`、`private` 或 `protected`。
- **禁止 Console 日志**：使用 `Logger` 领域服务。
- **命名规范**：类使用 `PascalCase`，变量使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`。
- **提交规范**：提交消息遵循 [Conventional Commits](https://www.conventionalcommits.org/)（例如 `feat: add user login`、`fix: resolve room crash`）。
- **路径别名**：从 `src/ygopro/` 导入时应尽量使用 `@ygopro/*`。

### 3. 操作安全

- **绝对路径**：文件操作始终使用绝对路径。
- **数据库迁移**：已应用的迁移不得手工修改；模式变更使用 `npm run migration:generate --name=NameOfChange` 生成迁移。
- **固定资源**：不要手工伪造 `lock.json`。有意修改 CDB、LFList 或 Lua 脚本后，重新生成 lock 并检查差异与卡池基线。
- **部署清理**：只有在新 YGOPro 应用与资源版本健康检查、完整决斗冒烟测试通过后，才可清理旧 EDOPro 数据；删除目标必须解析为明确路径或版本 ID。
- **完成验证**：结束前运行 `npm run lint`、`npm run test` 和 `npm run check:nostalgia-resources`；涉及生产入口或产物时还需运行 `npm run build`。

---

## 可用技能

按需使用以下技能获取详细流程：

| 技能 | 用途 | 位置 |
| --- | --- | --- |
| `typescript-expert` | TypeScript 类型系统、性能与工具链问题 | `.agents/skills/typescript-expert/SKILL.md` |
| `systematic-debugging` | Bug、测试失败或异常行为的系统化诊断 | `.agents/skills/systematic-debugging/SKILL.md` |

## 技能与 SOP 自动调用规则

执行下列操作时，必须遵循对应流程：

| 操作 | 技能 / SOP |
| --- | --- |
| 实现功能、创建用例 | **[SOP-001] DDD 功能实现** |
| 编写测试、修复 Bug、添加单元测试 | **[SOP-002] 测试策略** |
| 增加数据库字段、更新模式、新增持久化实体 | **[SOP-003] 数据库迁移** |
| 创建模块或架构组件 | **[SOP-004] 模块创建** |
| 修复复杂类型错误、优化 TypeScript 构建 | **typescript-expert** |
| 调试问题、修复 Bug、分析失败原因 | **systematic-debugging** |

---

## 标准操作流程

### [SOP-001] DDD 功能实现

**目标**：按 DDD 与六边形架构实现新功能。

1. **领域层**（`src/[module]/domain/`）：定义实体或聚合根、必要的值对象以及仓库端口；只包含纯业务逻辑。
2. **应用层**（`src/[module]/application/`）：创建用例服务或处理器，通过构造函数注入端口。
3. **基础设施层**（`src/[module]/infrastructure/`）：实现仓库或其他外部适配器。
4. **接口层**：通过 HTTP Controller 或 Socket 事件处理器暴露功能。

### [SOP-002] 测试策略

**目标**：保持测试一致、就近放置，并遵循测试优先循环。完整约定见 [测试约定](./docs/testing.md)。

1. 在修改生产代码前，先新增或修改一个能失败的测试以复现问题或覆盖新行为。
2. 将 `[Thing].test.ts` 与 `src/[module]/[Thing].ts` 放在同一目录；不要向根 `tests/` 添加新测试。
3. 共享领域实体使用带 `static create(overrides?)` 的 `*Mother`；套件本地桩件使用支持 `overrides` 的内联 `make*` 工厂。
4. `describe` 描述被测单元，`it` 使用英文、一般现在时且不含 “should” 描述行为。
5. 基础设施共用 Logger、Socket、MessageRepository 等 Mock；模块单例使用 `jest.mock()`；一次性接口使用 `mock<T>()`。在 `afterEach` 中重置单例。
6. 先确认测试失败，再用最少代码使其通过；随后运行聚焦测试和完整回归。

### [SOP-003] 数据库迁移

**目标**：安全修改数据库模式。

1. 修改 `src/evolution-types/src/` 中的 TypeORM 实体。
2. 执行 `npm run migration:generate --name=NameOfChange`。
3. 检查 `src/evolution-types/src/migrations/` 中生成的迁移。
4. 执行 `npm run migration:run` 验证迁移。

### [SOP-004] 模块创建

**目标**：从零创建领域模块。

1. 创建 `src/new-module/{domain,application,infrastructure}` 结构，测试与对应源码放在同一目录，不创建独立测试树。
2. 在 TypeORM 配置中注册新实体，并在依赖注入容器中注册 Controller、Handler 与适配器。

---

## 技术参考

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务器，调试端口为 9229 |
| `npm run build` | 构建生产代码 |
| `npm run test` | 运行全部 Jest 测试 |
| `npm test -- path/to/file` | 运行指定测试文件 |
| `npm run lint` | 检查代码规范 |
| `npm run lint:fix` | 修复可自动处理的规范问题 |
| `npm run check:nostalgia-resources` | 对完整资源根执行同一 lock 校验（数据库、双环境 LFList、脚本摘要与边界检查） |
| `npm run generate:nostalgia-lock` | 在已审核的资源变更后重新生成 `nostalgia-resources/lock.json` |
| `npm run smoke:duel -- [port]` | 双环境 TCP 冒烟：`1103#1001`/`1109#1001` 建房、真实卡组校验与真实 WASM 决斗 |

### 路径别名

- `@ygopro/*` → `src/ygopro/*`
- `@shared/*` → `src/shared/*`
- `@test-support/*` → `src/test-support/*`

### 运行时架构

- 服务端只实现 YGOPro 协议，为 Koishi、YGO Mobile 和其他兼容客户端提供二进制 TCP 与 WebSocket 传输。
- 决斗引擎使用 `koishipro-core.js` 提供的 ocgcore WASM，并在线程 Worker 中运行。
- 修改 `shared/` 时必须确认不会破坏 `ygopro/` 中的协议实现；修改房间身份、卡池、禁限卡表或脚本解析时必须同时覆盖 1103 与 1109。

### 冒烟验证（`npm run smoke:duel`）

`scripts/smoke-duel.mjs` 用两个测试侧 TCP socket 驱动真实服务器完成 `1103#1001` 与 `1109#1001` 的完整决斗流程，并额外以第三个 socket 验证观战，用于验证资源加载、准入、卡组校验与真实 WASM 引擎在改动后仍可用：

1. **启动前置服务**：目标服务器需已在运行（本地 `npm run dev` 或容器均可）。Redis 是可选依赖：`USE_REDIS=false` 的零中间件配置可直接冒烟；`USE_REDIS=true` 时需可连接的 Redis（无本地 Redis 时可临时 `docker run -d -p 6379:6379 valkey/valkey:9.0-alpine`）。
2. **运行冒烟**：
   ```bash
   node scripts/smoke-duel.mjs [port]      # 默认 706
   npm run smoke:duel -- 17711            # 或通过 npm script 指定端口
   SMOKE_PORT=17711 node scripts/smoke-duel.mjs
   ```
3. **预期结果**：每个格式打印 `OK format <id>: players dueled, spectator admitted and watched (seats unchanged)`，最后 `SMOKE PASS`，退出码 0；任一格式失败（超时/被拒/校验失败）退出码为 1。

覆盖阶段：建房与加入（`STOC_JOIN_GAME`/`HS_TYPE_CHANGE`）、真实卡组校验（CDB + 环境禁限卡表，卡组取 whitelist 中 qty=3 且有 base 脚本的主卡组怪兽）、双方 READY、RPS 与先后手选择、真实 ocgcore WASM 决斗（`MSG_START`）、投降与 `MATCH_END`。

观战验证：房间满员后第三个连接被准入为 OBSERVER，收到 `HS_WATCH_CHANGE` 观众数广播（host 侧计数从 0 → 1），决斗期间观战者同样收到 `DUEL_START` 与观战视角的 `MSG_START`，且玩家席位不受影响（后续 RPS/决斗流程成功即证明）。

注意：脚本依赖仓库内 `nostalgia-resources/` 构造卡组，只能对使用固定资源的实例运行；RPS 中 host=ROCK(1)/guest=PAPER(3) 时按服务器既有判定 host 获胜并选择先后手。
