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
| `ParcelamentoService.js` | parcelamento: **1 provisão (abertura)** + N linhas leves `tipo="PARCELA"`; baixa por pagamento contra a abertura; contas em branco + memória por linha (`memorizeParcelamentoLineAccounts`) |
| `ParcelamentoSeeds.js` | templates `AccountingFunction kind=PARCELAMENTO_OPENING/PAYMENT/RESCISION` |
| `AccountingFunctionService.js` | funções/templates de lançamento reutilizáveis |

## Fechamento contábil do mês (Q17)

Distinto do `estado` da apuração (módulo Notas). Campos em `CompanyMonthlyCircular`:
`fechadoContabilEm` / `fechadoContabilPor`. Endpoints em `routes/firm/accountingEntries.js`:
`GET/POST .../fechamento-contabil/:competencia[/fechar|/reabrir]`. O **gate**
(`validateFechamentoContabil`) bloqueia o fechamento **por lançamento**: em branco
(sem linhas / conta vazia) ou desbalanceado (Σ D ≠ Σ C, tolerância 0,01). Ignora `tipo="PARCELA"`.

## Regras

- **Idempotência** em geração (upsert por competência/eventType; guardas antes de criar).
- Nunca somar `tipo="PARCELA"` nem lançamentos `EXPORTADO` que não devam mudar.
- Isolamento multi-tenant: sempre `portalClientId`.
- Contas em branco são esperadas no 1º mês — a memória preenche as próximas.
