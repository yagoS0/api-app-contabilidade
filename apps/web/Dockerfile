# Build e serve estático (SPA) com Caddy — adequado à Railway com Root Directory = apps/web.
# Variáveis VITE_*: defina como Build Arguments / variáveis de build no painel da Railway.

FROM node:20-alpine AS build

WORKDIR /app

# Não há package-lock.json nesta pasta (lockfile fica na raiz do monorepo).
RUN apk add --no-cache libc6-compat

COPY package.json ./
RUN npm install

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_API_MODE
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_API_MODE=$VITE_API_MODE

RUN npm run build

FROM caddy:2-alpine

ENV PORT=8080

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /usr/share/caddy

EXPOSE 8080
