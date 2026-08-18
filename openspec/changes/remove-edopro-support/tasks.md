## 1. 基线记录与 YGOPro 特征测试

- [ ] 1.1 记录当前干净构建的镜像体积、`repositories/` 与资源发布版本大小、`evolution_cards.db` 大小、启动时间、空闲 RSS、活动端口及单次资源刷新耗时，用于最终对比。
- [ ] 1.2 为 TCP/WebSocket 连接分发、玩家信息解析、加入拒绝/版本错误、聊天、表情和房间状态流转新增或强化与源码同目录的 YGOPro 测试；先运行这些测试，并确认覆盖计划依赖边界的新断言会失败。
- [ ] 1.3 为当前经过 EDOPro 所有类型的房间创建/加入、卡组校验、断线/重连、录像完成、匹配和 WindBot 流程增加 YGOPro 回归覆盖。
- [ ] 1.4 增加失败的启动流程测试，证明无需构造 EDOPro 服务器，YGOPro 游戏结束事件也能完成注册并恰好一次送达每个已配置的统计订阅者。
- [ ] 1.5 为仅支持 YGOPro 的房间、禁限卡表、数据库、卡片搜索、资源版本、检查页面和管理消息行为增加失败的 HTTP 契约测试。

## 2. 解除 YGOPro 与共享代码对 EDOPro 的依赖

- [ ] 2.1 引入协议无关的认证输入和领域认证结果，更新共享认证/准入测试，并将 YGOPro 错误序列化迁移到 YGOPro 边界。
- [ ] 2.2 将玩家信息线协议解析器和连接消息分发器迁入 YGOPro 模块，更新 TCP/WebSocket 服务器测试与导入，并验证分片帧/多帧行为保持不变。
- [ ] 2.3 使用仅包含已通过特征测试锁定的 YGOPro 版本、聊天、表情、错误和房间通知行为的 YGOPro 房间状态基类，替换对 EDOPro 房间状态的继承。
- [ ] 2.4 将共享房间/领域代码中的 EDOPro `Client` 引用替换为 `YgoClient`，移除过时的混合客户端分支；如果已无行为依赖该判别项，则移除 `RoomType.EDO` 或整个类型判别器。
- [ ] 2.5 将依赖 YGOPro 主机信息的消息仓库端口迁移到 YGOPro 房间边界，并更新其调用方和测试。
- [ ] 2.6 将房间查找和断线处理迁移并简化为 YGOPro 应用服务，同时保留匹配中止、WindBot 销毁、空房间结束和观战者移除测试。
- [ ] 2.7 增加架构检查：当 `src/edopro` 之外的生产代码导入 EDOPro，或 `src/shared` 导入任一客户端模块时测试失败；在实际删除文件前使该检查通过。

## 3. 使 YGOPro 禁限卡表自包含

- [ ] 3.1 为普通与点数制/Genesys YGOPro 禁限卡表哈希增加测试，并验证房间展示、录像元数据和游戏结束事件输出一致的哈希与名称。
- [ ] 3.2 将校验器与共享卡组规则改为依赖共享禁限卡表契约或 `YGOProBanList`，从 YGOPro 房间中移除 EDOPro 禁限卡表查询与兼容哈希，并保持历史持久化数据行不变。
- [ ] 3.3 将资源初始化与热重载缩减为只使用 YGOPro 加载器/仓库，指纹计算仅使用 YGOPro 路径，并将双缓冲/空结果测试调整为单仓库场景。

## 4. 保留共享启动行为并切断 EDOPro 运行时入口

- [ ] 4.1 实现并测试显式统计启动流程，在所需持久化初始化后、接收决斗流量前恰好调用一次，并从 `src/socket-server/HostServer.ts` 中移除统计注册。
- [ ] 4.2 在 4.1 通过后，删除 EDOPro 专用的 `src/socket-server/HostServer.ts`、`src/socket-server/WSHostServer.ts` 及其启动引用、连接处理、启动日志、`HOST_PORT` 和 `WEBSOCKET_DUEL_PORT`，同时保留并明确暴露已配置的 YGOPro TCP/WebSocket 端口。
- [ ] 4.3 让房间观战 WebSocket 仅从 YGOPro 房间列表初始化和广播，并在不改变其中性外部契约的情况下更新测试。
- [ ] 4.4 从持久化启动流程中移除 EDOPro SQLite 初始化和卡片数据库热重载，同时保留已配置的 Postgres 与 Redis 行为。

## 5. 将 HTTP 与检查界面改为仅支持 YGOPro

- [ ] 5.1 移除 EDOPro 专用 HTTP 房间创建路由/控制器，并验证其不再创建房间。
- [ ] 5.2 将保留的房间、禁限卡表、数据库、数据库卡片、卡片搜索和资源版本端点改为仅使用 YGOPro 仓库，拒绝 `edopro` 引擎输入，并省略 `edopro` 响应分支。
- [ ] 5.3 将管理广播改为仅遍历 YGOPro 房间，并序列化兼容 YGOPro 的服务器/聊天消息。
- [ ] 5.4 从检查页面移除 EDOPro 选择器、样式和数据假设，同时保留 YGOPro 检查行为。
- [ ] 5.5 运行聚焦的 HTTP 契约测试，并为调用方记录破坏性的响应/路由变化。

## 6. 移除 EDOPro 资源与刷新工作

- [ ] 6.1 盘点公共清单和可选私有清单中所有供给 `edopro/*` 目标的资源源，列出每个资源源的全部 EDOPro 与 YGOPro 消费者，并逐源记录删除、保留或重命名结论；至少覆盖 `edopro-cdbs`、`edopro-scripts`、`edopro-lflists` 和 `evolution-lflists`。
- [ ] 6.2 增加 Bats/资源清单断言，证明生效资源图不包含 `edopro/*` 目标或仅供 EDOPro 使用的资源源，发布版本中不存在 `edopro` 目录，且断言按消费者关系而不是源 ID 字符串匹配进行判断。
- [ ] 6.3 删除 `edopro-cdbs`、`edopro-scripts` 及其目标；从 `edopro-lflists` 与 `evolution-lflists` 移除 EDOPro 组装目标，将前者重命名为 `project-ignis-lflists` 并保留 world、speed、rush、goat、ocg 映射，同时保留后者的 MD 与 Tengu 映射；将源 ID 重命名后弃用的旧 `edopro-lflists` 仓库缓存目录登记为部署清理目标。
- [ ] 6.4 更新资源加载器/重载器测试、清单夹具、注释和刷新日志，确保定时刷新既不拉取也不重新创建 EDOPro 数据。
- [ ] 6.5 在临时干净目录中组装资源；接受新清单前，验证每个保留的怀旧赛制都具备所需的 CDB、脚本、禁限卡表和 YGOPro WASM 核心。

## 7. 删除 EDOPro 代码与孤立构建资产

- [ ] 7.1 删除 `src/edopro`、同目录测试、EDOPro 专用测试 Mother、EDOPro 专用共享 SQLite/消息文件，以及经确认因本次删除而失去引用的工具。
- [ ] 7.2 移除 `@edopro` TypeScript 别名，更新项目/测试配置，从活动元数据中移除 EDOPro 包命名；重新确认生产代码、脚本和测试无引用后，移除 `lzma-native`、`shuffle-array`、`better-sqlite3` 及其类型包，并清理既存死依赖 `cheerio`、`simple-git`、`load-json-file`、`array-shuffle`，最后重新生成 `package-lock.json` 并检查依赖树。
- [ ] 7.3 删除根目录原生 `core/` 和 CoreIntegrator 构建脚本，移除 Docker 原生核心阶段/复制步骤；删除 `liblua5.3-dev`、`libsqlite3-dev`、`libevent-dev` 前，先通过依赖树检查与干净镜像冒烟测试确认 WindBot、YGOPro WASM Worker 及其运行时均无依赖，无法证明无依赖的系统库继续保留。
- [ ] 7.4 面向 YGOPro 专用项目更新依赖安装脚本、`.gitignore`、`.dockerignore`、Biome 配置、Compose/环境文件、AGENTS 指南、README、测试文档、贡献文档及活动注释；保留历史变更日志记录。
- [ ] 7.5 逐一审查通用工具与性能脚本；仍对 YGOPro 有价值的应保留或重命名，不得仅因历史 EDOPro 命名而删除。

## 8. 仓库与容器验证

- [ ] 8.1 运行架构与资产清单检查，证明 `src/edopro`、`src/socket-server/HostServer.ts`、`src/socket-server/WSHostServer.ts`、根目录原生 `core/`、EDOPro 别名/导入、`edopro/*` 资源目标、仅供 EDOPro 使用的资源源、EDOPro 生成数据库和 EDOPro 端口均不存在，同时共享代码不导入客户端模块。
- [ ] 8.2 先运行全部聚焦测试套件，再运行 `npm run lint`、`npm run test`、`npm run build` 和 `bats test/*.bats`；推送后确认 `.github/workflows/pipeline.yaml` 对应的 CI 流水线全部通过，修复回归时不得进行大范围无关重构。
- [ ] 8.3 从干净上下文构建生产镜像，检查其中的文件与依赖树是否仍有已移除的原生/EDOPro 资产；启动镜像并验证只发布文档声明的 YGOPro 端口及保留的管理/观战端口。
- [ ] 8.4 完成 YGOPro TCP 与 WebSocket 冒烟测试，覆盖一个保留的怀旧赛制、卡组校验、断线/重连、决斗完成、录像输出、管理 API 以及恰好一次的统计持久化。
- [ ] 8.5 重复基线测量，并报告镜像、仓库/资源磁盘、启动、空闲 RSS，以及刷新耗时与写入量的降幅。

## 9. 安全部署迁移与清理

- [ ] 9.1 编写运维运行手册，包含解析后的明确目标、清理前资产清单、回滚镜像/发布版本 ID、YGOPro 健康检查，以及针对外部入口和破坏性数据清理的独立审批点。
- [ ] 9.2 部署 YGOPro 专用镜像和资源版本，同时保留上一版镜像/发布版本；清理前完成健康、端口、API、决斗、录像、资源刷新和统计验证。
- [ ] 9.3 经运维人员批准，并确认新的 `project-ignis-lflists` 缓存已成功克隆且保留的 YGOPro 赛制映射验证通过后，关闭 EDOPro 入口/健康检查，仅移除明确识别的 EDOPro 仓库缓存、因源 ID 重命名而孤立的旧 `edopro-lflists` 缓存目录、生成的 SQLite 文件、过时发布版本、镜像和数据卷；不得因相同上游内容仍由新 ID 使用而保留旧缓存，并验证更新器不会重新创建这些资产。
- [ ] 9.4 记录最终回滚边界和成本对比，并将 Postgres/Valkey 可选化与固定资源部署明确留作独立后续变更。
