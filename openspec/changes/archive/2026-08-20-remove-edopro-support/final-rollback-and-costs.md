# 最终回滚边界与成本对比（任务 9.4）

## 回滚边界（执行 9.3 破坏性清理后固化）

| 阶段 | 回滚能力 | 回滚方式 | 成本 |
| --- | --- | --- | --- |
| **9.2 部署后、9.3 清理前**（当前） | 完整回滚 | 换回上一版镜像（`evolution:baseline-edopro` / `edopro-server-ts-main-server:latest`）+ 恢复旧资源版本（停止的 `evolutionygo-server` 容器内 193 MB 资源树，可重启或导出）+ 恢复入口 | 低（分钟级，无数据损失） |
| **9.3 清理后** | 仅重新构建式回滚 | 旧镜像、旧容器、旧数据卷、EDOPro 仓库缓存均已删除；回滚需**重新构建并部署上一版本及其资源**（design.md 迁移计划第 8 步） | 高（需重新克隆 EDOPro 源、重装依赖、重建镜像） |
| 数据 | Postgres/Valkey 数据卷未纳入本次清理（`nostalgia-duel-server_postgres_data` / `_valkey_data` 为现行数据）；旧项目卷 `edopro-server-ts-main_*` 为历史部署数据，删除前须数据负责人确认无迁移需求 | — | — |

结论：**破坏性清理被刻意安排在最后**；9.3 一旦执行，回滚即从「换镜像」退化为「重建」，因此 9.3 的前置验证（§2 盘点 + §4 健康检查 + 新缓存映射验证）不可省略。

## 成本对比（变更前 `baseline.md` vs 变更后 `post-change-measurements.md`）

| 指标 | 变更前 | 变更后 | 降幅 |
| --- | --- | --- | --- |
| 生产镜像 | 959 MB | 718 MB | **-25%** |
| 仓库缓存（全新克隆） | 254 MB | 126 MB | **-50%** |
| 资源发布版本 | 193 MB（含 edopro 树 107 MB） | 87 MB | **-55%** |
| 生成 SQLite `evolution_cards.db` | 11 MB | 0 | -11 MB |
| 原生 C++ 核心 `core/` | 4.2 MB | 0 | -4.2 MB |
| 启动时间 | ≈1.5 s | ≈1.02 s | **-32%** |
| 空闲 RSS | ≈257 MB | ≈162 MB | **-37%** |
| 对外服务端口 | 6 个（含 EDOPro 7911/4001） | 4 个（仅 YGOPro：7711/4002/4000/7922） | EDOPro 端口消除 |
| 单次资源刷新 | 未测量（基线推迟） | ≈113 s，写入 87 MB/版 | 新基线；刷新不再拉取/发布 EDOPro 资产 |
| 维护面 | 双协议栈（消息/房间/禁限卡表/资源/启动/HTTP） | 单 YGOPro 栈 | 长期维护成本减半 |

## 独立后续变更（明确留出，不在本次范围）

- **Postgres/Valkey 可选化**：当前统计/排行仍强依赖 Postgres，Redis/Valkey 行为保持原样（`USE_REDIS` 门控已存在但未做完整可选化）；如需单容器精简部署，应作为独立成本优化变更。
- **固定资源部署**：当前资源更新器仍按清单定时刷新并发布新版本；若改为固定版本/人工审批发布，属独立的资源管理变更，不随本次清理推进。

## 遗留运维事项（交接给 9.3 审批流程）

1. `.env` 残留 `HOST_PORT=7911`（代码已移除，配置未清）。
2. 主机 `repositories/` 遗留缓存 `edopro-scripts/`、`edopro-cdbs/`、`edopro-lflists/` 共 ≈130 MB（见运行手册 §1.1）。
3. 旧部署容器 `evolutionygo-*`（3 个，已停止）与旧项目数据卷 `edopro-server-ts-main_*`（见运行手册 §1.2）。
4. 旧镜像 `evolution:baseline-edopro`（959 MB）与 `edopro-server-ts-main-server:latest`（945 MB）在 9.3 审批后可删除。
