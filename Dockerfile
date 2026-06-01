FROM node:20-slim

# Prisma precisa de OpenSSL pra rodar migrate/schema engine
RUN apt-get update -y && \
    apt-get install -y openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --include=dev --workspace=@contabilidade/api

COPY apps/api ./apps/api

ENV NODE_ENV=production
# Defina em runtime na plataforma (rede interna até o serviço apps/pdf-reader):
# PDF_READER_URL=http://pdf-reader:8000

EXPOSE 3000

CMD ["npm", "run", "start:prod", "-w", "@contabilidade/api"]
