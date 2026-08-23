#!/bin/bash
# Nostalgia-duel-server 快捷运维命令（云主机）
# 安装：sudo cp scripts/duel.sh /usr/local/bin/duel && sudo chmod 755 /usr/local/bin/duel
# 文档：docs/duel-command.md
set -e
COMPOSE="docker compose -f /opt/nostalgia-duel-server/docker-compose.cloud.yaml"
case "${1:-up}" in
  up)      sudo $COMPOSE up -d ;;
  restart) sudo $COMPOSE up -d --force-recreate ;;
  ps)      sudo $COMPOSE ps ;;
  logs)    sudo $COMPOSE logs -f --tail 100 ;;
  down)    sudo $COMPOSE down ;;
  rooms)   curl -s --noproxy "*" -m 5 http://127.0.0.1:7922/api/rooms | python3 -c "
import json, sys
rooms = json.load(sys.stdin)['rooms']
print(f'当前活动房间: {len(rooms)}')
for r in rooms:
    players = [p['name'] for p in r['players']]
    print(f\"  {r['formatId']}#{r['externalRoomId']}  [{r['status']}]  {len(players)}/{r['maxPlayers']}人  观众{r['spectators']}  {r['league']}  {r['banlist']}\")
    if players:
        print(f\"      玩家: {' / '.join(players) or '(空名)'}\")
" ;;
  help|-h) echo "用法: duel {up|restart|ps|logs|down|rooms|help}" ;;
  *) echo "未知命令: $1"; exit 1 ;;
esac