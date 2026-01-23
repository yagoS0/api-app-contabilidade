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
   - `API_KEYS`: uma ou mais chaves separadas por vírgula (ex.: `minha-chave-ui,cli-interno`). Somente requisições que enviarem uma dessas chaves serão autorizadas (fallback para automações/homologação).
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` (opcional): usados pelo script `npm run prisma:seed` para garantir que exista um admin ativo.
   - `AUTH_USERS`: fallback legado em JSON (ex.: `[{"username":"admin","password":"trocar","role":"admin"}]`). Utilize apenas durante a migração; os usuários efetivos ficam na tabela `User`.
   - `JWT_SECRET`: segredo usado para assinar o token retornado por `/auth/login`. Opcionalmente ajuste `JWT_EXPIRES_IN` (padrão `1h`).
   - `DATABASE_URL`: string de conexão PostgreSQL (ex.: `postgresql://user:pass@host:5432/db`).
   - Opções de e-mail: `USE_GMAIL_API` + `GMAIL_DELEGATED_USER` **ou** SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
   - Opções extras: `CRON_SCHEDULE`, `TARGET_MONTH`, `FORCE_SEND`, `LOG_LEVEL`, `TZ`, `HOST`, `PORT`.
   - Em produção, mantenha `GOOGLE_APPLICATION_CREDENTIALS`, `API_KEYS` e `DATABASE_URL` em um Secrets Manager/App Runner Secret e apenas exporte as variáveis em runtime.

Banco de dados (PostgreSQL)
- Instale/Configure um PostgreSQL (local, RDS, Aurora, etc.).
- Crie o banco desejado e ajuste `DATABASE_URL`.
- Instale dependências e gere o cliente Prisma:
  ```bash
  npm install
  npx prisma migrate dev --name init-clientes
  npm run prisma:generate
  ```
- As tabelas `Client`, `Company` e `Partner` serão criadas conforme `prisma/schema.prisma`.
- Para o fluxo de usuários/admin execute a nova migração e popule o admin inicial:
  ```bash
  npx prisma migrate dev --name add-users
  npm run prisma:seed   # usa ADMIN_EMAIL/ADMIN_PASSWORD definidos no .env
  ```

Como executar
Requisitos: Node 18+
1. Instale dependências: `npm install`
2. Executar o servidor HTTP com UI básica:
   - `npm run serve`
   - Acesse http://localhost:3000 e utilize o botão “Enviar agora”.
3. Executar somente o fluxo de envio (CLI/headless):
   - `npm start`

Endpoints HTTP
- `POST /auth/signup`: recebe `name`, `email`, `password` e cria um usuário com `status=pending` (aguarda aprovação do admin).
- `POST /auth/login`: valida usuário/senha do banco (ou fallback `AUTH_USERS`) e retorna `{ token, expiresInMs, user }`.
- `GET /auth/me`: retorna o usuário logado (exige `Authorization: Bearer`).
- `GET /healthz`: healthcheck.
- `GET /status`: status do último envio + log básico (requer `Authorization: Bearer` ou `x-api-key`).
- `POST /run`: dispara o envio imediato (protegido por JWT ou API key).
- `POST /clients`: cadastra um cliente completo (dados pessoais, empresa e sócios).
- `GET /clients`: lista clientes com paginação simples (`?limit=20&offset=0`).
- `GET /clients/:id`: retorna o detalhe de um cliente específico.
- `POST /nfse/issue`: emite NFS-e padrão nacional (requere `NFSE_CERT_PFX_PATH`, `NFSE_CERT_PFX_PASSWORD`, `NFSE_BASE_URL` e dados de RPS/serviço no cadastro da empresa). Em caso de erro, devolve `status: "rejected"` com motivo. O recurso chamado é configurável via `NFSE_PATH` (padrão `/nfse/v1/rps`; ajuste conforme o provedor, ex.: `/nfse` no ambiente SEFIN).
- `GET /admin/users`: lista usuários filtrando por `status` (ex.: `/admin/users?status=pending`) — acesso somente para `role=admin`.
- `PATCH /admin/users/:id/approve`: aprova usuário pendente e, opcionalmente, define `role`.
- `PATCH /admin/users/:id/reject`: marca usuário como rejeitado.
- `DELETE /admin/users/:id`: exclui um usuário.

Fluxo sugerido:
```bash
# Login: retorna token JWT (1h por padrão)
curl -X POST https://seu-host/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"admin","password":"trocar"}'

# Chamada autenticada com Authorization: Bearer <token>
curl -X POST https://seu-host/run \
  -H "authorization: Bearer <token>"

# Listar usuários pendentes (somente admin)
curl https://seu-host/admin/users?status=pending \
  -H "authorization: Bearer <token-admin>"
```

> O cabeçalho `x-api-key` permanece válido como fallback para integrações legadas ou scripts internos.

### Fluxo de aprovação de usuários
1. O interessado chama `POST /auth/signup` e recebe `201 { status: "pending" }`.
2. A interface/admin consulta `GET /admin/users?status=pending`.
3. O admin aprova (`PATCH /admin/users/:id/approve`) ou rejeita (`PATCH /admin/users/:id/reject`).
4. Usuários aprovados podem efetuar login (`POST /auth/login`) e recuperar seus dados em `/auth/me`.
5. O admin pode remover acessos via `DELETE /admin/users/:id`.	

Payload para `POST /clients`:
```json
{
  "client": {
    "name": "Fulano de Tal",
    "email": "fulano@exemplo.com",
    "phone": "+55 11 99999-0000",
    "cpf": "123.456.789-00"
  },
  "company": {
    "razaoSocial": "Empresa XPTO LTDA",
    "cnpj": "12.345.678/0001-99",
    "nomeFantasia": "XPTO",
    "atividades": [
      { "codigo": "62.01-5-01", "descricao": "Desenvolvimento de software" }
    ],
    "porte": "ME",
    "tipoTributario": "Simples Nacional",
    "anexoSimples": "III",
    "endereco": "Rua A, 123, São Paulo/SP",
    "email": "contato@xpto.com",
    "telefone": "(11) 4000-1234",
    "capitalSocial": 150000,
    "dataAbertura": "2020-05-10",
    "quantidadeSocios": 2,
    "socios": [
      {
        "nome": "Sócio 1",
        "telefone": "(11) 99999-1111",
        "email": "socio1@xpto.com",
        "participacao": 60,
        "documento": "12345678900",
        "representante": true
      },
      {
        "nome": "Sócio 2",
        "participacao": 40
      }
    ]
  }
}
```

Permissões Google
- Compartilhe a pasta “Clientes” com a Service Account (ou adicione-a ao mesmo Drive compartilhado) e conceda acesso à planilha.
- Ative as APIs necessárias: Drive, Sheets (e Gmail se optar por `USE_GMAIL_API=1`).

Troubleshooting
- IDs incorretos ou falta de permissão: verifique se a Service Account recebeu “Editor” na pasta e na planilha.
- “invalid_grant / Invalid JWT Signature”: confira o JSON das credenciais (formatação da chave privada, caminho correto e serviço ativo).
- Nenhum PDF encontrado: confirme o nome da pasta `MM-AAAA` dentro do cliente ou use `TARGET_MONTH` para forçar uma competência específica.

