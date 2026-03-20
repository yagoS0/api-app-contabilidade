FROM node:20-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --include=dev --workspace=@contabilidade/api

COPY python/parser/requirements.txt ./python/parser/requirements.txt
RUN pip3 install --no-cache-dir -r python/parser/requirements.txt

COPY apps/api ./apps/api
COPY python/parser ./python/parser
COPY docker/start-api-parser.sh ./docker/start-api-parser.sh

RUN chmod +x ./docker/start-api-parser.sh

ENV NODE_ENV=production
ENV GUIDE_PARSER_URL=http://127.0.0.1:8787
ENV PARSER_HOST=127.0.0.1
ENV PARSER_PORT=8787
ENV PARSER_LOG_RAW_TEXT=0

EXPOSE 3000

CMD ["./docker/start-api-parser.sh"]


