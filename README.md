enviar-guias
================

Automação para envio de guias fiscais via Google Drive + e-mail.

Sumário
- Visão geral
- Arquitetura
- Estrutura de pastas
- Configuração (.env)
- Como executar
- Endpoints HTTP
- Permissões Google
- Troubleshooting

Visão geral
- Para cada cliente listado na planilha (colunas A=Nome, B=Email), o sistema localiza a pasta da competência do mês anterior dentro de “Clientes/MM-AAAA”.
- Todos os PDFs dessa pasta que ainda não foram marcados como processados (`appProperties.belgen_processed` diferente de 1) são baixados, anexados em um único e-mail e enviados.
- Após o envio bem-sucedido cada arquivo recebe `belgen_processed=1`, evitando reenvio futuro. Há logs persistidos em `data/`.

Arquitetura
- `src/application/SendGuides.js`: orquestra o fluxo de envio.
- `src/server.js`: expõe endpoints HTTP + cron opcional para disparar `SendGuides`.
- `src/server-send-only.js`: UI simples com botão único “Enviar agora”.
- `src/infrastructure/drive/DriveService.js`: utilitários de Google Drive.
- `src/infrastructure/sheets/SheetService.js`: leitura da planilha de clientes.
- `src/infrastructure/mail/EmailService.js`: envio por Gmail API (delegação) ou SMTP.
- `src/infrastructure/status/RunLogStore.js`: persiste status/entregas em `data/`.
- `src/infrastructure/google/GoogleClients.js`: inicializa clientes Google (Drive/Sheets).
- `src/config.js`: centraliza variáveis de ambiente e logger.

Estrutura de pastas
```
.
├─ docs/
│  └─ env.example
├─ infra/
├─ scripts/
├─ src/
│  ├─ application/SendGuides.js
│  ├─ config.js
│  ├─ infrastructure/
│  │  ├─ drive/DriveService.js
│  │  ├─ google/GoogleClients.js
│  │  ├─ mail/EmailService.js
│  │  ├─ sheets/SheetService.js
│  │  └─ status/RunLogStore.js
│  ├─ server-send-only.js
│  └─ server.js
├─ package.json
└─ README.md
```

Configuração (.env)
1. Copie `docs/env.example` para `.env` na raiz e preencha:
   - `GOOGLE_APPLICATION_CREDENTIALS`: caminho absoluto do JSON da Service Account.
   - `DRIVE_FOLDER_ID_CLIENTES`: ID da pasta raiz “Clientes”.
   - `SHEET_ID`: ID da planilha (colunas A/B).
   - `API_KEYS`: uma ou mais chaves separadas por vírgula (ex.: `minha-chave-ui,cli-interno`). Somente requisições que enviarem uma dessas chaves serão autorizadas.
   - Opções de e-mail: `USE_GMAIL_API` + `GMAIL_DELEGATED_USER` **ou** SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
   - Opções extras: `CRON_SCHEDULE`, `TARGET_MONTH`, `FORCE_SEND`, `LOG_LEVEL`, `TZ`, `HOST`, `PORT`.
   - Em produção, mantenha `GOOGLE_APPLICATION_CREDENTIALS` e `API_KEYS` em um Secrets Manager/App Runner Secret e apenas exporte as variáveis em runtime.

Como executar
Requisitos: Node 18+
1. Instale dependências: `npm install`
2. Executar o servidor HTTP com UI básica:
   - `npm run serve`
   - Acesse http://localhost:3000 e utilize o botão “Enviar agora”.
3. Executar somente o fluxo de envio (CLI/headless):
   - `npm start`

Endpoints HTTP
- `GET /healthz`: healthcheck.
- `GET /status`: status do último envio + log básico.
- `POST /run`: dispara o envio imediato (requer `x-api-key` válido).

Exemplo de chamada autenticada:
```bash
curl -X POST https://seu-host/run \
  -H "x-api-key: minha-chave-ui"
```

Permissões Google
- Compartilhe a pasta “Clientes” com a Service Account (ou adicione-a ao mesmo Drive compartilhado) e conceda acesso à planilha.
- Ative as APIs necessárias: Drive, Sheets (e Gmail se optar por `USE_GMAIL_API=1`).

Troubleshooting
- IDs incorretos ou falta de permissão: verifique se a Service Account recebeu “Editor” na pasta e na planilha.
- “invalid_grant / Invalid JWT Signature”: confira o JSON das credenciais (formatação da chave privada, caminho correto e serviço ativo).
- Nenhum PDF encontrado: confirme o nome da pasta `MM-AAAA` dentro do cliente ou use `TARGET_MONTH` para forçar uma competência específica.

