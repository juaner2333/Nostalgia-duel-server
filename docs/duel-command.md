# duel 命令说明（云主机运维快捷命令）

`duel` 是 Nostalgia-duel-server 云主机上的运维快捷命令，包装固定的 compose 命令与房间查询接口，避免每次敲长路径与 sudo 前缀。

- 脚本位置（仓库）：`scripts/duel.sh`
- 安装位置（服务器）：`/usr/local/bin/duel`（所有用户可用，PATH 默认包含）
- 部署形态基线：镜像直拉、无 PostgreSQL/Valkey 中间件（`docker-compose.cloud.yaml`）

## 命令总表

| 命令 | 作用 | 背后实际执行 |
| --- | --- | --- |
| `duel up` | 启动/更新配置后重启（幂等，最常用） | `sudo docker compose -f /opt/nostalgia-duel-server/docker-compose.cloud.yaml up -d` |
| `duel restart` | 强制重建容器（清状态、疑似异常时用） | 同上 + `--force-recreate` |
| `duel ps` | 查看容器状态与端口映射 | 同上 + `ps` |
| `duel logs` | 跟踪最近 100 行日志（Ctrl+C 退出） | 同上 + `logs -f --tail 100` |
| `duel down` | 停止服务并移除容器（日志重置） | 同上 + `down` |
| `duel rooms` | 查看当前活动房间列表（实时内存状态） | `curl http://127.0.0.1:7922/api/rooms` + python 格式化 |
| `duel help` | 列出可用子命令 | — |
| `duel`（无参数） | 等价 `duel up` | — |

## duel rooms 详解

调用管理 HTTP 的 `GET /api/rooms`（无需鉴权，实时读进程内存，无缓存），并格式化输出：

```
$ duel rooms
当前活动房间: 2
  1103#1083300  [dueling]  2/2人  观众0  casual  OCG 1103
      玩家: LT-H-mt5yubcyjg5 / LT-G-mt5yubcyjg5
  1109#1083301  [dueling]  2/2人  观众0  casual  OCG 1109
      玩家: LT-H-mt5yubd0m8f / LT-G-mt5yubd0m8f
```

字段来源为 `YGOProRoom.toRoomListDTO()`：

| 字段 | 含义 |
| --- | --- |
| `1103#1083300` | `formatId#externalRoomId`，房间身份（环境#外部房间号） |
| `[dueling]` | `status`：duelState（waiting / dueling / end 等） |
| `2/2人` | 已入座玩家数 / 满员数（`players.length` / `maxPlayers`） |
| `观众0` | 观战人数（`spectators`） |
| `casual` | league 类型：casual / verified / external |
| `OCG 1103` | `banlist`：禁限卡表名称 |
| `玩家:` | 双方玩家名（`players[].name`，已去空字符） |

## 安装 / 更新服务器版本

仓库改完脚本后，同步到服务器：

```bash
# 从仓库拷贝并授权（root 执行）
sudo cp scripts/duel.sh /usr/local/bin/duel
sudo chmod 755 /usr/local/bin/duel
# 语法检查
sudo bash -n /usr/local/bin/duel
```

改脚本前建议备份：`sudo cp /usr/local/bin/duel /usr/local/bin/duel.bak`

## 设计要点与注意事项

- **为什么都带 sudo**：compose 客户端需要读取 `.env`（root 600 权限，含 `ADMIN_API_KEY`）；ubuntu 账号有 NOPASSWD sudo，免密执行，无需切 root。
- **`duel rooms` 的端口写死 7922**：与 `.env` 的 `HTTP_PORT` 一致；若修改 `HTTP_PORT`，必须同步更新脚本中的 URL。
- **`.env` 属于服务器本地文件**（仓库只有 `.env.example` 模板，真实密钥不入 git）。
- **回滚**：`duel up` 幂等，配置恢复用 `git revert` / `.bak` 文件；容器级回滚改 `.env` 的 `SERVER_IMAGE` tag 后 `duel up`。