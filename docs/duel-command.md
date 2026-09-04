# duel 命令说明（云主机运维快捷命令）

`duel` 是 Nostalgia-duel-server 云主机上的运维快捷命令，包装固定的 compose 命令、房间查询接口与管理员接口，避免每次敲长路径与 sudo 前缀。

- 脚本位置（仓库）：`scripts/duel.sh`
- 安装位置（服务器）：`/usr/local/bin/duel`（所有用户可用，PATH 默认包含）
- 部署形态基线：**排位形态**：`postgres` + `nostalgia-duel-server`（`docker-compose.cloud.ranked.yaml`，`RANK_ENABLED=true` / `USE_REDIS=false`）

## 命令总表

| 命令 | 作用 | 背后实际执行 |
| --- | --- | --- |
| `duel up` | 启动/更新配置后重启（幂等，最常用） | `sudo docker compose -f /opt/nostalgia-duel-server/docker-compose.cloud.ranked.yaml up -d` |
| `duel restart` | 强制重建容器（清状态、疑似异常时用） | 同上 + `--force-recreate` |
| `duel ps` | 查看容器状态与端口映射 | 同上 + `ps` |
| `duel logs` | 跟踪最近 100 行日志（Ctrl+C 退出） | 同上 + `logs -f --tail 100` |
| `duel down` | 停止服务并移除容器（日志重置，PG 数据保留） | 同上 + `down` |
| `duel rooms` | 查看当前活动房间列表（实时内存状态） | `curl http://127.0.0.1:<HTTP_PORT>/api/rooms` + python 格式化 |
| `duel message <内容> [原因]` | 广播系统消息给所有在线房间的玩家与观战者 | `POST /api/admin/message`（`admin-api-key` 鉴权） |
| `duel reset <用户名>` | 重置用户密码并返回随机新密码 | `POST /api/admin/users/reset-password`（`admin-api-key` 鉴权） |
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

## duel message 详解（系统消息广播）

发送一条系统消息，服务器会以 `[原因] 内容` 的格式广播给**当前所有在线房间**的玩家与观战者（`MercuryRoomList` 实时遍历）；不在房间内的客户端收不到，不落库。

```
$ duel message "服务器将于 23:00 维护，请提前结束对局" "维护公告"
{"message": "服务器将于 23:00 维护，请提前结束对局", "reason": "维护公告"}
```

- 参数：`<内容>` 必填（1–500 字符）；`<原因标签>` 可选（1–50 字符，默认 `System`）
- 调用 `POST /api/admin/message`，body `{"message": "...", "reason": "..."}`
- 鉴权：header `admin-api-key`（值来自云端 `.env` 的 `ADMIN_API_KEY`，脚本自动读取，不回显）
- 校验失败（缺参数/超长）返回 400，不广播

## duel reset 详解（重置用户密码）

把指定用户名重置为随机生成的新密码（PG `users` 表，排位用户体系），用于玩家遗忘密码/需要改密时。**新密码只在响应中返回一次，妥善保管并告知对应玩家。**

```
$ duel reset PlayerOne
{
    "success": true,
    "data": {
        "username": "PlayerOne",
        "password": "x7Kp2qR9vWcT3aBd"
    }
}
```

- 参数：`<用户名>` 必填，精确匹配 `users.username`
- 调用 `POST /api/admin/users/reset-password`，body `{"username": "..."}`
- 鉴权：header `admin-api-key`（同 `duel message`）
- 用户不存在返回 `{"success": false, "error": "User not found"}`（404）
- 重置成功后旧密码立即失效；该接口依赖 PostgreSQL（排位形态），无 PG 的旧形态不可用

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

- **为什么都带 sudo**：compose 客户端与管理员接口需要读取 `.env`（root 600 权限，含 `ADMIN_API_KEY`）；ubuntu 账号有 NOPASSWD sudo，免密执行，无需切 root。
- **HTTP 端口动态读取**：脚本每次执行从 `.env` 读 `HTTP_PORT`（当前 `7922`），`rooms`/`message`/`reset` 均使用该值，改 `HTTP_PORT` 无需改脚本。
- **compose 指向排位形态**：`duel up/restart/ps/logs/down` 操作的是 `docker-compose.cloud.ranked.yaml`（与线上排位形态一致）；旧压测形态 `docker-compose.cloud.yaml` 仅用于形态回滚，勿用 `duel` 直连。
- **管理员接口鉴权**：`admin-api-key` 等同 `.env` 的 `ADMIN_API_KEY`，脚本通过 sudo 读取并只在请求头携带，日志/输出不回显密钥；手工调用请用 `curl -H "admin-api-key: <key>"`。
- **`.env` 属于服务器本地文件**（仓库只有 `.env.example` 模板，真实密钥不入 git）。
- **回滚**：`duel up` 幂等，配置恢复用 `git revert` / `.bak` 文件；容器级回滚改 `.env` 的 `SERVER_IMAGE` tag 后 `duel up`；`duel down` 只移除容器，PG 数据卷保留。