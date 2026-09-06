# Tabeeb runs as a long-lived container, not on a serverless platform.
#
# Two reasons it cannot be serverless. Document processing — vision OCR of every
# page, entity extraction, embedding, and a summary — runs past the response via
# `after()` and takes minutes; serverless freezes the instance once the response is
# sent. And `sharp` is a native addon that needs a real filesystem and matching libc.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` installs exactly the lockfile, which is what makes a build reproducible.
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next inlines NEXT_PUBLIC_* at build time, so Clerk's key must be present now, not
# only at runtime. It is a publishable key — safe to bake in.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Placeholders only: these are read at request time, never during the build, but the
# config validator runs at import and would otherwise fail the build.
ENV CLERK_SECRET_KEY=sk_build_placeholder \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    GROQ_API_KEY=build_placeholder \
    PINECONE_API_KEY=build_placeholder \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Not root: a container that processes uploaded files should not run privileged.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# The standalone output carries its own minimal node_modules.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations and the runner, so `npm run db:migrate` works against production.
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres

USER nextjs
EXPOSE 3000

# server.js is what `output: "standalone"` emits — not `next start`.
CMD ["node", "server.js"]
