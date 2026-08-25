# ygopro-only-server Specification

## Purpose
定义项目作为 YGOPro 专用怀旧决斗服务器运行时可从外部验证的行为契约，确保系统不再交付、初始化、刷新或暴露未使用的 EDOPro 协议栈与资源栈。

## Requirements

### Requirement: 仅提供 YGOPro 决斗端点
服务器必须（SHALL）暴露已配置的 YGOPro TCP 和 WebSocket 决斗端点，并且不得（SHALL NOT）暴露 EDOPro TCP 或 WebSocket 决斗端点。

#### Scenario: YGOPro 客户端连接
- **WHEN** 兼容的 YGOPro 客户端连接到已配置的 YGOPro 决斗端点
- **THEN** 服务器使用 YGOPro 协议接受并处理该连接

#### Scenario: EDOPro 端点不存在
- **WHEN** 检查已部署服务的监听器配置与对外发布端口
- **THEN** 不存在 EDOPro 决斗监听器、端口映射、入口规则或健康检查

### Requirement: 保持 YGOPro TCP 线协议兼容
服务器必须（SHALL）继续接受二字节小端长度前缀的 YGOPro TCP 帧，长度值包含一字节命令和消息负载。加入序列依次为 `ExternalAddress (0x17)`、`PlayerInfo (0x10)` 和 `JoinGame (0x12)`；`PlayerInfo` 使用 20 个 UTF-16LE 字符槽，`JoinGame` 使用协议版本 `0x1362`、两个 `0xCC` 字节、一个 32 位保留/游戏 ID 字段和 20 个 UTF-16LE 字符槽的房间口令。

#### Scenario: 接受固定 YGOPro 首包序列
- **WHEN** TCP 连接发送服务端测试目录中的 `ExternalAddress`、`PlayerInfo` 和 `JoinGame` 固定二进制样本
- **THEN** 服务器按顺序且各一次消费三条消息，`ExternalAddress` 不会覆盖后续加入所需的上一条 `PlayerInfo`，服务器取得玩家名、版本和房间口令并进入现有 YGOPro 加入流程，且不调用 EDOPro 消息解析器

#### Scenario: 首包跨越任意 TCP 分块
- **WHEN** 同一份固定首包样本的长度前缀、命令或负载被拆分到多个 TCP 数据块，或者多条完整消息被合并到一个数据块
- **THEN** 服务器等待完整帧后再处理，并按线协议顺序且各一次分发每条完整消息

#### Scenario: 收到不完整或非法长度的帧
- **WHEN** TCP 连接发送截断帧、非法长度或超过服务器上限的帧
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

#### Scenario: 协议版本不兼容
- **WHEN** YGOPro 加入帧使用不受支持的协议版本加入房间
- **THEN** 服务器在连接关闭前发送有效的 YGOPro 版本拒绝消息，并向该连接发送一条可读的升级客户端提示；房间保持不变

#### Scenario: 房间口令错误
- **WHEN** YGOPro 加入帧携带错误的房间口令
- **THEN** 服务器按现有 YGOPro 静默拒绝行为关闭连接，不创建、不加入且不修改任何房间，也不继续匹配其他加入策略

### Requirement: 服务端协议回归在 WSL 内自包含执行
阻断重构合入的自动回归必须（SHALL）能够仅在 WSL 中使用 Node.js、固定线协议样本和测试侧套接字完成。全部测试输入、预期结果和执行命令必须（SHALL）位于服务端仓库内，且不得读取外部源码或构建产物。

#### Scenario: 在 WSL 中执行阻断回归
- **WHEN** 开发者或 CI 在干净的服务端检出中执行聚焦测试和完整测试命令
- **THEN** YGOPro TCP 首包、分片/粘包、加入拒绝、房间生命周期、WebSocket、HTTP、统计和资源测试均可在 WSL 内完成，且网络测试只监听系统分配的临时 loopback 端口

### Requirement: 应用制品仅包含固定 YGOPro 资源

每个已部署应用制品必须（SHALL）直接包含显式启用的固定 YGOPro 怀旧环境所需卡片数据库、脚本、禁限卡表和 WASM 决斗核心，并且不得（SHALL NOT）包含组装后的 `edopro` 资源树、未启用 YGOPro 赛制资源、扩展卡池或外部资源 source。当前启用集合必须（SHALL）仅为 OCG 2011.03（1103）与 OCG 2011.09（1109）。

#### Scenario: 从干净检出构建生产制品

- **WHEN** 从干净应用检出构建生产镜像或其他可部署制品
- **THEN** 制品直接包含固定基础数据库和脚本、1103/1109 禁限卡表及各自环境脚本、资源锁和 YGOPro 决斗核心，且不包含 `edopro`、未启用赛制或资源仓库缓存

#### Scenario: 资源与应用版本保持一致

- **WHEN** 检查已部署实例的应用版本和固定资源摘要
- **THEN** 所有资源均来自该应用版本的制品，不存在可独立选择、刷新或回滚的资源版本

### Requirement: 运行时不刷新决斗资源

服务器运行时不得（SHALL NOT）存在决斗资源刷新流程，并且不得（SHALL NOT）拉取、复制、计算刷新指纹、组装或保留 EDOPro 数据以及未启用 YGOPro 赛制数据。固定 1103/1109 卡池、脚本和禁限卡表只能（SHALL）通过经过审核并生成新资源锁的应用版本变更。

#### Scenario: 应用持续运行

- **WHEN** 已部署服务经过原资源刷新周期或外部上游资源发生变化
- **THEN** 当前进程不发起资源网络请求、不创建仓库缓存或 release 目录，并继续使用启动时随应用制品加载的固定资源

#### Scenario: 审核后升级固定资源

- **WHEN** 运维部署一份包含新资源锁且通过全部完整性校验的新应用版本
- **THEN** 新代码与完整的 1103/1109 固定资源作为同一制品生效，上一应用制品继续作为整体回滚边界

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
