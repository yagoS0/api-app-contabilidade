# Build e serve estatico (SPA) com Caddy.
#
# ⚠⚠ O CONTEXTO DE BUILD E A RAIZ DO MONOREPO, e isso NAO e preferencia: em 20/08/2026 a tabela do
# IBGE saiu das copias por app e virou `@contabilidade/shared/municipios-ibge`. Um Dockerfile cujo
# contexto e a pasta do app NAO ALCANCA `packages/` -- e o build morreu em producao com
# "Rollup failed to resolve import", DEPOIS de os testes e o build local passarem verdes.
#
# ⚠ Portanto: `Root Directory` DESTE SERVICO tem de ser a RAIZ do repositorio, e o `dockerfilePath`
# do railway.toml aponta para este arquivo. Voltar o Root Directory para a pasta do app quebra o
# build de novo, com a mesma mensagem.
#
# ⚠ E as VITE_* sao BUILD ARGS -- entram no bundle em tempo de build, nao em tempo de execucao.

FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat

# O lockfile da raiz e o que torna `npm ci` possivel -- a pasta do app nao tem um.
COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --include=dev --workspace=@contabilidade/web

# ⚠ `packages/shared` ANTES do app: e dele que sai a lista de municipios que o build resolve.
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

ARG VITE_API_BASE_URL
ARG VITE_API_MODE
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_API_MODE=$VITE_API_MODE

RUN npm run build --workspace=@contabilidade/web

FROM caddy:2-alpine
ENV PORT=8080
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /usr/share/caddy
EXPOSE 8080
