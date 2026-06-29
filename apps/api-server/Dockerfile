# Builds the whole monorepo and runs apps/api-server.
#
# Single-stage, not a pruned multi-stage build: this monorepo's workspace
# packages are symlinked into node_modules by pnpm, and pruning that
# correctly (turbo prune / pnpm deploy) is real complexity worth adding
# only once image size or build time actually becomes a problem for a
# team with no dedicated infra hire (ADR 012's "optimize for maintenance
# cost" framing). This mirrors exactly what `pnpm install && pnpm run
# build && node apps/api-server/dist/index.js` does locally — same
# commands, same result, easy to reason about.
#
# Built from the repo root: docker build -f apps/api-server/Dockerfile .

FROM node:20.11.0-slim

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Copy lockfile and workspace manifests first so `pnpm install` is cached
# across builds where only application code changed, not dependencies.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/telemetry/package.json packages/telemetry/
COPY packages/auth-context/package.json packages/auth-context/
COPY packages/errors/package.json packages/errors/
COPY packages/events/package.json packages/events/
COPY services/identity-and-tenancy/package.json services/identity-and-tenancy/
COPY services/brain/package.json services/brain/
COPY services/ledger/package.json services/ledger/
COPY services/routing/package.json services/routing/
COPY services/agent-runtime/package.json services/agent-runtime/
COPY services/meeting/package.json services/meeting/
COPY services/performance/package.json services/performance/
COPY services/marketplace/package.json services/marketplace/
COPY services/marketplace-metering/package.json services/marketplace-metering/
COPY services/notification/package.json services/notification/
COPY services/admin-console-api/package.json services/admin-console-api/
COPY apps/api-server/package.json apps/api-server/

RUN pnpm install --frozen-lockfile

# Now the rest of the source.
COPY . .

RUN pnpm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/api-server/dist/index.js"]
