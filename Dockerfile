FROM node:20-slim

# Prisma precisa de OpenSSL pra rodar migrate/schema engine
RUN apt-get update -y && \
    apt-get install -y openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ⚠⚠ `packages/shared` PRECISA ENTRAR NA IMAGEM — e a ausência dele seria SILENCIOSA no CI.
#
# Desde 20/08/2026 o `apps/api` importa `@contabilidade/shared/municipios-ibge` (a lista oficial do
# IBGE, que era cópia nos dois portais e virou arquivo único). Em desenvolvimento isso resolve pelo
# symlink de workspace na raiz, então `npm test` e `npm run build` passam VERDES sem esta linha.
# Dentro do container não há symlink nenhum: sem copiar o pacote, o import estoura
# ERR_MODULE_NOT_FOUND **em runtime** — ou seja, no momento em que o contador rodasse o primeiro
# lote, e não no deploy.
#
# ⚠ O `package.json` do pacote vem ANTES do `npm ci`: é ele que permite ao npm criar o link do
# workspace. Copiar só o código depois não cria link nenhum.
COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --include=dev --workspace=@contabilidade/api

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

ENV NODE_ENV=production
# Defina em runtime na plataforma (rede interna até o serviço apps/pdf-reader):
# PDF_READER_URL=http://pdf-reader:8000

EXPOSE 3000

CMD ["npm", "run", "start:prod", "-w", "@contabilidade/api"]
