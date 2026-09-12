FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY lib/realtime ./lib/realtime
COPY lib/remote/action-definitions.ts ./lib/remote/action-definitions.ts
COPY relay/tsconfig.json ./relay/tsconfig.json
RUN npm run build:realtime && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV SENTINELGRID_REALTIME_BIND=0.0.0.0
ENV SENTINELGRID_REALTIME_PORT=8444
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/realtime ./dist/realtime
COPY --chown=node:node relay/realtime-relay.mjs relay/realtime-config.mjs ./relay/
USER node
EXPOSE 8444
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.SENTINELGRID_REALTIME_PORT||process.env.PORT||8444)+'/healthz',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "relay/realtime-relay.mjs"]
