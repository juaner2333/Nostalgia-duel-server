# syntax=docker/dockerfile:1
FROM public.ecr.aws/docker/library/node:24.11.0-bullseye AS server-builder

WORKDIR /server

COPY package.json package-lock.json ./
RUN npm ci

# nostalgia-resources is reviewed application content shipped in the same
# image. The build runs the same full lock validation as CI and startup; a
# drifted or out-of-bounds resource tree fails before any artifact is produced.
COPY . .
RUN npm run build && \
    npm run check:nostalgia-resources && \
    npm prune --production

FROM public.ecr.aws/docker/library/node:24.11.0-slim

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=server-builder /server/dist ./
COPY --from=server-builder /server/package.json ./package.json
COPY --from=server-builder /server/node_modules ./node_modules
COPY --from=server-builder /server/config ./config
# The complete fixed resource tree travels with the code as one unit. There is
# no manifest, no assembled release directory and no entrypoint script: the
# container starts the Node.js service directly and never provisions resources.
COPY --from=server-builder /server/nostalgia-resources ./nostalgia-resources

CMD ["dumb-init", "node", "./src/index.js"]
