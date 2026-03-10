FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --workspace=@contabilidade/api

COPY apps/api ./apps/api

WORKDIR /app/apps/api

EXPOSE 3000
CMD ["npm", "run", "start:prod"]


