# CLAUDE.md — Contabilidade (apps/web/src/features/accounting)

Feature de lançamentos contábeis no frontend: aba Lançamentos, Circular, parcelamentos,
plano de contas, funções/templates, importações (OFX/Excel).

## Subpastas

- `entries/` — aba **Lançamentos** (`renderAccountingEntriesTab.jsx`). É a **aba default**
  ao abrir a empresa (Q17). **Q18 (reforma de UI):**
  - **Adicionar inline:** sem form fixo; botão **"+ Adicionar lançamento"** → `adding=true`
    → `DraftEntryRow` (linha editável no topo do `<tbody>`, em `renderAccountingEntriesParts.jsx`).
    Salvar cria e **reabre** outra linha (auto); **ESC/Sair** fecha.
  - **Cadeado de fechamento:** `FechamentoCadeado` (compacto, ao lado de "+ Adicionar")
    — 🔓 Fechar mês / 🔒 Fechada; bloqueia com alerta se houver lançamento em branco/D≠C.
  - **Tabela:** colunas **Tipo** e **Status** removidas (`COLS` em `accountingEntriesShared.js`,
    7 colunas; `colSpan` full-width = 7); títulos de grupo centralizados/brancos/menores;
    textos em branco; mais espaço pro Histórico.
  - **Carga (importante):** os lançamentos carregam via `useEffect` em
    `useManageAccountingWorkspace.js` quando `companyDetailTab === "lancamentos"` e quando
    `accountingEntriesState.filters` mudam (competência etc). Sem esse effect a lista abre
    vazia (a carga não é feita pela tab).
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
