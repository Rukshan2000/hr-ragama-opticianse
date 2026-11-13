# syntax=docker/dockerfile:1

# ---- build: compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ---- prod-deps: runtime dependencies only ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 5000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+(process.env.API_PREFIX||'/api/v1')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# exec form: node is PID 1's child under `init: true` and receives SIGTERM directly.
CMD ["node", "dist/src/server.js"]
