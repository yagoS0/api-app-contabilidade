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

## ⚠ A COMPETÊNCIA É GLOBAL — mora no header da empresa, não na aba

Eram **duas**, com defaults **diferentes**: os lançamentos nasciam no mês anterior (competência
fechada, como o contador trabalha) e a Circular no mês corrente. Trocar de aba mudava o mês sem
dizer nada, e as duas telas mostravam períodos diferentes da mesma empresa.

A fonte é **`accountingEntriesState.filters.competencia`** (`useManageAccountingEntries`), escrita
pelo `CompetenciaSwitcher` do `renderCompanyDetailHeader`. Escolhida porque o `useEffect` de carga
já observa `filters`: escrever ali recarrega sozinho, sem um segundo caminho de sincronização para
divergir. `circularCompetencia` virou um alias derivado — **não é mais estado**.

- Helpers em **`src/lib/competencia.js`** (`formatCompetencia`, `deslocarCompetencia`,
  `competenciaPadrao`, `competenciaAtual`). Ficam fora de `accounting/` porque o header é da feature
  `companies` e importar entre features viraria a segunda cópia.
- O **ano da matriz da Circular** nasce do ano da competência, não de `new Date().getFullYear()`:
  em janeiro a competência é dezembro do ano anterior, e a Circular abria no ano novo, vazia,
  justamente no mês em que se fecha o ano. Mudar de ano no header leva a matriz junto (com os dois
  valores passados explicitamente ao `loadCircular` — o default do parâmetro é o valor do render
  anterior).
- **`TABS_COM_COMPETENCIA`** (no header) decide onde o seletor aparece: hoje `lancamentos` e
  `circular`. Aba entra na lista quando passa a **filtrar** por competência. Seletor que não comanda
  nada é pior que seletor nenhum — a pessoa muda o mês, nada muda, e passa a duvidar do controle
  também onde ele funciona.

## ⚠ Circular: vencida ≠ a vencer (`circular/lib/estadoGuia.js`)

`statusPagamento === "ABERTO"` pintava tudo de **vermelho** — a guia que vence daqui a duas semanas
com a mesma força da que venceu há dois meses. Vermelho é "bloqueia/vencido"; gasto no prazo normal
ele para de apontar o que atrasou.

Uma leitura só alimenta **a cor da célula, o chip do popover e os totais do rodapé** (12 testes):

- **Vence HOJE ainda é a vencer** — comparar timestamps crus faria a guia do dia nascer vencida às
  00:01. Tudo passa por `inicioDoDia`.
- ⚠ **Sem vencimento não se afirma atraso.** Cai em `ABERTA`, neutra, com o texto dizendo que a data
  não é conhecida. E o rodapé tem balde **próprio** (`semData`): somá-lo em "a vencer" faria o total
  afirmar um prazo que a célula logo acima se recusa a afirmar.
- O `vencimento` (e `envios`) vêm no `select` de `sourceGuide` em `routes/firm/accountingEntries.js`
  — sem eles a regra não tem o que ler.
- **Envio no popover sai de `envios_guia`**, não de `emailStatus`, e o **destino vem do envio**,
  nunca do cadastro (já produziu na tela "Enviada por WhatsApp para <e-mail>").
- **Desfazer baixa leva `baixaIds` inteiro** e confirma antes: são até três lançamentos (principal,
  juros, multa) e a guia reabre.

**Impressão:** o bloco `@media print` do `App.css` deixou de ser da listagem —
`body.imprimindo-listagem` virou **`body.imprimindo`**, e a Circular reusa a mesma regra
(`data-print-area` / `data-print-only` / `data-print-tabela`) em vez de ganhar a segunda cópia.

## Padrões

- Componentes recebem dados/handlers por **props** (hooks/pages chamam a API). Exceções
  pontuais usam `createApiClient()` direto (ex.: `FechamentoContabilPanel`,
  `ExpectedGuidesPanel`) — mantêm-se auto-contidas.
- Paleta dark via `ACCOUNTING_PANEL` (`entries/lib/accountingEntriesShared`). Cores de estado:
  verde `#69FF47`, amarelo `#FFB347`, vermelho `#FF5757`, ciano `#8BE9FD` (fechada/faturamento).
- Toda chamada nova precisa de par mock/real em `src/api/`.

## Menu SERPRO na aba Lançamentos

Quarto `ActionMenu` (depois de "Funções"): **Buscar extrato do Simples** / **Buscar tributos do
Presumido**, na competência da tela (`activeComp`). O regime vem de `companyRegime` — que só
funciona porque `renderCompanyDetailPage` passou a ler de `legacyCompany`; **no topo do payload ele
nunca existiu**, e isso silenciava também o "+ Parcelamento Simples" e os filtros da Circular e das
Guias. Regime fora de Simples/Presumido: item desabilitado que **nomeia** o regime.

⚠ **As chamadas são PAGAS** (o Presumido são duas por clique). O menu lê `serpro` do
`getFechamentoContabil` e confirma antes de repetir — **o estado é lido antes do POST**, porque a
resposta chegaria tarde demais. A marcação de "já buscado" acontece no `finally`: o que a
confirmação protege é o bolso, e a chamada sai mesmo quando falha.

## Mês sem faturamento

Alternador **separado** dos cinco "Confiro que lancei" — e a separação é o ponto: o checklist
confirma que algo FOI lançado; este afirma que algo NÃO EXISTIU. Nasce desabilitado, com o valor
no `title`, quando a competência tem nota emitida (`faturamentoEmit` do mesmo GET). Marcar faz a
tag DAS sumir do card no dashboard.

**Duas evidências desabilitam, uma terceira só avisa** (`conferenciaAdn` do mesmo GET):
- `faturamentoEmit > 0` e conferência **`divergente`** desabilitam — nos dois há evidência CONTRA a
  afirmação, e o servidor recusaria de qualquer jeito.
- Conferência `nao_conferivel` ou inexistente mostra **"· sem conferência do ADN"** e deixa marcar.
  Zero de faturamento e "não conseguimos ver o faturamento" se parecem na tela e significam coisas
  opostas; o aviso é o que separa os dois. Bloquear aí inutilizaria o campo em toda empresa de
  município fora do ADN. O servidor grava COMO foi verificado (`semFaturamentoConferencia`).

## "Falta para fechar" — a tira sob o cadeado

O cadeado sempre soube o que faltava: `problemas` (lançamento em branco / conta em branco / D≠C,
com grupo de parcelamento e folha somados **em conjunto**) e `pendentes` (check-list). Só que os
dois viravam `title` e `window.alert` — apareciam depois do clique falhar, para quem já suspeitava.

Agora saem numa tira logo abaixo do cadeado: *"Falta para fechar: confirmar Provisões, Pagamentos ·
2 lançamentos com problema"*. A contagem abre a lista, e cada item **rola até a linha** e a marca
por 2s (`irAteOLancamento` → `id="lanc-<entryId>"` no `<tr>`). Problema de GRUPO (chave =
`parcelamentoId`/lote) não tem linha própria: o clique não acha elemento e não faz nada — de
propósito, melhor que rolar para a linha errada.

⚠ **A conferência é do lado do cliente, sobre os lançamentos carregados.** Com filtro de
tipo/origem/status ativo o servidor enxerga mais que a tela, então a tira avisa. O backend continua
sendo quem recusa; isto é só antecipação.

Junto disso: o `<tr>` declarava `outline` **duas vezes**, e o segundo (`isSelected ? … : "none"`)
apagava o contorno ciano de `incompleteRowStyle` mesmo sem seleção — o aviso de "falta um lado"
nunca tinha aparecido na tela.

## Fechamento contábil (Q17)

API: `getFechamentoContabil`, `fecharFechamentoContabil`, `reabrirFechamentoContabil`
(em `realApi`/`mockApi`). Backend valida por lançamento; o painel também pré-valida no
cliente para feedback imediato. Empresa fechada reflete no card do dashboard (cor inteira).
