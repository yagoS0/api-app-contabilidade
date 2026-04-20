# CLAUDE.md — API (apps/api)

Backend Node.js 20 + Express.js + Prisma + PostgreSQL.

## Estrutura

```
src/
  application/       - Casos de uso / lógica de negócio (Services)
  infrastructure/    - Integrações externas (db, mail, storage, pdfReader)
  modules/           - Módulos de domínio (agrupam entidades)
  routes/            - Definição de rotas Express
    auth.js
    admin.js
    clients.js
    invoices.js
    firm/
      index.js
      accountingEntries.js
    ...
  middlewares/       - Auth, RBAC, error handling
  utils/             - Funções auxiliares
  workers/           - Jobs em background (ex: guideEmailWorker.js)
  server.js          - Entry point
config.js            - Variáveis de ambiente centralizadas
prisma/
  schema.prisma      - Schema do banco
  migrations/        - Migrations geradas pelo Prisma
  seed.js
```

## Padrões

### Rotas

- Cada grupo de rotas em arquivo separado dentro de `src/routes/`
- Rotas de escritório ficam em `src/routes/firm/`
- Sempre usar `requireAuth` + `requireRole` nos middlewares
- Retornar JSON limpo — sem expor stack traces em produção

```js
// Padrão de rota
router.get('/', requireAuth, requireRole(['FIRM_ADMIN']), async (req, res) => {
  try {
    const data = await SomeService.list(req.user);
    res.json(data);
  } catch (err) {
    next(err);
  }
});
```

### Services (Application Layer)

- Lógica de negócio fica nos Services, nunca nas rotas
- Services ficam em `src/application/`
- Services importam do `infrastructure/db` (Prisma client)

### Prisma / Banco

- Nunca rodar queries raw no Prisma sem necessidade
- Sempre filtrar por `firmId` ou `companyId` para garantir isolamento multi-tenant
- Migrations geradas com `prisma migrate dev --name <descricao>`
- Nunca editar arquivos de migration já aplicados

### Autenticação e RBAC

- JWT gerado e validado via `AuthService`
- Middleware `requireRole` recebe array de roles permitidas
- Roles: `FIRM_ADMIN`, `FIRM_ACCOUNTANT`, `FIRM_STAFF`, `CLIENT_OWNER`, `CLIENT_ADMIN`, `CLIENT_USER`
- Usuários novos precisam de aprovação do admin antes de acessar

### Workers

- Jobs de background ficam em `src/workers/`
- Executados internamente (sem fila externa por ora)
- Ex: `guideEmailWorker.js` envia guias em lote por email

### Infraestrutura

| Módulo           | Localização                        | Propósito                     |
|------------------|------------------------------------|-------------------------------|
| DB               | `infrastructure/db`                | Prisma client singleton       |
| Mail             | `infrastructure/mail`              | Gmail API / Nodemailer        |
| Storage          | `infrastructure/storage`           | Upload local / cloud          |
| PDF Reader       | `infrastructure/pdfReader`         | Chamadas ao serviço Python    |

## Variáveis de Ambiente Obrigatórias

```
DATABASE_URL
JWT_SECRET
GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET  (ou SMTP_*)
PDF_READER_URL   (URL do serviço FastAPI)
PORT             (default 3000)
```

## Regras

- Nunca hardcodar credenciais ou URLs — usar `config.js`
- Toda rota nova de firma deve ficar em `routes/firm/`
- Isolamento multi-tenant é inegociável: sempre filtrar por `firmId`/`companyId`
- Não adicionar `console.log` de debug em produção — usar o logger existente
- Migrations novas devem ter nome descritivo em inglês (snake_case)
