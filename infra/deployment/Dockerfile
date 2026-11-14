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
# Build-time branding for the web app (Vite reads VITE_* while it builds). Hosting platforms pass the
# service's environment variables as build arguments; empty values mean the standard QuizNight look.
ARG VITE_DEFAULT_THEME=""
ARG VITE_VENUE_NAME=""
ARG VITE_VENUE_CREDIT=""
# "1" = phones also show the question text (default: off, the TV is the stage; players can toggle it).
ARG VITE_PHONE_SHOWS_QUESTION=""
ENV VITE_DEFAULT_THEME="$VITE_DEFAULT_THEME" VITE_VENUE_NAME="$VITE_VENUE_NAME" VITE_VENUE_CREDIT="$VITE_VENUE_CREDIT" VITE_PHONE_SHOWS_QUESTION="$VITE_PHONE_SHOWS_QUESTION"
RUN pnpm --filter @quizparty/web run build && pnpm --filter @quizparty/admin run build

FROM node:22-bookworm-slim
# COREPACK_HOME outside /root: the image runs as `node`, which would otherwise not find the pnpm that
# `corepack prepare` cached for root and download it again (from the npm registry) on every start.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=development SERVE_WEB=1 HOST=0.0.0.0 PORT=8080 COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate && chmod -R a+rX "$COREPACK_HOME" && apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "bash", "/app/infra/deployment/entrypoint.sh"]
