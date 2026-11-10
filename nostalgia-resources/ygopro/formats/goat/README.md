# GOAT 专用服务器

本分支默认启用 GOAT，玩家使用 `goat#1001` 这样的房号。开局采用大师规则 1（`0x00010000`）、8000 LP 和三局两胜。此模式下排位和 WindBot 关闭。

- `lflist.conf` 可保留两份历史禁限表。服务器选用 `!2005.4.1 W/O Exarion` 段。
- `cards.cdb` 放在此目录，内容应为经核对的 GOAT 专用卡库。服务器以卡库中的实卡为白名单，并应用所选禁限表。Exarion Universe 禁止入组，衍生物不进入白名单。
- 也可在所选禁限表段加入 `$whitelist` 和完整的卡号及限用数量。此时如未提供专用卡库，服务器从 `ygopro/base/cards.cdb` 读取白名单中的卡数据。
- `script/c<cardId>.lua` 用于历史卡片脚本覆盖。脚本优先读取本目录，随后读取基础脚本。
- `lock.json` 由资源锁生成命令写入此目录，绑定实际使用的 CDB、禁限表、卡池和 Lua。修改上述资源后应重新生成并核对。

```sh
npm run generate:nostalgia-lock
npm run check:nostalgia-resources
npm start
```

构建 GOAT Docker 镜像时使用 `docker build -t nostalgia-duel-server:goat .`。锁定的 WASM 已通过「加农炮兵」对「激流葬」的召唤优先权对照测试。卡片裁定取决于实际使用的 Lua。
