## Why

怀旧服仅供使用 YGOPro 协议的客户端接入，但当前部署仍会交付并初始化完整的 EDOPro 协议栈、C++ 决斗核心、SQLite 卡片数据库、卡片脚本、禁限卡表、监听端口和兼容代码。移除这条未使用的路径，可以降低镜像体积、运行时磁盘占用与写入、原生依赖和对外服务数量，并减少长期维护两套相互耦合协议实现的成本。

## What Changes

- **BREAKING** 移除 EDOPro TCP 和 WebSocket 决斗端点，包括对应端口与连接处理器。
- **BREAKING** 移除 EDOPro 专用 HTTP 行为，并从共享检查 API 中移除 EDOPro 分支和字段，同时保留有价值的 YGOPro 专用端点。
- 移除 EDOPro 的房间、客户端、消息、卡组、录像、禁限卡表、卡片数据库和 C++ CoreIntegrator 实现。
- 移除 EDOPro 资源源及其组装后的资源树。仍需个别上游禁限卡表文件的 YGOPro 赛制，改为通过 YGOPro/怀旧服资源提供，而不是依赖 EDOPro 资源树。
- 移除 EDOPro SQLite 构建与热重载路径、原生依赖、Docker 构建阶段、脚本、包依赖、路径别名、测试、文档和部署配置。
- 在删除 EDOPro 模块前，解除 YGOPro 与共享领域代码对 EDOPro 所有类型的依赖。
- 保留 YGOPro TCP/WebSocket 决斗、怀旧赛制、录像、匹配、WindBot、认证、排行与统计、HTTP 管理以及房间观战行为。
- 为遗留的 EDOPro 仓库缓存、资源发布版本、生成数据库、容器镜像、端口和外部部署配置增加明确的清理与验证步骤。

## Capabilities

### New Capabilities

- `ygopro-only-server`：定义项目作为 YGOPro 专用怀旧决斗服务器运行时，在协议、运行时、资源、API、持久化、部署、清理和回归方面的保证。

### Modified Capabilities

无。当前尚无主规范，本次以新能力的形式引入 YGOPro 专用运行契约。

## Impact

- 代码：`src/edopro/`、共享房间/认证/消息边界、Socket 启动流程、资源初始化与重载、持久化初始化、HTTP 控制器、测试支持代码，以及 YGOPro 房间/状态依赖。
- 运行时：移除 EDOPro 监听器和定时任务；统计订阅者从 `HostServer` 中迁出，确保 YGOPro 事件持久化继续生效。
- 资源：`resources.manifest.json`、仓库缓存、组装后的发布版本和运行时更新器不再拉取或发布 EDOPro 资产。
- 构建与部署：根目录 `core/`、Docker 原生构建阶段与系统库、Compose 端口和环境变量、辅助脚本、包依赖、CI 检查、外部入口与健康检查，以及遗留部署数据。
- API：移除 EDOPro 专用路由；混合检查响应改为仅返回 YGOPro 数据，因此调用方不能再依赖 `edopro` 字段。
