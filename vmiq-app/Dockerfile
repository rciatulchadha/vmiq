FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup -g 1001 -S vmiq && \
    adduser -u 1001 -S vmiq -G vmiq

COPY --from=builder --chown=vmiq:vmiq /app/.next/standalone ./
COPY --from=builder --chown=vmiq:vmiq /app/.next/static ./.next/static
COPY --from=builder --chown=vmiq:vmiq /app/public ./public

USER 1001
EXPOSE 3000
CMD ["node", "server.js"]
