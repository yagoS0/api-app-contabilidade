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

## Módulo de Apuração Simples Nacional (Q14/Q15) — fluxo novo

> Princípio fundador: **a nota é SINAL, o cadastro é AUTORIDADE, o motor calcula,
> nada é chutado.** Item sem regra vira pendência (não vai pra anexo "provável").

**Camadas (em `application/notas/apuracao/v2/`):**
- `ClassificadorService.js` — classifica `NotaItem` → `TipoReceita` (regra EMPRESA →
  GLOBAL → capítulo LC116 → pendência). Sem match = `FilaPendencia(ITEM_SEM_REGRA)`.
- `AprendizadoService.js` — resolver pendência cria `RegraClassificacao` escopo EMPRESA.
- `AtividadeResolver.js` — converte receita classificada (tipoReceita+mercado) nas
  `atividades[]` do PGDAS-D (de-para via model `AtividadePgdasd`).
- `FechamentoService.js` — orquestra o modal: getDados / calcular / salvar / transmitir.
- `RbtExtratoService.js` — RBT12 (cache `RbtExtratoCache`; fonte SIMULACAO > local).
- `ApuracaoConfigMemoryService.js` — memória da última config por empresa (reaparece).
- `DisparidadeService.js` — avisa atividade↔CNAE (nunca bloqueia).
- `FatorRService.js`, `AliquotaResolver.js`, `MotorApuracaoService.js` — cálculo
  LOCAL (double-check; a verdade do DAS vem da RFB via simulação).

**SERPRO PGDAS-D (`application/fiscal/serpro/`):**
- `PgdasSimulacaoService.js` — monta o payload `TRANSDECLARACAO11` e chama:
  - `simular()` = `indicadorTransmissao:false` → cálculo oficial **sem transmitir**
    (é a verdade do botão [Calcular]). `transmitir()` = `true` → declara/gera DAS.
- idServicos em uso: `GERARDAS12`, `CONSDECLARACAO13`, `CONSULTIMADECREC14`,
  `TRANSDECLARACAO11`. Cliente HTTP: `SerproHttpClient` (baseUrl + cert + OAuth2
  vêm de `getResolvedSerproCredentials` — **uma só config**, prod por padrão).

**Regras CRÍTICAS do PGDAS-D (validadas contra a API real):**
- O contador escolhe **ATIVIDADE** (`idAtividade`), NÃO o anexo. A RFB decide
  anexo, faixa, III↔V do Fator-R, repartição e DAS. A gente só envia atividades.
- Mercado interno/externo é codificado no próprio `idAtividade` (ex: 1=interno,
  3=exterior) — NÃO há flag `tipoMercado` em `receitasAtividade`.
- `pa` é **Number** (AAAAMM). `receitaPaCaixa*`/`valorFixo*` = `null` quando não
  se aplica (valorFixo "deve ser > 0", senão null — não mandar 0).
- DAS = **soma de `valoresDevidos[]`** no retorno (não existe `valorTotalDevido`).
- Tabela `AtividadePgdasd`: **43 atividades oficiais**. Só as `verificadoTrial:true`
  foram exercidas contra a API; o resto vem da spec — confirmar antes de produção
  (`apps/api/scripts/mark-atividade-verificada.js <id>`).
- **Fila de transmissão** (`workers/apuracaoBatchWorker.js`, opt-in
  `APURACAO_BATCH_WORKER_ENABLED=1`): **consulta-antes-de-transmitir**
  (CONSDECLARACAO13) — PA já declarado NÃO é retransmitido (evita retificadora).

**Status (2026-06-09):** simulação validada em produção real (LENTE 2026-05 →
DAS R$ 26.670,52, `[Sucesso-PGDASD]`). Transmissão real (`true`) ainda não
exercida. Scripts úteis: `rodar-simulacao-pgdasd.js`, `gerar-payload-pgdasd.js`,
`gerar-curls-trial.js`, `test-fechamento-dados.js`.

## Variáveis de Ambiente Obrigatórias

```
DATABASE_URL
JWT_SECRET
GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET  (ou SMTP_*)
PDF_READER_URL   (URL do serviço FastAPI)
PORT             (default 3000)
```

Workers opt-in (default desligados): `GUIDE_EMAIL_WORKER_ENABLED`,
`SERPRO_PGDASD_WORKER_ENABLED`, `SERPRO_DCTFWEB_WORKER_ENABLED`,
`DFE_NOTAS_WORKER_ENABLED`, `APURACAO_BATCH_WORKER_ENABLED`.

## Regras

- Nunca hardcodar credenciais ou URLs — usar `config.js`
- Toda rota nova de firma deve ficar em `routes/firm/`
- Isolamento multi-tenant é inegociável: sempre filtrar por `firmId`/`companyId`
- Não adicionar `console.log` de debug em produção — usar o logger existente
- Migrations novas devem ter nome descritivo em inglês (snake_case)
