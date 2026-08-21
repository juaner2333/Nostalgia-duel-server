# 运维运行手册：应用与固定资源单一版本（bundle-nostalgia-resources-with-app）

> 对应 OpenSpec 变更 `openspec/changes/bundle-nostalgia-resources-with-app/`（spec: `application-bundled-resources`、`ygopro-only-server`）。
> 环境基线：WSL2 + Docker Compose，项目 `nostalgia-duel-server`（`docker-compose.prod.yaml`：postgres / valkey / server 三服务）。

## 1. 版本模型

代码、固定 CDB、1103/1109 LFList、Lua 脚本与 `lock.json` 是**同一个不可拆分版本**：

- 随同一 Git 提交和 Docker 镜像发布、升级与回滚；不存在独立资源版本、资源发布 ID 或兼容矩阵。
- 镜像内 `nostalgia-resources/` 是运行时唯一资源根；镜像外不挂载、不提供资源目录。
- 容器入口直接启动 Node.js；运行中无任何资源克隆、下载、刷新、组装或 GC 路径。
- 资源版本接口（`GET /api/resources/version`）报告镜像内 `lock.json` 摘要、基础卡池与 1103/1109 摘要，用于核对实际加载版本。

## 2. 发布（整体制品）

1. 编辑受控资源文件（`nostalgia-resources/ygopro/base/cards.cdb`、`formats/1103|l1109/lflist.conf`、`script/`）后，**显式**生成新 lock 并评审差异：
   ```bash
   npm run generate:nostalgia-lock
   git diff nostalgia-resources/lock.json
   ```
2. 完整校验必须通过（CI 与镜像构建使用同一命令，启动时也执行同一校验）：
   ```bash
   npm run check:nostalgia-resources
   ```
3. 构建并推送应用镜像（buildspec/CI 在制品生成前执行完整资源校验）：
   ```bash
   docker compose -f docker-compose.prod.yaml build server
   docker compose -f docker-compose.prod.yaml push server
   ```
4. 部署新镜像并完成冒烟验证（见 §4），验证通过后旧镜像按既有保留策略清理。

## 3. 回滚（整体版本）

- 回滚 = 恢复**上一应用镜像**（连同其内固定资源）并重新启动 server 服务；**不得**单独恢复、导出或挂载旧 `resources/current`。
- 不支持旧应用 + 新资源或新应用 + 旧资源的拼接；镜像标签/摘要就是唯一回滚边界。
- 数据服务（postgres/valkey）不受影响，正常随 compose 重启。

## 4. 部署后验证

```bash
# ① 进程与端口（仅 YGOPro 端口）
ss -tlnp | grep -E ':(706|4002|4000|7922)'
# ② 启动日志：完整校验先于任何连接/监听
docker logs --since 10m <server> | grep -E 'integrity verified|resources & ban lists loaded'
# ③ 资源版本接口与镜像内 lock 一致
docker exec <server> sha256sum nostalgia-resources/lock.json
curl -sf http://127.0.0.1:7922/api/resources/version | jq '.fixedNostalgia'
# ④ 双环境冒烟：分别以 1103#<roomId> 与 1109#<roomId> 完成建房、卡组校验与完整决斗
```

任一校验失败 → 立即按 §3 回滚上一镜像。

## 5. 遗留目录清理（新镜像验证通过后）

以下对象来自已删除的旧资源管线，**仅在新镜像部署并完成 §4 验证之后**手工清理，使用明确绝对路径，禁止通配根目录：

| 对象 | 说明 | 清理命令（示例，按实际路径） |
| --- | --- | --- |
| 旧宿主机 `repositories/` | 旧 clone 缓存（`*repositories/`） | `rm -rf /path/to/project/repositories` |
| 旧宿主机 `resources/releases/`、`resources/current` | 旧组装发布与软链接 | `rm -rf /path/to/project/resources` |
| 旧容器内同名目录 | 上一镜像内残留 | 随旧镜像/容器删除一并处理 |

- 应用**不会**在启动时自动删除这些目录（不做运行时破坏性 GC）。
- 若旧镜像仍需保留作回滚资产，其内部目录随镜像保留；清理以镜像保留策略为准。

## 6. 资源变更门禁

- 任何卡池、禁限卡表或脚本变更都必须：编辑受控文件 → 显式生成新 lock → 评审差异 → 通过完整校验 → 发布新应用版本。
- 禁止在运行环境中手工修改资源、绕过 lock 或独立回滚资源。
