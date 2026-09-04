#!/bin/bash
# Nostalgia-duel-server 快捷运维命令（云主机，排位形态）
# 安装：sudo cp scripts/duel.sh /usr/local/bin/duel && sudo chmod 755 /usr/local/bin/duel
# 文档：docs/duel-command.md
set -e

COMPOSE="docker compose -f /opt/nostalgia-duel-server/docker-compose.cloud.ranked.yaml"
ENV_FILE="/opt/nostalgia-duel-server/.env"

# 从 .env 动态读取配置（root 0600，sudo 可读；管理员调用不打印密钥本身）
http_port="$(sudo grep ^HTTP_PORT "$ENV_FILE" | cut -d= -f2)"
[ -n "$http_port" ] || http_port=80
admin_key="$(sudo grep ^ADMIN_API_KEY "$ENV_FILE" | cut -d= -f2-)"

# 发送系统消息：POST /api/admin/message {message, reason}
# 消息会以 "[reason] message" 广播给所有在线房间的玩家与观战者。
system_message() {
	local msg="$1" reason="${2:-系统消息}"
	if [ -z "$msg" ]; then
		echo "用法: duel message <消息内容> [原因标签，默认 系统消息]"
		return 1
	fi
	curl -s --noproxy "*" -m 5 -X POST "http://127.0.0.1:${http_port}/api/admin/message" \
		-H "Content-Type: application/json" -H "admin-api-key: ${admin_key}" \
		-d "$(python3 -c 'import json, sys; print(json.dumps({"message": sys.argv[1], "reason": sys.argv[2]}))' "$msg" "$reason")" \
		| python3 -m json.tool
}

# 重置用户密码：POST /api/admin/users/reset-password {username}
# 成功返回随机新密码；用户不存在返回 404 {"success": false, "error": "User not found"}。
reset_password() {
	local username="$1"
	if [ -z "$username" ]; then
		echo "用法: duel reset <用户名>"
		return 1
	fi
	curl -s --noproxy "*" -m 5 -X POST "http://127.0.0.1:${http_port}/api/admin/users/reset-password" \
		-H "Content-Type: application/json" -H "admin-api-key: ${admin_key}" \
		-d "$(python3 -c 'import json, sys; print(json.dumps({"username": sys.argv[1]}))' "$username")" \
		| python3 -m json.tool
}

case "${1:-up}" in
	up)      sudo $COMPOSE up -d ;;
	restart) sudo $COMPOSE up -d --force-recreate ;;
	ps)      sudo $COMPOSE ps ;;
	logs)    sudo $COMPOSE logs -f --tail 100 ;;
	down)    sudo $COMPOSE down ;;
	rooms)   curl -s --noproxy "*" -m 5 "http://127.0.0.1:${http_port}/api/rooms" | python3 -c "
import json, sys
rooms = json.load(sys.stdin)['rooms']
print(f'当前活动房间: {len(rooms)}')
for r in rooms:
    players = [p['name'] for p in r['players']]
    print(f\"  {r['formatId']}#{r['externalRoomId']}  [{r['status']}]  {len(players)}/{r['maxPlayers']}人  观众{r['spectators']}  {r['league']}  {r['banlist']}\")
    if players:
        print(f\"      玩家: {' / '.join(players) or '(空名)'}\")
" ;;
	message) shift; system_message "$@" ;;
	reset)   shift; reset_password "$@" ;;
	help|-h) echo "用法: duel {up|restart|ps|logs|down|rooms|message|reset|help}" ;;
	*) echo "未知命令: $1"; exit 1 ;;
esac