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
- `parcelamento/` — o **contrato** e o que gira em torno dele. Ver a seção "Parcelamento-first"
  abaixo: a criação é o `ParcelamentoWizard.jsx` (3 passos, **sem guia nenhuma**), os cards e a
  rescisão vivem em `ParcelamentoModals.jsx`, e as regras em `lib/wizardParcelamento.js` +
  `lib/cartaoParcelamento.js`, com teste próprio.
- `functions/`, `chart-of-accounts/`, `rules/`, `historicos/`, `ofx-import/`, `excel-import/`.

## ⚠ PARCELAMENTO-FIRST: o CONTRATO antes do documento (F2.3)

O parcelamento nascia como efeito colateral de subir uma guia. Ele é um **contrato de dívida** de
até 60 meses; a guia é evidência **mensal e opcional** — não existe em débito automático nem nas
prestações de um acordo migrado de outra contabilidade. A tela inverteu junto com o backend.

| onde | o quê |
|---|---|
| **aba Parcelamentos** | `+ Novo parcelamento` → `ParcelamentoWizard.jsx`. 3 passos, cria o contrato por `POST /parcelamentos/ingestao` **com `guideId: null`** |
| **aba Guias** | `+ Subir Guia → PARCELAMENTO` → `guides/list/components/GuiaDeParcelamentoModal.jsx`. ANEXA uma guia a uma prestação de um contrato que já existe |

**Regras em `lib/`, com teste próprio:** `wizardParcelamento.js` (27) · `cartaoParcelamento.js` (19)
· `guides/lib/anexoParcelamento.js` (23). Os componentes só ligam.

⚠ **A COMPETÊNCIA DA 1ª PARCELA É COLETADA, e não é a da parcela atual.** O backend grava
`competenciaInicial = header.anoMesParcela` e deriva TODO o cronograma dela
(`parcelaSync.calendarioDaParcela`). Mandar a competência da parcela ATUAL — que é o que o caminho
guia-first faz — desloca o cronograma pelo número de prestações já pagas: num contrato migrado na
23ª de 60 são **22 meses de erro em todo vencimento**, e é o vencimento que decide atraso quando não
há guia. Sem ela e sem guia, o backend grava a sentinela `1970-01` e o cronograma nasce sem datas.

⚠ **`saldoConsolidado` é INFORMATIVO e NUNCA vira lançamento.** No passo 3 ele aparece ao lado do que
de fato será provisionado (`valor da parcela × restantes`), como **conferência**. A divergência entre
os dois é **alerta, não bloqueio** — juros embutidos nas prestações são normais.

⚠ **NÃO EXISTE CHECKBOX "salvar como padrão da modalidade", e a ausência é deliberada.**
`memorizeMapaContaTributo` grava SEMPRE com `portalClientId: null` (escopo do escritório): preencher
as contas de uma empresa já vira o padrão de todas, e o override por cliente existe na tabela mas
ninguém o escreve. Um checkbox prometeria uma escolha que não existe e desmarcá-lo não faria nada.
No lugar dele há uma frase permanente dizendo que a memória é global.

⚠ **Primeira vez de uma modalidade** (`getContasProvisao` volta tudo em branco): o passo 3 abre
DIRETO em modo edição. Tabela read-only vazia esperaria que o contador descobrisse sozinho que
existe um link "Editar lançamentos".

⚠ **`parcelasJaPagas` NÃO gera lançamento.** As N primeiras prestações viram `origemBaixa:
"HISTORICO"` — vocabulário de uma coluna que já existia, não estado novo. Não houve pagamento nosso
para lançar. O card conta quantas são (`contarHistoricas`) e diz "22 de 60 (22 históricas)": sem
isso, um contrato migrado exibe 22 pagamentos que este escritório nunca lançou e alguém vai
procurá-los no razão.

⚠ **`parcela.competencia` NÃO VEM NO PAYLOAD.** `SELECT_PARCELA_PARA_QUADRO` traz `id`,
`numeroParcela`, `vencimento`, `origemBaixa` e a guia — e é ele que alimenta `parcelasContratadas`.
Quem precisa da competência a DERIVA do vencimento contratado (`anexoParcelamento.competenciaDaParcela`),
que por construção cai dentro do mês da competência. Ler `parcela.competencia` devolve `undefined`
em produção e deixa o campo do modal de anexo vazio — defeito encontrado no mock, que espelha o
select real de propósito.

### O que SAIU (R1), e por que cada um era o desenho antigo

| removido | era |
|---|---|
| `Lançamentos → Funções → + Parcelamento Simples` (+ `renderParcelamentoModal.jsx`, `createParcelamentoSimples` mock/real, `handleCreateParcelamento`) | chamava `POST /entries/parcelamento`, **removida no backend** — o botão dava **404**. Criava N provisões `subtipo: "PARC_DAS"`; produção tem ZERO lançamentos com esse subtipo |
| `ParcelamentoIngestaoModal` ("Registrar 1ª parcela") | modal-surpresa que abria SOZINHO depois de salvar uma guia |
| `ParcelamentoEntradaModal` ("Novo parcelamento", 3 opções) | podia CRIAR o contrato a partir da guia, e forçava o tipo da guia a `"SIMPLES"` nos dois caminhos |
| `ParcelaPaymentModal`, `GuideLinkParcelamentoModal` | UI das rotas `/parcelas/:num/pagar` e `/link-guide`, removidas no backend; nenhuma tinha chamador |
| `getParcelamento`, `linkGuideToParcelamento`, `payParcela` (mock **e** real) | rotas removidas. Mock que sobrevive à rota que espelha é como um 404 chega à produção sem ninguém ver |

⚠ **`ParcelamentoCreateModal` (V1, por template) ficou** — ele é o leftover que
`apps/api/src/application/accounting/CLAUDE.md` marca como **decisão do dono**. Hoje ele é
**inalcançável pela UI**: o item "+ Novo parcelamento…" do menu Funções depende da prop
`parcelamentos`, que `renderCompanyDetailPage` **não passa** para a aba Lançamentos.

## Buscar pagamento da parcela — na LINHA, e a mesma rota das outras guias

`parcelamento/components/ParcelasDoAcordo.jsx` + a regra em `parcelamento/lib/parcelaBusca.js`
(24 testes; a ligação em `components/__tests__/parcelasDoAcordoBusca.test.jsx`, 16).

Uma parcela **É uma `Guide`** com `parcelamentoId`, então o botão chama exatamente a mesma
`POST /firm/guides/:id/buscar-pagamento` que a Circular já usa nos tributos
(`renderCircularTab.handleBuscarPagamento`). **Não há caminho novo de backend.** O que mudou de lado
do servidor foi só o `select`: `listParcelamentos` passou a derivar `numeroDocumento` (e
`serproLastCheckedAt`) das guias — sem isso a tela não tinha como desabilitar o botão com o motivo,
porque o número do documento não saía por nenhuma rota (nem o `toGuideResponse` o expõe).

⚠ **A busca NÃO lança nada.** Ela marca a guia como paga e guarda o comprovante; a baixa continua
sendo ato deliberado, no painel "Parcelas pagas aguardando lançamento" logo acima — para onde a
linha migra depois (o painel recarrega por `refreshKey`).

⚠ **A chamada é PAGA e recusa de seis maneiras**, cada uma com saída diferente para o contador:
`SERPRO_CHAMADA_REPETIDA` (cooldown de 5 min), `SERPRO_TETO_DIARIO`,
`SERPRO_TETO_MENSAL_ESCRITORIO`, `SERPRO_PAGTOWEB_DISABLED`, `PAGTOWEB_FALHOU`, e o **"não
localizado"**, que **não é erro** — sai em tom neutro, distinto do vermelho de falha. Antes do POST,
um `confirm` **repete documento, valor e competência** e avisa se a guia já foi consultada.

⚠ **`SERPRO_PAGTOWEB_DISABLED` chega com `message === "serpro_pagtoweb_disabled"`** — a mensagem do
servidor É o código. `motivoDaFalha` descarta mensagem sem espaço em branco e usa o texto
explicativo; exibi-la crua poria o nome de uma flag de ambiente no lugar do motivo.

⚠ **`ParcelamentosList` não desmonta mais a lista durante a recarga**
(`loading && !parcelamentos.length`). `useParcelamentos.load()` liga `loading` em TODA ação, e a
troca por "Carregando…" apagava o desfecho da busca no mesmo tick em que ele aparecia: o acordeão
fechava e não sobrava nada na tela — indistinguível de "o botão não fez nada", num clique que
custou dinheiro.

### ⚠ Incidente de produção (pós-`e1ec3a8e`) — um contrato de 60 prestações SEM GUIA

Três defeitos distintos, todos reproduzíveis na fixture `parc-migrado-60` do `mockApi`:

1. **As 60 linhas diziam "Buscando…" sem ninguém clicar.** `buscando` nasce `null` e a prestação sem
   guia tem `guideId: null` — `buscando === linha.guideId` era `null === null` = **true**. A tela
   afirmava 60 consultas PAGAS em voo. Hoje: `Boolean(linha.guideId) && buscando === linha.guideId`.
2. **A tabela vazava para fora do card.** Ela precisa de ~640px e o card fechado tem ~360px; o
   `overflowX: auto` empurrava a coluna da AÇÃO (botão + motivo) para fora da área visível, e quem
   rolava via o texto cortado no meio da palavra pela ESQUERDA. Hoje o card com o histórico **aberto
   ocupa a linha inteira do grid** (`gridColumn: "1 / -1"` em `ParcelamentosList`) e a tabela cabe.
3. **60 parágrafos idênticos.** O motivo agora sai **uma vez por grupo** (`agruparBloqueios`), com a
   contagem e as prestações; a linha guarda o `rotulo` curto e o `title` do botão mantém o texto
   inteiro. **Nenhuma linha e nenhum motivo somem** — some a repetição.

⚠ **"SEM GUIA" NÃO É CASO DE BORDA.** Palavras do dono: *"alguns parcelamentos, ainda mais no Lucro
Presumido, não vão ter parcelas pois são em débito automático"*. `estadoBuscaParcela` lê
`linha.formaPagamento` (que `montarParcelasDoAcordo` copia do contrato) e tem **três** textos:
`DEBITO_AUTOMATICO` diz que a guia não existe **e não vai existir**; `GUIA_MENSAL` manda capturar;
`null` (o default do backend, e o valor de todo contrato anterior a `139c4efe`) **não afirma qual é**
— diz os dois desfechos. Mandar um cliente de débito automático esperar a captura do SERPRO é
mandá-lo esperar um documento que nunca chega.

⚠ **"Não consigo dar baixa" é OUTRO defeito, e no fundo é uma CAPACIDADE QUE FALTA (F2.2).** A fila
"Parcelas pagas aguardando lançamento" é alimentada por `guia.paymentStatus = PAID` — a rota
`parcelas-pendentes-baixa` filtra por `guia`. Prestação **sem guia não tem por onde entrar**. O
`Dar baixa` do card não lança nada: ele navega até a fila e destaca. Com zero parcelas do contrato
ali, ele rolava a página e o subtítulo ainda dizia *"Destacadas: as do contrato que você clicou"* —
silêncio indistinguível de botão quebrado. Hoje a fila **diz** que não há nenhuma daquele contrato e
**nomeia** o que falta (baixa a partir do extrato, sem documento, não existe). ⚠ **Não "consertar"
desabilitando o botão de baixa** — desabilitar seria dizer a uma classe inteira de clientes que a
baixa nunca vai funcionar; construir a F2.2 é decisão do dono.

⚠ **O mock conhece TODOS os caminhos de recusa** (`DESFECHO_BUSCA_MOCK`, por prefixo do `guideId`) e
a fixture de `listParcelamentos` tem uma linha para cada estado — inclusive a prestação **sem guia**
(débito automático) e a guia **sem `numeroDocumento`**. Mock que só soubesse o caminho feliz
esconderia exatamente o que esta tela existe para mostrar.

## A célula de valor aceita fórmula (`entries/lib/valorFormula.js`)

Digitar `=10+10` na célula de valor da linha de lançamento resulta em 20 — o contador deixa de
calcular fora e transcrever, que é onde se erra dígito. Vale só no `DraftEntryRow` (que serve
**criar e editar**); folha, baixa, parcelamento, guias e o `LineEditor` continuam como estavam.

- **`type="text"`, não `type="number"`** — não é estilo, é pré-requisito: com `number` o browser
  devolve `""` para conteúdo que considera inválido, então o `=` zerava o campo e a fórmula nunca
  chegava ao handler. Consequência: some a filtragem nativa de letras, e o tokenizer passa a ser a
  única barreira (por isso caractere fora do alfabeto é **erro**, nunca ignorado).
- **Sem `eval`/`new Function`.** É texto de usuário virando lançamento contábil; o avaliador é
  escrito à mão e só conhece `+ - * / ( )`. Não há `eval` em lugar nenhum deste repositório.
- **Nunca devolve 0 por desistência.** Fórmula quebrada devolve `{ok:false, erro}` e o Salvar
  desabilita com o motivo à vista. O `Number(l.valor || 0)` que existia no payload virava `NaN || 0`
  = **R$ 0,00 gravado em silêncio** no instante em que o campo aceitasse `=`.
- **Uma leitura só.** `Number(valor)` aparecia em três lugares (gate do Salvar, payload, init da
  edição); hoje um `useMemo` alimenta os três. Com fórmula, "o que está escrito" e "quanto vale"
  deixaram de ser a mesma coisa.

### ⚠ A regra do separador decimal — gramática estrita, não heurística

Em pt-BR `,` é decimal e `.` é milhar, mas quem usa teclado numérico digita `.` como decimal. Ler
errado não dá um valor um pouco diferente: dá um valor **1000× maior ou menor**.

Duas formas canônicas são aceitas — pt-BR (`1.234,56`, `1.234`, `1234,56`, `1234`) e ponto-decimal
sem agrupamento (`10.5`, `10.50`, `1234.56`). **Todo o resto é recusado com erro nomeado.** O que
segura a regra é o **agrupamento de 3 dígitos obrigatório** no milhar: é ele que distingue `1.234`
de `1.23.4`.

| entrada | resultado | por quê |
|---|---|---|
| `1,234.56` | **recusado** | vírgula antes de ponto é en-US, não pt-BR. Lido como brasileiro viraria 1,23 — 1000× para baixo, vindo de um copiar-e-colar de planilha |
| `1.23.4` · `1.2345,67` · `1234.500` | **recusado** | grupos de milhar inválidos |
| `1.500` | 1500 | ambiguidade real (pode ser 1,50), resolvida como pt-BR — ver abaixo |

⚠ **A PRÉVIA NÃO É ENFEITE — é ela que torna a última linha segura.** `1.500` querendo dizer R$ 1,50
é indistinguível pelo texto; a prévia mostra `= 1.500,00` **antes** de salvar, e por isso ela
aparece com **qualquer** conteúdo, não só com `=`. Quem remover a prévia deixa a regra perigosa.
Ela mora dentro do `<td>`, abaixo do input — mesmo padrão dos avisos de conta duplicada e conta
fora do plano, e a coluna é `116px` fixa (`COLS`), então nada empurra nada.

⚠ **Mudança de comportamento em produção:** antes, `type="number"` fazia `1.234` valer **1,23**;
agora vale **1.234,00**. É consequência de tirar o `number`, não da fórmula em si — e é a leitura
correta num sistema contábil brasileiro, mas quem tinha memória muscular vai sentir.

Regra em `lib/` com 48 testes próprios; `components/__tests__/draftEntryRowValor.test.jsx` cobre só
a **ligação** (prévia, gate do Salvar, número no payload), não a aritmética de novo.

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

## ⚠ A aba Lançamentos NÃO pagina — quem pagina é a rota, e o front percorre tudo

`GET /entries` pagina, e o **default dela é 50**. `loadAccountingEntries` não mandava
`page`/`limit`, então só a **primeira página** chegava: competência com mais de 50 lançamentos
exibia os 50 mais antigos (`orderBy: data asc`) e escondia o resto. Os que "sumiam" eram sempre os
do **fim do mês**.

Não há controle de paginação na aba — nada na tela sugere que exista uma página 2.

⚠ **O rodapé se contradizia, e essa é a assinatura do defeito.** A contagem sai de `total` (o
`count` do backend, sempre certo) e as somas D/C saem de `entries` (só o que chegou). Num mês de
450 lançamentos o rodapé dizia:

```
450 lançamentos no total · D R$ <soma de 50> · C R$ <soma de 50>   ✓ ok
```

O **`✓ ok` aparecia** porque os 50 carregados batem entre si — cada lançamento é balanceado, então
um corte no meio da lista continua fechando. Número certo ao lado de soma errada, carimbado de
conferido. Quem contar as linhas visíveis contra o "450" acha o problema; o selo verde diz que não
há problema.

⚠ O **gate de fechamento não foi afetado**: `validateFechamentoContabil` / `fechamentoBlockers`
fazem a própria query no banco. Era a tela que mentia, não a trava.

O **CSV nunca teve limite** (`/entries/export/csv` não pagina) — tela e exportação discordavam, e
foi assim que apareceu. Se a lista for contestada de novo, comparar com o CSV é o teste mais rápido.

Hoje `loadAccountingEntries` percorre as páginas até completar `total`, pedindo **200 por chamada**
(= teto do backend; pedir mais não traz mais). Mês com até 200 lançamentos continua sendo **uma
única requisição**, igual antes. O teto fica no backend de propósito — é guarda da query, não regra
de tela. Página vazia com `total` ainda por alcançar **avisa na tela**: lista incompleta em silêncio
é exatamente o defeito que isto corrige. Regressão em
`app/hooks/__tests__/useManageAccountingWorkspace.test.js` (conta CHAMADAS, não formato de
lançamento — um teste que olhasse só a 1ª página passaria com o bug de volta).

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
