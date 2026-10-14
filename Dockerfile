# Tanesco Leads – Container-Image (Node 22, pnpm). Startet Server + ausgelieferte Oberfläche auf $PORT.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
RUN mkdir -p /app/uploads
# Kein VOLUME-Befehl: Railway lehnt Dockerfiles mit VOLUME ab – dauerhafte Ablage dort über Settings → Volumes (Mount-Pfad /app/uploads).
EXPOSE 3000
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
