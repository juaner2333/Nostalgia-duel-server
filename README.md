# Nostalgia Duel Server

YGOPro-compatible duel server for exactly two fixed OCG environments:

| Join ID | Ban list | Card pool | Rules |
| --- | --- | --- | --- |
| `1103#<roomId>` | OCG 2011.03 | 5,002 cards | OCG, Master Rule 2, best-of-3 |
| `1109#<roomId>` | OCG 2011.09 | 5,120 cards | OCG, Master Rule 2, best-of-3 |

`roomId` is a decimal room identifier, not a password. `1103#1001` and
`1109#1001` are independent rooms.

## Run locally

Prerequisites: Node.js 24+.

```bash
npm ci
cp .env.example .env
npm run dev
```

The fixed 1103/1109 resources are bundled in `nostalgia-resources/` and
validated in full at startup. No resource cloning, download, assembly or
release step is required — a clean checkout starts directly after installing
dependencies and creating the environment file.

## Fixed resource layout

```text
nostalgia-resources/
├── lock.json
└── ygopro/
    ├── base/
    │   ├── cards.cdb                # the only CDB: 706, 5,120 cards
    │   └── script/
    └── formats/
        ├── 1103/{lflist.conf,script/}
        └── 1109/{lflist.conf,script/}
```

At runtime each duel receives only `[formats/<format>, base]` as its script
search chain. The format whitelist filters the one base CDB before deck validation
and stock WASM core startup. No extended pool, external script path, resource
refresh loop, Git clone, or HTTP resource fetch is used at runtime.

The `lock.json` records the base database, both format card pools, LFList and
script-tree summaries. The server, CI and the Docker build all run the same
full lock check; the process fails fast at startup when any resource is
missing, drifted or out of the fixed boundary.

## Resource review and maintenance

`formats/1103/lflist.conf` and `formats/1109/lflist.conf` are the sole source
of truth for each environment's card pool and ban list. Resources ship with
the application as one version; there is no independent resource release or
runtime refresh.

To change a card pool, ban list or script, edit the controlled files, then
explicitly regenerate the lock and review the difference:

```bash
npm run generate:nostalgia-lock
npm run check:nostalgia-resources
```

Only a new application version that passes the full check may deploy the
change. Rollback is performed by restoring the previous application image.

## Docker

```bash
docker compose -f docker-compose.prod.yaml up -d --build
```

The build validates the complete fixed resource root, then copies
`nostalgia-resources/` directly into the final image together with the code.
The container starts the Node.js service directly and never provisions,
refreshes or publishes resources at runtime.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `YGOPRO_PORT` | `706` | YGOPro TCP port |
| `HTTP_PORT` | `7922` | Management API port |
| `WEBSOCKET_PORT` | `4000` | Realtime API port |
| `RESOURCES_DIR` | `./nostalgia-resources` | Bundled fixed resource root |

Database, Redis, ranking, rate-limit, WindBot, and side-deck timeout settings
remain in [.env.example](.env.example).

## Verification

```bash
npm run check:nostalgia-resources
npm run lint
npm run test
npm run build
```

The resource version endpoint (`GET /api/resources/version`) reports the
in-app lock, base-card set, and both format card-pool/LFList summaries so a
deployment can verify the active release.
