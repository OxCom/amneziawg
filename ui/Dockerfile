# Build stage
FROM node:22-alpine AS build
WORKDIR /app

# If you use package-lock.json, copy it too
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci

COPY ui/ ./
RUN npm run build

# Runtime stage
FROM nginx:stable-alpine
# Serve static SPA from /usr/share/nginx/html
COPY --from=build /app/dist /usr/share/nginx/html

# Minimal nginx config for SPA (no TLS here; TLS is in your separate proxy/app container)
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
