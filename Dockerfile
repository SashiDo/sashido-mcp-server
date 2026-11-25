# The stdio server in a container, for catalogs that build and run it
# themselves (Glama, Docker MCP Catalog). The hosted server and the npm
# package don't use this file.
#
#   docker build -t sashido-mcp .
#   docker run -i --rm -e SASHIDO_ACCESS_TOKEN=sashido_pat_... sashido-mcp
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/bin/mcp-server.js", "--transport=stdio"]
