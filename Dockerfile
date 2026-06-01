FROM node:20-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_SITE_URL

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN corepack enable \
  && corepack prepare pnpm@9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY apps/demo/package.json apps/demo/package.json
COPY packages/live2d-react/package.json packages/live2d-react/package.json

RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages

RUN pnpm build

FROM node:20-alpine AS runner

WORKDIR /app

ARG NEXT_PUBLIC_SITE_URL

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/demo/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/demo/node_modules ./apps/demo/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/demo/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/demo/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
