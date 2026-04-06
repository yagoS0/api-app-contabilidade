# Deploy Completo na DigitalOcean (App + Banco)

## 1) Arquitetura recomendada
- **App Platform** para a API Node (`apps/api`), com imagem Docker.
- **Managed PostgreSQL** para banco de dados.
- **pdf-reader** (FastAPI em `apps/pdf-reader`) como serviço separado, acessível pela API (URL interna ou HTTPS conforme a rede).
- **DO Container Registry (DOCR)** para armazenar imagem da API.

## 2) Pré-requisitos
- Conta DigitalOcean com permissões de:
  - App Platform
  - Managed Databases
  - Container Registry
- Repositório no GitHub com os secrets:
  - `DO_API_TOKEN`
  - `DO_APP_ID`
  - `DO_REGISTRY_NAME`
  - `DATABASE_URL` (opcional para gate de migration no workflow)

## 3) Provisionar banco PostgreSQL (Managed DB)
1. Criar cluster PostgreSQL na DigitalOcean (versão compatível com Prisma/PostgreSQL).
2. Criar database de aplicação (ex.: `contabilidade`).
3. Criar usuário de aplicação com senha forte.
4. Ativar TLS e permitir acesso apenas da App Platform (Trusted Sources).
5. Copiar connection string para `DATABASE_URL`.

## 4) Secrets e variáveis de runtime (API)
Configure na App Platform:
- Obrigatórios:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `API_KEYS`
  - `PDF_READER_URL` (pdf-reader; health em `GET /health`; guias gravam PDF no Postgres após upload)
  - `GOOGLE_APPLICATION_CREDENTIALS_JSON` (JSON da service account em formato string)
- E-mail:
  - `USE_GMAIL_API`, `GMAIL_DELEGATED_USER`, `SMTP_FROM`
  - ou SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`)
- Opcional:
  - `TZ=America/Sao_Paulo`
  - `LOG_LEVEL=info`

## 5) Build e deploy contínuo
- Workflow CI: `.github/workflows/ci.yml`
  - valida schema Prisma
  - gera client Prisma
  - valida sintaxe de arquivos críticos
  - build de workspaces
- Workflow CD: `.github/workflows/deploy-digitalocean.yml`
  - build e push da imagem para DOCR (`latest` + `sha`)
  - gate de migration status (se `DATABASE_URL` estiver no secret)
  - update da App na DigitalOcean via `doctl apps update`

## 6) Ordem correta de subida
1. Subir/validar Managed PostgreSQL.
2. Configurar secrets da App Platform.
3. Subir o serviço pdf-reader e validar `GET /health` (resposta `{"status":"ok"}`).
4. Deploy API.
5. Verificar readiness:
   - `GET /healthz` (liveness)
   - `GET /readyz` (banco + pdf-reader quando `PDF_READER_URL` está definido)
6. Garantir `PDF_READER_URL` na API; envio agendado de guias (se usado) via `POST /firm/guides/emails/run-scheduled` ou agenda por empresa (`email-schedule`), sem cron no processo da API.

## 7) Migração de banco em produção
- A API está configurada para executar:
  - `prisma generate`
  - `prisma migrate deploy`
  - antes de iniciar o servidor (`npm run start:prod`)
- Antes de cada release:
  - rode `npm run prisma:migrate:status -w @contabilidade/api` em staging
  - valide backup recente do banco

## 8) Checklist pós-deploy
- Auth:
  - `POST /auth/login` retorna token
  - `GET /auth/me` com token funciona
- Saúde:
  - `GET /healthz` -> 200
  - `GET /readyz` -> 200
- Permissões:
  - usuário sem vínculo não acessa dados de outra empresa (`403`)
- Guias:
  - `GET /firm/guides/settings`
  - `POST /firm/guides/upload` (multipart `files`)
  - `POST /firm/guides/emails/send-pending`
  - validar que o e-mail de `send-pending` chega com **PDF em anexo** (não apenas link)

## 9) Monitoramento e alertas
- Alertar em:
  - taxa elevada de 5xx
  - `readyz` instável
  - erros de lock (`lock_active` excessivo)
  - falhas de e-mail (`guide_email_send_failed`)
- Logs essenciais:
  - inicialização do scheduler
  - resultado de upload/parse de guias
  - resultado de envio de e-mails

## 10) Rollback
1. Reverter App para release anterior no App Platform.
2. Se migration quebrar compatibilidade, restaurar backup do banco.
3. Validar `readyz` e rotas críticas.
4. Reprocessar pendências de guias/e-mails se necessário.

