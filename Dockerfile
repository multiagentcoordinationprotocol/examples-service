FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts --omit=dev && npm cache clean --force

COPY --from=builder /app/dist dist/
COPY packs/ packs/

USER appuser
ENV NODE_ENV=production
ENV PORT=3000
ENV PACKS_DIR=/app/packs
EXPOSE 3000
CMD ["node", "dist/main.js"]
