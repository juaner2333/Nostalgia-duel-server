<h1 align="center">🎮 Evolution Server</h1>
<p align="center">
  <strong>A Yu-Gi-Oh! game server built with TypeScript</strong><br>
  <em>Host duels for Koishi, YGO Mobile, and YGOPro clients.</em>
</p>

[![PR Pipeline](https://github.com/diangogav/EDOpro-server-ts/actions/workflows/pipeline.yaml/badge.svg)](https://github.com/diangogav/EDOpro-server-ts/actions/workflows/pipeline.yaml)

Evolution Server is a YGOPro-only game server: one engine, one protocol, every YGOPro-compatible client.

| Engine | Clients | Protocol | Port |
|--------|---------|----------|------|
| 📱 **YGOPro** | Koishi, YGO Mobile, YGOPro | YGOPro-compatible (srvpro2) | `7711` |

---

## ✨ What can it do?

- 🏰 **Room creation** through YGOPro-compatible clients
- 🔌 **Automatic reconnection** after disconnection or crash
- 📊 **Match data collection** for rankings and analytics
- 🧪 **Isolated duel cores** — each match runs in its own process

---

## 🚀 Quick Start (Docker)

The fastest way to get running. Three commands and you're dueling:

```bash
git clone https://github.com/diangogav/EDOpro-server-ts
cd EDOpro-server-ts
docker compose -f docker-compose.prod.yaml up -d
```

That's it! 🎉 The server starts automatically with PostgreSQL and Valkey included.

> 💡 Connect with Koishi or YGO Mobile on port `7711`.

---

## 🛠️ Manual Installation

For when you want full control, or Docker isn't an option.

### 📋 Prerequisites

- [Node.js](https://nodejs.org) >= 24
- [jq](https://jqlang.github.io/jq/) >= 1.6 — required by `scripts/clone_repositories.sh` and `scripts/setup_resources.sh` to read the resource manifest

On Ubuntu/Debian, the provided script installs everything you need:

```bash
sudo bash scripts/install_dependencies.sh
```

> 💡 To install `jq` manually: `sudo apt-get install -y jq` (Debian/Ubuntu) or `brew install jq` (macOS).

### 📦 Step by step

```bash
# 1️⃣ Clone the project
git clone https://github.com/diangogav/EDOpro-server-ts
cd EDOpro-server-ts

# 2️⃣ Clone card scripts, databases, and banlists
bash scripts/clone_repositories.sh

# 3️⃣ Organize everything into resources/
bash scripts/setup_resources.sh

# 4️⃣ Install Node.js dependencies
npm install

# 5️⃣ Configure environment
cp .env.example .env
```

> 📁 `scripts/setup_resources.sh` assembles each run into `resources/releases/<id>/` and points `resources/current` (a symlink) at it. Everything is read through `resources/current/…`, so refreshing resources is an atomic symlink swap — no restart needed. In Docker the container runs this refresh loop in the background (see `scripts/entrypoint.sh` + `scripts/resources-updater.sh`), so card/banlist updates are picked up live.

Now start the server 👇

---

### 📱 Running the YGOPro server

The YGOPro engine uses srvpro2-compatible protocol. Players connect using Koishi, YGO Mobile, or any YGOPro-compatible client.

**What you need:**
- ✅ Card scripts and databases from ygopro-scripts
- ✅ Ban lists and alternative format resources
- ✅ `resources.manifest.json` at repo root (already present — the server derives card paths from it automatically)

**Minimum `.env` configuration:**

```env
YGOPRO_PORT=7711
HTTP_PORT=7922
WEBSOCKET_PORT=4000
RESOURCES_DIR=./resources/current
```

**Resource structure used:**

```
📂 resources/current/ygopro/
├── 📜 base/                    # Core scripts + lflist + cards.cdb (loaded by all modes)
├── 🌏 formats/ocg/             # OCG-specific banlist
├── 🃏 formats/<name>/          # Format variants (Edison, HAT, JTP, MD, Tengu, World, Genesys, …)
├── 🆕 extensions/prereleases/  # Pre-release card databases + scripts (extra folder)
└── 🎨 extensions/custom-cards/  # Custom card art databases (extra folder)
```

**Standard card pool** (base + all served formats) is loaded for all rooms. **Extended pool** (standard + extension dirs) is only available in rooms that use PRE or ART formats. Standard rooms cannot use those cards.

Both pools are **derived automatically** from `resources.manifest.json` (`runtime.ygopro.standard` / `.extended`). No environment variable is needed or supported for pool membership — the manifest is the sole source.

```bash
npm run dev
```

> 🎯 Connect with Koishi or YGO Mobile to `your-server-ip:7711`

---

## 🗂️ Card Database Architecture

The YGOPro engine maintains **two separate card pools** in memory:

| Pool | Loaded from | Available to |
|------|-------------|--------------|
| **Standard** | `runtime.ygopro.standard` in `resources.manifest.json` | All rooms |
| **Extended** | standard + `runtime.ygopro.extended` in `resources.manifest.json` | PRE/ART rooms only |

When a player creates a room with a format like `PRE`, `TCGPRE`, `OCGPRE`, `TCGART`, or `OCGART`, the server uses the **extended** card pool for both deck validation and the duel engine. Standard rooms (`M`, `TCG`, `OT`, `GOAT`, etc.) use only the **standard** pool — any card not in that pool is rejected as unknown.

Both pools are loaded at startup and refreshed every 10 minutes if the underlying `.cdb` files change.

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `YGOPRO_PORT` | YGOPro server port | `7711` |
| `HTTP_PORT` | HTTP API port | `7922` |
| `WEBSOCKET_PORT` | WebSocket port | `4000` |
| `RESOURCES_DIR` | Root of the assembled resource tree (symlink target) | `./resources/current` |
| `MANIFEST_PATH` | Path to `resources.manifest.json` used for pool derivation | `./resources.manifest.json` |
| `RANK_ENABLED` | Enable ranking system (requires PostgreSQL) | `false` |
| `POSTGRES_HOST` | PostgreSQL host | `localhost` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_DB` | PostgreSQL database name | `evolution` |
| `POSTGRES_USER` | PostgreSQL username | `evolution` |
| `POSTGRES_PASSWORD` | PostgreSQL password | *(required if ranking enabled)* |
| `USE_REDIS` | Enable Redis/Valkey for session management | `false` |
| `REDIS_URI` | Redis/Valkey connection URI | *(required if redis enabled)* |

---

## 🔥 Pre-deploy Smoke Check (RFD-008)

Run this manually before deploying to production to confirm the derived pools match the expected baselines (network required):

```bash
# 1. Assemble resources (must be done at least once)
bash scripts/clone_repositories.sh && bash scripts/setup_resources.sh

# 2. Start the server (RESOURCES_DIR and MANIFEST_PATH use their defaults)
npm run dev
```

Watch the startup log for lines like:
```
Merged standard database from N databases with M cards
Merged extended database from N databases with M cards
Total LFLists loaded: K
```

These counts should match the pre-change production baseline. Any significant difference (e.g. M cards drops to 0) indicates a pool derivation or container manifest issue.

You can also inspect the derived paths at any time:

```bash
node -e "
const { resolvePools } = require('./dist/src/ygopro/ygopro/ResourcePoolResolver');
const { config } = require('./dist/src/config');
const pools = resolvePools({ manifestPath: config.resources.manifestPath, resourcesDir: config.resources.dir, env: process.env, logger: console });
console.log('standard paths:', pools.standard.length);
console.log('extended paths:', pools.extended.length);
pools.standard.forEach(p => console.log(' S', p));
pools.extended.slice(pools.standard.length).forEach(p => console.log(' E', p));
"
```

---

## 🏗️ Project Architecture

```
src/
├── 📱 ygopro/             # YGOPro engine (srvpro2-compatible)
├── 🤝 shared/             # Shared domain logic (rooms, decks, cards, clients)
├── 🔌 socket-server/      # YGOPro TCP socket server
├── 📡 web-socket-server/  # WebSocket server for real-time updates
├── 🌐 http-server/        # REST API
└── 🚀 bootstrap/          # Server startup wiring
```

Rooms, player handling, and the match lifecycle are shared domain logic; the YGOPro protocol stack owns its own clients, messages, and duel orchestration.

---

## 🙏 Acknowledgments

- [srvpro2](https://github.com/purerosefallen/srvpro) — the reference for the YGOPro engine
- The [Project Ignis](https://github.com/ProjectIgnis), [MyCard](https://mycard.moe/), and [Evolution](https://github.com/evolutionygo) communities

---

<p align="center">
  Made with ❤️ by the Evolution community
</p>
