FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY package*.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/data/dockside.sqlite WEB_DIST=/app/web
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /build/apps/api/dist/server.mjs ./server.mjs
COPY --from=build --chown=node:node /build/apps/web/dist ./web
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
