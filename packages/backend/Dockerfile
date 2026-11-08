# Backend image (API + workers in one process, ADR-016). Build from the repository root:
#   docker compose build backend
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/verifier/package.json packages/verifier/
COPY packages/backend/package.json packages/backend/
COPY packages/bench/package.json packages/bench/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --filter @onchain-posts/backend...
COPY packages/core packages/core
COPY packages/verifier packages/verifier
COPY packages/backend packages/backend
RUN pnpm --filter @onchain-posts/core build && pnpm --filter @onchain-posts/verifier build && pnpm --filter @onchain-posts/backend exec tsc -p tsconfig.json
RUN pnpm --filter @onchain-posts/backend deploy --prod --legacy /out

FROM node:24-slim
WORKDIR /app
COPY --from=build /out .
ENV NODE_ENV=production
# Mount point of the keystore volume, writable by the unprivileged user.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
