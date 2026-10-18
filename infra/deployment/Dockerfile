# Playtest / staging / production image: the realtime server with the web app (SERVE_WEB=1) and the
# admin console (SERVE_ADMIN=1) inside it. NODE_ENV defaults to development here; the production
# compose file (docker-compose.prod.yml) sets production, which makes the server refuse unsafe settings.
# The workspace packages are TypeScript sources and run through tsx, exactly as `pnpm start` does,
# so what runs here is what the tests ran. Not verified in the build sandbox (no Docker daemon);
# CI should build it before it is trusted. See docs/PLAYTEST.md.
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @quizparty/web run build && pnpm --filter @quizparty/admin run build

FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=development SERVE_WEB=1 HOST=0.0.0.0 PORT=8080
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate && apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "bash", "/app/infra/deployment/entrypoint.sh"]
