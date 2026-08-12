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

### ⚠ O parcelamento tem DUAS memórias de conta — e até a F2.3 só a errada era alimentada

| | tabela | chave | quem LÊ |
|---|---|---|---|
| **V1** | `AccountingHistorico` | `(empresa, "PARC_<KIND>_<ROLE>#<ordem>")` — depende da **ordem** da linha no template | `lookupLineConta`, só em `createParcelamento` |
| **V2** | `MapaContaTributo` | `(cliente\|global, tipoParcelamento, tipoLinha, codigoTributo)` — depende do **papel** da linha | `resolverConta`: toda provisão, toda baixa e o pré-preenchimento do modal |

O auto-save do `PUT /entries` chamava **só** `memorizeParcelamentoLineAccounts` (a do V1). Num
lançamento do V2 ela até escrevia algo — o 1º entry da provisão vira role `OPEN` porque é ele que
`aberturaEntryId` aponta, e as baixas viram `PAY_JUROS`/`PAY_PRINCIPAL` pelo histórico — mas escrevia
**na tabela que o V2 nunca lê**. O contador corrigia a conta, o sistema dizia que aprendeu, e o
parcelamento seguinte vinha em branco de novo. `memorizeMapaContaTributo` existia para isso desde a
Q21 e estava **exportada sem um único chamador**: a memória do V2 só era alimentada na ingestão,
quando o modal mandava `provisaoLines` — correção posterior nunca era aprendida.

**Hoje as duas são chamadas**, e nenhuma atrapalha a outra: a do V2 exige `tipoLinha` **na linha**
(campo que só os lançamentos do V2 preenchem), então num lançamento V1 ela é no-op. Best-effort, como
já eram.

### ⚠ AS DUAS FAMÍLIAS DE MODALIDADE — a fonte é `parcelamento/contracts.js`

`TIPOS_PARCELAMENTO` tem dez valores: quatro do **Simples Nacional** (`PARCSN`, `PARCSN_ESPECIAL`,
`PERT_SN`, `RELP_SN`), quatro do **MEI** (`PARCMEI`, `PARCMEI_ESPECIAL`, `PERT_MEI`, `RELP_MEI`), mais
`INSS` e `OUTRO`, que **não têm família e não colapsam**. A regra mora em `contracts.js`
(`FAMILIAS_PARCELAMENTO`, `familiaDaModalidade`, `grupoDoParcelamento`, `chaveMemoriaContas`) — é lá
que a lista de tipos vive, e o módulo é puro, então service, worker e rota importam sem arrastar
prisma. A cópia do front (`apps/web/src/lib/vocabulario.js`) **não é importável**: o `Dockerfile` não
copia `packages/` e cruzar apps quebra o boot.

⚠ **O bug que isso corrigiu:** `Parcelamento.grupo` saía de `/^PARC(SN|MEI)/i`, e `PERT_SN`,
`RELP_SN`, `PERT_MEI` e `RELP_MEI` **não casam com o prefixo**. As quatro caíam em `grupo: "outros"`
e os dois filtros da busca automática são `grupo: { not: "outros" }` (`workers/serproPgdasdWorker.js`
e a rota `.../serpro/parcelamento/capture`): **metade das modalidades do Simples/MEI era invisível
para a captura do SERPRO, em silêncio**. `PARCSN_ESPECIAL`/`PARCMEI_ESPECIAL` casavam com o prefixo e
sempre estiveram certas. A lista agora é FECHADA — modalidade desconhecida fica em `outros` (fora da
captura, que é ato externo e pago) em vez de entrar por parecer com um prefixo.

⚠ **`grupo` só é escrito na CRIAÇÃO.** A reingestão não o atualiza (de propósito — ela não remexe em
cabeçalho já materializado), então **contratos PERT/RELP criados antes desta correção continuam com
`grupo="outros"`** e seguem fora da captura até um backfill. Decisão do dono.

⚠ **A chave do `MapaContaTributo` COLAPSA PARA A FAMÍLIA** (`PARCSN` / `PARCMEI` — exatamente as
chaves que `MapaContaTributoSeeds` semeia, então nada é orfanado). Decisão do dono: o tratamento
contábil é idêntico dentro da família, e fragmentar em nove chaves faria o contador preencher a mesma
tríade nove vezes. **O colapso vive dentro de `resolverConta` e `memorizeMapaContaTributoTx`, os dois
únicos pontos que leem e escrevem a memória — NUNCA na variável `tipoParcelamento`**, que segue crua
para `subtipo: PARC_<TIPO>` e `historicoBase: PROVISÃO <TIPO>`. Colapsar na origem mudaria a forma e o
histórico do lançamento e apagaria a distinção entre PERT e RELP, que têm reduções de multa e juros —
não mudam as contas, mudam os valores. Regressão: `__tests__/familiaModalidadeParcelamento.test.js`
(32), cujo bloco "a modalidade CRUA sobrevive" existe justamente para reprovar essa "simplificação".

⚠ **`Parcelamento.kind`** (`(tipo === "INSS" || tipo.startsWith("PARCMEI")) ? "INSS" : "SIMPLES"`) é
uma **quarta leitura parcial da família** e **não foi tocada**: é campo de compat legado, todo leitor
faz `parc.tipo || parc.kind` (e `tipo` sempre vence), e mudá-la alteraria dado gravado sem pedido.

⚠ **O escopo do que o V2 aprende é GLOBAL** (`portalClientId: null`), por desenho da Q21 — é o mesmo
escopo que a ingestão já gravava. Corrigir a conta num parcelamento muda o padrão para os próximos de
**qualquer** empresa (o override por cliente existe na tabela e hoje não é escrito por ninguém).

## Arquivos principais

| Arquivo | Papel |
|---|---|
| `AccountingEntryGeneratorService.js` | gera lançamentos a partir da circular/extrato; `lookupAccountsFromHistorico`, `applyTemplate`, `generateEntriesFromCircular` |
| `GuideToProvisionService.js` | guia PROCESSED → provisão (contas em branco + memória) |
| `ParcelamentoService.js` | parcelamento (Q9/Q16 legado): **1 provisão (abertura)** + N linhas leves `tipo="PARCELA"`; contas em branco + memória por linha (`memorizeParcelamentoLineAccounts`). ⚠ **F2.3 removeu `getParcelamento`, `linkGuideToParcela` e `confirmParcelaPayment`** com as três rotas órfãs que só elas serviam — não havia chamador, e produção não tem um único parcelamento V1. Sobrou `createParcelamento` + `rescindirParcelamento` + `listParcelamentos`; a baixa de parcela é **uma só**, `ParcelamentoV2Service.gerarPagamentoParcelaFromGuide`. |
| `parcelamento/ParcelamentoV2Service.js` | parcelamento v2 (Q21/Q23). **Q23 — gatilho do SERPRO:** a 1ª parcela é **manual** → `ingestParcelamentoFromGuide` cria **só a PROVISÃO** (≥3 linhas: D=principal, D=juros, C=total; `provisaoLines` editadas no modal ou `linhasProvisao` padrão; contas via `MapaContaTributo`, em branco até aprender) + vincula guia + `TributoParcela`. **NÃO** cria pagamento. A provisão setar `aberturaEntryId` ⇒ **ativa a busca automática** do worker. O **pagamento** (BAIXA, juros LIDO) é gerado por `gerarPagamentoParcelaFromGuide` ao marcar a guia como **paga** (`confirm-payment`), data = dia do clique; **bloqueia** se o mês estiver fechado. `resolverContasProvisao` pré-preenche o modal. Memória: `memorizeMapaContaTributo`. ⚠ A baixa começa **reservando a guia** (`updateMany` condicional em `lancamentoId: null`, dentro da transação) — é o que impede baixa DUPLICADA em corrida; as duas verificações de idempotência de cima são check-then-act e só servem para dar o motivo legível. |
| `ParcelamentoSeeds.js` | templates `AccountingFunction kind=PARCELAMENTO_OPENING/PAYMENT/RESCISION` (legado Q9/Q16). ⚠ **Os `PARCELAMENTO_PAYMENT` não têm mais leitor POR KIND no back** (`resolveOpeningTemplate` só busca `OPENING`; `RESCISION` ainda é lido pela FK `templateRescision`) — mas **não são código morto**: entram na lista genérica de funções de lançamento e podem ser aplicados à mão pelo contador via `applyAccountingFunction`, que é justamente o caminho que `AccountingFunctionService` documenta como "o template MANDA no tipo, e ele pode ser BAIXA". Quem filtra por esse `kind` hoje é só o modal V1 do front. |
| `AccountingFunctionService.js` | funções/templates de lançamento reutilizáveis |

## F2.1 — a PARCELA virou entidade (`model Parcela` / tabela `parcelas`)

Até aqui **uma parcela ERA uma `Guide`** com `parcelamentoId` (unique `(parcelamentoId,
numeroParcela)`), e o módulo inteiro derivava estado disso. A consequência é que **parcela sem guia
não existia** — e parcelamento em **débito automático** não tem guia nenhuma, por definição. Ele
chegava na tela como "0 de 0", risco não avaliável.

| | antes | agora |
|---|---|---|
| contadores (`decorateParcelamento`) | numerador = guias quitadas; denominador = `guides.length` | os dois de `parcelasContratadas` |
| risco (`riscoRescisao`) | `guides.map(...)` | as parcelas, **só as que têm evidência** |
| fila de pendentes (`/parcelamentos/parcelas-pendentes-baixa`) | varre `prisma.guide` | varre `prisma.parcela` (guia no join) — e ganhou uma **irmã**, `/parcelamentos/parcelas-sem-guia-pendentes`, para a prestação que não tem guia nenhuma (ver F2.2) |
| fila de conferência (`listarConferenciaParcelas`) | varre `prisma.guide` | idem |
| recálculo de atraso (`recalcularEstadosParcelasEmAberto`) | varre `prisma.guide` | idem, + `semGuia` |
| `recalcularParcelamento` | `parcelasTotal: guides.length \|\| numParcelas` | `quadroDasParcelas` |

⚠ **A tabela NÃO duplica o estado de pagamento.** Não há `baixada` nem `paymentStatus` nela.
No caminho de baixa **por guia** (`gerarPagamentoParcelaFromGuide` exige `guideId` na assinatura, na
guarda `sourceGuideId` e no efeito em `guide.baixada`/`lancamentoId`), quem responde "foi quitada?"
é a **guia**. Na parcela **sem guia** quem responde é `origemBaixa` — ver a F2.2, abaixo; e são duas
colunas para dois fatos diferentes, não duas respostas para o mesmo. Aqui mora o **contrato** (quais prestações existem,
quando vencem); lá mora o **fato**. Uma cópia divergiria no primeiro estorno.

⚠ **`origemBaixa` é onde se grava a quitação de uma parcela que nunca teve guia.**
`parcelaRowQuitada` já a lê — quem grava muda **uma escrita**, não as derivações.

## F2.2 — a baixa da parcela SEM GUIA, por DECLARAÇÃO (`gerarPagamentoParcelaManual`)

Débito automático **não emite documento**: o dinheiro sai da conta e pronto. Decisão do dono:
*"alguns parcelamentos, ainda mais no Lucro Presumido, não vão ter parcelas pois são em débito
automático"* — não é borda, é o caso NORMAL de uma classe inteira de clientes. Como toda a baixa
era ancorada na guia, essas prestações **não tinham como ser baixadas**: 60 contratadas, nenhuma
baixável.

Função **irmã** de `gerarPagamentoParcelaFromGuide` (que **não foi tocada** — é o caminho de quem
tem guia), ancorada na **parcela**. Rota:
`POST .../parcelamentos/parcelas/:parcelaId/baixa-manual`, body
`{ dataPagamento?, valorJuros?, valorMulta?, totalConferido }`.

| | via da **prova** | via da **declaração** ← esta |
|---|---|---|
| fonte | `DETPAGTOPARC165` (SERPRO) | o contador sabe que foi debitado |
| chave | `(numeroParcelamento, anoMesParcela)` | a própria parcela |
| existe? | **não** — depende do vínculo ao SERPRO | sim |

⚠ **A distinção fica no DADO, em três níveis**, não só em comentário: `parcelas.origemBaixa =
"MANUAL"` (o vocabulário da coluna já previa `DEBITO_AUTOMATICO` para a via SERPRO) ·
`AccountingEntry.origem = "MANUAL"` · o histórico diz `(declarado)`, em texto, no razão. Quem
auditar depois distingue "o contador afirmou" de "a Receita provou".

⚠ **A forma do lançamento é a MESMA** — `linhasPagamento` + `resolverConta`, contas de
`configPagamento`/`MapaContaTributo`. Uma variante faria as duas baixas divergirem no primeiro
ajuste de conta.

⚠ **Juros e multa são DECLARADOS, e o total é a SOMA — nunca derivado por subtração.** Sem
documento ninguém mais sabe o encargo; derivar `total - principal` é como o encargo já foi
reconhecido em dobro no passado (ver `linhasProvisao`). O **principal vem do contrato**
(`parcelas.valorPrevisto`), não da tela.

### ⚠ A idempotência: o índice do banco NÃO alcança este caminho

`uq_baixa_guia_linha` é parcial em `"sourceGuideId" IS NOT NULL`, e uma baixa sem guia nasce com
`sourceGuideId` **NULL** — cai **fora** do índice. A guarda equivalente é a **reserva atômica da
parcela**, mesmo idioma da guia com a coluna trocada: dentro da transação, antes de qualquer
escrita, `parcela.updateMany({ where: { id, portalClientId, origemBaixa: null, guiaId: null } })`
grava `origemBaixa/baixadaEm` e só segue com `count === 1`. `guiaId: null` viaja no `where` de
propósito — se a captura do SERPRO vincular uma guia entre a leitura e a transação, esta baixa
desiste em vez de correr em paralelo com a outra.

⚠ **Falta o cinto do banco, e a migration é decisão do dono** (que pediu para não empilhar
migration na mesma janela de deploy). O SQL equivalente, sem coluna nova — os lançamentos passaram
a gravar `numeroParcela`, que com `parcelamentoId` é o que resta identificando a prestação:

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_baixa_parcela_linha
  ON "accounting_entries" ("parcelamentoId","numeroParcela","tipoLinha",COALESCE("codigoTributo",''))
  WHERE "tipo" = 'BAIXA' AND "sourceGuideId" IS NULL
    AND "parcelamentoId" IS NOT NULL AND "numeroParcela" IS NOT NULL AND "tipoLinha" IS NOT NULL;
```

`COALESCE` pelo mesmo motivo do índice da guia (aqui `codigoTributo` é **sempre** NULL: sem guia
não há `TributoParcela`). `CONCURRENTLY` não roda dentro de transação — a migration precisa do
`-- CreateIndex` fora do bloco transacional, ou sem `CONCURRENTLY` aceitando o lock.

⚠ **Ele não cobre parcela com `numeroParcela` NULL.** Hoje isso não acontece neste caminho (as
únicas parcelas sem número nascem de guia, em `parcelaSync`, e parcela **com guia é recusada**
aqui), mas é garantia de fluxo, não estrutural. A versão à prova disso exige coluna
`accounting_entries."parcelaId"` + `UNIQUE (parcelaId, tipoLinha, COALESCE(codigoTributo,''))`.

### As guardas

| situação | resposta |
|---|---|
| parcela **com guia** | `parcela_tem_guia` (409) **apontando a rota da guia** — dois caminhos abertos para a mesma prestação é convite a baixa dupla, e as guardas não se enxergam |
| já baixada (`origemBaixa` preenchido, ou reserva devolve 0) | `parcela_ja_baixada` (409) |
| mês fechado (competência da **data do pagamento**) | `MES_FECHADO` (409) — a baixa grava `AccountingEntry` |
| sem provisão de abertura | `provisao_inexistente` (409) |
| sem `valorPrevisto` | `sem_valor_previsto` (422) — não se inventa o principal |

⚠ **Ato de consequência:** `totalConferido` é **obrigatório** (400 `CONFERENCIA_OBRIGATORIA`) e o
servidor recalcula `valorPrevisto + juros + multa`; divergiu → **409 `CONFERENCIA_DIVERGENTE`** com
a decomposição na resposta. Mesmo padrão de `EstornoBaixaService`.

⚠ **`recalcularParcelamento` roda DEPOIS das escritas e DENTRO da transação** (mesma disciplina do
estorno): o número devolvido a quem clicou é o do estado já baixado, e a regra da IN RFB 2.063/2022
não é reescrita — `quadroDasParcelas`/`avaliarRiscoRescisao` são os mesmos de `decorateParcelamento`.

⚠ **Nada é gravado de volta na `parcela` além da reserva**: `parcelas` não tem `lancamentoId`
(nem `baixada`, nem `paymentStatus`), e duplicar o estado de pagamento lá foi evitado na F2.1 de
propósito.

Regressão: `parcelamento/__tests__/baixaParcelaSemGuia.test.js` (25).

### A FILA — `GET /parcelamentos/parcelas-sem-guia-pendentes` (a porta de onde sai o `parcelaId`)

Sem ela a baixa acima era **inalcançável**: `/parcelamentos/parcelas-pendentes-baixa` filtra por
`guia: { paymentStatus: "PAID", … }`, e prestação sem guia não tem por onde entrar. Um contrato
inteiro em débito automático ficava com fila vazia para sempre, com 60 prestações não baixáveis.

⚠ **SÃO DUAS PERGUNTAS, E POR ISSO SÃO DUAS ROTAS E DOIS PAINÉIS.**

| | pergunta | evidência |
|---|---|---|
| `parcelas-pendentes-baixa` | *"a guia foi paga, falta lançar"* | **sinal externo** — o `paymentStatus` que veio do SERPRO. A tela só repete o documento |
| `parcelas-sem-guia-pendentes` | *"esta prestação venceu e não há guia; você declara que foi debitada?"* | **nenhuma** — a evidência é a declaração do contador |

Uma lista só, ainda que com rótulo de seção, teria UMA coluna de ação e um "baixa em lote" varrendo
as duas metades: seria o contador tratando declaração e prova como a mesma coisa.

**O critério de "entra na fila" mora em `recalculoParcelamento.js`** (`whereParcelaSemGuiaPendente`,
`SELECT_PARCELA_FILA_SEM_GUIA`, `linhaDaFilaSemGuia`, `situacaoDaPrestacaoSemGuia`), junto de
`quadroDasParcelas` — não na rota. Cada condição vem de algo que já existia:

| condição | de onde |
|---|---|
| `guiaId: null` | é a pré-condição da própria baixa (`gerarPagamentoParcelaManual` recusa `parcela_tem_guia`). Listar prestação com guia seria oferecer o botão que o servidor recusa |
| `origemBaixa: null` | o predicado de quitação de `parcelaRowQuitada`, e a mesma coluna da reserva atômica. Cobre `MANUAL`/`DEBITO_AUTOMATICO`/`HISTORICO` de uma vez |
| `vencimento <= fim de HOJE` | vencida é `venc < agora`, o predicado **idêntico** de `avaliarRiscoRescisao` e de `estadoEmAberto`. O fim-do-dia acrescenta só quem **vence hoje** — que no débito automático é a prestação que o contador tem em mãos |
| parcelamento não `RESCINDIDO` | mesma decisão de `quadroDasParcelas` (lá o risco é `null`: "não há mais o que prevenir") |

⚠ **NÃO EXISTE UMA TERCEIRA DEFINIÇÃO DE ATRASO.** O rótulo por linha (`VENCIDA` / `VENCE_HOJE`)
sai de **`estadoEmAberto`** (`parcelaStateMachine.js`); o fim-do-dia é só a **janela** da fila.
Quem vence hoje entra e é rotulada `VENCE_HOJE`, nunca "vencida" — a mesma leitura que
`circular/lib/estadoGuia.js` já usa ("vence HOJE ainda é a vencer").
Travado por `parcelamento/__tests__/filaParcelasSemGuia.test.js` (15), que compara os predicados
lado a lado.

⚠ **Prestação SEM VENCIMENTO fica de fora, e isso não é escondê-la:** sem data não se afirma que
venceu (a sentinela `1970-01` faz o cronograma nascer sem datas). Ela segue contada em
`parcelasSemEvidencia`, no card, com o nome dela.

⚠ **A linha volta COMPLETA — prestação, competência, valor e o CONTRATO.** Sem isso o front faria
uma chamada ao contrato por linha, e são até 60 por acordo. `podeBaixar` + `motivoBloqueio`
(`provisao_inexistente`, `sem_valor_previsto`) antecipam as guardas da rota de baixa **sem
substituí-las**: quem recusa continua sendo `gerarPagamentoParcelaManual`, que enxerga o estado do
momento do clique. A linha bloqueada **continua listada** — escondê-la faria o contrato parecer em
ordem justamente onde ele não está.

⚠ **`SELECT_PARCELA_PARA_QUADRO` GANHOU `competencia` E `valorPrevisto`** — na fonte compartilhada,
não num `select` próprio da fila. Os dois são fato do contrato, da mesma natureza de
`numeroParcela`/`vencimento`; a ausência do primeiro já mordeu (o modal de anexo lia
`parcela.competencia` e recebia `undefined` em produção). `SELECT_PARCELA_FILA_SEM_GUIA` **estende**
esse select — o teste verifica campo a campo que não o reescreve.

⚠ **É uma rota LITERAL** e vale a mesma disciplina de ordem das outras duas
(`parcelamentosRotasLiterais.test.js` cobre as três): engolida por um curinga, a baixa por
declaração volta a ser inalcançável, com um 404 falando de parcelamento inexistente.

## F2.3 — parcelamento-first: o contrato antes do documento

O parcelamento nascia como efeito colateral de subir uma guia. Ele é um **contrato de dívida** de
até 60 meses; a guia é evidência **mensal e opcional** — não existe em débito automático nem nas
prestações de um acordo migrado de outra contabilidade.

| o quê | onde | nota |
|---|---|---|
| criar **sem guia** | `POST /parcelamentos/ingestao` com `guideId` ausente | já funcionava ponta a ponta (rota → `buildDTOsFromManual` → `ingestParcelamentoFromGuide`); ⚠ **sem guia, `header.anoMesParcela` é obrigatório na prática** — sem ele a competência cai na sentinela `1970-01` e o cronograma nasce **sem datas** |
| `formaPagamento` | `Parcelamento` | `DEBITO_AUTOMATICO`\|`GUIA_MENSAL`\|**NULL = não declarado**. Troca inferência por declaração; **não** alimenta o risco (ver abaixo) |
| `saldoConsolidado` | `Parcelamento` | ⚠ **informativo — NUNCA vira lançamento** |
| `diaPagamento` | `header.diaPagamento` → cronograma | a coluna sempre existiu (default 1) e sempre alimentou `parcelaSync`; o que faltava era **coletá-la** |
| parcela paga **antes** do sistema | `parcelasJaPagas: N` → `parcelas.origemBaixa = "HISTORICO"` | **sem estado novo e sem migration** |

⚠ **`HISTORICO` é vocabulário, não coluna.** `parcelaRowQuitada` (que só pergunta se há
`origemBaixa`) e `temEvidenciaDePagamento` já a enxergam: a prestação conta como **quitada**, entra
no risco como `quitada:true` e some de `parcelasSemEvidencia` — tudo sem uma linha nova de
derivação. Uma coluna `paga_historico` daria uma segunda resposta a uma pergunta que já tem uma.

⚠ **Ela NÃO gera `AccountingEntry`**, e não é omissão: não houve pagamento nosso para lançar, e a
provisão desta adesão reconhece o principal do saldo que **resta**.

⚠ **`baixadaEm` de uma `HISTORICO` é a data da DECLARAÇÃO, não a do pagamento** — essa não se sabe,
e preenchê-la com o vencimento contratado seria inventar dado.

⚠ **`formaPagamento` não decide atraso.** Fazer `GUIA_MENSAL` transformar "prestação vencida sem
guia" em inadimplência derivaria inadimplência de **ausência de dado** — exatamente o que
`recalculoParcelamento.js` se recusa a fazer, e o que acenderia RESCINDÍVEL em toda empresa cuja
captura simplesmente não rodou. Quem decide atraso continua sendo evidência de pagamento.

⚠ **Os 3 contratos de produção seguem com o cronograma no dia 1** (o modal nunca coletou
`diaPagamento`). `sincronizarParcelas` só **cria** as prestações que faltam — não move data de
prestação já gravada —, e a reingestão **deliberadamente não atualiza** `diaPagamento` no cabeçalho:
mudar o dia sem mover as linhas deixaria contrato e prestações discordando, com o atraso sendo
decidido pelas linhas. Recalcular é possível e é decisão do dono (ver o relatório da fase).

Regressão: `parcelamento/__tests__/parcelamentoSemGuia.test.js` (18).

⚠ **Prestação SEM EVIDÊNCIA não é inadimplente.** Materializar o cronograma e passar as parcelas
sem guia como `quitada:false` acenderia **RESCINDÍVEL em todo débito automático saudável** —
inadimplência derivada de ausência de dado (regra 1 ao contrário), e um alerta que acende sempre é
o que `riscoRescisao.js` já se recusa a produzir. Elas ficam **fora** do cálculo e viajam nomeadas
em **`parcelasSemEvidencia`**. Consequência aceita: parcelamento sem nenhuma guia continua com
`risco.avaliavel = false` — mas agora com `0 de 52` e o motivo explícito, não `0 de 0`.

⚠ **A bifurcação V1/V2 MORREU (F2.3).** Ela já tinha perdido o termo errado (era
`parcelas.length === 0 && guides.length > 0`, e o segundo fazia a **versão** depender de quantos
documentos tinham chegado); agora saiu inteira. O que ela custava era a **mesma rota devolver
semânticas diferentes com os mesmos nomes de campo**: no ramo V1 `parcelasPagas`/`parcelasTotal`
saíam do `statusPagamento` das linhas leves e `parcelasSemEvidencia` era zerado à força.

Hoje **todo** parcelamento conta igual: denominador = prestações **contratadas** (`parcelas`,
materializadas por `sincronizarParcelas` nos DOIS caminhos), numerador = **evidência** de quitação.
Consequência aceita: um V1 novo conta por evidência, não pelo `statusPagamento` da linha leve — e
não se perde nada, porque a única escrita daquele campo era `confirmParcelaPayment`, a rota órfã
removida na mesma fase.

### ⚠ `templatePaymentFunctionId` — a ESCRITA saiu; a COLUNA fica, aguardando drop

O campo virou write-only quando a F2.3 removeu `confirmParcelaPayment`, seu único leitor.
`createParcelamento` **parou de gravá-lo** e `listParcelamentos` **parou de carregar** a relação
`templatePayment` (que era o último leitor restante, e servia à tela um nome que nenhuma tela
consome). Passo 2, **decisão do dono**: *"para de gravar neste ciclo, dropa a coluna numa migration
separada depois do deploy estabilizar — não empilhe o drop na mesma janela"*.

- ⚠ **NÃO existe migration desta limpeza.** A coluna, a FK e a relação continuam no
  `schema.prisma`, marcadas com o motivo. Quem for dropar mexe em três pontos:
  `Parcelamento.templatePaymentFunctionId`, `Parcelamento.templatePayment` e o lado
  `ParcPaymentTemplate` de `AccountingFunction`.
- ⚠ **O parâmetro segue ACEITO e ignorado** em `POST /parcelamentos`: o modal V1 do front ainda o
  envia (e ainda **obriga** a escolher um template de pagamento). Recusá-lo transformaria uma
  limpeza interna em 400 numa tela que ainda existe.
- ⚠ **Os seeds `kind="PARCELAMENTO_PAYMENT"` NÃO morreram junto** — ver a linha do
  `ParcelamentoSeeds.js` na tabela acima. O que morreu foi o ponteiro do `Parcelamento` para eles.

- Derivação única: **`quadroDasParcelas`** + `parcelaRowQuitada` / `temEvidenciaDePagamento` /
  `SELECT_PARCELA_PARA_QUADRO`, em `parcelamento/recalculoParcelamento.js` (junto do `parcelaQuitada`
  que já existia, e **chamando-o** — a regra da IN RFB 2.063/2022 não foi reescrita).
- Materialização: **`parcelamento/parcelaSync.js`** (`sincronizarParcelas`, idempotente), chamada em
  `createParcelamento` e `ingestParcelamentoFromGuide` — esta última **também quando não há
  `guideId`**, que é o caminho SERPRO e o "parcelamento-first". `addMonths`/`buildDateOfMonth`
  mudaram de casa para lá (o mesmo calendário do V1 e das linhas de `parcelas`; duas cópias dariam
  dois vencimentos para a mesma obrigação).
- ⚠ `competenciaInicial = '1970-01'` é **sentinela**, não data (`ingestParcelamentoFromGuide` grava
  `compLabel || "1970-01"`). Dela não sai cronograma — as datas ficam nulas.
- Migration `20260808180000_add_parcela`: **não escreve em `"Guide"` nem em
  `"accounting_entries"`** (garantia estrutural, testada), e **aborta com `RAISE EXCEPTION`** se
  alguma guia de parcelamento ficar sem linha em `parcelas`.
- Regressão: `parcelamento/__tests__/parcelaComoEntidade.test.js` (19) e
  `__tests__/decorateParcelamentoBifurcacao.test.js` (4).

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

⚠ **A baixa genérica era o único ato contábil sem a trava.** `POST /entries/:id/baixa` grava até
três lançamentos e passava direto; hoje responde **409 `MES_FECHADO`** pela competência da **data do
pagamento**, igual INSS (`InssPagamentoService`) e parcela (`ParcelamentoV2Service`).

⚠ **`DELETE /entries/:entryId` também trava — e pela competência DO LANÇAMENTO, não a de hoje.**
Apagar lançamento de mês fechado muda os números do mês fechado sem nenhum rastro de reabertura; é
o mesmo estrago da criação, pelo caminho inverso. A assimetria é só a leitura da competência: na
criação ela vem da data digitada, no estorno já está gravada — perguntar pelo mês corrente deixaria
passar exatamente o caso que importa.

### ⚠ A trava do DELETE vale para **TODO** lançamento — e isso é INTENCIONAL

Está escrito aqui porque, de fora, "restringir a trava às baixas" parece uma correção de escopo
óbvia. Não é. **Decisão do dono:** *"qualquer DELETE em competência fechada corrompe um saldo que
já foi reportado"*. Não importa o tipo — baixa, despesa, receita, provisão: se o mês foi fechado,
os números dele saíram para fora, e apagar qualquer linha depois disso muda um total que alguém já
leu, sem nenhum sinal de que a competência foi mexida.

Os **dois** fluxos legítimos, e nenhum deles é afrouxar a trava:

1. **reabrir a competência** (o ato fica gravado em `CompanyMonthlyCircular`) e então corrigir;
2. **estornar na competência aberta** — `POST /entries/:entryId/estorno`, abaixo, que em mês
   fechado preserva o lançamento e gera contra-lançamento no mês corrente.

O mesmo aviso está no comentário da rota, em `routes/firm/accountingEntries.js`.

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

### ⚠ Como a regra estava furada na prática (e os quatro furos)

A regra existia, estava documentada e implementada — e o INSS em atraso continuava saindo em bloco.

1. **`papel` era descartado antes de ser lido.** `InssPagamentoService` remapeava as linhas do modal
   para `{conta, tipo, valor, ordem}` e **perdia o `papel`**; `separarPorPapel` então via toda linha
   sem papel, tratava tudo como principal, achava UM grupo e caía no lançamento único. O modal
   estava certo o tempo todo. Era a causa raiz.
2. **O worker de pagamento chamava sem linhas** (`SerproPaymentConfirmationService`), gerando um
   entry pelo **valor cheio da guia** — que em atraso já inclui juros e multa. Isso amortizava o
   passivo por mais do que foi provisionado. Hoje o **rateio do comprovante atravessa**
   (`gerarPagamentoInssFromGuide({rateio})`) e a separação existente faz o resto.
3. **`acr.contaJuros` sem optional chaining** no modal derrubava o pré-preenchimento com um
   `TypeError` engolido por um `.catch(() => {})` — quando o acréscimo vinha do comprovante e não da
   circular. Sem erro na tela: o contador via um modal "normal" com duas linhas.
4. **`if (!tpl) return`** descartava o comprovante inteiro em empresa sem folha lançada. Sem template
   falta só a CONTA; os valores continuam válidos.

⚠ **Guia paga em ATRASO sem rateio confiável NÃO gera lançamento** (`sem_rateio_do_acrescimo`).
`parseComprovanteArrecadacao` só devolve a quebra quando a soma fecha com o total; sem ela, dividir
o acréscimo entre 501 e 506 seria inventar. Pago em dia segue com um lançamento só — ali não há
acréscimo a separar. Decisão do dono, regra 5.

### ⚠ A baixa começa RESERVANDO a guia (senão duplica em corrida)

Vale para o INSS (`InssPagamentoService.gerarPagamentoInssFromGuide`) e para a parcela
(`ParcelamentoV2Service.gerarPagamentoParcelaFromGuide`), pelo mesmo motivo e com o mesmo código:
dentro do `$transaction`, **antes de qualquer lançamento**, um `updateMany` condicional em
`lancamentoId: null` grava `baixada/dataBaixa` e só segue se `count === 1`; o `update` final apenas
completa o `lancamentoId`.

As verificações de idempotência de cima (`guide.lancamentoId || guide.baixada` e a busca por uma
BAIXA com o mesmo `sourceGuideId`) são **check-then-act fora da transação** e continuam servindo só
para dar o motivo legível no caminho normal. Duas requisições simultâneas — duplo clique, ou o
`SerproPaymentConfirmationService` confirmando o pagamento no instante do clique do contador —
passavam AS DUAS por elas antes de qualquer uma escrever, e saíam **dois lotes amortizando o mesmo
passivo pela mesma guia**.

⚠ **O unique antigo não segura isso.** `(sourceGuideId, eventType)` foi desenhado para as PROVISÕES
(uma por tributo, cada uma com seu `eventType`) e continua valendo lá — `GuideToProvisionService`
faz a idempotência por ele. Os lançamentos de baixa nascem com `eventType` **NULL**, e no Postgres
NULLs são distintos em UNIQUE. O idioma da reserva já existia em `GuideLockService` e
`GuideLiberacaoService`. Regressão: `__tests__/baixaInssDuplicada.test.js` e
`parcelamento/__tests__/baixaParcelaDuplicada.test.js`.

### O cinto do banco por baixo da reserva (migration `20260808120000_add_baixa_tipo_linha`)

Por muito tempo a resposta foi "não dá para apertar o índice": os N lançamentos do lote
compartilhavam todas as colunas que identificariam a baixa, então qualquer índice sobre elas
recusaria o **segundo lançamento legítimo** — derrubaria a baixa inteira em vez de impedir a
duplicada. A premissa era verdadeira; o que faltava era uma coluna que **separasse as linhas do
mesmo lote**.

Ela já existia em `AccountingEntryLine` (`tipoLinha`/`codigoTributo`, Q21). Como cada lançamento de
baixa é de **uma perna só**, o papel da linha É o papel do lançamento — então os dois campos foram
denormalizados em `accounting_entries`:

```sql
CHECK  chk_baixa_tipo_linha : "tipo" <> 'BAIXA' OR "tipoLinha" IS NOT NULL           -- NOT VALID
UNIQUE uq_baixa_guia_linha  : ("sourceGuideId","tipoLinha",COALESCE("codigoTributo",''))
                              WHERE "tipo"='BAIXA' AND "sourceGuideId" IS NOT NULL
                                                   AND "tipoLinha" IS NOT NULL
```

- ⚠ **`COALESCE`, nunca a coluna crua.** Baixa de um tributo só (INSS, rota genérica) tem
  `codigoTributo` NULL — e NULLs distintos em UNIQUE são exatamente a porta por onde o `eventType`
  passava. Com o `COALESCE` as duas duplicatas colidem na primeira linha do lote.
- ⚠ **O CHECK vale no UPDATE também**, inclusive sobre linha antiga (é o que `NOT VALID` *não*
  isenta). Por isso a migration **faz o backfill** das baixas já gravadas — sem ele, exportar a
  competência ou editar uma baixa velha passaria a estourar 23514.
- ⚠ **Toda escrita de `tipo:"BAIXA"` tem de preencher `tipoLinha`.** Quem sabe o papel passa o papel
  (INSS, parcelamento V1/V2, `POST /entries/:id/baixa`, `scripts/separar-baixas-agrupadas.mjs`); os
  caminhos genéricos (`POST`/`PUT /entries`, import de OFX/Excel, `applyAccountingFunction`,
  templates de parcelamento) usam **`tipoLinhaDaBaixa()`** (`tipoLinhaBaixa.js`), cujo padrão é
  `TOTAL` — "lançamento inteiro, sem decomposição". Chamá-los de PRINCIPAL afirmaria que amortizam o
  passivo e que juros/multa estão em outro lugar, o que ninguém sabe.
- Isto é **cinto**, não substituto da reserva atômica: a reserva evita o trabalho perdido e dá o
  motivo legível; o índice é o que impede a linha de entrar se a reserva algum dia falhar.

⚠ **Uma guia tem até TRÊS baixas.** O `Map` por `sourceGuideId` na Circular guardava só a última, e
"Cancelar baixa" apagava um lançamento deixando dois órfãos com a guia reaberta. Hoje `baixas[]`
traz o lote inteiro (o principal primeiro) e o cancelamento leva todos.

### Estorno da baixa (`POST /entries/:entryId/estorno`) — transição administrativa

⚠ **A PORTA MUDOU.** O estorno era EFEITO do `DELETE /entries/:entryId`. Hoje é uma operação
nomeada, e o DELETE de uma baixa com vínculo responde **409 `USE_ESTORNO`** apontando a rota nova.
Sem essa recusa, a exigência do motivo seria contornável pelo verbo antigo. Serviço:
`EstornoBaixaService.js`.

| | rota | o que faz |
|---|---|---|
| conferência | `GET .../entries/:id/estorno/preview` | o lote inteiro **com valores**, o modo, a competência do contra-lançamento e o risco atual. Não escreve nada |
| execução | `POST .../entries/:id/estorno` | `{ motivo, totalConferido? }` |

**As três exigências:**

1. **Motivo obrigatório** (mín. 5 caracteres) → `400 MOTIVO_OBRIGATORIO`, checado **antes de
   qualquer leitura**. Auditoria em `EstornoBaixa` (`estornos_baixa`): quem, quando, por quê, o que
   foi desfeito (cópia do histórico/valor — no modo `DELECAO` a linha original some), o rastro de
   estado e o risco de rescisão do momento. É tabela, e não colunas no lançamento, exatamente
   porque no mês aberto o lançamento é apagado. `motivo` tem CHECK no banco.
2. **Mês fechado → contra-lançamento, nunca DELETE** (abaixo).
3. **Recálculo disparado** dentro da transação, depois das escritas: `recalcularParcelamento`
   (`parcelamento/recalculoParcelamento.js`) chama **`avaliarRiscoRescisao`** — a regra da
   IN RFB 2.063/2022 não é recalculada em lugar nenhum, é reusada. O predicado `parcelaQuitada`
   também mora lá e é o mesmo que `decorateParcelamento` usa.

**O estorno é do LOTE, sempre.** Uma baixa são até três (ou quatro) lançamentos; estornar um
deixaria os outros órfãos. O `totalEstornado` do preview volta no POST como `totalConferido`: se a
baixa mudou entre a tela e o clique (outra sessão, ou o worker de confirmação acrescentando o juros
ao lote), a resposta é **409 `CONFERENCIA_DIVERGENTE`** em vez de desfazer algo diferente do que foi
confirmado.

#### ⚠ Mês fechado: o contra-lançamento, e por que ele NÃO é `tipo:"BAIXA"`

Baixa em competência fechada **não é apagada**. O lançamento fica onde está e nasce um **espelho
invertido** (mesmas contas, mesmos valores, D↔C trocados) na competência **de hoje**. Sem isso, a
trava de mês fechado do DELETE viraria letra morta por esta porta lateral — o caminho fácil de
apagar lançamento de mês fechado sem rastro de reabertura.

A competência do espelho é a **de hoje**, não "a primeira aberta que eu achar": procurar um mês
aberto seria escolher a data de um fato contábil por conveniência. Mês corrente também fechado →
**409 `MES_CORRENTE_FECHADO`**, com o caminho na mensagem.

**O espelho é `tipo:"ESTORNO"`, e isso é o ponto mais delicado da fase.** Como `BAIXA` ele bateria
nas duas travas de `20260808120000_add_baixa_tipo_linha`:

| trava | o que aconteceria |
|---|---|
| `CHECK chk_baixa_tipo_linha` | passaria (o papel do espelho é o da linha original) |
| `UNIQUE uq_baixa_guia_linha` | **23505**. Em mês fechado a baixa original CONTINUA na tabela, e o espelho repete `(sourceGuideId, tipoLinha, codigoTributo)` — que é, letra por letra, a assinatura de uma baixa **duplicada**. O índice não tem como distinguir "a segunda baixa" de "o espelho da primeira" |

Afrouxar o índice reabriria a janela que ele fechou; inventar um papel (`ESTORNO_PARC`) seria mentir
sobre o papel da linha para escapar de uma trava. A saída é semântica: **o espelho não é uma
baixa** — baixa amortiza passivo, ele devolve passivo. Com `tipo:"ESTORNO"` as duas travas ficam
inertes **por construção** (ambas são parciais em `tipo='BAIXA'`), sem que nenhuma seja tocada.

⚠ **E não é só o índice: é a aritmética.** `computeSaldoProvisao` soma os débitos não-acréscimo de
tudo que pendura em `openEntryId` — e o espelho pendura lá de propósito, é o que devolve a provisão
ao aberto. Contado como baixa, o **débito de CAIXA** do espelho (`D caixa / C 553`) viraria MAIS
amortização e a provisão iria para o lado errado **em dobro**, sem erro nenhum na tela. A conta saiu
da fábrica de rotas para **`saldoProvisao.js`** (o estorno precisava da mesma) e agora separa por
`tipo`: baixa soma os débitos, estorno subtrai os créditos. Regressão em
`__tests__/saldoProvisaoEstorno.test.js`.

O espelho carrega `sourceGuideId` (rastreável a partir da guia — seguro, as travas são parciais) e
`parcelamentoId` (**obrigatório**: o lote do parcelamento só balanceia em GRUPO, e sem ele
`computeFechamentoBlockers` veria quatro lançamentos desbalanceados e travaria o fechamento
seguinte). `eventType` é **null** — só a baixa original carrega o evento, senão o segundo estorno do
mesmo evento no mesmo mês violaria `@@unique([portalClientId, competencia, eventType, origem])`.

#### F2.5 — o estorno DESPACHA PELA ÂNCORA DA BAIXA (um serviço só, sem irmão)

`EstornoBaixaService` reabria a **guia**. A F2.2 abriu uma segunda via de baixa
(`gerarPagamentoParcelaManual`, sem guia, ancorada na **parcela**, gravando
`parcelas.origemBaixa = "MANUAL"`) e o estorno **não a alcançava**: sem guia não há guia a reabrir,
`origemBaixa` não era limpo, e a prestação ficava baixada **para sempre** — fora da fila, com
`parcela_ja_baixada` a cada nova tentativa. É, letra por letra, o defeito que a F2.4 corrigiu do
lado da guia. Medido em produção antes de mexer: **zero** parcelas com `origemBaixa='MANUAL'` (111
parcelas, todas nulas) — não havia dado retroativo a tratar.

⚠ **A correção NÃO é um `EstornoBaixaParcelaService` ao lado** — seria reproduzir a estrutura que
gerou o bug (dois serviços que divergem na próxima invariante; o projeto já tem o precedente das
DUAS memórias de conta e das QUATRO cópias do filtro de envio). **Baixa e estorno operam sobre a
MESMA âncora, sempre.**

| âncora | quando | o que o estorno reverte |
|---|---|---|
| `GUIA` | `sourceGuideId` presente | reabre a guia (`baixada`/`dataBaixa`/`lancamentoId`/`parcelaEstado`) — caminho intocado |
| `PARCELA` | sem guia, com `parcelamentoId` | `parcelas.origemBaixa` → **null** e `baixadaEm` → **null** |
| `LANCAMENTO` | nem um nem outro (baixa genérica) | nada além dos lançamentos — decisão declarada, não `if` que não casou |

Os **lançamentos** são estornados igual nos três (deleção em mês aberto, contra-lançamento
`tipo:"ESTORNO"` em mês fechado), e o `recalcularParcelamento` roda depois, dentro da transação.

- **A fonte única é `ancoraBaixa.js`**: `ANCORAS`, `ORIGENS_BAIXA_PARCELA` (o vocabulário de
  `parcelas.origemBaixa`, com a âncora de cada via), `ORIGEM_BAIXA` (os valores que os **escritores**
  importam — `ParcelamentoV2Service` não grava mais o literal) e `ancoraDoLancamento(entry)`, que lê
  a âncora **do próprio lançamento**, nunca de um parâmetro.
- **O despacho é `EstornoBaixaService.REVERSORES`**, indexado pelas âncoras.
- ⚠ **O LOTE também passou a despachar.** `carregarLote` fazia `if (!sourceGuideId) return [entry]`,
  então a baixa sem guia era estornada **um lançamento por vez** — ela também nasce com até quatro
  (principal, juros, multa, caixa), e desfazer só o principal deixaria juros e multa no razão com a
  prestação já livre. Sem guia, o lote é reunido por `(parcelamentoId, numeroParcela)` + o
  `loteImportacao`.
- ⚠ **A prestação sem guia NÃO tem coluna de estado.** `parcelaEstado` mora na **guia** (a F2.1
  evitou a segunda cópia de propósito), então aqui não há `estadoAposEstorno` a chamar: o estado
  derivado **é** a ausência de `origemBaixa` (`parcelaRowQuitada` só pergunta isso), e limpá-la
  devolve a prestação ao que o calendário manda — de volta a `parcelasSemEvidencia`, nem quitada nem
  inadimplida.
- ⚠ **Atomicidade:** a limpeza roda **dentro da mesma transação** dos lançamentos, com `updateMany`
  condicional no `origemBaixa` lido no preview. `count !== 1` lança **`PARCELA_MUDOU`** de dentro da
  transação, e o Postgres desfaz tudo (outro estorno em paralelo, ou guia vinculada no meio).
- ⚠ **A prestação é procurada pelo que pode FICAR PRESO** — `origemBaixa` preenchido, casando
  `(parcelamentoId, numeroParcela)`; `guiaId` **fora** do filtro, porque a captura do SERPRO pode
  vincular uma guia depois da baixa por declaração e é justamente essa prestação que precisaria ser
  limpa. Três desfechos, três respostas: **uma** → limpa; **nenhuma** → segue (não há nada preso —
  é o V1 aplicado por template, que nunca escreveu em `parcelas`, e o estorno repetido; recusar
  seria obstruir correção legítima por falta de dado); **duas ou mais** → **409
  `PARCELA_NAO_IDENTIFICADA`** antes de qualquer escrita, porque escolher uma deixaria a outra
  baixada no cadastro e livre no razão para sempre.
- **Auditoria:** na âncora PARCELA, `parcelaEstadoAnterior` recebe o `origemBaixa` desfeito
  (`MANUAL`, …) e `parcelaEstadoNovo` fica nulo. Os dois vocabulários não colidem (os da guia são
  `PREVISTA`/`PAGA_A_CONFERIR`/…), e deixar a linha muda seria a auditoria não registrar nada
  justamente na via que não tem guia para contar a história.
- ⚠ **`HISTORICO` está fora do estorno, e o motivo é DADO** (`motivoNaoEstornavel` no registro): ela
  **não gera `AccountingEntry`**, então não há baixa a estornar — desfazê-la é corrigir a declaração
  de prestações já pagas na adesão.

**O contrato, não o caso:** `__tests__/estornoContratoOrigens.test.js` (20) itera
`ORIGENS_ESTORNAVEIS` **da fonte única** e exige de cada uma a mesma invariante — lançamentos
estornados (lote inteiro, nos dois modos), âncora restaurada por completo, auditoria gravada. Quem
acrescentar a via do SERPRO (`DETPAGTOPARC165`, que gravará `DEBITO_AUTOMATICO`) já está dentro da
parametrização; quem inventar uma **âncora nova sem reversor** vê vermelho até implementá-la.
Verificado por experimento (executado, não afirmado): desligando o ramo PARCELA de
`ancoraDoLancamento` — que é, linha por linha, o serviço de antes — o contrato fica **11 vermelhos**,
todos nas origens sem guia, e `GUIA` continua verde; acrescentando uma origem com âncora
desconhecida, **3 vermelhos**. Depois de cada experimento o código foi devolvido ao estado correto e
a suíte rodada de novo.

#### O estado da parcela: `ESTORNADA`

`estadoAposEstorno` **não pula mais** `podeTransicionar` — a máquina ganhou uma segunda tabela,
`TRANSICOES_ADMINISTRATIVAS`, e `podeTransicionar(de, para, { administrativa: true })`. Assim
"CONFIRMADA é terminal" continua **literalmente verdadeiro no fluxo de ida** (`TRANSICOES.CONFIRMADA
=== []`) e o desfazer é uma transição declarada, não uma exceção de código.

⚠ **O destino deixou de ser o calendário.** Voltar a `PREVISTA`/`EM_ATRASO` deixava a parcela
estornada indistinguível de uma que nunca foi paga: o rastro sumia no instante em que o estorno
acontecia. Hoje ela vai para **`ESTORNADA`**, que persiste — e continua na fila, porque a fila é
`baixada:false`, não `parcelaEstado`. É **intermediário**: sai para `PAGA_A_CONFERIR` num novo
pagamento. O relógio não o move (`estadoRecalculado` só toca `ESTADOS_EM_ABERTO`), e a reingestão
não o apaga (`podeTransicionar(ESTORNADA, PREVISTA)` é false).

⚠ **`CANCELADA` não volta, e agora isso é DADO**: ela simplesmente não está na tabela
administrativa.

### O que o estorno preserva do desenho anterior

⚠ **Os DOIS efeitos são necessários e independentes — não são alternativas.** A baixa de PARCELA
nasce com os dois vínculos (`openEntryId` = provisão de abertura do parcelamento · `sourceGuideId` =
a guia da parcela). Quando isto era um `if / else if`, o primeiro ramo comia o segundo: o lançamento
sumia e a guia continuava `baixada:true` com `lancamentoId` apontando para um registro apagado —
**`Guide.lancamentoId` não tem FK, ninguém o anula**. A parcela sumia da fila de pendentes (que
exige `baixada:false`) e `gerarPagamentoParcelaFromGuide` respondia `ja_baixada` **para sempre**:
nenhuma tela conseguia refazer aquela baixa.

⚠ **A guia só volta quando NÃO SOBRA nenhuma baixa dela.** Como são até três lançamentos, reabrir a
guia deixando um no razão criaria órfãos debitando contas de uma guia "não paga" — pior que não
reverter. Enquanto sobrar baixa, o que se corrige é o ponteiro `lancamentoId`. O estorno leva o lote
inteiro, mas a guarda continua: `tipo:"BAIXA"` no filtro é o que mantém o **contra-lançamento** fora
da conta (ele é `ESTORNO`), senão a guia nunca mais reabriria.

- **Pagamento:** só é desfeito quando `paymentStatusSource === "MANUAL"`. Confirmação do SERPRO
  fica — o dinheiro saiu; o que se desfaz é o lançamento, não o fato.
- **Provisão de abertura:** recalculada nos DOIS modos — na deleção porque as baixas sumiram, no
  contra-lançamento porque o espelho passou a subtrair.

Contas de acréscimo: **`contasAcrescimo.js`** (501 juros / 506 multa). Estavam escritas em quatro
lugares — rota, script, serviço e literal no front.

### ⚠ Parcela de parcelamento: "juros" é DUAS coisas, e só o código de receita separa

Dentro de UMA parcela convivem duas naturezas contábeis:

```
2089 IRPJ - Lucro presumido       163,40  32,66  14,52   ← dívida CONSOLIDADA sendo amortizada
0380 TJLP - IRPJ - Parcelamentos       -      -  11,78   ← encargo CORRENTE do mês
```

⚠ **A ADESÃO E A BAIXA ESTÃO DESALINHADAS DESDE 2026-08-12, E ISSO É CONHECIDO.** Leia as duas
funções juntas — o desalinhamento é silencioso: não gera erro, gera saldo errado.

| | regra até 2026-08-12 | regra de hoje |
|---|---|---|
| `linhasProvisao` (adesão) | **só o principal** — *"juros e multa vêm apenas da confirmação do pagamento, que vem do SERPRO"* | **`D principal · D juros · D multa / C soma`** — *"o juros da provisão precisa ser escrito"*, *"o parcelamento deve ter valor principal, juros, e valor juros + principal fechando a contrapartida"*, e a multa entra junto (*"geralmente lançamos juros e multa na mesma CONTA, mas podemos separar também, opcional"*) |
| `linhasPagamento*` (baixa) | debita `PARC` só pelo principal | **inalterada** |

Enquanto a provisão reconhecia só o principal, a baixa era a consequência necessária dela: o passivo
`PARC` (553) nascia valendo `principalTotal`, e debitar também multa e juros o levaria a **negativo**.
Com a provisão consolidada, a mesma baixa deixa **resíduo permanente igual a `juros + multa`** —
parcelamento quitado com saldo vivo em "Parcelamento a Pagar", para sempre.

⚠ **A BAIXA NÃO FOI ALTERADA DE PROPÓSITO: a decisão do dono descreveu a PROVISÃO, não a baixa.**
A consequência foi medida e levada a ele — não conserte por conta própria.
Medição (produção, 2026-08-12, `scripts/diag-residuo-provisao-consolidada.mjs`, só leitura):

| contrato | passivo pela regra nova | amortização (baixa pelo principal) | **resíduo** |
|---|---|---|---|
| ERISANGELA · PARCSN nº 2 | 13.370,04 | 10.615,23 | **2.754,81** |
| SINTROPIA · OUTRO nº 0211.…26-88 | 38.037,74 | 38.037,74 | 0,00 (juros/multa **não declarados** no cabeçalho — o encargo está gravado como principal) |
| SINTROPIA · PARCSN nº 1 · OUTRO nº 3 | 100,00 · 32.200,00 | idem | 0,00 (rescindidos, sem juros declarado) |

⚠ **O resíduo depende de POR ONDE a baixa entra, e a via da DECLARAÇÃO é pior.**
`gerarPagamentoParcelaManual` debita `PARC` por **`parcelas.valorPrevisto`**, que `parcelaSync` grava
como `valorParcelaReferencia ?? principalPerParcela` — o valor CHEIO da prestação, não o principal.
Medido nos mesmos 4 contratos: por essa via a ERISANGELA amortizaria 13.277,03 (resíduo 93,01), e a
SINTROPIA nº 1 amortizaria **10.000,00 contra um passivo de 100,00** (passivo a −9.900,00). Isso é
outro defeito (`principalPerParcela` guardando o valor cheio — ver `diag-provisao-parcelamento.mjs`),
e ele **agrava** o desalinhamento acima em vez de compensá-lo.

⚠ **A LEITURA foi consertada em 2026-08-12; a BAIXA continua intocada** — ver a seção
"`principalPerParcela` guarda DUAS coisas", logo abaixo. `parcelaSync.valorPrevisto` segue como
está, de propósito: mudá-lo muda o `D PARC` de `gerarPagamentoParcelaManual`, que é a baixa, e a
baixa é decisão do dono.

⚠ **Mesmo par, mesmo tropeço, sinal invertido:** já houve o caso oposto — provisão creditando o
consolidado com a baixa amortizando por principal+multa+juros, e depois a provisão virando só o
principal, com a baixa **furando o passivo para baixo**. É o mesmo par; muda quem está na frente.

**`linhasPagamentoDoComprovante`** faz `D PARC` = principal · `D MULTA` = multa · `D JUROS` = juros
do código-tributo **e** o total do TJLP · `C CAIXA` = a soma. No R1: `392,58 / 78,48 / 57,52 /
528,58`, onde os 57,52 são 29,54 de juros consolidados + 27,98 de TJLP.

**O que ele entrega além do caminho antigo**, já que TJLP e juros consolidados caem no mesmo papel:
o **código de receita real** em cada linha. `MapaContaTributo` indexa por `(tipoLinha,
codigoTributo)`, então dá para dar conta própria ao TJLP sem inventar papel. Pelo caminho antigo é
impossível — lá o `codigoTributo` gravado é o **nome** do tributo (`"DAS"`), um só para a parcela
inteira. E só roda **com o comprovante na mão**:

⚠ **Quem distingue as naturezas é o CÓDIGO DE RECEITA, e ele só existe no comprovante.**
`TributoParcela.codigoTributo` guarda o **nome** do tributo (`"DAS"` na base), porque
`serproParcelamentoMap.js:99` alimenta `codigoTributo` e `nomeTributo` do **mesmo** campo do SERPRO
(`x.tributo`). Sem comprovante não há separação possível, e supor qual parte é amortização seria
inventar lançamento — por isso o caminho antigo continua intacto em vez de "melhorado por palpite".

⚠ **Guia com `parcelamentoId` cujo comprovante NÃO é parcela não gera lançamento**
(`comprovante_nao_e_parcela`, com `warn`). Um DARF pago em atraso tem multa e juros exatamente como
uma parcela tem; baixar por engano amortizaria dívida que não foi paga.

A conta segue parametrizável sem papel novo: cada linha carrega o `codigoTributo`, e o
`MapaContaTributo` já indexa por `(tipoLinha, codigoTributo)` — dá para mandar o TJLP 0380 para
conta diferente da dos juros comuns. Parsing e classificação ficam em
`fiscal/serpro/parseComposicaoComprovante.js` e `classificarDocumentoArrecadado.js`.

### ⚠ `principalPerParcela` guarda DUAS coisas — e desde 2026-08-12 NINGUÉM a lê como principal

A coluna é `NOT NULL` e **não foi convertida nem renomeada** (o V1 depende dela). O que mudou é
quem a lê como se fosse o principal por prestação: ninguém.

| quem escreve | o quê |
|---|---|
| **V1** `ParcelamentoService:175,203` | `Number(principalPerParcela)` — o principal por prestação (o nome bate) |
| **V2** `ParcelamentoV2Service:~480` | `round2(parc.valorTotal)` — o valor **CHEIO** da prestação, marcado `// referência (campo legado obrigatório)` |

Medido em produção (`scripts/diag-provisao-parcelamento.mjs`): **4 de 4** contratos batem com
`valorParcelaReferencia` e **nenhum** com `principalTotal/numParcelas`. Ex.: ERISANGELA
`ppp = 323,83` · `principalTotal/N = 258,91` · a baixa real debitou **300,82** — três números para a
mesma pergunta, com o da tela discordando do razão.

**`decorateParcelamento` deriva o principal do CABEÇALHO** (`principalPorParcelaDoContrato` =
`principalTotal / numParcelas`) e devolve **`null` quando `principalTotal` não é confiável** — o
padrão "ausência nunca é resposta" que este projeto já aplica em `analitica`, `semFaturamento`,
`obrigatoriedadeEfd` e `conferenciaDoPassivoPorContrato`.

**`saldoRestante` SAIU, e no lugar dele há DOIS nomes** — porque eram duas perguntas:

| campo | pergunta | fonte | `null` quando |
|---|---|---|---|
| `saldoContratual` | quanto falta amortizar do **principal do acordo** | cabeçalho (`principalTotal − principalPago`) | sem `principalTotal` |
| `saldoPassivo` | quanto resta em **"Parcelamento a Pagar"** | razão — saldo credor do papel `PARC` (`saldoPassivoDasLinhasParc`, em `saldoProvisao.js`) | sem nenhuma linha `PARC` (contrato V1) |

A conta antiga (`max(0, totalValue − parcelasPagas × principalPerParcela)`) subtraía um principal de
um consolidado, com o principal saindo da coluna que no V2 guarda o valor cheio: ela nunca respondeu
nenhuma das duas.

⚠ **`saldoPassivo` sai de UMA query para a lista inteira**, não do `include` do cabeçalho: no V2 a
provisão são N lançamentos de **uma perna** e `aberturaEntryId` aponta só para o primeiro, então
`aberturaEntry.lines` traria um pedaço do passivo e a soma nasceria errada em silêncio. Os sinais
vêm do próprio lançamento (`C PARC` soma, `D PARC` subtrai), então baixa, estorno e rescisão já
entram certos sem caso especial. Ele **não é cortado em zero**: passivo negativo é o sintoma do
desalinhamento adesão × baixa descrito acima, e escondê-lo apagaria da tela o número que o denuncia.

⚠ **A BAIXA NÃO FOI TOCADA.** `parcelaSync` continua gravando
`valorPrevisto = valorParcelaReferencia ?? principalPerParcela`, que é o `D PARC` de
`gerarPagamentoParcelaManual`. Mudá-lo é mudar a forma do lançamento de baixa — **decisão do dono**.

⚠ **O wizard passou a enviar `header.valorParcela`** (o valor CHEIO de uma prestação). Ele era
VALIDADO no passo 2 e DESCARTADO no payload: sem guia e sem composição por tributo,
`buildDTOsFromManual` derivava o valor da parcela da soma dos tributos — **zero**. Daí a SINTROPIA
nº 1 com `valorParcelaReferencia = 0`, `principalPago` preso em zero e todas as prestações
recusadas com `sem_valor_previsto`. A ordem em `buildDTOsFromManual` é **prova → declaração**:
composição, depois `guide.valor`, e só então o valor digitado.

⚠ **Isto NÃO corrige dado já gravado.** Os contratos de produção continuam com o cabeçalho como
está; o que mudou é como ele é lido. Correção de cabeçalho é ato contábil e é do dono.

## "Mês sem faturamento" — as travas moram no service

`semFaturamento.js` → `marcarSemFaturamento({portalClientId, competencia, ok, userId, origem})`.

As duas recusas (`SEM_FATURAMENTO_COM_RECEITA`, `SEM_FATURAMENTO_CONFERENCIA_DIVERGENTE`) viviam
dentro do handler HTTP. Isso bastava enquanto o único caminho era o clique do contador — mas o
**extrato zerado do PGDAS-D passou a marcar sozinho**, e um caminho automático gravando direto no
Prisma nasceria sem nenhuma das duas.

- Recusa é **retorno**, não exceção: o caminho automático precisa seguir a captura normalmente
  depois de uma recusa.
- No automático, **`semFaturamentoPor: null`** — quem afirma é a declaração transmitida à Receita,
  não uma pessoa. Carimbar um usuário seria atribuir a alguém uma afirmação que ele não fez.

## Valor corrigido pelo contador manda

Ao editar o valor de um tributo na Circular, as LINHAS do lançamento acompanham (`edicaoManual` em
`generateEntriesFromCircular`). A regra que preserva o valor original vale só para o **recálculo
automático do SERPRO** (juros após vencimento). E, havendo baixa, o status é recalculado a partir
dela (`statusPelasBaixas`) — senão a provisão corrigida pra menor ficava eternamente PARCIAL com a
diferença "em aberto", e reeditar uma provisão paga a ressuscitava como ABERTO.
Legado: `scripts/corrigir-provisao-parcial.mjs`.

### ⚠ A guarda do DAS não distinguia JUROS de RETIFICADORA — e a fonte é `fonteValor`

Defeito relatado pelo dono: reconsultado o extrato depois de uma **retificadora**, *"para a receita
ele atualizou (…), mas o do imposto ele NÃO atualizou, mantendo o valor de antes"*.

**O ponto exato:** `AccountingEntryGeneratorService.js`, o ramo `if (event.eventType ===
"DAS_SIMPLES" && amountChanged && !edicaoManual)`. Ele preserva `data`, `historico` **e as LINHAS**
e só carimba `recalculated*`. É a única bifurcação por `eventType` do arquivo — por isso
**RECEITA_\* passa pelo ramo genérico** (que apaga e recria as linhas com o valor novo) e o DAS não.
A mesma resposta do SERPRO alimentava duas escritas com regras diferentes.

⚠ **O número novo era LIDO e descartado**, não ignorado por falta de leitura: ele fica gravado em
`recalculatedToValor`. É o que separa "não lê" de "lê e recusa".

| fonte do `dasTotal` | quem grava | o número é… | guarda |
|---|---|---|---|
| **`EXTRATO`** | `syncPgdasByCompetencia` — PDF da **declaração** (imposto APURADO) | a verdade declarada à Receita, inclusive na retificadora | **não morde** |
| **`GUIA`** | `capturePgdasGuideForCompany` — **documento de arrecadação** | depois do vencimento vem com juros/multa, que não são imposto do mês | **morde** |

A distinção **não** pode ser "o valor subiu": juros e retificadora são indistinguíveis pelo número.
⚠ **O default de `fonteValor` é `GUIA`** — chamada nova que não declare a fonte nasce com a guarda
ligada, nunca sobrescrevendo a provisão.

### ⚠ E a guarda era INCONDICIONAL na prática: o "valor anterior" vinha em DOBRO

`sumEntryLines` somava **as duas pernas** (D **e** C) de um lançamento balanceado. Logo
`amountChanged` (e `findChangedValue`) eram verdadeiros **sempre**, mesmo numa reconsulta idêntica:
`noop` era inalcançável e o DAS caía no ramo de recálculo a cada sincronia — as linhas do DAS eram
escritas **uma vez, na criação**, e nunca mais por caminho automático. Hoje é `valorDoLancamento`,
só os débitos (mesma leitura de `statusPelasBaixas`).

A assinatura do defeito está gravada em produção: `recalculatedFromValor` é **exatamente 2×** a soma
dos débitos em **55 de 89** provisões de DAS (ex.: ATIM 2026-02, `3.063,86 = 2 × 1.531,93`).

**Medição (12/08/2026, só leitura, `scripts/diag-retificadora-imposto.mjs`):** 119 circulares com
extrato · 15 com indício de retificadora · **12 lançamentos de DAS com valor divergente do extrato**
(2 deles em competência retificada) · **1** de receita divergente. Rode-o antes e depois de mexer
aqui. ⚠ **Ele não corrige nada** — acertar valor de lançamento já gravado é ato contábil do dono.

Regressão: `__tests__/retificadoraAtualizaImposto.test.js` (7), cuja metade exige que a guarda
**continue** mordendo no caminho da guia.

## Import de Excel — a memória GRAVAVA por uma chave e LIA por outra

`upsertHistoricoFromImport` grava o texto passando por **`normalizarHistorico`** (Q50): "PAGO INSS -
06/2026" vira `"PAGO INSS - {{competencia}}"`. A leitura (`findHistoricoMatches`) comparava com
**`normalizeMatchText`** cru, que só troca pontuação por espaço — e `{` e `}` estão na classe de
pontuação. As chaves ficavam `"pago inss competencia"` contra `"pago inss 06 2026"`: **nem o passo
exato nem o de substring casavam**, e o alvo era exatamente a descrição recorrente de tributo, a que
mais se repete mês a mês.

Hoje as duas pontas passam por **`chaveDeMatch`** (`excelImport.js:37`), que é
`normalizeMatchText(normalizarHistorico(texto))`. ⚠ **A ordem importa**: `normalizarHistorico`
primeiro, porque é ele que enxerga "06/2026" e "2026-06" com a pontuação ainda intacta. E é aplicada
nos **dois lados** (`:155` e `:175`) — o texto no banco já vem canônico desde a Q50, mas registro
anterior a ela tem a competência crua, e re-normalizar é idempotente.

⚠ **`historicoCompetencia.js` NÃO foi tocado** — a regra da competência é dele, e duas leituras dela
divergiriam no primeiro formato novo.

**Medido em produção (só leitura, `scripts/diag-match-historicos.mjs`), nos 230 registros da
memória:** achavam alguma memória **89 antes**, **230 depois** (+141), com **0 regressões**. Dos 230,
104 têm `{{competencia}}` e 91 têm dígito no texto. O script simula a descrição como ela viria no
arquivo (`aplicarCompetencia(text, competência)`) e roda as **mesmas duas passadas** do serviço com
a chave antiga e com a nova — rode-o de novo antes de mexer aqui.

### `historicoSugerido` — a coluna existia, as rotas é que não a devolviam

`AccountingHistorico.historicoSugerido` é o histórico **contábil** que o contador digitou; `text` é
só a **chave de match** (o memo do banco / a descrição da planilha). O OFX gravava os dois desde
sempre; o Excel chamava `upsertHistoricoFromImport` **sem** o campo — por isso ele estava vazio nos
**230 de 230** registros — e `GET /historicos` nem o projetava. Hoje as **duas** projeções irmãs o
devolvem (`routes/firm/accountingEntries.js:1991` e `:2031`); deixar uma delas sem o campo é como as
cópias divergem.

### `AccountingEntry.descricaoImportacao` — a descrição do arquivo ao lado do histórico

O commit do Excel gravava `historico: descricao`: o texto da planilha entrava no razão **como se
fosse** o histórico contábil, e a descrição original deixava de existir no INSERT. A coluna
(`schema.prisma:1079`, migration `20260810180000_add_descricao_importacao`) é **aditiva, nullable,
sem backfill** — lançamento antigo fica `null`, que é a verdade. `entryToResponse` faz `{...entry}`,
então ela chega ao front sem mapper.

⚠ **Isto NÃO muda a forma do lançamento** (nenhuma linha D/C, nenhum `tipoLinha`, nenhum valor).
Quem mexer em **como o histórico é composto** está mexendo em outra coisa, e isso exige pedido
explícito do dono.

⚠ **COMPATIBILIDADE:** payload **sem** `historico` continua caindo em `historico: descricao`
(`:3389-3390`) — cliente antigo não quebra, só deixa de aproveitar a separação. E o auto-save só
grava `historicoSugerido` quando o contador de fato escreveu algo (`:3452`); gravar a própria
descrição ali faria a memória sugerir a chave de match como histórico.

## A CONTA MÃE — `codigoCompleto` e o tri-estado `analitica`

O plano de contas guardava só o código **reduzido** (`"5"`, `"464"`), que no ERP **não carrega
hierarquia nenhuma** — medido no banco: ZERO pares mãe→filha detectáveis a partir dele. Não havia
como saber que `"5"` é `111010001 CAIXA - MATRIZ` (uma folha) e que outras contas são de agregação,
onde lançar é lançar num total.

| coluna | o quê |
|---|---|
| `chart_of_accounts.codigoCompleto` | o código completo do ERP — a "conta mãe" |
| `chart_of_accounts.analitica` | **derivado** dele: `false` = SINTÉTICA · `true` = analítica · **`null` = sem resposta** |

Migration `20260810200000_add_conta_mae_plano_de_contas`: **aditiva, nullable, sem backfill**.

⚠ **`null` NÃO É `false`.** Conta que ainda não foi reimportada não tem código completo e portanto
não tem resposta; `false` afirmaria que ela é sintética — e sintética sai da sugestão do dropdown de
lançamento. **Ausência nunca é resposta.** Todo leitor compara `=== false`, nunca `!analitica`.

### A regra é PURA e mora em `lib/derivacaoAnalitica.js` (14 testes)

Sintética = **existe outro código completo, MAIS LONGO, que começa com o dela**.
`chartOfAccountsAnalitica.js` é só a ligação com o banco (`rederivarAnaliticaDoEscopo`) — chamada
pelo import e pelas rotas de criar/editar/excluir conta, porque a derivação é **do escopo**, não da
linha: cadastrar `111010001` é o que torna `11101` sintética.

⚠ **UM ESCOPO POR VEZ** — global com global, empresa com a própria. Cruzar escopos afirmaria
parentesco entre planos diferentes. O erro possível tem **direção segura**: conjunto menor encontra
menos filhas, logo produz **menos** sintéticas — no limite deixa uma mãe na sugestão, que é o estado
de hoje. O erro caro (tirar da lista uma conta em uso) não é alcançável por conjunto pequeno.

### ⚠ A ARMADILHA DAS DUAS COLUNAS — por que o formato é DECLARADO, nunca inferido

No arquivo real do ERP (`completo;nome;reduzido;0;0;0`, **LATIN1**, sem cabeçalho, **593 linhas**)
**42 códigos existem NAS DUAS colunas e 41 apontam para contas DIFERENTES**:

```
"5" como reduzido → CAIXA - MATRIZ       "5" como completo → (-) IRPJ/CSLL (reduzida 590)
"2" como reduzido → ATIVO CIRCULANTE     "2" como completo → PASSIVO
```

As duas são só dígitos. Lidas na ordem errada, 41 contas vão para o lugar errado **sem erro nenhum**.
`detectFormat` declara a ordem pela forma da linha inteira. ⚠ O arquivo tem **SEIS** colunas — as
três últimas vêm zeradas (uma linha traz `2`), significado desconhecido, e por isso **não são lidas**.

### O import: casa pelo REDUZIDO, só ACRESCENTA, e MANTÉM o que não veio

⚠ **O reduzido é a IDENTIDADE e o import NUNCA o troca.** `AccountingEntryLine.conta` o guarda como
TEXTO, sem FK — trocá-lo orfanaria todo lançamento existente sem erro na tela. `codigo` não entra em
nenhum `data` de update, e isso é garantia, não descuido.

- **conta do banco fora do arquivo: MANTIDA como está** (decisão do dono) — nada apagado, inativado
  ou zerado. ⚠ E a contagem é **relatada** (`mantidas`, `semCodigoCompleto`): silêncio aqui faria um
  arquivo parcial passar por completo.
- **conta do arquivo fora do banco:** criada no escopo alvo (comportamento que já existia).
- **o import GLOBAL propaga** `codigoCompleto` para as contas **próprias** das empresas, casando pelo
  reduzido — decisão do dono (*"atualiza tudo, mantém"*). ⚠ Só essa coluna: nome/tipo/natureza da
  conta própria são dela. ⚠ E **não cria** conta dentro de empresa nenhuma — criaria 593 cópias por
  empresa. ⚠ O import **de uma empresa não propaga** para o global nem para as outras.
- **PDF não traz `codigoCompleto`** (o código de lá vem pontuado, `1.1.01`; derivar por prefixo sobre
  ele é outro problema, não medido). Fica nulo — que é a resposta honesta.

Testes: `__tests__/chartOfAccountsContaMae.test.js` (12).

### ⚠ O PORTÃO DE ACEITE: 4 contas EM USO saem SINTÉTICAS — e a regra está certa

`scripts/diag-conta-mae.mjs` (só leitura) simula o import contra o banco. Rodado em produção,
10/08/2026: **as colunas NÃO trocaram** (`5` = `111010001 CAIXA - MATRIZ`, **analítica**, 336
lançamentos), mas **4 dos 42 códigos em uso são contas de agregação de verdade** — `169`, `456`,
`365` (nível 5) e `357 RECEITAS` (nível **1**, completo `3`), somando **6 lançamentos**. Rode o
script antes de mexer aqui.

### ⚠ A TRAVA: conta sintética é RECUSADA no servidor (`lib/gateContaSintetica.js`)

Isto **era** só aviso de tela ("informa e não trava"). **A decisão foi revertida pelo dono**, e o
argumento não é de gosto: no leiaute da ECD (Manual do Leiaute 9, ADE Cofis nº 01/2026) o registro
**I250 (Partidas do Lançamento)** exige `IND_CTA = "A"` na conta do I050 — a REGRA_CONTA_ANALITICA,
repetida em I155, I250, I310 e I355. Descumprida, **o PGE do Sped Contábil gera erro** e a
escrituração não sobe. Permitir não era dar liberdade: era adiar a falha para a hora da entrega,
longe do lançamento que a causou.

- A regra é **pura** (`lib/gateContaSintetica.js`, 20 testes); a ligação com o banco é
  `recusaContaSintetica` em `routes/firm/accountingEntries.js`. Resposta: **400 `CONTA_SINTETICA`**,
  com `contas`, `candidatas` (as **filhas diretas** de cada uma) e a mensagem dizendo o motivo **e a
  saída**. Recusa muda é o defeito, não a recusa.
- ⚠ **Fica na ROTA, não no serviço** — mesmo critério de `contasInexistentes` e `MES_FECHADO`: a
  captura do SERPRO, os workers e os templates resolvem conta sozinhos e não podem ser derrubados no
  meio de uma sincronia. Gatilhos hoje: **`POST /entries`**, **`PUT /entries`** e os **commits de
  import** (`/entries/import/excel` e `/entries/import/ofx`).
- ⚠ **O IMPORT É GUARDADO PORQUE FOI POR ELE QUE A MAIORIA ENTROU:** dos 6 lançamentos em conta de
  agregação, **4 têm `origem: "EXCEL"`**. Lá a recusa é **por LINHA** (`failed[]` com
  `reason: "conta_sintetica"` e as contas) — derrubar 200 linhas boas por causa de 2 erradas seria
  trocar um defeito por outro. `sinteticasDoLote` resolve o lote inteiro em **uma query**.
- ⚠ **`POST /entries/folha` NÃO é guardado** — ali as contas vêm do template de folha
  (`resolverContasDespesaFolha`), não de digitação livre, e ele também não tem a guarda irmã de
  `conta_inexistente`. Fica como decisão do dono.
- ⚠ **`analitica: null` NUNCA recusa.** Conta ainda não reimportada não tem resposta, e recusar no
  desconhecido travaria o sistema inteiro até o import rodar. `=== false`, nunca `!analitica`.
- ⚠ **A TRAVA RECUSA A ENTRADA, NUNCA A PERMANÊNCIA.** No `PUT`, o que se compara é o que o payload
  **acrescenta** em relação às linhas já gravadas (`sinteticasIntroduzidas`). Sem isso os 6
  lançamentos que já existem em conta de agregação ficariam **presos**: todo `UPDATE` que tocasse a
  linha errada seria recusado — inclusive o `UPDATE` que existe para movê-los à analítica certa.
  Trocar a conta faz a sintética sumir do payload e passa; acrescentar uma nova recusa.
  Regressão: `routes/firm/__tests__/gateContaSintetica.test.js` (7).
- ⚠ **O import do plano JÁ RODOU em produção (12/08/2026)** — a linha anterior deste arquivo dizia
  que as 1.199 contas estavam com `analitica` NULL e que a trava não recusava nada; isso venceu.
  Medido depois do import: **1.199 contas · 254 SINTÉTICAS · 932 analíticas · 13 sem resposta**. A
  conta `5` saiu **analítica** (`111010001 CAIXA - MATRIZ`), como o portão de aceite exigia.
- **Inventário e correção dos 6:** `scripts/corrigir-conta-sintetica.mjs`, **dry-run por padrão**,
  com modo `--plano <csv>` que SIMULA o import (era o único jeito de ver os 6 antes dele; `--aplicar`
  é recusado nesse modo). Ele **não escolhe o destino** — é decisão do contador — e **recusa gravar
  em competência fechada**, apontando reabrir ou contra-lançar.

### ⚠ A trava NÃO alcança o caminho automático — quem fecha essa porta é a MEMÓRIA

A trava mora em `POST`/`PUT /entries` e nos commits de import. O **extrato do SERPRO gera
lançamento sozinho** (`generateEntriesFromCircular`) e **não passa por ela** — decisão de desenho, a
mesma de `MES_FECHADO`/`contasInexistentes`: worker não é derrubado no meio de uma sincronia. Com a
trava em produção e a memória apontando para sintética, o contador seria recusado na tela e o
extrato continuaria gravando em silêncio todo mês — pior que não ter trava.

**Decisão do dono (12/08/2026):** *"a guarda deve permanecer, o lançamento padrão é que deve mudar
de contas"*. Ou seja: a trava fica como está, sem exceção para o worker, e o conserto é a memória.

⚠ **Isso só é suficiente porque a memória é a ÚNICA fonte da conta nesse caminho — e isso foi
medido, não suposto.** A ordem em `AccountingEntryGeneratorService.js:314-329`:

| # | fonte | onde |
|---|---|---|
| 1 | `AccountingEntryRule` (empresa → global) — **VENCE a memória** | `resolveRule`, `:224-244` |
| 2 | `AccountingHistorico` (empresa → **GLOBAL**), por `eventType` | `lookupAccountsFromHistorico`, `:251-284` |
| 3 | `""` — conta em branco, o contador preenche e o auto-save aprende | `:328-329` |

**Não há default embutido.** `EVENT_DEFINITIONS` (`:16-51`) não tem conta nenhuma e `resolveRule`
devolve `debitAccountCode: null` na regra virtual; o comentário de `:53-55` ("Sem fallback
hardcoded") confere com o código. Evento sem definição vira `skipped: missing_rule`, que já acende
`hasAccountingDivergence` na circular.

Medido em produção em 12/08/2026 (`scripts/corrigir-memoria-conta-sintetica.mjs`, só leitura sem
`--mapa`): **0 `AccountingEntryRule` no banco** (nenhuma, nem global nem de empresa) · **0 linha de
`AccountingFunction`** em sintética (6 funções, 20 linhas) · **0 `MapaContaTributo`** em sintética
(12 registros). A memória era, de fato, a única fonte viva.

⚠ **`if (!debitConta && !creditConta)` (`:320`) é um E, não um OU:** regra que traga só UM dos lados
impede a consulta à memória e o outro lado nasce `""`. Não há regra em produção hoje; quem criar a
primeira precisa saber disso.

### ⚠ `EVENT_RULE_DEFAULTS` — o default do formulário aponta para uma SINTÉTICA (latente)

`routes/firm/accountingEntryRules.js:5-29` é servido por `GET /event-types` e preenche o corpo
omitido em `buildRuleData` (`:96`). Quem criar a regra aceitando o padrão grava **estas** contas — e
regra vence memória. Medido contra o plano global de hoje:

| evento | D | C |
|---|---|---|
| `RECEITA_SIMPLES` | `5` CAIXA - MATRIZ (analítica) | ⚠ **`301` PASSIVO NAO CIRCULANTE — SINTÉTICA** |
| `DAS_SIMPLES` | `401` DEMAIS BENS DO ATIVO (analítica) | `5` CAIXA - MATRIZ (analítica) |
| `BAIXA_DAS_SIMPLES` | (vazio) | (vazio) |

⚠ **Inerte hoje, e por dois motivos independentes** — não é motivo para deixar como está, é motivo
para não tratar como incêndio: não existe nenhuma regra gravada, e `RECEITA_SIMPLES` **não é emitido
por `buildEventsFromCircular`** (o gerador só emite `RECEITA_SERVICO`, `RECEITA_VENDA_SEM_ST`,
`RECEITA_VENDA_COM_ST` e `DAS_SIMPLES`). Basta uma regra criada pela tela para virar a primeira
fonte de conta sintética que a trava não alcança. ⚠ `301` como crédito de RECEITA e `401` (conta de
resultado de venda de ativo) como débito de provisão de DAS são de um plano anterior — **corrigi-los
é escolher conta, e isso é do dono.** Só a medição está aqui.

### A memória consertada — 3 de 8, e as 5 em que o script PAROU

`scripts/corrigir-memoria-conta-sintetica.mjs`, **dry-run por padrão**. Ele **não escolhe**: a
escrita exige `--mapa <sintetica>=<analitica>` **e** `--aplicar`; sem mapa é inventário. Recusa
destino inexistente ou não analítico (`analitica: null` não serve — não se move memória para o
desconhecido) e **não toca** em regra, template nem `MapaContaTributo`, que só mede.

⚠ **Eram 8, não 6.** As 6 conhecidas vinham do `corrigir-conta-sintetica.mjs`, que só olha os
códigos citados pelos lançamentos existentes. Varrendo as **230** memórias contra o plano inteiro
aparecem mais 2 (`C=360 RECEITA DE VENDAS`, evento `RECEITA_VENDA_SEM_ST`), de uma empresa **órfã**
(`portalClientId` sem `PortalClient`) — sem lançamento, e por isso invisíveis pelo outro caminho.

⚠ **Duas populações, dois leitores.** Só a memória **com `eventType`** alimenta
`lookupAccountsFromHistorico` (extrato do SERPRO, provisão de guia); a de `eventType` **nulo** é
casada por TEXTO e serve ao import de Excel/OFX — cujo commit **é** guardado pela trava, então ali o
erro aparece como `failed[] reason: conta_sintetica`, não em silêncio. Das 8: 3 com evento, 5 por
texto.

**Aplicado em 12/08/2026** com `--mapa 365=372,357=372` — destino dado pelo dono (*"a conta de
receita de prestação de serviço seria a 372"*), que é `311020007 DEMAIS RECEITAS DE PRESTAÇÃO DE
SERVICOS - MATRIZ`, a "DEMAIS" da família `31102`:

| escopo | evento / texto | antes | depois |
|---|---|---|---|
| KAIZEN ENGENHARIA | `RECEITA_SERVICO` | `D=365 C=5` | **`D=372 C=5`** |
| SINTROPIA | (texto) `VR REF RECEITA SERVIÇOS PRESTADOS` | `D=5 C=357` | **`D=5 C=372`** |
| **GLOBAL** | (texto) `VR REF RECEITA SERVIÇOS PRESTADOS` | `D=5 C=357` | **`D=5 C=372`** |

⚠ **A linha GLOBAL não se consertava sozinha** — `memorizeAccountHistorico` só a completa quando a
conta está VAZIA, então corrigir o lançamento pela tela nunca a reescreveria.

⚠ **372 já era o padrão de fato**: as memórias `RECEITA_SERVICO` de GL CONSULTORIA, PRISMA, KLAUS
NIGRO, ERISANGELA e TALBOT já eram `D=5 C=372`. A KAIZEN é que estava fora.

⚠ **E ela continua fora — o LADO não foi tocado, de propósito.** A KAIZEN ficou `D=372 C=5`
(débito em receita, crédito em caixa), o **inverso** das outras cinco. Trocar as contas de lado é
mudar a FORMA do lançamento [[nao-mudar-forma-lancamentos]] e exige pedido explícito. Está medido e
nomeado aqui; o conserto é do dono.

**As 5 em que o script parou, e por quê:**

| memória | conta | por que parou |
|---|---|---|
| SINTROPIA ×2 (texto: PRINTI, RAIA DROGASIL) | `456` `41102 DESPESAS GERAIS` | **45 analíticas**. Há uma `411020036 DESPESAS DIVERSAS`, mas com fornecedores nomeados jogar tudo em "diversas" é classificação, não estrutura (decisão do dono) |
| SINTROPIA (texto: FAST SHOP) | `169` `12308 EQUIPAMENTOS DE INFORMATICA` | filha **única** (`170`), destino mecânico — mas `372` é conta de RECEITA e não serve aqui; o comando é do dono |
| órfã ×2 | `360` `31101 RECEITA DE VENDAS` | 6 analíticas, **nenhuma "DEMAIS"**. É receita de VENDAS, não de prestação de serviço — `372` não a alcança |

### ⚠ A memória consertada NÃO preenche os 74 lançamentos em branco que já existem

São **74 linhas em 37 lançamentos**, todos RASCUNHO, `origem: SERPRO` com `eventType` — o caminho
legítimo (conta nasce vazia, é aprendida). A pergunta natural é se o próximo sync os preenche. **Não
preenche**, e o motivo é preciso: `findChangedValue` (`AccountingEntryGeneratorService.js:286-297`)
compara `tipo`, `circularId`, `ruleId`, `eventType` e a **soma das linhas contra o valor** — a
`conta` não entra na comparação. Sync com o mesmo valor devolve **`noop`** e as linhas nem são
tocadas; só o ramo `update` (valor mudou) faz `deleteMany` + `createMany` e as recria com a conta da
memória. Ou seja, a memória consertada vale para o lançamento **NOVO**; os 37 em branco continuam em
branco até alguém preenchê-los na tela (e aí o auto-save reaprende, agora do valor certo).

Medido junto: a memória que preencheria cada um. As de `RECEITA_SERVICO` já apontam `D=5 C=372` em
GL, PRISMA, KLAUS NIGRO, ERISANGELA e (por fallback GLOBAL) TALBOT e duas órfãs; as de `DAS_SIMPLES`
apontam `D=557 (-) DAS- SIMPLES NACIONAL / C=265`, ambas analíticas.

## Regras

- **Idempotência** em geração (upsert por competência/eventType; guardas antes de criar).
- Nunca somar `tipo="PARCELA"` nem lançamentos `EXPORTADO` que não devam mudar.
- Isolamento multi-tenant: sempre `portalClientId`.
- Contas em branco são esperadas no 1º mês — a memória preenche as próximas.
