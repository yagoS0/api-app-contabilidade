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
| fila de pendentes (`/parcelamentos/parcelas-pendentes-baixa`) | varre `prisma.guide` | varre `prisma.parcela` (guia no join) |
| fila de conferência (`listarConferenciaParcelas`) | varre `prisma.guide` | idem |
| recálculo de atraso (`recalcularEstadosParcelasEmAberto`) | varre `prisma.guide` | idem, + `semGuia` |
| `recalcularParcelamento` | `parcelasTotal: guides.length \|\| numParcelas` | `quadroDasParcelas` |

⚠ **A tabela NÃO duplica o estado de pagamento.** Não há `baixada` nem `paymentStatus` nela.
Enquanto o caminho de baixa for por guia (`gerarPagamentoParcelaFromGuide` exige `guideId` na
assinatura, na guarda `sourceGuideId` e no efeito em `guide.baixada`/`lancamentoId` — a **F2.2**),
quem responde "foi quitada?" é a **guia**. Aqui mora o **contrato** (quais prestações existem,
quando vencem); lá mora o **fato**. Uma cópia divergiria no primeiro estorno.

⚠ **`origemBaixa` é onde se grava a quitação de uma parcela que nunca teve guia.**
`parcelaRowQuitada` já a lê — quem grava muda **uma escrita**, não as derivações.

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

⚠ **QUEM MANDA NA BAIXA É A REGRA DA ADESÃO.** `linhasProvisao` reconhece **só o principal**
(decisão do dono: *"juros e multa vêm apenas da confirmação do pagamento, que vem do SERPRO"*), então
o passivo `PARC` (553) nasce valendo `principalTotal`. Segue daí que **só o principal pode
amortizá-lo**: debitar também multa e juros levaria o passivo a **negativo** ao longo do contrato.
Multa, juros consolidados e TJLP são todos **despesa do mês do pagamento** — nenhum foi reconhecido
na adesão.

Consequência aceita e decidida: o passivo passa a registrar o **principal**, não a dívida
consolidada do contrato. O balanço deixa de espelhar o valor assinado no acordo.

⚠ **Este par já esteve desalinhado, e o efeito é silencioso.** Enquanto a provisão creditava o
consolidado, a baixa amortizava por principal+multa+juros e fechava; quando a provisão passou a
reconhecer só o principal, a mesma baixa passou a **furar o passivo para baixo**. As duas funções
têm de ser lidas juntas — mudar uma sem a outra não gera erro, gera saldo errado.

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

## Regras

- **Idempotência** em geração (upsert por competência/eventType; guardas antes de criar).
- Nunca somar `tipo="PARCELA"` nem lançamentos `EXPORTADO` que não devam mudar.
- Isolamento multi-tenant: sempre `portalClientId`.
- Contas em branco são esperadas no 1º mês — a memória preenche as próximas.
