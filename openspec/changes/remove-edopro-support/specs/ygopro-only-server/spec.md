## Purpose

定义项目作为 YGOPro 专用怀旧决斗服务器运行时可从外部验证的行为契约，确保系统不再交付、初始化、刷新或暴露未使用的 EDOPro 协议栈与资源栈。

## ADDED Requirements

### Requirement: 仅提供 YGOPro 决斗端点
服务器必须（SHALL）暴露已配置的 YGOPro TCP 和 WebSocket 决斗端点，并且不得（SHALL NOT）暴露 EDOPro TCP 或 WebSocket 决斗端点。

#### Scenario: YGOPro 客户端连接
- **WHEN** 兼容的 YGOPro 客户端连接到已配置的 YGOPro 决斗端点
- **THEN** 服务器使用 YGOPro 协议接受并处理该连接

#### Scenario: EDOPro 端点不存在
- **WHEN** 检查已部署服务的监听器配置与对外发布端口
- **THEN** 不存在 EDOPro 决斗监听器、端口映射、入口规则或健康检查

### Requirement: 保持当前 MDPro3 TCP 线协议兼容
服务器必须（SHALL）继续接受当前 MDPro3 客户端使用的 YGOPro TCP 帧：二字节小端长度前缀的值包含一字节命令和消息负载，连接后依次发送 `ExternalAddress (0x17)`、`PlayerInfo (0x10)` 和 `JoinGame (0x12)`。`PlayerInfo` 使用 20 个 UTF-16LE 字符槽；`JoinGame` 使用客户端版本 `0x1362`、两个 `0xCC` 字节、一个 32 位保留/游戏 ID 字段和 20 个 UTF-16LE 字符槽的房间口令。

#### Scenario: 接受当前 MDPro3 首包序列
- **WHEN** TCP 客户端发送由当前 MDPro3 实现生成的 `ExternalAddress`、`PlayerInfo` 和 `JoinGame` 固定二进制样本
- **THEN** 服务器按顺序且各一次消费三条消息，`ExternalAddress` 不会覆盖后续加入所需的上一条 `PlayerInfo`，服务器取得玩家名、版本和房间口令并进入现有 YGOPro 加入流程，且不调用 EDOPro 消息解析器

#### Scenario: 首包跨越任意 TCP 分块
- **WHEN** 同一份 MDPro3 首包样本的长度前缀、命令或负载被拆分到多个 TCP 数据块，或者多条完整消息被合并到一个数据块
- **THEN** 服务器等待完整帧后再处理，并按线协议顺序且各一次分发每条完整消息

#### Scenario: 收到不完整或非法长度的帧
- **WHEN** TCP 客户端发送截断帧、非法长度或超过服务器上限的帧
- **THEN** 服务器不创建或修改房间，不重复处理任何消息，并关闭或拒绝该连接且不影响其他连接

### Requirement: 保留现有 YGOPro 游戏能力
服务器必须（SHALL）保留 YGOPro 房间创建与加入、怀旧赛制选择、卡组校验、决斗状态流转、断线处理、受支持的重连、聊天、表情、录像生成、匹配和 WindBot 行为。

#### Scenario: 怀旧赛制决斗完成
- **WHEN** 两个兼容的 YGOPro 客户端使用受支持的怀旧赛制创建并完成一场决斗
- **THEN** 服务器完成完整的房间生命周期，并生成与移除 EDOPro 支持前一致的受支持赛后输出

#### Scenario: YGOPro WebSocket 客户端重连
- **WHEN** 符合条件的 YGOPro WebSocket 客户端使用有效的重连令牌重新连接
- **THEN** 服务器在不依赖任何 EDOPro 运行时组件的情况下，将该客户端恢复到原房间

### Requirement: 使用 YGOPro 原生认证错误
YGOPro 连接上的认证、准入和版本校验失败不得（SHALL NOT）依赖 EDOPro 消息序列化器。存在 YGOPro 错误码的失败必须（SHALL）先返回兼容消息再关闭连接；错误房间口令等现有静默拒绝必须（SHALL）保持原有关闭语义，并且不得创建、加入或修改房间。

#### Scenario: 客户端版本不兼容
- **WHEN** 当前 MDPro3 首包使用不受支持的客户端版本加入房间
- **THEN** 客户端收到有效且兼容 YGOPro 的版本拒绝消息，消息在连接关闭前完成发送，并且房间保持不变

#### Scenario: 房间口令错误
- **WHEN** 当前 MDPro3 首包携带错误的房间口令
- **THEN** 服务器按现有 YGOPro 静默拒绝行为关闭连接，不创建、不加入且不修改任何房间，也不继续匹配其他加入策略

### Requirement: 分层执行客户端兼容回归
阻断重构合入的自动回归必须（SHALL）能够仅在 WSL 中使用 Node.js、固定线协议样本和模拟客户端完成，不得要求安装或启动 Unity/Windows 客户端。发布 YGOPro 专用版本前必须（SHALL）另行在 Windows 上使用真实 MDPro3 构建完成跨宿主机冒烟验证。

#### Scenario: 在 WSL 中执行阻断回归
- **WHEN** 开发者或 CI 在干净的服务端检出中执行聚焦测试和完整测试命令
- **THEN** MDPro3 TCP 首包、分片/粘包、加入拒绝、房间生命周期、WebSocket、HTTP、统计和资源测试均可在 WSL 内完成，且测试只监听临时的 loopback 端口

#### Scenario: 发布前执行真实客户端冒烟测试
- **WHEN** 候选版本通过全部 WSL 自动回归并准备发布
- **THEN** Windows 上的真实 MDPro3 客户端能够连接 WSL 中的候选服务端，完成进入房间、卡组提交、双方准备、开始和结束一场最小决斗，并留下可审查的客户端与服务端日志

### Requirement: 仅部署 YGOPro 资源集
已部署的资源集必须（SHALL）包含所提供 YGOPro 怀旧赛制需要的全部卡片数据库、脚本、禁限卡表和 WASM 决斗核心，并且不得（SHALL NOT）包含组装后的 `edopro` 资源树。

#### Scenario: 资源完成组装
- **WHEN** 拉取并组装公共资源清单和可选的私有资源清单
- **THEN** 发布版本包含配置完整的 YGOPro 资源树，且不包含 `edopro` 目录

#### Scenario: 保留所需的上游禁限卡表数据
- **WHEN** 某个资源源同时供给待删除的 `edopro/*` 目标和已提供的 YGOPro 怀旧赛制目标
- **THEN** 系统仅移除 EDOPro 目标，并继续通过该共享资源源或等价的 YGOPro/怀旧服资源源向所有保留赛制提供必需文件

#### Scenario: 双用途禁限卡表源保留 YGOPro 文件
- **WHEN** `evolution-lflists` 的 `edopro/evolution-lflists` 目标被移除
- **THEN** MD 与 Tengu 赛制所需的禁限卡表文件仍可从 `evolution-lflists` 或等价资源源组装到各自的 `ygopro/formats/*` 目标

### Requirement: 资源刷新排除 EDOPro 数据
每次定时资源刷新必须（SHALL）避免拉取、复制、计算指纹或保留仅供 EDOPro 使用的卡片数据库、脚本、禁限卡表树或仓库缓存。仍有 YGOPro 消费者的共享资源源可以保留，但不得向 `edopro/*` 路径组装数据。

#### Scenario: 定时刷新完成
- **WHEN** 资源更新器发布刷新后的版本
- **THEN** 不拉取任何仅供 EDOPro 使用的资源源，不在仓库缓存或发布版本中创建 EDOPro 路径，并且保留的双用途资源源仅发布 YGOPro 所需文件

### Requirement: YGOPro 禁限卡表标识保持一致
房间展示、卡组校验、录像元数据和持久化决斗事件必须（SHALL）以选定的 YGOPro 禁限卡表作为唯一事实来源，并报告一致的、由 YGOPro 生成的禁限卡表名称和哈希。

#### Scenario: 各类输出报告同一禁限卡表
- **WHEN** 使用已配置的 YGOPro 禁限卡表创建房间并完成一场决斗
- **THEN** 房间 API、录像元数据和持久化决斗事件均标识同一份 YGOPro 禁限卡表，且不查询 EDOPro 禁限卡表仓库

### Requirement: 移除端点后统计订阅仍然有效
启用统计持久化时，YGOPro 游戏结束事件必须（SHALL）继续送达所有已配置的排行、比赛摘要、决斗摘要和非排位比赛订阅者，且不要求初始化 EDOPro 服务器。

#### Scenario: 完成的决斗更新统计数据
- **WHEN** 启用统计持久化时，一场 YGOPro 决斗发布游戏结束事件
- **THEN** 所有已配置的统计订阅者均恰好处理该事件一次

### Requirement: 管理界面仅处理 YGOPro 数据
继续受支持的 HTTP 检查、房间、卡片数据库、卡片搜索、禁限卡表、资源版本和管理消息能力必须（SHALL）仅基于 YGOPro 数据运行。EDOPro 专用房间创建行为和 EDOPro 响应分支必须（SHALL）不可用。

#### Scenario: 查询原混合检查端点
- **WHEN** 客户端查询一个保留的、过去会返回两种引擎数据的检查端点
- **THEN** 响应仅包含文档声明的 YGOPro 数据，且不包含 `edopro` 分支

#### Scenario: 广播管理消息
- **WHEN** 已授权管理员广播服务器消息
- **THEN** 已连接的 YGOPro 房间客户端收到兼容 YGOPro 的消息

#### Scenario: 请求 EDOPro 专用房间创建
- **WHEN** 客户端调用已移除的 EDOPro 专用房间创建行为
- **THEN** 服务器报告该路由或行为不可用，且不创建房间

### Requirement: 部署产物不包含 EDOPro 运行时资产
生产构建与部署产物不得（SHALL NOT）包含 EDOPro TypeScript 模块、原生 CoreIntegrator、EDOPro SQLite 数据库或热重载器、EDOPro 专用包依赖、EDOPro 环境变量或 EDOPro 构建工具。YGOPro WASM 决斗核心必须（SHALL）保持可用。

#### Scenario: 检查生产产物
- **WHEN** 从干净检出的代码构建生产镜像
- **THEN** 镜像包含 YGOPro 应用和 WASM 决斗核心，但不包含任何已移除的 EDOPro 运行时资产

### Requirement: 安全移除遗留 EDOPro 部署数据
部署迁移必须（SHALL）先发布并验证可用的 YGOPro 专用资源版本，再删除过时的 EDOPro 仓库、生成数据库、旧资源版本、镜像、数据卷、端口和外部路由配置。

#### Scenario: 升级现有部署
- **WHEN** 将包含 EDOPro 资产的现有安装迁移到 YGOPro 专用版本
- **THEN** 新的 YGOPro 资源版本先完成启用，之后才移除过时的 EDOPro 数据

#### Scenario: 验证清理结果
- **WHEN** 部署后验证完成
- **THEN** 任何活动或保留的部署路径都不会重新创建 EDOPro 资产，且 YGOPro 决斗冒烟测试成功
