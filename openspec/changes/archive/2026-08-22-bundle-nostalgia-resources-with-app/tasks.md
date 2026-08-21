## 1. 锁定直接资源契约

- [x] 1.1 在资源解析器同目录添加失败测试，证明运行时从单一资源根解析 base、1103 和 1109，且不读取 manifest 或 `resources/current`
- [x] 1.2 扩展资源生成器测试，覆盖完整 lock 成功、CDB/LFList/脚本漂移、必需文件缺失及 EDOPro/未启用赛制目录越界
- [x] 1.3 添加启动边界测试，证明资源完整性校验在持久化连接和端口监听前执行，失败时进程不接受流量
- [x] 1.4 更新资源版本接口测试，锁定响应只报告应用内 lock、基础卡池与 1103/1109 摘要

## 2. 直接加载应用内固定资源

- [x] 2.1 将资源配置收敛为默认 `./nostalgia-resources` 的单一根目录，并移除 `MANIFEST_PATH` 与运行时 manifest 配置
- [x] 2.2 以固定布局和领域层 1103/1109 注册表替换通用 manifest 路径解析，保持 format-first、base-fallback 脚本顺序
- [x] 2.3 将完整 lock 校验接入资源启动流程，并在任何数据库、LFList、脚本或边界检查失败时快速终止
- [x] 2.4 将 `npm run check:nostalgia-resources` 统一为对完整资源根执行同一校验，保留有意资源变更使用的 lock 生成命令
- [x] 2.5 运行资源解析、加载、WASM 决斗、禁限卡表和版本接口聚焦测试，确认 1103/1109 卡池仍为 5002/5120

## 3. 将资源纳入应用制品

- [x] 3.1 修改 Docker 构建，在生成制品前执行完整资源校验，并将 `nostalgia-resources/` 直接复制到最终镜像
- [x] 3.2 将容器入口改为直接启动 Node.js，移除资源准备脚本、manifest 和 `resources/current` 的镜像依赖
- [x] 3.3 更新 Compose 与 `.env.example`，删除 manifest/独立资源版本配置并使用应用内固定资源根
- [x] 3.4 添加或更新产物契约测试，证明干净镜像包含完整固定资源且不包含 EDOPro、外部 source、仓库缓存、release 目录或资源更新器

## 4. 删除遗留热更新管线

- [x] 4.1 全仓库审计资源脚本及 manifest 引用，区分仍有消费者的通用运维脚本与仅服务旧资源管线的文件
- [x] 4.2 删除 `clone_repositories.sh`、`setup_resources.sh`、资源 assembly 库、通用 manifest 及不再使用的 source/fixture
- [x] 4.3 删除只验证 clone、assembly、release、软链接、GC、私有覆盖和刷新周期的 Bats 测试，保留并迁移 YGOPro-only 与固定资源断言
- [x] 4.4 删除运行时对 `repositories`、`resources/releases` 和 `resources/current` 的代码、配置和测试引用，并确认不存在资源定时器或网络获取路径
- [x] 4.5 更新 `.gitignore` 与干净检出检查，确保全部必需 CDB、LFList、Lua 和 lock 文件均由 Git 跟踪，且构建不依赖被忽略的本地脚本

## 5. 更新开发与部署文档

- [x] 5.1 将 README 本地启动简化为安装依赖、创建环境配置和执行 `npm run dev`，删除资源拉取/组装步骤
- [x] 5.2 更新根与相关模块 AGENTS 指南，明确应用/资源单一版本、无热更新及完整 lock 门禁
- [x] 5.3 更新运维说明，记录镜像整体发布与回滚流程，以及新镜像验证成功后手工清理旧 `repositories`/`resources/releases` 的安全步骤

## 6. 完整验证与迁移演练

- [x] 6.1 从干净检出执行 `npm ci`、完整资源检查、lint、全部测试和生产构建，确认不需要资源准备脚本或网络资源 source
- [x] 6.2 构建并检查生产镜像，验证代码与固定资源同版存在、入口直接启动且无 manifest、updater、release 软链接或 EDOPro 资产
- [x] 6.3 在隔离端口分别以 `1103#1001` 和 `1109#1001` 完成建房、卡组校验与真实 WASM 决斗，并核对资源版本接口摘要
- [x] 6.4 演练部署新镜像与恢复上一镜像，确认代码、CDB、LFList、Lua 和 lock 始终整体切换且不挂载独立资源目录
- [x] 6.5 记录启动时完整校验耗时，并确认其在可接受范围内且不会在进程运行期间重复执行
