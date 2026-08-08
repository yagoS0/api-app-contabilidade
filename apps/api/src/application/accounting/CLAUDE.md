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
| `parcelamento/ParcelamentoV2Service.js` | parcelamento v2 (Q21/Q23). **Q23 — gatilho do SERPRO:** a 1ª parcela é **manual** → `ingestParcelamentoFromGuide` cria **só a PROVISÃO** (≥3 linhas: D=principal, D=juros, C=total; `provisaoLines` editadas no modal ou `linhasProvisao` padrão; contas via `MapaContaTributo`, em branco até aprender) + vincula guia + `TributoParcela`. **NÃO** cria pagamento. A provisão setar `aberturaEntryId` ⇒ **ativa a busca automática** do worker. O **pagamento** (BAIXA, juros LIDO) é gerado por `gerarPagamentoParcelaFromGuide` ao marcar a guia como **paga** (`confirm-payment`), data = dia do clique; **bloqueia** se o mês estiver fechado. `resolverContasProvisao` pré-preenche o modal. Memória: `memorizeMapaContaTributo`. ⚠ A baixa começa **reservando a guia** (`updateMany` condicional em `lancamentoId: null`, dentro da transação) — é o que impede baixa DUPLICADA em corrida; as duas verificações de idempotência de cima são check-then-act e só servem para dar o motivo legível. |
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

⚠ **A baixa genérica era o único ato contábil sem a trava.** `POST /entries/:id/baixa` grava até
três lançamentos e passava direto; hoje responde **409 `MES_FECHADO`** pela competência da **data do
pagamento**, igual INSS (`InssPagamentoService`) e parcela (`ParcelamentoV2Service`).

⚠ **`DELETE /entries/:entryId` também trava — e pela competência DO LANÇAMENTO, não a de hoje.**
Apagar lançamento de mês fechado muda os números do mês fechado sem nenhum rastro de reabertura; é
o mesmo estrago da criação, pelo caminho inverso. A assimetria é só a leitura da competência: na
criação ela vem da data digitada, no estorno já está gravada — perguntar pelo mês corrente deixaria
passar exatamente o caso que importa.

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

### Estorno da baixa (`DELETE /entries/:entryId`) — devolver a guia à fila

⚠ **Era um `if / else if`, e o primeiro ramo comia o segundo.** A baixa de PARCELA nasce com os
DOIS vínculos (`openEntryId` = provisão de abertura do parcelamento · `sourceGuideId` = a guia da
parcela), então casava só o ramo do `openEntryId` e **nunca chegava** ao que reabre a guia. O
lançamento sumia e a guia continuava `baixada:true` com `lancamentoId` apontando para um registro
apagado — **`Guide.lancamentoId` não tem FK, ninguém o anula**. A parcela sumia da fila de
pendentes (que exige `baixada:false`) e `gerarPagamentoParcelaFromGuide` respondia `ja_baixada`
**para sempre**: nenhuma tela conseguia refazer aquela baixa. Os dois efeitos são independentes e
os dois são necessários — não são alternativas.

⚠ **A guia só volta quando NÃO SOBRA nenhuma baixa dela.** Como são até três lançamentos, reabrir a
guia ao apagar o primeiro deixaria dois órfãos debitando contas de uma guia "não paga" — pior que
não reverter. Enquanto sobrar baixa, o que se corrige é o ponteiro `lancamentoId`. (O front já
apaga o lote inteiro, em sequência; a regra não depende disso.)

- **Estado da parcela:** `estadoAposEstorno` (`parcelamento/parcelaStateMachine.js`) devolve a
  parcela ao estado do CALENDÁRIO (a vencer × vencida). Ele **não passa** por `podeTransicionar` de
  propósito: aquela tabela descreve o caminho para a frente (`PAGA_A_CONFERIR` só avança para
  `CONFIRMADA`/`DIVERGENTE`), e estorno é rebobinar, não avançar. `CANCELADA` não volta.
- **Pagamento:** só é desfeito quando `paymentStatusSource === "MANUAL"`. Confirmação do SERPRO
  fica — o dinheiro saiu; o que se desfaz é o lançamento, não o fato.

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
