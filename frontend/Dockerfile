# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies first (layer-cached)
COPY package*.json ./
RUN npm ci

# Copy source and build.
# VITE_USE_REAL_API is baked into the bundle at build time — must be 'true'
# here so the app talks to the backend instead of the in-memory mock.
COPY . .
RUN VITE_USE_REAL_API=true npm run build

# ── Stage 2: serve ─────────────────────────────────────────────────────────────
FROM nginx:stable-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
