# Build stage: install all deps and compile TypeScript
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ src/
RUN npm run build

# Runtime stage: only production deps + compiled output
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "dist/server.js"]
