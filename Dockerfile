# syntax=docker/dockerfile:1
FROM public.ecr.aws/docker/library/node:24.11.0-bullseye AS server-builder

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends jq && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /server

COPY package.json package-lock.json ./
RUN npm ci

# nostalgia-resources is reviewed application content. The assembly command reads
# only this local source and validates its lock before publishing resources/current.
COPY . .
RUN bash scripts/clone_repositories.sh && \
    bash scripts/setup_resources.sh && \
    npm run build && \
    npm prune --production

FROM public.ecr.aws/docker/library/node:24.11.0-slim

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=server-builder /server/dist ./
COPY --from=server-builder /server/package.json ./package.json
COPY --from=server-builder /server/node_modules ./node_modules
COPY --from=server-builder /server/resources.manifest.json ./resources.manifest.json
COPY --from=server-builder /server/config ./config
COPY --from=server-builder /server/resources ./resources
COPY --from=server-builder /server/scripts/entrypoint.sh ./scripts/entrypoint.sh

CMD ["dumb-init", "bash", "scripts/entrypoint.sh"]
