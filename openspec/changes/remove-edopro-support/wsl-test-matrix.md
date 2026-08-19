# WSL 阻断测试矩阵（remove-edopro-support）

> 任务 1.10 产出。目的：证明阻断本次重构合入的全部回归仅依赖 ①服务端仓库本身 ②WSL 中的 Node.js/Jest（Jest 测试）与 Bats（Shell 测试），不读取外部源码、构建产物或真实资源树。
> 实测环境：WSL2（Ubuntu），Node v24.19.0，Jest 30.4.1，Bats 1.10.0（`sudo apt-get install -y bats`，与 CI `pipeline.yaml` 一致）。测量日期：2026-08-19。

## 执行前提（一次性）

```bash
# Node/Jest：仓库自带依赖，无需全局安装
npm ci            # 或 npm install

# Bats：仅 Shell 资源测试需要，安装方式与 CI 一致
sudo apt-get install -y bats
```

以下所有命令均在仓库根目录执行。网络类测试只监听系统分配的临时 loopback 端口（`listen(0)` / 端口 0），不占用固定端口、不需要 Docker、Postgres、Valkey 或任何外部资源树（`repositories/`、`resources/` 均未参与）。

## 矩阵

| 领域 | 测试文件 | 覆盖内容 | 可复制命令 |
| --- | --- | --- | --- |
| 协议（固定线样本） | `src/test-support/fixtures/ygopro-first-packet.ts` + `src/shared/messages/MessageProcessor.test.ts` | 人工核对的固定十六进制首包（ExternalAddress 0x17 / PlayerInfo 0x10 / JoinGame 0x12，版本 0x1362）；整包解析、逐字节喂入、任意分片边界、粘包多帧、半帧缓冲；期望值来自已提交样本而非被测编码器 | `npx jest src/shared/messages/MessageProcessor.test.ts` |
| TCP 接入 | `src/socket-server/YGOProServer.test.ts` | 真实 TCP：固定首包准入与 YGOPro 线格式加入响应；失败契约——版本拒绝先发错误帧再关闭、错误口令静默销毁不落房、重复玩家名、未知命令、零长度/超限长度帧、帧中/帧间断连不留房间 | `npx jest src/socket-server/YGOProServer.test.ts` |
| WebSocket 票据认证 | `src/socket-server/HandshakeTicketAuthenticator.test.ts` | Bearer 头 / `?ticket=` 查询参数提取与单次消费语义 | `npx jest src/socket-server/HandshakeTicketAuthenticator.test.ts` |
| WebSocket 服务端 | `src/socket-server/WSYGOProServer.test.ts` | 端口监听、心跳 sweep、关闭清理（单元级，http mock） | `npx jest src/socket-server/WSYGOProServer.test.ts` |
| WebSocket 契约 | `src/socket-server/WSYGOProServerSocket.test.ts` | 真实 WS：票据拒绝不入房、匿名准入、首消息竞态（票据未决时 0x12 挂起）、应用层 ping(0xff)/pong(0xfe) 回显、0xfd 令牌重连（成功 ack + 状态重同步 + 令牌轮换）、未知令牌失败 ack 后关闭、心跳超时 terminate | `npx jest src/socket-server/WSYGOProServerSocket.test.ts` |
| 房间生命周期 | `src/socket-server/YGOProRoomLifecycle.test.ts` | 双测试侧套接字：创建/加入、卡组校验与就绪广播、聊天/表情、开局/RPS/先后手选择、断线保房与重连再准入、投降→录像投递→双方优雅关闭 | `npx jest src/socket-server/YGOProRoomLifecycle.test.ts` |
| HTTP（YGOPro-only 契约） | `src/http-server/YGOProOnlyHttpContract.test.ts` | 10 个 `it.failing` 契约：databases/banlists/资源版本响应无 edopro 分支、edopro 引擎参数被 400 拒绝、卡片搜索不触达 edopro 仓储、检查页 HTML 无 edopro、房间创建与管理消息仅 YGOPro（阶段 5 实现后逐条翻转） | `npx jest src/http-server/YGOProOnlyHttpContract.test.ts` |
| 统计 | `src/shared/stats/StatsSubscriptionStartup.test.ts` + `src/shared/stats/basic/application/BasicStatsCalculator.test.ts` + `src/shared/stats/unranked-match/application/UnrankedMatchSaver.test.ts` | `it.failing` 启动流程测试：不构造 EDOPro 服务器时游戏结束事件仍注册并恰好一次送达每个订阅者（任务 4.1 实现后翻转）；既有计算器/保存器行为回归 | `npx jest src/shared/stats` |
| 资源（Shell） | `test/resources-lib.bats` + `test/manifest-runtime-tolerance.bats` | `resources-lib.sh` 全量行为（RSM-002~006/012）：manifest 校验、运行时容忍、GC 保留策略、无硬编码源路径；fixture 在 `setup()` 内生成，不依赖 `repositories/` 真实数据 | `bats test/*.bats` |

## 门禁命令（每次重构提交）

```bash
npm run lint                     # Biome，全仓库
npm run test                     # Jest 全量：122 套件 / 1021 测试（2026-08-19 实测全绿）
bats test/*.bats                 # Bats 57 项（2026-08-19 实测全绿）
```

## 自包含性声明

- 全部固定样本（`src/test-support/fixtures/ygopro-first-packet.ts`）、预期结果与执行命令均在仓库内；Jest 期望值不使用被测编码器重新生成。
- 网络测试仅监听系统分配的临时 loopback 端口；Bats fixture 由 `setup()` 在临时目录生成，`teardown()` 清理。
- 不依赖 `repositories/`、`resources/`、Docker、Postgres、Valkey 或任何 EDOPro/客户端外部产物。
- 两个 `it.failing` 文件（HTTP 契约、统计启动流程）当前为"失败先行"特征测试：断言的 YGOPro-only 行为在阶段 4/5 实现前必然失败，failing 标记吸收该失败；实现完成后逐条去除标记并保持通过。验证失败原因时可临时去掉 `it.failing(` 后单独运行确认是断言失败而非崩溃（已逐一验证：edopro 分支存在、状态码 200/404 vs 期望 400、edopro 仓储被调用、响应含 edopro 字段等）。

## 阶段翻转对照（供后续任务勾选）

| 特征测试 | 翻转时机 |
| --- | --- |
| `StatsSubscriptionStartup.test.ts` | 任务 4.1（显式统计启动流程）落地后去 failing |
| `YGOProOnlyHttpContract.test.ts` ①-⑦（响应无 edopro 分支/引擎拒绝） | 任务 5.1-5.2 |
| `YGOProOnlyHttpContract.test.ts` ⑧（房间创建不可用） | 任务 5.3 |
| `YGOProOnlyHttpContract.test.ts` ⑨-⑩（房间列表/管理消息仅 YGOPro） | 任务 5.4-5.5 |
