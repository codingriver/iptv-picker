# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node config ./config
COPY --chown=node:node data ./data
COPY docker-entrypoint.sh /usr/local/bin/iptv-picker-entrypoint

RUN chmod +x /usr/local/bin/iptv-picker-entrypoint \
  && mkdir -p res publish \
  && chown -R node:node /app

USER node

ENTRYPOINT ["tini", "--", "iptv-picker-entrypoint"]
CMD ["--help"]
