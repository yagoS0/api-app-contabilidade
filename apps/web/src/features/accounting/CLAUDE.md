# CLAUDE.md — Contabilidade (apps/web/src/features/accounting)

Feature de lançamentos contábeis no frontend: aba Lançamentos, Circular, parcelamentos,
plano de contas, funções/templates, importações (OFX/Excel).

## Subpastas

- `entries/` — aba **Lançamentos** (`renderAccountingEntriesTab.jsx`). É a **aba default**
  ao abrir a empresa (Q17). Mostra `FechamentoContabilPanel` no topo: avisa lançamentos
  em branco/desbalanceados e permite **Fechar empresa (mês)** / Reabrir (bloqueado se houver
  pendência). Cálculo de pendência espelha o backend (`validateFechamentoContabil`).
- `circular/` — **Circular** (`renderCircularTab.jsx`): matriz linha (tipo) × 12 meses +
  **resumo por TRIMESTRE (Q1–Q4) e ANUAL por linha** (Q17), calculado da mesma matriz
  exibida (fonte única). Embaixo, `ParcelamentosList`.
- `parcelamento/` — modais (`ParcelamentoModals.jsx`): criação via 1ª guia, vínculo a
  parcelamento existente, pagamento; abertura é a única provisão; contas em branco + memória.
- `functions/`, `chart-of-accounts/`, `rules/`, `historicos/`, `ofx-import/`, `excel-import/`.

## Padrões

- Componentes recebem dados/handlers por **props** (hooks/pages chamam a API). Exceções
  pontuais usam `createApiClient()` direto (ex.: `FechamentoContabilPanel`,
  `ExpectedGuidesPanel`) — mantêm-se auto-contidas.
- Paleta dark via `ACCOUNTING_PANEL` (`entries/lib/accountingEntriesShared`). Cores de estado:
  verde `#69FF47`, amarelo `#FFB347`, vermelho `#FF5757`, ciano `#8BE9FD` (fechada/faturamento).
- Toda chamada nova precisa de par mock/real em `src/api/`.

## Fechamento contábil (Q17)

API: `getFechamentoContabil`, `fecharFechamentoContabil`, `reabrirFechamentoContabil`
(em `realApi`/`mockApi`). Backend valida por lançamento; o painel também pré-valida no
cliente para feedback imediato. Empresa fechada reflete no card do dashboard (cor inteira).
