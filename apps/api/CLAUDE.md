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

- Jobs de background ficam em `src/workers/` — ver `src/workers/CLAUDE.md`.
- Executados internamente (sem fila externa por ora)
- Ex: `guideEmailWorker.js` envia guias em lote por email
- **Q17:** `serproPgdasdWorker` também busca o **extrato** (`syncPgdasByCompetencia`), que
  gera os lançamentos — não só as guias. Agendamento vem de `SerproRuntimeSettings`
  (página do SERPRO), não fixo.

> **Blocos com `CLAUDE.md` próprio** (ler antes de mexer; atualizar ao terminar):
> `src/workers/`, `src/application/accounting/`, `src/application/guides/`.
> **Fechamento contábil do mês (Q17)** ≠ `estado` da apuração: campos
> `CompanyMonthlyCircular.fechadoContabilEm/Por`; endpoints `.../fechamento-contabil/...`;
> gate por lançamento (em branco / D≠C). Guia `status="VAZIO"` = ausência confirmada (amarelo).

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

## Situação Fiscal (SITFIS) + Confirmação de pagamento (Q40/Q41/Q43)

**SITFIS — situação fiscal do contribuinte** (`application/fiscal/serpro/SerproSitfisService.js`).
Serviço assíncrono em 2 etapas, resolvido inline (~28s) ou devolvido como `processando`:
- `/Apoiar` (`SOLICITARPROTOCOLO91`, versão **2.0**) → protocolo. Cache do dia: se já existe,
  responde **304** com o protocolo no header **ETag** (corpo vazio). Se o limite da conta foi
  atingido, responde **200 sem protocolo** com aviso **`[Aviso-Sitfis-AV02]`** + `tempoEspera`
  → tratamos como **"processando"** (não erro), com mensagem pedindo aguardar ~Xs.
- `/Emitir` (`RELATORIOSITFIS92`) → PDF em `dados.pdf` (base64). Status: 200 pronto · 202/204
  processando (aguarda `tempoEspera`) · 304 reusar protocolo.
- **Protocolo do dia é salvo** em `CompanyFiscalStatus.protocolo` e **reusado** (pula o `/Apoiar`,
  que é o que abre "slot" e dispara o AV02 — limite é **por contratante**, não por empresa).
  Reuso só no mesmo dia (America/Sao_Paulo); expirado → re-solicita.
- **Situação** derivada por palavra-chave sobre o **texto extraído do PDF** (`pdf-parse`):
  `devedor|dívida ativa|débito|pendência|…` → `COM_PENDENCIA`; com guard removendo frases de
  negação ("não há débitos") pra evitar falso-positivo. Best-effort, `verificadoTrial:false`.
- Rota `POST /firm/companies/:id/serpro/sitfis/relatorio` grava `CompanyFiscalStatus`
  (situacao/protocolo/texto/relatorioPdfFileId); numa reconsulta ainda "processando",
  **preserva** o último relatório/situação (não zera). PDF servido inline em
  `GET .../serpro/sitfis/pdf`. Página **Pendências** = `GET /firm/pendencias/fiscal`.
- Flag: **`INTEGRACAO_SERPRO_SITFIS`**. Status (2026-07): fluxo validado end-to-end em produção
  (Apoiar 304/ETag → Emitir 200 → PDF exibido/baixável); heurística ligada.

**PAGTOWEB — confirmação de pagamento por comprovante**
(`SerproPagtoWebService.js` + `SerproPaymentConfirmationService.js`, worker próprio).
- idServiço `COMPARRECADACAO72` via `/Emitir`; comprovante (PDF) = pago.
- **Validado em produção real (2026-07-28).** O payload é `{"numeroDocumento":"<só dígitos>"}`:
  com máscara → **HTTP 500** (`Erro-PAGTOWEB-00099`); com o nome `numeroDocumentoArrecadacao` →
  **HTTP 400**. A resposta traz **só `dados.pdf`** — não há data nem valor estruturados, então o
  rateio principal/juros/multa sai do **texto do PDF** (`parseComprovanteArrecadacao.js`, que só
  devolve o rateio se `principal+juros+multa == total`).
- ⚠ **A ordem das colunas de acréscimo é `principal · MULTA · JUROS · total`** — o inverso do
  cabeçalho impresso ("Total Juros Multa Principal"). A autoverificação da soma **não** pega uma
  troca entre juros e multa (a soma é a mesma), então a ordem está fixada por evidência: no
  comprovante real de INSS, 12,94/178,31 = 7,26% = 0,33%/dia × 22 dias (multa de mora) e
  1,78/178,31 = 1,00% (juros do mês do pagamento). Importa porque juros e multa viram lançamentos
  separados, em contas diferentes (501 e 506).
- ⚠ **O número do documento é a entrada de tudo.** Ele vive em
  `dados.detalhamentoDas.numeroDocumento` (DAS) — e `dados` vem ora objeto, ora array de 1 item.
  O extrator antigo varria o payload inteiro e pegava `contratante.numero`, o CNPJ do **escritório**
  ecoado na resposta: toda guia de DAS ficou com um número inexistente e a busca nunca achava nada.
  Hoje `extractDocumentNumber` tenta o **nome exato dentro de `dados`** antes da varredura ampla e,
  não achando, devolve `null` — nunca o CNPJ. Guias antigas se corrigem sem gastar chamada com
  `scripts/corrigir-numero-documento.mjs` (reextrai do `rawPayload` salvo); sem `rawPayload`, só
  recapturando. Diagnóstico: `scripts/diag-numero-documento.mjs`.
- A busca **só marca** a guia como paga (`pagamentoLocalizado`); quem faz o lançamento de baixa é o
  contador, pela Circular — ver "Guias na Circular".

## Robustez NFS-e/ADN — ledger append-only (Fase 1)

Roadmap completo em **`docs/robustez-nfse-adn.md`** (raiz do repo). Captura deve virar *fluxo de
eventos por NSU*, não *snapshot por data*. Fase 1 (fundação) já no código, **ainda NÃO ligada à captura**:
- Modelos `documentos`/`eventos` (imutáveis), `nsu_watermark`, `nsu_gaps` — migration `20260717120000_add_notas_ledger`.
- Primitivas em `src/application/notas/ledger/`: `LedgerService` (append idempotente + watermark atômico),
  `LedgerProjectionService` (`computeSituacao` — status é **projeção recalculável**, nunca coluna gravada),
  `NsuGapService` (detecta/resolve lacunas de NSU).
- **Nunca** dar UPDATE em `documentos`/`eventos` (correção = novo registro). A captura atual (`PortalInvoice`)
  segue intacta. Fase 0 (forense 28 vs 27) depende de dados de produção — pendente do dono.
- **Camada 2 (conferência ADN):** `ConferenciaAdnService` compara o conjunto de chaves que temos
  (EMIT/autorizada da competência = mesma população do faturamento) com o **conjunto autoritativo do ADN**
  (scan read-only por NSU, reusa `fetchDfeNFSe` sem mover cursor). Divergência → grava
  `ApuracaoSnapshot.conferenciaStatus="divergente"` e **`salvarFechamento` TRAVA** (`DIVERGENCIA_CONFERENCIA`).
  Município fora do ADN / sem cert = `nao_conferivel` (não trava). Sob demanda:
  `POST /firm/companies/:id/fechamento/:competencia/conferencia`; ferramenta de prod: `scripts/conferir-adn.mjs`.
  O scan do ADN só é validável em produção (cert + ADN reais).

## ⚠ Armazenamento de PDFs — exige Volume no Railway

Provider default = **LOCAL** (`GUIDE_LOCAL_STORAGE_DIR`, default `./storage/guides` → `/app/storage/guides`).
O filesystem do container no Railway é **efêmero**: sem um Volume montado, **todo deploy apaga os
PDFs** (guias capturadas e relatórios SITFIS). O sintoma é o registro existir no banco
(`relatorioPdfFileId` / guia) mas o arquivo dar **ENOENT** na leitura.

⚠ **O caminho default é RELATIVO e o processo NÃO roda em `/app`.** O start é
`npm run start:prod -w @contabilidade/api`, e o npm executa o script com o CWD do **workspace** →
`./storage/guides` resolve para **`/app/apps/api/storage/guides`**. Um volume montado em
`/app/storage` **não captura nada** (erro cometido na 1ª configuração — o PDF continuava sumindo
mesmo com o volume criado).

**Config correta em produção — escolha uma:**
- **(recomendado)** Volume em `/app/storage` + env **`GUIDE_LOCAL_STORAGE_DIR=/app/storage/guides`**
  (absoluto, imune a mudança de CWD);
- ou Volume montado direto em `/app/apps/api/storage` (aí o default relativo funciona).

Alternativa sem volume: `GUIDE_STORAGE_PROVIDER=S3|R2` + bucket/credenciais (`GUIDE_STORAGE_*`).
O código já suporta os três providers (`GuideStorageService`).

Pra conferir onde está gravando de fato, o erro de leitura mostra o caminho absoluto
(`scripts/dump-sitfis-texto.mjs` imprime o ENOENT com o path completo).

A UI trata o arquivo ausente sem quebrar: a aba Situação Fiscal mostra "o arquivo não está mais no
armazenamento" e mantém situação/data (que vivem no banco).

## Situação Fiscal — trava de 4h (C11)

Abrir a aba **não** consulta o SERPRO: mostra o `CompanyFiscalStatus` salvo + o PDF gravado.
A consulta só acontece pelo **botão**, e `POST .../sitfis/relatorio` aplica uma janela mínima de
**4h por empresa** (`SITFIS_MIN_INTERVALO_MS`), respondendo `throttled:true` com o relatório salvo.
Motivo: a consulta é paga e o limite AV02 do `/Apoiar` é **por contratante** — consulta à toa de uma
empresa prejudica todas. `GET .../sitfis` devolve `podeConsultar` + `proximaConsultaEm` pra UI
desabilitar o botão. **A trava só vale quando já existe relatório salvo**: se a última tentativa
parou em "processando" (sem PDF), o contador pode tentar de novo — senão ficaria 4h sem situação
nenhuma. `?force=1` quebra a trava manualmente (não usado pela UI).

## Apuração — transmitir já traz extrato + guia (C12)

`transmitirFechamento` chama `sincronizarExtratoEGuia()` em **toda** transmissão (antes só na
retificação) e também nos **dois caminhos de "PA já declarado"** — que era justamente onde o
contador precisava rodar a busca na mão. Retorno: `posTransmissao { extrato, guia }`.
**Best-effort por definição:** quando o código chega ali a declaração JÁ foi transmitida, então
falha de rede/SERPRO não pode desfazer nada — volta como `skipped` no payload. Só a **retificação**
zera os flags de e-mail da guia DAS (`liberarReenvio`); numa transmissão normal a guia já nasce
`PENDING`.

## Guias na Circular — quem alimenta cada linha

- **DARF / PIS / COFINS / IRPJ / CSLL / ISS:** viram `AccountingEntry` PROVISAO de verdade, via
  `generateProvisionsFromGuide` no hook de `GuideService` (toda guia que vira PROCESSED, **inclusive
  upload**). Aparecem naturalmente na query `provisoes`.
- **INSS e SIMPLES/DAS:** `generateProvisionsFromGuide` **pula** os dois de propósito (INSS é manual;
  DAS vem do extrato PGDAS). A Circular os monta como **provisões sintéticas** no endpoint
  `GET /entries/circular` — não existem no banco.
  - INSS: sintética a partir da guia (`inssSynthetic`). Lê `guide.paymentStatus` direto, então o ✓
    do INSS **não** depende de `AccountingEntry.statusPagamento`.
  - DAS: normalmente vem do extrato; `dasSynthetic` só entra nos meses **sem** provisão de DAS
    (caso da guia subida à mão numa empresa sem extrato PGDAS).
  - Nos dois, havendo guia SERPRO **e** upload no mesmo mês, a do **SERPRO vence** (autoritativa) —
    senão a linha apareceria duplicada.

## Endpoints agregados do dashboard (Lote C)

- `GET /firm/companies/annual?ano=` — grade 12 meses × empresas: fechamento contábil
  (`CompanyMonthlyCircular.fechadoContabilEm`) + apuração (`ApuracaoSnapshot.estado`). **Duas
  queries pro ano inteiro**, não 12 por empresa. Registrada **antes** de `/companies/:companyId`
  pra "annual" não ser lido como id.
- `GET /firm/jobs/ativos` — contagem dos downloads em lote com `status:"processando"` (notas +
  SITFIS), pro selo do dashboard. Só contagem/progresso, feito pra polling barato; em erro devolve
  vazio (nunca derruba o dashboard). Envio de e-mail em lote **não** entra: é chamada bloqueante.
- `GET /firm/companies` ganhou `guidesEnvio` (total/enviadas/todasEnviadas), `fiscalSituacao` e
  `temParcelamento` — ver `apps/web/src/features/companies/CLAUDE.md` para o efeito no card.

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
`DFE_NOTAS_WORKER_ENABLED`, `APURACAO_BATCH_WORKER_ENABLED`,
`SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED`.

Flags de integração SERPRO (default OFF até validar no trial):
`INTEGRACAO_SERPRO_SITFIS` (ligada), `INTEGRACAO_SERPRO_PAGTOWEB` (OFF — não validado),
`INTEGRACAO_SERPRO_PARCELAMENTO`. Ver `config.js` para os idServiço/versão.

## Regras

- Nunca hardcodar credenciais ou URLs — usar `config.js`
- Toda rota nova de firma deve ficar em `routes/firm/`
- Isolamento multi-tenant é inegociável: sempre filtrar por `firmId`/`companyId`
- Não adicionar `console.log` de debug em produção — usar o logger existente
- Migrations novas devem ter nome descritivo em inglês (snake_case)
