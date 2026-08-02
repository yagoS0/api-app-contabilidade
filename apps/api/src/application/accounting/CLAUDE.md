# CLAUDE.md — Contabilidade (apps/api/src/application/accounting)

Lógica de lançamentos contábeis, provisões, baixas, parcelamentos e fechamento do mês.

## Conceitos

- **AccountingEntry** = um lançamento. Tem `tipo` (PROVISAO | DESPESA | RECEITA | BAIXA |
  **PARCELA** | ...), `subtipo`, `competencia` (YYYY-MM), `origem` (MANUAL | SERPRO | TEMPLATE),
  `status` (RASCUNHO | CONFIRMADO | EXPORTADO), `statusPagamento` (ABERTO | PAGO | NA),
  `eventType` (memória do par D/C), e **linhas** (`AccountingEntryLine`: conta, tipo D/C, valor).
- **`tipo="PARCELA"` (Q17/Q16)** = linha leve de rastreio de parcela — **sem linhas D/C**,
  zero impacto contábil. Toda soma/listagem/export deve **excluí-la** (`tipo: { not: "PARCELA" }`).
- **Memória de D/C** (`AccountingHistorico`, por `companyPortalClientId` + `eventType`):
  contas começam em branco e são aprendidas no 1º preenchimento (auto-save do `PUT /entries`).
  Reusada por DARF/Simples e por parcelamento (`PARC_<KIND>_OPEN#n` / `_PAY_PRINCIPAL` / `_PAY_JUROS`).

## Arquivos principais

| Arquivo | Papel |
|---|---|
| `AccountingEntryGeneratorService.js` | gera lançamentos a partir da circular/extrato; `lookupAccountsFromHistorico`, `applyTemplate`, `generateEntriesFromCircular` |
| `GuideToProvisionService.js` | guia PROCESSED → provisão (contas em branco + memória) |
| `ParcelamentoService.js` | parcelamento (Q9/Q16 legado): **1 provisão (abertura)** + N linhas leves `tipo="PARCELA"`; baixa por pagamento contra a abertura; contas em branco + memória por linha (`memorizeParcelamentoLineAccounts`) |
| `parcelamento/ParcelamentoV2Service.js` | parcelamento v2 (Q21/Q23). **Q23 — gatilho do SERPRO:** a 1ª parcela é **manual** → `ingestParcelamentoFromGuide` cria **só a PROVISÃO** (≥3 linhas: D=principal, D=juros, C=total; `provisaoLines` editadas no modal ou `linhasProvisao` padrão; contas via `MapaContaTributo`, em branco até aprender) + vincula guia + `TributoParcela`. **NÃO** cria pagamento. A provisão setar `aberturaEntryId` ⇒ **ativa a busca automática** do worker. O **pagamento** (BAIXA, juros LIDO) é gerado por `gerarPagamentoParcelaFromGuide` ao marcar a guia como **paga** (`confirm-payment`), data = dia do clique; **bloqueia** se o mês estiver fechado. `resolverContasProvisao` pré-preenche o modal. Memória: `memorizeMapaContaTributo`. |
| `ParcelamentoSeeds.js` | templates `AccountingFunction kind=PARCELAMENTO_OPENING/PAYMENT/RESCISION` (legado Q9/Q16) |
| `AccountingFunctionService.js` | funções/templates de lançamento reutilizáveis |

## Fechamento contábil do mês (Q17/Q18)

Distinto do `estado` da apuração (módulo Notas). Campos em `CompanyMonthlyCircular`:
`fechadoContabilEm` / `fechadoContabilPor`. Endpoints em `routes/firm/accountingEntries.js`:
`GET/POST .../fechamento-contabil/:competencia[/fechar|/reabrir]`. O **gate**
(`validateFechamentoContabil`) bloqueia o fechamento **por lançamento**: em branco
(sem linhas / conta vazia) ou desbalanceado (Σ D ≠ Σ C, tolerância 0,01). Ignora `tipo="PARCELA"`.

⚠ **A regra mora em `fechamentoBlockers.js`, não na rota.** `computeFechamentoBlockers(entries,
competencia)` é PURA (recebe lançamentos já carregados) e é usada por dois consumidores: o cadeado
por empresa (`validateFechamentoContabil`, que virou uma query + uma chamada) e a visão de carteira
`GET /firm/companies/fechamento?competencia=`, que precisa da mesma resposta para dezenas de
empresas numa query só. O check-list (`CHECKLIST_FECHAMENTO`, `CHECKLIST_SELECT`,
`checklistPendentes`) foi para lá pelo mesmo motivo — morava dentro da fábrica de rotas e não dava
para reusar. Uma segunda cópia de qualquer um dos dois faz as telas discordarem sobre a mesma
empresa.

Sutileza que a extração preservou: **conta em branco é checada lançamento a lançamento** (inclusive
nos de parcelamento e folha), mas **D≠C é checado por GRUPO** nesses dois casos — eles nascem com
uma perna só e só balanceiam em conjunto (`parcelamentoId` / `loteImportacao`).

**Q18 — mês fechado bloqueia mudanças.** Helper `isMonthClosed(portalClientId, competencia)`
em `fechamentoContabil.js`. Usado para **bloquear**: criar lançamento (`POST /entries` → 409
`mes_fechado`), subir/registrar guia **manual** (`createOrUpdateGuideFromProcessing` lança
`MES_FECHADO` quando `source !== "SERPRO"` — a captura automática do SERPRO não é afetada) e
marcar guia **Vazio** (`POST /guides/vazio` → 409). No front, a aba Lançamentos desabilita
"+ Adicionar" (via `FechamentoCadeado.onState`) e o painel de guias esperadas desabilita "Vazio".

## Baixa: principal, juros e multa são LANÇAMENTOS SEPARADOS

Regra do dono. Cada componente vira um `AccountingEntry` próprio, balanceado contra o caixa:
`D principal / C caixa` · `D juros / C caixa` · `D multa / C caixa`. Um único lançamento 3D/1C
esconde os acréscimos num dropdown e, pior, faz parecer que juros/multa amortizam o passivo —
eles são **despesa do mês do pagamento**. Componente zerado **não** gera lançamento.

- O **papel** de cada linha vem MARCADO do modal (`papel: PRINCIPAL|JUROS|MULTA`), não deduzido da
  conta: o contador pode trocar a conta. Linha sem papel conta como principal.
- ⚠ `@@unique([portalClientId, competencia, eventType, origem])`: **só o lançamento do PRINCIPAL
  carrega o `eventType`** — repetir nos três viola a constraint e derruba a baixa inteira. Também é
  o correto: a memória de contas (`AccountingHistorico`) é do par do tributo, não de juros/multa.
- Todos apontam para a MESMA provisão (`openEntryId`); juros/multa não entram no principal abatido
  (`CONTAS_ACRESCIMO` = 501/506), então o saldo continua certo.
- Onde vale: baixa do INSS (`InssPagamentoService`), baixa genérica (`POST /entries/:id/baixa`) e
  parcelamento V2 (que já usava `criarLancamentosIndividuais`).
- Legado: `scripts/separar-baixas-agrupadas.mjs` separa baixas antigas que ficaram agrupadas.

## Valor corrigido pelo contador manda

Ao editar o valor de um tributo na Circular, as LINHAS do lançamento acompanham (`edicaoManual` em
`generateEntriesFromCircular`). A regra que preserva o valor original vale só para o **recálculo
automático do SERPRO** (juros após vencimento). E, havendo baixa, o status é recalculado a partir
dela (`statusPelasBaixas`) — senão a provisão corrigida pra menor ficava eternamente PARCIAL com a
diferença "em aberto", e reeditar uma provisão paga a ressuscitava como ABERTO.
Legado: `scripts/corrigir-provisao-parcial.mjs`.

## Regras

- **Idempotência** em geração (upsert por competência/eventType; guardas antes de criar).
- Nunca somar `tipo="PARCELA"` nem lançamentos `EXPORTADO` que não devam mudar.
- Isolamento multi-tenant: sempre `portalClientId`.
- Contas em branco são esperadas no 1º mês — a memória preenche as próximas.
