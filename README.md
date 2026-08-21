# Nostalgia Duel Server

YGOPro-compatible duel server for exactly two fixed OCG environments:

| Join ID | Ban list | Card pool | Rules |
| --- | --- | --- | --- |
| `1103#<roomId>` | OCG 2011.03 | 5,002 cards | OCG, Master Rule 2, best-of-3 |
| `1109#<roomId>` | OCG 2011.09 | 5,120 cards | OCG, Master Rule 2, best-of-3 |

`roomId` is a decimal room identifier, not a password. `1103#1001` and
`1109#1001` are independent rooms.

## Run locally

Prerequisites: Node.js 24+ and `jq`.

```bash
npm ci
bash scripts/clone_repositories.sh
bash scripts/setup_resources.sh
cp .env.example .env
npm run dev
```

The two shell commands do not clone or download game resources: they validate and
assemble the checked-in `nostalgia-resources/` directory into `resources/current`.
The application still needs normal Node dependency installation; that is outside
the resource-offline guarantee.

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

## Resource review and maintenance

`formats/1103/lflist.conf` and `formats/1109/lflist.conf` are the sole source
of truth for each environment's card pool and ban list. Edit the corresponding
file directly, then validate it and refresh the reviewed lock:

```bash
npm run check:nostalgia-resources
npm run generate:nostalgia-lock
bash scripts/clone_repositories.sh
bash scripts/setup_resources.sh
```

`setup_resources.sh` validates the candidate lock before atomically changing
`resources/current`; a bad candidate leaves the active release unchanged.

## Docker

```bash
docker compose -f docker-compose.prod.yaml up -d --build
```

The image assembles the local fixed resources during its build. Its entrypoint
starts the server directly and never performs resource provisioning at runtime.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `YGOPRO_PORT` | `7711` | YGOPro TCP port |
| `HTTP_PORT` | `7922` | Management API port |
| `WEBSOCKET_PORT` | `4000` | Realtime API port |
| `RESOURCES_DIR` | `./resources/current` | Assembled fixed resource release |
| `MANIFEST_PATH` | `./resources.manifest.json` | Fixed local resource manifest |

Database, Redis, ranking, rate-limit, WindBot, and side-deck timeout settings
remain in [.env.example](.env.example).

## Verification

```bash
npm run check:nostalgia-resources
npm run generate:nostalgia-lock
npm run lint
npm run test
npm run build
```

The resource version endpoint reports the fixed lock, base-card set, and both
format card-pool/LFList summaries so a deployment can verify the active release.
