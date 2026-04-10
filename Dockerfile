FROM node:20-alpine AS builder
WORKDIR /app
ARG NODE_AUTH_TOKEN
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 py3-pip \
  && addgroup -S appgroup \
  && adduser -S appuser -G appgroup

ARG NODE_AUTH_TOKEN
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --ignore-scripts --omit=dev && npm cache clean --force

COPY --from=builder /app/dist dist/
COPY packs/ packs/
COPY agents/ agents/

USER appuser
ENV NODE_ENV=production
ENV PORT=3000
ENV PACKS_DIR=/app/packs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3000/healthz', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/main.js"]
