## Why

1103 与 1109 怀旧环境不需要追随上游卡牌资源更新，稳定、可复现的卡池与裁定比运行时热更新更重要。当前保留的资源拉取、组装、release 目录和 `resources/current` 软链接源自多引擎热更新架构，但应用内热重载已经移除，这些遗留机制增加了本地启动、镜像构建和版本兼容复杂度，却不能提供完整一致的热更新能力。

## What Changes

- 将 TypeScript 应用、固定 CDB、1103/1109 LFList、Lua 脚本与 `lock.json` 定义为不可拆分的单一发布单元，统一随 Git 版本和 Docker 镜像发布、回滚。
- 运行时直接读取随应用交付的 `nostalgia-resources/`，干净检出完成依赖安装和环境配置后即可启动，不再要求预先拉取或组装资源。
- 将完整资源 lock 校验提升为 CI 和镜像构建门禁，覆盖数据库卡片集合、双环境白名单、LFList、Lua 脚本及禁止出现的资源路径。
- **BREAKING**：移除 `clone_repositories.sh`、`setup_resources.sh`、通用资源 assembly/release/GC 逻辑，以及 `resources/current`、`resources/releases`、`repositories` 运行时约定。
- **BREAKING**：移除运行时资源 source/manifest 抽象与 `MANIFEST_PATH` 配置；资源根目录只接受固定布局，不再支持 Git、HTTP、私有覆盖或多 source 组装。
- 移除遗留资源管线的 Bats 测试和文档，改为固定资源完整性、干净检出启动、镜像内容及整体回滚契约测试。
- 保留资源版本接口，并让其报告随应用交付且实际加载的 lock、基础卡池及 1103/1109 摘要。

## Capabilities

### New Capabilities

- `application-bundled-resources`: 定义固定怀旧资源与应用作为单一制品发布、构建时完整校验、运行时禁止刷新以及整体回滚的契约。

### Modified Capabilities

- `ygopro-only-server`: 将 YGOPro 资源交付从拉取、组装和周期刷新改为随应用直接交付，并明确运行时不存在任何决斗资源更新路径。

## Impact

- 资源与启动：`nostalgia-resources/`、`src/config/`、`ResourcePoolResolver`、`YGOProResourceLoader`、资源版本接口及 `.env.example`。
- 构建与部署：`Dockerfile`、Compose 配置、npm scripts、CI 门禁和应用镜像回滚流程。
- 删除范围：资源获取/组装 shell 脚本、通用 manifest、生成 release 目录约定及相关 Bats 测试。
- 文档：README、AGENTS 指南和部署说明改为单一应用制品工作流。
- 外部影响：部署者不能再独立刷新或回滚资源；任何卡池、禁限卡表或脚本变更都必须生成新 lock，并通过新的应用版本发布。
