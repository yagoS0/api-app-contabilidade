# DRE gerencial + Fluxo de caixa — fundamentação do dono, medição e desenho

> Arquivo PRÓPRIO desta frente. **Não escreve em `application/accounting/CLAUDE.md`** de propósito:
> aquele bloco estava em uso por outra sessão (plano de contas / contas de caixa) quando isto foi
> escrito. Quando as duas frentes se encontrarem, o ponteiro entra lá — não o texto.
>
> Estado: **FASE 0 (medir) concluída em 22/08/2026. NADA foi construído.** Nenhuma linha de código de
> produção foi escrita ou alterada; os únicos arquivos novos são scripts de diagnóstico **só de
> leitura** (listados no fim).

---

## 1. A fundamentação do dono, literal (21/08/2026)

> "**receita**: no simples nacional trazemos a receita do extrato, essa será a confirmação correta da
> receita.
> **Impostos**: vem também do extrato no caso do simples nacional, use como fonte de dado os
> lançamentos contábeis.
> **Despesas**: use os lançamentos contábeis, aqui precisamos de uma inteligência para definir aquilo
> que é frequente, e que pode ser sugerido no fluxo de caixa futuro com aquilo que não é, pode ser
> pela repetição por exemplo.
> **funcionamento geral fluxo de caixa**: dentro do mês validamos as notas que são buscadas e através
> delas fazemos uma provisão daquilo que deve ser pago de imposto, através de cálculo. exemplo,
> estamos em junho, dentro do mês, o imposto do mês passado do nosso cliente deu 10.000,00 e faturou
> 100.000,00 — informações retornadas do serpro; esses 10.000 devem ser pagos até o dia 20. para o mês
> de julho já podemos supor que ele vai faturar 100.000 e ter 10.000 de impostos. caso as notas
> emitidas no mês de junho se alterem e pelo cálculo já tenha passado, ajustamos e geramos no portal
> do cliente algum tipo de aviso dessa informação: 'esse mês você já faturou mais que o mês anterior'
> etc."

E sobre o DRE:

> "a DRE que queremos fazer é apenas **gerencial, não fiscal**, apenas para que o dono ou adm da
> empresa, financeiro etc possa analisar as métricas da empresa mais facilmente. então deve ser uma
> DRE **fácil de entender, com subtipos** — exemplo: despesas gerais; ao clicar abre os tipos de
> despesas gerais, pagamento a terceiros, etc."

⚠ **A forma dos lançamentos contábeis NÃO muda por causa desta frente.** O DRE e o fluxo de caixa
**leem** a contabilidade. Alterar estrutura de lançamento exige pedido explícito do dono (regra já
gravada no projeto).

---

## 2. O que a medição mostrou (22/08/2026, produção, só leitura)

Escala: 34 empresas · 1.199 contas (593 globais) · 632 lançamentos · 1.106 linhas · 148 circulares ·
22 `ApuracaoSnapshot` · 258 guias. **22 empresas têm lançamento**; 18 têm movimento em caixa/banco.

### 2.1 A árvore do DRE existe, e é de cinco níveis

`codigoCompleto` tem larguras **1 → 2 → 3 → 5 → 9**, e **toda conta analítica está no nível 9**;
tudo mais curto é sintético. É exatamente a árvore de "subtipos" que o dono pediu.

```
4     DESPESAS                                3     RECEITAS
 41   DESPESAS OPERACIONAIS                    31   RECEITAS OPERACIONAIS
  411 DESPESAS ADMINISTRATIVAS                  311 RECEITA BRUTA DE VENDA E PRESTACAO DE SERVICOS
   41101 DESPESAS COM PESSOAL                    31101 RECEITA DE VENDAS
   41102 DESPESAS GERAIS   ← o exemplo do dono   31102 RECEITAS DE PRESTACAO DE SERVICOS
   41103 DESPESAS TRIBUTARIAS                   312 RECEITAS FINANCEIRAS
   41104 DESPESAS FINANCEIRAS                  32   OUTRAS RECEITAS OPERACIONAIS (7 subgrupos)
   41105 DEPRECIACAO E AMORTIZACAO             33   (-) DEDUCOES DE RECEITAS
 42   CUSTOS OPERACIONAIS                       331 (-) DEDUCOES DE RECEITAS
  421 CUSTOS OPERACIONAIS                        33101 DEVOLUCOES DE VENDAS E SERVIÇOS
   42101 CUSTO DE MERCADORIA VENDIDA             33102 ABATIMENTOS E DESCONTOS CONCEDIDOS
   42102 CUSTO DA PRESTACAO DE SERVICOS          33103 IMPOSTOS INCIDENTES  ← o DAS mora aqui
```

Contas por ramo: grupo 3 = 144 contas (102 analíticas) · grupo 4 = 274 (242) · grupo 5 = 12 (4).

### 2.2 ⚠⚠ **O IMPOSTO DO SIMPLES É DEDUÇÃO DE RECEITA, NÃO DESPESA — e isso já está decidido pelo dado**

Medido nos lançamentos reais: a provisão do DAS debita **`557` → `331030009 (-) DAS- SIMPLES NACIONAL`**
(64 linhas, R$ 175.717,54) e credita **`265` → `211050016 DAS - SIMPLES NACIONAL A RECOLHER`**.
Ou seja, o DAS **nunca** encosta no grupo 4. O mesmo para PIS (`331030005`), COFINS (`331030006`) e
ISS (`331030004`) do Presumido; IRPJ e CSLL vão para o grupo **5** (`511010001`/`511010002`).

**Não é preciso perguntar ao dono onde o imposto entra no DRE — a contabilidade dele já responde.**
Um DRE que somasse o DAS em "Despesas tributárias" (41103) contradiria o razão.

### 2.3 As contas que NÃO têm grupo — 10 pares, e são **todos** conta EM BRANCO

| situação | pares empresa×conta | linhas | valor |
|---|---|---|---|
| OK (tem `codigoCompleto` e grupo 1–5) | 149 | 1.030 | R$ 9.508.568,92 |
| **EM_BRANCO** (`AccountingEntryLine.conta = ''`) | **10** | **76** | **R$ 687.355,94** |
| FORA_DO_PLANO | 0 | 0 | — |
| SEM_CODIGO_COMPLETO | 0 | 0 | — |
| GRUPO_DESCONHECIDO | 0 | 0 | — |

⚠ **Toda a "não classificação" de hoje é UMA causa só: linha com conta em branco.** Ela é estado
LEGÍTIMO (provisão de guia nasce sem conta) e vale **7,2% de todo o dinheiro lançado**, em 10 das 22
empresas. O maior pedaço é **receita**: `RECEITA_SERVICO` com conta vazia soma R$ 321.822,26 (20
linhas D + 20 C) e `DAS_SIMPLES` com conta vazia soma R$ 20.274,56.

⚠⚠ **Um DRE que filtre por grupo faz R$ 687 mil desaparecerem sem erro nenhum.** É por isso que a
linha "Não classificado" é obrigatória — e ela não é uma sobra: é onde a receita da empresa que ainda
não escolheu conta aparece.

Por empresa (as 10): LIFAT R$ 395.088,42 · TALBOT R$ 61.588,00 · KLAUS NIGRO R$ 51.558,40 ·
ERISANGELA R$ 51.234,98 · PHAOS R$ 34.980,00 · GL R$ 34.556,00 · KAIZEN R$ 32.927,84 · PRISMA
R$ 22.260,00 · KODA BEAR R$ 1.872,00 · EDUCACAO E DIREITO R$ 1.290,30.

### 2.4 ⚠ A premissa "`DESPESA` por descarte da importação" **NÃO se confirmou nos dados**

O risco no código é real: `chartOfAccountsImport.tipoFromCodigoPadrao` termina em `return "DESPESA"`,
então todo código cujo 1º dígito não seja 1–5 vira DESPESA em silêncio. **Só que na base isso não
aconteceu com ninguém**: das **286** contas `tipo = DESPESA`, **286 têm `codigoCompleto` começando em
4 ou 5**. Zero incoerentes, zero sem `codigoCompleto`.

As **13** contas sem `codigoCompleto` são todas de UMA empresa (ALBATROZ), todas `PASSIVO` ou
`PATRIMONIO` (empréstimos de sócio, distribuição, capital social), **e nenhuma delas tem uma única
linha de lançamento**. Elas não afetam DRE nenhum hoje.

**Conclusão para o desenho:** o descarte continua sendo armadilha a fechar no import, mas **não há
massa a corrigir** e o DRE não precisa de rede contra ele. Precisa da rede contra a conta em branco,
que é onde o dinheiro está.

### 2.5 ⚠ A prática do dono na baixa **se confirma** — mas há um caminho sem prova

Dono: *"quando damos uma baixa em um pagamento sempre colocamos a data do pagamento"*.

| | lançamentos | data == dia da digitação |
|---|---|---|
| BAIXA | 66 | **8 (12,1%)** |
| DESPESA | 155 | 0 |
| RECEITA | 93 | 0 |
| PROVISAO | 134 | 0 |
| FOLHA | 184 | 0 |

Nas baixas, **58 de 66 têm data ANTERIOR ao dia em que foram digitadas** e **48 de 66 caem em mês
diferente do da digitação** — defasagens de 14 a 190 dias. A prática está no dado.

⚠ **Mas o controle contra o comprovante do SERPRO falha:** das 30 baixas com guia, só **2** guias têm
`extracted.comprovante.dataArrecadacao`, e nas **duas** a data do lançamento **diverge** da data de
arrecadação. Amostra pequena demais para acusar, grande demais para ignorar.

**Os caminhos que caem em "hoje" quando ninguém informa a data** (`dataPagamento ? new Date(...) : new Date()`):

| caminho | arquivo:linha | quem chama | risco hoje |
|---|---|---|---|
| `gerarPagamentoInssFromGuide` | `application/accounting/InssPagamentoService.js:133` | rota `POST /guides/:guideId/inss-baixa` **exige `data` no body** · worker PAGTOWEB passa `comprovante?.dataArrecadacao \|\| undefined` | worker está OFF (`SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED` não definida) |
| `gerarPagamentoParcelaFromGuide` | `application/accounting/parcelamento/ParcelamentoV2Service.js:933` | rota `POST /parcelamentos/parcelas/:guideId/baixa` — **este é o caminho JÁ CONSERTADO**: lê `guia.extracted.comprovante.dataArrecadacao` e só aceita data declarada junto da composição | coberto |
| `gerarPagamentoParcelaManual` | `application/accounting/parcelamento/ParcelamentoV2Service.js:1176` | rota `POST /parcelamentos/parcelas/:parcelaId/baixa-manual` — `dataPagamento` é **opcional** no body | ⚠ **omitir o campo grava a baixa no dia do clique**, sem aviso. É a débito automático, que não tem comprovante nenhum |
| `POST /entries/:entryId/baixa` | `routes/firm/accountingEntries.js:3217` | modal da Circular | exige `data` (400 `data_invalida`), mas **não confere contra o comprovante da guia** |

⚠ **O caminho a nomear é `gerarPagamentoParcelaManual` / `POST .../parcelas/:parcelaId/baixa-manual`:**
é o único em que a ausência do campo produz silenciosamente a data de hoje, e é exatamente o cenário
"parcela paga em 20/03 lançada em 05/04" que o conserto irmão já resolveu na rota vizinha.

### 2.6 Partida dobrada fecha — e o desbalanço por lançamento é DESENHO

- **135 competências** (28 fechadas contabilmente, 107 abertas): **ZERO** com Σ débitos ≠ Σ créditos.
- **144 lançamentos individuais** com D≠C. ⚠ **Todos são de PERNA ÚNICA** (só débito ou só crédito) —
  90 FOLHA só-crédito + 45 FOLHA só-débito, mais 9 de PROVISAO/BAIXA com papel marcado. **Nenhum**
  tem D e C que não fecham. É a forma de lançamento decidida pelo dono (juros/multa/principal em
  lançamentos independentes, folha em pernas separadas), não defeito.
- ⚠ **9 lançamentos SEM NENHUMA LINHA**: todos da SINTROPIA, todos `tipo=PROVISAO`,
  `origem=TEMPLATE`, `status=RASCUNHO`, histórico *"Provisão VR REF ISS 04/2026 — aguardando"*,
  espalhados de 2026-01 a 2026-12. São rascunhos de template, não lançamentos. **O DRE não pode
  somá-los nem apagá-los da vista** — eles têm zero valor e existem.

**Invariante para o DRE: a checagem é POR COMPETÊNCIA, nunca por lançamento.** Um DRE que recusasse
competência com lançamento desbalanceado recusaria toda empresa com folha.

### 2.7 Caixa e banco: 18 empresas, desde 2026-01

Medido por duas vias que **coincidem exatamente** (18 empresas, 18 pares, 341 linhas): (a)
`codigoCompleto LIKE '11%'` e (b) nome contendo CAIXA/BANCO/BCO — que é como
`InssPagamentoService.resolveCaixaAccount` decide hoje. Na prática todo mundo usa **`5` →
`111010001` CAIXA - MATRIZ**.

Maiores: SINTROPIA 157 linhas (2026-04→2026-08) · LENTE 30 (2026-01→2026-12) · ERISANGELA 29 ·
CDA 25 · ALESSANDRO 15. ⚠ Há movimento com data **futura** (IOHANNA até 2027-02, LENTE/CDA até
2027-01) — provisões lançadas para frente, não erro de digitação; um fluxo de caixa tem de decidir
o que fazer com elas.

⚠ **A identificação definitiva de conta de caixa é de outra sessão.** Aqui só se mediu.

### 2.8 Extrato do PGDAS-D: 121 competências têm, 27 não — e "não ter" não é zero

148 circulares em 32 empresas. `receitaBruta` e `dasTotal` preenchidos em **121**; nulos em **27**.
`serproSyncStatus`: SUCCESS 104 · nulo 28 · ERROR 9 · NOT_FOUND 7. 107 têm nº de declaração,
10 estão declaradas `semFaturamento`, 41 estão fechadas contabilmente.

12 empresas têm **100% do intervalo sem extrato** (SINTROPIA 4/4, KODA BEAR 2/2, SANTA ALEGRE 2/2,
DIAGONAL, ALBATROZ, AVANZZA, GUTIERREZ, SINCROSAT, LBTEC, BEAN, GAIA, MAMEVE, ARENA DZ9).

⚠⚠ **E há 53 células empresa×competência em que existe NOTA AUTORIZADA e o extrato não confirma:**

- **41 sem extrato nenhum**, incluindo SINTROPIA (2026-01 a 2026-08, R$ 447 mil a R$ 788 mil por mês,
  até 2.711 notas/mês), SANTA ALEGRE (R$ 32 mil a R$ 405 mil), SINCROSAT (R$ 32 mil a R$ 54 mil).
- **12 com extrato `receitaBruta = 0,00` E notas autorizadas.** Cinco delas são a **CDA MARKETING**,
  com `serproSyncStatus = SUCCESS`, número de declaração gravado **e `dasTotal` > 0** (R$ 403,57 a
  R$ 754,84) sobre "receita zero". ⚠ A CDA é justamente a empresa que este projeto já registrou como
  declarando receita **EXTERNA** (`ApuracaoConfigMemory` com `mercado=EXTERNO`) — **a hipótese é que
  `receitaBruta` da circular capture só a receita INTERNA. NÃO ESTÁ PROVADO. É pergunta para o dono.**
- 1 divergência de valor: LENTE 2026-06, extrato R$ 107.600,00 × notas R$ 114.600,00.

⚠⚠ **Isto derruba parcialmente a fundamentação "a receita vem do extrato, essa será a confirmação
correta".** Ela vale onde o extrato existe e é diferente de zero — **66 células batem exatamente com
as notas**, o que é forte. Mas em 53 células o extrato não pode confirmar nada, e em 5 delas ele
afirma zero contra R$ 12 mil a R$ 35 mil de notas autorizadas. **Ausência de extrato ≠ receita zero;
e extrato ZERO com nota autorizada também não é receita zero.**

### 2.9 ⚠⚠ **ACHADO PRINCIPAL — o vencimento do DAS está gravado e não chega à coluna**

O dono diz *"esses 10.000 devem ser pagos até o dia 20"*. A orientação de usar `Guide.vencimento` em
vez do dia 20 está certa. **Só que a coluna está vazia em 105 das 127 guias de SIMPLES.**

| tipo | status | guias | sem `vencimento` |
|---|---|---|---|
| SIMPLES | PROCESSED | 67 | **51** |
| SIMPLES | VAZIO | 54 | 54 *(legítimo — ausência confirmada não vence)* |
| SIMPLES | ERROR | 6 | 0 |
| INSS | PROCESSED | 71 | **0** |

**A data existe no payload do SERPRO, em 51 de 51 guias**, no caminho
`dados[].detalhamentoDas.dataVencimento`, no formato **`AAAAMMDD`** (`"20260622"`), preservado em
`Guide.extracted.rawPayload`.

**A causa, nomeada:** `parsePossibleDate` (`application/fiscal/serpro/CaptureSerproGuidesService.js:211`)
conhece ISO (`AAAA-MM-DD`) e BR (`DD/MM/AAAA`), e para o resto faz `new Date(raw)`.
`new Date("20260622")` é **Invalid Date** em Node 20 → a função devolve `null` → a coluna nasce nula.
`extractDateValue`/`searchValueDeep` **acham** a chave; quem perde a data é o parser.

**O vencimento REAL do DAS, recuperado dos 51 payloads:**

| dia do mês | guias | % | dia da semana |
|---|---|---|---|
| **20** | 37 | 72,5% | seg 32 · qui 15 · sex 2 · qua 2 |
| **22** | 14 | 27,5% | (20/06/2026 é **sábado** → prorroga para segunda, 22) |

⚠ **Não há um único vencimento de DAS fora do dia 20 prorrogado.** A estatística "dia 20 = 66%, 19 =
9,8%, 25 = 8,9%, 30 = 6,3%" medida antes é verdadeira sobre **todas** as guias — mas ela é dominada
pelo **INSS** (71 guias, 56 no dia 20, 9 no 19, 5 no 25), porque o DAS quase não tem data para contar.
**Para o Simples, a regra é "dia 20, prorrogado para o próximo dia útil", e o SERPRO já a aplica.**

**Consequências medidas HOJE, não hipotéticas:**

- `CalendarioFiscalService` (`application/calendario/CalendarioFiscalService.js:71`) filtra guias por
  `vencimento: { gte, lt }`. **As 51 guias de DAS não aparecem no calendário fiscal, em silêncio.**
- Qualquer fluxo de caixa que leia `Guide.vencimento` verá o DAS sem data — o item mais importante do
  mês do cliente do Simples.

**Recuperável sem gastar uma única chamada SERPRO** (`rawPayload` está gravado em 51/51). ⚠ As 22
guias de SIMPLES que **têm** a coluna preenchida **não têm `detalhamentoDas` no payload** — vieram por
outro caminho (upload/manual/serviço COBRANCA); não há conflito a resolver, só complemento.

### 2.10 ⚠ Nem o motor local nem o `CalculoFiscal` calcularam imposto nesta base

| | linhas | observação |
|---|---|---|
| `ApuracaoSnapshot` | 22 (12 empresas, 2026-06 e 2026-07) | **todas `estado = transmitida`** |
| `ApuracaoSnapshot.dasSimuladoSerpro` | 22 | quem calculou foi a **RFB** |
| `ApuracaoSnapshot.dasRetornadoSerpro` | 22 | transmitidas |
| `ApuracaoSnapshot.dasCalculadoLocal` | **0** | o motor local **nunca** produziu um número |
| `ApuracaoSnapshot.receitaPorAnexo` | **0** | idem |
| `apuracoes` (`CalculoFiscal`) | **0** | a tabela existe e está **vazia** |

⚠ **A resposta a "meça se `ApuracaoSnapshot`/`CalculoFiscal` já calculam o imposto a partir das notas"
é: o CÓDIGO existe, o RESULTADO não.** `MotorApuracaoService` depende de `NotaItem.tipoReceita`, que o
projeto já mediu como nulo em 16.153 de 16.153 itens — ele bloqueia antes de calcular.

**Portanto a provisão do mês corrente NÃO pode se apoiar neles hoje**, e também **não deve
reimplementá-los**: o que o dono descreveu não é o cálculo do Simples (progressivo por RBT12) — é uma
**projeção por carga do mês anterior**, que é outra coisa e tem de se chamar outra coisa.

**Material que existe para projetar:** 85 competências com receita > 0 **e** DAS.
Carga (`dasTotal / receitaBruta`): **média 7,85%, mínima 5,92%, máxima 16,37%**.
**19 empresas** têm pelo menos dois meses seguidos de extrato — o mínimo para projetar.

### 2.11 Despesa recorrente: o material é escasso, e isso muda o desenho

Pares empresa×conta com débito em conta de resultado (grupo 4/5):

| | pares |
|---|---|
| total | 26 |
| com ≥ 3 meses | 9 |
| com ≥ 6 meses | 5 |
| **com ≥ 12 meses** | **1** |
| com ≥ 3 meses e CV ≤ 25% | 5 |

Os candidatos reais hoje (CV = desvio/média; 0 = valor idêntico todo mês):

| empresa | conta | nome | meses | janela | média | CV |
|---|---|---|---|---|---|---|
| LENTE | 426 | PRO LABORE | 12 | 2026-01..2026-12 | 6.000,00 | 0,354 |
| IOHANNA | 426 | PRO LABORE | 9 | 2026-06..2027-02 | 2.000,00 | **0** |
| CDA | 426 | PRO LABORE | 9 | 2026-04..2026-12 | 1.621,00 | **0** |
| CHAYM | 426 | PRO LABORE | 7 | 2026-05..2026-11 | 5.000,00 | **0** |
| ERISANGELA | 426 | PRO LABORE | 7 | 2026-06..2026-12 | 1.621,00 | **0** |
| SINTROPIA | 501 | JUROS | 3 | 2026-04..2026-06 | 479,11 | 0,066 |
| SINTROPIA | 464 | SERVIÇOS PRESTADOS POR PJ | 3 | 2026-04..2026-06 | 132.330,95 | 0,254 |
| SINTROPIA | 566 | DESPESAS COM REFEIÇOES | 3 | 2026-04..2026-06 | 10.124,92 | 0,671 |

⚠⚠ **Cinco dos oito são PRÓ-LABORE, e quatro deles têm CV zero.** Ou seja: a "inteligência de
repetição" que o dono pediu, rodada na base de hoje, **acertaria o pró-labore e teria pouquíssimo mais
a dizer**. Histórico contábil por empresa: 13 meses (ERISANGELA), 12 (SINTROPIA, LENTE), 10 (CDA),
9 (IOHANNA), 8 (ALESSANDRO), 7 ou menos nas outras 16.

**Isso é o achado que muda o desenho de (b):** um detector treinado em 2–3 meses não distingue
recorrência de coincidência. Ele precisa **declarar quantos meses viu** e **recusar-se a sugerir**
abaixo de um piso — e o piso, nesta base, deixa quase tudo de fora. Sugerir mesmo assim seria fabricar
previsão a partir de duas observações.

### 2.12 Premissas que **caíram** na medição

| premissa | o que a medição disse |
|---|---|
| "contas caíram em `DESPESA` por descarte da importação" | **0 contas.** 286/286 DESPESA coerentes com `codigoCompleto` |
| "importar o mesmo OFX duas vezes duplica linhas" | risco de código real, **massa zero**: não existe **nenhum** lançamento com `origem = "OFX"` na base (MANUAL 287 · SERPRO 202 · EXCEL 130 · TEMPLATE 9 · UPLOAD 4). Zero assinaturas repetidas |
| "vencimento de guia: dia 20 = 66%, 19/25/30/31 espalhados" | verdadeiro para **todas** as guias, mas dominado pelo **INSS**. Para o **DAS**, medido no payload: **dia 20 (72,5%) ou 22 (27,5%, prorrogação de fim de semana) — e mais nada** |
| "use `Guide.vencimento`" | certo — **mas a coluna está vazia em 51 das 73 guias reais de DAS**, por um bug de parser (§2.9) |
| "`ApuracaoSnapshot`/`CalculoFiscal` talvez já calculem o imposto pelas notas" | o código existe; **`dasCalculadoLocal` = 0 linhas e `apuracoes` = 0 linhas**. Nunca calcularam nada aqui |
| "contas usadas sem `codigoCompleto` ficariam sem grupo" | **0.** A única causa de "sem grupo" é **conta EM BRANCO** (10 pares, R$ 687 mil) |

---

## 3. O desenho (Fase 1) — proposto, **nada construído**

### 3.1 (a) DRE gerencial com subtipos

**A hierarquia do plano É a árvore.** Nada de tabela de mapeamento nova.

- **A chave é `codigoCompleto`, sempre.** ⚠ 41 contas têm reduzido e completo apontando para grupos
  diferentes (reduzido `5` = CAIXA-MATRIZ · completo `5` = IRPJ/CSLL). Usar o reduzido troca receita
  por despesa **sem erro nenhum**.
- **A resolução conta→plano é `resolverPlanoPorCodigo`** (`application/accounting/lib/gateContaSintetica.js`):
  casa pelo **reduzido** (é o que `AccountingEntryLine.conta` guarda, texto, sem FK) e **empresa vence
  global**. Uma segunda resolução faria o DRE e a tela de lançamento discordarem sobre qual conta é.
- **Os filhos de cada nó saem de `filhasDiretas`** (mesmo módulo, puro e testado). Ele **não supõe
  largura de nível**, e é isso que importa: as larguras aqui são 1/2/3/5/9, não múltiplos.
- **Sinal, declarado, nunca inferido de `natureza`:** grupo 3 soma **C − D**; grupos 4 e 5 somam
  **D − C**. Com isso `33 (-) DEDUCOES` sai **negativo** dentro do grupo 3, e o total do grupo 3 já é
  a **receita líquida** — que é o que o dono quer ver. Conferido montando o DRE das três empresas com
  mais movimento: fecha e é legível.

**As linhas do DRE gerencial**, e cada uma sai de um prefixo:

```
  Receita bruta                      311                (+ 31101 vendas, 31102 serviços)
  (-) Deduções                       33                 (33103 IMPOSTOS INCIDENTES — é aqui que o DAS está)
  = Receita líquida                  31 + 33
  (-) Custos                         42
  = Lucro bruto
  (-) Despesas com pessoal           41101
  (-) Despesas gerais                41102              ← o exemplo literal do dono
  (-) Despesas tributárias           41103
  (-) Depreciação/amortização        41105
  = Resultado operacional
  (+) Receitas financeiras           312
  (-) Despesas financeiras           41104
  (+) Outras receitas operacionais   32
  (-) IRPJ/CSLL                      5
  = Resultado do período
  ⚠ Não classificado                 (linha própria, sempre visível — ver abaixo)
```

**⚠ A linha "Não classificado" é obrigatória, com valor E os lançamentos.** Três causas, **nomeadas
separadamente** porque o conserto é diferente:

| causa | hoje | o que a tela diz |
|---|---|---|
| **conta EM BRANCO** | 10 pares, 76 linhas, R$ 687.355,94 | "esta linha ainda não tem conta" — é estado legítimo (provisão de guia nasce assim), **não é erro** |
| conta fora do plano | 0 | "a conta X não existe no plano desta empresa" |
| conta sem `codigoCompleto` | 0 | "a conta X não foi reimportada — não se sabe onde ela entra" |

Ela **nunca vira zero e nunca some**. Hoje ela carrega R$ 321.822,26 de **receita** e R$ 20.274,56 de
**DAS** — some com ela e a empresa some do DRE.

**Onde a árvore NÃO sustenta o que o dono pediu — as três coisas:**

1. ⚠ **22 níveis do plano global têm filho único de mesmo nome** — `33 (-) DEDUCOES DE RECEITAS` →
   `331 (-) DEDUCOES DE RECEITAS`; `5 (-) IRPJ/CSLL` → `51` → `511` → `51101`, todos com o mesmo nome;
   `312 RECEITAS FINANCEIRAS` → `31201`; `32 OUTRAS RECEITAS` → `321`; `422`, `423`, e mais.
   Renderizados crus, o usuário clica em "(-) IRPJ/CSLL" e abre "(-) IRPJ/CSLL", quatro vezes.
   **Proposta:** colapsar o nível **só** quando ele tem **exatamente um filho** e o nome é **idêntico**,
   e **dizer que colapsou** (o código completo do nível colapsado continua visível no detalhe). Nunca
   colapsar por semelhança de nome, nunca por profundidade.
2. ✅ **`41104 DESPESAS FINANCEIRAS` vive dentro de `411 DESPESAS ADMINISTRATIVAS` — e SAI de lá no
   DRE. Decisão do dono, 21/08/2026: "sim".** Junto com `312 RECEITAS FINANCEIRAS`, as duas formam um
   bloco **RESULTADO FINANCEIRO** próprio, fora do operacional.
   ⚠⚠ **Isto é a ÚNICA reordenação autorizada da árvore, e ela é do DRE — NÃO do plano de contas.**
   O plano fica exatamente como está: nenhuma conta muda de pai, nenhum `codigoCompleto` é reescrito,
   nenhuma migration. O que existe é um **remanejamento de exibição**, declarado no modelo do DRE.
   ⚠ **A consequência tem de aparecer:** puxar `41104` para fora faz o subtotal de
   `411 DESPESAS ADMINISTRATIVAS` no DRE **ficar menor que a soma das filhas dele no plano**. Quem
   conferir o DRE contra o razão vai bater nessa diferença — então o bloco administrativo **diz, na
   tela, que as financeiras foram remanejadas**, e o detalhe leva ao mesmo lugar. Diferença silenciosa
   entre o DRE e o razão é pior que a árvore torta que ela conserta.
   ⚠ **Nenhuma outra conta é remanejada por analogia.** Esta saiu por decisão nomeada; qualquer outra
   exige outra decisão.
3. ⚠ **`41 DESPESAS OPERACIONAIS` tem um filho só, `411 DESPESAS ADMINISTRATIVAS`, com nome
   diferente.** Não cai na regra do item 1 (nomes diferentes) e continua como um nível que não separa
   nada. Fica, e aparece — mudar isso é mexer no plano de contas, que é de outra sessão e do dono.

**O que o DRE NÃO faz:** não classifica, não escreve, não corrige conta, não chama nada externo.
⚠ E não se chama "Balancete" nem "Balanço" — o projeto já recusou entregar peça contábil com nome de
peça contábil a partir de lançamentos (`features/relatorios`); "DRE gerencial" tem de vir escrito na
tela, junto de "não é peça fiscal".

**Validação, feita:** o DRE montado com esta regra para SINTROPIA, LENTE e ERISANGELA fecha e é
legível — inclusive a linha negativa `311020002 MANUTENCAO −3.213,00` (débito em conta de receita, um
estorno). ⚠ **Linha de receita negativa aparece com o sinal que tem**; zerá-la esconderia o estorno.

### 3.2 (b) A inteligência de despesa recorrente

**Por repetição observada, e a resposta padrão é "não sei".**

**O sinal, e são três condições, todas necessárias:**
1. **mesma conta** (`codigoCompleto` analítico, grupo 4 ou 5) na mesma empresa;
2. **cadência mensal**: aparece em meses **consecutivos** — não basta contar meses distintos, porque
   3 meses salteados em 12 é sazonalidade, não recorrência;
3. **mesma ordem de valor**: coeficiente de variação (desvio/média) dentro de um teto.

**⚠ O que ela faz quando NÃO tem certeza — que é a maior parte do tempo nesta base:**

| observações consecutivas | o que a tela mostra |
|---|---|
| 0–2 meses | **nada.** Nem sugestão, nem "provavelmente". Duas observações não são um padrão |
| 3–5 meses | um **indício**, âmbar, com a frase *"visto em N dos últimos M meses"* e **sem valor projetado** |
| ≥ 6 meses e CV ≤ 25% | uma **sugestão**, âmbar, com valor **e** com a faixa observada (mín–máx), **e o N sempre à vista** |
| ≥ 6 meses e CV > 25% | sugestão de **ocorrência**, sem valor: *"costuma acontecer, o valor varia de X a Y"* |

⚠ **O N e a janela viajam junto do número, sempre.** Uma sugestão de R$ 6.000,00 apoiada em 12 meses e
outra apoiada em 3 não podem ter o mesmo rosto. **Rodado na base de hoje**, esse desenho produz
**4 sugestões COM valor** (IOHANNA, CDA, CHAYM e ERISANGELA — pró-labore, CV 0), **1 sugestão de
ocorrência SEM valor** (LENTE, 12 meses, CV 0,354) e **nada** para as outras 21 — e é a resposta
honesta.

⚠⚠ **Sugestão nunca tem o peso visual de um fato.** Regra da casa, já escrita pelo dono em outras
telas: **verde = concluído/fato, nunca ação; âmbar = pendência**. Então:
- o realizado (lançamento que existe) é **fato**: peso normal, sem adorno;
- a projeção recorrente é **âmbar**, com rótulo textual ("previsto") — nunca só cor, porque cor
  sozinha não sobrevive a impressão nem a daltonismo;
- **nada de verde em previsão.** Verde aqui significaria "pago", e é o pior desfecho possível.

⚠ **A sugestão não vira lançamento.** Ela é linha de projeção na tela de fluxo de caixa; quem lança é
o contador. Um detector que grava `AccountingEntry` estaria mudando a forma do lançamento contábil
sem pedido — proibido.

⚠ **Exclusões declaradas:** lançamentos `tipo = "BAIXA"` ficam de fora (a baixa é o pagamento da
provisão, contá-la duplicaria a saída); os 9 rascunhos de template sem linha ficam de fora (valor
zero); conta EM BRANCO fica de fora do detector **mas não do DRE**.

### 3.3 (c) A provisão de imposto do mês corrente

Exatamente a descrição do dono, com os nomes que a medição obriga.

**Âncora (FATO):** `CompanyMonthlyCircular` do mês anterior — `receitaBruta` e `dasTotal`, que vieram
do extrato/SERPRO. Existe em 121 competências; 19 empresas têm dois meses seguidos.

**Projeção (PREVISÃO):** carga = `dasTotal(m−1) / receitaBruta(m−1)`. Medida: média 7,85%, mín 5,92%,
máx 16,37%. ⚠ **Isto NÃO é o cálculo do Simples** (que é progressivo por RBT12 e por anexo) — é a
carga observada do mês anterior. **Tem de se chamar "com base no mês anterior", nunca "imposto
calculado".**

**Ajuste (dentro do mês):** as notas EMIT autorizadas da competência corrente. Quando
`faturamento(m) > receitaBruta(m−1)`, o portal do cliente **avisa** — *"esse mês você já faturou mais
que o mês anterior"*, que é a frase do dono.

**Vencimento:** `Guide.vencimento`. ⚠⚠ **E hoje ele não existe para o DAS** (§2.9). Enquanto o parser
não for consertado e os 51 payloads não forem relidos, o fluxo de caixa **não tem data para o item
mais importante do mês**. **Sem a data, a linha aparece dizendo "vencimento desconhecido" — nunca
assumindo o dia 20.** Depois do conserto, o dado real é "dia 20 prorrogado para o próximo dia útil", e
ele vem do SERPRO pronto: **não se calcula prorrogação aqui** (feriado municipal/estadual não está
neste banco).

**⚠⚠ Fato × previsão não podem se parecer — e a regra é estrutural, não de cor:**

| | de onde vem | como aparece |
|---|---|---|
| **FATO** | guia gerada (`Guide` com valor), lançamento contábil, extrato capturado | valor firme, com a **procedência nomeada** ("DAS gerado 12/07", "extrato PGDAS-D") |
| **PREVISÃO** | carga do mês anterior × notas do mês corrente | âmbar, rótulo **"previsto"** escrito, **e a conta à vista** ("7,85% sobre R$ 100.000 faturados até hoje") |
| **DESCONHECIDO** | sem extrato do mês anterior · extrato zero com nota autorizada · sem `Guide.vencimento` | **não vira zero e não vira previsão**: diz o que falta e como obter |

⚠ **O terceiro estado é o que a medição obriga a existir**, e cobre muita coisa: 27 competências sem
extrato, 12 empresas com 100% do intervalo sem extrato, 5 células da CDA com extrato 0,00 contra notas
autorizadas, 51 guias de DAS sem vencimento. Um fluxo de caixa que trate qualquer um desses como zero
mostra ao cliente que ele não deve imposto nenhum.

**⚠ E o total do fluxo de caixa nunca soma fato com previsão num número só.** Ou são duas linhas, ou o
total carrega quantos reais dele são previstos.

---

## 3.9 As duas decisões de 21/08/2026 que destravaram o desenho

O dono respondeu **"sim e sim"** às duas perguntas que travavam DRE e fluxo de caixa:

| pergunta | resposta | onde virou código |
|---|---|---|
| APLICACOES DE LIQUIDEZ IMEDIATA entram no fluxo de caixa? | **sim** | `accounting/lib/disponibilidades.js` → `CLASSES_DO_FLUXO_DE_CAIXA`, `entraNoFluxoDeCaixa`, `contasDoFluxoDeCaixa` |
| Despesas financeiras viram bloco próprio no DRE? | **sim** | modelo do DRE (§3, item 2) — remanejamento de EXIBIÇÃO |

⚠⚠ **A primeira virou constante, não comentário**, e a razão é que ela é uma decisão de contador que
o código passou a afirmar. `CLASSES_DO_FLUXO_DE_CAIXA` lista as três classes explicitamente.
**Não a reescreva como `!== NAO_DISPONIVEL`**: assim `DISPONIVEL_NAO_CLASSIFICADO` e `INDETERMINADO`
entrariam junto — e as duas significam *"não sabemos o que é esta conta"*. Somar o desconhecido ao
caixa é o defeito que o módulo existe para impedir. Travado em
`lib/__tests__/fluxoDeCaixaClasses.test.js`, com dois casos que ficam vermelhos se alguém
"simplificar" assim.

⚠ E `entraNoFluxoDeCaixa` respondendo `false` quer dizer **"não somo"**, nunca **"não é caixa"**.
`contasDoFluxoDeCaixa` devolve `naoDecididas` no MESMO retorno de propósito: uma função que
devolvesse só a lista boa deixaria o consumidor livre para nunca perguntar pelo resto.

---

## 4. O que ficou para o dono (perguntas, com o contexto)

1. ✅ **RESPONDIDA em 21/08/2026 — "sim".** Despesas financeiras saem de dentro de administrativas e,
   com `312 RECEITAS FINANCEIRAS`, formam um bloco **RESULTADO FINANCEIRO** no DRE.
   ⚠ Reordenação **de exibição**: o plano de contas não é tocado. Ver §3, item 2, para a consequência
   que precisa aparecer na tela (o subtotal administrativo do DRE deixa de bater com o do razão).
   Medido: SINTROPIA R$ 2.878,63 e ERISANGELA R$ 2.906,62 em `41104` no período.
2. **CDA MARKETING: extrato com `receitaBruta` = 0,00, DAS > 0 e declaração transmitida, contra R$ 12
   mil a R$ 35 mil de notas autorizadas, em 5 competências.** A hipótese é que a receita dela seja
   **externa** (o projeto já registrou `mercado = EXTERNO` na memória de apuração dela) e que a
   circular só guarde a interna. **Confirma? Se sim, "a receita vem do extrato" precisa somar receita
   interna + externa — e hoje só existe uma coluna.**
3. **Empresas sem extrato nenhum, com faturamento grande.** SINTROPIA (R$ 447 mil a R$ 788 mil/mês,
   até 2.711 notas), SANTA ALEGRE (até R$ 405 mil), SINCROSAT (até R$ 54 mil), KODA BEAR, e mais 8.
   São 41 células empresa×competência. **Elas são do Simples e a rotina SERPRO ainda não foi ligada,
   ou são de outro regime e a receita delas nunca virá de extrato?** A resposta muda a fonte de
   receita do fluxo de caixa dessas empresas.
4. **A conta EM BRANCO carrega R$ 687.355,94, sendo R$ 321.822,26 de receita**, em 10 empresas. É
   estado legítimo. **No DRE gerencial que vai ao cliente, essa linha aparece como "Não classificado"
   com o valor, ou o DRE dessas empresas fica indisponível até o contador escolher as contas?**
   (Minha proposta é a primeira — esconder é o que faz o cliente ler um número errado como certo.)
5. **Piso da sugestão de recorrência.** Proponho: nada abaixo de 3 meses consecutivos, valor só a
   partir de 6. Na base de hoje isso produz **5 sugestões com valor**, quase todas de pró-labore.
   **Prefere um piso mais baixo (mais sugestões, mais ruído) ou este?**
6. **Movimento com data futura em caixa/banco** (IOHANNA até 2027-02, LENTE e CDA até 2027-01).
   **São provisões lançadas para frente de propósito? O fluxo de caixa futuro deve exibi-las como
   fato já lançado, ou tratá-las à parte?**
7. **Baixa de parcela por débito automático** (`POST .../parcelas/:parcelaId/baixa-manual`): hoje o
   campo `dataPagamento` é **opcional** e, omitido, a baixa é gravada no dia do clique. **Torno a data
   obrigatória nessa rota?** É a última porta em que "hoje" entra sozinho.

---

## 5. Scripts (todos SOMENTE LEITURA, nenhum `--aplicar`, nenhuma chamada externa)

Padrão de execução (⚠ `railway run … bash -c` não funciona nesta máquina; não há `psql`):

```
railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/<script>.mjs'
```

| script | responde |
|---|---|
| `apps/api/scripts/diag-dre-fluxo-fase0.mjs` | as 6 perguntas da Fase 0 (grupos, descarte, data da baixa, D=C, caixa/banco, extrato) |
| `apps/api/scripts/diag-dre-fluxo-fase0b.mjs` | contas sem `codigoCompleto`, lançamentos sem linha, o desbalanço de perna única, duplicidade de importação, o buraco de `Guide.vencimento`, extrato × notas × contábil, recorrência |
| `apps/api/scripts/diag-dre-fluxo-fase0c.mjs` | o vencimento do DAS dentro do `rawPayload`, as divergências extrato × notas, o material de projeção |
| `apps/api/scripts/diag-vencimento-das-recuperavel.mjs` | quantas guias de DAS têm o vencimento recuperável do payload, e qual é o dia real |
| `apps/api/scripts/diag-dre-arvore.mjs` | os níveis redundantes do plano, a conta em que cada imposto é lançado, e o DRE montado de ponta a ponta para 3 empresas |
| `apps/api/scripts/diag-fluxo-caixa-premissas.mjs` | (pré-existente) dia do vencimento de **todas** as guias e as contas de topo |

**Verificação:** `npm test -w @contabilidade/api -- --maxWorkers=2` — **2.511 verdes + 1 vermelho
conhecido** (`serproParcelamentoContract` / `numeroDas`), medido em 22/08/2026. Nenhum código de
produção foi tocado nesta rodada.
