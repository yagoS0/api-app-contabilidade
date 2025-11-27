enviar-guias
================

Automação para triagem de guias via Google Drive e envio por e-mail.

Sumário
- Visão geral
- Arquitetura
- Estrutura de pastas
- Configuração (.env)
- Como executar
- Endpoints HTTP
- Fluxos (Inbox e Envio de Guias)
- Permissões Google
- Troubleshooting

Visão geral
- Inbox: arquivos PDF são colocados em uma pasta do Google Drive (“caixa de entrada”). O sistema extrai dados (empresa, competência, etc.), garante que a pasta da empresa e da competência existam, e move o PDF para o destino correto.
- Envio de guias: para cada cliente e competência do mês anterior, envia e-mail com os PDFs daquela pasta. Marca arquivos no Drive para evitar reenvio.

Arquitetura
- src/server.js: servidor HTTP para acionar os fluxos manualmente e expor status.
- src/inbox.js: fluxo de triagem automática (lê Inbox, extrai campos, cria/move pastas/arquivos).
- src/main.js: fluxo de envio de guias (mês anterior), com anexos e marcação de processados.
- src/drive.js: cliente e helpers do Google Drive.
- src/sheets.js: leitura de clientes (nome e e-mail) de uma planilha.
- src/mailer.js: envio de e-mails via Gmail API (delegação) ou SMTP.
- src/ocr.js: extração de texto de PDFs com pdf-parse (sem OCR de imagem).
- src/extractor.js: heurísticas de parsing (CNPJ, competência, valor, vencimento).
- src/google_clients.js: inicialização unificada dos clientes Google.
- src/config.js: configuração e logs.

Estrutura de pastas
```
.
├─ docs/
│  ├─ env.example        # modelo de .env com variáveis necessárias
├─ scripts/              # scripts auxiliares (reservado)
├─ src/
│  ├─ config.js
│  ├─ drive.js
│  ├─ extractor.js
│  ├─ google_clients.js
│  ├─ inbox.js
│  ├─ mailer.js
│  ├─ main.js
│  ├─ ocr.js
│  ├─ server.js
│  ├─ sheets.js
│  └─ state.js
├─ package.json
└─ README.md
```

Configuração (.env)
1) Copie `docs/env.example` para `.env` na raiz e preencha:
- GOOGLE_APPLICATION_CREDENTIALS: caminho absoluto do JSON da Service Account.
- DRIVE_FOLDER_ID_CLIENTES: ID da pasta raiz “Clientes”.
- DRIVE_FOLDER_ID_INBOX: ID da pasta “caixa de entrada” no Drive.
- SHEET_ID: ID da planilha com (A=Cliente, B=Email).
- Opções de e-mail: USE_GMAIL_API/GMAIL_DELEGATED_USER ou SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM.
- Opcional: RUN_TOKEN para proteger endpoints; CRON_SCHEDULE; TARGET_MONTH; FORCE_SEND; LOG_LEVEL; TZ.

Como executar
Requisitos: Node 18+
- Instalar dependências:
  - npm install
- Executar o servidor HTTP (com UI simples):
  - npm run serve
  - Acesse http://localhost:3000 (botões “Enviar agora” e “Processar Inbox”)
- Executar somente o modo “send-only” (sem Inbox na UI):
  - npm run serve:send-only
  - Acesse http://localhost:3000 (apenas “Enviar agora”)
- Executar apenas o fluxo Inbox (CLI):
  - npm run inbox
- Executar envio de guias (CLI):
  - npm start

Endpoints HTTP
- GET /healthz: healthcheck.
- GET /status: status da última execução.
- POST /run: aciona o envio de guias.
- POST /run-inbox: aciona a triagem/movimentação da Inbox.
Headers: se RUN_TOKEN estiver definido, envie `x-run-token: <token>`.

Fluxos
Inbox (src/inbox.js)
1. Lista PDFs na pasta Inbox.
2. Para cada arquivo não triado (`appProperties.belgen_sorted != 1`):
   - Baixa o PDF e extrai texto com pdf-parse.
   - Extrai campos (empresa, competência, etc.).
   - Garante pasta do cliente e da competência (cria se necessário).
   - Move o arquivo para cliente/competência e marca `belgen_sorted=1`.

Envio de Guias (src/main.js)
1. Lê clientes (nome, e-mail) da planilha.
2. Para cada cliente, localiza a pasta do mês anterior (MM-AAAA).
3. Anexa todos os PDFs não marcados como processados e envia um único e-mail.
4. Marca os arquivos enviados no Drive via `appProperties.belgen_processed=1`.

Permissões Google
- Compartilhe as pastas (Clientes e Inbox) com a Service Account (ou adicione-a ao Drive compartilhado).
- Habilite as APIs necessárias (Drive, Sheets; Gmail se for usar API).

Deploy via GHCR
- Publicação automática ao criar tag v*: uma imagem Docker é enviada para `ghcr.io/<org>/<repo>:<tag>` e `:latest`.
- Como criar a primeira release (ex.: v0.1.0):
  1. git tag v0.1.0
  2. git push origin v0.1.0
- Rodando a imagem publicada:
  - docker run --rm -p 3000:3000 --env-file .env -v /abs/credenciais.json:/creds.json:ro -e GOOGLE_APPLICATION_CREDENTIALS=/creds.json ghcr.io/<org>/<repo>:v0.1.0

- Para Gmail Delegation (DWD), configure o escopo `https://www.googleapis.com/auth/gmail.send` e o usuário delegado.

Troubleshooting
- Falta de acesso/ID incorreto: verifique os logs do servidor e o ID das pastas/planilha.
- PDFs escaneados (imagem) não extraem texto: troque o extrator para um OCR (ex.: Google Vision). A arquitetura permite substituir `extractTextFromPdf` mantendo a interface.
- Não cria/move pastas: confirme permissões da Service Account na pasta/Drive.

