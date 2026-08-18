# Build e serve estático (SPA) com Caddy — Railway com Root Directory = apps/portal-cliente-web.
#
# ⚠ CÓPIA DELIBERADA do `apps/web/Dockerfile`, que já serve o portal do contador (`contador-front`).
# Os dois são o mesmo problema: Vite → `dist/` → Caddy na 8080. Divergir aqui faria dois serviços
# irmãos falharem por motivos diferentes.
#
# ⚠ Variáveis `VITE_*` são de BUILD, não de runtime: o Vite as embute no bundle. No painel da
# Railway elas precisam existir como variáveis do serviço (o Railway as passa como build args).
FROM node:20-alpine AS build

WORKDIR /app

# Não há package-lock.json nesta pasta (o lockfile fica na raiz do monorepo).
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
