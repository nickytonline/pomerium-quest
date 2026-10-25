# syntax=docker/dockerfile:1
# One Dockerfile, two images: `--target app` (the game) and `--target oracle` (the IdP).
ARG NODE_IMAGE=node:24.22.1-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY oracle/package.json oracle/
RUN npm ci --no-audit --no-fund

FROM deps AS app-build
COPY tsconfig.base.json ./
COPY app app
RUN npm run build -w app

FROM ${NODE_IMAGE} AS app
WORKDIR /srv
ENV NODE_ENV=production PORT=3000
COPY --from=app-build /repo/app/.output .output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

FROM ${NODE_IMAGE} AS oracle-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY oracle/package.json oracle/
RUN npm ci --omit=dev --workspace oracle --include-workspace-root=false --no-audit --no-fund

FROM ${NODE_IMAGE} AS oracle
WORKDIR /srv
ENV NODE_ENV=production PORT=4000
COPY --from=oracle-deps /repo/node_modules node_modules
COPY oracle/package.json ./
COPY oracle/src src
USER node
EXPOSE 4000
CMD ["node", "src/main.ts"]
