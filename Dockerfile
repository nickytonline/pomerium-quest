# syntax=docker/dockerfile:1
# The images: `--target app` (the game's production build), `--target app-dev` (`./quest dev`) and
# `--target mcp` (the owl's MCP server).
ARG NODE_IMAGE=node:26.13.1-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY mcp/package.json mcp/
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

# The owl's MCP server (mcp/). Node runs its TypeScript as it is, along with the two files of game
# constants it shares with the game.
FROM deps AS mcp
ENV NODE_ENV=production PORT=3000
COPY mcp mcp
COPY app/src/game/groups.ts app/src/game/owl.ts app/src/game/
USER node
EXPOSE 3000
CMD ["node", "mcp/src/index.ts"]
