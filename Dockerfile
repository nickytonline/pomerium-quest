# syntax=docker/dockerfile:1
# The game's images: `--target app` (production build) and `--target app-dev` (`./quest dev`).
ARG NODE_IMAGE=node:24.22.1-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/
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

# `./quest dev`: the Vite dev server in the cluster. app/src and app/public are mounted over the
# copies here, so edits on the host hot-reload behind the real Pomerium.
FROM deps AS app-dev
COPY tsconfig.base.json ./
COPY app app
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "dev", "-w", "app", "--", "--host", "0.0.0.0"]
