## 1. 基线记录与 YGOPro 特征测试

- [x] 1.1 记录当前干净构建的镜像体积、`repositories/` 与资源发布版本大小、`evolution_cards.db` 大小、启动时间、空闲 RSS、活动端口及单次资源刷新耗时，用于最终对比。
- [x] 1.2 根据服务端当前 YGOPro 消息字段与版本配置，人工核对并提交一份固定二进制首包样本，锁定二字节小端长度、`ExternalAddress (0x17)`、20 槽 UTF-16LE `PlayerInfo (0x10)`、版本 `0x1362`、`0xCC 0xCC`、32 位保留/游戏 ID 和 20 槽 UTF-16LE 口令 `JoinGame (0x12)`，同时记录预期解析字段；测试不得在运行时使用被测编码器生成期望样本。
- [x] 1.3 强化与解析器同目录的测试，使用 1.2 的同一固定样本覆盖逐字节输入、长度前缀拆分、命令/负载拆分、多帧粘包、尾部半帧续传和消息按顺序各一次分发。
- [x] 1.4 新增真实 YGOPro TCP 接入契约测试：服务端监听系统分配的临时 loopback 端口，测试侧套接字发送 1.2 的固定样本，断言玩家名、版本和口令进入正确加入策略，并收到符合 YGOPro 消息仓储格式的加入响应；该测试不得构造 EDOPro 服务器或解析器。
- [x] 1.5 新增 TCP 失败契约测试，覆盖不支持的版本、错误房间口令、重复玩家名、未知命令、零长度/超限长度、截断帧以及处理中断开；断言错误消息先于优雅关闭完成发送（如该路径有 YGOPro 错误码）、静默拒绝不继续匹配其他策略，并且房间和其他连接不受影响。
- [x] 1.6 使用两个测试侧套接字覆盖创建/加入、卡组校验、双方准备、开局、聊天/表情、断线处理、受支持的重连、决斗结束和录像完成；为匹配和 WindBot 另保留聚焦回归，并覆盖当前经过 EDOPro 所有类型的依赖边界。
- [x] 1.7 为 TCP/WebSocket 连接分发和首消息竞态增加测试；将 TCP 固定首包与 WebSocket 票据认证、心跳、应用层 ping/pong 和令牌重连作为相互独立的 YGOPro 服务端契约验证。
- [x] 1.8 增加失败的启动流程测试，证明无需构造 EDOPro 服务器，YGOPro 游戏结束事件也能完成注册并恰好一次送达每个已配置的统计订阅者。
- [x] 1.9 为仅支持 YGOPro 的房间、禁限卡表、数据库、卡片搜索、资源版本、检查页面和管理消息行为增加失败的 HTTP 契约测试。
- [x] 1.10 记录 WSL 阻断测试矩阵及可复制命令，证明协议、TCP/WebSocket、房间、HTTP、统计和资源回归仅依赖服务端仓库以及 WSL 中的 Node.js/Jest/Bats。

## 2. 解除 YGOPro 与共享代码对 EDOPro 的依赖

- [x] 2.1 引入协议无关的认证输入和领域认证结果，更新共享认证/准入测试，并将 YGOPro 错误序列化迁移到 YGOPro 边界。
- [x] 2.2 将玩家信息线协议解析器和连接消息分发器迁入 YGOPro 模块，更新 TCP/WebSocket 服务器测试与导入，并验证分片帧/多帧行为保持不变。
- [x] 2.3 使用仅包含已通过特征测试锁定的 YGOPro 版本、聊天、表情、错误和房间通知行为的 YGOPro 房间状态基类，替换对 EDOPro 房间状态的继承。
- [x] 2.4 将共享房间/领域代码中的 EDOPro `Client` 引用替换为 `YgoClient`，移除过时的混合客户端分支；如果已无行为依赖该判别项，则移除 `RoomType.EDO` 或整个类型判别器。
- [x] 2.5 将依赖 YGOPro 主机信息的消息仓库端口迁移到 YGOPro 房间边界，并更新其调用方和测试。
- [x] 2.6 将房间查找和断线处理迁移并简化为 YGOPro 应用服务，同时保留匹配中止、WindBot 销毁、空房间结束和观战者移除测试。
- [x] 2.7 增加架构检查：当 `src/edopro` 之外的生产代码导入 EDOPro，或 `src/shared` 导入任一客户端模块时测试失败；在实际删除文件前使该检查通过。

## 3. 使 YGOPro 禁限卡表自包含

- [x] 3.1 为普通与点数制/Genesys YGOPro 禁限卡表哈希增加测试，并验证房间展示、录像元数据和游戏结束事件输出一致的哈希与名称。
- [x] 3.2 将校验器与共享卡组规则改为依赖共享禁限卡表契约或 `YGOProBanList`，从 YGOPro 房间中移除 EDOPro 禁限卡表查询与兼容哈希，并保持历史持久化数据行不变。
- [x] 3.3 将资源初始化与热重载缩减为只使用 YGOPro 加载器/仓库，指纹计算仅使用 YGOPro 路径，并将双缓冲/空结果测试调整为单仓库场景。

## 4. 保留共享启动行为并切断 EDOPro 运行时入口

- [x] 4.1 实现并测试显式统计启动流程，在所需持久化初始化后、接收决斗流量前恰好调用一次，并从 `src/socket-server/HostServer.ts` 中移除统计注册。
- [x] 4.2 在 4.1 通过后，删除 EDOPro 专用的 `src/socket-server/HostServer.ts`、`src/socket-server/WSHostServer.ts` 及其启动引用、连接处理、启动日志、`HOST_PORT` 和 `WEBSOCKET_DUEL_PORT`，同时保留并明确暴露已配置的 YGOPro TCP/WebSocket 端口。
- [x] 4.3 让房间观战 WebSocket 仅从 YGOPro 房间列表初始化和广播，并在不改变其中性外部契约的情况下更新测试。
- [x] 4.4 从持久化启动流程中移除 EDOPro SQLite 初始化和卡片数据库热重载，同时保留已配置的 Postgres 与 Redis 行为。

## 5. 将 HTTP 与检查界面改为仅支持 YGOPro

- [x] 5.1 移除 EDOPro 专用 HTTP 房间创建路由/控制器，并验证其不再创建房间。
- [x] 5.2 将保留的房间、禁限卡表、数据库、数据库卡片、卡片搜索和资源版本端点改为仅使用 YGOPro 仓库，拒绝 `edopro` 引擎输入，并省略 `edopro` 响应分支。
- [x] 5.3 将管理广播改为仅遍历 YGOPro 房间，并序列化兼容 YGOPro 的服务器/聊天消息。
- [x] 5.4 从检查页面移除 EDOPro 选择器、样式和数据假设，同时保留 YGOPro 检查行为。
- [x] 5.5 运行聚焦的 HTTP 契约测试，并为调用方记录破坏性的响应/路由变化。

## 6. 移除 EDOPro 资源与刷新工作

- [x] 6.1 盘点公共清单和可选私有清单中所有供给 `edopro/*` 目标的资源源，列出每个资源源的全部 EDOPro 与 YGOPro 消费者，并逐源记录删除、保留或重命名结论；至少覆盖 `edopro-cdbs`、`edopro-scripts`、`edopro-lflists` 和 `evolution-lflists`。
- [x] 6.2 增加 Bats/资源清单断言，证明生效资源图不包含 `edopro/*` 目标或仅供 EDOPro 使用的资源源，发布版本中不存在 `edopro` 目录，且断言按消费者关系而不是源 ID 字符串匹配进行判断。
- [x] 6.3 删除 `edopro-cdbs`、`edopro-scripts` 及其目标；从 `edopro-lflists` 与 `evolution-lflists` 移除 EDOPro 组装目标，将前者重命名为 `project-ignis-lflists` 并保留 world、speed、rush、goat、ocg 映射，同时保留后者的 MD 与 Tengu 映射；将源 ID 重命名后弃用的旧 `edopro-lflists` 仓库缓存目录登记为部署清理目标。
- [x] 6.4 更新资源加载器/重载器测试、清单夹具、注释和刷新日志，确保定时刷新既不拉取也不重新创建 EDOPro 数据。
- [x] 6.5 在临时干净目录中组装资源；接受新清单前，验证每个保留的怀旧赛制都具备所需的 CDB、脚本、禁限卡表和 YGOPro WASM 核心。

## 7. 删除 EDOPro 代码与孤立构建资产

- [x] 7.1 删除 `src/edopro`、同目录测试、EDOPro 专用测试 Mother、EDOPro 专用共享 SQLite/消息文件，以及经确认因本次删除而失去引用的工具。
- [x] 7.2 移除 `@edopro` TypeScript 别名，更新项目/测试配置，从活动元数据中移除 EDOPro 包命名；重新确认生产代码、脚本和测试无引用后，移除 `lzma-native`、`shuffle-array`、`better-sqlite3` 及其类型包，并清理既存死依赖 `cheerio`、`simple-git`、`load-json-file`、`array-shuffle`，最后重新生成 `package-lock.json` 并检查依赖树。
- [x] 7.3 删除根目录原生 `core/` 和 CoreIntegrator 构建脚本，移除 Docker 原生核心阶段/复制步骤；删除 `liblua5.3-dev`、`libsqlite3-dev`、`libevent-dev` 前，先通过依赖树检查与干净镜像冒烟测试确认 WindBot、YGOPro WASM Worker 及其运行时均无依赖，无法证明无依赖的系统库继续保留。
- [x] 7.4 面向 YGOPro 专用项目更新依赖安装脚本、`.gitignore`、`.dockerignore`、Biome 配置、Compose/环境文件、AGENTS 指南、README、测试文档、贡献文档及活动注释；保留历史变更日志记录。
- [x] 7.5 逐一审查通用工具与性能脚本；仍对 YGOPro 有价值的应保留或重命名，不得仅因历史 EDOPro 命名而删除。

## 8. 仓库与容器验证

- [x] 8.1 运行架构与资产清单检查，证明 `src/edopro`、`src/socket-server/HostServer.ts`、`src/socket-server/WSHostServer.ts`、根目录原生 `core/`、EDOPro 别名/导入、`edopro/*` 资源目标、仅供 EDOPro 使用的资源源、EDOPro 生成数据库和 EDOPro 端口均不存在，同时共享代码不导入客户端模块。
- [ ] 8.2 在 WSL 中先运行 YGOPro 固定样本、消息解析、真实 TCP 接入、WebSocket、加入策略、房间状态、消息仓储和 HTTP/统计等聚焦套件，再运行 `npm run lint`、`npm run test`、`npm run build` 和 `bats test/*.bats`；推送后确认 `.github/workflows/pipeline.yaml` 对应的 CI 流水线全部通过，修复回归时不得进行大范围无关重构。
- [x] 8.3 从干净上下文构建生产镜像，检查其中的文件与依赖树是否仍有已移除的原生/EDOPro 资产；启动镜像并验证只发布文档声明的 YGOPro 端口及保留的管理/观战端口。
- [x] 8.4 在 WSL 内使用测试侧套接字完成 YGOPro TCP 与 WebSocket 冒烟测试，覆盖固定 TCP 首包、一个保留的怀旧赛制、卡组校验、断线/重连、决斗完成、录像输出、管理 API 以及恰好一次的统计持久化。
- [x] 8.5 重复基线测量，并报告镜像、仓库/资源磁盘、启动、空闲 RSS，以及刷新耗时与写入量的降幅。

## 9. 安全部署迁移与清理

- [x] 9.1 编写运维运行手册，包含解析后的明确目标、清理前资产清单、回滚镜像/发布版本 ID、YGOPro 健康检查，以及针对外部入口和破坏性数据清理的独立审批点。
- [x] 9.2 部署 YGOPro 专用镜像和资源版本，同时保留上一版镜像/发布版本；清理前完成健康、端口、API、决斗、录像、资源刷新和统计验证。
- [x] 9.3 经运维人员批准，并确认新的 `project-ignis-lflists` 缓存已成功克隆且保留的 YGOPro 赛制映射验证通过后，关闭 EDOPro 入口/健康检查，仅移除明确识别的 EDOPro 仓库缓存、因源 ID 重命名而孤立的旧 `edopro-lflists` 缓存目录、生成的 SQLite 文件、过时发布版本、镜像和数据卷；不得因相同上游内容仍由新 ID 使用而保留旧缓存，并验证更新器不会重新创建这些资产。
- [x] 9.4 记录最终回滚边界和成本对比，并将 Postgres/Valkey 可选化与固定资源部署明确留作独立后续变更。
